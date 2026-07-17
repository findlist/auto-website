import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  type SourceImage,
  type OutputMime,
  type CropRect,
  type HandleCode,
  type AspectRatioCode,
  type CropResult,
  ASPECT_RATIOS,
  HANDLES,
  OUTPUT_FORMATS,
  ACCEPTED_INPUT_MIMES,
  DEFAULT_CROP_OPTIONS,
  loadImage,
  cropImage,
  detectAllEncodeSupport,
  formatBytes,
  downloadBlob,
  buildCropFilename,
  computeInitialRect,
  clampRect,
  applyAspectRatio,
  resizeRect,
  moveRect,
  MIN_CROP_SIZE,
} from '../utils/imageCrop';

/**
 * 图片裁剪工具
 *
 * 全部在浏览器本地用 Canvas API + drawImage 源矩形参数处理，不发起任何网络请求。
 *
 * 核心能力：
 *  - 多种裁剪比例：自由 / 1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 3:2 / 2:3 / 自定义
 *  - 可视化裁剪框：8 个手柄调整大小，整体可拖动
 *  - 数值精确输入 + 快捷按钮（居中、重置、全图）
 *  - 多格式导出：PNG / JPEG / WebP / AVIF（受浏览器编码能力限制）
 */

/** 当前拖拽操作的类型 */
type DragMode = 'move' | HandleCode;

/** 拖拽起始状态 */
interface DragStart {
  mouseX: number;
  mouseY: number;
  rect: CropRect;
}

export default function ImageCropTool() {
  const [source, setSource] = useState<SourceImage | null>(null);
  const [rect, setRect] = useState<CropRect>({ x: 0, y: 0, width: 0, height: 0 });
  const [aspectCode, setAspectCode] = useState<AspectRatioCode>('free');
  const [customRatioW, setCustomRatioW] = useState(4);
  const [customRatioH, setCustomRatioH] = useState(3);
  const [exportCfg, setExportCfg] = useState({ ...DEFAULT_CROP_OPTIONS });
  const [encodeSupport, setEncodeSupport] = useState<Record<OutputMime, boolean>>({
    'image/avif': false,
    'image/webp': true,
    'image/jpeg': true,
    'image/png': true,
  });
  const [result, setResult] = useState<CropResult | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [dragMode, setDragMode] = useState<DragMode | null>(null);
  const [dragStart, setDragStart] = useState<DragStart | null>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  /** 显示尺寸（容器内实际渲染宽高） */
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });

  /** 组件挂载时探测浏览器编码支持 */
  useEffect(() => {
    detectAllEncodeSupport().then(setEncodeSupport).catch(() => undefined);
  }, []);

  /** 当前生效的比例值（自由 = null，自定义 = customRatioW/customRatioH，其他 = 预设） */
  const currentRatio = useMemo(() => {
    if (aspectCode === 'free') return null;
    if (aspectCode === 'custom') {
      if (customRatioH <= 0) return null;
      return customRatioW / customRatioH;
    }
    const meta = ASPECT_RATIOS.find((r) => r.code === aspectCode);
    return meta?.ratio ?? null;
  }, [aspectCode, customRatioW, customRatioH]);

  /** 可选导出格式（仅显示浏览器支持的） */
  const availableFormats = useMemo(
    () => OUTPUT_FORMATS.filter((f) => encodeSupport[f.mime]),
    [encodeSupport],
  );

  /** 当前导出格式是否支持质量调节 */
  const qualityEditable = useMemo(() => {
    const meta = OUTPUT_FORMATS.find((f) => f.mime === exportCfg.format);
    return meta?.lossy ?? false;
  }, [exportCfg.format]);

  /** 图片加载完成后初始化裁剪矩形与显示尺寸 */
  useEffect(() => {
    if (!imgEl || !source) return;
    // 等待图片实际渲染完成
    const updateDisplay = () => {
      if (!imgEl || !source) return;
      const w = imgEl.clientWidth;
      const h = imgEl.clientHeight;
      if (w > 0 && h > 0) {
        setDisplaySize({ width: w, height: h });
      }
    };
    updateDisplay();
    // 监听容器尺寸变化（响应式）
    const observer = new ResizeObserver(updateDisplay);
    observer.observe(imgEl);
    return () => observer.disconnect();
  }, [imgEl, source]);

  /** 源坐标 → 显示坐标的缩放比 */
  const scale = useMemo(() => {
    if (!source || displaySize.width === 0) return 1;
    return displaySize.width / source.width;
  }, [source, displaySize]);

  /** 切换比例时重置裁剪矩形 */
  const handleAspectChange = useCallback(
    (code: AspectRatioCode) => {
      if (!source) return;
      setAspectCode(code);
      let ratio: number | null = null;
      if (code === 'custom') {
        if (customRatioH > 0) ratio = customRatioW / customRatioH;
      } else {
        const meta = ASPECT_RATIOS.find((r) => r.code === code);
        ratio = meta?.ratio ?? null;
      }
      const initial = computeInitialRect(source.width, source.height, ratio);
      setRect(initial);
      setResult(null);
    },
    [source, customRatioW, customRatioH],
  );

  /** 自定义比例变化时同步重置裁剪框 */
  const updateCustomRatio = useCallback(
    (which: 'w' | 'h', value: number) => {
      const w = which === 'w' ? Math.max(1, value) : customRatioW;
      const h = which === 'h' ? Math.max(1, value) : customRatioH;
      setCustomRatioW(w);
      setCustomRatioH(h);
      if (aspectCode === 'custom' && source) {
        const ratio = h > 0 ? w / h : null;
        const initial = computeInitialRect(source.width, source.height, ratio);
        setRect(initial);
        setResult(null);
      }
    },
    [aspectCode, source, customRatioW, customRatioH],
  );

  /** 处理图片文件选择 */
  const handleFile = useCallback(async (file: File) => {
    setError('');
    try {
      const src = await loadImage(file);
      setSource(src);
      const initial = computeInitialRect(src.width, src.height, null);
      setRect(initial);
      setResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  /** 拖拽事件 */
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  /** 粘贴事件 */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const list = e.clipboardData?.items;
      if (!list) return;
      for (const item of list) {
        if (item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) {
            handleFile(f);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleFile]);

  /** 鼠标按下：开始拖拽（移动或调整手柄） */
  const startDrag = useCallback(
    (mode: DragMode) => (e: React.MouseEvent) => {
      if (!source) return;
      e.preventDefault();
      e.stopPropagation();
      setDragMode(mode);
      setDragStart({
        mouseX: e.clientX,
        mouseY: e.clientY,
        rect: { ...rect },
      });
    },
    [source, rect],
  );

  /** 全局鼠标移动：处理拖拽逻辑 */
  useEffect(() => {
    if (!dragMode || !dragStart || !source) return;
    const onMove = (e: MouseEvent) => {
      const dx = (e.clientX - dragStart.mouseX) / scale;
      const dy = (e.clientY - dragStart.mouseY) / scale;
      if (dragMode === 'move') {
        const next = moveRect(dragStart.rect, dx, dy, source.width, source.height);
        setRect(next);
      } else {
        const next = resizeRect(
          dragStart.rect,
          dragMode,
          dx,
          dy,
          currentRatio,
          source.width,
          source.height,
        );
        setRect(next);
      }
    };
    const onUp = () => {
      setDragMode(null);
      setDragStart(null);
      setResult(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragMode, dragStart, source, scale, currentRatio]);

  /** 数值输入：精确设置 x/y/width/height */
  const updateRectValue = useCallback(
    (key: keyof CropRect, raw: number) => {
      if (!source) return;
      const value = Math.max(0, Math.round(raw));
      const next = { ...rect, [key]: value };
      setRect(clampRect(next, source.width, source.height));
      if (currentRatio) {
        setRect((r) => applyAspectRatio(r, currentRatio, source.width, source.height));
      }
      setResult(null);
    },
    [source, rect, currentRatio],
  );

  /** 快捷操作：居中、重置、全图 */
  const centerRect = useCallback(() => {
    if (!source) return;
    const next = {
      x: Math.round((source.width - rect.width) / 2),
      y: Math.round((source.height - rect.height) / 2),
      width: rect.width,
      height: rect.height,
    };
    setRect(clampRect(next, source.width, source.height));
    setResult(null);
  }, [source, rect]);

  const resetRect = useCallback(() => {
    if (!source) return;
    const initial = computeInitialRect(source.width, source.height, currentRatio);
    setRect(initial);
    setResult(null);
  }, [source, currentRatio]);

  const selectAll = useCallback(() => {
    if (!source) return;
    setRect({ x: 0, y: 0, width: source.width, height: source.height });
    setResult(null);
  }, [source]);

  /** 执行裁剪并生成结果 */
  const runCrop = useCallback(async () => {
    if (!source) return;
    setError('');
    try {
      const r = await cropImage(source, { ...exportCfg, rect });
      setResult((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return r;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [source, exportCfg, rect]);

  /** 下载结果 */
  const handleDownload = useCallback(() => {
    if (!result || !source) return;
    downloadBlob(result.url, buildCropFilename(source.file.name, result.mime));
  }, [result, source]);

  /** 清空全部 */
  const handleReset = useCallback(() => {
    if (source) URL.revokeObjectURL(source.url);
    if (result) URL.revokeObjectURL(result.url);
    setSource(null);
    setResult(null);
    setRect({ x: 0, y: 0, width: 0, height: 0 });
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [source, result]);

  /** 卸载时清理所有 URL */
  useEffect(() => {
    return () => {
      if (source) URL.revokeObjectURL(source.url);
      if (result) URL.revokeObjectURL(result.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 拖拽中的视觉反馈 */
  const draggingClass = dragMode ? ' imcrop__canvas--dragging' : '';

  return (
    <div className="imcrop">
      {/* 上传区 */}
      {!source && (
        <div
          className={`imcrop__dropzone${dragging ? ' imcrop__dropzone--active' : ''}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="点击或拖拽上传图片，也可按 Ctrl+V 粘贴"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
        >
          <div className="imcrop__dropzone-icon" aria-hidden="true">🖼️</div>
          <div className="imcrop__dropzone-text">点击上传、拖拽图片到此处或按 Ctrl+V 粘贴</div>
          <div className="imcrop__dropzone-hint">
            支持 PNG / JPEG / WebP / AVIF / GIF / BMP，单文件最大 20MB
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_INPUT_MIMES.join(',')}
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            hidden
          />
        </div>
      )}

      {error && <div className="imcrop__error" role="alert">{error}</div>}

      {/* 工作区 */}
      {source && (
        <div className="imcrop__workspace">
          {/* 左侧：原图与可视化裁剪框 */}
          <div className="imcrop__canvas-wrap">
            <div className="imcrop__canvas-header">
              <span className="imcrop__canvas-title">原图与裁剪框</span>
              <span className="imcrop__canvas-meta">
                {source.width}×{source.height}px · {formatBytes(source.file.size)}
              </span>
            </div>
            <div ref={imageContainerRef} className={`imcrop__canvas${draggingClass}`}>
              <img
                ref={setImgEl}
                src={source.url}
                alt="待裁剪原图"
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setDisplaySize({ width: img.clientWidth, height: img.clientHeight });
                }}
                draggable={false}
              />
              {/* 裁剪框：基于显示坐标计算位置 */}
              <div
                className="imcrop__crop-box"
                style={{
                  left: rect.x * scale,
                  top: rect.y * scale,
                  width: rect.width * scale,
                  height: rect.height * scale,
                }}
                onMouseDown={startDrag('move')}
              >
                {/* 8 个调整手柄 */}
                {HANDLES.map((h) => (
                  <div
                    key={h.code}
                    className={`imcrop__handle imcrop__handle--${h.code}`}
                    style={{ cursor: h.cursor }}
                    onMouseDown={startDrag(h.code)}
                    aria-label={`调整${h.label}方向`}
                    role="button"
                  />
                ))}
                {/* 中心十字提示（仅在拖拽时显示） */}
                {dragMode && (
                  <div className="imcrop__crop-center" aria-hidden="true">
                    <span className="imcrop__crop-size">
                      {rect.width} × {rect.height}
                    </span>
                  </div>
                )}
              </div>
              {/* 半透明遮罩（4 块，围绕裁剪框） */}
              <div
                className="imcrop__mask imcrop__mask--top"
                style={{ height: rect.y * scale }}
                aria-hidden="true"
              />
              <div
                className="imcrop__mask imcrop__mask--bottom"
                style={{
                  top: (rect.y + rect.height) * scale,
                  height: displaySize.height - (rect.y + rect.height) * scale,
                }}
                aria-hidden="true"
              />
              <div
                className="imcrop__mask imcrop__mask--left"
                style={{
                  top: rect.y * scale,
                  height: rect.height * scale,
                  width: rect.x * scale,
                }}
                aria-hidden="true"
              />
              <div
                className="imcrop__mask imcrop__mask--right"
                style={{
                  top: rect.y * scale,
                  height: rect.height * scale,
                  left: (rect.x + rect.width) * scale,
                  width: displaySize.width - (rect.x + rect.width) * scale,
                }}
                aria-hidden="true"
              />
            </div>
            <div className="imcrop__canvas-hint">
              拖动裁剪框移动位置，拖动 8 个手柄调整大小。所有操作均在浏览器本地完成。
            </div>
          </div>

          {/* 右侧：配置与预览 */}
          <div className="imcrop__panel">
            {/* 比例选择 */}
            <div className="imcrop__field-group">
              <span className="imcrop__field-label">裁剪比例</span>
              <div className="imcrop__ratio-grid" role="radiogroup" aria-label="裁剪比例">
                {ASPECT_RATIOS.map((r) => (
                  <label
                    key={r.code}
                    className={`imcrop__ratio-item${aspectCode === r.code ? ' imcrop__ratio-item--active' : ''}`}
                    title={r.desc}
                  >
                    <input
                      type="radio"
                      name="aspect"
                      value={r.code}
                      checked={aspectCode === r.code}
                      onChange={() => handleAspectChange(r.code)}
                    />
                    <span>{r.label}</span>
                  </label>
                ))}
              </div>
              {aspectCode === 'custom' && (
                <div className="imcrop__custom-ratio">
                  <label className="imcrop__field-label" htmlFor="ratio-w">宽</label>
                  <input
                    id="ratio-w"
                    type="number"
                    min={1}
                    max={100}
                    value={customRatioW}
                    onChange={(e) => updateCustomRatio('w', Number(e.target.value))}
                    className="imcrop__number-input"
                  />
                  <span className="imcrop__ratio-sep">:</span>
                  <label className="imcrop__field-label" htmlFor="ratio-h">高</label>
                  <input
                    id="ratio-h"
                    type="number"
                    min={1}
                    max={100}
                    value={customRatioH}
                    onChange={(e) => updateCustomRatio('h', Number(e.target.value))}
                    className="imcrop__number-input"
                  />
                </div>
              )}
            </div>

            {/* 数值精确输入 */}
            <div className="imcrop__field-group">
              <span className="imcrop__field-label">裁剪区域</span>
              <div className="imcrop__rect-inputs">
                <div className="imcrop__field-inline">
                  <label className="imcrop__mini-label" htmlFor="rect-x">X</label>
                  <input
                    id="rect-x"
                    type="number"
                    min={0}
                    max={source.width}
                    value={Math.round(rect.x)}
                    onChange={(e) => updateRectValue('x', Number(e.target.value))}
                    className="imcrop__number-input"
                  />
                  <span className="imcrop__field-unit">px</span>
                </div>
                <div className="imcrop__field-inline">
                  <label className="imcrop__mini-label" htmlFor="rect-y">Y</label>
                  <input
                    id="rect-y"
                    type="number"
                    min={0}
                    max={source.height}
                    value={Math.round(rect.y)}
                    onChange={(e) => updateRectValue('y', Number(e.target.value))}
                    className="imcrop__number-input"
                  />
                  <span className="imcrop__field-unit">px</span>
                </div>
                <div className="imcrop__field-inline">
                  <label className="imcrop__mini-label" htmlFor="rect-w">宽</label>
                  <input
                    id="rect-w"
                    type="number"
                    min={MIN_CROP_SIZE}
                    max={source.width}
                    value={Math.round(rect.width)}
                    onChange={(e) => updateRectValue('width', Number(e.target.value))}
                    className="imcrop__number-input"
                  />
                  <span className="imcrop__field-unit">px</span>
                </div>
                <div className="imcrop__field-inline">
                  <label className="imcrop__mini-label" htmlFor="rect-h">高</label>
                  <input
                    id="rect-h"
                    type="number"
                    min={MIN_CROP_SIZE}
                    max={source.height}
                    value={Math.round(rect.height)}
                    onChange={(e) => updateRectValue('height', Number(e.target.value))}
                    className="imcrop__number-input"
                  />
                  <span className="imcrop__field-unit">px</span>
                </div>
              </div>
              <div className="imcrop__quick-actions">
                <button type="button" className="imcrop__btn imcrop__btn--ghost imcrop__btn--small" onClick={centerRect}>
                  居中
                </button>
                <button type="button" className="imcrop__btn imcrop__btn--ghost imcrop__btn--small" onClick={resetRect}>
                  重置
                </button>
                <button type="button" className="imcrop__btn imcrop__btn--ghost imcrop__btn--small" onClick={selectAll}>
                  全图
                </button>
              </div>
            </div>

            {/* 导出格式 */}
            <div className="imcrop__field-group">
              <span className="imcrop__field-label">导出格式</span>
              <div className="imcrop__format-options">
                {availableFormats.map((opt) => (
                  <label
                    key={opt.mime}
                    className={`imcrop__format-item${exportCfg.format === opt.mime ? ' imcrop__format-item--active' : ''}`}
                  >
                    <input
                      type="radio"
                      name="export-format"
                      value={opt.mime}
                      checked={exportCfg.format === opt.mime}
                      onChange={() => setExportCfg((p) => ({ ...p, format: opt.mime }))}
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* 质量调节（仅 lossy 格式） */}
            {qualityEditable && (
              <div className="imcrop__field-group">
                <label className="imcrop__field-label" htmlFor="quality">
                  压缩质量
                  <span className="imcrop__field-value">{exportCfg.quality}%</span>
                </label>
                <input
                  id="quality"
                  type="range"
                  min={1}
                  max={100}
                  value={exportCfg.quality}
                  onChange={(e) => setExportCfg((p) => ({ ...p, quality: Number(e.target.value) }))}
                  className="imcrop__slider"
                  aria-label="压缩质量"
                />
              </div>
            )}

            {/* 等比缩放（可选） */}
            <div className="imcrop__field-group">
              <span className="imcrop__field-label">等比缩放（不放大）</span>
              <div className="imcrop__rect-inputs">
                <div className="imcrop__field-inline">
                  <label className="imcrop__mini-label" htmlFor="max-w">最大宽</label>
                  <input
                    id="max-w"
                    type="number"
                    min={0}
                    value={exportCfg.maxWidth}
                    onChange={(e) => setExportCfg((p) => ({ ...p, maxWidth: Math.max(0, Number(e.target.value)) }))}
                    className="imcrop__number-input"
                  />
                  <span className="imcrop__field-unit">px</span>
                </div>
                <div className="imcrop__field-inline">
                  <label className="imcrop__mini-label" htmlFor="max-h">最大高</label>
                  <input
                    id="max-h"
                    type="number"
                    min={0}
                    value={exportCfg.maxHeight}
                    onChange={(e) => setExportCfg((p) => ({ ...p, maxHeight: Math.max(0, Number(e.target.value)) }))}
                    className="imcrop__number-input"
                  />
                  <span className="imcrop__field-unit">px</span>
                </div>
              </div>
              <div className="imcrop__hint-text">填 0 表示不限制；用于裁剪后缩小输出尺寸</div>
            </div>

            {/* 操作按钮 */}
            <div className="imcrop__actions">
              <button type="button" className="imcrop__btn imcrop__btn--primary" onClick={runCrop}>
                执行裁剪
              </button>
              <button type="button" className="imcrop__btn imcrop__btn--ghost" onClick={handleReset}>
                清空
              </button>
            </div>

            {/* 结果预览 */}
            {result && (
              <div className="imcrop__result">
                <div className="imcrop__result-header">
                  <span className="imcrop__result-title">裁剪结果</span>
                  <span className="imcrop__result-meta">
                    {result.width}×{result.height}px · {formatBytes(result.size)} · {result.elapsedMs}ms
                  </span>
                </div>
                <div className="imcrop__result-preview">
                  <img src={result.url} alt="裁剪结果预览" />
                </div>
                <button
                  type="button"
                  className="imcrop__btn imcrop__btn--primary imcrop__btn--block"
                  onClick={handleDownload}
                >
                  下载裁剪结果
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
