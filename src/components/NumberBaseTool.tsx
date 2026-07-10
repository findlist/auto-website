import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * 进制转换工具
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 二进制 / 八进制 / 十进制 / 十六进制 互转
 *  - 使用 BigInt 支持超大整数（突破 Number.MAX_SAFE_INTEGER 限制）
 *  - 自动识别 0b / 0o / 0x 前缀与负号
 *  - 十六进制结果可切换大小写
 *  - 二进制结果按 4 位分组显示，便于位运算阅读
 *
 * 适用场景：
 *  - 编程开发：颜色值、权限位、寄存器值、地址偏移的进制换算
 *  - 计算机基础学习：理解不同进制的对应关系
 *  - 嵌入式开发：位掩码、硬件寄存器读写
 */

type Base = 2 | 8 | 10 | 16;

interface BaseConfig {
  base: Base;
  label: string;
  prefix: string;
  placeholder: string;
}

const BASE_CONFIGS: BaseConfig[] = [
  { base: 2, label: '二进制', prefix: '0b', placeholder: '如 10101100' },
  { base: 8, label: '八进制', prefix: '0o', placeholder: '如 254' },
  { base: 10, label: '十进制', prefix: '', placeholder: '如 172' },
  { base: 16, label: '十六进制', prefix: '0x', placeholder: '如 AC' },
];

/** 合法字符集（用于输入校验） */
const VALID_CHARS: Record<Base, RegExp> = {
  2: /^[01]+$/,
  8: /^[0-7]+$/,
  10: /^[0-9]+$/,
  16: /^[0-9a-fA-F]+$/,
};

/**
 * 将输入字符串解析为 BigInt
 * 支持前缀（0b/0o/0x）与负号，解析失败返回 null
 */
function parseInput(raw: string, base: Base): bigint | null {
  let s = raw.trim();
  if (s === '') return null;

  // 记录并剥离负号
  const negative = s.startsWith('-');
  if (negative) s = s.slice(1);

  // 剥离编程语言字面量前缀（用户可能粘贴带前缀的值）
  s = s.replace(/^0b/i, '').replace(/^0o/i, '').replace(/^0x/i, '');

  if (s === '') return null;

  // 校验字符合法性
  if (!VALID_CHARS[base].test(s)) return null;

  try {
    // BigInt 构造函数只接受十进制字符串，需用自定义解析
    let result = 0n;
    const b = BigInt(base);
    for (const ch of s) {
      result = result * b + BigInt(parseInt(ch, base));
    }
    return negative ? -result : result;
  } catch {
    return null;
  }
}

/** 将 BigInt 转为指定进制的字符串，十六进制可选大小写 */
function bigintToBase(value: bigint, base: Base, upper: boolean): string {
  if (value === 0n) return '0';
  const negative = value < 0n;
  let n = negative ? -value : value;
  const b = BigInt(base);
  const digits: string[] = [];
  while (n > 0n) {
    const remainder = Number(n % b);
    digits.push(remainder.toString(base));
    n = n / b;
  }
  let result = digits.reverse().join('');
  if (base === 16 && upper) result = result.toUpperCase();
  return negative ? '-' + result : result;
}

/** 二进制结果按 4 位分组，便于阅读位掩码 */
function groupBinary(bin: string): string {
  const negative = bin.startsWith('-');
  const s = negative ? bin.slice(1) : bin;
  // 从低位向高位每 4 位插入空格
  const grouped = s.replace(/(\d{4})(?=\d)/g, '$1 ');
  return negative ? '-' + grouped : grouped;
}

export default function NumberBaseTool() {
  // 以十进制输入框为主输入，其余框为结果
  const [inputs, setInputs] = useState<Record<Base, string>>({
    2: '',
    8: '',
    10: '172',
    16: '',
  });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [upper, setUpper] = useState(true);
  const [copiedBase, setCopiedBase] = useState<Base | null>(null);

  // 以十进制输入为基准计算所有进制结果
  const decimalValue = useMemo(() => parseInput(inputs[10], 10), [inputs[10]]);

  /** 处理某个进制输入框的变更，同步更新所有框 */
  const handleInput = useCallback((base: Base, value: string) => {
    // 允许输入前缀字符，但解析时剥离
    setInputs((prev) => ({ ...prev, [base]: value }));
    setError('');
    setNotice('');

    const parsed = parseInput(value, base);
    if (value.trim() === '') {
      // 清空所有框
      setInputs({ 2: '', 8: '', 10: '', 16: '' });
      return;
    }
    if (parsed === null) {
      const config = BASE_CONFIGS.find((c) => c.base === base)!;
      setError(`${config.label}输入包含非法字符，仅允许 ${base === 2 ? '0-1' : base === 8 ? '0-7' : base === 10 ? '0-9' : '0-9、a-f、A-F'}`);
      return;
    }
    // 同步更新其他进制框
    setInputs({
      2: bigintToBase(parsed, 2, upper),
      8: bigintToBase(parsed, 8, upper),
      10: bigintToBase(parsed, 10, upper),
      16: bigintToBase(parsed, 16, upper),
    });
  }, [upper]);

  /** 大小写切换时重新生成十六进制结果 */
  const handleUpperToggle = useCallback((checked: boolean) => {
    setUpper(checked);
    if (decimalValue !== null) {
      setInputs((prev) => ({
        ...prev,
        2: bigintToBase(decimalValue, 2, checked),
        8: bigintToBase(decimalValue, 8, checked),
        10: bigintToBase(decimalValue, 10, checked),
        16: bigintToBase(decimalValue, 16, checked),
      }));
    }
  }, [decimalValue]);

  const handleCopy = useCallback(async (base: Base) => {
    const text = inputs[base];
    if (!text) return;
    const ok = await copyText(text);
    if (ok) {
      setCopiedBase(base);
      setNotice('已复制到剪贴板');
      setTimeout(() => setCopiedBase(null), 1500);
    } else {
      setNotice('复制失败，请手动选中复制');
    }
  }, [inputs]);

  const handleClear = useCallback(() => {
    setInputs({ 2: '', 8: '', 10: '', 16: '' });
    setError('');
    setNotice('');
    setCopiedBase(null);
  }, []);

  const handleSample = useCallback(() => {
    setInputs({ 2: '10101100', 8: '254', 10: '172', 16: 'AC' });
    setError('');
    setNotice('');
  }, []);

  // 二进制分组显示
  const binaryGrouped = useMemo(
    () => (inputs[2] ? groupBinary(inputs[2]) : ''),
    [inputs[2]],
  );

  return (
    <div className="numberbase-tool">
      {/* 工具栏 */}
      <div className="numberbase-tool__toolbar">
        <div className="numberbase-tool__options">
          <label className="numberbase-tool__toggle">
            <input type="checkbox" checked={upper} onChange={(e) => handleUpperToggle(e.target.checked)} />
            <span>十六进制大写</span>
          </label>
        </div>
        <div className="numberbase-tool__actions">
          <button className="btn btn--sm" onClick={handleSample}>示例</button>
          <button className="btn btn--sm" onClick={handleClear}>清空</button>
        </div>
      </div>

      {/* 进制输入区：4 个进制并排 */}
      <div className="numberbase-tool__grid">
        {BASE_CONFIGS.map((cfg) => (
          <div key={cfg.base} className="numberbase-tool__field">
            <label htmlFor={`base-${cfg.base}`} className="numberbase-tool__label">
              <span className="numberbase-tool__label-name">{cfg.label}</span>
              <span className="numberbase-tool__label-base">基数 {cfg.base}</span>
            </label>
            <div className="numberbase-tool__input-row">
              {cfg.prefix && <span className="numberbase-tool__prefix">{cfg.prefix}</span>}
              <input
                id={`base-${cfg.base}`}
                type="text"
                className="numberbase-tool__input"
                value={inputs[cfg.base]}
                onChange={(e) => handleInput(cfg.base, e.target.value)}
                placeholder={cfg.placeholder}
                spellCheck={false}
                autoComplete="off"
                aria-label={cfg.label}
              />
              <button
                className="btn btn--sm numberbase-tool__copy"
                onClick={() => handleCopy(cfg.base)}
                disabled={!inputs[cfg.base]}
                aria-label={`复制${cfg.label}结果`}
              >
                {copiedBase === cfg.base ? '已复制' : '复制'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 二进制分组显示 */}
      {binaryGrouped && (
        <div className="numberbase-tool__binary-group">
          <span className="numberbase-tool__binary-label">二进制（4 位分组）</span>
          <code className="numberbase-tool__binary-value">{binaryGrouped}</code>
        </div>
      )}

      {/* 状态条 */}
      <div className="numberbase-tool__status" role="status" aria-live="polite">
        {error ? (
          <div className="numberbase-tool__error">
            <strong>❌ 错误</strong>
            <span>{error}</span>
          </div>
        ) : notice ? (
          <div className="numberbase-tool__notice">{notice}</div>
        ) : (
          <div className="numberbase-tool__hint">
            支持 BigInt 超大整数，自动识别 0b / 0o / 0x 前缀。所有数据仅在浏览器本地处理。
          </div>
        )}
      </div>
    </div>
  );
}
