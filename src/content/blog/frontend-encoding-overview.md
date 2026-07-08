---
title: "前端编码全景：encodeURI / encodeURIComponent / btoa / Base64 / HTML 实体 该用哪个？"
description: "系统对比前端开发中常见的编码方式：URL 编码（encodeURI / encodeURIComponent）、Base64（btoa / atob + TextEncoder）、HTML 实体（命名 / 数字实体）的原理、应用场景、上下文边界与常见误用。配套可交互工具矩阵，帮你一图搞清该用哪个。"
pubDate: 2026-07-04
tags: ["编码", "前端", "JavaScript", "Web API", "HTML"]
relatedTool: "/html-entities"
---

## 为什么前端有这么多编码方式

如果你刚接触前端，可能会困惑：为什么浏览器要提供 `encodeURI`、`encodeURIComponent`、`btoa`、`atob`、`escape`（已废弃）、HTML 实体这么多编码方式？它们到底有什么区别？

根本原因是：**不同上下文对「哪些字符有特殊含义」的定义不同**。

- URL 中：`?` `&` `=` `#` 是结构分隔符
- HTML 中：`<` `>` `&` `"` 是标签与属性边界
- JavaScript 字符串中：`\` `'` `"` 是转义与字符串边界
- Base64 通道：仅接受 `A-Z a-z 0-9 + / =`，所有其他字节必须先转为这 64 个字符

「编码」的本质就是：**把目标上下文中具有特殊含义的字符，转换成不会与该上下文语法冲突的等价表示**。不同上下文有不同的特殊字符集合，因此需要不同的编码方式。

## 四种主流前端编码方式对比

### 1. URL 编码（百分号编码）

**作用**：把 URL 中非法或保留的字符转换为 `%HH` 形式（HH 为十六进制字节值）。

**两个函数的核心差异**：

| 函数 | 不编码的字符 | 典型用途 |
| --- | --- | --- |
| `encodeURI` | `A-Za-z0-9-_.~!#$&'()*+,;=:@/?#` | 编码完整 URL，保留 URL 结构字符 |
| `encodeURIComponent` | `A-Za-z0-9-_.~!*'()` | 编码查询参数值、路径段（编码 `&` `=` `?` 等） |

**实战陷阱**：

```javascript
// 错误：用 encodeURI 编码查询参数值
const url = `/search?q=${encodeURI('a&b=c')}`;
// 结果：/search?q=a&b=c
// 后端解析：q=a, b=c —— 参数被错误拆分！

// 正确：用 encodeURIComponent 编码查询参数值
const url = `/search?q=${encodeURIComponent('a&b=c')}`;
// 结果：/search?q=a%26b%3Dc
// 后端解析：q=a&b=c —— 符合预期
```

中文「工具」二字在 UTF-8 下占 6 字节，会被编码为 `%E5%B7%A5%E5%85%B7`。

> 配套工具：[URL 编解码工具](/url)

### 2. Base64 编码

**作用**：把任意二进制字节流转换为纯 ASCII 可见字符（`A-Z a-z 0-9 + / =`），让二进制能安全通过只支持文本的通道（如 JSON、HTTP Header、Data URL）。

**JavaScript 的中文陷阱**：

```javascript
// 错误：直接用 btoa 编码中文
btoa('工具'); // 抛出 InvalidCharacterError

// 原因：btoa 只能处理码点 0-255 的字符，中文是多字节字符

// 正确：用 TextEncoder 转为 UTF-8 字节序列后再编码
function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
encodeBase64('工具'); // "5Zy65YWz"
```

**URL 安全变体**：标准 Base64 中的 `+` `/` `=` 在 URL 中有特殊含义，URL 安全变体将 `+` → `-`、`/` → `_`、去掉末尾 `=`。常见于 JWT、Data URL、OAuth。

> 配套工具：[Base64 编解码工具](/base64)

### 3. HTML 实体编码

**作用**：把 HTML 中有特殊含义的字符（`<` `>` `&` `"` `'`）转换为 `&name;` 或 `&#NN;` 形式，避免被解析为标签或属性边界。也可用于输入键盘难以直接输入的符号（`©` `®` `™` `—` `…`）。

**三种表示形式**（都表示同一个字符）：

```
&amp;       = &#38;    = &#x26;     // 都表示与号 &
&lt;       = &#60;    = &#x3C;     // 都表示小于号 <
&copy;     = &#169;   = &#xA9;     // 都表示版权符号 ©
```

**三种编码模式**：

1. **仅必要字符**：只转义 `& < > " '`，保留中文与符号原样。适用于在 HTML 中安全显示用户输入。
2. **命名实体优先**：必要字符 + 命名实体表中的符号（© ® ™ …）优先用命名形式，可读性最好。
3. **全部数字实体**：所有非 ASCII 字符（含中文）都转为 `&#NN;`，兼容性最高，体积最大。

**实战陷阱 — 双重编码**：

```javascript
// 后端已编码一次，前端再次编码会出问题
const userInput = '&lt;script&gt;';     // 字面量字符串
const encoded = encodeEntities(userInput);
// 错误结果：&amp;lt;script&amp;gt;
// 显示效果：<script>（字面量）而非 <script>（标签）

// 正确做法：确认输入是否已是实体形式，避免重复编码
```

> 配套工具：[HTML 实体编解码工具](/html-entities)

### 4. JavaScript 字符串转义

**作用**：把字符串中无法直接表示的字符（换行、引号、反斜杠等）转为 `\n` `\"` `\\` 等转义序列。

```javascript
const json = JSON.stringify({
  message: '他说："你好"\n换行',
});
// 结果：{"message":"他说：\"你好\"\n换行"}
```

**JSON.stringify 的作用**：自动处理 `"` 与 `\` 的转义，是生成可被 `JSON.parse` 还原的字符串标准方式。

## 上下文对照表

不同上下文需要不同的编码方式，混用就会出错：

| 输出上下文 | 应使用的编码 | 必编码字符 | 配套工具 |
| --- | --- | --- | --- |
| HTML 文本节点 | HTML 实体 | `& < >` | [HTML 实体工具](/html-entities) |
| HTML 属性值（双引号） | HTML 实体 | `& < > "` | [HTML 实体工具](/html-entities) |
| HTML 属性值（单引号） | HTML 实体 | `& < > '` | [HTML 实体工具](/html-entities) |
| URL 路径段 | encodeURIComponent | `/ ? # [ ]` 等 | [URL 编解码工具](/url) |
| URL 查询参数值 | encodeURIComponent | `& = + ?` 等 | [URL 编解码工具](/url) |
| 完整 URL | encodeURI | 空格、非 ASCII | [URL 编解码工具](/url) |
| JSON 字符串值 | JSON.stringify | `" \` 换行 制表符 | [JSON 工具](/json) |
| 二进制 → 文本通道 | Base64 | 任意二进制 | [Base64 工具](/base64) |
| JWT / Data URL | URL 安全 Base64 | 任意二进制 | [Base64 工具](/base64) |
| JavaScript 字符串 | `\` 转义 | `' " \` 换行 | （内建） |

## 实战：用户输入安全输出的全流程

假设用户输入昵称 `Tom & "Jerry" <script>alert(1)</script>`，我们要把它安全地显示在网页、URL、JSON 三处：

```javascript
const userInput = 'Tom & "Jerry" <script>alert(1)</script>';

// 1. 显示在 HTML 文本节点：< Tom & "Jerry" <script>alert(1)</script> >
//    用 HTML 实体编码：& < > " '
const htmlSafe = userInput
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');
// 结果：Tom &amp; &quot;Jerry&quot; &lt;script&gt;alert(1)&lt;/script&gt;

// 2. 显示在 URL 查询参数：?name=...
const urlSafe = encodeURIComponent(userInput);
// 结果：Tom%20%26%20%22Jerry%22%20%3Cscript%3Ealert(1)%3C%2Fscript%3E

// 3. 通过 JSON 传输：{"name": "..."}
const jsonSafe = JSON.stringify({ name: userInput });
// 结果：{"name":"Tom & \"Jerry\" <script>alert(1)</script>"}
```

三种编码各自只在自己上下文有效。把 HTML 实体编码后的字符串放进 URL 仍然非法，把 URL 编码后的字符串放进 HTML 不会防止 XSS。**编码必须匹配上下文**。

## 常见误用速查表

| 误用 | 后果 | 正确做法 |
| --- | --- | --- |
| 用 `escape()` 编码 URL | 已废弃，Unicode 处理不一致 | 用 `encodeURIComponent` |
| 用 `encodeURI` 编码查询参数值 | `&` `=` 不会被编码，参数被错误拆分 | 用 `encodeURIComponent` |
| 用 `btoa('中文')` 直接编码 | 抛出 `InvalidCharacterError` | 先用 `TextEncoder` 转 UTF-8 字节 |
| 把 `btoa` 结果直接放进 URL | `+` `/` `=` 可能被错误解析 | 用 URL 安全变体（`-` `_` 替换） |
| 把用户输入直接拼到 HTML | XSS 漏洞 | 用 HTML 实体编码 |
| 把 HTML 实体编码后的字符串放进 URL | URL 仍非法 | 各上下文用各的编码 |
| 重复 HTML 实体编码 | `&amp;lt;` 显示为字面量 `&lt;` | 编码前确认输入是否已是实体 |
| 在 `<script>` 块内用 HTML 实体编码 | JS 引擎不识别实体，原样输出 | 用 `JSON.stringify` 或 `\` 转义 |
| 在 `onclick="..."` 内用 HTML 实体编码 | 仍可能被 XSS | 用 JS 字符串转义 + 属性上下文编码 |

## encodeURI、encodeURIComponent、btoa、HTML 实体该用哪个？

按上下文判断：

1. **拼 URL 查询参数？** → `encodeURIComponent`
2. **拼完整 URL？** → `encodeURI`
3. **二进制 → 文本（Data URL、JWT、文件哈希）？** → `btoa` + `TextEncoder`，必要时用 URL 安全变体
4. **把用户输入显示在 HTML？** → HTML 实体编码（`&` `<` `>` `"` `'`）
5. **生成 JSON？** → `JSON.stringify`

记住一句话：**编码要匹配上下文，不要混用**。

## 小结

前端编码方式多，但每种都对应一个特定上下文。理解每种编码「解决什么问题」「在什么上下文有效」，比死记 API 更重要。本站的 [URL 编解码](/url)、[Base64 编解码](/base64)、[HTML 实体编解码](/html-entities) 三个工具可以帮你快速验证编码结果，配合本文的对照表，足以应对 95% 的前端编码场景。

剩下 5% 的边缘场景（如 CSP nonce 生成、密码学场景的 hex 编码、PostgreSQL 的 bytea 编码）属于更专业的领域，需要时再查文档即可。
