---
title: "Unix 时间戳详解：秒与毫秒的陷阱、ISO 8601 与时区处理实践"
description: "系统讲解 Unix 时间戳的定义、秒与毫秒的区别、2038 年问题、JavaScript Date 的 13 位时间戳、ISO 8601 格式、时区与 UTC 处理最佳实践。涵盖常见转换陷阱与跨时区开发技巧。"
pubDate: 2026-07-03
tags: ["时间戳", "Unix", "时区", "JavaScript", "Date"]
relatedTool: "/timestamp"
---

## 什么是 Unix 时间戳

**Unix 时间戳**（Unix Timestamp）是从 **1970 年 1 月 1 日 00:00:00 UTC**（Unix 纪元）开始所经过的秒数。它是跨平台、跨语言、跨时区的统一时间表示方式。

```
时间戳 0          → 1970-01-01 00:00:00 UTC
时间戳 1700000000 → 2023-11-14 22:13:20 UTC
时间戳 1780000000 → 2026-05-31 01:46:40 UTC
```

为什么选 1970-01-01？这是 Unix 操作系统诞生的近似时间，由 Unix 创始人 Ken Thompson 与 Dennis Ritchie 早期定义，成为事实标准后写入 POSIX 规范。

## 秒 vs 毫秒：最大的陷阱

不同语言和系统使用不同精度，这是时间戳最常见的 bug 来源：

| 环境 | 单位 | 示例（同一时刻） |
|------|------|------------------|
| Unix/Linux `date +%s` | 秒 | `1700000000` |
| JavaScript `Date.now()` | 毫秒 | `1700000000000` |
| Python `time.time()` | 秒（浮点） | `1700000000.123` |
| Java `System.currentTimeMillis()` | 毫秒 | `1700000000000` |
| Go `time.Now().Unix()` | 秒 | `1700000000` |
| MySQL `UNIX_TIMESTAMP()` | 秒 | `1700000000` |

**JavaScript 是少数默认用毫秒的语言**，这导致前后端对接时极易出错。

### 转换公式

```javascript
const ms = Date.now();           // 毫秒，13 位
const sec = Math.floor(ms / 1000); // 转为秒，10 位

// 秒转毫秒
const msAgain = sec * 1000;
```

### 位数速查

通过时间戳位数可快速判断单位：

- **10 位** → 秒（Unix 标准时间戳）
- **13 位** → 毫秒（JavaScript、Java）
- **16 位** → 微秒（Python `time.time_ns()`、部分日志系统）
- **19 位** → 纳秒（Go `time.Now().UnixNano()`）

## 2038 年问题（Y2038）

32 位有符号整数的最大值是 `2147483647`，对应时间戳 `2147483647` 即 **2038-01-19 03:14:07 UTC**。在此之后，32 位系统的时间戳会溢出变为负数，导致时间回退到 1901 年。

**影响范围**：嵌入式设备、老旧服务器、C 语言 `time_t` 类型（32 位系统上）。

**解决方案**：迁移到 64 位 `time_t`。现代 64 位系统不受影响，时间戳可用 2920 亿年。

## JavaScript 中的时间处理

### Date 对象

JavaScript 的 `Date` 内部存储的就是**毫秒级 Unix 时间戳**：

```javascript
// 获取当前时间戳（毫秒）
const now = Date.now(); // 1700000000000

// 从时间戳创建 Date
const date = new Date(1700000000000); // 毫秒
const date2 = new Date(1700000000 * 1000); // 秒需先乘 1000

// Date 转时间戳
date.getTime(); // 1700000000000
```

### 常见方法

```javascript
const d = new Date();

d.getFullYear();    // 2026（年）
d.getMonth();       // 0-11（注意：从 0 开始！）
d.getDate();        // 1-31（日）
d.getDay();         // 0-6（星期，0 是周日）
d.getHours();       // 0-23（小时）
d.getTimezoneOffset(); // 与 UTC 的分钟差（东八区为 -480）
```

> **陷阱**：`getMonth()` 从 0 开始，1 月是 0，12 月是 11。这是 JavaScript 最经典的时间 bug。

### UTC 方法 vs 本地方法

Date 对象提供两套方法：

```javascript
const d = new Date(1700000000000);

d.toLocaleString();      // "2023/11/15 06:13:20"（本地时区）
d.toISOString();         // "2023-11-14T22:13:20.000Z"（UTC，Z 后缀）
d.toUTCString();         // "Tue, 14 Nov 2023 22:13:20 GMT"

d.getUTCHours();         // 22（UTC 小时）
d.getHours();            // 6（东八区小时）
```

## ISO 8601 格式

**ISO 8601** 是国际标准化时间表示格式，也是 JavaScript `Date.toISOString()` 的输出：

```
2023-11-14T22:13:20.000Z
```

各部分含义：

| 部分 | 含义 |
|------|------|
| `2023-11-14` | 日期 YYYY-MM-DD |
| `T` | 日期与时间分隔符 |
| `22:13:20.000` | 时分秒.毫秒 |
| `Z` | UTC（Zulu 时间，零时区） |

带时区偏移的写法：

```
2023-11-14T22:13:20+08:00  // 东八区
2023-11-14T22:13:20-05:00  // 西五区
```

### 解析 ISO 8601

```javascript
// 浏览器原生支持 ISO 8601 解析
const d = new Date('2023-11-14T22:13:20Z');
d.getTime(); // 1700000000000

// 注意：无时区的日期字符串会被当作本地时间
new Date('2023-11-14').getTime(); // 当地时间 00:00:00
new Date('2023-11-14T00:00:00').getTime(); // 当地时间
new Date('2023-11-14T00:00:00Z').getTime(); // UTC 时间
```

## 时区处理

### 为什么有时区

地球自西向东自转，各地日出时间不同。1884 年华盛顿国际会议将全球分为 24 个时区，以本初子午线（格林尼治）为基准。

- **UTC**（协调世界时）：零时区基准，替代旧 GMT
- **东八区（UTC+8）**：中国标准时间（CST），比 UTC 快 8 小时
- **夏令时**：部分高纬度地区夏季拨快 1 小时，规则复杂

### 时区转换陷阱

```javascript
// 服务器存的是 UTC 时间
const serverTime = '2023-11-14T22:13:20Z';

// 不同时区用户看到不同时间
const d = new Date(serverTime);
d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
// "2023/11/15 06:13:20"

d.toLocaleString('en-US', { timeZone: 'America/New_York' });
// "11/14/2023, 5:13:20 PM"
```

### 最佳实践

1. **存储用 UTC**：数据库、日志、API 一律存 UTC 时间戳或 ISO 8601 带 Z
2. **展示用本地时区**：前端根据用户时区格式化
3. **传输用 ISO 8601**：带时区信息，避免歧义
4. **永远不要用字符串拼接时间**：用 `Date` 对象或时间戳传递

```javascript
// ❌ 错误：字符串拼接，时区不明
fetch(`/api?date=2023-11-14 22:13:20`);

// ✅ 正确：传时间戳或 ISO 8601
fetch(`/api?ts=1700000000`);
fetch(`/api?iso=2023-11-14T22:13:20Z`);
```

## 相对时间计算

时间戳的最大优势是**直接做减法**得到时间差：

```javascript
const start = Date.now();
// ... 执行耗时操作
const cost = Date.now() - start; // 毫秒

// 友好显示
function formatDuration(ms) {
  if (ms < 1000) return `${ms} 毫秒`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} 秒`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)} 分钟`;
  return `${Math.floor(ms / 3600000)} 小时`;
}
```

## 常见陷阱速查

| 陷阱 | 说明 | 解决 |
|------|------|------|
| 秒/毫秒混淆 | 前端 13 位，后端 10 位 | 对接时明确单位 |
| `getMonth()` 从 0 开始 | 1 月是 0 | 显示时 +1 |
| 时区不一致 | 服务器 UTC，用户本地 | 存储 UTC，展示转本地 |
| 闰秒 | UTC 偶尔插入闰秒 | Unix 时间戳通常平滑处理 |
| Safari 解析格式 | 不支持 `YYYY-MM-DD HH:mm:ss` | 用 ISO 8601 带 T 和 Z |
| `new Date(秒)` 错误 | JavaScript 需要毫秒 | 乘以 1000 |

## 总结

- Unix 时间戳从 1970-01-01 UTC 起算，**秒 vs 毫秒是最大陷阱**
- JavaScript `Date` 内部存毫秒，10 位是秒需 ×1000
- ISO 8601（`YYYY-MM-DDTHH:mm:ssZ`）是跨平台标准格式
- 存储用 UTC，展示转本地时区，传输带时区信息
- `getMonth()` 从 0 开始，这是 JavaScript 经典坑

想要快速转换时间戳？试试我们的 [时间戳转换工具](/timestamp)，支持秒/毫秒双向转换、ISO 8601 输出、多格式展示，所有数据在浏览器本地处理，零上传零追踪。
