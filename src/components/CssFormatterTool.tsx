import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';
import {
  prettyPrint,
  minify,
  lint,
  compressionRatio,
  computeTextStats,
  type CssPrettyOptions,
} from '../utils/cssFormatter';

/**
 * CSS 格式化与压缩工具
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 美化（Pretty）：按嵌套层级缩进，每条声明独占一行，可选保留注释、选择器换行
 *  - 压缩（Minify）：移除注释与多余空白，省略末尾分号
 *  - 校验（Lint）：输出规则/声明/注释统计与可疑问题清单
 *  - 复制 / 清空 / 示例
 *  - 统计：输入字符数、输出字符数、压缩率
 */

type Mode = 'pretty' | 'minify' | 'lint';
type IndentType = '2' | '4' | 'tab';

// 示例 CSS：覆盖普通规则、@media 嵌套、注释、!important 等场景
const SAMPLE_INPUT = `/* 基础样式 */.container{max-width:1200px;margin:0 auto;padding:0 16px}.btn{display:inline-block;padding:8px 16px;background:#0969da;color:#fff;border:none;border-radius:6px;cursor:pointer}.btn:hover{background:#0860c4!important}@media (max-width:768px){.container{padding:0 12px}.btn{display:block;width:100%}}`;

export default function CssFormatterTool() {
  const [mode, setMode] = useState<Mode>('pretty');
  const [input, setInput] = useState<string>('');
  const [indentType, setIndentType] = useState<IndentType>('2');
  const [preserveComments, setPreserveComments] = useState(true);
  const [selectorOnNewLine, setSelectorOnNewLine] = useState(false);
  const [removeComments, setRemoveComments] = useState(true);
  const [removeLastSemicolon, setRemoveLastSemicolon] = useState(true);
  const [notice, setNotice] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // 缩进字符串：2/4 空格或 Tab
  const indentStr = useMemo(() => {
    if (indentType === 'tab') return '\t';
    return indentType === '4' ? '    ' : '  ';
  }, [indentType]);

  // 实时计算结果
  const result = useMemo(() => {
    if (input.trim() === '') {
      return { ok: true, value: '', error: '' };
    }
    if (mode === 'pretty') {
      const opts: Partial<CssPrettyOptions> = {
        indent: indentStr,
        preserveComments,
        selectorOnNewLine,
      };
      return prettyPrint(input, opts);
    }
    if (mode === 'minify') {
      return minify(input, { removeComments, removeLastSemicolon });
    }
    return lint(input);
  }, [
    input, mode, indentStr, preserveComments, selectorOnNewLine,
    removeComments, removeLastSemicolon,
  ]);

  const output = result.value;
  const error = !result.ok ? result.error : '';
  const inputStats = useMemo(() => computeTextStats(input), [input]);
  const outputStats = useMemo(() => computeTextStats(output), [output]);
  const ratio = useMemo(() => {
    if (mode !== 'minify' || input.length === 0 || output.length === 0) return null;
    return compressionRatio(input, output);
  }, [mode, input, output]);

  const handleCopy = useCallback(async () => {
    if (!output) return;
    const ok = await copyText(output);
    setCopied(ok);
    setNotice(ok ? '已复制到剪贴板' : '复制失败，请手动选中复制');
    if (ok) setTimeout(() => setCopied(false), 1500);
  }, [output]);

  const handleClear = useCallback(() => {
    setInput('');
    setNotice('');
    setCopied(false);
  }, []);

  const handleSample = useCallback(() => {
    setInput(SAMPLE_INPUT);
    setNotice('');
    setCopied(false);
  }, []);

  const onModeChange = useCallback((m: Mode) => {
    setMode(m);
    setNotice('');
    setCopied(false);
  }, []);

  const onInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (notice) setNotice('');
  }, [notice]);

  const modeLabel: Record<Mode, string> = {
    pretty: '美化（缩进）',
    minify: '压缩（精简）',
    lint: '校验（分析）',
  };

  return (
    <div className="jsontool cssfmt">
      {/* 工具栏 */}
      <div className="jsontool__toolbar" role="toolbar" aria-label="CSS 格式化操作">
        <div className="jsontool__actions">
          <div className="cssfmt__seg" role="group" aria-label="操作模式">
            {(['pretty', 'minify', 'lint'] as Mode[]).map((m) => (
              <button
                key={m}
                className={`btn btn--sm${mode === m ? ' btn--primary' : ''}`}
                aria-pressed={mode === m}
                onClick={() => onModeChange(m)}
              >
                {modeLabel[m]}
              </button>
            ))}
          </div>
        </div>
        <div className="jsontool__options">
          <button className="btn btn--sm" onClick={handleSample}>示例</button>
          <button className="btn btn--sm" onClick={handleClear}>清空</button>
        </div>
      </div>

      {/* 美化模式选项 */}
      {mode === 'pretty' && (
        <div className="cssfmt__options" role="group" aria-label="美化选项">
          <label className="cssfmt__toggle">
            <span>缩进</span>
            <select
              value={indentType}
              onChange={(e) => setIndentType(e.target.value as IndentType)}
              aria-label="缩进宽度"
            >
              <option value="2">2 空格</option>
              <option value="4">4 空格</option>
              <option value="tab">Tab</option>
            </select>
          </label>
          <label className="cssfmt__toggle">
            <input
              type="checkbox"
              checked={preserveComments}
              onChange={(e) => setPreserveComments(e.target.checked)}
            />
            保留注释
          </label>
          <label className="cssfmt__toggle">
            <input
              type="checkbox"
              checked={selectorOnNewLine}
              onChange={(e) => setSelectorOnNewLine(e.target.checked)}
            />
            选择器换行
          </label>
        </div>
      )}

      {/* 压缩模式选项 */}
      {mode === 'minify' && (
        <div className="cssfmt__options" role="group" aria-label="压缩选项">
          <label className="cssfmt__toggle">
            <input
              type="checkbox"
              checked={removeComments}
              onChange={(e) => setRemoveComments(e.target.checked)}
            />
            移除注释
          </label>
          <label className="cssfmt__toggle">
            <input
              type="checkbox"
              checked={removeLastSemicolon}
              onChange={(e) => setRemoveLastSemicolon(e.target.checked)}
            />
            省略末尾分号
          </label>
        </div>
      )}

      {/* 输入区 */}
      <div className="cssfmt__field">
        <label htmlFor="cssfmt-input" className="jsontool__label">
          输入 CSS
          <span className="jsontool__stat">{inputStats.chars} 字 · {inputStats.lines} 行</span>
        </label>
        <textarea
          id="cssfmt-input"
          className="cssfmt__textarea"
          value={input}
          onChange={onInputChange}
          placeholder="粘贴或输入 CSS 代码..."
          spellCheck={false}
          autoComplete="off"
          aria-label="输入 CSS 代码"
          rows={10}
        />
      </div>

      {/* 输出区 */}
      <div className="cssfmt__field">
        <div className="jsontool__label">
          <span>{modeLabel[mode]} 结果</span>
          <span className="jsontool__stat">{outputStats.chars} 字 · {outputStats.lines} 行</span>
          {ratio !== null && (
            <span className="cssfmt__ratio">压缩率 {ratio}%</span>
          )}
          <button
            className="btn btn--sm jsontool__copy"
            onClick={handleCopy}
            disabled={!output}
            aria-label="复制输出"
          >
            {copied ? '已复制' : '复制'}
          </button>
        </div>
        <pre
          className={`cssfmt__output${mode === 'lint' ? ' cssfmt__output--report' : ''}`}
          aria-label="格式化结果"
        >
          {output || (input ? '' : '结果将显示在这里')}
        </pre>
      </div>

      {/* 状态条 */}
      <div className="jsontool__status" role="status" aria-live="polite">
        {error ? (
          <div className="jsontool__error">
            <strong>❌ 错误</strong>
            <span>{error}</span>
          </div>
        ) : notice ? (
          <div className="jsontool__notice">{notice}</div>
        ) : (
          <div className="jsontool__hint">
            所有数据仅在你浏览器内处理，不会上传到任何服务器。手写 CSS 词法分析器，支持嵌套 at-rule 与 @keyframes。
          </div>
        )}
      </div>
    </div>
  );
}
