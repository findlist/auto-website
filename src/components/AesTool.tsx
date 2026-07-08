import { useState, useCallback } from 'react';
import { copyText } from '../utils/clipboard';
import {
  encrypt,
  decrypt,
  generateKeyHex,
  MODE_META,
  DEFAULT_ITERATIONS,
  type AesMode,
  type KeyLength,
  type KeySource,
  type OutputFormat,
  type EncryptResult,
  type DecryptResult,
} from '../utils/aes';

/**
 * AES 加解密工具
 * 全部在浏览器本地处理，基于 Web Crypto API，零依赖、零上传。
 *
 * 功能：
 *  - 三种模式：AES-GCM（推荐，认证加密）/ AES-CBC（传统）/ AES-CTR（流模式）
 *  - 三种密钥长度：AES-128 / AES-192 / AES-256
 *  - 四种密钥来源：Hex / Base64 / UTF-8 口令 / PBKDF2 密码派生
 *  - 加密：明文 → 密文 + IV + 盐（派生模式）+ 派生密钥（派生模式）
 *  - 解密：密文 + IV + 盐（派生模式）→ 明文
 *  - 一键生成随机密钥、载入示例、加密结果填入解密（闭环验证）
 *  - 模式安全提示、复制、清空
 */
type Direction = 'encrypt' | 'decrypt';

/** 复制反馈状态 */
type CopyState = Record<string, boolean>;

/** AES-256 示例密钥（32 字节 Hex），用于"载入示例" */
const SAMPLE_KEY_256 = 'a3f5b8c9d1e2f4a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0';
/** 示例明文 */
const SAMPLE_PLAINTEXT = 'Hello, AES-GCM! 这是一条加密测试消息，支持中文与 Emoji 🎉';

/** 模式选项配置 */
const MODE_OPTIONS: AesMode[] = ['GCM', 'CBC', 'CTR'];
/** 密钥长度选项配置 */
const KEY_LENGTH_OPTIONS: KeyLength[] = [128, 192, 256];
/** 密钥来源选项配置 */
const KEY_SOURCE_OPTIONS: { value: KeySource; label: string; hint: string }[] = [
  { value: 'hex', label: 'Hex 字符串', hint: '十六进制密钥（如 a3f5b8...），长度需匹配密钥位数' },
  { value: 'base64', label: 'Base64 字符串', hint: 'Base64 编码的密钥，解码后长度需匹配密钥位数' },
  { value: 'utf8', label: 'UTF-8 口令', hint: '直接输入文本，编码后长度需匹配（不推荐生产使用）' },
  { value: 'password', label: 'PBKDF2 密码派生', hint: '用密码 + 盐 + 迭代次数派生密钥，适合人类记忆口令' },
];
/** 输出格式选项配置 */
const OUTPUT_FORMAT_OPTIONS: { value: OutputFormat; label: string }[] = [
  { value: 'hex', label: 'Hex' },
  { value: 'base64', label: 'Base64' },
];

/**
 * AesTool 主组件
 */
export default function AesTool() {
  // 方向与参数
  const [direction, setDirection] = useState<Direction>('encrypt');
  const [mode, setMode] = useState<AesMode>('GCM');
  const [keyLength, setKeyLength] = useState<KeyLength>(256);
  const [keySource, setKeySource] = useState<KeySource>('hex');
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('hex');
  const [iterations, setIterations] = useState<number>(DEFAULT_ITERATIONS);

  // 输入
  const [plaintext, setPlaintext] = useState<string>('');
  const [keyInput, setKeyInput] = useState<string>('');
  const [ciphertextInput, setCiphertextInput] = useState<string>('');
  const [ivInput, setIvInput] = useState<string>('');
  const [saltInput, setSaltInput] = useState<string>('');

  // 结果与状态
  const [encResult, setEncResult] = useState<EncryptResult | null>(null);
  const [decResult, setDecResult] = useState<DecryptResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [copyState, setCopyState] = useState<CopyState>({});

  /** 复制文本并显示反馈 */
  const handleCopy = useCallback(async (key: string, text: string) => {
    if (!text) return;
    const ok = await copyText(text);
    setCopyState((s) => ({ ...s, [key]: ok }));
    setTimeout(() => setCopyState((s) => ({ ...s, [key]: false })), 1500);
  }, []);

  /** 执行加密 */
  const handleEncrypt = useCallback(async () => {
    setLoading(true);
    setEncResult(null);
    const result = await encrypt(plaintext, {
      mode,
      keyLength,
      keySource,
      keyInput,
      outputFormat,
      iterations,
    });
    setEncResult(result);
    setLoading(false);
  }, [plaintext, mode, keyLength, keySource, keyInput, outputFormat, iterations]);

  /** 执行解密 */
  const handleDecrypt = useCallback(async () => {
    setLoading(true);
    setDecResult(null);
    const result = await decrypt({
      mode,
      keyLength,
      keySource,
      keyInput,
      ciphertextInput,
      ivInput,
      outputFormat,
      iterations,
      saltInput: keySource === 'password' ? saltInput : undefined,
    });
    setDecResult(result);
    setLoading(false);
  }, [plaintext, mode, keyLength, keySource, keyInput, ciphertextInput, ivInput, outputFormat, iterations, saltInput]);

  /** 生成随机密钥并填入输入框 */
  const handleGenerateKey = useCallback(() => {
    const hex = generateKeyHex(keyLength);
    setKeySource('hex');
    setKeyInput(hex);
  }, [keyLength]);

  /** 载入示例参数 */
  const handleLoadExample = useCallback(() => {
    setDirection('encrypt');
    setMode('GCM');
    setKeyLength(256);
    setKeySource('hex');
    setOutputFormat('hex');
    setIterations(DEFAULT_ITERATIONS);
    setPlaintext(SAMPLE_PLAINTEXT);
    setKeyInput(SAMPLE_KEY_256);
    setEncResult(null);
    setDecResult(null);
  }, []);

  /** 将加密结果填入解密输入区，形成闭环验证 */
  const handleFillDecrypt = useCallback(() => {
    if (!encResult || !encResult.ok) return;
    setDirection('decrypt');
    setCiphertextInput(encResult.ciphertext);
    setIvInput(encResult.iv);
    if (keySource === 'password') {
      setSaltInput(encResult.salt);
    }
    setDecResult(null);
  }, [encResult, keySource]);

  /** 清空所有输入与结果 */
  const handleClear = useCallback(() => {
    setPlaintext('');
    setKeyInput('');
    setCiphertextInput('');
    setIvInput('');
    setSaltInput('');
    setEncResult(null);
    setDecResult(null);
  }, []);

  // 切换方向时清空结果，避免跨方向状态污染
  const switchDirection = useCallback((d: Direction) => {
    setDirection(d);
    setEncResult(null);
    setDecResult(null);
  }, []);

  const modeMeta = MODE_META[mode];
  const showSalt = keySource === 'password';
  const showIterations = keySource === 'password';

  return (
    <div className="aes__tool">
      {/* 方向切换 */}
      <div className="aes__direction" role="tablist" aria-label="操作方向">
        <button
          type="button"
          role="tab"
          aria-selected={direction === 'encrypt'}
          className={`aes__dir-btn ${direction === 'encrypt' ? 'aes__dir-btn--active' : ''}`}
          onClick={() => switchDirection('encrypt')}
        >
          加密（明文 → 密文）
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={direction === 'decrypt'}
          className={`aes__dir-btn ${direction === 'decrypt' ? 'aes__dir-btn--active' : ''}`}
          onClick={() => switchDirection('decrypt')}
        >
          解密（密文 → 明文）
        </button>
      </div>

      {/* 参数配置区 */}
      <fieldset className="aes__field">
        <legend>参数配置</legend>

        {/* 模式选择 */}
        <div className="aes__row">
          <label className="aes__label">加密模式</label>
          <div className="aes__seg">
            {MODE_OPTIONS.map((m) => (
              <button
                key={m}
                type="button"
                className={`aes__seg-btn ${mode === m ? 'aes__seg-btn--active' : ''}`}
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
              >
                {MODE_META[m].label}
              </button>
            ))}
          </div>
          <p className={`aes__mode-hint ${modeMeta.recommend ? 'aes__mode-hint--ok' : 'aes__mode-hint--warn'}`}>
            {modeMeta.desc}
          </p>
        </div>

        {/* 密钥长度 */}
        <div className="aes__row">
          <label className="aes__label">密钥长度</label>
          <div className="aes__seg">
            {KEY_LENGTH_OPTIONS.map((kl) => (
              <button
                key={kl}
                type="button"
                className={`aes__seg-btn ${keyLength === kl ? 'aes__seg-btn--active' : ''}`}
                onClick={() => setKeyLength(kl)}
                aria-pressed={keyLength === kl}
              >
                AES-{kl}
              </button>
            ))}
          </div>
        </div>

        {/* 密钥来源 */}
        <div className="aes__row">
          <label className="aes__label">密钥来源</label>
          <select
            className="aes__select"
            value={keySource}
            onChange={(e) => setKeySource(e.target.value as KeySource)}
          >
            {KEY_SOURCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="aes__source-hint">
            {KEY_SOURCE_OPTIONS.find((o) => o.value === keySource)?.hint}
          </p>
        </div>

        {/* 输出格式 */}
        <div className="aes__row">
          <label className="aes__label">{direction === 'encrypt' ? '输出格式' : '输入格式'}</label>
          <div className="aes__seg">
            {OUTPUT_FORMAT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`aes__seg-btn ${outputFormat === opt.value ? 'aes__seg-btn--active' : ''}`}
                onClick={() => setOutputFormat(opt.value)}
                aria-pressed={outputFormat === opt.value}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* PBKDF2 迭代次数（仅密码派生模式显示） */}
        {showIterations && (
          <div className="aes__row">
            <label className="aes__label">PBKDF2 迭代次数</label>
            <input
              type="number"
              className="aes__input aes__input--num"
              value={iterations}
              min={1000}
              max={10000000}
              step={10000}
              onChange={(e) => setIterations(Math.max(1000, Number(e.target.value) || DEFAULT_ITERATIONS))}
            />
            <p className="aes__source-hint">
              OWASP 2023 建议至少 600000 次（SHA-256）。次数越高越抗暴力破解，但加密耗时也越长。
            </p>
          </div>
        )}
      </fieldset>

      {/* 密钥输入区 */}
      <div className="aes__block">
        <div className="aes__block-head">
          <label className="aes__block-label" htmlFor="aes-key">
            {keySource === 'password' ? '密码（口令）' : '密钥'}
          </label>
          {keySource !== 'password' && (
            <button type="button" className="aes__mini-btn" onClick={handleGenerateKey}>
              生成随机密钥
            </button>
          )}
        </div>
        <textarea
          id="aes-key"
          className="aes__textarea aes__textarea--key"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          placeholder={
            keySource === 'hex'
              ? `输入 ${keyLength / 8} 字节的十六进制密钥（${keyLength / 4} 个字符）`
              : keySource === 'base64'
                ? `输入 ${keyLength / 8} 字节密钥的 Base64 编码`
                : keySource === 'utf8'
                  ? `输入文本，UTF-8 编码后需恰好 ${keyLength / 8} 字节`
                  : '输入密码（口令），将用 PBKDF2 派生密钥'
          }
          rows={3}
          spellCheck={false}
        />
      </div>

      {/* 输入区：根据方向切换 */}
      {direction === 'encrypt' ? (
        <div className="aes__block">
          <label className="aes__block-label" htmlFor="aes-plain">
            明文
          </label>
          <textarea
            id="aes-plain"
            className="aes__textarea"
            value={plaintext}
            onChange={(e) => setPlaintext(e.target.value)}
            placeholder="输入要加密的明文文本"
            rows={5}
            spellCheck={false}
          />
        </div>
      ) : (
        <>
          <div className="aes__block">
            <label className="aes__block-label" htmlFor="aes-cipher">
              密文（{outputFormat.toUpperCase()} 编码）
            </label>
            <textarea
              id="aes-cipher"
              className="aes__textarea"
              value={ciphertextInput}
              onChange={(e) => setCiphertextInput(e.target.value)}
              placeholder={`输入 ${outputFormat.toUpperCase()} 编码的密文`}
              rows={5}
              spellCheck={false}
            />
          </div>
          <div className="aes__block">
            <label className="aes__block-label" htmlFor="aes-iv">
              IV / Nonce（{outputFormat.toUpperCase()} 编码，{modeMeta.ivLen} 字节）
            </label>
            <input
              id="aes-iv"
              type="text"
              className="aes__input"
              value={ivInput}
              onChange={(e) => setIvInput(e.target.value)}
              placeholder={`输入 ${outputFormat.toUpperCase()} 编码的 IV`}
              spellCheck={false}
            />
          </div>
          {showSalt && (
            <div className="aes__block">
              <label className="aes__block-label" htmlFor="aes-salt">
                盐（PBKDF2 Salt，{outputFormat.toUpperCase()} 编码）
              </label>
              <input
                id="aes-salt"
                type="text"
                className="aes__input"
                value={saltInput}
                onChange={(e) => setSaltInput(e.target.value)}
                placeholder="输入加密时返回的盐（来自加密输出）"
                spellCheck={false}
              />
            </div>
          )}
        </>
      )}

      {/* 操作按钮 */}
      <div className="aes__actions">
        <button
          type="button"
          className="aes__btn aes__btn--primary"
          onClick={direction === 'encrypt' ? handleEncrypt : handleDecrypt}
          disabled={loading}
        >
          {loading ? '处理中...' : direction === 'encrypt' ? '加密' : '解密'}
        </button>
        <button type="button" className="aes__btn" onClick={handleLoadExample}>
          载入示例
        </button>
        {direction === 'encrypt' && encResult?.ok && (
          <button type="button" className="aes__btn aes__btn--link" onClick={handleFillDecrypt}>
            用加密结果填入解密
          </button>
        )}
        <button type="button" className="aes__btn aes__btn--ghost" onClick={handleClear}>
          清空
        </button>
      </div>

      {/* 加密结果 */}
      {direction === 'encrypt' && encResult && (
        <div className="aes__result">
          <h3 className="aes__result-title">加密结果</h3>
          {!encResult.ok ? (
            <p className="aes__error">{encResult.error}</p>
          ) : (
            <>
              <ResultField
                label="密文"
                value={encResult.ciphertext}
                mono
                onCopy={() => handleCopy('ct', encResult.ciphertext)}
                copied={copyState['ct']}
                meta={`${encResult.ciphertextBytes} 字节`}
              />
              <ResultField
                label="IV / Nonce"
                value={encResult.iv}
                mono
                onCopy={() => handleCopy('iv', encResult.iv)}
                copied={copyState['iv']}
              />
              {encResult.salt && (
                <ResultField
                  label="盐（PBKDF2 Salt）"
                  value={encResult.salt}
                  mono
                  onCopy={() => handleCopy('salt', encResult.salt)}
                  copied={copyState['salt']}
                />
              )}
              {encResult.derivedKey && (
                <ResultField
                  label="派生密钥（Hex，仅展示）"
                  value={encResult.derivedKey}
                  mono
                  onCopy={() => handleCopy('dk', encResult.derivedKey)}
                  copied={copyState['dk']}
                />
              )}
              <p className="aes__tip">
                提示：解密时需提供相同的密钥/密码、IV、盐（派生模式）与迭代次数。
                可点击上方「用加密结果填入解密」一键填入密文、IV、盐，切换到解密验证。
              </p>
            </>
          )}
        </div>
      )}

      {/* 解密结果 */}
      {direction === 'decrypt' && decResult && (
        <div className="aes__result">
          <h3 className="aes__result-title">解密结果</h3>
          {!decResult.ok ? (
            <p className="aes__error">{decResult.error}</p>
          ) : (
            <ResultField
              label="明文"
              value={decResult.plaintext}
              onCopy={() => handleCopy('pt', decResult.plaintext)}
              copied={copyState['pt']}
            />
          )}
        </div>
      )}

      {/* 安全提示 */}
      <aside className="aes__security">
        <h3>安全提示</h3>
        <ul>
          <li>
            <strong>GCM</strong>是推荐模式：自带认证标签，可检测密文篡改，无需额外 MAC。
          </li>
          <li>
            <strong>CBC</strong>无认证，存在 padding oracle 风险，生产环境建议配合 HMAC（加密-然后-MAC）。
          </li>
          <li>
            <strong>CTR</strong>的 IV/计数器绝不可重复使用，否则会泄露明文 XOR 结果。
          </li>
          <li>同一密钥下每次加密必须使用<strong>全新的随机 IV</strong>，本工具每次自动生成。</li>
          <li>人类口令应使用 <strong>PBKDF2</strong> 派生密钥，避免直接作为 AES 密钥（长度不足且熵低）。</li>
          <li>密钥与明文仅在浏览器本地处理，不会上传。深入阅读{' '}
            <a href="/blog/aes-encryption-guide">AES 加密实战指南</a>{' '}
            或配合 <a href="/hash">Hash 工具</a>、<a href="/jwt-sign">JWT 签名</a>、
            <a href="/jwe">JWE 解码</a> 使用。
          </li>
        </ul>
      </aside>
    </div>
  );
}

/**
 * 结果字段展示组件（含复制按钮）
 */
interface ResultFieldProps {
  label: string;
  value: string;
  mono?: boolean;
  meta?: string;
  onCopy: () => void;
  copied: boolean;
}

function ResultField({ label, value, mono, meta, onCopy, copied }: ResultFieldProps) {
  return (
    <div className="aes__field-result">
      <div className="aes__field-result-head">
        <span className="aes__field-result-label">{label}</span>
        {meta && <span className="aes__field-result-meta">{meta}</span>}
        <button type="button" className="aes__copy-btn" onClick={onCopy} disabled={!value}>
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className={`aes__field-result-value ${mono ? 'aes__field-result-value--mono' : ''}`}>{value || '（空）'}</pre>
    </div>
  );
}
