// RSS 2.0 订阅源：供 RSS 阅读器订阅与搜索引擎抓取
// 原生实现，零额外依赖，遵循 RSS 2.0 + Atom 自引用规范
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

// XML 特殊字符转义，避免破坏文档结构
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const GET: APIRoute = async ({ site }) => {
  // 站点根 URL，回退到占位域名（上线后由 astro.config.mjs 的 site 字段提供）
  const SITE_URL = (site?.toString() || 'https://toolbox.example.com').replace(/\/$/, '');

  // 博客文章按发布时间倒序
  const posts = (await getCollection('blog')).sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf()
  );

  // 构建每篇文章的 <item> 节点
  const items = posts
    .map((post) => {
      const url = `${SITE_URL}/blog/${post.id}`;
      const tags = post.data.tags.length
        ? post.data.tags.map((t) => `<category>${escapeXml(t)}</category>`).join('')
        : '';
      return [
        '    <item>',
        `      <title>${escapeXml(post.data.title)}</title>`,
        `      <link>${url}</link>`,
        `      <guid isPermaLink="true">${url}</guid>`,
        `      <description>${escapeXml(post.data.description)}</description>`,
        `      <pubDate>${post.data.pubDate.toUTCString()}</pubDate>`,
        tags,
        '    </item>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  // 拼装完整 RSS 2.0 文档
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>工具盒子技术博客</title>
    <link>${SITE_URL}/blog</link>
    <description>开发者工具背后的技术原理与最佳实践深度解析</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${SITE_URL}/rss.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

  return new Response(rss, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
