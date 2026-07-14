---
title: 'CSS scroll-driven 动画完全指南：scroll() 与 view() 时间线、animation-range 与渐进增强'
description: '深入解析 CSS scroll-driven 动画（滚动驱动动画）：scroll() 与 view() 两种时间线的区别与选型、animation-timeline 属性、animation-range 范围控制（cover/contain/entry/exit 等）、animation-duration 必须为 auto 的原因、命名时间线与 timeline-scope、浏览器兼容性与渐进增强策略。附滚动进度条、元素入场、视差滚动等实战示例。'
pubDate: 2026-07-15
tags: ['CSS', 'scroll-driven', '滚动驱动动画', 'animation-timeline', 'scroll()', 'view()', 'animation-range', '视差滚动', '入场动画', '进度条', '前端开发', '设计工具', '渐进增强']
relatedTool: '/scroll-driven'
---

# CSS scroll-driven 动画完全指南

CSS scroll-driven 动画（Scroll-driven Animations）是 2023 年正式落地、2024-2025 年逐步普及的原生 CSS 特性，允许开发者用**滚动位置或元素可见性**代替**时间**来驱动 `@keyframes` 关键帧进度。这一特性让滚动交互动画从"监听 scroll 事件写 JS"升级为"纯 CSS 声明"，彻底解决了滚动动画性能差、代码复杂、难以同步等核心痛点。本文系统解析 scroll() 与 view() 两种时间线、animation-range 范围控制、命名时间线、浏览器兼容性与渐进增强等实战场景。

## 一、诞生背景与核心价值

在 scroll-driven 动画出现之前，实现滚动动画只有两条路，各有硬伤：

- **JS 监听 scroll 事件**：通过 `addEventListener('scroll', ...)` 计算滚动进度，再用 `element.style` 或 CSS 变量驱动动画。性能差——scroll 事件高频触发，主线程计算容易掉帧；代码复杂——需手动计算元素位置、视口高度、进度百分比；难以同步——多个动画的进度难以精确对齐。
- **Intersection Observer + 时间动画**：用 IntersectionObserver 检测元素进入视口，触发普通 CSS 动画。只能做"进场一次性动画"，无法实现"滚动到哪动画到哪"的连续进度效果。

scroll-driven 动画提供了纯 CSS 声明式的解决方案：

```css
@keyframes fade-in {
  from { opacity: 0; transform: translateY(30px); }
  to { opacity: 1; transform: translateY(0); }
}

.reveal {
  animation-name: fade-in;
  animation-duration: auto;  /* 关键：时长由时间线决定 */
  animation-timeline: view();  /* 元素可见性驱动 */
}
```

核心价值在于：动画进度由浏览器在**合成线程**计算，不阻塞主线程，60fps 稳定不掉帧；滚动到哪动画到哪，**可暂停可回滚**，向上滚动动画反向播放；纯 CSS 声明，无需 JS，代码简洁可维护。

## 二、scroll() 与 view() 两种时间线

scroll-driven 动画有两类时间线，驱动源不同，适用场景不同。

**scroll() 时间线：基于滚动容器的滚动位置**

```css
.progress-bar {
  animation-timeline: scroll(root block);
  /* root：根滚动容器（整个文档）
     block：块向轴（通常为垂直滚动） */
}
```

整个滚动条从顶到底的进度（0% → 100%）映射到关键帧 from → to。适合**全局性**动画：
- 顶部滚动进度条
- 视差背景（随滚动位移）
- 随滚动旋转的图标

`scroll()` 的参数：
- `source`：`nearest`（最近滚动祖先）或 `root`（根容器）
- `axis`：`block`（块向轴/垂直）、`inline`（行向轴/水平）、`x`、`y`

**view() 时间线：基于元素在滚动容器中的可见性**

```css
.card {
  animation-timeline: view(nearest block);
  /* nearest：最近滚动祖先
     block：块向轴
     可选 inset：可见区边距，如 view(nearest block inset 20%) */
}
```

元素从进入视口到离开视口的过程映射到关键帧。适合**元素级**动画：
- 卡片淡入入场
- 列表项依次揭示
- 图片缩放进场

`view()` 比 `scroll()` 多一个 `inset` 参数，用于调整可见区边距（类似 Intersection Observer 的 rootMargin）。

**选型原则**：动画与"整体滚动进度"相关用 scroll()，与"单个元素进场"相关用 view()。

## 三、animation-range 范围控制

`animation-range` 控制 scroll-driven 动画的**有效范围**——即滚动进度的哪一段映射到关键帧。这对 view() 时间线尤其重要，因为元素进入视口到离开视口有多个阶段。

**预设范围**（从元素可见性角度定义）：

| 范围 | 含义 |
|------|------|
| `normal` | 使用时间线默认范围（scroll 为全程，view 为 cover） |
| `cover` | 元素从开始进入视口到完全离开视口的全程 |
| `contain` | 元素完全在视口内的区间 |
| `entry` | 元素从开始进入视口到完全进入视口 |
| `exit` | 元素从开始离开视口到完全离开视口 |
| `entry-crossing` | 元素跨越视口边缘进入的阶段 |
| `exit-crossing` | 元素跨越视口边缘离开的阶段 |

```css
/* 只在元素进场阶段动画 */
.card {
  animation-timeline: view();
  animation-range: entry;
}

/* 只在元素完全可见时动画 */
.card {
  animation-timeline: view();
  animation-range: contain;
}
```

**自定义范围**：用关键字 + 百分比/vh 组合，精确控制范围起止点：

```css
/* 只在元素进场的前半段动画 */
.target {
  animation-timeline: view();
  animation-range: entry 0% to entry 50%;
}

/* 从视口顶部 20vh 到 80vh 的区间 */
.target {
  animation-timeline: scroll(root);
  animation-range: 20vh to 80vh;
}
```

本站提供的 [scroll-driven 动画生成器](/scroll-driven)内置 7 种预设范围与自定义范围编辑，可直观验证不同范围的效果差异。

## 四、animation-duration: auto 与 animation-timeline 声明规则

scroll-driven 动画有两条必须遵守的核心规则，违反任一都会导致动画失效。

**规则一：animation-duration 必须为 auto**

scroll-driven 动画的进度由时间线（滚动位置/可见性）决定，不再由时长决定。`auto` 表示"时长由时间线接管"。若设为具体时长（如 `1s`），动画会退化为普通时间驱动动画，scroll-driven 失效。

```css
/* 正确 */
.target {
  animation-name: fade;
  animation-duration: auto;
  animation-timeline: view();
}

/* 错误：duration 为具体时长，scroll-driven 失效 */
.target {
  animation-name: fade;
  animation-duration: 1s;
  animation-timeline: view();
}
```

**规则二：animation-timeline 必须单独声明，不能写入 animation 简写**

`animation` 简写会把 `animation-duration` 重置为默认值 `0s`，导致动画无法播放。正确写法是单独声明：

```css
/* 正确：单独声明 animation-timeline */
.target {
  animation-name: fade;
  animation-duration: auto;
  animation-timeline: view();
}

/* 错误：简写会重置 duration 为 0s */
.target {
  animation: fade auto;  /* 看似对，但加 timeline 后... */
  animation-timeline: view();  /* duration 被简写重置为 0s */
}
```

本工具生成的代码严格遵循这两条规则，确保动画在浏览器中正确运行。

## 五、命名时间线与 timeline-scope

scroll() 和 view() 是**匿名时间线**——在目标元素上直接声明，简单直接但无法跨组件复用。命名时间线把时间线定义与动画引用**分离**，适合复杂场景。

**定义命名时间线**：

```css
/* 在滚动容器上定义 view 时间线 */
.scroller {
  view-timeline-name: --my-timeline;
  view-timeline-axis: block;
}

/* 也可以定义 scroll 时间线 */
.scroller {
  scroll-timeline-name: --scroll-tl;
  scroll-timeline-axis: block;
}
```

**引用命名时间线**：

```css
/* 在目标元素上引用 */
.target {
  animation-name: fade;
  animation-duration: auto;
  animation-timeline: --my-timeline;
  animation-range: entry;
}
```

**timeline-scope 提升作用域**：命名时间线默认只在定义它的元素的子树内可见。若需在祖先元素上引用后代容器的时间线，用 `timeline-scope` 提升作用域：

```css
/* 在祖先上声明，让后代容器的时间线在祖先作用域可见 */
.ancestor {
  timeline-scope: --my-timeline;
}

/* 现在祖先的其他后代可以引用 --my-timeline */
.cousin {
  animation-timeline: --my-timeline;
}
```

命名时间线适合多个元素共享同一时间线的场景，如多个卡片共享一个滚动容器的 view 时间线，各自用不同 animation-range 实现错落入场。

## 六、典型布局模式与实战示例

### 模式一：顶部滚动进度条

最经典的 scroll-driven 应用，顶部进度条随页面滚动增长：

```css
@keyframes progress-grow {
  from { width: 0%; }
  to { width: 100%; }
}

.progress-bar {
  position: fixed;
  top: 0;
  left: 0;
  height: 4px;
  background: linear-gradient(90deg, #2563eb, #7c3aed);
  animation-name: progress-grow;
  animation-duration: auto;
  animation-timeline: scroll(root block);
  /* root：监听整页滚动，block：垂直轴 */
}
```

### 模式二：元素淡入入场

列表元素逐个淡入，用 view() 时间线：

```css
@keyframes fade-in {
  from { opacity: 0; transform: translateY(30px); }
  to { opacity: 1; transform: translateY(0); }
}

.reveal {
  animation-name: fade-in;
  animation-duration: auto;
  animation-timeline: view();
  animation-range: entry;  /* 只在进场阶段动画 */
}
```

### 模式三：视差滚动

背景元素随滚动产生位移差，营造深度感：

```css
@keyframes parallax {
  from { transform: translateY(0); }
  to { transform: translateY(-120px); }
}

.parallax-bg {
  animation-name: parallax;
  animation-duration: auto;
  animation-timeline: scroll(nearest block);
}
```

### 模式四：卡片缩放揭示

卡片从缩小状态放大到正常，用 view() + cover 范围：

```css
@keyframes card-reveal {
  from { opacity: 0; transform: scale(0.8); }
  to { opacity: 1; transform: scale(1); }
}

.card {
  animation-name: card-reveal;
  animation-duration: auto;
  animation-timeline: view();
  animation-range: cover;  /* 全程覆盖 */
}
```

## 七、浏览器兼容性与渐进增强

**浏览器兼容性**：scroll-driven 动画自 Chrome 115+（2023-08）和 Edge 115+ 原生支持，Safari 26+（2025）开始支持，Firefox 正在实现中（截至 2025 年仍在 flag 后）。全球覆盖率约 75-80%，在 Chrome 系浏览器可放心生产使用。

**渐进增强策略**：scroll-driven 动画是**增强特性**——不支持的浏览器会忽略 `animation-timeline`，元素保持默认样式（动画不播放但不报错）。建议的渐进增强写法：

```css
/* 1. 先定义普通动画作为降级 */
.target {
  animation: fade-in 1s ease-out;
}

/* 2. 用 @supports 增强：支持 scroll-driven 的浏览器覆盖为滚动驱动 */
@supports (animation-timeline: view()) {
  .target {
    animation-name: fade-in;
    animation-duration: auto;
    animation-timeline: view();
    animation-range: entry;
  }
}
```

这样旧浏览器播放 1 秒的普通淡入，新浏览器播放滚动驱动的淡入，两者体验都不差。

**性能优势**：scroll-driven 动画在浏览器**合成线程**处理，不阻塞主线程。即使页面有大量滚动动画，也不会卡顿。相比之下，JS 监听 scroll 事件驱动动画在主线程计算，高频触发容易掉帧。这是 scroll-driven 动画最大的性能价值。

**配套工具协同**：scroll-driven 动画与其他现代 CSS 特性配合能发挥更大价值：

- 与 [CSS animation 动画](/animation)配合：scroll-driven 复用 @keyframes 关键帧定义，只需改 animation-timeline 驱动源。
- 与 [CSS scroll-snap 滚动捕捉](/scroll-snap)配合：scroll-snap 控制滚动停靠点，scroll-driven 在停靠点之间播放动画。
- 与 [CSS @container 容器查询](/container)配合：容器查询实现组件级响应式，scroll-driven 实现组件内滚动动画。

scroll-driven 动画是现代 CSS 交互能力的重要拼图，配合本站的 [scroll-driven 动画生成器](/scroll-driven)可可视化编辑时间线、实时预览滚动效果，加速掌握这一强大特性。
