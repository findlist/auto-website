/**
 * 站点 URL 集中化获取工具
 *
 * 解决 BUG-35：全站 8 处 SITE_URL 回退到占位域名 toolbox.example.com 的问题
 * 改为 fail-fast 策略——未配置 site 时直接抛错，防止部署时遗漏 astro.config.mjs 的 site 字段
 * 导致全站 canonical / JSON-LD / OG 标签指向错误域名
 */

/**
 * 获取站点根 URL（去除尾斜杠）
 *
 * @param site - Astro.site 或 API 路由上下文的 site，来自 astro.config.mjs 的 site 配置
 * @returns 无尾斜杠的站点根 URL，如 "https://website.niuzi.asia"
 * @throws 未配置 site 时抛出明确错误，引导开发者修改 astro.config.mjs
 */
export function getSiteUrl(site: URL | undefined): string {
  if (!site) {
    throw new Error(
      '[构建失败] astro.config.mjs 的 site 字段未配置。\n' +
      '请在 astro.config.mjs 中设置 site 为线上域名，例如：\n' +
      "  export default defineConfig({ site: 'https://your-domain.com', ... })\n" +
      '该配置是全站 canonical、JSON-LD、OG 标签、sitemap、RSS 的 URL 基础。'
    );
  }
  return site.toString().replace(/\/$/, '');
}
