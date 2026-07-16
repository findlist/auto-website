---
title: "文本对比算法：LCS 与 Myers diff 的工程实践"
description: "系统讲解文本对比两大算法：LCS 动态规划与 Myers diff 差异算法，从朴素 O(m×n) 到 Git 用的 O((m+n)·D) 优化，覆盖行级与字符级 diff、相似度计算，附对比工具实操。"
pubDate: 2026-07-05
tags: ["diff", "算法", "LCS", "文本对比", "工具矩阵"]
relatedTool: "/diff"
---

## 为什么文本对比是开发者的日常

每个开发者每天都在做文本对比：

- `git diff` 看这次改了什么
- PR review 时对比新旧实现
- 配置文件从 v1 升级到 v2，对比差异
- 合并冲突时三方对比
- Code review 工具高亮修改行

但很少有人深究：<strong>这些差异是怎么算出来的？为什么有时候 git diff 把一整段函数标记成「全删 + 全增」，而不是精确到几行修改？</strong>

本文从最经典的 LCS 算法讲起，到 Git 实际使用的 Myers diff，再到工程实践中的取舍，帮你彻底理解 diff 的底层逻辑。

> 配套工具：[文本对比工具](/diff)

## 一、LCS：最长公共子序列

### 1.1 子序列 vs 子串

先区分两个概念：

- <strong>子串（substring）</strong>：原字符串中连续的一段。如 `abc` 是 `abcdef` 的子串，`adf` 不是。
- <strong>子序列（subsequence）</strong>：原字符串中保持相对顺序但不要求连续的字符。如 `adf` 是 `abcdef` 的子序列。

文本对比要找的是<strong>子序列</strong>，不是子串。因为修改可能分散在多处，相同的部分会被打散。

### 1.2 LCS 的动态规划解法

设两个序列 `A = a₁a₂...aₘ` 与 `B = b₁b₂...bₙ`，定义 `dp[i][j]` 为 `A[1..i]` 与 `B[1..j]` 的 LCS 长度。状态转移：

```
若 A[i] == B[j]:  dp[i][j] = dp[i-1][j-1] + 1
否则:             dp[i][j] = max(dp[i-1][j], dp[i][j-1])
```

边界：`dp[0][j] = dp[i][0] = 0`（空序列与任何序列的 LCS 长度为 0）。

复杂度：时间 O(m×n)，空间 O(m×n)。可优化空间到 O(min(m,n))，但回溯生成 diff 序列仍需 O(m×n) 空间（或牺牲时间换空间）。

### 1.3 回溯生成 diff 操作序列

求出 `dp` 表后，从 `dp[m][n]` 自底向上回溯，生成三种操作：

```typescript
// 伪代码：从 dp[m][n] 回溯到 dp[0][0]
let i = m, j = n;
while (i > 0 || j > 0) {
  if (i > 0 && j > 0 && A[i-1] === B[j-1]) {
    // 两行相同，标记为 equal
    ops.push({ type: 'equal', line: A[i-1] });
    i--; j--;
  } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
    // B 侧多出一行，标记为 insert
    ops.push({ type: 'insert', line: B[j-1] });
    j--;
  } else {
    // A 侧多出一行，标记为 delete
    ops.push({ type: 'delete', line: A[i-1] });
    i--;
  }
}
ops.reverse();
```

回溯时优先匹配 equal，其次 insert，最后 delete。最终得到一个操作序列，如 `[equal, equal, delete, insert, equal, ...]`。

### 1.4 LCS 的性质

LCS 生成的 diff 有几个重要性质：

- <strong>最小化差异</strong>：相同行被最大化保留，差异行最少。这是 LCS 的最优性保证。
- <strong>结果稳定</strong>：相同输入永远得到相同输出，无随机性。
- <strong>非唯一性</strong>：当 `dp[i][j-1] == dp[i-1][j]` 时，选 insert 或 delete 都能得到 LCS 长度相同的解，但 diff 序列不同。不同实现可能产生不同 diff。

## 二、Myers diff：Git 的高效算法

### 2.1 LCS 的性能问题

LCS 的 O(m×n) 复杂度对小文件足够，但对大文件（如 1 万行 vs 1 万行）需要 1 亿次比较，内存 400MB（每个 int 4 字节）。

实际代码修改往往是<strong>局部修改</strong>：差异行数 D 远小于 m+n。能否利用「差异少」这一特点优化？

### 2.2 Myers 算法的核心思想

Myers 在 1986 年提出 <strong>O((m+n)·D) 复杂度</strong>的算法，D 为差异总数。当 D 很小（如改了几行），复杂度接近 O(m+n)，远快于 O(m×n)。

核心思想：把 diff 问题转化为<strong>最短路径问题</strong>。在编辑图（edit graph）上找从 (0,0) 到 (m,n) 的最短路径，每条边代表一种操作：

- 向右走一步：delete 一行
- 向下走一步：insert 一行
- 对角线走一步：equal（仅当两行相同）

Myers 算法用 BFS 逐层扩展，找到最短路径后回溯生成 diff。

### 2.3 为什么 Git 选 Myers

- <strong>差异少时极快</strong>：日常代码改动通常 D << m+n，Myers 远快于 LCS。
- <strong>输出可读</strong>：Myers 倾向于把修改集中到连续块，而非分散到全文，更符合人类阅读习惯。
- <strong>线性空间变种</strong>：Myers 的 Myers 1986 论文同时给出了 O(N) 空间的线性变种（牺牲一些时间），适合大文件。

Git 的 `xdiff` 库就是 Myers 的实现，配 `patience diff` 与 `histogram diff` 作为可选策略。

### 2.4 Myers 的局限

- <strong>差异多时退化</strong>：当 D 接近 m+n（两段文本几乎完全不同），Myers 退化为 O((m+n)²)，反而比 LCS 慢。
- <strong>移动块识别差</strong>：把一段代码从文件开头移到结尾，Myers 会标记为「全删 + 全增」，而非「移动」。这是所有基于行比较的 diff 算法的通病。

## 三、行级 vs 字符级 diff

### 3.1 行级 diff 的局限

行级 diff 把整行视作最小单元，要么相同要么不同。若一行中只改了几个字符，整行仍被标记为「全删 + 全增」。

```
原文:    "version": "1.0.0"
修改后:  "version": "2.0.0"
```

行级 diff 会标记为「删除 `version: 1.0.0` + 新增 `version: 2.0.0`」，无法看出实际只改了 `1` → `2`。

### 3.2 字符级 diff 的实现

对相邻的 delete+insert 块，再做一次 LCS——但这次是以<strong>字符</strong>为单元。这样能精确识别行内修改的位置。

```typescript
// 行级 diff 后，对相邻的 delete+insert 块做字符级 LCS
function charDiff(leftStr: string, rightStr: string): CharPart[] {
  const leftChars = Array.from(leftStr);
  const rightChars = Array.from(rightStr);
  // ... 同样的 LCS 算法，但单元是字符而非行
}
```

字符级 diff 的复杂度是 O(L₁×L₂)，L₁、L₂ 为两行长度。通常每行几十到几百字符，复杂度可控。

<strong>本工具已实现字符级高亮</strong>：对相邻的「删除行 + 新增行」配对后做字符级 LCS，将行内相同字符标为普通色，被删除的字符段标红底，被新增的字符段标绿底，类似 `git diff --word-diff` 的效果。性能保护：单行超过 1000 字符时降级为整行高亮，避免 O(m×n) 卡顿；可用工具栏的「行内高亮」单选组切换为「无」关闭。

### 3.3 词级 diff：折中方案

字符级 diff 有时过于细碎（如把 `1.0.0` 拆成 `1` `.` `0` `.` `0`）。更友好的做法是<strong>词级 diff</strong>：以单词 / 标点为单元。

```
原文:    version: 1.0.0
修改后:  version: 2.0.0
词级:    [equal: version:] [delete: 1] [equal: .0.0] [insert: 2]
```

Git 的 `--word-diff` 选项就是词级 diff。<strong>本工具已实现词级 diff</strong>（工具栏「行内高亮」单选组切换为「词级」），与字符级共用同一套 LCS 算法，仅切分单元不同：

- <strong>字符级</strong>：用 `Array.from(str)` 按码点切分，正确处理 Unicode 代理对（emoji 等）。
- <strong>词级</strong>：用 Unicode 感知正则 `/\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]+/gu` 切分为「空白 / 字母数字 / 标点符号」三类 token。`\p{L}`（字母）与 `\p{N}`（数字）覆盖中文、日文等非 ASCII 字符，避免传统 `\w` 只识别 ASCII 的局限。

性能保护与字符级一致：单行超过 1000 字符时降级为整段高亮。三种模式（无 / 字符级 / 词级）互斥切换，满足不同粒度需求。

## 四、统一 vs 分屏视图的取舍

### 4.1 统一 diff（unified）

格式：单栏显示，每行前加 `+` / `-` / 空格前缀。

```
  # 配置文件
- version: 1.0.0
+ version: 2.0.0
  debug: true
```

优点：

- <strong>紧凑</strong>：单栏显示，纵向占用少。
- <strong>可复制</strong>：纯文本格式，可直接粘贴到 commit message、PR 描述、邮件。
- <strong>标准化</strong>：`patch` / `git apply` 命令能直接消费此格式。

缺点：

- <strong>左右对应差</strong>：删除的行与新增的行不在同一视觉位置，肉眼对比修改位置需要脑补。

### 4.2 分屏对比（split）

格式：左右两栏并排，左侧原文、右侧修改后。

```
原文              | 修改后
# 配置文件        | # 配置文件
version: 1.0.0    | version: 2.0.0    ← 修改
debug: true       | debug: true
```

优点：

- <strong>视觉对应好</strong>：修改位置一目了然，适合人工 review。
- <strong>上下文清晰</strong>：左右对照能看到完整的原文与修改后版本。

缺点：

- <strong>占用横向空间</strong>：宽屏才能并排显示，移动端需要堆叠。
- <strong>不可直接复制</strong>：是渲染后的视图，非纯文本。

GitHub PR 默认用分屏，但提供「Switch to unified view」切换。本工具两种视图都支持，按需切换。

## 五、相似度计算

### 5.1 公式

```
相似度 = 相同行数 / (相同行数 + max(新增行数, 删除行数)) × 100%
```

分母用 `max` 而非 `sum`，是为了避免修改块被双重计数。修改一行既算删除也算新增，用 `sum` 会让相似度偏低。

### 5.2 例子

两段文本各 100 行，其中 80 行相同、10 行被修改（10 删 10 增）、10 行纯新增：

- 相同行数 = 80
- 删除行数 = 10（被修改的旧行）
- 新增行数 = 10 + 10 = 20（被修改的新行 + 纯新增）
- 相似度 = 80 / (80 + max(20, 10)) = 80 / 100 = 80%

### 5.3 应用场景

- <strong>代码重复度检测</strong>：相似度 > 80% 的两段代码可能存在重复，可重构抽取公共函数。
- <strong>文档查重</strong>：相似度 > 50% 的两段文档可能存在抄袭。
- <strong>版本对比</strong>：相似度 > 95% 通常是 minor 修订，< 50% 通常是重写。

注意：相似度只反映<strong>行级</strong>相似度，不能识别语义相似度。两段功能相同但实现不同的代码，相似度可能很低。

## 六、工具矩阵联动

文本对比是「文本处理」主题的核心工具，与多个已有工具形成联动：

### 6.1 与 Markdown 工具联动

[Markdown 预览器](/markdown) 渲染后的 HTML 可复制出来，对比两段 Markdown 渲染结果。也可直接对比两段 Markdown 源码，看修改了哪些段落。

### 6.2 与 JSON / YAML / TOML 工具联动

对比结构化配置文件时，建议先格式化再对比：

- [JSON 工具](/json) 的格式化功能让字段顺序统一
- [YAML 工具](/yaml) 的 YAML → JSON 转换
- [TOML 工具](/toml) 的 TOML → JSON 转换

格式化后字段顺序一致，diff 结果更准确。否则字段顺序不同会导致大量假差异。

### 6.3 与 Base64 / URL 编码工具联动

对比两段编码后的字符串（如两段 Base64、两段 URL 编码）：

- [Base64 工具](/base64) 解码后对比原文
- [URL 工具](/url) 解码后对比

### 6.4 与 Hash 工具联动

[Hash 工具](/hash) 可对两段文本分别计算 SHA-256，快速判断是否完全相同（哈希相同则文本相同）。若哈希不同再用 Diff 工具看具体差异。这是大文件对比的快速预筛步骤。

### 6.5 与 UUID 工具联动

[UUID 工具](/uuid) 生成的版本号、追踪 ID 嵌入到配置文件后，可用 Diff 工具对比配置文件版本变化。

## 七、性能边界与超大文本优化

### 7.1 LCS 的实际性能

本工具的 LCS 实现（Uint32Array 优化）在主流浏览器上的实测性能：

| 文本规模 | 比较次数 | 耗时 | 内存 |
|---------|---------|------|------|
| 100 × 100 行 | 1 万 | < 1ms | 40KB |
| 1000 × 1000 行 | 100 万 | ~10ms | 4MB |
| 5000 × 5000 行 | 2500 万 | ~200ms | 100MB |
| 10000 × 10000 行 | 1 亿 | ~1s | 400MB |

可见 5000 行是 LCS 的实用上限，超过 1 万行会明显卡顿。

### 7.2 超大文本的优化方向

若必须处理超大文本，可考虑：

- <strong>Myers 算法</strong>：差异少时 O((m+n)·D) 远快于 O(m×n)。
- <strong>分块对比</strong>：把文件按空行或函数边界分块，块间先哈希比较（相同则跳过），不同再用 LCS。这是 GitHub 的大型 PR diff 策略。
- <strong>Web Worker</strong>：把计算放到 Worker 线程，避免阻塞 UI。本工具当前主线程计算，5000 行以内无感知延迟。
- <strong>流式 diff</strong>：对超长文件分批读取，逐块 diff。适合日志文件对比。

### 7.3 浏览器内存限制

浏览器对单个 ArrayBuffer / TypedArray 的大小有限制（通常 2GB），但实际可用内存受设备影响。手机端 4GB 设备可能 500MB 就 OOM。本工具用 Uint32Array（4 字节/元素），5000 行 × 5000 行的 dp 表占 100MB，仍在安全范围内。

## 八、工程实践清单

实现一个生产级 diff 工具时，需考虑以下边界：

- <strong>Unicode 处理</strong>：用 `Array.from(str)` 按 Unicode 码点切分，而非 `str.split('')`（后者会把 4 字节 emoji 拆成两个代理对字符）。
- <strong>空行处理</strong>：提供「忽略空行」选项，对比格式不同但内容相同的文本。
- <strong>空白处理</strong>：提供「忽略行首尾空白」选项，对比缩进不一致的代码。
- <strong>大小写处理</strong>：提供「大小写敏感」开关，对比不区分大小写的文本（如某些配置项）。
- <strong>SSR 水合</strong>：React 组件若初始 state 涉及随机数或时间戳，会导致 SSR/CSR 水合不匹配。本工具初始为空，客户端 useEffect 触发示例载入。
- <strong>空状态</strong>：双栏均为空时显示提示，而非空白页面。
- <strong>错误兜底</strong>：极端输入（如 10 万行）应截断或提示，而非让浏览器卡死。

## 九、扩展阅读

- <strong>Myers 1986 原论文</strong>：[An O(ND) Difference Algorithm and Its Variations](https://doi.org/10.1007/BF01840446)，diff 算法的奠基之作。
- <strong>Git diff 文档</strong>：`git help diff`，查看 `--word-diff`、`--stat`、`--patience` 等选项。
- <strong>Google diff-match-patch</strong>：[开源库](https://github.com/google/diff-match-patch)，支持字符级 diff、补丁生成、模糊匹配，多语言实现。
- <strong>Monaco Editor</strong>：VS Code 的编辑器内核，内置 diff 编辑器，支持行内字符级高亮。

理解 diff 算法不仅有助于用好工具，更能帮你写出更易于 review 的代码——比如把一个函数的大规模重构拆成几个小 PR，每个 PR 的 diff 集中且自洽，reviewer 看得轻松，合并冲突也少。
