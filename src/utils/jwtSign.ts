/**
 * JWT（JSON Web Token）签名生成工具
 *
 * 设计目标：
 *  - 零依赖纯 TS 实现，仅使用浏览器原生 Web Crypto API（SubtleCrypto）
 *  - 支持 HS256 / HS384 / HS512（HMAC + SHA，对称密钥）
 *  - 支持 RS256 / RS384 / RS512（RSASSA-PKCS1-v1_5 + SHA，RSA 非对称密钥）
 *  - 支持 ES256 / ES384 / ES512（ECDSA + SHA，椭圆曲线非对称密钥）
 *  - 支持 none 算法（无签名，仅用于调试演示，严禁生产使用）
 *  - 支持生成 RSA 密钥对（2048 / 3072 / 4096 位，输出 JWK 与 PEM 两种格式）
 *  - 支持生成 EC 密钥对（P-256 / P-384 / P-521 曲线，输出 JWK 与 PEM 两种格式）
 *  - 全程本地处理，密钥不离开浏览器，不上传、不存储
 *
 * 参考：
 *  - RFC 7519: JSON Web Token (JWT)
 *  - RFC 7518: JSON Web Algorithms (JWA)
 *  - RFC 7515: JSON Web Signature (JWS)
 *
 * 安全说明：
 *  - Web Crypto API 的 RSA-PSS 签名与 JWT 的 RS256（RSASSA-PKCS1-v1_5）不同，
 *    标准 RS256 使用 PKCS#1 v1.5 填充。为符合 JWT 规范，本工具用 RSASSA-PKCS1-v1_5
 *    算法（Web Crypto 的 { name: 'RSASSA-PKCS1-v1_5', hash }），而非 RSA-PSS。
 *  - Web Crypto API 的 ECDSA sign 默认输出 raw 格式（r || s 拼接，无 ASN.1 DER 包装），
 *    正好符合 RFC 7518 对 ES256/ES384/ES512 签名格式的要求，无需额外转换。
 *  - none 算法生成的 JWT 无签名，任何人都可伪造，仅用于调试与教学演示。
 */

/** JWT 签名算法 */
export type JwtAlg =
  | 'HS256'
  | 'HS384'
  | 'HS512'
  | 'RS256'
  | 'RS384'
  | 'RS512'
  | 'ES256'
  | 'ES384'
  | 'ES512'
  | 'none';

/** 算法类别：用于 UI 决定密钥输入形式 */
export type AlgCategory = 'hmac' | 'rsa' | 'ec' | 'none';

/** 算法元信息（用于 UI 展示与校验） */
export interface AlgInfo {
  /** 算法名（如 HS256） */
  alg: JwtAlg;
  /** 类别：hmac 对称 / rsa 非对称 / none 无签名 */
  category: AlgCategory;
  /** 中文说明 */
  desc: string;
  /** 推荐密钥长度（位），0 表示不限制 */
  minKeyBits: number;
  /** 安全等级：safe 推荐 / weak 弱 / insecure 不安全 */
  security: 'safe' | 'weak' | 'insecure';
}

/** 算法元信息表 */
export const ALG_LIST: AlgInfo[] = [
  {
    alg: 'HS256',
    category: 'hmac',
    desc: 'HMAC + SHA-256，对称密钥，签发与验签用同一密钥，性能高、实现简单',
    minKeyBits: 256,
    security: 'safe',
  },
  {
    alg: 'HS384',
    category: 'hmac',
    desc: 'HMAC + SHA-384，对称密钥，与 HS256 同族但摘要更长',
    minKeyBits: 384,
    security: 'safe',
  },
  {
    alg: 'HS512',
    category: 'hmac',
    desc: 'HMAC + SHA-512，对称密钥，本族中安全强度最高',
    minKeyBits: 512,
    security: 'safe',
  },
  {
    alg: 'RS256',
    category: 'rsa',
    desc: 'RSASSA-PKCS1-v1_5 + SHA-256，非对称密钥，私钥签发、公钥验签',
    minKeyBits: 2048,
    security: 'safe',
  },
  {
    alg: 'RS384',
    category: 'rsa',
    desc: 'RSASSA-PKCS1-v1_5 + SHA-384，非对称密钥，与 RS256 同族但摘要更长',
    minKeyBits: 2048,
    security: 'safe',
  },
  {
    alg: 'RS512',
    category: 'rsa',
    desc: 'RSASSA-PKCS1-v1_5 + SHA-512，非对称密钥，本族中安全强度最高',
    minKeyBits: 2048,
    security: 'safe',
  },
  {
    alg: 'ES256',
    category: 'ec',
    desc: 'ECDSA + SHA-256，P-256 曲线，非对称密钥，签名短密钥小，性能优于 RSA',
    minKeyBits: 256,
    security: 'safe',
  },
  {
    alg: 'ES384',
    category: 'ec',
    desc: 'ECDSA + SHA-384，P-384 曲线，非对称密钥，与 ES256 同族但摘要更长',
    minKeyBits: 384,
    security: 'safe',
  },
  {
    alg: 'ES512',
    category: 'ec',
    desc: 'ECDSA + SHA-512，P-521 曲线，非对称密钥，本族中安全强度最高',
    minKeyBits: 521,
    security: 'safe',
  },
  {
    alg: 'none',
    category: 'none',
    desc: '无签名算法，JWT 第三段为空，任何人都可伪造，仅用于调试演示，严禁生产使用',
    minKeyBits: 0,
    security: 'insecure',
  },
];

/** 算法名 → 元信息映射 */
export const ALG_MAP: Record<JwtAlg, AlgInfo> = ALG_LIST.reduce(
  (acc, info) => {
    acc[info.alg] = info;
    return acc;
  },
  {} as Record<JwtAlg, AlgInfo>,
);

/** RSA 密钥对生成结果 */
export interface RsaKeyPair {
  /** 公钥 JWK */
  publicJwk: JsonWebKey;
  /** 私钥 JWK */
  privateJwk: JsonWebKey;
  /** 公钥 PEM（SPKI 格式） */
  publicPem: string;
  /** 私钥 PEM（PKCS#8 格式） */
  privatePem: string;
  /** 密钥位数（如 2048） */
  bits: number;
}

/** EC 椭圆曲线名称 */
export type EcCurve = 'P-256' | 'P-384' | 'P-521';

/** EC 密钥对生成结果 */
export interface EcKeyPair {
  /** 公钥 JWK */
  publicJwk: JsonWebKey;
  /** 私钥 JWK */
  privateJwk: JsonWebKey;
  /** 公钥 PEM（SPKI 格式） */
  publicPem: string;
  /** 私钥 PEM（PKCS#8 格式） */
  privatePem: string;
  /** 曲线名（P-256 / P-384 / P-521） */
  curve: EcCurve;
  /** 密钥位数（P-256=256, P-384=384, P-521=521） */
  bits: number;
}

/** 算法 → 椭圆曲线名映射（用于 ES 系列） */
const ALG_TO_CURVE: Record<string, EcCurve> = {
  ES256: 'P-256',
  ES384: 'P-384',
  ES512: 'P-521',
};

/** 椭圆曲线 → 密钥位数映射 */
const CURVE_TO_BITS: Record<EcCurve, number> = {
  'P-256': 256,
  'P-384': 384,
  'P-521': 521,
};

/** JWT 签名结果 */
export interface JwtSignResult {
  /** 是否成功 */
  ok: boolean;
  /** 生成的 JWT（header.payload.signature） */
  token?: string;
  /** Header 段 base64url */
  headerB64?: string;
  /** Payload 段 base64url */
  payloadB64?: string;
  /** Signature 段 base64url（none 算法为空字符串） */
  signatureB64?: string;
  /** 美化后的 Header JSON */
  headerJson?: string;
  /** 美化后的 Payload JSON */
  payloadJson?: string;
  /** 签名长度（字节） */
  signatureBytes?: number;
  /** 错误信息 */
  error?: string;
}

/** 输入长度上限：防止超长 token 卡顿 */
export const MAX_INPUT_LENGTH = 50000;

/**
 * base64url 编码 Uint8Array
 * base64url 用 - 替换 +，用 _ 替换 /，且省略 padding
 */
export function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * base64url 解码为 Uint8Array
 * 还原 - 为 +，_ 为 /，并补齐 padding
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

/** 字符串转 UTF-8 Uint8Array */
export function encodeUtf8(str: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(str);
}

/** UTF-8 解码 Uint8Array 为字符串 */
export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

/** Uint8Array 转 hex 字符串 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 将 PEM 字符串转为 DER 字节数组
 * 支持 BEGIN/END 标记内的 base64 内容（自动去除换行与空白）
 *
 * 导出供 jwtVerify.ts 复用（验签需用公钥 PEM 解析）
 */
export function pemToDer(pem: string, label: RegExp): Uint8Array<ArrayBuffer> {
  const cleaned = pem
    .replace(label, '')
    .replace(/-----END[^-]*-----/g, '')
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

// ===== 最小 ASN.1 DER 编码工具（用于密钥格式转换，不引入第三方依赖）=====
// 背景：Web Crypto API 的 importKey 对 RSA/EC 密钥仅支持 'spki'/'pkcs8'/'raw'/'jwk'，
// 不支持 PKCS#1（BEGIN RSA PRIVATE/PUBLIC KEY）与 SEC1（BEGIN EC PRIVATE KEY）。
// 此处实现最小 DER 编码，将 PKCS#1/SEC1 密钥 DER 包裹为标准 SPKI/PKCS#8 容器，
// 再用现有格式逻辑导入，避免实现完整的 ASN.1 解析器。

/** DER 长度编码：短格式（<128）单字节，长格式带前缀 */
function encodeDerLength(len: number): number[] {
  if (len < 128) return [len];
  const bytes: number[] = [];
  let tmp = len;
  while (tmp > 0) {
    bytes.unshift(tmp & 0xff);
    tmp >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

/** 构造 DER SEQUENCE：tag(0x30) + 长度 + 子元素拼接 */
function derSequence(...elements: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const totalLen = elements.reduce((sum, el) => sum + el.length, 0);
  const header = [0x30, ...encodeDerLength(totalLen)];
  const result = new Uint8Array(header.length + totalLen);
  result.set(header, 0);
  let offset = header.length;
  for (const el of elements) {
    result.set(el, offset);
    offset += el.length;
  }
  return result;
}

/** 构造 DER OID：tag(0x06) + 长度 + OID 字节内容 */
function derOid(oidBytes: number[]): Uint8Array<ArrayBuffer> {
  const header = [0x06, ...encodeDerLength(oidBytes.length)];
  return new Uint8Array([...header, ...oidBytes]);
}

/** 构造 DER OCTET STRING：tag(0x04) + 长度 + 内容 */
function derOctetString(content: Uint8Array): Uint8Array<ArrayBuffer> {
  const header = [0x04, ...encodeDerLength(content.length)];
  const result = new Uint8Array(header.length + content.length);
  result.set(header, 0);
  result.set(content, header.length);
  return result;
}

// RSA 算法 OID: 1.2.840.113549.1.1.1（已编码为 DER 字节）
const RSA_OID_BYTES = [0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x01];
// EC 公钥算法 OID: 1.2.840.10045.2.1（已编码为 DER 字节）
const EC_OID_BYTES = [0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x02, 0x01];
// 椭圆曲线 OID 映射（P-256/P-384/P-521）
const CURVE_OID_BYTES: Record<EcCurve, number[]> = {
  'P-256': [0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07], // 1.2.840.10045.3.1.7
  'P-384': [0x2B, 0x81, 0x04, 0x00, 0x22], // 1.3.132.0.34
  'P-521': [0x2B, 0x81, 0x04, 0x00, 0x23], // 1.3.132.0.35
};

/**
 * 将 PKCS#1/SEC1 私钥 DER 包裹为 PKCS#8 PrivateKeyInfo 容器
 * 结构：SEQUENCE { version(0), AlgorithmIdentifier, OCTET STRING privateKey }
 * 这样即可用 importKey('pkcs8') 导入，无需完整 ASN.1 解析
 */
function wrapPrivateKeyToPkcs8(privateKeyDer: Uint8Array, algId: Uint8Array): Uint8Array<ArrayBuffer> {
  const version = new Uint8Array([0x02, 0x01, 0x00]); // INTEGER 0
  const keyOctetString = derOctetString(privateKeyDer);
  return derSequence(version, algId, keyOctetString);
}

/** 构造 RSA AlgorithmIdentifier：SEQUENCE { OID rsaEncryption, NULL } */
function rsaAlgorithmIdentifier(): Uint8Array<ArrayBuffer> {
  return derSequence(derOid(RSA_OID_BYTES), new Uint8Array([0x05, 0x00]));
}

/** 构造 EC AlgorithmIdentifier：SEQUENCE { OID id-ecPublicKey, OID 曲线 } */
function ecAlgorithmIdentifier(curve: EcCurve): Uint8Array<ArrayBuffer> {
  return derSequence(derOid(EC_OID_BYTES), derOid(CURVE_OID_BYTES[curve]));
}

/** 构造 DER BIT STRING：tag(0x03) + 长度 + 0x00(未使用位数) + 内容 */
function derBitString(content: Uint8Array): Uint8Array<ArrayBuffer> {
  const header = [0x03, ...encodeDerLength(content.length + 1)];
  const result = new Uint8Array(header.length + 1 + content.length);
  result.set(header, 0);
  result.set([0x00], header.length); // 未使用位数 = 0
  result.set(content, header.length + 1);
  return result;
}

/**
 * 将 PKCS#1 RSA 公钥 DER 包裹为 SPKI(SubjectPublicKeyInfo) 容器
 * 结构：SEQUENCE { AlgorithmIdentifier(RSA), BIT STRING subjectPublicKey }
 * subjectPublicKey 即 PKCS#1 的 RSAPublicKey DER（SEQUENCE { modulus, exponent }）
 * 包裹后可用 importKey('spki') 导入，绕过 Web Crypto 不支持 'pkcs1' 格式的限制
 */
export function wrapRsaPublicKeyToSpki(pkcs1PubDer: Uint8Array): Uint8Array<ArrayBuffer> {
  return derSequence(rsaAlgorithmIdentifier(), derBitString(pkcs1PubDer));
}

/**
 * 将 DER 字节数组转为 PEM 字符串
 * @param der DER 字节数组
 * @param label PEM 标签（如 'PUBLIC KEY'、'PRIVATE KEY'）
 */
function derToPem(der: Uint8Array, label: string): string {
  let binary = '';
  for (let i = 0; i < der.length; i++) {
    binary += String.fromCharCode(der[i]);
  }
  const base64 = btoa(binary);
  // 每 64 字符换行，符合 PEM 规范
  const lines = base64.match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

/**
 * 生成 RSA 密钥对
 *
 * @param bits 密钥位数，支持 2048 / 3072 / 4096
 * @returns 公私钥对（JWK + PEM 双格式）
 */
export async function generateRsaKeyPair(bits: 2048 | 3072 | 4096): Promise<RsaKeyPair> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('当前环境不支持 Web Crypto API（需 HTTPS 或 localhost）');
  }
  // 生成 RSA-PSS 密钥对（同时可用于 RSASSA-PKCS1-v1_5 签名）
  // 注：Web Crypto 的 generateKey 对 RSA-PSS 与 RSASSA-PKCS1-v1_5 生成相同结构的密钥，
  // 但导出 PEM 时需用对应算法导出。这里生成时用 RSASSA-PKCS1-v1_5，避免使用限制。
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: bits,
      publicExponent: new Uint8Array([1, 0, 1]), // 65537
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );

  // 导出 JWK
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

  // 导出 DER 后转 PEM
  const publicDer = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));
  const privateDer = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
  const publicPem = derToPem(publicDer, 'PUBLIC KEY');
  const privatePem = derToPem(privateDer, 'PRIVATE KEY');

  return {
    publicJwk,
    privateJwk,
    publicPem,
    privatePem,
    bits,
  };
}

/**
 * 解析用户输入的 RSA 私钥（支持 PEM 或 JWK）
 *
 * @param keyInput PEM 字符串或 JWK JSON 字符串
 * @param hashName SHA 哈希名（SHA-256 / SHA-384 / SHA-512）
 * @returns CryptoKey（用于签名）
 */
async function importRsaPrivateKey(
  keyInput: string,
  hashName: string,
): Promise<CryptoKey> {
  const trimmed = keyInput.trim();
  // 判断是 PEM 还是 JWK
  if (trimmed.startsWith('{')) {
    // JWK 格式
    let jwk: JsonWebKey;
    try {
      jwk = JSON.parse(trimmed);
    } catch (e) {
      throw new Error(`JWK 解析失败：${e instanceof Error ? e.message : ''}`);
    }
    if (!jwk.kty || jwk.kty !== 'RSA' || !jwk.n || !jwk.d) {
      throw new Error('JWK 不是合法的 RSA 私钥（缺少 kty=RSA 或 n/d 字段）');
    }
    return crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: hashName },
      false,
      ['sign'],
    );
  }
  // PEM 格式（PKCS#1 或 PKCS#8）
  // 检测标签：BEGIN RSA PRIVATE KEY 为 PKCS#1，需包装为 PKCS#8
  const isPkcs1 = /-----BEGIN RSA PRIVATE KEY-----/.test(trimmed);
  let derBytes: Uint8Array<ArrayBuffer>;
  try {
    derBytes = pemToDer(trimmed, /-----BEGIN[^-]*PRIVATE KEY-----/g);
  } catch (e) {
    throw new Error(`PEM 解析失败：${e instanceof Error ? e.message : ''}`);
  }
  // PKCS#1 格式私钥 Web Crypto 不直接支持，包裹为 PKCS#8 容器后再导入
  if (isPkcs1) {
    derBytes = wrapPrivateKeyToPkcs8(derBytes, rsaAlgorithmIdentifier());
  }
  return crypto.subtle.importKey(
    'pkcs8',
    derBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: hashName },
    false,
    ['sign'],
  );
}

/**
 * 生成 EC 椭圆曲线密钥对
 *
 * @param curve 曲线名（P-256 / P-384 / P-521）
 * @returns 公私钥对（JWK + PEM 双格式）
 */
export async function generateEcKeyPair(curve: EcCurve): Promise<EcKeyPair> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('当前环境不支持 Web Crypto API（需 HTTPS 或 localhost）');
  }
  // Web Crypto 的 ECDSA 密钥对生成：指定 namedCurve 即可
  // 注：sign 时算法名仍写 { name: 'ECDSA', hash }，hash 在 sign 时指定
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: curve,
    },
    true,
    ['sign', 'verify'],
  );

  // 导出 JWK
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

  // 导出 DER 后转 PEM（公钥 SPKI 格式，私钥 PKCS#8 格式）
  const publicDer = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));
  const privateDer = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
  const publicPem = derToPem(publicDer, 'PUBLIC KEY');
  const privatePem = derToPem(privateDer, 'PRIVATE KEY');

  return {
    publicJwk,
    privateJwk,
    publicPem,
    privatePem,
    curve,
    bits: CURVE_TO_BITS[curve],
  };
}

/**
 * 解析用户输入的 EC 私钥（支持 PEM 或 JWK）
 *
 * @param keyInput PEM 字符串或 JWK JSON 字符串
 * @param hashName SHA 哈希名（SHA-256 / SHA-384 / SHA-512）
 * @param curve 椭圆曲线名（P-256 / P-384 / P-521），用于校验 JWK 的 crv 字段
 * @returns CryptoKey（用于签名）
 */
async function importEcPrivateKey(
  keyInput: string,
  hashName: string,
  curve: EcCurve,
): Promise<CryptoKey> {
  const trimmed = keyInput.trim();
  // 判断是 PEM 还是 JWK
  if (trimmed.startsWith('{')) {
    // JWK 格式
    let jwk: JsonWebKey;
    try {
      jwk = JSON.parse(trimmed);
    } catch (e) {
      throw new Error(`JWK 解析失败：${e instanceof Error ? e.message : ''}`);
    }
    if (!jwk.kty || jwk.kty !== 'EC' || !jwk.crv || !jwk.d || !jwk.x || !jwk.y) {
      throw new Error('JWK 不是合法的 EC 私钥（缺少 kty=EC 或 crv/x/y/d 字段）');
    }
    if (jwk.crv !== curve) {
      throw new Error(`JWK 曲线 ${jwk.crv} 与算法要求 ${curve} 不匹配`);
    }
    return crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: curve, hash: hashName },
      false,
      ['sign'],
    );
  }
  // PEM 格式（SEC1 或 PKCS#8）
  // 检测标签：BEGIN EC PRIVATE KEY 为 SEC1，需包装为 PKCS#8
  const isSec1 = /-----BEGIN EC PRIVATE KEY-----/.test(trimmed);
  let derBytes: Uint8Array<ArrayBuffer>;
  try {
    derBytes = pemToDer(trimmed, /-----BEGIN[^-]*PRIVATE KEY-----/g);
  } catch (e) {
    throw new Error(`PEM 解析失败：${e instanceof Error ? e.message : ''}`);
  }
  // SEC1 格式私钥 Web Crypto 不直接支持，包裹为 PKCS#8 容器（含曲线 OID）后再导入
  if (isSec1) {
    derBytes = wrapPrivateKeyToPkcs8(derBytes, ecAlgorithmIdentifier(curve));
  }
  return crypto.subtle.importKey(
    'pkcs8',
    derBytes,
    { name: 'ECDSA', namedCurve: curve, hash: hashName },
    false,
    ['sign'],
  );
}

/**
 * 签发 JWT
 *
 * @param header JWT Header 对象（alg/typ 等）
 * @param payload JWT Payload 对象（声明集合）
 * @param keyInput 密钥：HMAC 算法为 UTF-8 字符串或 base64url 编码字节；RSA 算法为 PEM 或 JWK
 * @param keyFormat HMAC 密钥格式：'utf8' 字符串 / 'base64url' 编码字节；RSA 算法忽略此参数
 */
export async function signJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  keyInput: string,
  keyFormat: 'utf8' | 'base64url' = 'utf8',
): Promise<JwtSignResult> {
  // 算法校验
  const alg = header.alg as JwtAlg | undefined;
  if (!alg) {
    return { ok: false, error: 'Header 缺少 alg 字段' };
  }
  if (!ALG_MAP[alg]) {
    return { ok: false, error: `不支持的算法：${alg}（支持 ${ALG_LIST.map((a) => a.alg).join(' / ')}）` };
  }

  // 检查 Web Crypto API 是否可用
  if (alg !== 'none' && (typeof crypto === 'undefined' || !crypto.subtle)) {
    return { ok: false, error: '当前环境不支持 Web Crypto API（需 HTTPS 或 localhost）' };
  }

  // 序列化 Header 与 Payload
  // typ 字段若未指定，默认补 'JWT'
  const headerObj: Record<string, unknown> = { typ: 'JWT', ...header, alg };
  const headerJson = JSON.stringify(headerObj);
  const payloadJson = JSON.stringify(payload);
  const headerB64 = base64urlEncode(encodeUtf8(headerJson));
  const payloadB64 = base64urlEncode(encodeUtf8(payloadJson));
  const signingInput = `${headerB64}.${payloadB64}`;

  try {
    let signatureB64: string;
    let signatureBytes = 0;

    if (alg === 'none') {
      // none 算法：无签名，第三段为空字符串
      signatureB64 = '';
      signatureBytes = 0;
    } else if (alg === 'HS256' || alg === 'HS384' || alg === 'HS512') {
      // HMAC 系列
      if (!keyInput) {
        return { ok: false, error: `${alg} 算法需要提供密钥` };
      }
      const hashName = alg === 'HS256' ? 'SHA-256' : alg === 'HS384' ? 'SHA-384' : 'SHA-512';
      // 将用户输入密钥转为字节
      let keyBytes: Uint8Array<ArrayBuffer>;
      try {
        keyBytes = keyFormat === 'base64url' ? base64urlDecode(keyInput) : encodeUtf8(keyInput);
      } catch (e) {
        return {
          ok: false,
          error: `密钥 ${keyFormat === 'base64url' ? 'base64url 解码' : 'UTF-8 编码'}失败：${
            e instanceof Error ? e.message : ''
          }`,
        };
      }
      // 密钥长度建议（非强制，仅警告由 UI 处理）
      const hmacKey = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'HMAC', hash: { name: hashName } },
        false,
        ['sign'],
      );
      const sigBuffer = await crypto.subtle.sign(
        { name: 'HMAC' },
        hmacKey,
        encodeUtf8(signingInput),
      );
      const sigBytes = new Uint8Array(sigBuffer);
      signatureB64 = base64urlEncode(sigBytes);
      signatureBytes = sigBytes.length;
    } else if (alg === 'RS256' || alg === 'RS384' || alg === 'RS512') {
      // RSA 系列
      if (!keyInput) {
        return { ok: false, error: `${alg} 算法需要提供 RSA 私钥（PEM 或 JWK）` };
      }
      const hashName = alg === 'RS256' ? 'SHA-256' : alg === 'RS384' ? 'SHA-384' : 'SHA-512';
      let rsaKey: CryptoKey;
      try {
        rsaKey = await importRsaPrivateKey(keyInput, hashName);
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : `RSA 私钥导入失败：${String(e)}`,
        };
      }
      const sigBuffer = await crypto.subtle.sign(
        { name: 'RSASSA-PKCS1-v1_5' },
        rsaKey,
        encodeUtf8(signingInput),
      );
      const sigBytes = new Uint8Array(sigBuffer);
      signatureB64 = base64urlEncode(sigBytes);
      signatureBytes = sigBytes.length;
    } else {
      // EC 系列（ES256 / ES384 / ES512）
      // Web Crypto API 的 ECDSA sign 默认输出 raw 格式（r || s 拼接），
      // 正好符合 RFC 7518 对 ES 系列签名格式的要求，无需 DER → raw 转换
      if (!keyInput) {
        return { ok: false, error: `${alg} 算法需要提供 EC 私钥（PEM 或 JWK）` };
      }
      const hashName = alg === 'ES256' ? 'SHA-256' : alg === 'ES384' ? 'SHA-384' : 'SHA-512';
      const curve = ALG_TO_CURVE[alg];
      let ecKey: CryptoKey;
      try {
        ecKey = await importEcPrivateKey(keyInput, hashName, curve);
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : `EC 私钥导入失败：${String(e)}`,
        };
      }
      const sigBuffer = await crypto.subtle.sign(
        { name: 'ECDSA', hash: hashName },
        ecKey,
        encodeUtf8(signingInput),
      );
      const sigBytes = new Uint8Array(sigBuffer);
      signatureB64 = base64urlEncode(sigBytes);
      signatureBytes = sigBytes.length;
    }

    const token = `${signingInput}.${signatureB64}`;
    return {
      ok: true,
      token,
      headerB64,
      payloadB64,
      signatureB64,
      headerJson: JSON.stringify(headerObj, null, 2),
      payloadJson: JSON.stringify(payload, null, 2),
      signatureBytes,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 友好化常见错误
    if (msg.includes('importKey')) {
      return { ok: false, error: `密钥导入失败（格式不匹配或密钥损坏）：${msg}` };
    }
    if (msg.includes('sign')) {
      return { ok: false, error: `签名计算失败（密钥与算法不匹配或环境不支持）：${msg}` };
    }
    return { ok: false, error: `签名失败：${msg}` };
  }
}

/**
 * 校验 HMAC 密钥长度是否达到推荐值
 * @returns 长度不足时返回警告信息，否则返回 null
 */
export function checkHmacKeyLength(alg: JwtAlg, keyBits: number): string | null {
  const info = ALG_MAP[alg];
  if (!info || info.category !== 'hmac') return null;
  if (keyBits < info.minKeyBits) {
    return `密钥长度 ${keyBits} 位低于推荐值 ${info.minKeyBits} 位（${alg} 要求至少 ${
      info.minKeyBits / 8
    } 字节），可能被暴力破解`;
  }
  return null;
}

/**
 * 计算 HMAC 密钥位数
 * @param keyInput 密钥字符串
 * @param keyFormat 'utf8' 字符串 / 'base64url' 编码字节
 */
export function getHmacKeyBits(keyInput: string, keyFormat: 'utf8' | 'base64url'): number {
  if (!keyInput) return 0;
  try {
    const bytes = keyFormat === 'base64url' ? base64urlDecode(keyInput) : encodeUtf8(keyInput);
    return bytes.length * 8;
  } catch {
    return 0;
  }
}

/** 默认 Header 示例 */
export const SAMPLE_HEADER = {
  alg: 'HS256',
  typ: 'JWT',
};

/** 默认 Payload 示例（含标准声明） */
export const SAMPLE_PAYLOAD = {
  iss: 'toolbox.example.com',
  sub: '10001',
  aud: 'api.toolbox.example.com',
  iat: 1700000000,
  exp: 1900000000,
  jti: 'jwt-demo-token-001',
  name: '张三',
  role: 'admin',
  scope: 'read:tools write:tools',
};

/** HS256 演示密钥（UTF-8 字符串，仅用于演示） */
export const SAMPLE_HMAC_KEY = 'your-256-bit-secret-key-for-demo-only';

/** 标准声明字段中文说明（用于 UI 展示） */
export const CLAIM_DESC: Record<string, string> = {
  iss: '签发者（Issuer）',
  sub: '主题（Subject，通常为用户 ID）',
  aud: '受众（Audience，目标服务）',
  exp: '过期时间（Expiration，Unix 秒级时间戳）',
  nbf: '生效时间（Not Before）',
  iat: '签发时间（Issued At）',
  jti: 'JWT 唯一标识（JWT ID，用于防重放）',
  name: '用户名（自定义声明）',
  email: '邮箱（自定义声明）',
  role: '角色（自定义声明）',
  scope: '权限范围（自定义声明）',
};
