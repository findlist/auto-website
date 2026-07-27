// 检查标签页中的标签云是否包含旧 slug 链接
import { readFileSync } from 'node:fs';

const files = [
  'dist/blog/tag/asn1/index.html',
  'dist/blog/tag/!important/index.html',
  'dist/blog/tag/css/index.html',
];

for (const f of files) {
  try {
    const html = readFileSync(f, 'utf8');
    const canonical = html.match(/rel=["']canonical["']\s+href=["']([^"']+)["']/);
    const hasOldAsn = html.includes('/blog/tag/asn.1');
    const hasNewAsn = html.includes('/blog/tag/asn1');
    const hasOldX509 = html.includes('/blog/tag/x.509');
    const hasNewX509 = html.includes('/blog/tag/x509');
    console.log(`文件: ${f}`);
    console.log(`  canonical: ${canonical ? canonical[1] : '(无)'}`);
    console.log(`  含 /blog/tag/asn.1 (旧): ${hasOldAsn}`);
    console.log(`  含 /blog/tag/asn1  (新): ${hasNewAsn}`);
    console.log(`  含 /blog/tag/x.509 (旧): ${hasOldX509}`);
    console.log(`  含 /blog/tag/x509  (新): ${hasNewX509}`);
    console.log('');
  } catch (e) {
    console.log(`文件: ${f} → ${e.message}`);
  }
}
