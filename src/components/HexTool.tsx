import { useState, useMemo, useCallback, useEffect } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * Hex 十六进制编解码工具
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 编码：文本 → Hex（支持 UTF-8 中文与 Emoji）
 *  - 解码：Hex → 文本（自动识别多种格式，容忍空格/0x 前缀/逗号/注释/Hex dump）
 *  - 5 种编码格式：连续 / 空格分隔 / 0x 前缀 / C 数组 / Hex dump（xxd 风格）
 *  - 大小写切换、实时模式、复制、清空、示例
 *
 * 适用场景：
 *  - 二进制数据查看、调试输出、字节序列分析
 *  - 颜色值、MAC 地址、Magic Number、文件头标识
 *  - 嵌入式开发：C 数组导出、固件字节数据
 *  - 与 Base64/Base32 形成编码三工具矩阵
 */

type Mode = 'encode' | 'decode';
type HexFormat = 'continuous' | 'space' | '0x' | 'c-array' | 'hex-dump';

interface Result {
  ok: boolean;
  value: string;
  error: string;
}

const FORMAT_LABELS: Record<HexFormat, string> = {
  'continuous': '连续',
  'space': '空格分隔',
  '0x': '0x 前缀',
  'c-array': 'C 数组',
  'hex-dump': 'Hex dump',
};

/** 将单个字节转为两位 hex 字符串 */
function byteToHex(b: number, upper: boolean): string {
  const s = b.toString(16).padStart(2, '0');
  return upper ? s.toUpperCase() : s;
}

/** 生成 xxd 风格的 Hex dump：每行 16 字节，含偏移量、hex 部分、ASCII 部分 */
function hexDump(bytes: Uint8Array, upper: boolean): string {
  if (bytes.length === 0) return '';
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const end = Math.min(offset + 16, bytes.length);
    const chunk = bytes.subarray(offset, end);
    // 偏移量：8 位 hex
    const offsetHex = offset.toString(16).padStart(8, '0');
    // hex 部分：每字节 2 字符，字节间空格，8 字节后多一空格（xxd 风格）
    const hexParts: string[] = [];
    for (let i = 0; i < 16; i++) {
      if (i < chunk.length) {
        hexParts.push(byteToHex(chunk[i], upper));
      } else {
        hexParts.push('  '); // 不足 16 字节用空格补齐对齐
      }
    }
    // 在第 8 字节后插入额外空格（xxd 风格的 8 字节分组）
    const hexLine = hexParts.slice(0, 8).join(' ') + '  ' + hexParts.slice(8).join(' ');
    // ASCII 部分：可打印字符（0x20-0x7E）原样显示，其余用 .
    const ascii = Array.from(chunk, b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : '.').join('');
    lines.push(`${offsetHex}: ${hexLine}  ${ascii}`);
  }
  return lines.join('\n');
}

/** 编码：文本 → Hex 字符串（按格式输出） */
function encodeHex(text: string, format: HexFormat, upper: boolean): Result {
  if (text === '') return { ok: true, value: '', error: '' };
  try {
    const bytes = new TextEncoder().encode(text);
    if (format === 'hex-dump') {
      return { ok: true, value: hexDump(bytes, upper), error: '' };
    }
    const hexList = Array.from(bytes, b => byteToHex(b, upper));
    let output: string;
    switch (format) {
      case 'continuous':
        output = hexList.join('');
        break;
      case 'space':
        output = hexList.join(' ');
        break;
      case '0x':
        output = hexList.map(h => '0x' + h).join(' ');
        break;
      case 'c-array':
        output = `{ ${hexList.map(h => '0x' + h).join(', ')} }`;
        break;
      default:
        output = hexList.join('');
    }
    return { ok: true, value: output, error: '' };
  } catch (e) {
    return { ok: false, value: '', error: `编码失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 解码：Hex 字符串 → 文本（自动识别多种格式，容忍分隔符与注释） */
function decodeHex(input: string): Result {
  const trimmed = input.trim();
  if (trimmed === '') return { ok: true, value: '', error: '' };

  let cleaned: string;

  // 检测 Hex dump 格式：行首为 6-8 位 hex 偏移 + 冒号
  const isHexDump = /^[0-9a-fA-F]{6,8}:\s+/m.test(trimmed);
  if (isHexDump) {
    // 逐行提取冒号后的 hex 字节部分（直到遇到连续 2 个空格或行尾）
    const parts: string[] = [];
    for (const line of trimmed.split('\n')) {
      const m = line.match(/^[0-9a-fA-F]{6,8}:\s+([0-9a-fA-F ]+?)(?:\s{2,}|$)/);
      if (m && m[1]) {
        parts.push(m[1].replace(/\s+/g, ''));
      }
    }
    cleaned = parts.join('');
  } else {
    // 通用清理：移除块注释、行注释、0x 前缀、C 数组花括号、分隔符
    cleaned = trimmed
      .replace(/\/\*[\s\S]*?\*\//g, '') // C 块注释 /* ... */
      .replace(/\/\/[^\n]*/g, '')        // C 行注释 //
      .replace(/#[^\n]*/g, '')           // Shell/Python 行注释 #
      .replace(/0x/gi, '')               // 0x 前缀
      .replace(/[{}]/g, '')              // C 数组花括号
      .replace(/[\s,;:|]/g, '');         // 空白与分隔符
  }

  if (cleaned === '') return { ok: true, value: '', error: '' };

  // 奇数长度自动在前补 0（容忍用户漏输前导 0）
  if (cleaned.length % 2 === 1) cleaned = '0' + cleaned;

  // 验证是否仅含合法 hex 字符
  if (!/^[0-9a-fA-F]*$/.test(cleaned)) {
    const match = cleaned.match(/[^0-9a-fA-F]/);
    return { ok: false, value: '', error: `非法字符 "${match?.[0] ?? ''}"（仅允许 0-9、a-f、A-F）` };
  }

  // 每 2 字符解析为一个字节
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleaned.substr(i * 2, 2), 16);
  }

  // 尝试 UTF-8 解码，非法字节序列给出友好错误
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { ok: true, value: text, error: '' };
  } catch (e) {
    // 给出降级提示，但用 replacement 字符仍可显示可解码部分
    const loose = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    return {
      ok: true,
      value: loose,
      error: `⚠ 输入含非法 UTF-8 字节序列（已用 替换字符显示）：${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** 统计字符数与行数 */
function computeStats(text: string) {
  const chars = text.length;
  const lines = chars === 0 ? 0 : text.split('\n').length;
  return { chars, lines };
}

const SAMPLE = '工具盒子 · Hex 编解码\n支持中文与 Emoji 🎉';

export default function HexTool() {
  const [mode, setMode] = useState<Mode>('encode');
  const [input, setInput] = useState<string>('');
  const [output, setOutput] = useState<string>('');
  const [format, setFormat] = useState<HexFormat>('continuous');
  const [upper, setUpper] = useState<boolean>(false);
  const [live, setLive] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [notice, setNotice] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const inputStats = useMemo(() => computeStats(input), [input]);
  const outputStats = useMemo(() => computeStats(output), [output]);

  /** 执行一次转换 */
  const runTransform = useCallback((text: string, m: Mode, fmt: HexFormat, up: boolean) => {
    const result = m === 'encode' ? encodeHex(text, fmt, up) : decodeHex(text);
    setOutput(result.value);
    // decodeHex 在含非法字节时返回 ok=true 但带 warning 提示
    if (result.ok && result.error.startsWith('⚠')) {
      setError('');
      setNotice(result.error);
    } else {
      setError(result.ok ? '' : result.error);
      setNotice('');
    }
  }, []);

  /** 实时模式自动转换 */
  useEffect(() => {
    if (!live) return;
    runTransform(input, mode, format, upper);
  }, [live, input, mode, format, upper, runTransform]);

  const handleRun = useCallback(() => {
    runTransform(input, mode, format, upper);
  }, [input, mode, format, upper, runTransform]);

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

  const handleClear = useCallback(() => {
    setInput('');
    setOutput('');
    setError('');
    setNotice('');
    setCopied(false);
  }, []);

  const handleSample = useCallback(() => {
    setInput(SAMPLE);
    setOutput('');
    setError('');
    setNotice('');
  }, []);

  /** 切换模式时清空输出，避免误用旧结果 */
  const onModeChange = useCallback((m: Mode) => {
    setMode(m);
    setOutput('');
    setError('');
    setNotice('');
    setCopied(false);
  }, []);

  const onFormatChange = useCallback((f: HexFormat) => {
    setFormat(f);
    setOutput('');
    setError('');
    setNotice('');
    setCopied(false);
  }, []);

  const onInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (error) setError('');
    if (notice) setNotice('');
  }, [error, notice]);

  // 标签与占位符随模式切换
  const inputLabel = mode === 'encode' ? '原始文本' : 'Hex 字符串';
  const outputLabel = mode === 'encode' ? 'Hex 结果' : '解码文本';
  const inputPlaceholder = mode === 'encode'
    ? '在此输入要编码的文本，支持中文与 Emoji'
    : '在此粘贴要解码的 Hex 字符串（支持空格、0x 前缀、C 数组、Hex dump）';
  const outputPlaceholder = '处理结果将显示在这里';

  return (
    <div className="jsontool hextool">
      {/* 工具栏 */}
      <div className="jsontool__toolbar" role="toolbar" aria-label="Hex 操作">
        <div className="jsontool__actions">
          <div className="hextool__seg" role="group" aria-label="操作方向">
            <button
              className={`btn btn--sm${mode === 'encode' ? ' btn--primary' : ''}`}
              aria-pressed={mode === 'encode'}
              onClick={() => onModeChange('encode')}
            >
              编码
            </button>
            <button
              className={`btn btn--sm${mode === 'decode' ? ' btn--primary' : ''}`}
              aria-pressed={mode === 'decode'}
              onClick={() => onModeChange('decode')}
            >
              解码
            </button>
          </div>
          {!live && (
            <button className="btn btn--primary btn--sm" onClick={handleRun}>转换</button>
          )}
        </div>
        <div className="jsontool__options">
          {/* 编码格式选择：仅编码模式可见 */}
          {mode === 'encode' && (
            <div className="hextool__seg" role="group" aria-label="输出格式">
              {(Object.keys(FORMAT_LABELS) as HexFormat[]).map((f) => (
                <button
                  key={f}
                  className={`btn btn--sm${format === f ? ' btn--primary' : ''}`}
                  aria-pressed={format === f}
                  onClick={() => onFormatChange(f)}
                >
                  {FORMAT_LABELS[f]}
                </button>
              ))}
            </div>
          )}
          {/* 大小写切换：仅编码模式可见 */}
          {mode === 'encode' && (
            <label className="hextool__toggle">
              <input
                type="checkbox"
                checked={upper}
                onChange={(e) => setUpper(e.target.checked)}
              />
              <span>大写</span>
            </label>
          )}
          <label className="hextool__toggle">
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
          <label htmlFor="hex-input" className="jsontool__label">
            {inputLabel}
            <span className="jsontool__stat">{inputStats.chars} 字 · {inputStats.lines} 行</span>
          </label>
          <textarea
            id="hex-input"
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
            所有数据仅在你浏览器内处理，不会上传到任何服务器。
          </div>
        )}
      </div>
    </div>
  );
}
