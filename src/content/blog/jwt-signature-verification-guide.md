---
title: "JWT 验签实战：从签名校验到声明合规的完整指南"
description: "系统讲解 JWT 签名验证完整流程：HMAC/RSA/ECDSA 三类算法验签、alg=none 攻击防御、exp/nbf/iat 时间声明校验、iss/aud/jti 业务声明合规、JWKS 密钥轮换，附服务端代码示例。"
pubDate: 2026-07-08
tags: ["JWT", "验签", "签名验证", "HMAC", "RSA", "ECDSA", "Web Crypto API", "安全", "认证", "JWKS", "时序攻击"]
relatedTool: "/jwt-verify"
---

## 验签为何比签发更关键

在 JWT 的生命周期中，**签发**只发生一次（登录成功时颁发令牌），而**验签**发生在每一次受保护资源的访问中。一个典型的 API 网关每天可能验签上百万次。从安全视角看：

- **签发方的责任**是保护私钥不被泄露，确保只有合法用户获得令牌
- **验签方的责任**是确保每一个被接受的令牌都是真实的——既未被篡改，也确由可信签发方颁发，且所有声明合规

**验签是安全的核心防线**。如果验签逻辑有漏洞（如信任 token 自身声明的 alg、漏校验 exp、用 `===` 比较签名），攻击者就能伪造令牌绕过认证。与 [JWT 签名实战](/blog/jwt-signing-guide) 聚焦「如何正确签发」不同，本文聚焦「如何正确验签」——这是防御者的视角。

[在线 JWT 验签工具](/jwt-verify)让你在浏览器内本地完成验签，模拟服务端的校验流程，密钥不离开设备。

## 验签的完整流程

一个严谨的 JWT 验签包含六个步骤，缺一不可：

```
┌─────────────────────────────────────────────────────────────┐
│  1. 拆分 token 为 Header.Payload.Signature 三段              │
│  2. base64url 解码 Header，读取 alg 字段                      │
│  3. 【关键】用服务端硬编码的算法白名单校验 alg（不信任 token）  │
│  4. 根据 alg 导入对应密钥（HMAC 密钥 / RSA 公钥 / EC 公钥）    │
│  5. 用 crypto.subtle.verify 验证签名（内部常量时间比较）       │
│  6. 校验声明：exp（未过期）、nbf（已生效）、iss、aud、jti 等   │
└─────────────────────────────────────────────────────────────┘
```

**第 3 步是最常见的安全漏洞根源**：如果服务端直接读取 token Header 中的 `alg` 字段来决定验签算法，攻击者就能把 `alg:"HS256"` 改为 `alg:"none"`，从而绕过验签。正确做法是服务端硬编码允许的算法（如仅接受 `HS256`），无论 token 声明什么算法都按白名单执行。

第 5 步必须使用常量时间比较（下文详述），否则存在时序攻击风险。Web Crypto API 的 `verify` 方法内部已实现常量时间比较，本工具基于此实现。

## 三类算法的验签密钥

JWT 的 10 种签名算法分为三大类，验签密钥模型各不相同：

### HMAC 对称密钥（HS256/HS384/HS512）

```
签发方 ──[共享密钥 K]──> 验签方
签发：HMAC-SHA256(K, header.payload) = signature
验签：HMAC-SHA256(K, header.payload) === token.signature ?
```

**对称性**：签发与验签用**完全相同的密钥**。若签发方用 `"my-secret-2026"` 签发，验签方必须用同一字符串。常见陷阱：

- 密钥前后误加空格或换行（特别是从配置文件复制时）
- 密钥格式混淆：签发用 UTF-8 字符串，验签却按 base64url 解码
- 密钥大小写不一致

调试建议：用 [JWT 签名生成器](/jwt-sign) 用相同密钥签发一个 token，再粘贴到 [验签工具](/jwt-verify) 验证，确认密钥配对正确后再写服务端代码。

### RSA 非对称密钥（RS256/RS384/RS512）

```
签发方 ──[私钥]──> signature     验签方 <--[公钥]-- 公开分发
签发：RSA-Sign(私钥, header.payload) = signature
验签：RSA-Verify(公钥, header.payload, signature) = true/false
```

**非对称性**：私钥签发、**公钥验签**。验签只需公钥，无需私钥——这正是非对称算法的优势：公钥可公开分发（如 JWKS 端点），验签方无需持有敏感私钥即可验证令牌真实性。

支持的公钥格式：
- **PEM 格式**：`-----BEGIN PUBLIC KEY-----`（SPKI）或 `-----BEGIN RSA PUBLIC KEY-----`（PKCS#1）
- **JWK 格式**：含 `kty:"RSA"`、`n`、`e` 字段的 JSON 对象

**安全提示**：切勿将私钥粘贴到验签工具——验签只需公钥，私钥泄露会导致任意令牌可被伪造。

### ECDSA 椭圆曲线（ES256/ES384/ES512）

```
签发方 ──[私钥]──> signature     验签方 <--[公钥]-- 公开分发
签发：ECDSA-Sign(私钥, header.payload) = r || s（raw 格式）
验签：ECDSA-Verify(公钥, header.payload, r||s) = true/false
```

同样是非对称算法，验签只需 EC 公钥。**关键要求：公钥曲线必须与算法匹配**：

| 算法 | 曲线 | 公钥点位长度 | 签名长度 |
|------|------|------------|---------|
| ES256 | P-256 | 256 位 | 64 字节（r/s 各 32） |
| ES384 | P-384 | 384 位 | 96 字节（r/s 各 48） |
| ES512 | P-521 | 521 位 | 132 字节（r/s 各 66） |

**签名格式**：JWT 的 ES 系列采用 **raw 拼接格式 `r || s`**（非 ASN.1 DER）。这与某些库（如 Node.js `crypto.sign` 默认输出 DER）不同，跨语言对接时需注意格式转换。Web Crypto API 原生支持 raw 格式，本工具基于此实现，无需转换。

椭圆曲线原理详解参阅 [椭圆曲线密码学与 ECDSA 签名实践](/blog/ecdsa-elliptic-curve-jwt-signing-guide)。

## Web Crypto API 验签实现

本工具基于浏览器原生 Web Crypto API 实现验签，零依赖、纯本地。核心代码（简化版）：

```typescript
// HMAC 验签（HS256/HS384/HS512）
async function verifyHmac(token: string, key: string, alg: string): Promise<boolean> {
  const [headerB64, payloadB64, sigB64] = token.split('.');
  const signingInput = `${headerB64}.${payloadB64}`;
  const keyBytes = encodeUtf8(key); // UTF-8 编码密钥
  // 导入 HMAC 密钥
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes,
    { name: 'HMAC', hash: { name: `SHA-${alg.slice(2)}` } },
    false, ['verify']
  );
  // 常量时间验签（verify 内部已实现）
  const sigBytes = base64urlDecode(sigB64);
  return crypto.subtle.verify('HMAC', cryptoKey, sigBytes, encodeUtf8(signingInput));
}

// RSA 验签（RS256/RS384/RS512）
async function verifyRsa(token: string, publicKeyPem: string, alg: string): Promise<boolean> {
  const [headerB64, payloadB64, sigB64] = token.split('.');
  const signingInput = `${headerB64}.${payloadB64}`;
  const derBytes = pemToDer(publicKeyPem); // PEM → DER
  const cryptoKey = await crypto.subtle.importKey(
    'spki', derBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: { name: `SHA-${alg.slice(2)}` } },
    false, ['verify']
  );
  const sigBytes = base64urlDecode(sigB64);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sigBytes, encodeUtf8(signingInput));
}

// ECDSA 验签（ES256/ES384/ES512）
async function verifyEc(token: string, publicKeyPem: string, alg: string): Promise<boolean> {
  const [headerB64, payloadB64, sigB64] = token.split('.');
  const signingInput = `${headerB64}.${payloadB64}`;
  const derBytes = pemToDer(publicKeyPem);
  const namedCurve = alg === 'ES256' ? 'P-256' : alg === 'ES384' ? 'P-384' : 'P-521';
  const cryptoKey = await crypto.subtle.importKey(
    'spki', derBytes,
    { name: 'ECDSA', namedCurve },
    false, ['verify']
  );
  const sigBytes = base64urlDecode(sigB64); // raw r||s 格式，Web Crypto 原生支持
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: { name: `SHA-${alg.slice(2)}` } },
    cryptoKey, sigBytes, encodeUtf8(signingInput)
  );
}
```

**关键点**：
- `crypto.subtle.verify` 内部使用**常量时间比较**，无需手动处理时序攻击
- ECDSA 的 `sigBytes` 是 raw `r||s` 拼接格式，Web Crypto 原生支持，无需 DER 转换
- 所有操作在浏览器沙箱内完成，密钥材料不离开设备内存
- 仅在 HTTPS 或 localhost（安全上下文）下可用——`crypto.subtle` 在非安全上下文为 `undefined`

## alg=none 攻击与算法白名单防御

这是 JWT 历史上最经典的安全漏洞。`none` 算法表示无签名，JWT 第三段为空，格式为 `header.payload.`（末尾有一个点）。

### 攻击场景

```
攻击者截获合法 token：
  eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoidXNlciJ9.abc123signature

篡改 Header 为 {"alg":"none"}，篡改 Payload 为 {"role":"admin"}：
  eyJhbGciOiJub25lIn0.eyJyb2xlIjoiYWRtaW4ifQ.

若服务端信任 token 声明的 alg → 跳过验签 → 接受伪造令牌
```

### 防御：算法白名单

服务端必须**硬编码允许的算法**，不读取 token 声明的 alg：

```typescript
// ❌ 危险：信任 token 的 alg
const alg = JSON.parse(atob(headerB64)).alg;
if (alg === 'none') { /* 跳过验签 */ }

// ✅ 安全：硬编码白名单
const EXPECTED_ALG = 'HS256'; // 服务端配置，不从 token 读取
if (tokenAlg !== EXPECTED_ALG) {
  throw new Error('算法不在白名单');
}
```

本工具默认开启「强制算法白名单」开关：若 token 声明的 alg 与检测到的不一致，直接拒绝。遇到 `none` 算法时显示红色安全警告，明确提示严禁生产使用。

## 时间声明校验

JWT 标准定义三个时间声明（均为 Unix 秒级时间戳）：

| 声明 | 全称 | 含义 | 校验规则 |
|------|------|------|---------|
| `exp` | Expiration Time | 过期时间 | 当前时间 > exp 则拒绝（已过期） |
| `nbf` | Not Before | 生效时间 | 当前时间 < nbf 则拒绝（未生效） |
| `iat` | Issued At | 签发时间 | 用于判断令牌年龄，可选校验 |

本工具自动校验这三项并显示状态徽章：**✓ 有效** / **✗ 已过期** / **⏳ 未生效** / **○ 缺失**，并换算为本地时间与相对时间（如「剩余 2 小时」「已过期 3 天」）。

### 过期 token 一定不能用吗

不一定。在 OAuth2 刷新令牌流程中：

- `access_token` 过期后**不应再用于访问受保护资源**，服务端必须拒绝
- 但可用 `refresh_token`（通常有效期更长）换取新的 access_token
- 此时 access_token 虽过期，但 refresh_token 仍有效

服务端应区分「签名验证」与「声明校验」：签名无效直接拒绝（可能被篡改），声明不合规（如过期）可返回特定错误码引导客户端刷新令牌。

### 时钟偏移容忍

分布式系统中各服务器时钟可能存在微小偏移（如 ±30 秒）。RFC 7519 允许验签方设置 `leeway`（容忍窗口）：

```typescript
const now = Math.floor(Date.now() / 1000);
const leeway = 30; // 30 秒容忍
if (payload.exp && now > payload.exp + leeway) {
  throw new Error('token 已过期');
}
if (payload.nbf && now + leeway < payload.nbf) {
  throw new Error('token 尚未生效');
}
```

本工具未设置 leeway（严格校验），生产环境可根据需要调整。

## 业务声明校验

**验签通过仅代表签名与密钥匹配、时间声明合规**，并不等同于令牌完全可信。生产环境还需校验以下业务声明：

| 声明 | 全称 | 校验规则 | 不校验的风险 |
|------|------|---------|------------|
| `iss` | Issuer（签发者） | 必须等于预期签发方 | 其他系统签发的 token 被误信 |
| `aud` | Audience（受众） | 必须等于当前服务标识 | A 服务的 token 在 B 服务使用（跨服务越权） |
| `sub` | Subject（主体） | 用户/主体 ID，业务鉴权 | 无法识别令牌归属用户 |
| `jti` | JWT ID | 配合 Redis 防重放 | 同一 token 被重放使用 |
| `scope`/`role` | 权限范围 | 细粒度授权 | 越权访问 |

**常见疏漏**：只验签名不验 `iss`/`aud`，导致 A 服务的 token 可在 B 服务使用（跨服务越权）。这是微服务架构中最危险的 JWT 误用之一。

### 防重放：jti + Redis

`jti`（JWT ID）是令牌的唯一标识。防重放流程：

```
1. 验签通过后，检查 Redis 中是否存在 jti
2. 若存在 → 拒绝（重放攻击）
3. 若不存在 → 写入 Redis（TTL = token 剩余有效期），放行
```

这样即使攻击者截获 token，也无法重复使用（首次使用后即失效）。

## 常量时间比较与时序攻击

**常量时间比较**（Constant-time comparison）是指比较两个字节串的耗时与内容完全无关——无论是否匹配、在第几位不同，耗时都相同。

### 为什么需要

普通的逐字节比较（如 JavaScript 的 `===`）在发现第一个不同的字节时就提前返回：

```
签名 A: a b c d e f
签名 B: a b X d e f
比较：a==a ✓ → b==b ✓ → c!=X ✗ 提前返回（耗时较短）

签名 A: a b c d e f
签名 B: a b c d e X
比较：a==a ✓ → ... → e==e ✓ → f!=X ✗ 提前返回（耗时较长）
```

攻击者通过**测量响应时间**，能判断签名在第几位开始不同，从而逐字节猜出正确签名（时序攻击 / Timing Attack）。理论上 256 字节的签名可在 256×256 = 65536 次请求内破解。

### Web Crypto 已内置

Web Crypto API 的 `verify` 方法**内部已使用常量时间比较**，本工具基于此实现，无需手动处理：

```typescript
// ✅ 安全：crypto.subtle.verify 内部常量时间比较
const valid = await crypto.subtle.verify('HMAC', key, sigBytes, data);

// ❌ 危险：手动 === 比较有时序攻击风险
const valid = computedSig === tokenSig;
```

后端验签库（Node.js 的 `jsonwebtoken`、Python 的 `PyJWT`、Java 的 `jose4j`）均已内置常量时间比较，但若你手写验签逻辑，务必使用 `crypto.timingSafeEqual`（Node.js）等专门的常量时间比较函数。

## JWKS 与密钥轮换

**JWKS**（JSON Web Key Set，RFC 7517）是公钥集合的 JSON 格式，常见于 OAuth2/OIDC 提供商的 `/.well-known/jwks.json` 端点：

```json
{
  "keys": [
    {
      "kty": "RSA",
      "kid": "key-2026-01",
      "n": "vbe7v3...",
      "e": "AQAB"
    },
    {
      "kty": "RSA",
      "kid": "key-2026-02",
      "n": "x9f2k8...",
      "e": "AQAB"
    }
  ]
}
```

JWT Header 中的 `kid`（Key ID）字段用于指明用 JWKS 中的哪个公钥验签：

```json
{ "alg": "RS256", "kid": "key-2026-01", "typ": "JWT" }
```

### 配合本工具验签

1. 从 JWKS 端点找到与 token 的 `kid` 匹配的公钥
2. 将该公钥的 JWK 复制到 [验签工具](/jwt-verify) 的「公钥输入框」
3. 验签

### 密钥轮换

生产环境应定期轮换签名密钥（如每季度）：

1. 在 JWKS 中**同时保留新旧两个公钥**（两个 kid）
2. 签发方切换到新私钥签发（新 kid）
3. 验签方仍能验签旧 token（用旧公钥）和新 token（用新公钥）
4. 待旧 token 全部过期后，从 JWKS 移除旧公钥

服务端应**缓存 JWKS**（如缓存 1 小时）并支持自动刷新（kid 未命中时刷新缓存），避免每次验签都请求 JWKS 端点。

常见 JWKS 端点：
- Google：`https://www.googleapis.com/oauth2/v3/certs`
- Auth0：`https://your-domain.auth0.com/.well-known/jwks.json`
- AWS Cognito：`https://cognito-idp.{region}.amazonaws.com/{poolId}/.well-known/jwks.json`

## 服务端验签实战

### Node.js（jsonwebtoken）

```javascript
const jwt = require('jsonwebtoken');

// HS256 验签
try {
  const payload = jwt.verify(token, 'my-secret-2026', { algorithms: ['HS256'] });
  // payload 含 iss/sub/aud/exp 等，jsonwebtoken 已自动校验 exp
  console.log(payload);
} catch (err) {
  // err.name: 'TokenExpiredError' | 'JsonWebTokenError' | 'NotBeforeError'
  console.error('验签失败:', err.message);
}

// RS256 验签（用公钥）
const publicKey = fs.readFileSync('public.pem');
const payload = jwt.verify(token, publicKey, {
  algorithms: ['RS256'],
  issuer: 'expected-issuer',  // 校验 iss
  audience: 'my-service',     // 校验 aud
});
```

**关键**：`algorithms` 参数必须显式指定，否则可能被 alg=none 攻击。

### Python（PyJWT）

```python
import jwt

# HS256 验签
try:
    payload = jwt.decode(token, 'my-secret-2026', algorithms=['HS256'])
    print(payload)
except jwt.ExpiredSignatureError:
    print('token 已过期')
except jwt.InvalidTokenError as e:
    print(f'验签失败: {e}')

# RS256 验签（用公钥）
with open('public.pem', 'rb') as f:
    public_key = f.read()
payload = jwt.decode(token, public_key, algorithms=['RS256'],
                     issuer='expected-issuer', audience='my-service')
```

### Java（jose4j）

```java
import org.jose4j.jwt.consumer.JwtConsumer;
import org.jose4j.jwt.consumer.JwtConsumerBuilder;

JwtConsumer consumer = new JwtConsumerBuilder()
    .setRequireExpirationTime()
    .setAllowedClockSkewInSeconds(30)          // 30 秒时钟容忍
    .setExpectedIssuer("expected-issuer")      // 校验 iss
    .setExpectedAudience("my-service")         // 校验 aud
    .setVerificationKey(publicKey)             // 公钥
    .setJwsAlgorithmConstraints( // 算法白名单
        AlgorithmConstraints.ConstraintType.PERMIT,
        AlgorithmIdentifiers.RSA_USING_SHA256)
    .build();

try {
    JwtClaims claims = consumer.processToClaims(token);
    System.out.println(claims.getSubject());
} catch (InvalidJwtException e) {
    System.err.println("验签失败: " + e);
}
```

## 常见验签失败场景与排查

| 症状 | 可能原因 | 排查建议 |
|------|---------|---------|
| 签名无效（HMAC） | 密钥不匹配 / 格式选错 | 用 [签名生成器](/jwt-sign) 用相同密钥签发后验证 |
| 签名无效（RSA） | 公钥与私钥不配对 | 确认公钥来自对应私钥的密钥对 |
| 签名无效（EC） | 曲线与算法不匹配 | ES256→P-256 / ES384→P-384 / ES512→P-521 |
| 签名无效 | token 被篡改 | 任何一段改动都会失效，检查传输过程 |
| 格式错误 | 段数不足 3 | 可能是 JWE 而非 JWT，用 [JWE 解码工具](/jwe) |
| 格式错误 | base64url 解码失败 | 检查是否含非法字符（`+` `/` 应为 `-` `_`） |
| 声明不合规 | exp 过期 | 区分「签名无效」与「声明不合规」，后者可刷新令牌 |
| 声明不合规 | nbf 未生效 | 检查签发方与验签方时钟是否同步 |
| crypto.subtle undefined | 非安全上下文 | 仅 HTTPS 或 localhost 可用 Web Crypto |

本工具在结果展示中会**区分「签名无效」与「声明不合规」**：签名无效直接标记失败（可能被篡改），声明不合规则显示具体哪项声明违规（如「exp 已过期」），便于针对性排查。

## 工具联动与小结

JWT 生态的三件套构成完整的开发调试闭环：

1. **[JWT 签名生成器](/jwt-sign)**：签发 token（10 种算法，在线生成 RSA/EC 密钥对）
2. **[JWT 验签工具](/jwt-verify)**：验证签名（本文主题，校验签名 + 时间声明）
3. **[JWT 解码工具](/jwt)**：查看内容（仅解码不验签，调试时用）

典型联调流程：

```
签名生成器签发 token + 密钥 → 验签工具验证签名与声明 → 解码工具查看内容
         ↑ 签发                            ↑ 验签                  ↑ 解析
```

### 验签安全清单

在将验签逻辑部署到生产环境前，逐项检查：

- [ ] 算法白名单已硬编码（不信任 token 的 alg）
- [ ] `none` 算法被明确拒绝
- [ ] 使用常量时间比较（`crypto.subtle.verify` 或 `timingSafeEqual`）
- [ ] `exp` 已校验（未过期）
- [ ] `nbf` 已校验（已生效）
- [ ] `iss` 已校验（等于预期签发方）
- [ ] `aud` 已校验（等于当前服务标识）
- [ ] `jti` 配合 Redis 实现防重放（高安全场景）
- [ ] JWKS 已缓存（避免每次验签请求端点）
- [ ] 密钥轮换流程已就绪
- [ ] 验签失败有完善日志（便于安全审计）

记住：**验签是 JWT 安全的核心防线，任何疏漏都可能导致令牌伪造**。宁可校验过严（拒绝合法 token），不可校验过松（接受伪造 token）。

想深入了解签发端？参阅 [JWT 签名实战与算法选型](/blog/jwt-signing-guide) 与 [椭圆曲线密码学与 ECDSA 签名实践](/blog/ecdsa-elliptic-curve-jwt-signing-guide)。更宏观的 JWT 安全实践参阅 [JWT 安全进阶](/blog/jwt-security-best-practices)。
