import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';
import { jsonToXml, validateXml, formatStats, type JsonToXmlOptions } from '../utils/jsonToXml';

/**
 * JSON 转 XML 转换工具
 *
 * 设计目标：
 *  - JSON 数据 → XML 文档单向转换
 *  - 可配置根节点名、数组项名、属性风格、CDATA、XML 声明、缩进、null 表示
 *  - 实时预览转换结果
 *  - well-formed 校验提示
 *  - 复制 / 下载 .xml 文件 / 示例 / 清空
 *
 * 与现有工具的区别：
 *  - CsvJsonTool：CSV ↔ JSON 双向互转（表格数据）
 *  - YamlTool：YAML ↔ JSON 双向格式化（配置文件）
 *  - 本工具：JSON → XML 单向导出（面向 SOAP / SVG / Office 文档 / 旧系统对接场景）
 */

/** 示例 JSON：覆盖对象、数组、嵌套、null、特殊字符 */
const EXAMPLE_JSON = `{
  "name": "开发者工具箱",
  "version": "1.0.0",
  "active": true,
  "score": 95,
  "tags": ["前端", "工具", "零依赖"],
  "author": {
    "name": "Aether",
    "email": "aether@example.com"
  },
  "features": [
    { "name": "JSON 格式化", "enabled": true },
    { "name": "Base64 编码", "enabled": true }
  ],
  "description": "支持 <特殊> 字符 & 转义",
  "note": null
}`;

const INDENT_OPTIONS = [
  { label: '2 空格', value: 2 },
  { label: '4 空格', value: 4 },
  { label: 'Tab', value: -1 },
  { label: '压缩', value: 0 },
];

/** Tab 缩进转实际字符 */
function resolveIndent(value: number): number {
  return value === -1 ? 1 : value;
}

/** 是否用 Tab（value === -1 时用 \t） */
function isTabIndent(value: number): boolean {
  return value === -1;
}

export default function JsonToXmlTool() {
  const [input, setInput] = useState(EXAMPLE_JSON);
  const [rootName, setRootName] = useState('root');
  const [arrayItemName, setArrayItemName] = useState('item');
  const [useAttributes, setUseAttributes] = useState(false);
  const [useCdata, setUseCdata] = useState(false);
  const [includeDeclaration, setIncludeDeclaration] = useState(true);
  const [indentChoice, setIndentChoice] = useState(2);
  const [nilForNull, setNilForNull] = useState(false);
  const [notice, setNotice] = useState('');

  /** 实时转换结果（useMemo 自动重算） */
  const result = useMemo(() => {
    if (!input.trim()) return null;
    const tabIndent = isTabIndent(indentChoice);
    // 构造当前选项：Tab 模式下 indent 用 1 占位，后处理替换为 \t
    const opts: JsonToXmlOptions = {
      rootName,
      arrayItemName,
      useAttributes,
      useCdata,
      includeDeclaration,
      indent: tabIndent ? 1 : resolveIndent(indentChoice),
      nilForNull,
    };
    const res = jsonToXml(input, opts);
    if (res.ok && tabIndent) {
      // 将空格缩进替换为 Tab：jsonToXml 用单空格作缩进时，每层 1 空格
      const lines = res.xml.split('\n');
      const tabbed = lines
        .map((line) => {
          const match = line.match(/^( +)/);
          if (!match) return line;
          const spaces = match[1].length;
          return '\t'.repeat(spaces) + line.slice(spaces);
        })
        .join('\n');
      return { ...res, xml: tabbed };
    }
    return res;
  }, [
    input,
    rootName,
    arrayItemName,
    useAttributes,
    useCdata,
    includeDeclaration,
    indentChoice,
    nilForNull,
  ]);

  /** well-formed 校验结果 */
  const validation = useMemo(() => {
    if (!result?.ok) return null;
    return validateXml(result.xml);
  }, [result]);

  /** 复制 XML */
  const handleCopy = useCallback(async () => {
    if (!result?.ok) {
      setNotice('无可复制内容');
      return;
    }
    const ok = await copyText(result.xml);
    setNotice(ok ? '已复制 XML 到剪贴板' : '复制失败，请手动选择');
  }, [result]);

  /** 下载 .xml 文件 */
  const handleDownload = useCallback(() => {
    if (!result?.ok) {
      setNotice('无可下载内容');
      return;
    }
    const blob = new Blob([result.xml], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'converted.xml';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setNotice('已下载 converted.xml');
  }, [result]);

  /** 载入示例 */
  const handleExample = useCallback(() => {
    setInput(EXAMPLE_JSON);
    setNotice('已载入示例 JSON');
  }, []);

  /** 清空 */
  const handleClear = useCallback(() => {
    setInput('');
    setNotice('已清空');
  }, []);

  return (
    <div class="jtx__container">
      {/* 输入区 */}
      <div class="jtx__panel">
        <div class="jtx__panel-header">
          <label for="jtx-input" class="jtx__label">JSON 输入</label>
          <div class="jtx__actions">
            <button type="button" class="jtx__btn jtx__btn--ghost" onClick={handleExample}>示例</button>
            <button type="button" class="jtx__btn jtx__btn--ghost" onClick={handleClear}>清空</button>
          </div>
        </div>
        <textarea
          id="jtx-input"
          class="jtx__textarea"
          spellcheck={false}
          placeholder="在此粘贴 JSON 数据..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </div>

      {/* 选项面板 */}
      <details class="jtx__options" open>
        <summary class="jtx__options-summary">转换选项</summary>
        <div class="jtx__options-grid">
          <div class="jtx__option">
            <label for="jtx-root" class="jtx__option-label">根节点名</label>
            <input
              id="jtx-root"
              type="text"
              class="jtx__input"
              value={rootName}
              onChange={(e) => setRootName(e.target.value)}
              placeholder="root"
            />
          </div>
          <div class="jtx__option">
            <label for="jtx-item" class="jtx__option-label">数组项名</label>
            <input
              id="jtx-item"
              type="text"
              class="jtx__input"
              value={arrayItemName}
              onChange={(e) => setArrayItemName(e.target.value)}
              placeholder="item"
            />
          </div>
          <div class="jtx__option">
            <label for="jtx-indent" class="jtx__option-label">缩进</label>
            <select
              id="jtx-indent"
              class="jtx__select"
              value={String(indentChoice)}
              onChange={(e) => setIndentChoice(Number(e.target.value))}
            >
              {INDENT_OPTIONS.map((opt) => (
                <option value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div class="jtx__option jtx__option--checks">
            <label class="jtx__check">
              <input
                type="checkbox"
                checked={includeDeclaration}
                onChange={(e) => setIncludeDeclaration(e.target.checked)}
              />
              <span>包含 XML 声明</span>
            </label>
            <label class="jtx__check">
              <input
                type="checkbox"
                checked={useAttributes}
                onChange={(e) => setUseAttributes(e.target.checked)}
              />
              <span>扁平对象用属性</span>
            </label>
            <label class="jtx__check">
              <input
                type="checkbox"
                checked={useCdata}
                onChange={(e) => setUseCdata(e.target.checked)}
              />
              <span>特殊字符用 CDATA</span>
            </label>
            <label class="jtx__check">
              <input
                type="checkbox"
                checked={nilForNull}
                onChange={(e) => setNilForNull(e.target.checked)}
              />
              <span>null 用 xsi:nil</span>
            </label>
          </div>
        </div>
      </details>

      {/* 输出区 */}
      <div class="jtx__panel">
        <div class="jtx__panel-header">
          <span class="jtx__label">XML 输出</span>
          <div class="jtx__actions">
            <button
              type="button"
              class="jtx__btn"
              onClick={handleCopy}
              disabled={!result?.ok}
            >
              复制
            </button>
            <button
              type="button"
              class="jtx__btn"
              onClick={handleDownload}
              disabled={!result?.ok}
            >
              下载 .xml
            </button>
          </div>
        </div>

        {/* 错误提示 */}
        {result && !result.ok && (
          <div class="jtx__error" role="alert">
            <strong>转换失败：</strong>
            {result.error}
          </div>
        )}

        {/* 输出内容 */}
        {result?.ok && (
          <>
            <pre class="jtx__output" aria-live="polite">{result.xml}</pre>

            {/* 校验状态 */}
            {validation && (
              <div class={`jtx__validation ${validation.valid ? 'jtx__validation--ok' : 'jtx__validation--err'}`}>
                {validation.valid ? (
                  <span>well-formed 校验通过</span>
                ) : (
                  <ul>
                    {validation.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* 警告列表 */}
            {result.warnings.length > 0 && (
              <div class="jtx__warnings">
                <strong>警告：</strong>
                <ul>
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 统计信息 */}
            <div class="jtx__stats">{formatStats(result.stats)}</div>
          </>
        )}

        {/* 空状态 */}
        {!result && (
          <div class="jtx__empty">输入 JSON 后将自动转换为 XML</div>
        )}
      </div>

      {/* 状态条 */}
      {notice && (
        <div class="jtx__notice" role="status" aria-live="polite">
          {notice}
        </div>
      )}

      {/* 联动链接 */}
      <nav class="jtx__links" aria-label="相关工具">
        <span>相关工具：</span>
        <a href="/csv-json">CSV / JSON 互转</a>
        <a href="/yaml">YAML 格式化</a>
        <a href="/json">JSON 格式化</a>
        <a href="/json-to-ts">JSON 转 TypeScript</a>
      </nav>
    </div>
  );
}
