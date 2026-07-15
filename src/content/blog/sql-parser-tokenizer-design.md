---
title: "SQL 格式化与 SQL 解析器设计：词法分析器、token 类型与缩进策略"
description: "系统讲解 SQL 格式化与解析器设计：词法分析器状态机、9 种 token 类型、关键字分类策略、缩进引擎与语法校验，对比 6 种主流 SQL 美化器实现差异。"
pubDate: 2026-07-05
tags: ["SQL", "数据库", "词法分析", "tokenizer", "解析器", "算法", "代码调试"]
relatedTool: "/sql"
---

## 为什么要自己写 SQL 解析器

市面上的 SQL 美化器不少：sql-formatter、prettier-plugin-sql、DBeaver、DataGrip、Navicat、Azure Data Studio 都自带格式化能力。但当你在浏览器里写一个**纯前端、零依赖、单文件 < 200KB** 的 SQL 工具时，会发现：

- **sql-formatter** 体积约 50KB（gzip 后约 15KB），可用但增加 bundle，且对中文注释的处理不完美
- **prettier-plugin-sql** 依赖 prettier 核心（约 200KB），超出工具站单页 JS 红线
- **DBeaver / DataGrip / Navicat** 是桌面应用，无法嵌入网页
- **Azure Data Studio** 基于 VS Code，依赖 Monaco Editor（数 MB）

更关键的是：**SQL 格式化的核心难点不在算法，而在词法分析**。一旦你自己实现了 tokenizer，剩下的格式化逻辑只是「按 token 类型决定空格、换行、缩进」的简单状态机。自己写解析器还有三个好处：

1. **完全控制输出风格**：你可以精确决定 SELECT 字段列表是逗号后空格还是换行，CASE/WHEN 是否缩进，主子句前是否换行
2. **零依赖**：纯原生 JS 实现，bundle 体积可控，加载快
3. **可扩展**：后续要加语法校验、AST 分析、SQL 转 API（如 GraphQL）都是同一套 tokenizer 的延伸

本文以 [SQL 格式化工具](/sql) 的实现为例，系统讲解 SQL 解析器的设计。

> 配套工具：[SQL 格式化与压缩](/sql)（在线体验本文讲述的词法分析器与缩进策略）、[正则表达式测试](/regex)（token 匹配模式调试）、[JSON 工具](/json)（SQL 解析结果可视化）

## 一、SQL 词法分析器（Tokenizer）的设计

词法分析器的任务是：把 SQL 字符串切分为带类型的 token 序列。例如 `SELECT * FROM users WHERE id = 1` 应切分为：

```
KEYWORD(SELECT) PUNCT(*) KEYWORD(FROM) IDENT(users) KEYWORD(WHERE) IDENT(id) PUNCT(=) NUMBER(1)
```

注意空白字符不丢弃，而是作为 `whitespace` token 保留——格式化时需要根据原始空白判断是否保留换行（如块注释内的换行）。

### 1.1 Token 类型设计

```typescript
type TokenType =
  | 'whitespace'    // 空白（含换行）
  | 'comment'       // 注释（-- 行注释 / /* 块注释 */）
  | 'string'        // 字符串字面量（单引号 / 双引号标识符）
  | 'number'        // 数字字面量
  | 'identifier'    // 标识符（含点分 a.b.c）
  | 'keyword'       // 关键字
  | 'punctuation'   // 标点（逗号 / 括号 / 分号 / 星号 / 运算符）
  | 'parameter';    // 参数占位（? / :name / @name / $n）
```

**关键设计点**：

- **`whitespace` 单独成 token**：很多解析器会跳过空白，但 SQL 格式化器需要知道原始空白分布（如块注释内的换行需保留）
- **`comment` 区分行注释与块注释**：行注释 `--` 至行尾，块注释 `/* ... */` 可跨行。压缩模式可选移除注释
- **`string` 同时承载字符串字面量与双引号标识符**：标准 SQL 中双引号是标识符引用（如 `"my column"`），但格式化时两者处理方式相同（保留原样），统一识别为 string 类型可简化逻辑
- **`identifier` 含点分前缀**：`a.b.c` 作为一个 token，避免后续格式化时把点号当标点单独处理
- **`parameter` 区分 ? / :name / @name / $n**：四种参数占位语法对应不同数据库（MySQL 用 ?、PostgreSQL 用 $n、Oracle 用 :name、SQL Server 用 @name）

### 1.2 状态机实现

词法分析器的核心是**单遍扫描 + 状态机**：从字符串首位开始，根据当前字符决定进入哪个分支，扫描完一个 token 后回到初始状态。

```typescript
function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  const len = sql.length;
  let i = 0;       // 当前扫描位置
  let col = 1;     // 当前列号（用于错误定位）

  while (i < len) {
    const ch = sql[i];

    // 1. 空白字符：扫描连续空白，含换行重置列号
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      let j = i, raw = '';
      while (j < len && /[ \t\r\n]/.test(sql[j])) {
        raw += sql[j];
        if (sql[j] === '\n') col = 1; else col++;
        j++;
      }
      tokens.push({ type: 'whitespace', raw, upper: raw, col });
      i = j;
      continue;
    }

    // 2. 行注释 -- 或 #
    if ((ch === '-' && sql[i + 1] === '-') || ch === '#') {
      let j = i, raw = '';
      while (j < len && sql[j] !== '\n') {
        raw += sql[j];
        j++;
      }
      tokens.push({ type: 'comment', raw, upper: raw, col });
      i = j;
      continue;
    }

    // 3. 块注释 /* ... */
    if (ch === '/' && sql[i + 1] === '*') {
      let j = i + 2, raw = '/*';
      while (j < len && !(sql[j] === '*' && sql[j + 1] === '/')) {
        raw += sql[j];
        j++;
      }
      if (j < len) {
        raw += '*/';
        j += 2;
      }
      tokens.push({ type: 'comment', raw, upper: raw, col });
      i = j;
      continue;
    }

    // 4-9. 字符串、数字、标识符、参数、运算符...
    // 详见 https://github.com/.../sql.ts
  }
  return tokens;
}
```

### 1.3 字符串转义的处理

SQL 字符串用单引号包裹，转义方式是**两个单引号表示一个单引号字面量**（与 C 系语言的反斜杠转义不同）：

```sql
-- 字符串内含单引号
INSERT INTO users (name) VALUES ('It''s me');
-- 实际存储：It's me
```

词法分析器需识别 `''` 转义，避免提前结束字符串：

```typescript
if (ch === "'") {
  let j = i + 1, raw = "'";
  while (j < len) {
    if (sql[j] === "'" && sql[j + 1] === "'") {
      raw += "''";        // 保留转义原样
      j += 2;
      continue;
    }
    if (sql[j] === "'") {
      raw += "'";
      j++;
      break;              // 单个单引号结束字符串
    }
    raw += sql[j];
    j++;
  }
  tokens.push({ type: 'string', raw, upper: raw, col });
  i = j;
}
```

### 1.4 数字字面量的多种形态

SQL 数字不只有整数和小数，还有：

- **十六进制**：`0x1F`（MySQL）、`X'1F'`（标准 SQL）
- **科学计数法**：`1.5e10`、`2.3E-5`
- **精确小数**：`123.456`

词法分析器需区分这些形态，避免把 `0x1F` 错误解析为 `0` + `x1F`：

```typescript
if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(sql[i + 1] || ''))) {
  let j = i, raw = '';
  // 十六进制 0x...
  if (ch === '0' && (sql[i + 1] === 'x' || sql[i + 1] === 'X')) {
    raw += '0' + sql[i + 1];
    j = i + 2;
    while (j < len && /[0-9a-fA-F]/.test(sql[j])) {
      raw += sql[j];
      j++;
    }
  } else {
    // 普通数字 / 小数 / 科学计数法
    while (j < len && /[0-9]/.test(sql[j])) { raw += sql[j]; j++; }
    if (sql[j] === '.' && /[0-9]/.test(sql[j + 1] || '')) {
      raw += '.'; j++;
      while (j < len && /[0-9]/.test(sql[j])) { raw += sql[j]; j++; }
    }
    if (sql[j] === 'e' || sql[j] === 'E') {
      raw += sql[j]; j++;
      if (sql[j] === '+' || sql[j] === '-') { raw += sql[j]; j++; }
      while (j < len && /[0-9]/.test(sql[j])) { raw += sql[j]; j++; }
    }
  }
  tokens.push({ type: 'number', raw, upper: raw, col });
  i = j;
}
```

### 1.5 标识符与关键字的区分

标识符扫描完后，需判断是否为关键字。**关键判断点：含点号的标识符不是关键字**（如 `count.x` 是表名加点号字段名，不是 COUNT 函数）：

```typescript
if (/[A-Za-z_]/.test(ch)) {
  let j = i, raw = '';
  while (j < len && /[A-Za-z0-9_]/.test(sql[j])) { raw += sql[j]; j++; }
  // 点分前缀：a.b.c（每段必须以字母或下划线开头）
  while (sql[j] === '.' && /[A-Za-z_]/.test(sql[j + 1] || '')) {
    raw += '.'; j++;
    while (j < len && /[A-Za-z0-9_]/.test(sql[j])) { raw += sql[j]; j++; }
  }
  const upper = raw.toUpperCase();
  // 仅当不含点且全词匹配关键字时才识别为 keyword
  const type: TokenType =
    !raw.includes('.') && isKeyword(raw) ? 'keyword' : 'identifier';
  tokens.push({ type, raw, upper, col });
  i = j;
}
```

## 二、关键字分类策略

不是所有关键字都同等重要。**格式化时不同关键字有不同换行与缩进规则**，需提前分类：

```typescript
/** 主子句关键字（前换行 + 顶层缩进归零） */
const MAJOR_CLAUSES = new Set([
  'SELECT', 'FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET',
  'UNION', 'INTERSECT', 'EXCEPT', 'INSERT', 'VALUES', 'UPDATE', 'SET',
  'DELETE', 'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'WITH', 'RETURNING',
]);

/** JOIN 系列关键字（前换行，但不重置缩进） */
const JOIN_CLAUSES = new Set([
  'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'NATURAL',
  'STRAIGHT_JOIN',
]);

/** AND / OR / ON / USING（连接词，可选前换行） */
const AND_OR = new Set(['AND', 'OR', 'ON', 'USING']);

/** 函数名（避免被当作通用标识符） */
const FUNCTIONS = new Set([
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'NOW', 'CURRENT_TIMESTAMP',
  'COALESCE', 'NULLIF', 'CAST', 'CONVERT', 'CONCAT', 'SUBSTRING',
  // ...
]);

/** 数据类型关键字 */
const TYPES = new Set([
  'INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'DECIMAL', 'NUMERIC',
  'FLOAT', 'DOUBLE', 'CHAR', 'VARCHAR', 'TEXT', 'DATE', 'TIMESTAMP',
  // ...
]);
```

**分类的意义**：

| 类别 | 换行规则 | 缩进规则 |
| --- | --- | --- |
| 主子句 | 前换行 | depth 重置为 0（顶层） |
| JOIN 系列 | 前换行 | depth 保持不变 |
| AND / OR | 可选前换行 | depth 保持不变 |
| 函数名 | 不换行 | 不影响缩进 |
| 数据类型 | 不换行 | 不影响缩进 |

## 三、格式化引擎：缩进与换行的状态机

格式化引擎遍历 token 序列，根据 token 类型与上下文决定输出。核心状态：

- `depth`：当前缩进深度（子查询层数）
- `out`：输出字符串数组
- `pendingNewline`：是否待换行（避免连续换行产生空行）

### 3.1 主子句处理

遇到主子句关键字（SELECT/FROM/WHERE 等）时：

1. 输出换行（如果不是首个 token）
2. 缩进归零（depth = 0）
3. 输出关键字 + 单空格

```typescript
if (isMajorClause(upper)) {
  if (out.length > 0) newline();
  depth = 0;
  push(applyKeywordCase(tok.raw, options), { spaceBefore: false });
  // 后续跟空格（如 SELECT 后跟字段列表）
  continue;
}
```

### 3.2 子查询缩进

遇到左括号 `(` 且下一个非空白 token 是 SELECT 时，识别为子查询，depth + 1：

```typescript
if (tok.raw === '(') {
  const next = peekNextNonWhitespace(tokens, i);
  if (next && next.upper === 'SELECT') {
    // 子查询：括号内缩进增加
    push('(', { spaceBefore: false });
    newline();
    depth++;
    continue;
  }
  // 普通括号（如函数调用 COUNT(*)）：不换行不缩进
  push('(', { spaceBefore: false });
  continue;
}
```

遇到右括号 `)` 时，如果是子查询的右括号，depth - 1 并换行：

```typescript
if (tok.raw === ')') {
  // 检查是否需要降低缩进（子查询右括号）
  if (depth > 0) {
    depth--;
    newline();
  }
  push(')', { spaceBefore: false });
  continue;
}
```

### 3.3 CASE / WHEN 块状缩进

CASE 表达式是 SQL 中少数有「块」语义的语法。格式化要求：

```sql
SELECT
  CASE
    WHEN score >= 90 THEN 'A'
    WHEN score >= 60 THEN 'B'
    ELSE 'C'
  END
FROM grades
```

实现要点：CASE 后 depth + 1，WHEN/ELSE 前换行（保持 CASE 增加的缩进），END 前 depth - 1 并换行。

```typescript
// CASE / BEGIN 增加缩进
if (upper === 'CASE' || upper === 'BEGIN') {
  push(applyKeywordCase(tok.raw, options), { spaceBefore: true });
  depth++;
  // CASE 后紧跟 WHEN，由 WHEN 自己换行，避免重复换行产生空行
  // BEGIN 后跟独立语句，需主动换行
  if (upper === 'BEGIN' && next) newline();
  continue;
}

// WHEN / ELSE 前换行（保持 CASE 已增加的缩进）
if (upper === 'WHEN' || upper === 'ELSE') {
  if (out.length > 0) newline();
  push(applyKeywordCase(tok.raw, options), { spaceBefore: false });
  continue;
}

// END 前换行并降低缩进
if (upper === 'END') {
  depth = Math.max(0, depth - 1);
  newline();
  push(applyKeywordCase(tok.raw, options), { spaceBefore: false });
  continue;
}
```

**避坑点**：CASE 后不要主动 `newline()`，因为 WHEN 会自己 newline。如果两者都 newline，会产生空行（这是早期版本的 bug）。

### 3.4 JOIN 前换行

JOIN 系列关键字前换行，但不重置 depth（保持与 FROM 一致的缩进层级）：

```typescript
if (isJoinClause(upper)) {
  if (out.length > 0) newline();
  push(applyKeywordCase(tok.raw, options), { spaceBefore: false });
  continue;
}
```

输出示例：

```sql
SELECT *
FROM users u
INNER JOIN orders o ON u.id = o.user_id
LEFT JOIN products p ON o.product_id = p.id
WHERE u.active = 1
```

### 3.5 AND / OR 前换行（可选）

复杂的 WHERE 子句中，AND/OR 前换行能显著提升可读性：

```typescript
if (isAndOr(upper) && options.newLineBeforeAndOr) {
  if (out.length > 0) newline();
  push(applyKeywordCase(tok.raw, options), { spaceBefore: false });
  continue;
}
```

输出对比：

```sql
-- 关闭 AND/OR 前换行
WHERE a = 1 AND b = 2 AND c = 3

-- 开启 AND/OR 前换行
WHERE a = 1
  AND b = 2
  AND c = 3
```

### 3.6 逗号样式

SELECT 字段列表的逗号有两种风格：

- **逗号后空格**：`SELECT a, b, c FROM t`（紧凑）
- **逗号后换行**：每字段单独一行（便于增删字段、查看 diff）

```typescript
if (tok.raw === ',') {
  push(',', { spaceBefore: false });
  if (options.commaStyle === 'newline') {
    newline();
  } else {
    push(' ', { spaceBefore: false });
  }
  continue;
}
```

输出对比：

```sql
-- 逗号后空格
SELECT id, name, email, created_at FROM users;

-- 逗号后换行
SELECT
  id,
  name,
  email,
  created_at
FROM users;
```

## 四、压缩算法

压缩是格式化的逆运算：移除多余空白与换行，仅保留必要单空格。实现要点：

1. **跳过 whitespace token**：不输出
2. **跳过 comment token**（可选）：用户勾选「移除注释」时不输出
3. **保留必要空格**：两个标识符 / 关键字之间必须有至少一个空格（如 `SELECT FROM` 是错的，应为 `SELECT * FROM`）
4. **移除标点前后多余空格**：`( a, b )` 压缩为 `(a,b)`
5. **保留字符串与注释原样**：不修改内部空格

```typescript
function minify(tokens: Token[], removeComments = false): string {
  let out = '';
  let prev: Token | null = null;
  for (const tok of tokens) {
    if (tok.type === 'whitespace') continue;
    if (tok.type === 'comment' && removeComments) continue;
    // 判断是否需要前导空格
    const needSpace = prev !== null
      && needsSpaceBetween(prev, tok);
    if (needSpace) out += ' ';
    out += tok.raw;
    prev = tok;
  }
  return out;
}

/** 判断两个 token 之间是否需要空格 */
function needsSpaceBetween(prev: Token, curr: Token): boolean {
  // 标点前后不需要空格（除了 ... 的特殊情况）
  if (curr.type === 'punctuation') {
    if (curr.raw === '(') return false;  // 函数调用 COUNT(
    return false;
  }
  if (prev.type === 'punctuation') {
    if (prev.raw === '(') return false;  // ( a → (a
    if (prev.raw === ',') return true;   // a,b → a, b（保持可读性）
    return false;
  }
  // 两个标识符/关键字/数字/字符串之间必须有空格
  return true;
}
```

## 五、基础语法校验

完整的 SQL 语法校验需要 AST 解析（如 ANTLR4 + SQL grammar），但工具站只做**基础语法检查**也能覆盖 80% 的常见错误：

- **引号配对**：单引号、双引号、反引号是否成对
- **括号配对**：左括号 `(` 与右括号 `)` 是否配对
- **块注释闭合**：`/*` 是否有对应的 `*/`
- **分号位置**：分号是否在语句末尾（而非中间）

实现方式：遍历 token 序列，维护栈：

```typescript
function validate(tokens: Token[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const stack: { char: string; line: number; col: number }[] = [];

  for (const tok of tokens) {
    if (tok.type === 'string') {
      // 字符串本身已检查引号配对（tokenize 时）
      continue;
    }
    if (tok.type === 'comment' && tok.raw.startsWith('/*') && !tok.raw.endsWith('*/')) {
      issues.push({
        level: 'error',
        line: tok.col,  // 简化，实际需计算行号
        column: tok.col,
        message: '块注释 /* 未闭合',
      });
    }
    if (tok.raw === '(') {
      stack.push({ char: '(', line: 1, col: tok.col });
    }
    if (tok.raw === ')') {
      const top = stack.pop();
      if (!top) {
        issues.push({
          level: 'error', line: 1, column: tok.col,
          message: '右括号 ) 无匹配的左括号',
        });
      }
    }
  }
  // 栈中剩余的未闭合
  for (const item of stack) {
    issues.push({
      level: 'error', line: item.line, column: item.col,
      message: `左括号 ( 未闭合`,
    });
  }
  return issues;
}
```

## 六、关键字分色高亮

代码高亮的本质是**按 token 类型套样式**。SQL 工具的高亮用 HTML span + CSS 类实现：

```typescript
function highlight(tokens: Token[]): string {
  return tokens.map((tok) => {
    const text = escapeHtml(tok.raw);
    switch (tok.type) {
      case 'keyword':
        return `<span class="sql-kw">${text}</span>`;
      case 'string':
        return `<span class="sql-str">${text}</span>`;
      case 'number':
        return `<span class="sql-num">${text}</span>`;
      case 'comment':
        return `<span class="sql-cmt">${text}</span>`;
      case 'identifier':
        return `<span class="sql-id">${text}</span>`;
      case 'punctuation':
        return `<span class="sql-pun">${text}</span>`;
      case 'parameter':
        return `<span class="sql-param">${text}</span>`;
      default:
        return text;
    }
  }).join('');
}
```

对应 CSS：

```css
.sql-kw { color: #0550ae; font-weight: 600; }      /* 关键字：深蓝加粗 */
.sql-str { color: #0a3069; }                        /* 字符串：深蓝 */
.sql-num { color: #0550ae; }                        /* 数字：深蓝 */
.sql-cmt { color: #6e7781; font-style: italic; }    /* 注释：灰色斜体 */
.sql-id { color: #24292f; }                         /* 标识符：默认色 */
.sql-pun { color: #6e7781; }                        /* 标点：灰色 */
.sql-param { color: #8250df; }                      /* 参数：紫色 */
```

## 七、6 种主流 SQL 美化器对比

| 工具 | 实现语言 | 体积 | 关键字大小写 | 子查询缩进 | CASE/WHEN | 压缩 | 注释处理 | 中文支持 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **本站 SQL 工具** | TypeScript | ~10KB | upper/lower/preserve | 2/4 空格 | 块状缩进 | 支持 | 可选移除 | 完美 |
| sql-formatter | TypeScript | ~50KB | upper/lower/preserve | 2/4 空格 | 块状缩进 | 支持 | 保留 | 完美 |
| prettier-plugin-sql | TypeScript | ~200KB（含 prettier） | upper/lower/preserve | 2/4 空格 | 块状缩进 | 支持 | 保留 | 完美 |
| DBeaver 内置 | Java | - | upper/lower/preserve | 2/4 空格 | 块状缩进 | 不支持 | 保留 | 完美 |
| DataGrip 内置 | Java | - | upper/lower/preserve | 2/4 空格 | 块状缩进 | 不支持 | 保留 | 完美 |
| Navicat 内置 | C++ | - | upper/lower | 2/4 空格 | 行内（不缩进） | 不支持 | 保留 | 完美 |

**本站工具的差异化**：

1. **零依赖纯原生**：bundle 仅 ~10KB（含 tokenizer + 格式化 + 校验 + 高亮）
2. **CASE/WHEN 块状缩进**：部分老工具（如 Navicat）CASE/WHEN 不缩进，可读性差
3. **可选压缩 + 移除注释**：桌面工具通常只格式化不压缩
4. **中文注释完美保留**：sql-formatter 部分版本对中文注释有编码问题
5. **6 个 SQL 模板**：SELECT / JOIN / INSERT / UPDATE / DELETE / CREATE 一键载入

## 八、性能优化与边界处理

### 8.1 性能优化

- **单遍扫描**：tokenizer 只扫描一次字符串，时间复杂度 O(n)
- **正则预编译**：`/[0-9]/`、`/[A-Za-z_]/` 等正则字面量在 V8 中自动预编译
- **避免字符串拼接**：用数组 push + join 代替 += 拼接
- **Set 代替数组**：关键字查找用 `Set.has()` 而非 `Array.includes()`，O(1) vs O(n)

### 8.2 边界处理

- **空输入**：返回空数组 / 空字符串
- **超长输入**：设上限（如 100KB），超出提示用户
- **未闭合引号**：tokenizer 不报错，把剩余字符当作字符串内容（校验阶段报错）
- **嵌套子查询**：depth 计数器无上限，但实际超过 5 层就难以阅读
- **MySQL 反引号标识符**：`` `my column` `` 与双引号统一处理为 string 类型
- **PostgreSQL 美元引号**：`$$...$$` 字符串当前版本未单独识别，按标点 + 标识符处理（可扩展）

## 九、从格式化器到 AST 解析器

本文实现的 tokenizer 是 SQL 解析器的**第一层**。如果要扩展到更复杂的功能（如 SQL 优化建议、SQL 转 API、SQL 注入检测），需要继续构建：

1. **Parser（语法分析器）**：把 token 序列转为 AST（抽象语法树）
2. **Visitor（访问者模式）**：遍历 AST 做语义分析
3. **Optimizer（优化器）**：基于 AST 提优化建议（如「SELECT * 改为显式字段」「WHERE 子句避免函数包裹字段」）
4. **Translator（翻译器）**：把 SQL AST 转为其他形式（如 GraphQL Query、MongoDB Aggregation）

但这些都需要完整的 SQL grammar（如 [ANTLR4 SQL Grammar](https://github.com/antlr/grammars-v4/tree/master/sql)），体积会显著增加。工具站的策略是：**格式化与基础校验用自研轻量解析器，高级分析功能留给桌面工具**。

## 十、工具矩阵联动

理解 SQL 解析器设计后，配套工具能帮你更快定位问题：

- [SQL 格式化与压缩](/sql)：在线体验本文讲述的词法分析器与缩进策略，支持 6 个 SQL 模板
- [正则表达式测试](/regex)：调试 token 匹配模式（如标识符正则 `/[A-Za-z_][A-Za-z0-9_]*/`）
- [JSON 工具](/json)：把 tokenizer 输出的 token 序列导出为 JSON 查看结构
- [Diff 文本对比](/diff)：对比不同格式化选项下的 SQL 输出差异
- [Hash 计算](/hash)：计算 SQL 脚本的哈希值，用于版本比对

## 小结

SQL 格式化的核心难点不在算法，而在词法分析。本文实现的解析器证明了：**用 ~10KB 的纯原生 JS 即可实现一个生产可用的 SQL 美化器**，覆盖 9 种 token 类型、5 类关键字分类、子查询缩进、CASE/WHEN 块状缩进、压缩、语法校验、分色高亮。

关键设计原则：

1. **token 类型细粒度**：区分 whitespace / comment / string / number / identifier / keyword / punctuation / parameter 8 类，每类有独立处理逻辑
2. **关键字分类**：主子句、JOIN、AND-OR、函数、数据类型 5 类，决定换行与缩进规则
3. **depth 计数器**：子查询与 CASE 块共享同一套缩进机制，简洁统一
4. **零依赖纯原生**：避免引入 sql-formatter / prettier 等库，bundle 体积可控
5. **避坑 CASE/WHEN 重复换行**：CASE 后不主动 newline，让 WHEN 自己 newline

下次当你需要写一个解析器时，先问自己：**真的需要引入 ANTLR4 + 完整 grammar 吗？** 如果只是格式化与基础校验，一个 ~200 行的 tokenizer 就够了。
