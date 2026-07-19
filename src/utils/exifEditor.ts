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
// PNG 元数据处理（第 106 轮新增）
// ============================================================
//
// PNG 文件结构与 JPEG 不同：
//  - 8 字节签名（89 50 4E 47 0D 0A 1A 0A）
//  - 后跟多个 chunk：长度(4 BE) + 类型(4 ASCII) + 数据 + CRC(4)
//  - 关键 chunk：IHDR / PLTE / IDAT / IEND（不可删除）
//  - 辅助 chunk：tEXt / zTXt / iTXt / tIME / eXIf / bKGD / pHYs 等
//
// PNG 元数据存储位置：
//  - tEXt：关键字 + \0 + 文本（Latin1），如 "Author"、"Copyright"、"Software"、"Title"
//  - zTXt：压缩文本（zlib 压缩，本工具使用 DecompressionStream 自动解压）
//  - iTXt：国际化文本（UTF-8，可压缩，含语言标签；本工具支持未压缩与 zlib 压缩两种）
//  - tIME：最后修改时间（7 字节：year2 + month1 + day1 + hour1 + minute1 + second1）
//  - eXIf：EXIF 数据（PNG 1.5+ 扩展，结构同 JPEG 的 APP1 EXIF payload）
//
// 本工具的 PNG 操作映射（与 JPEG 操作语义对齐）：
//  - removeAll：删除所有元数据 chunk（tEXt / zTXt / iTXt / tIME / eXIf）
//  - removePersonal：删除 tEXt/zTXt/iTXt 中关键字为 Author/Copyright/Artist 等的条目
//  - removeSoftware：删除 tEXt/zTXt/iTXt 中关键字为 Software 的条目
//  - setDateTime：修改或新增 tIME chunk
//  - removeGps / removeMakerNote / removeThumbnail：PNG 不适用（UI 中隐藏）

/** PNG 8 字节签名 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

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

/** 判断是否为 PNG 文件（基于 8 字节签名） */
export function isPngFile(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

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

/** PNG tEXt/iTXt 条目解析结果 */
export interface PngTextEntry {
  /** 关键字（1-79 字节 ASCII） */
  keyword: string;
  /** 文本内容 */
  text: string;
}

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

/** PNG tIME chunk 解析结果 */
export interface PngTimeEntry {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * 解析 tIME chunk 数据
 * 格式：year(2 BE) + month(1) + day(1) + hour(1) + minute(1) + second(1) = 7 字节
 */
export function parseTimeChunk(data: Uint8Array): PngTimeEntry | null {
  if (data.length < 7) return null;
  return {
    year: (data[0] << 8) | data[1],
    month: data[2],
    day: data[3],
    hour: data[4],
    minute: data[5],
    second: data[6],
  };
}

/** 将 PngTimeEntry 格式化为 'YYYY:MM:DD HH:MM:SS'（与 EXIF 时间格式一致，便于复用 UI） */
export function formatPngTime(time: PngTimeEntry): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${time.year}:${pad(time.month)}:${pad(time.day)} ${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}`;
}

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
   * 第 109 轮新增：用于辅助 chunk 行展开后的 hex dump 展示
   * 关键 chunk（IHDR/PLTE/IDAT/IEND）也保留 data，但 UI 不提供展开能力
   */
  data: Uint8Array;
}

/** Hex dump 单行结构（第 109 轮新增） */
export interface HexDumpLine {
  /** 行起始偏移（hex 字符串，8 位） */
  offset: string;
  /** 16 字节的 hex 字符串（每组 8 字节，组间空格分隔） */
  hex: string;
  /** 16 字节的 ASCII 表示（不可打印字符用 . 替换） */
  ascii: string;
}

/** Hex dump 结果（第 109 轮新增） */
export interface HexDumpResult {
  /** hex dump 行列表 */
  lines: HexDumpLine[];
  /** 是否被截断（原始字节数超过 maxBytes） */
  truncated: boolean;
  /** 原始字节数 */
  totalBytes: number;
  /** 实际展示的字节数 */
  shownBytes: number;
}

/** Hex dump 默认截断阈值（1024 字节，超过则仅显示前 1024 字节） */
export const HEX_DUMP_MAX_BYTES = 1024;

/**
 * 将字节数组格式化为标准 hex dump（第 109 轮新增）
 * 每行 16 字节，分为两组 8 字节，格式：
 *   00000000  48 65 6C 6C 6F 20 57 6F  72 6C 64 21 0A 00 00 00  Hello Wo rld!....
 *
 * @param data 字节数组（Uint8Array view 即可，不复制）
 * @param maxBytes 最大展示字节数（默认 1024，超出截断）
 * @returns HexDumpResult，包含行列表与截断信息
 */
export function formatHexDump(data: Uint8Array, maxBytes: number = HEX_DUMP_MAX_BYTES): HexDumpResult {
  const totalBytes = data.length;
  const shownBytes = Math.min(totalBytes, maxBytes);
  const truncated = totalBytes > maxBytes;
  const lines: HexDumpLine[] = [];

  for (let i = 0; i < shownBytes; i += 16) {
    const lineLen = Math.min(16, shownBytes - i);
    const hexParts: string[] = [];
    const asciiParts: string[] = [];

    // 分为两组 8 字节，组间额外空格
    for (let g = 0; g < 2; g++) {
      const groupParts: string[] = [];
      const start = i + g * 8;
      for (let j = 0; j < 8; j++) {
        const idx = start + j;
        if (idx < i + lineLen) {
          const byte = data[idx];
          groupParts.push(byte.toString(16).padStart(2, '0').toUpperCase());
          // ASCII 部分：可打印字符（0x20-0x7E）原样，否则用 .
          asciiParts.push(byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.');
        } else {
          // 不足 16 字节的最后一行，hex 用空格占位保持对齐
          groupParts.push('  ');
          asciiParts.push(' ');
        }
      }
      hexParts.push(groupParts.join(' '));
    }

    lines.push({
      offset: i.toString(16).padStart(8, '0').toUpperCase(),
      hex: hexParts.join('  '),
      ascii: asciiParts.join(''),
    });
  }

  return { lines, truncated, totalBytes, shownBytes };
}

/** PNG 元数据快照（与 JPEG MetaSnapshot 兼容格式，便于复用 UI 组件） */
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

/** 关键 chunk 分类集合（用于判断 isCritical） */
const PNG_CRITICAL_CATEGORIES = new Set<PngChunkCategory>([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
]);

/** 仅解析 zTXt 的关键字（不解压），用于编辑时按关键字过滤 */
function readZTxtKeyword(data: Uint8Array): string {
  const nullIdx = data.indexOf(0);
  if (nullIdx < 0) return '';
  return new TextDecoder('latin1').decode(data.subarray(0, nullIdx)).trim();
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
      // data 为 subarray view，不复制底层 buffer（第 109 轮新增，用于 hex dump 展示）
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

/** 截断文本用于 UI 摘要展示，避免过长 chunk 文本占据过多空间 */
function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…';
}

/** PNG 编辑操作适用的关键字集合（用于 removePersonal / removeSoftware） */
const PNG_PERSONAL_KEYWORDS = new Set([
  'Author',
  'Artist',
  'Copyright',
  'Creation Time',
  'Source',
  'Comment',
]);
const PNG_SOFTWARE_KEYWORDS = new Set(['Software']);

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

// ============================================================
// WebP 元数据处理（第 112 轮新增）
// ============================================================
//
// WebP 文件结构（基于 RIFF 容器）：
//  - 12 字节文件头：'RIFF' (4) + 文件大小 (4 LE) + 'WEBP' (4)
//  - 后续 chunk：类型(4 ASCII) + 数据长度(4 LE) + 数据 + (奇数长度补 1 字节 0x00)
//  - 关键 chunk：'VP8 ' (lossy) / 'VP8L' (lossless) / 'VP8X' (extended) / 'ALPH' / 'ANIM' / 'ANMF'
//  - 辅助 chunk：'EXIF' / 'XMP ' / 'ICCP'
//
// WebP EXIF chunk 数据格式：
//  - 规范要求以 "Exif\0\0" 开头（与 JPEG APP1 payload 一致）
//  - 部分不规范文件可能直接以 TIFF 头开始（II/MM），本工具自动识别并补齐前缀
//  - 复用 parseExifSegment / rebuildExifPayload 处理 IFD 编辑
//
// 与 JPEG / PNG 的差异：
//  - WebP EXIF 数据结构与 JPEG APP1 payload 完全一致，可直接复用 IFD 编辑逻辑
//  - WebP chunk 无 CRC32 校验（与 PNG 不同），但需要重算 RIFF 文件大小字段
//  - WebP chunk 数据长度为奇数时需补 1 字节 0x00 padding（与 PNG 不同）
//
// 本工具的 WebP 操作映射（与 JPEG 操作语义完全对齐）：
//  - removeAll：删除 EXIF / XMP / ICCP chunk
//  - removeGps：从 EXIF chunk 中删除 GPSIFD
//  - removePersonal：从 EXIF chunk 中删除 Artist/Copyright/BodySerialNumber 等
//  - removeMakerNote：从 EXIF chunk 中删除 MakerNote
//  - removeThumbnail：从 EXIF chunk 中删除 IFD1
//  - removeSoftware：从 EXIF chunk 中删除 Software 标签
//  - setDateTime：修改 EXIF chunk 中的 DateTime/DateTimeOriginal/DateTimeDigitized

/** RIFF 容器魔数（'RIFF' 4 字节） */
const WEBP_RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46]; // 'RIFF'
/** WebP 类型标识（'WEBP' 4 字节，位于文件头偏移 8） */
const WEBP_TYPE_MAGIC = [0x57, 0x45, 0x42, 0x50]; // 'WEBP'
/** EXIF chunk 数据前缀（'Exif\0\0' 6 字节，与 JPEG APP1 payload 一致） */
const WEBP_EXIF_PREFIX = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // 'Exif\0\0'

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

/** 关键 chunk 分类集合（用于判断 isCritical） */
const WEBP_CRITICAL_CATEGORIES = new Set<WebpChunkCategory>([
  'VP8 ',
  'VP8L',
  'VP8X',
  'ALPH',
  'ANIM',
  'ANMF',
]);

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

/** 判断是否为 WebP 文件（基于 RIFF + WEBP 文件头） */
export function isWebpFile(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  // 前 4 字节 'RIFF'
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== WEBP_RIFF_MAGIC[i]) return false;
  }
  // 偏移 8-11 'WEBP'
  for (let i = 0; i < 4; i++) {
    if (bytes[8 + i] !== WEBP_TYPE_MAGIC[i]) return false;
  }
  return true;
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
