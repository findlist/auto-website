import { useState, useMemo, useCallback } from 'react';
import type { ReactNode } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * JWT 解码工具
 * 全部在浏览器本地解码，不发起任何网络请求，也不验证签名（仅解码展示）。
 *
 * 功能：
 *  - 解析三段式 JWT（header.payload.signature）
 *  - Header 与 Payload 自动 base64url 解码并 JSON 美化
 *  - 标准声明字段高亮（iss/sub/aud/exp/nbf/iat/jti 等）
 *  - 过期时间检查：未过期 / 即将过期 / 已过期 / 无 exp
 *  - 算法说明（HS256/RS256/ES256/none 等）
 *  - 复制各段 / 复制解码后 JSON
 *  - 输入即解析，无需点击按钮
 *
 * 安全策略：
 *  - 仅解码不验签：本工具不持有密钥，无法验证签名真实性
 *  - 输入长度上限 20000 字符（防止超长 token 卡顿）
 *  - 解码失败显示具体错误（哪一段、什么原因）
 *  - 不展示签名密钥提示，避免误导用户认为已验签
 */

type Segment = 'header' | 'payload' | 'signature';

interface DecodedPart {
  ok: boolean;            // 是否解码成功
  raw: string;            // 原始 base64url 字符串
  json: string | null;    // 美化后的 JSON（header/payload），signature 为 null
  obj: unknown;           // 解析后的对象（header/payload），signature 为 null
  error: string;          // 解码失败原因
}

interface JwtDecoded {
  ok: boolean;            // 整体是否可解析（至少 header + payload 解码成功）
  header: DecodedPart;
  payload: DecodedPart;
  signature: DecodedPart;
  error: string;          // 整体错误（如格式不对、段数不对）
}

/** 标准声明字段说明（RFC 7519） */
const CLAIM_DESC: Record<string, string> = {
  iss: '签发者（Issuer）',
  sub: '主题（Subject）',
  aud: '受众（Audience）',
  exp: '过期时间（Expiration Time）',
  nbf: '生效时间（Not Before）',
  iat: '签发时间（Issued At）',
  jti: '唯一标识（JWT ID）',
};

/** 算法说明 */
const ALG_DESC: Record<string, string> = {
  none: '无签名（不安全，仅用于调试）',
  HS256: 'HMAC + SHA-256（对称密钥）',
  HS384: 'HMAC + SHA-384（对称密钥）',
  HS512: 'HMAC + SHA-512（对称密钥）',
  RS256: 'RSA + SHA-256（非对称，公钥验签）',
  RS384: 'RSA + SHA-384（非对称，公钥验签）',
  RS512: 'RSA + SHA-512（非对称，公钥验签）',
  ES256: 'ECDSA + SHA-256（椭圆曲线，更短密钥）',
  ES384: 'ECDSA + SHA-384（椭圆曲线）',
  ES512: 'ECDSA + SHA-512（椭圆曲线）',
  PS256: 'RSA-PSS + SHA-256（更安全的 RSA 变体）',
  PS384: 'RSA-PSS + SHA-384',
  PS512: 'RSA-PSS + SHA-512',
};

/** 算法安全等级：用于在 UI 中显眼提示不安全算法 */
const ALG_SECURITY: Record<string, 'insecure' | 'warning' | 'safe'> = {
  none: 'insecure',  // 无签名，严禁生产使用
  HS256: 'safe',
  HS384: 'safe',
  HS512: 'safe',
  RS256: 'safe',
  RS384: 'safe',
  RS512: 'safe',
  ES256: 'safe',
  ES384: 'safe',
  ES512: 'safe',
  PS256: 'safe',
  PS384: 'safe',
  PS512: 'safe',
};

/**
 * 签名段长度参考（base64url 编码后字符数）
 * 仅 HMAC 系列长度固定，RSA/ECDSA 长度取决于密钥长度，给出常见值范围
 * 用于辅助用户快速判断 token 是否被截断
 */
const SIG_LENGTH_HINT: Record<string, string> = {
  none: '0 字符（无签名）',
  HS256: '约 43 字符（256 位 HMAC）',
  HS384: '约 64 字符（384 位 HMAC）',
  HS512: '约 86 字符（512 位 HMAC）',
  RS256: '约 344 字符（2048 位 RSA）',
  RS384: '约 344 字符（2048 位 RSA）',
  RS512: '约 344 字符（2048 位 RSA）',
  ES256: '约 86 字符（256 位 ECDSA）',
  ES384: '约 128 字符（384 位 ECDSA）',
  ES512: '约 172 字符（512 位 ECDSA）',
};

/** 示例 JWT：HS256 算法 + 完整标准声明字段，便于演示 */
const SAMPLE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJpc3MiOiJ0b29sYm94LmV4YW1wbGUuY29tIiwic3ViIjoiMTAwMDEiLCJhdWQiOiJhcGkudG9vbGJveC5leGFtcGxlLmNvbSIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoxOTAwMDAwMDAwLCJuYmYiOjE3MDAwMDAwMDAsImp0aSI6ImFiYzEyMy1kZWYtNDU2In0.' +
  'c2lnbmF0dXJlX2RlbW9fZm9yX3Rlc3Rfb25seV9kb19ub3RfdXNlX2luX3Byb2R1Y3Rpb24';

/**
 * 不安全示例 JWT：alg=none 无签名
 * 用于演示 alg=none 安全警告（严禁生产使用）
 * Header: {"alg":"none","typ":"JWT"}
 * Payload: {"iss":"toolbox.example.com","sub":"10001","iat":1700000000,"exp":1900000000,"jti":"insecure-demo"}
 */
const SAMPLE_INSECURE_JWT =
  'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.' +
  'eyJpc3MiOiJ0b29sYm94LmV4YW1wbGUuY29tIiwic3ViIjoiMTAwMDEiLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MTkwMDAwMDAwMCwianRpIjoiaW5zZWN1cmUtZGVtbyJ9.' +
  'aW5zZWN1cmUtZW1wdHktc2lnbmF0dXJl';

/** 输入长度上限：防止超长 token 解码卡顿 */
const MAX_INPUT_LENGTH = 20000;

/**
 * base64url 解码为字符串
 * base64url 用 - 替换 +，用 _ 替换 /，且通常省略 padding
 */
function base64urlDecode(input: string): string {
  // 还原为标准 base64：- → +，_ → /
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  // 补齐 padding 至 4 的倍数
  const pad = base64.length % 4;
  if (pad) {
    base64 += '='.repeat(4 - pad);
  }
  // atob 解码为二进制字符串，再按 UTF-8 解码（支持中文/Emoji）
  const binary = atob(base64);
  // 处理多字节字符：将二进制字符串转为 Uint8Array 再用 TextDecoder 解码
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/** 解码单段：header/payload 走 base64url + JSON.parse，signature 仅展示原始值 */
function decodePart(seg: string, type: Segment): DecodedPart {
  if (seg === '') {
    return { ok: false, raw: '', json: null, obj: null, error: '段为空' };
  }
  if (type === 'signature') {
    // 签名段不解码，仅展示原始 base64url 字符串
    return { ok: true, raw: seg, json: null, obj: null, error: '' };
  }
  try {
    const decoded = base64urlDecode(seg);
    try {
      const obj = JSON.parse(decoded);
      return {
        ok: true,
        raw: seg,
        json: JSON.stringify(obj, null, 2),
        obj,
        error: '',
      };
    } catch {
      // base64url 解码成功但不是合法 JSON
      return {
        ok: false,
        raw: seg,
        json: null,
        obj: null,
        error: `解码后不是合法 JSON：${decoded.slice(0, 50)}${decoded.length > 50 ? '…' : ''}`,
      };
    }
  } catch (e) {
    return {
      ok: false,
      raw: seg,
      json: null,
      obj: null,
      error: `base64url 解码失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** 解析整个 JWT 字符串 */
function decodeJwt(input: string): JwtDecoded {
  const empty: DecodedPart = { ok: false, raw: '', json: null, obj: null, error: '' };
  if (input.trim() === '') {
    return { ok: false, header: empty, payload: empty, signature: empty, error: '请输入 JWT' };
  }
  // 去除首尾空白与可能的 Bearer 前缀
  const trimmed = input.trim().replace(/^Bearer\s+/i, '');
  const parts = trimmed.split('.');
  // 接受 2 段（header.payload，无签名）或 3 段（header.payload.signature），与验签工具一致
  if (parts.length < 2) {
    return {
      ok: false,
      header: empty,
      payload: empty,
      signature: empty,
      error: `JWT 应包含 2 或 3 段（用 . 分隔），当前 ${parts.length} 段`,
    };
  }
  const header = decodePart(parts[0], 'header');
  const payload = decodePart(parts[1], 'payload');
  // 两段 JWT 无签名段，用空字符串占位（decodePart 返回 ok:false 并提示「段为空」）
  const signature = decodePart(parts[2] ?? '', 'signature');
  const ok = header.ok && payload.ok;
  return {
    ok,
    header,
    payload,
    signature,
    error: ok ? '' : `${!header.ok ? 'Header 段' : 'Payload 段'}解码失败`,
  };
}


type ExpiryStatus = 'no-exp' | 'valid' | 'expiring' | 'expired';

/** 计算过期状态：未过期 / 即将过期 / 已过期 / 无 exp */
function getExpiryStatus(payloadObj: unknown): {
  status: ExpiryStatus;
  expDate: Date | null;
  remainMs: number;
  message: string;
} {
  if (!payloadObj || typeof payloadObj !== 'object') {
    return { status: 'no-exp', expDate: null, remainMs: 0, message: '无 exp 字段' };
  }
  const obj = payloadObj as Record<string, unknown>;
  const exp = obj.exp;
  if (typeof exp !== 'number') {
    return { status: 'no-exp', expDate: null, remainMs: 0, message: '无 exp 字段' };
  }
  // JWT exp 是 Unix 秒级时间戳
  const expDate = new Date(exp * 1000);
  const now = Date.now();
  const remainMs = expDate.getTime() - now;
  if (remainMs < 0) {
    return { status: 'expired', expDate, remainMs, message: `已于 ${expDate.toLocaleString('zh-CN')} 过期` };
  }
  // 24 小时内即将过期
  if (remainMs < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(remainMs / (60 * 60 * 1000));
    return { status: 'expiring', expDate, remainMs, message: `即将过期（剩余约 ${hours} 小时）` };
  }
  return { status: 'valid', expDate, remainMs, message: `有效期至 ${expDate.toLocaleString('zh-CN')}` };
}

/** 时间字段信息：绝对时间 + 相对时间（剩余/已过期 X 天 Y 小时） */
interface TimeFieldInfo {
  absolute: string;   // 本地化时间字符串，如「2026/1/1 12:00:00」
  relative: string;   // 相对时间，如「剩余 2 天 5 小时」「已过期 3 天」「X 天前」
  isFuture: boolean;  // 是否为未来时间（用于颜色区分）
}

/**
 * 格式化时间戳字段（iat/exp/nbf）为可读时间 + 相对时间
 * 相对时间分三种语义：
 *  - exp/nbf 未来时间：显示「剩余 X 天 Y 小时」
 *  - exp 已过期：显示「已过期 X 天 Y 小时」
 *  - iat 历史时间：显示「X 天前」
 */
function formatTimeField(value: unknown, isExpiryLike = false): TimeFieldInfo | null {
  if (typeof value !== 'number') return null;
  const d = new Date(value * 1000);
  if (Number.isNaN(d.getTime())) return null;
  const absolute = d.toLocaleString('zh-CN');
  const now = Date.now();
  const diffMs = d.getTime() - now;
  const isFuture = diffMs > 0;
  const absMs = Math.abs(diffMs);
  // 拆分为天/小时/分钟
  const days = Math.floor(absMs / (24 * 60 * 60 * 1000));
  const hours = Math.floor((absMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((absMs % (60 * 60 * 1000)) / (60 * 1000));
  let relative: string;
  if (days > 0) {
    const tail = hours > 0 ? ` ${hours} 小时` : '';
    relative = isFuture ? `剩余 ${days} 天${tail}` : `已过期 ${days} 天${tail}`;
  } else if (hours > 0) {
    const tail = minutes > 0 ? ` ${minutes} 分钟` : '';
    relative = isFuture ? `剩余 ${hours} 小时${tail}` : `已过期 ${hours} 小时${tail}`;
  } else if (minutes > 0) {
    relative = isFuture ? `剩余 ${minutes} 分钟` : `已过期 ${minutes} 分钟`;
  } else {
    relative = isFuture ? '即将到期' : '刚刚过期';
  }
  // 非过期型历史时间（如 iat）显示「X 天前」
  if (!isFuture && !isExpiryLike) {
    if (days > 0) relative = `${days} 天前`;
    else if (hours > 0) relative = `${hours} 小时前`;
    else relative = '刚刚';
  }
  return { absolute, relative, isFuture };
}

/** 标准声明中属于时间型字段（用于触发相对时间显示） */
const TIME_CLAIMS = new Set(['exp', 'nbf', 'iat']);

interface PayloadField {
  key: string;
  value: unknown;
  isStandard: boolean;
  timeInfo: TimeFieldInfo | null;
  claimDesc: string;
  isComplex: boolean;       // 是否为对象/数组（需多行美化展示）
  formattedValue: string;   // 美化后的字符串值（对象/数组用 JSON.stringify 2 空格）
}

export default function JwtTool() {
  const [input, setInput] = useState<string>('');
  const [notice, setNotice] = useState<string>('');
  const [copiedSeg, setCopiedSeg] = useState<Segment | null>(null);

  // 实时解析：输入即解码，无需点击按钮
  // 超长输入真正截断后再解码，与「仅解析前 N 字符」提示一致（防止超长 token 解码卡顿）
  const decoded = useMemo<JwtDecoded>(() => decodeJwt(input.slice(0, MAX_INPUT_LENGTH)), [input]);

  // 过期状态（基于 payload）
  const expiry = useMemo(() => getExpiryStatus(decoded.payload.obj), [decoded.payload.obj]);

  // 算法说明（基于 header.alg）：含安全等级与签名长度提示
  const algDesc = useMemo(() => {
    const header = decoded.header.obj;
    if (!header || typeof header !== 'object') return null;
    const alg = (header as Record<string, unknown>).alg;
    if (typeof alg !== 'string') return null;
    return {
      alg,
      desc: ALG_DESC[alg] || '未知算法',
      security: ALG_SECURITY[alg] || 'warning',  // 未知算法默认 warning
      sigHint: SIG_LENGTH_HINT[alg] || '',       // 签名预期长度
    };
  }, [decoded.header.obj]);

  // 输入超限提示
  const overLimit = input.length > MAX_INPUT_LENGTH;

  /** 载入示例（HS256 安全算法） */
  const handleSample = useCallback(() => {
    setInput(SAMPLE_JWT);
    setNotice('');
    setCopiedSeg(null);
  }, []);

  /** 载入不安全示例（alg=none，触发安全警告演示） */
  const handleSampleInsecure = useCallback(() => {
    setInput(SAMPLE_INSECURE_JWT);
    setNotice('');
    setCopiedSeg(null);
  }, []);

  /** 清空 */
  const handleClear = useCallback(() => {
    setInput('');
    setNotice('');
    setCopiedSeg(null);
  }, []);

  /** 复制指定段 */
  const handleCopy = useCallback(async (seg: Segment) => {
    let text = '';
    if (seg === 'header') text = decoded.header.json || decoded.header.raw;
    else if (seg === 'payload') text = decoded.payload.json || decoded.payload.raw;
    else if (seg === 'signature') text = decoded.signature.raw;
    if (!text) return;
    const ok = await copyText(text);
    if (ok) {
      setCopiedSeg(seg);
      setNotice('已复制到剪贴板');
      setTimeout(() => {
        setCopiedSeg(null);
        setNotice('');
      }, 1500);
    } else {
      setNotice('复制失败，请手动选中复制');
    }
  }, [decoded]);

  // 渲染 Payload 字段：标准声明字段高亮 + 时间字段格式化 + 对象/数组美化
  const payloadFields = useMemo<PayloadField[] | null>(() => {
    if (!decoded.payload.ok || !decoded.payload.obj) return null;
    const obj = decoded.payload.obj as Record<string, unknown>;
    return Object.entries(obj).map(([key, value]) => {
      const isStandard = key in CLAIM_DESC;
      // 时间字段：exp/nbf 视为过期型（未来显示「剩余」、过去显示「已过期」）；iat 视为签发型（过去显示「X 天前」）
      const isExpiryLike = key === 'exp' || key === 'nbf';
      const timeInfo = TIME_CLAIMS.has(key) ? formatTimeField(value, isExpiryLike) : null;
      const claimDesc = isStandard ? CLAIM_DESC[key] : '';
      // 对象/数组用 JSON 美化多行展示，原始值直接 String() 转换
      const isComplex = (typeof value === 'object' && value !== null);
      const formattedValue = isComplex
        ? JSON.stringify(value, null, 2)
        : String(value);
      return { key, value, isStandard, timeInfo, claimDesc, isComplex, formattedValue };
    });
  }, [decoded.payload]);

  const inputLength = input.length;
  const hasInput = input.trim() !== '';

  // 提示信息片段：字符计数与超限警告
  const hintParts: ReactNode[] = ['输入即自动解码。仅解码展示，不验证签名真实性。'];
  if (inputLength > 0) hintParts.push(`（${inputLength} 字符）`);
  if (overLimit) {
    hintParts.push(
      <span className="jwttool__warn" key="warn">
        {` 已超上限（${MAX_INPUT_LENGTH}），仅解析前 ${MAX_INPUT_LENGTH} 字符`}
      </span>
    );
  }

  return (
    <div className="jsontool jwttool">
      {/* 输入区 */}
      <div className="jwttool__input-area">
        <div className="jwttool__input-head">
          <label htmlFor="jwt-input" className="jwttool__label">JWT 字符串</label>
          <div className="jsontool__actions">
            <button type="button" className="btn btn--sm" onClick={handleSample}>示例</button>
            <button type="button" className="btn btn--sm jwttool__btn-insecure" onClick={handleSampleInsecure} title="载入 alg=none 不安全示例，演示安全警告">不安全示例</button>
            <button type="button" className="btn btn--sm" onClick={handleClear}>清空</button>
          </div>
        </div>
        <textarea
          id="jwt-input"
          className="jwttool__input"
          placeholder="粘贴 JWT 字符串（以 eyJ 开头，用 . 分隔三段）…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          aria-describedby="jwt-input-hint"
        />
        <p id="jwt-input-hint" className="jwttool__hint">{hintParts}</p>
      </div>

      {/* 整体错误提示 */}
      {hasInput && !decoded.ok && decoded.error && (
        <div className="jwttool__error" role="alert">
          <strong>解析失败：</strong>{decoded.error}
        </div>
      )}

      {/* 过期状态与算法信息（解码成功时显示） */}
      {decoded.ok && (
        <div className="jwttool__meta">
          {algDesc && (
            <div className={`jwttool__meta-item jwttool__meta-item--alg jwttool__meta-item--sec-${algDesc.security}`}>
              <span className="jwttool__meta-label">算法</span>
              <span className="jwttool__meta-value">
                <code>{algDesc.alg}</code> · {algDesc.desc}
              </span>
            </div>
          )}
          <div className={`jwttool__meta-item jwttool__meta-item--${expiry.status}`}>
            <span className="jwttool__meta-label">过期状态</span>
            <span className="jwttool__meta-value">{expiry.message}</span>
          </div>
        </div>
      )}

      {/* none 算法安全警告：alg=none 严禁生产使用 */}
      {decoded.ok && algDesc && algDesc.security === 'insecure' && (
        <div className="jwttool__alert" role="alert">
          <strong>⚠ 安全警告：</strong>
          当前 JWT 使用 <code>alg=none</code>（无签名），任何人都能伪造令牌内容。
          此算法仅用于本地调试，<strong>严禁用于生产环境</strong>。
          请改用 HS256 / RS256 / ES256 等带签名的算法。详见
          <a href="/blog/jwt-security-best-practices" className="jwttool__alert-link">JWT 安全实践</a>。
        </div>
      )}

      {/* 三段彩色展示 */}
      {hasInput && (
        <div className="jwttool__segments" aria-label="JWT 三段展示">
          <div className="jwttool__seg jwttool__seg--header">
            <div className="jwttool__seg-head">
              <span className="jwttool__seg-tag jwttool__seg-tag--header">Header</span>
              <span className="jwttool__seg-desc">头部（算法与令牌类型）</span>
              {decoded.header.ok && (
                <button
                  type="button"
                  className="jwttool__copy-btn"
                  onClick={() => handleCopy('header')}
                  aria-label="复制 Header 解码结果"
                >{copiedSeg === 'header' ? '已复制' : '复制'}</button>
              )}
            </div>
            {decoded.header.ok ? (
              <pre className="jwttool__seg-json"><code>{decoded.header.json}</code></pre>
            ) : (
              <div className="jwttool__seg-error">{decoded.header.error}</div>
            )}
          </div>

          <div className="jwttool__seg jwttool__seg--payload">
            <div className="jwttool__seg-head">
              <span className="jwttool__seg-tag jwttool__seg-tag--payload">Payload</span>
              <span className="jwttool__seg-desc">载荷（声明信息）</span>
              {decoded.payload.ok && (
                <button
                  type="button"
                  className="jwttool__copy-btn"
                  onClick={() => handleCopy('payload')}
                  aria-label="复制 Payload 解码结果"
                >{copiedSeg === 'payload' ? '已复制' : '复制'}</button>
              )}
            </div>
            {decoded.payload.ok ? (
              <>
                <pre className="jwttool__seg-json"><code>{decoded.payload.json}</code></pre>
                {payloadFields && payloadFields.length > 0 && (
                  <ul className="jwttool__claims" aria-label="字段说明">
                    {payloadFields.map((f) => (
                      <li
                        key={f.key}
                        className={`jwttool__claim${f.isStandard ? ' jwttool__claim--standard' : ''}`}
                      >
                        <code className="jwttool__claim-key">{f.key}</code>
                        <div className="jwttool__claim-value">
                          {f.isComplex ? (
                            <pre className="jwttool__claim-json"><code>{f.formattedValue}</code></pre>
                          ) : (
                            <span className="jwttool__claim-text">{f.formattedValue}</span>
                          )}
                          {f.timeInfo && (
                            <em className={`jwttool__claim-time jwttool__claim-time--${f.timeInfo.isFuture ? 'future' : 'past'}`}>
                              → {f.timeInfo.absolute}（{f.timeInfo.relative}）
                            </em>
                          )}
                        </div>
                        {f.claimDesc && <span className="jwttool__claim-desc">{f.claimDesc}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <div className="jwttool__seg-error">{decoded.payload.error}</div>
            )}
          </div>

          <div className="jwttool__seg jwttool__seg--signature">
            <div className="jwttool__seg-head">
              <span className="jwttool__seg-tag jwttool__seg-tag--signature">Signature</span>
              <span className="jwttool__seg-desc">签名（不解码，仅展示）</span>
              {decoded.signature.ok && (
                <button
                  type="button"
                  className="jwttool__copy-btn"
                  onClick={() => handleCopy('signature')}
                  aria-label="复制 Signature 原始值"
                >{copiedSeg === 'signature' ? '已复制' : '复制'}</button>
              )}
            </div>
            {decoded.signature.ok ? (
              <div className="jwttool__sig-value" title="签名原始 base64url 字符串">
                {decoded.signature.raw}
              </div>
            ) : (
              <div className="jwttool__seg-error">{decoded.signature.error}</div>
            )}
            {algDesc && algDesc.sigHint && decoded.signature.ok && (
              <p className="jwttool__sig-hint">
                当前签名长度 <code>{decoded.signature.raw.length}</code> 字符 ·
                {algDesc.alg} 算法预期 {algDesc.sigHint}
                {decoded.signature.raw.length < 10 && (
                  <span className="jwttool__sig-warn"> · 签名过短，可能已被截断</span>
                )}
              </p>
            )}
            <p className="jwttool__sig-note">
              签名是服务器用密钥对 Header + Payload 计算出的摘要，本工具不持有密钥，<strong>不验证签名真实性</strong>。
              请勿仅凭解码成功就信任令牌内容。
            </p>
          </div>
        </div>
      )}

      {/* 状态提示 */}
      {notice && (
        <div className="jwttool__notice" role="status" aria-live="polite">{notice}</div>
      )}
    </div>
  );
}
