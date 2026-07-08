import { useState, useMemo, useCallback, useEffect } from 'react';
import { copyText } from '../utils/clipboard';
import {
  listTimeZones,
  convert,
  parseLocalInput,
  toLocalInput,
  getZoneInfo,
  systemTimeZone,
  zoneLabel,
  DEFAULT_ZONES,
  type ConversionResult,
} from '../utils/timezone';

/**
 * 时区转换工具：多时区同时对比。
 *
 * 输入一个时间与源时区，实时展示各目标时区下的完整时间表示，
 * 包含 UTC 偏移、夏令时标记、ISO 8601、Unix 时间戳与多种格式化输出。
 *
 * 水合注意：初始状态使用确定性默认值（UTC + 固定时间），
 * 避免服务端渲染时 `new Date()` 与客户端水合时的时间差导致 React 水合错误。
 * 真实的系统时区与当前时间在 `useEffect` 中于客户端设置。
 */
export default function TimeZoneTool() {
  // 源时区：SSR 用 UTC（确定性），客户端水合后切换为系统时区
  const [sourceZone, setSourceZone] = useState<string>('UTC');
  // 输入时间（datetime-local 字符串，按源时区解释）
  // SSR 用固定时间（确定性），客户端水合后切换为当前时间
  const [inputValue, setInputValue] = useState<string>('2026-01-01T00:00');
  // 目标时区列表
  const [targetZones, setTargetZones] = useState<string[]>(() => [...DEFAULT_ZONES]);
  // 新增时区选择
  const [newZone, setNewZone] = useState<string>('Asia/Singapore');

  // 客户端水合后：设置真实的系统时区与当前时间
  useEffect(() => {
    const zone = systemTimeZone();
    setSourceZone(zone);
    setInputValue(toLocalInput(new Date(), zone));
  }, []);

  const [copied, setCopied] = useState<string>('');
  const [notice, setNotice] = useState<string>('');

  // 时区分组列表（只计算一次）
  const zoneGroups = useMemo(() => listTimeZones(), []);

  // 将输入时间按源时区解析为绝对 Date
  const absoluteDate = useMemo(() => {
    const d = parseLocalInput(inputValue, sourceZone);
    return d ?? new Date(NaN);
  }, [inputValue, sourceZone]);

  const isValid = !isNaN(absoluteDate.getTime());

  // 各目标时区的转换结果
  const results = useMemo<ConversionResult[]>(() => {
    if (!isValid) return [];
    return targetZones
      .map((z) => convert(absoluteDate, z))
      .filter((r): r is ConversionResult => r !== null);
  }, [absoluteDate, targetZones, isValid]);

  // 源时区信息（用于顶部展示）
  const sourceInfo = useMemo(
    () => (isValid ? getZoneInfo(sourceZone, absoluteDate) : null),
    [sourceZone, absoluteDate, isValid],
  );

  /** 复制某字段值 */
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

  /** 使用当前时间 */
  const useNow = useCallback(() => {
    setInputValue(toLocalInput(new Date(), sourceZone));
    setNotice('已设置为当前时间');
    setTimeout(() => setNotice(''), 1500);
  }, [sourceZone]);

  /** 添加目标时区 */
  const addZone = useCallback((zone: string) => {
    if (!zone) return;
    setTargetZones((prev) => (prev.includes(zone) ? prev : [...prev, zone]));
  }, []);

  /** 删除目标时区 */
  const removeZone = useCallback((zone: string) => {
    setTargetZones((prev) => prev.filter((z) => z !== zone));
  }, []);

  // 每秒刷新当前时间显示（仅当用户在「使用当前时间」后用于提示，避免持续覆盖输入）
  // 此处不做自动刷新，保持用户输入稳定

  /** 时差描述：与源时区的差值 */
  const diffLabel = useCallback(
    (r: ConversionResult): string => {
      if (!sourceInfo) return '';
      const diff = r.zone.offsetMinutes - sourceInfo.offsetMinutes;
      if (diff === 0) return '与源时区相同';
      const sign = diff > 0 ? '+' : '-';
      const abs = Math.abs(diff);
      const h = Math.floor(abs / 60);
      const m = abs % 60;
      const hPart = h > 0 ? `${h} 小时` : '';
      const mPart = m > 0 ? `${m} 分` : '';
      return `比源时区 ${sign}${hPart}${mPart}`;
    },
    [sourceInfo],
  );

  return (
    <div className="tz">
      {/* 顶部：时间输入 + 源时区 */}
      <div className="tz__bar">
        <label className="tz__field tz__field--time">
          <span>时间</span>
          <input
            id="tz-input"
            type="datetime-local"
            value={inputValue}
            step="1"
            onChange={(e) => setInputValue(e.target.value)}
            aria-label="输入时间"
          />
        </label>
        <label className="tz__field tz__field--source">
          <span>源时区</span>
          <select
            value={sourceZone}
            onChange={(e) => setSourceZone(e.target.value)}
            aria-label="源时区"
          >
            {Object.entries(zoneGroups).map(([group, zones]) => (
              <optgroup key={group} label={group}>
                {zones.map((z) => (
                  <option key={z} value={z}>{z}（{zoneLabel(z)}）</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <button className="btn btn--sm" onClick={useNow} aria-label="使用当前时间">
          当前时间
        </button>
      </div>

      {/* 源时区摘要 */}
      {sourceInfo && isValid && (
        <div className="tz__source-summary">
          <strong>{sourceZone}</strong>
          <span className="tz__source-offset">{sourceInfo.offsetLabel}</span>
          {sourceInfo.isDst && <span className="tz__dst-badge" title="夏令时">夏令时</span>}
          <span className="tz__source-time">{convert(absoluteDate, sourceZone)?.local24}</span>
        </div>
      )}

      {/* 错误提示 */}
      {!isValid && (
        <div className="tz__error" role="alert">
          时间格式无效，请输入有效的日期时间（如 2026-07-08 14:30）。
        </div>
      )}

      {/* 添加目标时区 */}
      <div className="tz__add-bar">
        <label className="tz__field tz__field--add">
          <span>添加时区</span>
          <select
            value={newZone}
            onChange={(e) => setNewZone(e.target.value)}
            aria-label="选择要添加的时区"
          >
            {Object.entries(zoneGroups).map(([group, zones]) => (
              <optgroup key={group} label={group}>
                {zones.map((z) => (
                  <option key={z} value={z}>{z}（{zoneLabel(z)}）</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <button
          className="btn btn--primary btn--sm"
          onClick={() => addZone(newZone)}
          disabled={targetZones.includes(newZone)}
          aria-label="添加时区"
        >
          {targetZones.includes(newZone) ? '已添加' : '+ 添加'}
        </button>
      </div>

      {/* 目标时区结果列表 */}
      <div className="tz__list" role="list">
        {results.map((r) => {
          const copyKey = `copy-${r.zone.id}`;
          return (
            <div className="tz__card" role="listitem" key={r.zone.id}>
              <div className="tz__card-head">
                <div className="tz__card-title">
                  <span className="tz__card-label">{r.zone.label}</span>
                  <code className="tz__card-id">{r.zone.id}</code>
                </div>
                <div className="tz__card-badges">
                  <span className="tz__offset-badge">{r.zone.offsetLabel}</span>
                  {r.zone.isDst && <span className="tz__dst-badge" title="夏令时">夏令时</span>}
                  <button
                    className="tz__remove-btn"
                    onClick={() => removeZone(r.zone.id)}
                    aria-label={`删除 ${r.zone.label}`}
                    title="删除"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="tz__card-main">
                <div className="tz__time-24">{r.local24}</div>
                <div className="tz__time-meta">
                  <span>{r.parts.weekday}</span>
                  <span className="tz__time-12">{r.local12}</span>
                </div>
                <div className="tz__diff">{diffLabel(r)}</div>
              </div>

              <ul className="tz__card-detail" role="list">
                <li className="tz__detail-row">
                  <span className="tz__detail-label">ISO 8601</span>
                  <code className="tz__detail-value">{r.iso}</code>
                  <button
                    className="tz__copy-btn"
                    onClick={() => handleCopy(`${copyKey}-iso`, r.iso, 'ISO 8601')}
                    aria-label="复制 ISO 8601"
                  >
                    {copied === `${copyKey}-iso` ? '✓' : '复制'}
                  </button>
                </li>
                <li className="tz__detail-row">
                  <span className="tz__detail-label">Unix 秒</span>
                  <code className="tz__detail-value">{r.unix}</code>
                  <button
                    className="tz__copy-btn"
                    onClick={() => handleCopy(`${copyKey}-unix`, String(r.unix), 'Unix 秒')}
                    aria-label="复制 Unix 秒级时间戳"
                  >
                    {copied === `${copyKey}-unix` ? '✓' : '复制'}
                  </button>
                </li>
                <li className="tz__detail-row">
                  <span className="tz__detail-label">Unix 毫秒</span>
                  <code className="tz__detail-value">{r.unixMs}</code>
                  <button
                    className="tz__copy-btn"
                    onClick={() => handleCopy(`${copyKey}-ms`, String(r.unixMs), 'Unix 毫秒')}
                    aria-label="复制 Unix 毫秒级时间戳"
                  >
                    {copied === `${copyKey}-ms` ? '✓' : '复制'}
                  </button>
                </li>
              </ul>
            </div>
          );
        })}
        {isValid && results.length === 0 && (
          <div className="tz__empty">暂无目标时区，请在上方添加。</div>
        )}
      </div>

      {/* 联动链接 */}
      {isValid && (
        <div className="tz__links">
          <a href="/timestamp" className="tz__link">→ 前往 Unix 时间戳转换工具</a>
        </div>
      )}

      {/* 状态条 */}
      <div className="tz__status" role="status" aria-live="polite">
        {notice ? (
          <div className="tz__notice">{notice}</div>
        ) : (
          <div className="tz__hint">
            基于浏览器内置 IANA 时区数据库，支持夏令时自动识别，所有计算在本地完成。
          </div>
        )}
      </div>
    </div>
  );
}
