import { useState, useMemo, useCallback } from 'react';
import type { ReactNode } from 'react';
import { copyText } from '../utils/clipboard';
import {
  verifyJwt,
  SAMPLE_HMAC_KEY,
  MAX_JWT_INPUT_LENGTH,
  type JwtVerifyResult,
} from '../utils/jwtVerify';
import { ALG_MAP, ALG_LIST, type JwtAlg, type AlgCategory } from '../utils/jwtSign';

/**
 * JWT 签名验证工具
 * 全部在浏览器本地验签，不发起任何网络请求，密钥不离开设备。
 *
 * 功能：
 *  - 粘贴 JWT 自动解析 Header，识别 alg 字段并动态切换密钥输入区
 *  - 支持 HS256/HS384/HS512（HMAC 对称密钥验签）
 *  - 支持 RS256/RS384/RS512（RSA 公钥验签，PEM/JWK 双格式）
 *  - 支持 ES256/ES384/ES512（ECDSA 公钥验签，PEM/JWK 双格式）
 *  - 支持 none 算法识别与安全警告（不进行验签）
 *  - 验签结果分段展示（Header/Payload/Signature + 美化 JSON）
 *  - 自动校验 exp/nbf/iat 时间声明，显示状态徽章与相对时间
 *  - 算法白名单可选（防 alg=none 攻击）
 *
 * 安全策略：
 *  - Web Crypto API 仅在 HTTPS 或 localhost 可用，非安全上下文给出明确提示
 *  - none 算法直接返回失败并显示红色警告
 *  - 密钥输入框 autocomplete="off" 防止泄漏
 *  - 验签失败时区分「签名无效」与「声明不合规」，便于排查
 */

/** HMAC 密钥输入格式 */
type HmacKeyFormat = 'utf8' | 'base64url';

/** 从 JWT Header 实时解析出的算法信息 */
interface DetectedAlg {
  alg: JwtAlg | null;
  category: AlgCategory | null;
  /** 解析错误（如格式错误、JSON 解析失败） */
  error: string;
}

/**
 * 尝试从 JWT 字符串的 Header 段解析 alg 字段
 * 用于实时切换密钥输入区，不抛异常，失败返回 null
 */
function detectAlg(token: string): DetectedAlg {
  const trimmed = token.trim();
  if (!trimmed) {
    return { alg: null, category: null, error: '' };
  }
  const parts = trimmed.split('.');
  if (parts.length < 2) {
    return { alg: null, category: null, error: 'JWT 格式错误：至少需要 2 个点号分隔的段' };
  }
  if (parts.length > 3) {
    return { alg: null, category: null, error: `段数 ${parts.length} 超过 3，可能是 JWE 而非 JWT` };
  }
  const [headerB64] = parts;
  try {
    // base64url 还原
    let base64 = headerB64.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    if (pad) base64 += '='.repeat(4 - pad);
    const jsonText = atob(base64);
    const header = JSON.parse(jsonText);
    if (typeof header !== 'object' || header === null) {
      return { alg: null, category: null, error: 'Header 不是 JSON 对象' };
    }
    const alg = header.alg;
    if (!alg) {
      return { alg: null, category: null, error: 'Header 缺少 alg 字段' };
    }
    if (!ALG_MAP[alg as JwtAlg]) {
      return { alg: null, category: null, error: `不支持的算法：${alg}` };
    }
    const info = ALG_MAP[alg as JwtAlg];
    return { alg: alg as JwtAlg, category: info.category, error: '' };
  } catch (e) {
    return {
      alg: null,
      category: null,
      error: `Header 解析失败：${e instanceof Error ? e.message : ''}`,
    };
  }
}

export default function JwtVerifyTool() {
  // JWT 输入
  const [tokenInput, setTokenInput] = useState<string>('');
  // HMAC 密钥输入
  const [hmacKey, setHmacKey] = useState<string>('');
  // HMAC 密钥格式
  const [hmacKeyFormat, setHmacKeyFormat] = useState<HmacKeyFormat>('utf8');
  // RSA 公钥输入（PEM 或 JWK）
  const [rsaKeyInput, setRsaKeyInput] = useState<string>('');
  // EC 公钥输入（PEM 或 JWK）
  const [ecKeyInput, setEcKeyInput] = useState<string>('');
  // 期望算法（用户明确指定，防御算法混淆攻击；'off' 表示信任 token 声明的 alg）
  const [expectedAlgSelect, setExpectedAlgSelect] = useState<JwtAlg | 'off'>('off');

  // 验签结果
  const [verifyResult, setVerifyResult] = useState<JwtVerifyResult | null>(null);
  // 验签进行中
  const [verifying, setVerifying] = useState<boolean>(false);

  // 提示与复制状态
  const [notice, setNotice] = useState<string>('');
  const [copiedTarget, setCopiedTarget] = useState<string | null>(null);

  /** 实时解析 JWT Header 获取算法 */
  const detected = useMemo<DetectedAlg>(() => detectAlg(tokenInput), [tokenInput]);

  const algInfo = detected.alg ? ALG_MAP[detected.alg] : null;
  const algCategory: AlgCategory | null = detected.category;

  /** 是否可以执行验签 */
  const canVerify = useMemo(() => {
    if (!tokenInput.trim() || verifying) return false;
    if (detected.error) return false;
    if (!detected.alg || !algCategory) return false;
    if (algCategory === 'none') return true; // none 算法无需密钥
    if (algCategory === 'hmac') return hmacKey.trim() !== '';
    if (algCategory === 'rsa') return rsaKeyInput.trim() !== '';
    if (algCategory === 'ec') return ecKeyInput.trim() !== '';
    return false;
  }, [tokenInput, verifying, detected, algCategory, hmacKey, rsaKeyInput, ecKeyInput]);

  /** 执行验签 */
  const handleVerify = useCallback(async () => {
    if (!detected.alg) return;
    setVerifying(true);
    setNotice('');
    setCopiedTarget(null);
    try {
      // 根据算法类别选择密钥输入源
      let keyInput = '';
      let keyFormat: HmacKeyFormat = 'utf8';
      if (algCategory === 'hmac') {
        keyInput = hmacKey;
        keyFormat = hmacKeyFormat;
      } else if (algCategory === 'rsa') {
        keyInput = rsaKeyInput;
      } else if (algCategory === 'ec') {
        keyInput = ecKeyInput;
      }
      // 期望算法校验：用户明确指定期望算法时传入，防御算法混淆攻击（如 RS256 被篡改为 HS256）
      const expectedAlg = expectedAlgSelect === 'off' ? undefined : expectedAlgSelect;
      const result = await verifyJwt(tokenInput, keyInput, keyFormat, expectedAlg);
      setVerifyResult(result);
      if (result.ok) {
        setNotice('验签通过：签名有效且声明合规');
      } else if (!result.error && result.claimChecks) {
        // 签名有效但声明不合规
        setNotice('签名有效但部分声明不合规');
      }
    } catch (e) {
      setVerifyResult({
        ok: false,
        signatureValid: false,
        error: e instanceof Error ? e.message : `验签异常：${String(e)}`,
      });
    } finally {
      setVerifying(false);
    }
  }, [detected, algCategory, hmacKey, hmacKeyFormat, rsaKeyInput, ecKeyInput, tokenInput, expectedAlgSelect]);

  /** 载入示例（HS256 token + 对应密钥） */
  const handleSample = useCallback(async () => {
    // 动态生成一个真实的 HS256 token 用于演示（避免硬编码签名值错误）
    setTokenInput('');
    setHmacKey(SAMPLE_HMAC_KEY);
    setHmacKeyFormat('utf8');
    setRsaKeyInput('');
    setEcKeyInput('');
    setVerifyResult(null);
    setNotice('');
    setCopiedTarget(null);
    // 用 jwtSign 临时生成一个真实可验的 token
    try {
      const { signJwt } = await import('../utils/jwtSign');
      const header = { alg: 'HS256' as JwtAlg, typ: 'JWT' };
      const payload = {
        iss: 'toolbox.example.com',
        sub: '10001',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 小时后过期
        name: '张三',
        role: 'admin',
      };
      const result = await signJwt(header, payload, SAMPLE_HMAC_KEY, 'utf8');
      if (result.ok && result.token) {
        setTokenInput(result.token);
        setNotice('已载入示例 HS256 token 与密钥，点击「验证」即可');
      } else {
        setNotice('示例生成失败，请手动粘贴 JWT');
      }
    } catch (e) {
      setNotice(`示例生成异常：${e instanceof Error ? e.message : ''}`);
    }
  }, []);

  /** 清空 */
  const handleClear = useCallback(() => {
    setTokenInput('');
    setHmacKey('');
    setRsaKeyInput('');
    setEcKeyInput('');
    setVerifyResult(null);
    setNotice('');
    setCopiedTarget(null);
  }, []);

  /** 复制指定内容 */
  const handleCopy = useCallback(async (target: string, text: string) => {
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
  }, []);

  // 算法说明面板
  const algDescPanel: ReactNode = detected.alg && algInfo ? (
    <div className={`jwv__alg-desc jwv__alg-desc--${algInfo.security}`}>
      <strong>{detected.alg}</strong> · {algInfo.desc}
      {algInfo.security === 'insecure' && (
        <span className="jwv__warn-text"> ⚠ 严禁生产使用</span>
      )}
    </div>
  ) : detected.error && tokenInput.trim() ? (
    <div className="jwv__alg-desc jwv__alg-desc--error">
      <strong>解析失败：</strong>{detected.error}
    </div>
  ) : null;

  // 密钥输入区（根据检测到的算法类别动态切换）
  let keyInputPanel: ReactNode = null;
  if (algCategory === 'hmac') {
    keyInputPanel = (
      <div className="jwv__key-area">
        <div className="jwv__key-head">
          <label htmlFor="jwv-hmac-key" className="jwv__label">HMAC 密钥（与签发时相同）</label>
          <div className="jwv__key-format">
            <label className="jwv__radio">
              <input
                type="radio"
                name="hmac-key-format"
                value="utf8"
                checked={hmacKeyFormat === 'utf8'}
                onChange={() => setHmacKeyFormat('utf8')}
              />
              <span>UTF-8 字符串</span>
            </label>
            <label className="jwv__radio">
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
          id="jwv-hmac-key"
          type="text"
          className="jwv__key-input"
          placeholder={hmacKeyFormat === 'utf8' ? '输入签发时使用的密钥字符串…' : '输入 base64url 编码的密钥…'}
          value={hmacKey}
          onChange={(e) => setHmacKey(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="jwv__key-hint">
          HMAC 为对称密钥算法，验签密钥须与签发密钥完全一致。可配合
          <a href="/jwt-sign"> JWT 签名生成器</a> 用相同密钥签发后再来此验证。
        </p>
      </div>
    );
  } else if (algCategory === 'rsa') {
    keyInputPanel = (
      <div className="jwv__key-area">
        <div className="jwv__key-head">
          <label htmlFor="jwv-rsa-key" className="jwv__label">RSA 公钥（PEM 或 JWK）</label>
        </div>
        <textarea
          id="jwv-rsa-key"
          className="jwv__rsa-input"
          placeholder="粘贴 PEM 格式（-----BEGIN PUBLIC KEY-----）或 JWK 格式（JSON 对象）的 RSA 公钥…"
          value={rsaKeyInput}
          onChange={(e) => setRsaKeyInput(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          rows={6}
        />
        <p className="jwv__key-hint">
          RSA 为非对称算法，<strong>私钥签发、公钥验签</strong>。公钥可公开分发，
          可从 <a href="/jwt-sign">JWT 签名生成器</a> 生成的密钥对中复制「公钥」字段。
        </p>
      </div>
    );
  } else if (algCategory === 'ec') {
    keyInputPanel = (
      <div className="jwv__key-area">
        <div className="jwv__key-head">
          <label htmlFor="jwv-ec-key" className="jwv__label">EC 公钥（PEM 或 JWK）</label>
        </div>
        <textarea
          id="jwv-ec-key"
          className="jwv__rsa-input"
          placeholder="粘贴 PEM 格式（-----BEGIN PUBLIC KEY-----）或 JWK 格式（JSON 对象）的 EC 公钥…"
          value={ecKeyInput}
          onChange={(e) => setEcKeyInput(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          rows={6}
        />
        <p className="jwv__key-hint">
          ECDSA 为非对称算法，<strong>私钥签发、公钥验签</strong>。曲线须与算法匹配
          （ES256→P-256 / ES384→P-384 / ES512→P-521）。
        </p>
      </div>
    );
  } else if (algCategory === 'none') {
    keyInputPanel = (
      <div className="jwv__key-area jwv__key-area--none">
        <p className="jwv__none-hint">
          <code>none</code> 算法无签名，<strong>不需要密钥</strong>。
          点击「验证」将显示安全警告——任何人可伪造此类令牌，严禁生产使用。
        </p>
      </div>
    );
  } else if (!detected.error && tokenInput.trim()) {
    keyInputPanel = (
      <div className="jwv__key-area">
        <p className="jwv__key-hint">等待 JWT Header 解析完成…</p>
      </div>
    );
  }

  return (
    <div className="jsontool jwv">
      {/* JWT 输入 */}
      <div className="jwv__section">
        <div className="jwv__section-head">
          <label htmlFor="jwv-token" className="jwv__label">
            JWT 字符串（<code>header.payload.signature</code>）
          </label>
          <span className="jwv__char-count">{tokenInput.length} 字符</span>
        </div>
        <textarea
          id="jwv-token"
          className="jwv__token-input"
          placeholder="粘贴待验证的 JWT 字符串…"
          value={tokenInput}
          onChange={(e) => {
            const v = e.target.value;
            // 长度限制，防止超长 token 卡顿
            if (v.length <= MAX_JWT_INPUT_LENGTH) {
              setTokenInput(v);
            }
          }}
          spellCheck={false}
          autoComplete="off"
          rows={5}
          maxLength={MAX_JWT_INPUT_LENGTH}
        />
        {tokenInput.length > MAX_JWT_INPUT_LENGTH * 0.9 && (
          <p className="jwv__warn-text">⚠ 输入接近长度上限，过长 token 可能导致卡顿</p>
        )}
      </div>

      {/* 检测到的算法 */}
      {algDescPanel && <div className="jwv__section">{algDescPanel}</div>}

      {/* 密钥输入 */}
      {keyInputPanel && <div className="jwv__section">{keyInputPanel}</div>}

      {/* 期望算法校验（防御算法混淆攻击） */}
      {detected.alg && (
        <div className="jwv__section">
          <label htmlFor="jwv-expected-alg" className="jwv__label">期望算法校验</label>
          <select
            id="jwv-expected-alg"
            className="jwv__select"
            value={expectedAlgSelect}
            onChange={(e) => setExpectedAlgSelect(e.target.value as JwtAlg | 'off')}
          >
            <option value="off">不校验（信任 token 声明的 alg）</option>
            {ALG_LIST.filter((a) => a.alg !== 'none').map((a) => (
              <option key={a.alg} value={a.alg}>
                {a.alg}（{a.category === 'hmac' ? 'HMAC 对称' : a.category === 'rsa' ? 'RSA 非对称' : 'ECDSA 椭圆曲线'}）
              </option>
            ))}
          </select>
          <p className="jwv__key-hint">
            防御算法混淆攻击：攻击者可能把 <code>RS256</code> 篡改为 <code>HS256</code>，并用 RSA 公钥当 HMAC 密钥验签以伪造令牌。
            选择你期望的算法，若 token 声明的 alg 不匹配将直接拒绝。<code>none</code> 算法已被独立拦截，无需在此设置。
          </p>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="jwv__actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={handleVerify}
          disabled={!canVerify}
        >
          {verifying ? '验证中…' : '验证签名'}
        </button>
        <button type="button" className="btn" onClick={handleSample}>载入 HS256 示例</button>
        <button type="button" className="btn" onClick={handleClear}>清空</button>
      </div>

      {/* 联动提示 */}
      <p className="jwv__link-hint">
        💡 没有现成 JWT？先用 <a href="/jwt-sign">JWT 签名生成器</a> 签发，
        或用 <a href="/jwt">JWT 解码工具</a> 查看令牌内容（仅解码不验签）。
      </p>

      {/* 验签结果 */}
      {verifyResult && (
        <div className="jwv__result">
          {/* 总体状态徽章 */}
          <div
            className={`jwv__status ${verifyResult.ok ? 'jwv__status--ok' : 'jwv__status--fail'}`}
            role="status"
            aria-live="polite"
          >
            <span className="jwv__status-icon" aria-hidden="true">
              {verifyResult.ok ? '✓' : '✗'}
            </span>
            <span className="jwv__status-text">
              {verifyResult.ok ? '验证通过' : '验证未通过'}
            </span>
            {verifyResult.alg && (
              <span className="jwv__status-alg">算法：{verifyResult.alg}</span>
            )}
          </div>

          {/* 签名验证详情 */}
          {verifyResult.alg && verifyResult.alg !== 'none' && (
            <div className={`jwv__sig-status ${verifyResult.signatureValid ? 'jwv__sig-status--ok' : 'jwv__sig-status--fail'}`}>
              <strong>签名验证：</strong>
              {verifyResult.signatureValid
                ? '✓ 签名有效（密钥与签名匹配）'
                : '✗ 签名无效（密钥不匹配或签名被篡改）'}
            </div>
          )}

          {/* 声明校验徽章 */}
          {verifyResult.claimChecks && verifyResult.claimChecks.length > 0 && (
            <div className="jwv__claims">
              <h3 className="jwv__claims-title">时间声明校验</h3>
              <ul className="jwv__claims-list">
                {verifyResult.claimChecks.map((c) => (
                  <li key={c.field} className={`jwv__claim jwv__claim--${c.status}`}>
                    <span className="jwv__claim-field">{c.field}</span>
                    <span className="jwv__claim-desc">{c.desc}</span>
                    <span className={`jwv__claim-status jwv__claim-status--${c.status}`}>
                      {c.status === 'valid' && '✓ 有效'}
                      {c.status === 'expired' && '✗ 已过期'}
                      {c.status === 'not_yet_valid' && '⏳ 未生效'}
                      {c.status === 'missing' && '○ 缺失'}
                      {c.status === 'invalid' && '✗ 无效'}
                    </span>
                    {c.value !== undefined && (
                      <span className="jwv__claim-value">
                        <code>{c.value}</code>
                        {c.localTime && <em> · {c.localTime}</em>}
                      </span>
                    )}
                    {c.relative && <span className="jwv__claim-relative">{c.relative}</span>}
                    {c.message && <span className="jwv__claim-msg">{c.message}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 三段拆分展示 */}
          {verifyResult.headerJson && (
            <div className="jwv__segments">
              <div className="jwv__seg jwv__seg--header">
                <div className="jwv__seg-head">
                  <span className="jwv__seg-tag jwv__seg-tag--header">Header</span>
                  <button
                    type="button"
                    className="jwv__copy-btn"
                    onClick={() => handleCopy('header', verifyResult.headerJson || '')}
                    aria-label="复制 Header JSON"
                  >{copiedTarget === 'header' ? '已复制' : '复制'}</button>
                </div>
                <pre className="jwv__seg-json"><code>{verifyResult.headerJson}</code></pre>
                <p className="jwv__seg-b64">base64url: <code>{verifyResult.headerB64}</code></p>
              </div>

              {verifyResult.payloadJson && (
                <div className="jwv__seg jwv__seg--payload">
                  <div className="jwv__seg-head">
                    <span className="jwv__seg-tag jwv__seg-tag--payload">Payload</span>
                    <button
                      type="button"
                      className="jwv__copy-btn"
                      onClick={() => handleCopy('payload', verifyResult.payloadJson || '')}
                      aria-label="复制 Payload JSON"
                    >{copiedTarget === 'payload' ? '已复制' : '复制'}</button>
                  </div>
                  <pre className="jwv__seg-json"><code>{verifyResult.payloadJson}</code></pre>
                  <p className="jwv__seg-b64">base64url: <code>{verifyResult.payloadB64}</code></p>
                </div>
              )}

              <div className="jwv__seg jwv__seg--signature">
                <div className="jwv__seg-head">
                  <span className="jwv__seg-tag jwv__seg-tag--signature">Signature</span>
                  <button
                    type="button"
                    className="jwv__copy-btn"
                    onClick={() => handleCopy('signature', verifyResult.signatureB64 || '')}
                    aria-label="复制 Signature base64url"
                  >{copiedTarget === 'signature' ? '已复制' : '复制'}</button>
                </div>
                <div className="jwv__sig-value">
                  {verifyResult.signatureB64 || '（空，none 算法无签名）'}
                </div>
              </div>
            </div>
          )}

          {/* 警告列表 */}
          {verifyResult.warnings && verifyResult.warnings.length > 0 && (
            <div className="jwv__warnings" role="alert">
              <strong>⚠ 警告：</strong>
              <ul>
                {verifyResult.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 错误信息 */}
          {verifyResult.error && (
            <div className="jwv__error" role="alert">
              <strong>错误：</strong>{verifyResult.error}
            </div>
          )}

          {/* 后续操作提示 */}
          {verifyResult.ok && (
            <p className="jwv__next-hint">
              验签通过仅代表签名与密钥匹配且时间声明合规。生产环境还需校验
              <code>iss</code>（签发者）、<code>aud</code>（受众）、<code>jti</code>（防重放）等业务声明。
              详见 <a href="/blog/jwt-signature-verification-guide">JWT 验签实战博客</a>。
            </p>
          )}
        </div>
      )}

      {/* 状态提示 */}
      {notice && !verifyResult?.error && (
        <div className="jwv__notice" role="status" aria-live="polite">{notice}</div>
      )}
    </div>
  );
}
