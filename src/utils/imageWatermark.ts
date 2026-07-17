/**
 * 图片水印工具核心模块
 *
 * 全部在浏览器本地用 Canvas API 处理，不发起任何网络请求。
 *
 * 核心能力：
 *  - 文字水印：自定义文本、字体、字号、颜色、不透明度、字重
 *  - 图片水印：上传水印图片、缩放比例、不透明度
 *  - 10 种位置：九宫格 + 平铺（可自定义平铺间距）
 *  - 旋转角度：-180° ~ 180°，平铺模式逐个旋转
 *  - 批量处理：一次最多 20 张底图统一加水印
 *  - 多格式导出：PNG / JPEG / WebP / AVIF（受浏览器编码能力限制）
 *
 * 与 image-convert 工具的差异：
 *  - image-convert 专注格式转换与体积对比；
 *  - 本工具专注水印绘制（文字 / 图片水印、九宫格 + 平铺、旋转）
 */

import {
  type OutputMime,
  type SourceImage,
  OUTPUT_FORMATS,
  ACCEPTED_INPUT_MIMES,
  MAX_BATCH_COUNT,
  MAX_FILE_SIZE,
  loadImage,
  formatBytes,
  detectAllEncodeSupport,
  downloadBlob,
  extFromMime,
} from './imageConvert';

/** 水印类型 */
export type WatermarkType = 'text' | 'image';

/** 水印位置（九宫格 + 平铺） */
export type WatermarkPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'tile';

/** 位置元数据 */
export interface PositionMeta {
  code: WatermarkPosition;
  label: string;
  desc: string;
}

/** 位置清单（UI 渲染顺序） */
export const POSITIONS: PositionMeta[] = [
  { code: 'top-left', label: '左上', desc: '顶部左侧' },
  { code: 'top-center', label: '顶部居中', desc: '顶部居中' },
  { code: 'top-right', label: '右上', desc: '顶部右侧' },
  { code: 'middle-left', label: '左侧居中', desc: '中部左侧' },
  { code: 'center', label: '正中', desc: '画面正中' },
  { code: 'middle-right', label: '右侧居中', desc: '中部右侧' },
  { code: 'bottom-left', label: '左下', desc: '底部左侧' },
  { code: 'bottom-center', label: '底部居中', desc: '底部居中' },
  { code: 'bottom-right', label: '右下', desc: '底部右侧（默认）' },
  { code: 'tile', label: '平铺', desc: '全图平铺水印' },
];

/** 字体选项 */
export interface FontFamilyMeta {
  value: string;
  label: string;
}

/** 字体清单（使用 CSS 通用字体族，避免引入外部字体依赖） */
export const FONT_FAMILIES: FontFamilyMeta[] = [
  { value: 'sans-serif', label: '无衬线（默认）' },
  { value: 'serif', label: '衬线' },
  { value: 'monospace', label: '等宽' },
  { value: '"Microsoft YaHei", sans-serif', label: '微软雅黑' },
  { value: '"PingFang SC", sans-serif', label: '苹方' },
  { value: '"SimSun", serif', label: '宋体' },
];

/** 文字水印配置 */
export interface TextWatermarkConfig {
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  /** 不透明度 0-100 */
  opacity: number;
  /** 字重 100-900 */
  fontWeight: number;
  /** 描边宽度（px，0 表示无描边，提升与底图对比度） */
  strokeWidth: number;
  /** 描边颜色 */
  strokeColor: string;
}

/** 图片水印配置 */
export interface ImageWatermarkConfig {
  /** 水印图片源（由组件层维护加载） */
  source: SourceImage | null;
  /** 缩放比例 1-100，相对水印图片原始尺寸 */
  scale: number;
  /** 不透明度 0-100 */
  opacity: number;
}

/** 水印通用配置 */
export interface WatermarkConfig {
  type: WatermarkType;
  position: WatermarkPosition;
  /** 水平边距 px（九宫格模式下与画面边的距离） */
  marginX: number;
  /** 垂直边距 px */
  marginY: number;
  /** 旋转角度 -180 ~ 180 */
  rotation: number;
  /** 平铺水平间距 px（仅 tile 模式生效） */
  tileSpacingX: number;
  /** 平铺垂直间距 px */
  tileSpacingY: number;
  text: TextWatermarkConfig;
  image: ImageWatermarkConfig;
}

/** 导出配置 */
export interface ExportConfig {
  format: OutputMime;
  /** 质量 1-100，仅对有损格式生效 */
  quality: number;
  /** 不透明格式背景色（JPEG 等） */
  background: string;
}

/** 单张水印结果 */
export interface WatermarkResult {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  size: number;
  mime: OutputMime;
  elapsedMs: number;
}

export const DEFAULT_TEXT_CONFIG: TextWatermarkConfig = {
  text: '工具盒子 · 版权所有',
  fontFamily: 'sans-serif',
  fontSize: 32,
  color: '#ffffff',
  opacity: 60,
  fontWeight: 600,
  strokeWidth: 0,
  strokeColor: '#000000',
};

export const DEFAULT_IMAGE_CONFIG: ImageWatermarkConfig = {
  source: null,
  scale: 30,
  opacity: 70,
};

export const DEFAULT_WATERMARK_CONFIG: WatermarkConfig = {
  type: 'text',
  position: 'bottom-right',
  marginX: 24,
  marginY: 24,
  rotation: 0,
  tileSpacingX: 200,
  tileSpacingY: 200,
  text: DEFAULT_TEXT_CONFIG,
  image: DEFAULT_IMAGE_CONFIG,
};

export const DEFAULT_EXPORT_CONFIG: ExportConfig = {
  format: 'image/png',
  quality: 92,
  background: '#ffffff',
};

/** 复用 imageConvert 的导出，便于组件层统一引用 */
export {
  OUTPUT_FORMATS,
  ACCEPTED_INPUT_MIMES,
  MAX_BATCH_COUNT,
  MAX_FILE_SIZE,
  loadImage,
  formatBytes,
  detectAllEncodeSupport,
  downloadBlob,
  extFromMime,
};
export type { OutputMime, SourceImage };

/**
 * 由 9 宫格位置码计算水印左上角坐标（未旋转前）
 * 平铺模式不使用此函数
 */
function computeAnchor(
  position: WatermarkPosition,
  canvasW: number,
  canvasH: number,
  wmW: number,
  wmH: number,
  marginX: number,
  marginY: number,
): { x: number; y: number } {
  let x: number;
  let y: number;
  // 水平方向
  if (position.endsWith('left')) {
    x = marginX;
  } else if (position.endsWith('center')) {
    x = (canvasW - wmW) / 2;
  } else {
    x = canvasW - wmW - marginX;
  }
  // 垂直方向
  if (position.startsWith('top')) {
    y = marginY;
  } else if (position.startsWith('middle')) {
    y = (canvasH - wmH) / 2;
  } else {
    y = canvasH - wmH - marginY;
  }
  return { x, y };
}

/**
 * 在 Canvas 上以指定中心点绘制旋转后的水印
 * 通过 save / translate / rotate / restore 实现，旋转中心为水印自身中心
 */
function drawRotated(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  angleDeg: number,
  draw: () => void,
) {
  ctx.save();
  ctx.translate(cx, cy);
  if (angleDeg !== 0) {
    ctx.rotate((angleDeg * Math.PI) / 180);
  }
  // 中心已平移到原点，绘制时以 (0,0) 为水印中心
  draw();
  ctx.restore();
}

/**
 * 应用文字水印到 Canvas 上下文
 * - 九宫格位置：单次绘制
 * - 平铺位置：按 tileSpacingX/Y 循环绘制，每个水印独立旋转
 */
function applyTextWatermark(
  ctx: CanvasRenderingContext2D,
  cfg: WatermarkConfig,
  canvasW: number,
  canvasH: number,
) {
  const t = cfg.text;
  if (!t.text) return;
  ctx.font = `${t.fontWeight} ${t.fontSize}px ${t.fontFamily}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const metrics = ctx.measureText(t.text);
  const wmW = metrics.width;
  const wmH = t.fontSize;
  // 不透明度
  ctx.globalAlpha = Math.max(0, Math.min(1, t.opacity / 100));

  if (cfg.position === 'tile') {
    // 平铺：以水印中心为锚点，按间距网格遍历
    const stepX = Math.max(wmW, cfg.tileSpacingX);
    const stepY = Math.max(wmH, cfg.tileSpacingY);
    // 起始偏移，使水印均匀覆盖（含画面外一圈，确保旋转后边角覆盖）
    for (let y = -stepY; y < canvasH + stepY; y += stepY) {
      for (let x = -stepX; x < canvasW + stepX; x += stepX) {
        drawRotated(ctx, x + stepX / 2, y + stepY / 2, cfg.rotation, () => {
          if (t.strokeWidth > 0) {
            ctx.lineWidth = t.strokeWidth;
            ctx.strokeStyle = t.strokeColor;
            ctx.strokeText(t.text, 0, 0);
          }
          ctx.fillStyle = t.color;
          ctx.fillText(t.text, 0, 0);
        });
      }
    }
  } else {
    const { x, y } = computeAnchor(
      cfg.position,
      canvasW,
      canvasH,
      wmW,
      wmH,
      cfg.marginX,
      cfg.marginY,
    );
    // 旋转中心为水印中心
    drawRotated(ctx, x + wmW / 2, y + wmH / 2, cfg.rotation, () => {
      if (t.strokeWidth > 0) {
        ctx.lineWidth = t.strokeWidth;
        ctx.strokeStyle = t.strokeColor;
        ctx.strokeText(t.text, 0, 0);
      }
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, 0, 0);
    });
  }
  // 重置
  ctx.globalAlpha = 1;
}

/**
 * 应用图片水印到 Canvas 上下文
 * 需要传入已加载的 HTMLImageElement（水印图片）
 */
function applyImageWatermark(
  ctx: CanvasRenderingContext2D,
  cfg: WatermarkConfig,
  canvasW: number,
  canvasH: number,
  wmImg: HTMLImageElement,
) {
  const im = cfg.image;
  const scale = Math.max(1, Math.min(100, im.scale)) / 100;
  const wmW = wmImg.naturalWidth * scale;
  const wmH = wmImg.naturalHeight * scale;
  if (wmW < 1 || wmH < 1) return;
  ctx.globalAlpha = Math.max(0, Math.min(1, im.opacity / 100));

  if (cfg.position === 'tile') {
    const stepX = Math.max(wmW, cfg.tileSpacingX);
    const stepY = Math.max(wmH, cfg.tileSpacingY);
    for (let y = -stepY; y < canvasH + stepY; y += stepY) {
      for (let x = -stepX; x < canvasW + stepX; x += stepX) {
        drawRotated(ctx, x + stepX / 2, y + stepY / 2, cfg.rotation, () => {
          ctx.drawImage(wmImg, -wmW / 2, -wmH / 2, wmW, wmH);
        });
      }
    }
  } else {
    const { x, y } = computeAnchor(
      cfg.position,
      canvasW,
      canvasH,
      wmW,
      wmH,
      cfg.marginX,
      cfg.marginY,
    );
    drawRotated(ctx, x + wmW / 2, y + wmH / 2, cfg.rotation, () => {
      ctx.drawImage(wmImg, -wmW / 2, -wmH / 2, wmW, wmH);
    });
  }
  ctx.globalAlpha = 1;
}

/**
 * 为单张图片添加水印并导出
 * @param source 底图源
 * @param watermark 水印配置
 * @param exportCfg 导出配置
 * @param wmImage 水印图片 HTMLImageElement（图片水印模式必传）
 */
export function applyWatermark(
  source: SourceImage,
  watermark: WatermarkConfig,
  exportCfg: ExportConfig,
  wmImage?: HTMLImageElement,
): Promise<WatermarkResult> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const img = new Image();
    img.onload = () => {
      try {
        const width = source.width;
        const height = source.height;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D 上下文不可用，请更换浏览器'));
          return;
        }

        // 目标格式不支持透明时填充背景色，避免透明区域变黑
        const targetMeta = OUTPUT_FORMATS.find((f) => f.mime === exportCfg.format);
        if (targetMeta && !targetMeta.alpha) {
          ctx.fillStyle = exportCfg.background;
          ctx.fillRect(0, 0, width, height);
        }

        // 绘制底图
        ctx.drawImage(img, 0, 0, width, height);

        // 应用水印
        if (watermark.type === 'text') {
          applyTextWatermark(ctx, watermark, width, height);
        } else if (watermark.type === 'image') {
          if (!wmImage) {
            reject(new Error('图片水印模式缺少水印图片'));
            return;
          }
          applyImageWatermark(ctx, watermark, width, height, wmImage);
        }

        const qualityParam = targetMeta?.lossy ? exportCfg.quality / 100 : undefined;
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('导出失败，目标格式可能不被当前浏览器支持编码'));
              return;
            }
            const url = URL.createObjectURL(blob);
            resolve({
              blob,
              url,
              width,
              height,
              size: blob.size,
              mime: exportCfg.format,
              elapsedMs: Math.round(performance.now() - start),
            });
          },
          exportCfg.format,
          qualityParam,
        );
      } catch (e) {
        reject(new Error(`水印处理失败：${e instanceof Error ? e.message : String(e)}`));
      }
    };
    img.onerror = () => reject(new Error('底图加载失败，无法添加水印'));
    img.src = source.url;
  });
}

/**
 * 批量添加水印（顺序处理避免内存堆积）
 * @param sources 底图源数组
 * @param watermark 水印配置
 * @param exportCfg 导出配置
 * @param wmImage 水印图片
 * @param onProgress 进度回调
 */
export async function applyWatermarkBatch(
  sources: SourceImage[],
  watermark: WatermarkConfig,
  exportCfg: ExportConfig,
  wmImage?: HTMLImageElement,
  onProgress?: (done: number, total: number) => void,
): Promise<WatermarkResult[]> {
  const results: WatermarkResult[] = [];
  for (let i = 0; i < sources.length; i++) {
    const result = await applyWatermark(sources[i], watermark, exportCfg, wmImage);
    results.push(result);
    onProgress?.(i + 1, sources.length);
  }
  return results;
}

/** 由原文件名生成水印后文件名 */
export function buildWatermarkFilename(originalName: string, mime: OutputMime): string {
  const dotIdx = originalName.lastIndexOf('.');
  const base = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
  return `${base}-watermark.${extFromMime(mime)}`;
}
