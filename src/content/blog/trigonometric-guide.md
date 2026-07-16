---
title: 'CSS 三角函数指南：sin/cos/tan/atan2 与极坐标圆形布局'
description: '系统讲解 CSS 三角函数：sin/cos/tan/asin/acos/atan/atan2/hypot 与 pi()/e() 常量，弧度与角度单位、圆周布局、振荡动画、朝向计算、玫瑰曲线与向日葵螺旋实战案例。'
pubDate: 2026-07-17
tags: ['CSS', '三角函数', 'sin', 'cos', 'tan', 'atan2', 'hypot', 'pi()', 'e()', '极坐标', '圆形布局', '波浪动画', '玫瑰曲线', '黄金角', '向日葵螺旋', 'CSS 数学函数', 'CSS Values Level 4', 'Baseline 2023', '前端开发']
relatedTool: '/trigonometric'
---

CSS 三角函数是 CSS Values Module Level 4 引入的数学函数集，包含 `sin()` / `cos()` / `tan()` / `asin()` / `acos()` / `atan()` / `atan2()` / `hypot()` 及常量 `pi()` / `e()`。自 Chrome 111+ / Firefox 118+ / Safari 15.4+ 起原生支持，已进入 Baseline 2023，可在生产环境放心使用。它把原本必须用 JavaScript 计算的圆周坐标、振荡位移、朝向角度等工作交给 CSS 表达式完成，让样式层真正具备数学计算能力。本文系统解析 8 个三角函数的语法、参数、返回值与实战场景。

## 一、诞生背景与核心价值

三角函数进入 CSS 的核心动机，是把"几何计算"从 JavaScript 运行时下沉到 CSS 渲染层。在此之前，三类高频场景必须依赖 JS：

- **圆周布局**：N 个元素沿圆周均匀分布，每个元素需要 `translate(cos(θ)·r, sin(θ)·r)`，JS 计算后写入 `transform`，响应式调整半径需重新计算所有元素。
- **振荡动画**：sin 波驱动的上下浮动，过去需用 `@keyframes` 模拟，关键帧数量决定平滑度，参数调整不直观。
- **朝向与距离**：指针朝向鼠标需 `atan2(dy, dx)` 计算角度，两点距离需 `hypot(dx, dy)`，都是 JS 的强项。

CSS 三角函数让这些场景变成纯声明式：

```css
/* 圆周布局：第 2 个元素位于 45° 位置 */
.dot:nth-child(2) {
  transform: translate(
    calc(cos(45deg) * 100px),
    calc(sin(45deg) * 100px)
  );
}
```

```css
/* 振荡动画：sin(θ) 乘以振幅得到位移 */
@keyframes bob {
  0%   { transform: translateY(calc(sin(0deg) * 40px)); }
  25%  { transform: translateY(calc(sin(90deg) * 40px)); }
  50%  { transform: translateY(calc(sin(180deg) * 40px)); }
  75%  { transform: translateY(calc(sin(270deg) * 40px)); }
  100% { transform: translateY(calc(sin(360deg) * 40px)); }
}
```

```css
/* 朝向鼠标：JS 仅负责写入坐标差值，CSS 用 atan2 计算角度 */
.pointer {
  transform: rotate(calc(atan2(var(--my), var(--mx)) * 1rad));
}
```

这种"几何计算下沉 CSS"带来三大好处：一是**响应式零成本**，调半径只需改一个变量；二是**SSR 友好**，无需等待 JS 执行；三是**性能更优**，CSS 表达式在渲染层求值，避免 JS 布局抖动。

## 二、弧度与角度：CSS 三角函数的参数单位

CSS 三角函数的参数单位是**弧度（rad）**，但 CSS 容许使用 `deg` 后缀的角度值，浏览器自动转换为弧度。这是与 JavaScript `Math.sin()` 等原生 API 的核心差异——`Math.sin(60)` 接受弧度数值，而 `sin(60deg)` 接受带单位的 CSS 角度。

### 单位转换公式

```
1rad = 180deg / π
1deg = π / 180 rad
```

CSS 内可用 `pi()` 常量完成转换：

```css
/* 把 60° 转换为弧度 */
calc(60deg * pi() / 180)
```

### sin/cos/tan 的取值

| 输入 | sin | cos | tan |
|------|-----|-----|-----|
| 0deg | 0 | 1 | 0 |
| 30deg | 0.5 | 0.866 | 0.577 |
| 45deg | 0.707 | 0.707 | 1 |
| 60deg | 0.866 | 0.5 | 1.732 |
| 90deg | 1 | 0 | ∞（无穷大） |
| 180deg | 0 | -1 | 0 |
| 270deg | -1 | 0 | ∞ |
| 360deg | 0 | 1 | 0 |

注意 `tan(90deg)` 在数学上为无穷大，CSS 中会返回一个极大的有限值（具体由实现决定），生产中应避免 90° 倍数的 tan 输入。

### 返回值单位

- `sin` / `cos` / `tan` 返回**无单位**数值
- `asin` / `acos` / `atan` / `atan2` 返回**弧度**值，需用 `calc(... * 1rad)` 才能用于 `rotate()` 等接受角度的属性

```css
/* atan2 返回弧度数值，必须乘以 1rad 转换为 CSS 角度 */
transform: rotate(calc(atan2(var(--y), var(--x)) * 1rad));
```

## 三、sin() 与 cos()：圆周布局核心

圆周上某点的笛卡尔坐标为 `(r·cos(θ), r·sin(θ))`，其中 θ 是角度、r 是半径。这是 CSS 圆周布局的数学基础。

### 均分 N 个元素

每个元素角度 = `360deg / N * i`，例如 8 个元素每 45° 一个：

```css
.dot:nth-child(1) { transform: translate(calc(cos(0deg) * 100px),   calc(sin(0deg) * 100px)); }
.dot:nth-child(2) { transform: translate(calc(cos(45deg) * 100px),  calc(sin(45deg) * 100px)); }
.dot:nth-child(3) { transform: translate(calc(cos(90deg) * 100px),  calc(sin(90deg) * 100px)); }
/* ... 以此类推 */
```

### 响应式半径

把半径存入自定义属性，媒体查询改变一个变量即可全量调整：

```css
.stage {
  --radius: 100px;
}
@media (min-width: 768px) {
  .stage { --radius: 140px; }
}
.dot:nth-child(1) {
  transform: translate(calc(cos(0deg) * var(--radius)), calc(sin(0deg) * var(--radius)));
}
```

### 旋转方向：CSS 坐标系的特点

CSS 坐标系 y 轴向下为正，所以 `sin(90deg) = 1` 对应**向下**位移。若希望 0° 朝上、90° 朝右（数学坐标系），可在 sin 前加负号：

```css
/* 0° 朝上、90° 朝右（数学坐标系） */
transform: translate(calc(cos(θ) * r), calc(sin(θ) * -r));
```

### 与 transform-origin 配合

另一种圆周布局技巧是用 `rotate + translateY` 组合，避免 cos/sin 计算：

```css
.dot {
  transform-origin: center 100px;  /* 旋转中心在元素上方 100px */
  transform: rotate(45deg);
}
```

但这种方式无法精确控制"圆周半径变量"，因此 cos/sin 计算仍是首选。

## 四、tan() 与 atan2()：朝向计算与象限判定

### tan() 的局限

`tan(θ) = sin(θ)/cos(θ)`，是正切值。`atan(tan_value)` 可反向求出角度，但只能返回 (-π/2, π/2) 范围，无法区分象限：

- `atan(1)` 既可能是 45°，也可能是 225°（第三象限），atan 无法区分
- `atan(-1)` 既可能是 -45°（315°），也可能是 135°（第二象限）

### atan2(y, x) 的优势

`atan2(y, x)` 接受两个参数，根据 y 与 x 的**符号**确定象限，返回 (-π, π] 完整范围：

| y 符号 | x 符号 | atan2 返回象限 |
|--------|--------|----------------|
| + | + | 第一象限 [0, π/2) |
| + | - | 第二象限 (π/2, π] |
| - | - | 第三象限 (-π, -π/2) |
| - | + | 第四象限 (-π/2, 0) |

### 朝向鼠标的完整实现

```html
<div class="stage">
  <div class="pointer"></div>
</div>
```

```css
.stage {
  position: relative;
  width: 300px;
  height: 300px;
  border-radius: 50%;
  border: 2px dashed #cbd5e1;
}
.pointer {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 4px;
  height: 100px;
  margin: 0 0 0 -2px;
  background: #2563eb;
  transform-origin: top center;
  /* atan2 返回弧度，必须 * 1rad */
  transform: rotate(calc(atan2(var(--my), var(--mx)) * 1rad));
}
```

```javascript
const stage = document.querySelector('.stage');
const pointer = document.querySelector('.pointer');
stage.addEventListener('mousemove', (e) => {
  const rect = stage.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  // 写入相对中心的坐标差值
  pointer.style.setProperty('--mx', `${e.clientX - cx}`);
  pointer.style.setProperty('--my', `${e.clientY - cy}`);
});
```

JS 仅负责写入两个数字，所有角度计算都在 CSS 完成，性能远优于 JS 直接算 `Math.atan2` 后写入 `transform: rotate(${angle}deg)`。

## 五、hypot() 与 pi()/e()：距离与数学常量

### hypot() 计算欧几里得距离

`hypot(a, b, c, ...)` 计算 √(a² + b² + c² + ...)，即向量的模长：

```css
/* 二维距离：√((x₂-x₁)² + (y₂-y₁)²) */
distance: calc(hypot(var(--dx), var(--dy)));
```

**优势**：

1. 语法简洁，相比 `sqrt(pow(a,2) + pow(b,2))` 显著清晰
2. 数值稳定性好——避免大数平方溢出、小数平方下溢（内部用 Kahan 求和等优化算法）
3. 支持多参数，三维距离直接 `hypot(dx, dy, dz)`

**典型用途**：

- 游戏开发中角色与目标的距离判定
- 动画中根据距离调整缩放（如视差效果）
- 物理模拟的速度合成

### pi() 圆周率常量

`pi()` 返回 3.14159...，必须带括号调用。常见用途：

```css
/* 弧度转度数 */
1rad = calc(180deg / pi())

/* 黄金角：360° × (3-√5)/2 ≈ 137.508° */
--golden-angle: calc(180deg * pi() * (3 - sqrt(5)) / 2);

/* 完整圆周 */
calc(2 * pi() * 1rad)  /* 等于 360deg */
```

### e() 自然常数

`e()` 返回 2.71828...，用于指数增长/衰减动画：

```css
/* 指数衰减 */
opacity: calc(exp(-1 * var(--t)));
/* exp() 函数也已支持，可不用 e() */
```

`e()` 在 CSS 中相对少见，但与 `exp()` / `log()` 等指数对数函数配合可构造复杂动画曲线。

## 六、sin/cos 振荡动画：关键帧采样技巧

CSS 动画的关键帧是离散点，浏览器自动插值中间帧。要实现平滑 sin 波，**4 个关键帧足够**——采样 0°/90°/180°/270°/360° 即可：

```css
@keyframes bob {
  0%   { transform: translateY(calc(sin(0deg) * 40px)); }
  25%  { transform: translateY(calc(sin(90deg) * 40px)); }
  50%  { transform: translateY(calc(sin(180deg) * 40px)); }
  75%  { transform: translateY(calc(sin(270deg) * 40px)); }
  100% { transform: translateY(calc(sin(360deg) * 40px)); }
}
```

`sin(0°)=0`、`sin(90°)=1`、`sin(180°)=0`、`sin(270°)=-1`、`sin(360°)=0`，浏览器在关键帧之间做线性插值时，由于 sin 函数在 0°–90° 区间是凹函数，插值结果会略低于真实 sin 值，但视觉上几乎无差别。若需更精确，可加入 45°/135°/225°/315° 等中间点。

### 多元素波浪效果

多个元素按相位错开形成波浪，每个元素延迟 `duration / count * i`：

```css
.wave-dot:nth-child(1) { animation-delay: 0s; }
.wave-dot:nth-child(2) { animation-delay: -0.5s; }
.wave-dot:nth-child(3) { animation-delay: -1s; }
/* ... 以此类推 */
```

**关键技巧**：使用**负延迟**让动画立即开始，但相位错开。若用正延迟，首个元素会先开始，其他元素延迟期间静止不动。

### @property 时间变量

更高级的方案是用 `@property` 注册自定义属性实现"纯 CSS 时间变量"：

```css
@property --t {
  syntax: '<number>';
  initial-value: 0;
  inherits: false;
}

.dot {
  --t: 0;
  animation: tick 2s linear infinite;
  transform: translateY(calc(sin(var(--t) * 360deg) * 40px));
}

@keyframes tick {
  to { --t: 1; }
}
```

这样无需关键帧采样，浏览器自动按时间计算 sin 值，动画完全平滑。`@property` 自 Chrome 85+ / Firefox 128+ / Safari 16.4+ 起支持。

## 七、浏览器兼容性与渐进增强

### Baseline 2023 支持

CSS 三角函数已进入 **Baseline 2023**，主流浏览器支持情况：

| 浏览器 | 最低版本 | 发布时间 |
|--------|----------|----------|
| Chrome | 111 | 2023-03 |
| Edge | 111 | 2023-03 |
| Firefox | 118 | 2023-09 |
| Safari | 15.4 | 2022-03 |

约 96% 的现代浏览器支持，生产环境可放心使用。

### 渐进增强策略

对不支持三角函数的旧浏览器，CSS 会忽略整个声明，元素保持默认值。推荐用 `@supports` 检测并提供降级方案：

```css
/* 默认：用固定值降级 */
.dot:nth-child(1) {
  transform: translate(100px, 0);
}

/* 增强：支持 sin/cos 时用动态计算 */
@supports (transform: translate(calc(cos(0deg) * 1px), 0)) {
  .dot:nth-child(1) {
    transform: translate(calc(cos(0deg) * 100px), calc(sin(0deg) * 100px));
  }
}
```

对于关键业务场景（如导航圆周布局），降级方案应保证基本可用——元素即使不在精确圆周位置，也应可见可点击。

### 与 JavaScript Math 的差异

| 方面 | CSS 三角函数 | JavaScript Math |
|------|--------------|----------------|
| 参数单位 | 弧度或 deg 角度 | 仅弧度数值 |
| 返回值单位 | sin/cos 无单位；atan2 等为弧度 | 全部为数值（弧度） |
| 调用方式 | `sin(60deg)` | `Math.sin(Math.PI / 3)` |
| 性能 | 渲染层求值，无 JS 开销 | JS 运行时计算，需写入 DOM |

CSS 三角函数并非"替代" JS Math，而是把"几何计算"从 JS 下沉到 CSS，让样式层独立完成布局与动画。

## 八、实战案例与最佳实践

### 案例 1：圆形菜单布局

8 个菜单项沿圆周均匀分布，半径响应式：

```css
.menu {
  --radius: 120px;
  position: relative;
  width: 400px;
  height: 400px;
}
.menu-item {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 56px;
  height: 56px;
  margin: -28px 0 0 -28px;
  border-radius: 50%;
  background: #fff;
  border: 1px solid #e2e8f0;
}
.menu-item:nth-child(1) { transform: translate(calc(cos(0deg) * var(--radius)),    calc(sin(0deg) * var(--radius))); }
.menu-item:nth-child(2) { transform: translate(calc(cos(45deg) * var(--radius)),   calc(sin(45deg) * var(--radius))); }
.menu-item:nth-child(3) { transform: translate(calc(cos(90deg) * var(--radius)),   calc(sin(90deg) * var(--radius))); }
.menu-item:nth-child(4) { transform: translate(calc(cos(135deg) * var(--radius)),  calc(sin(135deg) * var(--radius))); }
.menu-item:nth-child(5) { transform: translate(calc(cos(180deg) * var(--radius)),  calc(sin(180deg) * var(--radius))); }
.menu-item:nth-child(6) { transform: translate(calc(cos(225deg) * var(--radius)),  calc(sin(225deg) * var(--radius))); }
.menu-item:nth-child(7) { transform: translate(calc(cos(270deg) * var(--radius)),  calc(sin(270deg) * var(--radius))); }
.menu-item:nth-child(8) { transform: translate(calc(cos(315deg) * var(--radius)),  calc(sin(315deg) * var(--radius))); }

@media (min-width: 768px) {
  .menu { --radius: 160px; }
}
```

### 案例 2：波形加载指示器

5 个圆点形成水平波浪，相位错开：

```css
.loader {
  display: flex;
  gap: 8px;
  justify-content: center;
}
.loader-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #2563eb;
  animation: wave 1.5s ease-in-out infinite;
}
.loader-dot:nth-child(1) { animation-delay: 0s; }
.loader-dot:nth-child(2) { animation-delay: -0.3s; }
.loader-dot:nth-child(3) { animation-delay: -0.6s; }
.loader-dot:nth-child(4) { animation-delay: -0.9s; }
.loader-dot:nth-child(5) { animation-delay: -1.2s; }

@keyframes wave {
  0%, 100% { transform: translateY(calc(sin(0deg) * 20px)); }
  25%      { transform: translateY(calc(sin(90deg) * 20px)); }
  50%      { transform: translateY(calc(sin(180deg) * 20px)); }
  75%      { transform: translateY(calc(sin(270deg) * 20px)); }
}
```

### 案例 3：指针朝向鼠标

详见第四章完整代码。核心是 JS 仅写入坐标差值，CSS 用 `atan2 * 1rad` 计算角度并旋转。

### 案例 4：向日葵种子螺旋

黄金角 137.508° 旋转，半径按 √i 递增，形成自然界中的螺旋分布：

```css
.seed:nth-child(1) {
  transform: translate(calc(cos(137.508deg) * 0px), calc(sin(137.508deg) * 0px));
}
.seed:nth-child(2) {
  transform: translate(calc(cos(275.016deg) * 10px), calc(sin(275.016deg) * 10px));
}
.seed:nth-child(3) {
  transform: translate(calc(cos(412.524deg) * 14.1px), calc(sin(412.524deg) * 14.1px));
}
/* ... 以此类推，每个种子角度递增 137.508°，半径递增 √i */
```

黄金角可由 `pi()` 计算得到：

```css
--golden-angle: calc(180deg * pi() * (3 - sqrt(5)) / 2);
```

### 案例 5：玫瑰曲线

极坐标方程 `r = cos(k·θ)` 形成花瓣图案，k 为偶数时 2k 片花瓣，奇数时 k 片：

```css
.point:nth-child(1) {
  /* θ=0°, r=cos(0)=1, x=r·cos(0)=1, y=r·sin(0)=0 */
  transform: translate(150px, 0);
}
.point:nth-child(2) {
  /* θ=3°, r=cos(12°)≈0.978, x=r·cos(3°)≈0.977, y=r·sin(3°)≈0.051 */
  transform: translate(calc(0.977 * 150px), calc(0.051 * 150px));
}
/* ... 120 个采样点形成完整花瓣 */
```

由于 CSS 不能在 `transform` 里嵌套 `cos(k·θ) * cos(θ)`（同一函数不能直接相乘），玫瑰曲线需在 JS 或构建期预计算每个点的坐标。本工具的"玫瑰曲线"预设提供了完整的预计算代码。

### 最佳实践

1. **优先用 deg 单位**：CSS 三角函数支持 `deg` 角度后缀，可读性远优于裸弧度数值
2. **atan2 必乘 1rad**：返回弧度数值，必须 `* 1rad` 才能用于 rotate
3. **负延迟实现相位错开**：多元素波浪用 `animation-delay: -0.3s` 而非 `0.3s`，避免首帧静止
4. **4 个关键帧足够平滑**：sin/cos 波采样 0°/90°/180°/270°/360° 即可，过多关键帧反而降低性能
5. **JS 仅负责事件输入**：朝向鼠标场景，JS 只写坐标差值到自定义属性，角度计算交给 CSS
6. **@supports 检测提供降级**：关键业务场景需检测 `@supports (transform: translate(calc(cos(0deg) * 1px), 0))` 并提供静态值降级
7. **响应式用变量**：把半径、振幅等存入自定义属性，媒体查询改变一个变量即可全量调整

---

**工具实操**：本文所有案例均可在 [CSS 三角函数生成器](/trigonometric) 中实时调节参数预览——选择预设场景、拖动参数滑块、复制生成的 CSS 代码，无需手写即可获得完整可用的代码。
