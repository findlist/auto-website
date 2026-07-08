import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';
import { query, validatePath, describePath, JSONPATH_PRESETS, SAMPLE_JSON } from '../utils/jsonPath';

/**
 * JSONPath 查询工具
 * 全部在浏览器本地处理，零依赖、零网络请求。
 *
 * 功能：
 *  - JSON 输入：textarea 可编辑，默认载入示例数据
 *  - JSONPath 表达式输入：实时校验语法、显示语义说明
 *  - 12 个预设示例：覆盖通配符、递归下降、索引、过滤表达式等场景
 *  - 结果展示：每条匹配值卡片 + 索引 + JSON 预览 + 单条复制
 *  - 复制全部结果：一键复制所有匹配值（JSON 数组格式）
 *  - 错误处理：JSON 解析错误、JSONPath 语法错误、空结果提示
 */

/** 默认 JSON 文本（序列化示例数据，2 空格缩进） */
const DEFAULT_JSON_TEXT = JSON.stringify(SAMPLE_JSON, null, 2);
/** 默认 JSONPath 表达式（第一个预设） */
const DEFAULT_PATH = JSONPATH_PRESETS[0].path;

export default function JsonPathTool() {
  // 输入状态：JSON 文本与 JSONPath 表达式
  const [jsonText, setJsonText] = useState<string>(DEFAULT_JSON_TEXT);
  const [pathExpr, setPathExpr] = useState<string>(DEFAULT_PATH);
  // 复制反馈状态
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState<boolean>(false);

  /** 解析 JSON 文本，返回解析结果或错误信息 */
  const jsonParseResult = useMemo<{ ok: boolean; data: unknown; error?: string }>(() => {
    const trimmed = jsonText.trim();
    if (trimmed === '') {
      return { ok: false, data: null, error: 'JSON 输入为空' };
    }
    try {
      const data = JSON.parse(trimmed);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, data: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [jsonText]);

  /** JSONPath 表达式校验结果（实时语法检查） */
  const pathValidation = useMemo(() => validatePath(pathExpr), [pathExpr]);

  /** 路径语义说明（用于 UI 提示） */
  const pathDescription = useMemo(() => describePath(pathExpr), [pathExpr]);

  /** 执行 JSONPath 查询（依赖 JSON 解析成功 + 路径语法合法） */
  const queryResult = useMemo(() => {
    if (!jsonParseResult.ok) {
      return { success: false, values: [], count: 0, error: 'JSON 数据无效，无法查询' };
    }
    if (!pathValidation.valid) {
      return { success: false, values: [], count: 0, error: pathValidation.error };
    }
    return query(jsonParseResult.data, pathExpr);
  }, [jsonParseResult, pathValidation, pathExpr]);

  /** 复制单条结果（按索引） */
  const handleCopyOne = useCallback(async (value: unknown, idx: number) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    const ok = await copyText(text);
    if (ok) {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    }
  }, []);

  /** 复制全部结果（JSON 数组格式） */
  const handleCopyAll = useCallback(async () => {
    if (!queryResult.success || queryResult.values.length === 0) return;
    const text = JSON.stringify(queryResult.values, null, 2);
    const ok = await copyText(text);
    if (ok) {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1500);
    }
  }, [queryResult]);

  /** 载入预设示例（仅替换路径，不替换 JSON） */
  const handlePreset = useCallback((path: string) => {
    setPathExpr(path);
  }, []);

  /** 载入示例 JSON 数据 */
  const handleLoadSample = useCallback(() => {
    setJsonText(DEFAULT_JSON_TEXT);
  }, []);

  /** 清空 JSON 输入 */
  const handleClearJson = useCallback(() => {
    setJsonText('');
  }, []);

  /** 格式化 JSON 输入 */
  const handleFormatJson = useCallback(() => {
    try {
      const data = JSON.parse(jsonText);
      setJsonText(JSON.stringify(data, null, 2));
    } catch {
      // 格式化失败时静默处理，错误已由 jsonParseResult 显示
    }
  }, [jsonText]);

  return (
    <div className="jpath">
      {/* 顶部：JSONPath 表达式输入区 */}
      <div className="jpath__expr-section">
        <label htmlFor="jpath-expr" className="jpath__label">
          JSONPath 表达式
        </label>
        <div className="jpath__expr-row">
          <input
            id="jpath-expr"
            type="text"
            className="jpath__expr-input"
            value={pathExpr}
            onChange={(e) => setPathExpr(e.currentTarget.value)}
            placeholder="例如：$.store.book[*].author 或 $..book[?(@.price < 10)]"
            aria-label="JSONPath 表达式输入框"
            spellCheck={false}
            autoComplete="off"
          />
          {pathValidation.valid && (
            <span className="jpath__expr-badge" title={pathDescription}>
              {pathDescription}
            </span>
          )}
        </div>
        {!pathValidation.valid && pathExpr.trim() !== '' && (
          <p className="jpath__expr-error" role="alert">
            语法错误：{pathValidation.error}
          </p>
        )}
      </div>

      {/* 预设示例区 */}
      <div className="jpath__presets">
        <div className="jpath__presets-title">预设示例（点击载入路径）：</div>
        <div className="jpath__presets-grid" role="list">
          {JSONPATH_PRESETS.map((preset) => (
            <button
              key={preset.path}
              type="button"
              className={`jpath__preset-btn${pathExpr === preset.path ? ' is-active' : ''}`}
              onClick={() => handlePreset(preset.path)}
              title={preset.description}
              aria-label={`载入预设：${preset.label}，表达式 ${preset.path}`}
            >
              <span className="jpath__preset-label">{preset.label}</span>
              <code className="jpath__preset-path">{preset.path}</code>
            </button>
          ))}
        </div>
      </div>

      {/* 主体：左右双栏（JSON 输入 + 结果展示） */}
      <div className="jpath__main">
        {/* 左栏：JSON 输入 */}
        <div className="jpath__input-pane">
          <div className="jpath__pane-header">
            <label htmlFor="jpath-json" className="jpath__label">
              JSON 数据
            </label>
            <div className="jpath__pane-actions">
              <button type="button" className="jpath__action-btn" onClick={handleFormatJson} aria-label="格式化 JSON">
                格式化
              </button>
              <button type="button" className="jpath__action-btn" onClick={handleLoadSample} aria-label="载入示例 JSON">
                示例
              </button>
              <button type="button" className="jpath__action-btn" onClick={handleClearJson} aria-label="清空 JSON 输入">
                清空
              </button>
            </div>
          </div>
          <textarea
            id="jpath-json"
            className="jpath__textarea"
            value={jsonText}
            onChange={(e) => setJsonText(e.currentTarget.value)}
            placeholder='在此粘贴 JSON 数据，例如 {"store": {"book": [...]}}'
            aria-label="JSON 数据输入框"
            spellCheck={false}
          />
          {!jsonParseResult.ok && jsonText.trim() !== '' && (
            <p className="jpath__json-error" role="alert">
              JSON 解析错误：{jsonParseResult.error}
            </p>
          )}
          {jsonParseResult.ok && (
            <p className="jpath__json-ok">
              ✓ JSON 合法（{jsonText.trim().length} 字符）
            </p>
          )}
        </div>

        {/* 右栏：查询结果 */}
        <div className="jpath__result-pane">
          <div className="jpath__pane-header">
            <span className="jpath__label">
              查询结果
              {queryResult.success && (
                <span className="jpath__result-count">
                  （{queryResult.count} 项）
                </span>
              )}
            </span>
            <div className="jpath__pane-actions">
              <button
                type="button"
                className="jpath__action-btn"
                onClick={handleCopyAll}
                disabled={!queryResult.success || queryResult.values.length === 0}
                aria-label="复制全部结果"
              >
                {copiedAll ? '✓ 已复制' : '复制全部'}
              </button>
            </div>
          </div>

          {/* 错误提示 */}
          {!queryResult.success && (
            <div className="jpath__error-state" role="status">
              <p className="jpath__error-text">{queryResult.error}</p>
            </div>
          )}

          {/* 空结果 */}
          {queryResult.success && queryResult.values.length === 0 && (
            <div className="jpath__empty-state" role="status">
              <p>未匹配到任何结果。</p>
              <p className="jpath__empty-hint">请检查 JSONPath 表达式是否正确，或 JSON 数据中是否存在目标字段。</p>
            </div>
          )}

          {/* 结果列表 */}
          {queryResult.success && queryResult.values.length > 0 && (
            <ul className="jpath__result-list" role="list">
              {queryResult.values.map((value, idx) => {
                const valueText = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
                const isShort = valueText.length <= 200;
                return (
                  <li key={idx} className="jpath__result-item">
                    <div className="jpath__result-header">
                      <span className="jpath__result-index">#{idx + 1}</span>
                      <span className="jpath__result-type">{describeValueType(value)}</span>
                      <button
                        type="button"
                        className="jpath__copy-btn"
                        onClick={() => handleCopyOne(value, idx)}
                        aria-label={`复制第 ${idx + 1} 条结果`}
                      >
                        {copiedIdx === idx ? '✓ 已复制' : '复制'}
                      </button>
                    </div>
                    <pre className={`jpath__result-value${isShort ? ' is-short' : ''}`}>
                      <code>{valueText}</code>
                    </pre>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** 描述值的类型（用于结果卡片展示） */
function describeValueType(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `array[${value.length}]`;
  if (typeof value === 'object') return `object{${Object.keys(value).length}}`;
  return typeof value;
}
