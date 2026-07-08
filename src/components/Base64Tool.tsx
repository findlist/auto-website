import { useState, useMemo, useCallback, useEffect } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * Base64 编解码工具
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 编码：文本 → Base64（支持 UTF-8 中文，浏览器原生 btoa 不支持多字节，需借助 TextEncoder）
 *  - 解码：Base64 → 文本（自动识别 URL 安全变体）
 *  - 实时模式：边输入边转换
 *  - URL 安全变体：+ → -，/ → _，去掉填充 =
 *  - 复制 / 清空 / 示例
 */

type Mode = 'encode' | 'decode';

interface Result {
  ok: boolean;
  value: string;
  error: string;
}

/** 将 UTF-8 字符串编码为 Base64 */
function encodeBase64(text: string, urlSafe: boolean): Result {
  if (text === '') return { ok: true, value: '', error: '' };
  try {
    const bytes = new TextEncoder().encode(text);
    // 将字节数组转为二进制字符串后调用 btoa
    let binary = '';
    const chunkSize = 0x8000; // 避免超长字符串触发调用栈限制
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)) as number[]);
    }
    let base64 = btoa(binary);
    if (urlSafe) {
      // URL 安全变体：+ → -，/ → _，去掉末尾的 =
      base64 = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    return { ok: true, value: base64, error: '' };
  } catch (e) {
    return { ok: false, value: '', error: `编码失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 解码 Base64 字符串为 UTF-8 文本，兼容 URL 安全变体与缺省填充 */
function decodeBase64(input: string, urlSafe: boolean): Result {
  if (input.trim() === '') return { ok: true, value: '', error: '' };
  try {
    let normalized = input.trim();
    if (urlSafe) {
      // 还原为标准 Base64
      normalized = normalized.replace(/-/g, '+').replace(/_/g, '/');
    }
    // 补齐缺失的填充 =（4 的倍数）
    const pad = normalized.length % 4;
    if (pad === 2) normalized += '==';
    else if (pad === 3) normalized += '=';
    else if (pad === 1) {
      // 长度对 4 取模为 1 是非法 Base64
      return { ok: false, value: '', error: 'Base64 长度非法（对 4 取模为 1）' };
    }
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const text = new TextDecoder().decode(bytes);
    return { ok: true, value: text, error: '' };
  } catch (e) {
    return { ok: false, value: '', error: `解码失败：输入可能不是合法 Base64（${e instanceof Error ? e.message : String(e)}）` };
  }
}

/** 统计字符数与行数 */
function computeStats(text: string) {
  const chars = text.length;
  const lines = chars === 0 ? 0 : text.split('\n').length;
  return { chars, lines };
}

const SAMPLE = '工具盒子 · Base64 编解码\n支持中文、Emoji 🎉 与特殊字符 <>&"\'';

export default function Base64Tool() {
  const [mode, setMode] = useState<Mode>('encode');
  const [input, setInput] = useState<string>('');
  const [output, setOutput] = useState<string>('');
  const [urlSafe, setUrlSafe] = useState<boolean>(false);
  const [live, setLive] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [notice, setNotice] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const inputStats = useMemo(() => computeStats(input), [input]);
  const outputStats = useMemo(() => computeStats(output), [output]);

  /** 执行一次转换 */
  const runTransform = useCallback((text: string, m: Mode, safe: boolean) => {
    const result = m === 'encode' ? encodeBase64(text, safe) : decodeBase64(text, safe);
    setOutput(result.value);
    setError(result.ok ? '' : result.error);
    setNotice('');
  }, []);

  /** 实时模式：输入或参数变化时自动转换 */
  useEffect(() => {
    if (!live) return;
    runTransform(input, mode, urlSafe);
  }, [live, input, mode, urlSafe, runTransform]);

  /** 手动触发（关闭实时模式时使用） */
  const handleRun = useCallback(() => {
    runTransform(input, mode, urlSafe);
  }, [input, mode, urlSafe, runTransform]);

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

  /** 清空 */
  const handleClear = useCallback(() => {
    setInput('');
    setOutput('');
    setError('');
    setNotice('');
    setCopied(false);
  }, []);

  /** 载入示例 */
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

  /** 输入框变化时同步清空错误 */
  const onInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (error) setError('');
    if (notice) setNotice('');
  }, [error, notice]);

  // 标签与占位符随模式切换
  const inputLabel = mode === 'encode' ? '原始文本' : 'Base64 字符串';
  const outputLabel = mode === 'encode' ? 'Base64 结果' : '解码文本';
  const inputPlaceholder = mode === 'encode'
    ? '在此输入要编码的文本，支持中文与 Emoji'
    : '在此粘贴要解码的 Base64 字符串';
  const outputPlaceholder = '处理结果将显示在这里';

  return (
    <div className="jsontool b64tool">
      {/* 工具栏 */}
      <div className="jsontool__toolbar" role="toolbar" aria-label="Base64 操作">
        <div className="jsontool__actions">
          {/* 模式切换：使用 role=group + 单选按钮语义 */}
          <div className="b64tool__seg" role="group" aria-label="操作方向">
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
          {/* URL 安全变体开关 */}
          <label className="b64tool__toggle">
            <input
              type="checkbox"
              checked={urlSafe}
              onChange={(e) => setUrlSafe(e.target.checked)}
            />
            <span>URL 安全</span>
          </label>
          {/* 实时模式开关 */}
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
          <label htmlFor="b64-input" className="jsontool__label">
            {inputLabel}
            <span className="jsontool__stat">{inputStats.chars} 字 · {inputStats.lines} 行</span>
          </label>
          <textarea
            id="b64-input"
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
