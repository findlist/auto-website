import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';
import { encodeDomain, decodeDomain, type DomainResult } from '../utils/punycode';

/**
 * Punycode 编解码工具
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 编码：完整国际化域名 IDN → ACE（xn-- 前缀）
 *  - 解码：ACE 域名（xn-- 前缀）→ Unicode 域名
 *  - 标签级详情：展示每个标签的转换结果与类型
 *  - 实时模式、复制、清空、示例
 *
 * 适用场景：
 *  - 中文域名注册与查询（如 例子.公司 → xn--fsqu00a.xn--55qx5d）
 *  - 邮件域名国际化解析
 *  - URL 中 host 部分的 IDN 转换
 *  - 调试 IDN 解析、DNS 配置
 */

type Mode = 'encode' | 'decode';

function computeStats(text: string) {
  const chars = text.length;
  const lines = chars === 0 ? 0 : text.split('\n').length;
  return { chars, lines };
}

// 示例覆盖中英文与多标签场景（已用 Node.js punycode 模块验证互为编解码对）
// 例子 → fsqu00a, 工具盒子 → h6qx3vv4bk65b, com 为 ASCII 标签保留原样
const SAMPLE_ENCODE = '例子.工具盒子.com';
const SAMPLE_DECODE = 'xn--fsqu00a.xn--h6qx3vv4bk65b.com';

export default function PunycodeTool() {
  const [mode, setMode] = useState<Mode>('encode');
  const [input, setInput] = useState<string>('');
  const [notice, setNotice] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // 域名转换结果实时计算（Punycode 算法对单行输入近乎瞬时，无需手动触发）
  const result: DomainResult = useMemo(() => {
    if (input.trim() === '') return { ok: true, value: '', error: '' };
    return mode === 'encode' ? encodeDomain(input) : decodeDomain(input);
  }, [input, mode]);

  const output = result.value;
  const inputStats = useMemo(() => computeStats(input), [input]);
  const outputStats = useMemo(() => computeStats(output), [output]);
  const error = !result.ok ? result.error : '';
  const labels = result.labels || [];

  const handleCopy = useCallback(async () => {
    if (!output) return;
    const ok = await copyText(output);
    setCopied(ok);
    setNotice(ok ? '已复制到剪贴板' : '复制失败，请手动选中复制');
    if (ok) setTimeout(() => setCopied(false), 1500);
  }, [output]);

  const handleClear = useCallback(() => {
    setInput('');
    setNotice('');
    setCopied(false);
  }, []);

  const handleSample = useCallback(() => {
    setInput(mode === 'encode' ? SAMPLE_ENCODE : SAMPLE_DECODE);
    setNotice('');
    setCopied(false);
  }, [mode]);

  const onModeChange = useCallback((m: Mode) => {
    setMode(m);
    setNotice('');
    setCopied(false);
  }, []);

  const onInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
    if (notice) setNotice('');
  }, [notice]);

  const inputLabel = mode === 'encode' ? '国际化域名（Unicode）' : 'ACE 域名（xn-- 前缀）';
  const outputLabel = mode === 'encode' ? 'Punycode 结果（ACE）' : 'Unicode 域名';
  const inputPlaceholder = mode === 'encode'
    ? '如：例子.com 或 中文.公司.cn'
    : '如：xn--fsqu00a.com 或 xn--fsqu00a.xn--55qx5d';
  const outputPlaceholder = '转换结果将显示在这里';

  return (
    <div className="jsontool punytool">
      {/* 工具栏 */}
      <div className="jsontool__toolbar" role="toolbar" aria-label="Punycode 操作">
        <div className="jsontool__actions">
          <div className="punytool__seg" role="group" aria-label="操作方向">
            <button
              className={`btn btn--sm${mode === 'encode' ? ' btn--primary' : ''}`}
              aria-pressed={mode === 'encode'}
              onClick={() => onModeChange('encode')}
            >
              编码（IDN → ACE）
            </button>
            <button
              className={`btn btn--sm${mode === 'decode' ? ' btn--primary' : ''}`}
              aria-pressed={mode === 'decode'}
              onClick={() => onModeChange('decode')}
            >
              解码（ACE → IDN）
            </button>
          </div>
        </div>
        <div className="jsontool__options">
          <button className="btn btn--sm" onClick={handleSample}>示例</button>
          <button className="btn btn--sm" onClick={handleClear}>清空</button>
        </div>
      </div>

      {/* 单行输入：域名通常不含换行，用 input 更轻量 */}
      <div className="punytool__field">
        <label htmlFor="puny-input" className="jsontool__label">
          {inputLabel}
          <span className="jsontool__stat">{inputStats.chars} 字</span>
        </label>
        <input
          id="puny-input"
          type="text"
          className="punytool__input"
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

      {/* 输出区 */}
      <div className="punytool__field">
        <div className="jsontool__label">
          <span>{outputLabel}</span>
          <span className="jsontool__stat">{outputStats.chars} 字</span>
          <button
            className="btn btn--sm jsontool__copy"
            onClick={handleCopy}
            disabled={!output}
            aria-label="复制输出"
          >
            {copied ? '已复制' : '复制'}
          </button>
        </div>
        <input
          type="text"
          className="punytool__input punytool__input--output"
          value={output}
          readOnly
          placeholder={outputPlaceholder}
          spellCheck={false}
          aria-label={outputLabel}
        />
      </div>

      {/* 标签级转换详情：展示每个标签的输入 → 输出与类型 */}
      {labels.length > 0 && result.ok && (
        <div className="punytool__labels" aria-live="polite">
          <h3 className="punytool__labels-title">
            标签级转换详情
            <span className="punytool__labels-count">（{labels.length} 个标签）</span>
          </h3>
          <ul className="punytool__labels-list">
            {labels.map((lbl, idx) => {
              const kindText = lbl.kind === 'ascii' ? 'ASCII（保留原样）'
                : lbl.kind === 'encoded' ? '已编码 → xn--'
                : '已解码 → Unicode';
              return (
                <li key={idx} className={`punytool__label-row punytool__label-row--${lbl.kind}`}>
                  <span className="punytool__label-index">{idx + 1}</span>
                  <span className="punytool__label-input" title={lbl.input}>{lbl.input}</span>
                  <span className="punytool__label-arrow" aria-hidden="true">→</span>
                  <span className="punytool__label-output" title={lbl.output}>{lbl.output}</span>
                  <span className="punytool__label-kind">{kindText}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

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
            所有数据仅在你浏览器内处理，不会上传到任何服务器。Punycode 算法实现遵循 RFC 3492。
          </div>
        )}
      </div>
    </div>
  );
}
