---
title: "JavaScript 格式化与压缩原理：从词法分析到智能缩进"
description: "深入解析 JavaScript 格式化与压缩背后的原理：JS 词法结构、手写 tokenizer 逐字符扫描、正则字面量与除法区分、模板字符串与注释处理、基于括号深度的智能缩进算法、压缩 minify 与 ASI 陷阱、校验未闭合括号。涵盖箭头函数、类、多字符运算符、纯原生 TypeScript 实现要点、与 HTML/CSS 格式化工具的联动方案。"
pubDate: 2026-07-07
tags: ["JavaScript", "格式化", "压缩", "minify", "词法分析", "tokenizer", "解析器", "工具矩阵", "前端", "性能"]
relatedTool: "/js-formatter"
---

## 一、为什么需要 JavaScript 格式化与压缩

JS 是 Web 交互的核心，但实际项目中的 JS 代码质量参差不齐：

- **压缩部署后的代码**：生产环境为减小体积，JS 常被压缩为单行，调试时需要还原
- **第三方库代码**：npm 包发布时常压缩，阅读源码困难
- **复制粘贴的片段**：来源各异的 JS 拼在一起后缩进风格杂乱
- **构建工具产物**：Webpack / Vite / esbuild 打包后的 JS 缺少换行与缩进

**格式化（Pretty Print）** 解决可读性问题：按括号嵌套层级缩进，语句分行。
**压缩（Minify）** 解决体积问题：移除注释与空白，合并为单行。
**校验（Lint）** 解决规范问题：检测未闭合括号、统计函数语句数。

## 二、JavaScript 的词法复杂度

相比 HTML（标签树）和 CSS（规则块），JS 的词法复杂度高出数量级：

| 难点 | 示例 | 说明 |
|------|------|------|
| 正则 vs 除法 | `a / b` vs `return /regex/` | 同一字符 `/` 两种语义 |
| 模板字符串 | `` `Hello, ${name}!` `` | 可嵌套 `${}` 表达式 |
| 多字符运算符 | `===` `!==` `...` `**=` `>>>=` | 需贪婪匹配 |
| 自动分号插入 | `return\nx` 被解析为 `return; x;` | ASI 陷阱 |
| 注释与字符串 | `/* "not string" */` 内的双引号 | 注释内字符不参与字符串识别 |

核心挑战是 **`/` 的二义性**：它既是除法运算符，又是正则字面量的开始符。区分需依赖上下文（前一个 token）。

## 三、手写词法分析器（Tokenizer）

JS 格式化的第一步是将字符流切分为 token 流。本工具手写 tokenizer 逐字符扫描，token 类型包括：

```typescript
type TokType =
  | 'comment'    // /* */ 或 //
  | 'string'     // ' " `
  | 'regex'      // /.../flags
  | 'number'     // 数字字面量
  | 'identifier' // 标识符或关键字
  | 'punctuator' // 标点：()[]{},.;:?!=+-*/%<>&|^~@
  | 'newline'    // 换行符
  | 'whitespace' // 空白（非换行）
  | 'eof';
```

### 关键点 1：字符串与模板字符串

字符串识别需正确处理转义字符：

```typescript
if (ch === '"' || ch === "'" || ch === '`') {
  const quote = ch;
  let end = i + 1;
  while (end < len) {
    const c = src[end];
    if (c === '\\') {
      end += 2; // 跳过转义字符
      continue;
    }
    if (c === quote) {
      terminated = true;
      break;
    }
    end++;
  }
}
```

模板字符串 `` `Hello, ${name}!` `` 的 `${}` 内可嵌套任意表达式，表达式内还可再有模板字符串。完整处理需递归下降，本工具简化为按 `` ` `` 闭合（对常见场景足够）。

### 关键点 2：注释识别

注释识别相对简单，但需在字符串识别之后（避免字符串内的 `//` 或 `/*` 被误判为注释）：

```typescript
// 单行注释 //
if (ch === '/' && src[i + 1] === '/') {
  let end = i + 2;
  while (end < len && src[end] !== '\n' && src[end] !== '\r') end++;
  // 收集到换行符为止
}
// 多行注释 /* */
if (ch === '/' && src[i + 1] === '*') {
  let end = i + 2;
  while (end < len && !(src[end] === '*' && src[end + 1] === '/')) end++;
  // 注意未闭合检查
}
```

### 关键点 3：正则字面量识别（最难）

`/` 是除法还是正则字面量？区分依据是「前一个有意义 token」：

**除法场景**（前一个 token 是操作数）：
- 标识符（非关键字）：`a / b`、`foo / 2`
- 数字：`10 / 2`
- 字符串：`"x" / 2`（语义少见但语法合法）
- 正则：`/re/ / 2`
- 闭合括号：`(a + b) / 2`、`arr[0] / 2`、`obj.x / 2`
- 字面量关键字：`true / 2`、`this / 2`、`null / 2`

**正则字面量场景**（前一个 token 是运算符或语句开头）：
- 赋值运算符：`x = /regex/`
- 开括号：`(/regex/)`、`[/regex/]`、`{/regex/: 1}`
- 逗号/分号：`x, /regex/`、`x; /regex/`
- 关键字：`return /regex/`、`typeof /regex/`、`case /regex/:`
- 一元运算符：`!/regex/.test(x)`

实现：

```typescript
const KEYWORDS_BEFORE_REGEX = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'delete', 'void',
  'new', 'throw', 'yield', 'await', 'case', 'do', 'else',
]);

const LITERAL_KEYWORDS = new Set([
  'true', 'false', 'null', 'undefined', 'this', 'super',
]);

const isRegexContext = (): boolean => {
  if (prevSignificant === null) return true; // 文件开头
  if (prevSignificant === 'identifier') {
    if (KEYWORDS_BEFORE_REGEX.has(prevIdentifierValue)) return true;
    if (LITERAL_KEYWORDS.has(prevIdentifierValue)) return false;
    return false; // 普通标识符之后是除法
  }
  // 数字、字符串、正则、)、]、} 之后是除法
  if (['number', 'string', 'regex', 'punctuator'].includes(prevSignificant)) {
    return false;
  }
  return true;
};
```

### 关键点 4：多字符运算符匹配

JS 有大量多字符运算符，需按长度优先匹配（三字符 > 二字符 > 单字符）：

```typescript
// 三字符运算符
const three = src.slice(i, i + 3);
if (['===', '!==', '...', '**=', '>>>', '<<=', '>>=', '&&=', '||=', '??='].includes(three)) {
  // 匹配三字符
}
// 二字符运算符
const two = src.slice(i, i + 2);
if (['==', '!=', '<=', '>=', '&&', '||', '??', '=>', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '**', '?.'].includes(two)) {
  // 匹配二字符
}
// 单字符标点
if ('()[]{},.;:?!=+-*/%<>&|^~@'.includes(ch)) {
  // 匹配单字符
}
```

### 关键点 5：数字字面量

JS 数字格式多样：十进制（`123`）、浮点（`1.23`）、科学计数法（`1e3`、`1.5e-3`）、十六进制（`0xFF`）、八进制（`0o17`）、二进制（`0b1010`）、BigInt（`123n`）。本工具按前缀分支处理：

```typescript
if (ch === '0' && (src[i+1] === 'x' || src[i+1] === 'X' || /* o/O/b/B */)) {
  // 十六进制/八进制/二进制
} else {
  // 十进制，含 . e E + -（科学计数法）
}
```

## 四、美化算法：基于括号深度的智能缩进

完整 JS AST 解析（如 Babel parser）需数千行代码。本工具采用「token 流重排」策略，基于括号深度追踪换行缩进，避免解析器复杂度。

### 核心规则

```typescript
function serializePretty(tokens: Token[], opts: JsPrettyOptions): string {
  let depth = 0;        // 花括号嵌套深度
  let parenDepth = 0;   // 圆括号深度（用于 for 头部 ; 不换行）
  
  for (const tok of tokens) {
    if (tok.type === 'punctuator') {
      const v = tok.value;
      
      if (v === '{') {
        writeToken(tok);
        depth++;
        writeNewline();  // { 后换行
      } else if (v === '}') {
        depth--;
        writeNewline();  // } 前换行
        writeToken(tok);
        writeNewline();  // } 后换行
      } else if (v === ';') {
        writeToken(tok);
        if (parenDepth === 0) writeNewline();  // for 头部 ; 不换行
      } else if (v === '(' || v === '[') {
        writeToken(tok);
        if (v === '(') parenDepth++;
      } else if (v === ')' || v === ']') {
        writeToken(tok);
        if (v === ')') parenDepth--;
      }
    }
  }
}
```

### for 循环头部分号处理

`for (init; cond; update)` 中的 `;` 不应触发换行。通过 `parenDepth` 判断：

```typescript
if (v === ';') {
  writeToken(tok);
  if (parenDepth === 0) writeNewline();  // 仅在 for 头部外换行
}
```

### 空块处理

`{}` 空对象字面量或空块不应展开为多行：

```typescript
const next = nextSignificant(tokens, idx);
if (next && next.type === 'punctuator' && next.value === '}') {
  // 空块不换行
} else {
  writeNewline();
}
```

### 词法粘连防护

压缩与美化时都需防止标识符粘连（`return x` 不能合并为 `returnx`）：

```typescript
function needsSpace(prev: Token, curr: Token): boolean {
  if (prev.type !== 'identifier' && prev.type !== 'number') return false;
  if (curr.type !== 'identifier' && curr.type !== 'number') return false;
  return true;  // 标识符/数字相邻需空格
}
```

## 五、压缩算法：移除注释与空白

压缩模式遍历 token 流，移除注释与空白，合并为单行：

```typescript
function serializeMinify(tokens: Token[], opts: JsMinifyOptions): string {
  const out: string[] = [];
  let lastSignificant: Token | null = null;
  
  for (const tok of tokens) {
    if (tok.type === 'comment') {
      if (opts.removeComments) continue;
      // 保留注释时需分隔
      if (lastSignificant) out.push(' ');
      out.push(tok.value);
      out.push(' ');
      continue;
    }
    if (tok.type === 'whitespace' || tok.type === 'newline') continue;
    
    // 防止词法粘连
    if (lastSignificant && needsSpace(lastSignificant, tok)) {
      out.push(' ');
    }
    out.push(tok.value);
    lastSignificant = tok;
  }
  
  return out.join('');
}
```

### ASI 陷阱与分号保留

JS 引擎在行尾缺少分号时会自动插入（ASI），但某些场景会失效：

```javascript
// 危险：压缩后 a[b] 会被解析为 a[b] 而非 a;\n[b]
const a = b
[c].forEach(console.log)

// 危险：压缩后 (b) 会被解析为 a(b) 而非 a;\n(b)
const a = b
(function() {})()
```

行首是 `[`、`(`、`` ` ``、`+`、`-`、`/` 时可能与前一行合并。生产级压缩工具（如 Terser）会做 ASI 分析并主动补分号。本工具为安全起见**保留所有原始分号**，不主动移除分号，因此不会引入 ASI 陷阱。

## 六、校验：未闭合检测

校验模式遍历 token 流，维护三种括号深度，结束时检测未闭合：

```typescript
function lintTokens(tokens: Token[], issues: JsLintIssue[]): LintStats {
  let braceDepth = 0;    // {}
  let parenDepth = 0;    // ()
  let bracketDepth = 0;  // []
  
  for (const tok of tokens) {
    if (tok.type === 'punctuator') {
      const v = tok.value;
      if (v === '{') braceDepth++;
      else if (v === '}') braceDepth = Math.max(0, braceDepth - 1);
      else if (v === '(') parenDepth++;
      else if (v === ')') parenDepth = Math.max(0, parenDepth - 1);
      else if (v === '[') bracketDepth++;
      else if (v === ']') bracketDepth = Math.max(0, bracketDepth - 1);
      else if (v === '=>') { stats.arrowCount++; stats.functionCount++; }
    }
  }
  
  // 检测未闭合
  if (braceDepth > 0) issues.push({ level: 'error', message: `花括号 { 未闭合 ${braceDepth} 处` });
  if (parenDepth > 0) issues.push({ level: 'error', message: `圆括号 ( 未闭合 ${parenDepth} 处` });
  if (bracketDepth > 0) issues.push({ level: 'error', message: `方括号 [ 未闭合 ${bracketDepth} 处` });
  
  return stats;
}
```

函数数统计包括 `function` 关键字与 `=>` 箭头函数。语句数通过 `;` 近似计数（不精确，因为 for 头部的 `;` 也被计入）。

## 七、纯原生 TypeScript 实现要点

### 零依赖

本工具约 700 行 TypeScript，无任何外部依赖（js-yaml / smol-toml 等库用于其他工具页）。核心算法：

- **tokenizer**：约 220 行，含正则字面量识别与多字符运算符匹配
- **serializePretty**：约 150 行，基于括号深度的换行缩进
- **serializeMinify**：约 40 行，移除注释与空白
- **lintTokens**：约 80 行，统计与未闭合检测

### 不使用 eval / Function 构造器

为安全起见，本工具不使用 `eval()` 或 `new Function()` 解析 JS（避免 XSS 风险与 CSP 限制）。仅做词法层面的 tokenization，不执行代码。

### 容错策略

- 未闭合字符串：返回错误信息，已解析的 token 仍保留
- 未闭合正则：降级为除法运算符（容错）
- 未闭合多行注释：返回错误信息
- 未识别字符：跳过避免死循环

### 局限性

- **非完整 AST**：不重排代码结构，仅调整缩进与换行。对象字面量 `{ a: 1, b: 2 }` 会被展开为多行（`{` 触发换行），但属性不按逗号拆分
- **无运算符空格**：`a+b` 不会被加空格为 `a + b`（避免一元/二元误判）
- **无 JSX/TSX 支持**：JSX 的 `<Component />` 与 TS 的类型注解会干扰词法分析
- **模板字符串嵌套**：`` `${`${x}`}` `` 嵌套表达式简化处理，可能不完美

如需更精细的格式化，建议使用 Prettier（基于 Babel parser，完整 AST 重排）。

## 八、工具联动

本工具与现有工具形成「标记 + 样式 + 脚本」完整三件套：

- **[HTML 格式化工具](/html-formatter)**：处理 HTML 结构，`<script>` 标签内的 JS 内容会被原样保留不格式化。典型流程：用 HTML 格式化工具美化页面结构，将 `<script>` 内的 JS 复制到本工具单独美化
- **[CSS 格式化工具](/css-formatter)**：处理 CSS 样式代码，`<style>` 标签内的 CSS 同理需单独处理
- **[Markdown 预览器](/markdown)**：Markdown 代码块内的 JS 可复制到本工具格式化
- **[文本对比工具](/diff)**：格式化后的 JS 可粘贴到 Diff 工具对比版本差异
- **[正则表达式测试](/regex)**：本工具正确识别正则字面量，与正则测试工具形成「识别 + 测试」联动

## 九、常见陷阱

### 1. 正则字面量误判

```javascript
// 正确识别
const re = /^https?:\/\//i;  // = 后是正则
return /pattern/g.test(x);   // return 后是正则

// 误判场景（本工具容错处理）
a
/b/  // 本工具可能识别为除法（因为 a 后是除法），实际是换行后的正则
```

### 2. 模板字符串嵌套

```javascript
// 嵌套模板字符串
const html = `
  <div>${items.map(item => `
    <span>${item.name}</span>
  `).join('')}</div>
`;
// 本工具简化处理，按最外层 ` 闭合，可能不完美
```

### 3. 对象字面量展开

```javascript
// 原始
const obj = { a: 1, b: 2 };

// 美化后（本工具）
const obj = {
a: 1, b: 2
}

// Prettier 效果（本工具做不到）
const obj = {
  a: 1,
  b: 2,
};
```

### 4. JSX 误判

```jsx
// JSX 的 < > 会被误判为比较运算符
const elem = <div className="x">{value}</div>;
// 本工具可能输出：const elem=<div className="x">{value}</div>;
// 运算符 < > 周围无空格，且结构可能错乱
```

### 5. TypeScript 泛型

```typescript
// 泛型 <T> 会被误判为比较
function identity<T>(x: T): T { return x; }
// 本工具可能输出：function identity<T>(x:T):T{return x}
// 类型注解 :T 保留，但 <T> 可能被误判
```

## 十、总结

JavaScript 格式化的核心难点是词法分析（特别是正则字面量识别）。本工具通过手写 tokenizer + 基于括号深度的智能缩进，实现了零依赖的 JS 美化/压缩/校验三合一。相比完整 AST 解析器（如 Babel/Prettier），本工具：

- ✅ 零依赖，bundle 体积可控
- ✅ 不执行代码，无 XSS 风险
- ✅ 正确识别正则字面量、模板字符串、多字符运算符
- ✅ 容错处理未闭合语法
- ❌ 不重排代码结构（对象字面量不按属性拆分）
- ❌ 无运算符空格（`a+b` 不变 `a + b`）
- ❌ 不支持 JSX/TSX 扩展语法

对于「快速还原压缩 JS、统一缩进风格、统计函数语句数」等场景，本工具已足够。如需生产级格式化，建议结合 Prettier 使用。
