import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';
import {
  parseJwe,
  decryptJwe,
  base64urlDecode,
  base64urlEncode,
  decodeUtf8,
  formatBytes,
  concatKdf,
  ALG_DESC,
  ENC_DESC,
  getAlgCategory,
  isAlgSupported,
  isEncSupported,
  SAMPLE_JWE_DIR,
  SAMPLE_JWE_RSA,
  SAMPLE_PLAINTEXT,
  MAX_INPUT_LENGTH,
  type ParsedJwe,
  type DecryptResult,
} from '../utils/jwe';

/**
 * JWE 解码工具
 *
 * 功能：
 *  - 解析 JWE Compact（五段式）与 Flattened JSON 序列化
 *  - 自动 base64url 解码 Protected Header 并 JSON 美化
 *  - 五段拆分视图：每段名称、长度、字节数、预览
 *  - 算法说明：alg/enc 中文描述、是否支持解密
 *  - 解密：支持 dir / A128KW/A192KW/A256KW / RSA-OAEP-* / RSA1_5 / PBES2-* / ECDH-ES* 等
 *  - 解密后明文若为 JSON 自动美化；若为 JWT 提示用 JWT 工具继续解码
 *  - 「生成测试 JWE」按钮：用 Web Crypto 现场加密生成可解密的 dir+A128GCM JWE
 *  - 「载入 PBES2 示例」按钮：现场生成可解密的 PBES2-HS256+A128KW JWE
 *  - 「载入 ECDH-ES 示例」按钮：现场生成可解密的 ECDH-ES+A128GCM JWE（含 epk 与接收方私钥 JWK）
 *
 * 安全策略：
 *  - 全程本地处理，密钥不离开浏览器，不上传、不存储
 *  - Web Crypto API 仅在客户端可用，SSR 阶段不解密
 *  - 输入长度上限 50000 字符
 */

/** 五段元数据配置 */
const PART_LABELS: Array<{ key: keyof ParsedJwe['parts']; name: string; desc: string }> = [
  { key: 'protectedHeader', name: 'Protected Header', desc: 'base64url 编码的 JOSE 头部' },
  { key: 'encryptedKey', name: 'Encrypted Key', desc: '加密的 CEK（dir 算法时为空）' },
  { key: 'iv', name: 'IV', desc: '初始化向量（96 位）' },
  { key: 'ciphertext', name: 'Ciphertext', desc: '密文' },
  { key: 'tag', name: 'Authentication Tag', desc: '认证标签（128 位）' },
];

/** 生成测试 JWE：用 Web Crypto 现场加密，保证示例可解密 */
async function generateTestJwe(): Promise<{ jwe: string; key: string }> {
  // 生成 128 位 AES-GCM 密钥
  const cek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, true, [
    'encrypt',
    'decrypt',
  ]);
  // 导出密钥为 raw bytes，再 base64url 编码
  const rawKey = await crypto.subtle.exportKey('raw', cek);
  const keyBytes = new Uint8Array(rawKey);
  let keyB64 = '';
  for (let i = 0; i < keyBytes.length; i++) {
    keyB64 += String.fromCharCode(keyBytes[i]);
  }
  const key = btoa(keyB64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  // 构造 protected header: {"alg":"dir","enc":"A128GCM"}
  const header = btoa(JSON.stringify({ alg: 'dir', enc: 'A128GCM' }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  // 生成 96 位 IV
  const iv = crypto.getRandomValues(new Uint8Array(12));
  let ivB64 = '';
  for (let i = 0; i < iv.length; i++) {
    ivB64 += String.fromCharCode(iv[i]);
  }
  const ivB64Url = btoa(ivB64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  // 加密明文
  const plaintextBytes = new TextEncoder().encode(SAMPLE_PLAINTEXT);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(header), tagLength: 128 },
    cek,
    plaintextBytes,
  );
  const cipherBytes = new Uint8Array(cipherBuffer);
  // ciphertext 与 tag 拼接，需拆分（tag 是最后 16 字节）
  const ciphertextBytes = cipherBytes.slice(0, cipherBytes.length - 16);
  const tagBytes = cipherBytes.slice(cipherBytes.length - 16);
  const encodeB64url = (bytes: Uint8Array) => {
    let s = '';
    for (let i = 0; i < bytes.length; i++) {
      s += String.fromCharCode(bytes[i]);
    }
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const ciphertext = encodeB64url(ciphertextBytes);
  const tag = encodeB64url(tagBytes);

  // 拼接 JWE Compact: protected..iv.ciphertext.tag（dir 算法 encrypted_key 为空）
  const jwe = `${header}..${ivB64Url}.${ciphertext}.${tag}`;
  return { jwe, key };
}

/**
 * 生成测试 PBES2 JWE：用密码 + PBKDF2 + AES-KW 现场加密，保证示例可解密
 *
 * 流程：生成 CEK → 生成 salt → PBKDF2 派生 KW 密钥 → AES-KW 包装 CEK
 *      → 构造含 p2s/p2c 的 Protected Header → AES-GCM 加密明文 → 拼接 Compact
 *
 * 密码固定为 "toolbox-pbes2-demo"，迭代次数 1000（演示用，生产应 ≥ 10000）
 */
async function generateTestPbes2Jwe(): Promise<{ jwe: string; password: string }> {
  const password = 'toolbox-pbes2-demo';
  const iterations = 1000;

  // base64url 编码辅助
  const encodeB64url = (bytes: Uint8Array): string => {
    let s = '';
    for (let i = 0; i < bytes.length; i++) {
      s += String.fromCharCode(bytes[i]);
    }
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  // 生成 128 位 AES-GCM CEK（extractable=true 以便 wrapKey）
  const cek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, true, [
    'encrypt',
    'decrypt',
  ]);

  // 生成 16 字节 salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // PBKDF2 派生 128 位 KW 密钥（HS256 → SHA-256，A128KW → 128 位）
  const passwordBytes = new TextEncoder().encode(password);
  const baseKey = await crypto.subtle.importKey(
    'raw',
    passwordBytes,
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  const kwKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: { name: 'SHA-256' } },
    baseKey,
    { name: 'AES-KW', length: 128 },
    false,
    ['wrapKey'],
  );

  // AES-KW 包装 CEK → encrypted_key
  const wrappedKeyBuffer = await crypto.subtle.wrapKey('raw', cek, kwKey, { name: 'AES-KW' });
  const encryptedKey = encodeB64url(new Uint8Array(wrappedKeyBuffer));
  const saltB64 = encodeB64url(salt);

  // 构造 Protected Header: {"alg":"PBES2-HS256+A128KW","enc":"A128GCM","p2s":"...","p2c":1000}
  const headerObj = {
    alg: 'PBES2-HS256+A128KW',
    enc: 'A128GCM',
    p2s: saltB64,
    p2c: iterations,
  };
  const header = btoa(JSON.stringify(headerObj))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  // 生成 96 位 IV
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ivB64Url = encodeB64url(iv);

  // AES-GCM 加密明文（AAD = ASCII(Protected Header)）
  const plaintextBytes = new TextEncoder().encode(SAMPLE_PLAINTEXT);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(header), tagLength: 128 },
    cek,
    plaintextBytes,
  );
  const cipherBytes = new Uint8Array(cipherBuffer);
  // ciphertext 与 tag 拼接，tag 是最后 16 字节
  const ciphertextBytes = cipherBytes.slice(0, cipherBytes.length - 16);
  const tagBytes = cipherBytes.slice(cipherBytes.length - 16);
  const ciphertext = encodeB64url(ciphertextBytes);
  const tag = encodeB64url(tagBytes);

  // 拼接 JWE Compact: protected.encrypted_key.iv.ciphertext.tag
  const jwe = `${header}.${encryptedKey}.${ivB64Url}.${ciphertext}.${tag}`;
  return { jwe, password };
}

/**
 * 生成测试 ECDH-ES JWE：用椭圆曲线 DH + Concat KDF 现场加密，保证示例可解密
 *
 * 流程：生成接收方密钥对 → 生成临时密钥对 → ECDH 派生 Z → Concat KDF 派生 CEK
 *      → 构造含 epk 的 Protected Header → AES-GCM 加密明文 → 拼接 Compact
 *
 * 使用 P-256 曲线 + A128GCM 内容加密（直接模式，encrypted_key 为空）
 * 返回 JWE 与接收方私钥 JWK（JSON 字符串，用于解密）
 */
async function generateTestEcdhEsJwe(): Promise<{ jwe: string; receiverPrivJwk: string }> {
  const crv = 'P-256';

  // 生成接收方 EC 密钥对（P-256）
  const receiverKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: crv },
    true,
    ['deriveBits'],
  );
  // 生成临时 EC 密钥对（P-256）
  const ephemeralKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: crv },
    true,
    ['deriveBits'],
  );

  // 导出接收方私钥 JWK（用于返回给用户解密）
  const receiverPrivJwkObj = await crypto.subtle.exportKey('jwk', receiverKeyPair.privateKey);
  const receiverPrivJwk = JSON.stringify(receiverPrivJwkObj);

  // 导出临时公钥 JWK（作为 epk 放入 Protected Header）
  const epkJwk = await crypto.subtle.exportKey('jwk', ephemeralKeyPair.publicKey);
  // epk 仅需 kty/crv/x/y，移除可能的 key_ops 等字段
  const epk = { kty: epkJwk.kty, crv: epkJwk.crv, x: epkJwk.x, y: epkJwk.y };

  // ECDH 派生共享秘密 Z（临时私钥 + 接收方公钥）
  const zBuffer = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: receiverKeyPair.publicKey },
    ephemeralKeyPair.privateKey,
    256, // P-256 → 256 位
  );
  const zBytes = new Uint8Array(zBuffer);

  // Concat KDF 派生 CEK（直接模式：AlgorithmID = enc 名 = A128GCM，keyDataLen = 128）
  const cekBytes = await concatKdf(zBytes, 'A128GCM', 128);
  const cek = await crypto.subtle.importKey('raw', cekBytes, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);

  // 构造 Protected Header: {"alg":"ECDH-ES","enc":"A128GCM","epk":{...}}
  const headerObj = { alg: 'ECDH-ES', enc: 'A128GCM', epk };
  const header = btoa(JSON.stringify(headerObj))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  // 生成 96 位 IV
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ivB64Url = base64urlEncode(iv);

  // AES-GCM 加密明文（AAD = ASCII(Protected Header)）
  const plaintextBytes = new TextEncoder().encode(SAMPLE_PLAINTEXT);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(header), tagLength: 128 },
    cek,
    plaintextBytes,
  );
  const cipherBytes = new Uint8Array(cipherBuffer);
  // ciphertext 与 tag 拼接，tag 是最后 16 字节
  const ciphertextBytes = cipherBytes.slice(0, cipherBytes.length - 16);
  const tagBytes = cipherBytes.slice(cipherBytes.length - 16);
  const ciphertext = base64urlEncode(ciphertextBytes);
  const tag = base64urlEncode(tagBytes);

  // 拼接 JWE Compact: protected..iv.ciphertext.tag（ECDH-ES 直接模式 encrypted_key 为空）
  const jwe = `${header}..${ivB64Url}.${ciphertext}.${tag}`;
  return { jwe, receiverPrivJwk };
}

export default function JweTool() {
  // 输入：JWE 字符串（初始用固定示例避免 SSR 水合不一致）
  const [input, setInput] = useState(SAMPLE_JWE_DIR);
  // 密钥输入
  const [keyInput, setKeyInput] = useState('');
  // 解密结果
  const [decryptResult, setDecryptResult] = useState<DecryptResult | null>(null);
  // 是否正在解密
  const [decrypting, setDecrypting] = useState(false);
  // 是否正在生成测试 JWE
  const [generating, setGenerating] = useState(false);
  // 复制反馈
  const [copied, setCopied] = useState<string>('');

  // 解析 JWE（输入即解析）
  const parsed: ParsedJwe = useMemo(() => parseJwe(input), [input]);

  // alg 分类（用于动态提示密钥格式）
  const algCategory = parsed.ok && parsed.header?.alg ? getAlgCategory(parsed.header.alg) : 'unsupported';

  // 密钥格式提示
  const keyHint = useMemo(() => {
    switch (algCategory) {
      case 'direct':
        return '请输入 base64url 编码的对应对称密钥（长度需匹配 enc 算法，如 A128GCM 为 16 字节）';
      case 'symmetric':
        return '请输入 base64url 编码的 KW 密钥（长度需匹配 alg，如 A128KW 为 16 字节）';
      case 'asymmetric':
        return '请输入 PEM 格式的 RSA 私钥（PKCS#1 或 PKCS#8）';
      case 'pbes2':
        return '请输入 PBES2 密码（UTF-8 字符串）';
      case 'ecdh-es':
        return '请输入接收方 EC 私钥的 JWK（JSON 字符串，需含 kty=EC、crv、d 字段，曲线需与 epk.crv 一致）';
      default:
        return '当前算法暂不支持解密';
    }
  }, [algCategory]);

  // 密钥格式：ecdh-es 用 utf8（JWK JSON 字符串，decryptJwe 内部 JSON.parse 解析）
  const keyFormat: 'base64url' | 'pem' | 'utf8' =
    algCategory === 'asymmetric' ? 'pem' : algCategory === 'pbes2' || algCategory === 'ecdh-es' ? 'utf8' : 'base64url';

  /** 复制文本并显示反馈 */
  const handleCopy = useCallback(async (text: string, label: string) => {
    if (!text) return;
    const ok = await copyText(text);
    if (ok) {
      setCopied(label);
      setTimeout(() => setCopied(''), 1500);
    }
  }, []);

  /** 解密 */
  const handleDecrypt = useCallback(async () => {
    if (!parsed.ok) return;
    setDecrypting(true);
    setDecryptResult(null);
    try {
      const result = await decryptJwe(parsed, keyInput, keyFormat);
      setDecryptResult(result);
    } catch (e) {
      setDecryptResult({
        ok: false,
        error: `解密异常：${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setDecrypting(false);
    }
  }, [parsed, keyInput, keyFormat]);

  /** 生成测试 JWE */
  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const { jwe, key } = await generateTestJwe();
      setInput(jwe);
      setKeyInput(key);
      setDecryptResult(null);
    } catch (e) {
      // 生成失败时静默处理（不阻塞 UI）
      console.error('生成测试 JWE 失败：', e);
    } finally {
      setGenerating(false);
    }
  }, []);

  /** 载入 PBES2 示例（现场生成可解密的 PBES2 JWE，密码自动填入） */
  const handleLoadPbes2 = useCallback(async () => {
    setGenerating(true);
    try {
      const { jwe, password } = await generateTestPbes2Jwe();
      setInput(jwe);
      setKeyInput(password);
      setDecryptResult(null);
    } catch (e) {
      console.error('生成 PBES2 测试 JWE 失败：', e);
    } finally {
      setGenerating(false);
    }
  }, []);

  /** 载入 ECDH-ES 示例（现场生成可解密的 ECDH-ES JWE，接收方私钥 JWK 自动填入） */
  const handleLoadEcdhEs = useCallback(async () => {
    setGenerating(true);
    try {
      const { jwe, receiverPrivJwk } = await generateTestEcdhEsJwe();
      setInput(jwe);
      setKeyInput(receiverPrivJwk);
      setDecryptResult(null);
    } catch (e) {
      console.error('生成 ECDH-ES 测试 JWE 失败：', e);
    } finally {
      setGenerating(false);
    }
  }, []);

  /** 清空 */
  const handleClear = useCallback(() => {
    setInput('');
    setKeyInput('');
    setDecryptResult(null);
  }, []);

  // 输入超长截断
  const inputTooLong = input.length > MAX_INPUT_LENGTH;

  return (
    <div className="jwetool">
      {/* 输入区 */}
      <section className="jwetool__section" aria-labelledby="input-title">
        <h2 id="input-title" className="jwetool__section-title">JWE 输入</h2>
        <textarea
          className="jwetool__textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="粘贴 JWE Compact 字符串（protected.encrypted_key.iv.ciphertext.tag）或 Flattened JSON..."
          aria-label="JWE 输入框"
          rows={4}
          spellCheck={false}
        />
        <div className="jwetool__btn-row">
          <button
            type="button"
            className="jwetool__btn jwetool__btn--primary"
            onClick={handleGenerate}
            disabled={generating}
            aria-label="生成测试 JWE"
          >
            {generating ? '生成中...' : '生成测试 JWE'}
          </button>
          <button
            type="button"
            className="jwetool__btn"
            onClick={() => {
              setInput(SAMPLE_JWE_DIR);
              setKeyInput('');
              setDecryptResult(null);
            }}
            aria-label="载入 dir 示例"
          >
            载入 dir 示例
          </button>
          <button
            type="button"
            className="jwetool__btn"
            onClick={() => {
              setInput(SAMPLE_JWE_RSA);
              setKeyInput('');
              setDecryptResult(null);
            }}
            aria-label="载入 RSA 示例"
          >
            载入 RSA 示例
          </button>
          <button
            type="button"
            className="jwetool__btn"
            onClick={handleLoadPbes2}
            disabled={generating}
            aria-label="载入 PBES2 示例"
          >
            {generating ? '生成中...' : '载入 PBES2 示例'}
          </button>
          <button
            type="button"
            className="jwetool__btn"
            onClick={handleLoadEcdhEs}
            disabled={generating}
            aria-label="载入 ECDH-ES 示例"
          >
            {generating ? '生成中...' : '载入 ECDH-ES 示例'}
          </button>
          <button
            type="button"
            className="jwetool__btn jwetool__btn--ghost"
            onClick={handleClear}
            aria-label="清空"
          >
            清空
          </button>
        </div>
        {inputTooLong && (
          <p className="jwetool__error" role="alert">
            输入长度超过 {MAX_INPUT_LENGTH} 字符上限，请缩短输入
          </p>
        )}
      </section>

      {/* 解析结果 */}
      {input.trim() && (
        <section className="jwetool__section" aria-labelledby="parsed-title">
          <h2 id="parsed-title" className="jwetool__section-title">解析结果</h2>
          {!parsed.ok ? (
            <p className="jwetool__error" role="alert">
              {parsed.error || '解析失败'}
            </p>
          ) : (
            <>
              {/* 格式与算法概览 */}
              <div className="jwetool__overview">
                <span className="jwetool__format-badge">
                  格式：{parsed.format === 'compact' ? 'Compact' : 'Flattened JSON'}
                </span>
                <span className="jwetool__alg-badge">
                  alg: <code>{parsed.header?.alg}</code>
                </span>
                <span className="jwetool__alg-badge">
                  enc: <code>{parsed.header?.enc}</code>
                </span>
                {parsed.header?.kid && (
                  <span className="jwetool__alg-badge">
                    kid: <code>{String(parsed.header.kid)}</code>
                  </span>
                )}
                {parsed.header?.typ && (
                  <span className="jwetool__alg-badge">
                    typ: <code>{String(parsed.header.typ)}</code>
                  </span>
                )}
                {parsed.header?.zip && (
                  <span className="jwetool__alg-badge jwetool__alg-badge--warn">
                    zip: <code>{String(parsed.header.zip)}</code>（压缩，本工具暂不支持解压）
                  </span>
                )}
              </div>

              {/* 算法说明 */}
              <div className="jwetool__alg-info">
                <p>
                  <strong>密钥管理算法（alg）：</strong>
                  {ALG_DESC[parsed.header?.alg || ''] || '未知算法'}
                </p>
                <p>
                  <strong>内容加密算法（enc）：</strong>
                  {ENC_DESC[parsed.header?.enc || ''] || '未知算法'}
                </p>
                <p>
                  <strong>解密支持：</strong>
                  {isAlgSupported(parsed.header?.alg) && isEncSupported(parsed.header?.enc) ? (
                    <span className="jwetool__alg-badge jwetool__alg-badge--ok">可解密</span>
                  ) : (
                    <span className="jwetool__alg-badge jwetool__alg-badge--warn">
                      暂不支持解密（仅解析展示）
                    </span>
                  )}
                </p>
              </div>

              {/* JOSE Header 美化展示 */}
              <div className="jwetool__header-block">
                <div className="jwetool__block-header">
                  <h3 className="jwetool__block-title">Protected Header（解码后）</h3>
                  <button
                    type="button"
                    className="jwetool__copy-btn"
                    onClick={() => handleCopy(parsed.headerJson || '', 'header')}
                    aria-label="复制 Protected Header"
                  >
                    {copied === 'header' ? '已复制' : '复制'}
                  </button>
                </div>
                <pre className="jwetool__pre">{parsed.headerJson}</pre>
              </div>

              {/* 五段拆分表格 */}
              <div className="jwetool__parts">
                <h3 className="jwetool__block-title">五段拆分</h3>
                <table className="jwetool__table">
                  <thead>
                    <tr>
                      <th scope="col">段名</th>
                      <th scope="col">说明</th>
                      <th scope="col">长度</th>
                      <th scope="col">字节数</th>
                      <th scope="col">值（前 40 字符）</th>
                      <th scope="col">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PART_LABELS.map((label) => {
                      const value = parsed.parts?.[label.key] || '';
                      const bytes = value ? base64urlDecode(value) : new Uint8Array(0);
                      // protected header 解码后预览
                      let preview = value.slice(0, 40);
                      if (label.key === 'protectedHeader' && value) {
                        try {
                          const decoded = decodeUtf8(base64urlDecode(value));
                          preview = decoded.slice(0, 40);
                        } catch {
                          // 保留原值
                        }
                      }
                      return (
                        <tr key={label.key}>
                          <td><strong>{label.name}</strong></td>
                          <td>{label.desc}</td>
                          <td>{value.length} 字符</td>
                          <td>{formatBytes(bytes.length)}</td>
                          <td>
                            <code className="jwetool__part-value">{preview}{value.length > 40 ? '...' : ''}</code>
                          </td>
                          <td>
                            {value && (
                              <button
                                type="button"
                                className="jwetool__copy-btn"
                                onClick={() => handleCopy(value, `part-${label.key}`)}
                                aria-label={`复制 ${label.name}`}
                              >
                                {copied === `part-${label.key}` ? '已复制' : '复制'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {/* 解密区 */}
      {parsed.ok && isAlgSupported(parsed.header?.alg) && isEncSupported(parsed.header?.enc) && (
        <section className="jwetool__section" aria-labelledby="decrypt-title">
          <h2 id="decrypt-title" className="jwetool__section-title">解密</h2>
          <p className="jwetool__key-hint">{keyHint}</p>
          {algCategory === 'asymmetric' ? (
            <textarea
              className="jwetool__textarea jwetool__textarea--key"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder={'-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----'}
              aria-label="RSA 私钥输入框"
              rows={5}
              spellCheck={false}
            />
          ) : algCategory === 'ecdh-es' ? (
            <textarea
              className="jwetool__textarea jwetool__textarea--key"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder={'{"kty":"EC","crv":"P-256","x":"...","y":"...","d":"..."}'}
              aria-label="EC 私钥 JWK 输入框"
              rows={5}
              spellCheck={false}
            />
          ) : (
            <input
              type="text"
              className="jwetool__input"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder={algCategory === 'pbes2' ? '请输入 PBES2 密码' : '请输入 base64url 编码的密钥'}
              aria-label="密钥输入框"
              spellCheck={false}
            />
          )}
          <div className="jwetool__btn-row">
            <button
              type="button"
              className="jwetool__btn jwetool__btn--primary"
              onClick={handleDecrypt}
              disabled={decrypting || !keyInput}
              aria-label="解密 JWE"
            >
              {decrypting ? '解密中...' : '解密'}
            </button>
          </div>

          {/* 解密结果 */}
          {decryptResult && (
            <div className="jwetool__result">
              {decryptResult.ok ? (
                <>
                  <div className="jwetool__block-header">
                    <h3 className="jwetool__block-title">
                      明文（{formatBytes(decryptResult.plaintextBytes || 0)}）
                    </h3>
                    <button
                      type="button"
                      className="jwetool__copy-btn"
                      onClick={() => handleCopy(decryptResult.plaintext || '', 'plaintext')}
                      aria-label="复制明文"
                    >
                      {copied === 'plaintext' ? '已复制' : '复制明文'}
                    </button>
                  </div>
                  {decryptResult.isJson && decryptResult.json && (
                    <>
                      <p className="jwetool__hint">检测到 JSON，已自动美化：</p>
                      <div className="jwetool__block-header">
                        <h4 className="jwetool__block-subtitle">JSON 美化</h4>
                        <button
                          type="button"
                          className="jwetool__copy-btn"
                          onClick={() => handleCopy(decryptResult.json || '', 'json')}
                          aria-label="复制 JSON"
                        >
                          {copied === 'json' ? '已复制' : '复制 JSON'}
                        </button>
                      </div>
                      <pre className="jwetool__pre jwetool__pre--json">{decryptResult.json}</pre>
                    </>
                  )}
                  {decryptResult.isJwt && (
                    <p className="jwetool__hint">
                      明文是 JWT（三段式），可前往{' '}
                      <a href="/jwt" className="jwetool__link">JWT 解码工具</a>
                      {' '}继续解码
                    </p>
                  )}
                  <pre className="jwetool__pre">{decryptResult.plaintext}</pre>
                </>
              ) : (
                <p className="jwetool__error" role="alert">
                  {decryptResult.error}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {/* 不支持解密的提示 */}
      {parsed.ok && !(isAlgSupported(parsed.header?.alg) && isEncSupported(parsed.header?.enc)) && (
        <section className="jwetool__section" aria-labelledby="unsupported-title">
          <h2 id="unsupported-title" className="jwetool__section-title">解密提示</h2>
          <p className="jwetool__hint">
            当前 JWE 使用的 alg 或 enc 暂不支持解密，仅做格式解析展示。
            <br />
            支持解密的 alg：dir、A128KW、A192KW、A256KW、RSA-OAEP、RSA-OAEP-256/384/512、RSA1_5、PBES2-HS256+A128KW、PBES2-HS384+A192KW、PBES2-HS512+A256KW、ECDH-ES、ECDH-ES+A128KW、ECDH-ES+A192KW、ECDH-ES+A256KW
            <br />
            支持解密的 enc：A128GCM、A192GCM、A256GCM
          </p>
        </section>
      )}
    </div>
  );
}
