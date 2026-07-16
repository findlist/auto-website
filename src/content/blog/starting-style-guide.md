---
title: 'CSS @starting-style 入场动画完全指南：元素首次出现过渡、display 切换与 popover 弹层动画'
description: '深入解析 CSS @starting-style 入场动画规则：嵌套与独立语法、首次渲染/display 切换/popover 三种触发场景、allow-discrete 离散过渡、与 animation/transition 对比选型，附实战案例。'
pubDate: 2026-07-15
tags: ['CSS', '@starting-style', '入场动画', 'transition', 'transition-behavior', 'allow-discrete', 'display 切换', 'popover', '首次渲染', '前端开发', 'CSS Transitions Level 2', '设计工具', '渐进增强']
relatedTool: '/starting-style'
---

在 CSS 动画领域，有一个长期痛点：`transition` 只能在属性值变化时触发过渡，无法捕获元素"首次出现"的场景——动态插入 DOM、`display: none → block` 切换、popover 显示时，元素直接跳到最终样式，没有过渡动画。开发者不得不借助 JavaScript（如 `requestAnimationFrame` 强制重排）或改用 `animation` 来模拟。CSS Transitions Level 2 引入的 `@starting-style` 规则填补了这一空白，让开发者用纯 CSS 声明元素首次出现时的起始样式，浏览器自动从起始样式过渡到最终样式。本文系统解析 `@starting-style` 的语法、三种触发场景、与 `allow-discrete` 的协同、对比选型与实战案例。

## 一、诞生背景与核心价值

在 `@starting-style` 出现之前，实现"元素首次出现时的入场动画"有以下几种方案，各有明显缺陷：

- **`transition` 无效**：`transition` 仅在属性值变化时触发。元素首次渲染时，属性从"无"直接变为"最终值"，浏览器不认为是"变化"，不会触发过渡。元素直接出现，没有任何动画。
- **`animation` 方案**：用 `@keyframes` 定义入场动画，`animation-fill-mode: forwards` 保持最终状态。可行但代码冗长——需要定义关键帧、动画名、时长、填充模式，且动画会循环（需 `animation-iteration-count: 1`）。
- **JavaScript `requestAnimationFrame` 方案**：先设置元素为起始样式（如 `opacity: 0`），强制重排（`getComputedStyle`），再切换到最终样式触发 `transition`。可行但依赖 JavaScript，有性能开销与闪烁风险。

`@starting-style` 提供了纯 CSS 声明式的解决方案：

```css
.card {
  opacity: 1;
  transform: scale(1);
  transition: opacity 0.3s, transform 0.3s;
  /* 声明元素首次出现时的起始样式 */
  @starting-style {
    opacity: 0;
    transform: scale(0.8);
  }
}
```

浏览器在元素首次渲染时，从 `@starting-style` 声明的起始样式（`opacity: 0; transform: scale(0.8)`）过渡到元素的最终样式（`opacity: 1; transform: scale(1)`），实现纯 CSS 的入场动画，无需 JavaScript，无需 `@keyframes`。

核心价值：

- **纯 CSS 声明式**：无需 JavaScript，无需 `@keyframes`，一行规则声明起始样式即可
- **覆盖三大场景**：首次渲染、`display` 切换、popover 显示，全面解决"首次出现"痛点
- **天然渐进增强**：不支持的浏览器忽略 `@starting-style`，元素直接使用最终样式，功能完整无报错

## 二、语法与使用方式

`@starting-style` 支持两种语法：嵌套语法与独立语法，效果完全相同。

### 嵌套语法（推荐）

把 `@starting-style` 嵌套在选择器规则内，语法更简洁。需要浏览器支持 CSS nesting（2023 年起全主流浏览器原生支持）：

```css
.card {
  opacity: 1;
  transform: scale(1);
  transition: opacity 0.3s, transform 0.3s;
  @starting-style {
    opacity: 0;
    transform: scale(0.8);
  }
}
```

### 独立语法

把 `@starting-style` 作为顶级规则，内部嵌套选择器。不依赖 nesting，兼容性更好：

```css
.card {
  opacity: 1;
  transform: scale(1);
  transition: opacity 0.3s, transform 0.3s;
}

@starting-style {
  .card {
    opacity: 0;
    transform: scale(0.8);
  }
}
```

两种语法效果完全相同。推荐使用嵌套语法（更简洁、样式更集中），需要兼容旧浏览器时切换为独立语法。使用本站的 [CSS @starting-style 入场动画生成器](/starting-style) 可在两种语法间一键切换。

### 关键规则

1. **必须配合 `transition`**：`@starting-style` 声明的是起始样式，过渡由 `transition` 属性控制（时长、缓动、延迟）。没有 `transition` 则元素瞬间跳到最终样式，无动画效果。
2. **起始样式与最终样式配对**：`@starting-style` 中声明的属性应与元素最终样式中的属性配对。如最终样式是 `opacity: 1`，起始样式应声明 `opacity: 0`，浏览器从 `0` 过渡到 `1`。
3. **`@starting-style` 仅声明起始状态**：过渡完成后元素保持最终样式，`@starting-style` 的声明不再生效（直到元素再次"首次出现"）。

## 三、三种触发场景详解

`@starting-style` 覆盖三大"元素首次出现"场景，每种场景的触发机制与配置略有不同。

### 场景一：首次渲染（first-render）

元素首次插入 DOM 时触发，如动态添加列表项、路由切换挂载组件。浏览器从 `@starting-style` 声明的起始样式过渡到最终样式。

```css
.list-item {
  opacity: 1;
  transform: translateX(0);
  transition: opacity 0.3s, transform 0.3s;
  @starting-style {
    opacity: 0;
    transform: translateX(-20px);
  }
}
```

当 JavaScript 动态创建 `.list-item` 元素并插入 DOM 时，浏览器自动从 `opacity: 0; transform: translateX(-20px)` 过渡到 `opacity: 1; transform: translateX(0)`，实现列表项滑入入场效果。

### 场景二：display 切换（display-toggle）

`display: none → block` 时触发。元素从隐藏变为可见相当于"首次出现"。但 `display` 是离散属性，默认不参与过渡，需要配合 `transition-behavior: allow-discrete`：

```css
.panel {
  opacity: 1;
  transition: opacity 0.3s, display 0.3s allow-discrete;
  @starting-style {
    opacity: 0;
  }
}

.panel.hidden {
  opacity: 0;
  display: none;
}
```

- **显示方向**（移除 `.hidden` 类，`display: none → block`）：`display` 立即变为 `block`，`opacity` 从 `@starting-style` 的 `0` 过渡到 `1`。
- **隐藏方向**（添加 `.hidden` 类，`display: block → none`）：`opacity` 从 `1` 过渡到 `0`，过渡结束后 `display` 才变为 `none`。

### 场景三：popover 显示（popover-show）

popover 或 dialog 元素显示时触发。`@starting-style` 声明显示前的起始状态，实现弹层入场动画：

```css
[popover] {
  opacity: 1;
  transform: scale(1);
  transition: opacity 0.2s, transform 0.2s, display 0.2s allow-discrete;
  @starting-style {
    opacity: 0;
    transform: scale(0.9);
  }
}
```

当调用 `popoverEl.showPopover()` 或点击 `popovertarget` 按钮时，popover 从 `scale(0.9) opacity: 0` 过渡到 `scale(1) opacity: 1`，实现弹层缩放入场效果。

## 四、transition-behavior: allow-discrete 与 display 离散过渡

`transition-behavior: allow-discrete` 是让离散属性（如 `display`）参与过渡的开关。默认情况下 `display` 是离散属性，变化时立即生效，不会产生过渡动画。

### 工作原理

启用 `allow-discrete` 后，浏览器特殊处理 `display` 的变化时机：

- **显示方向**（`none → block`）：`display` 立即变为 `block`，让其他属性（如 `opacity`）可以正常过渡。这是因为元素必须先变为可见（`block`），才能渲染过渡动画。
- **隐藏方向**（`block → none`）：`display` 在过渡**结束时**才变为 `none`，让其他属性先完成过渡再隐藏。这保证了隐藏前有完整的淡出动画。

### 语法

`transition-behavior` 是 `transition` 简写的子属性，可以直接写在 `transition` 简写中：

```css
.panel {
  /* opacity 正常过渡，display 离散过渡 */
  transition: opacity 0.3s, display 0.3s allow-discrete;
}
```

也可以单独声明：

```css
.panel {
  transition-property: opacity, display;
  transition-duration: 0.3s;
  transition-behavior: allow-discrete;
}
```

### 为什么需要 allow-discrete

没有 `allow-discrete` 时，`display: none` 会立即生效，元素瞬间消失，其他属性的过渡来不及播放。加上 `allow-discrete` 后，浏览器会延迟 `display: none` 的生效时机到过渡结束，让淡出动画完整播放。

## 五、@starting-style vs animation vs transition 对比选型

三者都是 CSS 动画方案，但适用场景不同。

| 特性 | `@starting-style` + `transition` | `animation` | `transition` |
|------|----------------------------------|-------------|--------------|
| **触发方式** | 元素首次出现 | 加载即播放 / JS 控制 | 属性值变化 |
| **播放次数** | 一次（入场） | 可循环 | 一次（每次变化） |
| **关键帧** | 不需要（仅起始+最终） | 需要 `@keyframes` | 不需要（仅起始+最终） |
| **首次渲染** | ✅ 支持 | ✅ 支持 | ❌ 不支持 |
| **display 切换** | ✅ 支持（配合 `allow-discrete`） | ❌ 不支持（元素隐藏时动画暂停） | ❌ 不支持 |
| **循环动画** | ❌ 不支持 | ✅ 支持 | ❌ 不支持 |
| **多关键帧** | ❌ 不支持（仅起始+最终） | ✅ 支持 | ❌ 不支持 |
| **暂停控制** | ❌ 不支持 | ✅ `animation-play-state` | ❌ 不支持 |
| **代码量** | 少（起始+最终+transition） | 多（keyframes+animation 属性） | 少（property+duration） |

**选型原则**：

- **元素出现时播放一次过渡** → `@starting-style` + `transition`（最简洁）
- **持续循环的动画**或**多关键帧复杂动画** → `animation`
- **属性值变化触发的过渡**（如 hover、状态切换） → `transition`

三者可组合使用：`@starting-style` 处理入场，`animation` 处理入场后的循环动画，`transition` 处理状态切换。详见本站的 [CSS animation 动画生成器](/animation) 与 [CSS transition 过渡生成器](/transition)。

## 六、浏览器兼容性与渐进增强

### 兼容性

- **Chrome 117+**（2023 年 9 月）
- **Edge 117+**
- **Safari 17.5+**（2024 年 5 月）
- **Firefox 129+**（2024 年 8 月）

`transition-behavior: allow-discrete` 的兼容性与 `@starting-style` 基本一致。

### 渐进增强

`@starting-style` 是天然的渐进增强特性——不支持的浏览器会忽略 `@starting-style` 规则，元素直接使用最终样式（无入场动画），**功能完整但无过渡效果**。无需额外降级代码，直接使用即可。

如果需要在不支持时提供替代方案，可用 `@supports` 检测：

```css
.card {
  opacity: 1;
  /* 不支持 @starting-style 时的降级：直接显示，无动画 */
}

@supports (@starting-style) {
  .card {
    transition: opacity 0.3s;
    @starting-style {
      opacity: 0;
    }
  }
}
```

实际项目中直接使用即可，新旧浏览器体验都不会出错——支持的有入场动画，不支持的直接显示，功能完整。

## 七、实战案例与最佳实践

### 案例一：动态列表项入场

动态添加列表项时，每项从左侧滑入并淡入：

```css
.todo-item {
  opacity: 1;
  transform: translateX(0);
  transition: opacity 0.3s ease-out, transform 0.3s ease-out;
  @starting-style {
    opacity: 0;
    transform: translateX(-20px);
  }
}
```

JavaScript 动态创建 `.todo-item` 元素并插入 DOM，每项自动播放滑入入场动画。

### 案例二：折叠面板展开淡入

点击按钮展开折叠面板，面板从 `display: none` 切换到 `display: block` 时淡入：

```css
.accordion-panel {
  opacity: 1;
  transition: opacity 0.3s, display 0.3s allow-discrete;
  @starting-style {
    opacity: 0;
  }
}

.accordion-panel.collapsed {
  opacity: 0;
  display: none;
}
```

切换 `.collapsed` 类即可实现展开淡入、折叠淡出的双向过渡。

### 案例三：popover 弹层缩放入场

popover 弹出时从 0.9 缩放弹入，配合 `allow-discrete` 处理 display 切换：

```css
[popover] {
  opacity: 1;
  transform: scale(1);
  transition: opacity 0.2s ease-out, transform 0.2s ease-out, display 0.2s allow-discrete;
  @starting-style {
    opacity: 0;
    transform: scale(0.9);
  }
}
```

调用 `showPopover()` 时弹层缩放入场，`hidePopover()` 时缩放淡出。

### 案例四：卡片综合入场

卡片首次渲染时，opacity + translateY + scale 组合入场，配合回弹缓动：

```css
.card {
  opacity: 1;
  transform: translateY(0) scale(1);
  transition: opacity 0.5s ease, transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  @starting-style {
    opacity: 0;
    transform: translateY(30px) scale(0.95);
  }
}
```

`cubic-bezier(0.16, 1, 0.3, 1)` 是平滑出缓动曲线，让卡片从下方滑入并轻微放大，入场效果流畅自然。

## 八、配套工具协同与总结

### 工具协同

本站提供完整的 CSS 动效交互工具链，`@starting-style` 是入场动画维度的核心：

- [CSS @starting-style 入场动画生成器](/starting-style) — 元素首次出现过渡（本工具）
- [CSS transition 过渡生成器](/transition) — 配合 `@starting-style` 的过渡配置
- [CSS animation 动画生成器](/animation) — 时间驱动的循环动画，与 `@starting-style` 互补
- [CSS view-transition 视图过渡生成器](/view-transition) — DOM 状态切换的视图过渡
- [CSS scroll-driven 动画生成器](/scroll-driven) — 滚动驱动的动画

### 最佳实践总结

1. **优先用嵌套语法**：更简洁、样式更集中，2023 年起全主流浏览器支持 nesting
2. **display 切换必须配 `allow-discrete`**：否则 `display` 不参与过渡，元素瞬间消失
3. **起始样式与最终样式配对**：`@starting-style` 中声明的属性应与最终样式配对，确保过渡正确
4. **天然渐进增强**：不支持 `@starting-style` 的浏览器直接显示最终样式，功能完整，无需降级代码
5. **入场用 `@starting-style`，循环用 `animation`**：各取所长，避免用 `animation` 模拟入场动画的冗长代码

`@starting-style` 填补了 CSS 动画领域"元素首次出现"的长期空白，让入场动画从 JavaScript + `requestAnimationFrame` 的 hack 方案升级为纯 CSS 声明式方案。配合 `transition-behavior: allow-discrete`，覆盖首次渲染、display 切换、popover 显示三大场景，是现代 CSS 动画工具链的必备能力。
