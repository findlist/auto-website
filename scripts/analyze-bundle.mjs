// 扫描 dist/ 下所有 HTML 页面，统计每个页面加载的 JS 总量
// 用法：
//   node scripts/analyze-bundle.mjs          # 仅输出报告
//   node scripts/analyze-bundle.mjs --check  # 超限页面存在时以退出码 1 退出（用于 postbuild 守护）
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// 质量红线：单页 JS 总加载量上限（KB），与规范一致
const BUNDLE_LIMIT_KB = 200;
// --check 模式：存在超限页面时以非零退出码退出，用于 postbuild 自动阻断违规构建
const CHECK_MODE = process.argv.includes('--check');

const DIST = 'dist';
const ASTRO_DIR = join(DIST, '_astro');

// 预加载所有 _astro/*.js 文件的大小
const jsSizeMap = new Map();
for (const file of readdirSync(ASTRO_DIR)) {
  if (file.endsWith('.js')) {
    const size = statSync(join(ASTRO_DIR, file)).size;
    jsSizeMap.set(file, size);
  }
}

// 递归收集所有 HTML 文件
function collectHtml(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectHtml(full, acc);
    } else if (entry.name.endsWith('.html')) {
      acc.push(full);
    }
  }
  return acc;
}

// 从 HTML 中提取引用的 _astro/*.js 文件名
function extractJsRefs(html) {
  const refs = new Set();
  // 匹配 /_astro/xxx.js 形式（含 modulepreload link 与 script src）
  const re = /\/_astro\/([^"'\s)]+\.js)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    refs.add(m[1]);
  }
  return refs;
}

const htmlFiles = collectHtml(DIST);
const results = [];

for (const htmlFile of htmlFiles) {
  const html = readFileSync(htmlFile, 'utf8');
  const refs = extractJsRefs(html);
  let totalSize = 0;
  const refList = [];
  for (const ref of refs) {
    const size = jsSizeMap.get(ref);
    if (size !== undefined) {
      totalSize += size;
      refList.push({ name: ref, sizeKB: Math.round(size / 1024 * 100) / 100 });
    }
  }
  // 转为相对路径，便于阅读
  const relPath = htmlFile.replace(/\\/g, '/').replace('dist/', '/');
  results.push({ page: relPath, totalKB: Math.round(totalSize / 1024 * 100) / 100, jsCount: refList.length, refs: refList.sort((a, b) => b.sizeKB - a.sizeKB) });
}

// 按总 JS 大小降序排序
results.sort((a, b) => b.totalKB - a.totalKB);

// 输出前 30 个最大的页面
console.log(`\n=== 单页 JS 总加载量 TOP 30（共 ${htmlFiles.length} 个 HTML 页面）===\n`);
console.log('排名 | 总JS(KB) | JS文件数 | 页面路径 | 主要JS文件');
console.log('---|---|---|---|---');
results.slice(0, 30).forEach((r, i) => {
  const top3 = r.refs.slice(0, 3).map(x => `${x.name}(${x.sizeKB}KB)`).join(' + ');
  const flag = r.totalKB > BUNDLE_LIMIT_KB ? ` [!超${BUNDLE_LIMIT_KB}KB]` : r.totalKB > 150 ? ` [⚠接近${BUNDLE_LIMIT_KB}KB]` : '';
  console.log(`${i + 1} | ${r.totalKB} | ${r.jsCount} | ${r.page} | ${top3}${flag}`);
});

// 统计超限页面
const overLimit = results.filter(r => r.totalKB > BUNDLE_LIMIT_KB);
const nearLimit = results.filter(r => r.totalKB > 150 && r.totalKB <= BUNDLE_LIMIT_KB);
console.log(`\n=== 汇总 ===`);
console.log(`超 200KB 红线的页面: ${overLimit.length} 个`);
console.log(`150-200KB 接近红线的页面: ${nearLimit.length} 个`);
console.log(`JS 总加载量最大页面: ${results[0].page} (${results[0].totalKB} KB)`);
console.log(`JS 总加载量最小页面(有JS): ${[...results].reverse().find(r => r.totalKB > 0)?.page || '无'} (${[...results].reverse().find(r => r.totalKB > 0)?.totalKB || 0} KB)`);

// 输出超限页面详情
if (overLimit.length > 0) {
  console.log(`\n=== 超 ${BUNDLE_LIMIT_KB}KB 红线页面详情 ===`);
  for (const r of overLimit) {
    console.log(`\n${r.page} (${r.totalKB} KB, ${r.jsCount} 个JS文件):`);
    for (const ref of r.refs) {
      console.log(`  - ${ref.name} (${ref.sizeKB} KB)`);
    }
  }
}

// --check 模式：超限页面存在时以非零退出码退出，用于 postbuild 自动阻断违规构建
if (CHECK_MODE) {
  if (overLimit.length > 0) {
    console.error(`\n✗ Bundle 守护失败：${overLimit.length} 个页面超过 ${BUNDLE_LIMIT_KB}KB 红线，请优化后再部署`);
    process.exit(1);
  }
  console.log(`\n✓ Bundle 守护通过：0 个页面超过 ${BUNDLE_LIMIT_KB}KB 红线`);
}
