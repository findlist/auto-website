// 批量为工具页新增"相关博客"区块的脚本
// 功能：
//   1. 扫描 src/content/blog/*.md 的 frontmatter（title/description/relatedTool）
//   2. 构建 relatedTool → [{title, slug, description}] 映射
//   3. 遍历 src/pages/*.astro 工具页，在 .related-tools 区块后插入 .related-blogs 区块
//   4. 幂等：已有 .related-blogs 区块的文件跳过
//   5. 无相关博客的工具页跳过
// 使用：node scripts/add-related-blogs.mjs

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

const ROOT = process.cwd();
const BLOG_DIR = join(ROOT, 'src', 'content', 'blog');
const PAGES_DIR = join(ROOT, 'src', 'pages');

// 非工具页白名单（首页、关于、隐私、RSS 等不参与处理）
const NON_TOOL_PAGES = new Set([
  'index.astro',
  'about.astro',
  'privacy.astro',
  'rss.xml.ts',
]);

// 解析单个博客 frontmatter，提取 title / description / relatedTool
function parseBlogFrontmatter(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  // frontmatter 位于首对 --- 之间
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return null;
  const fm = fmMatch[1];
  const titleMatch = fm.match(/^title:\s*['"]?(.+?)['"]?\s*$/m);
  const descMatch = fm.match(/^description:\s*['"](.+?)['"]\s*$/m);
  const toolMatch = fm.match(/^relatedTool:\s*['"]?(.+?)['"]?\s*$/m);
  if (!titleMatch || !toolMatch) return null;
  const title = titleMatch[1].trim().replace(/^['"]|['"]$/g, '');
  const tool = toolMatch[1].trim().replace(/^['"]|['"]$/g, '');
  const description = descMatch ? descMatch[1].trim() : '';
  return { title, tool, description, slug: basename(filePath, '.md') };
}

// 构建 relatedTool → [blog] 映射
function buildBlogMap() {
  const map = new Map();
  const files = readdirSync(BLOG_DIR).filter((f) => f.endsWith('.md'));
  for (const f of files) {
    const info = parseBlogFrontmatter(join(BLOG_DIR, f));
    if (!info || !info.tool) continue;
    const toolKey = info.tool.startsWith('/') ? info.tool : `/${info.tool}`;
    if (!map.has(toolKey)) map.set(toolKey, []);
    map.get(toolKey).push(info);
  }
  return map;
}

// 截断描述到指定长度（按字符计，避免破坏页面布局）
function truncateDesc(desc, max = 88) {
  if (!desc) return '';
  const clean = desc.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1) + '…';
}

// 转义 HTML 特殊字符（标题与描述中可能包含 < > & 等）
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 生成 .related-blogs 区块的 HTML 片段
function buildRelatedBlogsSection(blogs) {
  const items = blogs
    .map((b) => {
      const href = `/blog/${b.slug}`;
      const title = escapeHtml(b.title);
      const desc = truncateDesc(b.description);
      // 同时输出标题与简短描述，便于用户预判内容价值
      return `        <li>
          <a href="${href}">${title}</a>${
        desc ? `<span class="related-blogs__desc">${escapeHtml(desc)}</span>` : ''
      }
        </li>`;
    })
    .join('\n');

  return `    <!-- 相关博客：工具页反向内链，引导用户深度阅读（脚本批量生成，请勿手动修改） -->
    <section class="related-blogs" aria-labelledby="related-blogs-title">
      <h2 id="related-blogs-title">相关博客</h2>
      <ul class="related-blogs__list">
${items}
      </ul>
    </section>`;
}

// 在工具页中插入 .related-blogs 区块
// 插入点：.related-tools 区块的 </section> 或 </nav> 之后
function insertRelatedBlogs(filePath, blogs) {
  const raw = readFileSync(filePath, 'utf8');
  // 幂等检查：已有 .related-blogs 则跳过
  if (raw.includes('class="related-blogs"')) {
    return { status: 'skipped', reason: 'already has .related-blogs' };
  }

  // 查找 .related-tools 区块的结束位置：
  // - 标准结构：<section class="related-tools" ...> ... </section>
  // - 数组结构：<nav class="related-tools" ...> ... </nav>
  // 由于 Astro/HTML 嵌套复杂，采用"查找 .related-tools 后第一个 </section> 或 </nav>"的策略
  const toolsStart = raw.indexOf('class="related-tools"');
  if (toolsStart === -1) {
    return { status: 'skipped', reason: 'no .related-tools block' };
  }

  // 从 .related-tools 起始位置向后查找结束标签
  // 注意：.related-tools 区块内不应有嵌套 </section>（区块结构简单），取第一个匹配即可
  const sectionEnd = raw.indexOf('</section>', toolsStart);
  const navEnd = raw.indexOf('</nav>', toolsStart);

  let endPos;
  let endTag;
  if (sectionEnd === -1 && navEnd === -1) {
    return { status: 'error', reason: 'cannot find closing tag for .related-tools' };
  }
  // 选择较小的有效位置作为结束点
  if (sectionEnd === -1) {
    endPos = navEnd;
    endTag = '</nav>';
  } else if (navEnd === -1) {
    endPos = sectionEnd;
    endTag = '</section>';
  } else {
    if (sectionEnd < navEnd) {
      endPos = sectionEnd;
      endTag = '</section>';
    } else {
      endPos = navEnd;
      endTag = '</nav>';
    }
  }

  // 计算插入点：endPos + endTag.length
  const insertPos = endPos + endTag.length;
  const blogsSection = buildRelatedBlogsSection(blogs);

  // 在结束标签后插入新区块（保持原换行符风格）
  const before = raw.slice(0, insertPos);
  const after = raw.slice(insertPos);
  // 在新区块前后保持空行
  const newContent = `${before}\n\n${blogsSection}${after}`;
  writeFileSync(filePath, newContent, 'utf8');
  return { status: 'inserted', insertPos };
}

// 主流程
function main() {
  console.log('===== 工具页相关博客区块批量插入 =====');
  console.log(`工作目录: ${ROOT}\n`);

  // 1. 构建博客映射
  const blogMap = buildBlogMap();
  console.log(`[1] 扫描博客：共 ${blogMap.size} 个工具有关联博客`);

  // 2. 遍历工具页
  const pageFiles = readdirSync(PAGES_DIR).filter(
    (f) => extname(f) === '.astro' && !NON_TOOL_PAGES.has(f)
  );
  console.log(`[2] 待处理工具页：${pageFiles.length} 个\n`);

  const results = { inserted: [], skipped: [], error: [] };
  for (const f of pageFiles) {
    const filePath = join(PAGES_DIR, f);
    const toolSlug = `/${basename(f, '.astro')}`;
    const blogs = blogMap.get(toolSlug);
    if (!blogs || blogs.length === 0) {
      results.skipped.push({ file: f, reason: 'no related blogs' });
      continue;
    }
    const result = insertRelatedBlogs(filePath, blogs);
    if (result.status === 'inserted') {
      results.inserted.push({ file: f, blogCount: blogs.length });
    } else if (result.status === 'skipped') {
      results.skipped.push({ file: f, reason: result.reason });
    } else {
      results.error.push({ file: f, reason: result.reason });
    }
  }

  // 3. 输出统计
  console.log('===== 处理结果统计 =====');
  console.log(`成功插入: ${results.inserted.length} 个文件`);
  console.log(`跳过:    ${results.skipped.length} 个文件`);
  console.log(`错误:    ${results.error.length} 个文件\n`);

  if (results.inserted.length > 0) {
    console.log('--- 成功插入（前 10 个） ---');
    results.inserted.slice(0, 10).forEach((r) => {
      console.log(`  ✓ ${r.file} (${r.blogCount} 篇博客)`);
    });
    if (results.inserted.length > 10) {
      console.log(`  ... 及其他 ${results.inserted.length - 10} 个文件`);
    }
    console.log('');
  }

  if (results.error.length > 0) {
    console.log('--- 错误 ---');
    results.error.forEach((r) => {
      console.log(`  ✗ ${r.file}: ${r.reason}`);
    });
    console.log('');
  }

  // 跳过的文件分类统计（避免输出过长）
  const skipReasons = {};
  for (const r of results.skipped) {
    skipReasons[r.reason] = (skipReasons[r.reason] || 0) + 1;
  }
  console.log('--- 跳过原因汇总 ---');
  Object.entries(skipReasons).forEach(([reason, count]) => {
    console.log(`  ${reason}: ${count} 个`);
  });
}

main();
