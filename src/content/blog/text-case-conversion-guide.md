---
title: "命名风格转换指南：驼峰、下划线、短横线等 10 种大小写格式互转"
description: "系统讲解编程中常见的 10 种命名风格：驼峰命名、帕斯卡命名、下划线命名、短横线命名等格式的定义、适用场景与转换方法。深入分析智能分词的边界识别原理，帮助你在不同语言的命名规范间快速切换。"
pubDate: 2026-07-11
tags: ["命名转换", "驼峰命名", "下划线命名", "短横线命名", "大小写转换", "工具矩阵"]
relatedTool: "/text-case"
---

## 命名风格：编程世界的"方言"

不同编程语言有不同的命名习惯，就像不同地区有不同的方言。一个变量名在 JavaScript 中叫 `myUserName`，到了 Python 就变成 `my_user_name`，在 CSS 中又成了 `my-user-name`。

掌握这些命名风格的转换，是跨语言开发的必备技能。本文将系统讲解 10 种常见的大小写格式及其转换原理。

> 配套工具：[文本大小写转换工具](/text-case)

## 一、10 种命名风格详解

### 1.1 基础大小写格式

| 格式 | 示例 | 说明 |
|------|------|------|
| 全大写 | UPPER CASE | 所有字母大写，常用于常量、枚举值 |
| 全小写 | lower case | 所有字母小写，常用于普通文本 |
| 首字母大写 | Title Case | 每个单词首字母大写，常用于标题 |
| 句子首字母大写 | Sentence case | 仅句子首字母大写，常用于正文 |
| 反转大小写 | sWAP cASE | 大写变小写、小写变大写 |

### 1.2 编程命名风格

| 格式 | 示例 | 别名 | 典型语言 |
|------|------|------|----------|
| 驼峰命名 | camelCase | 小驼峰 | JavaScript、Java 方法名 |
| 帕斯卡命名 | PascalCase | 大驼峰 | 类名、React 组件、TypeScript 接口 |
| 下划线命名 | snake_case | 蛇形命名 | Python、Ruby、Rust、数据库字段 |
| 短横线命名 | kebab-case | 烤串命名 | CSS 类名、URL 路径、HTML id |
| 句点分隔 | dot.case | 点分隔 | 配置文件键名、命名空间 |

## 二、各命名风格的适用场景

### 2.1 驼峰命名（camelCase）

```javascript
// JavaScript 变量、函数
const userName = '张三';
function getUserInfo() { ... }

// Java 方法名
public void setUserName() { ... }
```

**特点**：首单词小写，后续单词首字母大写。紧凑、可读性好，是 JavaScript 和 Java 的主流命名风格。

### 2.2 帕斯卡命名（PascalCase）

```typescript
// TypeScript 接口、React 组件
interface UserProfile { ... }
function UserCard() { ... }

// Java、C# 类名
class UserService { ... }
```

**特点**：每个单词首字母都大写。用于类型定义、类名等"构造器"场景，与变量名形成视觉区分。

### 2.3 下划线命名（snake_case）

```python
# Python 变量、函数
user_name = '张三'
def get_user_info(): ...

# SQL 字段名
SELECT user_id, user_name FROM users;
```

**特点**：单词间用下划线连接，全部小写。Python、Ruby 的主流风格，数据库字段的通用标准。

### 2.4 短横线命名（kebab-case）

```css
/* CSS 类名 */
.user-card { ... }
.user-card-title { ... }
```

```html
<!-- HTML id、URL 路径 -->
<div id="user-card"></div>
<!-- /api/user-profile/settings -->
```

**特点**：单词间用短横线连接。CSS、HTML 的标准命名风格，URL 中最友好的分隔符（下划线在 URL 中可能被搜索引擎忽略）。

## 三、智能分词：命名转换的核心

### 3.1 为什么需要分词

命名风格转换的本质是"拆分单词 → 重新组装"。无论输入是 `camelCase`、`snake_case` 还是 `kebab-case`，都需要先拆分成单词数组 `['camel', 'case']` 或 `['snake', 'case']`，再按目标格式重组。

### 3.2 边界识别策略

[文本大小写转换工具](/text-case)采用三步分词策略：

**步骤 1：按非字母数字字符分割**

```
"snake_case" → ["snake", "case"]
"kebab-case" → ["kebab", "case"]
"dot.case"   → ["dot", "case"]
"hello world" → ["hello", "world"]
```

**步骤 2：按大小写转换边界分割**

```
"camelCase"     → ["camel", "Case"]     → 小写 → ["camel", "case"]
"PascalCase"    → ["Pascal", "Case"]    → 小写 → ["pascal", "case"]
```

**步骤 3：连续大写字母作为一个单词**

```
"HTTPRequest"   → ["HTTP", "Request"]   → 小写 → ["http", "request"]
"parseURL"      → ["parse", "URL"]      → 小写 → ["parse", "url"]
```

### 3.3 正则表达式实现

核心分词逻辑用两个正则替换实现：

```javascript
// 连续大写字母后跟大写+小写时，在边界插入分隔符
"HTTPRequest".replace(/([A-Z]+)([A-Z][a-z])/g, '$1\0$2')
// → "HTTP\0Request"

// 小写/数字后跟大写时，在边界插入分隔符
"camelCase".replace(/([a-z0-9])([A-Z])/g, '$1\0$2')
// → "camel\0Case"
```

这两个正则覆盖了驼峰命名中的所有边界情况，包括缩写词（HTTP、URL、ID）与普通单词的混合。

## 四、转换规则与重组

### 4.1 重组为各格式

分词得到 `['hello', 'world', 'example']` 后，按目标格式重组：

```
camelCase:  hello + World + Example → helloWorldExample
PascalCase: Hello + World + Example → HelloWorldExample
snake_case: hello_world_example
kebab-case: hello-world-example
dot.case:   hello.world.example
```

### 4.2 首字母大写的特殊处理

Title Case 和 Sentence case 不经过分词，直接对原文做字符级处理：

```javascript
// Title Case：每个单词首字母大写
"hello world".replace(/\b\w/g, ch => ch.toUpperCase())
// → "Hello World"

// Sentence case：每个句子首字母大写
"hello world. foo bar.".toLowerCase()
  .replace(/(^\s*\w|[.!?]\s*\w)/g, ch => ch.toUpperCase())
// → "Hello world. Foo bar."
```

注意 `\b`（单词边界）在处理中文等非 ASCII 字符时可能不符合预期，但编程命名场景几乎全是 ASCII 字符。

## 五、实践建议

### 5.1 团队规范统一

不同语言的命名风格是约定俗成的，团队开发时应遵循语言社区的主流规范：

- **JavaScript/TypeScript**：变量用 camelCase，类型/接口用 PascalCase
- **Python**：变量和函数用 snake_case，类名用 PascalCase
- **CSS**：类名用 kebab-case
- **数据库**：表名和字段名用 snake_case

### 5.2 跨语言数据转换

API 响应的字段名可能与前端使用的命名风格不一致。例如后端返回 `user_name`（snake_case），前端需要 `userName`（camelCase）。使用 [文本大小写转换工具](/text-case) 可以快速完成这种转换。

### 5.3 URL 友好性

URL 中推荐使用 kebab-case 而非 snake_case，因为搜索引擎会将短横线视为单词分隔符，而下划线可能被忽略：

```
推荐：/api/user-profile/settings
不推荐：/api/user_profile/settings
```

## 六、总结

命名风格转换看似简单，但要做到准确分词需要注意边界情况：

1. **智能分词**是核心：先拆分单词，再重组格式
2. **大小写边界**识别：处理 camelCase → snake_case 的关键
3. **连续大写**处理：HTTPRequest → HTTP + Request
4. **语言规范**：遵循各语言社区的命名约定
5. **URL 友好**：URL 中优先使用 kebab-case

需要快速转换命名风格时，可以使用 [文本大小写转换工具](/text-case)，支持 10 种格式实时互转。
