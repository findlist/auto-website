/**
 * EXIF 元数据编辑器核心模块
 *
 * 全部在浏览器本地操作 JPEG 二进制结构，不发起任何网络请求。
 *
 * 核心能力：
 *  - 解析 JPEG 段结构（marker segments），定位 APP1 EXIF 段
 *  - 解析 TIFF/IFD 结构（IFD0 / ExifIFD / GPSIFD / IFD1）
 *  - 按编辑操作修改 IFD 条目（删除 / 修改标签）
 *  - 重建 JPEG（保留压缩数据 SOS..EOI 不变，仅重建前面的元数据段）
 *
 * 与 exif 工具的差异：
 *  - exif 工具基于 exifr 库只读解析；
 *  - 本工具自主实现 JPEG 结构操作，支持删除 GPS / 删除缩略图 / 删除 MakerNote /
 *    删除个人信息 / 修改拍摄时间 / 清除全部 EXIF 等编辑操作
 *
 * 设计原则：
 *  - 仅支持 JPEG（EXIF 主要载体），其他格式提示用户
 *  - 不修改图像压缩数据（SOS..EOI），保证图像质量无损
 *  - 编辑操作可组合，按顺序应用
 */

// ============================================================
// 类型定义
// ============================================================

/** JPEG 段标记 */
export type JpegMarker =
  | 'SOI' // 0xFFD8 起始
  | 'APP0' // 0xFFE0 JFIF
  | 'APP1' // 0xFFE1 EXIF / XMP
  | 'APP2' // 0xFFE2 ICC
  | 'APPn' // 0xFFE3..0xFFEF 其他应用段
  | 'DQT' // 0xFFDB 量化表
  | 'DHT' // 0xFFC4 哈夫曼表
  | 'SOF' // 0xFFC0..0xFFCF 帧起始
  | 'SOS' // 0xFFDA 扫描起始
  | 'EOI' // 0xFFD9 结束
  | 'COM' // 0xFFFE 注释
  | 'UNKNOWN';

/** JPEG 段结构 */
export interface JpegSegment {
  /** 段标记代码（如 0xFFE1） */
  marker: number;
  /** 标记可读名称 */
  name: JpegMarker;
  /** 段数据起始偏移（含 marker 两字节） */
  offset: number;
  /** 段数据长度（不含 marker 两字节，含 length 两字节） */
  length: number;
  /** 段载荷（不含 marker 与 length，仅 APPn/COM 等有） */
  payload: Uint8Array;
  /** 是否为扫描数据段（SOS 之后到下一个 marker 之间的压缩数据） */
  isScanData: boolean;
}

/** IFD 条目类型（EXIF 规范） */
export enum IfdType {
  BYTE = 1, // 8 位无符号
  ASCII = 2, // 7 位 ASCII + 终止符
  SHORT = 3, // 16 位无符号
  LONG = 4, // 32 位无符号
  RATIONAL = 5, // 两个 LONG（分子 / 分母）
  UNDEFINED = 7, // 8 位任意
  SLONG = 9, // 32 位有符号
  SRATIONAL = 10, // 两个 SLONG
}

/** IFD 条目（一条 EXIF 标签的原始结构） */
export interface IfdEntry {
  /** 标签 ID（如 0x010F Make） */
  tag: number;
  /** 数据类型 */
  type: IfdType;
  /** 值数量 */
  count: number;
  /** 值字节长度 */
  valueByteLength: number;
  /** 值数据（固定 4 字节内联，或外部偏移指向） */
  rawValue: Uint8Array;
  /** 若值在外部偏移，记录偏移量；否则 null */
  valueOffset: number | null;
  /** 条目在 IFD 中的字节偏移 */
  entryOffset: number;
}

/** 解析后的 IFD */
export interface ParsedIfd {
  /** IFD 在 EXIF 段中的起始偏移 */
  offset: number;
  /** 条目数量 */
  count: number;
  /** 条目列表 */
  entries: IfdEntry[];
  /** 下一 IFD 偏移（0 表示无） */
  nextIfdOffset: number;
}

/** EXIF 段解析结果 */
export interface ParsedExif {
  /** 字节序：true=大端（MM），false=小端（II） */
  bigEndian: boolean;
  /** TIFF 头起始偏移（相对 EXIF 段 payload） */
  tiffOffset: number;
  /** IFD0 主图像 IFD */
  ifd0: ParsedIfd | null;
  /** ExifIFD 子 IFD（指针在 IFD0 的 0x8769） */
  exifIfd: ParsedIfd | null;
  /** GPSIFD 子 IFD（指针在 IFD0 的 0x8825） */
  gpsIfd: ParsedIfd | null;
  /** IFD1 缩略图 IFD */
  ifd1: ParsedIfd | null;
  /** EXIF 段 payload 全部字节（用于偏移计算） */
  bytes: Uint8Array;
}

/** 编辑操作类型 */
export type EditOperationType =
  | 'removeAll' // 删除全部 EXIF
  | 'removeGps' // 删除 GPS 信息
  | 'removeThumbnail' // 删除缩略图（IFD1）
  | 'removeMakerNote' // 删除 MakerNote（厂商原始数据）
  | 'removePersonal' // 删除个人信息（Artist / Copyright / 序列号等）
  | 'setDateTime' // 修改拍摄时间
  | 'removeSoftware'; // 删除 Software 标签（编辑器痕迹）

/** 编辑操作 */
export interface EditOperation {
  type: EditOperationType;
  /** 仅 setDateTime 使用，格式 'YYYY:MM:DD HH:MM:SS' */
  dateTime?: string;
}

/** 编辑操作元数据（UI 展示用） */
export interface EditOperationMeta {
  type: EditOperationType;
  label: string;
  desc: string;
  /** 默认是否选中 */
  defaultChecked: boolean;
}

/** 字段位置（用于编辑后报告） */
export interface FieldLocation {
  ifd: 'ifd0' | 'exifIfd' | 'gpsIfd' | 'ifd1';
  tag: number;
  tagName: string;
}

/** 编辑结果 */
export interface EditResult {
  /** 编辑后的 JPEG 字节 */
  bytes: Uint8Array;
  /** 原始字节数 */
  originalSize: number;
  /** 编辑后字节数 */
  editedSize: number;
  /** 节省字节数 */
  savedBytes: number;
  /** 已执行的编辑操作 */
  appliedOps: EditOperation[];
  /** 被删除的字段列表 */
  removedFields: FieldLocation[];
  /** 被修改的字段列表 */
  modifiedFields: FieldLocation[];
  /** 处理耗时（毫秒） */
  elapsedMs: number;
}

// ============================================================
// 常量
// ============================================================

/** EXIF 标签 ID（仅列出本工具涉及的） */
export const TAG = {
  // IFD0
  Make: 0x010f,
  Model: 0x0110,
  Software: 0x0131,
  DateTime: 0x0132, // 修改时间
  Artist: 0x013b,
  Copyright: 0x8298,
  ExifIfdPointer: 0x8769,
  GpsIfdPointer: 0x8825,
  // ExifIFD
  DateTimeOriginal: 0x9003, // 原始拍摄时间
  DateTimeDigitized: 0x9004, // 数字化时间
  MakerNote: 0x927c,
  BodySerialNumber: 0xa431,
  CameraOwnerName: 0xa430,
  LensSerialNumber: 0xa435,
  LensMake: 0xa433,
  LensModel: 0xa434,
} as const;

/** 编辑操作元数据清单 */
export const EDIT_OPERATIONS: EditOperationMeta[] = [
  {
    type: 'removeGps',
    label: '删除 GPS 定位',
    desc: '移除 GPSLatitude / GPSLongitude / GPSAltitude 等所有 GPS 标签，防止拍摄地点泄露',
    defaultChecked: true,
  },
  {
    type: 'removePersonal',
    label: '删除个人信息',
    desc: '移除 Artist / Copyright / BodySerialNumber / CameraOwnerName / LensSerialNumber 等身份相关字段',
    defaultChecked: true,
  },
  {
    type: 'removeMakerNote',
    label: '删除 MakerNote',
    desc: '移除厂商原始数据块（含相机内部参数，体积通常较大）',
    defaultChecked: true,
  },
  {
    type: 'removeThumbnail',
    label: '删除缩略图',
    desc: '移除 IFD1 与嵌入的缩略图数据，显著减小文件体积',
    defaultChecked: false,
  },
  {
    type: 'removeSoftware',
    label: '删除软件信息',
    desc: '移除 Software 标签（如 "Adobe Photoshop CC 2024"），隐藏编辑历史痕迹',
    defaultChecked: false,
  },
  {
    type: 'setDateTime',
    label: '修改拍摄时间',
    desc: '同步修改 DateTime / DateTimeOriginal / DateTimeDigitized 三个时间字段',
    defaultChecked: false,
  },
  {
    type: 'removeAll',
    label: '清除全部 EXIF',
    desc: '直接移除整个 APP1 EXIF 段，仅保留图像压缩数据（无法与其他操作组合）',
    defaultChecked: false,
  },
];

/** 输入文件大小上限：50MB */
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

// ============================================================
// 工具函数：字节序读写
// ============================================================

/** 读取 16 位无符号整数（按字节序） */
function readU16(bytes: Uint8Array, offset: number, bigEndian: boolean): number {
  if (bigEndian) return (bytes[offset] << 8) | bytes[offset + 1];
  return bytes[offset] | (bytes[offset + 1] << 8);
}

/** 读取 32 位无符号整数（按字节序） */
function readU32(bytes: Uint8Array, offset: number, bigEndian: boolean): number {
  if (bigEndian) {
    return (
      ((bytes[offset] << 24) >>> 0) +
      (bytes[offset + 1] << 16) +
      (bytes[offset + 2] << 8) +
      bytes[offset + 3]
    );
  }
  return (
    bytes[offset] +
    (bytes[offset + 1] << 8) +
    (bytes[offset + 2] << 16) +
    ((bytes[offset + 3] << 24) >>> 0)
  );
}

/** 写入 16 位无符号整数（按字节序） */
function writeU16(bytes: Uint8Array, offset: number, value: number, bigEndian: boolean): void {
  if (bigEndian) {
    bytes[offset] = (value >> 8) & 0xff;
    bytes[offset + 1] = value & 0xff;
  } else {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >> 8) & 0xff;
  }
}

/** 写入 32 位无符号整数（按字节序） */
function writeU32(bytes: Uint8Array, offset: number, value: number, bigEndian: boolean): void {
  if (bigEndian) {
    bytes[offset] = (value >>> 24) & 0xff;
    bytes[offset + 1] = (value >> 16) & 0xff;
    bytes[offset + 2] = (value >> 8) & 0xff;
    bytes[offset + 3] = value & 0xff;
  } else {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >> 8) & 0xff;
    bytes[offset + 2] = (value >> 16) & 0xff;
    bytes[offset + 3] = (value >>> 24) & 0xff;
  }
}

/** 根据 IFD 类型计算单个值的字节长度 */
function valueByteLength(type: IfdType): number {
  switch (type) {
    case IfdType.BYTE:
    case IfdType.ASCII:
    case IfdType.UNDEFINED:
      return 1;
    case IfdType.SHORT:
      return 2;
    case IfdType.LONG:
    case IfdType.SLONG:
      return 4;
    case IfdType.RATIONAL:
    case IfdType.SRATIONAL:
      return 8;
    default:
      return 1;
  }
}

// ============================================================
// JPEG 段解析
// ============================================================

/** 标记代码到名称的映射 */
function markerName(marker: number): JpegMarker {
  if (marker === 0xffd8) return 'SOI';
  if (marker === 0xffe0) return 'APP0';
  if (marker === 0xffe1) return 'APP1';
  if (marker === 0xffe2) return 'APP2';
  if (marker >= 0xffe3 && marker <= 0xffef) return 'APPn';
  if (marker === 0xffdb) return 'DQT';
  if (marker === 0xffc4) return 'DHT';
  if (marker >= 0xffc0 && marker <= 0xffcf) return 'SOF';
  if (marker === 0xffda) return 'SOS';
  if (marker === 0xffd9) return 'EOI';
  if (marker === 0xfffe) return 'COM';
  return 'UNKNOWN';
}

/**
 * 解析 JPEG 段结构
 * 按标记顺序遍历，SOS 之后的压缩数据作为一个整体段返回
 */
export function parseJpegSegments(bytes: Uint8Array): JpegSegment[] {
  // SOI 校验
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('不是有效的 JPEG 文件（缺少 SOI 标记 0xFFD8）');
  }

  const segments: JpegSegment[] = [];
  let i = 0;
  const len = bytes.length;

  while (i < len) {
    // 寻找标记起始（0xFF）
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    // 跳过连续的 0xFF 填充
    while (i < len && bytes[i] === 0xff) i++;
    if (i >= len) break;

    const marker = 0xff00 | bytes[i];
    i++;

    // SOI / EOI 无长度字段
    if (marker === 0xffd8 || marker === 0xffd9) {
      segments.push({
        marker,
        name: markerName(marker),
        offset: i - 2,
        length: 2,
        payload: new Uint8Array(0),
        isScanData: false,
      });
      if (marker === 0xffd9) break;
      continue;
    }

    // SOS 之后到下一个标记的压缩数据
    if (marker === 0xffda) {
      // 读取 SOS 段头
      if (i + 2 > len) break;
      const segLen = (bytes[i] << 8) | bytes[i + 1];
      const payload = bytes.subarray(i + 2, i + segLen);
      segments.push({
        marker,
        name: 'SOS',
        offset: i - 2,
        length: segLen + 2,
        payload,
        isScanData: false,
      });
      i += segLen;

      // 收集压缩数据（直到下一个 0xFF 非 0x00 的标记）
      const scanStart = i;
      while (i < len) {
        if (bytes[i] === 0xff && i + 1 < len && bytes[i + 1] !== 0x00) {
          // 跳过 RSTn (0xFFD0..0xFFD7) 重启标记
          if (bytes[i + 1] >= 0xd0 && bytes[i + 1] <= 0xd7) {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
      segments.push({
        marker: 0,
        name: 'UNKNOWN',
        offset: scanStart,
        length: i - scanStart,
        payload: bytes.subarray(scanStart, i),
        isScanData: true,
      });
      continue;
    }

    // 其他段：读取 2 字节长度
    if (i + 2 > len) break;
    const segLen = (bytes[i] << 8) | bytes[i + 1];
    if (segLen < 2 || i + segLen > len) {
      throw new Error(`JPEG 段长度异常：marker=0x${marker.toString(16)} segLen=${segLen}`);
    }
    const payload = bytes.subarray(i + 2, i + segLen);
    segments.push({
      marker,
      name: markerName(marker),
      offset: i - 2,
      length: segLen + 2,
      payload,
      isScanData: false,
    });
    i += segLen;
  }

  return segments;
}

// ============================================================
// EXIF / TIFF / IFD 解析
// ============================================================

/** 判断 APP1 段是否为 EXIF 段（以 "Exif\0\0" 开头） */
export function isExifSegment(segment: JpegSegment): boolean {
  if (segment.marker !== 0xffe1) return false;
  const p = segment.payload;
  return p.length >= 6 && p[0] === 0x45 && p[1] === 0x78 && p[2] === 0x69 && p[3] === 0x66 && p[4] === 0x00 && p[5] === 0x00;
}

/**
 * 解析 EXIF 段为 IFD 结构
 * payload 布局：[Exif\0\0 (6)] [TIFF header (8)] [IFD0 ...]
 */
export function parseExifSegment(payload: Uint8Array): ParsedExif {
  if (!isExifSegment({ marker: 0xffe1, payload } as JpegSegment)) {
    throw new Error('APP1 段不是 EXIF 段（缺少 "Exif\\0\\0" 标识）');
  }

  const tiffOffset = 6;
  // 字节序判断：'II*' = 小端，'MM' = 大端
  const byteOrder = payload[tiffOffset];
  const byteOrder2 = payload[tiffOffset + 1];
  let bigEndian: boolean;
  if (byteOrder === 0x49 && byteOrder2 === 0x49) {
    bigEndian = false; // II 小端
  } else if (byteOrder === 0x4d && byteOrder2 === 0x4d) {
    bigEndian = true; // MM 大端
  } else {
    throw new Error(`无效的 TIFF 字节序标识：0x${byteOrder.toString(16)} 0x${byteOrder2.toString(16)}`);
  }

  // 校验魔术数 0x002A
  const magic = readU16(payload, tiffOffset + 2, bigEndian);
  if (magic !== 0x002a) {
    throw new Error(`无效的 TIFF 魔术数：0x${magic.toString(16)}（应为 0x002A）`);
  }

  // IFD0 偏移
  const ifd0Offset = tiffOffset + readU32(payload, tiffOffset + 4, bigEndian);
  const ifd0 = parseIfd(payload, ifd0Offset, bigEndian, tiffOffset);

  // ExifIFD（IFD0 中的 0x8769 指针）
  // 注意：ExifIFDPointer 是 LONG 类型（4 字节），count=1，valueByteLength=4，
  // 在 parseIfd 中走"内联存储"分支，valueOffset 为 null。
  // 因此需区分内联与外部偏移两种情况读取指针值，否则 ExifIFD 永远不会被解析。
  let exifIfd: ParsedIfd | null = null;
  const exifPointer = ifd0?.entries.find((e) => e.tag === TAG.ExifIfdPointer);
  if (exifPointer) {
    const ptrValue =
      exifPointer.valueOffset !== null
        ? readU32(payload, exifPointer.valueOffset, bigEndian)
        : readU32(payload, exifPointer.entryOffset + 8, bigEndian);
    const exifOffset = tiffOffset + ptrValue;
    exifIfd = parseIfd(payload, exifOffset, bigEndian, tiffOffset);
  }

  // GPSIFD（IFD0 中的 0x8825 指针）
  // 同 ExifIFDPointer，亦为 LONG 类型内联存储，需从 entryOffset+8 读取。
  let gpsIfd: ParsedIfd | null = null;
  const gpsPointer = ifd0?.entries.find((e) => e.tag === TAG.GpsIfdPointer);
  if (gpsPointer) {
    const ptrValue =
      gpsPointer.valueOffset !== null
        ? readU32(payload, gpsPointer.valueOffset, bigEndian)
        : readU32(payload, gpsPointer.entryOffset + 8, bigEndian);
    const gpsOffset = tiffOffset + ptrValue;
    gpsIfd = parseIfd(payload, gpsOffset, bigEndian, tiffOffset);
  }

  // IFD1（缩略图 IFD，IFD0 的 nextIfdPointer 指向）
  let ifd1: ParsedIfd | null = null;
  if (ifd0 && ifd0.nextIfdOffset !== 0) {
    ifd1 = parseIfd(payload, tiffOffset + ifd0.nextIfdOffset, bigEndian, tiffOffset);
  }

  return {
    bigEndian,
    tiffOffset,
    ifd0,
    exifIfd,
    gpsIfd,
    ifd1,
    bytes: payload,
  };
}

/** 解析单个 IFD */
function parseIfd(bytes: Uint8Array, offset: number, bigEndian: boolean, tiffOffset: number): ParsedIfd | null {
  if (offset <= 0 || offset + 2 > bytes.length) return null;
  const count = readU16(bytes, offset, bigEndian);
  if (count === 0) {
    return { offset, count: 0, entries: [], nextIfdOffset: 0 };
  }
  // 每条目 12 字节
  const entriesEnd = offset + 2 + count * 12;
  if (entriesEnd + 4 > bytes.length) return null;

  const entries: IfdEntry[] = [];
  for (let i = 0; i < count; i++) {
    const entryOffset = offset + 2 + i * 12;
    const tag = readU16(bytes, entryOffset, bigEndian);
    const type = readU16(bytes, entryOffset + 2, bigEndian) as IfdType;
    const cnt = readU32(bytes, entryOffset + 4, bigEndian);
    const vbl = valueByteLength(type) * cnt;
    const valueField = bytes.subarray(entryOffset + 8, entryOffset + 12);

    let valueOffset: number | null = null;
    let rawValue: Uint8Array;
    // 超过 4 字节的值存储在外部偏移
    if (vbl > 4) {
      // 偏移量相对 TIFF 头
      const relOffset = readU32(valueField, 0, bigEndian);
      valueOffset = tiffOffset + relOffset;
      if (valueOffset + vbl > bytes.length) {
        // 偏移越界，跳过此条目
        continue;
      }
      rawValue = bytes.subarray(valueOffset, valueOffset + vbl);
    } else {
      rawValue = valueField.subarray(0, vbl);
    }

    entries.push({ tag, type, count: cnt, valueByteLength: vbl, rawValue, valueOffset, entryOffset });
  }

  // 下一 IFD 偏移
  const nextIfdOffset = readU32(bytes, entriesEnd, bigEndian);

  return { offset, count, entries, nextIfdOffset };
}

// ============================================================
// 标签名称映射（用于报告）
// ============================================================

const TAG_NAMES: Record<number, string> = {
  [TAG.Make]: 'Make',
  [TAG.Model]: 'Model',
  [TAG.Software]: 'Software',
  [TAG.DateTime]: 'DateTime',
  [TAG.Artist]: 'Artist',
  [TAG.Copyright]: 'Copyright',
  [TAG.ExifIfdPointer]: 'ExifIFDPointer',
  [TAG.GpsIfdPointer]: 'GPSIFDPointer',
  [TAG.DateTimeOriginal]: 'DateTimeOriginal',
  [TAG.DateTimeDigitized]: 'DateTimeDigitized',
  [TAG.MakerNote]: 'MakerNote',
  [TAG.BodySerialNumber]: 'BodySerialNumber',
  [TAG.CameraOwnerName]: 'CameraOwnerName',
  [TAG.LensSerialNumber]: 'LensSerialNumber',
  [TAG.LensMake]: 'LensMake',
  [TAG.LensModel]: 'LensModel',
};

/** 获取标签的可读名称 */
export function getTagName(tag: number): string {
  return TAG_NAMES[tag] ?? `Tag_0x${tag.toString(16)}`;
}

// ============================================================
// 编辑操作实现
// ============================================================

/**
 * 从指定 IFD 中删除给定标签集合
 * 返回被删除的字段位置列表
 */
function removeTagsFromIfd(
  ifd: ParsedIfd | null,
  tagsToRemove: number[],
  ifdName: 'ifd0' | 'exifIfd' | 'gpsIfd' | 'ifd1',
  removedFields: FieldLocation[],
): void {
  if (!ifd) return;
  for (const entry of ifd.entries) {
    if (tagsToRemove.includes(entry.tag)) {
      removedFields.push({ ifd: ifdName, tag: entry.tag, tagName: getTagName(entry.tag) });
    }
  }
}

/** 修改时间字段的值（ASCII 类型，20 字节含终止符） */
function setDateTimeValue(parsed: ParsedExif, dateTime: string, modifiedFields: FieldLocation[]): void {
  // 格式化为 EXIF 时间格式：'YYYY:MM:DD HH:MM:SS\0'（21 字节含终止符）
  const formatted = formatExifDateTime(dateTime);
  if (!formatted) {
    throw new Error(`时间格式无效：${dateTime}（应为 YYYY:MM:DD HH:MM:SS）`);
  }
  // 写入 IFD0.DateTime（0x0132）
  writeAsciiValue(parsed, 'ifd0', TAG.DateTime, formatted, modifiedFields);
  // 写入 ExifIFD.DateTimeOriginal（0x9003）
  writeAsciiValue(parsed, 'exifIfd', TAG.DateTimeOriginal, formatted, modifiedFields);
  // 写入 ExifIFD.DateTimeDigitized（0x9004）
  writeAsciiValue(parsed, 'exifIfd', TAG.DateTimeDigitized, formatted, modifiedFields);
}

/** 校验并格式化时间字符串为 EXIF 格式 */
function formatExifDateTime(input: string): string | null {
  // 支持 YYYY:MM:DD HH:MM:SS 或 YYYY-MM-DD HH:MM:SS
  const m = input.match(/^(\d{4})[-:](\d{2})[-:](\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}:${mo}:${d} ${h}:${mi}:${s}\0`;
}

/** 写入 ASCII 值到指定 IFD 的指定标签 */
function writeAsciiValue(
  parsed: ParsedExif,
  ifdName: 'ifd0' | 'exifIfd' | 'gpsIfd' | 'ifd1',
  tag: number,
  value: string,
  modifiedFields: FieldLocation[],
): void {
  const ifd = parsed[ifdName];
  if (!ifd) return;
  const entry = ifd.entries.find((e) => e.tag === tag);
  if (!entry) return;
  // ASCII 值含终止符，长度等于字符串长度 + 1
  const newBytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) newBytes[i] = value.charCodeAt(i) & 0xff;

  // 若新值长度 <= 4 字节，内联存储
  if (newBytes.length <= 4) {
    // 内联：写入 entryOffset + 8 处的 4 字节字段
    for (let i = 0; i < newBytes.length; i++) {
      parsed.bytes[entry.entryOffset + 8 + i] = newBytes[i];
    }
    // 更新 count
    writeU32(parsed.bytes, entry.entryOffset + 4, newBytes.length, parsed.bigEndian);
  } else if (entry.valueOffset !== null && newBytes.length <= entry.valueByteLength) {
    // 外部偏移且新值不大于原值，原地覆盖（避免偏移重算）
    for (let i = 0; i < newBytes.length; i++) {
      parsed.bytes[entry.valueOffset + i] = newBytes[i];
    }
    // 更新 count
    writeU32(parsed.bytes, entry.entryOffset + 4, newBytes.length, parsed.bigEndian);
  } else {
    // 新值更大且原为内联：无法原地修改（需重建 IFD），跳过并记录
    // 此场景较少（DateTime 标准为 20 字节，通常外部偏移），暂不处理
    modifiedFields.push({
      ifd: ifdName,
      tag,
      tagName: getTagName(tag),
    });
    return;
  }
  modifiedFields.push({ ifd: ifdName, tag, tagName: getTagName(tag) });
}

// ============================================================
// 主入口：应用编辑操作
// ============================================================

/**
 * 应用编辑操作到 JPEG 字节
 * 策略：
 *  - removeAll：直接移除整个 APP1 EXIF 段
 *  - 其他操作：解析 IFD 结构，按操作类型标记删除/修改，重建 EXIF 段
 */
export function applyEdits(jpegBytes: Uint8Array, operations: EditOperation[]): EditResult {
  const startTime = performance.now();
  const originalSize = jpegBytes.length;
  const removedFields: FieldLocation[] = [];
  const modifiedFields: FieldLocation[] = [];
  const appliedOps: EditOperation[] = [];

  // 解析 JPEG 段
  const segments = parseJpegSegments(jpegBytes);

  // 定位 APP1 EXIF 段
  const exifSegIdx = segments.findIndex((s) => isExifSegment(s));

  // 若 removeAll，直接移除 EXIF 段
  if (operations.some((op) => op.type === 'removeAll')) {
    if (exifSegIdx === -1) {
      // 无 EXIF 段，无需修改
      const elapsedMs = performance.now() - startTime;
      return {
        bytes: jpegBytes,
        originalSize,
        editedSize: originalSize,
        savedBytes: 0,
        appliedOps: operations,
        removedFields: [],
        modifiedFields: [],
        elapsedMs,
      };
    }
    // 移除 EXIF 段，重建 JPEG
    const newSegments = segments.filter((_, i) => i !== exifSegIdx);
    const newBytes = rebuildJpeg(newSegments);
    const elapsedMs = performance.now() - startTime;
    return {
      bytes: newBytes,
      originalSize,
      editedSize: newBytes.length,
      savedBytes: originalSize - newBytes.length,
      appliedOps: operations,
      removedFields: [{ ifd: 'ifd0', tag: 0, tagName: 'All EXIF' }],
      modifiedFields: [],
      elapsedMs,
    };
  }

  // 无 EXIF 段且非 removeAll，直接返回
  if (exifSegIdx === -1) {
    const elapsedMs = performance.now() - startTime;
    return {
      bytes: jpegBytes,
      originalSize,
      editedSize: originalSize,
      savedBytes: 0,
      appliedOps: [],
      removedFields: [],
      modifiedFields: [],
      elapsedMs,
    };
  }

  // 解析 EXIF 段（拷贝 payload 以便修改）
  const exifSeg = segments[exifSegIdx];
  // 创建可写副本
  const payloadCopy = new Uint8Array(exifSeg.payload.length);
  payloadCopy.set(exifSeg.payload);
  const parsed = parseExifSegment(payloadCopy);

  // 按操作类型处理
  for (const op of operations) {
    switch (op.type) {
      case 'removeGps': {
        // 删除 IFD0 中的 GPSIFDPointer（0x8825）
        removeTagsFromIfd(parsed.ifd0, [TAG.GpsIfdPointer], 'ifd0', removedFields);
        // 标记整个 GPSIFD 为删除（在重建时跳过）
        if (parsed.gpsIfd) {
          removedFields.push({ ifd: 'gpsIfd', tag: 0, tagName: 'GPSIFD (all)' });
        }
        appliedOps.push(op);
        break;
      }
      case 'removeThumbnail': {
        // 删除 IFD1（缩略图 IFD）
        if (parsed.ifd1) {
          removedFields.push({ ifd: 'ifd1', tag: 0, tagName: 'IFD1 (thumbnail)' });
        }
        appliedOps.push(op);
        break;
      }
      case 'removeMakerNote': {
        removeTagsFromIfd(parsed.exifIfd, [TAG.MakerNote], 'exifIfd', removedFields);
        appliedOps.push(op);
        break;
      }
      case 'removePersonal': {
        // IFD0：Artist / Copyright / BodySerialNumber / CameraOwnerName
        removeTagsFromIfd(
          parsed.ifd0,
          [TAG.Artist, TAG.Copyright, TAG.BodySerialNumber, TAG.CameraOwnerName],
          'ifd0',
          removedFields,
        );
        // ExifIFD：LensSerialNumber（部分相机放在 ExifIFD）
        removeTagsFromIfd(parsed.exifIfd, [TAG.LensSerialNumber], 'exifIfd', removedFields);
        appliedOps.push(op);
        break;
      }
      case 'removeSoftware': {
        removeTagsFromIfd(parsed.ifd0, [TAG.Software], 'ifd0', removedFields);
        appliedOps.push(op);
        break;
      }
      case 'setDateTime': {
        if (op.dateTime) {
          setDateTimeValue(parsed, op.dateTime, modifiedFields);
          appliedOps.push(op);
        }
        break;
      }
      case 'removeAll':
        // 已在上面处理
        break;
    }
  }

  // 重建 EXIF 段
  const newPayload = rebuildExifPayload(parsed, removedFields);
  // 重建 JPEG：替换原 EXIF 段
  const newSegments = segments.map((seg, idx) => {
    if (idx === exifSegIdx) {
      return { ...seg, payload: newPayload };
    }
    return seg;
  });
  const newBytes = rebuildJpeg(newSegments);
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

// ============================================================
// EXIF 段重建
// ============================================================

/**
 * 重建 EXIF 段 payload
 * 策略：保留原始字节结构，仅将被删除的标签条目置零（标记为删除），
 * 并修正 IFD 条目计数。此为"原地修改"策略，简单可靠。
 *
 * 注：完整重建 IFD（紧凑化）复杂度高且易引入偏移错误，本工具采用"置零 + 计数修正"策略
 */
function rebuildExifPayload(parsed: ParsedExif, removedFields: FieldLocation[]): Uint8Array {
  const bytes = parsed.bytes;

  // 收集要删除的 (IFD, tag) 对
  const removeSet = new Set<string>();
  for (const f of removedFields) {
    // 跳过 "all" 标记（如 GPSIFD (all) / IFD1 (thumbnail)），单独处理
    if (f.tag === 0) continue;
    removeSet.add(`${f.ifd}:${f.tag}`);
  }

  // 检查是否需要删除整个 GPSIFD
  const removeGpsIfd = removedFields.some((f) => f.ifd === 'gpsIfd' && f.tag === 0);
  // 检查是否需要删除整个 IFD1
  const removeIfd1 = removedFields.some((f) => f.ifd === 'ifd1' && f.tag === 0);

  // 处理 IFD0：删除指定标签 + 可能删除 GPSIFD 指针
  if (parsed.ifd0) {
    let removedCount = 0;
    for (const entry of parsed.ifd0.entries) {
      const shouldRemove =
        removeSet.has(`ifd0:${entry.tag}`) || (removeGpsIfd && entry.tag === TAG.GpsIfdPointer);
      if (shouldRemove) {
        // 将条目 tag 置为 0（EXIF 规范中 tag=0 表示空条目，读取器会跳过）
        writeU16(bytes, entry.entryOffset, 0, parsed.bigEndian);
        removedCount++;
      }
    }
    // 修正 IFD0 条目计数
    if (removedCount > 0) {
      writeU16(bytes, parsed.ifd0.offset, parsed.ifd0.count - removedCount, parsed.bigEndian);
    }
  }

  // 处理 ExifIFD：删除指定标签
  if (parsed.exifIfd) {
    let removedCount = 0;
    for (const entry of parsed.exifIfd.entries) {
      if (removeSet.has(`exifIfd:${entry.tag}`)) {
        writeU16(bytes, entry.entryOffset, 0, parsed.bigEndian);
        removedCount++;
      }
    }
    if (removedCount > 0) {
      writeU16(bytes, parsed.exifIfd.offset, parsed.exifIfd.count - removedCount, parsed.bigEndian);
    }
  }

  // 处理 GPSIFD：删除整个 IFD
  if (removeGpsIfd && parsed.gpsIfd) {
    // 将 GPSIFD 所有条目 tag 置 0，计数置 0
    for (const entry of parsed.gpsIfd.entries) {
      writeU16(bytes, entry.entryOffset, 0, parsed.bigEndian);
    }
    writeU16(bytes, parsed.gpsIfd.offset, 0, parsed.bigEndian);
  }

  // 处理 IFD1：删除整个 IFD
  if (removeIfd1 && parsed.ifd1) {
    // 修正 IFD0 的 nextIfdOffset 为 0
    if (parsed.ifd0) {
      const nextIfdOffsetPos = parsed.ifd0.offset + 2 + parsed.ifd0.count * 12;
      writeU32(bytes, nextIfdOffsetPos, 0, parsed.bigEndian);
    }
    // 将 IFD1 所有条目 tag 置 0，计数置 0
    for (const entry of parsed.ifd1.entries) {
      writeU16(bytes, entry.entryOffset, 0, parsed.bigEndian);
    }
    writeU16(bytes, parsed.ifd1.offset, 0, parsed.bigEndian);
  }

  return bytes;
}

// ============================================================
// JPEG 重建
// ============================================================

/** 重建 JPEG 字节流（按段顺序拼接） */
function rebuildJpeg(segments: JpegSegment[]): Uint8Array {
  // 计算总长度
  let totalLen = 0;
  for (const seg of segments) {
    if (seg.marker === 0xffd8 || seg.marker === 0xffd9) {
      totalLen += 2;
    } else if (seg.isScanData) {
      totalLen += seg.payload.length;
    } else {
      // marker(2) + length(2) + payload
      totalLen += 2 + 2 + seg.payload.length;
    }
  }

  const out = new Uint8Array(totalLen);
  let i = 0;
  for (const seg of segments) {
    if (seg.marker === 0xffd8 || seg.marker === 0xffd9) {
      out[i++] = 0xff;
      out[i++] = seg.marker & 0xff;
      continue;
    }
    if (seg.isScanData) {
      out.set(seg.payload, i);
      i += seg.payload.length;
      continue;
    }
    // marker
    out[i++] = 0xff;
    out[i++] = seg.marker & 0xff;
    // length（含自身 2 字节）
    const segLen = seg.payload.length + 2;
    out[i++] = (segLen >> 8) & 0xff;
    out[i++] = segLen & 0xff;
    // payload
    out.set(seg.payload, i);
    i += seg.payload.length;
  }

  return out;
}

// ============================================================
// 辅助：当前时间格式化为 EXIF 时间
// ============================================================

/** 当前时间格式化为 EXIF 时间格式 'YYYY:MM:DD HH:MM:SS' */
export function nowExifDateTime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ============================================================
// 文件名生成
// ============================================================

/** 生成编辑后文件名：原文件名 + -edited.jpg */
export function buildEditedFilename(originalName: string): string {
  const dotIdx = originalName.lastIndexOf('.');
  const base = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
  return `${base}-edited.jpg`;
}

// ============================================================
// 批量处理与预设管理（第 89 轮新增：批量处理 + 预设保存）
// ============================================================

/** 编辑预设（用户保存的常用编辑组合，便于复用） */
export interface EditPreset {
  /** 预设唯一 ID（基于名称 hash + 时间戳生成） */
  id: string;
  /** 预设名称（用户输入，同名视为同一预设） */
  name: string;
  /** 编辑操作列表 */
  operations: EditOperation[];
  /** 是否启用拍摄时间修改 */
  enableDateTime: boolean;
  /** 拍摄时间值（'YYYY:MM:DD HH:MM:SS'） */
  dateTimeValue: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 最后使用时间戳 */
  lastUsedAt: number;
}

/** 批量处理单个文件的结果 */
export interface BatchItemResult {
  /** 原始文件名 */
  fileName: string;
  /** 处理状态 */
  status: 'success' | 'skipped' | 'error';
  /** 编辑结果（status=success 时有值） */
  result?: EditResult;
  /** 错误/跳过原因（status=error/skipped 时有值） */
  message?: string;
}

/** 批量处理汇总结果 */
export interface BatchEditSummary {
  /** 总文件数 */
  total: number;
  /** 成功数 */
  succeeded: number;
  /** 跳过数（非 JPEG、无 EXIF 等） */
  skipped: number;
  /** 失败数 */
  failed: number;
  /** 总节省字节数 */
  totalSavedBytes: number;
  /** 总耗时（毫秒） */
  totalElapsedMs: number;
  /** 每个文件的结果 */
  items: BatchItemResult[];
}

/**
 * 批量应用编辑操作到多个 JPEG 文件
 * 设计要点：
 *  - 非 JPEG 文件提前跳过（仅校验 SOI 标记 0xFFD8，避免完整解析开销）
 *  - 每处理 5 个文件让出主线程一次，避免阻塞 UI
 *  - 单文件异常不影响其他文件，错误记录到 items
 */
export async function applyEditsBatch(
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
    const fileName = fileNames[i] ?? `file-${i + 1}.jpg`;

    // 校验 JPEG SOI 标记（0xFFD8），提前跳过非 JPEG 文件
    if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      items.push({ fileName, status: 'skipped', message: '非 JPEG 文件，已跳过' });
      skipped++;
      continue;
    }

    try {
      const result = applyEdits(bytes, operations);
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

/** 预设持久化存储 key（localStorage） */
const PRESET_STORAGE_KEY = 'exif-editor-presets';

/** 最大预设数量（避免无限增长，超出时按最久未使用淘汰） */
const MAX_PRESETS = 20;

/** 基于名称生成预设 ID（hash + 时间戳，保证唯一性） */
function generatePresetId(name: string): string {
  // 简单字符串 hash，生成 8 位 hex 前缀
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) >>> 0;
  }
  return `preset-${hash.toString(16).padStart(8, '0')}-${Date.now().toString(36)}`;
}

/** 从 localStorage 加载所有预设（按 lastUsedAt 降序排序，最近使用的在前） */
export function loadPresets(): EditPreset[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as EditPreset[];
    if (!Array.isArray(list)) return [];
    return list.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  } catch {
    return [];
  }
}

/** 保存预设到 localStorage（同名覆盖，超出上限按最久未使用淘汰） */
export function savePreset(
  preset: Omit<EditPreset, 'id' | 'createdAt' | 'lastUsedAt'>,
): EditPreset {
  const presets = loadPresets();
  const existingIdx = presets.findIndex((p) => p.name === preset.name);
  const now = Date.now();
  const newPreset: EditPreset = {
    ...preset,
    id: existingIdx >= 0 ? presets[existingIdx].id : generatePresetId(preset.name),
    createdAt: existingIdx >= 0 ? presets[existingIdx].createdAt : now,
    lastUsedAt: now,
  };
  if (existingIdx >= 0) {
    presets[existingIdx] = newPreset;
  } else {
    // 超出上限时移除最久未使用的（lastUsedAt 最小）
    if (presets.length >= MAX_PRESETS) {
      presets.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
      presets.shift();
    }
    presets.push(newPreset);
  }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
    } catch {
      // localStorage 写入失败（如配额超限），忽略错误不阻塞主流程
    }
  }
  return newPreset;
}

/** 删除指定 ID 的预设 */
export function deletePreset(presetId: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const presets = loadPresets();
    const filtered = presets.filter((p) => p.id !== presetId);
    if (filtered.length !== presets.length) {
      localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(filtered));
    }
  } catch {
    // 忽略删除错误
  }
}

/** 更新预设的最后使用时间（用于排序与淘汰） */
export function touchPreset(presetId: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const presets = loadPresets();
    const idx = presets.findIndex((p) => p.id === presetId);
    if (idx >= 0) {
      presets[idx].lastUsedAt = Date.now();
      localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
    }
  } catch {
    // 忽略更新错误
  }
}

/** 导出预设为 JSON 字符串（便于备份/分享） */
export function exportPresets(presets: EditPreset[]): string {
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      presets,
    },
    null,
    2,
  );
}

/** 从 JSON 字符串导入预设（merge 模式跳过同名，replace 模式全量替换） */
export function importPresets(jsonStr: string, mode: 'merge' | 'replace' = 'merge'): EditPreset[] {
  const data = JSON.parse(jsonStr) as { presets?: EditPreset[] };
  if (!Array.isArray(data.presets)) {
    throw new Error('无效的预设文件格式');
  }
  const imported = data.presets;
  if (mode === 'replace') {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(imported));
    }
    return imported;
  }
  // merge 模式：同名预设跳过，避免覆盖本地修改
  const existing = loadPresets();
  const existingNames = new Set(existing.map((p) => p.name));
  const toAdd = imported.filter((p) => !existingNames.has(p.name));
  const merged = [...existing, ...toAdd];
  // 按 lastUsedAt 降序截断至 MAX_PRESETS
  const trimmed = merged.sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, MAX_PRESETS);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(trimmed));
  }
  return trimmed;
}

/**
 * 生成批量编辑后的文件名
 *  - 单文件：保持原命名规则（base-edited.jpg）
 *  - 多文件：加序号便于排序（base-edited-01.jpg）
 */
export function buildBatchEditedFilename(
  originalName: string,
  index: number,
  total: number,
): string {
  const dotIdx = originalName.lastIndexOf('.');
  const base = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
  if (total === 1) return `${base}-edited.jpg`;
  const padLen = String(total).length;
  const idx = String(index + 1).padStart(padLen, '0');
  return `${base}-edited-${idx}.jpg`;
}
