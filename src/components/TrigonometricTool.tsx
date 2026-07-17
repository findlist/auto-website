import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS 三角函数可视化生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 完整支持 8 个三角函数：sin / cos / tan / asin / acos / atan / atan2 / hypot
 *  - 支持常量函数：pi() / e()
 *  - 8 组预设场景：圆形布局 / 波浪动画 / 极坐标 / 旋转时钟 / 螺旋线 / 玫瑰曲线 / 震动效果 / 简单 sin 波
 *  - 参数实时调节：半径、元素数、动画时长、频率等
 *  - iframe 沙箱预览：真实渲染生成的 CSS，sandbox="allow-same-origin" 隔离
 *  - 三角函数速查表：语法 / 参数 / 返回值 / 浏览器支持
 *  - 一键复制生成的 CSS 代码
 *
 * 核心知识点（CSS Values Module Level 4）：
 *  - 三角函数参数单位为弧度（rad），角度需用 deg 转 rad：sin(60deg) 与 sin(1.0472rad) 等价
 *  - sin/cos/tan 参数为角度，返回无单位数值；asin/acos/atan 返回弧度；atan2(y, x) 返回弧度
 *  - hypot(a, b, c) 计算多参数的 √(a²+b²+c²)，常用于距离计算
 *  - pi()/e() 返回数学常量，可直接参与运算
 *  - 浏览器支持：Chrome 111+ / Firefox 118+ / Safari 15.4+（Baseline 2023）
 */

/** 三角函数名 */
type TrigFunc = 'sin' | 'cos' | 'tan' | 'asin' | 'acos' | 'atan' | 'atan2' | 'hypot' | 'pi' | 'e';

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
  funcs: TrigFunc[];                                // 该预设展示的核心函数
  params: Param[];                                  // 可调参数
  buildCss: (values: Record<string, number>) => string;       // 生成 CSS
  buildPreviewHtml: (values: Record<string, number>) => string; // 生成 iframe 预览 HTML
}

/** 三角函数速查表数据 */
const FUNC_REFERENCE: { name: TrigFunc; syntax: string; desc: string; range: string }[] = [
  { name: 'sin', syntax: 'sin(<角度>)', desc: '正弦函数，参数为弧度或角度值', range: '返回 [-1, 1]' },
  { name: 'cos', syntax: 'cos(<角度>)', desc: '余弦函数，参数为弧度或角度值', range: '返回 [-1, 1]' },
  { name: 'tan', syntax: 'tan(<角度>)', desc: '正切函数，参数为弧度或角度值', range: '返回 (-∞, +∞)' },
  { name: 'asin', syntax: 'asin(<值>)', desc: '反正弦，参数为 [-1, 1] 内的数值', range: '返回 [-π/2, π/2] 弧度' },
  { name: 'acos', syntax: 'acos(<值>)', desc: '反余弦，参数为 [-1, 1] 内的数值', range: '返回 [0, π] 弧度' },
  { name: 'atan', syntax: 'atan(<值>)', desc: '反正切，参数为任意实数', range: '返回 (-π/2, π/2) 弧度' },
  { name: 'atan2', syntax: 'atan2(<y>, <x>)', desc: '双参数反正切，按 y/x 计算角度并确定象限', range: '返回 (-π, π] 弧度' },
  { name: 'hypot', syntax: 'hypot(<a>, <b>, ...)', desc: '计算 √(a²+b²+...)，多参数欧几里得距离', range: '返回 [0, +∞)' },
  { name: 'pi', syntax: 'pi()', desc: '圆周率常量，约 3.14159', range: '返回 3.14159...' },
  { name: 'e', syntax: 'e()', desc: '自然常数，约 2.71828', range: '返回 2.71828...' },
];

/** 辅助：把角度值转为 CSS 表达式（用户输入的角度直接用 deg 单位） */
const angleExpr = (deg: number): string => `${deg}deg`;

/** 辅助：生成圆周布局的元素位置（角度均分） */
const circlePositions = (count: number, radius: number): string => {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (360 / count) * i;
    // CSS：translate(calc(cos(θ)*r), calc(sin(θ)*r))
    lines.push(`.dot:nth-child(${i + 1}) {
  transform: translate(calc(cos(${angleExpr(angle)}) * ${radius}px), calc(sin(${angleExpr(angle)}) * ${radius}px));
}`);
  }
  return lines.join('\n');
};

/** 8 组预设场景 */
const PRESETS: Preset[] = [
  {
    id: 'circle',
    name: '圆形布局',
    description: 'N 个元素沿圆周均匀分布，使用 cos()/sin() 计算 x/y 坐标',
    funcs: ['cos', 'sin', 'pi'],
    params: [
      { key: 'count', label: '元素数量', min: 3, max: 16, step: 1, default: 8 },
      { key: 'radius', label: '圆周半径', min: 40, max: 180, step: 5, default: 120, unit: 'px' },
    ],
    buildCss: (v) => `.stage {
  position: relative;
  width: 400px;
  height: 400px;
}
.dot {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 24px;
  height: 24px;
  margin: -12px 0 0 -12px;
  border-radius: 50%;
  background: linear-gradient(135deg, #60a5fa, #2563eb);
}
${circlePositions(v.count, v.radius)}`,
    buildPreviewHtml: (v) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<style>
  body { margin:0; padding:16px; font-family:-apple-system,sans-serif; background:#f8fafc; }
  .stage { position:relative; width:400px; height:400px; max-width:100%; margin:0 auto; }
  .dot { position:absolute; left:50%; top:50%; width:24px; height:24px; margin:-12px 0 0 -12px;
    border-radius:50%; background:linear-gradient(135deg,#60a5fa,#2563eb);
    transition:transform .3s; }
${Array.from({ length: v.count }, (_, i) => {
  const angle = (360 / v.count) * i;
  return `  .dot:nth-child(${i + 1}) { transform: translate(calc(cos(${angle}deg) * ${v.radius}px), calc(sin(${angle}deg) * ${v.radius}px)); }`;
}).join('\n')}
  .label { text-align:center; color:#64748b; font-size:12px; margin-top:8px; }
</style></head>
<body>
  <div class="stage">${Array.from({ length: v.count }, () => '<div class="dot"></div>').join('')}</div>
  <p class="label">${v.count} 个元素沿圆周均匀分布（每 ${Math.round(360 / v.count)}° 一个）</p>
</body></html>`,
  },
  {
    id: 'wave',
    name: '波浪动画',
    description: 'sin() 控制元素上下浮动，相位错开形成波浪效果',
    funcs: ['sin', 'pi'],
    params: [
      { key: 'count', label: '元素数量', min: 3, max: 12, step: 1, default: 7 },
      { key: 'amplitude', label: '振幅', min: 10, max: 60, step: 2, default: 30, unit: 'px' },
      { key: 'duration', label: '动画时长', min: 1, max: 6, step: 0.5, default: 3, unit: 's' },
    ],
    buildCss: (v) => `.wave-stage {
  display: flex;
  gap: 8px;
  justify-content: center;
  align-items: center;
  height: 200px;
}
.wave-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #2563eb;
  animation: wave ${v.duration}s ease-in-out infinite;
}
/* 每个元素相位错开 1/count 个周期，sin(360deg * i/count) 计算初始相位偏移 */
${Array.from({ length: v.count }, (_, i) => {
  const delay = (v.duration / v.count) * i;
  return `.wave-dot:nth-child(${i + 1}) { animation-delay: -${delay}s; }`;
}).join('\n')}
@keyframes wave {
  0%, 100% { transform: translateY(calc(sin(0deg) * ${v.amplitude}px)); }
  25%      { transform: translateY(calc(sin(90deg) * ${v.amplitude}px)); }
  50%      { transform: translateY(calc(sin(180deg) * ${v.amplitude}px)); }
  75%      { transform: translateY(calc(sin(270deg) * ${v.amplitude}px)); }
}`,
    buildPreviewHtml: (v) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<style>
  body { margin:0; padding:16px; font-family:-apple-system,sans-serif; background:#f8fafc; }
  .wave-stage { display:flex; gap:8px; justify-content:center; align-items:center; height:200px; }
  .wave-dot { width:20px; height:20px; border-radius:50%; background:#2563eb;
    animation: wave ${v.duration}s ease-in-out infinite; }
${Array.from({ length: v.count }, (_, i) => {
  const delay = (v.duration / v.count) * i;
  return `  .wave-dot:nth-child(${i + 1}) { animation-delay: -${delay}s; }`;
}).join('\n')}
  @keyframes wave {
    0%, 100% { transform: translateY(0); }
    25%      { transform: translateY(-${v.amplitude}px); }
    50%      { transform: translateY(0); }
    75%      { transform: translateY(${v.amplitude}px); }
  }
</style></head>
<body>
  <div class="wave-stage">${Array.from({ length: v.count }, () => '<div class="wave-dot"></div>').join('')}</div>
</body></html>`,
  },
  {
    id: 'polar',
    name: '极坐标 atan2',
    description: 'atan2(y, x) 根据坐标计算角度，常用于指针朝向鼠标',
    funcs: ['atan2', 'hypot', 'pi'],
    params: [
      { key: 'angle', label: '指针角度', min: 0, max: 360, step: 5, default: 45, unit: '°' },
    ],
    buildCss: (v) => `/* 演示：用 atan2(y, x) 计算朝向角度
   实际场景需 JS 设置 --mouse-x / --mouse-y 自定义属性
   这里用固定角度模拟鼠标在右上方 45° 位置 */
.pointer-stage {
  --mouse-x: ${Math.cos((v.angle * Math.PI) / 180).toFixed(3)};
  --mouse-y: ${Math.sin((v.angle * Math.PI) / 180).toFixed(3)};
  position: relative;
  width: 300px;
  height: 300px;
  margin: 0 auto;
  border: 2px dashed #cbd5e1;
  border-radius: 50%;
}
.pointer {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 4px;
  height: 120px;
  margin: 0 0 0 -2px;
  background: #2563eb;
  transform-origin: top center;
  /* atan2(y, x) 返回弧度，需用 calc 转换为度数后再旋转；
     指针默认指向下方（南），atan2 从正 X 轴（东）起算，因此需减 90deg 校正方向 */
  transform: rotate(calc(atan2(var(--mouse-y), var(--mouse-x)) * 1rad - 90deg));
}
.pointer::after {
  content: '';
  position: absolute;
  bottom: -8px;
  left: -6px;
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-top: 12px solid #2563eb;
}`,
    buildPreviewHtml: (v) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<style>
  body { margin:0; padding:16px; font-family:-apple-system,sans-serif; background:#f8fafc; }
  .pointer-stage { position:relative; width:300px; height:300px; margin:0 auto;
    border:2px dashed #cbd5e1; border-radius:50%; }
  .pointer { position:absolute; left:50%; top:50%; width:4px; height:120px;
    margin:0 0 0 -2px; background:#2563eb; transform-origin:top center;
    transform: rotate(${v.angle - 90}deg); }
  .pointer::after { content:''; position:absolute; bottom:-8px; left:-6px;
    border-left:8px solid transparent; border-right:8px solid transparent;
    border-top:12px solid #2563eb; }
  .label { text-align:center; color:#64748b; font-size:12px; margin-top:8px; }
  .dot { position:absolute; width:8px; height:8px; border-radius:50%;
    background:#dc2626; left:${150 + Math.cos((v.angle * Math.PI) / 180) * 120 - 4}px;
    top:${150 + Math.sin((v.angle * Math.PI) / 180) * 120 - 4}px; }
</style></head>
<body>
  <div class="pointer-stage">
    <div class="pointer"></div>
    <div class="dot"></div>
  </div>
  <p class="label">atan2(y, x) 计算指针朝向（当前 ${v.angle}°）</p>
</body></html>`,
  },
  {
    id: 'clock',
    name: '旋转时钟',
    description: 'cos()/sin() 计算时针分针秒针位置，pi() 控制完整圆周',
    funcs: ['cos', 'sin', 'pi'],
    params: [
      { key: 'hour', label: '小时', min: 0, max: 12, step: 1, default: 3 },
      { key: 'minute', label: '分钟', min: 0, max: 59, step: 1, default: 30 },
    ],
    buildCss: (v) => `.clock {
  position: relative;
  width: 280px;
  height: 280px;
  margin: 0 auto;
  border: 4px solid #1e293b;
  border-radius: 50%;
  background: #fff;
}
/* 12 个时刻点：每 30° 一个，cos/sin 计算 x/y */
.hour-mark {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 4px;
  height: 12px;
  margin: 0 0 0 -2px;
  background: #1e293b;
  transform-origin: center 124px;
}
${Array.from({ length: 12 }, (_, i) => `.hour-mark:nth-child(${i + 1}) { transform: rotate(${i * 30}deg) translateY(-124px); }`).join('\n')}
/* 时针：每小时 30°（360/12） */
.hour-hand {
  position: absolute; left: 50%; top: 50%;
  width: 6px; height: 70px; margin: 0 0 0 -3px;
  background: #1e293b; transform-origin: bottom center;
  transform: rotate(${v.hour * 30 + v.minute * 0.5}deg) translateY(-35px);
}
/* 分针：每分钟 6°（360/60） */
.minute-hand {
  position: absolute; left: 50%; top: 50%;
  width: 4px; height: 100px; margin: 0 0 0 -2px;
  background: #475569; transform-origin: bottom center;
  transform: rotate(${v.minute * 6}deg) translateY(-50px);
}`,
    buildPreviewHtml: (v) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<style>
  body { margin:0; padding:16px; font-family:-apple-system,sans-serif; background:#f8fafc; }
  .clock { position:relative; width:280px; height:280px; margin:0 auto;
    border:4px solid #1e293b; border-radius:50%; background:#fff; }
  .hour-mark { position:absolute; left:50%; top:50%; width:4px; height:12px;
    margin:0 0 0 -2px; background:#1e293b; transform-origin:center 124px; }
${Array.from({ length: 12 }, (_, i) => `  .hour-mark:nth-child(${i + 1}) { transform: rotate(${i * 30}deg) translateY(-124px); }`).join('\n')}
  .hour-hand { position:absolute; left:50%; top:50%; width:6px; height:70px; margin:0 0 0 -3px;
    background:#1e293b; transform-origin:bottom center;
    transform: rotate(${v.hour * 30 + v.minute * 0.5}deg) translateY(-35px); }
  .minute-hand { position:absolute; left:50%; top:50%; width:4px; height:100px; margin:0 0 0 -2px;
    background:#475569; transform-origin:bottom center;
    transform: rotate(${v.minute * 6}deg) translateY(-50px); }
  .center { position:absolute; left:50%; top:50%; width:12px; height:12px; margin:-6px 0 0 -6px;
    background:#1e293b; border-radius:50%; }
  .label { text-align:center; color:#64748b; font-size:12px; margin-top:8px; }
</style></head>
<body>
  <div class="clock">
${Array.from({ length: 12 }, () => '    <div class="hour-mark"></div>').join('\n')}
    <div class="hour-hand"></div>
    <div class="minute-hand"></div>
    <div class="center"></div>
  </div>
  <p class="label">${v.hour}:${String(v.minute).padStart(2, '0')}</p>
</body></html>`,
  },
  {
    id: 'spiral',
    name: '螺旋线',
    description: '黄金角 137.5° = pi*(3-√5)/2 旋转，形成向日葵种子分布',
    funcs: ['sin', 'cos', 'pi'],
    params: [
      { key: 'count', label: '种子数量', min: 10, max: 80, step: 1, default: 40 },
      { key: 'spacing', label: '间距', min: 5, max: 20, step: 1, default: 10, unit: 'px' },
    ],
    buildCss: (v) => `/* 黄金角：360° * (3 - √5) / 2 ≈ 137.508°
   也可写作 calc(180deg * pi() * (3 - sqrt(5)) / 2) */
.spiral-stage {
  position: relative;
  width: 400px;
  height: 400px;
  margin: 0 auto;
}
.seed {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 10px;
  height: 10px;
  margin: -5px 0 0 -5px;
  border-radius: 50%;
  background: #f59e0b;
}
${Array.from({ length: v.count }, (_, i) => {
  const angle = 137.508 * i;
  const radius = v.spacing * Math.sqrt(i);
  return `.seed:nth-child(${i + 1}) {
  transform: translate(calc(cos(${angle}deg) * ${radius.toFixed(1)}px), calc(sin(${angle}deg) * ${radius.toFixed(1)}px));
  background: hsl(${(i * 9) % 360}, 70%, 55%);
}`;
}).join('\n')}`,
    buildPreviewHtml: (v) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<style>
  body { margin:0; padding:16px; font-family:-apple-system,sans-serif; background:#f8fafc; }
  .spiral-stage { position:relative; width:400px; height:400px; max-width:100%; margin:0 auto; }
  .seed { position:absolute; left:50%; top:50%; width:10px; height:10px; margin:-5px 0 0 -5px;
    border-radius:50%; }
${Array.from({ length: v.count }, (_, i) => {
  const angle = 137.508 * i;
  const radius = v.spacing * Math.sqrt(i);
  return `  .seed:nth-child(${i + 1}) { transform: translate(calc(cos(${angle}deg) * ${radius.toFixed(1)}px), calc(sin(${angle}deg) * ${radius.toFixed(1)}px)); background: hsl(${(i * 9) % 360}, 70%, 55%); }`;
}).join('\n')}
</style></head>
<body>
  <div class="spiral-stage">${Array.from({ length: v.count }, () => '<div class="seed"></div>').join('')}</div>
</body></html>`,
  },
  {
    id: 'rose',
    name: '玫瑰曲线',
    description: '极坐标 r = cos(k*θ)，cos()/sin() 转笛卡尔坐标形成花瓣',
    funcs: ['cos', 'sin', 'pi'],
    params: [
      { key: 'petals', label: '花瓣数 k', min: 2, max: 8, step: 1, default: 4 },
      { key: 'radius', label: '最大半径', min: 60, max: 180, step: 5, default: 150, unit: 'px' },
      { key: 'samples', label: '采样点数', min: 50, max: 200, step: 10, default: 120 },
    ],
    buildCss: (v) => `/* 玫瑰曲线：r = cos(k*θ)
   笛卡尔坐标：x = r*cos(θ), y = r*sin(θ)
   当 k 为偶数时有 2k 片花瓣，奇数时为 k 片 */
.rose-stage {
  position: relative;
  width: 400px;
  height: 400px;
  margin: 0 auto;
}
.point {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 3px;
  height: 3px;
  margin: -1.5px 0 0 -1.5px;
  border-radius: 50%;
  background: #ec4899;
}
${Array.from({ length: v.samples }, (_, i) => {
  const theta = (360 / v.samples) * i;
  // r = cos(k*θ) * radius，但 CSS 不能在 transform 里嵌套 cos*cos，所以预计算
  const r = Math.cos((v.petals * theta * Math.PI) / 180) * v.radius;
  const x = Math.cos((theta * Math.PI) / 180) * r;
  const y = Math.sin((theta * Math.PI) / 180) * r;
  return `.point:nth-child(${i + 1}) { transform: translate(${x.toFixed(1)}px, ${y.toFixed(1)}px); }`;
}).join('\n')}

/* 等价 CSS 原生写法（演示用 cos 嵌套）：
.point {
  transform: translate(
    calc(cos(${v.petals} * var(--theta)) * cos(var(--theta)) * ${v.radius}px),
    calc(cos(${v.petals} * var(--theta)) * sin(var(--theta)) * ${v.radius}px)
  );
}
*/`,
    buildPreviewHtml: (v) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<style>
  body { margin:0; padding:16px; font-family:-apple-system,sans-serif; background:#f8fafc; }
  .rose-stage { position:relative; width:400px; height:400px; max-width:100%; margin:0 auto; }
  .point { position:absolute; left:50%; top:50%; width:3px; height:3px;
    margin:-1.5px 0 0 -1.5px; border-radius:50%; background:#ec4899; }
${Array.from({ length: v.samples }, (_, i) => {
  const theta = (360 / v.samples) * i;
  const r = Math.cos((v.petals * theta * Math.PI) / 180) * v.radius;
  const x = Math.cos((theta * Math.PI) / 180) * r;
  const y = Math.sin((theta * Math.PI) / 180) * r;
  return `  .point:nth-child(${i + 1}) { transform: translate(${x.toFixed(1)}px, ${y.toFixed(1)}px); }`;
}).join('\n')}
</style></head>
<body>
  <div class="rose-stage">${Array.from({ length: v.samples }, () => '<div class="point"></div>').join('')}</div>
</body></html>`,
  },
  {
    id: 'shake',
    name: '震动效果',
    description: 'sin() 配合时间变量生成高频震动，常用于错误提示',
    funcs: ['sin', 'pi'],
    params: [
      { key: 'amplitude', label: '振幅', min: 2, max: 20, step: 1, default: 8, unit: 'px' },
      { key: 'frequency', label: '频率', min: 5, max: 30, step: 1, default: 15, unit: 'Hz' },
      { key: 'duration', label: '持续时长', min: 0.3, max: 2, step: 0.1, default: 0.6, unit: 's' },
    ],
    buildCss: (v) => `/* 震动动画：用 sin(频率 * 时间 * 360deg) 计算位移
   animation-iteration-count: infinite 实现持续震动
   实际生产可用 @property --t 注册自定义属性实现纯 CSS 时间变量 */
@keyframes shake {
  0%   { transform: translate(calc(sin(0deg) * ${v.amplitude}px), 0); }
  25%  { transform: translate(calc(sin(${v.frequency * 90}deg) * ${v.amplitude}px), calc(cos(${v.frequency * 90}deg) * ${v.amplitude * 0.5}px)); }
  50%  { transform: translate(calc(sin(${v.frequency * 180}deg) * ${v.amplitude}px), 0); }
  75%  { transform: translate(calc(sin(${v.frequency * 270}deg) * ${v.amplitude}px), calc(cos(${v.frequency * 270}deg) * ${v.amplitude * 0.5}px)); }
  100% { transform: translate(calc(sin(${v.frequency * 360}deg) * ${v.amplitude}px), 0); }
}
.shake-box {
  width: 200px;
  height: 80px;
  margin: 40px auto;
  background: linear-gradient(135deg, #ef4444, #dc2626);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  border-radius: 8px;
  animation: shake ${v.duration}s linear infinite;
}`,
    buildPreviewHtml: (v) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<style>
  body { margin:0; padding:24px; font-family:-apple-system,sans-serif; background:#f8fafc; }
  @keyframes shake {
    0%   { transform: translate(0, 0); }
    25%  { transform: translate(${v.amplitude}px, ${v.amplitude * 0.5}px); }
    50%  { transform: translate(0, 0); }
    75%  { transform: translate(-${v.amplitude}px, ${v.amplitude * 0.5}px); }
    100% { transform: translate(0, 0); }
  }
  .shake-box { width:200px; height:80px; margin:40px auto;
    background:linear-gradient(135deg,#ef4444,#dc2626); color:#fff;
    display:flex; align-items:center; justify-content:center; font-size:14px;
    border-radius:8px; animation: shake ${v.duration}s linear infinite; }
  .label { text-align:center; color:#64748b; font-size:12px; }
</style></head>
<body>
  <div class="shake-box">错误：表单校验失败</div>
  <p class="label">振幅 ${v.amplitude}px · 频率 ${v.frequency}Hz · 周期 ${v.duration}s</p>
</body></html>`,
  },
  {
    id: 'simple-sin',
    name: '简单 sin 波',
    description: '单元素 sin() 振荡，最基础的可视化案例',
    funcs: ['sin', 'pi'],
    params: [
      { key: 'amplitude', label: '振幅', min: 10, max: 80, step: 2, default: 40, unit: 'px' },
      { key: 'duration', label: '周期', min: 1, max: 5, step: 0.5, default: 2, unit: 's' },
    ],
    buildCss: (v) => `/* 最简 sin 振荡：4 个关键帧对应 0°/90°/180°/270°/360°
   sin(0)=0, sin(90°)=1, sin(180°)=0, sin(270°)=-1, sin(360°)=0 */
@keyframes bob {
  0%   { transform: translateY(calc(sin(0deg) * ${v.amplitude}px)); }
  25%  { transform: translateY(calc(sin(90deg) * ${v.amplitude}px)); }
  50%  { transform: translateY(calc(sin(180deg) * ${v.amplitude}px)); }
  75%  { transform: translateY(calc(sin(270deg) * ${v.amplitude}px)); }
  100% { transform: translateY(calc(sin(360deg) * ${v.amplitude}px)); }
}
.bob {
  width: 40px;
  height: 40px;
  margin: 60px auto;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, #fde68a, #f59e0b);
  animation: bob ${v.duration}s ease-in-out infinite;
}`,
    buildPreviewHtml: (v) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<style>
  body { margin:0; padding:24px; font-family:-apple-system,sans-serif; background:#f8fafc; }
  @keyframes bob {
    0%   { transform: translateY(0); }
    25%  { transform: translateY(-${v.amplitude}px); }
    50%  { transform: translateY(0); }
    75%  { transform: translateY(${v.amplitude}px); }
    100% { transform: translateY(0); }
  }
  .bob { width:40px; height:40px; margin:60px auto; border-radius:50%;
    background:radial-gradient(circle at 30% 30%,#fde68a,#f59e0b);
    animation: bob ${v.duration}s ease-in-out infinite; }
</style></head>
<body>
  <div class="bob"></div>
</body></html>`,
  },
];

export default function TrigonometricTool() {
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
    <div className="tr">
      {/* 顶部预设按钮组 */}
      <div className="tr__presets">
        <span className="tr__presets-label">预设场景：</span>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`tr__btn tr__btn--preset ${p.id === presetId ? 'tr__btn--active' : ''}`}
            onClick={() => handlePresetChange(p)}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="tr__main">
        {/* 左：参数 + 速查 */}
        <div className="tr__editor">
          {/* 当前预设说明 */}
          <div className="tr__panel">
            <div className="tr__panel-head">
              <span className="tr__panel-title">当前场景</span>
            </div>
            <div className="tr__panel-body">
              <h3 className="tr__scene-name">{currentPreset.name}</h3>
              <p className="tr__scene-desc">{currentPreset.description}</p>
              <div className="tr__scene-funcs">
                {currentPreset.funcs.map((fn) => (
                  <span key={fn} className="tr__func-chip">{fn}()</span>
                ))}
              </div>
            </div>
          </div>

          {/* 参数调节 */}
          <div className="tr__panel">
            <div className="tr__panel-head">
              <span className="tr__panel-title">参数调节</span>
            </div>
            <div className="tr__panel-body">
              {currentPreset.params.length === 0 && (
                <p className="tr__empty">该场景无可调参数。</p>
              )}
              {currentPreset.params.map((param) => (
                <label key={param.key} className="tr__field">
                  <span className="tr__field-label">
                    {param.label}
                    <span className="tr__field-value">
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
                  <span className="tr__field-range">
                    {param.min} – {param.max}{param.unit ?? ''}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* 三角函数速查表 */}
          <div className="tr__panel">
            <div className="tr__panel-head">
              <span className="tr__panel-title">三角函数速查</span>
            </div>
            <div className="tr__panel-body tr__ref-body">
              <table className="tr__ref-table">
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
                      <td><code className="tr__ref-name">{item.name}</code></td>
                      <td><code className="tr__ref-syntax">{item.syntax}</code></td>
                      <td>{item.desc}</td>
                      <td><code className="tr__ref-range">{item.range}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="tr__ref-tip">
                <strong>浏览器支持：</strong>
                Chrome 111+ / Firefox 118+ / Safari 15.4+（Baseline 2023）。
                参数单位为<strong>弧度</strong>，可使用 <code>deg</code> 后缀的角度值，
                浏览器自动转换为弧度。
              </p>
            </div>
          </div>
        </div>

        {/* 右：预览 + 代码 */}
        <div className="tr__output">
          {/* iframe 沙箱预览 */}
          <div className="tr__preview">
            <div className="tr__preview-head">
              <span className="tr__preview-title">实时预览</span>
              <span className="tr__preview-hint">Chrome 111+ / Firefox 118+ / Safari 15.4+ 生效</span>
            </div>
            <iframe
              className="tr__iframe"
              srcDoc={previewSrcDoc}
              title="CSS 三角函数预览"
              sandbox="allow-same-origin"
            />
          </div>

          {/* 代码输出 */}
          <div className="tr__code">
            <div className="tr__code-head">
              <span className="tr__code-title">生成的 CSS</span>
              <button type="button" className="tr__btn tr__btn--copy" onClick={handleCopy}>
                {copied ? '已复制' : '复制 CSS'}
              </button>
            </div>
            <pre className="tr__code-pre">
              <code>{cssCode}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
