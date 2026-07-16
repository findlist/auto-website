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

/**
 * 规范化 URL 尾部斜杠：与 Astro 静态生成的目录形式（/foo/index.html）保持一致
 *
 * 处理规则：
 * - 根路径 `/` 保持原样
 * - 已含尾部斜杠的保持原样
 * - 文件形式 URL（含扩展名如 .xml / .png）不处理
 * - 其余目录形式路径追加尾部斜杠
 *
 * 用于全站 canonical / prev-next / JSON-LD url 字段统一，
 * 避免搜索引擎将 /foo 与 /foo/ 识别为重复页面。
 *
 * @param url - 待规范化的绝对或相对 URL
 * @returns 规范化后的 URL；解析失败时原样返回
 */
export function normalizeUrlTrailingSlash(url: string): string {
  try {
    const u = new URL(url);
    if (u.pathname === '/' || u.pathname.endsWith('/') || /\.[a-z0-9]+$/i.test(u.pathname)) {
      return url;
    }
    return u.origin + u.pathname + '/' + u.search + u.hash;
  } catch {
    // 非标准 URL（如相对路径）保持原样
    return url;
  }
}

