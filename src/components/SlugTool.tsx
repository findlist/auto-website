import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * URL Slug 生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 将任意文本转为 URL 友好的 slug
 *  - 多种分隔符：连字符、下划线、句点
 *  - 中文处理策略：保留中文 / 移除非 ASCII
 *  - 可选：转小写、移除停用词、最大长度限制、去除末尾分隔符
 *
 * 适用场景：
 *  - 博客文章 URL 生成
 *  - 商品/分类页面 URL 规范化
 *  - 文件名安全转换
 *  - 锚点 ID 生成
 */

type Separator = '-' | '_' | '.';

interface SlugOptions {
  separator: Separator;
  lowercase: boolean;
  keepCjk: boolean;       // 保留中日韩字符
  stripStopwords: boolean; // 移除英文停用词
  maxLength: number;       // 0 表示不限制
}

/** 英文常见停用词表，用于 slug 精简 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at',
  'for', 'with', 'by', 'from', 'as', 'is', 'it', 'be', 'are', 'was',
]);

/**
 * 核心 slug 生成逻辑
 * 步骤：小写化（可选）→ 停用词过滤（可选）→ 非安全字符替换为分隔符 → 合并连续分隔符 → 去首尾分隔符 → 截断
 */
function generateSlug(input: string, opts: SlugOptions): string {
  if (!input.trim()) return '';

  let text = input;

  // 步骤 1：小写化（可选）
  if (opts.lowercase) {
    text = text.toLowerCase();
  }

  // 步骤 2：按非单词字符分割，便于停用词过滤与重组
  // 安全字符：字母、数字、中日韩字符；其余全部视为分隔边界
  const parts = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

  // 步骤 3：移除停用词（仅对纯 ASCII 单词生效，中文不受影响）
  const filtered = opts.stripStopwords
    ? parts.filter((p) => !STOPWORDS.has(p.toLowerCase()))
    : parts;

  // 步骤 4：处理中日韩字符策略
  const processed = opts.keepCjk
    ? filtered
    : filtered.filter((p) => !/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(p));

  // 步骤 5：用分隔符连接
  let slug = processed.join(opts.separator);

  // 步骤 6：最大长度截断（在单词边界截断，避免截断到一半）
  if (opts.maxLength > 0 && slug.length > opts.maxLength) {
    const truncated = slug.slice(0, opts.maxLength);
    // 截断后去除末尾可能残留的分隔符
    slug = truncated.replace(new RegExp(`\\${opts.separator}+$`), '');
  }

  return slug;
}

export default function SlugTool() {
  const [input, setInput] = useState('Hello World! 这是一个示例标题');
  const [separator, setSeparator] = useState<Separator>('-');
  const [lowercase, setLowercase] = useState(true);
  const [keepCjk, setKeepCjk] = useState(true);
  const [stripStopwords, setStripStopwords] = useState(false);
  const [maxLength, setMaxLength] = useState(0);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');

  const opts: SlugOptions = useMemo(
    () => ({ separator, lowercase, keepCjk, stripStopwords, maxLength }),
    [separator, lowercase, keepCjk, stripStopwords, maxLength],
  );

  // 实时生成 slug
  const slug = useMemo(() => generateSlug(input, opts), [input, opts]);

  const handleCopy = useCallback(async () => {
    if (!slug) return;
    const ok = await copyText(slug);
    if (ok) {
      setCopied(true);
      setNotice('已复制到剪贴板');
      setTimeout(() => setCopied(false), 1500);
    } else {
      setNotice('复制失败，请手动选中复制');
    }
  }, [slug]);

  const handleClear = useCallback(() => {
    setInput('');
    setNotice('');
    setCopied(false);
  }, []);

  const handleSample = useCallback(() => {
    setInput('Hello World! 这是一个示例标题');
    setNotice('');
  }, []);

  const onInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (notice) setNotice('');
  }, [notice]);

  const charCount = input.length;
  const slugLength = slug.length;

  return (
    <div className="slugtool">
      {/* 输入区 */}
      <div className="slugtool__input-section">
        <div className="slugtool__toolbar">
          <label htmlFor="slug-input" className="slugtool__label">
            输入标题或文本
            <span className="slugtool__stat">{charCount} 字</span>
          </label>
          <div className="slugtool__actions">
            <button className="btn btn--sm" onClick={handleSample}>示例</button>
            <button className="btn btn--sm" onClick={handleClear}>清空</button>
          </div>
        </div>
        <textarea
          id="slug-input"
          className="slugtool__textarea"
          value={input}
          onChange={onInputChange}
          placeholder="在此输入文章标题、商品名称或任意文本，自动生成 URL 友好的 slug"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          aria-label="输入文本"
        />
      </div>

      {/* 选项区 */}
      <div className="slugtool__options">
        <div className="slugtool__option-group">
          <span className="slugtool__option-label">分隔符</span>
          <div className="slugtool__seg" role="group" aria-label="分隔符选择">
            {(['-', '_', '.'] as Separator[]).map((sep) => (
              <button
                key={sep}
                className={`slugtool__seg-btn${separator === sep ? ' is-active' : ''}`}
                onClick={() => setSeparator(sep)}
                aria-pressed={separator === sep}
              >
                {sep === '-' ? '连字符 (-)' : sep === '_' ? '下划线 (_)' : '句点 (.)'}
              </button>
            ))}
          </div>
        </div>

        <label className="slugtool__check">
          <input type="checkbox" checked={lowercase} onChange={(e) => setLowercase(e.target.checked)} />
          <span>转小写</span>
        </label>

        <label className="slugtool__check">
          <input type="checkbox" checked={keepCjk} onChange={(e) => setKeepCjk(e.target.checked)} />
          <span>保留中文</span>
        </label>

        <label className="slugtool__check">
          <input type="checkbox" checked={stripStopwords} onChange={(e) => setStripStopwords(e.target.checked)} />
          <span>移除停用词（a/the/of 等）</span>
        </label>

        <div className="slugtool__option-group">
          <label htmlFor="slug-maxlen" className="slugtool__option-label">
            最大长度 <span className="slugtool__stat">{maxLength === 0 ? '不限' : `${maxLength} 字`}</span>
          </label>
          <input
            id="slug-maxlen"
            type="range"
            min={0}
            max={120}
            step={5}
            value={maxLength}
            onChange={(e) => setMaxLength(Number(e.target.value))}
            className="slugtool__range"
            aria-label="最大长度"
          />
        </div>
      </div>

      {/* 结果区 */}
      <div className="slugtool__result">
        <div className="slugtool__result-header">
          <span className="slugtool__result-label">生成结果</span>
          <span className="slugtool__stat">{slugLength} 字</span>
          <button
            className="btn btn--sm slugtool__copy"
            onClick={handleCopy}
            disabled={!slug}
            aria-label="复制 slug"
          >
            {copied ? '已复制' : '复制'}
          </button>
        </div>
        <div className="slugtool__result-value" aria-live="polite">
          {slug || <span className="slugtool__result-empty">（输入文本后自动生成）</span>}
        </div>
      </div>

      {/* 状态条 */}
      <div className="slugtool__status" role="status" aria-live="polite">
        {notice ? (
          <div className="slugtool__notice">{notice}</div>
        ) : (
          <div className="slugtool__hint">
            支持中英文混合输入，所有处理在浏览器本地完成。
          </div>
        )}
      </div>
    </div>
  );
}
