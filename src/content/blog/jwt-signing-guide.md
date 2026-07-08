---
title: "JWT 签名实战：HS256/RS256 算法选型、密钥管理与签发实现"
description: "从开发者签发 JWT 的视角，系统讲解 HMAC 对称密钥（HS256/HS384/HS512）与 RSA 非对称密钥（RS256/RS384/RS512）的算法选型、密钥生成与保管、Web Crypto API 签名实现细节、声明字段最佳实践、服务端验签要点与常见安全陷阱。配套在线 JWT 签名生成器实操演练。"
pubDate: 2026-07-07
tags: ["JWT", "签名", "HMAC", "RSA", "Web Crypto API", "安全", "认证"]
relatedTool: "/jwt-sign"
---

## 为什么需要自己签发 JWT

大多数后端框架（Node.js 的 `jsonwebtoken`、Java 的 `jose4j`、Python 的 `PyJWT`）都封装了 JWT 签发能力，但在以下场景中你可能需要独立签发工具：

- **联调测试**：后端未就绪时，前端用签发的测试 token 模拟登录态
- **算法迁移**：从 HS256 迁移到 RS256，需要对比两种算法签发的 token 差异
- **密钥调试**：怀疑密钥不匹配导致验签失败，需要用已知密钥重新签发对照
- **教学演示**：向团队或学生展示 JWT 三段式结构与签名过程

[在线 JWT 签名生成器](/jwt-sign)让你在浏览器内本地完成这些操作，密钥不离开设备，安全可控。

## 签名算法全景

RFC 7518 定义了 JWT 支持的签名算法，本工具覆盖最常用的 10 种：

| 算法 | 类别 | 密钥长度 | 签名长度（base64url） | 适用场景 |
|------|------|---------|----------------------|---------|
| HS256 | HMAC + SHA-256 | ≥ 256 位 | 约 43 字符 | 内部系统、单体应用 |
| HS384 | HMAC + SHA-384 | ≥ 384 位 | 约 64 字符 | 与 HS256 同族但摘要更长 |
| HS512 | HMAC + SHA-512 | ≥ 512 位 | 约 86 字符 | 本族中安全强度最高 |
| RS256 | RSA-PKCS1-v1_5 + SHA-256 | ≥ 2048 位 | 约 344 字符 | OAuth2、微服务、对外 API |
| RS384 | RSA-PKCS1-v1_5 + SHA-384 | ≥ 2048 位 | 约 344 字符 | 与 RS256 同族但摘要更长 |
| RS512 | RSA-PKCS1-v1_5 + SHA-512 | ≥ 2048 位 | 约 344 字符 | 本族中安全强度最高 |
| ES256 | ECDSA + P-256 + SHA-256 | 256 位 | 约 86 字符 | 移动端、IoT、带宽敏感场景 |
| ES384 | ECDSA + P-384 + SHA-384 | 384 位 | 约 128 字符 | 金融级、医疗级身份令牌 |
| ES512 | ECDSA + P-521 + SHA-512 | 521 位 | 约 176 字符 | 极高安全等级需求 |
| none | 无签名 | 无 | 0 字符 | **仅调试演示，严禁生产** |

注意：ES256/ES384/ES512（ECDSA 椭圆曲线）的深入原理、曲线选择与签名格式详见 [椭圆曲线密码学与 ECDSA 签名实践](/blog/ecdsa-elliptic-curve-jwt-signing-guide)。PS256/PS384/PS512（RSA-PSS）本工具暂不支持，但 [JWT 解码工具](/jwt) 能识别这些算法。

### 对称 vs 非对称：如何选

**HS 系列（对称密钥）**：签发与验签用同一密钥。优点是性能高、token 短、实现简单；缺点是密钥需在签发方与验签方之间安全共享，任何一方泄露密钥都可任意伪造。适合**单方服务**——签发与验签由同一系统完成。

**RS 系列（非对称密钥）**：私钥签发、公钥验签。优点是公钥可公开分发（如 `/.well-known/jwks.json` 端点），验签方无需私钥；缺点是 RSA 密钥较长、token 较大、计算稍慢。适合**多方协作**——多个服务验签同一签发方颁发的 token，如 OAuth2 授权服务器 + 多个资源服务器。

## HMAC 对称密钥管理

### 密钥长度要求

RFC 7518 建议 HMAC 密钥长度**至少等于哈希输出长度**：

- HS256：≥ 256 位（32 字节）
- HS384：≥ 384 位（48 字节）
- HS512：≥ 512 位（64 字节）

短密钥的风险是**暴力破解**：攻击者截获 JWT 后可离线穷举密钥。若密钥是 `"secret"`、`"123456"`、`"key"` 等弱密钥，几分钟甚至几秒即可破解。本工具在密钥长度不足时显示橙色警告。

### 密钥生成建议

推荐用密码学安全的随机数生成器（CSPRNG）生成密钥：

- 用 [密码生成器](/password) 生成至少 32 字节的随机字符串（HS256）
- 用 [UUID v4](/uuid) 作为密钥种子（128 位随机性，建议拼接两个 UUID 达到 256 位）
- 用 `openssl rand -base64 32` 命令生成 32 字节 base64 编码的密钥

本工具支持 UTF-8 字符串与 base64url 编码两种密钥输入格式。base64url 格式可直接输入 32 字节随机二进制，避免字符集限制，密钥强度更高。

### 密钥轮换

生产环境建议建立密钥轮换机制：

1. 同时维护新旧两个密钥（如 `key_v1`、`key_v2`）
2. 签发新 token 用 `key_v2`，验签时先试 `key_v2` 失败再试 `key_v1`
3. 等所有旧 token 过期后删除 `key_v1`
4. JWT Header 的 `kid`（key ID）字段可用于声明使用哪个密钥，便于服务端选择

## RSA 非对称密钥管理

### 密钥位数选择

NIST SP 800-57 给出的 RSA 安全强度对应关系：

- **2048 位**：2030 年前足够，签名约 256 字节，base64url 后约 344 字符，目前主流选择
- **3072 位**：NIST 推荐的 2030 年后安全等级，签名约 384 字节
- **4096 位**：安全裕度最高，但 token 显著变大，性能稍慢

实际选择需平衡**安全性、性能与 token 长度**。对内部系统 2048 位足够；对外长期运行的 API 推荐 3072 位；对高安全场景（金融、医疗）可用 4096 位。

### PEM 与 JWK 格式

**PEM 格式**：以 `-----BEGIN ... -----` 开头的 base64 编码文本，是 OpenSSL、Nginx、传统后端的标准格式。分两种：

- PKCS#1：`-----BEGIN RSA PRIVATE KEY-----`，仅含 RSA 算法特定字段
- PKCS#8：`-----BEGIN PRIVATE KEY-----`，含算法标识头，更通用，本工具推荐

**JWK 格式**：JSON Web Key，RFC 7517 定义的 JSON 对象，字段包括 `kty`（密钥类型）、`n`（模数）、`e`（公钥指数）、`d`（私钥指数）等。适合现代前端库与 JWKS 端点：

```json
{
  "kty": "RSA",
  "n": "vH5x...",
  "e": "AQAB",
  "d": "kX1z...",
  "p": "...",
  "q": "...",
  "dp": "...",
  "dq": "...",
  "qi": "..."
}
```

本工具可在线生成 RSA 密钥对并输出两种格式，生成的密钥仅本地保存，关闭页面即丢失。

### JWKS 端点

生产环境通常通过 JWKS（JSON Web Key Set）端点公开公钥：

```
GET /.well-known/jwks.json

{
  "keys": [
    { "kty": "RSA", "kid": "key-2026-01", "use": "sig", "alg": "RS256",
      "n": "...", "e": "AQAB" }
  ]
}
```

验签方定期拉取 JWKS 缓存公钥，签发方轮换密钥时新增 `kid` 即可，无需通知验签方。

## none 算法的历史包袱

`none` 算法表示无签名，JWT 第三段为空字符串，格式为 `header.payload.`（末尾有点）。RFC 7519 允许此算法仅用于调试，但历史上引发了多次严重安全漏洞：

### 经典攻击场景

服务端未严格校验 `alg` 字段，攻击者把 Header 中的 `{"alg":"HS256"}` 改为 `{"alg":"none"}` 并清空签名段。若服务端信任 token 自身声明的 alg，就会跳过验签，攻击者可任意伪造 Payload（如把 `role: "user"` 改为 `role: "admin"`）。

### 防御

服务端必须**硬编码允许的算法白名单**（如仅接受 HS256/RS256），不读取 token 自身声明的 alg。大多数现代 JWT 库默认拒绝 `none` 算法，但自定义实现仍需注意。

本工具保留 `none` 算法仅用于演示此攻击，签发结果会显示红色安全警告横幅，详见 [JWT 安全实践](/blog/jwt-security-best-practices)。

## Web Crypto API 签名实现

本工具的签名逻辑基于浏览器原生 Web Crypto API，零依赖纯 TypeScript 实现。

### HMAC 签名流程

```typescript
// 1. 导入密钥：将用户输入的字节作为 HMAC 密钥
const hmacKey = await crypto.subtle.importKey(
  'raw',
  keyBytes,
  { name: 'HMAC', hash: { name: 'SHA-256' } },  // HS256
  false,
  ['sign']
);
// 2. 签名：对 header.payload 字符串计算 HMAC
const sigBuffer = await crypto.subtle.sign(
  { name: 'HMAC' },
  hmacKey,
  new TextEncoder().encode(signingInput)
);
// 3. base64url 编码签名
const signatureB64 = base64urlEncode(new Uint8Array(sigBuffer));
```

### RSA 签名流程

注意 JWT 的 RS256 使用 **RSASSA-PKCS1-v1_5** 填充，而非 RSA-PSS：

```typescript
// 1. 导入私钥（PEM 或 JWK）
const rsaKey = await crypto.subtle.importKey(
  'pkcs8',
  derBytes,
  { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },  // RS256
  false,
  ['sign']
);
// 2. 签名
const sigBuffer = await crypto.subtle.sign(
  { name: 'RSASSA-PKCS1-v1_5' },
  rsaKey,
  new TextEncoder().encode(signingInput)
);
```

### 安全上下文要求

Web Crypto API 仅在**安全上下文**可用：HTTPS 站点或 `localhost`。HTTP 站点下 `crypto.subtle` 为 `undefined`，本工具会显示明确错误提示。部署时务必启用 HTTPS（Cloudflare Pages、Vercel、Netlify 均默认提供免费 SSL）。

## 声明字段最佳实践

### 标准声明

RFC 7519 定义了 7 个标准声明，签发时应尽量使用：

| 字段 | 含义 | 设置建议 |
|------|------|---------|
| `iss` | 签发者 | 用唯一 URL 标识签发方，如 `https://auth.example.com` |
| `sub` | 主题 | 用户唯一 ID（不要用邮箱，邮箱可变） |
| `aud` | 受众 | 目标服务标识，验签时必须校验，防止 token 跨服务重放 |
| `exp` | 过期时间 | Unix 秒级时间戳，建议 1-2 小时，最长不超过 24 小时 |
| `nbf` | 生效时间 | 通常等于 `iat`，特殊场景可延后生效 |
| `iat` | 签发时间 | 服务器当前时间，用于排查时钟漂移 |
| `jti` | 唯一标识 | 随机字符串（如 [UUID](/uuid)），配合黑名单实现主动失效 |

### 声明最小化

JWT 的 Payload 是 base64url 编码（非加密），任何人都可解码查看。**切勿**在 Payload 中放入：

- 密码、密钥、令牌等敏感凭证
- 身份证号、银行卡号、手机号等个人隐私
- 业务机密信息

只放必要的标识信息（如 `sub`、`role`），详细数据通过 API 按 ID 拉取。

## 服务端验签要点

签发只是第一步，验签才是安全的核心。服务端验签流程：

1. 拆分 JWT 为 Header、Payload、Signature 三段
2. base64url 解码 Header，读取 `alg`（但**不信任**此值）
3. 用**服务端硬编码的算法**与密钥对 `base64url(Header) + "." + base64url(Payload)` 重新计算签名
4. 用**常量时间比较**（防止时序攻击）比对计算结果与 token 的 Signature 段
5. 校验 Payload 的 `exp`（未过期）、`nbf`（已生效）、`iss`、`aud` 等声明

### 关键安全点

- **算法白名单**：服务端必须硬编码允许的算法，不读取 token 自身声明的 alg
- **常量时间比较**：用 `crypto.timingSafeEqual` 等函数避免时序攻击
- **声明校验**：`exp`、`aud`、`iss` 必须校验，否则 token 可跨服务重放或永久有效
- **时钟漂移**：分布式系统需用 NTP 同步时钟，可容忍几秒漂移

## 常见陷阱与排查

### 签名失败

- **Header JSON 不合法**：缺少 `alg` 字段、JSON 语法错误
- **Payload 必须是对象**：不能是数组或基本类型
- **HMAC 密钥为空**：HS 系列必须提供密钥
- **RSA 私钥格式错误**：PEM 缺少 `-----BEGIN ... PRIVATE KEY-----` 标记，或 JWK 缺少 `kty`/`n`/`d` 字段
- **算法与密钥不匹配**：如选 RS256 但输入了 HMAC 密钥

### 验签失败

- **密钥不匹配**：签发与验签用了不同密钥（最常见）
- **算法不一致**：签发用 HS256，验签用 RS256
- **token 被截断**：复制时漏了字符，或中间件截断了 HTTP Header
- **时钟漂移**：`exp` 校验失败，但 token 实际未过期
- **iss/aud 不匹配**：服务端期望的签发者/受众与 token 声明不一致

### 调试流程

1. 用 [JWT 解码工具](/jwt) 查看 token 内容，确认 Header/Payload 正确
2. 用本工具用已知密钥重新签发，对比签名段是否一致
3. 检查服务端日志的验签错误码（如 `jsonwebtoken` 的 `TokenExpiredError`、`JsonWebTokenError`）
4. 排查时钟漂移：`new Date(payload.exp * 1000)` 与服务器时间对比

## 配套工具实操

本工具与 [JWT 解码工具](/jwt) 形成「签发 + 解析」闭环：

1. 在本工具选择算法（如 HS256）→ 输入密钥 → 点击「签发 JWT」
2. 复制完整 JWT → 粘贴到 [JWT 解码工具](/jwt)
3. 查看 Header/Payload 解码结果、过期状态、算法说明
4. 验证签发结果是否符合预期

如需加密保护内容（而非仅签名防篡改），可了解 [JWE 解码工具](/jwe) 的五段式加密令牌格式。

## 小结

JWT 签名的核心是**算法选型、密钥管理、声明最小化**三点。HS256 适合内部系统，RS256 适合多方协作；HMAC 密钥至少 32 字节随机字符串，RSA 密钥至少 2048 位；Payload 只放必要标识，不放敏感信息。服务端验签必须硬编码算法白名单、常量时间比较、校验所有声明字段。

本工具的所有签名计算在浏览器本地完成，密钥不离开设备，可放心用于调试真实业务的密钥与 token。生成 RSA 密钥对后请及时复制保存，关闭页面即丢失。
