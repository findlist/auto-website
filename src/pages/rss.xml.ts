// RSS 2.0 订阅源：供 RSS 阅读器订阅与搜索引擎抓取
// 原生实现，零额外依赖，遵循 RSS 2.0 + Atom 自引用规范
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { getSiteUrl, normalizeUrlTrailingSlash } from '../utils/site';

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
  // 站点根 URL：集中化获取，未配置时构建报错（防止 RSS 指向错误域名）
  const SITE_URL = getSiteUrl(site);
  // 博客栏目 URL：规范化尾部斜杠，与站点 canonical 保持一致
  const blogUrl = normalizeUrlTrailingSlash(`${SITE_URL}/blog`);

  // 博客文章按发布时间倒序
  const posts = (await getCollection('blog')).sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf()
  );

  // 构建每篇文章的 <item> 节点
  // 文章 URL 规范化尾部斜杠，与文章页 canonical 一致，避免阅读器去重歧义
  const items = posts
    .map((post) => {
      const url = normalizeUrlTrailingSlash(`${SITE_URL}/blog/${post.id}`);
      const tags = post.data.tags.length
        ? post.data.tags.map((t) => `<category>${escapeXml(t)}</category>`).join('')
        : '';
      return [
        '    <item>',
        `      <title>${escapeXml(post.data.title)}</title>`,
        `      <link>${url}</link>`,
        `      <guid isPermaLink="true">${url}</guid>`,
        `      <description>${escapeXml(post.data.description)}</description>`,
        `      <dc:creator>工具盒子</dc:creator>`,
        `      <pubDate>${post.data.pubDate.toUTCString()}</pubDate>`,
        tags,
        '    </item>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  // 拼装完整 RSS 2.0 文档（声明 dc 命名空间以支持 <dc:creator> 作者元素）
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>工具盒子技术博客</title>
    <link>${blogUrl}</link>
    <description>开发者工具背后的技术原理与最佳实践深度解析</description>
    <language>zh-CN</language>
    <generator>工具盒子 RSS Generator</generator>
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
