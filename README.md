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

共 **109 个在线开发工具** + **139 篇配套技术博客**，覆盖编码转换、加密哈希、时间日期、代码调试、网络计算、色彩设计、文档处理等常用场景。

---

## 🌐 在线访问

**生产环境**：[https://website.niuzi.asia](https://website.niuzi.asia)

---

## 🤖 Agent 自动维护

本项目采用 [增长实验与收益验证 Agent 规范 v3.0](./auto-site-spec.md) 运营，当前集中验证现有 109 个工具和 139 篇内容能否产生有效流量、付费线索与实际收入。

- 默认每天读取增量漏斗数据，无新增信号时直接跳过
- 核心漏斗：搜索曝光 → 访问 → 工具完成 → 付费线索 → 付费 → 收入
- 同一时间最多运行一个有基线、主指标和停止条件的实验
- 没有合格任务时零修改、零提交结束
- 优先建设统计看板，再优化热门工具易用性，并按真实需求每轮扩充一个工具
- 风险 ≤1、证据充分、工作区干净且完整检查全绿时自动单任务推送并部署
- 不以页面、提交和迭代数量衡量进展，只以漏斗改善和实际收入验证结果判断

---

## 特性

- 🚀 **零广告、零追踪** — 靠爱发电 / 捐赠驱动，不含任何广告联盟代码
- 🔒 **全本地处理** — 所有工具纯前端计算，数据不离开您的浏览器，打开浏览器开发者工具即可审计
- 📱 **移动端友好** — 375px / 768px / 1280px 三档响应式 + 暗色模式 + 复制即用
- 📝 **配套博客** — 139 篇深度技术博客（300+ 个标签），覆盖工具原理、最佳实践、安全指南
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

## 工具一览（109 个）

### 编码转换
`Base64` · `Base64 图片` · `图片压缩` · `图片格式转换` · `图片水印` · `图片裁剪` · `图片缩放` · `EXIF 信息查看器` · `EXIF 元数据编辑器` · `SVG 优化器` · `Base32` · `URL 编码` · `Hex 编码` · `Punycode (IDN)` · `HTML 实体` · `MIME 类型` · `进制转换` · `IEEE 754 浮点数` · `摩斯密码`

### 加密与安全
`AES 加解密` · `Hash 计算` · `JWT 解码 / 签名 / 验证` · `JWE` · `强密码生成` · `密码哈希（bcrypt / PBKDF2）` · `UUID 生成`

### 数据格式互转
`JSON 格式化` · `JSON Schema` · `JSON → TypeScript` · `JSON → XML` · `XML → JSON` · `JSONPath` · `CSV ⇄ JSON` · `CSV ⇄ Markdown 表格` · `YAML` · `YAML Schema` · `TOML` · `TOML Schema`

### 代码调试
`JavaScript 格式化` · `CSS 格式化` · `HTML 格式化` · `SQL 格式化` · `Markdown 预览` · `HTML 转 Markdown` · `正则测试` · `正则性能基准` · `Diff 文本对比` · `Lorem 占位文本` · `ASCII 艺术` · `文本统计分析` · `文本大小写转换` · `文本去重` · `文本排序` · `随机选择器` · `URL Slug 生成器` · `文本反转` · `字符替换` · `文本截断` · `文本相似度对比`

### 时间与日期
`Unix 时间戳` · `时间单位转换` · `时区转换` · `Cron 表达式`

### 网络与系统
`IP 子网计算` · `HTTP 状态码` · `HTTP Header 解析与生成` · `User-Agent 解析与识别` · `HTTP 请求代码生成器` · `DNS 查询工具` · `TLS 证书解析工具`

### 色彩与设计
`颜色值转换` · `调色板工具` · `色彩对比度检测（WCAG）` · `CSS 盒阴影生成器` · `CSS 渐变生成器` · `CSS 文字阴影生成器` · `CSS border-radius 生成器` · `CSS transform 可视化工具` · `CSS 滤镜生成器` · `CSS clip-path 路径裁剪生成器` · `CSS Flexbox 可视化生成器` · `CSS Grid 可视化生成器` · `CSS subgrid 子网格生成器` · `CSS animation 动画生成器` · `CSS transition 过渡生成器` · `CSS background 复合属性生成器` · `CSS scroll-snap 滚动捕捉生成器` · `CSS writing-mode 书写模式生成器` · `CSS @container 容器查询生成器` · `CSS Nesting 原生嵌套生成器` · `CSS @layer 层叠层生成器` · `CSS @scope 作用域生成器` · `CSS scroll-driven 动画生成器` · `CSS light-dark() 暗色模式生成器` · `CSS text-wrap 文本换行排版优化器` · `CSS contain 性能优化生成器` · `CSS view-transition 视图过渡生成器` · `CSS @starting-style 入场动画生成器` · `CSS interpolate-size 尺寸插值动画生成器` · `CSS 锚点定位生成器` · `CSS position-area 定位区域生成器` · `CSS if() 条件函数生成器` · `CSS 三角函数生成器` · `CSS 数学函数生成器`

### 其他
`二维码生成` · `单位转换` · `URL 解析`

---

## 技术栈

| 层级 | 技术方案 | 说明 |
| --- | --- | --- |
| 静态站点生成 | **Astro 5** | SSG `output: static`，仅输出可部署的 HTML/CSS/JS |
| 交互层 | React 18 + TypeScript 5.7 | 109 个 React 工具组件（`@astrojs/react`） |
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
│   ├── components/                # 109 个 React 工具组件（AesTool / Base64Tool / …）
│   ├── content/blog/              # 139 篇技术博客（.md）
│   ├── layouts/
│   │   └── BaseLayout.astro       # 全站基础布局
│   ├── pages/
│   │   ├── index.astro            # 首页（工具搜索/筛选 + 特色介绍 + 最新博客）
│   │   ├── about.astro            # 关于
│   │   ├── privacy.astro          # 隐私政策
│   │   ├── rss.xml.ts             # RSS 订阅源
│   │   ├── blog/                  # 博客列表/详情/标签 页（Astro Content Collections）
│   │   └── [109 个工具页].astro    # 独立工具页（每页独立 SEO）
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

每包含工具页均配独立 `title / description / OG meta / JSON-LD`，并纳入 sitemap 与 RSS。主要内容页面数量约 1042 页（含 139 篇博客 + 300+ 个标签筛选页 + 109 个工具页及其它）。

---

## 博客主题速览（139 篇）

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
- `http-headers-guide` HTTP Header 完全指南（请求头/响应头/CORS/安全/缓存）
- `user-agent-guide` User-Agent 完全指南（UA 结构、解析、UA-CH 与反爬实战）
- `http-request-code-generator-guide` HTTP 请求代码生成器实战（cURL/fetch/axios/Python/Go 多语言互转）
- `dns-query-guide` DNS 查询实战（从 DoH 协议到 16 种记录类型与 DNSSEC 验证）
- `tls-certificate-parsing-guide` TLS 证书深度解析（从 PEM 编码到 X.509 字段与 PKI 信任链）
- `svg-optimization-guide` SVG 优化深度指南（从编辑器残留到极致压缩的完整方案）
- `image-format-conversion-guide` 图片格式转换实战（PNG / JPEG / WebP / AVIF 选型与批量互转完全指南）
- `image-watermark-guide` 图片水印实战（Canvas API 文字/图片水印、九宫格定位、平铺布局、旋转防盗图与批量处理）
- `image-resize-guide` 图片缩放完全指南（5 种缩放模式、长边等比算法、双三次重采样、放大控制与 ZIP 批量打包原理）
- `exif-editing-guide` EXIF 元数据编辑实战（JPEG 二进制结构、APP1/TIFF/IFD 解析、原地修改策略与隐私清理）
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
- `layer-guide` CSS @layer 层叠层：级联优先级、!important 反转与第三方库隔离
- `scope-guide` CSS @scope 作用域：甜甜圈作用域、下边界与组件级样式隔离
- `scroll-driven-guide` CSS scroll-driven 动画：scroll() 与 view() 时间线、animation-range 与渐进增强
- `light-dark-guide` CSS light-dark() 暗色模式：双主题颜色函数、color-scheme 协同与渐进降级
- `text-wrap-guide` CSS text-wrap 文本换行：balance 平衡换行、pretty 优化换行与渐进降级
- `contain-guide` CSS contain 与 content-visibility 性能优化：渲染隔离、屏幕外跳过渲染与长列表优化
- `view-transition-guide` CSS view-transition 视图过渡：同文档/跨文档过渡、命名元素与伪元素动画
- `subgrid-guide` CSS subgrid 子网格：嵌套网格轨道继承、四种方向选型、gap 继承与渐进降级
- `starting-style-guide` CSS @starting-style 入场动画：元素首次出现过渡、display 切换与 popover 弹层动画
- `interpolate-size-guide` CSS interpolate-size 尺寸插值：auto/min-content/max-content 关键字过渡与 calc-size() 函数计算
- `anchor-positioning-guide` CSS 锚点定位：anchor-name/position-anchor 锚点绑定、anchor()/anchor-size() 函数、position-try-fallbacks 翻转避让
- `position-area-guide` CSS position-area 定位区域：3x3 网格模型、物理/逻辑/坐标三套关键字、span 跨格、popover 重置、默认对齐行为
- `css-if-guide` CSS if() 条件函数：style/media/supports 三类条件、多分支短路求值、嵌套与逻辑运算、降级实践
- `trigonometric-guide` CSS 三角函数：sin/cos/tan/atan2/hypot 与 pi()/e() 常量，弧度角度、圆周布局、振荡动画、玫瑰曲线与向日葵螺旋实战
- `css-math-functions-guide` CSS 数学函数：exp/log/sqrt/pow/abs/sign/mod/rem/round，对数刻度、幂律缓动、镜像布局、网格对齐与 mod/rem 符号差异实战
- `css-layout-alignment-toolchain-guide` CSS 布局对齐工具链实战：container/grid/flexbox/subgrid/scope 五工具端到端工作流
- `css-visual-motion-toolchain-guide` CSS 视觉与动效工具链实战：starting-style/transition/animation/scroll-driven/view-transition 五工具端到端工作流
- `color-design-token-toolchain-guide` 颜色与设计 Token 工具链实战：color/color-palette/color-contrast/gradient/light-dark 五工具端到端工作流
- `math-encoding-toolchain-guide` 数学与编码工具链实战：number-base/hex/ieee754/trigonometric/css-math 五工具端到端工作流
- `css-modern-features-toolchain-guide` CSS 新特性矩阵工具链实战：anchor-positioning/position-area/css-if/layer/nesting 五工具端到端工作流
- ……（共 139 篇，300+ 个标签）

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
你是 auto-website 的增长实验与收益验证 Agent。完整读取并严格执行：
e:\work\auto-website\auto-site-spec.md

项目已经上线且功能充足。你的目标是通过统计、易用性优化、数据驱动工具扩充和商业实验，提升有效流量、核心工具使用、付费线索和实际收入。

每次先读取 docs/site-config.md。只使用真实的 Search Console、访问统计、工具完成、用户需求、付费和收入数据。数据源未接入时标记 unavailable，禁止估算或凭感觉优化。

按顺序推进：第一，建设内部统计看板，展示访问人数、趋势和热门工具；第二，根据热门工具和失败路径优化界面、移动端和操作反馈；第三，根据 Search Console、站内搜索、用户反馈或工具链缺口，每轮最多新增一个工具；第四，验证付费定制、批量处理、桌面版、企业部署或赞助意向。

同一时间最多运行一个有基线、单一主指标、至少 7 天观察窗口和停止条件的实验。禁止无数据支撑的 SEO 轮换、结构化数据微调、模块拆分和批量新增工具。无 Cookie 统计、匿名工具事件、第一方需求表单和价格验证已授权；跨站追踪、设备指纹和广告画像禁止。赞助与支付采用托管页面，真实账号未配置时只登记需求，不得模拟收款。

只有实验评分达标、证据置信度 C >= 4、风险 R <= 1、工作区干净，且 npm run check、完整生产构建和相关测试全部通过时，才精确暂存本实验文件，自动创建一个提交并执行 git push origin HEAD。单次最多推送一个提交，push 失败不得追加提交。最后按规范输出增长漏斗、实验状态、收入变化和待授权事项。
```

---

## 🕐 质量信号任务

质量任务只为增长 Agent 提供可靠性护栏，不生成增长任务。

- **健康检查**：有新增部署、线上告警或失败信号时运行 `npm run check` 和相关构建检查
- **搜索与性能巡检**：只读取 Search Console、访问统计和 Core Web Vitals 的增量变化
- **体验巡检**：由用户反馈或可复现视觉回归触发，不固定每日修改样式
- **报告规则**：只有发现新问题时生成精简报告；无新问题时零文件结束
- **实施权限**：巡检结论先进入评分；只有风险 ≤1 且完整检查全绿时才自动单任务 commit、push 和部署

---

## 许可证

本项目基于 [Apache License 2.0](./LICENSE) 协议开源。

> Copyright © 2026 工具盒子 (Toolbox) 研发团队。

---

<div align="center"><sub>数据留在你手里，工具交给我们打磨 — Your data stays, our tools assist.</sub></div>
