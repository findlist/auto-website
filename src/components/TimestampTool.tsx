import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * 时间戳转换工具
 * 全部在浏览器本地处理，使用原生 Date API。
 *
 * 两个视图：
 *  - single：单条双向转换（时间戳 ↔ 日期）+ 多格式输出
 *  - batch：批量转换，粘贴多个时间戳（每行一个），自动识别秒/毫秒
 */

type Unit = 'seconds' | 'milliseconds';
type ViewMode = 'single' | 'batch';

/** 将时间戳格式化为 datetime-local input 所需的 "YYYY-MM-DDTHH:mm" 格式 */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 将时间戳格式化为可读的本地时间字符串 */
function formatLocal(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 计算相对时间描述（如"3 天前"、"2 小时后"） */
function formatRelative(date: Date, now: Date): string {
  const diff = date.getTime() - now.getTime();
  const absDiff = Math.abs(diff);
  const future = diff > 0;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  let value: number;
  let unit: string;
  if (absDiff < minute) {
    return future ? '即将到来' : '刚刚';
  } else if (absDiff < hour) {
    value = Math.floor(absDiff / minute);
    unit = '分钟';
  } else if (absDiff < day) {
    value = Math.floor(absDiff / hour);
    unit = '小时';
  } else if (absDiff < 30 * day) {
    value = Math.floor(absDiff / day);
    unit = '天';
  } else if (absDiff < 365 * day) {
    value = Math.floor(absDiff / (30 * day));
    unit = '个月';
  } else {
    value = Math.floor(absDiff / (365 * day));
    unit = '年';
  }
  return `${value} ${unit}${future ? '后' : '前'}`;
}


/** 批量转换单行结果 */
interface BatchRow {
  raw: string;          // 原始输入行（去除首尾空白后）
  ok: boolean;          // 是否解析成功
  unit: Unit | 'unknown'; // 识别出的单位
  date: Date | null;
  local: string;        // 本地时间字符串
  iso: string;          // ISO 8601
  error: string;        // 失败时的错误说明
}

/**
 * 自动识别时间戳单位：10 位视为秒，13 位视为毫秒，其他位数返回 unknown。
 * 对小数（如 1700000000.123）按整数位数判断。
 */
function detectUnit(numStr: string): Unit | 'unknown' {
  // 取整数部分位数
  const intPart = numStr.replace(/^-/, '').split('.')[0] ?? '';
  const len = intPart.length;
  if (len === 10) return 'seconds';
  if (len === 13) return 'milliseconds';
  return 'unknown';
}

/** 将单行时间戳解析为 BatchRow */
function parseBatchLine(raw: string): BatchRow {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { raw: '', ok: false, unit: 'unknown', date: null, local: '', iso: '', error: '空行' };
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num)) {
    return { raw: trimmed, ok: false, unit: 'unknown', date: null, local: '', iso: '', error: '非数字' };
  }
  const unit = detectUnit(trimmed);
  // unknown 单位时按毫秒兜底（多数现代场景为毫秒），但仍标记为 unknown 让用户知晓
  const ms = unit === 'seconds' ? num * 1000 : num;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return { raw: trimmed, ok: false, unit, date: null, local: '', iso: '', error: '超出有效范围' };
  }
  return {
    raw: trimmed,
    ok: true,
    unit,
    date,
    local: formatLocal(date),
    iso: date.toISOString(),
    error: '',
  };
}

export default function TimestampTool() {
  const [viewMode, setViewMode] = useState<ViewMode>('single');
  const [unit, setUnit] = useState<Unit>('seconds');
  const [tsInput, setTsInput] = useState<string>('');
  const [dtInput, setDtInput] = useState<string>('');
  // now 初始为 null，避免 SSR 与客户端初始值不一致导致的水合错误；
  // 客户端挂载后由 useEffect 设置真实时间并启动定时器
  const [now, setNow] = useState<Date | null>(null);
  const [notice, setNotice] = useState<string>('');
  const [copiedField, setCopiedField] = useState<string>('');
  // 标记当前由哪一侧触发更新，避免双向绑定循环
  const syncSource = useRef<'ts' | 'dt' | null>(null);

  // 批量转换状态
  const [batchInput, setBatchInput] = useState<string>('');
  const [batchCopied, setBatchCopied] = useState(false);

  /** 客户端挂载后设置真实时间并每秒刷新，用于"当前时间戳"卡片与相对时间描述 */
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  /** 根据时间戳输入解析出 Date 对象（单位由 unit 决定） */
  const parsedDate = useMemo<Date | null>(() => {
    if (tsInput.trim() === '') return null;
    const num = Number(tsInput);
    if (!Number.isFinite(num)) return null;
    const ms = unit === 'seconds' ? num * 1000 : num;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }, [tsInput, unit]);

  /** 多格式输出（基于解析出的 Date） */
  const outputs = useMemo(() => {
    if (!parsedDate) return null;
    return {
      iso: parsedDate.toISOString(),
      local: formatLocal(parsedDate),
      utc: parsedDate.toUTCString(),
      // now 为 null（首次渲染）时显示占位符，待客户端挂载后更新为相对时间
      relative: now ? formatRelative(parsedDate, now) : '—',
    };
  }, [parsedDate, now]);

  /** 批量解析结果（每行一条） */
  const batchRows = useMemo<BatchRow[]>(() => {
    if (batchInput.trim() === '') return [];
    return batchInput.split('\n').map(parseBatchLine);
  }, [batchInput]);

  /** 批量结果统计 */
  const batchStats = useMemo(() => {
    let valid = 0;
    let invalid = 0;
    for (const row of batchRows) {
      if (row.raw === '') continue; // 跳过空行
      if (row.ok) valid++;
      else invalid++;
    }
    return { valid, invalid, total: valid + invalid };
  }, [batchRows]);

  /** 时间戳输入变化时同步到日期输入框 */
  const onTsChange = useCallback((value: string) => {
    syncSource.current = 'ts';
    setTsInput(value);
    const num = Number(value);
    if (value.trim() !== '' && Number.isFinite(num)) {
      const ms = unit === 'seconds' ? num * 1000 : num;
      const date = new Date(ms);
      if (!Number.isNaN(date.getTime())) {
        setDtInput(toLocalInputValue(date));
      }
    } else {
      setDtInput('');
    }
  }, [unit]);

  /** 日期输入变化时同步到时间戳输入框 */
  const onDtChange = useCallback((value: string) => {
    syncSource.current = 'dt';
    setDtInput(value);
    if (value === '') {
      setTsInput('');
      return;
    }
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      const ms = date.getTime();
      const result = unit === 'seconds' ? Math.floor(ms / 1000) : ms;
      setTsInput(String(result));
    }
  }, [unit]);

  /** 单位切换时重新换算时间戳数值 */
  const onUnitChange = useCallback((u: Unit) => {
    if (u === unit) return;
    const num = Number(tsInput);
    if (tsInput.trim() !== '' && Number.isFinite(num)) {
      // 旧单位 → 毫秒 → 新单位
      const ms = unit === 'seconds' ? num * 1000 : num;
      const result = u === 'seconds' ? Math.floor(ms / 1000) : ms;
      setTsInput(String(result));
    }
    setUnit(u);
  }, [unit, tsInput]);

  /** 使用当前时间戳填入 */
  const useNow = useCallback(() => {
    const ms = Date.now();
    const result = unit === 'seconds' ? Math.floor(ms / 1000) : ms;
    onTsChange(String(result));
  }, [unit, onTsChange]);

  /** 复制指定字段 */
  const handleCopy = useCallback(async (text: string, field: string) => {
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

  /** 清空单条区 */
  const handleClear = useCallback(() => {
    setTsInput('');
    setDtInput('');
    setNotice('');
    setCopiedField('');
  }, []);

  /** 复制批量结果（CSV 格式：序号,原始,单位,本地时间,ISO） */
  const handleBatchCopyAll = useCallback(async () => {
    const validRows = batchRows.filter(r => r.ok && r.raw !== '');
    if (validRows.length === 0) return;
    const header = '序号,原始时间戳,单位,本地时间,ISO 8601';
    const lines = validRows.map((r, i) =>
      `${i + 1},${r.raw},${r.unit === 'seconds' ? '秒' : r.unit === 'milliseconds' ? '毫秒' : '未知'},${r.local},${r.iso}`
    );
    const csv = [header, ...lines].join('\n');
    const ok = await copyText(csv);
    setBatchCopied(ok);
    setNotice(ok ? `已复制 ${validRows.length} 条结果（CSV 格式）` : '复制失败，请手动选中复制');
    if (ok) setTimeout(() => { setBatchCopied(false); setNotice(''); }, 2000);
  }, [batchRows]);

  /** 清空批量区 */
  const handleBatchClear = useCallback(() => {
    setBatchInput('');
    setNotice('');
    setBatchCopied(false);
  }, []);

  /** 载入批量示例 */
  const handleBatchSample = useCallback(() => {
    // 混合秒/毫秒/无效行，演示自动识别与错误处理
    setBatchInput('1700000000\n1700000000000\n1699999999\n1699999999999\n不是时间戳\n1700000000000\n\n1700000000.5');
    setNotice('');
  }, []);

  /** 切换视图时清空通知 */
  const onViewModeChange = useCallback((v: ViewMode) => {
    setViewMode(v);
    setNotice('');
    setCopiedField('');
    setBatchCopied(false);
  }, []);

  // 当前时间戳（用于顶部卡片显示）；now 为 null 时显示占位符，避免水合不一致
  const nowTs = now === null
    ? '—'
    : (unit === 'seconds' ? Math.floor(now.getTime() / 1000) : now.getTime());

  return (
    <div className="jsontool tstool">
      {/* 当前时间戳卡片（两视图共用） */}
      <div className="tstool__now" role="status" aria-live="polite">
        <div className="tstool__now-label">当前时间戳（{unit === 'seconds' ? '秒' : '毫秒'}）</div>
        <code className="tstool__now-value">{nowTs}</code>
        <button
          className="btn btn--sm tstool__now-copy"
          onClick={() => handleCopy(String(nowTs), 'now')}
          aria-label="复制当前时间戳"
        >
          {copiedField === 'now' ? '已复制' : '复制'}
        </button>
      </div>

      {/* 视图切换 Tab */}
      <div className="tstool__view-tabs" role="tablist" aria-label="时间戳工具视图切换">
        <button
          role="tab"
          className={`tstool__view-tab${viewMode === 'single' ? ' is-active' : ''}`}
          aria-selected={viewMode === 'single'}
          onClick={() => onViewModeChange('single')}
        >
          单条转换
        </button>
        <button
          role="tab"
          className={`tstool__view-tab${viewMode === 'batch' ? ' is-active' : ''}`}
          aria-selected={viewMode === 'batch'}
          onClick={() => onViewModeChange('batch')}
        >
          批量转换
        </button>
      </div>

      {/* 单条转换视图 */}
      {viewMode === 'single' && (
        <>
          <div className="jsontool__toolbar" role="toolbar" aria-label="时间戳转换操作">
            <div className="jsontool__actions">
              <button className="btn btn--primary btn--sm" onClick={useNow}>使用当前时间</button>
            </div>
            <div className="jsontool__options">
              <div className="tstool__seg" role="group" aria-label="时间戳单位">
                <button
                  className={`btn btn--sm${unit === 'seconds' ? ' btn--primary' : ''}`}
                  aria-pressed={unit === 'seconds'}
                  onClick={() => onUnitChange('seconds')}
                >秒</button>
                <button
                  className={`btn btn--sm${unit === 'milliseconds' ? ' btn--primary' : ''}`}
                  aria-pressed={unit === 'milliseconds'}
                  onClick={() => onUnitChange('milliseconds')}
                >毫秒</button>
              </div>
              <button className="btn btn--sm" onClick={handleClear}>清空</button>
            </div>
          </div>

          <div className="jsontool__panels">
            <div className="jsontool__panel">
              <label htmlFor="ts-input" className="jsontool__label">
                Unix 时间戳（{unit === 'seconds' ? '秒' : '毫秒'}）
              </label>
              <input
                id="ts-input"
                className="tstool__input"
                type="text"
                inputMode="numeric"
                value={tsInput}
                onChange={(e) => onTsChange(e.target.value)}
                placeholder={`例如：${unit === 'seconds' ? '1700000000' : '1700000000000'}`}
                spellCheck={false}
                autoComplete="off"
                aria-label="Unix 时间戳"
              />
            </div>
            <div className="jsontool__panel">
              <label htmlFor="dt-input" className="jsontool__label">本地日期时间</label>
              <input
                id="dt-input"
                className="tstool__input"
                type="datetime-local"
                value={dtInput}
                onChange={(e) => onDtChange(e.target.value)}
                aria-label="本地日期时间"
              />
            </div>
          </div>

          {/* 多格式输出 */}
          {outputs && (
            <ul className="tstool__outputs" aria-label="多种格式输出">
              <li className="tstool__out-item">
                <span className="tstool__out-label">ISO 8601</span>
                <code className="tstool__out-value">{outputs.iso}</code>
                <button className="btn btn--sm" onClick={() => handleCopy(outputs.iso, 'iso')}>
                  {copiedField === 'iso' ? '已复制' : '复制'}
                </button>
              </li>
              <li className="tstool__out-item">
                <span className="tstool__out-label">本地时间</span>
                <code className="tstool__out-value">{outputs.local}</code>
                <button className="btn btn--sm" onClick={() => handleCopy(outputs.local, 'local')}>
                  {copiedField === 'local' ? '已复制' : '复制'}
                </button>
              </li>
              <li className="tstool__out-item">
                <span className="tstool__out-label">UTC 时间</span>
                <code className="tstool__out-value">{outputs.utc}</code>
                <button className="btn btn--sm" onClick={() => handleCopy(outputs.utc, 'utc')}>
                  {copiedField === 'utc' ? '已复制' : '复制'}
                </button>
              </li>
              <li className="tstool__out-item">
                <span className="tstool__out-label">相对时间</span>
                <code className="tstool__out-value">{outputs.relative}</code>
              </li>
            </ul>
          )}
        </>
      )}

      {/* 批量转换视图 */}
      {viewMode === 'batch' && (
        <>
          <div className="jsontool__toolbar" role="toolbar" aria-label="批量时间戳转换操作">
            <div className="jsontool__actions">
              <button className="btn btn--primary btn--sm" onClick={handleBatchSample}>示例</button>
              <button
                className="btn btn--sm"
                onClick={handleBatchCopyAll}
                disabled={batchStats.valid === 0}
              >
                {batchCopied ? '已复制' : '复制全部'}
              </button>
            </div>
            <div className="jsontool__options">
              <span className="tstool__seg-text">自动识别：10 位=秒，13 位=毫秒</span>
              <button className="btn btn--sm" onClick={handleBatchClear}>清空</button>
            </div>
          </div>

          <div className="jsontool__panels">
            <div className="jsontool__panel">
              <label htmlFor="batch-input" className="jsontool__label">
                输入多个时间戳（每行一个）
                <span className="jsontool__stat">{batchInput.length} 字</span>
              </label>
              <textarea
                id="batch-input"
                className="jsontool__textarea"
                value={batchInput}
                onChange={(e) => { setBatchInput(e.target.value); if (notice) setNotice(''); }}
                placeholder={'每行一个时间戳，例如：\n1700000000\n1700000000000\n1699999999'}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                aria-label="批量时间戳输入"
              />
            </div>
          </div>

          {/* 批量结果 */}
          {batchInput.trim() === '' ? (
            <div className="jsontool__status" role="status">
              <div className="jsontool__hint">粘贴多个时间戳（每行一个），自动识别秒/毫秒并批量转换为日期。</div>
            </div>
          ) : (
            <div className="tstool__batch-result" aria-live="polite">
              {/* 统计栏 */}
              <div className="tstool__batch-stats">
                <span className="tstool__batch-stat">共 {batchStats.total} 条</span>
                <span className="tstool__batch-stat tstool__batch-stat--ok">有效 {batchStats.valid}</span>
                <span className="tstool__batch-stat tstool__batch-stat--err">无效 {batchStats.invalid}</span>
              </div>

              {/* 结果表格 */}
              {batchRows.length > 0 && (
                <div className="tstool__batch-table" role="table" aria-label="批量转换结果">
                  <div className="tstool__batch-row tstool__batch-row--head" role="row">
                    <span role="columnheader" className="tstool__batch-idx">#</span>
                    <span role="columnheader" className="tstool__batch-raw">原始时间戳</span>
                    <span role="columnheader" className="tstool__batch-unit">单位</span>
                    <span role="columnheader" className="tstool__batch-local">本地时间</span>
                    <span role="columnheader" className="tstool__batch-iso">ISO 8601</span>
                  </div>
                  {batchRows.map((row, idx) => {
                    // 空行不渲染（避免表格出现大量空行）
                    if (row.raw === '') return null;
                    return (
                      <div
                        key={idx}
                        className={`tstool__batch-row${row.ok ? '' : ' is-error'}`}
                        role="row"
                      >
                        <span role="cell" className="tstool__batch-idx">{idx + 1}</span>
                        <span role="cell" className="tstool__batch-raw">
                          <code>{row.raw}</code>
                        </span>
                        <span role="cell" className="tstool__batch-unit">
                          {row.ok ? (
                            row.unit === 'seconds' ? '秒' : row.unit === 'milliseconds' ? '毫秒' : '未知'
                          ) : '—'}
                        </span>
                        <span role="cell" className="tstool__batch-local">
                          {row.ok ? row.local : <em className="tstool__batch-err">{row.error}</em>}
                        </span>
                        <span role="cell" className="tstool__batch-iso">
                          {row.ok ? <code>{row.iso}</code> : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* 状态条 */}
      <div className="jsontool__status" role="status" aria-live="polite">
        {notice ? (
          <div className="jsontool__notice">{notice}</div>
        ) : (
          <div className="jsontool__hint">
            基于浏览器原生 Date API，使用你本地时区计算，所有数据在浏览器内处理。
          </div>
        )}
      </div>
    </div>
  );
}
