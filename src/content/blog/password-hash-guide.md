---
title: "密码哈希深度指南：bcrypt 与 PBKDF2 的实现原理与对比"
description: "系统讲解密码哈希的设计原理：单向函数特性、盐值防彩虹表、bcrypt 的 cost 因子与 Blowfish 改造、PBKDF2 的 HMAC 迭代与 Web Crypto API 实现、两种算法的安全性与性能对比，以及 OWASP 2023 选型建议。帮助开发者理解密码存储的底层机制并做出正确的算法选型。"
pubDate: 2026-07-12
tags: ["密码哈希", "bcrypt", "PBKDF2", "Web Crypto", "安全", "加密", "工具矩阵"]
relatedTool: "/password-hash"
---

## 密码哈希的核心原理

密码哈希是用户认证系统的基石——它将明文密码转换为不可逆的固定长度字符串，即使数据库泄露，攻击者也无法直接还原密码。但密码哈希与普通哈希（如 SHA-256 用于文件校验）有本质区别。

> 配套工具：[密码哈希工具](/password-hash)

### 为什么不能用普通哈希？

普通哈希函数（MD5、SHA-1、SHA-256）有三点不适合密码存储：

1. **速度太快**：SHA-256 单次计算约 0.001ms，GPU 每秒可计算数十亿次，密码可被快速暴力枚举
2. **无盐机制**：相同密码永远得到相同哈希，易受彩虹表攻击（预先计算常见密码的哈希表）
3. **无成本调节**：硬件升级后无法提升计算成本，安全性随时间贬值

密码哈希算法（bcrypt、PBKDF2、scrypt、Argon2）专门针对这三点设计：**刻意变慢**、**内置盐**、**可调节成本**。

### 单向函数与盐

密码哈希的核心是**单向函数**——正向计算容易，逆向还原不可行。即使知道哈希值与算法，也无法反推出原密码，只能通过「枚举候选密码 → 计算哈希 → 比对」的暴力方式破解。

**盐（salt）** 是哈希前拼接的随机字节串，作用是让相同密码每次哈希得到不同结果：

```
密码 "password123" + 盐A → $2a$12$abc...xyz   (哈希A)
密码 "password123" + 盐B → $2a$12$def...uvw   (哈希B)
```

盐本身不是密钥，可以公开存储（嵌入在哈希串中）。它的价值在于：

- 让彩虹表失效（每个盐都需要单独计算）
- 让相同密码的用户得到不同哈希（无法批量识别）
- 强制攻击者针对每个哈希单独暴力枚举

## bcrypt：基于 Blowfish 的密码哈希

bcrypt 由 Niels Provos 和 David Mazières 于 1999 年设计，核心思想是**改造 Blowfish 加密算法使其变慢**。

### 算法结构

bcrypt 的计算流程：

1. **盐生成**：128 位（16 字节）密码学安全随机数
2. **密钥调度（EksBlowfishSetup）**：使用盐与密码初始化 Blowfish 的 P-box 和 S-box，迭代次数由 cost 决定
3. **加密魔术串**：对 "OrpheanBeholderScryDoubt"（24 字节）反复加密 64 次
4. **输出**：cost + 盐 + 加密结果拼接为单一字符串

```
$2a$12$abcdefghijklmnopqrstuueg5MBqZ4lAVCB1nlLmv9BpGhQaF1a2u
^^^ ^^ ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
版本 cost      22位盐(前22字符)           31位哈希(后31字符)
```

### cost 因子：可调节的计算成本

cost 是 bcrypt 的核心参数，**每加 1 计算耗时翻倍**：

| cost | 耗时（参考） | 适用场景 |
|------|------------|---------|
| 4    | ~0.1ms     | 仅测试 |
| 8    | ~3ms        | 开发调试 |
| 10   | ~50ms       | 性能敏感场景下限 |
| 12   | ~200ms      | **生产推荐下限** |
| 14   | ~1-3s       | 高安全要求 |
| 16   | ~10s        | 浏览器不可接受 |

cost 的设计哲学是**「用户可接受的最大延迟」**——登录时等待 200ms 用户无感，但攻击者暴力枚举每个密码都要 200ms，每秒仅能尝试 5 次，大幅拉低破解效率。

随着硬件进步，应每 2 年评估并提升 cost。现代 GPU（如 RTX 4090）每秒可计算约 100 万次 bcrypt cost=12，14 位小写字母密码（约 65 bits 熵）破解需 30 万年，仍属安全。

### bcryptjs 实现要点

浏览器端 bcrypt 推荐 [bcryptjs](https://www.npmjs.com/package/bcryptjs)（纯 JavaScript，~10KB），核心 API：

```typescript
import bcrypt from 'bcryptjs';

// 生成哈希
const salt = await bcrypt.genSalt(12);           // 生成盐（含 cost）
const hash = await bcrypt.hash(password, salt);  // 哈希密码

// 验证（自动从 hash 中提取盐与 cost）
const ok = await bcrypt.compare(password, hash);
```

**注意事项**：

- `genSaltSync` 内部使用 `Math.random`，但 bcrypt 的盐本身不要求密码学强度（盐的唯一性已足够）
- `hashSync` 与 `compareSync` 是**同步阻塞**的，cost=12 会阻塞主线程约 200ms。UI 需先切到 loading 状态再执行
- bcrypt 密码长度上限 72 字节（Blowfish 的块大小限制），超出部分被截断

## PBKDF2：HMAC 迭代派生

PBKDF2（Password-Based Key Derivation Function 2）由 RSA Laboratories 于 2000 年标准化（RFC 2898），核心思想是**对 HMAC 重复迭代**。

### 算法结构

PBKDF2 的计算流程：

1. **盐生成**：16 字节密码学安全随机数
2. **HMAC 迭代**：用密码作为 HMAC 密钥，对盐反复迭代计算
3. **输出拼接**：迭代结果按目标长度拼接

```
U_1 = HMAC(password, salt || 0x00000001)
U_2 = HMAC(password, U_1)
U_3 = HMAC(password, U_2)
...
U_n = HMAC(password, U_{n-1})
输出 = U_1 ⊕ U_2 ⊕ U_3 ⊕ ... ⊕ U_n
```

每次迭代是一次 HMAC（即两次底层哈希），迭代数 n 决定总成本。100,000 次迭代 = 200,000 次哈希计算。

### Web Crypto API 实现

PBKDF2 是 Web Crypto API 原生支持的算法，零依赖实现：

```typescript
async function pbkdf2Hash(
  password: string,
  iterations: number,
  hashName: 'SHA-256' | 'SHA-512',
): Promise<string> {
  // 1. 生成盐
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  // 2. 导入密码作为密钥素材
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );

  // 3. 派生哈希位
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: hashName },
    keyMaterial,
    (hashName === 'SHA-256' ? 32 : 64) * 8,  // 输出字节数
  );

  // 4. 编码为标准格式
  const saltBase64 = encodeBase64(salt);
  const hashBase64 = encodeBase64(new Uint8Array(derivedBits));
  return `pbkdf2$${iterations}$${hashName}$${saltBase64}$${hashBase64}`;
}
```

Web Crypto API 由浏览器底层 C++ 实现，性能远高于纯 JavaScript 版本（约 5-10 倍）。100,000 次 SHA-256 迭代约 50ms，完全异步不阻塞主线程。

### 标准化哈希格式

本工具采用的可读格式：

```
pbkdf2$<iterations>$<hashName>$<saltBase64>$<hashBase64>
```

例如：`pbkdf2$100000$SHA-256$wHZS9xnmaTCrhjvBxQ9T3w==$lUfRw1i1Lv0lLBJCNIYq1w==`

各字段含义：

- **iterations**：迭代次数（如 100000）
- **hashName**：底层哈希函数（SHA-256 或 SHA-512）
- **saltBase64**：16 字节盐的 Base64 编码（24 字符含填充）
- **hashBase64**：派生哈希的 Base64 编码（SHA-256 输出 32 字节 = 44 字符；SHA-512 输出 64 字节 = 88 字符）

验证时解析该格式并使用相同参数重新派生，**常数时间比对**避免时序侧信道：

```typescript
// 常数时间比较：逐字节 XOR 后再判断
let diff = 0;
for (let i = 0; i < actualBytes.length; i++) {
  diff |= actualBytes[i] ^ expectedBytes[i];
}
// 长度不等时也要走完整比较流程，避免长度泄漏
if (actualBytes.length !== expectedBytes.length) diff = 1;
const ok = diff === 0;
```

## bcrypt vs PBKDF2：如何选型？

### 安全性对比

| 维度 | bcrypt | PBKDF2 |
|------|--------|--------|
| 标准化 | 无正式标准（事实标准） | RFC 2898 / PKCS#5 v2.0 |
| 抗 GPU 加速 | **强**（依赖大量内存访问） | 弱（HMAC 易并行） |
| 抗 ASIC 加速 | 强 | 弱 |
| 盐机制 | 内置 128 位盐 | 需调用方管理 |
| 成本调节 | cost 因子（每加 1 翻倍） | 迭代数（线性） |
| 长度限制 | 72 字节截断 | 无限制 |
| 时序侧信道 | 比较时需注意 | 比较时需注意 |

### 性能对比（浏览器环境）

- **bcrypt cost=12**：约 200-400ms（bcryptjs 纯 JS）
- **PBKDF2-SHA256 100k 迭代**：约 50ms（Web Crypto 原生）
- **PBKDF2-SHA512 100k 迭代**：约 100ms

bcrypt 的纯 JS 实现比 PBKDF2 的原生实现慢 4-8 倍，但 bcrypt 的算法设计本身对 GPU 加速攻击的抵抗力更强。

### OWASP 2023 选型建议

OWASP（Open Web Application Security Project）2023 年密码存储备忘录的优先级排序：

1. **Argon2id**（首选）：PHC 2015 冠军，抗 GPU/ASIC，需 WASM 库
2. **scrypt**（次选）：抗内存攻击，需第三方库
3. **bcrypt**（第三）：抗 GPU，成熟稳定，广泛支持
4. **PBKDF2**（末选）：仅当无法使用上述三者时

**具体参数建议**：

- bcrypt：cost ≥ 12（OWASP 最低）
- PBKDF2-SHA-256：迭代数 ≥ 600,000
- PBKDF2-SHA-512：迭代数 ≥ 210,000
- Argon2id：m=19456KB（19MB），t=2，p=1

本工具默认值（bcrypt cost=12、PBKDF2-SHA-256 100k 迭代）符合 OWASP 推荐范围，PBKDF2 用户可手动调到 600k 迭代以完全达标。

## 浏览器端实现的关键技术点

### CSPRNG 盐生成

盐必须使用密码学安全随机数生成器，避免 `Math.random`：

```typescript
function generateSalt(bytes: number): Uint8Array {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);  // 浏览器原生 CSPRNG
  return arr;
}
```

`crypto.getRandomValues` 基于操作系统的随机源（Linux `/dev/urandom`、Windows `CryptGenRandom`），输出满足密码学强度要求。

### bcrypt 的阻塞问题

bcryptjs 是纯 JavaScript 实现，`hashSync` 会完全阻塞主线程。cost=12 约 200ms，期间页面无法响应任何交互。

解决方案：**用 setTimeout 让浏览器先渲染 loading 状态再执行阻塞计算**：

```typescript
function hashBcrypt(password: string, cost: number): Promise<HashResult> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        const start = performance.now();
        const salt = bcrypt.genSaltSync(cost);
        const hash = bcrypt.hashSync(password, salt);
        resolve({ hash, durationMs: performance.now() - start, ... });
      } catch (err) {
        reject(err);
      }
    }, 0);  // 让 UI 先刷新到 loading 状态
  });
}
```

PBKDF2 通过 Web Crypto API 完全异步，不存在此问题。

### 哈希格式识别

验证时根据哈希前缀自动识别算法：

- `$2a$` / `$2b$` / `$2y$` 开头 → bcrypt
- `pbkdf2$` 开头 → PBKDF2

避免用户手动切换算法，降低误操作风险。

## 实际应用场景

### 1. 学习与教育

- 理解密码哈希与普通哈希的区别
- 对比不同算法的性能与输出格式
- 验证盐对哈希结果的影响（同一密码每次结果不同）

### 2. 开发调试

- 本地调试认证系统时无需启动后端服务即可生成测试哈希
- 验证第三方库（如 Django、Passlib、bcrypt-nodejs）输出的哈希格式
- 对比不同 cost / 迭代数下的耗时，决定生产参数

### 3. 安全审计

- 验证已泄露的密码哈希是否能正确比对（仅限合规安全研究）
- 检查存储的哈希是否符合 OWASP 推荐参数
- 评估 cost 提升后系统的响应时间影响

### 4. 算法对比研究

- 同一密码在 bcrypt 与 PBKDF2 下的哈希长度差异
- 不同 cost 下的耗时曲线（指数增长）
- 不同迭代数下的耗时曲线（线性增长）

### 5. 密码强度感知

通过观察哈希耗时，间接感受密码强度——这不是安全建议，但能帮助理解「即使是 bcrypt，弱密码仍会被快速破解」。bcrypt 的 cost 只能拉慢单次哈希速度，无法阻止针对弱密码的字典攻击。

## 与其他工具的协同

本工具在「加密哈希」类别中与以下工具形成互补：

- **[密码生成器](/password)**：生成强密码 → 用本工具哈希存储
- **[Hash 计算工具](/hash)**：对文件/文本计算 SHA-1/256/512 摘要（普通哈希，非密码哈希）
- **[AES 加解密](/aes)**：对称加密（可逆），与密码哈希（不可逆）互补
- **[JWT 签名生成器](/jwt-sign)**：基于 HMAC/RSA 的令牌签名，与密码哈希同属密码学应用

完整的用户认证流程：生成强密码 → 哈希存储 → 登录时验证 → 颁发 JWT 令牌 → 后续请求携带 JWT。

## 安全提醒

本工具面向**学习、调试、对比算法**等场景，不应用于：

- 生产环境密钥管理（推荐服务端使用 Argon2id）
- 生成真实用户密码的哈希（建议在服务端完成）
- 替代专业密码管理器

密码与哈希全程在浏览器本地处理，不发送到任何服务器，不记录、不上传。页面关闭后所有数据从内存清除。生产环境的密码存储应使用服务端库（Node.js 的 bcrypt/argon2、Python 的 passlib、Go 的 golang.org/x/crypto/bcrypt），它们的性能与安全性都优于浏览器端实现。
