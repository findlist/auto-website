import { useState, useMemo, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import { copyText } from '../utils/clipboard';
import {
  signJwt,
  generateRsaKeyPair,
  generateEcKeyPair,
  ALG_LIST,
  ALG_MAP,
  checkHmacKeyLength,
  getHmacKeyBits,
  SAMPLE_PAYLOAD,
  SAMPLE_HMAC_KEY,
  CLAIM_DESC,
  type JwtAlg,
  type AlgCategory,
  type RsaKeyPair,
  type EcKeyPair,
  type EcCurve,
  type JwtSignResult,
} from '../utils/jwtSign';

/**
 * JWT 签名生成工具
 * 全部在浏览器本地签发，不发起任何网络请求，密钥不离开设备。
 *
 * 功能：
 *  - 支持 HS256 / HS384 / HS512（HMAC + SHA 对称密钥）
 *  - 支持 RS256 / RS384 / RS512（RSASSA-PKCS1-v1_5 + SHA 非对称密钥）
 *  - 支持 ES256 / ES384 / ES512（ECDSA + SHA 椭圆曲线非对称密钥）
 *  - 支持 none 算法（无签名，仅用于调试演示，严禁生产）
 *  - 在线生成 RSA 密钥对（2048 / 3072 / 4096 位，输出 JWK + PEM 双格式）
 *  - 在线生成 EC 密钥对（P-256 / P-384 / P-521 曲线，输出 JWK + PEM 双格式）
 *  - 实时校验 Header/Payload JSON 合法性与 alg 一致性
 *  - HMAC 密钥长度不足时警告
 *  - 签名结果分段展示（Header / Payload / Signature 三段 base64url + 美化 JSON）
 *  - 复制完整 JWT 或单段
 *
 * 安全策略：
 *  - Web Crypto API 仅在 HTTPS 或 localhost 可用，非安全上下文给出明确提示
 *  - none 算法生成结果显著安全警告
 *  - HMAC 密钥低于算法推荐长度时警告（仍允许签发，由用户决定）
 *  - 密钥输入框 autocomplete="off" 防止泄漏
 */

/** HMAC 密钥输入格式 */
type HmacKeyFormat = 'utf8' | 'base64url';

/** RSA 密钥位数 */
type RsaBits = 2048 | 3072 | 4096;

/** EC 椭圆曲线选项（用于 UI 选择） */
type EcCurveOption = EcCurve;

/** 复制目标 */
type CopyTarget = 'token' | 'header' | 'payload' | 'signature';

/** 生成 RSA 密钥对的加载状态 */
type GenKeyStatus = 'idle' | 'generating' | 'done' | 'error';

export default function JwtSignTool() {
  // 算法选择（默认 HS256）
  const [alg, setAlg] = useState<JwtAlg>('HS256');
  // Header JSON 文本（不含 alg，alg 由算法选择器决定）
  const [headerText, setHeaderText] = useState<string>(
    JSON.stringify({ typ: 'JWT' }, null, 2),
  );
  // Payload JSON 文本
  const [payloadText, setPayloadText] = useState<string>(
    JSON.stringify(SAMPLE_PAYLOAD, null, 2),
  );
  // HMAC 密钥输入
  const [hmacKey, setHmacKey] = useState<string>(SAMPLE_HMAC_KEY);
  // HMAC 密钥格式
  const [hmacKeyFormat, setHmacKeyFormat] = useState<HmacKeyFormat>('utf8');
  // RSA 私钥输入（PEM 或 JWK）
  const [rsaKeyInput, setRsaKeyInput] = useState<string>('');
  // EC 私钥输入（PEM 或 JWK）
  const [ecKeyInput, setEcKeyInput] = useState<string>('');

  // RSA 密钥生成状态
  const [rsaBits, setRsaBits] = useState<RsaBits>(2048);
  const [genKeyStatus, setGenKeyStatus] = useState<GenKeyStatus>('idle');
  const [genKeyError, setGenKeyError] = useState<string>('');
  const [generatedKeyPair, setGeneratedKeyPair] = useState<RsaKeyPair | null>(null);
  // EC 密钥生成状态
  const [ecCurve, setEcCurve] = useState<EcCurveOption>('P-256');
  const [genEcStatus, setGenEcStatus] = useState<GenKeyStatus>('idle');
  const [genEcError, setGenEcError] = useState<string>('');
  const [generatedEcKeyPair, setGeneratedEcKeyPair] = useState<EcKeyPair | null>(null);
  // 显示生成密钥的格式（jwk / pem）
  const [keyViewFormat, setKeyViewFormat] = useState<'jwk' | 'pem'>('pem');

  // 签名结果
  const [signResult, setSignResult] = useState<JwtSignResult | null>(null);
  // 签名进行中
  const [signing, setSigning] = useState<boolean>(false);

  // 提示与复制状态
  const [notice, setNotice] = useState<string>('');
  const [copiedTarget, setCopiedTarget] = useState<CopyTarget | null>(null);

  const algInfo = ALG_MAP[alg];
  const algCategory: AlgCategory = algInfo.category;

  /** 实时校验 Header JSON */
  const headerCheck = useMemo<{ ok: boolean; obj: Record<string, unknown> | null; error: string }>(() => {
    if (headerText.trim() === '') {
      return { ok: false, obj: null, error: 'Header 为空' };
    }
    try {
      const obj = JSON.parse(headerText);
      if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
        return { ok: false, obj: null, error: 'Header 必须是 JSON 对象' };
      }
      return { ok: true, obj: obj as Record<string, unknown>, error: '' };
    } catch (e) {
      return { ok: false, obj: null, error: `JSON 解析失败：${e instanceof Error ? e.message : ''}` };
    }
  }, [headerText]);

  /** 实时校验 Payload JSON */
  const payloadCheck = useMemo<{ ok: boolean; obj: Record<string, unknown> | null; error: string }>(() => {
    if (payloadText.trim() === '') {
      return { ok: false, obj: null, error: 'Payload 为空' };
    }
    try {
      const obj = JSON.parse(payloadText);
      if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
        return { ok: false, obj: null, error: 'Payload 必须是 JSON 对象' };
      }
      return { ok: true, obj: obj as Record<string, unknown>, error: '' };
    } catch (e) {
      return { ok: false, obj: null, error: `JSON 解析失败：${e instanceof Error ? e.message : ''}` };
    }
  }, [payloadText]);

  /** HMAC 密钥位数与警告 */
  const hmacKeyInfo = useMemo(() => {
    if (algCategory !== 'hmac') return { bits: 0, warn: null };
    const bits = getHmacKeyBits(hmacKey, hmacKeyFormat);
    const warn = checkHmacKeyLength(alg, bits);
    return { bits, warn };
  }, [alg, algCategory, hmacKey, hmacKeyFormat]);

  /** 是否可以执行签名 */
  const canSign = useMemo(() => {
    if (!headerCheck.ok || !payloadCheck.ok) return false;
    if (signing) return false;
    if (algCategory === 'hmac') return hmacKey.trim() !== '';
    if (algCategory === 'rsa') return rsaKeyInput.trim() !== '';
    if (algCategory === 'ec') return ecKeyInput.trim() !== '';
    return true; // none 算法
  }, [headerCheck.ok, payloadCheck.ok, signing, algCategory, hmacKey, rsaKeyInput, ecKeyInput]);

  /** 执行签名 */
  const handleSign = useCallback(async () => {
    if (!headerCheck.ok || !payloadCheck.ok || !headerCheck.obj || !payloadCheck.obj) return;
    setSigning(true);
    setNotice('');
    setCopiedTarget(null);
    try {
      // 构造 Header：用户输入 + alg（alg 由选择器决定，覆盖用户输入）
      const headerObj = { ...headerCheck.obj, alg };
      // 根据算法类别选择密钥输入源
      const keyInput =
        algCategory === 'hmac' ? hmacKey :
        algCategory === 'rsa' ? rsaKeyInput :
        algCategory === 'ec' ? ecKeyInput : '';
      const keyFormat = hmacKeyFormat;
      const result = await signJwt(headerObj, payloadCheck.obj, keyInput, keyFormat);
      setSignResult(result);
      if (!result.ok) {
        setNotice(result.error || '签名失败');
      }
    } catch (e) {
      setSignResult({
        ok: false,
        error: e instanceof Error ? e.message : `签名异常：${String(e)}`,
      });
    } finally {
      setSigning(false);
    }
  }, [headerCheck, payloadCheck, alg, algCategory, hmacKey, rsaKeyInput, ecKeyInput, hmacKeyFormat]);

  /** 生成 RSA 密钥对 */
  const handleGenRsaKey = useCallback(async () => {
    setGenKeyStatus('generating');
    setGenKeyError('');
    try {
      const pair = await generateRsaKeyPair(rsaBits);
      setGeneratedKeyPair(pair);
      setRsaKeyInput(pair.privatePem);
      setGenKeyStatus('done');
      setNotice(`已生成 ${rsaBits} 位 RSA 密钥对，私钥已填入签名输入框`);
    } catch (e) {
      setGenKeyStatus('error');
      setGenKeyError(e instanceof Error ? e.message : `生成失败：${String(e)}`);
    }
  }, [rsaBits]);

  /** 生成 EC 密钥对 */
  const handleGenEcKey = useCallback(async () => {
    setGenEcStatus('generating');
    setGenEcError('');
    try {
      const pair = await generateEcKeyPair(ecCurve);
      setGeneratedEcKeyPair(pair);
      setEcKeyInput(pair.privatePem);
      setGenEcStatus('done');
      setNotice(`已生成 ${ecCurve} 椭圆曲线密钥对，私钥已填入签名输入框`);
    } catch (e) {
      setGenEcStatus('error');
      setGenEcError(e instanceof Error ? e.message : `生成失败：${String(e)}`);
    }
  }, [ecCurve]);

  /** 载入示例 */
  const handleSample = useCallback(() => {
    setAlg('HS256');
    setHeaderText(JSON.stringify({ typ: 'JWT' }, null, 2));
    setPayloadText(JSON.stringify(SAMPLE_PAYLOAD, null, 2));
    setHmacKey(SAMPLE_HMAC_KEY);
    setHmacKeyFormat('utf8');
    setRsaKeyInput('');
    setEcKeyInput('');
    setGeneratedKeyPair(null);
    setGeneratedEcKeyPair(null);
    setSignResult(null);
    setNotice('');
  }, []);

  /** 清空 */
  const handleClear = useCallback(() => {
    setHeaderText(JSON.stringify({ typ: 'JWT' }, null, 2));
    setPayloadText(JSON.stringify({}, null, 2));
    setHmacKey('');
    setRsaKeyInput('');
    setEcKeyInput('');
    setGeneratedKeyPair(null);
    setGeneratedEcKeyPair(null);
    setSignResult(null);
    setNotice('');
    setCopiedTarget(null);
  }, []);

  /** 复制指定内容 */
  const handleCopy = useCallback(async (target: CopyTarget) => {
    if (!signResult || !signResult.ok) return;
    let text = '';
    if (target === 'token') text = signResult.token || '';
    else if (target === 'header') text = signResult.headerJson || '';
    else if (target === 'payload') text = signResult.payloadJson || '';
    else if (target === 'signature') text = signResult.signatureB64 || '';
    if (!text) return;
    const ok = await copyText(text);
    if (ok) {
      setCopiedTarget(target);
      setNotice('已复制到剪贴板');
      setTimeout(() => {
        setCopiedTarget(null);
        setNotice('');
      }, 1500);
    } else {
      setNotice('复制失败，请手动选中复制');
    }
  }, [signResult]);

  /** 切换算法时清空签名结果（避免显示旧结果） */
  const handleAlgChange = useCallback((newAlg: JwtAlg) => {
    setAlg(newAlg);
    setSignResult(null);
    setNotice('');
    setCopiedTarget(null);
  }, []);

  /** 切换算法时若选 RSA 且已生成密钥，自动填入 */
  useEffect(() => {
    if (algCategory === 'rsa' && generatedKeyPair && rsaKeyInput === '') {
      setRsaKeyInput(generatedKeyPair.privatePem);
    }
  }, [algCategory, generatedKeyPair, rsaKeyInput]);

  /** 切换算法时若选 EC 且已生成密钥，自动填入 */
  useEffect(() => {
    if (algCategory === 'ec' && generatedEcKeyPair && ecKeyInput === '') {
      setEcKeyInput(generatedEcKeyPair.privatePem);
    }
  }, [algCategory, generatedEcKeyPair, ecKeyInput]);

  /** 切换 EC 算法时（ES256/ES384/ES512）若已有对应曲线密钥则同步填充 */
  useEffect(() => {
    if (algCategory !== 'ec' || !generatedEcKeyPair) return;
    if (generatedEcKeyPair.curve === ecCurve) {
      setEcKeyInput(generatedEcKeyPair.privatePem);
    }
  }, [alg, algCategory, ecCurve, generatedEcKeyPair]);

  /** 切换到 ES 系列算法时自动同步对应曲线（ES256→P-256 / ES384→P-384 / ES512→P-521） */
  useEffect(() => {
    if (alg === 'ES256') setEcCurve('P-256');
    else if (alg === 'ES384') setEcCurve('P-384');
    else if (alg === 'ES512') setEcCurve('P-521');
  }, [alg]);

  // 算法选择按钮组
  const algButtons: ReactNode = (
    <div className="jwts__alg-group" role="radiogroup" aria-label="选择签名算法">
      {ALG_LIST.map((info) => (
        <button
          key={info.alg}
          type="button"
          role="radio"
          aria-checked={alg === info.alg}
          className={`jwts__alg-btn${alg === info.alg ? ' jwts__alg-btn--active' : ''}${
            info.security === 'insecure' ? ' jwts__alg-btn--insecure' : ''
          }`}
          onClick={() => handleAlgChange(info.alg)}
          title={info.desc}
        >
          {info.alg}
        </button>
      ))}
    </div>
  );

  // 算法说明
  const algDescPanel: ReactNode = (
    <div className={`jwts__alg-desc jwts__alg-desc--${algInfo.security}`}>
      <strong>{alg}</strong> · {algInfo.desc}
      {algInfo.security === 'insecure' && (
        <span className="jwts__warn-text"> ⚠ 严禁生产使用</span>
      )}
    </div>
  );

  // 密钥输入区（根据算法类别动态切换）
  let keyInputPanel: ReactNode = null;
  if (algCategory === 'hmac') {
    keyInputPanel = (
      <div className="jwts__key-area">
        <div className="jwts__key-head">
          <label htmlFor="jwts-hmac-key" className="jwts__label">HMAC 密钥</label>
          <div className="jwts__key-format">
            <label className="jwts__radio">
              <input
                type="radio"
                name="hmac-key-format"
                value="utf8"
                checked={hmacKeyFormat === 'utf8'}
                onChange={() => setHmacKeyFormat('utf8')}
              />
              <span>UTF-8 字符串</span>
            </label>
            <label className="jwts__radio">
              <input
                type="radio"
                name="hmac-key-format"
                value="base64url"
                checked={hmacKeyFormat === 'base64url'}
                onChange={() => setHmacKeyFormat('base64url')}
              />
              <span>base64url 编码字节</span>
            </label>
          </div>
        </div>
        <input
          id="jwts-hmac-key"
          type="text"
          className="jwts__key-input"
          placeholder={hmacKeyFormat === 'utf8' ? '输入密钥字符串…' : '输入 base64url 编码的密钥…'}
          value={hmacKey}
          onChange={(e) => setHmacKey(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="jwts__key-hint">
          当前密钥长度：<code>{hmacKeyInfo.bits}</code> 位 · 推荐至少 <code>{algInfo.minKeyBits}</code> 位
          {hmacKeyInfo.warn && <span className="jwts__warn-text"> ⚠ {hmacKeyInfo.warn}</span>}
        </p>
      </div>
    );
  } else if (algCategory === 'rsa') {
    keyInputPanel = (
      <div className="jwts__key-area">
        <div className="jwts__key-head">
          <label htmlFor="jwts-rsa-key" className="jwts__label">RSA 私钥（PEM 或 JWK）</label>
          <div className="jwts__rsa-gen">
            <select
              value={String(rsaBits)}
              onChange={(e) => setRsaBits(Number(e.target.value) as RsaBits)}
              className="jwts__select"
              aria-label="RSA 密钥位数"
            >
              <option value="2048">2048 位</option>
              <option value="3072">3072 位</option>
              <option value="4096">4096 位</option>
            </select>
            <button
              type="button"
              className="btn btn--sm"
              onClick={handleGenRsaKey}
              disabled={genKeyStatus === 'generating'}
            >
              {genKeyStatus === 'generating' ? '生成中…' : '生成新密钥对'}
            </button>
          </div>
        </div>
        <textarea
          id="jwts-rsa-key"
          className="jwts__rsa-input"
          placeholder="粘贴 PEM 格式（-----BEGIN ... PRIVATE KEY-----）或 JWK 格式（JSON 对象）的 RSA 私钥…"
          value={rsaKeyInput}
          onChange={(e) => setRsaKeyInput(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          rows={6}
        />
        {genKeyStatus === 'error' && (
          <p className="jwts__error-text">密钥生成失败：{genKeyError}</p>
        )}
        {generatedKeyPair && (
          <div className="jwts__keypair">
            <div className="jwts__keypair-head">
              <span className="jwts__keypair-title">
                已生成 {generatedKeyPair.bits} 位 RSA 密钥对（仅本地保存，关闭页面即丢失）
              </span>
              <div className="jwts__keypair-tabs">
                <button
                  type="button"
                  className={`jwts__tab${keyViewFormat === 'pem' ? ' jwts__tab--active' : ''}`}
                  onClick={() => setKeyViewFormat('pem')}
                >PEM</button>
                <button
                  type="button"
                  className={`jwts__tab${keyViewFormat === 'jwk' ? ' jwts__tab--active' : ''}`}
                  onClick={() => setKeyViewFormat('jwk')}
                >JWK</button>
              </div>
            </div>
            <div className="jwts__keypair-body">
              <details open>
                <summary>公钥（用于验签，可公开分发）</summary>
                <pre className="jwts__key-pre">
                  <code>{keyViewFormat === 'pem'
                    ? generatedKeyPair.publicPem
                    : JSON.stringify(generatedKeyPair.publicJwk, null, 2)}
                  </code>
                </pre>
              </details>
              <details>
                <summary>私钥（用于签名，请妥善保管，切勿泄露）</summary>
                <pre className="jwts__key-pre">
                  <code>{keyViewFormat === 'pem'
                    ? generatedKeyPair.privatePem
                    : JSON.stringify(generatedKeyPair.privateJwk, null, 2)}
                  </code>
                </pre>
              </details>
            </div>
          </div>
        )}
      </div>
    );
  } else if (algCategory === 'none') {
    keyInputPanel = (
      <div className="jwts__key-area jwts__key-area--none">
        <p className="jwts__none-hint">
          <code>none</code> 算法不使用密钥，生成的 JWT 第三段（签名）为空字符串。
          任何人都可伪造此类令牌，<strong>仅用于本地调试与教学演示，严禁用于生产环境</strong>。
        </p>
      </div>
    );
  } else if (algCategory === 'ec') {
    keyInputPanel = (
      <div className="jwts__key-area">
        <div className="jwts__key-head">
          <label htmlFor="jwts-ec-key" className="jwts__label">EC 私钥（PEM 或 JWK）</label>
          <div className="jwts__rsa-gen">
            <select
              value={ecCurve}
              onChange={(e) => setEcCurve(e.target.value as EcCurveOption)}
              className="jwts__select"
              aria-label="椭圆曲线"
            >
              <option value="P-256">P-256（对应 ES256）</option>
              <option value="P-384">P-384（对应 ES384）</option>
              <option value="P-521">P-521（对应 ES512）</option>
            </select>
            <button
              type="button"
              className="btn btn--sm"
              onClick={handleGenEcKey}
              disabled={genEcStatus === 'generating'}
            >
              {genEcStatus === 'generating' ? '生成中…' : '生成新密钥对'}
            </button>
          </div>
        </div>
        <textarea
          id="jwts-ec-key"
          className="jwts__rsa-input"
          placeholder="粘贴 PEM 格式（-----BEGIN ... PRIVATE KEY-----）或 JWK 格式（JSON 对象）的 EC 私钥…"
          value={ecKeyInput}
          onChange={(e) => setEcKeyInput(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          rows={6}
        />
        {genEcStatus === 'error' && (
          <p className="jwts__error-text">密钥生成失败：{genEcError}</p>
        )}
        {generatedEcKeyPair && (
          <div className="jwts__keypair">
            <div className="jwts__keypair-head">
              <span className="jwts__keypair-title">
                已生成 {generatedEcKeyPair.curve} 椭圆曲线密钥对（{generatedEcKeyPair.bits} 位，仅本地保存，关闭页面即丢失）
              </span>
              <div className="jwts__keypair-tabs">
                <button
                  type="button"
                  className={`jwts__tab${keyViewFormat === 'pem' ? ' jwts__tab--active' : ''}`}
                  onClick={() => setKeyViewFormat('pem')}
                >PEM</button>
                <button
                  type="button"
                  className={`jwts__tab${keyViewFormat === 'jwk' ? ' jwts__tab--active' : ''}`}
                  onClick={() => setKeyViewFormat('jwk')}
                >JWK</button>
              </div>
            </div>
            <div className="jwts__keypair-body">
              <details open>
                <summary>公钥（用于验签，可公开分发）</summary>
                <pre className="jwts__key-pre">
                  <code>{keyViewFormat === 'pem'
                    ? generatedEcKeyPair.publicPem
                    : JSON.stringify(generatedEcKeyPair.publicJwk, null, 2)}
                  </code>
                </pre>
              </details>
              <details>
                <summary>私钥（用于签名，请妥善保管，切勿泄露）</summary>
                <pre className="jwts__key-pre">
                  <code>{keyViewFormat === 'pem'
                    ? generatedEcKeyPair.privatePem
                    : JSON.stringify(generatedEcKeyPair.privateJwk, null, 2)}
                  </code>
                </pre>
              </details>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="jsontool jwts">
      {/* 算法选择 */}
      <div className="jwts__section">
        <label className="jwts__label">签名算法</label>
        {algButtons}
        {algDescPanel}
      </div>

      {/* Header 编辑 */}
      <div className="jwts__section">
        <div className="jwts__section-head">
          <label htmlFor="jwts-header" className="jwts__label">
            Header（JSON 对象，<code>alg</code> 由算法选择器决定，可省略）
          </label>
          {!headerCheck.ok && headerText.trim() !== '' && (
            <span className="jwts__error-text">{headerCheck.error}</span>
          )}
        </div>
        <textarea
          id="jwts-header"
          className="jwts__json-input"
          value={headerText}
          onChange={(e) => setHeaderText(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          rows={4}
          aria-invalid={!headerCheck.ok}
        />
      </div>

      {/* Payload 编辑 */}
      <div className="jwts__section">
        <div className="jwts__section-head">
          <label htmlFor="jwts-payload" className="jwts__label">
            Payload（JSON 对象，JWT 声明集合）
          </label>
          {!payloadCheck.ok && payloadText.trim() !== '' && (
            <span className="jwts__error-text">{payloadCheck.error}</span>
          )}
        </div>
        <textarea
          id="jwts-payload"
          className="jwts__json-input"
          value={payloadText}
          onChange={(e) => setPayloadText(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          rows={10}
          aria-invalid={!payloadCheck.ok}
        />
        {/* 标准声明字段速查 */}
        <details className="jwts__claims-ref">
          <summary>标准声明字段速查（点击展开）</summary>
          <ul>
            {Object.entries(CLAIM_DESC).map(([k, v]) => (
              <li key={k}><code>{k}</code> · {v}</li>
            ))}
          </ul>
        </details>
      </div>

      {/* 密钥输入 */}
      <div className="jwts__section">{keyInputPanel}</div>

      {/* 操作按钮 */}
      <div className="jwts__actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={handleSign}
          disabled={!canSign}
        >
          {signing ? '签名中…' : '签发 JWT'}
        </button>
        <button type="button" className="btn" onClick={handleSample}>载入示例</button>
        <button type="button" className="btn" onClick={handleClear}>清空</button>
      </div>

      {/* none 算法警告 */}
      {alg === 'none' && signResult?.ok && (
        <div className="jwts__alert" role="alert">
          <strong>⚠ 安全警告：</strong>
          此 JWT 使用 <code>alg=none</code>（无签名），任何人都能伪造令牌内容。
          <strong>严禁用于生产环境</strong>。请改用 HS256 / RS256 等带签名算法。
          详见 <a href="/blog/jwt-security-best-practices" className="jwts__alert-link">JWT 安全实践</a>。
        </div>
      )}

      {/* 签名结果 */}
      {signResult && signResult.ok && (
        <div className="jwts__result">
          {/* 完整 JWT */}
          <div className="jwts__result-row jwts__result-row--token">
            <div className="jwts__result-head">
              <span className="jwts__result-label">完整 JWT</span>
              <button
                type="button"
                className="jwts__copy-btn"
                onClick={() => handleCopy('token')}
                aria-label="复制完整 JWT"
              >{copiedTarget === 'token' ? '已复制' : '复制'}</button>
            </div>
            <pre className="jwts__token-pre"><code>{signResult.token}</code></pre>
            <p className="jwts__token-info">
              共 <code>{signResult.token?.length || 0}</code> 字符 ·
              签名段 <code>{signResult.signatureBytes}</code> 字节
              （base64url 编码后 <code>{signResult.signatureB64?.length || 0}</code> 字符）
            </p>
          </div>

          {/* 三段拆分展示 */}
          <div className="jwts__segments">
            <div className="jwts__seg jwts__seg--header">
              <div className="jwts__seg-head">
                <span className="jwts__seg-tag jwts__seg-tag--header">Header</span>
                <button
                  type="button"
                  className="jwts__copy-btn"
                  onClick={() => handleCopy('header')}
                  aria-label="复制 Header JSON"
                >{copiedTarget === 'header' ? '已复制' : '复制'}</button>
              </div>
              <pre className="jwts__seg-json"><code>{signResult.headerJson}</code></pre>
              <p className="jwts__seg-b64">base64url: <code>{signResult.headerB64}</code></p>
            </div>

            <div className="jwts__seg jwts__seg--payload">
              <div className="jwts__seg-head">
                <span className="jwts__seg-tag jwts__seg-tag--payload">Payload</span>
                <button
                  type="button"
                  className="jwts__copy-btn"
                  onClick={() => handleCopy('payload')}
                  aria-label="复制 Payload JSON"
                >{copiedTarget === 'payload' ? '已复制' : '复制'}</button>
              </div>
              <pre className="jwts__seg-json"><code>{signResult.payloadJson}</code></pre>
              <p className="jwts__seg-b64">base64url: <code>{signResult.payloadB64}</code></p>
            </div>

            <div className="jwts__seg jwts__seg--signature">
              <div className="jwts__seg-head">
                <span className="jwts__seg-tag jwts__seg-tag--signature">Signature</span>
                <button
                  type="button"
                  className="jwts__copy-btn"
                  onClick={() => handleCopy('signature')}
                  aria-label="复制 Signature base64url"
                >{copiedTarget === 'signature' ? '已复制' : '复制'}</button>
              </div>
              <div className="jwts__sig-value">
                {signResult.signatureB64 || '（空，none 算法无签名）'}
              </div>
            </div>
          </div>

          {/* 后续操作提示 */}
          <p className="jwts__next-hint">
            可将生成的 JWT 粘贴到 <a href="/jwt">JWT 解码工具</a> 验证格式，
            或粘贴到 <a href="/jwe">JWE 解码工具</a> 查看是否被加密保护。
          </p>
        </div>
      )}

      {/* 签名错误 */}
      {signResult && !signResult.ok && signResult.error && (
        <div className="jwts__error" role="alert">
          <strong>签名失败：</strong>{signResult.error}
        </div>
      )}

      {/* 状态提示 */}
      {notice && (
        <div className="jwts__notice" role="status" aria-live="polite">{notice}</div>
      )}
    </div>
  );
}
