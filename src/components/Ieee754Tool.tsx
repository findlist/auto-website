import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * IEEE 754 浮点数可视化工具
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 十进制浮点数 ↔ IEEE 754 二进制位串 双向转换
 *  - 支持单精度（32 位）与双精度（64 位）
 *  - 符号位 / 指数位 / 尾数位 三色可视化分段
 *  - 中间值展示：偏移指数、实际指数、隐含位、尾数值
 *  - 特殊值识别：零、非规格化数、无穷大、NaN
 *
 * 技术核心：DataView + ArrayBuffer 实现浮点数与整数的位级 reinterpret，
 * 双精度使用 BigInt 处理 64 位整数（超出 Number.MAX_SAFE_INTEGER）。
 */

type Precision = 'single' | 'double';

interface PrecisionConfig {
  totalBits: number;
  exponentBits: number;
  mantissaBits: number;
  bias: number;
  label: string;
}

const PRECISION_CONFIG: Record<Precision, PrecisionConfig> = {
  single: { totalBits: 32, exponentBits: 8, mantissaBits: 23, bias: 127, label: '单精度（32 位）' },
  double: { totalBits: 64, exponentBits: 11, mantissaBits: 52, bias: 1023, label: '双精度（64 位）' },
};

/** 将浮点数转为 IEEE 754 二进制位串（大端序） */
function floatToBits(value: number, precision: Precision): string {
  const cfg = PRECISION_CONFIG[precision];
  if (precision === 'single') {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setFloat32(0, value, false);
    return dv.getUint32(0, false).toString(2).padStart(cfg.totalBits, '0');
  }
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, value, false);
  // 双精度 64 位超出安全整数范围，用 BigInt 处理
  return dv.getBigUint64(0, false).toString(2).padStart(cfg.totalBits, '0');
}

/** 将 IEEE 754 二进制位串转为浮点数，非法格式返回 null */
function bitsToFloat(bits: string, precision: Precision): number | null {
  const cfg = PRECISION_CONFIG[precision];
  if (!/^[01]+$/.test(bits) || bits.length !== cfg.totalBits) return null;
  if (precision === 'single') {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setUint32(0, parseInt(bits, 2), false);
    return dv.getFloat32(0, false);
  }
  const dv = new DataView(new ArrayBuffer(8));
  dv.setBigUint64(0, BigInt('0b' + bits), false);
  return dv.getFloat64(0, false);
}

type SpecialType = 'zero' | 'denormal' | 'infinity' | 'nan' | 'normal';

interface BitFields {
  sign: string;
  exponent: string;
  mantissa: string;
  signValue: 0 | 1;
  exponentValue: number;
  actualExponent: number;
  mantissaValue: number;
  special: SpecialType;
  specialLabel: string;
}

/** 解析 IEEE 754 位串为结构化字段，识别特殊值 */
function parseBitFields(bits: string, precision: Precision): BitFields {
  const cfg = PRECISION_CONFIG[precision];
  const sign = bits[0];
  const exponent = bits.substring(1, 1 + cfg.exponentBits);
  const mantissa = bits.substring(1 + cfg.exponentBits);

  const signValue: 0 | 1 = sign === '1' ? 1 : 0;
  const exponentValue = parseInt(exponent, 2);
  const mantissaValue = parseInt(mantissa, 2);
  const expMax = 2 ** cfg.exponentBits - 1;
  const allExpZero = exponentValue === 0;
  const allExpOne = exponentValue === expMax;
  const allMantZero = mantissaValue === 0;

  let special: SpecialType = 'normal';
  let actualExponent = exponentValue - cfg.bias;
  let specialLabel = '规格化数';

  if (allExpZero && allMantZero) {
    special = 'zero';
    actualExponent = 1 - cfg.bias;
    specialLabel = signValue === 1 ? '负零（-0）' : '正零（+0）';
  } else if (allExpZero) {
    special = 'denormal';
    actualExponent = 1 - cfg.bias;
    specialLabel = '非规格化数';
  } else if (allExpOne && allMantZero) {
    special = 'infinity';
    specialLabel = signValue === 1 ? '负无穷大（-∞）' : '正无穷大（+∞）';
  } else if (allExpOne) {
    special = 'nan';
    specialLabel = 'NaN（非数值）';
  }

  return { sign, exponent, mantissa, signValue, exponentValue, actualExponent, mantissaValue, special, specialLabel };
}

/** 格式化浮点数显示：处理 -0、NaN、Infinity 的特殊显示 */
function formatNumber(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  if (Object.is(value, -0)) return '-0';
  return String(value);
}

export default function Ieee754Tool() {
  const [precision, setPrecision] = useState<Precision>('single');
  const [decimalInput, setDecimalInput] = useState('3.14');
  const [binaryInput, setBinaryInput] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);

  const cfg = PRECISION_CONFIG[precision];

  // 十进制 → 二进制：解析输入并生成 IEEE 754 位串
  const decimalResult = useMemo(() => {
    const trimmed = decimalInput.trim();
    if (trimmed === '') return { bits: '', error: '' };

    // 特殊值字面量
    const lower = trimmed.toLowerCase();
    if (lower === 'nan') return { bits: floatToBits(NaN, precision), error: '' };
    if (lower === 'infinity' || lower === 'inf') return { bits: floatToBits(Infinity, precision), error: '' };
    if (lower === '-infinity' || lower === '-inf') return { bits: floatToBits(-Infinity, precision), error: '' };

    const value = Number(trimmed);
    if (Number.isNaN(value)) return { bits: '', error: '无法解析为有效数字，请输入如 3.14、-0.5、1e10' };
    return { bits: floatToBits(value, precision), error: '' };
  }, [decimalInput, precision]);

  // 有效二进制位串：优先取十进制转换结果，其次取用户手动输入
  const effectiveBinary = useMemo(() => {
    if (decimalResult.bits) return decimalResult.bits;
    return binaryInput;
  }, [decimalResult.bits, binaryInput]);

  // 位段分解
  const fields = useMemo(() => {
    if (!effectiveBinary || effectiveBinary.length !== cfg.totalBits) return null;
    return parseBitFields(effectiveBinary, precision);
  }, [effectiveBinary, precision, cfg.totalBits]);

  // 二进制 → 十进制
  const decodedValue = useMemo(() => {
    if (!effectiveBinary || effectiveBinary.length !== cfg.totalBits) return null;
    return bitsToFloat(effectiveBinary, precision);
  }, [effectiveBinary, precision, cfg.totalBits]);

  const handleDecimalInput = useCallback((value: string) => {
    setDecimalInput(value);
    setBinaryInput('');
    setNotice('');
  }, []);

  const handleBinaryInput = useCallback((value: string) => {
    // 仅保留 0/1，限制长度为当前精度的总位数
    const filtered = value.replace(/[^01]/g, '').substring(0, cfg.totalBits);
    setBinaryInput(filtered);
    setDecimalInput('');
    setNotice('');
  }, [cfg.totalBits]);

  const handlePrecisionChange = useCallback((p: Precision) => {
    setPrecision(p);
    setBinaryInput('');
    setNotice('');
  }, []);

  const handleCopy = useCallback(async () => {
    if (!effectiveBinary) return;
    const ok = await copyText(effectiveBinary);
    if (ok) {
      setCopied(true);
      setNotice('已复制二进制位串到剪贴板');
      setTimeout(() => setCopied(false), 1500);
    } else {
      setNotice('复制失败，请手动选中复制');
    }
  }, [effectiveBinary]);

  const handleClear = useCallback(() => {
    setDecimalInput('');
    setBinaryInput('');
    setNotice('');
  }, []);

  const handleSample = useCallback(() => {
    setPrecision('single');
    setDecimalInput('3.14');
    setBinaryInput('');
    setNotice('');
  }, []);

  const error = decimalResult.error;

  return (
    <div className="ieee754-tool">
      {/* 精度切换 */}
      <div className="ieee754-tool__precision" role="radiogroup" aria-label="精度选择">
        {(Object.keys(PRECISION_CONFIG) as Precision[]).map((p) => (
          <label key={p} className="ieee754-tool__radio">
            <input
              type="radio"
              name="precision"
              checked={precision === p}
              onChange={() => handlePrecisionChange(p)}
            />
            <span>{PRECISION_CONFIG[p].label}</span>
          </label>
        ))}
      </div>

      {/* 输入区 */}
      <div className="ieee754-tool__inputs">
        <div className="ieee754-tool__field">
          <label htmlFor="ieee754-decimal" className="ieee754-tool__label">十进制数值</label>
          <input
            id="ieee754-decimal"
            type="text"
            className="ieee754-tool__input"
            value={decimalInput}
            onChange={(e) => handleDecimalInput(e.target.value)}
            placeholder="如 3.14、-0、Infinity、NaN"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className="ieee754-tool__field">
          <label htmlFor="ieee754-binary" className="ieee754-tool__label">
            二进制位串（{cfg.totalBits} 位）
          </label>
          <input
            id="ieee754-binary"
            type="text"
            className="ieee754-tool__input ieee754-tool__input--mono"
            value={effectiveBinary}
            onChange={(e) => handleBinaryInput(e.target.value)}
            placeholder={`输入 ${cfg.totalBits} 位 0/1 串`}
            spellCheck={false}
            autoComplete="off"
            maxLength={cfg.totalBits}
          />
        </div>
      </div>

      {/* 工具栏 */}
      <div className="ieee754-tool__toolbar">
        <button className="btn btn--sm" onClick={handleSample}>示例</button>
        <button className="btn btn--sm" onClick={handleClear}>清空</button>
        <button className="btn btn--sm" onClick={handleCopy} disabled={!effectiveBinary}>
          {copied ? '已复制' : '复制二进制'}
        </button>
      </div>

      {/* 位段可视化 */}
      {fields && (
        <div className="ieee754-tool__bits">
          <div className="ieee754-tool__bits-row" role="img" aria-label={`符号位 ${fields.sign}，指数位 ${fields.exponent}，尾数位 ${fields.mantissa}`}>
            <span className="ieee754-tool__bit-seg ieee754-tool__bit-seg--sign" title="符号位（1 位）">
              {fields.sign}
            </span>
            <span className="ieee754-tool__bit-seg ieee754-tool__bit-seg--exp" title={`指数位（${cfg.exponentBits} 位）`}>
              {fields.exponent}
            </span>
            <span className="ieee754-tool__bit-seg ieee754-tool__bit-seg--mant" title={`尾数位（${cfg.mantissaBits} 位）`}>
              {fields.mantissa}
            </span>
          </div>
          <div className="ieee754-tool__bits-labels">
            <span className="ieee754-tool__bit-label ieee754-tool__bit-label--sign">符号 1</span>
            <span className="ieee754-tool__bit-label ieee754-tool__bit-label--exp">指数 {cfg.exponentBits}</span>
            <span className="ieee754-tool__bit-label ieee754-tool__bit-label--mant">尾数 {cfg.mantissaBits}</span>
          </div>
        </div>
      )}

      {/* 分解信息 */}
      {fields && (
        <div className="ieee754-tool__fields">
          <div className="ieee754-tool__field-info">
            <span className="ieee754-tool__field-name">符号位</span>
            <span className="ieee754-tool__field-value">{fields.signValue}</span>
            <span className="ieee754-tool__field-desc">{fields.signValue === 0 ? '正数' : '负数'}</span>
          </div>
          <div className="ieee754-tool__field-info">
            <span className="ieee754-tool__field-name">偏移指数</span>
            <span className="ieee754-tool__field-value">{fields.exponentValue}</span>
            <span className="ieee754-tool__field-desc">原始值</span>
          </div>
          <div className="ieee754-tool__field-info">
            <span className="ieee754-tool__field-name">实际指数</span>
            <span className="ieee754-tool__field-value">{fields.actualExponent}</span>
            <span className="ieee754-tool__field-desc">{fields.exponentValue} - {cfg.bias}</span>
          </div>
          <div className="ieee754-tool__field-info">
            <span className="ieee754-tool__field-name">尾数值</span>
            <span className="ieee754-tool__field-value">{fields.mantissaValue}</span>
            <span className="ieee754-tool__field-desc">十进制</span>
          </div>
          <div className="ieee754-tool__field-info">
            <span className="ieee754-tool__field-name">隐含位</span>
            <span className="ieee754-tool__field-value">{fields.special === 'normal' ? '1' : '0'}</span>
            <span className="ieee754-tool__field-desc">
              {fields.special === 'normal' ? '规格化隐含 1' : '无隐含位'}
            </span>
          </div>
          <div className="ieee754-tool__field-info">
            <span className="ieee754-tool__field-name">数值类别</span>
            <span className="ieee754-tool__field-value ieee754-tool__field-value--special">
              {fields.specialLabel}
            </span>
            <span className="ieee754-tool__field-desc">类型</span>
          </div>
        </div>
      )}

      {/* 十进制结果 */}
      {decodedValue !== null && (
        <div className="ieee754-tool__result">
          <span className="ieee754-tool__result-label">十进制结果</span>
          <code className="ieee754-tool__result-value">{formatNumber(decodedValue)}</code>
        </div>
      )}

      {/* 状态条 */}
      <div className="ieee754-tool__status" role="status" aria-live="polite">
        {error ? (
          <div className="ieee754-tool__error">
            <strong>❌ 错误</strong>
            <span>{error}</span>
          </div>
        ) : notice ? (
          <div className="ieee754-tool__notice">{notice}</div>
        ) : (
          <div className="ieee754-tool__hint">
            基于 DataView 实现浮点数与二进制位的位级 reinterpret，双精度使用 BigInt 处理 64 位整数。所有计算在浏览器本地完成。
          </div>
        )}
      </div>
    </div>
  );
}
