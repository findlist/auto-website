/**
 * AES 加解密引擎
 * 基于 Web Crypto API（crypto.subtle）纯原生实现，零依赖。
 *
 * 支持：
 *  - 三种模式：AES-GCM（推荐，认证加密）/ AES-CBC（传统，PKCS#7 填充）/ AES-CTR（流模式）
 *  - 三种密钥长度：AES-128 / AES-192 / AES-256（16/24/32 字节）
 *  - 四种密钥输入：Hex 字符串 / Base64 字符串 / UTF-8 口令 / PBKDF2 密码派生
 *  - IV/Nonce 随机生成（GCM 12 字节，CBC/CTR 16 字节）
 *  - 输出格式：Hex / Base64
 *  - GCM 认证标签自动附加（Web Crypto 原生处理，解密时自动校验）
 *
 * 安全说明：
 *  - GCM 模式自带认证标签，可检测密文篡改，是现代首选
 *  - CBC 模式无认证，存在 padding oracle 攻击风险，建议配合 HMAC 使用
 *  - CTR 模式无认证且 IV 不可重复使用，否则会泄露明文
 *  - 同一密钥下 IV/Nonce 绝不可重复使用，本工具每次加密随机生成
 */

/** AES 加密模式 */
export type AesMode = 'GCM' | 'CBC' | 'CTR';

/** AES 密钥长度（位） */
export type KeyLength = 128 | 192 | 256;

/** 输出编码格式 */
export type OutputFormat = 'hex' | 'base64';

/** 密钥输入来源 */
export type KeySource = 'hex' | 'base64' | 'utf8' | 'password';

/** 加密结果 */
export interface EncryptResult {
  ok: boolean;
  /** 密文（已按输出格式编码） */
  ciphertext: string;
  /** IV/Nonce（已按输出格式编码），解密时需原样提供 */
  iv: string;
  /** 派生密钥（仅 password 模式返回，Hex 编码；其他模式为空） */
  derivedKey: string;
  /** PBKDF2 盐（仅 password 模式返回，已按输出格式编码；解密时需原样提供） */
  salt: string;
  /** 密文字节数 */
  ciphertextBytes: number;
  error: string;
}

/** 解密结果 */
export interface DecryptResult {
  ok: boolean;
  /** 解密后的明文 */
  plaintext: string;
  error: string;
}

/** 加密选项 */
export interface EncryptOptions {
  mode: AesMode;
  keyLength: KeyLength;
  keySource: KeySource;
  /** 密钥输入值（Hex/Base64/UTF-8 字符串或密码） */
  keyInput: string;
  /** 输出编码格式 */
  outputFormat: OutputFormat;
  /** PBKDF2 迭代次数（仅 password 模式生效，默认 100000） */
  iterations: number;
  /** 自定义 IV（Hex，可选；不填则随机生成） */
  ivHex?: string;
}

/** 解密选项 */
export interface DecryptOptions {
  mode: AesMode;
  keyLength: KeyLength;
  keySource: KeySource;
  keyInput: string;
  /** 密文输入（与 outputFormat 一致的编码） */
  ciphertextInput: string;
  /** IV 输入（与 outputFormat 一致的编码） */
  ivInput: string;
  /** 输入编码格式 */
  outputFormat: OutputFormat;
  iterations: number;
  /** PBKDF2 盐输入（仅 password 模式，与 outputFormat 一致编码；来自加密输出） */
  saltInput?: string;
}

/** 各模式 IV 字节长度 */
const IV_LENGTH: Record<AesMode, number> = {
  GCM: 12, // GCM 推荐 12 字节（96 位），性能与安全性最佳
  CBC: 16, // CBC 必须 16 字节（等于块大小）
  CTR: 16, // CTR 通常 16 字节（前 12 字节 nonce + 后 4 字节计数器）
};

/** PBKDF2 默认迭代次数（OWASP 2023 建议 ≥ 600000 次 SHA-256，本工具默认 100000 兼顾安全与性能） */
export const DEFAULT_ITERATIONS = 100000;

/** PBKDF2 盐长度（字节） */
const SALT_LENGTH = 16;

/**
 * 字节数组转十六进制字符串（小写）
 */
export function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let hex = '';
  // 分块拼接避免大数组性能问题
  const chunkSize = 0x4000;
  for (let i = 0; i < arr.length; i += chunkSize) {
    hex += Array.from(arr.subarray(i, i + chunkSize), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return hex;
}

/**
 * 十六进制字符串转字节数组
 * 容忍空格、0x 前缀、冒号分隔（MAC 风格）
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleaned = hex.replace(/0x/gi, '').replace(/[\s:]/g, '');
  if (!/^[0-9a-fA-F]*$/.test(cleaned) || cleaned.length % 2 !== 0) {
    throw new Error('Hex 格式无效：仅允许 0-9/a-f/A-F，且长度为偶数');
  }
  const arr = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(cleaned.substr(i * 2, 2), 16);
  }
  return arr;
}

/**
 * 字节数组转 Base64 字符串
 */
export function bytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < arr.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(arr.subarray(i, i + chunkSize)) as number[],
    );
  }
  return btoa(binary);
}

/**
 * Base64 字符串转字节数组
 * 容忍换行、空格，自动补齐 padding
 */
export function base64ToBytes(b64: string): Uint8Array {
  const cleaned = b64.replace(/\s/g, '');
  // 自动补齐 padding
  const padded = cleaned + '='.repeat((4 - (cleaned.length % 4)) % 4);
  const binary = atob(padded);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    arr[i] = binary.charCodeAt(i);
  }
  return arr;
}

/** 按输出格式编码字节数组 */
export function encodeBytes(bytes: Uint8Array, format: OutputFormat): string {
  return format === 'hex' ? bytesToHex(bytes) : bytesToBase64(bytes);
}

/** 按输入格式解码字符串为字节数组 */
export function decodeInput(input: string, format: OutputFormat): Uint8Array {
  return format === 'hex' ? hexToBytes(input) : base64ToBytes(input);
}

/**
 * 生成密码学安全的随机字节
 */
function randomBytes(length: number): Uint8Array {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return arr;
}

/**
 * 生成随机 AES 密钥（返回 Hex 编码字符串）
 */
export function generateKeyHex(keyLength: KeyLength): string {
  const bytes = randomBytes(keyLength / 8);
  return bytesToHex(bytes);
}

/**
 * 生成随机 IV/Nonce（返回 Hex 编码字符串）
 */
export function generateIvHex(mode: AesMode): string {
  const bytes = randomBytes(IV_LENGTH[mode]);
  return bytesToHex(bytes);
}

/**
 * 将用户输入解析为 AES 密钥字节
 * - hex: 十六进制字符串（要求长度匹配密钥位数）
 * - base64: Base64 字符串（解码后长度匹配）
 * - utf8: UTF-8 字符串（编码后长度匹配，不推荐用于生产）
 */
function parseKeyBytes(keyInput: string, keySource: KeySource, keyLength: KeyLength): Uint8Array {
  const expectedLen = keyLength / 8;
  let bytes: Uint8Array;
  switch (keySource) {
    case 'hex':
      bytes = hexToBytes(keyInput);
      break;
    case 'base64':
      bytes = base64ToBytes(keyInput);
      break;
    case 'utf8':
      bytes = new TextEncoder().encode(keyInput);
      break;
    default:
      throw new Error(`密钥来源 ${keySource} 不支持直接解析，请使用派生模式`);
  }
  if (bytes.length !== expectedLen) {
    throw new Error(
      `密钥长度不匹配：AES-${keyLength} 需要 ${expectedLen} 字节（${expectedLen * 8} 位），实际 ${bytes.length} 字节`,
    );
  }
  return bytes;
}

/**
 * 导入 AES 密钥（CryptoKey）
 */
async function importAesKey(
  keyBytes: Uint8Array,
  mode: AesMode,
  extractable: boolean = false,
): Promise<CryptoKey> {
  const algo = { name: `AES-${mode}` } as Algorithm;
  return crypto.subtle.importKey('raw', keyBytes, algo, extractable, ['encrypt', 'decrypt']);
}

/**
 * 用 PBKDF2 从密码派生 AES 密钥
 * @param password 用户密码
 * @param saltHex 盐（Hex），为空则随机生成
 * @param iterations 迭代次数
 * @param keyLength 密钥位数
 * @param mode AES 模式
 * @returns 派生密钥 CryptoKey + 盐（Hex）+ 密钥字节（Hex，仅用于展示）
 */
export async function deriveKey(
  password: string,
  saltHex: string,
  iterations: number,
  keyLength: KeyLength,
  mode: AesMode,
): Promise<{ key: CryptoKey; saltHex: string; keyHex: string }> {
  if (!password) throw new Error('密码不能为空');
  if (iterations < 1000) throw new Error('迭代次数过低，建议至少 100000 次');

  const salt = saltHex ? hexToBytes(saltHex) : randomBytes(SALT_LENGTH);
  const passwordBytes = new TextEncoder().encode(password);

  // 先导入为 PBKDF2 密钥
  const baseKey = await crypto.subtle.importKey(
    'raw',
    passwordBytes,
    { name: 'PBKDF2' },
    false,
    ['deriveKey', 'deriveBits'],
  );

  // 派生 AES 密钥（derivedKeyAlgorithm 必须包含 length 属性）
  const derivedKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: `AES-${mode}`, length: keyLength } as Algorithm,
    true,
    ['encrypt', 'decrypt'],
  );

  // 导出密钥字节用于展示（仅派生场景）
  const keyBuf = await crypto.subtle.exportKey('raw', derivedKey);
  return {
    key: derivedKey,
    saltHex: bytesToHex(salt),
    keyHex: bytesToHex(keyBuf),
  };
}

/**
 * AES 加密
 */
export async function encrypt(plaintext: string, options: EncryptOptions): Promise<EncryptResult> {
  if (plaintext === '') {
    return { ok: false, ciphertext: '', iv: '', derivedKey: '', salt: '', ciphertextBytes: 0, error: '明文不能为空' };
  }
  try {
    const { mode, keyLength, keySource, keyInput, outputFormat, iterations, ivHex } = options;
    let cryptoKey: CryptoKey;
    let derivedKeyHex = '';
    let saltHex = '';

    // 准备密钥
    if (keySource === 'password') {
      // PBKDF2 模式：随机生成盐，派生密钥，盐需随密文一起返回供解密使用
      const derived = await deriveKey(keyInput, '', iterations, keyLength, mode);
      cryptoKey = derived.key;
      derivedKeyHex = derived.keyHex;
      saltHex = derived.saltHex;
    } else {
      const keyBytes = parseKeyBytes(keyInput, keySource, keyLength);
      cryptoKey = await importAesKey(keyBytes, mode);
    }

    // 准备 IV
    const iv = ivHex ? hexToBytes(ivHex) : randomBytes(IV_LENGTH[mode]);
    if (iv.length !== IV_LENGTH[mode]) {
      throw new Error(
        `IV 长度不匹配：${mode} 模式需要 ${IV_LENGTH[mode]} 字节，实际 ${iv.length} 字节`,
      );
    }

    // 加密
    const data = new TextEncoder().encode(plaintext);
    const algo = buildAlgo(mode, iv);
    const cipherBuf = await crypto.subtle.encrypt(algo, cryptoKey, data);
    const cipherBytes = new Uint8Array(cipherBuf);

    return {
      ok: true,
      ciphertext: encodeBytes(cipherBytes, outputFormat),
      iv: encodeBytes(iv, outputFormat),
      derivedKey: derivedKeyHex,
      salt: saltHex ? encodeBytes(hexToBytes(saltHex), outputFormat) : '',
      ciphertextBytes: cipherBytes.length,
      error: '',
    };
  } catch (e) {
    return {
      ok: false,
      ciphertext: '',
      iv: '',
      derivedKey: '',
      salt: '',
      ciphertextBytes: 0,
      error: `加密失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * AES 解密
 */
export async function decrypt(options: DecryptOptions): Promise<DecryptResult> {
  try {
    const { mode, keyLength, keySource, keyInput, ciphertextInput, ivInput, outputFormat, iterations, saltInput } = options;
    let cryptoKey: CryptoKey;

    // 准备密钥
    if (keySource === 'password') {
      // PBKDF2 模式：使用加密时返回的盐（用户需填入 saltInput），还原派生密钥
      if (!saltInput) {
        throw new Error('密码派生模式解密需要提供盐（来自加密输出）');
      }
      const saltBytes = decodeInput(saltInput, outputFormat);
      const saltHex = bytesToHex(saltBytes);
      const derived = await deriveKey(keyInput, saltHex, iterations, keyLength, mode);
      cryptoKey = derived.key;
    } else {
      const keyBytes = parseKeyBytes(keyInput, keySource, keyLength);
      cryptoKey = await importAesKey(keyBytes, mode);
    }

    // 解析密文与 IV
    const cipherBytes = decodeInput(ciphertextInput, outputFormat);
    const iv = decodeInput(ivInput, outputFormat);
    if (iv.length !== IV_LENGTH[mode]) {
      throw new Error(
        `IV 长度不匹配：${mode} 模式需要 ${IV_LENGTH[mode]} 字节，实际 ${iv.length} 字节`,
      );
    }

    // 解密
    const algo = buildAlgo(mode, iv);
    const plainBuf = await crypto.subtle.decrypt(algo, cryptoKey, cipherBytes);
    const plaintext = new TextDecoder().decode(plainBuf);

    return { ok: true, plaintext, error: '' };
  } catch (e) {
    return {
      ok: false,
      plaintext: '',
      error: `解密失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** AES 加密算法参数（联合类型，便于内部传递） */
type AesParams =
  | { name: 'AES-GCM'; iv: Uint8Array; additionalData?: Uint8Array; tagLength?: number }
  | { name: 'AES-CBC'; iv: Uint8Array }
  | { name: 'AES-CTR'; counter: Uint8Array; length: number };

/** CTR 模式计数器位长度（32 位为常见默认值，表示后 4 字节作计数器） */
const CTR_COUNTER_BITS = 32;

/**
 * 构造 AES 加密算法参数
 * CTR 模式需用 counter + length，GCM/CBC 用 iv
 */
function buildAlgo(mode: AesMode, iv: Uint8Array): AesParams {
  if (mode === 'CTR') {
    return { name: 'AES-CTR', counter: iv, length: CTR_COUNTER_BITS };
  }
  return { name: `AES-${mode}`, iv } as AesParams;
}

/** 各模式说明元数据（供 UI 展示） */
export const MODE_META: Record<AesMode, { label: string; desc: string; ivLen: number; auth: boolean; recommend: boolean }> = {
  GCM: {
    label: 'AES-GCM',
    desc: '认证加密模式（推荐）：自带认证标签，可检测密文篡改，无需填充，性能优秀，是现代首选。',
    ivLen: 12,
    auth: true,
    recommend: true,
  },
  CBC: {
    label: 'AES-CBC',
    desc: '传统分组模式：需 PKCS#7 填充，无认证，存在 padding oracle 风险，建议配合 HMAC 使用。',
    ivLen: 16,
    auth: false,
    recommend: false,
  },
  CTR: {
    label: 'AES-CTR',
    desc: '流模式：无需填充，IV 不可重复使用否则泄露明文，无认证，适合流式加密。',
    ivLen: 16,
    auth: false,
    recommend: false,
  },
};
