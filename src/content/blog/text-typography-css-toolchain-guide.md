---
title: "文本排版与 CSS 文本工具链实战：从占位生成到书写模式的端到端工作流"
description: "从开发者真实遇到的「占位文本未考虑 CJK 字符宽度导致布局测试失真、line-clamp 与 text-wrap: balance 同时使用导致 balance 失效、balance 未配合 max-width 导致平衡效果失效、text-shadow 偏移在 writing-mode: vertical-rl 下视觉错位、truncate 在 writing-mode 切换后行方向变化导致截断位置错位」场景切入，系统讲解占位文本生成、文本截断、换行控制、文本阴影、书写模式五道工序的正确顺序与衔接陷阱（生成未考虑 CJK 宽度导致测试失真、截断与换行属性冲突导致平衡失效、balance 缺少宽度约束导致效果失效、阴影偏移在竖排下视觉错位、截断在竖排下行方向变化导致位置错位），覆盖卡片标题多行省略、长文档阅读体验优化、多语言排版、装饰性标题设计、响应式文本布局五大典型场景，给出端到端工作流与工具矩阵协同建议，适用于前端工程师、UI 设计师、内容运营、国际化团队、响应式开发者的文本排版工作流参考。"
pubDate: 2026-07-27
tags: ["文本排版", "CSS", "工具链", "占位文本", "文本截断", "换行", "书写模式"]
relatedTool: "/text-wrap"
---

## 为什么"文本排版与 CSS 文本"是独立工作流

把一个**需要先用占位文本生成测试数据、再用截断控制多行省略、接着用换行平衡优化排版、然后加文字阴影增强视觉层次、最后用书写模式适配竖排标题**的真实工程场景——例如电商卡片墙标题排版、长文档阅读体验优化、多语言国际化排版、营销活动装饰性标题、响应式文本布局——从散乱属性堆砌演进为统一可治理的文本排版工作流，**这不是单个工具能覆盖的事**：知道 [占位文本生成工具](/lorem) 的文本生成没用，你需要判断占位字符宽度是否匹配真实 CJK 内容；知道 [多行省略工具](/truncate) 的 line-clamp 没用，你需要判断它是否与 text-wrap: balance 冲突；知道 [CSS text-wrap 工具](/text-wrap) 的 balance 值没用，你需要判断它是否需要 max-width 约束。

> **与已有的五篇专题博客边界划分**：[占位文本与 Mock 数据工程实践](/blog/placeholder-mock-data-guide)、[文本截断深度指南](/blog/text-truncation-guide)、[CSS text-wrap 换行指南](/blog/text-wrap-guide)、[CSS text-shadow 文字阴影深度指南](/blog/text-shadow-guide)、[CSS writing-mode 书写模式完全指南](/blog/writing-mode-guide) 各自聚焦单工具的原理与子属性；本博客聚焦"五工具端到端工作流的工序衔接"，回答"先做哪步、后做哪步、工序间有哪些隐性依赖"的工程问题。如果只是单点原理疑惑，参考对应专题博客；如果已经知道每个工具怎么用但不知道落地顺序与衔接陷阱，参考本文。两者互补不冲突。

真实文本排版场景里最容易踩的三个坑：

1. **占位文本未考虑 CJK 字符宽度差异**：开发者用 [Lorem Ipsum 生成器](/lorem) 生成拉丁字母占位文本测试卡片布局，但真实内容是中文，CJK 字符宽度约为拉丁字符的 2 倍，导致上线后中文内容溢出容器或换行位置错位——**根因是占位文本的字符宽度与真实内容不匹配**。正确做法是用 [占位内容生成器](/lorem) 切换到 CJK 模式生成等宽中文占位文本。
2. **line-clamp 与 text-wrap: balance 同时使用导致 balance 失效**：开发者用 [字符截断工具](/truncate) 设置 `-webkit-line-clamp: 3` 同时又设置 `text-wrap: balance`，但 balance 仅对自由换行的文本生效，line-clamp 限制了行数后 balance 的平衡算法被禁用——**根因是未理解 balance 的生效前提是自由换行**。正确做法是二选一，或先用 balance 平衡再截断。
3. **text-shadow 偏移在 writing-mode: vertical-rl 下视觉错位**：开发者用 [文字阴影工具](/text-shadow) 设计了 `2px 2px 4px` 的阴影效果，在横排下看起来正常，但切换到 [书写模式工具](/writing-mode) 的 `vertical-rl` 后阴影方向视觉上变成"向左下"而非"向右下"——**根因是 text-shadow 的 X/Y 偏移是物理方向不变但视觉感受随书写方向变化**。正确做法是竖排下重新调整阴影偏移值。

本文不重复单个工具的深度教程（已有 [占位文本与 Mock 数据工程实践](/blog/placeholder-mock-data-guide)、[文本截断深度指南](/blog/text-truncation-guide)、[CSS text-wrap 换行指南](/blog/text-wrap-guide)、[CSS text-shadow 文字阴影深度指南](/blog/text-shadow-guide)、[CSS writing-mode 书写模式完全指南](/blog/writing-mode-guide) 等单点博客覆盖原理与子属性），而是聚焦**工序衔接与场景决策**——这是单点教程无法回答的问题。

> 配套工具矩阵：[占位文本生成工具](/lorem) · [多行省略工具](/truncate) · [换行平衡工具](/text-wrap) · [阴影效果工具](/text-shadow) · [竖排文字工具](/writing-mode)

## 五道工序的正确顺序矩阵

### 工序矩阵

| 序号 | 工序 | 工具 | 阶段 | 何时执行 | 顺序敏感性 |
| --- | --- | --- | --- | --- | --- |
| 1 | 占位文本生成 | /lorem/ | 生成阶段 | 设计稿阶段生成测试数据验证布局 | 中（独立于后续工序，但影响测试真实性） |
| 2 | 文本截断 | /truncate/ | 截断阶段 | 控制标题/摘要的多行省略 | 高（与换行属性存在冲突） |
| 3 | 换行控制 | /text-wrap/ | 换行阶段 | 平衡换行避免孤行、优化阅读体验 | 高（依赖截断属性是否冲突） |
| 4 | 文本阴影 | /text-shadow/ | 装饰阶段 | 增强视觉层次、装饰性标题 | 中（独立于排版，但依赖书写方向） |
| 5 | 书写模式 | /writing-mode/ | 方向阶段 | 竖排标题、多语言国际化排版 | 高（影响阴影偏移与截断方向） |

### 关键顺序原则

**生成 → 截断 → 换行 → 装饰 → 方向** 这五道工序的默认顺序存在三个关键约束：

1. **截断先于换行**：必须先用 [文本裁剪工具](/truncate) 确定 line-clamp 行数，再决定是否启用 [balance 换行工具](/text-wrap) 的 balance 值——**未截断就启用 balance 会导致平衡算法与截断冲突**：balance 试图在所有行间平衡文本宽度，但 line-clamp 限制了行数后 balance 的平衡空间被压缩，最终效果是 balance 失效或截断位置错位。正确做法是先用截断确定行数，再判断是否需要 balance（通常 balance 与 line-clamp 二选一）。
2. **装饰先于方向**：[文字阴影生成器](/text-shadow) 的偏移值必须在 [writing-mode 工具](/writing-mode) 切换书写方向前确定——**未确定阴影就切换书写模式会导致视觉错位**：text-shadow 的 X 偏移是水平方向、Y 偏移是垂直方向，在 `vertical-rl` 下视觉上 X 偏移变成"上下"、Y 偏移变成"左右"，开发者会误以为阴影方向错误。正确做法是横排下确定阴影偏移值，切换竖排后重新校准。
3. **生成先于截断**：[Mock 数据占位工具](/lorem) 生成的占位文本必须在 [截断省略工具](/truncate) 测试前完成——**未生成真实宽度占位就测试截断会导致行数判断失真**：拉丁字母占位文本的字符宽度约为 CJK 字符的一半，3 行拉丁字母截断可能对应 1.5 行中文，导致上线后截断位置与设计稿不符。正确做法是先用占位工具生成 CJK 模式文本，再测试截断。

### 顺序的反模式

最常见的反模式是**直接对 line-clamp 截断的文本启用 text-wrap: balance**：开发者在 [多行省略工具](/truncate) 中设置 `-webkit-line-clamp: 3` 后，又在同一元素上设置 `text-wrap: balance`，期望 balance 平衡三行文本的宽度——**根因是未理解 balance 的生效前提是自由换行**。balance 算法需要在所有可能的换行点中寻找最优解，line-clamp 限制了行数后算法空间被压缩，浏览器会优先满足 line-clamp 而忽略 balance。正确做法是二选一：需要平衡就用 balance 不用 line-clamp，需要截断就用 line-clamp 不用 balance。

另一个反模式是**占位文本用拉丁字母测试 CJK 布局**：开发者用 [占位文本工具](/lorem) 默认生成 Lorem Ipsum 拉丁字母占位文本测试卡片标题布局，3 行拉丁字母在 200px 宽容器中显示正常，但上线后真实中文标题 1.5 行就溢出容器——**根因是占位字符宽度与真实内容不匹配**。正确做法是用 [CJK 占位文本生成器](/lorem) 切换到中文模式生成等宽占位文本。

## 阶段一：占位文本生成（LoremTool）

### 生成阶段的核心产出

占位文本生成不是"随便填点字"，而是产出**与真实内容字符宽度匹配的测试数据**——一份覆盖目标语言、目标长度、目标字符类别的占位文本。占位数据集包含三个层次：

| 层次 | 含义 | 生成要点 |
| --- | --- | --- |
| 拉丁字母占位 | Lorem Ipsum 经典占位 | 适合英文/西欧语言场景，字符宽度约 0.5em |
| CJK 中文占位 | 模拟真实中文内容 | 字符宽度约 1em，是拉丁字母的 2 倍 |
| 混排占位 | 中英混排模拟国际化内容 | 测试混排时的换行与截断行为 |

生成阶段必须回答三个问题：

1. **目标内容的主要语言是什么**：用 [占位内容生成器](/lorem) 选择拉丁/CJK/混排模式，确保字符宽度匹配真实内容。中文场景必须用 CJK 模式，否则布局测试失真。
2. **目标内容的预期长度是多少**：标题通常 10-30 字，摘要通常 50-200 字，正文段落通常 200-500 字。生成时按目标长度生成，避免过短或过长导致测试失真。
3. **是否包含特殊字符**：标点符号、数字、Emoji 等特殊字符的宽度与普通字符不同，混排时会影响换行点。需要用 [Mock 数据占位工具](/lorem) 开启特殊字符模式测试边界场景。

### 生成阶段的衔接陷阱

**陷阱 1：CJK 字符宽度未匹配导致布局失真**

开发者用 [Lorem Ipsum 生成器](/lorem) 生成 100 字符的拉丁字母占位文本测试卡片标题布局，容器宽度 200px 下显示 3 行，但上线后真实中文标题 50 字符就占满 3 行（CJK 字符宽度是拉丁字母的 2 倍），导致截断位置与设计稿不符——**根因是占位字符宽度与真实内容不匹配**。正确做法是用 [占位文本生成工具](/lorem) 切换到 CJK 模式生成等宽中文占位文本。

**陷阱 2：Emoji 代理对导致字符计数错位**

开发者用 [占位文本工具](/lorem) 生成包含 Emoji 的占位文本，但 Emoji 是代理对（surrogate pair），`String.length` 返回 2 而非 1，导致 [字符截断工具](/truncate) 按字符数截断时把 Emoji 拆成两半显示为乱码——**根因是未使用 `Array.from(str).length` 或 `[...str].length` 按码点计数**。正确做法是截断时用码点计数而非 UTF-16 编码单元计数。

## 阶段二：文本截断（TruncateTool）

### 截断阶段的核心产出

文本截断不是"简单裁剪"，而是产出**符合视觉层次的省略效果**——单行省略用 `text-overflow: ellipsis`，多行省略用 `-webkit-line-clamp`，按字符数截断用 JavaScript。截断方案包含三个层次：

| 层次 | 含义 | 实现要点 |
| --- | --- | --- |
| 单行省略 | 一行内显示不下时省略 | `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;` |
| 多行省略 | N 行内显示不下时省略 | `-webkit-line-clamp: N; -webkit-box-orient: vertical;` |
| 字符截断 | 按字符数/字节数截断 | JavaScript 按码点或字节计数，注意 Unicode 代理对 |

截断阶段必须回答三个问题：

1. **截断的物理边界是什么**：按行数截断（line-clamp）适合固定高度容器，按字符数截断适合固定宽度容器。用 [文本截断工具](/truncate) 选择截断方式。
2. **截断后是否保留省略号**：单行省略默认保留省略号，多行省略需要 `text-overflow: ellipsis` 配合，字符截断需要手动添加省略号。
3. **截断是否与换行属性冲突**：line-clamp 与 text-wrap: balance 冲突，需要二选一。用 [多行省略工具](/truncate) 测试冲突场景。

### 截断阶段的衔接陷阱

**陷阱 1：line-clamp 与 text-wrap: balance 冲突**

开发者用 [文本裁剪工具](/truncate) 设置 `-webkit-line-clamp: 3` 后又设置 `text-wrap: balance`，期望 balance 平衡三行文本宽度，但浏览器优先满足 line-clamp 忽略 balance，最终效果是 balance 失效——**根因是未理解 balance 的生效前提是自由换行**。正确做法是二选一：需要平衡就用 balance 不用 line-clamp，需要截断就用 line-clamp 不用 balance。

**陷阱 2：Unicode 代理对被截断为乱码**

开发者用 [字符截断工具](/truncate) 按 `str.slice(0, 50)` 截断文本，但文本中包含 Emoji（如 👨‍👩‍👧‍👦 是 7 个 UTF-16 编码单元），`slice(0, 50)` 可能把 Emoji 拆成两半显示为乱码——**根因是未按码点计数**。正确做法是用 `Array.from(str).slice(0, 50).join('')` 或 `[...str].slice(0, 50).join('')` 按码点截断。

**陷阱 3：writing-mode 切换后 line-clamp 行方向变化**

开发者用 [截断省略工具](/truncate) 设置 `-webkit-line-clamp: 3` 在横排下显示 3 行，但切换到 [竖排排版工具](/writing-mode) 的 `vertical-rl` 后，line-clamp 仍然按 3 行计数，但行的物理方向从"水平行"变成"垂直列"，视觉上变成 3 列而非 3 行——**根因是 line-clamp 的"行"是逻辑行而非物理行**。正确做法是切换书写模式后重新校准 line-clamp 值。

## 阶段三：换行控制（TextWrapTool）

### 换行阶段的核心产出

换行控制不是"让它自己换行"，而是产出**符合阅读美学的换行效果**——`wrap` 默认换行、`nowrap` 不换行、`balance` 平衡换行、`pretty` 分散孤行、`stable` 稳定换行。换行方案包含三个层次：

| 层次 | 含义 | 适用场景 |
| --- | --- | --- |
| 默认 wrap | 浏览器默认换行算法 | 长段落正文，性能最优 |
| balance | 平衡多行文本宽度 | 标题、卡片标题、短文本，避免孤行 |
| pretty | 优化孤行与寡行 | 长文档正文，避免最后一行只有 1-2 个字 |

换行阶段必须回答三个问题：

1. **换行的目标是平衡还是分散**：balance 适合短文本（标题、卡片），pretty 适合长文本（正文、段落）。用 [换行优化工具](/text-wrap) 选择换行算法。
2. **是否需要 max-width 约束**：balance 算法在 10 行内生效，超出 10 行自动降级为 wrap。需要用 max-width 限制容器宽度确保 balance 生效。
3. **是否与截断属性冲突**：line-clamp 与 balance 冲突，需要二选一。用 [balance 换行工具](/text-wrap) 测试冲突场景。

### 换行阶段的衔接陷阱

**陷阱 1：balance 未配合 max-width 导致效果失效**

开发者用 [CSS text-wrap 工具](/text-wrap) 设置 `text-wrap: balance` 但未设置 max-width，容器宽度 100% 时 balance 算法在超宽容器下平衡效果不明显，且超过 10 行自动降级为 wrap——**根因是未约束容器宽度**。正确做法是配合 `max-width: 30ch` 或固定宽度约束容器，让 balance 在合理范围内生效。

**陷阱 2：balance 超过 10 行自动降级**

开发者用 [换行平衡工具](/text-wrap) 设置 `text-wrap: balance` 期望平衡 20 行文本，但浏览器规范限制 balance 仅在 6-10 行内生效（具体行数因浏览器实现而异），超出后自动降级为 wrap——**根因是未理解 balance 的行数限制**。正确做法是长文本用 `text-wrap: pretty` 而非 balance。

**陷阱 3：stable 在动态内容下闪烁**

开发者用 [文本换行控制工具](/text-wrap) 设置 `text-wrap: stable` 期望动态追加内容时换行位置稳定，但 stable 仅在前 3 行生效，超出后降级为 wrap，导致动态内容追加时前 3 行稳定、后续行闪烁——**根因是未理解 stable 的行数限制**。正确做法是动态内容用 `text-wrap: pretty` 或固定行数。

## 阶段四：文本阴影（TextShadowTool）

### 装饰阶段的核心产出

文本阴影不是"加点阴影就好"，而是产出**符合视觉层次的装饰效果**——霓虹发光、3D 立体、描边、浮雕、投影等不同效果对应不同的阴影参数组合。阴影方案包含三个层次：

| 层次 | 含义 | 实现要点 |
| --- | --- | --- |
| 投影阴影 | 单一方向偏移的阴影 | `offset-x offset-y blur color`，适合标题层次感 |
| 描边阴影 | 多方向阴影组合 | 8 方向阴影叠加，适合文字描边 |
| 立体阴影 | 多层阴影递进 | 多层 `offset-x offset-y` 递增，适合 3D 效果 |

装饰阶段必须回答三个问题：

1. **阴影的视觉目标是什么**：投影增强层次感、描边增强可读性、立体增强装饰性。用 [阴影效果工具](/text-shadow) 选择阴影类型。
2. **阴影偏移方向是否匹配书写方向**：横排下 X 偏移是左右、Y 偏移是上下，竖排下视觉方向变化。用 [text-shadow 生成器](/text-shadow) 测试不同书写方向。
3. **阴影是否影响可读性**：过深的阴影会降低文字对比度，影响可读性。需要配合 `color-contrast` 校验。

### 装饰阶段的衔接陷阱

**陷阱 1：text-shadow 偏移在 vertical-rl 下视觉错位**

开发者用 [文字阴影工具](/text-shadow) 设计 `text-shadow: 2px 2px 4px rgba(0,0,0,0.5)`，在横排下阴影向右下偏移视觉自然，但切换到 [书写模式工具](/writing-mode) 的 `vertical-rl` 后，X 偏移仍然是水平方向（左右），但视觉上"右下"变成"左下"——**根因是 text-shadow 的偏移是物理方向不变但视觉感受随书写方向变化**。正确做法是竖排下重新调整偏移值，或用 `text-shadow: 2px 2px 4px` 改为 `text-shadow: -2px 2px 4px` 校正视觉方向。

**陷阱 2：多层阴影性能问题**

开发者用 [阴影装饰工具](/text-shadow) 设计 8 方向描边阴影（8 层 text-shadow），在长段落正文上应用导致渲染性能下降，滚动卡顿——**根因是 text-shadow 是合成层属性，多层阴影在长文本上性能开销大**。正确做法是描边阴影仅用于标题、按钮等短文本，长文本用单层阴影或不用阴影。

**陷阱 3：阴影颜色与背景对比度不足**

开发者用 [文字阴影生成器](/text-shadow) 设计白色文字 + 浅灰色阴影，在白色背景下文字几乎不可见——**根因是未校验阴影与背景的对比度**。正确做法是用 [颜色对比度工具](/color-contrast) 校验文字、阴影、背景三者的对比度，确保满足 WCAG AA 标准。

## 阶段五：书写模式（WritingModeTool）

### 方向阶段的核心产出

书写模式不是"切换竖排就好"，而是产出**符合多语言国际化规范的排版方向**——`horizontal-tb` 横排、`vertical-rl` 竖排右到左、`vertical-lr` 竖排左到右、`sideways-rl` 侧排右到左、`sideways-lr` 侧排左到右。方向方案包含三个层次：

| 层次 | 含义 | 适用场景 |
| --- | --- | --- |
| horizontal-tb | 横排从上到下 | 中文/英文/西欧语言默认方向 |
| vertical-rl | 竖排从右到左 | 中文古籍、日文竖排、装饰性标题 |
| vertical-lr | 竖排从左到右 | 蒙古文、部分少数民族语言 |

方向阶段必须回答三个问题：

1. **目标语言的书写方向是什么**：中文/英文默认 horizontal-tb，日文古籍 vertical-rl，蒙古文 vertical-lr。用 [writing-mode 工具](/writing-mode) 选择书写模式。
2. **是否需要配合 text-orientation**：竖排下拉丁字母默认横躺，需要 `text-orientation: upright` 让字母直立。用 [竖排文字工具](/writing-mode) 测试 text-orientation。
3. **是否影响其他文本属性**：text-shadow 偏移方向、line-clamp 行方向、text-wrap 换行点都会随书写模式变化。用 [文本方向工具](/writing-mode) 测试属性联动。

### 方向阶段的衔接陷阱

**陷阱 1：line-clamp 在书写模式切换后行方向变化**

开发者用 [多行省略工具](/truncate) 设置 `-webkit-line-clamp: 3` 在横排下显示 3 行，切换到 [竖排排版工具](/writing-mode) 的 `vertical-rl` 后，line-clamp 仍然按 3 行计数，但行的物理方向从"水平行"变成"垂直列"，视觉上变成 3 列而非 3 行——**根因是 line-clamp 的"行"是逻辑行而非物理行**。正确做法是切换书写模式后重新校准 line-clamp 值，或用字符截断替代行截断。

**陷阱 2：text-orientation 未配合导致拉丁字母横躺**

开发者用 [书写模式工具](/writing-mode) 切换到 `vertical-rl` 期望中文标题竖排，但标题中包含拉丁字母（如 "AI 时代"），拉丁字母默认横躺显示（A 和 I 横躺着），视觉不协调——**根因是未设置 `text-orientation: upright`**。正确做法是用 [竖排文字工具](/writing-mode) 配合 `text-orientation: upright` 让拉丁字母直立。

**陷阱 3：text-wrap 在竖排下换行点错位**

开发者用 [换行优化工具](/text-wrap) 设置 `text-wrap: balance` 在横排下平衡换行，切换到 [writing-mode 工具](/writing-mode) 的 `vertical-rl` 后，balance 算法仍然按"水平行"平衡，但视觉上是"垂直列"，导致平衡效果与预期不符——**根因是 text-wrap 的"行"是逻辑行而非物理行**。正确做法是竖排下重新测试 balance 效果，或用 `text-wrap: pretty` 替代。

## 五大典型场景

### 场景一：卡片标题多行省略

**工作流**：[占位文本生成工具](/lorem) 生成 CJK 占位 → [文本截断工具](/truncate) 设置 line-clamp: 2 → 跳过 text-wrap: balance（与 line-clamp 冲突） → [阴影效果工具](/text-shadow) 添加投影增强层次 → [书写模式工具](/writing-mode) 默认横排

**关键决策**：line-clamp 与 balance 二选一，卡片标题通常选 line-clamp 保证固定行数，牺牲 balance 的平衡效果。

**衔接陷阱**：占位文本必须用 CJK 模式，否则拉丁字母占位测试的 2 行在真实中文内容下可能变成 1 行或 3 行。

### 场景二：长文档阅读体验优化

**工作流**：[Lorem Ipsum 生成器](/lorem) 生成长文占位 → 跳过 truncate（长文不截断） → [换行平衡工具](/text-wrap) 设置 `text-wrap: pretty` 分散孤行 → 跳过 text-shadow（长文不用阴影） → [writing-mode 工具](/writing-mode) 默认横排

**关键决策**：长文用 `pretty` 而非 `balance`，因为 balance 仅在 10 行内生效，长文超出后自动降级。pretty 优化孤行与寡行，避免最后一行只有 1-2 个字。

**衔接陷阱**：pretty 是新属性，浏览器兼容性需确认（Chrome 117+ 支持），旧浏览器降级为 wrap。

### 场景三：多语言排版

**工作流**：[Mock 数据占位工具](/lorem) 生成中英混排占位 → [字符截断工具](/truncate) 按码点截断避免 Emoji 拆分 → [CSS text-wrap 工具](/text-wrap) 设置 wrap 默认换行 → 跳过 text-shadow（多语言不用阴影） → [竖排文字工具](/writing-mode) 切换 vertical-rl + text-orientation: upright

**关键决策**：多语言混排必须用码点截断（避免 Emoji 代理对拆分），竖排下拉丁字母用 `text-orientation: upright` 直立显示。

**衔接陷阱**：竖排下 line-clamp 的行方向变化，需要重新校准行数或改用字符截断。

### 场景四：装饰性标题设计

**工作流**：[占位内容生成器](/lorem) 生成短标题占位 → 跳过 truncate（短标题不截断） → [balance 换行工具](/text-wrap) 设置 balance 平衡换行 → [文字阴影生成器](/text-shadow) 设计 3D 立体阴影 → [文本方向工具](/writing-mode) 切换 vertical-rl 竖排标题

**关键决策**：装饰性标题用 balance 平衡换行 + 3D 立体阴影 + 竖排方向，营造视觉冲击力。

**衔接陷阱**：竖排下 text-shadow 偏移方向视觉变化，需要重新调整偏移值（横排下 `2px 2px` 视觉"右下"，竖排下需改为 `-2px 2px` 校正为视觉"右下"）。

### 场景五：响应式文本布局

**工作流**：[占位文本工具](/lorem) 生成不同长度占位测试响应式 → [截断省略工具](/truncate) 设置 line-clamp 响应式断点 → [文本换行控制工具](/text-wrap) 设置 balance 配合 max-width → 跳过 text-shadow（响应式不用阴影） → [书写模式工具](/writing-mode) 移动端横排 + 桌面端竖排

**关键决策**：响应式下移动端用横排（屏幕窄），桌面端可切换竖排（屏幕宽）。line-clamp 在不同断点下取不同值（移动端 2 行，桌面端 3 行）。

**衔接陷阱**：balance 需要 max-width 约束，响应式下 max-width 随断点变化，需要在每个断点下重新测试 balance 效果。

## 工具矩阵协同建议

| 场景 | 生成 | 截断 | 换行 | 装饰 | 方向 | 关键约束 |
| --- | --- | --- | --- | --- | --- | --- |
| 卡片标题 | CJK 占位 | line-clamp: 2 | 跳过（冲突） | 投影阴影 | 横排 | line-clamp 与 balance 二选一 |
| 长文档正文 | 长文占位 | 跳过 | pretty | 跳过 | 横排 | pretty 兼容性确认 |
| 多语言混排 | 混排占位 | 码点截断 | wrap | 跳过 | vertical-rl + upright | Emoji 代理对处理 |
| 装饰性标题 | 短标题占位 | 跳过 | balance | 3D 阴影 | vertical-rl | 阴影偏移方向校正 |
| 响应式布局 | 多长度占位 | 响应式 line-clamp | balance + max-width | 跳过 | 断点切换 | 每断点重新测试 |

## 总结

文本排版与 CSS 文本工具链的五道工序——**生成 → 截断 → 换行 → 装饰 → 方向**——看似独立，实则在工序衔接处存在大量隐性依赖：占位文本的字符宽度影响截断测试真实性、截断与换行属性存在冲突、阴影偏移随书写方向变化、line-clamp 的行方向在竖排下变化。理解这些衔接陷阱，才能从"单个属性会用"升级为"端到端工作流会用"。

核心原则：

1. **生成先于截断**：占位文本必须匹配真实内容字符宽度，CJK 场景必须用 CJK 模式占位。
2. **截断先于换行**：line-clamp 与 balance 二选一，不能同时使用。
3. **装饰先于方向**：阴影偏移值在横排下确定，切换竖排后重新校准。
4. **方向影响所有属性**：line-clamp 行方向、text-wrap 换行点、text-shadow 偏移方向都随书写模式变化。

掌握这五道工序的衔接关系，开发者就能从"会用单个 CSS 属性"升级为"设计端到端文本排版工作流"，覆盖卡片标题、长文档、多语言、装饰性标题、响应式布局五大典型场景。
