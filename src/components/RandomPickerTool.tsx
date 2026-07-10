import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * 随机选择器工具
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 从输入列表中随机抽取 N 项
 *  - 可选：允许重复抽取、去除空行、去除重复项
 *  - 使用 crypto.getRandomValues 实现无偏差随机选择
 *
 * 适用场景：抽奖、随机分组、随机点名、A/B 测试分配
 */

interface PickerOptions {
  count: number;            // 抽取数量
  allowDuplicates: boolean; // 允许重复抽取
  trimItems: boolean;       // 去除行首尾空白
  removeEmpty: boolean;     // 去除空行
  uniqueItems: boolean;     // 去除重复项（抽取前）
}

const SAMPLE_TEXT = `张三
李四
王五
赵六
钱七
孙八
周九
吴十`;

/** 使用 crypto.getRandomValues 生成无偏差随机整数 [0, max) */
function secureRandomInt(max: number): number {
  if (max <= 0) return 0;
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  for (let i = 0; i < 10; i++) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
  return buf[0] % max;
}

/** 从数组中无偏差随机抽取 N 项 */
function pickRandom(items: string[], opts: PickerOptions): string[] {
  const pool = [...items];

  // 允许重复：直接独立抽取
  if (opts.allowDuplicates) {
    const result: string[] = [];
    for (let i = 0; i < opts.count; i++) {
      const idx = secureRandomInt(pool.length);
      result.push(pool[idx]);
    }
    return result;
  }

  // 不允许重复：Fisher-Yates 部分洗牌
  // 只洗前 count 个位置，避免全量洗牌
  const n = Math.min(opts.count, pool.length);
  for (let i = 0; i < n; i++) {
    const j = i + secureRandomInt(pool.length - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

export default function RandomPickerTool() {
  const [input, setInput] = useState('');
  const [count, setCount] = useState(1);
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [trimItems, setTrimItems] = useState(false);
  const [removeEmpty, setRemoveEmpty] = useState(true);
  const [uniqueItems, setUniqueItems] = useState(false);
  const [result, setResult] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');
  const [drawCount, setDrawCount] = useState(0);

  // 预处理后的候选列表
  const candidates = useMemo(() => {
    if (!input) return [];
    let lines = input.split('\n');
    if (trimItems) lines = lines.map((l) => l.trim());
    if (removeEmpty) lines = lines.filter((l) => l.length > 0);
    if (uniqueItems) {
      const seen = new Set<string>();
      lines = lines.filter((l) => {
        if (seen.has(l)) return false;
        seen.add(l);
        return true;
      });
    }
    return lines;
  }, [input, trimItems, removeEmpty, uniqueItems]);

  const candidateCount = candidates.length;
  const maxCount = allowDuplicates ? 999 : Math.max(1, candidateCount);

  const handlePick = useCallback(() => {
    if (candidateCount === 0) {
      setNotice('没有可抽取的候选项，请先输入文本');
      setTimeout(() => setNotice(''), 3000);
      return;
    }

    const effectiveCount = allowDuplicates
      ? Math.min(count, 999)
      : Math.min(count, candidateCount);

    if (!allowDuplicates && count > candidateCount) {
      setNotice(`候选项仅 ${candidateCount} 个，已自动调整为抽取 ${effectiveCount} 项`);
      setTimeout(() => setNotice(''), 3000);
    }

    const opts: PickerOptions = {
      count: effectiveCount,
      allowDuplicates,
      trimItems,
      removeEmpty,
      uniqueItems,
    };
    setResult(pickRandom(candidates, opts));
    setDrawCount((n) => n + 1);
    setNotice('');
  }, [candidateCount, count, allowDuplicates, trimItems, removeEmpty, uniqueItems, candidates]);

  const handleCopy = useCallback(async () => {
    if (!result || result.length === 0) return;
    const ok = await copyText(result.join('\n'));
    if (ok) {
      setCopied(true);
      setNotice('已复制抽取结果到剪贴板');
      setTimeout(() => setCopied(false), 1500);
      setTimeout(() => setNotice(''), 3000);
    } else {
      setNotice('复制失败，请手动选择文本复制');
      setTimeout(() => setNotice(''), 3000);
    }
  }, [result]);

  const handleClear = useCallback(() => {
    setInput('');
    setResult(null);
    setNotice('');
    setDrawCount(0);
  }, []);

  const handleSample = useCallback(() => {
    setInput(SAMPLE_TEXT);
    setResult(null);
    setNotice('');
  }, []);

  return (
    <div className="picker">
      {/* 输入区 */}
      <div className="picker__input-section">
        <div className="picker__toolbar">
          <span className="picker__label">
            候选项列表（每行一条）
            <span className="picker__stat">共 {candidateCount} 项</span>
          </span>
          <div className="picker__actions">
            <button className="btn btn--sm" onClick={handleSample}>示例</button>
            <button className="btn btn--sm" onClick={handleClear}>清空</button>
          </div>
        </div>
        <textarea
          className="picker__textarea"
          placeholder="输入候选项，每行一条&#10;例如：&#10;张三&#10;李四&#10;王五"
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          spellCheck={false}
        />
      </div>

      {/* 抽取设置 */}
      <div className="picker__options">
        <div className="picker__count-row">
          <label className="picker__label" htmlFor="pick-count">抽取数量</label>
          <input
            id="pick-count"
            className="picker__count-input"
            type="number"
            min={1}
            max={maxCount}
            value={Math.min(count, maxCount)}
            onChange={(e) => {
              const v = parseInt(e.currentTarget.value, 10);
              setCount(isNaN(v) || v < 1 ? 1 : Math.min(v, maxCount));
            }}
          />
          <span className="picker__hint">
            {allowDuplicates ? '（允许重复，上限 999）' : `（不重复，上限 ${candidateCount || 0}）`}
          </span>
        </div>
        <fieldset className="picker__fieldset">
          <legend className="picker__legend">选项</legend>
          <label className="picker__check">
            <input
              type="checkbox"
              checked={allowDuplicates}
              onChange={(e) => setAllowDuplicates(e.currentTarget.checked)}
            />
            允许重复抽取
          </label>
          <label className="picker__check">
            <input
              type="checkbox"
              checked={trimItems}
              onChange={(e) => setTrimItems(e.currentTarget.checked)}
            />
            去除行首尾空白
          </label>
          <label className="picker__check">
            <input
              type="checkbox"
              checked={removeEmpty}
              onChange={(e) => setRemoveEmpty(e.currentTarget.checked)}
            />
            去除空行
          </label>
          <label className="picker__check">
            <input
              type="checkbox"
              checked={uniqueItems}
              onChange={(e) => setUniqueItems(e.currentTarget.checked)}
            />
            候选项去重
          </label>
        </fieldset>
      </div>

      {/* 抽取按钮 */}
      <div className="picker__draw-section">
        <button
          className="btn btn--primary picker__draw-btn"
          onClick={handlePick}
          disabled={candidateCount === 0}
        >
          随机抽取 {count > 1 ? `${count} 项` : '1 项'}
        </button>
        {drawCount > 0 && (
          <span className="picker__draw-count">已抽取 {drawCount} 次</span>
        )}
      </div>

      {/* 结果区 */}
      {result && result.length > 0 && (
        <div className="picker__result-section">
          <div className="picker__toolbar">
            <span className="picker__label">
              抽取结果
              <span className="picker__stat">共 {result.length} 项</span>
            </span>
            <div className="picker__actions">
              <button
                className={`btn btn--sm${copied ? ' btn--success' : ''}`}
                onClick={handleCopy}
              >
                {copied ? '已复制' : '复制结果'}
              </button>
            </div>
          </div>
          <ol className="picker__result-list">
            {result.map((item, idx) => (
              <li key={`${drawCount}-${idx}`} className="picker__result-item">
                <span className="picker__result-num">{idx + 1}</span>
                <span className="picker__result-text">{item}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* 状态提示 */}
      {notice && (
        <div className="picker__notice">{notice}</div>
      )}
      {!notice && !input && (
        <div className="picker__hint-text">提示：点击「示例」按钮快速体验随机抽取功能</div>
      )}
    </div>
  );
}
