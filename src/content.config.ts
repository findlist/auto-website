// Content Collections 配置：管理博客文章的元数据与渲染
// Astro 5 内置 Content Layer API，无需额外依赖
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// 博客集合：从 src/content/blog/ 下的 markdown 文件加载
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    // 关联的工具页，用于文末引导用户使用工具
    relatedTool: z.string().optional(),
  }),
});

export const collections = { blog };
