/**
 * Base64 图片互转核心工具函数
 *
 * 仅包含纯函数：格式化、解析、映射。
 * 浏览器相关 API（FileReader / Canvas / Image）在组件中调用，
 * 便于按需复用与单测。
 *
 * 主要能力：
 *  - formatBytes：字节数转可读字符串（如 12.34 KB）
 *  - parseDataUrl：解析 data: URL，提取 MIME 与 Base64 部分
 *  - extFromMime / mimeFromExt：MIME 与扩展名互转
 *  - buildDataUrl：由 MIME 与 Base64 拼接 data: URL
 *  - sniffMimeFromBase64：根据 Base64 头部签名嗅探图片 MIME
 */

export interface ParsedDataUrl {
  mime: string;
  base64: string;
}

/** MIME 类型 → 扩展名映射（覆盖常见图片格式） */
const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/avif': 'avif',
  'image/tiff': 'tiff',
};

/** 扩展名 → MIME 类型映射（反向查找） */
const EXT_TO_MIME: Record<string, string> = Object.entries(MIME_TO_EXT).reduce(
  (acc, [mime, ext]) => {
    // 保留第一个出现的扩展名映射，避免 jpg 覆盖
    if (!(ext in acc)) acc[ext] = mime;
    return acc;
  },
  {} as Record<string, string>,
);

/** 字节数格式化为可读字符串，自动选择 B/KB/MB/GB 单位 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let val = bytes / 1024;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(2)} ${units[idx]}`;
}

/** MIME 类型 → 文件扩展名，未知返回 bin */
export function extFromMime(mime: string): string {
  return MIME_TO_EXT[mime.toLowerCase()] || 'bin';
}

/** 文件扩展名 → MIME 类型，未知返回 application/octet-stream */
export function mimeFromExt(ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, '');
  return EXT_TO_MIME[e] || 'application/octet-stream';
}

/**
 * 解析 data: URL，提取 MIME 与 Base64 部分
 * 仅匹配 data:image/...;base64,... 格式
 * 非图片或不合法返回 null
 */
export function parseDataUrl(input: string): ParsedDataUrl | null {
  const trimmed = input.trim();
  // 严格匹配 data:[<mediatype>][;base64],<data>
  const m = trimmed.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/s);
  if (!m) return null;
  const mime = (m[1] || 'image/png').toLowerCase();
  const base64 = m[2];
  if (!base64) return null;
  // 仅接受图片类 MIME
  if (!mime.startsWith('image/')) return null;
  return { mime, base64 };
}

/** 由 MIME 与 Base64 拼接 data: URL */
export function buildDataUrl(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`;
}

/**
 * 根据 Base64 头部签名嗅探图片 MIME
 * 用于纯 Base64 输入（无 data: 前缀）时自动识别格式
 * 返回识别到的 MIME，无法识别返回 null
 */
export function sniffMimeFromBase64(base64: string): string | null {
  const b = base64.trim();
  // 各图片格式的 Base64 前缀签名
  if (b.startsWith('/9j/')) return 'image/jpeg';
  if (b.startsWith('iVBORw')) return 'image/png';
  if (b.startsWith('R0lGOD')) return 'image/gif';
  if (b.startsWith('UklGR')) return 'image/webp';
  if (b.startsWith('Qk')) return 'image/bmp';
  if (b.startsWith('PHN2Zw')) return 'image/svg+xml'; // SVG 通常以 <svg 开头
  return null;
}

/**
 * 校验字符串是否为合法 Base64
 * 允许包含 = 填充，长度为 4 的倍数（自动补齐后校验）
 */
export function isValidBase64(input: string): boolean {
  const b = input.trim().replace(/\s+/g, '');
  if (!b) return false;
  const pad = b.length % 4;
  const padded = pad === 0 ? b : b + '='.repeat(4 - pad);
  // 标准 Base64 字符集（含 URL 安全变体 - _）
  return /^[A-Za-z0-9+/_-]+={0,2}$/.test(padded);
}

/** 常用图片 MIME 列表（用于格式转换下拉选项） */
export const IMAGE_MIME_LIST = [
  { mime: 'image/png', label: 'PNG（无损，支持透明）' },
  { mime: 'image/jpeg', label: 'JPEG（有损，体积小）' },
  { mime: 'image/webp', label: 'WebP（现代格式，体积更小）' },
];
