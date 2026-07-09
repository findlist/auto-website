/**
 * JSONPath 查询引擎（零依赖纯函数实现）
 *
 * 实现的 JSONPath 语法子集（覆盖 RFC 9535 常用部分）：
 *   $                  根节点
 *   .name              子节点访问（点表示法）
 *   ['name'] / ["name"] 子节点访问（括号表示法）
 *   [0] / [1,2,3]      数组索引（支持多索引）
 *   [*]                通配符（数组所有元素或对象所有值）
 *   ..name             递归下降（任意层级中名为 name 的节点）
 *   ..*                递归下降所有节点
 *   [?(expr)]          过滤表达式（@ 表示当前节点）
 *
 * 过滤表达式支持的运算符：
 *   ==  !=  >  >=  <  <=  =~（正则匹配）
 *   &&  ||  !
 *   @.path             当前节点的子路径
 *   'literal' / 123 / true / false / null
 *
 * 设计要点：
 *   - 三阶段架构：tokenizer → parser → evaluator，便于单测与扩展
 *   - evaluator 以节点列表为流动单位，天然支持递归下降与通配符
 *   - 过滤表达式独立递归下降解析，避免与主路径解析相互干扰
 */

// ============================================================
// 第一阶段：词法分析器（tokenizer）
// ============================================================

/** Token 类型枚举 */
type TokenType =
  | 'ROOT'        // $
  | 'DOT'         // .
  | 'DOTDOT'      // ..
  | 'LBRACKET'    // [
  | 'RBRACKET'    // ]
  | 'STAR'        // *
  | 'QUESTION'    // ?
  | 'LPAREN'      // (
  | 'RPAREN'      // )
  | 'AT'          // @
  | 'STRING'      // 'foo' 或 "foo"
  | 'NUMBER'      // 123 或 -45
  | 'IDENT'       // 标识符（含通配符 *，按上下文区分）
  | 'OP'          // 运算符：== != >= <= > < =~
  | 'LOGOP'       // 逻辑运算符：&& || !
  | 'COMMA'       // ,
  | 'COLON'       // : （用于切片，预留）
  | 'EOF';        // 结束

interface Token {
  type: TokenType;
  value: string;
  pos: number; // 在原字符串中的位置，便于错误定位
}

/** 运算符与逻辑运算符候选表（按长度降序，保证贪婪匹配 >= 优先于 >） */
const OP_CANDIDATES: [string, TokenType][] = [
  ['==', 'OP'],
  ['!=', 'OP'],
  ['>=', 'OP'],
  ['<=', 'OP'],
  ['=~', 'OP'],
  ['>', 'OP'],
  ['<', 'OP'],
  ['&&', 'LOGOP'],
  ['||', 'LOGOP'],
  ['!', 'LOGOP'],
];

/** 标识符起始字符：字母、下划线、$、@ */
function isIdentStart(ch: string): boolean {
  return /[A-Za-z_$@]/.test(ch);
}

/** 标识符后续字符：字母、数字、下划线、- */
function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_$\-]/.test(ch);
}

/** 数字字符判断（含负号，负号在 tokenizer 中按上下文处理） */
function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/**
 * 词法分析：将 JSONPath 字符串拆解为 token 序列
 * @throws 当遇到非法字符时抛出包含位置信息的错误
 */
function tokenize(path: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = path.length;

  while (i < len) {
    const ch = path[i];

    // 跳过空白字符（路径中允许空格分隔，提升可读性）
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    // $ 根节点标记
    if (ch === '$') {
      tokens.push({ type: 'ROOT', value: '$', pos: i });
      i++;
      continue;
    }

    // .. 递归下降（必须先于 . 判断，保证贪婪匹配）
    if (ch === '.' && path[i + 1] === '.') {
      tokens.push({ type: 'DOTDOT', value: '..', pos: i });
      i += 2;
      continue;
    }

    // . 子节点访问
    if (ch === '.') {
      tokens.push({ type: 'DOT', value: '.', pos: i });
      i++;
      continue;
    }

    // [ 数组/过滤开始
    if (ch === '[') {
      tokens.push({ type: 'LBRACKET', value: '[', pos: i });
      i++;
      continue;
    }

    // ] 数组/过滤结束
    if (ch === ']') {
      tokens.push({ type: 'RBRACKET', value: ']', pos: i });
      i++;
      continue;
    }

    // * 通配符
    if (ch === '*') {
      tokens.push({ type: 'STAR', value: '*', pos: i });
      i++;
      continue;
    }

    // ? 过滤表达式起始
    if (ch === '?') {
      tokens.push({ type: 'QUESTION', value: '?', pos: i });
      i++;
      continue;
    }

    // ( ) 过滤表达式分组
    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(', pos: i });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')', pos: i });
      i++;
      continue;
    }

    // @ 当前节点引用
    if (ch === '@') {
      tokens.push({ type: 'AT', value: '@', pos: i });
      i++;
      continue;
    }

    // , 多索引分隔
    if (ch === ',') {
      tokens.push({ type: 'COMMA', value: ',', pos: i });
      i++;
      continue;
    }

    // : 切片分隔（预留语法，目前仅识别不深入解析）
    if (ch === ':') {
      tokens.push({ type: 'COLON', value: ':', pos: i });
      i++;
      continue;
    }

    // 字符串字面量（单引号或双引号，转义需处理）
    if (ch === "'" || ch === '"') {
      const quote = ch;
      const start = i;
      i++; // 跳过起始引号
      let str = '';
      while (i < len && path[i] !== quote) {
        if (path[i] === '\\' && i + 1 < len) {
          // 转义处理：支持 \\ \' \" \n \t \r
          const next = path[i + 1];
          if (next === 'n') str += '\n';
          else if (next === 't') str += '\t';
          else if (next === 'r') str += '\r';
          else str += next; // 其他字符按字面量处理
          i += 2;
        } else {
          str += path[i];
          i++;
        }
      }
      if (i >= len) {
        throw new Error(`位置 ${start}：字符串未闭合（缺少 ${quote}）`);
      }
      i++; // 跳过结束引号
      tokens.push({ type: 'STRING', value: str, pos: start });
      continue;
    }

    // 数字字面量（含负号开头）
    if (isDigit(ch) || (ch === '-' && isDigit(path[i + 1]))) {
      const start = i;
      let num = '';
      if (ch === '-') {
        num += '-';
        i++;
      }
      while (i < len && isDigit(path[i])) {
        num += path[i];
        i++;
      }
      tokens.push({ type: 'NUMBER', value: num, pos: start });
      continue;
    }

    // 运算符与逻辑运算符（贪婪匹配，长的优先）
    let matched = false;
    for (const [op, type] of OP_CANDIDATES) {
      if (path.startsWith(op, i)) {
        tokens.push({ type, value: op, pos: i });
        i += op.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // 标识符（关键字 true/false/null 也按 IDENT 处理，语义阶段再区分）
    if (isIdentStart(ch)) {
      const start = i;
      let ident = '';
      while (i < len && isIdentPart(path[i])) {
        ident += path[i];
        i++;
      }
      tokens.push({ type: 'IDENT', value: ident, pos: start });
      continue;
    }

    // 未知字符
    throw new Error(`位置 ${i}：无法识别的字符 "${ch}"`);
  }

  tokens.push({ type: 'EOF', value: '', pos: len });
  return tokens;
}

// ============================================================
// 第二阶段：解析器（parser）—— 构建 AST
// ============================================================

/** AST 段节点类型：表示路径中的一个步骤 */
type Segment =
  | { kind: 'root' }
  | { kind: 'child'; name: string }
  | { kind: 'multi-child'; names: string[] } // 多键 ['a','b'] 访问
  | { kind: 'index'; indices: number[] }
  | { kind: 'wildcard' }
  | { kind: 'recursive'; name: string | null } // null 表示 ..*
  | { kind: 'filter'; expr: FilterNode };

/** 过滤表达式 AST 节点 */
type FilterNode =
  | { kind: 'binary'; op: '&&' | '||'; left: FilterNode; right: FilterNode }
  | { kind: 'not'; expr: FilterNode }
  | { kind: 'compare'; op: '==' | '!=' | '>' | '>=' | '<' | '<=' | '=~'; left: FilterOperand; right: FilterOperand }
  | { kind: 'exists'; path: FilterOperand }; // 存在性判断：路径存在且值非 null/undefined

/** 过滤表达式操作数：路径引用 或 字面量 */
type FilterOperand =
  | { kind: 'path'; segments: Segment[] } // @.foo.bar 形式
  | { kind: 'literal'; value: string | number | boolean | null };

/** 解析器上下文，封装 token 流与位置游标 */
interface ParserContext {
  tokens: Token[];
  pos: number;
}

/** 查看当前 token */
function peek(ctx: ParserContext): Token {
  return ctx.tokens[ctx.pos];
}

/** 消费当前 token 并前进 */
function advance(ctx: ParserContext): Token {
  return ctx.tokens[ctx.pos++];
}

/** 期望当前 token 为指定类型，否则抛错 */
function expect(ctx: ParserContext, type: TokenType): Token {
  const tok = peek(ctx);
  if (tok.type !== type) {
    throw new Error(`位置 ${tok.pos}：期望 ${type}，但遇到 ${tok.type}（"${tok.value}"）`);
  }
  return advance(ctx);
}

/**
 * 解析完整路径表达式：$ .name [0] ..foo ...
 * 入口函数：消费 ROOT 后循环解析各段，直到 EOF
 */
function parsePath(ctx: ParserContext): Segment[] {
  const segments: Segment[] = [];

  // 路径必须以 $ 开头（严格模式）；若省略 $ 也兼容，自动补上根
  if (peek(ctx).type === 'ROOT') {
    advance(ctx);
  }
  segments.push({ kind: 'root' });

  // 循环消费各段，直到 EOF 或遇到 ) 结束（过滤表达式上下文中路径可能被 ) 终止）
  while (peek(ctx).type !== 'EOF' && peek(ctx).type !== 'RPAREN') {
    const seg = parseSegment(ctx);
    segments.push(seg);
  }

  return segments;
}

/** 解析单个路径段：.name / ..name / [index] / [*] / [?(filter)] */
function parseSegment(ctx: ParserContext): Segment {
  const tok = peek(ctx);

  // 点表示法：.name
  if (tok.type === 'DOT') {
    advance(ctx);
    const nameTok = peek(ctx);
    // .name 直接取标识符
    if (nameTok.type === 'IDENT') {
      advance(ctx);
      return { kind: 'child', name: nameTok.value };
    }
    // .* 通配符
    if (nameTok.type === 'STAR') {
      advance(ctx);
      return { kind: 'wildcard' };
    }
    throw new Error(`位置 ${nameTok.pos}：点号后应为标识符或 *，但遇到 ${nameTok.type}`);
  }

  // 递归下降：..name 或 ..* 或 ..[?(filter)]
  if (tok.type === 'DOTDOT') {
    advance(ctx);
    const next = peek(ctx);
    // ..name
    if (next.type === 'IDENT') {
      advance(ctx);
      return { kind: 'recursive', name: next.value };
    }
    // ..* 递归所有节点
    if (next.type === 'STAR') {
      advance(ctx);
      return { kind: 'recursive', name: null };
    }
    // ..[index] 或 ..['name'] 递归后跟括号形式
    if (next.type === 'LBRACKET') {
      // 返回递归所有节点，后续 [expr] 段由外层循环自然解析
      // 不在此处消费 LBRACKET，保持 ctx.pos 指向 LBRACKET
      return { kind: 'recursive', name: null };
    }
    throw new Error(`位置 ${next.pos}：.. 后应为标识符、* 或 [，但遇到 ${next.type}`);
  }

  // 括号表示法：[index] / ['name'] / [*] / [?(filter)]
  if (tok.type === 'LBRACKET') {
    return parseBracket(ctx);
  }

  throw new Error(`位置 ${tok.pos}：路径段应以 . 或 .. 或 [ 开头，但遇到 ${tok.type}（"${tok.value}"）`);
}

/** 解析括号内的段：[0] / [0,1] / ['name'] / [*] / [?(expr)] */
function parseBracket(ctx: ParserContext): Segment {
  expect(ctx, 'LBRACKET');
  const tok = peek(ctx);

  // [*] 通配符
  if (tok.type === 'STAR') {
    advance(ctx);
    expect(ctx, 'RBRACKET');
    return { kind: 'wildcard' };
  }

  // [?(filter)] 过滤表达式
  if (tok.type === 'QUESTION') {
    advance(ctx);
    expect(ctx, 'LPAREN');
    const expr = parseFilterExpr(ctx);
    expect(ctx, 'RPAREN');
    expect(ctx, 'RBRACKET');
    return { kind: 'filter', expr };
  }

  // [0] 或 [0,1,2] 数字索引
  if (tok.type === 'NUMBER') {
    const indices: number[] = [parseInt(tok.value, 10)];
    advance(ctx);
    while (peek(ctx).type === 'COMMA') {
      advance(ctx);
      const numTok = expect(ctx, 'NUMBER');
      indices.push(parseInt(numTok.value, 10));
    }
    expect(ctx, 'RBRACKET');
    return { kind: 'index', indices };
  }

  // ['name'] 字符串键名，支持多键 ['a','b']
  if (tok.type === 'STRING') {
    const name = tok.value;
    advance(ctx);
    const names: string[] = [name];
    while (peek(ctx).type === 'COMMA') {
      advance(ctx);
      const strTok = expect(ctx, 'STRING');
      names.push(strTok.value);
    }
    expect(ctx, 'RBRACKET');
    // 单键返回 child，多键返回 multi-child（求值时分别取每个键并合并）
    if (names.length === 1) {
      return { kind: 'child', name: names[0] };
    }
    return { kind: 'multi-child', names };
  }

  throw new Error(`位置 ${tok.pos}：[ 内应为数字、字符串、* 或 ?，但遇到 ${tok.type}`);
}

/**
 * 解析过滤表达式（递归下降，支持 && || ! 优先级）
 * 语法：expr := orExpr ; orExpr := andExpr ('||' andExpr)* ; andExpr := notExpr ('&&' notExpr)* ; notExpr := '!' notExpr | compare ; compare := operand (op operand)?
 */
function parseFilterExpr(ctx: ParserContext): FilterNode {
  return parseOrExpr(ctx);
}

/** 解析 || 优先级最低的表达式 */
function parseOrExpr(ctx: ParserContext): FilterNode {
  let left = parseAndExpr(ctx);
  while (peek(ctx).type === 'LOGOP' && peek(ctx).value === '||') {
    advance(ctx);
    const right = parseAndExpr(ctx);
    left = { kind: 'binary', op: '||', left, right };
  }
  return left;
}

/** 解析 && 表达式 */
function parseAndExpr(ctx: ParserContext): FilterNode {
  let left = parseNotExpr(ctx);
  while (peek(ctx).type === 'LOGOP' && peek(ctx).value === '&&') {
    advance(ctx);
    const right = parseNotExpr(ctx);
    left = { kind: 'binary', op: '&&', left, right };
  }
  return left;
}

/** 解析 ! 非运算 */
function parseNotExpr(ctx: ParserContext): FilterNode {
  if (peek(ctx).type === 'LOGOP' && peek(ctx).value === '!') {
    advance(ctx);
    const expr = parseNotExpr(ctx);
    return { kind: 'not', expr };
  }
  return parseCompare(ctx);
}

/** 解析比较表达式：operand op operand，或单 operand（存在性判断） */
function parseCompare(ctx: ParserContext): FilterNode {
  const left = parseOperand(ctx);
  const tok = peek(ctx);
  if (tok.type === 'OP') {
    advance(ctx);
    const right = parseOperand(ctx);
    // tok.value 已由 tokenizer 保证为合法运算符，这里断言为 compare op 类型
    return { kind: 'compare', op: tok.value as '==' | '!=' | '>' | '>=' | '<' | '<=' | '=~', left, right };
  }
  // 无运算符：存在性判断，路径存在且值非 null/undefined 即为真
  return { kind: 'exists', path: left };
}

/** 解析操作数：@.path 路径 或 字面量 */
function parseOperand(ctx: ParserContext): FilterOperand {
  const tok = peek(ctx);

  // @.path 当前节点的子路径
  if (tok.type === 'AT') {
    advance(ctx);
    const segments: Segment[] = [{ kind: 'root' }]; // @ 等价于当前节点，用 root 占位
    // 后续 .name 或 ['name'] 或 [index]
    while (peek(ctx).type === 'DOT' || peek(ctx).type === 'LBRACKET') {
      if (peek(ctx).type === 'DOT') {
        advance(ctx);
        const nameTok = expect(ctx, 'IDENT');
        segments.push({ kind: 'child', name: nameTok.value });
      } else {
        // LBRACKET
        segments.push(parseBracket(ctx));
      }
    }
    return { kind: 'path', segments };
  }

  // $ 根路径（过滤表达式中也可引用根）
  if (tok.type === 'ROOT') {
    advance(ctx);
    const segments: Segment[] = [{ kind: 'root' }];
    while (peek(ctx).type === 'DOT' || peek(ctx).type === 'LBRACKET') {
      segments.push(parseSegment(ctx));
    }
    return { kind: 'path', segments };
  }

  // 字符串字面量
  if (tok.type === 'STRING') {
    advance(ctx);
    return { kind: 'literal', value: tok.value };
  }

  // 数字字面量
  if (tok.type === 'NUMBER') {
    advance(ctx);
    return { kind: 'literal', value: parseFloat(tok.value) };
  }

  // true / false / null（按 IDENT 处理）
  if (tok.type === 'IDENT') {
    const v = tok.value;
    if (v === 'true') {
      advance(ctx);
      return { kind: 'literal', value: true };
    }
    if (v === 'false') {
      advance(ctx);
      return { kind: 'literal', value: false };
    }
    if (v === 'null') {
      advance(ctx);
      return { kind: 'literal', value: null };
    }
  }

  throw new Error(`位置 ${tok.pos}：过滤表达式操作数应为 @、$、字符串、数字、true/false/null，但遇到 ${tok.type}（"${tok.value}"）`);
}

// ============================================================
// 第三阶段：求值器（evaluator）
// ============================================================

/**
 * 在 JSON 数据上求值 AST
 * @param data JSON 数据
 * @param segments 解析后的路径段
 * @returns 匹配的节点列表（保持顺序）
 */
function evaluate(data: unknown, segments: Segment[]): unknown[] {
  let current: unknown[] = [data];

  // 第一段是 root，从第二段开始求值
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const next: unknown[] = [];
    for (const node of current) {
      const matched = evaluateSegment(node, seg);
      next.push(...matched);
    }
    current = next;
    if (current.length === 0) break; // 提前终止，无匹配
  }

  return current;
}

/** 对单个节点求值单个段 */
function evaluateSegment(node: unknown, seg: Segment): unknown[] {
  switch (seg.kind) {
    case 'child':
      return evaluateChild(node, seg.name);

    case 'multi-child':
      // 多键访问：对每个 name 分别求值并合并结果，保持出现顺序
      return seg.names.flatMap((name) => evaluateChild(node, name));

    case 'index':
      return evaluateIndex(node, seg.indices);

    case 'wildcard':
      return evaluateWildcard(node);

    case 'recursive':
      return evaluateRecursive(node, seg.name);

    case 'filter':
      return evaluateFilter(node, seg.expr);

    case 'root':
      // root 只应出现在路径开头，中间出现视为不匹配
      return [];
  }
}

/** 子节点求值：node[name] */
function evaluateChild(node: unknown, name: string): unknown[] {
  if (node === null || node === undefined) return [];
  if (typeof node !== 'object') return [];
  if (Array.isArray(node)) {
    // 数组的 .name 访问：仅匹配数组本身具有的属性（如 length）
    // 通常 JSONPath 对数组的 .name 不匹配元素，这里保持标准行为
    return Object.prototype.hasOwnProperty.call(node, name) ? [node[name as keyof unknown[]]] : [];
  }
  return Object.prototype.hasOwnProperty.call(node, name) ? [node[name as keyof object]] : [];
}

/** 数组索引求值：支持负索引（-1 表示最后一个） */
function evaluateIndex(node: unknown, indices: number[]): unknown[] {
  if (!Array.isArray(node)) return [];
  const result: unknown[] = [];
  for (const idx of indices) {
    const realIdx = idx < 0 ? node.length + idx : idx;
    if (realIdx >= 0 && realIdx < node.length) {
      result.push(node[realIdx]);
    }
  }
  return result;
}

/** 通配符求值：数组返回所有元素，对象返回所有值 */
function evaluateWildcard(node: unknown): unknown[] {
  if (node === null || node === undefined) return [];
  if (Array.isArray(node)) return [...node];
  if (typeof node === 'object') return Object.values(node);
  return [];
}

/** 递归下降求值：深度遍历，匹配名为 name 的节点；name 为 null 时返回所有节点 */
function evaluateRecursive(node: unknown, name: string | null): unknown[] {
  const result: unknown[] = [];

  function walk(n: unknown) {
    if (n === null || n === undefined) return;
    if (Array.isArray(n)) {
      // name 为 null 时收集所有节点（含数组本身）
      if (name === null) result.push(n);
      for (const item of n) walk(item);
    } else if (typeof n === 'object') {
      // name 为 null 时收集所有节点（含对象本身）
      if (name === null) result.push(n);
      for (const [k, v] of Object.entries(n)) {
        if (name !== null && k === name) {
          result.push(v);
        }
        walk(v);
      }
    } else {
      // 原始值：name 为 null 时收集
      if (name === null) result.push(n);
    }
  }

  walk(node);
  return result;
}

/** 过滤表达式求值：对数组/对象的每个元素求值过滤表达式，保留为真的 */
function evaluateFilter(node: unknown, expr: FilterNode): unknown[] {
  if (node === null || node === undefined) return [];
  // 过滤表达式仅对数组或对象生效
  const candidates: unknown[] = Array.isArray(node)
    ? [...node]
    : typeof node === 'object'
      ? Object.values(node)
      : [];

  return candidates.filter((item) => evaluateFilterNode(item, expr));
}

/** 递归求值过滤表达式节点，返回布尔结果 */
function evaluateFilterNode(node: unknown, expr: FilterNode): boolean {
  switch (expr.kind) {
    case 'binary': {
      const left = evaluateFilterNode(node, expr.left);
      const right = evaluateFilterNode(node, expr.right);
      return expr.op === '&&' ? left && right : left || right;
    }
    case 'not':
      return !evaluateFilterNode(node, expr.expr);
    case 'compare':
      return evaluateCompare(node, expr);
    case 'exists': {
      // 存在性判断：路径求值后取第一个值，非 null/undefined 即为真
      const val = evaluateOperand(node, expr.path);
      return val !== undefined && val !== null;
    }
  }
}

/** 比较表达式求值 */
function evaluateCompare(node: unknown, expr: { op: string; left: FilterOperand; right: FilterOperand }): boolean {
  const leftVal = evaluateOperand(node, expr.left);
  const rightVal = evaluateOperand(node, expr.right);

  switch (expr.op) {
    case '==':
      // 宽松相等：类型不同时尝试转换为同类型比较
      // eslint-disable-next-line eqeqeq
      return looseEquals(leftVal, rightVal);
    case '!=':
      // eslint-disable-next-line eqeqeq
      return !looseEquals(leftVal, rightVal);
    case '>':
      return compareNumeric(leftVal, rightVal) > 0;
    case '>=':
      return compareNumeric(leftVal, rightVal) >= 0;
    case '<':
      return compareNumeric(leftVal, rightVal) < 0;
    case '<=':
      return compareNumeric(leftVal, rightVal) <= 0;
    case '=~':
      // 正则匹配：右操作数应为字符串形式的正则
      if (typeof rightVal !== 'string' || typeof leftVal !== 'string') return false;
      // 限制正则与被匹配字符串长度，防御恶意回溯型正则导致 ReDoS
      if (rightVal.length > 1000 || leftVal.length > 100000) return false;
      try {
        const regex = new RegExp(rightVal);
        return regex.test(leftVal);
      } catch {
        return false; // 非法正则返回 false
      }
    default:
      return false;
  }
}

/** 求值操作数：路径引用或字面量 */
function evaluateOperand(node: unknown, operand: FilterOperand): unknown {
  if (operand.kind === 'literal') return operand.value;
  // 路径引用：以 node 为根求值
  // 第一个段是 root（占位），实际求值从 node 开始
  const result = evaluate(node, operand.segments);
  // 路径求值返回列表，取第一个元素作为操作数值（标准 JSONPath 行为）
  return result.length > 0 ? result[0] : undefined;
}

/** 将字符串解析为数字：空字符串与非数字字符串（如 "123abc"）返回 NaN */
function toNumber(value: string): number {
  return value.trim() === '' ? NaN : Number(value);
}

/** 宽松相等：数字与数字字符串按数值比较，其余按严格相等 */
function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  // 数字与字符串数字比较：转为数字后比较
  if (typeof a === 'number' && typeof b === 'string') {
    const n = toNumber(b);
    return !isNaN(n) && a === n;
  }
  if (typeof b === 'number' && typeof a === 'string') {
    const n = toNumber(a);
    return !isNaN(n) && b === n;
  }
  // 其他类型组合按严格相等（避免 false == 0 等非预期匹配）
  return false;
}

/** 数值比较：返回 -1/0/1；非数字场景返回 0 表示无法比较 */
function compareNumeric(a: unknown, b: unknown): number {
  const na = typeof a === 'number' ? a : typeof a === 'string' ? toNumber(a) : NaN;
  const nb = typeof b === 'number' ? b : typeof b === 'string' ? toNumber(b) : NaN;
  if (isNaN(na) || isNaN(nb)) return 0;
  if (na < nb) return -1;
  if (na > nb) return 1;
  return 0;
}

// ============================================================
// 公开 API
// ============================================================

export interface JsonPathResult {
  success: boolean;
  values: unknown[]; // 匹配的值列表
  count: number; // 匹配数量
  error?: string; // 解析或求值错误信息
}

/**
 * 在 JSON 数据上执行 JSONPath 查询
 * @param data JSON 数据（已解析的对象/数组/原始值）
 * @param path JSONPath 表达式字符串
 * @returns 查询结果对象，包含匹配值列表与错误信息
 */
export function query(data: unknown, path: string): JsonPathResult {
  if (typeof path !== 'string' || path.length === 0) {
    return { success: false, values: [], count: 0, error: 'JSONPath 表达式不能为空' };
  }

  try {
    const tokens = tokenize(path);
    const ctx: ParserContext = { tokens, pos: 0 };
    const segments = parsePath(ctx);

    // 检查是否所有 token 都被消费（避免 $..foo bar 这种被静默忽略）
    if (peek(ctx).type !== 'EOF') {
      const tok = peek(ctx);
      return {
        success: false,
        values: [],
        count: 0,
        error: `位置 ${tok.pos}：路径解析提前终止，剩余 token "${tok.value}"（${tok.type}）未处理`,
      };
    }

    const values = evaluate(data, segments);
    return { success: true, values, count: values.length };
  } catch (e) {
    return {
      success: false,
      values: [],
      count: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * 校验 JSONPath 表达式语法是否合法（不求值）
 * @param path JSONPath 表达式字符串
 * @returns 校验结果，valid 为 true 时表示语法合法
 */
export function validatePath(path: string): { valid: boolean; error?: string } {
  if (typeof path !== 'string' || path.length === 0) {
    return { valid: false, error: 'JSONPath 表达式不能为空' };
  }
  try {
    const tokens = tokenize(path);
    const ctx: ParserContext = { tokens, pos: 0 };
    parsePath(ctx);
    if (peek(ctx).type !== 'EOF') {
      const tok = peek(ctx);
      return { valid: false, error: `位置 ${tok.pos}：剩余 token "${tok.value}" 未处理` };
    }
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 获取 JSON 路径表达式片段的简单说明（用于 UI 提示） */
export function describePath(path: string): string {
  if (!path) return '空表达式';
  const parts: string[] = [];
  if (path.startsWith('$')) parts.push('根节点');
  if (path.includes('..')) parts.push('递归下降');
  if (path.includes('[*]')) parts.push('通配符');
  if (path.includes('[?')) parts.push('过滤表达式');
  if (path.includes(',')) parts.push('多索引');
  return parts.length > 0 ? parts.join(' · ') : '基本路径';
}

// ============================================================
// 预设示例（用于 UI 一键载入）
// ============================================================

export interface JsonPathPreset {
  label: string;
  path: string;
  description: string;
}

/** 预设示例数据：覆盖电商订单/书籍列表/嵌套对象等典型场景 */
export const SAMPLE_JSON = {
  store: {
    book: [
      { category: 'reference', author: 'Nigel Rees', title: 'Sayings of the Century', price: 8.95 },
      { category: 'fiction', author: 'Evelyn Waugh', title: 'Sword of Honour', price: 12.99 },
      { category: 'fiction', author: 'Herman Melville', title: 'Moby Dick', isbn: '0-553-21311-3', price: 8.99 },
      { category: 'fiction', author: 'J. R. R. Tolkien', title: 'The Lord of the Rings', isbn: '0-395-19395-8', price: 22.99 },
    ],
    bicycle: { color: 'red', price: 19.95 },
  },
  users: [
    { id: 1, name: '张三', email: 'zhangsan@example.com', age: 28, role: 'admin' },
    { id: 2, name: '李四', email: 'lisi@example.com', age: 34, role: 'user' },
    { id: 3, name: '王五', email: 'wangwu@example.com', age: 22, role: 'user' },
  ],
};

/** 预设 JSONPath 表达式列表 */
export const JSONPATH_PRESETS: JsonPathPreset[] = [
  { label: '所有书作者', path: '$.store.book[*].author', description: '通配符 + 子节点：获取 bookstore 下所有书的作者' },
  { label: '所有作者（递归）', path: '$..author', description: '递归下降：从根开始查找所有层级的 author 字段' },
  { label: 'store 下所有内容', path: '$.store.*', description: '通配符：获取 store 对象的所有值（book 数组与 bicycle 对象）' },
  { label: '所有价格', path: '$.store..price', description: '递归下降 + 子节点：store 下所有层级的 price 字段' },
  { label: '第 3 本书', path: '$..book[2]', description: '数组索引：从根递归找 book 数组的第 3 个元素' },
  { label: '最后 1 本书', path: '$..book[-1]', description: '负索引：-1 表示数组的最后一个元素' },
  { label: '前 2 本书', path: '$..book[0,1]', description: '多索引：用逗号分隔多个索引，返回多个元素' },
  { label: '含 isbn 的书', path: '$..book[?(@.isbn)]', description: '过滤存在性：保留存在 isbn 字段的元素' },
  { label: '价格 < 10 的书', path: '$..book[?(@.price < 10)]', description: '过滤比较：保留 price 小于 10 的元素' },
  { label: '小说类书籍', path: '$..book[?(@.category == "fiction")]', description: '过滤字符串相等：保留 category 为 fiction 的元素' },
  { label: '成年用户', path: '$.users[?(@.age >= 18)].name', description: '过滤 + 路径：成年用户的姓名' },
  { label: '管理员邮箱', path: '$.users[?(@.role == "admin")].email', description: '过滤 + 路径：role 为 admin 的用户邮箱' },
];
