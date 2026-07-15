---
title: 'CSS view-transition 视图过渡完全指南：同文档/跨文档过渡、命名元素与伪元素动画'
description: '深入解析 CSS view-transition 视图过渡：同文档与跨文档过渡选型、view-transition-name 命名、伪元素树结构与自定义动画，附 SPA 与 MPA 实战示例。'
pubDate: 2026-07-15
tags: ['CSS', 'view-transition', '视图过渡', 'View Transitions API', 'startViewTransition', 'SPA', 'MPA', '命名元素', '伪元素', '共享元素过渡', '前端开发', '设计工具', '渐进增强']
relatedTool: '/view-transition'
---

# CSS view-transition 视图过渡完全指南

CSS view-transition（视图过渡，View Transitions API）是 2023-2024 年逐步落地的主流浏览器原生特性，允许开发者通过**自动捕获新旧 DOM 快照**并在伪元素树上播放交叉淡入，实现状态切换与页面跳转间的平滑过渡，无需手动编写过渡动画。这一特性让"状态切换的动画一致性"这一前端老大难问题从"框架过渡组件或手写 JS 动画"升级为"浏览器原生快照机制"，彻底解决了新旧位置难以对齐、动画与 DOM 变更难以同步等核心痛点。本文系统解析同文档与跨文档两种过渡模式、view-transition-name 命名元素、伪元素树结构与动画覆盖、浏览器兼容性与渐进增强等实战场景。

## 一、诞生背景与核心价值

在 view-transition 出现之前，实现状态切换动画主要有三条路，各有硬伤：

- **框架过渡组件**（如 React Transition、Vue Transition）：需引入额外依赖，增加包体积；API 与框架强耦合，跨框架不可复用；对复杂场景（如列表重排、共享元素）支持有限。
- **手写 JS 动画**：监听状态变化，手动计算新旧位置，用 FLIP 技术或 Web Animations API 实现过渡。代码复杂——需记录旧位置、变更 DOM、计算新位置、播放反向动画；易出错——异步加载、布局抖动会导致位置错位。
- **CSS transition/animation**：只能做单个元素的属性级过渡，无法应对 DOM 结构变化（如列表变详情、元素增删）。

view-transition 提供了浏览器原生的快照机制：

```js
// 同文档过渡：SPA 状态切换
function toggleView() {
  if (!document.startViewTransition) {
    updateDOM(); // 不支持时降级
    return;
  }
  document.startViewTransition(() => {
    updateDOM(); // 在回调内变更 DOM
  });
}
```

核心价值在于：浏览器**自动捕获新旧快照**，开发者无需计算位置；快照在**合成线程**处理，60fps 稳定不掉帧；支持**命名元素独立过渡**，可实现共享元素动画等复杂效果；纯原生 API，不依赖任何框架。

## 二、同文档过渡（SPA）与跨文档过渡（MPA）

view-transition 有两种模式，适用场景不同。

**同文档过渡（same-document，SPA 场景）**

在单页应用内切换状态时使用，通过 JS 调用 `document.startViewTransition(callback)` 触发：

```js
// Tab 切换、列表/详情切换、主题切换等 SPA 内部状态变化
document.startViewTransition(() => {
  // 在此回调内执行 DOM 变更
  element.classList.toggle('active');
  // 或替换内容
  container.innerHTML = newContent;
});
```

流程：浏览器捕获旧快照 → 执行 callback 变更 DOM → 捕获新快照 → 在伪元素树上播放过渡。适合所有客户端路由的状态切换。

**跨文档过渡（cross-document，MPA 场景）**

在多页应用页面跳转时使用，通过 CSS 声明启用，无需 JS：

```css
@view-transition {
  navigation: auto;
}
```

将此规则加入 CSS 后，浏览器在**同源页面导航**（a 标签跳转、history 导航）时自动捕获旧页快照，新页加载后播放过渡。适合传统多页站点、SSR 应用的页面间跳转。

**选型原则**：应用是 SPA（客户端路由）用同文档，是 MPA（真实页面跳转）用跨文档。注意跨文档过渡 Chrome 126+（2024）支持，兼容性晚于同文档（Chrome 111+）。

## 三、view-transition-name 命名元素独立过渡

`view-transition-name` 是视图过渡的核心属性——为元素分配唯一名称，让该元素从默认的整页 root 快照中独立出来，单独参与过渡。

**未命名元素**：归入 `::view-transition-old(root)` 与 `::view-transition-new(root)`，随整页一起交叉淡入。

**命名元素**：浏览器单独捕获其新旧快照，放入独立的伪元素树：

```css
.card {
  view-transition-name: card;
}
```

命名后，`.card` 的旧快照与新快照会被放入 `::view-transition-group(card)` → `::view-transition-image-pair(card)` → `::view-transition-old(card)` / `::view-transition-new(card)` 伪元素树。其中 `group` 会自动在元素的**旧位置与新位置间插值**（位置、尺寸动画），实现"共享元素过渡"效果。

**典型应用：列表项展开为详情**

列表态与详情态的图片都命名 `view-transition-name: hero`，切换时图片在新旧位置间平滑过渡，而非简单淡入：

```css
/* 列表态：小图 */
.list-image {
  view-transition-name: hero;
}

/* 详情态：大图（同名，浏览器自动在新旧位置间过渡） */
.detail-image {
  view-transition-name: hero;
}
```

**关键约束**：同一时刻每个 name 只能对应一个元素。若多个元素同名，过渡会跳过该 name。因此列表项需动态分配 name（如 `hero-1`、`hero-2`），或仅在即将切换时为单个元素命名。

## 四、::view-transition-* 伪元素树结构

视图过渡通过伪元素树渲染，理解其结构是自定义动画的基础：

```
::view-transition（根，覆盖整页）
  └─ ::view-transition-group(name)（命名元素的组，管位置/尺寸动画）
     └─ ::view-transition-image-pair(name)（新旧图像对容器）
        ├─ ::view-transition-old(name)（旧快照）
        └─ ::view-transition-new(name)（新快照）
```

- `::view-transition`：根伪元素，覆盖整个视口，包含所有过渡内容。
- `::view-transition-group(name)`：命名元素的组容器，浏览器自动在其旧位置与新位置间插值（transform 动画）。
- `::view-transition-image-pair(name)`：新旧图像对容器，容纳 old 与 new 两个快照。
- `::view-transition-old(name)`：旧快照图像，默认从 opacity:1 淡出到 opacity:0。
- `::view-transition-new(name)`：新快照图像，默认从 opacity:0 淡入到 opacity:1。

未命名的整页元素用 `::view-transition-old(root)` 与 `::view-transition-new(root)`。

## 五、自定义伪元素动画覆盖

默认过渡是交叉淡入（0.4s），可通过为伪元素设置 `animation-duration`、`animation-timing-function`、`transform`、`opacity` 覆盖默认动画。

**全局默认时长**：

```css
::view-transition-old(root),
::view-transition-new(root) {
  animation-duration: 0.6s;
  animation-timing-function: ease-in-out;
}
```

**命名元素自定义动画**——让旧快照向左滑出、新快照从右滑入：

```css
@keyframes slide-out {
  to { transform: translateX(-100%); opacity: 0; }
}

@keyframes slide-in {
  from { transform: translateX(100%); opacity: 0; }
}

::view-transition-old(card) {
  animation: slide-out 0.3s forwards;
}

::view-transition-new(card) {
  animation: slide-in 0.3s forwards;
}
```

**侧栏滑入效果**——旧快照从左侧滑出，新快照从左侧滑入：

```css
::view-transition-old(sidebar) {
  animation: 0.4s ease both;
  animation-name: slide-left-out;
}

::view-transition-new(sidebar) {
  animation: 0.4s ease both;
  animation-name: slide-left-in;
}
```

通过组合不同伪元素的动画，可实现淡入淡出、滑动、缩放、旋转等各类过渡效果。

## 六、startViewTransition 回调机制与 Promise

`document.startViewTransition(callback)` 返回一个 transition 对象，提供三个 Promise 监听各阶段：

```js
const transition = document.startViewTransition(() => {
  updateDOM();
});

// 1. callback 执行完成（DOM 已更新，但快照未捕获）
transition.updateCallbackDone.then(() => {
  console.log('DOM 已变更');
});

// 2. 过渡动画准备就绪（伪元素树已构建）
transition.ready.then(() => {
  console.log('过渡即将开始');
  // 可在此自定义动画，如用 Web Animations API 覆盖默认动画
});

// 3. 过渡完全结束（伪元素已移除）
transition.finished.then(() => {
  console.log('过渡已完成');
}).catch(() => {
  console.log('过渡被跳过或取消');
});
```

**同步与异步回调**：callback 内的 DOM 变更应是同步的。若需异步操作（如 fetch 数据后更新），需返回 Promise：

```js
document.startViewTransition(async () => {
  const data = await fetch('/api/data').then(r => r.json());
  renderData(data);
});
```

**跳过过渡**：若 callback 抛出异常或返回 reject 的 Promise，过渡跳过，DOM 变更回滚（若 callback 内已变更则保持）。

## 七、跨文档过渡与 @view-transition 规则

跨文档过渡无需 JS，纯 CSS 声明：

```css
@view-transition {
  navigation: auto;
}
```

**同源限制**：仅在同源（同协议/域名/端口）跳转时生效，跨源跳转无过渡。

**命名元素跨页**：若新旧页面都有 `view-transition-name: hero` 的元素，该元素会在两页间独立过渡（共享元素效果），实现列表页 → 详情页的图片平滑放大：

```css
/* 列表页与详情页都包含此规则 */
.hero-image {
  view-transition-name: hero;
}
```

**导航类型控制**：`navigation` 属性支持 `auto`（所有同源导航）或 `none`（禁用）。可通过 `@view-transition` 的 `navigation` 配合 JS 的 `pageswap` 与 `pagereveal` 事件精细控制。

**兼容性**：跨文档过渡 Chrome 126+（2024）支持，晚于同文档（Chrome 111+）。Safari/Firefox 逐步跟进。不支持的浏览器忽略该规则，正常跳转无副作用。

## 八、浏览器兼容性与渐进增强

**兼容性现状**（截至 2025 年）：

- 同文档过渡：Chrome 111+（2023-03）、Edge 111+、Safari 18+（2024）、Firefox 136+（2025）
- 跨文档过渡：Chrome 126+（2024-06）、Edge 126+，Safari/Firefox 逐步跟进
- 全球覆盖率约 80-85%，主流浏览器已可用

**渐进增强策略**：view-transition 是增强特性——不支持的浏览器会忽略 `startViewTransition`，DOM 正常变更，无过渡但功能完整。

```js
function toggleView() {
  // 特性检测：不支持时直接变更 DOM，无副作用
  if (!document.startViewTransition) {
    updateDOM();
    return;
  }
  document.startViewTransition(() => updateDOM());
}
```

**降级方案**：对不支持 view-transition 的浏览器，可用 CSS transition 或 animation 提供基础过渡：

```css
/* 降级：普通 transition */
.card {
  transition: all 0.3s ease;
}

/* 增强：支持的浏览器用 view-transition */
@supports (view-transition-name: none) {
  .card {
    transition: none; /* 避免与 view-transition 冲突 */
  }
}
```

## 九、实战场景与最佳实践

**场景一：卡片列表展开为详情**

```css
.card-image {
  view-transition-name: card-image;
}

::view-transition-old(card-image) {
  animation-duration: 0.25s;
}

::view-transition-new(card-image) {
  animation-duration: 0.25s;
}
```

**场景二：主题切换平滑过渡**

```js
function toggleTheme() {
  document.startViewTransition(() => {
    document.documentElement.classList.toggle('dark');
  });
}
```

默认整页交叉淡入即可实现主题平滑切换，无需命名元素。

**场景三：SPA 路由切换**

在路由变化时调用 `startViewTransition`，让页面切换具备过渡动画：

```js
router.afterEach(() => {
  document.startViewTransition(() => {
    renderRoute();
  });
});
```

**最佳实践**：

- 过渡时长建议 0.3-0.5s，过长拖沓，过短无感知。
- 命名元素 name 需唯一，列表项动态分配或仅命名当前交互项。
- 避免在过渡期间触发新过渡，用 `transition.skipTransition()` 取消未完成过渡。
- 跨文档过渡需同源，跨域跳转无过渡效果。
- 测试降级场景，确保不支持浏览器功能完整。

## 十、总结

CSS view-transition 通过浏览器原生的快照机制，让状态切换与页面跳转的平滑过渡从复杂的手写动画降为简单的 API 调用或 CSS 声明。同文档过渡覆盖 SPA 状态切换，跨文档过渡覆盖 MPA 页面跳转，命名元素支持共享元素动画等复杂效果。配合伪元素树结构与动画覆盖，可实现淡入淡出、滑动、缩放等各类过渡效果。随着主流浏览器全面支持，view-transition 已成为现代前端过渡动画的首选方案，值得一试。

配套工具：[CSS view-transition 视图过渡生成器](/view-transition)——可视化生成视图过渡 CSS 与 JS 代码，支持同文档/跨文档模式、命名元素管理、伪元素动画覆盖、iframe 实时预览，8 组预设覆盖常见场景，一键复制代码。
