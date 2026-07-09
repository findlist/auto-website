import { useState, useMemo, useCallback } from 'react';
import { parse as tomlParse, TomlDate, TomlError } from 'smol-toml';
import { copyText } from '../utils/clipboard';
import { validate, type ValidationError } from '../utils/jsonSchema';

/**
 * TOML Schema 校验工具组件
 *
 * 功能：
 *  - 左栏编辑 JSON Schema（draft-07），右栏编辑 TOML 数据
 *  - TOML 解析为 JS 对象后复用 jsonSchema.ts 校验引擎
 *  - TOML 类型陷阱提示：
 *    1. 日期时间值（TomlDate）转 JSON 后变成 ISO 字符串，原始类型与时区信息丢失
 *    2. 64 位整数超过 Number.MAX_SAFE_INTEGER 时精度丢失
 *  - 错误路径精确定位、关键字分类徽章、中文错误消息
 *
 * 全部本地处理，零网络请求。
 */

// 示例 Schema：PEP 621 pyproject.toml 项目元数据简化模型
const SAMPLE_SCHEMA = `{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PEP 621 pyproject.toml 简化模型",
  "type": "object",
  "required": ["project", "build-system"],
  "properties": {
    "build-system": {
      "type": "object",
      "required": ["requires", "build-backend"],
      "properties": {
        "requires": { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 } },
        "build-backend": { "type": "string", "minLength": 1 }
      }
    },
    "project": {
      "type": "object",
      "required": ["name", "version", "requires-python"],
      "properties": {
        "name": { "type": "string", "minLength": 1, "maxLength": 214 },
        "version": { "type": "string", "pattern": "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+" },
        "description": { "type": "string" },
        "requires-python": { "type": "string", "minLength": 1 },
        "dependencies": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 }
        },
        "authors": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["name"],
            "properties": {
              "name": { "type": "string", "minLength": 1 },
              "email": { "type": "string", "format": "email" }
            }
          }
        }
      }
    }
  },
  "additionalProperties": false
}`;

// 示例 TOML 数据：pyproject.toml，故意含 2 处错误
// 错误1：requires-python = 3.8（TOML 类型陷阱，3.8 被解析为浮点数，触发 type=string 错误）
// 错误2：dependencies 第二项为空字符串 ""（触发 minLength 错误）
const SAMPLE_DATA = `[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

[project]
name = "toolbox"
version = "1.0.0"
description = "中文开发者工具集"
requires-python = 3.8
dependencies = [
    "requests>=2.28",
    "",
]`;

interface ParseState {
  ok: boolean;
  value: unknown;
  error: string;
}

/** TOML 类型陷阱提示项 */
interface TomlTrap {
  path: string;
  raw: string;
  reason: string;
}

/** 解析 JSON 文本（Schema 侧） */
function tryParseJson(text: string): ParseState {
  if (text.trim() === '') return { ok: false, value: null, error: 'Schema 输入为空' };
  try {
    return { ok: true, value: JSON.parse(text), error: '' };
  } catch (e) {
    return { ok: false, value: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 递归遍历解析结果，收集所有 TomlDate 实例的路径与类型信息 */
function collectTomlDateTraps(obj: unknown, basePath: string, traps: TomlTrap[]): void {
  if (obj instanceof TomlDate) {
    // TomlDate 继承自 Date，smol-toml 用私有字段标记其原始类型
    let typeLabel = '日期时间';
    if (obj.isTime()) {
      typeLabel = '本地时间';
    } else if (obj.isDate()) {
      typeLabel = '本地日期';
    } else if (obj.isDateTime() && obj.isLocal()) {
      typeLabel = '本地日期时间';
    } else if (obj.isDateTime()) {
      typeLabel = '偏移日期时间';
    }
    traps.push({
      path: basePath || '(根)',
      raw: obj.toISOString(),
      reason: `TOML ${typeLabel}值在 JSON 校验时会变成 ISO 字符串（"${obj.toISOString()}"），原始类型与时区信息丢失。如需按字符串校验，请在 Schema 中声明 type=string + format=date-time；如需保留原始格式，请在消费端按字符串还原。`,
    });
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => collectTomlDateTraps(item, `${basePath}[${idx}]`, traps));
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const [key, val] of Object.entries(obj)) {
      const nextPath = basePath ? `${basePath}.${key}` : key;
      collectTomlDateTraps(val, nextPath, traps);
    }
  }
}

/** 扫描 TOML 源文本，检测超过 Number.MAX_SAFE_INTEGER 的十进制整数
 *  TOML 支持 64 位整数（最大 9223372036854775807），但 JS Number 只能安全表示到 2^53-1 */
function collectLargeIntTraps(text: string, traps: TomlTrap[]): void {
  const lines = text.split('\n');
  // 匹配「键 = 值」中的十进制整数值（含下划线、正负号）
  const INT_RE = /(^|[=\s])([+-]?\d[\d_]*)(?=\s|$|[#])/g;
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    let match: RegExpExecArray | null;
    INT_RE.lastIndex = 0;
    while ((match = INT_RE.exec(line)) !== null) {
      const raw = match[2];
      const cleaned = raw.replace(/_/g, '');
      if (!/^[+-]?\d+$/.test(cleaned)) continue;
      const num = Number(cleaned);
      if (!Number.isSafeInteger(num)) {
        traps.push({
          path: `第 ${idx + 1} 行`,
          raw,
          reason: `整数 ${raw} 超过 Number.MAX_SAFE_INTEGER（2^53-1 = 9007199254740991），转 JS Number 后会丢失精度。如需精确表示，请在消费端用 BigInt 或字符串处理。`,
        });
      }
    }
  });
}

/** 解析 TOML 文本（数据侧），返回解析状态与陷阱提示 */
function tryParseToml(text: string): { state: ParseState; traps: TomlTrap[] } {
  if (text.trim() === '') {
    return { state: { ok: false, value: null, error: '数据输入为空' }, traps: [] };
  }
  try {
    const value = tomlParse(text);
    const traps: TomlTrap[] = [];
    // 1. 收集 TomlDate 类型陷阱
    collectTomlDateTraps(value, '', traps);
    // 2. 收集大整数精度陷阱
    collectLargeIntTraps(text, traps);
    return { state: { ok: true, value, error: '' }, traps };
  } catch (e) {
    let msg = e instanceof Error ? e.message : String(e);
    if (e instanceof TomlError && e.line) {
      msg = `${e.message}（第 ${e.line} 行${e.column ? `, 第 ${e.column} 列` : ''}）`;
    }
    return { state: { ok: false, value: null, error: msg }, traps: [] };
  }
}

/** 统计字符数与行数 */
function computeStats(text: string) {
  const chars = text.length;
  const lines = chars === 0 ? 0 : text.split('\n').length;
  return { chars, lines };
}

/** 关键字徽章颜色映射（与 JsonSchemaTool/YamlSchemaTool 一致） */
function keywordClass(keyword: string): string {
  if (['type', 'enum', 'const'].includes(keyword)) return 'tschematool__kw--type';
  if (['required', 'properties', 'additionalProperties', 'minProperties', 'maxProperties', 'patternProperties'].includes(keyword)) return 'tschematool__kw--object';
  if (['items', 'additionalItems', 'minItems', 'maxItems', 'uniqueItems'].includes(keyword)) return 'tschematool__kw--array';
  if (['minLength', 'maxLength', 'pattern', 'format'].includes(keyword)) return 'tschematool__kw--string';
  if (['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'].includes(keyword)) return 'tschematool__kw--number';
  if (['allOf', 'anyOf', 'oneOf', 'not', '$ref'].includes(keyword)) return 'tschematool__kw--logic';
  return 'tschematool__kw--other';
}

export default function TomlSchemaTool() {
  const [schemaText, setSchemaText] = useState<string>('');
  const [dataText, setDataText] = useState<string>('');
  const [notice, setNotice] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [activePath, setActivePath] = useState<string>('');

  const schemaStats = useMemo(() => computeStats(schemaText), [schemaText]);
  const dataStats = useMemo(() => computeStats(dataText), [dataText]);

  // 实时校验：解析 Schema（JSON）与数据（TOML），两者均成功才校验
  const { schemaParse, tomlResult, result } = useMemo(() => {
    const sp = tryParseJson(schemaText);
    const tp = tryParseToml(dataText);
    if (sp.ok && tp.state.ok) {
      return {
        schemaParse: sp,
        tomlResult: tp,
        result: validate(tp.state.value, sp.value),
      };
    }
    return {
      schemaParse: sp,
      tomlResult: tp,
      result: null as ReturnType<typeof validate> | null,
    };
  }, [schemaText, dataText]);

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

  const handleSample = useCallback(() => {
    setSchemaText(SAMPLE_SCHEMA);
    setDataText(SAMPLE_DATA);
    setNotice('');
    setActivePath('');
  }, []);

  const handleClear = useCallback(() => {
    setSchemaText('');
    setDataText('');
    setNotice('');
    setActivePath('');
    setCopied(false);
  }, []);

  const handleErrorClick = useCallback((path: string) => {
    setActivePath((prev) => (prev === path ? '' : path));
  }, []);

  // 渲染结果区
  let resultEl: JSX.Element;
  const traps = tomlResult.traps;
  if (!schemaText.trim() && !dataText.trim()) {
    resultEl = <div className="tschematool__hint">输入 Schema 与 TOML 数据后将自动校验，或点击「载入示例」快速体验。</div>;
  } else if (!schemaParse.ok && !tomlResult.state.ok) {
    resultEl = (
      <div className="tschematool__errors">
        <div className="tschematool__error-row tschematool__error-row--parse">
          <span className="tschematool__kw tschematool__kw--other">Schema</span>
          <span>Schema 解析失败：{schemaParse.error}</span>
        </div>
        <div className="tschematool__error-row tschematool__error-row--parse">
          <span className="tschematool__kw tschematool__kw--other">TOML</span>
          <span>TOML 解析失败：{tomlResult.state.error}</span>
        </div>
      </div>
    );
  } else if (!schemaParse.ok) {
    resultEl = (
      <div className="tschematool__errors">
        <div className="tschematool__error-row tschematool__error-row--parse">
          <span className="tschematool__kw tschematool__kw--other">Schema</span>
          <span>Schema 解析失败：{schemaParse.error}</span>
        </div>
      </div>
    );
  } else if (!tomlResult.state.ok) {
    resultEl = (
      <div className="tschematool__errors">
        <div className="tschematool__error-row tschematool__error-row--parse">
          <span className="tschematool__kw tschematool__kw--other">TOML</span>
          <span>TOML 解析失败：{tomlResult.state.error}</span>
        </div>
      </div>
    );
  } else if (result && result.valid && traps.length === 0) {
    resultEl = (
      <div className="tschematool__pass" role="status">
        <span className="tschematool__pass-icon" aria-hidden="true">✅</span>
        <span>校验通过，TOML 数据完全符合 Schema 约束。</span>
      </div>
    );
  } else if ((result && result.errors.length > 0) || traps.length > 0) {
    resultEl = (
      <div className="tschematool__errors" role="alert">
        {result && result.errors.length > 0 && (
          <>
            <div className="tschematool__error-head">
              <span>共 {result.errors.length} 处校验错误</span>
              <button type="button" className="btn btn--sm tschematool__copy" onClick={handleCopy} aria-label="复制错误列表">
                {copied ? '已复制' : '复制错误'}
              </button>
            </div>
            <ul className="tschematool__error-list" role="list">
              {result.errors.map((err: ValidationError, i: number) => (
                <li
                  key={`err-${i}`}
                  className={`tschematool__error-row${activePath === err.path ? ' tschematool__error-row--active' : ''}`}
                  onClick={() => handleErrorClick(err.path)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleErrorClick(err.path); }}
                >
                  <span className={`tschematool__kw ${keywordClass(err.keyword)}`}>{err.keyword}</span>
                  <span className="tschematool__error-path">{err.path || '(根节点)'}</span>
                  <span className="tschematool__error-msg">{err.message}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {/* TOML 类型陷阱提示区 */}
        {traps.length > 0 && (
          <div className="tschematool__traps">
            <div className="tschematool__traps-head">
              <span>共 {traps.length} 条 TOML 类型提示</span>
            </div>
            <ul className="tschematool__trap-list" role="list">
              {traps.map((t, i) => (
                <li key={`trap-${i}`} className="tschematool__trap-row">
                  <span className="tschematool__kw tschematool__kw--other">TOML</span>
                  <span className="tschematool__trap-path">{t.path}</span>
                  <span className="tschematool__trap-msg">{t.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  } else {
    resultEl = <div className="tschematool__hint">等待校验…</div>;
  }

  return (
    <div className="tschematool">
      {/* 工具栏 */}
      <div className="tschematool__toolbar" role="toolbar" aria-label="TOML Schema 校验操作">
        <div className="tschematool__actions">
          <button className="btn btn--sm" onClick={handleSample}>载入示例</button>
          <button className="btn btn--sm" onClick={handleClear}>清空</button>
        </div>
        <div className="tschematool__hint-text">
          TOML 数据 + JSON Schema（draft-07），自动校验并提示类型陷阱。
        </div>
      </div>

      {/* 双栏编辑器：左 Schema（JSON）/ 右 数据（TOML） */}
      <div className="tschematool__panels">
        <div className="tschematool__panel">
          <label htmlFor="tschematool-schema" className="tschematool__label">
            JSON Schema
            <span className="tschematool__stat">{schemaStats.chars} 字 · {schemaStats.lines} 行</span>
          </label>
          <textarea
            id="tschematool-schema"
            className="tschematool__textarea"
            value={schemaText}
            onChange={(e) => setSchemaText(e.target.value)}
            placeholder='在此粘贴 JSON Schema（draft-07），如：{"type":"object","required":["project"],...}'
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            aria-label="JSON Schema 输入"
          />
        </div>
        <div className="tschematool__panel">
          <label htmlFor="tschematool-data" className="tschematool__label">
            TOML 数据
            <span className="tschematool__stat">{dataStats.chars} 字 · {dataStats.lines} 行</span>
          </label>
          <textarea
            id="tschematool-data"
            className="tschematool__textarea"
            value={dataText}
            onChange={(e) => setDataText(e.target.value)}
            placeholder={'在此粘贴待校验的 TOML 数据\n如 pyproject.toml、Cargo.toml、rust-toolchain.toml 等'}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            aria-label="待校验 TOML 数据输入"
          />
        </div>
      </div>

      {/* 结果区 */}
      <div className="tschematool__result" aria-live="polite">
        <div className="tschematool__result-head">
          <h3>校验结果</h3>
          {result && (
            <span className={`tschematool__badge${result.valid ? ' tschematool__badge--pass' : ' tschematool__badge--fail'}`}>
              {result.valid ? '通过' : `${result.errors.length} 错误`}
            </span>
          )}
        </div>
        {resultEl}
        {notice && <div className="tschematool__notice" role="status">{notice}</div>}
      </div>

      {/* 底部隐私提示 */}
      <div className="tschematool__footer">
        所有 Schema 与 TOML 数据仅在你浏览器内校验，不会上传到任何服务器。
      </div>
    </div>
  );
}
