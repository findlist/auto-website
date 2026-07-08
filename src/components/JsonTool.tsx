import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * JSON 工具核心组件
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 格式化（美化）：将压缩 JSON 转为带缩进的可读形式
 *  - 压缩：去除所有空白
 *  - 校验：仅检查合法性，不修改内容
 *  - 转义 / 去转义：将 JSON 作为字符串嵌入到外层 JSON 字符串字面量
 *  - 树形视图：可折叠 / 展开节点、类型着色、长字符串截断、键路径复制
 *  - 树形搜索：实时高亮匹配键名与字符串值，自动展开所有节点，显示匹配计数
 *  - 复制 / 清空
 */

type Indent = 2 | 4 | '\t';
type ViewMode = 'text' | 'tree';

interface ParseError {
  message: string;
  line: number;
  column: number;
}

interface ParseResult {
  ok: boolean;
  value: unknown;
  err: ParseError | null;
}

/** 解析 V8 JSON 错误，提取行列号 */
function describeError(err: unknown, source: string): ParseError {
  const msg = err instanceof Error ? err.message : String(err);
  // V8 格式：Unexpected token X in JSON at position N
  const m = msg.match(/position\s+(\d+)/i);
  if (m) {
    const pos = parseInt(m[1], 10);
    return computeLineColumn(source, pos, msg);
  }
  return { message: msg, line: 0, column: 0 };
}

/** 根据字符偏移计算行列 */
function computeLineColumn(source: string, pos: number, raw: string): ParseError {
  if (pos < 0 || pos > source.length) {
    return { message: raw, line: 0, column: 0 };
  }
  let line = 1;
  let column = 1;
  for (let i = 0; i < pos; i++) {
    const ch = source.charCodeAt(i);
    if (ch === 0x0a) {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { message: raw, line, column };
}

/** 统计字符数与行数 */
function computeStats(text: string) {
  const chars = text.length;
  const lines = chars === 0 ? 0 : text.split('\n').length;
  return { chars, lines };
}

/** 通用：解析输入 JSON */
function parseJson(text: string): ParseResult {
  if (text.trim() === '') {
    return { ok: false, value: null, err: { message: '输入为空', line: 0, column: 0 } };
  }
  try {
    const value = JSON.parse(text);
    return { ok: true, value, err: null };
  } catch (e) {
    return { ok: false, value: null, err: describeError(e, text) };
  }
}


const SAMPLE = `{"name":"工具盒子","tags":["json","format","中文"],"version":0.1,"active":true,"author":{"name":"开发者","email":"dev@example.com"},"description":"这是一个用于演示 JSON 树形视图的示例数据，包含对象、数组、字符串、数字、布尔与 null 等多种类型。","longField":"这是一段相当长的字符串，用于演示树形视图的长文本截断功能，点击展开可查看完整内容，避免大型 JSON 在视图中占用过多垂直空间。","nullable":null}`;

/** 树形视图默认展开深度，超出此深度的对象/数组节点默认折叠 */
const TREE_DEFAULT_DEPTH = 2;
/** 字符串超过此长度时截断显示，点击可展开 */
const STRING_TRUNCATE_THRESHOLD = 100;
const STRING_TRUNCATE_KEEP = 80;

// ============ 树形视图组件 ============

/** 节点类型标签（仅用于辅助识别，不直接渲染） */
type NodeType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

function getNodeType(value: unknown): NodeType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'object') return 'object';
  if (t === 'string') return 'string';
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  return 'null';
}

/** 计算对象/数组的子项数 */
function getChildCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value as object).length;
  return 0;
}

/** 拼接键路径：parent + key（数组用 [index]，对象用 .key） */
function joinPath(parent: string, key: string | number): string {
  if (typeof key === 'number') return `${parent}[${key}]`;
  // 顶层 key 无前缀
  if (parent === '') return key;
  // 含特殊字符的 key 用 ["..."] 包裹
  if (/^[A-Za-z_$][\w$]*$/.test(key)) return `${parent}.${key}`;
  return `${parent}[${JSON.stringify(key)}]`;
}

/**
 * 高亮匹配文本：将 text 中所有 query 出现位置用 <mark> 包裹。
 * 不区分大小写；query 为空时原样返回。
 */
function highlightMatch(text: string, query: string): JSX.Element {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: JSX.Element[] = [];
  let i = 0;
  let idx = lower.indexOf(q, i);
  let keyIdx = 0;
  while (idx !== -1) {
    if (idx > i) parts.push(<span key={keyIdx++}>{text.slice(i, idx)}</span>);
    parts.push(
      <mark key={keyIdx++} className="jsontool__tree-mark">
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    i = idx + q.length;
    idx = lower.indexOf(q, i);
  }
  if (i < text.length) parts.push(<span key={keyIdx++}>{text.slice(i)}</span>);
  return <>{parts}</>;
}

/**
 * 统计匹配数量：递归遍历 value，统计 key（对象键名）与 string value 包含 query 的次数。
 * 用于搜索栏显示「找到 N 个匹配」。
 */
function countMatches(value: unknown, query: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  let count = 0;
  const walk = (v: unknown) => {
    if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === 'object') {
      Object.entries(v as object).forEach(([k, val]) => {
        if (k.toLowerCase().includes(q)) count++;
        walk(val);
      });
    } else if (typeof v === 'string') {
      if (v.toLowerCase().includes(q)) count++;
    }
  };
  walk(value);
  return count;
}

interface JsonNodeProps {
  value: unknown;
  name: string | number | null; // null 表示根节点
  path: string; // 该节点的访问路径，如 "data.users[0].name"
  depth: number;
  collapsed: Set<string>;
  forceExpandAll: boolean; // 是否强制展开所有节点（覆盖默认折叠规则）
  searchQuery: string; // 搜索关键词（高亮匹配 + 自动展开匹配路径）
  searchActive: boolean; // 是否处于搜索态（自动展开所有容器节点，便于查看匹配）
  onToggle: (path: string) => void;
  onCopyPath: (path: string) => void;
  onCopyValue: (value: unknown) => void;
}

/** 单个 JSON 节点（递归渲染） */
function JsonNode({ value, name, path, depth, collapsed, forceExpandAll, searchQuery, searchActive, onToggle, onCopyPath, onCopyValue }: JsonNodeProps) {
  const type = getNodeType(value);
  const isContainer = type === 'object' || type === 'array';
  const childCount = getChildCount(value);
  // 默认折叠规则：深度超过 TREE_DEFAULT_DEPTH 的容器节点默认折叠；
  //   forceExpandAll 或 searchActive 时禁用默认折叠（搜索态需展开所有节点才能看到高亮）
  const defaultCollapsed = !forceExpandAll && !searchActive && isContainer && childCount > 0 && depth >= TREE_DEFAULT_DEPTH;
  const isCollapsed = defaultCollapsed ? !collapsed.has(path) : collapsed.has(path);
  const [stringExpanded, setStringExpanded] = useState(false);

  // 渲染键名 + 冒号（根节点无键名）。搜索态时高亮匹配片段
  const keyEl = name !== null ? (
    <span className="jsontool__tree-key" title={`路径：${path}`}>
      {typeof name === 'string' ? highlightMatch(name, searchQuery) : name}
      <span className="jsontool__tree-colon">: </span>
    </span>
  ) : null;

  // 渲染键路径复制按钮（hover 显示，根节点无）
  const copyPathBtn = name !== null ? (
    <button
      type="button"
      className="jsontool__tree-copy"
      onClick={() => onCopyPath(path)}
      title={`复制路径：${path}`}
      aria-label={`复制路径 ${path}`}
    >
      ⎘
    </button>
  ) : null;

  // 容器节点：渲染折叠头 + 子项
  if (isContainer) {
    const openBrace = type === 'object' ? '{' : '[';
    const closeBrace = type === 'object' ? '}' : ']';
    const entries: [string | number, unknown][] = Array.isArray(value)
      ? value.map((v, i) => [i, v] as [number, unknown])
      : Object.entries(value as object).map(([k, v]) => [k, v] as [string, unknown]);

    return (
      <div className="jsontool__tree-node">
        <span className="jsontool__tree-line">
          {copyPathBtn}
          <button
            type="button"
            className="jsontool__tree-toggle"
            onClick={() => onToggle(path)}
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? '展开' : '折叠'}
          >
            {isCollapsed ? '▶' : '▼'}
          </button>
          {keyEl}
          <span className={`jsontool__tree-bracket jsontool__tree-bracket--${type}`}>{openBrace}</span>
          {isCollapsed ? (
            <span className="jsontool__tree-summary" title="点击 ▼ 展开">
              {childCount > 0 ? ` ${childCount} 项 ` : ' '}
              <span className={`jsontool__tree-bracket jsontool__tree-bracket--${type}`}>{closeBrace}</span>
            </span>
          ) : null}
        </span>
        {!isCollapsed && (
          <div className="jsontool__tree-children">
            {entries.length === 0 ? (
              <span className="jsontool__tree-empty">空{type === 'object' ? '对象' : '数组'}</span>
            ) : (
              entries.map(([k, v]) => (
                <JsonNode
                  key={k}
                  value={v}
                  name={k}
                  path={joinPath(path, k)}
                  depth={depth + 1}
                  collapsed={collapsed}
                  forceExpandAll={forceExpandAll}
                  searchQuery={searchQuery}
                  searchActive={searchActive}
                  onToggle={onToggle}
                  onCopyPath={onCopyPath}
                  onCopyValue={onCopyValue}
                />
              ))
            )}
          </div>
        )}
        {!isCollapsed && (
          <span className="jsontool__tree-line">
            <span className={`jsontool__tree-bracket jsontool__tree-bracket--${type}`}>{closeBrace}</span>
            {depth === 0 ? null : <span className="jsontool__tree-comma">,</span>}
          </span>
        )}
      </div>
    );
  }

  // 叶子节点：渲染值（字符串可截断）。搜索态时对字符串值高亮匹配片段
  let valueEl: JSX.Element;
  if (type === 'string') {
    const str = value as string;
    const tooLong = str.length > STRING_TRUNCATE_THRESHOLD;
    const display = tooLong && !stringExpanded ? str.slice(0, STRING_TRUNCATE_KEEP) + '…' : str;
    valueEl = (
      <span className="jsontool__tree-value jsontool__tree-value--string">
        &quot;{searchActive ? highlightMatch(display, searchQuery) : display}&quot;
        {tooLong && (
          <button
            type="button"
            className="jsontool__tree-str-toggle"
            onClick={() => setStringExpanded((v) => !v)}
            aria-label={stringExpanded ? '收起字符串' : '展开完整字符串'}
          >
            {stringExpanded ? '收起' : `展开（共 ${str.length} 字符）`}
          </button>
        )}
      </span>
    );
  } else if (type === 'number') {
    valueEl = <span className="jsontool__tree-value jsontool__tree-value--number">{String(value)}</span>;
  } else if (type === 'boolean') {
    valueEl = <span className="jsontool__tree-value jsontool__tree-value--boolean">{String(value)}</span>;
  } else {
    // null
    valueEl = <span className="jsontool__tree-value jsontool__tree-value--null">null</span>;
  }

  return (
    <div className="jsontool__tree-node jsontool__tree-node--leaf">
      <span className="jsontool__tree-line">
        {copyPathBtn}
        {keyEl}
        {valueEl}
        <button
          type="button"
          className="jsontool__tree-copy jsontool__tree-copy--value"
          onClick={() => onCopyValue(value)}
          title="复制值"
          aria-label="复制值"
        >
          ⎘
        </button>
        {depth > 0 && <span className="jsontool__tree-comma">,</span>}
      </span>
    </div>
  );
}

interface JsonTreeViewProps {
  value: unknown;
  collapsed: Set<string>;
  forceExpandAll: boolean;
  searchQuery: string;
  searchActive: boolean;
  onToggle: (path: string) => void;
  onCopyPath: (path: string) => void;
  onCopyValue: (value: unknown) => void;
}

/** 树形视图根容器 */
function JsonTreeView({ value, collapsed, forceExpandAll, searchQuery, searchActive, onToggle, onCopyPath, onCopyValue }: JsonTreeViewProps) {
  // 根节点 path 为空字符串，子节点会拼接成 "key" / "[0]" 等
  return (
    <div className="jsontool__tree" role="tree" aria-label="JSON 树形视图">
      <JsonNode
        value={value}
        name={null}
        path=""
        depth={0}
        collapsed={collapsed}
        forceExpandAll={forceExpandAll}
        searchQuery={searchQuery}
        searchActive={searchActive}
        onToggle={onToggle}
        onCopyPath={onCopyPath}
        onCopyValue={onCopyValue}
      />
    </div>
  );
}

// ============ 主组件 ============

export default function JsonTool() {
  const [input, setInput] = useState<string>('');
  const [output, setOutput] = useState<string>('');
  // 解析后的 JS 对象（仅 format/minify/validate 成功时更新，供树形视图使用）
  const [parsedValue, setParsedValue] = useState<unknown>(null);
  // 标记 parsedValue 是否可用（转义/去转义输出的是字符串，不适用树形视图）
  const [treeAvailable, setTreeAvailable] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<ViewMode>('text');
  // 折叠节点路径集合（容器节点 path 字符串）
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // 强制展开所有节点（覆盖默认折叠规则），用于「全部展开」按钮
  const [forceExpandAll, setForceExpandAll] = useState<boolean>(false);
  // 树形视图搜索关键词（实时高亮匹配键名与字符串值，自动展开所有容器节点）
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [indent, setIndent] = useState<Indent>(2);
  const [error, setError] = useState<ParseError | null>(null);
  const [notice, setNotice] = useState<string>('');
  const [copied, setCopied] = useState(false);
  // 树形视图中的复制提示（避免与输出区复制提示混淆）
  const [treeNotice, setTreeNotice] = useState<string>('');

  const inputStats = useMemo(() => computeStats(input), [input]);
  const outputStats = useMemo(() => computeStats(output), [output]);
  // 搜索态：关键词非空时启用，触发树形视图自动展开 + 高亮
  const searchActive = searchQuery.trim().length > 0;
  // 匹配数量：key（对象键名）与 string value 包含关键词的总次数
  const matchCount = useMemo(
    () => (searchActive ? countMatches(parsedValue, searchQuery.trim()) : 0),
    [parsedValue, searchQuery, searchActive],
  );

  /** 切换节点折叠状态 */
  const handleToggle = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  /** 复制键路径到剪贴板 */
  const handleCopyPath = useCallback(async (path: string) => {
    const ok = await copyText(path);
    setTreeNotice(ok ? `已复制路径：${path}` : '复制失败，请手动复制');
    setTimeout(() => setTreeNotice(''), 1800);
  }, []);

  /** 复制节点值到剪贴板（按 JSON 序列化） */
  const handleCopyValue = useCallback(async (value: unknown) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    const ok = await copyText(text);
    setTreeNotice(ok ? '已复制值' : '复制失败，请手动复制');
    setTimeout(() => setTreeNotice(''), 1800);
  }, []);

  /** 格式化（美化） */
  const handleFormat = useCallback(() => {
    setNotice('');
    setCopied(false);
    const result = parseJson(input);
    if (!result.ok) {
      setError(result.err!);
      setOutput('');
      setParsedValue(null);
      setTreeAvailable(false);
      return;
    }
    try {
      const pretty = JSON.stringify(result.value, null, indent);
      setOutput(pretty);
      setParsedValue(result.value);
      setTreeAvailable(true);
      setError(null);
      // 重置折叠状态，让新内容按默认深度展开
      setCollapsed(new Set());
      setForceExpandAll(false);
    } catch (e) {
      setError(describeError(e, input));
      setOutput('');
      setParsedValue(null);
      setTreeAvailable(false);
    }
  }, [input, indent]);

  /** 压缩 */
  const handleMinify = useCallback(() => {
    setNotice('');
    setCopied(false);
    const result = parseJson(input);
    if (!result.ok) {
      setError(result.err!);
      setOutput('');
      setParsedValue(null);
      setTreeAvailable(false);
      return;
    }
    try {
      setOutput(JSON.stringify(result.value));
      setParsedValue(result.value);
      setTreeAvailable(true);
      setError(null);
      setCollapsed(new Set());
      setForceExpandAll(false);
    } catch (e) {
      setError(describeError(e, input));
      setOutput('');
      setParsedValue(null);
      setTreeAvailable(false);
    }
  }, [input]);

  /** 仅校验 */
  const handleValidate = useCallback(() => {
    setNotice('');
    setCopied(false);
    setOutput('');
    const result = parseJson(input);
    if (result.ok) {
      setError(null);
      setNotice('✅ JSON 合法');
      // 校验时也更新 parsedValue，便于用户切换到树形视图查看
      setParsedValue(result.value);
      setTreeAvailable(true);
      setCollapsed(new Set());
      setForceExpandAll(false);
    } else {
      setError(result.err!);
      setParsedValue(null);
      setTreeAvailable(false);
      setNotice('');
    }
  }, [input]);

  /** 转义：将输入整体视作字符串，输出可作为外层 JSON 字符串字面量内容 */
  const handleEscape = useCallback(() => {
    setNotice('');
    setCopied(false);
    setOutput('');
    try {
      // JSON.stringify(str) 会带引号，这里去掉两侧引号仅保留转义后的内容
      const escaped = JSON.stringify(input).slice(1, -1);
      setOutput(escaped);
      setError(null);
      // 转义输出的是字符串内容，不是 JSON 对象，不适用树形视图
      setParsedValue(null);
      setTreeAvailable(false);
    } catch (e) {
      setError(describeError(e, input));
    }
  }, [input]);

  /** 去转义：把字符串内容反转义为真实字符（自动补引号解析） */
  const handleUnescape = useCallback(() => {
    setNotice('');
    setCopied(false);
    setOutput('');
    if (input.trim() === '') {
      setError({ message: '输入为空', line: 0, column: 0 });
      return;
    }
    try {
      // 兼容用户已带引号的情况
      const wrapped = input.startsWith('"') && input.endsWith('"') ? input : `"${input}"`;
      const decoded = JSON.parse(wrapped);
      if (typeof decoded !== 'string') {
        setError({ message: '去转义结果不是字符串，请检查输入', line: 0, column: 0 });
        return;
      }
      setOutput(decoded);
      setError(null);
      setParsedValue(null);
      setTreeAvailable(false);
    } catch (e) {
      setError(describeError(e, input));
    }
  }, [input]);

  /** 复制输出 */
  const handleCopy = useCallback(async () => {
    if (!output) return;
    const ok = await copyText(output);
    if (ok) {
      setCopied(true);
      setNotice('已复制到剪贴板');
      setTimeout(() => setCopied(false), 1500);
    } else {
      setNotice('复制失败，请手动选中复制');
    }
  }, [output]);

  /** 清空 */
  const handleClear = useCallback(() => {
    setInput('');
    setOutput('');
    setParsedValue(null);
    setTreeAvailable(false);
    setCollapsed(new Set());
    setForceExpandAll(false);
    setSearchQuery('');
    setError(null);
    setNotice('');
    setCopied(false);
    setTreeNotice('');
  }, []);

  /** 载入示例 */
  const handleSample = useCallback(() => {
    setInput(SAMPLE);
    setOutput('');
    setParsedValue(null);
    setTreeAvailable(false);
    setCollapsed(new Set());
    setForceExpandAll(false);
    setError(null);
    setNotice('');
  }, []);

  /** 输入框变化时同步清空错误 */
  const onInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (error) setError(null);
    if (notice) setNotice('');
  }, [error, notice]);

  /** 切换视图模式 */
  const onSwitchView = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    setTreeNotice('');
  }, []);

  /** 全部展开：清空 collapsed 集合 + 启用 forceExpandAll 覆盖默认折叠规则 */
  const handleExpandAll = useCallback(() => {
    setCollapsed(new Set());
    setForceExpandAll(true);
    setTreeNotice('已展开全部节点');
    setTimeout(() => setTreeNotice(''), 1800);
  }, []);

  /** 全部折叠：递归收集所有容器节点 path，加入 collapsed 集合 + 关闭 forceExpandAll */
  const handleCollapseAll = useCallback(() => {
    const paths = new Set<string>();
    const walk = (value: unknown, path: string) => {
      const type = getNodeType(value);
      if (type !== 'object' && type !== 'array') return;
      if (path !== '') paths.add(path);
      const entries: [string | number, unknown][] = Array.isArray(value)
        ? value.map((v, i) => [i, v] as [number, unknown])
        : Object.entries(value as object).map(([k, v]) => [k, v] as [string, unknown]);
      entries.forEach(([k, v]) => walk(v, joinPath(path, k)));
    };
    walk(parsedValue, '');
    setCollapsed(paths);
    setForceExpandAll(false);
    setTreeNotice('已折叠所有节点');
    setTimeout(() => setTreeNotice(''), 1800);
  }, [parsedValue]);

  return (
    <div className="jsontool">
      {/* 工具栏 */}
      <div className="jsontool__toolbar" role="toolbar" aria-label="JSON 操作">
        <div className="jsontool__actions">
          <button className="btn btn--primary btn--sm" onClick={handleFormat}>格式化</button>
          <button className="btn btn--sm" onClick={handleMinify}>压缩</button>
          <button className="btn btn--sm" onClick={handleValidate}>校验</button>
          <button className="btn btn--sm" onClick={handleEscape}>转义</button>
          <button className="btn btn--sm" onClick={handleUnescape}>去转义</button>
        </div>
        <div className="jsontool__options">
          <label className="jsontool__indent">
            缩进
            <select
              value={indent}
              onChange={(e) => setIndent(e.target.value === '\t' ? '\t' : (Number(e.target.value) as 2 | 4))}
              aria-label="缩进方式"
            >
              <option value={2}>2 空格</option>
              <option value={4}>4 空格</option>
              <option value={'\t'}>Tab</option>
            </select>
          </label>
          <button className="btn btn--sm" onClick={handleSample}>示例</button>
          <button className="btn btn--sm" onClick={handleClear}>清空</button>
        </div>
      </div>

      {/* 编辑区 */}
      <div className="jsontool__panels">
        <div className="jsontool__panel">
          <label htmlFor="json-input" className="jsontool__label">
            输入
            <span className="jsontool__stat">{inputStats.chars} 字 · {inputStats.lines} 行</span>
          </label>
          <textarea
            id="json-input"
            className="jsontool__textarea"
            value={input}
            onChange={onInputChange}
            placeholder='在此粘贴 JSON，或点击"示例"载入演示数据'
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            aria-label="JSON 输入"
          />
        </div>
        <div className="jsontool__panel">
          <div className="jsontool__label">
            {/* 视图切换 Tab */}
            <div className="jsontool__view-tabs" role="tablist" aria-label="输出视图">
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'text'}
                className={`jsontool__view-tab${viewMode === 'text' ? ' is-active' : ''}`}
                onClick={() => onSwitchView('text')}
              >文本</button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'tree'}
                className={`jsontool__view-tab${viewMode === 'tree' ? ' is-active' : ''}`}
                onClick={() => onSwitchView('tree')}
                disabled={!treeAvailable}
                title={treeAvailable ? '切换到树形视图' : '请先执行格式化 / 压缩 / 校验'}
              >树形</button>
            </div>
            <span className="jsontool__stat">{outputStats.chars} 字 · {outputStats.lines} 行</span>
            {viewMode === 'text' && (
              <button
                className="btn btn--sm jsontool__copy"
                onClick={handleCopy}
                disabled={!output}
                aria-label="复制输出"
              >
                {copied ? '已复制' : '复制'}
              </button>
            )}
            {viewMode === 'tree' && (
              <>
                <button className="btn btn--sm" onClick={handleExpandAll} type="button">展开</button>
                <button className="btn btn--sm" onClick={handleCollapseAll} type="button">折叠</button>
              </>
            )}
          </div>
          {viewMode === 'text' ? (
            <textarea
              className="jsontool__textarea jsontool__textarea--output"
              value={output}
              readOnly
              placeholder="处理结果将显示在这里"
              spellCheck={false}
              aria-label="JSON 输出"
            />
          ) : treeAvailable ? (
            <div className="jsontool__tree-wrap" aria-live="polite">
              {/* 搜索栏：实时高亮键名与字符串值，自动展开所有节点 */}
              <div className="jsontool__search-bar" role="search">
                <input
                  type="search"
                  className="jsontool__search-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索键名或字符串值（不区分大小写）"
                  aria-label="搜索 JSON 树"
                  spellCheck={false}
                  autoComplete="off"
                />
                {searchActive && (
                  <span
                    className={`jsontool__search-count${matchCount === 0 ? ' is-empty' : ''}`}
                    aria-live="polite"
                  >
                    {matchCount > 0 ? `找到 ${matchCount} 个匹配` : '无匹配'}
                  </span>
                )}
              </div>
              <JsonTreeView
                value={parsedValue}
                collapsed={collapsed}
                forceExpandAll={forceExpandAll}
                searchQuery={searchQuery.trim()}
                searchActive={searchActive}
                onToggle={handleToggle}
                onCopyPath={handleCopyPath}
                onCopyValue={handleCopyValue}
              />
              {treeNotice && <div className="jsontool__tree-notice" role="status">{treeNotice}</div>}
            </div>
          ) : (
            <div className="jsontool__tree-empty-state">
              <p>当前操作不产生 JSON 对象（如转义 / 去转义输出字符串）。</p>
              <p>请先点击「格式化 / 压缩 / 校验」生成可浏览的 JSON 树。</p>
            </div>
          )}
        </div>
      </div>

      {/* 状态条 */}
      <div className="jsontool__status" role="status" aria-live="polite">
        {error ? (
          <div className="jsontool__error">
            <strong>❌ 错误</strong>
            <span>{error.message}</span>
            {error.line > 0 && (
              <span className="jsontool__error-loc">
                （第 {error.line} 行，第 {error.column} 列）
              </span>
            )}
          </div>
        ) : notice ? (
          <div className="jsontool__notice">{notice}</div>
        ) : (
          <div className="jsontool__hint">
            所有数据仅在你浏览器内处理，不会上传到任何服务器。
          </div>
        )}
      </div>
    </div>
  );
}
