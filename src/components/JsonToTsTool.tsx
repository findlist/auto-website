import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';
import { jsonToTs, type JsonToTsOptions } from '../utils/jsonToTs';

/**
 * JSON 转 TypeScript 接口工具
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 从 JSON 数据推断 TypeScript 类型，生成 interface 声明
 *  - 支持：联合类型合并、可选字段检测、嵌套类型提取、interface 去重
 *  - 选项：根接口名、export 关键字、可选字段、数组风格
 *  - 复制 / 下载 .ts 文件 / 示例 / 清空
 *  - 统计：接口数、字段数、字符数、行数
 */

type ArrayStyle = 'bracket' | 'generic';

// 示例 JSON：覆盖对象、数组、嵌套、联合类型、可选字段、null 等场景
const SAMPLE_INPUT = `{
  "name": "工具盒子",
  "version": "0.1.0",
  "active": true,
  "description": null,
  "tags": ["json", "ts", "中文"],
  "author": {
    "name": "开发者",
    "email": "dev@example.com"
  },
  "items": [
    { "id": 1, "title": "第一项", "price": 9.9 },
    { "id": 2, "title": "第二项", "url": "https://example.com" }
  ]
}`;

/** 简单统计输入文本 */
function computeStats(text: string) {
  const chars = text.length;
  const lines = chars === 0 ? 0 : text.split('\n').length;
  return { chars, lines };
}

export default function JsonToTsTool() {
  const [input, setInput] = useState<string>('');
  const [rootName, setRootName] = useState<string>('Root');
  const [exportKeyword, setExportKeyword] = useState(true);
  const [optionalFields, setOptionalFields] = useState(true);
  const [arrayStyle, setArrayStyle] = useState<ArrayStyle>('bracket');
  const [notice, setNotice] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // 实时生成 TS 代码（JSON 解析 + 类型推断轻量，useMemo 即时计算）
  const result = useMemo(() => {
    if (input.trim() === '') {
      return { ok: true, code: '', error: null as string | null, stats: { interfaceCount: 0, fieldCount: 0, charCount: 0, lineCount: 0 } };
    }
    const opts: JsonToTsOptions = {
      rootName: rootName.trim() || 'Root',
      exportKeyword,
      optionalFields,
      arrayStyle,
    };
    return jsonToTs(input, opts);
  }, [input, rootName, exportKeyword, optionalFields, arrayStyle]);

  const output = result.ok ? result.code : '';
  const error = !result.ok ? result.error : '';
  const inputStats = useMemo(() => computeStats(input), [input]);
  const outputStats = useMemo(() => computeStats(output), [output]);
  const stats = result.stats;

  /** 复制输出 */
  const handleCopy = useCallback(async () => {
    if (!output) return;
    const ok = await copyText(output);
    setCopied(ok);
    setNotice(ok ? '已复制到剪贴板' : '复制失败，请手动选中复制');
    if (ok) setTimeout(() => setCopied(false), 1500);
  }, [output]);

  /** 下载为 .ts 文件 */
  const handleDownload = useCallback(() => {
    if (!output) return;
    const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${rootName.trim() || 'types'}.ts`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setNotice(`已下载 ${a.download}`);
    setTimeout(() => setNotice(''), 1800);
  }, [output, rootName]);

  /** 清空 */
  const handleClear = useCallback(() => {
    setInput('');
    setNotice('');
    setCopied(false);
  }, []);

  /** 载入示例 */
  const handleSample = useCallback(() => {
    setInput(SAMPLE_INPUT);
    setNotice('');
    setCopied(false);
  }, []);

  /** 输入变化时同步清空提示 */
  const onInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (notice) setNotice('');
  }, [notice]);

  return (
    <div className="jsontool jts">
      {/* 工具栏 */}
      <div className="jsontool__toolbar" role="toolbar" aria-label="JSON 转 TypeScript 操作">
        <div className="jsontool__actions">
          <span className="jts__tag">JSON → TS Interface</span>
        </div>
        <div className="jsontool__options">
          <button className="btn btn--sm" onClick={handleSample}>示例</button>
          <button className="btn btn--sm" onClick={handleClear}>清空</button>
        </div>
      </div>

      {/* 选项面板 */}
      <div className="jts__options" role="group" aria-label="生成选项">
        <label className="jsfmt__toggle">
          <span>根名</span>
          <input
            type="text"
            value={rootName}
            onChange={(e) => setRootName(e.target.value)}
            placeholder="Root"
            aria-label="根接口名"
            className="jts__name-input"
          />
        </label>
        <label className="jsfmt__toggle">
          <input
            type="checkbox"
            checked={exportKeyword}
            onChange={(e) => setExportKeyword(e.target.checked)}
          />
          export 关键字
        </label>
        <label className="jsfmt__toggle">
          <input
            type="checkbox"
            checked={optionalFields}
            onChange={(e) => setOptionalFields(e.target.checked)}
          />
          可选字段（?:）
        </label>
        <label className="jsfmt__toggle">
          <span>数组风格</span>
          <select
            value={arrayStyle}
            onChange={(e) => setArrayStyle(e.target.value as ArrayStyle)}
            aria-label="数组类型风格"
          >
            <option value="bracket">T[]</option>
            <option value="generic">Array&lt;T&gt;</option>
          </select>
        </label>
      </div>

      {/* 输入区 */}
      <div className="jsfmt__field">
        <label htmlFor="jts-input" className="jsontool__label">
          输入 JSON
          <span className="jsontool__stat">{inputStats.chars} 字 · {inputStats.lines} 行</span>
        </label>
        <textarea
          id="jts-input"
          className="jsfmt__textarea"
          value={input}
          onChange={onInputChange}
          placeholder='在此粘贴 JSON 数据，或点击"示例"载入演示数据。支持对象、数组、嵌套结构、联合类型。'
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          aria-label="输入 JSON 数据"
          rows={10}
        />
      </div>

      {/* 输出区 */}
      <div className="jsfmt__field">
        <div className="jsontool__label">
          <span>TypeScript 接口</span>
          <span className="jsontool__stat">
            {stats.interfaceCount} 接口 · {stats.fieldCount} 字段 · {outputStats.chars} 字 · {outputStats.lines} 行
          </span>
          <button
            className="btn btn--sm jsontool__copy"
            onClick={handleDownload}
            disabled={!output}
            aria-label="下载 TS 文件"
          >
            下载 .ts
          </button>
          <button
            className="btn btn--sm jsontool__copy"
            onClick={handleCopy}
            disabled={!output}
            aria-label="复制输出"
          >
            {copied ? '已复制' : '复制'}
          </button>
        </div>
        <pre
          className="jsfmt__output"
          aria-label="TypeScript 接口代码"
        >
          {output || (input ? '' : 'TypeScript 接口将显示在这里')}
        </pre>
      </div>

      {/* 状态条 */}
      <div className="jsontool__status" role="status" aria-live="polite">
        {error ? (
          <div className="jsontool__error">
            <strong>❌ 错误</strong>
            <span>{error}</span>
          </div>
        ) : notice ? (
          <div className="jsontool__notice">{notice}</div>
        ) : (
          <div className="jsontool__hint">
            递归推断 JSON 类型并生成 TypeScript interface 声明，支持联合类型合并、可选字段检测、嵌套类型提取与 interface 去重。所有数据仅在浏览器本地处理。
          </div>
        )}
      </div>
    </div>
  );
}
