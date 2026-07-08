import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';
import { renderText, FONTS, computeStats } from '../utils/asciiArt';

/**
 * ASCII Art 文本横幅生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 输入文本实时渲染为 ASCII Art 横幅
 *  - 3 种字体切换：Block（5 行方块）、Banner（7 行宽幅）、Small（3 行紧凑）
 *  - 字符间距调节（0/1/2 列空格）
 *  - 复制纯文本 / 下载为 .txt 文件
 *  - 输入文本自动转大写（字体仅含大写字母）
 *  - 统计信息：行数、字符数、最大行宽
 *
 * 适用场景：
 *  - GitHub README / 项目文档标题横幅
 *  - 终端启动横幅、CLI 签名
 *  - 控制台输出装饰、注释块标题
 */

const SAMPLE_TEXT = 'Toolbox';

export default function AsciiArtTool() {
  const [input, setInput] = useState<string>('');
  const [fontName, setFontName] = useState<string>('Block');
  const [spacing, setSpacing] = useState<number>(1);
  const [notice, setNotice] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // 实时渲染（算法轻量，无需手动触发）
  const output = useMemo(() => {
    if (input.trim() === '') return '';
    return renderText(input, { font: fontName, charSpacing: spacing });
  }, [input, fontName, spacing]);

  const stats = useMemo(() => computeStats(output), [output]);

  const handleCopy = useCallback(async () => {
    if (!output) return;
    const ok = await copyText(output);
    setCopied(ok);
    setNotice(ok ? '已复制到剪贴板' : '复制失败，请手动选中复制');
    if (ok) setTimeout(() => setCopied(false), 1500);
  }, [output]);

  const handleDownload = useCallback(() => {
    if (!output) return;
    // 生成 Blob 并触发下载（纯前端，零依赖）
    const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ascii-art-${fontName.toLowerCase()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setNotice('已下载文件');
    setTimeout(() => setNotice(''), 1500);
  }, [output, fontName]);

  const handleClear = useCallback(() => {
    setInput('');
    setNotice('');
    setCopied(false);
  }, []);

  const handleSample = useCallback(() => {
    setInput(SAMPLE_TEXT);
    setNotice('');
    setCopied(false);
  }, []);

  const onInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
    if (notice) setNotice('');
  }, [notice]);

  const onFontChange = useCallback((name: string) => {
    setFontName(name);
    setNotice('');
    setCopied(false);
  }, []);

  const onSpacingChange = useCallback((sp: number) => {
    setSpacing(sp);
    setNotice('');
    setCopied(false);
  }, []);

  // 输入字符数统计
  const inputChars = input.length;

  return (
    <div className="jsontool asciitool">
      {/* 工具栏 */}
      <div className="jsontool__toolbar" role="toolbar" aria-label="ASCII Art 操作">
        <div className="jsontool__actions">
          {/* 字体切换分段控件 */}
          <div className="asciitool__seg" role="group" aria-label="字体">
            {FONTS.map((f) => (
              <button
                key={f.name}
                className={`btn btn--sm${fontName === f.name ? ' btn--primary' : ''}`}
                aria-pressed={fontName === f.name}
                onClick={() => onFontChange(f.name)}
                title={`${f.name} 字体（${f.height} 行高）`}
              >
                {f.name}
              </button>
            ))}
          </div>
          {/* 字符间距切换 */}
          <div className="asciitool__seg" role="group" aria-label="字符间距">
            <span className="asciitool__seg-label">间距</span>
            {[0, 1, 2].map((sp) => (
              <button
                key={sp}
                className={`btn btn--sm${spacing === sp ? ' btn--primary' : ''}`}
                aria-pressed={spacing === sp}
                onClick={() => onSpacingChange(sp)}
                title={`字符间 ${sp} 个空格`}
              >
                {sp}
              </button>
            ))}
          </div>
          <button className="btn btn--sm" onClick={handleSample} title="填入示例文本">
            示例
          </button>
          <button className="btn btn--sm" onClick={handleClear} title="清空输入与输出">
            清空
          </button>
        </div>
      </div>

      {/* 主体区域：上下双栏（输入 + 输出） */}
      <div className="jsontool__main asciitool__main">
        {/* 输入区 */}
        <div className="jsontool__panel">
          <div className="jsontool__panel-head">
            <label htmlFor="ascii-input" className="jsontool__label">
              输入文本
            </label>
            <span className="jsontool__stat">{inputChars} 字符 · 自动转大写</span>
          </div>
          <input
            id="ascii-input"
            type="text"
            className="jsontool__input asciitool__input"
            value={input}
            onChange={onInputChange}
            placeholder="输入英文、数字、常用标点（自动转大写）"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="asciitool__hint">
            支持字符：A-Z、0-9、空格、! ? . , - _ : ; ' " ( ) / \ @ # $ % &amp; * + = ~ ^ &lt; &gt; [ ]
            （未覆盖字符将以 ? 占位）
          </p>
        </div>

        {/* 输出区 */}
        <div className="jsontool__panel">
          <div className="jsontool__panel-head">
            <span className="jsontool__label">ASCII Art 横幅</span>
            <div className="jsontool__actions">
              <button
                className="btn btn--sm"
                onClick={handleCopy}
                disabled={!output}
                title="复制纯文本到剪贴板"
              >
                {copied ? '已复制' : '复制'}
              </button>
              <button
                className="btn btn--sm"
                onClick={handleDownload}
                disabled={!output}
                title="下载为 .txt 文件"
              >
                下载
              </button>
            </div>
          </div>
          {output ? (
            <pre className="asciitool__output" aria-label="ASCII Art 输出">
              {output}
            </pre>
          ) : (
            <div className="jsontool__empty" role="status">
              <p>ASCII Art 横幅将显示在这里</p>
              <p className="jsontool__empty-hint">点击「示例」快速预览效果</p>
            </div>
          )}
          {output && (
            <div className="asciitool__stats">
              <span>{stats.lines} 行</span>
              <span>{stats.chars} 字符</span>
              <span>最大行宽 {stats.maxLineWidth}</span>
            </div>
          )}
        </div>
      </div>

      {/* 操作提示 */}
      {notice && (
        <div className="jsontool__notice" role="status" aria-live="polite">
          {notice}
        </div>
      )}
    </div>
  );
}
