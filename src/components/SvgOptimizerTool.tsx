import { useState, useMemo, useCallback, useRef } from 'react';
import { copyText } from '../utils/clipboard';
import {
  type OptimizeOptions,
  type OptimizeResult,
  type Preset,
  DEFAULT_OPTIONS,
  PRESETS,
  SAMPLE_SVG,
  optimizeSvg,
  formatBytes,
} from '../utils/svgOptimizer';

/**
 * SVG 优化器工具组件
 *
 * 全部在浏览器本地处理，不发起任何网络请求。
 * 基于字符串与正则的轻量优化，覆盖 SVGO 常用插件核心能力。
 *
 * UI 布局：左右两栏（移动端单列）
 *  - 左侧：SVG 输入区（textarea + 文件上传 + 拖放）+ 优化选项（预设 + 11 条规则开关）
 *  - 右侧：优化结果（大小对比 + 输出文本 + 规则统计 + 预览）
 */
export default function SvgOptimizerTool() {
  // ===== 输入与选项状态 =====
  const [input, setInput] = useState<string>('');
  const [options, setOptions] = useState<OptimizeOptions>({ ...DEFAULT_OPTIONS });
  const [fileName, setFileName] = useState<string>('');

  // ===== 结果展示 Tab：output（输出文本）/ preview（预览对比）/ stats（规则统计） =====
  const [tab, setTab] = useState<'output' | 'preview' | 'stats'>('output');
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ===== 实时优化计算（输入或选项变化即重算） =====
  const result: OptimizeResult = useMemo(() => {
    if (!input.trim()) {
      return { output: '', originalSize: 0, optimizedSize: 0, savings: 0, rules: [] };
    }
    return optimizeSvg(input, options);
  }, [input, options]);

  // ===== 加载示例 =====
  const handleLoadSample = useCallback(() => {
    setInput(SAMPLE_SVG);
    setFileName('sample.svg');
  }, []);

  // ===== 清空 =====
  const handleClear = useCallback(() => {
    setInput('');
    setFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // ===== 文件读取（共用逻辑，避免重复） =====
  const readFile = useCallback((file: File) => {
    if (!file) return;
    // 限制 5MB，与 utils 限制一致
    if (file.size > 5 * 1024 * 1024) {
      alert('文件超过 5MB 限制，请选择更小的 SVG 文件');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      setInput(String(e.target?.result ?? ''));
      setFileName(file.name);
    };
    reader.onerror = () => alert('文件读取失败，请重试');
    reader.readAsText(file);
  }, []);

  // ===== 文件选择 =====
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) readFile(file);
    },
    [readFile],
  );

  // ===== 拖放 =====
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) readFile(file);
    },
    [readFile],
  );

  // ===== 应用预设 =====
  const applyPreset = useCallback((preset: Preset) => {
    setOptions({ ...preset.options });
  }, []);

  // ===== 切换单条规则 =====
  const toggleRule = useCallback((key: keyof OptimizeOptions) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ===== 复制输出 =====
  const handleCopy = useCallback(async () => {
    if (!result.output) return;
    const ok = await copyText(result.output);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [result.output]);

  // ===== 下载输出 =====
  const handleDownload = useCallback(() => {
    if (!result.output) return;
    const blob = new Blob([result.output], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // 输出文件名：原文件名-optimized.svg，无原文件名则 optimized.svg
    const base = fileName.replace(/\.svg$/i, '') || 'optimized';
    a.download = `${base}-optimized.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [result.output, fileName]);

  // ===== 输出预览（用 data URI 嵌入 iframe，隔离样式） =====
  const previewSrc = useMemo(() => {
    if (!result.output) return '';
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.output)}`;
  }, [result.output]);

  const originalPreviewSrc = useMemo(() => {
    if (!input.trim()) return '';
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(input)}`;
  }, [input]);

  const hasInput = input.trim().length > 0;
  const hasError = !!result.error;

  return (
    <div className="svgopt__container">
      {/* ===== 顶部工具栏：预设 + 文件操作 ===== */}
      <div className="svgopt__toolbar" role="toolbar" aria-label="SVG 优化器操作">
        <div className="svgopt__presets" role="group" aria-label="预设方案">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="svgopt__btn svgopt__btn--preset"
              onClick={() => applyPreset(preset)}
              title={preset.description}
            >
              {preset.name}
            </button>
          ))}
        </div>
        <div className="svgopt__actions">
          <button type="button" className="svgopt__btn" onClick={handleLoadSample}>
            加载示例
          </button>
          <button
            type="button"
            className="svgopt__btn"
            onClick={() => fileInputRef.current?.click()}
          >
            上传 SVG
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".svg,image/svg+xml"
            onChange={handleFileChange}
            className="svgopt__file-input"
            aria-label="选择 SVG 文件"
          />
          <button
            type="button"
            className="svgopt__btn"
            onClick={handleClear}
            disabled={!hasInput}
          >
            清空
          </button>
        </div>
      </div>

      <div className="svgopt__main">
        {/* ===== 左栏：输入 + 选项 ===== */}
        <div className="svgopt__input-panel">
          <label htmlFor="svg-input" className="svgopt__label">
            SVG 文本输入 {fileName && <span className="svgopt__filename">（{fileName}）</span>}
          </label>
          <textarea
            id="svg-input"
            className="svgopt__textarea"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onDrop={handleDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            placeholder={`粘贴 SVG 文本，或拖放 .svg 文件到此\n\n示例：<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>`}
            spellCheck={false}
            aria-label="SVG 文本输入"
            data-drag-over={dragOver}
          />

          {/* ===== 优化选项：11 条规则开关 ===== */}
          <fieldset className="svgopt__options">
            <legend>优化规则</legend>
            <div className="svgopt__rules">
              {RULE_META.map((rule) => (
                <label key={rule.id} className="svgopt__rule" title={rule.desc}>
                  <input
                    type="checkbox"
                    checked={options[rule.id]}
                    onChange={() => toggleRule(rule.id)}
                  />
                  <span className="svgopt__rule-name">{rule.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        {/* ===== 右栏：结果展示 ===== */}
        <div className="svgopt__output-panel">
          {/* ===== 状态摘要条 ===== */}
          <div className="svgopt__summary" role="status" aria-live="polite">
            {hasError ? (
              <span className="svgopt__summary-item svgopt__summary-item--error">
                {result.error}
              </span>
            ) : !hasInput ? (
              <span className="svgopt__summary-item svgopt__summary-item--muted">
                等待输入 SVG 文本
              </span>
            ) : (
              <>
                <span className="svgopt__summary-item">
                  原始：<strong>{formatBytes(result.originalSize)}</strong>
                </span>
                <span className="svgopt__summary-item">
                  优化后：<strong>{formatBytes(result.optimizedSize)}</strong>
                </span>
                <span
                  className="svgopt__summary-item"
                  data-savings={result.savings >= 30 ? 'high' : result.savings >= 10 ? 'mid' : 'low'}
                >
                  节省：<strong>{result.savings.toFixed(1)}%</strong>
                </span>
              </>
            )}
          </div>

          {/* ===== Tab 切换 ===== */}
          <div className="svgopt__tabs" role="tablist">
            <button
              type="button"
              role="tab"
              className="svgopt__tab"
              data-active={tab === 'output'}
              onClick={() => setTab('output')}
            >
              输出文本
            </button>
            <button
              type="button"
              role="tab"
              className="svgopt__tab"
              data-active={tab === 'preview'}
              onClick={() => setTab('preview')}
            >
              预览对比
            </button>
            <button
              type="button"
              role="tab"
              className="svgopt__tab"
              data-active={tab === 'stats'}
              onClick={() => setTab('stats')}
            >
              规则统计
            </button>
          </div>

          <div className="svgopt__tab-content">
            {/* ===== Tab 1：输出文本 ===== */}
            {tab === 'output' && (
              <div className="svgopt__output-area">
                {hasError || !hasInput ? (
                  <div className="svgopt__empty">
                    {hasError ? result.error : '请在左侧输入 SVG 文本以查看优化结果'}
                  </div>
                ) : (
                  <>
                    <textarea
                      className="svgopt__output-text"
                      value={result.output}
                      readOnly
                      spellCheck={false}
                      aria-label="优化后的 SVG 文本"
                    />
                    <div className="svgopt__output-actions">
                      <button
                        type="button"
                        className="svgopt__btn svgopt__btn--primary"
                        onClick={handleCopy}
                        disabled={!result.output}
                      >
                        {copied ? '已复制' : '复制'}
                      </button>
                      <button
                        type="button"
                        className="svgopt__btn"
                        onClick={handleDownload}
                        disabled={!result.output}
                      >
                        下载
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ===== Tab 2：预览对比 ===== */}
            {tab === 'preview' && (
              <div className="svgopt__preview-area">
                {!hasInput || hasError ? (
                  <div className="svgopt__empty">
                    {hasError ? result.error : '请在左侧输入 SVG 文本以查看预览'}
                  </div>
                ) : (
                  <div className="svgopt__preview-grid">
                    <div className="svgopt__preview-cell">
                      <div className="svgopt__preview-label">原始（{formatBytes(result.originalSize)}）</div>
                      <iframe
                        title="原始 SVG 预览"
                        className="svgopt__preview-frame"
                        src={originalPreviewSrc}
                        sandbox="allow-same-origin"
                      />
                    </div>
                    <div className="svgopt__preview-cell">
                      <div className="svgopt__preview-label">
                        优化后（{formatBytes(result.optimizedSize)}）
                      </div>
                      <iframe
                        title="优化后 SVG 预览"
                        className="svgopt__preview-frame"
                        src={previewSrc}
                        sandbox="allow-same-origin"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ===== Tab 3：规则统计 ===== */}
            {tab === 'stats' && (
              <div className="svgopt__stats-area">
                {!hasInput || hasError ? (
                  <div className="svgopt__empty">
                    {hasError ? result.error : '请在左侧输入 SVG 文本以查看规则统计'}
                  </div>
                ) : (
                  <table className="svgopt__stats-table">
                    <thead>
                      <tr>
                        <th scope="col">规则</th>
                        <th scope="col">状态</th>
                        <th scope="col">节省字节</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.rules.map((rule) => (
                        <tr key={rule.id}>
                          <td>{rule.name}</td>
                          <td>
                            {rule.applied ? (
                              <span className="svgopt__badge svgopt__badge--on">已应用</span>
                            ) : (
                              <span className="svgopt__badge svgopt__badge--off">未启用</span>
                            )}
                          </td>
                          <td>{rule.applied ? formatBytes(rule.savedBytes) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 规则元数据：用于渲染选项开关
 * 与 utils/svgOptimizer.ts 的 RULES 保持一致，这里仅含 UI 展示信息
 */
const RULE_META: { id: keyof OptimizeOptions; name: string; desc: string }[] = [
  { id: 'removeXmlDecl', name: '去除 XML 声明', desc: '去除 <?xml ... ?> 头部声明' },
  { id: 'removeDoctype', name: '去除 DOCTYPE', desc: '去除 <!DOCTYPE ... > 声明' },
  { id: 'removeComments', name: '去除注释', desc: '去除 <!-- --> 注释' },
  { id: 'removeMetadata', name: '去除 metadata', desc: '去除 <metadata> 元素（含 RDF 信息）' },
  { id: 'removeDesc', name: '去除 desc', desc: '去除 <desc> 描述元素' },
  { id: 'removeTitle', name: '去除 title', desc: '去除 <title> 元素（影响无障碍，默认关闭）' },
  { id: 'removeEditorAttrs', name: '去除编辑器属性', desc: '去除 Inkscape / Sketch / Adobe 命名空间属性' },
  { id: 'removeEditorIds', name: '去除编辑器 id', desc: '去除 Layer_1、_x2C_ 等编辑器自动生成的 id' },
  { id: 'shortenNumbers', name: '数字精度简化', desc: '去除多余小数位与前导零（0.5 → .5）' },
  { id: 'removeDefaultAttrs', name: '去除默认值', desc: '去除 fill="black" stroke="none" 等默认值属性' },
  { id: 'collapseWhitespace', name: '压缩空白', desc: '合并空格、移除换行，保留 <text> 内文本' },
];
