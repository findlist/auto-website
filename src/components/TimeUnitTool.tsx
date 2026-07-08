import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';
import {
  TIME_UNITS,
  convertAll,
  parseDuration,
  formatHuman,
  formatNumber,
  listUnits,
  type UnitId,
  type ParseResult,
} from '../utils/timeUnit';

/**
 * 时间单位换算器
 *
 * 三大功能模块：
 *  1. 单值换算：输入数值 + 源单位，实时展示 8 个单位的换算结果
 *  2. 时长解析：输入复合字符串（如「1h 30min」「2天3小时」），解析为累计毫秒与人类可读表示
 *  3. 毫秒→人类可读：输入毫秒数，输出中文复合表示
 *
 * 设计原则：
 *  - 单页布局无 Tab 切换，三大功能并列展示，便于横向对比
 *  - 月年采用 Gregorian 平均值换算，UI 明确标注「近似」徽章
 *  - 所有计算实时进行，无提交按钮
 */
export default function TimeUnitTool() {
  // ===== 模块 1：单值换算 =====
  const [value, setValue] = useState<string>('1');
  const [fromUnit, setFromUnit] = useState<UnitId>('h');

  // ===== 模块 2：时长解析 =====
  const [durationInput, setDurationInput] = useState<string>('1h 30min');

  // ===== 模块 3：毫秒→人类可读 =====
  const [msInput, setMsInput] = useState<string>('90610000');
  const [maxParts, setMaxParts] = useState<number>(3);

  // 通用状态
  const [copied, setCopied] = useState<string>('');
  const [notice, setNotice] = useState<string>('');

  const units = useMemo(() => listUnits(), []);

  // 模块 1：单值换算结果
  const allConversions = useMemo(() => {
    const v = parseFloat(value);
    if (!Number.isFinite(v)) return null;
    return convertAll(v, fromUnit);
  }, [value, fromUnit]);

  // 模块 2：时长解析结果
  const parseResult: ParseResult = useMemo(
    () => parseDuration(durationInput, 's'),
    [durationInput],
  );

  // 模块 3：毫秒→人类可读
  const humanReadable = useMemo(() => {
    const ms = parseFloat(msInput);
    if (!Number.isFinite(ms)) return '无效输入';
    return formatHuman(ms, maxParts);
  }, [msInput, maxParts]);

  /** 通用复制 */
  const handleCopy = useCallback(async (key: string, text: string, label: string) => {
    const ok = await copyText(text);
    if (ok) {
      setCopied(key);
      setNotice(`已复制${label}到剪贴板`);
      setTimeout(() => {
        setCopied('');
        setNotice('');
      }, 1500);
    } else {
      setNotice('复制失败，请手动选中复制');
    }
  }, []);

  /** 快速填充示例 */
  const fillExample = useCallback(() => {
    setDurationInput('2天3小时30分');
    setNotice('已填入示例：2天3小时30分');
    setTimeout(() => setNotice(''), 1500);
  }, []);

  return (
    <div className="tu">
      {/* ===== 模块 1：单值换算 ===== */}
      <section className="tu__section" aria-labelledby="tu-convert-title">
        <h2 id="tu-convert-title" className="tu__section-title">单位换算</h2>
        <p className="tu__section-desc">
          输入一个数值与源单位，实时查看它在 8 个时间单位下的对应值。
        </p>

        <div className="tu__input-bar">
          <label className="tu__field tu__field--value">
            <span>数值</span>
            <input
              type="number"
              step="any"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label="输入数值"
              placeholder="如 1"
            />
          </label>
          <label className="tu__field tu__field--unit">
            <span>源单位</span>
            <select
              value={fromUnit}
              onChange={(e) => setFromUnit(e.target.value as UnitId)}
              aria-label="源单位"
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}（{u.short}）
                </option>
              ))}
            </select>
          </label>
        </div>

        {!allConversions && (
          <div className="tu__error" role="alert">
            数值无效，请输入有效的数字（如 1、1.5、-60）。
          </div>
        )}

        {allConversions && (
          <div className="tu__grid" role="list">
            {units.map((u) => {
              const v = allConversions[u.id];
              const isSource = u.id === fromUnit;
              const copyKey = `conv-${u.id}`;
              const text = formatNumber(v);
              return (
                <div
                  className={`tu__card${isSource ? ' tu__card--source' : ''}`}
                  role="listitem"
                  key={u.id}
                >
                  <div className="tu__card-head">
                    <span className="tu__card-label">{u.label}</span>
                    <code className="tu__card-short">{u.short}</code>
                    {u.calendar && (
                      <span className="tu__approx-badge" title="日历单位，长度可变，使用平均值近似">
                        近似
                      </span>
                    )}
                    {isSource && <span className="tu__source-badge">源</span>}
                  </div>
                  <div className="tu__card-value" title={String(v)}>
                    {text}
                  </div>
                  <button
                    className="tu__copy-btn"
                    onClick={() => handleCopy(copyKey, text, `${u.label}换算值`)}
                    aria-label={`复制${u.label}换算值`}
                  >
                    {copied === copyKey ? '✓ 已复制' : '复制'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ===== 模块 2：时长解析 ===== */}
      <section className="tu__section" aria-labelledby="tu-parse-title">
        <h2 id="tu-parse-title" className="tu__section-title">时长解析</h2>
        <p className="tu__section-desc">
          输入复合时长字符串（如「1h 30min」「2天3小时」「500ms」），自动解析为累计毫秒与人类可读表示。支持中英文混用、小数、空格可选。
        </p>

        <div className="tu__input-bar">
          <label className="tu__field tu__field--duration">
            <span>时长字符串</span>
            <input
              type="text"
              value={durationInput}
              onChange={(e) => setDurationInput(e.target.value)}
              aria-label="时长字符串"
              placeholder="如 1h 30min 或 2天3小时"
            />
          </label>
          <button className="btn btn--sm" onClick={fillExample} aria-label="填入示例">
            示例
          </button>
        </div>

        {!parseResult.valid && durationInput.trim() && (
          <div className="tu__error" role="alert">
            无法识别该时长字符串。
            {parseResult.unknown.length > 0 && (
              <span> 未识别片段：{parseResult.unknown.map((s) => `"${s}"`).join('、')}</span>
            )}
          </div>
        )}

        {parseResult.valid && (
          <>
            <div className="tu__parse-summary">
              <div className="tu__parse-row">
                <span className="tu__parse-label">累计毫秒</span>
                <code className="tu__parse-value">{parseResult.ms}</code>
                <button
                  className="tu__copy-btn"
                  onClick={() => handleCopy('parse-ms', String(parseResult.ms), '累计毫秒')}
                  aria-label="复制累计毫秒"
                >
                  {copied === 'parse-ms' ? '✓' : '复制'}
                </button>
              </div>
              <div className="tu__parse-row">
                <span className="tu__parse-label">人类可读</span>
                <code className="tu__parse-value">{formatHuman(parseResult.ms)}</code>
                <button
                  className="tu__copy-btn"
                  onClick={() => handleCopy('parse-human', formatHuman(parseResult.ms), '人类可读表示')}
                  aria-label="复制人类可读表示"
                >
                  {copied === 'parse-human' ? '✓' : '复制'}
                </button>
              </div>
            </div>

            {parseResult.parts.length > 0 && (
              <div className="tu__parse-parts">
                <div className="tu__parse-parts-title">逐项明细</div>
                <ul role="list">
                  {parseResult.parts.map((p, i) => {
                    const def = TIME_UNITS.find((u) => u.id === p.unit)!;
                    const partMs = p.value * def.factorMs;
                    return (
                      <li key={i} className="tu__parse-part">
                        <span className="tu__part-value">{p.value}</span>
                        <span className="tu__part-unit">{def.label}</span>
                        <span className="tu__part-arrow">→</span>
                        <code className="tu__part-ms">{formatNumber(partMs)} ms</code>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {parseResult.unknown.length > 0 && (
              <div className="tu__warn">
                部分片段未识别：{parseResult.unknown.map((s) => `"${s}"`).join('、')}（已忽略）
              </div>
            )}
          </>
        )}
      </section>

      {/* ===== 模块 3：毫秒→人类可读 ===== */}
      <section className="tu__section" aria-labelledby="tu-human-title">
        <h2 id="tu-human-title" className="tu__section-title">毫秒转人类可读</h2>
        <p className="tu__section-desc">
          输入毫秒数，输出复合中文表示。适用于日志时间差、缓存 TTL、超时配置的可读化展示。
        </p>

        <div className="tu__input-bar">
          <label className="tu__field tu__field--ms">
            <span>毫秒数</span>
            <input
              type="number"
              step="any"
              value={msInput}
              onChange={(e) => setMsInput(e.target.value)}
              aria-label="毫秒数"
              placeholder="如 90610000"
            />
          </label>
          <label className="tu__field tu__field--parts">
            <span>最大片段数</span>
            <select
              value={maxParts}
              onChange={(e) => setMaxParts(Number(e.target.value))}
              aria-label="最大片段数"
            >
              <option value={2}>2（紧凑）</option>
              <option value={3}>3（默认）</option>
              <option value={4}>4（详细）</option>
              <option value={8}>全部</option>
            </select>
          </label>
        </div>

        <div className="tu__human-result">
          <code className="tu__human-value">{humanReadable}</code>
          <button
            className="tu__copy-btn"
            onClick={() => handleCopy('human', humanReadable, '人类可读表示')}
            aria-label="复制人类可读表示"
          >
            {copied === 'human' ? '✓ 已复制' : '复制'}
          </button>
        </div>
      </section>

      {/* 联动链接 */}
      <div className="tu__links">
        <a href="/timestamp" className="tu__link">→ Unix 时间戳转换</a>
        <a href="/timezone" className="tu__link">→ 时区转换器</a>
        <a href="/cron" className="tu__link">→ CRON 表达式解析器</a>
      </div>

      {/* 状态条 */}
      <div className="tu__status" role="status" aria-live="polite">
        {notice ? (
          <div className="tu__notice">{notice}</div>
        ) : (
          <div className="tu__hint">
            月与年采用 Gregorian 历法平均值（1 年 = 365.2425 天，1 月 ≈ 30.44 天）近似换算，所有计算在浏览器本地完成。
          </div>
        )}
      </div>
    </div>
  );
}
