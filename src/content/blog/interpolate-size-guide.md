---
title: 'CSS interpolate-size 尺寸插值动画完全指南：auto 高度过渡、calc-size() 与折叠面板展开'
description: '深入解析 CSS interpolate-size 尺寸插值属性：allow-keywords 取值、auto 等尺寸关键字插值原理、calc-size() 函数计算、与 max-height 技巧对比，附折叠面板实战案例。'
pubDate: 2026-07-15
tags: ['CSS', 'interpolate-size', 'auto 高度过渡', 'calc-size', '尺寸关键字', '折叠面板', 'transition', 'allow-keywords', 'numeric-only', 'min-content', 'max-content', 'fit-content', '前端开发', 'CSS Values and Units Module Level 5', '设计工具', '渐进增强']
relatedTool: '/interpolate-size'
---

在 CSS 动画领域，有一个长期痛点：`transition` 无法对 `height: auto` 过渡。当折叠面板从 `height: 0` 展开到 `height: auto` 时，浏览器不知道 `auto` 的具体数值，过渡会立即跳变，没有任何动画效果。开发者不得不使用 `max-height` 技巧（设置一个足够大的 `max-height` 值过渡，但会导致过渡曲线不自然），或用 JavaScript 测量元素实际高度（`scrollHeight`）再设置具体像素值。CSS 2024 年引入的 `interpolate-size` 属性与 `calc-size()` 函数填补了这一空白，让浏览器原生支持尺寸关键字的平滑过渡，无需 JS。本文系统解析 `interpolate-size` 的语法、与 `calc-size()` 的协同、对比传统方案的优势与实战案例。

## 一、诞生背景与核心价值

在 `interpolate-size` 出现之前，实现"折叠面板展开"等尺寸过渡有以下几种方案，各有明显缺陷：

- **`transition` 无效**：`transition: height 0.4s` 配合 `height: 0 → auto` 不会产生过渡。浏览器不知道 `auto` 的具体数值，无法插值，过渡立即跳变。
- **`max-height` 技巧**：设置 `max-height: 0 → 1000px` 实现过渡。缺陷：① 需要猜测一个"足够大"的 `max-height` 值，过小则内容被裁剪，过大则过渡提前结束（动画结束后才到实际高度）；② 过渡曲线不自然（前半段过渡 `max-height` 但实际高度未到，后半段无过渡直接跳到实际高度）；③ 嵌套折叠面板时 `max-height` 会相互干扰。
- **JavaScript `scrollHeight` 方案**：点击展开时用 JS 读取 `el.scrollHeight` 设置 `el.style.height`，过渡结束后设置 `height: auto`。可行但依赖 JavaScript，有性能开销与闪烁风险（过渡结束前若内容变化会跳变）。

`interpolate-size: allow-keywords` 提供了纯 CSS 声明式的解决方案：

```css
.panel {
  interpolate-size: allow-keywords;
  transition: height 0.4s ease;
  overflow: hidden;
}
.panel[data-state="collapsed"] { height: 0; }
.panel[data-state="expanded"] { height: auto; }
```

浏览器会自动计算 `auto` 对应的实际高度，并从 0 平滑过渡到该高度。无需 `max-height` 猜测，无需 JS 测量，过渡曲线自然。

## 二、语法与取值详解

`interpolate-size` 是一个继承属性，作用在元素上声明其尺寸关键字是否参与动画插值。

### 取值

- **`numeric-only`**（默认值）：仅数值（如 `200px`、`50%`、`10rem`）参与插值，尺寸关键字（`auto`、`min-content`、`max-content`、`fit-content`、`stretch`、`contain`）不参与插值。这与传统 CSS 行为一致——关键字变化时立即跳变。
- **`allow-keywords`**：允许尺寸关键字参与插值，浏览器在关键字与数值之间平滑过渡。例如 `height: 0 → auto` 会从 0 平滑过渡到内容的实际高度。

### 适用属性

`interpolate-size` 影响所有尺寸属性：`width`、`height`、`min-width`、`min-height`、`max-width`、`max-height`、`block-size`、`inline-size` 等。

### 继承性

`interpolate-size` 是继承属性。在 `:root` 声明后，全站所有元素默认开启尺寸关键字插值：

```css
:root {
  interpolate-size: allow-keywords;
}
```

## 三、calc-size() 函数：尺寸关键字计算

`calc-size()` 是配合 `interpolate-size: allow-keywords` 使用的计算函数，让开发者在尺寸关键字基础上做加减乘除计算。

### 语法

```css
calc-size(<basis>, <expression>)
```

- `basis`：基础尺寸关键字，如 `auto`、`min-content`、`max-content`、`fit-content`。
- `expression`：计算表达式，`size` 关键字代表基础尺寸的当前值。

### 示例

```css
.panel {
  interpolate-size: allow-keywords;
  transition: height 0.4s ease;
}
.panel[data-state="expanded"] {
  /* auto 高度 + 20px（用于补偿 padding） */
  height: calc-size(auto, size + 20px);
}
```

### 使用场景

1. **padding 补偿**：`calc-size(auto, size + 20px)` 在自动高度基础上加 20px，补偿 padding 导致的尺寸偏差。
2. **半高展开**：`calc-size(auto, size * 0.5)` 展开到自动高度的一半，实现"预览态"。
3. **动态偏移**：`calc-size(max-content, size - 40px)` 在最大内容宽度基础上减 40px。

`calc-size()` 扩展了尺寸关键字的可用范围，让关键字具备计算能力，是 `interpolate-size` 的进阶能力。

## 四、与传统 max-height 技巧对比

`max-height` 技巧是传统实现折叠面板过渡的常用方案，与 `interpolate-size` 相比有显著差异：

| 维度 | max-height 技巧 | interpolate-size: allow-keywords |
|------|-----------------|----------------------------------|
| 实现方式 | `max-height: 0 → 1000px` | `height: 0 → auto` |
| 高度值来源 | 需猜测"足够大"的值 | 浏览器自动计算 auto 实际高度 |
| 过渡曲线 | 不自然（前半段过渡 max-height 但实际高度未到，后半段跳变） | 自然（从 0 到实际高度全程平滑） |
| 内容被裁剪风险 | 有（max-height 过小则内容被裁剪） | 无（auto 自动适应内容） |
| 嵌套面板干扰 | 有（外层 max-height 影响内层） | 无（各自独立 auto） |
| 浏览器兼容性 | 全主流浏览器支持 | Chrome 129+/Firefox 129+/Safari 17.4+ |
| JS 依赖 | 无 | 无 |

`interpolate-size` 的核心优势是**过渡曲线自然**与**无需猜测高度值**。`max-height` 技巧的"足够大"值往往远大于实际高度，导致过渡前半段动画可见但元素实际未到最终位置，后半段动画结束但元素还在过渡，体验割裂。

## 五、与 @starting-style、view-transition 协同

`interpolate-size`、`@starting-style`、`view-transition` 是 CSS 动画能力维度的三块拼图，互补不替代：

- **`interpolate-size`**：管"尺寸关键字的插值"——让 `auto`、`min-content` 等关键字可过渡。解决"高度宽度过渡"问题。
- **`@starting-style`**：管"元素首次出现的入场过渡"——声明起始样式，浏览器从起始过渡到最终。解决"首次渲染/display 切换/popover 显示无过渡"问题。
- **`view-transition`**：管"DOM 状态切换的视图过渡"——浏览器捕获新旧快照实现平滑过渡。解决"页面/组件切换无动画"问题。

### 组合使用示例

折叠面板首次出现时入场 + 展开时 auto 高度过渡：

```css
.panel {
  interpolate-size: allow-keywords;
  transition: height 0.4s ease, opacity 0.3s ease;
  opacity: 1;
  /* 首次出现时的起始样式 */
  @starting-style {
    opacity: 0;
  }
}
.panel[data-state="collapsed"] { height: 0; }
.panel[data-state="expanded"] { height: auto; }
```

页面切换时用 `view-transition` 实现视图过渡，切换后内容用 `interpolate-size` 实现 auto 高度过渡。三者协同覆盖从"元素入场"到"尺寸过渡"到"页面切换"的完整动画链路。

## 六、浏览器兼容性与渐进增强

### 兼容性

- **Chrome 129+**（2024 年 9 月）
- **Edge 129+**
- **Firefox 129+**（2024 年 8 月）
- **Safari 17.4+**（2024 年 3 月）

支持率截至 2024 年底约 90%+，主流浏览器均已支持。

### 渐进增强

`interpolate-size` 是天然的渐进增强属性。不支持的浏览器会忽略该属性，尺寸关键字过渡立即跳变（功能完整但无过渡效果）。无需额外写降级代码，新旧浏览器体验都不会出错。

如果需要保证动画效果，可用 `@supports` 检测：

```css
.panel {
  /* 基础样式：所有浏览器 */
  transition: height 0.4s ease;
  overflow: hidden;
}
@supports (interpolate-size: allow-keywords) {
  .panel {
    interpolate-size: allow-keywords;
  }
  .panel[data-state="expanded"] { height: auto; }
}
@supports not (interpolate-size: allow-keywords) {
  /* 不支持时回退到 max-height 技巧 */
  .panel[data-state="expanded"] { max-height: 1000px; }
}
```

实际项目中直接使用 `interpolate-size: allow-keywords` 即可，不支持浏览器自动回退到无过渡的跳变，不影响功能。

## 七、实战案例

### 案例 1：Accordion 折叠面板

最经典的 `interpolate-size` 应用场景。多个折叠项，点击展开/收起，高度从 0 平滑过渡到 auto。

```css
.accordion-item {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  margin-bottom: 0.5rem;
}
.accordion-header {
  padding: 1rem;
  cursor: pointer;
  user-select: none;
}
.accordion-panel {
  interpolate-size: allow-keywords;
  transition: height 0.4s ease;
  overflow: hidden;
}
.accordion-item[data-state="collapsed"] .accordion-panel {
  height: 0;
}
.accordion-item[data-state="expanded"] .accordion-panel {
  height: auto;
}
```

```javascript
// 切换 data-state 即可触发过渡
header.addEventListener('click', () => {
  const state = item.dataset.state === 'collapsed' ? 'expanded' : 'collapsed';
  item.dataset.state = state;
});
```

### 案例 2：下拉菜单展开

下拉菜单从折叠态 0 过渡到 `min-content`（最小内容宽度），自适应菜单项最短宽度。

```css
.dropdown {
  position: relative;
}
.dropdown-menu {
  interpolate-size: allow-keywords;
  transition: block-size 0.3s ease-out;
  overflow: hidden;
  position: absolute;
  top: 100%;
  left: 0;
}
.dropdown[data-state="collapsed"] .dropdown-menu {
  block-size: 0;
}
.dropdown[data-state="expanded"] .dropdown-menu {
  block-size: min-content;
}
```

### 案例 3：卡片宽度展开

卡片点击后宽度从固定值过渡到 `max-content`（最大内容宽度），完整展示内容。

```css
.card {
  interpolate-size: allow-keywords;
  transition: inline-size 0.5s ease-in-out;
  overflow: hidden;
}
.card[data-state="collapsed"] {
  inline-size: 200px;
}
.card[data-state="expanded"] {
  inline-size: max-content;
}
```

### 案例 4：calc-size 计算（auto + padding 补偿）

面板展开时使用 `calc-size(auto, size + 20px)` 在自动高度基础上加 20px，补偿 padding 导致的尺寸偏差。

```css
.panel {
  interpolate-size: allow-keywords;
  transition: height 0.4s ease;
  overflow: hidden;
  padding: 10px 0;
}
.panel[data-state="collapsed"] {
  height: 0;
}
.panel[data-state="expanded"] {
  /* auto 高度 + 20px 补偿 padding（上下各 10px） */
  height: calc-size(auto, size + 20px);
}
```

## 八、常见陷阱与最佳实践

### 陷阱 1：忘记设置 overflow: hidden

折叠态 `height: 0` 时，内容仍会溢出可见。必须设置 `overflow: hidden` 裁剪溢出内容。

```css
.panel {
  overflow: hidden; /* 必需 */
  interpolate-size: allow-keywords;
  transition: height 0.4s ease;
}
```

### 陷阱 2：嵌套折叠面板的过渡冲突

外层面板过渡时，内层面板的 `auto` 高度可能随外层高度变化而跳变。解决方案：内层面板单独设置 `interpolate-size: allow-keywords` 与 `transition`，让内层独立过渡。

### 陷阱 3：calc-size() 表达式语法错误

`calc-size()` 的表达式部分使用 `size` 关键字代表基础尺寸，语法与 `calc()` 一致。常见错误：忘记 `size` 关键字（如 `calc-size(auto, + 20px)` 是错的，应为 `calc-size(auto, size + 20px)`）。

### 陷阱 4：inline style 无法触发 interpolate-size

`interpolate-size` 需要经过 CSS 级联才能生效。inline style（如 `style="height: auto; transition: height 0.4s;"`）中的 `auto` 不会触发插值。必须使用 CSS 类或 `[data-state]` 选择器切换状态。

### 最佳实践

1. **在 `:root` 声明 `interpolate-size: allow-keywords`**：全站统一开启尺寸关键字插值，避免每个元素重复声明。
2. **配合 `overflow: hidden`**：折叠态尺寸为 0 时裁剪溢出内容。
3. **用 `data-state` 属性切换状态**：声明式切换，便于 JS 操作与 CSS 选择器匹配。
4. **渐进增强无需降级代码**：不支持浏览器自动回退到跳变，功能完整。
5. **`calc-size()` 仅在需要计算时使用**：纯 `auto` 过渡无需 `calc-size()`。

## 配套工具与总结

本文配套的在线工具：[CSS interpolate-size 尺寸插值动画生成器](/interpolate-size)——可视化生成 `interpolate-size` 与 `calc-size()` CSS 代码，8 组预设覆盖折叠面板、下拉菜单、卡片展开等场景。

`interpolate-size` 的核心价值：**让 CSS 从"max-height 黑魔法"升级为"浏览器原生 auto 过渡"**——无需 JS 测量、无需猜测高度值、过渡曲线自然、嵌套面板互不干扰。配合 `calc-size()` 函数，尺寸关键字具备计算能力，覆盖从简单 auto 过渡到复杂尺寸计算的完整场景。

与其他 CSS 动画能力的协同：`interpolate-size`（尺寸关键字插值）+ `@starting-style`（元素首次出现入场）+ `view-transition`（DOM 状态切换视图过渡）+ `transition`（属性变化过渡）+ `animation`（时间驱动循环动画）形成完整的 CSS 动画能力矩阵。推荐阅读：

- [CSS @starting-style 入场动画完全指南](/blog/starting-style-guide)
- [CSS view-transition 视图过渡完全指南](/blog/view-transition-guide)
- [CSS transition 过渡完全指南](/blog/transition-guide)
- [CSS animation 动画完全指南](/blog/animation-guide)
