// 内链网络质量审计脚本：扫描 dist 产出，构建入链/出链图谱
// 识别孤立页面、入链稀疏页面、锚文本质量问题、按页面类型分组统计
// 与 seo-audit.mjs 互补：seo-audit 关注 404 与基础标签，本脚本关注内链网络结构健康度
// 以 sitemap-0.xml 为白名单，仅审计搜索引擎可见的页面，避免 dist 残留文件干扰
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(__dirname, '../dist');
const SITEMAP_FILE = resolve(DIST_DIR, 'sitemap-0.xml');

// 解码 HTML 实体，避免链接比对误报
function decodeHtmlEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// 收集所有 index.html 文件
function collectHtmlFiles(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectHtmlFiles(full, files);
    } else if (entry === 'index.html') {
      files.push(full);
    }
  }
  return files;
}

// 从文件路径推导页面 URL（相对站点根，统一含尾部斜杠形式）
function pathToUrl(filePath) {
  const rel = filePath.replace(DIST_DIR, '').replace(/\\/g, '/').replace('/index.html', '/');
  return rel === '' ? '/' : rel;
}

// 提取所有内部 <a href> 链接与锚文本
// 返回 [{ href, text }] 列表，排除外链、锚点、邮件、tel
function extractInternalLinksWithText(html) {
  const links = [];
  // 匹配 <a ... href="..." ...>文本</a>，容忍属性顺序与单双引号
  const re = /<a\s+([^>]*?)href=["']([^"']+)["']([^>]*?)>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = decodeHtmlEntities(m[2]);
    if (/^(https?:|mailto:|tel:|data:)/i.test(href)) continue;
    if (href.startsWith('#')) continue;
    // 提取锚文本：去除 HTML 标签，压缩空白
    const rawText = m[4].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    links.push({ href, text: rawText });
  }
  return links;
}

// 规范化链接路径：去除 query/hash，统一尾部斜杠
function normalizeHref(href) {
  let path = href.split('#')[0].split('?')[0];
  if (path === '') path = '/';
  if (!path.startsWith('/')) path = '/' + path;
  if (!path.endsWith('/')) path = path + '/';
  return path;
}

// 判定页面类型（用于分组统计）
function classifyPage(url) {
  if (url === '/') return 'home';
  if (url === '/about/') return 'static';
  if (url === '/privacy/') return 'static';
  if (url === '/blog/') return 'blog-index';
  if (url.startsWith('/blog/page/')) return 'blog-pagination';
  if (url.startsWith('/blog/tag/')) return 'blog-tag';
  if (/^\/blog\/[^/]+\/$/.test(url)) return 'blog-post';
  return 'tool';
}

// 判定是否为模板导航链接（BaseLayout header/footer 注入）
// 这些链接在所有页面都存在，对入链分析价值低，单独标记
const TEMPLATE_LINK_PATHS = new Set(['/', '/about/', '/privacy/', '/blog/']);
function isTemplateNav(href) {
  const normalized = normalizeHref(href);
  return TEMPLATE_LINK_PATHS.has(normalized) || href.startsWith('/#');
}

// 无意义锚文本特征词（这些锚文本缺乏语义信息，不利于 SEO）
const BAD_ANCHOR_PATTERNS = [
  /^(点击|详情|更多|查看|链接|这里|这里|此处|查看详情|了解更多|点击查看|点击这里|查看更多)$/i,
  /^(click|here|more|details|link|read more|view details)$/i,
  /^>>+$/,
  /^→+$/,
  /^\.+$/,
];

function isBadAnchor(text) {
  if (!text) return true; // 空锚文本
  return BAD_ANCHOR_PATTERNS.some((re) => re.test(text));
}

// === 主流程 ===
// 加载 sitemap 白名单：仅审计搜索引擎可见的页面，避免 dist 残留文件干扰审计结果
// sitemap-0.xml 由 @astrojs/sitemap 集成生成，准确反映 Astro getStaticPaths 的输出
const sitemapUrls = new Set();
if (existsSync(SITEMAP_FILE)) {
  const xml = readFileSync(SITEMAP_FILE, 'utf8');
  const matches = xml.matchAll(/<loc>([^<]+)<\/loc>/g);
  for (const m of matches) {
    // 从绝对 URL 提取路径部分，统一含尾部斜杠形式
    let path = m[1].replace(/^https?:\/\/[^/]+/, '');
    if (path === '') path = '/';
    if (!path.endsWith('/')) path = path + '/';
    sitemapUrls.add(path);
  }
}
console.log(`sitemap 白名单加载: ${sitemapUrls.size} 个 URL\n`);

const allHtmlFiles = collectHtmlFiles(DIST_DIR);
// 仅保留 sitemap 中存在的页面（跳过 dist 残留文件）
const htmlFiles = sitemapUrls.size > 0
  ? allHtmlFiles.filter((f) => sitemapUrls.has(pathToUrl(f)))
  : allHtmlFiles;
console.log(`扫描 ${htmlFiles.length} 个 HTML 页面（全量 ${allHtmlFiles.length}，过滤 ${allHtmlFiles.length - htmlFiles.length} 个残留）\n`);

// 构建 URL → 文件路径映射
const urlToFile = new Map();
for (const f of htmlFiles) urlToFile.set(pathToUrl(f), f);

// 入链映射：pageUrl -> Set<来源 pageUrl>
const inboundMap = new Map();
// 入链锚文本映射：pageUrl -> Map<anchorText, count>
const inboundAnchorMap = new Map();
// 出链统计：pageUrl -> Set<目标 pageUrl>
const outboundMap = new Map();
// 非模板出链：pageUrl -> Set<目标 pageUrl>（排除模板导航）
const outboundNonTemplateMap = new Map();
// 无意义锚文本记录：[{ from, to, text }]
const badAnchors = [];

// 初始化所有页面
for (const url of urlToFile.keys()) {
  inboundMap.set(url, new Set());
  inboundAnchorMap.set(url, new Map());
  outboundMap.set(url, new Set());
  outboundNonTemplateMap.set(url, new Set());
}

// 扫描每个页面，构建图谱
for (const filePath of htmlFiles) {
  const html = readFileSync(filePath, 'utf8');
  const pageUrl = pathToUrl(filePath);
  const linksWithText = extractInternalLinksWithText(html);

  for (const { href, text } of linksWithText) {
    const normalized = normalizeHref(href);
    // 仅记录站点存在的目标
    if (!urlToFile.has(normalized)) continue;
    // 跳过自环
    if (normalized === pageUrl) continue;

    outboundMap.get(pageUrl).add(normalized);
    inboundMap.get(normalized).add(pageUrl);
    // 锚文本计数
    const anchorMap = inboundAnchorMap.get(normalized);
    anchorMap.set(text, (anchorMap.get(text) ?? 0) + 1);
    // 非模板出链
    if (!isTemplateNav(href)) {
      outboundNonTemplateMap.get(pageUrl).add(normalized);
    }
    // 无意义锚文本
    if (isBadAnchor(text)) {
      badAnchors.push({ from: pageUrl, to: normalized, text });
    }
  }
}

// === 审计维度 ===

// 1. 孤立页面：入链 = 0（无人引用）
const orphanPages = [];
for (const [url, inbound] of inboundMap.entries()) {
  if (inbound.size === 0) {
    orphanPages.push({ url, type: classifyPage(url) });
  }
}

// 2. 入链稀疏页面：入链 < 2 且非首页/静态页
const sparseInbound = [];
for (const [url, inbound] of inboundMap.entries()) {
  const type = classifyPage(url);
  if (type === 'home' || type === 'static' || type === 'blog-index') continue;
  if (inbound.size < 2) {
    sparseInbound.push({ url, type, inboundCount: inbound.size });
  }
}

// 3. 出链稀疏页面：非模板出链 = 0（除模板导航外无主动外链）
const sparseOutbound = [];
for (const [url, outbound] of outboundNonTemplateMap.entries()) {
  const type = classifyPage(url);
  if (type === 'home' || type === 'static') continue;
  if (outbound.size === 0) {
    sparseOutbound.push({ url, type });
  }
}

// 4. 按页面类型分组统计入链分布
const typeStats = new Map();
for (const url of urlToFile.keys()) {
  const type = classifyPage(url);
  if (!typeStats.has(type)) {
    typeStats.set(type, { count: 0, inboundSum: 0, inboundMin: Infinity, inboundMax: 0 });
  }
  const stat = typeStats.get(type);
  const inbound = inboundMap.get(url).size;
  stat.count++;
  stat.inboundSum += inbound;
  stat.inboundMin = Math.min(stat.inboundMin, inbound);
  stat.inboundMax = Math.max(stat.inboundMax, inbound);
}
// 计算平均入链
for (const stat of typeStats.values()) {
  stat.inboundAvg = (stat.inboundSum / stat.count).toFixed(2);
}

// === 输出报告 ===
console.log('=== 内链网络质量审计报告 ===\n');

console.log(`[页面类型分布]`);
const typeOrder = ['home', 'static', 'tool', 'blog-index', 'blog-pagination', 'blog-tag', 'blog-post'];
for (const type of typeOrder) {
  const stat = typeStats.get(type);
  if (stat) {
    console.log(`  ${type.padEnd(16)} 数量=${String(stat.count).padStart(4)}  入链 min=${stat.inboundMin}  avg=${stat.inboundAvg}  max=${stat.inboundMax}`);
  }
}

console.log(`\n[孤立页面 - 入链=0] 共 ${orphanPages.length} 页`);
// 按类型分组显示
const orphansByType = new Map();
for (const p of orphanPages) {
  if (!orphansByType.has(p.type)) orphansByType.set(p.type, []);
  orphansByType.get(p.type).push(p.url);
}
for (const [type, urls] of orphansByType.entries()) {
  console.log(`  ${type} (${urls.length} 页):`);
  urls.slice(0, 30).forEach((u) => console.log(`    - ${u}`));
  if (urls.length > 30) console.log(`    ... 还有 ${urls.length - 30} 页`);
}

console.log(`\n[入链稀疏页面 - 入链<2] 共 ${sparseInbound.length} 页（排除首页/静态页/博客索引）`);
// 按入链数排序，少者优先
sparseInbound.sort((a, b) => a.inboundCount - b.inboundCount);
const sparseByType = new Map();
for (const p of sparseInbound) {
  if (!sparseByType.has(p.type)) sparseByType.set(p.type, []);
  sparseByType.get(p.type).push(p);
}
for (const [type, items] of sparseByType.entries()) {
  console.log(`  ${type} (${items.length} 页):`);
  items.slice(0, 20).forEach((p) => console.log(`    - ${p.url}  入链=${p.inboundCount}`));
  if (items.length > 20) console.log(`    ... 还有 ${items.length - 20} 页`);
}

console.log(`\n[出链稀疏页面 - 非模板出链=0] 共 ${sparseOutbound.length} 页（排除首页/静态页）`);
const sparseOutByType = new Map();
for (const p of sparseOutbound) {
  if (!sparseOutByType.has(p.type)) sparseOutByType.set(p.type, []);
  sparseOutByType.get(p.type).push(p.url);
}
for (const [type, urls] of sparseOutByType.entries()) {
  console.log(`  ${type} (${urls.length} 页):`);
  urls.slice(0, 20).forEach((u) => console.log(`    - ${u}`));
  if (urls.length > 20) console.log(`    ... 还有 ${urls.length - 20} 页`);
}

console.log(`\n[无意义锚文本] 共 ${badAnchors.length} 处`);
// 按目标页面聚合
const badAnchorByTarget = new Map();
for (const b of badAnchors) {
  if (!badAnchorByTarget.has(b.to)) badAnchorByTarget.set(b.to, []);
  badAnchorByTarget.get(b.to).push(b);
}
// 按出现次数排序，Top 30
const sortedBadTargets = [...badAnchorByTarget.entries()].sort((a, b) => b[1].length - a[1].length);
sortedBadTargets.slice(0, 30).forEach(([to, items]) => {
  const texts = [...new Set(items.map((i) => i.text || '(空)'))].slice(0, 5);
  console.log(`  -> ${to}  (${items.length} 处, 锚文本: ${texts.join(' / ')})`);
});

console.log(`\n[入链最少的工具页 Top 30] 用于识别需要补充内链的工具页`);
// 仅工具页，按入链数升序
const toolInboundSorted = [];
for (const [url, inbound] of inboundMap.entries()) {
  if (classifyPage(url) === 'tool') {
    toolInboundSorted.push({ url, inboundCount: inbound.size, sources: [...inbound] });
  }
}
toolInboundSorted.sort((a, b) => a.inboundCount - b.inboundCount);
toolInboundSorted.slice(0, 30).forEach((p) => {
  console.log(`  ${String(p.inboundCount).padStart(3)} 入链  ${p.url}`);
  // 显示入链来源（帮助识别是否缺少相关博客文章内链）
  const sourcesByType = { home: [], tool: [], 'blog-post': [], 'blog-tag': [], other: [] };
  for (const src of p.sources) {
    const type = classifyPage(src);
    if (sourcesByType[type]) sourcesByType[type].push(src);
    else sourcesByType.other.push(src);
  }
  console.log(`         来源: 首页=${sourcesByType.home.length} 工具页=${sourcesByType.tool.length} 博客=${sourcesByType['blog-post'].length} 标签=${sourcesByType['blog-tag'].length}`);
});

console.log(`\n[入链最少的博客文章 Top 20] 用于识别需要补充内链的博客文章`);
const blogInboundSorted = [];
for (const [url, inbound] of inboundMap.entries()) {
  if (classifyPage(url) === 'blog-post') {
    blogInboundSorted.push({ url, inboundCount: inbound.size });
  }
}
blogInboundSorted.sort((a, b) => a.inboundCount - b.inboundCount);
blogInboundSorted.slice(0, 20).forEach((p) => {
  console.log(`  ${String(p.inboundCount).padStart(3)} 入链  ${p.url}`);
});

console.log(`\n=== 审计完成 ===`);
console.log(`扫描页面: ${htmlFiles.length}`);
console.log(`孤立页面: ${orphanPages.length}`);
console.log(`入链稀疏(<2): ${sparseInbound.length}`);
console.log(`出链稀疏(=0): ${sparseOutbound.length}`);
console.log(`无意义锚文本: ${badAnchors.length} 处`);

// 输出 JSON 详细报告（便于后续脚本处理）
const report = {
  scannedAt: new Date().toISOString(),
  totalPages: htmlFiles.length,
  typeStats: Object.fromEntries(typeStats),
  orphanPages,
  sparseInbound,
  sparseOutbound,
  badAnchors: badAnchors.slice(0, 200), // 限制大小
  badAnchorsTotal: badAnchors.length,
};
console.log(`\n[JSON 报告已生成]`);
console.log(JSON.stringify(report, null, 2));
