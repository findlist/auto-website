import { useState, useCallback, useEffect } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSV 与 Markdown 表格互转工具
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - CSV → Markdown 表格：手写状态机解析 CSV，输出 GFM 管道表格
 *  - Markdown 表格 → CSV：解析 GFM 表格语法，输出标准 CSV
 *  - 列对齐方式支持（左 / 中 / 右 / 无）
 *  - 自定义 CSV 分隔符（逗号 / 分号 / Tab / 管道符）
 *  - 表头开关、Markdown 管道符转义
 */

type Mode = 'csv2md' | 'md2csv';
type Delimiter = ',' | ';' | '\t' | '|';
type Align = 'left' | 'center' | 'right' | 'none';

interface ParseError {
  message: string;
  line: number; // 1-based，0 表示未知位置
}

/** CSV 解析结果 */
interface CsvParseResult {
  ok: boolean;
  rows: string[][]; // 解析后的二维数组
  err: ParseError | null;
}

/** Markdown 表格解析结果 */
interface MdTableParseResult {
  ok: boolean;
  rows: string[][]; // 解析后的二维数组（含表头行）
  aligns: Align[]; // 各列对齐方式
  err: ParseError | null;
}

const SAMPLE_CSV = `姓名,年龄,城市,职业
张三,28,北京,前端工程师
李四,35,上海,后端工程师
王五,42,深圳,产品经理
赵六,31,杭州,UI 设计师`;

const SAMPLE_MD = `| 姓名 | 年龄 | 城市 | 职业 |
| --- | ---: | :---: | :--- |
| 张三 | 28 | 北京 | 前端工程师 |
| 李四 | 35 | 上海 | 后端工程师 |
| 王五 | 42 | 深圳 | 产品经理 |
| 赵六 | 31 | 杭州 | UI 设计师 |`;

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

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    switch (state) {
      case 'FIELD_START':
        if (ch === '"') {
          state = 'QUOTED';
        } else if (ch === delimiter) {
          currentRow.push(currentField);
          currentField = '';
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
          // 连续两个 " 转义为单个 "
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
          // 引号后跟非分隔非换行字符，容错处理：当作普通字符
          currentField += ch;
          state = 'UNQUOTED';
        }
        break;
    }
  }

  // 处理末尾未结束的字段与行
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return { ok: true, rows, err: null };
}

/**
 * 将二维数组序列化为 CSV 字符串
 * 含分隔符、引号、换行的字段用双引号包裹，内部引号转义为 ""
 */
function stringifyCsv(rows: string[][], delimiter: Delimiter): string {
  const needsQuoting = (val: string): boolean => {
    if (val === '') return false;
    return val.includes(delimiter) || val.includes('"') || val.includes('\n') || val.includes('\r');
  };

  const escapeField = (val: string): string => {
    if (!needsQuoting(val)) return val;
    return '"' + val.replace(/"/g, '""') + '"';
  };

  return rows.map((row) => row.map(escapeField).join(delimiter)).join('\n');
}

/**
 * 转义 Markdown 表格单元格中的管道符
 * | 转义为 \|，已转义的 \| 不重复转义
 */
function escapeMdCell(val: string): string {
  // 先还原已转义的 \|，再统一转义所有 |，避免重复转义
  return val.replace(/\\\|/g, '|').replace(/\|/g, '\\|');
}

/**
 * 还原 Markdown 表格单元格中被转义的管道符
 * \| 还原为 |
 */
function unescapeMdCell(val: string): string {
  return val.replace(/\\\|/g, '|');
}

/**
 * 根据对齐方式生成分隔行单元格
 * left:  :---
 * center: :---:
 * right: ---:
 * none:  ---
 */
function alignToSeparator(align: Align, minLen = 3): string {
  const dashes = '-'.repeat(Math.max(minLen, 3));
  switch (align) {
    case 'left':
      return ':' + dashes;
    case 'center':
      return ':' + dashes + ':';
    case 'right':
      return dashes + ':';
    default:
      return dashes;
  }
}

/**
 * 从分隔行解析列对齐方式
 * :---   → left
 * :---:  → center
 * ---:   → right
 * ---    → none
 */
function parseAlignFromSeparator(cell: string): Align {
  const trimmed = cell.trim();
  const hasLeft = trimmed.startsWith(':');
  const hasRight = trimmed.endsWith(':');
  if (hasLeft && hasRight) return 'center';
  if (hasRight) return 'right';
  if (hasLeft) return 'left';
  return 'none';
}

/**
 * 将二维数组转换为 GFM Markdown 表格
 */
function stringifyMdTable(rows: string[][], aligns: Align[], hasHeader: boolean): string {
  if (rows.length === 0) return '';
  const colCount = Math.max(...rows.map((r) => r.length));
  // 补齐每行列数一致
  const normalizedRows = rows.map((r) => {
    const padded = [...r];
    while (padded.length < colCount) padded.push('');
    return padded;
  });

  const lines: string[] = [];
  // 表头行：有表头时用第一行，无表头时生成默认列名
  let headerCells: string[];
  let dataStart: number;
  if (hasHeader) {
    headerCells = normalizedRows[0];
    dataStart = 1;
  } else {
    headerCells = Array.from({ length: colCount }, (_, i) => `列${i + 1}`);
    dataStart = 0;
  }
  lines.push('| ' + headerCells.map(escapeMdCell).join(' | ') + ' |');

  // 分隔行
  const sepCells: string[] = [];
  for (let i = 0; i < colCount; i++) {
    const align = aligns[i] || 'none';
    sepCells.push(alignToSeparator(align));
  }
  lines.push('| ' + sepCells.join(' | ') + ' |');

  // 数据行
  for (let i = Math.max(dataStart, 1); i < normalizedRows.length; i++) {
    const cells = normalizedRows[i].map(escapeMdCell);
    lines.push('| ' + cells.join(' | ') + ' |');
  }

  return lines.join('\n');
}

/**
 * 解析 GFM Markdown 表格文本
 * 要求至少有表头行 + 分隔行，分隔行识别列对齐
 */
function parseMdTable(text: string): MdTableParseResult {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, rows: [], aligns: [], err: null };

  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) {
    return {
      ok: false,
      rows: [],
      aligns: [],
      err: { message: 'Markdown 表格至少需要表头行与分隔行（共 2 行）', line: lines.length + 1 },
    };
  }

  // 解析行内单元格：去掉首尾 |，按 | 分割（注意 \| 转义）
  const parseRow = (line: string): string[] => {
    let inner = line.trim();
    // 去掉首尾管道符
    if (inner.startsWith('|')) inner = inner.slice(1);
    if (inner.endsWith('|')) inner = inner.slice(0, -1);
    // 按未转义的 | 分割
    const cells: string[] = [];
    let current = '';
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === '\\' && inner[i + 1] === '|') {
        current += '\\|';
        i++;
      } else if (ch === '|') {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells.map(unescapeMdCell);
  };

  const headerCells = parseRow(lines[0]);
  const separatorCells = parseRow(lines[1]);

  // 验证分隔行：每个单元格应只含 -、: 字符
  const isSeparatorCell = (cell: string): boolean => /^:?-+:?$/.test(cell.trim()) && cell.includes('-');
  if (!separatorCells.every(isSeparatorCell)) {
    return {
      ok: false,
      rows: [],
      aligns: [],
      err: { message: '第二行应为分隔行（如 | --- | --- |），仅含 - 与 : 字符', line: 2 },
    };
  }

  const colCount = headerCells.length;
  const aligns: Align[] = [];
  for (let i = 0; i < colCount; i++) {
    aligns.push(parseAlignFromSeparator(separatorCells[i] || ''));
  }

  const rows: string[][] = [headerCells];
  for (let i = 2; i < lines.length; i++) {
    const cells = parseRow(lines[i]);
    // 补齐列数
    while (cells.length < colCount) cells.push('');
    rows.push(cells);
  }

  return { ok: true, rows, aligns, err: null };
}

const ALIGN_LABELS: Record<Align, string> = {
  left: '左对齐',
  center: '居中',
  right: '右对齐',
  none: '默认',
};

const DELIMITER_LABELS: Record<Delimiter, string> = {
  ',': '逗号 (,)',
  ';': '分号 (;)',
  '\t': 'Tab',
  '|': '管道符 (|)',
};

export default function CsvMarkdownTool() {
  const [mode, setMode] = useState<Mode>('csv2md');
  const [input, setInput] = useState('');
  const [delimiter, setDelimiter] = useState<Delimiter>(',');
  const [outputDelimiter, setOutputDelimiter] = useState<Delimiter>(',');
  const [hasHeader, setHasHeader] = useState(true);
  const [align, setAlign] = useState<Align>('none');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 实时转换（useEffect 避免 SSR hydration mismatch）
  const [output, setOutput] = useState('');
  const [stats, setStats] = useState<{ rows: number; cols: number } | null>(null);

  useEffect(() => {
    if (!input.trim()) {
      setOutput('');
      setStats(null);
      setError(null);
      return;
    }

    if (mode === 'csv2md') {
      const result = parseCsv(input, delimiter);
      if (!result.ok || result.err) {
        setError(result.err?.message || 'CSV 解析失败');
        setOutput('');
        setStats(null);
        return;
      }
      if (result.rows.length === 0) {
        setError(null);
        setOutput('');
        setStats(null);
        return;
      }
      const colCount = Math.max(...result.rows.map((r) => r.length));
      const aligns: Align[] = Array(colCount).fill(align);
      const md = stringifyMdTable(result.rows, aligns, hasHeader);
      setError(null);
      setOutput(md);
      setStats({ rows: result.rows.length, cols: colCount });
    } else {
      const result = parseMdTable(input);
      if (!result.ok || result.err) {
        setError(result.err?.message || 'Markdown 表格解析失败');
        setOutput('');
        setStats(null);
        return;
      }
      if (result.rows.length === 0) {
        setError(null);
        setOutput('');
        setStats(null);
        return;
      }
      const csv = stringifyCsv(result.rows, outputDelimiter);
      setError(null);
      setOutput(csv);
      const colCount = Math.max(...result.rows.map((r) => r.length));
      setStats({ rows: result.rows.length, cols: colCount });
    }
  }, [input, mode, delimiter, outputDelimiter, hasHeader, align]);

  const handleCopy = useCallback(async () => {
    if (!output) return;
    const ok = await copyText(output);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [output]);

  const handleClear = useCallback(() => {
    setInput('');
    setOutput('');
    setStats(null);
    setError(null);
  }, []);

  const handleSample = useCallback(() => {
    setMode((prev) => {
      setInput(prev === 'csv2md' ? SAMPLE_CSV : SAMPLE_MD);
      return prev;
    });
  }, []);

  const handleModeChange = useCallback((newMode: Mode) => {
    setMode(newMode);
    // 切换模式时清空输入输出，避免上一个模式的输入被当作新模式解析
    setInput('');
    setOutput('');
    setStats(null);
    setError(null);
  }, []);

  const inputLabel = mode === 'csv2md' ? 'CSV 输入' : 'Markdown 表格输入';
  const outputLabel = mode === 'csv2md' ? 'Markdown 表格输出' : 'CSV 输出';
  const inputPlaceholder =
    mode === 'csv2md'
      ? '粘贴 CSV 文本，首行可作为表头...\n例如：\n姓名,年龄,城市\n张三,28,北京'
      : '粘贴 GFM Markdown 表格...\n例如：\n| 姓名 | 年龄 |\n| --- | ---: |\n| 张三 | 28 |';

  return (
    <div className="csvmd">
      {/* 模式切换 */}
      <div className="csvmd__mode" role="tablist" aria-label="转换模式">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'csv2md'}
          className={`csvmd__mode-btn${mode === 'csv2md' ? ' csvmd__mode-btn--active' : ''}`}
          onClick={() => handleModeChange('csv2md')}
        >
          CSV → Markdown
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'md2csv'}
          className={`csvmd__mode-btn${mode === 'md2csv' ? ' csvmd__mode-btn--active' : ''}`}
          onClick={() => handleModeChange('md2csv')}
        >
          Markdown → CSV
        </button>
      </div>

      {/* 选项面板 */}
      <div className="csvmd__options">
        {mode === 'csv2md' ? (
          <>
            <label className="csvmd__opt">
              <span>CSV 分隔符</span>
              <select value={delimiter} onChange={(e) => setDelimiter(e.target.value as Delimiter)}>
                {(Object.keys(DELIMITER_LABELS) as Delimiter[]).map((d) => (
                  <option key={d} value={d}>
                    {DELIMITER_LABELS[d]}
                  </option>
                ))}
              </select>
            </label>
            <label className="csvmd__opt">
              <span>列对齐</span>
              <select value={align} onChange={(e) => setAlign(e.target.value as Align)}>
                {(Object.keys(ALIGN_LABELS) as Align[]).map((a) => (
                  <option key={a} value={a}>
                    {ALIGN_LABELS[a]}
                  </option>
                ))}
              </select>
            </label>
            <label className="csvmd__opt csvmd__opt--checkbox">
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
              />
              <span>首行为表头</span>
            </label>
          </>
        ) : (
          <label className="csvmd__opt">
            <span>CSV 输出分隔符</span>
            <select
              value={outputDelimiter}
              onChange={(e) => setOutputDelimiter(e.target.value as Delimiter)}
            >
              {(Object.keys(DELIMITER_LABELS) as Delimiter[]).map((d) => (
                <option key={d} value={d}>
                  {DELIMITER_LABELS[d]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* 工具栏 */}
      <div className="csvmd__toolbar">
        <button type="button" className="csvmd__btn" onClick={handleSample}>
          示例
        </button>
        <button type="button" className="csvmd__btn" onClick={handleClear}>
          清空
        </button>
        <button
          type="button"
          className="csvmd__btn csvmd__btn--primary"
          onClick={handleCopy}
          disabled={!output}
        >
          {copied ? '已复制' : '复制结果'}
        </button>
      </div>

      {/* 双栏布局 */}
      <div className="csvmd__grid">
        <div className="csvmd__panel">
          <label className="csvmd__panel-label">{inputLabel}</label>
          <textarea
            className="csvmd__textarea"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={inputPlaceholder}
            spellCheck={false}
            aria-label={inputLabel}
          />
        </div>
        <div className="csvmd__panel">
          <label className="csvmd__panel-label">{outputLabel}</label>
          <textarea
            className="csvmd__textarea csvmd__textarea--output"
            value={output}
            readOnly
            placeholder="转换结果将在此显示..."
            spellCheck={false}
            aria-label={outputLabel}
          />
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="csvmd__error" role="alert">
          {error}
        </div>
      )}

      {/* 统计信息 */}
      {stats && !error && (
        <div className="csvmd__stats">
          <span>行数：{stats.rows}</span>
          <span>列数：{stats.cols}</span>
        </div>
      )}
    </div>
  );
}
