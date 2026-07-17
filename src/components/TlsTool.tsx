import { useState, useMemo, useCallback, useEffect } from 'react';
import { copyText } from '../utils/clipboard';
import {
  parsePem,
  parseCertificate,
  computeFingerprints,
  exportToOpensslText,
  validateValidity,
  formatKeySize,
  type X509Certificate,
  type PemBlock,
} from '../utils/tls';

/**
 * TLS 证书解析工具组件
 *
 * 全部解析在浏览器本地进行：
 *  - 用户粘贴 PEM 文本 → 解析为 X.509 字段 → 计算指纹 → OpenSSL 风格文本导出
 *  - 不发送任何网络请求，证书内容不离开本机
 *
 * UI 布局：左右两栏（移动端单列）
 *  - 左侧：PEM 输入区 + 操作按钮（解析 / 清空 / 加载示例 / 文件上传）
 *  - 右侧：解析结果（Tab 切换：字段详情 / OpenSSL 文本 / 原始 PEM）
 */

/** 单个证书的解析结果（含指纹） */
interface ParsedCert {
  /** PEM 块元信息 */
  block: PemBlock;
  /** 解析后的 X.509 证书 */
  cert: X509Certificate;
  /** SHA-256 指纹 */
  fingerprintSha256: string;
  /** SHA-1 指纹 */
  fingerprintSha1: string;
}

/** 内置示例：自签测试证书（仅用于演示，非生产可用） */
const SAMPLE_PEM = `-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfMHdh3PvSl
Y2JtOk5u7roZsJFA4QJdkVPbvB2gJLcxqrxq9to3vGwtxnGv/zemg9YDzc3lZQ8H
l8dz3xNQWQQWps3VDFQp1xXV3wLP9Nfx5Em1q/L2MQ81aOephfODmnpY0py16ttM
WI0lyrJr5ielj0vTliTz5NCwB6AfQve9Adwx2Huid2DSCD9RV7vg7L2oQTZPjVTw
b5jBpC3lG6NS4nNU0pHP7Q0lyytQ13sX0DlqZLQ9cl2HmTk2rlUqOF7RTa93iyx3
Z2pi0xNQhg4Um4gUg8BmVZ8MT3oVmmJ4JgyAv2c3pNQtcy3muFwP3py9wq4uD4x9
PN3Nu8vPmA0zIdSEmQm0TKv0BTv0ukxqfXfUCOXUolb1n3n2nX9eq6
-----END CERTIFICATE-----`;

export default function TlsTool() {
  // ===== 输入与解析状态 =====
  const [pemInput, setPemInput] = useState<string>('');
  const [parseTrigger, setParseTrigger] = useState<number>(0); // 触发解析的版本号
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // ===== 解析结果（可能含多张证书，构成证书链） =====
  const [certs, setCerts] = useState<ParsedCert[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);

  // ===== Tab：details / openssl / pem =====
  const [tab, setTab] = useState<'details' | 'openssl' | 'pem'>('details');
  const [copied, setCopied] = useState(false);

  // 解析 PEM 输入
  const doParse = useCallback(async (input: string) => {
    if (!input.trim()) {
      setError('请粘贴 PEM 格式证书文本');
      setCerts([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      // 解析为 PEM 块
      const blocks = parsePem(input);
      // 仅处理 CERTIFICATE 类型，其他类型（如 PRIVATE KEY）报错提示
      const certBlocks = blocks.filter((b) => b.label === 'CERTIFICATE');
      if (certBlocks.length === 0) {
        throw new Error(`未识别到 CERTIFICATE 块（仅识别到：${blocks.map((b) => b.label).join(', ')}）`);
      }
      // 并行解析所有证书
      const parsed: ParsedCert[] = [];
      for (const block of certBlocks) {
        const cert = parseCertificate(block.der);
        const fp = await computeFingerprints(block.der);
        cert.fingerprintSha1 = fp.sha1;
        cert.fingerprintSha256 = fp.sha256;
        parsed.push({ block, cert, fingerprintSha1: fp.sha1, fingerprintSha256: fp.sha256 });
      }
      setCerts(parsed);
      setActiveIndex(0);
      setTab('details');
    } catch (e) {
      setError(`解析失败：${(e as Error).message}`);
      setCerts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // 触发解析（点击按钮后执行）
  useEffect(() => {
    if (parseTrigger === 0) return; // 初次挂载不自动解析
    doParse(pemInput);
  }, [parseTrigger, doParse, pemInput]);

  const handleParse = useCallback(() => setParseTrigger((n) => n + 1), []);
  const handleClear = useCallback(() => {
    setPemInput('');
    setCerts([]);
    setError('');
    setTab('details');
  }, []);
  const handleLoadSample = useCallback(() => {
    setPemInput(SAMPLE_PEM);
    setError('');
    // 加载示例后立即触发解析
    setTimeout(() => setParseTrigger((n) => n + 1), 0);
  }, []);

  // 文件上传
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setPemInput(text);
      setError('');
      setTimeout(() => setParseTrigger((n) => n + 1), 0);
    } catch (err) {
      setError(`文件读取失败：${(err as Error).message}`);
    }
    // 清空 input 允许重复上传同文件
    e.target.value = '';
  }, []);

  // 复制当前 Tab 内容
  const handleCopy = useCallback(async () => {
    const active = certs[activeIndex];
    if (!active) return;
    let text = '';
    if (tab === 'openssl') {
      text = exportToOpensslText(active.cert);
    } else if (tab === 'pem') {
      // 原始 PEM 文本（从 block.der 反编码为 Base64）
      const b64 = btoa(String.fromCharCode(...active.block.der));
      text = `-----BEGIN ${active.block.label}-----\n${b64.match(/.{1,64}/g)?.join('\n')}\n-----END ${active.block.label}-----`;
    } else if (tab === 'details') {
      text = exportToOpensslText(active.cert);
    }
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [certs, activeIndex, tab]);

  // 拖放支持
  const handleDrop = useCallback(async (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setPemInput(text);
      setError('');
      setTimeout(() => setParseTrigger((n) => n + 1), 0);
    } catch (err) {
      setError(`文件读取失败：${(err as Error).message}`);
    }
  }, []);

  // 当前展示的证书
  const activeCert = certs[activeIndex];

  // 状态摘要：根据有效期判断
  const validity = useMemo(() => {
    if (!activeCert) return null;
    return validateValidity(activeCert.cert);
  }, [activeCert]);

  return (
    <div className="tls__container">
      {/* 顶部操作栏 */}
      <div className="tls__toolbar">
        <button type="button" className="tls__btn tls__btn--primary" onClick={handleParse} disabled={loading || !pemInput.trim()}>
          {loading ? '解析中…' : '解析证书'}
        </button>
        <button type="button" className="tls__btn" onClick={handleLoadSample} disabled={loading}>
          加载示例
        </button>
        <label className="tls__btn tls__btn--file" aria-disabled={loading}>
          上传 .pem / .crt 文件
          <input type="file" accept=".pem,.crt,.cer,.der" onChange={handleFileUpload} disabled={loading} hidden />
        </label>
        <button type="button" className="tls__btn" onClick={handleClear} disabled={loading}>
          清空
        </button>
      </div>

      {/* 主体两栏 */}
      <div className="tls__main">
        {/* 左侧：输入区 */}
        <section className="tls__input-panel" aria-label="证书输入区">
          <label className="tls__label" htmlFor="tls-pem-input">证书 PEM 文本</label>
          <textarea
            id="tls-pem-input"
            className="tls__textarea"
            value={pemInput}
            onChange={(e) => setPemInput(e.target.value)}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            placeholder="粘贴 PEM 格式证书，可包含多张证书（证书链）。&#10;支持 -----BEGIN CERTIFICATE----- 块，或裸 Base64 / hex。&#10;&#10;本工具不会发送任何网络请求，证书内容仅在浏览器本地解析。"
            spellCheck={false}
            aria-label="PEM 证书输入框"
            rows={16}
          />
          {error && <p className="tls__error" role="alert">{error}</p>}
          <p className="tls__privacy-note">
            隐私说明：所有解析在浏览器本地完成，证书内容不离开本机，不会被上传或记录。
          </p>
        </section>

        {/* 右侧：结果区 */}
        <section className="tls__result-panel" aria-label="解析结果区">
          {loading && (
            <div className="tls__loading">
              <div className="tls__spinner" aria-hidden="true"></div>
              <p>正在解析证书并计算指纹…</p>
            </div>
          )}

          {!loading && !activeCert && !error && (
            <div className="tls__empty">
              <p className="tls__empty-title">等待解析证书</p>
              <p className="tls__empty-desc">粘贴 PEM 证书文本或上传 .pem/.crt 文件后点击「解析证书」按钮</p>
            </div>
          )}

          {!loading && activeCert && (
            <>
              {/* 证书切换器（证书链时显示） */}
              {certs.length > 1 && (
                <div className="tls__cert-switcher" role="tablist" aria-label="证书列表">
                  {certs.map((c, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`tls__cert-tab ${i === activeIndex ? 'is-active' : ''}`}
                      role="tab"
                      aria-selected={i === activeIndex}
                      onClick={() => setActiveIndex(i)}
                    >
                      证书 {i + 1}
                      <span className="tls__cert-tab-name">{c.cert.subjectString.split(',').pop()?.trim() || '(空)'}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Tab 切换 */}
              <div className="tls__tab-bar" role="tablist" aria-label="展示模式">
                <button className={`tls__tab ${tab === 'details' ? 'is-active' : ''}`} role="tab" aria-selected={tab === 'details'} onClick={() => setTab('details')}>字段详情</button>
                <button className={`tls__tab ${tab === 'openssl' ? 'is-active' : ''}`} role="tab" aria-selected={tab === 'openssl'} onClick={() => setTab('openssl')}>OpenSSL 文本</button>
                <button className={`tls__tab ${tab === 'pem' ? 'is-active' : ''}`} role="tab" aria-selected={tab === 'pem'} onClick={() => setTab('pem')}>原始 PEM</button>
                <button className="tls__copy-btn" onClick={handleCopy} aria-label="复制当前内容">
                  {copied ? '已复制 ✓' : '复制'}
                </button>
              </div>

              {/* 状态摘要条 */}
              {tab === 'details' && validity && (
                <div className={`tls__summary tls__summary--${validity.status}`} role="status">
                  <span className="tls__summary-item">
                    <span className="tls__summary-label">有效期</span>
                    <span className={`tls__summary-value tls__summary-value--${validity.status}`}>
                      {validity.status === 'valid' ? '有效' : validity.status === 'expired' ? '已过期' : '未生效'}
                    </span>
                  </span>
                  <span className="tls__summary-item">
                    <span className="tls__summary-label">剩余</span>
                    <span className="tls__summary-value">{validity.daysRemaining} 天</span>
                  </span>
                  <span className="tls__summary-item">
                    <span className="tls__summary-label">CA</span>
                    <span className="tls__summary-value">{activeCert.cert.isCA ? '是' : '否'}</span>
                  </span>
                  <span className="tls__summary-item">
                    <span className="tls__summary-label">自签</span>
                    <span className="tls__summary-value">{activeCert.cert.isSelfSigned ? '是' : '否'}</span>
                  </span>
                </div>
              )}

              {/* 字段详情 */}
              {tab === 'details' && <CertDetailsView cert={activeCert.cert} />}

              {/* OpenSSL 文本 */}
              {tab === 'openssl' && (
                <pre className="tls__code-output" aria-label="OpenSSL 风格文本">{exportToOpensslText(activeCert.cert)}</pre>
              )}

              {/* 原始 PEM */}
              {tab === 'pem' && (
                <pre className="tls__code-output" aria-label="原始 PEM 文本">{formatPem(activeCert.block)}</pre>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/** 字段详情子组件：将证书字段结构化展示 */
function CertDetailsView({ cert }: { cert: X509Certificate }) {
  return (
    <div className="tls__details">
      <FieldGroup title="基础信息">
        <Field label="版本" value={`v${cert.version}`} />
        <Field label="序列号（hex）" value={groupHex(cert.serialNumberHex)} mono />
        <Field label="序列号（十进制）" value={cert.serialNumberDecimal} mono />
        <Field label="签名算法" value={cert.signatureAlgorithmName} />
        <Field label="指纹 SHA-1" value={cert.fingerprintSha1 || '—'} mono />
        <Field label="指纹 SHA-256" value={cert.fingerprintSha256 || '—'} mono />
      </FieldGroup>

      <FieldGroup title="主体与签发者">
        <Field label="主体（Subject）" value={cert.subjectString} />
        <Field label="签发者（Issuer）" value={cert.issuerString} />
        <Field label="是否自签" value={cert.isSelfSigned ? '是（subject == issuer）' : '否'} />
      </FieldGroup>

      <FieldGroup title="有效期">
        <Field label="生效时间" value={cert.notBefore.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')} />
        <Field label="过期时间" value={cert.notAfter.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')} />
      </FieldGroup>

      <FieldGroup title="公钥信息">
        <Field label="算法" value={cert.publicKey.algorithmName} />
        <Field label="密钥长度" value={formatKeySize(cert.publicKey.keySizeBits)} />
        {cert.publicKey.rsaModulus && (
          <Field label="RSA 模数" value={groupHex(cert.publicKey.rsaModulus)} mono />
        )}
        {cert.publicKey.rsaExponent !== undefined && (
          <Field label="RSA 指数" value={`${cert.publicKey.rsaExponent} (0x${cert.publicKey.rsaExponent.toString(16)})`} />
        )}
        {cert.publicKey.ecCurveName && (
          <Field label="椭圆曲线" value={cert.publicKey.ecCurveName} />
        )}
        {cert.publicKey.ecPointHex && (
          <Field label="公钥点" value={groupHex(cert.publicKey.ecPointHex)} mono />
        )}
        {cert.publicKey.eddsaName && (
          <Field label="EdDSA 算法" value={cert.publicKey.eddsaName} />
        )}
      </FieldGroup>

      {cert.sanList.length > 0 && (
        <FieldGroup title="主体可选名称（SAN）">
          {cert.sanList.map((n, i) => (
            <Field key={i} label={n.type} value={n.value} />
          ))}
        </FieldGroup>
      )}

      {cert.eku.length > 0 && (
        <FieldGroup title="扩展密钥用途（EKU）">
          {cert.eku.map((u, i) => (
            <Field key={i} label={u.name} value={u.oid} mono />
          ))}
        </FieldGroup>
      )}

      {cert.extensions.length > 0 && (
        <FieldGroup title="X.509 扩展">
          {cert.extensions.map((ext, i) => (
            <Field
              key={i}
              label={`${ext.name}${ext.critical ? ' (关键)' : ''}`}
              value={ext.parsed}
              mono
            />
          ))}
        </FieldGroup>
      )}

      {cert.crlDistributionPoints.length > 0 && (
        <FieldGroup title="CRL 分发点">
          {cert.crlDistributionPoints.map((url, i) => (
            <Field key={i} label={`CRL ${i + 1}`} value={url} link={url.startsWith('http') ? url : undefined} />
          ))}
        </FieldGroup>
      )}

      {cert.ocspUrls.length > 0 && (
        <FieldGroup title="OCSP 在线状态查询">
          {cert.ocspUrls.map((url, i) => (
            <Field key={i} label={`OCSP ${i + 1}`} value={url} link={url} />
          ))}
        </FieldGroup>
      )}

      {cert.caIssuersUrls.length > 0 && (
        <FieldGroup title="CA 签发者证书 URL">
          {cert.caIssuersUrls.map((url, i) => (
            <Field key={i} label={`CA ${i + 1}`} value={url} link={url} />
          ))}
        </FieldGroup>
      )}

      <FieldGroup title="签名值">
        <Field label="签名（hex）" value={groupHex(cert.signatureHex)} mono />
      </FieldGroup>
    </div>
  );
}

/** 字段组（卡片样式容器） */
function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="tls__group">
      <h3 className="tls__group-title">{title}</h3>
      <dl className="tls__fields">{children}</dl>
    </div>
  );
}

/** 单个字段（label + value） */
function Field({ label, value, mono, link }: { label: string; value: string; mono?: boolean; link?: string }) {
  return (
    <div className={`tls__field ${mono ? 'is-mono' : ''}`}>
      <dt className="tls__field-label">{label}</dt>
      <dd className="tls__field-value">
        {link ? (
          <a href={link} target="_blank" rel="noopener noreferrer">{value}</a>
        ) : (
          <span className="tls__field-text">{value}</span>
        )}
      </dd>
    </div>
  );
}

/** 将长 hex 字符串按 2 字节分组并折行显示 */
function groupHex(hex: string): string {
  if (!hex) return '';
  // 按 2 字节（4 hex）分组
  const grouped = hex.match(/.{1,2}/g)?.join(' ') || hex;
  // 每 16 字节换行
  return grouped.match(/.{1,48}/g)?.join('\n') || grouped;
}

/** 将 block 重新格式化为标准 PEM 文本（64 字符换行） */
function formatPem(block: PemBlock): string {
  const b64 = btoa(String.fromCharCode(...block.der));
  const lines = b64.match(/.{1,64}/g) || [b64];
  return `-----BEGIN ${block.label}-----\n${lines.join('\n')}\n-----END ${block.label}-----`;
}
