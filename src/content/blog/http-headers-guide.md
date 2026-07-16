---
title: "HTTP Header 完全指南：请求头/响应头/CORS/安全/缓存深度解析"
description: "系统讲解 HTTP Header：40+ 常用请求头与响应头、CORS 跨域配置、安全响应头（CSP/HSTS/X-Frame-Options）、缓存策略（Cache-Control/ETag）、HTTP/2 伪头变化，附最佳实践。"
pubDate: 2026-07-17
tags: ["HTTP", "网络", "Web API", "安全", "缓存", "CORS"]
relatedTool: "/http-headers"
---

## 为什么必须搞懂 HTTP Header

很多前端开发者把 HTTP Header 当作「Content-Type 设置一下就行，其他交给框架」——这是危险的简化。事实上，**Header 是 HTTP 协议的元数据层**，承载着缓存策略、跨域控制、安全防御、内容协商、认证授权等核心语义。

举个真实场景：你做了一个公开 API，前端调用报 CORS 错误，你给响应加了 `Access-Control-Allow-Origin: *`，结果发现带 Cookie 调用还是失败——因为**携带凭证时不能用 `*`，必须指定具体源**。再比如，你上线了一个新页面，发现样式偶尔错乱，查了半天才发现是 CSP 拦截了内联样式——`style-src 'self'` 不允许 `style="..."` 属性。

理解 Header 的本质，能让你写出**安全、可缓存、跨域友好、SEO 友好**的 HTTP 接口与网页。本文系统讲解 40+ 常用 Header，覆盖 RFC 9110 核心字段，并给出生产环境配置建议。

> 配套工具：[HTTP Header 解析与生成工具](/http-headers)（40+ Header 速查表 + 解析 + 生成 cURL/fetch 代码）、[HTTP 状态码查询](/http-status)（与 Header 配合理解协议）、[JWT 解码](/jwt)（解析 Authorization 头中的 Bearer 令牌）、[MIME 类型查询](/mime)（Content-Type 头对照表）

## 一、Header 的协议规范与基础

### 1.1 语法格式

HTTP Header 是键值对，格式为 `name: value`（冒号后空格可选，但约定加空格）。一个 HTTP 报文可包含多个 Header，每个占一行：

```http
GET /api/users HTTP/1.1
Host: api.example.com
User-Agent: Mozilla/5.0
Accept: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
```

### 1.2 名称规范

- **大小写不敏感**：`Content-Type`、`content-type`、`CONTENT-TYPE` 在协议层完全等价
- **字符集限制**：RFC 9110 仅允许**可见 ASCII（0x21-0x7e）**，且不含冒号
- **命名约定**：首字母大写 + 连字符分隔（如 `Content-Type`、`X-Request-ID`）
- **自定义头**：惯例加 `X-` 前缀（如 `X-Forwarded-For`），但 RFC 6648 已不强制要求

### 1.3 值规范

- **大小写敏感**：值的内容是大小写敏感的（如 MIME 类型 `application/json` 必须小写）
- **字符集**：可包含任意字符（含 obs-text 0x80-0xff），但建议用 ASCII，非 ASCII 内容放入主体
- **多值合并**：同名 Header（除 `Set-Cookie`）通常合并为逗号分隔，如 `Accept: text/html, application/json`
- **`Set-Cookie` 例外**：一个响应可含多条 `Set-Cookie`，不能合并（否则浏览器无法解析）

### 1.4 按位置分类

| 类别 | 出现位置 | 典型 Header |
| --- | --- | --- |
| **请求头** | 仅请求 | Host, User-Agent, Accept, Authorization, Cookie, Referer |
| **响应头** | 仅响应 | Server, Set-Cookie, Location, WWW-Authenticate, ETag |
| **通用头** | 请求与响应 | Date, Connection, Via, Transfer-Encoding |
| **表示头** | 描述主体 | Content-Type, Content-Length, Content-Encoding |

> 注：表示头是 HTTP/1.1 概念，HTTP/2+ 已合并为通用语义。本文额外划分 CORS、安全、缓存三个语义子类，便于查找。

## 二、请求头详解（客户端 → 服务端）

### 2.1 Host：HTTP/1.1 唯一必需头

```http
Host: api.example.com:443
```

`Host` 是 HTTP/1.1 **唯一必需的请求头**（RFC 7230），指定目标主机与端口。服务端据此做**虚拟主机路由**——一台 IP 可服务多个域名。

HTTP/2 中 `Host` 被 `:authority` 伪头替代，但浏览器仍会同时发送两者以兼容。

### 2.2 User-Agent：客户端标识（已弱化）

```http
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36
```

标识客户端类型，服务端据此做内容协商或统计。但 Chrome 自 113 起对部分用户**冻结 UA**（UA Reduction），目的是反指纹追踪。**新方案是 Client Hints**：

```http
Sec-CH-UA: "Chromium";v="138", "Not?A_Brand";v="24"
Sec-CH-UA-Mobile: ?0
Sec-CH-UA-Platform: "Windows"
```

建议：服务端不要强依赖 UA 字符串解析，用 Client Hints 或特性检测替代。

### 2.3 Accept 系列：内容协商

```http
Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8
Accept-Language: zh-CN,zh;q=0.9,en;q=0.8
Accept-Encoding: gzip, deflate, br, zstd
```

`q` 表示权重（0-1，默认 1），服务端据此返回最适合的内容类型、语言、编码。

- `Accept`：MIME 类型偏好
- `Accept-Language`：自然语言偏好，SEO 多语言站点常据此重定向（建议配合会话或路径切换）
- `Accept-Encoding`：压缩算法偏好，`br`（Brotli）压缩率优于 `gzip`，`zstd`（Zstandard）是较新算法

### 2.4 Authorization：认证凭证

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abc123
```

常见方案：

| Scheme | 凭证格式 | 安全性 |
| --- | --- | --- |
| **Basic** | `Basic base64(user:pass)` | 弱（需 HTTPS，Base64 非加密） |
| **Bearer** | `Bearer <token>`（JWT/OAuth2） | 中（token 泄露即裸奔，需配合短期 token + refresh） |
| **Digest** | `Digest username="..."` + 哈希摘要 | 中（防重放，但已被 OAuth2 取代） |

**安全提示**：token 不要放进 URL（避免被日志/Referer 泄露），统一用 `Authorization` 头。配合 JWT 工具解码与验证。

### 2.5 Cookie 与 Referer 与 Origin

```http
Cookie: sessionId=abc123; theme=dark
Referer: https://www.google.com/search?q=hello
Origin: https://www.example.com
```

三者区别：

| Header | 出现场景 | 内容 |
| --- | --- | --- |
| `Cookie` | 同域请求自动携带 | 完整 Cookie 键值对 |
| `Referer` | 同源与跨域都发送（受 Referrer-Policy 控制） | 完整来源 URL（含路径与 query） |
| `Origin` | 仅跨域请求与 POST 发送 | 仅源（协议+域+端口，不含路径） |

**安全提示**：`Referer` 可能泄露敏感 query（如 token），建议设置 `Referrer-Policy: strict-origin-when-cross-origin`（默认值），跨域仅发源。

### 2.6 条件请求头：缓存验证

```http
If-None-Match: "abc123"
If-Modified-Since: Wed, 21 Oct 2025 07:28:00 GMT
```

与响应 `ETag` / `Last-Modified` 配合：

- 客户端首次请求 → 服务端返回资源 + `ETag` / `Last-Modified`
- 客户端下次请求带 `If-None-Match` / `If-Modified-Since`
- 服务端比较后：相同返回 `304 Not Modified`（无主体），不同返回 `200 OK` + 新资源

这是浏览器与 CDN 缓存验证的核心机制，节省带宽与服务器负载。

## 三、响应头详解（服务端 → 客户端）

### 3.1 Set-Cookie：设置 Cookie（可多条）

```http
Set-Cookie: sessionId=abc123; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600
Set-Cookie: theme=dark; Path=/; Max-Age=86400
```

一个响应可含多条 `Set-Cookie`。关键属性：

| 属性 | 作用 | 推荐值 |
| --- | --- | --- |
| `Path` | 路径限制 | `/`（默认当前路径） |
| `Domain` | 域限制 | 不设（默认当前域，不跨子域） |
| `Max-Age` | 有效期（秒） | 按需，优先于 `Expires` |
| `HttpOnly` | 防 JS 读取 | 必加（防 XSS 窃取） |
| `Secure` | 仅 HTTPS 传输 | 必加（生产环境） |
| `SameSite` | 跨站策略 | `Lax`（默认，推荐）/ `Strict` / `None` |

`SameSite` 选择：

- `Lax`：跨站 GET 携带，POST/PUT/DELETE 不携带。**平衡安全与体验，适合大多数站点**
- `Strict`：完全不跨站携带。最安全，但从外站跳转过来会丢登录态
- `None`：跨站全部携带。需同时设 `Secure`，仅第三方 Cookie 场景使用（Chrome 已逐步淘汰）

### 3.2 Location：重定向目标

```http
HTTP/1.1 301 Moved Permanently
Location: https://example.com/new-page
```

配合 3xx 状态码实现重定向，**301/302/307/308 必须包含此字段**。注意：相对 URL 的解析基准是请求 URL，建议使用**绝对 URL** 避免歧义。

### 3.3 ETag 与 Last-Modified：缓存验证

```http
ETag: "33a64df551425fcc55e4d42a148795d9f25f89d4"
Last-Modified: Wed, 21 Oct 2025 07:28:00 GMT
```

- `ETag`：资源唯一版本标识，通常是内容哈希。**精度高**（哈希级别）
- `Last-Modified`：资源最后修改时间。**精度限于秒**

两者同时存在时，客户端下次请求需同时满足两个条件才返回 `304`。

`ETag` 还支持**弱验证**（`W/"..."`），允许语义等价但字节不同（如注释差异）：

```http
ETag: W/"abc123"
```

### 3.4 Vary：响应随哪些请求头变化

```http
Vary: Accept-Encoding, Accept-Language
```

告诉缓存服务器（CDN/代理）：**响应内容随指定请求头变化**，缓存键需包含这些头。常见配置：

- `Vary: Accept-Encoding`：区分压缩与否（gzip/br）
- `Vary: Accept-Language`：区分语言版本
- `Vary: Origin`（CORS 必备）：动态 `Access-Control-Allow-Origin` 时必须配置

**错误配置的后果**：CDN 缓存串内容（A 站命中后缓存给 B 站），泄露跨域数据。

## 四、CORS 跨域头完整指南

### 4.1 简单请求 vs 预检请求

**简单请求**（不触发预检）需同时满足：

- 方法：`GET` / `HEAD` / `POST`
- 自定义头仅限：`Accept`、`Accept-Language`、`Content-Language`、`Content-Type`（仅 `text/plain` / `multipart/form-data` / `application/x-www-form-urlencoded`）
- 不使用 `XMLHttpRequest.upload` 监听器
- 不使用 `ReadableStream`

**复杂请求**（触发预检）：除上述以外的请求，浏览器先发 `OPTIONS` 预检，服务端响应允许后才发实际请求。

### 4.2 核心 CORS 响应头

| Header | 作用 |
| --- | --- |
| `Access-Control-Allow-Origin` | 允许的源（`*` 或具体源） |
| `Access-Control-Allow-Methods` | 允许的方法 |
| `Access-Control-Allow-Headers` | 允许的自定义请求头 |
| `Access-Control-Expose-Headers` | 允许 JS 读取的响应头 |
| `Access-Control-Allow-Credentials` | 允许携带凭证（Cookie/Authorization） |
| `Access-Control-Max-Age` | 预检结果缓存时长（秒） |

### 4.3 "用了 * 还是报错"的三大原因

1. **携带凭证时不能用 `*`**：前端 `fetch(url, { credentials: "include" })` 或 `withCredentials = true` 时，服务端 `Allow-Origin` 必须是**具体源**（如 `https://example.com`），不能是 `*`。否则浏览器报错：

   ```
   The value of the 'Access-Control-Allow-Origin' header in the response must not be the wildcard '*'
   ```

2. **预检请求未通过**：复杂请求会先发 OPTIONS。预检响应必须正确返回 `Allow-Methods`、`Allow-Headers`、`Allow-Credentials`，否则实际请求被拦截。

3. **缺少 `Vary: Origin`**：若 `Allow-Origin` 动态返回（多源白名单），必须配合 `Vary: Origin`，否则 CDN 缓存会串内容。

### 4.4 推荐配置

```http
Access-Control-Allow-Origin: https://your-frontend.com
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 86400
Vary: Origin
```

**多源白名单示例**（Node.js）：

```js
const allowedOrigins = ['https://a.com', 'https://b.com'];
const origin = req.headers.origin;
if (allowedOrigins.includes(origin)) {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}
```

## 五、安全响应头配置

### 5.1 Content-Security-Policy：防 XSS 注入

```http
Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.example.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://api.example.com; frame-ancestors 'none'
```

CSP 是防御 XSS 的**最强工具**，限制资源加载来源。常用指令：

| 指令 | 作用 |
| --- | --- |
| `default-src` | 兜底（其他 *-src 未设时用此） |
| `script-src` | 脚本来源 |
| `style-src` | 样式来源 |
| `img-src` | 图片来源 |
| `font-src` | 字体来源 |
| `connect-src` | fetch/XHR/WebSocket |
| `frame-src` | iframe 来源 |
| `frame-ancestors` | 谁可以嵌入本页（防点击劫持） |
| `object-src` | Flash/Plugin |
| `report-uri` | 违规上报地址 |

**source 值**：`'self'`（同源）、`'none'`（禁止）、`'unsafe-inline'`（内联）、`'unsafe-eval'`（eval）、`https:`（任意 HTTPS）、`https://cdn.com`（具体源）、`'sha256-...'`（哈希白名单）、`'nonce-RANDOM'`（一次性 nonce）。

**"样式错乱"常见原因**：

1. `<style>` 标签或 `style="..."` 属性被 `style-src 'self'` 拦截 → 加 `'unsafe-inline'` 或用 nonce/hash
2. 外部 CDN 样式被拦截 → `style-src 'self' https://cdn.tailwindcss.com`
3. `@font-face` 字体被拦截 → `font-src 'self' https://fonts.gstatic.com`

**推荐做法**：先用 `Content-Security-Policy-Report-Only` 仅上报不拦截，观察一段时间再切换到强制 CSP。

### 5.2 Strict-Transport-Security：强制 HTTPS（HSTS）

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

告诉浏览器在 `max-age` 内强制使用 HTTPS，防 **SSL 剥离降级攻击**。

- `max-age`：秒数，建议 1 年（31536000）
- `includeSubDomains`：含子域
- `preload`：可申请加入浏览器内置 HSTS 列表

**注意**：先确保**全站 HTTPS**（含子域）再启用，否则子域会无法访问。

### 5.3 X-Frame-Options 与 frame-ancestors

```http
X-Frame-Options: DENY
Content-Security-Policy: frame-ancestors 'none'
```

防止**点击劫持**（被恶意网站 iframe 嵌入）。

- `X-Frame-Options: DENY`（完全禁止）/ `SAMEORIGIN`（仅同源）—— 旧标准，IE 仍需此头
- `Content-Security-Policy: frame-ancestors 'none'` —— 新标准，更灵活

**建议两者同时配置**以兼容。

### 5.4 X-Content-Type-Options：禁 MIME 嗅探

```http
X-Content-Type-Options: nosniff
```

阻止浏览器嗅探 MIME 类型，必须按 `Content-Type` 处理。防止把用户上传的文本文件当脚本执行。**所有响应都应配置**。

### 5.5 Referrer-Policy 与 Permissions-Policy

```http
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), camera=(), microphone=()
```

- `Referrer-Policy`：控制 `Referer` 发送策略。`strict-origin-when-cross-origin`（默认值）跨域仅发源，同源发完整 URL
- `Permissions-Policy`：限制浏览器功能（摄像头/麦克风/地理位置等）的访问源。`()` 禁用，`*` 全部允许，`self` 仅同源

### 5.6 生产环境安全头清单（推荐全部配置）

```http
Content-Security-Policy: default-src 'self'; ...
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), camera=(), microphone=()
```

可用 [securityheaders.com](https://securityheaders.com/) 评分检查。

## 六、缓存策略头深度解析

### 6.1 Cache-Control：核心字段

```http
Cache-Control: public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400
```

| 指令 | 作用 |
| --- | --- |
| `max-age` | 浏览器缓存秒数 |
| `s-maxage` | CDN/共享缓存秒数（覆盖 `max-age`） |
| `public` | 可被中间缓存 |
| `private` | 仅浏览器缓存（不能 CDN，如用户特定数据） |
| `no-cache` | 强制验证（每次发条件请求） |
| `no-store` | 完全不缓存（敏感数据） |
| `immutable` | 永不变，永久缓存 |
| `stale-while-revalidate` | 接受过期同时异步重验证 |
| `must-revalidate` | 过期后必须验证 |

### 6.2 max-age vs s-maxage

- `max-age=3600`：仅控制**浏览器**缓存 1 小时
- `s-maxage=86400`：控制 **CDN** 缓存 1 天，覆盖 `max-age`

两者并存时，CDN 用 `s-maxage`，浏览器用 `max-age`。典型配置：

```http
Cache-Control: public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400
```

### 6.3 常用缓存策略

| 资源类型 | 推荐配置 | 原因 |
| --- | --- | --- |
| **带 hash 的静态资源** | `public, max-age=31536000, immutable` | 文件名含 hash，永不变，可永久缓存 |
| **HTML 文档** | `no-cache` | 强制验证，配合 ETag |
| **API 响应（公共）** | `public, max-age=60` | 短缓存，平衡性能与实时性 |
| **API 响应（用户特定）** | `private, no-cache` | 不能 CDN，需验证 |
| **敏感数据** | `no-store` | 完全不缓存 |

### 6.4 ETag 与 Cache-Control 协同

```http
# 首次响应
HTTP/1.1 200 OK
Cache-Control: public, max-age=3600
ETag: "abc123"
Content-Type: application/json

# 1 小时后客户端请求
GET /api/data HTTP/1.1
If-None-Match: "abc123"

# 服务端响应（资源未变）
HTTP/1.1 304 Not Modified
Cache-Control: public, max-age=3600
ETag: "abc123"
```

`max-age` 控制浏览器**何时**验证，`ETag` 控制**如何**验证。两者协同：浏览器在 `max-age` 内直接用缓存，过期后用 `ETag` 发条件请求，服务端返回 304 则续期。

### 6.5 stale-while-revalidate：异步重验证

```http
Cache-Control: max-age=60, stale-while-revalidate=86400
```

- `max-age=60`：1 分钟内直接用缓存
- `stale-while-revalidate=86400`：1 分钟后到 24 小时内，**先返回过期缓存，同时异步发请求更新**

这是**性能与实时性的最佳平衡**——用户立即看到内容，下次访问是新数据。CDN（如 Cloudflare、Vercel）广泛支持。

## 七、HTTP/2 与 HTTP/3 的 Header 变化

### 7.1 HTTP/2 的 HPACK 压缩

HTTP/1. 的 Header 是纯文本，每个请求都发送完整 Header（如 `User-Agent` 长达 100+ 字节）。HTTP/2 引入 **HPACK 压缩**：

- 静态表（61 个常用 Header，如 `:method: GET`）
- 动态表（连接内重复 Header 编号复用）
- 哈夫曼编码（字符串压缩）

效果：Header 体积减少 **80%+**，特别是重复请求（如 API 调用）。

### 7.2 HTTP/2 伪头（pseudo-headers）

HTTP/2 用伪头替代起始行（请求行/状态行），前缀 `:`：

```http
:method: GET
:path: /api/users
:scheme: https
:authority: api.example.com
```

`Host` 被 `:authority` 替代，但浏览器仍会同时发送 `Host` 以兼容。

### 7.3 HTTP/3 的 QPACK

HTTP/3（QUIC）使用 **QPACK**（HPACK 的演进版），适配 QUIC 的 UDP 流特性，进一步降低 Header 压缩的等待时间。

### 7.4 实际影响

- **Header 大小限制**：HTTP/2 默认 16KB（NGINX `http2_max_field_size`），HTTP/1.x 无明确限制但服务器有 8KB-16KB
- **同名 Header 合并**：HTTP/2 要求同名 Header（除 Cookie）合并，避免歧义
- **大 Cookie 警告**：若 Cookie 超过 4KB，会撑大 Header，建议拆分域名或用 SessionStorage

## 八、实战案例与最佳实践

### 8.1 案例：API 跨域带 Cookie 调用

前端：

```js
fetch('https://api.example.com/users', {
  credentials: 'include',  // 关键：携带 Cookie
  headers: { 'Content-Type': 'application/json' },
});
```

后端响应头：

```http
Access-Control-Allow-Origin: https://your-frontend.com
Access-Control-Allow-Credentials: true
Access-Control-Allow-Headers: Content-Type
Access-Control-Allow-Methods: GET, POST, OPTIONS
Vary: Origin
```

**坑点**：

1. `Allow-Origin` 不能用 `*`，必须是具体源
2. 必须配合 `Vary: Origin`（动态白名单时）
3. 前端必须 `credentials: 'include'`
4. 服务端 `Set-Cookie` 必须含 `SameSite=None; Secure`（跨站 Cookie）

### 8.2 案例：CDN 缓存策略配置

```http
# 静态资源（带 hash）
Cache-Control: public, max-age=31536000, immutable

# HTML 文档
Cache-Control: no-cache

# API 列表（频繁更新）
Cache-Control: public, max-age=60, s-maxage=600, stale-while-revalidate=3600

# 用户特定数据
Cache-Control: private, no-cache
```

**Cloudflare 配置示例**（Page Rules）：

```
URL: *example.com/static/*
Cache Level: Cache Everything
Edge TTL: 1 month
Browser TTL: 1 year
```

### 8.3 案例：CSP 渐进式部署

**第一步：用 Report-Only 观察**

```http
Content-Security-Policy-Report-Only: default-src 'self'; report-uri /csp-report
```

**第二步：分析违规报告**

```js
// /csp-report 接口
app.post('/csp-report', (req, res) => {
  console.log(req.body['csp-report']);
  // 记录：violated-directive, blocked-uri, document-uri
});
```

**第三步：逐步收紧**

```http
# 第一版：宽松，允许 unsafe-inline
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'

# 第二版：用 nonce 替代 unsafe-inline
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-{RANDOM}'; style-src 'self' 'nonce-{RANDOM}'

# 第三版：严格，仅 self
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'
```

### 8.4 最佳实践清单

1. **所有响应配置基础安全头**：`X-Content-Type-Options: nosniff` + `X-Frame-Options: SAMEORIGIN` + `Referrer-Policy: strict-origin-when-cross-origin`
2. **HTTPS 全站强制**：HSTS + 301 重定向 HTTP → HTTPS
3. **静态资源用 hash 文件名 + immutable**：`main.a1b2c3.js` + `Cache-Control: max-age=31536000, immutable`
4. **HTML 用 no-cache + ETag**：强制验证，避免用户看到旧版本
5. **CORS 严格白名单**：不要用 `*`，配合 `Vary: Origin`
6. **Cookie 全部加 HttpOnly + Secure + SameSite**：防 XSS/CSRF
7. **CSP 用 nonce 替代 unsafe-inline**：用 `Content-Security-Policy-Report-Only` 渐进部署
8. **大 Cookie 拆分域名**：避免单 Cookie 超 4KB 撑大 Header
9. **HTTP/2+ 启用 HPACK**：服务器默认支持，无需额外配置
10. **定期用 securityheaders.com 检查安全头评分**

## 总结

HTTP Header 是 HTTP 协议的元数据层，承载缓存、跨域、安全、认证、内容协商等核心语义。本文系统讲解 40+ 常用 Header，覆盖请求头、响应头、CORS、安全、缓存五大主题，并给出生产环境配置建议。

**核心要点**：

- **缓存策略**：静态资源 `max-age + immutable`，HTML `no-cache + ETag`，API `s-maxage + stale-while-revalidate`
- **CORS 配置**：携带凭证不能用 `*`，必须 `Vary: Origin`，动态白名单
- **安全响应头**：HSTS + CSP + X-Frame-Options + X-Content-Type-Options + Referrer-Policy + Permissions-Policy
- **Cookie 安全**：HttpOnly + Secure + SameSite=Lax
- **HTTP/2 变化**：HPACK 压缩 + 伪头（`:method` / `:path` / `:authority`），Header 限制 16KB

掌握这些，你就能写出**安全、可缓存、跨域友好、SEO 友好**的 HTTP 接口与网页。
