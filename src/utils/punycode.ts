/**
 * Punycode 编解码（RFC 3492）
 *
 * 纯原生 TypeScript 零依赖实现 Bootstring 算法，用于国际化域名 IDN 转换。
 * 仅处理单个标签（不含 xn-- 前缀与点分隔），域名级转换由组件调用方处理。
 *
 * 算法参数（RFC 3492 固定常量）：
 *   base = 36、tmin = 1、tmax = 26、skew = 38、damp = 700
 *   initial_bias = 72、initial_n = 128
 */

// RFC 3492 固定常量
const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

/** 数字（0-35）转字符：0-25 → 'a'-'z'，26-35 → '0'-'9'（RFC 3492 规范） */
function digitToChar(d: number): string {
  // 0-25 用小写字母 a-z，26-35 用数字 0-9（Punycode 标准映射）
  return d < 26 ? String.fromCharCode(97 + d) : String.fromCharCode(48 + d - 26);
}

/** 字符转数字（0-35）：大小写不敏感，'a'-'z'/'A'-'Z' → 0-25，'0'-'9' → 26-35 */
function charToDigit(c: string): number {
  const code = c.charCodeAt(0);
  if (code >= 97 && code <= 122) return code - 97;   // a-z → 0-25
  if (code >= 65 && code <= 90) return code - 65;     // A-Z → 0-25
  if (code >= 48 && code <= 57) return code - 48 + 26; // 0-9 → 26-35
  throw new Error(`非法 Punycode 字符 "${c}"`);
}

/** bias 自适应：调整下次编码的偏移量，使输出分布更均匀 */
function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  // 首次使用 damp 衰减，之后减半，再加 numPoints 比例补偿
  let d = firstTime ? Math.floor(delta / DAMP) : Math.floor(delta / 2);
  d += Math.floor(d / numPoints);
  let k = 0;
  // 每轮减 (base - tmin)，直到小于半数 tmax 上限
  while (d > Math.floor(((BASE - TMIN) * TMAX) / 2)) {
    d = Math.floor(d / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW));
}

/** 计算阈值 t：clamp(k - bias, tmin, tmax) */
function threshold(k: number, bias: number): number {
  return Math.max(TMIN, Math.min(TMAX, k - bias));
}

export interface PunycodeResult {
  ok: boolean;
  value: string;
  error: string;
}

/** 将 Unicode 字符串（码点序列）编码为 Punycode ASCII 字符串 */
export function encode(input: string): PunycodeResult {
  if (input === '') return { ok: true, value: '', error: '' };
  try {
    return encodeCore(input);
  } catch (e) {
    return { ok: false, value: '', error: `编码失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 编码主逻辑（可能抛错，由 encode 包装捕获） */
function encodeCore(input: string): PunycodeResult {
  // 用展开运算符按码点切分，正确处理增补平面字符（Emoji 等）
  const codePoints: number[] = [];
  for (const ch of input) codePoints.push(ch.codePointAt(0) as number);

  const output: string[] = [];
  // 1. 基本字符（< 128）直接输出
  const basic = codePoints.filter((c) => c < 128);
  for (const c of basic) output.push(String.fromCharCode(c));
  let h = basic.length;
  const b = basic.length;
  // 有基本字符时追加 '-' 分隔符（RFC 3492：if b > 0 then append delimiter）
  if (b > 0) output.push('-');

  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;

  // 2. 主循环：按码点升序处理非基本字符
  while (h < codePoints.length) {
    // 找出当前大于等于 n 的最小码点
    let m = Number.MAX_SAFE_INTEGER;
    for (const c of codePoints) if (c >= n && c < m) m = c;
    // delta 累加（m - n）*（已处理字符数 + 1）
    delta += (m - n) * (h + 1);
    n = m;
    for (const c of codePoints) {
      if (c < n) delta++;
      if (c === n) {
        // 将 delta 编码为 base 36 序列
        let q = delta;
        for (let k = BASE; ; k += BASE) {
          const t = threshold(k, bias);
          if (q < t) break;
          output.push(digitToChar(t + ((q - t) % (BASE - t))));
          q = Math.floor((q - t) / (BASE - t));
        }
        output.push(digitToChar(q));
        bias = adapt(delta, h + 1, h === b);
        delta = 0;
        h++;
      }
    }
    delta++;
    n++;
  }
  return { ok: true, value: output.join(''), error: '' };
}

/** 将 Punycode ASCII 字符串解码为 Unicode 字符串 */
export function decode(input: string): PunycodeResult {
  if (input === '') return { ok: true, value: '', error: '' };
  try {
    return decodeCore(input);
  } catch (e) {
    return { ok: false, value: '', error: `解码失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 解码主逻辑（可能抛错，由 decode 包装捕获） */
function decodeCore(input: string): PunycodeResult {
  // 不 trim 空格（空格是合法的 ASCII 基本字符），只去除换行符与制表符
  const cleaned = input.replace(/^[\r\n\t]+|[\r\n\t]+$/g, '');
  // 找最后一个 '-'，其右侧为编码部分，左侧为基本字符
  const lastDash = cleaned.lastIndexOf('-');
  const basicPart = lastDash > 0 ? cleaned.slice(0, lastDash) : '';
  const encodedPart = lastDash > 0 ? cleaned.slice(lastDash + 1) : cleaned;

  // 校验基本字符必须全部 ASCII
  for (const ch of basicPart) {
    if (ch.codePointAt(0)! >= 128) {
      return { ok: false, value: '', error: `基本部分含非 ASCII 字符 "${ch}"` };
    }
  }

  const output: number[] = [];
  // 基本字符直接放入输出
  for (const ch of basicPart) output.push(ch.codePointAt(0) as number);

  let n = INITIAL_N;
  let i = 0;
  let bias = INITIAL_BIAS;
  let pos = 0;

  // 主循环：从 encodedPart 逐个读出 delta 并还原码点
  while (pos < encodedPart.length) {
    const oldI = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (pos >= encodedPart.length) {
        return { ok: false, value: '', error: '输入在编码部分中途结束（可能被截断）' };
      }
      const digit = charToDigit(encodedPart[pos++]);
      // 每个数字都累加 digit * w（RFC 3492 解码伪代码：先累加再判断）
      i += digit * w;
      const t = threshold(k, bias);
      // digit < t 表示这是最后一个数字，结束当前 delta
      if (digit < t) break;
      w *= BASE - t;
    }
    // 自适应 bias：按已还原字符数调整
    bias = adapt(i - oldI, output.length + 1, oldI === 0);
    n += Math.floor(i / (output.length + 1));
    i %= output.length + 1;
    // 在位置 i 处插入新码点 n
    output.splice(i, 0, n);
    i++;
  }

  // 码点数组转字符串
  const value = output.map((c) => String.fromCodePoint(c)).join('');
  return { ok: true, value, error: '' };
}

/** IDN 前缀：所有 Punycode 标签必须以 xn-- 开头 */
export const ACE_PREFIX = 'xn--';

/** 判断单个标签是否为 ACE（ASCII Compatible Encoding）标签 */
export function isAceLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return lower.startsWith(ACE_PREFIX) && lower.length > ACE_PREFIX.length;
}

/** 判断单个标签是否包含非 ASCII 字符（即需要 Punycode 编码） */
export function hasNonAscii(label: string): boolean {
  for (const ch of label) if (ch.codePointAt(0)! >= 128) return true;
  return false;
}

export interface DomainResult {
  ok: boolean;
  value: string;
  error: string;
  labels?: { input: string; output: string; kind: 'ascii' | 'encoded' | 'decoded' }[];
}

/** 将完整域名按点分隔，逐个标签做 Punycode 编码（Unicode → xn-- 前缀） */
export function encodeDomain(input: string): DomainResult {
  if (input.trim() === '') return { ok: true, value: '', error: '' };
  const trimmed = input.trim().replace(/\.+$/, ''); // 去掉尾部点（FQDN）
  const labels = trimmed.split('.');
  const outLabels: string[] = [];
  const details: DomainResult['labels'] = [];
  for (const raw of labels) {
    if (raw === '') {
      return { ok: false, value: '', error: '域名包含空标签（连续点号）' };
    }
    if (hasNonAscii(raw)) {
      const r = encode(raw);
      if (!r.ok) return { ok: false, value: '', error: `标签「${raw}」编码失败：${r.error}` };
      // ACE 标签长度上限 63 字符（RFC 1035）
      const ace = ACE_PREFIX + r.value;
      if (ace.length > 63) {
        return { ok: false, value: '', error: `标签「${raw}」编码后长度 ${ace.length} 超过 63 字符上限` };
      }
      outLabels.push(ace);
      details.push({ input: raw, output: ace, kind: 'encoded' });
    } else {
      outLabels.push(raw);
      details.push({ input: raw, output: raw, kind: 'ascii' });
    }
  }
  return { ok: true, value: outLabels.join('.'), error: '', labels: details };
}

/** 将完整域名按点分隔，逐个标签做 Punycode 解码（xn-- 前缀 → Unicode） */
export function decodeDomain(input: string): DomainResult {
  if (input.trim() === '') return { ok: true, value: '', error: '' };
  const trimmed = input.trim().replace(/\.+$/, '');
  const labels = trimmed.split('.');
  const outLabels: string[] = [];
  const details: DomainResult['labels'] = [];
  for (const raw of labels) {
    if (raw === '') {
      return { ok: false, value: '', error: '域名包含空标签（连续点号）' };
    }
    if (isAceLabel(raw)) {
      const r = decode(raw.slice(ACE_PREFIX.length));
      if (!r.ok) return { ok: false, value: '', error: `标签「${raw}」解码失败：${r.error}` };
      outLabels.push(r.value);
      details.push({ input: raw, output: r.value, kind: 'decoded' });
    } else {
      // 非 ACE 标签：若有非 ASCII 字符也原样保留并提示
      outLabels.push(raw);
      details.push({ input: raw, output: raw, kind: 'ascii' });
    }
  }
  return { ok: true, value: outLabels.join('.'), error: '', labels: details };
}
