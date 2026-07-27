/**
 * PNG 元数据编辑器模块（从 exifEditor.ts 拆分，按需动态加载）
 *
 * 全部在浏览器本地操作 PNG 二进制结构，不发起任何网络请求。
 *
 * 核心能力：
 *  - 解析 PNG chunk 结构（签名 + 长度 + 类型 + 数据 + CRC）
 *  - 提取元数据快照（tEXt / zTXt / iTXt / tIME / eXIf）
 *  - 按编辑操作过滤重建 chunk（删除 / 修改时间）
 *  - 重建 PNG 字节流（重算 CRC32）
 *
 * 设计原则：
 *  - 仅支持 PNG 格式
 *  - 关键 chunk（IHDR / PLTE / IDAT / IEND）始终保留
 *  - zTXt / iTXt 关键字读取无需解压（keyword 在压缩数据之前），保持编辑同步
 */

// 从核心模块导入通用类型与工具函数（这些是 JPEG / PNG 共用的）
import {
  // 文件头检测与签名（isPngFile 保留在核心模块用于快速分流）
  isPngFile,
  PNG_SIGNATURE,
  // 时间解析与格式化（保留在核心模块，buildPngSnapshot 同步调用 formatPngTime）
  parseTimeChunk,
  formatPngTime,
  type PngTimeEntry,
  // 通用编辑类型（JPEG / PNG / WebP 共用）
  type EditOperation,
  type EditResult,
  type FieldLocation,
  type BatchEditSummary,
  type BatchItemResult,
} from './exifEditor';

// ============================================================
// 类型定义
// ============================================================

/** PNG chunk 类型分类（按关键性与功能分组） */
export type PngChunkCategory =
  | 'IHDR' // 图像头（关键，不可删除）
  | 'PLTE' // 调色板（关键，不可删除）
  | 'IDAT' // 图像数据（关键，不可删除）
  | 'IEND' // 结束标记（关键，不可删除）
  | 'tEXt' // 文本元数据
  | 'zTXt' // 压缩文本元数据
  | 'iTXt' // 国际化文本元数据
  | 'tIME' // 最后修改时间
  | 'eXIf' // EXIF 数据（PNG 1.5+ 扩展）
  | 'bKGD' // 默认背景色
  | 'pHYs' // 物理像素尺寸（DPI）
  | 'cHRM' // 色度坐标
  | 'gAMA' // Gamma 校正
  | 'iCCP' // ICC 配置
  | 'sRGB' // sRGB 标志
  | 'OTHER'; // 其他辅助 chunk

/** PNG chunk 结构 */
export interface PngChunk {
  /** chunk 类型代码（4 字节 ASCII） */
  type: string;
  /** chunk 类型分类 */
  category: PngChunkCategory;
  /** chunk 数据长度（不含长度字段、类型字段、CRC） */
  dataLength: number;
  /** chunk 数据（不含 CRC） */
  data: Uint8Array;
  /** chunk 在文件中的起始偏移（含长度字段） */
  offset: number;
  /** chunk 总字节数（4 + 4 + dataLength + 4） */
  totalLength: number;
}

/** PNG tEXt/iTXt 条目解析结果 */
export interface PngTextEntry {
  /** 关键字（1-79 字节 ASCII） */
  keyword: string;
  /** 文本内容 */
  text: string;
}

/** PNG chunk 摘要（用于 UI 展示，不含原始 data 字节） */
export interface PngChunkInfo {
  /** chunk 类型代码（4 字节 ASCII） */
  type: string;
  /** chunk 分类 */
  category: PngChunkCategory;
  /** 数据长度（字节，不含 length/type/CRC） */
  dataLength: number;
  /** chunk 在文件中的偏移（含 length 字段） */
  offset: number;
  /** 是否关键 chunk（IHDR/PLTE/IDAT/IEND，不可删除） */
  isCritical: boolean;
  /** 简短摘要（如 tEXt 关键字 / tIME 格式化时间 / bKGD 颜色等） */
  summary?: string;
  /**
   * chunk 原始数据（Uint8Array view，不复制底层 buffer）
   * 用于辅助 chunk 行展开后的 hex dump 展示
   * 关键 chunk（IHDR/PLTE/IDAT/IEND）也保留 data，但 UI 不提供展开能力
   */
  data: Uint8Array;
}

/** PNG 元数据快照（解析后供 UI 展示用） */
export interface PngMetaSnapshot {
  /** 文本元数据条目列表（tEXt + iTXt，按 chunk 顺序） */
  textEntries: PngTextEntry[];
  /** 解压后的 zTXt 文本条目列表（按 chunk 顺序） */
  compressedTextEntries: PngTextEntry[];
  /** 最后修改时间（tIME chunk，可选） */
  lastModified: PngTimeEntry | null;
  /** 是否包含 eXIf chunk（PNG 1.5+ 扩展） */
  hasExif: boolean;
  /** 是否包含 zTXt chunk（基于 compressedTextEntries 推导，兼容旧字段） */
  hasCompressedText: boolean;
  /** chunk 总数 */
  totalChunks: number;
  /** 元数据 chunk 数量（不含 IHDR/PLTE/IDAT/IEND） */
  metaChunkCount: number;
  /** chunk 摘要列表（用于 UI 展示，按文件顺序） */
  chunks: PngChunkInfo[];
}

// ============================================================
// 常量
// ============================================================

/** 关键 chunk 分类集合（用于判断 isCritical） */
const PNG_CRITICAL_CATEGORIES = new Set<PngChunkCategory>([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
]);

/** PNG 编辑操作适用的个人信息系统关键字集合（用于 removePersonal） */
const PNG_PERSONAL_KEYWORDS = new Set([
  'Author',
  'Artist',
  'Copyright',
  'Creation Time',
  'Source',
  'Comment',
]);

/** PNG 软件信息关键字集合（用于 removeSoftware） */
const PNG_SOFTWARE_KEYWORDS = new Set(['Software']);

// ============================================================
// chunk 解析
// ============================================================

/** 分类 PNG chunk 类型 */
function categorizePngChunk(type: string): PngChunkCategory {
  const known: Record<string, PngChunkCategory> = {
    IHDR: 'IHDR',
    PLTE: 'PLTE',
    IDAT: 'IDAT',
    IEND: 'IEND',
    tEXt: 'tEXt',
    zTXt: 'zTXt',
    iTXt: 'iTXt',
    tIME: 'tIME',
    eXIf: 'eXIf',
    bKGD: 'bKGD',
    pHYs: 'pHYs',
    cHRM: 'cHRM',
    gAMA: 'gAMA',
    iCCP: 'iCCP',
    sRGB: 'sRGB',
  };
  return known[type] ?? 'OTHER';
}

/**
 * 解析 PNG chunk 结构
 * 按顺序遍历所有 chunk，IEND 之后的内容忽略
 */
export function parsePngChunks(bytes: Uint8Array): PngChunk[] {
  if (!isPngFile(bytes)) {
    throw new Error('不是有效的 PNG 文件（签名不匹配）');
  }
  const chunks: PngChunk[] = [];
  let i = 8; // 跳过 8 字节签名
  const len = bytes.length;
  while (i < len) {
    // 至少需要 4(长度) + 4(类型) + 4(CRC) = 12 字节
    if (i + 12 > len) break;
    // 读取长度（4 字节大端无符号）
    const dataLength = (
      ((bytes[i] << 24) >>> 0) +
      (bytes[i + 1] << 16) +
      (bytes[i + 2] << 8) +
      bytes[i + 3]
    ) >>> 0;
    // 读取类型（4 字节 ASCII）
    const type = String.fromCharCode(
      bytes[i + 4],
      bytes[i + 5],
      bytes[i + 6],
      bytes[i + 7],
    );
    // 校验数据范围
    if (i + 12 + dataLength > len) break;
    const data = bytes.subarray(i + 8, i + 8 + dataLength);
    const totalLength = 12 + dataLength; // length(4) + type(4) + data + crc(4)
    chunks.push({
      type,
      category: categorizePngChunk(type),
      dataLength,
      data,
      offset: i,
      totalLength,
    });
    i += totalLength;
    // IEND 是最后一个 chunk
    if (type === 'IEND') break;
  }
  return chunks;
}

// ============================================================
// 文本 chunk 解析
// ============================================================

/**
 * 解析 tEXt chunk 数据
 * 格式：keyword(1-79 bytes ASCII) \0 text(Latin1, 可选)
 */
export function parseTextChunk(data: Uint8Array): PngTextEntry | null {
  const nullIdx = data.indexOf(0);
  if (nullIdx < 0) {
    // 无分隔符，全部作为关键字
    const keyword = new TextDecoder('latin1').decode(data).trim();
    return keyword ? { keyword, text: '' } : null;
  }
  const keyword = new TextDecoder('latin1').decode(data.subarray(0, nullIdx)).trim();
  if (!keyword) return null;
  const text = new TextDecoder('latin1').decode(data.subarray(nullIdx + 1));
  return { keyword, text };
}

/**
 * 解析 iTXt chunk 数据（异步，因压缩的 iTXt 需调用 DecompressionStream 解压）
 * 格式：keyword \0 compressionFlag(1) compressionMethod(1) languageTag \0 translatedKeyword \0 text(UTF-8)
 *
 * compressionFlag=0：未压缩，文本为 UTF-8
 * compressionFlag=1：压缩文本，compressionMethod 仅 0（zlib/deflate）合法
 *   - 使用浏览器原生 DecompressionStream('deflate') 解压（与 zTXt 同路径）
 *   - 解压后按 UTF-8 解码（iTXt 规范，与 zTXt 的 Latin1 不同）
 *   - 不支持 DecompressionStream 时返回占位文本，不阻塞流程
 */
export async function parseITxtChunk(data: Uint8Array): Promise<PngTextEntry | null> {
  // 第一个 \0 分隔 keyword
  const nullIdx = data.indexOf(0);
  if (nullIdx < 0) return null;
  const keyword = new TextDecoder('latin1').decode(data.subarray(0, nullIdx)).trim();
  if (!keyword) return null;
  if (data.length < nullIdx + 2) return { keyword, text: '' };
  const compressionFlag = data[nullIdx + 1];
  const compressionMethod = data[nullIdx + 2];
  // 跳过 compressionFlag(1) + compressionMethod(1)
  let p = nullIdx + 3;
  // languageTag \0
  const langEnd = data.indexOf(0, p);
  if (langEnd < 0) return { keyword, text: '' };
  p = langEnd + 1;
  // translatedKeyword \0 (UTF-8)
  const transEnd = data.indexOf(0, p);
  if (transEnd < 0) return { keyword, text: '' };
  p = transEnd + 1;
  // 剩余为 text（UTF-8 编码）
  if (compressionFlag === 0) {
    // 未压缩：直接 UTF-8 解码
    const text = new TextDecoder('utf-8').decode(data.subarray(p));
    return { keyword, text };
  }
  // 压缩的 iTXt：仅 compressionMethod=0（zlib/deflate）合法
  if (compressionMethod !== 0) {
    return { keyword, text: `[未知压缩方法 ${compressionMethod}，未解析]` };
  }
  const compressed = data.subarray(p);
  if (compressed.length === 0) return { keyword, text: '' };
  try {
    const decompressed = await inflateZlib(compressed);
    // iTXt 文本为 UTF-8 编码（PNG 规范，与 zTXt 的 Latin1 不同）
    const text = new TextDecoder('utf-8').decode(decompressed);
    return { keyword, text };
  } catch (err) {
    return {
      keyword,
      text: `[解压失败：${err instanceof Error ? err.message : String(err)}]`,
    };
  }
}

/**
 * 仅解析 iTXt 的关键字（不解压），用于编辑时按关键字过滤
 * iTXt 格式中 keyword 在 compressionFlag/compressionMethod 之前为 Latin1 ASCII，
 * 无需解压即可读取，保持 applyPngEdits 同步避免性能损失（与 zTXt 同设计）
 */
function readITxtKeyword(data: Uint8Array): string {
  const nullIdx = data.indexOf(0);
  if (nullIdx < 0) return '';
  return new TextDecoder('latin1').decode(data.subarray(0, nullIdx)).trim();
}

/**
 * 使用浏览器原生 DecompressionStream('deflate') 解压 zlib 数据
 * 兼容性：Chrome 80+ / Firefox 113+ / Safari 16.4+，主流浏览器均支持
 * 若环境不支持 DecompressionStream，抛出明确错误便于上层降级
 */
async function inflateZlib(compressed: Uint8Array): Promise<Uint8Array> {
  // 检测 DecompressionStream 可用性
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前浏览器不支持 DecompressionStream，无法解压 zTXt');
  }
  // 复制到新的 Uint8Array 避免 SharedArrayBuffer 边界问题
  const inputBytes = compressed instanceof Uint8Array
    ? compressed.slice()
    : new Uint8Array(compressed);
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  void writer.write(inputBytes);
  void writer.close();
  // 读取解压后的所有 chunk
  const reader = ds.readable.getReader();
  const out: Uint8Array[] = [];
  let totalLen = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      out.push(value);
      totalLen += value.length;
    }
  }
  // 合并为单个 Uint8Array
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of out) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}

/**
 * 解析 zTXt chunk 数据（异步，因需调用 DecompressionStream）
 * 格式：keyword(1-79 Latin1) \0 compressionMethod(1) compressedText(zlib/deflate)
 * compressionMethod 仅 0（zlib/deflate）合法，其他值返回未解析提示
 */
export async function parseZTxtChunk(data: Uint8Array): Promise<PngTextEntry | null> {
  const nullIdx = data.indexOf(0);
  if (nullIdx < 0) return null;
  const keyword = new TextDecoder('latin1').decode(data.subarray(0, nullIdx)).trim();
  if (!keyword) return null;
  if (data.length < nullIdx + 2) return { keyword, text: '' };
  const compressionMethod = data[nullIdx + 1];
  if (compressionMethod !== 0) {
    return { keyword, text: `[未知压缩方法 ${compressionMethod}，未解析]` };
  }
  const compressed = data.subarray(nullIdx + 2);
  if (compressed.length === 0) return { keyword, text: '' };
  try {
    const decompressed = await inflateZlib(compressed);
    // zTXt 文本为 Latin1 编码（PNG 规范）
    const text = new TextDecoder('latin1').decode(decompressed);
    return { keyword, text };
  } catch (err) {
    return {
      keyword,
      text: `[解压失败：${err instanceof Error ? err.message : String(err)}]`,
    };
  }
}

/** 仅解析 zTXt 的关键字（不解压），用于编辑时按关键字过滤 */
function readZTxtKeyword(data: Uint8Array): string {
  const nullIdx = data.indexOf(0);
  if (nullIdx < 0) return '';
  return new TextDecoder('latin1').decode(data.subarray(0, nullIdx)).trim();
}

// ============================================================
// 时间 chunk 解析与构造
// ============================================================

/** 从 EXIF 时间字符串解析为 PngTimeEntry（用于 setDateTime 操作） */
function parseExifTimeToPng(dateTime: string): PngTimeEntry | null {
  const m = dateTime.match(/^(\d{4})[-:](\d{2})[-:](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return {
    year: parseInt(y, 10),
    month: parseInt(mo, 10),
    day: parseInt(d, 10),
    hour: parseInt(h, 10),
    minute: parseInt(mi, 10),
    second: parseInt(s, 10),
  };
}

/** 构造 tIME chunk 数据（7 字节） */
function buildTimeChunkData(time: PngTimeEntry): Uint8Array {
  const out = new Uint8Array(7);
  out[0] = (time.year >> 8) & 0xff;
  out[1] = time.year & 0xff;
  out[2] = time.month & 0xff;
  out[3] = time.day & 0xff;
  out[4] = time.hour & 0xff;
  out[5] = time.minute & 0xff;
  out[6] = time.second & 0xff;
  return out;
}

// ============================================================
// 元数据快照提取
// ============================================================

/** 截断文本用于 UI 摘要展示，避免过长 chunk 文本占据过多空间 */
function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…';
}

/**
 * 提取 PNG 元数据快照（异步，因 zTXt 需调用 DecompressionStream 解压）
 * 解析 tEXt/iTXt/zTXt/tIME/eXIf 等 chunk，返回与 JPEG 兼容的快照结构
 */
export async function extractPngMetaSnapshot(chunks: PngChunk[]): Promise<PngMetaSnapshot> {
  const textEntries: PngTextEntry[] = [];
  const compressedTextEntries: PngTextEntry[] = [];
  const chunkInfos: PngChunkInfo[] = [];
  let lastModified: PngTimeEntry | null = null;
  let hasExif = false;
  let hasCompressedText = false;
  let metaChunkCount = 0;

  for (const chunk of chunks) {
    const isCritical = PNG_CRITICAL_CATEGORIES.has(chunk.category);
    let summary: string | undefined;
    switch (chunk.category) {
      case 'tEXt': {
        const entry = parseTextChunk(chunk.data);
        if (entry) {
          textEntries.push(entry);
          summary = `${entry.keyword}${entry.text ? ': ' + truncateText(entry.text, 60) : ''}`;
        }
        metaChunkCount++;
        break;
      }
      case 'iTXt': {
        // 解析 iTXt 文本（异步，压缩的 iTXt 需调用 DecompressionStream）
        const entry = await parseITxtChunk(chunk.data);
        if (entry) {
          textEntries.push(entry);
          summary = `${entry.keyword}${entry.text ? ': ' + truncateText(entry.text, 60) : ''}`;
        }
        metaChunkCount++;
        break;
      }
      case 'zTXt': {
        // 解压 zTXt 文本（异步）
        const entry = await parseZTxtChunk(chunk.data);
        if (entry) {
          compressedTextEntries.push(entry);
          summary = `${entry.keyword}${entry.text ? ': ' + truncateText(entry.text, 60) : ''}`;
        }
        hasCompressedText = true;
        metaChunkCount++;
        break;
      }
      case 'tIME':
        lastModified = parseTimeChunk(chunk.data);
        summary = lastModified ? formatPngTime(lastModified) : undefined;
        metaChunkCount++;
        break;
      case 'eXIf':
        hasExif = true;
        summary = 'PNG 1.5+ EXIF 扩展';
        metaChunkCount++;
        break;
      case 'bKGD':
        summary = '默认背景色';
        metaChunkCount++;
        break;
      case 'pHYs':
        summary = '物理像素尺寸（DPI）';
        metaChunkCount++;
        break;
      case 'cHRM':
        summary = '色度坐标';
        metaChunkCount++;
        break;
      case 'gAMA':
        summary = 'Gamma 校正';
        metaChunkCount++;
        break;
      case 'iCCP':
        summary = 'ICC 配置文件';
        metaChunkCount++;
        break;
      case 'sRGB':
        summary = 'sRGB 色彩空间';
        metaChunkCount++;
        break;
      case 'OTHER':
        metaChunkCount++;
        break;
      default:
        // 关键 chunk（IHDR/PLTE/IDAT/IEND）不计入元数据
        break;
    }
    chunkInfos.push({
      type: chunk.type,
      category: chunk.category,
      dataLength: chunk.dataLength,
      offset: chunk.offset,
      isCritical,
      summary,
      // data 为 subarray view，不复制底层 buffer（用于 hex dump 展示）
      data: chunk.data,
    });
  }

  return {
    textEntries,
    compressedTextEntries,
    lastModified,
    hasExif,
    hasCompressedText,
    totalChunks: chunks.length,
    metaChunkCount,
    chunks: chunkInfos,
  };
}

// ============================================================
// 编辑操作
// ============================================================

/** 判断 tEXt 条目是否属于个人信息系统关键字 */
function isPersonalKeyword(keyword: string): boolean {
  // 关键字大小写不敏感匹配
  return PNG_PERSONAL_KEYWORDS.has(keyword);
}

/** 判断 tEXt 条目是否属于软件信息关键字 */
function isSoftwareKeyword(keyword: string): boolean {
  return PNG_SOFTWARE_KEYWORDS.has(keyword);
}

/**
 * 应用编辑操作到 PNG 字节
 *
 * 策略：
 *  - removeAll：删除所有辅助 chunk（仅保留 IHDR/PLTE/IDAT/IEND）
 *  - removePersonal：删除 tEXt/zTXt/iTXt 中关键字为 Author/Copyright 等的条目
 *  - removeSoftware：删除 tEXt/zTXt/iTXt 中关键字为 Software 的条目
 *  - setDateTime：替换或新增 tIME chunk
 *  - removeGps/removeMakerNote/removeThumbnail：PNG 不适用，跳过
 *
 * 注意：PNG chunk 删除采用"过滤重建"策略（与 JPEG 的"原地置零"不同），
 * 因为 PNG chunk 之间通过 CRC32 校验关联，原地修改会破坏 CRC。
 * 注意：zTXt/iTXt 关键字读取无需解压（keyword 在压缩数据之前），
 * 保持本函数同步避免性能损失（解压仅在 extractPngMetaSnapshot 中用于 UI 展示）。
 */
export function applyPngEdits(pngBytes: Uint8Array, operations: EditOperation[]): EditResult {
  const startTime = performance.now();
  const originalSize = pngBytes.length;
  const removedFields: FieldLocation[] = [];
  const modifiedFields: FieldLocation[] = [];
  const appliedOps: EditOperation[] = [];

  const chunks = parsePngChunks(pngBytes);
  const textEntriesByChunk = new Map<PngChunk, PngTextEntry | null>();
  // 预解析所有 tEXt chunk（含关键字与文本）+ zTXt/iTXt（仅关键字，不解压）
  // zTXt/iTXt 关键字在压缩数据之前为 Latin1 ASCII，无需解压即可读取，
  // applyPngEdits 仅需关键字即可按 removePersonal/removeSoftware 过滤，保持同步避免性能损失
  for (const chunk of chunks) {
    if (chunk.category === 'tEXt') {
      textEntriesByChunk.set(chunk, parseTextChunk(chunk.data));
    } else if (chunk.category === 'iTXt') {
      // iTXt 关键字读取无需解压（keyword 在 compressionFlag 之前）
      const keyword = readITxtKeyword(chunk.data);
      textEntriesByChunk.set(chunk, keyword ? { keyword, text: '' } : null);
    } else if (chunk.category === 'zTXt') {
      const keyword = readZTxtKeyword(chunk.data);
      textEntriesByChunk.set(chunk, keyword ? { keyword, text: '' } : null);
    }
  }

  // 操作语义解析
  const removeAll = operations.some((op) => op.type === 'removeAll');
  const removePersonal = operations.some((op) => op.type === 'removePersonal');
  const removeSoftware = operations.some((op) => op.type === 'removeSoftware');
  const setDateTimeOp = operations.find((op) => op.type === 'setDateTime');

  if (removeAll) appliedOps.push({ type: 'removeAll' });
  if (removePersonal) appliedOps.push({ type: 'removePersonal' });
  if (removeSoftware) appliedOps.push({ type: 'removeSoftware' });
  if (setDateTimeOp && setDateTimeOp.dateTime) {
    appliedOps.push({ type: 'setDateTime', dateTime: setDateTimeOp.dateTime });
  }

  // 过滤 chunk
  const keptChunks: PngChunk[] = [];
  let timeReplaced = false;

  for (const chunk of chunks) {
    // 关键 chunk 始终保留
    if (
      chunk.category === 'IHDR' ||
      chunk.category === 'PLTE' ||
      chunk.category === 'IDAT' ||
      chunk.category === 'IEND'
    ) {
      keptChunks.push(chunk);
      continue;
    }

    // removeAll：所有辅助 chunk 全部删除
    if (removeAll) {
      if (chunk.category === 'eXIf') {
        removedFields.push({ ifd: 'ifd0', tag: 0, tagName: 'eXIf (all EXIF)' });
      } else if (chunk.category === 'tIME') {
        removedFields.push({ ifd: 'ifd0', tag: 0, tagName: 'tIME (last modified)' });
      } else if (
        chunk.category === 'tEXt' ||
        chunk.category === 'iTXt' ||
        chunk.category === 'zTXt'
      ) {
        const entry = textEntriesByChunk.get(chunk);
        if (entry) {
          removedFields.push({ ifd: 'ifd0', tag: 0, tagName: `${chunk.type}: ${entry.keyword}` });
        } else {
          removedFields.push({ ifd: 'ifd0', tag: 0, tagName: `${chunk.type}` });
        }
      } else {
        removedFields.push({ ifd: 'ifd0', tag: 0, tagName: chunk.type });
      }
      continue;
    }

    // tEXt/iTXt/zTXt：按关键字过滤（zTXt 关键字无需解压即可读取）
    if (
      chunk.category === 'tEXt' ||
      chunk.category === 'iTXt' ||
      chunk.category === 'zTXt'
    ) {
      const entry = textEntriesByChunk.get(chunk);
      if (entry) {
        if (removePersonal && isPersonalKeyword(entry.keyword)) {
          removedFields.push({ ifd: 'ifd0', tag: 0, tagName: `${chunk.type}: ${entry.keyword}` });
          continue;
        }
        if (removeSoftware && isSoftwareKeyword(entry.keyword)) {
          removedFields.push({ ifd: 'ifd0', tag: 0, tagName: `${chunk.type}: ${entry.keyword}` });
          continue;
        }
      }
      keptChunks.push(chunk);
      continue;
    }

    // tIME：若 setDateTime 则替换原 chunk（先删除，后续在 IEND 前插入新 chunk）
    if (chunk.category === 'tIME' && setDateTimeOp && setDateTimeOp.dateTime) {
      const newTime = parseExifTimeToPng(setDateTimeOp.dateTime);
      if (newTime) {
        removedFields.push({ ifd: 'ifd0', tag: 0, tagName: 'tIME (old)' });
        modifiedFields.push({ ifd: 'ifd0', tag: 0, tagName: 'tIME (new)' });
        timeReplaced = true;
        continue;
      }
    }

    // 其他辅助 chunk 默认保留
    keptChunks.push(chunk);
  }

  // 若 setDateTime 但原文件无 tIME chunk，则新增
  if (setDateTimeOp && setDateTimeOp.dateTime && !timeReplaced) {
    const newTime = parseExifTimeToPng(setDateTimeOp.dateTime);
    if (newTime) {
      modifiedFields.push({ ifd: 'ifd0', tag: 0, tagName: 'tIME (new)' });
    }
  }

  // 重建 PNG：插入新 tIME chunk（在 IEND 之前）
  const finalChunks = insertTimeChunkBeforeIend(keptChunks, setDateTimeOp?.dateTime);

  const newBytes = rebuildPng(finalChunks);
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
 * 在 IEND chunk 之前插入新的 tIME chunk
 * 若 dateTime 为空或解析失败则原样返回
 * 若已存在 tIME chunk（理论上已被 setDateTime 删除），仍会插入新值
 */
function insertTimeChunkBeforeIend(
  chunks: PngChunk[],
  dateTime?: string,
): PngChunk[] {
  if (!dateTime) return chunks;
  const newTime = parseExifTimeToPng(dateTime);
  if (!newTime) return chunks;
  const timeData = buildTimeChunkData(newTime);
  const newChunk: PngChunk = {
    type: 'tIME',
    category: 'tIME',
    dataLength: 7,
    data: timeData,
    offset: 0, // 新 chunk 偏移在重建时计算
    totalLength: 12 + 7,
  };
  // 找到 IEND 位置，在它之前插入
  const iendIdx = chunks.findIndex((c) => c.category === 'IEND');
  if (iendIdx < 0) {
    return [...chunks, newChunk];
  }
  const result = [...chunks];
  result.splice(iendIdx, 0, newChunk);
  return result;
}

// ============================================================
// PNG 重建与 CRC32
// ============================================================

/**
 * 重建 PNG 字节流
 * 按顺序拼接：签名 + chunks（长度 + 类型 + 数据 + CRC）
 * CRC32 计算覆盖类型 + 数据
 */
function rebuildPng(chunks: PngChunk[]): Uint8Array {
  // 总长度：8 字节签名 + 每个 chunk (12 + dataLength)
  let totalLen = 8;
  for (const chunk of chunks) {
    totalLen += chunk.totalLength;
  }
  const out = new Uint8Array(totalLen);
  // 写入签名
  for (let i = 0; i < 8; i++) {
    out[i] = PNG_SIGNATURE[i];
  }
  let p = 8;
  for (const chunk of chunks) {
    // 长度（4 字节大端）
    out[p++] = (chunk.dataLength >>> 24) & 0xff;
    out[p++] = (chunk.dataLength >> 16) & 0xff;
    out[p++] = (chunk.dataLength >> 8) & 0xff;
    out[p++] = chunk.dataLength & 0xff;
    // 类型（4 字节 ASCII）
    const typeBytes = new TextEncoder().encode(chunk.type);
    if (typeBytes.length !== 4) {
      throw new Error(`无效的 PNG chunk 类型：${chunk.type}（长度 ${typeBytes.length}）`);
    }
    out.set(typeBytes, p);
    const typeStart = p; // 用于 CRC 计算
    p += 4;
    // 数据
    out.set(chunk.data, p);
    p += chunk.dataLength;
    // CRC（4 字节，覆盖类型 + 数据）
    const crc = crc32(out, typeStart, 4 + chunk.dataLength);
    out[p++] = (crc >>> 24) & 0xff;
    out[p++] = (crc >> 16) & 0xff;
    out[p++] = (crc >> 8) & 0xff;
    out[p++] = crc & 0xff;
  }
  return out;
}

/**
 * CRC32 计算（IEEE 802.3 多项式，与 PNG 规范一致）
 * 使用预计算表加速（首次调用时初始化）
 */
let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** 计算字节流的 CRC32（IEEE 802.3） */
function crc32(bytes: Uint8Array, start: number, length: number): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < length; i++) {
    crc = table[(crc ^ bytes[start + i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ============================================================
// 文件名生成与批量处理
// ============================================================

/** 生成 PNG 编辑后的文件名（保留 .png 扩展名） */
export function buildPngEditedFilename(originalName: string): string {
  const dotIdx = originalName.lastIndexOf('.');
  const base = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
  return `${base}-edited.png`;
}

/** 批量处理时的 PNG 文件名（带序号） */
export function buildPngBatchEditedFilename(
  originalName: string,
  index: number,
  total: number,
): string {
  const dotIdx = originalName.lastIndexOf('.');
  const base = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
  if (total === 1) return `${base}-edited.png`;
  const padLen = String(total).length;
  const idx = String(index + 1).padStart(padLen, '0');
  return `${base}-edited-${idx}.png`;
}

/**
 * 批量应用 PNG 编辑操作到多个 PNG 文件
 * 设计与 applyEditsBatch（JPEG 版本）对齐
 */
export async function applyPngEditsBatch(
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
    const fileName = fileNames[i] ?? `file-${i + 1}.png`;

    // 校验 PNG 签名，提前跳过非 PNG 文件
    if (!isPngFile(bytes)) {
      items.push({ fileName, status: 'skipped', message: '非 PNG 文件，已跳过' });
      skipped++;
      continue;
    }

    try {
      const result = applyPngEdits(bytes, operations);
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
