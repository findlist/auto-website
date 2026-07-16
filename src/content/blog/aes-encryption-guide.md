---
title: "AES 加密实战：从 GCM 认证加密到 PBKDF2 密钥派生的完整指南"
description: "系统讲解 AES 对称加密：GCM/CBC/CTR 三种工作模式、认证加密原理、padding oracle 防御、IV/Nonce 管理与 PBKDF2 密码派生、Web Crypto API 实现与服务端代码示例，附加解密工具实操。"
pubDate: 2026-07-08
tags: ["AES", "加密", "对称加密", "AES-GCM", "AES-CBC", "AES-CTR", "PBKDF2", "Web Crypto API", "认证加密", "安全", "密码学", "IV"]
relatedTool: "/aes"
---

## AES：现代加密的基石

AES（Advanced Encryption Standard）是美国 NIST 于 2001 年发布的对称分组密码标准，取代了旧的 DES。作为对称加密算法，它使用**同一把密钥**进行加密与解密，分组长度固定 128 位（16 字节），密钥长度可为 128/192/256 位。

经过二十余年公开密码学界的全面审查，AES 无已知实用攻击方法。它是当今应用最广泛的加密算法——HTTPS（TLS）、Wi-Fi（WPA2/WPA3）、磁盘加密（BitLocker/FileVault）、数据库加密、JWT/JWE 内容加密等场景几乎都建立在 AES 之上。

理解 AES 的关键不在其内部 S 盒与轮函数（那是密码学家的领域），而在于**工作模式**、**密钥管理**与**IV 处理**这三件工程实践。本文聚焦这三点，配合[在线 AES 加解密工具](/aes)实操。

## 三种工作模式对比：GCM vs CBC vs CTR

AES 是分组密码，每次只处理 16 字节，需要「工作模式」来处理任意长度数据。三种主流模式对比如下：

| 模式 | 全称 | 填充 | 认证 | IV 要求 | 并行 | 推荐度 |
|------|------|------|------|---------|------|--------|
| **GCM** | Galois/Counter Mode | 不需要 | ✅ 内置认证标签 | 12 字节，**绝不重复** | 加密可并行 | ⭐⭐⭐ 首选 |
| **CBC** | Cipher Block Chaining | PKCS#7 | ❌ 无 | 16 字节，不可预测 | 不可并行 | ⚠️ 需配合 HMAC |
| **CTR** | Counter Mode | 不需要 | ❌ 无 | 16 字节计数器，**绝不重复** | 加解密均可并行 | ⚠️ 谨慎管理计数器 |

### GCM：认证加密的现代标准

GCM 将 CTR 模式的流加密与 GHASH 认证算法结合，在加密的同时生成 16 字节**认证标签**（Authentication Tag）。解密时重新计算标签并比对，若密文被篡改哪怕 1 位，标签不匹配，解密直接失败。

这意味着 GCM 提供**机密性 + 完整性**双重保障——攻击者既无法读取明文，也无法篡改密文而不被发现。这是现代加密的黄金标准，TLS 1.3、JWE 内容加密层默认使用 AES-GCM。

### CBC：传统模式的安全陷阱

CBC 通过「前一块密文 XOR 后一块明文」实现链式加密，需 PKCS#7 填充使明文为 16 字节倍数。它的致命弱点是**无认证能力**——攻击者可翻转密文位，对应明文块会相应变化（malleability），且不会报错。这催生了 padding oracle 攻击。

### CTR：高性能流模式

CTR 将计数器加密后与明文 XOR，本质是流密码。无需填充，加解密均可并行，性能极高。但 IV/计数器**绝不可重复使用**——否则两次密文 XOR 会抵消密钥流，直接得到两段明文的 XOR，灾难性泄露明文。

## 认证加密：为什么 GCM 是现代首选

**认证加密**（Authenticated Encryption）同时提供机密性（加密）与完整性（认证），是现代密码学的推荐方案。GCM 是其中最流行的实现，此外还有 ChaCha20-Poly1305、AES-CCM 等。

认证加密的价值在于**防篡改**。没有认证的加密（如裸 CBC/CTR）是脆弱的：

- **CBC 的 malleability**：翻转密文第 N 块的第 K 位，解密后第 N+1 块明文的第 K 位会相应翻转，攻击者可定向修改明文
- **CTR 的 malleability**：翻转密文位，对应明文位直接翻转，攻击者可精确篡改明文内容

GCM 的认证标签覆盖密文与可选的 AAD（附加认证数据），任何篡改都会导致标签不匹配，解密失败。这就是为什么 TLS 1.3 强制使用 AEAD（GCM 或 ChaCha20-Poly1305）。

在本站的 [AES 工具](/aes)中，GCM 模式的认证标签由 Web Crypto API 自动生成与校验——加密时附加到密文末尾，解密时自动验证，对用户透明。

## padding oracle 攻击：CBC 的致命弱点

2010 年 Juliano Rizzo 和 Thai Duong 公开的 padding oracle 攻击，是针对 CBC 模式的经典侧信道攻击，曾攻破 ASP.NET、Java EE 等主流框架。

**攻击原理**：CBC 解密时需去除 PKCS#7 填充。若服务端对「填充错误」与「内容错误」返回不同响应（不同错误码或响应时间），攻击者可构造特殊密文块，通过逐字节试探判断填充是否正确，进而**逐字节恢复明文，无需知道密钥**。

完整攻击流程：
1. 攻击者构造密文 `C' || C_target`（C' 为可控块，C_target 为目标块）
2. 修改 C' 的最后一字节，提交解密
3. 若服务端返回「填充错误」，继续尝试下一字节值；若返回「内容错误」，说明填充正确（末字节为 0x01）
4. 据此推导出中间值 `I = C' XOR P`，进而恢复明文 `P = I XOR C_prev`
5. 逐块推进，恢复全部明文

**防御措施**：
- **优先用 GCM**（内置认证，篡改即失败，无 padding 暴露）
- 若必须用 CBC，采用**加密-然后-MAC**：先 CBC 加密，再对 `(IV || ciphertext)` 计算 HMAC-SHA256，解密前先验 MAC，MAC 不符直接拒绝，不暴露 padding 校验结果
- 统一错误响应（填充错误与内容错误返回相同信息）

本工具的 CBC 模式仅用于教学对比，生产环境请用 GCM 或 CBC+HMAC。

## IV/Nonce 管理：随机性与唯一性的平衡

IV/Nonce 是每次加密使用的随机值，作用是让相同明文在相同密钥下产生不同密文。不同模式对 IV 的要求不同：

| 模式 | IV 长度 | 核心要求 | 重复后果 |
|------|---------|----------|----------|
| GCM | 12 字节 | **绝不重复**（计数器+随机） | 认证密钥泄露，可伪造密文 |
| CBC | 16 字节 | 不可预测（随机即可） | 暴露明文前缀 XOR |
| CTR | 16 字节 | **绝不重复**（计数器唯一） | 明文 XOR 抵消，灾难性泄露 |

**GCM 的 IV 重复是致命的**：若同一密钥下两次加密使用相同 Nonce，攻击者可恢复 GHASH 认证密钥 H，进而对任意密文伪造有效标签，绕过认证。这就是为什么 GCM 的 Nonce 必须严格唯一——通常用 12 字节随机值（碰撞概率极低）或计数器+随机数组合。

**CTR 的 IV 重复同样致命**：两次加密使用相同密钥+计数器，产生相同密钥流，两段密文 XOR 后密钥流抵消，得到两段明文的 XOR。若攻击者知道其中一段明文，可直接恢复另一段。

**最佳实践**：
- 每次加密用 `crypto.getRandomValues` 生成全新随机 IV
- IV 不需要保密，可随密文传输（常见格式：`iv || ciphertext`）
- GCM 单密钥下加密次数不应超过 2<sup>32</sup>（避免 Nonce 碰撞）
- 高吞吐场景用计数器+随机数组合（计数器保证唯一，随机数防预判）

本 [AES 工具](/aes)每次加密自动生成随机 IV，无需手动管理。

## 密钥长度选择：128 vs 192 vs 256

AES 三种密钥长度的区别：

| 长度 | 轮数 | 暴力破解复杂度 | 量子安全（Grover） | NSA Suite B |
|------|------|----------------|---------------------|-------------|
| AES-128 | 10 轮 | 2<sup>128</sup> | 2<sup>64</sup>（边缘安全） | ✅ 机密级 |
| AES-192 | 12 轮 | 2<sup>192</sup> | 2<sup>96</sup>（安全） | ❌ 不推荐 |
| AES-256 | 14 轮 | 2<sup>256</sup> | 2<sup>128</sup>（安全） | ✅ 绝密级 |

**实际安全性差异在当前算力下均可忽略**——暴力破解 AES-128 需约 3.4×10<sup>38</sup> 次运算，远超全球算力总和。AES-256 的优势在于**抗量子攻击**（Grover 算法将有效安全性减半，256→128 仍安全）。

**选型建议**：
- 默认 **AES-256**：满足绝大多数场景，抗量子，符合合规要求
- 性能敏感（海量数据加密）：**AES-128**，速度快约 40%
- AES-192 较少使用：不在 NSA Suite B 推荐中，库支持不如 128/256 普遍

密钥长度不影响 IV 大小（GCM 始终 12 字节，CBC/CTR 始终 16 字节）。

## PBKDF2 密码派生：从口令到密钥

直接用人类密码当 AES 密钥有两个问题：① 密码长度通常不足 16/32 字节；② 密码熵低（易被字典/暴力破解）。**PBKDF2**（RFC 2898）通过加盐+高速迭代的 HMAC 解决这两个问题。

### 工作原理

```
DK = PBKDF2(password, salt, iterations, keyLength)
    = T1 || T2 || ... || Tn
其中 Ti = U1 ⊕ U2 ⊕ ... ⊕ Uc
     U1 = HMAC(password, salt || i)
     U2 = HMAC(password, U1)
     ...
     Uc = HMAC(password, Uc-1)
```

- **盐（Salt）**：随机 16 字节，防止彩虹表攻击——相同密码因盐不同派生出不同密钥
- **迭代次数**：重复 HMAC 数万至数十万次，让每次派生都「昂贵」，攻击者暴力破解成本同等放大，而单次用户登录的延迟可接受（~100ms）

### 迭代次数建议

| 标准 | 推荐迭代次数（SHA-256） | 单次耗时（参考） |
|------|-------------------------|------------------|
| OWASP 2023 | ≥ 600,000 | ~300ms |
| NIST SP 800-132 | ≥ 1,000,000（高敏感） | ~500ms |
| 本工具默认 | 100,000 | ~50ms |

**注意**：迭代次数需在「用户可接受的登录延迟」与「攻击者成本」间权衡。本工具默认 100,000 兼顾演示流畅度与基础安全，生产环境建议提升至 600,000+。

### 现代替代方案

- **Argon2id**：2015 年密码哈希竞赛冠军，抗 GPU/ASIC，内存硬化，但 Web Crypto API 不支持
- **scrypt**：内存硬化，抗 ASIC，Web Crypto API 不支持
- **bcrypt**：抗 GPU，但密钥长度受限，不适合派生 AES-256 密钥

浏览器环境下 PBKDF2 是唯一原生支持的方案。若需 Argon2id，需引入 wasm 版本（如 argon2-browser）。

本 [AES 工具](/aes)支持 PBKDF2 派生：加密时自动生成盐并返回，解密时需填入相同盐与迭代次数。

## Web Crypto API 加解密实现

本工具基于 Web Crypto API（`crypto.subtle`）实现，零第三方依赖。核心代码片段：

### AES-GCM 加密

```typescript
// 生成 12 字节随机 Nonce
const iv = crypto.getRandomValues(new Uint8Array(12));
// 导入密钥
const key = await crypto.subtle.importKey(
  'raw',
  keyBytes,
  { name: 'AES-GCM' },
  false,
  ['encrypt', 'decrypt'],
);
// 加密（认证标签自动附加到密文末尾，共 16 字节）
const cipherBuf = await crypto.subtle.encrypt(
  { name: 'AES-GCM', iv },
  key,
  new TextEncoder().encode(plaintext),
);
// cipherBuf 末尾 16 字节即认证标签
```

### AES-CTR 加密（注意 counter 参数）

```typescript
// CTR 模式需用 counter + length，而非 iv
const counter = crypto.getRandomValues(new Uint8Array(16));
const cipherBuf = await crypto.subtle.encrypt(
  { name: 'AES-CTR', counter, length: 32 }, // length 为计数器位长度
  key,
  data,
);
```

### PBKDF2 密钥派生

```typescript
// 先导入密码为 PBKDF2 基密钥
const baseKey = await crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(password),
  { name: 'PBKDF2' },
  false,
  ['deriveKey'],
);
// 派生 AES 密钥
const aesKey = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
  baseKey,
  { name: 'AES-GCM' },
  false, // 不可导出，更安全
  ['encrypt', 'decrypt'],
);
```

Web Crypto API 的优势：原生 C/C++ 实现（性能优、常量时间算法）、密钥隔离（CryptoKey 不可导出）、通过 FIPS 认证、零依赖。注意它仅在**安全上下文**（HTTPS 或 localhost）可用。

## 加密-然后-MAC：CBC 的安全增强方案

若必须使用 CBC 模式（如兼容老系统），必须配合 HMAC 实现「加密-然后-MAC」（Encrypt-then-MAC）：

```
1. 加密：C = AES-CBC-Encrypt(K_enc, IV, P)  （K_enc 为加密密钥）
2. 签名：T = HMAC-SHA256(K_mac, IV || C)     （K_mac 为独立的 MAC 密钥）
3. 传输：(IV, C, T)
4. 解密前先验：重新计算 T'，若 T' ≠ T 直接拒绝（不执行解密）
5. 验证通过后再解密：P = AES-CBC-Decrypt(K_enc, IV, C)
```

**关键要点**：
- 使用**两把独立密钥**（K_enc 与 K_mac），切勿复用——可从主密钥用 HKDF 派生
- MAC 必须覆盖 IV + 密文（否则 IV 可被篡改）
- **先验 MAC 再解密**——若 MAC 不符，直接拒绝，不暴露 padding 校验结果（防 padding oracle）
- MAC 用常量时间比较（`crypto.subtle.verify` 或 `crypto.timingSafeEqual`）

这就是为什么 GCM 更省心——上述一切内置自动完成。本 [AES 工具](/aes)的 CBC 模式不含 HMAC（仅教学用途），生产环境请用 GCM 或自行实现 EtM。

## 服务端 AES 实战

### Node.js（原生 crypto 模块）

```javascript
const crypto = require('crypto');

// AES-256-GCM 加密
function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(12); // 12 字节 Nonce
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16 字节认证标签
  return { iv, ciphertext, tag };
}

// AES-256-GCM 解密
function decrypt(iv, ciphertext, tag, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag); // 设置认证标签，解密时自动校验
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
```

### Python（cryptography 库）

```python
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import os

# AES-256-GCM 加密
def encrypt(plaintext: str, key: bytes) -> tuple[bytes, bytes]:
    iv = os.urandom(12)  # 12 字节 Nonce
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(iv, plaintext.encode('utf-8'), None)
    return iv, ciphertext  # ciphertext 末尾含 16 字节 tag

# AES-256-GCM 解密
def decrypt(iv: bytes, ciphertext: bytes, key: bytes) -> str:
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(iv, ciphertext, None).decode('utf-8')
```

### Java（JCA）

```java
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.security.SecureRandom;

// AES-256-GCM 加密
public static byte[] encrypt(byte[] plaintext, byte[] key) throws Exception {
    byte[] iv = new byte[12];
    new SecureRandom().nextBytes(iv);
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"),
                new GCMParameterSpec(128, iv)); // 128 位标签
    byte[] ciphertext = cipher.doFinal(plaintext);
    // 拼接 iv + ciphertext（含 tag）便于传输
    byte[] output = new byte[iv.length + ciphertext.length];
    System.arraycopy(iv, 0, output, 0, iv.length);
    System.arraycopy(ciphertext, 0, output, iv.length, ciphertext.length);
    return output;
}
```

三端均推荐 GCM 模式：Node.js 用原生 crypto（零依赖）、Python 用 cryptography 库（AESGCM 一行完成）、Java 用 JCA（GCMParameterSpec 指定标签长度）。

## 常见陷阱与最佳实践

| 陷阱 | 正确做法 |
|------|----------|
| IV 重复使用（GCM/CTR） | 每次加密随机生成新 IV，用 `crypto.getRandomValues` |
| 密码直接当 AES 密钥 | 用 PBKDF2/Argon2id 派生，加盐 + 高迭代 |
| CBC 无认证 | 用 GCM，或 CBC + HMAC（加密-然后-MAC） |
| 复用同一密钥做加密与 MAC | 用 HKDF 派生两把独立密钥 |
| 密钥硬编码在代码 | 从 KMS / 环境变量 / 密钥管理服务读取 |
| GCM Nonce 用计数器但未持久化 | 计数器必须持久化，重启不能回退 |
| 密文不验 MAC 直接解密 | 先验 MAC 再解密，防 padding oracle |
| 用 ECB 模式 | 永远不要用 ECB（相同明文产生相同密文，泄露模式） |
| 用 MD5/SHA-1 派生密钥 | 用 PBKDF2/Argon2id/scrypt，不用裸哈希 |

## 工具联动与安全清单

AES 是本站**加密安全工具矩阵**的对称加密核心，与其他工具协作：

- **[AES 工具](/aes)**：对称加密任意文本（本文主角）
- **[JWE 解码](/jwe)**：JWT 格式的加密令牌，内容加密层常用 AES-GCM（A128GCM/A256GCM）
- **[JWT 签名](/jwt-sign) / [JWT 验签](/jwt-verify)**：非对称签名（RS256/ES256），与 AES 加密互补——签名防篡改，加密防窃听
- **[Hash 工具](/hash)**：SHA-256 单向摘要，用于完整性校验与 HMAC 配合
- **[密码生成器](/password)**：生成随机 AES 密钥（等价于本工具的「生成随机密钥」）

**AES 加密安全清单**：

- [ ] 选用 GCM 模式（内置认证，无需额外 MAC）
- [ ] 密钥长度 256 位（抗量子，合规）
- [ ] 每次加密随机生成 12 字节 Nonce
- [ ] 密钥用 `crypto.getRandomValues` 生成（32 字节随机）
- [ ] 人类口令用 PBKDF2 派生（≥600000 次迭代，SHA-256）
- [ ] 盐随机生成 16 字节，随密文一起保存
- [ ] 密钥从 KMS/环境变量读取，不硬编码
- [ ] 仅在 HTTPS（安全上下文）下使用 Web Crypto API
- [ ] GCM 单密钥加密次数 < 2<sup>32</sup>（防 Nonce 碰撞）
- [ ] 传输格式：`iv || ciphertext`（GCM tag 已含在 ciphertext 末尾）
- [ ] 解密失败不暴露具体原因（统一错误响应）

按此清单实践，AES 加密方案即可达到生产级安全。配合 [在线 AES 加解密工具](/aes) 实操验证，加深对每种模式与参数的理解。
