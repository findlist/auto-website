import { useState, useEffect, useCallback } from 'react';
import { copyText } from '../utils/clipboard';
import {
  htmlToMarkdown,
  DEFAULT_HTML_TO_MD_OPTIONS,
  type HtmlToMarkdownOptions,
  type HtmlToMarkdownResult,
} from '../utils/htmlToMarkdown';

/**
 * HTML 转 Markdown 转换工具
 *
 * 设计目标：
 *  - HTML 文档 / 片段 → Markdown 单向转换（与 MarkdownTool 形成双向闭环）
 *  - 可配置标题风格、代码块风格、列表标记、GFM 扩展、行内 HTML 保留等
 *  - 实时预览转换结果 + 统计信息（块数 / 列表项 / 表格 / 代码块 / 链接 / 图片）
 *  - 复制 / 下载 .md 文件 / 示例 / 清空
 *
 * 与现有工具的区别：
 *  - MarkdownTool：Markdown → HTML 预览（写作场景）
 *  - 本工具：HTML → Markdown 转换（网页内容提取、博客迁移、笔记整理场景）
 */

/** 示例 HTML：覆盖标题、段落、列表、代码块、表格、引用、链接、图片等核心语法 */
const EXAMPLE_HTML = `<article>
  <h1>HTML 转 Markdown 完全指南</h1>
  <p>这是一段示例 HTML，包含 <strong>粗体</strong>、<em>斜体</em>、<del>删除线</del> 和 <code>行内代码</code>。</p>
  <h2>核心特性</h2>
  <ul>
    <li>基于浏览器原生 <code>DOMParser</code> 解析</li>
    <li>支持 GFM 任务列表</li>
    <li>
      <input type="checkbox" checked> 已完成项
    </li>
    <li>
      <input type="checkbox"> 待办项
    </li>
  </ul>
  <h3>代码示例</h3>
  <pre><code class="language-javascript">function hello(name) {
  return \`Hello, \${name}!\`;
}</code></pre>
  <blockquote>
    <p>这是引用块的内容，支持嵌套 <a href="https://example.com" title="示例链接">链接</a>。</p>
  </blockquote>
  <table>
    <thead>
      <tr><th>特性</th><th>支持</th></tr>
    </thead>
    <tbody>
      <tr><td>表格</td><td>是</td></tr>
      <tr><td>任务列表</td><td>是</td></tr>
    </tbody>
  </table>
  <hr>
  <p>更多内容请访问 <a href="https://website.niuzi.asia">工具盒子</a>。</p>
</article>`;

/** 标题风格选项 */
const HEADING_OPTIONS = [
  { label: 'ATX（#）', value: 'atx' as const },
  { label: 'Setext（===）', value: 'setext' as const },
];

/** 代码块风格选项 */
const CODE_BLOCK_OPTIONS = [
  { label: '围栏（```）', value: 'fenced' as const },
  { label: '缩进（4 空格）', value: 'indented' as const },
];

/** 无序列表标记选项 */
const BULLET_OPTIONS = [
  { label: '- 减号', value: '-' as const },
  { label: '* 星号', value: '*' as const },
  { label: '+ 加号', value: '+' as const },
];

export default function HtmlToMarkdownTool() {
  const [input, setInput] = useState(EXAMPLE_HTML);
  const [headingStyle, setHeadingStyle] = useState<HtmlToMarkdownOptions['headingStyle']>('atx');
  const [codeBlockStyle, setCodeBlockStyle] = useState<HtmlToMarkdownOptions['codeBlockStyle']>('fenced');
  const [bulletMarker, setBulletMarker] = useState<HtmlToMarkdownOptions['bulletMarker']>('-');
  const [gfm, setGfm] = useState(true);
  const [preserveUnknownTags, setPreserveUnknownTags] = useState(false);
  const [linkWithTitle, setLinkWithTitle] = useState(true);
  const [notice, setNotice] = useState('');

  /** 实时转换结果（useEffect 避免 DOMParser 在服务端渲染时不可用导致的 hydration mismatch） */
  const [result, setResult] = useState<HtmlToMarkdownResult | null>(null);

  useEffect(() => {
    if (!input.trim()) {
      setResult(null);
      return;
    }
    const opts: Partial<HtmlToMarkdownOptions> = {
      headingStyle,
      codeBlockStyle,
      bulletMarker,
      gfm,
      preserveUnknownTags,
      linkWithTitle,
    };
    setResult(htmlToMarkdown(input, opts));
  }, [input, headingStyle, codeBlockStyle, bulletMarker, gfm, preserveUnknownTags, linkWithTitle]);

  /** 复制 Markdown */
  const handleCopy = useCallback(async () => {
    if (!result?.ok || !result.markdown) {
      setNotice('无可复制内容');
      return;
    }
    const ok = await copyText(result.markdown);
    setNotice(ok ? '已复制 Markdown 到剪贴板' : '复制失败，请手动选择');
  }, [result]);

  /** 下载 .md 文件 */
  const handleDownload = useCallback(() => {
    if (!result?.ok || !result.markdown) {
      setNotice('无可下载内容');
      return;
    }
    const blob = new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'converted.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setNotice('已下载 converted.md');
  }, [result]);

  /** 载入示例 */
  const handleExample = useCallback(() => {
    setInput(EXAMPLE_HTML);
    setNotice('已载入示例 HTML');
  }, []);

  /** 清空 */
  const handleClear = useCallback(() => {
    setInput('');
    setNotice('已清空');
  }, []);

  /** 重置选项为默认值 */
  const handleResetOptions = useCallback(() => {
    setHeadingStyle(DEFAULT_HTML_TO_MD_OPTIONS.headingStyle);
    setCodeBlockStyle(DEFAULT_HTML_TO_MD_OPTIONS.codeBlockStyle);
    setBulletMarker(DEFAULT_HTML_TO_MD_OPTIONS.bulletMarker);
    setGfm(DEFAULT_HTML_TO_MD_OPTIONS.gfm);
    setPreserveUnknownTags(DEFAULT_HTML_TO_MD_OPTIONS.preserveUnknownTags);
    setLinkWithTitle(DEFAULT_HTML_TO_MD_OPTIONS.linkWithTitle);
    setNotice('已重置为默认选项');
  }, []);

  const stats = result?.ok ? result.stats : null;
  const hasError = result && !result.ok;
  const hasWarnings = result?.ok && result.warnings.length > 0;

  return (
    <div className="htm__container">
      {/* 选项面板 */}
      <div className="htm__options">
        <div className="htm__option-group">
          <label className="htm__label">标题风格</label>
          <select
            className="htm__select"
            value={headingStyle}
            onChange={(e) => setHeadingStyle(e.target.value as HtmlToMarkdownOptions['headingStyle'])}
          >
            {HEADING_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="htm__option-group">
          <label className="htm__label">代码块</label>
          <select
            className="htm__select"
            value={codeBlockStyle}
            onChange={(e) => setCodeBlockStyle(e.target.value as HtmlToMarkdownOptions['codeBlockStyle'])}
          >
            {CODE_BLOCK_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="htm__option-group">
          <label className="htm__label">列表标记</label>
          <select
            className="htm__select"
            value={bulletMarker}
            onChange={(e) => setBulletMarker(e.target.value as HtmlToMarkdownOptions['bulletMarker'])}
          >
            {BULLET_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="htm__option-group htm__option-group--checkbox">
          <label className="htm__checkbox-label">
            <input
              type="checkbox"
              checked={gfm}
              onChange={(e) => setGfm(e.target.checked)}
            />
            <span>GFM 扩展（表格 / 任务列表 / 删除线）</span>
          </label>
        </div>
        <div className="htm__option-group htm__option-group--checkbox">
          <label className="htm__checkbox-label">
            <input
              type="checkbox"
              checked={linkWithTitle}
              onChange={(e) => setLinkWithTitle(e.target.checked)}
            />
            <span>保留链接 title</span>
          </label>
        </div>
        <div className="htm__option-group htm__option-group--checkbox">
          <label className="htm__checkbox-label">
            <input
              type="checkbox"
              checked={preserveUnknownTags}
              onChange={(e) => setPreserveUnknownTags(e.target.checked)}
            />
            <span>保留未知 HTML 标签</span>
          </label>
        </div>
        <button type="button" className="htm__btn htm__btn--ghost" onClick={handleResetOptions}>
          重置选项
        </button>
      </div>

      {/* 输入 / 输出双栏 */}
      <div className="htm__panels">
        <div className="htm__panel">
          <div className="htm__panel-header">
            <span className="htm__panel-title">HTML 输入</span>
            <div className="htm__panel-actions">
              <button type="button" className="htm__btn htm__btn--ghost" onClick={handleExample}>示例</button>
              <button type="button" className="htm__btn htm__btn--ghost" onClick={handleClear}>清空</button>
            </div>
          </div>
          <textarea
            className="htm__textarea"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="在此粘贴 HTML 代码或网页片段..."
            spellCheck={false}
            aria-label="HTML 输入"
          />
        </div>
        <div className="htm__panel">
          <div className="htm__panel-header">
            <span className="htm__panel-title">Markdown 输出</span>
            <div className="htm__panel-actions">
              <button
                type="button"
                className="htm__btn htm__btn--ghost"
                onClick={handleCopy}
                disabled={!result?.ok}
              >
                复制
              </button>
              <button
                type="button"
                className="htm__btn htm__btn--ghost"
                onClick={handleDownload}
                disabled={!result?.ok}
              >
                下载 .md
              </button>
            </div>
          </div>
          {hasError ? (
            <div className="htm__error" role="alert">
              <strong>解析失败</strong>
              <p>{result?.error}</p>
            </div>
          ) : (
            <textarea
              className="htm__textarea htm__textarea--output"
              value={result?.ok ? result.markdown : ''}
              readOnly
              placeholder="转换结果将在此显示..."
              spellCheck={false}
              aria-label="Markdown 输出"
            />
          )}
        </div>
      </div>

      {/* 统计信息 */}
      {stats && (
        <div className="htm__stats">
          <span className="htm__stat">块级元素：<strong>{stats.blocks}</strong></span>
          <span className="htm__stat">列表项：<strong>{stats.listItems}</strong></span>
          <span className="htm__stat">表格：<strong>{stats.tables}</strong></span>
          <span className="htm__stat">代码块：<strong>{stats.codeBlocks}</strong></span>
          <span className="htm__stat">链接：<strong>{stats.links}</strong></span>
          <span className="htm__stat">图片：<strong>{stats.images}</strong></span>
          <span className="htm__stat">字符数：<strong>{stats.chars}</strong></span>
        </div>
      )}

      {/* 警告列表 */}
      {hasWarnings && (
        <details className="htm__warnings">
          <summary>转换警告（{result!.warnings.length} 条）</summary>
          <ul>
            {result!.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      {/* 操作反馈 */}
      {notice && <div className="htm__notice" role="status">{notice}</div>}
    </div>
  );
}
