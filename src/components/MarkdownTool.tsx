import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * Markdown 预览工具核心组件
 *
 * 设计目标：
 *  - 实时分屏预览（左编辑、右预览），双向同步滚动
 *  - 工具栏快捷插入常用 Markdown 语法
 *  - 字数统计、阅读时间估算、HTML 导出
 *  - 自动保存草稿到 localStorage（防误刷新丢失）
 *
 * 安全策略：
 *  - 解析器完全自实现，不依赖任何第三方库
 *  - 所有原始 HTML 在解析前先转义，从根本上杜绝 XSS
 *  - URL 协议白名单（http/https/mailto/ftp/相对路径/锚点），拦截 javascript:/data:
 *  - 行内代码与代码块内容仅转义，不解析任何 Markdown 语法
 */

// ============================================================
// Markdown 解析器（轻量 GFM 子集，零依赖）
// ============================================================

/** HTML 特殊字符转义（XSS 防护的第一道防线） */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** URL 协议白名单校验，拦截 javascript:、data: 等危险协议 */
function sanitizeUrl(url: string): string {
  const trimmed = url.trim().toLowerCase();
  // 允许 http/https/mailto/ftp 协议，以及相对路径、锚点
  if (/^(https?:|mailto:|ftp:|\/|#|\.\/|\.\.\/|\?)/i.test(trimmed)) {
    return url;
  }
  return '';
}

/**
 * 行内元素解析：粗体、斜体、删除线、行内代码、链接、图片、自动链接
 * 输入文本应已先 escapeHtml，输出为可安全插入 HTML 的字符串
 */
function parseInline(text: string): string {
  // 用占位符先提取行内代码，避免被后续规则误伤
  const codePlaceholders: string[] = [];
  text = text.replace(/(`+)([\s\S]+?)\1/g, (_, _quotes, code) => {
    const idx = codePlaceholders.length;
    // 行内代码内不做任何解析，仅保留原样（已转义）
    codePlaceholders.push(`<code>${code}</code>`);
    return `\x00CODE${idx}\x00`;
  });

  // 图片 ![alt](url "title")
  // 注意：调用方已对原文做 escapeHtml，因此 title 的双引号已变成 &quot;
  // 这里把括号内整体捕获后再分离 url 与 title，兼容原始 " 与转义后的 &quot;
  text = text.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_, alt, inside) => {
      const m = inside.match(/^(\S+)(?:\s+(?:["']|&quot;)([^"']*?)(?:["']|&quot;))?\s*$/);
      if (!m) return alt;
      const safeUrl = sanitizeUrl(m[1]);
      if (!safeUrl) return alt;
      const titleAttr = m[2] ? ` title="${m[2]}"` : '';
      return `<img src="${safeUrl}" alt="${alt}"${titleAttr} loading="lazy" />`;
    },
  );

  // 链接 [text](url "title")
  // 同上，title 引号兼容原始 " 与转义后的 &quot;
  text = text.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, linkText, inside) => {
      const m = inside.match(/^(\S+)(?:\s+(?:["']|&quot;)([^"']*?)(?:["']|&quot;))?\s*$/);
      if (!m) return linkText;
      const safeUrl = sanitizeUrl(m[1]);
      if (!safeUrl) return linkText;
      const titleAttr = m[2] ? ` title="${m[2]}"` : '';
      return `<a href="${safeUrl}"${titleAttr} rel="noopener noreferrer" target="_blank">${linkText}</a>`;
    },
  );

  // 自动链接 <https://example.com> 与 <user@example.com>
  // 注意：调用方已对原文做 escapeHtml，因此 < 变成 &lt;，> 变成 &gt;，& 变成 &amp;
  // URL 中的 &（query 参数分隔符）在 escapeHtml 后变成 &amp;，需在正则中兼容
  text = text.replace(/&lt;(https?:\/\/[^&]+(?:&amp;[^&]+)*)&gt;/g, (_, url) => {
    // 还原 &amp; 为 &，得到真实 URL（query 参数分隔符还原）
    const realUrl = url.replace(/&amp;/g, '&');
    return `<a href="${realUrl}" rel="noopener noreferrer" target="_blank">${realUrl}</a>`;
  });
  text = text.replace(
    /&lt;([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})&gt;/g,
    (_, email) => `<a href="mailto:${email}">${email}</a>`,
  );

  // 粗体 **text** 或 __text__（必须在斜体之前处理，避免被斜体规则吃掉）
  text = text.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([\s\S]+?)__/g, '<strong>$1</strong>');

  // 斜体 *text* 或 _text_（前后不能是同种符号，避免与粗体冲突）
  text = text.replace(/(^|[^\*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
  text = text.replace(/(^|[^_])_([^_\s][^_]*?)_(?!_)/g, '$1<em>$2</em>');

  // 删除线 ~~text~~
  text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  // 还原行内代码占位符
  text = text.replace(/\x00CODE(\d+)\x00/g, (_, idx) => codePlaceholders[parseInt(idx, 10)] || '');

  return text;
}

/** 解析表格分隔行，返回每列对齐方式（left/right/center/空） */
function parseTableAlign(separatorLine: string): string[] {
  return separatorLine
    .split('|')
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
    .map((c) => {
      const left = c.startsWith(':');
      const right = c.endsWith(':');
      if (left && right) return 'center';
      if (left) return 'left';
      if (right) return 'right';
      return '';
    });
}

/** 安全分割表格行：去掉首尾空 cell */
function splitTableRow(line: string): string[] {
  const cells = line.split('|');
  // 去掉首尾空 cell（如 "|a|b|" 分割后首尾为空）
  if (cells.length > 0 && cells[0].trim() === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((c) => c.trim());
}

/**
 * 块级元素解析：标题、代码块、引用、列表、表格、水平线、段落
 * 递归处理引用块内容
 */
function parseBlocks(markdown: string): string {
  const lines = markdown.split('\n');
  const html: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行跳过
    if (line.trim() === '') {
      i++;
      continue;
    }

    // 标题 # ~ ######
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = parseInline(escapeHtml(headingMatch[2]));
      // 为标题添加 id 用于锚点跳转（取文本前 50 字符做 slug）
      const slug = headingMatch[2]
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .replace(/\s+/g, '-')
        .slice(0, 50);
      html.push(`<h${level} id="${slug}">${text}</h${level}>`);
      i++;
      continue;
    }

    // 水平线 --- 或 *** 或 ___
    // 匹配水平线：3 个以上相同的 - * _，中间可有空格（字符类中不能用反向引用 \1，改用 (?:\s*\1){2,}）
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      html.push('<hr />');
      i++;
      continue;
    }

    // 代码块 ```lang
    const fenceMatch = line.match(/^\s*```([\w-]*)\s*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // 跳过结束 ```
      const code = escapeHtml(codeLines.join('\n'));
      const langClass = lang ? ` class="language-${lang}"` : '';
      html.push(`<pre><code${langClass}>${code}</code></pre>`);
      continue;
    }

    // 引用 >（支持连续多行）
    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      // 递归解析引用块内容（支持嵌套标题、列表等）
      const content = parseBlocks(quoteLines.join('\n'));
      html.push(`<blockquote>${content}</blockquote>`);
      continue;
    }

    // 表格：第一行 |a|b|，第二行 |---|---|（分隔行只含 |、-、:、空格，每列至少一个 -）
    // 旧正则 [\s:|-]+\|[\s:|-|]+ 因贪婪回溯问题对部分分隔行返回 false，导致表格分支不进入、
    // 段落排除正则中的 \s*\| 又阻挡表格行进入段落，最终 while 主循环 i 不前进形成死循环。
    // 新正则按列结构精确匹配：列定义 = 可选空格 + 可选: + 至少一个- + 可选: + 可选空格，多列用 | 分隔
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const headerCells = splitTableRow(line);
      const aligns = parseTableAlign(lines[i + 1]);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      // 使用语义化 <table> 标签，便于 SEO 与屏幕阅读器识别
      const thead =
        '<thead><tr>' +
        headerCells
          .map((c, idx) => {
            const align = aligns[idx] ? ` style="text-align:${aligns[idx]}"` : '';
            return `<th${align}>${parseInline(escapeHtml(c))}</th>`;
          })
          .join('') +
        '</tr></thead>';
      const tbody =
        '<tbody>' +
        rows
          .map(
            (row) =>
              '<tr>' +
              row
                .map((c, idx) => {
                  const align = aligns[idx] ? ` style="text-align:${aligns[idx]}"` : '';
                  return `<td${align}>${parseInline(escapeHtml(c))}</td>`;
                })
                .join('') +
              '</tr>',
          )
          .join('') +
        '</tbody>';
      html.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    // 任务列表 - [ ] 或 - [x]
    if (/^\s*[-*+]\s+\[[ xX]\]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+\[[ xX]\]\s+/.test(lines[i])) {
        const m = lines[i].match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
        if (m) {
          const checked = m[1].toLowerCase() === 'x';
          const text = parseInline(escapeHtml(m[2]));
          items.push(
            `<li class="task-list-item"><input type="checkbox" disabled${checked ? ' checked' : ''} /> ${text}</li>`,
          );
        }
        i++;
      }
      html.push(`<ul class="task-list">${items.join('')}</ul>`);
      continue;
    }

    // 无序列表 - * +
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const m = lines[i].match(/^\s*[-*+]\s+(.*)$/);
        if (m) {
          items.push(`<li>${parseInline(escapeHtml(m[1]))}</li>`);
        }
        i++;
      }
      html.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // 有序列表 1.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const m = lines[i].match(/^\s*\d+\.\s+(.*)$/);
        if (m) {
          items.push(`<li>${parseInline(escapeHtml(m[1]))}</li>`);
        }
        i++;
      }
      html.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // 段落：连续非空行合并
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6}\s|```|>|[-*_]{3,}|\s*[-*+]\s|\s*\d+\.\s|\s*\|)/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      // 段落内换行：单换行保留为 <br>，多行段落拼接
      const escaped = paraLines.map(escapeHtml).join('\n');
      const parsed = parseInline(escaped).replace(/\n/g, '<br>');
      html.push(`<p>${parsed}</p>`);
    }
  }

  return html.join('\n');
}

/** 顶层 Markdown → HTML 转换函数 */
export function markdownToHtml(markdown: string): string {
  if (!markdown.trim()) return '';
  return parseBlocks(markdown);
}

// ============================================================
// 统计与工具函数
// ============================================================

/** 统计字符数、字数（中英文混合）、行数 */
function computeStats(text: string) {
  const chars = text.length;
  const lines = chars === 0 ? 0 : text.split('\n').length;
  // 中文字符数 + 英文单词数（粗略估算阅读量）
  const cnChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const enWords = (text.match(/[a-zA-Z]+/g) || []).length;
  const words = cnChars + enWords;
  // 阅读时间：中文 300 字/分钟，英文 200 词/分钟，混合按比例加权
  const minutes = Math.max(1, Math.ceil((cnChars / 300 + enWords / 200) || 1));
  return { chars, lines, words, minutes };
}


// ============================================================
// 示例 Markdown（覆盖全部 GFM 子集语法）
// ============================================================

const SAMPLE_MARKDOWN = `# Markdown 实战示例

欢迎来到 **工具盒子** 的 Markdown 预览器。这是一个 \`<在线实时渲染>\` 工具，所有解析在浏览器本地完成。

## 行内元素

支持 **粗体**、*斜体*、~~删除线~~、\`行内代码\`、[链接](https://example.com "示例")、自动链接 <https://astro.build> 与邮件 <feedback@example.com>。

## 列表

### 无序列表

- 第一项
- 第二项
  - 嵌套子项（注：本工具不展开嵌套，仅扁平渲染）
- 第三项

### 有序列表

1. 步骤一
2. 步骤二
3. 步骤三

### 任务列表

- [x] 完成需求评审
- [x] 编写技术方案
- [ ] 实现核心功能
- [ ] 编写测试用例

## 引用

> 这是一段引用。
> 引用内可以包含 **粗体** 与 *斜体*。
>
> 多段落引用用空行 > 分隔。

## 代码块

\`\`\`typescript
// 一个简单的 TypeScript 函数
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
console.log(greet('工具盒子'));
\`\`\`

\`\`\`javascript
// JavaScript 也支持
const sum = (a, b) => a + b;
\`\`\`

## 表格

| 名称 | 类型 | 说明 |
| :--- | :---: | ---: |
| id | number | 唯一标识 |
| name | string | 用户名 |
| email | string | 邮箱（左对齐） |
| created | Date | 创建时间 |

## 水平线与段落

下方是一条水平线：

---

段落内的单换行会保留为 <br>，
比如这里另起一行。段落之间需要用空行分隔。

这是新的一段。
`;

// ============================================================
// 主组件
// ============================================================

type ViewLayout = 'split' | 'editor' | 'preview';

export default function MarkdownTool() {
  // 输入文本（草稿自动保存到 localStorage）
  const [input, setInput] = useState<string>('');
  const [layout, setLayout] = useState<ViewLayout>('split');
  const [copied, setCopied] = useState<'html' | 'md' | null>(null);
  const [syncScroll, setSyncScroll] = useState(true);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // 草稿恢复：首次挂载时从 localStorage 读取
  useEffect(() => {
    try {
      const draft = localStorage.getItem('toolbox-markdown-draft');
      if (draft && draft.trim()) {
        setInput(draft);
      } else {
        setInput(SAMPLE_MARKDOWN);
      }
    } catch {
      setInput(SAMPLE_MARKDOWN);
    }
  }, []);

  // 草稿保存：input 变化时延迟写入（去抖 500ms）
  useEffect(() => {
    if (!input) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem('toolbox-markdown-draft', input);
      } catch {
        // 配额超限或无痕模式忽略
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [input]);

  // 实时解析 HTML（useMemo 缓存，输入不变时不重复解析）
  const html = useMemo(() => markdownToHtml(input), [input]);

  // 字数统计
  const stats = useMemo(() => computeStats(input), [input]);

  // 双向同步滚动：编辑器滚动时预览跟随，反之亦然
  const isSyncing = useRef(false);
  const handleEditorScroll = useCallback(() => {
    if (!syncScroll || isSyncing.current) return;
    const editor = editorRef.current;
    const preview = previewRef.current;
    if (!editor || !preview) return;
    const maxEditor = editor.scrollHeight - editor.clientHeight;
    const maxPreview = preview.scrollHeight - preview.clientHeight;
    if (maxEditor <= 0) return;
    const ratio = editor.scrollTop / maxEditor;
    isSyncing.current = true;
    preview.scrollTop = ratio * maxPreview;
    requestAnimationFrame(() => {
      isSyncing.current = false;
    });
  }, [syncScroll]);

  const handlePreviewScroll = useCallback(() => {
    if (!syncScroll || isSyncing.current) return;
    const editor = editorRef.current;
    const preview = previewRef.current;
    if (!editor || !preview) return;
    const maxEditor = editor.scrollHeight - editor.clientHeight;
    const maxPreview = preview.scrollHeight - preview.clientHeight;
    if (maxPreview <= 0) return;
    const ratio = preview.scrollTop / maxPreview;
    isSyncing.current = true;
    editor.scrollTop = ratio * maxEditor;
    requestAnimationFrame(() => {
      isSyncing.current = false;
    });
  }, [syncScroll]);

  /** 在 textarea 当前光标位置插入文本（或包裹选区） */
  const insertAtCursor = useCallback(
    (before: string, after: string = '', placeholder: string = '') => {
      const ta = editorRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const selected = input.slice(start, end) || placeholder;
      const newText = input.slice(0, start) + before + selected + after + input.slice(end);
      setInput(newText);
      // 还原焦点与选区
      requestAnimationFrame(() => {
        ta.focus();
        const newCursor = start + before.length + selected.length + after.length;
        if (selected === placeholder && placeholder) {
          // 选中占位符，便于直接替换
          ta.setSelectionRange(start + before.length, start + before.length + placeholder.length);
        } else {
          ta.setSelectionRange(newCursor, newCursor);
        }
      });
    },
    [input],
  );

  /** 在行首插入前缀（用于列表、引用、标题等） */
  const insertLinePrefix = useCallback(
    (prefix: string) => {
      const ta = editorRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      // 找到选区开始处的行首
      const lineStart = input.lastIndexOf('\n', start - 1) + 1;
      const newText = input.slice(0, lineStart) + prefix + input.slice(lineStart);
      setInput(newText);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(start + prefix.length, end + prefix.length);
      });
    },
    [input],
  );

  /** 工具栏按钮配置 */
  const toolbar = [
    { label: 'H1', title: '一级标题', action: () => insertLinePrefix('# ') },
    { label: 'H2', title: '二级标题', action: () => insertLinePrefix('## ') },
    { label: 'H3', title: '三级标题', action: () => insertLinePrefix('### ') },
    { label: 'B', title: '粗体 **text**', action: () => insertAtCursor('**', '**', '粗体文本') },
    { label: 'I', title: '斜体 *text*', action: () => insertAtCursor('*', '*', '斜体文本') },
    { label: 'S', title: '删除线 ~~text~~', action: () => insertAtCursor('~~', '~~', '删除线') },
    { label: '</>', title: '行内代码', action: () => insertAtCursor('`', '`', 'code') },
    { label: '🔗', title: '链接 [text](url)', action: () => insertAtCursor('[', '](https://)', '链接文本') },
    { label: '🖼', title: '图片 ![alt](url)', action: () => insertAtCursor('![', '](https://)', '图片描述') },
    { label: '• 列表', title: '无序列表', action: () => insertLinePrefix('- ') },
    { label: '1. 列表', title: '有序列表', action: () => insertLinePrefix('1. ') },
    { label: '☐ 任务', title: '任务列表', action: () => insertLinePrefix('- [ ] ') },
    { label: '❝ 引用', title: '引用块', action: () => insertLinePrefix('> ') },
    {
      label: '— 分隔',
      title: '水平线',
      action: () => insertAtCursor('\n---\n', '', ''),
    },
    {
      label: '表格',
      title: '插入表格',
      action: () =>
        insertAtCursor(
          '\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| A | B | C |\n| D | E | F |\n',
          '',
          '',
        ),
    },
    {
      label: '``` 代码块',
      title: '代码块',
      action: () => insertAtCursor('\n```javascript\n', '\n```\n', '// 在此输入代码'),
    },
  ];

  /** 复制渲染后的 HTML */
  const handleCopyHtml = async () => {
    const ok = await copyText(html);
    if (ok) {
      setCopied('html');
      setTimeout(() => setCopied(null), 1500);
    }
  };

  /** 复制原始 Markdown */
  const handleCopyMd = async () => {
    const ok = await copyText(input);
    if (ok) {
      setCopied('md');
      setTimeout(() => setCopied(null), 1500);
    }
  };

  /** 下载 HTML 文件（含基础样式） */
  const handleDownloadHtml = () => {
    const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Markdown 导出</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; line-height: 1.7; max-width: 760px; margin: 40px auto; padding: 0 20px; color: #1f2937; }
pre { background: #f5f5f5; padding: 14px; border-radius: 6px; overflow-x: auto; }
code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-family: Consolas, Monaco, monospace; }
pre code { background: none; padding: 0; }
blockquote { border-left: 4px solid #ddd; margin: 0; padding: 4px 16px; color: #555; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #ddd; padding: 8px 12px; }
th { background: #f5f5f5; }
img { max-width: 100%; }
hr { border: none; border-top: 1px solid #ddd; }
.task-list-item { list-style: none; }
</style>
</head>
<body>
${html}
</body>
</html>`;
    const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'markdown-export.html';
    a.click();
    URL.revokeObjectURL(url);
  };

  /** 清空编辑器 */
  const handleClear = () => {
    if (input && !confirm('确定清空编辑器？草稿会被覆盖。')) return;
    setInput('');
    try {
      localStorage.removeItem('toolbox-markdown-draft');
    } catch {
      // 忽略
    }
  };

  /** 载入示例 */
  const handleLoadSample = () => {
    if (input && !confirm('载入示例会覆盖当前内容，确定？')) return;
    setInput(SAMPLE_MARKDOWN);
  };

  return (
    <div className="mdtool">
      {/* 工具栏 */}
      <div className="mdtool__toolbar" role="toolbar" aria-label="Markdown 快捷插入">
        <div className="mdtool__toolbar-group">
          {toolbar.map((btn) => (
            <button
              key={btn.label}
              type="button"
              className="mdtool__btn"
              title={btn.title}
              onClick={btn.action}
            >
              {btn.label}
            </button>
          ))}
        </div>
        <div className="mdtool__toolbar-group">
          <button
            type="button"
            className={`mdtool__btn mdtool__btn--toggle${layout === 'editor' ? ' is-active' : ''}`}
            onClick={() => setLayout('editor')}
            title="仅显示编辑器"
          >
            仅编辑
          </button>
          <button
            type="button"
            className={`mdtool__btn mdtool__btn--toggle${layout === 'split' ? ' is-active' : ''}`}
            onClick={() => setLayout('split')}
            title="分屏对照"
          >
            分屏
          </button>
          <button
            type="button"
            className={`mdtool__btn mdtool__btn--toggle${layout === 'preview' ? ' is-active' : ''}`}
            onClick={() => setLayout('preview')}
            title="仅显示预览"
          >
            仅预览
          </button>
        </div>
      </div>

      {/* 统计栏 */}
      <div className="mdtool__stats" aria-live="polite">
        <span>字符 <strong>{stats.chars.toLocaleString()}</strong></span>
        <span>字数 <strong>{stats.words.toLocaleString()}</strong></span>
        <span>行数 <strong>{stats.lines.toLocaleString()}</strong></span>
        <span>预计阅读 <strong>{stats.minutes}</strong> 分钟</span>
        <label className="mdtool__sync-toggle">
          <input
            type="checkbox"
            checked={syncScroll}
            onChange={(e) => setSyncScroll(e.currentTarget.checked)}
          />
          同步滚动
        </label>
      </div>

      {/* 编辑器 + 预览区 */}
      <div className={`mdtool__main mdtool__main--${layout}`}>
        <div className={`mdtool__pane mdtool__editor-pane${layout === 'preview' ? ' is-hidden' : ''}`}>
          <textarea
            ref={editorRef}
            className="mdtool__editor"
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            onScroll={handleEditorScroll}
            placeholder="在此输入 Markdown…"
            spellCheck={false}
            aria-label="Markdown 编辑器"
          />
        </div>
        <div className={`mdtool__pane mdtool__preview-pane${layout === 'editor' ? ' is-hidden' : ''}`}>
          <div
            ref={previewRef}
            className="mdtool__preview markdown-body"
            onScroll={handlePreviewScroll}
            dangerouslySetInnerHTML={{ __html: html || '<p class="mdtool__empty">预览区为空，请在左侧输入 Markdown。</p>' }}
          />
        </div>
      </div>

      {/* 操作栏 */}
      <div className="mdtool__actions">
        <button type="button" className="mdtool__action-btn" onClick={handleCopyHtml}>
          {copied === 'html' ? '✓ 已复制' : '复制 HTML'}
        </button>
        <button type="button" className="mdtool__action-btn" onClick={handleCopyMd}>
          {copied === 'md' ? '✓ 已复制' : '复制 Markdown'}
        </button>
        <button type="button" className="mdtool__action-btn" onClick={handleDownloadHtml}>
          下载 HTML
        </button>
        <button type="button" className="mdtool__action-btn" onClick={handleLoadSample}>
          载入示例
        </button>
        <button type="button" className="mdtool__action-btn mdtool__action-btn--danger" onClick={handleClear}>
          清空
        </button>
      </div>
    </div>
  );
}
