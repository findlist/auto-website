/**
 * JWT（JSON Web Token）签名验证工具
 *
 * 设计目标：
 *  - 零依赖纯 TS 实现，仅使用浏览器原生 Web Crypto API（SubtleCrypto）
 *  - 支持 HS256 / HS384 / HS512（HMAC + SHA，对称密钥验签）
 *  - 支持 RS256 / RS384 / RS512（RSASSA-PKCS1-v1_5 + SHA，RSA 公钥验签）
 *  - 支持 ES256 / ES384 / ES512（ECDSA + SHA，椭圆曲线公钥验签）
 *  - 支持 none 算法（无签名，直接警告，不进行验签）
 *  - 自动解析 JWT 三段式结构、解码 Header/Payload
 *  - 校验 exp（过期时间）、nbf（生效时间）、iat（签发时间）等声明
 *  - 全程本地处理，密钥不离开浏览器，不上传、不存储
 *
 * 参考：
 *  - RFC 7519: JSON Web Token (JWT)
 *  - RFC 7518: JSON Web Algorithms (JWA)
 *  - RFC 7515: JSON Web Signature (JWS)
 *
 * 安全说明：
 *  - 与 jwtSign.ts 共享 base64url / PEM / JWK 解析逻辑，但验签需用「公钥」（非对称）或「同一密钥」（HMAC）
 *  - Web Crypto API 的 verify 方法对 ECDSA 同样接受 raw 格式签名（r || s 拼接），
 *    与 JWT ES 系列签名格式一致，无需 DER 转换
 *  - 验签结果仅代表「签名与密钥匹配」，不代表令牌可信——还需校验 exp/nbf/iss/aud 等声明
 *  - 严禁信任 token 自身声明的 alg：调用方应硬编码允许的算法白名单
 */

import {
  ALG_MAP,
  base64urlDecode,
  decodeUtf8,
  encodeUtf8,
  pemToDer,
  wrapRsaPublicKeyToSpki,
  type EcCurve,
  type JwtAlg,
} from './jwtSign';

/** 算法 → 椭圆曲线名映射（用于 ES 系列校验） */
const ALG_TO_CURVE: Record<string, EcCurve> = {
  ES256: 'P-256',
  ES384: 'P-384',
  ES512: 'P-521',
};

/** 算法 → SHA 哈希名映射 */
const ALG_TO_HASH: Record<string, string> = {
  HS256: 'SHA-256',
  HS384: 'SHA-384',
  HS512: 'SHA-512',
  RS256: 'SHA-256',
  RS384: 'SHA-384',
  RS512: 'SHA-512',
  ES256: 'SHA-256',
  ES384: 'SHA-384',
  ES512: 'SHA-512',
};

/** 声明校验项状态 */
export type ClaimStatus = 'valid' | 'expired' | 'not_yet_valid' | 'missing' | 'invalid';

/** 单条声明校验结果 */
export interface ClaimCheck {
  /** 字段名（exp / nbf / iat） */
  field: 'exp' | 'nbf' | 'iat';
  /** 中文说明 */
  desc: string;
  /** 状态 */
  status: ClaimStatus;
  /** 原始值（Unix 秒） */
  value?: number;
  /** 本地化时间字符串 */
  localTime?: string;
  /** 相对时间描述（如「剩余 7 天」「已过期 3 小时」） */
  relative?: string;
  /** 提示信息 */
  message?: string;
}

/** JWT 验签结果 */
export interface JwtVerifyResult {
  /** 是否整体通过（签名有效 + 必要声明通过） */
  ok: boolean;
  /** 签名是否有效（仅代表密码学验证结果，不含声明校验） */
  signatureValid: boolean;
  /** JWT 算法（来自 Header.alg） */
  alg?: JwtAlg;
  /** 算法类别 */
  category?: 'hmac' | 'rsa' | 'ec' | 'none';
  /** Header 段 base64url */
  headerB64?: string;
  /** Payload 段 base64url */
  payloadB64?: string;
  /** Signature 段 base64url */
  signatureB64?: string;
  /** 美化后的 Header JSON */
  headerJson?: string;
  /** 美化后的 Payload JSON */
  payloadJson?: string;
  /** Header 对象 */
  header?: Record<string, unknown>;
  /** Payload 对象 */
  payload?: Record<string, unknown>;
  /** 声明校验结果列表 */
  claimChecks?: ClaimCheck[];
  /** 错误信息（解析或验签失败时） */
  error?: string;
  /** 警告信息（如 none 算法、密钥长度不足等） */
  warnings?: string[];
}

/** 输入长度上限：防止超长 token 卡顿 */
export const MAX_JWT_INPUT_LENGTH = 50000;

/**
 * 解析 JWT 字符串为三段 base64url
 * 支持两段（none 算法，末尾有点但签名段为空）与三段格式
 */
function parseJwtSegments(token: string): {
  headerB64: string;
  payloadB64: string;
  signatureB64: string;
} {
  const trimmed = token.trim();
  // 拆分为最多三段
  const parts = trimmed.split('.');
  if (parts.length < 2) {
    throw new Error('JWT 格式错误：至少需要 2 个点号分隔的段（header.payload）');
  }
  if (parts.length > 3) {
    throw new Error(`JWT 格式错误：段数 ${parts.length} 超过 3，可能是 JWE（5 段式）而非 JWT`);
  }
  const [headerB64, payloadB64, signatureB64 = ''] = parts;
  if (!headerB64 || !payloadB64) {
    throw new Error('JWT 格式错误：Header 或 Payload 段为空');
  }
  return { headerB64, payloadB64, signatureB64 };
}

/**
 * 安全解析 base64url 编码的 JSON 对象
 * 失败时抛出带具体原因的中文错误
 */
function parseSegmentJson(b64: string, segmentName: string): Record<string, unknown> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64urlDecode(b64);
  } catch (e) {
    throw new Error(`${segmentName} 段 base64url 解码失败：${e instanceof Error ? e.message : ''}`);
  }
  let text: string;
  try {
    text = decodeUtf8(bytes);
  } catch (e) {
    throw new Error(`${segmentName} 段 UTF-8 解码失败：${e instanceof Error ? e.message : ''}`);
  }
  try {
    const obj = JSON.parse(text);
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      throw new Error(`${segmentName} 必须是 JSON 对象`);
    }
    return obj as Record<string, unknown>;
  } catch (e) {
    throw new Error(
      `${segmentName} 段 JSON 解析失败：${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * 导入 HMAC 验签密钥
 * @param keyInput 密钥字符串
 * @param keyFormat 'utf8' 字符串 / 'base64url' 编码字节
 * @param hashName SHA 哈希名
 */
async function importHmacVerifyKey(
  keyInput: string,
  keyFormat: 'utf8' | 'base64url',
  hashName: string,
): Promise<CryptoKey> {
  let keyBytes: Uint8Array<ArrayBuffer>;
  try {
    keyBytes = keyFormat === 'base64url' ? base64urlDecode(keyInput) : encodeUtf8(keyInput);
  } catch (e) {
    throw new Error(`密钥 ${keyFormat === 'base64url' ? 'base64url 解码' : 'UTF-8 编码'}失败：${
      e instanceof Error ? e.message : ''
    }`);
  }
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: { name: hashName } },
    false,
    ['verify'],
  );
}

/**
 * 导入 RSA 公钥用于验签
 * 支持 PEM（SPKI 或 PKCS#1）与 JWK 两种格式
 */
async function importRsaPublicKey(keyInput: string, hashName: string): Promise<CryptoKey> {
  const trimmed = keyInput.trim();
  if (trimmed.startsWith('{')) {
    // JWK 格式
    let jwk: JsonWebKey;
    try {
      jwk = JSON.parse(trimmed);
    } catch (e) {
      throw new Error(`JWK 解析失败：${e instanceof Error ? e.message : ''}`);
    }
    if (!jwk.kty || jwk.kty !== 'RSA' || !jwk.n || !jwk.e) {
      throw new Error('JWK 不是合法的 RSA 公钥（缺少 kty=RSA 或 n/e 字段）');
    }
    return crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: hashName },
      false,
      ['verify'],
    );
  }
  // PEM 格式：通过标签区分 PKCS#1（BEGIN RSA PUBLIC KEY）与 SPKI（BEGIN PUBLIC KEY）
  // Web Crypto 的 importKey 不支持 'pkcs1' 格式，PKCS#1 公钥需先包裹为 SPKI 容器再导入
  const isPkcs1 = /-----BEGIN RSA PUBLIC KEY-----/.test(trimmed);
  let derBytes: Uint8Array<ArrayBuffer>;
  try {
    derBytes = pemToDer(trimmed, /-----BEGIN[^-]*PUBLIC KEY-----/g);
  } catch (e) {
    throw new Error(`PEM 解析失败：${e instanceof Error ? e.message : ''}`);
  }
  const spkiDer = isPkcs1 ? wrapRsaPublicKeyToSpki(derBytes) : derBytes;
  return crypto.subtle.importKey(
    'spki',
    spkiDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: hashName },
    false,
    ['verify'],
  );
}

/**
 * 导入 EC 公钥用于验签
 * 支持 PEM（SPKI）与 JWK 两种格式
 */
async function importEcPublicKey(
  keyInput: string,
  hashName: string,
  curve: EcCurve,
): Promise<CryptoKey> {
  const trimmed = keyInput.trim();
  if (trimmed.startsWith('{')) {
    // JWK 格式
    let jwk: JsonWebKey;
    try {
      jwk = JSON.parse(trimmed);
    } catch (e) {
      throw new Error(`JWK 解析失败：${e instanceof Error ? e.message : ''}`);
    }
    if (!jwk.kty || jwk.kty !== 'EC' || !jwk.crv || !jwk.x || !jwk.y) {
      throw new Error('JWK 不是合法的 EC 公钥（缺少 kty=EC 或 crv/x/y 字段）');
    }
    if (jwk.crv !== curve) {
      throw new Error(`JWK 曲线 ${jwk.crv} 与算法要求 ${curve} 不匹配`);
    }
    return crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: curve, hash: hashName },
      false,
      ['verify'],
    );
  }
  // PEM 格式（SPKI）
  let derBytes: Uint8Array<ArrayBuffer>;
  try {
    derBytes = pemToDer(trimmed, /-----BEGIN[^-]*PUBLIC KEY-----/g);
  } catch (e) {
    throw new Error(`PEM 解析失败：${e instanceof Error ? e.message : ''}`);
  }
  return crypto.subtle.importKey(
    'spki',
    derBytes,
    { name: 'ECDSA', namedCurve: curve, hash: hashName },
    false,
    ['verify'],
  );
}

/**
 * 把 Unix 秒级时间戳转为本地化时间字符串
 */
function formatUnixTime(seconds: number): string {
  try {
    return new Date(seconds * 1000).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return `Unix ${seconds}`;
  }
}

/**
 * 计算相对时间描述
 * @returns 「剩余 X 天 Y 小时」「已过期 X 天 Y 小时」「X 天前」等
 */
function formatRelativeTime(targetSeconds: number, nowSeconds: number, isFuture: boolean): string {
  const diff = Math.abs(targetSeconds - nowSeconds);
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  if (days > 0) {
    return isFuture ? `剩余 ${days} 天 ${hours} 小时` : `已${isFuture ? '' : '过期 '}${days} 天 ${hours} 小时`;
  }
  if (hours > 0) {
    return isFuture ? `剩余 ${hours} 小时 ${minutes} 分` : `已过期 ${hours} 小时 ${minutes} 分`;
  }
  return isFuture ? `剩余 ${minutes} 分钟` : `已过期 ${minutes} 分钟`;
}

/**
 * 校验 Payload 中的标准时间声明：exp / nbf / iat
 */
function checkTimeClaims(payload: Record<string, unknown>): ClaimCheck[] {
  const checks: ClaimCheck[] = [];
  const nowSec = Math.floor(Date.now() / 1000);

  // exp：过期时间，必须是数字且大于当前时间
  if (payload.exp !== undefined) {
    const exp = payload.exp;
    if (typeof exp !== 'number' || !Number.isFinite(exp)) {
      checks.push({
        field: 'exp',
        desc: '过期时间',
        status: 'invalid',
        value: exp as number,
        message: 'exp 字段不是合法的数字',
      });
    } else {
      const isFuture = exp > nowSec;
      checks.push({
        field: 'exp',
        desc: '过期时间',
        status: isFuture ? 'valid' : 'expired',
        value: exp,
        localTime: formatUnixTime(exp),
        relative: formatRelativeTime(exp, nowSec, isFuture),
        message: isFuture ? '令牌未过期' : '令牌已过期',
      });
    }
  } else {
    checks.push({
      field: 'exp',
      desc: '过期时间',
      status: 'missing',
      message: 'Payload 缺少 exp 字段，令牌永不过期（不推荐）',
    });
  }

  // nbf：生效时间，必须小于当前时间
  if (payload.nbf !== undefined) {
    const nbf = payload.nbf;
    if (typeof nbf !== 'number' || !Number.isFinite(nbf)) {
      checks.push({
        field: 'nbf',
        desc: '生效时间',
        status: 'invalid',
        value: nbf as number,
        message: 'nbf 字段不是合法的数字',
      });
    } else {
      const isFuture = nbf > nowSec;
      checks.push({
        field: 'nbf',
        desc: '生效时间',
        status: isFuture ? 'not_yet_valid' : 'valid',
        value: nbf,
        localTime: formatUnixTime(nbf),
        relative: isFuture ? formatRelativeTime(nbf, nowSec, true) : undefined,
        message: isFuture ? '令牌尚未生效' : '令牌已生效',
      });
    }
  }

  // iat：签发时间，应是过去的时间
  if (payload.iat !== undefined) {
    const iat = payload.iat;
    if (typeof iat !== 'number' || !Number.isFinite(iat)) {
      checks.push({
        field: 'iat',
        desc: '签发时间',
        status: 'invalid',
        value: iat as number,
        message: 'iat 字段不是合法的数字',
      });
    } else {
      const isFuture = iat > nowSec;
      checks.push({
        field: 'iat',
        desc: '签发时间',
        status: isFuture ? 'invalid' : 'valid',
        value: iat,
        localTime: formatUnixTime(iat),
        relative: isFuture ? '签发时间在未来（异常）' : formatRelativeTime(iat, nowSec, false),
        message: isFuture ? 'iat 在未来时间，可能令牌被篡改' : '签发时间正常',
      });
    }
  }

  return checks;
}

/**
 * 验证 JWT 签名与声明
 *
 * @param token JWT 字符串（header.payload.signature 或 header.payload.）
 * @param keyInput 密钥：HMAC 为对称密钥字符串；RSA 为 PEM/JWK 公钥；EC 为 PEM/JWK 公钥；none 算法忽略
 * @param keyFormat HMAC 密钥格式：'utf8' / 'base64url'；非 HMAC 算法忽略
 * @param expectedAlg 期望的算法（白名单）。若提供且与 token header.alg 不匹配，直接失败（防 alg=none 攻击）
 */
export async function verifyJwt(
  token: string,
  keyInput: string,
  keyFormat: 'utf8' | 'base64url' = 'utf8',
  expectedAlg?: JwtAlg,
): Promise<JwtVerifyResult> {
  const warnings: string[] = [];

  // 1. 解析三段式结构
  let segments: { headerB64: string; payloadB64: string; signatureB64: string };
  try {
    segments = parseJwtSegments(token);
  } catch (e) {
    return {
      ok: false,
      signatureValid: false,
      error: e instanceof Error ? e.message : String(e),
      warnings,
    };
  }
  const { headerB64, payloadB64, signatureB64 } = segments;

  // 2. 解析 Header / Payload
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = parseSegmentJson(headerB64, 'Header');
  } catch (e) {
    return {
      ok: false,
      signatureValid: false,
      headerB64,
      payloadB64,
      signatureB64,
      error: e instanceof Error ? e.message : String(e),
      warnings,
    };
  }
  try {
    payload = parseSegmentJson(payloadB64, 'Payload');
  } catch (e) {
    return {
      ok: false,
      signatureValid: false,
      headerB64,
      payloadB64,
      signatureB64,
      header,
      headerJson: JSON.stringify(header, null, 2),
      error: e instanceof Error ? e.message : String(e),
      warnings,
    };
  }

  // 3. 读取并校验 alg
  const alg = header.alg as JwtAlg | undefined;
  if (!alg) {
    return {
      ok: false,
      signatureValid: false,
      headerB64,
      payloadB64,
      signatureB64,
      header,
      payload,
      headerJson: JSON.stringify(header, null, 2),
      payloadJson: JSON.stringify(payload, null, 2),
      error: 'Header 缺少 alg 字段',
      warnings,
    };
  }
  if (!ALG_MAP[alg]) {
    return {
      ok: false,
      signatureValid: false,
      headerB64,
      payloadB64,
      signatureB64,
      header,
      payload,
      headerJson: JSON.stringify(header, null, 2),
      payloadJson: JSON.stringify(payload, null, 2),
      alg,
      error: `不支持的算法：${alg}（支持 HS/RS/ES 系列 + none）`,
      warnings,
    };
  }

  // 4. 算法白名单校验（防 alg=none 攻击）
  if (expectedAlg && expectedAlg !== alg) {
    return {
      ok: false,
      signatureValid: false,
      headerB64,
      payloadB64,
      signatureB64,
      header,
      payload,
      headerJson: JSON.stringify(header, null, 2),
      payloadJson: JSON.stringify(payload, null, 2),
      alg,
      category: ALG_MAP[alg].category,
      error: `算法不匹配：期望 ${expectedAlg}，实际 ${alg}（可能遭遇 alg=none 攻击或密钥配置错误）`,
      warnings,
    };
  }

  const category = ALG_MAP[alg].category;

  // 5. none 算法：无签名，直接警告，不进行验签
  if (alg === 'none') {
    warnings.push('alg=none 算法无签名，任何人可伪造令牌，严禁生产使用');
    if (signatureB64 !== '') {
      warnings.push('alg=none 但 Signature 段非空，可能令牌被篡改或非标准实现');
    }
    const claimChecks = checkTimeClaims(payload);
    return {
      ok: false, // none 算法视为「未通过」（不安全）
      signatureValid: false,
      headerB64,
      payloadB64,
      signatureB64,
      header,
      payload,
      headerJson: JSON.stringify(header, null, 2),
      payloadJson: JSON.stringify(payload, null, 2),
      alg,
      category,
      claimChecks,
      error: 'alg=none 算法无签名，令牌不可信',
      warnings,
    };
  }

  // 6. 检查 Web Crypto API 可用性
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return {
      ok: false,
      signatureValid: false,
      headerB64,
      payloadB64,
      signatureB64,
      header,
      payload,
      headerJson: JSON.stringify(header, null, 2),
      payloadJson: JSON.stringify(payload, null, 2),
      alg,
      category,
      error: '当前环境不支持 Web Crypto API（需 HTTPS 或 localhost）',
      warnings,
    };
  }

  // 7. 检查 Signature 段非空
  if (!signatureB64) {
    return {
      ok: false,
      signatureValid: false,
      headerB64,
      payloadB64,
      signatureB64,
      header,
      payload,
      headerJson: JSON.stringify(header, null, 2),
      payloadJson: JSON.stringify(payload, null, 2),
      alg,
      category,
      error: `算法 ${alg} 要求 Signature 段非空，但实际为空`,
      warnings,
    };
  }

  // 8. 解码 Signature 为字节
  let signatureBytes: Uint8Array<ArrayBuffer>;
  try {
    signatureBytes = base64urlDecode(signatureB64);
  } catch (e) {
    return {
      ok: false,
      signatureValid: false,
      headerB64,
      payloadB64,
      signatureB64,
      header,
      payload,
      headerJson: JSON.stringify(header, null, 2),
      payloadJson: JSON.stringify(payload, null, 2),
      alg,
      category,
      error: `Signature 段 base64url 解码失败：${e instanceof Error ? e.message : ''}`,
      warnings,
    };
  }

  // 9. 构造签名输入数据：header_b64.payload_b64
  const signingInput = `${headerB64}.${payloadB64}`;
  const dataBytes = encodeUtf8(signingInput);

  // 10. 根据算法类别导入密钥并验签
  let signatureValid = false;
  try {
    if (category === 'hmac') {
      if (!keyInput) {
        return {
          ok: false,
          signatureValid: false,
          headerB64,
          payloadB64,
          signatureB64,
          header,
          payload,
          headerJson: JSON.stringify(header, null, 2),
          payloadJson: JSON.stringify(payload, null, 2),
          alg,
          category,
          error: `${alg} 算法需要提供 HMAC 密钥`,
          warnings,
        };
      }
      const hashName = ALG_TO_HASH[alg];
      const hmacKey = await importHmacVerifyKey(keyInput, keyFormat, hashName);
      signatureValid = await crypto.subtle.verify('HMAC', hmacKey, signatureBytes, dataBytes);
    } else if (category === 'rsa') {
      if (!keyInput) {
        return {
          ok: false,
          signatureValid: false,
          headerB64,
          payloadB64,
          signatureB64,
          header,
          payload,
          headerJson: JSON.stringify(header, null, 2),
          payloadJson: JSON.stringify(payload, null, 2),
          alg,
          category,
          error: `${alg} 算法需要提供 RSA 公钥（PEM 或 JWK）`,
          warnings,
        };
      }
      const hashName = ALG_TO_HASH[alg];
      const rsaKey = await importRsaPublicKey(keyInput, hashName);
      signatureValid = await crypto.subtle.verify(
        { name: 'RSASSA-PKCS1-v1_5' },
        rsaKey,
        signatureBytes,
        dataBytes,
      );
    } else if (category === 'ec') {
      if (!keyInput) {
        return {
          ok: false,
          signatureValid: false,
          headerB64,
          payloadB64,
          signatureB64,
          header,
          payload,
          headerJson: JSON.stringify(header, null, 2),
          payloadJson: JSON.stringify(payload, null, 2),
          alg,
          category,
          error: `${alg} 算法需要提供 EC 公钥（PEM 或 JWK）`,
          warnings,
        };
      }
      const hashName = ALG_TO_HASH[alg];
      const curve = ALG_TO_CURVE[alg];
      const ecKey = await importEcPublicKey(keyInput, hashName, curve);
      // Web Crypto 的 ECDSA verify 接受 raw 格式签名（r || s 拼接），与 JWT ES 系列一致
      signatureValid = await crypto.subtle.verify(
        { name: 'ECDSA', hash: hashName },
        ecKey,
        signatureBytes,
        dataBytes,
      );
    }
  } catch (e) {
    return {
      ok: false,
      signatureValid: false,
      headerB64,
      payloadB64,
      signatureB64,
      header,
      payload,
      headerJson: JSON.stringify(header, null, 2),
      payloadJson: JSON.stringify(payload, null, 2),
      alg,
      category,
      error: `验签异常：${e instanceof Error ? e.message : String(e)}`,
      warnings,
    };
  }

  // 11. 校验时间声明
  const claimChecks = checkTimeClaims(payload);

  // 12. 综合判定：签名有效 + exp 未过期 + nbf 已生效 + iat 合理
  const expCheck = claimChecks.find((c) => c.field === 'exp');
  const nbfCheck = claimChecks.find((c) => c.field === 'nbf');
  const iatCheck = claimChecks.find((c) => c.field === 'iat');

  let ok = signatureValid;
  if (expCheck && expCheck.status === 'expired') ok = false;
  if (nbfCheck && nbfCheck.status === 'not_yet_valid') ok = false;
  if (iatCheck && iatCheck.status === 'invalid') ok = false;

  // 13. 收集警告
  if (!signatureValid) {
    warnings.push('签名验证失败：密钥不匹配或签名被篡改');
  }
  if (expCheck?.status === 'missing') {
    warnings.push('缺少 exp 字段，令牌永不过期，存在长期有效风险');
  }

  return {
    ok,
    signatureValid,
    headerB64,
    payloadB64,
    signatureB64,
    header,
    payload,
    headerJson: JSON.stringify(header, null, 2),
    payloadJson: JSON.stringify(payload, null, 2),
    alg,
    category,
    claimChecks,
    warnings,
  };
}

/** 标准声明字段中文说明（与 jwtSign.ts 同步） */
export const CLAIM_DESC: Record<string, string> = {
  iss: '签发者（Issuer）',
  sub: '主题（Subject，通常为用户 ID）',
  aud: '受众（Audience，目标服务）',
  exp: '过期时间（Expiration，Unix 秒级时间戳）',
  nbf: '生效时间（Not Before）',
  iat: '签发时间（Issued At）',
  jti: 'JWT 唯一标识（JWT ID，用于防重放）',
};

/** 示例 HS256 JWT（用于演示，密钥为 'your-256-bit-secret-key-for-demo-only'） */
export const SAMPLE_HS256_TOKEN =
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJ0b29sYm94LmV4YW1wbGUuY29tIiwic3ViIjoiMTAwMDEiLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MTkwMDAwMDAwMCwibmFtZSI6IuW8oOS4iSIsInJvbGUiOiJhZG1pbiJ9.abcdemo_signature_placeholder';

/** 示例 HMAC 密钥（与 JwtSignTool 默认密钥一致，便于联动测试） */
export const SAMPLE_HMAC_KEY = 'your-256-bit-secret-key-for-demo-only';
