import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';
import {
  HTTP_HEADERS,
  CATEGORY_METAS,
  searchHeaders,
  getCategoryStats,
  parseHeaders,
  buildCurlCommand,
  buildFetchCode,
  HTTP_METHODS,
  SAMPLE_RAW,
  type HeaderCategory,
  type HeaderInfo,
} from '../utils/httpHeaders';

/**
 * HTTP Header 解析与生成工具
 *
 * 全部在浏览器本地处理，零网络请求，零依赖。
 *
 * 三大功能（标签页切换）：
 *  1. 速查表：内置 40+ 常用 Header（请求/响应/通用/表示/CORS/安全/缓存 7 大类），含含义、语法、示例、详细说明
 *  2. 解析器：粘贴原始 HTTP Header 文本（标准报文或 cURL -H 风格），解析为键值对表格，标记格式警告
 *  3. 生成器：根据 URL + Method + Headers + Body 生成等效 cURL 命令与 JavaScript fetch 代码
 *
 * 核心知识点（RFC 9110 HTTP 语义）：
 *  - Header 名称大小写不敏感，约定首字母大写
 *  - 格式：name: value（冒号后空格可选）
 *  - 同名 Header 可出现多次，合并为逗号分隔（Set-Cookie 例外）
 *  - RFC 9110 仅允许可见 ASCII（0x21-0x7e）作为 Header 名称
 */
type Tab = 'reference' | 'parser' | 'generator';

/** 当前选中的输出代码类型 */
type OutputKind = 'curl' | 'fetch';

export default function HttpHeadersTool() {
  const [tab, setTab] = useState<Tab>('reference');

  return (
    <div className="hh__container">
      {/* 标签页导航 */}
      <div className="hh__tabs" role="tablist" aria-label="HTTP Header 工具模式切换">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'reference'}
          className={`hh__tab ${tab === 'reference' ? 'is-active' : ''}`}
          onClick={() => setTab('reference')}
        >
          速查表
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'parser'}
          className={`hh__tab ${tab === 'parser' ? 'is-active' : ''}`}
          onClick={() => setTab('parser')}
        >
          解析器
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'generator'}
          className={`hh__tab ${tab === 'generator' ? 'is-active' : ''}`}
          onClick={() => setTab('generator')}
        >
          生成器
        </button>
      </div>

      {tab === 'reference' && <ReferencePanel />}
      {tab === 'parser' && <ParserPanel />}
      {tab === 'generator' && <GeneratorPanel />}
    </div>
  );
}

/* ============== 速查表面板 ============== */
function ReferencePanel() {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<HeaderCategory | 'all'>('all');
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const filtered = useMemo(
    () => searchHeaders(query, activeCategory),
    [query, activeCategory],
  );
  const stats = useMemo(() => getCategoryStats(), []);
  const selected: HeaderInfo | null = useMemo(
    () => (selectedName ? HTTP_HEADERS.find((h) => h.name === selectedName) ?? null : null),
    [selectedName],
  );

  const handleCopy = useCallback(async (value: string, field: string) => {
    const ok = await copyText(value);
    if (ok) {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    }
  }, []);

  const handleClear = useCallback(() => {
    setQuery('');
    setActiveCategory('all');
    setSelectedName(null);
  }, []);

  return (
    <div className="hh__ref">
      {/* 搜索与筛选区 */}
      <div className="hh__controls">
        <input
          type="search"
          className="hh__input hh__search"
          placeholder="搜索 Header 名称、含义、语法、示例（如 Content-Type、CORS、缓存）"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="搜索 Header"
        />
        <div className="hh__chips" role="group" aria-label="Header 分类筛选">
          <button
            type="button"
            className={`hh__chip ${activeCategory === 'all' ? 'is-active' : ''}`}
            onClick={() => setActiveCategory('all')}
          >
            全部 ({stats.all})
          </button>
          {(Object.keys(CATEGORY_METAS) as HeaderCategory[]).map((cat) => (
            <button
              key={cat}
              type="button"
              className={`hh__chip ${activeCategory === cat ? 'is-active' : ''}`}
              style={activeCategory === cat ? { borderColor: CATEGORY_METAS[cat].color } : undefined}
              onClick={() => setActiveCategory(cat)}
            >
              {CATEGORY_METAS[cat].label} ({stats[cat]})
            </button>
          ))}
        </div>
        <button type="button" className="hh__btn hh__btn--ghost" onClick={handleClear}>
          清空筛选
        </button>
      </div>

      <div className="hh__ref-layout">
        {/* 左侧列表 */}
        <div className="hh__ref-list">
          {filtered.length === 0 ? (
            <div className="hh__empty">
              <p>未找到匹配的 Header</p>
              <button type="button" className="hh__btn hh__btn--ghost" onClick={handleClear}>
                清空筛选
              </button>
            </div>
          ) : (
            <ul>
              {filtered.map((h) => (
                <li
                  key={h.name}
                  className={`hh__ref-item ${selectedName === h.name ? 'is-active' : ''}`}
                >
                  <button
                    type="button"
                    className="hh__ref-btn"
                    onClick={() => setSelectedName(h.name)}
                    aria-pressed={selectedName === h.name}
                  >
                    <span className="hh__ref-name">{h.name}</span>
                    <span className="hh__ref-summary">{h.summary}</span>
                    <span
                      className="hh__ref-cat"
                      style={{ color: CATEGORY_METAS[h.category].color }}
                    >
                      {CATEGORY_METAS[h.category].label}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 右侧详情 */}
        <div className="hh__ref-detail">
          {!selected ? (
            <div className="hh__empty">
              <p>从左侧选择一个 Header 查看详情</p>
              <p className="hh__hint">共 {HTTP_HEADERS.length} 个常用 Header，覆盖 RFC 9110 核心字段</p>
            </div>
          ) : (
            <article>
              <header className="hh__ref-head">
                <h3 className="hh__ref-title">{selected.name}</h3>
                <span
                  className="hh__badge"
                  style={{ backgroundColor: CATEGORY_METAS[selected.category].color }}
                >
                  {CATEGORY_METAS[selected.category].label}
                </span>
                {selected.isRequestOnly && <span className="hh__badge hh__badge--req">仅请求头</span>}
                {selected.isResponseOnly && <span className="hh__badge hh__badge--resp">仅响应头</span>}
              </header>

              <p className="hh__ref-summary-lg">{selected.summary}</p>

              <section className="hh__field">
                <h4>语法</h4>
                <pre className="hh__code">{selected.syntax}</pre>
              </section>

              <section className="hh__field">
                <h4>示例</h4>
                <pre className="hh__code">
                  {selected.example}
                  <button
                    type="button"
                    className="hh__copy-btn"
                    onClick={() => handleCopy(selected.example, `ex-${selected.name}`)}
                    aria-label="复制示例"
                  >
                    {copiedField === `ex-${selected.name}` ? '已复制' : '复制'}
                  </button>
                </pre>
              </section>

              <section className="hh__field">
                <h4>说明</h4>
                <p className="hh__ref-desc">{selected.description}</p>
              </section>
            </article>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============== 解析器面板 ============== */
function ParserPanel() {
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<ReturnType<typeof parseHeaders> | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleParse = useCallback(() => {
    setParsed(parseHeaders(raw));
  }, [raw]);

  const handleSample = useCallback(() => {
    setRaw(SAMPLE_RAW);
    setParsed(parseHeaders(SAMPLE_RAW));
  }, []);

  const handleClear = useCallback(() => {
    setRaw('');
    setParsed(null);
  }, []);

  const handleCopy = useCallback(async (value: string, field: string) => {
    const ok = await copyText(value);
    if (ok) {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    }
  }, []);

  // 解析结果导出为标准 name: value 文本
  const exportText = useMemo(() => {
    if (!parsed || parsed.length === 0) return '';
    return parsed
      .filter((p) => p.name && !p.warning)
      .map((p) => `${p.name}: ${p.value}`)
      .join('\n');
  }, [parsed]);

  const warningCount = useMemo(
    () => (parsed ?? []).filter((p) => p.warning).length,
    [parsed],
  );

  return (
    <div className="hh__parser">
      <div className="hh__parser-layout">
        {/* 左侧输入区 */}
        <div className="hh__parser-input">
          <div className="hh__panel-head">
            <h3>原始 Header 文本</h3>
            <div className="hh__panel-actions">
              <button type="button" className="hh__btn hh__btn--ghost" onClick={handleSample}>
                示例
              </button>
              <button type="button" className="hh__btn hh__btn--ghost" onClick={handleClear}>
                清空
              </button>
              <button type="button" className="hh__btn hh__btn--primary" onClick={handleParse}>
                解析
              </button>
            </div>
          </div>
          <textarea
            className="hh__textarea"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={`粘贴 HTTP Header 原始文本，支持两种格式：\n\n1. 标准报文格式：\nHost: api.example.com\nUser-Agent: Mozilla/5.0\nAccept: application/json\n\n2. cURL 风格：\ncurl -X GET 'https://api.example.com' \\\n  -H 'Authorization: Bearer token' \\\n  -H 'Accept: application/json'`}
            rows={18}
            spellCheck={false}
          />
          <p className="hh__hint">
            支持标准报文格式与 cURL -H/--header 风格，自动跳过空行与注释，标记格式警告
          </p>
        </div>

        {/* 右侧解析结果 */}
        <div className="hh__parser-output">
          <div className="hh__panel-head">
            <h3>
              解析结果
              {parsed && (
                <span className="hh__count">
                  共 {parsed.filter((p) => !p.warning).length} 条
                  {warningCount > 0 && <span className="hh__warn-count">（{warningCount} 条警告）</span>}
                </span>
              )}
            </h3>
            {parsed && parsed.length > 0 && exportText && (
              <button
                type="button"
                className="hh__btn hh__btn--ghost"
                onClick={() => handleCopy(exportText, 'export')}
              >
                {copiedField === 'export' ? '已复制' : '复制全部'}
              </button>
            )}
          </div>

          {!parsed ? (
            <div className="hh__empty">
              <p>点击"解析"按钮查看结果</p>
            </div>
          ) : parsed.length === 0 ? (
            <div className="hh__empty">
              <p>未解析出任何 Header</p>
            </div>
          ) : (
            <table className="hh__table">
              <thead>
                <tr>
                  <th>行</th>
                  <th>名称</th>
                  <th>值</th>
                  <th>状态</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((p, idx) => (
                  <tr key={`${p.line}-${idx}`} className={p.warning ? 'is-warning' : ''}>
                    <td className="hh__td-line">{p.line}</td>
                    <td className="hh__td-name">{p.name}</td>
                    <td className="hh__td-value">
                      {p.value || <span className="hh__muted">（空）</span>}
                    </td>
                    <td className="hh__td-status">
                      {p.warning ? (
                        <span className="hh__warn" title={p.warning}>⚠</span>
                      ) : (
                        <span className="hh__ok">✓</span>
                      )}
                    </td>
                    <td>
                      {!p.warning && p.value && (
                        <button
                          type="button"
                          className="hh__copy-btn"
                          onClick={() => handleCopy(`${p.name}: ${p.value}`, `p-${idx}`)}
                          aria-label="复制此 Header"
                        >
                          {copiedField === `p-${idx}` ? '已复制' : '复制'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {parsed && warningCount > 0 && (
            <div className="hh__warn-list">
              <h4>警告详情</h4>
              <ul>
                {parsed
                  .filter((p) => p.warning)
                  .map((p, idx) => (
                    <li key={`w-${idx}`}>
                      <strong>第 {p.line} 行</strong>：{p.warning}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============== 生成器面板 ============== */
function GeneratorPanel() {
  const [url, setUrl] = useState('https://api.example.com/users');
  const [method, setMethod] = useState<string>('GET');
  const [headersText, setHeadersText] = useState('Accept: application/json\nAuthorization: Bearer token');
  const [body, setBody] = useState('');
  const [output, setOutput] = useState<OutputKind>('curl');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // 解析用户输入的 headers（实时）
  const parsed = useMemo(() => parseHeaders(headersText), [headersText]);
  const validHeaders = useMemo(() => parsed.filter((p) => p.name && !p.warning), [parsed]);

  // 生成代码
  const generatedCode = useMemo(() => {
    if (!url.trim()) return '// 请输入 URL';
    if (output === 'curl') {
      return buildCurlCommand(url, method, validHeaders, body);
    }
    return buildFetchCode(url, method, validHeaders, body);
  }, [url, method, validHeaders, body, output]);

  const handleCopy = useCallback(async (value: string, field: string) => {
    const ok = await copyText(value);
    if (ok) {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    }
  }, []);

  return (
    <div className="hh__gen">
      <div className="hh__gen-layout">
        {/* 左侧：配置区 */}
        <div className="hh__gen-config">
          <div className="hh__field-row">
            <label className="hh__label" htmlFor="hh-url">URL</label>
            <input
              id="hh-url"
              type="text"
              className="hh__input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.example.com/users"
            />
          </div>

          <div className="hh__field-row">
            <label className="hh__label" htmlFor="hh-method">方法</label>
            <select
              id="hh-method"
              className="hh__select"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              {HTTP_METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <div className="hh__field-row hh__field-row--col">
            <label className="hh__label" htmlFor="hh-headers">Headers（每行一个，name: value）</label>
            <textarea
              id="hh-headers"
              className="hh__textarea hh__textarea--sm"
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
              placeholder={'Content-Type: application/json\nAuthorization: Bearer token'}
              rows={8}
              spellCheck={false}
            />
            <p className="hh__hint">
              已识别 {validHeaders.length} 条有效 Header
            </p>
          </div>

          {method !== 'GET' && method !== 'HEAD' && (
            <div className="hh__field-row hh__field-row--col">
              <label className="hh__label" htmlFor="hh-body">Body（请求主体）</label>
              <textarea
                id="hh-body"
                className="hh__textarea hh__textarea--sm"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={'{"name": "test", "age": 18}'}
                rows={6}
                spellCheck={false}
              />
            </div>
          )}
        </div>

        {/* 右侧：代码输出 */}
        <div className="hh__gen-output">
          <div className="hh__panel-head">
            <div className="hh__output-tabs" role="group" aria-label="输出代码格式切换">
              <button
                type="button"
                className={`hh__output-tab ${output === 'curl' ? 'is-active' : ''}`}
                onClick={() => setOutput('curl')}
              >
                cURL
              </button>
              <button
                type="button"
                className={`hh__output-tab ${output === 'fetch' ? 'is-active' : ''}`}
                onClick={() => setOutput('fetch')}
              >
                JavaScript fetch
              </button>
            </div>
            <button
              type="button"
              className="hh__btn hh__btn--primary"
              onClick={() => handleCopy(generatedCode, 'gen-out')}
            >
              {copiedField === 'gen-out' ? '已复制' : '复制代码'}
            </button>
          </div>

          <pre className="hh__code hh__code--lg">{generatedCode}</pre>
        </div>
      </div>
    </div>
  );
}
