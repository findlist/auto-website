---
title: 'CSS text-wrap 文本换行排版优化完全指南：balance 平衡换行、pretty 优化换行与渐进降级'
description: '深入解析 CSS text-wrap 属性（CSS Text Module Level 4）：五种值（wrap / nowrap / balance / pretty / stable）详解、balance 平衡换行算法原理与 10 行限制、pretty 孤行优化策略、text-wrap 与 white-space 的关系与选型、浏览器兼容性（Chrome 114+ / Firefox 121+ / Safari 17.5+）与渐进降级、实战案例与最佳实践。'
pubDate: 2026-07-15
tags: ['CSS', 'text-wrap', 'balance', 'pretty', '排版优化', '文本换行', '孤行', '渐进增强', '前端开发', 'CSS Text Module', '设计工具', 'nowrap', 'stable']
relatedTool: '/text-wrap'
---

# CSS text-wrap 文本换行排版优化完全指南

CSS `text-wrap` 是 CSS Text Module Level 4 引入的文本换行控制属性，2023-2024 年在 Chrome 114+、Firefox 121+、Safari 17.5+ 逐步落地。它提供 `balance`（平衡换行）、`pretty`（优化换行）、`stable`（稳定换行）等智能换行策略，解决传统 `wrap` 换行的标题参差不齐、段落孤行、编辑跳动三大痛点。一行 CSS 即可显著提升排版质量，且支持渐进增强——旧浏览器自动回退为默认换行，不影响可用性。本文系统解析 `text-wrap` 的五种值、算法原理、兼容性降级与实战案例。

## 一、诞生背景与核心价值

在 `text-wrap` 出现之前，CSS 控制文本换行只有 `white-space` 属性，提供 `normal`（换行）、`nowrap`（不换行）、`pre`（保留空白）等基本选项。但 `white-space` 只能控制"换不换行"，无法控制"怎么换行"——断行点完全由浏览器按容器宽度贪心填充，带来三个排版痛点：

- **标题参差不齐**：标题文本按容器宽度逐行填充，最后一行可能只剩几个字。例如"CSS text-wrap 属性让标题换行更优雅"，wrap 可能在第二行只留下"更优雅"三个字，视觉不均衡。
- **段落孤行问题**：段落正文换行后，最后一行只剩一个词（英文）或几个字（中文），阅读体验差，印刷排版中称为"孤行"（orphan）。
- **编辑时文本跳动**：在 `contenteditable` 编辑区输入文字时，每输入一个字符浏览器重新计算换行，新增字符可能导致前面的行重新排列，用户看到文本不停跳动。

`text-wrap` 属性提供了纯 CSS 声明式的解决方案：

```css
/* 标题：平衡换行，各行长度均衡 */
.title {
  text-wrap: balance;
}

/* 段落：优化换行，避免孤行 */
.paragraph {
  text-wrap: pretty;
}

/* 编辑区：稳定换行，编辑不跳 */
.editor {
  text-wrap: stable;
}
```

核心价值在于把换行策略从"浏览器贪心填充"升级为"智能优化"——`balance` 让各行均衡，`pretty` 避免孤行，`stable` 保持编辑稳定。且这些值都是渐进增强的：不支持的浏览器忽略声明，回退为默认 `wrap`，不影响可用性。

## 二、text-wrap 五种值详解

`text-wrap` 属性接受五个值，各自控制不同的换行策略：

### 1. wrap（默认值）

```css
.text { text-wrap: wrap; }
```

浏览器默认的换行算法：文本按容器宽度逐行填充，填满一行后换行。算法简单高效（O(n) 复杂度），但可能出现孤行——最后一行只剩一个词或几个字，视觉不均衡。适合一般正文场景，对排版质量要求不高时使用。

### 2. nowrap（不换行）

```css
.tag {
  text-wrap: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap; /* 兼容旧浏览器 */
}
```

禁止文本换行，所有内容强制在一行内。超出容器宽度的部分会被截断或溢出，需配合 `overflow: hidden` 和 `text-overflow: ellipsis` 处理。适合标签、按钮文本、导航项等短文本场景。注意：`text-wrap: nowrap` 等价于 `white-space: nowrap`，为兼容旧浏览器建议同时写两者。

### 3. balance（平衡换行）

```css
h1, h2, h3 { text-wrap: balance; }
```

浏览器计算最优断行点，让各行长度尽量均衡。算法会遍历所有可能的断行组合，选择让各行长度差异最小的方案。限制最多 10 行（超过则退化为 wrap），因此适合标题、引言等短文本块。Chrome 114+ / Firefox 121+ / Safari 17.5+ 支持。

### 4. pretty（优化换行）

```css
p { text-wrap: pretty; }
```

在 `wrap` 基础上优化断行策略，避免孤行——即避免最后一行只剩一个词。浏览器会提前将上一个词换到下一行，让末行更充实。计算开销比 `balance` 小，无行数限制，适合段落正文等长文本。目前 Chrome 117+ 支持，Firefox/Safari 暂不支持（降级为 wrap）。

### 5. stable（稳定换行）

```css
[contenteditable] { text-wrap: stable; }
```

编辑场景专用：在 `contenteditable` 中输入文字时，光标后面的行不会因新增字符而重新换行，保持前面行的稳定性。避免编辑时文本跳动。目前 Firefox 支持，Chrome/Safari 暂不支持。

## 三、balance 平衡换行：算法原理与适用场景

`balance` 是 `text-wrap` 最具价值的值，它让标题换行从"参差不齐"升级为"各行均衡"。

### 算法原理

`balance` 的核心是寻找最优断行方案。以一个 3 行标题为例：

- **wrap（贪心）**：逐行填充，第一行尽量多放字，剩余的留给后续行。结果可能是第一行 12 字、第二行 10 字、第三行 3 字——末行特别短。
- **balance（均衡）**：遍历所有断行组合，计算每种方案的"不均衡度"（各行长度方差），选择方差最小的方案。结果可能是 8 字、8 字、9 字——各行接近。

算法复杂度随行数增长，因此浏览器限制了 10 行上限——超过 10 行时自动退化为 `wrap`，避免性能开销。

### 适用场景

- **h1-h6 标题**：页面主标题、章节标题，通常 1-3 行，balance 效果最明显
- **卡片标题**：商品卡片、文章卡片标题，2-4 行，balance 让卡片更紧凑
- **引言/引用**：blockquote 引言，3-5 行，balance 让引言更优雅
- **列表项**：多行列表项，1-2 行，balance 避免末行过短

### 不适用场景

- **长段落正文**：超过 10 行会退化为 wrap，balance 无效，应使用 `pretty`
- **代码块**：代码换行有语义，不能改变断行点
- **表格单元格**：表格宽度受限，balance 可能导致高度不一致

## 四、pretty 优化换行：孤行问题与解决方案

`pretty` 专注于解决段落的孤行问题，是 `wrap` 的渐进优化版本。

### 孤行问题

孤行（orphan）是指段落最后一行只剩一个词（英文）或几个字（中文）的现象：

```
前端开发中文本换行是一个看似简单却影响阅读
体验的细节。传统的 text-wrap: wrap 按照容器
宽度逐行填充文字，虽然高效但容易出现最后一
行只剩一个词的孤行问题。CSS Text Module
Level 4 引入了 text-wrap 属性，其中 balance
值能让标题各行长度更均衡，pretty 值能优化
段落换行避免孤行，显著提升排版质量。词
```

最后一行只剩"词"一个字，视觉上很不协调。

### pretty 的解决方案

`pretty` 在 `wrap` 的基础上检查最后一行：如果只剩一个词，则提前将上一个词换到下一行，让末行至少有两个词。优化后：

```
前端开发中文本换行是一个看似简单却影响阅读
体验的细节。传统的 text-wrap: wrap 按照容器
宽度逐行填充文字，虽然高效但容易出现最后一
行只剩一个词的孤行问题。CSS Text Module
Level 4 引入了 text-wrap 属性，其中 balance
值能让标题各行长度更均衡，pretty 值能优化
段落换行避免孤行，显著提升排版质量。
一个词
```

末行从"词"变为"一个词"，更充实。代价是倒数第二行可能稍短，但整体视觉更协调。

### 与 balance 的区别

| 特性 | balance | pretty |
|------|---------|--------|
| 目标 | 各行长度均衡 | 避免末行孤行 |
| 行数限制 | 最多 10 行 | 无限制 |
| 计算开销 | 较高（遍历所有组合） | 较低（仅检查末行） |
| 适合场景 | 短文本（标题） | 长文本（段落） |
| 浏览器支持 | Chrome 114+ / FF 121+ / Safari 17.5+ | Chrome 117+（FF/Safari 暂不支持） |

简单经验：短文本用 balance，长文本用 pretty。

## 五、text-wrap vs white-space：属性关系与选型

`text-wrap` 和 `white-space` 都影响文本换行，但控制维度不同。

### 属性关系

- **white-space**：控制空白符和换行符的**处理方式**。如 `nowrap` 禁止换行，`pre` 保留空白和换行，`pre-wrap` 保留空白但正常换行。是 CSS 2.1 的老属性，语法稳定、兼容性极好。
- **text-wrap**：控制换行算法的**策略**。在 `white-space` 允许换行的前提下（即不是 `nowrap`/`pre`），决定如何选择断行点。是 CSS Text Level 4 的新属性，提供 `balance`/`pretty`/`stable` 等智能策略。

### 等价关系

```css
/* 以下两种写法等价 */
.no-wrap-1 { white-space: nowrap; }
.no-wrap-2 { text-wrap: nowrap; }

/* 以下两种写法也等价（默认换行） */
.wrap-1 { white-space: normal; }
.wrap-2 { text-wrap: wrap; }
```

### 选型建议

- **新项目**：优先用 `text-wrap` 统一管理换行策略，语义更清晰
- **老项目**：兼容性考虑，`nowrap` 场景同时写 `white-space: nowrap` 作为回退
- **需要 pre 语义**：仍用 `white-space: pre` / `pre-wrap`（text-wrap 不提供 pre 语义）
- **需要智能换行**：用 `text-wrap: balance` / `pretty`（white-space 无此能力）

## 六、浏览器兼容性与渐进降级

### 各值兼容性（截至 2025 年）

| 值 | Chrome | Edge | Firefox | Safari | 覆盖率 |
|----|--------|------|---------|--------|--------|
| wrap / nowrap | 全版本 | 全版本 | 全版本 | 全版本 | 100% |
| balance | 114+ | 114+ | 121+ | 17.5+ | ~90% |
| pretty | 117+ | 117+ | 暂不支持 | 暂不支持 | ~65% |
| stable | 暂不支持 | 暂不支持 | 支持 | 暂不支持 | 较低 |

### 渐进降级策略

`text-wrap` 是天然的渐进增强属性——不支持的浏览器忽略该声明，回退为默认的 `wrap` 换行，不会报错。因此可放心使用：

```css
/* 标题：新浏览器享受 balance 均衡换行，旧浏览器正常换行 */
h1 { text-wrap: balance; }

/* 段落：新浏览器享受 pretty 避免孤行，旧浏览器正常换行 */
p { text-wrap: pretty; }
```

无需额外写降级代码。对于 `nowrap` 场景，建议同时写 `white-space: nowrap` 确保旧浏览器也不换行：

```css
.tag {
  white-space: nowrap;  /* 旧浏览器降级 */
  text-wrap: nowrap;    /* 新浏览器语义一致 */
  overflow: hidden;
  text-overflow: ellipsis;
}
```

### 特性检测

如需精确控制，可用 `@supports` 检测：

```css
@supports (text-wrap: balance) {
  h1 { text-wrap: balance; }
}
```

但通常没必要——渐进增强的天然降级已经足够。

## 七、实战案例与最佳实践

### 案例 1：全站标题 balance

```css
h1, h2, h3, h4, h5, h6 {
  text-wrap: balance;
}
```

一行 CSS 让全站所有标题享受平衡换行。标题通常不超过 10 行，balance 始终生效。

### 案例 2：文章正文 pretty

```css
article p {
  text-wrap: pretty;
}
```

段落正文用 pretty 避免孤行。长段落无行数限制，pretty 始终生效。

### 案例 3：卡片标题 balance + 段落 pretty

```css
.card-title {
  text-wrap: balance;
  font-size: 20px;
  font-weight: 600;
}

.card-body {
  text-wrap: pretty;
  font-size: 14px;
  line-height: 1.6;
}
```

卡片场景：标题用 balance 紧凑美观，正文用 pretty 避免孤行。

### 案例 4：编辑器 stable

```css
[contenteditable] {
  text-wrap: stable;
}
```

富文本编辑器用 stable 保持编辑稳定，避免输入时文本跳动。

### 最佳实践

1. **balance 只用于短文本**：超过 10 行退化为 wrap，长段落用 pretty
2. **pretty 用于长段落**：无行数限制，避免孤行
3. **nowrap 配合 white-space**：兼容旧浏览器
4. **无需特性检测**：渐进增强天然降级，直接用即可
5. **不要用于代码块**：代码换行有语义，不能改变断行点
6. **配合 line-height**：balance 后各行更均衡，适当增加 line-height 效果更好

### 常见陷阱

- **balance 用于长段落无效**：超过 10 行退化为 wrap，误以为 balance 不生效
- **pretty 在 Firefox 不生效**：目前仅 Chrome 支持，Firefox 降级为 wrap，属正常现象
- **stable 在 Chrome 不生效**：目前仅 Firefox 支持，Chrome 降级为 wrap
- **nowrap 忘记写 white-space**：旧浏览器不支持 text-wrap: nowrap，需 white-space: nowrap 兜底

## 总结

CSS `text-wrap` 属性让文本换行从"浏览器贪心填充"升级为"智能优化"：

- **balance**：各行长度均衡，适合标题（最多 10 行）
- **pretty**：避免末行孤行，适合段落（无行数限制）
- **stable**：编辑不跳动，适合 contenteditable
- **wrap / nowrap**：基础换行/不换行

所有值都支持渐进增强——旧浏览器自动回退为默认换行，可放心使用。一行 CSS 即可显著提升排版质量，是 2024 年起前端排版的必备属性。

想亲手体验 `text-wrap` 各值的效果差异？试试我们的 [CSS text-wrap 文本换行排版优化器](/text-wrap)，支持三值对比模式、可调节排版参数、一键复制 CSS 代码。

更多 CSS 排版工具：[writing-mode 书写模式](/writing-mode)、[scroll-snap 滚动捕捉](/scroll-snap)、[CSS 颜色对比度检测](/color-contrast)。
