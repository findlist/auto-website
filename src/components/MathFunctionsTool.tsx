import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS 数学函数生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 完整支持 9 个 CSS Values Level 4 数学函数：
 *    exp / log / sqrt / pow / abs / sign / mod / rem / round
 *  - 8 组预设场景：指数缩放 / 对数刻度 / 平方根渐变 / 幂律缓动 /
 *    绝对值镜像 / 模运算循环条纹 / 取整对齐 / rem 余数符号差异
 *  - 参数实时调节（range 滑块）
 *  - iframe 沙箱预览：真实渲染生成的 CSS，sandbox="allow-same-origin" 隔离
 *  - 函数速查表：语法 / 参数 / 返回值 / 浏览器支持
 *  - 一键复制生成的 CSS 代码
 *
 * 核心知识点（CSS Values Module Level 4）：
 *  - exp(x) 等价于 pow(e(), x)，参数为无单位数值，返回无单位数值
 *  - log(x, base?) 默认以 e 为底，可用 log(x, 10) 计算常用对数
 *  - sqrt(x) 等价于 pow(x, 0.5)
 *  - pow(x, y) x 与 y 均为无单位数值
 *  - abs() / sign() 接受任意数值，sign 返回 -1 / 0 / 1
 *  - mod(x, y) 结果符号与 y 相同；rem(x, y) 结果符号与 x 相同
 *  - round(<策略>, x, step?) 策略：nearest / to-zero / up / down
 *  - 浏览器支持：Chrome 128+ / Firefox 128+ / Safari 16.4+（Baseline 2024）
 */

/** 数学函数名 */
type MathFunc = 'exp' | 'log' | 'sqrt' | 'pow' | 'abs' | 'sign' | 'mod' | 'rem' | 'round';

/** 参数定义（用于预设的滑块控件） */
interface Param {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
}

/** 预设场景定义 */
interface Preset {
  id: string;
  name: string;
  description: string;
  funcs: MathFunc[];                                // 该预设展示的核心函数
  params: Param[];                                  // 可调参数
  buildCss: (values: Record<string, number>) => string;       // 生成 CSS
  buildPreviewHtml: (values: Record<string, number>) => string; // 生成 iframe 预览 HTML
}

/** 函数速查表数据 */
const FUNC_REFERENCE: { name: MathFunc; syntax: string; desc: string; range: string }[] = [
  { name: 'exp', syntax: 'exp(<x>)', desc: '自然常数 e 的 x 次方，e ≈ 2.71828', range: '返回 (0, +∞)' },
  { name: 'log', syntax: 'log(<x>, <base>?)', desc: '对数，省略 base 时为自然对数 ln', range: '返回 (-∞, +∞)' },
  { name: 'sqrt', syntax: 'sqrt(<x>)', desc: '平方根，等价于 pow(x, 0.5)', range: '返回 [0, +∞)' },
  { name: 'pow', syntax: 'pow(<x>, <y>)', desc: 'x 的 y 次方', range: '返回 (-∞, +∞)' },
  { name: 'abs', syntax: 'abs(<x>)', desc: '绝对值，去除符号', range: '返回 [0, +∞)' },
  { name: 'sign', syntax: 'sign(<x>)', desc: '符号函数，判断正负零', range: '返回 {-1, 0, 1}' },
  { name: 'mod', syntax: 'mod(<x>, <y>)', desc: '模运算，结果符号与 y 相同', range: '符号同 y' },
  { name: 'rem', syntax: 'rem(<x>, <y>)', desc: '余数，结果符号与 x 相同', range: '符号同 x' },
  { name: 'round', syntax: 'round(<策略>, <x>, <step>?)', desc: '按策略取整，策略可选 nearest/to-zero/up/down', range: '返回 step 整数倍' },
];

/** 8 组预设场景 */
const PRESETS: Preset[] = [
  {
    id: 'exp-scale',
    name: '指数缩放',
    description: 'exp() 让字号随标题级别指数增长，h1 比 h6 大 e 倍以上',
    funcs: ['exp', 'pow'],
    params: [
      { key: 'base', label: '基础字号', min: 12, max: 24, step: 1, default: 16, unit: 'px' },
      { key: 'step', label: '级别指数因子', min: 0.2, max: 1.2, step: 0.1, default: 0.6 },
    ],
    buildCss: (v) => `/* 标题字号指数增长：每升一级 ×e^(step)
   h1=base*exp(3*step) h2=base*exp(2*step) ... h6=base */
.heading {
  --base: ${v.base};
  --step: ${v.step};
}
.heading h1 { font-size: calc(var(--base) * exp(calc(3 * var(--step)))); }
.heading h2 { font-size: calc(var(--base) * exp(calc(2 * var(--step)))); }
.heading h3 { font-size: calc(var(--base) * exp(var(--step))); }
.heading h4 { font-size: calc(var(--base) * exp(calc(-1 * var(--step)))); }
.heading h5 { font-size: calc(var(--base) * exp(calc(-2 * var(--step)))); }
.heading h6 { font-size: var(--base); }`,
    buildPreviewHtml: (v) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<style>
  body { margin:0; padding:20px; font-family:-apple-system,sans-serif; background:#f8fafc; color:#1e293b; }
  .heading { --base:${v.base}px; --step:${v.step}; }
  .heading h1 { font-size:calc(var(--base) * exp(calc(3 * var(--step)))); margin:8px 0; font-weight:700; }
  .heading h2 { font-size:calc(var(--base) * exp(calc(2 * var(--step)))); margin:8px 0; font-weight:700; }
  .heading h3 { font-size:calc(var(--base) * exp(var(--step))); margin:8px 0; font-weight:600; }
  .heading h4 { font-size:calc(var(--base) * exp(calc(-1 * var(--step)))); margin:8px 0; font-weight:600; color:#475569; }
  .heading h5 { font-size:calc(var(--base) * exp(calc(-2 * var(--step)))); margin:8px 0; font-weight:500; color:#64748b; }
  .heading h6 { font-size:var(--base); margin:8px 0; font-weight:500; color:#94a3b8; }
  .label { text-align:center; color:#64748b; font-size:12px; margin-top:12px; }
</style></head>
<body>
  <div class="heading">
    <h1>一级标题</h1>
    <h2>二级标题</h2>
    <h3>三级标题</h3>
    <h4>四级标题</h4>
    <h5>五级标题</h5>
    <h6>六级标题</h6>
  </div>
  <p class="label">exp(${v.step}) ≈ ${Math.exp(v.step).toFixed(3)}（每级倍率）</p>
</body></html>`,
  },
  {
    id: 'log-scale',
    name: '对数刻度',
    description: 'log() 把大数值压缩为对数刻度，常用于进度条/数据可视化',
    funcs: ['log'],
    params: [
      { key: 'max', label: '最大值', min: 100, max: 10000, step: 100, default: 1000 },
      { key: 'current', label: '当前值', min: 10, max: 10000, step: 10, default: 500 },
    ],
    buildCss: (v) => `/* 对数刻度进度条：把 1..max 的值压缩到 0..100%
   log(current) / log(max) 即对数比例 */
.bar {
  --max: ${v.max};
  --current: ${v.current};
  width: 100%;
  height: 24px;
  background: #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
}
.bar__fill {
  width: calc(log(var(--current)) / log(var(--max)) * 100%);
  height: 100%;
  background: linear-gradient(90deg, #2563eb, #06b6d4);
  transition: width 0.3s;
}`,
    buildPreviewHtml: (v) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<style>
  body { margin:0; padding:24px; font-family:-apple-system,sans-serif; background:#f8fafc; }
  .bar { --max:${v.max}; --current:${v.current};
    width:100%; height:24px; background:#e2e8f0; border-radius:12px; overflow:hidden; }
  .bar__fill { width:calc(log(var(--current)) / log(var(--max)) * 100%); height:100%;
    background:linear-gradient(90deg,#2563eb,#06b6d4); transition:width 0.3s; }
  .bar__fill--linear { width:calc(var(--current) / var(--max) * 100%); }
  .label { display:flex; justify-content:space-between; color:#475569; font-size:12px; margin:4px 0 16px; }
  .title { font-size:13px; font-weight:600; color:#1e293b; margin:8px 0 4px; }
</style></head>
<body>
  <div class="title">对数刻度（更直观反映数量级差异）</div>
  <div class="bar"><div class="bar__fill"></div></div>
  <div class="label"><span>0</span><span>当前 ${v.current} / 最大 ${v.max}</span><span>${v.max}</span></div>

  <div class="title">线性刻度（对比）</div>
  <div class="bar"><div class="bar__fill bar__fill--linear"></div></div>
  <div class="label"><span>0</span><span>${(v.current / v.max * 100).toFixed(1)}%</span><span>${v.max}</span></div>
</body></html>`,
  },
  {
    id: 'sqrt-gradient',
    name: '平方根渐变',
    description: 'sqrt() 让径向渐变半径随元素数量平方根增长，避免拥挤',
    funcs: ['sqrt', 'pow'],
    params: [
      { key: 'count', label: '渐变层数', min: 2, max: 12, step: 1, default: 6 },
      { key: 'base', label: '基础半径', min: 10, max: 60, step: 2, default: 30, unit: 'px' },
    ],
    buildCss: (v) => `/* 多层径向渐变，半径按 sqrt(i) 增长
   sqrt 平方根增长比线性慢，形成视觉聚焦 */
.target {
  position: relative;
  width: 200px;
  height: 200px;
  background:
${Array.from({ length: v.count }, (_, i) => {
  const r = v.base * Math.sqrt(i + 1);
  const color = `hsl(${(i * 360) / v.count}, 70%, 55%)`;
  return `    radial-gradient(circle, ${color} 0 ${r.toFixed(1)}px, transparent ${r.toFixed(1)}px)`;
}).join(',\n')};
  border-radius: 50%;
}`,
    buildPreviewHtml: (v) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<style>
  body { margin:0; padding:24px; font-family:-apple-system,sans-serif; background:#f8fafc; }
  .target { position:relative; width:200px; height:200px; margin:0 auto;
    background:
${Array.from({ length: v.count }, (_, i) => {
  const r = v.base * Math.sqrt(i + 1);
  const color = `hsl(${(i * 360) / v.count}, 70%, 55%)`;
  return `    radial-gradient(circle, ${color} 0 ${r.toFixed(1)}px, transparent ${r.toFixed(1)}px)`;
}).join(',\n')};
    border-radius:50%; }
  .label { text-align:center; color:#64748b; font-size:12px; margin-top:8px; }
</style></head>
<body>
  <div class="target"></div>
  <p class="label">${v.count} 层径向渐变，半径 sqrt(i) × ${v.base}px</p>
</body></html>`,
  },
  {
    id: 'pow-easing',
    name: '幂律缓动',
    description: 'pow() 实现可调节的缓动曲线，替代 cubic-bezier 数值估算',
    funcs: ['pow'],
    params: [
      { key: 'exponent', label: '幂指数', min: 0.5, max: 5, step: 0.1, default: 2.5 },
      { key: 'duration', label: '动画时长', min: 1, max: 5, step: 0.5, default: 2, unit: 's' },
    ],
    buildCss: (v) => `/* 幂律缓动：pow(t, k) 控制非线性进度
   k>1 先慢后快，k<1 先快后慢
   通过 @property --t 注册时间变量，让 keyframes 可平滑插值 */
@property --t {
  syntax: '<number>';
  inherits: false;
  initial-value: 0;
}
.eased {
  --t: 0;
  /* 计算位移：pow(t, ${v.exponent}) × 200px */
  transform: translateX(calc(pow(var(--t), ${v.exponent}) * 200px));
  animation: tick ${v.duration}s ease-in-out infinite alternate;
}
@keyframes tick {
  to { --t: 1; }
}`,
    buildPreviewHtml: (v) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<style>
  body { margin:0; padding:24px; font-family:-apple-system,sans-serif; background:#f8fafc; }
  .track { position:relative; width:240px; height:40px;
    background:#e2e8f0; border-radius:20px; margin:0 auto; overflow:hidden; }
  /* 用 keyframes 直接做幂律效果，预览无需 @property */
  .ball { position:absolute; left:0; top:4px; width:32px; height:32px;
    border-radius:50%; background:linear-gradient(135deg,#2563eb,#06b6d4);
    animation: tick ${v.duration}s ease-in-out infinite alternate; }
  /* 用 cubic-bezier 近似 pow(t, ${v.exponent})：k 越大越先慢后快 */
  @keyframes tick {
    from { left: 0; }
    to { left: 208px; }
  }
  .ball { animation-timing-function: cubic-bezier(${(0.5).toFixed(3)}, ${(v.exponent / 4).toFixed(3)}, ${(0.5).toFixed(3)}, 1); }
  .label { text-align:center; color:#64748b; font-size:12px; margin-top:8px; }
</style></head>
<body>
  <div class="track"><div class="ball"></div></div>
  <p class="label">pow(t, ${v.exponent}) × ${v.duration}s（cubic-bezier 近似预览）</p>
</body></html>`,
  },
  {
    id: 'abs-mirror',
    name: '绝对值镜像',
    description: 'abs() 把负值转为正值，实现左右对称布局',
    funcs: ['abs', 'sign'],
    params: [
      { key: 'offset', label: '基础偏移', min: 20, max: 120, step: 5, default: 80, unit: 'px' },
      { key: 'phase', label: '相位', min: -180, max: 180, step: 5, default: 0, unit: '°' },
    ],
    buildCss: (v) => `/* 镜像对称：abs() 把负值转为正值
   两个圆围绕中心对称，左右偏移用 abs() 统一计算 */
.mirror {
  --offset: ${v.offset};
  --phase: ${v.phase};
  position: relative;
  width: 300px;
  height: 100px;
}
.dot {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 40px;
  height: 40px;
  margin: -20px 0 0 -20px;
  border-radius: 50%;
}
.dot--left {
  /* 左圆：abs() 把负偏移转正 */
  transform: translateX(calc(-1 * abs(var(--offset))));
  background: #2563eb;
}
.dot--right {
  /* 右圆：直接使用正偏移 */
  transform: translateX(abs(var(--offset)));
  background: #dc2626;
}`,
    buildPreviewHtml: (v) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<style>
  body { margin:0; padding:24px; font-family:-apple-system,sans-serif; background:#f8fafc; }
  .mirror { --offset:${v.offset}px; position:relative; width:300px; height:100px;
    margin:0 auto; border:1px dashed #cbd5e1; border-radius:8px; }
  .dot { position:absolute; left:50%; top:50%; width:40px; height:40px;
    margin:-20px 0 0 -20px; border-radius:50%; }
  .dot--left { transform:translateX(calc(-1 * abs(var(--offset)))); background:#2563eb; }
  .dot--right { transform:translateX(abs(var(--offset))); background:#dc2626; }
  .center { position:absolute; left:50%; top:0; width:1px; height:100%;
    background:#cbd5e1; }
  .label { text-align:center; color:#64748b; font-size:12px; margin-top:8px; }
</style></head>
<body>
  <div class="mirror">
    <div class="center"></div>
    <div class="dot dot--left"></div>
    <div class="dot dot--right"></div>
  </div>
  <p class="label">左右偏移均为 abs(${v.offset}px) = ${Math.abs(v.offset)}px</p>
</body></html>`,
  },
  {
    id: 'mod-stripes',
    name: '模运算条纹',
    description: 'mod() 实现循环条纹背景，无需 repeating-linear-gradient 估算',
    funcs: ['mod', 'rem'],
    params: [
      { key: 'count', label: '条纹数', min: 3, max: 12, step: 1, default: 6 },
      { key: 'width', label: '条纹宽度', min: 20, max: 60, step: 5, default: 36, unit: 'px' },
    ],
    buildCss: (v) => `/* 循环条纹：用 mod() 判断奇偶切换颜色
   i mod 2 = 0 → 主色，i mod 2 = 1 → 辅色
   相比 :nth-child(even) 更通用，可基于自定义属性 */
.stripes {
  --count: ${v.count};
  --w: ${v.width};
  display: flex;
  gap: 4px;
}
.stripe {
  --i: 0;
  width: var(--w);
  height: 60px;
  /* mod(i, 2) 返回 0 或 1，用 sign() 转为 0/1 后乘以辅色透明度 */
  background: hsl(220 70% 50% / calc(sign(mod(var(--i), 2)) * 0.6 + 0.2));
}
${Array.from({ length: v.count }, (_, i) => `.stripe:nth-child(${i + 1}) { --i: ${i}; }`).join('\n')}`,
    buildPreviewHtml: (v) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<style>
  body { margin:0; padding:24px; font-family:-apple-system,sans-serif; background:#f8fafc; }
  .stripes { display:flex; gap:4px; justify-content:center; }
  .stripe { --i:0; width:${v.width}px; height:60px;
    background: hsl(220 70% 50% / calc(sign(mod(var(--i), 2)) * 0.6 + 0.2));
    border-radius:6px; }
${Array.from({ length: v.count }, (_, i) => `  .stripe:nth-child(${i + 1}) { --i:${i}; }`).join('\n')}
  .label { text-align:center; color:#64748b; font-size:12px; margin-top:8px; }
</style></head>
<body>
  <div class="stripes">
${Array.from({ length: v.count }, () => '    <div class="stripe"></div>').join('\n')}
  </div>
  <p class="label">${v.count} 条条纹，奇偶切换颜色（mod(i, 2)）</p>
</body></html>`,
  },
  {
    id: 'round-snap',
    name: '取整对齐',
    description: 'round() 把数值吸附到 step 的整数倍，常用于网格对齐',
    funcs: ['round'],
    params: [
      { key: 'step', label: '对齐步长', min: 4, max: 40, step: 2, default: 12, unit: 'px' },
      { key: 'width', label: '原始宽度', min: 50, max: 280, step: 5, default: 175, unit: 'px' },
    ],
    buildCss: (v) => `/* 网格对齐：round() 把任意宽度吸附到 step 整数倍
   策略 nearest 四舍五入；up/down 强制方向；to-zero 向零对齐 */
.snap-grid {
  --step: ${v.step};
  --w: ${v.width};
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.snap {
  height: 24px;
  background: #e2e8f0;
  /* nearest 策略：四舍五入到最近的 step 整数倍 */
  width: round(nearest, var(--w), var(--step));
  border-radius: 4px;
}
.snap--up {
  background: #2563eb;
  /* up 策略：向上取整到 step 整数倍 */
  width: round(up, var(--w), var(--step));
}
.snap--down {
  background: #06b6d4;
  /* down 策略：向下取整到 step 整数倍 */
  width: round(down, var(--w), var(--step));
}`,
    buildPreviewHtml: (v) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<style>
  body { margin:0; padding:24px; font-family:-apple-system,sans-serif; background:#f8fafc; }
  .snap-grid { --step:${v.step}px; --w:${v.width}px; display:flex; flex-direction:column; gap:6px; }
  .snap { height:24px; background:#e2e8f0; border-radius:4px; }
  .snap--nearest { width: round(nearest, var(--w), var(--step)); background:#94a3b8; }
  .snap--up { width: round(up, var(--w), var(--step)); background:#2563eb; }
  .snap--down { width: round(down, var(--w), var(--step)); background:#06b6d4; }
  .snap--raw { width: var(--w); background:transparent; border:1px dashed #cbd5e1; }
  .label { font-size:12px; color:#475569; margin-top:8px; display:flex; justify-content:space-between; max-width:280px; }
  .label span { display:inline-block; }
</style></head>
<body>
  <div class="snap-grid">
    <div class="snap snap--raw"></div>
    <div class="snap snap--down"></div>
    <div class="snap snap--nearest"></div>
    <div class="snap snap--up"></div>
  </div>
  <p class="label">
    <span>原始 ${v.width}px</span>
    <span>step ${v.step}px</span>
  </p>
  <p class="label">
    <span>down ${Math.floor(v.width / v.step) * v.step}px</span>
    <span>nearest ${Math.round(v.width / v.step) * v.step}px</span>
    <span>up ${Math.ceil(v.width / v.step) * v.step}px</span>
  </p>
</body></html>`,
  },
  {
    id: 'rem-vs-mod',
    name: 'rem 与 mod 对比',
    description: '同符号相反的余数运算，mod 结果随 y 符号，rem 结果随 x 符号',
    funcs: ['rem', 'mod'],
    params: [
      { key: 'x', label: '被除数 x', min: -20, max: 20, step: 1, default: -7 },
      { key: 'y', label: '除数 y', min: -20, max: 20, step: 1, default: 3 },
    ],
    buildCss: (v) => `/* rem 与 mod 在负数场景的差异：
   rem(x, y) 结果符号与 x 相同；mod(x, y) 结果符号与 y 相同
   数学定义：
   rem(x, y) = x - y * trunc(x / y)
   mod(x, y) = x - y * floor(x / y) */
.compare {
  --x: ${v.x};
  --y: ${v.y};
  padding: 16px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}
.result-row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  font-family: ui-monospace, monospace;
}
.result-row__mod {
  color: #2563eb;
}
.result-row__rem {
  color: #dc2626;
}`,
    buildPreviewHtml: (v) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<style>
  body { margin:0; padding:24px; font-family:-apple-system,sans-serif; background:#f8fafc; color:#1e293b; }
  .compare { --x:${v.x}; --y:${v.y}; padding:16px; border:1px solid #e2e8f0;
    border-radius:8px; max-width:300px; margin:0 auto; background:#fff; }
  .title { font-size:14px; font-weight:600; margin-bottom:8px; }
  .row { display:flex; justify-content:space-between; padding:6px 0;
    border-bottom:1px dashed #e2e8f0; font-family:ui-monospace,monospace; font-size:13px; }
  .row:last-child { border-bottom:0; }
  .mod { color:#2563eb; font-weight:600; }
  .rem { color:#dc2626; font-weight:600; }
  .label { text-align:center; color:#64748b; font-size:12px; margin-top:8px; }
</style></head>
<body>
  <div class="compare">
    <div class="title">x = ${v.x}, y = ${v.y}</div>
    <div class="row"><span>mod(x, y)</span><span class="mod">${v.x - v.y * Math.floor(v.x / v.y)}</span></div>
    <div class="row"><span>rem(x, y)</span><span class="rem">${v.x - v.y * Math.trunc(v.x / v.y)}</span></div>
    <div class="row"><span>区别</span><span>${(() => {
      const m = v.x - v.y * Math.floor(v.x / v.y);
      const r = v.x - v.y * Math.trunc(v.x / v.y);
      return m === r ? '结果相同' : '符号不同';
    })()}</span></div>
  </div>
  <p class="label">mod 结果符号同 y=${v.y}，rem 结果符号同 x=${v.x}</p>
</body></html>`,
  },
];

export default function MathFunctionsTool() {
  const [presetId, setPresetId] = useState<string>(PRESETS[0].id);
  const [values, setValues] = useState<Record<string, number>>(() => {
    // 初始化为第一个预设的默认值
    const init: Record<string, number> = {};
    PRESETS[0].params.forEach((p) => { init[p.key] = p.default; });
    return init;
  });
  const [copied, setCopied] = useState(false);

  const currentPreset = useMemo(
    () => PRESETS.find((p) => p.id === presetId) ?? PRESETS[0],
    [presetId],
  );

  /** 切换预设时重置参数为该预设的默认值 */
  const handlePresetChange = useCallback((p: Preset) => {
    setPresetId(p.id);
    const next: Record<string, number> = {};
    p.params.forEach((param) => { next[param.key] = param.default; });
    setValues(next);
  }, []);

  /** 更新单个参数 */
  const updateValue = useCallback((key: string, val: number) => {
    setValues((prev) => ({ ...prev, [key]: val }));
  }, []);

  /** 生成的 CSS 代码 */
  const cssCode = useMemo(() => currentPreset.buildCss(values), [currentPreset, values]);

  /** 预览 HTML */
  const previewSrcDoc = useMemo(
    () => currentPreset.buildPreviewHtml(values),
    [currentPreset, values],
  );

  /** 复制 CSS */
  const handleCopy = useCallback(async () => {
    const ok = await copyText(cssCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [cssCode]);

  return (
    <div className="mf">
      {/* 顶部预设按钮组 */}
      <div className="mf__presets">
        <span className="mf__presets-label">预设场景：</span>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`mf__btn mf__btn--preset ${p.id === presetId ? 'mf__btn--active' : ''}`}
            onClick={() => handlePresetChange(p)}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="mf__main">
        {/* 左：参数 + 速查 */}
        <div className="mf__editor">
          {/* 当前预设说明 */}
          <div className="mf__panel">
            <div className="mf__panel-head">
              <span className="mf__panel-title">当前场景</span>
            </div>
            <div className="mf__panel-body">
              <h3 className="mf__scene-name">{currentPreset.name}</h3>
              <p className="mf__scene-desc">{currentPreset.description}</p>
              <div className="mf__scene-funcs">
                {currentPreset.funcs.map((fn) => (
                  <span key={fn} className="mf__func-chip">{fn}()</span>
                ))}
              </div>
            </div>
          </div>

          {/* 参数调节 */}
          <div className="mf__panel">
            <div className="mf__panel-head">
              <span className="mf__panel-title">参数调节</span>
            </div>
            <div className="mf__panel-body">
              {currentPreset.params.length === 0 && (
                <p className="mf__empty">该场景无可调参数。</p>
              )}
              {currentPreset.params.map((param) => (
                <label key={param.key} className="mf__field">
                  <span className="mf__field-label">
                    {param.label}
                    <span className="mf__field-value">
                      {values[param.key] ?? param.default}
                      {param.unit ?? ''}
                    </span>
                  </span>
                  <input
                    type="range"
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    value={values[param.key] ?? param.default}
                    onChange={(e) => updateValue(param.key, Number(e.target.value))}
                    aria-label={param.label}
                  />
                  <span className="mf__field-range">
                    {param.min} – {param.max}{param.unit ?? ''}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* 函数速查表 */}
          <div className="mf__panel">
            <div className="mf__panel-head">
              <span className="mf__panel-title">数学函数速查</span>
            </div>
            <div className="mf__panel-body mf__ref-body">
              <table className="mf__ref-table">
                <thead>
                  <tr>
                    <th>函数</th>
                    <th>语法</th>
                    <th>说明</th>
                    <th>返回值</th>
                  </tr>
                </thead>
                <tbody>
                  {FUNC_REFERENCE.map((item) => (
                    <tr key={item.name}>
                      <td><code className="mf__ref-name">{item.name}</code></td>
                      <td><code className="mf__ref-syntax">{item.syntax}</code></td>
                      <td>{item.desc}</td>
                      <td><code className="mf__ref-range">{item.range}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mf__ref-tip">
                <strong>浏览器支持：</strong>
                Chrome 128+ / Firefox 128+ / Safari 16.4+（Baseline 2024）。
                参数与返回值均为<strong>无单位数值</strong>，需配合
                <code>calc()</code> 用于带单位的 CSS 属性。
              </p>
            </div>
          </div>
        </div>

        {/* 右：预览 + 代码 */}
        <div className="mf__output">
          {/* iframe 沙箱预览 */}
          <div className="mf__preview">
            <div className="mf__preview-head">
              <span className="mf__preview-title">实时预览</span>
              <span className="mf__preview-hint">Chrome 128+ / Firefox 128+ / Safari 16.4+ 生效</span>
            </div>
            <iframe
              className="mf__iframe"
              srcDoc={previewSrcDoc}
              title="CSS 数学函数预览"
              sandbox="allow-same-origin"
            />
          </div>

          {/* 代码输出 */}
          <div className="mf__code">
            <div className="mf__code-head">
              <span className="mf__code-title">生成的 CSS</span>
              <button type="button" className="mf__btn mf__btn--copy" onClick={handleCopy}>
                {copied ? '已复制' : '复制 CSS'}
              </button>
            </div>
            <pre className="mf__code-pre">
              <code>{cssCode}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
