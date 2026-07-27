// 查找包含 /blog/tag/asn.1 等链接的 HTML 页面，显示链接上下文
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(__dirname, '../dist');
const BROKEN_PATTERNS = ['/blog/tag/asn.1', '/blog/tag/x.509', '/blog/tag/cargo.toml', '/blog/tag/pyproject.toml'];

function collectHtmlFiles(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collectHtmlFiles(full, files);
    else if (entry === 'index.html') files.push(full);
  }
  return files;
}

const files = collectHtmlFiles(DIST_DIR);
let found = 0;
for (const f of files) {
  const html = readFileSync(f, 'utf8');
  for (const pat of BROKEN_PATTERNS) {
    if (html.includes(pat)) {
      const idx = html.indexOf(pat);
      const ctx = html.substring(Math.max(0, idx - 80), idx + pat.length + 40);
      console.log(`文件: ${f.replace(DIST_DIR, '')}`);
      console.log(`  模式: ${pat}`);
      console.log(`  上下文: ...${ctx}...`);
      console.log('');
      found++;
      if (found >= 8) process.exit(0);
      break;
    }
  }
}
console.log(`共找到 ${found} 个包含旧链接的页面`);
