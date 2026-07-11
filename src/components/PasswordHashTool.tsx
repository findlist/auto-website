import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import bcrypt from 'bcryptjs';
import { copyText } from '../utils/clipboard';

/**
 * 密码哈希工具
 * 支持 bcrypt 与 PBKDF2 两种主流密码哈希算法，提供"生成哈希"与"验证哈希"双向能力。
 *
 * 设计要点：
 *  - bcrypt：使用 bcryptjs（纯 JS 实现，~10KB），符合 OpenBSD bcrypt $2a$/$2b$ 格式
 *  - PBKDF2：使用浏览器原生 Web Crypto API（零依赖），支持 SHA-256/SHA-512
 *  - 盐值：每次生成时 CSPRNG 产生新盐，避免彩虹表攻击
 *  - PBKDF2 标准格式：pbkdf2$<iterations>$<hashName>$<saltBase64>$<hashBase64>
 *  - 全本地处理，密码与哈希均不离开浏览器
 *
 * 安全说明：
 *  - 本工具面向开发者调试与学习，不应用于生产环境密钥管理
 *  - 推荐 bcrypt cost ≥ 12，PBKDF2-SHA256 迭代数 ≥ 100000（OWASP 2023 建议）
 */

type Algorithm = 'bcrypt' | 'pbkdf2';
type Mode = 'hash' | 'verify';
type Pbkdf2Hash = 'SHA-256' | 'SHA-512';

interface HashResult {
  hash: string;
  durationMs: number;
  saltPreview: string;
  length: number;
}

interface VerifyResult {
  ok: boolean;
  durationMs: number;
  detail: string;
}

// 算法可选范围常量
const BCRYPT_COST_MIN = 4;
const BCRYPT_COST_MAX = 14; // 14 已是浏览器可接受上限（约 3-5 秒）
const BCRYPT_COST_DEFAULT = 12;

const PBKDF2_ITER_MIN = 10000;
const PBKDF2_ITER_MAX = 1000000;
const PBKDF2_ITER_DEFAULT = 100000;
const PBKDF2_ITER_STEP = 10000;

// PBKDF2 输出长度（字节）
const PBKDF2_LENGTH: Record<Pbkdf2Hash, number> = {
  'SHA-256': 32,
  'SHA-512': 64,
};

// Base64 编码（兼容浏览器原生 btoa 与 UTF-8）
function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Base64 解码为 Uint8Array<ArrayBuffer>，匹配 Web Crypto API 的 BufferSource 类型要求
function decodeBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// 生成密码学安全的随机盐
function generateSalt(bytes: number): Uint8Array<ArrayBuffer> {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return arr;
}

/**
 * 执行 bcrypt 哈希
 * bcryptjs 的 hash 是同步阻塞的（纯 JS），用 setTimeout 让 UI 先刷新到 loading 状态
 */
function hashBcrypt(password: string, cost: number): Promise<HashResult> {
  return new Promise((resolve, reject) => {
    // 让浏览器有机会渲染 loading 状态再执行阻塞计算
    setTimeout(() => {
      try {
        const start = performance.now();
        // genSalt 同步生成盐（内部用 Math.random，但 bcrypt 盐本身不需要密码学强度）
        const salt = bcrypt.genSaltSync(cost);
        const hash = bcrypt.hashSync(password, salt);
        const durationMs = performance.now() - start;
        // bcrypt 盐嵌入在哈希串中：$2a$cost$22位盐$31位哈希
        const saltPart = salt.split('$')[3] || '';
        resolve({
          hash,
          durationMs,
          saltPreview: saltPart,
          length: hash.length,
        });
      } catch (err) {
        reject(err);
      }
    }, 0);
  });
}

/**
 * 执行 PBKDF2 哈希（Web Crypto API 原生异步，不阻塞主线程）
 * 输出格式：pbkdf2$<iterations>$<hashName>$<saltBase64>$<hashBase64>
 */
async function hashPbkdf2(
  password: string,
  iterations: number,
  hashName: Pbkdf2Hash,
): Promise<HashResult> {
  const start = performance.now();
  const saltBytes = generateSalt(16);
  const saltBase64 = encodeBase64(saltBytes);

  // 导入密码作为密钥素材
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );

  // 派生哈希位
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations,
      hash: hashName,
    },
    keyMaterial,
    PBKDF2_LENGTH[hashName] * 8,
  );

  const hashBase64 = encodeBase64(new Uint8Array(derivedBits));
  const hash = `pbkdf2$${iterations}$${hashName}$${saltBase64}$${hashBase64}`;
  const durationMs = performance.now() - start;

  return {
    hash,
    durationMs,
    saltPreview: saltBase64,
    length: hash.length,
  };
}

/**
 * 验证 bcrypt 哈希
 */
function verifyBcrypt(password: string, hash: string): Promise<VerifyResult> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        const start = performance.now();
        // compareSync 内部会从 hash 中提取盐与 cost，无需单独传入
        const ok = bcrypt.compareSync(password, hash);
        const durationMs = performance.now() - start;
        resolve({
          ok,
          durationMs,
          detail: ok
            ? '密码与哈希匹配（bcrypt 验证通过）'
            : '密码与哈希不匹配（bcrypt 验证失败）',
        });
      } catch (err) {
        // 哈希格式错误时 bcryptjs 抛出 "Invalid salt version" 等
        reject(err);
      }
    }, 0);
  });
}

/**
 * 验证 PBKDF2 哈希
 * 解析标准格式 pbkdf2$<iter>$<hash>$<saltB64>$<hashB64>，使用相同参数重新派生并比对
 */
async function verifyPbkdf2(
  password: string,
  hashStr: string,
): Promise<VerifyResult> {
  const start = performance.now();
  const parts = hashStr.split('$');
  // 期望格式：pbkdf2$iter$hashName$saltB64$hashB64
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') {
    throw new Error('PBKDF2 哈希格式无效，期望：pbkdf2$<iterations>$<hashName>$<saltBase64>$<hashBase64>');
  }
  const iterations = parseInt(parts[1], 10);
  const hashName = parts[2] as Pbkdf2Hash;
  const saltBase64 = parts[3];
  const expectedHashB64 = parts[4];

  if (!Number.isFinite(iterations) || iterations <= 0) {
    throw new Error('PBKDF2 迭代数字段无效');
  }
  if (hashName !== 'SHA-256' && hashName !== 'SHA-512') {
    throw new Error(`不支持的哈希函数：${hashName}`);
  }

  let saltBytes: Uint8Array<ArrayBuffer>;
  let expectedBytes: Uint8Array<ArrayBuffer>;
  try {
    saltBytes = decodeBase64(saltBase64);
    expectedBytes = decodeBase64(expectedHashB64);
  } catch {
    throw new Error('盐或哈希的 Base64 解码失败');
  }

  // 重新派生
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: hashName },
    keyMaterial,
    expectedBytes.length * 8,
  );

  // 常数时间比较，避免时序侧信道
  const actualBytes = new Uint8Array(derivedBits);
  let diff = 0;
  for (let i = 0; i < actualBytes.length; i++) {
    diff |= actualBytes[i] ^ expectedBytes[i];
  }
  // 长度不等时也要走完整比较流程，避免长度泄漏
  if (actualBytes.length !== expectedBytes.length) diff = 1;

  const durationMs = performance.now() - start;
  return {
    ok: diff === 0,
    durationMs,
    detail:
      diff === 0
        ? `密码与哈希匹配（PBKDF2-${hashName} / ${iterations.toLocaleString()} 次迭代验证通过）`
        : `密码与哈希不匹配（PBKDF2-${hashName} / ${iterations.toLocaleString()} 次迭代验证失败）`,
  };
}

export default function PasswordHashTool() {
  const [mode, setMode] = useState<Mode>('hash');
  const [algorithm, setAlgorithm] = useState<Algorithm>('bcrypt');

  // 通用输入
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // bcrypt 参数
  const [bcryptCost, setBcryptCost] = useState<number>(BCRYPT_COST_DEFAULT);

  // PBKDF2 参数
  const [pbkdf2Iter, setPbkdf2Iter] = useState<number>(PBKDF2_ITER_DEFAULT);
  const [pbkdf2Hash, setPbkdf2Hash] = useState<Pbkdf2Hash>('SHA-256');

  // 验证模式输入
  const [hashInput, setHashInput] = useState('');

  // 结果与状态
  const [hashResult, setHashResult] = useState<HashResult | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const noticeTimer = useRef<number | undefined>(undefined);

  // 切换算法/模式时清空结果，避免跨算法误用
  useEffect(() => {
    setHashResult(null);
    setVerifyResult(null);
    setError('');
  }, [mode, algorithm]);

  // 估算 bcrypt cost 对应耗时（粗略，用于 UI 提示）
  const bcryptTimeHint = useMemo(() => {
    // cost=10 约 50ms，cost=12 约 200ms，每 +1 翻倍
    const base = 50 * Math.pow(2, bcryptCost - 10);
    if (base < 1000) return `约 ${Math.round(base)} ms`;
    return `约 ${(base / 1000).toFixed(1)} s`;
  }, [bcryptCost]);

  const pbkdf2TimeHint = useMemo(() => {
    // SHA-256 / 100k 次约 50ms，SHA-512 约翻倍
    const base = (pbkdf2Hash === 'SHA-512' ? 100 : 50) * (pbkdf2Iter / 100000);
    if (base < 1000) return `约 ${Math.round(base)} ms`;
    return `约 ${(base / 1000).toFixed(1)} s`;
  }, [pbkdf2Iter, pbkdf2Hash]);

  /** 临时提示 */
  const flashNotice = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 1500);
  }, []);

  /** 生成哈希 */
  const handleHash = useCallback(async () => {
    if (!password) {
      setError('请输入待哈希的密码');
      setHashResult(null);
      return;
    }
    setLoading(true);
    setError('');
    setHashResult(null);
    try {
      const result =
        algorithm === 'bcrypt'
          ? await hashBcrypt(password, bcryptCost)
          : await hashPbkdf2(password, pbkdf2Iter, pbkdf2Hash);
      setHashResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [password, algorithm, bcryptCost, pbkdf2Iter, pbkdf2Hash]);

  /** 验证哈希 */
  const handleVerify = useCallback(async () => {
    if (!password) {
      setError('请输入待验证的密码');
      setVerifyResult(null);
      return;
    }
    if (!hashInput.trim()) {
      setError('请粘贴待验证的哈希字符串');
      setVerifyResult(null);
      return;
    }
    setLoading(true);
    setError('');
    setVerifyResult(null);
    try {
      // 根据哈希格式自动识别算法
      const trimmed = hashInput.trim();
      const isPbkdf2 = trimmed.startsWith('pbkdf2$');
      const isBcrypt = /^\$2[abxy]\$/.test(trimmed);
      let result: VerifyResult;
      if (algorithm === 'bcrypt' && isBcrypt) {
        result = await verifyBcrypt(password, trimmed);
      } else if (algorithm === 'pbkdf2' && isPbkdf2) {
        result = await verifyPbkdf2(password, trimmed);
      } else if (isBcrypt && algorithm === 'pbkdf2') {
        setError('检测到 bcrypt 哈希格式，请切到 bcrypt 算法后再验证');
        setLoading(false);
        return;
      } else if (isPbkdf2 && algorithm === 'bcrypt') {
        setError('检测到 PBKDF2 哈希格式，请切到 PBKDF2 算法后再验证');
        setLoading(false);
        return;
      } else {
        setError(
          algorithm === 'bcrypt'
            ? '哈希格式无效，期望 bcrypt 格式：$2a$<cost>$<22位盐><31位哈希>'
            : '哈希格式无效，期望 PBKDF2 格式：pbkdf2$<iter>$<hashName>$<saltBase64>$<hashBase64>',
        );
        setLoading(false);
        return;
      }
      setVerifyResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [password, hashInput, algorithm]);

  /** 复制哈希结果 */
  const handleCopy = useCallback(async () => {
    if (!hashResult) return;
    const ok = await copyText(hashResult.hash);
    if (ok) {
      setCopied(true);
      flashNotice('已复制哈希到剪贴板');
      setTimeout(() => setCopied(false), 1500);
    } else {
      flashNotice('复制失败，请手动选中复制');
    }
  }, [hashResult, flashNotice]);

  /** 清空所有输入与结果 */
  const handleClear = useCallback(() => {
    setPassword('');
    setHashInput('');
    setHashResult(null);
    setVerifyResult(null);
    setError('');
    setNotice('');
    setCopied(false);
  }, []);

  /** 加载示例 */
  const handleLoadExample = useCallback(() => {
    setPassword('correct horse battery staple');
    if (mode === 'verify') {
      setHashInput(
        algorithm === 'bcrypt'
          ? '$2a$12$abcdefghijklmnopqrstuueg5MBqZ4lAVCB1nlLmv9BpGhQaF1a2u'
          : 'pbkdf2$100000$SHA-256$wHZS9xnmaTCrhjvBxQ9T3w==$lUfRw1i1Lv0lLBJCNIYq1w==',
      );
    }
  }, [mode, algorithm]);

  return (
    <div className="jsontool pwhtool">
      {/* 工具栏 */}
      <div className="jsontool__toolbar" role="toolbar" aria-label="密码哈希工具操作">
        <div className="jsontool__actions">
          {/* 模式切换 */}
          <div className="pwhtool__mode-tabs" role="tablist" aria-label="模式切换">
            <button
              role="tab"
              aria-selected={mode === 'hash'}
              className={`pwhtool__mode-tab${mode === 'hash' ? ' is-active' : ''}`}
              onClick={() => setMode('hash')}
            >
              生成哈希
            </button>
            <button
              role="tab"
              aria-selected={mode === 'verify'}
              className={`pwhtool__mode-tab${mode === 'verify' ? ' is-active' : ''}`}
              onClick={() => setMode('verify')}
            >
              验证哈希
            </button>
          </div>
        </div>
        <div className="jsontool__options">
          {/* 算法选择 */}
          <label className="pwhtool__field">
            <span>算法</span>
            <select
              className="pwhtool__select"
              value={algorithm}
              onChange={(e) => setAlgorithm(e.target.value as Algorithm)}
              aria-label="哈希算法"
            >
              <option value="bcrypt">bcrypt</option>
              <option value="pbkdf2">PBKDF2</option>
            </select>
          </label>
          <button className="btn btn--sm" onClick={handleLoadExample}>示例</button>
          <button className="btn btn--sm" onClick={handleClear}>清空</button>
        </div>
      </div>

      {/* 参数控制区 */}
      <div className="pwhtool__controls">
        {/* 密码输入 */}
        <div className="pwhtool__field pwhtool__field--password">
          <span className="pwhtool__field-label">密码</span>
          <div className="pwhtool__password-wrap">
            <input
              type={showPassword ? 'text' : 'password'}
              className="pwhtool__input pwhtool__input--mono"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="输入待哈希 / 验证的密码"
              aria-label="密码输入"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="pwhtool__toggle-pwd"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
              title={showPassword ? '隐藏密码' : '显示密码'}
            >
              {showPassword ? '🙈' : '👁'}
            </button>
          </div>
        </div>

        {/* 算法专属参数 */}
        {algorithm === 'bcrypt' ? (
          <div className="pwhtool__field pwhtool__field--cost">
            <span className="pwhtool__field-label">cost</span>
            <input
              type="range"
              className="pwhtool__range"
              min={BCRYPT_COST_MIN}
              max={BCRYPT_COST_MAX}
              step={1}
              value={bcryptCost}
              onChange={(e) => setBcryptCost(Number(e.target.value))}
              aria-label="bcrypt cost 因子"
            />
            <span className="pwhtool__value-pill" aria-live="polite">{bcryptCost}</span>
            <span className="pwhtool__hint-text">{bcryptTimeHint}</span>
          </div>
        ) : (
          <>
            <div className="pwhtool__field pwhtool__field--iter">
              <span className="pwhtool__field-label">迭代数</span>
              <input
                type="range"
                className="pwhtool__range"
                min={PBKDF2_ITER_MIN}
                max={PBKDF2_ITER_MAX}
                step={PBKDF2_ITER_STEP}
                value={pbkdf2Iter}
                onChange={(e) => setPbkdf2Iter(Number(e.target.value))}
                aria-label="PBKDF2 迭代数"
              />
              <span className="pwhtool__value-pill" aria-live="polite">
                {pbkdf2Iter.toLocaleString()}
              </span>
              <span className="pwhtool__hint-text">{pbkdf2TimeHint}</span>
            </div>
            <div className="pwhtool__field">
              <span className="pwhtool__field-label">哈希函数</span>
              <div className="pwhtool__radio-group" role="radiogroup" aria-label="PBKDF2 哈希函数">
                {(['SHA-256', 'SHA-512'] as Pbkdf2Hash[]).map((h) => (
                  <label key={h} className="pwhtool__toggle">
                    <input
                      type="radio"
                      name="pbkdf2-hash"
                      checked={pbkdf2Hash === h}
                      onChange={() => setPbkdf2Hash(h)}
                    />
                    <span>{h}</span>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

        {/* 验证模式：哈希输入框 */}
        {mode === 'verify' && (
          <div className="pwhtool__field pwhtool__field--hash">
            <span className="pwhtool__field-label">哈希</span>
            <textarea
              className="pwhtool__textarea pwhtool__input--mono"
              value={hashInput}
              onChange={(e) => setHashInput(e.target.value)}
              placeholder={
                algorithm === 'bcrypt'
                  ? '粘贴 bcrypt 哈希：$2a$12$...'
                  : '粘贴 PBKDF2 哈希：pbkdf2$100000$SHA-256$...'
              }
              rows={3}
              aria-label="待验证的哈希字符串"
              spellCheck={false}
            />
          </div>
        )}

        {/* 操作按钮 */}
        <div className="pwhtool__actions">
          <button
            className="btn btn--primary btn--sm"
            onClick={mode === 'hash' ? handleHash : handleVerify}
            disabled={loading || !password}
          >
            {loading ? '计算中…' : mode === 'hash' ? '生成哈希' : '验证密码'}
          </button>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="pwhtool__error" role="alert">
          {error}
        </div>
      )}

      {/* 结果展示 */}
      {mode === 'hash' && hashResult && (
        <div className="jsontool__panels">
          <div className="jsontool__panel">
            <div className="jsontool__label">
              <span>哈希结果</span>
              <button
                className="btn btn--sm jsontool__copy"
                onClick={handleCopy}
                aria-label="复制哈希"
              >
                {copied ? '已复制' : '复制'}
              </button>
            </div>
            <pre className="pwhtool__hash-output" aria-live="polite">{hashResult.hash}</pre>
            <div className="pwhtool__stats">
              <span>长度：{hashResult.length} 字符</span>
              <span>耗时：{hashResult.durationMs.toFixed(1)} ms</span>
              <span>盐（预览）：{hashResult.saltPreview.slice(0, 16)}…</span>
            </div>
          </div>
        </div>
      )}

      {mode === 'verify' && verifyResult && (
        <div className="pwhtool__verify-result" aria-live="polite">
          <div
            className={`pwhtool__verify-banner${
              verifyResult.ok ? ' is-ok' : ' is-fail'
            }`}
          >
            <span className="pwhtool__verify-icon">{verifyResult.ok ? '✅' : '❌'}</span>
            <div>
              <div className="pwhtool__verify-status">
                {verifyResult.ok ? '验证通过' : '验证失败'}
              </div>
              <div className="pwhtool__verify-detail">{verifyResult.detail}</div>
            </div>
          </div>
          <div className="pwhtool__stats">
            <span>耗时：{verifyResult.durationMs.toFixed(1)} ms</span>
          </div>
        </div>
      )}

      {/* 状态条 */}
      <div className="jsontool__status" role="status" aria-live="polite">
        {notice ? (
          <div className="jsontool__notice">{notice}</div>
        ) : (
          <div className="jsontool__hint">
            {algorithm === 'bcrypt'
              ? 'bcrypt 使用 bcryptjs 纯 JS 实现，盐自动生成并嵌入哈希字符串。cost 每加 1 耗时翻倍，建议 ≥ 12。'
              : 'PBKDF2 使用浏览器原生 Web Crypto API，盐为 16 字节 CSPRNG 随机数。OWASP 2023 建议 SHA-256 ≥ 100,000 次迭代。'}
            全本地处理，密码不离开浏览器。
          </div>
        )}
      </div>
    </div>
  );
}
