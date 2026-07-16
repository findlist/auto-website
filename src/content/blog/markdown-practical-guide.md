---
title: "Markdown 实战指南：GFM 语法速查 + 解析原理 + XSS 防护"
description: "系统讲解 Markdown 与 GFM 语法：标题、列表、表格、代码块等块级与行内元素解析顺序，XSS 防护策略与写作陷阱，附预览器实操。"
pubDate: 2026-07-04
tags: ["Markdown", "前端", "文档", "XSS", "GFM"]
relatedTool: "/markdown"
---

## 为什么开发者必须懂 Markdown

打开任何一份开源项目，根目录几乎一定有 `README.md`；GitHub Issue、PR 描述、技术博客、API 文档、笔记软件（Obsidian、Notion、Logseq）——Markdown 已经是<strong>开发者写作的事实标准</strong>。

但许多开发者对 Markdown 的理解停留在「会写就行」，遇到这几个问题就抓瞎：

- 为什么我写的 `*text*` 没有变成斜体？
- 表格里的 `|` 怎么转义？
- 在 Markdown 里嵌 `<script>` 标签会执行吗？
- 为什么 marked / markdown-it 渲染出来的 HTML 不一样？

本文系统讲清楚 GFM 子集语法、解析顺序、XSS 防护与写作技巧。

> 配套工具：[Markdown 在线预览器](/markdown)

## GFM 语法速查表

GFM（GitHub Flavored Markdown）是 CommonMark 的超集，扩展了表格、任务列表、删除线、自动链接等语法。下表是日常写作 95% 场景会用到的语法。

| 语法 | 写法 | 渲染结果 |
| --- | --- | --- |
| 一级标题 | `# 标题` | `<h1>标题</h1>` |
| 二级标题 | `## 标题` | `<h2>标题</h2>` |
| 六级标题 | `###### 标题` | `<h6>标题</h6>` |
| 粗体 | `**text**` 或 `__text__` | `<strong>text</strong>` |
| 斜体 | `*text*` 或 `_text_` | `<em>text</em>` |
| 删除线 | `~~text~~` | `<del>text</del>` |
| 行内代码 | `` `code` `` | `<code>code</code>` |
| 代码块 | 三反引号围栏 | `<pre><code>...</code></pre>` |
| 链接 | `[text](url)` | `<a href="url">text</a>` |
| 图片 | `![alt](url)` | `<img src="url" alt="alt">` |
| 自动链接 | `<https://example.com>` | 可点击的链接 |
| 无序列表 | `- item` / `* item` / `+ item` | `<ul><li>item</li></ul>` |
| 有序列表 | `1. item` | `<ol><li>item</li></ol>` |
| 任务列表 | `- [ ] todo` / `- [x] done` | 带复选框的列表 |
| 引用 | `> quote` | `<blockquote>quote</blockquote>` |
| 表格 | 管道符分隔 | `<table>...</table>` |
| 水平线 | `---` / `***` / `___` | `<hr>` |

**记忆口诀**：标题井号递增，粗体双星斜体单，代码反引号包裹，链接方括号圆括号，列表破折号开头，引用大于号领头，表格管道符分隔。

## 行内解析顺序：为什么粗体必须在斜体之前

初学者写解析器时常踩的坑：把 `*text*` 斜体规则放在 `**text**` 粗体之前，导致粗体被错误地解析为两次斜体。

```text
输入：**Hello**
错误顺序（先斜体）：
  第 1 步：* → 找匹配的 * → 第 3 个字符的 *
  第 2 步：匹配到 *H* → <em>H</em>ello*（剩下未匹配的 *）
正确顺序（先粗体）：
  第 1 步：** → 找匹配的 ** → 末尾的 **
  第 2 步：匹配到 **Hello** → <strong>Hello</strong>
```

**核心原则**：长匹配优先于短匹配。粗体 `**text**` 比斜体 `*text*` 多一个 `*`，必须先尝试粗体规则，否则粗体会被斜体规则吃掉一半。

本工具的 [`MarkdownTool.tsx`](/markdown) 实现中，行内解析顺序为：

1. 行内代码（用占位符先提取，避免被后续规则误伤）
2. 图片 `![alt](url)`
3. 链接 `[text](url)`
4. 自动链接 `<url>`
5. 粗体 `**text**` / `__text__`
6. 斜体 `*text*` / `_text_`
7. 删除线 `~~text~~`
8. 还原行内代码占位符

**为什么图片在链接之前**：图片语法 `![alt](url)` 比链接 `[text](url)` 多一个前置 `!`，如果先匹配链接，图片的 `![alt]` 会被误判为链接文本。所以图片必须先于链接处理。

**为什么行内代码第一个处理**：行内代码内的内容不解析任何 Markdown 语法，例如 `` `*not italic*` `` 应该原样显示。第一个提取为占位符（如 `\x00CODE0\x00`），等所有其他规则处理完再还原，可以确保代码内容不被误伤。

## 块级解析：状态机 vs 正则

块级元素（标题、代码块、引用、列表、表格、段落）的解析有两种主流方案：

### 方案 A：正则替换

```javascript
// 简单粗暴：每行用正则匹配
html = line.replace(/^### (.*)/g, '<h3>$1</h3>')
           .replace(/^## (.*)/g, '<h2>$1</h2>')
           .replace(/^# (.*)/g, '<h1>$1</h1>');
```

**优点**：实现简单，几十行搞定。
**缺点**：①顺序敏感（必须先匹配 `###` 再匹配 `#`，否则 `## ` 会被 `#` 规则吃掉）；②难以处理跨行元素（代码块、引用、表格、多行段落）；③难以扩展（每加一个语法都要小心与已有规则的冲突）。

### 方案 B：状态机 / 行迭代

```typescript
const lines = markdown.split('\n');
let i = 0;
while (i < lines.length) {
  const line = lines[i];
  if (/^```/.test(line)) {
    // 读取代码块直到结束 ```
    const codeLines = [];
    i++;
    while (i < lines.length && !/^```/.test(lines[i])) {
      codeLines.push(lines[i]);
      i++;
    }
    html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
    i++;
    continue;
  }
  // ... 其他块级元素
}
```

**优点**：①逻辑清晰，每个块级元素独立处理；②天然支持跨行元素；③易扩展，新增语法只需添加一个 `if` 分支。
**缺点**：代码量略多。

本工具采用方案 B。关键决策：

- **逐行迭代 + 内部 while 循环消费连续行**：例如引用块，外层 while 遇到 `>` 开始，内层 while 持续消费连续的 `>` 行
- **递归处理嵌套**：引用块内容递归调用 `parseBlocks`，支持引用内嵌套标题、列表、表格
- **段落兜底**：所有未匹配的行视为段落，连续非空行合并为一个 `<p>`

## XSS 防护：默认转义 + URL 协议白名单

Markdown 解析器最大的安全风险是 XSS。考虑这段输入：

```markdown
<script>alert(1)</script>
[点我](javascript:alert(1))
![img](data:text/html,<script>alert(1)</script>)
```

如果解析器直接把 HTML 标签透传，浏览器就会执行 `alert(1)`，这是典型的存储型 XSS。

### 防护策略 1：默认 HTML 转义

本工具在解析前先调用 `escapeHtml` 转义所有 HTML 特殊字符：

```typescript
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

转义后，`<script>alert(1)</script>` 变成 `&lt;script&gt;alert(1)&lt;/script&gt;`，浏览器显示为文本而不是执行。

**行内代码与代码块内仅转义，不解析 Markdown**：确保代码示例原样显示，不会因为代码中含有 Markdown 语法字符而被误解析。

### 防护策略 2：URL 协议白名单

即使 HTML 转义了，链接 URL 仍可能是危险协议。例如 `[点我](javascript:alert(1))` 转义后 URL 仍是 `javascript:alert(1)`，点击会执行。

```typescript
function sanitizeUrl(url: string): string {
  const trimmed = url.trim().toLowerCase();
  // 仅允许 http/https/mailto/ftp 协议，以及相对路径、锚点
  if (/^(https?:|mailto:|ftp:|\/|#|\.\/|\.\.\/|\?)/i.test(trimmed)) {
    return url;
  }
  return ''; // 危险协议返回空字符串
}
```

允许的协议：

- `http:` / `https:`：正常网页链接
- `mailto:`：邮件链接
- `ftp:`：FTP 资源
- `/` 开头：站点内绝对路径
- `./` / `../` 开头：站点内相对路径
- `#` 开头：页面内锚点
- `?` 开头：查询字符串

被拦截的协议：`javascript:`、`data:`、`vbscript:`、`file:` 等。

### 防护策略 3：链接加 rel="noopener noreferrer"

所有外链自动加 `target="_blank" rel="noopener noreferrer"`，防止：

- `noopener`：新窗口无法通过 `window.opener` 访问原窗口（防反向劫持）
- `noreferrer`：不发送 Referer 头，保护用户隐私

## 写作技巧与常见陷阱

### 1. 段落内换行：两个空格 + 回车

```markdown
第一行  
第二行
```

末尾两个空格会被解析为 `<br>`，渲染为同一段落内的两行。如果直接回车不加空格，Markdown 会把两行合并为一行（柔韧换行）。

### 2. 表格内管道符转义

表格单元格内的 `|` 必须转义为 `\|`，否则会被识别为列分隔符：

```markdown
| 表达式 | 含义 |
| --- | --- |
| `a \|\| b` | 逻辑或 |
```

### 3. 代码块内反引号

代码块内的三反引号会结束代码块。如果代码本身包含三反引号（如 Markdown 教程），可用四个反引号围栏：

````markdown
````markdown
```javascript
console.log('hello');
```
````
````

### 4. 链接文本嵌套粗体

```markdown
[**重要** 通知](https://example.com)
```

链接文本内可以嵌套粗体、斜体、行内代码等行内元素，但本工具为简化逻辑，链接文本不递归解析（仅原样显示）。复杂场景建议用 HTML 模板拼接。

### 5. 自动链接邮箱

```markdown
<user@example.com>
```

会被渲染为 `<a href="mailto:user@example.com">user@example.com</a>`，避免邮箱被爬虫抓取。

### 6. 任务列表勾选状态

```markdown
- [x] 已完成
- [ ] 未完成
```

GFM 任务列表渲染为带 `disabled` 复选框的列表项，适合做待办清单与进度跟踪。

## 工具矩阵联动

工具盒子提供了完整的 Markdown 写作工具链：

- **Markdown 预览器**（本工具）：实时分屏预览 + 工具栏 + HTML 导出
- **HTML 实体编解码**：Markdown 导出的 HTML 想嵌入到其他 HTML 上下文时，用 HTML 实体编码避免冲突
- **JSON 工具**：Markdown 中嵌入 JSON 数据时，先在 JSON 工具格式化好再粘贴到代码块
- **正则表达式测试**：写正则教程博客时，用正则工具验证示例
- **Base64 编解码**：图片转 Data URL 内联到 Markdown 中

跨工具专题博客：

- [前端编码全景](/blog/frontend-encoding-overview)：URL / Base64 / HTML 实体的对比
- [数据格式转换全景](/blog/data-format-conversion-overview)：CSV / JSON / TSV / YAML 的取舍
- [无障碍颜色对比度](/blog/color-contrast-accessibility)：WCAG 2.1 标准

## 小结

Markdown 看似简单，但要做到「写得对、解析得准、防得住 XSS」并不容易：

- **语法层面**：GFM 子集已覆盖 95% 写作场景，长匹配优先（粗体先于斜体）是关键解析原则
- **解析层面**：状态机 + 行迭代优于纯正则，逻辑清晰且易扩展
- **安全层面**：默认 HTML 转义 + URL 协议白名单 + `rel="noopener noreferrer"` 是 XSS 防护三件套
- **体验层面**：实时预览 + 工具栏快捷按钮 + 草稿自动保存是写作者的核心需求

打开 [Markdown 预览器](/markdown) 立即体验，左侧编辑右侧实时预览，支持 HTML 导出与草稿保存。
