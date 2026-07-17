/**
 * 图片缩放工具核心模块
 *
 * 全部在浏览器本地用 Canvas API 处理，不发起任何网络请求。
 *
 * 核心能力：
 *  - 5 种缩放模式：按宽度 / 按高度 / 按宽高 / 按百分比 / 按预设尺寸
 *  - 8 种预设尺寸：缩略图 256 / SD 480p / HD 720p / FHD 1080p / 2K 1440p / 4K 2160p / 原图 50% / 原图 200%
 *  - 等比锁定：宽高联动保持原始比例
 *  - 放大控制：可选允许或禁止放大（默认仅缩小）
 *  - 批量缩放：统一应用同一规格，ZIP 打包下载
 *  - 多格式导出：PNG / JPEG / WebP / AVIF（受浏览器编码能力限制）
 *
 * 与 image-compress / image-convert / image-crop 工具的差异：
 *  - image-compress 专注质量压缩 + 三格式横向对比，缩放仅作为附加项
 *  - image-convert 专注格式互转，缩放仅作为附加项
 *  - image-crop 专注几何裁剪（取局部），不做整体缩放
 *  - 本工具专注整体几何缩放（整图按目标尺寸变换），不做裁剪不做格式对比
 */

// 复用 imageConvert 的共享类型与工具函数，保持图像处理类工具一致性
import {
  type OutputMime,
  type OutputFormatMeta,
  type SourceImage,
  OUTPUT_FORMATS,
  ACCEPTED_INPUT_MIMES,
  MAX_FILE_SIZE,
  MAX_BATCH_COUNT,
  loadImage,
  detectAllEncodeSupport,
  detectEncodeSupport,
  formatBytes,
  extFromMime,
  downloadBlob,
} from './imageConvert';

// 复用 imageCrop 的 ZIP 打包能力（STORE 模式，纯前端二进制构造）
import { type ZipEntry, createZipFile } from './imageCrop';

// 重新导出供组件直接从本模块导入
export type { OutputMime, OutputFormatMeta, SourceImage, ZipEntry };
export {
  OUTPUT_FORMATS,
  ACCEPTED_INPUT_MIMES,
  MAX_FILE_SIZE,
  MAX_BATCH_COUNT,
  loadImage,
  detectAllEncodeSupport,
  detectEncodeSupport,
  formatBytes,
  extFromMime,
  downloadBlob,
  createZipFile,
};

/** 缩放模式代码 */
export type ResizeMode =
  | 'width' // 仅指定目标宽度，高度等比缩放
  | 'height' // 仅指定目标高度，宽度等比缩放
  | 'both' // 同时指定宽高，可选择是否锁定等比
  | 'percent' // 按原图百分比缩放（50 = 一半，200 = 两倍）
  | 'preset'; // 按预设尺寸（缩略图 / HD / 4K 等）

/** 预设尺寸代码 */
export type ResizePresetCode =
  | 'thumbnail' // 256px（长边）
  | 'sd' // 480p（长边 854，按 16:9 标定）
  | 'hd' // 720p（长边 1280）
  | 'fhd' // 1080p（长边 1920）
  | '2k' // 1440p（长边 2560）
  | '4k' // 2160p（长边 3840）
  | 'half' // 原图 50%
  | 'double'; // 原图 200%

/** 预设尺寸元数据 */
export interface ResizePresetMeta {
  code: ResizePresetCode;
  label: string;
  /** 长边目标像素值，null 表示按百分比 */
  longSide: number | null;
  /** 百分比（0-200），null 表示按长边 */
  percent: number | null;
  desc: string;
}

/** 预设尺寸清单（顺序即 UI 渲染顺序） */
export const RESIZE_PRESETS: ResizePresetMeta[] = [
  { code: 'thumbnail', label: '缩略图 256', longSide: 256, percent: null, desc: '长边 256px，列表/相册缩略图' },
  { code: 'sd', label: 'SD 480p', longSide: 854, percent: null, desc: '长边 854px，标清视频封面' },
  { code: 'hd', label: 'HD 720p', longSide: 1280, percent: null, desc: '长边 1280px，高清视频/网页配图' },
  { code: 'fhd', label: 'FHD 1080p', longSide: 1920, percent: null, desc: '长边 1920px，全高清/壁纸' },
  { code: '2k', label: '2K 1440p', longSide: 2560, percent: null, desc: '长边 2560px，2K 显示器壁纸' },
  { code: '4k', label: '4K 2160p', longSide: 3840, percent: null, desc: '长边 3840px，4K 壁纸/印刷' },
  { code: 'half', label: '原图 50%', longSide: null, percent: 50, desc: '宽高各缩到一半，面积 1/4' },
  { code: 'double', label: '原图 200%', longSide: null, percent: 200, desc: '宽高各放大一倍，面积 4 倍' },
];

/** 缩放配置 */
export interface ResizeOptions {
  /** 缩放模式 */
  mode: ResizeMode;
  /** 目标宽度（mode=width/both 时生效，0 表示不限） */
  targetWidth: number;
  /** 目标高度（mode=height/both 时生效，0 表示不限） */
  targetHeight: number;
  /** 百分比 1-500（mode=percent 时生效） */
  percent: number;
  /** 预设代码（mode=preset 时生效） */
  presetCode: ResizePresetCode;
  /** mode=both 时是否锁定等比（true: 等比缩放并裁掉溢出；false: 自由拉伸） */
  lockAspect: boolean;
  /** 是否允许放大（false 时仅缩小，目标大于原图则保持原尺寸） */
  allowEnlarge: boolean;
  /** 输出格式 */
  format: OutputMime;
  /** 质量 1-100，仅对有损格式生效 */
  quality: number;
  /** 目标格式不支持透明时的背景色（CSS 颜色字符串） */
  background: string;
}

/** 默认缩放配置 */
export const DEFAULT_RESIZE_OPTIONS: ResizeOptions = {
  mode: 'width',
  targetWidth: 1280,
  targetHeight: 720,
  percent: 50,
  presetCode: 'hd',
  lockAspect: true,
  allowEnlarge: false,
  format: 'image/webp',
  quality: 90,
  background: '#ffffff',
};

/** 单次缩放结果 */
export interface ResizeResult {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  size: number;
  mime: OutputMime;
  /** 缩放耗时（毫秒） */
  elapsedMs: number;
  /** 原图宽度 */
  originalWidth: number;
  /** 原图高度 */
  originalHeight: number;
}

/** 批量缩放单项结果 */
export interface BatchResizeItem {
  /** 原始文件名 */
  name: string;
  /** 原图尺寸（加载失败时为 0） */
  sourceWidth: number;
  sourceHeight: number;
  /** 缩放结果（失败时为 null） */
  result: ResizeResult | null;
  /** 错误信息（成功时为 null） */
  error: string | null;
}

/** 最小输出尺寸，避免 0 或 1 像素导致 toBlob 失败 */
export const MIN_OUTPUT_SIZE = 1;
/** 最大输出尺寸，避免浏览器 Canvas 内存溢出（16384 是 Chrome/Safari 通用上限） */
export const MAX_OUTPUT_SIZE = 16384;

/**
 * 根据缩放模式计算目标宽高
 * - 返回的尺寸已应用 allowEnlarge 限制与 MIN/MAX 边界
 * - mode=both + lockAspect=true 时：按主导方向等比缩放，不会拉伸
 * - mode=both + lockAspect=false 时：自由拉伸，可能变形
 */
export function computeResizeTarget(
  srcW: number,
  srcH: number,
  options: ResizeOptions,
): { width: number; height: number } {
  let width = srcW;
  let height = srcH;

  switch (options.mode) {
    case 'width': {
      // 仅按宽度缩放，高度等比
      const targetW = options.targetWidth > 0 ? options.targetWidth : srcW;
      width = targetW;
      height = Math.round((srcH * targetW) / srcW);
      break;
    }
    case 'height': {
      // 仅按高度缩放，宽度等比
      const targetH = options.targetHeight > 0 ? options.targetHeight : srcH;
      height = targetH;
      width = Math.round((srcW * targetH) / srcH);
      break;
    }
    case 'both': {
      if (options.lockAspect) {
        // 等比缩放：取主导方向（变化比例较大者）作为基准
        const targetW = options.targetWidth > 0 ? options.targetWidth : srcW;
        const targetH = options.targetHeight > 0 ? options.targetHeight : srcH;
        const ratioW = targetW / srcW;
        const ratioH = targetH / srcH;
        const ratio = Math.min(ratioW, ratioH);
        width = Math.round(srcW * ratio);
        height = Math.round(srcH * ratio);
      } else {
        // 自由拉伸：直接使用目标值
        width = options.targetWidth > 0 ? options.targetWidth : srcW;
        height = options.targetHeight > 0 ? options.targetHeight : srcH;
      }
      break;
    }
    case 'percent': {
      const p = options.percent / 100;
      width = Math.round(srcW * p);
      height = Math.round(srcH * p);
      break;
    }
    case 'preset': {
      const preset = RESIZE_PRESETS.find((p) => p.code === options.presetCode);
      if (!preset) break;
      if (preset.longSide !== null) {
        // 按长边等比缩放：找出原图长边，按目标长边计算缩放比
        const srcLong = Math.max(srcW, srcH);
        if (srcLong === 0) break;
        const ratio = preset.longSide / srcLong;
        width = Math.round(srcW * ratio);
        height = Math.round(srcH * ratio);
      } else if (preset.percent !== null) {
        const p = preset.percent / 100;
        width = Math.round(srcW * p);
        height = Math.round(srcH * p);
      }
      break;
    }
  }

  // 应用放大限制：不允许放大时，目标大于原图则保留原尺寸
  if (!options.allowEnlarge) {
    if (width > srcW) {
      width = srcW;
      height = srcH;
    }
    if (height > srcH) {
      width = srcW;
      height = srcH;
    }
  }

  // 边界保护：最小 1px，最大 16384px
  width = Math.max(MIN_OUTPUT_SIZE, Math.min(MAX_OUTPUT_SIZE, width));
  height = Math.max(MIN_OUTPUT_SIZE, Math.min(MAX_OUTPUT_SIZE, height));

  return { width, height };
}

/**
 * 执行缩放：使用 Canvas drawImage 整图重采样
 * - 使用 imageSmoothingQuality='high' 启用浏览器最高质量重采样（通常为双三次）
 * - 不支持透明的格式（JPEG）会先填充背景色，避免透明区域变黑
 * - PNG 无损：quality 参数不生效
 */
export function resizeImage(source: SourceImage, options: ResizeOptions): Promise<ResizeResult> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const img = new Image();
    img.onload = () => {
      try {
        const target = computeResizeTarget(source.width, source.height, options);

        // 校验目标尺寸
        if (target.width <= 0 || target.height <= 0) {
          reject(new Error('目标尺寸无效，宽高必须大于 0'));
          return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = target.width;
        canvas.height = target.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D 上下文不可用，请更换浏览器'));
          return;
        }

        // 启用高质量重采样（缩小场景尤其重要，避免锯齿）
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // 目标格式不支持透明时填充背景色，避免透明区域变黑（针对 JPEG）
        const targetMeta = OUTPUT_FORMATS.find((f) => f.mime === options.format);
        if (targetMeta && !targetMeta.alpha) {
          ctx.fillStyle = options.background;
          ctx.fillRect(0, 0, target.width, target.height);
        }

        // 关键：drawImage 整图缩放，源矩形 = 整张原图，目标矩形 = 目标尺寸
        ctx.drawImage(img, 0, 0, source.width, source.height, 0, 0, target.width, target.height);

        const qualityParam = targetMeta?.lossy ? options.quality / 100 : undefined;
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('缩放失败，目标格式可能不被当前浏览器支持编码'));
              return;
            }
            const url = URL.createObjectURL(blob);
            resolve({
              blob,
              url,
              width: target.width,
              height: target.height,
              size: blob.size,
              mime: options.format,
              elapsedMs: Math.round(performance.now() - start),
              originalWidth: source.width,
              originalHeight: source.height,
            });
          },
          options.format,
          qualityParam,
        );
      } catch (e) {
        reject(new Error(`缩放失败：${e instanceof Error ? e.message : String(e)}`));
      }
    };
    img.onerror = () => reject(new Error('图片加载失败，无法缩放'));
    img.src = source.url;
  });
}

/**
 * 由原文件名生成缩放后文件名
 * - 追加 -{W}x{H} 后缀（如 photo-1280x720.webp），便于一眼识别目标尺寸
 * - 替换为输出格式对应扩展名
 */
export function buildResizeFilename(originalName: string, mime: OutputMime, width: number, height: number): string {
  const dotIdx = originalName.lastIndexOf('.');
  const base = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
  return `${base}-${width}x${height}.${extFromMime(mime)}`;
}

/**
 * 批量缩放：对多张图片按统一规格顺序处理
 * - 顺序执行避免内存堆积，每张处理完立即回调进度
 * - 单张失败不影响其他图片，错误记录在 item.error
 * - 调用方负责在卸载时 revokeObjectURL 所有 result.url
 */
export async function resizeBatch(
  files: File[],
  options: ResizeOptions,
  onProgress?: (index: number, total: number, item: BatchResizeItem) => void,
): Promise<BatchResizeItem[]> {
  const results: BatchResizeItem[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    let item: BatchResizeItem;
    try {
      const source = await loadImage(file);
      const result = await resizeImage(source, options);
      item = {
        name: file.name,
        sourceWidth: source.width,
        sourceHeight: source.height,
        result,
        error: null,
      };
      // 加载后立即释放 source.url（result.url 是独立的，不受影响）
      URL.revokeObjectURL(source.url);
    } catch (e) {
      item = {
        name: file.name,
        sourceWidth: 0,
        sourceHeight: 0,
        result: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    results.push(item);
    onProgress?.(i, files.length, item);
  }
  return results;
}

/**
 * 批量下载：逐个触发下载，间隔 200ms 避免浏览器拦截
 * - 浏览器对连续多文件下载有限制（Chrome 5+ 弹授权，Firefox 默认阻止，Safari 仅触发首个）
 * - 200ms 间隔是经验值，兼顾速度与稳定性
 */
export async function downloadBatch(
  items: BatchResizeItem[],
  onProgress?: (index: number, total: number) => void,
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.result) {
      const filename = buildResizeFilename(item.name, item.result.mime, item.result.width, item.result.height);
      downloadBlob(item.result.url, filename);
      onProgress?.(i + 1, items.length);
      if (i < items.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }
}

/**
 * 批量打包为 ZIP 下载（复用 imageCrop 的 createZipFile）
 * - 仅打包成功缩放的项，跳过失败项
 * - 文件名使用 buildResizeFilename 生成（追加 -{W}x{H} 后缀 + 替换扩展名）
 * - ZIP 文件名带时间戳，避免同名覆盖
 */
export async function downloadBatchAsZip(
  items: BatchResizeItem[],
  zipName = 'resized-images.zip',
): Promise<void> {
  const entries: ZipEntry[] = [];
  for (const item of items) {
    if (item.result) {
      entries.push({
        name: buildResizeFilename(item.name, item.result.mime, item.result.width, item.result.height),
        blob: item.result.blob,
      });
    }
  }
  if (entries.length === 0) return;
  await createZipFile(entries, zipName);
}

/** 计算节省/增加比例：负数表示缩放后体积更大 */
export function computeSizeDelta(originalSize: number, resizedSize: number): { diff: number; ratio: number } {
  const diff = originalSize - resizedSize;
  const ratio = originalSize > 0 ? (diff / originalSize) * 100 : 0;
  return { diff, ratio };
}
