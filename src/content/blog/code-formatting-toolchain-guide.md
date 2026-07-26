---
title: "代码格式化工具链实战：从 JS 格式化到 HTML 转 Markdown 的端到端工作流"
description: "从开发者真实遇到的「JS 格式化后 ASI 陷阱导致行为变化、CSS minify 丢失关键注释致样式失效、HTML 格式化误把 void elements 当容器嵌套、HTML 转 Markdown 表格内嵌套列表结构坍塌、Markdown 渲染未启用 GFM 致表格不渲染」场景切入，系统讲解 JS 格式化、CSS 格式化、HTML 格式化、HTML 转 Markdown、Markdown 渲染预览五道工序的正确顺序与衔接陷阱（ASI 自动分号插入位置错误、CSS 注释保留策略缺失、void elements 与 rawtext 元素处理不当、嵌套结构转换坍塌、GFM 扩展未启用），覆盖前端工程代码规范化、文档站点内容迁移、遗留系统代码清理、技术博客写作工作流、富文本编辑器内容导出五大典型场景，给出端到端工作流与工具矩阵协同建议，适用于前端工程师、全栈开发者、技术写作人员、文档工程师、内容运营的代码格式化与文档转换工作流参考。"
pubDate: 2026-07-27
tags: ["代码格式化", "工具链", "JS", "CSS", "HTML", "Markdown", "文档转换"]
relatedTool: "/js-formatter"
---

## 为什么"代码格式化与文档转换"是独立工作流

把一个**需要先用 JS 格式化恢复 minify 脚本可读性、再用 CSS 格式化整理样式表、接着用 HTML 格式化规范页面结构、然后用 HTML 转 Markdown 工具把富文本页面转为可读文档、最后用 Markdown 渲染预览校验最终展示**的真实工程场景——例如前端工程代码规范化、文档站点内容迁移、遗留系统代码清理、技术博客写作工作流、富文本编辑器内容导出——从散乱的单点格式化操作演进为统一可治理的代码格式化工作流，**这不是单个工具能覆盖的事**：知道 [JS 格式化工具](/js-formatter) 的缩进配置没用，你需要处理 ASI 自动分号插入陷阱；知道 [CSS 格式化工具](/css-formatter) 的 minify 算法没用，你需要保留关键注释与 `!important` 标记；知道 [HTML 格式化工具](/html-formatter) 的缩进规则没用，你需要识别 void elements 与 rawtext 元素。

> **与已有的五篇专题博客边界划分**：[JavaScript 格式化与压缩原理](/blog/js-formatting-minify-guide)、[CSS 格式化与压缩原理](/blog/css-formatting-minify-guide)、[HTML 格式化与压缩原理](/blog/html-formatting-minify-guide)、[Markdown 实战指南](/blog/markdown-practical-guide)、[HTML 转 Markdown 完全指南](/blog/html-to-markdown-guide) 各自聚焦单工具的原理与算法；本博客聚焦"五工具端到端工作流的工序衔接"，回答"先做哪步、后做哪步、工序间有哪些隐性依赖"的工程问题。如果只是单点原理疑惑，参考对应专题博客；如果已经知道每个工具怎么用但不知道处理顺序与衔接陷阱，参考本文。两者互补不冲突。

真实代码格式化场景里最容易踩的三个坑：

1. **JS 格式化后 ASI 陷阱导致行为变化**：开发者用 [JavaScript 格式化工具](/js-formatter) 处理一段依赖 ASI 自动分号插入的代码，格式化后缩进调整改变了 ASI 判定，原本一行能执行的语句被解析为两条——**根因是 ASI 的规则依赖换行符与下一行起始 token**，格式化时未保留原始换行语义。正确做法是用 [JS 代码格式化工具](/js-formatter) 显式补全分号后再格式化。
2. **CSS minify 丢失关键注释致样式失效**：开发者用 [CSS 美化工具](/css-formatter) minify 一段包含 `/* !important */` 与 `/*! copyright */` 的样式表，minify 后保留了 `!important` 但丢失了版权注释，第三方库依据版权注释做白名单判定导致样式被拒——**根因是 minify 算法未区分普通注释与保留注释**。正确做法是用 [样式表格式化工具](/css-formatter) 配置保留 `/*!` 开头的注释。
3. **HTML 转 Markdown 表格内嵌套列表结构坍塌**：开发者用 [HTML 转 Markdown 工具](/html-to-markdown) 处理一个表格单元格内嵌套 `<ul>` 列表的页面，转换后表格结构坍塌为散乱文本——**根因是 GFM 表格语法不支持单元格内嵌套块级元素**。正确做法是先用 [HTML 结构格式化工具](/html-formatter) 拆分嵌套结构，再分别转换。

本文不重复单个工具的深度教程（已有 [JS 指南](/blog/js-formatting-minify-guide)、[CSS 指南](/blog/css-formatting-minify-guide)、[HTML 指南](/blog/html-formatting-minify-guide)、[Markdown 指南](/blog/markdown-practical-guide)、[HTML 转 Markdown 指南](/blog/html-to-markdown-guide) 等单点博客覆盖原理与算法），而是聚焦**工序衔接与场景决策**——这是单点教程无法回答的问题。

> 配套工具矩阵：[JS 格式化工具](/js-formatter) · [CSS 格式化工具](/css-formatter) · [HTML 格式化工具](/html-formatter) · [HTML 转 Markdown 工具](/html-to-markdown) · [Markdown 渲染预览工具](/markdown)

## 五道工序的正确顺序矩阵

### 工序矩阵

| 序号 | 工序 | 工具 | 阶段 | 何时执行 | 顺序敏感性 |
| --- | --- | --- | --- | --- | --- |
| 1 | JS 脚本格式化 | /js-formatter/ | 脚本阶段 | 恢复 minify JS 可读性或规范化脚本风格 | 中（独立于样式与结构，但 ASI 影响行为） |
| 2 | CSS 样式格式化 | /css-formatter/ | 样式阶段 | 整理 CSS 缩进或 minify 压缩样式表 | 中（独立于脚本与结构，但注释保留影响依赖） |
| 3 | HTML 结构格式化 | /html-formatter/ | 结构阶段 | 规范化 HTML 缩进或修复嵌套错误 | 高（影响后续 HTML 转 Markdown 的结构识别） |
| 4 | HTML 转 Markdown | /html-to-markdown/ | 转换阶段 | 把富文本 HTML 转为可读 Markdown 文档 | 高（依赖 HTML 结构完整，影响渲染结果） |
| 5 | Markdown 渲染预览 | /markdown/ | 渲染阶段 | 把 Markdown 渲染为 HTML 预览校验 | 高（依赖 Markdown 语法正确，决定最终展示） |

### 关键顺序原则

**脚本 → 样式 → 结构 → 转换 → 渲染** 这五道工序的默认顺序存在三个关键约束：

1. **脚本先于结构**：必须先用 [JS 代码格式化工具](/js-formatter) 处理内联脚本，再用 [HTML 结构格式化工具](/html-formatter) 处理外层结构——**未先处理脚本会导致 HTML 格式化时 `<script>` 内容被错误缩进**：开发者直接用 HTML 格式化处理包含内联 JS 的页面，`<script>` 标签内的 JS 代码缩进被强行调整，ASI 规则改变导致运行时错误。正确做法是先抽取内联 JS 用 JS 格式化处理，再合并回 HTML 结构。
2. **结构先于转换**：[HTML 结构格式化工具](/html-formatter) 完成嵌套修复后，才能用 [HTML 转 Markdown 工具](/html-to-markdown) 做结构转换——**未先修复 HTML 嵌套错误会导致转换后 Markdown 结构坍塌**：开发者直接对未闭合标签的 HTML 做 Markdown 转换，转换器按容错规则猜测结构，输出的 Markdown 表格与列表混杂无法渲染。正确做法是先用 HTML 格式化修复嵌套，再转换。
3. **转换先于渲染**：[HTML 转 Markdown 工具](/html-to-markdown) 产出标准 Markdown 后，才能用 [Markdown 渲染工具](/markdown) 预览校验——**未先转换直接渲染会导致 Markdown 语法不兼容**：开发者把 HTML 片段直接粘到 Markdown 渲染器，块级 HTML 与 Markdown 块级元素混排触发渲染器解析异常。正确做法是先转换为标准 Markdown，再渲染。

### 顺序的反模式

最常见的反模式是**跳过 HTML 格式化直接转换 Markdown**：开发者在处理遗留系统导出的 HTML 时直接用 [HTML 转 Markdown 工具](/html-to-markdown) 转换，但 HTML 存在未闭合标签、属性引号缺失、嵌套错误等问题，转换器按容错规则猜测结构导致输出 Markdown 结构错乱——**根因是未先按工序修复 HTML 结构**。正确做法是先用 [HTML 格式化工具](/html-formatter) 修复嵌套与闭合，再转换为 Markdown。

另一个反模式是**Markdown 渲染前未校验 GFM 扩展**：开发者用 [Markdown 渲染预览工具](/markdown) 渲染包含表格、任务列表、删除线的文档，但渲染器未启用 GFM 扩展，表格渲染为普通段落、任务列表渲染为无序列表、删除线渲染为字面 `~~`——**根因是未理解 GFM 是 CommonMark 的超集，需要显式启用**。正确做法是用 [Markdown 预览工具](/markdown) 启用 GFM 扩展渲染。

## 阶段一：JS 脚本格式化（JsFormatterTool）

### 脚本阶段的核心产出

JS 格式化不是"调整缩进就行"，而是产出**经过 ASI 安全校验的格式化代码**——缩进配置、分号策略、引号风格、换行规则。格式化结果包含三个层次：

| 层次 | 含义 | 校验要点 |
| --- | --- | --- |
| 基础格式化 | 缩进与换行 | 缩进字符（空格/tab）与深度一致 |
| ASI 安全 | 分号自动插入 | 依赖 ASI 的代码格式化后行为不变 |
| 风格统一 | 引号与括号风格 | 单/双引号、分尾逗号、括号位置一致 |

脚本阶段必须回答三个问题：

1. **是否依赖 ASI 自动分号插入**：无分号代码风格依赖 ASI，格式化时换行调整可能改变 ASI 判定。用 [JavaScript 格式化工具](/js-formatter) 显式补全分号。
2. **缩进字符是空格还是 tab**：混用空格与 tab 会导致渲染器显示错位。用 [JS 美化工具](/js-formatter) 统一为空格或 tab。
3. **模板字符串与正则字面量是否正确识别**：错误的 tokenizer 会把 `/regex/` 误判为除法。用 [JS 脚本格式化工具](/js-formatter) 内置的 tokenizer 处理。

### 脚本阶段的衔接陷阱

**陷阱 1：ASI 规则改变导致语句合并**

开发者用 [JS 代码格式化工具](/js-formatter) 处理一段无分号代码：

```js
const a = 1
const b = 2
```

格式化时调整为单行 `const a = 1 const b = 2`——**根因是 ASI 规则依赖换行符**，下一行起始 `const` 是合法延续 token 时 ASI 不插入分号，单行后语法错误。正确做法是格式化前显式补全分号，或保持每条语句独占一行。

**陷阱 2：模板字符串内的缩进被错误调整**

开发者用 [JavaScript 美化工具](/js-formatter) 处理包含模板字符串的代码：

```js
const html = `
<div>
  <p>hello</p>
</div>
`
```

格式化后模板字符串内缩进被强行调整——**根因是格式化器未识别模板字符串为 raw text**，把字符串内容当代码处理。正确做法是用支持模板字符串识别的 [JS 格式化工具](/js-formatter)。

**陷阱 3：正则字面量被误判为除法**

开发者用 [JS 脚本格式化工具](/js-formatter) 处理包含正则的代码 `const re = /abc/g`，格式化后变成 `const re = / abc / g`——**根因是 tokenizer 未区分除法与正则字面量**。正确做法是用支持除法/正则区分的格式化器。

## 阶段二：CSS 样式格式化（CssFormatterTool）

### 样式阶段的核心产出

CSS 格式化不是"调整缩进就行"，而是产出**经过注释保留校验的格式化样式表**——缩进配置、注释策略、minify 选项。格式化结果包含三个层次：

| 层次 | 含义 | 校验要点 |
| --- | --- | --- |
| 基础格式化 | 缩进与换行 | 选择器与声明块缩进一致 |
| 注释保留 | 关键注释保留 | `/*!` 开头的版权注释与 `!important` 标记保留 |
| minify 压缩 | 压缩为单行 | 移除空白与普通注释，保留关键注释 |

样式阶段必须回答三个问题：

1. **哪些注释必须保留**：`/*!` 开头的版权注释、`/* !important */` 标记、Source Map 注释。用 [CSS 格式化工具](/css-formatter) 配置保留策略。
2. **是否启用 minify**：生产环境 minify 压缩，开发环境保留缩进。用 [样式表格式化工具](/css-formatter) 切换模式。
3. **嵌套 at-rule 如何处理**：`@media`、`@supports`、`@keyframes` 的嵌套层级。用 [CSS 美化工具](/css-formatter) 处理嵌套缩进。

### 样式阶段的衔接陷阱

**陷阱 1：minify 丢失版权注释致第三方库拒绝**

开发者用 [CSS minify 工具](/css-formatter) 压缩一段包含 `/*! Copyright (c) 2026 */` 的样式表，minify 后版权注释被移除，第三方 CDN 依据版权注释做白名单校验拒绝服务——**根因是 minify 算法未区分 `/*!` 与 `/*`**。正确做法是用 [CSS 格式化工具](/css-formatter) 配置保留 `/*!` 开头注释。

**陷阱 2：`!important` 标记被错误移除**

开发者用 [样式表压缩工具](/css-formatter) minify 一段 `color: red !important;`，minify 后变成 `color:red`，原本覆盖第三方样式的优先级失效——**根因是 minify 算法把 `!important` 当普通注释移除**。正确做法是用 [CSS 格式化工具](/css-formatter) 保留 `!important` 标记。

**陷阱 3：嵌套 at-rule 缩进错位**

开发者用 [CSS 缩进工具](/css-formatter) 处理嵌套 at-rule：

```css
@media (min-width: 768px) {
@supports (display: grid) {
.grid { display: grid; }
}
}
```

格式化后嵌套层级未正确缩进——**根因是格式化器未处理 at-rule 嵌套**。正确做法是用支持 at-rule 嵌套的 [CSS 格式化工具](/css-formatter)。

## 阶段三：HTML 结构格式化（HtmlFormatterTool）

### 结构阶段的核心产出

HTML 格式化不是"调整缩进就行"，而是产出**经过嵌套校验的格式化结构**——缩进配置、void elements 处理、rawtext 元素处理。格式化结果包含三个层次：

| 层次 | 含义 | 校验要点 |
| --- | --- | --- |
| 基础格式化 | 缩进与换行 | 标签嵌套层级缩进一致 |
| void elements | 自闭合标签 | `<br>`、`<img>`、`<input>` 不添加闭合标签 |
| rawtext 元素 | 原始文本元素 | `<script>`、`<style>`、`<textarea>` 内容不调整缩进 |

结构阶段必须回答三个问题：

1. **哪些是 void elements**：HTML5 规范定义的 void elements 列表（area/base/br/col/embed/hr/img/input/link/meta/param/source/track/wbr）。用 [HTML 格式化工具](/html-formatter) 自动识别。
2. **哪些是 rawtext 元素**：`<script>`、`<style>`、`<textarea>`、`<title>` 内容为原始文本，不做缩进调整。用 [HTML 结构格式化工具](/html-formatter) 识别。
3. **属性引号是否统一**：单引号、双引号、无引号混用。用 [HTML 美化工具](/html-formatter) 统一为双引号。

### 结构阶段的衔接陷阱

**陷阱 1：void elements 被添加闭合标签**

开发者用 [HTML 格式化工具](/html-formatter) 处理 `<br>` 标签，格式化后变成 `<br></br>`——**根因是格式化器未识别 void elements**，按普通标签处理添加闭合标签。正确做法是用支持 HTML5 void elements 列表的 [HTML 结构格式化工具](/html-formatter)。

**陷阱 2：`<script>` 内容被错误缩进**

开发者用 [HTML 缩进工具](/html-formatter) 处理包含内联 JS 的页面：

```html
<script>
const a = 1;
</script>
```

格式化后 `<script>` 内 JS 代码缩进被强行调整——**根因是格式化器未识别 rawtext 元素**，把脚本内容当 HTML 处理。正确做法是用支持 rawtext 元素的 [HTML 格式化工具](/html-formatter)，或先用 [JS 代码格式化工具](/js-formatter) 处理内联脚本。

**陷阱 3：表格嵌套未修复导致后续转换坍塌**

开发者用 [HTML 结构格式化工具](/html-formatter) 处理遗留系统导出的 HTML，表格内嵌套 `<ul>` 列表未正确闭合：

```html
<table><tr><td><ul><li>item</ul></td></tr></table>
```

格式化器按容错规则猜测结构，未修复嵌套错误——**根因是格式化器未做严格嵌套校验**。正确做法是用 [HTML 格式化工具](/html-formatter) 修复嵌套，再进入转换阶段。

## 阶段四：HTML 转 Markdown（HtmlToMarkdownTool）

### 转换阶段的核心产出

HTML 转 Markdown 不是"标签替换就行"，而是产出**经过结构校验的标准 Markdown 文档**——块级元素转换、行内元素转换、GFM 扩展支持。转换结果包含三个层次：

| 层次 | 含义 | 校验要点 |
| --- | --- | --- |
| 块级转换 | 块级元素 → Markdown 块 | 标题、列表、表格、代码块转换正确 |
| 行内转换 | 行内元素 → Markdown 行内 | 链接、强调、代码、图片转换正确 |
| GFM 扩展 | GFM 扩展语法 | 任务列表、表格、删除线、自动链接 |

转换阶段必须回答三个问题：

1. **嵌套块级元素如何处理**：表格单元格内嵌套列表、列表项内嵌套代码块。用 [HTML 转 Markdown 工具](/html-to-markdown) 配置嵌套策略。
2. **GFM 扩展是否启用**：任务列表 `- [x]`、表格 `| | |`、删除线 `~~`、自动链接。用 [HTML 转 Markdown 工具](/html-to-markdown) 启用 GFM。
3. **保留哪些 HTML 标签**：`<sub>`、`<sup>`、`<details>` 等 Markdown 无对应语法的标签。用 [HTML 转 Markdown 工具](/html-to-markdown) 配置保留策略。

### 转换阶段的衔接陷阱

**陷阱 1：表格内嵌套列表结构坍塌**

开发者用 [HTML 转 Markdown 工具](/html-to-markdown) 处理表格单元格内嵌套 `<ul>` 列表：

```html
<table><tr><td><ul><li>item1</li><li>item2</li></ul></td></tr></table>
```

转换后表格结构坍塌为散乱文本——**根因是 GFM 表格语法不支持单元格内嵌套块级元素**。正确做法是先用 [HTML 结构格式化工具](/html-formatter) 拆分嵌套结构，把列表移出表格，再分别转换。

**陷阱 2：嵌套列表缩进错误**

开发者用 [HTML 转 Markdown 工具](/html-to-markdown) 处理深层嵌套列表：

```html
<ul><li>level1<ul><li>level2<ul><li>level3</li></ul></li></ul></li></ul>
```

转换后嵌套层级未正确缩进——**根因是转换器未处理深层嵌套**。正确做法是用支持深层嵌套的 [HTML 转 Markdown 工具](/html-to-markdown)。

**陷阱 3：行内 HTML 与 Markdown 混排**

开发者用 [HTML 转 Markdown 工具](/html-to-markdown) 处理包含 `<sub>`、`<sup>` 的 HTML，转换器把 `<sub>` 移除导致下标语义丢失——**根因是转换器未保留 Markdown 无对应语法的 HTML 标签**。正确做法是用 [HTML 转 Markdown 工具](/html-to-markdown) 配置保留 `<sub>`、`<sup>` 等标签。

## 阶段五：Markdown 渲染预览（MarkdownTool）

### 渲染阶段的核心产出

Markdown 渲染不是"转 HTML 就行"，而是产出**经过 XSS 防护的渲染 HTML**——GFM 扩展、XSS 过滤、代码高亮。渲染结果包含三个层次：

| 层次 | 含义 | 校验要点 |
| --- | --- | --- |
| 基础渲染 | CommonMark 语法 | 标题、列表、代码块、引用渲染正确 |
| GFM 扩展 | GFM 扩展语法 | 表格、任务列表、删除线、自动链接渲染 |
| XSS 防护 | HTML 注入过滤 | `<script>`、`onerror`、`javascript:` 过滤 |

渲染阶段必须回答三个问题：

1. **是否启用 GFM 扩展**：表格、任务列表、删除线、自动链接。用 [Markdown 渲染工具](/markdown) 启用 GFM。
2. **XSS 防护策略**：过滤 `<script>`、`onerror`、`javascript:` 等危险内容。用 [Markdown 预览工具](/markdown) 配置 XSS 过滤。
3. **代码高亮**：代码块语法高亮。用 [Markdown 渲染预览工具](/markdown) 配置高亮。

### 渲染阶段的衔接陷阱

**陷阱 1：未启用 GFM 致表格不渲染**

开发者用 [Markdown 渲染工具](/markdown) 渲染包含表格的文档：

```markdown
| col1 | col2 |
| --- | --- |
| a | b |
```

渲染后表格显示为普通段落——**根因是渲染器未启用 GFM 扩展**，表格语法被当作普通文本。正确做法是用 [Markdown 预览工具](/markdown) 启用 GFM 扩展。

**陷阱 2：XSS 注入未过滤**

开发者用 [Markdown 渲染预览工具](/markdown) 渲染包含 `<script>alert(1)</script>` 的文档，渲染后脚本执行——**根因是渲染器未做 XSS 过滤**。正确做法是用 [Markdown 渲染工具](/markdown) 启用 XSS 防护。

**陷阱 3：代码块语法高亮失败**

开发者用 [Markdown 预览工具](/markdown) 渲染包含代码块的文档：

````markdown
```js
const a = 1;
```
````

渲染后代码块无语法高亮——**根因是渲染器未启用代码高亮**。正确做法是用 [Markdown 渲染预览工具](/markdown) 启用代码高亮。

## 五大典型场景

### 场景一：前端工程代码规范化

**工作流**：[JS 格式化工具](/js-formatter) 规范化脚本 → [CSS 格式化工具](/css-formatter) 规范化样式 → [HTML 格式化工具](/html-formatter) 规范化结构 → 校验 ASI 安全与注释保留

**关键决策**：JS 显式补全分号避免 ASI 陷阱；CSS 保留 `/*!` 版权注释；HTML 识别 void elements 不添加闭合标签。

**衔接陷阱**：跳过 JS 格式化直接处理 HTML 会导致内联脚本缩进错乱，必须先抽取内联 JS 处理。

### 场景二：文档站点内容迁移

**工作流**：[HTML 格式化工具](/html-formatter) 修复 HTML 嵌套 → [HTML 转 Markdown 工具](/html-to-markdown) 转换为 Markdown → [Markdown 渲染预览工具](/markdown) 校验渲染

**关键决策**：先修复 HTML 嵌套错误再转换；转换时启用 GFM 扩展；渲染时启用 XSS 防护。

**衔接陷阱**：未先修复 HTML 嵌套直接转换会导致 Markdown 结构坍塌，表格内嵌套列表尤其严重。

### 场景三：遗留系统代码清理

**工作流**：[JS 代码格式化工具](/js-formatter) 恢复 minify JS 可读性 → [CSS 美化工具](/css-formatter) 恢复 minify CSS 可读性 → [HTML 结构格式化工具](/html-formatter) 恢复 minify HTML 可读性

**关键决策**：JS 恢复时显式补全分号；CSS 恢复时保留 `!important` 标记；HTML 恢复时识别 void elements。

**衔接陷阱**：minify JS 恢复时 ASI 规则可能改变行为，必须显式补全分号后再格式化。

### 场景四：技术博客写作工作流

**工作流**：编写 Markdown 草稿 → [Markdown 渲染预览工具](/markdown) 校验渲染 → [HTML 转 Markdown 工具](/html-to-markdown) 反向校验 HTML 归档

**关键决策**：写作时启用 GFM 扩展使用表格、任务列表；渲染时启用 XSS 防护；归档时 HTML 转 Markdown 反向校验。

**衔接陷阱**：Markdown 中混排 HTML 块级元素会导致渲染器解析异常，建议纯 Markdown 语法写作。

### 场景五：富文本编辑器内容导出

**工作流**：富文本编辑器产出 HTML → [HTML 结构格式化工具](/html-formatter) 规范化结构 → [HTML 转 Markdown 工具](/html-to-markdown) 转换为 Markdown → [Markdown 渲染工具](/markdown) 校验渲染

**关键决策**：富文本 HTML 通常包含 inline style，转换时移除；表格内嵌套列表拆分为独立列表；`<sub>`、`<sup>` 标签保留。

**衔接陷阱**：富文本编辑器产出的 HTML 通常嵌套复杂，未先格式化直接转换会导致结构坍塌。

## 工具矩阵协同建议

| 场景 | 脚本 | 样式 | 结构 | 转换 | 渲染 | 关键约束 |
| --- | --- | --- | --- | --- | --- | --- |
| 前端代码规范化 | ASI 安全 | 注释保留 | void elements | 不适用 | 不适用 | 显式补全分号 |
| 文档站点迁移 | 不适用 | 不适用 | 嵌套修复 | GFM 启用 | XSS 防护 | 先修复再转换 |
| 遗留代码清理 | 恢复可读 | 恢复可读 | 恢复可读 | 不适用 | 不适用 | 保留 !important |
| 技术博客写作 | 不适用 | 不适用 | 不适用 | 反向校验 | GFM 启用 | 纯 Markdown 写作 |
| 富文本导出 | 不适用 | 不适用 | 结构规范化 | 嵌套拆分 | 渲染校验 | 移除 inline style |

## 总结

代码格式化工具链的五道工序——**脚本 → 样式 → 结构 → 转换 → 渲染**——看似独立，实则在工序衔接处存在大量隐性依赖：JS 格式化的 ASI 安全影响脚本行为、CSS 格式化的注释保留影响第三方依赖、HTML 格式化的嵌套修复影响后续转换、HTML 转 Markdown 的 GFM 启用影响渲染结果、Markdown 渲染的 XSS 防护影响最终展示。理解这些衔接陷阱，才能从"会用单个格式化工具"升级为"端到端代码格式化工作流"。

核心原则：

1. **脚本先于结构**：JS 格式化处理内联脚本后再合并 HTML 结构，避免缩进错乱。
2. **结构先于转换**：HTML 格式化修复嵌套后再转 Markdown，避免结构坍塌。
3. **转换先于渲染**：HTML 转 Markdown 产出标准 Markdown 后再渲染，避免语法不兼容。
4. **GFM 与 XSS 并重**：渲染阶段同时启用 GFM 扩展与 XSS 防护，兼顾功能与安全。

掌握这五道工序的衔接关系，开发者就能从"会用单个格式化工具"升级为"设计端到端代码格式化与文档转换工作流"，覆盖前端工程代码规范化、文档站点内容迁移、遗留系统代码清理、技术博客写作工作流、富文本编辑器内容导出五大典型场景。
