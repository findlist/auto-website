---
title: "JWE 与 JWT 的本质区别：从 JOSE 家族到加密令牌实战"
description: "讲透 JWT/JWS/JWE 三者关系：JWT 是统称，JWS 防篡改、JWE 防查看。详解 JWE 五段式结构、五类密钥管理算法（dir/AES-KW/RSA-OAEP/PBES2/ECDH-ES）选择决策、AEAD 内容加密为何成标配、JWS+JWE 嵌套令牌应用场景，附 JWE 在线解密工具实操。"
pubDate: 2026-07-19
tags: ["JWE", "JWT", "JWS", "JOSE", "加密", "AEAD", "AES-GCM", "RSA-OAEP", "ECDH-ES", "PBES2", "前向保密", "嵌套令牌", "工具矩阵"]
relatedTool: "/jwe"
---

## 为什么需要专门讲 JWE

[JWT 入门指南](/blog/jwt-decode-guide)讲了三段式结构与 base64url 编码，[JWT 安全进阶](/blog/jwt-security-best-practices)讲了刷新令牌与算法选择。但很多开发者仍搞不清一个根本问题：

> 「JWT 不就是 `Header.Payload.Signature` 三段吗？为什么 RFC 7516 又搞出来一个 JWE 五段？」

这源于一个被广泛忽略的事实——**JWT 是统称，不是具体格式**。RFC 7519 定义的 JWT 只规定「声明（claims）的编码方式」，至于这些声明是**签名**（防篡改）还是**加密**（防查看），由两个独立标准决定：

- **JWS**（RFC 7515，JSON Web Signature）：签名令牌，三段式 `Header.Payload.Signature`
- **JWE**（RFC 7516，JSON Web Encryption）：加密令牌，五段式 `Header.Key.IV.Ciphertext.Tag`

> 配套工具：[JWE 解码工具](/jwe)。点击「载入 PBES2 示例」或「载入 ECDH-ES 示例」即可现场解密一个 JWE，配合本文边读边试。

本文聚焦 JWE 与 JWS 的本质区别、五段加密流程、五类密钥管理算法选择决策，以及**何时该用 JWE 而非 JWS**。

## 一、JOSE 家族全景

要理解 JWE，先看 JOSE（JSON Object Signing and Encryption）全家福：

| 标准 | 全称 | 作用 | 段数 |
|------|------|------|------|
| **JWT** | JSON Web Token（RFC 7519） | 声明编码规范（统称） | 2 或 5 |
| **JWS** | JSON Web Signature（RFC 7515） | 签名令牌，**防篡改** | 3 段 |
| **JWE** | JSON Web Encryption（RFC 7516） | 加密令牌，**防查看** | 5 段 |
| **JWK** | JSON Web Key（RFC 7517） | 密钥表示规范 | - |
| **JWA** | JSON Web Algorithms（RFC 7518） | 算法注册表 | - |

关键认知：

1. **JWT 不是一种格式，而是一组规范**。我们日常说的「JWT」通常指 JWS（即三段式签名令牌），因为 JWS 是 JWT 最常见的实现方式。
2. **JWS 与 JWE 互斥**。一个令牌要么是 JWS（签名），要么是 JWE（加密），不能既是 JWS 又是 JWE（但可以嵌套：JWE 加密 JWS，见第六节）。
3. **JWE 也算 JWT 的一种**。当 JWE 的 payload 是 JSON 声明时，它就是 JWT。

## 二、JWS vs JWE：防篡改 vs 防查看

最容易混淆的点在于「payload 的可见性」：

| 维度 | JWS（签名令牌） | JWE（加密令牌） |
|------|---------------|---------------|
| 段数 | 3 段 | 5 段 |
| Payload | base64url 编码（**任何人可读**） | 加密为 ciphertext（**无密钥不可读**） |
| 安全保证 | 完整性（防篡改） | 机密性 + 完整性（AEAD） |
| 解码 | 任何人可解码查看 payload | 必须有密钥才能还原明文 |
| 验签 | 必须有密钥（公钥或对称密钥） | 不需要单独验签（认证标签自动校验） |
| 适用场景 | 身份认证 token、OAuth state | 敏感数据传输、向前保密 |

**一句话记忆**：**JWS 防篡改，JWE 防查看**。

举例说明：

```text
# JWS：任何人 base64 解码 payload 都能看到内容
eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMTIzIiwiZW1haWwiOiJ1c2VyQGV4YW1wbGUuY29tIn0.signature
                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                  base64 解码后可见：{"sub":"user123","email":"user@example.com"}

# JWE：ciphertext 段无法还原，必须用密钥解密
eyJhbGciOiJSU0EtT0FFUC0yNTYiLCJlbmMiOiJBMjU2R0NNIn0..abc.xyz.def.tag
                                                ^^^
                                                密文，无密钥无法还原
```

什么时候应该用 JWE 而非 JWS？参考下表：

| 场景 | 推荐 | 理由 |
|------|------|------|
| 用户登录态 token | JWS | 内容可公开（用户 ID），仅需防篡改 |
| OAuth state 参数 | JWS | 短时效，仅需防 CSRF |
| 含敏感字段（手机号/身份证/API 凭证）的声明 | JWE | payload 必须保密 |
| 内部服务间传递机密数据 | JWE | 防止中间节点查看 |
| 需向前保密的会话 token | JWE（ECDH-ES） | 即使私钥泄露，历史 token 仍安全 |
| HIPAA / GDPR 合规医疗/金融数据 | JWE | 法规要求加密 payload |
| 公开的资料分享（公开链接） | JWS | 内容本就公开，无需加密 |

## 三、JWE 五段结构：从加密流程拆解

JWE Compact 序列化由五段组成，用 `.` 分隔：

```text
<Protected Header>.<Encrypted Key>.<IV>.<Ciphertext>.<Authentication Tag>
```

每一段对应的加密流程：

```text
┌────────────────────────────────────────────────────────────────────┐
│  加密流程                                                          │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  1. 生成随机 CEK（Content Encryption Key，内容加密密钥）            │
│     └─ 用于加密 payload，AES-GCM 通常 256 位                        │
│                                                                    │
│  2. 用 alg 算法加密 CEK，得到 Encrypted Key                         │
│     ├─ dir：CEK = 共享密钥本身，Encrypted Key 段为空                │
│     ├─ A128KW：用 AES 包装 CEK                                     │
│     ├─ RSA-OAEP-256：用接收方公钥加密 CEK                          │
│     ├─ PBES2：用密码 + salt + 迭代派生 KEK，再包装 CEK             │
│     └─ ECDH-ES：用临时私钥 + 接收方公钥 ECDH 派生密钥              │
│                                                                    │
│  3. 生成随机 IV（初始化向量，AES-GCM 12 字节）                     │
│                                                                    │
│  4. 用 CEK + IV + AAD 加密 payload                                 │
│     ├─ AAD = ASCII 编码的 Protected Header                         │
│     ├─ 输出 Ciphertext（密文）                                     │
│     └─ 输出 Authentication Tag（认证标签，16 字节）                │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

五段对应的 base64url 编码：

| 段 | 名称 | 说明 |
|----|------|------|
| 1 | Protected Header | base64url(ASCII(JSON 头部))，含 alg/enc/kid 等字段 |
| 2 | Encrypted Key | base64url(加密后的 CEK)，dir 时为空 |
| 3 | IV | base64url(初始化向量)，每次不同 |
| 4 | Ciphertext | base64url(AEAD 加密后的 payload) |
| 5 | Authentication Tag | base64url(AEAD 生成的认证标签)，固定 128 位 |

**关键理解**：

- **AAD（Additional Authenticated Data）= Protected Header 的 ASCII 编码**。AAD 参与认证但不被加密，意味着如果 Protected Header 被篡改，认证标签校验会失败。
- **认证标签 ≠ 签名**。JWE 没有「签名段」，认证标签由 AEAD 算法（如 AES-GCM）自动生成，既验证完整性又验证真实性，**无需单独验签**。
- **每次加密 IV 都不同**，因此同一明文多次加密得到的 JWE 不同。这是 AEAD 算法的安全要求。

## 四、密钥管理算法（alg）选择决策树

RFC 7518 定义的 JWE 密钥管理算法分五大类，选择合适算法是 JWE 设计的核心：

### 4.1 五类算法对比

| 算法 | 类型 | 密钥长度 | 适用场景 | 前向保密 |
|------|------|---------|---------|---------|
| `dir` | 直接模式 | 与 enc 一致 | 内部服务、调试 | ❌ |
| `A128KW`/`A192KW`/`A256KW` | 对称包装 | 128/192/256 | 多接收方对称密钥 | ❌ |
| `RSA-OAEP-256/384/512` | 非对称加密 | 2048+ | 跨组织通信 | ❌ |
| `PBES2-HS256+A128KW` 等 | 密码派生 | 派生 | 用户密码场景 | ❌ |
| `ECDH-ES` | 椭圆曲线协商 | P-256/384/521 | 现代推荐 | ✅ |

### 4.2 算法选择决策树

```text
┌────────────────────────────────────────────────────┐
│ 需要向前保密（历史 token 即使密钥泄露也安全）？    │
└──────────────────┬─────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
       是                    否
        │                     │
        ▼                     │
   ECDH-ES 系列              │
   (P-256/A128GCM)           │
                             │
              ┌──────────────┴──────────────┐
              │                            │
        跨组织通信？                  内部系统？
              │                            │
              ▼                            ▼
       RSA-OAEP-256                  dir
       (公钥分发)                  (共享密钥)

              ┌────────────────────────────┐
              │ 用户记忆密码场景？         │
              │                            │
              ▼                            │
          PBES2-HS512+A256KW              │
          (高迭代次数 ≥100k)              │
```

### 4.3 五类算法详解

#### dir（直接模式）

最简单的算法，共享密钥直接作为 CEK，Encrypted Key 段为空。

```text
发送方 ──[CEK = 共享密钥]──> 接收方
```

- **优点**：实现简单，性能高
- **缺点**：需安全渠道预先交换密钥；多方场景需多份密钥；无向前保密
- **适用**：内部服务、调试场景、单一签发方

#### A128KW/A256KW（对称密钥包装）

用 AES 算法包装（wrap）CEK，接收方用相同 KEK 解包。

```text
发送方 ──[KEK]──AES-KW──> [Encrypted Key] ──> 接收方 ──[KEK]──解包──> CEK
```

- **优点**：支持多接收方（每个接收方一份 KEK）
- **缺点**：仍需预先分发 KEK；无向前保密
- **适用**：企业内部多服务通信

#### RSA-OAEP-256/384/512（非对称加密）

发送方用接收方公钥加密 CEK，接收方用私钥解密。

```text
发送方 ──[接收方公钥]──RSA-OAEP──> [Encrypted Key] ──> 接收方 ──[私钥]──> CEK
```

- **优点**：公钥可公开分发，无需预先共享密钥
- **缺点**：RSA 密钥长（2048+ 位），加密速度慢；无向前保密
- **适用**：OAuth/OIDC、跨组织通信
- **避免**：`RSA1_5`（PKCS#1 v1.5）存在 Bleichenbacher padding oracle 攻击风险

#### PBES2-HS256+A128KW 等（密码派生）

将用户密码通过 PBKDF2 派生为 KEK，再用 KEK 包装 CEK。

```text
密码 ──PBKDF2(salt, count, hash)──> KEK ──AES-KW──> [Encrypted Key]
```

Protected Header 含两个专属参数：
- `p2s`：盐值（base64url），通常 16 字节随机数
- `p2c`：PBKDF2 迭代次数，RFC 7518 建议 ≥1000，OWASP 2023 建议 ≥600,000

- **优点**：用户无需管理密钥，只需记忆密码
- **缺点**：弱密码易被暴力破解；无向前保密
- **适用**：用户记忆密码场景（如加密备份文件）
- **安全建议**：迭代次数 ≥100,000，或优先选择 `ECDH-ES`

#### ECDH-ES / ECDH-ES+A128KW（椭圆曲线协商）

基于椭圆曲线 Diffie-Hellman，发送方与接收方在不安全信道协商共享密钥。

```text
发送方临时密钥对 (epk, esk)
接收方静态密钥对 (RPK, RSK)

ECDH(epk, RSK) = ECDH(RPK, esk) = Z（共享秘密）
Z ──Concat KDF──> CEK 或 KEK
```

Protected Header 含 `epk`（ephemeral public key，临时公钥 JWK）字段。

- **优点**：临时密钥每次不同，提供**前向保密**（即使接收方私钥泄露，历史 JWE 仍安全）
- **缺点**：实现复杂（需理解 ECDH 与 Concat KDF）
- **适用**：现代 JWE 推荐选择，长时效 token、敏感数据传输
- **支持曲线**：P-256（secp256r1）/ P-384 / P-521，暂不支持 secp256k1

## 五、内容加密算法（enc）：为何 AEAD 是标配

JWE 的内容加密算法必须使用 **AEAD**（Authenticated Encryption with Associated Data），同时提供加密与认证：

| enc 算法 | 加密 | 认证 | 推荐度 |
|---------|------|------|--------|
| `A128GCM` / `A192GCM` / `A256GCM` | AES-GCM | GCM 内置 | ⭐ 推荐 |
| `A128CBC-HS256` 等 | AES-CBC | HMAC-SHA | 兼容性场景 |

### 5.1 为什么必须 AEAD

如果只用普通 AES-CBC 加密，没有认证标签，攻击者可篡改密文而不被发现（**位翻转攻击**）。AEAD 通过认证标签同时保证：

1. **机密性**：ciphertext 无法还原
2. **完整性**：篡改可被检测（认证标签校验失败）
3. **真实性**：只有持有 CEK 的发送方才能生成有效密文

JWE 通过 AEAD 一举解决了完整性与机密性，无需像 JWS 那样单独「签名」。

### 5.2 为什么推荐 AES-GCM

- **硬件加速**：现代 CPU 提供 AES-NI 指令集，GCM 性能远超 CBC+HMAC
- **认证标签固定 128 位**：与 GCM 模式天然集成
- **Web Crypto API 原生支持**：浏览器可直接解密 GCM 系列，无需第三方库

`A256GCM` 是当前 JWE 实践首选，本站 [JWE 解码工具](/jwe)即基于 Web Crypto API 实现 16 种 alg × A128GCM/A192GCM/A256GCM 共 48 种组合的本地解密。

## 六、嵌套令牌（JWS+JWE）：何时需要既签名又加密

JWE 仅加密 payload，不提供身份认证。**如果既要验证签发者身份又要保证 payload 机密**，需要嵌套令牌：

```text
JWS(JWE(payload))
```

实现方式：

1. 发送方先用 JWS 签名 payload（得到三段式 token）
2. 再用 JWE 加密 JWS token（得到五段式 JWE，明文是 JWS）
3. 接收方先解密 JWE 得到 JWS，再验签 JWS

典型应用场景：

| 场景 | 嵌套必要性 |
|------|----------|
| 银行间转账指令 | 既要验证银行身份（JWS），又要保密金额（JWE） |
| 医疗记录传输 | 既要验证医院签名（JWS），又要保护患者隐私（JWE） |
| API 凭证交换 | 既要验证签发方（JWS），又要保护凭证（JWE） |
| 合规审计令牌 | 既要可追溯签发者（JWS），又要保密内容（JWE） |

**注意**：嵌套令牌体积较大（JWS 三段 + JWE 五段），性能开销约为单纯 JWE 的 1.5 倍。仅在确实需要身份认证 + 机密性双重保证时使用。

## 七、五种典型应用场景实战

### 7.1 内部服务间机密数据传递

```text
微服务 A ──JWE(dir+A256GCM)──> 微服务 B
   └─ 共享密钥 K（通过 K8s Secret 分发）
   └─ payload: { "request_id": "...", "internal_token": "..." }
```

- 算法：`dir` + `A256GCM`
- 密钥分发：K8s Secret / Vault / AWS KMS
- 优势：实现简单，性能高

### 7.2 跨组织 OAuth 用户信息交换

```text
IdP ──JWE(RSA-OAEP-256+A256GCM)──> RP
   └─ RP 公钥注册到 IdP 的 JWKS
   └─ payload: { "sub": "...", "email": "...", "phone": "..." }
```

- 算法：`RSA-OAEP-256` + `A256GCM`
- 密钥分发：JWKS Endpoint（`/.well-known/jwks.json`）
- 优势：RP 私钥不离开本地，IdP 只需 RP 公钥即可加密

### 7.3 端到端加密消息

```text
客户端 A ──JWE(ECDH-ES+A256KW)──> 客户端 B
   └─ A 用 B 的 EC 公钥 + A 的临时私钥 ECDH 派生密钥
   └─ payload: { "msg": "..." }
```

- 算法：`ECDH-ES+A256KW` + `A256GCM`
- 密钥分发：用户公钥发布到目录服务
- 优势：前向保密，即使 A 的私钥泄露，历史消息仍安全

### 7.4 加密备份文件

```text
用户 ──JWE(PBES2-HS512+A256KW+A256GCM)──> 备份文件
   └─ 密码派生 KEK，包装 CEK
   └─ payload: 配置/私钥/凭证数据
```

- 算法：`PBES2-HS512+A256KW` + `A256GCM`
- 密钥：用户密码（迭代次数 ≥100,000）
- 优势：用户无需管理密钥文件

### 7.5 HIPAA 合规医疗数据

```text
医院 A ──JWS+JWE 嵌套──> 医院 B
   └─ JWS 验证医院 A 签名
   └─ JWE 加密患者病历
```

- 算法：JWS(ES256) + JWE(ECDH-ES+A256GCM)
- 密钥：医院 EC 密钥对（签名）+ 接收方 EC 公钥（加密）
- 优势：合规审计（可追溯签发方）+ 患者隐私保护

## 八、常见踩坑与安全清单

### 8.1 常见踩坑

| 踩坑 | 描述 | 规避 |
|------|------|------|
| 用 `RSA1_5` 算法 | 存在 Bleichenbacher padding oracle 攻击风险 | 改用 `RSA-OAEP-256` 或 `ECDH-ES` |
| PBES2 迭代次数过低 | 暴力破解易还原密码 | 迭代次数 ≥100,000，OWASP 2023 建议 ≥600,000 |
| 用 `none` 算法 | 「无加密」JWE，等同于明文传输 | 永远禁用 `none`，alg 必须是具体算法 |
| 复用 IV | 同一密钥下 IV 重复，AEAD 安全性归零 | 每次加密生成新随机 IV |
| Protected Header 被修改 | AAD 包含 Protected Header，修改会导致认证标签失败 | 不要手动修改 JWE 字符串 |
| 不验证 enc 字段 | 攻击者改 enc 为弱算法 | 解密前校验 enc 在白名单内 |
| 公钥分发不验证 | 中间人攻击替换公钥 | 通过 JWKS + HTTPS + 证书 pinning 验证 |
| 密钥硬编码 | 密钥泄露后无法轮换 | 密钥管理服务（KMS / Vault）+ 定期轮换 |

### 8.2 JWE 安全清单

- ✅ alg 不为 `none`，不为 `RSA1_5`
- ✅ enc 为 `A128GCM` / `A192GCM` / `A256GCM`（避免 CBC+HMAC）
- ✅ PBES2 迭代次数 ≥100,000
- ✅ ECDH-ES 曲线为 P-256 / P-384 / P-521
- ✅ 密钥通过 KMS / Vault 管理，支持轮换
- ✅ IV 每次随机生成，不复用
- ✅ Protected Header 不被修改
- ✅ 敏感字段加密前不写入日志
- ✅ 长时效 token 用 ECDH-ES 提供前向保密
- ✅ 跨组织通信走 JWKS + HTTPS

## 九、与工具矩阵的协同

JWE 不是孤立的工具，它与加密哈希矩阵的其他工具形成完整工作流：

| 协同场景 | 工具组合 | 工作流 |
|---------|---------|--------|
| JWT 三件套调试 | [JWT 解码](/jwt) + [JWT 签名](/jwt-sign) + [JWT 验签](/jwt-verify) + [JWE 解码](/jwe) | 一个 JWE 内可能嵌套 JWS，需多工具链式分析 |
| 密钥派生与哈希 | [Hash 计算](/hash) + [JWE 解码](/jwe) | PBES2 算法用 PBKDF2 派生密钥，依赖 SHA-256/384/512 |
| 密码生成与强度评估 | [密码生成器](/password) + [密码哈希](/password-hash) + [JWE 解码](/jwe) | PBES2 场景需强密码，bcrypt/PBKDF2 提供哈希基础 |
| UUID 与令牌 ID | [UUID 生成器](/uuid) + [JWE 解码](/jwe) | JWE 的 `kid` 字段常配 UUID 作为密钥 ID |
| AES 加解密 | [AES 加解密](/aes) + [JWE 解码](/jwe) | JWE 的 enc 算法底层就是 AES-GCM，可用 AES 工具对比理解 |

## 十、最佳实践清单

1. **优先选 JWS 而非 JWE**：除非确实需要保密 payload，否则 JWS 更简单、性能更高
2. **JWE 的 enc 必须是 AEAD**：永远用 A128GCM/A192GCM/A256GCM，避免 CBC+HMAC
3. **alg 选 ECDH-ES 或 RSA-OAEP-256**：避免 `RSA1_5` 与 `none`
4. **PBES2 迭代次数 ≥100,000**：用户密码场景务必提高迭代次数
5. **IV 每次随机生成**：永远不重用 IV，AEAD 安全性依赖 IV 唯一性
6. **嵌套令牌仅在必要时使用**：JWS+JWE 性能开销大，仅在合规审计要求时使用
7. **密钥通过 KMS 管理**：避免硬编码，支持轮换
8. **公钥分发走 JWKS + HTTPS**：避免中间人攻击
9. **长时效 token 用 ECDH-ES**：提供前向保密，即使私钥泄露历史 token 仍安全
10. **JWE 调试走本地工具**：[本站 JWE 解码工具](/jwe) 全本地处理，密钥不离开浏览器，适合调试真实业务 token

## 总结

JWE 与 JWT 不是对立关系，而是 JWT 的两种实现方式之一：

- **JWT 是统称**，规定声明（claims）的编码方式
- **JWS 是签名令牌**（三段式），防篡改，payload 可读
- **JWE 是加密令牌**（五段式），防查看，payload 加密
- **何时用 JWE**：需保密 payload、需向前保密、合规要求加密
- **何时用 JWS**：内容可公开、仅需防篡改、性能敏感场景

理解 JWE 的关键是认清五段加密流程：**alg 加密 CEK → enc 用 CEK 加密 payload → AEAD 生成认证标签**。这一架构让 JWE 在不依赖单独签名的情况下，同时提供机密性与完整性。

下一步动手实操：访问 [JWE 解码工具](/jwe)，点击「载入 PBES2 示例」按钮（密码自动填入），点击「解密」即可看到完整的 PBES2 + AES-KW + AES-GCM 解密链路。也可点击「载入 ECDH-ES 示例」体验椭圆曲线协商解密。
