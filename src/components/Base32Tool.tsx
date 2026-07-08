import { useState, useMemo, useCallback, useEffect } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * Base32 编解码工具
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 编码：文本 → Base32（支持 UTF-8 中文）
 *  - 解码：Base32 → 文本（自动识别大小写、自动补齐填充）
 *  - 双变体：RFC 4648 标准（A-Z2-7）+ Crockford Base32（0-9A-Z 去除 I/L/O/U）
 *  - Crockford 校验和：可选生成（编码时附加）/ 校验（解码时验证）
 *  - 实时模式、复制、清空、示例
 *
 * 适用场景：
 *  - RFC 4648：TOTP 共享密钥、DNS 主机名、二维码短链
 *  - Crockford：账号号码、订单号、密钥指纹（带校验和识别输入错误）
 */

type Mode = 'encode' | 'decode';
type Variant = 'rfc4648' | 'crockford';

interface Result {
  ok: boolean;
  value: string;
  error: string;
}

// RFC 4648 标准字符表：A-Z + 2-7
const RFC4648_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
// Crockford 字符表：0-9 + A-Z 去除 I/L/O/U（共 32 字符）
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
// Crockford 校验字符表：0-9A-Z*~$=U（37 个，对应 0-36）
const CROCKFORD_CHECK_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ*~$=U';

/** 将字节数组按指定字符表编码为 Base32 字符串 */
function encodeWithAlphabet(bytes: Uint8Array, alphabet: string, padding: boolean): string {
  if (bytes.length === 0) return '';
  let output = '';
  let buffer = 0; // 累积位
  let bits = 0;   // 当前累积位数
  for (let i = 0; i < bytes.length; i++) {
    buffer = (buffer << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      // 取高 5 位
      output += alphabet[(buffer >> bits) & 0x1f];
    }
  }
  // 处理剩余不足 5 位的尾部
  if (bits > 0) {
    output += alphabet[(buffer << (5 - bits)) & 0x1f];
  }
  // RFC 4648 标准要求填充 = 至 8 的倍数
  if (padding && alphabet === RFC4648_ALPHABET) {
    while (output.length % 8 !== 0) output += '=';
  }
  return output;
}

/** Crockford 解码表：将易混字符归一化（I/L→1, O→0），大小写不敏感 */
function buildCrockfordDecodeTable(): Record<string, number> {
  const table: Record<string, number> = {};
  for (let i = 0; i < CROCKFORD_ALPHABET.length; i++) {
    const ch = CROCKFORD_ALPHABET[i];
    table[ch.toLowerCase()] = i;
    table[ch.toUpperCase()] = i;
  }
  // 易混字符归一化
  table['i'] = 1; table['I'] = 1; table['l'] = 1; table['L'] = 1;
  table['o'] = 0; table['O'] = 0;
  return table;
}
const CROCKFORD_DECODE_TABLE = buildCrockfordDecodeTable();

/** 将 Base32 字符串按指定变体解码为字节数组 */
function decodeWithVariant(input: string, variant: Variant): Result {
  const trimmed = input.trim();
  if (trimmed === '') return { ok: true, value: '', error: '' };
  // 提取校验字符（Crockford 模式下最后一个字符可能是校验位，由调用方处理）
  let str = trimmed.replace(/=+$/, '').replace(/\s+/g, '');
  // Crockford 模式归一化大小写
  if (variant === 'crockford') str = str.toUpperCase();

  let table: Record<string, number>;
  if (variant === 'rfc4648') {
    table = {};
    for (let i = 0; i < RFC4648_ALPHABET.length; i++) {
      const ch = RFC4648_ALPHABET[i];
      table[ch.toLowerCase()] = i;
      table[ch.toUpperCase()] = i;
    }
  } else {
    table = CROCKFORD_DECODE_TABLE;
  }

  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const val = table[ch];
    if (val === undefined) {
      return { ok: false, value: '', error: `非法字符 "${ch}"（位置 ${i + 1}）` };
    }
    buffer = (buffer << 5) | val;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  const arr = new Uint8Array(bytes);
  const text = new TextDecoder().decode(arr);
  return { ok: true, value: text, error: '' };
}

/** 计算 Crockford 校验和字符（基于字节数组 value mod 37） */
function crockfordChecksumChar(bytes: Uint8Array): string {
  // Crockford 规范：将字节序列视为大整数 mod 37
  // 用大数取模算法避免精度问题
  let mod = 0;
  for (let i = 0; i < bytes.length; i++) {
    mod = (mod * 256 + bytes[i]) % 37;
  }
  return CROCKFORD_CHECK_ALPHABET[mod];
}

/** 编码入口：根据变体与校验和选项生成结果 */
function encodeBase32(text: string, variant: Variant, withChecksum: boolean): Result {
  if (text === '') return { ok: true, value: '', error: '' };
  try {
    const bytes = new TextEncoder().encode(text);
    const alphabet = variant === 'rfc4648' ? RFC4648_ALPHABET : CROCKFORD_ALPHABET;
    // Crockford 规范不使用 = 填充
    const padding = variant === 'rfc4648';
    let output = encodeWithAlphabet(bytes, alphabet, padding);
    if (variant === 'crockford' && withChecksum) {
      output += crockfordChecksumChar(bytes);
    }
    return { ok: true, value: output, error: '' };
  } catch (e) {
    return { ok: false, value: '', error: `编码失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 解码入口：根据变体与校验和选项验证并解码 */
function decodeBase32(input: string, variant: Variant, verifyChecksum: boolean): Result {
  if (input.trim() === '') return { ok: true, value: '', error: '' };
  let work = input.trim().replace(/\s+/g, '');
  let checkInfo = '';
  if (variant === 'crockford' && verifyChecksum && work.length > 1) {
    // 取最后 1 个字符作为校验位
    const checkChar = work[work.length - 1].toUpperCase();
    const dataPart = work.slice(0, -1);
    const decoded = decodeWithVariant(dataPart, 'crockford');
    if (!decoded.ok) return decoded;
    // 重新计算校验和比对
    const bytes = new TextEncoder().encode(decoded.value);
    const expected = crockfordChecksumChar(bytes);
    if (expected.toUpperCase() !== checkChar) {
      return {
        ok: false,
        value: '',
        error: `Crockford 校验和不匹配：期望 "${expected}"，实际 "${checkChar}"（数据可能被误输入）`,
      };
    }
    checkInfo = `✓ 校验和通过（${checkChar}）`;
    return { ok: true, value: decoded.value, error: checkInfo };
  }
  if (variant === 'crockford') work = work.toUpperCase();
  const result = decodeWithVariant(work, variant);
  if (result.ok && result.value === '' && input.trim() !== '') {
    return { ok: false, value: '', error: '解码结果为空，输入可能包含非法字符' };
  }
  return result;
}

function computeStats(text: string) {
  const chars = text.length;
  const lines = chars === 0 ? 0 : text.split('\n').length;
  return { chars, lines };
}

const SAMPLE = '工具盒子 · Base32 编解码\n支持中文与 Emoji 🎉';

export default function Base32Tool() {
  const [mode, setMode] = useState<Mode>('encode');
  const [input, setInput] = useState<string>('');
  const [output, setOutput] = useState<string>('');
  const [variant, setVariant] = useState<Variant>('rfc4648');
  const [useChecksum, setUseChecksum] = useState<boolean>(false);
  const [live, setLive] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [notice, setNotice] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const inputStats = useMemo(() => computeStats(input), [input]);
  const outputStats = useMemo(() => computeStats(output), [output]);

  /** 执行一次转换 */
  const runTransform = useCallback((text: string, m: Mode, v: Variant, ck: boolean) => {
    const result = m === 'encode' ? encodeBase32(text, v, ck) : decodeBase32(text, v, ck);
    setOutput(result.value);
    // Crockford 校验通过时返回的 info 放入 notice
    if (result.ok && result.error.startsWith('✓')) {
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
    runTransform(input, mode, variant, useChecksum);
  }, [live, input, mode, variant, useChecksum, runTransform]);

  const handleRun = useCallback(() => {
    runTransform(input, mode, variant, useChecksum);
  }, [input, mode, variant, useChecksum, runTransform]);

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

  /** 切换变体时清空输出（字符集不同，旧结果无效） */
  const onVariantChange = useCallback((v: Variant) => {
    setVariant(v);
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
  const inputLabel = mode === 'encode' ? '原始文本' : 'Base32 字符串';
  const outputLabel = mode === 'encode' ? 'Base32 结果' : '解码文本';
  const inputPlaceholder = mode === 'encode'
    ? '在此输入要编码的文本，支持中文与 Emoji'
    : '在此粘贴要解码的 Base32 字符串';
  const outputPlaceholder = '处理结果将显示在这里';
  const checksumLabel = mode === 'encode' ? '附加校验和' : '校验校验和';

  return (
    <div className="jsontool b32tool">
      {/* 工具栏 */}
      <div className="jsontool__toolbar" role="toolbar" aria-label="Base32 操作">
        <div className="jsontool__actions">
          <div className="b32tool__seg" role="group" aria-label="操作方向">
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
          {/* 变体切换：segmented control */}
          <div className="b32tool__seg" role="group" aria-label="编码变体">
            <button
              className={`btn btn--sm${variant === 'rfc4648' ? ' btn--primary' : ''}`}
              aria-pressed={variant === 'rfc4648'}
              onClick={() => onVariantChange('rfc4648')}
            >
              RFC 4648
            </button>
            <button
              className={`btn btn--sm${variant === 'crockford' ? ' btn--primary' : ''}`}
              aria-pressed={variant === 'crockford'}
              onClick={() => onVariantChange('crockford')}
            >
              Crockford
            </button>
          </div>
          {/* Crockford 校验和开关：仅 Crockford 变体可用 */}
          <label className={`b32tool__toggle${variant !== 'crockford' ? ' b32tool__toggle--disabled' : ''}`}>
            <input
              type="checkbox"
              checked={useChecksum && variant === 'crockford'}
              disabled={variant !== 'crockford'}
              onChange={(e) => setUseChecksum(e.target.checked)}
            />
            <span>{checksumLabel}</span>
          </label>
          <label className="b32tool__toggle">
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
          <label htmlFor="b32-input" className="jsontool__label">
            {inputLabel}
            <span className="jsontool__stat">{inputStats.chars} 字 · {inputStats.lines} 行</span>
          </label>
          <textarea
            id="b32-input"
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
