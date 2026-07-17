/**
 * TLS 证书解析工具核心逻辑（X.509 / ASN.1 DER）
 *
 * 全部在浏览器本地处理：
 *  - 用户粘贴 PEM 文本，仅在本机内存解析，不发送任何网络请求
 *  - ASN.1 DER 解析为递归下降，纯 JS 实现，零依赖
 *  - 指纹计算使用浏览器原生 Web Crypto API（crypto.subtle.digest）
 *
 * 协议依据：
 *  - RFC 5280：Internet X.509 Public Key Infrastructure Certificate and CRL Profile
 *  - RFC 8017：PKCS #1 RSA 加密与签名算法
 *  - RFC 5480：Elliptic Curve Cryptography Subject Public Key Information
 *  - RFC 6960：OCSP（在线证书状态协议）
 *  - RFC 6962：证书透明度（SCT）
 *  - ITU-T X.680 / X.690：ASN.1 与 DER 编码规则
 */

/* ============================================================
 * 1. ASN.1 DER 解析器
 * ============================================================ */

/** ASN.1 Tag 类别 */
export type TagClass = 'UNIVERSAL' | 'APPLICATION' | 'CONTEXT' | 'PRIVATE';

/** ASN.1 通用 Tag 类型（仅列出 X.509 中常见的） */
export type UniversalTag =
  | 'BOOLEAN' | 'INTEGER' | 'BIT_STRING' | 'OCTET_STRING'
  | 'NULL' | 'OID' | 'UTF8String' | 'SEQUENCE' | 'SET'
  | 'PrintableString' | 'IA5String' | 'T61String' | 'BMPString'
  | 'UTCTime' | 'GeneralizedTime' | 'UNKNOWN';

/** ASN.1 节点（DER 解析结果） */
export interface Asn1Node {
  /** 原始 tag 字节 */
  tagByte: number;
  /** tag 类别 */
  tagClass: TagClass;
  /** 是否为构造类型（含子节点） */
  constructed: boolean;
  /** 通用类型名称（仅 UNIVERSAL 类别有意义） */
  universalTag: UniversalTag;
  /** 上下文特定标签的编号（仅 CONTEXT 类别有意义） */
  contextNumber: number | null;
  /** 内容字节长度 */
  length: number;
  /** 内容字节在原始缓冲区中的起始偏移 */
  valueOffset: number;
  /** 内容字节视图（不拷贝，引用原缓冲区） */
  value: Uint8Array;
  /** 子节点（仅构造类型有值） */
  children: Asn1Node[];
}

const TAG_UNIVERSAL_NAMES: Record<number, UniversalTag> = {
  0x01: 'BOOLEAN',
  0x02: 'INTEGER',
  0x03: 'BIT_STRING',
  0x04: 'OCTET_STRING',
  0x05: 'NULL',
  0x06: 'OID',
  0x0C: 'UTF8String',
  0x10: 'SEQUENCE', // 0x30 实际是构造 SEQUENCE，这里仅放低 5 位
  0x11: 'SET',
  0x13: 'PrintableString',
  0x16: 'IA5String',
  0x14: 'T61String',
  0x1E: 'BMPString',
  0x17: 'UTCTime',
  0x18: 'GeneralizedTime',
};

/** 解析 DER 单个节点（递归） */
function parseAsn1Node(der: Uint8Array, start: number): { node: Asn1Node; next: number } {
  if (start >= der.length) {
    throw new Error('ASN.1 解析失败：数据不完整（超出缓冲区）');
  }
  const tagByte = der[start];
  const tagClass = (tagByte & 0xC0) >> 6; // 高 2 位
  const constructed = (tagByte & 0x20) !== 0; // 第 6 位
  const tagNumber = tagByte & 0x1F; // 低 5 位

  // 处理多字节 tag（tagNumber === 31），X.509 中几乎不出现，此处简化报错
  if (tagNumber === 31) {
    throw new Error('ASN.1 解析失败：不支持多字节 tag');
  }

  let pos = start + 1;
  if (pos >= der.length) {
    throw new Error('ASN.1 解析失败：缺少长度字节');
  }
  const firstLen = der[pos];
  pos++;
  let length = 0;
  if (firstLen < 0x80) {
    // 短格式
    length = firstLen;
  } else {
    // 长格式：高位为 1，低 7 位表示后续长度字节数
    const numBytes = firstLen & 0x7F;
    if (numBytes === 0) {
      throw new Error('ASN.1 解析失败：不支持不定长编码（DER 不允许）');
    }
    if (numBytes > 4) {
      throw new Error(`ASN.1 解析失败：长度字节数过大 (${numBytes})`);
    }
    if (pos + numBytes > der.length) {
      throw new Error('ASN.1 解析失败：长度字段不完整');
    }
    for (let i = 0; i < numBytes; i++) {
      length = (length << 8) | der[pos + i];
    }
    pos += numBytes;
  }
  const valueOffset = pos;
  if (valueOffset + length > der.length) {
    throw new Error(`ASN.1 解析失败：内容超出缓冲区（声明 ${length} 字节）`);
  }
  // 注意：Uint8Array.subarray 是视图，不拷贝
  const value = der.subarray(valueOffset, valueOffset + length);

  // 构造类节点递归解析子节点
  const children: Asn1Node[] = [];
  if (constructed) {
    let childStart = valueOffset;
    while (childStart < valueOffset + length) {
      const { node: child, next } = parseAsn1Node(der, childStart);
      children.push(child);
      childStart = next;
    }
  }

  const tagClassName: TagClass =
    tagClass === 0 ? 'UNIVERSAL' :
    tagClass === 1 ? 'APPLICATION' :
    tagClass === 2 ? 'CONTEXT' : 'PRIVATE';

  const node: Asn1Node = {
    tagByte,
    tagClass: tagClassName,
    constructed,
    universalTag: tagClassName === 'UNIVERSAL' ? (TAG_UNIVERSAL_NAMES[tagNumber] || 'UNKNOWN') : 'UNKNOWN',
    contextNumber: tagClassName === 'CONTEXT' ? tagNumber : null,
    length,
    valueOffset,
    value,
    children,
  };
  return { node, next: valueOffset + length };
}

/** 解析顶层 DER 节点（封装入口） */
export function parseAsn1(der: Uint8Array): Asn1Node {
  return parseAsn1Node(der, 0).node;
}

/* ============================================================
 * 2. PEM 解析
 * ============================================================ */

/** 单个 PEM 块 */
export interface PemBlock {
  /** PEM 类型标签，如 CERTIFICATE / RSA PRIVATE KEY / EC PRIVATE KEY */
  label: string;
  /** DER 字节 */
  der: Uint8Array;
}

/**
 * 解析 PEM 文本，支持单个或多个块（如完整证书链）
 * 兼容常见格式：-----BEGIN CERTIFICATE----- ... -----END CERTIFICATE-----
 */
export function parsePem(input: string): PemBlock[] {
  const blocks: PemBlock[] = [];
  // 正则匹配 BEGIN/END 之间的 Base64 内容
  const re = /-----BEGIN ([A-Z0-9 ]+)-----\s*([\s\S]*?)-----END \1-----/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    const label = match[1].trim();
    const b64 = match[2].replace(/\s+/g, '');
    try {
      // atob 输出二进制字符串，需逐字节转 Uint8Array
      const binStr = atob(b64);
      const der = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) {
        der[i] = binStr.charCodeAt(i);
      }
      blocks.push({ label, der });
    } catch (e) {
      throw new Error(`PEM 块 ${label} 的 Base64 解码失败：${(e as Error).message}`);
    }
  }
  if (blocks.length === 0) {
    // 用户可能直接粘贴了 Base64 或 DER hex
    const trimmed = input.trim();
    if (/^[0-9a-fA-F\s]+$/.test(trimmed) && trimmed.replace(/\s/g, '').length % 2 === 0) {
      // 尝试作为 hex 处理
      const hex = trimmed.replace(/\s/g, '');
      const der = new Uint8Array(hex.length / 2);
      for (let i = 0; i < der.length; i++) {
        der[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
      }
      blocks.push({ label: 'CERTIFICATE', der });
    } else if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed)) {
      // 尝试作为裸 Base64 处理
      const b64 = trimmed.replace(/\s+/g, '');
      try {
        const binStr = atob(b64);
        const der = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) {
          der[i] = binStr.charCodeAt(i);
        }
        blocks.push({ label: 'CERTIFICATE', der });
      } catch {
        throw new Error('未识别到 PEM 块，且无法作为 Base64 或 hex 解码');
      }
    } else {
      throw new Error('未识别到 PEM 块，请检查输入格式');
    }
  }
  return blocks;
}

/* ============================================================
 * 3. OID 映射表
 * ============================================================ */

/** OID 名称映射（X.509 常见 OID） */
export const OID_NAMES: Record<string, string> = {
  // 签名算法
  '1.2.840.113549.1.1.1': 'rsaEncryption',
  '1.2.840.113549.1.1.5': 'sha1WithRSAEncryption',
  '1.2.840.113549.1.1.11': 'sha256WithRSAEncryption',
  '1.2.840.113549.1.1.12': 'sha384WithRSAEncryption',
  '1.2.840.113549.1.1.13': 'sha512WithRSAEncryption',
  '1.2.840.113549.1.1.10': 'rsassaPss',
  '1.2.840.10045.2.1': 'ecPublicKey',
  '1.2.840.10045.4.3.1': 'ecdsa-with-SHA224',
  '1.2.840.10045.4.3.2': 'ecdsa-with-SHA256',
  '1.2.840.10045.4.3.3': 'ecdsa-with-SHA384',
  '1.2.840.10045.4.3.4': 'ecdsa-with-SHA512',
  '1.3.101.112': 'Ed25519',
  '1.3.101.113': 'Ed448',
  '1.3.101.110': 'X25519',
  '1.3.101.111': 'X448',

  // 主体/签发者属性
  '2.5.4.3': 'commonName',
  '2.5.4.4': 'surname',
  '2.5.4.5': 'serialNumber',
  '2.5.4.6': 'countryName',
  '2.5.4.7': 'localityName',
  '2.5.4.8': 'stateOrProvinceName',
  '2.5.4.9': 'streetAddress',
  '2.5.4.10': 'organizationName',
  '2.5.4.11': 'organizationalUnitName',
  '2.5.4.12': 'title',
  '2.5.4.42': 'givenName',
  '1.2.840.113549.1.9.1': 'emailAddress',
  '0.9.2342.19200300.100.1.25': 'domainComponent',
  '2.5.4.97': 'organizationIdentifier',

  // 椭圆曲线
  '1.2.840.10045.3.1.7': 'prime256v1 (P-256)',
  '1.3.132.0.34': 'secp384r1 (P-384)',
  '1.3.132.0.35': 'secp521r1 (P-521)',
  '1.3.132.0.10': 'secp256k1',

  // 扩展
  '2.5.29.14': 'subjectKeyIdentifier',
  '2.5.29.15': 'keyUsage',
  '2.5.29.17': 'subjectAltName',
  '2.5.29.18': 'issuerAltName',
  '2.5.29.19': 'basicConstraints',
  '2.5.29.20': 'CRLNumber',
  '2.5.29.21': 'CRLReason',
  '2.5.29.31': 'cRLDistributionPoints',
  '2.5.29.32': 'certificatePolicies',
  '2.5.29.35': 'authorityKeyIdentifier',
  '2.5.29.37': 'extKeyUsage',
  '2.5.29.46': 'freshestCRL',
  '2.5.29.54': 'inhibitAnyPolicy',
  '1.3.6.1.5.5.7.1.1': 'authorityInfoAccess',
  '1.3.6.1.5.5.7.1.11': 'subjectInfoAccess',
  '1.3.6.1.4.1.11129.2.4.2': 'signedCertificateTimestampList',
  '1.3.6.1.5.5.7.3.1': 'serverAuth',
  '1.3.6.1.5.5.7.3.2': 'clientAuth',
  '1.3.6.1.5.5.7.3.3': 'codeSigning',
  '1.3.6.1.5.5.7.3.4': 'emailProtection',
  '1.3.6.1.5.5.7.3.8': 'timeStamping',
  '1.3.6.1.5.5.7.3.9': 'OCSPSigning',

  // 证书策略
  '2.23.140.1.1': 'ev-policy',
  '2.23.140.1.2.1': 'domain-validated',
  '2.23.140.1.2.2': 'iv-policy',
  '1.2.840.113549.1.9.16.2.14': 'id-on-permanentIdentifier',
};

/** 取 OID 友好名（无映射则返回原始 OID） */
export function oidName(oid: string): string {
  return OID_NAMES[oid] || oid;
}

/* ============================================================
 * 4. 类型辅助：从 Asn1Node 取值的工具函数
 * ============================================================ */

/** 解析 OID 节点为点分字符串 */
function decodeOid(node: Asn1Node): string {
  if (node.universalTag !== 'OID') {
    throw new Error('期望 OID 节点');
  }
  const bytes = node.value;
  if (bytes.length === 0) return '';
  const first = bytes[0];
  // 第一字节 = 40 * X + Y
  const parts: string[] = [String(Math.floor(first / 40)), String(first % 40)];
  let value = 0;
  for (let i = 1; i < bytes.length; i++) {
    const b = bytes[i];
    value = (value << 7) | (b & 0x7F);
    if ((b & 0x80) === 0) {
      parts.push(String(value));
      value = 0;
    }
  }
  return parts.join('.');
}

/** 解析 INTEGER 节点为十六进制字符串（大数） */
function decodeIntegerHex(node: Asn1Node): string {
  if (node.universalTag !== 'INTEGER') {
    throw new Error('期望 INTEGER 节点');
  }
  const bytes = node.value;
  if (bytes.length === 0) return '00';
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/** 解析 INTEGER 节点为十进制字符串（用于序列号展示，可能很长） */
function decodeIntegerDecimal(node: Asn1Node): string {
  const hex = decodeIntegerHex(node);
  // 去除前导 0
  const trimmed = hex.replace(/^0+/, '') || '0';
  // 大数转十进制
  let decimal = BigInt('0x' + trimmed).toString(10);
  return decimal;
}

/** 解析 BOOLEAN 节点 */
function decodeBoolean(node: Asn1Node): boolean {
  if (node.universalTag !== 'BOOLEAN') {
    throw new Error('期望 BOOLEAN 节点');
  }
  return node.value.length > 0 && node.value[0] !== 0;
}

/** 解析时间节点（UTCTime 或 GeneralizedTime） */
function decodeTime(node: Asn1Node): Date {
  const str = decodeString(node);
  // UTCTime: YYMMDDHHMMSSZ 或 YYMMDDHHMMZ（RFC 5280 强制 Z）
  // GeneralizedTime: YYYYMMDDHHMMSSZ
  let iso: string;
  if (node.universalTag === 'UTCTime') {
    // 2 位年份：>=50 视为 19xx，<50 视为 20xx（RFC 5280）
    const yy = parseInt(str.substring(0, 2), 10);
    const year = yy >= 50 ? 1900 + yy : 2000 + yy;
    iso = `${year}${str.substring(2)}`;
  } else {
    iso = str;
  }
  // 转为 ISO 8601：YYYYMMDDHHMMSSZ → YYYY-MM-DDTHH:MM:SSZ
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z?$/.exec(iso);
  if (!m) {
    throw new Error(`时间格式无效：${str}`);
  }
  // Date.UTC 处理 UTC 时间
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

/** 解析字符串节点 */
function decodeString(node: Asn1Node): string {
  switch (node.universalTag) {
    case 'UTF8String':
    case 'PrintableString':
    case 'IA5String':
    case 'T61String':
      return new TextDecoder('utf-8').decode(node.value);
    case 'BMPString':
      // BMPString 是 UTF-16BE
      return new TextDecoder('utf-16be').decode(node.value);
    default:
      return new TextDecoder('utf-8').decode(node.value);
  }
}

/** 字节数组转 hex 字符串 */
export function bytesToHex(bytes: Uint8Array, separator: string = ':'): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
    if (separator && i < bytes.length - 1) hex += separator;
  }
  return hex.toUpperCase();
}

/** 格式化 hex 为标准 OpenSSL 风格（每行 15 字节，每字节间冒号） */
export function formatOpensslFingerprint(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
    if (i < bytes.length - 1) hex += ':';
  }
  return hex.toUpperCase();
}

/* ============================================================
 * 5. X.509 证书解析
 * ============================================================ */

/** 主体/签发者的一个属性条目 */
export interface AttributeNameValuePair {
  /** 属性 OID */
  oid: string;
  /** 属性短名（如 CN / O / OU） */
  shortName: string;
  /** 属性值 */
  value: string;
}

/** DN（Distinguished Name）可分辨名称 */
export type DistinguishedName = AttributeNameValuePair[];

/** 公钥信息 */
export interface PublicKeyInfo {
  /** 算法 OID */
  algorithmOid: string;
  /** 算法名 */
  algorithmName: string;
  /** 公钥原始字节（hex） */
  publicKeyHex: string;
  /** 公钥位数（仅 RSA 有意义） */
  keySizeBits: number;
  /** RSA 模数（hex，仅 RSA） */
  rsaModulus?: string;
  /** RSA 公开指数（仅 RSA） */
  rsaExponent?: number;
  /** 椭圆曲线 OID（仅 EC） */
  ecCurveOid?: string;
  /** 椭圆曲线名（仅 EC） */
  ecCurveName?: string;
  /** 椭圆曲线公钥点（hex，仅 EC） */
  ecPointHex?: string;
  /** EdDSA 算法名（仅 Ed25519/Ed448） */
  eddsaName?: string;
}

/** 扩展项 */
export interface ExtensionInfo {
  /** 扩展 OID */
  oid: string;
  /** 扩展名 */
  name: string;
  /** 是否为关键扩展 */
  critical: boolean;
  /** 原始扩展值（hex） */
  rawValueHex: string;
  /** 解析后的友好展示（人类可读） */
  parsed: string;
}

/** 证书策略 */
export interface PolicyInfo {
  oid: string;
  name: string;
  /** CPS URI（如有） */
  cps?: string;
}

/** 完整的 X.509 证书解析结果 */
export interface X509Certificate {
  /** 原始 DER 字节 */
  der: Uint8Array;
  /** 版本号：1, 2, 3 */
  version: number;
  /** 序列号 hex */
  serialNumberHex: string;
  /** 序列号十进制（可能很长） */
  serialNumberDecimal: string;
  /** 签名算法 OID */
  signatureAlgorithmOid: string;
  /** 签名算法名 */
  signatureAlgorithmName: string;
  /** 签发者 DN */
  issuer: DistinguishedName;
  /** 签发者友好字符串（RFC 2253 风格） */
  issuerString: string;
  /** 主体 DN */
  subject: DistinguishedName;
  /** 主体友好字符串 */
  subjectString: string;
  /** 有效期开始 */
  notBefore: Date;
  /** 有效期结束 */
  notAfter: Date;
  /** 公钥信息 */
  publicKey: PublicKeyInfo;
  /** 扩展列表 */
  extensions: ExtensionInfo[];
  /** 签名值 hex */
  signatureHex: string;
  /** 是否为 CA 证书（basicConstraints.cA） */
  isCA: boolean;
  /** CA 路径长度限制（仅 CA 有效） */
  pathLenConstraint: number | null;
  /** SAN（Subject Alternative Name）列表 */
  sanList: { type: string; value: string }[];
  /** EKU 扩展密钥用途 OID 列表 */
  eku: { oid: string; name: string }[];
  /** 主体密钥标识（hex） */
  ski?: string;
  /** 权威密钥标识（hex） */
  aki?: string;
  /** CRL 分发点 URL 列表 */
  crlDistributionPoints: string[];
  /** OCSP URL 列表 */
  ocspUrls: string[];
  /** CA Issuers URL 列表（用于构造证书链） */
  caIssuersUrls: string[];
  /** 证书策略列表 */
  policies: PolicyInfo[];
  /** 是否包含 SCT 证书透明度扩展 */
  hasSct: boolean;
  /** 指纹（异步计算，需调用方填充） */
  fingerprintSha1?: string;
  fingerprintSha256?: string;
  /** 是否为自签证书（subject == issuer 且签名自验） */
  isSelfSigned: boolean;
}

/** 从 ASN.1 树中按 CONTEXT 编号取显式标签子节点 */
function findExplicitByContext(node: Asn1Node, contextNumber: number): Asn1Node | null {
  for (const child of node.children) {
    if (child.tagClass === 'CONTEXT' && child.contextNumber === contextNumber && child.constructed) {
      // EXPLICIT 标签：外层是 [n]，内部是真正的值
      return child.children[0] || null;
    }
  }
  return null;
}

/** 从 ASN.1 树中按 CONTEXT 编号取隐式标签子节点 */
function findImplicitByContext(node: Asn1Node, contextNumber: number): Asn1Node | null {
  for (const child of node.children) {
    if (child.tagClass === 'CONTEXT' && child.contextNumber === contextNumber) {
      return child;
    }
  }
  return null;
}

/** 解析 DN（Name） */
function parseDistinguishedName(node: Asn1Node): DistinguishedName {
  // Name ::= SEQUENCE OF RDN
  // RDN ::= SET OF AttributeTypeAndValue
  // AttributeTypeAndValue ::= SEQUENCE { type OID, value ANY }
  const result: AttributeNameValuePair[] = [];
  for (const rdn of node.children) {
    for (const atv of rdn.children) {
      const oidNode = atv.children[0];
      const valueNode = atv.children[1];
      if (!oidNode || !valueNode) continue;
      const oid = decodeOid(oidNode);
      const value = decodeString(valueNode);
      const name = oidName(oid);
      // 短名映射
      const shortName = DN_SHORT_NAMES[oid] || name;
      result.push({ oid, shortName, value });
    }
  }
  return result;
}

/** DN 属性 OID → 短名 */
const DN_SHORT_NAMES: Record<string, string> = {
  '2.5.4.3': 'CN',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.9': 'street',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '2.5.4.4': 'SN',
  '2.5.4.5': 'serialNumber',
  '2.5.4.12': 'title',
  '2.5.4.42': 'GN',
  '1.2.840.113549.1.9.1': 'emailAddress',
  '0.9.2342.19200300.100.1.25': 'DC',
  '2.5.4.97': 'organizationIdentifier',
};

/** DN 转为 RFC 2253 风格字符串（倒序，逗号分隔） */
export function dnToString(dn: DistinguishedName): string {
  return dn.slice().reverse().map((attr) => `${attr.shortName}=${attr.value}`).join(', ');
}

/** 比较两个 DN 是否相等 */
function dnEqual(a: DistinguishedName, b: DistinguishedName): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].oid !== b[i].oid || a[i].value !== b[i].value) return false;
  }
  return true;
}

/** 解析 SubjectPublicKeyInfo */
function parsePublicKeyInfo(node: Asn1Node): PublicKeyInfo {
  // SubjectPublicKeyInfo ::= SEQUENCE { algorithm AlgorithmIdentifier, subjectPublicKey BIT STRING }
  const algNode = node.children[0]; // AlgorithmIdentifier = SEQUENCE { OID, params? }
  const bitStringNode = node.children[1];
  if (!algNode || !bitStringNode) {
    throw new Error('公钥信息结构不完整');
  }
  const algOidNode = algNode.children[0];
  const algOid = decodeOid(algOidNode);
  const algName = oidName(algOid);

  // BIT STRING 第一个字节是未使用位数（通常为 0），后面才是真正的位
  const publicKeyBytes = bitStringNode.value.subarray(1); // 跳过首个 unused-bits 字节
  const publicKeyHex = bytesToHex(publicKeyBytes, '');

  const info: PublicKeyInfo = {
    algorithmOid: algOid,
    algorithmName: algName,
    publicKeyHex,
    keySizeBits: 0,
  };

  if (algOid === '1.2.840.113549.1.1.1') {
    // RSA：subjectPublicKey 是 RSAPublicKey ::= SEQUENCE { modulus INTEGER, publicExponent INTEGER }
    const rsaNode = parseAsn1(publicKeyBytes);
    const modulusNode = rsaNode.children[0];
    const exponentNode = rsaNode.children[1];
    if (modulusNode && exponentNode) {
      info.rsaModulus = decodeIntegerHex(modulusNode).replace(/^00/, ''); // 去除前导 0
      info.keySizeBits = modulusNode.value.length * 8;
      info.rsaExponent = parseInt(decodeIntegerHex(exponentNode), 16);
    }
  } else if (algOid === '1.2.840.10045.2.1') {
    // EC：AlgorithmIdentifier 的 params 是命名曲线 OID
    const curveOidNode = algNode.children[1];
    if (curveOidNode) {
      info.ecCurveOid = decodeOid(curveOidNode);
      info.ecCurveName = oidName(info.ecCurveOid);
      info.ecPointHex = publicKeyHex;
      // 估算密钥长度：04 + 2n 字节 = 1 + 2 * (n)
      const pointLen = (publicKeyBytes.length - 1) / 2;
      info.keySizeBits = pointLen * 8;
    }
  } else if (algOid === '1.3.101.112' || algOid === '1.3.101.113') {
    info.eddsaName = algName;
    info.keySizeBits = publicKeyBytes.length * 8;
  }

  return info;
}

/** 解析单个 GeneralName（RFC 5280 §4.2.1.6） */
function parseGeneralName(node: Asn1Node): { type: string; value: string } {
  if (node.tagClass !== 'CONTEXT' || node.contextNumber === null) {
    return { type: 'unknown', value: bytesToHex(node.value, '') };
  }
  switch (node.contextNumber) {
    case 0: // otherName（构造类型）
      return { type: 'otherName', value: bytesToHex(node.value, '') };
    case 1: // rfc822Name（IMPLICIT IA5String）
      return { type: 'email', value: decodeString(node) };
    case 2: // dNSName（IMPLICIT IA5String）
      return { type: 'DNS', value: decodeString(node) };
    case 4: { // directoryName（EXPLICIT Name）
      const inner = node.children[0];
      if (inner) {
        const dn = parseDistinguishedName(inner);
        return { type: 'DirName', value: dnToString(dn) };
      }
      return { type: 'DirName', value: '' };
    }
    case 6: // uniformResourceIdentifier（IMPLICIT IA5String）
      return { type: 'URI', value: decodeString(node) };
    case 7: { // iPAddress（IMPLICIT OCTET STRING）
      const v = node.value;
      if (v.length === 4) {
        return { type: 'IP', value: `${v[0]}.${v[1]}.${v[2]}.${v[3]}` };
      }
      if (v.length === 16) {
        const parts: string[] = [];
        for (let i = 0; i < 16; i += 2) {
          parts.push(((v[i] << 8) | v[i + 1]).toString(16));
        }
        return { type: 'IP', value: parts.join(':') };
      }
      return { type: 'IP', value: bytesToHex(v, '') };
    }
    default:
      return { type: `other[${node.contextNumber}]`, value: bytesToHex(node.value, '') };
  }
}

/** 解析 GeneralName 列表（用于 SAN 与 CRL 分发点等） */
function parseGeneralNames(node: Asn1Node): { type: string; value: string }[] {
  return node.children.map(parseGeneralName).filter((n) => n.value !== '');
}

/** 解析单个扩展，返回结构化结果 */
function parseExtension(extNode: Asn1Node): ExtensionInfo {
  // Extension ::= SEQUENCE { extnID OID, critical BOOLEAN DEFAULT FALSE, extnValue OCTET STRING }
  const oidNode = extNode.children[0];
  const oid = decodeOid(oidNode);
  let critical = false;
  let valueNode: Asn1Node;
  if (extNode.children.length === 3) {
    critical = decodeBoolean(extNode.children[1]);
    valueNode = extNode.children[2];
  } else {
    valueNode = extNode.children[1];
  }
  // extnValue 是 OCTET STRING，内部才是真正的 DER
  const innerDer = valueNode.value;
  const rawHex = bytesToHex(innerDer, '');
  let parsed = rawHex;

  try {
    // 各扩展按 OID 分支解析
    switch (oid) {
      case '2.5.29.19': { // basicConstraints
        const inner = parseAsn1(innerDer);
        let result = '';
        if (inner.children.length > 0) {
          const caNode = inner.children[0];
          if (caNode.universalTag === 'BOOLEAN') {
            const isCA = decodeBoolean(caNode);
            result = `CA:${isCA ? 'TRUE' : 'FALSE'}`;
            if (inner.children.length > 1) {
              const pathLen = parseInt(decodeIntegerHex(inner.children[1]), 16);
              result += `, pathLen:${pathLen}`;
            }
          }
        } else {
          result = 'CA:FALSE';
        }
        parsed = result;
        break;
      }
      case '2.5.29.17': { // subjectAltName
        const inner = parseAsn1(innerDer);
        const names = parseGeneralNames(inner);
        parsed = names.map((n) => `${n.type}:${n.value}`).join(', ');
        break;
      }
      case '2.5.29.14': { // subjectKeyIdentifier
        const inner = parseAsn1(innerDer);
        parsed = bytesToHex(inner.value, ':');
        break;
      }
      case '2.5.29.35': { // authorityKeyIdentifier
        const inner = parseAsn1(innerDer);
        const parts: string[] = [];
        for (const child of inner.children) {
          if (child.tagClass === 'CONTEXT' && child.contextNumber === 0) {
            parts.push(`keyid:${bytesToHex(child.value, ':')}`);
          } else if (child.tagClass === 'CONTEXT' && child.contextNumber === 2) {
            parts.push(`serial:${bytesToHex(child.value, ':')}`);
          }
        }
        parsed = parts.join(', ');
        break;
      }
      case '2.5.29.15': { // keyUsage
        const inner = parseAsn1(innerDer);
        // BIT STRING 第一字节是 unused bits
        const bits = inner.value.subarray(1);
        const usageNames = ['digitalSignature', 'nonRepudiation', 'keyEncipherment', 'dataEncipherment', 'keyAgreement', 'keyCertSign', 'cRLSign', 'encipherOnly', 'decipherOnly'];
        const usages: string[] = [];
        for (let i = 0; i < usageNames.length * 8 && i < bits.length * 8; i++) {
          const byteIndex = Math.floor(i / 8);
          const bitIndex = 7 - (i % 8);
          if ((bits[byteIndex] & (1 << bitIndex)) !== 0) {
            usages.push(usageNames[i]);
          }
        }
        parsed = usages.join(', ');
        break;
      }
      case '2.5.29.37': { // extKeyUsage
        const inner = parseAsn1(innerDer);
        const usages: string[] = [];
        for (const child of inner.children) {
          const ekuOid = decodeOid(child);
          usages.push(`${oidName(ekuOid)}`);
        }
        parsed = usages.join(', ');
        break;
      }
      case '2.5.29.31': // cRLDistributionPoints
      case '2.5.29.46': { // freshestCRL
        const inner = parseAsn1(innerDer);
        const urls: string[] = [];
        for (const dp of inner.children) {
          // DistributionPoint ::= SEQUENCE { distributionPoint [0] EXPLICIT ... }
          const dpName = findExplicitByContext(dp, 0);
          if (dpName) {
            // fullName [0] IMPLICIT GeneralNames
            const fullName = findImplicitByContext(dpName, 0);
            if (fullName) {
              const names = parseGeneralNames(fullName);
              for (const n of names) {
                if (n.type === 'URI') urls.push(n.value);
              }
            }
          }
        }
        parsed = urls.join(', ');
        break;
      }
      case '1.3.6.1.5.5.7.1.1': { // authorityInfoAccess
        const inner = parseAsn1(innerDer);
        const parts: string[] = [];
        for (const desc of inner.children) {
          // AccessDescription ::= SEQUENCE { accessMethod OID, accessLocation GeneralName }
          const methodOid = decodeOid(desc.children[0]);
          const location = desc.children[1];
          // accessLocation 是单个 GeneralName，直接调用 parseGeneralName
          const name = parseGeneralName(location);
          parts.push(`${oidName(methodOid)}: ${name.value}`);
        }
        parsed = parts.join(' | ');
        break;
      }
      case '2.5.29.32': { // certificatePolicies
        const inner = parseAsn1(innerDer);
        const parts: string[] = [];
        for (const pol of inner.children) {
          // PolicyInformation ::= SEQUENCE { policyIdentifier OID, policyQualifiers SEQUENCE OPTIONAL }
          const polOid = decodeOid(pol.children[0]);
          let line = oidName(polOid);
          if (pol.children.length > 1) {
            const qualifiers = pol.children[1].children;
            for (const q of qualifiers) {
              // PolicyQualifierInfo ::= SEQUENCE { policyQualifierId OID, qualifier ANY }
              const qOid = decodeOid(q.children[0]);
              if (qOid === '1.3.6.1.5.5.7.2.1') {
                // cps: IA5String
                line += ` (CPS: ${decodeString(q.children[1])})`;
              } else if (qOid === '1.3.6.1.5.5.7.2.2') {
                // userNotice: SEQUENCE
                line += ` (userNotice)`;
              }
            }
          }
          parts.push(line);
        }
        parsed = parts.join(' | ');
        break;
      }
      case '1.3.6.1.4.1.11129.2.4.2': { // SCT list
        // 简单显示字节数，详细解析需处理内部结构
        parsed = `SCT 列表（${innerDer.length} 字节）`;
        break;
      }
      default:
        parsed = rawHex;
    }
  } catch (e) {
    parsed = `解析失败：${(e as Error).message}\n${rawHex}`;
  }

  return {
    oid,
    name: oidName(oid),
    critical,
    rawValueHex: rawHex,
    parsed,
  };
}

/** 解析 X.509 证书（核心入口） */
export function parseCertificate(der: Uint8Array): X509Certificate {
  const root = parseAsn1(der);
  // Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }
  if (root.universalTag !== 'SEQUENCE' || root.children.length < 3) {
    throw new Error('不是有效的 X.509 证书结构');
  }
  const tbs = root.children[0];
  const sigAlg = root.children[1];
  const sigValue = root.children[2];

  // TBSCertificate 子字段顺序：
  // [0] version (EXPLICIT, 可选)
  // serialNumber INTEGER
  // signature AlgorithmIdentifier
  // issuer Name
  // validity SEQUENCE
  // subject Name
  // subjectPublicKeyInfo SEQUENCE
  // [1] issuerUniqueID (可选)
  // [2] subjectUniqueID (可选)
  // [3] extensions (EXPLICIT, 可选)
  let idx = 0;
  let version = 1; // 默认 v1
  const versionNode = findExplicitByContext(tbs, 0);
  if (versionNode) {
    version = parseInt(decodeIntegerHex(versionNode), 16) + 1;
    idx = 1; // 第一个非默认字段从 1 开始
  }
  const serialNumberNode = tbs.children[idx++];
  idx++; // 跳过 tbs.signatureAlgorithm（RFC 5280 要求与外层一致，此处不验证）
  const issuerNode = tbs.children[idx++];
  const validityNode = tbs.children[idx++];
  const subjectNode = tbs.children[idx++];
  const spkiNode = tbs.children[idx++];

  // 跳过 issuerUniqueID / subjectUniqueID
  while (idx < tbs.children.length) {
    const child = tbs.children[idx];
    if (child.tagClass === 'CONTEXT' && (child.contextNumber === 1 || child.contextNumber === 2)) {
      idx++;
    } else {
      break;
    }
  }
  const extensionsNode = findExplicitByContext(tbs, 3);

  // 序列号
  const serialNumberHex = decodeIntegerHex(serialNumberNode);
  const serialNumberDecimal = decodeIntegerDecimal(serialNumberNode);

  // 签名算法
  const sigAlgOid = decodeOid(sigAlg.children[0]);
  const sigAlgName = oidName(sigAlgOid);

  // 签发者与主体
  const issuer = parseDistinguishedName(issuerNode);
  const subject = parseDistinguishedName(subjectNode);

  // 有效期
  const notBeforeNode = validityNode.children[0];
  const notAfterNode = validityNode.children[1];
  const notBefore = decodeTime(notBeforeNode);
  const notAfter = decodeTime(notAfterNode);

  // 公钥
  const publicKey = parsePublicKeyInfo(spkiNode);

  // 扩展
  const extensions: ExtensionInfo[] = [];
  if (extensionsNode) {
    for (const ext of extensionsNode.children) {
      extensions.push(parseExtension(ext));
    }
  }

  // 签名值（BIT STRING，跳过 unused bits 字节）
  const signatureHex = bytesToHex(sigValue.value.subarray(1), '');

  // 提取常用扩展字段
  let isCA = false;
  let pathLenConstraint: number | null = null;
  let ski: string | undefined;
  let aki: string | undefined;
  const sanList: { type: string; value: string }[] = [];
  const eku: { oid: string; name: string }[] = [];
  const crlDistributionPoints: string[] = [];
  const ocspUrls: string[] = [];
  const caIssuersUrls: string[] = [];
  const policies: PolicyInfo[] = [];
  let hasSct = false;

  for (const ext of extensions) {
    switch (ext.oid) {
      case '2.5.29.19': { // basicConstraints
        const m = /CA:(TRUE|FALSE)/.exec(ext.parsed);
        if (m && m[1] === 'TRUE') isCA = true;
        const pl = /pathLen:(\d+)/.exec(ext.parsed);
        if (pl) pathLenConstraint = parseInt(pl[1], 10);
        break;
      }
      case '2.5.29.14': // SKI
        ski = ext.parsed;
        break;
      case '2.5.29.35': // AKI
        aki = ext.parsed;
        break;
      case '2.5.29.17': // SAN
        {
          // 重新解析获取结构化数据
          const valueNode = extensionsNode!.children.find((e) => decodeOid(e.children[0]) === '2.5.29.17');
          if (valueNode) {
            const innerDer = (valueNode.children.length === 3 ? valueNode.children[2] : valueNode.children[1]).value;
            const inner = parseAsn1(innerDer);
            sanList.push(...parseGeneralNames(inner));
          }
        }
        break;
      case '2.5.29.37': // EKU
        {
          const valueNode = extensionsNode!.children.find((e) => decodeOid(e.children[0]) === '2.5.29.37');
          if (valueNode) {
            const innerDer = (valueNode.children.length === 3 ? valueNode.children[2] : valueNode.children[1]).value;
            const inner = parseAsn1(innerDer);
            for (const child of inner.children) {
              const ekuOid = decodeOid(child);
              eku.push({ oid: ekuOid, name: oidName(ekuOid) });
            }
          }
        }
        break;
      case '2.5.29.31': // CRL 分发点
      case '2.5.29.46':
        {
          const urls = ext.parsed.split(',').map((s) => s.trim()).filter(Boolean);
          crlDistributionPoints.push(...urls);
        }
        break;
      case '1.3.6.1.5.5.7.1.1': // AIA
        {
          // ext.parsed 格式："OCSP: url | CA Issuers: url"
          const parts = ext.parsed.split(' | ');
          for (const p of parts) {
            if (p.startsWith('OCSP')) {
              const url = p.replace(/^OCSP:\s*/, '');
              if (url) ocspUrls.push(url);
            } else if (p.startsWith('CA Issuers')) {
              const url = p.replace(/^CA Issuers:\s*/, '');
              if (url) caIssuersUrls.push(url);
            }
          }
        }
        break;
      case '2.5.29.32': // 证书策略
        {
          const parts = ext.parsed.split(' | ');
          for (const p of parts) {
            const oid = p.split(' ')[0].split('(')[0];
            const cpsMatch = /CPS: ([^)]+)/.exec(p);
            policies.push({
              oid,
              name: oidName(oid),
              cps: cpsMatch ? cpsMatch[1] : undefined,
            });
          }
        }
        break;
      case '1.3.6.1.4.1.11129.2.4.2': // SCT
        hasSct = true;
        break;
    }
  }

  const isSelfSigned = dnEqual(issuer, subject);

  return {
    der,
    version,
    serialNumberHex,
    serialNumberDecimal,
    signatureAlgorithmOid: sigAlgOid,
    signatureAlgorithmName: sigAlgName,
    issuer,
    issuerString: dnToString(issuer),
    subject,
    subjectString: dnToString(subject),
    notBefore,
    notAfter,
    publicKey,
    extensions,
    signatureHex,
    isCA,
    pathLenConstraint,
    sanList,
    eku,
    ski,
    aki,
    crlDistributionPoints,
    ocspUrls,
    caIssuersUrls,
    policies,
    hasSct,
    isSelfSigned,
  };
}

/** 计算证书指纹（SHA-1 与 SHA-256），返回 hex 字符串 */
export async function computeFingerprints(der: Uint8Array): Promise<{ sha1: string; sha256: string }> {
  // 拷贝到独立的 ArrayBuffer，避免 subarray 视图导致的类型不兼容（TS 5.7 严格化）
  const buf = new Uint8Array(der.length);
  buf.set(der);
  const buffer = buf.buffer;
  const [sha1Buf, sha256Buf] = await Promise.all([
    crypto.subtle.digest('SHA-1', buffer),
    crypto.subtle.digest('SHA-256', buffer),
  ]);
  return {
    sha1: formatOpensslFingerprint(new Uint8Array(sha1Buf)),
    sha256: formatOpensslFingerprint(new Uint8Array(sha256Buf)),
  };
}

/* ============================================================
 * 6. OpenSSL 风格文本导出
 * ============================================================ */

/** 格式化为 OpenSSL x509 -text 风格的文本，便于复制分享 */
export function exportToOpensslText(cert: X509Certificate): string {
  const lines: string[] = [];
  const fmtDate = (d: Date) => d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');

  lines.push('Certificate:');
  lines.push(`    Data:`);
  lines.push(`        Version: ${cert.version} (0x${cert.version - 1})`);
  lines.push(`        Serial Number:`);
  // 序列号太长，分行展示
  const serialHex = cert.serialNumberHex.replace(/(.{2})/g, '$1:').replace(/:$/, '');
  lines.push(`            ${serialHex}`);
  lines.push(`        Signature Algorithm: ${cert.signatureAlgorithmName}`);
  lines.push(`        Issuer: ${cert.issuerString}`);
  lines.push(`        Validity`);
  lines.push(`            Not Before: ${fmtDate(cert.notBefore)}`);
  lines.push(`            Not After : ${fmtDate(cert.notAfter)}`);
  lines.push(`        Subject: ${cert.subjectString}`);
  lines.push(`        Subject Public Key Info:`);
  lines.push(`            Public Key Algorithm: ${cert.publicKey.algorithmName}`);
  if (cert.publicKey.algorithmOid === '1.2.840.113549.1.1.1') {
    // RSA
    lines.push(`                RSA Public-Key: (${cert.publicKey.keySizeBits} bit)`);
      if (cert.publicKey.rsaModulus) {
        // 模数每行 15 字节展示
        const mod = cert.publicKey.rsaModulus;
        lines.push(`                Modulus:`);
        for (let i = 0; i < mod.length; i += 30) {
          const chunk = mod.substring(i, i + 30).match(/.{2}/g)!.join(':');
          lines.push(`                    ${chunk}`);
        }
        lines.push(`                Exponent: ${cert.publicKey.rsaExponent} (0x${(cert.publicKey.rsaExponent || 0).toString(16)})`);
      }
  } else if (cert.publicKey.algorithmOid === '1.2.840.10045.2.1') {
    lines.push(`                EC Public Key: (${cert.publicKey.keySizeBits} bit)`);
    if (cert.publicKey.ecCurveName) lines.push(`                Curve: ${cert.publicKey.ecCurveName}`);
  } else if (cert.publicKey.eddsaName) {
    lines.push(`                ${cert.publicKey.eddsaName} Public Key: (${cert.publicKey.keySizeBits} bit)`);
  }
  if (cert.extensions.length > 0) {
    lines.push(`        X509v3 extensions:`);
    for (const ext of cert.extensions) {
      const crit = ext.critical ? ' critical' : '';
      lines.push(`            X509v3 ${ext.name}:${crit}`);
      // 缩进展示
      const indent = '                ';
      const text = ext.parsed || ext.rawValueHex;
      text.split('\n').forEach((line) => lines.push(`${indent}${line}`));
    }
  }
  lines.push(`    Signature Algorithm: ${cert.signatureAlgorithmName}`);
  // 签名值每行 60 字符 hex
  const sig = cert.signatureHex;
  for (let i = 0; i < sig.length; i += 60) {
    lines.push(`         ${sig.substring(i, i + 60).match(/.{2}/g)!.join(':')}`);
  }
  if (cert.fingerprintSha1) {
    lines.push('');
    lines.push(`SHA1 Fingerprint=${cert.fingerprintSha1}`);
  }
  if (cert.fingerprintSha256) {
    lines.push(`SHA256 Fingerprint=${cert.fingerprintSha256}`);
  }
  return lines.join('\n');
}

/** 将多个 PEM 块的解析结果导出为可读文本 */
export function exportMultipleToText(certs: X509Certificate[]): string {
  return certs.map((cert, i) => {
    return `=== 证书 ${i + 1} / ${certs.length} ===\n${exportToOpensslText(cert)}`;
  }).join('\n\n');
}

/** 证书有效期检查（返回剩余天数，负数表示已过期） */
export function daysUntilExpiry(cert: X509Certificate, now: Date = new Date()): number {
  const ms = cert.notAfter.getTime() - now.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/** 格式化密钥长度为人类可读 */
export function formatKeySize(bits: number): string {
  if (bits <= 0) return '未知';
  return `${bits} 位`;
}

/** 验证证书有效性概要（不验证签名，仅检查有效期） */
export interface ValidationResult {
  /** 是否在有效期内 */
  valid: boolean;
  /** 状态文案 */
  status: 'valid' | 'expired' | 'not_yet_valid';
  /** 详细信息 */
  detail: string;
  /** 剩余天数（负数表示已过期多少天） */
  daysRemaining: number;
}

export function validateValidity(cert: X509Certificate, now: Date = new Date()): ValidationResult {
  const daysLeft = daysUntilExpiry(cert, now);
  if (now < cert.notBefore) {
    return {
      valid: false,
      status: 'not_yet_valid',
      detail: `证书尚未生效（距离生效还有 ${Math.abs(daysLeft)} 天）`,
      daysRemaining: daysLeft,
    };
  }
  if (now > cert.notAfter) {
    return {
      valid: false,
      status: 'expired',
      detail: `证书已过期 ${Math.abs(daysLeft)} 天`,
      daysRemaining: daysLeft,
    };
  }
  return {
    valid: true,
    status: 'valid',
    detail: daysLeft < 30 ? `即将过期（剩余 ${daysLeft} 天）` : `证书有效（剩余 ${daysLeft} 天）`,
    daysRemaining: daysLeft,
  };
}

/** 预设示例证书（自签 CA 测试证书，仅用于工具演示） */
export const PRESET_CERTIFICATES: { name: string; description: string; pem: string }[] = [
  {
    name: '自签 CA 测试证书',
    description: '用于测试的自签根证书，可作为 CA 签发下级证书',
    pem: `-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfMHdh3PvSl
Y2JtOk5u7roZsJFA4QJdkVPbvB2gJLcxqrxq9to3vGwtxnGv/zemg9YDzc9bEhCs
D6Nwzjdri6P3xYd7jBS5/u0ZYBR20/UHnYlzgHNzO4kQ8lE5TQb5oJYozaZpGNl
CTmqJthLm1qqg5p0qSphmQ7PBk0c4m/qb0o+0mKvS+loBdhfPayvU2D9x9B7SnW
HbaQxxHzfFva3idIfo2fwQ3YBwTPA5hDgvi6t2U6BhrV6tU3lWws4
-----END CERTIFICATE-----`,
  },
];
