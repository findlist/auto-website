/**
 * 图片对比工具核心逻辑
 *
 * 全部基于浏览器原生 Canvas API，零网络请求，零依赖。
 *
 * 三种对比模式：
 *  - side-by-side（左右并排）：将两张图缩放至相同尺寸后并排展示
 *  - overlay-slider（滑块叠加）：将两张图叠加，通过可拖动的垂直分割线对比
 *  - diff-highlight（差异高亮）：逐像素对比，相同区域灰度化、差异区域红色高亮
 *
 * 适用场景：设计稿版本对比、A/B 素材对比、像素级差异分析、回归测试截图对比
 */

// 复用公共 ZIP 写入器：批量对比差异图归档打包使用 STORE 模式零依赖实现
import { ZipWriter, sanitizeFileName } from './zipWriter';

/** 输入文件大小上限：30MB，避免浏览器内存压力 */
export const MAX_FILE_SIZE = 30 * 1024 * 1024;

/** 支持的输入 MIME 类型（GIF 仅取首帧） */
export const ACCEPTED_MIMES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/avif',
];

/** 对比模式 */
export type CompareMode = 'side-by-side' | 'overlay-slider' | 'diff-highlight';

/** 差异图色板配置 */
export const DIFF_PALETTE = {
  same: [0, 0, 0, 0],          // 相同区域：透明（叠加在灰度底图上）
  diff: [231, 76, 60, 230],    // 差异区域：红色高亮（半透明，便于观察下方像素）
  background: [38, 38, 38, 255], // 灰度底图：深灰背景
} as const;

/** 单张图片源信息 */
export interface SourceImage {
  file: File;
  url: string;          // ObjectURL，组件卸载时需 revoke
  width: number;       // 原始宽度
  height: number;      // 原始高度
  mime: string;
}

/** 差异统计信息 */
export interface DiffStats {
  /** 差异像素数 */
  diffPixels: number;
  /** 总像素数（取较小图尺寸） */
  totalPixels: number;
  /** 差异比例（0-100，保留 2 位小数） */
  diffPercent: number;
  /** 最大单像素差异（0-255，用于评估差异剧烈程度） */
  maxPixelDiff: number;
  /** 平均差异强度（仅统计差异像素） */
  avgDiffIntensity: number;
}

/** 差异分析结果 */
export interface DiffResult {
  /** 差异图 dataURL（可直接作为 img.src） */
  dataUrl: string;
  /** 差异统计 */
  stats: DiffStats;
  /** 输出画布尺寸 */
  width: number;
  height: number;
}

/**
 * 加载图片文件为 SourceImage
 * 使用 ObjectURL 而非 DataURL，避免大文件 Base64 编码开销
 */
export function loadImage(file: File): Promise<SourceImage> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('请选择图片文件（PNG / JPEG / WebP / GIF 等）'));
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      reject(new Error(`文件过大（${(file.size / 1024 / 1024).toFixed(2)}MB），请选择小于 30MB 的图片`));
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
 * 计算两张图共同对比区域尺寸
 * 策略：取两张图中较小的宽度和高度，避免超出任一图边界
 */
export function computeCompareSize(
  a: { width: number; height: number },
  b: { width: number; height: number },
): { width: number; height: number } {
  return {
    width: Math.min(a.width, b.width),
    height: Math.min(a.height, b.height),
  };
}

/**
 * 异步加载图片并绘制到 Canvas
 * 避免依赖外部 image 状态，确保图片已加载完成
 */
function drawImageAsync(
  source: SourceImage,
  targetWidth: number,
  targetHeight: number,
): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D 上下文不可用，请更换浏览器'));
          return;
        }
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
        resolve(canvas);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    img.onerror = () => reject(new Error('图片加载失败，无法绘制到画布'));
    img.src = source.url;
  });
}

/**
 * 计算两像素颜色差异强度
 * 使用感知加权欧几里得距离（简化版 ITU-R BT.601 权重）
 * 返回 0-255 范围的差异值
 */
export function pixelDiff(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
): number {
  // 加权差异：人眼对绿色更敏感、对蓝色最不敏感
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  const weighted = 0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db;
  // 归一化到 0-255
  return Math.min(255, Math.sqrt(weighted));
}

/**
 * 像素差异分析：逐像素对比两张图，生成差异图
 *
 * - threshold（阈值）：0-255，像素差异小于阈值视为"相同"
 *   - 较低（如 5）：高敏感度，捕捉细微差异（适用于回归测试）
 *   - 中等（如 20）：默认值，平衡可见性与噪声
 *   - 较高（如 50）：低敏感度，仅保留显著差异（适用于压缩损失对比）
 *
 * - 相同区域：原色灰度化（保留视觉信息，便于定位）
 * - 差异区域：红色高亮（叠加在灰度底图上，醒目易识别）
 */
export async function compareImagesDiff(
  sourceA: SourceImage,
  sourceB: SourceImage,
  threshold: number,
): Promise<DiffResult> {
  const { width, height } = computeCompareSize(sourceA, sourceB);
  const [canvasA, canvasB] = await Promise.all([
    drawImageAsync(sourceA, width, height),
    drawImageAsync(sourceB, width, height),
  ]);
  const ctxA = canvasA.getContext('2d');
  const ctxB = canvasB.getContext('2d');
  if (!ctxA || !ctxB) {
    throw new Error('Canvas 2D 上下文不可用，请更换浏览器');
  }
  const dataA = ctxA.getImageData(0, 0, width, height).data;
  const dataB = ctxB.getImageData(0, 0, width, height).data;

  // 输出画布
  const outCanvas = document.createElement('canvas');
  outCanvas.width = width;
  outCanvas.height = height;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) {
    throw new Error('Canvas 2D 上下文不可用，请更换浏览器');
  }
  const outData = outCtx.createImageData(width, height);
  const out = outData.data;

  let diffPixels = 0;
  let maxPixelDiff = 0;
  let totalDiffIntensity = 0;
  const totalPixels = width * height;

  for (let i = 0; i < totalPixels; i++) {
    const offset = i * 4;
    const r1 = dataA[offset];
    const g1 = dataA[offset + 1];
    const b1 = dataA[offset + 2];
    const r2 = dataB[offset];
    const g2 = dataB[offset + 1];
    const b2 = dataB[offset + 2];

    const diff = pixelDiff(r1, g1, b1, r2, g2, b2);
    if (diff > maxPixelDiff) maxPixelDiff = diff;

    if (diff > threshold) {
      // 差异像素：标记为红色高亮
      out[offset] = DIFF_PALETTE.diff[0];
      out[offset + 1] = DIFF_PALETTE.diff[1];
      out[offset + 2] = DIFF_PALETTE.diff[2];
      out[offset + 3] = DIFF_PALETTE.diff[3];
      diffPixels++;
      totalDiffIntensity += diff;
    } else {
      // 相同像素：将原图 A 灰度化（保留视觉定位信息）
      const gray = Math.round(0.299 * r1 + 0.587 * g1 + 0.114 * b1);
      // 灰度降低饱和度，使差异红色更醒目
      const dimmed = Math.round(gray * 0.5);
      out[offset] = dimmed;
      out[offset + 1] = dimmed;
      out[offset + 2] = dimmed;
      out[offset + 3] = 255;
    }
  }

  outCtx.putImageData(outData, 0, 0);

  // 释放中间画布
  canvasA.width = 0;
  canvasA.height = 0;
  canvasB.width = 0;
  canvasB.height = 0;

  const stats: DiffStats = {
    diffPixels,
    totalPixels,
    diffPercent: Number(((diffPixels / totalPixels) * 100).toFixed(2)),
    maxPixelDiff: Math.round(maxPixelDiff),
    avgDiffIntensity: diffPixels === 0 ? 0 : Number((totalDiffIntensity / diffPixels).toFixed(2)),
  };

  return {
    dataUrl: outCanvas.toDataURL('image/png'),
    stats,
    width,
    height,
  };
}

/**
 * 将 ImageData 转为灰度（用于差异图叠加底图）
 * 当前未使用，保留作为后续扩展接口
 */
export function toGrayscale(imageData: ImageData): void {
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
  }
}

/**
 * 生成对比合成图（左右并排模式）
 * 将两张图缩放至相同高度，并排拼接到同一张图中
 */
export async function composeSideBySide(
  sourceA: SourceImage,
  sourceB: SourceImage,
  targetHeight: number,
): Promise<{ dataUrl: string; width: number; height: number }> {
  // 等比缩放：保持各自宽高比，统一到目标高度
  const scaleA = targetHeight / sourceA.height;
  const scaleB = targetHeight / sourceB.height;
  const wA = Math.max(1, Math.round(sourceA.width * scaleA));
  const wB = Math.max(1, Math.round(sourceB.width * scaleB));
  const totalWidth = wA + wB;

  const canvas = document.createElement('canvas');
  canvas.width = totalWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D 上下文不可用，请更换浏览器');
  }

  const [canvasA, canvasB] = await Promise.all([
    drawImageAsync(sourceA, wA, targetHeight),
    drawImageAsync(sourceB, wB, targetHeight),
  ]);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, totalWidth, targetHeight);
  ctx.drawImage(canvasA, 0, 0);
  ctx.drawImage(canvasB, wA, 0);
  // 中间分隔线
  ctx.fillStyle = '#888';
  ctx.fillRect(wA - 1, 0, 2, targetHeight);

  // 释放中间画布
  canvasA.width = 0;
  canvasA.height = 0;
  canvasB.width = 0;
  canvasB.height = 0;

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: totalWidth,
    height: targetHeight,
  };
}

/**
 * 格式化字节为可读字符串
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * 触发文件下载
 */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * 触发文本文件下载（用于 JSON 导出）
 */
export function downloadText(text: string, filename: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, filename);
  // 异步释放，避免下载未完成时回收
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ============================================================
 *  增强能力：差异区域聚类 + JSON 导出
 * ============================================================ */

/** 默认网格分块尺寸（像素），用于区域检测 */
export const DEFAULT_GRID_SIZE = 32;

/** 区域合并的最小差异密度阈值（0-100），低于此值的块不视为活跃 */
export const REGION_DENSITY_THRESHOLD = 5;

/** JSON 导出中保留的区域数量上限（按差异像素数降序） */
export const MAX_REGIONS_IN_EXPORT = 50;

/** 差异区域包围盒 */
export interface DiffRegion {
  /** 区域左上角 X（像素坐标，相对差异图） */
  x: number;
  /** 区域左上角 Y（像素坐标，相对差异图） */
  y: number;
  /** 区域宽度（像素） */
  width: number;
  /** 区域高度（像素） */
  height: number;
  /** 该区域内的差异像素数 */
  diffPixels: number;
  /** 该区域差异密度（0-100，差异像素数 / 区域像素数） */
  density: number;
  /** 区域平均差异强度（0-255） */
  avgIntensity: number;
}

/** 增强版差异结果（含区域列表） */
export interface DiffResultWithRegions extends DiffResult {
  /** 检测到的差异区域（按差异像素数降序） */
  regions: DiffRegion[];
  /** 网格分块尺寸（像素） */
  gridSize: number;
}

/** JSON 导出文件元信息 */
export interface DiffExportMeta {
  /** 生成时间（ISO 字符串） */
  generatedAt: string;
  /** 工具标识 */
  tool: string;
  /** 差异阈值 */
  threshold: number;
  /** 网格分块尺寸 */
  gridSize: number;
  /** 差异图宽度 */
  width: number;
  /** 差异图高度 */
  height: number;
  /** 图片 A 元信息 */
  imageA: { name: string; size: number; width: number; height: number; mime: string };
  /** 图片 B 元信息 */
  imageB: { name: string; size: number; width: number; height: number; mime: string };
}

/** JSON 导出文件完整结构 */
export interface DiffExportJson {
  meta: DiffExportMeta;
  stats: DiffStats;
  regions: DiffRegion[];
}

/**
 * 并查集（Union-Find）实现
 * 用于网格分块的连通区域合并，复杂度接近 O(α(n))
 */
class UnionFind {
  private parent: Int32Array;
  private rank: Uint8Array;

  constructor(size: number) {
    this.parent = new Int32Array(size);
    this.rank = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      this.parent[i] = i;
    }
  }

  find(x: number): number {
    // 路径压缩
    let root = x;
    while (this.parent[root] !== root) {
      root = this.parent[root];
    }
    while (this.parent[x] !== root) {
      const next = this.parent[x];
      this.parent[x] = root;
      x = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    // 按秩合并
    if (this.rank[ra] < this.rank[rb]) {
      this.parent[ra] = rb;
    } else if (this.rank[ra] > this.rank[rb]) {
      this.parent[rb] = ra;
    } else {
      this.parent[rb] = ra;
      this.rank[ra]++;
    }
  }
}

/**
 * 增强版差异分析：一次扫描同时生成差异图与差异区域
 *
 * 算法流程：
 *  1. 逐像素对比，生成差异图（复用原逻辑）
 *  2. 同步统计每个网格块的差异像素数与强度总和
 *  3. 标记差异密度超过 REGION_DENSITY_THRESHOLD 的块为活跃块
 *  4. 使用并查集对相邻活跃块进行 4 连通合并
 *  5. 计算每个连通区域的包围盒与统计信息
 *
 * 复杂度：O(n) 像素扫描 + O(块数) 合并，远优于完整连通区域检测
 *
 * @param gridSize 网格分块尺寸，默认 32 像素
 */
export async function compareImagesDiffWithRegions(
  sourceA: SourceImage,
  sourceB: SourceImage,
  threshold: number,
  gridSize: number = DEFAULT_GRID_SIZE,
): Promise<DiffResultWithRegions> {
  const { width, height } = computeCompareSize(sourceA, sourceB);
  const [canvasA, canvasB] = await Promise.all([
    drawImageAsync(sourceA, width, height),
    drawImageAsync(sourceB, width, height),
  ]);
  const ctxA = canvasA.getContext('2d');
  const ctxB = canvasB.getContext('2d');
  if (!ctxA || !ctxB) {
    throw new Error('Canvas 2D 上下文不可用，请更换浏览器');
  }
  const dataA = ctxA.getImageData(0, 0, width, height).data;
  const dataB = ctxB.getImageData(0, 0, width, height).data;

  // 输出画布
  const outCanvas = document.createElement('canvas');
  outCanvas.width = width;
  outCanvas.height = height;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) {
    throw new Error('Canvas 2D 上下文不可用，请更换浏览器');
  }
  const outData = outCtx.createImageData(width, height);
  const out = outData.data;

  // 网格分块统计
  const cols = Math.ceil(width / gridSize);
  const rows = Math.ceil(height / gridSize);
  const blockDiffPixels = new Uint32Array(cols * rows);
  const blockIntensitySum = new Float64Array(cols * rows);

  let diffPixels = 0;
  let maxPixelDiff = 0;
  let totalDiffIntensity = 0;
  const totalPixels = width * height;

  for (let i = 0; i < totalPixels; i++) {
    const offset = i * 4;
    const r1 = dataA[offset];
    const g1 = dataA[offset + 1];
    const b1 = dataA[offset + 2];
    const r2 = dataB[offset];
    const g2 = dataB[offset + 1];
    const b2 = dataB[offset + 2];

    const diff = pixelDiff(r1, g1, b1, r2, g2, b2);
    if (diff > maxPixelDiff) maxPixelDiff = diff;

    // 像素对应的网格块索引
    const px = i % width;
    const py = Math.floor(i / width);
    const blockX = Math.floor(px / gridSize);
    const blockY = Math.floor(py / gridSize);
    const blockIdx = blockY * cols + blockX;

    if (diff > threshold) {
      // 差异像素：标记为红色高亮
      out[offset] = DIFF_PALETTE.diff[0];
      out[offset + 1] = DIFF_PALETTE.diff[1];
      out[offset + 2] = DIFF_PALETTE.diff[2];
      out[offset + 3] = DIFF_PALETTE.diff[3];
      diffPixels++;
      totalDiffIntensity += diff;
      blockDiffPixels[blockIdx]++;
      blockIntensitySum[blockIdx] += diff;
    } else {
      // 相同像素：将原图 A 灰度化（保留视觉定位信息）
      const gray = Math.round(0.299 * r1 + 0.587 * g1 + 0.114 * b1);
      const dimmed = Math.round(gray * 0.5);
      out[offset] = dimmed;
      out[offset + 1] = dimmed;
      out[offset + 2] = dimmed;
      out[offset + 3] = 255;
    }
  }

  outCtx.putImageData(outData, 0, 0);

  // 释放中间画布
  canvasA.width = 0;
  canvasA.height = 0;
  canvasB.width = 0;
  canvasB.height = 0;

  // 标记活跃块（差异密度超过阈值）
  const totalBlocks = cols * rows;
  const blockPixels = gridSize * gridSize;
  const activeBlocks = new Uint8Array(totalBlocks);
  for (let i = 0; i < totalBlocks; i++) {
    const density = (blockDiffPixels[i] / blockPixels) * 100;
    if (density >= REGION_DENSITY_THRESHOLD && blockDiffPixels[i] > 0) {
      activeBlocks[i] = 1;
    }
  }

  // 并查集合并相邻活跃块（4 连通：右、下）
  const uf = new UnionFind(totalBlocks);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x;
      if (!activeBlocks[idx]) continue;
      // 右邻居
      if (x + 1 < cols && activeBlocks[idx + 1]) {
        uf.union(idx, idx + 1);
      }
      // 下邻居
      if (y + 1 < rows && activeBlocks[idx + cols]) {
        uf.union(idx, idx + cols);
      }
    }
  }

  // 聚合每个连通分量的统计信息
  const regionMap = new Map<number, {
    minX: number; minY: number; maxX: number; maxY: number;
    diffPixels: number; intensitySum: number; blockCount: number;
  }>();

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x;
      if (!activeBlocks[idx]) continue;
      const root = uf.find(idx);
      const blockX = x * gridSize;
      const blockY = y * gridSize;
      const blockRight = Math.min(blockX + gridSize, width);
      const blockBottom = Math.min(blockY + gridSize, height);

      let region = regionMap.get(root);
      if (!region) {
        region = {
          minX: blockX, minY: blockY,
          maxX: blockRight, maxY: blockBottom,
          diffPixels: 0, intensitySum: 0, blockCount: 0,
        };
        regionMap.set(root, region);
      } else {
        // 更新包围盒
        if (blockX < region.minX) region.minX = blockX;
        if (blockY < region.minY) region.minY = blockY;
        if (blockRight > region.maxX) region.maxX = blockRight;
        if (blockBottom > region.maxY) region.maxY = blockBottom;
      }
      region.diffPixels += blockDiffPixels[idx];
      region.intensitySum += blockIntensitySum[idx];
      region.blockCount++;
    }
  }

  // 转换为 DiffRegion 数组（按差异像素数降序）
  const regions: DiffRegion[] = Array.from(regionMap.values()).map((r) => {
    const w = r.maxX - r.minX;
    const h = r.maxY - r.minY;
    const area = w * h;
    return {
      x: r.minX,
      y: r.minY,
      width: w,
      height: h,
      diffPixels: r.diffPixels,
      density: area > 0 ? Number(((r.diffPixels / area) * 100).toFixed(2)) : 0,
      avgIntensity: r.diffPixels > 0 ? Number((r.intensitySum / r.diffPixels).toFixed(2)) : 0,
    };
  }).sort((a, b) => b.diffPixels - a.diffPixels);

  const stats: DiffStats = {
    diffPixels,
    totalPixels,
    diffPercent: Number(((diffPixels / totalPixels) * 100).toFixed(2)),
    maxPixelDiff: Math.round(maxPixelDiff),
    avgDiffIntensity: diffPixels === 0 ? 0 : Number((totalDiffIntensity / diffPixels).toFixed(2)),
  };

  return {
    dataUrl: outCanvas.toDataURL('image/png'),
    stats,
    width,
    height,
    regions,
    gridSize,
  };
}

/**
 * 构造 JSON 导出字符串
 * 包含元信息、统计、区域列表，便于自动化测试集成与跨工具复用
 */
export function buildDiffExportJson(
  result: DiffResultWithRegions,
  sourceA: SourceImage,
  sourceB: SourceImage,
  threshold: number,
): string {
  const exportData: DiffExportJson = {
    meta: {
      generatedAt: new Date().toISOString(),
      tool: 'image-compare@website.niuzi.asia',
      threshold,
      gridSize: result.gridSize,
      width: result.width,
      height: result.height,
      imageA: {
        name: sourceA.file.name,
        size: sourceA.file.size,
        width: sourceA.width,
        height: sourceA.height,
        mime: sourceA.mime,
      },
      imageB: {
        name: sourceB.file.name,
        size: sourceB.file.size,
        width: sourceB.width,
        height: sourceB.height,
        mime: sourceB.mime,
      },
    },
    stats: result.stats,
    // 区域数量上限保护，避免超大图片导出过多区域
    regions: result.regions.slice(0, MAX_REGIONS_IN_EXPORT),
  };
  // 格式化输出，2 空格缩进便于阅读与 diff
  return JSON.stringify(exportData, null, 2);
}

/* ============================================================
 *  批量对比能力：多文件配对 + 队列处理 + 汇总导出
 * ============================================================ */

/** 单次批量处理的最大配对数（防止内存与时间溢出） */
export const MAX_BATCH_PAIRS = 50;

/** 批量对比单个配对项 */
export interface BatchCompareItem {
  /** 配对序号（从 1 开始，便于用户阅读） */
  index: number;
  /** 图片 A */
  sourceA: SourceImage;
  /** 图片 B */
  sourceB: SourceImage;
  /** 对比结果（失败时为 null） */
  result: DiffResultWithRegions | null;
  /** 失败原因（成功时为 undefined） */
  error?: string;
}

/** 批量对比汇总结果 */
export interface BatchCompareSummary {
  /** 生成时间（ISO 字符串） */
  generatedAt: string;
  /** 工具标识 */
  tool: string;
  /** 差异阈值 */
  threshold: number;
  /** 网格分块尺寸 */
  gridSize: number;
  /** 总配对数 */
  total: number;
  /** 成功对比数 */
  success: number;
  /** 失败数 */
  failed: number;
  /** 平均差异比例（仅成功项，0-100） */
  avgDiffPercent: number;
  /** 最大差异比例（仅成功项，0-100） */
  maxDiffPercent: number;
  /** 配对结果列表 */
  items: BatchCompareItem[];
}

/** 批量处理进度回调（current 为当前完成数，total 为总数） */
export type BatchProgressCallback = (
  current: number,
  total: number,
  item: BatchCompareItem,
) => void;

/**
 * 批量对比多对图片
 *
 * 设计要点：
 *  - 顺序执行：避免并发触发过多 Canvas，防止内存峰值过高
 *  - 每对完成后通过回调通知进度，便于 UI 实时更新
 *  - 每对之间让出主线程（setTimeout 0），避免长时间阻塞 UI 响应
 *  - 单对失败不影响其他对，错误信息记录到 item.error
 *
 * @param pairs 图片对数组（每项包含 sourceA 与 sourceB）
 * @param threshold 差异阈值（0-255）
 * @param gridSize 网格分块尺寸
 * @param onProgress 进度回调（可选）
 */
export async function compareImagePairsBatch(
  pairs: { sourceA: SourceImage; sourceB: SourceImage }[],
  threshold: number,
  gridSize: number = DEFAULT_GRID_SIZE,
  onProgress?: BatchProgressCallback,
): Promise<BatchCompareSummary> {
  if (pairs.length === 0) {
    throw new Error('批量对比配对列表为空');
  }
  if (pairs.length > MAX_BATCH_PAIRS) {
    throw new Error(`批量对比配对数超出上限（${MAX_BATCH_PAIRS}），请分批处理`);
  }

  const items: BatchCompareItem[] = [];
  let success = 0;
  let failed = 0;
  let diffPercentSum = 0;
  let maxDiffPercent = 0;

  for (let i = 0; i < pairs.length; i++) {
    const { sourceA, sourceB } = pairs[i];
    const item: BatchCompareItem = {
      index: i + 1,
      sourceA,
      sourceB,
      result: null,
    };

    try {
      const result = await compareImagesDiffWithRegions(sourceA, sourceB, threshold, gridSize);
      item.result = result;
      success++;
      diffPercentSum += result.stats.diffPercent;
      if (result.stats.diffPercent > maxDiffPercent) {
        maxDiffPercent = result.stats.diffPercent;
      }
    } catch (e) {
      item.error = e instanceof Error ? e.message : String(e);
      failed++;
    }

    items.push(item);
    if (onProgress) onProgress(i + 1, pairs.length, item);

    // 让出主线程，避免批量处理长时间阻塞 UI
    if (i < pairs.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    tool: 'image-compare-batch@website.niuzi.asia',
    threshold,
    gridSize,
    total: pairs.length,
    success,
    failed,
    avgDiffPercent: success > 0 ? Number((diffPercentSum / success).toFixed(2)) : 0,
    maxDiffPercent,
    items,
  };
}

/**
 * 文件配对结果（统一结构，兼容顺序配对与前缀配对）
 */
export interface PrefixGroup {
  /** 前缀 key（最后一个分隔符之前的部分，统一用下划线重新连接） */
  prefix: string;
  /** 该前缀下的所有文件（组内已按文件名自然排序） */
  files: File[];
}

export interface FilePairResult {
  /** 配对成功的文件对列表 */
  pairs: File[][];
  /** 警告信息（如未配对文件、分组异常等） */
  warning?: string;
  /** 未配对的文件列表（前缀模式下可能有） */
  unmatched?: File[];
  /** 前缀分组信息（仅前缀模式提供，便于 UI 展示） */
  groups?: PrefixGroup[];
}

/**
 * 前缀配对选项
 */
export interface PrefixPairOptions {
  /**
   * 自定义分隔符字符串（每个字符均作为独立分隔符）
   * - 留空或仅空白时使用默认分隔符 `_ - . 空格`
   * - 长度限制 16 字符，超出部分截断
   * - 仅接受可见 ASCII 字符（0x20-0x7E），其他字符忽略
   * - 自动转义正则元字符（如 `.` `+` `*` `?` 等），用户无需关心
   */
  customSeparators?: string;
}

/** 自定义分隔符最大长度 */
const MAX_SEPARATORS_LEN = 16;

/**
 * 将用户输入的分隔符字符串构建为正则表达式
 * - 每个字符作为独立分隔符（如 `_-.` 匹配 `_` 或 `-` 或 `.`）
 * - 自动转义字符类内的特殊字符（] \\ ^ -），避免注入风险
 * - 仅接受可见 ASCII 字符（0x20-0x7E），其他字符忽略
 * - 空字符串或仅空白时回退到默认分隔符（下划线 / 连字符 / 点号 / 任意空白）
 */
function buildSeparatorRegex(separators?: string): RegExp {
  const input = (separators ?? '').trim();
  if (input.length === 0) {
    return /[_\-.\s]+/;
  }
  // 长度截断
  const truncated = input.slice(0, MAX_SEPARATORS_LEN);
  // 过滤可见 ASCII 字符（0x20-0x7E）
  const chars = Array.from(truncated).filter((ch) => {
    const code = ch.charCodeAt(0);
    return code >= 0x20 && code <= 0x7e;
  });
  if (chars.length === 0) {
    return /[_\-.\s]+/;
  }
  // 字符类内仅需转义 ] \\ ^ - 四个字符
  const escapeRegex = (ch: string) => {
    if (ch === ']' || ch === '\\\\' || ch === '^' || ch === '-') {
      return `\\\\${ch}`;
    }
    return ch;
  };
  const escaped = chars.map(escapeRegex).join('');
  return new RegExp(`[${escaped}]+`);
}

/**
 * 将文件列表按顺序两两配对
 * 策略：files[0]+files[1]、files[2]+files[3]...
 *
 * 若文件数为奇数，最后一个文件会被丢弃并返回警告信息
 *
 * @param files 文件列表
 * @returns 配对结果与（可能的）警告信息
 */
export function pairFilesSequentially(
  files: File[],
): FilePairResult {
  if (files.length === 0) {
    return { pairs: [], warning: '未选择任何文件' };
  }
  if (files.length < 2) {
    return { pairs: [], warning: '至少需要 2 个文件才能配对' };
  }

  const pairs: File[][] = [];
  for (let i = 0; i + 1 < files.length; i += 2) {
    pairs.push([files[i], files[i + 1]]);
  }

  // 奇数个文件时，最后一个无法配对
  if (files.length % 2 === 1) {
    return {
      pairs,
      warning: `共选择 ${files.length} 个文件，最后一个文件「${files[files.length - 1].name}」无法配对，已忽略`,
    };
  }
  return { pairs };
}

/** 文件名分隔符：用于切分前缀 key（默认下划线、连字符、点号、空白） */
const FILENAME_SEPARATORS = /[_\-.\s]+/;

/**
 * 提取文件名 stem（去扩展名）
 * 例：`logo_v1.png` → `logo_v1`；`homepage-before.jpeg` → `homepage-before`
 */
function getFileStem(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  // 仅识别最后一个点且不是首字符（隐藏文件如 `.gitignore` 视为无扩展名）
  if (lastDot > 0) {
    return fileName.slice(0, lastDot);
  }
  return fileName;
}

/**
 * 计算文件名的前缀 key
 * 策略：去掉扩展名后，取最后一个分隔符之前的部分
 *  - `logo_v1` → `logo`
 *  - `homepage-before` → `homepage`
 *  - `test_001_a` → `test_001`
 *  - `icon.a` → `icon`
 *  - `README` → `README`（无分隔符时使用完整 stem）
 *
 * @param fileName 文件名
 * @param separators 可选的自定义分隔符正则（未提供时使用默认 FILENAME_SEPARATORS）
 */
function getFilePrefixKey(fileName: string, separators?: RegExp): string {
  const stem = getFileStem(fileName);
  const sep = separators ?? FILENAME_SEPARATORS;
  const match = stem.split(sep).filter(Boolean);
  if (match.length <= 1) {
    return stem;
  }
  // 去掉最后一个 token，剩余部分用下划线重新连接（统一分隔符便于分组聚合）
  return match.slice(0, -1).join('_');
}

/**
 * 将文件列表按文件名前缀自动配对
 * 策略：
 *  1. 提取每个文件的 stem（去扩展名）
 *  2. 计算前缀 key（最后一个分隔符之前的部分）
 *  3. 按前缀 key 分组，组内按文件名自然排序（保证结果稳定可预测）
 *  4. 每组按顺序两两配对（与顺序配对一致），剩余文件收集到 unmatched
 *
 * 适用场景：
 *  - 同一设计的多版本对比：`logo_v1.png` vs `logo_v2.png`
 *  - 设计稿 before/after 对比：`homepage_before.png` vs `homepage_after.png`
 *  - 回归测试截图配对：`test_001_expected.png` vs `test_001_actual.png`
 *
 * 自定义分隔符：
 *  - 默认分隔符：下划线、连字符、点号、空白
 *  - 通过 options.customSeparators 可传入自定义字符序列（每个字符作为独立分隔符）
 *  - 例：传入 `.@` 时，`logo@v1.png` 与 `logo.v2.png` 会归到前缀 `logo`
 *
 * @param files 文件列表
 * @param options 可选配置（含自定义分隔符）
 * @returns 配对结果（含未配对文件与分组信息）
 */
export function pairFilesByNamePrefix(
  files: File[],
  options?: PrefixPairOptions,
): FilePairResult {
  if (files.length === 0) {
    return { pairs: [], warning: '未选择任何文件' };
  }
  if (files.length < 2) {
    return { pairs: [], warning: '至少需要 2 个文件才能配对' };
  }

  // 根据用户输入构建分隔符正则（自定义或默认）
  const separatorRegex = buildSeparatorRegex(options?.customSeparators);

  // 1. 按前缀 key 分组
  const groupMap = new Map<string, File[]>();
  for (const file of files) {
    const key = getFilePrefixKey(file.name, separatorRegex);
    const group = groupMap.get(key);
    if (group) {
      group.push(file);
    } else {
      groupMap.set(key, [file]);
    }
  }

  // 2. 组内按文件名自然排序（保证配对结果稳定可预测）
  const groups: PrefixGroup[] = [];
  for (const [prefix, groupFiles] of groupMap) {
    groupFiles.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN-u-co-pinyin'));
    groups.push({ prefix, files: groupFiles });
  }
  // 组间按前缀字典序排序，保证 UI 展示稳定
  groups.sort((a, b) => a.prefix.localeCompare(b.prefix, 'zh-Hans-CN-u-co-pinyin'));

  // 3. 每组按顺序两两配对，收集未配对文件
  const pairs: File[][] = [];
  const unmatched: File[] = [];
  const oddGroupPrefixes: string[] = [];
  const over2GroupPrefixes: string[] = [];

  for (const group of groups) {
    const { prefix, files: groupFiles } = group;
    if (groupFiles.length === 1) {
      // 单文件组无法配对
      unmatched.push(...groupFiles);
      oddGroupPrefixes.push(prefix);
      continue;
    }
    if (groupFiles.length > 2) {
      // 超过 2 个文件的组：前两个配对，剩余进入未配对
      over2GroupPrefixes.push(`${prefix}（${groupFiles.length} 个）`);
    }
    for (let i = 0; i + 1 < groupFiles.length; i += 2) {
      pairs.push([groupFiles[i], groupFiles[i + 1]]);
    }
    if (groupFiles.length % 2 === 1) {
      unmatched.push(groupFiles[groupFiles.length - 1]);
    }
  }

  // 4. 生成警告信息（按情况组合，便于用户理解）
  const warnings: string[] = [];
  if (over2GroupPrefixes.length > 0) {
    warnings.push(`以下前缀分组超过 2 个文件，已按文件名排序后顺序配对，剩余文件忽略：${over2GroupPrefixes.join('、')}`);
  }
  if (oddGroupPrefixes.length > 0) {
    warnings.push(`以下前缀分组仅有 1 个文件无法配对：${oddGroupPrefixes.join('、')}`);
  }
  if (pairs.length === 0) {
    return {
      pairs: [],
      warning: '按文件名前缀配对失败：未找到任何可配对的同前缀文件，请改用顺序配对或检查文件命名',
      unmatched,
      groups,
    };
  }

  return {
    pairs,
    warning: warnings.length > 0 ? warnings.join('；') : undefined,
    unmatched,
    groups,
  };
}

/**
 * 构造批量对比 JSON 导出字符串
 * 合并所有配对结果为单个 JSON，便于 CI/CD 集成与趋势分析
 *
 * 导出结构剥离 ObjectURL 等运行时字段，仅保留可序列化的元信息与统计
 */
export function buildBatchExportJson(summary: BatchCompareSummary): string {
  const exportData = {
    meta: {
      generatedAt: summary.generatedAt,
      tool: summary.tool,
      threshold: summary.threshold,
      gridSize: summary.gridSize,
      total: summary.total,
      success: summary.success,
      failed: summary.failed,
      avgDiffPercent: summary.avgDiffPercent,
      maxDiffPercent: summary.maxDiffPercent,
    },
    items: summary.items.map((item) => ({
      index: item.index,
      imageA: {
        name: item.sourceA.file.name,
        size: item.sourceA.file.size,
        width: item.sourceA.width,
        height: item.sourceA.height,
        mime: item.sourceA.mime,
      },
      imageB: {
        name: item.sourceB.file.name,
        size: item.sourceB.file.size,
        width: item.sourceB.width,
        height: item.sourceB.height,
        mime: item.sourceB.mime,
      },
      stats: item.result?.stats ?? null,
      // 区域数量上限保护
      regions: item.result?.regions.slice(0, MAX_REGIONS_IN_EXPORT) ?? [],
      error: item.error ?? null,
    })),
  };
  return JSON.stringify(exportData, null, 2);
}

/* ============================================================
 *  区域放大查看：从原图/差异图中裁剪指定区域并等比放大
 *  用于差异区域三联放大 modal（A / B / 差异图 同区域对比）
 * ============================================================ */

/** 区域提取配置项 */
export interface ExtractRegionOptions {
  /** 输出最大边长（像素），默认 400 */
  targetSize?: number;
  /** 区域四周扩展像素（参考坐标系单位，便于观察上下文），默认 8 */
  padding?: number;
  /** 参考坐标系宽度（region 坐标基于此宽度；省略时默认等于图片自身宽度） */
  refWidth?: number;
  /** 参考坐标系高度（同上） */
  refHeight?: number;
  /** 输出 MIME 类型，默认 image/png（差异图保留红色高亮建议用 PNG） */
  mime?: string;
}

/**
 * 从图片中裁剪指定区域并等比放大输出 dataUrl
 *
 * 设计要点：
 *  - 当图片实际尺寸与 region 坐标系不一致时（如源图大于差异图），
 *    按比例自动映射，保证三联图区域严格对齐
 *  - padding 在参考坐标系中扩展，裁剪时 clamp 到图片边界
 *  - 使用 high 质量图像平滑，便于放大后观察细节
 *  - 内部不缓存图片元素，由调用方控制生命周期
 *
 * @param image 图片源（SourceImage 用其 url，string 视为 dataUrl）
 * @param region 待提取的区域坐标（基于参考坐标系）
 * @param options 可选配置
 */
export async function extractRegionDataUrl(
  image: SourceImage | string,
  region: DiffRegion,
  options: ExtractRegionOptions = {},
): Promise<string> {
  const { targetSize = 400, padding = 8, refWidth, refHeight, mime = 'image/png' } = options;

  const img = await loadHtmlImage(image);
  const imgW = img.naturalWidth;
  const imgH = img.naturalHeight;

  // 坐标映射比例：参考坐标系 → 图片自身坐标系
  const scaleX = refWidth ? imgW / refWidth : 1;
  const scaleY = refHeight ? imgH / refHeight : 1;

  // 在图片自身坐标系中计算裁剪区域（含 padding，clamp 到边界）
  const sx = Math.max(0, Math.round((region.x - padding) * scaleX));
  const sy = Math.max(0, Math.round((region.y - padding) * scaleY));
  const sw = Math.min(imgW - sx, Math.round((region.width + padding * 2) * scaleX));
  const sh = Math.min(imgH - sy, Math.round((region.height + padding * 2) * scaleY));

  if (sw <= 0 || sh <= 0) {
    throw new Error('区域坐标无效，无法裁剪');
  }

  // 等比放大到 targetSize（保证最长边等于 targetSize）
  const maxSide = Math.max(sw, sh);
  const scale = targetSize / maxSide;
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D 上下文不可用，请更换浏览器');
  }
  // high 质量平滑，便于放大观察细节
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);

  return canvas.toDataURL(mime);
}

/**
 * 加载图片元素（内部辅助函数）
 * 统一处理 SourceImage 与 dataUrl 字符串两种输入
 */
function loadHtmlImage(image: SourceImage | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = typeof image === 'string' ? image : image.url;
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败，无法提取区域'));
    img.src = url;
  });
}

/* ============================================================
 *  区域放大：三联合成图导出
 *  将 A / B / 差异图 三张放大后的区域图水平并排合成单张 PNG
 *  便于一次性下载归档、贴入报告、分享给团队
 * ============================================================ */

/** 合成图配置项 */
export interface ComposeTripleOptions {
  /** 三张图的标题（默认 ['图片 A', '图片 B', '差异图']） */
  labels?: [string, string, string];
  /** 单张图之间的间隔像素，默认 16 */
  gap?: number;
  /** 标题栏高度像素，默认 28 */
  labelBarHeight?: number;
  /** 合成图四周 padding 像素，默认 16 */
  padding?: number;
  /** 背景色，默认白色（便于打印与文档粘贴） */
  background?: string;
  /** 标题栏背景色，默认浅灰 */
  labelBg?: string;
  /** 标题栏文字色 */
  labelColor?: string;
  /** 输出 MIME，默认 image/png */
  mime?: string;
}

/**
 * 将三张图水平并排合成单张 PNG dataUrl
 *
 * 设计要点：
 *  - 三张图等宽排列，高度按各自原始比例计算（保证不变形）
 *  - 每张图顶部渲染标题栏（便于脱离上下文识别）
 *  - 三张图高度可能不同（如宽高比差异），按最高一张对齐底部
 *  - 使用 high 质量图像平滑，避免缩放锯齿
 *
 * @param images 三张图的 dataUrl 数组（A / B / 差异图）
 * @param options 可选配置
 */
export async function composeTripleImages(
  images: [string, string, string],
  options: ComposeTripleOptions = {},
): Promise<string> {
  const {
    labels = ['图片 A', '图片 B', '差异图'],
    gap = 16,
    labelBarHeight = 28,
    padding = 16,
    background = '#ffffff',
    labelBg = '#f5f5f5',
    labelColor = '#333333',
    mime = 'image/png',
  } = options;

  if (images.length !== 3) {
    throw new Error('合成图需要 3 张图片（A / B / 差异图）');
  }

  // 并行加载三张图，复用 loadHtmlImage
  const [imgA, imgB, imgDiff] = await Promise.all([
    loadHtmlImage(images[0]),
    loadHtmlImage(images[1]),
    loadHtmlImage(images[2]),
  ]);
  const loaded = [imgA, imgB, imgDiff];

  // 计算每张图等宽渲染时的目标宽度
  // 策略：取三张图原始宽度的最小值作为目标宽度，避免较小图被放大过度失真
  const targetW = Math.min(imgA.naturalWidth, imgB.naturalWidth, imgDiff.naturalWidth);

  // 计算每张图等宽渲染时的高度（保持原始比例）
  const renderHeight = (img: HTMLImageElement) => {
    if (img.naturalWidth <= 0) return 0;
    return Math.round((img.naturalHeight / img.naturalWidth) * targetW);
  };
  const heights = loaded.map(renderHeight);
  const maxRenderH = Math.max(...heights);

  // 合成画布尺寸：padding + 三列等宽 + 两个 gap + 标题栏 + 底部对齐余量
  const canvasW = padding * 2 + targetW * 3 + gap * 2;
  const canvasH = padding + labelBarHeight + maxRenderH + padding;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D 上下文不可用，请更换浏览器');
  }

  // 1. 背景
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvasW, canvasH);

  // 2. 每张图：标题栏 + 等宽绘制
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  loaded.forEach((img, i) => {
    const x = padding + (targetW + gap) * i;
    const renderH = heights[i];

    // 标题栏背景
    ctx.fillStyle = labelBg;
    ctx.fillRect(x, padding, targetW, labelBarHeight);

    // 标题栏文字
    ctx.fillStyle = labelColor;
    ctx.font = '14px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(labels[i], x + 12, padding + labelBarHeight / 2);

    // 图片绘制（按原比例等宽缩放，高度居中底部对齐）
    const yImg = padding + labelBarHeight + (maxRenderH - renderH);
    ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, x, yImg, targetW, renderH);
  });

  return canvas.toDataURL(mime);
}

/* ============================================================
 *  ZIP 打包：批量差异图归档下载
 *  采用 STORE 模式（无压缩），原因：
 *  - 差异图为 PNG（已压缩），再压缩收益微小
 *  - 实现简单（无 DEFLATE 算法），代码体积可控
 *  - 兼容所有主流解压软件（Windows 资源管理器 / macOS Finder / unzip）
 *
 *  ZipWriter 与 sanitizeFileName 已抽取到公共模块 src/utils/zipWriter.ts，
 *  供 imageCompare 与 metadataBundle 共享，消除代码重复。
 * ============================================================ */

/** 将 dataUrl 解码为 Uint8Array（仅支持 base64 格式） */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) {
    throw new Error('dataUrl 格式无效');
  }
  const base64 = dataUrl.slice(commaIdx + 1);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

/**
 * 将批量对比结果打包为 ZIP
 *
 * 包含内容：
 *  - 每对成功对比的差异图（PNG），文件名格式：`pair-001_<A>__vs__<B>_diff.png`
 *  - manifest.json：含所有配对的元信息与统计（与 buildBatchExportJson 输出一致）
 *  - README.txt：简要说明 ZIP 内容与差异图图例
 *
 * 设计要点：
 *  - 仅打包成功对比的差异图，失败项仅在 manifest 中记录
 *  - 差异图从 dataUrl 解码为 Uint8Array（已是 PNG 字节，可直接放入 ZIP）
 *  - ZIP 采用 STORE 模式（PNG 已压缩，无需再压缩）
 *  - 完全无第三方依赖，纯浏览器原生 API
 */
export async function buildBatchDiffImagesZip(summary: BatchCompareSummary): Promise<Blob> {
  const writer = new ZipWriter();

  // 1. 添加每对成功对比的差异图
  for (const item of summary.items) {
    if (!item.result) continue; // 跳过失败项

    const idxStr = String(item.index).padStart(3, '0');
    const nameA = sanitizeFileName(item.sourceA.file.name, 40);
    const nameB = sanitizeFileName(item.sourceB.file.name, 40);
    // 文件名包含配对序号 + 双方文件名片段，便于识别
    const diffFileName = `pair-${idxStr}_${nameA}__vs__${nameB}_diff.png`;
    const bytes = dataUrlToBytes(item.result.dataUrl);
    writer.addFile(diffFileName, bytes);
  }

  // 2. 添加 manifest.json（与 buildBatchExportJson 输出一致，便于自动化集成）
  const manifest = buildBatchExportJson(summary);
  writer.addFile('manifest.json', new TextEncoder().encode(manifest));

  // 3. 添加 README.txt（用户友好的说明文档）
  const readmeLines = [
    '图片批量对比结果归档',
    '====================',
    '',
    `生成时间：${summary.generatedAt}`,
    `工具：${summary.tool}`,
    `差异阈值：${summary.threshold}`,
    `网格分块尺寸：${summary.gridSize}`,
    '',
    '统计汇总：',
    `- 总配对数：${summary.total}`,
    `- 成功：${summary.success}`,
    `- 失败：${summary.failed}`,
    `- 平均差异：${summary.avgDiffPercent}%`,
    `- 最大差异：${summary.maxDiffPercent}%`,
    '',
    '文件说明：',
    '- pair-XXX_<A文件名>__vs__<B文件名>_diff.png：每对配对的差异图（PNG）',
    '- manifest.json：完整对比报告（含元信息、统计、区域列表）',
    '',
    '差异图图例：',
    '- 灰色区域：两图相同（原色灰度化，便于定位）',
    '- 红色高亮：两图存在差异（醒目易识别）',
    '',
    '生成自：https://website.niuzi.asia/image-compare',
  ];
  writer.addFile('README.txt', new TextEncoder().encode(readmeLines.join('\n')));

  return writer.finish();
}

/** 下载 Blob 为文件（异步释放 ObjectURL，避免下载未完成时回收） */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
