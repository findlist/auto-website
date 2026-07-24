// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

/**
 * rehype 插件：为 Markdown 渲染出的 <img> 自动添加 loading="lazy" 与 decoding="async"。
 * 仅作用于博客 markdown 内容（Astro 的 rehypePlugins 仅在 markdown→html 管道中执行），
 * 工具页手写的 <img>（如有）不受影响；零依赖递归遍历 hast 树，幂等（已有属性则跳过）。
 * 目的：延迟首屏外的图片加载，降低 LCP 与 CLS，提升移动端体验与 Lighthouse 评分。
 */
const rehypeLazyImages = () => (/** @type {any} */ tree) => {
  /** @param {any} node */
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    // 命中 <img> 元素：补齐懒加载与异步解码属性（已有则保留原值）
    if (node.type === 'element' && node.tagName === 'img') {
      const props = node.properties || (node.properties = {});
      if (!props.loading) props.loading = 'lazy';
      if (!props.decoding) props.decoding = 'async';
    }
    // 递归处理子节点（element 的 children / root 的 children）
    if (node.children) walk(node.children);
  };
  walk(tree);
  return tree;
};

// 站点配置：上线后用户回写 docs/site-config.md 时同步更新此 URL
export default defineConfig({
  site: 'https://website.niuzi.asia',
  integrations: [react(), sitemap()],
  // 输出静态站点，便于免费部署到 Cloudflare Pages / Vercel / Netlify
  output: 'static',
  compressHTML: true,
  build: {
    inlineStylesheets: 'auto',
  },
  markdown: {
    // 为所有博客 markdown 图片自动启用懒加载，无需逐篇手动处理
    rehypePlugins: [rehypeLazyImages],
  },
});
