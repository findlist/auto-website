---
title: "数据格式转换全景：JSON / CSV / TSV / YAML 该用哪个？"
description: "系统对比 JSON、CSV、TSV、YAML 四种主流数据格式的优劣与适用场景：RFC 4180 CSV 状态机解析原理、JSON 嵌套对象展平为点号路径列、Excel 乱码与 UTF-8 BOM、分隔符选择策略、CSV 无类型系统的陷阱。配套可交互 CSV / JSON 互转工具，帮你选对格式、转对数据。"
pubDate: 2026-07-04
tags: ["数据", "CSV", "JSON", "格式转换", "前端"]
relatedTool: "/csv-json"
---

## 为什么前端要懂多种数据格式

假设后端同事给你一份用户数据导出，问你要 CSV 还是 JSON。你随口说「JSON 吧」——结果发现是 10 万条扁平记录，JSON 体积比 CSV 大 60%，前端解析慢了 3 倍，而且业务方想在 Excel 里看，根本打不开。

反过来，如果数据是<strong>嵌套结构</strong>（用户有多个地址、多个标签），CSV 会把字段名拉成一长串 `addresses[0].city`，列宽失控，根本没法在 Excel 里读。

<strong>数据格式选型不是审美问题，而是性能、可读性、工具兼容性的权衡</strong>。本文系统对比 JSON / CSV / TSV / YAML 四种主流格式，并讲清楚转换时的常见陷阱。

> 配套工具：[CSV / JSON 互转工具](/csv-json)

## 四种格式横向对比

| 格式 | 全称 | 类型系统 | 嵌套结构 | 体积 | Excel | 人类可读 | 典型场景 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **JSON** | JavaScript Object Notation | 数字 / 字符串 / 布尔 / null / 对象 / 数组 | ✓ | 较大 | ✗ | 中 | API、配置、结构化数据 |
| **CSV** | Comma-Separated Values | 全是字符串 | ✗ | 小 | ✓ | 中 | 表格数据交换、导出 |
| **TSV** | Tab-Separated Values | 全是字符串 | ✗ | 小 | ✓ | 中 | 字段常含逗号的数据 |
| **YAML** | YAML Ain't Markup Language | 数字 / 字符串 / 布尔 / null / 对象 / 数组 | ✓ | 最小 | ✗ | 高 | 配置文件、CI/CD |

经验法则：

- <strong>API 与前端状态</strong> → JSON（类型丰富、原生解析、生态成熟）
- <strong>表格数据导出 / Excel 交换</strong> → CSV（体积小、Excel 直读）
- <strong>字段常含逗号</strong>（如日志、地址）→ TSV（避免引号转义地狱）
- <strong>配置文件</strong> → YAML（缩进表达层级，注释友好）

## RFC 4180：CSV 的真实标准

许多人以为 CSV 就是「逗号分隔」，其实 CSV 有标准：<strong>RFC 4180</strong>。核心规则：

1. <strong>每行一条记录</strong>，行结束符 CRLF（`\r\n`）或 LF（`\n`）
2. <strong>字段用逗号分隔</strong>，最后一个字段后无逗号
3. <strong>字段含逗号、双引号或换行符时</strong>，必须用双引号 `"` 包裹整个字段
4. <strong>字段内的双引号</strong>需转义为两个连续双引号 `""`
5. <strong>首行可选作为表头</strong>，字段名同样遵守引号规则

举几个例子：

```
name,age,city
张三,28,北京                         # 简单字段无需引号
"李,四",34,"上海"                    # 字段含逗号必须引号
"王五","含""引号""的字段",深圳       # 字段含引号："" 转义为 "
"赵六","地址
多行",广州                           # 字段含换行：用引号包裹
```

<strong>正确解析 CSV 必须用状态机</strong>，不能用 `line.split(',')`。因为一行可能因为引号包裹的换行而跨越多行，一个字段可能因为引号转义而包含逗号。本站的 [CSV / JSON 互转工具](/csv-json) 实现了完整的 RFC 4180 状态机解析器。

### 状态机解析原理

CSV 解析状态机有 4 个状态：

```javascript
// 简化版状态机：完整版见 /csv-json 工具源码
let state = 'FIELD_START';  // FIELD_START / UNQUOTED / QUOTED / QUOTE_MAY_END
for (const ch of text) {
  switch (state) {
    case 'FIELD_START':
      if (ch === '"') state = 'QUOTED';        // 进引用字段
      else if (ch === delimiter) pushField();   // 空字段
      else if (ch === '\n') pushRow();          // 行结束
      else { currentField += ch; state = 'UNQUOTED'; }
      break;
    case 'UNQUOTED':
      if (ch === delimiter) { pushField(); state = 'FIELD_START'; }
      else if (ch === '\n') { pushField(); pushRow(); state = 'FIELD_START'; }
      else currentField += ch;
      break;
    case 'QUOTED':
      if (ch === '"') state = 'QUOTE_MAY_END';  // 可能是结束也可能是转义
      else currentField += ch;                   // 引号内的一切（含换行）都累积
      break;
    case 'QUOTE_MAY_END':
      if (ch === '"') { currentField += '"'; state = 'QUOTED'; }  // "" → "
      else if (ch === delimiter) { pushField(); state = 'FIELD_START'; }
      else if (ch === '\n') { pushField(); pushRow(); state = 'FIELD_START'; }
      break;
  }
}
```

关键点：<strong>QUOTED 状态下遇到的换行不会触发行结束</strong>，而是作为字段内容累积。这就是为什么含换行的字段必须用引号包裹——状态机才知道这个换行是字段内还是记录间。

## JSON 嵌套对象展平为 CSV 列

JSON 支持任意嵌套（`user.address.city`），而 CSV 是扁平表格。转换策略是<strong>用点号路径展平</strong>：

```json
{
  "name": "张三",
  "age": 28,
  "address": { "city": "北京", "zip": "100000" },
  "tags": ["前端", "后端"]
}
```

展平后：

| name | age | address.city | address.zip | tags[0] | tags[1] |
| --- | --- | --- | --- | --- | --- |
| 张三 | 28 | 北京 | 100000 | 前端 | 后端 |

实现要点：

1. <strong>递归展平</strong>：对象递归到基础类型为止，数组用 `[index]` 标记
2. <strong>表头取并集</strong>：多个对象可能有不同字段，取所有键的并集作为表头
3. <strong>缺失字段填空</strong>：某对象没有的字段在 CSV 中为空字符串
4. <strong>类型丢失</strong>：JSON 数字 `28` 在 CSV 中变成字符串 `"28"`，CSV 无类型系统

```javascript
function flatten(obj, prefix, out) {
  if (obj === null) { out[prefix] = ''; return; }
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => flatten(item, `${prefix}[${i}]`, out));
    return;
  }
  if (typeof obj === 'object') {
    Object.entries(obj).forEach(([k, v]) =>
      flatten(v, prefix === '' ? k : `${prefix}.${k}`, out));
    return;
  }
  out[prefix] = String(obj);  // 基础类型转字符串
}
```

<strong>反向转换（CSV → JSON）时类型无法自动还原</strong>，所有字段都是字符串。如果需要还原数字 / 布尔，可以勾选本站工具的「智能类型」开关自动转换，也可在代码中二次处理：

```javascript
data.forEach(row => {
  row.age = Number(row.age);              // "28" → 28
  row.active = row.active === 'true';     // "true" → true
});
```

### CSV → JSON 智能类型推断

本站 [CSV / JSON 互转工具](/csv-json) 提供「智能类型」开关，启用后 CSV → JSON 时会自动识别字段字面量并转换为对应 JS 类型：

| 原始字符串 | 转换结果 | 类型徽章 |
| --- | --- | --- |
| `28` / `-5` / `3.14` / `1e3` | `28` / `-5` / `3.14` / `1000`（number） | **N** |
| `true` / `false` / `TRUE` / `False` | `true` / `false`（boolean，不区分大小写） | **B** |
| `null` / `NULL` / `None` / `nil` | `null` | **∅** |
| 空字符串 | `null` | **∅** |
| 其余字符串 | 原样保留（string） | **S** |

启用后表格预览中每个单元格右上角会显示类型徽章，方便快速校验推断结果是否正确。

### 边界场景：什么时候智能推断会「故意保留字符串」

智能推断采用<strong>保守策略</strong>——宁可保留字符串也不误判。以下三类场景工具会主动保留为字符串并在「风险提示区」给出原因：

1. <strong>前导零数字</strong>（如 `021000` 邮政编码、`01012345678` 电话号码、`007` 编号）：转 number 会丢失前导零（`021000` → `21000`），导致邮政编码、电话区号、编号语义改变。规则：长度 > 1 且以 `0` 开头的纯数字串保留为字符串。注意 `0`、`0.5`、`0.0` 不会被拦截（`0` 长度为 1，含小数点的串不符合 `^0\d+$`）。

2. <strong>超过 `Number.MAX_SAFE_INTEGER`（2^53-1 = 9007199254740991）的大整数</strong>：JavaScript number 类型无法精确表示，转 number 会丢失末尾精度（`9007199254740993` → `9007199254740992`）。规则：纯整数串 `Number.isSafeInteger` 返回 false 时保留为字符串。

3. <strong>无法识别的混合内容</strong>（如 `010-12345678`、`v1.0`、`1,234.56`）：不符合纯整数 / 小数 / 科学计数法格式，保留为字符串。

### 常见陷阱：ID 编号该不该转 number

最隐蔽的陷阱是<strong>标识符类长数字串</strong>：订单号、身份证号、银行卡号、用户 ID。这些「全是数字」但<strong>实质是标识符而非数值</strong>：

- 16 位以上的银行卡号、18 位身份证号 → 超过 `MAX_SAFE_INTEGER`，工具会主动保留字符串
- 12-15 位的订单号（如 `202601011234`）→ 在安全整数范围内，工具会转为 number
- 转 number 后既可能丢失精度（超长 ID）也可能丢失前导零（如 `007` 开头的工号）

<strong>建议</strong>：如果你的 CSV 含 ID 类字段，<strong>关闭智能类型开关</strong>或导出 JSON 后用代码还原为字符串：

```javascript
data.forEach(row => {
  row.orderId = String(row.orderId);   // 强制还原为字符串
  row.userId = String(row.userId);
});
```

## Excel 打开 CSV 乱码：BOM 的故事

经典问题：用编辑器生成 UTF-8 编码的 CSV，在 Excel 中打开中文乱码。

<strong>原因</strong>：Excel 在 Windows 上默认按系统区域编码解析 CSV，简体中文系统是 GBK / GB2312，而现代工具生成的 CSV 多为 UTF-8，编码不匹配导致乱码。

<strong>解决方案</strong>：在文件开头加 <strong>UTF-8 BOM</strong>（Byte Order Mark，3 字节 `0xEF 0xBB 0xBF`，即 `\uFEFF`）。Excel 识别到 BOM 后会自动按 UTF-8 解析。

```javascript
// 本站 CSV 下载按钮已自动加 BOM
const BOM = '\uFEFF';
const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8' });
```

注意：<strong>BOM 不是所有场景都需要</strong>：

- <strong>Excel 打开</strong>：必须加 BOM，否则中文乱码
- <strong>程序读取</strong>（Python pandas、Node.js csv-parser）：通常不需要 BOM，部分解析器会把 BOM 当作第一个字段名的一部分
- <strong>JSON 文件</strong>：永远不要加 BOM，`JSON.parse` 会报错

本站 [CSV / JSON 互转工具](/csv-json) 的下载按钮在 CSV 模式下自动加 BOM，JSON 模式下不加，符合两种格式的最佳实践。

## 分隔符选择策略

CSV 的 "C" 是 Comma（逗号），但实际中分隔符不止逗号：

| 分隔符 | 名称 | 适用场景 | 注意 |
| --- | --- | --- | --- |
| `,` 逗号 | CSV | RFC 4180 标准，Excel 默认 | 字段含逗号需引号 |
| `\t` Tab | TSV | 字段常含逗号（如地址、日志） | Excel「另存为」可选 Tab 分隔 |
| `;` 分号 | SCV | 欧洲国家（数字用逗号作小数点） | Excel 在欧洲区域设置下默认 |
| `\|` 竖线 | PSV | 日志、配置文件 | 字段含竖线少见，引号需求低 |

<strong>为什么需要多种分隔符？</strong>因为字段内容可能本身含逗号（如「上海,浦东」），用引号包裹虽正确但可读性差。改用 Tab 或竖线分隔可避免引号转义，原始文本更易读。

<strong>切换分隔符的代价</strong>：文件扩展名仍是 `.csv`，但实际是 TSV / PSV，<strong>接收方必须知道分隔符才能正确解析</strong>。TSV 有独立扩展名 `.tsv`，建议优先使用。

## CSV 无类型系统的陷阱

CSV 的最大局限是<strong>没有类型系统</strong>，所有值都是字符串。这会导致：

1. <strong>数字 vs 字符串混淆</strong>：`age` 列的 `28` 是数字还是字符串？CSV 无法区分
2. <strong>布尔值丢失</strong>：`true` / `false` 在 CSV 中只是文本，需要约定
3. <strong>null 歧义</strong>：空字段是 `null`、空字符串 `""` 还是缺失？CSV 无法表达
4. <strong>日期格式不统一</strong>：`2026-07-04`、`07/04/2026`、`2026/7/4` 都是合法字符串，解析方需约定

<strong>对比 JSON 的类型系统</strong>：

```json
{ "age": 28, "active": true, "tags": [], "deletedAt": null }
```

JSON 明确区分数字 `28`、布尔 `true`、空数组 `[]`、null。CSV 中这些都变成字符串。

<strong>实践建议</strong>：

- CSV 用于<strong>数据交换</strong>（导出给业务方看、上传到 Excel）
- JSON 用于<strong>程序间通信</strong>（API、配置、状态持久化）
- 不要用 CSV 存储<strong>需要类型还原</strong>的数据，否则双向转换会丢类型
- 如必须从 CSV 还原类型，可使用本站工具的<strong>智能类型推断</strong>（含前导零与大整数风险提示），或导出后用代码二次处理

## 选型决策表

| 场景 | 推荐格式 | 理由 |
| --- | --- | --- |
| 前后端 API 通信 | JSON | 类型丰富、原生解析、生态成熟 |
| 数据导出给业务方 | CSV + BOM | Excel 直读、体积小 |
| 配置文件 | YAML | 注释友好、缩进表达层级 |
| 日志记录 | TSV / JSONL | 字段含逗号常见，TSV 避免转义；JSONL 保留结构 |
| 大数据存储 | Parquet / Avro | 列式存储、压缩比高、类型安全 |
| 简单表格交换 | CSV | 通用性最高，所有工具都支持 |
| 嵌套结构数据 | JSON | CSV 无法表达嵌套，展平后列名失控 |
| 跨语言配置 | TOML / YAML | 比 JSON 更适合人写，支持注释 |

## 工具矩阵：数据格式工具联动

本站数据格式相关工具：

- [JSON 工具](/json)：格式化、压缩、校验、转义、树形视图、搜索高亮
- [CSV / JSON 互转](/csv-json)：状态机解析、嵌套展平、表格预览、BOM 下载

典型工作流：

1. 后端返回压缩 JSON，用 <strong>JSON 工具</strong>格式化查看结构
2. 业务方要 Excel 报表，把 JSON 复制到 <strong>CSV / JSON 互转</strong>转 CSV
3. 下载 .csv 文件（自动加 BOM），Excel 直接打开中文正常
4. 业务方修改后回传 CSV，用 <strong>CSV / JSON 互转</strong>转回 JSON
5. 用 <strong>JSON 工具</strong>校验合法性，提交给后端

## 小结

数据格式选型记住三个关键：

- <strong>表格用 CSV，结构用 JSON</strong>：扁平数据 CSV 体积小、Excel 直读；嵌套数据 JSON 类型丰富、生态成熟
- <strong>CSV 必须用状态机解析</strong>：`split(',')` 在引号包裹和字段内换行时会出错
- <strong>Excel 中文乱码加 BOM</strong>：UTF-8 BOM 是 Excel 识别编码的信号，程序读取时不需要

嵌套对象转 CSV 时用<strong>点号路径展平</strong>（`user.address.city`），数组用 `[index]` 标记。反向转换时类型默认会丢失，可勾选本站工具的「智能类型」开关自动还原数字 / 布尔 / null，并对前导零邮政编码、超大整数等风险场景给出提示。本站的 [CSV / JSON 互转工具](/csv-json) 实现了 RFC 4180 标准解析器，支持 4 种分隔符、表格预览、类型徽章、BOM 下载，可在开发流程中随时调用。
