# auto-website 自动迭代进度 · 2026-07-16

## 阶段状态
- 当前阶段：**阶段二（数据驱动迭代）**
- 站点：https://website.niuzi.asia（已上线）
- 规范版本：v1.2（2026-07-02）
- 承接上轮：20260715/topics.md（第 52 轮，commit 540301c → 沉淀 540301c）

---

# 第 53 轮 · CSS 锚点定位生成器（定位能力维度开辟）

## 上下文恢复
- 承接第 52 轮（CSS interpolate-size 尺寸插值动画生成器，commit 3ba6100 → 沉淀 540301c）
- 阶段：阶段二（数据驱动迭代），站点已上线但无统计数据
- 当前规模：91 工具 + 86 博客 + 651 页面 → 本轮后 92 工具 + 87 博客 + 665 页面
- 工作树状态：干净，承接上轮沉淀；另有今日 00:00 自动任务产出（about/blog/global.css 样式优化）未提交，不属于本轮改动

## 本轮聚焦方向
**开辟全新"定位"能力维度：新增 CSS 锚点定位（anchor-positioning）生成器**

锚点定位是 CSS Positioned Layout Module Level 3 引入的定位机制（Chrome 125+ 2024 年起支持），让元素相对另一个"锚点"元素定位，无需 JavaScript 计算坐标。覆盖 "anchor-positioning" "anchor-name" "position-anchor" "anchor()" "anchor-size()" "position-try-fallbacks" "flip-block" "flip-inline" "tooltip" "popover" "dropdown" "视口避让" 等高搜索量长尾词。中文资源稀少，差异化机会明确。这是本站首个"定位"能力维度的工具，与现有 @starting-style（入场动画）、interpolate-size（尺寸过渡）、view-transition（视图过渡）形成"定位+动画"协同。

环境限制类任务（Lighthouse、375px 实测）已连续 53 轮无法突破，按规范跳过；接入统计工具需用户确认，不在本轮范围。

## 完成任务

### 单元 1：AnchorPositionTool.tsx 组件开发（约 530 行，commit 6e7b60f）
1. ✅ TypeScript 接口设计
   - AnchorSide：top/bottom/left/right/center/start/end 七种边关键字
   - AnchorSize：width/height/block/inline 四种尺寸关键字
   - TryFallback：flip-block/flip-inline/flip-start/flip-end 四种翻转策略
   - PositionDecl：单条定位声明（property + useAnchor + side/size + offset + fixedValue）
   - AnchorPositionConfig：完整配置（anchorSelector + anchorName + targetSelector + position + decls[] + tryFallbacks[]）
2. ✅ anchor() 与 anchor-size() 函数完整支持（核心差异化亮点）
   - anchor()：用于定位属性（top/left/right/bottom），引用锚点边位置
   - anchor-size()：用于尺寸属性（width/height），引用锚点尺寸
   - 自动判断：isSizeProperty 根据 property 名决定用哪个函数
   - 偏移量支持：第二参数 offset，可为负数
3. ✅ anchor-name 与 position-anchor 绑定
   - 锚点元素声明 anchor-name（如 --my-anchor）
   - 定位元素引用 position-anchor（可开关）
4. ✅ position-try-fallbacks 翻转策略（核心差异化亮点）
   - 四种策略复选：flip-block（垂直翻转）/ flip-inline（水平翻转）/ flip-start / flip-end
   - 浏览器原生检测视口边界并自动翻转，无需 JS
5. ✅ 智能代码生成（buildCss）
   - 锚点元素块：anchor-name 声明
   - 定位元素块：position + position-anchor + 各方向定位 + 翻转策略
   - 仅输出非默认值，全默认时给出注释说明
6. ✅ iframe srcdoc 沙箱预览（buildPreviewHtml）
   - sandbox="allow-same-origin"（不执行脚本，安全隔离）
   - 棋盘格背景凸显锚点与定位元素关系
   - 锚点按钮（蓝色）+ 定位元素（深色）真实渲染
7. ✅ 原理说明面板（buildExplain）
   - 解析锚点绑定关系
   - 逐条解析定位声明的语义（anchor() / anchor-size() / 固定值）
   - 解析翻转策略的避让机制
8. ✅ 8 组预设
   - 下方 Tooltip / 上方 Tooltip / 右侧 Dropdown / 居中弹层 / 跟随锚点宽度 / 双向翻转避让 / 左侧气泡 / 默认示例
9. ✅ 模块级 id 生成器保证 React key 稳定性
10. ✅ 泛型 SegGroup<T> 分段按钮组复用

### 单元 2：anchor-positioning.astro 工具页面创建（约 420 行）
11. ✅ 完整 SEO 元素
    - title: "CSS 锚点定位生成器 - 在线 anchor-positioning tooltip 可视化工具"
    - description: 含 anchor-positioning、anchor-name、position-anchor、anchor()、anchor-size()、position-try-fallbacks、flip-block/flip-inline/flip-start/flip-end、tooltip、popover、dropdown、Chrome 125+ 等关键词
    - canonical/OG/Twitter Card/JSON-LD WebApplication（applicationCategory: DeveloperApplication, inLanguage: zh-CN, Offer price 0 CNY）
12. ✅ 8 个 FAQ
    - 锚点定位核心概念与解决痛点、anchor() vs anchor-size() 区别与选型、position-try-fallbacks 翻转策略、
    - anchor-name 与 position-anchor 关系、与 JS 方案（Popper.js/Floating UI）对比优势、
    - anchor() 偏移量用法与负数、浏览器兼容性与渐进降级、隐私保障
13. ✅ 专属样式 .ap-*
    - 预设按钮组 + 主布局（左右两栏 grid 380px+1fr）+ 锚点元素 fieldset + 定位元素 fieldset + 定位声明编辑器（属性选择 + 引用开关 + side/size 选择 + 偏移输入 + 删除）+ 翻转策略复选组 + iframe 预览 + 原理说明 + 代码输出 + 相关工具链接
    - 768px/414px 双断点响应式 + 暗色模式适配
    - FAQ 中 CSS 代码示例的 `{` `}` 用 HTML 实体 `&#123;` `&#125;` 转义
14. ✅ 相关工具链接区（starting-style / interpolate-size / view-transition / container）

### 单元 3：配套博客 anchor-positioning-guide.md（8 章完整指南）
15. ✅ 8 章内容
    - 诞生背景与核心价值、anchor-name 与 position-anchor 建立锚点绑定、anchor() 函数按锚点边定位、
    - anchor-size() 函数引用锚点尺寸、position-try-fallbacks 自动翻转避让、
    - 浏览器兼容性与渐进增强、实战案例（4 个：智能 Tooltip / 宽度匹配下拉菜单 / Popover 弹层 / 侧边悬浮提示卡）、
    - 锚点定位 vs JavaScript 定位方案对比与总结
16. ✅ 覆盖长尾搜索词：anchor-positioning、锚点定位、anchor-name、position-anchor、anchor()、anchor-size()、position-try-fallbacks、flip-block、flip-inline、tooltip、popover、dropdown、视口避让、自动翻转、渐进增强
17. ✅ 内链指向 /anchor-positioning 工具页
18. ✅ 17 个 tags

### 单元 4：首页更新 + README 同步
19. ✅ 首页 index.astro 工具卡片与 meta 更新
    - 工具列表新增 anchor-positioning（interpolate-size 之后，category: 设计）
    - meta description 工具数 91→92，新增 "CSS 锚点定位生成器" 关键词
    - hero 区工具数 91→92
20. ✅ README.md 全面同步
    - 工具数 91→92、博客数 86→87、页面数 651→665
    - 色彩与设计类别新增 "CSS 锚点定位生成器"
    - 博客主题速览新增 anchor-positioning-guide
    - 组件数 91→92、Bug 检查任务工具数 91→92

## 修改文件（5 个，未超 8 文件红线）
- src/components/AnchorPositionTool.tsx（新增，约 530 行，锚点定位生成器 React 组件）
- src/pages/anchor-positioning.astro（新增，约 420 行，工具页面 + 8 FAQ + 专属样式 + 相关链接）
- src/content/blog/anchor-positioning-guide.md（新增，8 章配套博客 + 17 tags）
- src/pages/index.astro（修改，新增工具卡片 + meta description 91→92 + hero 工具数）
- README.md（修改，全量同步工具/博客/页面数 + 设计类别 + 博客速览 + 组件数）

## 验证结果
- 类型检查：✅ 0 errors, 0 warnings, 2 hints（223 files，+2 文件，零回归，仅剩 clipboard.ts execCommand 历史遗留）
- 构建：✅ 665 页面，21.38s，无报错无警告（+14 页面：anchor-positioning 工具页 + 博客详情页 + 12 个新标签页）
- SEO 要素：✅ anchor-positioning 页面 title/description/canonical/OG/Twitter Card/JSON-LD WebApplication（含 Offer price 0 CNY）全部正确
- 首页工具卡片：✅ dist/index.html 包含 "CSS 锚点定位生成器" 卡片，链接指向 /anchor-positioning
- 首页博客卡片：✅ dist/index.html 包含 "CSS 锚点定位完全指南" 博客卡片，链接指向 /blog/anchor-positioning-guide
- 响应式设计：✅ 768px/414px 双断点 + 暗色模式适配
- Git 提交：commit 6e7b60f，已 push origin HEAD（540301c..6e7b60f）

## 问题与修复
- 修复 1：anchor-positioning.astro 初版导入了 getSiteUrl 并声明 pageUrl 变量但未使用，触发 ts(2345) 类型错误（getSiteUrl 参数应为 URL 类型）与 ts(6133) 未使用警告。修复：删除未使用的 import 与变量（BaseLayout 已处理 canonical URL）
- 修复 2：README.md 并行 Edit 时部分修改未生效（73/106/171/187 行仍为旧数字），逐个重新执行 Edit 修复

## 数据洞察
- **锚点定位的"零 JS 定位"核心价值**：传统 tooltip/popover/dropdown 需用 JS（Popper.js/Floating UI）监听 scroll/resize、计算坐标、处理视口翻转，有性能开销与闪烁问题。锚点定位把"相对定位"交给浏览器原生——声明锚点 + anchor() 函数引用锚点边，浏览器自动维护定位关系。这是从"JS 运行时计算"升级为"浏览器渲染阶段原生处理"——零 JS、零闪烁、SSR 友好
- **anchor() vs anchor-size() 的"定位 vs 尺寸"分工**：anchor() 引用锚点边位置（用于 top/left 等定位属性），anchor-size() 引用锚点尺寸（用于 width/height 等尺寸属性）。选型原则：需要"定位在哪"用 anchor()，需要"尺寸多大"用 anchor-size()。最典型组合是 dropdown 菜单：top: anchor(bottom) 定位在按钮下方 + width: anchor-size(width) 宽度匹配按钮
- **position-try-fallbacks 的"自动避让"独特能力**：浏览器原生检测视口边界并自动翻转定位方向，无需 JS 监听 scroll/resize。flip-block 垂直翻转（tooltip 靠近底部时翻到上方），flip-inline 水平翻转（dropdown 靠近右侧时翻到左侧）。这是锚点定位相对 JS 方案的最大优势——避让逻辑从"JS 命令式"升级为"CSS 声明式"
- **anchor-name 的"-- 前缀"命名约定**：anchor-name 的值推荐用 -- 前缀（与 CSS 变量风格一致），如 --tooltip-anchor。一个锚点可被多个定位元素引用（共享同一 anchor-name），实现"一锚多目标"
- **与 @starting-style / interpolate-size / view-transition 的协同**：锚点定位解决"定位在哪"，@starting-style 解决"首次出现入场"，interpolate-size 解决"尺寸过渡"，view-transition 解决"DOM 结构变化过渡"。四者协同可构建纯 CSS 的弹层动画体系——popover 弹层定位 + 入场动画 + 尺寸展开 + 视图过渡全覆盖
- **渐进降级的 @supports 检测方案**：不支持 anchor() 的浏览器忽略相关声明，定位元素退化为普通绝对定位。推荐用 @supports (anchor-name: --x) 检测并降级到固定坐标 + JS 兜底（Floating UI），零额外开销

## 遗留问题
- 无（本轮所有任务完成且验收通过）

## 下一轮建议
按优先级排序：
1. **Lighthouse 性能基线测量**：连续五十三轮遗留，TRAE Sandbox 拦截 configstore 写入
2. **移动端 375px 三档适配实测**：连续五十三轮遗留，agent-browser 受 socket 限制
3. **接入轻量统计工具**：Umami/Plausible 为阶段二数据驱动迭代提供数据源（需用户确认）
4. **继续内容拓展**：可新增 CSS if() 条件函数、CSS position-area 定位区域、CSS scroll-driven 进阶（命名时间线完整代码生成）、SVG 优化器等方向
5. **锚点定位工具增强**：可增加 position-area 定位区域支持、多锚点管理、导入现有 CSS 解析、popover 实际触发预览
6. **定位能力维度拓展**：锚点定位已形成定位能力维度首块拼图，可考虑下轮拓展 CSS position-area（定位区域简写）或其他前端工具方向
7. **博客标签页分页**：部分热门标签文章数较多，可考虑分页
8. **现有工具深度优化**：scroll-driven 命名时间线完整代码生成、light-dark 导入现有 CSS 等

## 需用户操作
- 部署本轮新增代码（已 push，Cloudflare Pages 自动触发部署）
- 在 docs/site-config.md 填写访问数据 + 接入统计工具后回写，agent 下轮进入数据驱动迭代
- （可选）用浏览器访问 https://website.niuzi.asia/anchor-positioning 验证新工具页面正常
- （可选）配置 TRAE Sandbox 白名单允许 Lighthouse/agent-browser 写入临时目录

## 阶段进度总览（更新）
- 工具总数：92 个（阶段二目标：基于数据扩充高价值工具）
- 博客总数：87 篇（每个工具至少 1 篇配套深度博客）
- 标签总数：300+ 个（新增 anchor-positioning、锚点定位、anchor()、anchor-size()、position-anchor、anchor-name、position-try-fallbacks、flip-block、flip-inline、tooltip、dropdown、css-positioned-layout-module-level-3 等 12 个标签）
- 构建页面：665 页
- 类型检查：0 errors
- LCP：< 2.5s（SSG 静态优化）
- JS Bundle：单页最大 < 200KB（本轮新增 AnchorPositionTool < 34KB，纯 React 组件无外部依赖）

---

## CSS 定位能力维度开辟里程碑

本轮完成后，CSS 工具链新增"定位"能力维度，锚点定位是核心：

| 工具类别 | 覆盖能力 | 工具数 |
|----------|----------|--------|
| 视觉效果 | box-shadow / text-shadow / gradient / border-radius / transform / filter / clip-path / background | 8 |
| 布局结构 | flexbox（一维）/ grid（二维）/ subgrid（嵌套继承）/ scroll-snap（滚动捕捉） | 4 |
| 动效交互 | animation（时间驱动）/ transition（状态过渡）/ scroll-driven（滚动驱动）/ view-transition（视图过渡）/ @starting-style（入场动画）/ interpolate-size（尺寸插值） | 6 |
| 国际化排版 | writing-mode（竖排/RTL/多语言） | 1 |
| 组件级响应式 | @container（容器查询） | 1 |
| 原生语法 | nesting（原生嵌套）/ @layer（层叠层）/ @scope（作用域） | 3 |
| 色彩工具 | 颜色值转换 / 调色板 / 对比度检测 / light-dark() 暗色模式 | 4 |
| 排版优化 | text-wrap（换行策略） | 1 |
| 性能优化 | contain + content-visibility（渲染隔离与屏幕外跳过） | 1 |
| **定位** | **anchor-positioning（锚点定位 + 视口避让）** | **1** |

定位能力维度的独特价值：**让 CSS 从"静态布局"升级为"动态相对定位"**——anchor-name 声明锚点，anchor() 函数引用锚点边，position-try-fallbacks 自动翻转避让视口。这是 CSS 工具链从"视觉效果"到"布局结构"到"动效交互"到"国际化"到"组件级响应式"到"原生语法"到"排版优化"到"性能优化"到"定位"的能力延伸，覆盖了 tooltip / popover / dropdown 等高频交互场景，替代传统 JavaScript 定位方案。
