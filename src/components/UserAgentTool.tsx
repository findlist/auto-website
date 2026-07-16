/**
 * User-Agent 字符串解析工具组件
 *
 * 三标签页：解析器 / 速查表 / 示例库
 * - 解析器：输入 UA 字符串，实时展示浏览器/系统/设备/引擎/爬虫识别结果
 * - 速查表：内置主流浏览器/操作系统/引擎/爬虫速查数据
 * - 示例库：分类真实 UA 示例，点击「载入」一键填入解析器
 *
 * 设计要点：UA 输入状态提升到主组件，实现示例库 → 解析器的跨标签页载入。
 */

import { useState, useMemo, useCallback } from 'react';
import {
  parseUserAgent,
  formatSummary,
  toJson,
  BROWSER_REFERENCE,
  OS_REFERENCE,
  ENGINE_REFERENCE,
  BOT_REFERENCE,
  SAMPLE_UA_GROUPS,
  type ParsedUA,
} from '../utils/userAgent';
import { copyText } from '../utils/clipboard';

type Tab = 'parser' | 'reference' | 'samples';

/** 识别结果卡片：单条键值对 */
function InfoCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  if (!value) return null;
  return (
    <div className={`ua__info-card${highlight ? ' ua__info-card--hl' : ''}`}>
      <span className="ua__info-label">{label}</span>
      <span className="ua__info-value">{value}</span>
    </div>
  );
}

/** 爬虫分类中文映射 */
const BOT_CATEGORY_LABEL: Record<string, string> = {
  search: '搜索引擎',
  social: '社交平台',
  monitor: '监控服务',
  crawler: '通用爬虫',
  library: 'HTTP 库',
  feed: 'RSS 订阅',
  tool: '开发工具',
};

/** 设备类型中文映射 */
const DEVICE_TYPE_LABEL: Record<string, string> = {
  desktop: '桌面端',
  mobile: '手机',
  tablet: '平板',
  bot: '爬虫',
  unknown: '未知',
};

/** 解析器面板 */
function ParserPanel({ input, setInput }: { input: string; setInput: (v: string) => void }) {
  // 实时解析，避免按钮交互开销
  const parsed: ParsedUA = useMemo(() => parseUserAgent(input), [input]);
  const [copied, setCopied] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  const handleCopySummary = useCallback(async () => {
    const ok = await copyText(formatSummary(parsed));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [parsed]);

  const handleCopyJson = useCallback(async () => {
    const ok = await copyText(toJson(parsed));
    if (ok) {
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 1500);
    }
  }, [parsed]);

  const summary = formatSummary(parsed);
  const hasResult = !!parsed.ua;

  return (
    <div className="ua__parser">
      <div className="ua__parser-layout">
        <div className="ua__parser-input">
          <div className="ua__panel-head">
            <h3>输入 User-Agent</h3>
            <div className="ua__panel-actions">
              <button className="ua__btn ua__btn--ghost" onClick={() => setInput('')} type="button">
                清空
              </button>
            </div>
          </div>
          <textarea
            className="ua__textarea"
            placeholder="粘贴 User-Agent 字符串…&#10;示例：Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={8}
            spellCheck={false}
          />
          <p className="ua__hint">实时解析，无需点击按钮。可从「示例库」标签页载入真实 UA。</p>
        </div>

        <div className="ua__parser-output">
          <div className="ua__panel-head">
            <h3>解析结果</h3>
            {hasResult && (
              <div className="ua__panel-actions">
                <button className="ua__btn ua__btn--ghost" onClick={handleCopySummary} type="button">
                  {copied ? '已复制' : '复制摘要'}
                </button>
                <button className="ua__btn ua__btn--ghost" onClick={handleCopyJson} type="button">
                  {copiedJson ? '已复制' : '复制 JSON'}
                </button>
              </div>
            )}
          </div>

          {!hasResult ? (
            <div className="ua__empty">
              <p>等待输入 User-Agent 字符串…</p>
              <p className="ua__empty-sub">支持浏览器、移动设备、应用内 WebView、爬虫等全场景识别</p>
            </div>
          ) : (
            <div className="ua__result">
              <div className="ua__summary">{summary}</div>

              {parsed.isBot && parsed.bot ? (
                <div className="ua__bot-banner">
                  <span className="ua__bot-icon">🤖</span>
                  <div>
                    <strong>识别为爬虫 / 机器人</strong>
                    <span className="ua__bot-cat">
                      {parsed.bot.name} · {BOT_CATEGORY_LABEL[parsed.bot.category] ?? parsed.bot.category}
                    </span>
                  </div>
                </div>
              ) : null}

              <div className="ua__info-grid">
                {parsed.browser ? (
                  <InfoCard label="浏览器" value={`${parsed.browser.name} ${parsed.browser.version}`.trim()} highlight />
                ) : null}
                {parsed.os ? (
                  <InfoCard label="操作系统" value={`${parsed.os.name} ${parsed.os.version}`.trim()} />
                ) : null}
                {parsed.engine ? (
                  <InfoCard label="渲染引擎" value={`${parsed.engine.name} ${parsed.engine.version}`.trim()} />
                ) : null}
                <InfoCard label="设备类型" value={DEVICE_TYPE_LABEL[parsed.device.type]} />
                {parsed.device.vendor ? <InfoCard label="厂商" value={parsed.device.vendor} /> : null}
                {parsed.device.model ? <InfoCard label="型号" value={parsed.device.model} /> : null}
                <InfoCard label="移动端" value={parsed.isMobile ? '是' : '否'} />
                <InfoCard label="桌面端" value={parsed.isDesktop ? '是' : '否'} />
              </div>

              <details className="ua__raw">
                <summary>查看原始 UA 与 JSON</summary>
                <code className="ua__raw-ua">{parsed.ua}</code>
                <pre className="ua__raw-json">{toJson(parsed)}</pre>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 速查表面板：四组卡片表格 */
function ReferencePanel() {
  const [filter, setFilter] = useState<'browser' | 'os' | 'engine' | 'bot'>('browser');
  const TABS: { key: typeof filter; label: string }[] = [
    { key: 'browser', label: `浏览器 (${BROWSER_REFERENCE.length})` },
    { key: 'os', label: `操作系统 (${OS_REFERENCE.length})` },
    { key: 'engine', label: `渲染引擎 (${ENGINE_REFERENCE.length})` },
    { key: 'bot', label: `爬虫与工具 (${BOT_REFERENCE.length})` },
  ];

  return (
    <div className="ua__reference">
      <div className="ua__ref-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`ua__ref-tab${filter === t.key ? ' is-active' : ''}`}
            onClick={() => setFilter(t.key)}
            type="button"
          >
            {t.label}
          </button>
        ))}
      </div>

      {filter === 'browser' && (
        <div className="ua__ref-grid">
          {BROWSER_REFERENCE.map((b) => (
            <article key={b.name} className="ua__ref-item">
              <header>
                <h4>{b.name}</h4>
                <span className="ua__tag">{b.engine}</span>
                <span className="ua__tag ua__tag--muted">{b.vendor}</span>
              </header>
              <p>{b.summary}</p>
            </article>
          ))}
        </div>
      )}

      {filter === 'os' && (
        <div className="ua__ref-grid">
          {OS_REFERENCE.map((o) => (
            <article key={o.name} className="ua__ref-item">
              <header>
                <h4>{o.name}</h4>
                <span className="ua__tag">{o.family}</span>
                <span className="ua__tag ua__tag--muted">{o.vendor}</span>
              </header>
              <p>{o.summary}</p>
            </article>
          ))}
        </div>
      )}

      {filter === 'engine' && (
        <div className="ua__ref-grid">
          {ENGINE_REFERENCE.map((e) => (
            <article key={e.name} className="ua__ref-item">
              <header>
                <h4>{e.name}</h4>
                <span className="ua__tag ua__tag--muted">{e.vendor}</span>
              </header>
              <p>{e.summary}</p>
            </article>
          ))}
        </div>
      )}

      {filter === 'bot' && (
        <div className="ua__ref-grid">
          {BOT_REFERENCE.map((b) => (
            <article key={b.name} className="ua__ref-item">
              <header>
                <h4>{b.name}</h4>
                <span className="ua__tag">{b.category}</span>
                <span className="ua__tag ua__tag--muted">{b.owner}</span>
              </header>
              <p>{b.summary}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/** 示例库面板：载入与复制 */
function SamplesPanel({ onLoad }: { onLoad: (ua: string) => void }) {
  const [copiedKey, setCopiedKey] = useState<string>('');

  const handleCopy = useCallback(async (ua: string, key: string) => {
    const ok = await copyText(ua);
    if (ok) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(''), 1500);
    }
  }, []);

  return (
    <div className="ua__samples">
      <p className="ua__samples-tip">
        点击「载入」可将示例 UA 填入解析器并自动切换标签页；点击「复制」仅复制到剪贴板。
      </p>
      {SAMPLE_UA_GROUPS.map((group) => (
        <section key={group.group} className="ua__sample-group">
          <h3>{group.group}</h3>
          <div className="ua__sample-list">
            {group.samples.map((s, i) => {
              const key = `${group.group}-${i}`;
              return (
                <article key={key} className="ua__sample-item">
                  <div className="ua__sample-head">
                    <span className="ua__sample-label">{s.label}</span>
                    <div className="ua__sample-actions">
                      <button
                        className="ua__btn ua__btn--ghost ua__btn--sm"
                        onClick={() => handleCopy(s.ua, key)}
                        type="button"
                      >
                        {copiedKey === key ? '已复制' : '复制'}
                      </button>
                      <button
                        className="ua__btn ua__btn--primary ua__btn--sm"
                        onClick={() => onLoad(s.ua)}
                        type="button"
                      >
                        载入
                      </button>
                    </div>
                  </div>
                  <code className="ua__sample-ua">{s.ua}</code>
                  <p className="ua__sample-note">{s.note}</p>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/** 主组件：三标签页切换，UA 输入状态提升 */
export default function UserAgentTool() {
  const [tab, setTab] = useState<Tab>('parser');
  const [input, setInput] = useState('');
  const TABS: { key: Tab; label: string }[] = [
    { key: 'parser', label: '解析器' },
    { key: 'reference', label: '速查表' },
    { key: 'samples', label: '示例库' },
  ];

  // 示例库载入：填入 UA 并切换到解析器
  const handleLoad = useCallback((ua: string) => {
    setInput(ua);
    setTab('parser');
  }, []);

  return (
    <div className="ua__container">
      <div className="ua__tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`ua__tab${tab === t.key ? ' is-active' : ''}`}
            onClick={() => setTab(t.key)}
            type="button"
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'parser' && <ParserPanel input={input} setInput={setInput} />}
      {tab === 'reference' && <ReferencePanel />}
      {tab === 'samples' && <SamplesPanel onLoad={handleLoad} />}
    </div>
  );
}
