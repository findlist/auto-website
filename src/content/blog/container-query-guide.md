---
title: 'CSS @container 容器查询指南：组件级响应式与 container-type'
description: '深入解析 CSS @container 容器查询：container-type 与 container-name 声明、@container 查询语法、与 @media 媒体查询的本质区别、组件级响应式设计，附卡片三栏自适应实战示例。'
pubDate: 2026-07-14
tags: ['CSS', 'container', '容器查询', '@container', 'container-type', 'container-name', 'inline-size', 'size', '响应式设计', '组件级响应式', 'min-width', 'max-width', '前端开发', '设计工具']
relatedTool: '/container'
---

CSS `@container` 容器查询是 2023 年正式落地的现代响应式特性，让组件根据其父容器尺寸应用不同样式，而非视口尺寸。这一突破解决了长期困扰前端开发的"组件级响应式"难题——同一组件放在侧栏 200px 与主区 800px 时可自动应用不同布局，与组件在页面中的位置无关。本文系统解析 container-type 容器声明、@container 查询语法、与 @media 媒体查询的本质区别、命名容器、查询优先级、浏览器兼容性与性能优化。

## 一、容器查询的诞生背景与核心价值

在容器查询出现之前，CSS 响应式设计完全依赖 `@media` 媒体查询——基于浏览器视口（viewport）尺寸应用样式。但视口尺寸无法反映组件实际可用空间：

- 一个卡片组件在桌面端侧栏（窄）与主区（宽）需要不同布局，但 `@media` 只知道"桌面端宽度 1440px"，无法区分卡片在哪个区域
- 组件库作者无法预知组件将放在何处，只能通过 JavaScript 检测容器尺寸或暴露 props 让外部控制

容器查询填补了这一空白：

```css
/* 声明 containment context */
.card-wrapper {
  container-type: inline-size;
}

/* 根据容器宽度（不是视口）应用样式 */
@container (min-width: 480px) {
  .card { display: grid; grid-template-columns: 1fr 2fr; }
}

@container (max-width: 320px) {
  .card { display: flex; flex-direction: column; }
}
```

`@container (min-width: 480px)` 检查的是<strong>最近的 containment context 祖先</strong>的宽度，不是视口。这意味着同一个 `.card` 放在侧栏 200px 时竖排，放在主区 800px 时横排，完全自动。

容器查询的核心价值：**让组件真正"即插即用"**——开发者无需关心组件最终放在哪里，组件自己根据容器尺寸适配。

## 二、container-type 容器类型详解

`container-type` 声明元素为 containment context，决定可查询的维度。三个值的差异如下：

| 值 | 可查询维度 | 元素尺寸影响 | 性能 | 推荐场景 |
|------|------------|--------------|------|----------|
| `size` | width + height | 元素尺寸不再由内容撑开，需显式指定 | 中等 | 需响应高度变化（如全屏 Hero） |
| `inline-size` | 仅 width（inline 方向） | 不影响元素高度计算 | 最优 | 95% 实际场景，推荐默认 |
| `normal`（默认） | 无 | 无 containment | 最优 | 不需要被查询的元素 |

```css
/* 推荐：inline-size */
.sidebar { container-type: inline-size; }

/* 需要响应高度变化 */
.hero { container-type: size; height: 100vh; }

/* 显式关闭 containment（默认值） */
.header { container-type: normal; }
```

**选型建议**：除非有明确的高度响应需求，优先使用 `inline-size`。`size` 会让元素脱离"内容撑开高度"的正常流，可能引发布局副作用（如父容器高度坍塌）。

`container-type: size` 的"布局影响"源于 CSS Containment 规范——`size` 等价于 `layout: contain` + `size: contain`，元素尺寸独立于内容，必须显式指定 `height` 或通过其他方式确定。

## 三、container-name 命名容器与匿名容器

`container-name` 为 containment context 命名，使 `@container` 查询可指定目标容器：

```css
/* 匿名容器（默认） */
.anonymous-wrapper {
  container-type: inline-size;
  /* 未声明 container-name */
}

/* 命名容器 */
.card-wrapper {
  container-type: inline-size;
  container-name: card;
}
```

```css
/* 匹配最近的匿名 containment context */
@container (min-width: 480px) { ... }

/* 仅匹配名为 card 的 containment context */
@container card (min-width: 480px) { ... }
```

**匿名 vs 命名**：
- **匿名**：简单场景足够，`@container (condition)` 匹配最近的祖先 containment context。多层嵌套时可能误匹配
- **命名**：显式指定目标容器，避免命名冲突。组件库或复杂嵌套场景推荐

命名规则：必须是合法 CSS 标识符（字母、数字、连字符），不能以数字开头。多个名称可同时声明：`container-name: card panel`，允许不同查询指向同一容器。

**简写语法**：`container: inline-size card` 等价于 `container-type: inline-size; container-name: card;`，更简洁。

## 四、@container 查询语法与条件组合

`@container` 语法格式：

```css
@container [name] (condition) [and|or (condition)]* {
  /* 命中时应用的样式 */
}
```

### 单条件查询

```css
@container (min-width: 480px) {
  .item { font-size: 18px; }
}

@container (max-width: 320px) {
  .item { font-size: 14px; }
}
```

### 多条件组合

```css
/* 且（and） */
@container (min-width: 320px) and (max-width: 640px) {
  .item { padding: 12px; }
}

/* 或（or） */
@container (min-width: 800px) or (height > 600px) {
  .item { display: grid; }
}

/* 非（not） */
@container not (min-width: 480px) {
  .item { flex-direction: column; }
}
```

### 可查询的尺寸条件

| 条件 | 说明 |
|------|------|
| `width` / `inline-size` | 容器宽度（inline-size 容器可查） |
| `height` / `block-size` | 容器高度（仅 size 容器可查） |
| `aspect-ratio` | 容器宽高比 |
| `orientation` | 容器方向（portrait / landscape） |

注意：`@container` 的 `min-width` / `max-width` 是<strong>容器自身尺寸</strong>而非视口尺寸，这是与 `@media` 的根本区别。

## 五、容器查询与 @media 媒体查询的本质区别

| 维度 | @media 媒体查询 | @container 容器查询 |
|------|----------------|---------------------|
| 查询对象 | 浏览器视口（viewport） | 父容器（containment context） |
| 响应场景 | 整页布局适配（移动 / 平板 / 桌面） | 组件级响应式（侧栏窄 / 主区宽） |
| 组件可移植性 | 差（依赖视口） | 好（自动适配容器） |
| JavaScript 依赖 | 需 ResizeObserver 或 matchMedia 模拟组件级响应 | 原生 CSS 即可 |
| 典型场景 | 全站断点切换 | 卡片、面板、列表项的布局切换 |

### 何时用 @media，何时用 @container？

- **@media**：整站响应式断点（如移动端导航折叠、栅格列数变化）
- **@container**：组件内部响应式（如卡片在窄容器竖排、宽容器横排）
- **两者协同**：外层用 `@media` 控制页面整体布局（侧栏显隐），内层用 `@container` 控制组件内部布局

```css
/* 外层：@media 控制侧栏显隐 */
@media (max-width: 768px) {
  .layout { grid-template-columns: 1fr; }
  .sidebar { display: none; }
}

/* 内层：@container 控制卡片内部布局 */
.card-wrapper { container-type: inline-size; }
@container (min-width: 480px) {
  .card { display: grid; grid-template-columns: 1fr 1fr; }
}
```

## 六、查询优先级与层叠规则

容器查询遵循 CSS 层叠规则：**后定义的查询覆盖先定义的**（同等特异性下）。

```css
@container (min-width: 320px) {
  .item { background: blue; }
}
@container (min-width: 640px) {
  .item { background: green; }
}
```

当容器宽度为 700px 时，两条查询都命中，但后定义的（640px）覆盖前者，最终背景为绿色。

**实战技巧**：从小到大排列断点，让宽屏样式自然覆盖窄屏样式，符合"渐进增强"思想。本工具的"渐变颜色（4 断点）"预设展示了这一规则——4 个查询从 240px 到 800px 递增，拖拽预览容器从窄到宽，颜色依次切换为玫瑰→橙→青柠→青。

**特异性**：`@container` 内的样式特异性由选择器决定，与查询本身无关。`.item` 特异性为 0,0,1,0，`#main .item` 为 0,1,1,0，后者覆盖前者。

**与 @layer 配合**：可将容器查询样式放入 `@layer`，控制与基础样式的优先级：

```css
@layer base, components, queries;

@layer queries {
  @container (min-width: 480px) {
    .item { font-size: 18px; }
  }
}
```

## 七、典型布局模式与实战示例

### 1. 卡片三栏自适应

```css
.gallery-wrapper {
  container-type: inline-size;
  container-name: gallery;
}

@container gallery (min-width: 700px) {
  .gallery { grid-template-columns: repeat(3, 1fr); }
}

@container gallery (min-width: 400px) {
  .gallery { grid-template-columns: repeat(2, 1fr); }
}

/* 默认单列 */
.gallery { grid-template-columns: 1fr; }
```

### 2. 字号自适应（流体排版）

```css
.title-wrapper {
  container-type: inline-size;
}

@container (min-width: 600px) {
  .title { font-size: 28px; }
}
@container (min-width: 360px) {
  .title { font-size: 20px; }
}
```

更优雅的方案是 `clamp()` + 容器查询结合：

```css
.title {
  font-size: clamp(14px, 5cqw, 28px);
}
```

`cqw`（container query width）单位：1cqw = 容器宽度的 1%。这是容器查询的"流体排版"原生方案，无需断点即可平滑缩放。

### 3. 紧凑/宽松切换

```css
.list-wrapper { container-type: inline-size; }

@container (max-width: 280px) {
  .list-item { padding: 8px; font-size: 13px; }
}
@container (min-width: 500px) {
  .list-item { padding: 24px; font-size: 17px; }
}
```

### 4. 侧栏显隐

```css
.layout-wrapper { container-type: inline-size; }

@container (min-width: 768px) {
  .layout { grid-template-columns: 240px 1fr; }
  .sidebar { display: block; }
}
```

## 八、浏览器兼容性与性能优化与配套工具协同

### 浏览器兼容性

| 特性 | Chrome | Firefox | Safari | Edge | 全球支持率 |
|------|--------|---------|--------|------|------------|
| `container-type` / `container-name` | 105+ | 110+ | 16+ | 105+ | > 95% |
| `@container` 规则 | 105+ | 110+ | 16+ | 105+ | > 95% |
| `cqw` / `cqh` / `cqi` 单位 | 105+ | 110+ | 16+ | 105+ | > 95% |
| `style()` 函数查询 | 111+ | 113+ | 17.4+ | 111+ | ~ 90% |

**兼容性建议**：
1. 容器查询在 2026 年已是成熟特性，主流浏览器全面支持
2. 对需要兼容旧浏览器（IE、Chrome 100 以下）的项目，可用 `@supports` 检测后降级为 `@media`
3. `style()` 函数查询（基于自定义属性值）较新，谨慎用于关键功能

```css
/* 渐进增强：不支持容器查询时降级 */
.card { display: flex; flex-direction: column; }
@supports (container-type: inline-size) {
  .card-wrapper { container-type: inline-size; }
  @container (min-width: 480px) {
    .card { flex-direction: row; }
  }
}
```

### 性能优化

1. **优先 `inline-size` 而非 `size`**：`size` 同时影响宽高布局，可能触发更多重排
2. **避免多层嵌套 containment context**：每层都增加样式评估成本
3. **命中样式优先使用合成层属性**：`background`、`color`、`transform` 不触发重排，`width`、`padding` 触发重排
4. **容器查询仅在容器尺寸变化时评估**：正常滚动不触发，性能开销极小
5. **使用 `cqw` 单位实现流体排版**：避免多个断点查询，更平滑

### 配套工具协同

- [@container 容器查询生成器](/container)：本工具，可视化编辑容器查询
- [flexbox 弹性盒子](/flexbox)：组件内部一维布局，配合容器查询响应式切换
- [grid 网格布局](/grid)：组件内部二维布局，列数随容器宽度变化
- [scroll-snap 滚动捕捉](/scroll-snap)：窄容器下卡片轮播，宽容器下网格布局
- [writing-mode 书写模式](/writing-mode)：多语言国际化与容器查询协同

容器查询是 CSS 响应式设计的里程碑——从"视口响应"到"组件响应"，让组件真正即插即用。配合 `cqw` 流体单位、`@layer` 层叠控制、`@supports` 渐进增强，可构建真正"位置无关"的可移植组件。使用 [@container 容器查询生成器](/container) 可视化编辑 container-type、container-name 与多条 @container 查询，拖拽预览容器宽度实时观察命中效果，一键复制 CSS 代码。
