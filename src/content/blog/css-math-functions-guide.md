---
title: 'CSS 数学函数指南：exp/log/sqrt/pow/round 与取整对齐'
description: '系统讲解 CSS 数学函数：exp/log/sqrt/pow/abs/sign/mod/rem/round，参数与返回值类型、单位转换、对数刻度、幂律缓动、镜像布局、模运算循环、网格对齐、rem 与 mod 符号差异实战案例。'
pubDate: 2026-07-18
tags: ['CSS', 'CSS 数学函数', 'exp', 'log', 'sqrt', 'pow', 'abs', 'sign', 'mod', 'rem', 'round', '对数刻度', '幂律缓动', '镜像布局', '网格对齐', 'CSS Values Level 4', 'Baseline 2024', '前端开发', '渐进增强']
relatedTool: '/css-math'
---

CSS 数学函数是 CSS Values Module Level 4 引入的一组数学运算函数，包含 `exp()` / `log()` / `sqrt()` / `pow()` / `abs()` / `sign()` / `mod()` / `rem()` / `round()`。自 Chrome 128+ / Firefox 128+ / Safari 16.4+ 起原生支持，已进入 Baseline 2024，可在生产环境放心使用。与 `calc()` 配合，这些函数把原本需要 JavaScript 的指数增长、对数刻度、网格对齐等数学运算下沉到 CSS 表达式层。本文系统解析 9 个数学函数的语法、参数、返回值与实战场景，并与已发布的 [CSS 三角函数指南](/blog/trigonometric-guide) 互补，构成完整的 CSS 数学函数体系。

## 一、诞生背景与核心价值

数学函数进入 CSS 的核心动机，是把"数值计算"从 JavaScript 运行时下沉到 CSS 渲染层。在此之前，三类高频场景必须依赖 JS：

- **指数增长**：标题字号随级别指数增长，需 JS 计算 `Math.exp(step) * base` 后写入 `font-size`，响应式调整 step 需重新计算所有级别。
- **对数刻度**：把 1..1000 的数值压缩到 0..100% 进度条，需 JS 计算 `Math.log(v) / Math.log(max)` 后写入 `width`。
- **网格对齐**：把任意宽度吸附到 8px 网格，需 JS 计算 `Math.round(w / 8) * 8` 后写入 `width`。

CSS 数学函数让这些场景变成纯声明式：

```css
/* 指数增长字号：h1 比 h6 大 exp(3*step) 倍 */
.heading h1 { font-size: calc(var(--base) * exp(calc(3 * var(--step)))); }
```

```css
/* 对数刻度进度条：把 1..max 压缩到 0..100% */
.bar__fill {
  width: calc(log(var(--v)) / log(var(--max)) * 100%);
}
```

```css
/* 网格对齐：任意宽度吸附到 8px 整数倍 */
.snap {
  width: round(nearest, var(--w), 8);
}
```

这种"数学计算下沉 CSS"带来三大好处：一是 **响应式零成本**，调参数只需改一个变量；二是 **SSR 友好**，无需等待 JS 执行；三是 **性能更优**，CSS 表达式在渲染层求值，避免 JS 布局抖动。

## 二、参数与返回值：无单位数值的运算规则

CSS 数学函数的参数与返回值都是**无单位数值**（`<number>`），不能直接传入带单位的值（如 `exp(10px)` 无效）。这是与三角函数（接受 `deg` 等单位）的关键差异。

### 错误与正确写法对比

```css
/* 错误：exp 不接受带单位的参数 */
width: exp(10px);        /* 无效 */
width: log(100%);        /* 无效 */

/* 正确：在 calc 中处理单位 */
width: calc(exp(2) * 10px);                              /* exp(2) ≈ 7.389，再乘以 10px */
width: calc(log(var(--v)) / log(var(--max)) * 100%);     /* 对数比例乘以 100% */
```

### 与带单位的值做运算的通用模式

```css
/* 模式 1：无单位结果 × 单位 */
.property { width: calc(pow(2, 3) * 1px); }              /* 8 × 1px = 8px */

/* 模式 2：带单位的值 ÷ 单位 = 无单位，运算后再乘回单位 */
.property {
  --w-px: 175px;
  /* 把宽度转无单位后取整，再乘回 px */
  width: calc(round(nearest, calc(var(--w-px) / 1px), 8) * 1px);
}

/* 模式 3：百分比进度 */
.bar {
  width: calc(log(var(--v), 10) / log(var(--max), 10) * 100%);
}
```

### 易错点：round() 的 step 参数

`round()` 的第三个参数 `step` 必须是无单位数值。若要对带单位的值取整，需在 `calc` 中转换：

```css
/* 错误：step 不能带单位 */
.snap { width: round(nearest, var(--w), 8px); }   /* 无效 */

/* 正确方案 1：step 写无单位，结果需要时再乘单位 */
.snap { width: calc(round(nearest, calc(var(--w) / 1px), 8) * 1px); }

/* 正确方案 2：直接用 calc 的单位运算（CSS 已支持带单位的 calc） */
.snap { width: calc(round(nearest, var(--w) / 1px, 8) * 1px); }
```

## 三、exp() 与 log()：指数对数运算

`exp(x)` 返回自然常数 e 的 x 次方（e ≈ 2.71828），等价于 `pow(e(), x)`。`log(x, base?)` 计算对数，省略 `base` 时为自然对数 ln。

### 语法与示例

```css
/* exp：自然指数增长 */
font-size: calc(16px * exp(0.5));   /* 16 × 1.6487 = 26.38px */

/* log：默认自然对数 ln */
opacity: calc(log(var(--v)) / log(100));   /* log(100) ≈ 4.605 */

/* 指定 base：常用对数 lg */
width: calc(log(var(--v), 10) / log(var(--max), 10) * 100%);

/* 二进制对数 lb */
z-index: calc(log(var(--level), 2));      /* 层级 8 对应 z-index ≈ 3 */
```

### 典型场景 1：标题字号指数增长

设计系统中常见的需求是"标题字号随级别指数增长"，让 h1 与 h6 的字号差异感觉自然（不是线性递减，而是指数递减，符合人眼对字号的对数感知）：

```css
.heading {
  --base: 16px;
  --step: 0.6;
}
.heading h1 { font-size: calc(var(--base) * exp(calc(3 * var(--step)))); }   /* ≈ 41.6px */
.heading h2 { font-size: calc(var(--base) * exp(calc(2 * var(--step)))); }   /* ≈ 30.3px */
.heading h3 { font-size: calc(var(--base) * exp(var(--step))); }             /* ≈ 22.1px */
.heading h4 { font-size: calc(var(--base) * exp(calc(-1 * var(--step)))); }  /* ≈ 11.6px */
.heading h5 { font-size: calc(var(--base) * exp(calc(-2 * var(--step)))); }  /* ≈ 8.4px */
.heading h6 { font-size: var(--base); }                                     /* 16px */
```

### 典型场景 2：对数刻度进度条

数据可视化中，数值范围跨度大（如 1..1000），线性进度条无法体现数量级差异。用对数刻度把数值压缩到 0..100%：

```css
.bar {
  --max: 1000;
  --v: 500;
  width: 100%;
  height: 24px;
  background: #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
}
.bar__fill {
  /* 对数比例：log(v) / log(max)，结果 [0, 1]，再乘以 100% */
  width: calc(log(var(--v)) / log(var(--max)) * 100%);
  height: 100%;
  background: linear-gradient(90deg, #2563eb, #06b6d4);
}
```

线性刻度下 v=500/max=1000 显示 50%，v=10/max=1000 显示 1%（几乎看不到）；对数刻度下 v=10/max=1000 显示 33%，差异更直观。

## 四、sqrt() 与 pow()：幂运算双兄弟

`sqrt(x)` 计算平方根，等价于 `pow(x, 0.5)`。`pow(x, y)` 计算 x 的 y 次方。两者返回无单位数值。

### 语法与示例

```css
/* sqrt：平方根 */
opacity: calc(sqrt(0.5));                /* ≈ 0.707 */

/* pow：x 的 y 次方 */
transform: scale(pow(1.2, 3));            /* 1.728 */

/* 等价写法：sqrt(x) 与 pow(x, 0.5) 结果相同 */
:root {
  --r1: sqrt(2);       /* 1.41421 */
  --r2: pow(2, 0.5);   /* 1.41421 */
}
```

### 典型场景 1：平方根径向渐变

多层径向渐变需要半径按 `sqrt(i)` 增长（而非线性），形成视觉聚焦感：

```css
.target {
  width: 200px;
  height: 200px;
  background:
    radial-gradient(circle, hsl(0 70% 55%) 0 30px, transparent 30px),
    radial-gradient(circle, hsl(60 70% 55%) 0 42.4px, transparent 42.4px),
    radial-gradient(circle, hsl(120 70% 55%) 0 51.9px, transparent 51.9px),
    radial-gradient(circle, hsl(180 70% 55%) 0 60px, transparent 60px);
  border-radius: 50%;
}
/* 半径序列：30, 30*sqrt(2)≈42.4, 30*sqrt(3)≈51.9, 30*sqrt(4)=60 */
```

### 典型场景 2：幂律缓动曲线

`pow(t, k)` 控制非线性进度，k>1 时先慢后快，k<1 时先快后慢。配合 `@property` 注册时间变量实现可调节缓动：

```css
@property --t {
  syntax: '<number>';
  inherits: false;
  initial-value: 0;
}

.eased {
  --t: 0;
  /* pow(t, 2.5) 实现先慢后快的加速感 */
  transform: translateX(calc(pow(var(--t), 2.5) * 200px));
  animation: tick 2s ease-in-out infinite alternate;
}

@keyframes tick {
  to { --t: 1; }
}
```

`pow` 的优势是单一参数 k 控制曲线形状，相比 `cubic-bezier` 四参数更直观。`cubic-bezier` 适合精确设计曲线两端斜率，`pow` 适合快速调节缓动趋势。

### sqrt 与 pow 的选择

- 平方根场景优先用 `sqrt`：语义更直观，避免魔法数字 `0.5`。
- 任意次幂必须用 `pow`：平方 `pow(x, 2)`、立方 `pow(x, 3)`、负幂 `pow(x, -1)`（倒数）。
- 性能差异可忽略：浏览器实现 `sqrt` 通常有专门优化，但 CSS 中无感知差异。

## 五、abs() 与 sign()：符号处理与镜像布局

`abs(x)` 返回绝对值（去除符号）。`sign(x)` 返回符号函数值：x>0 返回 1，x=0 返回 0，x<0 返回 -1。

### 语法与示例

```css
/* abs：绝对值 */
transform: translateX(abs(var(--offset)));

/* sign：符号函数 (-1, 0, 1) */
opacity: calc(0.5 + sign(var(--v)) * 0.5);   /* v>0 时 opacity=1，v<0 时 opacity=0 */
```

### 典型场景 1：镜像对称布局

两个圆围绕中心对称，左右偏移用 `abs()` 统一计算，避免写两套规则：

```css
.mirror {
  --offset: 80px;
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
  /* 左圆：abs 把负偏移转正后取反 */
  transform: translateX(calc(-1 * abs(var(--offset))));
  background: #2563eb;
}
.dot--right {
  /* 右圆：直接用 abs 偏移 */
  transform: translateX(abs(var(--offset)));
  background: #dc2626;
}
```

即使 `--offset` 是负值（用户输入 -80px），`abs()` 也会自动转正，两个圆依然对称分布。

### 典型场景 2：基于 sign 的状态切换

`sign()` 把数值转换为方向标识，常用于"有值/无值"或"正/负"的状态切换：

```css
.indicator {
  --v: 0;
  /* sign(v) 返回 0 时透明度 0.3，返回 ±1 时透明度 0.9 */
  opacity: calc(0.3 + abs(sign(var(--v))) * 0.6);
}

.stripe {
  --i: 0;
  /* 基于 mod + sign 实现奇偶切换颜色 */
  background: hsl(220 70% 50% / calc(sign(mod(var(--i), 2)) * 0.6 + 0.2));
}
```

`sign` 与 `abs` 常组合使用：`abs(sign(x))` 把任意非零值统一为 1（去除正负方向信息，只保留"是否有值"）。

## 六、mod() 与 rem()：余数运算的符号差异

`mod(x, y)` 与 `rem(x, y)` 都计算余数，但**结果符号不同**，这是数学定义的差异：

- `rem(x, y)`：定义为 `x - y * trunc(x / y)`，结果符号与 **x 相同**。
- `mod(x, y)`：定义为 `x - y * floor(x / y)`，结果符号与 **y 相同**。

### 正数场景：结果相同

```
mod(7, 3) = 1     rem(7, 3) = 1     两者相同
mod(10, 4) = 2    rem(10, 4) = 2    两者相同
```

### 负数场景：结果不同

```
mod(-7, 3) = 2     rem(-7, 3) = -1     mod 符号同 y=3（正），rem 符号同 x=-7（负）
mod(7, -3) = -2    rem(7, -3) = 1      mod 符号同 y=-3（负），rem 符号同 x=7（正）
mod(-7, -3) = -1   rem(-7, -3) = -1    两者相同（同负）
```

### 选择建议

| 场景 | 推荐函数 | 理由 |
|------|---------|------|
| 循环周期（条纹、角度循环） | `mod` | 结果总是 `[0, \|y\|)` 范围，循环连续 |
| 截断余数（保留被除数方向） | `rem` | 与 JavaScript `%` 行为一致 |
| 角度取模（如 0..360°） | `mod` | 负角度自动转正，如 `mod(-30, 360) = 330` |
| 时间取整（如分钟转秒） | `rem` | 保留方向信息，便于判断正负 |

### 典型场景：循环条纹背景

用 `mod()` 实现奇偶切换颜色，相比 `:nth-child(even)` 更通用，可基于任意自定义属性：

```css
.stripes {
  display: flex;
  gap: 4px;
}
.stripe {
  --i: 0;
  width: 36px;
  height: 60px;
  /* mod(i, 2) 返回 0 或 1，sign 转为 0/1 后控制透明度 */
  background: hsl(220 70% 50% / calc(sign(mod(var(--i), 2)) * 0.6 + 0.2));
}
.stripe:nth-child(1) { --i: 0; }
.stripe:nth-child(2) { --i: 1; }
.stripe:nth-child(3) { --i: 2; }
.stripe:nth-child(4) { --i: 3; }
/* 偶数条纹透明度 0.8（深蓝），奇数透明度 0.2（浅蓝） */
```

## 七、round()：四策略取整与网格对齐

`round(策略, x, step?)` 把数值吸附到 `step` 的整数倍。`step` 省略时默认为 1。

### 四种策略详解

| 策略 | 行为 | round(策略, 17, 8) | round(策略, -17, 8) |
|------|------|------|------|
| `nearest` | 四舍五入到最近 | 16 | -16 |
| `to-zero` | 向零方向 | 16 | -16 |
| `up` | 向正无穷方向 | 24 | -16 |
| `down` | 向负无穷方向 | 16 | -24 |

### 关键差异

- `nearest` 与 `to-zero` 在正数场景结果相同，差异在负数（nearest 可能远离零，to-zero 总是靠近零）。
- `up` 与 `down` 是强制方向，无论数值正负都按固定方向取整。

### 典型场景 1：8px 网格对齐

设计系统中常见 8px 网格规范，任意尺寸都应是 8 的整数倍。用 `round(nearest, ...)` 自动吸附：

```css
.card {
  --w: 175px;
  /* 把任意宽度吸附到 8px 网格 */
  width: calc(round(nearest, calc(var(--w) / 1px), 8) * 1px);
}
```

175px 吸附为 176px（最近的 8 的倍数）。

### 典型场景 2：响应式断点吸附

把视口宽度吸附到预设断点（如 375 / 768 / 1280），避免微小变化触发响应式切换：

```css
.layout {
  /* 把视口宽度吸附到 8px，避免 1px 抖动触发响应式切换 */
  --vw-snap: round(nearest, calc(100vw / 1px), 8);
  /* 根据吸附后的宽度选择布局 */
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}
```

### 典型场景 3：键盘焦点步进

键盘按住箭头键调整数值时，希望每次步进 0.1 而不是 0.01（避免浮点累积误差）：

```css
@property --t {
  syntax: '<number>';
  inherits: false;
  initial-value: 0;
}

.progress {
  --t: 0;
  /* 强制时间到 0.1 的整数倍 */
  --t-snapped: round(to-zero, var(--t), 0.1);
  width: calc(var(--t-snapped) * 100%);
}
```

## 八、实战案例与最佳实践

### 案例 1：指数衰减动画

`exp(-t)` 实现自然指数衰减，比 `ease-out` 更平滑（CSS easing 函数是分段逼近，`exp` 是连续函数）：

```css
@property --t {
  syntax: '<number>';
  inherits: false;
  initial-value: 0;
}

.decay {
  --t: 0;
  /* exp(-t) 从 1 衰减到 0，乘以初始位移 */
  transform: translateY(calc(exp(calc(-1 * var(--t))) * 100px));
  opacity: calc(exp(calc(-1 * var(--t))));
  animation: fade 1s linear forwards;
}

@keyframes fade {
  to { --t: 3; }
}
```

### 案例 2：基于 log 的数据可视化

把数值范围 1..10000 压缩为对数刻度的颜色渐变：

```css
.heatmap-cell {
  --v: 1;
  /* log(v) / log(10000) ∈ [0, 1]，作为 hue 与 lightness */
  --ratio: calc(log(var(--v)) / log(10000));
  background: hsl(calc(240 - var(--ratio) * 240), 70%, calc(40 + var(--ratio) * 20));
}
```

`v=1` 时颜色蓝（hue 240），`v=10000` 时颜色红（hue 0），中间值平滑过渡。

### 案例 3：pow 实现可调节缓动曲线

设计系统希望统一缓动曲线，但不同组件需要不同强度。用 `pow(t, k)` 配合 CSS 变量实现：

```css
:root {
  --easing-k: 2.5;   /* 全局缓动强度 */
}

@mixin animated {
  --t: 0;
  transform: translateX(calc(pow(var(--t), var(--easing-k)) * 100%));
  animation: slide 0.6s ease-out forwards;
}

.card-soft   { --easing-k: 1.5; }   /* 弱缓动，几乎线性 */
.card-medium { --easing-k: 2.5; }   /* 中等缓动 */
.card-strong { --easing-k: 4; }     /* 强缓动，先慢后快明显 */
```

### 案例 4：mod + sign 实现条纹背景

用 `mod` 计算奇偶性，`sign` 转为 0/1，结合 `calc` 实现纯 CSS 条纹（无需 `repeating-linear-gradient`）：

```css
.stripes {
  --n: 6;
  display: flex;
}
.stripe {
  --i: 0;
  flex: 1;
  height: 60px;
  /* mod(i, 2) ∈ {0, 1}，sign 转为 0/1，控制透明度 */
  background: hsl(220 70% 50% / calc(sign(mod(var(--i), 2)) * 0.5 + 0.25));
}
.stripe:nth-child(odd)  { --i: 0; }   /* 透明度 0.25 */
.stripe:nth-child(even) { --i: 1; }   /* 透明度 0.75 */
```

### 最佳实践

1. **优先用语义化函数**：`sqrt(x)` 优于 `pow(x, 0.5)`，`exp(x)` 优于 `pow(e(), x)`，提升可读性。
2. **`calc` 中处理单位**：数学函数参数与返回值都是无单位数值，所有单位运算交给 `calc`。
3. **提供静态回退**：旧浏览器不支持时整个声明无效，先写静态值再覆盖：
   ```css
   .bar { width: 80%; }                              /* 回退 */
   .bar { width: calc(log(var(--v)) * 100%); }       /* 增强 */
   ```
4. **`@supports` 检测**：复杂场景下用特性查询分级增强：
   ```css
   @supports (width: calc(log(10) * 1px)) {
     .enhanced { /* 仅支持时启用 */ }
   }
   ```
5. **`@property` 注册自定义属性**：让 `pow(t, k)` 中的 `--t` 可平滑插值，避免关键帧抖动。
6. **避免过深嵌套**：`exp(log(pow(x, 2)))` 等深嵌套虽合法但可读性差，复杂逻辑建议拆为多个变量。
7. **浏览器支持检测**：Chrome 128+ / Firefox 128+ / Safari 16.4+ 已进入 Baseline 2024，主流环境可用；旧版本需降级。

## 九、浏览器兼容性

| 函数 | Chrome | Firefox | Safari | Baseline |
|------|--------|---------|--------|----------|
| `exp()` | 128+ | 128+ | 16.4+ | 2024 |
| `log()` | 128+ | 128+ | 16.4+ | 2024 |
| `sqrt()` | 128+ | 128+ | 16.4+ | 2024 |
| `pow()` | 128+ | 128+ | 16.4+ | 2024 |
| `abs()` | 128+ | 128+ | 16.4+ | 2024 |
| `sign()` | 128+ | 128+ | 16.4+ | 2024 |
| `mod()` | 128+ | 128+ | 16.4+ | 2024 |
| `rem()` | 128+ | 128+ | 16.4+ | 2024 |
| `round()` | 128+ | 128+ | 16.4+ | 2024 |

注：`min()` / `max()` / `clamp()` 早已进入 Baseline（2020+），与本文所述的 Level 4 新函数兼容性独立。`hypot()` 三角函数部分已于 2023 年进入 Baseline（Chrome 111+）。

## 十、总结

CSS 数学函数把指数、对数、幂、绝对值、取整等运算下沉到 CSS 渲染层，与已发布的 [CSS 三角函数](/blog/trigonometric-guide) 构成完整的 CSS 数学函数体系。两者均属于 CSS Values Module Level 4，共同让样式层具备完整的数学计算能力，把原本依赖 JavaScript 的几何与数值运算变成纯声明式表达。

核心要点回顾：

- **参数无单位**：所有数学函数参数与返回值都是无单位数值，单位运算交给 `calc`。
- **指数对数**：`exp()` 用于自然指数增长，`log()` 支持任意底数，常用于对数刻度。
- **幂运算**：`sqrt()` 与 `pow()` 是幂运算双兄弟，优先用语义化的 `sqrt`。
- **符号处理**：`abs()` 实现镜像布局，`sign()` 实现状态切换。
- **余数运算**：`mod()` 符号同 y（循环连续），`rem()` 符号同 x（与 JS `%` 一致）。
- **取整运算**：`round()` 四策略覆盖四舍五入、向零、向上、向下场景，常用于网格对齐。
- **降级策略**：先静态回退声明，再用数学函数覆盖；或用 `@supports` 检测后分级增强。

掌握这 9 个数学函数后，你可以用纯 CSS 实现指数增长、对数刻度、幂律缓动、镜像对称、循环条纹、网格对齐等场景，无需 JavaScript 介入。结合本站提供的 [CSS 数学函数生成器](/css-math)，可在可视化界面中实时调节参数预览效果，一键复制 CSS 代码到项目中使用。
