// 找出 dist/blog/tag/ 下的残留目录（不在新构建 slug 集合中的目录）
// 这些目录是 tagToSlug 修改前的旧构建残留，需清理
import { readdirSync, statSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';

// 复制当前 tagToSlug 实现
function tagToSlug(tag) {
  return tag
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

// 从所有博客 frontmatter 收集标签（复用 test-tagslug.mjs 的逻辑）
import { readFileSync as rf, readdirSync as rd } from 'node:fs';
import { join } from 'node:path';

const blogDir = 'src/content/blog';
const files = rd(blogDir).filter(f => f.endsWith('.md'));
const validSlugs = new Set();

for (const file of files) {
  const content = rf(join(blogDir, file), 'utf8');
  const tagsMatch = content.match(/^tags:\s*(\[.+\]|(?:\n  - .+)+)$/m);
  if (!tagsMatch) continue;
  let tags = [];
  if (tagsMatch[1].startsWith('[')) {
    tags = tagsMatch[1].slice(1, -1).split(',').map(t => t.trim().replace(/^["']|["']$/g, ''));
  } else {
    tags = tagsMatch[1].trim().split('\n').map(line => line.replace(/^\s*-\s*/, '').replace(/^["']|["']$/g, ''));
  }
  for (const tag of tags) {
    validSlugs.add(tagToSlug(tag));
  }
}

// 列出 dist/blog/tag/ 下的所有目录
const distTagDir = 'dist/blog/tag';
const distEntries = readdirSync(distTagDir);
const staleDirs = [];
const validDirs = [];

for (const entry of distEntries) {
  const full = join(distTagDir, entry);
  if (!statSync(full).isDirectory()) continue;
  if (validSlugs.has(entry)) {
    validDirs.push(entry);
  } else {
    staleDirs.push(entry);
  }
}

console.log(`=== dist/blog/tag/ 目录清理 ===`);
console.log(`有效目录: ${validDirs.length} 个`);
console.log(`残留目录: ${staleDirs.length} 个`);
console.log(`\n残留目录列表:`);
for (const d of staleDirs) {
  console.log(`  - ${d}`);
}

// 删除残留目录
if (staleDirs.length > 0) {
  console.log(`\n开始清理残留目录...`);
  for (const d of staleDirs) {
    rmSync(join(distTagDir, d), { recursive: true, force: true });
    console.log(`  已删除: ${d}`);
  }
  console.log(`清理完成，共删除 ${staleDirs.length} 个残留目录`);
}
