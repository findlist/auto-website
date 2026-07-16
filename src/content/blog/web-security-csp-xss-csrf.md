---
title: "前端安全实战：CSP、XSS、CSRF 防护全景指南"
description: "系统讲解前端三大安全威胁：XSS 三种类型与载荷、CSRF 与 XSS 本质区别、SameSite Cookie 与 CSRF Token 防御、CSP 指令与 nonce/hash 用法、上下文相关编码策略，附防御手段工具矩阵。"
pubDate: 2026-07-04
tags: ["安全", "前端", "XSS", "CSP", "CSRF"]
relatedTool: "/html-entities"
---

## 为什么前端必须懂安全

很多前端开发者觉得「安全是后端的事」，这是危险的想法。事实上，**XSS 漏洞的根因 90% 在前端**：用户输入被直接插入到 DOM 中，没有经过上下文相关的编码。一旦攻击者能在受害者浏览器中执行任意 JavaScript，就能窃取 Cookie、劫持会话、伪造请求、甚至挖矿。

OWASP Top 10 Web 应用安全风险中，**注入类（含 XSS）** 与 **跨站请求伪造** 长期榜上有名。本文聚焦前端工程师必须掌握的三大安全主题：XSS、CSRF、CSP。

## 一、XSS：跨站脚本攻击

XSS（Cross-Site Scripting）的攻击原理是：**攻击者将恶意 JavaScript 注入到网页中，在其他用户的浏览器上下文里执行**。注意「跨站」只是名字，实际上 XSS 既可以跨站，也可以同站。

### 三种 XSS 类型

| 类型 | 注入位置 | 触发方式 | 危害程度 |
| --- | --- | --- | --- |
| **存储型 XSS** | 服务端数据库 | 受害者访问被污染页面时自动触发 | 最高，影响所有访问者 |
| **反射型 XSS** | URL 参数 | 受害者点击恶意链接时触发 | 中，需诱导点击 |
| **DOM 型 XSS** | 前端代码（无需服务端参与） | 前端 JS 从 URL / location 取值写入 DOM | 中，纯前端漏洞 |

### 典型攻击载荷

```html
<!-- 1. 基础 script 注入 -->
<script>alert(document.cookie)</script>

<!-- 2. 事件处理器注入（绕过过滤 <script> 的防御） -->
<img src="x" onerror="alert(document.cookie)">

<!-- 3. javascript: 伪协议注入 -->
<a href="javascript:alert(document.cookie)">点击查看</a>

<!-- 4. SVG 嵌入（绕过只过滤 HTML 的防御） -->
<svg onload="alert(document.cookie)">

<!-- 5. 编码绕过（十六进制 HTML 实体） -->
<a href="&#106;avascript:alert(1)">点击</a>
```

### 三种 XSS 的共同根因

无论哪种类型，XSS 的本质都是：**用户输入未经编码，被插入到了能被浏览器解析为可执行代码的上下文**。

```javascript
// 危险：直接把用户输入写入 innerHTML
document.getElementById('name').innerHTML = userInput;

// 危险：直接拼接 HTML 字符串
list.innerHTML = `<li>${userInput}</li>`;

// 危险：document.write
document.write(userInput);

// 危险：动态属性
element.setAttribute('href', userInput);
```

### XSS 防御：上下文相关编码

**核心原则**：编码必须匹配输出上下文。不同上下文需要不同的编码方式。

| 输出上下文 | 应使用的编码 | 必编码字符 | 配套工具 |
| --- | --- | --- | --- |
| HTML 文本节点 | HTML 实体编码 | `& < >` | [HTML 实体工具](/html-entities) |
| HTML 属性值（双引号） | HTML 实体编码 | `& < > "` | [HTML 实体工具](/html-entities) |
| HTML 属性值（单引号） | HTML 实体编码 | `& < > '` | [HTML 实体工具](/html-entities) |
| URL 上下文（href / src） | URL 编码 + 协议白名单 | `& ? # %` 等 | [URL 编解码工具](/url) |
| JavaScript 字符串内 | JS 字符串转义 / `JSON.stringify` | `" \` 换行 制表符` | [JSON 工具](/json) |
| `<script>` 块内 | `JSON.stringify` + 限制字符 | `" \` </script>` | [JSON 工具](/json) |
| CSS 上下文（style 属性） | CSS 转义 | `\ ( ) { } ;` | （手写） |

### 实战：用户输入安全输出全流程

```javascript
const userInput = 'Tom & "Jerry" <script>alert(1)</script>';

// 1. 显示在 HTML 文本节点：<div id="name">...</div>
//    用 HTML 实体编码：& < > " '
const htmlSafe = userInput
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');
// 结果：Tom &amp; &quot;Jerry&quot; &lt;script&gt;alert(1)&lt;/script&gt;
document.getElementById('name').textContent = userInput; // 或更简单：直接用 textContent

// 2. 显示在 href 属性：<a href="...">...</a>
//    先 URL 编码，再校验协议白名单
const url = userInput;
const isAllowedProtocol = /^(https?:|mailto:|tel:|\/)/i.test(url);
if (!isAllowedProtocol) {
  // 拒绝 javascript: data: 等危险协议
  linkEl.removeAttribute('href');
} else {
  linkEl.setAttribute('href', url);
}

// 3. 通过 JSON 传输到前端：<script>window.__DATA__ = {...}</script>
//    必须用 JSON.stringify，并转义 </script> 防止提前结束 script 块
const jsonSafe = JSON.stringify({ name: userInput })
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e')
  .replace(/&/g, '\\u0026');
// 结果：{"name":"Tom \u0026 \"Jerry\" \u003cscript\u003ealert(1)\u003c/script\u003e"}
```

**关键洞察**：HTML 实体编码只在 HTML 上下文有效。把 HTML 实体编码后的字符串放进 `<script>` 块、`onclick` 属性、`href` 属性，**仍然会被 XSS**。

> 配套工具：[HTML 实体编解码工具](/html-entities)（含 XSS 防御演示模块，可实时查看编码效果）

## 二、CSRF：跨站请求伪造

CSRF（Cross-Site Request Forgery）的攻击原理是：**攻击者诱导已登录用户，在不知情的情况下向目标站点发送恶意请求**。

### CSRF 攻击示例

假设银行网站 `bank.com` 的转账接口是 `POST /transfer?to=xxx&amount=100`，用户已登录（Cookie 中含 session）。攻击者在恶意网站 `evil.com` 放入：

```html
<!-- 受害者访问 evil.com 时，浏览器自动带上 bank.com 的 Cookie -->
<img src="https://bank.com/transfer?to=attacker&amount=10000" style="display:none">

<!-- 或更隐蔽的表单自动提交 -->
<form action="https://bank.com/transfer" method="POST" id="f">
  <input name="to" value="attacker">
  <input name="amount" value="10000">
</form>
<script>document.getElementById('f').submit();</script>
```

受害者访问 `evil.com` 后，浏览器自动携带 `bank.com` 的 Cookie 发送请求，银行服务器以为是本人操作，转账成功。

### CSRF 与 XSS 的本质区别

| 维度 | XSS | CSRF |
| --- | --- | --- |
| 攻击位置 | 目标站点内 | 第三方站点 |
| 是否需要登录 | 不一定 | 必须（依赖受害者已登录） |
| 是否能执行 JS | 能（在目标站点上下文） | 不能（受同源策略限制） |
| 防御核心 | 输出编码 + CSP | Token + SameSite Cookie |
| 利用 Cookie | 偷 Cookie | 借 Cookie |

**关键区别**：XSS 是攻击者在目标站点**内**执行代码，CSRF 是攻击者在目标站点**外**借受害者身份发请求。

### CSRF 防御

#### 1. SameSite Cookie（最简单有效）

```http
Set-Cookie: session=xxx; SameSite=Strict; Secure; HttpOnly
```

三个值：
- **`SameSite=Strict`**：跨站请求一律不带 Cookie。最安全，但用户体验差（从外站点链接过来需重新登录）。
- **`SameSite=Lax`**（Chrome 默认）：顶层导航的 GET 请求带 Cookie，其他跨站请求不带。平衡安全与体验。
- **`SameSite=None`**：跨站请求都带 Cookie，必须配合 `Secure`。

#### 2. CSRF Token（最经典）

服务端生成随机 Token，嵌入表单隐藏字段，提交时校验：

```html
<form method="POST" action="/transfer">
  <input type="hidden" name="csrf_token" value="随机生成的不可预测 Token">
  <input name="to">
  <input name="amount">
  <button type="submit">转账</button>
</form>
```

```javascript
// 服务端校验
if (req.body.csrf_token !== req.session.csrfToken) {
  return res.status(403).send('CSRF Token 校验失败');
}
```

**原理**：攻击者从 `evil.com` 无法读取 `bank.com` 页面的内容（同源策略），拿不到 CSRF Token，自然无法伪造合法请求。

#### 3. 双重提交 Cookie

服务端在 Cookie 中放一个随机值，前端从 Cookie 读取后放到请求 Header 中，服务端校验两者是否一致。原理同 CSRF Token，但不需要服务端存储。

#### 4. 自定义请求头

```javascript
fetch('/api/transfer', {
  method: 'POST',
  headers: { 'X-Requested-With': 'XMLHttpRequest' }, // 自定义头
  body: JSON.stringify({ to, amount }),
});
```

**原理**：跨站请求（`<form>` / `<img>`）无法设置自定义头，只有 `XMLHttpRequest` / `fetch` 能设置，而跨站 `fetch` 受 CORS 限制。

> 注意：CSRF Token 防御不能防 XSS。如果站点有 XSS 漏洞，攻击者能在同站上下文里读取 CSRF Token，防御失效。**先防 XSS，再防 CSRF**。

## 三、CSP：内容安全策略

CSP（Content Security Policy）是浏览器的「白名单」机制，**限制网页能加载哪些资源、能执行哪些脚本**。它是 XSS 的最后一道防线：即使代码有 XSS 漏洞，CSP 也能阻止恶意脚本执行。

### CSP 指令速查

| 指令 | 作用 | 示例 |
| --- | --- | --- |
| `default-src` | 默认加载策略（其他指令的回退） | `default-src 'self'` |
| `script-src` | JavaScript 来源白名单 | `script-src 'self' 'nonce-xxx'` |
| `style-src` | 样式来源白名单 | `style-src 'self' 'unsafe-inline'` |
| `img-src` | 图片来源白名单 | `img-src 'self' data: https:` |
| `connect-src` | fetch / WebSocket / XHR 连接目标 | `connect-src 'self' https://api.example.com` |
| `font-src` | 字体来源白名单 | `font-src 'self' https://fonts.gstatic.com` |
| `frame-src` | iframe / frame 嵌入来源 | `frame-src 'none'` |
| `object-src` | `<object>` / `<embed>` 来源 | `object-src 'none'` |
| `base-uri` | `<base>` 标签允许的 URL | `base-uri 'self'` |
| `form-action` | 表单提交目标 | `form-action 'self'` |
| `report-uri` | 违规上报地址 | `report-uri /csp-report` |

### 三种脚本白名单机制

#### 1. `'self'`：仅同源脚本

```http
Content-Security-Policy: script-src 'self'
```

最严格，只允许同源 JS 文件。但很多站点依赖 CDN，需配合域名白名单。

#### 2. `'nonce-xxx'`：随机 nonce

```http
Content-Security-Policy: script-src 'self' 'nonce-r4nd0mstr1ng'
```

```html
<script nonce="r4nd0mstr1ng">
  // 这个 script 允许执行
  console.log('inline with nonce');
</script>

<script>
  // 这个 script 会被 CSP 阻止（无 nonce）
  console.log('inline without nonce');
</script>
```

**原理**：每次响应生成随机 nonce，攻击者无法预测 nonce 值，注入的 `<script>` 没有 nonce 就被阻止。nonce 适合需要内联脚本的场景。

#### 3. `'sha256-xxx'`：哈希白名单

```http
Content-Security-Policy: script-src 'sha256-abc123...'
```

```html
<script>
  // 这个内联脚本的 SHA-256 哈希必须在 CSP 中列出
  console.log('fixed inline script');
</script>
```

**原理**：对内联脚本内容计算哈希，写入 CSP。脚本内容固定时用，动态生成不适合。

### 推荐的严格 CSP 策略

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-{RANDOM}';
  style-src 'self' 'nonce-{RANDOM}';
  img-src 'self' data: https:;
  font-src 'self' https://fonts.gstatic.com;
  connect-src 'self' https://api.example.com;
  frame-src 'none';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  upgrade-insecure-requests;
  report-uri /csp-report
```

要点：
- `default-src 'self'` 兜底
- `script-src` 不含 `'unsafe-inline'` `'unsafe-eval'`（最关键）
- `object-src 'none'` 禁用 Flash / Java 插件
- `frame-src 'none'` 防点击劫持
- `upgrade-insecure-requests` 自动 HTTP → HTTPS
- `report-uri` 上报违规，便于排查

### report-only 模式：先观察再启用

```http
Content-Security-Policy-Report-Only: default-src 'self'; report-uri /csp-report
```

只上报不阻止，用于上线前观察哪些资源会被拦截。建议先跑 1-2 周，确认无业务影响后切到强制模式。

### CSP 不能防 CSRF

CSP 是 XSS 防御工具，不能防 CSRF。CSRF 不需要执行 JS（`<img>` 标签就能发起），CSP 限制不了 HTML 标签的请求。CSRF 必须用 Token + SameSite Cookie 防御。

## 四、其他前端安全风险

### 1. 点击劫持（Clickjacking）

攻击者用透明 iframe 覆盖按钮，诱导用户点击。防御：

```http
X-Frame-Options: DENY
Content-Security-Policy: frame-ancestors 'none'
```

### 2. 开放重定向

```javascript
// 危险：用户可控 redirect 参数
app.get('/login', (req, res) => {
  res.redirect(req.query.redirect); // 攻击者构造 /login?redirect=https://evil.com
});
```

防御：校验 redirect 必须是相对路径或白名单域名。

### 3. 第三方依赖漏洞

`npm install` 拉来的包可能含已知漏洞。定期跑：

```bash
npm audit
npm audit fix
```

### 4. Subresource Integrity（SRI）

```html
<script src="https://cdn.example.com/lib.js"
        integrity="sha384-abc123..."
        crossorigin="anonymous"></script>
```

防止 CDN 被篡改后注入恶意脚本。如果哈希不匹配，浏览器拒绝执行。

## 五、安全工具矩阵联动

| 安全场景 | 推荐工具 | 用途 |
| --- | --- | --- |
| HTML 上下文输出用户输入 | [HTML 实体工具](/html-entities) | 编码 `& < > " '` 防 XSS |
| URL 上下文输出用户输入 | [URL 编解码工具](/url) | 编码 URL 参数防注入 |
| 生成 JWT 携带会话信息 | [JWT 解码工具](/jwt) | 调试 JWT 内容，校验 exp / 签名算法 |
| 生成随机 Token（nonce / CSRF Token） | [UUID 生成器](/uuid) | 生成不可预测的随机字符串 |
| 校验文件完整性（SRI） | [Hash 计算工具](/hash) | 计算 SHA-256 哈希 |

> 配套工具：[HTML 实体编解码工具](/html-entities) 内置 XSS 防御演示模块，可实时查看 `<script>`、`onerror`、`javascript:` 等载荷编码后的效果，配合本文的上下文编码表，覆盖 95% 的前端 XSS 防御场景。

## 六、安全检查清单

上线前逐项确认：

- [ ] 所有用户输入输出到 HTML 都经过 HTML 实体编码（`textContent` 优先于 `innerHTML`）
- [ ] 所有用户输入输出到 URL 都经过 `encodeURIComponent` + 协议白名单
- [ ] 所有用户输入输出到 `<script>` 都经过 `JSON.stringify` + `</script>` 转义
- [ ] 所有 Cookie 设置 `HttpOnly` `Secure` `SameSite=Lax`（或 Strict）
- [ ] 所有 POST/PUT/DELETE 请求校验 CSRF Token
- [ ] 部署严格 CSP（不含 `unsafe-inline` `unsafe-eval`）
- [ ] 部署 `X-Frame-Options: DENY` 或 `frame-ancestors 'none'`
- [ ] 部署 HTTPS（HSTS Header）
- [ ] 定期 `npm audit` 修复已知漏洞
- [ ] 第三方资源加 SRI 哈希

## 小结

前端安全的核心是：**永远不要信任用户输入**。XSS 的根因是输出未编码，CSRF 的根因是请求未校验来源，CSP 是 XSS 的最后防线。三者关系：

1. **先防 XSS**：上下文相关编码是根本，CSP 是兜底
2. **再防 CSRF**：SameSite Cookie + CSRF Token 双保险
3. **持续监控**：CSP report-only + npm audit 定期检查

记住一句话：**编码匹配上下文，Token 校验来源，CSP 兜底一切**。本站的 [HTML 实体工具](/html-entities)、[URL 工具](/url)、[JWT 工具](/jwt)、[UUID 工具](/uuid)、[Hash 工具](/hash) 覆盖了前端安全工具链的核心场景，配合本文的检查清单，足以应对日常前端安全需求。
