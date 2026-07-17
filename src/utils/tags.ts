// 标签工具：统一标签与 URL slug 的转换逻辑，避免重复代码
// 用于博客标签筛选页 /blog/tag/[tag] 的路由参数与链接生成

/**
 * 把标签转为 URL 友好的 slug
 * 规则：小写 + 空格转连字符 + 移除 Windows 文件系统非法字符与路径分隔符 + 保留中文字符与字母数字
 * 示例："Web API" → "web-api"，"SHA-256" → "sha-256"，"编码" → "编码"，":scope" → "scope"，"HTTP/3" → "http3"
 */
export function tagToSlug(tag: string): string {
  return tag
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[<>:"|?*/\\]/g, '');
}

/**
 * 从所有文章中收集标签，返回去重后的标签数组
 * 每个标签包含原始文本与对应 slug
 */
export function collectTags(posts: Array<{ data: { tags: string[] } }>) {
  const tagMap = new Map<string, string>(); // slug → 原始标签
  for (const post of posts) {
    for (const tag of post.data.tags) {
      const slug = tagToSlug(tag);
      // 同一 slug 只保留首次出现的原始标签（避免大小写差异导致重复）
      if (!tagMap.has(slug)) {
        tagMap.set(slug, tag);
      }
    }
  }
  return Array.from(tagMap.entries()).map(([slug, name]) => ({ slug, name }));
}
