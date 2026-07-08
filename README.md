<div align="center">

# 工具盒子 · Toolbox

*零广告 · 全本地处理 · 现代化中文开发者在线工具集*

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![Astro](https://img.shields.io/badge/Astro-5-ff5d01.svg?logo=astro)](https://astro.build)
[![Build](https://img.shields.io/badge/输出-静态站点-4c1.svg)](https://pages.cloudflare.com)

中文 ·
[部署指南](./docs/deployment-guide.md) ·
[隐私政策](./src/pages/privacy.astro)

</div>

---

**一个为中文开发者打造的免费、零广告、全本地处理在线工具集**。所有工具均在您的浏览器里运行，**数据不离开您的设备**。

> **零广告 · 零追踪 · 全本地处理 · 中文优先 · 响应式 · 暗色模式 · 复制即用**

共 **47 个在线开发工具** + **42 篇配套技术博客**，覆盖编码转换、加密哈希、时间日期、代码调试、网络计算、色彩设计、文档处理等常用场景。

---

## 🤖 Agent 自动维护

本项目由 **TRAE AI Agent 自驱迭代** 自动维护，遵循专属定时任务规范进行无人值守的调研、决策、开发、迭代与运营闭环。

- **规范文件**：[`auto-site-spec.md`](./auto-site-spec.md)（v1.2 质量优先通用版）
- **项目路径**：`e:\work/auto-website`（固定路径，Astro 静态站点）
- **进度记忆**：`e:\work/auto-website\memory\` 目录，按日期存放 `topics.md` 跨轮次延续进度
- **阶段判定文件**：`docs/site-config.md`（用户上线后填写，作为阶段切换核心依据）
- **调度模式**：2 小时定时调度，单轮产出 3–5 个最小可交付单元
- **核心迭代循环**：市场调研 & 赛道锁定 → MVP 精品开发 → 本地质量验收 → 用户部署上线 → 数据监测分析 → 体验 & 功能迭代 → 全站升级优化
- **三阶段路径**：阶段一（赛道调研 + 精品 MVP）→ 阶段二（数据驱动精细化迭代）→ 阶段三（全站升级与能力拓展）
- **核心定位**：产品质量和用户体验优先，变现为远期可选需求，不作为核心驱动
- **技术栈限定**：Next.js / Vite+React / Astro / Nuxt，优先适配 SEO、轻量化、快速部署
- **部署平台**：仅限免费公有平台 Vercel / Cloudflare Pages / Netlify，无需服务器运维
- **质量红线**：首屏 LCP < 2.5s、图片懒加载、无冗余依赖、Lighthouse 性能评分 > 80
- **Git 规范**：每个最小修改单元通过后立即 `git add`（仅本次文件）→ `git commit` → `git push origin HEAD`，提交信息使用中文，禁止 force push、reset --hard 等破坏性命令
- **运行风格**：默默干活，不主动通知用户；需用户介入的阻塞问题统一放在摘要「遗留问题」中

> 定时任务描述参数 > 规范默认参数。全站内容合法合规，严格遵守禁止开发方向约束（无违法/侵权/高风险/批量爬取/诱导点击）。

---

## 特性

- 🚀 **零广告、零追踪** — 靠爱发电 / 捐赠驱动，不含任何广告联盟代码
- 🔒 **全本地处理** — 所有工具纯前端计算，数据不离开您的浏览器，打开浏览器开发者工具即可审计
- 📱 **移动端友好** — 375px / 768px / 1280px 三档响应式 + 暗色模式 + 复制即用
- 📝 **配套博客** — 42 篇深度技术博客（91 个标签），覆盖工具原理、最佳实践、安全指南
- 🎨 **色彩设计** — 调色板 / 色值转换 / 对比度检测 / 配色灵感
- 🔧 **编码转换** — Base64/32、URL、Hex、Punycode、HTML 实体、CSV/JSON/YAML/TOML/XML 互转
- 🔐 **加密哈希** — AES / JWT 签名与验证 / JWE / 各类 Hash（SHA 系列）/ 强密码生成
- 🌐 **网络计算** | IP/子网计算、HTTP 状态码速查、MIME 类型
- ⏱️ **时间日期** | Unix 时间戳 / 时区转换 / 时间单位 / Cron 表达式
- 🛠️ **代码调试** | JSON 格式化、JSON Schema、JSON→TS、SQL/JS/CSS/HTML 格式化与压缩、正则测试、Diff、Lorem 占位
- 📱 **二维码** — 文本/链接/邮箱/电话/WiFi QR 生成
- 📊 **SEO 完备** — Astro 静态生成，独立 title/description + OG + JSON-LD + sitemap + RSS
- ⚡ **极致性能** — SSG 静态 HTML/CSS/JS，首屏 LCP < 2.5s，依赖全免费零重型框架

---

## 工具一览（47 个）

### 编码转换
`Base64` · `Base64 图片` · `Base32` · `URL 编码` · `Hex 编码` · `Punycode (IDN)` · `HTML 实体` · `MIME 类型`

### 加密与安全
`AES 加解密` · `Hash 计算` · `JWT 解码 / 签名 / 验证` · `JWE` · `强密码生成` · `UUID 生成`

### 数据格式互转
`JSON 格式化` · `JSON Schema` · `JSON → TypeScript` · `JSON → XML` · `XML → JSON` · `JSONPath` · `CSV ⇄ JSON` · `YAML` · `YAML Schema` · `TOML` · `TOML Schema`

### 代码调试
`JavaScript 格式化` · `CSS 格式化` · `HTML 格式化` · `SQL 格式化` · `Markdown 预览` · `正则测试` · `正则性能基准` · `Diff 文本对比` · `Lorem 占位文本` · `ASCII 艺术`

### 时间与日期
`Unix 时间戳` · `时间单位转换` · `时区转换` · `Cron 表达式`

### 网络与系统
`IP 子网计算` · `HTTP 状态码`

### 色彩与设计
`颜色值转换` · `调色板工具` · `色彩对比度检测（WCAG）`

### 其他
`二维码生成` · `单位转换` · `URL 解析`

---

## 技术栈

| 层级 | 技术方案 | 说明 |
| --- | --- | --- |
| 静态站点生成 | **Astro 5** | SSG `output: static`，仅输出可部署的 HTML/CSS/JS |
| 交互层 | React 18 + TypeScript 5.7 | 47 个 React 工具组件（`@astrojs/react`） |
| 内容 | Astro Content Collections | MD 博客 + 91 个标签合集 |
| SEO | `@astrojs/sitemap` | 自动生成 sitemap |
| 部署 | Vercel / Cloudflare Pages / Netlify | 纯静态，零服务器 |

技术栈限定（由 [TRAE 自动迭代规范 v1.2](./auto-site-spec.md)）：Astro / Next.js / Vite+React / Nuxt 主流框架；全部为**免费依赖、零重型框架**。

---

## 快速开始

### 环境要求

- Node.js ≥ 18

### 本地开发

```bash
git clone <repo-url> && cd auto-website
npm install
npm run dev          # Astro 开发服务器，默认 http://localhost:4321
npm run build        # SSG 构建到 dist/
npm run preview      # 本地预览构建产物
npm run check        # Astro 类型检查
```

### 部署到线上

| 平台 | 关键配置 |
| --- | --- |
| **Cloudflare Pages** | Build `npm run build` → Output `dist` |
| **Vercel** | 框架选 Astro → Build `npm run build` → Output `dist` |
| **Netlify** | Build `npm run build` → Publish `dist` |

详见 [docs/deployment-guide.md](./docs/deployment-guide.md)。

#### 部署前必须替换占位域名

| 文件 | 占位域名 | 说明 |
| --- | --- | --- |
| `astro.config.mjs` 的 `site` | `https://toolbox.example.com` | 主站 URL，影响 sitemap 与 RSS |
| `public/robots.txt` 的 `Sitemap` | `https://toolbox.example.com/sitemap-index.xml` | 爬虫 sitemap 地址 |

---

## 站点结构

```
auto-website/
├── public/                        # 静态资产
│   ├── favicon.svg
│   ├── og-image.svg               # 社交分享图
│   └── robots.txt                 # 爬虫规则（上线后替换 sitemap 域名）
├── src/
│   ├── components/                # 47 个 React 工具组件（AesTool / Base64Tool / …）
│   ├── content/blog/              # 42 篇技术博客（.md）
│   ├── layouts/
│   │   └── BaseLayout.astro       # 全站基础布局
│   ├── pages/
│   │   ├── index.astro            # 首页（工具搜索/筛选 + 特色介绍 + 最新博客）
│   │   ├── about.astro            # 关于
│   │   ├── privacy.astro          # 隐私政策
│   │   ├── rss.xml.ts             # RSS 订阅源
│   │   ├── blog/                  # 博客列表/详情/标签 页（Astro Content Collections）
│   │   └── [47 个工具页].astro    # 独立工具页（每页独立 SEO）
│   ├── styles/
│   │   └── global.css             # 全局样式
│   └── utils/                     # 26 个纯逻辑工具模块（前端独立运算）
├── docs/
│   ├── deployment-guide.md        # 完整部署指南（含占位替换、上线验收清单）
│   └── site-config.md             # 线上站点配置模板（上线后回写）
├── astro.config.mjs                # Astro 配置（site / output:static / React / Sitemap）
├── tsconfig.json                   # 严格模式 · React JSX · @/* → src/*
└── package.json                   # v0.1.0 · toolbox
```

每包含工具页均配独立 `title / description / OG meta / JSON-LD`，并纳入 sitemap 与 RSS。主要内容页面数量 158 页（含 42 篇博客 + 91 个标签筛选页）。

---

## 博客主题速览（42 篇）

涵盖工具深度教程、安全最佳实践、数据格式对比等方向，代表性主题：

- `aes-encryption-guide` AES 加解密实战
- `base64-encoding-guide` Base64 原理与编解码
- `jwt-security-best-practices` JWT 安全最佳实践
- `json-schema-validation-practice` JSON Schema 校验实践
- `color-contrast-accessibility` 色彩对比度与可访问性（WCAG）
- `ipv4-ipv6-cidr-subnetting` IPv4/IPv6 子网划分
- `diff-algorithms-lcs-myers` 文本差异算法（LCS / Myers）
- `password-strength-entropy` 密码强度与信息熵
- `markdown-practical-guide` Markdown 实战指南
- `punycode-idn-guide` 国际化域名与 Punycode
- `qr-code-design-guide` 二维码设计
- `http-status-codes-overview` HTTP 状态码速查
- ……（共 42 篇，91 个标签）

---

## 隐私与安全

- **零后端、全本地**：所有计算在浏览器端执行，服务器仅提供静态 HTML
- **零追踪**：不接入任何分析/广告/第三方追踪脚本
- **隐私政策**：详见 [/privacy](./src/pages/privacy.astro)
- **未成年人保护**：不收集手机号、身份证、支付信息等任何敏感数据

---

## 文档

- [部署指南](./docs/deployment-guide.md) — 占位域名替换 + 三平台部署 + 上线验收清单
- [站点配置模板](./docs/site-config.md) — 上线后回写，驱动 Agent 阶段切换
- [自动迭代规范 v1.2](./auto-site-spec.md) — TRAE AI Agent 建站定时任务规范（产品经理 + 全栈工程师 + 运营增长 三角色自主闭环）

---

## 设计哲学

- **产品质量 > 变现** — 功能、体验、性能优先；广告/捐赠仅作为远期可选拓展
- **中文优先** — 全站文案、注释、关键词针对中文开发者
- **零重依赖** — 全程免费依赖、零重型框架，保障轻量化与易部署
- **合规红线** — 不触碰违法/侵权/高风险（金融 医疗 法律 投资）/ 灰色内容 / 批量爬取 / 诱导点击

---

## 许可证

本项目基于 [Apache License 2.0](./LICENSE) 协议开源。

> Copyright © 2026 工具盒子 (Toolbox) 研发团队。

---

<div align="center"><sub>数据留在你手里，工具交给我们打磨 — Your data stays, our tools assist.</sub></div>
