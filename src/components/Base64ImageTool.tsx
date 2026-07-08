import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { copyText } from '../utils/clipboard';
import {
  formatBytes,
  parseDataUrl,
  buildDataUrl,
  sniffMimeFromBase64,
  isValidBase64,
  extFromMime,
  IMAGE_MIME_LIST,
} from '../utils/base64Image';

type Mode = 'encode' | 'decode';

/** 图片信息：贯穿两种模式的数据结构 */
interface ImageInfo {
  mime: string;
  width: number;
  height: number;
  sizeBytes: number;
  base64Length: number;
  dataUrl: string;
  base64: string;
  /** 原始文件名（encode 模式有值） */
  filename?: string;
}

/** 文件大小上限：10MB，避免浏览器内存压力 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** 复制格式预设 */
const COPY_PRESETS: { key: string; label: string; desc: string }[] = [
  { key: 'dataurl', label: 'Data URL', desc: '完整 data: URL' },
  { key: 'base64', label: '纯 Base64', desc: '不含前缀' },
  { key: 'img', label: '<img> 标签', desc: '可直接粘贴到 HTML' },
  { key: 'css', label: 'CSS 背景', desc: 'background-image' },
];

/**
 * 读取图片文件为 ImageInfo
 * 使用 FileReader.readAsDataURL 获取 Base64，Image.onload 获取尺寸
 */
function readFileToImageInfo(file: File): Promise<ImageInfo> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('请选择图片文件（PNG / JPEG / GIF / WebP / SVG 等）'));
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      reject(new Error(`文件过大（${formatBytes(file.size)}），请选择小于 10MB 的图片`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const parsed = parseDataUrl(dataUrl);
      if (!parsed) {
        reject(new Error('文件解析失败'));
        return;
      }
      const img = new Image();
      img.onload = () => {
        resolve({
          mime: parsed.mime,
          width: img.naturalWidth,
          height: img.naturalHeight,
          sizeBytes: file.size,
          base64Length: parsed.base64.length,
          dataUrl,
          base64: parsed.base64,
          filename: file.name,
        });
      };
      img.onerror = () => {
        // SVG 或损坏文件可能 onload 失败，仍返回信息（尺寸 0）
        resolve({
          mime: parsed.mime,
          width: 0,
          height: 0,
          sizeBytes: file.size,
          base64Length: parsed.base64.length,
          dataUrl,
          base64: parsed.base64,
          filename: file.name,
        });
      };
      img.src = dataUrl;
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

/**
 * 通过 Canvas 转换图片格式
 * SVG 等矢量格式不适用 Canvas，会拒绝
 */
function convertImageFormat(
  sourceDataUrl: string,
  targetMime: string,
  quality: number,
): Promise<ImageInfo> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D 上下文不可用'));
        return;
      }
      // JPEG 不支持透明，需白色背景填充
      if (targetMime === 'image/jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0);
      try {
        const dataUrl = canvas.toDataURL(targetMime, quality);
        const parsed = parseDataUrl(dataUrl);
        if (!parsed) {
          reject(new Error('格式转换失败'));
          return;
        }
        // Base64 长度约等于字节数的 4/3
        const sizeBytes = Math.floor(parsed.base64.length * 0.75);
        resolve({
          mime: parsed.mime,
          width: canvas.width,
          height: canvas.height,
          sizeBytes,
          base64Length: parsed.base64.length,
          dataUrl,
          base64: parsed.base64,
        });
      } catch (e) {
        reject(new Error(`格式转换失败：${e instanceof Error ? e.message : String(e)}`));
      }
    };
    img.onerror = () => reject(new Error('图片加载失败，无法转换（SVG 等矢量格式不支持）'));
    img.src = sourceDataUrl;
  });
}

/** 解码 Base64 / Data URL 字符串为 ImageInfo */
function decodeBase64ToImageInfo(input: string): Promise<ImageInfo> {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('请输入 Base64 或 Data URL');

  let mime: string;
  let base64: string;

  // 优先解析 Data URL
  const parsed = parseDataUrl(trimmed);
  if (parsed) {
    mime = parsed.mime;
    base64 = parsed.base64;
  } else {
    // 纯 Base64：去除空白
    const cleaned = trimmed.replace(/\s+/g, '');
    if (!isValidBase64(cleaned)) {
      throw new Error('输入不是合法的 Base64 或 Data URL');
    }
    // 嗅探 MIME
    const sniffed = sniffMimeFromBase64(cleaned);
    mime = sniffed || 'image/png';
    base64 = cleaned;
  }

  const dataUrl = buildDataUrl(mime, base64);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        mime,
        width: img.naturalWidth,
        height: img.naturalHeight,
        sizeBytes: Math.floor(base64.length * 0.75),
        base64Length: base64.length,
        dataUrl,
        base64,
      });
    };
    img.onerror = () => {
      reject(new Error('图片加载失败，Base64 可能已损坏或格式不支持'));
    };
    img.src = dataUrl;
  });
}

/** 触发下载 */
function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** 构建各种复制格式 */
function buildCopyValues(info: ImageInfo): Record<string, string> {
  return {
    dataurl: info.dataUrl,
    base64: info.base64,
    img: `<img src="${info.dataUrl}" alt="" />`,
    css: `background-image: url("${info.dataUrl}");`,
  };
}

/** 信息行配置 */
function buildInfoRows(info: ImageInfo): { label: string; value: string }[] {
  const rows = [
    { label: '图片类型', value: info.mime },
    { label: '尺寸', value: info.width > 0 ? `${info.width} × ${info.height} px` : '未知（矢量或损坏）' },
    { label: '文件大小', value: formatBytes(info.sizeBytes) },
    { label: 'Base64 长度', value: `${info.base64Length.toLocaleString()} 字符` },
  ];
  if (info.filename) rows.unshift({ label: '文件名', value: info.filename });
  return rows;
}

export default function Base64ImageTool() {
  const [mode, setMode] = useState<Mode>('encode');

  // encode 模式状态
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
  const [targetMime, setTargetMime] = useState<string>('image/webp');
  const [quality, setQuality] = useState<number>(85);
  const [converting, setConverting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // decode 模式状态
  const [input, setInput] = useState<string>('');
  const [decodedInfo, setDecodedInfo] = useState<ImageInfo | null>(null);
  const [decoding, setDecoding] = useState(false);

  // 通用状态
  const [copied, setCopied] = useState<string>('');
  const [notice, setNotice] = useState<string>('');
  const [error, setError] = useState<string>('');

  // 当前展示的图片信息（encode 用 imageInfo，decode 用 decodedInfo）
  const currentInfo = mode === 'encode' ? imageInfo : decodedInfo;
  const copyValues = useMemo(
    () => (currentInfo ? buildCopyValues(currentInfo) : null),
    [currentInfo],
  );
  const infoRows = useMemo(
    () => (currentInfo ? buildInfoRows(currentInfo) : []),
    [currentInfo],
  );

  /** 复制指定格式的值 */
  const handleCopy = useCallback(async (key: string) => {
    if (!copyValues) return;
    const text = copyValues[key];
    if (!text) return;
    const ok = await copyText(text);
    if (ok) {
      setCopied(key);
      setNotice(`已复制${COPY_PRESETS.find((p) => p.key === key)?.label || ''}到剪贴板`);
      setTimeout(() => {
        setCopied('');
        setNotice('');
      }, 1500);
    } else {
      setNotice('复制失败，请手动选中复制');
    }
  }, [copyValues]);

  /** 处理文件选择 */
  const handleFile = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    setError('');
    setNotice('');
    try {
      const info = await readFileToImageInfo(file);
      setImageInfo(info);
      setNotice('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setImageInfo(null);
    }
  }, []);

  /** 文件输入变化 */
  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    handleFile(e.target.files?.[0]);
    // 重置 input 的 value，便于重复选择同一文件
    e.target.value = '';
  }, [handleFile]);

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

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    handleFile(file);
  }, [handleFile]);

  /** 粘贴事件：仅 encode 模式监听 */
  useEffect(() => {
    if (mode !== 'encode') return;
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            handleFile(file);
            return;
          }
        }
      }
    };
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [mode, handleFile]);

  /** 格式转换 */
  const handleConvert = useCallback(async () => {
    if (!imageInfo) return;
    setConverting(true);
    setError('');
    try {
      const q = Math.max(0, Math.min(1, quality / 100));
      const newInfo = await convertImageFormat(imageInfo.dataUrl, targetMime, q);
      setImageInfo(newInfo);
      setNotice(`已转换为 ${targetMime}（${formatBytes(newInfo.sizeBytes)}）`);
      setTimeout(() => setNotice(''), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConverting(false);
    }
  }, [imageInfo, targetMime, quality]);

  /** 下载图片 */
  const handleDownload = useCallback(() => {
    if (!currentInfo) return;
    const ext = extFromMime(currentInfo.mime);
    const name = currentInfo.filename || `image-${Date.now()}`;
    // 去掉原扩展名（如果有），加上当前格式扩展名
    const baseName = name.replace(/\.[^.]+$/, '');
    downloadDataUrl(currentInfo.dataUrl, `${baseName}.${ext}`);
    setNotice('已开始下载');
    setTimeout(() => setNotice(''), 1500);
  }, [currentInfo]);

  /** 解码 Base64 */
  const handleDecode = useCallback(async () => {
    if (!input.trim()) {
      setError('请输入 Base64 或 Data URL');
      return;
    }
    setDecoding(true);
    setError('');
    try {
      const info = await decodeBase64ToImageInfo(input);
      setDecodedInfo(info);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDecodedInfo(null);
    } finally {
      setDecoding(false);
    }
  }, [input]);

  /** 清空 */
  const handleClear = useCallback(() => {
    if (mode === 'encode') {
      setImageInfo(null);
    } else {
      setInput('');
      setDecodedInfo(null);
    }
    setError('');
    setNotice('');
    setCopied('');
  }, [mode]);

  /** 切换模式 */
  const onModeChange = useCallback((m: Mode) => {
    setMode(m);
    setError('');
    setNotice('');
    setCopied('');
  }, []);

  /** 当前格式是否支持 Canvas 转换（SVG 不支持） */
  const canConvert = currentInfo && currentInfo.mime !== 'image/svg+xml';

  // 是否显示质量滑块（仅 JPEG / WebP）
  const showQuality = targetMime === 'image/jpeg' || targetMime === 'image/webp';

  return (
    <div className="b64img">
      {/* 模式切换 */}
      <div className="b64img__toolbar" role="toolbar" aria-label="Base64 图片互转操作">
        <div className="b64img__seg" role="group" aria-label="操作方向">
          <button
            className={`btn btn--sm${mode === 'encode' ? ' btn--primary' : ''}`}
            aria-pressed={mode === 'encode'}
            onClick={() => onModeChange('encode')}
          >
            图片转 Base64
          </button>
          <button
            className={`btn btn--sm${mode === 'decode' ? ' btn--primary' : ''}`}
            aria-pressed={mode === 'decode'}
            onClick={() => onModeChange('decode')}
          >
            Base64 转图片
          </button>
        </div>
        <button className="btn btn--sm" onClick={handleClear} aria-label="清空">
          清空
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="b64img__error" role="alert">
          <strong>❌ 错误</strong>
          <span>{error}</span>
        </div>
      )}

      {/* Encode 模式：图片 → Base64 */}
      {mode === 'encode' && (
        <div className="b64img__encode">
          {!imageInfo ? (
            // 拖拽上传区
            <div
              className={`b64img__dropzone${dragging ? ' b64img__dropzone--active' : ''}`}
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
              <div className="b64img__dropzone-icon" aria-hidden="true">📁</div>
              <p className="b64img__dropzone-title">
                {dragging ? '松开鼠标以上传' : '点击 / 拖拽上传图片'}
              </p>
              <p className="b64img__dropzone-hint">
                或按 <kbd>Ctrl</kbd>+<kbd>V</kbd> 粘贴剪贴板中的图片
              </p>
              <p className="b64img__dropzone-formats">
                支持 PNG / JPEG / GIF / WebP / BMP / SVG，最大 10MB
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={onFileChange}
                className="b64img__file-input"
                aria-label="选择图片文件"
              />
            </div>
          ) : (
            // 结果区
            <div className="b64img__result">
              {/* 图片预览 */}
              <div className="b64img__preview">
                <img
                  src={imageInfo.dataUrl}
                  alt="预览图片"
                  className="b64img__preview-img"
                />
              </div>

              {/* 信息表格 */}
              <ul className="b64img__info" role="list">
                {infoRows.map((row) => (
                  <li key={row.label} className="b64img__info-row">
                    <span className="b64img__info-label">{row.label}</span>
                    <code className="b64img__info-value">{row.value}</code>
                  </li>
                ))}
              </ul>

              {/* 格式转换区 */}
              {canConvert && (
                <div className="b64img__convert">
                  <h3 className="b64img__section-title">格式转换</h3>
                  <div className="b64img__convert-bar">
                    <label className="b64img__field">
                      <span>目标格式</span>
                      <select
                        value={targetMime}
                        onChange={(e) => setTargetMime(e.target.value)}
                        aria-label="目标格式"
                      >
                        {IMAGE_MIME_LIST.map((m) => (
                          <option key={m.mime} value={m.mime}>{m.label}</option>
                        ))}
                      </select>
                    </label>
                    {showQuality && (
                      <label className="b64img__field">
                        <span>质量：{quality}%</span>
                        <input
                          type="range"
                          min="10"
                          max="100"
                          value={quality}
                          onChange={(e) => setQuality(Number(e.target.value))}
                          aria-label="质量"
                        />
                      </label>
                    )}
                    <button
                      className="btn btn--primary btn--sm"
                      onClick={handleConvert}
                      disabled={converting}
                      aria-label="执行格式转换"
                    >
                      {converting ? '转换中...' : '转换'}
                    </button>
                  </div>
                </div>
              )}

              {/* 复制操作区 */}
              <div className="b64img__actions">
                <h3 className="b64img__section-title">复制为</h3>
                <div className="b64img__copy-grid">
                  {COPY_PRESETS.map((p) => (
                    <button
                      key={p.key}
                      className="btn btn--sm b64img__copy-btn"
                      onClick={() => handleCopy(p.key)}
                      aria-label={`复制${p.label}（${p.desc}）`}
                    >
                      <span className="b64img__copy-label">{p.label}</span>
                      <span className="b64img__copy-desc">{p.desc}</span>
                      {copied === p.key && <span className="b64img__copied">✓ 已复制</span>}
                    </button>
                  ))}
                </div>
              </div>

              {/* 下载按钮 */}
              <button
                className="btn btn--primary"
                onClick={handleDownload}
                aria-label="下载图片"
              >
                ⬇ 下载图片
              </button>

              {/* 重新上传 */}
              <button
                className="btn btn--sm"
                onClick={() => fileInputRef.current?.click()}
                aria-label="重新选择图片"
              >
                重新上传
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={onFileChange}
                className="b64img__file-input"
                aria-label="选择图片文件"
              />
            </div>
          )}
        </div>
      )}

      {/* Decode 模式：Base64 → 图片 */}
      {mode === 'decode' && (
        <div className="b64img__decode">
          <div className="b64img__input-area">
            <label htmlFor="b64img-input" className="b64img__label">
              Base64 字符串或 Data URL
            </label>
            <textarea
              id="b64img-input"
              className="b64img__textarea"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (error) setError('');
              }}
              placeholder="在此粘贴 data:image/png;base64,... 或纯 Base64 字符串"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              aria-label="Base64 字符串或 Data URL 输入框"
            />
            <div className="b64img__decode-actions">
              <button
                className="btn btn--primary btn--sm"
                onClick={handleDecode}
                disabled={decoding || !input.trim()}
                aria-label="解码并预览"
              >
                {decoding ? '解码中...' : '解码并预览'}
              </button>
              <span className="b64img__input-stat">
                {input.length.toLocaleString()} 字符
              </span>
            </div>
          </div>

          {decodedInfo && (
            <div className="b64img__result">
              <div className="b64img__preview">
                <img
                  src={decodedInfo.dataUrl}
                  alt="解码后的图片"
                  className="b64img__preview-img"
                />
              </div>
              <ul className="b64img__info" role="list">
                {infoRows.map((row) => (
                  <li key={row.label} className="b64img__info-row">
                    <span className="b64img__info-label">{row.label}</span>
                    <code className="b64img__info-value">{row.value}</code>
                  </li>
                ))}
              </ul>
              <div className="b64img__actions">
                <h3 className="b64img__section-title">复制为</h3>
                <div className="b64img__copy-grid">
                  {COPY_PRESETS.map((p) => (
                    <button
                      key={p.key}
                      className="btn btn--sm b64img__copy-btn"
                      onClick={() => handleCopy(p.key)}
                      aria-label={`复制${p.label}`}
                    >
                      <span className="b64img__copy-label">{p.label}</span>
                      <span className="b64img__copy-desc">{p.desc}</span>
                      {copied === p.key && <span className="b64img__copied">✓ 已复制</span>}
                    </button>
                  ))}
                </div>
              </div>
              <button
                className="btn btn--primary"
                onClick={handleDownload}
                aria-label="下载图片"
              >
                ⬇ 下载图片
              </button>
            </div>
          )}
        </div>
      )}

      {/* 状态条 */}
      <div className="b64img__status" role="status" aria-live="polite">
        {notice ? (
          <div className="b64img__notice">{notice}</div>
        ) : (
          <div className="b64img__hint">
            所有数据仅在你浏览器内处理，不会上传到任何服务器。支持拖拽上传、剪贴板粘贴与格式转换。
          </div>
        )}
      </div>
    </div>
  );
}
