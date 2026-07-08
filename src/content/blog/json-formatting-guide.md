---
title: "JSON 格式化与校验实践：从语法错误到性能优化的完整指南"
description: "系统讲解 JSON 的语法规则、JavaScript 中 JSON.parse/stringify 的高级用法、常见错误定位、转义与压缩技巧，以及生产环境中的性能优化策略。"
pubDate: 2026-07-03
tags: ["JSON", "JavaScript", "数据格式", "调试"]
relatedTool: "/json"
---

## JSON 是什么

**JSON**（JavaScript Object Notation）是一种轻量级的数据交换格式。它源于 JavaScript 的对象字面量语法，但已成为语言无关的标准，被几乎所有现代编程语言支持。

JSON 的流行源于三个特点：

1. **人类可读**：纯文本，结构清晰
2. **机器友好**：解析速度快，体积小
3. **语言无关**：与 JavaScript 无强绑定，跨语言通用

## JSON 的语法规则

JSON 只有 6 种数据类型：**对象、数组、字符串、数字、布尔、null**。理解语法规则是避免错误的基础：

```json
{
  "name": "工具盒子",
  "version": 1.0,
  "active": true,
  "tags": ["json", "base64", "uuid"],
  "config": null,
  "nested": {
    "key": "值可以包含中文"
  }
}
```

### 容易踩的 5 个语法陷阱

1. **键名必须用双引号**：`{name: "张三"}` 非法，必须是 `{"name": "张三"}`
2. **字符串只能用双引号**：`'hello'` 非法，必须是 `"hello"`
3. **不能有尾逗号**：`{"a": 1,}` 非法，最后一个键后不能有逗号
4. **数字格式严格**：不支持前导零（`007`）、不支持十六进制（`0xFF`）、不支持 NaN/Infinity
5. **注释不被允许**：`//` 和 `/* */` 都是非法的（尽管某些扩展如 JSON5 支持）

## JavaScript 中的 JSON 处理

### JSON.parse：字符串转对象

```javascript
const json = '{"name":"张三","age":30}';
const obj = JSON.parse(json);
console.log(obj.name); // "张三"
```

**带 reviver 函数**：可以在解析时对值进行转换

```javascript
const json = '{"date":"2026-07-03","count":"100"}';
const obj = JSON.parse(json, (key, value) => {
  if (key === 'count') return Number(value);
  return value;
});
// obj.count 现在是数字 100，而非字符串 "100"
```

### JSON.stringify：对象转字符串

```javascript
const obj = { name: '张三', age: 30 };
const json = JSON.stringify(obj);
// '{"name":"张三","age":30}'
```

**格式化输出**：第三个参数控制缩进

```javascript
JSON.stringify(obj, null, 2);
// 输出带 2 空格缩进的美化格式
```

**replacer 过滤**：第二个参数可控制输出哪些字段

```javascript
const obj = { name: '张三', password: 'secret', age: 30 };
// 只输出 name 和 age
const safe = JSON.stringify(obj, ['name', 'age'], 2);
// 过滤掉敏感字段
```

## JSON.parse 的常见错误与定位

`JSON.parse` 抛出的错误信息通常包含位置，但不同浏览器格式不一。典型的错误信息：

```
SyntaxError: Unexpected token 'n' at position 12
SyntaxError: Expected property name or '}' in JSON at position 5
```

### 定位错误的实用技巧

**技巧一：根据 position 提取上下文**

```javascript
function locateJsonError(jsonStr, position) {
  const start = Math.max(0, position - 20);
  const end = Math.min(jsonStr.length, position + 20);
  const context = jsonStr.slice(start, end);
  const offset = position - start;
  // 用 ^ 标记错误位置
  return `${context}\n${' '.repeat(offset)}^`;
}

try {
  JSON.parse(badJson);
} catch (e) {
  const pos = extractPosition(e.message);
  console.log(locateJsonError(badJson, pos));
}
```

**技巧二：常见错误模式速查**

| 错误信息 | 可能原因 |
|----------|----------|
| Unexpected token `'` | 使用了单引号 |
| Unexpected token `n` | 写了 `NaN` 或未加引号的 `null` 变体 |
| Unexpected end of JSON | 字符串被截断，引号未闭合 |
| Expected property name | 键名未加引号 |
| Unexpected token `,` | 多余的尾逗号 |

### 安全解析：避免抛异常

```javascript
function safeParse(jsonStr) {
  try {
    return { ok: true, value: JSON.parse(jsonStr) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

const result = safeParse(maybeBadJson);
if (result.ok) {
  console.log(result.value);
} else {
  console.error('解析失败:', result.error);
}
```

这种模式比 try-catch 嵌套更清晰，适合函数式编程。

## JSON 转义与去转义

当你需要把一段 JSON 作为字符串嵌入到另一段 JSON 中时，必须对内部的双引号等特殊字符进行转义。

### 转义的原理

JSON 字符串中，以下字符必须转义：

| 字符 | 转义后 | 说明 |
|------|--------|------|
| `"` | `\"` | 双引号 |
| `\` | `\\` | 反斜杠 |
| 换行 | `\n` | 换行符 |
| 回车 | `\r` | 回车符 |
| Tab | `\t` | 制表符 |
| 退格 | `\b` | 退格符 |
| 换页 | `\f` | 换页符 |
| 其他控制字符 | `\uXXXX` | Unicode 转义 |

### 实际场景：嵌套 JSON

```javascript
const inner = { message: '包含"引号"的内容' };
const innerJson = JSON.stringify(inner);
// {"message":"包含\"引号\"的内容"}

const outer = {
  type: 'message',
  data: innerJson, // 内部 JSON 作为字符串嵌入
};
const outerJson = JSON.stringify(outer);
// 外层 JSON 中的 data 字段值是已转义的字符串
```

**手动去转义**：当你从某处拿到一段被多次转义的字符串时

```javascript
// 双重转义的字符串
const doubleEscaped = '{\\"name\\":\\"张三\\"}';
// 第一次 JSON.parse 去一层
const onceParsed = JSON.parse(doubleEscaped);
// 得到字符串 {"name":"张三"}
// 第二次 parse 得到对象
const obj = JSON.parse(onceParsed);
```

## JSON 压缩与性能

生产环境中，JSON 通常需要压缩以减少传输体积：

```javascript
// 压缩：移除所有空白
const minified = JSON.stringify(obj);
// 默认就是压缩的，无缩进

// 格式化：便于调试
const pretty = JSON.stringify(obj, null, 2);
```

### 压缩带来的收益

- 移除缩进与换行，体积通常减少 20%-40%
- 对大对象效果更明显
- 配合 Gzip/Brotli 传输压缩，效果叠加

### 大型 JSON 的性能建议

1. **避免频繁序列化**：`JSON.stringify` 是同步阻塞操作，大对象会卡主线程
2. **考虑结构化克隆**：浏览器支持的 `structuredClone` 对循环引用更友好
3. **流式解析**：超大数据（>10MB）考虑用 [JSONStream](https://github.com/dominictarr/JSONStream) 等流式解析库
4. **Web Worker**：将 JSON 解析放到 Worker 中，避免 UI 卡顿

## 常见陷阱总结

### 1. 循环引用导致 stringify 崩溃

```javascript
const a = { name: 'a' };
const b = { name: 'b' };
a.ref = b;
b.ref = a; // 循环引用

JSON.stringify(a); // TypeError: Converting circular structure to JSON
```

**解决**：使用 [flatted](https://github.com/indutny/flatted) 库，或在 replacer 中过滤：

```javascript
const seen = new WeakSet();
JSON.stringify(a, (key, value) => {
  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
  }
  return value;
});
```

### 2. 键的顺序不保证

JSON 规范未规定对象键的顺序，但 `JSON.parse` 保留插入顺序（ES2015+）。然而依赖顺序是反模式，应使用数组。

### 3. 数字精度丢失

```javascript
JSON.parse('{"id": 12345678901234567890}');
// { id: 12345678901234568000 } —— 精度丢失！
```

**解决**：大数字应作为字符串传输：

```json
{ "id": "12345678901234567890" }
```

### 4. Date 对象不是 JSON 类型

```javascript
const obj = { date: new Date() };
JSON.stringify(obj);
// {"date":"2026-07-03T00:00:00.000Z"} —— 变成字符串了

JSON.parse('{"date":"2026-07-03T00:00:00.000Z"}');
// { date: "2026-07-03T..." } —— 不会自动还原为 Date 对象
```

**解决**：用 reviver 还原：

```javascript
JSON.parse(json, (key, value) => {
  if (key === 'date') return new Date(value);
  return value;
});
```

## 总结

- JSON 语法严格，键名和字符串必须用双引号，不能有尾逗号和注释
- `JSON.parse` 的 reviver 和 `JSON.stringify` 的 replacer 是两个被低估的强大参数
- 错误定位时关注 `position`，提取上下文能快速发现问题
- 大数字用字符串、Date 用 reviver、循环引用要处理
- 生产环境压缩，调试环境格式化

想要快速格式化、校验、压缩你的 JSON？试试我们的 [JSON 在线工具](/json)，支持中文友好的错误定位（行号、列号），所有数据在浏览器本地处理，零上传零追踪。
