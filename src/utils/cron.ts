/**
 * CRON 表达式解析与描述生成
 *
 * 全部在浏览器本地处理，零依赖。
 *
 * 支持语法（POSIX cron + 常见扩展）：
 *  - 5 字段：minute hour day-of-month month day-of-week
 *  - `*` 任意值
 *  - `?` 不指定（仅 day-of-month / day-of-week，与 * 等价但语义更明确）
 *  - `,` 列表（1,5,10）
 *  - `-` 范围（1-5）
 *  - `/` 步长（写作 * /5 或 0-30/10，前者表示每 5 分钟，后者表示 0-30 每 10 步）
 *  - `L` 最后（day-of-month: L = 月末；day-of-week: 5L = 最后一个周五）
 *  - `W` 最近工作日（day-of-month: 15W = 离 15 号最近的工作日）
 *  - `#` 第几周（day-of-week: 5#3 = 第 3 个周五）
 *
 * 字段范围：
 *  - minute: 0-59
 *  - hour: 0-23
 *  - day-of-month: 1-31
 *  - month: 1-12（支持 JAN-DEC 别名）
 *  - day-of-week: 0-6（0=周日，支持 SUN-SAT 别名；7 也视为周日）
 */

/** Cron 字段标识 */
export type CronFieldType = 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek';

/** 字段元信息：取值范围与别名表 */
const FIELD_META: Record<
  CronFieldType,
  { min: number; max: number; aliases?: Record<string, number> }
> = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  dayOfMonth: { min: 1, max: 31 },
  month: {
    min: 1,
    max: 12,
    aliases: {
      JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
      JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
    },
  },
  dayOfWeek: {
    min: 0,
    max: 7, // 7 也表示周日（POSIX cron 0 与 7 等价），解析后归一化为 0
    aliases: { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 },
  },
};

/** 单字段的解析结果 */
export interface CronFieldParsed {
  /** 该字段允许的全部数值（已展开列表/范围/步长），L/W/# 特殊字符单独标记 */
  values: number[];
  /** 是否为 `*` 或 `?`（任意值） */
  any: boolean;
  /** L 标记：dayOfMonth=L 表示月末；dayOfWeek=5L 表示最后一个周五 */
  lastWeekday?: number; // dayOfWeek 用：0-6
  isLastDayOfMonth?: boolean; // dayOfMonth 用：L
  /** W 标记：最近工作日（dayOfMonth 用，如 15W） */
  nearestWeekday?: number;
  /** # 标记：第几周（dayOfWeek 用，如 5#3 = 第 3 个周五） */
  nthWeekday?: { weekday: number; nth: number };
}

/** 解析错误 */
export interface CronError {
  field: CronFieldType | 'format';
  message: string;
}

/** 完整解析结果 */
export interface CronParseResult {
  /** 5 字段解析结果，按 [minute, hour, dayOfMonth, month, dayOfWeek] 顺序 */
  fields: Record<CronFieldType, CronFieldParsed>;
  /** 原始表达式 */
  raw: string;
  /** 解析错误（null 表示成功） */
  error: CronError | null;
}

const FIELD_ORDER: CronFieldType[] = ['minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek'];

const FIELD_LABELS: Record<CronFieldType, string> = {
  minute: '分钟',
  hour: '小时',
  dayOfMonth: '日',
  month: '月',
  dayOfWeek: '周',
};

/** 解析单个字段表达式（不含 L/W/# 特殊字符的部分） */
function parseBasicTokens(
  token: string,
  meta: { min: number; max: number; aliases?: Record<string, number> },
): number[] {
  const result = new Set<number>();
  // 按逗号分隔为多个子项
  const parts = token.split(',').map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    // 步长：a-b/c 或 */c 或 a/c
    const stepMatch = part.match(/^(.+?)\/(\d+)$/);
    let step = 1;
    let rangePart = part;
    if (stepMatch) {
      step = parseInt(stepMatch[2], 10);
      if (step <= 0 || !Number.isFinite(step)) {
        throw new Error(`步长无效: ${part}`);
      }
      rangePart = stepMatch[1];
    }
    let start: number;
    let end: number;
    if (rangePart === '*') {
      start = meta.min;
      end = meta.max;
    } else if (rangePart.includes('-')) {
      const [s, e] = rangePart.split('-').map((x) => x.trim());
      start = resolveValue(s, meta);
      end = resolveValue(e, meta);
    } else {
      const v = resolveValue(rangePart, meta);
      start = v;
      // 单值 + 步长时，按 [v, max] 展开（如 5/10 = 5,15,25,35,45,55）
      end = stepMatch ? meta.max : v;
    }
    if (start < meta.min || end > meta.max || start > end) {
      throw new Error(`取值越界: ${part}（应在 ${meta.min}-${meta.max} 之间）`);
    }
    for (let v = start; v <= end; v += step) {
      result.add(v);
    }
  }
  return Array.from(result).sort((a, b) => a - b);
}

/** 解析单个值（含别名转换，如 JAN → 1） */
function resolveValue(
  s: string,
  meta: { min: number; max: number; aliases?: Record<string, number> },
): number {
  const upper = s.toUpperCase();
  if (meta.aliases && upper in meta.aliases) {
    return meta.aliases[upper];
  }
  const n = parseInt(s, 10);
  if (!Number.isFinite(n)) {
    throw new Error(`无法解析数值: ${s}`);
  }
  return n;
}

/** 解析单个字段（含 L/W/# 特殊字符处理） */
function parseField(type: CronFieldType, raw: string): CronFieldParsed {
  const meta = FIELD_META[type];
  const trimmed = raw.trim();
  // 任意值
  if (trimmed === '*' || trimmed === '?') {
    return { values: [], any: true };
  }
  // L：最后
  if (trimmed === 'L') {
    if (type === 'dayOfMonth') {
      return { values: [], any: false, isLastDayOfMonth: true };
    }
    throw new Error(`${FIELD_LABELS[type]} 字段不支持 L 字符`);
  }
  // nL：最后一个周几（仅 dayOfWeek）
  const nLMatch = trimmed.match(/^(\d+)L$/);
  if (nLMatch) {
    if (type !== 'dayOfWeek') {
      throw new Error(`${FIELD_LABELS[type]} 字段不支持 nL 语法`);
    }
    const w = parseInt(nLMatch[1], 10) % 7;
    return { values: [], any: false, lastWeekday: w };
  }
  // nW：最近工作日（仅 dayOfMonth）
  const nWMatch = trimmed.match(/^(\d+)W$/);
  if (nWMatch) {
    if (type !== 'dayOfMonth') {
      throw new Error(`${FIELD_LABELS[type]} 字段不支持 W 字符`);
    }
    const d = parseInt(nWMatch[1], 10);
    if (d < 1 || d > 31) {
      throw new Error(`W 字符前的日期应在 1-31 之间`);
    }
    return { values: [], any: false, nearestWeekday: d };
  }
  // n#k：第 k 个周几（仅 dayOfWeek）
  const hashMatch = trimmed.match(/^(\d+)#(\d+)$/);
  if (hashMatch) {
    if (type !== 'dayOfWeek') {
      throw new Error(`${FIELD_LABELS[type]} 字段不支持 # 字符`);
    }
    const w = parseInt(hashMatch[1], 10) % 7;
    const nth = parseInt(hashMatch[2], 10);
    if (nth < 1 || nth > 5) {
      throw new Error(`# 后的周数应在 1-5 之间`);
    }
    return { values: [], any: false, nthWeekday: { weekday: w, nth } };
  }
  // 普通语法
  const values = parseBasicTokens(trimmed, meta);
  // dayOfWeek 的 7 归一化为 0（周日），与 nL/n#k 语法一致（POSIX cron 0 与 7 均表示周日）
  if (type === 'dayOfWeek') {
    const normalized = new Set(values.map((v) => v % 7));
    return { values: Array.from(normalized).sort((a, b) => a - b), any: false };
  }
  return { values, any: false };
}

/**
 * 解析完整 cron 表达式
 * @param expr 5 字段 cron 表达式，如 "0 9 * * 1-5"
 */
export function parseCron(expr: string): CronParseResult {
  const raw = expr.trim();
  const parts = raw.split(/\s+/);
  if (parts.length !== 5) {
    return {
      fields: emptyFields(),
      raw,
      error: { field: 'format', message: `需要 5 个字段，实际 ${parts.length} 个` },
    };
  }
  const fields = {} as Record<CronFieldType, CronFieldParsed>;
  for (let i = 0; i < 5; i++) {
    const type = FIELD_ORDER[i];
    try {
      fields[type] = parseField(type, parts[i]);
    } catch (e) {
      return {
        fields: emptyFields(),
        raw,
        error: { field: type, message: (e as Error).message },
      };
    }
  }
  return { fields, raw, error: null };
}

/** 空字段（用于错误情况） */
function emptyFields(): Record<CronFieldType, CronFieldParsed> {
  return {
    minute: { values: [], any: true },
    hour: { values: [], any: true },
    dayOfMonth: { values: [], any: true },
    month: { values: [], any: true },
    dayOfWeek: { values: [], any: true },
  };
}

/** 月份与周几的中文别名 */
const MONTH_CN = ['', '1 月', '2 月', '3 月', '4 月', '5 月', '6 月', '7 月', '8 月', '9 月', '10 月', '11 月', '12 月'];
const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 数字列表转可读字符串（如 [1,2,3,4,5] → "1、2、3、4、5"；连续段 [1,2,3,5,6] → "1-3、5-6"） */
function formatValues(values: number[]): string {
  if (values.length === 0) return '';
  // 合并连续段
  const ranges: string[] = [];
  let start = values[0];
  let prev = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] === prev + 1) {
      prev = values[i];
    } else {
      ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
      start = values[i];
      prev = values[i];
    }
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
  return ranges.join('、');
}

/**
 * 生成 cron 表达式的中文描述
 */
export function describeCron(parsed: CronParseResult): string {
  if (parsed.error) return `表达式错误：${parsed.error.message}`;
  const { fields } = parsed;
  const parts: string[] = [];

  // 分钟段
  if (fields.minute.any) {
    parts.push('每分钟');
  } else if (fields.minute.values.length === 1 && fields.minute.values[0] === 0 && fields.hour.any) {
    parts.push('每小时整点');
  } else {
    parts.push(`在第 ${formatValues(fields.minute.values)} 分钟`);
  }

  // 小时段
  if (!fields.hour.any) {
    if (parts[0] === '每分钟') {
      parts[0] = `在每小时的第 ${formatValues(fields.minute.values)} 分钟`;
    } else if (parts[0] === '每小时整点') {
      // 已经表达，无需补充
    } else {
      parts.push(`、${formatValues(fields.hour.values)} 时`);
    }
  }

  // 日段
  if (fields.dayOfMonth.isLastDayOfMonth) {
    parts.push('、每月最后一天');
  } else if (fields.dayOfMonth.nearestWeekday !== undefined) {
    parts.push(`、最接近 ${fields.dayOfMonth.nearestWeekday} 号的工作日`);
  } else if (!fields.dayOfMonth.any) {
    parts.push(`、每月 ${formatValues(fields.dayOfMonth.values)} 号`);
  }

  // 月段
  if (!fields.month.any) {
    parts.push(`、${formatValues(fields.month.values).split('、').map((m) => MONTH_CN[parseInt(m, 10)] || m).join('、')}`);
  }

  // 周段
  if (fields.dayOfWeek.lastWeekday !== undefined) {
    parts.push(`、每月最后一个${WEEK_CN[fields.dayOfWeek.lastWeekday]}`);
  } else if (fields.dayOfWeek.nthWeekday) {
    const { weekday, nth } = fields.dayOfWeek.nthWeekday;
    const nthCN = ['', '第 1 个', '第 2 个', '第 3 个', '第 4 个', '第 5 个'][nth];
    parts.push(`、每月${nthCN}${WEEK_CN[weekday]}`);
  } else if (!fields.dayOfWeek.any) {
    const weekdays = fields.dayOfWeek.values.map((v) => WEEK_CN[v % 7]);
    parts.push(`、每${weekdays.join('、')}`);
  }

  let desc = parts.join('').replace(/^、/, '');
  // 简化合并：把"每分钟、每小时..."优化为"每小时..."
  desc = desc.replace(/^在第 0 分钟、每小时整点$/, '每小时整点');
  return desc;
}

/** 计算月份天数（考虑闰年） */
function daysInMonth(year: number, month: number): number {
  // month: 1-12
  return new Date(year, month, 0).getDate();
}

/** 判断日期是否匹配 dayOfMonth 字段 */
function matchesDayOfMonth(d: Date, f: CronFieldParsed): boolean {
  if (f.any) return true;
  const day = d.getDate();
  if (f.isLastDayOfMonth) {
    return day === daysInMonth(d.getFullYear(), d.getMonth() + 1);
  }
  if (f.nearestWeekday !== undefined) {
    // 找离 nearestWeekday 最近的工作日（周一到周五）
    const target = f.nearestWeekday;
    const lastDay = daysInMonth(d.getFullYear(), d.getMonth() + 1);
    if (target > lastDay) return false;
    // 计算目标日的星期（0=周日）
    const targetDate = new Date(d.getFullYear(), d.getMonth(), target);
    const w = targetDate.getDay();
    let actualDay = target;
    if (w === 0) {
      // 周日：往前移到周五（除非跨月）
      actualDay = target - 2 >= 1 ? target - 2 : target + 1;
    } else if (w === 6) {
      // 周六：往后移到周一（除非跨月）
      actualDay = target + 2 <= lastDay ? target + 2 : target - 1;
    }
    return day === actualDay;
  }
  return f.values.includes(day);
}

/** 判断日期是否匹配 dayOfWeek 字段 */
function matchesDayOfWeek(d: Date, f: CronFieldParsed): boolean {
  if (f.any) return true;
  const w = d.getDay(); // 0=周日
  if (f.lastWeekday !== undefined) {
    // 是否本月最后一个该周几
    const targetW = f.lastWeekday;
    if (w !== targetW) return false;
    const lastDay = daysInMonth(d.getFullYear(), d.getMonth() + 1);
    return d.getDate() + 7 > lastDay;
  }
  if (f.nthWeekday) {
    const { weekday, nth } = f.nthWeekday;
    if (w !== weekday) return false;
    // 计算本月第几次出现
    const day = d.getDate();
    const occurrence = Math.ceil(day / 7);
    return occurrence === nth;
  }
  return f.values.includes(w);
}

/**
 * 计算从 from 之后下一次匹配的时间
 * @param parsed 已解析的 cron
 * @param from 起始时间（不含），默认当前时间
 * @param maxIterSeconds 最大迭代秒数（避免死循环），默认 366 天
 */
export function nextExecution(
  parsed: CronParseResult,
  from: Date = new Date(),
  maxIterSeconds: number = 366 * 24 * 3600,
): Date | null {
  if (parsed.error) return null;
  const { fields } = parsed;
  // 从下一分钟开始（秒清零）
  const start = new Date(from.getTime() + 1000);
  start.setSeconds(0, 0);
  const limit = start.getTime() + maxIterSeconds * 1000;
  // 逐分钟扫描（粗扫，到分钟后精确到分钟匹配；cron 最小粒度就是分钟）
  const cursor = new Date(start);
  while (cursor.getTime() <= limit) {
    // 逐字段校验：month → dayOfMonth/dayOfWeek → hour → minute
    const monthOk = fields.month.any || fields.month.values.includes(cursor.getMonth() + 1);
    if (!monthOk) {
      // month 不匹配，步进到下个月 1 号 0 点
      cursor.setMonth(cursor.getMonth() + 1, 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    const domOk = matchesDayOfMonth(cursor, fields.dayOfMonth);
    const dowOk = matchesDayOfWeek(cursor, fields.dayOfWeek);
    // cron 标准：当 dayOfMonth 和 dayOfWeek 都不是 * 时，两者用 OR；否则用 AND
    const dayOk = !fields.dayOfMonth.any && !fields.dayOfWeek.any
      ? domOk || dowOk
      : domOk && dowOk;
    if (!dayOk) {
      // 日不匹配，步进到下一天 0 点
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    const hourOk = fields.hour.any || fields.hour.values.includes(cursor.getHours());
    if (!hourOk) {
      // 小时不匹配，步进到下一小时 0 分
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
      continue;
    }
    const minuteOk = fields.minute.any || fields.minute.values.includes(cursor.getMinutes());
    if (minuteOk) {
      return new Date(cursor);
    }
    // 分钟不匹配，步进 1 分钟
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

/**
 * 计算多次下次执行时间
 * @param parsed 已解析的 cron
 * @param from 起始时间
 * @param count 返回次数
 */
export function nextExecutions(
  parsed: CronParseResult,
  from: Date = new Date(),
  count: number = 5,
): Date[] {
  const result: Date[] = [];
  let cursor = from;
  for (let i = 0; i < count; i++) {
    const next = nextExecution(parsed, cursor);
    if (!next) break;
    result.push(next);
    cursor = new Date(next.getTime() + 1000);
  }
  return result;
}

/** 预设示例 */
export interface CronPreset {
  label: string;
  expr: string;
  desc: string;
}

export const CRON_PRESETS: CronPreset[] = [
  { label: '每分钟', expr: '* * * * *', desc: '每分钟执行一次' },
  { label: '每小时整点', expr: '0 * * * *', desc: '每小时整点执行' },
  { label: '每天 0 点', expr: '0 0 * * *', desc: '每天凌晨 0 点执行' },
  { label: '每周一 9 点', expr: '0 9 * * 1', desc: '每周一上午 9 点执行' },
  { label: '每月 1 号 0 点', expr: '0 0 1 * *', desc: '每月 1 号凌晨 0 点执行' },
  { label: '工作日 9 点', expr: '0 9 * * 1-5', desc: '周一到周五上午 9 点执行' },
  { label: '每 5 分钟', expr: '*/5 * * * *', desc: '每 5 分钟执行一次' },
  { label: '每 30 分钟', expr: '*/30 * * * *', desc: '每 30 分钟执行一次' },
  { label: '每天 0 点与 12 点', expr: '0 0,12 * * *', desc: '每天 0 点与 12 点各执行一次' },
  { label: '每月最后一天 23 点', expr: '0 23 L * *', desc: '每月最后一天 23 点执行' },
  { label: '每季度第一天', expr: '0 0 1 1,4,7,10 *', desc: '每季度首月 1 号 0 点执行' },
  { label: '每小时第 15 分', expr: '15 * * * *', desc: '每小时的第 15 分钟执行' },
];
