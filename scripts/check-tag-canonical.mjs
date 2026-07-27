// 检查 dist/blog/tag/ 下 asn1 与 asn.1 两个目录的 canonical 与 title
import { readFileSync } from 'node:fs';

for (const slug of ['asn1', 'asn.1', 'x509', 'x.509', 'cargotoml', 'cargo.toml', 'pyprojecttoml', 'pyproject.toml']) {
  try {
    const html = readFileSync(`dist/blog/tag/${slug}/index.html`, 'utf8');
    const canonical = html.match(/rel=["']canonical["']\s+href=["']([^"']+)["']/);
    const title = html.match(/<title>([^<]+)<\/title>/);
    console.log(`slug="${slug}"`);
    console.log(`  canonical: ${canonical ? canonical[1] : '(无)'}`);
    console.log(`  title:     ${title ? title[1] : '(无)'}`);
  } catch (e) {
    console.log(`slug="${slug}" → 文件不存在: ${e.message}`);
  }
}
