/**
 * WebP 元数据编辑器模块（从 exifEditor.ts 拆分，按需动态加载）
 *
 * 全部在浏览器本地操作 WebP RIFF 结构，不发起任何网络请求。
 *
 * 核心能力：
 *  - 解析 WebP RIFF chunk 结构（VP8 / VP8L / VP8X / EXIF / XMP / ICCP 等）
 *  - 定位 EXIF chunk，复用 JPEG 的 IFD 编辑逻辑（parseExifSegment → applyEdits → rebuildExifPayload）
 *  - 支持 removeGps / removePersonal / removeMakerNote / removeThumbnail / removeSoftware / setDateTime / removeAll
 *  - 批量处理多个 WebP 文件
 *
 * 设计原则：
 *  - 不修改 VP8/VP8L/VP8X/ALPH 等位流 chunk，保证图像质量无损
 *  - WebP chunk 无 CRC32（与 PNG 不同），重建时仅重算 RIFF 文件大小字段
 *  - EXIF chunk 数据若为奇数长度，重建时补 1 字节 0x00 padding
 */

import {
  isWebpFile,
  parseExifSegment,
  removeTagsFromIfd,
  setDateTimeValue,
  rebuildExifPayload,
  TAG,
  WEBP_RIFF_MAGIC,
  WEBP_TYPE_MAGIC,
  type EditOperation,
  type EditResult,
  type FieldLocation,
  type BatchEditSummary,
  type BatchItemResult,
} from './exifEditor';

// ============================================================
// 类型定义
// ============================================================

/** WebP chunk 类型分类 */
export type WebpChunkCategory =
  | 'VP8 ' // lossy 有损位流（关键）
  | 'VP8L' // lossless 无损位流（关键）
  | 'VP8X' // extended 扩展格式（关键）
  | 'EXIF' // EXIF 元数据（辅助）
  | 'XMP ' // XMP 元数据（辅助）
  | 'ICCP' // ICC 色彩配置（辅助）
  | 'ALPH' // alpha 透明通道（关键）
  | 'ANIM' // 动画控制（关键）
  | 'ANMF' // 动画帧（关键）
  | 'OTHER'; // 其他 chunk

/** WebP RIFF chunk 结构 */
export interface WebpChunk {
  /** chunk 类型代码（4 字节 ASCII） */
  type: string;
  /** chunk 类型分类 */
  category: WebpChunkCategory;
  /** chunk 数据长度（不含类型(4) + 长度(4) + padding） */
  dataLength: number;
  /** chunk 数据（不含 padding） */
  data: Uint8Array;
  /** chunk 在文件中的起始偏移（含类型字段） */
  offset: number;
  /** chunk 总字节数（8 + dataLength + paddingBytes） */
  totalLength: number;
  /** padding 字节数（0 或 1，dataLength 为奇数时为 1） */
  paddingBytes: number;
}

/** WebP chunk 摘要（用于 UI 展示，不含原始 data 字节） */
export interface WebpChunkInfo {
  /** chunk 类型代码（4 字节 ASCII） */
  type: string;
  /** chunk 分类 */
  category: WebpChunkCategory;
  /** 数据长度（字节，不含 type/length/padding） */
  dataLength: number;
  /** chunk 在文件中的偏移（含 type 字段） */
  offset: number;
  /** 是否关键 chunk（VP8/VP8L/VP8X/ALPH/ANIM/ANMF，不可删除） */
  isCritical: boolean;
  /** 简短摘要（如 EXIF 字段数 / XMP 长度等） */
  summary?: string;
  /**
   * chunk 原始数据（Uint8Array view，不复制底层 buffer）
   * 用于辅助 chunk 行展开后的 hex dump 展示（与 PngChunkInfo.data 设计对齐）
   */
  data: Uint8Array;
}

/** WebP 元数据快照（与 PngMetaSnapshot 结构对齐，便于复用 UI 组件） */
export interface WebpMetaSnapshot {
  /** 是否包含 EXIF chunk */
  hasExif: boolean;
  /** 是否包含 XMP chunk */
  hasXmp: boolean;
  /** 是否包含 ICC profile chunk */
  hasIccp: boolean;
  /** chunk 总数 */
  totalChunks: number;
  /** 元数据 chunk 数量（EXIF + XMP + ICCP） */
  metaChunkCount: number;
  /** chunk 摘要列表（用于 UI 展示，按文件顺序） */
  chunks: WebpChunkInfo[];
}

// ============================================================
// 常量
// ============================================================

/** EXIF chunk 数据前缀（'Exif\0\0' 6 字节，与 JPEG APP1 payload 一致） */
const WEBP_EXIF_PREFIX = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // 'Exif\0\0'

/** 关键 chunk 分类集合（用于判断 isCritical） */
const WEBP_CRITICAL_CATEGORIES = new Set<WebpChunkCategory>([
  'VP8 ',
  'VP8L',
  'VP8X',
  'ALPH',
  'ANIM',
  'ANMF',
]);

// ============================================================
// 解析函数
// ============================================================

/** 分类 WebP chunk 类型 */
function categorizeWebpChunk(type: string): WebpChunkCategory {
  const known: Record<string, WebpChunkCategory> = {
    'VP8 ': 'VP8 ',
    VP8L: 'VP8L',
    VP8X: 'VP8X',
    EXIF: 'EXIF',
    'XMP ': 'XMP ',
    ICCP: 'ICCP',
    ALPH: 'ALPH',
    ANIM: 'ANIM',
    ANMF: 'ANMF',
  };
  return known[type] ?? 'OTHER';
}

/**
 * 解析 WebP RIFF chunk 结构
 * 跳过 12 字节文件头（'RIFF' + size + 'WEBP'），按顺序遍历所有 chunk
 *
 * 注意 padding 规则：chunk 数据长度为奇数时，末尾补 1 字节 0x00
 */
export function parseWebpChunks(bytes: Uint8Array): WebpChunk[] {
  if (!isWebpFile(bytes)) {
    throw new Error('不是有效的 WebP 文件（RIFF/WEBP 文件头不匹配）');
  }
  const chunks: WebpChunk[] = [];
  let i = 12; // 跳过 12 字节文件头
  const len = bytes.length;
  while (i < len) {
    // 至少需要 8 字节（type(4) + length(4)）
    if (i + 8 > len) break;
    // 读取类型（4 字节 ASCII）
    const type = String.fromCharCode(
      bytes[i],
      bytes[i + 1],
      bytes[i + 2],
      bytes[i + 3],
    );
    // 读取数据长度（4 字节小端无符号）
    const dataLength =
      (bytes[i + 4] |
        (bytes[i + 5] << 8) |
        (bytes[i + 6] << 16) |
        (bytes[i + 7] << 24)) >>>
      0;
    // 校验数据范围
    if (i + 8 + dataLength > len) break;
    const data = bytes.subarray(i + 8, i + 8 + dataLength);
    // padding：dataLength 为奇数时补 1 字节 0x00
    const paddingBytes = dataLength % 2 === 1 ? 1 : 0;
    const totalLength = 8 + dataLength + paddingBytes;
    chunks.push({
      type,
      category: categorizeWebpChunk(type),
      dataLength,
      data,
      offset: i,
      totalLength,
      paddingBytes,
    });
    i += totalLength;
  }
  return chunks;
}

/**
 * 提取 WebP EXIF chunk 的 EXIF payload（含 "Exif\0\0" 前缀）
 *
 * 处理逻辑：
 *  - 若 data 以 "Exif\0\0" 开头，直接返回（与 JPEG APP1 payload 一致）
 *  - 若 data 以 TIFF 头（II/MM）开头，前置 "Exif\0\0" 前缀（兼容不规范文件）
 *  - 否则返回 null（无法识别的 EXIF 数据格式）
 */
function normalizeWebpExifPayload(data: Uint8Array): Uint8Array | null {
  if (data.length < 8) return null;
  // 检测 "Exif\0\0" 前缀
  let hasExifPrefix = true;
  for (let i = 0; i < 6; i++) {
    if (data[i] !== WEBP_EXIF_PREFIX[i]) {
      hasExifPrefix = false;
      break;
    }
  }
  if (hasExifPrefix) return data;
  // 检测 TIFF 头（II 0x2A 或 MM 0x2A）
  const isLittleEndian = data[0] === 0x49 && data[1] === 0x49;
  const isBigEndian = data[0] === 0x4d && data[1] === 0x4d;
  if (!isLittleEndian && !isBigEndian) return null;
  // 不规范文件：前置 "Exif\0\0" 前缀
  const out = new Uint8Array(6 + data.length);
  for (let i = 0; i < 6; i++) out[i] = WEBP_EXIF_PREFIX[i];
  out.set(data, 6);
  return out;
}

/** 提取 WebP 元数据快照（同步，EXIF 内部解析走 parseExifSegment） */
export function extractWebpMetaSnapshot(chunks: WebpChunk[]): WebpMetaSnapshot {
  let hasExif = false;
  let hasXmp = false;
  let hasIccp = false;
  let metaChunkCount = 0;
  const chunkInfos: WebpChunkInfo[] = [];

  for (const chunk of chunks) {
    const isCritical = WEBP_CRITICAL_CATEGORIES.has(chunk.category);
    let summary: string | undefined;
    switch (chunk.category) {
      case 'EXIF': {
        hasExif = true;
        // 尝试解析 EXIF 字段数（用于摘要展示）
        const payload = normalizeWebpExifPayload(chunk.data);
        if (payload) {
          try {
            const parsed = parseExifSegment(payload);
            const fieldCount =
              (parsed.ifd0?.entries.length ?? 0) +
              (parsed.exifIfd?.entries.length ?? 0) +
              (parsed.gpsIfd?.entries.length ?? 0) +
              (parsed.ifd1?.entries.length ?? 0);
            summary = `EXIF 元数据（${fieldCount} 个字段）`;
          } catch {
            summary = 'EXIF 元数据（解析失败）';
          }
        } else {
          summary = 'EXIF 元数据（格式不规范）';
        }
        metaChunkCount++;
        break;
      }
      case 'XMP ':
        hasXmp = true;
        summary = `XMP 元数据（${chunk.dataLength} 字节）`;
        metaChunkCount++;
        break;
      case 'ICCP':
        hasIccp = true;
        summary = `ICC 色彩配置（${chunk.dataLength} 字节）`;
        metaChunkCount++;
        break;
      case 'VP8 ':
        summary = 'VP8 有损位流';
        break;
      case 'VP8L':
        summary = 'VP8L 无损位流';
        break;
      case 'VP8X':
        summary = 'VP8X 扩展格式';
        break;
      case 'ALPH':
        summary = 'Alpha 透明通道';
        break;
      case 'ANIM':
        summary = '动画控制';
        break;
      case 'ANMF':
        summary = '动画帧';
        break;
      case 'OTHER':
        // 其他 chunk 不展示摘要
        break;
    }
    chunkInfos.push({
      type: chunk.type,
      category: chunk.category,
      dataLength: chunk.dataLength,
      offset: chunk.offset,
      isCritical,
      summary,
      data: chunk.data,
    });
  }

  return {
    hasExif,
    hasXmp,
    hasIccp,
    totalChunks: chunks.length,
    metaChunkCount,
    chunks: chunkInfos,
  };
}

// ============================================================
// 编辑函数
// ============================================================

/**
 * 应用编辑操作到 WebP 字节
 *
 * 策略：
 *  - removeAll：删除 EXIF / XMP / ICCP chunk
 *  - 其他操作：定位 EXIF chunk，复用 JPEG 的 IFD 编辑逻辑
 *    （parseExifSegment 解析 → applyEdits 操作 → rebuildExifPayload 重建）
 *
 * 注意：
 *  - WebP chunk 无 CRC32（与 PNG 不同），重建时仅重算 RIFF 文件大小字段
 *  - EXIF chunk 数据若为奇数长度，重建时补 1 字节 0x00 padding
 *  - 不修改 VP8/VP8L/VP8X/ALPH 等位流 chunk，保证图像质量无损
 */
export function applyWebpEdits(webpBytes: Uint8Array, operations: EditOperation[]): EditResult {
  const startTime = performance.now();
  const originalSize = webpBytes.length;
  const removedFields: FieldLocation[] = [];
  const modifiedFields: FieldLocation[] = [];
  const appliedOps: EditOperation[] = [];

  const chunks = parseWebpChunks(webpBytes);

  // 操作语义解析
  const removeAll = operations.some((op) => op.type === 'removeAll');
  const otherOps = operations.filter((op) => op.type !== 'removeAll');

  if (removeAll) appliedOps.push({ type: 'removeAll' });
  for (const op of otherOps) {
    if (op.type === 'setDateTime') {
      if (op.dateTime) appliedOps.push({ type: 'setDateTime', dateTime: op.dateTime });
    } else {
      appliedOps.push(op);
    }
  }

  // 定位 EXIF chunk（仅取第一个，规范文件应仅有一个）
  const exifChunkIdx = chunks.findIndex((c) => c.category === 'EXIF');
  const exifChunk = exifChunkIdx >= 0 ? chunks[exifChunkIdx] : null;

  // removeAll：直接删除 EXIF / XMP / ICCP chunk
  if (removeAll) {
    const keptChunks: WebpChunk[] = [];
    for (const chunk of chunks) {
      if (chunk.category === 'EXIF') {
        removedFields.push({ ifd: 'ifd0', tag: 0, tagName: 'EXIF chunk (all)' });
        continue;
      }
      if (chunk.category === 'XMP ') {
        removedFields.push({ ifd: 'ifd0', tag: 0, tagName: 'XMP chunk (all)' });
        continue;
      }
      if (chunk.category === 'ICCP') {
        removedFields.push({ ifd: 'ifd0', tag: 0, tagName: 'ICCP chunk (all)' });
        continue;
      }
      keptChunks.push(chunk);
    }
    const newBytes = rebuildWebp(keptChunks);
    const elapsedMs = performance.now() - startTime;
    return {
      bytes: newBytes,
      originalSize,
      editedSize: newBytes.length,
      savedBytes: originalSize - newBytes.length,
      appliedOps,
      removedFields,
      modifiedFields,
      elapsedMs,
    };
  }

  // 非 removeAll 但无 EXIF chunk：直接返回（无 IFD 可编辑）
  if (!exifChunk || otherOps.length === 0) {
    const elapsedMs = performance.now() - startTime;
    return {
      bytes: webpBytes,
      originalSize,
      editedSize: originalSize,
      savedBytes: 0,
      appliedOps: [],
      removedFields: [],
      modifiedFields: [],
      elapsedMs,
    };
  }

  // 提取 EXIF payload（补齐 "Exif\0\0" 前缀）
  const payload = normalizeWebpExifPayload(exifChunk.data);
  if (!payload) {
    const elapsedMs = performance.now() - startTime;
    return {
      bytes: webpBytes,
      originalSize,
      editedSize: originalSize,
      savedBytes: 0,
      appliedOps: [],
      removedFields: [],
      modifiedFields: [],
      elapsedMs,
    };
  }

  // 复用 JPEG 的 EXIF 解析与编辑逻辑
  // 创建可写副本（parseExifSegment / rebuildExifPayload 内部会修改 bytes）
  const payloadCopy = new Uint8Array(payload.length);
  payloadCopy.set(payload);
  const parsed = parseExifSegment(payloadCopy);

  // 应用 IFD 编辑操作（与 JPEG applyEdits 内部逻辑一致）
  for (const op of otherOps) {
    switch (op.type) {
      case 'removeGps': {
        removeTagsFromIfd(parsed.ifd0, [TAG.GpsIfdPointer], 'ifd0', removedFields);
        if (parsed.gpsIfd) {
          removedFields.push({ ifd: 'gpsIfd', tag: 0, tagName: 'GPSIFD (all)' });
        }
        break;
      }
      case 'removeThumbnail': {
        if (parsed.ifd1) {
          removedFields.push({ ifd: 'ifd1', tag: 0, tagName: 'IFD1 (thumbnail)' });
        }
        break;
      }
      case 'removeMakerNote': {
        removeTagsFromIfd(parsed.exifIfd, [TAG.MakerNote], 'exifIfd', removedFields);
        break;
      }
      case 'removePersonal': {
        removeTagsFromIfd(
          parsed.ifd0,
          [TAG.Artist, TAG.Copyright, TAG.BodySerialNumber, TAG.CameraOwnerName],
          'ifd0',
          removedFields,
        );
        removeTagsFromIfd(parsed.exifIfd, [TAG.LensSerialNumber], 'exifIfd', removedFields);
        break;
      }
      case 'removeSoftware': {
        removeTagsFromIfd(parsed.ifd0, [TAG.Software], 'ifd0', removedFields);
        break;
      }
      case 'setDateTime': {
        if (op.dateTime) {
          setDateTimeValue(parsed, op.dateTime, modifiedFields);
        }
        break;
      }
      case 'removeAll':
        // 已在上面处理
        break;
    }
  }

  // 重建 EXIF payload（复用 JPEG rebuildExifPayload，"原地置零 + 计数修正"策略）
  const newPayload = rebuildExifPayload(parsed, removedFields);

  // 构造新的 EXIF chunk（保持原 chunk 位置，替换 data）
  const newExifChunk: WebpChunk = {
    type: 'EXIF',
    category: 'EXIF',
    dataLength: newPayload.length,
    data: newPayload,
    offset: 0, // 重建时计算
    totalLength: 8 + newPayload.length + (newPayload.length % 2 === 1 ? 1 : 0),
    paddingBytes: newPayload.length % 2 === 1 ? 1 : 0,
  };

  // 替换原 EXIF chunk
  const newChunks = chunks.map((c, idx) => (idx === exifChunkIdx ? newExifChunk : c));
  const newBytes = rebuildWebp(newChunks);
  const elapsedMs = performance.now() - startTime;

  return {
    bytes: newBytes,
    originalSize,
    editedSize: newBytes.length,
    savedBytes: originalSize - newBytes.length,
    appliedOps,
    removedFields,
    modifiedFields,
    elapsedMs,
  };
}

/**
 * 重建 WebP 字节流
 * 按顺序拼接：文件头（'RIFF' + size + 'WEBP'） + chunks（类型 + 长度 + 数据 + padding）
 * 重算 RIFF 文件大小字段（小端，不含 RIFF 与 size 共 8 字节）
 */
function rebuildWebp(chunks: WebpChunk[]): Uint8Array {
  // 总长度：12 字节文件头 + 每个 chunk (8 + dataLength + paddingBytes)
  let chunkBytes = 0;
  for (const chunk of chunks) {
    chunkBytes += chunk.totalLength;
  }
  const totalLen = 12 + chunkBytes;
  const out = new Uint8Array(totalLen);
  // 写入 'RIFF' 魔数
  for (let i = 0; i < 4; i++) out[i] = WEBP_RIFF_MAGIC[i];
  // 写入文件大小（4 字节小端，不含 RIFF 与 size 共 8 字节）
  const riffSize = totalLen - 8;
  out[4] = riffSize & 0xff;
  out[5] = (riffSize >> 8) & 0xff;
  out[6] = (riffSize >> 16) & 0xff;
  out[7] = (riffSize >>> 24) & 0xff;
  // 写入 'WEBP' 类型
  for (let i = 0; i < 4; i++) out[8 + i] = WEBP_TYPE_MAGIC[i];

  let p = 12;
  for (const chunk of chunks) {
    // 类型（4 字节 ASCII）
    const typeBytes = new TextEncoder().encode(chunk.type);
    if (typeBytes.length !== 4) {
      throw new Error(`无效的 WebP chunk 类型：${chunk.type}（长度 ${typeBytes.length}）`);
    }
    out.set(typeBytes, p);
    p += 4;
    // 数据长度（4 字节小端）
    out[p++] = chunk.dataLength & 0xff;
    out[p++] = (chunk.dataLength >> 8) & 0xff;
    out[p++] = (chunk.dataLength >> 16) & 0xff;
    out[p++] = (chunk.dataLength >>> 24) & 0xff;
    // 数据
    out.set(chunk.data, p);
    p += chunk.dataLength;
    // padding（dataLength 为奇数时补 1 字节 0x00）
    if (chunk.paddingBytes > 0) {
      out[p++] = 0x00;
    }
  }
  return out;
}

/**
 * 批量应用编辑操作到多个 WebP 文件
 * 设计与 applyEditsBatch（JPEG）/ applyPngEditsBatch（PNG）对齐
 */
export async function applyWebpEditsBatch(
  files: Uint8Array[],
  fileNames: string[],
  operations: EditOperation[],
): Promise<BatchEditSummary> {
  const startTime = performance.now();
  const items: BatchItemResult[] = [];
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;
  let totalSavedBytes = 0;

  for (let i = 0; i < files.length; i++) {
    const bytes = files[i];
    const fileName = fileNames[i] ?? `file-${i + 1}.webp`;

    // 校验 WebP 文件头，提前跳过非 WebP 文件
    if (!isWebpFile(bytes)) {
      items.push({ fileName, status: 'skipped', message: '非 WebP 文件，已跳过' });
      skipped++;
      continue;
    }

    try {
      const result = applyWebpEdits(bytes, operations);
      items.push({ fileName, status: 'success', result });
      succeeded++;
      totalSavedBytes += result.savedBytes;
    } catch (err) {
      items.push({
        fileName,
        status: 'error',
        message: err instanceof Error ? err.message : '未知错误',
      });
      failed++;
    }

    // 每 5 个文件让出主线程，避免批量处理时阻塞 UI 渲染
    if ((i + 1) % 5 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  return {
    total: files.length,
    succeeded,
    skipped,
    failed,
    totalSavedBytes,
    totalElapsedMs: performance.now() - startTime,
    items,
  };
}

/** 生成 WebP 编辑后的文件名（保留 .webp 扩展名） */
export function buildWebpEditedFilename(originalName: string): string {
  const dotIdx = originalName.lastIndexOf('.');
  const base = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
  return `${base}-edited.webp`;
}

/** 批量处理时的 WebP 文件名（带序号） */
export function buildWebpBatchEditedFilename(
  originalName: string,
  index: number,
  total: number,
): string {
  const dotIdx = originalName.lastIndexOf('.');
  const base = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
  if (total === 1) return `${base}-edited.webp`;
  const padLen = String(total).length;
  const idx = String(index + 1).padStart(padLen, '0');
  return `${base}-edited-${idx}.webp`;
}
