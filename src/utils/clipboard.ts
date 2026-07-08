/**
 * 通用剪贴板复制工具函数
 *
 * 设计目标：
 *  - 统一 13 个工具组件的复制逻辑，消除约 150+ 行重复代码
 *  - 优先使用现代 Clipboard API，降级到 execCommand 兼容旧环境与非安全上下文
 *  - 全程零依赖，纯浏览器 API
 *
 * 使用方式：
 *   import { copyText } from '../utils/clipboard';
 *   const ok = await copyText('待复制文本');
 *   if (ok) { 复制成功 } else { 复制失败 }
 */

/**
 * 复制文本到剪贴板，带降级方案
 * @param text 待复制文本
 * @returns 是否复制成功
 */
export async function copyText(text: string): Promise<boolean> {
  // 优先使用现代 Clipboard API（需安全上下文：HTTPS 或 localhost）
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 降级到 execCommand 方案
  }
  // 降级方案：临时 textarea + execCommand('copy')，兼容非安全上下文与旧浏览器
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    // 固定定位 + 透明，避免视觉跳动与滚动副作用
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
