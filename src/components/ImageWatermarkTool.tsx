import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  type SourceImage,
  type OutputMime,
  type WatermarkType,
  type WatermarkPosition,
  type WatermarkConfig,
  type ExportConfig,
  type WatermarkResult,
  POSITIONS,
  FONT_FAMILIES,
  OUTPUT_FORMATS,
  ACCEPTED_INPUT_MIMES,
  MAX_BATCH_COUNT,
  DEFAULT_WATERMARK_CONFIG,
  DEFAULT_EXPORT_CONFIG,
  loadImage,
  applyWatermark,
  applyWatermarkBatch,
  detectAllEncodeSupport,
  formatBytes,
  downloadBlob,
  buildWatermarkFilename,
} from '../utils/imageWatermark';

/**
 * 图片水印工具
 *
 * 全部在浏览器本地用 Canvas API 处理，不发起任何网络请求。
 *
 * 核心能力：
 *  - 文字 / 图片两种水印类型
 *  - 九宫格 + 平铺共 10 种位置
 *  - 旋转、不透明度、描边（文字）、缩放（图片）
 *  - 批量处理：一次最多 20 张底图统一加水印
 *  - 多格式导出：PNG / JPEG / WebP / AVIF（受浏览器编码能力限制）
 */

/** 底图项 */
interface BaseItem {
  id: string;
  source: SourceImage;
  result?: WatermarkResult;
  error?: string;
  processing?: boolean;
}

/** 生成唯一 id */
function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function ImageWatermarkTool() {
  // 底图列表
  const [items, setItems] = useState<BaseItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 水印配置
  const [watermark, setWatermark] = useState<WatermarkConfig>(
    // 深拷贝默认配置，避免共享引用
    JSON.parse(JSON.stringify(DEFAULT_WATERMARK_CONFIG)),
  );
  const [exportCfg, setExportCfg] = useState<ExportConfig>({ ...DEFAULT_EXPORT_CONFIG });

  // 图片水印的水印图片
  const [wmImageSource, setWmImageSource] = useState<SourceImage | null>(null);
  const [wmImageEl, setWmImageEl] = useState<HTMLImageElement | null>(null);
  const wmFileInputRef = useRef<HTMLInputElement>(null);

  // 实时预览（第一张底图）
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [previewing, setPreviewing] = useState(false);

  // 浏览器格式编码支持
  const [encodeSupport, setEncodeSupport] = useState<Record<OutputMime, boolean>>({
    'image/avif': false,
    'image/webp': true,
    'image/jpeg': true,
    'image/png': true,
  });

  // 交互反馈
  const [error, setError] = useState('');
  const [batchProcessing, setBatchProcessing] = useState(false);

  /** 组件挂载时探测浏览器编码支持 */
  useEffect(() => {
    detectAllEncodeSupport().then(setEncodeSupport).catch(() => undefined);
  }, []);

  /** 可选的导出格式（仅显示浏览器支持的） */
  const availableFormats = useMemo(
    () => OUTPUT_FORMATS.filter((f) => encodeSupport[f.mime]),
    [encodeSupport],
  );

  /** 当前导出格式是否支持质量调节 */
  const qualityEditable = useMemo(() => {
    const meta = OUTPUT_FORMATS.find((f) => f.mime === exportCfg.format);
    return meta?.lossy ?? false;
  }, [exportCfg.format]);

  /** 处理底图文件选择（批量） */
  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).slice(0, MAX_BATCH_COUNT);
    if (files.length === 0) return;
    setError('');
    const newItems: BaseItem[] = [];
    for (const file of files) {
      try {
        const source = await loadImage(file);
        newItems.push({ id: genId(), source });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    setItems((prev) => [...prev, ...newItems].slice(0, MAX_BATCH_COUNT));
  }, []);

  /** 加载水印图片（图片水印模式） */
  const handleWmFile = useCallback(async (file: File) => {
    setError('');
    try {
      const source = await loadImage(file);
      // 加载为 HTMLImageElement 供水印绘制使用
      const img = new Image();
      img.onload = () => setWmImageEl(img);
      img.onerror = () => setError('水印图片加载失败');
      img.src = source.url;
      setWmImageSource(source);
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
      if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  /** 粘贴事件 */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files: File[] = [];
      const list = e.clipboardData?.items;
      if (!list) return;
      for (const item of list) {
        if (item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) handleFiles(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleFiles]);

  /** 实时预览：对第一张底图渲染水印（防抖 200ms） */
  useEffect(() => {
    const first = items[0];
    if (!first) {
      setPreviewUrl('');
      return;
    }
    // 图片水印模式但水印图片未就绪时，仅预览底图
    if (watermark.type === 'image' && !wmImageEl) {
      setPreviewUrl(first.source.url);
      return;
    }
    setPreviewing(true);
    const timer = setTimeout(async () => {
      try {
        const result = await applyWatermark(first.source, watermark, exportCfg, wmImageEl ?? undefined);
        setPreviewUrl((prev) => {
          if (prev && prev !== first.source.url) URL.revokeObjectURL(prev);
          return result.url;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setPreviewing(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [items, watermark, exportCfg, wmImageEl]);

  /** 批量加水印并导出 */
  const runBatch = useCallback(async () => {
    if (items.length === 0) return;
    if (watermark.type === 'image' && !wmImageEl) {
      setError('请先上传水印图片');
      return;
    }
    setBatchProcessing(true);
    setError('');
    setItems((prev) => prev.map((it) => ({ ...it, processing: true, error: undefined, result: undefined })));
    try {
      const results = await applyWatermarkBatch(
        items.map((it) => it.source),
        watermark,
        exportCfg,
        wmImageEl ?? undefined,
      );
      setItems((prev) => prev.map((it, i) => ({ ...it, result: results[i], processing: false })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems((prev) => prev.map((it) => ({ ...it, processing: false })));
    } finally {
      setBatchProcessing(false);
    }
  }, [items, watermark, exportCfg, wmImageEl]);

  /** 删除单项 */
  const removeItem = useCallback((id: string) => {
    setItems((prev) => {
      const target = prev.find((it) => it.id === id);
      if (target) {
        URL.revokeObjectURL(target.source.url);
        target.result && URL.revokeObjectURL(target.result.url);
      }
      return prev.filter((it) => it.id !== id);
    });
  }, []);

  /** 清空全部 */
  const handleReset = useCallback(() => {
    items.forEach((it) => {
      URL.revokeObjectURL(it.source.url);
      it.result && URL.revokeObjectURL(it.result.url);
    });
    setItems([]);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [items]);

  /** 卸载时清理所有 URL */
  useEffect(() => {
    return () => {
      items.forEach((it) => {
        URL.revokeObjectURL(it.source.url);
        it.result && URL.revokeObjectURL(it.result.url);
      });
      wmImageSource && URL.revokeObjectURL(wmImageSource.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 下载所有结果（逐个触发，200ms 间隔） */
  const handleDownloadAll = useCallback(async () => {
    const list: { url: string; filename: string }[] = [];
    for (const it of items) {
      if (it.result) {
        list.push({
          url: it.result.url,
          filename: buildWatermarkFilename(it.source.file.name, it.result.mime),
        });
      }
    }
    for (let i = 0; i < list.length; i++) {
      downloadBlob(list[i].url, list[i].filename);
      if (i < list.length - 1) await new Promise((r) => setTimeout(r, 200));
    }
  }, [items]);

  const hasResults = items.some((it) => it.result);
  const showTile = watermark.position === 'tile';

  /** 更新水印配置的辅助函数 */
  const updateWm = useCallback(<K extends keyof WatermarkConfig>(key: K, value: WatermarkConfig[K]) => {
    setWatermark((prev) => ({ ...prev, [key]: value }));
  }, []);
  const updateText = useCallback(<K extends keyof WatermarkConfig['text']>(key: K, value: WatermarkConfig['text'][K]) => {
    setWatermark((prev) => ({ ...prev, text: { ...prev.text, [key]: value } }));
  }, []);
  const updateImage = useCallback(<K extends keyof WatermarkConfig['image']>(key: K, value: WatermarkConfig['image'][K]) => {
    setWatermark((prev) => ({ ...prev, image: { ...prev.image, [key]: value } }));
  }, []);

  return (
    <div className="imwm">
      {/* 上传区 */}
      {items.length === 0 && (
        <div
          className={`imwm__dropzone${dragging ? ' imwm__dropzone--active' : ''}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="点击或拖拽上传底图，也可按 Ctrl+V 粘贴，支持批量"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
        >
          <div className="imwm__dropzone-icon" aria-hidden="true">🖼️</div>
          <div className="imwm__dropzone-text">点击上传、拖拽图片到此处或按 Ctrl+V 粘贴</div>
          <div className="imwm__dropzone-hint">
            支持 PNG / JPEG / WebP / AVIF / GIF / BMP，最多 {MAX_BATCH_COUNT} 张，单文件最大 20MB
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_INPUT_MIMES.join(',')}
            multiple
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
            hidden
          />
        </div>
      )}

      {error && <div className="imwm__error" role="alert">{error}</div>}

      {/* 工作区 */}
      {items.length > 0 && (
        <div className="imwm__workspace">
          {/* 左侧配置面板 */}
          <div className="imwm__panel">
            {/* 水印类型 */}
            <div className="imwm__field-group">
              <span className="imwm__field-label">水印类型</span>
              <div className="imwm__type-tabs" role="tablist" aria-label="水印类型">
                <button
                  type="button"
                  role="tab"
                  aria-selected={watermark.type === 'text'}
                  className={`imwm__type-tab${watermark.type === 'text' ? ' imwm__type-tab--active' : ''}`}
                  onClick={() => updateWm('type', 'text' as WatermarkType)}
                >
                  文字水印
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={watermark.type === 'image'}
                  className={`imwm__type-tab${watermark.type === 'image' ? ' imwm__type-tab--active' : ''}`}
                  onClick={() => updateWm('type', 'image' as WatermarkType)}
                >
                  图片水印
                </button>
              </div>
            </div>

            {/* 文字水印配置 */}
            {watermark.type === 'text' && (
              <>
                <div className="imwm__field-group">
                  <label className="imwm__field-label" htmlFor="wm-text">水印文字</label>
                  <input
                    id="wm-text"
                    type="text"
                    value={watermark.text.text}
                    onChange={(e) => updateText('text', e.target.value)}
                    placeholder="请输入水印文字"
                    className="imwm__text-input"
                  />
                </div>
                <div className="imwm__field-group imwm__field-group--row">
                  <div className="imwm__field-inline">
                    <label className="imwm__field-label" htmlFor="wm-font">字体</label>
                    <select
                      id="wm-font"
                      value={watermark.text.fontFamily}
                      onChange={(e) => updateText('fontFamily', e.target.value)}
                      className="imwm__select"
                    >
                      {FONT_FAMILIES.map((f) => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="imwm__field-inline">
                    <label className="imwm__field-label" htmlFor="wm-size">字号</label>
                    <input
                      id="wm-size"
                      type="number"
                      min={8}
                      max={200}
                      value={watermark.text.fontSize}
                      onChange={(e) => updateText('fontSize', Math.max(8, Math.min(200, Number(e.target.value))))}
                      className="imwm__number-input"
                    />
                    <span className="imwm__field-unit">px</span>
                  </div>
                </div>
                <div className="imwm__field-group imwm__field-group--row">
                  <div className="imwm__field-inline">
                    <label className="imwm__field-label" htmlFor="wm-color">文字颜色</label>
                    <input
                      id="wm-color"
                      type="color"
                      value={watermark.text.color}
                      onChange={(e) => updateText('color', e.target.value)}
                      className="imwm__color-input"
                      aria-label="文字颜色"
                    />
                  </div>
                  <div className="imwm__field-inline">
                    <label className="imwm__field-label" htmlFor="wm-opacity">不透明度</label>
                    <input
                      id="wm-opacity"
                      type="range"
                      min={0}
                      max={100}
                      value={watermark.text.opacity}
                      onChange={(e) => updateText('opacity', Number(e.target.value))}
                      className="imwm__slider"
                      aria-label="不透明度"
                    />
                    <span className="imwm__field-value">{watermark.text.opacity}%</span>
                  </div>
                </div>
                <div className="imwm__field-group imwm__field-group--row">
                  <div className="imwm__field-inline">
                    <label className="imwm__field-label" htmlFor="wm-stroke">描边宽度</label>
                    <input
                      id="wm-stroke"
                      type="range"
                      min={0}
                      max={10}
                      value={watermark.text.strokeWidth}
                      onChange={(e) => updateText('strokeWidth', Number(e.target.value))}
                      className="imwm__slider"
                      aria-label="描边宽度"
                    />
                    <span className="imwm__field-value">{watermark.text.strokeWidth}px</span>
                  </div>
                  {watermark.text.strokeWidth > 0 && (
                    <div className="imwm__field-inline">
                      <label className="imwm__field-label" htmlFor="wm-stroke-color">描边色</label>
                      <input
                        id="wm-stroke-color"
                        type="color"
                        value={watermark.text.strokeColor}
                        onChange={(e) => updateText('strokeColor', e.target.value)}
                        className="imwm__color-input"
                        aria-label="描边颜色"
                      />
                    </div>
                  )}
                </div>
              </>
            )}

            {/* 图片水印配置 */}
            {watermark.type === 'image' && (
              <>
                <div className="imwm__field-group">
                  <span className="imwm__field-label">水印图片</span>
                  {wmImageSource ? (
                    <div className="imwm__wm-preview">
                      <img src={wmImageSource.url} alt="水印图片预览" />
                      <button
                        type="button"
                        className="imwm__btn imwm__btn--ghost imwm__btn--small"
                        onClick={() => {
                          if (wmImageSource) URL.revokeObjectURL(wmImageSource.url);
                          setWmImageSource(null);
                          setWmImageEl(null);
                          if (wmFileInputRef.current) wmFileInputRef.current.value = '';
                        }}
                      >
                        更换
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="imwm__btn imwm__btn--ghost"
                      onClick={() => wmFileInputRef.current?.click()}
                    >
                      上传水印图片
                    </button>
                  )}
                  <input
                    ref={wmFileInputRef}
                    type="file"
                    accept={ACCEPTED_INPUT_MIMES.join(',')}
                    onChange={(e) => e.target.files?.[0] && handleWmFile(e.target.files[0])}
                    hidden
                  />
                </div>
                <div className="imwm__field-group imwm__field-group--row">
                  <div className="imwm__field-inline">
                    <label className="imwm__field-label" htmlFor="wm-scale">缩放比例</label>
                    <input
                      id="wm-scale"
                      type="range"
                      min={5}
                      max={100}
                      value={watermark.image.scale}
                      onChange={(e) => updateImage('scale', Number(e.target.value))}
                      className="imwm__slider"
                      aria-label="水印图片缩放比例"
                    />
                    <span className="imwm__field-value">{watermark.image.scale}%</span>
                  </div>
                  <div className="imwm__field-inline">
                    <label className="imwm__field-label" htmlFor="wm-img-opacity">不透明度</label>
                    <input
                      id="wm-img-opacity"
                      type="range"
                      min={0}
                      max={100}
                      value={watermark.image.opacity}
                      onChange={(e) => updateImage('opacity', Number(e.target.value))}
                      className="imwm__slider"
                      aria-label="水印图片不透明度"
                    />
                    <span className="imwm__field-value">{watermark.image.opacity}%</span>
                  </div>
                </div>
              </>
            )}

            {/* 位置选择 */}
            <div className="imwm__field-group">
              <span className="imwm__field-label">位置</span>
              <div className="imwm__position-grid" role="radiogroup" aria-label="水印位置">
                {POSITIONS.map((p) => (
                  <label
                    key={p.code}
                    className={`imwm__position-item${watermark.position === p.code ? ' imwm__position-item--active' : ''}`}
                    title={p.desc}
                  >
                    <input
                      type="radio"
                      name="position"
                      value={p.code}
                      checked={watermark.position === p.code}
                      onChange={() => updateWm('position', p.code as WatermarkPosition)}
                    />
                    <span>{p.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* 通用：旋转 */}
            <div className="imwm__field-group">
              <label className="imwm__field-label" htmlFor="wm-rotation">
                旋转角度
                <span className="imwm__field-value">{watermark.rotation}°</span>
              </label>
              <input
                id="wm-rotation"
                type="range"
                min={-180}
                max={180}
                value={watermark.rotation}
                onChange={(e) => updateWm('rotation', Number(e.target.value))}
                className="imwm__slider"
                aria-label="旋转角度"
              />
            </div>

            {/* 九宫格边距（平铺模式隐藏） */}
            {!showTile && (
              <div className="imwm__field-group imwm__field-group--row">
                <div className="imwm__field-inline">
                  <label className="imwm__field-label" htmlFor="wm-mx">水平边距</label>
                  <input
                    id="wm-mx"
                    type="number"
                    min={0}
                    value={watermark.marginX}
                    onChange={(e) => updateWm('marginX', Math.max(0, Number(e.target.value)))}
                    className="imwm__number-input"
                  />
                  <span className="imwm__field-unit">px</span>
                </div>
                <div className="imwm__field-inline">
                  <label className="imwm__field-label" htmlFor="wm-my">垂直边距</label>
                  <input
                    id="wm-my"
                    type="number"
                    min={0}
                    value={watermark.marginY}
                    onChange={(e) => updateWm('marginY', Math.max(0, Number(e.target.value)))}
                    className="imwm__number-input"
                  />
                  <span className="imwm__field-unit">px</span>
                </div>
              </div>
            )}

            {/* 平铺间距（仅平铺模式） */}
            {showTile && (
              <div className="imwm__field-group imwm__field-group--row">
                <div className="imwm__field-inline">
                  <label className="imwm__field-label" htmlFor="wm-tsx">水平间距</label>
                  <input
                    id="wm-tsx"
                    type="number"
                    min={20}
                    value={watermark.tileSpacingX}
                    onChange={(e) => updateWm('tileSpacingX', Math.max(20, Number(e.target.value)))}
                    className="imwm__number-input"
                  />
                  <span className="imwm__field-unit">px</span>
                </div>
                <div className="imwm__field-inline">
                  <label className="imwm__field-label" htmlFor="wm-tsy">垂直间距</label>
                  <input
                    id="wm-tsy"
                    type="number"
                    min={20}
                    value={watermark.tileSpacingY}
                    onChange={(e) => updateWm('tileSpacingY', Math.max(20, Number(e.target.value)))}
                    className="imwm__number-input"
                  />
                  <span className="imwm__field-unit">px</span>
                </div>
              </div>
            )}

            {/* 导出配置 */}
            <div className="imwm__field-group">
              <span className="imwm__field-label">导出格式</span>
              <div className="imwm__format-options">
                {availableFormats.map((opt) => (
                  <label
                    key={opt.mime}
                    className={`imwm__format-item${exportCfg.format === opt.mime ? ' imwm__format-item--active' : ''}`}
                  >
                    <input
                      type="radio"
                      name="export-format"
                      value={opt.mime}
                      checked={exportCfg.format === opt.mime}
                      onChange={() => setExportCfg((p) => ({ ...p, format: opt.mime }))}
                    />
                    <span className="imwm__format-label">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
            {qualityEditable && (
              <div className="imwm__field-group">
                <label className="imwm__field-label" htmlFor="wm-quality">
                  压缩质量
                  <span className="imwm__field-value">{exportCfg.quality}%</span>
                </label>
                <input
                  id="wm-quality"
                  type="range"
                  min={1}
                  max={100}
                  value={exportCfg.quality}
                  onChange={(e) => setExportCfg((p) => ({ ...p, quality: Number(e.target.value) }))}
                  className="imwm__slider"
                  aria-label="压缩质量"
                />
              </div>
            )}
          </div>

          {/* 右侧预览 + 文件列表 */}
          <div className="imwm__main">
            {/* 实时预览 */}
            <div className="imwm__preview-wrap">
              <div className="imwm__preview-header">
                <span className="imwm__preview-title">实时预览</span>
                {previewing && <span className="imwm__preview-status">渲染中…</span>}
              </div>
              <div className="imwm__preview-canvas">
                {previewUrl ? (
                  <img src={previewUrl} alt="水印效果预览" />
                ) : (
                  <div className="imwm__preview-empty">请上传底图</div>
                )}
              </div>
            </div>

            {/* 文件列表 */}
            <div className="imwm__file-list">
              <div className="imwm__file-list-header">
                <span className="imwm__file-count">共 {items.length} / {MAX_BATCH_COUNT} 张</span>
                <div className="imwm__file-actions">
                  <button
                    type="button"
                    className="imwm__btn imwm__btn--ghost"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={items.length >= MAX_BATCH_COUNT}
                  >
                    添加
                  </button>
                  <button type="button" className="imwm__btn imwm__btn--ghost" onClick={handleReset}>
                    清空
                  </button>
                  <button
                    type="button"
                    className="imwm__btn imwm__btn--primary"
                    onClick={runBatch}
                    disabled={batchProcessing}
                  >
                    {batchProcessing ? '处理中...' : '批量加水印'}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_INPUT_MIMES.join(',')}
                    multiple
                    onChange={(e) => e.target.files && handleFiles(e.target.files)}
                    hidden
                  />
                </div>
              </div>
              <ul className="imwm__cards" role="list">
                {items.map((item) => (
                  <li key={item.id} className="imwm__card">
                    <div className="imwm__card-header">
                      <span className="imwm__card-name" title={item.source.file.name}>{item.source.file.name}</span>
                      <span className="imwm__card-meta">
                        {item.source.width}×{item.source.height}px · {formatBytes(item.source.file.size)}
                      </span>
                      <button
                        type="button"
                        className="imwm__card-remove"
                        onClick={() => removeItem(item.id)}
                        aria-label="移除此图片"
                      >×</button>
                    </div>
                    {item.processing && <div className="imwm__card-loading">处理中…</div>}
                    {item.error && <div className="imwm__card-error">{item.error}</div>}
                    {item.result && (
                      <div className="imwm__card-result">
                        <div className="imwm__card-result-preview">
                          <img src={item.result.url} alt="水印结果预览" loading="lazy" />
                        </div>
                        <div className="imwm__card-result-info">
                          <span className={`imwm__badge imwm__badge--${item.result.mime.replace('/', '-')}`}>
                            {item.result.mime.replace('image/', '').toUpperCase()}
                          </span>
                          <span className="imwm__card-result-size">{formatBytes(item.result.size)}</span>
                          <a
                            href={item.result.url}
                            download={buildWatermarkFilename(item.source.file.name, item.result.mime)}
                            className="imwm__btn imwm__btn--small"
                          >
                            下载
                          </a>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {hasResults && (
                <button
                  type="button"
                  className="imwm__btn imwm__btn--primary imwm__download-all"
                  onClick={handleDownloadAll}
                >
                  下载全部结果
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
