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

共 **81 个在线开发工具** + **76 篇配套技术博客**，覆盖编码转换、加密哈希、时间日期、代码调试、网络计算、色彩设计、文档处理等常用场景。

---

## 🌐 在线访问

**生产环境**：[https://website.niuzi.asia](https://website.niuzi.asia)

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
- 📝 **配套博客** — 76 篇深度技术博客（300+ 个标签），覆盖工具原理、最佳实践、安全指南
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

## 工具一览（81 个）

### 编码转换
`Base64` · `Base64 图片` · `图片压缩` · `EXIF 信息查看器` · `Base32` · `URL 编码` · `Hex 编码` · `Punycode (IDN)` · `HTML 实体` · `MIME 类型` · `进制转换` · `IEEE 754 浮点数` · `摩斯密码`

### 加密与安全
`AES 加解密` · `Hash 计算` · `JWT 解码 / 签名 / 验证` · `JWE` · `强密码生成` · `密码哈希（bcrypt / PBKDF2）` · `UUID 生成`

### 数据格式互转
`JSON 格式化` · `JSON Schema` · `JSON → TypeScript` · `JSON → XML` · `XML → JSON` · `JSONPath` · `CSV ⇄ JSON` · `CSV ⇄ Markdown 表格` · `YAML` · `YAML Schema` · `TOML` · `TOML Schema`

### 代码调试
`JavaScript 格式化` · `CSS 格式化` · `HTML 格式化` · `SQL 格式化` · `Markdown 预览` · `HTML 转 Markdown` · `正则测试` · `正则性能基准` · `Diff 文本对比` · `Lorem 占位文本` · `ASCII 艺术` · `文本统计分析` · `文本大小写转换` · `文本去重` · `文本排序` · `随机选择器` · `URL Slug 生成器` · `文本反转` · `字符替换` · `文本截断` · `文本相似度对比`

### 时间与日期
`Unix 时间戳` · `时间单位转换` · `时区转换` · `Cron 表达式`

### 网络与系统
`IP 子网计算` · `HTTP 状态码`

### 色彩与设计
`颜色值转换` · `调色板工具` · `色彩对比度检测（WCAG）` · `CSS 盒阴影生成器` · `CSS 渐变生成器` · `CSS 文字阴影生成器` · `CSS border-radius 生成器` · `CSS transform 可视化工具` · `CSS 滤镜生成器` · `CSS clip-path 路径裁剪生成器` · `CSS Flexbox 可视化生成器` · `CSS Grid 可视化生成器` · `CSS animation 动画生成器` · `CSS transition 过渡生成器` · `CSS background 复合属性生成器` · `CSS scroll-snap 滚动捕捉生成器` · `CSS writing-mode 书写模式生成器` · `CSS @container 容器查询生成器` · `CSS Nesting 原生嵌套生成器`

### 其他
`二维码生成` · `单位转换` · `URL 解析`

---

## 技术栈

| 层级 | 技术方案 | 说明 |
| --- | --- | --- |
| 静态站点生成 | **Astro 5** | SSG `output: static`，仅输出可部署的 HTML/CSS/JS |
| 交互层 | React 18 + TypeScript 5.7 | 81 个 React 工具组件（`@astrojs/react`） |
| 内容 | Astro Content Collections | MD 博客 + 230+ 个标签合集 |
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
| `astro.config.mjs` 的 `site` | `https://website.niuzi.asia` | 主站 URL，已配置，影响 sitemap 与 RSS |
| `public/robots.txt` 的 `Sitemap` | `https://website.niuzi.asia/sitemap-index.xml` | 爬虫 sitemap 地址，需同步更新 |

---

## 站点结构

```
auto-website/
├── public/                        # 静态资产
│   ├── favicon.svg
│   ├── og-image.png               # 社交分享图（PNG，主流平台兼容）
│   ├── og-image.svg               # 社交分享图源文件（用于重新生成 PNG）
│   └── robots.txt                 # 爬虫规则（上线后替换 sitemap 域名）
├── src/
│   ├── components/                # 81 个 React 工具组件（AesTool / Base64Tool / …）
│   ├── content/blog/              # 76 篇技术博客（.md）
│   ├── layouts/
│   │   └── BaseLayout.astro       # 全站基础布局
│   ├── pages/
│   │   ├── index.astro            # 首页（工具搜索/筛选 + 特色介绍 + 最新博客）
│   │   ├── about.astro            # 关于
│   │   ├── privacy.astro          # 隐私政策
│   │   ├── rss.xml.ts             # RSS 订阅源
│   │   ├── blog/                  # 博客列表/详情/标签 页（Astro Content Collections）
│   │   └── [81 个工具页].astro    # 独立工具页（每页独立 SEO）
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

每包含工具页均配独立 `title / description / OG meta / JSON-LD`，并纳入 sitemap 与 RSS。主要内容页面数量 536 页（含 76 篇博客 + 300+ 个标签筛选页 + 81 个工具页及其它）。

---

## 博客主题速览（76 篇）

涵盖工具深度教程、安全最佳实践、数据格式对比等方向，代表性主题：

- `aes-encryption-guide` AES 加解密实战
- `base64-encoding-guide` Base64 原理与编解码
- `jwt-security-best-practices` JWT 安全最佳实践
- `json-schema-validation-practice` JSON Schema 校验实践
- `color-contrast-accessibility` 色彩对比度与无障碍（WCAG）
- `ipv4-ipv6-cidr-subnetting` IPv4/IPv6 子网划分
- `diff-algorithms-lcs-myers` 文本差异算法（LCS / Myers）
- `password-strength-entropy` 密码强度与信息熵
- `markdown-practical-guide` Markdown 实战指南
- `punycode-idn-guide` 国际化域名与 Punycode
- `qr-code-design-guide` 二维码设计
- `http-status-codes-overview` HTTP 状态码速查
- `text-analysis-word-count-guide` 文本统计分析与字数统计
- `number-base-conversion-guide` 进制转换与 BigInt 精度
- `text-case-conversion-guide` 文本大小写与命名风格转换
- `text-dedup-guide` 文本去重与数据清洗
- `text-sort-guide` 文本排序与自然排序算法
- `random-picking-guide` 随机选择与拒绝采样原理
- `slug-generation-guide` URL Slug 生成与 SEO 链接结构
- `text-reverse-guide` 文本反转与 Unicode 代理对处理
- `find-replace-guide` 字符替换与正则捕获组引用
- `text-truncation-guide` 文本截断与 Unicode 码点边界处理
- `text-similarity-guide` 文本相似度计算（Levenshtein / Jaccard / LCS）
- `morse-code-guide` 摩斯密码编解码与 Web Audio API 音频合成
- `ieee754-floating-point-guide` IEEE 754 浮点数可视化与精度丢失根源
- `html-to-markdown-guide` HTML 转 Markdown：DOMParser 解析与 GFM 扩展实现
- `csv-markdown-guide` CSV 与 Markdown 表格互转：GFM 管道表格语法与状态机解析
- `image-compression-guide` 图片压缩：Canvas API、格式选型与质量权衡
- `password-hash-guide` 密码哈希：bcrypt 与 PBKDF2 实现原理与对比
- `exif-metadata-guide` EXIF 元数据：图片信息解析、相机参数与隐私保护
- `box-shadow-guide` CSS box-shadow 盒阴影：语法、多层叠加与 Material Design 体系
- `gradient-guide` CSS 渐变：linear-gradient、radial-gradient、conic-gradient 与颜色停止点
- `text-shadow-guide` CSS text-shadow 文字阴影：霓虹、3D、描边与浮雕效果实现
- `border-radius-guide` CSS border-radius 圆角：单一值、四角独立与椭圆八值斜杠语法
- `transform-guide` CSS transform 变换：translate、rotate、scale、skew 与变换原点
- `filter-guide` CSS filter 滤镜：blur、brightness、contrast 等 10 种函数与组合应用
- `clip-path-guide` CSS clip-path 路径裁剪：polygon、circle、ellipse、inset 四类函数与交互式顶点编辑
- `flexbox-layout-guide` CSS Flexbox 弹性盒子布局：主轴交叉轴、容器与项属性、典型布局模式
- `grid-layout-guide` CSS Grid 网格布局：轨道、fr 单位、二维布局、典型布局模式与 Flexbox 协同
- `animation-guide` CSS animation 动画：@keyframes 关键帧、八大子属性、缓动函数与性能优化
- `transition-guide` CSS transition 过渡：四大子属性、cubic-bezier 曲线、steps 阶跃与回弹效果
- `background-guide` CSS background 复合属性：多层背景叠加、简写语法、文字裁剪与视差效果
- `scroll-snap-guide` CSS scroll-snap 滚动捕捉：轴与严格度、对齐方式、mandatory 与 proximity 选型
- `writing-mode-guide` CSS writing-mode 书写模式：竖排文字、多语言排版、阿拉伯文 RTL 与国际化文本方向
- `container-query-guide` CSS @container 容器查询：组件级响应式设计、container-type 与 @media 对比
- `nesting-guide` CSS Nesting 原生嵌套：& 选择器、@media 嵌套与 Sass 对比
- ……（共 76 篇，300+ 个标签）

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

## 🤖 定时任务 Agent 提示词

```text
你是自主创业型 Agent，目标是独立打造一个高质量的工具/内容类网站。严格按照规范执行，本描述优先级高于规范默认值：e:\work\auto-website\auto-site-spec.md

核心原则（覆盖规范默认值）：
- 质量优先：以产品体验、功能完整性、SEO质量、性能表现为核心决策依据
- 变现后置：广告/捐赠仅为远期可选参考，不作为当前阶段的核心目标，不驱动功能优先级排序
- 单轮时长上限：5 小时
- 方向收敛：首轮调研敲定最终赛道后，后续不再随意更换大方向，聚焦深度打磨

核心要素：
1. 项目路径：e:\work\auto-website（直接在当前目录工作，无需另行创建）
2. 规范文档：e:\work\auto-website\auto-site-spec.md（首次运行先通读全文）
3. 三阶段路径：
   - 阶段一：调研选型 + MVP 开发（本地完成）→ 产出完整可用的最小产品，可直接部署上线
   - 阶段二：数据驱动迭代（上线后）→ 基于访问数据优化体验、扩充功能、提升SEO与性能
   - 阶段三：体验与规模升级（有稳定流量后）→ 扩展核心能力、完善全站体验、探索增值功能
4. 角色：产品经理 + 全栈工程师 + 运营增长
5. 六步闭环：上下文恢复 → 动态规划 → 小步编码 → 全量验收 → 计划复盘 → 进度沉淀
6. 进度记忆：e:\work\auto-website\memory\最近日期目录（读取 topics.md 承接上轮；写入当天日期目录如 20260702/topics.md）
7. 站点配置：e:\work\auto-website\docs\site-config.md（用户上线后回写，作为阶段切换依据）
8. 技术栈：自主选定主流框架（Next.js / Vite+React / Astro / Nuxt），支持免费部署（Vercel / Cloudflare Pages / Netlify）
9. 单轮产出：保证每个单元的完成质量
10. Git 提交规范（强制执行）：每次完成一个最小修改单元并通过验收后，必须立即执行 git add（仅添加本次修改的文件，禁止 git add -A）→ git commit → git push origin HEAD 提交代码。提交信息使用中文，格式：feat/fix/refactor/docs: 简要描述修改内容。禁止：修改 git config、force push、push --force-with-lease、reset --hard、branch -D、clean -f 等破坏性命令。
11. 禁止方向：违法违规/需大量人工运营/需真人出镜/金融医疗法律等高风险领域/抓取他人数据/误导点击广告

执行流程：
- 第一步 上下文恢复：读取 e:\work\auto-website\docs\site-config.md（若存在）判断阶段；读取最近日期 topics.md 承接上轮进度；项目未初始化则进入阶段一市场调研
- 第二步 动态规划：按阶段优先级选取任务，单次聚焦1个核心方向，拆解为可独立验证的最小单元；优先解决当前最大的质量/体验瓶颈
- 第三步 小步编码：单次只完成一个最小单元并立即验证，改动前记录原内容，构建失败可快速回滚
- 第四步 全量验收：功能可用无Bug、移动端三档适配、SEO要素完整、无控制台报错、性能达标
- 第五步 复盘迭代：标记完成项，识别新问题，调整下一轮任务优先级
- 第六步 进度沉淀：更新当天 topics.md（完成任务/修改文件/问题与发现/下轮建议）；MVP 就绪则更新 docs/deployment-guide.md

质量红线：
- 语义化 HTML、响应式布局、无障碍访问、SEO 友好
- 性能标准：首屏 LCP < 2.5s，单页 JS bundle < 200KB，图片懒加载
- 不引入付费依赖，不引入重型框架
- 所有代码注释、页面前端文案使用中文
- 每个页面具备完整的空状态、加载态、错误提示

每轮运行任务（项目已超过 MVP 阶段，已进入阶段二数据驱动迭代）：
1. 读取 docs/site-config.md 与最近 topics.md，判定阶段并承接上轮进度
2. 阶段二：基于线上访问数据做数据驱动优化，提升 SEO/性能/体验；环境限制类任务（Lighthouse 基线测量、移动端 375px 三档适配实测、线上浏览器验证）连续多轮无法突破可跳过，等待用户配置 TRAE Sandbox 白名单或换环境执行
3. 阶段三：功能与内容拓展、粘性功能、流量渠道拓展
4. 按规范模板输出本轮工作摘要，明确下一轮开发计划

需用户操作时（如部署、域名配置、第三方服务申请）明确提示。默默干活，结束后按规范第十节模板输出工作摘要。
```

---

## 🕐 质量保障定时任务

本项目除自驱迭代任务外，还配置了两个每日质量保障定时任务，**每天 00:00（北京时间）** 执行，与自动开发并行运行，形成「开发—检查—优化」闭环。

### 1. Bug 检查任务

- **任务名称**：`auto-website Bug 检查`
- **执行时间**：每天 00:00（Asia/Shanghai）
- **检查范围**：
  - 项目根目录：运行 `npm run check`（即 `astro check`）检查类型，运行 `npm run build` 检查构建是否通过（本项目为 Astro 项目，无 lint / test 脚本）
  - 审查 `src/components/` 工具组件（JsonTool / JwtTool / RegexTool / HashTool 等全部 81 个工具组件）
  - 审查 `src/pages/` 页面（.astro 文件）、`src/utils/` 工具函数（aes / jsonPath / jsonSchema / jwe 等加密解析逻辑）、`src/layouts/BaseLayout.astro`、`src/styles/global.css`、`astro.config.mjs`
  - 分析最近一次提交变更（`git diff HEAD~1`），重点关注工具组件逻辑错误（加密解密 / 格式转换 / 编码解码）、类型错误、Astro 客户端/服务端边界问题（`client:` 指令使用）、安全问题（XSS / eval / CSP）、SEO 问题（meta / sitemap / robots）、性能问题
- **输出位置**：`docs/bug-check/bug-check-YYYYMMDD.md`
- **原则**：只读不写，仅生成检查报告，不修改任何代码

### 2. 前端样式优化任务

- **任务名称**：`auto-website 前端样式优化`
- **执行时间**：每天 00:00（Asia/Shanghai）
- **优化范围**：
  - 审查 `src/layouts/BaseLayout.astro`、`src/styles/global.css`、`src/pages/index.astro`、`src/pages/about.astro`
  - 重点工具页面：json / jwt / regex / hash / qr / password / color / diff 等 `.astro` 页面
  - 博客页面：`src/pages/blog/index.astro`、`src/pages/blog/[...slug].astro`
  - 抽查 `src/components/` 下工具组件样式
  - 使用 `frontend-design` 技能审查页面设计质量，统一工具组件视觉风格（输入框 / 按钮 / 结果展示区），改善配色、间距、字体，优化响应式布局与交互体验（hover / focus / 复制成功反馈等）
- **验证**：修改后运行 `npm run build` 确保构建通过，不破坏现有功能
- **输出位置**：`docs/style-optimization/style-opt-YYYYMMDD.md`

> 两个任务均设置了「当天已有同名报告则跳过」的防重复规则，避免覆盖既有成果。

---

## 许可证

本项目基于 [Apache License 2.0](./LICENSE) 协议开源。

> Copyright © 2026 工具盒子 (Toolbox) 研发团队。

---

<div align="center"><sub>数据留在你手里，工具交给我们打磨 — Your data stays, our tools assist.</sub></div>
