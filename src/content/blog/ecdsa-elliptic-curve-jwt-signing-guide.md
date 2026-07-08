---
title: "椭圆曲线密码学与 ECDSA 签名：从 ES256 到 JWT 实践"
description: "系统讲解椭圆曲线密码学（ECC）原理、ECDSA 签名算法、JWT 中 ES256/ES384/ES512 三种算法的曲线选择、密钥生成、签名格式（r||s raw 拼接）、与 RS256 的性能与安全对比，以及在浏览器中基于 Web Crypto API 的完整实现。配套在线 JWT 签名生成器实操。"
pubDate: 2026-07-08
tags: ["JWT", "ECDSA", "椭圆曲线", "ECC", "ES256", "Web Crypto API", "安全", "认证"]
relatedTool: "/jwt-sign"
---

## 为什么 JWT 还需要第三种算法族

JWT 签名算法在 RFC 7518 中定义了三大类：

- **HS 系列**（HMAC）：对称密钥，签发与验签同一密钥，性能最高
- **RS 系列**（RSASSA-PKCS1-v1_5）：RSA 非对称密钥，私钥签发、公钥验签
- **ES 系列**（ECDSA）：椭圆曲线非对称密钥，与 RS 同为非对称但密钥与签名都显著更短

[在线 JWT 签名生成器](/jwt-sign)现已支持 ES256/ES384/ES512 三种曲线算法，本文从数学原理到工程实践完整讲解。

## 椭圆曲线密码学（ECC）基础

### 数学原理：椭圆曲线离散对数问题

RSA 的安全性基于**大整数分解难题**：给定大合数 n = p·q，恢复 p 与 q 在计算上不可行。ECC 的安全性则基于**椭圆曲线离散对数问题（ECDLP）**：给定曲线上点 G 与 k·G，求标量 k 在计算上不可行。

椭圆曲线方程形如：

```
y² = x³ + ax + b (mod p)
```

其中 a、b、p 为曲线参数。NIST 推荐的三条曲线 P-256、P-384、P-521 均定义在素数域上。

### ECC 的核心优势：同等安全下密钥更短

NIST SP 800-57 给出的等价安全强度对照：

| 对称算法 | ECC 曲线 | RSA 密钥长度 |
|---------|---------|-------------|
| AES-128 | P-256（256 位） | 3072 位 |
| AES-192 | P-384（384 位） | 7680 位 |
| AES-256 | P-521（521 位） | 15360 位 |

即 P-256 的安全等级已超过 RSA-2048，达到 RSA-3072 水平。这意味着 ECDSA 在**远小于 RSA 的密钥与签名**下提供等同甚至更高的安全强度。

## NIST 三条曲线详解

### P-256（secp256r1）

- **曲线**：y² = x³ - 3x + b（mod p），其中 p = 2²⁵⁶ - 2²²⁴ + 2¹⁹² + 2⁹⁶ - 1
- **安全强度**：约 128 位，等同 AES-128
- **JWT 算法**：ES256
- **生态**：JWT 生态中最广泛使用的 ECDSA 曲线。Apple Sign In、Google OAuth2、AWS Cognito、Auth0 等默认采用
- **签名长度**：固定 64 字节（r 与 s 各 32 字节）

### P-384（secp384r1）

- **安全强度**：约 192 位，等同 AES-192
- **JWT 算法**：ES384
- **适用场景**：金融级、医疗级身份令牌等高合规要求场景
- **签名长度**：固定 96 字节（r 与 s 各 48 字节）

### P-521（secp521r1）

- **安全强度**：约 256 位，等同 AES-256
- **JWT 算法**：ES512
- **注意**：曲线位数为 521（非 512），来自 NIST P-521 的历史命名
- **签名长度**：固定 132 字节（r 与 s 各 66 字节）
- **兼容性**：部分老旧库（如旧版 Java Bouncy Castle、旧版 Node.js）支持较差，选用前需确认验签方环境

## ES256/ES384/ES512 算法详解

JWT 中的 ES 系列算法定义如下：

| 算法 | 曲线 | 哈希 | 签名长度（字节） | base64url 后（字符） |
|------|------|------|-----------------|---------------------|
| ES256 | P-256 | SHA-256 | 64 | 约 86 |
| ES384 | P-384 | SHA-384 | 96 | 约 128 |
| ES512 | P-521 | SHA-512 | 132 | 约 176 |

注意 ES512 用 P-521 而非 P-512——这是 RFC 7518 的规定，因 P-521 是 NIST 标准曲线中唯一的 500+ 位曲线。

### ECDSA 签名格式：r || s 原始拼接

RFC 7518 第 3.4 节明确规定：JWT 中 ES 系列的签名字段为 **ECDSA 签名的原始 r 与 s 值直接拼接**，**不含 ASN.1 DER 包装**。

```
Signature = r || s
```

其中 r 与 s 均为固定长度大端字节，长度等于曲线点位的字节长度：

- P-256：r 32 字节 + s 32 字节 = 64 字节
- P-384：r 48 字节 + s 48 字节 = 96 字节
- P-521：r 66 字节 + s 66 字节 = 132 字节

这与 OpenSSL、Java 默认输出的 ASN.1 DER 格式（含 0x30 头、长度字节、0x02 标记）不同。许多 JWT 库需要做 DER → raw 转换，但 **Web Crypto API 的 ECDSA `sign()` 默认输出 raw 格式**，直接符合 RFC 7518 要求，无需额外转换——这是浏览器实现的便利之处。

## 浏览器实战：基于 Web Crypto 生成 EC 密钥对

### 生成 P-256 密钥对

```typescript
// 调用浏览器原生 Web Crypto API 生成 EC 密钥对
const keyPair = await crypto.subtle.generateKey(
  {
    name: 'ECDSA',
    namedCurve: 'P-256',  // ES256 对应 P-256；ES384 用 P-384，ES512 用 P-521
  },
  true,                   // 可导出（用于显示 PEM 与 JWK）
  ['sign', 'verify'],    // 用途：签发与验签
);

// 导出 PEM 格式（PKCS#8 私钥 / SPKI 公钥）
const privateDer = new Uint8Array(
  await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
);
const publicDer = new Uint8Array(
  await crypto.subtle.exportKey('spki', keyPair.publicKey)
);

// 导出 JWK 格式（用于 JWKS 端点）
const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
// { kty: "EC", crv: "P-256", x: "...", y: "...", d: "..." }
```

### 用私钥签名

```typescript
// 导入私钥（支持 PEM 或 JWK 格式）
const ecKey = await crypto.subtle.importKey(
  'pkcs8',
  pemToDer(privatePem, /-----BEGIN PRIVATE KEY-----/),
  { name: 'ECDSA', namedCurve: 'P-256' },
  false,
  ['sign'],
);

// 对 Header + "." + Payload 计算 ECDSA 签名
const signature = await crypto.subtle.sign(
  { name: 'ECDSA', hash: 'SHA-256' },  // ES256 用 SHA-256
  ecKey,
  signingInput,  // base64url(Header) + "." + base64url(Payload) 的 UTF-8 字节
);
// signature 直接为 raw 格式（r || s），无需 DER 转换
```

[在线 JWT 签名生成器](/jwt-sign)将上述流程完整封装，切换到 ES256/ES384/ES512 后即可在浏览器内一键生成密钥对并签发 JWT。

## ES vs RS：性能与安全实战对比

同等安全强度下（P-256 vs RSA-3072，均约 128 位安全）：

| 指标 | ES256（P-256） | RS256（RSA-3072） | 比值 |
|------|---------------|------------------|------|
| 私钥长度 | 32 字节 | 约 240 字节 | EC 约为 1/7 |
| 公钥长度 | 64 字节 | 约 384 字节 | EC 约为 1/6 |
| 签名长度 | 64 字节 | 384 字节 | EC 约为 1/6 |
| 签发速度 | 较快 | 较慢 | EC 快 5–10 倍 |
| 验签速度 | 较慢 | 较快 | RSA 略胜 |

对比 RS256（RSA-2048，安全等级略低于 ES256）：

| 指标 | ES256（P-256） | RS256（RSA-2048） |
|------|---------------|-------------------|
| 私钥长度 | 32 字节 | 约 1190 字节 |
| 签名长度 | 64 字节（base64url 86 字符） | 256 字节（base64url 344 字符） |
| 安全强度 | 128 位（≈ RSA-3072） | 112 位 |

**结论**：ES256 在 token 体积、签发性能、安全等级三方面均优于 RS256，是移动端、IoT、HTTP Header 受限场景的首选。RS256 唯一的优势是**验签略快**且**老系统兼容性更好**。

## 服务端验签要点

### Node.js（使用 jose 库）

```javascript
import { jwtVerify, importPKCS8 } from 'jose';

const publicKey = await importPKCS8(ecPublicKeyPem, 'ES256');
const { payload } = await jwtVerify(token, publicKey, {
  algorithms: ['ES256'],  // 硬编码算法白名单
});
```

### Python（使用 PyJWT + cryptography）

```python
import jwt
from cryptography.hazmat.primitives import serialization

# 加载 PEM 公钥
public_key = serialization.load_pem_public_key(ec_public_pem.encode())
# 验签（必须指定 algorithms 白名单）
payload = jwt.decode(token, public_key, algorithms=['ES256'])
```

### Java（使用 jose4j）

```java
JsonWebSignature jws = new JsonWebSignature();
jws.setCompactSerialization(token);
jws.setKey(ecPublicKey);
jws.setAlgorithmConstraints(
    new AlgorithmConstraints(ConstraintType.WHITELIST, "ES256")
);
if (!jws.verify()) {
    throw new RuntimeException("签名验证失败");
}
```

## 安全陷阱与最佳实践

### 1. 随机数 k 必须保密且唯一

ECDSA 签名依赖随机数 k。**同一私钥用相同 k 签发两次**会泄露私钥——这是索尼 PlayStation 3 被破解的著名案例。Web Crypto API 内部使用操作系统 CSPRNG 生成 k，质量可靠，但若自行实现 ECDSA 必须采用 RFC 6979 确定性 k 生成。

### 2. 曲线与算法必须匹配

ES256 必须用 P-256，ES384 必须用 P-384，ES512 必须用 P-521。若用 P-384 密钥签 ES256 会失败或产生可被攻击的签名。本工具切换 ES 算法时自动同步对应曲线，避免此问题。

### 3. ECDSA 签名非确定性

同一密钥对同一 Payload 多次签发会产生不同签名（因 k 不同）。这是 ECDSA 的正常特性，并非 Bug。若需确定性签名可改用 EdDSA（Ed25519），但 JWT 标准暂未广泛支持。

### 4. 验签必须硬编码算法白名单

与 RS256 一样，服务端验签时必须硬编码允许的算法（如 `['ES256']`），**不读取 token Header 中的 alg 字段**。否则会被 alg=none 攻击绕过。详见 [JWT 安全实践](/blog/jwt-security-best-practices)。

### 5. 公钥可公开、私钥保密

ECDSA 私钥（JWK 中的 `d` 字段）是标量，泄露后可签发任意令牌。公钥（`x`、`y` 字段）可公开分发，如发布到 `/.well-known/jwks.json` 端点供验签方获取。

## 工具联动

本工具与 [JWT 解码工具](/jwt) 形成「签发 + 解析」闭环：

1. 在 [JWT 签名生成器](/jwt-sign) 选择 ES256 → 生成 P-256 密钥对 → 输入 Payload → 签发
2. 复制 JWT → 粘贴到 [JWT 解码工具](/jwt)
3. 查看 Header（应含 `alg: "ES256"`、`typ: "JWT"`）、Payload、过期状态
4. 验证签名长度是否符合 64 字节（86 个 base64url 字符）

如需更高安全等级，可切换至 ES384（P-384）或 ES512（P-521）。

## 小结

椭圆曲线密码学在 JWT 中的落地即 ES256/ES384/ES512 三种算法，相比 RS 系列**密钥更短、签名更小、签发更快、安全等级更高**，是移动端、IoT、现代 API 网关的首选。Web Crypto API 的 ECDSA 原生输出 raw 格式直接符合 RFC 7518，让浏览器端实现异常简洁。

选型建议：通用业务首选 ES256（P-256），生态最广；高合规场景选 ES384；P-521 仅在确有极高安全等级需求且验签方支持时使用。所有密钥生成与签名计算均在浏览器本地完成，密钥不离开设备，可放心用于调试真实业务的密钥与 token。

> 推荐阅读：[JWT 签名实战](/blog/jwt-signing-guide)（HS/RS 系列对比）、[JWT 安全实践](/blog/jwt-security-best-practices)、[JWT 解码指南](/blog/jwt-decode-guide)。
