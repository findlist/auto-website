/**
 * JSON 转 XML 转换引擎
 *
 * 设计目标：
 *  - 纯原生 TypeScript 零依赖实现 JSON → XML 单向转换
 *  - 支持对象 / 数组 / 基本类型 / null 的递归序列化
 *  - 可配置根节点名、数组项名、属性风格、CDATA、XML 声明、缩进、null 表示
 *  - 非法 XML 标签名自动修正（数字开头加下划线、非法字符替换为下划线）
 *  - well-formed 校验：标签名合法性、未闭合标签、循环引用检测
 *
 * 安全策略：
 *  - 文本节点强制转义 < > & " '
 *  - CDATA 模式下处理 ]]> 分隔符冲突
 *  - 不解析任何外部实体（XXE 防护）
 */

/** 转换选项 */
export interface JsonToXmlOptions {
  /** 根节点名，默认 root */
  rootName: string;
  /** 数组项名，默认 item */
  arrayItemName: string;
  /** 简单值用属性而非子元素（仅对扁平对象生效），默认 false */
  useAttributes: boolean;
  /** 文本含特殊字符时用 CDATA 包裹，默认 false */
  useCdata: boolean;
  /** 包含 <?xml?> 声明，默认 true */
  includeDeclaration: boolean;
  /** 缩进空格数，0 表示压缩单行，默认 2 */
  indent: number;
  /** null 用 xsi:nil="true" 表示，默认 false（空元素） */
  nilForNull: boolean;
}

/** 转换结果 */
export interface JsonToXmlResult {
  ok: boolean;
  xml: string;
  error: string;
  warnings: string[];
  stats: {
    elements: number;
    attributes: number;
    textNodes: number;
    maxDepth: number;
  };
}

/** 默认选项 */
export const DEFAULT_OPTIONS: JsonToXmlOptions = {
  rootName: 'root',
  arrayItemName: 'item',
  useAttributes: false,
  useCdata: false,
  includeDeclaration: true,
  indent: 2,
  nilForNull: false,
};

/** XML 声明 */
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

/** xsi 命名空间声明（nilForNull 启用时自动注入根节点） */
const XSI_NS = ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';

/**
 * XML 名称合法性校验
 * 规则：以字母或 _ 开头，可含字母、数字、-、_、.；不能以 xml（任何大小写）开头
 */
export function isValidXmlName(name: string): boolean {
  if (!name) return false;
  if (/^[Xx][Mm][Ll]/.test(name)) return false;
  return /^[A-Za-z_][A-Za-z0-9_\-.]*$/.test(name);
}

/**
 * 修正非法 XML 标签名
 *  - 非法字符替换为下划线
 *  - 数字 / - / . 开头加下划线前缀
 *  - 仍不合法则用 fallback
 */
export function sanitizeTagName(name: string, fallback: string): string {
  if (isValidXmlName(name)) return name;
  // 替换非法字符为下划线
  let sanitized = name.replace(/[^A-Za-z0-9_\-.]/g, '_');
  // 数字 / - / . 开头加下划线前缀
  if (/^[0-9\-\.]/.test(sanitized)) sanitized = '_' + sanitized;
  // 空 或 以 xml 开头，加下划线前缀
  if (!sanitized || /^[Xx][Mm][Ll]/.test(sanitized)) sanitized = '_' + (sanitized || fallback);
  return isValidXmlName(sanitized) ? sanitized : fallback;
}

/** 转义 XML 文本节点中的特殊字符 */
function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 转义 XML 属性值中的特殊字符 */
function escapeAttribute(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** CDATA 包裹，处理 ]]> 分隔符冲突（拆分为多段 CDATA） */
function wrapCdata(text: string): string {
  if (!text.includes(']]>')) return `<![CDATA[${text}]]>`;
  // 遇到 ]]> 拆分：]]> 结束当前段，]]><![CDATA[ 开始新段
  return text
    .split(']]>')
    .map((part) => `<![CDATA[${part}]]>`)
    .join(']]><![CDATA[>');
}

/** 判断是否为简单值（字符串 / 数字 / 布尔） */
function isPrimitive(value: unknown): value is string | number | boolean {
  const t = typeof value;
  return t === 'string' || t === 'number' || t === 'boolean';
}

/** 内部序列化状态 */
interface SerializeState {
  elements: number;
  attributes: number;
  textNodes: number;
  maxDepth: number;
  warnings: string[];
  /** 检测循环引用（对象引用追踪） */
  seen: WeakSet<object>;
}

/** 生成指定深度的缩进 */
function indentStr(depth: number, indent: number): string {
  return indent > 0 ? ' '.repeat(depth * indent) : '';
}

/** 换行符（缩进开启时使用） */
function nl(indent: number): string {
  return indent > 0 ? '\n' : '';
}

/**
 * 序列化单个值为 XML 片段
 * @param value 待序列化的值
 * @param tagName 当前标签名
 * @param options 选项
 * @param depth 当前深度
 * @param state 状态
 */
function serializeValue(
  value: unknown,
  tagName: string,
  options: JsonToXmlOptions,
  depth: number,
  state: SerializeState,
): string {
  const ind = indentStr(depth, options.indent);
  const eol = nl(options.indent);

  // null 处理
  if (value === null || value === undefined) {
    state.elements++;
    if (options.nilForNull) {
      state.attributes++;
      return `${ind}<${tagName} xsi:nil="true"/>`;
    }
    return `${ind}<${tagName}/>`;
  }

  // 数组处理：展开为多个同名元素（使用 arrayItemName）
  if (Array.isArray(value)) {
    return value
      .map((item) => serializeValue(item, options.arrayItemName, options, depth, state))
      .join(eol);
  }

  // 对象处理
  if (typeof value === 'object') {
    // 循环引用检测
    if (state.seen.has(value)) {
      state.warnings.push(`检测到循环引用，已跳过 <${tagName}> 的重复节点`);
      return `${ind}<!-- 循环引用已跳过 -->`;
    }
    state.seen.add(value);

    const entries = Object.entries(value);
    state.elements++;

    // 空对象
    if (entries.length === 0) {
      return `${ind}<${tagName}/>`;
    }

    // 扁平对象 + useAttributes 模式：简单值用属性
    if (options.useAttributes && entries.every(([, v]) => isPrimitive(v) || v === null)) {
      const attrs = entries
        .map(([k, v]) => {
          const attrName = sanitizeTagName(k, '_attr');
          if (!isValidXmlName(attrName)) {
            state.warnings.push(`属性名 "${k}" 非法，已修正为 "${attrName}"`);
          }
          state.attributes++;
          if (v === null) {
            return options.nilForNull ? `${attrName} xsi:nil="true"` : `${attrName}=""`;
          }
          return `${attrName}="${escapeAttribute(String(v))}"`;
        })
        .join(' ');
      return `${ind}<${tagName} ${attrs}/>`;
    }

    // 递归序列化子元素
    const childIndent = indentStr(depth + 1, options.indent);
    const children = entries
      .map(([k, v]) => {
        const childTag = sanitizeTagName(k, options.arrayItemName);
        if (!isValidXmlName(childTag)) {
          state.warnings.push(`标签名 "${k}" 非法，已修正为 "${childTag}"`);
        }
        // 数组需要包在父标签下：<key><item>...</item><item>...</item></key>
        if (Array.isArray(v)) {
          if (v.length === 0) {
            return `${childIndent}<${childTag}/>`;
          }
          const items = v
            .map((item) => serializeValue(item, options.arrayItemName, options, depth + 2, state))
            .join(eol);
          return `${childIndent}<${childTag}>${eol}${items}${eol}${childIndent}</${childTag}>`;
        }
        return serializeValue(v, childTag, options, depth + 1, state);
      })
      .join(eol);

    if (depth + 1 > state.maxDepth) state.maxDepth = depth + 1;
    return `${ind}<${tagName}>${eol}${children}${eol}${ind}</${tagName}>`;
  }

  // 简单值
  state.elements++;
  state.textNodes++;
  const text = String(value);
  if (options.useCdata && /[<>&]/.test(text)) {
    return `${ind}<${tagName}>${wrapCdata(text)}</${tagName}>`;
  }
  return `${ind}<${tagName}>${escapeText(text)}</${tagName}>`;
}

/**
 * 主入口：JSON 字符串 → XML 字符串
 */
export function jsonToXml(jsonText: string, options: Partial<JsonToXmlOptions> = {}): JsonToXmlResult {
  const opts: JsonToXmlOptions = { ...DEFAULT_OPTIONS, ...options };
  const state: SerializeState = {
    elements: 0,
    attributes: 0,
    textNodes: 0,
    maxDepth: 0,
    warnings: [],
    seen: new WeakSet(),
  };

  // 空输入
  const trimmed = jsonText.trim();
  if (!trimmed) {
    return { ok: false, xml: '', error: '请输入 JSON 数据', warnings: [], stats: { elements: 0, attributes: 0, textNodes: 0, maxDepth: 0 } };
  }

  // JSON 解析
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch (e) {
    return {
      ok: false,
      xml: '',
      error: `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`,
      warnings: [],
      stats: { elements: 0, attributes: 0, textNodes: 0, maxDepth: 0 },
    };
  }

  // 根节点名校验
  const rootTag = sanitizeTagName(opts.rootName, 'root');
  if (!isValidXmlName(rootTag)) {
    return { ok: false, xml: '', error: `根节点名 "${opts.rootName}" 非法，需以字母或下划线开头`, warnings: [], stats: { elements: 0, attributes: 0, textNodes: 0, maxDepth: 0 } };
  }

  // 数组项名校验
  const itemTag = sanitizeTagName(opts.arrayItemName, 'item');
  if (!isValidXmlName(itemTag)) {
    return { ok: false, xml: '', error: `数组项名 "${opts.arrayItemName}" 非法，需以字母或下划线开头`, warnings: [], stats: { elements: 0, attributes: 0, textNodes: 0, maxDepth: 0 } };
  }

  // 序列化根节点
  // 顶层是数组时，用 arrayItemName 作为每项标签，包在根节点下
  let body: string;
  if (Array.isArray(value)) {
    if (value.length === 0) {
      body = `${indentStr(1, opts.indent)}<!-- 空数组 -->`;
    } else {
      body = value
        .map((item) => serializeValue(item, opts.arrayItemName, opts, 1, state))
        .join(nl(opts.indent));
    }
  } else {
    body = serializeValue(value, rootTag, opts, 0, state);
  }

  // 如果顶层是数组，需要手动包根节点
  let xml: string;
  if (Array.isArray(value)) {
    const ind = indentStr(0, opts.indent);
    const eol = nl(opts.indent);
    const xsi = opts.nilForNull ? XSI_NS : '';
    // body 已经是带缩进的子元素，包在根节点下
    // 但 serializeValue 返回的是 <item>...</item> 形式，需要再包一层根
    // 注意：顶层数组时，serializeValue 对每项用 arrayItemName 序列化，depth=1
    // 所以 body 的缩进是 depth=1，我们需要包在 depth=0 的根节点下
    xml = `${ind}<${rootTag}${xsi}>${eol}${body}${eol}${ind}</${rootTag}>`;
  } else {
    // 顶层是对象或简单值：serializeValue 已用 rootTag 序列化
    // 但 nilForNull 需要注入 xsi 命名空间到根节点
    if (opts.nilForNull && xmlNeedsXsi(body)) {
      xml = injectXsiToRoot(body, rootTag);
    } else {
      xml = body;
    }
  }

  // XML 声明
  if (opts.includeDeclaration) {
    xml = `${XML_DECLARATION}${nl(opts.indent)}${xml}`;
  }

  return {
    ok: true,
    xml,
    error: '',
    warnings: state.warnings,
    stats: {
      elements: state.elements,
      attributes: state.attributes,
      textNodes: state.textNodes,
      maxDepth: state.maxDepth,
    },
  };
}

/** 检测 XML 中是否使用了 xsi:nil */
function xmlNeedsXsi(xml: string): boolean {
  return xml.includes('xsi:nil');
}

/** 向根节点注入 xmlns:xsi 命名空间声明 */
function injectXsiToRoot(xml: string, rootTag: string): string {
  // 在第一个 <rootTag 后注入命名空间
  const tagStart = `<${rootTag}`;
  const idx = xml.indexOf(tagStart);
  if (idx === -1) return xml;
  return xml.slice(0, idx + tagStart.length) + XSI_NS + xml.slice(idx + tagStart.length);
}

/**
 * 校验 XML 是否 well-formed
 * 基于正则的轻量校验，非完整 XML 解析器
 */
export function validateXml(xml: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!xml.trim()) {
    errors.push('XML 为空');
    return { valid: false, errors };
  }

  // 检查 XML 声明（若存在）
  if (xml.startsWith('<?xml')) {
    const declEnd = xml.indexOf('?>');
    if (declEnd === -1) {
      errors.push('XML 声明未闭合，缺少 ?>');
    }
  }

  // 提取所有开始标签与结束标签，校验嵌套匹配
  const tagStack: string[] = [];
  // 匹配标签：开始标签 <tag> / 自闭合 <tag/> / 结束标签 </tag>
  // 忽略 CDATA、注释、处理指令
  const tagRegex = /<(\/?)([A-Za-z_][A-Za-z0-9_\-.]*)((?:\s[^<>]*?)?)(\/?)>/g;
  // 跳过 CDATA 与注释
  const cleanXml = xml
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(cleanXml)) !== null) {
    const [, closing, name, , selfClosing] = match;
    if (selfClosing || name === 'br' || name === 'hr' || name === 'img' || name === 'input') {
      // 自闭合或 HTML void 元素，不入栈
      continue;
    }
    if (closing) {
      // 结束标签，需与栈顶匹配
      const top = tagStack.pop();
      if (!top) {
        errors.push(`多余的结束标签 </${name}>`);
      } else if (top !== name) {
        errors.push(`标签不匹配：期望 </${top}>，实际 </${name}>`);
        // 回填以继续校验
      }
    } else {
      tagStack.push(name);
    }
  }

  if (tagStack.length > 0) {
    errors.push(`未闭合的标签：${tagStack.map((t) => `<${t}>`).join(', ')}`);
  }

  // 检查特殊字符未转义（文本节点中的裸 < & ）
  // 排除合法的 &amp; &lt; &gt; &quot; &apos; &#数字; &#x十六进制;
  const textOnly = cleanXml
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, '');
  if (/[<&]/.test(textOnly)) {
    errors.push('文本节点中存在未转义的 < 或 & 字符');
  }

  return { valid: errors.length === 0, errors };
}

/** 统计信息格式化 */
export function formatStats(stats: JsonToXmlResult['stats']): string {
  return `元素 ${stats.elements} · 属性 ${stats.attributes} · 文本节点 ${stats.textNodes} · 最大深度 ${stats.maxDepth}`;
}
