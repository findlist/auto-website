---
title: "UUID 生成原理与实践：JavaScript 中如何安全生成唯一标识符"
description: "深入解析 UUID 的版本差异、碰撞概率与 JavaScript 安全生成方案。涵盖 crypto.randomUUID、getRandomValues 降级、RFC 4122 标准及实际应用场景。"
pubDate: 2026-07-03
tags: ["UUID", "JavaScript", "Web API", "唯一标识符"]
relatedTool: "/uuid"
---

## 什么是 UUID

**UUID**（Universally Unique Identifier，通用唯一标识符）是一个 128 位的标识符，在所有空间和时间上具有极高的唯一性概率。它由 32 个十六进制数字组成，通常以连字符分隔为五组，形如：

```
550e8400-e29b-41d4-a716-446655440000
```

其标准定义在 [RFC 4122](https://datatracker.ietf.org/doc/html/rfc4122) 中。在微软生态中，它也被称为 **GUID**（Globally Unique Identifier），二者实质相同。

一个 UUID 的结构如下：

| 字段 | 位数 | 说明 |
|------|------|------|
| time_low | 32 位 | 时间戳低位 |
| time_mid | 16 位 | 时间戳中位 |
| time_hi_and_version | 16 位 | 时间戳高位 + 版本号 |
| clock_seq_hi_and_res | 8 位 | 时钟序列 + 变体标识 |
| clock_seq_low | 8 位 | 时钟序列低位 |
| node | 48 位 | 节点标识 |

其中**版本号**占 4 位，决定了 UUID 的生成方式。

## UUID 的常见版本

不同版本的 UUID 生成策略不同，适用场景也不同：

### UUID v1：基于时间戳 + MAC 地址

使用当前时间戳和机器的 MAC 地址生成。优点是具有时间顺序，可排序；缺点是暴露了硬件地址，存在隐私问题，且依赖网卡。

### UUID v3：基于命名空间 + MD5 哈希

对命名空间和名称做 MD5 哈希生成。同一输入永远产生同一输出，具有确定性。因 MD5 已不安全，现已较少使用。

### UUID v4：基于随机数

使用密码学安全的随机数生成器生成 122 位随机位。这是**最常用的版本**，实现简单，无需协调，隐私友好。本文重点讨论。

### UUID v5：基于命名空间 + SHA-1 哈希

与 v3 类似，但使用 SHA-1 替代 MD5，更安全。同样具有确定性。

### UUID v7：基于毫秒时间戳 + 随机数（新标准）

2024 年标准化，结合了 v1 的可排序性与 v4 的随机性，前 48 位为毫秒级时间戳，剩余位随机。适合需要时序排序的数据库主键场景，是未来的趋势。

## JavaScript 中生成 UUID 的方法

### 方案一：crypto.randomUUID（推荐）

现代浏览器原生提供 `crypto.randomUUID()`，直接返回一个符合 RFC 4122 v4 的 UUID 字符串：

```javascript
const uuid = crypto.randomUUID();
// "550e8400-e29b-41d4-a716-446655440000"
```

这是**最简单、最安全、最推荐**的方式。它的优势：

- 返回字符串格式规范，自带连字符
- 使用密码学安全随机源，保证唯一性
- 无需任何第三方库
- 性能优秀

**浏览器支持**：Chrome 92+、Firefox 95+、Safari 15.4+、Node.js 16.7+。截至 2026 年，覆盖率已超过 96%。

### 方案二：crypto.getRandomValues（降级方案）

对于不支持 `randomUUID` 的旧环境，可用 `getRandomValues` 手动实现：

```javascript
function generateUUID() {
  // 生成 16 字节随机数
  const bytes = crypto.getRandomValues(new Uint8Array(16));

  // 设置版本号（第 6 字节高 4 位为 0100，即 v4）
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  // 设置变体标识（第 8 字节高 2 位为 10）
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  // 转换为标准 UUID 字符串格式
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}
```

这段代码的关键在于两个位运算：

1. `bytes[6] = (bytes[6] & 0x0f) | 0x40`：清除第 6 字节高 4 位后设为 `0100`，标识版本 4。
2. `bytes[8] = (bytes[8] & 0x3f) | 0x80`：清除第 8 字节高 2 位后设为 `10`，标识 RFC 4122 变体。

### 方案三：Math.random（不推荐）

```javascript
// 危险：Math.random 不是密码学安全的！
const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
  /[xy]/g,
  (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  }
);
```

**为什么不应使用 Math.random？**

- 它基于伪随机数生成器（PRNG），输出可被预测
- 在高并发或安全敏感场景下，可能产生碰撞
- 不满足 RFC 4122 对随机性的要求
- 现代密码学场景必须使用 `crypto` API

### 生产级封装：自动降级

```javascript
function safeUUID() {
  // 优先使用原生 API
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // 降级到 getRandomValues
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    return generateUUID();
  }
  // 极端情况（如非安全上下文 http://）
  throw new Error('当前环境不支持安全随机数生成，请使用 HTTPS');
}
```

> **注意**：`crypto` API 仅在**安全上下文**（HTTPS 或 localhost）中可用。如果你的站点运行在 HTTP 上，`window.crypto` 可能不存在，需要 polyfill 或升级到 HTTPS。

## UUID v4 的碰撞概率

UUID v4 有 122 位随机性（128 位减去 4 位版本号和 2 位变体号），即 2<sup>122</sup> 种可能。这是一个天文数字：约 5.3 × 10<sup>36</sup>。

根据生日悖论，要达到 50% 的碰撞概率，需要生成约 2<sup>61</sup> 个 UUID，即 2.3 × 10<sup>18</sup> 个。如果每秒生成 10 亿个 UUID，连续生成 73 年，碰撞概率仍不到十亿分之一。

**结论**：在正常应用中，UUID v4 碰撞概率可以忽略不计。你可以放心将其作为数据库主键、会话 ID、文件名等。

## UUID 的实际应用场景

1. **数据库主键**：分布式系统中避免自增 ID 的冲突问题
2. **会话令牌**：用户登录后的会话标识
3. **文件命名**：避免上传文件名冲突
4. **链路追踪**：分布式系统的请求追踪 ID
5. **前端组件 Key**：React 等框架中动态列表的唯一标识
6. **API 请求 ID**：便于日志关联与问题排查

## UUID 的取舍

UUID 并非万能，选择时需权衡：

| 特性 | UUID | 自增 ID | 雪花 ID |
|------|------|---------|---------|
| 全局唯一 | ✅ | ❌ | ✅ |
| 可排序 | ❌（v4） | ✅ | ✅ |
| 长度 | 36 字符 | 短 | 中等 |
| 不可预测 | ✅ | ❌ | 部分 |
| 分布式友好 | ✅ | ❌ | ✅ |

如果你的场景需要时序排序，考虑使用 **UUID v7** 或雪花算法；如果只是需要唯一标识，UUID v4 是最简单的选择。

## 总结

- 优先使用 `crypto.randomUUID()`，简单、安全、原生
- 旧环境降级到 `crypto.getRandomValues` 手动实现
- **永远不要用 `Math.random` 生成 UUID**，它不安全
- UUID v4 的碰撞概率在实际应用中可忽略
- UUID 在安全上下文（HTTPS）下才可用

想要快速生成 UUID？试试我们的 [UUID 在线生成器](/uuid)，支持批量生成、连字符与大写格式切换，所有数据在浏览器本地处理，零上传零追踪。
