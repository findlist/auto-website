import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * MIME 类型查询工具
 * 全部在浏览器本地处理，内置常见 MIME 类型对照表，支持双向查询。
 *
 * 功能：
 *  - 搜索框：按扩展名、MIME 类型、描述模糊匹配
 *  - 类别筛选：文档/图片/音频/视频/压缩/代码/字体/应用/其他
 *  - 双向复制：点击扩展名或 MIME 类型即可复制
 *  - 类别颜色区分，便于快速识别
 */

// ============================================================
// MIME 类型数据表（按类别分组，含常见 100+ 项）
// ============================================================

type MimeCategory = '文档' | '图片' | '音频' | '视频' | '压缩' | '代码' | '字体' | '应用' | '其他';

interface MimeEntry {
  ext: string;        // 扩展名（不含点，如 "jpg"）
  mime: string;       // MIME 类型（如 "image/jpeg"）
  category: MimeCategory;
  desc: string;       // 中文描述
}

// 常见 MIME 类型对照表（按类别排序，同类别按扩展名字母序）
const MIME_ENTRIES: MimeEntry[] = [
  // 文档
  { ext: 'txt', mime: 'text/plain', category: '文档', desc: '纯文本' },
  { ext: 'html', mime: 'text/html', category: '文档', desc: 'HTML 网页' },
  { ext: 'htm', mime: 'text/html', category: '文档', desc: 'HTML 网页（旧扩展名）' },
  { ext: 'css', mime: 'text/css', category: '文档', desc: 'CSS 层叠样式表' },
  { ext: 'csv', mime: 'text/csv', category: '文档', desc: 'CSV 逗号分隔值' },
  { ext: 'md', mime: 'text/markdown', category: '文档', desc: 'Markdown 文档' },
  { ext: 'rtf', mime: 'application/rtf', category: '文档', desc: '富文本格式' },
  { ext: 'pdf', mime: 'application/pdf', category: '文档', desc: 'PDF 便携式文档' },
  { ext: 'doc', mime: 'application/msword', category: '文档', desc: 'Word 97-2003 文档' },
  { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', category: '文档', desc: 'Word 文档（OOXML）' },
  { ext: 'xls', mime: 'application/vnd.ms-excel', category: '文档', desc: 'Excel 97-2003 表格' },
  { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', category: '文档', desc: 'Excel 表格（OOXML）' },
  { ext: 'ppt', mime: 'application/vnd.ms-powerpoint', category: '文档', desc: 'PowerPoint 97-2003 演示' },
  { ext: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', category: '文档', desc: 'PowerPoint 演示（OOXML）' },
  { ext: 'odt', mime: 'application/vnd.oasis.opendocument.text', category: '文档', desc: 'OpenDocument 文本' },
  { ext: 'ods', mime: 'application/vnd.oasis.opendocument.spreadsheet', category: '文档', desc: 'OpenDocument 表格' },
  { ext: 'odp', mime: 'application/vnd.oasis.opendocument.presentation', category: '文档', desc: 'OpenDocument 演示' },

  // 图片
  { ext: 'jpg', mime: 'image/jpeg', category: '图片', desc: 'JPEG 图像（有损压缩）' },
  { ext: 'jpeg', mime: 'image/jpeg', category: '图片', desc: 'JPEG 图像' },
  { ext: 'png', mime: 'image/png', category: '图片', desc: 'PNG 图像（无损压缩，支持透明）' },
  { ext: 'gif', mime: 'image/gif', category: '图片', desc: 'GIF 图像（支持动画）' },
  { ext: 'webp', mime: 'image/webp', category: '图片', desc: 'WebP 图像（Google 主导）' },
  { ext: 'svg', mime: 'image/svg+xml', category: '图片', desc: 'SVG 矢量图' },
  { ext: 'bmp', mime: 'image/bmp', category: '图片', desc: 'BMP 位图' },
  { ext: 'ico', mime: 'image/x-icon', category: '图片', desc: 'Windows 图标' },
  { ext: 'tiff', mime: 'image/tiff', category: '图片', desc: 'TIFF 图像' },
  { ext: 'tif', mime: 'image/tiff', category: '图片', desc: 'TIFF 图像（短扩展名）' },
  { ext: 'heic', mime: 'image/heic', category: '图片', desc: 'HEIC 图像（iOS 默认格式）' },
  { ext: 'avif', mime: 'image/avif', category: '图片', desc: 'AVIF 图像（新一代压缩）' },
  { ext: 'psd', mime: 'image/vnd.adobe.photoshop', category: '图片', desc: 'Photoshop 文档' },

  // 音频
  { ext: 'mp3', mime: 'audio/mpeg', category: '音频', desc: 'MP3 音频（有损压缩）' },
  { ext: 'wav', mime: 'audio/wav', category: '音频', desc: 'WAV 音频（无损未压缩）' },
  { ext: 'ogg', mime: 'audio/ogg', category: '音频', desc: 'Ogg Vorbis 音频' },
  { ext: 'flac', mime: 'audio/flac', category: '音频', desc: 'FLAC 无损音频' },
  { ext: 'aac', mime: 'audio/aac', category: '音频', desc: 'AAC 音频（Apple 常用）' },
  { ext: 'm4a', mime: 'audio/mp4', category: '音频', desc: 'M4A 音频（iTunes）' },
  { ext: 'wma', mime: 'audio/x-ms-wma', category: '音频', desc: 'Windows Media 音频' },
  { ext: 'aiff', mime: 'audio/aiff', category: '音频', desc: 'AIFF 音频（macOS）' },
  { ext: 'opus', mime: 'audio/opus', category: '音频', desc: 'Opus 音频（低延迟）' },
  { ext: 'mid', mime: 'audio/midi', category: '音频', desc: 'MIDI 音乐' },
  { ext: 'midi', mime: 'audio/midi', category: '音频', desc: 'MIDI 音乐（长扩展名）' },

  // 视频
  { ext: 'mp4', mime: 'video/mp4', category: '视频', desc: 'MP4 视频（最通用）' },
  { ext: 'webm', mime: 'video/webm', category: '视频', desc: 'WebM 视频（Google 主导）' },
  { ext: 'avi', mime: 'video/x-msvideo', category: '视频', desc: 'AVI 视频（旧格式）' },
  { ext: 'mov', mime: 'video/quicktime', category: '视频', desc: 'QuickTime 视频（Apple）' },
  { ext: 'wmv', mime: 'video/x-ms-wmv', category: '视频', desc: 'Windows Media 视频' },
  { ext: 'flv', mime: 'video/x-flv', category: '视频', desc: 'Flash 视频（已淘汰）' },
  { ext: 'mkv', mime: 'video/x-matroska', category: '视频', desc: 'Matroska 视频（开源）' },
  { ext: 'mpeg', mime: 'video/mpeg', category: '视频', desc: 'MPEG 视频' },
  { ext: 'mpg', mime: 'video/mpeg', category: '视频', desc: 'MPEG 视频（短扩展名）' },
  { ext: 'm4v', mime: 'video/x-m4v', category: '视频', desc: 'M4V 视频（iTunes）' },
  { ext: '3gp', mime: 'video/3gpp', category: '视频', desc: '3GP 视频（手机）' },
  { ext: 'ts', mime: 'video/mp2t', category: '视频', desc: 'MPEG-TS 流媒体' },

  // 压缩
  { ext: 'zip', mime: 'application/zip', category: '压缩', desc: 'ZIP 压缩包（最通用）' },
  { ext: 'rar', mime: 'application/vnd.rar', category: '压缩', desc: 'RAR 压缩包' },
  { ext: '7z', mime: 'application/x-7z-compressed', category: '压缩', desc: '7-Zip 压缩包（高压缩比）' },
  { ext: 'tar', mime: 'application/x-tar', category: '压缩', desc: 'TAR 归档（未压缩）' },
  { ext: 'gz', mime: 'application/gzip', category: '压缩', desc: 'Gzip 压缩' },
  { ext: 'bz2', mime: 'application/x-bzip2', category: '压缩', desc: 'Bzip2 压缩' },
  { ext: 'xz', mime: 'application/x-xz', category: '压缩', desc: 'XZ 压缩（高压缩比）' },
  { ext: 'tgz', mime: 'application/gzip', category: '压缩', desc: 'TAR.GZ 压缩包' },
  { ext: 'zst', mime: 'application/zstd', category: '压缩', desc: 'Zstandard 压缩（Facebook 主导）' },

  // 代码
  { ext: 'js', mime: 'text/javascript', category: '代码', desc: 'JavaScript 脚本' },
  { ext: 'mjs', mime: 'text/javascript', category: '代码', desc: 'ES 模块脚本' },
  { ext: 'ts', mime: 'text/typescript', category: '代码', desc: 'TypeScript 脚本' },
  { ext: 'jsx', mime: 'text/jsx', category: '代码', desc: 'JSX 文件（React）' },
  { ext: 'tsx', mime: 'text/tsx', category: '代码', desc: 'TSX 文件（React + TS）' },
  { ext: 'py', mime: 'text/x-python', category: '代码', desc: 'Python 脚本' },
  { ext: 'java', mime: 'text/x-java-source', category: '代码', desc: 'Java 源码' },
  { ext: 'c', mime: 'text/x-c', category: '代码', desc: 'C 源码' },
  { ext: 'cpp', mime: 'text/x-c++', category: '代码', desc: 'C++ 源码' },
  { ext: 'cs', mime: 'text/x-csharp', category: '代码', desc: 'C# 源码' },
  { ext: 'go', mime: 'text/x-go', category: '代码', desc: 'Go 源码' },
  { ext: 'rs', mime: 'text/rust', category: '代码', desc: 'Rust 源码' },
  { ext: 'rb', mime: 'text/x-ruby', category: '代码', desc: 'Ruby 源码' },
  { ext: 'php', mime: 'application/x-httpd-php', category: '代码', desc: 'PHP 脚本' },
  { ext: 'sh', mime: 'application/x-sh', category: '代码', desc: 'Shell 脚本' },
  { ext: 'bash', mime: 'application/x-sh', category: '代码', desc: 'Bash 脚本' },
  { ext: 'sql', mime: 'application/sql', category: '代码', desc: 'SQL 脚本' },
  { ext: 'yaml', mime: 'application/x-yaml', category: '代码', desc: 'YAML 配置' },
  { ext: 'yml', mime: 'application/x-yaml', category: '代码', desc: 'YAML 配置（短扩展名）' },
  { ext: 'toml', mime: 'application/toml', category: '代码', desc: 'TOML 配置' },
  { ext: 'json', mime: 'application/json', category: '代码', desc: 'JSON 数据' },
  { ext: 'xml', mime: 'application/xml', category: '代码', desc: 'XML 数据' },

  // 字体
  { ext: 'ttf', mime: 'font/ttf', category: '字体', desc: 'TrueType 字体' },
  { ext: 'otf', mime: 'font/otf', category: '字体', desc: 'OpenType 字体' },
  { ext: 'woff', mime: 'font/woff', category: '字体', desc: 'WOFF 字体（Web 优化）' },
  { ext: 'woff2', mime: 'font/woff2', category: '字体', desc: 'WOFF2 字体（更高压缩）' },
  { ext: 'eot', mime: 'application/vnd.ms-fontobject', category: '字体', desc: 'Embedded OpenType（IE 专用）' },

  // 应用
  { ext: 'exe', mime: 'application/x-msdownload', category: '应用', desc: 'Windows 可执行文件' },
  { ext: 'dll', mime: 'application/x-msdownload', category: '应用', desc: 'Windows 动态链接库' },
  { ext: 'so', mime: 'application/octet-stream', category: '应用', desc: 'Linux 共享库' },
  { ext: 'dylib', mime: 'application/octet-stream', category: '应用', desc: 'macOS 动态库' },
  { ext: 'bin', mime: 'application/octet-stream', category: '应用', desc: '通用二进制文件' },
  { ext: 'apk', mime: 'application/vnd.android.package-archive', category: '应用', desc: 'Android 安装包' },
  { ext: 'ipa', mime: 'application/octet-stream', category: '应用', desc: 'iOS 安装包' },
  { ext: 'dmg', mime: 'application/x-apple-diskimage', category: '应用', desc: 'macOS 磁盘镜像' },
  { ext: 'deb', mime: 'application/vnd.debian.binary-package', category: '应用', desc: 'Debian 安装包' },
  { ext: 'rpm', mime: 'application/x-rpm', category: '应用', desc: 'RPM 安装包' },
  { ext: 'msi', mime: 'application/x-msi', category: '应用', desc: 'Windows 安装包' },
  { ext: 'jar', mime: 'application/java-archive', category: '应用', desc: 'Java 归档' },
  { ext: 'war', mime: 'application/java-archive', category: '应用', desc: 'Web 应用归档' },
];

// 类别配置：标签 + 颜色（用于卡片左边框与标签背景）
const CATEGORIES: { value: MimeCategory | '全部'; label: string; color: string }[] = [
  { value: '全部', label: '全部', color: '#6b7280' },
  { value: '文档', label: '文档', color: '#3b82f6' },
  { value: '图片', label: '图片', color: '#10b981' },
  { value: '音频', label: '音频', color: '#f59e0b' },
  { value: '视频', label: '视频', color: '#ef4444' },
  { value: '压缩', label: '压缩', color: '#8b5cf6' },
  { value: '代码', label: '代码', color: '#06b6d4' },
  { value: '字体', label: '字体', color: '#ec4899' },
  { value: '应用', label: '应用', color: '#6366f1' },
  { value: '其他', label: '其他', color: '#6b7280' },
];

// 类别 → 颜色映射（用于卡片渲染）
const CATEGORY_COLOR: Record<MimeCategory, string> = {
  文档: '#3b82f6',
  图片: '#10b981',
  音频: '#f59e0b',
  视频: '#ef4444',
  压缩: '#8b5cf6',
  代码: '#06b6d4',
  字体: '#ec4899',
  应用: '#6366f1',
  其他: '#6b7280',
};

export default function MimeTool() {
  const [query, setQuery] = useState<string>('');
  const [activeCategory, setActiveCategory] = useState<MimeCategory | '全部'>('全部');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  /** 过滤逻辑：搜索框 + 类别双重过滤 */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return MIME_ENTRIES.filter((entry) => {
      // 类别筛选
      if (activeCategory !== '全部' && entry.category !== activeCategory) return false;
      // 搜索筛选：扩展名、MIME 类型、描述模糊匹配
      if (!q) return true;
      return (
        entry.ext.toLowerCase().includes(q) ||
        entry.mime.toLowerCase().includes(q) ||
        entry.desc.toLowerCase().includes(q)
      );
    });
  }, [query, activeCategory]);

  /** 复制扩展名或 MIME 类型 */
  const handleCopy = useCallback(async (value: string, field: string) => {
    const ok = await copyText(value);
    if (ok) {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    }
  }, []);

  /** 清空搜索 */
  const handleClear = useCallback(() => {
    setQuery('');
    setActiveCategory('全部');
  }, []);

  return (
    <div className="mimetool">
      {/* 搜索栏 */}
      <div className="mimetool__search-bar">
        <input
          type="search"
          className="mimetool__search"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="搜索扩展名、MIME 类型或描述，如 png、image/jpeg、PDF"
          aria-label="搜索 MIME 类型"
          spellCheck={false}
        />
        {(query || activeCategory !== '全部') && (
          <button
            type="button"
            className="mimetool__clear-btn"
            onClick={handleClear}
            aria-label="清空筛选"
          >
            清空
          </button>
        )}
      </div>

      {/* 类别筛选 */}
      <div className="mimetool__categories" role="tablist" aria-label="按类别筛选">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            type="button"
            role="tab"
            aria-selected={activeCategory === cat.value}
            className={`mimetool__category-btn${activeCategory === cat.value ? ' is-active' : ''}`}
            style={activeCategory === cat.value ? { borderColor: cat.color, color: cat.color } : {}}
            onClick={() => setActiveCategory(cat.value)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* 结果统计 */}
      <div className="mimetool__stats" aria-live="polite">
        共 <strong>{filtered.length}</strong> 项
        {activeCategory !== '全部' && <> · 类别：<strong>{activeCategory}</strong></>}
        {query.trim() && <> · 搜索："<strong>{query.trim()}</strong>"</>}
      </div>

      {/* 结果列表 */}
      {filtered.length === 0 ? (
        <div className="mimetool__empty" role="status">
          <p>未找到匹配的 MIME 类型。</p>
          <p className="mimetool__empty-hint">尝试更换关键词或切换类别筛选。</p>
        </div>
      ) : (
        <ul className="mimetool__list" role="list">
          {filtered.map((entry) => {
            const color = CATEGORY_COLOR[entry.category];
            const extField = `ext-${entry.ext}-${entry.mime}`;
            const mimeField = `mime-${entry.ext}-${entry.mime}`;
            return (
              <li
                key={`${entry.ext}-${entry.mime}`}
                className="mimetool__item"
                style={{ borderLeftColor: color }}
              >
                <div className="mimetool__item-main">
                  <button
                    type="button"
                    className="mimetool__ext-btn"
                    onClick={() => handleCopy(`.${entry.ext}`, extField)}
                    title={`复制扩展名 .${entry.ext}`}
                    aria-label={`复制扩展名 .${entry.ext}`}
                  >
                    <span className="mimetool__ext">.{entry.ext}</span>
                    {copiedField === extField && <span className="mimetool__copied">✓</span>}
                  </button>
                  <button
                    type="button"
                    className="mimetool__mime-btn"
                    onClick={() => handleCopy(entry.mime, mimeField)}
                    title={`复制 MIME 类型 ${entry.mime}`}
                    aria-label={`复制 MIME 类型 ${entry.mime}`}
                  >
                    <code className="mimetool__mime">{entry.mime}</code>
                    {copiedField === mimeField && <span className="mimetool__copied">✓</span>}
                  </button>
                </div>
                <div className="mimetool__item-meta">
                  <span
                    className="mimetool__badge"
                    style={{ backgroundColor: `${color}1a`, color: color }}
                  >
                    {entry.category}
                  </span>
                  <span className="mimetool__desc">{entry.desc}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
