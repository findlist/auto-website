/**
 * 图像格式互转工具核心模块
 *
 * 全部在浏览器本地用 Canvas API + createImageBitmap 处理，不发起任何网络请求。
 *
 * 核心能力：
 *  - 浏览器格式支持探测（编码 / 解码分别检测，AVIF 编码支持差异最大）
 *  - 批量转换：一次处理多张图片到同一目标格式
 *  - 全格式对比：一键生成所有可编码格式的结果，便于体积横向比较
 *  - 透明通道处理：JPEG 等不支持透明的格式由用户选择背景色填充
 *  - 等比缩放：按最大宽高限制缩放，不放大
 *
 * 与 image-compress 工具的差异：
 *  - image-compress 单文件 + WebP/JPEG/PNG 三格式 + 质量滑块；
 *  - 本工具多文件 + AVIF + 全格式对比 + 背景色可调 + 缩放可调
 */

/** 支持的输出格式 MIME 类型 */
export type OutputMime = 'image/avif' | 'image/webp' | 'image/jpeg' | 'image/png';

/** 输出格式元数据 */
export interface OutputFormatMeta {
  mime: OutputMime;
  label: string;
  ext: string;
  desc: string;
  /** 是否有损（决定质量参数是否生效） */
  lossy: boolean;
  /** 是否支持透明通道 */
  alpha: boolean;
}

/** 输出格式元数据清单（顺序即 UI 渲染顺序） */
export const OUTPUT_FORMATS: OutputFormatMeta[] = [
  { mime: 'image/avif', label: 'AVIF', ext: 'avif', desc: '体积最小，现代浏览器支持', lossy: true, alpha: true },
  { mime: 'image/webp', label: 'WebP', ext: 'webp', desc: '体积次小，全浏览器支持', lossy: true, alpha: true },
  { mime: 'image/jpeg', label: 'JPEG', ext: 'jpg', desc: '兼容性最好，不支持透明', lossy: true, alpha: false },
  { mime: 'image/png', label: 'PNG', ext: 'png', desc: '无损压缩，体积较大', lossy: false, alpha: true },
];

/** 输入文件大小上限：20MB，避免浏览器内存压力 */
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

/** 单次批量处理上限：20 张，避免内存堆积 */
export const MAX_BATCH_COUNT = 20;

/** 常见输入 MIME 白名单（包含 BMP / ICO 部分浏览器可解码） */
export const ACCEPTED_INPUT_MIMES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/bmp',
];

/** 加载图片源信息 */
export interface SourceImage {
  file: File;
  url: string;
  width: number;
  height: number;
  mime: string;
}

/** 单次转换结果 */
export interface ConvertResult {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  size: number;
  mime: OutputMime;
  /** 转换耗时（毫秒），便于性能比较 */
  elapsedMs: number;
}

/** 转换配置 */
export interface ConvertOptions {
  format: OutputMime;
  /** 质量 1-100，仅对有损格式生效 */
  quality: number;
  /** 最大宽度，0 表示不限制 */
  maxWidth: number;
  /** 最大高度，0 表示不限制 */
  maxHeight: number;
  /** 当目标格式不支持透明时的背景色（CSS 颜色字符串） */
  background: string;
}

/** 默认转换配置 */
export const DEFAULT_OPTIONS: ConvertOptions = {
  format: 'image/webp',
  quality: 82,
  maxWidth: 0,
  maxHeight: 0,
  background: '#ffffff',
};

/**
 * 格式支持检测缓存
 * 浏览器对不同格式的编码支持差异较大，特别是 AVIF：
 *  - Chrome 85+ 支持 WebP 编码
 *  - Chrome 85+ / Firefox 86+ / Safari 16+ 支持 AVIF 解码
 *  - Chrome 93+ 支持 AVIF 编码（toBlob）
 *  - Safari 16+ 支持 AVIF 编码（较新版本）
 */
const encodeSupportCache = new Map<OutputMime, boolean>();

/**
 * 检测浏览器是否支持某格式的编码（toBlob）
 * 使用一个 1x1 像素 Canvas 同步探测，结果缓存避免重复检测
 */
export function detectEncodeSupport(mime: OutputMime): boolean {
  const cached = encodeSupportCache.get(mime);
  if (cached !== undefined) return cached;
  let supported = false;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // 同步调用 toBlob 不可行，这里使用 toDataURL 作为快速同步探测
      // toDataURL 对不支持的格式会返回 image/png 作为兜底
      const dataUrl = canvas.toDataURL(mime);
      supported = dataUrl.startsWith(`data:${mime}`);
    }
  } catch {
    supported = false;
  }
  encodeSupportCache.set(mime, supported);
  return supported;
}

/**
 * 异步精确检测编码支持（使用 toBlob，更准确）
 * 首次加载组件时调用，覆盖 toDataURL 检测的边缘情况
 */
export function detectEncodeSupportAsync(mime: OutputMime): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(false);
        return;
      }
      canvas.toBlob(
        (blob) => {
          const ok = !!blob && blob.type === mime;
          encodeSupportCache.set(mime, ok);
          resolve(ok);
        },
        mime,
        0.8,
      );
    } catch {
      resolve(false);
    }
  });
}

/** 探测所有输出格式的编码支持，返回 MIME → boolean 映射 */
export async function detectAllEncodeSupport(): Promise<Record<OutputMime, boolean>> {
  const entries = await Promise.all(
    OUTPUT_FORMATS.map(async (f) => [f.mime, await detectEncodeSupportAsync(f.mime)] as const),
  );
  return Object.fromEntries(entries) as Record<OutputMime, boolean>;
}

/** 字节数格式化为人类可读字符串 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** 由 MIME 推断文件扩展名 */
export function extFromMime(mime: string): string {
  const found = OUTPUT_FORMATS.find((f) => f.mime === mime);
  if (found) return found.ext;
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/bmp') return 'bmp';
  return 'bin';
}

/** 由原文件名生成转换后文件名（替换扩展名） */
export function buildOutputFilename(originalName: string, mime: OutputMime): string {
  const dotIdx = originalName.lastIndexOf('.');
  const base = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
  return `${base}.${extFromMime(mime)}`;
}

/** 计算等比缩放后的目标尺寸，不放大 */
export function computeTargetSize(
  srcW: number,
  srcH: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  let width = srcW;
  let height = srcH;
  if (maxWidth > 0 && width > maxWidth) {
    height = Math.round((height * maxWidth) / width);
    width = maxWidth;
  }
  if (maxHeight > 0 && height > maxHeight) {
    width = Math.round((width * maxHeight) / height);
    height = maxHeight;
  }
  return { width, height };
}

/**
 * 加载图片文件为 SourceImage
 * 优先使用 createImageBitmap（性能更好，支持更多格式），失败回退到 HTMLImageElement
 */
export function loadImage(file: File): Promise<SourceImage> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('请选择图片文件（PNG / JPEG / WebP / AVIF / GIF / BMP）'));
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      reject(new Error(`文件过大（${formatBytes(file.size)}），请选择小于 20MB 的图片`));
      return;
    }
    const url = URL.createObjectURL(file);

    // 优先 createImageBitmap：性能更优，部分浏览器支持 AVIF 解码
    if (typeof createImageBitmap === 'function') {
      createImageBitmap(file)
        .then((bitmap) => {
          resolve({
            file,
            url,
            width: bitmap.width,
            height: bitmap.height,
            mime: file.type,
          });
          bitmap.close();
        })
        .catch(() => {
          // 回退到 HTMLImageElement
          fallbackHtmlImage(file, url, resolve, reject);
        });
    } else {
      fallbackHtmlImage(file, url, resolve, reject);
    }
  });
}

/** HTMLImageElement 兜底加载 */
function fallbackHtmlImage(
  file: File,
  url: string,
  resolve: (img: SourceImage) => void,
  reject: (e: Error) => void,
) {
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
    reject(new Error('图片加载失败，文件可能已损坏或当前浏览器不支持此格式解码'));
  };
  img.src = url;
}

/**
 * 将图片源转换为指定格式
 * - 使用 OffscreenCanvas 优先（性能更优），失败回退到 HTMLCanvasElement
 * - 不支持透明的格式（JPEG）会先用 background 颜色填充背景
 * - PNG 无损：quality 参数不生效
 */
export function convertImage(
  source: SourceImage,
  options: ConvertOptions,
): Promise<ConvertResult> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const img = new Image();
    img.onload = () => {
      try {
        const { width, height } = computeTargetSize(
          source.width,
          source.height,
          options.maxWidth,
          options.maxHeight,
        );

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D 上下文不可用，请更换浏览器'));
          return;
        }

        // 目标格式不支持透明时填充背景色，避免透明区域变黑
        const targetMeta = OUTPUT_FORMATS.find((f) => f.mime === options.format);
        if (targetMeta && !targetMeta.alpha) {
          ctx.fillStyle = options.background;
          ctx.fillRect(0, 0, width, height);
        }

        ctx.drawImage(img, 0, 0, width, height);

        const qualityParam = targetMeta?.lossy ? options.quality / 100 : undefined;
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('转换失败，目标格式可能不被当前浏览器支持编码'));
              return;
            }
            const url = URL.createObjectURL(blob);
            resolve({
              blob,
              url,
              width,
              height,
              size: blob.size,
              mime: options.format,
              elapsedMs: Math.round(performance.now() - start),
            });
          },
          options.format,
          qualityParam,
        );
      } catch (e) {
        reject(new Error(`转换失败：${e instanceof Error ? e.message : String(e)}`));
      }
    };
    img.onerror = () => reject(new Error('图片加载失败，无法转换'));
    img.src = source.url;
  });
}

/**
 * 将图片源转换为所有可编码格式（用于"全格式对比"模式）
 * 仅生成浏览器实际支持编码的格式
 */
export async function convertToAllFormats(
  source: SourceImage,
  encodeSupport: Record<OutputMime, boolean>,
  options: Omit<ConvertOptions, 'format'>,
): Promise<ConvertResult[]> {
  const results: ConvertResult[] = [];
  for (const fmt of OUTPUT_FORMATS) {
    if (!encodeSupport[fmt.mime]) continue;
    try {
      const result = await convertImage(source, { ...options, format: fmt.mime });
      results.push(result);
    } catch {
      // 单格式失败不影响其他格式
    }
  }
  return results;
}

/** 触发文件下载 */
export function downloadBlob(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * 将多个结果打包下载（逐个触发下载，浏览器原生不支持 ZIP 而不引入依赖）
 * 间隔 200ms 避免浏览器拦截多文件下载
 */
export async function downloadResults(
  items: { url: string; filename: string }[],
  onProgress?: (done: number, total: number) => void,
) {
  for (let i = 0; i < items.length; i++) {
    downloadBlob(items[i].url, items[i].filename);
    onProgress?.(i + 1, items.length);
    if (i < items.length - 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

/** 节省比例计算：负数表示转换后体积更大 */
export function computeSavings(originalSize: number, convertedSize: number): { diff: number; ratio: number } {
  const diff = originalSize - convertedSize;
  const ratio = originalSize > 0 ? (diff / originalSize) * 100 : 0;
  return { diff, ratio };
}
