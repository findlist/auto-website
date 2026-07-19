/**
 * 零依赖 ZIP 写入器（STORE 模式，无压缩）
 *
 * 设计目标：
 *  - 完全基于浏览器原生 API（Uint8Array / DataView / Blob / TextEncoder），不引入第三方 ZIP 库
 *  - 仅实现 STORE 模式（无 DEFLATE），适用于已压缩数据（PNG / JPEG）或体量较小的文本归档
 *  - 输出兼容所有主流解压软件（Windows 资源管理器 / macOS Finder / Linux unzip）
 *
 * ZIP 格式实现要点：
 *  - 每个文件由「局部文件头 + 文件数据」组成，按顺序拼接
 *  - 所有文件写入完成后，追加「中央目录」+「中央目录结束记录（EOCD）」
 *  - 文件名使用 UTF-8 编码（通用标志位 11 置位）
 *  - 时间戳统一为 0（不设置修改时间），保持实现简洁
 *
 * 使用场景：
 *  - imageCompare.ts：批量对比差异图归档打包
 *  - metadataBundle.ts：图片元数据批量报告打包
 *
 * 复用约定：
 *  - 调用方负责数据编码（如 TextEncoder.encode / base64 解码），ZipWriter 仅处理字节
 *  - 调用方负责文件名安全（sanitizeFileName 已提供，复杂场景可自行实现）
 */

// ============================================================
// CRC32 校验
// ============================================================

/** CRC32 查找表（IEEE 802.3 多项式 0xedb88320，懒加载初始化） */
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      // 标准位运算：LSB 优先，多项式反向
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    // 显式无符号化，避免符号位扩展
    table[i] = c >>> 0;
  }
  return table;
})();

/**
 * 计算 Uint8Array 的 CRC32 校验码（IEEE 802.3）
 *
 * 标准算法：初始 0xffffffff，处理完每个字节后异或回 0xffffffff
 */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ============================================================
// ZipWriter
// ============================================================

/** ZIP 文件项（局部头 + 文件数据，用于构建中央目录） */
interface ZipEntry {
  /** 文件名（UTF-8 字节） */
  nameBytes: Uint8Array;
  /** 文件数据 */
  data: Uint8Array;
  /** CRC32 校验码 */
  crc: number;
  /** 局部头在整个 ZIP 中的偏移 */
  localOffset: number;
}

/**
 * 简易 ZIP 写入器（仅 STORE 模式，无压缩）
 *
 * 典型用法：
 * ```ts
 * const writer = new ZipWriter();
 * writer.addFile('a.txt', new TextEncoder().encode('hello'));
 * writer.addFile('b.json', new TextEncoder().encode('{}'));
 * const blob = writer.finish(); // 得到 application/zip Blob
 * ```
 */
export class ZipWriter {
  private entries: ZipEntry[] = [];
  private chunks: Uint8Array[] = [];
  private offset = 0;

  /** 添加文件到 ZIP */
  addFile(name: string, data: Uint8Array): void {
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(data);

    // 局部文件头（30 字节固定 + 文件名）
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(localHeader.buffer);
    dv.setUint32(0, 0x04034b50, true);          // 局部头签名
    dv.setUint16(4, 20, true);                  // 解压所需版本（2.0）
    dv.setUint16(6, 0x0800, true);              // 通用标志：位 11 = UTF-8 文件名
    dv.setUint16(8, 0, true);                   // 压缩方法：0 = STORE
    dv.setUint16(10, 0, true);                  // 文件修改时间（0 = 不设置）
    dv.setUint16(12, 0, true);                  // 文件修改日期（0 = 不设置）
    dv.setUint32(14, crc, true);                // CRC-32
    dv.setUint32(18, data.length, true);        // 压缩后大小
    dv.setUint32(22, data.length, true);        // 压缩前大小
    dv.setUint16(26, nameBytes.length, true);   // 文件名长度
    dv.setUint16(28, 0, true);                  // 额外字段长度
    localHeader.set(nameBytes, 30);

    this.entries.push({
      nameBytes,
      data,
      crc,
      localOffset: this.offset,
    });

    this.chunks.push(localHeader);
    this.offset += localHeader.length;
    this.chunks.push(data);
    this.offset += data.length;
  }

  /** 完成 ZIP 构建，返回 Blob（application/zip） */
  finish(): Blob {
    // 中央目录：每个文件一项（46 字节固定 + 文件名）
    const centralChunks: Uint8Array[] = [];
    let centralSize = 0;
    for (const entry of this.entries) {
      const header = new Uint8Array(46 + entry.nameBytes.length);
      const dv = new DataView(header.buffer);
      dv.setUint32(0, 0x02014b50, true);            // 中央文件头签名
      dv.setUint16(4, 20, true);                    // 版本由
      dv.setUint16(6, 20, true);                    // 解压所需版本
      dv.setUint16(8, 0x0800, true);                // 通用标志：UTF-8
      dv.setUint16(10, 0, true);                    // 压缩方法：STORE
      dv.setUint16(12, 0, true);                    // 修改时间
      dv.setUint16(14, 0, true);                    // 修改日期
      dv.setUint32(16, entry.crc, true);            // CRC-32
      dv.setUint32(20, entry.data.length, true);    // 压缩后大小
      dv.setUint32(24, entry.data.length, true);    // 压缩前大小
      dv.setUint16(28, entry.nameBytes.length, true); // 文件名长度
      dv.setUint16(30, 0, true);                    // 额外字段长度
      dv.setUint16(32, 0, true);                    // 文件注释长度
      dv.setUint16(34, 0, true);                    // 磁盘号
      dv.setUint16(36, 0, true);                    // 内部属性
      dv.setUint32(38, 0, true);                    // 外部属性
      dv.setUint32(42, entry.localOffset, true);    // 局部头偏移
      header.set(entry.nameBytes, 46);
      centralChunks.push(header);
      centralSize += header.length;
    }

    // 中央目录结束记录（22 字节固定）
    const centralOffset = this.offset;
    const endRecord = new Uint8Array(22);
    const dv = new DataView(endRecord.buffer);
    dv.setUint32(0, 0x06054b50, true);              // EOCD 签名
    dv.setUint16(4, 0, true);                       // 磁盘号
    dv.setUint16(6, 0, true);                       // 中央目录起始磁盘号
    dv.setUint16(8, this.entries.length, true);     // 本磁盘上的条目数
    dv.setUint16(10, this.entries.length, true);    // 总条目数
    dv.setUint32(12, centralSize, true);            // 中央目录大小
    dv.setUint32(16, centralOffset, true);          // 中央目录偏移
    dv.setUint16(20, 0, true);                      // 注释长度

    // 显式取 .buffer 并断言为 ArrayBuffer，规避 TS 5.7 对 Uint8Array<ArrayBufferLike>
    // 不能直接作为 BlobPart 的严格检查（本工具中所有 Uint8Array 均基于 ArrayBuffer 创建）
    const parts: ArrayBuffer[] = [
      ...this.chunks,
      ...centralChunks,
      endRecord,
    ].map((chunk) => chunk.buffer as ArrayBuffer);
    return new Blob(parts, { type: 'application/zip' });
  }
}

// ============================================================
// 文件名安全
// ============================================================

/** 文件名中不允许的字符正则（跨平台安全） */
const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * 清理文件名：替换不安全字符为下划线，限制长度
 *
 * 替换字符：`\ / : * ? " < > |` 及控制字符（\x00-\x1f），原因：
 *  - Windows 不允许这些字符
 *  - macOS/Linux 虽允许但跨平台解压可能出错
 *  - 控制字符可能导致解压软件异常
 *
 * 空名兜底：清理后为空时使用 'unnamed'，避免 ZIP 文件名项为空导致解压失败
 */
export function sanitizeFileName(name: string, maxLen = 80): string {
  const cleaned = name.replace(UNSAFE_FILENAME_CHARS, '_').trim() || 'unnamed';
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}
