import { useState, useMemo, useCallback, useEffect } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSV / JSON 互转工具
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - CSV → JSON：手写状态机解析，支持引号包裹、引号转义（""）、字段内换行
 *  - JSON → CSV：对象数组展平（嵌套属性用点号路径），自动收集表头并集
 *  - 表格预览：CSV 解析后渲染为 HTML 表格，便于校验
 *  - 自定义分隔符：逗号 / 分号 / Tab / 管道符
 *  - 表头开关：CSV 首行是否作为表头
 *  - 复制 / 下载 .csv 文件 / 清空 / 示例
 */

type Mode = 'csv2json' | 'json2csv';
type Delimiter = ',' | ';' | '\t' | '|';

interface ParseError {
  message: string;
  line: number; // 1-based，0 表示未知位置
}

/** CSV 解析结果 */
interface CsvParseResult {
  ok: boolean;
  rows: string[][]; // 解析后的二维数组（含表头行）
  err: ParseError | null;
}

/** JSON → CSV 转换结果 */
interface JsonToCsvResult {
  ok: boolean;
  csv: string;
  err: ParseError | null;
}

/**
 * CSV 解析状态机
 * 状态转移：
 *  - FIELD_START：字段开始，遇 " 进 QUOTED，遇分隔符字段为空，遇 \n 行结束，其余进 UNQUOTED
 *  - UNQUOTED：未引用字段，遇分隔符字段结束，遇 \n 行结束，其余累积字符
 *  - QUOTED：引用字段，遇 " 进 QUOTE_MAY_END，其余累积字符（含换行）
 *  - QUOTE_MAY_END：引用字段中遇 "，若下一个仍是 " 则转义为单个 "，否则引用结束
 */
function parseCsv(text: string, delimiter: Delimiter): CsvParseResult {
  if (text === '') return { ok: true, rows: [], err: null };
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let state: 'FIELD_START' | 'UNQUOTED' | 'QUOTED' | 'QUOTE_MAY_END' = 'FIELD_START';
  let line = 1; // 用于错误定位

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') line++;

    switch (state) {
      case 'FIELD_START':
        if (ch === '"') {
          state = 'QUOTED';
        } else if (ch === delimiter) {
          currentRow.push(currentField);
          currentField = '';
          // 仍在 FIELD_START 状态，下一个字符从新字段开始
        } else if (ch === '\n') {
          currentRow.push(currentField);
          currentField = '';
          rows.push(currentRow);
          currentRow = [];
        } else if (ch === '\r') {
          // 跳过 \r，等 \n 处理行结束（兼容 CRLF）
        } else {
          currentField += ch;
          state = 'UNQUOTED';
        }
        break;
      case 'UNQUOTED':
        if (ch === delimiter) {
          currentRow.push(currentField);
          currentField = '';
          state = 'FIELD_START';
        } else if (ch === '\n') {
          currentRow.push(currentField);
          currentField = '';
          rows.push(currentRow);
          currentRow = [];
          state = 'FIELD_START';
        } else if (ch === '\r') {
          // 跳过 \r
        } else {
          currentField += ch;
        }
        break;
      case 'QUOTED':
        if (ch === '"') {
          state = 'QUOTE_MAY_END';
        } else {
          currentField += ch;
        }
        break;
      case 'QUOTE_MAY_END':
        if (ch === '"') {
          // 转义：两个连续 " 表示一个字面量 "
          currentField += '"';
          state = 'QUOTED';
        } else if (ch === delimiter) {
          currentRow.push(currentField);
          currentField = '';
          state = 'FIELD_START';
        } else if (ch === '\n') {
          currentRow.push(currentField);
          currentField = '';
          rows.push(currentRow);
          currentRow = [];
          state = 'FIELD_START';
        } else if (ch === '\r') {
          // 跳过 \r
        } else {
          // 引号后跟非分隔非换行字符：容错处理，按字面量追加
          currentField += ch;
          state = 'UNQUOTED';
        }
        break;
    }
  }

  // 处理末尾未结束的字段/行
  if (state === 'QUOTED') {
    return { ok: false, rows: [], err: { message: '引号未闭合，请检查末尾是否缺少 " 字符', line } };
  }
  // 末尾若有未提交字段或行，补充进 rows
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return { ok: true, rows, err: null };
}

/**
 * 将对象展平为键值映射：嵌套属性用点号路径（如 user.address.city → "user.address.city"）
 * 数组用 [index] 标记（如 tags[0] → "tags[0]"）
 */
function flattenObject(obj: unknown, prefix: string, out: Record<string, string>): void {
  if (obj === null || obj === undefined) {
    out[prefix] = '';
    return;
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      out[prefix] = '[]';
      return;
    }
    obj.forEach((item, idx) => {
      flattenObject(item, `${prefix}[${idx}]`, out);
    });
    return;
  }
  if (typeof obj === 'object') {
    const entries = Object.entries(obj as object);
    if (entries.length === 0) {
      out[prefix] = '{}';
      return;
    }
    entries.forEach(([k, v]) => {
      const newPrefix = prefix === '' ? k : `${prefix}.${k}`;
      flattenObject(v, newPrefix, out);
    });
    return;
  }
  // 基础类型：数字、字符串、布尔
  out[prefix] = String(obj);
}

/** 将值转换为 CSV 字段：含分隔符、引号、换行则用 " 包裹，内部 " 转义为 "" */
function escapeCsvField(value: string, delimiter: Delimiter): string {
  if (value === '') return '';
  const needQuote = value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r');
  if (!needQuote) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/** JSON → CSV：仅支持对象数组，单对象会被包装为单元素数组 */
function jsonToCsv(text: string, delimiter: Delimiter, hasHeader: boolean): JsonToCsvResult {
  if (text.trim() === '') return { ok: true, csv: '', err: null };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, csv: '', err: { message: `JSON 解析失败：${msg}`, line: 0 } };
  }
  // 仅支持对象或对象数组
  let arr: unknown[];
  if (Array.isArray(value)) {
    arr = value;
  } else if (value && typeof value === 'object') {
    arr = [value];
  } else {
    return { ok: false, csv: '', err: { message: 'JSON 必须是对象或对象数组（不支持纯字符串、数字、布尔）', line: 0 } };
  }
  if (arr.length === 0) return { ok: true, csv: '', err: null };

  // 展平每个对象，收集所有键的并集作为表头（保持首次出现顺序）
  const flatRows: Record<string, string>[] = arr.map((item) => {
    const flat: Record<string, string> = {};
    flattenObject(item, '', flat);
    return flat;
  });
  const headerSet: string[] = [];
  const seen = new Set<string>();
  flatRows.forEach((row) => {
    Object.keys(row).forEach((k) => {
      if (!seen.has(k)) {
        seen.add(k);
        headerSet.push(k);
      }
    });
  });

  // 拼接 CSV
  const lines: string[] = [];
  if (hasHeader) {
    lines.push(headerSet.map((h) => escapeCsvField(h, delimiter)).join(delimiter));
  }
  flatRows.forEach((row) => {
    const line = headerSet.map((h) => escapeCsvField(row[h] ?? '', delimiter)).join(delimiter);
    lines.push(line);
  });
  return { ok: true, csv: lines.join('\n'), err: null };
}

/** 统计字符数与行数 */
function computeStats(text: string) {
  const chars = text.length;
  const lines = chars === 0 ? 0 : text.split('\n').length;
  return { chars, lines };
}

/** 推断后的值类型 */
type InferredType = 'number' | 'boolean' | 'null' | 'string';

/** 类型推断结果 */
interface TypeInference {
  value: string | number | boolean | null;
  type: InferredType;
  /** 风险提示（如「前导零数字可能丢失精度」），无风险则为空字符串 */
  warning: string;
}

/**
 * 智能类型推断：尝试将 CSV 字段字符串转换为 number/boolean/null
 * 保留字符串的场景：
 *  1. 前导零数字（如 021000 邮政编码、01012345678 电话）→ 保留为 string 并提示
 *  2. 超过 Number.MAX_SAFE_INTEGER 的大整数 → 保留为 string 并提示精度丢失
 *  3. 无法识别的字符串 → 默认 string
 * 注意：本函数仅做「尽量保守」的推断，宁可保留字符串也不误判
 */
function inferType(raw: string): TypeInference {
  const trimmed = raw.trim();
  // 空字符串 → null（CSV 中空字段常见）
  if (trimmed === '') return { value: null, type: 'null', warning: '' };

  // 布尔：true/false（不区分大小写，仅匹配字面量）
  const lower = trimmed.toLowerCase();
  if (lower === 'true') return { value: true, type: 'boolean', warning: '' };
  if (lower === 'false') return { value: false, type: 'boolean', warning: '' };

  // null 字面量：null / NULL / None / nil（兼容多语言习惯）
  if (lower === 'null' || lower === 'none' || lower === 'nil') {
    return { value: null, type: 'null', warning: '' };
  }

  // 数字推断区
  if (/^-?\d+$/.test(trimmed)) {
    // 纯整数
    // 风险 1：前导零（长度 > 1 且以 0 开头）→ 邮政编码/电话号码/ID，保留字符串
    if (/^0\d+$/.test(trimmed)) {
      return {
        value: trimmed,
        type: 'string',
        warning: '前导零数字（常见于邮政编码、电话号码、编号），保留为字符串避免丢失前导零',
      };
    }
    // 风险 2：超过安全整数范围 → 精度丢失
    const num = Number(trimmed);
    if (!Number.isSafeInteger(num)) {
      return {
        value: trimmed,
        type: 'string',
        warning: '整数超过 Number.MAX_SAFE_INTEGER（2^53-1），转 number 会丢失精度，保留为字符串',
      };
    }
    return { value: num, type: 'number', warning: '' };
  }

  // 小数与科学计数法
  if (/^-?\d+\.\d+$/.test(trimmed) || /^-?\d+(\.\d+)?[eE][+-]?\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!Number.isNaN(num) && Number.isFinite(num)) {
      return { value: num, type: 'number', warning: '' };
    }
  }

  // 默认：字符串
  return { value: trimmed, type: 'string', warning: '' };
}

/** 类型徽章文本（用于表格预览中显示） */
const TYPE_BADGE: Record<InferredType, string> = {
  number: 'N',
  boolean: 'B',
  null: '∅',
  string: 'S',
};


/** 触发浏览器下载文件（用于 .csv 文件下载） */
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

const SAMPLE_CSV = `name,age,city,tags,active
张三,28,北京,"前端,后端",true
李四,34,"上海
浦东","java,go",false
王五,25,深圳,,true`;

const SAMPLE_JSON = `[
  { "name": "工具盒子", "version": "1.0", "active": true, "author": { "name": "开发者", "email": "dev@example.com" } },
  { "name": "CSV 模块", "version": "0.5", "active": false, "author": { "name": "访客", "email": "guest@example.com" } }
]`;

/** 类型推断风险提示项 */
interface TypeWarning {
  row: number; // 数据行号（1-based，不含表头）
  field: string; // 字段名
  raw: string; // 原始值
  reason: string; // 警告原因
}

export default function CsvJsonTool() {
  const [mode, setMode] = useState<Mode>('csv2json');
  const [input, setInput] = useState<string>('');
  const [output, setOutput] = useState<string>('');
  // CSV 解析后的二维数组（含表头行），用于表格预览
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  // 每格的推断类型（仅 inferTypes 启用时填充，否则为空数组）
  const [previewTypes, setPreviewTypes] = useState<InferredType[][]>([]);
  const [delimiter, setDelimiter] = useState<Delimiter>(',');
  const [hasHeader, setHasHeader] = useState<boolean>(true);
  const [live, setLive] = useState<boolean>(true);
  // 智能类型推断开关：启用后 CSV → JSON 时自动转换数字/布尔/null
  const [inferTypes, setInferTypes] = useState<boolean>(false);
  const [error, setError] = useState<ParseError | null>(null);
  const [notice, setNotice] = useState<string>('');
  const [copied, setCopied] = useState(false);
  // 类型推断的风险提示列表（如前导零数字、超大整数）
  const [warnings, setWarnings] = useState<TypeWarning[]>([]);

  const inputStats = useMemo(() => computeStats(input), [input]);
  const outputStats = useMemo(() => computeStats(output), [output]);

  /** 执行一次转换：根据当前模式调用对应算法 */
  const runTransform = useCallback(
    (text: string, m: Mode, d: Delimiter, header: boolean, infer: boolean) => {
      setNotice('');
      setCopied(false);
      setWarnings([]);
      setPreviewTypes([]);
      if (text === '') {
        setOutput('');
        setPreviewRows([]);
        setError(null);
        return;
      }
      if (m === 'csv2json') {
        const result = parseCsv(text, d);
        if (!result.ok) {
          setError(result.err!);
          setOutput('');
          setPreviewRows([]);
          return;
        }
        // CSV → JSON：根据 hasHeader 决定输出对象数组还是二维数组
        const rows = result.rows;
        setPreviewRows(rows);
        try {
          let jsonValue: unknown;
          // 收集类型标记与风险提示（仅 infer 启用时）
          const typesGrid: InferredType[][] = [];
          const warns: TypeWarning[] = [];
          if (header && rows.length >= 1) {
            const headers = rows[0];
            const dataRows = rows.slice(1);
            const objArr = dataRows.map((row, rowIdx) => {
              const obj: Record<string, unknown> = {};
              const rowTypes: InferredType[] = [];
              headers.forEach((h, i) => {
                const fieldName = h || `field_${i}`;
                const raw = row[i] ?? '';
                // 启用类型推断时转换，否则保留字符串
                if (infer) {
                  const inferred = inferType(raw);
                  obj[fieldName] = inferred.value;
                  rowTypes.push(inferred.type);
                  // 收集风险提示
                  if (inferred.warning) {
                    warns.push({
                      row: rowIdx + 1,
                      field: fieldName,
                      raw,
                      reason: inferred.warning,
                    });
                  }
                } else {
                  obj[fieldName] = raw;
                  rowTypes.push('string');
                }
              });
              typesGrid.push(rowTypes);
              return obj;
            });
            jsonValue = objArr;
          } else {
            // 无表头模式：二维数组，启用推断时转换每个元素
            if (infer) {
              jsonValue = rows.map((row, rowIdx) =>
                row.map((cell, colIdx) => {
                  const inferred = inferType(cell);
                  if (inferred.warning) {
                    warns.push({
                      row: rowIdx + 1,
                      field: `col_${colIdx}`,
                      raw: cell,
                      reason: inferred.warning,
                    });
                  }
                  return inferred.value;
                }),
              );
              typesGrid.push(...rows.map((row) => row.map((cell) => inferType(cell).type)));
            } else {
              jsonValue = rows;
            }
          }
          setOutput(JSON.stringify(jsonValue, null, 2));
          setPreviewTypes(typesGrid);
          setWarnings(warns);
          setError(null);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setError({ message: `转换失败：${msg}`, line: 0 });
          setOutput('');
        }
      } else {
        // JSON → CSV：JSON 本身有类型，不需要类型推断
        const result = jsonToCsv(text, d, header);
        if (!result.ok) {
          setError(result.err!);
          setOutput('');
          setPreviewRows([]);
          return;
        }
        setOutput(result.csv);
        setError(null);
        // 同时解析生成的 CSV 用于表格预览
        const preview = parseCsv(result.csv, d);
        setPreviewRows(preview.ok ? preview.rows : []);
      }
    },
    [],
  );

  /** 实时模式：输入或参数变化时自动转换 */
  useEffect(() => {
    if (!live) return;
    runTransform(input, mode, delimiter, hasHeader, inferTypes);
  }, [live, input, mode, delimiter, hasHeader, inferTypes, runTransform]);

  /** 手动触发（关闭实时模式时使用） */
  const handleRun = useCallback(() => {
    runTransform(input, mode, delimiter, hasHeader, inferTypes);
  }, [input, mode, delimiter, hasHeader, inferTypes, runTransform]);

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

  /** 下载输出为文件：CSV 模式下载 .csv，JSON 模式下载 .json */
  const handleDownload = useCallback(() => {
    if (!output) return;
    if (mode === 'csv2json') {
      downloadFile('converted.json', output, 'application/json;charset=utf-8');
      setNotice('已下载 converted.json');
    } else {
      // CSV 文件加 UTF-8 BOM 头，确保 Excel 正确识别中文
      const bom = '\uFEFF';
      downloadFile('converted.csv', bom + output, 'text/csv;charset=utf-8');
      setNotice('已下载 converted.csv（含 BOM，Excel 直接可读）');
    }
    setTimeout(() => setNotice(''), 2500);
  }, [output, mode]);

  /** 清空 */
  const handleClear = useCallback(() => {
    setInput('');
    setOutput('');
    setPreviewRows([]);
    setPreviewTypes([]);
    setWarnings([]);
    setError(null);
    setNotice('');
    setCopied(false);
  }, []);

  /** 载入示例：根据当前模式载入对应示例数据 */
  const handleSample = useCallback(() => {
    setInput(mode === 'csv2json' ? SAMPLE_CSV : SAMPLE_JSON);
    setOutput('');
    setPreviewRows([]);
    setPreviewTypes([]);
    setWarnings([]);
    setError(null);
    setNotice('');
  }, [mode]);

  /** 切换模式时清空输出，避免误用旧结果 */
  const onModeChange = useCallback((m: Mode) => {
    setMode(m);
    setOutput('');
    setPreviewRows([]);
    setPreviewTypes([]);
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
  const inputLabel = mode === 'csv2json' ? 'CSV 输入' : 'JSON 输入';
  const outputLabel = mode === 'csv2json' ? 'JSON 结果' : 'CSV 结果';
  const inputPlaceholder = mode === 'csv2json'
    ? '在此粘贴 CSV 文本，首行可作为表头，支持引号包裹与字段内换行'
    : '在此粘贴 JSON 对象数组，嵌套属性将自动展平为点号路径列';
  const outputPlaceholder = '处理结果将显示在这里';

  // 表格预览：取前 50 行避免大数据卡顿
  const previewLimited = useMemo(() => previewRows.slice(0, 51), [previewRows]);
  const previewOverflow = previewRows.length > 51;

  return (
    <div className="jsontool csvtool">
      {/* 工具栏 */}
      <div className="jsontool__toolbar" role="toolbar" aria-label="CSV / JSON 互转操作">
        <div className="jsontool__actions">
          <div className="b64tool__seg" role="group" aria-label="转换方向">
            <button
              className={`btn btn--sm${mode === 'csv2json' ? ' btn--primary' : ''}`}
              aria-pressed={mode === 'csv2json'}
              onClick={() => onModeChange('csv2json')}
            >
              CSV → JSON
            </button>
            <button
              className={`btn btn--sm${mode === 'json2csv' ? ' btn--primary' : ''}`}
              aria-pressed={mode === 'json2csv'}
              onClick={() => onModeChange('json2csv')}
            >
              JSON → CSV
            </button>
          </div>
          {!live && (
            <button className="btn btn--primary btn--sm" onClick={handleRun}>转换</button>
          )}
        </div>
        <div className="jsontool__options">
          <label className="b64tool__toggle">
            分隔符
            <select
              value={delimiter}
              onChange={(e) => setDelimiter(e.target.value as Delimiter)}
              aria-label="CSV 分隔符"
            >
              <option value={','}>逗号 ,</option>
              <option value={';'}>分号 ;</option>
              <option value={'\t'}>Tab</option>
              <option value={'|'}>管道符 |</option>
            </select>
          </label>
          <label className="b64tool__toggle">
            <input
              type="checkbox"
              checked={hasHeader}
              onChange={(e) => setHasHeader(e.target.checked)}
            />
            <span>首行表头</span>
          </label>
          <label className="b64tool__toggle">
            <input
              type="checkbox"
              checked={live}
              onChange={(e) => setLive(e.target.checked)}
            />
            <span>实时转换</span>
          </label>
          {mode === 'csv2json' && (
            <label className="b64tool__toggle csvtool__infer-toggle" title="启用后 CSV → JSON 时自动将数字、布尔、null 字面量转换为对应类型，前导零数字与大整数保留为字符串并提示">
              <input
                type="checkbox"
                checked={inferTypes}
                onChange={(e) => setInferTypes(e.target.checked)}
              />
              <span>智能类型</span>
            </label>
          )}
          <button className="btn btn--sm" onClick={handleSample}>示例</button>
          <button className="btn btn--sm" onClick={handleClear}>清空</button>
        </div>
      </div>

      {/* 编辑区 */}
      <div className="jsontool__panels">
        <div className="jsontool__panel">
          <label htmlFor="csv-input" className="jsontool__label">
            {inputLabel}
            <span className="jsontool__stat">{inputStats.chars} 字 · {inputStats.lines} 行</span>
          </label>
          <textarea
            id="csv-input"
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
              className="btn btn--sm csvtool__download"
              onClick={handleDownload}
              disabled={!output}
              aria-label="下载结果文件"
              title={mode === 'csv2json' ? '下载 .json 文件' : '下载 .csv 文件（含 BOM，Excel 直接可读）'}
            >
              下载
            </button>
          </div>
          <textarea
            className="jsontool__textarea jsontool__textarea--output"
            value={output}
            readOnly
            placeholder={outputPlaceholder}
            spellCheck={false}
            aria-label={outputLabel}
          />
        </div>
      </div>

      {/* 表格预览：CSV 解析后渲染为 HTML 表格，便于校验 */}
      {previewRows.length > 0 && (
        <div className="csvtool__preview" aria-live="polite">
          <div className="csvtool__preview-head">
            <h3 className="csvtool__preview-title">表格预览</h3>
            <span className="csvtool__preview-count">
              共 {previewRows.length} 行{previewOverflow ? '（仅显示前 50 行）' : ''}
              {inferTypes && mode === 'csv2json' && previewTypes.length > 0 && (
                <span className="csvtool__legend">
                  <span className="csvtool__type-badge csvtool__type-badge--number" title="数字">N</span>数字
                  <span className="csvtool__type-badge csvtool__type-badge--boolean" title="布尔">B</span>布尔
                  <span className="csvtool__type-badge csvtool__type-badge--null" title="null">∅</span>null
                  <span className="csvtool__type-badge csvtool__type-badge--string" title="字符串">S</span>字符串
                </span>
              )}
            </span>
          </div>
          <div className="csvtool__preview-scroll" role="region" aria-label="CSV 表格预览" tabIndex={0}>
            <table className="csvtool__table">
              <tbody>
                {previewLimited.map((row, rIdx) => (
                  <tr key={rIdx} className={rIdx === 0 && hasHeader ? 'csvtool__table-head-row' : ''}>
                    {row.map((cell, cIdx) => {
                      // 含表头时第一行用 th，否则全用 td；空单元格渲染为占位
                      const isHeader = rIdx === 0 && hasHeader;
                      const display = cell === '' ? '' : cell;
                      // 类型徽章：仅 inferTypes 启用且有类型数据时显示
                      const cellType = (inferTypes && !isHeader && previewTypes[rIdx])
                        ? previewTypes[rIdx][cIdx]
                        : null;
                      const badge = cellType ? TYPE_BADGE[cellType] : '';
                      return isHeader ? (
                        <th key={cIdx} scope="col" className="csvtool__th">{display}</th>
                      ) : (
                        <td key={cIdx} className={`csvtool__td${cellType ? ` csvtool__td--${cellType}` : ''}`}>
                          <span className="csvtool__cell-text">{display}</span>
                          {badge && (
                            <span
                              className={`csvtool__type-badge csvtool__type-badge--${cellType}`}
                              title={`推断类型：${cellType}`}
                              aria-label={`类型 ${cellType}`}
                            >{badge}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 类型推断风险提示区：仅启用智能类型且有风险项时显示 */}
      {warnings.length > 0 && (
        <div className="csvtool__warnings" role="alert" aria-live="polite">
          <div className="csvtool__warnings-head">
            <strong>⚠ 类型推断风险提示（{warnings.length} 项）</strong>
            <span className="csvtool__warnings-hint">以下字段已保留为字符串，避免数据丢失</span>
          </div>
          <ul className="csvtool__warnings-list">
            {warnings.slice(0, 20).map((w, idx) => (
              <li key={idx} className="csvtool__warning-item">
                <span className="csvtool__warning-loc">第 {w.row} 行 · {w.field}</span>
                <code className="csvtool__warning-raw">{w.raw}</code>
                <span className="csvtool__warning-reason">{w.reason}</span>
              </li>
            ))}
            {warnings.length > 20 && (
              <li className="csvtool__warning-item csvtool__warning-more">
                还有 {warnings.length - 20} 项提示已省略，请检查对应字段
              </li>
            )}
          </ul>
        </div>
      )}

      {/* 状态条 */}
      <div className="jsontool__status" role="status" aria-live="polite">
        {error ? (
          <div className="jsontool__error">
            <strong>❌ 错误</strong>
            <span>{error.message}</span>
            {error.line > 0 && (
              <span className="jsontool__error-loc">（约第 {error.line} 行）</span>
            )}
          </div>
        ) : notice ? (
          <div className="jsontool__notice">{notice}</div>
        ) : (
          <div className="jsontool__hint">
            所有数据仅在你浏览器内处理，不会上传到任何服务器。
          </div>
        )}
      </div>
    </div>
  );
}
