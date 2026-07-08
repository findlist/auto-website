import { useState, useMemo, useCallback, useEffect } from 'react';
import { copyText } from '../utils/clipboard';
import {
  formatSql,
  minifySql,
  validateSql,
  highlightSql,
  countStats,
  SQL_PRESETS,
  DEFAULT_FORMAT_OPTIONS,
  type FormatOptions,
  type ValidationResult,
} from '../utils/sql';

/** 工具模式：format 美化 / minify 压缩 */
type Mode = 'format' | 'minify';

/** 复制状态 */
type CopyStatus = 'idle' | 'success' | 'fail';

/**
 * SQL 格式化与压缩工具组件
 *
 * 设计要点：
 *  - 初始用固定 SQL 串（与 SSR 一致），避免水合不一致
 *  - 输入 → 实时格式化 / 压缩 / 校验 / 高亮（useMemo 缓存）
 *  - 6 个预设按钮快速载入示例
 *  - 格式化选项可调（关键字大小写、换行规则、缩进、逗号样式）
 *  - 移动端响应式：上下双栏，桌面端左右双栏
 */
export default function SqlTool() {
  // 初始用固定 SQL，避免 SSR 水合不一致
  const [input, setInput] = useState<string>(SQL_PRESETS[0].sql);
  const [mode, setMode] = useState<Mode>('format');
  const [options, setOptions] = useState<FormatOptions>(DEFAULT_FORMAT_OPTIONS);
  const [removeComments, setRemoveComments] = useState(false);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');

  // 实时计算格式化 / 压缩结果
  const output = useMemo(() => {
    if (!input.trim()) return '';
    try {
      if (mode === 'format') {
        return formatSql(input, options);
      }
      return minifySql(input, removeComments);
    } catch {
      return '';
    }
  }, [input, mode, options, removeComments]);

  // 实时校验
  const validation: ValidationResult = useMemo(
    () => validateSql(input),
    [input],
  );

  // 高亮 HTML
  const highlightedHtml = useMemo(
    () => highlightSql(output),
    [output],
  );

  // 统计信息
  const stats = useMemo(() => countStats(output), [output]);

  // 复制结果
  const handleCopy = useCallback(async () => {
    if (!output) return;
    const ok = await copyText(output);
    setCopyStatus(ok ? 'success' : 'fail');
    setTimeout(() => setCopyStatus('idle'), 1500);
  }, [output]);

  // 清空输入
  const handleClear = useCallback(() => {
    setInput('');
    setCopyStatus('idle');
  }, []);

  // 载入预设
  const handlePreset = useCallback((sql: string) => {
    setInput(sql);
    setCopyStatus('idle');
  }, []);

  // 一键美化 / 压缩切换
  const handleModeChange = (next: Mode) => {
    setMode(next);
    setCopyStatus('idle');
  };

  // 选项更新辅助
  const updateOption = <K extends keyof FormatOptions>(
    key: K,
    value: FormatOptions[K],
  ) => {
    setOptions(prev => ({ ...prev, [key]: value }));
  };

  // 同步输出回输入（将格式化结果作为新输入）
  const handleApply = useCallback(() => {
    if (!output) return;
    setInput(output);
    setCopyStatus('idle');
  }, [output]);

  // 复制状态文本
  const copyLabel = copyStatus === 'success'
    ? '已复制'
    : copyStatus === 'fail'
    ? '复制失败'
    : '复制结果';

  return (
    <div className="sqltool">
      {/* 模式切换 */}
      <div className="sqltool__mode-bar" role="tablist" aria-label="操作模式">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'format'}
          className={`sqltool__mode-btn ${mode === 'format' ? 'is-active' : ''}`}
          onClick={() => handleModeChange('format')}
        >
          美化格式化
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'minify'}
          className={`sqltool__mode-btn ${mode === 'minify' ? 'is-active' : ''}`}
          onClick={() => handleModeChange('minify')}
        >
          压缩为一行
        </button>
      </div>

      {/* 预设按钮 */}
      <div className="sqltool__presets" aria-label="预设示例">
        {SQL_PRESETS.map(p => (
          <button
            key={p.id}
            type="button"
            className="sqltool__preset-btn"
            onClick={() => handlePreset(p.sql)}
            aria-label={`载入预设：${p.label}，${p.description}`}
            title={p.description}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* 格式化选项（仅 format 模式显示） */}
      {mode === 'format' && (
        <details className="sqltool__options" aria-label="格式化选项">
          <summary>格式化选项</summary>
          <div className="sqltool__options-grid">
            <label className="sqltool__option">
              <span>关键字大小写</span>
              <select
                value={options.keywordCase}
                onChange={e => updateOption('keywordCase', e.target.value as FormatOptions['keywordCase'])}
                aria-label="关键字大小写"
              >
                <option value="upper">大写（SELECT）</option>
                <option value="lower">小写（select）</option>
                <option value="preserve">保持原样</option>
              </select>
            </label>
            <label className="sqltool__option">
              <span>缩进</span>
              <select
                value={String(options.indent)}
                onChange={e => updateOption('indent', Number(e.target.value) as 2 | 4)}
                aria-label="缩进空格数"
              >
                <option value="2">2 空格</option>
                <option value="4">4 空格</option>
              </select>
            </label>
            <label className="sqltool__option">
              <span>逗号样式</span>
              <select
                value={options.commaStyle}
                onChange={e => updateOption('commaStyle', e.target.value as FormatOptions['commaStyle'])}
                aria-label="逗号样式"
              >
                <option value="space">逗号后空格</option>
                <option value="newline">逗号后换行</option>
              </select>
            </label>
            <label className="sqltool__option sqltool__option--check">
              <input
                type="checkbox"
                checked={options.newLineBeforeMajorClause}
                onChange={e => updateOption('newLineBeforeMajorClause', e.target.checked)}
              />
              <span>主子句前换行</span>
            </label>
            <label className="sqltool__option sqltool__option--check">
              <input
                type="checkbox"
                checked={options.newLineBeforeJoin}
                onChange={e => updateOption('newLineBeforeJoin', e.target.checked)}
              />
              <span>JOIN 前换行</span>
            </label>
            <label className="sqltool__option sqltool__option--check">
              <input
                type="checkbox"
                checked={options.newLineBeforeAndOr}
                onChange={e => updateOption('newLineBeforeAndOr', e.target.checked)}
              />
              <span>AND/OR 前换行</span>
            </label>
          </div>
        </details>
      )}

      {/* 压缩模式：注释选项 */}
      {mode === 'minify' && (
        <div className="sqltool__minify-opts">
          <label className="sqltool__option sqltool__option--check">
            <input
              type="checkbox"
              checked={removeComments}
              onChange={e => setRemoveComments(e.target.checked)}
            />
            <span>移除注释</span>
          </label>
        </div>
      )}

      {/* 输入输出双栏 */}
      <div className="sqltool__grid">
        <div className="sqltool__panel">
          <div className="sqltool__panel-head">
            <label htmlFor="sql-input" className="sqltool__panel-title">输入 SQL</label>
            <div className="sqltool__panel-actions">
              <button type="button" className="sqltool__action-btn" onClick={handleClear}>清空</button>
            </div>
          </div>
          <textarea
            id="sql-input"
            className="sqltool__textarea"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="在此输入或粘贴 SQL 语句..."
            spellCheck={false}
            aria-label="SQL 输入框"
            rows={14}
          />
          <div className="sqltool__stats">
            <span>行数：{input.trim() ? input.split('\n').length : 0}</span>
            <span>字符数：{input.length}</span>
          </div>
        </div>

        <div className="sqltool__panel">
          <div className="sqltool__panel-head">
            <span className="sqltool__panel-title">
              {mode === 'format' ? '格式化结果' : '压缩结果'}
            </span>
            <div className="sqltool__panel-actions">
              <button
                type="button"
                className="sqltool__action-btn"
                onClick={handleApply}
                disabled={!output}
                aria-label="将结果应用到输入框"
              >
                应用回输入
              </button>
              <button
                type="button"
                className={`sqltool__action-btn sqltool__copy ${copyStatus === 'success' ? 'is-success' : ''}`}
                onClick={handleCopy}
                disabled={!output}
                aria-label={copyLabel}
              >
                {copyLabel}
              </button>
            </div>
          </div>
          {/* 高亮预览（只读） */}
          <pre
            className="sqltool__output"
            aria-label="SQL 高亮预览"
            // 高亮 HTML 由 escapeHtml 转义后拼接 span 标签，避免注入
            dangerouslySetInnerHTML={{ __html: highlightedHtml || '<span class="sqltool__placeholder">格式化结果将在此显示...</span>' }}
          />
          <div className="sqltool__stats">
            <span>关键字：{stats.keywords}</span>
            <span>字符串：{stats.strings}</span>
            <span>数字：{stats.numbers}</span>
            <span>行数：{stats.lines}</span>
          </div>
        </div>
      </div>

      {/* 校验结果 */}
      <div className="sqltool__validation" aria-label="语法校验结果">
        <div className={`sqltool__val-summary ${validation.ok ? 'is-ok' : 'is-error'}`}>
          {input.trim() === ''
            ? '请输入 SQL 语句'
            : validation.ok
            ? `✓ 校验通过${validation.issues.length ? `（${validation.issues.length} 个提示）` : ''}`
            : `✗ 发现 ${validation.issues.filter(i => i.level === 'error').length} 个错误`}
        </div>
        {validation.issues.length > 0 && (
          <ul className="sqltool__val-list">
            {validation.issues.map((issue, idx) => (
              <li key={idx} className={`sqltool__val-item sqltool__val-item--${issue.level}`}>
                <span className="sqltool__val-level">
                  {issue.level === 'error' ? '错误' : '提示'}
                </span>
                <span className="sqltool__val-pos">
                  第 {issue.line} 行 第 {issue.column} 列
                </span>
                <span className="sqltool__val-msg">{issue.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
