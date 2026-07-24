---
title: "缓存 TTL 配置中的时间单位换算：从秒到毫秒的工程陷阱与最佳实践"
description: "系统讲解 Redis、HTTP Cache-Control、React Query、JWT、Kubernetes 等主流缓存系统的时间单位约定差异（秒 vs 毫秒），分析单位混淆导致的线上事故案例，提供常见 TTL 值的换算速查表与代码层面的可读性最佳实践，帮助开发者避免单位陷阱、写出可维护的缓存配置。"
pubDate: 2026-07-24
tags: ["缓存", "TTL", "时间单位", "Redis", "Cache-Control", "React Query", "JWT", "Kubernetes", "工具矩阵"]
relatedTool: "/time-unit"
---

## 缓存 TTL：为什么不同系统用不同时间单位

缓存是提升系统性能的核心手段，而 TTL（Time To Live，存活时间）是缓存配置中最常见的参数。但一个看似简单的"缓存多久"问题，在不同系统里却用的是**不同时间单位**：Redis 用秒（也支持毫秒），HTTP `Cache-Control` 用秒，React Query 用毫秒，JWT `exp` 用秒级 Unix 时间戳，Kubernetes 用秒。

这种单位不统一源于历史原因与 API 设计哲学：C 语言时代的 `time()` 返回秒，HTTP 协议为可读性选择秒，而前端框架为精细控制选择毫秒。结果是——**开发者每天在不同单位间来回换算，稍有不慎就会写出 1000 倍偏差的配置**。

> 配套工具：[缓存 TTL 时间单位换算工具](/time-unit) —— 支持毫秒/秒/分/时/天/周/月/年八种单位双向换算，可直接解析 `1h 30min` 这类复合时长并输出人类可读表示

## 一、主流缓存系统的时间单位约定

### 1.1 Redis：秒与毫秒并存

Redis 的过期命令存在两套 API，单位不同：

| 命令 | 单位 | 示例 | 等效毫秒 |
|------|------|------|---------|
| `EXPIRE key 60` | 秒 | 60 秒 | 60,000 ms |
| `SETEX key 60 value` | 秒 | 60 秒 | 60,000 ms |
| `PEXPIRE key 60000` | 毫秒 | 60,000 毫秒 | 60,000 ms |
| `PSETEX key 60000 value` | 毫秒 | 60,000 毫秒 | 60,000 ms |
| `EXPIRE key 60 NX` | 秒（带选项） | 60 秒 | 60,000 ms |

**陷阱**：`EXPIRE` 与 `PEXPIRE` 仅一个字母之差，单位却差 1000 倍。曾有线上的案例：开发者本想设置 60 秒过期，误用 `PEXPIRE key 60`，实际只缓存了 60 毫秒，缓存命中率从 95% 暴跌到 0.3%。

### 1.2 HTTP Cache-Control：秒

HTTP 协议规定 `Cache-Control: max-age=N` 中的 N 是**秒**：

```http
Cache-Control: max-age=86400
Cache-Control: public, max-age=3600, s-maxage=86400
```

常见换算：

- `max-age=60` → 1 分钟
- `max-age=3600` → 1 小时
- `max-age=86400` → 1 天
- `max-age=604800` → 1 周
- `max-age=2592000` → 30 天
- `max-age=31536000` → 1 年（用于带 hash 的静态资源）

**陷阱**：`Expires` 头是 HTTP 日期格式（如 `Wed, 24 Jul 2026 12:00:00 GMT`），而 `max-age` 是秒数，两者不可混用。现代实践优先用 `max-age`。

### 1.3 React Query / SWR / TanStack Query：毫秒

前端数据请求库普遍用**毫秒**：

```js
// React Query
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,        // 60 秒（毫秒）
      cacheTime: 5 * 60_000,    // 5 分钟（毫秒）
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
    },
  },
});

// SWR
useSWR('/api/data', fetcher, {
  dedupingInterval: 2000,       // 2 秒（毫秒）
  refreshInterval: 60_000,      // 60 秒（毫秒）
});
```

**陷阱**：从后端配置（秒）迁移到前端配置（毫秒）时，容易直接搬运数字导致 1000 倍偏差。例如后端 `max-age=3600`（1 小时），前端误写成 `staleTime: 3600`（3.6 秒）。

### 1.4 JWT exp 声明：秒级 Unix 时间戳

JWT 的 `exp`（expiration time）声明是**秒级 Unix 时间戳**，不是 TTL：

```js
// 签发 30 分钟过期的 JWT
const exp = Math.floor(Date.now() / 1000) + 30 * 60;  // 秒级时间戳 + 1800 秒
const token = jwt.sign({ userId: 123 }, secret, { expiresIn: '30m' });
// expiresIn 字符串语法会被解析为秒数加到当前时间戳上
```

**陷阱**：JavaScript 的 `Date.now()` 返回**毫秒**，而 JWT `exp` 需要**秒**。必须除以 1000 并取整。漏掉这一步会导致 token 实际过期时间是预期的 1000 倍（约 20 天后过期而非 30 分钟）。

### 1.5 Kubernetes：秒

Kubernetes 资源中的时间字段普遍用**秒**：

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 30      # 30 秒
  periodSeconds: 10            # 10 秒
  timeoutSeconds: 5            # 5 秒
  failureThreshold: 3          # 连续失败 3 次认为不健康

terminationGracePeriodSeconds: 60   # 优雅终止宽限期 60 秒
```

**陷阱**：字段名都以 `Seconds` 结尾，但开发者复制粘贴时容易忽略单位，把 `timeoutSeconds: 5` 误读为 5 毫秒。

### 1.6 浏览器 Cookie Max-Age 与 Set-Cookie

`Set-Cookie` 头的 `Max-Age` 属性是**秒**：

```http
Set-Cookie: session=abc; Max-Age=86400; Secure; HttpOnly; SameSite=Lax
```

`Max-Age=0` 立即删除，`Max-Age=86400` 保留 1 天。注意与 `Expires`（HTTP 日期）的区别。

## 二、单位换算的工程陷阱

### 2.1 秒 vs 毫秒混淆事故

最常见的线上事故模式：

| 场景 | 错误写法 | 实际效果 | 正确写法 |
|------|---------|---------|---------|
| Redis 缓存 60 秒 | `PEXPIRE key 60` | 60 毫秒（缓存几乎不生效） | `PEXPIRE key 60000` 或 `EXPIRE key 60` |
| React Query 5 分钟 | `staleTime: 300` | 0.3 秒（频繁重复请求） | `staleTime: 300_000` |
| JWT 1 小时过期 | `exp = Date.now() + 3600` | 约 41 天后过期 | `exp = Math.floor(Date.now()/1000) + 3600` |
| setTimeout 30 秒 | `setTimeout(fn, 30)` | 30 毫秒后执行 | `setTimeout(fn, 30_000)` |

### 2.2 整数溢出与精度问题

32 位有符号整数的最大值是 `2^31 - 1 = 2,147,483,647`：

- 作为**秒级 Unix 时间戳**：对应 2038-01-19 03:14:07 UTC（著名的 2038 年问题）
- 作为**毫秒级 Unix 时间戳**：对应约 24.8 天后（`2,147,483,647 ms ≈ 24.86 天`）

这意味着：如果某个系统用 32 位整数存储毫秒级 TTL，**单次 TTL 不能超过 24.8 天**。Redis 早期版本（< 2.6）的 `PEXPIRE` 在某些边界场景就会触发此问题。

### 2.3 时区与夏令时对 TTL 的影响

TTL 是**时长**（duration），与时区无关。但若用"绝对过期时刻"表示缓存失效，跨时区就会出现歧义：

- 缓存设置"明天凌晨 2 点过期"——指的是哪个时区的 2 点？
- 夏令时切换当天有 23 或 25 小时，"24 小时后"与"明天同一时刻"可能不等价

**最佳实践**：内部存储始终用 TTL（相对时长）或 UTC 绝对时间戳，避免使用本地时间的"自然日"语义。

## 三、常见 TTL 值的换算速查表

| 业务语义 | 秒 | 毫秒 | 人类可读 |
|---------|-----|------|---------|
| 验证码 5 分钟 | 300 | 300,000 | 5 分钟 |
| Session 30 分钟 | 1,800 | 1,800,000 | 30 分钟 |
| 接口缓存 1 小时 | 3,600 | 3,600,000 | 1 小时 |
| 首页缓存 1 天 | 86,400 | 86,400,000 | 1 天 |
| 周报缓存 1 周 | 604,800 | 604,800,000 | 1 周 |
| 配置缓存 30 天 | 2,592,000 | 2,592,000,000 | 30 天 |
| 静态资源 1 年 | 31,536,000 | 31,536,000,000 | 365 天 |
| JWT 短期 15 分钟 | 900 | 900,000 | 15 分钟 |
| JWT 长期 7 天 | 604,800 | 604,800,000 | 7 天 |
| Refresh Token 30 天 | 2,592,000 | 2,592,000,000 | 30 天 |

遇到不熟悉的数值时，可以用 [毫秒与秒双向换算工具](/time-unit) 快速验证：输入任一单位的数值，立即看到全部 8 个单位的对应值，并复制结果到配置中。

## 四、用时间单位换算工具验证配置

当遇到一段陌生的缓存配置时，推荐的工作流：

1. **识别单位**：从命令名（`EXPIRE` 秒 / `PEXPIRE` 毫秒）或字段名（`Seconds` 后缀为秒、`Time` 后缀多为毫秒）判断
2. **输入换算**：在工具的"单位换算"模块输入数值与源单位，查看目标单位结果
3. **复合时长解析**：对于 `1h 30min` 这类复合写法，用"时长解析"模块直接转为毫秒
4. **人类可读校验**：把毫秒数粘贴到"毫秒转人类可读"模块，确认是否符合预期

例如，看到 React Query 配置 `staleTime: 1800000`，不知道是多久：

- 输入 `1800000` 毫秒 → 输出 `30 分钟`、`0.5 小时`、`1800 秒`
- 确认这是 30 分钟的 staleTime，符合"数据 30 分钟内视为新鲜"的业务预期

## 五、代码层面的可读性最佳实践

### 5.1 避免裸数字

```js
// ❌ 反模式：裸数字，单位不明
setTimeout(refresh, 1800000);
queryClient.setQueryData(['user'], data, { cacheTime: 3600000 });

// ✅ 推荐：用具名常量或带单位命名
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;      // 30 分钟
const CACHE_TTL_MS = 60 * 60 * 1000;             // 1 小时
setTimeout(refresh, REFRESH_INTERVAL_MS);
```

### 5.2 用时间字面量库

主流语言都有可读的时间字面量方案：

```js
// JavaScript：用 ms / human-interval 等库，或手写工厂函数
const ONE_HOUR = 60 * 60 * 1000;
const staleTime = ONE_HOUR;        // 1 小时，意图清晰
```

```python
# Python：datetime.timedelta
from datetime import timedelta
cache_ttl = timedelta(hours=1).total_seconds()   # 3600.0 秒
```

```go
// Go：time.Duration 字面量
const cacheTTL = 1 * time.Hour        // 1 小时（纳秒）
time.After(cacheTTL)
```

```java
// Java：java.time.Duration
Duration cacheTTL = Duration.ofHours(1);          // 1 小时
cacheTTL.toMillis();    // 3600000
cacheTTL.getSeconds();  // 3600
```

### 5.3 配置集中化与文档化

把散落在代码各处的 TTL 集中到配置文件，并标注单位：

```yaml
# cache-config.yaml —— 所有 TTL 统一在此管理，单位：秒（迁移到毫秒时批量改）
session_ttl: 1800              # 30 分钟
api_cache_ttl: 3600            # 1 小时
homepage_ttl: 86400            # 1 天
static_asset_ttl: 31536000     # 1 年
jwt_access_ttl: 900            # 15 分钟
jwt_refresh_ttl: 2592000       # 30 天
```

迁移到不同单位时，配合 [缓存 TTL 时间单位换算工具](/time-unit) 批量验证每个值，避免遗漏。

## 六、相关工具与延伸阅读

缓存配置往往不是孤立存在的，它会和 HTTP 头部、时间戳、定时任务交织在一起：

- 想检查 `Cache-Control` / `Expires` / `Age` 等响应头的实际值？用 [HTTP 响应头查看工具](/http-headers) 抓取线上返回头，核对 `max-age` 是否生效
- JWT `exp` 声明需要解码与时间戳互转？配合 [Unix 时间戳转换工具](/timestamp) 在秒级时间戳与可读时间之间切换
- 缓存预热与定期清理需要调度任务？用 [CRON 表达式解析器](/cron) 验证 `0 3 * * *`（每天凌晨 3 点）等调度表达式
- 跨时区用户看到"缓存 1 天"的实际失效时刻不同？用 [时区转换器](/timezone) 换算 UTC 与本地时间

掌握时间单位换算后，你会发现缓存配置的很多"玄学问题"本质上都是单位陷阱。养成"看到数字先问单位"的习惯，配合工具快速验证，能避免绝大多数线上事故。

---

**配套工具**：本文所有换算均可通过 [时间单位换算器](/time-unit) 完成——支持毫秒/秒/分/时/天/周/月/年八种单位双向换算、复合时长解析（`1h 30min`）、毫秒转人类可读表示，全本地处理，零上传零追踪。
