/**
 * 时区转换引擎
 *
 * 基于 Intl.DateTimeFormat 与浏览器内置 IANA 时区数据库实现，
 * 不引入任何第三方时区库（如 luxon / moment-timezone）。
 * 所有计算在浏览器本地完成，零网络依赖。
 */

/** 时区信息：某时区在某时刻的静态描述 */
export interface ZoneInfo {
  /** IANA 时区标识，如 Asia/Shanghai */
  id: string;
  /** 显示名，如「北京」 */
  label: string;
  /** 当前 UTC 偏移（分钟），已考虑夏令时 */
  offsetMinutes: number;
  /** 偏移标签，如 UTC+8、UTC-5、UTC+0 */
  offsetLabel: string;
  /** 是否处于夏令时 */
  isDst: boolean;
}

/** 转换结果：某时区下某时刻的完整时间表示 */
export interface ConversionResult {
  zone: ZoneInfo;
  /** 年月日时分秒组件 */
  parts: {
    year: number;
    month: number; // 1-12
    day: number;
    hour: number; // 0-23
    minute: number;
    second: number;
    weekday: string; // 如「周一」
  };
  /** 24 小时制字符串，如 2026-07-08 14:30:00 */
  local24: string;
  /** 12 小时制字符串，如 2026-07-08 02:30:00 PM */
  local12: string;
  /** 仅日期，如 2026-07-08 */
  dateStr: string;
  /** 仅时间，如 14:30 */
  timeStr: string;
  /** 带偏移的 ISO 8601 字符串，如 2026-07-08T14:30:00+08:00 */
  iso: string;
  /** Unix 秒级时间戳 */
  unix: number;
  /** Unix 毫秒级时间戳 */
  unixMs: number;
}

/**
 * 常用时区预设：当 Intl.supportedValuesOf 不可用时降级使用。
 * 按 region 分组，覆盖开发者最常用的时区。
 */
const FALLBACK_ZONES: Record<string, string[]> = {
  亚洲: [
    'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Seoul',
    'Asia/Singapore', 'Asia/Taipei', 'Asia/Bangkok', 'Asia/Kolkata',
    'Asia/Dubai', 'Asia/Karachi', 'Asia/Jakarta',
  ],
  欧洲: [
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
    'Europe/Rome', 'Europe/Amsterdam', 'Europe/Moscow', 'Europe/Istanbul',
  ],
  美洲: [
    'America/New_York', 'America/Chicago', 'America/Denver',
    'America/Los_Angeles', 'America/Toronto', 'America/Sao_Paulo',
    'America/Mexico_City', 'America/Vancouver',
  ],
  大洋洲: [
    'Australia/Sydney', 'Australia/Melbourne', 'Australia/Perth',
    'Pacific/Auckland', 'Pacific/Honolulu',
  ],
  非洲: [
    'Africa/Cairo', 'Africa/Lagos', 'Africa/Johannesburg', 'Africa/Nairobi',
  ],
  'UTC 与特殊': ['UTC'],
};

/**
 * 获取浏览器支持的所有时区列表。
 * 优先使用 Intl.supportedValuesOf（Chrome 99+/Edge 99+/Firefox 93+），
 * 不支持时降级到常用预设。
 */
export function listTimeZones(): Record<string, string[]> {
  // 部分旧浏览器无 supportedValuesOf，降级到预设
  const supported =
    typeof Intl !== 'undefined' &&
    typeof (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf === 'function'
      ? (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone')
      : null;

  if (!supported || supported.length === 0) {
    return { ...FALLBACK_ZONES };
  }

  // 按 region 前缀分组
  const groups: Record<string, string[]> = {};
  for (const id of supported) {
    const slash = id.indexOf('/');
    const region = slash > 0 ? id.slice(0, slash) : '其他';
    // 仅保留主要region，避免「其它」过于杂乱
    const groupName = ['Asia', 'Europe', 'America', 'Africa', 'Pacific', 'Australia', 'Antarctica', 'Atlantic', 'Indian', 'Arctic'].includes(region)
      ? regionToChinese(region)
      : '其他';
    (groups[groupName] ??= []).push(id);
  }
  // 确保 UTC 在列表中
  if (!groups['UTC 与特殊']) groups['UTC 与特殊'] = ['UTC'];
  return groups;
}

/** region 英文转中文分组名 */
function regionToChinese(region: string): string {
  const map: Record<string, string> = {
    Asia: '亚洲',
    Europe: '欧洲',
    America: '美洲',
    Africa: '非洲',
    Pacific: '太平洋',
    Australia: '大洋洲',
    Antarctica: '南极洲',
    Atlantic: '大西洋',
    Indian: '印度洋',
    Arctic: '北极',
  };
  return map[region] ?? '其他';
}

/**
 * 从 IANA 时区 ID 提取友好显示名。
 * 如 Asia/Shanghai →「上海」，UTC →「协调世界时」
 */
export function zoneLabel(id: string): string {
  if (id === 'UTC') return '协调世界时';
  const slash = id.lastIndexOf('/');
  return slash > 0 ? id.slice(slash + 1).replace(/_/g, ' ') : id.replace(/_/g, ' ');
}

/**
 * 获取某时区在某时刻的偏移与夏令时信息。
 * 通过比较「该时区格式化结果」与「UTC 格式化结果」推算偏移分钟数。
 */
export function getZoneInfo(zoneId: string, date: Date = new Date()): ZoneInfo {
  // 用两个不同月份的偏移判断是否使用夏令时：
  // 若该时区在 1 月与 7 月偏移不同，则使用 DST（北/南半球其一为夏令时）
  const offsetMinutes = offsetFor(zoneId, date);
  const isDst = isDstActive(zoneId, date);

  return {
    id: zoneId,
    label: zoneLabel(zoneId),
    offsetMinutes,
    offsetLabel: formatOffset(offsetMinutes),
    isDst,
  };
}

/**
 * 计算某时区在某时刻相对 UTC 的偏移分钟数。
 * 原理：用该时区格式化得到本地年月日时分，再与 UTC 的同一次刻度对比。
 */
function offsetFor(zoneId: string, date: Date): number {
  // 取该时区下的「年月日时分」组件
  const parts = getZoneParts(zoneId, date);
  if (!parts) return 0;

  // 用 UTC 组件构造一个 Date（按 UTC 解释），再与原 date 的毫秒差即偏移
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  // 偏移 = 本地时间 - UTC = asUtc - date.getTime()
  // 例：纽约 UTC-4，date=12:00 UTC 时本地为 08:00，asUtc=08:00 UTC 的毫秒，
  // asUtc - date = -4h = -240 分钟，即 UTC-4
  const diffMs = asUtc - date.getTime();
  // 四舍五入到分钟（DST 切换可能涉及秒级，但绝大多数时区以整小时/半小时为单位）
  return Math.round(diffMs / 60000);
}

/** 用 Intl.DateTimeFormat 获取某时区下的时间组件 */
function getZoneParts(
  zoneId: string,
  date: Date,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zoneId,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(date);
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    // hour12:false 在某些环境可能返回 "24"，规范化为 0
    let hour = parseInt(map.hour ?? '0', 10);
    if (hour === 24) hour = 0;
    return {
      year: parseInt(map.year ?? '0', 10),
      month: parseInt(map.month ?? '1', 10),
      day: parseInt(map.day ?? '1', 10),
      hour,
      minute: parseInt(map.minute ?? '0', 10),
      second: parseInt(map.second ?? '0', 10),
    };
  } catch {
    return null;
  }
}

/**
 * 判断某时区在某时刻是否处于夏令时。
 * 通过比较 1 月与 7 月的偏移：若不同则该时区使用 DST，
 * 再比较当前偏移与「标准偏移（取两者中较小者）」判断当前是否为夏令时。
 */
function isDstActive(zoneId: string, date: Date): boolean {
  const year = date.getUTCFullYear();
  const jan = new Date(Date.UTC(year, 0, 15, 12));
  const jul = new Date(Date.UTC(year, 6, 15, 12));
  const janOffset = offsetFor(zoneId, jan);
  const julOffset = offsetFor(zoneId, jul);
  // 两者相同则该时区不使用 DST
  if (janOffset === julOffset) return false;
  // 标准偏移取较小者：北半球标准时间更负（如 EST=-300 < EDT=-240），
  // 南半球标准时间更小（如 AEST=+600 < AEDT=+660），均成立。
  // 当前偏移 != 标准偏移 即视为处于夏令时
  const standard = Math.min(janOffset, julOffset);
  const current = offsetFor(zoneId, date);
  return current !== standard;
}

/** 将偏移分钟数格式化为 UTC+8 / UTC-5:30 标签 */
export function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m === 0 ? `UTC${sign}${h}` : `UTC${sign}${h}:${String(m).padStart(2, '0')}`;
}

/**
 * 将一个 Date 按指定时区完整转换为 ConversionResult。
 * 包含各格式化字符串、Unix 时间戳、ISO 8601 带偏移格式。
 */
export function convert(date: Date, zoneId: string): ConversionResult | null {
  const parts = getZoneParts(zoneId, date);
  if (!parts) return null;

  const zone = getZoneInfo(zoneId, date);
  const weekday = weekdayLabel(zoneId, date);

  // 各组件字符串
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  const timeStr = `${pad(parts.hour)}:${pad(parts.minute)}`;
  const timeStrFull = `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
  const local24 = `${dateStr} ${timeStrFull}`;

  // 12 小时制
  const period = parts.hour < 12 ? 'AM' : 'PM';
  const h12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  const local12 = `${dateStr} ${pad(h12)}:${pad(parts.minute)}:${pad(parts.second)} ${period}`;

  // 带偏移的 ISO 8601
  const offSign = zone.offsetMinutes >= 0 ? '+' : '-';
  const offAbs = Math.abs(zone.offsetMinutes);
  const offH = pad(Math.floor(offAbs / 60));
  const offM = pad(offAbs % 60);
  const iso = `${dateStr}T${timeStrFull}${offSign}${offH}:${offM}`;

  return {
    zone,
    parts: { ...parts, weekday },
    local24,
    local12,
    dateStr,
    timeStr,
    iso,
    unix: Math.floor(date.getTime() / 1000),
    unixMs: date.getTime(),
  };
}

/** 获取某时区下某时刻的中文星期 */
function weekdayLabel(zoneId: string, date: Date): string {
  try {
    const fmt = new Intl.DateTimeFormat('zh-CN', {
      timeZone: zoneId,
      weekday: 'short',
    });
    return fmt.format(date);
  } catch {
    return '';
  }
}

/**
 * 将 datetime-local 输入框的值（如 2026-07-08T14:30）
 * 按「指定的源时区」解析为绝对时间 Date。
 *
 * 原理：构造一个 UTC Date，再用偏移修正到源时区。
 */
export function parseLocalInput(input: string, sourceZoneId: string): Date | null {
  if (!input) return null;
  // datetime-local 格式：YYYY-MM-DDTHH:mm 或 YYYY-MM-DDTHH:mm:ss
  const m = input.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const year = parseInt(y, 10);
  const month = parseInt(mo, 10);
  const day = parseInt(d, 10);
  const hour = parseInt(h, 10);
  const minute = parseInt(mi, 10);
  const second = s ? parseInt(s, 10) : 0;

  // 先把输入当作 UTC 构造一个临时日期，求该时区在此刻的偏移
  const naive = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offset = offsetFor(sourceZoneId, naive);
  // 真实绝对时间 = naive - offset（因为输入是源时区的本地时间）
  return new Date(naive.getTime() - offset * 60000);
}

/**
 * 将一个 Date 反向格式化为 datetime-local 输入框值（按指定时区）。
 * 用于把当前时间回填到输入框。
 */
export function toLocalInput(date: Date, zoneId: string): string {
  const parts = getZoneParts(zoneId, date);
  if (!parts) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** 默认展示的常用时区集合 */
export const DEFAULT_ZONES = [
  'UTC',
  'Asia/Shanghai',
  'America/New_York',
  'Europe/London',
  'Asia/Tokyo',
];

/** 当前浏览器/系统所在时区 ID */
export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
