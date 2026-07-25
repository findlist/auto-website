// 标签工具：统一标签与 URL slug 的转换逻辑，避免重复代码
// 用于博客标签筛选页 /blog/tag/[tag] 的路由参数与链接生成

/**
 * 把标签转为 URL 友好的 slug
 *
 * 采用白名单策略：只保留小写字母、数字、连字符、中文字符，移除其他所有特殊字符。
 * 解决点号、括号、@、!、&、单引号等特殊字符导致的非 URL 安全 slug 问题。
 *
 * 处理流程：
 * 1. 转小写 + 去首尾空白
 * 2. 空格转连字符
 * 3. 白名单过滤（移除非 URL 安全字符）
 * 4. 修剪首尾连字符 + 合并连续连字符
 *
 * 示例：
 * - "Web API" → "web-api"
 * - "Let's Encrypt" → "lets-encrypt"（移除单引号）
 * - "X.509" → "x509"（移除点号）
 * - "if()" → "if"（移除括号）
 * - "@container" → "container"（移除@）
 * - "!important" → "important"（移除!）
 * - "&-选择器" → "选择器"（移除&和首尾连字符）
 * - "编码" → "编码"（保留中文）
 */
export function tagToSlug(tag: string): string {
  return tag
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    // 白名单：只保留小写字母、数字、连字符、CJK 统一汉字
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '')
    // 修剪首尾连字符（如 "&-选择器" 过滤后为 "-选择器"，需修剪为首字符）
    .replace(/^-+|-+$/g, '')
    // 合并连续连字符
    .replace(/-{2,}/g, '-');
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
