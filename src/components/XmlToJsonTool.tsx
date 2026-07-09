import { useState, useEffect, useCallback } from 'react';
import { copyText } from '../utils/clipboard';
import { xmlToJson, formatStats, type XmlToJsonOptions, type XmlToJsonResult } from '../utils/xmlToJson';

/**
 * XML 转 JSON 转换工具
 *
 * 设计目标：
 *  - XML 文档 → JSON 数据单向转换（与 JsonToXmlTool 形成双向闭环）
 *  - 可配置属性名前缀、文本节点名、CDATA 处理、空元素表示、类型推断、缩进
 *  - 实时预览转换结果 + 统计信息（元素 / 属性 / 文本 / CDATA / 深度）
 *  - 复制 / 下载 .json 文件 / 示例 / 清空
 *
 * 与现有工具的区别：
 *  - JsonToXmlTool：JSON → XML 单向导出（SOAP / SVG / Office 场景）
 *  - CsvJsonTool：CSV ↔ JSON 双向互转（表格数据）
 *  - YamlTool：YAML ↔ JSON 双向格式化（配置文件）
 *  - 本工具：XML → JSON 单向解析（解析配置文件 / SOAP 响应 / SVG / RSS 等场景）
 */

/** 示例 XML：覆盖元素、属性、嵌套、CDATA、空元素、类型推断候选 */
const EXAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<project name="工具盒子" version="1.0.0" active="true">
  <title>中文开发者工具集</title>
  <description><![CDATA[支持 <特殊> 字符 & CDATA 原样保留]]></description>
  <score>95</score>
  <tags>
    <tag>前端</tag>
    <tag>工具</tag>
    <tag>零依赖</tag>
  </tags>
  <author>
    <name>Aether</name>
    <email>aether@example.com</email>
  </author>
  <features>
    <feature name="JSON 格式化" enabled="true"/>
    <feature name="Base64 编码" enabled="true"/>
  </features>
  <note/>
  <nullValue>null</nullValue>
</project>`;

/** 缩进选项：value === -1 表示 Tab，0 表示压缩 */
const INDENT_OPTIONS = [
  { label: '2 空格', value: 2 },
  { label: '4 空格', value: 4 },
  { label: 'Tab', value: -1 },
  { label: '压缩', value: 0 },
];

/** 空元素表示选项 */
const EMPTY_OPTIONS = [
  { label: 'null', value: 'null' },
  { label: '空字符串', value: 'empty' },
  { label: '空对象', value: 'object' },
] as const;

/** Tab 缩进检测 */
function isTabIndent(value: number): boolean {
  return value === -1;
}

/** 解析实际缩进值（Tab 用 1 占位，后续后处理替换为 \t） */
function resolveIndent(value: number): number {
  return value === -1 ? 1 : value;
}

export default function XmlToJsonTool() {
  const [input, setInput] = useState(EXAMPLE_XML);
  const [attributeNamePrefix, setAttributeNamePrefix] = useState('@');
  const [textNodeName, setTextNodeName] = useState('#text');
  const [cdataNodeName, setCdataNodeName] = useState('#cdata');
  const [emptyElementValue, setEmptyElementValue] =
    useState<XmlToJsonOptions['emptyElementValue']>('null');
  const [indentChoice, setIndentChoice] = useState(2);
  const [ignoreComments, setIgnoreComments] = useState(true);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(true);
  const [mergeCdata, setMergeCdata] = useState(true);
  const [coerceTypes, setCoerceTypes] = useState(false);
  const [alwaysArray, setAlwaysArray] = useState(false);
  const [notice, setNotice] = useState('');

  /** 实时转换结果（useEffect 避免 DOMParser 在服务端渲染时不可用导致的 hydration mismatch） */
  const [result, setResult] = useState<XmlToJsonResult | null>(null);

  useEffect(() => {
    if (!input.trim()) {
      setResult(null);
      return;
    }
    const tabIndent = isTabIndent(indentChoice);
    // 构造当前选项
    const opts: Partial<XmlToJsonOptions> = {
      attributeNamePrefix,
      textNodeName,
      cdataNodeName,
      ignoreComments,
      ignoreWhitespace,
      mergeCdata,
      coerceTypes,
      emptyElementValue,
      alwaysArray,
      indent: tabIndent ? 1 : resolveIndent(indentChoice),
    };
    const res = xmlToJson(input, opts);
    if (res.ok && tabIndent) {
      // 将空格缩进替换为 Tab：JSON.stringify 用单空格作缩进时，每层 1 空格
      const lines = res.json.split('\n');
      const tabbed = lines
        .map((line) => {
          const match = line.match(/^( +)/);
          if (!match) return line;
          const spaces = match[1].length;
          return '\t'.repeat(spaces) + line.slice(spaces);
        })
        .join('\n');
      setResult({ ...res, json: tabbed });
    } else {
      setResult(res);
    }
  }, [
    input,
    attributeNamePrefix,
    textNodeName,
    cdataNodeName,
    emptyElementValue,
    indentChoice,
    ignoreComments,
    ignoreWhitespace,
    mergeCdata,
    coerceTypes,
    alwaysArray,
  ]);

  /** 复制 JSON */
  const handleCopy = useCallback(async () => {
    if (!result?.ok) {
      setNotice('无可复制内容');
      return;
    }
    const ok = await copyText(result.json);
    setNotice(ok ? '已复制 JSON 到剪贴板' : '复制失败，请手动选择');
  }, [result]);

  /** 下载 .json 文件 */
  const handleDownload = useCallback(() => {
    if (!result?.ok) {
      setNotice('无可下载内容');
      return;
    }
    const blob = new Blob([result.json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'converted.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setNotice('已下载 converted.json');
  }, [result]);

  /** 载入示例 */
  const handleExample = useCallback(() => {
    setInput(EXAMPLE_XML);
    setNotice('已载入示例 XML');
  }, []);

  /** 清空 */
  const handleClear = useCallback(() => {
    setInput('');
    setNotice('已清空');
  }, []);

  return (
    <div className="xtj__container">
      {/* 输入区 */}
      <div className="xtj__panel">
        <div className="xtj__panel-header">
          <label htmlFor="xtj-input" className="xtj__label">XML 输入</label>
          <div className="xtj__actions">
            <button type="button" className="xtj__btn xtj__btn--ghost" onClick={handleExample}>示例</button>
            <button type="button" className="xtj__btn xtj__btn--ghost" onClick={handleClear}>清空</button>
          </div>
        </div>
        <textarea
          id="xtj-input"
          className="xtj__textarea"
          spellCheck={false}
          placeholder="在此粘贴 XML 数据..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </div>

      {/* 选项面板 */}
      <details className="xtj__options" open>
        <summary className="xtj__options-summary">转换选项</summary>
        <div className="xtj__options-grid">
          <div className="xtj__option">
            <label htmlFor="xtj-attr-prefix" className="xtj__option-label">属性名前缀</label>
            <input
              id="xtj-attr-prefix"
              type="text"
              className="xtj__input"
              value={attributeNamePrefix}
              onChange={(e) => setAttributeNamePrefix(e.target.value)}
              placeholder="@"
            />
          </div>
          <div className="xtj__option">
            <label htmlFor="xtj-text-name" className="xtj__option-label">文本节点字段名</label>
            <input
              id="xtj-text-name"
              type="text"
              className="xtj__input"
              value={textNodeName}
              onChange={(e) => setTextNodeName(e.target.value)}
              placeholder="#text"
            />
          </div>
          <div className="xtj__option">
            <label htmlFor="xtj-cdata-name" className="xtj__option-label">CDATA 字段名</label>
            <input
              id="xtj-cdata-name"
              type="text"
              className="xtj__input"
              value={cdataNodeName}
              onChange={(e) => setCdataNodeName(e.target.value)}
              placeholder="#cdata"
              disabled={mergeCdata}
            />
          </div>
          <div className="xtj__option">
            <label htmlFor="xtj-empty" className="xtj__option-label">空元素表示</label>
            <select
              id="xtj-empty"
              className="xtj__select"
              value={emptyElementValue}
              onChange={(e) => setEmptyElementValue(e.target.value as XmlToJsonOptions['emptyElementValue'])}
            >
              {EMPTY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="xtj__option">
            <label htmlFor="xtj-indent" className="xtj__option-label">缩进</label>
            <select
              id="xtj-indent"
              className="xtj__select"
              value={String(indentChoice)}
              onChange={(e) => setIndentChoice(Number(e.target.value))}
            >
              {INDENT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="xtj__option xtj__option--checks">
            <label className="xtj__check">
              <input
                type="checkbox"
                checked={ignoreComments}
                onChange={(e) => setIgnoreComments(e.target.checked)}
              />
              <span>忽略注释</span>
            </label>
            <label className="xtj__check">
              <input
                type="checkbox"
                checked={ignoreWhitespace}
                onChange={(e) => setIgnoreWhitespace(e.target.checked)}
              />
              <span>忽略空白文本</span>
            </label>
            <label className="xtj__check">
              <input
                type="checkbox"
                checked={mergeCdata}
                onChange={(e) => setMergeCdata(e.target.checked)}
              />
              <span>CDATA 合并到文本</span>
            </label>
            <label className="xtj__check">
              <input
                type="checkbox"
                checked={coerceTypes}
                onChange={(e) => setCoerceTypes(e.target.checked)}
              />
              <span>类型推断（数字 / 布尔 / null）</span>
            </label>
            <label className="xtj__check">
              <input
                type="checkbox"
                checked={alwaysArray}
                onChange={(e) => setAlwaysArray(e.target.checked)}
              />
              <span>子元素始终为数组</span>
            </label>
          </div>
        </div>
      </details>

      {/* 输出区 */}
      <div className="xtj__panel">
        <div className="xtj__panel-header">
          <span className="xtj__label">JSON 输出</span>
          <div className="xtj__actions">
            <button
              type="button"
              className="xtj__btn"
              onClick={handleCopy}
              disabled={!result?.ok}
            >
              复制
            </button>
            <button
              type="button"
              className="xtj__btn"
              onClick={handleDownload}
              disabled={!result?.ok}
            >
              下载 .json
            </button>
          </div>
        </div>

        {/* 错误提示 */}
        {result && !result.ok && (
          <div className="xtj__error" role="alert">
            <strong>转换失败：</strong>
            {result.error}
          </div>
        )}

        {/* 输出内容 */}
        {result?.ok && (
          <>
            <pre className="xtj__output" aria-live="polite">{result.json}</pre>

            {/* 警告列表 */}
            {result.warnings.length > 0 && (
              <div className="xtj__warnings">
                <strong>警告：</strong>
                <ul>
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 统计信息 */}
            <div className="xtj__stats">{formatStats(result.stats)}</div>
          </>
        )}

        {/* 空状态 */}
        {!result && (
          <div className="xtj__empty">输入 XML 后将自动转换为 JSON</div>
        )}
      </div>

      {/* 状态条 */}
      {notice && (
        <div className="xtj__notice" role="status" aria-live="polite">
          {notice}
        </div>
      )}

      {/* 联动链接 */}
      <nav className="xtj__links" aria-label="相关工具">
        <span>相关工具：</span>
        <a href="/json-to-xml">JSON 转 XML</a>
        <a href="/csv-json">CSV / JSON 互转</a>
        <a href="/yaml">YAML 格式化</a>
        <a href="/json">JSON 格式化</a>
      </nav>
    </div>
  );
}
