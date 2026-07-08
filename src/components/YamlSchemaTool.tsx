import { useState, useMemo, useCallback } from 'react';
import yaml from 'js-yaml';
import { copyText } from '../utils/clipboard';
import { validate, type ValidationError } from '../utils/jsonSchema';

/**
 * YAML Schema 校验工具组件
 *
 * 功能：
 *  - 左栏编辑 JSON Schema（draft-07），右栏编辑 YAML 数据
 *  - YAML 解析为 JS 对象后复用 jsonSchema.ts 校验引擎
 *  - YAML 类型推断陷阱提示（yes/no/on/off 布尔化、数字科学计数法等）
 *  - 错误路径精确定位、关键字分类徽章、中文错误消息
 *
 * 全部本地处理，零网络请求。
 */

// 示例 Schema：K8s Deployment 风格的简化模型
const SAMPLE_SCHEMA = `{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "K8s Deployment 简化模型",
  "type": "object",
  "required": ["apiVersion", "kind", "metadata", "spec"],
  "properties": {
    "apiVersion": { "type": "string", "enum": ["apps/v1", "batch/v1", "v1"] },
    "kind": { "type": "string", "enum": ["Deployment", "Job", "Pod", "Service"] },
    "metadata": {
      "type": "object",
      "required": ["name"],
      "properties": {
        "name": { "type": "string", "minLength": 1, "maxLength": 253 },
        "namespace": { "type": "string", "pattern": "^[a-z0-9]([-a-z0-9]*[a-z0-9])?$" },
        "labels": { "type": "object", "additionalProperties": { "type": "string" } }
      }
    },
    "spec": {
      "type": "object",
      "required": ["replicas", "selector", "template"],
      "properties": {
        "replicas": { "type": "integer", "minimum": 0, "maximum": 1000 },
        "selector": {
          "type": "object",
          "required": ["matchLabels"],
          "properties": {
            "matchLabels": { "type": "object", "minProperties": 1 }
          }
        },
        "template": {
          "type": "object",
          "required": ["metadata", "spec"],
          "properties": {
            "metadata": { "type": "object" },
            "spec": {
              "type": "object",
              "required": ["containers"],
              "properties": {
                "containers": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "object",
                    "required": ["name", "image"],
                    "properties": {
                      "name": { "type": "string", "minLength": 1 },
                      "image": { "type": "string", "minLength": 1 },
                      "ports": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "required": ["containerPort"],
                          "properties": {
                            "containerPort": { "type": "integer", "minimum": 1, "maximum": 65535 }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "additionalProperties": false
}`;

// 示例 YAML 数据：K8s Deployment，故意含 2 处错误
// 错误1：replicas: on （YAML 类型陷阱，on 被解析为布尔 true，触发 type=integer 错误）
// 错误2：第二个容器缺少 image 字段（required 缺失）
const SAMPLE_DATA = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-deployment
  namespace: default
  labels:
    app: nginx
spec:
  replicas: on
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
        - name: nginx
          image: nginx:1.25
          ports:
            - containerPort: 80
        - name: sidecar`;

interface ParseState {
  ok: boolean;
  value: unknown;
  error: string;
}

/** YAML 类型推断陷阱提示项 */
interface YamlTrap {
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

/** 解析 YAML 文本（数据侧），返回解析状态与陷阱提示
 *  使用默认 schema 解析（贴近真实场景），并扫描原始文本检测类型推断陷阱
 */
function tryParseYaml(text: string): { state: ParseState; traps: YamlTrap[] } {
  if (text.trim() === '') {
    return { state: { ok: false, value: null, error: '数据输入为空' }, traps: [] };
  }
  try {
    const value = yaml.load(text);
    const traps = detectYamlTraps(text);
    return { state: { ok: true, value, error: '' }, traps };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { state: { ok: false, value: null, error: msg }, traps: [] };
  }
}

/**
 * 检测 YAML 类型推断陷阱：扫描原始文本行，识别易被误解的值
 * 常见陷阱：yes/no/on/off → boolean、null/~ → null、数字科学计数法、日期自动解析
 */
function detectYamlTraps(text: string): YamlTrap[] {
  const traps: YamlTrap[] = [];
  const boolWords = ['yes', 'no', 'on', 'off', 'true', 'false', 'True', 'False', 'TRUE', 'FALSE'];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 跳过注释行与空行
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // 匹配 "key: value" 形式（简单匹配，不处理多行/流式）
    const match = line.match(/^(\s*-?\s*)([^\s:]+):\s*(.+?)\s*$/);
    if (!match) continue;
    const [, , key, val] = match;
    // 布尔词陷阱
    if (boolWords.includes(val)) {
      traps.push({
        path: key,
        raw: val,
        reason: `值 "${val}" 被 YAML 解析为布尔值，若需字符串请加引号：${key}: "${val}"`,
      });
    }
    // null 词陷阱
    if (val === 'null' || val === '~') {
      traps.push({
        path: key,
        raw: val,
        reason: `值 "${val}" 被 YAML 解析为 null，若需字符串请加引号`,
      });
    }
    // 数字开头的版本号陷阱（如 1.25 可能被解析为数字）
    if (/^\d+\.\d+$/.test(val) && !val.includes('e') && !val.includes('E')) {
      // 版本号场景常见，提示但不强制
      traps.push({
        path: key,
        raw: val,
        reason: `值 "${val}" 被解析为数字，若为版本号请加引号：${key}: "${val}"`,
      });
    }
  }
  return traps;
}

/** 统计字符数与行数 */
function computeStats(text: string) {
  const chars = text.length;
  const lines = chars === 0 ? 0 : text.split('\n').length;
  return { chars, lines };
}

/** 关键字徽章颜色映射（与 JsonSchemaTool 一致） */
function keywordClass(keyword: string): string {
  if (['type', 'enum', 'const'].includes(keyword)) return 'yschematool__kw--type';
  if (['required', 'properties', 'additionalProperties', 'minProperties', 'maxProperties', 'patternProperties'].includes(keyword)) return 'yschematool__kw--object';
  if (['items', 'additionalItems', 'minItems', 'maxItems', 'uniqueItems'].includes(keyword)) return 'yschematool__kw--array';
  if (['minLength', 'maxLength', 'pattern', 'format'].includes(keyword)) return 'yschematool__kw--string';
  if (['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'].includes(keyword)) return 'yschematool__kw--number';
  if (['allOf', 'anyOf', 'oneOf', 'not', '$ref'].includes(keyword)) return 'yschematool__kw--logic';
  return 'yschematool__kw--other';
}

export default function YamlSchemaTool() {
  const [schemaText, setSchemaText] = useState<string>('');
  const [dataText, setDataText] = useState<string>('');
  const [notice, setNotice] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [activePath, setActivePath] = useState<string>('');

  const schemaStats = useMemo(() => computeStats(schemaText), [schemaText]);
  const dataStats = useMemo(() => computeStats(dataText), [dataText]);

  // 实时校验：解析 Schema（JSON）与数据（YAML），两者均成功才校验
  const { schemaParse, yamlResult, result } = useMemo(() => {
    const sp = tryParseJson(schemaText);
    const yp = tryParseYaml(dataText);
    if (sp.ok && yp.state.ok) {
      return {
        schemaParse: sp,
        yamlResult: yp,
        result: validate(yp.state.value, sp.value),
      };
    }
    return {
      schemaParse: sp,
      yamlResult: yp,
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
  const traps = yamlResult.traps;
  if (!schemaText.trim() && !dataText.trim()) {
    resultEl = <div className="yschematool__hint">输入 Schema 与 YAML 数据后将自动校验，或点击「载入示例」快速体验。</div>;
  } else if (!schemaParse.ok && !yamlResult.state.ok) {
    resultEl = (
      <div className="yschematool__errors">
        <div className="yschematool__error-row yschematool__error-row--parse">
          <span className="yschematool__kw yschematool__kw--other">Schema</span>
          <span>Schema 解析失败：{schemaParse.error}</span>
        </div>
        <div className="yschematool__error-row yschematool__error-row--parse">
          <span className="yschematool__kw yschematool__kw--other">YAML</span>
          <span>YAML 解析失败：{yamlResult.state.error}</span>
        </div>
      </div>
    );
  } else if (!schemaParse.ok) {
    resultEl = (
      <div className="yschematool__errors">
        <div className="yschematool__error-row yschematool__error-row--parse">
          <span className="yschematool__kw yschematool__kw--other">Schema</span>
          <span>Schema 解析失败：{schemaParse.error}</span>
        </div>
      </div>
    );
  } else if (!yamlResult.state.ok) {
    resultEl = (
      <div className="yschematool__errors">
        <div className="yschematool__error-row yschematool__error-row--parse">
          <span className="yschematool__kw yschematool__kw--other">YAML</span>
          <span>YAML 解析失败：{yamlResult.state.error}</span>
        </div>
      </div>
    );
  } else if (result && result.valid && traps.length === 0) {
    resultEl = (
      <div className="yschematool__pass" role="status">
        <span className="yschematool__pass-icon" aria-hidden="true">✅</span>
        <span>校验通过，YAML 数据完全符合 Schema 约束。</span>
      </div>
    );
  } else if ((result && result.errors.length > 0) || traps.length > 0) {
    resultEl = (
      <div className="yschematool__errors" role="alert">
        {result && result.errors.length > 0 && (
          <>
            <div className="yschematool__error-head">
              <span>共 {result.errors.length} 处校验错误</span>
              <button type="button" className="btn btn--sm yschematool__copy" onClick={handleCopy} aria-label="复制错误列表">
                {copied ? '已复制' : '复制错误'}
              </button>
            </div>
            <ul className="yschematool__error-list" role="list">
              {result.errors.map((err: ValidationError, i: number) => (
                <li
                  key={`err-${i}`}
                  className={`yschematool__error-row${activePath === err.path ? ' yschematool__error-row--active' : ''}`}
                  onClick={() => handleErrorClick(err.path)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleErrorClick(err.path); }}
                >
                  <span className={`yschematool__kw ${keywordClass(err.keyword)}`}>{err.keyword}</span>
                  <span className="yschematool__error-path">{err.path || '(根节点)'}</span>
                  <span className="yschematool__error-msg">{err.message}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {/* YAML 类型推断陷阱提示区 */}
        {traps.length > 0 && (
          <div className="yschematool__traps">
            <div className="yschematool__traps-head">
              <span>共 {traps.length} 条 YAML 类型提示</span>
            </div>
            <ul className="yschematool__trap-list" role="list">
              {traps.map((t, i) => (
                <li key={`trap-${i}`} className="yschematool__trap-row">
                  <span className="yschematool__kw yschematool__kw--other">YAML</span>
                  <span className="yschematool__trap-path">{t.path}</span>
                  <span className="yschematool__trap-msg">{t.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  } else {
    resultEl = <div className="yschematool__hint">等待校验…</div>;
  }

  return (
    <div className="yschematool">
      {/* 工具栏 */}
      <div className="yschematool__toolbar" role="toolbar" aria-label="YAML Schema 校验操作">
        <div className="yschematool__actions">
          <button className="btn btn--sm" onClick={handleSample}>载入示例</button>
          <button className="btn btn--sm" onClick={handleClear}>清空</button>
        </div>
        <div className="yschematool__hint-text">
          YAML 数据 + JSON Schema（draft-07），自动校验并提示类型推断陷阱。
        </div>
      </div>

      {/* 双栏编辑器：左 Schema（JSON）/ 右 数据（YAML） */}
      <div className="yschematool__panels">
        <div className="yschematool__panel">
          <label htmlFor="yschematool-schema" className="yschematool__label">
            JSON Schema
            <span className="yschematool__stat">{schemaStats.chars} 字 · {schemaStats.lines} 行</span>
          </label>
          <textarea
            id="yschematool-schema"
            className="yschematool__textarea"
            value={schemaText}
            onChange={(e) => setSchemaText(e.target.value)}
            placeholder='在此粘贴 JSON Schema（draft-07），如：{"type":"object","required":["apiVersion"],...}'
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            aria-label="JSON Schema 输入"
          />
        </div>
        <div className="yschematool__panel">
          <label htmlFor="yschematool-data" className="yschematool__label">
            YAML 数据
            <span className="yschematool__stat">{dataStats.chars} 字 · {dataStats.lines} 行</span>
          </label>
          <textarea
            id="yschematool-data"
            className="yschematool__textarea"
            value={dataText}
            onChange={(e) => setDataText(e.target.value)}
            placeholder={'在此粘贴待校验的 YAML 数据\n如 K8s Deployment、CI/CD 配置等'}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            aria-label="待校验 YAML 数据输入"
          />
        </div>
      </div>

      {/* 结果区 */}
      <div className="yschematool__result" aria-live="polite">
        <div className="yschematool__result-head">
          <h3>校验结果</h3>
          {result && (
            <span className={`yschematool__badge${result.valid ? ' yschematool__badge--pass' : ' yschematool__badge--fail'}`}>
              {result.valid ? '通过' : `${result.errors.length} 错误`}
            </span>
          )}
        </div>
        {resultEl}
        {notice && <div className="yschematool__notice" role="status">{notice}</div>}
      </div>

      {/* 底部隐私提示 */}
      <div className="yschematool__footer">
        所有 Schema 与 YAML 数据仅在你浏览器内校验，不会上传到任何服务器。
      </div>
    </div>
  );
}
