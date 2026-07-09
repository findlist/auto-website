/**
 * HTML 格式化与压缩
 *
 * 纯原生 TypeScript 零依赖实现，基于浏览器原生 DOMParser 解析与递归序列化。
 * 提供三种能力：
 *   - 美化（Pretty）：递归遍历 DOM 树，按层级缩进，可选保留注释与空白
 *   - 压缩（Minify）：移除注释、合并空白、移除可选闭合标签、压缩属性间空格
 *   - 校验（Lint）：解析后输出统计信息与可疑问题清单
 *
 * 设计要点：
 *   - 使用 text/html 模式解析（浏览器自动修复未闭合标签，符合 HTML5 容错）
 *   - void elements（area/base/br/col/...）渲染为自闭合，不含子节点
 *   - pre/textarea/script/style/title 内容原样保留，不缩进、不归一化空白
 *   - 属性值统一用双引号包裹；布尔属性（如 disabled）保留无值形式
 */

/** HTML5 void elements：无闭合标签，无子节点（来源：WHATWG HTML 标准） */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** 内容应原样保留的标签：不缩进、不归一化空白（pre 保留换行，script/style 不转义） */
const RAWTEXT_ELEMENTS = new Set(['pre', 'textarea', 'script', 'style', 'title']);

/** 可省略闭合标签的元素（压缩模式可省略以减小体积，来源：HTML5 规范） */
const OPTIONAL_CLOSE = new Set([
  'html', 'head', 'body', 'li', 'dt', 'dd', 'p', 'rt', 'rp',
  'optgroup', 'option', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th',
]);

/** 美化输出选项 */
export interface PrettyOptions {
  /** 缩进字符串：'\t' 或 '  ' 或 '    ' 等 */
  indent: string;
  /** 是否保留 HTML 注释 */
  preserveComments: boolean;
  /** 是否保留空白文本节点（false 时合并连续空白） */
  preserveWhitespace: boolean;
  /** 是否将标签名与属性名小写化（HTML5 规范推荐小写） */
  lowerCaseTags: boolean;
  /** 换行符：'\n'（默认）或 '\r\n' */
  eol: string;
}

/** 压缩输出选项 */
export interface MinifyOptions {
  /** 是否移除 HTML 注释 */
  removeComments: boolean;
  /** 是否折叠连续空白为单空格 */
  collapseWhitespace: boolean;
  /** 是否移除可选闭合标签（如 </li> </p> </td>） */
  removeOptionalClose: boolean;
  /** 是否移除空属性（如空的 class=""） */
  removeEmptyAttrs: boolean;
}

/** 校验问题：每条警告对应一个可能的不规范写法 */
export interface LintIssue {
  level: 'warning' | 'info';
  message: string;
  location?: string;
}

/** 统一结果对象：ok 表示是否成功，error 为错误消息 */
export interface FormatterResult {
  ok: boolean;
  value: string;
  error: string;
  issues?: LintIssue[];
  stats?: FormatStats;
}

/** 解析后的统计信息 */
export interface FormatStats {
  elements: number;
  textNodes: number;
  comments: number;
  attributes: number;
  maxDepth: number;
}

const DEFAULT_PRETTY: PrettyOptions = {
  indent: '  ',
  preserveComments: true,
  preserveWhitespace: false,
  lowerCaseTags: true,
  eol: '\n',
};

const DEFAULT_MINIFY: MinifyOptions = {
  removeComments: true,
  collapseWhitespace: true,
  removeOptionalClose: false,
  removeEmptyAttrs: false,
};

/** 解析 HTML 字符串为 Document（使用浏览器原生 DOMParser） */
function parseHtml(input: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(input, 'text/html');
}

/** 标签名 / 属性名小写化 */
function normalizeName(name: string, lower: boolean): string {
  return lower ? name.toLowerCase() : name;
}

/** 序列化属性列表：name="value" 形式，布尔属性保留无值 */
function serializeAttributes(el: Element, lower: boolean, removeEmpty: boolean): string {
  const parts: string[] = [];
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    const name = normalizeName(attr.name, lower);
    const value = attr.value;
    // removeEmpty 时跳过空字符串属性（如 class=""）
    if (removeEmpty && value === '' && !isBooleanAttribute(name)) continue;
    // 布尔属性（disabled/checked/readonly 等）保留无值形式
    if (value === '' && isBooleanAttribute(name)) {
      parts.push(` ${name}`);
    } else {
      // 属性值中的 & 与 " 需要转义回 HTML 实体形式
      const escaped = value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      parts.push(` ${name}="${escaped}"`);
    }
  }
  return parts.join('');
}

/** 常见布尔属性表：值为空字符串时表示属性存在即可 */
const BOOLEAN_ATTRS = new Set([
  'allowfullscreen', 'async', 'autofocus', 'autoplay', 'checked', 'controls',
  'default', 'defer', 'disabled', 'formnovalidate', 'hidden', 'ismap', 'loop',
  'multiple', 'muted', 'nomodule', 'novalidate', 'open', 'playsinline',
  'readonly', 'required', 'reversed', 'selected', 'truespeed',
]);

function isBooleanAttribute(name: string): boolean {
  return BOOLEAN_ATTRS.has(name.toLowerCase());
}

/** 判断元素子节点是否全为空白文本（用于压缩模式移除空白间节点） */
function hasOnlyWhitespaceChildren(el: Element): boolean {
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes[i];
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      if (text.trim() !== '') return false;
    } else {
      return false;
    }
  }
  return el.childNodes.length > 0;
}

/** 收集统计信息：递归统计元素/文本/注释/属性数量与最大深度 */
function collectStats(doc: Document, stats: FormatStats): void {
  const walk = (node: Node, depth: number): void => {
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];
      if (child.nodeType === Node.ELEMENT_NODE) {
        stats.elements++;
        stats.attributes += (child as Element).attributes.length;
        stats.maxDepth = Math.max(stats.maxDepth, depth + 1);
        walk(child, depth + 1);
      } else if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent || '';
        if (text.trim() !== '') stats.textNodes++;
      } else if (child.nodeType === Node.COMMENT_NODE) {
        stats.comments++;
      }
    }
  };
  walk(doc.documentElement, 0);
}

/** 基础校验：扫描可疑写法（未编码字符、重复属性、可能的未闭合标签） */
function lintHtml(input: string, doc: Document): LintIssue[] {
  const issues: LintIssue[] = [];
  // 1. 检测文本中未编码的 < 与 >（出现在文本节点而非标签边界）
  // 用 DOMParser 已自动转义，对比原输入可粗略识别
  const rawLt = input.match(/<(?!\s*\/?[a-zA-Z!\/?])/g);
  if (rawLt) {
    issues.push({
      level: 'warning',
      message: `检测到 ${rawLt.length} 处可能未编码的 < 字符（在 HTML 中应写为 &lt;）`,
    });
  }
  // 2. 检测未编码的 & 字符（不在实体形式 &#/\w+; 中）
  const rawAmp = input.match(/&(?!#x?[0-9a-fA-F]+;|[a-zA-Z][a-zA-Z0-9]+;)/g);
  if (rawAmp) {
    issues.push({
      level: 'warning',
      message: `检测到 ${rawAmp.length} 处可能未编码的 & 字符（应写为 &amp;）`,
    });
  }
  // 3. 检测重复属性（同元素同名属性多次出现）
  const dupAttrRe = /<(\w+)([^>]*?)\s(\w+)\s*=\s*["'][^"']*["']([^>]*?)\s\3\s*=/g;
  let dup;
  while ((dup = dupAttrRe.exec(input)) !== null) {
    issues.push({
      level: 'warning',
      message: `元素 <${dup[1]}> 出现重复属性 "${dup[3]}"，浏览器将只保留第一个`,
    });
  }
  // 4. 检测 parsererror（text/html 模式一般不会产生，但保险检查）
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    issues.push({
      level: 'warning',
      message: `DOMParser 报告解析错误：${parserError.textContent || ''}`,
    });
  }
  return issues;
}

/** 美化序列化主逻辑：递归生成格式化 HTML 字符串 */
function prettySerialize(node: Node, indent: string, opts: PrettyOptions, lines: string[]): void {
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (child.nodeType === Node.ELEMENT_NODE) {
      prettyElement(child as Element, indent, opts, lines);
    } else if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.textContent || '').replace(/\s+/g, ' ');
      if (text.trim() !== '' || opts.preserveWhitespace) {
        // preserveWhitespace 模式保留折叠后的空白边界，否则 trim；避免 trim+原文导致内容重复
        const display = opts.preserveWhitespace ? text : text.trim();
        lines.push(indent + display);
      }
    } else if (child.nodeType === Node.COMMENT_NODE) {
      if (opts.preserveComments) {
        lines.push(indent + `<!--${child.textContent}-->`);
      }
    } else if (child.nodeType === Node.DOCUMENT_TYPE_NODE) {
      const dt = child as DocumentType;
      lines.push(indent + `<!DOCTYPE ${dt.name}>`);
    } else if (child.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
      const pi = child as ProcessingInstruction;
      lines.push(indent + `<?${pi.target} ${pi.data}?>`);
    }
  }
}

/** 序列化单个元素：含标签、属性、子节点、闭合标签 */
function prettyElement(el: Element, indent: string, opts: PrettyOptions, lines: string[]): void {
  const tag = normalizeName(el.tagName, opts.lowerCaseTags);
  const attrs = serializeAttributes(el, opts.lowerCaseTags, false);
  // void elements：自闭合，无子节点
  if (VOID_ELEMENTS.has(tag.toLowerCase())) {
    lines.push(indent + `<${tag}${attrs}>`);
    return;
  }
  // rawtext 元素（pre/textarea/script/style/title）：内容原样保留，不缩进
  if (RAWTEXT_ELEMENTS.has(tag.toLowerCase()) && el.childNodes.length > 0) {
    const raw = el.textContent || '';
    lines.push(indent + `<${tag}${attrs}>${raw}</${tag}>`);
    return;
  }
  // 含子节点：递归处理
  const hasChildren = el.childNodes.length > 0;
  if (!hasChildren) {
    lines.push(indent + `<${tag}${attrs}></${tag}>`);
    return;
  }
  lines.push(indent + `<${tag}${attrs}>`);
  prettySerialize(el, indent + opts.indent, opts, lines);
  lines.push(indent + `</${tag}>`);
}

/** 美化入口 */
export function prettyPrint(input: string, options: Partial<PrettyOptions> = {}): FormatterResult {
  if (input.trim() === '') return { ok: true, value: '', error: '' };
  try {
    const opts = { ...DEFAULT_PRETTY, ...options };
    const doc = parseHtml(input);
    const lines: string[] = [];
    prettySerialize(doc, '', opts, lines);
    const stats: FormatStats = { elements: 0, textNodes: 0, comments: 0, attributes: 0, maxDepth: 0 };
    collectStats(doc, stats);
    return { ok: true, value: lines.join(opts.eol), error: '', stats };
  } catch (e) {
    return { ok: false, value: '', error: `美化失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 压缩序列化主逻辑：递归生成压缩 HTML 字符串 */
function minifySerialize(node: Node, opts: MinifyOptions, output: string[]): void {
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (child.nodeType === Node.ELEMENT_NODE) {
      minifyElement(child as Element, opts, output);
    } else if (child.nodeType === Node.TEXT_NODE) {
      let text = child.textContent || '';
      if (opts.collapseWhitespace) {
        text = text.replace(/\s+/g, ' ');
      }
      if (text !== '') output.push(text);
    } else if (child.nodeType === Node.COMMENT_NODE) {
      if (!opts.removeComments) {
        output.push(`<!--${child.textContent}-->`);
      }
    } else if (child.nodeType === Node.DOCUMENT_TYPE_NODE) {
      const dt = child as DocumentType;
      output.push(`<!DOCTYPE ${dt.name}>`);
    }
  }
}

/** 压缩单个元素 */
function minifyElement(el: Element, opts: MinifyOptions, output: string[]): void {
  const tag = el.tagName.toLowerCase();
  const attrs = serializeAttributes(el, true, opts.removeEmptyAttrs);
  // void elements
  if (VOID_ELEMENTS.has(tag)) {
    output.push(`<${tag}${attrs}>`);
    return;
  }
  // rawtext 元素：内容原样保留
  if (RAWTEXT_ELEMENTS.has(tag) && el.childNodes.length > 0) {
    output.push(`<${tag}${attrs}>${el.textContent || ''}</${tag}>`);
    return;
  }
  // 空元素：直接输出空标签
  if (el.childNodes.length === 0) {
    output.push(`<${tag}${attrs}></${tag}>`);
    return;
  }
  // 收集子节点压缩结果
  const childOut: string[] = [];
  minifySerialize(el, opts, childOut);
  const inner = childOut.join('');
  // 可省略闭合标签
  const canSkipClose = opts.removeOptionalClose && OPTIONAL_CLOSE.has(tag);
  if (canSkipClose) {
    output.push(`<${tag}${attrs}>${inner}`);
  } else {
    output.push(`<${tag}${attrs}>${inner}</${tag}>`);
  }
}

/** 压缩入口 */
export function minify(input: string, options: Partial<MinifyOptions> = {}): FormatterResult {
  if (input.trim() === '') return { ok: true, value: '', error: '' };
  try {
    const opts = { ...DEFAULT_MINIFY, ...options };
    const doc = parseHtml(input);
    const output: string[] = [];
    minifySerialize(doc, opts, output);
    const stats: FormatStats = { elements: 0, textNodes: 0, comments: 0, attributes: 0, maxDepth: 0 };
    collectStats(doc, stats);
    return { ok: true, value: output.join(''), error: '', stats };
  } catch (e) {
    return { ok: false, value: '', error: `压缩失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 校验入口：解析 + 统计 + 问题清单 */
export function lint(input: string): FormatterResult {
  if (input.trim() === '') return { ok: true, value: '', error: '' };
  try {
    const doc = parseHtml(input);
    const stats: FormatStats = { elements: 0, textNodes: 0, comments: 0, attributes: 0, maxDepth: 0 };
    collectStats(doc, stats);
    const issues = lintHtml(input, doc);
    // 输出友好的校验报告
    const lines: string[] = [];
    lines.push(`解析成功 ✓`);
    lines.push(`元素数：${stats.elements}，文本节点：${stats.textNodes}，注释：${stats.comments}，属性：${stats.attributes}，最大深度：${stats.maxDepth}`);
    if (issues.length === 0) {
      lines.push('未发现明显问题');
    } else {
      lines.push(`发现 ${issues.length} 个问题：`);
      issues.forEach((iss, idx) => {
        lines.push(`${idx + 1}. [${iss.level}] ${iss.message}`);
      });
    }
    return { ok: true, value: lines.join('\n'), error: '', issues, stats };
  } catch (e) {
    return { ok: false, value: '', error: `校验失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 计算压缩率：(原长度 - 压缩后长度) / 原长度 × 100% */
export function compressionRatio(original: string, compressed: string): number {
  if (original.length === 0) return 0;
  const ratio = (original.length - compressed.length) / original.length * 100;
  return Math.max(0, Math.round(ratio * 100) / 100);
}

/** 统计文本的行数与字符数 */
export function computeTextStats(text: string): { chars: number; lines: number } {
  const chars = text.length;
  const lines = chars === 0 ? 0 : text.split('\n').length;
  return { chars, lines };
}
