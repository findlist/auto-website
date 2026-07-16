---
title: 'CSS Grid 网格布局完全指南：轨道、单元格、二维布局与典型布局模式'
description: '深入解析 CSS Grid 二维布局：轨道与 fr 单位、显式与隐式轨道、跨列跨行、自动排列与密集填充，附三列等宽与圣杯等典型布局实践。'
pubDate: 2026-07-13
tags: ['CSS', 'Grid', '网格布局', 'grid-template-columns', 'fr 单位', 'grid-auto-flow', 'justify-items', 'align-items', '二维布局', '前端开发', '设计工具']
relatedTool: '/grid'
---

CSS Grid Layout 是 CSS 史上最强大的布局系统，它将 CSS 从"勉强能布局"提升到"原生二维布局语言"。与 Flexbox 的一维模型不同，Grid 可同时控制行与列两个方向，使页面主布局、卡片墙、仪表盘、杂志式排版等复杂二维结构变得直观可解。本文系统解析 Grid 的核心概念、容器与项属性、典型布局模式与实战注意事项。

## 一、核心概念：轨道、单元格、网格线

理解 Grid 的关键是掌握三个基础概念：

- **轨道（track）**：网格中一行或一列的统称。列轨道由 `grid-template-columns` 声明，行轨道由 `grid-template-rows` 声明。
- **单元格（cell）**：行轨道与列轨道交叉形成的最小区域，类似表格的 td。
- **网格线（grid line）**：轨道之间的分隔线，编号从 1 开始。N 条列轨道产生 N+1 条纵向网格线。

```css
.container {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr; /* 3 条列轨道，4 条纵向网格线 */
  grid-template-rows: 100px 100px;    /* 2 条行轨道，3 条横向网格线 */
}
```

上述代码创建 3×2 共 6 个单元格的网格。项默认按 `grid-auto-flow: row`（行优先）顺序填充单元格。

### 网格线编号与跨度

网格线编号从 1 开始，可用 `grid-column: 1 / 3` 指定项从第 1 条线到第 3 条线，跨越 2 个轨道。更直观的写法是 `grid-column: span 2`，表示跨越 2 个轨道，无需关心具体网格线编号：

```css
.item-featured {
  grid-column: span 2; /* 跨越 2 个列轨道 */
  grid-row: span 1;    /* 占 1 个行轨道 */
}
```

## 二、fr 单位：Grid 的弹性长度

`fr`（fractional unit，分数单位）是 Grid 特有的弹性长度单位，表示按比例分配容器的**剩余空间**。这是 Grid 区别于传统布局的核心能力之一。

### fr vs px vs %

| 单位 | 计算基础 | 特性 |
|------|----------|------|
| `px` | 绝对像素 | 固定宽度，不随容器变化 |
| `%` | 容器总尺寸 | 永远是容器指定百分比 |
| `fr` | 容器剩余空间 | 弹性分配，先扣除固定轨道再按比例分 |

```css
/* 三等分：3 个 fr 平分全部剩余空间 */
grid-template-columns: 1fr 1fr 1fr;

/* 固定侧栏 + 自适应主内容：先扣 200px，剩余全给主内容 */
grid-template-columns: 200px 1fr;

/* 中间宽两边窄：按 1:2:1 比例分配剩余空间 */
grid-template-columns: 1fr 2fr 1fr;

/* 混合固定 + 弹性 + 百分比 */
grid-template-columns: 200px 1fr 50%;
```

`fr` 与 `%` 的关键差异：`50%` 永远是容器一半，但 `1fr 1fr` 平分的是**剩余空间**而非总尺寸。若同时有 `200px 1fr 1fr`，则先扣除 200px，剩余空间再被两个 1fr 平分。

### repeat() 与 minmax()

`repeat()` 简写重复轨道，`minmax()` 定义轨道尺寸范围：

```css
/* 4 个等宽列 */
grid-template-columns: repeat(4, 1fr);

/* 每列最小 200px、最大 1fr，自适应列数 */
grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));

/* minmax 保证项不会被压缩过小 */
grid-template-rows: minmax(80px, auto) 1fr minmax(60px, auto);
```

`repeat(auto-fit, minmax(200px, 1fr))` 是响应式卡片墙的经典写法——容器变宽时自动增加列数，变窄时自动减少列数，每列最小 200px。

## 三、容器属性详解

### grid-template-columns / grid-template-rows

定义显式列轨道与行轨道。空值（`none`）表示不显式定义，由项的数量与 `grid-auto-flow` 自动决定。

```css
.container {
  grid-template-columns: 200px 1fr 200px; /* 圣杯布局：侧栏+主+侧栏 */
  grid-template-rows: 80px 1fr 60px;      /* Header+Main+Footer */
}
```

### grid-auto-flow：自动排列策略

控制项在网格中的排列方向与密集填充策略：

- `row`（默认）：行优先，先填满第一行再换行。
- `column`：列优先，先填满第一列再换列。
- `row dense` / `column dense`：启用密集填充，后续小项会回头填补前面因跨列/跨行留下的空隙。

```css
.container {
  grid-auto-flow: row dense; /* 行优先 + 密集填充 */
}
```

`dense` 策略让网格更紧凑，但可能打乱 DOM 顺序，导致视觉顺序与屏幕阅读器朗读顺序不一致，对无障碍体验不友好。需谨慎使用。

### gap：轨道间距简写

`gap` 是 `row-gap` 和 `column-gap` 的简写，定义轨道之间的间距：

```css
.container {
  gap: 16px;          /* 行列间距相同 */
  gap: 16px 8px;      /* 行间距 16px，列间距 8px */
  row-gap: 16px;      /* 单独设置行间距 */
  column-gap: 8px;    /* 单独设置列间距 */
}
```

`gap` 仅作用于轨道之间，不影响容器边缘——这与 `margin` 不同，是 Grid 推荐用 `gap` 替代 `margin` 的原因。`gap` 不会产生外边距合并、不会在容器边缘产生多余间距、换行时自动应用，语义清晰。

### justify-items / align-items：项在单元格内对齐

控制项在所属单元格内的对齐方式：

- `justify-items`：水平方向对齐（stretch / start / center / end）。
- `align-items`：垂直方向对齐（stretch / start / center / end / baseline）。

```css
.container {
  justify-items: center; /* 所有项在单元格内水平居中 */
  align-items: center;   /* 所有项在单元格内垂直居中 */
}
```

默认值 `stretch` 会让项拉伸填满整个单元格，这是 Grid 项默认等高的原因。

### justify-content / align-content：整个网格在容器内分布

控制整个网格（而非单项）在容器内的分布方式，仅当网格总尺寸小于容器尺寸时生效：

```css
.container {
  grid-template-columns: 100px 100px; /* 总宽 200px */
  width: 400px;
  justify-content: center; /* 200px 网格在 400px 容器内水平居中 */
}
```

`justify-content` 与 `align-content` 支持 `start / end / center / space-between / space-around / space-evenly / stretch`，与 Flexbox 的 `justify-content` 语义一致。

**记忆口诀**：items 管单元格内项的位置，content 管整个网格在容器内的位置。

## 四、项属性详解

### grid-column / grid-row：跨列跨行

指定项跨越的列轨道数与行轨道数。两种语法：

```css
.item {
  /* span 语法：跨越 N 个轨道，从自动位置开始 */
  grid-column: span 2;  /* 跨 2 列 */
  grid-row: span 3;     /* 跨 3 行 */

  /* 网格线语法：指定起止网格线 */
  grid-column: 1 / 3;   /* 从第 1 线到第 3 线，跨 2 列 */
  grid-row: 2 / 4;      /* 从第 2 线到第 4 线，跨 2 行 */
}
```

`span N` 语法更常用，无需关心具体网格线编号，浏览器自动分配起始位置。

### justify-self / align-self：单项独立对齐

覆盖容器的 `justify-items` / `align-items`，为单项指定独立对齐方式：

```css
.item-featured {
  justify-self: start;  /* 单独左对齐 */
  align-self: center;   /* 单独垂直居中 */
}
```

默认值 `auto` 表示继承容器的 `justify-items` / `align-items`。

### grid-area：命名区域

`grid-area` 既可命名项，也可作为 `grid-row-start / grid-column-start / grid-row-end / grid-column-end` 的简写：

```css
.container {
  grid-template-areas:
    "header header header"
    "sidebar main main"
    "footer footer footer";
}

.header { grid-area: header; }
.main { grid-area: main; }
```

`grid-template-areas` 提供了直观的命名布局语法，但本工具暂未开放该能力，因其与 `grid-column: span N` 在多数场景下可互换。

## 五、显式 vs 隐式轨道

### grid-template-* 与 grid-auto-* 的关系

- `grid-template-columns` / `grid-template-rows`：定义**显式轨道**，网格的固定结构。
- `grid-auto-columns` / `grid-auto-rows`：定义**隐式轨道**尺寸，当项数量超出显式网格时自动生成的轨道尺寸。

```css
.container {
  grid-template-columns: 1fr 1fr 1fr; /* 显式 3 列 */
  grid-auto-rows: 100px;              /* 隐式行高度 100px */
  /* 若有 7 个项，第 4-7 项进入隐式第 3 行起，每行 100px */
}
```

隐式轨道默认尺寸为 `auto`（按内容撑开）。`grid-auto-rows: minmax(100px, auto)` 是常见用法——保证行最小高度 100px，最大按内容撑开。

## 六、典型布局模式

### 1. 三列等宽

最基础的响应式网格：

```css
.container {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 16px;
}
```

配合 `repeat(auto-fit, minmax(200px, 1fr))` 可实现自适应列数。

### 2. 圣杯布局

经典的固定侧栏 + 自适应主内容：

```css
.container {
  display: grid;
  grid-template-columns: 200px 1fr 200px;
  grid-template-rows: 100px 1fr 60px;
  grid-template-areas:
    "header header header"
    "sidebar main aside"
    "footer footer footer";
  gap: 12px;
  min-height: 100vh;
}
```

### 3. 侧栏 + 主内容

两栏布局，侧栏固定宽度，主内容自适应：

```css
.container {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 16px;
}
```

### 4. 卡片网格

响应式卡片墙，列数随容器宽度自适应：

```css
.container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}
```

`auto-fill` 与 `auto-fit` 的差异：前者保留空列位置，后者折叠空列让现有列拉伸填满。卡片墙通常用 `auto-fit`。

### 5. Header-Main-Footer

垂直三段布局：

```css
.container {
  display: grid;
  grid-template-rows: 80px 1fr 60px;
  gap: 12px;
  min-height: 100vh;
}
```

### 6. 杂志布局

不规则跨列跨行，营造视觉层次：

```css
.container {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  grid-template-rows: 150px 150px;
  gap: 12px;
}

.article-featured {
  grid-column: span 2;  /* 头图跨 2 列 */
  grid-row: span 1;
}

.article-vertical {
  grid-column: span 1;
  grid-row: span 2;     /* 跨 2 行 */
}
```

## 七、Grid 与 Flexbox 协同

Grid 与 Flexbox 并非互斥，而是互补关系。现代前端布局的黄金组合是：

- **页面主布局用 Grid**：控制整体二维结构，如 Header/Sidebar/Main/Footer 的宏观布局。
- **组件内部用 Flexbox**：控制组件内一维排列，如导航栏、按钮组、表单项。

```css
/* 页面主布局：Grid 控制二维结构 */
.app {
  display: grid;
  grid-template-areas:
    "header header"
    "sidebar main"
    "footer footer";
  grid-template-columns: 240px 1fr;
  grid-template-rows: 60px 1fr 40px;
  min-height: 100vh;
}

/* 组件内部：Flexbox 控制一维排列 */
.nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
```

这种分层组合让布局职责清晰：Grid 负责"页面骨架"，Flexbox 负责"组件血肉"。

## 八、浏览器兼容性与配套工具协同

### 浏览器支持

Grid 在所有现代浏览器中已全面支持：

- Chrome 57+（2017 年 3 月）
- Firefox 52+（2017 年 3 月）
- Safari 10.1+（2017 年 3 月）
- Edge 16+（2017 年 10 月）

`subgrid`（子网格）是较新的特性，Chrome 117+、Firefox 71+、Safari 16+ 支持。本工具的所有属性在主流浏览器中均无需前缀。

### 配套工具协同

- [CSS Flexbox 可视化生成器](/flexbox)：与 Grid 形成"布局双壁"，Flexbox 负责一维，Grid 负责二维。
- [CSS box-shadow 生成器](/box-shadow)：为 Grid 项添加阴影，增强层次感。
- [CSS clip-path 路径裁剪](/clip-path)：对 Grid 项进行不规则裁剪，创造创意布局。
- [CSS 渐变生成器](/gradient)：为 Grid 项背景添加渐变，丰富视觉表现。

## 结语

CSS Grid 是 CSS 布局的终极形态，掌握它意味着可以用最少的代码实现最复杂的二维布局。本工具提供完整的 Grid 属性可视化编辑——从轨道定义到项级跨列跨行，从对齐分布到自动排列策略，配合 8 组预设布局覆盖最常见场景。建议从预设开始体验，再逐步深入自定义轨道与项属性，最终形成对 Grid 二维布局的直觉。

Grid 的学习曲线比 Flexbox 陡峭，但一旦掌握，你会发现它能用更少的代码、更清晰的结构、更少的人为约束解决 Flexbox 难以处理的二维布局问题。从今天起，把页面主布局交给 Grid，让 Flexbox 回归组件内部，你会发现前端布局从未如此优雅。
