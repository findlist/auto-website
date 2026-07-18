---
title: "JSON 转 XML 实战：标签名约束与反向重建的不可逆性处理"
description: "系统讲解 JSON 转 XML 的工程化实践：XML 标签命名规则与非法 key 修正策略、属性 vs 子元素的语义选择、数组与命名差异处理、CDATA 与字符转义的取舍、null 与空值表达、well-formed 校验、SOAP/SVG/Office 文档生成实战、与 XML 转 JSON 工具的对偶关系，附 JSON 转 XML 工具实操。"
pubDate: 2026-07-19
tags: ["JSON", "XML", "标签命名", "属性", "CDATA", "well-formed", "SOAP", "SVG", "Office", "工具矩阵"]
relatedTool: "/json-to-xml"
---

## JSON 转 XML：反向操作中的"硬约束"

上一篇 [《XML 转 JSON 实战》](/blog/xml-to-json-mapping-pitfalls)讨论了 XML 到 JSON 的字段映射陷阱，本文讨论反向操作：**JSON 转 XML 的反向重建**。看似是同一硬币的两面，实则面临更严格的约束——XML 标签命名规则是 JSON key 不需要遵守的硬性约束。

XML 标签命名规则：

1. 必须以**字母或下划线**开头
2. 只能包含**字母、数字、连字符（-）、下划线（_）、点号（.）**
3. 不能以 `xml`（任意大小写组合）开头
4. 不能含空格

JSON key 几乎没有任何限制：可以是任意字符串（包括空字符串、纯数字、含特殊字符、含空格等）。这种"约束不对称"是 JSON 转 XML 工具的核心难点。

[本站 JSON 转 XML 工具](/json-to-xml) 实现了完整的标签名修正、属性 vs 子元素选择、CDATA 与字符转义切换、well-formed 校验。本文系统梳理这些策略的工程化实践。

## 一、标签名修正策略

### 1.1 非法 key 的修正规则

JSON key 违反 XML 命名规则时，工具会自动修正：

| JSON key | 违规原因 | 修正为 | 修正方式 |
| --- | --- | --- | --- |
| `"123"` | 以数字开头 | `_123` | 加下划线前缀 |
| `"a b"` | 含空格 | `a_b` | 替换为下划线 |
| `"a@b"` | 含 `@` | `a_b` | 替换为下划线 |
| `"a/b"` | 含 `/` | `a_b` | 替换为下划线 |
| `"xml"` | 以 xml 开头 | `_xml` | 加下划线前缀 |
| `"XML"` | 以 XML 开头 | `_XML` | 加下划线前缀 |
| `"a:b"` | 含 `:`（命名空间分隔符） | `a_b` | 替换为下划线（除非启用命名空间） |
| `""`（空字符串） | 无效标签名 | `item` | 退化使用数组项名 |
| `"123abc"` | 以数字开头 | `_123abc` | 加下划线前缀 |
| `"a.b.c"` | 含点号（合法） | `a.b.c`（保留） | 不修正 |

[本站 JSON 转 XML 工具](/json-to-xml) 在修正时会在警告区输出变更详情，便于人工核对。

### 1.2 修正的副作用与不可逆性

标签名修正存在两类副作用：

1. **信息丢失**：原 JSON key `a@b` 与 `a#b` 修正后均为 `a_b`，无法区分
2. **不可逆性**：JSON → XML → JSON 的往返转换后，key 可能与原 JSON 不一致

```json
{ "a@b": 1, "a#b": 2 }
```

转 XML：

```xml
<root>
  <a_b>1</a_b>
  <a_b>2</a_b>  <!-- 与上方冲突，必须用数组项名 -->
</root>
```

### 1.3 决策清单

- JSON key 已符合 XML 命名规则 → 无需修正，直接转换
- JSON key 含非法字符 → 评估修正后的可读性，必要时改用 [Slug 工具](/slug) 生成合法 key
- 需往返转换 → 避免使用含特殊字符的 key，使用前先用 [JSON 格式化工具](/json) 校验

## 二、属性 vs 子元素：何时用属性

### 2.1 默认策略：全部子元素

工具默认将 JSON 对象的所有字段转为子元素：

```json
{ "user": { "name": "Aether", "age": 18 } }
```

转为：

```xml
<user>
  <name>Aether</name>
  <age>18</age>
</user>
```

优点：结构清晰、可读性好、扩展性强（嵌套对象无压力）
缺点：冗长，元数据占空间

### 2.2 扁平对象用属性策略

启用"扁平对象用属性"选项后，若对象的所有字段都是基本类型（字符串 / 数字 / 布尔 / null），会转为属性形式：

```xml
<user name="Aether" age="18"/>
```

优点：紧凑，元数据对象最适合用属性
缺点：嵌套对象仍需子元素，混合结构可读性下降

### 2.3 决策清单

| 场景 | 推荐策略 |
| --- | --- |
| 元数据对象（id、version、type） | 扁平对象用属性 |
| 嵌套数据对象 | 默认子元素 |
| 混合结构 | 默认子元素（避免混淆） |
| 输出需对接 SOAP（属性是 SOAP 标准之一） | 扁平对象用属性 |
| 输出需对接 Android 资源（属性是标准） | 扁平对象用属性 |
| 输出需对接 SVG（属性是标准） | 扁平对象用属性 |

### 2.4 与 XML 转 JSON 的对应关系

JSON → XML → JSON 的往返转换中，属性 vs 子元素的选择需保持一致：

- JSON → XML 启用"扁平对象用属性" → XML → JSON 必须启用 `@` 前缀（否则属性与子元素冲突）
- JSON → XML 全子元素 → XML → JSON 任意策略均可

## 三、数组的转换与命名

### 3.1 JSON 数组的多元素展开

JSON 数组在 XML 中展开为多个同名元素：

```json
{ "tags": ["前端", "工具"] }
```

转为：

```xml
<tags>
  <item>前端</item>
  <item>工具</item>
</tags>
```

数组项的标签名由"数组项名"选项控制（默认 `item`），可改为更具语义的名称：

- `"item"` → 通用列表项
- `"tag"` → 标签列表
- `"li"` → HTML 列表项语义
- `"entry"` → Atom Feed 标准

### 3.2 嵌套对象的数组

```json
{
  "users": [
    { "name": "Aether", "age": 18 },
    { "name": "Luna", "age": 20 }
  ]
}
```

转为：

```xml
<users>
  <item>
    <name>Aether</name>
    <age>18</age>
  </item>
  <item>
    <name>Luna</name>
    <age>20</age>
  </item>
</users>
```

若将数组项名改为 `user`：

```xml
<users>
  <user>
    <name>Aether</name>
    <age>18</age>
  </user>
  <user>...</user>
</users>
```

### 3.3 决策清单

- 通用列表 → 默认 `item`
- 业务语义列表 → 改为单数形式（`tag` / `user` / `entry`）
- Atom/RSS Feed → `entry`（Atom 标准）
- SOAP 响应 → 业务语义单数形式

## 四、CDATA 与字符转义

### 4.1 XML 特殊字符处理

XML 文本节点中出现 `<`、`>`、`&` 必须处理：

| 字符 | 字符转义 | CDATA 包裹 |
| --- | --- | --- |
| `<` | `&lt;` | `<![CDATA[<]]>` |
| `>` | `&gt;` | `<![CDATA[>]]>` |
| `&` | `&amp;` | `<![CDATA[&]]>` |
| `"`（属性中） | `&quot;` | 不适用（属性不能用 CDATA） |
| `'`（属性中） | `&apos;` | 不适用 |

### 4.2 两种处理方式的取舍

| 方式 | 优点 | 缺点 | 适用场景 |
| --- | --- | --- | --- |
| 字符转义（默认） | 通用、兼容性最好 | 长文本可读性差 | 通用场景 |
| CDATA 包裹 | 内容原样保留，可读性好 | 不适用于属性 | HTML 片段、代码、正则、长文本 |

[本站 JSON 转 XML 工具](/json-to-xml) 提供"特殊字符用 CDATA"选项，启用后含 `<`、`>`、`&` 的文本会自动用 CDATA 包裹。

### 4.3 CDATA 边界冲突处理

CDATA 内部不能直接出现 `]]>`，否则会提前结束 CDATA。工具会自动拆分：

```json
{ "content": "a]]>b" }
```

转 XML：

```xml
<content><![CDATA[a]]]]><![CDATA[>b]]></content>
```

或更优雅的拆分：

```xml
<content><![CDATA[a]]]]><![CDATA[>b]]></content>
```

实际实现中，工具会拆分为多段 CDATA，避免 `]]>` 出现在 CDATA 内部。

### 4.4 决策清单

- 通用数据交换 → 字符转义
- 含 HTML / 代码 / 正则的文本 → CDATA 包裹
- 输出需可读（如配置文件、文档型 XML） → CDATA 包裹
- 属性值 → 必须字符转义（CDATA 不适用）

## 五、null 与空值表达

### 5.1 JSON null 的 XML 表示

JSON 的 `null` 在 XML 中有四种表示方式：

| 策略 | 输出 | 优点 | 缺点 | 适用场景 |
| --- | --- | --- | --- | --- |
| 空元素（默认） | `<note/>` | 简洁，符合 XML 习惯 | 与空字符串混淆 | 通用场景 |
| 显式 nil 属性 | `<note xsi:nil="true"/>` | 明确表示 null，与 XSD 标准一致 | 需声明 xsi 命名空间 | SOAP / XSD 场景 |
| 省略字段 | （不输出该元素） | 简化输出 | 字段缺失，下游无法区分 null 与未设置 | 简化场景 |
| 空字符串 | `<note></note>` | 与空字符串混淆 | 语义错误 | 不推荐 |

### 5.2 空数组的处理

JSON 空数组 `[]` 在 XML 中没有标准表示：

- 输出空元素 `<tags/>`（默认）
- 输出空容器 `<tags></tags>`
- 省略字段

[本站 JSON 转 XML 工具](/json-to-xml) 默认输出空元素 `<tags/>`，符合 XML 习惯。

### 5.3 决策清单

- 通用场景 → 空元素表示 null
- SOAP / XSD 场景 → `xsi:nil="true"` 显式表示
- 需区分 null 与未设置 → 显式 nil 属性 + 字段必输出
- 空数组 → 空元素

## 六、well-formed 校验

### 6.1 well-formed 的五条规则

XML 文档必须满足以下五条 well-formed 规则：

1. **单一根元素**：必须有且仅有一个根元素
2. **标签闭合**：所有标签必须闭合（`<a>` 必须有 `</a>` 或自闭合 `<a/>`）
3. **标签嵌套正确**：标签不能交叉嵌套（`<a><b></a></b>` 错误）
4. **属性值带引号**：属性值必须用单引号或双引号包裹
5. **特殊字符转义**：`<`、`>`、`&` 必须转义或 CDATA 包裹

### 6.2 工具的校验逻辑

[本站 JSON 转 XML 工具](/json-to-xml) 在转换时执行以下校验：

- 标签名修正后是否符合 XML 命名规则
- 属性值是否正确转义
- 文本节点是否正确转义或 CDATA 包裹
- 数组项名是否符合 XML 命名规则
- 根节点名是否符合 XML 命名规则

转换完成后输出校验报告，标记所有 warning（自动修正但需用户确认）。

### 6.3 校验失败的处理

- 标签名无法修正 → 退化使用数组项名 + 警告提示
- 标签名以 `xml` 开头 → 加下划线前缀 + 警告提示
- 属性值含特殊字符 → 自动转义
- 文本节点含特殊字符 → 按配置转义或 CDATA

## 七、典型 JSON 类型实战

### 7.1 SOAP 请求生成

```json
{
  "soap:Envelope": {
    "@xmlns:soap": "http://schemas.xmlsoap.org/soap/envelope/",
    "soap:Body": {
      "m:GetStockPrice": {
        "@xmlns:m": "http://example.org/stock",
        "m:StockName": "IBM"
      }
    }
  }
}
```

推荐配置：保留命名空间 + 默认全子元素（属性需用 `@` 前缀）

```xml
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <m:GetStockPrice xmlns:m="http://example.org/stock">
      <m:StockName>IBM</m:StockName>
    </m:GetStockPrice>
  </soap:Body>
</soap:Envelope>
```

### 7.2 SVG 图形生成

```json
{
  "svg": {
    "@xmlns": "http://www.w3.org/2000/svg",
    "@width": 100,
    "@height": 100,
    "circle": {
      "@cx": 50, "@cy": 50, "@r": 40, "@fill": "red"
    }
  }
}
```

推荐配置：扁平对象用属性（圆的属性自然转为 SVG 属性）

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
  <circle cx="50" cy="50" r="40" fill="red"/>
</svg>
```

### 7.3 Office 文档片段生成

Office Open XML 标准包含大量命名空间与属性，推荐配置：保留命名空间 + 扁平对象用属性。

### 7.4 Android 资源生成

```json
{
  "resources": {
    "string": [
      { "@name": "app_name", "#text": "工具盒子" },
      { "@name": "hello", "#text": "你好" }
    ]
  }
}
```

推荐配置：扁平对象用属性 + 数组项名 `string`

```xml
<resources>
  <string name="app_name">工具盒子</string>
  <string name="hello">你好</string>
</resources>
```

## 八、与 XML 转 JSON 的对偶关系

### 8.1 JSON → XML → JSON 的往返转换

理想的往返转换应保证 JSON 数据无损还原，但实际上由于约束不对称，存在以下不可逆性：

1. **标签名修正**：`a@b` → `a_b` → `a_b`，无法还原
2. **属性 vs 子元素**：扁平对象用属性 → XML → JSON 必须启用 `@` 前缀才能还原
3. **CDATA vs 字符转义**：CDATA 与字符转义在 XML → JSON 时均合并为文本，无法区分
4. **null 表达**：空元素 `<note/>` → JSON `null` 或 `""`，取决于 XML → JSON 的空元素处理策略
5. **数组项名**：JSON 数组展开为多个 `<item>` → XML → JSON 时，`item` 是数组而非单元素

### 8.2 保证可逆的配置组合

| 配置项 | JSON → XML | XML → JSON | 可逆性 |
| --- | --- | --- | --- |
| 属性 vs 子元素 | 全子元素 | 任意 | ✅ 可逆 |
| 属性 vs 子元素 | 扁平对象用属性 | 启用 `@` 前缀 | ✅ 可逆 |
| 标签名 | 无修正 | 无修正 | ✅ 可逆 |
| 标签名 | 有修正 | - | ❌ 不可逆 |
| CDATA | 字符转义 | 任意 | ✅ 可逆 |
| CDATA | CDATA 包裹 | 合并模式 | ✅ 可逆（语义） |
| null | 空元素 | 空元素 → null | ✅ 可逆 |
| null | `xsi:nil="true"` | 启用 `@` 前缀 | ✅ 可逆 |
| 数组项名 | 业务语义单数 | "子元素始终为数组" | ✅ 可逆 |

### 8.3 决策清单

- 需往返转换 → 全子元素 + 字符转义 + null 用空元素 + 数组项名单数形式
- 仅 JSON → XML → 业务消费 → 任意配置，可读性优先
- 仅 XML → JSON → 业务消费 → 任意配置，可读性优先

## 九、与 JSON 转 XML 工具的协同工作流

### 9.1 工作流 1：SOAP 请求构造

1. 在 [JSON 格式化工具](/json) 编写 SOAP 请求的 JSON 结构
2. 在 [JSON 转 XML 工具](/json-to-xml) 转换为 XML
3. 配置：保留命名空间 + 扁平对象用属性
4. 复制 XML 结果用于 SOAP 客户端
5. 收到 SOAP 响应后，在 [XML 转 JSON 工具](/xml-to-json) 转回 JSON

### 9.2 工作流 2：SVG 图形生成

1. 在 [JSON 转 XML 工具](/json-to-xml) 编写 SVG 的 JSON 结构
2. 配置：扁平对象用属性
3. 复制 XML 结果保存为 .svg 文件
4. 在浏览器中打开 SVG 验证图形

### 9.3 工作流 3：Android 资源生成

1. 在 [JSON 格式化工具](/json) 编写 Android 资源的 JSON 结构
2. 在 [JSON 转 XML 工具](/json-to-xml) 转换为 XML
3. 配置：扁平对象用属性 + 数组项名 `string`
4. 复制 XML 结果保存为 strings.xml

## 十、最佳实践清单

1. **JSON key 含非法字符** → 评估修正后的可读性，必要时先用 [Slug 工具](/slug) 生成合法 key
2. **元数据对象（id、version）** → 启用"扁平对象用属性"
3. **嵌套数据对象** → 默认全子元素
4. **SOAP / SVG / Android 资源** → 启用"扁平对象用属性"（属性是这些场景的标准）
5. **含 HTML / 代码 / 正则的文本** → 启用"特殊字符用 CDATA"
6. **通用数据交换** → 字符转义
7. **null 表示** → 通用场景用空元素，SOAP / XSD 场景用 `xsi:nil="true"`
8. **数组项名** → 通用列表 `item`，业务语义列表用单数形式
9. **需往返转换** → 全子元素 + 字符转义 + null 空元素 + 数组项名单数形式
10. **well-formed 校验** → 转换后查看警告区，确认所有修正符合预期

## 总结

JSON 转 XML 的核心难点是"约束不对称"：JSON key 几乎无限制，XML 标签名有严格规则。工具的标签名修正策略、属性 vs 子元素选择、CDATA 与字符转义切换、null 表达策略都是在多个候选方案中做取舍。

[本站 JSON 转 XML 工具](/json-to-xml) 内置上述所有配置选项，可根据场景灵活切换。配合 [XML 转 JSON 工具](/xml-to-json)、[JSON 格式化工具](/json)、[JSONPath 查询工具](/jsonpath)，可形成完整的"JSON → XML → 解析 → 提取"双向工作流，覆盖绝大多数 JSON 与 XML 互转场景。

理解"反向操作的不可逆性"是工程化 JSON ↔ XML 互转的关键。在需要往返转换的场景下，应选择保证可逆的配置组合（全子元素 + 字符转义 + null 空元素 + 数组项名单数形式），避免数据丢失。在单向转换场景下，可读性与可维护性优先于可逆性。
