import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * 颜色格式转换工具
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - HEX / RGB / HSL / HSV / CMYK 五种格式互转
 *  - 颜色拾取器（input[type=color]）实时取色
 *  - 大色块预览 + 渐变预览（当前色 → 黑/白）
 *  - 调色板生成：互补色 / 类似色 / 三角色 / 分割互补色 / 四角色 5 种和谐方案
 *  - 输入即解析，支持多种格式自动识别（带前缀如 rgb() 也可）
 *  - 复制各格式值，带降级方案
 *  - 输入长度上限保护
 */

/** RGB 颜色：0-255 整数 */
interface RGB {
  r: number;
  g: number;
  b: number;
}

/** HSL 颜色：h 为 0-360，s/l 为 0-100 */
interface HSL {
  h: number;
  s: number;
  l: number;
}

/** HSV 颜色：h 为 0-360，s/v 为 0-100 */
interface HSV {
  h: number;
  s: number;
  v: number;
}

/** CMYK 颜色：c/m/y/k 均为 0-100 */
interface CMYK {
  c: number;
  m: number;
  y: number;
  k: number;
}

/** 输入长度上限：防止超长输入卡顿 */
const MAX_INPUT_LENGTH = 200;

/** 示例颜色：使用一个中等饱和度的品牌蓝作为示例 */
const SAMPLE_COLOR: RGB = { r: 43, g: 108, b: 255 };

type FormatKey = 'hex' | 'rgb' | 'hsl' | 'hsv' | 'cmyk';

/** 调色板和谐方案类型 */
type HarmonyType = 'complementary' | 'analogous' | 'triadic' | 'splitComplement' | 'tetradic';

/** 调色板方案元数据 */
const HARMONY_META: Record<HarmonyType, { label: string; desc: string }> = {
  complementary: { label: '互补色', desc: '180° 对比强烈，适合强调' },
  analogous: { label: '类似色', desc: '±30° 邻近色，和谐柔顺' },
  triadic: { label: '三角色', desc: '±120° 三色，平衡活泼' },
  splitComplement: { label: '分割互补', desc: '180°±30°，对比但不刺眼' },
  tetradic: { label: '四角色', desc: '±90°/±180° 四色，丰富多样' },
};

/** 各方案的色相旋转角度数组（用于调色板生成） */
const HARMONY_ROTATIONS: Record<HarmonyType, number[]> = {
  complementary: [0, 180],
  analogous: [-30, 0, 30],
  triadic: [0, 120, 240],
  splitComplement: [0, 150, 210],
  tetradic: [0, 90, 180, 270],
};

/**
 * 颜色互转核心算法
 * 所有转换以 RGB 为中介：任一格式 → RGB → 其他格式
 */

/** 限制 0-255 范围并取整 */
function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** 限制 0-100 范围 */
function clampPercent(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/** 限制 0-360 范围（色相循环） */
function clampHue(n: number): number {
  return ((n % 360) + 360) % 360;
}

/** HEX → RGB：支持 3 位与 6 位 */
function hexToRgb(hex: string): RGB | null {
  let h = hex.trim();
  // 去除前导 #
  if (h.startsWith('#')) h = h.slice(1);
  // 去除前导 0x（部分用户习惯）
  if (h.startsWith('0x') || h.startsWith('0X')) h = h.slice(2);
  if (h.length === 3) {
    // 简写 #RGB → #RRGGBB
    const r = h[0];
    const g = h[1];
    const b = h[2];
    h = `${r}${r}${g}${g}${b}${b}`;
  }
  if (h.length !== 6) return null;
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** RGB → HEX：输出 #rrggbb 小写 */
function rgbToHex({ r, g, b }: RGB): string {
  const toHex = (n: number) => clampByte(n).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** RGB → HSL（标准转换公式） */
function rgbToHsl({ r, g, b }: RGB): HSL {
  const rN = r / 255;
  const gN = g / 255;
  const bN = b / 255;
  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rN) h = ((gN - bN) / d) % 6;
    else if (max === gN) h = (bN - rN) / d + 2;
    else h = (rN - gN) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** HSL → RGB（标准转换公式） */
function hslToRgb({ h, s, l }: HSL): RGB {
  const hN = clampHue(h) / 360;
  const sN = clampPercent(s) / 100;
  const lN = clampPercent(l) / 100;
  if (sN === 0) {
    // 灰度色
    const v = clampByte(lN * 255);
    return { r: v, g: v, b: v };
  }
  const q = lN < 0.5 ? lN * (1 + sN) : lN + sN - lN * sN;
  const p = 2 * lN - q;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return {
    r: clampByte(hue2rgb(p, q, hN + 1 / 3) * 255),
    g: clampByte(hue2rgb(p, q, hN) * 255),
    b: clampByte(hue2rgb(p, q, hN - 1 / 3) * 255),
  };
}

/** RGB → HSV */
function rgbToHsv({ r, g, b }: RGB): HSV {
  const rN = r / 255;
  const gN = g / 255;
  const bN = b / 255;
  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rN) h = ((gN - bN) / d) % 6;
    else if (max === gN) h = (bN - rN) / d + 2;
    else h = (rN - gN) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h: Math.round(h), s: Math.round(s * 100), v: Math.round(max * 100) };
}

/** HSV → RGB（6 个区间映射，标准公式） */
function hsvToRgb({ h, s, v }: HSV): RGB {
  const hN = clampHue(h) / 60;
  const sN = clampPercent(s) / 100;
  const vN = clampPercent(v) / 100;
  const c = vN * sN;
  const x = c * (1 - Math.abs((hN % 2) - 1));
  const m = vN - c;
  let rp = 0, gp = 0, bp = 0;
  // 6 个区间分别对应 (r', g', b') 取值
  if (hN < 1) { rp = c; gp = x; bp = 0; }
  else if (hN < 2) { rp = x; gp = c; bp = 0; }
  else if (hN < 3) { rp = 0; gp = c; bp = x; }
  else if (hN < 4) { rp = 0; gp = x; bp = c; }
  else if (hN < 5) { rp = x; gp = 0; bp = c; }
  else { rp = c; gp = 0; bp = x; }
  return {
    r: clampByte((rp + m) * 255),
    g: clampByte((gp + m) * 255),
    b: clampByte((bp + m) * 255),
  };
}

/** RGB → CMYK */
function rgbToCmyk({ r, g, b }: RGB): CMYK {
  const rN = r / 255;
  const gN = g / 255;
  const bN = b / 255;
  const k = 1 - Math.max(rN, gN, bN);
  if (k === 1) {
    // 纯黑：CMY 均为 0，K = 100
    return { c: 0, m: 0, y: 0, k: 100 };
  }
  const c = (1 - rN - k) / (1 - k);
  const m = (1 - gN - k) / (1 - k);
  const y = (1 - bN - k) / (1 - k);
  return {
    c: Math.round(c * 100),
    m: Math.round(m * 100),
    y: Math.round(y * 100),
    k: Math.round(k * 100),
  };
}

/** CMYK → RGB */
function cmykToRgb({ c, m, y, k }: CMYK): RGB {
  const cN = clampPercent(c) / 100;
  const mN = clampPercent(m) / 100;
  const yN = clampPercent(y) / 100;
  const kN = clampPercent(k) / 100;
  return {
    r: clampByte(255 * (1 - cN) * (1 - kN)),
    g: clampByte(255 * (1 - mN) * (1 - kN)),
    b: clampByte(255 * (1 - yN) * (1 - kN)),
  };
}

/** 格式化输出：每种格式的人类可读字符串 */

function formatHex(rgb: RGB): string {
  return rgbToHex(rgb);
}

function formatRgb({ r, g, b }: RGB): string {
  return `rgb(${r}, ${g}, ${b})`;
}

function formatHsl(hsl: HSL): string {
  return `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
}

function formatHsv(hsv: HSV): string {
  return `hsv(${hsv.h}, ${hsv.s}%, ${hsv.v}%)`;
}

function formatCmyk(cmyk: CMYK): string {
  return `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)`;
}

/**
 * 输入解析：从任意格式字符串识别并解析为 RGB
 * 支持的输入：
 *  - #rgb / #rrggbb
 *  - rgb(r, g, b) / r, g, b / r g b
 *  - hsl(h, s%, l%) / h, s%, l% / h s% l%
 *  - hsv(h, s%, v%) / h, s%, v% / h s% v%
 *  - cmyk(c%, m%, y%, k%) / c%, m%, y%, k%
 */
function parseInput(input: string): { rgb: RGB | null; format: FormatKey | null; error: string } {
  const trimmed = input.trim();
  if (trimmed === '') {
    return { rgb: null, format: null, error: '请输入颜色值' };
  }
  const lower = trimmed.toLowerCase();

  // 1. HEX：以 # 开头，或纯 6/3 位十六进制
  if (/^#?[0-9a-f]{3}$/.test(lower.replace('#', '')) ||
      /^#?[0-9a-f]{6}$/.test(lower.replace('#', ''))) {
    const rgb = hexToRgb(trimmed);
    if (rgb) return { rgb, format: 'hex', error: '' };
  }
  if (lower.startsWith('#') || /^0x[0-9a-f]+$/i.test(trimmed)) {
    const rgb = hexToRgb(trimmed);
    if (rgb) return { rgb, format: 'hex', error: '' };
    return { rgb: null, format: 'hex', error: 'HEX 格式应为 #RRGGBB（6 位）或 #RGB（3 位）' };
  }

  // 提取括号内或裸值
  const extractNums = (s: string): number[] => {
    const matches = s.match(/-?\d+(?:\.\d+)?/g);
    return matches ? matches.map(Number) : [];
  };

  // 2. RGB：rgb(r, g, b) 或 r, g, b
  if (lower.startsWith('rgb')) {
    const nums = extractNums(trimmed);
    if (nums.length >= 3) {
      const r = clampByte(nums[0]);
      const g = clampByte(nums[1]);
      const b = clampByte(nums[2]);
      return { rgb: { r, g, b }, format: 'rgb', error: '' };
    }
    return { rgb: null, format: 'rgb', error: 'RGB 格式应为 rgb(r, g, b)，如 rgb(43, 108, 255)' };
  }

  // 3. HSL：hsl(h, s%, l%)
  if (lower.startsWith('hsl')) {
    const nums = extractNums(trimmed);
    if (nums.length >= 3) {
      const rgb = hslToRgb({ h: clampHue(nums[0]), s: clampPercent(nums[1]), l: clampPercent(nums[2]) });
      return { rgb, format: 'hsl', error: '' };
    }
    return { rgb: null, format: 'hsl', error: 'HSL 格式应为 hsl(h, s%, l%)，如 hsl(220, 100%, 58%)' };
  }

  // 4. HSV：hsv(h, s%, v%)
  if (lower.startsWith('hsv')) {
    const nums = extractNums(trimmed);
    if (nums.length >= 3) {
      const rgb = hsvToRgb({ h: clampHue(nums[0]), s: clampPercent(nums[1]), v: clampPercent(nums[2]) });
      return { rgb, format: 'hsv', error: '' };
    }
    return { rgb: null, format: 'hsv', error: 'HSV 格式应为 hsv(h, s%, v%)，如 hsv(220, 83%, 100%)' };
  }

  // 5. CMYK：cmyk(c%, m%, y%, k%)
  if (lower.startsWith('cmyk')) {
    const nums = extractNums(trimmed);
    if (nums.length >= 4) {
      const rgb = cmykToRgb({
        c: clampPercent(nums[0]),
        m: clampPercent(nums[1]),
        y: clampPercent(nums[2]),
        k: clampPercent(nums[3]),
      });
      return { rgb, format: 'cmyk', error: '' };
    }
    return { rgb: null, format: 'cmyk', error: 'CMYK 格式应为 cmyk(c%, m%, y%, k%)，如 cmyk(83%, 58%, 0%, 0%)' };
  }

  // 6. 裸值自动识别：按数字个数推断
  const nums = extractNums(trimmed);
  if (nums.length === 3) {
    // 假设 RGB：三值均 0-255
    if (nums.every((n) => n >= 0 && n <= 255)) {
      const rgb = { r: clampByte(nums[0]), g: clampByte(nums[1]), b: clampByte(nums[2]) };
      return { rgb, format: 'rgb', error: '' };
    }
    // 否则可能是 HSL/HSV：第一个值 0-360，后两值带 % 时按 HSL/HSV
    return { rgb: null, format: null, error: '无法识别格式，请加前缀如 rgb() / hsl() / hsv() / cmyk() 或使用 #hex' };
  }
  if (nums.length === 4) {
    // 假设 CMYK：四值均 0-100
    if (nums.every((n) => n >= 0 && n <= 100)) {
      const rgb = cmykToRgb({ c: nums[0], m: nums[1], y: nums[2], k: nums[3] });
      return { rgb, format: 'cmyk', error: '' };
    }
    return { rgb: null, format: null, error: '无法识别格式，请加前缀 cmyk() 或使用 #hex' };
  }

  return { rgb: null, format: null, error: '无法识别的颜色格式，支持 #hex / rgb() / hsl() / hsv() / cmyk()' };
}

/**
 * 计算颜色的相对亮度（WCAG 标准）
 * 用于判断文字在当前色背景上应使用黑还是白
 */
function relativeLuminance({ r, g, b }: RGB): number {
  const channel = (n: number) => {
    const c = n / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** 判断颜色是亮色还是暗色（决定预览区文字颜色） */
function isLight(rgb: RGB): boolean {
  return relativeLuminance(rgb) > 0.4;
}

/** 生成调色板：基于当前 HSL 的色相旋转，保持饱和度与亮度不变 */
function generatePalette(rgb: RGB, type: HarmonyType): RGB[] {
  const hsl = rgbToHsl(rgb);
  return HARMONY_ROTATIONS[type].map((delta) =>
    hslToRgb({ h: hsl.h + delta, s: hsl.s, l: hsl.l })
  );
}


export default function ColorTool() {
  const [input, setInput] = useState<string>('');
  const [rgb, setRgb] = useState<RGB | null>(null);
  const [notice, setNotice] = useState<string>('');
  const [copiedFormat, setCopiedFormat] = useState<FormatKey | null>(null);

  /** 实时解析输入 */
  const parsed = useMemo(() => {
    if (input.trim() === '') return { rgb: null, format: null, error: '' };
    return parseInput(input);
  }, [input]);

  // 当前生效的 RGB（输入解析成功则用解析值，否则用上次保存的 rgb，再否则 null）
  const currentRgb = parsed.rgb || rgb;

  // 各格式派生值
  const formats = useMemo(() => {
    if (!currentRgb) return null;
    const hsl = rgbToHsl(currentRgb);
    const hsv = rgbToHsv(currentRgb);
    const cmyk = rgbToCmyk(currentRgb);
    return {
      hex: formatHex(currentRgb),
      rgb: formatRgb(currentRgb),
      hsl: formatHsl(hsl),
      hsv: formatHsv(hsv),
      cmyk: formatCmyk(cmyk),
    };
  }, [currentRgb]);

  // 调色板（5 种和谐方案，仅在有颜色时生成）
  const palettes = useMemo(() => {
    if (!currentRgb) return null;
    const hsl = rgbToHsl(currentRgb);
    const types: HarmonyType[] = ['complementary', 'analogous', 'triadic', 'splitComplement', 'tetradic'];
    return types.map((t) => ({
      type: t,
      meta: HARMONY_META[t],
      colors: generatePalette(currentRgb, t),
    }));
  }, [currentRgb]);

  // 输入超限提示
  const overLimit = input.length > MAX_INPUT_LENGTH;

  /** 载入示例 */
  const handleSample = useCallback(() => {
    setInput(formatHex(SAMPLE_COLOR));
    setRgb(SAMPLE_COLOR);
    setNotice('');
    setCopiedFormat(null);
  }, []);

  /** 清空 */
  const handleClear = useCallback(() => {
    setInput('');
    setRgb(null);
    setNotice('');
    setCopiedFormat(null);
  }, []);

  /** 拾色器变化：直接设置 RGB 与输入为 HEX */
  const handlePicker = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const hex = e.target.value;
    const newRgb = hexToRgb(hex);
    setInput(hex);
    setRgb(newRgb);
    setCopiedFormat(null);
  }, []);

  /** 复制指定格式 */
  const handleCopy = useCallback(async (format: FormatKey) => {
    if (!formats) return;
    const text = formats[format];
    const ok = await copyText(text);
    if (ok) {
      setCopiedFormat(format);
      setNotice(`已复制 ${text}`);
      setTimeout(() => {
        setCopiedFormat(null);
        setNotice('');
      }, 1500);
    } else {
      setNotice('复制失败，请手动选中复制');
    }
  }, [formats]);

  /** 复制调色板中的某个颜色 */
  const handleCopyPalette = useCallback(async (color: RGB) => {
    const hex = formatHex(color);
    const ok = await copyText(hex);
    if (ok) {
      setNotice(`已复制 ${hex}`);
      setTimeout(() => setNotice(''), 1500);
    } else {
      setNotice('复制失败，请手动选中复制');
    }
  }, []);

  /** 点击调色板色块：设置为当前颜色 */
  const handlePickPalette = useCallback((color: RGB) => {
    setInput(formatHex(color));
    setRgb(color);
    setCopiedFormat(null);
  }, []);

  const hasInput = input.trim() !== '';
  const isCurrentLight = currentRgb ? isLight(currentRgb) : true;

  // 提示信息片段
  const hintParts: string[] = ['输入即自动识别，支持 #hex / rgb() / hsl() / hsv() / cmyk()。'];
  if (hasInput) hintParts.push(`（${input.length} 字符）`);
  if (overLimit) hintParts.push(` 已超上限（${MAX_INPUT_LENGTH}），仅解析前 ${MAX_INPUT_LENGTH} 字符`);

  // 用于预览的当前 HEX 字符串
  const currentHex = currentRgb ? formatHex(currentRgb) : '#ffffff';
  // 文字色：根据背景亮度决定黑/白
  const textColor = isCurrentLight ? '#1f2937' : '#ffffff';

  return (
    <div className="jsontool colortool">
      {/* 输入区 */}
      <div className="colortool__input-area">
        <div className="colortool__input-head">
          <label htmlFor="color-input" className="colortool__label">颜色值</label>
          <div className="jsontool__actions">
            <button type="button" className="btn btn--sm" onClick={handleSample}>示例</button>
            <button type="button" className="btn btn--sm" onClick={handleClear}>清空</button>
          </div>
        </div>
        <div className="colortool__input-row">
          {/* 拾色器：input[type=color] 原生组件，支持点击取色 */}
          <input
            type="color"
            className="colortool__picker"
            value={currentHex}
            onChange={handlePicker}
            aria-label="拾取颜色"
          />
          <input
            id="color-input"
            type="text"
            className="colortool__input"
            placeholder="#2b6cff 或 rgb(43, 108, 255)"
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, MAX_INPUT_LENGTH))}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            aria-describedby="color-input-hint"
          />
        </div>
        <p id="color-input-hint" className="colortool__hint">{hintParts.join('')}</p>
      </div>

      {/* 解析错误提示 */}
      {hasInput && !parsed.rgb && !rgb && parsed.error && (
        <div className="colortool__error" role="alert">
          <strong>解析失败：</strong>{parsed.error}
        </div>
      )}

      {/* 颜色预览区 + 五格式输出 */}
      {currentRgb && formats && (
        <>
          <div className="colortool__preview-row">
            {/* 大色块预览：背景为当前色，文字色按亮度自适应 */}
            <div
              className="colortool__preview"
              style={{ backgroundColor: currentHex, color: textColor }}
            >
              <span className="colortool__preview-hex">{formats.hex.toUpperCase()}</span>
              <span className="colortool__preview-rgb">{formats.rgb}</span>
            </div>
            {/* 渐变预览：当前色 → 白 / 当前色 → 黑，便于查看明暗变化 */}
            <div className="colortool__gradients">
              <div
                className="colortool__gradient"
                style={{ background: `linear-gradient(to right, ${currentHex}, #ffffff)` }}
                title="当前色到白色的渐变"
              />
              <div
                className="colortool__gradient"
                style={{ background: `linear-gradient(to right, ${currentHex}, #000000)` }}
                title="当前色到黑色的渐变"
              />
            </div>
          </div>

          {/* 五种格式输出列表 */}
          <ul className="colortool__formats" aria-label="五种颜色格式">
            {([
              { key: 'hex' as FormatKey, label: 'HEX', desc: '网页标准十六进制', value: formats.hex },
              { key: 'rgb' as FormatKey, label: 'RGB', desc: '红绿蓝加色模型（0-255）', value: formats.rgb },
              { key: 'hsl' as FormatKey, label: 'HSL', desc: '色相 / 饱和度 / 亮度', value: formats.hsl },
              { key: 'hsv' as FormatKey, label: 'HSV', desc: '色相 / 饱和度 / 明度（Photoshop 取色器）', value: formats.hsv },
              { key: 'cmyk' as FormatKey, label: 'CMYK', desc: '青 / 品红 / 黄 / 黑（印刷四色）', value: formats.cmyk },
            ]).map((item) => (
              <li key={item.key} className="colortool__format">
                <div className="colortool__format-head">
                  <span className="colortool__format-label">{item.label}</span>
                  <span className="colortool__format-desc">{item.desc}</span>
                </div>
                <code className="colortool__format-value">{item.value}</code>
                <button
                  type="button"
                  className="colortool__copy-btn"
                  onClick={() => handleCopy(item.key)}
                  aria-label={`复制 ${item.label} 格式`}
                >{copiedFormat === item.key ? '已复制' : '复制'}</button>
              </li>
            ))}
          </ul>

          {/* 调色板：5 种和谐方案 */}
          {palettes && (
            <div className="colortool__palettes" aria-label="和谐配色方案">
              <h3 className="colortool__palettes-title">配色方案</h3>
              <p className="colortool__palettes-desc">
                基于当前颜色的色相旋转生成和谐配色，点击色块设为当前色，长按或右侧按钮复制 HEX。
              </p>
              {palettes.map((p) => (
                <div key={p.type} className="colortool__palette">
                  <div className="colortool__palette-meta">
                    <span className="colortool__palette-name">{p.meta.label}</span>
                    <span className="colortool__palette-hint">{p.meta.desc}</span>
                  </div>
                  <ul className="colortool__palette-colors" role="list">
                    {p.colors.map((c, i) => {
                      const hex = formatHex(c);
                      const light = isLight(c);
                      return (
                        <li
                          key={i}
                          className="colortool__palette-color"
                          style={{ backgroundColor: hex, color: light ? '#1f2937' : '#fff' }}
                          onClick={() => handlePickPalette(c)}
                          title={`点击设为当前色：${hex}`}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handlePickPalette(c);
                            }
                          }}
                        >
                          <span className="colortool__palette-hex">{hex}</span>
                          <button
                            type="button"
                            className="colortool__palette-copy"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyPalette(c);
                            }}
                            aria-label={`复制 ${hex}`}
                          >复制</button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* 状态提示 */}
      {notice && (
        <div className="colortool__notice" role="status" aria-live="polite">{notice}</div>
      )}
    </div>
  );
}
