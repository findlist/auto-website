---
title: "SHA-256 哈希计算原理与应用：从密码存储到完整性校验"
description: "系统讲解哈希函数的核心特性、SHA 系列算法差异、JavaScript SubtleCrypto API 实战、密码存储与加盐最佳实践，以及 MD5 为何被弃用。涵盖文件校验、数字签名等实际应用场景。"
pubDate: 2026-07-03
tags: ["SHA-256", "哈希", "加密", "Web Crypto"]
relatedTool: "/hash"
---

## 哈希函数是什么

**哈希函数**（Hash Function）是一种将任意长度输入转换为固定长度输出的单向函数。输出称为**哈希值**、**摘要**或**指纹**。以 SHA-256 为例，无论输入是 1 字节还是 1 GB，输出都是 64 个十六进制字符（256 位）：

```
SHA-256("hello") = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
SHA-256("Hello") = "185f8db32271fe25f561a6fc938b2e264306ec304eda518007d1764826381969"
```

注意仅一个字符大小写不同，输出就完全不同——这叫**雪崩效应**。

## 哈希函数的核心特性

| 特性 | 说明 |
|------|------|
| **确定性** | 相同输入永远产生相同输出 |
| **单向性** | 无法从哈希值反推出原始输入 |
| **固定长度** | 输出长度与输入无关 |
| **雪崩效应** | 输入微小变化导致输出完全不同 |
| **抗碰撞** | 难以找到两个不同输入产生相同输出 |

> **关键区分**：哈希不是加密。加密是双向的（可解密），哈希是单向的（不可逆）。哈希用于**验证完整性**和**存储摘要**，不用于保密。

## SHA 系列算法

SHA（Secure Hash Algorithm）是美国国家标准与技术研究院（NIST）发布的哈希函数家族：

| 算法 | 输出长度 | 安全性 | 状态 |
|------|----------|--------|------|
| MD5 | 128 位 | 已破解 | ❌ 弃用 |
| SHA-1 | 160 位 | 已破解 | ❌ 弃用 |
| SHA-256 | 256 位 | 安全 | ✅ 推荐 |
| SHA-384 | 384 位 | 安全 | ✅ 可用 |
| SHA-512 | 512 位 | 安全 | ✅ 可用 |
| SHA-3 | 224-512 位 | 安全 | ✅ 新一代 |

### 为什么 MD5 和 SHA-1 被弃用

- **MD5**：1996 年发现碰撞漏洞，2004 年中国学者王小云公布快速碰撞算法，现可在几秒内伪造碰撞
- **SHA-1**：2017 年 Google 公布 SHAttered 攻击，可在合理时间内构造碰撞

二者均已不满足安全要求，**禁止用于安全敏感场景**。但在非安全场景（如文件去重、缓存键）仍可使用。

### SHA-256 vs SHA-512

二者同属 SHA-2 家族，安全性相当。选择依据：

- **SHA-256**：通用首选，32 位 CPU 优化，资源占用较低
- **SHA-512**：64 位 CPU 上更快，常用于加密货币（如比特币早期）
- **SHA-384**：截断版 SHA-512，部分合规场景要求

## JavaScript 中的哈希计算

### SubtleCrypto API（推荐）

现代浏览器内置 `crypto.subtle.digest`，支持 SHA-1/256/384/512，无需任何第三方库：

```javascript
async function sha256(message) {
  // 将字符串编码为 UTF-8 字节
  const bytes = new TextEncoder().encode(message);
  // 计算哈希，返回 ArrayBuffer
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  // 转换为十六进制字符串
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

await sha256('hello');
// "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
```

### 输出格式：HEX vs Base64

哈希结果通常以两种格式输出：

```javascript
const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);

// HEX 格式：64 个十六进制字符，长度固定 128
const hex = Array.from(new Uint8Array(hashBuffer))
  .map((b) => b.toString(16).padStart(2, '0'))
  .join('');

// Base64 格式：44 个字符（含填充），更紧凑
const base64 = btoa(
  String.fromCharCode(...new Uint8Array(hashBuffer))
);
```

| 格式 | 长度（SHA-256） | 可读性 | 适用场景 |
|------|-----------------|--------|----------|
| HEX | 64 字符 | 高 | 校验和、文档展示 |
| Base64 | 44 字符 | 低 | API 传输、紧凑存储 |

### 安全上下文要求

`crypto.subtle` 仅在**安全上下文**（HTTPS 或 localhost）中可用。HTTP 站点会得到 `undefined`。这是浏览器安全策略，无法绕过。

## 密码存储与加盐

**永远不要明文存储用户密码**，也不要仅用哈希存储——**彩虹表攻击**可批量反查常见密码的哈希。

### 加盐（Salt）

为每个密码生成一个随机**盐值**，与密码拼接后再哈希：

```javascript
async function hashPassword(password) {
  // 生成 16 字节随机盐
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bytes = new TextEncoder().encode(password + String.fromCharCode(...salt));
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return { salt, hash: new Uint8Array(hashBuffer) };
}
```

盐的作用：让相同密码产生不同哈希，使彩虹表失效。

### 为什么 SHA-256 不够：慢哈希

普通 SHA-256 计算极快，GPU 每秒可尝试数十亿次。密码存储应使用**慢哈希函数**：

- **PBKDF2**：基于 HMAC 的迭代哈希，浏览器原生支持
- **bcrypt**：专门为密码设计的慢哈希
- **Argon2**：2015 年密码哈希竞赛冠军，抗 GPU/ASIC

```javascript
// PBKDF2 示例：10 万次迭代
async function hashPasswordPBKDF2(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000, // 迭代次数，越高越安全但越慢
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return { salt, hash: new Uint8Array(hash) };
}
```

## 哈希的实际应用场景

### 1. 文件完整性校验

下载大文件后比对哈希，确保未损坏或被篡改：

```bash
# Linux 校验 ISO 镜像
sha256sum ubuntu-24.04.iso
# 对比官方公布的 SHA-256 值
```

### 2. Git 提交标识

Git 的 commit ID 就是文件树内容的 SHA-1 哈希（新版 Git 已支持 SHA-256）。

### 3. 区块链

比特币区块的链接、工作量证明都依赖 SHA-256 哈希。

### 4. 数字签名

对文档哈希而非原文签名，提升性能（哈希固定长度且小）。

### 5. 缓存键

用 URL 或参数的哈希作为缓存键，避免长字符串比较。

### 6. 内容寻址

IPFS、Git 等系统用内容哈希作为唯一标识，实现去重与完整性验证。

## 常见误区

| 误区 | 纠正 |
|------|------|
| 哈希是加密 | 哈希不可逆，不是加密 |
| MD5 还能用 | 安全场景已弃用，仅限非安全用途 |
| SHA-256 可存密码 | 速度太快，应用 PBKDF2/bcrypt/Argon2 |
| 哈希能去重 | 不同内容可能碰撞（概率极低），关键场景需双重校验 |
| 加盐等于安全 | 盐值需随机且唯一，但仍需慢哈希抵御暴力破解 |

## 总结

- 哈希是**单向、固定长度、抗碰撞**的函数，不是加密
- 安全场景使用 SHA-256 及以上，**禁用 MD5 和 SHA-1**
- 浏览器用 `crypto.subtle.digest` 原生计算，无需第三方库
- 密码存储必须**加盐 + 慢哈希**（PBKDF2/bcrypt/Argon2）
- 哈希用于完整性校验、内容寻址、数字签名等场景

想要快速计算 SHA 哈希？试试我们的 [Hash 在线工具](/hash)，支持 SHA-1/256/384/512，HEX 与 Base64 双格式输出，所有数据在浏览器本地处理，零上传零追踪。
