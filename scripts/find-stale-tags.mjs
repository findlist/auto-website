// 找出 dist/blog/tag/ 下的残留目录（不在新构建 slug 集合中的目录）
// 这些目录是 tagToSlug 修改前的旧构建残留，需清理
// Windows 下 rmSync 对含 ! & @ ( ) ' 等特殊字符的目录会静默失败，
// 因此在 rmSync 后做存在性验证，失败时用 PowerShell -LiteralPath 强制删除
import { readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

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

// 跨平台删除残留目录：rmSync 优先，Windows 下失败时用 PowerShell -LiteralPath 兜底
function removeStaleDir(dirPath) {
  // 第一步：尝试 rmSync（Linux 下正常工作，Windows 下可能对特殊字符静默失败）
  try {
    rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // rmSync 抛异常时忽略，进入下一步验证
  }
  // 验证是否真的删除（Windows 下 rmSync 可能静默失败但不抛异常）
  if (!existsSync(dirPath)) return true;

  // 第二步：Windows 下用 PowerShell -LiteralPath 强制删除
  // -LiteralPath 不会解释通配符，能正确处理含 ! & @ ( ) ' 等特殊字符的路径
  if (process.platform === 'win32') {
    try {
      // PowerShell 单引号字符串中，单引号本身用两个单引号转义
      const escapedPath = dirPath.replace(/'/g, "''");
      execSync(
        `powershell -NoProfile -Command "Remove-Item -LiteralPath '${escapedPath}' -Recurse -Force"`,
        { stdio: 'pipe' }
      );
      return !existsSync(dirPath);
    } catch {
      return false;
    }
  }
  return false;
}

// 删除残留目录
if (staleDirs.length > 0) {
  console.log(`\n开始清理残留目录...`);
  const failed = [];
  for (const d of staleDirs) {
    const fullPath = join(distTagDir, d);
    if (removeStaleDir(fullPath)) {
      console.log(`  已删除: ${d}`);
    } else {
      console.log(`  失败: ${d}（需手动清理）`);
      failed.push(d);
    }
  }
  if (failed.length > 0) {
    console.log(`\n警告：${failed.length} 个目录删除失败，需手动清理`);
  } else {
    console.log(`清理完成，共删除 ${staleDirs.length} 个残留目录`);
  }
}
