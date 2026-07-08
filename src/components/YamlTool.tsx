import { useState, useMemo, useCallback, useEffect } from 'react';
import yaml from 'js-yaml';
import { copyText } from '../utils/clipboard';

/**
 * YAML / JSON 互转工具
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - YAML → JSON：支持多文档（--- 分隔）、锚点 / 别名、注释、流 / 块样式
 *  - JSON → YAML：可配置缩进（2 / 4 空格）、行宽、引号风格
 *  - 语法校验：精确错误定位（行号、列号、原因）
 *  - YAML 类型推断陷阱提示：yes/no/on/off 布尔、日期自动解析、数字科学计数法
 *  - 复制 / 下载 / 清空 / 示例
 */

type Mode = 'yaml2json' | 'json2yaml';
type Indent = 2 | 4;

interface ParseError {
  message: string;
  line: number; // 1-based，0 表示未知位置
  column: number; // 1-based，0 表示未知位置
}

/** YAML 类型推断陷阱提示项 */
interface YamlWarning {
  path: string; // 字段路径（如 user.active）
  raw: string; // 原始 YAML 文本片段
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

/**
 * 将 js-yaml 抛出的错误转换为统一的 ParseError
 * YAMLException 含 mark.line / mark.column / reason
 */
function toParseError(e: unknown): ParseError {
  if (e instanceof yaml.YAMLException) {
    return {
      message: e.reason || e.message,
      line: e.mark ? e.mark.line + 1 : 0,
      column: e.mark ? e.mark.column + 1 : 0,
    };
  }
  if (e instanceof Error) {
    return { message: e.message, line: 0, column: 0 };
  }
  return { message: String(e), line: 0, column: 0 };
}

/**
 * 检测 YAML 源文本中可能引发类型推断陷阱的「裸字符串」
 * YAML 1.1 schema 会把 yes/no/on/off 解析为布尔，把 2024-01-01 解析为日期
 * 本函数扫描源文本，给出提示（不修改转换结果）
 */
function detectYamlTypeTraps(text: string): YamlWarning[] {
  const warns: YamlWarning[] = [];
  const lines = text.split('\n');

  // YAML 布尔陷阱词（YAML 1.1 schema）
  const BOOL_TRAPS = ['yes', 'no', 'on', 'off', 'y', 'n', 'Y', 'N'];
  // 日期正则：YYYY-MM-DD
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  lines.forEach((line, idx) => {
    // 跳过注释行与空行
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    // 提取「键: 值」中的值部分（仅处理简单键值对，跳过嵌套结构）
    // 匹配 key: value 形式，value 为非引号包裹的裸字符串
    const kvMatch = line.match(/^\s*([^\s#"].*?)\s*:\s*([^"#'[\]{}].*?)\s*$/);
    if (!kvMatch) return;
    const key = kvMatch[1];
    const value = kvMatch[2].trim();

    // 跳过空值
    if (!value) return;
    // 跳过已用引号包裹的值（用户已明确类型）
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return;

    // 检测布尔陷阱：值为 yes/no/on/off 等
    if (BOOL_TRAPS.includes(value)) {
      warns.push({
        path: key,
        raw: value,
        reason: `YAML 1.1 解析器（如 PyYAML、libyaml）会把 "${value}" 解析为布尔值。本工具基于 YAML 1.2（js-yaml v4），保留为字符串。如需在所有解析器中统一保留为字符串，请用引号包裹：${key}: "${value}"`,
      });
    }

    // 检测日期自动解析：值为 YYYY-MM-DD
    if (DATE_RE.test(value)) {
      warns.push({
        path: key,
        raw: value,
        reason: `YAML 会把 "${value}" 解析为 Date 对象，JSON.stringify 后变成 ISO 8601 字符串（带时区，如 "2024-01-15T00:00:00.000Z"）。如需保留原始字符串，请用引号包裹：${key}: "${value}"`,
      });
    }
  });

  return warns;
}

const SAMPLE_YAML = `# YAML 示例：配置文件结构
name: 工具盒子
version: 1.0.0
active: true
tags:
  - 前端
  - 工具
  - 中文
author:
  name: 开发者
  email: dev@example.com
  url: https://example.com
config:
  port: 8080
  debug: false
  replicas: 3
  timeout: 30s
created: 2024-01-15
`;

const SAMPLE_JSON = `{
  "name": "工具盒子",
  "version": "1.2.0",
  "active": true,
  "tags": ["前端", "工具", "中文"],
  "author": {
    "name": "开发者",
    "email": "dev@example.com"
  },
  "config": {
    "port": 8080,
    "debug": false,
    "replicas": 3
  }
}`;

export default function YamlTool() {
  const [mode, setMode] = useState<Mode>('yaml2json');
  const [input, setInput] = useState<string>('');
  const [output, setOutput] = useState<string>('');
  const [indent, setIndent] = useState<Indent>(2);
  const [live, setLive] = useState<boolean>(true);
  const [error, setError] = useState<ParseError | null>(null);
  const [notice, setNotice] = useState<string>('');
  const [copied, setCopied] = useState(false);
  // YAML 类型推断陷阱提示列表
  const [warnings, setWarnings] = useState<YamlWarning[]>([]);
  // 多文档计数（YAML → JSON 时若检测到 --- 分隔符）
  const [docCount, setDocCount] = useState<number>(0);

  const inputStats = useMemo(() => computeStats(input), [input]);
  const outputStats = useMemo(() => computeStats(output), [output]);

  /** 执行一次转换：根据当前模式调用对应算法 */
  const runTransform = useCallback(
    (text: string, m: Mode, ind: Indent) => {
      setNotice('');
      setCopied(false);
      setWarnings([]);
      setDocCount(0);
      if (text === '') {
        setOutput('');
        setError(null);
        return;
      }
      if (m === 'yaml2json') {
        // YAML → JSON
        try {
          // 检测多文档：扫描是否含独立行的 --- 分隔符
          const docSeparators = text.split('\n').filter((l) => l.trim() === '---').length;
          let jsonValue: unknown;
          if (docSeparators >= 1) {
            // 多文档模式：loadAll 返回数组
            const docs: unknown[] = [];
            yaml.loadAll(text, (doc) => {
              docs.push(doc);
            });
            jsonValue = docs;
            setDocCount(docs.length);
          } else {
            jsonValue = yaml.load(text);
          }
          setOutput(JSON.stringify(jsonValue, null, 2));
          setError(null);
          // 检测类型推断陷阱（仅提示，不修改结果）
          setWarnings(detectYamlTypeTraps(text));
        } catch (e) {
          setError(toParseError(e));
          setOutput('');
        }
      } else {
        // JSON → YAML
        try {
          const value = JSON.parse(text);
          const yamlText = yaml.dump(value, {
            indent: ind,
            lineWidth: 120, // 行宽，超出自动换行
            noRefs: true, // 不使用锚点 / 别名，展开为完整结构
            quotingType: '"', // 双引号优先（与 JSON 一致）
            forceQuotes: false, // 仅在必要时加引号
          });
          setOutput(yamlText);
          setError(null);
        } catch (e) {
          setError(toParseError(e));
          setOutput('');
        }
      }
    },
    [],
  );

  /** 实时模式：输入或参数变化时自动转换 */
  useEffect(() => {
    if (!live) return;
    runTransform(input, mode, indent);
  }, [live, input, mode, indent, runTransform]);

  /** 手动触发（关闭实时模式时使用） */
  const handleRun = useCallback(() => {
    runTransform(input, mode, indent);
  }, [input, mode, indent, runTransform]);

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

  /** 下载输出为文件：YAML 模式下载 .json，JSON 模式下载 .yaml */
  const handleDownload = useCallback(() => {
    if (!output) return;
    if (mode === 'yaml2json') {
      downloadFile('converted.json', output, 'application/json;charset=utf-8');
      setNotice('已下载 converted.json');
    } else {
      downloadFile('converted.yaml', output, 'application/x-yaml;charset=utf-8');
      setNotice('已下载 converted.yaml');
    }
    setTimeout(() => setNotice(''), 2500);
  }, [output, mode]);

  /** 清空 */
  const handleClear = useCallback(() => {
    setInput('');
    setOutput('');
    setWarnings([]);
    setDocCount(0);
    setError(null);
    setNotice('');
    setCopied(false);
  }, []);

  /** 载入示例：根据当前模式载入对应示例数据 */
  const handleSample = useCallback(() => {
    setInput(mode === 'yaml2json' ? SAMPLE_YAML : SAMPLE_JSON);
    setOutput('');
    setWarnings([]);
    setDocCount(0);
    setError(null);
    setNotice('');
  }, [mode]);

  /** 切换模式时清空输出，避免误用旧结果 */
  const onModeChange = useCallback((m: Mode) => {
    setMode(m);
    setOutput('');
    setWarnings([]);
    setDocCount(0);
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
  const inputLabel = mode === 'yaml2json' ? 'YAML 输入' : 'JSON 输入';
  const outputLabel = mode === 'yaml2json' ? 'JSON 结果' : 'YAML 结果';
  const inputPlaceholder = mode === 'yaml2json'
    ? '在此粘贴 YAML 文本，支持注释、多文档（--- 分隔）、锚点 / 别名、流 / 块样式'
    : '在此粘贴 JSON 文本，将转换为 YAML（缩进可配置）';
  const outputPlaceholder = '处理结果将显示在这里';

  return (
    <div className="jsontool yamltool">
      {/* 工具栏 */}
      <div className="jsontool__toolbar" role="toolbar" aria-label="YAML / JSON 互转操作">
        <div className="jsontool__actions">
          <div className="b64tool__seg" role="group" aria-label="转换方向">
            <button
              className={`btn btn--sm${mode === 'yaml2json' ? ' btn--primary' : ''}`}
              aria-pressed={mode === 'yaml2json'}
              onClick={() => onModeChange('yaml2json')}
            >
              YAML → JSON
            </button>
            <button
              className={`btn btn--sm${mode === 'json2yaml' ? ' btn--primary' : ''}`}
              aria-pressed={mode === 'json2yaml'}
              onClick={() => onModeChange('json2yaml')}
            >
              JSON → YAML
            </button>
          </div>
          {!live && (
            <button className="btn btn--primary btn--sm" onClick={handleRun}>转换</button>
          )}
        </div>
        <div className="jsontool__options">
          {mode === 'json2yaml' && (
            <label className="b64tool__toggle">
              缩进
              <select
                value={indent}
                onChange={(e) => setIndent(Number(e.target.value) as Indent)}
                aria-label="YAML 缩进空格数"
              >
                <option value={2}>2 空格</option>
                <option value={4}>4 空格</option>
              </select>
            </label>
          )}
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
          <label htmlFor="yaml-input" className="jsontool__label">
            {inputLabel}
            <span className="jsontool__stat">{inputStats.chars} 字 · {inputStats.lines} 行</span>
          </label>
          <textarea
            id="yaml-input"
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
            <span className="jsontool__stat">
              {outputStats.chars} 字 · {outputStats.lines} 行
              {mode === 'yaml2json' && docCount > 1 && (
                <span className="yamltool__doc-count">多文档 · {docCount} 个</span>
              )}
            </span>
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
        <div className="yamltool__error" role="alert">
          <strong>解析错误</strong>
          {error.line > 0 && (
            <span className="yamltool__error-loc">
              （第 {error.line} 行{error.column > 0 ? `第 ${error.column} 列` : ''}）
            </span>
          )}
          <span className="yamltool__error-msg">{error.message}</span>
        </div>
      )}

      {/* YAML 类型推断陷阱提示 */}
      {warnings.length > 0 && (
        <div className="yamltool__warnings" role="alert">
          <div className="yamltool__warnings-head">
            <span>⚠ YAML 类型推断提示（{warnings.length} 项）</span>
            <span className="yamltool__warnings-hint">以下字段可能被 YAML 自动转换类型，如需保留字符串请用引号包裹</span>
          </div>
          <ul className="yamltool__warnings-list">
            {warnings.slice(0, 20).map((w, i) => (
              <li key={i} className="yamltool__warning-item">
                <span className="yamltool__warning-loc">{w.path}</span>
                <span className="yamltool__warning-raw">{w.raw}</span>
                <span className="yamltool__warning-reason">{w.reason}</span>
              </li>
            ))}
          </ul>
          {warnings.length > 20 && (
            <p className="yamltool__warning-more">还有 {warnings.length - 20} 项提示已省略</p>
          )}
        </div>
      )}

      {/* 操作提示 */}
      {notice && <p className="jsontool__notice" role="status">{notice}</p>}
    </div>
  );
}
