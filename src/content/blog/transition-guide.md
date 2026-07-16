---
title: 'CSS transition 过渡指南：cubic-bezier 曲线与 steps 阶跃'
description: '深入解析 CSS transition 过渡系统：四大子属性、cubic-bezier 曲线数学原理、steps 阶跃函数、可过渡属性清单与 GPU 合成层优化实践。'
pubDate: 2026-07-13
tags: ['CSS', 'transition', '过渡', 'cubic-bezier', '贝塞尔曲线', 'timing-function', 'steps', '回弹', '缓动函数', '前端开发', '设计工具']
relatedTool: '/transition'
---

CSS `transition` 是前端交互动效的基础能力，它在属性值变化时自动产生平滑过渡。与 `animation` 的主动驱动不同，`transition` 是被动触发——仅在 `:hover`、`:focus`、class 切换等场景下播放一次。本文系统解析 transition 的四大子属性、cubic-bezier 曲线原理、steps 阶跃函数与回弹效果实现。

## 一、transition 属性概览与四大子属性

`transition` 是 4 个子属性的简写，按固定顺序排列：

```css
.element {
  transition: transform 0.3s ease 0s;
  /* 分别对应：
     transition-property: transform;
     transition-duration: 0.3s;
     transition-timing-function: ease;
     transition-delay: 0s; */
}
```

四大子属性职责：

| 子属性 | 作用 | 示例值 |
|--------|------|--------|
| `transition-property` | 指定要过渡的 CSS 属性 | `transform`、`opacity`、`all` |
| `transition-duration` | 过渡时长 | `0.3s`、`500ms` |
| `transition-timing-function` | 缓动函数（速度曲线） | `ease`、`linear`、`cubic-bezier()`、`steps()` |
| `transition-delay` | 延迟开始时间 | `0s`、`0.1s` |

**多属性过渡**用逗号分隔，每段独立配置时长与缓动：

```css
.box {
  transition: transform 0.3s ease, opacity 0.2s ease-in 0.1s;
}
```

注意：`transition-duration` 是唯一**必填**的子属性，省略其他三个将使用默认值（property 默认 `all`、timing-function 默认 `ease`、delay 默认 `0s`）。

## 二、transition-property：可过渡属性与 all 的风险

并非所有 CSS 属性都能过渡。可过渡的属性必须是**可插值的**——即能够计算两个值之间的中间值。

**可过渡属性**（数值、颜色、长度等可计算类型）：

- 变换类：`transform`、`opacity`、`filter`
- 颜色类：`color`、`background-color`、`border-color`、`box-shadow`、`text-shadow`
- 尺寸类：`width`、`height`、`margin`、`padding`、`border-radius`
- 定位类：`top`、`left`、`right`、`bottom`
- 排版类：`font-size`、`line-height`、`letter-spacing`

**不可过渡属性**（离散值无法插值）：

- `display`（`none` ↔ `block` 无中间态）
- `position`（`static` ↔ `absolute` 无中间态）
- `float`、`clear`
- `font-family`（字体名是离散值）

### transition-property: all 的风险

`all` 会对元素的所有可过渡属性应用过渡，虽然写法简洁，但有两个隐患：

1. **性能风险**：无意中触发了不想过渡的属性（如 `padding`、`margin` 在布局调整时），导致意外重排，影响页面流畅度。
2. **预期不符**：某些属性变化（如 `left`/`top` 在拖拽时）被过渡后会产生滞后感，影响交互响应。

最佳实践：**显式声明需要过渡的属性**，如 `transition: transform 0.3s, opacity 0.2s;`，避免使用 `all`。

## 三、transition-timing-function：缓动函数体系

缓动函数控制过渡的速度曲线，决定了"快慢节奏"。CSS 提供三类缓动函数：

### 1. 预设关键字

| 关键字 | 等价 cubic-bezier | 特点 | 适用场景 |
|--------|-------------------|------|----------|
| `linear` | `cubic-bezier(0, 0, 1, 1)` | 匀速 | 旋转、进度条 |
| `ease`（默认） | `cubic-bezier(0.25, 0.1, 0.25, 1)` | 慢入快出慢收 | 通用过渡 |
| `ease-in` | `cubic-bezier(0.42, 0, 1, 1)` | 慢入快出 | 淡出、退出 |
| `ease-out` | `cubic-bezier(0, 0, 0.58, 1)` | 快入慢出 | 淡入、入场 |
| `ease-in-out` | `cubic-bezier(0.42, 0, 0.58, 1)` | 慢入慢出 | 弹跳、脉冲 |

### 2. cubic-bezier() 自定义曲线

```css
transition: transform 0.4s cubic-bezier(0.68, -0.55, 0.27, 1.55);
```

四个参数 `cubic-bezier(x1, y1, x2, y2)` 定义一条三次贝塞尔曲线，详见下一章。

### 3. steps() 阶跃函数

```css
transition: opacity 0.8s steps(4, jump-end);
```

将过渡分成 N 个等长阶跃，详见第五章。

## 四、cubic-bezier 曲线编辑原理与回弹效果

`cubic-bezier(x1, y1, x2, y2)` 是 transition 最强大的缓动机制，它通过两个控制点定义一条三次贝塞尔曲线：

### 数学原理

三次贝塞尔曲线有 4 个点：
- **P0 = (0, 0)** 固定起点
- **P1 = (x1, y1)** 可调控制点 1
- **P2 = (x2, y2)** 可调控制点 2
- **P3 = (1, 1)** 固定终点

曲线上某点（参数 t ∈ [0,1]）的坐标由参数方程计算：

```
B(t) = (1-t)³·P0 + 3(1-t)²t·P1 + 3(1-t)t²·P2 + t³·P3
```

- **x 轴**表示时间进度（0 到 1）
- **y 轴**表示属性值进度（0 到 1）
- **曲线斜率**表示瞬时速度：陡峭=快，平缓=慢

### 坐标约束

- **x1、x2 必须在 [0, 1]**：CSS 规范要求，保证时间单调递增
- **y1、y2 可以超出 [0, 1]**：这是实现回弹效果的关键

### 回弹效果实现

y 轴超出 [0,1] 产生两种回弹：

1. **超出后回弹（overshoot）**：`y2 > 1`，元素先超过目标值再回弹。如 `cubic-bezier(0.34, 1.56, 0.64, 1)` 产生弹性放大效果——元素放大到 1.15 倍后回弹到 1.0 倍。

2. **先反向再前进（anticipation）**：`y1 < 0`，元素先轻微反向再加速前进。如 `cubic-bezier(0.68, -0.55, 0.27, 1.55)` 同时具有反向预备与超出回弹——元素先缩小再放大超出再回弹。

本工具的[曲线编辑器](/transition)支持拖拽 P1/P2 实时调整，y 轴允许超出 [0, 1] 范围（限制在 [-0.5, 1.5]）实现回弹。

### 常见回弹曲线

| 名称 | cubic-bezier | 效果 |
|------|--------------|------|
| ease-out-back | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 超出后回弹 |
| ease-in-back | `cubic-bezier(0.36, 0, 0.66, -0.56)` | 先反向再前进 |
| ease-in-out-back | `cubic-bezier(0.68, -0.55, 0.27, 1.55)` | 双向回弹 |
| elastic | `cubic-bezier(0.5, -0.5, 0.1, 1.5)` | 强弹性 |

注意：回弹效果仅对**可超出值域的属性**有效（如 `transform: scale`），对 `opacity` 等限制在 [0,1] 的属性，超出部分会被截断为边界值。

## 五、steps() 阶跃函数详解

`steps(N, jump-term)` 将过渡分成 N 个等长的阶跃跳变，而非平滑插值：

```css
transition: transform 0.8s steps(4, jump-end);
```

### jump-start 与 jump-end 的区别

以 `steps(4, ...)` 为例，过渡时长 0.8s，分 4 步：

- **`jump-end`**（等价旧语法 `step-end`）：每步在**结束时**跳变。进度曲线为 `0% → 0% → 25% → 50% → 75% → 100%`。前 0.2s 保持 0%，0.2s 时跳到 25%，以此类推。

- **`jump-start`**（等价旧语法 `step-start`）：每步在**开始时**跳变。进度曲线为 `0% → 25% → 50% → 75% → 100% → 100%`。0s 时立即跳到 25%，0.2s 时跳到 50%，最后 0.2s 保持 100%。

### 其他跳跃项

- `jump-none`：不分额外跳跃，N 步均匀分布在 [0,1]，首尾不额外跳
- `jump-both`：首尾都额外跳跃，共 N+1 个跳变点

这两个较少使用，`jump-start` 与 `jump-end` 覆盖 90% 场景。

### steps() 适用场景

steps() 适合制作"机械感"动画：
- 像素风动效（8-bit 游戏风格）
- 加载进度条阶跃效果
- 数字滚动计数器
- 雪碧图（sprite）逐帧动画

本工具支持 1-20 步可调，`jump-start`/`jump-end` 自由切换。

## 六、transition 与 animation 选型对比

两者都产生过渡效果，但触发机制与控制粒度不同：

| 特性 | transition | animation |
|------|------------|-----------|
| 触发方式 | 被动（属性值变化时） | 主动（应用即播放） |
| 关键帧 | 仅起止两态 | @keyframes 任意中间帧 |
| 循环 | 单次 | 支持 `infinite` |
| 方向 | 仅正向 | `normal`/`reverse`/`alternate` |
| 暂停 | 不支持 | `paused`/`running` |
| 填充模式 | 无 | `forwards`/`backwards`/`both` |
| 适用场景 | 悬停反馈、状态切换 | 加载动画、入场效果、循环动效 |

### 选型建议

- **简单悬停反馈**（按钮变色、卡片抬起）：用 `transition`
- **状态切换**（展开/折叠、显隐）：用 `transition`
- **加载动画**（旋转 spinner、脉冲点）：用 `animation`
- **入场效果**（淡入、滑入）：用 `animation` + `fill-mode: both`
- **循环动效**（呼吸灯、波浪）：用 `animation` + `infinite`

两者经常配合使用：`transition` 处理交互反馈，`animation` 处理持续动效。配合站点的 [animation 动画生成器](/animation)可覆盖全部动效场景。

## 七、性能优化与 GPU 合成层

### 优先选择合成层属性

CSS 属性按性能开销分三级：

1. **合成层属性（最优）**：`transform`、`opacity`、`filter`
   - GPU 加速，不触发重排（reflow），仅触发重绘（repaint）+ 合成（composite）
   - 动画首选，可保持 60fps

2. **布局属性（慎用）**：`width`、`height`、`top`、`left`、`margin`、`padding`
   - 触发重排（reflow），性能开销大
   - 避免在动画中使用

3. **绘制属性（中等）**：`color`、`background-color`、`box-shadow`、`border-radius`
   - 触发重绘（repaint），不触发重排
   - 性能介于两者之间

### will-change 提示

对于频繁过渡的元素，可提前声明 `will-change` 提示浏览器创建合成层：

```css
.box {
  will-change: transform, opacity;
  transition: transform 0.3s, opacity 0.2s;
}
```

注意：`will-change` 应仅在需要时添加，过度使用会导致内存占用过高。过渡结束后可移除。

### 避免同时过渡过多属性

每个过渡属性都会占用合成层资源，同时过渡 5 个以上属性可能导致掉帧。优先精简到 1-2 个核心属性。

## 八、应用场景与配套工具协同

### 典型应用场景

1. **按钮悬停反馈**：
   ```css
   .btn {
     transition: transform 0.2s ease, box-shadow 0.2s ease;
   }
   .btn:hover {
     transform: translateY(-2px);
     box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
   }
   ```

2. **卡片展开/折叠**：
   ```css
   .card {
     transition: max-height 0.4s ease, opacity 0.3s ease;
   }
   ```

3. **主题切换**（深色/浅色模式）：
   ```css
   :root {
     transition: background-color 0.3s ease, color 0.3s ease;
   }
   ```

4. **弹性入场效果**：
   ```css
   .modal {
     transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
   }
   ```

### 配套工具协同

- [CSS transition 过渡生成器](/transition)：可视化配置四大属性，cubic-bezier 曲线编辑器
- [CSS animation 动画生成器](/animation)：@keyframes 关键帧编辑，复杂循环动效
- [CSS transform 可视化工具](/transform)：调好静态变换值，再组合成过渡
- [CSS box-shadow 生成器](/box-shadow)：调好阴影值，配合 transition 实现悬停阴影动效
- [CSS gradient 渐变生成器](/gradient)：调好渐变值，配合 transition 实现背景过渡

### transition 与 animation 的黄金组合

页面动效体系的标准配置：
- **交互反馈层**：`transition` 处理按钮悬停、卡片抬起、输入框聚焦等即时反馈
- **氛围动效层**：`animation` 处理加载 spinner、背景粒子、呼吸灯等持续动效
- **入场动画层**：`animation` + `fill-mode: both` 处理首屏内容渐入、模态框弹出

三层动效各司其职，共同构成流畅的用户体验。配合本工具的 cubic-bezier 曲线编辑器，可精确调校每一层动效的节奏感。
