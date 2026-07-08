/**
 * 占位文本与 Mock 数据生成器核心工具函数
 *
 * 仅包含纯函数：词库、句子库、随机生成、格式化。
 * 不依赖 DOM 与浏览器 API，便于 SSR 与单测。
 *
 * 主要能力：
 *  - 占位文本：英文 Lorem Ipsum / 中文占位（懒人填字风格）
 *  - Mock 数据：中英文姓名、邮箱、URL、电话、UUID、IPv4、颜色、日期、数字、布尔
 *  - 输出格式：纯文本 / JSON 数组 / CSV / Markdown 表格
 */

/** 占位文本类型 */
export type PlaceholderType = 'lorem-en' | 'lorem-cn';

/** Mock 数据类型 */
export type MockDataType =
  | 'name-cn'
  | 'name-en'
  | 'email'
  | 'url'
  | 'phone'
  | 'uuid'
  | 'ip'
  | 'color'
  | 'date'
  | 'number'
  | 'boolean';

/** 所有支持的数据类型 */
export type DataType = PlaceholderType | MockDataType;

/** 占位文本粒度（仅占位文本类型有效） */
export type Granularity = 'paragraph' | 'sentence' | 'word';

/** 输出格式 */
export type OutputFormat = 'text' | 'json' | 'csv' | 'markdown';

/** 数据类型选项（用于 UI 下拉选择） */
export const DATA_TYPE_OPTIONS: { value: DataType; label: string; group: string }[] = [
  { value: 'lorem-en', label: 'Lorem Ipsum（英文占位）', group: '占位文本' },
  { value: 'lorem-cn', label: '中文占位文本', group: '占位文本' },
  { value: 'name-cn', label: '中文姓名', group: 'Mock 数据' },
  { value: 'name-en', label: '英文姓名', group: 'Mock 数据' },
  { value: 'email', label: '邮箱地址', group: 'Mock 数据' },
  { value: 'url', label: 'URL 链接', group: 'Mock 数据' },
  { value: 'phone', label: '手机号（中国）', group: 'Mock 数据' },
  { value: 'uuid', label: 'UUID v4', group: 'Mock 数据' },
  { value: 'ip', label: 'IPv4 地址', group: 'Mock 数据' },
  { value: 'color', label: '颜色（十六进制）', group: 'Mock 数据' },
  { value: 'date', label: '日期（YYYY-MM-DD）', group: 'Mock 数据' },
  { value: 'number', label: '随机整数（1-999）', group: 'Mock 数据' },
  { value: 'boolean', label: '布尔值（true/false）', group: 'Mock 数据' },
];

/** 占位文本类型集合（用于类型判断） */
export const PLACEHOLDER_TYPES: ReadonlySet<PlaceholderType> = new Set(['lorem-en', 'lorem-cn']);

/** 判断是否为占位文本类型 */
export function isPlaceholderType(type: DataType): type is PlaceholderType {
  return PLACEHOLDER_TYPES.has(type as PlaceholderType);
}

// ============================================================
// 词库与句子库
// ============================================================

/** 经典 Lorem Ipsum 单词库（拉丁文无意义占位词，去重） */
const LOREM_WORDS = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
  'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore',
  'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis', 'nostrud',
  'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip', 'ex', 'ea', 'commodo',
  'consequat', 'duis', 'aute', 'irure', 'in', 'reprehenderit', 'voluptate',
  'velit', 'esse', 'cillum', 'eu', 'fugiat', 'nulla', 'pariatur', 'excepteur',
  'sint', 'occaecat', 'cupidatat', 'non', 'proident', 'sunt', 'culpa', 'qui',
  'officia', 'deserunt', 'mollit', 'anim', 'id', 'est', 'laborum', 'at', 'vero',
  'eos', 'accusamus', 'iusto', 'odio', 'dignissimos', 'ducimus', 'blanditiis',
  'praesentium', 'voluptatum', 'deleniti', 'atque', 'corrupti', 'quos', 'quas',
  'molestias', 'excepturi', 'obcaecati', 'cupiditate', 'provident',
  'similique', 'mollitia', 'animi', 'dolores', 'repellendus', 'perspiciatis',
  'unde', 'omnis', 'iste', 'natus', 'error', 'voluptatem', 'accusantium',
  'doloremque', 'laudantium', 'totam', 'rem', 'aperiam', 'eaque', 'ipsa',
];

/** 中文占位句子模板库（用于段落与句子粒度，约 20 句） */
const CN_SENTENCES = [
  '在繁华的都市中，人们匆匆而过，仿佛每个人都在追逐着自己的梦想。',
  '夕阳西下，余晖洒满大地，给整个世界镀上了一层金色的光芒。',
  '时光荏苒，岁月如梭，转眼间又是一年春暖花开的季节。',
  '山不在高，有仙则名；水不在深，有龙则灵。',
  '落霞与孤鹜齐飞，秋水共长天一色。',
  '夜幕降临，万家灯火次第亮起，城市的喧嚣渐渐归于平静。',
  '海纳百川，有容乃大；壁立千仞，无欲则刚。',
  '微风拂过，树叶沙沙作响，仿佛在诉说着古老的故事。',
  '人生如逆旅，我亦是行人，在岁月的长河中渐行渐远。',
  '春有百花秋有月，夏有凉风冬有雪，人间好时节。',
  '远山如黛，近水含烟，一幅水墨画卷徐徐展开。',
  '不积跬步，无以至千里；不积小流，无以成江海。',
  '繁华落尽见真淳，万千气象归于一抹淡然。',
  '云卷云舒，花开花落，世间万物皆有其时。',
  '溪水潺潺，鸟鸣啾啾，山林间一片宁静祥和。',
  '月有阴晴圆缺，人有悲欢离合，此事古难全。',
  '一花一世界，一叶一菩提，于细微处见乾坤。',
  '风过无痕，雁过留声，岁月的印记刻在每一寸光阴里。',
  '采菊东篱下，悠然见南山，此中有真意，欲辨已忘言。',
  '千山鸟飞绝，万径人踪灭，孤舟蓑笠翁，独钓寒江雪。',
];

/** 中文常用字库（用于单词粒度，约 100 字） */
const CN_CHARS = '的一是不了人在我有他这中大为来上以个国到说时地也子就道要让'.split('');

/** 中文姓氏库（百家姓前 50） */
const CN_SURNAMES = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜'.split('');

/** 中文名字用字库（常见吉祥字） */
const CN_NAME_CHARS = '伟芳娜敏静丽强磊军洋勇艳杰娟涛明超秀峰平刚桂英华健林玉萍鑫鹏飞'.split('');

/** 英文 First name 库 */
const EN_FIRST_NAMES = [
  'James', 'John', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph',
  'Thomas', 'Charles', 'Mary', 'Patricia', 'Jennifer', 'Linda', 'Elizabeth',
  'Barbara', 'Susan', 'Jessica', 'Sarah', 'Karen', 'Nancy', 'Lisa', 'Betty',
  'Helen', 'Sandra', 'Emily', 'Ashley', 'Kimberly', 'Donna', 'Michelle',
];

/** 英文 Last name 库 */
const EN_LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
  'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson',
];

/** 邮箱域名库 */
const EMAIL_DOMAINS = ['gmail.com', 'outlook.com', 'yahoo.com', 'example.com', '163.com', 'qq.com'];

/** URL 域名库 */
const URL_DOMAINS = ['example.com', 'demo.org', 'sample.io', 'test.net', 'mock.dev'];

/** URL 路径库 */
const URL_PATHS = ['/about', '/posts/1', '/api/users', '/docs/guide', '/products/list', '/blog/2024', '/search?q=test', '/page/index'];

// ============================================================
// 随机工具函数
// ============================================================

/**
 * 生成 [0, max) 范围内的随机整数
 * 优先使用 crypto.getRandomValues（CSPRNG），降级到 Math.random
 */
export function randomInt(max: number): number {
  if (max <= 0) return 0;
  // 优先 CSPRNG，保证密码学安全与均匀分布
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return arr[0] % max;
  }
  return Math.floor(Math.random() * max);
}

/** 从数组中随机选取一个元素 */
function pick<T>(arr: readonly T[]): T {
  return arr[randomInt(arr.length)];
}

/** 生成 [min, max] 范围内的随机整数 */
function randomIntRange(min: number, max: number): number {
  return min + randomInt(max - min + 1);
}

// ============================================================
// 占位文本生成
// ============================================================

/** 生成一个英文 Lorem Ipsum 句子（8-20 词） */
function generateLoremSentence(): string {
  const len = randomIntRange(8, 20);
  const words: string[] = [];
  for (let i = 0; i < len; i++) {
    words.push(pick(LOREM_WORDS));
  }
  // 首字母大写，末尾加句点
  const sentence = words.join(' ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.';
}

/** 生成一个英文 Lorem Ipsum 段落（3-6 句） */
function generateLoremParagraph(): string {
  const len = randomIntRange(3, 6);
  const sentences: string[] = [];
  for (let i = 0; i < len; i++) {
    sentences.push(generateLoremSentence());
  }
  return sentences.join(' ');
}

/** 生成一个中文占位句子（从模板库随机选取） */
function generateCnSentence(): string {
  return pick(CN_SENTENCES);
}

/** 生成一个中文占位段落（3-5 句） */
function generateCnParagraph(): string {
  const len = randomIntRange(3, 5);
  const sentences: string[] = [];
  for (let i = 0; i < len; i++) {
    sentences.push(generateCnSentence());
  }
  return sentences.join('');
}

// ============================================================
// Mock 数据生成
// ============================================================

/** 生成中文姓名（姓 + 1-2 字名） */
function generateNameCn(): string {
  const surname = pick(CN_SURNAMES);
  const nameLen = randomInt(2) === 0 ? 1 : 2; // 50% 单字名，50% 双字名
  let name = surname;
  for (let i = 0; i < nameLen; i++) {
    name += pick(CN_NAME_CHARS);
  }
  return name;
}

/** 生成英文姓名（First Last） */
function generateNameEn(): string {
  return `${pick(EN_FIRST_NAMES)} ${pick(EN_LAST_NAMES)}`;
}

/** 生成邮箱地址（name@domain） */
function generateEmail(): string {
  const name = pick(EN_FIRST_NAMES).toLowerCase() + randomIntRange(1, 999);
  return `${name}@${pick(EMAIL_DOMAINS)}`;
}

/** 生成 URL 链接（https://domain/path） */
function generateUrl(): string {
  return `https://www.${pick(URL_DOMAINS)}${pick(URL_PATHS)}`;
}

/** 生成中国手机号（1[3-9]开头的 11 位） */
function generatePhone(): string {
  const secondDigit = randomIntRange(3, 9);
  let phone = `1${secondDigit}`;
  for (let i = 0; i < 9; i++) {
    phone += randomInt(10);
  }
  return phone;
}

/**
 * 生成 UUID v4
 * 优先使用 crypto.randomUUID，降级到基于 getRandomValues 的实现
 */
function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 降级方案：使用 getRandomValues 填充 16 字节，并设置 v4 标志位
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // 设置 version 4 与 variant 标志位
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`;
}

/** 生成 IPv4 地址（排除 0.x 与 255.x 段） */
function generateIp(): string {
  const a = randomIntRange(1, 254);
  const b = randomIntRange(0, 255);
  const c = randomIntRange(0, 255);
  const d = randomIntRange(1, 254);
  return `${a}.${b}.${c}.${d}`;
}

/** 生成十六进制颜色（#RRGGBB） */
function generateColor(): string {
  const r = randomInt(256);
  const g = randomInt(256);
  const b = randomInt(256);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/** 生成日期（YYYY-MM-DD，范围 2000-01-01 至 2025-12-31） */
function generateDate(): string {
  const year = randomIntRange(2000, 2025);
  const month = randomIntRange(1, 12);
  const day = randomIntRange(1, 28); // 用 28 避免月份天数差异
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 生成随机整数（1-999） */
function generateNumber(): string {
  return String(randomIntRange(1, 999));
}

/** 生成布尔值（true/false） */
function generateBoolean(): string {
  return randomInt(2) === 0 ? 'true' : 'false';
}

// ============================================================
// 统一生成入口
// ============================================================

/**
 * 生成单个数据项
 * @param type 数据类型
 * @param granularity 粒度（仅占位文本有效）
 */
export function generateItem(type: DataType, granularity: Granularity = 'paragraph'): string {
  switch (type) {
    case 'lorem-en':
      if (granularity === 'word') return pick(LOREM_WORDS);
      if (granularity === 'sentence') return generateLoremSentence();
      return generateLoremParagraph();
    case 'lorem-cn':
      if (granularity === 'word') return pick(CN_CHARS);
      if (granularity === 'sentence') return generateCnSentence();
      return generateCnParagraph();
    case 'name-cn':
      return generateNameCn();
    case 'name-en':
      return generateNameEn();
    case 'email':
      return generateEmail();
    case 'url':
      return generateUrl();
    case 'phone':
      return generatePhone();
    case 'uuid':
      return generateUuid();
    case 'ip':
      return generateIp();
    case 'color':
      return generateColor();
    case 'date':
      return generateDate();
    case 'number':
      return generateNumber();
    case 'boolean':
      return generateBoolean();
    default:
      return '';
  }
}

/**
 * 批量生成数据
 * @param type 数据类型
 * @param count 数量（1-100）
 * @param granularity 粒度（仅占位文本有效）
 */
export function generateItems(
  type: DataType,
  count: number,
  granularity: Granularity = 'paragraph',
): string[] {
  // 数量边界校验
  const safeCount = Math.max(1, Math.min(100, Math.floor(count) || 1));
  const items: string[] = [];
  for (let i = 0; i < safeCount; i++) {
    items.push(generateItem(type, granularity));
  }
  return items;
}

// ============================================================
// 输出格式化
// ============================================================

/**
 * 将数据项数组格式化为指定输出格式
 * @param items 数据项数组
 * @param format 输出格式
 * @param type 数据类型（用于 CSV/Markdown 表头）
 */
export function formatOutput(
  items: string[],
  format: OutputFormat,
  type: DataType = 'lorem-en',
): string {
  if (items.length === 0) return '';
  switch (format) {
    case 'text':
      // 每项一行
      return items.join('\n');
    case 'json':
      // JSON 数组（2 空格缩进，中文不转义）
      return JSON.stringify(items, null, 2);
    case 'csv': {
      // CSV 格式：首行 type,value；每项一行
      // 含逗号、换行、双引号的值需用双引号包裹并转义内部双引号
      const escapeCsv = (v: string) => {
        if (/[",\n\r]/.test(v)) {
          return `"${v.replace(/"/g, '""')}"`;
        }
        return v;
      };
      const rows = ['type,value', ...items.map((v) => `${type},${escapeCsv(v)}`)];
      return rows.join('\n');
    }
    case 'markdown': {
      // Markdown 表格：| # | value | + 分隔行
      const escapeMd = (v: string) => v.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      const rows = [
        '| # | value |',
        '| --- | --- |',
        ...items.map((v, i) => `| ${i + 1} | ${escapeMd(v)} |`),
      ];
      return rows.join('\n');
    }
    default:
      return items.join('\n');
  }
}

/** 根据数据类型获取默认粒度（占位文本默认段落，Mock 数据忽略） */
export function getDefaultGranularity(type: DataType): Granularity {
  return isPlaceholderType(type) ? 'paragraph' : 'paragraph';
}

/** 获取数据类型的中文描述（用于 UI 提示） */
export function getTypeLabel(type: DataType): string {
  const opt = DATA_TYPE_OPTIONS.find((o) => o.value === type);
  return opt ? opt.label : type;
}

/** 获取输出格式的文件扩展名（用于下载） */
export function getFormatExt(format: OutputFormat): string {
  switch (format) {
    case 'json':
      return 'json';
    case 'csv':
      return 'csv';
    case 'markdown':
      return 'md';
    default:
      return 'txt';
  }
}
