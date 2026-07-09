// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

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
});
