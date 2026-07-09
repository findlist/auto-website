/**
 * IP 地址与子网计算核心逻辑
 *
 * 支持 IPv4（32 位）与 IPv6（128 位），统一使用 BigInt 表示数值，
 * 便于跨家族做位运算（BigInt 原生支持任意精度位运算，无 32 位限制）。
 * 纯原生 JS 实现，零依赖，可直接在浏览器与 Node 环境运行。
 *
 * 主要能力：
 *  - parseIp：解析 IP 字符串 -> IpInfo（族、BigInt、压缩 / 完整 / 二进制表示）
 *  - parseCidr：解析 CIDR 或 IP / 掩码 -> SubnetInfo（网络地址、广播地址、掩码、范围、类型判定、IP 类别）
 *  - divideSubnet：将一个 CIDR 划分为 N 个等长子网（N 必须为 2 的幂）
 *  - IP_PRESETS：12 个常用预设（家庭网络、私有段、环回、链路本地、多播、IPv6 等）
 *
 * 注意：BigInt 位运算中 `>>` 是算术右移，但 BigInt 任意精度下，
 *      对非负数使用 `>>` 与无符号右移等价（高位不会因符号位扩展产生 1）。
 */

export type IpFamily = 4 | 6;

/** IP 地址信息 */
export interface IpInfo {
  family: IpFamily;
  bigintValue: bigint;
  /** IPv4 的 4 个 0-255 八位组；IPv6 为 undefined */
  octets?: number[];
  /** IPv6 的 8 个 0-65535 字组；IPv4 为 undefined */
  groups?: number[];
  /** 压缩表示（IPv6 自动应用 :: 缩略） */
  compressed: string;
  /** 完整表示（IPv6 不缩略，每位补齐 4 位十六进制） */
  full: string;
  /** 二进制表示（IPv4 按 8 位分组，IPv6 按 16 位分组，便于按位对齐可视化） */
  binary: string;
}

/** 子网解析结果 */
export interface SubnetInfo {
  family: IpFamily;
  input: string;
  ip: IpInfo;
  prefix: number;
  networkAddress: IpInfo;
  /** 广播地址：仅 IPv4 有，IPv6 无广播概念返回 null */
  broadcastAddress: IpInfo | null;
  netmask: IpInfo;
  /** 通配符掩码（反掩码），用于 ACL / 路由配置 */
  wildcardMask: IpInfo;
  firstHost: IpInfo;
  lastHost: IpInfo;
  totalHosts: bigint;
  /** 可用主机数：IPv4 在 prefix ≤ 30 时减 2（网络 + 广播），IPv6 不减 */
  usableHosts: bigint;
  isPrivate: boolean;
  isLoopback: boolean;
  isMulticast: boolean;
  isLinkLocal: boolean;
  isReserved: boolean;
  isUnspecified: boolean;
  /** IP 类别：仅 IPv4 有 A/B/C/D/E 分类，IPv6 返回 undefined */
  ipClass?: 'A' | 'B' | 'C' | 'D' | 'E';
  hostBits: number;
  networkBits: number;
}

/** 子网划分结果 */
export interface SubnetDivideResult {
  family: IpFamily;
  count: number;
  newPrefix: number;
  subnets: {
    index: number;
    networkAddress: IpInfo;
    broadcastAddress: IpInfo | null;
    firstHost: IpInfo;
    lastHost: IpInfo;
    usableHosts: bigint;
  }[];
}

/** 12 个常用预设，覆盖典型开发与运维场景 */
export const IP_PRESETS: { label: string; value: string; family: IpFamily }[] = [
  { label: '家庭网络', value: '192.168.1.0/24', family: 4 },
  { label: 'A 类私有', value: '10.0.0.0/8', family: 4 },
  { label: 'B 类私有', value: '172.16.0.0/12', family: 4 },
  { label: '环回地址', value: '127.0.0.0/8', family: 4 },
  { label: '链路本地', value: '169.254.0.0/16', family: 4 },
  { label: '多播地址', value: '224.0.0.0/4', family: 4 },
  { label: '默认路由', value: '0.0.0.0/0', family: 4 },
  { label: '单机地址', value: '8.8.8.8/32', family: 4 },
  { label: 'IPv6 环回', value: '::1/128', family: 6 },
  { label: 'IPv6 链路本地', value: 'fe80::/10', family: 6 },
  { label: 'IPv6 唯一本地', value: 'fd00::/8', family: 6 },
  { label: 'IPv6 文档示例', value: '2001:db8::/32', family: 6 },
];

const IPV4_BITS = 32;
const IPV6_BITS = 128;
const IPV4_MAX = (1n << 32n) - 1n;
const IPV6_MAX = (1n << 128n) - 1n;

// IPv4 特殊地址段（用 [start, end] 表示闭区间）
const IPV4_PRIVATE: [bigint, bigint][] = [
  [0x0A000000n, 0x0AFFFFFFn], // 10.0.0.0/8
  [0xAC100000n, 0xAC1FFFFFn], // 172.16.0.0/12
  [0xC0A80000n, 0xC0A8FFFFn], // 192.168.0.0/16
];
const IPV4_LOOPBACK: [bigint, bigint] = [0x7F000000n, 0x7FFFFFFFn]; // 127.0.0.0/8
const IPV4_LINKLOCAL: [bigint, bigint] = [0xA9FE0000n, 0xA9FEFFFFn]; // 169.254.0.0/16
const IPV4_MULTICAST: [bigint, bigint] = [0xE0000000n, 0xEFFFFFFFn]; // 224.0.0.0/4
const IPV4_RESERVED: [bigint, bigint] = [0xF0000000n, 0xFFFFFFFFn]; // 240.0.0.0/4

// IPv6 特殊地址段（提前用 parseIpv6 计算，避免重复解析）
const IPV6_LOOPBACK = 1n; // ::1
const IPV6_FC00_START = 0xfc000000000000000000000000000000n; // fc00::/7 起始
const IPV6_FFFF_END = 0xfdffffffffffffffffffffffffffffffffffn; // fc00::/7 结束
const IPV6_FE80_START = 0xfe800000000000000000000000000000n; // fe80::/10 起始
const IPV6_FEBF_END = 0xfebfffffffffffffffffffffffffffffffn; // fe80::/10 结束

/** IPv4 八位组 -> BigInt */
function ipv4ToBigInt(octets: number[]): bigint {
  return (
    (BigInt(octets[0]) << 24n) |
    (BigInt(octets[1]) << 16n) |
    (BigInt(octets[2]) << 8n) |
    BigInt(octets[3])
  );
}

/** BigInt -> IPv4 八位组 */
function bigIntToIpv4Octets(val: bigint): number[] {
  return [
    Number((val >> 24n) & 0xFFn),
    Number((val >> 16n) & 0xFFn),
    Number((val >> 8n) & 0xFFn),
    Number(val & 0xFFn),
  ];
}

/** BigInt -> IPv6 八组 */
function bigIntToIpv6Groups(val: bigint): number[] {
  const groups: number[] = new Array(8);
  for (let i = 0; i < 8; i++) {
    // 高位在前：第 0 组是最高 16 位
    groups[i] = Number((val >> BigInt((7 - i) * 16)) & 0xFFFFn);
  }
  return groups;
}

/**
 * 解析 IPv6 字符串为 BigInt
 * 支持 :: 缩略、IPv4-mapped 后缀（如 ::ffff:192.168.1.1）、前导零省略
 * 解析失败返回 null
 */
function parseIpv6(input: string): bigint | null {
  let str = input.trim();
  if (!str) return null;

  // 处理 IPv4-mapped 后缀：末尾形如 a.b.c.d 转为 hex:hex
  const lastColon = str.lastIndexOf(':');
  if (lastColon !== -1 && str.includes('.')) {
    const tail = str.slice(lastColon + 1);
    const m = tail.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) {
      const octets = [m[1], m[2], m[3], m[4]].map(Number);
      if (octets.every((o) => o >= 0 && o <= 255)) {
        const hi = (octets[0] << 8) | octets[1];
        const lo = (octets[2] << 8) | octets[3];
        str = str.slice(0, lastColon + 1) + hi.toString(16) + ':' + lo.toString(16);
      } else {
        return null;
      }
    } else {
      return null;
    }
  }

  // 处理 :: 缩略：必须至多一处
  const doubleColonCount = (str.match(/::/g) || []).length;
  if (doubleColonCount > 1) return null;

  let groups: number[];
  if (doubleColonCount === 1) {
    // 用正则切分 :: 左右两部分
    const m = str.match(/^(.*?)::(.*?)$/);
    if (!m) return null;
    const left = m[1] ? m[1].split(':').filter((p) => p !== '') : [];
    const right = m[2] ? m[2].split(':').filter((p) => p !== '') : [];
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    const leftNums = left.map((g) => parseInt(g, 16));
    const rightNums = right.map((g) => parseInt(g, 16));
    if ([...leftNums, ...rightNums].some((n) => isNaN(n) || n < 0 || n > 0xFFFF)) return null;
    groups = [...leftNums, ...new Array(missing).fill(0), ...rightNums];
  } else {
    const parts = str.split(':');
    if (parts.length !== 8) return null;
    groups = parts.map((g) => parseInt(g, 16));
    if (groups.some((n) => isNaN(n) || n < 0 || n > 0xFFFF)) return null;
  }

  if (groups.length !== 8) return null;
  let val = 0n;
  for (const g of groups) {
    val = (val << 16n) | BigInt(g);
  }
  return val;
}

/** IPv6 八组 -> 压缩字符串（自动应用 :: 缩略最长连续零段） */
function ipv6CompressedString(groups: number[]): string {
  // 找出最长连续零段（长度 ≥ 2 才压缩）
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < groups.length; i++) {
    if (groups[i] === 0) {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }

  if (bestLen < 2) {
    return groups.map((g) => g.toString(16)).join(':');
  }
  const before = groups.slice(0, bestStart).map((g) => g.toString(16));
  const after = groups.slice(bestStart + bestLen).map((g) => g.toString(16));
  return `${before.join(':')}::${after.join(':')}`;
}

/** IPv6 八组 -> 完整字符串（每组补齐 4 位十六进制） */
function ipv6FullString(groups: number[]): string {
  return groups.map((g) => g.toString(16).padStart(4, '0')).join(':');
}

/** IPv6 八组 -> 二进制字符串（每组 16 位，按 : 分隔便于按位对齐） */
function ipv6BinaryString(groups: number[]): string {
  return groups.map((g) => g.toString(2).padStart(16, '0')).join(':');
}

/** 由 BigInt 与族构造 IpInfo */
function makeIpInfo(val: bigint, family: IpFamily): IpInfo {
  if (family === 4) {
    const octets = bigIntToIpv4Octets(val);
    const str = octets.join('.');
    return {
      family,
      bigintValue: val,
      octets,
      compressed: str,
      full: str,
      binary: octets.map((b) => b.toString(2).padStart(8, '0')).join('.'),
    };
  }
  const groups = bigIntToIpv6Groups(val);
  return {
    family,
    bigintValue: val,
    groups,
    compressed: ipv6CompressedString(groups),
    full: ipv6FullString(groups),
    binary: ipv6BinaryString(groups),
  };
}

/** 解析 IP 字符串 */
export function parseIp(input: string): { ok: true; info: IpInfo } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: '请输入 IP 地址' };

  if (trimmed.includes(':')) {
    const v = parseIpv6(trimmed);
    if (v === null) return { ok: false, error: '无效的 IPv6 地址' };
    return { ok: true, info: makeIpInfo(v, 6) };
  }
  // IPv4
  // 校验每段为纯数字，避免 parseInt("0x1f",10)=0 等隐式解析导致非法 IP 被接受
  const octets = trimmed.split('.').map((n) => (/^\d+$/.test(n) ? parseInt(n, 10) : NaN));
  if (octets.length !== 4 || octets.some((n) => isNaN(n) || n < 0 || n > 255)) {
    return { ok: false, error: '无效的 IPv4 地址（应为 4 个 0-255 数字，点分十进制）' };
  }
  return { ok: true, info: makeIpInfo(ipv4ToBigInt(octets), 4) };
}

/** 计算掩码 BigInt：前 prefix 位为 1，其余为 0 */
function computeNetmask(prefix: number, family: IpFamily): bigint {
  const totalBits = family === 4 ? IPV4_BITS : IPV6_BITS;
  if (prefix === 0) return 0n;
  if (prefix === totalBits) return family === 4 ? IPV4_MAX : IPV6_MAX;
  const hostBits = totalBits - prefix;
  return ((1n << BigInt(prefix)) - 1n) << BigInt(hostBits);
}

/** 检查 IPv4 是否私有 */
function isIpv4Private(val: bigint): boolean {
  return IPV4_PRIVATE.some(([lo, hi]) => val >= lo && val <= hi);
}

/** 检查 IPv6 是否唯一本地（fc00::/7） */
function isIpv6UniqueLocal(val: bigint): boolean {
  return val >= IPV6_FC00_START && val <= IPV6_FFFF_END;
}

/** 解析 CIDR 或 IP / 掩码 */
export function parseCidr(input: string): { ok: true; info: SubnetInfo } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: '请输入 CIDR 或 IP / 掩码' };

  // 拆分 IP 与前缀部分
  let ipPart: string;
  let prefixPart: string | null = null;
  if (trimmed.includes('/')) {
    const idx = trimmed.lastIndexOf('/');
    ipPart = trimmed.slice(0, idx);
    prefixPart = trimmed.slice(idx + 1);
  } else {
    ipPart = trimmed;
  }

  // 判断 IP 族并解析
  let family: IpFamily;
  let ipVal: bigint;
  if (ipPart.includes(':')) {
    family = 6;
    const v = parseIpv6(ipPart);
    if (v === null) return { ok: false, error: '无效的 IPv6 地址' };
    ipVal = v;
  } else {
    family = 4;
    const octets = ipPart.split('.').map((n) => parseInt(n, 10));
    if (octets.length !== 4 || octets.some((n) => isNaN(n) || n < 0 || n > 255)) {
      return { ok: false, error: '无效的 IPv4 地址（应为 4 个 0-255 数字，点分十进制）' };
    }
    ipVal = ipv4ToBigInt(octets);
  }

  const maxPrefix = family === 4 ? IPV4_BITS : IPV6_BITS;
  let prefix: number;

  if (prefixPart === null) {
    // 单 IP 默认 /32 或 /128
    prefix = maxPrefix;
  } else if (prefixPart.includes('.')) {
    // 点分掩码（仅 IPv4 支持）
    if (family !== 4) return { ok: false, error: 'IPv6 不支持点分掩码，请使用前缀长度' };
    const maskOctets = prefixPart.split('.').map((n) => parseInt(n, 10));
    if (maskOctets.length !== 4 || maskOctets.some((n) => isNaN(n) || n < 0 || n > 255)) {
      return { ok: false, error: '无效的子网掩码' };
    }
    const maskVal = ipv4ToBigInt(maskOctets);
    // 校验掩码为连续 1 后接连续 0
    let p = 0;
    for (let i = 31; i >= 0; i--) {
      if ((maskVal >> BigInt(i)) & 1n) p++;
      else break;
    }
    let valid = true;
    for (let i = 31 - p; i >= 0; i--) {
      if ((maskVal >> BigInt(i)) & 1n) {
        valid = false;
        break;
      }
    }
    if (!valid) return { ok: false, error: '子网掩码不合法（必须为连续的 1 后接连续的 0）' };
    prefix = p;
  } else {
    const p = parseInt(prefixPart, 10);
    if (isNaN(p) || p < 0 || p > maxPrefix) {
      return { ok: false, error: `前缀长度应在 0-${maxPrefix} 之间` };
    }
    prefix = p;
  }

  const totalBits = family === 4 ? IPV4_BITS : IPV6_BITS;
  const hostBits = totalBits - prefix;
  const netmask = computeNetmask(prefix, family);
  const wildcard = ~netmask & (family === 4 ? IPV4_MAX : IPV6_MAX);
  const networkAddress = ipVal & netmask;
  const broadcastAddress = family === 4 ? networkAddress | wildcard : null;

  // 主机范围：考虑边界情况
  let firstHost: bigint;
  let lastHost: bigint;
  if (family === 4) {
    if (prefix === 32) {
      firstHost = networkAddress;
      lastHost = networkAddress;
    } else if (prefix === 31) {
      // RFC 3021 point-to-point：无网络 / 广播保留
      firstHost = networkAddress;
      lastHost = broadcastAddress!;
    } else {
      firstHost = networkAddress + 1n;
      lastHost = broadcastAddress! - 1n;
    }
  } else {
    if (prefix === 128) {
      firstHost = networkAddress;
      lastHost = networkAddress;
    } else {
      // IPv6 无广播，第一个主机 = 网络 + 1，最后一个主机 = 网络 | wildcard
      firstHost = networkAddress + 1n;
      lastHost = networkAddress | wildcard;
    }
  }

  // 主机数
  const totalHosts = prefix === 0 ? 1n << BigInt(totalBits) : 1n << BigInt(hostBits);
  let usableHosts: bigint;
  if (family === 4) {
    usableHosts = prefix >= 31 ? totalHosts : totalHosts - 2n;
  } else {
    usableHosts = totalHosts;
  }

  // 类型判定
  const isPrivate = family === 4 ? isIpv4Private(ipVal) : isIpv6UniqueLocal(ipVal);
  const isLoopback = family === 4 ? ipVal >= IPV4_LOOPBACK[0] && ipVal <= IPV4_LOOPBACK[1] : ipVal === IPV6_LOOPBACK;
  const isMulticast = family === 4
    ? ipVal >= IPV4_MULTICAST[0] && ipVal <= IPV4_MULTICAST[1]
    : Number((ipVal >> 120n) & 0xFFn) === 0xFF;
  const isLinkLocal = family === 4
    ? ipVal >= IPV4_LINKLOCAL[0] && ipVal <= IPV4_LINKLOCAL[1]
    : ipVal >= IPV6_FE80_START && ipVal <= IPV6_FEBF_END;
  const isReserved = family === 4
    ? ipVal >= IPV4_RESERVED[0] && ipVal <= IPV4_RESERVED[1]
    : false;
  const isUnspecified = ipVal === 0n;

  // IPv4 类别（基于首个八位组）
  let ipClass: 'A' | 'B' | 'C' | 'D' | 'E' | undefined;
  if (family === 4) {
    const firstOctet = Number((ipVal >> 24n) & 0xFFn);
    if (firstOctet <= 126) ipClass = 'A';
    else if (firstOctet <= 191) ipClass = 'B';
    else if (firstOctet <= 223) ipClass = 'C';
    else if (firstOctet <= 239) ipClass = 'D';
    else ipClass = 'E';
  }

  return {
    ok: true,
    info: {
      family,
      input: trimmed,
      ip: makeIpInfo(ipVal, family),
      prefix,
      networkAddress: makeIpInfo(networkAddress, family),
      broadcastAddress: broadcastAddress !== null ? makeIpInfo(broadcastAddress, family) : null,
      netmask: makeIpInfo(netmask, family),
      wildcardMask: makeIpInfo(wildcard, family),
      firstHost: makeIpInfo(firstHost, family),
      lastHost: makeIpInfo(lastHost, family),
      totalHosts,
      usableHosts,
      isPrivate,
      isLoopback,
      isMulticast,
      isLinkLocal,
      isReserved,
      isUnspecified,
      ipClass,
      hostBits,
      networkBits: prefix,
    },
  };
}

/** 将一个 CIDR 划分为 N 个等长子网（N 必须为 2 的幂） */
export function divideSubnet(input: string, count: number): { ok: true; result: SubnetDivideResult } | { ok: false; error: string } {
  const parsed = parseCidr(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  if (!Number.isInteger(count) || count < 2 || count > 65536) {
    return { ok: false, error: '子网数量应在 2-65536 之间' };
  }
  // CIDR 划分要求 N 为 2 的幂
  const subnetBits = Math.log2(count);
  if (!Number.isInteger(subnetBits)) {
    return { ok: false, error: '子网数量必须是 2 的幂（2 / 4 / 8 / 16 ...）' };
  }

  const { info } = parsed;
  const totalBits = info.family === 4 ? IPV4_BITS : IPV6_BITS;
  const newPrefix = info.prefix + subnetBits;
  if (newPrefix > totalBits) {
    return { ok: false, error: `子网位数超出限制（新前缀 ${newPrefix} > 最大 ${totalBits}）` };
  }

  const newHostBits = totalBits - newPrefix;
  const subnetSize = newHostBits === 0 ? 1n : 1n << BigInt(newHostBits);
  const networkStart = info.networkAddress.bigintValue;
  const maxVal = info.family === 4 ? IPV4_MAX : IPV6_MAX;

  const subnets: SubnetDivideResult['subnets'] = [];
  for (let i = 0; i < count; i++) {
    const net = networkStart + BigInt(i) * subnetSize;
    if (net > maxVal) break;
    const wildcard = newHostBits === 0 ? 0n : (1n << BigInt(newHostBits)) - 1n;
    const bcast = info.family === 4 ? net | wildcard : null;

    let firstHost: bigint;
    let lastHost: bigint;
    if (info.family === 4) {
      if (newPrefix === 32) {
        firstHost = net;
        lastHost = net;
      } else if (newPrefix === 31) {
        firstHost = net;
        lastHost = bcast!;
      } else {
        firstHost = net + 1n;
        lastHost = bcast! - 1n;
      }
    } else {
      if (newPrefix === 128) {
        firstHost = net;
        lastHost = net;
      } else {
        firstHost = net + 1n;
        lastHost = net | wildcard;
      }
    }

    let usable: bigint;
    if (info.family === 4) {
      usable = newPrefix >= 31 ? subnetSize : subnetSize - 2n;
    } else {
      usable = subnetSize;
    }

    subnets.push({
      index: i,
      networkAddress: makeIpInfo(net, info.family),
      broadcastAddress: bcast !== null ? makeIpInfo(bcast, info.family) : null,
      firstHost: makeIpInfo(firstHost, info.family),
      lastHost: makeIpInfo(lastHost, info.family),
      usableHosts: usable,
    });
  }

  return {
    ok: true,
    result: {
      family: info.family,
      count,
      newPrefix,
      subnets,
    },
  };
}

/** 格式化 BigInt 主机数为可读字符串（如 4,294,967,294） */
export function formatHostCount(val: bigint): string {
  return val.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
