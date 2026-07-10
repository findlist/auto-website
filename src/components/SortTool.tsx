import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * 文本排序工具
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 8 种排序模式：字母升序/降序、数值升序/降序、长度升序/降序、自然排序、随机打乱
 *  - 可选：大小写敏感、去除空行、排序前 trim、排序后去重
 *  - 统计：原始行数、结果行数
 *
 * 适用场景：名单排序、版本号排列、数据整理、随机抽取顺序
 */

type SortMode =
  | 'alpha-asc'    // 字母升序 A→Z
  | 'alpha-desc'   // 字母降序 Z→A
  | 'numeric-asc'  // 数值升序
  | 'numeric-desc' // 数值降序
  | 'length-asc'   // 长度升序（短→长）
  | 'length-desc'  // 长度降序（长→短）
  | 'natural'      // 自然排序（识别嵌入数字）
  | 'shuffle';     // 随机打乱

interface SortOptions {
  mode: SortMode;
  caseSensitive: boolean;  // 大小写敏感
  trimLines: boolean;      // 排序前 trim 每行
  removeEmpty: boolean;    // 去除空行
  uniqueResult: boolean;   // 排序后去重
}

const MODE_LABELS: Record<SortMode, string> = {
  'alpha-asc': '字母升序 (A→Z)',
  'alpha-desc': '字母降序 (Z→A)',
  'numeric-asc': '数值升序',
  'numeric-desc': '数值降序',
  'length-asc': '长度升序 (短→长)',
  'length-desc': '长度降序 (长→短)',
  'natural': '自然排序',
  'shuffle': '随机打乱',
};

const SAMPLE_TEXT = `item10
item2
item1
item20
item3
banana
Apple
apple
123
42
7`;

/** 使用 crypto.getRandomValues 生成无偏差随机整数 [0, max) */
function secureRandomInt(max: number): number {
  if (max <= 0) return 0;
  // 拒绝采样消除取模偏差
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  for (let i = 0; i < 10; i++) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
  // 降级：偏差可忽略
  return buf[0] % max;
}

/** 自然排序比较器：将字符串拆分为文本段与数字段交替序列 */
function naturalCompare(a: string, b: string, caseSensitive: boolean): number {
  const ta = caseSensitive ? a : a.toLowerCase();
  const tb = caseSensitive ? b : b.toLowerCase();
  // 交替匹配非数字段与数字段
  const pattern = /(\d+|\D+)/g;
  const partsA = ta.match(pattern) ?? [ta];
  const partsB = tb.match(pattern) ?? [tb];
  const len = Math.min(partsA.length, partsB.length);

  for (let i = 0; i < len; i++) {
    const sa = partsA[i];
    const sb = partsB[i];
    const isNumA = /^\d+$/.test(sa);
    const isNumB = /^\d+$/.test(sb);

    if (isNumA && isNumB) {
      // 数字段按数值比较
      const diff = BigInt(sa) - BigInt(sb);
      if (diff !== 0n) return diff > 0n ? 1 : -1;
    } else {
      // 文本段按字符串比较
      if (sa !== sb) return sa < sb ? -1 : 1;
    }
  }
  // 较短的数组排在前面
  return partsA.length - partsB.length;
}

/** 核心排序逻辑 */
function sortLines(lines: string[], opts: SortOptions): string[] {
  // 预处理：trim 与去除空行
  let processed = lines;
  if (opts.trimLines) {
    processed = processed.map((l) => l.trim());
  }
  if (opts.removeEmpty) {
    processed = processed.filter((l) => l.length > 0);
  }

  // 排序后去重需在排序前做一次去重（保持首次出现顺序）
  if (opts.uniqueResult) {
    const seen = new Set<string>();
    const toKey = (line: string) =>
      opts.caseSensitive ? line : line.toLowerCase();
    processed = processed.filter((l) => {
      const key = toKey(l);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const { mode, caseSensitive } = opts;
  let result = [...processed];

  switch (mode) {
    case 'alpha-asc':
      result.sort((a, b) => {
        const ta = caseSensitive ? a : a.toLowerCase();
        const tb = caseSensitive ? b : b.toLowerCase();
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      });
      break;
    case 'alpha-desc':
      result.sort((a, b) => {
        const ta = caseSensitive ? a : a.toLowerCase();
        const tb = caseSensitive ? b : b.toLowerCase();
        return ta > tb ? -1 : ta < tb ? 1 : 0;
      });
      break;
    case 'numeric-asc':
      result.sort((a, b) => {
        const na = parseFloat(a);
        const nb = parseFloat(b);
        // 非数字排到最后
        if (isNaN(na) && isNaN(nb)) return 0;
        if (isNaN(na)) return 1;
        if (isNaN(nb)) return -1;
        return na - nb;
      });
      break;
    case 'numeric-desc':
      result.sort((a, b) => {
        const na = parseFloat(a);
        const nb = parseFloat(b);
        if (isNaN(na) && isNaN(nb)) return 0;
        if (isNaN(na)) return 1;
        if (isNaN(nb)) return -1;
        return nb - na;
      });
      break;
    case 'length-asc':
      result.sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
      break;
    case 'length-desc':
      result.sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
      break;
    case 'natural':
      result.sort((a, b) => naturalCompare(a, b, caseSensitive));
      break;
    case 'shuffle':
      // Fisher-Yates 洗牌，使用 crypto.getRandomValues
      for (let i = result.length - 1; i > 0; i--) {
        const j = secureRandomInt(i + 1);
        [result[i], result[j]] = [result[j], result[i]];
      }
      break;
  }

  return result;
}

export default function SortTool() {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<SortMode>('alpha-asc');
  const [caseSensitive, setCaseSensitive] = useState(true);
  const [trimLines, setTrimLines] = useState(false);
  const [removeEmpty, setRemoveEmpty] = useState(true);
  const [uniqueResult, setUniqueResult] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');

  const opts: SortOptions = {
    mode,
    caseSensitive,
    trimLines,
    removeEmpty,
    uniqueResult,
  };

  // 实时计算排序结果
  const result = useMemo(() => {
    if (!input) return [];
    return sortLines(input.split('\n'), opts);
  }, [input, mode, caseSensitive, trimLines, removeEmpty, uniqueResult]);

  const resultText = result.join('\n');
  const originalCount = input ? input.split('\n').length : 0;
  const resultCount = result.length;

  const handleCopy = useCallback(async () => {
    if (!resultText) return;
    const ok = await copyText(resultText);
    if (ok) {
      setCopied(true);
      setNotice('已复制排序结果到剪贴板');
      setTimeout(() => setCopied(false), 1500);
      setTimeout(() => setNotice(''), 3000);
    } else {
      setNotice('复制失败，请手动选择文本复制');
      setTimeout(() => setNotice(''), 3000);
    }
  }, [resultText]);

  const handleClear = useCallback(() => {
    setInput('');
    setNotice('');
  }, []);

  const handleSample = useCallback(() => {
    setInput(SAMPLE_TEXT);
    setNotice('');
  }, []);

  const handleShuffle = useCallback(() => {
    // 随机打乱模式下点击"重新打乱"按钮触发重算
    if (mode === 'shuffle' && input) {
      // 利用 useState 的函数更新触发 useMemo 重算
      setInput((prev) => prev + '');
    }
  }, [mode, input]);

  return (
    <div className="sort">
      {/* 输入区 */}
      <div className="sort__input-section">
        <div className="sort__toolbar">
          <span className="sort__label">
            输入文本（每行一条）
            <span className="sort__stat">共 {originalCount} 行</span>
          </span>
          <div className="sort__actions">
            <button className="btn btn--sm" onClick={handleSample}>示例</button>
            <button className="btn btn--sm" onClick={handleClear}>清空</button>
          </div>
        </div>
        <textarea
          className="sort__textarea"
          placeholder="输入需要排序的文本，每行一条&#10;例如：&#10;banana&#10;apple&#10;cherry"
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          spellCheck={false}
        />
      </div>

      {/* 排序模式选择 */}
      <div className="sort__options">
        <fieldset className="sort__fieldset">
          <legend className="sort__legend">排序模式</legend>
          {(Object.keys(MODE_LABELS) as SortMode[]).map((m) => (
            <label key={m} className="sort__radio">
              <input
                type="radio"
                name="sort-mode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
              />
              {MODE_LABELS[m]}
            </label>
          ))}
        </fieldset>
        <fieldset className="sort__fieldset">
          <legend className="sort__legend">选项</legend>
          <label className="sort__check">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.currentTarget.checked)}
            />
            大小写敏感
          </label>
          <label className="sort__check">
            <input
              type="checkbox"
              checked={trimLines}
              onChange={(e) => setTrimLines(e.currentTarget.checked)}
            />
            排序前去除行首尾空白
          </label>
          <label className="sort__check">
            <input
              type="checkbox"
              checked={removeEmpty}
              onChange={(e) => setRemoveEmpty(e.currentTarget.checked)}
            />
            去除空行
          </label>
          <label className="sort__check">
            <input
              type="checkbox"
              checked={uniqueResult}
              onChange={(e) => setUniqueResult(e.currentTarget.checked)}
            />
            排序后去重
          </label>
        </fieldset>
      </div>

      {/* 统计区 */}
      <div className="sort__stats">
        <div className="sort__stat-item">
          <span className="sort__stat-num">{originalCount}</span>
          <span className="sort__stat-label">原始行数</span>
        </div>
        <div className="sort__stat-item">
          <span className="sort__stat-num">{resultCount}</span>
          <span className="sort__stat-label">结果行数</span>
        </div>
      </div>

      {/* 结果区 */}
      <div className="sort__result-section">
        <div className="sort__toolbar">
          <span className="sort__label">
            排序结果
            <span className="sort__stat">{MODE_LABELS[mode]}</span>
          </span>
          <div className="sort__actions">
            {mode === 'shuffle' && input && (
              <button className="btn btn--sm" onClick={handleShuffle}>重新打乱</button>
            )}
            <button
              className={`btn btn--sm${copied ? ' btn--success' : ''}`}
              onClick={handleCopy}
              disabled={!resultText}
            >
              {copied ? '已复制' : '复制结果'}
            </button>
          </div>
        </div>
        {resultText ? (
          <div className="sort__result">{resultText}</div>
        ) : (
          <div className="sort__result sort__result-empty">
            {input ? '没有可排序的行（可能已全部被空行过滤）' : '请在上方输入文本后查看排序结果'}
          </div>
        )}
      </div>

      {/* 状态提示 */}
      {notice && (
        <div className="sort__notice">{notice}</div>
      )}
      {!notice && !input && (
        <div className="sort__hint">提示：点击「示例」按钮快速体验排序效果</div>
      )}
    </div>
  );
}
