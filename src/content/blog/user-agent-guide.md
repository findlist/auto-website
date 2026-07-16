---
title: "User-Agent 完全指南：UA 字符串结构、解析、UA-CH 与反爬实战"
description: "系统讲解 User-Agent：UA 字符串结构、60+ 浏览器识别、设备类型判断（手机/平板/桌面）、爬虫检测、应用内 WebView 识别、UA-CH Client Hints 替代方案、UA 伪造与反爬实战，附解析器实现思路。"
pubDate: 2026-07-17
tags: ["HTTP", "网络", "Web API", "浏览器", "爬虫", "User-Agent", "UA-CH"]
relatedTool: "/user-agent"
---

## 为什么必须搞懂 User-Agent

很多开发者把 User-Agent（简称 UA）当作「一个字符串，需要时正则切一下」——这种简化的认知会导致两类典型问题。

第一类是**识别错误**：你做了一个简单的 `if (ua.includes('Chrome'))` 判断，结果发现 Edge、Opera、360、QQ 浏览器都被识别为 Chrome——因为它们都基于 Chromium 内核，UA 中都包含 `Chrome/x.x.x.x`。再比如你想区分 iPad 与 Mac，结果发现 iPadOS 13 以后 iPad 的 UA 默认就是 Mac Safari，根本不含 `iPad` 关键字。

第二类是**过度依赖**：把 UA 当作安全依据，根据 UA 判断「这是 Chrome 浏览器所以信任」，结果被爬虫轻易绕过——任何 HTTP 客户端都能伪造任意 UA。或者用 UA 嗅探代替特性检测，导致新浏览器无法访问——`if (ua.includes('Chrome') && !ua.includes('Edg'))` 这种判断在 Brave、Vivaldi 上全部失效。

理解 UA 的本质，能让你**正确识别客户端、合理设计自适应布局、有效识别爬虫、避免兼容性陷阱**。本文系统讲解 UA 字符串结构、60+ 浏览器识别规则、设备类型判断、爬虫检测、UA-CH 替代方案，并给出生产环境的实践建议。

> 配套工具：[User-Agent 解析与识别工具](/user-agent)（60+ 浏览器识别 + 速查表 + 示例库）、[HTTP Header 解析与生成](/http-headers)（User-Agent 是 HTTP 请求头的一部分）、[HTTP 状态码查询](/http-status)（结合 UA 分析访问日志）

## 一、UA 字符串的协议规范与历史

### 1.1 协议定义

User-Agent 是 HTTP 请求头的一个字段，定义于 RFC 9110。语法：

```http
User-Agent: <product> / <product-version> <comment>
```

- **product**：产品名（如 `Mozilla`、`Chrome`、`curl`）
- **product-version**：版本号（如 `5.0`、`120.0.0.0`）
- **comment**：括号包裹的附加信息（如操作系统、引擎等）

一个 UA 字符串可包含多个 product/comment 片段，空格分隔：

```
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36
```

### 1.2 历史兼容标记的由来

现代浏览器 UA 都以 `Mozilla/5.0` 开头，这是历史遗留：

- **Netscape 时代**：最早的浏览器是 Mosaic，后来 Netscape Navigator 兴起，UA 为 `Mozilla/1.0`。当时很多网站根据 UA 是否含 `Mozilla` 判断是否支持框架（frames），不支持就返回简化页面。
- **IE 时代**：微软推出 IE 时为了被识别为 Netscape，UA 设为 `Mozilla/1.22 (compatible; MSIE 2.0; Windows 95)`。`compatible` 标记表示兼容模式。
- **Firefox 时代**：Firefox 继承 Netscape 内核，UA 为 `Mozilla/5.0 (...) Gecko/... Firefox/...`。
- **Safari 时代**：Safari 基于 WebKit，为了被识别为 Mozilla 兼容，UA 为 `Mozilla/5.0 (...) AppleWebKit/... (KHTML, like Gecko) Version/... Safari/...`。`(KHTML, like Gecko)` 是为了让 Safari 被识别为 Gecko 内核（Firefox）。
- **Chrome 时代**：Chrome 基于 WebKit（后 fork 为 Blink），UA 为 `Mozilla/5.0 (...) AppleWebKit/... (KHTML, like Gecko) Chrome/... Safari/...`，保留 `Safari/` 是为了被识别为 Safari。
- **Edge 时代**：Edge 基于 Chromium，UA 含 `Chrome/`、`Safari/`、`Edg/`（注意是 Edg 不是 Edge，避免与老 IE Edge 混淆）。

这种「层层伪装」导致现代 UA 字符串冗长，但所有现代浏览器都保留这些历史标记以维持兼容性。

### 1.3 典型 UA 结构分解

以 Chrome 120 on Windows 10 为例：

```
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36
```

| 片段 | 含义 |
|------|------|
| `Mozilla/5.0` | 历史兼容标记 |
| `Windows NT 10.0` | 操作系统：Windows NT 内核版本 10.0（即 Windows 10/11） |
| `Win64; x64` | CPU 架构：64 位 Windows + x86-64 CPU |
| `AppleWebKit/537.36` | 渲染引擎版本（Blink fork 自 WebKit，保留版本号） |
| `(KHTML, like Gecko)` | 历史兼容标记（KHTML 是 Konqueror 引擎，WebKit 的祖先） |
| `Chrome/120.0.0.0` | 真实浏览器与版本 |
| `Safari/537.36` | 历史兼容标记 |

## 二、浏览器识别：60+ 模式表的设计原则

### 2.1 特异性优先原则

浏览器识别的核心难点是**多个浏览器 UA 包含相同关键字**。比如 Edge、Opera、Chrome 都含 `Chrome/`，微信、QQ 内置浏览器也含 `Chrome/`。如果直接用 `ua.includes('Chrome')` 判断，会把所有这些都识别为 Chrome。

正确做法是**按特异性优先匹配**：更具体的品牌先匹配，更通用的后匹配。本工具的模式表顺序：

1. **应用内 WebView 浏览器**（最特异）：微信（`MicroMessenger/`）、支付宝（`AlipayClient/`）、钉钉（`DingTalk`）、微博（`Weibo`）、飞书（`Lark`/`Feishu`）、抖音（`aweme`）、QQ（`QQ/`）等。
2. **国产桌面浏览器**：360（`QIHU 360SE`/`360SE`）、QQ 浏览器（`QQBrowser`）、UC（`UCBrowser`/`UCWEB`）、搜狗（`SE 2.X`/`MetaSr`）、猎豹（`LBBROWSER`）、百度（`BIDUBrowser`/`BaiduHD`）、2345（`2345Explorer`）、华为（`HBPC/`）等。
3. **Chromium 衍生浏览器**：Edge（`Edg/`，必须在 Chrome 之前）、Opera（`OPR/`/`Opera/`）、Brave（UA 与 Chrome 相同，无法通过 UA 区分）、Vivaldi（`Vivaldi/`）、Yandex（`YaBrowser/`）、Samsung Internet（`SamsungBrowser/`）。
4. **主流国际浏览器**：Chrome（`Chrome/`）、Firefox（`Firefox/`）、Safari（`Version/` + `Safari/`，不含 `Chrome/`）、IE（`MSIE`/`Trident/`）。
5. **其他**：Maxthon、Waterfox、SeaMonkey、Camino 等小众浏览器。

### 2.2 版本号捕获

每个模式定义 `versionGroup`，表示正则中版本号的捕获组索引：

```typescript
const BROWSER_PATTERNS: Pattern[] = [
  { regex: /MicroMessenger\/([\d.]+)/, name: '微信', versionGroup: 1 },
  { regex: /Edg\/([\d.]+)/, name: 'Microsoft Edge', versionGroup: 1 },
  { regex: /Chrome\/([\d.]+)/, name: 'Chrome', versionGroup: 1 },
];
```

匹配时取第一个命中的模式，从 `versionGroup` 提取版本号。

### 2.3 移动版浏览器特殊处理

部分浏览器有独立的移动版 UA 标识，需单独匹配：

- **Chrome Mobile**：`CriOS/`（iOS 上的 Chrome）、`Chrome/` + `Mobile`（Android 上的 Chrome）
- **Firefox Mobile**：`FxiOS/`（iOS 上的 Firefox）、`Firefox/` + `Android`（Android 上的 Firefox）
- **Opera Mobile**：`OPR/` + `Mobile`、`Opera Tablet`、`Opera Mobi`
- **Samsung Internet**：`SamsungBrowser/`（三星安卓浏览器）
- **QQ 浏览器 Mobile**：`MqqBrowser/`（注意 M 前缀，与桌面版 `QQBrowser/` 区分）

## 三、操作系统识别

### 3.1 主流系统关键字

操作系统识别相对简单，关键字比较固定：

| 系统 | 关键字 | 示例 |
|------|--------|------|
| Windows | `Windows NT <ver>` | `Windows NT 10.0` (Win10/11), `Windows NT 6.3` (Win8.1), `Windows NT 6.1` (Win7) |
| macOS | `Mac OS X <ver>` / `Macintosh` | `Mac OS X 10_15_7` |
| iOS | `iPhone OS <ver>` / `iPad; CPU OS <ver>` | `iPhone OS 17_0` |
| iPadOS（桌面版 UA） | `Mac OS X` + 触屏检测 | iPadOS 13+ 默认桌面 UA |
| Android | `Android <ver>` | `Android 14` |
| Linux | `X11` / `Linux x86_64` | `X11; Linux x86_64` |
| Chrome OS | `CrOS` | `CrOS x86_64 14541.0.0` |
| HarmonyOS | `HarmonyOS` | 鸿蒙系统 |

### 3.2 版本号映射

Windows NT 版本号与系统名称映射：

| NT 版本 | 系统名称 |
|---------|----------|
| 10.0 | Windows 10 / 11（UA 无法区分） |
| 6.3 | Windows 8.1 |
| 6.2 | Windows 8 |
| 6.1 | Windows 7 |
| 6.0 | Windows Vista |
| 5.1 | Windows XP |

iOS 版本号用下划线分隔（`17_0` 表示 17.0），解析时需替换为点号。

### 3.3 iPad 桌面陷阱

iPadOS 13 起，iPad 默认请求桌面版网站，UA 变为：

```
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15
```

UA 中不含 `iPad`，与 Mac Safari 几乎一致。区分方法：

1. **客户端检测**：`navigator.maxTouchPoints > 1` + UA 含 `Macintosh`，极可能是 iPad。
2. **UA-CH**：`Sec-CH-UA-Platform` 会返回 `iPadOS`（需服务器主动请求）。
3. **CSS 媒体查询**：`@media (pointer: coarse) and (min-width: 768px)` 可粗略识别 iPad 类设备。

## 四、设备类型与渲染引擎识别

### 4.1 设备类型判断

设备类型基于 UA 关键字 + 操作系统综合判断：

| 设备类型 | 判断规则 |
|----------|----------|
| mobile（手机） | 含 `Mobile`、`iPhone`、`Android`（含 Mobile）、`Mobi`、`Phone` |
| tablet（平板） | 含 `iPad`、`Android`（不含 Mobile）、`Tablet`、`PlayBook`、`Kindle` |
| desktop（桌面） | 含 `Windows NT`、`Macintosh`、`X11`、`Linux`（无 Mobile/iPad/Tablet） |
| bot（爬虫） | 含 `bot`、`spider`、`crawler`、`slurp`、`archive` 等关键字 |
| unknown | 无任何匹配（极少数情况） |

特别注意：

- **iPad 桌面版 UA** 会被识别为 desktop，这是 Apple 的设计而非工具 bug。如需精确识别需客户端检测触屏。
- **Android 平板** UA 中 `Android` 后通常不含 `Mobile`，如 `Mozilla/5.0 (Linux; Android 14; SM-X810) ...`。
- **Surface** 在桌面模式下 UA 同 Windows，在平板模式下 UA 同 Edge Mobile。

### 4.2 渲染引擎识别

主流渲染引擎只有四种：

| 引擎 | 主要浏览器 | UA 关键字 |
|------|------------|-----------|
| Blink | Chrome、Edge、Opera、360、QQ、UC、Brave、Vivaldi（基于 Chromium） | `AppleWebKit/537.36` + `Chrome/` |
| WebKit | Safari、所有 iOS 浏览器（iOS 强制 WebKit） | `AppleWebKit/` + 无 `Chrome/` |
| Gecko | Firefox、Thunderbird | `Gecko/` + `Firefox/` |
| Trident | IE 8-11（已废弃） | `Trident/` |
| Servo | 实验性，Mozilla 主导 | `Servo/` |

注意：Blink fork 自 WebKit 后保留了 `AppleWebKit/537.36` 标记，所以仅靠 `AppleWebKit/` 无法区分 Blink 与 WebKit，需配合 `Chrome/` 判断。

## 五、爬虫与机器人识别

### 5.1 主流搜索引擎爬虫

| 爬虫 | 所属 | UA 标识 |
|------|------|---------|
| Googlebot | Google | `Googlebot/2.1 (+http://www.google.com/bot.html)` |
| Bingbot | Microsoft | `bingbot/2.0` |
| Baiduspider | 百度 | `Baiduspider+(+http://www.baidu.com/search/spider.htm)`，另有 `Baiduspider-render`、`Baiduspider-image` 等子类 |
| Sogou Spider | 搜狗 | `Sogou web spider/4.0`、`Sogou Pic Spider` |
| 360Spider | 360 搜索 | `360Spider`、`360JK` |
| YisouSpider | 神马搜索（UC） | `YisouSpider` |
| YandexBot | 俄罗斯 Yandex | `YandexBot/3.0` |
| Applebot | Apple | `Applebot/0.1` |
| DuckDuckBot | DuckDuckGo | `DuckDuckBot/1.1` |

### 5.2 社交媒体爬虫

| 爬虫 | 所属 | UA 标识 |
|------|------|---------|
| Twitterbot | Twitter/X | `Twitterbot/1.0` |
| facebookexternalhit | Facebook | `facebookexternalhit/1.1` |
| LinkedInBot | LinkedIn | `LinkedInBot/1.0` |
| TelegramBot | Telegram | `TelegramBot (like TwitterBot)` |
| WhatsApp | WhatsApp | `WhatsApp/2.23` |
| Slackbot | Slack | `Slackbot-LinkExpanding 1.0` |
| Discordbot | Discord | `Discordbot/2.0` |

社交爬虫主要用于抓取分享链接的预览信息（OG 标签），频率不高但需正确识别以免误判为恶意访问。

### 5.3 HTTP 库与工具

| 库/工具 | UA 标识 |
|---------|---------|
| cURL | `curl/8.4.0` |
| Python Requests | `python-requests/2.31.0` |
| axios | `axios/1.6.0` |
| Go http | `Go-http-client/1.1` |
| Java HttpURLConnection | `Java/17.0.1` |
| Apache HttpClient | `Apache-HttpClient/4.5.13` |
| okhttp | `okhttp/4.12.0` |
| Wget | `Wget/1.21.3` |
| Postman | `PostmanRuntime/7.33.0` |
| Node.js fetch | `node-fetch/1.0` |

HTTP 库的默认 UA 是最易被识别的爬虫标识。最简单的反爬就是 ban 这些 UA，所以爬虫通常会改 UA。

### 5.4 Googlebot 真实性验证

恶意爬虫可伪装成 Googlebot UA 绕过反爬。Google 官方推荐的反向 DNS 验证流程：

1. 从访问日志中提取客户端 IP。
2. 反向 DNS 查询：`nslookup <ip>`，检查是否匹配 `*.googlebot.com` 或 `*.google.com`。
3. 正向 DNS 验证：对反向 DNS 得到的域名做正向查询，检查解析回的 IP 是否与原始 IP 一致。
4. 三者一致才信任为真实 Googlebot。

这套验证可防止恶意爬虫伪造反向 DNS（攻击者控制自己的 DNS 服务器返回 `googlebot.com`，但正向 DNS 无法伪造）。

## 六、UA-CH Client Hints：UA 的替代方案

### 6.1 传统 UA 的三大问题

1. **隐私泄露**：UA 含精细版本号、CPU 架构、设备型号，组合后可作为强指纹追踪用户。研究表明，仅靠 UA 字符串就能在百万用户中唯一识别 80%+ 的用户。
2. **兼容性陷阱**：UA 被大量网站用于浏览器嗅探，浏览器一旦修改 UA 就会破坏现有网站。导致 UA 字符串变成「冻结的历史包袱」，浏览器无法创新。
3. **解析脆弱**：UA 字符串无固定结构，正则解析易出错。不同浏览器格式差异大，新浏览器需伪装成老浏览器才能被识别。

### 6.2 UA-CH 的设计

UA-CH 通过结构化的 `Sec-CH-UA` 系列请求头传递客户端信息：

```http
# 默认请求头（每次请求都发）
Sec-CH-UA: "Chromium";v="120", "Not(A:Brand";v="24", "Google Chrome";v="120"
Sec-CH-UA-Mobile: ?0
Sec-CH-UA-Platform: "Windows"

# 服务器主动请求后才会发送（Accept-CH 响应头）
Sec-CH-UA-Platform-Version: "10.0.0"
Sec-CH-UA-Arch: "x86"
Sec-CH-UA-Bitness: "64"
Sec-CH-UA-Model: ""
Sec-CH-UA-Full-Version-List: "Chromium";v="120.0.6099.71", ...
```

设计要点：

- **品牌列表**：`Sec-CH-UA` 是品牌数组，含所有相关品牌（如 Chrome 含 Chromium、Not(A:Brand、Google Chrome 三个），品牌顺序随机以防指纹。
- **主版本号**：默认只发主版本号（`v="120"`），完整版本号需服务器主动请求。
- **GREASE**：`Not(A:Brand` 是故意插入的「垃圾」品牌，破坏指纹稳定性。
- **服务器请求**：服务器通过 `Accept-CH: Sec-CH-UA-Platform, Sec-CH-UA-Mobile` 响应头声明需要哪些精细字段，浏览器后续请求才会携带。

### 6.3 JavaScript API

```javascript
// 获取 UA-CH 数据
const uaData = navigator.userAgentData;
console.log(uaData.brands);       // [{brand: "Chromium", version: "120"}, ...]
console.log(uaData.mobile);       // false
console.log(uaData.platform);     // "Windows"

// 获取高熵数据（异步，需服务器通过 Accept-CH 声明）
const highEntropy = await uaData.getHighEntropyValues([
  'platformVersion',
  'architecture',
  'bitness',
  'model',
  'fullVersionList',
]);
```

### 6.4 UA Freezing 计划

Chrome 自 92 起逐步冻结 UA 字符串：

- **Phase 1（Chrome 92-100）**：默认冻结精细版本号，UA 中的 `Chrome/x.0.0.0` 用 `1.0.0.0` 替代。
- **Phase 2（Chrome 101-110）**：冻结操作系统版本，UA 中的 `Windows NT 10.0` 不变但 `Android 14` 变为 `Android 10.0.0`。
- **Phase 3（Chrome 111+）**：逐步冻结设备型号等精细信息。

冻结的目的是迫使开发者改用 UA-CH，但为了兼容性 UA 字符串不会被完全移除，只是变得「模糊」。

### 6.5 浏览器支持

| 浏览器 | UA-CH 支持 |
|--------|------------|
| Chrome 89+ | ✅ 完整支持 |
| Edge 89+ | ✅ 完整支持 |
| Opera 75+ | ✅ 完整支持 |
| Firefox | ❌ 暂不支持（截至 2024） |
| Safari | ❌ 暂不支持（截至 2024） |

Firefox 与 Safari 不支持 UA-CH 是因为隐私立场——他们认为 UA-CH 仍然是指纹源。但 Chrome 占全球 65%+ 市场份额，UA-CH 已是事实标准。生产环境推荐**优先使用 UA-CH，降级使用传统 UA**。

## 七、应用内 WebView 深度识别

### 7.1 微信 WebView

微信内打开网页时，UA 在系统浏览器 UA 基础上追加 `MicroMessenger/<version>`：

```
Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40
```

版本号含义：

- `< 6.0.2`：无法调用微信 JSSDK
- `>= 6.0.2`：支持基础 JSSDK（分享、扫一扫等）
- `>= 7.0.0`：支持小程序 WebView
- `>= 7.0.5`：支持 dark mode 适配
- `>= 8.0.0`：支持视频号等新功能

微信 WebView 还会附加 `MiniProgramEnv/<version>` 表示小程序环境：

```
... MicroMessenger/8.0.40 MiniProgramEnv/Mac ...
```

### 7.2 其他常见 WebView

| App | UA 标识 | 备注 |
|-----|---------|------|
| QQ（手机 QQ） | `QQ/<version>` | 注意与 QQ 浏览器（`QQBrowser`）不同 |
| QQ 浏览器 | `QQBrowser/<version>` 或 `MqqBrowser/<version>`（移动版） | M 前缀区分移动/桌面 |
| 微博 | `Weibo/__weibo` 或 `Weibo/<version>` | 国际版为 `WeiboIntl` |
| 支付宝 | `AlipayClient/<version>` | 支持 H5 调起原生支付 |
| 钉钉 | `DingTalk/<version>` | 企业应用开发 |
| 飞书 | `Lark/<version>` 或 `Feishu/<version>` | 国际版 Lark，国内版 Feishu |
| 抖音 | `aweme/<version>`、`ByteLocale`、`newsarticle` | 字节系多个 App 共用标识 |
| 今日头条 | `newsarticle/<version>` | |
| 知乎 | `Zhihu/<version>` | |
| 小米浏览器 | `MiuiBrowser/<version>` | |

### 7.3 识别要点

WebView UA 的核心特征是**系统浏览器 UA 为前缀 + 追加 App 标识**。所以解析时必须先匹配 App 标识（更特异），再回退到系统浏览器。如果先匹配 Chrome，所有 WebView 都会被识别为 Chrome，丢失 App 信息。

## 八、UA 伪造与反爬实战

### 8.1 UA 伪造的常见手段

1. **浏览器扩展**：User-Agent Switcher、UA Switcher 等扩展允许用户切换任意 UA。
2. **开发者工具**：Chrome DevTools 的设备模拟模式可修改 UA 测试移动端。
3. **命令行工具**：cURL 的 `-A` 参数、Wget 的 `--user-agent` 参数。
4. **HTTP 库**：所有 HTTP 库都支持自定义 UA。
5. **代理工具**：Charles、Fiddler、mitmproxy 等代理工具可批量修改 UA。

```bash
# cURL 伪造 Chrome UA
curl -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" https://example.com

# Python Requests 伪造 UA
import requests
headers = {'User-Agent': 'Mozilla/5.0 ...'}
r = requests.get('https://example.com', headers=headers)
```

### 8.2 反爬策略

仅靠 UA 识别爬虫易被绕过，需多层防护：

1. **UA 黑名单**：直接 ban HTTP 库 UA（`python-requests`、`curl`、`Wget` 等），可挡住最低级爬虫。
2. **UA 一致性检查**：UA 声称是 Chrome 但行为特征（请求频率、Referer、Cookie 处理）不符合浏览器的，降权处理。
3. **IP 频率限制**：单 IP 单位时间内请求数超过阈值触发验证码或临时封禁。
4. **行为分析**：浏览器访问有典型模式（首页 → 列表 → 详情），爬虫通常直接打详情接口。
5. **验证码**：可疑访问触发验证码，区分人机。
6. **设备指纹**：Canvas 指纹、WebGL 指纹、字体指纹等组合，但需注意隐私合规。
7. **Headless 浏览器检测**：检测 `navigator.webdriver`、`window.chrome`、`Notification.permission` 等 Headless Chrome 特征。

### 8.3 不要用 UA 做安全决策

UA 完全可伪造，**绝对不能用于身份认证或权限控制**。安全场景的正确做法：

- **身份认证**：Cookie / Token / JWT / Session
- **权限控制**：服务端 RBAC（基于角色的访问控制）
- **CSRF 防护**：SameSite Cookie + CSRF Token
- **XSS 防护**：CSP + 输入过滤 + 输出转义
- **爬虫防护**：多层策略（频率 + 行为 + 验证码 + 设备指纹）

### 8.4 用特性检测替代 UA 嗅探

判断浏览器是否支持某特性时，永远优先用特性检测：

```javascript
// ❌ 错误：UA 嗅探
if (ua.includes('Chrome') && !ua.includes('Edg')) {
  // 假设是 Chrome，使用某特性
}

// ✅ 正确：特性检测
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

// ✅ 正确：CSS 特性查询
@supports (display: grid) {
  .grid-layout { display: grid; }
}
```

特性检测的优势：

- **准确**：直接检测能力，不受 UA 伪造影响
- **前瞻**：新浏览器自动获得支持，无需更新代码
- **简洁**：无需维护 UA 模式表

UA 嗅探仅在少数场景必要（如统计访问来源、识别爬虫、调试特定浏览器 bug），其他场景都应优先特性检测。

## 总结

User-Agent 字符串是 HTTP 协议的重要元数据，但它的设计缺陷（无结构、易伪造、历史包袱重）使其成为「不可完全信任但仍需解析」的字段。理解 UA 的关键点：

1. **结构分解**：UA 由 product/comment 片段组成，含历史兼容标记与现代浏览器信息，需正确提取有效部分。
2. **识别顺序**：浏览器识别必须按特异性优先，先匹配 WebView 与国产浏览器，再匹配 Chromium 衍生，最后匹配主流国际浏览器。
3. **设备类型**：手机/平板/桌面的判断需结合 UA 关键字与操作系统，iPad 桌面陷阱需客户端触屏检测辅助。
4. **爬虫识别**：靠 UA 可识别已知爬虫，但无法识别伪装爬虫，需配合 IP 频率、行为分析、验证码等多层防护。
5. **UA-CH 替代**：Chrome 推动的 UA-CH 是未来方向，结构化、隐私友好、抗伪造，但 Firefox/Safari 暂不支持，生产环境需双轨。
6. **不要用于安全**：UA 可伪造，绝不能用于身份认证或权限控制，安全场景必须用 Cookie/Token/JWT。
7. **优先特性检测**：判断浏览器能力应优先用特性检测（`if ('foo' in window)`），UA 嗅探仅用于统计与调试。

UA 不是过时的历史包袱，而是**理解客户端与服务器交互的基础**。掌握 UA 解析能让你更好地设计自适应布局、识别爬虫、调试兼容性问题，但更重要的是理解它的局限——UA 是参考信息，不是信任依据。
