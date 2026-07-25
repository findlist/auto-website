---
title: "CSV 数据 ETL 全链路实战：从格式归一化到类型生成与 Mock 测试的端到端工作流"
description: "从数据工程师的真实 ETL 场景切入，系统讲解 CSV 转 JSON、JSON Schema 推断与校验、JSONPath 查询提取、TypeScript 类型生成、Mock 数据测试五个工序的正确顺序与衔接陷阱（先转换还是先校验、Schema 漂移导致校验失效、JSONPath 查询在嵌套层级变化时失效、TS 类型与 Schema 的 nullable 不一致、Mock 数据不符合 Schema 约束），覆盖日志分析、配置导入、API 数据迁移、报表生成、测试数据准备、多源数据合并六大典型场景，给出端到端 ETL 工作流与工具矩阵协同建议，适用于数据工程师、后端工程师、全栈开发者的 CSV 数据管道设计参考。"
pubDate: 2026-07-25
tags: ["CSV ETL", "数据管道", "JSON Schema", "JSONPath", "TypeScript 类型生成", "Mock 数据", "工具矩阵"]
relatedTool: "/csv-json"
---

## 为什么"CSV ETL 全链路"是真实工程痛点

把一份业务方交付的 CSV 文件，最终变成前端可消费的 TypeScript 类型、后端可校验的数据契约、测试可复现的 Mock 数据——这是数据工程师、后端工程师、全栈开发者每周都会遇到的场景。**单点工具不足以覆盖全链路**：知道 CSV 怎么解析没用，你需要判断字段类型是字符串还是数字、空值怎么处理、嵌套结构怎么表达；知道 JSON Schema 怎么写没用，你需要确认 Schema 是从样本推断还是手工设计、推断出的 Schema 能否校验后续新数据。

真实 ETL 场景里最容易踩的三个坑：

1. **工序顺序错了导致返工**：先把 CSV 转 JSON 再去写 Schema，发现样本数据有脏值（数字字段里混了字符串），Schema 推断出错误类型，下游所有校验都失效。
2. **类型契约不一致**：后端用 JSON Schema 校验数据允许字段为 null，前端用 JSON 转 TypeScript 生成的类型却把字段标为必填，运行时前端崩溃。
3. **Mock 数据不真实**：测试时用 lorem 生成随机字符串，但 Schema 要求字段是 ISO 8601 日期格式或枚举值，Mock 数据无法通过校验，测试管道直接挂掉。

本文不重复单个工具的深度教程（已有 5 篇单点博客覆盖 CSV/JSON 互转、JSON Schema 校验、JSONPath 语法、JSON 转 TS 接口、占位 Mock 数据），而是聚焦**工序衔接与 ETL 场景决策**——这是单点教程无法回答的问题。

> 配套工具矩阵：[CSV 转 JSON 工具](/csv-json) · [JSON Schema 生成工具](/json-schema) · [JSONPath 查询工具](/jsonpath) · [JSON 转 TypeScript 类型工具](/json-to-ts) · [假数据生成工具](/lorem)

## 五个工序的正确 ETL 顺序

### 工序矩阵

| 序号 | 工序 | 工具 | ETL 阶段 | 何时执行 | 不可逆性 |
| --- | --- | --- | --- | --- | --- |
| 1 | CSV → JSON 归一化 | /csv-json/ | Extract | 接入原始数据后第一步 | 可逆（保留 CSV 原文） |
| 2 | JSON → Schema 推断 | /json-schema/ | Transform | 归一化后、校验前 | 可逆（Schema 可重新生成） |
| 3 | Schema 校验新数据 | /json-schema/ | Transform | 推断 Schema 后、查询前 | 可逆（拒绝的数据可修复） |
| 4 | JSONPath 查询提取 | /jsonpath/ | Transform | 校验通过后、类型生成前 | 可逆（查询不改原数据） |
| 5 | JSON → TS 类型生成 | /json-to-ts/ | Load | 查询完成后、Mock 测试前 | 半不可逆（TS 类型供前端使用） |
| 6 | Mock 数据生成测试 | /lorem/ | Load | 类型生成后 | 可逆（Mock 数据可重新生成） |

### 为什么是这个顺序：核心依赖关系

正确顺序的依据是**契约稳定性**与**下游消费可靠性**：

- **CSV → JSON 在最前**：CSV 是半结构化数据（无类型、字段靠位置），JSON 是结构化数据（有类型、字段靠名称）。**先把无类型数据归一化为有类型数据，下游工序才有契约可依**。
- **Schema 推断在 Schema 校验前**：Schema 是数据契约，必须先从样本推断出契约，才能用契约校验后续数据。**先有契约再用契约**。
- **Schema 校验在 JSONPath 查询前**：JSONPath 查询依赖稳定的字段路径，脏数据可能导致字段缺失或类型错位，查询结果不可靠。**先校验数据合规再查询**。
- **JSONPath 查询在 TS 类型生成前**：TS 类型应反映最终消费的数据结构，而非原始 CSV 全量字段。**先查询出消费所需字段，再生成对应的 TS 类型**。
- **TS 类型生成在 Mock 测试前**：Mock 数据应符合 TS 类型约束，否则测试无法通过类型检查。**先有类型再用类型约束 Mock**。
- **Mock 测试在最后**：Mock 数据用于验证 ETL 管道的端到端正确性，是"测试用例"而非"生产数据"。**最后用 Mock 跑通管道，确认契约一致性**。

### ETL 顺序的反模式

最常见的反模式是**跳过 Schema 直接生成 TS 类型**：CSV 转 JSON 后立即生成 TypeScript 接口，结果发现样本数据里某字段有空值，TS 类型生成器把它推断为 `string` 而非 `string | null`，前端使用时遇到 null 直接崩溃。**正确做法**：先推断 JSON Schema 确认 nullable 字段，再用 Schema 约束 TS 类型生成。

另一个反模式是**Mock 数据先于 Schema 生成**：测试人员用 lorem 生成随机字符串填入 CSV，跑 ETL 管道时才发现日期字段格式不对、枚举字段值不在白名单内，测试管道直接挂掉。**正确做法**：先有 JSON Schema，再用 Schema 约束 Mock 数据生成器，确保 Mock 数据符合契约。

## 六大典型 ETL 场景剖析

### 场景 1：日志分析 ETL（CSV 日志 → JSON → JSONPath 聚合 → TS 类型前端展示）

**现象**：业务方交付 Nginx 访问日志（CSV 格式），需要做错误率统计、慢请求分析、TOP URL 排行，最终在前端仪表盘展示。

**错误 ETL 路径**（典型反模式）：
```
CSV 日志 → 直接用 Python pandas 读 → 写 SQL 入库 → 前端用 any 类型接收
  ↓ 问题：CSV 字段顺序与数据库列对应错位，前端 any 类型无类型保护
```

**正确 ETL 路径**：
```
1. [CSV 转 JSON 工具] /csv-json/
   ├─ 输入 CSV 日志（含字段名行）
   ├─ 配置：第一行作为字段名、字符串去引号、空字符串转 null
   └─ 输出：JSON 数组，每条日志一个对象
2. [JSON Schema 生成工具] /json-schema/
   ├─ 输入前 1000 条 JSON 样本
   ├─ 推断字段类型：status 是 integer、timestamp 是 string、bytes 是 integer
   ├─ 标记 nullable 字段：referer 可能为 null
   └─ 输出：JSON Schema draft-07
3. [JSON Schema 校验工具] /json-schema/
   ├─ 用 Schema 校验剩余 N 条日志
   ├─ 拒绝脏数据（如 status 为 "200" 字符串）
   └─ 输出：合规数据集 + 脏数据列表
4. [JSONPath 查询工具] /jsonpath/
   ├─ 查询错误请求：$[?(@.status >= 400)]
   ├─ 查询慢请求：$[?(@.duration > 1000)]
   └─ 提取 TOP URL：$[*].url 去重排序
5. [JSON 转 TypeScript 类型工具] /json-to-ts/
   ├─ 输入查询结果 JSON 样本
   ├─ 生成 interface LogEntry { status: number; url: string; ... }
   └─ 前端使用类型安全消费数据
6. [假数据生成工具] /lorem/
   ├─ 生成 100 条符合 Schema 的 Mock 日志
   └─ 测试仪表盘渲染性能与边界情况
```

**关键细节**：CSV 转 JSON 时务必配置"空字符串转 null"，否则空字段会变成 `""` 字符串，Schema 推断时会被识别为 string 而非 nullable，下游 TS 类型生成会丢失可选标记。

### 场景 2：配置导入 ETL（CSV 配置 → JSON → Schema 校验 → 类型化配置对象）

**现象**：运营交付一份功能配置表（CSV），含 feature_flag、threshold、enabled 等字段，需要导入到后端配置中心，前端也要消费同一份配置。

**错误 ETL 路径**：
```
CSV 配置 → 直接转 JSON → 后端用 Object 接收 → 前端 fetch 后 any 类型
  ↓ 问题：threshold 应为 number 但 CSV 里是 "100" 字符串，后端比较 threshold > 50 失败
```

**正确 ETL 路径**：
```
1. [CSV 转 JSON 工具] /csv-json/
   ├─ 配置：数字字段自动转 number、布尔字段自动转 boolean
   └─ 输出：JSON 配置数组
2. [JSON Schema 生成工具] /json-schema/
   ├─ 推断 Schema：threshold 是 integer、enabled 是 boolean
   ├─ 添加约束：threshold minimum=0 maximum=10000
   └─ 输出：JSON Schema 配置契约
3. [JSON Schema 校验工具] /json-schema/
   ├─ 校验导入数据，拒绝 threshold="high" 的脏配置
   └─ 输出：合规配置
4. [JSON 转 TypeScript 类型工具] /json-to-ts/
   ├─ 生成 interface FeatureConfig { threshold: number; enabled: boolean; ... }
   ├─ 前端共享类型定义
   └─ 编译期发现字段名错误
5. [假数据生成工具] /lorem/
   ├─ 生成 Mock 配置测试默认值与边界
   └─ 验证 threshold=0 / threshold=10000 的渲染表现
```

**关键细节**：CSV 的布尔字段可能是 "true"/"false" 字符串，也可能是 "1"/"0" 或 "yes"/"no"。CSV 转 JSON 时需配置布尔识别规则，否则 Schema 推断会把它当字符串。

### 场景 3：API 数据迁移 ETL（CSV → JSON → Schema → Mock 测试迁移后 API）

**现象**：把旧系统的 CSV 数据导出，迁移到新系统的 RESTful API。需要先验证新 API 能正确接收并存储数据，再执行真实迁移。

**错误 ETL 路径**：
```
CSV → JSON → 直接 POST 到新 API → 部分数据 422 失败 → 回滚
  ↓ 问题：未先用 Mock 数据测试 API 的校验规则，真实数据格式不符合 API 契约
```

**正确 ETL 路径**：
```
1. [CSV 转 JSON 工具] /csv-json/
   └─ 输出：JSON 数据集
2. [JSON Schema 生成工具] /json-schema/
   ├─ 从样本推断 Schema
   └─ 输出：JSON Schema
3. [假数据生成工具] /lorem/
   ├─ 基于 Schema 生成 50 条 Mock 数据
   ├─ POST 到新 API 测试
   └─ 确认 API 接受的数据格式与 Schema 一致
4. [JSON Schema 校验工具] /json-schema/
   ├─ 用 API 返回的 Schema（OpenAPI 内嵌）校验 CSV 转换的 JSON
   ├─ 拒绝不合规数据
   └─ 输出：合规数据集
5. [JSONPath 查询工具] /jsonpath/
   ├─ 分批查询：$[0:100] 取前 100 条
   └─ 分批迁移避免单次请求过大
6. [JSON 转 TypeScript 类型工具] /json-to-ts/
   └─ 生成迁移脚本用的类型定义
```

**关键细节**：API 的契约（OpenAPI / Swagger）通常是 JSON Schema 的超集，但可能有额外约束（如字段长度上限、枚举值白名单）。直接用本地推断的 Schema 校验可能放行 API 会拒绝的数据，**应以 API 文档的 Schema 为准**。

### 场景 4：报表生成 ETL（CSV → JSON → JSONPath 聚合 → TS 类型展示）

**现象**：把销售数据 CSV 转为 JSON，按地区、品类聚合后生成报表，前端用图表库展示。

**错误 ETL 路径**：
```
CSV → SQL 入库 → GROUP BY 聚合 → 前端 SQL 查询结果 any 类型展示
  ↓ 问题：前端 any 类型无法捕获字段名错误，图表渲染时才发现数据为 undefined
```

**正确 ETL 路径**：
```
1. [CSV 转 JSON 工具] /csv-json/
   └─ 输出：销售记录 JSON 数组
2. [JSON Schema 生成工具] /json-schema/
   ├─ 推断 Schema：amount 是 number、region 是 string、category 是 string
   └─ 输出：JSON Schema
3. [JSONPath 查询工具] /jsonpath/
   ├─ 按地区聚合：$[?(@.region=='华东')].amount 求和
   ├─ 按品类聚合：$[?(@.category=='电子')].amount 求和
   └─ 输出：聚合结果 JSON
4. [JSON 转 TypeScript 类型工具] /json-to-ts/
   ├─ 生成 interface RegionalReport { region: string; totalAmount: number; ... }
   └─ 前端类型安全消费聚合结果
5. [假数据生成工具] /lorem/
   ├─ 生成 Mock 聚合数据测试图表渲染
   └─ 验证空数据、单条数据、大数据量的边界
```

**关键细节**：JSONPath 聚合结果的结构与原始 JSON 不同（数组 → 单对象或按地区分组的对象），TS 类型生成应基于聚合结果而非原始数据，否则前端拿到的类型与实际数据不匹配。

### 场景 5：测试数据准备 ETL（Schema 设计 → Mock 数据生成 → CSV → JSON 测试管道）

**现象**：开发新功能时还没有真实数据，需要先设计数据契约，生成 Mock 数据测试 ETL 管道的正确性。

**错误 ETL 路径**：
```
直接用 lorem 生成随机字符串 → 跑 ETL 管道 → 一切看起来正常
  ↓ 问题：真实数据到来时字段类型、格式、约束全不对，ETL 管道崩溃
```

**正确 ETL 路径**：
```
1. [JSON Schema 生成工具] /json-schema/
   ├─ 手工设计 Schema（数据契约先行）
   ├─ 定义字段类型、nullable、enum、format
   └─ 输出：JSON Schema
2. [假数据生成工具] /lorem/
   ├─ 基于 Schema 生成符合约束的 Mock 数据
   ├─ 生成日期格式、枚举值、数字范围合规的数据
   └─ 输出：Mock JSON 数据集
3. [CSV 转 JSON 工具] /csv-json/
   ├─ 把 Mock JSON 转 CSV（反向测试 CSV 解析）
   └─ 验证 CSV → JSON 往返一致性
4. [JSONPath 查询工具] /jsonpath/
   ├─ 用 JSONPath 验证 Mock 数据的可查询性
   └─ 确认字段路径设计合理
5. [JSON 转 TypeScript 类型工具] /json-to-ts/
   └─ 生成前后端共享的类型定义
6. [JSON Schema 校验工具] /json-schema/
   └─ 真实数据到来后用同一份 Schema 校验
```

**关键细节**：Schema 设计先行（Schema-First）是测试数据准备的黄金法则。**先有契约再用契约约束 Mock 数据**，能避免"Mock 跑通但真实数据失败"的尴尬。

### 场景 6：多源数据合并 ETL（多个 CSV → JSON → Schema 校验一致性 → 合并）

**现象**：三个部门各交付一份 CSV（用户数据、订单数据、商品数据），需要合并为统一的 JSON 数据集，字段名与类型需对齐。

**错误 ETL 路径**：
```
三个 CSV → 各自转 JSON → 直接合并 → 字段名冲突 / 类型不一致
  ↓ 问题：用户 CSV 是 user_id，订单 CSV 是 userId，合并后无法关联
```

**正确 ETL 路径**：
```
1. [CSV 转 JSON 工具] /csv-json/
   ├─ 三个 CSV 分别转 JSON
   └─ 输出：三个 JSON 数组
2. [JSON Schema 生成工具] /json-schema/
   ├─ 分别推断三个 Schema
   ├─ 识别字段名差异：user_id vs userId vs UserID
   └─ 设计统一 Schema（字段名规范化）
3. [JSONPath 查询工具] /jsonpath/
   ├─ 提取关联字段：$[*].user_id（统一后）
   └─ 验证关联完整性
4. [JSON Schema 校验工具] /json-schema/
   ├─ 用统一 Schema 校验三个数据集
   └─ 拒绝字段名不规范的数据
5. [JSON 转 TypeScript 类型工具] /json-to-ts/
   ├─ 生成统一类型定义
   └─ 前端消费合并后的数据
6. [假数据生成工具] /lorem/
   └─ 生成 Mock 数据测试合并逻辑
```

**关键细节**：多源数据合并的核心是**字段名规范化**与**类型对齐**。CSV 转 JSON 时可配置字段名映射（如 user_id → userId），避免下游到处转换。

## 五大协同陷阱深度剖析

### 陷阱 1：先转换再校验（Schema 漂移导致校验失效）

**错误流程**：CSV → JSON → 立即生成 TS 类型 → 后续 CSV 用 TS 类型校验

**问题**：第一份 CSV 是样本，Schema/TS 类型基于样本推断。后续 CSV 可能有新字段（Schema 漂移）或字段类型变化（如新数据 status 出现 "500" 字符串而非 500 数字）。**TS 类型无法动态校验数据**，需要 JSON Schema 这种运行时可校验的契约。

**正确流程**：CSV → JSON → 推断 JSON Schema → 后续 CSV 转 JSON 后用 Schema 校验 → 通过的数据再用 TS 类型消费。

**实践建议**：JSON Schema 是数据契约的"运行时校验器"，TypeScript 类型是"编译时类型保护"。**两者互补，不可替代**。Schema 校验通过的脏数据列表应记录到 ETL 监控，识别 Schema 漂移趋势。

### 陷阱 2：JSONPath 查询在嵌套层级变化时失效

**错误流程**：CSV → JSON → 写 JSONPath 查询 `$.data[*].user.id` → 某条数据的 user 字段为 null → 查询报错

**问题**：JSONPath 假设字段路径稳定，但 CSV 转 JSON 时若空值处理不一致（有的转 null、有的省略字段），JSONPath 查询会因路径断裂失败。

**正确流程**：先用 Schema 校验确认所有数据的字段路径稳定（nullable 字段必须显式存在为 null，不能缺失），再用 JSONPath 查询。

**实践建议**：CSV 转 JSON 时配置"缺失字段补 null"，保证字段集合一致。JSONPath 查询时用 `?(@.user)` 过滤器先判断字段存在性，避免路径断裂。

### 陷阱 3：TS 类型与 Schema 的 nullable 不一致

**错误流程**：JSON Schema 推断字段 `referer` 为 `{ "type": ["string", "null"] }`，但 JSON 转 TS 类型生成器把它生成 `referer: string`（非可选非 nullable）。

**问题**：不同 TS 生成器对 nullable 的处理不一致。有的把 nullable 字段生成 `field: string | null`，有的生成 `field?: string`，有的直接忽略 nullable 生成 `field: string`。前端使用时遇到 null 值崩溃。

**正确流程**：选择支持 JSON Schema nullable 的 TS 生成器，或手工调整生成的类型。**TS 类型应与 Schema 严格对齐**：Schema 是 `{ "type": ["string", "null"] }` 的字段，TS 应为 `field: string | null`。

**实践建议**：用 [TS 接口生成工具](/json-to-ts) 时检查生成结果是否保留了 nullable 标记。若生成器不支持，可在 Schema 中用 `oneOf` 表达 nullable，强制 TS 生成器生成联合类型。

### 陷阱 4：Mock 数据不符合 Schema 约束

**错误流程**：用 [假数据生成工具](/lorem) 生成随机字符串 → 跑 ETL 管道 → Schema 校验全部失败。

**问题**：通用 Mock 数据生成器（如 lorem ipsum）只生成占位文本，不感知 Schema 约束。Schema 要求字段是 ISO 8601 日期、枚举值、数字范围、email 格式，Mock 数据全是随机字符串，校验必然失败。

**正确流程**：用 Schema 驱动的 Mock 数据生成器（如 json-schema-faker），根据 Schema 的 `format`、`enum`、`minimum`/`maximum` 等约束生成合规数据。

**实践建议**：本站 [测试数据生成器](/lorem) 适合生成"语义合理"的占位数据（如中文姓名、地址、公司名），但不感知 Schema。**生产 ETL 测试建议用 Schema 驱动的 faker**，本站工具适合前端原型与 UI 占位场景。

### 陷阱 5：CSV 字段顺序变化导致转 JSON 错位

**错误流程**：业务方交付新 CSV，字段顺序与原 CSV 不同 → 直接跑 ETL → JSON 字段错位 → Schema 校验大量失败。

**问题**：CSV 是位置型数据（字段靠列位置识别），JSON 是名称型数据（字段靠 key 识别）。CSV 转 JSON 时若依赖字段顺序而非字段名（如用 index 而非 header），字段顺序变化会导致 JSON 字段错位。

**正确流程**：CSV 转 JSON 时**始终用第一行作为字段名**，不依赖位置。若 CSV 无字段名行，先补字段名再转。

**实践建议**：用 [CSV 解析转换工具](/csv-json) 时勾选"第一行为字段名"。若 CSV 字段顺序变化，Schema 校验会立即发现（字段类型不匹配），定位问题。**Schema 是字段顺序变化的"探测器"**。

## 端到端 ETL 工作流总览

### 工作流架构图

```
原始 CSV → [CSV 转 JSON] → JSON 数据
                              ↓
                      [Schema 推断] → JSON Schema ──┐
                              ↓                     │
                      [Schema 校验] ← ─────────────┘
                              ↓
                      [JSONPath 查询] → 提取所需字段
                              ↓
                      [TS 类型生成] → 前端类型定义
                              ↓
                      [Mock 数据生成] → 测试 ETL 管道
```

### 工序执行清单

| 工序 | 输入 | 输出 | 验证点 |
| --- | --- | --- | --- |
| 1. CSV → JSON | CSV 文件 | JSON 数组 | 字段名正确、类型推断合理、空值处理一致 |
| 2. Schema 推断 | JSON 样本 | JSON Schema | 字段类型、nullable、枚举值识别准确 |
| 3. Schema 校验 | JSON + Schema | 合规数据 + 脏数据 | 脏数据比例 < 5%，脏数据有明确原因 |
| 4. JSONPath 查询 | 合规 JSON | 查询结果 JSON | 查询路径稳定、结果结构符合预期 |
| 5. TS 类型生成 | 查询结果 JSON | TypeScript 接口 | nullable 字段保留、字段名规范 |
| 6. Mock 测试 | Schema + TS 类型 | Mock 数据 + 测试报告 | Mock 数据通过 Schema 校验、ETL 管道端到端跑通 |

## 工具矩阵协同总览

| 工序 | 本站工具 | 核心能力 | 在 ETL 中的位置 |
| --- | --- | --- | --- |
| CSV → JSON | [CSV JSON 互转工具](/csv-json) | 字段名识别 / 类型推断 / 空值处理 | Extract 阶段 |
| Schema 推断与校验 | [数据契约定义工具](/json-schema) | 从样本推断 / 校验新数据 | Transform 阶段 |
| JSONPath 查询 | [JSON 路径提取工具](/jsonpath) | 过滤 / 聚合 / 提取字段 | Transform 阶段 |
| TS 类型生成 | [TypeScript 类型生成器](/json-to-ts) | JSON → interface / 联合类型 | Load 阶段 |
| Mock 数据 | [Mock 数据生成工具](/lorem) | 占位文本 / 假数据 | Load 阶段（测试） |

### 协同关系矩阵

```
原始 CSV → [CSV JSON 互转] → JSON → [Schema 生成] → Schema ──┐
                                  ↓                           │
                          [Schema 校验] ← ──────────────────┘
                                  ↓
                          [JSONPath 查询] → 提取 JSON
                                  ↓
                          [TS 类型生成] → interface
                                  ↓
                          [Mock 数据生成] → 测试数据
```

**关键协同原则**：

1. **契约先行**：Schema 是 ETL 的契约，必须先推断再用，所有下游工序基于同一份 Schema
2. **校验在查询前**：脏数据会导致 JSONPath 查询失效，必须先校验再查询
3. **类型与 Schema 对齐**：TS 类型应严格反映 Schema 的 nullable 与类型约束，不可丢失信息
4. **Mock 数据符合契约**：Mock 数据必须通过 Schema 校验，否则测试无意义
5. **CSV 字段名而非位置**：CSV 转 JSON 始终用字段名识别，避免字段顺序变化导致错位

## 常见误区

### 误区 1：CSV 转 JSON 后直接用，不需要 Schema

**事实**：CSV 转 JSON 的类型推断基于样本，样本不全时类型推断错误（如把数字字段推断为字符串）。**Schema 是数据契约的"真理之源"**，TS 类型、Mock 数据、校验规则都应基于 Schema。

### 误区 2：TS 类型可以替代 Schema 校验

**事实**：TS 类型是编译时类型保护，运行时数据是 any。**Schema 校验是运行时保护**，能拒绝运行时脏数据。两者互补：TS 类型保护代码正确性，Schema 校验保护数据正确性。

### 误区 3：JSONPath 查询不需要先校验数据

**事实**：脏数据（字段缺失、类型错位、null 值）会导致 JSONPath 查询失败或返回错误结果。**先校验再查询**能保证查询结果可靠。

### 误区 4：Mock 数据随便生成就行

**事实**：通用 Mock 数据（lorem ipsum）不感知 Schema，校验必然失败。**Mock 数据应 Schema 驱动**，符合字段类型、格式、枚举、范围约束。

### 误区 5：CSV 字段顺序固定不需要担心

**事实**：业务方交付的 CSV 字段顺序可能因导出工具不同而变化。**始终用字段名而非位置识别**，并用 Schema 校验探测字段顺序变化。

### 误区 6：ETL 是一次性任务，不需要测试

**事实**：ETL 是数据管道，会持续接收新数据。**Mock 数据测试能验证管道的健壮性**，发现 Schema 漂移、字段缺失、类型变化等问题。

## 最佳实践清单

1. **CSV 转 JSON 配置**：勾选"第一行为字段名"、配置"空字符串转 null"、配置"数字字段自动转 number"
2. **Schema 推断样本量**：至少 1000 条样本，覆盖所有字段的所有可能取值
3. **Schema 校验监控**：记录脏数据比例与原因，识别 Schema 漂移趋势
4. **JSONPath 查询健壮性**：用 `?(@.field)` 过滤器判断字段存在性，避免路径断裂
5. **TS 类型对齐 Schema**：检查 nullable 字段是否生成 `field: string | null` 而非 `field: string`
6. **Mock 数据 Schema 驱动**：用 json-schema-faker 等工具根据 Schema 生成合规 Mock
7. **字段名规范化**：多源数据合并时统一字段名（如下划线 → 驼峰），避免下游到处转换
8. **ETL 管道监控**：记录每个工序的输入输出量、脏数据比例、Schema 漂移事件
9. **契约版本化**：Schema 变化时升级版本号（如 v1 → v2），下游按版本消费
10. **端到端测试**：用 Mock 数据跑通完整 ETL 管道，验证契约一致性

## 总结

CSV 数据 ETL 全链路的核心不是"用什么工具转什么格式"，而是"工序怎么排与契约怎么定"。本文给出的六步顺序（CSV → JSON → Schema 推断 → Schema 校验 → JSONPath 查询 → TS 类型生成 → Mock 测试）基于契约稳定性与下游消费可靠性，覆盖了真实 ETL 场景的常见陷阱。

**关键决策点**：

- **Schema 位置**：CSV 转 JSON 后立即推断 Schema，所有下游工序基于同一份 Schema
- **校验位置**：Schema 校验在 JSONPath 查询前，保证查询数据合规
- **TS 类型位置**：基于 JSONPath 查询结果（而非原始 CSV 全量）生成 TS 类型
- **Mock 测试位置**：最后用 Schema 驱动的 Mock 数据验证端到端管道

**不同场景的工序取舍**：

- 日志分析：JSONPath 聚合是核心，TS 类型服务于前端展示
- 配置导入：Schema 校验是核心，TS 类型保证前后端类型一致
- API 迁移：Mock 测试是核心，先用 Mock 验证 API 契约再迁移真实数据
- 报表生成：JSONPath 聚合是核心，TS 类型服务于图表渲染
- 测试准备：Schema 设计先行，Mock 数据 Schema 驱动
- 多源合并：字段名规范化与 Schema 校验是核心，TS 类型保证合并后类型一致

掌握工序顺序与契约设计，配合本站 5 个工具的协同能力，可以覆盖 90% 以上的 CSV 数据 ETL 场景。
