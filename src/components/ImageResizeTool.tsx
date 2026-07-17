import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  type SourceImage,
  type OutputMime,
  type ResizeMode,
  type ResizePresetCode,
  type ResizeOptions,
  type ResizeResult,
  type BatchResizeItem,
  RESIZE_PRESETS,
  OUTPUT_FORMATS,
  ACCEPTED_INPUT_MIMES,
  MAX_FILE_SIZE,
  MAX_BATCH_COUNT,
  DEFAULT_RESIZE_OPTIONS,
  loadImage,
  resizeImage,
  resizeBatch,
  downloadBatch,
  downloadBatchAsZip,
  computeResizeTarget,
  buildResizeFilename,
  detectAllEncodeSupport,
  formatBytes,
  downloadBlob,
  computeSizeDelta,
} from '../utils/imageResize';

/**
 * 图片缩放工具
 *
 * 全部在浏览器本地用 Canvas API + drawImage 整图重采样处理，不发起任何网络请求。
 *
 * 核心能力：
 *  - 5 种缩放模式：按宽度 / 按高度 / 按宽高 / 按百分比 / 按预设尺寸
 *  - 8 种预设尺寸：缩略图 256 / SD 480p / HD 720p / FHD 1080p / 2K 1440p / 4K 2160p / 原图 50% / 原图 200%
 *  - 等比锁定 + 放大控制 + 多格式导出 + 批量 ZIP 打包
 */
export default function ImageResizeTool() {
  /** 工作模式：单图 / 批量 */
  const [mode, setMode] = useState<'single' | 'batch'>('single');

  /** 单图模式状态 */
  const [source, setSource] = useState<SourceImage | null>(null);
  const [options, setOptions] = useState<ResizeOptions>({ ...DEFAULT_RESIZE_OPTIONS });
  const [result, setResult] = useState<ResizeResult | null>(null);
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);

  /** 批量模式状态 */
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchItems, setBatchItems] = useState<BatchResizeItem[]>([]);
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [batchZipping, setBatchZipping] = useState(false);

  /** 浏览器编码能力探测结果 */
  const [encodeSupport, setEncodeSupport] = useState<Record<OutputMime, boolean>>({
    'image/avif': false,
    'image/webp': true,
    'image/jpeg': true,
    'image/png': true,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const batchFileInputRef = useRef<HTMLInputElement>(null);

  /** 组件挂载时探测浏览器编码支持 */
  useEffect(() => {
    detectAllEncodeSupport().then(setEncodeSupport).catch(() => undefined);
  }, []);

  /** 组件卸载时释放所有 Object URL，避免内存泄漏 */
  useEffect(() => {
    return () => {
      if (source) URL.revokeObjectURL(source.url);
      if (result) URL.revokeObjectURL(result.url);
      batchItems.forEach((item) => {
        if (item.result) URL.revokeObjectURL(item.result.url);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 可选导出格式（仅显示浏览器支持的） */
  const availableFormats = useMemo(
    () => OUTPUT_FORMATS.filter((f) => encodeSupport[f.mime]),
    [encodeSupport],
  );

  /** 当前导出格式是否支持质量调节 */
  const qualityEditable = useMemo(() => {
    const meta = OUTPUT_FORMATS.find((f) => f.mime === options.format);
    return meta?.lossy ?? false;
  }, [options.format]);

  /** 当前导出格式是否需要背景色（不支持透明） */
  const needsBackground = useMemo(() => {
    const meta = OUTPUT_FORMATS.find((f) => f.mime === options.format);
    return !meta?.alpha;
  }, [options.format]);

  /** 预览目标尺寸：用户调整参数时实时显示目标尺寸（不实际生成） */
  const previewTarget = useMemo(() => {
    if (!source) return null;
    return computeResizeTarget(source.width, source.height, options);
  }, [source, options]);

  /** 处理单图文件选择 */
  const handleSingleFileChange = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      setError('');
      setResult(null);
      // 释放上一张的 URL
      if (source) URL.revokeObjectURL(source.url);
      if (result) URL.revokeObjectURL(result.url);
      try {
        const img = await loadImage(file);
        setSource(img);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setSource(null);
      }
    },
    [source, result],
  );

  /** 处理批量文件选择（追加，最多 MAX_BATCH_COUNT 张） */
  const handleBatchFileChange = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const incoming = Array.from(files);
      setBatchFiles((prev) => {
        const merged = [...prev, ...incoming];
        if (merged.length > MAX_BATCH_COUNT) {
          setError(`批量上限 ${MAX_BATCH_COUNT} 张，已截断超出部分`);
          return merged.slice(0, MAX_BATCH_COUNT);
        }
        setError('');
        return merged;
      });
      // 清空旧的批量结果
      batchItems.forEach((item) => {
        if (item.result) URL.revokeObjectURL(item.result.url);
      });
      setBatchItems([]);
    },
    [batchItems],
  );

  /** 移除批量列表中指定索引的文件 */
  const removeBatchFile = useCallback(
    (index: number) => {
      setBatchFiles((prev) => prev.filter((_, i) => i !== index));
      // 同步清空结果（避免结果索引错位）
      batchItems.forEach((item) => {
        if (item.result) URL.revokeObjectURL(item.result.url);
      });
      setBatchItems([]);
    },
    [batchItems],
  );

  /** 执行单图缩放 */
  const handleSingleResize = useCallback(async () => {
    if (!source) return;
    setProcessing(true);
    setError('');
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
    try {
      const r = await resizeImage(source, options);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  }, [source, options, result]);

  /** 执行批量缩放 */
  const handleBatchResize = useCallback(async () => {
    if (batchFiles.length === 0) return;
    setBatchProcessing(true);
    setError('');
    // 释放旧结果
    batchItems.forEach((item) => {
      if (item.result) URL.revokeObjectURL(item.result.url);
    });
    setBatchItems([]);
    setBatchProgress({ current: 0, total: batchFiles.length });
    try {
      const items = await resizeBatch(batchFiles, options, (index, total) => {
        setBatchProgress({ current: index + 1, total });
      });
      setBatchItems(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBatchProcessing(false);
    }
  }, [batchFiles, options, batchItems]);

  /** 下载单图缩放结果 */
  const handleDownloadSingle = useCallback(() => {
    if (!result || !source) return;
    const filename = buildResizeFilename(source.file.name, result.mime, result.width, result.height);
    downloadBlob(result.url, filename);
  }, [result, source]);

  /** 批量逐个下载 */
  const handleBatchDownload = useCallback(async () => {
    if (batchItems.length === 0) return;
    setBatchDownloading(true);
    try {
      await downloadBatch(batchItems);
    } finally {
      setBatchDownloading(false);
    }
  }, [batchItems]);

  /** 批量打包为 ZIP 下载 */
  const handleBatchDownloadZip = useCallback(async () => {
    if (batchItems.length === 0) return;
    setBatchZipping(true);
    try {
      // ZIP 文件名带时间戳，避免同名覆盖
      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      await downloadBatchAsZip(batchItems, `resized-${stamp}.zip`);
    } finally {
      setBatchZipping(false);
    }
  }, [batchItems]);

  /** 拖拽上传支持 */
  const [dragOver, setDragOver] = useState(false);
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const files = e.dataTransfer.files;
      if (mode === 'single') {
        handleSingleFileChange(files);
      } else {
        handleBatchFileChange(files);
      }
    },
    [mode, handleSingleFileChange, handleBatchFileChange],
  );

  /** 批量缩放结果统计 */
  const batchStats = useMemo(() => {
    const success = batchItems.filter((i) => i.result).length;
    const failed = batchItems.filter((i) => i.error).length;
    const totalResizedBytes = batchItems.reduce((sum, i) => sum + (i.result?.size || 0), 0);
    return { success, failed, totalResizedBytes };
  }, [batchItems]);

  /** 输入控件的通用样式类名 */
  const inputCls = 'imres__input';
  const labelCls = 'imres__field-label';

  return (
    <div className="imres">
      {/* 工作模式切换 Tab */}
      <div className="imres__mode-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'single'}
          className={`imres__mode-tab ${mode === 'single' ? 'imres__mode-tab--active' : ''}`}
          onClick={() => setMode('single')}
        >
          单图缩放
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'batch'}
          className={`imres__mode-tab ${mode === 'batch' ? 'imres__mode-tab--active' : ''}`}
          onClick={() => setMode('batch')}
        >
          批量缩放（最多 {MAX_BATCH_COUNT} 张）
        </button>
      </div>

      {/* 错误提示 */}
      {error && <div className="imres__error" role="alert">{error}</div>}

      {/* 工作区：左右两栏 */}
      <div className="imres__workspace">
        {/* 左侧：上传 + 配置 */}
        <div className="imres__left">
          {/* 上传区 */}
          <div
            className={`imres__dropzone ${dragOver ? 'imres__dropzone--active' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => (mode === 'single' ? fileInputRef.current?.click() : batchFileInputRef.current?.click())}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                (mode === 'single' ? fileInputRef.current : batchFileInputRef.current)?.click();
              }
            }}
          >
            <div className="imres__dropzone-icon" aria-hidden>🖼️</div>
            <div className="imres__dropzone-text">
              {mode === 'single' ? '点击或拖拽上传图片' : `点击或拖拽上传多张图片（最多 ${MAX_BATCH_COUNT} 张）`}
            </div>
            <div className="imres__dropzone-hint">
              支持 PNG / JPEG / WebP / AVIF / GIF / BMP，单文件 ≤ {formatBytes(MAX_FILE_SIZE)}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_INPUT_MIMES.join(',')}
              className="imres__file-input"
              onChange={(e) => handleSingleFileChange(e.target.files)}
              hidden
            />
            <input
              ref={batchFileInputRef}
              type="file"
              accept={ACCEPTED_INPUT_MIMES.join(',')}
              multiple
              className="imres__file-input"
              onChange={(e) => handleBatchFileChange(e.target.files)}
              hidden
            />
          </div>

          {/* 单图模式：原图信息 */}
          {mode === 'single' && source && (
            <div className="imres__source-info">
              <div className="imres__source-name" title={source.file.name}>{source.file.name}</div>
              <div className="imres__source-meta">
                <span>{source.width} × {source.height}</span>
                <span>{formatBytes(source.file.size)}</span>
                <span>{source.mime}</span>
              </div>
            </div>
          )}

          {/* 批量模式：文件列表 */}
          {mode === 'batch' && batchFiles.length > 0 && (
            <div className="imres__batch-list">
              {batchFiles.map((file, idx) => (
                <div key={`${file.name}-${idx}`} className="imres__batch-item">
                  <span className="imres__batch-item-name" title={file.name}>{file.name}</span>
                  <span className="imres__batch-item-size">{formatBytes(file.size)}</span>
                  <button
                    type="button"
                    className="imres__batch-item-remove"
                    onClick={() => removeBatchFile(idx)}
                    aria-label={`移除 ${file.name}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 缩放配置 */}
          <fieldset className="imres__config">
            <legend className="imres__config-legend">缩放配置</legend>

            {/* 模式选择 */}
            <div className="imres__field">
              <label className={labelCls} htmlFor="imres-mode">缩放模式</label>
              <select
                id="imres-mode"
                className={inputCls}
                value={options.mode}
                onChange={(e) => setOptions((p) => ({ ...p, mode: e.target.value as ResizeMode }))}
              >
                <option value="width">按宽度（高度等比）</option>
                <option value="height">按高度（宽度等比）</option>
                <option value="both">按宽高（可锁定等比）</option>
                <option value="percent">按百分比</option>
                <option value="preset">按预设尺寸</option>
              </select>
            </div>

            {/* 模式对应的参数 */}
            {(options.mode === 'width' || options.mode === 'both') && (
              <div className="imres__field">
                <label className={labelCls} htmlFor="imres-target-w">目标宽度（px）</label>
                <input
                  id="imres-target-w"
                  type="number"
                  min={1}
                  max={16384}
                  className={inputCls}
                  value={options.targetWidth}
                  onChange={(e) => setOptions((p) => ({ ...p, targetWidth: Math.max(0, Number(e.target.value) || 0) }))}
                />
              </div>
            )}

            {(options.mode === 'height' || options.mode === 'both') && (
              <div className="imres__field">
                <label className={labelCls} htmlFor="imres-target-h">目标高度（px）</label>
                <input
                  id="imres-target-h"
                  type="number"
                  min={1}
                  max={16384}
                  className={inputCls}
                  value={options.targetHeight}
                  onChange={(e) => setOptions((p) => ({ ...p, targetHeight: Math.max(0, Number(e.target.value) || 0) }))}
                />
              </div>
            )}

            {options.mode === 'both' && (
              <div className="imres__field imres__field--checkbox">
                <label className="imres__checkbox-label" htmlFor="imres-lock">
                  <input
                    id="imres-lock"
                    type="checkbox"
                    checked={options.lockAspect}
                    onChange={(e) => setOptions((p) => ({ ...p, lockAspect: e.target.checked }))}
                  />
                  锁定等比（按主导方向缩放，不拉伸）
                </label>
              </div>
            )}

            {options.mode === 'percent' && (
              <div className="imres__field">
                <label className={labelCls} htmlFor="imres-percent">百分比（1-500，100 = 原尺寸）</label>
                <input
                  id="imres-percent"
                  type="number"
                  min={1}
                  max={500}
                  className={inputCls}
                  value={options.percent}
                  onChange={(e) => setOptions((p) => ({ ...p, percent: Math.max(1, Math.min(500, Number(e.target.value) || 100)) }))}
                />
              </div>
            )}

            {options.mode === 'preset' && (
              <div className="imres__field">
                <span className={labelCls}>预设尺寸</span>
                <div className="imres__preset-grid">
                  {RESIZE_PRESETS.map((preset) => (
                    <label
                      key={preset.code}
                      className={`imres__preset-item ${options.presetCode === preset.code ? 'imres__preset-item--active' : ''}`}
                      title={preset.desc}
                    >
                      <input
                        type="radio"
                        name="imres-preset"
                        value={preset.code}
                        checked={options.presetCode === preset.code}
                        onChange={(e) => setOptions((p) => ({ ...p, presetCode: e.target.value as ResizePresetCode }))}
                      />
                      <span className="imres__preset-label">{preset.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* 通用选项 */}
            <div className="imres__field imres__field--checkbox">
              <label className="imres__checkbox-label" htmlFor="imres-enlarge">
                <input
                  id="imres-enlarge"
                  type="checkbox"
                  checked={options.allowEnlarge}
                  onChange={(e) => setOptions((p) => ({ ...p, allowEnlarge: e.target.checked }))}
                />
                允许放大（默认仅缩小，目标大于原图时保留原尺寸）
              </label>
            </div>

            {/* 输出格式 */}
            <div className="imres__field">
              <label className={labelCls} htmlFor="imres-format">输出格式</label>
              <select
                id="imres-format"
                className={inputCls}
                value={options.format}
                onChange={(e) => setOptions((p) => ({ ...p, format: e.target.value as OutputMime }))}
              >
                {availableFormats.map((f) => (
                  <option key={f.mime} value={f.mime}>{f.label} — {f.desc}</option>
                ))}
              </select>
            </div>

            {/* 质量（仅有损格式生效） */}
            {qualityEditable && (
              <div className="imres__field">
                <label className={labelCls} htmlFor="imres-quality">
                  质量（{options.quality}%，仅 {OUTPUT_FORMATS.find((f) => f.mime === options.format)?.label} 生效）
                </label>
                <input
                  id="imres-quality"
                  type="range"
                  min={1}
                  max={100}
                  className="imres__range"
                  value={options.quality}
                  onChange={(e) => setOptions((p) => ({ ...p, quality: Number(e.target.value) }))}
                />
              </div>
            )}

            {/* 背景色（仅不支持透明的格式生效） */}
            {needsBackground && (
              <div className="imres__field">
                <label className={labelCls} htmlFor="imres-bg">背景色（透明区域填充）</label>
                <input
                  id="imres-bg"
                  type="color"
                  className="imres__color-input"
                  value={options.background}
                  onChange={(e) => setOptions((p) => ({ ...p, background: e.target.value }))}
                />
              </div>
            )}

            {/* 预览目标尺寸（实时反馈） */}
            {previewTarget && (
              <div className="imres__preview-target">
                <span className="imres__preview-label">目标尺寸：</span>
                <strong>{previewTarget.width} × {previewTarget.height}</strong>
                {source && (previewTarget.width !== source.width || previewTarget.height !== source.height) && (
                  <span className="imres__preview-ratio">
                    （{previewTarget.width > source.width || previewTarget.height > source.height ? '放大' : '缩小'}
                    　{((previewTarget.width * previewTarget.height) / (source.width * source.height) * 100).toFixed(1)}% 像素）
                  </span>
                )}
                {source && previewTarget.width === source.width && previewTarget.height === source.height && options.allowEnlarge === false && (
                  <span className="imres__preview-hint">（已限制放大，保留原图尺寸）</span>
                )}
              </div>
            )}
          </fieldset>

          {/* 操作按钮 */}
          <div className="imres__actions">
            {mode === 'single' ? (
              <button
                type="button"
                className="imres__btn imres__btn--primary"
                onClick={handleSingleResize}
                disabled={!source || processing}
              >
                {processing ? '缩放中…' : '开始缩放'}
              </button>
            ) : (
              <button
                type="button"
                className="imres__btn imres__btn--primary"
                onClick={handleBatchResize}
                disabled={batchFiles.length === 0 || batchProcessing}
              >
                {batchProcessing ? `缩放中… (${batchProgress.current}/${batchProgress.total})` : `批量缩放 ${batchFiles.length} 张`}
              </button>
            )}
          </div>
        </div>

        {/* 右侧：结果展示 */}
        <div className="imres__right">
          {mode === 'single' ? (
            <>
              {/* 原图预览 */}
              {source && !result && (
                <div className="imres__preview-area">
                  <h3 className="imres__preview-title">原图预览</h3>
                  <img
                    src={source.url}
                    alt="原图预览"
                    className="imres__preview-img"
                    loading="lazy"
                  />
                  <div className="imres__preview-info">
                    {source.width} × {source.height} · {formatBytes(source.file.size)}
                  </div>
                </div>
              )}

              {/* 缩放结果 */}
              {result && (
                <div className="imres__preview-area">
                  <h3 className="imres__preview-title">缩放结果</h3>
                  <img
                    src={result.url}
                    alt="缩放结果"
                    className="imres__preview-img"
                    loading="lazy"
                  />
                  <div className="imres__result-info">
                    <div className="imres__result-row">
                      <span className="imres__result-label">尺寸</span>
                      <span>{result.originalWidth} × {result.originalHeight} → <strong>{result.width} × {result.height}</strong></span>
                    </div>
                    <div className="imres__result-row">
                      <span className="imres__result-label">体积</span>
                      <span>{formatBytes(source!.file.size)} → <strong>{formatBytes(result.size)}</strong></span>
                      {(() => {
                        const delta = computeSizeDelta(source!.file.size, result.size);
                        return (
                          <span className={`imres__delta ${delta.ratio >= 0 ? 'imres__delta--positive' : 'imres__delta--negative'}`}>
                            {delta.ratio >= 0 ? '↓' : '↑'} {Math.abs(delta.ratio).toFixed(1)}%
                          </span>
                        );
                      })()}
                    </div>
                    <div className="imres__result-row">
                      <span className="imres__result-label">格式</span>
                      <span>{source!.mime} → <strong>{result.mime}</strong></span>
                    </div>
                    <div className="imres__result-row">
                      <span className="imres__result-label">耗时</span>
                      <span>{result.elapsedMs} ms</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="imres__btn imres__btn--primary"
                    onClick={handleDownloadSingle}
                  >
                    下载图片
                  </button>
                </div>
              )}

              {/* 空状态 */}
              {!source && !processing && (
                <div className="imres__empty">
                  <div className="imres__empty-icon" aria-hidden>📐</div>
                  <p>上传图片后选择缩放模式，全本地处理，零上传零追踪</p>
                </div>
              )}

              {/* 加载态 */}
              {processing && (
                <div className="imres__loading">
                  <div className="imres__spinner" aria-hidden></div>
                  <p>正在缩放…</p>
                </div>
              )}
            </>
          ) : (
            <>
              {/* 批量结果 */}
              {batchItems.length > 0 ? (
                <div className="imres__batch-results">
                  <div className="imres__batch-stats">
                    <span>成功 <strong>{batchStats.success}</strong></span>
                    <span>失败 <strong>{batchStats.failed}</strong></span>
                    <span>总输出 <strong>{formatBytes(batchStats.totalResizedBytes)}</strong></span>
                  </div>
                  <div className="imres__batch-result-list">
                    {batchItems.map((item, idx) => (
                      <div key={`${item.name}-${idx}`} className={`imres__batch-result-item ${item.error ? 'imres__batch-result-item--error' : ''}`}>
                        <span className="imres__batch-result-name" title={item.name}>{item.name}</span>
                        {item.result ? (
                          <>
                            <span className="imres__batch-result-meta">
                              {item.sourceWidth}×{item.sourceHeight} → <strong>{item.result.width}×{item.result.height}</strong>
                            </span>
                            <span className="imres__batch-result-size">{formatBytes(item.result.size)}</span>
                            <a
                              href={item.result.url}
                              download={buildResizeFilename(item.name, item.result.mime, item.result.width, item.result.height)}
                              className="imres__batch-result-download"
                            >
                              下载
                            </a>
                          </>
                        ) : (
                          <span className="imres__batch-result-error" title={item.error || ''}>失败：{item.error}</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="imres__batch-actions">
                    <button
                      type="button"
                      className="imres__btn"
                      onClick={handleBatchDownload}
                      disabled={batchStats.success === 0 || batchDownloading}
                    >
                      {batchDownloading ? '下载中…' : `逐个下载 (${batchStats.success})`}
                    </button>
                    <button
                      type="button"
                      className="imres__btn imres__btn--primary"
                      onClick={handleBatchDownloadZip}
                      disabled={batchStats.success === 0 || batchZipping}
                    >
                      {batchZipping ? '打包中…' : '下载为 ZIP'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="imres__empty">
                  <div className="imres__empty-icon" aria-hidden>📦</div>
                  <p>上传多张图片后批量应用统一规格，支持 ZIP 打包下载</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
