import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';
import {
  DEFAULT_CONFIG,
  PRESET_SCENARIOS,
  OUTPUT_LANGS,
  HTTP_METHODS,
  BODY_TYPE_METAS,
  AUTH_TYPE_METAS,
  generateCode,
  type RequestConfig,
  type OutputLang,
  type HttpMethod,
  type BodyType,
  type AuthType,
  type ApiKeyIn,
  type HeaderItem,
  type FormField,
} from '../utils/httpRequest';

/**
 * HTTP 请求代码生成器
 *
 * 全部在浏览器本地处理，零网络请求，零依赖。
 *
 * 核心能力：
 *  - 统一配置（URL / 方法 / Headers / 认证 / 请求体 / 高级选项）
 *  - 5 种语言代码生成：cURL / fetch / axios / Python requests / Go net/http
 *  - 4 种认证方式：none / basic / bearer / apikey（Header 或 Query）
 *  - 5 种请求体格式：none / json / form / urlencoded / raw
 *  - 6 个高频预设场景一键载入
 *  - 高级选项：超时 / 重定向 / SSL 校验
 *  - 实时生成代码 + 一键复制
 *
 *  UI 布局：左右两栏（移动端单列）
 *  - 左侧：配置面板（URL/方法/Headers/认证/请求体/高级）
 *  - 右侧：代码输出（5 语言 Tab + 代码块 + 复制按钮）
 */
export default function HttpRequestTool() {
  const [config, setConfig] = useState<RequestConfig>(DEFAULT_CONFIG);
  const [activeLang, setActiveLang] = useState<OutputLang>('curl');
  const [copied, setCopied] = useState(false);

  // 实时生成代码
  const code = useMemo(() => generateCode(activeLang, config), [activeLang, config]);

  // 统一更新 config 的辅助函数
  const updateConfig = useCallback(<K extends keyof RequestConfig>(key: K, value: RequestConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }, []);

  // 载入预设
  const handlePreset = useCallback((presetConfig: RequestConfig) => {
    // 深拷贝避免预设被污染
    setConfig(JSON.parse(JSON.stringify(presetConfig)));
  }, []);

  // 复制代码
  const handleCopy = useCallback(async () => {
    const ok = await copyText(code);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [code]);

  const activeLangMeta = OUTPUT_LANGS.find((l) => l.lang === activeLang)!;

  return (
    <div className="hr__container">
      {/* 预设场景按钮组 */}
      <div className="hr__presets">
        <span className="hr__presets-label">预设场景：</span>
        <div className="hr__presets-list" role="group" aria-label="预设场景选择">
          {PRESET_SCENARIOS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="hr__preset-btn"
              onClick={() => handlePreset(p.config)}
              title={p.desc}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className="hr__layout">
        {/* 左侧：配置面板 */}
        <div className="hr__config">
          {/* URL 与方法 */}
          <div className="hr__section">
            <h3 className="hr__section-title">请求</h3>
            <div className="hr__row hr__row--url">
              <select
                className="hr__select hr__select--method"
                value={config.method}
                onChange={(e) => updateConfig('method', e.target.value as HttpMethod)}
                aria-label="HTTP 方法"
              >
                {HTTP_METHODS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <input
                type="text"
                className="hr__input hr__input--url"
                value={config.url}
                onChange={(e) => updateConfig('url', e.target.value)}
                placeholder="https://api.example.com/v1/resource"
                aria-label="请求 URL"
              />
            </div>
          </div>

          {/* Headers 编辑器 */}
          <HeadersEditor
            headers={config.headers}
            onChange={(headers) => updateConfig('headers', headers)}
          />

          {/* 认证配置 */}
          <AuthEditor config={config} updateConfig={updateConfig} />

          {/* 请求体配置 */}
          <BodyEditor config={config} updateConfig={updateConfig} />

          {/* 高级选项 */}
          <AdvancedEditor config={config} updateConfig={updateConfig} />
        </div>

        {/* 右侧：代码输出 */}
        <div className="hr__output">
          <div className="hr__panel-head">
            <div className="hr__lang-tabs" role="tablist" aria-label="输出语言切换">
              {OUTPUT_LANGS.map((l) => (
                <button
                  key={l.lang}
                  type="button"
                  role="tab"
                  aria-selected={activeLang === l.lang}
                  className={`hr__lang-tab ${activeLang === l.lang ? 'is-active' : ''}`}
                  onClick={() => setActiveLang(l.lang)}
                  title={l.desc}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="hr__btn hr__btn--primary"
              onClick={handleCopy}
            >
              {copied ? '已复制' : '复制代码'}
            </button>
          </div>
          <div className="hr__code-meta">
            <span className="hr__lang-desc">{activeLangMeta.desc}</span>
          </div>
          <pre className="hr__code" aria-label={`${activeLangMeta.label} 代码`}><code>{code}</code></pre>
        </div>
      </div>
    </div>
  );
}

/* ============== Headers 编辑器 ============== */
function HeadersEditor({ headers, onChange }: { headers: HeaderItem[]; onChange: (h: HeaderItem[]) => void }) {
  const handleAdd = () => {
    onChange([...headers, { name: '', value: '' }]);
  };
  const handleRemove = (idx: number) => {
    onChange(headers.filter((_, i) => i !== idx));
  };
  const handleChange = (idx: number, field: keyof HeaderItem, value: string) => {
    onChange(headers.map((h, i) => (i === idx ? { ...h, [field]: value } : h)));
  };

  return (
    <div className="hr__section">
      <div className="hr__section-head">
        <h3 className="hr__section-title">Headers</h3>
        <button type="button" className="hr__btn hr__btn--ghost hr__btn--sm" onClick={handleAdd}>+ 添加</button>
      </div>
      {headers.length === 0 ? (
        <p className="hr__empty-inline">暂无 Header，点击「添加」按钮新增</p>
      ) : (
        <div className="hr__kv-list">
          {headers.map((h, idx) => (
            <div key={idx} className="hr__kv-row">
              <input
                type="text"
                className="hr__input hr__input--key"
                placeholder="Header 名称（如 Content-Type）"
                value={h.name}
                onChange={(e) => handleChange(idx, 'name', e.target.value)}
              />
              <input
                type="text"
                className="hr__input hr__input--val"
                placeholder="Header 值"
                value={h.value}
                onChange={(e) => handleChange(idx, 'value', e.target.value)}
              />
              <button
                type="button"
                className="hr__btn hr__btn--ghost hr__btn--icon"
                onClick={() => handleRemove(idx)}
                aria-label="删除此 Header"
                title="删除"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============== 认证配置编辑器 ============== */
function AuthEditor({
  config,
  updateConfig,
}: {
  config: RequestConfig;
  updateConfig: <K extends keyof RequestConfig>(key: K, value: RequestConfig[K]) => void;
}) {
  const { auth } = config;
  const handleAuthChange = (patch: Partial<typeof auth>) => {
    updateConfig('auth', { ...auth, ...patch });
  };

  return (
    <div className="hr__section">
      <div className="hr__section-head">
        <h3 className="hr__section-title">认证</h3>
        <select
          className="hr__select hr__select--sm"
          value={auth.type}
          onChange={(e) => handleAuthChange({ type: e.target.value as AuthType })}
        >
          {AUTH_TYPE_METAS.map((a) => (
            <option key={a.type} value={a.type}>{a.label}</option>
          ))}
        </select>
      </div>
      <p className="hr__hint">{AUTH_TYPE_METAS.find((a) => a.type === auth.type)?.desc}</p>

      {auth.type === 'basic' && (
        <div className="hr__kv-list">
          <div className="hr__kv-row">
            <input
              type="text"
              className="hr__input hr__input--key"
              placeholder="用户名"
              value={auth.username ?? ''}
              onChange={(e) => handleAuthChange({ username: e.target.value })}
            />
            <input
              type="text"
              className="hr__input hr__input--val"
              placeholder="密码"
              value={auth.password ?? ''}
              onChange={(e) => handleAuthChange({ password: e.target.value })}
            />
          </div>
        </div>
      )}

      {auth.type === 'bearer' && (
        <input
          type="text"
          className="hr__input"
          placeholder="Bearer 令牌（如 JWT）"
          value={auth.token ?? ''}
          onChange={(e) => handleAuthChange({ token: e.target.value })}
        />
      )}

      {auth.type === 'apikey' && (
        <>
          <div className="hr__kv-list">
            <div className="hr__kv-row">
              <input
                type="text"
                className="hr__input hr__input--key"
                placeholder="Key 名（如 X-API-Key）"
                value={auth.apiKey ?? ''}
                onChange={(e) => handleAuthChange({ apiKey: e.target.value })}
              />
              <input
                type="text"
                className="hr__input hr__input--val"
                placeholder="Key 值"
                value={auth.apiValue ?? ''}
                onChange={(e) => handleAuthChange({ apiValue: e.target.value })}
              />
            </div>
          </div>
          <div className="hr__radio-group">
            <label className="hr__radio">
              <input
                type="radio"
                name="apikey-in"
                value="header"
                checked={auth.apiKeyIn !== 'query'}
                onChange={() => handleAuthChange({ apiKeyIn: 'header' as ApiKeyIn })}
              />
              <span>Header 注入</span>
            </label>
            <label className="hr__radio">
              <input
                type="radio"
                name="apikey-in"
                value="query"
                checked={auth.apiKeyIn === 'query'}
                onChange={() => handleAuthChange({ apiKeyIn: 'query' as ApiKeyIn })}
              />
              <span>Query 参数</span>
            </label>
          </div>
        </>
      )}
    </div>
  );
}

/* ============== 请求体配置编辑器 ============== */
function BodyEditor({
  config,
  updateConfig,
}: {
  config: RequestConfig;
  updateConfig: <K extends keyof RequestConfig>(key: K, value: RequestConfig[K]) => void;
}) {
  const { bodyType, rawBody, formFields, method } = config;

  const handleFieldChange = (idx: number, field: keyof FormField, value: string) => {
    updateConfig('formFields', formFields.map((f, i) => (i === idx ? { ...f, [field]: value } : f)));
  };
  const handleFieldAdd = () => {
    updateConfig('formFields', [...formFields, { name: '', value: '' }]);
  };
  const handleFieldRemove = (idx: number) => {
    updateConfig('formFields', formFields.filter((_, i) => i !== idx));
  };

  // GET / HEAD 通常无请求体
  const bodyDisabled = method === 'GET' || method === 'HEAD';

  return (
    <div className="hr__section">
      <div className="hr__section-head">
        <h3 className="hr__section-title">请求体</h3>
        <select
          className="hr__select hr__select--sm"
          value={bodyType}
          onChange={(e) => updateConfig('bodyType', e.target.value as BodyType)}
          disabled={bodyDisabled}
        >
          {BODY_TYPE_METAS.map((b) => (
            <option key={b.type} value={b.type}>{b.label}</option>
          ))}
        </select>
      </div>
      <p className="hr__hint">
        {bodyDisabled
          ? `${method} 请求通常无请求体，已禁用请求体配置`
          : BODY_TYPE_METAS.find((b) => b.type === bodyType)?.desc}
      </p>

      {!bodyDisabled && (bodyType === 'json' || bodyType === 'raw') && (
        <textarea
          className="hr__textarea"
          value={rawBody}
          onChange={(e) => updateConfig('rawBody', e.target.value)}
          placeholder={bodyType === 'json' ? '{\n  "key": "value"\n}' : '原始请求体文本'}
          rows={6}
          spellCheck={false}
        />
      )}

      {!bodyDisabled && (bodyType === 'form' || bodyType === 'urlencoded') && (
        <div>
          <div className="hr__kv-list">
            {formFields.map((f, idx) => (
              <div key={idx} className="hr__kv-row">
                <input
                  type="text"
                  className="hr__input hr__input--key"
                  placeholder="字段名"
                  value={f.name}
                  onChange={(e) => handleFieldChange(idx, 'name', e.target.value)}
                />
                <input
                  type="text"
                  className="hr__input hr__input--val"
                  placeholder="字段值"
                  value={f.value}
                  onChange={(e) => handleFieldChange(idx, 'value', e.target.value)}
                />
                <button
                  type="button"
                  className="hr__btn hr__btn--ghost hr__btn--icon"
                  onClick={() => handleFieldRemove(idx)}
                  aria-label="删除此字段"
                  title="删除"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="hr__btn hr__btn--ghost hr__btn--sm"
            onClick={handleFieldAdd}
          >
            + 添加字段
          </button>
        </div>
      )}
    </div>
  );
}

/* ============== 高级选项编辑器 ============== */
function AdvancedEditor({
  config,
  updateConfig,
}: {
  config: RequestConfig;
  updateConfig: <K extends keyof RequestConfig>(key: K, value: RequestConfig[K]) => void;
}) {
  const { advanced } = config;
  const handleAdvancedChange = (patch: Partial<typeof advanced>) => {
    updateConfig('advanced', { ...advanced, ...patch });
  };

  return (
    <div className="hr__section">
      <div className="hr__section-head">
        <h3 className="hr__section-title">高级选项</h3>
      </div>
      <div className="hr__advanced">
        <label className="hr__field-row">
          <span className="hr__field-label">超时（毫秒）</span>
          <input
            type="number"
            className="hr__input hr__input--num"
            min={0}
            step={1000}
            value={advanced.timeout ?? 0}
            onChange={(e) => handleAdvancedChange({ timeout: Number(e.target.value) || 0 })}
            placeholder="0 表示不设置"
          />
        </label>
        <label className="hr__checkbox">
          <input
            type="checkbox"
            checked={advanced.followRedirects ?? true}
            onChange={(e) => handleAdvancedChange({ followRedirects: e.target.checked })}
          />
          <span>跟随重定向</span>
        </label>
        <label className="hr__checkbox">
          <input
            type="checkbox"
            checked={advanced.verifySsl ?? true}
            onChange={(e) => handleAdvancedChange({ verifySsl: e.target.checked })}
          />
          <span>校验 SSL 证书</span>
        </label>
      </div>
    </div>
  );
}
