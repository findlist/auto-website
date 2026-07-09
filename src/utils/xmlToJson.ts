/**
 * XML 转 JSON 转换引擎
 *
 * 设计目标：
 *  - 纯原生 TypeScript + 浏览器 DOMParser 零依赖实现 XML → JSON 单向转换
 *  - 递归遍历 DOM 树，同名子元素自动合并为数组（XML → JSON 的标准做法）
 *  - 属性名加前缀（默认 @）避免与子元素名冲突
 *  - 文本节点用 #text 标识，CDATA 默认合并到文本（可配置分离）
 *  - 支持类型推断（数字 / 布尔 / null 自动转换）
 *  - 注释默认忽略，空白文本节点默认忽略
 *
 * 安全策略：
 *  - 使用 text/xml 模式解析，DOMParser 不解析外部实体（XXE 防护）
 *  - 检测 parsererror，友好提示解析失败位置
 *  - 纯本地处理，不发起任何网络请求
 */

/** 转换选项 */
export interface XmlToJsonOptions {
  /** 属性名前缀，默认 @（避免与子元素名冲突） */
  attributeNamePrefix: string;
  /** 文本节点字段名，默认 #text */
  textNodeName: string;
  /** CDATA 字段名，默认 #cdata（分离模式下使用） */
  cdataNodeName: string;
  /** 是否忽略注释，默认 true */
  ignoreComments: boolean;
  /** 是否忽略纯空白文本节点，默认 true */
  ignoreWhitespace: boolean;
  /** 是否将 CDATA 合并到普通文本（true 合并，false 分离为 #cdata 字段），默认 true */
  mergeCdata: boolean;
  /** 是否自动推断类型（数字 / 布尔 / null），默认 false（全部保留为字符串） */
  coerceTypes: boolean;
  /** 空元素如何表示：null / 空字符串 / 空对象，默认 null */
  emptyElementValue: 'null' | 'empty' | 'object';
  /** 是否始终将子元素包成数组（即便只有一个元素），默认 false */
  alwaysArray: boolean;
  /** JSON 缩进空格数，0 表示压缩单行，默认 2 */
  indent: number;
}

/** 转换结果 */
export interface XmlToJsonResult {
  ok: boolean;
  json: string;
  /** 解析后的原始 JSON 对象（失败时为 null） */
  data: unknown;
  error: string;
  warnings: string[];
  stats: {
    elements: number;
    attributes: number;
    textNodes: number;
    cdataSections: number;
    comments: number;
    maxDepth: number;
  };
}

/** 默认选项 */
export const DEFAULT_OPTIONS: XmlToJsonOptions = {
  attributeNamePrefix: '@',
  textNodeName: '#text',
  cdataNodeName: '#cdata',
  ignoreComments: true,
  ignoreWhitespace: true,
  mergeCdata: true,
  coerceTypes: false,
  emptyElementValue: 'null',
  alwaysArray: false,
  indent: 2,
};

/** 递归深度上限：防止恶意深度嵌套 XML 导致调用栈溢出 */
const MAX_RECURSION_DEPTH = 500;

/** 内部解析状态 */
interface ParseState {
  elements: number;
  attributes: number;
  textNodes: number;
  cdataSections: number;
  comments: number;
  maxDepth: number;
  warnings: string[];
}

/**
 * 自动推断字符串类型
 *  - "true" / "false" → boolean
 *  - "null" → null
 *  - 纯数字字符串 → number（注意 NaN / Infinity 不转换）
 */
function coerceValue(text: string, coerceTypes: boolean): unknown {
  if (!coerceTypes) return text;
  const trimmed = text.trim();
  // 布尔
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  // null
  if (trimmed === 'null') return null;
  // 数字（排除 NaN / Infinity / 科学计数法误判）
  if (trimmed !== '' && /^-?\d+$/.test(trimmed)) {
    const num = parseInt(trimmed, 10);
    if (Number.isSafeInteger(num)) return num;
  }
  if (trimmed !== '' && /^-?\d+\.\d+$/.test(trimmed)) {
    const num = parseFloat(trimmed);
    if (Number.isFinite(num)) return num;
  }
  // 科学计数法（如 1e10、6.022e23、-1.5E-5）
  if (trimmed !== '' && /^-?\d+(\.\d+)?[eE][+-]?\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    if (Number.isFinite(num)) return num;
  }
  return text;
}

/**
 * 收集元素下的直接文本内容（普通文本 + 可选 CDATA）
 * 跳过子元素与注释
 */
function collectText(
  element: Element,
  mergeCdata: boolean,
  _cdataNodeName: string,
  ignoreWhitespace: boolean,
): { text: string; cdataParts: string[] } {
  let text = '';
  const cdataParts: string[] = [];

  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.nodeValue || '';
    } else if (node.nodeType === Node.CDATA_SECTION_NODE) {
      const cdata = node.nodeValue || '';
      if (mergeCdata) {
        text += cdata;
      } else {
        cdataParts.push(cdata);
      }
    }
  }

  // 空白处理：若整段文本仅空白且开启忽略，则视为空
  if (ignoreWhitespace && text.trim() === '') {
    text = '';
  }

  return { text, cdataParts };
}

/**
 * 判断元素是否为空元素（无子元素、无文本、无 CDATA、无属性）
 */
function isEmptyElement(element: Element, options: XmlToJsonOptions): boolean {
  if (element.attributes.length > 0) return false;
  if (element.children.length > 0) return false;
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) return false;
    if (node.nodeType === Node.TEXT_NODE) {
      const v = node.nodeValue || '';
      if (!options.ignoreWhitespace || v.trim() !== '') return false;
    }
    if (node.nodeType === Node.CDATA_SECTION_NODE) return false;
  }
  return true;
}

/**
 * 递归将 DOM 元素转换为 JSON 值
 */
function elementToJson(
  element: Element,
  options: XmlToJsonOptions,
  depth: number,
  state: ParseState,
): unknown {
  state.elements++;
  if (depth > state.maxDepth) state.maxDepth = depth;
  // 深度上限校验：防止恶意深度嵌套 XML 导致调用栈溢出
  if (depth > MAX_RECURSION_DEPTH) {
    throw new Error(`XML 嵌套深度超过上限 ${MAX_RECURSION_DEPTH}，可能为恶意输入`);
  }

  // 空元素处理
  if (isEmptyElement(element, options)) {
    switch (options.emptyElementValue) {
      case 'null':
        return null;
      case 'empty':
        return '';
      case 'object':
        return {};
    }
  }

  const result: Record<string, unknown> = {};

  // 处理属性
  for (const attr of Array.from(element.attributes)) {
    state.attributes++;
    const attrKey = options.attributeNamePrefix + attr.name;
    result[attrKey] = options.coerceTypes
      ? coerceValue(attr.value, true)
      : attr.value;
  }

  // 收集直接文本与 CDATA
  const { text, cdataParts } = collectText(
    element,
    options.mergeCdata,
    options.cdataNodeName,
    options.ignoreWhitespace,
  );

  // 处理子元素（按标签名分组，同名合并为数组）
  const groups: Record<string, Element[]> = {};
  const childOrder: string[] = [];
  for (const child of Array.from(element.children)) {
    const tag = child.tagName;
    if (!groups[tag]) {
      groups[tag] = [];
      childOrder.push(tag);
    }
    groups[tag].push(child);
  }

  // 遍历子元素分组
  for (const tag of childOrder) {
    const elems = groups[tag];
    if (elems.length === 1 && !options.alwaysArray) {
      result[tag] = elementToJson(elems[0], options, depth + 1, state);
    } else {
      result[tag] = elems.map((e) => elementToJson(e, options, depth + 1, state));
    }
  }

  // 统计 CDATA 节
  if (cdataParts.length > 0) {
    state.cdataSections += cdataParts.length;
  }

  // 文本节点处理
  const hasChildren = childOrder.length > 0;

  if (!hasChildren) {
    // 纯文本元素：直接返回文本值（若有属性则保留为对象）
    if (Object.keys(result).length === 0 || !options.attributeNamePrefix) {
      // 无属性：直接返回文本（合并模式下 text 已含 CDATA）
      if (text !== '' && (options.mergeCdata || cdataParts.length === 0)) {
        state.textNodes++;
        return options.coerceTypes ? coerceValue(text, true) : text;
      }
      // 分离模式且有 CDATA：返回对象含 #cdata 字段（保留 CDATA 边界信息）
      if (!options.mergeCdata && cdataParts.length > 0) {
        state.cdataSections += cdataParts.length;
        const cdataObj: Record<string, unknown> = {};
        if (text !== '') {
          state.textNodes++;
          cdataObj[options.textNodeName] = options.coerceTypes
            ? coerceValue(text, true)
            : text;
        }
        cdataObj[options.cdataNodeName] =
          cdataParts.length === 1 ? cdataParts[0] : cdataParts;
        return cdataObj;
      }
      // 无文本无属性无 CDATA（已在 isEmptyElement 处理，此处兜底）
      return null;
    }
    // 有属性：文本放入 #text 字段
    if (text !== '') {
      state.textNodes++;
      result[options.textNodeName] = options.coerceTypes
        ? coerceValue(text, true)
        : text;
    }
    // CDATA 分离模式
    if (!options.mergeCdata && cdataParts.length > 0) {
      result[options.cdataNodeName] =
        cdataParts.length === 1 ? cdataParts[0] : cdataParts;
    }
    return result;
  }

  // 混合内容（既有子元素又有文本）：文本放入 #text
  if (text !== '') {
    state.textNodes++;
    result[options.textNodeName] = options.coerceTypes
      ? coerceValue(text, true)
      : text;
  }
  if (!options.mergeCdata && cdataParts.length > 0) {
    result[options.cdataNodeName] =
      cdataParts.length === 1 ? cdataParts[0] : cdataParts;
  }

  return result;
}

/**
 * 检测 DOMParser 解析错误（parsererror 元素）
 */
function getParserError(doc: Document): string {
  const parserError = doc.getElementsByTagName('parsererror');
  if (parserError.length === 0) return '';
  // 取 parsererror 的文本内容（含错误位置）
  const errNode = parserError[0];
  return errNode.textContent || 'XML 解析失败';
}

/**
 * 主入口：XML 字符串 → JSON 字符串
 */
export function xmlToJson(
  xmlText: string,
  options: Partial<XmlToJsonOptions> = {},
): XmlToJsonResult {
  const opts: XmlToJsonOptions = { ...DEFAULT_OPTIONS, ...options };
  const state: ParseState = {
    elements: 0,
    attributes: 0,
    textNodes: 0,
    cdataSections: 0,
    comments: 0,
    maxDepth: 0,
    warnings: [],
  };

  const emptyStats = {
    elements: 0,
    attributes: 0,
    textNodes: 0,
    cdataSections: 0,
    comments: 0,
    maxDepth: 0,
  };

  // 空输入
  const trimmed = xmlText.trim();
  if (!trimmed) {
    return {
      ok: false,
      json: '',
      data: null,
      error: '请输入 XML 数据',
      warnings: [],
      stats: emptyStats,
    };
  }

  // DOMParser 解析（text/xml 模式，不加载外部实体，天然防 XXE）
  let doc: Document;
  try {
    const parser = new DOMParser();
    doc = parser.parseFromString(trimmed, 'text/xml');
  } catch (e) {
    return {
      ok: false,
      json: '',
      data: null,
      error: `XML 解析失败：${e instanceof Error ? e.message : String(e)}`,
      warnings: [],
      stats: emptyStats,
    };
  }

  // 检测 parsererror
  const errorMsg = getParserError(doc);
  if (errorMsg) {
    return {
      ok: false,
      json: '',
      data: null,
      error: `XML 解析失败：${errorMsg.split('\n')[0].slice(0, 200)}`,
      warnings: [],
      stats: emptyStats,
    };
  }

  // 获取根元素
  const root = doc.documentElement;
  if (!root) {
    return {
      ok: false,
      json: '',
      data: null,
      error: 'XML 无根元素',
      warnings: [],
      stats: emptyStats,
    };
  }

  // 递归转换（注释默认忽略，DOMParser 解析后可通过 nodeType 过滤，此处不单独统计）
  // 用 try-catch 包裹：捕获深度超限等递归异常，避免整个调用栈崩溃
  let data: unknown;
  try {
    data = elementToJson(root, opts, 0, state);
  } catch (e) {
    return {
      ok: false,
      json: '',
      data: null,
      error: `XML 转换失败：${e instanceof Error ? e.message : String(e)}`,
      warnings: state.warnings,
      stats: {
        elements: state.elements,
        attributes: state.attributes,
        textNodes: state.textNodes,
        cdataSections: state.cdataSections,
        comments: state.comments,
        maxDepth: state.maxDepth,
      },
    };
  }

  // 序列化为 JSON 字符串
  let json: string;
  try {
    json = JSON.stringify(data, null, opts.indent > 0 ? opts.indent : 0);
  } catch (e) {
    return {
      ok: false,
      json: '',
      data: null,
      error: `JSON 序列化失败：${e instanceof Error ? e.message : String(e)}`,
      warnings: state.warnings,
      stats: {
        elements: state.elements,
        attributes: state.attributes,
        textNodes: state.textNodes,
        cdataSections: state.cdataSections,
        comments: state.comments,
        maxDepth: state.maxDepth,
      },
    };
  }

  return {
    ok: true,
    json,
    data,
    error: '',
    warnings: state.warnings,
    stats: {
      elements: state.elements,
      attributes: state.attributes,
      textNodes: state.textNodes,
      cdataSections: state.cdataSections,
      comments: state.comments,
      maxDepth: state.maxDepth,
    },
  };
}

/** 统计信息格式化 */
export function formatStats(stats: XmlToJsonResult['stats']): string {
  return `元素 ${stats.elements} · 属性 ${stats.attributes} · 文本节点 ${stats.textNodes} · CDATA ${stats.cdataSections} · 最大深度 ${stats.maxDepth}`;
}
