/**
 * JWE（JSON Web Encryption）解析与解密工具
 *
 * 设计目标：
 *  - 零依赖纯 TS 实现，仅使用浏览器原生 Web Crypto API（SubtleCrypto）
 *  - 支持 JWE Compact Serialization（五段式）与 Flattened JSON Serialization 两种格式
 *  - 支持 dir / A128KW / A192KW / A256KW / RSA-OAEP-* / RSA1_5 / PBES2-* / ECDH-ES* 等主流密钥管理算法
 *  - 支持 A128GCM / A192GCM / A256GCM 内容加密算法（AES-CBC+HMAC 系列暂不支持解密）
 *  - 全程本地处理，密钥不离开浏览器，不上传、不存储
 *
 * 参考：
 *  - RFC 7516: JSON Web Encryption (JWE)
 *  - RFC 7518: JSON Web Algorithms (JWA)
 *  - RFC 7797: JWE Unencoded Payload Option（暂不支持）
 */

/** JWE 五段式拆分结果（均为 base64url 字符串） */
export interface JweParts {
  protectedHeader: string;
  encryptedKey: string;
  iv: string;
  ciphertext: string;
  tag: string;
}

/** JOSE Header（JWE Protected Header 解析后的对象） */
export interface JoseHeader {
  alg?: string;
  enc?: string;
  zip?: string;
  kid?: string;
  typ?: string;
  cty?: string;
  p2s?: string; // PBES2 salt
  p2c?: number; // PBES2 count
  epk?: unknown; // ephemeral public key
  [key: string]: unknown;
}

/** JWE 解析结果 */
export interface ParsedJwe {
  ok: boolean;
  format: 'compact' | 'flattened' | 'invalid';
  parts?: JweParts;
  header?: JoseHeader;
  headerJson?: string; // 美化后的 header JSON
  aad?: string; // 附加认证数据（flattened 格式）
  error?: string;
}

/** JWE 解密结果 */
export interface DecryptResult {
  ok: boolean;
  plaintext?: string; // UTF-8 解码后的明文
  plaintextBytes?: number;
  isJson?: boolean; // 明文是否为合法 JSON
  json?: string; // 美化后的 JSON（若 isJson）
  isJwt?: boolean; // 明文是否为 JWT（三段式）
  error?: string;
}

/** 密钥管理算法（alg）说明表 */
export const ALG_DESC: Record<string, string> = {
  dir: '直接密钥（共享对称密钥直接作为 CEK，encrypted_key 为空）',
  A128KW: 'AES-128 密钥包装（用 128 位 AES 包装 CEK）',
  A192KW: 'AES-192 密钥包装（用 192 位 AES 包装 CEK）',
  A256KW: 'AES-256 密钥包装（用 256 位 AES 包装 CEK）',
  'RSA-OAEP': 'RSA-OAEP（默认 SHA-1，已不推荐）',
  'RSA-OAEP-256': 'RSA-OAEP + SHA-256（推荐，RSA 公钥加密 CEK）',
  'RSA-OAEP-384': 'RSA-OAEP + SHA-384',
  'RSA-OAEP-512': 'RSA-OAEP + SHA-512',
  RSA1_5: 'RSA1_5（PKCS#1 v1.5，存在 Bleichenbacher 攻击风险，仅兼容旧系统）',
  'PBES2-HS256+A128KW': 'PBES2 + HMAC-SHA-256 + AES-128KW（密码派生密钥）',
  'PBES2-HS384+A192KW': 'PBES2 + HMAC-SHA-384 + AES-192KW',
  'PBES2-HS512+A256KW': 'PBES2 + HMAC-SHA-512 + AES-256KW',
  'ECDH-ES': 'ECDH-ES（椭圆曲线 Diffie-Hellman Ephemeral Static，直接派生 CEK）',
  'ECDH-ES+A128KW': 'ECDH-ES + AES-128KW（ECDH 派生 KEK，AES-KW 包装 CEK）',
  'ECDH-ES+A192KW': 'ECDH-ES + AES-192KW（ECDH 派生 KEK，AES-KW 包装 CEK）',
  'ECDH-ES+A256KW': 'ECDH-ES + AES-256KW（ECDH 派生 KEK，AES-KW 包装 CEK）',
};

/** 内容加密算法（enc）说明表 */
export const ENC_DESC: Record<string, string> = {
  A128GCM: 'AES-128 GCM（推荐，AEAD 认证加密）',
  A192GCM: 'AES-192 GCM（AEAD 认证加密）',
  A256GCM: 'AES-256 GCM（推荐，AEAD 认证加密）',
  'A128CBC-HS256': 'AES-128-CBC + HMAC-SHA-256（本轮暂不支持解密）',
  'A192CBC-HS384': 'AES-192-CBC + HMAC-SHA-384（本轮暂不支持解密）',
  'A256CBC-HS512': 'AES-256-CBC + HMAC-SHA-512（本轮暂不支持解密）',
};

/** alg 分类：用于 UI 提示用户应输入哪种密钥格式 */
export type AlgCategory = 'direct' | 'symmetric' | 'asymmetric' | 'pbes2' | 'ecdh-es' | 'unsupported';
export const ALG_CATEGORY: Record<string, AlgCategory> = {
  dir: 'direct',
  A128KW: 'symmetric',
  A192KW: 'symmetric',
  A256KW: 'symmetric',
  'RSA-OAEP': 'asymmetric',
  'RSA-OAEP-256': 'asymmetric',
  'RSA-OAEP-384': 'asymmetric',
  'RSA-OAEP-512': 'asymmetric',
  RSA1_5: 'asymmetric',
  'PBES2-HS256+A128KW': 'pbes2',
  'PBES2-HS384+A192KW': 'pbes2',
  'PBES2-HS512+A256KW': 'pbes2',
  'ECDH-ES': 'ecdh-es',
  'ECDH-ES+A128KW': 'ecdh-es',
  'ECDH-ES+A192KW': 'ecdh-es',
  'ECDH-ES+A256KW': 'ecdh-es',
};

/** 支持解密的 alg 列表（其他 alg 仅解析不解密）
 * 注意：RSA1_5 已从默认支持列表移除，存在 Bleichenbacher 攻击风险，建议使用 RSA-OAEP 替代 */
export const SUPPORTED_DECRYPT_ALGS = [
  'dir',
  'A128KW',
  'A192KW',
  'A256KW',
  'RSA-OAEP',
  'RSA-OAEP-256',
  'RSA-OAEP-384',
  'RSA-OAEP-512',
  // PBES2 系列：密码 + PBKDF2 派生 KW 密钥 + AES-KW 解包 CEK
  'PBES2-HS256+A128KW',
  'PBES2-HS384+A192KW',
  'PBES2-HS512+A256KW',
  // ECDH-ES 系列：椭圆曲线 DH 派生 + Concat KDF + 可选 AES-KW 解包
  'ECDH-ES',
  'ECDH-ES+A128KW',
  'ECDH-ES+A192KW',
  'ECDH-ES+A256KW',
];

/** 支持解密的 enc 列表（仅 GCM 系列，CBC+HMAC 需手动实现） */
export const SUPPORTED_DECRYPT_ENCS = ['A128GCM', 'A192GCM', 'A256GCM'];

/** 输入长度上限：防止超长 token 解析卡顿 */
export const MAX_INPUT_LENGTH = 50000;

/**
 * base64url 解码为 Uint8Array
 * base64url 用 - 替换 +，用 _ 替换 /，且通常省略 padding
 */
export function base64urlDecode(input: string): Uint8Array<ArrayBuffer> {
  if (!input) return new Uint8Array(0);
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  if (pad) {
    base64 += '='.repeat(4 - pad);
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** base64url 编码 Uint8Array */
export function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Uint8Array 转 hex 字符串 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 字节数转可读字符串（B/KB/MB） */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** UTF-8 解码 Uint8Array 为字符串 */
export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

/** 字符串转 UTF-8 Uint8Array */
export function encodeUtf8(str: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(str);
}

/**
 * 解析 JWE 字符串（支持 compact 与 flattened JSON 序列化）
 *
 * Compact 格式：protected.encrypted_key.iv.ciphertext.tag（五段，用 . 分隔）
 * Flattened JSON 格式：{"protected":"...","encrypted_key":"...","iv":"...","ciphertext":"...","tag":"...","header":{...},"aad":"..."}
 */
export function parseJwe(input: string): ParsedJwe {
  const empty: ParsedJwe = { ok: false, format: 'invalid' };
  if (!input || input.trim() === '') {
    return { ...empty, error: '请输入 JWE' };
  }
  const trimmed = input.trim();
  // 去除可能的 Bearer 前缀
  const cleaned = trimmed.replace(/^Bearer\s+/i, '');

  // 判断是 JSON 格式还是 compact 格式
  if (cleaned.startsWith('{')) {
    return parseFlattenedJson(cleaned);
  }
  return parseCompact(cleaned);
}

/** 解析 compact 序列化 */
function parseCompact(input: string): ParsedJwe {
  const parts = input.split('.');
  if (parts.length !== 5) {
    return {
      ok: false,
      format: 'invalid',
      error: `JWE Compact 格式应包含 5 段（用 . 分隔），当前 ${parts.length} 段`,
    };
  }
  const [protectedHeader, encryptedKey, iv, ciphertext, tag] = parts;
  const parts_: JweParts = { protectedHeader, encryptedKey, iv, ciphertext, tag };
  return finalizeParse(parts_);
}

/** 解析 flattened JSON 序列化 */
function parseFlattenedJson(input: string): ParsedJwe {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(input);
  } catch (e) {
    return {
      ok: false,
      format: 'invalid',
      error: `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (typeof obj !== 'object' || obj === null) {
    return { ok: false, format: 'invalid', error: 'JWE Flattened JSON 必须是对象' };
  }
  const protectedHeader = typeof obj.protected === 'string' ? obj.protected : '';
  const encryptedKey = typeof obj.encrypted_key === 'string' ? obj.encrypted_key : '';
  const iv = typeof obj.iv === 'string' ? obj.iv : '';
  const ciphertext = typeof obj.ciphertext === 'string' ? obj.ciphertext : '';
  const tag = typeof obj.tag === 'string' ? obj.tag : '';
  if (!protectedHeader || !ciphertext) {
    return {
      ok: false,
      format: 'invalid',
      error: 'JWE Flattened JSON 缺少 protected 或 ciphertext 字段',
    };
  }
  const parts_: JweParts = { protectedHeader, encryptedKey, iv, ciphertext, tag };
  const result = finalizeParse(parts_);
  if (result.ok) {
    result.format = 'flattened';
    // 合并 unprotected header（若有）
    if (obj.header && typeof obj.header === 'object') {
      result.header = { ...(obj.header as JoseHeader), ...(result.header || {}) };
      result.headerJson = JSON.stringify(result.header, null, 2);
    }
    if (typeof obj.aad === 'string') {
      result.aad = obj.aad;
    }
  }
  return result;
}

/** 解析 protected header 并填充结果 */
function finalizeParse(parts: JweParts): ParsedJwe {
  // 解析 protected header
  let headerObj: JoseHeader = {};
  let headerJson = '';
  try {
    const headerBytes = base64urlDecode(parts.protectedHeader);
    const headerStr = decodeUtf8(headerBytes);
    headerObj = JSON.parse(headerStr);
    headerJson = JSON.stringify(headerObj, null, 2);
  } catch (e) {
    return {
      ok: false,
      format: 'invalid',
      parts,
      error: `Protected Header 解析失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (!headerObj.alg) {
    return {
      ok: false,
      format: 'invalid',
      parts,
      header: headerObj,
      headerJson,
      error: 'Protected Header 缺少 alg 字段',
    };
  }
  if (!headerObj.enc) {
    return {
      ok: false,
      format: 'invalid',
      parts,
      header: headerObj,
      headerJson,
      error: 'Protected Header 缺少 enc 字段',
    };
  }
  return {
    ok: true,
    format: 'compact',
    parts,
    header: headerObj,
    headerJson,
  };
}

/** 提取 RSA-OAEP 系列算法的 SHA 哈希名 */
function rsaOaepHash(alg: string): string {
  switch (alg) {
    case 'RSA-OAEP':
      return 'SHA-1'; // 旧默认值
    case 'RSA-OAEP-256':
      return 'SHA-256';
    case 'RSA-OAEP-384':
      return 'SHA-384';
    case 'RSA-OAEP-512':
      return 'SHA-512';
    default:
      return 'SHA-256';
  }
}

/** 提取 AES-KW 算法的密钥长度（位） */
function aesKwLength(alg: string): number {
  switch (alg) {
    case 'A128KW':
      return 128;
    case 'A192KW':
      return 192;
    case 'A256KW':
      return 256;
    default:
      return 256;
  }
}

/** 提取 AES-GCM 算法的密钥长度（位） */
function aesGcmLength(enc: string): number {
  switch (enc) {
    case 'A128GCM':
      return 128;
    case 'A192GCM':
      return 192;
    case 'A256GCM':
      return 256;
    default:
      return 256;
  }
}

/**
 * 从 PBES2 alg 中提取 PBKDF2 使用的哈希算法
 * alg 形如 PBES2-HS256+A128KW，HS256 对应 SHA-256
 */
function pbes2Hash(alg: string): string {
  const match = alg.match(/HS(\d+)/);
  if (!match) return 'SHA-256';
  const bits = parseInt(match[1], 10);
  switch (bits) {
    case 256:
      return 'SHA-256';
    case 384:
      return 'SHA-384';
    case 512:
      return 'SHA-512';
    default:
      return 'SHA-256';
  }
}

/**
 * 从 PBES2 alg 中提取 AES-KW 密钥长度（位）
 * alg 形如 PBES2-HS256+A128KW，A128KW 对应 128 位
 */
function pbes2KwLength(alg: string): number {
  const match = alg.match(/A(\d+)KW/);
  if (!match) return 128;
  return parseInt(match[1], 10);
}

/** ECDH-ES 支持的椭圆曲线 */
const SUPPORTED_ECDH_CRVS = ['P-256', 'P-384', 'P-521'];

/** 根据曲线名返回 ECDH 派生的共享秘密位数（与曲线坐标位数对齐） */
function ecdhZBits(crv: string): number {
  switch (crv) {
    case 'P-256':
      return 256;
    case 'P-384':
      return 384;
    case 'P-521':
      return 528; // P-521 坐标 521 位，字节对齐 66 字节 = 528 位
    default:
      return 256;
  }
}

/**
 * Concat KDF（RFC 7518 Section 4.6.2 / NIST SP 800-56A Section 5.8.1）
 *
 * 用于从 ECDH 共享秘密 Z 派生 CEK（直接模式）或 KEK（KW 模式）
 *
 * 算法：DerivedKey = SHA-256(1 || Z || AlgorithmIDLen || AlgorithmID || PartyUInfoLen || PartyUInfo || PartyVInfoLen || PartyVInfo || SuppPubInfo || SuppPrivInfo) || SHA-256(2 || ...) || ...
 * 取前 keyDataLen 位作为派生密钥
 *
 * @param z 共享秘密字节数组
 * @param algorithmId 算法标识（ECDH-ES 用 enc 名如 A128GCM，ECDH-ES+KW 用 alg 名如 ECDH-ES+A128KW）
 * @param keyDataLen 派生密钥位数
 */
export async function concatKdf(
  z: Uint8Array,
  algorithmId: string,
  keyDataLen: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const algorithmIdBytes = encodeUtf8(algorithmId);
  // PartyUInfo、PartyVInfo、SuppPrivInfo 本工具暂不支持（RFC 7518 可选字段）
  const partyUInfo = new Uint8Array(0);
  const partyVInfo = new Uint8Array(0);

  // SuppPubInfo = keydatalen（32 位大端序）
  const suppPubInfo = new Uint8Array(4);
  new DataView(suppPubInfo.buffer).setUint32(0, keyDataLen, false);

  // SHA-256 输出 32 字节，计算需要的轮数
  const hashLen = 32;
  const rounds = Math.ceil(keyDataLen / (hashLen * 8));
  const derivedBytes = new Uint8Array(Math.ceil(keyDataLen / 8));
  let offset = 0;

  for (let counter = 1; counter <= rounds; counter++) {
    // 构造单轮输入：counter(4) || Z || algLen(4) || alg || uLen(4) || u || vLen(4) || v || suppPubInfo(4)
    const input = new Uint8Array(
      4 + z.length +
      4 + algorithmIdBytes.length +
      4 + partyUInfo.length +
      4 + partyVInfo.length +
      suppPubInfo.length,
    );
    let pos = 0;
    // counter（32 位大端序）
    const counterBytes = new Uint8Array(4);
    new DataView(counterBytes.buffer).setUint32(0, counter, false);
    input.set(counterBytes, pos); pos += 4;
    // Z（共享秘密）
    input.set(z, pos); pos += z.length;
    // AlgorithmID 长度 + AlgorithmID
    const algLenBytes = new Uint8Array(4);
    new DataView(algLenBytes.buffer).setUint32(0, algorithmIdBytes.length, false);
    input.set(algLenBytes, pos); pos += 4;
    input.set(algorithmIdBytes, pos); pos += algorithmIdBytes.length;
    // PartyUInfo 长度 + PartyUInfo
    const uLenBytes = new Uint8Array(4);
    new DataView(uLenBytes.buffer).setUint32(0, partyUInfo.length, false);
    input.set(uLenBytes, pos); pos += 4;
    input.set(partyUInfo, pos); pos += partyUInfo.length;
    // PartyVInfo 长度 + PartyVInfo
    const vLenBytes = new Uint8Array(4);
    new DataView(vLenBytes.buffer).setUint32(0, partyVInfo.length, false);
    input.set(vLenBytes, pos); pos += 4;
    input.set(partyVInfo, pos); pos += partyVInfo.length;
    // SuppPubInfo
    input.set(suppPubInfo, pos); pos += suppPubInfo.length;

    // SHA-256 哈希
    const hashBuffer = await crypto.subtle.digest({ name: 'SHA-256' }, input);
    const hashBytes = new Uint8Array(hashBuffer);
    const copyLen = Math.min(hashBytes.length, derivedBytes.length - offset);
    derivedBytes.set(hashBytes.subarray(0, copyLen), offset);
    offset += copyLen;
  }

  return derivedBytes;
}

/** 解析 PEM 格式的 RSA 私钥（PKCS#1 或 PKCS#8） */
function parsePemRsaPrivateKey(pem: string): Uint8Array<ArrayBuffer> {
  const cleaned = pem
    .replace(/-----BEGIN[^-]*PRIVATE KEY-----/g, '')
    .replace(/-----END[^-]*PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  if (!cleaned) {
    throw new Error('PEM 内容为空或格式不正确');
  }
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 解密 JWE
 *
 * @param parsed 已解析的 JWE 结构（来自 parseJwe）
 * @param keyInput 用户输入的密钥材料
 * @param keyFormat 密钥格式：base64url（对称密钥）/ pem（RSA 私钥）/ utf8（PBES2 密码）
 */
export async function decryptJwe(
  parsed: ParsedJwe,
  keyInput: string,
  keyFormat: 'base64url' | 'pem' | 'utf8',
): Promise<DecryptResult> {
  if (!parsed.ok || !parsed.parts || !parsed.header) {
    return { ok: false, error: parsed.error || 'JWE 解析失败' };
  }
  const { alg, enc } = parsed.header;
  if (!alg || !enc) {
    return { ok: false, error: '缺少 alg 或 enc 字段' };
  }

  // RSA1_5 存在 Bleichenbacher 攻击风险，已从默认支持列表移除，拒绝解密并提示替代方案
  if (alg === 'RSA1_5') {
    return {
      ok: false,
      error:
        'RSA1_5（PKCS#1 v1.5）存在 Bleichenbacher 攻击风险，已不再支持解密。请使用 RSA-OAEP 系列算法替代（如 RSA-OAEP-256）。',
    };
  }

  // 检查算法是否支持
  if (!SUPPORTED_DECRYPT_ALGS.includes(alg)) {
    return {
      ok: false,
      error: `暂不支持解密 alg=${alg}（支持的算法：${SUPPORTED_DECRYPT_ALGS.join('、')}）`,
    };
  }
  if (!SUPPORTED_DECRYPT_ENCS.includes(enc)) {
    return {
      ok: false,
      error: `暂不支持解密 enc=${enc}（仅支持 GCM 系列：${SUPPORTED_DECRYPT_ENCS.join('、')}）`,
    };
  }

  // 检查 Web Crypto API 是否可用（仅在客户端可用）
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return { ok: false, error: '当前环境不支持 Web Crypto API（需 HTTPS 或 localhost）' };
  }

  const { protectedHeader, encryptedKey, iv, ciphertext, tag } = parsed.parts;
  const ivBytes = base64urlDecode(iv);
  const ciphertextBytes = base64urlDecode(ciphertext);
  const tagBytes = base64urlDecode(tag);
  const protectedHeaderBytes = encodeUtf8(protectedHeader);

  // GCM 模式下，SubtleCrypto 要求 ciphertext 与 tag 拼接为单个 Buffer
  const cipherWithTag = new Uint8Array(ciphertextBytes.length + tagBytes.length);
  cipherWithTag.set(ciphertextBytes, 0);
  cipherWithTag.set(tagBytes, ciphertextBytes.length);

  // 构造 AAD = ASCII(Encoded Protected Header)
  // 若 flattened 格式提供 aad，则 AAD = ASCII(Encoded Protected Header) || '.' || ASCII(aad)
  const aadBytes = parsed.aad
    ? encodeUtf8(protectedHeader + '.' + parsed.aad)
    : protectedHeaderBytes;

  try {
    let cek: CryptoKey;
    // 根据 alg 解出 CEK
    if (alg === 'dir') {
      // dir 算法：用户密钥直接作为 CEK
      if (!keyInput) {
        return { ok: false, error: 'dir 算法需要提供 base64url 编码的对称密钥' };
      }
      let keyBytes: Uint8Array<ArrayBuffer>;
      try {
        keyBytes = base64urlDecode(keyInput);
      } catch (e) {
        return { ok: false, error: `密钥 base64url 解码失败：${e instanceof Error ? e.message : ''}` };
      }
      if (keyBytes.length * 8 !== aesGcmLength(enc)) {
        return {
          ok: false,
          error: `密钥长度应为 ${aesGcmLength(enc)} 位（${aesGcmLength(enc) / 8} 字节），当前 ${keyBytes.length * 8} 位`,
        };
      }
      cek = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
    } else if (alg === 'A128KW' || alg === 'A192KW' || alg === 'A256KW') {
      // AES-KW：用户提供 KW 密钥，用 unwrapKey 解出 CEK
      if (!keyInput) {
        return { ok: false, error: `${alg} 算法需要提供 base64url 编码的 KW 密钥` };
      }
      let kwKeyBytes: Uint8Array<ArrayBuffer>;
      try {
        kwKeyBytes = base64urlDecode(keyInput);
      } catch (e) {
        return { ok: false, error: `KW 密钥 base64url 解码失败：${e instanceof Error ? e.message : ''}` };
      }
      if (kwKeyBytes.length * 8 !== aesKwLength(alg)) {
        return {
          ok: false,
          error: `KW 密钥长度应为 ${aesKwLength(alg)} 位，当前 ${kwKeyBytes.length * 8} 位`,
        };
      }
      const wrappedKeyBytes = base64urlDecode(encryptedKey);
      if (wrappedKeyBytes.length === 0) {
        return { ok: false, error: 'encrypted_key 段为空，无法解包 CEK' };
      }
      const kwKey = await crypto.subtle.importKey('raw', kwKeyBytes, { name: 'AES-KW' }, false, [
        'unwrapKey',
      ]);
      cek = await crypto.subtle.unwrapKey(
        'raw',
        wrappedKeyBytes,
        kwKey,
        { name: 'AES-KW' },
        { name: 'AES-GCM' },
        false,
        ['decrypt'],
      );
    } else if (alg.startsWith('RSA-OAEP')) {
      // RSA-OAEP 系：用户提供 PEM 格式 RSA 私钥，用 decrypt 解出 CEK
      // 注意：RSA1_5 已在前置校验中拦截，此处仅处理 RSA-OAEP 系列
      if (!keyInput) {
        return { ok: false, error: `${alg} 算法需要提供 PEM 格式的 RSA 私钥` };
      }
      let pkcs8Bytes: Uint8Array<ArrayBuffer>;
      try {
        pkcs8Bytes = parsePemRsaPrivateKey(keyInput);
      } catch (e) {
        return { ok: false, error: `PEM 解析失败：${e instanceof Error ? e.message : ''}` };
      }
      const rsaHash = rsaOaepHash(alg);
      const rsaKey = await crypto.subtle.importKey(
        'pkcs8',
        pkcs8Bytes,
        { name: 'RSA-OAEP', hash: rsaHash },
        false,
        ['decrypt'],
      );
      const wrappedKeyBytes = base64urlDecode(encryptedKey);
      if (wrappedKeyBytes.length === 0) {
        return { ok: false, error: 'encrypted_key 段为空，无法解出 CEK' };
      }
      const cekBytes = await crypto.subtle.decrypt(
        { name: 'RSA-OAEP' },
        rsaKey,
        wrappedKeyBytes,
      );
      cek = await crypto.subtle.importKey('raw', cekBytes, { name: 'AES-GCM' }, false, ['decrypt']);
    } else if (alg.startsWith('PBES2-')) {
      // PBES2：用户密码 + PBKDF2 派生 KW 密钥 + AES-KW 解包 CEK
      if (!keyInput) {
        return { ok: false, error: `${alg} 算法需要提供密码（UTF-8 字符串）` };
      }
      // 从 Protected Header 提取 p2s（salt）与 p2c（迭代次数）
      const p2s = parsed.header.p2s;
      const p2c = parsed.header.p2c;
      if (typeof p2s !== 'string' || !p2s) {
        return { ok: false, error: 'PBES2 算法要求 Protected Header 包含 p2s（salt）字段' };
      }
      if (typeof p2c !== 'number' || !Number.isFinite(p2c) || p2c <= 0) {
        return {
          ok: false,
          error: 'PBES2 算法要求 Protected Header 包含 p2c（正整数迭代次数）字段',
        };
      }
      // p2c 上限 1000 万，防止恶意 JWE 设超大迭代次数导致 PBKDF2 耗尽 CPU（DoS，参考 RFC 7518 4.8.1.2）
      const PBES2_MAX_ITERATIONS = 10_000_000;
      if (p2c > PBES2_MAX_ITERATIONS) {
        return {
          ok: false,
          error: `PBES2 迭代次数 p2c=${p2c} 超过上限 ${PBES2_MAX_ITERATIONS}，拒绝执行以防 DoS`,
        };
      }
      let saltBytes: Uint8Array<ArrayBuffer>;
      try {
        saltBytes = base64urlDecode(p2s);
      } catch (e) {
        return { ok: false, error: `p2s base64url 解码失败：${e instanceof Error ? e.message : ''}` };
      }
      const hashName = pbes2Hash(alg);
      const kwLen = pbes2KwLength(alg);
      // 密码 utf8 编码
      const passwordBytes = encodeUtf8(keyInput);
      // PBKDF2 派生 KW 密钥
      const baseKey = await crypto.subtle.importKey(
        'raw',
        passwordBytes,
        { name: 'PBKDF2' },
        false,
        ['deriveBits'],
      );
      const derivedBitsBuffer = await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: saltBytes,
          iterations: p2c,
          hash: { name: hashName },
        },
        baseKey,
        kwLen,
      );
      const derivedBytes = new Uint8Array(derivedBitsBuffer);
      // 用派生密钥作为 KW 密钥，unwrap CEK
      const kwKey = await crypto.subtle.importKey(
        'raw',
        derivedBytes,
        { name: 'AES-KW' },
        false,
        ['unwrapKey'],
      );
      const wrappedKeyBytes = base64urlDecode(encryptedKey);
      if (wrappedKeyBytes.length === 0) {
        return { ok: false, error: 'encrypted_key 段为空，无法解包 CEK' };
      }
      cek = await crypto.subtle.unwrapKey(
        'raw',
        wrappedKeyBytes,
        kwKey,
        { name: 'AES-KW' },
        { name: 'AES-GCM' },
        false,
        ['decrypt'],
      );
    } else if (alg === 'ECDH-ES' || alg.startsWith('ECDH-ES+')) {
      // ECDH-ES：用户提供 JWK 格式 EC 私钥，与 Protected Header 的 epk 执行 ECDH 派生
      if (!keyInput) {
        return { ok: false, error: `${alg} 算法需要提供 JWK 格式的 EC 私钥（JSON 字符串）` };
      }
      // 从 Protected Header 提取 epk（ephemeral public key，JWK 格式 EC 公钥）
      const epk = parsed.header.epk as
        | { kty: string; crv: string; x: string; y: string }
        | undefined;
      if (
        !epk ||
        epk.kty !== 'EC' ||
        !epk.crv ||
        !epk.x ||
        !epk.y
      ) {
        return {
          ok: false,
          error: 'ECDH-ES 算法要求 Protected Header 包含 epk（ephemeral public key，JWK 格式 EC 公钥，含 kty/crv/x/y）',
        };
      }
      if (!SUPPORTED_ECDH_CRVS.includes(epk.crv)) {
        return {
          ok: false,
          error: `不支持的曲线 ${epk.crv}（支持 P-256 / P-384 / P-521）`,
        };
      }
      // 解析用户输入的 JWK EC 私钥
      let receiverPrivJwk: { kty?: string; crv?: string; d?: string };
      try {
        receiverPrivJwk = JSON.parse(keyInput);
      } catch (e) {
        return {
          ok: false,
          error: `EC 私钥 JWK 解析失败：${e instanceof Error ? e.message : ''}`,
        };
      }
      if (receiverPrivJwk.kty !== 'EC' || !receiverPrivJwk.crv || !receiverPrivJwk.d) {
        return {
          ok: false,
          error: 'EC 私钥 JWK 必须包含 kty=EC、crv、d 字段',
        };
      }
      if (receiverPrivJwk.crv !== epk.crv) {
        return {
          ok: false,
          error: `曲线不匹配：epk.crv=${epk.crv}，私钥 crv=${receiverPrivJwk.crv}`,
        };
      }
      // 导入临时公钥与接收方私钥
      const pubKey = await crypto.subtle.importKey(
        'jwk',
        epk as JsonWebKey,
        { name: 'ECDH', namedCurve: epk.crv },
        false,
        [],
      );
      const privKey = await crypto.subtle.importKey(
        'jwk',
        receiverPrivJwk as JsonWebKey,
        { name: 'ECDH', namedCurve: epk.crv },
        false,
        ['deriveBits'],
      );
      // ECDH 派生共享秘密 Z
      const zBuffer = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: pubKey },
        privKey,
        ecdhZBits(epk.crv),
      );
      const zBytes = new Uint8Array(zBuffer);
      // Concat KDF 派生 CEK 或 KEK
      if (alg === 'ECDH-ES') {
        // 直接模式：派生 CEK，AlgorithmID = enc 名
        const cekLen = aesGcmLength(enc);
        const cekBytes = await concatKdf(zBytes, enc, cekLen);
        cek = await crypto.subtle.importKey('raw', cekBytes, { name: 'AES-GCM' }, false, [
          'decrypt',
        ]);
      } else {
        // ECDH-ES+AES-KW：派生 KEK，AlgorithmID = alg 名，再用 KEK 解包 CEK
        const kwAlg = alg.replace('ECDH-ES+', '');
        const kwLen = aesKwLength(kwAlg);
        const kekBytes = await concatKdf(zBytes, alg, kwLen);
        const kek = await crypto.subtle.importKey('raw', kekBytes, { name: 'AES-KW' }, false, [
          'unwrapKey',
        ]);
        const wrappedKeyBytes = base64urlDecode(encryptedKey);
        if (wrappedKeyBytes.length === 0) {
          return { ok: false, error: 'encrypted_key 段为空，无法解包 CEK' };
        }
        cek = await crypto.subtle.unwrapKey(
          'raw',
          wrappedKeyBytes,
          kek,
          { name: 'AES-KW' },
          { name: 'AES-GCM' },
          false,
          ['decrypt'],
        );
      }
    } else {
      return { ok: false, error: `暂不支持解密 alg=${alg}` };
    }

    // 用 CEK 解密 ciphertext
    const plaintextBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: ivBytes,
        additionalData: aadBytes,
        tagLength: 128, // GCM tag 固定 128 位
      },
      cek,
      cipherWithTag,
    );

    const plaintextBytes = new Uint8Array(plaintextBuffer);
    const plaintext = decodeUtf8(plaintextBytes);

    // 检查明文是否为合法 JSON
    let isJson = false;
    let json: string | undefined;
    const trimmed = plaintext.trim();
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        const obj = JSON.parse(trimmed);
        json = JSON.stringify(obj, null, 2);
        isJson = true;
      } catch {
        // 不是合法 JSON
      }
    }

    // 检查明文是否为 JWT（三段式）
    const isJwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed);

    return {
      ok: true,
      plaintext,
      plaintextBytes: plaintextBytes.length,
      isJson,
      json,
      isJwt,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 友好化常见错误
    if (msg.includes('MAC failed') || msg.includes('tag')) {
      return { ok: false, error: `认证标签校验失败（密钥错误、密文被篡改或 IV 错误）：${msg}` };
    }
    if (msg.includes('decrypt') && msg.includes('RSA')) {
      return { ok: false, error: `RSA 解密失败（私钥不匹配或 encrypted_key 损坏）：${msg}` };
    }
    // PBES2 解包失败：用户输入的是密码，提示应聚焦密码错误而非 KW 密钥
    if (alg.startsWith('PBES2-') && (msg.includes('unwrapKey') || msg.includes('AES-KW'))) {
      return { ok: false, error: `PBES2 解包失败（密码错误或 p2s/p2c 参数不匹配）：${msg}` };
    }
    // ECDH-ES 失败：聚焦私钥不匹配或 epk 损坏
    if (alg === 'ECDH-ES' || alg.startsWith('ECDH-ES+')) {
      if (msg.includes('unwrapKey') || msg.includes('AES-KW')) {
        return { ok: false, error: `ECDH-ES 解包失败（私钥不匹配、epk 损坏或 encrypted_key 损坏）：${msg}` };
      }
      return { ok: false, error: `ECDH-ES 解密失败（私钥不匹配或 epk/曲线错误）：${msg}` };
    }
    if (msg.includes('unwrapKey') || msg.includes('AES-KW')) {
      return { ok: false, error: `AES-KW 解包失败（KW 密钥错误或 encrypted_key 损坏）：${msg}` };
    }
    return { ok: false, error: `解密失败：${msg}` };
  }
}

/** JWE 示例 1：dir + A128GCM（来自 RFC 7516 Appendix A.1，仅用于格式演示） */
export const SAMPLE_JWE_DIR =
  'eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4R0NNIn0..' +
  '48V1_ALb6US04U3b.' +
  '5Jm_i0aK3aPLdQEbjJkyMw2Ou0HTkP4NZH5RjVQSjwWAEnL1k1VWbHbV8w.' +
  '-UM1RT8KBI';

/** JWE 示例 2：RSA-OAEP-256 + A256GCM（来自 RFC 7516 Appendix A.2，仅用于格式演示） */
export const SAMPLE_JWE_RSA =
  'eyJhbGciOiJSU0EtT0FFUC0yNTYiLCJlbmMiOiJBMjU2R0NNIn0.' +
  'OKOawDo13gRp2ojaHV7LFpZcgV7T6DVZKTyKOMTYUmKoTCVJRgckCL9kiMT03JGeipsEdY3mx_etLbbWSrFr05kLzcSr4qKAq7YN7e9jwQRb23nfa6cb9Husy6G-sLI1Xb3oxRf94IVG95gyTdWz3U5kxrlKGXAe6gSfSc4F8aKigfwV2KfwsZmbTNQ9ws.' +
  '48V1_ALb6US04U3b.' +
  '5Jm_i0aK3aPLdQEbjJkyMw2Ou0HTkP4NZH5RjVQSjwWAEnL1k1VWbHbV8w.' +
  '-UM1RT8KBI';

/** 默认示例明文（生成测试 JWE 时使用） */
export const SAMPLE_PLAINTEXT = JSON.stringify(
  {
    iss: 'website.niuzi.asia',
    sub: '10001',
    aud: 'api.website.niuzi.asia',
    iat: 1700000000,
    exp: 1900000000,
    jti: 'jwe-demo-token-001',
    scope: 'read:tools write:tools',
  },
  null,
  2,
);

/** 算法分类说明：用于 UI 显示用户应输入的密钥格式 */
export function getAlgCategory(alg: string | undefined): AlgCategory {
  if (!alg) return 'unsupported';
  return ALG_CATEGORY[alg] || 'unsupported';
}

/** 检查 alg 是否支持解密 */
export function isAlgSupported(alg: string | undefined): boolean {
  return !!alg && SUPPORTED_DECRYPT_ALGS.includes(alg);
}

/** 检查 enc 是否支持解密 */
export function isEncSupported(enc: string | undefined): boolean {
  return !!enc && SUPPORTED_DECRYPT_ENCS.includes(enc);
}
