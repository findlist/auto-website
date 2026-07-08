import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * Hash 计算工具
 * 全部在浏览器本地处理，使用原生 SubtleCrypto API（crypto.subtle.digest）。
 *
 * 功能：
 *  - 文本模式：SHA-1 / SHA-256 / SHA-384 / SHA-512，HEX / Base64 输出，实时计算
 *  - 文件模式：拖拽 / 选择文件，多算法同时计算，流式读取 + 进度反馈
 *  - 复制 / 清空
 *
 * 说明：MD5 与 SHA-1 已不推荐用于安全场景，本工具保留 SHA-1 仅为兼容性参考，
 *       不提供 MD5（SubtleCrypto 原生不支持，且需引入第三方库增加 bundle 体积）。
 */

type Algo = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';
type OutputFormat = 'hex' | 'base64';
type Mode = 'text' | 'file';

interface HashResult {
  ok: boolean;
  hex: string;
  base64: string;
  error: string;
}

interface FileHashItem {
  algo: Algo;
  hex: string;
  base64: string;
}

/** 字节数组转十六进制字符串（小写），分块拼接避免调用栈限制 */
function bytesToHex(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let hex = '';
  const chunkSize = 0x4000;
  for (let i = 0; i < arr.length; i += chunkSize) {
    hex += Array.from(arr.subarray(i, i + chunkSize), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return hex;
}

/** 字节数组转 base64，分块拼接避免 fromCharCode.apply 栈限制 */
function bytesToBase64(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < arr.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(arr.subarray(i, i + chunkSize)) as number[]);
  }
  return btoa(binary);
}

/** 计算文本的哈希值 */
async function computeHash(text: string, algo: Algo): Promise<HashResult> {
  if (text === '') return { ok: true, hex: '', base64: '', error: '' };
  try {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest(algo, data);
    return { ok: true, hex: bytesToHex(digest), base64: bytesToBase64(digest), error: '' };
  } catch (e) {
    return { ok: false, hex: '', base64: '', error: `计算失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 流式读取文件为 ArrayBuffer，并报告读取进度（0-1，仅读取阶段） */
async function readFileWithProgress(file: File, onProgress: (p: number) => void): Promise<ArrayBuffer> {
  const reader = file.stream().getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  const total = file.size;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      // 读取阶段占 50% 进度
      onProgress(total > 0 ? (received / total) * 0.5 : 0.5);
    }
  }
  // 合并所有 chunks 到一个连续的 Uint8Array
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return merged.buffer;
}

/** 计算文件多算法哈希（流式读取 + 多算法并行 digest） */
async function computeFileHash(
  file: File,
  algos: Algo[],
  onProgress: (p: number) => void,
): Promise<FileHashItem[]> {
  const buffer = await readFileWithProgress(file, onProgress);
  onProgress(0.6);
  // 对每个算法并行 digest
  const results = await Promise.all(
    algos.map(async (algo) => {
      const digest = await crypto.subtle.digest(algo, buffer);
      return { algo, hex: bytesToHex(digest), base64: bytesToBase64(digest) } as FileHashItem;
    }),
  );
  onProgress(1);
  return results;
}

/** 文件大小格式化（B/KB/MB/GB） */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}


const ALGO_OPTIONS: { value: Algo; label: string; bitLength: number }[] = [
  { value: 'SHA-1', label: 'SHA-1', bitLength: 160 },
  { value: 'SHA-256', label: 'SHA-256', bitLength: 256 },
  { value: 'SHA-384', label: 'SHA-384', bitLength: 384 },
  { value: 'SHA-512', label: 'SHA-512', bitLength: 512 },
];

/** 文件大小上限：100MB，超过此值提示用户（避免浏览器内存爆炸） */
const FILE_SIZE_LIMIT = 100 * 1024 * 1024;

const SAMPLE = '工具盒子 · Hash 计算\n支持中文与 Emoji 🎉';

export default function HashTool() {
  // 顶部 Tab：文本 / 文件
  const [mode, setMode] = useState<Mode>('text');

  // ===== 文本模式状态 =====
  const [input, setInput] = useState<string>('');
  const [textAlgo, setTextAlgo] = useState<Algo>('SHA-256');
  const [format, setFormat] = useState<OutputFormat>('hex');
  const [live, setLive] = useState<boolean>(true);
  const [result, setResult] = useState<HashResult>({ ok: true, hex: '', base64: '', error: '' });
  const [notice, setNotice] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const debounceTimer = useRef<number | undefined>(undefined);

  // ===== 文件模式状态 =====
  const [file, setFile] = useState<File | null>(null);
  // 文件模式下选中的算法（多选，默认 SHA-256）
  const [fileAlgos, setFileAlgos] = useState<Set<Algo>>(new Set<Algo>(['SHA-256']));
  const [fileFormat, setFileFormat] = useState<OutputFormat>('hex');
  const [fileResults, setFileResults] = useState<FileHashItem[]>([]);
  const [computing, setComputing] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [fileError, setFileError] = useState<string>('');
  const [fileNotice, setFileNotice] = useState<string>('');
  const [dragOver, setDragOver] = useState<boolean>(false);
  // 复制状态：以 algo 为 key 标记已复制
  const [copiedAlgo, setCopiedAlgo] = useState<Algo | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const inputStats = useMemo(() => {
    const chars = input.length;
    const bytes = new TextEncoder().encode(input).length;
    return { chars, bytes };
  }, [input]);

  /** 文本模式：执行哈希计算 */
  const runHash = useCallback(async (text: string, a: Algo) => {
    const r = await computeHash(text, a);
    setResult(r);
  }, []);

  /** 文本模式：实时去抖计算 */
  useEffect(() => {
    if (mode !== 'text') return;
    if (!live) return;
    if (debounceTimer.current) window.clearTimeout(debounceTimer.current);
    debounceTimer.current = window.setTimeout(() => {
      runHash(input, textAlgo);
    }, 300);
    return () => {
      if (debounceTimer.current) window.clearTimeout(debounceTimer.current);
    };
  }, [mode, live, input, textAlgo, runHash]);

  /** 文本模式：手动触发（关闭实时模式时使用） */
  const handleRun = useCallback(() => {
    runHash(input, textAlgo);
  }, [input, textAlgo, runHash]);

  /** 文本模式：复制结果 */
  const handleCopy = useCallback(async () => {
    const text = format === 'hex' ? result.hex : result.base64;
    if (!text) return;
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      setNotice('已复制到剪贴板');
      setTimeout(() => setCopied(false), 1500);
    } else {
      setNotice('复制失败，请手动选中复制');
    }
  }, [result, format]);

  /** 文本模式：清空 */
  const handleClear = useCallback(() => {
    setInput('');
    setResult({ ok: true, hex: '', base64: '', error: '' });
    setNotice('');
    setCopied(false);
  }, []);

  /** 文本模式：载入示例 */
  const handleSample = useCallback(() => {
    setInput(SAMPLE);
    setNotice('');
  }, []);

  /** 文本模式：切换算法时清空结果 */
  const onAlgoChange = useCallback((a: Algo) => {
    setTextAlgo(a);
    setResult({ ok: true, hex: '', base64: '', error: '' });
    setNotice('');
  }, []);

  // ===== 文件模式方法 =====

  /** 文件模式：选择文件 */
  const handleFileSelect = useCallback((f: File | null) => {
    if (!f) return;
    if (f.size > FILE_SIZE_LIMIT) {
      setFileError(`文件过大（${formatSize(f.size)}），请选择小于 ${formatSize(FILE_SIZE_LIMIT)} 的文件`);
      setFile(null);
      setFileResults([]);
      return;
    }
    setFileError('');
    setFile(f);
    setFileResults([]);
    setFileNotice('');
    setProgress(0);
  }, []);

  /** 文件模式：拖拽相关 */
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFileSelect(f);
  }, [handleFileSelect]);

  /** 文件模式：input change */
  const onFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    handleFileSelect(f);
    // 重置 input value 允许重复选择同一文件
    e.target.value = '';
  }, [handleFileSelect]);

  /** 文件模式：切换算法选中状态 */
  const toggleFileAlgo = useCallback((a: Algo) => {
    setFileAlgos((prev) => {
      const next = new Set(prev);
      if (next.has(a)) {
        // 至少保留一个算法
        if (next.size > 1) next.delete(a);
      } else {
        next.add(a);
      }
      return next;
    });
    // 算法变化后清空旧结果，避免误用
    setFileResults([]);
  }, []);

  /** 文件模式：执行计算 */
  const handleComputeFile = useCallback(async () => {
    if (!file) return;
    if (fileAlgos.size === 0) {
      setFileError('请至少选择一个算法');
      return;
    }
    setComputing(true);
    setProgress(0);
    setFileError('');
    setFileNotice('');
    setFileResults([]);
    try {
      const algos = Array.from(fileAlgos);
      const items = await computeFileHash(file, algos, (p) => setProgress(p));
      setFileResults(items);
      setFileNotice(`✅ 已完成 ${items.length} 个算法的哈希计算`);
    } catch (e) {
      setFileError(`计算失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setComputing(false);
    }
  }, [file, fileAlgos]);

  /** 文件模式：清除文件 */
  const handleFileClear = useCallback(() => {
    setFile(null);
    setFileResults([]);
    setFileError('');
    setFileNotice('');
    setProgress(0);
    setCopiedAlgo(null);
  }, []);

  /** 文件模式：复制单个算法结果 */
  const handleCopyFileResult = useCallback(async (item: FileHashItem) => {
    const text = fileFormat === 'hex' ? item.hex : item.base64;
    const ok = await copyText(text);
    if (ok) {
      setCopiedAlgo(item.algo);
      setFileNotice(`已复制 ${item.algo} 哈希值`);
      setTimeout(() => {
        setCopiedAlgo(null);
        setFileNotice((n) => (n.startsWith('已复制') ? '' : n));
      }, 1500);
    } else {
      setFileNotice('复制失败，请手动选中复制');
    }
  }, [fileFormat]);

  /** 切换模式时清空跨模式状态 */
  const onSwitchMode = useCallback((m: Mode) => {
    setMode(m);
    setNotice('');
    setFileNotice('');
  }, []);

  // ===== 文本模式渲染 =====
  const currentAlgo = ALGO_OPTIONS.find((a) => a.value === textAlgo)!;
  const textOutput = format === 'hex' ? result.hex : result.base64;

  const textModeUI = (
    <>
      {/* 工具栏 */}
      <div className="jsontool__toolbar" role="toolbar" aria-label="Hash 计算">
        <div className="jsontool__actions">
          {!live && (
            <button className="btn btn--primary btn--sm" onClick={handleRun}>计算</button>
          )}
        </div>
        <div className="jsontool__options">
          {/* 算法选择 */}
          <label className="hashtool__field">
            <span>算法</span>
            <select
              className="hashtool__select"
              value={textAlgo}
              onChange={(e) => onAlgoChange(e.target.value as Algo)}
              aria-label="哈希算法"
            >
              {ALGO_OPTIONS.map((a) => (
                <option key={a.value} value={a.value}>{a.label}（{a.bitLength} bit）</option>
              ))}
            </select>
          </label>
          {/* 输出格式切换 */}
          <div className="hashtool__seg" role="group" aria-label="输出格式">
            <button
              className={`btn btn--sm${format === 'hex' ? ' btn--primary' : ''}`}
              aria-pressed={format === 'hex'}
              onClick={() => setFormat('hex')}
            >HEX</button>
            <button
              className={`btn btn--sm${format === 'base64' ? ' btn--primary' : ''}`}
              aria-pressed={format === 'base64'}
              onClick={() => setFormat('base64')}
            >Base64</button>
          </div>
          {/* 实时模式开关 */}
          <label className="hashtool__toggle">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
            <span>实时计算</span>
          </label>
          <button className="btn btn--sm" onClick={handleSample}>示例</button>
          <button className="btn btn--sm" onClick={handleClear}>清空</button>
        </div>
      </div>

      {/* 编辑区 */}
      <div className="jsontool__panels">
        <div className="jsontool__panel">
          <label htmlFor="hash-input" className="jsontool__label">
            原始文本
            <span className="jsontool__stat">{inputStats.chars} 字 · {inputStats.bytes} 字节</span>
          </label>
          <textarea
            id="hash-input"
            className="jsontool__textarea"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (notice) setNotice('');
            }}
            placeholder="在此输入要计算哈希的文本，支持中文与 Emoji"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            aria-label="原始文本"
          />
        </div>
        <div className="jsontool__panel">
          <div className="jsontool__label">
            <span>{textAlgo} 摘要（{currentAlgo.bitLength} bit）</span>
            <button
              className="btn btn--sm jsontool__copy"
              onClick={handleCopy}
              disabled={!textOutput}
              aria-label="复制哈希结果"
            >
              {copied ? '已复制' : '复制'}
            </button>
          </div>
          <textarea
            className="jsontool__textarea jsontool__textarea--output hashtool__output"
            value={textOutput}
            readOnly
            placeholder="哈希结果将显示在这里"
            spellCheck={false}
            aria-label={`${textAlgo} 哈希结果`}
          />
        </div>
      </div>

      {/* 状态条 */}
      <div className="jsontool__status" role="status" aria-live="polite">
        {result.error ? (
          <div className="jsontool__error">
            <strong>❌ 错误</strong>
            <span>{result.error}</span>
          </div>
        ) : notice ? (
          <div className="jsontool__notice">{notice}</div>
        ) : (
          <div className="jsontool__hint">
            使用浏览器原生 SubtleCrypto API 计算，所有数据在浏览器本地处理，不会上传。
          </div>
        )}
      </div>
    </>
  );

  // ===== 文件模式渲染 =====
  const fileModeUI = (
    <>
      {/* 工具栏：算法多选 + 格式切换 + 清除 */}
      <div className="jsontool__toolbar" role="toolbar" aria-label="文件 Hash 计算">
        <div className="jsontool__actions">
          <button
            className="btn btn--primary btn--sm"
            onClick={handleComputeFile}
            disabled={!file || computing || fileAlgos.size === 0}
          >
            {computing ? '计算中…' : '计算哈希'}
          </button>
          {file && (
            <button className="btn btn--sm" onClick={handleFileClear} disabled={computing}>清除文件</button>
          )}
        </div>
        <div className="jsontool__options">
          {/* 算法多选 */}
          <fieldset className="hashtool__fieldset" aria-label="哈希算法（可多选）">
            <legend className="hashtool__legend">算法</legend>
            {ALGO_OPTIONS.map((a) => (
              <label key={a.value} className="hashtool__checkbox">
                <input
                  type="checkbox"
                  checked={fileAlgos.has(a.value)}
                  onChange={() => toggleFileAlgo(a.value)}
                  disabled={computing}
                />
                <span>{a.label}</span>
              </label>
            ))}
          </fieldset>
          {/* 输出格式切换 */}
          <div className="hashtool__seg" role="group" aria-label="输出格式">
            <button
              className={`btn btn--sm${fileFormat === 'hex' ? ' btn--primary' : ''}`}
              aria-pressed={fileFormat === 'hex'}
              onClick={() => setFileFormat('hex')}
            >HEX</button>
            <button
              className={`btn btn--sm${fileFormat === 'base64' ? ' btn--primary' : ''}`}
              aria-pressed={fileFormat === 'base64'}
              onClick={() => setFileFormat('base64')}
            >Base64</button>
          </div>
        </div>
      </div>

      {/* 文件区 */}
      <div className="hashtool__file-area">
        {/* 拖拽区 / 文件信息 */}
        {!file ? (
          <div
            className={`hashtool__dropzone${dragOver ? ' is-dragover' : ''}`}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            aria-label="点击或拖拽文件到此处选择文件"
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
          >
            <div className="hashtool__dropzone-icon" aria-hidden="true">📁</div>
            <div className="hashtool__dropzone-text">
              <strong>点击选择文件</strong> 或拖拽到此区域
            </div>
            <div className="hashtool__dropzone-hint">
              文件不会上传，全部在浏览器本地计算 · 上限 {formatSize(FILE_SIZE_LIMIT)}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hashtool__file-input"
              onChange={onFileInputChange}
              aria-label="选择文件"
            />
          </div>
        ) : (
          <div className="hashtool__file-info">
            <div className="hashtool__file-meta" aria-live="polite">
              <div className="hashtool__file-row">
                <span className="hashtool__file-label">文件名</span>
                <span className="hashtool__file-value" title={file.name}>{file.name}</span>
              </div>
              <div className="hashtool__file-row">
                <span className="hashtool__file-label">大小</span>
                <span className="hashtool__file-value">{formatSize(file.size)}</span>
              </div>
              <div className="hashtool__file-row">
                <span className="hashtool__file-label">类型</span>
                <span className="hashtool__file-value">{file.type || '未知'}</span>
              </div>
              <div className="hashtool__file-row">
                <span className="hashtool__file-label">修改时间</span>
                <span className="hashtool__file-value">
                  {new Date(file.lastModified).toLocaleString('zh-CN')}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* 进度条 */}
        {computing && (
          <div className="hashtool__progress-wrap" aria-live="polite">
            <div className="hashtool__progress-bar">
              <div
                className="hashtool__progress-fill"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <div className="hashtool__progress-text">
              {progress < 0.5 ? '读取文件中…' : progress < 0.6 ? '正在计算哈希…' : '即将完成…'} {Math.round(progress * 100)}%
            </div>
          </div>
        )}

        {/* 错误提示 */}
        {fileError && (
          <div className="jsontool__error hashtool__file-error" role="alert">
            <strong>❌ 错误</strong>
            <span>{fileError}</span>
          </div>
        )}

        {/* 结果列表 */}
        {fileResults.length > 0 && (
          <div className="hashtool__results" aria-live="polite">
            <h3 className="hashtool__results-title">哈希结果</h3>
            <ul className="hashtool__result-list">
              {fileResults.map((item) => {
                const text = fileFormat === 'hex' ? item.hex : item.base64;
                const algoMeta = ALGO_OPTIONS.find((a) => a.value === item.algo)!;
                return (
                  <li key={item.algo} className="hashtool__result-item">
                    <div className="hashtool__result-head">
                      <span className="hashtool__result-algo">
                        {item.algo} <em>({algoMeta.bitLength} bit)</em>
                      </span>
                      <button
                        className="btn btn--sm"
                        onClick={() => handleCopyFileResult(item)}
                        aria-label={`复制 ${item.algo} 哈希值`}
                      >
                        {copiedAlgo === item.algo ? '已复制' : '复制'}
                      </button>
                    </div>
                    <code className="hashtool__result-value">{text}</code>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* 提示信息 */}
        {fileNotice && !fileError && (
          <div className="jsontool__notice hashtool__file-notice" role="status">{fileNotice}</div>
        )}
      </div>

      {/* 状态条 */}
      <div className="jsontool__status" role="status" aria-live="polite">
        <div className="jsontool__hint">
          文件通过 File API 流式读取，使用浏览器原生 SubtleCrypto API 计算，全程在本地完成。
        </div>
      </div>
    </>
  );

  return (
    <div className="jsontool hashtool">
      {/* 顶部模式切换 Tab */}
      <div className="hashtool__mode-tabs" role="tablist" aria-label="Hash 计算模式">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'text'}
          className={`hashtool__mode-tab${mode === 'text' ? ' is-active' : ''}`}
          onClick={() => onSwitchMode('text')}
        >文本哈希</button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'file'}
          className={`hashtool__mode-tab${mode === 'file' ? ' is-active' : ''}`}
          onClick={() => onSwitchMode('file')}
        >文件哈希</button>
      </div>

      {mode === 'text' ? textModeUI : fileModeUI}
    </div>
  );
}
