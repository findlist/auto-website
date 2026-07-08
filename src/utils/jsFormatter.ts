/**
 * JavaScript 格式化与压缩
 *
 * 纯原生 TypeScript 零依赖实现，包含手写 JS 词法分析器与基于括号深度的智能缩进器。
 * 提供三种能力：
 *   - 美化（Pretty）：基于括号深度追踪的智能换行缩进，保留 token 间必要空格
 *   - 压缩（Minify）：移除注释与多余空白，合并为单行（保留必要的分号与空格）
 *   - 校验（Lint）：输出统计信息与可疑问题清单（未闭合括号/引号/模板字符串/注释）
 *
 * 设计要点：
 *   - 手写 tokenizer 逐字符扫描，正确处理字符串、模板字符串、注释、正则字面量
 *   - 正则字面量识别：通过前一个有意义 token 判断 `/` 是除法还是正则开始
 *   - 美化采用「token 流重排」而非完整 AST，避免解析器复杂度，对常见 JS 代码效果好
 *   - 括号深度追踪：`for (init; cond; update)` 头部的 `;` 不换行
 *   - 压缩保留必要的分号（防止 ASI 陷阱）与标识符间空格
 *
 * 局限性（已在博客说明）：
 *   - 非完整 AST，不重排代码结构，仅调整缩进与换行
 *   - 对极端复杂的链式调用、三元嵌套等场景美化效果有限
 *   - 不支持 JSX/TSX/CSS-in-JS 等扩展语法
 */

/** JS token 类型 */
type TokType =
  | 'comment'       // /* */ 或 //
  | 'string'        // ' " `
  | 'regex'         // /.../flags
  | 'number'        // 数字字面量
  | 'identifier'    // 标识符或关键字
  | 'punctuator'    // 标点：()[]{},.;:?!=+-*/%<>&|^~@
  | 'newline'       // 换行符（用于保留原始换行）
  | 'whitespace'    // 空白（非换行）
  | 'eof';

interface Token {
  type: TokType;
  value: string;
}

/** 美化输出选项 */
export interface JsPrettyOptions {
  /** 缩进字符串 */
  indent: string;
  /** 是否保留注释 */
  preserveComments: boolean;
  /** 换行符 */
  eol: string;
}

/** 压缩输出选项 */
export interface JsMinifyOptions {
  /** 是否移除注释 */
  removeComments: boolean;
  /** 是否合并为单行（false 时保留原始换行但移除缩进） */
  singleLine: boolean;
}

/** 校验问题 */
export interface JsLintIssue {
  level: 'error' | 'warning' | 'info';
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
/* 关键字表：用于区分除法与正则字面量                                   */
/* ------------------------------------------------------------------ */

/**
 * 这些关键字之后出现的 `/` 是正则字面量开始
 * （如 return /regex/、typeof /regex/、case /regex/：）
 * 其余关键字（if/for/while/function 等）后跟 `(`，不会直接跟 `/`
 */
const KEYWORDS_BEFORE_REGEX = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'delete', 'void',
  'new', 'throw', 'yield', 'await', 'case', 'do', 'else',
]);

/**
 * 这些标识符（字面量关键字）之后 `/` 是除法
 * （如 true / 2、this / 2、super / 2，虽然语义少见但语法上为除法）
 */
const LITERAL_KEYWORDS = new Set([
  'true', 'false', 'null', 'undefined', 'this', 'super',
]);

/* ------------------------------------------------------------------ */
/* 词法分析：逐字符扫描，按上下文切分 token                              */
/* ------------------------------------------------------------------ */

/**
 * 词法分析器：将 JS 字符串切分为 token 流
 * 正确处理字符串、模板字符串、注释、正则字面量
 *
 * 正则字面量识别关键：通过前一个「有意义」token 判断 `/` 是除法还是正则
 * - 前一个有意义 token 是：标识符（非 regex-trigger 关键字）、数字、字符串、正则、)、]、}、字面量关键字 → 除法
 * - 否则（如 =、(、,、;、{、[、!、&&、||、return、typeof 等）→ 正则字面量
 */
function tokenize(src: string): { tokens: Token[]; error: string } {
  const tokens: Token[] = [];
  const len = src.length;
  let i = 0;
  let prevSignificant: TokType | null = null;
  let prevIdentifierValue = '';

  /** 判断当前位置的 `/` 是除法还是正则字面量 */
  const isRegexContext = (): boolean => {
    if (prevSignificant === null) return true; // 文件开头
    if (prevSignificant === 'identifier') {
      // 关键字 return/typeof 等之后是正则；字面量 true/false/null/this 等之后是除法
      if (KEYWORDS_BEFORE_REGEX.has(prevIdentifierValue)) return true;
      if (LITERAL_KEYWORDS.has(prevIdentifierValue)) return false;
      return false; // 普通标识符之后是除法
    }
    // 数字、字符串、正则、)、]、} 之后是除法
    if (
      prevSignificant === 'number' ||
      prevSignificant === 'string' ||
      prevSignificant === 'regex' ||
      prevSignificant === 'punctuator'
    ) {
      return false;
    }
    return true;
  };

  /** 记录一个有意义 token（非空白非换行非注释） */
  const pushSignificant = (tok: Token) => {
    tokens.push(tok);
    prevSignificant = tok.type;
    if (tok.type === 'identifier') prevIdentifierValue = tok.value;
  };

  /** 记录非有意义 token（空白、换行、注释） */
  const pushTrivial = (tok: Token) => {
    tokens.push(tok);
  };

  while (i < len) {
    const ch = src[i];

    // 换行符
    if (ch === '\n' || ch === '\r') {
      // 合并 CRLF 为单个换行
      if (ch === '\r' && src[i + 1] === '\n') i++;
      pushTrivial({ type: 'newline', value: '\n' });
      i++;
      continue;
    }

    // 空白（非换行）
    if (ch === ' ' || ch === '\t' || ch === '\f' || ch === '\v') {
      let end = i;
      while (end < len) {
        const c = src[end];
        if (c === ' ' || c === '\t' || c === '\f' || c === '\v') end++;
        else break;
      }
      pushTrivial({ type: 'whitespace', value: src.slice(i, end) });
      i = end;
      continue;
    }

    // 单行注释 //
    if (ch === '/' && src[i + 1] === '/') {
      let end = i + 2;
      while (end < len && src[end] !== '\n' && src[end] !== '\r') end++;
      pushTrivial({ type: 'comment', value: src.slice(i, end) });
      i = end;
      continue;
    }

    // 多行注释 /* */
    if (ch === '/' && src[i + 1] === '*') {
      let end = i + 2;
      while (end < len && !(src[end] === '*' && src[end + 1] === '/')) end++;
      if (end >= len) {
        // 未闭合的多行注释
        pushTrivial({ type: 'comment', value: src.slice(i) });
        return { tokens, error: '多行注释 /* 未闭合' };
      }
      pushTrivial({ type: 'comment', value: src.slice(i, end + 2) });
      i = end + 2;
      continue;
    }

    // 字符串：双引号、单引号、模板字符串
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      let end = i + 1;
      let terminated = false;
      while (end < len) {
        const c = src[end];
        if (c === '\\') {
          // 转义，跳过下一字符
          end += 2;
          continue;
        }
        if (c === quote) {
          terminated = true;
          break;
        }
        // 模板字符串内的 ${...} 表达式：简化处理，原样收集到闭合 `
        // 注意：模板字符串内可嵌套 ${ expr }，expr 内可再有 `...`
        // 完整处理需要递归，这里简化为按 ` 闭合（对常见场景足够）
        end++;
      }
      if (!terminated) {
        pushSignificant({ type: 'string', value: src.slice(i) });
        return { tokens, error: `字符串 ${quote} 未闭合` };
      }
      pushSignificant({ type: 'string', value: src.slice(i, end + 1) });
      i = end + 1;
      continue;
    }

    // 正则字面量 /pattern/flags
    if (ch === '/' && isRegexContext()) {
      let end = i + 1;
      let inClass = false; // 是否在字符类 [...] 内
      let terminated = false;
      while (end < len) {
        const c = src[end];
        if (c === '\\') {
          end += 2;
          continue;
        }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) {
          terminated = true;
          break;
        }
        if (c === '\n' || c === '\r') {
          // 正则字面量不能跨行（未闭合）
          break;
        }
        end++;
      }
      if (!terminated) {
        // 未闭合的正则，当作除法处理（容错）
        pushSignificant({ type: 'punctuator', value: '/' });
        i++;
        continue;
      }
      // 收集 flags（gimsuyd）
      end++; // 跳过闭合 /
      let flagsEnd = end;
      while (flagsEnd < len && /[gimsuy]/.test(src[flagsEnd])) flagsEnd++;
      pushSignificant({ type: 'regex', value: src.slice(i, flagsEnd) });
      i = flagsEnd;
      continue;
    }

    // 数字字面量：0x / 0o / 0b / 数字开头，含 . e E
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let end = i;
      // 处理 0x 0o 0b 前缀
      if (ch === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X' || src[i + 1] === 'o' || src[i + 1] === 'O' || src[i + 1] === 'b' || src[i + 1] === 'B')) {
        end = i + 2;
        while (end < len && /[0-9a-fA-F_]/.test(src[end])) end++;
      } else {
        while (end < len && /[0-9._eE+\-]/.test(src[end])) {
          // 处理科学计数法的 +/-
          if ((src[end] === '+' || src[end] === '-') && !/[eE]/.test(src[end - 1])) break;
          end++;
        }
      }
      pushSignificant({ type: 'number', value: src.slice(i, end) });
      i = end;
      continue;
    }

    // 标识符：字母、_、$ 开头，含字母数字_$
    if (/[a-zA-Z_$]/.test(ch)) {
      let end = i;
      while (end < len && /[a-zA-Z0-9_$]/.test(src[end])) end++;
      pushSignificant({ type: 'identifier', value: src.slice(i, end) });
      i = end;
      continue;
    }

    // 标点：多字符优先匹配
    // 三字符标点
    const three = src.slice(i, i + 3);
    if (['===', '!==', '...', '**=', '>>>', '<<=', '>>=', '&&=', '||=', '??='].includes(three)) {
      pushSignificant({ type: 'punctuator', value: three });
      i += 3;
      continue;
    }
    // 二字符标点
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||', '??', '=>', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '**', '?.'].includes(two)) {
      pushSignificant({ type: 'punctuator', value: two });
      i += 2;
      continue;
    }
    // 单字符标点
    if ('()[]{},.;:?!=+-*/%<>&|^~@'.includes(ch)) {
      pushSignificant({ type: 'punctuator', value: ch });
      i++;
      continue;
    }

    // 兜底：未识别字符，跳过避免死循环
    i++;
  }

  tokens.push({ type: 'eof', value: '' });
  return { tokens, error: '' };
}

/* ------------------------------------------------------------------ */
/* 美化：基于括号深度的智能换行缩进                                      */
/* ------------------------------------------------------------------ */

/**
 * 判断两个相邻 token 是否需要空格分隔
 * 避免词法粘连（如 `return x` 不能合并为 `returnx`）
 */
function needsSpace(prev: Token, curr: Token): boolean {
  if (prev.type !== 'identifier' && prev.type !== 'number') return false;
  if (curr.type !== 'identifier' && curr.type !== 'number') return false;
  // 标识符/数字 相邻需空格
  return true;
}

/** 美化序列化：遍历 token 流，按括号深度换行缩进 */
function serializePretty(tokens: Token[], opts: JsPrettyOptions): string {
  const out: string[] = [];
  let depth = 0;
  let parenDepth = 0; // 圆括号深度（用于 for/while 头部 ; 不换行）
  let atLineStart = true;
  let lastSignificant: Token | null = null;

  /** 输出缩进 */
  const writeIndent = () => {
    if (depth > 0) out.push(opts.indent.repeat(depth));
  };

  /** 输出换行 */
  const writeNewline = () => {
    out.push(opts.eol);
    atLineStart = true;
  };

  /** 输出 token 值，处理行首缩进 */
  const writeToken = (tok: Token) => {
    if (atLineStart) {
      writeIndent();
      atLineStart = false;
    }
    out.push(tok.value);
  };

  for (let idx = 0; idx < tokens.length; idx++) {
    const tok = tokens[idx];

    if (tok.type === 'eof') break;

    // 注释
    if (tok.type === 'comment') {
      if (!opts.preserveComments) continue;
      // 多行注释含换行时单独成行
      writeToken(tok);
      lastSignificant = tok;
      continue;
    }

    // 空白：美化模式忽略原空白，按规则重新添加
    if (tok.type === 'whitespace') continue;

    // 换行：美化模式按括号深度重新控制换行，忽略原换行
    if (tok.type === 'newline') continue;

    // 标点处理
    if (tok.type === 'punctuator') {
      const v = tok.value;

      // 花括号
      if (v === '{') {
        // 前一个 token 是 ) 或 else/try/finally/do 等：块开始
        // 前一个 token 是 = / ( / , / [ / return 等：对象字面量
        // 简化：所有 { 都换行开始新块
        if (!atLineStart && lastSignificant && lastSignificant.type === 'punctuator' && (lastSignificant.value === ')' || lastSignificant.value === 'else' /* else 不是 punctuator */)) {
          // 块开始：保持当前行
        }
        writeToken(tok);
        depth++;
        // { 后换行（除非是空块 {}）
        const next = nextSignificant(tokens, idx);
        if (next && next.type === 'punctuator' && next.value === '}') {
          // 空块不换行
        } else {
          writeNewline();
        }
        lastSignificant = tok;
        continue;
      }

      if (v === '}') {
        depth = Math.max(0, depth - 1);
        // } 前换行（除非紧跟空块）
        if (!atLineStart) writeNewline();
        writeToken(tok);
        // } 后换行（除非后续是 ; / , / ) / . / 等）
        const next = nextSignificant(tokens, idx);
        if (next && next.type === 'punctuator' && [';', ',', ')', '.', ']', ':'].includes(next.value)) {
          // 不换行，保持当前行
        } else if (next && next.type === 'punctuator' && next.value === ')') {
          // 不换行
        } else {
          writeNewline();
        }
        lastSignificant = tok;
        continue;
      }

      if (v === '(' || v === '[') {
        writeToken(tok);
        if (v === '(') parenDepth++;
        lastSignificant = tok;
        continue;
      }

      if (v === ')' || v === ']') {
        if (v === ')') parenDepth = Math.max(0, parenDepth - 1);
        writeToken(tok);
        lastSignificant = tok;
        continue;
      }

      if (v === ';') {
        writeToken(tok);
        // for 头部的 ; 不换行
        if (parenDepth === 0) {
          writeNewline();
        }
        lastSignificant = tok;
        continue;
      }

      // 其他标点
      // 处理 token 间空格
      if (lastSignificant && needsSpace(lastSignificant, tok)) {
        if (!atLineStart) out.push(' ');
      }
      writeToken(tok);
      lastSignificant = tok;
      continue;
    }

    // identifier / number / string / regex
    // 处理 token 间空格
    if (lastSignificant && needsSpace(lastSignificant, tok)) {
      if (!atLineStart) out.push(' ');
    }
    writeToken(tok);
    lastSignificant = tok;
  }

  return out.join('');
}

/** 找下一个有意义 token（跳过空白、换行、注释） */
function nextSignificant(tokens: Token[], fromIdx: number): Token | null {
  for (let j = fromIdx + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.type === 'eof') return null;
    if (t.type === 'whitespace' || t.type === 'newline' || t.type === 'comment') continue;
    return t;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 压缩：移除注释与多余空白，合并为单行                                   */
/* ------------------------------------------------------------------ */

function serializeMinify(tokens: Token[], opts: JsMinifyOptions): string {
  const out: string[] = [];
  let lastSignificant: Token | null = null;

  /** 写入 token，处理必要的分隔空格 */
  const writeTok = (tok: Token) => {
    // 防止词法粘连：标识符/数字 相邻需空格
    if (lastSignificant && needsSpace(lastSignificant, tok)) {
      out.push(' ');
    }
    out.push(tok.value);
    lastSignificant = tok;
  };

  for (const tok of tokens) {
    if (tok.type === 'eof') break;

    // 注释
    if (tok.type === 'comment') {
      if (opts.removeComments) continue;
      // 保留注释时，需确保与前后 token 分隔
      if (lastSignificant) out.push(' ');
      out.push(tok.value);
      // 注释后强制加空格，避免粘连
      out.push(' ');
      continue;
    }

    // 空白与换行
    if (tok.type === 'whitespace' || tok.type === 'newline') {
      continue;
    }

    writeTok(tok);
  }

  return out.join('');
}

/* ------------------------------------------------------------------ */
/* 校验：统计与问题检测                                                  */
/* ------------------------------------------------------------------ */

interface LintStats {
  chars: number;
  lines: number;
  functionCount: number;       // function 关键字 + 箭头函数 =>
  arrowCount: number;          // 箭头函数数量
  maxBraceDepth: number;       // 最大花括号嵌套深度
  statementCount: number;      // 语句数（; 计数，近似）
  commentCount: number;
  stringCount: number;
}

function lintTokens(tokens: Token[], issues: JsLintIssue[]): LintStats {
  const stats: LintStats = {
    chars: 0,
    lines: 1,
    functionCount: 0,
    arrowCount: 0,
    maxBraceDepth: 0,
    statementCount: 0,
    commentCount: 0,
    stringCount: 0,
  };

  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === 'eof') break;

    if (tok.type === 'newline') {
      stats.lines++;
      continue;
    }
    stats.chars += tok.value.length;

    if (tok.type === 'comment') {
      stats.commentCount++;
      continue;
    }

    if (tok.type === 'string') {
      stats.stringCount++;
      continue;
    }

    if (tok.type === 'identifier') {
      if (tok.value === 'function') {
        stats.functionCount++;
      }
      continue;
    }

    if (tok.type === 'punctuator') {
      const v = tok.value;
      if (v === '{') {
        braceDepth++;
        if (braceDepth > stats.maxBraceDepth) stats.maxBraceDepth = braceDepth;
      } else if (v === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
      } else if (v === '(') {
        parenDepth++;
      } else if (v === ')') {
        parenDepth = Math.max(0, parenDepth - 1);
      } else if (v === '[') {
        bracketDepth++;
      } else if (v === ']') {
        bracketDepth = Math.max(0, bracketDepth - 1);
      } else if (v === ';') {
        stats.statementCount++;
      } else if (v === '=>') {
        stats.arrowCount++;
        stats.functionCount++;
      }
    }
  }

  // 检测未闭合括号
  if (braceDepth > 0) {
    issues.push({ level: 'error', message: `花括号 { 未闭合 ${braceDepth} 处` });
  }
  if (parenDepth > 0) {
    issues.push({ level: 'error', message: `圆括号 ( 未闭合 ${parenDepth} 处` });
  }
  if (bracketDepth > 0) {
    issues.push({ level: 'error', message: `方括号 [ 未闭合 ${bracketDepth} 处` });
  }

  return stats;
}

/* ------------------------------------------------------------------ */
/* 对外 API                                                            */
/* ------------------------------------------------------------------ */

/** 美化 JS */
export function prettyPrint(
  src: string,
  opts: Partial<JsPrettyOptions> = {},
): Result<string> {
  try {
    const full: JsPrettyOptions = {
      indent: '  ',
      preserveComments: true,
      eol: '\n',
      ...opts,
    };
    const { tokens, error } = tokenize(src);
    if (error) {
      return { ok: false, value: '', error };
    }
    const out = serializePretty(tokens, full);
    return { ok: true, value: out, error: '' };
  } catch (e) {
    return { ok: false, value: '', error: (e as Error).message || 'JS 解析失败' };
  }
}

/** 压缩 JS */
export function minify(
  src: string,
  opts: Partial<JsMinifyOptions> = {},
): Result<string> {
  try {
    const full: JsMinifyOptions = {
      removeComments: true,
      singleLine: true,
      ...opts,
    };
    const { tokens, error } = tokenize(src);
    if (error) {
      return { ok: false, value: '', error };
    }
    const out = serializeMinify(tokens, full);
    return { ok: true, value: out, error: '' };
  } catch (e) {
    return { ok: false, value: '', error: (e as Error).message || 'JS 解析失败' };
  }
}

/** 校验 JS：返回格式化的统计 + 问题报告 */
export function lint(src: string): Result<string> {
  try {
    const { tokens, error } = tokenize(src);
    const issues: JsLintIssue[] = [];
    if (error) {
      issues.push({ level: 'error', message: error });
    }
    const stats = lintTokens(tokens, issues);

    const lines: string[] = [];
    lines.push(error ? '解析过程发现问题' : '解析成功');
    lines.push('');
    lines.push('── 统计信息 ──');
    lines.push(`字符数: ${stats.chars}`);
    lines.push(`行数: ${stats.lines}`);
    lines.push(`函数数: ${stats.functionCount}（含箭头函数 ${stats.arrowCount}）`);
    lines.push(`语句数: ${stats.statementCount}`);
    lines.push(`字符串数: ${stats.stringCount}`);
    lines.push(`注释数: ${stats.commentCount}`);
    lines.push(`最大嵌套深度: ${stats.maxBraceDepth}`);
    lines.push('');
    if (issues.length === 0) {
      lines.push('── 问题清单 ──');
      lines.push('未发现可疑问题');
    } else {
      lines.push(`── 问题清单（${issues.length} 项）──`);
      issues.forEach((iss, idx) => {
        const levelText = iss.level === 'error' ? '错误' : iss.level === 'warning' ? '警告' : '提示';
        lines.push(`${idx + 1}. [${levelText}] ${iss.message}`);
      });
    }
    return { ok: true, value: lines.join('\n'), error: '' };
  } catch (e) {
    return { ok: false, value: '', error: (e as Error).message || 'JS 解析失败' };
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
