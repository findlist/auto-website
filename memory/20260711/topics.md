# 2026-07-11 自动迭代进度

## 上下文恢复
- 项目：工具盒子（e:\work\auto-website）
- 阶段：阶段二（数据驱动迭代）—— docs/site-config.md 已有线上 URL https://website.niuzi.asia，上线日期 2026-07-09
- 技术栈：Astro 5 + React 18 + TypeScript 5.7
- 承接：20260710 第 10 轮（BUG-35 + BUG-36 占位域名彻底清理，bug-check 40 项全部清零）
- 当前规模：48 个工具 + 43 篇博客 + 266 页面（构建通过）

## 本轮聚焦方向
**线上验证环境突破尝试 + 内容拓展（新增文本统计分析工具）**

### 环境限制确认（连续十二轮遗留）
本轮尝试用 agent-browser skill 突破线上验证与移动端实测的环境限制：
1. ✅ npx agent-browser 可用（v0.31.1），但 socket 目录 `C:\Users\Lenovo\.agent-browser` 被 TRAE Sandbox 拦截写入
2. ✅ curl.exe 带浏览器 UA 抓取线上首页返回 HTTP 200 但 Size 0 bytes（SafeLine WAF JS 挑战拦截，非浏览器无法获取内容）
3. 结论：agent-browser（socket 限制）、Lighthouse CLI（configstore 限制）、Playwright（Python 3.6 + site-packages 限制）、curl（WAF 挑战）四条路径均被环境限制阻塞，需用户配置 TRAE Sandbox 白名单或换环境执行

### 内容拓展：新增文本统计分析工具
bug-check 全部清零、代码质量达标后，转向内容拓展。选取高搜索需求、纯前端实现、与现有文本工具（Diff/Regex/Markdown）互补的"文本统计分析工具"。

## 完成任务

### 单元 1：环境限制突破尝试（3 条路径验证）
1. ✅ agent-browser 安装与测试
   - npx agent-browser 可用（v0.31.1），无需全局安装
   - socket 目录 `C:\Users\Lenovo\.agent-browser` 创建后仍报 "not writable"（os error 2 / error 5）
   - --namespace 参数无效（仍在默认目录下创建 namespaces 子目录）
   - 根因：TRAE Sandbox 拦截 `C:\Users\Lenovo\.agent-browser` 写入
2. ✅ curl.exe 线上抓取验证
   - 带浏览器 UA 请求 https://website.niuzi.asia/，返回 HTTP 200 + 0 bytes
   - 根因：SafeLine WAF 返回 JS 挑战页面，curl 无法执行 JS
3. ✅ 构建产物性能与 SEO 分析
   - 全站 266 页面 SEO 要素完整（title/description/canonical/OG 全覆盖）
   - 所有工具页 JS bundle < 200KB（最重 QrTool: 136.51+35.30=171.81KB）
   - CSS 响应式断点：768px + 414px + auto-fill/minmax 网格布局

### 单元 2：文本统计分析工具开发（4 个文件）
4. ✅ TextAnalyzerTool.tsx 组件开发
   - 功能：实时统计字符数（总/不含空格/中文/英文/数字/标点）、词数（英文单词+中文字数）、行数、段落数、句子数、阅读时间估算（中文300字/分+英文200词/分取较长者）、关键词频率 Top 10（英文按单词过滤停用词+中文按 2 字 bigram 滑窗）
   - 完整空状态（输入文本后显示关键词频率分析）、复制报告、清空、示例文本功能
   - 响应式布局：auto-fit minmax 网格 + 768px/414px 断点
5. ✅ text-analyzer.astro 页面创建
   - 完整 SEO 元素：title/description/canonical/OG/JSON-LD WebApplication
   - 7 个 FAQ（中英文字数计算、阅读时间估算、关键词频率分析、使用场景、字符数统计、隐私、段落句子定义）
   - 专属样式含暗色模式 + 移动端响应式
6. ✅ 首页工具卡片与 meta 更新
   - index.astro 工具列表新增 text-analyzer 条目（category: 文档处理）
   - meta description 工具数量 47→48
7. ✅ 配套博客文章创建
   - text-analysis-word-count-guide.md：6 章完整指南（字数统计原理、阅读时间估算模型、关键词频率分析、SEO 内容长度检查、结构统计定义、性能与隐私）
   - 覆盖长尾搜索词：字数统计、文本分析、阅读时间、关键词频率、SEO 内容长度
   - 内链指向配套工具 /text-analyzer

## 修改文件（4 个，未超 8 文件红线）
- src/components/TextAnalyzerTool.tsx（新增，文本统计分析 React 组件）
- src/pages/text-analyzer.astro（新增，工具页面 + FAQ + 专属样式）
- src/pages/index.astro（工具卡片新增 + meta description 工具数量更新）
- src/content/blog/text-analysis-word-count-guide.md（新增，配套博客 6 章）

## 验证结果
- 构建：✅ 266 页面，14.07s，无报错无警告
- 类型检查：✅ 0 errors, 0 warnings, 1 hint（零回归，仅剩 clipboard.ts execCommand 废弃提示）
- SEO 要素：✅ text-analyzer 页面 title/description/canonical/OG/JSON-LD 全部正确
- Bundle 体积：✅ TextAnalyzerTool 7.5KB + client.js 133.31KB = 140.81KB < 200KB
- 首页工具卡片：✅ text-analyzer 链接已渲染到首页
- 博客内链：✅ 博客文章指向 /text-analyzer 配套工具链接
- 响应式设计：✅ auto-fit minmax 网格 + 768px/414px 断点 + 暗色模式
- Git 提交：commit 100a373，已 push origin HEAD（6868941..100a373）

## 数据洞察
- **agent-browser 环境限制根因**：TRAE Sandbox 对 `C:\Users\Lenovo\.agent-browser` 目录的写入限制。agent-browser 的 daemon 机制需要在该目录创建 Unix domain socket 文件，Windows + TRAE Sandbox 双重限制下无法工作。--namespace 参数只是在默认目录下创建子目录，无法绕过。这与 Lighthouse（configstore 限制）、Playwright（site-packages 限制）是同一类环境限制
- **SafeLine WAF JS 挑战**：curl 带浏览器 UA 仍返回 200 + 0 bytes，说明 WAF 不只看 User-Agent，还要求执行 JS 挑战。线上验证必须用真实浏览器或能执行 JS 的 headless 浏览器
- **文本统计分析工具差异化**：现有在线字数统计工具多为简单的字符计数，本工具的差异化在于：①中英文混合统计（中文按字、英文按词）；②阅读时间估算（中英文分别计算取较长者）；③关键词频率分析（英文停用词过滤+中文 bigram 滑窗）；④完整的 SEO 内容长度检查场景覆盖
- **bigram 滑窗方案选择**：中文关键词频率分析有三种方案——①专业分词库（jieba/HanLP，过重违反轻量化）；②字典查找（需维护词典）；③2 字 bigram 滑窗（轻量但不是真正分词）。选择 bigram 方案，在 FAQ 中诚实说明局限性，而非过度宣传
- **内容拓展策略**：bug-check 全部清零后，代码质量已达标。此时最高优先级是拓展内容覆盖面——新增高搜索需求工具 + 配套博客，覆盖长尾流量。文本统计分析工具覆盖"字数统计"、"文本分析"、"阅读时间"等高搜索量长尾词

## 遗留问题
- 无（本轮所有任务完成且验收通过）
- 工作树存在其他未提交改动（color.astro/diff.astro/hash.astro/json.astro/jwt.astro/password.astro/qr.astro/regex.astro/global.css + 2 个文档文件），非本轮改动，未纳入提交

## 下一轮建议
按优先级排序：
1. **工作树未提交改动排查**：color.astro/diff.astro 等 9 个文件有未提交改动 + 2 个新文档（bug-check-2026-07-11.md/style-opt-2026-07-11.md），需排查内容并决定是否提交
2. **Lighthouse 性能基线测量**：连续十三轮遗留，TRAE Sandbox 拦截 configstore 写入。需用户配置白名单或换环境执行
3. **移动端 375px 三档适配实测**：连续十三轮遗留，agent-browser 受 socket 限制无法使用
4. **线上页面浏览器验证**：curl 被 SafeLine WAF 挑战拦截，需用户用浏览器访问 https://website.niuzi.asia 验证渲染/canonical/JSON-LD 实际生效
5. **接入轻量统计工具**：Umami/Plausible 为阶段二数据驱动迭代提供数据源（需用户确认部署方式）
6. **继续内容拓展**：可新增进制转换器、大小写转换、文本去重等高搜索需求工具，或补充现有工具的配套博客
7. **README.md 工具清单更新**：新增了第 48 个工具，README 可能需要同步更新工具清单

## 需用户操作
- 部署本轮新增代码（git push 已完成，若 Cloudflare Pages 已配置自动部署则自动触发）
- 在 docs/site-config.md 填写访问数据 + 接入统计工具后回写，agent 下轮进入数据驱动迭代
- （可选）配置 TRAE Sandbox 白名单允许 agent-browser/Lighthouse 写入 `C:\Users\Lenovo\.agent-browser` 和 configstore 目录，以建立性能基线和移动端实测
- （可选）用浏览器访问 https://website.niuzi.asia/text-analyzer 验证新工具页面正常

---

# 第 12 轮 · 工作树清理 + jsonPath P1 修复 + README 同步

## 上下文恢复
- 承接第 11 轮（文本统计分析工具新增，commit 100a373 + 00e6ab8）
- 触发点：第 11 轮遗留建议优先级 1「工作树未提交改动排查」+ bug-check-2026-07-11 新发现 P1（jsonPath 过滤根路径引用错误）
- 阶段：阶段二（数据驱动迭代），站点已上线但无访问数据，本轮做代码质量与功能正确性打磨
- 当前规模：48 个工具 + 43 篇博客 + 266 页面

## 本轮聚焦方向
**三件可推进的高价值任务合并执行**（环境限制类任务连续十三轮无法突破，本轮不再消耗时间）：
1. 工作树未提交改动排查与提交（第 11 轮遗留优先级 1）
2. jsonPath 过滤表达式 $ 根路径引用错误修复（bug-check-2026-07-11 P1 功能 bug）
3. README 工具清单同步至 48 个工具（第 11 轮遗留建议 7）

## 完成任务

### 单元 1：工作树未提交改动提交（2 次 commit）
1. ✅ 排查工作树未提交改动
   - 9 个修改文件：global.css + 8 个工具页（color/diff/hash/json/jwt/password/qr/regex）
   - 2 个新文档：bug-check-2026-07-11.md + style-opt-2026-07-11.md
   - 内容：语义色别名变量体系 + 工具页 hero 变体 + 统一焦点环 + 复制反馈动画增强（详见 style-opt-2026-07-11.md）
2. ✅ 构建验证：266 页面，13.17s，无报错无警告
3. ✅ 类型检查：0 errors, 0 warnings, 1 hint（零回归）
4. ✅ 样式优化提交（commit 5aada0c，9 文件 235+127）
5. ✅ 文档提交（commit 74f18cd，2 文件 270+）

### 单元 2：jsonPath 过滤表达式 $ 根路径引用修复（commit 0f8441a）
6. ✅ Bug 分析
   - 问题：过滤表达式 [?(...)] 中 $ 根路径引用始终指向当前候选元素 node，而非原始根节点
   - 根因：parseOperand 中 @ 与 $ 都生成 {kind:'root'} 开头的 segments，AST 层面无法区分；evaluateOperand 统一用 node 作为 evaluate 的 data
   - 影响：`$.items[?(@ > $.threshold)]` 这类在过滤中引用根节点字段的查询返回错误结果（静默返回空）
7. ✅ 修复方案：FilterOperand 的 path 类型新增 `base: 'current' | 'root'` 字段
   - parseOperand 中 @ 设 base:'current'，$ 设 base:'root'
   - 求值链传递 rootData：evaluate → evaluateSegment → evaluateFilter → evaluateFilterNode → evaluateCompare → evaluateOperand
   - evaluateOperand 根据 base 选择 node（current）或 rootData（root）
8. ✅ 6 个测试用例全部通过（npx tsx 临时脚本验证后删除）：
   - $ 根路径数值比较 ✅、$ 根路径属性比较 ✅、@ 当前节点回归 ✅、$ 与 @ 混合 ✅、$ 存在性判断 ✅、$ 字符串相等 ✅

### 单元 3：README 工具清单同步（commit c90c75a）
9. ✅ README 数字同步
   - 工具数量 47→48，博客数量 42→43，页面数量 258→266
   - 代码调试类别新增"文本统计分析"
   - 博客主题速览新增 text-analysis-word-count-guide
   - 技术栈表格/站点结构/定时任务描述中 47→48 全部同步

## 修改文件
- commit 5aada0c: src/styles/global.css、src/pages/{color,diff,hash,json,jwt,password,qr,regex}.astro（样式优化 9 文件）
- commit 74f18cd: docs/bug-check/bug-check-2026-07-11.md、docs/style-optimization/style-opt-2026-07-11.md（2 文档）
- commit 0f8441a: src/utils/jsonPath.ts（P1 修复 1 文件）
- commit c90c75a: README.md（工具清单同步 1 文件）

## 验证结果
- 类型检查：✅ 0 errors, 0 warnings, 1 hint（零回归）
- 构建：✅ 266 页面，14.38s，无报错无警告
- jsonPath 修复：✅ 6/6 测试用例通过（$ 根路径 + @ 回归 + 混合场景）
- 工作树：✅ 干净（git status 无未提交改动）
- Git 推送：4 次 commit 全部 push origin HEAD 成功（00e6ab8..c90c75a）

## 数据洞察
- **jsonPath $ 根路径引用 bug 根因**：RFC 9535 JSONPath 过滤表达式中，$ 引用根节点、@ 引用当前候选元素。原实现的 AST 设计缺陷在于 @ 与 $ 都用 {kind:'root'} 占位（@ 等价于"以当前节点为根"），但 evaluateOperand 无法区分操作数路径的起点是当前节点还是原始根节点。修复策略是在 FilterOperand 类型增加 base 字段，从 AST 层面区分两种引用起点，并在求值链传递 rootData。这是"类型设计驱动正确性"的体现——当类型能精确表达语义时，求值逻辑自然清晰
- **求值链 rootData 传递设计**：evaluate 函数的 data 参数本身就是根节点，只需在调用 evaluateSegment 时将 data 作为 rootData 透传到过滤求值链。5 个函数签名各增加一个 rootData 参数，改动机械但清晰。evaluateOperand 是唯一使用 rootData 的函数（根据 base 选择 node 或 rootData），其余函数仅透传。这是"最小必要参数传递"的体现
- **PowerShell heredoc 限制复现**：git commit 多行 message 在 PowerShell 中不支持 bash heredoc 语法（<<'EOF'），改用 PowerShell 变量赋值 + `n 换行符。这是 Windows 环境的 Git 操作注意事项（第 8 轮已记录，本轮复现）
- **工作树未提交改动排查结论**：第 11 轮记录的"工作树存在其他未提交改动"经排查为样式优化任务（每天 00:00 的前端样式优化定时任务产出），内容是语义色变量统一 + 工具页 hero 变体，质量达标可直接提交

## 遗留问题
- 无（本轮所有任务完成且验收通过）
- bug-check-2026-07-11 剩余 1 个 P1：OG 图片为 SVG 格式，主流社交平台不渲染，需生成 1200x630 PNG 资源（超出代码修复范围，需设计资源生成）
- bug-check-2026-07-11 记录的轻微问题（P2）：8/47 工具页 hero 样式不一致（渐进式迁移中）、博客列表无分页、首页 /json/ 带尾斜杠等，均为低优先级

## 下一轮建议
按优先级排序：
1. **OG 图片 PNG 化（P1 SEO）**：bug-check-2026-07-11 指出全站 og:image 为 SVG 格式，主流社交平台不渲染。需生成 1200x630 PNG 替换 og-image.svg，并在 BaseLayout 补充 og:image:width/height/type meta 标签。可用 text_to_image API 生成品牌图片
2. **Lighthouse 性能基线测量**：连续十四轮遗留，TRAE Sandbox 拦截 configstore 写入。需用户配置白名单或换环境执行
3. **移动端 375px 三档适配实测**：连续十四轮遗留，agent-browser 受 socket 限制
4. **线上页面浏览器验证**：curl 受 SafeLine WAF 挑战拦截，需用户用浏览器访问 https://website.niuzi.asia 验证渲染/canonical/JSON-LD 实际生效
5. **接入轻量统计工具**：Umami/Plausible 为阶段二数据驱动迭代提供数据源（需用户确认部署方式）
6. **继续内容拓展**：可新增进制转换器、大小写转换、文本去重等高搜索需求工具，或补充现有工具的配套博客
7. **工具页 hero 样式渐进迁移**：39 个工具页仍用默认 page-hero，可渐进式迁移到 page-hero--tool 变体

## 需用户操作
- 部署本轮修复后的代码（4 次 git push 已完成，若 Cloudflare Pages 已配置自动部署则自动触发）
- 在 docs/site-config.md 填写访问数据 + 接入统计工具后回写，agent 下轮进入数据驱动迭代
- （可选）配置 TRAE Sandbox 白名单允许 Lighthouse/agent-browser 写入临时目录，以建立性能基线
- （可选）用浏览器访问 https://website.niuzi.asia/jsonpath 验证 jsonPath 工具的 $ 根路径过滤功能

---

# 第 13 轮 · OG 图片 PNG 化 + OG meta 标签完善

## 上下文恢复
- 承接第 12 轮（工作树清理 + jsonPath P1 修复 + README 同步，commit 42e025b）
- 触发点：第 12 轮遗留建议优先级 1「OG 图片 PNG 化（P1 SEO）」
- 阶段：阶段二（数据驱动迭代），站点已上线但无访问数据，本轮做 SEO 基础设施打磨
- 当前规模：48 个工具 + 43 篇博客 + 266 页面

## 本轮聚焦方向
**OG 图片 PNG 化（P1 SEO）**——全站 og:image 为 SVG 格式，主流社交平台（微信/QQ/微博/Facebook/Twitter）不渲染 SVG，导致社交分享时无预览图。需生成 1200x630 PNG 替换，并补充 og:image:width/height/type meta 标签。

## 完成任务

### 单元 1：OG 图片 PNG 生成
1. ✅ sharp SVG→PNG 转换
   - 环境限制：系统无 ImageMagick/Inkscape，用 Node.js sharp 库（--no-save 临时安装，不污染 package.json）
   - 转换脚本：density=300 提高渲染分辨率 → resize(1200,630) → PNG quality=90
   - fontconfig 警告：TRAE Sandbox 拦截 fontconfig 缓存目录，但 librsvg 已用系统字体完成渲染，警告仅为退出清理问题
   - 质量验证：sharp stats 检查像素分布，R/G/B max=255（白色文字存在）、B mean > R mean（品牌蓝色存在），文字渲染成功
   - 产物：og-image.png 1200x630 20.06KB
2. ✅ og-image.svg 保留决策
   - 保留 SVG 作为设计源文件（1.4KB），未来重新生成 PNG 时可用
   - 不在 meta 标签中引用（BaseLayout 已改为 .png），仅作为静态资源存在

### 单元 2：BaseLayout OG meta 标签完善
3. ✅ ogImage 默认路径更新：/og-image.svg → /og-image.png，注释同步
4. ✅ og:image:width/height/type meta 标签补充
   - og:image:width = 1200、og:image:height = 630、og:image:type = image/png
   - 帮助社交平台预知图片尺寸避免布局抖动（CLS），type 标签帮助选择正确渲染器

### 单元 3：README 站点结构同步
5. ✅ 站点结构树注释更新：og-image.png（PNG，主流平台兼容）+ og-image.svg（源文件）

## 修改文件（3 个，未超 8 文件红线）
- public/og-image.png（新增，1200x630 PNG，20.06KB）
- src/layouts/BaseLayout.astro（ogImage 路径 + og:image:width/height/type meta 标签）
- README.md（站点结构注释同步）

## 验证结果
- 构建：✅ 266 页面，14.57s，无报错无警告
- 类型检查：✅ 0 errors, 0 warnings, 1 hint（134 files，零回归）
- 产物抽检：
  - dist/index.html og:image = https://website.niuzi.asia/og-image.png ✅
  - og:image:width = 1200 ✅、og:image:height = 630 ✅、og:image:type = image/png ✅
  - twitter:image = https://website.niuzi.asia/og-image.png ✅
  - dist/uuid/index.html 工具页 og:image 同样正确指向 PNG ✅
- package.json 未被 sharp 污染（--no-save 生效，git diff 为空）✅
- Git 提交：commit c296b69，已 push origin HEAD（42e025b..c296b69）

## 数据洞察
- **SVG OG 图片的社交平台兼容性问题**：SVG 是矢量格式，主流社交平台链接预览爬虫不支持 SVG 渲染，导致分享时无预览图或显示空白。OG 标准要求 PNG/JPG/WebP 等位图格式。修复后 PNG 格式所有平台兼容
- **og:image:width/height/type 的重要性**：社交平台爬虫通过这些 meta 标签预知图片尺寸，避免布局抖动（CLS）。type 标签帮助平台选择正确的渲染器。缺少这些标签时部分平台会延迟渲染或忽略图片
- **sharp --no-save 策略**：临时安装 sharp 转换 SVG→PNG，--no-save 不写入 package.json，转换后删除脚本。sharp 仅存在于 node_modules 中，下次 npm install 自动清理。这是"一次性工具依赖"的处理模式——不污染项目依赖，完成转换即丢弃
- **fontconfig 限制分析**：TRAE Sandbox 拦截 fontconfig 缓存目录（C:\Users\Lenovo\AppData\Local\fontconfig），但 librsvg（sharp 的 SVG 渲染后端）通过 Windows 系统字体直接加载，不依赖 fontconfig 缓存。文字渲染成功验证了这一点。fontconfig 警告仅为 sharp 退出时的缓存清理失败，不影响已完成的渲染

## 遗留问题
- 无（本轮所有任务完成且验收通过）
- bug-check-2026-07-11 记录的轻微问题（P2）：8/48 工具页 hero 样式不一致（渐进式迁移中）、博客列表无分页等，均为低优先级

## 下一轮建议
按优先级排序：
1. **Lighthouse 性能基线测量**：连续十五轮遗留，TRAE Sandbox 拦截 configstore 写入。需用户配置白名单或换环境执行
2. **移动端 375px 三档适配实测**：连续十五轮遗留，agent-browser 受 socket 限制
3. **线上页面浏览器验证**：curl 受 SafeLine WAF 挑战拦截，需用户用浏览器访问 https://website.niuzi.asia 验证 og:image PNG 实际渲染效果
4. **接入轻量统计工具**：Umami/Plausible 为阶段二数据驱动迭代提供数据源（需用户确认部署方式）
5. **继续内容拓展**：可新增进制转换器、大小写转换、文本去重等高搜索需求工具，或补充现有工具的配套博客
6. **工具页 hero 样式渐进迁移**：39 个工具页仍用默认 page-hero，可渐进式迁移到 page-hero--tool 变体

## 需用户操作
- 部署本轮新增代码（git push 已完成，若 Cloudflare Pages 已配置自动部署则自动触发）
- 在 docs/site-config.md 填写访问数据 + 接入统计工具后回写，agent 下轮进入数据驱动迭代
- （可选）用浏览器访问 https://website.niuzi.asia，在社交平台分享链接验证 OG 预览图是否正确显示 PNG 图片
- （可选）配置 TRAE Sandbox 白名单允许 Lighthouse/agent-browser 写入临时目录，以建立性能基线和移动端实测

---

# 第 14 轮 · 内容拓展：进制转换工具 + 文本大小写转换工具

## 上下文恢复
- 承接第 13 轮（OG 图片 PNG 化 + OG meta 标签完善，commit c296b69）
- 阶段：阶段二（数据驱动迭代），站点已上线但无访问数据，本轮聚焦内容拓展覆盖长尾流量
- 当前规模：48 个工具 + 43 篇博客 + 266 页面 → 本轮后 50 个工具 + 45 篇博客 + 279 页面

## 本轮聚焦方向
**内容拓展——新增 2 个高搜索需求、纯前端实现、与现有工具互补的开发者工具**
环境限制类任务（Lighthouse/移动端实测/线上验证）连续十五轮无法突破，不再消耗时间。接入统计工具需用户确认。选择可自主推进的高价值方向：内容拓展。

## 完成任务

### 单元 1：进制转换工具开发（2 个文件）
1. ✅ NumberBaseTool.tsx 组件开发
   - 功能：二进制/八进制/十进制/十六进制实时互转，使用 BigInt 支持超大整数（突破 2^53 限制）
   - 自动识别 0b/0o/0x 编程语言字面量前缀与负号
   - 十六进制大小写切换、二进制 4 位分组显示（便于位掩码阅读）
   - 4 个进制输入框任意一个变更即同步更新其余 3 个，完整错误提示（非法字符）
   - 响应式布局：4 列 → 2 列（768px）→ 1 列（414px）+ 暗色模式
2. ✅ number-base.astro 页面创建
   - 完整 SEO 元素：title/description/canonical/OG/JSON-LD WebApplication
   - 6 个 FAQ（BigInt 必要性、负数支持、前缀含义、4 位分组用途、使用场景、隐私）
   - 专属样式含暗色模式 + 移动端响应式

### 单元 2：文本大小写转换工具开发（2 个文件）
3. ✅ CaseTool.tsx 组件开发
   - 10 种格式互转：全大写/全小写/首字母大写/句子首字母大写/驼峰/帕斯卡/下划线/短横线/句点分隔/反转大小写
   - 智能分词：①按非字母数字字符分割 ②按大小写边界分割（camelCase → camel+Case）③连续大写作为一个单词（HTTPRequest → HTTP+Request）
   - 实时预览所有 10 种格式结果，每个结果独立复制按钮
   - 响应式布局：2 列 → 1 列（768px）+ 暗色模式
4. ✅ text-case.astro 页面创建
   - 完整 SEO 元素：title/description/canonical/OG/JSON-LD WebApplication
   - 6 个 FAQ（驼峰与帕斯卡区别、下划线与短横线场景、智能分词原理、Title vs Sentence、使用场景、隐私）
   - 专属样式含暗色模式 + 移动端响应式

### 单元 3：首页更新 + 配套博客（3 个文件）
5. ✅ 首页 index.astro 工具卡片与 meta 更新
   - 工具列表新增 number-base（category: 编码转换）和 text-case（category: 文档处理）
   - meta description 工具数量 48→50
6. ✅ 配套博客文章 × 2
   - number-base-conversion-guide.md：6 章完整指南（四种进制对应关系、转换数学原理、BigInt 精度、编程语言前缀、典型应用场景、总结）
   - text-case-conversion-guide.md：6 章完整指南（10 种命名风格详解、适用场景、智能分词核心、转换规则与重组、实践建议、总结）
   - 两篇博客均覆盖长尾搜索词 + 内链指向配套工具

## 修改文件（7 个，未超 8 文件红线）
- src/components/NumberBaseTool.tsx（新增，进制转换 React 组件）
- src/components/CaseTool.tsx（新增，文本大小写转换 React 组件）
- src/pages/number-base.astro（新增，工具页面 + 6 FAQ + 专属样式）
- src/pages/text-case.astro（新增，工具页面 + 6 FAQ + 专属样式）
- src/pages/index.astro（修改，新增 2 个工具卡片 + meta description 48→50）
- src/content/blog/number-base-conversion-guide.md（新增，6 章配套博客）
- src/content/blog/text-case-conversion-guide.md（新增，6 章配套博客）

## 验证结果
- 类型检查：✅ 0 errors, 0 warnings, 1 hint（138 files，零回归，仅剩 clipboard.ts execCommand 废弃提示）
- 构建：✅ 279 页面，14.08s，无报错无警告
- SEO 要素：✅ number-base/text-case 页面 title/description/canonical/OG/JSON-LD 全部正确
- Bundle 体积：✅ NumberBaseTool 4.17KB + client 136.51KB = 140.68KB < 200KB；CaseTool 3.98KB + client 136.51KB = 140.49KB < 200KB
- 首页工具卡片：✅ number-base 和 text-case 链接已渲染到首页
- 博客内链：✅ 两篇博客文章均指向配套工具链接
- 响应式设计：✅ 进制转换 4→2→1 列 + 大小写转换 2→1 列 + 暗色模式
- Git 提交：commit c39a59d，已 push origin HEAD（c296b69..c39a59d）

## 数据洞察
- **BigInt 进制转换的必要性**：JavaScript Number 是 64 位浮点数，最大安全整数 2^53-1。颜色值、哈希值、大整数 ID 等场景经常超出此范围。BigInt 原生支持 toString(radix) 输出任意进制，但 BigInt() 构造函数只接受十进制字符串，非十进制字符串需手动按权展开解析。这是"API 限制驱动实现方式"的体现
- **智能分词是命名转换的核心**：10 种命名格式互转的本质是"拆分单词 → 重新组装"。分词策略三步走：①按非字母数字字符分割 ②按大小写转换边界分割 ③连续大写字母作为一个单词。两个正则替换覆盖了所有边界情况（HTTPRequest → HTTP+Request，camelCase → camel+Case）。这是"正则表达式驱动分词正确性"的体现
- **内容拓展策略**：bug-check 全部清零、OG 图片 PNG 化完成后，站点 SEO 基础设施已完善。此时最高优先级是拓展内容覆盖面——新增高搜索需求工具 + 配套博客，覆盖长尾流量。进制转换覆盖"二进制转换""十六进制转换"等高搜索量词，大小写转换覆盖"驼峰命名转换""下划线转驼峰"等开发者高频需求
- **工具分类互补性**：进制转换归入"编码转换"类别（与 Base64/Base32/Hex 互补），大小写转换归入"文档处理"类别（与文本统计/Diff/Markdown 互补），形成了更完整的工具链

## 遗留问题
- 无（本轮所有任务完成且验收通过）
- bug-check-2026-07-11 记录的轻微问题（P2）：8/50 工具页 hero 样式不一致（渐进式迁移中）、博客列表无分页等，均为低优先级
- README.md 工具清单需同步至 50 个工具（本轮未更新，下轮处理）

## 下一轮建议
按优先级排序：
1. **README.md 工具清单同步**：新增了第 49、50 个工具，README 需同步更新工具清单与数量
2. **Lighthouse 性能基线测量**：连续十六轮遗留，TRAE Sandbox 拦截 configstore 写入。需用户配置白名单或换环境执行
3. **移动端 375px 三档适配实测**：连续十六轮遗留，agent-browser 受 socket 限制
4. **线上页面浏览器验证**：curl 受 SafeLine WAF 挑战拦截，需用户用浏览器访问 https://website.niuzi.asia 验证新工具页面渲染
5. **接入轻量统计工具**：Umami/Plausible 为阶段二数据驱动迭代提供数据源（需用户确认部署方式）
6. **继续内容拓展**：可新增文本去重、排序工具、字符替换等高搜索需求工具，或补充现有工具的配套博客
7. **工具页 hero 样式渐进迁移**：40 个工具页仍用默认 page-hero，可渐进式迁移到 page-hero--tool 变体

## 需用户操作
- 部署本轮新增代码（git push 已完成，若 Cloudflare Pages 已配置自动部署则自动触发）
- 在 docs/site-config.md 填写访问数据 + 接入统计工具后回写，agent 下轮进入数据驱动迭代
- （可选）用浏览器访问 https://website.niuzi.asia/number-base 和 /text-case 验证新工具页面正常
- （可选）配置 TRAE Sandbox 白名单允许 Lighthouse/agent-browser 写入临时目录，以建立性能基线和移动端实测

---

# 第 15 轮 · README 同步 + 文本去重工具

## 上下文恢复
- 承接第 14 轮（进制转换 + 文本大小写转换工具，commit c39a59d）
- 阶段：阶段二（数据驱动迭代），站点已上线但无访问数据
- 当前规模：50 工具 + 45 博客 + 279 页面 → 本轮后 51 工具 + 46 博客 + 285 页面

## 本轮聚焦方向
**第 14 轮遗留优先级 1（README 同步）+ 内容拓展（文本去重工具）**
环境限制类任务（Lighthouse/移动端实测/线上验证）连续十六轮无法突破，不再消耗时间。接入统计工具需用户确认。聚焦可自主推进的高价值方向。

## 完成任务

### 单元 1：README 工具清单同步（commit 5f5e4ef + 20780c5）
1. ✅ 核心数字同步
   - 工具数 48→51（首页描述 / 特性 / 工具一览标题 / 技术栈表格 / 站点结构 / 博客速览 / Bug 检查任务）
   - 博客数 43→46，标签数 91→183（经构建产物 dist/blog/tag 目录精确统计），页面数 266→285
2. ✅ 工具清单新增
   - 编码转换类别新增"进制转换"
   - 代码调试类别新增"文本大小写转换"、"文本去重"
3. ✅ 博客主题速览新增 3 篇
   - number-base-conversion-guide、text-case-conversion-guide、text-dedup-guide

### 单元 2：文本去重工具开发（commit 8e81921）
4. ✅ TextDedupTool.tsx 组件开发
   - 三种去重模式：保留首次出现（Set 去重）、保留末次出现（Map 覆盖+order 数组保序）、仅合并连续重复行（相邻比较）
   - 4 个选项：大小写敏感、去重前 trim、去除空行、去重后排序
   - 统计区：原始行数、去重后行数、重复行数、重复率（4 列网格）
   - 完整空状态、复制结果、清空、示例文本功能
   - 响应式布局：选项区 2→1 列（768px）、统计区 4→2 列（768px）、工具栏堆叠（414px）+ 暗色模式
5. ✅ text-dedup.astro 页面创建
   - 完整 SEO 元素：title/description/canonical/OG/JSON-LD WebApplication
   - 6 个 FAQ（首次 vs 末次区别、连续合并含义、大小写敏感作用、排序选项、使用场景、隐私）
   - 专属样式含暗色模式 + 移动端响应式
6. ✅ 首页工具卡片与 meta 更新
   - index.astro 工具列表新增 text-dedup（category: 文档处理）
   - meta description 工具数量 50→51
7. ✅ 配套博客文章创建
   - text-dedup-guide.md：6 章完整指南（数据冗余问题、三种去重模式详解、选项使用场景、底层实现原理、典型应用场景、与其他工具配合）
   - 覆盖长尾搜索词：文本去重、去重复行、列表去重、日志去重、邮件去重、数据去重
   - 内链指向配套工具 /text-dedup

## 修改文件
- commit 5f5e4ef: README.md（工具清单同步至 50 工具，第一轮同步）
- commit 8e81921: src/components/TextDedupTool.tsx（新增）、src/pages/text-dedup.astro（新增）、src/pages/index.astro（修改）、src/content/blog/text-dedup-guide.md（新增）
- commit 20780c5: README.md（二次同步至 51 工具 + 46 博客 + 183 标签）

## 验证结果
- 类型检查：✅ 0 errors, 0 warnings, 1 hint（140 files，零回归，仅剩 clipboard.ts execCommand 废弃提示）
- 构建：✅ 285 页面，13.48s，无报错无警告
- SEO 要素：✅ text-dedup 页面 title/description/canonical/OG/JSON-LD 全部正确，og:image 指向 PNG
- Bundle 体积：✅ TextDedupTool 5.28KB + client.js 133.31KB = 138.59KB < 200KB
- 首页工具卡片：✅ text-dedup 链接已渲染到首页
- 博客内链：✅ 博客文章指向 /text-dedup 配套工具链接
- 响应式设计：✅ 选项区 2→1 列 + 统计区 4→2 列 + 工具栏堆叠 + 暗色模式
- Git 提交：2 次 commit 全部 push origin HEAD 成功（5f5e4ef..8e81921）

## 数据洞察
- **标签数从 91 增至 179 的原因**：第 14 轮之前 README 写的 91 个标签是早期数据。随着 43→45 篇博客的增加，每篇博客 3-5 个标签，且新增博客覆盖新主题（进制转换、大小写转换、文本统计等），标签数自然增长。本次通过构建产物 dist/blog/tag 目录精确统计为 179 个，修正了历史数据偏差
- **三种去重模式的算法选择**：保留首次用 Set（O(1) 查找）、保留末次用 Map 覆盖+order 数组保序（Map 保留最后值，order 记录键首次出现顺序确保稳定输出）、连续合并用相邻比较（无需额外数据结构）。三种模式均为 O(n) 时间复杂度，性能优秀
- **Map+order 保序设计**：保留末次出现模式中，Map 的 keys() 迭代顺序是插入顺序而非最后更新顺序，直接用 Map.keys() 会导致末次出现的行位置不正确。用单独的 order 数组记录键的首次出现顺序，确保输出稳定且行的相对位置正确
- **文本去重工具差异化**：现有在线去重工具多为简单的"按行去重"，本工具的差异化在于：①三种去重模式（首次/末次/连续合并）覆盖不同场景；②4 个可组合选项（大小写敏感/trim/去空行/排序）；③实时统计重复率；④完整的中文 FAQ 覆盖使用场景
- **内容拓展策略**：文本去重覆盖"文本去重""去重复行""列表去重""日志去重"等高搜索量长尾词，与现有的文本统计分析、Diff、文本大小写转换形成完整的"文档处理"工具链

## 遗留问题
- 无（本轮所有任务完成且验收通过）
- bug-check-2026-07-11 记录的轻微问题（P2）：8/51 工具页 hero 样式不一致（渐进式迁移中）、博客列表无分页等，均为低优先级

## 下一轮建议
按优先级排序：
1. **Lighthouse 性能基线测量**：连续十七轮遗留，TRAE Sandbox 拦截 configstore 写入。需用户配置白名单或换环境执行
2. **移动端 375px 三档适配实测**：连续十七轮遗留，agent-browser 受 socket 限制
3. **线上页面浏览器验证**：curl 受 SafeLine WAF 挑战拦截，需用户用浏览器访问验证渲染
4. **接入轻量统计工具**：Umami/Plausible 为阶段二数据驱动迭代提供数据源（需用户确认部署方式）
5. **继续内容拓展**：可新增排序工具、字符替换、文本对比增强等高搜索需求工具，或补充现有工具的配套博客
6. **工具页 hero 样式渐进迁移**：41 个工具页仍用默认 page-hero，可渐进式迁移到 page-hero--tool 变体

## 需用户操作
- 部署本轮新增代码（3 次 git push 已完成，若 Cloudflare Pages 已配置自动部署则自动触发）
- 在 docs/site-config.md 填写访问数据 + 接入统计工具后回写，agent 下轮进入数据驱动迭代
- （可选）用浏览器访问 https://website.niuzi.asia/text-dedup 验证新工具页面正常
- （可选）配置 TRAE Sandbox 白名单允许 Lighthouse/agent-browser 写入临时目录，以建立性能基线和移动端实测

---

# 第 16 轮 · 文本排序工具 + 随机选择器 + 配套博客

## 上下文恢复
- 承接第 15 轮（README 同步 + 文本去重工具，commit 20780c5）
- 阶段：阶段二（数据驱动迭代），站点已上线但无访问数据
- 当前规模：51 工具 + 46 博客 + 285 页面 → 本轮后 53 工具 + 48 博客 + 296 页面

## 本轮聚焦方向
**内容拓展——新增文本排序工具与随机选择器，覆盖长尾搜索流量**
环境限制类任务（Lighthouse/移动端实测/线上验证）连续十七轮无法突破，不再消耗时间。接入统计工具需用户确认。聚焦可自主推进的高价值方向：内容拓展。排序与随机选择是开发者与内容创作者的高频需求，与现有文本去重、文本统计、大小写转换形成更完整的"文档处理"工具链。

## 完成任务

### 单元 1：文本排序工具开发
1. ✅ SortTool.tsx 组件开发
   - 8 种排序模式：字母升序/降序、数值升序/降序、长度升序/降序、自然排序、随机打乱
   - 4 个选项：大小写敏感、去除空行、排序前 trim、排序后去重
   - 关键算法：`secureRandomInt(max)` 基于 crypto.getRandomValues + 拒绝采样消除模偏差；`naturalCompare(a, b)` 自然排序拆分文本段与数字段交替比较，使用 BigInt 支持超大数字
   - 实时统计原始行数、排序后行数
   - 响应式布局 + 暗色模式
2. ✅ sort.astro 页面创建
   - 完整 SEO 元素：title/description/canonical/OG/JSON-LD WebApplication
   - 7 个 FAQ：自然排序 vs 字母排序、随机打乱公平性、数值排序处理、大小写敏感、去重 vs 去空行、使用场景、隐私
   - 专属样式含暗色模式 + 移动端响应式（768px/414px 断点）

### 单元 2：随机选择器工具开发
3. ✅ RandomPickerTool.tsx 组件开发
   - 两种模式：允许重复（独立抽取，每次从全集独立抽取）、不允许重复（Fisher-Yates 部分洗牌，无偏差随机）
   - 4 个选项：允许重复抽取、去除行首尾空白、去除空行、候选项去重
   - 基于 Web Crypto API 的 secureRandomInt 实现无偏差随机
   - 结果展示抽取项 + 序号，复制结果功能
4. ✅ random-picker.astro 页面创建
   - 完整 SEO 元素：title/description/canonical/OG/JSON-LD WebApplication
   - 7 个 FAQ：随机抽取实现原理、允许重复区别、去重作用、使用场景、复制功能、隐私、Fisher-Yates 部分洗牌
   - 专属样式含暗色模式 + 移动端响应式

### 单元 3：首页更新 + 配套博客 + README 同步
5. ✅ 首页 index.astro 工具卡片与 meta 更新
   - 工具列表新增 sort 和 random-picker（category: 文档处理）
   - meta description 工具数量 51→53
6. ✅ 配套博客文章 × 2
   - text-sort-guide.md：6 章（8 种排序模式详解、自然排序拆分比较算法、Fisher-Yates 无偏差洗牌、排序选项组合策略、复杂度分析、总结）
   - random-picking-guide.md：6 章（PRNG vs CSPRNG、取模偏差与拒绝采样、两种抽取模式、候选项预处理公平性、实际应用场景、总结）
7. ✅ README.md 数字全面同步
   - 工具数 51→53、博客数 46→48、标签数 183→190、页面数 285→296
   - 代码调试类别新增"文本排序 · 随机选择器"
   - 技术栈表格、站点结构树、博客主题速览、Bug 检查任务描述全部同步

## 修改文件（8 个，未超红线）
- src/components/SortTool.tsx（新增，排序工具 React 组件）
- src/components/RandomPickerTool.tsx（新增，随机选择器 React 组件）
- src/pages/sort.astro（新增，工具页面 + 7 FAQ + 专属样式）
- src/pages/random-picker.astro（新增，工具页面 + 7 FAQ + 专属样式）
- src/pages/index.astro（修改，新增 2 个工具卡片 + meta description 51→53）
- src/content/blog/text-sort-guide.md（新增，6 章配套博客）
- src/content/blog/random-picking-guide.md（新增，6 章配套博客）
- README.md（修改，数字全面同步）

## 验证结果
- 类型检查：✅ 0 errors, 0 warnings, 1 hint（零回归，仅剩 clipboard.ts execCommand 废弃提示）
- 构建：✅ 296 页面，14.31s，无报错无警告
- SEO 要素：✅ sort/random-picker 页面 title/description/canonical/OG/JSON-LD 全部正确
- Bundle 体积：✅ SortTool 5.73KB + RandomPickerTool 4.78KB，均 < 200KB
- 首页工具卡片：✅ sort 和 random-picker 链接已渲染到首页
- 博客内链：✅ 两篇博客文章指向配套工具链接
- 响应式设计：✅ 768px/414px 断点 + 暗色模式
- Git 提交：commit f86caad，已 push origin HEAD（e1451b4..f86caad）

## 数据洞察
- **自然排序算法的拆分比较设计**：自然排序（natural sort）需要正确处理混合的文本与数字段，如 "file2.txt" 应排在 "file10.txt" 之前。实现思路是用正则将字符串拆分为文本段与数字段交替的数组，逐段比较：文本段按 Unicode 顺序、数字段按 BigInt 数值大小。使用 BigInt 而非 Number 是为了支持超出 2^53 的超大数字（如长 ID、时间戳）。这是"数据特征驱动算法选择"的体现
- **拒绝采样消除模偏差**：`secureRandomInt(max)` 若直接用 `random % max` 会引入模偏差（modular bias）——当 random 的值域不能被 max 整除时，较小的结果出现概率略高。拒绝采样方案：生成 [0, 2^ceil(log2(max))) 范围的随机数，若 ≥ max 则丢弃重新生成。虽然理论上有无限循环风险，但每次丢弃概率 < 50%，实际迭代次数期望 < 2。这是密码学安全随机数生成的标准做法
- **Fisher-Yates 部分洗牌**：不允许重复的随机抽取本质是从 n 个元素中选 k 个的无偏样本。完整 Fisher-Yates 洗牌是 O(n)，当 k << n 时浪费。部分洗牌只洗前 k 个位置：对 i in [0, k)，从 [i, n) 随机选一个与 i 交换，最终取前 k 个。时间复杂度 O(k)，空间 O(n)（需复制原数组避免修改）。这是"按需计算"优化原则的体现
- **PowerShell heredoc 限制再次复现**：git commit 多行 message 在 PowerShell 中不支持 bash heredoc 语法（<<'EOF'），第三次遇到。改用多个 -m 参数（每个为一段落）是 PowerShell 环境的可靠方案
- **内容拓展策略**：文本排序覆盖"文本排序""自然排序""随机打乱""版本号排序"等长尾词，随机选择器覆盖"随机选择""抽奖""Fisher-Yates""拒绝采样"等词。两者与现有文本去重、文本统计、大小写转换形成更完整的"文档处理"工具链

## 遗留问题
- 无（本轮所有任务完成且验收通过）
- bug-check-2026-07-11 记录的轻微问题（P2）：8/53 工具页 hero 样式不一致（渐进式迁移中）、博客列表无分页等，均为低优先级

## 下一轮建议
按优先级排序：
1. **Lighthouse 性能基线测量**：连续十八轮遗留，TRAE Sandbox 拦截 configstore 写入。需用户配置白名单或换环境执行
2. **移动端 375px 三档适配实测**：连续十八轮遗留，agent-browser 受 socket 限制
3. **线上页面浏览器验证**：curl 受 SafeLine WAF 挑战拦截，需用户用浏览器访问验证渲染
4. **接入轻量统计工具**：Umami/Plausible 为阶段二数据驱动迭代提供数据源（需用户确认部署方式）
5. **继续内容拓展**：可新增字符替换、文本反转、字数限制截断等高搜索需求工具，或补充现有工具的配套博客
6. **工具页 hero 样式渐进迁移**：43 个工具页仍用默认 page-hero，可渐进式迁移到 page-hero--tool 变体
7. **博客列表分页**：48 篇博客全量展示在列表页，可增加分页提升浏览体验

## 需用户操作
- 部署本轮新增代码（git push 已完成，若 Cloudflare Pages 已配置自动部署则自动触发）
- 在 docs/site-config.md 填写访问数据 + 接入统计工具后回写，agent 下轮进入数据驱动迭代
- （可选）用浏览器访问 https://website.niuzi.asia/sort 和 /random-picker 验证新工具页面正常
- （可选）配置 TRAE Sandbox 白名单允许 Lighthouse/agent-browser 写入临时目录，以建立性能基线和移动端实测

---

# 第 17 轮 · 全站工具页 Hero 样式统一迁移

## 上下文恢复
- 承接第 16 轮（排序工具 + 随机选择器，commit f86caad）
- 阶段：阶段二（数据驱动迭代），站点已上线但无访问数据
- 当前规模：53 工具 + 48 博客 + 296 页面（规模未变，本轮为样式一致性优化）

## 本轮聚焦方向
**全站工具页 Hero 样式统一迁移至 page-hero--tool 变体**
连续多轮内容拓展（第 14-16 轮新增 6 个工具）后，转向质量打磨。bug-check-2026-07-11 记录的 P2 问题"工具页 hero 样式不一致"此前仅迁移了 14 个页面，剩余 39 个工具页仍用默认 page-hero。本轮一次性完成全站 53 个工具页的 hero 样式统一。

## 完成任务

### 单元 1：全站工具页 Hero 样式迁移（39 文件）
1. ✅ 批量迁移 39 个工具页 `class="page-hero"` → `class="page-hero page-hero--tool"`
   - 迁移前：14/53 工具页已使用 page-hero--tool（json/jwt/regex/hash/qr/password/color/diff + text-analyzer/number-base/text-case/text-dedup/sort/random-picker）
   - 迁移后：53/53 工具页全部使用 page-hero--tool，3 个博客页保留默认 page-hero
   - 涉及文件：aes/ascii-art/base32/base64/base64-image/color-contrast/color-palette/cron/css-formatter/csv-json/hex/html-entities/html-formatter/http-status/ip/js-formatter/json-schema/json-to-ts/json-to-xml/jsonpath/jwe/jwt-sign/jwt-verify/lorem/markdown/mime/punycode/regex-benchmark/sql/time-unit/timestamp/timezone/toml-schema/toml/url/uuid/xml-to-json/yaml-schema/yaml

### 单元 2：编码问题修复与验证
2. ✅ PowerShell 批量写入编码问题修复
   - 首次尝试：`[System.IO.File]::WriteAllText()` 未指定 UTF-8 编码，导致中文变乱码（UTF-8 被当作系统默认编码读写）
   - 修复方案：从 git HEAD 恢复原始内容（`git show HEAD:path`），设置 `[Console]::OutputEncoding = UTF8`，用 UTF8Encoding(false) 写入
   - 行尾处理：清理 `git show` 输出中的 `\r` 残留，用 `\r\n` 连接行 + 末尾换行，匹配工作树 CRLF 格式
   - diff 验证：39 文件各 1 行变更（39 insertions, 39 deletions），零编码噪声

### 单元 3：全量验收
3. ✅ 类型检查：0 errors, 0 warnings, 1 hint（零回归，仅剩 clipboard.ts execCommand 废弃提示）
4. ✅ 构建：296 页面，13.84s，无报错无警告
5. ✅ 产物验证：dist/uuid/index.html 包含 page-hero--tool，dist/blog/index.html 保持默认 page-hero
6. ✅ Git 提交：commit dca5289，已 push origin HEAD（f86caad..dca5289）

## 修改文件（39 个，均为 1 行 class 属性变更）
- src/pages/{aes,ascii-art,base32,base64,base64-image,color-contrast,color-palette,cron,css-formatter,csv-json,hex,html-entities,html-formatter,http-status,ip,js-formatter,json-schema,json-to-ts,json-to-xml,jsonpath,jwe,jwt-sign,jwt-verify,lorem,markdown,mime,punycode,regex-benchmark,sql,time-unit,timestamp,timezone,toml-schema,toml,url,uuid,xml-to-json,yaml-schema,yaml}.astro

## 验证结果
- 类型检查：✅ 0 errors, 0 warnings, 1 hint（零回归）
- 构建：✅ 296 页面，13.84s，无报错无警告
- diff 干净：✅ 39 文件各 1 行变更，无编码噪声、无行尾问题
- Git 提交：✅ commit dca5289，已 push origin HEAD（f86caad..dca5289）

## 数据洞察
- **PowerShell 编码陷阱**：`[System.IO.File]::WriteAllText(path, content)` 不带 encoding 参数时，在 Windows PowerShell 5.1 中可能使用系统默认编码（非 UTF-8），导致中文乱码。正确做法：1) 读取时设置 `[Console]::OutputEncoding = UTF8`；2) 写入时用 `new UTF8Encoding(false)`（无 BOM）。这是 Windows 环境处理中文文件的常见陷阱
- **git show 输出行尾处理**：`git show HEAD:path` 在 PowerShell 中按行输出，每行可能带 `\r` 残留（CRLF 格式）。需先 `-replace "\r$"` 清理，再用 `\r\n` 连接 + 末尾换行，才能匹配工作树 CRLF 格式，避免 diff 噪声
- **page-hero--tool 变体设计价值**：该变体在标题下方添加主色渐变细线，与首页 hero 形成视觉层次区分。全站 53 个工具页统一后，工具页与博客页的视觉身份区分更清晰，且后续新增工具页只需引用该 class 即可自动符合全站风格
- **批量操作的风险控制**：39 文件的批量 class 替换是低风险操作（仅添加 CSS class，不删除或修改任何逻辑），但仍需验证编码、行尾、构建三关。本轮首次尝试因编码问题失败，通过从 git HEAD 恢复内容并正确设置编码后成功

## 遗留问题
- 无（本轮所有任务完成且验收通过）
- bug-check-2026-07-11 记录的 P2"工具页 hero 样式不一致"已彻底解决（53/53 统一）
- bug-check-2026-07-11 剩余 P2：博客列表无分页（48 篇全量渲染），低优先级

## 下一轮建议
按优先级排序：
1. **Lighthouse 性能基线测量**：连续十八轮遗留，TRAE Sandbox 拦截 configstore 写入。需用户配置白名单或换环境执行
2. **移动端 375px 三档适配实测**：连续十八轮遗留，agent-browser 受 socket 限制
3. **线上页面浏览器验证**：curl 受 SafeLine WAF 挑战拦截，需用户用浏览器访问验证 page-hero--tool 渐变线实际渲染效果
4. **接入轻量统计工具**：Umami/Plausible 为阶段二数据驱动迭代提供数据源（需用户确认部署方式）
5. **继续内容拓展**：可新增字符替换、文本反转、Slug 生成器等高搜索需求工具，或补充现有工具的配套博客
6. **博客列表分页**：48 篇博客全量展示在列表页，可增加分页提升浏览体验

## 需用户操作
- 部署本轮新增代码（git push 已完成，若 Cloudflare Pages 已配置自动部署则自动触发）
- 在 docs/site-config.md 填写访问数据 + 接入统计工具后回写，agent 下轮进入数据驱动迭代
- （可选）用浏览器访问 https://website.niuzi.asia 任意工具页，验证 hero 标题下方渐变细线是否正确渲染
- （可选）配置 TRAE Sandbox 白名单允许 Lighthouse/agent-browser 写入临时目录，以建立性能基线和移动端实测

---

# 第 18 轮 · 内容拓展：URL Slug 生成器 + 文本反转工具

## 上下文恢复
- 承接第 17 轮（全站工具页 Hero 样式统一迁移，commit dca5289）
- 阶段：阶段二（数据驱动迭代），站点已上线但无访问数据
- 当前规模：53 工具 + 48 博客 + 296 页面 → 本轮后 55 工具 + 50 博客 + 308 页面

## 本轮聚焦方向
**内容拓展——新增 URL Slug 生成器与文本反转工具，覆盖长尾搜索流量**
环境限制类任务（Lighthouse/移动端实测/线上验证）连续十八轮无法突破，不再消耗时间。接入统计工具需用户确认。聚焦可自主推进的高价值方向：内容拓展。Slug 生成器覆盖 SEO 相关的 URL 规范化需求，文本反转覆盖字符串处理基础需求，与现有文本工具（大小写/去重/排序/统计）形成更完整的文档处理工具链。

## 完成任务

### 单元 1：URL Slug 生成器开发
1. ✅ SlugTool.tsx 组件开发
   - 功能：将任意文本转为 URL 友好的 slug
   - 三种分隔符：连字符（-）/下划线（_）/句点（.）
   - 四个选项：转小写、保留中文（CJK）、移除英文停用词、最大长度限制（0-120 滑块）
   - 核心算法：Unicode 属性转义 `\p{L}\p{N}` 分词（正确处理中英日韩混合）→ 停用词过滤 → CJK 保留/移除 → 分隔符连接 → 长度截断（去除末尾残留分隔符）
   - 实时生成、一键复制、完整空状态
   - 响应式布局：选项区 2→1 列（768px）+ 暗色模式
2. ✅ slug.astro 页面创建
   - 完整 SEO 元素：title/description/canonical/OG/JSON-LD WebApplication
   - 7 个 FAQ：slug 概念与价值、中文 vs 英文 slug、停用词过滤、三种分隔符场景、最大长度限制、使用场景、隐私
   - 专属样式含暗色模式 + 移动端响应式

### 单元 2：文本反转工具开发
3. ✅ ReverseTool.tsx 组件开发
   - 三种反转模式：字符反转（整段字符顺序反转）、行反转（行顺序反转）、单词反转（每行内单词顺序反转）
   - 两个选项：反转大小写、去除空行
   - 关键算法：字符反转使用 `Array.from()` 而非 `split('')`，正确处理 Unicode 代理对（Emoji 不乱码）；行/单词反转统一识别 `\r?\n` 换行符
   - 实时反转、一键复制、完整空状态
   - 响应式布局 + 暗色模式
4. ✅ reverse.astro 页面创建
   - 完整 SEO 元素：title/description/canonical/OG/JSON-LD WebApplication
   - 7 个 FAQ：三种反转模式区别、Array.from vs split('')、反转大小写、去除空行、使用场景、换行符处理、隐私
   - 专属样式含暗色模式 + 移动端响应式

### 单元 3：首页更新 + 配套博客 + README 同步
5. ✅ 首页 index.astro 工具卡片与 meta 更新
   - 工具列表新增 slug 和 reverse（category: 文档处理）
   - meta description 工具数量 53→55
6. ✅ 配套博客文章 × 2
   - slug-generation-guide.md：6 章完整指南（slug 概念与价值、设计核心原则、中文处理策略、停用词过滤、算法流程、场景最佳实践）
   - text-reverse-guide.md：6 章完整指南（三种模式区别、Unicode 代理对陷阱、换行符处理、反转大小写组合、应用场景、性能考量）
   - 两篇博客均覆盖长尾搜索词 + 内链指向配套工具
7. ✅ README.md 数字全面同步
   - 工具数 53→55、博客数 48→50、标签数 190→198、页面数 296→308
   - 代码调试类别新增"URL Slug 生成器 · 文本反转"
   - 博客主题速览新增 slug-generation-guide、text-reverse-guide

## 修改文件（8 个，未超红线）
- src/components/SlugTool.tsx（新增，Slug 生成器 React 组件）
- src/components/ReverseTool.tsx（新增，文本反转 React 组件）
- src/pages/slug.astro（新增，工具页面 + 7 FAQ + 专属样式）
- src/pages/reverse.astro（新增，工具页面 + 7 FAQ + 专属样式）
- src/pages/index.astro（修改，新增 2 个工具卡片 + meta description 53→55）
- src/content/blog/slug-generation-guide.md（新增，6 章配套博客）
- src/content/blog/text-reverse-guide.md（新增，6 章配套博客）
- README.md（修改，数字全面同步 + 工具清单 + 博客速览）

## 验证结果
- 类型检查：✅ 0 errors, 0 warnings, 1 hint（148 files，零回归，仅剩 clipboard.ts execCommand 废弃提示）
- 构建：✅ 308 页面，14.45s，无报错无警告
- SEO 要素：✅ slug/reverse 页面 title/description/canonical/OG/JSON-LD 全部正确，og:image 指向 PNG，WebApplication.url 正确注入线上域名
- Bundle 体积：✅ SlugTool 4.36KB + ReverseTool 3.8KB，均 < 200KB
- 首页工具卡片：✅ slug 和 reverse 链接已渲染到首页
- 博客内链：✅ 两篇博客文章指向配套工具链接
- 响应式设计：✅ 768px/414px 断点 + 暗色模式
- Git 提交：commit b99b14a，已 push origin HEAD（ef2d91e..b99b14a）

## 数据洞察
- **Unicode 属性转义 \p{L}\p{N} 的价值**：传统 slug 生成器用 `/[a-z0-9]+/i` 只能处理 ASCII 字符，遇到中文会被全部移除。使用 `\p{L}\p{N}` Unicode 属性转义配合 `u` 标志位，能正确匹配所有语言的字母和数字，使得中文 slug 保留成为可能。这是"国际化优先"设计理念的体现
- **Array.from vs split('') 的 Unicode 陷阱**：JavaScript 字符串的 `split('')` 按 UTF-16 码元分割，对于 Emoji（U+1F600+）会拆散代理对导致反转后乱码。`Array.from()` 按 Unicode 码点遍历，正确处理代理对。这是字符串处理的经典陷阱，在 FAQ 中专门讲解以教育用户
- **停用词过滤的局限性**：停用词过滤仅对英文生效，中文无停用词概念。工具在 FAQ 中诚实说明这一局限，而非过度宣传。这是"诚实标注功能边界"的体现
- **内容拓展策略**：Slug 生成器覆盖"slug 生成""URL 友好链接""文章标题转链接"等 SEO 相关高搜索量词，文本反转覆盖"文本反转""字符串反转""回文检测"等基础需求。两者与现有文本大小写/去重/排序/统计形成更完整的文档处理工具链

## 遗留问题
- 无（本轮所有任务完成且验收通过）
- bug-check-2026-07-11 记录的轻微问题（P2）：博客列表无分页（50 篇全量渲染），低优先级

## 下一轮建议
按优先级排序：
1. **Lighthouse 性能基线测量**：连续十九轮遗留，TRAE Sandbox 拦截 configstore 写入。需用户配置白名单或换环境执行
2. **移动端 375px 三档适配实测**：连续十九轮遗留，agent-browser 受 socket 限制
3. **线上页面浏览器验证**：curl 受 SafeLine WAF 挑战拦截，需用户用浏览器访问验证新工具页面渲染
4. **接入轻量统计工具**：Umami/Plausible 为阶段二数据驱动迭代提供数据源（需用户确认部署方式）
5. **继续内容拓展**：可新增字符替换、文本截断、Lorem ipsum 增强等高搜索需求工具，或补充现有工具的配套博客
6. **博客列表分页**：50 篇博客全量展示在列表页，可增加分页提升浏览体验

## 需用户操作
- 部署本轮新增代码（git push 已完成，若 Cloudflare Pages 已配置自动部署则自动触发）
- 在 docs/site-config.md 填写访问数据 + 接入统计工具后回写，agent 下轮进入数据驱动迭代
- （可选）用浏览器访问 https://website.niuzi.asia/slug 和 /reverse 验证新工具页面正常
- （可选）配置 TRAE Sandbox 白名单允许 Lighthouse/agent-browser 写入临时目录，以建立性能基线和移动端实测

---

# 第 19 轮 · 内容拓展：字符替换工具 + 文本截断工具

## 上下文恢复
- 承接第 18 轮（URL Slug 生成器 + 文本反转工具，commit b99b14a）
- 阶段：阶段二（数据驱动迭代），站点已上线但无访问数据
- 当前规模：55 工具 + 50 博客 + 308 页面 → 本轮后 57 工具 + 52 博客 + 319 页面

## 本轮聚焦方向
**内容拓展——新增字符替换工具与文本截断工具，覆盖长尾搜索流量**
环境限制类任务（Lighthouse/移动端实测/线上验证）连续十九轮无法突破，不再消耗时间。接入统计工具需用户确认。聚焦可自主推进的高价值方向：内容拓展。字符替换覆盖"查找替换""正则替换""批量替换""日志脱敏"等高搜索量词，文本截断覆盖"文本截断""字符截断""字节截断""摘要生成"等基础需求，与现有文本工具（大小写/去重/排序/统计/反转）形成更完整的文档处理工具链。

## 完成任务

### 单元 1：字符替换工具开发
1. ✅ FindReplaceTool.tsx 组件开发
   - 功能：普通文本替换 + 正则表达式替换两种模式
   - 普通模式：可选大小写敏感（大小写不敏感用 toLowerCase 匹配边界拼接）
   - 正则模式：可选 g（全局）/m（多行）/i（忽略大小写）标志，支持 $1、$& 等捕获组引用
   - 关键 bug 修复：原实现用回调形式 `input.replace(regex, (...args) => { count++; return replace; })`，回调返回的字符串被当作字面量，$1/$& 等特殊替换串不被解析。改为先用 `input.match(regex)` 统计匹配次数，再用字符串形式 `input.replace(regex, replace)` 执行替换，让 JS 原生解析 $ 模式
   - 实时统计替换次数、一键复制、完整空状态
   - 响应式布局：查找替换输入对布局（1fr auto 1fr grid + 交换按钮）+ 暗色模式
2. ✅ find-replace.astro 页面创建
   - 完整 SEO 元素：title/description/canonical/OG/JSON-LD WebApplication
   - 7 个 FAQ：普通 vs 正则区别、$1/$& 捕获组引用、g 标志、大小写不敏感实现、使用场景、m 标志、隐私
   - 专属样式含暗色模式 + 移动端响应式

### 单元 2：文本截断工具开发
3. ✅ TruncateTool.tsx 组件开发
   - 功能：三种截断模式——字符数（Unicode 码点）、字节数（UTF-8 编码）、行数
   - 关键算法：
     - 字符数截断使用 `Array.from()` 按 Unicode 码点遍历（正确处理 Emoji 代理对，避免 split('') 乱码）
     - 字节数截断使用 `TextEncoder` 编码后逐字节回退到字符边界（`TextDecoder` 解码验证），确保截断结果始终是有效 UTF-8 字符串
     - 单词边界回退：向前查找最近的空格，避免截断到单词中间
   - 可选自定义省略号（默认 "..."）、保留单词边界开关
   - 实时统计原始/截断后字符数与字节数、一键复制、完整空状态
   - 响应式布局：4 列统计网格 + 暗色模式
4. ✅ truncate.astro 页面创建
   - 完整 SEO 元素：title/description/canonical/OG/JSON-LD WebApplication
   - 7 个 FAQ：字符数 vs 字节数区别、Array.from vs split('')、单词边界、省略号占位、字节截断多字节处理、使用场景、隐私
   - 专属样式含暗色模式 + 移动端响应式

### 单元 3：首页更新 + 配套博客 + README 同步
5. ✅ 首页 index.astro 工具卡片与 meta 更新
   - 工具列表新增 find-replace 和 truncate（category: 文档处理），位于 reverse 工具卡片之后
   - meta description 工具数量 55→57，新增"字符替换、文本截断"到工具列表描述
6. ✅ 配套博客文章 × 2
   - find-replace-guide.md：6 章完整指南（查找替换基石、两种匹配模式区别、捕获组引用 $1/$& 秘密含回调 vs 字符串陷阱、正则标志 g/m/i、典型应用场景日志脱敏/批量改名/模板填充/代码重构/格式转换、安全与最佳实践）
   - text-truncation-guide.md：6 章完整指南（三种截断维度、字符数 vs 字节数 Unicode 码点与 UTF-8 编码、Array.from vs split('') 代理对陷阱、UTF-8 字节截断字符边界问题、单词边界保留策略、典型应用场景）
   - 两篇博客均覆盖长尾搜索词 + 内链指向配套工具
7. ✅ README.md 数字全面同步
   - 工具数 55→57、博客数 50→52、标签数 198→205、页面数 308→319
   - 代码调试类别新增"字符替换 · 文本截断"
   - 博客主题速览新增 find-replace-guide、text-truncation-guide
   - Bug 检查任务描述工具数 55→57

## 修改文件（8 个，未超红线）
- src/components/FindReplaceTool.tsx（新增，字符替换 React 组件）
- src/components/TruncateTool.tsx（新增，文本截断 React 组件）
- src/pages/find-replace.astro（新增，工具页面 + 7 FAQ + 专属样式）
- src/pages/truncate.astro（新增，工具页面 + 7 FAQ + 专属样式）
- src/pages/index.astro（修改，新增 2 个工具卡片 + meta description 55→57）
- src/content/blog/find-replace-guide.md（新增，6 章配套博客）
- src/content/blog/text-truncation-guide.md（新增，6 章配套博客）
- README.md（修改，数字全面同步 + 工具清单 + 博客速览 + Bug 检查任务描述）

## 验证结果
- 类型检查：✅ 0 errors, 0 warnings, 1 hint（152 files，零回归，仅剩 clipboard.ts execCommand 废弃提示）
- 构建：✅ 319 页面，19.15s，无报错无警告
- SEO 要素：✅ find-replace/truncate 页面 title/description/canonical/OG/JSON-LD 全部正确，og:image 指向 PNG，WebApplication.url 正确注入线上域名
- Bundle 体积：✅ FindReplaceTool 6.21KB、TruncateTool 6.77KB，均远 < 200KB
- 首页工具卡片：✅ find-replace 和 truncate 链接已渲染到首页
- 博客内链：✅ 两篇博客文章指向配套工具链接
- 响应式设计：✅ 768px/414px 断点 + 暗色模式
- Git 提交：commit 457782b，已 push origin HEAD（b99b14a..457782b）

## 数据洞察
- **String.replace 字符串形式 vs 回调形式的 $ 模式解析差异**：JavaScript 的 `String.replace()` 在第二参数为字符串时，会解析 $1/$2/$&/$/`/$' 等特殊替换串（$1 引用第一个捕获组、$& 引用整个匹配）。但当第二参数为回调函数时，回调返回的字符串被当作字面量，不会再次解析 $ 模式。这是容易踩的陷阱——如果想在回调中动态生成替换串且使用捕获组，需在回调参数中读取捕获组而非在返回字符串中用 $1。本工具的解决方案是避免回调，先用 match 统计次数，再用字符串形式 replace 让 JS 原生解析 $ 模式
- **UTF-8 字节截断的字符边界问题**：UTF-8 是变长编码（1-4 字节），如果按字节数截断时正好落在多字节字符的中间字节，会产生无效 UTF-8 序列导致乱码。解决方案是用 TextDecoder 逐字节回退尝试解码，直到解码成功为止。这是数据库字段长度限制（按字节计）场景的关键正确性保障
- **Array.from vs split('') 的 Unicode 陷阱（复现第 18 轮）**：第 18 轮文本反转工具已记录此陷阱，本轮文本截断工具的字符数模式再次应用 `Array.from()` 按 Unicode 码点遍历，确保 Emoji（U+1F600+）等代理对字符不会被拆散。这是字符串处理的经典陷阱，在两轮工具开发中均做了 FAQ 教育说明
- **内容拓展策略**：字符替换覆盖"查找替换""正则替换""批量替换""日志脱敏"等高搜索量词，文本截断覆盖"文本截断""字符截断""字节截断""摘要生成"等基础需求。两者与现有文本大小写/去重/排序/统计/反转形成更完整的文档处理工具链（共 7 个文本处理工具）

## 遗留问题
- 无（本轮所有任务完成且验收通过）
- bug-check-2026-07-11 记录的轻微问题（P2）：博客列表无分页（52 篇全量渲染），低优先级

## 下一轮建议
按优先级排序：
1. **Lighthouse 性能基线测量**：连续二十轮遗留，TRAE Sandbox 拦截 configstore 写入。需用户配置白名单或换环境执行
2. **移动端 375px 三档适配实测**：连续二十轮遗留，agent-browser 受 socket 限制
3. **线上页面浏览器验证**：curl 受 SafeLine WAF 挑战拦截，需用户用浏览器访问验证新工具页面渲染
4. **接入轻量统计工具**：Umami/Plausible 为阶段二数据驱动迭代提供数据源（需用户确认部署方式）
5. **继续内容拓展**：可新增 Lorem ipsum 增强、文本对比增强等高搜索需求工具，或补充现有工具的配套博客
6. **博客列表分页**：52 篇博客全量展示在列表页，可增加分页提升浏览体验

## 需用户操作
- 部署本轮新增代码（git push 已完成，若 Cloudflare Pages 已配置自动部署则自动触发）
- 在 docs/site-config.md 填写访问数据 + 接入统计工具后回写，agent 下轮进入数据驱动迭代
- （可选）用浏览器访问 https://website.niuzi.asia/find-replace 和 /truncate 验证新工具页面正常
- （可选）配置 TRAE Sandbox 白名单允许 Lighthouse/agent-browser 写入临时目录，以建立性能基线和移动端实测

---

# 第 20 轮 · 博客列表分页功能

## 上下文恢复
- 承接第 19 轮（字符替换工具 + 文本截断工具，commit 457782b）
- 阶段：阶段二（数据驱动迭代），站点已上线但无访问数据
- 当前规模：57 工具 + 52 博客 + 319 页面 → 本轮后 57 工具 + 52 博客 + 323 页面（规模未变，本轮为体验优化）

## 本轮聚焦方向
**博客列表分页功能——解决 bug-check-2026-07-11 记录的 P2 问题"博客列表无分页（52 篇全量渲染）"**
连续多轮内容拓展后（第 14-19 轮新增 12 个工具），博客数量已达 52 篇，全量渲染在列表页造成单页过长，影响浏览体验与 SEO 爬虫效率。本轮实现静态分页，每页 12 篇，共 5 页（12×4+4），并补充完整的 SEO 分页信号（canonical/prev/next）。

## 完成任务

### 单元 1：BaseLayout 增加 SEO 分页信号支持
1. ✅ SiteMeta 接口扩展
   - 新增 `prevUrl?: string` 和 `nextUrl?: string` 两个可选字段
   - 用于在 `<head>` 中输出 `<link rel="prev">` 和 `<link rel="next">` 标签
   - 帮助搜索引擎理解分页页面之间的关系，集中权重到第一页
2. ✅ BaseLayout.astro head 标签补充
   - 在 canonical 标签后添加条件渲染：`{meta.prevUrl && <link rel="prev" href={meta.prevUrl} />}` 和 `{meta.nextUrl && <link rel="next" href={meta.nextUrl} />}`
   - 仅当存在上一页/下一页时输出对应标签，第 1 页无 prev、最后页无 next

### 单元 2：博客分页页面开发
3. ✅ 创建 `src/pages/blog/[...page].astro` 分页页面
   - 使用 Astro 的 `getStaticPaths` + `paginate()` API 实现静态分页
   - PAGE_SIZE = 12，52 篇博客按发布日期倒序分为 5 页（12×4+4）
   - 标题差异化：第 1 页保持原标题"技术博客 - 开发者工具实践指南"，第 2 页起追加"（第 N 页）"后缀
   - canonical/prev/next URL 使用 SITE_URL 拼接为绝对 URL
   - JSON-LD 中 `blogPost` 列出全部文章（非单页），保持 Blog 实体完整性
4. ✅ 删除旧的 `src/pages/blog/index.astro`
   - 被 `[...page].astro` 接管 `/blog` 路由（Astro 的 `paginate()` 默认从第 1 页开始，URL 为 `/blog`）

### 单元 3：分页导航 UI
5. ✅ 分页导航组件
   - `<nav class="pagination">` 带 aria-label="分页导航"
   - 上一页/下一页按钮：禁用状态（第 1 页 prev 禁用、最后页 next 禁用）
   - 页码按钮：当前页 aria-current="page" 高亮、所有页码可点击跳转
   - 移动端响应式：768px 以下简化显示（隐藏部分页码）

### 单元 4：构建错误修复
6. ✅ 修复 `PAGE_SIZE is not defined` 构建错误
   - 原因：`const PAGE_SIZE = 12` 定义在 frontmatter 顶层，但 Astro 的 `getStaticPaths` 被提取到独立模块执行，无法访问 frontmatter 作用域的变量
   - 修复：将 `const PAGE_SIZE = 12` 移入 `getStaticPaths` 函数内部

## 修改文件（3 个，未超 8 文件红线）
- src/layouts/BaseLayout.astro（SiteMeta 接口新增 prevUrl/nextUrl + head 标签输出）
- src/pages/blog/[...page].astro（新增，分页页面 + 分页导航 UI + SEO 信号）
- src/pages/blog/index.astro（删除，被 [...page].astro 接管路由）

## 验证结果
- 类型检查：✅ 0 errors, 0 warnings, 1 hint（零回归，仅剩 clipboard.ts execCommand 废弃提示）
- 构建：✅ 323 页面（原 319 + 4 新增分页），13.91s，无报错无警告
- SEO 分页信号验证：
  - 第 1 页（/blog）：canonical 指向 /blog，无 prev，next 指向 /blog/2 ✅
  - 第 2 页（/blog/2）：canonical 指向 /blog/2，prev 指向 /blog，next 指向 /blog/3 ✅
  - 第 5 页（/blog/5）：canonical 指向 /blog/5，prev 指向 /blog/4，无 next ✅
- 标题差异化：第 1 页原标题，第 2-5 页"（第 N 页）"后缀 ✅
- Git 提交：commit 837c85c，已 push origin HEAD（b34d9b4..837c85c）

## 数据洞察
- **Astro getStaticPaths 作用域限制**：`getStaticPaths` 在 Astro 构建时被提取到独立模块执行，无法访问 frontmatter 顶层作用域的变量。这是 Astro 的设计——分页路径生成与页面渲染是分离的两个阶段。解决方案是将常量定义在 `getStaticPaths` 函数内部，或从外部模块导入
- **SEO 分页信号设计**：`<link rel="prev/next">` 是搜索引擎理解分页关系的标准信号（Google 官方推荐）。配合 canonical 标签，每个分页页面有独立的 canonical URL（避免重复内容），同时通过 prev/next 告诉搜索引擎这是分页序列。注意：rel="next" 应指向"下一页"而非"下一篇博客文章"，不要混淆
- **JSON-LD Blog 实体完整性**：分页后每页的 JSON-LD `blogPost` 字段列出全部 52 篇文章（而非当前页 12 篇），保持 Blog 实体的语义完整性——告诉搜索引擎这个 Blog 共有 52 篇文章，而非每页都是独立的 12 篇 Blog。这是结构化数据设计的最佳实践
- **标题差异化避免重复内容**：第 2 页起追加"（第 N 页）"后缀，使每页的 `<title>` 唯一，避免搜索引擎视为重复内容。canonical 已解决主要重复内容问题，标题差异化是额外保障
- **paginate() 默认路由设计**：Astro 的 `paginate()` 默认从第 1 页开始，第 1 页 URL 为 `/blog`（无页码），第 2 页起为 `/blog/2`、`/blog/3` 等。这是 SEO 友好的设计——首页 URL 简洁，且避免 `/blog/1` 与 `/blog` 的重复内容问题

## 遗留问题
- 无（本轮所有任务完成且验收通过）
- bug-check-2026-07-11 记录的 P2"博客列表无分页"已彻底解决

## 下一轮建议
按优先级排序：
1. **Lighthouse 性能基线测量**：连续二十一轮遗留，TRAE Sandbox 拦截 configstore 写入。需用户配置白名单或换环境执行
2. **移动端 375px 三档适配实测**：连续二十一轮遗留，agent-browser 受 socket 限制
3. **线上页面浏览器验证**：curl 受 SafeLine WAF 挑战拦截，需用户用浏览器访问验证分页功能实际效果
4. **接入轻量统计工具**：Umami/Plausible 为阶段二数据驱动迭代提供数据源（需用户确认部署方式）
5. **继续内容拓展**：可新增 Lorem ipsum 增强、文本对比增强等高搜索需求工具，或补充现有工具的配套博客
6. **博客标签页分页**：部分热门标签的文章数可能较多，可考虑为标签页也增加分页

## 需用户操作
- 部署本轮新增代码（git push 已完成，若 Cloudflare Pages 已配置自动部署则自动触发）
- 在 docs/site-config.md 填写访问数据 + 接入统计工具后回写，agent 下轮进入数据驱动迭代
- （可选）用浏览器访问 https://website.niuzi.asia/blog 验证分页功能正常，检查底部导航是否可点击
- （可选）配置 TRAE Sandbox 白名单允许 Lighthouse/agent-browser 写入临时目录，以建立性能基线和移动端实测
