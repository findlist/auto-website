/**
 * HTML 转 Markdown 转换引擎
 *
 * 设计目标：
 *  - 纯原生 TypeScript + 浏览器 DOMParser 零依赖实现 HTML → Markdown 单向转换
 *  - 基于 HTML5 容错解析（text/html 模式），自动修复未闭合标签
 *  - 递归遍历 DOM 树，按节点类型分派到块级 / 行内渲染器
 *  - 支持 GFM 扩展：任务列表、表格、删除线、围栏代码块
 *  - 与现有 MarkdownTool（MD → HTML 预览器）形成双向转换互补
 *
 * 安全策略：
 *  - 默认忽略 script / style / template / noscript / iframe 等非内容标签
 *  - 纯本地处理，不发起任何网络请求
 *  - 输出 Markdown 纯文本，不含可执行代码
 */

/** 转换选项 */
export interface HtmlToMarkdownOptions {
  /** 标题风格：atx（#）或 setext（===/---），默认 atx */
  headingStyle: 'atx' | 'setext';
  /** 代码块风格：fenced（```）或 indented（4 空格缩进），默认 fenced */
  codeBlockStyle: 'fenced' | 'indented';
  /** 无序列表标记符，默认 - */
  bulletMarker: '-' | '*' | '+';
  /** 强调分隔符，默认 * */
  emDelimiter: '*' | '_';
  /** 粗体分隔符，默认 ** */
  strongDelimiter: '**' | '__';
  /** 是否启用 GFM 扩展（任务列表 / 表格 / 删除线），默认 true */
  gfm: boolean;
  /** 是否保留无法转换的行内 HTML 标签（如 span），默认 false（剥离标签保留文本） */
  preserveUnknownTags: boolean;
  /** 是否保留链接 title 属性，默认 true */
  linkWithTitle: boolean;
  /** 缩进空格数（影响嵌套列表与 indented 代码块），默认 2 */
  indentSpaces: number;
}

/** 转换结果 */
export interface HtmlToMarkdownResult {
  ok: boolean;
  markdown: string;
  error: string;
  warnings: string[];
  stats: {
    /** 块级元素总数 */
    blocks: number;
    /** 列表项总数 */
    listItems: number;
    /** 表格数 */
    tables: number;
    /** 代码块数 */
    codeBlocks: number;
    /** 链接数 */
    links: number;
    /** 图片数 */
    images: number;
    /** 输出字符数 */
    chars: number;
  };
}

/** 默认选项 */
export const DEFAULT_HTML_TO_MD_OPTIONS: HtmlToMarkdownOptions = {
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletMarker: '-',
  emDelimiter: '*',
  strongDelimiter: '**',
  gfm: true,
  preserveUnknownTags: false,
  linkWithTitle: true,
  indentSpaces: 2,
};

/** 应被忽略的标签（不渲染内容也不递归） */
const IGNORED_TAGS = new Set([
  'script', 'style', 'template', 'noscript', 'head', 'meta',
  'link', 'title', 'iframe', 'object', 'embed',
]);

/** 块级元素标签集合（渲染前后需空行分隔） */
const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'main', 'aside', 'header', 'footer',
  'nav', 'figure', 'figcaption', 'address', 'pre', 'blockquote', 'table',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'form',
  'fieldset', 'details', 'summary', 'dl', 'dt', 'dd',
]);

/** 行内渲染上下文：跟踪列表层级与表格状态 */
interface RenderContext {
  /** 当前列表嵌套深度（用于缩进） */
  listDepth: number;
  /** 是否处于列表项内（影响段落是否双换行） */
  inListItem: boolean;
}

/** 统计计数器 */
interface Stats {
  blocks: number;
  listItems: number;
  tables: number;
  codeBlocks: number;
  links: number;
  images: number;
  chars: number;
}

/**
 * 主转换入口：HTML 字符串 → Markdown 字符串
 */
export function htmlToMarkdown(
  html: string,
  options: Partial<HtmlToMarkdownOptions> = {},
): HtmlToMarkdownResult {
  const opts = { ...DEFAULT_HTML_TO_MD_OPTIONS, ...options };
  const warnings: string[] = [];
  const stats: Stats = {
    blocks: 0, listItems: 0, tables: 0, codeBlocks: 0, links: 0, images: 0, chars: 0,
  };

  if (!html.trim()) {
    return {
      ok: true,
      markdown: '',
      error: '',
      warnings,
      stats: { ...stats, chars: 0 },
    };
  }

  // text/html 模式触发 HTML5 容错解析，自动修复未闭合标签
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // 检测解析错误（HTML 模式下 parsererror 会作为 body 内容出现）
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    return {
      ok: false,
      markdown: '',
      error: `HTML 解析失败：${parserError.textContent?.slice(0, 200) ?? '未知错误'}`,
      warnings,
      stats: { ...stats, chars: 0 },
    };
  }

  const ctx: RenderContext = { listDepth: 0, inListItem: false };
  // 从 body 开始递归渲染（head 由 IGNORED_TAGS 过滤）
  const blocks = renderChildren(doc.body, opts, ctx, stats, warnings);
  // 块级元素之间用双换行连接，去除多余空行
  const markdown = blocks.filter((b) => b.trim()).join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';

  stats.chars = markdown.length;
  return { ok: true, markdown, error: '', warnings, stats };
}

/**
 * 渲染子节点：返回块级元素数组（每个元素是一段 Markdown 文本）
 * 行内内容会被聚合为单个块
 */
function renderChildren(
  parent: ParentNode,
  opts: HtmlToMarkdownOptions,
  ctx: RenderContext,
  stats: Stats,
  warnings: string[],
): string[] {
  const blocks: string[] = [];
  // 聚合连续的行内节点为一个块
  let inlineBuffer: string[] = [];

  const flushInline = () => {
    if (inlineBuffer.length === 0) return;
    const text = inlineBuffer.join('').trim();
    if (text) {
      blocks.push(text);
      stats.blocks++;
    }
    inlineBuffer = [];
  };

  parent.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      // 保留有内容的文本节点（含纯空白则跳过，避免空块）
      if (text.trim()) {
        inlineBuffer.push(escapeInline(text));
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    if (IGNORED_TAGS.has(tag)) return;

    if (BLOCK_TAGS.has(tag)) {
      // 遇到块级元素，先冲刷行内缓冲
      flushInline();
      const block = renderBlock(el, tag, opts, ctx, stats, warnings);
      if (block.trim()) blocks.push(block.trim());
    } else {
      // 行内元素：递归渲染后追加到缓冲
      inlineBuffer.push(renderInline(el, opts, ctx, stats, warnings));
    }
  });
  flushInline();
  return blocks;
}

/**
 * 块级元素渲染分派
 */
function renderBlock(
  el: Element,
  tag: string,
  opts: HtmlToMarkdownOptions,
  ctx: RenderContext,
  stats: Stats,
  warnings: string[],
): string {
  switch (tag) {
    case 'h1': case 'h2': case 'h3':
    case 'h4': case 'h5': case 'h6':
      return renderHeading(el, tag, opts, stats, warnings);
    case 'p':
      return renderInlineChildren(el, opts, ctx, stats, warnings);
    case 'pre':
      return renderPre(el, opts, stats, warnings);
    case 'blockquote':
      return renderBlockquote(el, opts, ctx, stats, warnings);
    case 'ul':
      return renderList(el, false, opts, ctx, stats, warnings);
    case 'ol':
      return renderList(el, true, opts, ctx, stats, warnings);
    case 'li':
      // 列表项不应单独出现，但容错处理
      return renderInlineChildren(el, opts, ctx, stats, warnings);
    case 'hr':
      return '---';
    case 'table':
      return renderTable(el, opts, stats, warnings);
    case 'details':
      // details 渲染为 summary + 内容
      return renderDetails(el, opts, ctx, stats, warnings);
    default:
      // div / section / article 等容器：递归子块
      return renderChildren(el, opts, ctx, stats, warnings).join('\n\n');
  }
}

/** 渲染标题：atx（#）或 setext（h1/h2 用 ===/---） */
function renderHeading(
  el: Element,
  tag: string,
  opts: HtmlToMarkdownOptions,
  stats: Stats,
  warnings: string[],
): string {
  const level = Number(tag[1]);
  const text = renderInlineChildren(el, opts, { listDepth: 0, inListItem: false }, stats, warnings).trim();
  if (!text) {
    warnings.push(`空的 ${tag} 标题已跳过`);
    return '';
  }
  stats.blocks++;

  if (opts.headingStyle === 'setext' && level <= 2) {
    const underline = level === 1 ? '='.repeat(Math.max(text.length, 3)) : '-'.repeat(Math.max(text.length, 3));
    return `${text}\n${underline}`;
  }
  return `${'#'.repeat(level)} ${text}`;
}

/** 渲染预格式化代码块 */
function renderPre(
  el: Element,
  opts: HtmlToMarkdownOptions,
  stats: Stats,
  warnings: string[],
): string {
  // 优先取 <code> 子元素（常见结构 <pre><code>...</code></pre>）
  const codeEl = el.querySelector('code');
  const codeText = (codeEl?.textContent ?? el.textContent ?? '').replace(/\n$/, '');
  if (!codeText.trim()) return '';

  stats.codeBlocks++;
  // 从 class 中提取语言标识（如 language-js / lang-js / highlight-js）
  const langClass = codeEl?.className || el.className;
  const langMatch = langClass.match(/(?:language|lang|highlight)-([\w-]+)/i);
  const lang = langMatch?.[1] ?? '';
  if (!lang) {
    warnings.push('检测到无语言标识的代码块，建议添加 language-xxx 类名以启用语法高亮');
  }

  if (opts.codeBlockStyle === 'indented') {
    return codeText.split('\n').map((line) => '    ' + line).join('\n');
  }
  return '```' + lang + '\n' + codeText + '\n```';
}

/** 渲染引用块：每行加 > 前缀 */
function renderBlockquote(
  el: Element,
  opts: HtmlToMarkdownOptions,
  ctx: RenderContext,
  stats: Stats,
  warnings: string[],
): string {
  const inner = renderChildren(el, opts, ctx, stats, warnings).join('\n\n');
  return inner.split('\n').map((line) => '> ' + line).join('\n');
}

/** 渲染列表（无序 / 有序） */
function renderList(
  el: Element,
  ordered: boolean,
  opts: HtmlToMarkdownOptions,
  ctx: RenderContext,
  stats: Stats,
  warnings: string[],
): string {
  const indent = ' '.repeat(opts.indentSpaces * ctx.listDepth);
  let index = 0;
  const items: string[] = [];

  // HTMLCollection 是动态集合，先转为静态数组避免遍历过程移除元素导致的索引错乱
  Array.from(el.children).forEach((child) => {
    if (child.tagName.toLowerCase() !== 'li') return;
    index++;
    stats.listItems++;

    // 检测 GFM 任务列表（li > input[type=checkbox]）
    const checkbox = child.querySelector('input[type="checkbox"]');
    let prefix = ordered ? `${index}. ` : `${opts.bulletMarker} `;
    if (opts.gfm && checkbox) {
      const checked = (checkbox as HTMLInputElement).checked || checkbox.hasAttribute('checked');
      prefix = `${opts.bulletMarker} [${checked ? 'x' : ' '}] `;
      checkbox.remove();
    }

    // 渲染列表项内容：递归进入更深层级
    const itemCtx: RenderContext = { listDepth: ctx.listDepth + 1, inListItem: true };
    const content = renderChildren(child, opts, itemCtx, stats, warnings).join('\n\n');
    // 多行内容：首行加 marker，续行缩进对齐
    const lines = content.split('\n');
    const markerWidth = prefix.length;
    const continuationIndent = ' '.repeat(markerWidth);
    const formatted = lines
      .map((line, i) => (i === 0 ? `${indent}${prefix}${line}` : `${indent}${continuationIndent}${line}`))
      .join('\n');
    items.push(formatted);
  });

  return items.join('\n');
}

/** 渲染表格（GFM 管道表格） */
function renderTable(
  el: Element,
  opts: HtmlToMarkdownOptions,
  stats: Stats,
  warnings: string[],
): string {
  if (!opts.gfm) {
    // 非 GFM 模式降级为纯文本
    return renderInlineChildren(el, opts, { listDepth: 0, inListItem: false }, stats, warnings);
  }
  stats.tables++;

  const rows = el.querySelectorAll('tr');
  if (rows.length === 0) {
    warnings.push('检测到空表格已跳过');
    return '';
  }

  const tableData: string[][] = [];
  rows.forEach((tr) => {
    const cells = tr.querySelectorAll('th, td');
    const row: string[] = [];
    cells.forEach((cell) => {
      // 单元格内容：行内渲染，去除换行
      const text = renderInlineChildren(cell, opts, { listDepth: 0, inListItem: false }, stats, warnings)
        .replace(/\n+/g, ' ')
        .trim();
      row.push(text || ' ');
    });
    if (row.length > 0) tableData.push(row);
  });

  if (tableData.length === 0) return '';

  // 第一行作为表头（若无 th，仍按第一行处理）
  const header = tableData[0];
  const colCount = header.length;
  const separator = header.map(() => '---');

  const lines: string[] = [];
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`| ${separator.join(' | ')} |`);
  for (let i = 1; i < tableData.length; i++) {
    // 补齐列数对齐
    const row = tableData[i];
    while (row.length < colCount) row.push(' ');
    lines.push(`| ${row.join(' | ')} |`);
  }
  return lines.join('\n');
}

/** 渲染 details：summary 作为标题，内容作为正文 */
function renderDetails(
  el: Element,
  opts: HtmlToMarkdownOptions,
  ctx: RenderContext,
  stats: Stats,
  warnings: string[],
): string {
  const summary = el.querySelector('summary');
  const summaryText = summary ? renderInlineChildren(summary, opts, ctx, stats, warnings).trim() : '';
  // 移除 summary 后渲染剩余内容
  if (summary) summary.remove();
  const body = renderChildren(el, opts, ctx, stats, warnings).join('\n\n');
  if (summaryText && body) {
    return `**${summaryText}**\n\n${body}`;
  }
  return summaryText || body;
}

/**
 * 行内元素渲染分派
 */
function renderInline(
  el: Element,
  opts: HtmlToMarkdownOptions,
  ctx: RenderContext,
  stats: Stats,
  warnings: string[],
): string {
  const tag = el.tagName.toLowerCase();

  switch (tag) {
    case 'strong': case 'b':
      return `${opts.strongDelimiter}${renderInlineChildren(el, opts, ctx, stats, warnings)}${opts.strongDelimiter}`;
    case 'em': case 'i':
      return `${opts.emDelimiter}${renderInlineChildren(el, opts, ctx, stats, warnings)}${opts.emDelimiter}`;
    case 'del': case 's': case 'strike':
      return opts.gfm
        ? `~~${renderInlineChildren(el, opts, ctx, stats, warnings)}~~`
        : renderInlineChildren(el, opts, ctx, stats, warnings);
    case 'code':
      // 行内代码：用反引号包裹，支持多反引号嵌套
      return renderInlineCode(el);
    case 'a':
      return renderLink(el as HTMLAnchorElement, opts, ctx, stats, warnings);
    case 'img':
      return renderImage(el as HTMLImageElement, opts, stats);
    case 'br':
      return '  \n';
    case 'span': case 'sup': case 'sub': case 'mark':
    case 'small': case 'u': case 'ins': case 'abbr': case 'cite':
    case 'kbd': case 'samp': case 'var': case 'time': case 'data':
      // 语义行内标签：剥离标签保留内容
      return renderInlineChildren(el, opts, ctx, stats, warnings);
    case 'wbr':
      return '';
    default:
      // 未知标签：按选项决定保留或剥离
      if (opts.preserveUnknownTags) {
        return el.outerHTML;
      }
      return renderInlineChildren(el, opts, ctx, stats, warnings);
  }
}

/** 渲染行内代码：处理反引号嵌套 */
function renderInlineCode(el: Element): string {
  const text = el.textContent ?? '';
  // 选择比内容中连续反引号多一个的反引号序列作为定界符
  const maxBackticks = text.match(/`+/g)?.reduce((max, s) => Math.max(max, s.length), 0) ?? 0;
  const fence = '`'.repeat(maxBackticks + 1);
  // 内容首尾若为空格或反引号，需补空格避免定界符冲突
  const needsSpace = text.startsWith('`') || text.endsWith('`') || text.startsWith(' ') || text.endsWith(' ');
  const inner = needsSpace ? ` ${text} ` : text;
  return `${fence}${inner}${fence}`;
}

/** 渲染链接 */
function renderLink(
  el: HTMLAnchorElement,
  opts: HtmlToMarkdownOptions,
  ctx: RenderContext,
  stats: Stats,
  warnings: string[],
): string {
  const text = renderInlineChildren(el, opts, ctx, stats, warnings).trim();
  const href = el.getAttribute('href') ?? '';
  stats.links++;

  // 无 href 或锚点链接：仅保留文本
  if (!href || href.startsWith('#')) {
    return text;
  }
  // 文本与 URL 相同：直接输出 URL（自动链接）
  if (text === href) {
    return `<${href}>`;
  }
  const title = el.getAttribute('title');
  if (opts.linkWithTitle && title) {
    return `[${text}](${href} "${title.replace(/"/g, '\\"')}")`;
  }
  return `[${text}](${href})`;
}

/** 渲染图片 */
function renderImage(
  el: HTMLImageElement,
  opts: HtmlToMarkdownOptions,
  stats: Stats,
): string {
  const src = el.getAttribute('src') ?? '';
  const alt = el.getAttribute('alt') ?? '';
  const title = el.getAttribute('title');
  stats.images++;

  if (!src) return alt;
  if (opts.linkWithTitle && title) {
    return `![${alt}](${src} "${title.replace(/"/g, '\\"')}")`;
  }
  return `![${alt}](${src})`;
}

/** 渲染元素的所有子节点为行内文本 */
function renderInlineChildren(
  el: ParentNode,
  opts: HtmlToMarkdownOptions,
  ctx: RenderContext,
  stats: Stats,
  warnings: string[],
): string {
  const parts: string[] = [];
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(escapeInline(node.textContent ?? ''));
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node as Element;
      if (!IGNORED_TAGS.has(child.tagName.toLowerCase())) {
        parts.push(renderInline(child, opts, ctx, stats, warnings));
      }
    }
  });
  return parts.join('');
}

/**
 * 转义行内文本中的 Markdown 特殊字符
 * 仅转义行首的列表标记符与反斜杠，避免过度转义影响可读性
 */
function escapeInline(text: string): string {
  // 折叠多余空白为单个空格（HTML 渲染规则）
  const collapsed = text.replace(/\s+/g, ' ');
  // 转义反斜杠（必须在最前）
  let result = collapsed.replace(/\\/g, '\\\\');
  // 行首列表标记符转义（避免被误解析为列表项）
  result = result.replace(/^(\s*)([-*+])\s/, '$1\\$2 ');
  return result;
}


