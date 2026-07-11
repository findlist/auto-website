---
title: "HTML 转 Markdown 完全指南：DOMParser 解析原理与 GFM 扩展实现"
description: "深入讲解 HTML 转 Markdown 的核心技术：浏览器原生 DOMParser 的 HTML5 容错解析、块级与行内渲染模型、GFM 扩展（任务列表/表格/删除线）、嵌套列表缩进、代码块语言标识提取、安全策略（忽略 script/style）。结合在线工具实操，帮你理解网页内容提取与博客迁移的底层原理。"
pubDate: 2026-07-12
tags: ["HTML", "Markdown", "DOMParser", "GFM", "任务列表", "表格", "代码块", "博客迁移", "工具矩阵"]
relatedTool: "/html-to-markdown"
---

## 为什么需要 HTML 转 Markdown

Markdown 以纯文本形式存储，源码即排版，无需渲染即可阅读。相比 HTML，它具有四大优势：

1. **可读性强**：`# 标题` 比 `<h1>标题</h1>` 更直观
2. **平台兼容**：GitHub、GitLab、Notion、Obsidian、VS Code 等均原生支持
3. **版本控制友好**：纯文本 diff 清晰，便于团队协作审查
4. **体积小**：无标签开销，传输与存储成本低

常见转换场景：
- 将网页内容保存为笔记（去除广告与导航，只保留正文）
- 从 WordPress/Typecho 等博客平台迁移到 Hugo/Astro 等 Markdown 博客
- 为 AI 训练数据准备纯文本语料
- 将富文本编辑器（如 TinyMCE/Quill）的 HTML 输出转为可版本控制的格式

> 配套工具：[HTML 转 Markdown 转换器](/html-to-markdown)

## 一、DOMParser：浏览器原生的 HTML 解析器

### 1.1 为什么用 DOMParser 而非正则

HTML 不是正则语言，用正则表达式解析 HTML 是经典反模式：

```javascript
// 错误做法：正则匹配标签，无法处理嵌套与属性中的 >
const tagName = /<(\w+)/.exec(html)?.[1];

// 正确做法：DOMParser 将 HTML 解析为 DOM 树
const doc = new DOMParser().parseFromString(html, 'text/html');
doc.querySelectorAll('h1, h2, h3').forEach(h => console.log(h.textContent));
```

DOMParser 的优势：
- **HTML5 容错**：自动修复未闭合标签、错误嵌套，与浏览器渲染一致
- **DOM API**：可用 `querySelector`、`childNodes`、`getAttribute` 等标准 API
- **零依赖**：浏览器原生提供，无需引入任何库

### 1.2 text/html 与 text/xml 的区别

```javascript
// HTML 模式：容错解析，自动修复标签
new DOMParser().parseFromString('<p>未闭合', 'text/html');
// → <body><p>未闭合</p></body>

// XML 模式：严格解析，未闭合报错
new DOMParser().parseFromString('<p>未闭合', 'text/xml');
// → <parsererror>未闭合标签</parsererror>
```

HTML 转 Markdown 必须用 `text/html` 模式，因为现实中的 HTML 往往不完美（缺闭合标签、大小写混用、属性无引号等），容错解析更鲁棒。

### 1.3 解析错误检测

虽然 HTML 模式容错，但仍需检测极端错误：

```javascript
const doc = new DOMParser().parseFromString(html, 'text/html');
const error = doc.querySelector('parsererror');
if (error) {
  return { ok: false, error: `HTML 解析失败：${error.textContent}` };
}
```

## 二、块级与行内：Markdown 的渲染模型

### 2.1 两类 HTML 元素

HTML 元素分为块级（block）和行内（inline）两类，对应 Markdown 的两种渲染方式：

| 类型 | HTML 标签 | Markdown 输出 | 分隔方式 |
|------|-----------|---------------|----------|
| 块级 | h1-h6, p, ul, ol, pre, blockquote, table, hr | `# 标题`、`- 列表`、`> 引用` | 双换行分隔 |
| 行内 | strong, em, code, a, img, br | `**粗体**`、`` `代码` ``、`[链接](url)` | 直接拼接 |

### 2.2 渲染分派策略

转换引擎的核心是**递归遍历 DOM 树，按节点类型分派到块级或行内渲染器**：

```typescript
function renderChildren(parent: ParentNode): string[] {
  const blocks: string[] = [];
  let inlineBuffer: string[] = [];

  parent.childNodes.forEach((node) => {
    if (isBlockElement(node)) {
      // 遇到块级元素，先冲刷行内缓冲
      flushInline(inlineBuffer, blocks);
      blocks.push(renderBlock(node));
    } else {
      // 行内元素：聚合到缓冲
      inlineBuffer.push(renderInline(node));
    }
  });
  flushInline(inlineBuffer, blocks);
  return blocks;
}
```

**关键设计**：连续的行内节点（如 `<p>文本<strong>粗体</strong>更多</p>`）会被聚合为一个块，避免每个行内元素单独成段。

### 2.3 块级元素间用双换行连接

Markdown 规范要求块级元素之间用空行分隔：

```markdown
第一段

第二段
```

而非：

```markdown
第一段
第二段
```

后者在某些解析器中会被视为同一段。因此转换结果用 `\n\n` 连接块级元素。

## 三、GFM 扩展：任务列表、表格、删除线

GFM（GitHub Flavored Markdown）在原始 Markdown 基础上扩展了三种语法。

### 3.1 任务列表

HTML 中的复选框 `<input type="checkbox">` 转为 GFM 任务列表语法：

```html
<ul>
  <li><input type="checkbox" checked> 已完成</li>
  <li><input type="checkbox"> 待办</li>
</ul>
```

转换为：

```markdown
- [x] 已完成
- [ ] 待办
```

实现要点：检测 `li` 内的 `input[type=checkbox]`，根据 `checked` 属性输出 `[x]` 或 `[ ]`，然后移除 input 元素避免重复渲染。

### 3.2 表格

HTML 表格转为 GFM 管道表格：

```html
<table>
  <tr><th>姓名</th><th>年龄</th></tr>
  <tr><td>张三</td><td>25</td></tr>
</table>
```

转换为：

```markdown
| 姓名 | 年龄 |
| --- | --- |
| 张三 | 25 |
```

**限制**：GFM 表格不支持单元格内换行，多行内容会被合并为单行（空格分隔）。若表格结构复杂（含合并单元格），建议保留原始 HTML。

### 3.3 删除线

```html
<del>删除文本</del> 或 <s>删除文本</s>
```

转换为 `~~删除文本~~`（仅 GFM 模式，原始 Markdown 不支持）。

## 四、嵌套列表的缩进处理

### 4.1 缩进规则

CommonMark 规范要求子列表缩进至少 2 空格（与父列表项的标记符对齐）：

```markdown
- 一级项
  - 二级项
    - 三级项
```

### 4.2 动态缩进实现

转换引擎通过 `RenderContext.listDepth` 跟踪当前嵌套深度，动态计算缩进：

```typescript
function renderList(el: Element, ordered: boolean, ctx: RenderContext): string {
  const indent = ' '.repeat(opts.indentSpaces * ctx.listDepth);
  // 每个 li 渲染时递增深度
  const itemCtx = { listDepth: ctx.listDepth + 1, inListItem: true };
  const content = renderChildren(child, opts, itemCtx, stats, warnings);
  // ...
}
```

### 4.3 续行对齐

列表项内容若有多行（如嵌套列表、代码块），续行需缩进至与首行内容对齐：

```markdown
- 首行内容
  续行内容（缩进 2 空格，与 "-" 后的内容对齐）
  - 子列表项
```

实现方式：续行缩进 = `' '.repeat(markerWidth)`，其中 `markerWidth` 是 `- ` 或 `1. ` 的长度。

## 五、代码块语言标识提取

### 5.1 从 class 属性提取语言

常见的高亮库（Prism、highlight.js、Highlight.js）用 class 标识语言：

```html
<pre><code class="language-javascript">...</code></pre>
<pre><code class="lang-python">...</code></pre>
<pre><code class="highlight-rust">...</code></pre>
```

转换引擎用正则匹配这三种前缀：

```typescript
const langMatch = langClass.match(/(?:language|lang|highlight)-([\w-]+)/i);
const lang = langMatch?.[1] ?? '';
```

输出围栏代码块时附加语言标识：

````markdown
```javascript
function hello(name) {
  return `Hello, ${name}!`;
}
```
````

### 5.2 行内代码的反引号嵌套

行内代码若内容本身包含反引号，需用更多反引号包裹：

```markdown
内容 `code` 结束       ← 普通情况
内容 `` ` `` 结束       ← 内容是单个反引号
内容 `` `code` `` 结束  ← 内容首尾是反引号
```

实现：扫描内容中最长的连续反引号序列，用 `长度+1` 的反引号作为定界符，必要时补空格。

## 六、安全策略：忽略非内容标签

### 6.1 应被忽略的标签

```typescript
const IGNORED_TAGS = new Set([
  'script', 'style', 'template', 'noscript', 'head', 'meta',
  'link', 'title', 'iframe', 'object', 'embed',
]);
```

这些标签的内容不应出现在 Markdown 中：
- `script`/`style`：代码与样式，非正文
- `template`/`noscript`：模板与非脚本降级内容
- `head`/`meta`/`title`/`link`：文档元数据
- `iframe`/`object`/`embed`：嵌入内容（可能含安全风险）

### 6.2 默认剥离未知标签

`<span>`、`<div>` 等无 Markdown 对应语法的标签，默认剥离标签保留内容：

```html
<p>这是一段<span class="highlight">重要</span>文本</p>
```

转为：

```markdown
这是一段重要文本
```

若需保留原始 HTML（如嵌套 Markdown 不支持的复杂结构），可开启"保留未知 HTML 标签"选项。

### 6.3 XSS 防护

由于输出是 Markdown 纯文本，且默认忽略 script/style 标签，从根本避免了 XSS 风险。Markdown 中的链接 URL 若含 `javascript:` 协议，应由 Markdown 渲染器（而非转换器）负责过滤。

## 七、与 Markdown 预览器的双向闭环

本工具与现有的 [Markdown 预览器](/markdown) 形成 MD ↔ HTML 双向转换闭环：

| 方向 | 工具 | 场景 |
|------|------|------|
| MD → HTML | Markdown 预览器 | 写作时实时预览渲染效果 |
| HTML → MD | HTML 转 Markdown | 从网页/富文本提取内容为 MD |

两者共享设计原则：纯原生零依赖、手写解析器、XSS 安全。但实现方式不同：
- MD → HTML：手写 GFM 解析器，将 Markdown 语法转为 HTML 标签
- HTML → MD：用 DOMParser 解析 HTML，递归遍历 DOM 树转为 Markdown 语法

## 八、应用场景与最佳实践

### 8.1 网页内容提取

将网页的正文区域 HTML 粘贴到工具中，快速转为 Markdown 笔记。建议先手动选取 `<article>` 或 `<main>` 标签内容，避免转换导航栏与页脚。

### 8.2 博客平台迁移

从 WordPress 导出 XML 后，提取每篇文章的 HTML 内容，批量转为 Markdown 文件。注意处理：
- 图片 URL 是否需要迁移到新 CDN
- 内部链接是否需要更新域名
- 代码块语言标识是否完整

### 8.3 AI 训练数据准备

将 HTML 文档转为 Markdown 作为 AI 训练语料，去除标签噪声，保留语义结构。Markdown 的纯文本特性使 token 计数更准确。

### 8.4 富文本编辑器输出处理

TinyMCE、Quill 等富文本编辑器输出 HTML，转为 Markdown 后可存入数据库或版本控制系统，便于 diff 审查与回滚。

## 总结

HTML 转 Markdown 的核心技术点：

1. **DOMParser**：浏览器原生 HTML5 容错解析，零依赖
2. **块级/行内分派**：递归遍历 DOM 树，按节点类型分派渲染器
3. **GFM 扩展**：任务列表、表格、删除线的语法转换
4. **嵌套缩进**：动态跟踪列表深度，续行对齐
5. **语言标识提取**：从 class 属性匹配 language/lang/highlight 前缀
6. **安全策略**：忽略 script/style 等非内容标签，默认剥离未知标签

需要快速转换时，可以使用 [HTML 转 Markdown 转换器](/html-to-markdown)，支持完整 GFM 语法与多种配置选项。
