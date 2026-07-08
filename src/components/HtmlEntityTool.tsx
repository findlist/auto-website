import { useState, useMemo, useCallback, useEffect } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * HTML 实体编解码工具
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 编码：文本 → HTML 实体（三种模式：仅必要字符 / 命名实体优先 / 全部数字实体）
 *  - 解码：HTML 实体 → 文本（支持命名实体、十进制 &#NN; 与十六进制 &#xNN;）
 *  - 实时模式：边输入边转换
 *  - 常用实体速查表
 *  - 复制 / 清空 / 示例
 */

type Mode = 'encode' | 'decode';
type EncodeStyle = 'necessary' | 'named' | 'numeric';

interface Result {
  ok: boolean;
  value: string;
  error: string;
}

/** HTML 必编码字符：& < > " ' （XML/HTML 共通） */
const NECESSARY_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** 常用命名实体表（用于 named 模式优先匹配 + 速查表展示） */
const NAMED_ENTITIES: Array<{ char: string; name: string; code: string; desc: string }> = [
  { char: '&', name: '&amp;', code: '&#38;', desc: '与号' },
  { char: '<', name: '&lt;', code: '&#60;', desc: '小于号' },
  { char: '>', name: '&gt;', code: '&#62;', desc: '大于号' },
  { char: '"', name: '&quot;', code: '&#34;', desc: '双引号' },
  { char: "'", name: '&#39;', code: '&#39;', desc: '单引号' },
  { char: ' ', name: '&nbsp;', code: '&#160;', desc: '不换行空格' },
  { char: '©', name: '&copy;', code: '&#169;', desc: '版权符号' },
  { char: '®', name: '&reg;', code: '&#174;', desc: '注册商标' },
  { char: '™', name: '&trade;', code: '&#8482;', desc: '商标' },
  { char: '—', name: '&mdash;', code: '&#8212;', desc: '破折号（长）' },
  { char: '–', name: '&ndash;', code: '&#8211;', desc: '破折号（短）' },
  { char: '…', name: '&hellip;', code: '&#8230;', desc: '省略号' },
  { char: '«', name: '&laquo;', code: '&#171;', desc: '左书名号' },
  { char: '»', name: '&raquo;', code: '&#187;', desc: '右书名号' },
  { char: '·', name: '&middot;', code: '&#183;', desc: '中间点' },
  { char: '°', name: '&deg;', code: '&#176;', desc: '度' },
  { char: '±', name: '&plusmn;', code: '&#177;', desc: '加减号' },
  { char: '×', name: '&times;', code: '&#215;', desc: '乘号' },
  { char: '÷', name: '&divide;', code: '&#247;', desc: '除号' },
  { char: '€', name: '&euro;', code: '&#8364;', desc: '欧元' },
  { char: '£', name: '&pound;', code: '&#163;', desc: '英镑' },
  { char: '¥', name: '&yen;', code: '&#165;', desc: '日元 / 人民币' },
  { char: '¢', name: '&cent;', code: '&#162;', desc: '美分' },
  { char: '§', name: '&sect;', code: '&#167;', desc: '章节符' },
  { char: '¶', name: '&para;', code: '&#182;', desc: '段落符' },
  { char: '•', name: '&bull;', code: '&#8226;', desc: '项目符号' },
  { char: '→', name: '&rarr;', code: '&#8594;', desc: '右箭头' },
  { char: '←', name: '&larr;', code: '&#8592;', desc: '左箭头' },
  { char: '↑', name: '&uarr;', code: '&#8593;', desc: '上箭头' },
  { char: '↓', name: '&darr;', code: '&#8595;', desc: '下箭头' },
  { char: '★', name: '&starf;', code: '&#9733;', desc: '实心星' },
];

/** 字符 → 命名实体 反向映射（编码时优先用命名实体） */
const CHAR_TO_NAMED: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  NAMED_ENTITIES.forEach((e) => {
    // 仅当字符还未存在时写入，避免重复条目覆盖
    if (!(e.char in map)) map[e.char] = e.name;
  });
  return map;
})();

/**
 * XSS 攻击载荷示例（仅用于演示编码效果，不会实际执行）
 * 覆盖四种典型 XSS 注入向量：script 标签、事件处理器、伪协议、SVG
 */
const XSS_PAYLOADS: Array<{ label: string; value: string }> = [
  { label: 'script 注入', value: '<script>alert(document.cookie)</script>' },
  { label: 'onerror 事件', value: '<img src=x onerror=alert(1)>' },
  { label: 'javascript: 协议', value: '<a href="javascript:alert(1)">点击</a>' },
  { label: 'SVG onload', value: '<svg onload=alert(1)>' },
];

/**
 * XSS 上下文安全提示：HTML 实体编码在不同上下文的有效性
 * safe=安全 / danger=无效 / warn=需其他编码
 */
const XSS_CONTEXTS: Array<{
  context: string;
  example: string;
  level: 'safe' | 'danger' | 'warn';
  note: string;
}> = [
  {
    context: 'HTML 文本节点',
    example: '<div>用户输入</div>',
    level: 'safe',
    note: 'HTML 实体编码有效，& < > 被转义后浏览器只当文本显示，不会解析为标签。',
  },
  {
    context: 'HTML 属性值',
    example: '<input value="用户输入">',
    level: 'safe',
    note: 'HTML 实体编码有效，& < > " 被转义后无法逃逸属性引号，无法注入新属性。',
  },
  {
    context: '<script> 块内',
    example: '<script>var x = "用户输入";</script>',
    level: 'danger',
    note: 'HTML 实体无效！JS 引擎不识别实体。需用 JSON.stringify 并转义 </script> 序列。',
  },
  {
    context: '事件处理器内',
    example: '<button onclick="run(\'用户输入\')">',
    level: 'danger',
    note: 'HTML 实体无效！需 JS 字符串转义（\\ \' " \\n），并配合属性上下文编码。',
  },
  {
    context: 'href / src 属性',
    example: '<a href="用户输入">',
    level: 'warn',
    note: '需 URL 编码 + 协议白名单（拒绝 javascript: data: 等危险协议），仅靠 HTML 实体不够。',
  },
];

/**
 * 编码：文本 → HTML 实体
 * - necessary：仅 & < > " ' 转义
 * - named：上述必要字符 + 命名实体表中的字符优先用命名，其余非 ASCII 用数字实体
 * - numeric：所有非 ASCII（码点 > 127）+ 必要字符全部用数字实体
 */
function encodeEntities(text: string, style: EncodeStyle): Result {
  if (text === '') return { ok: true, value: '', error: '' };
  try {
    let out = '';
    for (const ch of text) {
      // 1. 必要字符始终转义（避免破坏 HTML 结构）
      if (NECESSARY_MAP[ch]) {
        out += NECESSARY_MAP[ch];
        continue;
      }
      const code = ch.codePointAt(0) || 0;
      // 2. ASCII 可见字符（32-126）保持原样
      if (code >= 32 && code <= 126) {
        out += ch;
        continue;
      }
      // 3. 非 ASCII 字符按模式处理
      if (style === 'numeric') {
        // 全部用十进制数字实体
        out += `&#${code};`;
      } else if (style === 'named') {
        // 命名实体表优先匹配，未命中则用十进制数字实体
        out += CHAR_TO_NAMED[ch] || `&#${code};`;
      } else {
        // necessary：非 ASCII 字符保持原样（仅做必要字符转义）
        out += ch;
      }
    }
    return { ok: true, value: out, error: '' };
  } catch (e) {
    return { ok: false, value: '', error: `编码失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * 解码：HTML 实体 → 文本
 * 支持：命名实体（&amp;）、十进制（&#NN;）、十六进制（&#xNN;）
 * 使用浏览器原生 DOMParser 解析，覆盖所有 HTML5 命名实体
 */
function decodeEntities(input: string): Result {
  if (input.trim() === '') return { ok: true, value: '', error: '' };
  // 简单校验：必须包含 & 与 ; 才可能是实体
  if (!input.includes('&')) {
    return { ok: false, value: '', error: '输入中未发现 & 字符，可能不包含 HTML 实体' };
  }
  try {
    // 使用 DOMParser 解析：将字符串放在 textarea 内，浏览器会自动解码所有实体
    const doc = new DOMParser().parseFromString(`<textarea>${input}</textarea>`, 'text/html');
    const ta = doc.querySelector('textarea');
    if (!ta) {
      return { ok: false, value: '', error: '解码失败：无法创建解析上下文' };
    }
    const decoded = ta.value;
    // 若解码后与输入完全相同，说明输入中没有有效实体
    if (decoded === input) {
      return { ok: false, value: '', error: '未发现可解码的 HTML 实体（输入可能已是普通文本）' };
    }
    return { ok: true, value: decoded, error: '' };
  } catch (e) {
    return { ok: false, value: '', error: `解码失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 统计字符数与行数 */
function computeStats(text: string) {
  const chars = text.length;
  const lines = chars === 0 ? 0 : text.split('\n').length;
  return { chars, lines };
}

const SAMPLE = '<a href="https://example.com">版权 © 2026 工具盒子</a>\n' +
  '特殊符号：™ ® ¥ € ★ → …\n' +
  'HTML 实体示例：&amp; &lt;div&gt; &quot;文本&quot; &#39;引号&#39;';

export default function HtmlEntityTool() {
  const [mode, setMode] = useState<Mode>('encode');
  const [input, setInput] = useState<string>('');
  const [output, setOutput] = useState<string>('');
  const [style, setStyle] = useState<EncodeStyle>('necessary');
  const [live, setLive] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [notice, setNotice] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState<string>('');
  // XSS 演示模块状态：默认载入第一个攻击载荷
  const [xssInput, setXssInput] = useState<string>(XSS_PAYLOADS[0].value);

  const inputStats = useMemo(() => computeStats(input), [input]);
  const outputStats = useMemo(() => computeStats(output), [output]);

  /** XSS 演示：用必要字符模式实时编码当前载荷，展示编码前后对比 */
  const xssEncoded = useMemo(() => encodeEntities(xssInput, 'necessary').value, [xssInput]);

  /** 速查表过滤（按字符、名称、描述模糊匹配） */
  const filteredEntities = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return NAMED_ENTITIES;
    return NAMED_ENTITIES.filter(
      (e) => e.char.toLowerCase().includes(q) || e.name.includes(q) || e.desc.toLowerCase().includes(q)
    );
  }, [filter]);

  /** 执行一次转换 */
  const runTransform = useCallback((text: string, m: Mode, s: EncodeStyle) => {
    const result = m === 'encode' ? encodeEntities(text, s) : decodeEntities(text);
    setOutput(result.value);
    setError(result.ok ? '' : result.error);
    setNotice('');
  }, []);

  /** 实时模式 */
  useEffect(() => {
    if (!live) return;
    runTransform(input, mode, style);
  }, [live, input, mode, style, runTransform]);

  /** 手动触发 */
  const handleRun = useCallback(() => {
    runTransform(input, mode, style);
  }, [input, mode, style, runTransform]);

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

  /** 复制单个实体（速查表用） */
  const handleCopyEntity = useCallback(async (value: string) => {
    const ok = await copyText(value);
    if (ok) {
      setNotice(`已复制 ${value}`);
      setTimeout(() => setNotice(''), 1500);
    } else {
      setNotice('复制失败');
    }
  }, []);

  /** 清空 */
  const handleClear = useCallback(() => {
    setInput('');
    setOutput('');
    setError('');
    setNotice('');
    setCopied(false);
  }, []);

  /** 载入示例 */
  const handleSample = useCallback(() => {
    // 示例根据当前模式自适应：编码模式给原始文本，解码模式给已编码文本
    if (mode === 'encode') {
      setInput(SAMPLE);
    } else {
      setInput('&lt;a href=&quot;https://example.com&quot;&gt;版权 &copy; 2026&lt;/a&gt;\n&amp; &lt; &gt; &quot; &#39; &#8482; &reg; &euro;');
    }
    setOutput('');
    setError('');
    setNotice('');
  }, [mode]);

  /** 切换模式时清空输出 */
  const onModeChange = useCallback((m: Mode) => {
    setMode(m);
    setOutput('');
    setError('');
    setNotice('');
    setCopied(false);
  }, []);

  /** 输入框变化时清空错误 */
  const onInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (error) setError('');
    if (notice) setNotice('');
  }, [error, notice]);

  // 标签与占位符随模式切换
  const inputLabel = mode === 'encode' ? '原始文本' : 'HTML 实体字符串';
  const outputLabel = mode === 'encode' ? 'HTML 实体结果' : '解码文本';
  const inputPlaceholder = mode === 'encode'
    ? '在此输入要编码的文本，特殊字符将被转为 HTML 实体'
    : '在此粘贴要解码的 HTML 实体字符串';
  const outputPlaceholder = '处理结果将显示在这里';

  return (
    <div className="jsontool entitytool">
      {/* 工具栏 */}
      <div className="jsontool__toolbar" role="toolbar" aria-label="HTML 实体操作">
        <div className="jsontool__actions">
          {/* 模式切换 */}
          <div className="entitytool__seg" role="group" aria-label="操作方向">
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
          {/* 编码风格选择：仅在编码模式下显示 */}
          {mode === 'encode' && (
            <label className="entitytool__select">
              <span className="visually-hidden">编码风格</span>
              <select value={style} onChange={(e) => setStyle(e.target.value as EncodeStyle)}>
                <option value="necessary">仅必要字符（&amp; &lt; &gt; &quot; &#39;）</option>
                <option value="named">命名实体优先（含 © ® ™ …）</option>
                <option value="numeric">全部数字实体（&#NN;）</option>
              </select>
            </label>
          )}
          {/* 实时模式开关 */}
          <label className="entitytool__toggle">
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

      {/* 编辑区 */}
      <div className="jsontool__panels">
        <div className="jsontool__panel">
          <label htmlFor="entity-input" className="jsontool__label">
            {inputLabel}
            <span className="jsontool__stat">{inputStats.chars} 字 · {inputStats.lines} 行</span>
          </label>
          <textarea
            id="entity-input"
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

      {/* 状态条 */}
      <div className="jsontool__status" role="status" aria-live="polite">
        {error ? (
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

      {/* 常用 HTML 实体速查表 */}
      <section className="entitytool__cheatsheet" aria-labelledby="cheatsheet-title">
        <div className="entitytool__cheatsheet-head">
          <h3 id="cheatsheet-title">常用 HTML 实体速查表</h3>
          <label className="entitytool__filter">
            <span className="visually-hidden">过滤实体</span>
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="按字符 / 名称 / 描述过滤…"
              autoComplete="off"
            />
          </label>
        </div>
        <div className="entitytool__entity-grid" role="list">
          {filteredEntities.map((e) => (
            <div key={e.name} className="entitytool__entity-card" role="listitem">
              <div className="entitytool__entity-char" aria-hidden="true">{e.char}</div>
              <div className="entitytool__entity-info">
                <div className="entitytool__entity-name">{e.name}</div>
                <div className="entitytool__entity-code">{e.code}</div>
                <div className="entitytool__entity-desc">{e.desc}</div>
              </div>
              <div className="entitytool__entity-actions">
                <button
                  className="btn btn--sm"
                  onClick={() => handleCopyEntity(e.name)}
                  aria-label={`复制命名实体 ${e.name}`}
                >
                  命名
                </button>
                <button
                  className="btn btn--sm"
                  onClick={() => handleCopyEntity(e.code)}
                  aria-label={`复制数字实体 ${e.code}`}
                >
                  数字
                </button>
              </div>
            </div>
          ))}
        </div>
        {filteredEntities.length === 0 && (
          <p className="entitytool__empty">未找到匹配的实体。</p>
        )}
      </section>

      {/* XSS 防御演示模块：仅展示编码效果，不实际执行任何脚本 */}
      <section className="entitytool__xss" aria-labelledby="xss-title">
        <div className="entitytool__xss-head">
          <h3 id="xss-title">XSS 防御演示</h3>
          <p className="entitytool__xss-intro">
            选择典型攻击载荷，查看 HTML 实体编码前后的差异。本演示<strong>不会执行任何脚本</strong>，仅展示文本编码效果与上下文安全提示。
          </p>
        </div>

        {/* 载荷选择按钮组 */}
        <div className="entitytool__xss-payloads" role="group" aria-label="XSS 载荷选择">
          {XSS_PAYLOADS.map((p) => (
            <button
              key={p.label}
              className={`btn btn--sm${xssInput === p.value ? ' btn--primary' : ''}`}
              aria-pressed={xssInput === p.value}
              onClick={() => setXssInput(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* 编码前后对比 */}
        <div className="entitytool__xss-compare">
          <div className="entitytool__xss-panel entitytool__xss-panel--danger">
            <div className="entitytool__xss-panel-head">
              <span className="entitytool__xss-badge entitytool__xss-badge--danger">⚠ 危险输入</span>
              <span className="entitytool__xss-panel-title">原始载荷</span>
            </div>
            <pre className="entitytool__xss-code"><code>{xssInput}</code></pre>
            <p className="entitytool__xss-panel-note">
              若直接 <code>innerHTML</code> 渲染，浏览器会执行其中的 JavaScript，导致 XSS。
            </p>
          </div>
          <div className="entitytool__xss-panel entitytool__xss-panel--safe">
            <div className="entitytool__xss-panel-head">
              <span className="entitytool__xss-badge entitytool__xss-badge--safe">✅ 编码后</span>
              <span className="entitytool__xss-panel-title">HTML 实体编码</span>
            </div>
            <pre className="entitytool__xss-code"><code>{xssEncoded}</code></pre>
            <p className="entitytool__xss-panel-note">
              <code>&lt;</code> <code>&gt;</code> <code>&quot;</code> <code>&#39;</code> 被转义后，浏览器仅当文本显示，不会解析为标签或脚本。
            </p>
          </div>
        </div>

        {/* 上下文安全提示表 */}
        <div className="entitytool__xss-contexts" role="region" aria-label="上下文安全提示">
          <h4 className="entitytool__xss-subtitle">HTML 实体编码在不同上下文的有效性</h4>
          <div className="entitytool__xss-context-list">
            {XSS_CONTEXTS.map((c) => (
              <div key={c.context} className={`entitytool__xss-context entitytool__xss-context--${c.level}`}>
                <div className="entitytool__xss-context-head">
                  <span className="entitytool__xss-context-label">
                    {c.level === 'safe' && '✅ 安全'}
                    {c.level === 'danger' && '❌ 无效'}
                    {c.level === 'warn' && '⚠ 需其他编码'}
                  </span>
                  <span className="entitytool__xss-context-name">{c.context}</span>
                </div>
                <code className="entitytool__xss-context-example">{c.example}</code>
                <p className="entitytool__xss-context-note">{c.note}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 安全提示 */}
        <p className="entitytool__xss-tip">
          💡 完整 XSS 防御需配合 CSP（内容安全策略）、输入校验、上下文相关编码。详见博客
          <a href="/blog/web-security-csp-xss-csrf">《前端安全实战：CSP、XSS、CSRF 防护全景指南》</a>。
        </p>
      </section>
    </div>
  );
}
