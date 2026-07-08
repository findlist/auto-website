import { useState, useMemo, useCallback, useEffect } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * URL 工具
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 两个视图：
 *  - codec：编解码（encodeURI / encodeURIComponent，含解码）
 *  - parse：URL 解析视图，展示 protocol/host/pathname/search/hash 各部分与查询参数表格
 */

type Mode = 'encode' | 'decode';
type Granularity = 'component' | 'uri';
type ViewMode = 'codec' | 'parse';

interface Result {
  ok: boolean;
  value: string;
  error: string;
}

/** URL 各组成部分 */
interface UrlParts {
  href: string;
  protocol: string;
  origin: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  username: string;
  password: string;
}

interface ParseResult {
  ok: boolean;
  parts: UrlParts | null;
  params: [string, string][] | null;
  error: string;
}

/** URL 编码：根据粒度选择 encodeURI 或 encodeURIComponent */
function encodeUrl(text: string, granularity: Granularity): Result {
  if (text === '') return { ok: true, value: '', error: '' };
  try {
    const value = granularity === 'component'
      ? encodeURIComponent(text)
      : encodeURI(text);
    return { ok: true, value, error: '' };
  } catch (e) {
    return { ok: false, value: '', error: `编码失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

/** URL 解码：自动兼容 decodeURIComponent，可处理 + 与 %20 两种空格 */
function decodeUrl(input: string, granularity: Granularity): Result {
  if (input.trim() === '') return { ok: true, value: '', error: '' };
  try {
    // application/x-www-form-urlencoded 用 + 表示空格，先统一为 %20
    const normalized = input.replace(/\+/g, '%20');
    const value = granularity === 'component'
      ? decodeURIComponent(normalized)
      : decodeURI(normalized);
    return { ok: true, value, error: '' };
  } catch (e) {
    return {
      ok: false,
      value: '',
      error: `解码失败：输入可能包含非法的百分号编码（${e instanceof Error ? e.message : String(e)}）`,
    };
  }
}

/** 解析 URL，使用浏览器原生 URL 对象，提取各组成部分与查询参数 */
function parseUrl(input: string): ParseResult {
  if (input.trim() === '') return { ok: true, parts: null, params: null, error: '' };
  try {
    // 原生 URL 对无协议的输入会抛错，常见用户输入缺少协议时尝试补 https://
    let raw = input.trim();
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      // 缺少协议时补 https:// 重试一次（仅对看起来像域名的输入）
      if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
        url = new URL('https://' + raw);
      } else {
        throw new Error('无效的 URL');
      }
    }
    const parts: UrlParts = {
      href: url.href,
      protocol: url.protocol,
      origin: url.origin,
      host: url.host,
      hostname: url.hostname,
      port: url.port,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      username: url.username,
      password: url.password,
    };
    const params: [string, string][] = [];
    url.searchParams.forEach((value, key) => params.push([key, value]));
    return { ok: true, parts, params, error: '' };
  } catch (e) {
    return { ok: false, parts: null, params: null, error: `URL 解析失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 统计字符数与行数 */
function computeStats(text: string) {
  const chars = text.length;
  const lines = chars === 0 ? 0 : text.split('\n').length;
  return { chars, lines };
}


const SAMPLE = 'https://toolbox.example.com/search?q=工具盒子&lang=zh-CN&from=工具站';
const PARSE_SAMPLE = 'https://toolbox.example.com:8443/blog/json-formatting-guide?tag=JavaScript&page=2&sort=desc#comment-3';

export default function UrlTool() {
  const [viewMode, setViewMode] = useState<ViewMode>('codec');

  // 编解码视图状态
  const [mode, setMode] = useState<Mode>('encode');
  const [input, setInput] = useState<string>('');
  const [output, setOutput] = useState<string>('');
  const [granularity, setGranularity] = useState<Granularity>('component');
  const [live, setLive] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [notice, setNotice] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // 解析视图状态
  const [parseInput, setParseInput] = useState<string>('');
  const [copiedField, setCopiedField] = useState<string>('');

  const inputStats = useMemo(() => computeStats(input), [input]);
  const outputStats = useMemo(() => computeStats(output), [output]);

  // 解析结果（实时计算）
  const parseResult = useMemo(() => parseUrl(parseInput), [parseInput]);

  /** 执行一次编解码转换 */
  const runTransform = useCallback((text: string, m: Mode, g: Granularity) => {
    const result = m === 'encode' ? encodeUrl(text, g) : decodeUrl(text, g);
    setOutput(result.value);
    setError(result.ok ? '' : result.error);
    setNotice('');
  }, []);

  /** 实时模式：输入或参数变化时自动转换 */
  useEffect(() => {
    if (viewMode !== 'codec' || !live) return;
    runTransform(input, mode, granularity);
  }, [live, input, mode, granularity, runTransform, viewMode]);

  /** 手动触发（关闭实时模式时使用） */
  const handleRun = useCallback(() => {
    runTransform(input, mode, granularity);
  }, [input, mode, granularity, runTransform]);

  /** 复制编解码输出 */
  const handleCopy = useCallback(async () => {
    if (!output) return;
    const ok = await copyText(output);
    setCopied(ok);
    setNotice(ok ? '已复制到剪贴板' : '复制失败，请手动选中复制');
    if (ok) setTimeout(() => setCopied(false), 1500);
  }, [output]);

  /** 复制解析视图的某个字段 */
  const handleCopyField = useCallback(async (text: string, field: string) => {
    if (!text) return;
    const ok = await copyText(text);
    if (ok) {
      setCopiedField(field);
      setNotice('已复制到剪贴板');
      setTimeout(() => {
        setCopiedField('');
        setNotice('');
      }, 1500);
    } else {
      setNotice('复制失败，请手动选中复制');
    }
  }, []);

  /** 清空编解码区 */
  const handleClear = useCallback(() => {
    setInput('');
    setOutput('');
    setError('');
    setNotice('');
    setCopied(false);
  }, []);

  /** 载入编解码示例 */
  const handleSample = useCallback(() => {
    setInput(SAMPLE);
    setOutput('');
    setError('');
    setNotice('');
  }, []);

  /** 载入解析示例 */
  const handleParseSample = useCallback(() => {
    setParseInput(PARSE_SAMPLE);
    setNotice('');
  }, []);

  /** 清空解析区 */
  const handleParseClear = useCallback(() => {
    setParseInput('');
    setNotice('');
    setCopiedField('');
  }, []);

  /** 切换编解码模式时清空输出，避免误用旧结果 */
  const onModeChange = useCallback((m: Mode) => {
    setMode(m);
    setOutput('');
    setError('');
    setNotice('');
    setCopied(false);
  }, []);

  /** 输入框变化时同步清空错误 */
  const onInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (error) setError('');
    if (notice) setNotice('');
  }, [error, notice]);

  /** 切换视图时清空通知 */
  const onViewModeChange = useCallback((v: ViewMode) => {
    setViewMode(v);
    setNotice('');
    setCopied(false);
    setCopiedField('');
  }, []);

  // 标签与占位符随模式切换
  const inputLabel = mode === 'encode' ? '原始文本 / URL' : '已编码字符串';
  const outputLabel = mode === 'encode' ? '编码结果' : '解码结果';
  const inputPlaceholder = mode === 'encode'
    ? '在此输入要编码的文本或完整 URL'
    : '在此粘贴要解码的百分号编码字符串';
  const outputPlaceholder = '处理结果将显示在这里';

  // 解析视图各部分展示列表（part -> label）
  const partRows: { key: keyof UrlParts; label: string }[] = [
    { key: 'href', label: '完整 URL' },
    { key: 'protocol', label: '协议 Protocol' },
    { key: 'origin', label: '源 Origin' },
    { key: 'host', label: '主机+端口 Host' },
    { key: 'hostname', label: '主机名 Hostname' },
    { key: 'port', label: '端口 Port' },
    { key: 'pathname', label: '路径 Pathname' },
    { key: 'search', label: '查询串 Search' },
    { key: 'hash', label: '锚点 Hash' },
    { key: 'username', label: '用户名 Username' },
    { key: 'password', label: '密码 Password' },
  ];

  return (
    <div className="jsontool urltool">
      {/* 视图切换 Tab */}
      <div className="urltool__view-tabs" role="tablist" aria-label="URL 工具视图切换">
        <button
          role="tab"
          className={`urltool__view-tab${viewMode === 'codec' ? ' is-active' : ''}`}
          aria-selected={viewMode === 'codec'}
          onClick={() => onViewModeChange('codec')}
        >
          编解码
        </button>
        <button
          role="tab"
          className={`urltool__view-tab${viewMode === 'parse' ? ' is-active' : ''}`}
          aria-selected={viewMode === 'parse'}
          onClick={() => onViewModeChange('parse')}
        >
          URL 解析
        </button>
      </div>

      {/* 编解码视图 */}
      {viewMode === 'codec' && (
        <>
          <div className="jsontool__toolbar" role="toolbar" aria-label="URL 编解码操作">
            <div className="jsontool__actions">
              <div className="b64tool__seg" role="group" aria-label="操作方向">
                <button
                  className={`btn btn--sm${mode === 'encode' ? ' btn--primary' : ''}`}
                  aria-pressed={mode === 'encode'}
                  onClick={() => onModeChange('encode')}
                >
                  编码
                </button>
                <button
                  className={`btn btn--sm${mode === 'decode' ? ' btn--primary' : ''}`}
                  aria-pressed={mode === 'decode'}
                  onClick={() => onModeChange('decode')}
                >
                  解码
                </button>
              </div>
              {!live && (
                <button className="btn btn--primary btn--sm" onClick={handleRun}>转换</button>
              )}
            </div>
            <div className="jsontool__options">
              <label className="urltool__seg-label">
                <span className="urltool__seg-text">粒度</span>
                <select
                  value={granularity}
                  onChange={(e) => setGranularity(e.target.value as Granularity)}
                  aria-label="编码粒度"
                >
                  <option value="component">完整编码（含 / ? : @ & = + $ #）</option>
                  <option value="uri">保留 URL 结构</option>
                </select>
              </label>
              <label className="b64tool__toggle">
                <input
                  type="checkbox"
                  checked={live}
                  onChange={(e) => setLive(e.target.checked)}
                />
                <span>实时转换</span>
              </label>
              <button className="btn btn--sm" onClick={handleSample}>示例</button>
              <button className="btn btn--sm" onClick={handleClear}>清空</button>
            </div>
          </div>

          <div className="jsontool__panels">
            <div className="jsontool__panel">
              <label htmlFor="url-input" className="jsontool__label">
                {inputLabel}
                <span className="jsontool__stat">{inputStats.chars} 字 · {inputStats.lines} 行</span>
              </label>
              <textarea
                id="url-input"
                className="jsontool__textarea"
                value={input}
                onChange={onInputChange}
                placeholder={inputPlaceholder}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                aria-label={inputLabel}
              />
            </div>
            <div className="jsontool__panel">
              <div className="jsontool__label">
                <span>{outputLabel}</span>
                <span className="jsontool__stat">{outputStats.chars} 字 · {outputStats.lines} 行</span>
                <button
                  className="btn btn--sm jsontool__copy"
                  onClick={handleCopy}
                  disabled={!output}
                  aria-label="复制输出"
                >
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
              <textarea
                className="jsontool__textarea jsontool__textarea--output"
                value={output}
                readOnly
                placeholder={outputPlaceholder}
                spellCheck={false}
                aria-label={outputLabel}
              />
            </div>
          </div>
        </>
      )}

      {/* URL 解析视图 */}
      {viewMode === 'parse' && (
        <>
          <div className="jsontool__toolbar" role="toolbar" aria-label="URL 解析操作">
            <div className="jsontool__actions">
              <button className="btn btn--primary btn--sm" onClick={handleParseSample}>示例</button>
              <button className="btn btn--sm" onClick={handleParseClear}>清空</button>
            </div>
            <div className="jsontool__options">
              <span className="urltool__seg-text">基于浏览器原生 URL 对象解析</span>
            </div>
          </div>

          <div className="jsontool__panels">
            <div className="jsontool__panel">
              <label htmlFor="url-parse-input" className="jsontool__label">
                输入要解析的 URL
                <span className="jsontool__stat">{parseInput.length} 字</span>
              </label>
              <textarea
                id="url-parse-input"
                className="jsontool__textarea"
                value={parseInput}
                onChange={(e) => { setParseInput(e.target.value); if (notice) setNotice(''); }}
                placeholder="例如：https://example.com:8080/path?key=value#hash"
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                aria-label="输入要解析的 URL"
              />
            </div>
          </div>

          {/* 解析结果 */}
          {parseInput.trim() === '' ? (
            <div className="jsontool__status" role="status">
              <div className="jsontool__hint">输入完整 URL 后，自动展示各组成部分与查询参数。</div>
            </div>
          ) : !parseResult.ok ? (
            <div className="jsontool__status" role="status" aria-live="polite">
              <div className="jsontool__error">
                <strong>❌ 错误</strong>
                <span>{parseResult.error}</span>
              </div>
            </div>
          ) : parseResult.parts ? (
            <div className="urltool__parse-result" aria-live="polite">
              {/* 各组成部分表格 */}
              <h3 className="urltool__parse-title">URL 组成部分</h3>
              <ul className="urltool__parts">
                {partRows.map(({ key, label }) => {
                  const val = parseResult.parts![key];
                  // 密码字段非空时显示为掩码提示，但仍可复制（避免明文泄漏）
                  const isPassword = key === 'password';
                  const display = isPassword && val ? '•••••（已隐藏，可复制）' : val;
                  const isEmpty = val === '';
                  return (
                    <li key={key} className={`urltool__part${isEmpty ? ' is-empty' : ''}`}>
                      <span className="urltool__part-label">{label}</span>
                      <code className="urltool__part-value">{isEmpty ? '（空）' : display}</code>
                      {!isEmpty && (
                        <button
                          className="btn btn--sm"
                          onClick={() => handleCopyField(val, key)}
                          aria-label={`复制${label}`}
                        >
                          {copiedField === key ? '已复制' : '复制'}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>

              {/* 查询参数表格 */}
              <h3 className="urltool__parse-title">
                查询参数
                {parseResult.params && parseResult.params.length > 0 && (
                  <span className="urltool__parse-count">（{parseResult.params.length} 个）</span>
                )}
              </h3>
              {!parseResult.params || parseResult.params.length === 0 ? (
                <p className="urltool__parse-empty">该 URL 没有查询参数。</p>
              ) : (
                <div className="urltool__params-table" role="table" aria-label="查询参数列表">
                  <div className="urltool__params-row urltool__params-row--head" role="row">
                    <span role="columnheader">键 Key</span>
                    <span role="columnheader">值 Value</span>
                    <span role="columnheader">操作</span>
                  </div>
                  {parseResult.params.map(([key, value], idx) => (
                    <div key={`${key}-${idx}`} className="urltool__params-row" role="row">
                      <span role="cell" className="urltool__params-key">{key}</span>
                      <span role="cell" className="urltool__params-value">{value}</span>
                      <span role="cell">
                        <button
                          className="btn btn--sm"
                          onClick={() => handleCopyField(`${key}=${value}`, `param-${idx}`)}
                          aria-label={`复制参数 ${key}`}
                        >
                          {copiedField === `param-${idx}` ? '已复制' : '复制'}
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </>
      )}

      {/* 状态条 */}
      <div className="jsontool__status" role="status" aria-live="polite">
        {viewMode === 'codec' && error ? (
          <div className="jsontool__error">
            <strong>❌ 错误</strong>
            <span>{error}</span>
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
