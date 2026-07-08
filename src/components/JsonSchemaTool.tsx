import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';
import { validate, type ValidationError } from '../utils/jsonSchema';

/**
 * JSON Schema 校验工具组件
 *
 * 功能：
 *  - 左右双栏：左侧编辑 Schema，右侧编辑待校验数据
 *  - 实时校验：输入变化即用 Schema 校验数据
 *  - 结果展示：通过 ✅；失败列出每条错误的路径 / 关键字 / 中文消息
 *  - 错误定位：点击错误项高亮对应数据路径
 *  - 支持载入示例、清空、复制结果
 *
 * 全部本地处理，零网络请求。
 */

// 示例 Schema：覆盖 object/required/properties/字符串约束/数值范围/数组/enum/format
const SAMPLE_SCHEMA = `{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "用户",
  "description": "演示用 JSON Schema",
  "type": "object",
  "required": ["id", "name", "email"],
  "properties": {
    "id": { "type": "integer", "minimum": 1 },
    "name": { "type": "string", "minLength": 2, "maxLength": 32 },
    "email": { "type": "string", "format": "email" },
    "age": { "type": "integer", "minimum": 0, "maximum": 150 },
    "role": { "type": "string", "enum": ["admin", "editor", "viewer"] },
    "tags": {
      "type": "array",
      "items": { "type": "string", "minLength": 1 },
      "uniqueItems": true,
      "maxItems": 10
    },
    "homepage": { "type": "string", "format": "uri" }
  },
  "additionalProperties": false
}`;

// 示例数据：故意包含 2 处错误（age 超范围、tags 含重复）
const SAMPLE_DATA = `{
  "id": 1,
  "name": "工具盒子",
  "email": "dev@example.com",
  "age": 200,
  "role": "editor",
  "tags": ["json", "schema", "json"],
  "homepage": "https://example.com"
}`;

interface ParseState {
  ok: boolean;
  value: unknown;
  error: string;
}

/** 解析 JSON 文本，返回解析状态与错误信息 */
function tryParse(text: string): ParseState {
  if (text.trim() === '') return { ok: false, value: null, error: '输入为空' };
  try {
    return { ok: true, value: JSON.parse(text), error: '' };
  } catch (e) {
    return { ok: false, value: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 统计字符数与行数 */
function computeStats(text: string) {
  const chars = text.length;
  const lines = chars === 0 ? 0 : text.split('\n').length;
  return { chars, lines };
}

/** 关键字徽章颜色映射（按关键字分类着色） */
function keywordClass(keyword: string): string {
  if (['type', 'enum', 'const'].includes(keyword)) return 'jschematool__kw--type';
  if (['required', 'properties', 'additionalProperties', 'minProperties', 'maxProperties', 'patternProperties'].includes(keyword)) return 'jschematool__kw--object';
  if (['items', 'additionalItems', 'minItems', 'maxItems', 'uniqueItems'].includes(keyword)) return 'jschematool__kw--array';
  if (['minLength', 'maxLength', 'pattern', 'format'].includes(keyword)) return 'jschematool__kw--string';
  if (['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'].includes(keyword)) return 'jschematool__kw--number';
  if (['allOf', 'anyOf', 'oneOf', 'not', '$ref'].includes(keyword)) return 'jschematool__kw--logic';
  return 'jschematool__kw--other';
}

export default function JsonSchemaTool() {
  const [schemaText, setSchemaText] = useState<string>('');
  const [dataText, setDataText] = useState<string>('');
  const [notice, setNotice] = useState<string>('');
  const [copied, setCopied] = useState(false);
  // 高亮的错误路径（点击错误项时设置，用于结果区视觉关联）
  const [activePath, setActivePath] = useState<string>('');

  const schemaStats = useMemo(() => computeStats(schemaText), [schemaText]);
  const dataStats = useMemo(() => computeStats(dataText), [dataText]);

  // 实时校验：解析 schema 与 data，调用校验器；两者均解析成功才执行校验
  const { schemaParse, dataParse, result } = useMemo(() => {
    const sp = tryParse(schemaText);
    const dp = tryParse(dataText);
    if (sp.ok && dp.ok) {
      return { schemaParse: sp, dataParse: dp, result: validate(dp.value, sp.value) };
    }
    return {
      schemaParse: sp,
      dataParse: dp,
      result: null as ReturnType<typeof validate> | null,
    };
  }, [schemaText, dataText]);

  /** 复制错误列表为纯文本 */
  const handleCopy = useCallback(async () => {
    if (!result || result.errors.length === 0) return;
    const text = result.errors.map((e) => `[${e.keyword}] ${e.path || '(根)'}: ${e.message}`).join('\n');
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      setNotice('已复制错误列表');
      setTimeout(() => { setCopied(false); setNotice(''); }, 1500);
    } else {
      setNotice('复制失败，请手动复制');
      setTimeout(() => setNotice(''), 1800);
    }
  }, [result]);

  /** 载入示例 */
  const handleSample = useCallback(() => {
    setSchemaText(SAMPLE_SCHEMA);
    setDataText(SAMPLE_DATA);
    setNotice('');
    setActivePath('');
  }, []);

  /** 清空 */
  const handleClear = useCallback(() => {
    setSchemaText('');
    setDataText('');
    setNotice('');
    setActivePath('');
    setCopied(false);
  }, []);

  /** 点击错误项：高亮该路径 */
  const handleErrorClick = useCallback((path: string) => {
    setActivePath((prev) => (prev === path ? '' : path));
  }, []);

  // 渲染结果区
  let resultEl: JSX.Element;
  if (!schemaText.trim() && !dataText.trim()) {
    resultEl = <div className="jschematool__hint">输入 Schema 与数据后将自动校验，或点击「载入示例」快速体验。</div>;
  } else if (!schemaParse.ok && !dataParse.ok) {
    resultEl = (
      <div className="jschematool__errors">
        <div className="jschematool__error-row jschematool__error-row--parse">
          <span className="jschematool__kw jschematool__kw--other">Schema</span>
          <span>Schema 解析失败：{schemaParse.error}</span>
        </div>
        <div className="jschematool__error-row jschematool__error-row--parse">
          <span className="jschematool__kw jschematool__kw--other">Data</span>
          <span>数据解析失败：{dataParse.error}</span>
        </div>
      </div>
    );
  } else if (!schemaParse.ok) {
    resultEl = (
      <div className="jschematool__errors">
        <div className="jschematool__error-row jschematool__error-row--parse">
          <span className="jschematool__kw jschematool__kw--other">Schema</span>
          <span>Schema 解析失败：{schemaParse.error}</span>
        </div>
      </div>
    );
  } else if (!dataParse.ok) {
    resultEl = (
      <div className="jschematool__errors">
        <div className="jschematool__error-row jschematool__error-row--parse">
          <span className="jschematool__kw jschematool__kw--other">Data</span>
          <span>数据解析失败：{dataParse.error}</span>
        </div>
      </div>
    );
  } else if (result && result.valid) {
    resultEl = (
      <div className="jschematool__pass" role="status">
        <span className="jschematool__pass-icon" aria-hidden="true">✅</span>
        <span>校验通过，数据完全符合 Schema 约束。</span>
      </div>
    );
  } else if (result && result.errors.length > 0) {
    resultEl = (
      <div className="jschematool__errors" role="alert">
        <div className="jschematool__error-head">
          <span>共 {result.errors.length} 处错误</span>
          <button type="button" className="btn btn--sm jschematool__copy" onClick={handleCopy} aria-label="复制错误列表">
            {copied ? '已复制' : '复制错误'}
          </button>
        </div>
        <ul className="jschematool__error-list" role="list">
          {result.errors.map((err: ValidationError, i: number) => (
            <li
              key={i}
              className={`jschematool__error-row${activePath === err.path ? ' jschematool__error-row--active' : ''}`}
              onClick={() => handleErrorClick(err.path)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleErrorClick(err.path); }}
            >
              <span className={`jschematool__kw ${keywordClass(err.keyword)}`}>{err.keyword}</span>
              <span className="jschematool__error-path">{err.path || '(根节点)'}</span>
              <span className="jschematool__error-msg">{err.message}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  } else {
    resultEl = <div className="jschematool__hint">等待校验…</div>;
  }

  return (
    <div className="jschematool">
      {/* 工具栏 */}
      <div className="jschematool__toolbar" role="toolbar" aria-label="JSON Schema 校验操作">
        <div className="jschematool__actions">
          <button className="btn btn--sm" onClick={handleSample}>载入示例</button>
          <button className="btn btn--sm" onClick={handleClear}>清空</button>
        </div>
        <div className="jschematool__hint-text">
          自动校验，支持 draft-07 核心关键字与 <code>$ref</code> 内部引用。
        </div>
      </div>

      {/* 双栏编辑器 */}
      <div className="jschematool__panels">
        <div className="jschematool__panel">
          <label htmlFor="jschematool-schema" className="jschematool__label">
            JSON Schema
            <span className="jschematool__stat">{schemaStats.chars} 字 · {schemaStats.lines} 行</span>
          </label>
          <textarea
            id="jschematool-schema"
            className="jschematool__textarea"
            value={schemaText}
            onChange={(e) => setSchemaText(e.target.value)}
            placeholder='在此粘贴 JSON Schema，如：{"type":"object","required":["id"],"properties":{...}}'
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            aria-label="JSON Schema 输入"
          />
        </div>
        <div className="jschematool__panel">
          <label htmlFor="jschematool-data" className="jschematool__label">
            待校验数据
            <span className="jschematool__stat">{dataStats.chars} 字 · {dataStats.lines} 行</span>
          </label>
          <textarea
            id="jschematool-data"
            className="jschematool__textarea"
            value={dataText}
            onChange={(e) => setDataText(e.target.value)}
            placeholder='在此粘贴待校验的 JSON 数据'
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            aria-label="待校验 JSON 数据输入"
          />
        </div>
      </div>

      {/* 结果区 */}
      <div className="jschematool__result" aria-live="polite">
        <div className="jschematool__result-head">
          <h3>校验结果</h3>
          {result && (
            <span className={`jschematool__badge${result.valid ? ' jschematool__badge--pass' : ' jschematool__badge--fail'}`}>
              {result.valid ? '通过' : `${result.errors.length} 错误`}
            </span>
          )}
        </div>
        {resultEl}
        {notice && <div className="jschematool__notice" role="status">{notice}</div>}
      </div>

      {/* 底部隐私提示 */}
      <div className="jschematool__footer">
        所有 Schema 与数据仅在你浏览器内校验，不会上传到任何服务器。
      </div>
    </div>
  );
}
