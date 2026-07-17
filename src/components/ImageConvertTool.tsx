import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  type SourceImage,
  type ConvertResult,
  type ConvertOptions,
  type OutputMime,
  OUTPUT_FORMATS,
  DEFAULT_OPTIONS,
  MAX_BATCH_COUNT,
  ACCEPTED_INPUT_MIMES,
  loadImage,
  convertImage,
  convertToAllFormats,
  detectAllEncodeSupport,
  formatBytes,
  buildOutputFilename,
  downloadResults,
  computeSavings,
} from '../utils/imageConvert';

/**
 * 图像格式互转工具
 *
 * 全部在浏览器本地用 Canvas API 处理，不发起任何网络请求。
 *
 * 核心能力：
 *  - 批量上传：一次最多 20 张图片
 *  - 单格式批量转换：所有图片转换为同一目标格式
 *  - 全格式对比：单张图片同时输出所有可编码格式，便于横向对比体积
 *  - AVIF / WebP / JPEG / PNG 四格式支持（受浏览器编码能力限制）
 *  - 质量调节（1-100）、等比缩放、背景色（用于透明 → 不透明转换）
 */

/** 单个文件项的状态（包含源图与转换结果） */
interface FileItem {
  id: string;
  source: SourceImage;
  /** 单格式批量模式下的结果 */
  singleResult?: ConvertResult;
  /** 全格式对比模式下的多个结果（按 OUTPUT_FORMATS 顺序） */
  compareResults?: ConvertResult[];
  error?: string;
  processing?: boolean;
}

/** 工作模式 */
type WorkMode = 'single' | 'compare';

/** 生成唯一 id */
function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function ImageConvertTool() {
  // 文件列表
  const [items, setItems] = useState<FileItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 转换配置
  const [options, setOptions] = useState<ConvertOptions>(DEFAULT_OPTIONS);
  const [mode, setMode] = useState<WorkMode>('single');

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

  /** 当前格式是否支持质量调节 */
  const qualityEditable = useMemo(() => {
    const meta = OUTPUT_FORMATS.find((f) => f.mime === options.format);
    return meta?.lossy ?? false;
  }, [options.format]);

  /** 可选的目标格式（仅显示浏览器支持的） */
  const availableFormats = useMemo(
    () => OUTPUT_FORMATS.filter((f) => encodeSupport[f.mime]),
    [encodeSupport],
  );

  /** 处理文件选择（批量） */
  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList).slice(0, MAX_BATCH_COUNT);
      if (files.length === 0) return;

      setError('');
      const newItems: FileItem[] = [];
      for (const file of files) {
        try {
          const source = await loadImage(file);
          newItems.push({ id: genId(), source });
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
      setItems((prev) => [...prev, ...newItems].slice(0, MAX_BATCH_COUNT));
    },
    [],
  );

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
      if (e.dataTransfer.files?.length) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles],
  );

  /** 粘贴事件 */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files: File[] = [];
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
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

  /** 执行转换 */
  const runConvert = useCallback(async () => {
    if (items.length === 0) return;
    setBatchProcessing(true);
    setError('');

    // 标记所有项为处理中
    setItems((prev) => prev.map((it) => ({ ...it, processing: true, error: undefined, singleResult: undefined, compareResults: undefined })));

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        if (mode === 'single') {
          const result = await convertImage(item.source, options);
          setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, singleResult: result, processing: false } : it)));
        } else {
          // 全格式对比：仅对第一张图片执行（多张对比意义不大）
          if (i > 0) {
            setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, processing: false, error: '全格式对比模式仅处理第一张图片' } : it)));
            continue;
          }
          const results = await convertToAllFormats(item.source, encodeSupport, options);
          setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, compareResults: results, processing: false } : it)));
        }
      } catch (e) {
        setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, error: e instanceof Error ? e.message : String(e), processing: false } : it)));
      }
    }
    setBatchProcessing(false);
  }, [items, options, mode, encodeSupport]);

  /** 删除单项 */
  const removeItem = useCallback((id: string) => {
    setItems((prev) => {
      const target = prev.find((it) => it.id === id);
      if (target) {
        URL.revokeObjectURL(target.source.url);
        target.singleResult && URL.revokeObjectURL(target.singleResult.url);
        target.compareResults?.forEach((r) => URL.revokeObjectURL(r.url));
      }
      return prev.filter((it) => it.id !== id);
    });
  }, []);

  /** 清空全部 */
  const handleReset = useCallback(() => {
    items.forEach((it) => {
      URL.revokeObjectURL(it.source.url);
      it.singleResult && URL.revokeObjectURL(it.singleResult.url);
      it.compareResults?.forEach((r) => URL.revokeObjectURL(r.url));
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
        it.singleResult && URL.revokeObjectURL(it.singleResult.url);
        it.compareResults?.forEach((r) => URL.revokeObjectURL(r.url));
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 下载所有结果 */
  const handleDownloadAll = useCallback(async () => {
    const downloadList: { url: string; filename: string }[] = [];
    for (const item of items) {
      if (mode === 'single' && item.singleResult) {
        downloadList.push({
          url: item.singleResult.url,
          filename: buildOutputFilename(item.source.file.name, item.singleResult.mime),
        });
      } else if (mode === 'compare' && item.compareResults) {
        for (const r of item.compareResults) {
          downloadList.push({
            url: r.url,
            filename: buildOutputFilename(item.source.file.name, r.mime),
          });
        }
      }
    }
    if (downloadList.length === 0) return;
    await downloadResults(downloadList);
  }, [items, mode]);

  /** 是否有可下载的结果 */
  const hasResults = items.some(
    (it) => (mode === 'single' && it.singleResult) || (mode === 'compare' && it.compareResults && it.compareResults.length > 0),
  );

  /** 总节省统计（single 模式） */
  const totalSavings = useMemo(() => {
    if (mode !== 'single') return null;
    const completed = items.filter((it) => it.singleResult);
    if (completed.length === 0) return null;
    const originalTotal = completed.reduce((s, it) => s + it.source.file.size, 0);
    const convertedTotal = completed.reduce((s, it) => s + (it.singleResult?.size ?? 0), 0);
    return {
      original: originalTotal,
      converted: convertedTotal,
      ...computeSavings(originalTotal, convertedTotal),
    };
  }, [items, mode]);

  return (
    <div className="imgconv">
      {/* 上传区 */}
      {items.length === 0 && (
        <div
          className={`imgconv__dropzone${dragging ? ' imgconv__dropzone--active' : ''}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="点击或拖拽上传图片，也可按 Ctrl+V 粘贴，支持批量"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
        >
          <div className="imgconv__dropzone-icon" aria-hidden="true">🖼️</div>
          <div className="imgconv__dropzone-text">点击上传、拖拽图片到此处或按 Ctrl+V 粘贴</div>
          <div className="imgconv__dropzone-hint">
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

      {error && <div className="imgconv__error" role="alert">{error}</div>}

      {/* 工作区 */}
      {items.length > 0 && (
        <>
          {/* 模式切换 + 配置面板 */}
          <div className="imgconv__panel">
            <div className="imgconv__mode-tabs" role="tablist" aria-label="工作模式">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'single'}
                className={`imgconv__mode-tab${mode === 'single' ? ' imgconv__mode-tab--active' : ''}`}
                onClick={() => setMode('single')}
              >
                单格式批量转换
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'compare'}
                className={`imgconv__mode-tab${mode === 'compare' ? ' imgconv__mode-tab--active' : ''}`}
                onClick={() => setMode('compare')}
              >
                全格式体积对比
              </button>
            </div>

            {/* 单格式模式：目标格式选择 */}
            {mode === 'single' && (
              <div className="imgconv__field-group">
                <span className="imgconv__field-label">目标格式</span>
                <div className="imgconv__format-options">
                  {availableFormats.map((opt) => (
                    <label
                      key={opt.mime}
                      className={`imgconv__format-item${options.format === opt.mime ? ' imgconv__format-item--active' : ''}`}
                    >
                      <input
                        type="radio"
                        name="format"
                        value={opt.mime}
                        checked={options.format === opt.mime}
                        onChange={() => setOptions((p) => ({ ...p, format: opt.mime }))}
                      />
                      <span className="imgconv__format-label">{opt.label}</span>
                      <span className="imgconv__format-desc">{opt.desc}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* compare 模式说明 */}
            {mode === 'compare' && (
              <div className="imgconv__hint-box">
                全格式对比模式：对第一张图片同时生成所有可编码格式（AVIF / WebP / JPEG / PNG），便于横向对比体积。
                {availableFormats.length < 4 && (
                  <span className="imgconv__hint-warn">当前浏览器仅支持 {availableFormats.length} 种格式编码。</span>
                )}
              </div>
            )}

            {/* 质量滑块 */}
            <div className="imgconv__field-group">
              <span className="imgconv__field-label">
                压缩质量
                {qualityEditable ? (
                  <span className="imgconv__field-value">{options.quality}%</span>
                ) : (
                  <span className="imgconv__field-hint">PNG 无损格式不支持质量调节</span>
                )}
              </span>
              <input
                type="range"
                min={1}
                max={100}
                value={options.quality}
                disabled={!qualityEditable || mode === 'compare'}
                onChange={(e) => setOptions((p) => ({ ...p, quality: Number(e.target.value) }))}
                className="imgconv__slider"
                aria-label="压缩质量"
              />
              {mode === 'compare' && (
                <span className="imgconv__field-hint">对比模式对有损格式统一使用此质量</span>
              )}
            </div>

            {/* 缩放 */}
            <div className="imgconv__field-group imgconv__field-group--row">
              <div className="imgconv__field-inline">
                <label className="imgconv__field-label" htmlFor="max-width">最大宽度</label>
                <input
                  id="max-width"
                  type="number"
                  min={0}
                  value={options.maxWidth || ''}
                  placeholder="不限制"
                  onChange={(e) => setOptions((p) => ({ ...p, maxWidth: Math.max(0, Number(e.target.value)) }))}
                  className="imgconv__number-input"
                />
                <span className="imgconv__field-unit">px</span>
              </div>
              <div className="imgconv__field-inline">
                <label className="imgconv__field-label" htmlFor="max-height">最大高度</label>
                <input
                  id="max-height"
                  type="number"
                  min={0}
                  value={options.maxHeight || ''}
                  placeholder="不限制"
                  onChange={(e) => setOptions((p) => ({ ...p, maxHeight: Math.max(0, Number(e.target.value)) }))}
                  className="imgconv__number-input"
                />
                <span className="imgconv__field-unit">px</span>
              </div>
            </div>

            {/* 背景色 */}
            <div className="imgconv__field-group imgconv__field-group--row">
              <div className="imgconv__field-inline">
                <label className="imgconv__field-label" htmlFor="bg-color">不透明格式背景色</label>
                <input
                  id="bg-color"
                  type="color"
                  value={options.background}
                  onChange={(e) => setOptions((p) => ({ ...p, background: e.target.value }))}
                  className="imgconv__color-input"
                  aria-label="不透明格式背景色"
                />
                <span className="imgconv__field-value">{options.background}</span>
              </div>
              <span className="imgconv__field-hint">JPEG 不支持透明，转换时用此色填充透明区域</span>
            </div>
          </div>

          {/* 文件列表 */}
          <div className="imgconv__file-list">
            <div className="imgconv__file-list-header">
              <span className="imgconv__file-count">共 {items.length} / {MAX_BATCH_COUNT} 张</span>
              <div className="imgconv__file-actions">
                <button
                  type="button"
                  className="imgconv__btn imgconv__btn--ghost"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={items.length >= MAX_BATCH_COUNT}
                >
                  添加图片
                </button>
                <button
                  type="button"
                  className="imgconv__btn imgconv__btn--ghost"
                  onClick={handleReset}
                >
                  清空
                </button>
                <button
                  type="button"
                  className="imgconv__btn imgconv__btn--primary"
                  onClick={runConvert}
                  disabled={batchProcessing}
                >
                  {batchProcessing ? '转换中...' : mode === 'single' ? '批量转换' : '生成对比'}
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

            {/* 文件卡片 */}
            <ul className="imgconv__cards" role="list">
              {items.map((item) => (
                <FileCard
                  key={item.id}
                  item={item}
                  mode={mode}
                  onRemove={() => removeItem(item.id)}
                />
              ))}
            </ul>
          </div>

          {/* 统计与批量下载 */}
          {hasResults && (
            <div className="imgconv__stats-bar">
              {totalSavings && (
                <>
                  <div className="imgconv__stat">
                    <span className="imgconv__stat-label">原始总大小</span>
                    <span className="imgconv__stat-value">{formatBytes(totalSavings.original)}</span>
                  </div>
                  <div className="imgconv__stat">
                    <span className="imgconv__stat-label">转换后总大小</span>
                    <span className="imgconv__stat-value">{formatBytes(totalSavings.converted)}</span>
                  </div>
                  <div className="imgconv__stat">
                    <span className="imgconv__stat-label">总节省</span>
                    <span className={`imgconv__stat-value${totalSavings.ratio > 0 ? ' imgconv__stat-value--good' : ' imgconv__stat-value--bad'}`}>
                      {totalSavings.ratio > 0 ? '-' : '+'}
                      {formatBytes(Math.abs(totalSavings.diff))}（{Math.abs(totalSavings.ratio).toFixed(1)}%）
                    </span>
                  </div>
                </>
              )}
              <button
                type="button"
                className="imgconv__btn imgconv__btn--primary"
                onClick={handleDownloadAll}
              >
                下载全部结果
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** 单个文件卡片：根据模式渲染不同结果展示 */
function FileCard({
  item,
  mode,
  onRemove,
}: {
  item: FileItem;
  mode: WorkMode;
  onRemove: () => void;
}) {
  const sourceSize = item.source.file.size;
  const sourceMimeLabel = item.source.mime.replace('image/', '').toUpperCase();

  return (
    <li className="imgconv__card">
      <div className="imgconv__card-header">
        <span className="imgconv__card-name" title={item.source.file.name}>{item.source.file.name}</span>
        <span className="imgconv__card-meta">
          {item.source.width}×{item.source.height}px · {sourceMimeLabel} · {formatBytes(sourceSize)}
        </span>
        <button
          type="button"
          className="imgconv__card-remove"
          onClick={onRemove}
          aria-label="移除此图片"
        >
          ×
        </button>
      </div>

      {item.processing && <div className="imgconv__card-loading">转换中...</div>}
      {item.error && <div className="imgconv__card-error">{item.error}</div>}

      {/* 单格式结果 */}
      {mode === 'single' && item.singleResult && (
        <div className="imgconv__card-result">
          <div className="imgconv__card-result-preview">
            <img src={item.singleResult.url} alt="转换结果预览" loading="lazy" />
          </div>
          <div className="imgconv__card-result-info">
            <span className={`imgconv__badge imgconv__badge--${item.singleResult.mime.replace('/', '-')}`}>
              {item.singleResult.mime.replace('image/', '').toUpperCase()}
            </span>
            <span className="imgconv__card-result-size">{formatBytes(item.singleResult.size)}</span>
            {(() => {
              const s = computeSavings(sourceSize, item.singleResult.size);
              return (
                <span className={`imgconv__card-result-savings${s.ratio > 0 ? ' imgconv__stat-value--good' : ' imgconv__stat-value--bad'}`}>
                  {s.ratio > 0 ? '-' : '+'}{formatBytes(Math.abs(s.diff))}（{Math.abs(s.ratio).toFixed(1)}%）
                </span>
              );
            })()}
            <a
              href={item.singleResult.url}
              download={buildOutputFilename(item.source.file.name, item.singleResult.mime)}
              className="imgconv__btn imgconv__btn--small"
            >
              下载
            </a>
          </div>
        </div>
      )}

      {/* 全格式对比结果 */}
      {mode === 'compare' && item.compareResults && item.compareResults.length > 0 && (
        <div className="imgconv__card-compare">
          {item.compareResults.map((r) => {
            const s = computeSavings(sourceSize, r.size);
            const isBest = item.compareResults!.every((other) => other.size >= r.size);
            return (
              <div key={r.mime} className="imgconv__compare-item">
                <div className="imgconv__compare-preview">
                  <img src={r.url} alt={`${r.mime} 预览`} loading="lazy" />
                </div>
                <div className="imgconv__compare-info">
                  <span className="imgconv__compare-format">
                    {r.mime.replace('image/', '').toUpperCase()}
                    {isBest && <span className="imgconv__badge imgconv__badge--best">最小</span>}
                  </span>
                  <span className="imgconv__compare-size">{formatBytes(r.size)}</span>
                  <span className={`imgconv__compare-savings${s.ratio > 0 ? ' imgconv__stat-value--good' : ' imgconv__stat-value--bad'}`}>
                    {s.ratio > 0 ? '-' : '+'}{Math.abs(s.ratio).toFixed(1)}%
                  </span>
                  <a
                    href={r.url}
                    download={buildOutputFilename(item.source.file.name, r.mime)}
                    className="imgconv__btn imgconv__btn--small"
                  >
                    下载
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </li>
  );
}
