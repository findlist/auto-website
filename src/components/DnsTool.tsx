import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { copyText } from '../utils/clipboard';
import {
  RECORD_TYPES,
  DOH_PROVIDERS,
  PRESET_DOMAINS,
  RCODE_MAP,
  isValidDomain,
  normalizeDomain,
  queryDns,
  formatTtl,
  formatElapsed,
  findRecordTypeByCode,
  recordTypeName,
  formatRecordData,
  describeDnssecAd,
  exportAsDigText,
  type RecordTypeCode,
  type DnsQueryParams,
  type DnsQueryResult,
  type DnsRecord,
} from '../utils/dns';

/**
 * DNS 查询工具（基于 DNS over HTTPS）
 *
 * 全部查询由用户主动发起，浏览器直连 DoH 服务商，不经过本站服务器。
 * 支持 16 种记录类型、3 个 DoH 服务商、DNSSEC 状态解读、dig 风格文本导出。
 *
 * UI 布局：左右两栏（移动端单列）
 *  - 左侧：查询配置（域名输入 / 记录类型 / DoH 服务商 / DNSSEC 开关）
 *  - 右侧：查询结果（状态摘要 / 记录详情 / 原始响应 / 导出文本）
 */
export default function DnsTool() {
  // ===== 查询表单状态 =====
  const [domain, setDomain] = useState<string>('cloudflare.com');
  const [typeCode, setTypeCode] = useState<RecordTypeCode>(1);
  const [providerId, setProviderId] = useState<string>('cloudflare');
  const [doDnssec, setDoDnssec] = useState<boolean>(true);

  // ===== 查询结果与状态 =====
  const [result, setResult] = useState<DnsQueryResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [inputError, setInputError] = useState<string>('');

  // ===== 历史记录（最多 10 条，仅保存在内存） =====
  const [history, setHistory] = useState<
    Array<{ id: number; params: DnsQueryParams; result: DnsQueryResult }>
  >([]);
  const historyIdRef = useRef(0);

  // ===== 当前展示的 Tab：details（记录详情）/ raw（原始 JSON）/ dig（导出文本） =====
  const [tab, setTab] = useState<'details' | 'raw' | 'dig'>('details');
  const [copied, setCopied] = useState(false);

  // 实时校验域名格式（防抖到 200ms）
  useEffect(() => {
    const t = setTimeout(() => {
      if (!domain.trim()) {
        setInputError('');
        return;
      }
      const normalized = normalizeDomain(domain);
      if (!isValidDomain(normalized)) {
        setInputError('域名格式不正确：仅支持字母数字、连字符与点，长度 1-253');
      } else {
        setInputError('');
      }
    }, 200);
    return () => clearTimeout(t);
  }, [domain]);

  const canQuery = useMemo(() => {
    return !loading && domain.trim().length > 0 && inputError === '';
  }, [loading, domain, inputError]);

  // 执行查询
  const handleQuery = useCallback(async () => {
    const normalized = normalizeDomain(domain);
    if (!isValidDomain(normalized)) {
      setInputError('域名格式不正确');
      return;
    }
    const params: DnsQueryParams = {
      name: normalized,
      typeCode,
      providerId,
      doDnssec,
    };
    setLoading(true);
    setTab('details');
    try {
      const r = await queryDns(params);
      setResult(r);
      // 加入历史
      historyIdRef.current += 1;
      const id = historyIdRef.current;
      setHistory((prev) => [{ id, params, result: r }, ...prev].slice(0, 10));
    } finally {
      setLoading(false);
    }
  }, [domain, typeCode, providerId, doDnssec]);

  // 载入预设
  const handlePreset = useCallback((preset: typeof PRESET_DOMAINS[number]) => {
    setDomain(preset.name);
    setTypeCode(preset.typeCode);
    setInputError('');
  }, []);

  // 切换历史记录
  const handleSelectHistory = useCallback(
    (item: { params: DnsQueryParams; result: DnsQueryResult }) => {
      setDomain(item.params.name);
      setTypeCode(item.params.typeCode);
      setProviderId(item.params.providerId);
      setDoDnssec(item.params.doDnssec !== false);
      setResult(item.result);
      setTab('details');
    },
    []
  );

  // 清空历史
  const handleClearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  // 复制当前 Tab 内容
  const handleCopy = useCallback(async () => {
    if (!result || !result.ok) return;
    let text = '';
    if (tab === 'dig') {
      text = exportAsDigText(result);
    } else if (tab === 'raw') {
      text = JSON.stringify(result.response, null, 2);
    } else {
      text = exportAsDigText(result);
    }
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [result, tab]);

  // 渲染单条记录
  const renderRecord = useCallback((r: DnsRecord, idx: number) => {
    const meta = findRecordTypeByCode(r.type);
    const formatted = formatRecordData(r);
    const isFormatted = formatted !== r.data;
    return (
      <div className="dns__record" key={idx}>
        <div className="dns__record-head">
          <span className="dns__record-name">{r.name}</span>
          <span className="dns__record-type">{recordTypeName(r.type)}</span>
          <span className="dns__record-ttl" title={`TTL = ${r.TTL} 秒`}>TTL {r.TTL}（{formatTtl(r.TTL)}）</span>
          {meta && <span className="dns__record-label">{meta.label}</span>}
        </div>
        <div className="dns__record-data">
          {isFormatted ? (
            <>
              <div className="dns__record-formatted">{formatted}</div>
              <div className="dns__record-raw">
                <span className="dns__record-raw-label">原始数据：</span>
                <code>{r.data}</code>
              </div>
            </>
          ) : (
            <code className="dns__record-code">{r.data}</code>
          )}
        </div>
      </div>
    );
  }, []);

  // 渲染查询结果区
  const renderResult = () => {
    if (loading) {
      return (
        <div className="dns__loading" role="status" aria-live="polite">
          <div className="dns__spinner" aria-hidden="true" />
          <p>正在向 {findProvider(providerId).name} 查询 {domain}...</p>
        </div>
      );
    }
    if (!result) {
      return (
        <div className="dns__empty">
          <p>输入域名并点击「查询」，结果将显示在此处。</p>
          <p className="dns__empty-hint">
            查询通过 DNS over HTTPS 协议直连公共 DoH 服务器，
            不经过本站服务器，不记录任何查询内容。
          </p>
        </div>
      );
    }
    if (!result.ok) {
      return (
        <div className="dns__error">
          <h3>查询失败</h3>
          <p>{result.error}</p>
          <dl className="dns__meta">
            <dt>DoH 服务商</dt>
            <dd>{result.provider.name}</dd>
            <dt>查询目标</dt>
            <dd>{result.params.name}</dd>
            <dt>记录类型</dt>
            <dd>{recordTypeName(result.params.typeCode)}</dd>
            <dt>耗时</dt>
            <dd>{formatElapsed(result.elapsedMs)}</dd>
          </dl>
        </div>
      );
    }
    const resp = result.response;
    const statusMeta = RCODE_MAP[resp.Status] ?? { name: 'UNKNOWN', label: `状态码 ${resp.Status}`, hint: '未知状态' };
    const dnssecMeta = describeDnssecAd(resp.AD, resp.CD);
    const hasAnswer = resp.Answer && resp.Answer.length > 0;
    const hasAuthority = resp.Authority && resp.Authority.length > 0;
    const hasAdditional = resp.Additional && resp.Additional.length > 0;
    return (
      <div className="dns__success">
        {/* 状态摘要条 */}
        <div className={`dns__summary dns__summary--${statusMeta.name.toLowerCase()}`}>
          <div className="dns__summary-item">
            <span className="dns__summary-label">状态</span>
            <strong>{statusMeta.name}</strong>
            <span className="dns__summary-hint">{statusMeta.label}</span>
          </div>
          <div className="dns__summary-item">
            <span className="dns__summary-label">DNSSEC</span>
            <strong className={`dns__dnssec dns__dnssec--${dnssecMeta.level}`}>{dnssecMeta.label}</strong>
            <span className="dns__summary-hint">{dnssecMeta.hint}</span>
          </div>
          <div className="dns__summary-item">
            <span className="dns__summary-label">耗时</span>
            <strong>{formatElapsed(result.elapsedMs)}</strong>
            <span className="dns__summary-hint">{result.provider.name}</span>
          </div>
        </div>
        {/* Tab 切换 */}
        <div className="dns__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'details'}
            className={`dns__tab ${tab === 'details' ? 'dns__tab--active' : ''}`}
            onClick={() => setTab('details')}
          >
            记录详情
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'dig'}
            className={`dns__tab ${tab === 'dig' ? 'dns__tab--active' : ''}`}
            onClick={() => setTab('dig')}
          >
            dig 风格文本
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'raw'}
            className={`dns__tab ${tab === 'raw' ? 'dns__tab--active' : ''}`}
            onClick={() => setTab('raw')}
          >
            原始 JSON
          </button>
          <button
            type="button"
            className="dns__copy"
            onClick={handleCopy}
            aria-label="复制当前内容"
          >
            {copied ? '已复制 ✓' : '复制'}
          </button>
        </div>
        {/* Tab 内容 */}
        <div className="dns__tab-body">
          {tab === 'details' && (
            <>
              {!hasAnswer && !hasAuthority && !hasAdditional ? (
                <div className="dns__no-records">
                  <p>查询返回无记录（Status = {statusMeta.name}）。</p>
                  <p className="dns__empty-hint">{statusMeta.hint}</p>
                </div>
              ) : (
                <>
                  {hasAnswer && (
                    <section className="dns__section">
                      <h3>应答记录（Answer）<span className="dns__count">{resp.Answer!.length}</span></h3>
                      <div className="dns__records">{resp.Answer!.map(renderRecord)}</div>
                    </section>
                  )}
                  {hasAuthority && (
                    <section className="dns__section">
                      <h3>权威记录（Authority）<span className="dns__count">{resp.Authority!.length}</span></h3>
                      <div className="dns__records">{resp.Authority!.map(renderRecord)}</div>
                    </section>
                  )}
                  {hasAdditional && (
                    <section className="dns__section">
                      <h3>附加记录（Additional）<span className="dns__count">{resp.Additional!.length}</span></h3>
                      <div className="dns__records">{resp.Additional!.map(renderRecord)}</div>
                    </section>
                  )}
                </>
              )}
            </>
          )}
          {tab === 'dig' && (
            <pre className="dns__dig">{exportAsDigText(result)}</pre>
          )}
          {tab === 'raw' && (
            <pre className="dns__raw">{JSON.stringify(resp, null, 2)}</pre>
          )}
        </div>
      </div>
    );
  };

  const provider = findProvider(providerId);
  const selectedTypeMeta = RECORD_TYPES.find((t) => t.code === typeCode);

  return (
    <div className="dns__container">
      {/* 预设场景按钮组 */}
      <div className="dns__presets">
        <span className="dns__presets-label">常用预设：</span>
        <div className="dns__presets-list" role="group" aria-label="常用 DNS 查询预设">
          {PRESET_DOMAINS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="dns__preset-btn"
              onClick={() => handlePreset(p)}
              title={p.description}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* 主布局：左右两栏 */}
      <div className="dns__main">
        {/* 左侧：查询配置 */}
        <div className="dns__panel">
          <h2 className="dns__panel-title">查询配置</h2>
          {/* 域名输入 */}
          <div className="dns__field">
            <label htmlFor="dns-domain" className="dns__field-label">域名</label>
            <input
              id="dns-domain"
              type="text"
              className="dns__input"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canQuery) handleQuery();
              }}
              placeholder="example.com"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={inputError ? 'true' : 'false'}
              aria-describedby={inputError ? 'dns-domain-error' : undefined}
            />
            {inputError && (
              <p id="dns-domain-error" className="dns__field-error" role="alert">
                {inputError}
              </p>
            )}
            <p className="dns__field-hint">支持完整 URL 自动截取，反向解析请输入 <code>1.0.0.127.in-addr.arpa</code></p>
          </div>
          {/* 记录类型 */}
          <div className="dns__field">
            <label htmlFor="dns-type" className="dns__field-label">记录类型</label>
            <select
              id="dns-type"
              className="dns__select"
              value={typeCode}
              onChange={(e) => setTypeCode(Number(e.target.value) as RecordTypeCode)}
            >
              {RECORD_TYPES.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name} — {t.label}（{t.summary}）
                </option>
              ))}
            </select>
            {selectedTypeMeta && (
              <p className="dns__field-hint">{selectedTypeMeta.summary}，常用于 {selectedTypeMeta.example}</p>
            )}
          </div>
          {/* DoH 服务商 */}
          <div className="dns__field">
            <label htmlFor="dns-provider" className="dns__field-label">DoH 服务商</label>
            <select
              id="dns-provider"
              className="dns__select"
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
            >
              {DOH_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（{p.endpoint}）
                </option>
              ))}
            </select>
            <p className="dns__field-hint">{provider.description}。<a href={provider.homepage} target="_blank" rel="noopener noreferrer">官网</a> · {provider.privacy}</p>
          </div>
          {/* DNSSEC 开关 */}
          <div className="dns__field dns__field--inline">
            <label htmlFor="dns-dnssec" className="dns__field-label">请求 DNSSEC 验证</label>
            <label className="dns__switch">
              <input
                id="dns-dnssec"
                type="checkbox"
                checked={doDnssec}
                onChange={(e) => setDoDnssec(e.target.checked)}
              />
              <span className="dns__switch-slider" aria-hidden="true" />
            </label>
            <span className="dns__switch-label">{doDnssec ? '开启（cd=0，请求 DoH 验证 DNSSEC）' : '关闭（cd=1，不验证）'}</span>
          </div>
          {/* 查询按钮 */}
          <button
            type="button"
            className="dns__submit"
            onClick={handleQuery}
            disabled={!canQuery}
          >
            {loading ? '查询中...' : '查询'}
          </button>
          {/* 历史记录 */}
          {history.length > 0 && (
            <div className="dns__history">
              <div className="dns__history-head">
                <h3>最近查询（{history.length}/10）</h3>
                <button type="button" className="dns__history-clear" onClick={handleClearHistory}>
                  清空
                </button>
              </div>
              <ul className="dns__history-list">
                {history.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="dns__history-item"
                      onClick={() => handleSelectHistory(item)}
                      title={`${item.params.name} ${recordTypeName(item.params.typeCode)}`}
                    >
                      <span className="dns__history-name">{item.params.name}</span>
                      <span className="dns__history-type">{recordTypeName(item.params.typeCode)}</span>
                      <span className={`dns__history-status ${item.result.ok ? 'dns__history-status--ok' : 'dns__history-status--fail'}`}>
                        {item.result.ok ? item.result.response.Status === 0 ? '✓' : `Status ${item.result.response.Status}` : '失败'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* 右侧：结果展示 */}
        <div className="dns__result">
          {renderResult()}
        </div>
      </div>
    </div>
  );
}

/** 简化查找服务商（避免重复导入） */
function findProvider(id: string) {
  return DOH_PROVIDERS.find((p) => p.id === id) ?? DOH_PROVIDERS[0];
}
