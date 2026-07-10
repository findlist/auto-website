import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * 文本截断工具
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 三种截断方式：按字符数（Unicode 码点）、按字节数（UTF-8）、按行数
 *  - 可选省略号：默认 "..."，可自定义
 *  - 可选保留单词边界：截断后回退到最近的空格，避免单词被截断
 *
 * 适用场景：摘要生成、输入框字数限制、数据库字段截断、SEO meta description 长度控制
 */

type TruncateMode = 'chars'   // 按 Unicode 码点数截断（正确处理 Emoji）
  | 'bytes'                     // 按 UTF-8 字节数截断
  | 'lines';                    // 按行数截断

interface TruncateOptions {
  mode: TruncateMode;
  limit: number;              // 截断限制值
  ellipsis: string;           // 省略号字符串（空表示不加省略号）
  keepWord: boolean;          // 保留单词边界
}

const SAMPLE_TEXT = `JavaScript（简称 JS）是一种轻量级、解释型或即时编译型的编程语言。虽然它是作为开发 Web 页面的脚本语言而出名，但它已经超越了浏览器，被用到了许多其他环境中，如 Node.js、Apache CouchDB 和 Adobe Acrobat。

JavaScript 是一门基于原型的、多范式的动态语言，支持面向对象、命令式和声明式（如函数式编程）风格。

JavaScript 的标准是 ECMAScript。截至 2026 年，最新版本为 ES2026。`;

/**
 * 按字符数（Unicode 码点）截断
 * 使用 Array.from 按 Unicode 码点遍历，正确处理 Emoji 等代理对字符
 */
function truncateByChars(input: string, limit: number, ellipsis: string, keepWord: boolean): string {
  const chars = Array.from(input);
  if (chars.length <= limit) return input;
  // 省略号占用的字符数需从 limit 中扣除
  const ellipsisLen = Array.from(ellipsis).length;
  const effectiveLimit = ellipsis ? Math.max(0, limit - ellipsisLen) : limit;
  let sliced = chars.slice(0, effectiveLimit).join('');
  // 保留单词边界：回退到最近的空格，避免单词被截断
  if (keepWord && effectiveLimit > 0 && effectiveLimit < chars.length) {
    sliced = retreatToWordBoundary(chars, effectiveLimit);
  }
  return ellipsis ? sliced + ellipsis : sliced;
}

/**
 * 在字符数组中从 limit 位置向前回退到最近的单词边界（空格）
 * 避免在单词中间截断
 */
function retreatToWordBoundary(chars: string[], limit: number): string {
  // 如果当前字符是空格或下一个字符是空格，无需回退
  if (limit > 0 && /\s/.test(chars[limit])) {
    return chars.slice(0, limit).join('').replace(/\s+$/, '');
  }
  // 向前查找最近的空格
  for (let i = limit - 1; i > 0; i--) {
    if (/\s/.test(chars[i])) {
      return chars.slice(0, i).join('').replace(/\s+$/, '');
    }
  }
  // 找不到空格（整段无空格，如纯中文），按原 limit 截断
  return chars.slice(0, limit).join('');
}

/**
 * 按字节数（UTF-8）截断
 * 用 TextEncoder 编码后按字节切片，回退到完整字符边界
 */
function truncateByBytes(input: string, limit: number, ellipsis: string, keepWord: boolean): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(input);
  if (bytes.length <= limit) return input;
  const ellipsisBytes = encoder.encode(ellipsis);
  const effectiveLimit = ellipsis ? Math.max(0, limit - ellipsisBytes.length) : limit;
  // 从 effectiveLimit 位置向前回退到字符边界（TextDecoder 能成功解码的位置）
  const decoder = new TextDecoder();
  let byteLimit = effectiveLimit;
  // 逐字节回退，直到能成功解码为完整字符串
  while (byteLimit > 0) {
    try {
      const partial = decoder.decode(bytes.slice(0, byteLimit), { stream: false });
      // 验证解码结果不是空（可能回退到了无效的 UTF-8 序列中间）
      if (partial.length > 0 || byteLimit === 0) {
        let result = partial;
        // 保留单词边界
        if (keepWord) {
          const chars = Array.from(result);
          // 检查截断位置是否在单词中间（当前字节恰好是字符边界）
          const nextChar = decoder.decode(bytes.slice(byteLimit, byteLimit + 4), { stream: false });
          if (nextChar && !/\s/.test(nextChar[0])) {
            result = retreatToWordBoundary(chars, chars.length);
          }
        }
        return ellipsis ? result + ellipsis : result;
      }
    } catch {
      // 解码失败，继续回退
    }
    byteLimit--;
  }
  return ellipsis ?? '';
}

/**
 * 按行数截断
 */
function truncateByLines(input: string, limit: number, ellipsis: string): string {
  const lines = input.split(/\r?\n/);
  if (lines.length <= limit) return input;
  const sliced = lines.slice(0, limit).join('\n');
  return ellipsis ? sliced + '\n' + ellipsis : sliced;
}

/**
 * 核心截断逻辑分发
 */
function truncateText(input: string, opts: TruncateOptions): string {
  if (!input || opts.limit <= 0) return '';
  switch (opts.mode) {
    case 'chars':
      return truncateByChars(input, opts.limit, opts.ellipsis, opts.keepWord);
    case 'bytes':
      return truncateByBytes(input, opts.limit, opts.ellipsis, opts.keepWord);
    case 'lines':
      return truncateByLines(input, opts.limit, opts.ellipsis);
  }
}

export default function TruncateTool() {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<TruncateMode>('chars');
  const [limit, setLimit] = useState(50);
  const [useEllipsis, setUseEllipsis] = useState(true);
  const [ellipsis, setEllipsis] = useState('...');
  const [keepWord, setKeepWord] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');

  const opts: TruncateOptions = {
    mode,
    limit,
    ellipsis: useEllipsis ? ellipsis : '',
    keepWord,
  };

  // 实时计算截断结果
  const result = useMemo(() => {
    if (!input) return '';
    return truncateText(input, opts);
  }, [input, mode, limit, useEllipsis, ellipsis, keepWord]);

  // 统计原始与结果的字符数/字节数/行数
  const inputStats = useMemo(() => {
    if (!input) return { chars: 0, bytes: 0, lines: 0 };
    return {
      chars: Array.from(input).length,
      bytes: new TextEncoder().encode(input).length,
      lines: input.split(/\r?\n/).length,
    };
  }, [input]);

  const resultStats = useMemo(() => {
    if (!result) return { chars: 0, bytes: 0, lines: 0 };
    return {
      chars: Array.from(result).length,
      bytes: new TextEncoder().encode(result).length,
      lines: result.split(/\r?\n/).length,
    };
  }, [result]);

  const isTruncated = result !== input && input !== '';

  const handleCopy = useCallback(async () => {
    if (!result) return;
    const ok = await copyText(result);
    if (ok) {
      setCopied(true);
      setNotice('已复制截断结果到剪贴板');
      setTimeout(() => setCopied(false), 1500);
      setTimeout(() => setNotice(''), 3000);
    } else {
      setNotice('复制失败，请手动选择文本复制');
      setTimeout(() => setNotice(''), 3000);
    }
  }, [result]);

  const handleClear = useCallback(() => {
    setInput('');
    setNotice('');
  }, []);

  const handleSample = useCallback(() => {
    setInput(SAMPLE_TEXT);
    setMode('chars');
    setLimit(50);
    setUseEllipsis(true);
    setEllipsis('...');
    setKeepWord(false);
    setNotice('');
  }, []);

  const limitLabel = mode === 'chars' ? '字符数' : mode === 'bytes' ? '字节数' : '行数';
  const limitMin = 1;
  const limitMax = mode === 'lines' ? 10000 : 100000;

  return (
    <div className="trunc">
      {/* 输入区 */}
      <div className="trunc__input-section">
        <div className="trunc__toolbar">
          <span className="trunc__label">
            原始文本
            <span className="trunc__stat">
              {inputStats.chars} 字符 / {inputStats.bytes} 字节 / {inputStats.lines} 行
            </span>
          </span>
          <div className="trunc__actions">
            <button className="btn btn--sm" onClick={handleSample}>示例</button>
            <button className="btn btn--sm" onClick={handleClear}>清空</button>
          </div>
        </div>
        <textarea
          className="trunc__textarea"
          placeholder="粘贴需要截断的文本&#10;支持按字符数、字节数、行数三种方式截断"
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          spellCheck={false}
        />
      </div>

      {/* 截断配置区 */}
      <div className="trunc__config">
        <fieldset className="trunc__fieldset">
          <legend className="trunc__legend">截断方式</legend>
          <label className="trunc__radio">
            <input
              type="radio"
              name="trunc-mode"
              value="chars"
              checked={mode === 'chars'}
              onChange={() => setMode('chars')}
            />
            按字符数（Unicode 码点）
          </label>
          <label className="trunc__radio">
            <input
              type="radio"
              name="trunc-mode"
              value="bytes"
              checked={mode === 'bytes'}
              onChange={() => setMode('bytes')}
            />
            按字节数（UTF-8）
          </label>
          <label className="trunc__radio">
            <input
              type="radio"
              name="trunc-mode"
              value="lines"
              checked={mode === 'lines'}
              onChange={() => setMode('lines')}
            />
            按行数
          </label>
        </fieldset>

        <div className="trunc__limit-row">
          <label className="trunc__field" htmlFor="trunc-limit">
            <span className="trunc__field-label">截断{limitLabel}</span>
            <input
              id="trunc-limit"
              type="number"
              className="trunc__input"
              min={limitMin}
              max={limitMax}
              value={limit}
              onChange={(e) => {
                const v = parseInt(e.currentTarget.value, 10);
                if (!isNaN(v)) setLimit(Math.max(limitMin, Math.min(limitMax, v)));
              }}
            />
          </label>
          <div className="trunc__options-group">
            <label className="trunc__check">
              <input
                type="checkbox"
                checked={useEllipsis}
                onChange={(e) => setUseEllipsis(e.currentTarget.checked)}
              />
              添加省略号
            </label>
            {useEllipsis && (
              <label className="trunc__field trunc__field--inline">
                <span className="trunc__field-label">省略号文本</span>
                <input
                  type="text"
                  className="trunc__input trunc__input--sm"
                  value={ellipsis}
                  onChange={(e) => setEllipsis(e.currentTarget.value)}
                  maxLength={10}
                />
              </label>
            )}
            {mode !== 'lines' && (
              <label className="trunc__check">
                <input
                  type="checkbox"
                  checked={keepWord}
                  onChange={(e) => setKeepWord(e.currentTarget.checked)}
                />
                保留单词边界
              </label>
            )}
          </div>
        </div>
      </div>

      {/* 统计区 */}
      <div className="trunc__stats">
        <div className="trunc__stat-item">
          <span className="trunc__stat-num">{inputStats.chars}</span>
          <span className="trunc__stat-label">原始字符</span>
        </div>
        <div className="trunc__stat-item">
          <span className="trunc__stat-num">{resultStats.chars}</span>
          <span className="trunc__stat-label">结果字符</span>
        </div>
        <div className="trunc__stat-item">
          <span className="trunc__stat-num">{resultStats.bytes}</span>
          <span className="trunc__stat-label">结果字节</span>
        </div>
        <div className="trunc__stat-item">
          <span className="trunc__stat-num">{isTruncated ? '是' : '否'}</span>
          <span className="trunc__stat-label">已截断</span>
        </div>
      </div>

      {/* 结果区 */}
      <div className="trunc__result-section">
        <div className="trunc__toolbar">
          <span className="trunc__label">
            截断结果
            <span className="trunc__stat">
              {isTruncated ? `已截断至 ${limit} ${limitLabel}` : '无需截断'}
            </span>
          </span>
          <div className="trunc__actions">
            <button
              className={`btn btn--sm${copied ? ' btn--success' : ''}`}
              onClick={handleCopy}
              disabled={!result}
            >
              {copied ? '已复制' : '复制结果'}
            </button>
          </div>
        </div>
        {result ? (
          <div className="trunc__result">{result}</div>
        ) : (
          <div className="trunc__result trunc__result-empty">
            {input ? '请设置截断限制后查看结果' : '请先输入原始文本'}
          </div>
        )}
      </div>

      {/* 状态提示 */}
      {notice && <div className="trunc__notice">{notice}</div>}
      {!notice && !input && (
        <div className="trunc__hint">提示：点击「示例」体验按字符数截断 JavaScript 介绍文本</div>
      )}
    </div>
  );
}
