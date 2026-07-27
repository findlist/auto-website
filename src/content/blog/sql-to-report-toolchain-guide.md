---
title: "SQL 查询到数据报表工具链实战：从查询编写到 Markdown 呈现的端到端工作流"
description: "从开发者真实遇到的「SQL NULL 导出 CSV 后空字段类型漂移、SQL 日期格式与 JSONPath 字符串比较语义错配、CSV 引号包裹字段与 Markdown 管道符转义冲突、SELECT * 列序不稳导致 JSONPath 字段路径失效、JSONPath 数组结果在 GFM 表格中嵌套结构坍塌」场景切入，系统讲解 SQL 编写校验、CSV 转 JSON 归一化、JSON 格式化校验、JSONPath 字段提取、CSV 转 Markdown 报表五道工序的正确顺序与衔接陷阱，覆盖业务数据日报生成、数据库迁移校验、API 响应数据归档、数据质量审计、跨数据源对比报表五大典型场景，给出端到端工作流与工具矩阵协同建议，适用于数据分析师、后端工程师、全栈开发者的数据查询到报表呈现工作流参考。"
pubDate: 2026-07-28
tags: ["SQL 报表工具链", "数据查询", "CSV 转 JSON", "JSONPath", "Markdown 报表", "工具矩阵"]
relatedTool: "/sql"
---

## 为什么"SQL 查询到报表呈现"是独立工作流

把一条 SQL 查询结果，最终变成**可归档的数据日报、可评审的迁移校验报告、可检索的 API 响应存档、可追溯的质量审计报告、可对比的跨数据源报表**——例如业务数据日报生成、数据库迁移校验、API 响应数据归档、数据质量审计、跨数据源对比报表——从查询编写到报表落地，**这不是单个工具能覆盖的事**：知道怎么写 SQL 没用，你需要判断 NULL 在导出 CSV 后变成空字符串还是 `\N`；知道怎么转 JSON 没用，你需要判断日期字段在 JSONPath 比较时是字典序还是时间序；知道怎么写 JSONPath 没用，你需要判断查询返回的数组结果能否在 Markdown 表格单元格内呈现。

> **与已有的单点博客边界划分**：[SQL 格式化与解析器设计](/blog/sql-parser-tokenizer-design) 聚焦 SQL 词法分析与缩进引擎实现，[CSV 与 Markdown 表格互转指南](/blog/csv-markdown-guide) 聚焦 GFM 管道表格语法与状态机解析，[CSV 转 JSON 工具](/csv-json)、[JSON 格式化校验工具](/json)、[JSONPath 查询工具](/jsonpath) 各自的单点教程覆盖工具参数与用法。本博客聚焦"五工具端到端工作流的工序衔接"，回答"先做哪步、后做哪步、工序间有哪些隐性依赖"的工程问题。如果只是单点原理疑惑，参考对应专题博客；如果已经知道每个工具怎么用但不知道落地顺序与衔接陷阱，参考本文。两者互补不冲突。

> **与 CSV ETL 工具链的边界划分**：[CSV 数据 ETL 全链路实战](/blog/csv-etl-toolchain-guide) 聚焦"数据工程师的 ETL 管道"（CSV → JSON → Schema 推断 → TS 类型生成 → Mock 测试，核心是数据契约与类型生成）；本博客聚焦"数据分析师的查询到报表"（SQL 编写 → CSV 导出 → JSON 归一化 → JSONPath 提取 → Markdown 呈现，核心是数据呈现与归档）。两者起点不同、终点不同、核心矛盾不同，互补不冲突。

真实查询到报表场景里最容易踩的三个坑：

1. **SQL NULL 在导出链路中类型漂移**：开发者用 [SQL 格式化工具](/sql) 校验好查询语句，在数据库客户端执行得到 1000 行结果，导出 CSV 后用 [CSV 转 JSON 工具](/csv-json) 转 JSON，发现 `last_login` 字段在 JSON 里时而为 `null`、时而为 `""`、时而被省略——原因是 SQL 的 NULL 在 MySQL 客户端导出为空字符串、在 PostgreSQL COPY 导出为 `\N`、在部分客户端导出为字面量 `NULL`，CSV 转 JSON 时空字符串的归一化策略不同导致下游 JSONPath 查询 `[?(@.last_login)]` 的结果集不一致。**正确做法**是导出 CSV 时统一 NULL 表示为空字符串，CSV 转 JSON 时配置空字符串归一化为 null，保证下游字段集合稳定。
2. **SQL 日期格式与 JSONPath 字符串比较语义错配**：开发者用 [JSONPath 查询工具](/jsonpath) 筛选 `created_at > "2026-07-01"` 的记录，发现 `2026-07-28` 命中但 `2026-7-1` 未命中——原因是 SQL 导出的日期格式不统一（MySQL 默认 `2026-07-28 15:30:00`、PostgreSQL 默认 `2026-07-28T15:30:00Z`、部分客户端导出 `2026/7/1`），JSONPath 的 `>` 运算符是字符串字典序比较，`"2026-7-1"` 的字典序小于 `"2026-07-01"`（因 `'7' > '0'` 但短字符串前缀匹配先失效）。**正确做法**是导出前用 SQL 的 `DATE_FORMAT` 或 `TO_CHAR` 统一为 ISO 8601 格式，保证 JSONPath 字典序与时间序一致。
3. **CSV 引号包裹字段与 Markdown 管道符转义冲突**：开发者用 [CSV 与 Markdown 表格互转工具](/csv-markdown) 把含逗号的 CSV 字段（如 `"北京,上海"`）转为 Markdown 表格，发现表格结构错乱——原因是 CSV 用引号包裹含逗号的字段，但 Markdown 表格用管道符 `|` 分列，若字段内含管道符（如 `"a|b"`）未被转义为 `\|`，管道符被误认为分隔符导致列数错位；而 CSV 的引号包裹规则与 Markdown 的管道符转义规则是两套独立机制，互转时需要先解析 CSV 引号再处理管道符转义。**正确做法**是确认 CSV 字段内是否含管道符，转换前由工具自动转义为 `\|`。

本文不重复单个工具的深度教程（已有 [SQL 解析器设计](/blog/sql-parser-tokenizer-design)、[CSV Markdown 互转指南](/blog/csv-markdown-guide) 等单点博客覆盖原理与算法），而是聚焦**工序衔接与场景决策**——这是单点教程无法回答的问题。

> 配套工具矩阵：[SQL 格式化与压缩工具](/sql) · [CSV 转 JSON 工具](/csv-json) · [JSON 格式化校验工具](/json) · [JSONPath 查询工具](/jsonpath) · [CSV 与 Markdown 表格互转工具](/csv-markdown)

## 五道工序的正确顺序矩阵

### 工序矩阵

| 序号 | 工序 | 工具 | 阶段 | 何时执行 | 不可逆性 |
| --- | --- | --- | --- | --- | --- |
| 1 | SQL 编写与语法校验 | /sql/ | 编写 | 确认查询逻辑后第一步 | 可逆（SQL 文本可反复修改） |
| 2 | CSV 转 JSON 归一化 | /csv-json/ | 归一化 | 查询结果从数据库导出 CSV 后 | 可逆（保留 CSV 原文） |
| 3 | JSON 格式化与校验 | /json/ | 规范化 | 归一化后、字段提取前 | 可逆（JSON 可重新格式化） |
| 4 | JSONPath 字段提取 | /jsonpath/ | 提取 | 规范化后、报表呈现前 | 可逆（查询不改原数据） |
| 5 | CSV 转 Markdown 报表 | /csv-markdown/ | 呈现 | 最后一步 | 半不可逆（报表用于归档分发） |

### 为什么是这个顺序：核心依赖关系

正确顺序的依据是**数据契约稳定性**与**呈现准确性**：

- **SQL 编写在最前**：SQL 是数据源的"查询契约"，查询逻辑决定了后续所有工序的数据范围与字段集合。先用 [SQL 格式化工具](/sql) 校验语法、规范关键字大小写、确认 SELECT 列表，再去数据库执行导出，避免导出后发现字段缺失或条件错误导致全链路返工。**先定查询契约再取数据**。
- **CSV 转 JSON 在格式化前**：CSV 是半结构化数据（无类型、字段靠位置），JSON 是结构化数据（有类型、字段靠名称）。先用 [CSV 转 JSON 工具](/csv-json) 把无类型数据归一化为有类型数据，下游工序才有稳定的字段路径可依。**先归一化再规范化**。
- **JSON 格式化在 JSONPath 前**：JSONPath 查询依赖 JSON 结构合法。若 CSV 转 JSON 后存在语法错误（如多余逗号、未闭合括号），JSONPath 查询会直接报错。先用 [JSON 格式化校验工具](/json) 校验语法、格式化缩进，确认结构合法后再提取字段。**先校验合法性再查询提取**。
- **JSONPath 提取在 Markdown 呈现前**：报表只需呈现目标字段而非全量数据。先用 [JSONPath 查询工具](/jsonpath) 提取所需字段（如 `$[*].{id,name,created_at}`），确认提取结果的数据类型与结构，再决定 Markdown 表格的列定义。**先确定数据再呈现**。
- **CSV 转 Markdown 在最后**：Markdown 报表是最终交付物，用于归档、评审、分发。呈现前所有工序必须完成，否则报表内容不准确。**最后一步定型交付物**。

### 顺序的反模式

最常见的反模式是**跳过 JSON 格式化直接写 JSONPath**：CSV 转 JSON 后立即写 JSONPath 查询，结果发现 CSV 中某行有多余逗号导致 JSON 语法错误，JSONPath 查询报"unexpected token"，开发者以为是 JSONPath 语法写错改了半天，最后发现是 JSON 本身不合法。**正确做法**：CSV 转 JSON 后先用 [JSON 校验工具](/json) 校验语法，确认无错后再写 JSONPath 查询。

另一个反模式是**跳过 JSONPath 提取直接转 Markdown**：开发者把全量 CSV 直接转 Markdown 表格，报表列数过多（20+ 列）导致表格在 GitHub README 中横向滚动难以阅读，且含敏感字段（如用户邮箱）泄露到归档文档。**正确做法**：先用 JSONPath 提取报表所需字段（如 `$[*].{id,name,status}`），将提取结果导出为精简 CSV，再转 Markdown 表格，保证报表只含必要字段。

## 五大协同陷阱深度剖析

### 陷阱 1：SQL NULL 到 CSV 空字段到 JSON null 的类型漂移

**错误流程**：SQL 查询含 NULL → 数据库客户端导出 CSV → CSV 转 JSON → JSONPath 查询 `[?(@.field)]` 过滤非空字段 → 结果集与预期不符

**问题**：SQL 的 NULL 在不同数据库客户端的 CSV 导出中表示不一致：

| 数据库 / 客户端 | NULL 在 CSV 中的表示 | CSV 转 JSON 后 |
| --- | --- | --- |
| MySQL 命令行 `SELECT INTO OUTFILE` | `\N` | 字符串 `"\N"` |
| MySQL Workbench 导出 | 空字符串 | 空字符串 `""` 或 `null`（取决于工具配置） |
| PostgreSQL COPY | 空字符串 | 空字符串 `""` |
| psql `\copy` | 空字符串 | 空字符串 `""` |
| DBeaver 通用导出 | 字面量 `NULL` | 字符串 `"NULL"` |

CSV 转 JSON 时空字符串的归一化策略不同：有的工具转为 `null`、有的转为 `""`、有的直接省略字段。下游 JSONPath 查询 `[?(@.field)]`（过滤字段存在且非空）在 `null`、`""`、字段缺失三种情况下的行为各不相同，导致结果集不稳定。

**正确流程**：导出 CSV 前在 SQL 中用 `COALESCE(field, '')` 将 NULL 统一为空字符串，或在 SQL 中用 `CASE WHEN field IS NULL THEN 'N/A' ELSE field END` 显式标记缺失值；CSV 转 JSON 时配置空字符串归一化为 `null`；JSONPath 查询用 `[?(@.field != null)]` 显式过滤 null 值。

**实践建议**：NULL 的类型漂移是查询到报表链路中最隐蔽的陷阱。**在 SQL 源头统一 NULL 表示**比在下游工序修补更可靠，因为 CSV 与 JSON 对空值的处理策略分散在多个工具中，逐个配置易遗漏。

### 陷阱 2：SQL 日期格式与 JSONPath 字符串比较的语义错配

**错误流程**：SQL 查询 `created_at` 字段 → 导出 CSV → 转 JSON → JSONPath 查询 `[?(@.created_at > "2026-07-01")]` → 部分日期格式的记录未被正确筛选

**问题**：SQL 导出的日期时间格式不统一：

| 数据库 | 默认日期格式 | 示例 |
| --- | --- | --- |
| MySQL DATETIME | `YYYY-MM-DD HH:MM:SS` | `2026-07-28 15:30:00` |
| PostgreSQL TIMESTAMP | `YYYY-MM-DDTHH:MM:SSZ` | `2026-07-28T15:30:00Z` |
| SQLite TEXT | `YYYY-MM-DD HH:MM:SS` | `2026-07-28 15:30:00` |
| Oracle DATE | `DD-MON-YY` | `28-JUL-26` |

JSON 中日期是字符串类型，JSONPath 的 `>`、`<` 运算符是**字符串字典序比较**而非时间序比较。字典序与时间序一致的前提是日期格式严格遵循 ISO 8601（`YYYY-MM-DDTHH:MM:SSZ`，固定位数、零填充、时区标识）。若格式为 `2026-7-1`（无零填充）或 `28-JUL-26`（非 ISO 8601），字典序与时间序错配：

- `"2026-7-1"` 的字典序小于 `"2026-07-01"`（因 `'7'` 与 `'0'` 比较时 `'7' > '0'`，但前缀 `"2026-"` 后第 5 位 `'7'` vs `'0'`，`'7' > '0'` 故 `"2026-7-1" > "2026-07-01"` 字典序成立，但实际时间 `2026-7-1` 早于 `2026-07-01` 是同一天——这里格式不一致导致比较无意义）
- `"28-JUL-26"` 的字典序以 `2` 开头，与 `"2026-07-01"` 比较时 `'2'` vs `'2'` 相同，但第 2 位 `'8'` vs `'0'`，`'8' > '0'` 故 `"28-JUL-26" > "2026-07-01"` 字典序成立，但实际时间 `28-JUL-26` 是 2026 年 7 月 28 日，晚于 `2026-07-01`，巧合一致；但 `"01-AUG-26"` 与 `"2026-07-01"` 比较则字典序 `'0'` vs `'2'`，`'0' < '2'`，判为小于，实际时间 8 月 1 日晚于 7 月 1 日，方向相反

**正确流程**：导出 CSV 前在 SQL 中用 `DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%sZ')`（MySQL）或 `TO_CHAR(created_at, 'YYYY-MM-DDTHH:MI:SSZ')`（PostgreSQL）统一为 ISO 8601 格式；JSONPath 查询用 `[?(@.created_at >= "2026-07-01T00:00:00Z")]` 保证字典序与时间序一致。

**实践建议**：**在 SQL 源头统一日期格式**是根治之道。若 CSV 已导出且格式不统一，可在 CSV 转 JSON 后用 JSONPath 的 `@.created_at.match` 正则匹配做格式归一化，但远不如 SQL 层面 `DATE_FORMAT` 简洁可靠。

### 陷阱 3：CSV 引号包裹字段与 Markdown 管道符转义冲突

**错误流程**：CSV 字段含逗号被引号包裹 → CSV 转 Markdown 表格 → 表格列数错乱

**问题**：CSV 与 Markdown 表格的分隔机制不同：

| 格式 | 分隔符 | 字段内分隔符处理 |
| --- | --- | --- |
| CSV | 逗号（或分号、Tab） | 引号包裹字段 + 引号内逗号转义 |
| GFM Markdown 表格 | 管道符 `\|` | 管道符转义为 `\|` |

两种机制独立运作，但转换时存在衔接陷阱：

1. **CSV 字段含逗号**：CSV 用引号包裹（如 `"北京,上海"`），转 Markdown 表格时引号被剥离，逗号保留在单元格内，Markdown 表格能正确识别（因 Markdown 用管道符分列，逗号不是分隔符）。此场景通常无问题。
2. **CSV 字段含管道符**：CSV 中管道符无需引号包裹（如 `a|b`），转 Markdown 表格时管道符被误认为分隔符，单元格被拆成两列，表格列数错乱。
3. **CSV 字段含引号**：CSV 用双引号转义引号（如 `"他说""你好"""`），转 Markdown 表格时引号转义规则与 Markdown 不兼容，可能保留多余引号或丢失内容。
4. **CSV 字段含换行符**：CSV 用引号包裹多行字段（如 `"第一行\n第二行"`），GFM 表格不支持单元格内换行，转换后换行符破坏表格结构。

**正确流程**：用 [CSV 与 Markdown 表格互转工具](/csv-markdown) 转换前，先确认 CSV 字段内是否含管道符或换行符；工具应自动将管道符转义为 `\|`，将换行符替换为 `<br>` 或空格；含引号的字段按 RFC 4180 规范解析后再转义。

**实践建议**：若 CSV 字段内含管道符且无法避免，**优先在 SQL 源头用 `REPLACE(field, '|', '/')` 替换管道符**，避免下游转义遗漏。GFM 表格的单元格内换行支持有限，报表场景建议用 `<br>` 标签或拆分为多行记录。

### 陷阱 4：SELECT * 列序不稳与 JSONPath 字段路径失效

**错误流程**：SQL 用 `SELECT *` 查询 → 导出 CSV → 转 JSON（数组形式）→ JSONPath 查询 `$[0].field` → 表结构变更后字段路径错位

**问题**：`SELECT *` 的列序依赖表定义，表结构变更（加列、删列、调序）后 CSV 列序变化。CSV 转 JSON 有两种模式：

| JSON 模式 | 结构 | 字段路径 | 列序敏感性 |
| --- | --- | --- | --- |
| 对象数组 | `[{\"id\":1,\"name\":\"张三\"}]` | `$.field`（按字段名） | 不敏感（字段名稳定即可） |
| 二维数组 | `[[1,\"张三\"]]` | `$[0][1]`（按位置索引） | 敏感（列序变化即错位） |

若 CSV 转 JSON 时用二维数组模式（无表头映射），JSONPath 查询 `$[0][2]` 取第 3 列，表结构变更后第 3 列可能从 `name` 变为 `email`，查询结果语义错位但不会报错，隐蔽性极高。

**正确流程**：SQL 查询时**显式列出字段名**（`SELECT id, name, created_at FROM users`）而非 `SELECT *`；CSV 转 JSON 时用对象数组模式（第一行作为表头映射为字段名）；JSONPath 查询用字段名路径（`$[*].name`）而非位置索引（`$[*][1]`）。

**实践建议**：`SELECT *` 在报表场景是反模式——它把列序的决定权交给了表定义，而表结构变更是 DBA 的常规操作。**显式字段列表**既是 SQL 最佳实践，也是下游 JSONPath 查询稳定性的保障。若必须用 `SELECT *`，导出 CSV 时务必包含表头行，CSV 转 JSON 时启用表头映射为字段名。

### 陷阱 5：JSONPath 数组结果与 GFM 表格嵌套结构坍塌

**错误流程**：JSONPath 查询 `$..tags` 返回数组 → 将结果转 CSV → CSV 转 Markdown 表格 → 嵌套数组在表格中坍塌为散乱文本

**问题**：JSONPath 查询可能返回嵌套结构：

| JSONPath 查询 | 返回结构 | GFM 表格支持 |
| --- | --- | --- |
| `$[*].id` | `[1, 2, 3]`（标量数组） | 支持（每行一个 ID） |
| `$[*].tags` | `[["a","b"], ["c"]]`（嵌套数组） | 不支持（单元格内无法嵌套数组） |
| `$[*].{id,tags}` | `[{id:1,tags:["a","b"]}]`（对象数组） | 部分支持（tags 字段需扁平化） |

GFM 表格的单元格只支持纯文本，嵌套数组或对象在转换时会坍塌为 `[object Object]` 或 `a,b` 的散乱文本，丢失结构信息。

**正确流程**：JSONPath 查询后先将嵌套结构扁平化——用 `$[*].tags[*]` 展开嵌套数组为一维数组，或用 `$.result[*].join(tags, ",")` 将数组拼接为字符串；将扁平化后的结果导出为 CSV，再转 Markdown 表格。

**实践建议**：报表场景的 Markdown 表格适合呈现**扁平的标量数据**（如 `id, name, status`）。若需呈现嵌套结构（如一对多关系），建议拆分为多张表：主表呈现 `id, name`，子表呈现 `id, tag`，通过 `id` 关联。JSONPath 的 `*` 递归展开与 `join()` 聚合是扁平化的核心手段。

## 五大典型场景剖析

### 场景 1：业务数据日报生成（SQL 查询 → CSV → JSON → JSONPath 提取 → Markdown 日报）

**场景**：运营团队需要每日生成一份"新增用户日报"，包含用户 ID、注册时间、来源渠道、状态，归档到团队 Wiki（Markdown 格式）。

**工序流程**：
```text
1. [SQL 格式化工具] /sql/
   ├─ 编写查询：SELECT id, created_at, source, status FROM users WHERE created_at >= CURDATE() - INTERVAL 1 DAY
   ├─ 格式化校验关键字大小写、WHERE 条件、日期函数
   └─ 输出：格式化后的 SQL 语句
2. 数据库客户端执行 SQL，导出查询结果为 CSV（含表头）
3. [CSV 转 JSON 工具] /csv-json/
   ├─ CSV 转 JSON（对象数组模式，表头映射字段名）
   ├─ 空字符串归一化为 null
   └─ 输出：JSON 数组
4. [JSON 格式化校验工具] /json/
   ├─ 校验 JSON 语法合法性
   ├─ 格式化缩进便于检查
   └─ 输出：合法的格式化 JSON
5. [JSONPath 查询工具] /jsonpath/
   ├─ 提取报表字段：$[*].{id, created_at, source, status}
   ├─ 筛选有效记录：[?(@.status == "active")]
   └─ 输出：精简的 JSON 数组
6. 将 JSONPath 结果导出为精简 CSV
7. [CSV 与 Markdown 表格互转工具] /csv-markdown/
   ├─ CSV 转 Markdown 表格（左对齐）
   ├─ 管道符自动转义
   └─ 输出：GFM 表格，粘贴到 Wiki
```

**关键细节**：日报场景的核心是**字段精简与格式统一**。SQL 层面用 `DATE_FORMAT(created_at, '%Y-%m-%d %H:%i')` 统一日期格式，JSONPath 层面用 `[?(@.status == "active")]` 过滤有效记录，Markdown 层面用左对齐保证长文本可读。

### 场景 2：数据库迁移校验（SQL 查询源库与目标库 → CSV → JSON → JSONPath 比对 → Markdown 差异报告）

**场景**：数据库从 MySQL 迁移到 PostgreSQL 后，需要校验同一查询在两个库的结果是否一致，生成差异报告。

**工序流程**：
```text
1. [SQL 格式化工具] /sql/
   ├─ 编写查询：SELECT id, name, created_at FROM users ORDER BY id LIMIT 1000
   ├─ 格式化校验（确保两库执行相同 SQL）
   └─ 输出：统一的 SQL 语句
2. 分别在 MySQL 与 PostgreSQL 执行，导出两份 CSV
3. [CSV 转 JSON 工具] /csv-json/
   ├─ 两份 CSV 分别转 JSON（对象数组模式）
   ├─ 注意 MySQL 的 \N 与 PostgreSQL 的空字符串统一为 null
   └─ 输出：两份 JSON 数组
4. [JSON 格式化校验工具] /json/
   ├─ 分别校验两份 JSON 语法
   └─ 输出：合法的 JSON
5. [JSONPath 查询工具] /jsonpath/
   ├─ 提取源库 ID 列表：$[*].id
   ├─ 提取目标库 ID 列表：$[*].id
   ├─ 比对差异（缺失 ID、新增 ID）
   └─ 输出：差异列表
6. 将差异列表导出为 CSV
7. [CSV 与 Markdown 表格互转工具] /csv-markdown/
   └─ CSV 转 Markdown 差异报告表格
```

**关键细节**：迁移校验的核心是**两库数据类型对齐**。MySQL 的 `DATETIME` 与 PostgreSQL 的 `TIMESTAMP` 导出格式不同，必须在 SQL 层面用 `DATE_FORMAT` 与 `TO_CHAR` 统一为 ISO 8601，否则 JSONPath 比对时因日期格式差异误判为不一致。

### 场景 3：API 响应数据归档（SQL 查询 → CSV → JSON → JSONPath 提取关键字段 → Markdown 存档）

**场景**：第三方 API 返回的 JSON 响应需要归档为可检索的 Markdown 文档，便于后续排查接口异常。

**工序流程**：
```text
1. [SQL 格式化工具] /sql/
   ├─ 编写查询：SELECT request_id, response_body, created_at FROM api_logs WHERE api_name = 'payment' AND status != 200
   ├─ 格式化校验
   └─ 输出：SQL 语句
2. 数据库执行，导出 CSV
3. [CSV 转 JSON 工具] /csv-json/
   ├─ CSV 转 JSON（response_body 字段是 JSON 字符串）
   └─ 输出：JSON 数组（含嵌套 JSON 字符串）
4. [JSON 格式化校验工具] /json/
   ├─ 校验外层 JSON 语法
   ├─ 格式化 response_body 嵌套 JSON
   └─ 输出：双层合法 JSON
5. [JSONPath 查询工具] /jsonpath/
   ├─ 提取关键字段：$[*].{request_id, response_body.error_code, response_body.message, created_at}
   ├─ 用 $..error_code 递归提取错误码
   └─ 输出：扁平化的异常记录
6. 导出为 CSV
7. [CSV 与 Markdown 表格互转工具] /csv-markdown/
   └─ CSV 转 Markdown 异常归档表
```

**关键细节**：API 响应归档的核心是**嵌套 JSON 的扁平化**。`response_body` 是 JSON 字符串，CSV 转 JSON 后成为嵌套对象，JSONPath 用 `$..error_code` 递归提取嵌套字段，避免在 Markdown 表格中呈现原始 JSON 字符串。

### 场景 4：数据质量审计（SQL 查询 → CSV → JSON → JSONPath 检测异常 → Markdown 审计报告）

**场景**：数据团队需要审计用户表的字段完整性，检测空值率、格式异常率、枚举值合法性，生成质量审计报告。

**工序流程**：
```text
1. [SQL 格式化工具] /sql/
   ├─ 编写查询：SELECT id, email, phone, created_at, status FROM users
   ├─ 格式化校验
   └─ 输出：SQL 语句
2. 数据库执行，导出全量 CSV
3. [CSV 转 JSON 工具] /csv-json/
   ├─ CSV 转 JSON（对象数组模式）
   └─ 输出：JSON 数组
4. [JSON 格式化校验工具] /json/
   ├─ 校验语法
   └─ 输出：合法 JSON
5. [JSONPath 查询工具] /jsonpath/
   ├─ 空值检测：$[?(@.email == null)]
   ├─ 格式检测：$[?(@.email && !@.email.match(/^[^@]+@[^@]+$/))]
   ├─ 枚举检测：$[?(@.status != "active" && @.status != "inactive" && @.status != "banned")]
   └─ 输出：异常记录列表
6. 汇总异常数据为 CSV
7. [CSV 与 Markdown 表格互转工具] /csv-markdown/
   └─ CSV 转 Markdown 审计报告（含异常类型、记录数、示例）
```

**关键细节**：质量审计的核心是**JSONPath 的过滤表达式**。`[?(@.email && !@.email.match(/.../))]` 先判断字段存在再校验格式，避免 null 字段触发正则报错。审计报告按异常类型分表呈现，每表含"异常类型、记录数、占比、示例 ID"四列。

### 场景 5：跨数据源对比报表（SQL 查询两库 → CSV → JSON → JSONPath 对齐 → Markdown 对比表）

**场景**：同一业务在两个数据库（如主库与从库、线上库与备份库）的数据需要对比，生成差异报表。

**工序流程**：
```text
1. [SQL 格式化工具] /sql/
   ├─ 编写查询：SELECT id, balance, updated_at FROM accounts ORDER BY id
   ├─ 格式化校验（确保两库执行相同 SQL）
   └─ 输出：SQL 语句
2. 分别在两库执行，导出两份 CSV
3. [CSV 转 JSON 工具] /csv-json/
   ├─ 两份 CSV 分别转 JSON
   └─ 输出：两份 JSON 数组
4. [JSON 格式化校验工具] /json/
   ├─ 分别校验语法
   └─ 输出：合法 JSON
5. [JSONPath 查询工具] /jsonpath/
   ├─ 提取主库：$[*].{id, balance}
   ├─ 提取从库：$[*].{id, balance}
   ├─ 按 id 对齐，比对 balance 差异
   └─ 输出：差异记录（id、主库 balance、从库 balance、差异值）
6. 导出差异 CSV
7. [CSV 与 Markdown 表格互转工具] /csv-markdown/
   └─ CSV 转 Markdown 对比表（id | 主库 | 从库 | 差异）
```

**关键细节**：跨数据源对比的核心是**字段对齐与类型一致**。两库的 `balance` 字段精度可能不同（MySQL DECIMAL(10,2) 与 PostgreSQL NUMERIC(10,2)），JSONPath 比对时浮点数精度差异可能误判，建议在 SQL 层面用 `CAST(balance AS DECIMAL(10,2))` 统一精度。

## 端到端工作流总结

把一条 SQL 查询结果变成可归档的数据报表，五道工序的协同原则是：**SQL 源头统一数据类型与格式 → CSV 转 JSON 归一化为结构化数据 → JSON 校验保证结构合法 → JSONPath 提取目标字段 → CSV 转 Markdown 呈现报表**。

按本文的工序顺序与协同原则设计查询到报表工作流，可避开 NULL 类型漂移、日期格式与字符串比较错配、CSV 引号与管道符转义冲突、SELECT * 列序不稳、JSONPath 数组结果与表格结构坍塌五个高频陷阱。配套工具矩阵已覆盖全链路，开发者可在浏览器本地完成全部工序，数据不离开设备。

> **工具矩阵速查**：[SQL 格式化与压缩工具](/sql)（编写校验） · [CSV 转 JSON 工具](/csv-json)（归一化） · [JSON 格式化校验工具](/json)（规范化） · [JSONPath 查询工具](/jsonpath)（提取） · [CSV 与 Markdown 表格互转工具](/csv-markdown)（呈现）
