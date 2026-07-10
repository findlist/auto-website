import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * 文本去重工具
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 按行去重：保留首次出现 / 保留末次出现 / 仅合并连续重复行
 *  - 可选：大小写敏感、去重前 trim、去除空行、去重后排序
 *  - 统计：原始行数、去重后行数、重复行数、重复率
 *
 * 适用场景：日志去重、邮件列表清洗、数据导出去重、代码片段去重
 */

type DedupMode = 'first' | 'last' | 'adjacent';

interface DedupOptions {
  mode: DedupMode;
  caseSensitive: boolean;   // 大小写敏感
  trimLines: boolean;       // 去重前 trim 每行
  removeEmpty: boolean;     // 去除空行
  sortResult: boolean;      // 去重后排序
}

const MODE_LABELS: Record<DedupMode, string> = {
  first: '保留首次出现',
  last: '保留末次出现',
  adjacent: '仅合并连续重复',
};

const SAMPLE_TEXT = `苹果
香蕉
苹果
橙子
香蕉
葡萄
苹果
橙子`;

/** 核心去重逻辑：根据模式与选项处理行数组 */
function deduplicate(lines: string[], opts: DedupOptions): string[] {
  // 预处理：trim 与去除空行
  let processed = lines;
  if (opts.trimLines) {
    processed = processed.map((l) => l.trim());
  }
  if (opts.removeEmpty) {
    processed = processed.filter((l) => l.length > 0);
  }

  // 大小写不敏感时用小写副本做比较键
  const toKey = (line: string) => opts.caseSensitive ? line : line.toLowerCase();

  if (opts.mode === 'adjacent') {
    // 仅合并连续重复行
    const result: string[] = [];
    for (const line of processed) {
      const prev = result[result.length - 1];
      if (prev === undefined || toKey(prev) !== toKey(line)) {
        result.push(line);
      }
    }
    return opts.sortResult ? [...result].sort() : result;
  }

  if (opts.mode === 'last') {
    // 保留末次出现：用 Map 按键去重，保留最后插入的值，再按原始顺序输出
    const seen = new Map<string, string>();
    const order: string[] = []; // 记录键的首次出现顺序，保持稳定输出
    for (const line of processed) {
      const key = toKey(line);
      if (!seen.has(key)) order.push(key);
      seen.set(key, line);
    }
    const result = order.map((key) => seen.get(key)!);
    return opts.sortResult ? [...result].sort() : result;
  }

  // 默认 first：保留首次出现，用 Set 去重
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of processed) {
    const key = toKey(line);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(line);
    }
  }
  return opts.sortResult ? [...result].sort() : result;
}

export default function TextDedupTool() {
  const [input, setInput] = useState(SAMPLE_TEXT);
  const [opts, setOpts] = useState<DedupOptions>({
    mode: 'first',
    caseSensitive: true,
    trimLines: true,
    removeEmpty: false,
    sortResult: false,
  });
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');

  // 实时计算去重结果与统计
  const { result, stats } = useMemo(() => {
    const lines = input.split('\n');
    const deduped = deduplicate(lines, opts);
    const originalCount = lines.length;
    const dedupedCount = deduped.length;
    const dupCount = originalCount - dedupedCount;
    const dupRate = originalCount > 0 ? (dupCount / originalCount) * 100 : 0;
    return {
      result: deduped.join('\n'),
      stats: { originalCount, dedupedCount, dupCount, dupRate },
    };
  }, [input, opts]);

  const handleCopy = useCallback(async () => {
    if (!result) return;
    const ok = await copyText(result);
    if (ok) {
      setCopied(true);
      setNotice('已复制到剪贴板');
      setTimeout(() => setCopied(false), 1500);
    } else {
      setNotice('复制失败，请手动选中复制');
    }
  }, [result]);

  const handleClear = useCallback(() => {
    setInput('');
    setNotice('');
  }, []);

  const handleSample = useCallback(() => {
    setInput(SAMPLE_TEXT);
    setNotice('');
  }, []);

  const onInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (notice) setNotice('');
  }, [notice]);

  // 统一选项切换处理
  const toggleOpt = useCallback((key: keyof Omit<DedupOptions, 'mode'>) => {
    setOpts((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <div className="dedup">
      {/* 输入区 */}
      <div className="dedup__input-section">
        <div className="dedup__toolbar">
          <label htmlFor="dedup-input" className="dedup__label">
            输入文本（每行一条）
            <span className="dedup__stat">{stats.originalCount} 行</span>
          </label>
          <div className="dedup__actions">
            <button className="btn btn--sm" onClick={handleSample}>示例</button>
            <button className="btn btn--sm" onClick={handleClear}>清空</button>
          </div>
        </div>
        <textarea
          id="dedup-input"
          className="dedup__textarea"
          value={input}
          onChange={onInputChange}
          placeholder="在此粘贴需要去重的文本，每行一条记录。支持日志、邮件列表、数据导出等场景。"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          aria-label="输入需要去重的文本"
        />
      </div>

      {/* 选项区 */}
      <div className="dedup__options">
        <fieldset className="dedup__fieldset">
          <legend className="dedup__legend">去重模式</legend>
          {(Object.keys(MODE_LABELS) as DedupMode[]).map((m) => (
            <label key={m} className="dedup__radio">
              <input
                type="radio"
                name="dedup-mode"
                value={m}
                checked={opts.mode === m}
                onChange={() => setOpts((prev) => ({ ...prev, mode: m }))}
              />
              <span>{MODE_LABELS[m]}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="dedup__fieldset">
          <legend className="dedup__legend">处理选项</legend>
          <label className="dedup__check">
            <input type="checkbox" checked={opts.caseSensitive} onChange={() => toggleOpt('caseSensitive')} />
            <span>大小写敏感</span>
          </label>
          <label className="dedup__check">
            <input type="checkbox" checked={opts.trimLines} onChange={() => toggleOpt('trimLines')} />
            <span>去重前去除行首尾空白</span>
          </label>
          <label className="dedup__check">
            <input type="checkbox" checked={opts.removeEmpty} onChange={() => toggleOpt('removeEmpty')} />
            <span>去除空行</span>
          </label>
          <label className="dedup__check">
            <input type="checkbox" checked={opts.sortResult} onChange={() => toggleOpt('sortResult')} />
            <span>去重后排序</span>
          </label>
        </fieldset>
      </div>

      {/* 统计区 */}
      <div className="dedup__stats">
        <div className="dedup__stat-item">
          <span className="dedup__stat-num">{stats.originalCount}</span>
          <span className="dedup__stat-label">原始行数</span>
        </div>
        <div className="dedup__stat-item">
          <span className="dedup__stat-num">{stats.dedupedCount}</span>
          <span className="dedup__stat-label">去重后</span>
        </div>
        <div className="dedup__stat-item">
          <span className="dedup__stat-num dedup__stat-num--warn">{stats.dupCount}</span>
          <span className="dedup__stat-label">重复行</span>
        </div>
        <div className="dedup__stat-item">
          <span className="dedup__stat-num">{stats.dupRate.toFixed(1)}%</span>
          <span className="dedup__stat-label">重复率</span>
        </div>
      </div>

      {/* 结果区 */}
      <div className="dedup__result-section">
        <div className="dedup__toolbar">
          <label className="dedup__label">
            去重结果
            <span className="dedup__stat">{stats.dedupedCount} 行</span>
          </label>
          <button
            className="btn btn--sm dedup__copy"
            onClick={handleCopy}
            disabled={!result}
            aria-label="复制去重结果"
          >
            {copied ? '已复制' : '复制结果'}
          </button>
        </div>
        <div className="dedup__result" aria-live="polite">
          {result || <span className="dedup__result-empty">（空）</span>}
        </div>
      </div>

      {/* 状态条 */}
      <div className="dedup__status" role="status" aria-live="polite">
        {notice ? (
          <div className="dedup__notice">{notice}</div>
        ) : (
          <div className="dedup__hint">
            支持按行去重、连续重复合并、大小写不敏感等模式。所有数据仅在浏览器本地处理。
          </div>
        )}
      </div>
    </div>
  );
}
