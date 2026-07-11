import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { formatBytes } from '../utils/base64Image';

/**
 * 图片压缩工具
 * 全部在浏览器本地用 Canvas API 处理，不发起任何网络请求。
 *
 * 功能：
 *  - 支持 PNG / JPEG / WebP / GIF（首帧）输入
 *  - 输出格式：JPEG、WebP、PNG（PNG 无损，质量参数不生效）
 *  - 质量调节（1-100）：仅对 JPEG / WebP 有损格式生效
 *  - 可选尺寸缩放：按最大宽度或最大高度等比缩放
 *  - 实时预览原图与压缩后图片，展示压缩比、尺寸、文件大小
 *  - 一键下载压缩后图片
 *
 * 适用场景：博客图片优化、网页性能优化、邮件附件压缩、存储空间节省
 */

/** 输出格式选项 */
type OutputFormat = 'image/jpeg' | 'image/webp' | 'image/png';

/** 原始图片信息 */
interface SourceImage {
  file: File;
  url: string;          // ObjectURL 用于预览
  width: number;
  height: number;
  mime: string;
}

/** 压缩结果 */
interface CompressedResult {
  blob: Blob;
  url: string;          // ObjectURL 用于预览与下载
  width: number;
  height: number;
  size: number;
  mime: OutputFormat;
}

/** 输入文件大小上限：20MB，避免浏览器内存压力 */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

/** 支持的输入 MIME 类型 */
const ACCEPTED_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** 输出格式元数据：供选择器渲染 */
const FORMAT_OPTIONS: { value: OutputFormat; label: string; desc: string }[] = [
  { value: 'image/webp', label: 'WebP', desc: '体积最小，现代浏览器全支持' },
  { value: 'image/jpeg', label: 'JPEG', desc: '兼容性最好，不支持透明' },
  { value: 'image/png', label: 'PNG', desc: '无损压缩，支持透明' },
];

/** 由 MIME 推断文件扩展名 */
function extFromMime(mime: string): string {
  switch (mime) {
    case 'image/jpeg': return 'jpg';
    case 'image/webp': return 'webp';
    case 'image/png': return 'png';
    case 'image/gif': return 'gif';
    default: return 'bin';
  }
}

/** 由原文件名生成压缩后文件名（替换扩展名） */
function buildOutputFilename(originalName: string, mime: OutputFormat): string {
  const dotIdx = originalName.lastIndexOf('.');
  const base = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
  return `${base}-compressed.${extFromMime(mime)}`;
}

/**
 * 加载图片文件为 HTMLImageElement，获取原始尺寸
 * 使用 ObjectURL 而非 DataURL，避免大文件的 Base64 编码开销
 */
function loadImage(file: File): Promise<SourceImage> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('请选择图片文件（PNG / JPEG / WebP / GIF）'));
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      reject(new Error(`文件过大（${formatBytes(file.size)}），请选择小于 20MB 的图片`));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({
        file,
        url,
        width: img.naturalWidth,
        height: img.naturalHeight,
        mime: file.type,
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片加载失败，文件可能已损坏或格式不支持'));
    };
    img.src = url;
  });
}

/**
 * 计算缩放后的目标尺寸
 * 仅在超出限制时缩放，保持宽高比，不放大
 */
function computeTargetSize(
  srcW: number,
  srcH: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  let width = srcW;
  let height = srcH;
  // 优先按最大宽度缩放
  if (maxWidth > 0 && width > maxWidth) {
    height = Math.round((height * maxWidth) / width);
    width = maxWidth;
  }
  // 再按最大高度缩放（可能进一步缩小）
  if (maxHeight > 0 && height > maxHeight) {
    width = Math.round((width * maxHeight) / height);
    height = maxHeight;
  }
  return { width, height };
}

/**
 * 使用 Canvas 压缩图片
 * - JPEG 不支持透明，需白色背景填充
 * - PNG 为无损格式，quality 参数不生效
 * - 使用 toBlob 而非 toDataURL，避免 Base64 编码开销
 */
function compressImage(
  source: SourceImage,
  format: OutputFormat,
  quality: number,
  maxWidth: number,
  maxHeight: number,
): Promise<CompressedResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const { width, height } = computeTargetSize(
          source.width,
          source.height,
          maxWidth,
          maxHeight,
        );
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D 上下文不可用，请更换浏览器'));
          return;
        }
        // JPEG 不支持透明通道：先填白色背景，避免透明区域变黑
        if (format === 'image/jpeg') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
        }
        // 缩放绘制：浏览器内置双线性插值，质量足够
        ctx.drawImage(img, 0, 0, width, height);
        // PNG 无损：忽略 quality；JPEG/WebP 用 quality/100 作为编码质量
        const qualityParam = format === 'image/png' ? undefined : quality / 100;
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('压缩失败，目标格式可能不被当前浏览器支持'));
              return;
            }
            const url = URL.createObjectURL(blob);
            resolve({
              blob,
              url,
              width,
              height,
              size: blob.size,
              mime: format,
            });
          },
          format,
          qualityParam,
        );
      } catch (e) {
        reject(new Error(`压缩失败：${e instanceof Error ? e.message : String(e)}`));
      }
    };
    img.onerror = () => reject(new Error('图片加载失败，无法压缩'));
    img.src = source.url;
  });
}

/** 触发文件下载 */
function downloadBlob(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export default function ImageCompressTool() {
  // 源图片状态
  const [source, setSource] = useState<SourceImage | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 压缩配置
  const [format, setFormat] = useState<OutputFormat>('image/webp');
  const [quality, setQuality] = useState<number>(80);
  const [maxWidth, setMaxWidth] = useState<number>(0);
  const [maxHeight, setMaxHeight] = useState<number>(0);

  // 压缩结果
  const [result, setResult] = useState<CompressedResult | null>(null);
  const [compressing, setCompressing] = useState(false);

  // 交互反馈
  const [error, setError] = useState<string>('');
  const [notice, setNotice] = useState<string>('');

  /** 当前格式是否支持质量调节（PNG 无损不支持） */
  const qualityEditable = format !== 'image/png';

  /** 压缩比：负数表示压缩后更大（体积反而增加） */
  const savings = useMemo(() => {
    if (!source || !result) return null;
    const diff = source.file.size - result.size;
    const ratio = (diff / source.file.size) * 100;
    return { diff, ratio };
  }, [source, result]);

  /** 清理 ObjectURL 避免内存泄漏 */
  const revokeUrls = useCallback(() => {
    if (source) URL.revokeObjectURL(source.url);
    if (result) URL.revokeObjectURL(result.url);
  }, [source, result]);

  /** 处理文件选择 */
  const handleFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file) return;
      // 清理旧数据
      revokeUrls();
      setResult(null);
      setError('');
      setNotice('');
      setLoading(true);
      try {
        const img = await loadImage(file);
        setSource(img);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setSource(null);
      } finally {
        setLoading(false);
      }
    },
    [revokeUrls],
  );

  /** 拖拽事件处理 */
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
      handleFile(file);
    },
    [handleFile],
  );

  /** 粘贴事件：监听剪贴板中的图片 */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            handleFile(file);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleFile]);

  /**
   * 执行压缩
   * 配置变化时自动触发（防抖避免频繁压缩）
   */
  useEffect(() => {
    if (!source) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setCompressing(true);
    setError('');
    // 200ms 防抖：用户拖动质量滑块时避免每次微调都触发压缩
    const timer = setTimeout(async () => {
      try {
        const res = await compressImage(source, format, quality, maxWidth, maxHeight);
        if (cancelled) {
          URL.revokeObjectURL(res.url);
          return;
        }
        // 清理旧结果 URL
        if (result) URL.revokeObjectURL(result.url);
        setResult(res);
        if (res.size >= source.file.size) {
          setNotice('压缩后体积未减小（原图已是高压缩率格式或尺寸较小）');
        } else {
          setNotice('');
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setCompressing(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // 依赖 source/format/quality/maxWidth/maxHeight；result 不入依赖避免循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, format, quality, maxWidth, maxHeight]);

  /** 重置全部状态 */
  const handleReset = useCallback(() => {
    revokeUrls();
    setSource(null);
    setResult(null);
    setError('');
    setNotice('');
    setFormat('image/webp');
    setQuality(80);
    setMaxWidth(0);
    setMaxHeight(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [revokeUrls]);

  /** 下载压缩结果 */
  const handleDownload = useCallback(() => {
    if (!result || !source) return;
    downloadBlob(result.url, buildOutputFilename(source.file.name, result.mime));
  }, [result, source]);

  /** 卸载时清理 ObjectURL */
  useEffect(() => {
    return () => {
      if (source) URL.revokeObjectURL(source.url);
      if (result) URL.revokeObjectURL(result.url);
    };
    // 仅组件卸载时清理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="imgcomp">
      {/* 上传区 */}
      {!source && (
        <div
          className={`imgcomp__dropzone${dragging ? ' imgcomp__dropzone--active' : ''}`}
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
          <div className="imgcomp__dropzone-icon" aria-hidden="true">🖼️</div>
          <div className="imgcomp__dropzone-text">
            {loading ? '加载中...' : '点击上传、拖拽图片到此处或按 Ctrl+V 粘贴'}
          </div>
          <div className="imgcomp__dropzone-hint">支持 PNG / JPEG / WebP / GIF，最大 20MB</div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_MIMES.join(',')}
            onChange={(e) => handleFile(e.target.files?.[0])}
            hidden
          />
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="imgcomp__error" role="alert">
          {error}
        </div>
      )}

      {/* 压缩工作区 */}
      {source && (
        <>
          {/* 配置面板 */}
          <div className="imgcomp__panel">
            <div className="imgcomp__field-group">
              <span className="imgcomp__field-label">输出格式</span>
              <div className="imgcomp__format-options">
                {FORMAT_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`imgcomp__format-item${format === opt.value ? ' imgcomp__format-item--active' : ''}`}
                  >
                    <input
                      type="radio"
                      name="format"
                      value={opt.value}
                      checked={format === opt.value}
                      onChange={() => setFormat(opt.value)}
                    />
                    <span className="imgcomp__format-label">{opt.label}</span>
                    <span className="imgcomp__format-desc">{opt.desc}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* 质量滑块：仅 JPEG/WebP 生效 */}
            <div className="imgcomp__field-group">
              <span className="imgcomp__field-label">
                压缩质量
                {qualityEditable ? (
                  <span className="imgcomp__field-value">{quality}%</span>
                ) : (
                  <span className="imgcomp__field-hint">PNG 无损格式不支持质量调节</span>
                )}
              </span>
              <input
                type="range"
                min={1}
                max={100}
                value={quality}
                disabled={!qualityEditable}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="imgcomp__slider"
                aria-label="压缩质量"
              />
            </div>

            {/* 尺寸缩放选项 */}
            <div className="imgcomp__field-group imgcomp__field-group--row">
              <div className="imgcomp__field-inline">
                <label className="imgcomp__field-label" htmlFor="max-width">最大宽度</label>
                <input
                  id="max-width"
                  type="number"
                  min={0}
                  value={maxWidth || ''}
                  placeholder="不限制"
                  onChange={(e) => setMaxWidth(Math.max(0, Number(e.target.value)))}
                  className="imgcomp__number-input"
                />
                <span className="imgcomp__field-unit">px</span>
              </div>
              <div className="imgcomp__field-inline">
                <label className="imgcomp__field-label" htmlFor="max-height">最大高度</label>
                <input
                  id="max-height"
                  type="number"
                  min={0}
                  value={maxHeight || ''}
                  placeholder="不限制"
                  onChange={(e) => setMaxHeight(Math.max(0, Number(e.target.value)))}
                  className="imgcomp__number-input"
                />
                <span className="imgcomp__field-unit">px</span>
              </div>
            </div>
          </div>

          {/* 预览与统计区 */}
          <div className="imgcomp__preview-area">
            {/* 原图预览 */}
            <div className="imgcomp__preview-card">
              <div className="imgcomp__preview-header">
                <span className="imgcomp__preview-title">原图</span>
                <span className="imgcomp__preview-meta">
                  {source.width} × {source.height} px · {source.mime.replace('image/', '').toUpperCase()} ·{' '}
                  {formatBytes(source.file.size)}
                </span>
              </div>
              <div className="imgcomp__preview-img-wrap">
                <img src={source.url} alt="原图预览" loading="lazy" />
              </div>
            </div>

            {/* 压缩结果预览 */}
            <div className="imgcomp__preview-card">
              <div className="imgcomp__preview-header">
                <span className="imgcomp__preview-title">
                  压缩后
                  {compressing && <span className="imgcomp__badge">压缩中...</span>}
                </span>
                {result && (
                  <span className="imgcomp__preview-meta">
                    {result.width} × {result.height} px · {result.mime.replace('image/', '').toUpperCase()} ·{' '}
                    {formatBytes(result.size)}
                  </span>
                )}
              </div>
              <div className="imgcomp__preview-img-wrap">
                {result ? (
                  <img src={result.url} alt="压缩后预览" loading="lazy" />
                ) : (
                  <div className="imgcomp__preview-placeholder">
                    {compressing ? '正在压缩...' : '等待压缩'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 统计与操作 */}
          {result && savings && (
            <div className="imgcomp__stats-bar">
              <div className="imgcomp__stat">
                <span className="imgcomp__stat-label">原始大小</span>
                <span className="imgcomp__stat-value">{formatBytes(source.file.size)}</span>
              </div>
              <div className="imgcomp__stat">
                <span className="imgcomp__stat-label">压缩后</span>
                <span className="imgcomp__stat-value">{formatBytes(result.size)}</span>
              </div>
              <div className="imgcomp__stat">
                <span className="imgcomp__stat-label">节省</span>
                <span
                  className={`imgcomp__stat-value${savings.ratio > 0 ? ' imgcomp__stat-value--good' : ' imgcomp__stat-value--bad'}`}
                >
                  {savings.ratio > 0 ? '-' : '+'}
                  {formatBytes(Math.abs(savings.diff))}（{Math.abs(savings.ratio).toFixed(1)}%）
                </span>
              </div>
              <button
                type="button"
                className="imgcomp__btn imgcomp__btn--primary"
                onClick={handleDownload}
              >
                下载压缩图片
              </button>
            </div>
          )}

          {notice && <div className="imgcomp__notice">{notice}</div>}

          {/* 操作按钮 */}
          <div className="imgcomp__actions">
            <button
              type="button"
              className="imgcomp__btn"
              onClick={() => fileInputRef.current?.click()}
            >
              更换图片
            </button>
            <button
              type="button"
              className="imgcomp__btn imgcomp__btn--ghost"
              onClick={handleReset}
            >
              重置
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_MIMES.join(',')}
              onChange={(e) => handleFile(e.target.files?.[0])}
              hidden
            />
          </div>
        </>
      )}
    </div>
  );
}
