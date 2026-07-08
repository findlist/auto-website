---
title: "CSS 格式化与压缩原理：从词法分析到 minify 算法"
description: "深入解析 CSS 格式化与压缩背后的原理：CSS 词法结构、手写 tokenizer 逐字符扫描、递归下降 parser 构建 AST、向前探测区分规则与声明、美化序列化算法、压缩 minify 算法与末尾分号省略、校验常见问题。涵盖嵌套 at-rule、@keyframes、字符串字面量处理、纯原生 TypeScript 实现要点、与 HTML 格式化工具与颜色工具的联动方案。"
pubDate: 2026-07-07
tags: ["CSS", "格式化", "压缩", "minify", "词法分析", "解析器", "工具矩阵", "前端", "性能", "at-rule"]
relatedTool: "/css-formatter"
---

## 一、为什么需要 CSS 格式化与压缩

CSS 是 Web 样式的核心，但实际项目中的 CSS 代码质量参差不齐：

- **压缩部署后的代码**：生产环境为减小体积，CSS 常被压缩为单行，调试时需要还原
- **第三方库样式**：Tailwind / Bootstrap 等框架的 CSS 通常是压缩格式，阅读困难
- **复制粘贴的片段**：来源各异的 CSS 拼在一起后缩进风格杂乱
- **构建工具产物**：Webpack / Vite 打包后的 CSS 缺少换行与缩进

**格式化（Pretty Print）** 解决可读性问题：按嵌套层级缩进，每条声明独占一行。
**压缩（Minify）** 解决体积问题：移除注释与空白，省略末尾分号。
**校验（Lint）** 解决规范问题：检测空规则、重复属性、缺失值等。

## 二、CSS 的词法结构

与 HTML 的标签树结构不同，CSS 是一种「规则块」语法：

```css
/* 注释 */
selector {
  property: value;
  property: value !important;
}
@media condition {
  nested-selector { property: value; }
}
@import url("style.css");
```

CSS 的核心语法单元：

| 单元 | 示例 | 说明 |
|------|------|------|
| 规则 | `selector { ... }` | 选择器 + 声明块 |
| @ 规则 | `@media ...` / `@import ...` | 条件分组或导入 |
| 声明 | `property: value;` | 属性与值 |
| 注释 | `/* ... */` | 不影响样式 |
| 字符串 | `"Hello"` / `'World'` | content 属性等 |

## 三、手写词法分析器（Tokenizer）

CSS 格式化的第一步是将字符流切分为 token 流。关键在于正确处理字符串与注释：

```typescript
function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    // 跳过空白
    if (isWhitespace(ch)) { i++; continue; }
    // 注释 /* ... */（非贪婪匹配最近的 */）
    if (ch === '/' && src[i + 1] === '*') { /* 收集到 */ }
    // 字符串字面量（内部字符原样保留，避免误判）
    if (ch === '"' || ch === "'") { /* 收集到闭合引号 */ }
    // 特殊字符 { } ; :
    // 普通字符：收集到 word
  }
}
```

**字符串处理的陷阱**：如果不特殊处理字符串，`content: "}"` 中的 `}` 会被误认为块结束，导致解析错误。正确做法是遇到引号时扫描到闭合引号，中间字符全部原样保留。

**注释处理**：注释内可能包含任何字符（包括 `{` `}` `;`），必须整体作为一个 token 收集，不能在内部分词。

## 四、递归下降解析器（Parser）

词法分析后，用递归下降方式构建 AST：

```typescript
class Parser {
  parse(): CssNode[] { /* 逐节点解析 */ }
  parseNode(): CssNode | null {
    // @ 开头 → parseAtRule
    // word/colon → parseRule 或 parseDeclaration
  }
  parseAtRule(): AtRuleNode {
    // 收集 prelude → 遇到 ; 无块 / 遇到 { 有块
  }
  parseRule(): RuleNode {
    // 收集选择器 → 遇到 { → parseBlock
  }
  parseBlock(): CssNode[] {
    // 循环：注释 / @ 规则 / 嵌套规则 / 声明 → 遇到 } 结束
  }
}
```

### 向前探测：区分规则与声明

CSS 块内既有声明也有嵌套规则（如 `@media` 内的 `.btn { ... }`）。判断方法：

> 从当前位置扫描到下一个 `{` 或 `;`，若先遇到 `{` 则为嵌套规则，先遇到 `;` 则为声明。

```typescript
private lookAheadIsRule(): boolean {
  let depth = 0;
  for (let j = this.pos; j < this.tokens.length; j++) {
    const t = this.tokens[j];
    if (t.type === 'lbrace' && depth === 0) return true;
    if (t.type === 'semicolon' && depth === 0) return false;
    if (t.type === 'lbrace') depth++;
    if (t.type === 'rbrace') { if (depth === 0) return false; depth--; }
  }
  return false;
}
```

这个策略能正确处理原生 CSS 嵌套（Native Nesting）语法：`& .child { ... }` 中先遇到 `{`，被判定为嵌套规则。

## 五、@ 规则的分类处理

CSS 的 @ 规则分两类：

| 类型 | 示例 | 特征 |
|------|------|------|
| 无块 at-rule | `@import` `@charset` | 以 `;` 结束，无 `{ }` |
| 有块 at-rule | `@media` `@supports` `@keyframes` | 有 `{ }`，块内可嵌套规则 |

解析时根据遇到 `{` 还是 `;` 决定分支：

```typescript
if (this.peek().type === 'semicolon') {
  // @import url("style.css");
  return { type: 'atrule', name, prelude, block: null };
}
if (this.peek().type === 'lbrace') {
  // @media screen { ... }
  const block = this.parseBlock();
  return { type: 'atrule', name, prelude, block };
}
```

@keyframes 的关键帧选择器（`from` / `to` / `0%`）会被当作普通选择器处理，无需特殊逻辑。

## 六、美化序列化算法

美化是 AST → 带缩进字符串的过程，核心是递归 + 深度缩进：

```typescript
function serializePretty(nodes: CssNode[], opts: CssPrettyOptions, depth: number): string {
  const indent = opts.indent.repeat(depth);
  for (const node of nodes) {
    if (node.type === 'rule') {
      lines.push(`${indent}${selector} {`);
      serializePretty(node.children, opts, depth + 1);  // 递归加深
      lines.push(`${indent}}`);
    }
    if (node.type === 'declaration') {
      lines.push(`${indent}${property}: ${value};`);  // 单行声明
    }
  }
}
```

**选择器换行选项**：多个选择器（`.a, .b, .c`）可选择逗号后换行，每行一个选择器，便于阅读：

```typescript
if (opts.selectorOnNewLine) {
  selector = selector.split(',').map(s => s.trim()).join(',' + eol + indent);
}
```

## 七、压缩算法与末尾分号省略

压缩是美化的反面：移除所有非必要空白与注释。关键优化点：

1. **移除注释**：CSS 注释不影响样式，移除可减小 5-15% 体积
2. **合并空白**：选择器与值中的空白全部移除（字符串内除外）
3. **省略末尾分号**：CSS 规范允许最后一条声明省略分号

```typescript
function serializeMinifyBody(nodes: CssNode[], opts: CssMinifyOptions): string {
  const decls: string[] = [];
  for (const node of nodes) {
    if (node.type === 'declaration') {
      decls.push(`${property}:${value}`);  // 无空格
    }
  }
  // 最后一条可选省略分号
  return decls.join(';') + (opts.removeLastSemicolon ? '' : ';');
}
```

**末尾分号省略的安全性**：`}` 会隐式结束声明，因此 `.btn{color:red}` 与 `.btn{color:red;}` 等价。但手动编辑时容易漏加分号导致追加声明出错，仅建议生产压缩时开启。

## 八、校验常见问题

校验模式遍历 AST 输出统计与问题清单：

- **空规则**：选择器存在但无任何声明，建议删除
- **重复属性**：同一规则内多次定义同一属性，后者覆盖前者
- **缺失值**：属性后无值（如 `color: ;`）

```typescript
const seen = new Map<string, number>();
for (const child of node.children) {
  if (child.type !== 'declaration') continue;
  const prop = child.property.toLowerCase();
  const count = (seen.get(prop) || 0) + 1;
  if (count === 2) {
    issues.push({ level: 'warning', message: `重复属性「${child.property}」` });
  }
}
```

注意 CSS 是容错规范，浏览器会忽略无法解析的部分继续执行，校验不会「阻止」解析。

## 九、纯原生 TypeScript 实现要点

1. **零依赖**：不使用 postcss / csstree 等库，手写 tokenizer + parser，bundle 可控（约 10KB）
2. **容错设计**：遇到异常 token 跳过而非抛错，保证任意输入都能产出结果
3. **字符串安全**：词法分析阶段正确处理引号，避免字符串内的特殊字符误判
4. **向前探测**：用 lookAhead 策略区分规则与声明，无需回溯
5. **AST 中间层**：先解析为 AST 再序列化，美化与压缩共享同一解析器，保证一致性

## 十、工具联动

- **HTML 格式化工具**（<a href="/html-formatter">/html-formatter</a>）：形成「标记 + 样式」矩阵。注意 `<style>` 标签内的 CSS 会被 HTML 格式化工具原样保留（rawtext 元素），需复制到本工具单独格式化
- **颜色格式转换**（<a href="/color">/color</a>）：CSS 中大量颜色值，用颜色工具转换格式后粘贴到 CSS
- **颜色对比度检查**（<a href="/color-contrast">/color-contrast</a>）：检查 CSS 配色的 WCAG 可访问性
- **Markdown 预览器**（<a href="/markdown">/markdown</a>）：Markdown 中的 HTML 块可内嵌 `<style>`，配合本工具格式化内联样式
- **文本对比工具**（<a href="/diff">/diff</a>）：对比格式化前后的 CSS 差异，验证压缩是否改变语义

## 十一、常见陷阱

- **content 属性中的特殊字符**：`content: "{"}` 中的 `{` 不应被误判为块开始，词法分析时字符串整体收集可避免
- **@media 嵌套深度**：`@media` 内可嵌套 `@supports`，递归下降解析器天然支持多层嵌套
- **原生嵌套语法**：现代 CSS 支持 `& .child { ... }` 嵌套，向前探测策略能正确识别
- **选择器中的逗号**：`.a, .b` 是多选择器，压缩时应保留逗号但移除周围空白
- **!important 检测**：值末尾的 `!important` 需单独提取，美化时加空格，压缩时保留
