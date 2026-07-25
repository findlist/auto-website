// 检查所有博客标签中包含 "Encrypt" 的标签字节
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const blogDir = 'src/content/blog';
const files = readdirSync(blogDir).filter(f => f.endsWith('.md'));

for (const file of files) {
  const content = readFileSync(join(blogDir, file), 'utf8');
  // 匹配 tags: ["..."] 或 tags:\n  - "..."
  const tagsMatch = content.match(/^tags:\s*(\[.+\]|(?:\n  - .+)+)$/m);
  if (!tagsMatch) continue;

  let tags = [];
  if (tagsMatch[1].startsWith('[')) {
    // 数组形式
    tags = tagsMatch[1].slice(1, -1).split(',').map(t => t.trim().replace(/^["']|["']$/g, ''));
  } else {
    // YAML 列表形式
    tags = tagsMatch[1].trim().split('\n').map(line => line.replace(/^\s*-\s*/, '').replace(/^["']|["']$/g, ''));
  }

  for (const tag of tags) {
    if (tag.toLowerCase().includes('encrypt')) {
      const bytes = Buffer.from(tag, 'utf8');
      // 找出非 ASCII 字符
      const nonAscii = [];
      for (let i = 0; i < tag.length; i++) {
        const code = tag.charCodeAt(i);
        if (code > 127) {
          nonAscii.push(`pos ${i}: U+${code.toString(16).toUpperCase()} '${tag[i]}'`);
        }
      }
      // 检查单引号
      const singleQuotes = [];
      for (let i = 0; i < tag.length; i++) {
        const code = tag.charCodeAt(i);
        if (code === 0x27 || code === 0x2018 || code === 0x2019 || code === 0x201b) {
          singleQuotes.push(`pos ${i}: U+${code.toString(16).toUpperCase()}`);
        }
      }
      console.log(`file: ${file}`);
      console.log(`  tag: "${tag}"`);
      console.log(`  hex: ${bytes.toString('hex')}`);
      console.log(`  singleQuotes: ${singleQuotes.length ? singleQuotes.join(', ') : 'none'}`);
      console.log(`  nonAscii: ${nonAscii.length ? nonAscii.join(', ') : 'none'}`);
    }
  }
}
