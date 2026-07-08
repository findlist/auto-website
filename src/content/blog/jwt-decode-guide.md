---
title: "JWT 入门与安全实践：三段式结构、算法选型与解码实现"
description: "系统讲解 JSON Web Token 的三段式结构（Header.Payload.Signature）、base64url 编码、7 个标准声明字段、HS256/RS256/ES256 算法选型对比、签名密钥管理、过期与刷新机制、常见安全陷阱。配套在线 JWT 解码工具实操演练。"
pubDate: 2026-07-04
tags: ["JWT", "认证", "安全", "Web API", "JavaScript"]
relatedTool: "/jwt"
---

## JWT 是什么

JWT（JSON Web Token）是一种用于在两方之间安全传递声明的开放标准（RFC 7519），常见于身份认证与信息交换场景。它把结构化信息（如用户 ID、签发者、过期时间）编码成一个紧凑的字符串，可直接放在 HTTP 头、URL 参数或 Cookie 中传递。

典型应用场景：

- **身份认证**：用户登录后服务器签发 JWT，客户端后续请求携带该 token，服务器验签后识别用户身份
- **信息交换**：两方需要传递可信信息时，用带签名的 JWT 防篡改
- **OAuth2 / OpenID Connect**：作为 access_token 与 id_token 的标准格式
- **单点登录（SSO）**：跨子域共享登录态，避免传统 Session 的跨域难题

与传统 Session 相比，JWT 是无状态的——服务器不需要存储会话信息，验签即可信任。这带来了水平扩展友好的好处，但也带来了无法主动失效（除非维护黑名单）的代价。本文配套的[在线 JWT 解码工具](/jwt)可让你边读边试。

## 三段式结构

JWT 由三段用 `.` 分隔的字符串组成：`Header.Payload.Signature`。前两段是 base64url 编码的 JSON，可直接解码查看；第三段是二进制签名的 base64url 表示。

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMDAwMSIsImV4cCI6MTkwMDAwMDAwMDB9.c2lnbmF0dXJlX2RlbW8
└──────────── Header ───────────┘ └──────── Payload ────────┘ └──── Signature ────┘
```

### Header（头部）

Header 描述令牌的元信息，通常是两个字段：

```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

- `alg`：签名算法，决定 Signature 段如何计算。常见值：`HS256`、`RS256`、`ES256`、`none`
- `typ`：令牌类型，固定为 `JWT`（部分实现会省略此字段）
- `kid`：可选，密钥 ID，用于在多密钥场景下选择对应公钥验签

Header 段是 base64url 编码的，但**不加密**——任何人都能解码查看。**绝不要把密钥或敏感信息放在 Header**。

### Payload（载荷）

Payload 携带声明（claims），即业务信息。声明分三类：

| 类别       | 说明                                   | 示例                                           |
| ---------- | -------------------------------------- | ---------------------------------------------- |
| 标准声明   | RFC 7519 预定义，建议但非强制使用      | `iss`、`sub`、`aud`、`exp`、`nbf`、`iat`、`jti` |
| 公共声明   | 由使用者自定义，建议在 IANA 注册避免冲突 | `name`、`email`、`role`                         |
| 私有声明   | 双方约定使用，注意避免与标准声明冲突   | `company_id`、`internal_flag`                  |

7 个标准声明详解：

| 字段 | 全称            | 含义                         | 类型   |
| ---- | --------------- | ---------------------------- | ------ |
| `iss` | Issuer          | 签发者标识，通常是服务地址   | string |
| `sub` | Subject         | 主题，通常是用户 ID          | string |
| `aud` | Audience        | 受众，目标服务地址           | string |
| `exp` | Expiration Time | 过期时间，**Unix 秒级时间戳** | number |
| `nbf` | Not Before      | 生效时间，在此之前令牌无效   | number |
| `iat` | Issued At       | 签发时间                     | number |
| `jti` | JWT ID          | 唯一标识，用于防重放攻击     | string |

> **注意**：`exp`、`iat`、`nbf` 都是**秒级**时间戳，不是 JavaScript `Date.now()` 返回的毫秒级。转换时需除以 1000 或乘以 1000。

Payload 段同样不加密，**任何人都能解码查看**。绝不要把密码、身份证号等敏感信息放在 Payload，即使有签名保护——签名只防篡改，不防泄露。

### Signature（签名）

Signature 是服务器用密钥对 `base64url(Header) + "." + base64url(Payload)` 计算出的摘要，用于防篡改。具体算法由 Header 中的 `alg` 字段决定：

- **HS256**：`HMAC-SHA256(base64url(Header) + "." + base64url(Payload), secret)`
- **RS256**：`RSA-SHA256(base64url(Header) + "." + base64url(Payload), privateKey)`，用公钥验签
- **ES256**：`ECDSA-SHA256(...)`，基于椭圆曲线

验签时服务器重新计算签名并与 token 中的 Signature 段比对，一致则代表内容未被篡改。

## base64url 编码

JWT 的前两段使用 base64url 编码，这是 base64 的 URL 安全变体。差异在两个字符与 padding：

| 标准 base64 | base64url | 说明                                |
| ----------- | --------- | ----------------------------------- |
| `+`         | `-`       | `+` 在 URL 中会被解析为空格         |
| `/`         | `_`       | `/` 是 URL 路径分隔符，会破坏 URL   |
| `=` padding | 省略      | padding 在 URL 中无需，可省略       |

解码时需还原：把 `-` 转回 `+`、`_` 转回 `/`，并按 4 的倍数补 `=`。JavaScript 实现：

```javascript
function base64urlDecode(input) {
  // 还原为标准 base64
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  // 补齐 padding 至 4 的倍数
  const pad = base64.length % 4;
  if (pad) base64 += '='.repeat(4 - pad);
  // 解码为二进制字符串，再用 TextDecoder 处理 UTF-8 多字节字符
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}
```

注意：直接用 `atob` 解码含中文/Emoji 的 Payload 会乱码，因为 `atob` 返回的是二进制字符串而非 UTF-8 字符串。必须用 `TextDecoder` 处理多字节字符。

## 算法选型对比

JWT 支持多种签名算法，选型需考虑安全性、性能与协作场景：

| 算法     | 类型     | 密钥长度          | 性能 | 适用场景                       |
| -------- | -------- | ----------------- | ---- | ------------------------------ |
| `HS256`  | 对称 HMAC | 共享密钥（≥32字节） | 快   | 单方服务、内部系统             |
| `RS256`  | 非对称 RSA | 2048 位密钥对      | 较慢 | 多方协作、OAuth2、公钥可公开   |
| `ES256`  | 非对称 ECDSA | 256 位椭圆曲线     | 快   | 现代 JWT 推荐、移动端、IoT     |
| `PS256`  | RSA-PSS  | 2048 位密钥对      | 较慢 | 高安全场景（PSS 比 PKCS#1 更安全） |
| `none`   | 无签名   | 无                | -    | **仅调试，严禁生产**           |

### HS256 vs RS256 vs ES256

- **HS256（对称）**：签发与验签用同一密钥。优点是性能高、实现简单；缺点是密钥泄露后可任意伪造，且多方协作时密钥需共享给所有验签方，扩大了泄露面。
- **RS256（非对称 RSA）**：私钥签发、公钥验签。公钥可公开分发（如通过 JWKS 端点），适合多方协作场景。缺点是 RSA 密钥较长（2048 位）、签名/验签计算稍慢。
- **ES256（非对称椭圆曲线）**：与 RS256 同等安全强度下密钥更短（256 位）、计算更快，是现代 JWT 实现的推荐选择。缺点是部分老系统/库不支持。

### `none` 算法陷阱

`alg: "none"` 表示无签名，JWT 标准允许但不推荐。历史上多次出现过 `none` 算法安全漏洞：

- 服务端未禁止 `none` 算法时，攻击者可构造 `alg: "none"` 的 token，Signature 段留空，服务端误以为合法
- 部分库存在 `alg` 混淆漏洞：签发用 RS256，验签时若把 RS256 公钥当作 HS256 密钥使用，攻击者可用公钥签发伪造 token

**防御**：服务端验签时必须显式指定允许的算法白名单，禁止从 token Header 中读取 `alg` 直接使用。

## JWT vs Session vs OAuth2

| 特性          | Session（传统） | JWT                | OAuth2（含 JWT）         |
| ------------- | --------------- | ------------------ | ------------------------ |
| 服务端状态    | 需存储          | 无状态             | 通常无状态               |
| 扩展性        | 需共享 Session 存储 | 天然分布式友好     | 天然分布式友好           |
| 主动失效      | 删除 Session 即可 | 需维护黑名单       | 通常用短 exp + Refresh   |
| 跨域          | 需配置 CORS + Session 共享 | 头部携带即可        | 头部携带即可              |
| 携带信息      | 仅 Session ID   | 可携带任意声明     | 可携带任意声明           |
| 适用场景      | 单体应用、内部系统 | API 服务、微服务    | 第三方授权、SSO           |

JWT 并非 Session 的替代品，而是不同场景的选型。需要主动失效（如用户改密码后立即登出所有设备）的场景，Session 更合适；需要无状态扩展的 API 服务，JWT 更合适。

## 安全实践

### 1. 必须使用 HTTPS

JWT 一旦泄露给他人（如通过中间人攻击截获 HTTP 请求），他人可冒用直到过期。**生产环境必须使用 HTTPS**，避免 token 在传输中被截获。

### 2. 设置合理的过期时间

`exp` 是 JWT 的核心安全机制之一。过期时间过长（如 1 年）增加泄露风险；过短（如 5 分钟）则需频繁刷新，影响体验。常见模式：

- **Access Token**：短 exp（15 分钟 ~ 1 小时），用于 API 调用
- **Refresh Token**：长 exp（7 天 ~ 30 天），仅用于换取新的 Access Token，且服务端可主动失效

### 3. 密钥管理

- HS256 密钥至少 32 字节，避免使用弱密钥（如 `"secret"`、`"123456"`）
- 密钥不应硬编码在代码中，应通过环境变量或密钥管理服务（如 Vault、KMS）注入
- 多密钥场景用 `kid` 字段标识，便于密钥轮换
- 密钥泄露后应立即轮换，签发新密钥并废弃旧密钥

### 4. 不携带敏感信息

JWT 的 Header 与 Payload **不加密**，仅 base64url 编码，任何人都能解码查看。绝不要在 JWT 中携带：

- 密码（即使哈希也不行）
- 身份证号、银行卡号等个人敏感信息
- API 密钥、数据库连接串等机密信息

如需传递敏感信息，使用 JWE（JSON Web Encryption）加密，而非 JWS（JSON Web Signature，即通常说的 JWT）。

### 5. 防 XSS 与 CSRF

- **XSS**：JWT 通常存在 localStorage 或 sessionStorage，恶意脚本可读取。防御：严格 CSP、避免 `innerHTML`、使用 HttpOnly Cookie 存储（但需配合 CSRF 防御）
- **CSRF**：若 JWT 通过 Cookie 携带，需配合 SameSite 属性或 CSRF Token；若通过 `Authorization` 头携带，则天然不受 CSRF 影响

### 6. 验签时显式指定算法

```javascript
// ❌ 错误：从 token Header 读取 alg
const decoded = jwt.verify(token, secret, { algorithms: [decoded.header.alg] });

// ✅ 正确：显式指定允许的算法白名单
const decoded = jwt.verify(token, secret, { algorithms: ['HS256', 'RS256'] });
```

## 常见陷阱速查表

| 陷阱                          | 说明                                                              | 防御                                       |
| ----------------------------- | ----------------------------------------------------------------- | ------------------------------------------ |
| `exp` 用毫秒而非秒            | JavaScript `Date.now()` 返回毫秒，直接放入 exp 会得到 1970 年时间 | 手动除以 1000 或用库函数                   |
| Payload 含敏感信息            | JWT 不加密，Payload 任何人可解码                                  | 只放必要声明，敏感信息用 JWE 加密          |
| 用 `none` 算法                | 无签名，任何人可伪造                                              | 服务端显式禁止 `none`，算法白名单          |
| 密钥硬编码在源码              | 代码泄露即密钥泄露                                                | 用环境变量或密钥管理服务                   |
| 长期不失效                    | token 泄露后无法主动失效                                          | 短 exp + Refresh Token，必要时维护黑名单   |
| 不验签直接信任 Payload        | 攻击者可任意构造 token                                            | 必须验签，且校验 `exp`、`nbf`、`iss`、`aud` |
| 把 JWT 当 Session 用          | 误以为可以像 Session 一样主动失效                                 | JWT 无状态，失效需黑名单或短 exp           |
| 在 URL 中携带 JWT             | URL 会被日志、Referer、浏览器历史记录                             | 用 `Authorization` 头携带                  |
| 不校验 `aud`                  | A 服务的 token 可能在 B 服务也被接受                              | 验签时校验 `aud` 与自身标识一致            |

## JavaScript 解码实现

完整的 JWT 解码（仅解码，不验签）：

```javascript
function decodeJwt(token) {
  // 去除可能的 Bearer 前缀
  const trimmed = token.replace(/^Bearer\s+/i, '');
  const parts = trimmed.split('.');
  if (parts.length !== 3) {
    throw new Error(`JWT 应包含 3 段，当前 ${parts.length} 段`);
  }
  return {
    header: JSON.parse(base64urlDecode(parts[0])),
    payload: JSON.parse(base64urlDecode(parts[1])),
    signature: parts[2],  // 签名段不解码，仅展示原始 base64url
  };
}

// 检查过期
function isExpired(payload) {
  if (typeof payload.exp !== 'number') return false;  // 无 exp 视为不过期
  return Date.now() >= payload.exp * 1000;  // 注意：exp 是秒级
}
```

> **重要**：以上代码仅做解码，**不验证签名真实性**。在生产环境中，验签必须由服务端用对应密钥完成，绝不能信任客户端解码的结果。配套的[在线 JWT 解码工具](/jwt)同样只做解码展示，不验签。

## 小结

- JWT 是无状态的声明传递标准，适合 API 认证与跨服务信息交换，不适合需要主动失效的场景
- 三段式结构 `Header.Payload.Signature`，前两段 base64url 编码可解码查看，第三段是签名
- `exp`、`iat`、`nbf` 是**秒级**时间戳，与 JavaScript 毫秒级时间戳差 1000 倍
- 算法选型：单方用 HS256，多方协作用 RS256，现代实现推荐 ES256，严禁 `none`
- 安全要点：HTTPS、短 exp + Refresh、不携带敏感信息、显式算法白名单、防 XSS/CSRF
- JWT 不加密，敏感信息用 JWE；JWT 不验签不可信，验签必须在服务端

读完本文，可用配套的[在线 JWT 解码工具](/jwt)实操：粘贴一个真实 JWT，观察三段结构、检查过期状态、识别标准声明字段。
