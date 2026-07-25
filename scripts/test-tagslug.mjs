// 验证 tagToSlug 修复后所有特殊字符标签的 slug 生成 + 冲突检测
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// 新的 tagToSlug 实现（白名单方式）
function tagToSlug(tag) {
  return tag
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

const blogDir = 'src/content/blog';
const files = readdirSync(blogDir).filter(f => f.endsWith('.md'));

// 收集所有标签及其 slug
const slugToTags = new Map(); // slug → [tag, file][]
const allTags = [];

for (const file of files) {
  const content = readFileSync(join(blogDir, file), 'utf8');
  const tagsMatch = content.match(/^tags:\s*(\[.+\]|(?:\n  - .+)+)$/m);
  if (!tagsMatch) continue;

  let tags = [];
  if (tagsMatch[1].startsWith('[')) {
    tags = tagsMatch[1].slice(1, -1).split(',').map(t => t.trim().replace(/^["']|["']$/g, ''));
  } else {
    tags = tagsMatch[1].trim().split('\n').map(line => line.replace(/^\s*-\s*/, '').replace(/^["']|["']$/g, ''));
  }

  for (const tag of tags) {
    const slug = tagToSlug(tag);
    allTags.push({ tag, slug, file });

    if (!slugToTags.has(slug)) {
      slugToTags.set(slug, []);
    }
    slugToTags.get(slug).push({ tag, file });
  }
}

// 1. 输出所有包含特殊字符的标签及其新 slug
console.log('=== 含特殊字符的标签 slug 变化 ===');
const specialChars = /[^a-z0-9\u4e00-\u9fff-]/;
for (const { tag, slug, file } of allTags) {
  if (specialChars.test(tag)) {
    console.log(`  "${tag}" → "${slug}"  (${file})`);
  }
}

// 2. 检测 slug 冲突（不同标签生成相同 slug）
console.log('\n=== Slug 冲突检测 ===');
let hasConflict = false;
for (const [slug, entries] of slugToTags) {
  const uniqueTags = new Set(entries.map(e => e.tag));
  if (uniqueTags.size > 1) {
    hasConflict = true;
    console.log(`  冲突! slug="${slug}" 对应多个标签:`);
    for (const e of entries) {
      console.log(`    "${e.tag}" (${e.file})`);
    }
  }
}
if (!hasConflict) {
  console.log('  无冲突 ✅');
}

// 3. 统计
console.log(`\n=== 统计 ===`);
console.log(`总标签数: ${allTags.length}`);
console.log(`唯一 slug 数: ${slugToTags.size}`);
console.log(`含特殊字符的标签数: ${allTags.filter(t => specialChars.test(t.tag)).length}`);
