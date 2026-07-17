/**
 * 图片裁剪工具核心模块
 *
 * 全部在浏览器本地用 Canvas API + drawImage 源矩形参数处理，不发起任何网络请求。
 *
 * 核心能力：
 *  - 多种裁剪比例：自由 / 1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 3:2 / 2:3 / 自定义
 *  - 可视化裁剪框：8 个手柄（4 角 + 4 边）调整大小，整体可拖动
 *  - 数值精确输入：x / y / 宽 / 高 直接键入，支持快捷居中、重置、全图
 *  - 等比缩放输出：可限制最大宽高，避免放大像素
 *  - 多格式导出：PNG / JPEG / WebP / AVIF（受浏览器编码能力限制）
 *
 * 与 image-convert 工具的差异：
 *  - image-convert 专注格式互转与体积对比，不做几何变换
 *  - 本工具专注几何裁剪，导出格式仅作为输出选项
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

// 重新导出供组件直接从本模块导入
export type { OutputMime, OutputFormatMeta, SourceImage };
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
};

/** 裁剪比例代码 */
export type AspectRatioCode =
  | 'free' // 自由比例
  | '1:1'
  | '4:3'
  | '3:4'
  | '16:9'
  | '9:16'
  | '3:2'
  | '2:3'
  | 'custom'; // 自定义比例（由 customRatioW/H 决定）

/** 裁剪比例元数据 */
export interface AspectRatioMeta {
  code: AspectRatioCode;
  label: string;
  /** 比例值（宽/高），null 表示自由比例 */
  ratio: number | null;
  desc: string;
}

/** 裁剪比例清单（顺序即 UI 渲染顺序） */
export const ASPECT_RATIOS: AspectRatioMeta[] = [
  { code: 'free', label: '自由', ratio: null, desc: '不锁定比例，任意宽高' },
  { code: '1:1', label: '1:1', ratio: 1, desc: '正方形，头像 / 头图常用' },
  { code: '4:3', label: '4:3', ratio: 4 / 3, desc: '传统屏幕 / PPT 投影' },
  { code: '3:4', label: '3:4', ratio: 3 / 4, desc: '竖版海报 / 竖屏照片' },
  { code: '16:9', label: '16:9', ratio: 16 / 9, desc: '宽屏 / 视频封面 / YouTube 缩略图' },
  { code: '9:16', label: '9:16', ratio: 9 / 16, desc: '手机竖屏 / Stories / Reels' },
  { code: '3:2', label: '3:2', ratio: 3 / 2, desc: '单反相机默认比例' },
  { code: '2:3', label: '2:3', ratio: 2 / 3, desc: '竖版照片 / 海报' },
  { code: 'custom', label: '自定义', ratio: null, desc: '由用户输入宽高比' },
];

/** 裁剪矩形（原图坐标系） */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 调整手柄位置 */
export type HandleCode = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** 手柄元数据清单 */
export const HANDLES: { code: HandleCode; cursor: string; label: string }[] = [
  { code: 'nw', cursor: 'nwse-resize', label: '左上' },
  { code: 'n', cursor: 'ns-resize', label: '上' },
  { code: 'ne', cursor: 'nesw-resize', label: '右上' },
  { code: 'e', cursor: 'ew-resize', label: '右' },
  { code: 'se', cursor: 'nwse-resize', label: '右下' },
  { code: 's', cursor: 'ns-resize', label: '下' },
  { code: 'sw', cursor: 'nesw-resize', label: '左下' },
  { code: 'w', cursor: 'ew-resize', label: '左' },
];

/** 裁剪输出结果 */
export interface CropResult {
  blob: Blob;
  url: string;
  /** 输出图像宽度（可能被等比缩放） */
  width: number;
  /** 输出图像高度 */
  height: number;
  size: number;
  mime: OutputMime;
  /** 处理耗时（毫秒） */
  elapsedMs: number;
}

/** 裁剪与导出配置 */
export interface CropOptions {
  rect: CropRect;
  /** 输出格式 */
  format: OutputMime;
  /** 质量 1-100，仅对有损格式生效 */
  quality: number;
  /** 最大宽度，0 表示不限制 */
  maxWidth: number;
  /** 最大高度，0 表示不限制 */
  maxHeight: number;
  /** JPEG 等不支持透明格式的背景色 */
  background: string;
}

/** 默认裁剪配置 */
export const DEFAULT_CROP_OPTIONS: Omit<CropOptions, 'rect'> = {
  format: 'image/png',
  quality: 92,
  maxWidth: 0,
  maxHeight: 0,
  background: '#ffffff',
};

/** 最小裁剪尺寸（避免过小导致难以操作与编码失败） */
export const MIN_CROP_SIZE = 8;

/**
 * 计算给定比例下的初始居中裁剪矩形
 * - 自由比例：默认取原图 80% 区域居中
 * - 固定比例：在原图内最大化居中（取 90% 避免贴边）
 */
export function computeInitialRect(srcW: number, srcH: number, ratio: number | null): CropRect {
  if (!ratio) {
    // 自由比例：80% 居中
    const w = Math.round(srcW * 0.8);
    const h = Math.round(srcH * 0.8);
    return {
      x: Math.round((srcW - w) / 2),
      y: Math.round((srcH - h) / 2),
      width: w,
      height: h,
    };
  }
  // 固定比例：在原图内最大化
  let w = srcW;
  let h = Math.round(srcW / ratio);
  if (h > srcH) {
    h = srcH;
    w = Math.round(srcH * ratio);
  }
  // 取 90% 避免贴边
  w = Math.round(w * 0.9);
  h = Math.round(w / ratio);
  return {
    x: Math.round((srcW - w) / 2),
    y: Math.round((srcH - h) / 2),
    width: w,
    height: h,
  };
}

/** 将矩形限制在原图范围内，并保证最小尺寸 */
export function clampRect(rect: CropRect, srcW: number, srcH: number): CropRect {
  let { x, y, width, height } = rect;
  width = Math.max(MIN_CROP_SIZE, width);
  height = Math.max(MIN_CROP_SIZE, height);
  if (width > srcW) width = srcW;
  if (height > srcH) height = srcH;
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x + width > srcW) x = srcW - width;
  if (y + height > srcH) y = srcH - height;
  return { x, y, width, height };
}

/**
 * 应用比例锁定：以中心为锚点调整矩形满足给定比例
 * - 自由比例（ratio=null）直接返回原矩形
 */
export function applyAspectRatio(
  rect: CropRect,
  ratio: number | null,
  srcW: number,
  srcH: number,
): CropRect {
  if (!ratio) return rect;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  let width = rect.width;
  let height = Math.round(width / ratio);
  if (height > srcH) {
    height = srcH;
    width = Math.round(height * ratio);
  }
  if (width > srcW) {
    width = srcW;
    height = Math.round(width / ratio);
  }
  let x = Math.round(cx - width / 2);
  let y = Math.round(cy - height / 2);
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x + width > srcW) x = srcW - width;
  if (y + height > srcH) y = srcH - height;
  return { x, y, width, height };
}

/**
 * 按手柄调整矩形大小
 * - 给定手柄位置和鼠标位移 dx/dy（原图坐标系）
 * - 锁定比例时按主导方向调整另一方向
 * - 自动保证最小尺寸与边界限制
 */
export function resizeRect(
  rect: CropRect,
  handle: HandleCode,
  dx: number,
  dy: number,
  ratio: number | null,
  srcW: number,
  srcH: number,
): CropRect {
  let { x, y, width, height } = rect;

  // 各手柄对 dx/dy 的响应方向：+1 同向，-1 反向，0 不变
  // 例：nw 手柄拖向右下 → x 增加（左边界右移），width 减少
  const handleMap: Record<HandleCode, { x: number; y: number; w: number; h: number }> = {
    nw: { x: 1, y: 1, w: -1, h: -1 },
    n: { x: 0, y: 1, w: 0, h: -1 },
    ne: { x: 0, y: 1, w: 1, h: -1 },
    e: { x: 0, y: 0, w: 1, h: 0 },
    se: { x: 0, y: 0, w: 1, h: 1 },
    s: { x: 0, y: 0, w: 0, h: 1 },
    sw: { x: 1, y: 0, w: -1, h: 1 },
    w: { x: 1, y: 0, w: -1, h: 0 },
  };
  const dir = handleMap[handle];

  if (dir.x) x += dx * dir.x;
  if (dir.y) y += dy * dir.y;
  if (dir.w) width += dx * dir.w;
  if (dir.h) height += dy * dir.h;

  // 比例锁定：根据主导方向调整另一方向
  if (ratio) {
    const isWidthDominant = dir.w !== 0;
    if (isWidthDominant) {
      height = Math.round(width / ratio);
      // 高度变化导致 y 同步调整（顶边手柄保持底边不动）
      if (dir.h < 0) y = rect.y + rect.height - height;
    } else {
      width = Math.round(height * ratio);
      if (dir.w < 0) x = rect.x + rect.width - width;
    }
  }

  // 最小尺寸限制
  if (width < MIN_CROP_SIZE) {
    if (dir.w < 0) x = rect.x + rect.width - MIN_CROP_SIZE;
    width = MIN_CROP_SIZE;
    if (ratio) height = Math.round(width / ratio);
  }
  if (height < MIN_CROP_SIZE) {
    if (dir.h < 0) y = rect.y + rect.height - MIN_CROP_SIZE;
    height = MIN_CROP_SIZE;
    if (ratio) width = Math.round(height * ratio);
  }

  // 边界限制：超出原图时整体内移或限制尺寸
  if (x < 0) {
    if (dir.w > 0) width += x; // 右移时左边超出，减少宽度
    x = 0;
  }
  if (y < 0) {
    if (dir.h > 0) height += y;
    y = 0;
  }
  if (x + width > srcW) {
    if (dir.w < 0) x = srcW - width; // 左移时右边超出，左移 x
    if (x < 0) {
      width = srcW;
      x = 0;
    }
  }
  if (y + height > srcH) {
    if (dir.h < 0) y = srcH - height;
    if (y < 0) {
      height = srcH;
      y = 0;
    }
  }
  // 边界限制后再次保证比例
  if (ratio) {
    if (width / ratio > height) {
      width = Math.round(height * ratio);
    } else {
      height = Math.round(width / ratio);
    }
  }
  return { x, y, width, height };
}

/** 移动整个裁剪矩形（保持尺寸不变），自动限制不超出原图 */
export function moveRect(rect: CropRect, dx: number, dy: number, srcW: number, srcH: number): CropRect {
  let { x, y, width, height } = rect;
  x += dx;
  y += dy;
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x + width > srcW) x = srcW - width;
  if (y + height > srcH) y = srcH - height;
  return { x, y, width, height };
}

/** 计算等比缩放后的目标尺寸，不放大 */
function computeTargetSize(srcW: number, srcH: number, maxWidth: number, maxHeight: number) {
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
 * 执行裁剪：使用 drawImage 源矩形参数从原图截取指定区域
 * - 不支持透明的格式（JPEG）会先填充背景色
 * - PNG 无损：quality 参数不生效
 */
export function cropImage(source: SourceImage, options: CropOptions): Promise<CropResult> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const img = new Image();
    img.onload = () => {
      try {
        const { rect, format, quality, maxWidth, maxHeight, background } = options;
        // 校验裁剪矩形
        if (rect.width <= 0 || rect.height <= 0) {
          reject(new Error('裁剪区域无效，宽高必须大于 0'));
          return;
        }
        if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > source.width || rect.y + rect.height > source.height) {
          reject(new Error('裁剪区域超出原图范围'));
          return;
        }
        const target = computeTargetSize(rect.width, rect.height, maxWidth, maxHeight);

        const canvas = document.createElement('canvas');
        canvas.width = target.width;
        canvas.height = target.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D 上下文不可用，请更换浏览器'));
          return;
        }

        // 不支持透明的格式先填背景色，避免透明区域变黑
        const targetMeta = OUTPUT_FORMATS.find((f) => f.mime === format);
        if (targetMeta && !targetMeta.alpha) {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, target.width, target.height);
        }
        // 关键：drawImage 源矩形参数实现裁剪
        ctx.drawImage(
          img,
          rect.x,
          rect.y,
          rect.width,
          rect.height,
          0,
          0,
          target.width,
          target.height,
        );

        const qualityParam = targetMeta?.lossy ? quality / 100 : undefined;
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('裁剪失败，目标格式可能不被当前浏览器支持编码'));
              return;
            }
            const url = URL.createObjectURL(blob);
            resolve({
              blob,
              url,
              width: target.width,
              height: target.height,
              size: blob.size,
              mime: format,
              elapsedMs: Math.round(performance.now() - start),
            });
          },
          format,
          qualityParam,
        );
      } catch (e) {
        reject(new Error(`裁剪失败：${e instanceof Error ? e.message : String(e)}`));
      }
    };
    img.onerror = () => reject(new Error('图片加载失败，无法裁剪'));
    img.src = source.url;
  });
}

/** 由原文件名生成裁剪后文件名（追加 -cropped 后缀 + 替换扩展名） */
export function buildCropFilename(originalName: string, mime: OutputMime): string {
  const dotIdx = originalName.lastIndexOf('.');
  const base = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
  return `${base}-cropped.${extFromMime(mime)}`;
}
