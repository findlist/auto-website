/**
 * 调色板生成与导出算法库
 *
 * 设计目标：
 *  - 基于 HSL 色环理论生成 6 种和谐配色方案
 *  - 生成明度阶梯（Tints / Shades / Tones）与设计系统色阶（Tailwind 50-950 / Material 100-900）
 *  - WCAG 2.1 对比度计算，判定文字色合规等级
 *  - 三种色盲模拟（红色盲 / 绿色盲 / 蓝色盲）辅助可访问性检查
 *  - 多格式导出：CSS 变量 / Tailwind 配置 / SCSS / JSON / Android XML / iOS UIColor
 *  - 纯原生 TypeScript，零第三方依赖，全本地处理
 *
 * 与 ColorTool 的差异定位：
 *  - ColorTool 侧重颜色格式互转（HEX/RGB/HSL/HSV/CMYK）+ 简单和谐方案
 *  - 本工具侧重调色板生成、设计系统色阶、可访问性检查、多格式导出
 */

/** RGB 颜色：0-255 整数 */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** HSL 颜色：h 为 0-360，s/l 为 0-100 */
export interface HSL {
  h: number;
  s: number;
  l: number;
}

/** 和谐方案类型 */
export type HarmonyType =
  | 'complementary' // 互补色：180° 对比
  | 'analogous' // 类似色：±30° 邻近
  | 'triadic' // 三角色：±120° 平衡
  | 'splitComplement' // 分割互补：180°±30°
  | 'tetradic' // 四角色：±90°/±180°
  | 'monochromatic'; // 单色阶：同色相不同明度

/** 色调类型：明度阶梯生成方式 */
export type ToneType = 'tints' | 'shades' | 'tones';

/** 色盲类型 */
export type ColorBlindType = 'protanopia' | 'deuteranopia' | 'tritanopia';

/** 设计系统色阶规范 */
export type ScaleStandard = 'tailwind' | 'material';

/** 导出格式 */
export type ExportFormat =
  | 'css' // CSS 自定义属性 :root { --color-50: #xxx; }
  | 'tailwind' // tailwind.config.js theme.extend.colors
  | 'scss' // SCSS 变量 $color-50: #xxx;
  | 'json' // JSON 键值对
  | 'android' // Android colors.xml
  | 'ios'; // iOS UIColor 扩展

/** 和谐方案元数据 */
export const HARMONY_META: Record<HarmonyType, { label: string; desc: string; rotations: number[] }> = {
  complementary: { label: '互补色', desc: '色环 180° 对比，强调效果强烈', rotations: [0, 180] },
  analogous: { label: '类似色', desc: '±30° 邻近色，和谐柔顺', rotations: [-30, 0, 30] },
  triadic: { label: '三角色', desc: '±120° 三色，平衡活泼', rotations: [0, 120, 240] },
  splitComplement: { label: '分割互补', desc: '180°±30°，对比但不刺眼', rotations: [0, 150, 210] },
  tetradic: { label: '四角色', desc: '±90°/±180° 四色，丰富多样', rotations: [0, 90, 180, 270] },
  monochromatic: { label: '单色阶', desc: '同色相不同明度，统一沉稳', rotations: [0] },
};

/** 色调类型元数据 */
export const TONE_META: Record<ToneType, { label: string; desc: string }> = {
  tints: { label: '明色（Tints）', desc: '加白变亮，适合背景与悬停态' },
  shades: { label: '暗色（Shades）', desc: '加黑变暗，适合按下态与边框' },
  tones: { label: '浊色（Tones）', desc: '加灰降饱和，适合次要元素' },
};

/** 色盲类型元数据 */
export const COLOR_BLIND_META: Record<ColorBlindType, { label: string; desc: string }> = {
  protanopia: { label: '红色盲', desc: '约 1% 男性，红色感知缺失' },
  deuteranopia: { label: '绿色盲', desc: '约 1% 男性，绿色感知缺失（最常见）' },
  tritanopia: { label: '蓝色盲', desc: '极罕见，蓝色感知缺失' },
};

/** Tailwind 色阶档位（50-950 共 11 档） */
export const TAILWIND_SCALE = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

/** Material Design 色阶档位（100-900 共 10 档） */
export const MATERIAL_SCALE = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

/** 输入长度上限 */
export const MAX_INPUT_LENGTH = 200;

/* ============================================================
 * 基础颜色转换：RGB / HSL / HEX 互转
 * ============================================================ */

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
export function hexToRgb(hex: string): RGB | null {
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.startsWith('0x') || h.startsWith('0X')) h = h.slice(2);
  if (h.length === 3) {
    h = `${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  }
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** RGB → HEX：输出 #rrggbb 小写 */
export function rgbToHex({ r, g, b }: RGB): string {
  const toHex = (n: number) => clampByte(n).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** RGB → HSL（标准转换公式） */
export function rgbToHsl({ r, g, b }: RGB): HSL {
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
export function hslToRgb({ h, s, l }: HSL): RGB {
  const hN = clampHue(h) / 360;
  const sN = clampPercent(s) / 100;
  const lN = clampPercent(l) / 100;
  if (sN === 0) {
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

/* ============================================================
 * 调色板生成：和谐方案 + 明度色调 + 设计系统色阶
 * ============================================================ */

/**
 * 生成和谐配色方案
 * 原理：基于 HSL 色相旋转，保持饱和度与亮度不变
 * 单色阶方案特殊处理：同色相不同明度
 */
export function generateHarmony(rgb: RGB, type: HarmonyType): RGB[] {
  const hsl = rgbToHsl(rgb);
  if (type === 'monochromatic') {
    // 单色阶：同色相，明度 20/40/55/70/85 共 5 档
    return [20, 40, 55, 70, 85].map((l) => hslToRgb({ h: hsl.h, s: hsl.s, l }));
  }
  return HARMONY_META[type].rotations.map((delta) =>
    hslToRgb({ h: hsl.h + delta, s: hsl.s, l: hsl.l })
  );
}

/**
 * 生成明度色调阶梯
 *  - tints：加白（明度提升）
 *  - shades：加黑（明度降低）
 *  - tones：加灰（饱和度降低）
 * 返回 5 档阶梯，从当前色向目标方向渐进
 */
export function generateTones(rgb: RGB, type: ToneType, steps = 5): RGB[] {
  const hsl = rgbToHsl(rgb);
  const result: RGB[] = [];
  for (let i = 0; i < steps; i++) {
    const factor = (i + 1) / (steps + 1);
    if (type === 'tints') {
      // 向纯白渐变：明度提升，饱和度略降
      const l = hsl.l + (100 - hsl.l) * factor;
      const s = hsl.s * (1 - factor * 0.3);
      result.push(hslToRgb({ h: hsl.h, s, l }));
    } else if (type === 'shades') {
      // 向纯黑渐变：明度降低
      const l = hsl.l * (1 - factor);
      result.push(hslToRgb({ h: hsl.h, s: hsl.s, l }));
    } else {
      // 向纯灰渐变：饱和度降低
      const s = hsl.s * (1 - factor * 0.7);
      result.push(hslToRgb({ h: hsl.h, s, l: hsl.l }));
    }
  }
  return result;
}

/**
 * 生成设计系统色阶
 *  - tailwind：50/100/200/.../950 共 11 档，500 为主色
 *  - material：50/100/200/.../900 共 10 档，500 为主色
 *
 * 算法：以输入色为 500 锚点，向亮端（50）提升明度+降低饱和度，向暗端（950）降低明度+略提升饱和度
 */
export function generateScale(rgb: RGB, standard: ScaleStandard): { level: number; rgb: RGB }[] {
  const hsl = rgbToHsl(rgb);
  const scale = standard === 'tailwind' ? TAILWIND_SCALE : MATERIAL_SCALE;
  // 各档位相对 500 的明度偏移与饱和度系数（经验值，参考 Tailwind/Material 官方色阶规律）
  const adjustments: Record<number, { lDelta: number; sFactor: number }> = {
    50: { lDelta: 42, sFactor: 0.7 },
    100: { lDelta: 35, sFactor: 0.75 },
    200: { lDelta: 27, sFactor: 0.82 },
    300: { lDelta: 18, sFactor: 0.88 },
    400: { lDelta: 8, sFactor: 0.95 },
    500: { lDelta: 0, sFactor: 1 },
    600: { lDelta: -8, sFactor: 1.02 },
    700: { lDelta: -16, sFactor: 1.05 },
    800: { lDelta: -24, sFactor: 1.08 },
    900: { lDelta: -32, sFactor: 1.1 },
    950: { lDelta: -42, sFactor: 1.15 },
  };
  return scale.map((level) => {
    const adj = adjustments[level] || adjustments[500];
    const l = clampPercent(hsl.l + adj.lDelta);
    const s = clampPercent(hsl.s * adj.sFactor);
    return { level, rgb: hslToRgb({ h: hsl.h, s, l }) };
  });
}

/* ============================================================
 * 可访问性：WCAG 对比度 + 色盲模拟
 * ============================================================ */

/** 计算颜色的相对亮度（WCAG 2.1 标准） */
export function relativeLuminance({ r, g, b }: RGB): number {
  const channel = (n: number) => {
    const c = n / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * 计算两色对比度（WCAG 2.1 公式）
 * 返回 1-21 的比值，1 表示无对比，21 表示黑白最大对比
 */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG 合规等级判定 */
export function wcagLevel(ratio: number, largeText = false): 'AAA' | 'AA' | 'AA Large' | 'Fail' {
  if (largeText) {
    if (ratio >= 4.5) return 'AAA';
    if (ratio >= 3) return 'AA Large';
    return 'Fail';
  }
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  return 'Fail';
}

/** 判断颜色是亮色还是暗色（决定预览文字色） */
export function isLightColor(rgb: RGB): boolean {
  return relativeLuminance(rgb) > 0.4;
}

/**
 * 色盲模拟：通过线性 RGB 变换矩阵模拟色盲视觉
 * 矩阵来源：Brettel et al. (1997) 与 Machado et al. (2009) 研究
 */
export function simulateColorBlind(rgb: RGB, type: ColorBlindType): RGB {
  // 转线性 RGB（反 gamma）
  const toLinear = (n: number) => {
    const c = n / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  // 转 sRGB（重新 gamma）
  const toSrgb = (n: number) => {
    const c = n <= 0.0031308 ? n * 12.92 : 1.055 * Math.pow(n, 1 / 2.4) - 0.055;
    return clampByte(c * 255);
  };
  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);
  // 三种色盲的变换矩阵（Machado 2009 简化版）
  const matrices: Record<ColorBlindType, number[]> = {
    // 红色盲
    protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
    // 绿色盲
    deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.011820, 0.042940, 0.968881],
    // 蓝色盲
    tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.303900],
  };
  const m = matrices[type];
  const nr = m[0] * r + m[1] * g + m[2] * b;
  const ng = m[3] * r + m[4] * g + m[5] * b;
  const nb = m[6] * r + m[7] * g + m[8] * b;
  return { r: toSrgb(nr), g: toSrgb(ng), b: toSrgb(nb) };
}

/* ============================================================
 * 输入解析
 * ============================================================ */

/** 输入解析结果 */
export interface ParseResult {
  rgb: RGB | null;
  error: string;
}

/**
 * 解析颜色输入字符串
 * 支持 #hex / rgb() / hsl() / 裸 RGB 三数字
 */
export function parseColorInput(input: string): ParseResult {
  const trimmed = input.trim();
  if (trimmed === '') return { rgb: null, error: '请输入颜色值' };
  const lower = trimmed.toLowerCase();
  // HEX
  if (lower.startsWith('#') || /^[0-9a-f]{3}$/.test(lower) || /^[0-9a-f]{6}$/.test(lower)) {
    const rgb = hexToRgb(trimmed);
    if (rgb) return { rgb, error: '' };
    return { rgb: null, error: 'HEX 格式应为 #RRGGBB 或 #RGB' };
  }
  // 提取数字
  const nums = (trimmed.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  // rgb()
  if (lower.startsWith('rgb') && nums.length >= 3) {
    return { rgb: { r: clampByte(nums[0]), g: clampByte(nums[1]), b: clampByte(nums[2]) }, error: '' };
  }
  // hsl()
  if (lower.startsWith('hsl') && nums.length >= 3) {
    return {
      rgb: hslToRgb({ h: clampHue(nums[0]), s: clampPercent(nums[1]), l: clampPercent(nums[2]) }),
      error: '',
    };
  }
  // 裸 RGB 三数字
  if (nums.length === 3 && nums.every((n) => n >= 0 && n <= 255)) {
    return { rgb: { r: clampByte(nums[0]), g: clampByte(nums[1]), b: clampByte(nums[2]) }, error: '' };
  }
  return { rgb: null, error: '无法识别格式，支持 #hex / rgb() / hsl()' };
}

/* ============================================================
 * 多格式导出
 * ============================================================ */

/**
 * 将色阶导出为指定格式字符串
 * @param scale 色阶数组（generateScale 返回值）
 * @param name 颜色名（如 'primary'），用于变量命名
 * @param format 导出格式
 */
export function exportScale(
  scale: { level: number; rgb: RGB }[],
  name: string,
  format: ExportFormat
): string {
  const hexMap = scale.map(({ level, rgb }) => ({ level, hex: rgbToHex(rgb) }));
  switch (format) {
    case 'css':
      return `:root {\n${hexMap
        .map(({ level, hex }) => `  --${name}-${level}: ${hex};`)
        .join('\n')}\n}`;
    case 'tailwind':
      return `// tailwind.config.js\nmodule.exports = {\n  theme: {\n    extend: {\n      colors: {\n        ${name}: {\n${hexMap
        .map(({ level, hex }) => `          ${level}: '${hex}',`)
        .join('\n')}\n        }\n      }\n    }\n  }\n};`;
    case 'scss':
      return hexMap.map(({ level, hex }) => `$${name}-${level}: ${hex};`).join('\n');
    case 'json':
      return JSON.stringify(
        Object.fromEntries(hexMap.map(({ level, hex }) => [String(level), hex])),
        null,
        2
      );
    case 'android':
      return `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${hexMap
        .map(({ level, hex }) => `  <color name="${name}_${level}">${hex.toUpperCase()}</color>`)
        .join('\n')}\n</resources>`;
    case 'ios': {
      // iOS UIColor 扩展：返回 Swift 代码
      const lines = hexMap.map(({ level, rgb }) => {
        const r = (rgb.r / 255).toFixed(3);
        const g = (rgb.g / 255).toFixed(3);
        const b = (rgb.b / 255).toFixed(3);
        return `    static var ${name}${level}: UIColor { UIColor(red: ${r}, green: ${g}, blue: ${b}, alpha: 1.0) }`;
      });
      return `extension UIColor {\n${lines.join('\n')}\n}`;
    }
    default:
      return '';
  }
}

/**
 * 导出和谐方案为 CSS 变量
 * @param colors 和谐方案颜色数组
 * @param name 变量名前缀
 */
export function exportHarmonyAsCss(colors: RGB[], name: string): string {
  return `:root {\n${colors
    .map((rgb, i) => `  --${name}-${i + 1}: ${rgbToHex(rgb)};`)
    .join('\n')}\n}`;
}

/* ============================================================
 * 随机配色生成
 * ============================================================ */

/**
 * 生成随机和谐配色
 * 算法：黄金角度（137.508°）旋转采样，保证色相分布均匀
 */
export function randomHarmony(count = 5): RGB[] {
  const goldenAngle = 137.508;
  const startH = Math.floor(Math.random() * 360);
  const s = 60 + Math.floor(Math.random() * 30); // 60-90 饱和度
  const l = 45 + Math.floor(Math.random() * 15); // 45-60 亮度
  const result: RGB[] = [];
  for (let i = 0; i < count; i++) {
    const h = (startH + i * goldenAngle) % 360;
    result.push(hslToRgb({ h, s, l }));
  }
  return result;
}
