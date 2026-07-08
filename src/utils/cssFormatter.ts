/**
 * CSS 格式化与压缩
 *
 * 纯原生 TypeScript 零依赖实现，包含手写 CSS 词法分析器与递归下降解析器。
 * 提供三种能力：
 *   - 美化（Pretty）：按嵌套层级缩进，每条声明独占一行，选择器逗号后换行
 *   - 压缩（Minify）：移除注释与多余空白，合并规则，省略末尾分号
 *   - 校验（Lint）：输出统计信息与可疑问题清单（重复属性、空规则、缺失分号等）
 *
 * 设计要点：
 *   - 手写 tokenizer 逐字符扫描，正确处理字符串、注释、括号上下文
 *   - 递归下降 parser 构建轻量 AST（Rule / AtRule / Declaration / Comment）
 *   - 支持嵌套 at-rule（@media 内 @supports 等）、@keyframes 关键帧
 *   - 无块 at-rule（@import / @charset）单独处理
 *   - 美化模式可选保留注释、选择器换行、缩进宽度
 *   - 压缩模式可选移除注释、合并空白、省略末尾分号
 */

/** CSS AST 节点类型 */
type CssNode =
  | RuleNode
  | AtRuleNode
  | DeclarationNode
  | CommentNode;

/** 普通规则：选择器 + 声明块 */
interface RuleNode {
  type: 'rule';
  selector: string;
  children: CssNode[];
}

/** @ 规则：@media / @keyframes / @import 等 */
interface AtRuleNode {
  type: 'atrule';
  name: string;     // 不含 @，如 media / keyframes / import
  prelude: string;  // 前置文本，如 screen and (min-width: 768px)
  block: CssNode[] | null; // 有块则为子节点数组，@import 等无块则为 null
}

/** 声明：属性: 值 */
interface DeclarationNode {
  type: 'declaration';
  property: string;
  value: string;
  important: boolean;
}

/** 注释 */
interface CommentNode {
  type: 'comment';
  text: string;
}

/** 美化输出选项 */
export interface CssPrettyOptions {
  /** 缩进字符串 */
  indent: string;
  /** 是否保留注释 */
  preserveComments: boolean;
  /** 选择器逗号后是否换行（多选择器时） */
  selectorOnNewLine: boolean;
  /** 换行符 */
  eol: string;
}

/** 压缩输出选项 */
export interface CssMinifyOptions {
  /** 是否移除注释 */
  removeComments: boolean;
  /** 是否省略每条规则最后一条声明的分号 */
  removeLastSemicolon: boolean;
}

/** 校验问题 */
export interface CssLintIssue {
  level: 'warning' | 'info';
  message: string;
}

/** 统一结果封装 */
interface Result<T> {
  ok: boolean;
  value: T;
  error: string;
}

/** 文本统计 */
export interface TextStats {
  chars: number;
  lines: number;
}

/* ------------------------------------------------------------------ */
/* 词法分析：逐字符扫描，按上下文切分出原始 token                       */
/* ------------------------------------------------------------------ */

/** 原始 token 类型 */
type TokType = 'word' | 'lbrace' | 'rbrace' | 'semicolon' | 'colon' | 'comment' | 'eof';

interface Token {
  type: TokType;
  value: string;
}

/**
 * 词法分析器：将 CSS 字符串切分为 token 流
 * 正确处理字符串字面量与注释，避免在字符串/注释内误判特殊字符
 */
function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const len = src.length;
  let i = 0;

  while (i < len) {
    const ch = src[i];

    // 跳过空白（不产出 token）
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    // 注释 /* ... */（非贪婪匹配最近的 */）
    if (ch === '/' && src[i + 1] === '*') {
      let end = i + 2;
      while (end < len && !(src[end] === '*' && src[end + 1] === '/')) end++;
      const text = src.slice(i, end + 2);
      tokens.push({ type: 'comment', value: text });
      i = end + 2;
      continue;
    }

    // 字符串字面量：双引号 / 单引号（内部字符原样保留，避免误判）
    if (ch === '"' || ch === "'") {
      let end = i + 1;
      while (end < len && src[end] !== ch) {
        // 反斜杠转义，跳过下一字符
        if (src[end] === '\\') end++;
        end++;
      }
      // 将字符串作为 word 的一部分，先收集到 word buffer
      tokens.push({ type: 'word', value: src.slice(i, end + 1) });
      i = end + 1;
      continue;
    }

    // 特殊单字符 token
    if (ch === '{') { tokens.push({ type: 'lbrace', value: '{' }); i++; continue; }
    if (ch === '}') { tokens.push({ type: 'rbrace', value: '}' }); i++; continue; }
    if (ch === ';') { tokens.push({ type: 'semicolon', value: ';' }); i++; continue; }
    if (ch === ':') { tokens.push({ type: 'colon', value: ':' }); i++; continue; }

    // 普通字符：收集到 word，遇到特殊字符或空白停止
    let end = i;
    while (end < len) {
      const c = src[end];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') break;
      if (c === '{' || c === '}' || c === ';' || c === ':') break;
      if (c === '/' && src[end + 1] === '*') break;
      if (c === '"' || c === "'") break;
      end++;
    }
    if (end > i) {
      tokens.push({ type: 'word', value: src.slice(i, end) });
      i = end;
    } else {
      // 兜底：未识别字符，跳过避免死循环
      i++;
    }
  }

  tokens.push({ type: 'eof', value: '' });
  return tokens;
}

/* ------------------------------------------------------------------ */
/* 语法分析：递归下降构建 AST                                          */
/* ------------------------------------------------------------------ */

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private next(): Token {
    return this.tokens[this.pos++];
  }

  /** 解析整个样式表 */
  parse(): CssNode[] {
    const nodes: CssNode[] = [];
    while (this.peek().type !== 'eof') {
      const node = this.parseNode();
      if (node) nodes.push(node);
    }
    return nodes;
  }

  /** 解析单个节点（规则 / at-rule / 声明 / 注释） */
  private parseNode(): CssNode | null {
    const tok = this.peek();
    if (tok.type === 'eof') return null;

    // 注释
    if (tok.type === 'comment') {
      this.next();
      return { type: 'comment', text: tok.value };
    }

    // @ 规则
    if (tok.type === 'word' && tok.value.startsWith('@')) {
      return this.parseAtRule();
    }

    // 普通规则：收集到 lbrace 为选择器
    if (tok.type === 'word' || tok.type === 'colon') {
      return this.parseRule();
    }

    // 裸分号或右括号等异常 token，跳过容错
    this.next();
    return null;
  }

  /** 解析 @ 规则 */
  private parseAtRule(): AtRuleNode {
    const nameToken = this.next();
    const name = nameToken.value.slice(1); // 去掉 @

    // 收集 prelude（@ 名称到 { 或 ; 之间的所有 token）
    const parts: string[] = [];
    while (this.peek().type !== 'eof') {
      const t = this.peek();
      if (t.type === 'lbrace' || t.type === 'semicolon') break;
      parts.push(this.next().value);
    }
    const prelude = parts.join(' ').trim();

    // 无块 at-rule（@import / @charset 等）
    if (this.peek().type === 'semicolon') {
      this.next();
      return { type: 'atrule', name, prelude, block: null };
    }

    // 有块 at-rule（@media / @keyframes / @supports 等）
    if (this.peek().type === 'lbrace') {
      this.next(); // 消费 {
      const block = this.parseBlock();
      return { type: 'atrule', name, prelude, block };
    }

    // 异常收尾
    return { type: 'atrule', name, prelude, block: null };
  }

  /** 解析普通规则：selector { ... } */
  private parseRule(): RuleNode {
    const parts: string[] = [];
    while (this.peek().type !== 'eof') {
      const t = this.peek();
      if (t.type === 'lbrace') break;
      if (t.type === 'rbrace' || t.type === 'semicolon') {
        // 选择器未跟块就结束，容错退出
        this.next();
        break;
      }
      parts.push(this.next().value);
    }
    const selector = parts.join(' ').trim();

    if (this.peek().type === 'lbrace') {
      this.next(); // 消费 {
      const children = this.parseBlock();
      return { type: 'rule', selector, children };
    }

    return { type: 'rule', selector, children: [] };
  }

  /** 解析块内内容，直到遇到 } */
  private parseBlock(): CssNode[] {
    const nodes: CssNode[] = [];

    while (this.peek().type !== 'eof') {
      const t = this.peek();

      // 块结束
      if (t.type === 'rbrace') {
        this.next();
        break;
      }

      // 注释
      if (t.type === 'comment') {
        this.next();
        nodes.push({ type: 'comment', text: t.value });
        continue;
      }

      // 嵌套 at-rule
      if (t.type === 'word' && t.value.startsWith('@')) {
        nodes.push(this.parseAtRule());
        continue;
      }

      // 嵌套普通规则（如 @media 内的规则）
      // 判断方式：扫描到下一个 { 或 ; ，若先遇到 { 则为规则，先遇到 ; 则为声明
      if (t.type === 'word' || t.type === 'colon') {
        const isRule = this.lookAheadIsRule();
        if (isRule) {
          nodes.push(this.parseRule());
          continue;
        }
        nodes.push(this.parseDeclaration());
        continue;
      }

      // 裸分号等，跳过容错
      this.next();
    }

    return nodes;
  }

  /** 向前探测：到 { 或 ; 谁先出现，判断是规则还是声明 */
  private lookAheadIsRule(): boolean {
    let depth = 0;
    for (let j = this.pos; j < this.tokens.length; j++) {
      const t = this.tokens[j];
      if (t.type === 'lbrace' && depth === 0) return true;
      if (t.type === 'semicolon' && depth === 0) return false;
      if (t.type === 'lbrace') depth++;
      if (t.type === 'rbrace') {
        if (depth === 0) return false;
        depth--;
      }
    }
    return false;
  }

  /** 解析单条声明：property: value; 或 property: value !important; */
  private parseDeclaration(): DeclarationNode {
    const parts: string[] = [];
    let hasColon = false;

    while (this.peek().type !== 'eof') {
      const t = this.peek();
      if (t.type === 'semicolon' || t.type === 'rbrace') break;
      if (t.type === 'colon' && !hasColon) {
        hasColon = true;
        parts.push(':');
        this.next();
        continue;
      }
      parts.push(this.next().value);
    }

    // 消费末尾分号（但不消费 }）
    if (this.peek().type === 'semicolon') this.next();

    const raw = parts.join(' ').trim();
    return parseDeclarationText(raw);
  }
}

/** 从原始文本解析出声明结构（分离 property / value / important） */
function parseDeclarationText(raw: string): DeclarationNode {
  const colonIdx = raw.indexOf(':');
  if (colonIdx === -1) {
    return { type: 'declaration', property: raw, value: '', important: false };
  }
  let property = raw.slice(0, colonIdx).trim();
  let value = raw.slice(colonIdx + 1).trim();

  // 检测 !important
  let important = false;
  const impMatch = value.match(/!important\s*$/i);
  if (impMatch) {
    important = true;
    value = value.slice(0, impMatch.index).trim();
  }

  return { type: 'declaration', property, value, important };
}

/* ------------------------------------------------------------------ */
/* 序列化：AST → 字符串                                                */
/* ------------------------------------------------------------------ */

/** 美化序列化 */
function serializePretty(nodes: CssNode[], opts: CssPrettyOptions, depth: number): string {
  const indent = opts.indent.repeat(depth);
  const lines: string[] = [];

  for (const node of nodes) {
    if (node.type === 'comment') {
      if (opts.preserveComments) lines.push(indent + node.text);
      continue;
    }

    if (node.type === 'declaration') {
      if (!node.property) continue;
      const imp = node.important ? ' !important' : '';
      lines.push(`${indent}${node.property}: ${node.value}${imp};`);
      continue;
    }

    if (node.type === 'rule') {
      if (!node.selector) continue;
      // 选择器逗号后换行（可选）
      let selector = node.selector;
      if (opts.selectorOnNewLine) {
        selector = selector.split(',').map((s) => s.trim()).filter(Boolean).join(',' + opts.eol + indent);
      }
      lines.push(`${indent}${selector} {`);
      const body = serializePretty(node.children, opts, depth + 1);
      if (body) lines.push(body);
      lines.push(`${indent}}`);
      continue;
    }

    if (node.type === 'atrule') {
      const atText = `@${node.name}${node.prelude ? ' ' + node.prelude : ''}`;
      if (node.block === null) {
        // 无块 at-rule
        lines.push(`${indent}${atText};`);
      } else {
        lines.push(`${indent}${atText} {`);
        const body = serializePretty(node.block, opts, depth + 1);
        if (body) lines.push(body);
        lines.push(`${indent}}`);
      }
    }
  }

  return lines.join(opts.eol);
}

/** 压缩序列化 */
function serializeMinify(nodes: CssNode[], opts: CssMinifyOptions): string {
  const parts: string[] = [];

  for (const node of nodes) {
    if (node.type === 'comment') {
      if (!opts.removeComments) parts.push(node.text);
      continue;
    }

    if (node.type === 'declaration') {
      if (!node.property) continue;
      const imp = node.important ? '!important' : '';
      // 压缩时属性与冒号间无空格，值与分号间无空格
      parts.push(`${node.property}:${node.value}${imp ? ' ' + imp : ''}`);
      continue;
    }

    if (node.type === 'rule') {
      if (!node.selector) continue;
      // 压缩选择器：逗号后无空格
      const selector = node.selector.split(',').map((s) => s.trim()).filter(Boolean).join(',');
      const body = serializeMinifyBody(node.children, opts);
      parts.push(`${selector}{${body}}`);
      continue;
    }

    if (node.type === 'atrule') {
      const atText = `@${node.name}${node.prelude ? ' ' + node.prelude.trim() : ''}`;
      if (node.block === null) {
        parts.push(`${atText};`);
      } else {
        const body = serializeMinifyBody(node.block, opts);
        parts.push(`${atText}{${body}}`);
      }
    }
  }

  return parts.join('');
}

/** 压缩模式块内序列化：声明间用 ; 分隔，最后一条可选省略分号 */
function serializeMinifyBody(nodes: CssNode[], opts: CssMinifyOptions): string {
  const decls: string[] = [];
  const others: string[] = [];

  for (const node of nodes) {
    if (node.type === 'declaration' && node.property) {
      const imp = node.important ? '!important' : '';
      decls.push(`${node.property}:${node.value}${imp ? ' ' + imp : ''}`);
    } else if (node.type === 'rule' || node.type === 'atrule') {
      // 先把已收集的声明 flush
      if (decls.length > 0) {
        others.push(decls.join(';') + (opts.removeLastSemicolon ? '' : ';'));
        decls.length = 0;
      }
      others.push(serializeMinify([node], opts));
    } else if (node.type === 'comment' && !opts.removeComments) {
      others.push(node.text);
    }
  }

  if (decls.length > 0) {
    const joined = decls.join(';');
    others.push(opts.removeLastSemicolon ? joined : joined + ';');
  }

  return others.join('');
}

/* ------------------------------------------------------------------ */
/* 校验：遍历 AST 输出统计与问题清单                                    */
/* ------------------------------------------------------------------ */

interface LintStats {
  ruleCount: number;
  atRuleCount: number;
  declarationCount: number;
  commentCount: number;
  maxDepth: number;
}

function lintNodes(nodes: CssNode[], stats: LintStats, issues: CssLintIssue[], depth: number) {
  for (const node of nodes) {
    if (node.type === 'comment') { stats.commentCount++; continue; }

    if (node.type === 'rule') {
      stats.ruleCount++;
      if (depth > stats.maxDepth) stats.maxDepth = depth;
      if (node.children.length === 0) {
        issues.push({ level: 'warning', message: `空规则「${node.selector}」无任何声明，建议删除` });
      }
      // 检测重复属性
      const seen = new Map<string, number>();
      for (const child of node.children) {
        if (child.type !== 'declaration') continue;
        const prop = child.property.toLowerCase();
        const count = (seen.get(prop) || 0) + 1;
        seen.set(prop, count);
        if (count === 2) {
          issues.push({ level: 'warning', message: `规则「${node.selector}」内属性「${child.property}」重复定义` });
        }
      }
      lintNodes(node.children, stats, issues, depth + 1);
    }

    if (node.type === 'atrule') {
      stats.atRuleCount++;
      if (depth > stats.maxDepth) stats.maxDepth = depth;
      if (node.block) lintNodes(node.block, stats, issues, depth + 1);
    }

    if (node.type === 'declaration') {
      stats.declarationCount++;
      if (!node.value) {
        issues.push({ level: 'warning', message: `属性「${node.property}」缺少值` });
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 对外 API                                                            */
/* ------------------------------------------------------------------ */

/** 美化 CSS */
export function prettyPrint(
  src: string,
  opts: Partial<CssPrettyOptions> = {},
): Result<string> {
  try {
    const full: CssPrettyOptions = {
      indent: '  ',
      preserveComments: true,
      selectorOnNewLine: false,
      eol: '\n',
      ...opts,
    };
    const tokens = tokenize(src);
    const ast = new Parser(tokens).parse();
    const out = serializePretty(ast, full, 0);
    return { ok: true, value: out, error: '' };
  } catch (e) {
    return { ok: false, value: '', error: (e as Error).message || 'CSS 解析失败' };
  }
}

/** 压缩 CSS */
export function minify(
  src: string,
  opts: Partial<CssMinifyOptions> = {},
): Result<string> {
  try {
    const full: CssMinifyOptions = {
      removeComments: true,
      removeLastSemicolon: true,
      ...opts,
    };
    const tokens = tokenize(src);
    const ast = new Parser(tokens).parse();
    const out = serializeMinify(ast, full);
    return { ok: true, value: out, error: '' };
  } catch (e) {
    return { ok: false, value: '', error: (e as Error).message || 'CSS 解析失败' };
  }
}

/** 校验 CSS：返回格式化的统计 + 问题报告 */
export function lint(src: string): Result<string> {
  try {
    const tokens = tokenize(src);
    const ast = new Parser(tokens).parse();
    const stats: LintStats = { ruleCount: 0, atRuleCount: 0, declarationCount: 0, commentCount: 0, maxDepth: 0 };
    const issues: CssLintIssue[] = [];
    lintNodes(ast, stats, issues, 0);

    const lines: string[] = [];
    lines.push('解析成功');
    lines.push('');
    lines.push('── 统计信息 ──');
    lines.push(`规则数: ${stats.ruleCount}`);
    lines.push(`@ 规则数: ${stats.atRuleCount}`);
    lines.push(`声明数: ${stats.declarationCount}`);
    lines.push(`注释数: ${stats.commentCount}`);
    lines.push(`最大嵌套深度: ${stats.maxDepth}`);
    lines.push('');
    if (issues.length === 0) {
      lines.push('── 问题清单 ──');
      lines.push('未发现可疑问题');
    } else {
      lines.push(`── 问题清单（${issues.length} 项）──`);
      issues.forEach((iss, idx) => {
        lines.push(`${idx + 1}. [${iss.level === 'warning' ? '警告' : '提示'}] ${iss.message}`);
      });
    }
    return { ok: true, value: lines.join('\n'), error: '' };
  } catch (e) {
    return { ok: false, value: '', error: (e as Error).message || 'CSS 解析失败' };
  }
}

/** 压缩率：输入 → 输出的体积缩减百分比 */
export function compressionRatio(input: string, output: string): number {
  if (input.length === 0) return 0;
  const reduced = input.length - output.length;
  return Math.round((reduced / input.length) * 1000) / 10;
}

/** 文本统计：字符数与行数 */
export function computeTextStats(text: string): TextStats {
  if (text.length === 0) return { chars: 0, lines: 0 };
  const lines = text.split('\n').length;
  return { chars: text.length, lines };
}
