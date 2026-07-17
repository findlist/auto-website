/**
 * SVG 优化器核心工具函数
 *
 * 全部为纯函数，不依赖 DOM 与任何外部库。
 * 基于字符串与正则的轻量优化，覆盖 SVGO 常用插件的核心能力：
 *  - 去除 XML 声明 / DOCTYPE / 注释
 *  - 去除 metadata / desc / title（可选）与编辑器残留（Inkscape / Sketch / Adobe）
 *  - 去除编辑器命名空间属性与无意义 id
 *  - 数字精度简化（去除多余小数位与前导零）
 *  - 去除默认值属性（如 fill="black"）
 *  - 压缩空白与换行（minify）
 *
 * 设计原则：
 *  - 不破坏 SVG 结构合法性（保留根 svg 元素与命名空间声明）
 *  - 不优化 path 数据（复杂度高，且易引入渲染差异，留给专业工具）
 *  - 每条规则可独立开关，返回详细应用统计
 */

/** 优化选项：每条规则可独立开关 */
export interface OptimizeOptions {
  removeXmlDecl: boolean;          // 去除 <?xml ... ?> 声明
  removeDoctype: boolean;          // 去除 <!DOCTYPE ... > 声明
  removeComments: boolean;         // 去除 <!-- --> 注释
  removeMetadata: boolean;         // 去除 <metadata> 元素
  removeDesc: boolean;             // 去除 <desc> 元素
  removeTitle: boolean;            // 去除 <title> 元素（影响无障碍，默认 false）
  removeEditorAttrs: boolean;      // 去除 Inkscape / Sketch / Adobe 等编辑器命名空间属性
  removeEditorIds: boolean;        // 去除编辑器自动生成的无意义 id（如 Layer_1）
  shortenNumbers: boolean;         // 数字精度简化
  removeDefaultAttrs: boolean;     // 去除默认值属性
  collapseWhitespace: boolean;     // 压缩空白与换行
}

/** 单条规则的执行统计 */
export interface RuleStat {
  id: keyof OptimizeOptions;
  name: string;
  applied: boolean;                // 是否启用
  savedBytes: number;              // 本规则节省的字节数
}

/** 优化结果 */
export interface OptimizeResult {
  output: string;                  // 优化后的 SVG 文本
  originalSize: number;            // 原始字节数
  optimizedSize: number;           // 优化后字节数
  savings: number;                 // 节省百分比（0-100）
  rules: RuleStat[];               // 各规则执行统计
  error?: string;                  // 错误信息（解析失败时）
}

/** 默认优化选项：覆盖 90% 场景的安全配置 */
export const DEFAULT_OPTIONS: OptimizeOptions = {
  removeXmlDecl: true,
  removeDoctype: true,
  removeComments: true,
  removeMetadata: true,
  removeDesc: true,
  removeTitle: false,              // 保留 title，维护无障碍
  removeEditorAttrs: true,
  removeEditorIds: true,
  shortenNumbers: true,
  removeDefaultAttrs: true,
  collapseWhitespace: true,
};

/** 预设方案：常用场景的选项组合 */
export interface Preset {
  id: string;
  name: string;
  description: string;
  options: OptimizeOptions;
}

/** 3 个预设：保守 / 标准 / 激进 */
export const PRESETS: Preset[] = [
  {
    id: 'conservative',
    name: '保守',
    description: '仅去除 XML 声明、DOCTYPE、注释与编辑器残留，保留所有结构',
    options: {
      ...DEFAULT_OPTIONS,
      removeDesc: false,
      shortenNumbers: false,
      removeDefaultAttrs: false,
      collapseWhitespace: false,
    },
  },
  {
    id: 'standard',
    name: '标准',
    description: '默认配置，平衡体积与可读性，适合大多数场景',
    options: { ...DEFAULT_OPTIONS },
  },
  {
    id: 'aggressive',
    name: '激进',
    description: '极致压缩，去除 title 与所有可去除内容，适合内联使用',
    options: {
      ...DEFAULT_OPTIONS,
      removeTitle: true,
    },
  },
];

/**
 * 编辑器命名空间前缀：这些命名空间的属性与元素均为编辑器残留
 * 来源：Inkscape (sodipodi/inkscape)、Sketch (sketch)、Adobe (Illustrator)、CorelDRAW
 */
const EDITOR_NS_PREFIXES = [
  'sodipodi',
  'inkscape',
  'sketch',
  'illustrator',
  'ns',
  'i:',
];

/**
 * 编辑器自动生成的 id 模式：Layer_1、_x2C_、_x3C_ 等 Adobe 编码
 * 匹配这些 id 并移除元素上的 id 属性（仅当 id 不被引用时）
 */
const EDITOR_ID_PATTERNS = [
  /^Layer[_-]?\d+/i,               // Inkscape: Layer_1
  /^_x[0-9A-F]{2}_/,               // Adobe: _x2C_ _x3C_ 等
  /^[a-z]+-\d+$/,                  // 通用: rect-1 path-2
];

/**
 * 常见默认值属性：当属性值等于默认值时移除
 * 注意：仅移除明确无副作用的默认值，避免影响继承
 */
const DEFAULT_ATTR_VALUES: Record<string, string[]> = {
  'stroke': ['none'],
  'stroke-width': ['1'],
  'stroke-linecap': ['butt'],
  'stroke-linejoin': ['miter'],
  'stroke-opacity': ['1'],
  'stroke-dasharray': ['none'],
  'fill': ['black'],
  'fill-opacity': ['1'],
  'fill-rule': ['nonzero'],
  'opacity': ['1'],
  'text-anchor': ['start'],
  'dominant-baseline': ['auto'],
};

/** 输入大小上限：5MB，避免正则回溯爆炸 */
const MAX_INPUT_SIZE = 5 * 1024 * 1024;

/** 字节数转可读字符串 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** 安全执行单条规则：捕获异常并返回原输入，避免单条规则炸毁整体流程 */
function applyRule(input: string, fn: (s: string) => string): string {
  try {
    return fn(input);
  } catch {
    return input;
  }
}

/** 去除 XML 声明：<?xml version="1.0" ... ?> */
function removeXmlDecl(s: string): string {
  return s.replace(/<\?xml[^>]*\?>\s*/gi, '');
}

/** 去除 DOCTYPE 声明 */
function removeDoctype(s: string): string {
  // DOCTYPE 可能含内部子集 [ ... ]，使用非贪婪匹配
  return s.replace(/<!DOCTYPE[^>]*>\s*/gi, '');
}

/** 去除注释：<!-- ... -->（支持多行） */
function removeComments(s: string): string {
  return s.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * 去除指定元素及其内容
 * @param tagName 元素名（不含尖括号）
 */
function removeElement(tagName: string): (s: string) => string {
  const re = new RegExp(`<${tagName}[^>]*>[\\s\\S]*?</${tagName}>\\s*`, 'gi');
  const selfClosingRe = new RegExp(`<${tagName}[^>]*/>\\s*`, 'gi');
  return (s: string) => s.replace(re, '').replace(selfClosingRe, '');
}

/** 去除编辑器命名空间属性：如 sodipodi:nodetypes="..." inkscape:label="..." */
function removeEditorAttrs(s: string): string {
  let result = s;
  for (const prefix of EDITOR_NS_PREFIXES) {
    // 属性名形如 prefix:localname="value" 或 prefix="uri"（命名空间声明 xmlns:prefix="uri"）
    const attrRe = new RegExp(`\\s${prefix}:[a-zA-Z_-]+="[^"]*"`, 'g');
    result = result.replace(attrRe, '');
    // 同时移除命名空间声明本身：xmlns:prefix="uri"
    const nsRe = new RegExp(`\\sxmlns:${prefix}="[^"]*"`, 'g');
    result = result.replace(nsRe, '');
  }
  return result;
}

/**
 * 去除编辑器自动生成的无意义 id
 * 安全策略：仅当 id 未被其他属性引用时才移除（url(#id)、href="#id"、xlink:href="#id"）
 */
function removeEditorIds(s: string): string {
  // 收集所有被引用的 id
  const referenced = new Set<string>();
  const refPatterns = [
    /url\(#([^)]+)\)/g,
    /href="#([^"]+)"/g,
    /xlink:href="#([^"]+)"/g,
  ];
  for (const re of refPatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
      referenced.add(m[1]);
    }
  }
  // 移除匹配编辑器模式且未被引用的 id 属性
  return s.replace(/\sid="([^"]+)"/g, (full, id: string) => {
    if (referenced.has(id)) return full;
    for (const pattern of EDITOR_ID_PATTERNS) {
      if (pattern.test(id)) return '';
    }
    return full;
  });
}

/**
 * 数字精度简化
 *  - 去除前导零：0.5 → .5
 *  - 去除尾随零：1.50 → 1.5
 *  - 去除多余小数位：1.23456789 → 1.235（保留 3 位）
 *  - 整数化：1.0 → 1
 * 仅处理数值，不处理属性名或文本
 */
function shortenNumbers(s: string): string {
  // 匹配属性值中的数字（含小数与负数），不匹配颜色 hex 与文本
  // 数值前后通常是 空格、"、=、(、, 等分隔符
  return s.replace(/(?<=[=(",\s])-?\d+\.\d+/g, (match) => {
    const num = parseFloat(match);
    if (Number.isNaN(num)) return match;
    // 保留 3 位有效小数，去除尾随零
    const fixed = num.toFixed(3).replace(/\.?0+$/, '');
    // 去除前导零：0.5 → .5（仅当 0 后面是小数点）
    return fixed.replace(/^(-?)0\./, '$1.');
  });
}

/** 去除默认值属性 */
function removeDefaultAttrs(s: string): string {
  let result = s;
  for (const [attr, defaults] of Object.entries(DEFAULT_ATTR_VALUES)) {
    for (const val of defaults) {
      // 仅移除精确匹配默认值的属性，避免误删自定义值
      const re = new RegExp(`\\s${attr}="${val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g');
      result = result.replace(re, '');
    }
  }
  return result;
}

/**
 * 压缩空白与换行
 *  - 多个连续空格合并为 1 个
 *  - 多个连续换行合并为 0（标签间无空白）
 *  - 标签内首尾空白去除
 *  - 保留 <text> 内的空白（影响渲染）
 */
function collapseWhitespace(s: string): string {
  // 保护 text 与 tspan 内的内容（用占位符替换，避免压缩影响文本渲染）
  const placeholders: string[] = [];
  let out = s.replace(/<(text|tspan)([^>]*)>([\s\S]*?)<\/\1>/gi, (_full, tag, attrs, content) => {
    placeholders.push(`<${tag}${attrs}>${content}</${tag}>`);
    return `\u0000${placeholders.length - 1}\u0000`;
  });
  // 标签间的空白与换行直接移除
  out = out.replace(/>\s+</g, '><');
  // 属性间多个空格合并为 1 个
  out = out.replace(/\s{2,}/g, ' ');
  // 行首尾空白
  out = out.replace(/^\s+|\s+$/gm, '');
  // 还原保护内容
  out = out.replace(/\u0000(\d+)\u0000/g, (_full, idx) => placeholders[parseInt(idx, 10)]);
  return out;
}

/** 字符串字节长度（UTF-8 编码） */
function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** 规则元数据：id → 名称与执行函数 */
const RULES: { id: keyof OptimizeOptions; name: string; fn: (s: string) => string }[] = [
  { id: 'removeXmlDecl', name: '去除 XML 声明', fn: removeXmlDecl },
  { id: 'removeDoctype', name: '去除 DOCTYPE 声明', fn: removeDoctype },
  { id: 'removeComments', name: '去除注释', fn: removeComments },
  { id: 'removeMetadata', name: '去除 metadata 元素', fn: removeElement('metadata') },
  { id: 'removeDesc', name: '去除 desc 元素', fn: removeElement('desc') },
  { id: 'removeTitle', name: '去除 title 元素', fn: removeElement('title') },
  { id: 'removeEditorAttrs', name: '去除编辑器命名空间属性', fn: removeEditorAttrs },
  { id: 'removeEditorIds', name: '去除编辑器无意义 id', fn: removeEditorIds },
  { id: 'shortenNumbers', name: '数字精度简化', fn: shortenNumbers },
  { id: 'removeDefaultAttrs', name: '去除默认值属性', fn: removeDefaultAttrs },
  { id: 'collapseWhitespace', name: '压缩空白', fn: collapseWhitespace },
];

/**
 * SVG 优化主函数
 * @param input 原始 SVG 文本
 * @param options 优化选项（默认 DEFAULT_OPTIONS）
 * @returns 优化结果，含输出文本与统计
 */
export function optimizeSvg(
  input: string,
  options: Partial<OptimizeOptions> = {},
): OptimizeResult {
  const opts: OptimizeOptions = { ...DEFAULT_OPTIONS, ...options };
  const originalSize = byteLength(input);

  // 输入校验
  if (!input || input.trim().length === 0) {
    return {
      output: '',
      originalSize: 0,
      optimizedSize: 0,
      savings: 0,
      rules: [],
      error: '输入为空',
    };
  }
  if (originalSize > MAX_INPUT_SIZE) {
    return {
      output: input,
      originalSize,
      optimizedSize: originalSize,
      savings: 0,
      rules: [],
      error: `输入超过 ${formatBytes(MAX_INPUT_SIZE)} 限制，请缩减 SVG 体积`,
    };
  }
  // 简单合法性校验：必须包含 <svg 根元素
  if (!/<svg[\s>]/i.test(input)) {
    return {
      output: input,
      originalSize,
      optimizedSize: originalSize,
      savings: 0,
      rules: [],
      error: '未检测到 <svg> 根元素，请输入合法的 SVG 文本',
    };
  }

  // 顺序应用启用的规则，记录每条规则节省的字节数
  let current = input;
  const ruleStats: RuleStat[] = [];
  for (const rule of RULES) {
    if (!opts[rule.id]) {
      ruleStats.push({ id: rule.id, name: rule.name, applied: false, savedBytes: 0 });
      continue;
    }
    const before = byteLength(current);
    current = applyRule(current, rule.fn);
    const after = byteLength(current);
    ruleStats.push({
      id: rule.id,
      name: rule.name,
      applied: true,
      savedBytes: Math.max(0, before - after),
    });
  }

  const optimizedSize = byteLength(current);
  const savings = originalSize > 0 ? ((originalSize - optimizedSize) / originalSize) * 100 : 0;

  return {
    output: current,
    originalSize,
    optimizedSize,
    savings,
    rules: ruleStats,
  };
}

/** 示例 SVG：用于"加载示例"按钮 */
export const SAMPLE_SVG = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Created with Inkscape (http://www.inkscape.org/) -->
<svg
   xmlns:svg="http://www.w3.org/2000/svg"
   xmlns="http://www.w3.org/2000/svg"
   xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.0.dtd"
   xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
   width="100"
   height="100"
   viewBox="0 0 100 100"
   version="1.1"
   id="Layer_1"
   inkscape:version="1.0"
   sodipodi:docname="icon.svg">
  <metadata id="metadata8">
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
      <cc:Work rdf:about="">
        <dc:format>image/svg+xml</dc:format>
      </cc:Work>
    </rdf:RDF>
  </metadata>
  <desc>示例图标</desc>
  <title>示例</title>
  <circle
     cx="50.00000"
     cy="50.00000"
     r="40.00000"
     fill="black"
     stroke="none"
     stroke-width="1"
     id="circle1"
     inkscape:label="背景圆" />
  <rect
     x="20.50000"
     y="20.50000"
     width="59.00000"
     height="59.00000"
     fill="#3b82f6"
     stroke="#1e40af"
     stroke-width="2.00000" />
</svg>
`;
