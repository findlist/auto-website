---
title: "JSONPath 完全实战：从 RFC 9535 标准到三阶段解析架构与典型场景"
description: "系统讲解 JSONPath 查询语言：RFC 9535 标准化简史、$ 与 @ 路径表达、递归下降与通配符、过滤表达式进阶（比较/正则/逻辑/存在性）、三阶段解析架构（tokenizer/parser/evaluator）、与 jq 选型对比、性能优化与陷阱、API 测试与配置查询实战，附 JSONPath 查询工具实操。"
pubDate: 2026-07-19
tags: ["JSONPath", "JSON", "RFC 9535", "查询语言", "AST", "tokenizer", "parser", "过滤器", "递归下降", "jq", "工具矩阵"]
relatedTool: "/jsonpath"
---

## JSONPath 解决什么问题

RESTful API 时代，几乎每个开发者每天都在和嵌套 JSON 打交道：

```json
{
  "store": {
    "book": [
      { "category": "fiction", "author": "Author A", "title": "Book A", "price": 8.95 },
      { "category": "reference", "author": "Author B", "title": "Book B", "price": 22.99 }
    ],
    "bicycle": { "color": "red", "price": 19.95 }
  }
}
```

如果只想拿到「所有价格低于 10 的书的标题」，传统做法是：

```javascript
const books = data.store.book.filter(b => b.price < 10).map(b => b.title);
// ["Book A"]
```

这种代码可读性差、容易写错，且无法跨语言复用。**JSONPath 让你用一行表达式完成提取**：

```text
$.store.book[?(@.price < 10)].title
──> ["Book A"]
```

JSONPath 的核心价值：

1. **声明式查询**：用路径表达式描述「要什么」而非「怎么拿」
2. **跨语言通用**：JS/Python/Java/Go 都有实现，一次写好到处可用
3. **可序列化**：路径本身是字符串，可作为参数传递、配置存储
4. **测试友好**：测试框架（Postman/JMeter）原生支持

> 配套工具：[JSONPath 查询工具](/jsonpath)。12 个预设示例覆盖典型场景，所有查询在浏览器本地执行。

## 一、RFC 9535 标准化简史与生态

### 1.1 从 2007 到 2024：JSONPath 标准化的 17 年

| 时间 | 事件 |
|------|------|
| 2007-02 | Stefan Gössner 在 [Google Docs 发布 JSONPath 提案](https://goessner.net/articles/JsonPath/) |
| 2014-2019 | 多个独立实现出现（Jayway/jsonpath、s3u/JSONPath、jsonpath-plus），语法略有差异 |
| 2020-2021 | IETF JSONPATH WG 成立，启动标准化工作 |
| 2024-02 | [RFC 9535](https://www.rfc-editor.org/rfc/rfc9535) 正式发布，统一语法 |

RFC 9535 的最大贡献是**统一了各家实现的语法差异**，明确了过滤表达式、函数、特殊字符转义等关键细节。

### 1.2 主流实现生态

| 实现 | 语言 | 特点 |
|------|------|------|
| [Jayway/JsonPath](https://github.com/json-path/JsonPath) | Java | Android/后端主流，Postman 内置 |
| [PEP 506 jsonpath-ng](https://github.com/h2non/jsonpath-ng) | Python | Python 主流 |
| [jsonpath-plus](https://github.com/JSONPath-Plus/JSONPath) | JavaScript | 最完整实现，约 50KB |
| [s3u/JSONPath](https://github.com/s3u/JSONPath) | JavaScript | 轻量实现 |
| **本站实现** | TypeScript | 三阶段架构，零依赖，覆盖 RFC 9535 子集 |

### 1.3 与 JSON Pointer 的区别

| 维度 | JSON Pointer（RFC 6901） | JSONPath（RFC 9535） |
|------|------------------------|---------------------|
| 语法 | `/store/book/0/title` | `$.store.book[0].title` |
| 通配符 | ❌ | ✅ `[*]` |
| 递归 | ❌ | ✅ `..` |
| 过滤 | ❌ | ✅ `[?(...)]` |
| 多匹配 | ❌ 单节点 | ✅ 节点列表 |
| 典型用途 | JSON Patch | 数据查询/提取 |
| 标准化 | RFC 6901（2013） | RFC 9535（2024） |

## 二、基础语法：从路径表达到节点提取

### 2.1 路径表达式的五种基本构件

```text
$          根节点
.name      子节点（点访问）
['name']   子节点（括号访问，含特殊字符时使用）
[index]    数组索引（含负索引）
[*]        数组通配符（所有元素）
..name     递归下降（任意深度的 name 字段）
..*        递归所有节点
[?(expr)]  过滤表达式
```

### 2.2 五种基本查询模式

#### 模式 1：直接路径访问

```text
$.store.book[0].title
──> ["Book A"]

$.store.bicycle.color
──> ["red"]
```

#### 模式 2：通配符遍历

```text
$.store.book[*].title
──> ["Book A", "Book B"]

$.store.*
──> [ [ { ... }, { ... } ], { ... } ]
```

#### 模式 3：递归下降

```text
$..author
──> ["Author A", "Author B"]

$..price
──> [8.95, 22.99, 19.95]
```

#### 模式 4：数组索引

```text
$.store.book[0]
──> [ { "category": "fiction", ... } ]

$.store.book[-1]   # 最后一个
──> [ { "category": "reference", ... } ]

$.store.book[0,1]  # 多索引
──> [ { ... }, { ... } ]
```

#### 模式 5：过滤表达式

```text
$.store.book[?(@.price < 10)]
──> [ { "category": "fiction", "price": 8.95, ... } ]

$.store.book[?(@.category == "fiction")].title
──> ["Book A"]
```

## 三、过滤表达式进阶

### 3.1 七类运算符

| 类型 | 运算符 | 示例 |
|------|--------|------|
| 比较 | `==` `!=` `>` `>=` `<` `<=` | `[?(@.price < 10)]` |
| 正则匹配 | `=~` | `[?(@.email =~ ".*@example\\.com")]` |
| 逻辑与 | `&&` | `[?(@.price < 10 && @.category == "fiction")]` |
| 逻辑或 | `\|\|` | `[?(@.price < 10 \|\| @.price > 20)]` |
| 逻辑非 | `!` | `[?(!@.isbn)]`（没有 isbn 字段的书） |
| 存在性 | `@.field` | `[?(@.isbn)]`（有 isbn 字段的书） |
| 字面量 | `"str"` `123` `true` `false` `null` | `[?(@.category == "fiction")]` |

### 3.2 复杂过滤示例

```text
# 价格低于 10 且类别为 fiction 的书
$.store.book[?(@.price < 10 && @.category == "fiction")]

# 没有 ISBN 的书
$.store.book[?(!@.isbn)]

# 邮箱匹配 example.com 域
$.users[?(@.email =~ ".*@example\\.com")]

# 价格低于 10 或高于 20 的书
$.store.book[?(@.price < 10 || @.price > 20)]

# 价格在 10-20 之间（含边界）
$.store.book[?(@.price >= 10 && @.price <= 20)]
```

### 3.3 @ 与 $ 的区别

| 符号 | 含义 | 使用位置 |
|------|------|---------|
| `$` | 根节点 | 路径主体（起始位置） |
| `@` | 当前节点 | 过滤表达式内部 |

**关键理解**：

- `$` 通常只出现在路径开头，表示「从根开始」
- `@` 只在 `[?(...)]` 内部使用，表示「当前正在判断的元素」
- 在过滤表达式内也可用 `$` 引用根节点，但很少需要

示例：

```text
$..book[?(@.price < $.store.bicycle.price)]
                          ^^^^^^^^^^^^^^^^
                          引用根节点的 bicycle.price
```

### 3.4 字符串字面量与转义

JSONPath 过滤表达式内的字符串可用单引号或双引号：

```text
[?(@.category == 'fiction')]
[?(@.category == "fiction")]
```

如字符串本身含引号，需转义：

```text
[?(@.title == "He said \"Hello\"")]
```

## 四、三阶段解析架构

本站 [JSONPath 工具](/jsonpath) 采用标准的**三阶段架构**实现，便于扩展与维护：

```text
┌─────────────────────────────────────────────────────┐
│  输入：JSONPath 字符串                              │
│  示例：$.store.book[?(@.price < 10)].title          │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│  阶段 1：Tokenizer（词法分析）                       │
│  ──> 词法单元流：$ / . store / . book / [?(@.price <  │
│      10)] / . title                                 │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│  阶段 2：Parser（语法分析）                          │
│  ──> 抽象语法树（AST）：                            │
│      Root                                           │
│      └─ Child("store")                              │
│         └─ Child("book")                           │
│            └─ Filter(LessThan(Field("price"), 10))  │
│               └─ Child("title")                    │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│  阶段 3：Evaluator（求值）                           │
│  ──> 遍历 AST + 输入 JSON                           │
│  ──> 节点列表（始终是数组）                          │
│  ──> ["Book A"]                                     │
└─────────────────────────────────────────────────────┘
```

### 4.1 为什么是三阶段

- **关注点分离**：词法、语法、求值三个阶段互不依赖
- **可扩展性**：新增运算符只需修改 parser 与 evaluator，不影响 tokenizer
- **可测试性**：每阶段可独立单元测试
- **错误定位**：报错可精确到词法/语法/求值阶段

### 4.2 词法分析（Tokenizer）

将字符流切分为词法单元：

```javascript
// 输入：$.store.book[?(@.price < 10)]
// 输出：词法单元序列
[
  { type: 'ROOT', value: '$' },
  { type: 'CHILD', value: 'store' },
  { type: 'CHILD', value: 'book' },
  { type: 'FILTER_START', value: '[?(' },
  { type: 'CURRENT', value: '@' },
  { type: 'CHILD', value: 'price' },
  { type: 'OP', value: '<' },
  { type: 'NUMBER', value: 10 },
  { type: 'FILTER_END', value: ')]' }
]
```

### 4.3 语法分析（Parser）

将词法单元构建为 AST：

```javascript
{
  type: 'Root',
  child: {
    type: 'Child',
    name: 'store',
    child: {
      type: 'Child',
      name: 'book',
      child: {
        type: 'Filter',
        operator: '<',
        left: { type: 'Field', name: 'price' },
        right: { type: 'Literal', value: 10 },
        child: {
          type: 'Child',
          name: 'title'
        }
      }
    }
  }
}
```

### 4.4 求值（Evaluator）

递归遍历 AST，对输入 JSON 求值：

```javascript
function evaluate(ast, json) {
  // 从根节点开始
  let currentNodes = [json];
  
  // 递归访问子节点
  for (const step of ast.steps) {
    currentNodes = step.apply(currentNodes);
  }
  
  return currentNodes; // 始终是数组
}
```

### 4.5 本工具的实现差异

| RFC 9535 特性 | 本工具支持 |
|--------------|-----------|
| `$` `@` `.name` `['name']` | ✅ |
| `[index]` `[0,1]` 多索引 | ✅ |
| `[*]` 通配符 | ✅ |
| `..name` `..*` 递归下降 | ✅ |
| `[?(filter)]` 过滤表达式 | ✅ |
| `==` `!=` `>` `>=` `<` `<=` 比较 | ✅ |
| `=~` 正则匹配 | ✅ |
| `&&` `\|\|` `!` 逻辑 | ✅ |
| `[-1]` 负索引 | ✅ |
| `[1:5]` 切片 | ❌ |
| `[::2]` 步长 | ❌ |
| `length()` `count()` 函数 | ❌ |
| `^` 父节点引用 | ❌ |

切片与函数暂不支持，可通过多索引 `[1,2,3,4]` 替代切片。如需完整 RFC 9535 实现，可考虑引入 [jsonpath-plus](https://github.com/JSONPath-Plus/JSONPath)（约 50KB）。

## 五、与 jq 对比与选型

### 5.1 jq 简介

[jq](https://stedolan.github.io/jq/) 是功能更强的命令行 JSON 处理工具，支持管道、函数、变量、条件分支等**图灵完备**语法：

```bash
# jq：管道 + 内置函数
jq '.store.book | map(select(.price < 10)) | map(.title)' data.json
──> ["Book A"]

# 等价的 JSONPath
$.store.book[?(@.price < 10)].title
```

### 5.2 选型对比

| 维度 | JSONPath | jq |
|------|---------|-----|
| 学习成本 | 低（路径表达式） | 高（专属 DSL） |
| 跨语言 | 多语言实现 | 主要 CLI |
| 可序列化 | 路径是字符串 | 脚本是代码 |
| 功能复杂度 | 查询为主 | 查询 + 转换 + 计算 |
| 适合场景 | 嵌入式查询、配置、测试 | 复杂转换、shell 脚本 |
| 图灵完备 | 否 | 是 |
| 标准化 | RFC 9535 | 无官方标准 |

### 5.3 何时选 JSONPath

- 在测试断言中引用 JSON 字段
- 在配置文件中描述数据提取规则
- 跨语言复用查询逻辑
- 不需要复杂转换，仅查询/过滤

### 5.4 何时选 jq

- 命令行处理大型 JSON 文件
- 需要管道、变量、函数等复杂逻辑
- JSON 转 CSV、聚合统计等需要计算
- Shell 脚本集成

## 六、性能优化与陷阱

### 6.1 递归下降的性能开销

`..` 递归下降会遍历整棵 JSON 树，性能远高于点访问：

```text
$.store.book[0].title           # 4 步定位
$..title                        # 遍历全树
```

**实战建议**：

- 已知路径时优先用 `.name` 而非 `..name`
- 大型 JSON（>1MB）慎用 `..*`（递归所有节点）
- 重复查询同一 JSON 时，可缓存 AST 解析结果

### 6.2 过滤表达式的求值成本

过滤表达式对每个候选节点都要求值一次：

```text
$.store.book[?(@.price < 10)]
              └─ 对每个 book 元素求值 @.price < 10
```

**实战建议**：

- 过滤条件简单（如 `==`）性能可接受
- 过滤条件含正则 `=~` 时较慢
- 嵌套过滤（如 `[?(@.a.b.c > 0)]`）逐层访问，慎用

### 6.3 查询结果始终是数组

JSONPath 设计上**始终返回节点列表**（数组），即使只匹配一个：

```text
$.store.book[0].title
──> ["Book A"]   # 不是 "Book A"
```

这有时让初学者困惑。在代码中使用时需取第一个元素：

```javascript
const result = jsonpath.query(data, '$.store.book[0].title');
const title = result[0]; // 取第一个
```

### 6.4 路径转义陷阱

字段名含 `.` `[` `]` 等特殊字符时，必须用括号语法：

```text
# 错误：会被解析为 a.b
$.a.b

# 正确：字段名 "a.b"
$['a.b']

# 字段名含引号
$['it\'s']
```

### 6.5 空结果与未定义字段

JSONPath 查询无匹配时返回空数组 `[]`，**不报错**：

```text
$.store.book[?(@.price > 1000)]
──> []
```

未定义字段访问也返回空数组：

```text
$.store.notExist
──> []
```

这与 JS 直接访问 `obj.notExist` 返回 `undefined` 不同，需在代码中注意区分。

## 七、典型应用场景代码示例

### 7.1 API 测试断言（Postman/JMeter）

```javascript
// Postman Tests 脚本
const response = pm.response.json();
const titles = jsonpath.query(response, '$..book[?(@.price < 10)].title');

pm.test('应至少有一本便宜书', () => {
  pm.expect(titles.length).to.be.greaterThan(0);
});

pm.test('便宜书应包含 Book A', () => {
  pm.expect(titles).to.include('Book A');
});
```

### 7.2 OpenAPI Spec 查询

```javascript
// 查找所有 GET 接口
const getPaths = jsonpath.query(spec, '$.paths[*][?(@.get)].get');

// 查找所有含 Bearer 认证的接口
const securedOps = jsonpath.query(spec, '$..security[?(@.bearerAuth)]');
```

### 7.3 K8s Manifest 查询

```bash
# 查询所有含 image 的字段
kubectl get pods -o json | jq ... # jq 写法
jsonpath='{.items[*].spec.containers[*].image}' # kubectl 内置 jsonpath

# kubectl 内置 jsonpath 模板
kubectl get pods -o jsonpath='{.items[*].metadata.name}'
```

注意 kubectl 的 jsonpath 是 RFC 9535 之前的旧实现，语法略有差异（如不支持 `[?(filter)]` 的 `=~`）。

### 7.4 日志分析

```javascript
// JSON 格式日志中提取所有 error.message
const errorMessages = jsonpath.query(logs, '$..error.message');

// 提取耗时超过 1s 的请求
const slowReqs = jsonpath.query(logs, '$[?(@.duration > 1000)]');
```

### 7.5 前端动态表单

```javascript
// 根据 JSON Schema 用 JSONPath 实现字段联动
const requiredFields = jsonpath.query(schema, '$..properties[*][?(@.required)]');

// 验证表单数据
const errors = jsonpath.query(formData, '$..[?(@.invalid)]');
```

### 7.6 数据转换（JSON → CSV）

```javascript
// 用 JSONPath 提取表头与行数据
const headers = jsonpath.query(data, '$.columns[*].name');
const rows = jsonpath.query(data, '$.rows[*]').map(row =>
  jsonpath.query(row, '$[*].value')
);
```

## 八、与工具矩阵的协同

JSONPath 与数据格式矩阵其他工具形成完整工作流：

| 协同场景 | 工具组合 | 工作流 |
|---------|---------|--------|
| JSON 格式化 + 查询 | [JSON 工具](/json) + [JSONPath](/jsonpath) | 先格式化 JSON 再用 JSONPath 查询 |
| JSON Schema 校验 + 查询 | [JSON Schema 校验](/json-schema) + [JSONPath](/jsonpath) | Schema 验证结构后用 JSONPath 提取字段 |
| JSON 转 TS 接口 | [JSON 转 TS](/json-to-ts) + [JSONPath](/jsonpath) | 提取字段后生成 TS 类型 |
| JSON 与 XML 互转 | [JSON 转 XML](/json-to-xml) + [XML 转 JSON](/xml-to-json) + [JSONPath](/jsonpath) | 跨格式数据转换与查询 |
| YAML/TOML 配置查询 | [YAML 工具](/yaml) + [TOML 工具](/toml) + [JSONPath](/jsonpath) | 配置转 JSON 后用 JSONPath 查询 |
| CSV 与 JSON 转换 | [CSV JSON 转换](/csv-json) + [JSONPath](/jsonpath) | 表格数据提取与查询 |
| 正则协同 | [正则表达式](/regex) + [JSONPath](/jsonpath) | JSONPath 的 `=~` 运算符可调用正则 |

## 九、最佳实践清单

1. **优先用点访问而非递归下降**：`.name` 比 `..name` 快得多
2. **大型 JSON 慎用 `..*`**：递归所有节点性能开销大
3. **过滤条件尽量简单**：避免在过滤内嵌套深路径访问
4. **路径含特殊字符用括号语法**：`$['a.b']` 而非 `$.a.b`
5. **缓存 AST 解析结果**：重复查询同一表达式时避免重复解析
6. **结果始终是数组**：取第一个元素需 `[0]`，不要直接当标量用
7. **跨语言场景优先 JSONPath**：jq 跨语言支持差
8. **测试断言用 JSONPath**：Postman/JMeter 原生支持
9. **CLI 处理用 jq**：复杂转换 jq 更强大
10. **本工具调试真实 JSON**：[本站 JSONPath 工具](/jsonpath) 12 个预设示例覆盖典型场景

## 十、总结

JSONPath 是处理嵌套 JSON 数据的核心工具，核心价值在于：

1. **声明式查询**：用路径表达式描述「要什么」而非「怎么拿」
2. **跨语言通用**：JS/Python/Java/Go 都有实现
3. **RFC 9535 标准**：2024 年正式标准化，语法统一
4. **三阶段架构**：tokenizer → parser → evaluator，便于扩展与维护

理解 JSONPath 的关键是认清三个层次：

- **基础语法**：`$` `@` `.name` `[index]` `[*]` `..` 五种构件
- **过滤表达式**：`[?(...)]` 含比较/正则/逻辑/存在性七类运算符
- **架构思想**：三阶段解析，关注点分离，便于扩展

下一步动手实操：访问 [JSONPath 查询工具](/jsonpath)，点击预设示例按钮（如「过滤表达式」「递归下降」）观察结果，也可粘贴自己的 JSON 数据测试复杂查询。
