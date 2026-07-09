/**
 * SQL 格式化与压缩核心工具函数
 *
 * 仅包含纯函数：词法分析、格式化、压缩、校验、高亮。
 * 不依赖 DOM 与浏览器 API，便于 SSR 与单测。
 *
 * 主要能力：
 *  - 美化：关键字大写、主子句换行、JOIN 前换行、子查询缩进、AND/OR 前换行、逗号后空格
 *  - 压缩：移除多余空白与换行，仅保留必要单空格
 *  - 校验：基础语法检查（引号/括号配对、关键字拼写、分号位置）
 *  - 高亮：关键字 / 字符串 / 数字 / 注释 / 标识符分色（HTML 字符串）
 *  - 预设：6 个常见 SQL 模板（SELECT / JOIN / INSERT / UPDATE / DELETE / CREATE）
 */

/** 格式化选项 */
export interface FormatOptions {
  /** 关键字大小写：upper 大写 / lower 小写 / preserve 保持原样 */
  keywordCase: 'upper' | 'lower' | 'preserve';
  /** 主子句前是否换行（SELECT/FROM/WHERE/GROUP BY/HAVING/ORDER BY/LIMIT/OFFSET/UNION 等） */
  newLineBeforeMajorClause: boolean;
  /** JOIN 前是否换行 */
  newLineBeforeJoin: boolean;
  /** AND/OR 前是否换行 */
  newLineBeforeAndOr: boolean;
  /** 逗号后空格（true）或换行（false） */
  commaStyle: 'space' | 'newline';
  /** 缩进空格数（2/4） */
  indent: 2 | 4;
}

/** 默认格式化选项 */
export const DEFAULT_FORMAT_OPTIONS: FormatOptions = {
  keywordCase: 'upper',
  newLineBeforeMajorClause: true,
  newLineBeforeJoin: true,
  newLineBeforeAndOr: false,
  commaStyle: 'space',
  indent: 2,
};

/** 校验结果项 */
export interface ValidationIssue {
  /** 严重级别 */
  level: 'error' | 'warning';
  /** 行号（从 1 开始） */
  line: number;
  /** 列号（从 1 开始） */
  column: number;
  /** 问题描述 */
  message: string;
}

/** 校验结果 */
export interface ValidationResult {
  /** 是否通过（无 error） */
  ok: boolean;
  /** 发现的问题列表 */
  issues: ValidationIssue[];
}

// ============================================================
// 关键字分类
// ============================================================

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

/** AND / OR 连接词 */
const AND_OR = new Set(['AND', 'OR', 'ON', 'USING']);

/** 函数名（用于避免被当作通用标识符） */
const FUNCTIONS = new Set([
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'NOW', 'CURRENT_TIMESTAMP',
  'CURRENT_DATE', 'CURRENT_TIME', 'COALESCE', 'NULLIF', 'CAST', 'CONVERT',
  'CONCAT', 'SUBSTRING', 'TRIM', 'LENGTH', 'LOWER', 'UPPER', 'REPLACE',
  'DATE', 'DATE_FORMAT', 'EXTRACT', 'IFNULL', 'IF', 'CASE', 'WHEN', 'THEN',
  'ELSE', 'END',
]);

/** 数据类型关键字 */
const TYPES = new Set([
  'INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'TINYINT', 'DECIMAL', 'NUMERIC',
  'FLOAT', 'DOUBLE', 'REAL', 'CHAR', 'VARCHAR', 'TEXT', 'BLOB', 'BOOLEAN',
  'BOOL', 'DATE', 'TIME', 'DATETIME', 'TIMESTAMP', 'JSON', 'UUID', 'SERIAL',
]);

/** 所有需要识别的关键字集合（合并去重） */
const ALL_KEYWORDS = new Set<string>([
  ...MAJOR_CLAUSES, ...JOIN_CLAUSES, ...AND_OR, ...FUNCTIONS, ...TYPES,
  'BY', 'ASC', 'DESC', 'DISTINCT', 'ALL', 'AS', 'NOT', 'NULL', 'IS', 'IN',
  'LIKE', 'BETWEEN', 'EXISTS', 'ANY', 'SOME', 'TRUE', 'FALSE', 'DEFAULT',
  'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE', 'CHECK', 'CONSTRAINT',
  'TABLE', 'INDEX', 'VIEW', 'DATABASE', 'SCHEMA', 'INTO', 'ADD', 'COLUMN',
  'MODIFY', 'RENAME', 'CASCADE', 'AUTO_INCREMENT', 'TEMPORARY', 'IF', 'BEGIN',
  'COMMIT', 'ROLLBACK', 'GRANT', 'REVOKE', 'PRIVILEGES', 'PUBLIC', 'ENGINE',
  'CHARSET', 'COLLATE', 'COMMENT',
]);

/**
 * 判断一个标识符是否为关键字（不区分大小写）
 * 用小写比较避免大小写差异
 */
function isKeyword(word: string): boolean {
  return ALL_KEYWORDS.has(word.toUpperCase());
}

/** 判断是否为主子句关键字 */
export function isMajorClause(word: string): boolean {
  return MAJOR_CLAUSES.has(word.toUpperCase());
}

/** 判断是否为 JOIN 系列 */
export function isJoinClause(word: string): boolean {
  return JOIN_CLAUSES.has(word.toUpperCase());
}

/** 判断是否为 AND/OR/ON/USING */
export function isAndOr(word: string): boolean {
  return AND_OR.has(word.toUpperCase());
}

// ============================================================
// 词法分析
// ============================================================

/** Token 类型 */
export type TokenType =
  | 'whitespace'    // 空白（含换行）
  | 'comment'       // 注释（-- 行注释 / /* 块注释 */）
  | 'string'        // 字符串字面量（单引号 / 双引号标识符）
  | 'number'        // 数字字面量
  | 'identifier'    // 标识符（含点分 a.b.c）
  | 'keyword'       // 关键字
  | 'punctuation'   // 标点（逗号 / 括号 / 分号 / 星号 / 运算符）
  | 'parameter';    // 参数占位（? / :name / @name / $n）

/** Token 结构 */
export interface Token {
  type: TokenType;
  /** 原始文本 */
  raw: string;
  /** 转大写后的文本（仅 keyword 有意义） */
  upper: string;
  /** 起始列号 */
  col: number;
}

/**
 * 词法分析：将 SQL 字符串切分为 token 序列
 *
 * 实现要点：
 *  - 单引号字符串：'' 转义为单引号字面
 *  - 双引号在标准 SQL 中是标识符引用，本工具统一识别为 string 类型（不影响格式化）
 *  - 注释：-- 至行尾 / # 至行尾（MySQL） / /* 块注释 *\/（不支持嵌套）
 *  - 数字：整数 / 小数 / 科学计数法 / 十六进制 0x...
 *  - 标识符：[A-Za-z_][A-Za-z0-9_]*（含点分）
 *  - 参数：? / :name / @name / $n
 */
export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  const len = sql.length;
  let i = 0;
  let col = 1;

  while (i < len) {
    const ch = sql[i];

    // 1. 空白字符
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      let j = i;
      let raw = '';
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
      let j = i;
      let raw = '';
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
      let j = i + 2;
      let raw = '/*';
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

    // 4. 单引号字符串（'' 转义）
    if (ch === "'") {
      let j = i + 1;
      let raw = "'";
      while (j < len) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          raw += "''";
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          raw += "'";
          j++;
          break;
        }
        raw += sql[j];
        j++;
      }
      tokens.push({ type: 'string', raw, upper: raw, col });
      i = j;
      continue;
    }

    // 5. 双引号标识符 / 字符串（MySQL 反引号同样处理）
    if (ch === '"' || ch === '`') {
      const quote = ch;
      let j = i + 1;
      let raw = quote;
      while (j < len && sql[j] !== quote) {
        raw += sql[j];
        j++;
      }
      if (j < len) {
        raw += quote;
        j++;
      }
      tokens.push({ type: 'string', raw, upper: raw, col });
      i = j;
      continue;
    }

    // 6. 数字（含小数 / 科学计数法 / 十六进制）
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(sql[i + 1] || ''))) {
      let j = i;
      let raw = '';
      // 十六进制 0x...
      if (ch === '0' && (sql[i + 1] === 'x' || sql[i + 1] === 'X')) {
        raw += '0' + sql[i + 1];
        j = i + 2;
        while (j < len && /[0-9a-fA-F]/.test(sql[j])) {
          raw += sql[j];
          j++;
        }
      } else {
        while (j < len && /[0-9]/.test(sql[j])) {
          raw += sql[j];
          j++;
        }
        if (sql[j] === '.' && /[0-9]/.test(sql[j + 1] || '')) {
          raw += '.';
          j++;
          while (j < len && /[0-9]/.test(sql[j])) {
            raw += sql[j];
            j++;
          }
        }
        if (sql[j] === 'e' || sql[j] === 'E') {
          raw += sql[j];
          j++;
          if (sql[j] === '+' || sql[j] === '-') {
            raw += sql[j];
            j++;
          }
          while (j < len && /[0-9]/.test(sql[j])) {
            raw += sql[j];
            j++;
          }
        }
      }
      tokens.push({ type: 'number', raw, upper: raw, col });
      i = j;
      continue;
    }

    // 7. 标识符 / 关键字（含点分 a.b.c）
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      let raw = '';
      // 标识符主体
      while (j < len && /[A-Za-z0-9_]/.test(sql[j])) {
        raw += sql[j];
        j++;
      }
      // 点分前缀：a.b.c（每段必须以字母或下划线开头）
      while (sql[j] === '.' && /[A-Za-z_]/.test(sql[j + 1] || '')) {
        raw += '.';
        j++;
        while (j < len && /[A-Za-z0-9_]/.test(sql[j])) {
          raw += sql[j];
          j++;
        }
      }
      const upper = raw.toUpperCase();
      // 仅当不包含点且全词匹配关键字时才识别为 keyword
      const type: TokenType =
        !raw.includes('.') && isKeyword(raw) ? 'keyword' : 'identifier';
      tokens.push({ type, raw, upper, col });
      i = j;
      continue;
    }

    // 8. 参数占位符 ? :name @name $n
    if (ch === '?' || ch === ':' || ch === '@' || ch === '$') {
      const next = sql[i + 1] || '';
      if (ch === '?') {
        tokens.push({ type: 'parameter', raw: '?', upper: '?', col });
        i++;
        continue;
      }
      // :name / @name 必须后跟字母或下划线
      if ((ch === ':' || ch === '@') && /[A-Za-z_]/.test(next)) {
        let j = i + 1;
        let raw = ch;
        while (j < len && /[A-Za-z0-9_]/.test(sql[j])) {
          raw += sql[j];
          j++;
        }
        tokens.push({ type: 'parameter', raw, upper: raw, col });
        i = j;
        continue;
      }
      // $n（PostgreSQL 位置参数）
      if (ch === '$' && /[0-9]/.test(next)) {
        let j = i + 1;
        let raw = '$';
        while (j < len && /[0-9]/.test(sql[j])) {
          raw += sql[j];
          j++;
        }
        tokens.push({ type: 'parameter', raw, upper: raw, col });
        i = j;
        continue;
      }
      // 不构成参数时按标点处理
    }

    // 9. 多字符运算符（<=, >=, <>, !=, ||, ::）
    const two = sql.substring(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>' || two === '!=' ||
        two === '||' || two === '::') {
      tokens.push({ type: 'punctuation', raw: two, upper: two, col });
      i += 2;
      continue;
    }

    // 10. 单字符标点
    tokens.push({ type: 'punctuation', raw: ch, upper: ch, col });
    i++;
  }

  return tokens;
}

// ============================================================
// 格式化（美化）
// ============================================================

/** 将关键字按选项转换大小写 */
function applyKeywordCase(word: string, opts: FormatOptions): string {
  if (opts.keywordCase === 'upper') return word.toUpperCase();
  if (opts.keywordCase === 'lower') return word.toLowerCase();
  return word;
}

/** 生成缩进字符串 */
function makeIndent(depth: number, opts: FormatOptions): string {
  return ' '.repeat(depth * opts.indent);
}

/**
 * SQL 美化（格式化）
 *
 * 实现思路：
 *  1. tokenize 切词
 *  2. 遍历 token，按规则生成输出
 *  3. 维护缩进深度：括号 +1、子查询 +1、CASE/WHEN +1
 *  4. 主子句前换行 + 缩进归零；JOIN 前换行；AND/OR 前换行（可选）
 *  5. 逗号后空格或换行（commaStyle）
 *  6. 跳过原始空白，由我们重新生成
 */
export function formatSql(sql: string, options: FormatOptions = DEFAULT_FORMAT_OPTIONS): string {
  if (!sql.trim()) return '';
  const tokens = tokenize(sql);
  const out: string[] = [];
  let depth = 0;          // 当前缩进深度
  let parenDepth = 0;     // 括号嵌套深度
  let needSpace = false;  // 前一个 token 是否需要后接空格
  let afterNewline = true;// 当前是否处于行首（用于去重空格）

  /** 追加一个 token 文本（自动处理前导空格） */
  const push = (text: string, opts: { spaceBefore?: boolean; noSpace?: boolean } = {}) => {
    if (opts.spaceBefore && needSpace && !afterNewline) {
      out.push(' ');
    }
    out.push(text);
    needSpace = !opts.noSpace;
    afterNewline = false;
  };

  /** 换行并缩进 */
  const newline = () => {
    // 移除尾部已有空格
    while (out.length && out[out.length - 1] === ' ') out.pop();
    out.push('\n');
    out.push(makeIndent(depth, options));
    needSpace = false;
    afterNewline = true;
  };

  for (let idx = 0; idx < tokens.length; idx++) {
    const tok = tokens[idx];
    const next = tokens[idx + 1];

    // 跳过原始空白，由我们统一重新生成
    if (tok.type === 'whitespace') continue;

    if (tok.type === 'comment') {
      // 注释保留原样，前加空格或换行
      if (!afterNewline && needSpace) out.push(' ');
      out.push(tok.raw);
      // 行注释后强制换行
      if (tok.raw.startsWith('--') || tok.raw.startsWith('#')) {
        newline();
      } else {
        needSpace = true;
        afterNewline = false;
      }
      continue;
    }

    if (tok.type === 'string' || tok.type === 'number' || tok.type === 'parameter') {
      push(tok.raw, { spaceBefore: true });
      continue;
    }

    if (tok.type === 'identifier') {
      push(tok.raw, { spaceBefore: true });
      continue;
    }

    if (tok.type === 'punctuation') {
      const raw = tok.raw;
      if (raw === '(') {
        parenDepth++;
        // 函数名后紧贴左括号：前一个 token 是标识符或关键字函数时不加空格
        const prevNonWs = tokens[idx - 1];
        const noSpaceBefore = prevNonWs &&
          (prevNonWs.type === 'identifier' ||
           (prevNonWs.type === 'keyword' && FUNCTIONS.has(prevNonWs.upper)));
        push('(', { noSpace: true, spaceBefore: !noSpaceBefore });
        // IN ( / NOT IN ( 后不缩进，但子查询（SELECT ...）需要缩进
        const peekUpper = next?.upper || '';
        if (next && next.type === 'keyword' && next.upper === 'SELECT') {
          depth++;
          newline();
        }
      } else if (raw === ')') {
        parenDepth = Math.max(0, parenDepth - 1);
        // 子查询结束：先减少缩进再输出 )
        if (depth > 0) {
          depth--;
          // 让 ) 与子查询内容对齐：移除当前行已有的缩进后重新缩进
          newline();
        }
        push(')', { noSpace: true });
      } else if (raw === ',') {
        push(',', { noSpace: true });
        if (options.commaStyle === 'newline') {
          newline();
        } else {
          needSpace = true;
        }
      } else if (raw === ';') {
        push(';', { noSpace: true });
        // 语句分隔符后换行 + 重置缩进
        depth = 0;
        newline();
      } else if (raw === '.') {
        push('.', { noSpace: true });
      } else {
        // 其他运算符（+ - * / = < > 等）
        push(raw, { spaceBefore: true });
      }
      continue;
    }

    if (tok.type === 'keyword') {
      const upper = tok.upper;

      // GROUP BY / ORDER BY / PARTITION BY 等双词关键字合并
      // 当下一个非空白 token 是 BY 时，本次输出后保持空格
      const isCompoundStart =
        (upper === 'GROUP' || upper === 'ORDER' || upper === 'PARTITION') &&
        next && next.type === 'keyword' && next.upper === 'BY';

      // 主子句前换行 + 缩进归零
      // 注意：BY 单独不换行（跟随前面的 GROUP/ORDER/PARTITION）
      if (upper === 'BY') {
        // BY 紧跟前面的 GROUP/ORDER/PARTITION，仅加空格
        push(applyKeywordCase(tok.raw, options), { spaceBefore: true });
        continue;
      }
      if (options.newLineBeforeMajorClause && isMajorClause(upper) && !isCompoundStart) {
        if (out.length > 0) {
          depth = 0;
          newline();
        }
      } else if (options.newLineBeforeJoin && isJoinClause(upper)) {
        // JOIN 前换行（不重置缩进）
        if (out.length > 0) newline();
      } else if (options.newLineBeforeAndOr && isAndOr(upper)) {
        if (out.length > 0) newline();
      }

      // CASE / BEGIN 增加缩进
      if (upper === 'CASE' || upper === 'BEGIN') {
        push(applyKeywordCase(tok.raw, options), { spaceBefore: true });
        depth++;
        // CASE 后紧跟 WHEN，由 WHEN 自己换行，避免重复换行产生空行；
        // BEGIN 后跟独立语句，需主动换行
        if (upper === 'BEGIN' && next) newline();
        continue;
      }
      // WHEN / ELSE 前换行（保持 CASE 已增加的缩进，不再调整 depth）
      if (upper === 'WHEN' || upper === 'ELSE') {
        if (out.length > 0) newline();
        push(applyKeywordCase(tok.raw, options), { spaceBefore: false });
        continue;
      }
      if (upper === 'THEN') {
        push(applyKeywordCase(tok.raw, options), { spaceBefore: true });
        continue;
      }
      if (upper === 'END') {
        depth = Math.max(0, depth - 1);
        if (out.length > 0) newline();
        push(applyKeywordCase(tok.raw, options), { spaceBefore: false });
        continue;
      }

      push(applyKeywordCase(tok.raw, options), { spaceBefore: true });
      continue;
    }
  }

  // 清理：移除尾部空白
  const result = out.join('').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  // 已以分号结尾则直接返回
  if (result.endsWith(';')) return result;
  // 若末尾为行注释（-- ...），分号需另起一行，否则会被注释吞掉改变 SQL 语义
  const lastLine = result.split('\n').pop() || '';
  if (lastLine.includes('--')) return result + '\n;';
  return result + ';';
}

// ============================================================
// 压缩（Minify）
// ============================================================

/**
 * SQL 压缩：移除多余空白与换行，保留必要单空格
 *
 * 保留：
 *  - 注释（可选移除）
 *  - 字符串字面量原样
 *  - 标识符与关键字之间的单个空格
 *  - 逗号 / 分号后单个空格
 */
export function minifySql(sql: string, removeComments = false): string {
  if (!sql.trim()) return '';
  const tokens = tokenize(sql);
  const out: string[] = [];
  let prev: Token | null = null;

  for (const tok of tokens) {
    if (tok.type === 'whitespace') continue;
    if (tok.type === 'comment' && removeComments) continue;

    // 判断是否需要前导空格
    if (prev && needSpaceBetween(prev, tok)) {
      out.push(' ');
    }
    out.push(tok.raw);
    prev = tok;
  }

  return out.join('').trim();
}

/** 判断两个 token 之间是否需要空格 */
function needSpaceBetween(prev: Token, cur: Token): boolean {
  // 注释前后都需要空格
  if (prev.type === 'comment' || cur.type === 'comment') return true;
  // 标点规则
  if (prev.type === 'punctuation' || cur.type === 'punctuation') {
    const p = prev.raw;
    const c = cur.raw;
    // 函数名后紧跟 ( 不加空格
    if (c === '(' && (prev.type === 'identifier' ||
        (prev.type === 'keyword' && FUNCTIONS.has(prev.upper)))) return false;
    // . 不加空格（a.b.c）
    if (p === '.' || c === '.') return false;
    // , ; 后加空格
    if (p === ',' || p === ';') return true;
    // ( 后不加空格
    if (p === '(') return false;
    // ) 前不加空格
    if (c === ')') return false;
    // 其他标点组合（如 = < >）前后加空格
    return true;
  }
  // 标识符 / 关键字 / 字符串 / 数字 / 参数之间需要空格
  return true;
}

// ============================================================
// 校验
// ============================================================

/**
 * 基础 SQL 语法校验
 *
 * 不做完整语法分析，仅检查常见错误：
 *  - 引号未闭合
 *  - 括号不配对
 *  - 块注释未闭合
 *  - SELECT 后缺少 FROM（warning，子查询场景可能误报）
 *  - 多条语句间未用分号分隔（warning）
 */
export function validateSql(sql: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!sql.trim()) {
    return { ok: true, issues };
  }

  // 利用 tokenize 的结果分析
  const tokens = tokenize(sql);
  let line = 1;
  let col = 1;
  let parenBalance = 0;
  let lastParenLine = 0;
  let lastParenCol = 0;
  const stack: string[] = [];

  /** 估算 token 末尾的行列位置 */
  const advance = (raw: string) => {
    for (const ch of raw) {
      if (ch === '\n') { line++; col = 1; }
      else col++;
    }
  };

  for (const tok of tokens) {
    if (tok.type === 'whitespace') {
      advance(tok.raw);
      continue;
    }
    if (tok.type === 'string') {
      // 检查字符串是否闭合（原始文本首尾应同为引号）
      const first = tok.raw[0];
      const last = tok.raw[tok.raw.length - 1];
      if ((first === "'" && last !== "'") || (first === '"' && last !== '"') ||
          (first === '`' && last !== '`')) {
        issues.push({
          level: 'error',
          line,
          column: tok.col,
          message: '字符串或标识符引号未闭合',
        });
      }
      advance(tok.raw);
      continue;
    }
    if (tok.type === 'comment') {
      // 块注释未闭合（首尾不匹配）
      if (tok.raw.startsWith('/*') && !tok.raw.endsWith('*/')) {
        issues.push({
          level: 'error',
          line,
          column: tok.col,
          message: '块注释 /* 未闭合，缺少 */',
        });
      }
      advance(tok.raw);
      continue;
    }
    if (tok.type === 'punctuation') {
      if (tok.raw === '(') {
        parenBalance++;
        stack.push('(');
        lastParenLine = line;
        lastParenCol = tok.col;
      } else if (tok.raw === ')') {
        parenBalance--;
        if (stack.length === 0) {
          issues.push({
            level: 'error',
            line,
            column: tok.col,
            message: '多余的右括号 )，无匹配的左括号',
          });
        } else {
          stack.pop();
        }
      }
    }
    advance(tok.raw);
  }

  // 括号总数不平衡
  if (parenBalance > 0) {
    issues.push({
      level: 'error',
      line: lastParenLine,
      column: lastParenCol,
      message: `左括号 ( 未闭合，缺少 ${parenBalance} 个右括号 )`,
    });
  }

  // 检查 SELECT 后是否有 FROM 或 VALUES（仅 warning，子查询/常数 SELECT 可能误报）
  const upperSql = sql.toUpperCase();
  const selectMatch = upperSql.match(/\bSELECT\b/);
  if (selectMatch && !/\bFROM\b|\bVALUES\b|\bINTO\b/.test(upperSql)) {
    // 仅当无 FROM 且无 VALUES 且无 INTO 时给出提示
    // 注意：SELECT 1 + 1; 是合法的常数查询，这里只做 warning 不阻塞
    // 为避免误报，仅当语句较长（>30 字符）且不含函数调用时不提示
    if (sql.length > 30 && !/\(/.test(sql)) {
      issues.push({
        level: 'warning',
        line: 1,
        column: selectMatch.index ? selectMatch.index + 1 : 1,
        message: 'SELECT 语句缺少 FROM 子句（若是常数查询可忽略）',
      });
    }
  }

  // 检查分号是否在字符串外（已在 tokenize 中处理）
  // 检查语句末尾是否缺少分号（warning）
  const trimmed = sql.trim();
  if (trimmed && !trimmed.endsWith(';') && !trimmed.endsWith('*/') &&
      !trimmed.endsWith('--') && !trimmed.endsWith('\n')) {
    issues.push({
      level: 'warning',
      line,
      column: 1,
      message: '语句末尾建议以分号 ; 结尾',
    });
  }

  return {
    ok: !issues.some(i => i.level === 'error'),
    issues,
  };
}

// ============================================================
// 语法高亮（HTML 字符串）
// ============================================================

/** HTML 转义，避免注入 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * SQL 语法高亮：返回 HTML 字符串（带 <span class="..."> 包裹）
 *
 * 类名约定（与 sql.astro 样式配合）：
 *  - .sql-kw  关键字
 *  - .sql-str 字符串
 *  - .sql-num 数字
 *  - .sql-cmt 注释
 *  - .sql-id  标识符
 *  - .sql-pun 标点
 *  - .sql-par 参数
 */
export function highlightSql(sql: string): string {
  if (!sql.trim()) return '';
  const tokens = tokenize(sql);
  const out: string[] = [];

  for (const tok of tokens) {
    const escaped = escapeHtml(tok.raw);
    switch (tok.type) {
      case 'whitespace':
        out.push(escaped);
        break;
      case 'comment':
        out.push(`<span class="sql-cmt">${escaped}</span>`);
        break;
      case 'string':
        out.push(`<span class="sql-str">${escaped}</span>`);
        break;
      case 'number':
        out.push(`<span class="sql-num">${escaped}</span>`);
        break;
      case 'parameter':
        out.push(`<span class="sql-par">${escaped}</span>`);
        break;
      case 'identifier':
        out.push(`<span class="sql-id">${escaped}</span>`);
        break;
      case 'keyword':
        out.push(`<span class="sql-kw">${escaped}</span>`);
        break;
      case 'punctuation':
        out.push(`<span class="sql-pun">${escaped}</span>`);
        break;
    }
  }
  return out.join('');
}

// ============================================================
// 预设示例
// ============================================================

export interface SqlPreset {
  /** 预设标识 */
  id: string;
  /** 预设名称 */
  label: string;
  /** 简介 */
  description: string;
  /** SQL 内容 */
  sql: string;
}

/** 6 个常见 SQL 模板 */
export const SQL_PRESETS: SqlPreset[] = [
  {
    id: 'select',
    label: 'SELECT 查询',
    description: '基础多字段查询与过滤',
    sql: `select id, name, email, created_at from users where status = 'active' and created_at >= '2024-01-01' order by created_at desc limit 10;`,
  },
  {
    id: 'join',
    label: 'JOIN 多表',
    description: '内连接与左连接组合',
    sql: `select o.id, u.name as user_name, p.title as product, o.quantity, o.total_price from orders as o inner join users as u on o.user_id = u.id left join products as p on o.product_id = p.id where o.status = 'paid' order by o.id desc;`,
  },
  {
    id: 'insert',
    label: 'INSERT 插入',
    description: '单条与批量插入',
    sql: `insert into users (name, email, status, created_at) values ('张三', 'zhangsan@example.com', 'active', now()), ('李四', 'lisi@example.com', 'active', now());`,
  },
  {
    id: 'update',
    label: 'UPDATE 更新',
    description: '条件更新与字段计算',
    sql: `update products set stock = stock - 1, updated_at = now() where id = 100 and stock > 0;`,
  },
  {
    id: 'delete',
    label: 'DELETE 删除',
    description: '条件删除与子查询过滤',
    sql: `delete from orders where user_id in (select id from users where status = 'deleted') and created_at < '2023-01-01';`,
  },
  {
    id: 'create',
    label: 'CREATE 建表',
    description: '带主键外键的表结构',
    sql: `create table if not exists orders (id bigint primary key auto_increment, user_id bigint not null, product_id bigint not null, quantity int not null default 1, total_price decimal(10, 2) not null, status varchar(20) default 'pending', created_at timestamp default current_timestamp, foreign key (user_id) references users(id), foreign key (product_id) references products(id));`,
  },
];

/** 统计 SQL 中的关键字数量（用于工具页信息展示） */
export function countStats(sql: string): {
  keywords: number;
  strings: number;
  numbers: number;
  comments: number;
  lines: number;
  chars: number;
} {
  const tokens = tokenize(sql);
  let keywords = 0;
  let strings = 0;
  let numbers = 0;
  let comments = 0;
  for (const t of tokens) {
    if (t.type === 'keyword') keywords++;
    else if (t.type === 'string') strings++;
    else if (t.type === 'number') numbers++;
    else if (t.type === 'comment') comments++;
  }
  const lines = sql.trim() ? sql.trim().split('\n').length : 0;
  return {
    keywords, strings, numbers, comments,
    lines, chars: sql.length,
  };
}
