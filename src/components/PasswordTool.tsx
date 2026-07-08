import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * 密码生成器
 * 全部在浏览器本地处理，使用原生 crypto.getRandomValues（CSPRNG）。
 *
 * 功能：
 *  - 自定义字符集（小写 / 大写 / 数字 / 符号 / 排除易混字符）
 *  - 长度可调（4-128，默认 16）
 *  - 批量生成（1 / 5 / 10 / 50）
 *  - 实时模式：参数变化自动重新生成
 *  - 强度评估（基于香农熵 entropy = length * log2(charsetSize)）
 *  - 单条复制 / 复制全部
 */

type Count = 1 | 5 | 10 | 50;

interface PwdItem {
  // 用于 React key，避免使用密码本身作 key
  seq: number;
  text: string;
}

// 字符集常量：分离定义便于按需组合
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGIT = '0123456789';
// 符号集：取 OWASP 推荐的可打印 ASCII 符号，避开空格与引号便于粘贴
const SYMBOL = '!@#$%^&*()-_=+[]{};:,.?/';

// 易混字符集（视觉相近，人工抄写易错）：0 O o / 1 l I / | 等
const AMBIGUOUS = new Set('0Oo1lI|`\'"');

const COUNT_OPTIONS: Count[] = [1, 5, 10, 50];

// 长度范围常量
const LENGTH_MIN = 4;
const LENGTH_MAX = 128;
const LENGTH_DEFAULT = 16;

/** 按当前字符集配置构建候选字符集合 */
function buildCharset(opts: {
  lower: boolean;
  upper: boolean;
  digit: boolean;
  symbol: boolean;
  excludeAmbiguous: boolean;
}): string {
  let chars = '';
  if (opts.lower) chars += LOWER;
  if (opts.upper) chars += UPPER;
  if (opts.digit) chars += DIGIT;
  if (opts.symbol) chars += SYMBOL;
  if (opts.excludeAmbiguous) {
    chars = Array.from(chars)
      .filter((c) => !AMBIGUOUS.has(c))
      .join('');
  }
  return chars;
}

/**
 * 用 CSPRNG 从字符集随机取一个字符
 * 采用拒绝采样（rejection sampling）消除模偏差：
 * 拒绝 >= charsetSize 的整数倍区间的随机字节，保证均匀分布
 */
function pickChar(charset: string): string {
  const len = charset.length;
  if (len === 0) return '';
  // 最大字节数：使 (256 / len) 的整数倍区间尽可能接近 256
  // 即拒绝 [floor(256/len)*len, 256) 范围的字节
  const limit = Math.floor(256 / len) * len;
  const buf = new Uint8Array(1);
  // 循环到取到合法字节为止（最坏情况概率极低，平均 1 次）
  while (true) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) {
      return charset[buf[0] % len];
    }
  }
}

/** 生成单个密码 */
function generateOne(length: number, charset: string): string {
  if (charset.length === 0 || length <= 0) return '';
  let pwd = '';
  for (let i = 0; i < length; i++) {
    pwd += pickChar(charset);
  }
  return pwd;
}

/** 批量生成密码列表 */
function generateBatch(count: Count, length: number, charset: string): PwdItem[] {
  const items: PwdItem[] = [];
  for (let i = 0; i < count; i++) {
    items.push({ seq: i, text: generateOne(length, charset) });
  }
  return items;
}

/** 计算熵（bits）：entropy = length * log2(charsetSize) */
function calcEntropy(length: number, charsetSize: number): number {
  if (charsetSize <= 0 || length <= 0) return 0;
  return length * Math.log2(charsetSize);
}

// 强度等级定义：与熵区间对应，便于 UI 统一渲染
interface StrengthLevel {
  label: string;
  color: string;
  // 0-100 的相对进度（用于进度条宽度）
  percent: number;
}

/** 根据熵值映射强度等级（参考 NIST SP 800-63 与常见实践） */
function getStrengthLevel(entropy: number): StrengthLevel {
  if (entropy < 28) {
    // 极弱：可被秒级破解
    return { label: '极弱', color: '#e5484d', percent: 15 };
  }
  if (entropy < 36) {
    // 弱：分钟级破解
    return { label: '弱', color: '#f59e0b', percent: 30 };
  }
  if (entropy < 60) {
    // 一般：本地暴力需数小时-数天
    return { label: '一般', color: '#eab308', percent: 55 };
  }
  if (entropy < 100) {
    // 强：在线破解不可行，离线暴力需数年
    return { label: '强', color: '#22c55e', percent: 80 };
  }
  // 很强：离线暴力也不可行
  return { label: '很强', color: '#15803d', percent: 100 };
}

interface CharsetOpts {
  lower: boolean;
  upper: boolean;
  digit: boolean;
  symbol: boolean;
  excludeAmbiguous: boolean;
}

export default function PasswordTool() {
  const [length, setLength] = useState<number>(LENGTH_DEFAULT);
  const [count, setCount] = useState<Count>(1);
  const [opts, setOpts] = useState<CharsetOpts>({
    lower: true,
    upper: true,
    digit: true,
    symbol: true,
    excludeAmbiguous: false,
  });
  const [live, setLive] = useState<boolean>(true);
  // 初始为空数组：避免 SSR 与 CSR 随机数不一致导致的水合不匹配
  // 客户端挂载后由下方 useEffect 触发首次生成
  const [items, setItems] = useState<PwdItem[]>([]);
  const [notice, setNotice] = useState<string>('');
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedSeq, setCopiedSeq] = useState<number | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

  // 候选字符集（依赖 opts，参数变化时自动重算）
  const charset = useMemo(() => buildCharset(opts), [opts]);
  const charsetSize = charset.length;
  const entropy = useMemo(() => calcEntropy(length, charsetSize), [length, charsetSize]);
  const strength = useMemo(() => getStrengthLevel(entropy), [entropy]);

  // 字符集为空时给出错误提示
  const charsetEmpty = charsetSize === 0;

  /** 显示临时提示，1.5s 后清除 */
  const flashNotice = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 1500);
  }, []);

  /** 重新生成一批（保留当前参数） */
  const regenerate = useCallback(() => {
    if (charsetEmpty) {
      setItems([]);
      flashNotice('请至少选择一个字符集');
      return;
    }
    setItems(generateBatch(count, length, charset));
    setCopiedSeq(null);
  }, [count, length, charset, charsetEmpty, flashNotice]);

  /** 实时模式：参数变化时自动重新生成 */
  useEffect(() => {
    if (!live) return;
    if (charsetEmpty) {
      setItems([]);
      return;
    }
    setItems(generateBatch(count, length, charset));
    setCopiedSeq(null);
  }, [live, count, length, charset, charsetEmpty]);

  /** 复制全部密码（换行分隔） */
  const handleCopyAll = useCallback(async () => {
    if (items.length === 0) return;
    const text = items.map((it) => it.text).join('\n');
    const ok = await copyText(text);
    if (ok) {
      setCopiedAll(true);
      flashNotice(`已复制 ${items.length} 条密码`);
      setTimeout(() => setCopiedAll(false), 1500);
    } else {
      flashNotice('复制失败，请手动选中复制');
    }
  }, [items, flashNotice]);

  /** 复制单条密码 */
  const handleCopyOne = useCallback(async (seq: number) => {
    const item = items.find((it) => it.seq === seq);
    if (!item) return;
    const ok = await copyText(item.text);
    if (ok) {
      setCopiedSeq(seq);
      flashNotice('已复制');
      setTimeout(() => setCopiedSeq(null), 1500);
    } else {
      flashNotice('复制失败，请手动复制');
    }
  }, [items, flashNotice]);

  /** 清空结果 */
  const handleClear = useCallback(() => {
    setItems([]);
    setNotice('');
    setCopiedAll(false);
    setCopiedSeq(null);
  }, []);

  /** 切换字符集选项 */
  const toggleOpt = (key: keyof CharsetOpts) => {
    setOpts((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="jsontool pwtool">
      {/* 工具栏 */}
      <div className="jsontool__toolbar" role="toolbar" aria-label="密码生成器操作">
        <div className="jsontool__actions">
          <button className="btn btn--primary btn--sm" onClick={regenerate} disabled={charsetEmpty}>
            重新生成
          </button>
        </div>
        <div className="jsontool__options">
          {/* 数量选择 */}
          <label className="pwtool__field">
            <span>数量</span>
            <select
              className="pwtool__select"
              value={count}
              onChange={(e) => setCount(Number(e.target.value) as Count)}
              aria-label="生成数量"
            >
              {COUNT_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          {/* 实时模式开关 */}
          <label className="pwtool__toggle">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
            <span>实时生成</span>
          </label>
          <button className="btn btn--sm" onClick={handleClear}>清空</button>
        </div>
      </div>

      {/* 参数控制区 */}
      <div className="pwtool__controls">
        {/* 长度滑块 */}
        <div className="pwtool__field pwtool__field--length">
          <span className="pwtool__field-label">长度</span>
          <input
            type="range"
            className="pwtool__range"
            min={LENGTH_MIN}
            max={LENGTH_MAX}
            step={1}
            value={length}
            onChange={(e) => setLength(Number(e.target.value))}
            aria-label="密码长度"
          />
          <span className="pwtool__length-value" aria-live="polite">{length}</span>
        </div>

        {/* 字符集选项 */}
        <div className="pwtool__field pwtool__field--charset" role="group" aria-label="字符集选择">
          <span className="pwtool__field-label">字符集</span>
          <div className="pwtool__charset">
            <label className="pwtool__toggle">
              <input type="checkbox" checked={opts.lower} onChange={() => toggleOpt('lower')} />
              <span>小写 a-z</span>
            </label>
            <label className="pwtool__toggle">
              <input type="checkbox" checked={opts.upper} onChange={() => toggleOpt('upper')} />
              <span>大写 A-Z</span>
            </label>
            <label className="pwtool__toggle">
              <input type="checkbox" checked={opts.digit} onChange={() => toggleOpt('digit')} />
              <span>数字 0-9</span>
            </label>
            <label className="pwtool__toggle">
              <input type="checkbox" checked={opts.symbol} onChange={() => toggleOpt('symbol')} />
              <span>符号 !@#$</span>
            </label>
            <label className="pwtool__toggle">
              <input
                type="checkbox"
                checked={opts.excludeAmbiguous}
                onChange={() => toggleOpt('excludeAmbiguous')}
              />
              <span>排除易混字符 (0O1lI)</span>
            </label>
          </div>
        </div>

        {/* 强度评估 */}
        <div className="pwtool__strength" aria-live="polite">
          <div className="pwtool__strength-header">
            <span className="pwtool__field-label">强度</span>
            <span
              className="pwtool__strength-label"
              style={{ color: strength.color, fontWeight: 600 }}
            >
              {strength.label}
            </span>
            <span className="pwtool__strength-meta">
              熵 ≈ {entropy.toFixed(1)} bits · 字符集 {charsetSize}
            </span>
          </div>
          <div className="pwtool__strength-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={strength.percent}>
            <div
              className="pwtool__strength-fill"
              style={{ width: `${strength.percent}%`, background: strength.color }}
            />
          </div>
          {charsetEmpty && (
            <div className="pwtool__error" role="alert">
              请至少选择一个字符集（小写 / 大写 / 数字 / 符号）。
            </div>
          )}
        </div>
      </div>

      {/* 结果列表 */}
      <div className="jsontool__panels">
        <div className="jsontool__panel">
          <div className="jsontool__label">
            <span>生成结果（{items.length} 条）</span>
            <button
              className="btn btn--sm jsontool__copy"
              onClick={handleCopyAll}
              disabled={items.length === 0}
              aria-label="复制全部密码"
            >
              {copiedAll ? '已复制' : '复制全部'}
            </button>
          </div>
          <ul className="pwtool__list" aria-live="polite">
            {items.length === 0 ? (
              <li className="pwtool__empty">
                {charsetEmpty ? '请先选择字符集' : '点击"重新生成"开始创建密码'}
              </li>
            ) : (
              items.map((it) => (
                <li key={it.seq} className="pwtool__item">
                  <code className="pwtool__code">{it.text}</code>
                  <button
                    className="btn btn--sm pwtool__copy-one"
                    onClick={() => handleCopyOne(it.seq)}
                    aria-label={`复制第 ${it.seq + 1} 条`}
                  >
                    {copiedSeq === it.seq ? '已复制' : '复制'}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      {/* 状态条 */}
      <div className="jsontool__status" role="status" aria-live="polite">
        {notice ? (
          <div className="jsontool__notice">{notice}</div>
        ) : (
          <div className="jsontool__hint">
            使用原生 crypto.getRandomValues（CSPRNG）+ 拒绝采样消除模偏差，
            所有随机数在浏览器本地生成，不会上传。
          </div>
        )}
      </div>
    </div>
  );
}
