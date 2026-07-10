import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * 文本反转工具
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 三种反转模式：字符反转、行反转、单词反转
 *  - 可选：反转大小写、去除空行
 *
 * 适用场景：
 *  - 文本加密/混淆（简易）
 *  - 回文检测辅助
 *  - 数据顺序调整
 *  - 创意文案生成
 */

type ReverseMode = 'chars' | 'lines' | 'words';

interface ReverseConfig {
  mode: ReverseMode;
  label: string;
  desc: string;
}

const REVERSE_CONFIGS: ReverseConfig[] = [
  { mode: 'chars', label: '字符反转', desc: '整个文本的字符顺序反转' },
  { mode: 'lines', label: '行反转', desc: '行的顺序反转，每行内容不变' },
  { mode: 'words', label: '单词反转', desc: '每行内单词顺序反转，行结构保留' },
];

/**
 * 核心反转逻辑
 * - chars：按 Unicode 码点反转整段文本（使用 spread 展开正确处理代理对）
 * - lines：按换行符分割行，反转行顺序后重组（保留原始换行符类型）
 * - words：每行内按空格分割单词，反转单词顺序后用空格重组
 */
function reverseText(input: string, mode: ReverseMode, swapCase: boolean, trimEmpty: boolean): string {
  if (!input) return '';

  let result: string;

  switch (mode) {
    case 'chars':
      // 使用 Array.from 正确处理 Unicode 代理对（如 Emoji）
      result = Array.from(input).reverse().join('');
      break;
    case 'lines': {
      // 保留原始换行符：先统一识别 \n 与 \r\n
      const lines = input.split(/\r?\n/);
      const processed = trimEmpty ? lines.filter((l) => l.trim() !== '') : lines;
      result = processed.reverse().join('\n');
      break;
    }
    case 'words': {
      const lines = input.split(/\r?\n/);
      const processed = trimEmpty ? lines.filter((l) => l.trim() !== '') : lines;
      result = processed
        .map((line) => line.split(/\s+/).filter(Boolean).reverse().join(' '))
        .join('\n');
      break;
    }
    default:
      result = input;
  }

  // 反转大小写（可选）
  if (swapCase) {
    result = result.replace(/[a-zA-Z]/g, (ch) =>
      ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase(),
    );
  }

  return result;
}

export default function ReverseTool() {
  const [input, setInput] = useState('Hello World\n这是一个示例\n第二行文本');
  const [mode, setMode] = useState<ReverseMode>('chars');
  const [swapCase, setSwapCase] = useState(false);
  const [trimEmpty, setTrimEmpty] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');

  // 实时计算反转结果
  const result = useMemo(
    () => reverseText(input, mode, swapCase, trimEmpty),
    [input, mode, swapCase, trimEmpty],
  );

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
    setCopied(false);
  }, []);

  const handleSample = useCallback(() => {
    setInput('Hello World\n这是一个示例\n第二行文本');
    setNotice('');
  }, []);

  const onInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (notice) setNotice('');
  }, [notice]);

  const charCount = input.length;
  const resultLength = result.length;

  return (
    <div className="revtool">
      {/* 输入区 */}
      <div className="revtool__input-section">
        <div className="revtool__toolbar">
          <label htmlFor="rev-input" className="revtool__label">
            输入文本
            <span className="revtool__stat">{charCount} 字</span>
          </label>
          <div className="revtool__actions">
            <button className="btn btn--sm" onClick={handleSample}>示例</button>
            <button className="btn btn--sm" onClick={handleClear}>清空</button>
          </div>
        </div>
        <textarea
          id="rev-input"
          className="revtool__textarea"
          value={input}
          onChange={onInputChange}
          placeholder="在此输入要反转的文本，支持多行"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          aria-label="输入文本"
        />
      </div>

      {/* 选项区 */}
      <div className="revtool__options">
        <div className="revtool__option-group">
          <span className="revtool__option-label">反转模式</span>
          <div className="revtool__seg" role="group" aria-label="反转模式选择">
            {REVERSE_CONFIGS.map((cfg) => (
              <button
                key={cfg.mode}
                className={`revtool__seg-btn${mode === cfg.mode ? ' is-active' : ''}`}
                onClick={() => setMode(cfg.mode)}
                aria-pressed={mode === cfg.mode}
                title={cfg.desc}
              >
                {cfg.label}
              </button>
            ))}
          </div>
        </div>

        <label className="revtool__check">
          <input type="checkbox" checked={swapCase} onChange={(e) => setSwapCase(e.target.checked)} />
          <span>反转大小写</span>
        </label>

        <label className="revtool__check">
          <input type="checkbox" checked={trimEmpty} onChange={(e) => setTrimEmpty(e.target.checked)} />
          <span>去除空行</span>
        </label>
      </div>

      {/* 结果区 */}
      <div className="revtool__result">
        <div className="revtool__result-header">
          <span className="revtool__result-label">反转结果</span>
          <span className="revtool__stat">{resultLength} 字</span>
          <button
            className="btn btn--sm revtool__copy"
            onClick={handleCopy}
            disabled={!result}
            aria-label="复制结果"
          >
            {copied ? '已复制' : '复制'}
          </button>
        </div>
        <div className="revtool__result-value" aria-live="polite">
          {result || <span className="revtool__result-empty">（输入文本后自动反转）</span>}
        </div>
      </div>

      {/* 状态条 */}
      <div className="revtool__status" role="status" aria-live="polite">
        {notice ? (
          <div className="revtool__notice">{notice}</div>
        ) : (
          <div className="revtool__hint">
            字符反转使用 Unicode 安全的 Array.from 处理，正确支持 Emoji 和代理对。所有数据仅在浏览器本地处理。
          </div>
        )}
      </div>
    </div>
  );
}
