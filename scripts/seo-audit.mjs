// SEO 全站审计脚本：扫描 dist 产出，检查 OG 标签、canonical、图片 alt、内链 404、JSON-LD
// 使用 Node.js fs，UTF-8 安全（避免 PowerShell GBK 误码问题）
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(__dirname, '../dist');

// 解码 HTML 实体（如 &#38; → &），避免内链 404 误报
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

// 解码 percent-encode（如 %E4%BC%98 → 优），用于 canonical 与文件路径可比对
function decodePercent(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
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

// 从文件路径推导页面 URL（相对站点根）
function pathToUrl(filePath) {
  const rel = filePath.replace(DIST_DIR, '').replace(/\\/g, '/').replace('/index.html', '/');
  return rel === '' ? '/' : rel;
}

// 从 HTML 中提取所有 <meta> 标签
function extractMeta(html) {
  const metas = {};
  const re = /<meta\s+(?:property|name)=["']([^"']+)["']\s+content=["']([^"']*)["']/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    metas[m[1]] = m[2];
  }
  return metas;
}

// 提取 canonical
function extractCanonical(html) {
  const m = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/);
  return m ? m[1] : null;
}

// 提取所有 <img> 标签，返回 {src, alt} 数组
function extractImages(html) {
  const imgs = [];
  const re = /<img\s+([^>]*?)\s*\/?>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const srcMatch = attrs.match(/src=["']([^"']+)["']/);
    const altMatch = attrs.match(/alt=["']([^"']*)["']/);
    imgs.push({
      src: srcMatch ? srcMatch[1] : '',
      alt: altMatch ? altMatch[1] : null,
      hasAlt: altMatch !== null,
    });
  }
  return imgs;
}

// 提取所有内部 <a href> 链接（排除外链、锚点、邮件、tel）
function extractInternalLinks(html) {
  const links = new Set();
  const re = /<a\s+[^>]*href=["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    // 解码 HTML 实体（如 &#38; → &），避免内链 404 误报
    const href = decodeHtmlEntities(m[1]);
    if (/^(https?:|mailto:|tel:|data:)/i.test(href)) continue;
    if (href.startsWith('#')) continue;
    links.add(href);
  }
  return [...links];
}

// 提取 JSON-LD 块数量
function extractJsonLd(html) {
  const matches = html.match(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g);
  return matches ? matches.length : 0;
}

const htmlFiles = collectHtmlFiles(DIST_DIR);
console.log(`扫描 ${htmlFiles.length} 个 HTML 页面\n`);

const issues = {
  ogMissing: [],        // OG 标签缺失
  canonicalMismatch: [],// canonical 与 URL 不一致
  imgAltMissing: [],    // 图片缺 alt
  brokenLinks: [],      // 内链 404
  jsonLdMissing: [],    // JSON-LD 缺失
  titleMissing: [],     // title 缺失
  descMissing: [],      // description 缺失
};

// 构建 URL → 文件路径映射（用于内链 404 检查）
const urlToFile = new Map();
for (const f of htmlFiles) {
  urlToFile.set(pathToUrl(f), f);
}

// OG 必需字段
const OG_REQUIRED = ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:url', 'og:image', 'og:locale'];

let scanned = 0;
for (const filePath of htmlFiles) {
  scanned++;
  const html = readFileSync(filePath, 'utf8');
  const pageUrl = pathToUrl(filePath);
  const metas = extractMeta(html);
  const canonical = extractCanonical(html);

  // 1. title / description 缺失
  if (!metas['description']) issues.descMissing.push(pageUrl);
  const titleMatch = html.match(/<title>([^<]*)<\/title>/);
  if (!titleMatch || !titleMatch[1].trim()) issues.titleMissing.push(pageUrl);

  // 2. OG 标签完整性
  const missingOg = OG_REQUIRED.filter(k => !metas[k]);
  if (missingOg.length > 0) {
    issues.ogMissing.push({ url: pageUrl, missing: missingOg });
  }

  // 3. canonical 一致性：canonical 应等于 站点URL + pageUrl
  // 注意：canonical 中的非 ASCII 字符会被 percent-encode，比较时需先解码
  if (canonical) {
    const expected = `https://website.niuzi.asia${pageUrl === '/' ? '/' : pageUrl}`;
    const canonicalDecoded = decodePercent(canonical);
    if (canonical !== expected && canonicalDecoded !== expected) {
      issues.canonicalMismatch.push({ url: pageUrl, canonical, expected });
    }
  }

  // 4. 图片 alt 属性
  const imgs = extractImages(html);
  for (const img of imgs) {
    if (!img.hasAlt) {
      issues.imgAltMissing.push({ url: pageUrl, src: img.src });
    }
  }

  // 5. JSON-LD
  const ldCount = extractJsonLd(html);
  if (ldCount === 0) issues.jsonLdMissing.push(pageUrl);

  // 6. 内链 404 检查（采样：仅检查同站点链接是否对应文件）
  const links = extractInternalLinks(html);
  for (const href of links) {
    // 解析链接路径（去除 query 和 hash）
    let path = href.split('#')[0].split('?')[0];
    if (path === '') path = '/';
    // 规范化：确保以 / 开头
    if (!path.startsWith('/')) path = '/' + path;
    // 去除尾部斜杠（除根路径外）
    const normalized = path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path;
    // 检查是否存在对应文件：尝试 path/ 和 path/index.html
    const candidateUrl1 = path.endsWith('/') ? path : path + '/';
    const candidateUrl2 = normalized === '/' ? '/' : normalized + '/';
    const exists = urlToFile.has(candidateUrl1) || urlToFile.has(candidateUrl2) || urlToFile.has(path) || urlToFile.has(normalized);
    if (!exists) {
      issues.brokenLinks.push({ url: pageUrl, href });
    }
  }
}

// 输出报告
console.log('=== SEO 审计报告 ===\n');

console.log(`[title 缺失] ${issues.titleMissing.length} 页`);
if (issues.titleMissing.length > 0) {
  issues.titleMissing.slice(0, 10).forEach(u => console.log(`  - ${u}`));
}

console.log(`\n[description 缺失] ${issues.descMissing.length} 页`);
if (issues.descMissing.length > 0) {
  issues.descMissing.slice(0, 10).forEach(u => console.log(`  - ${u}`));
}

console.log(`\n[OG 标签缺失] ${issues.ogMissing.length} 页`);
if (issues.ogMissing.length > 0) {
  issues.ogMissing.slice(0, 10).forEach(i => console.log(`  - ${i.url}: 缺 ${i.missing.join(', ')}`));
}

console.log(`\n[canonical 不一致] ${issues.canonicalMismatch.length} 页`);
if (issues.canonicalMismatch.length > 0) {
  issues.canonicalMismatch.slice(0, 20).forEach(i => console.log(`  - ${i.url}\n      canonical: ${i.canonical}\n      expected:  ${i.expected}`));
}

console.log(`\n[图片 alt 缺失] ${issues.imgAltMissing.length} 处`);
if (issues.imgAltMissing.length > 0) {
  issues.imgAltMissing.slice(0, 20).forEach(i => console.log(`  - ${i.url}: <img src="${i.src}">`));
}

console.log(`\n[JSON-LD 缺失] ${issues.jsonLdMissing.length} 页`);
if (issues.jsonLdMissing.length > 0) {
  issues.jsonLdMissing.slice(0, 10).forEach(u => console.log(`  - ${u}`));
}

console.log(`\n[内链 404] ${issues.brokenLinks.length} 处`);
if (issues.brokenLinks.length > 0) {
  // 按 href 聚合，显示 Top 30
  const byHref = {};
  for (const i of issues.brokenLinks) {
    byHref[i.href] = (byHref[i.href] || 0) + 1;
  }
  const sorted = Object.entries(byHref).sort((a, b) => b[1] - a[1]);
  console.log(`  按 href 聚合 Top 30：`);
  sorted.slice(0, 30).forEach(([href, count]) => console.log(`  - ${href} (出现在 ${count} 个页面)`));
}

console.log(`\n=== 审计完成 ===`);
console.log(`扫描页面: ${scanned}`);
console.log(`问题总计: title=${issues.titleMissing.length}, desc=${issues.descMissing.length}, og=${issues.ogMissing.length}, canonical=${issues.canonicalMismatch.length}, imgAlt=${issues.imgAltMissing.length}, jsonLd=${issues.jsonLdMissing.length}, brokenLinks=${issues.brokenLinks.length}`);
