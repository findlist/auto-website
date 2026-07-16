---
title: 'CSS Nesting 原生嵌套完全指南：& 选择器、@media 嵌套与 Sass 对比'
description: '深入解析 CSS Nesting 原生嵌套：& 嵌套选择器用法、隐式嵌套与显式嵌套区别、嵌套 @media / @supports / @container 等 at-rule、与 Sass/Less 预处理器嵌套的本质差异、浏览器兼容性、嵌套深度最佳实践。附卡片组件、按钮状态、响应式布局、导航菜单等实战示例。'
pubDate: 2026-07-14
tags: ['CSS', 'nesting', '原生嵌套', 'CSS嵌套', '& 选择器', '嵌套选择器', '@media', 'at-rule', '组件化', 'BEM', '样式作用域', 'Sass', 'Less', '预处理器', '前端开发', '设计工具']
relatedTool: '/nesting'
---

CSS Nesting（CSS 嵌套模块 Level 1）是 2023 年正式落地的原生 CSS 特性，允许在一个选择器内部嵌套定义另一个选择器的样式，语法与 Sass/Less 等预处理器的嵌套类似，但由浏览器原生解析，无需编译。这一特性彻底改变了 CSS 的组织方式——把同一组件的相关样式聚合在一起，提升可维护性，同时摆脱对预处理器的依赖。本文系统解析 & 嵌套选择器、隐式与显式嵌套、嵌套 at-rule、与 Sass 的本质差异、浏览器兼容性与最佳实践。

## 一、原生嵌套的诞生背景与核心价值

在原生嵌套出现之前，CSS 的组织方式存在三大痛点：

- **样式组织松散**：传统 CSS 必须把同一组件的样式分散在多处。例如 `.card` 的基础样式、`.card .title` 的子元素样式、`.card:hover` 的悬停样式往往散落在文件不同位置，难以一次性看清组件的全部样式规则。
- **预处理器依赖**：过去实现嵌套必须引入 Sass/Less/Stylus 等预处理器，增加构建链复杂度。小型项目或原生 CSS 场景无法享受嵌套带来的组织便利。
- **选择器重复**：传统写法需重复书写父选择器（如 `.card`、`.card .title`、`.card:hover`、`.card .body`），既冗长又容易遗漏前缀。

原生嵌套解决了这些问题：

```css
/* 传统写法：样式分散，选择器重复 */
.card { padding: 24px; border-radius: 12px; }
.card .title { font-size: 18px; font-weight: 600; }
.card .body { color: #555; line-height: 1.6; }
.card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.12); }

/* 原生嵌套写法：聚合组织，结构清晰 */
.card {
  padding: 24px;
  border-radius: 12px;
  .title { font-size: 18px; font-weight: 600; }
  .body { color: #555; line-height: 1.6; }
  &:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.12); }
}
```

原生嵌套由浏览器直接解析，无需任何编译步骤，性能与原生 CSS 完全一致。

## 二、& 嵌套选择器详解

`&` 是嵌套选择器（nesting selector），代表父选择器的引用。它有两种核心用法：

### 显式用法（必须使用 &）

当子选择器需要"附加"到父选择器上时，必须使用 `&`：

```css
.btn {
  /* & 引用 .btn，&:hover 等价于 .btn:hover */
  &:hover { background: #1d4ed8; }
  &:active { transform: scale(0.96); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &.active { color: #fff; background: #2563eb; }
  &::before { content: ''; display: inline-block; }
  & + .sibling { margin-left: 8px; }
}
```

这些场景下 `&` 不可省略——伪类（`:hover`）、伪元素（`::before`）、类名附加（`.active`）、兄弟选择器（`+ .sibling`）都必须明确"附加"到父选择器上，浏览器需要 `&` 来识别这种关系。

### 隐式用法（可省略 &）

当子选择器是"后代关系"时，可省略 `&`：

```css
.card {
  /* 以下两种写法等价 */
  .title { font-size: 18px; }
  & .title { font-size: 18px; }
}
```

浏览器会自动把无 `&` 前缀的子选择器推断为后代选择器。但建议在可能引起歧义时显式使用 `&`，语义更清晰。

### & 不能拼接字符串（与 Sass 的关键差异）

Sass 中 `&` 可拼接字符串实现 BEM 命名：

```scss
/* Sass 支持 & 拼接 */
.card {
  &__title { font-size: 18px; }  /* 编译为 .card__title */
  &--active { background: blue; } /* 编译为 .card--active */
}
```

但原生嵌套的 `&` 只能作为完整选择器引用，**不能拼接字符串**：

```css
/* 原生嵌套不支持 & 拼接，以下写法无效 */
.card {
  &__title { }   /* 无效！不会编译为 .card__title */
  &--active { }  /* 无效！不会编译为 .card--active */
}
```

这是原生嵌套相对 Sass 的主要限制。若需 BEM 命名，仍需使用传统写法或 Sass。

## 三、嵌套 @media / @supports / @container 等 at-rule

CSS Nesting 允许在选择器内部嵌套 at-rule，最常见的场景是嵌套 `@media` 实现组件级响应式：

```css
.card {
  padding: 32px;
  font-size: 16px;
  /* 嵌套 @media：把响应式规则聚合在组件内部 */
  @media (max-width: 768px) {
    padding: 16px;
    .title { font-size: 18px; }  /* @media 内可继续嵌套选择器 */
  }
  @media (max-width: 480px) {
    padding: 12px;
    font-size: 14px;
  }
}
```

等价于传统写法：

```css
.card { padding: 32px; font-size: 16px; }
@media (max-width: 768px) {
  .card { padding: 16px; }
  .card .title { font-size: 18px; }
}
@media (max-width: 480px) {
  .card { padding: 12px; font-size: 14px; }
}
```

嵌套写法把同一组件的响应式规则聚合在一起，避免在不同断点文件中分散维护。同理可嵌套 `@supports`（特性查询）、`@container`（容器查询）等。

## 四、原生嵌套与 Sass/Less 预处理器嵌套对比

两者语法相似但有本质差异：

| 维度 | 原生嵌套 | Sass/Less |
|------|----------|-----------|
| 解析方式 | 浏览器直接解析 | 构建工具编译 |
| 性能 | 与原生 CSS 一致 | 编译消耗时间 |
| 功能范围 | 仅嵌套语法 | 变量、混入、函数、循环等 |
| 选择器拼接 | `&` 不能拼接字符串 | `&` 可拼接（BEM 命名） |
| 依赖 | 无需任何依赖 | 需引入预处理器 |

**迁移建议**：新项目可直接使用原生嵌套，搭配 CSS Custom Properties（`--var`）实现变量、`@layer` 实现层叠控制，覆盖大部分预处理器能力。BEM 命名场景仍需 Sass 或传统写法。

## 五、浏览器兼容性

CSS Nesting 自 2023 年起在所有主流浏览器中已全面支持：

- Chrome 112+（2023 年 4 月）
- Edge 112+（2023 年 4 月）
- Firefox 117+（2023 年 8 月）
- Safari 16.5+（2023 年 5 月）

根据 caniuse 数据，全球浏览器支持率已超过 95%。当前新项目可直接使用原生嵌套无需任何 polyfill。如需兼容旧浏览器，可用 PostCSS [`postcss-nesting`](https://github.com/csstools/postcss-plugins/tree/main/plugins/postcss-nesting) 插件自动降级编译为传统 CSS。

## 六、嵌套深度最佳实践

嵌套虽好但过深会带来问题：

- **选择器特异性升高**：每层嵌套增加一个选择器，特异性提高，后续覆盖样式更困难
- **选择器长度增加**：编译后选择器变长（如 `.card .body .title .text`），性能略降且可读性差
- **耦合度上升**：深层嵌套依赖父选择器结构，组件难以复用到其他位置

**最佳实践**：建议嵌套不超过 3 层。组件级样式用 1-2 层嵌套组织，状态修饰（`&:hover` / `&.active`）用 1 层。避免为了"组织代码"而深层嵌套后代选择器——优先用 BEM 命名或 CSS Custom Properties 控制样式。

```css
/* 推荐：1-2 层嵌套，结构清晰 */
.card {
  padding: 24px;
  .title { font-size: 18px; }
  &:hover { transform: translateY(-2px); }
  @media (max-width: 768px) { padding: 16px; }
}

/* 避免：嵌套过深，特异性高，难以覆盖 */
.card {
  .body {
    .content {
      .text {
        .paragraph { color: #555; }  /* .card .body .content .text .paragraph */
      }
    }
  }
}
```

## 七、典型布局模式与实战示例

### 模式 1：卡片组件（基础嵌套 + 状态修饰）

```css
.card {
  padding: 24px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  transition: transform 0.2s, box-shadow 0.2s;
  .title { font-size: 18px; font-weight: 600; margin: 0 0 8px; }
  .body { color: #555; line-height: 1.6; margin: 0; }
  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  }
}
```

### 模式 2：按钮状态管理

```css
.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  background: #2563eb;
  color: #fff;
  cursor: pointer;
  transition: all 0.15s;
  &:hover { background: #1d4ed8; }
  &:active { transform: scale(0.96); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}
```

### 模式 3：响应式组件（嵌套 @media）

```css
.card {
  padding: 32px;
  .title { font-size: 24px; margin: 0 0 12px; }
  @media (max-width: 768px) {
    padding: 16px;
    .title { font-size: 18px; }
  }
}
```

### 模式 4：表单输入（状态 + 类名修饰）

```css
.input {
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  &:focus {
    border-color: #2563eb;
    box-shadow: 0 0 0 3px rgba(37,99,235,0.15);
  }
  &.error { border-color: #dc2626; }
}
```

## 八、与配套工具协同及延伸学习

CSS Nesting 与本站其他 CSS 工具形成完整生态：

- 与 [/container](/container) 容器查询协同：嵌套 `@container` 实现组件级响应式
- 与 [/flexbox](/flexbox) / [/grid](/grid) 协同：嵌套布局规则，组织复杂组件结构
- 与 [/writing-mode](/writing-mode) 协同：嵌套多语言排版规则
- 与 [/scroll-snap](/scroll-snap) 协同：嵌套滚动捕捉规则

**延伸学习**：
- [MDN: CSS Nesting Module](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_nesting)
- [caniuse: CSS Nesting](https://caniuse.com/css-nesting)
- [Chrome 112 发布说明](https://developer.chrome.com/blog/css-nesting-polyfill)

使用本站的 [CSS Nesting 原生嵌套生成器](/nesting) 可可视化编辑嵌套结构，实时预览效果，一键复制嵌套 CSS 代码，无需手动拼接选择器。内置 8 组预设覆盖卡片、按钮、响应式、导航、表单、列表、工具提示等常见场景，适合学习与实践。
