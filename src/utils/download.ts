/**
 * 文件下载公共工具
 *
 * 背景：原 imageCompare.ts、metadataBundle.ts 中各自重复实现了
 * downloadBlob / downloadText / downloadDataUrl 三个函数，行为基本等价但
 * 实现细节略有差异（如 downloadText 在 imageCompare 中未释放 ObjectURL，
 * 在 metadataBundle 中已释放）。本模块统一收敛到单一实现，消除重复并修掉
 * 旧实现中的内存泄漏隐患。
 *
 * 设计原则：
 * - 函数职责单一，每个函数只做一件事
 * - ObjectURL 异步释放，避免下载未完成时被回收
 * - 默认 MIME 兼容旧 imageCompare 行为（application/json）
 */

/** 触发浏览器下载的核心实现：通过 a 标签 click 完成 */
function triggerDownload(href: string, filename: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  // 隐藏元素，避免影响布局与可访问性树
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * 通过 data:URL 或 blob:URL 触发下载
 *
 * 调用方需自行管理 ObjectURL 生命周期；若直接持有 Blob 对象，
 * 应优先使用 {@link downloadBlob} 以获得自动释放能力。
 *
 * @param url - 已可直接作为 a.href 的字符串（data:URL / blob:URL / 同源 URL）
 * @param filename - 下载文件名
 */
export function downloadDataUrl(url: string, filename: string): void {
  triggerDownload(url, filename);
}

/**
 * 下载 Blob 对象为文件
 *
 * 内部创建 ObjectURL 并在 2 秒后释放，避免下载未完成时被浏览器回收
 * （大文件下载耗时通常远小于 2 秒，且 a.click() 是同步派发下载任务）。
 *
 * @param blob - 待下载的 Blob / File 数据
 * @param filename - 下载文件名
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  // 异步释放，避免下载未完成时被回收
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * 下载文本内容为文件
 *
 * 基于 Blob 构造后委托 {@link downloadBlob} 完成下载，
 * 自动享有 ObjectURL 生命周期管理，无内存泄漏。
 *
 * @param text - 文本内容
 * @param filename - 下载文件名
 * @param mime - MIME 类型，默认 application/json（兼容旧 imageCompare 行为）
 */
export function downloadText(
  text: string,
  filename: string,
  mime = 'application/json',
): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  downloadBlob(blob, filename);
}
