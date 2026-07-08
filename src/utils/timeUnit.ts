/**
 * 时间单位换算引擎
 *
 * 设计要点：
 *  - 毫秒 / 秒 / 分 / 时 / 天 / 周 是「物理单位」，长度固定，可精确换算。
 *  - 月 / 年 是「日历单位」，长度随月份与闰年变化，本工具采用 Gregorian 历法
 *    平均值（1 年 = 365.2425 天，1 月 = 30.436875 天）进行近似换算，
 *    并在 UI 与 FAQ 中明确告知用户此约定。
 *  - 零依赖：纯 TypeScript 实现，所有计算在浏览器本地完成。
 *
 * 适用场景：开发中常见的超时配置、缓存 TTL、调度间隔、定时任务周期换算，
 * 以及人类可读时长（如「1 天 2 小时 30 分」）的快速生成。
 */

/** 支持的时间单位标识 */
export type UnitId = 'ms' | 's' | 'min' | 'h' | 'd' | 'w' | 'mo' | 'y';

/** 单位定义 */
export interface UnitDef {
  /** 单位标识 */
  id: UnitId;
  /** 中文名，如「毫秒」 */
  label: string;
  /** 短标签，如「ms」 */
  short: string;
  /** 1 个该单位等于多少毫秒（月年使用 Gregorian 平均值） */
  factorMs: number;
  /** 输入解析别名（小写），用于 parseDuration 识别 */
  aliases: string[];
  /** 是否为日历单位（长度可变） */
  calendar?: boolean;
}

/**
 * 单位定义表（按从大到小顺序排列，便于人类可读格式化时优先匹配大单位）。
 *
 * 月年采用平均值：
 *   1 年 = 365.2425 天（Gregorian 400 年循环平均，含 97 个闰日）
 *   1 月 = 365.2425 / 12 ≈ 30.436875 天
 */
export const TIME_UNITS: UnitDef[] = [
  {
    id: 'y',
    label: '年',
    short: 'y',
    factorMs: 365.2425 * 24 * 60 * 60 * 1000,
    aliases: ['y', 'year', 'years', '年'],
    calendar: true,
  },
  {
    id: 'mo',
    label: '月',
    short: 'mo',
    factorMs: (365.2425 / 12) * 24 * 60 * 60 * 1000,
    aliases: ['mo', 'month', 'months', '月', '个月'],
    calendar: true,
  },
  {
    id: 'w',
    label: '周',
    short: 'w',
    factorMs: 7 * 24 * 60 * 60 * 1000,
    aliases: ['w', 'week', 'weeks', '周', '星期'],
  },
  {
    id: 'd',
    label: '天',
    short: 'd',
    factorMs: 24 * 60 * 60 * 1000,
    aliases: ['d', 'day', 'days', '天', '日'],
  },
  {
    id: 'h',
    label: '小时',
    short: 'h',
    factorMs: 60 * 60 * 1000,
    aliases: ['h', 'hr', 'hrs', 'hour', 'hours', '时', '小时'],
  },
  {
    id: 'min',
    label: '分钟',
    short: 'min',
    factorMs: 60 * 1000,
    aliases: ['min', 'minute', 'minutes', 'm', '分', '分钟'],
  },
  {
    id: 's',
    label: '秒',
    short: 's',
    factorMs: 1000,
    aliases: ['s', 'sec', 'secs', 'second', 'seconds', '秒'],
  },
  {
    id: 'ms',
    label: '毫秒',
    short: 'ms',
    factorMs: 1,
    aliases: ['ms', 'millisecond', 'milliseconds', '毫秒'],
  },
];

/** 单位标识到定义的映射，便于 O(1) 查找 */
const UNIT_MAP: Record<UnitId, UnitDef> = TIME_UNITS.reduce(
  (acc, u) => {
    acc[u.id] = u;
    return acc;
  },
  {} as Record<UnitId, UnitDef>,
);

/** 别名到单位标识的映射（小写），用于 parseDuration 识别用户输入 */
const ALIAS_MAP: Record<string, UnitId> = (() => {
  const m: Record<string, UnitId> = {};
  for (const u of TIME_UNITS) {
    for (const a of u.aliases) {
      m[a.toLowerCase()] = u.id;
    }
    // short 与 id 本身也作为别名
    m[u.short.toLowerCase()] = u.id;
    m[u.id.toLowerCase()] = u.id;
  }
  return m;
})();

/**
 * 单位换算：将 value 个 fromUnit 转换为 toUnit。
 *
 * 月年使用平均值换算，结果可能为无限小数（如 1 月 = 30.436875 天），
 * 调用方应自行决定保留几位小数。
 *
 * @param value 数值
 * @param fromUnit 源单位
 * @param toUnit 目标单位
 * @returns 换算后的数值；若任一单位无效返回 NaN
 */
export function convert(value: number, fromUnit: UnitId, toUnit: UnitId): number {
  const from = UNIT_MAP[fromUnit];
  const to = UNIT_MAP[toUnit];
  if (!from || !to) return NaN;
  if (!Number.isFinite(value)) return NaN;
  // 先统一转毫秒，再转到目标单位
  const ms = value * from.factorMs;
  return ms / to.factorMs;
}

/**
 * 将一个数值一次性换算为全部 8 个单位的对应值。
 * 用于「输入一个数，看到所有单位结果」的概览模式。
 *
 * @param value 数值
 * @param fromUnit 源单位
 * @returns 各单位的换算结果（key 为 UnitId）
 */
export function convertAll(value: number, fromUnit: UnitId): Record<UnitId, number> {
  const from = UNIT_MAP[fromUnit];
  if (!from || !Number.isFinite(value)) {
    return TIME_UNITS.reduce(
      (acc, u) => {
        acc[u.id] = NaN;
        return acc;
      },
      {} as Record<UnitId, number>,
    );
  }
  const ms = value * from.factorMs;
  return TIME_UNITS.reduce(
    (acc, u) => {
      acc[u.id] = ms / u.factorMs;
      return acc;
    },
    {} as Record<UnitId, number>,
  );
}

/** 解析结果项：数值 + 对应单位 */
export interface ParsedPart {
  value: number;
  unit: UnitId;
}

/** parseDuration 的返回类型 */
export interface ParseResult {
  /** 是否解析成功（至少识别到 1 项） */
  valid: boolean;
  /** 累计毫秒数 */
  ms: number;
  /** 逐项解析结果 */
  parts: ParsedPart[];
  /** 未识别的原始片段（用于错误提示） */
  unknown: string[];
}

/**
 * 解析带单位的人类时长字符串为毫秒数。
 *
 * 支持格式：
 *  - 「1h 30min」「1 hour 30 minutes」「2 days」「500ms」
 *  - 「1天2小时30分」「1 周」「3.5 年」「2mo」
 *  - 中文与英文可混用，空格可选，如「1h30min」「2天3小时」
 *  - 纯数字（无单位）：按 fallbackUnit 解释
 *  - 多个片段累加，如「1h 30min」= 5400000ms
 *  - 支持小数：如「1.5h」「0.5d」
 *
 * @param input 用户输入字符串
 * @param fallbackUnit 当输入为纯数字时的默认单位（默认 's'）
 * @returns 解析结果
 */
export function parseDuration(input: string, fallbackUnit: UnitId = 's'): ParseResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { valid: false, ms: 0, parts: [], unknown: [] };
  }

  // 纯数字：按 fallbackUnit 解释
  if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    const v = parseFloat(trimmed);
    if (!Number.isFinite(v)) {
      return { valid: false, ms: 0, parts: [], unknown: [trimmed] };
    }
    return {
      valid: true,
      ms: v * UNIT_MAP[fallbackUnit].factorMs,
      parts: [{ value: v, unit: fallbackUnit }],
      unknown: [],
    };
  }

  // 全局正则：数值 + 可选空白 + 单位别名
  // 别名按长度降序匹配，避免「min」被「m」截断前缀
  const sortedAliases = Object.keys(ALIAS_MAP).sort((a, b) => b.length - a.length);
  // 构造正则：数值(整数或小数，含正负) + 可选空白 + (alias1|alias2|...)
  // 别名中的特殊字符（无）无需转义，但为稳妥起见全部转义
  const escaped = sortedAliases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(
    `([+-]?\\d+(?:\\.\\d+)?)\\s*(${escaped.join('|')})`,
    'gi',
  );

  const parts: ParsedPart[] = [];
  const unknown: string[] = [];
  let lastEnd = 0;
  let match: RegExpExecArray | null;
  let hasAny = false;

  while ((match = pattern.exec(trimmed)) !== null) {
    // 检查上次匹配结束到本次匹配开始之间是否有未识别字符（非空白）
    const between = trimmed.slice(lastEnd, match.index).trim();
    if (between) {
      unknown.push(between);
    }
    lastEnd = pattern.lastIndex;

    const value = parseFloat(match[1]);
    const alias = match[2].toLowerCase();
    const unit = ALIAS_MAP[alias];
    if (unit !== undefined && Number.isFinite(value)) {
      parts.push({ value, unit });
      hasAny = true;
    } else if (!Number.isFinite(value)) {
      unknown.push(match[0]);
    }
  }

  // 尾部未识别字符
  const tail = trimmed.slice(lastEnd).trim();
  if (tail) {
    unknown.push(tail);
  }

  if (!hasAny) {
    return { valid: false, ms: 0, parts: [], unknown: unknown.length ? unknown : [trimmed] };
  }

  const ms = parts.reduce((sum, p) => sum + p.value * UNIT_MAP[p.unit].factorMs, 0);
  return { valid: true, ms, parts, unknown };
}

/**
 * 将毫秒数格式化为「人类可读」的复合中文表示。
 *
 * 策略：从最大单位（年）开始贪心匹配，依次扣除，最多保留 3 个非零片段，
 * 数值取整数部分（向下取整），避免出现「1.234 天」这种不直观的结果。
 * 负数会保留符号并格式化绝对值。
 *
 * 示例：
 *  - 90610000 → 「1 天 1 小时 10 分钟 10 秒」
 *  - 65000 → 「1 分钟 5 秒」
 *  - 86400000 → 「1 天」
 *  - 0 → 「0 秒」
 *
 * 注意：月年因长度可变，本函数仅在毫秒数 ≥ 1 年（或 1 月）时使用平均值近似。
 * 对需要精确日历计算的场景（如「2026-01-01 加 1 个月」），应使用专门的日期库。
 *
 * @param ms 毫秒数
 * @param maxParts 最多保留的非零片段数（默认 3，避免「1 年 0 月 0 周 1 天」冗长）
 * @returns 人类可读字符串
 */
export function formatHuman(ms: number, maxParts: number = 3): string {
  if (!Number.isFinite(ms)) return '无效时长';
  if (ms === 0) return '0 秒';

  const sign = ms < 0 ? '-' : '';
  let remaining = Math.abs(ms);
  const fragments: string[] = [];

  for (const u of TIME_UNITS) {
    if (fragments.length >= maxParts) break;
    const v = Math.floor(remaining / u.factorMs);
    if (v > 0) {
      fragments.push(`${v} ${u.label}`);
      remaining -= v * u.factorMs;
    }
  }

  if (fragments.length === 0) {
    // 全部小于 1 毫秒
    return `${sign}${Math.floor(remaining)} 毫秒`;
  }
  return sign + fragments.join(' ');
}

/**
 * 数值格式化：保留指定有效小数位，去除末尾多余的 0。
 *
 * @param v 数值
 * @param maxFraction 最大小数位数（默认 6）
 * @returns 字符串，如「1.5」「100」「30.436875」
 */
export function formatNumber(v: number, maxFraction: number = 6): string {
  if (!Number.isFinite(v)) return '—';
  if (Number.isInteger(v)) return String(v);
  // toFixed 截断后再 parseFloat 去尾零，最后 String 避免科学计数法
  const fixed = v.toFixed(maxFraction);
  const stripped = parseFloat(fixed);
  return String(stripped);
}

/** 获取单位定义（供 UI 展示标签等使用） */
export function getUnitDef(id: UnitId): UnitDef | undefined {
  return UNIT_MAP[id];
}

/** 列出全部单位定义（供 UI 渲染选择器等使用） */
export function listUnits(): UnitDef[] {
  return TIME_UNITS;
}

/** 判断单位是否为日历单位（月/年） */
export function isCalendarUnit(id: UnitId): boolean {
  return UNIT_MAP[id]?.calendar === true;
}
