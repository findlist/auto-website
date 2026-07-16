---
title: "JWT 安全进阶：Refresh Token、黑名单、算法选择与漏洞防御"
description: "深入讲解 JWT 生产环境安全实践：双令牌刷新机制、黑名单与吊销方案、HS256/RS256/ES256 算法选择决策树、alg=none 攻击与密钥混淆漏洞防御、Token 存储位置与 CSRF 关系，附 JWT 解码工具实操。"
pubDate: 2026-07-04
tags: ["安全", "JWT", "后端", "认证", "刷新令牌", "黑名单", "算法选择"]
relatedTool: "/jwt"
---

## 为什么需要 JWT 安全进阶

[JWT 入门指南](/blog/jwt-decode-guide)已经讲了三段式结构、base64url 编码与基本算法选型。但真正在生产环境用 JWT，会立刻撞到一系列棘手问题：

- 用户登出后 token 仍有效怎么办？
- access token 该设多久过期？太短用户烦，太长风险大
- 前端把 token 存 localStorage 还是 cookie？
- 服务端该用 HS256 还是 RS256？
- 为什么说 JWT 「无状态」其实是有代价的？

本文聚焦这些**进阶安全实践**，配套[在线 JWT 解码工具](/jwt)边读边试。点击工具页的「不安全示例」按钮可载入 `alg=none` 演示 token，体验安全警告效果。

## 过期时间 exp 的精细化设计

`exp`（Expiration Time）是 JWT 最重要的安全字段。设得太长，token 泄露后攻击窗口大；设得太短，用户频繁重新登录体验差。**没有标准答案，只有按业务场景的精细化设计**。

### 按场景推荐的 exp 时长

| 场景 | 推荐 exp | 理由 |
|------|---------|------|
| 内部管理后台 | 15-30 分钟 | 权限敏感，宁可频繁登录 |
| 普通 Web 应用 | 1-2 小时 | 平衡安全与体验 |
| 移动端 App | 7-30 天 | 移动端登录成本高 |
| 单页应用（SPA） | 15-30 分钟 + refresh token | 短 access token + 长刷新令牌 |
| 第三方 API 调用 | 5-15 分钟 | 服务间调用，可控性强 |
| 邮件验证链接 | 1-24 小时 | 一次性用途，过期作废 |

### exp 时长的三个误区

**误区 1：把 exp 设成 7 天就一劳永逸**。token 一旦泄露，攻击者 7 天内可任意使用。正确做法是用短 exp（15-30 分钟）+ refresh token 模式。

**误区 2：依赖 exp 自动过期，不做主动失效**。用户改密码、登出、踢下线场景必须能立即吊销 token，不能等 exp 自然过期。详见下文黑名单机制。

**误区 3：exp 用毫秒时间戳**。JWT 标准（RFC 7519）规定 `exp`/`iat`/`nbf` 均为 **Unix 秒级时间戳**。JavaScript `Date.now()` 返回毫秒，需除以 1000。本工具自动按秒级解析，若显示时间为 1970 年附近，说明用了毫秒（非标准）。配合[时间戳转换工具](/timestamp)可快速验证。

## Refresh Token 双令牌模式

单 token 模式的根本矛盾：**安全（短 exp）与体验（长 exp）冲突**。双令牌模式通过职责分离解决：

- **access token**：短 exp（15-30 分钟），用于 API 调用，泄露风险可控
- **refresh token**：长 exp（7-30 天），仅用于换取新的 access token，不用于业务请求

### 刷新流程

```
1. 用户登录 → 服务端签发 access_token (exp=30min) + refresh_token (exp=7d)
2. 客户端用 access_token 调用业务 API
3. access_token 过期 → 客户端用 refresh_token 调用 /refresh 接口
4. 服务端验证 refresh_token → 签发新的 access_token (+ 可选新的 refresh_token)
5. 重复 2-4，直到 refresh_token 过期或被吊销
```

### Refresh Token 的安全要点

- **只走 HTTPS**：refresh token 寿命长，泄露代价大，必须 HTTPS 传输
- **服务端可吊销**：refresh token 必须能在服务端主动失效（存数据库或 Redis）
- **一次性使用**：每次刷新签发新的 refresh token，旧的立即失效（防止重放）
- **绑定设备/IP**：refresh token 与客户端指纹绑定，异地登录触发重新认证
- **轮转检测**：若旧 refresh token 被使用，说明可能被窃取，立即吊销该用户所有 token

### 代码示例：刷新接口骨架

```javascript
// 伪代码：refresh token 轮转
app.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  // 1. 验证签名与 exp
  const payload = jwt.verify(refresh_token, REFRESH_SECRET);
  // 2. 查 Redis 黑名单
  if (await redis.get(`bl:${refresh_token}`)) {
    return res.status(401).json({ error: 'token 已失效' });
  }
  // 3. 查数据库确认 refresh_token 仍有效（一次性使用）
  const stored = await db.query('SELECT * FROM refresh_tokens WHERE token=? AND user_id=? AND revoked=0', [refresh_token, payload.sub]);
  if (!stored) return res.status(401).json({ error: 'token 无效' });
  // 4. 吊销旧 refresh_token
  await db.query('UPDATE refresh_tokens SET revoked=1 WHERE id=?', [stored.id]);
  // 5. 签发新的 access_token + refresh_token
  const new_access = signAccessToken(payload.sub);
  const new_refresh = signRefreshToken(payload.sub);
  await db.query('INSERT INTO refresh_tokens (token, user_id, exp) VALUES (?, ?, ?)', [new_refresh, payload.sub, Date.now() + 7*24*3600*1000]);
  res.json({ access_token: new_access, refresh_token: new_refresh });
});
```

## JWT 黑名单与吊销机制

JWT 的「无状态」是双刃剑：服务端不存会话，验签即信任，**这意味着无法主动让一个 token 失效**。用户登出、改密码、踢下线场景必须靠黑名单机制补救。

### 三种黑名单实现方案

| 方案 | 适用场景 | 优点 | 缺点 |
|------|---------|------|------|
| Redis 黑名单 | 大型应用，高 QPS | 快（毫秒级查询），支持 TTL 自动清理 | 引入 Redis 依赖 |
| 数据库黑名单 | 中小应用 | 简单，无额外依赖 | 查询慢，需定期清理 |
| 内存黑名单 | 单机应用，token 数少 | 零依赖，最快 | 不支持多实例，重启丢失 |

### Redis 黑名单的两种实现

**方案 A：吊销 token 列表**（黑名单）

```javascript
// 用户登出时，把 token 加入黑名单，TTL = token 剩余有效期
app.post('/logout', auth, async (req, res) => {
  const token = req.headers.authorization.slice(7);
  const payload = jwt.decode(token);
  const ttl = payload.exp - Math.floor(Date.now() / 1000);
  if (ttl > 0) {
    await redis.setex(`bl:${token}`, ttl, '1');
  }
  res.json({ ok: true });
});

// 中间件验签时检查黑名单
function auth(req, res, next) {
  const token = req.headers.authorization.slice(7);
  const payload = jwt.verify(token, SECRET);
  if (await redis.get(`bl:${token}`)) {
    return res.status(401).json({ error: 'token 已失效' });
  }
  req.user = payload;
  next();
}
```

**方案 B：用户令牌版本号**（更省内存）

```javascript
// 用户改密码或登出时，递增 token_version
await redis.incr(`tv:user:${userId}`);

// 签发 token 时把当前版本号写入 payload
const token = jwt.sign({ sub: userId, tv: currentVersion }, SECRET);

// 验签时比对版本号
const payload = jwt.verify(token, SECRET);
const latestVersion = await redis.get(`tv:user:${payload.sub}`);
if (payload.tv !== Number(latestVersion)) {
  return res.status(401).json({ error: 'token 已失效' });
}
```

方案 B 的优势：黑名单只需存一个版本号，不用存每个 token，内存占用极低。代价：会让该用户**所有已签发 token 失效**，不能精细到单个 token。

### 黑名单的代价

引入黑名单意味着 JWT 不再是「无状态」，每次请求都要查一次 Redis/数据库。**如果接受状态，为什么不直接用 Session？** 关键差异：

- Session：所有请求都查存储，存储是真相之源
- JWT + 黑名单：绝大多数 token 不在黑名单中，存储只是「异常列表」，查询可短路

实践建议：用 Redis + Bloom Filter 优化，Bloom Filter 判断 token 不在黑名单时直接放行（O(1)），可能在时才查 Redis。

## 算法选择的决策树

HS256 / RS256 / ES256 该选哪个？**按团队结构与性能需求决策**，不要盲目追新。

```
是否多方协作（多服务、多组织）？
├─ 是 → 是否在意密钥长度与性能？
│   ├─ 是 → ES256（椭圆曲线，密钥短、速度快，推荐现代项目）
│   └─ 否 → RS256（RSA，生态最成熟，公钥可公开）
└─ 否 → 单方服务，对称密钥可接受
    └─ HS256（实现最简单，性能最高，密钥需妥善保管）
```

### 三类算法对比

| 维度 | HS256 | RS256 | ES256 |
|------|-------|-------|-------|
| 类型 | 对称 | 非对称 | 非对称 |
| 密钥 | 单密钥（签发+验签） | 私钥签发 + 公钥验签 | 私钥签发 + 公钥验签 |
| 密钥长度 | 256 位 | 2048 位 | 256 位 |
| 签名长度 | 32 字节 | 256 字节 | 64 字节 |
| 签发速度 | 快 | 慢 | 中 |
| 验签速度 | 快 | 中 | 快 |
| 公钥可分发 | 否 | 是 | 是 |
| 适用场景 | 单方服务 | OAuth2 / SAML | 现代分布式系统 |

### none 算法是地雷

`alg=none` 表示无签名，RFC 7519 明确允许但**严禁生产使用**。常见漏洞：

**漏洞场景**：服务端代码这样写

```javascript
// 危险代码：信任 token 自身声明的 alg
const token = req.headers.authorization.slice(7);
const header = JSON.parse(atob(token.split('.')[0]));
const payload = jwt.verify(token, SECRET, { algorithms: [header.alg] });
```

攻击者把 Header 改成 `{"alg":"none"}` 并清空签名段，服务端就会跳过验签。本工具检测到 `alg=none` 会显示红色安全警告横幅，点击「不安全示例」按钮可载入演示 token。

**防御**：服务端硬编码允许的算法白名单，**不读取 token 自身声明的 alg**。

```javascript
// 正确代码：硬编码算法白名单
const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
```

### 密钥混淆漏洞

攻击者把 RS256 token 的 Header 改成 `{"alg":"HS256"}`，用服务端的**公钥**作为 HMAC 密钥签名。如果服务端用同一密钥变量验签，就会用公钥当 HMAC 密钥，误判为合法。

**防御**：签发与验签使用**不同的密钥变量**，且按算法严格区分。

## Token 存储位置对比

前端拿到 token 后存哪里？这是 JWT 安全的高频问题。三种方案的取舍：

| 存储位置 | XSS 风险 | CSRF 风险 | 跨标签页 | 推荐度 |
|---------|---------|----------|---------|--------|
| localStorage | 高（JS 可读） | 无 | 是 | ❌ 不推荐 |
| sessionStorage | 高（JS 可读） | 无 | 否 | ❌ 不推荐 |
| httpOnly cookie | 低（JS 不可读） | 高（自动发送） | 是 | ✅ 配合 SameSite |
| 内存（JS 变量） | 低 | 无 | 否 | ✅ 配合 refresh |

### 推荐方案：内存 + httpOnly cookie

- **access token**：存在内存（JS 变量），刷新页面丢失，用 refresh token 重新获取
- **refresh token**：存在 httpOnly + Secure + SameSite=Strict cookie，JS 不可读，CSRF 防护靠 SameSite

这样即使 XSS 注入脚本，也只能偷到内存中的短 exp access token，refresh token 在 httpOnly cookie 中拿不到。

## CSRF 与 JWT 的关系

**常见误区**：用 JWT 就不用防 CSRF 了。**部分正确，但有陷阱**。

### 为什么 JWT 通常免疫 CSRF

CSRF（跨站请求伪造）依赖浏览器自动携带 Cookie。如果 token 存 localStorage 并通过 `Authorization: Bearer xxx` 头发送，跨站请求不会自动带 token，CSRF 自然失效。

### 什么时候 JWT 仍可能被 CSRF

**陷阱 1**：把 token 存 cookie。如果为了 httpOnly 防把 token 存 cookie，又没设 SameSite，CSRF 又回来了。

**陷阱 2**：基于 cookie 的 session 与 JWT 混用。某些老系统迁移期间，部分接口用 session，部分用 JWT，session 部分仍可能被 CSRF。

**防御**：
- 优先用 `Authorization` 头而非 cookie 传 token
- 若必须用 cookie，设 `SameSite=Strict`（或 `Lax`）
- 对状态变更请求（POST/PUT/DELETE）额外校验自定义头（如 `X-Requested-With`）

更多 CSRF 防护细节参见[前端安全：CSP、XSS、CSRF 防护实践](/blog/web-security-csp-xss-csrf)。

## JWT 常见安全漏洞速查表

| 漏洞 | 描述 | 防御 |
|------|------|------|
| alg=none 攻击 | 伪造 Header 改 alg 为 none | 服务端硬编码算法白名单 |
| 密钥混淆 | RS256 改 HS256 用公钥当 HMAC 密钥 | 签发与验签用不同密钥变量 |
| 弱密钥 | HS256 用 `secret` 等弱密钥 | 至少 256 位随机密钥 |
| 时钟偏移 | 服务器时钟不同步导致 exp/nbf 误判 | 配置 NTP，验签时容忍 ±30 秒 |
| 不校验 aud | token 被跨服务重放 | 严格校验 aud 字段 |
| 不校验 iss | 跨身份提供商重放 | 严格校验 iss 字段 |
| token 跨用户重放 | A 用户的 token 在 B 用户会话使用 | 绑定用户指纹（IP/UA） |
| refresh token 不轮转 | 一次签发长期使用 | 一次性使用，每次刷新换新 |
| jti 重复 | 重放攻击 | 校验 jti 唯一性（Redis 去重） |
| JWT 携带敏感信息 | token 解码即明文 | 不放密码、身份证号等 |

## 工具矩阵联动

本文涉及的 JWT 安全实践可配合以下工具实操演练：

- [JWT 解码工具](/jwt)：粘贴 token 检查 alg、exp、payload 字段，识别 `alg=none` 不安全 token
- [SHA-256 哈希工具](/hash)：演示 HMAC-SHA256 签名原理，理解 HS256 的密钥与消息
- [UUID 生成器](/uuid)：生成 jti（JWT ID），用于防重放
- [Base64 编解码](/base64)：理解 JWT 三段的 base64url 编码
- [URL 编解码](/url)：理解 base64url 与 base64 的差异
- [时间戳转换](/timestamp)：验证 exp/iat/nbf 时间戳的秒级与毫秒级差异

## 安全检查清单

上线前过一遍这份清单，规避 90% 的 JWT 安全问题：

- [ ] 服务端硬编码算法白名单（不信任 token 声明的 alg）
- [ ] HS256 密钥至少 256 位随机串，不与签发密钥混用
- [ ] access token exp ≤ 30 分钟
- [ ] 启用 refresh token 轮转（一次性使用）
- [ ] 用户登出/改密码时能主动吊销 token
- [ ] 严格校验 aud 与 iss 字段
- [ ] token 不携带密码、身份证号等敏感信息
- [ ] 生产环境只走 HTTPS
- [ ] access token 存内存或 httpOnly cookie，不存 localStorage
- [ ] refresh token 设 SameSite=Strict
- [ ] 状态变更接口校验自定义头（CSRF 防护）
- [ ] 服务器时钟同步（NTP），验签容忍 ±30 秒
- [ ] jti 校验唯一性（防重放）
- [ ] 监控异常 token 使用（异地登录、频率突增）

## 小结

JWT 不是银弹，它的「无状态」带来的便利背后是**主动失效困难、刷新机制复杂、算法选择陷阱**等一系列工程问题。生产环境用 JWT 必须配套：

1. **短 exp + refresh token** 解决安全与体验的矛盾
2. **黑名单机制** 补救主动失效需求（Redis + 用户版本号）
3. **算法白名单** 防御 alg=none 与密钥混淆攻击
4. **httpOnly cookie + SameSite** 兼顾 XSS 与 CSRF 防护
5. **严格校验 aud/iss/jti** 防止重放与跨服务滥用

入门 JWT 看[ JWT 入门指南](/blog/jwt-decode-guide)，进阶安全看本文。配合[在线 JWT 解码工具](/jwt)边读边试，理解每个安全机制的实际效果。
