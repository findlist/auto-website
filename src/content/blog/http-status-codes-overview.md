---
title: "HTTP 状态码全景：1xx / 2xx / 3xx / 4xx / 5xx 含义与处理"
description: "系统讲解 HTTP 状态码五大类：1xx 信息响应、2xx 成功、3xx 重定向、4xx 客户端错误、5xx 服务端错误。覆盖 60+ 常见状态码含义、缓存语义、浏览器行为、前后端处理建议、SEO 影响（301 vs 302 vs 307 vs 308、410 永久删除）、API 设计规范。配套可交互工具矩阵，帮你彻底搞懂 HTTP 状态码。"
pubDate: 2026-07-04
tags: ["HTTP", "后端", "网络", "状态码", "Web API"]
relatedTool: "/http-status"
---

## 为什么必须彻底搞懂 HTTP 状态码

很多前端开发者把 HTTP 状态码当作「成功就是 200，其他都是错误」——这是危险的简化。事实上，**状态码是 HTTP 协议的核心语义层**，浏览器、爬虫、CDN、搜索引擎都依据状态码决定缓存策略、重定向行为、是否重试。

举个真实场景：你把一个旧接口迁移到新路径，用 302 重定向，结果发现 SEO 权重没有传递过去。原因很简单——**302 是临时重定向，搜索引擎不会把权重从旧 URL 转移到新 URL**，应该用 301。再比如，你删除了一篇文章，返回 404，结果搜索引擎三个月后才从索引里移除——应该用 410（Gone），明确告诉爬虫「这个资源永久消失了，请立即移除」。

理解状态码的本质，能让你写出**语义正确、可缓存、可演进**的 HTTP 接口。本文系统讲解 5 大类共 60+ 常见状态码，并给出前后端处理建议。

> 配套工具：[HTTP 状态码查询](/http-status)（在线检索 55+ 状态码含义与用法）、[MIME 类型查询](/mime)（HTTP Content-Type 设置）、[JSON 工具](/json)（API 响应格式化）、[JWT 解码](/jwt)（401 鉴权调试）

## 一、状态码的分类与首位数字语义

HTTP 状态码是一个 3 位数字，首位数字决定类别：

| 首位 | 类别 | 含义 | 是否常见 |
| --- | --- | --- | --- |
| **1xx** | 信息响应 | 请求已接收，继续处理 | 罕见（HTTP/1.1 升级用） |
| **2xx** | 成功 | 请求已成功接收、理解、处理 | 高频 |
| **3xx** | 重定向 | 需要进一步操作才能完成请求 | 中频 |
| **4xx** | 客户端错误 | 请求有语法错误或无法完成 | 高频 |
| **5xx** | 服务端错误 | 服务器在处理请求时发生错误 | 中频 |

记忆口诀：**1 收到、2 成功、3 跳转、4 你错、5 我错**。

## 二、1xx 信息响应（Informational）

1xx 类状态码表示「请求已接收，继续处理」，HTTP/1.1 引入，实际开发中**几乎不会主动使用**。

| 码 | 名称 | 含义 | 实际用途 |
| --- | --- | --- | --- |
| 100 | Continue | 客户端应继续发送请求体 | 大文件上传前用 `Expect: 100-continue` 探测服务器是否接受 |
| 101 | Switching Protocols | 切换协议 | WebSocket 握手时从 HTTP 升级到 WebSocket |
| 103 | Early Hints | 提前 hints | 在最终响应前预加载资源（`Link: </style.css>; rel=preload`） |

### 101 Switching Protocols：WebSocket 的起点

WebSocket 连接建立时，客户端发送：

```http
GET /ws HTTP/1.1
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
```

服务器响应 `101 Switching Protocols` 后，TCP 连接升级为 WebSocket 长连接，后续通信不再是 HTTP 协议。

### 103 Early Hints：现代浏览器的预加载优化

服务器在最终响应前先发 103，提示浏览器预加载关键资源：

```http
HTTP/1.1 103 Early Hints
Link: </style.css>; rel=preload; as=style
Link: </font.woff2>; rel=preload; as=font; crossorigin

HTTP/1.1 200 OK
Content-Type: text/html
```

浏览器收到 103 后立即开始下载 CSS 与字体，无需等待 HTML 解析到 `<link>` 标签，**LCP 可改善 200-500ms**。Cloudflare、Vercel 已支持。

## 三、2xx 成功（Success）

2xx 类表示请求已成功处理，是日常开发最常用的状态码。

| 码 | 名称 | 含义 | 典型场景 |
| --- | --- | --- | --- |
| 200 | OK | 请求成功，响应体含结果 | GET / POST / PUT 普通成功 |
| 201 | Created | 资源已创建，Location 头指向新资源 | POST 创建资源后 |
| 202 | Accepted | 请求已接受，但处理尚未完成 | 异步任务接收（如导出报表） |
| 204 | No Content | 成功但无响应体 | DELETE / PUT 成功无返回 |
| 206 | Partial Content | 部分内容 | Range 请求（视频/大文件分片下载） |

### 200 vs 201 vs 204：API 设计的关键差异

RESTful API 设计中，这三个状态码的语义很重要：

- **200 OK**：通用成功，响应体含数据。适合 GET、PUT（更新已有资源）、PATCH。
- **201 Created**：**新资源已创建**，必须在 `Location` 响应头中返回新资源的 URL。适合 POST 创建。
- **204 No Content**：**成功但无响应体**。适合 DELETE、PUT（更新且无需返回）、POST（创建但客户端已知 ID）。

错误示例：

```http
# 错误：用 200 + body 表示删除成功，但语义不清
DELETE /users/123
HTTP/1.1 200 OK
Content-Type: application/json

{"success": true}

# 正确：用 204 明确表示删除成功且无返回
DELETE /users/123
HTTP/1.1 204 No Content
```

### 206 Partial Content：视频播放与大文件下载

206 是流媒体与断点续传的基础。客户端用 `Range` 头请求一段数据：

```http
GET /video.mp4 HTTP/1.1
Range: bytes=1048576-2097151

HTTP/1.1 206 Partial Content
Content-Range: bytes 1048576-2097151/10485760
Content-Length: 1048576
```

浏览器播放视频时**默认从 0 开始请求 206**，拖动进度条会发起新的 Range 请求。CDN 必须支持 206，否则视频无法拖动播放。

## 四、3xx 重定向（Redirection）

3xx 类表示需要客户端进一步操作才能完成请求，**重定向语义是 SEO 与缓存策略的核心**。

| 码 | 名称 | 含义 | 永久性 | 保持方法 | SEO 权重传递 |
| --- | --- | --- | --- | --- | --- |
| 301 | Moved Permanently | 永久重定向 | 永久 | **可能改为 GET** | ✓ |
| 302 | Found | 临时重定向 | 临时 | **可能改为 GET** | ✗ |
| 303 | See Other | 用 GET 访问另一个 URL | 临时 | **强制改为 GET** | ✗ |
| 304 | Not Modified | 资源未修改，用缓存 | - | - | - |
| 307 | Temporary Redirect | 临时重定向 | 临时 | **保持原方法** | ✗ |
| 308 | Permanent Redirect | 永久重定向 | 永久 | **保持原方法** | ✓ |

### 301 vs 302：SEO 权重的关键区别

这是 SEO 最容易踩坑的点：

- **301 Moved Permanently**：搜索引擎会把旧 URL 的**权重、外链、收录**转移到新 URL，几个月后旧 URL 从索引消失，新 URL 出现在索引中。
- **302 Found**：搜索引擎认为这是**临时**重定向，**权重不转移**，旧 URL 仍保留在索引中。

**适用场景**：

- 域名迁移（`old.com` → `new.com`）：用 301
- HTTP 升级 HTTPS：用 301
- 旧文章迁移到新路径：用 301
- 临时维护页跳转：用 302
- A/B 测试不同版本：用 302
- 移动端跳转 `m.example.com`：用 302（设备切换是临时的）

### 307 vs 301/302：保持 HTTP 方法的重定向

301/302 有个**历史遗留问题**：浏览器实现可能把 POST 改成 GET（虽然 RFC 7231 已规范不应改，但实际行为不一致）。307/308 解决了这个问题：

- **307 Temporary Redirect**：临时重定向，**严格保持原 HTTP 方法**（POST 重定向后仍是 POST）
- **308 Permanent Redirect**：永久重定向，**严格保持原 HTTP 方法**

```http
# 307：POST 不会变成 GET
POST /api/users HTTP/1.1
Content-Type: application/json

{"name": "张三"}

HTTP/1.1 307 Temporary Redirect
Location: /api/v2/users

# 浏览器会用 POST 重新请求 /api/v2/users，body 保持原样
POST /api/v2/users HTTP/1.1
Content-Type: application/json

{"name": "张三"}
```

### 303 See Other：PRG 模式的标准用法

303 是 **PRG（Post-Redirect-Get）模式**的标准状态码：表单 POST 后重定向到 GET 页面，避免用户刷新时重复提交。

```http
POST /checkout HTTP/1.1

HTTP/1.1 303 See Other
Location: /success

# 浏览器用 GET 请求 /success
GET /success HTTP/1.1
```

### 304 Not Modified：缓存的核心

304 是**条件请求**的响应，配合 `If-Modified-Since` / `If-None-Match` 使用：

```http
# 第一次请求
GET /style.css HTTP/1.1

HTTP/1.1 200 OK
ETag: "abc123"
Cache-Control: max-age=3600
Last-Modified: Wed, 04 Jul 2026 10:00:00 GMT
```

```http
# 第二次请求（缓存过期后）
GET /style.css HTTP/1.1
If-None-Match: "abc123"

# 服务器校验 ETag 未变，返回 304
HTTP/1.1 304 Not Modified
ETag: "abc123"
```

304 响应**没有响应体**，浏览器直接用本地缓存。这是静态资源性能优化的核心机制。

## 五、4xx 客户端错误（Client Error）

4xx 类表示**客户端发送的请求有问题**，是最常见的错误状态码。

| 码 | 名称 | 含义 | 典型场景 |
| --- | --- | --- | --- |
| 400 | Bad Request | 请求语法错误 | 参数格式错误、JSON 解析失败 |
| 401 | Unauthorized | 未认证 | 缺少或无效的 Authorization 头 |
| 403 | Forbidden | 已认证但无权限 | 普通用户访问管理员接口 |
| 404 | Not Found | 资源不存在 | URL 错误、文章已删除 |
| 405 | Method Not Allowed | 方法不允许 | 对只读资源发 POST |
| 409 | Conflict | 冲突 | 唯一约束冲突、乐观锁冲突 |
| 410 | Gone | 永久消失 | 资源永久删除（区别于 404） |
| 413 | Payload Too Large | 请求体过大 | 上传文件超限 |
| 415 | Unsupported Media Type | 不支持的媒体类型 | Content-Type 错误 |
| 422 | Unprocessable Entity | 语义错误 | 字段类型对但值非法（如年龄为负数） |
| 429 | Too Many Requests | 请求过多 | 限流触发 |

### 401 vs 403：认证与授权的区别

这是最容易混淆的两个状态码：

- **401 Unauthorized**：**未认证**——服务器不知道你是谁。响应应含 `WWW-Authenticate` 头。
- **403 Forbidden**：**未授权**——服务器知道你是谁，但你没有权限。

```http
# 未登录
GET /admin/users HTTP/1.1

HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="api"

# 已登录但不是管理员
GET /admin/users HTTP/1.1
Authorization: Bearer <JWT token>

HTTP/1.1 403 Forbidden
```

调试技巧：用 [JWT 解码工具](/jwt) 检查 JWT 中的 `role` 字段，确认权限是否符合预期。

### 404 vs 410：永久删除的 SEO 信号

- **404 Not Found**：资源**当前不存在**，但未来可能存在。搜索引擎会保留索引一段时间。
- **410 Gone**：资源**永久消失**，不会再回来。搜索引擎会**立即移除索引**。

删除文章时，应返回 410 而非 404，加速搜索引擎索引更新。但注意：410 必须持续返回，否则搜索引擎会重新爬取。

### 422 Unprocessable Entity：API 验证错误的标准码

422 来自 WebDAV，但已成为 RESTful API 校验错误的事实标准。区别于 400：

- **400 Bad Request**：请求**语法**错误（JSON 解析失败、缺必填字段）
- **422 Unprocessable Entity**：请求**语义**错误（字段类型对但值非法，如 `age: -5`）

```http
POST /users HTTP/1.1
Content-Type: application/json

{"name": "张三", "age": -5, "email": "invalid"}

# 400：JSON 解析失败
HTTP/1.1 400 Bad Request

# 422：JSON 合法但字段值非法
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/json

{
  "errors": {
    "age": "年龄必须为正整数",
    "email": "邮箱格式不正确"
  }
}
```

### 429 Too Many Requests：限流的标准响应

429 必须配合 `Retry-After` 头：

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1625000000
```

客户端应尊重 `Retry-After`，不要立即重试。指数退避算法的退避基准应基于此值。

## 六、5xx 服务端错误（Server Error）

5xx 类表示**服务器在处理请求时出错**，通常是后端 bug 或基础设施问题。

| 码 | 名称 | 含义 | 典型场景 |
| --- | --- | --- | --- |
| 500 | Internal Server Error | 通用服务端错误 | 代码抛异常、数据库连接失败 |
| 501 | Not Implemented | 服务器不支持此功能 | 客户端用了服务器未实现的方法 |
| 502 | Bad Gateway | 网关收到无效响应 | Nginx 反向代理后端挂了 |
| 503 | Service Unavailable | 服务不可用 | 维护中、过载、熔断 |
| 504 | Gateway Timeout | 网关等待超时 | 后端响应慢，Nginx 超时 |

### 500 vs 502 vs 503 vs 504：定位问题的关键

前端开发者看到 5xx 错误时，根据具体码可以快速定位问题：

- **500**：请求到达了应用服务器，但应用代码出错。查后端日志。
- **502 Bad Gateway**：Nginx 等反向代理无法连接后端，或后端返回了无效响应。后端服务可能挂了。
- **503 Service Unavailable**：服务器**主动拒绝**服务，通常是维护中或过载熔断。配合 `Retry-After` 头。
- **504 Gateway Timeout**：反向代理连接后端成功，但后端响应超时。后端慢查询或死锁。

```http
# 503 维护中
HTTP/1.1 503 Service Unavailable
Retry-After: 3600
Content-Type: text/html

<!DOCTYPE html>
<html><body>系统维护中，预计 1 小时后恢复</body></html>
```

### 503 是熔断与降级的正确响应

微服务架构中，下游服务过载时，上游应**主动熔断**并返回 503，而不是让请求堆积拖垮整个系统：

```http
HTTP/1.1 503 Service Unavailable
Retry-After: 30
Content-Type: application/json

{
  "error": "service_overloaded",
  "message": "支付服务当前过载，请稍后重试",
  "retry_after": 30
}
```

## 七、状态码与缓存的交互

状态码直接影响浏览器与 CDN 的缓存行为：

| 状态码 | 默认缓存行为 | 配合 Cache-Control |
| --- | --- | --- |
| 200 | 可缓存 | `max-age=3600` 缓存 1 小时 |
| 301 | 默认缓存（很久） | `Cache-Control: max-age=86400` 控制缓存时长 |
| 302 | 默认不缓存 | `Cache-Control: private` 禁止 CDN 缓存 |
| 404 | 短期缓存（消极缓存） | 默认缓存几分钟，避免重复请求 |
| 410 | 短期缓存 | 与 404 类似，告诉 CDN 资源永久消失 |
| 500 | 不应缓存 | 临时错误，缓存会延长故障 |
| 503 | 不应缓存 | 临时过载，缓存会延长故障 |

**消极缓存（Negative Caching）**：浏览器与 CDN 会缓存 404/410 一段时间，避免对不存在的资源重复请求。这能减轻服务器压力，但也意味着**误删的资源需要等缓存过期才会重新可访问**，必要时用 `Cache-Control: no-cache`。

## 八、状态码与 Content-Type：API 错误响应的标准格式

错误响应必须有合理的 `Content-Type` 与结构化错误体。规范如下：

```http
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/json
Content-Language: zh-CN

{
  "error": "validation_failed",
  "message": "请求参数校验失败",
  "details": [
    {"field": "email", "code": "invalid_format", "message": "邮箱格式不正确"},
    {"field": "age", "code": "out_of_range", "message": "年龄必须在 0-150 之间"}
  ],
  "request_id": "req_abc123"
}
```

`Content-Type` 必须与客户端的 `Accept` 头协商一致。常用 MIME 类型可在 [MIME 类型查询工具](/mime) 中查阅。

## 九、状态码速查表

### 成功响应（2xx）

| 码 | 名称 | 何时用 |
| --- | --- | --- |
| 200 | OK | 通用成功 |
| 201 | Created | POST 创建资源成功 |
| 202 | Accepted | 异步任务已接收 |
| 204 | No Content | DELETE/PUT 成功无返回 |
| 206 | Partial Content | Range 请求 |

### 客户端错误（4xx）

| 码 | 名称 | 何时用 |
| --- | --- | --- |
| 400 | Bad Request | 请求语法错误 |
| 401 | Unauthorized | 未登录 |
| 403 | Forbidden | 已登录但无权限 |
| 404 | Not Found | 资源不存在 |
| 405 | Method Not Allowed | HTTP 方法不允许 |
| 406 | Not Acceptable | Accept 协商失败 |
| 409 | Conflict | 并发冲突 |
| 410 | Gone | 资源永久删除 |
| 412 | Precondition Failed | If-Match 条件失败 |
| 413 | Payload Too Large | 请求体超限 |
| 415 | Unsupported Media Type | Content-Type 不支持 |
| 422 | Unprocessable Entity | 字段值非法 |
| 429 | Too Many Requests | 限流 |

### 服务端错误（5xx）

| 码 | 名称 | 何时用 |
| --- | --- | --- |
| 500 | Internal Server Error | 通用服务端错误 |
| 501 | Not Implemented | 功能未实现 |
| 502 | Bad Gateway | 网关收到无效响应 |
| 503 | Service Unavailable | 维护/过载 |
| 504 | Gateway Timeout | 网关等待超时 |

## 十、工具矩阵联动

理解 HTTP 状态码后，配套工具能帮你更快定位问题：

- [HTTP 状态码查询](/http-status)：在线检索 55+ 状态码含义、场景、排查建议与 RESTful 用法，支持搜索与分类筛选
- [MIME 类型查询](/mime)：设置正确的 `Content-Type` 响应头，避免 415 错误
- [JSON 工具](/json)：格式化 API 响应体，调试 422 校验错误
- [JWT 解码](/jwt)：检查 401 鉴权失败的根因（JWT 过期、签名错误、role 字段）
- [URL 编解码](/url)：调试 308 永久重定向的 Location 头中文参数
- [HTML 实体编解码](/html-entities)：在 503 维护页 HTML 中安全显示错误消息

## 十一、状态码使用检查清单

设计 API 时，按以下清单检查：

- [ ] **2xx**：成功响应用了正确的 200/201/204，而非一律 200
- [ ] **3xx**：永久重定向用 301/308，临时用 302/307，PRG 用 303
- [ ] **4xx**：未登录 401，无权限 403，资源不存在 404，永久删除 410
- [ ] **4xx**：参数错误用 400（语法）或 422（语义），不要混用
- [ ] **429**：限流响应含 `Retry-After` 头
- [ ] **5xx**：500 不暴露堆栈，503 配合 `Retry-After`，504 检查上游超时配置
- [ ] **缓存**：临时错误（500/503）不缓存，永久状态（301/410）可缓存
- [ ] **错误体**：所有 4xx/5xx 返回结构化 JSON 错误体，含 `error` 字段与 `request_id`
- [ ] **i18n**：错误消息支持 `Accept-Language` 协商，中文用户看中文错误
- [ ] **文档**：API 文档列出所有可能返回的状态码及触发条件

## 小结

HTTP 状态码不是装饰，而是 HTTP 协议的**语义层**。正确使用状态码能让浏览器、CDN、爬虫、客户端都按预期工作，错误使用会导致缓存失效、SEO 权重丢失、客户端重复提交、熔断失效等隐性问题。

记住核心原则：**1xx 收到、2xx 成功、3xx 跳转、4xx 你错、5xx 我错**，遇到具体场景查速查表，配合工具矩阵调试，HTTP 接口的语义正确性就能掌握。
