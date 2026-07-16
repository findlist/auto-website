---
title: 'CSS animation 动画完全指南：@keyframes 关键帧、八大子属性、缓动函数与性能优化'
description: '深入解析 CSS animation 动画系统：@keyframes 关键帧、八大子属性、cubic-bezier 缓动曲线、fill-mode 填充模式与 GPU 合成层优化实践。'
pubDate: 2026-07-13
tags: ['CSS', 'animation', '动画', 'keyframes', '关键帧', 'timing-function', 'cubic-bezier', 'fill-mode', 'transform', '前端动画', '前端开发', '设计工具']
relatedTool: '/animation'
---

CSS `animation` 是前端动效的核心能力，它通过 `@keyframes` 定义关键帧序列，由浏览器自动插值产生平滑动画。与 `transition` 的被动触发不同，`animation` 可主动循环播放、控制方向、定义任意中间帧。本文系统解析 animation 的八大子属性、关键帧语义、缓动函数与性能优化，并提供实用选型建议。

## 一、animation 属性概览与八大子属性

`animation` 是 8 个子属性的简写，按固定顺序排列：

```css
.element {
  animation: anim 2s ease 0s infinite alternate both running;
  /* 分别对应：
     animation-name: anim;
     animation-duration: 2s;
     animation-timing-function: ease;
     animation-delay: 0s;
     animation-iteration-count: infinite;
     animation-direction: alternate;
     animation-fill-mode: both;
     animation-play-state: running; */
}
```

| 子属性 | 作用 | 示例值 |
|--------|------|--------|
| `animation-name` | 引用的 @keyframes 名称 | `anim` |
| `animation-duration` | 一次周期时长 | `2s` |
| `animation-timing-function` | 缓动函数 | `ease` / `cubic-bezier(...)` |
| `animation-delay` | 开始前延迟 | `0.5s` |
| `animation-iteration-count` | 播放次数 | `3` / `infinite` |
| `animation-direction` | 方向 | `normal` / `alternate` |
| `animation-fill-mode` | 填充模式 | `forwards` / `both` |
| `animation-play-state` | 播放状态 | `running` / `paused` |

简写时至少需要 `name` 与 `duration`，其余可省略。顺序敏感：第一个时间值是 duration，第二个是 delay。建议使用[animation 动画生成器](/animation)可视化调节八大属性，避免手写简写顺序错误。

## 二、@keyframes 关键帧与百分比语义

`@keyframes` 定义动画的关键帧序列，百分比表示动画周期的时间节点：

```css
@keyframes bounce {
  0%   { transform: translateY(0); }
  50%  { transform: translateY(-40px); }
  100% { transform: translateY(0); }
}
```

**百分比语义**：0% 是周期起点（等价于 `from`），100% 是终点（等价于 `to`），中间可插入任意百分比帧。浏览器在相邻关键帧之间自动插值，产生平滑过渡。

**关键规则**：
- 关键帧按数值升序应用，声明顺序无关
- 未声明的属性使用元素原始值，不参与插值
- 重复百分比会合并，后声明覆盖前者
- `!important` 在关键帧中被忽略，不影响优先级

**中间帧的价值**：仅用 0% 和 100% 两帧只能做线性往复，中间帧（25%/50%/75%）能定义复杂轨迹。例如抖动动画需要 4 帧（0% → 25% 左移 → 75% 右移 → 100% 回中），脉冲动画需要 3 帧（0% 原始 → 50% 放大 → 100% 回原始）。

## 三、animation-timing-function 缓动函数与 cubic-bezier

缓动函数控制动画在每个关键帧之间的速度曲线：

| 函数 | 特征 | 适用场景 |
|------|------|----------|
| `linear` | 匀速 | 旋转、进度条 |
| `ease` | 慢入快出慢收（默认） | 通用 |
| `ease-in` | 慢入快出 | 淡出、离场 |
| `ease-out` | 快入慢出 | 淡入、入场 |
| `ease-in-out` | 慢入慢出 | 弹跳、脉冲 |
| `cubic-bezier(n,n,n,n)` | 自定义曲线 | 回弹、overshoot |

**cubic-bezier 的四参数**：定义两个控制点 P1(x1,y1) 与 P2(x2,y2)，P0 固定为 (0,0)，P3 固定为 (1,1)。x 轴是时间进度（0-1），y 轴是动画进度（可超出 0-1 产生 overshoot 回弹）。

```css
/* 回弹效果：y 值超过 1 产生 overshoot */
animation-timing-function: cubic-bezier(0.68, -0.55, 0.27, 1.55);
```

**关键细节**：`timing-function` 作用于"每个关键帧之间"，而非整个动画周期。若需不同段使用不同曲线，可在关键帧内单独声明：

```css
@keyframes mixed {
  0%   { transform: translateX(0); animation-timing-function: ease-in; }
  50%  { transform: translateX(100px); animation-timing-function: ease-out; }
  100% { transform: translateX(0); }
}
```

## 四、animation-fill-mode 填充模式详解

`fill-mode` 控制动画在执行前后的样式应用，是入场动画的关键配置：

| 模式 | 执行前（delay 期间） | 执行后 |
|------|---------------------|--------|
| `none`（默认） | 元素原始样式 | 元素原始样式 |
| `forwards` | 元素原始样式 | 保持最后一帧 |
| `backwards` | 应用第一帧 | 元素原始样式 |
| `both` | 应用第一帧 | 保持最后一帧 |

**常见陷阱**：淡入动画（opacity 0→1）若不设 `fill-mode`，结束后会"消失"回到 opacity:0 的原始状态。解决方式：

```css
.fade-in {
  animation: fadeIn 1s ease-out forwards;
  /* forwards 保持结束帧 opacity:1 */
}
```

**delay 期间的闪烁问题**：若动画有 delay，`none` 模式下元素在 delay 期间显示原始样式（如 opacity:1），delay 结束后突然跳到第一帧（opacity:0），产生闪烁。`backwards` 或 `both` 在 delay 期间就应用第一帧，避免闪烁：

```css
.slide-in {
  animation: slideIn 0.8s ease-out 0.5s both;
  /* both：delay 期间应用第一帧（透明），结束后保持最后一帧（可见） */
}
```

## 五、animation-direction 方向与 alternate 往返

`direction` 控制动画播放方向，`alternate` 系列可实现往返动效而无需定义反向关键帧：

| 方向 | 行为 |
|------|------|
| `normal` | 每次循环 0% → 100% |
| `reverse` | 每次循环 100% → 0% |
| `alternate` | 奇数次正向、偶数次反向 |
| `alternate-reverse` | 奇数次反向、偶数次正向 |

**alternate 的价值**：左右摇摆动画若用 `normal` 需要定义 0%→100%→0% 的完整往返关键帧；用 `alternate` 只需定义 0%→100% 单程，浏览器自动反向播放第二遍，代码量减半：

```css
.swing {
  animation: swing 1.5s ease-in-out infinite alternate;
  /* alternate 自动往返，无需定义反向帧 */
}
@keyframes swing {
  0%   { transform: rotate(-15deg); }
  100% { transform: rotate(15deg); }
}
```

**前提条件**：alternate 要求 `iteration-count` 大于 1 或为 `infinite`，单次播放时与 normal/reverse 无差异。

## 六、transform 与 animation 协同（GPU 合成层动画）

`transform` 是 CSS 属性，`animation` 是驱动属性随时间变化的机制。在 `@keyframes` 中声明 `transform`，浏览器在关键帧之间自动插值，产生平滑动画：

```css
@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-40px); }
}
.bounce { animation: bounce 1s ease-in-out infinite; }
```

**GPU 合成层优势**：`transform` 与 `opacity` 是 GPU 加速的合成层属性，不触发重排（reflow），仅触发重绘（repaint）+ 合成（composite），是动画的首选属性。相比之下，修改 `top/left/width/height/margin` 会触发重排，性能开销大。

**动画属性优先级**（性能从高到低）：
1. `transform`（translate/rotate/scale）— 合成层，最佳选择
2. `opacity` — 合成层，适合淡入淡出
3. `color/background` — 仅重绘，可接受
4. `top/left/width/height` — 触发重排，避免用于动画

配合站点现有的 [transform 可视化工具](/transform)可先调好静态变换值，再到 [animation 动画生成器](/animation)组合成动画关键帧。

## 七、animation 与 transition 对比与选型

两者都产生过渡效果，但触发机制与控制粒度不同：

| 维度 | transition | animation |
|------|-----------|-----------|
| 触发方式 | 被动（属性值变化时） | 主动（声明即播放） |
| 关键帧 | 仅起止两点 | 任意多个中间帧 |
| 循环 | 单次 | 支持 infinite |
| 方向控制 | 无 | alternate/reverse |
| 暂停 | 不支持 | animation-play-state: paused |
| 典型场景 | :hover 悬停反馈 | 加载动画、入场动效 |

**选型建议**：
- 简单悬停反馈、状态切换用 `transition`，代码更简洁
- 复杂动效、循环播放、多关键帧用 `animation`
- 两者经常配合：`transition` 处理悬停，`animation` 处理持续动效

```css
/* transition 处理悬停反馈 */
.btn { transition: transform 0.2s; }
.btn:hover { transform: scale(1.05); }

/* animation 处理持续加载动效 */
.spinner { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
```

## 八、性能优化与配套工具协同

**动画性能优化清单**：

1. **优先使用 transform 与 opacity**：避免触发重排的属性（top/left/width/height/margin/padding）
2. **避免大半径 blur 动画**：`filter: blur()` 的高斯卷积计算开销大，大元素大半径 blur 动画易卡顿
3. **will-start 提示合成层**：对即将动画的元素声明 `will-change: transform`，浏览器提前创建合成层
4. **减少同时动画的元素数量**：合成层过多会导致 GPU 内存压力，建议同屏动画元素不超过 20 个
5. **使用 `@media (prefers-reduced-motion)`**：尊重用户的无障碍偏好，减少动效

```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01s !important; }
}
```

**配套工具协同**：

| 工具 | 协同方式 |
|------|----------|
| [transform 可视化](/transform) | 先调好静态 translate/rotate/scale 值，再到 animation 组合成关键帧 |
| [filter 滤镜](/filter) | filter 可在关键帧中动画，如 hover 提亮 `filter: brightness(1.1)` |
| [clip-path 路径裁剪](/clip-path) | clip-path 支持关键帧插值（需顶点数相同），实现形状变换动画 |
| [box-shadow 盒阴影](/box-shadow) | box-shadow 可在关键帧中动画，但会触发重绘，谨慎用于大元素 |
| [gradient 渐变](/gradient) | 渐变背景动画需配合 `background-size` 与 `background-position` 实现 |

CSS animation 是前端动效的基石，掌握八大子属性与 @keyframes 关键帧语义后，配合 transform 的 GPU 合成层优势，可构建流畅且高性能的动画体验。使用 [animation 动画生成器](/animation)可视化调节参数，实时预览效果，一键复制 CSS 代码，显著提升开发效率。
