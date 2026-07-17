/**
 * DNS 查询工具核心逻辑（DNS over HTTPS）
 *
 * 全部在浏览器本地处理，查询请求由用户主动发起，
 * 直连用户选择的公共 DoH 服务器，不经过本站服务器。
 *
 * 协议依据：
 *  - RFC 8484：DNS over HTTPS（DoH）
 *  - RFC 1035：DNS 报文与 RCODE
 *  - RFC 6698：TLSA 记录与 DANE
 *  - RFC 6844：CAA 记录
 *  - RFC 9460：SVCB / HTTPS 记录
 *
 * 支持的 DoH 服务商均启用 CORS，可直接浏览器跨域调用：
 *  - Cloudflare 1.1.1.1
 *  - Google Public DNS
 *  - DNS.SB
 */

/** DNS 记录类型代码（数值与 RFC 1035 / IANA 注册表一致） */
export type RecordTypeCode =
  | 1   // A
  | 2   // NS
  | 5   // CNAME
  | 6   // SOA
  | 12  // PTR
  | 15  // MX
  | 16  // TXT
  | 28  // AAAA
  | 33  // SRV
  | 35  // NAPTR
  | 43  // DS
  | 48  // DNSKEY
  | 52  // TLSA
  | 64  // SVCB
  | 65  // HTTPS
  | 257; // CAA

/** 记录类型元信息 */
export interface RecordTypeMeta {
  code: RecordTypeCode;
  name: string;        // 标准名称（大写）
  label: string;       // 中文标签
  summary: string;     // 一句话说明
  example: string;     // 典型场景
}

/** 支持查询的 DNS 记录类型清单（按使用频率排序） */
export const RECORD_TYPES: RecordTypeMeta[] = [
  { code: 1, name: 'A', label: 'IPv4 地址', summary: '域名到 IPv4 地址的映射', example: '网站 IPv4 解析' },
  { code: 28, name: 'AAAA', label: 'IPv6 地址', summary: '域名到 IPv6 地址的映射', example: '网站 IPv6 解析' },
  { code: 5, name: 'CNAME', label: '别名记录', summary: '将域名指向另一域名', example: 'CDN / 域名跳转' },
  { code: 15, name: 'MX', label: '邮件交换', summary: '指定接收邮件的服务器', example: '邮箱服务配置' },
  { code: 16, name: 'TXT', label: '文本记录', summary: '任意文本，常用于所有权验证与 SPF/DKIM', example: 'Google 验证、SPF' },
  { code: 2, name: 'NS', label: '名称服务器', summary: '指定域名由哪些 DNS 服务器解析', example: '域名注册商配置' },
  { code: 6, name: 'SOA', label: '起始授权', summary: '区域主权威服务器信息与全局参数', example: '主从同步、TTL 控制' },
  { code: 12, name: 'PTR', label: '反向解析', summary: 'IP 反查域名（需输入 in-addr.arpa）', example: '邮件反垃圾' },
  { code: 257, name: 'CAA', label: 'CA 授权', summary: '指定允许签发证书的 CA', example: '限制 Let\'s Encrypt 等' },
  { code: 33, name: 'SRV', label: '服务记录', summary: '指定服务的端口、主机、优先级', example: 'SIP / XMPP / AD' },
  { code: 43, name: 'DS', label: '委托签名', summary: 'DNSSEC 链中父区对子区 KSK 的签名', example: 'DNSSEC 部署验证' },
  { code: 48, name: 'DNSKEY', label: 'DNS 公钥', summary: '区域签名用的公钥（KSK/ZSK）', example: 'DNSSEC 验证' },
  { code: 52, name: 'TLSA', label: 'TLS 认证', summary: '绑定 TLS 证书指纹（DANE）', example: '邮件 MTA-STS 增强' },
  { code: 65, name: 'HTTPS', label: 'HTTPS 记录', summary: '指定 HTTPS 后端与参数（HTTP/3）', example: 'HTTP/3 升级提示' },
  { code: 64, name: 'SVCB', label: '服务绑定', summary: '通用服务绑定（HTTPS 通用版）', example: 'Aliasing / 协议参数' },
  { code: 35, name: 'NAPTR', label: '命名授权指针', summary: 'URI / 电话号码映射规则', example: 'SIP / E.164 号码' },
];

/** 通过名称查找记录类型元信息 */
export function findRecordTypeByName(name: string): RecordTypeMeta | undefined {
  const upper = name.trim().toUpperCase();
  return RECORD_TYPES.find((t) => t.name === upper);
}

/** DoH 服务商元信息 */
export interface DohProviderMeta {
  id: string;            // 唯一标识
  name: string;          // 显示名
  endpoint: string;      // JSON API 端点（GET 模式）
  homepage: string;      // 官网
  description: string;  // 简介
  privacy: string;      // 隐私特点
}

/**
 * 内置 DoH 服务商
 * 仅保留明确支持 CORS 的服务商，避免浏览器跨域失败
 */
export const DOH_PROVIDERS: DohProviderMeta[] = [
  {
    id: 'cloudflare',
    name: 'Cloudflare 1.1.1.1',
    endpoint: 'https://cloudflare-dns.com/dns-query',
    homepage: 'https://1.1.1.1',
    description: 'Cloudflare 与 APNIC 联合运营的公共 DNS，主打隐私与速度',
    privacy: '永久不记录查询者 IP，48 小时内删除日志',
  },
  {
    id: 'google',
    name: 'Google Public DNS',
    endpoint: 'https://dns.google/resolve',
    homepage: 'https://dns.google',
    description: 'Google 提供的公共 DNS，全球节点覆盖广泛',
    privacy: '临时日志 24-48 小时后删除，不与广告关联',
  },
  {
    id: 'dnssb',
    name: 'DNS.SB',
    endpoint: 'https://doh.dns.sb/dns-query',
    homepage: 'https://dns.sb',
    description: '亚太与欧洲多节点公共 DoH/DoT，无审查',
    privacy: '不记录用户 IP，仅保留临时缓存',
  },
];

/** 通过 ID 查找服务商 */
export function findDohProvider(id: string): DohProviderMeta {
  return DOH_PROVIDERS.find((p) => p.id === id) ?? DOH_PROVIDERS[0];
}

/** DNS 响应状态码（RFC 1035 RCODE + 扩展） */
export const RCODE_MAP: Record<number, { name: string; label: string; hint: string }> = {
  0: { name: 'NOERROR', label: '查询成功', hint: '域名存在且至少返回一条记录' },
  1: { name: 'FORMERR', label: '格式错误', hint: 'DoH 服务器无法解析请求格式' },
  2: { name: 'SERVFAIL', label: '服务器失败', hint: '上游 DNS 服务器异常，可换服务商重试' },
  3: { name: 'NXDOMAIN', label: '域名不存在', hint: '该域名未被注册或已删除' },
  4: { name: 'NOTIMP', label: '未实现', hint: 'DoH 服务器不支持该记录类型' },
  5: { name: 'REFUSED', label: '查询被拒', hint: '请求被策略拒绝（如内网专用记录）' },
};

/** 单条 DNS 记录（DoH JSON 响应项） */
export interface DnsRecord {
  name: string;     // 记录名（通常以 . 结尾）
  type: number;     // 类型代码（数字）
  TTL: number;      // 生存时间（秒）
  data: string;     // 原始数据字符串
}

/** DoH JSON 响应体（仅含本工具关心的字段） */
export interface DohResponse {
  Status: number;
  TC: boolean;       // 是否截断
  RD: boolean;        // 期望递归
  RA: boolean;        // 支持递归
  AD: boolean;        // 已验证（DNSSEC）
  CD: boolean;        // 关闭校验
  Question?: DnsRecord[];
  Answer?: DnsRecord[];
  Authority?: DnsRecord[];
  Additional?: DnsRecord[];
}

/** 查询请求参数 */
export interface DnsQueryParams {
  name: string;          // 待查询域名（如 example.com）
  typeCode: RecordTypeCode;
  providerId: string;    // DoH 服务商 ID
  doDnssec?: boolean;    // 是否请求 DNSSEC 验证（CD=0）
}

/** 查询结果（成功） */
export interface DnsQuerySuccess {
  ok: true;
  params: DnsQueryParams;
  provider: DohProviderMeta;
  startedAt: number;     // 发起时间戳（ms）
  elapsedMs: number;     // 耗时（ms）
  response: DohResponse;
}

/** 查询结果（失败） */
export interface DnsQueryFailure {
  ok: false;
  params: DnsQueryParams;
  provider: DohProviderMeta;
  startedAt: number;
  elapsedMs: number;
  error: string;          // 友好错误描述
  rawError?: unknown;     // 原始错误对象（调试用）
}

export type DnsQueryResult = DnsQuerySuccess | DnsQueryFailure;

/**
 * 域名格式校验
 * 接受常规域名（example.com、a.b.example.co.uk）与反向解析格式（1.0.0.127.in-addr.arpa）
 * 拒绝带协议、端口、路径、空格的输入
 */
export function isValidDomain(input: string): boolean {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed || trimmed.length > 253) return false;
  // 反向解析特殊格式
  if (trimmed.endsWith('.in-addr.arpa') || trimmed.endsWith('.ip6.arpa')) {
    return /^[a-z0-9.\-]+\.(in-addr|ip6)\.arpa$/.test(trimmed);
  }
  // 拒绝带协议、端口、路径
  if (/[:/\\?#@\s]/.test(trimmed)) return false;
  // 每段 1-63 字符，字母数字与连字符，不以连字符开头或结尾
  const labels = trimmed.split('.');
  if (labels.length < 2) return false;
  return labels.every((label) => {
    if (!label || label.length > 63) return false;
    if (label.startsWith('-') || label.endsWith('-')) return false;
    return /^[a-z0-9\-]+$/.test(label);
  });
}

/**
 * 规整化域名输入：去除协议前缀、路径、空白与末尾点
 * 用于容忍用户粘贴完整 URL 的场景
 */
export function normalizeDomain(input: string): string {
  let s = input.trim();
  // 去除协议前缀
  s = s.replace(/^[a-zA-Z]+:\/\//, '');
  // 截断到第一个 / 之前
  const slashIdx = s.indexOf('/');
  if (slashIdx > 0) s = s.slice(0, slashIdx);
  // 去除端口
  s = s.replace(/:\d+$/, '');
  // 去除末尾点
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s.toLowerCase();
}

/** 构造 DoH GET 请求 URL（含查询参数） */
function buildDohUrl(provider: DohProviderMeta, params: DnsQueryParams): string {
  const url = new URL(provider.endpoint);
  url.searchParams.set('name', params.name);
  url.searchParams.set('type', String(params.typeCode));
  // 默认开启 DNSSEC 验证（AD 位），如用户主动关闭则设置 cd=1
  url.searchParams.set('cd', params.doDnssec === false ? '1' : '0');
  return url.toString();
}

/**
 * 执行 DNS 查询
 * - 仅在浏览器环境调用（依赖 fetch + CORS）
 * - 失败时返回友好的中文错误信息
 */
export async function queryDns(params: DnsQueryParams): Promise<DnsQueryResult> {
  const provider = findDohProvider(params.providerId);
  const startedAt = Date.now();
  try {
    const url = buildDohUrl(provider, params);
    const resp = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/dns-json' },
      cache: 'no-store',
    });
    const elapsedMs = Date.now() - startedAt;
    if (!resp.ok) {
      return {
        ok: false,
        params,
        provider,
        startedAt,
        elapsedMs,
        error: `DoH 服务返回 HTTP ${resp.status} ${resp.statusText}，请稍后重试或更换服务商`,
      };
    }
    const data = (await resp.json()) as DohResponse;
    return { ok: true, params, provider, startedAt, elapsedMs, response: data };
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    // 区分网络错误与 CORS 拦截
    let error = '查询失败：请检查网络连接';
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      error = '浏览器无法连接 DoH 服务器，可能被网络拦截或服务商暂不可用，请更换服务商重试';
    } else if (msg.includes('CORS')) {
      error = 'CORS 跨域拦截：该 DoH 服务商可能未开放跨域，请更换服务商';
    } else {
      error = `查询失败：${msg}`;
    }
    return { ok: false, params, provider, startedAt, elapsedMs, error, rawError: err };
  }
}

/** 将 TTL（秒）格式化为人类可读文本 */
export function formatTtl(ttl: number): string {
  if (ttl < 60) return `${ttl} 秒`;
  if (ttl < 3600) return `${Math.floor(ttl / 60)} 分 ${ttl % 60} 秒`;
  if (ttl < 86400) return `${Math.floor(ttl / 3600)} 小时 ${Math.floor((ttl % 3600) / 60)} 分`;
  return `${Math.floor(ttl / 86400)} 天 ${Math.floor((ttl % 86400) / 3600)} 小时`;
}

/** 将毫秒耗时格式化为友好文本 */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} 秒`;
}

/** 通过类型代码查找记录类型元信息 */
export function findRecordTypeByCode(code: number): RecordTypeMeta | undefined {
  return RECORD_TYPES.find((t) => t.code === code);
}

/** 获取记录类型的友好名称（如 1 → "A"） */
export function recordTypeName(code: number): string {
  return findRecordTypeByCode(code)?.name ?? `TYPE${code}`;
}

/**
 * 格式化单条记录的 data 字段为更易读的形式
 * - MX：拆分优先级与主机
 * - TXT：去除包裹引号、连接多段
 * - SOA：拆分 7 个字段
 * - SRV：拆分优先级/权重/端口/目标
 * - CAA：拆分 flag/tag/value
 */
export function formatRecordData(record: DnsRecord): string {
  const typeName = recordTypeName(record.type);
  const raw = record.data;
  switch (typeName) {
    case 'MX': {
      const m = raw.match(/^(\d+)\s+(.+)$/);
      if (m) return `优先级 ${m[1]} → ${m[2]}`;
      return raw;
    }
    case 'TXT': {
      // TXT 数据常被双引号包裹，多段以空格连接
      const joined = raw.replace(/"\s+"/g, '').replace(/^"/, '').replace(/"$/, '');
      return joined;
    }
    case 'SOA': {
      const parts = raw.split(/\s+/);
      if (parts.length >= 7) {
        const [mname, rname, serial, refresh, retry, expire, minimum] = parts;
        return `主服务器 ${mname} | 邮箱 ${rname} | 序列号 ${serial} | 刷新 ${refresh} | 重试 ${retry} | 过期 ${expire} | 最小 TTL ${minimum}`;
      }
      return raw;
    }
    case 'SRV': {
      const parts = raw.split(/\s+/);
      if (parts.length >= 4) {
        return `优先级 ${parts[0]} | 权重 ${parts[1]} | 端口 ${parts[2]} | 目标 ${parts[3]}`;
      }
      return raw;
    }
    case 'CAA': {
      const m = raw.match(/^(\d+)\s+(\w+)\s+"(.*)"$/);
      if (m) {
        const flag = m[1];
        const tag = m[2];
        const value = m[3];
        const flagHint = flag === '0' ? '允许颁发' : '仅限报告（critical）';
        return `Flag ${flag}（${flagHint}） | Tag ${tag} | Value ${value}`;
      }
      return raw;
    }
    case 'HTTPS':
    case 'SVCB': {
      // SVCB/HTTPS 格式：priority target params...
      const parts = raw.split(/\s+/);
      if (parts.length >= 2) {
        const priority = parts[0];
        const target = parts[1];
        const params = parts.slice(2).join(' ');
        const priorityHint = priority === '0' ? 'AliasMode（同 SVCB）' : 'ServiceMode（优先级 ' + priority + '）';
        return `${priorityHint} | 目标 ${target}${params ? ' | 参数 ' + params : ''}`;
      }
      return raw;
    }
    default:
      return raw;
  }
}

/** 预设示例域名（覆盖不同记录类型的典型场景） */
export interface PresetDomain {
  id: string;
  label: string;
  name: string;
  typeCode: RecordTypeCode;
  description: string;
}

export const PRESET_DOMAINS: PresetDomain[] = [
  { id: 'a-cloudflare', label: 'IPv4 解析', name: 'cloudflare.com', typeCode: 1, description: '查询 Cloudflare 的 A 记录（IPv4 地址）' },
  { id: 'aaaa-github', label: 'IPv6 解析', name: 'github.com', typeCode: 28, description: '查询 GitHub 的 AAAA 记录（IPv6 地址）' },
  { id: 'cname-cdn', label: 'CDN 别名', name: 'www.cloudflare.com', typeCode: 5, description: '查询 CDN 域名的 CNAME 链' },
  { id: 'mx-gmail', label: '邮件服务器', name: 'gmail.com', typeCode: 15, description: '查询 Gmail 的 MX 记录（邮件服务器）' },
  { id: 'txt-spf', label: 'SPF 文本', name: 'gmail.com', typeCode: 16, description: '查询 Gmail 的 TXT 记录（含 SPF 反垃圾配置）' },
  { id: 'ns-root', label: '权威 NS', name: 'root-servers.net', typeCode: 2, description: '查询根服务器的 NS 记录' },
  { id: 'caa-letsencrypt', label: 'CA 授权', name: 'letsencrypt.org', typeCode: 257, description: '查询 Let\'s Encrypt 的 CAA 记录' },
  { id: 'https-record', label: 'HTTPS 记录', name: 'cloudflare.com', typeCode: 65, description: '查询 Cloudflare 的 HTTPS 记录（HTTP/3 升级）' },
  { id: 'dnskey-root', label: 'DNSSEC 公钥', name: '.', typeCode: 48, description: '查询根区域的 DNSKEY（DNSSEC 链起点）' },
  { id: 'ds-cloudflare', label: 'DS 签名', name: 'com', typeCode: 43, description: '查询 .com 区域的 DS 记录' },
];

/** DNSSEC 验证状态解读 */
export function describeDnssecAd(ad: boolean, cd: boolean): { label: string; hint: string; level: 'success' | 'warning' | 'info' } {
  if (cd) {
    return { label: '已关闭验证', hint: '本次查询设置 cd=1，DoH 服务器未执行 DNSSEC 校验', level: 'info' };
  }
  if (ad) {
    return { label: '已验证通过', hint: 'AD=1，DoH 服务器已对结果执行 DNSSEC 验证且数据可信', level: 'success' };
  }
  return { label: '未验证', hint: 'AD=0，结果可能未通过 DNSSEC 验证或域名未部署 DNSSEC', level: 'warning' };
}

/** 导出为 dig 风格的文本（便于复制分享） */
export function exportAsDigText(result: DnsQuerySuccess): string {
  const lines: string[] = [];
  const { provider, params, elapsedMs, response } = result;
  const typeName = recordTypeName(params.typeCode);
  lines.push(`; 查询：${params.name} ${typeName}（DoH: ${provider.name}）`);
  lines.push(`; 耗时：${formatElapsed(elapsedMs)}`);
  lines.push(`; Status: ${response.Status} ${RCODE_MAP[response.Status]?.name ?? 'UNKNOWN'}`);
  lines.push(`; AD=${response.AD ? 1 : 0} CD=${response.CD ? 1 : 0} RD=${response.RD ? 1 : 0} RA=${response.RA ? 1 : 0}`);
  lines.push('');
  const writeSection = (title: string, records?: DnsRecord[]) => {
    if (!records || records.length === 0) return;
    lines.push(`;; ${title} SECTION (${records.length} records)`);
    for (const r of records) {
      const name = r.name.padEnd(28);
      const ttl = String(r.TTL).padStart(6);
      const rtype = recordTypeName(r.type).padEnd(8);
      lines.push(`${name} ${ttl} IN ${rtype} ${r.data}`);
    }
    lines.push('');
  };
  writeSection('QUESTION', response.Question);
  writeSection('ANSWER', response.Answer);
  writeSection('AUTHORITY', response.Authority);
  writeSection('ADDITIONAL', response.Additional);
  return lines.join('\n');
}
