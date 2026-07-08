import { useState, useMemo, useCallback, useEffect } from 'react';
import { parse as tomlParse, stringify as tomlStringify, TomlError, TomlDate } from 'smol-toml';
import { copyText } from '../utils/clipboard';

/**
 * TOML / JSON 互转工具
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - TOML → JSON：解析 TOML（支持注释、数组表 [[...]]、点号键、内联表、多行字符串、日期时间类型）
 *  - JSON → TOML：将 JSON 序列化为 TOML（保留缩进、引号风格、日期时间类型）
 *  - 语法校验：精确错误定位（行号、列号、原因）
 *  - TOML 类型陷阱提示：
 *    1. 日期时间类型 → JSON 后变成 ISO 8601 字符串（类型信息丢失，本地时间被强制加时区）
 *    2. 64 位整数超过 Number.MAX_SAFE_INTEGER → 转 JS Number 会丢失精度
 *    3. JSON 含 null → TOML 不支持 null，序列化会报错
 *  - 复制 / 下载 / 清空 / 示例
 */

type Mode = 'toml2json' | 'json2toml';

interface ParseError {
  message: string;
  line: number; // 1-based，0 表示未知位置
  column: number; // 1-based，0 表示未知位置
}

/** TOML 类型陷阱提示项 */
interface TomlWarning {
  path: string; // 字段路径（如 server.port）
  raw: string; // 原始文本片段
  reason: string; // 提示原因
}

/** 触发浏览器下载文件 */
function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 延迟释放 URL，避免下载未完成就被回收
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 统计字符数与行数 */
function computeStats(text: string) {
  const chars = text.length;
  const lines = chars === 0 ? 0 : text.split('\n').length;
  return { chars, lines };
}

/** 将 smol-toml 抛出的错误转换为统一的 ParseError（含行号列号） */
function toParseError(e: unknown): ParseError {
  if (e instanceof TomlError) {
    return {
      message: e.message,
      line: e.line || 0,
      column: e.column || 0,
    };
  }
  if (e instanceof Error) {
    return { message: e.message, line: 0, column: 0 };
  }
  return { message: String(e), line: 0, column: 0 };
}

/**
 * 判断 TOML 日期时间值的具体类型，返回中文名称与 JSON 序列化后的形态
 * TomlDate 继承自 Date，smol-toml 用私有字段标记其原始类型
 */
function describeTomlDate(d: TomlDate): { type: string; jsonForm: string } {
  if (d.isTime()) {
    // 本地时间：10:30:00 → JSON.stringify(Date) 会变成 "1970-01-01T10:30:00.000Z"
    return {
      type: '本地时间',
      jsonForm: `"1970-01-01T${d.toISOString().slice(11)}"` + '（被强制加上 1970-01-01 日期与 UTC 时区）',
    };
  }
  if (d.isDate()) {
    // 本地日期：2024-01-15 → "2024-01-15T00:00:00.000Z"
    return {
      type: '本地日期',
      jsonForm: `"${d.toISOString()}"` + '（被强制加上 T00:00:00.000Z 时区）',
    };
  }
  if (d.isDateTime() && d.isLocal()) {
    // 本地日期时间：2024-01-15T10:30:00 → 保留原值（无时区后缀）
    return {
      type: '本地日期时间',
      jsonForm: `"${d.toISOString()}"` + '（无时区后缀，但 JSON 中已带上 T 分隔符）',
    };
  }
  // 带偏移的日期时间：2024-01-15T10:30:00+08:00 → 转为 UTC 的 ISO 字符串
  return {
    type: '偏移日期时间',
    jsonForm: `"${d.toISOString()}"` + '（已转为 UTC，原始时区偏移信息丢失）',
  };
}

/**
 * 递归遍历解析结果，收集所有 TomlDate 实例的路径与类型信息
 * 这类值在 JSON.stringify 后会变成 ISO 8601 字符串，类型信息丢失
 */
function collectDateWarnings(obj: unknown, basePath: string, warns: TomlWarning[]): void {
  if (obj instanceof TomlDate) {
    const { type, jsonForm } = describeTomlDate(obj);
    warns.push({
      path: basePath || '(根)',
      raw: obj.toISOString(),
      reason: `TOML ${type}值转 JSON 后变成 ${jsonForm}。原始类型信息（日期 / 时间 / 时区）会丢失。如需保留原始 TOML 格式，请在消费 JSON 时按字符串还原。`,
    });
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => collectDateWarnings(item, `${basePath}[${idx}]`, warns));
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const [key, val] of Object.entries(obj)) {
      const nextPath = basePath ? `${basePath}.${key}` : key;
      collectDateWarnings(val, nextPath, warns);
    }
  }
}

/**
 * 扫描 TOML 源文本，检测超过 Number.MAX_SAFE_INTEGER 的十进制整数
 * TOML 支持 64 位整数（最大 9223372036854775807），但 JS Number 只能安全表示到 2^53-1
 * 注意：仅扫描十进制整数，十六进制 / 八进制 / 二进制通常不会超界且解析方式不同
 */
function collectLargeIntWarnings(text: string, warns: TomlWarning[]): void {
  const lines = text.split('\n');
  // 匹配「键: 值」或「键 = 值」中的十进制整数值（含下划线、正负号）
  // 排除浮点数（含 . 或 e/E）、引号字符串、日期时间
  const INT_RE = /(^|[=\s])([+-]?\d[\d_]*)(?=\s|$|[#])/g;

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    // 跳过注释行
    if (!trimmed || trimmed.startsWith('#')) return;

    let match: RegExpExecArray | null;
    INT_RE.lastIndex = 0;
    while ((match = INT_RE.exec(line)) !== null) {
      const raw = match[2];
      // 去掉下划线后比较
      const cleaned = raw.replace(/_/g, '');
      // 跳过明显不是整数的情况（前导零且长度短，如 007、0）
      if (!/^[+-]?\d+$/.test(cleaned)) continue;
      const num = Number(cleaned);
      if (!Number.isSafeInteger(num)) {
        warns.push({
          path: `第 ${idx + 1} 行`,
          raw,
          reason: `整数 ${raw} 超过 Number.MAX_SAFE_INTEGER（2^53-1 = 9007199254740991），转 JS Number 后会丢失精度。如需精确表示，请在消费端用 BigInt 或字符串处理。`,
        });
      }
    }
  });
}

/**
 * 扫描 JSON 源文本，检测 null 值
 * TOML 不支持 null，JSON → TOML 时遇到 null 会报错
 */
function collectNullWarnings(text: string, warns: TomlWarning[]): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }
  const walk = (obj: unknown, basePath: string) => {
    if (obj === null) {
      warns.push({
        path: basePath || '(根)',
        raw: 'null',
        reason: 'TOML 不支持 null 类型。JSON → TOML 转换会在此字段报错。请删除该字段、改为空字符串、或用其他方式表达「无值」语义。',
      });
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach((item, idx) => walk(item, `${basePath}[${idx}]`));
      return;
    }
    if (obj && typeof obj === 'object') {
      for (const [key, val] of Object.entries(obj)) {
        const nextPath = basePath ? `${basePath}.${key}` : key;
        walk(val, nextPath);
      }
    }
  };
  walk(parsed, '');
}

const SAMPLE_TOML = `# TOML 示例：项目配置文件（Cargo / pyproject 风格）
title = "工具盒子"
version = "1.0.0"
debug = false
port = 8080
rate = 3.14

# 日期时间类型（TOML 独有）
created = 2024-01-15
updated = 2024-06-01T10:30:00+08:00

# 数组
tags = ["前端", "工具", "中文"]

# 内联表（紧凑写法）
point = { x = 1, y = 2 }

# 表（嵌套结构）
[owner]
name = "开发者"
email = "dev@example.com"

[server]
host = "0.0.0.0"
port = 8080

# 数组表（[[...]] 生成数组）
[[dependencies]]
name = "react"
version = "18.3.1"

[[dependencies]]
name = "astro"
version = "5.6.1"
`;

const SAMPLE_JSON = `{
  "title": "工具盒子",
  "version": "1.2.0",
  "debug": false,
  "port": 8080,
  "rate": 3.14,
  "tags": ["前端", "工具", "中文"],
  "owner": {
    "name": "开发者",
    "email": "dev@example.com"
  },
  "server": {
    "host": "0.0.0.0",
    "port": 8080
  },
  "dependencies": [
    { "name": "react", "version": "18.3.1" },
    { "name": "astro", "version": "5.6.1" }
  ]
}`;

export default function TomlTool() {
  const [mode, setMode] = useState<Mode>('toml2json');
  const [input, setInput] = useState<string>('');
  const [output, setOutput] = useState<string>('');
  const [live, setLive] = useState<boolean>(true);
  const [error, setError] = useState<ParseError | null>(null);
  const [notice, setNotice] = useState<string>('');
  const [copied, setCopied] = useState(false);
  // TOML 类型陷阱提示列表
  const [warnings, setWarnings] = useState<TomlWarning[]>([]);

  const inputStats = useMemo(() => computeStats(input), [input]);
  const outputStats = useMemo(() => computeStats(output), [output]);

  /** 执行一次转换：根据当前模式调用对应算法 */
  const runTransform = useCallback(
    (text: string, m: Mode) => {
      setNotice('');
      setCopied(false);
      setWarnings([]);
      if (text === '') {
        setOutput('');
        setError(null);
        return;
      }
      if (m === 'toml2json') {
        // TOML → JSON
        try {
          const value = tomlParse(text);
          setOutput(JSON.stringify(value, null, 2));
          setError(null);
          // 检测类型陷阱：日期时间值 + 大整数
          const warns: TomlWarning[] = [];
          collectDateWarnings(value, '', warns);
          collectLargeIntWarnings(text, warns);
          setWarnings(warns);
        } catch (e) {
          setError(toParseError(e));
          setOutput('');
        }
      } else {
        // JSON → TOML
        try {
          const value = JSON.parse(text);
          const tomlText = tomlStringify(value);
          setOutput(tomlText);
          setError(null);
          // 检测类型陷阱：null 值（TOML 不支持）
          const warns: TomlWarning[] = [];
          collectNullWarnings(text, warns);
          setWarnings(warns);
        } catch (e) {
          setError(toParseError(e));
          setOutput('');
        }
      }
    },
    [],
  );

  /** 实时模式：输入变化时自动转换 */
  useEffect(() => {
    if (!live) return;
    runTransform(input, mode);
  }, [live, input, mode, runTransform]);

  /** 手动触发（关闭实时模式时使用） */
  const handleRun = useCallback(() => {
    runTransform(input, mode);
  }, [input, mode, runTransform]);

  /** 复制输出 */
  const handleCopy = useCallback(async () => {
    if (!output) return;
    const ok = await copyText(output);
    if (ok) {
      setCopied(true);
      setNotice('已复制到剪贴板');
      setTimeout(() => setCopied(false), 1500);
    } else {
      setNotice('复制失败，请手动选中复制');
    }
  }, [output]);

  /** 下载输出为文件 */
  const handleDownload = useCallback(() => {
    if (!output) return;
    if (mode === 'toml2json') {
      downloadFile('converted.json', output, 'application/json;charset=utf-8');
      setNotice('已下载 converted.json');
    } else {
      downloadFile('converted.toml', output, 'application/toml;charset=utf-8');
      setNotice('已下载 converted.toml');
    }
    setTimeout(() => setNotice(''), 2500);
  }, [output, mode]);

  /** 清空 */
  const handleClear = useCallback(() => {
    setInput('');
    setOutput('');
    setWarnings([]);
    setError(null);
    setNotice('');
    setCopied(false);
  }, []);

  /** 载入示例 */
  const handleSample = useCallback(() => {
    setInput(mode === 'toml2json' ? SAMPLE_TOML : SAMPLE_JSON);
    setOutput('');
    setWarnings([]);
    setError(null);
    setNotice('');
  }, [mode]);

  /** 切换模式时清空输出 */
  const onModeChange = useCallback((m: Mode) => {
    setMode(m);
    setOutput('');
    setWarnings([]);
    setError(null);
    setNotice('');
    setCopied(false);
  }, []);

  /** 输入框变化时同步清空错误 */
  const onInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (error) setError(null);
    if (notice) setNotice('');
  }, [error, notice]);

  // 标签与占位符随模式切换
  const inputLabel = mode === 'toml2json' ? 'TOML 输入' : 'JSON 输入';
  const outputLabel = mode === 'toml2json' ? 'JSON 结果' : 'TOML 结果';
  const inputPlaceholder = mode === 'toml2json'
    ? '在此粘贴 TOML 文本，支持注释、数组表 [[...]]、点号键、内联表、多行字符串、日期时间类型'
    : '在此粘贴 JSON 文本，将转换为 TOML（注意 TOML 不支持 null）';
  const outputPlaceholder = '处理结果将显示在这里';

  return (
    <div className="jsontool tomltool">
      {/* 工具栏 */}
      <div className="jsontool__toolbar" role="toolbar" aria-label="TOML / JSON 互转操作">
        <div className="jsontool__actions">
          <div className="b64tool__seg" role="group" aria-label="转换方向">
            <button
              className={`btn btn--sm${mode === 'toml2json' ? ' btn--primary' : ''}`}
              aria-pressed={mode === 'toml2json'}
              onClick={() => onModeChange('toml2json')}
            >
              TOML → JSON
            </button>
            <button
              className={`btn btn--sm${mode === 'json2toml' ? ' btn--primary' : ''}`}
              aria-pressed={mode === 'json2toml'}
              onClick={() => onModeChange('json2toml')}
            >
              JSON → TOML
            </button>
          </div>
          {!live && (
            <button className="btn btn--primary btn--sm" onClick={handleRun}>转换</button>
          )}
        </div>
        <div className="jsontool__options">
          <label className="b64tool__toggle">
            <input
              type="checkbox"
              checked={live}
              onChange={(e) => setLive(e.target.checked)}
            />
            <span>实时转换</span>
          </label>
          <button className="btn btn--sm" onClick={handleSample}>示例</button>
          <button className="btn btn--sm" onClick={handleClear}>清空</button>
        </div>
      </div>

      {/* 编辑区 */}
      <div className="jsontool__panels">
        <div className="jsontool__panel">
          <label htmlFor="toml-input" className="jsontool__label">
            {inputLabel}
            <span className="jsontool__stat">{inputStats.chars} 字 · {inputStats.lines} 行</span>
          </label>
          <textarea
            id="toml-input"
            className="jsontool__textarea"
            value={input}
            onChange={onInputChange}
            placeholder={inputPlaceholder}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            aria-label={inputLabel}
          />
        </div>
        <div className="jsontool__panel">
          <div className="jsontool__label">
            <span>{outputLabel}</span>
            <span className="jsontool__stat">{outputStats.chars} 字 · {outputStats.lines} 行</span>
            <button
              className="btn btn--sm jsontool__copy"
              onClick={handleCopy}
              disabled={!output}
              aria-label="复制输出"
            >
              {copied ? '已复制' : '复制'}
            </button>
            <button
              className="btn btn--sm"
              onClick={handleDownload}
              disabled={!output}
              aria-label="下载输出文件"
            >
              下载
            </button>
          </div>
          <textarea
            className="jsontool__textarea"
            value={output}
            readOnly
            placeholder={outputPlaceholder}
            spellCheck={false}
            aria-label={outputLabel}
          />
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="tomltool__error" role="alert">
          <strong>解析错误</strong>
          {error.line > 0 && (
            <span className="tomltool__error-loc">
              （第 {error.line} 行{error.column > 0 ? `第 ${error.column} 列` : ''}）
            </span>
          )}
          <span className="tomltool__error-msg">{error.message}</span>
        </div>
      )}

      {/* TOML 类型陷阱提示 */}
      {warnings.length > 0 && (
        <div className="tomltool__warnings" role="alert">
          <div className="tomltool__warnings-head">
            <span>⚠ TOML 类型提示（{warnings.length} 项）</span>
            <span className="tomltool__warnings-hint">以下字段在格式互转时可能丢失类型信息或导致转换失败</span>
          </div>
          <ul className="tomltool__warnings-list">
            {warnings.slice(0, 20).map((w, i) => (
              <li key={i} className="tomltool__warning-item">
                <span className="tomltool__warning-loc">{w.path}</span>
                <span className="tomltool__warning-raw">{w.raw}</span>
                <span className="tomltool__warning-reason">{w.reason}</span>
              </li>
            ))}
          </ul>
          {warnings.length > 20 && (
            <p className="tomltool__warning-more">还有 {warnings.length - 20} 项提示已省略</p>
          )}
        </div>
      )}

      {/* 操作提示 */}
      {notice && <p className="jsontool__notice" role="status">{notice}</p>}
    </div>
  );
}
