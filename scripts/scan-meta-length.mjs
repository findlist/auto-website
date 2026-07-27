// 扫描所有工具页 title 与 description 长度，找出需优化的页面
// 用法：node scripts/scan-meta-length.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PAGES_DIR = new URL('../src/pages/', import.meta.url).pathname.replace(/\//g, '\\').replace(/^\\([A-Z]):\\/i, '$1:\\');

// 兼容 Windows 路径
const pagesDir = join(process.cwd(), 'src', 'pages');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.astro')) out.push(full);
  }
  return out;
}

const files = walk(pagesDir);
const results = [];

for (const f of files) {
  const text = readFileSync(f, 'utf8');
  // 匹配 title: 'xxx' 或 title: "xxx"，支持跨行
  const titleMatch = text.match(/title:\s*['"]([^'"]+)['"]/);
  // description 支持单行或多行
  const descMatch = text.match(/description:\s*\n?\s*['"]([^'"]+)['"]/);
  if (!titleMatch) continue;
  const title = titleMatch[1];
  const desc = descMatch ? descMatch[1] : '';
  results.push({
    file: f.replace(pagesDir, '').replace(/\\/g, '/'),
    titleLen: [...title].length,
    descLen: [...desc].length,
    title,
    desc,
  });
}

// 按 title 长度降序
results.sort((a, b) => b.titleLen - a.titleLen);

console.log(`扫描 ${results.length} 个 .astro 页面\n`);

console.log('=== title 最长 20 个 ===');
results.slice(0, 20).forEach(r => {
  console.log(`[${r.titleLen}字] ${r.file}  →  ${r.title}`);
});

console.log('\n=== title >= 40 字 ===');
const longTitle = results.filter(r => r.titleLen >= 40);
console.log(`共 ${longTitle.length} 个`);
longTitle.forEach(r => {
  console.log(`[${r.titleLen}字] ${r.file}`);
});

// 按 desc 长度降序
const byDesc = [...results].sort((a, b) => b.descLen - a.descLen);
console.log('\n=== description 最长 20 个 ===');
byDesc.slice(0, 20).forEach(r => {
  console.log(`[${r.descLen}字] ${r.file}`);
});

console.log('\n=== description >= 100 字 ===');
const longDesc = byDesc.filter(r => r.descLen >= 100);
console.log(`共 ${longDesc.length} 个`);
longDesc.forEach(r => {
  console.log(`[${r.descLen}字] ${r.file}`);
});
