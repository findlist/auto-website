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
  /** 输出形状：矩形 / 圆形 / 圆角矩形 */
  shape: OutputShape;
}

/** 默认裁剪配置 */
export const DEFAULT_CROP_OPTIONS: Omit<CropOptions, 'rect'> = {
  format: 'image/png',
  quality: 92,
  maxWidth: 0,
  maxHeight: 0,
  background: '#ffffff',
  shape: 'rect',
};

/** 最小裁剪尺寸（避免过小导致难以操作与编码失败） */
export const MIN_CROP_SIZE = 8;

/** 输出形状（用于圆形 / 圆角矩形裁剪，主要服务头像场景） */
export type OutputShape = 'rect' | 'circle' | 'rounded';

/** 输出形状元数据 */
export interface OutputShapeMeta {
  code: OutputShape;
  label: string;
  desc: string;
}

/** 输出形状清单（UI 渲染顺序） */
export const OUTPUT_SHAPES: OutputShapeMeta[] = [
  { code: 'rect', label: '矩形', desc: '标准矩形裁剪，适用于所有场景' },
  { code: 'circle', label: '圆形', desc: '正圆裁剪，头像 / Logo 场景' },
  { code: 'rounded', label: '圆角', desc: '圆角矩形裁剪，App 图标风格' },
];

/** 预设尺寸元数据（社交媒体常用尺寸，方便用户一键应用） */
export interface PresetSizeMeta {
  code: string;
  label: string;
  /** 目标输出宽度（px） */
  width: number;
  /** 目标输出高度（px） */
  height: number;
  /** 推荐的裁剪比例代码（用于联动比例选择） */
  aspect: AspectRatioCode;
  desc: string;
}

/**
 * 社交媒体常用预设尺寸清单
 * - 点击预设时自动切换比例 + 填充等比缩放（maxWidth / maxHeight）
 * - 比例锁定用于裁剪框形状，maxWidth/maxHeight 用于输出尺寸
 */
export const PRESET_SIZES: PresetSizeMeta[] = [
  { code: 'wechat-avatar', label: '微信头像', width: 640, height: 640, aspect: '1:1', desc: '640×640，正方形' },
  { code: 'wechat-moment', label: '朋友圈封面', width: 1080, height: 1920, aspect: '9:16', desc: '1080×1920，竖版全屏' },
  { code: 'weibo-avatar', label: '微博头像', width: 180, height: 180, aspect: '1:1', desc: '180×180，正方形' },
  { code: 'douyin-cover', label: '抖音封面', width: 1080, height: 1920, aspect: '9:16', desc: '1080×1920，竖版短视频' },
  { code: 'youtube-thumb', label: 'YouTube 缩略图', width: 1280, height: 720, aspect: '16:9', desc: '1280×720，16:9 宽屏' },
  { code: 'bilibili-cover', label: 'B 站封面', width: 1146, height: 717, aspect: '16:9', desc: '1146×717，约 16:10' },
  { code: 'twitter-avatar', label: 'Twitter 头像', width: 400, height: 400, aspect: '1:1', desc: '400×400，正方形' },
  { code: 'twitter-cover', label: 'Twitter 封面', width: 1500, height: 500, aspect: '3:2', desc: '1500×500，3:1 横幅' },
  { code: 'facebook-avatar', label: 'Facebook 头像', width: 170, height: 170, aspect: '1:1', desc: '170×170，正方形' },
  { code: 'facebook-cover', label: 'Facebook 封面', width: 820, height: 312, aspect: '3:2', desc: '820×312，横幅' },
  { code: 'instagram-square', label: 'IG 方形', width: 1080, height: 1080, aspect: '1:1', desc: '1080×1080，正方形' },
  { code: 'instagram-portrait', label: 'IG 竖版', width: 1080, height: 1350, aspect: '3:4', desc: '1080×1350，4:5 竖版' },
  { code: 'instagram-story', label: 'IG Story', width: 1080, height: 1920, aspect: '9:16', desc: '1080×1920，9:16 故事' },
  { code: 'linkedin-avatar', label: 'LinkedIn 头像', width: 400, height: 400, aspect: '1:1', desc: '400×400，正方形' },
  { code: 'linkedin-cover', label: 'LinkedIn 封面', width: 1584, height: 396, aspect: '3:2', desc: '1584×396，4:1 横幅' },
];

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
 * 手动绘制圆角矩形路径（兼容性降级：roundRect 是 Baseline 2023，部分老浏览器不支持）
 * - 仅构建路径，不填充不描边，调用方需自行 fill/stroke/clip
 */
function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  // 圆角半径不能超过边长的一半
  const radius = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
}

/**
 * 执行裁剪：使用 drawImage 源矩形参数从原图截取指定区域
 * - 不支持透明的格式（JPEG）会先填充背景色
 * - PNG 无损：quality 参数不生效
 * - shape='circle' 正圆遮罩（建议配合 1:1 比例，否则为内切椭圆视觉效果）
 * - shape='rounded' 圆角矩形遮罩（圆角半径 = 较短边 / 4）
 */
export function cropImage(source: SourceImage, options: CropOptions): Promise<CropResult> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const img = new Image();
    img.onload = () => {
      try {
        const { rect, format, quality, maxWidth, maxHeight, background, shape } = options;
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

        // 不支持透明的格式先填背景色，避免透明区域变黑（针对 JPEG）
        const targetMeta = OUTPUT_FORMATS.find((f) => f.mime === format);
        if (targetMeta && !targetMeta.alpha) {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, target.width, target.height);
        }

        // 非矩形形状：先 clip 再 drawImage，让形状外保持透明（PNG）或背景色（JPEG）
        const needsClip = shape !== 'rect';
        if (needsClip) {
          ctx.save();
          ctx.beginPath();
          if (shape === 'circle') {
            // 正圆：以画布中心为圆心，较短边的一半为半径
            const cx = target.width / 2;
            const cy = target.height / 2;
            const radius = Math.min(cx, cy);
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          } else if (shape === 'rounded') {
            // 圆角矩形：圆角半径取较短边的 1/4，兼顾视觉与可识别性
            const radius = Math.min(target.width, target.height) / 4;
            if (typeof ctx.roundRect === 'function') {
              ctx.roundRect(0, 0, target.width, target.height, radius);
            } else {
              drawRoundedRectPath(ctx, 0, 0, target.width, target.height, radius);
            }
          }
          ctx.closePath();
          ctx.clip();
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

        if (needsClip) {
          ctx.restore();
        }

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

/** 批量裁剪单项结果 */
export interface BatchCropItem {
  /** 原始文件名 */
  name: string;
  /** 原图尺寸（加载失败时为 0） */
  sourceWidth: number;
  sourceHeight: number;
  /** 裁剪结果（失败时为 null） */
  result: CropResult | null;
  /** 错误信息（成功时为 null） */
  error: string | null;
}

/**
 * 批量裁剪：对多张图片按统一比例 + 形状 + 格式顺序处理
 * - 每张图按当前比例自动居中裁剪（不显示裁剪框，适合批量统一处理）
 * - 顺序执行避免内存堆积，每张处理完立即回调进度
 * - 单张失败不影响其他图片，错误记录在 item.error
 * - 调用方负责在卸载时 revokeObjectURL 所有 result.url
 */
export async function cropBatch(
  files: File[],
  options: Omit<CropOptions, 'rect'>,
  ratio: number | null,
  onProgress?: (index: number, total: number, item: BatchCropItem) => void,
): Promise<BatchCropItem[]> {
  const results: BatchCropItem[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    let item: BatchCropItem;
    try {
      const source = await loadImage(file);
      const rect = computeInitialRect(source.width, source.height, ratio);
      const result = await cropImage(source, { ...options, rect });
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
  items: BatchCropItem[],
  onProgress?: (index: number, total: number) => void,
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.result) {
      downloadBlob(item.result.url, buildCropFilename(item.name, item.result.mime));
      onProgress?.(i + 1, items.length);
      // 间隔 200ms，最后一个不等待
      if (i < items.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }
}

/**
 * 通用历史栈：支持撤销 / 重做，最大容量限制避免内存膨胀
 * - 用于单图裁剪的 rect 历史，让用户能回退误操作
 * - 当 push 后又撤销，再次 push 新状态时丢弃被撤销的分支（线性历史模型）
 */
export class HistoryStack<T> {
  private past: T[] = [];
  private future: T[] = [];
  constructor(private readonly limit = 30) {}

  /** 记录新状态：清空 future 分支（线性历史） */
  push(state: T): void {
    this.past.push(state);
    // 超出容量时丢弃最旧记录
    if (this.past.length > this.limit) {
      this.past.shift();
    }
    this.future = [];
  }

  /** 撤销：返回上一个状态，当前状态进入 future 栈 */
  undo(): T | null {
    if (this.past.length <= 1) return null;
    const current = this.past.pop()!;
    this.future.push(current);
    return this.past[this.past.length - 1] ?? null;
  }

  /** 重做：从 future 栈取回一个状态 */
  redo(): T | null {
    if (this.future.length === 0) return null;
    const next = this.future.pop()!;
    this.past.push(next);
    return next;
  }

  canUndo(): boolean {
    return this.past.length > 1;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  /** 重置整个历史栈，仅保留初始状态 */
  reset(state: T): void {
    this.past = [state];
    this.future = [];
  }

  /** 清空所有历史 */
  clear(): void {
    this.past = [];
    this.future = [];
  }
}

/** ZIP 打包单项输入 */
export interface ZipEntry {
  /** 文件名（含扩展名，不含路径） */
  name: string;
  /** 文件二进制内容 */
  blob: Blob;
}

/**
 * 将多个文件打包为单个 ZIP 文件（STORE 模式，无压缩）
 *
 * 实现说明：
 *  - 采用 ZIP STORE 模式（compression method = 0），不压缩文件内容
 *  - 浏览器与系统原生支持解压 STORE 模式的 ZIP，兼容性最佳
 *  - 输出结构：Local File Header + 文件数据 + Central Directory + EOCD
 *  - 完全在浏览器本地构造 Blob，零网络请求
 *
 * 性能说明：
 *  - STORE 模式比 DEFLATE 模式快 5-10 倍，但输出体积 = 文件总和 + 元数据开销
 *  - 图片本身已是压缩格式（PNG/JPEG/WebP/AVIF），二次压缩收益极小
 *  - 适合本工具批量裁剪结果打包下载的场景
 *
 * 兼容性：基于 DataView + Uint8Array，所有现代浏览器（Chrome/Firefox/Safari/Edge）支持
 */
export async function createZipFile(entries: ZipEntry[], zipName = 'cropped-images.zip'): Promise<void> {
  if (entries.length === 0) return;

  // 累计总字节数：每个 entry 的 Local Header (30 + nameLen) + 数据 + Central Header (46 + nameLen) + EOCD (22)
  const encoder = new TextEncoder();
  const nameBytes = entries.map((e) => encoder.encode(e.name));
  const blobBuffers = await Promise.all(entries.map((e) => e.blob.arrayBuffer()));
  const fileDataList = blobBuffers.map((b) => new Uint8Array(b));

  // CRC32 表（预计算 256 项）
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  // 计算单个文件的 CRC32
  const crc32 = (data: Uint8Array): number => {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ data[i]) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
  };

  // 总字节数
  let totalSize = 0;
  for (let i = 0; i < entries.length; i++) {
    totalSize += 30 + nameBytes[i].length + fileDataList[i].length; // Local Header + 数据
    totalSize += 46 + nameBytes[i].length; // Central Header
  }
  totalSize += 22; // EOCD

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  const centralEntries: {
    name: Uint8Array;
    crc: number;
    size: number;
    localOffset: number;
  }[] = [];

  // 写入 Local File Header + 文件数据
  for (let i = 0; i < entries.length; i++) {
    const name = nameBytes[i];
    const data = fileDataList[i];
    const crc = crc32(data);
    const localOffset = offset;

    // Local File Header（30 字节固定 + 文件名）
    view.setUint32(offset, 0x04034b50, true); // 签名
    view.setUint16(offset + 4, 20, true); // 需要的最低版本（2.0 = 支持 ZIP）
    view.setUint16(offset + 6, 0x0800, true); // 通用位标志 bit 11 = UTF-8 文件名
    view.setUint16(offset + 8, 0, true); // 压缩方法（0 = STORE）
    view.setUint16(offset + 10, 0, true); // 文件最后修改时间
    view.setUint16(offset + 12, 0, true); // 文件最后修改日期
    view.setUint32(offset + 14, crc, true); // CRC-32
    view.setUint32(offset + 18, data.length, true); // 压缩后大小
    view.setUint32(offset + 22, data.length, true); // 原始大小
    view.setUint16(offset + 26, name.length, true); // 文件名长度
    view.setUint16(offset + 28, 0, true); // 额外字段长度
    bytes.set(name, offset + 30);
    offset += 30 + name.length;

    // 文件数据
    bytes.set(data, offset);
    offset += data.length;

    centralEntries.push({ name, crc, size: data.length, localOffset });
  }

  // 写入 Central Directory
  const centralStart = offset;
  for (const entry of centralEntries) {
    view.setUint32(offset, 0x02014b50, true); // 签名
    view.setUint16(offset + 4, 20, true); // 制作版本
    view.setUint16(offset + 6, 20, true); // 需要的最低版本
    view.setUint16(offset + 8, 0x0800, true); // 通用位标志 bit 11 = UTF-8 文件名
    view.setUint16(offset + 10, 0, true); // 压缩方法（0 = STORE）
    view.setUint16(offset + 12, 0, true); // 文件最后修改时间
    view.setUint16(offset + 14, 0, true); // 文件最后修改日期
    view.setUint32(offset + 16, entry.crc, true); // CRC-32
    view.setUint32(offset + 20, entry.size, true); // 压缩后大小
    view.setUint32(offset + 24, entry.size, true); // 原始大小
    view.setUint16(offset + 28, entry.name.length, true); // 文件名长度
    view.setUint16(offset + 30, 0, true); // 额外字段长度
    view.setUint16(offset + 32, 0, true); // 文件注释长度
    view.setUint16(offset + 34, 0, true); // 文件开始位置磁盘编号
    view.setUint16(offset + 36, 0, true); // 内部文件属性
    view.setUint32(offset + 38, 0, true); // 外部文件属性
    view.setUint32(offset + 42, entry.localOffset, true); // 本地文件头相对偏移
    bytes.set(entry.name, offset + 46);
    offset += 46 + entry.name.length;
  }

  // 写入 End of Central Directory Record（EOCD）
  view.setUint32(offset, 0x06054b50, true); // 签名
  view.setUint16(offset + 4, 0, true); // 当前磁盘编号
  view.setUint16(offset + 6, 0, true); // Central Directory 开始磁盘编号
  view.setUint16(offset + 8, entries.length, true); // 本磁盘上的 Central Directory 记录数
  view.setUint16(offset + 10, entries.length, true); // 总 Central Directory 记录数
  view.setUint32(offset + 12, offset - centralStart, true); // Central Directory 大小
  view.setUint32(offset + 16, centralStart, true); // Central Directory 开始偏移
  view.setUint16(offset + 20, 0, true); // 注释长度

  // 触发下载
  const zipBlob = new Blob([buffer], { type: 'application/zip' });
  const zipUrl = URL.createObjectURL(zipBlob);
  downloadBlob(zipUrl, zipName);
  // 延迟释放，避免下载未完成就回收 URL
  setTimeout(() => URL.revokeObjectURL(zipUrl), 5000);
}

/**
 * 批量打包为 ZIP 下载
 * - 仅打包成功裁剪的项，跳过失败项
 * - 文件名使用 buildCropFilename 生成（追加 -cropped 后缀 + 替换扩展名）
 */
export async function downloadBatchAsZip(
  items: BatchCropItem[],
  zipName = 'cropped-images.zip',
): Promise<void> {
  const entries: ZipEntry[] = [];
  for (const item of items) {
    if (item.result) {
      entries.push({
        name: buildCropFilename(item.name, item.result.mime),
        blob: item.result.blob,
      });
    }
  }
  if (entries.length === 0) return;
  await createZipFile(entries, zipName);
}
