/**
 * 图像元数据打包工具核心模块
 *
 * 全部在浏览器本地用 exifr 解析多格式 metadata，零上传零追踪。
 *
 * 核心能力：
 *  - 批量解析 JPEG / PNG / WebP / TIFF / HEIC / GIF 等格式的 EXIF / IPTC / XMP / ICC 元数据
 *  - 隐私敏感字段检测：GPS 定位、相机序列号、个人信息、软件签名、缩略图
 *  - 多格式报告导出：JSON（结构化）/ Markdown（人类可读）/ CSV（表格分析）/ ZIP（打包归档）
 *  - ZIP 内含每图独立 JSON + manifest.json + README.txt（纯浏览器原生 API 打包零依赖）
 *
 * 与 exif 工具的差异：
 *  - exif 工具：单图只读查看详细 EXIF，分类展示
 *  - 本工具：批量处理 + 隐私分析 + 报告导出，聚焦"打包归档"与"隐私风险评估"
 *
 * 设计原则：
 *  - 不引入第三方 ZIP 库，自行实现 ZIP STORE 模式（CRC32 + 局部头 + 中央目录 + EOCD）
 *  - 复用 exifr 库（已在依赖中）解析多格式 metadata
 *  - 文件名安全：替换不安全字符 + 长度限制，跨平台兼容
 */

// ============================================================
// 类型定义
// ============================================================

/** 隐私风险等级 */
export type RiskLevel = 'low' | 'medium' | 'high';

/** 隐私问题严重程度 */
export type Severity = 'low' | 'medium' | 'high';

/** 隐私问题类别 */
export type PrivacyCategory =
  | 'gps' // GPS 定位信息
  | 'personal' // 个人信息（姓名、版权、联系方式）
  | 'device' // 设备序列号、机身标识
  | 'software' // 软件签名、编辑历史
  | 'thumbnail'; // 内嵌缩略图（可能含原图信息）

/** 隐私分析单条发现 */
export interface PrivacyFinding {
  /** 严重程度 */
  severity: Severity;
  /** 类别 */
  category: PrivacyCategory;
  /** 涉及字段名 */
  field: string;
  /** 问题描述 */
  description: string;
  /** 清理建议 */
  recommendation: string;
}

/** 隐私分析结果 */
export interface PrivacyAnalysis {
  /** 综合风险等级（取最高严重程度） */
  riskLevel: RiskLevel;
  /** 发现的隐私问题列表 */
  findings: PrivacyFinding[];
}

/** 图像基础信息 */
export interface ImageBasicInfo {
  width?: number;
  height?: number;
  format?: string;
  colorSpace?: string;
  orientation?: number;
}

/** 单图元数据报告 */
export interface ImageMetadataReport {
  /** 文件名 */
  fileName: string;
  /** 文件大小（字节） */
  fileSize: number;
  /** MIME 类型 */
  mimeType: string;
  /** 最后修改时间（时间戳） */
  lastModified: number;
  /** 基础图片信息 */
  imageInfo: ImageBasicInfo;
  /** EXIF 原始数据（可能为空） */
  exif?: Record<string, unknown>;
  /** IPTC 原始数据（可能为空） */
  iptc?: Record<string, unknown>;
  /** XMP 原始数据（可能为空） */
  xmp?: Record<string, unknown>;
  /** ICC Profile 信息（可能为空） */
  icc?: { name?: string; size?: number };
  /** 隐私分析结果 */
  privacy: PrivacyAnalysis;
  /** 解析错误（如有） */
  parseError?: string;
  /** 解析耗时（毫秒） */
  parseDuration?: number;
}

/** 批量处理汇总 */
export interface BundleSummary {
  /** 处理总数 */
  total: number;
  /** 成功数 */
  success: number;
  /** 失败数 */
  failed: number;
  /** 各风险等级数量 */
  riskStats: { high: number; medium: number; low: number };
  /** 各隐私类别命中数 */
  categoryStats: Record<PrivacyCategory, number>;
  /** 格式分布 */
  formatStats: Record<string, number>;
  /** 处理耗时（毫秒） */
  duration: number;
  /** 详细报告列表 */
  reports: ImageMetadataReport[];
}

// ============================================================
// 常量
// ============================================================

/** 文件大小上限：100MB（避免大文件卡死浏览器） */
export const MAX_FILE_SIZE = 100 * 1024 * 1024;

/** 支持的图片 MIME 类型 */
export const SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'image/heic',
  'image/heif',
  'image/gif',
  'image/avif',
  'image/bmp',
];

/** 支持的文件扩展名（MIME 检测失败时回退判断） */
export const SUPPORTED_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.tif',
  '.tiff',
  '.heic',
  '.heif',
  '.gif',
  '.avif',
  '.bmp',
];

/** 隐私敏感字段配置：字段名 / 类别 / 严重程度 / 描述 / 建议 */
interface SensitiveFieldConfig {
  /** 匹配 exifr 输出的字段名（小写包含匹配） */
  patterns: string[];
  category: PrivacyCategory;
  severity: Severity;
  description: string;
  recommendation: string;
}

/** 敏感字段配置表（覆盖常见隐私字段） */
const SENSITIVE_FIELDS: SensitiveFieldConfig[] = [
  // GPS 相关
  {
    patterns: ['gpslatitude', 'gpslongitude', 'gpsaltitude', 'gpslatituderef', 'gpslongituderef', 'gpsaltituderef', 'gpsimgdirection', 'gpstimestamp', 'gpsdatestamp', 'gpsareainformation', 'gpsdop', 'gpsmeasuremode', 'gpssatellites', 'gpsstatus', 'gpstrack', 'gpstrackref', 'gpsmapdatum', 'gpsprocessingmethod', 'gpsversionid'],
    category: 'gps',
    severity: 'high',
    description: '包含 GPS 定位信息，可精确定位拍摄位置',
    recommendation: '使用 EXIF 编辑器删除 GPS 相关字段，或分享前导出无元数据副本',
  },
  // 设备序列号
  {
    patterns: ['bodyserialnumber', 'lensserialnumber', 'cameraserialnumber', 'internalserialnumber'],
    category: 'device',
    severity: 'medium',
    description: '包含相机/镜头序列号，可用于设备溯源',
    recommendation: '使用 EXIF 编辑器删除 BodySerialNumber / LensSerialNumber 字段',
  },
  // 个人信息
  {
    patterns: ['artist', 'copyright', 'author', 'ownername', 'credit', 'contact', 'by-line', 'byline', 'captionwriter', 'writereditor'],
    category: 'personal',
    severity: 'medium',
    description: '包含作者/版权/联系方式等个人信息',
    recommendation: '如非必要建议删除 Artist / Copyright / Contact 等字段',
  },
  // 软件签名
  {
    patterns: ['software', 'makernote', 'processingsoftware', 'hostcomputer', 'imagewriter', 'publisher'],
    category: 'software',
    severity: 'low',
    description: '包含编辑软件信息或 MakerNote（可能含相机内部数据）',
    recommendation: '可选删除 Software / MakerNote 字段以减少指纹特征',
  },
  // 缩略图
  {
    patterns: ['thumbnail', 'thumbnailimage', 'ifd1', 'previewimage'],
    category: 'thumbnail',
    severity: 'low',
    description: 'JPEG 内嵌缩略图，可能含原图压缩版',
    recommendation: '使用 EXIF 编辑器删除缩略图（IFD1）以减小体积并避免泄露原图',
  },
];

// ============================================================
// 隐私分析
// ============================================================

/**
 * 从解析结果中递归提取所有键名（小写）用于匹配
 * 仅提取一级键，避免深度递归带来性能开销
 */
function collectKeys(data: Record<string, unknown> | undefined): string[] {
  if (!data) return [];
  return Object.keys(data).map((k) => k.toLowerCase());
}

/** 严重程度到数值便于比较 */
const SEVERITY_WEIGHT: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

/** 数值到风险等级 */
function weightToRisk(maxWeight: number): RiskLevel {
  if (maxWeight >= 3) return 'high';
  if (maxWeight >= 2) return 'medium';
  return 'low';
}

/**
 * 执行隐私分析：扫描 EXIF / IPTC / XMP 中的敏感字段
 */
function analyzePrivacy(report: Pick<ImageMetadataReport, 'exif' | 'iptc' | 'xmp'>): PrivacyAnalysis {
  const findings: PrivacyFinding[] = [];
  const seenFields = new Set<string>(); // 去重（同字段在不同段中可能出现）

  const allData: Array<{ source: string; data: Record<string, unknown> | undefined }> = [
    { source: 'EXIF', data: report.exif },
    { source: 'IPTC', data: report.iptc },
    { source: 'XMP', data: report.xmp },
  ];

  for (const { source, data } of allData) {
    if (!data) continue;
    const keys = collectKeys(data);

    for (const config of SENSITIVE_FIELDS) {
      for (const pattern of config.patterns) {
        const matchedKey = keys.find((k) => k === pattern || k.includes(pattern));
        if (!matchedKey) continue;

        const dedupKey = `${config.category}:${matchedKey}`;
        if (seenFields.has(dedupKey)) continue;
        seenFields.add(dedupKey);

        // 检查值是否为空（部分字段存在但值为 null/undefined/空字符串）
        const originalKey = Object.keys(data).find((k) => k.toLowerCase() === matchedKey);
        const value = originalKey ? data[originalKey] : undefined;
        if (value === null || value === undefined || value === '') continue;

        findings.push({
          severity: config.severity,
          category: config.category,
          field: `${source}.${originalKey || matchedKey}`,
          description: config.description,
          recommendation: config.recommendation,
        });
      }
    }
  }

  // 按严重程度降序排序
  findings.sort((a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity]);

  const maxWeight = findings.length > 0
    ? Math.max(...findings.map((f) => SEVERITY_WEIGHT[f.severity]))
    : 0;

  return {
    riskLevel: weightToRisk(maxWeight),
    findings,
  };
}

// ============================================================
// 解析核心
// ============================================================

/**
 * 解析单个图片文件的元数据
 *
 * 使用 exifr 库同时解析 EXIF / IPTC / XMP / ICC，
 * 失败时记录 parseError 但不抛出（保证批量处理不中断）
 */
export async function parseImageMetadata(file: File): Promise<ImageMetadataReport> {
  const startTime = performance.now();
  const basicReport: ImageMetadataReport = {
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || 'unknown',
    lastModified: file.lastModified,
    imageInfo: {},
    privacy: { riskLevel: 'low', findings: [] },
  };

  // 动态导入 exifr 避免在 SSR 阶段加载到无意义的依赖
  let exifr: typeof import('exifr')['default'] | null = null;
  try {
    const mod = await import('exifr');
    exifr = mod.default;
  } catch (err) {
    basicReport.parseError = `exifr 加载失败：${(err as Error).message}`;
    basicReport.parseDuration = performance.now() - startTime;
    return basicReport;
  }

  try {
    // 一次性解析所有段（EXIF / IPTC / XMP / ICC / 图像基础信息）
    // exifr 7.x：ifd1 设为 false 跳过缩略图 IFD 节省内存；
    // ifd0 默认启用且不可禁用；jfif 设为 false 跳过非核心段
    const parsed = await exifr.parse(file, {
      tiff: true,
      ifd1: false, // 跳过缩略图 IFD，避免内存浪费
      exif: true,
      gps: true,
      iptc: true,
      xmp: true,
      icc: true,
      jfif: false,
    });

    // exifr 返回 null/undefined 表示无元数据
    if (parsed && typeof parsed === 'object') {
      // 拆分各段数据
      const exif: Record<string, unknown> = {};
      const iptc: Record<string, unknown> = {};
      const xmp: Record<string, unknown> = {};
      const imageInfo: ImageBasicInfo = {};

      // exifr 7.x 顶层是合并后的所有字段，需要按段重新分组
      // 通过 segment() API 获取各段原始数据更准确，但性能开销大
      // 这里采用启发式：根据字段名前缀归类
      for (const [key, value] of Object.entries(parsed)) {
        if (value === null || value === undefined) continue;
        const lowerKey = key.toLowerCase();

        // 基础图片信息
        if (lowerKey === 'imagewidth' || lowerKey === 'width') {
          imageInfo.width = Number(value);
        } else if (lowerKey === 'imageheight' || lowerKey === 'height') {
          imageInfo.height = Number(value);
        } else if (lowerKey === 'format') {
          imageInfo.format = String(value);
        } else if (lowerKey === 'colorspace') {
          imageInfo.colorSpace = String(value);
        } else if (lowerKey === 'orientation') {
          imageInfo.orientation = Number(value);
        }

        // 归类到 EXIF / IPTC / XMP
        // exifr 输出字段名约定：IPTC 字段通常以 PascalCase 形式出现，与 EXIF 重名时通过段标记区分
        // 这里简化处理：GPS / Make / Model / 拍摄参数归 EXIF；Copyright / Author / Caption 归 IPTC 或 XMP
        if (lowerKey.startsWith('gps') || lowerKey.startsWith('exif') || isExifField(lowerKey)) {
          exif[key] = value;
        } else if (isIptcField(lowerKey)) {
          iptc[key] = value;
        } else if (isXmpField(lowerKey)) {
          xmp[key] = value;
        } else {
          // 默认归 EXIF（exifr 顶层字段多数来自 TIFF/EXIF）
          exif[key] = value;
        }
      }

      basicReport.imageInfo = imageInfo;
      if (Object.keys(exif).length > 0) basicReport.exif = exif;
      if (Object.keys(iptc).length > 0) basicReport.iptc = iptc;
      if (Object.keys(xmp).length > 0) basicReport.xmp = xmp;

      // ICC Profile 信息
      const iccProfile = (parsed as { icc?: { name?: string; size?: number } }).icc;
      if (iccProfile && typeof iccProfile === 'object') {
        basicReport.icc = { name: iccProfile.name, size: iccProfile.size };
      }

      // 隐私分析
      basicReport.privacy = analyzePrivacy(basicReport);
    }
  } catch (err) {
    basicReport.parseError = `解析失败：${(err as Error).message}`;
  }

  basicReport.parseDuration = performance.now() - startTime;
  return basicReport;
}

/** EXIF 字段名判断（基于常见 EXIF 标签） */
function isExifField(lowerKey: string): boolean {
  const exifPrefixes = [
    'make', 'model', 'lens', 'iso', 'fnumber', 'exposure', 'shutter', 'focal',
    'flash', 'whitebalance', 'metering', 'scene', 'orientation', 'datetime',
    'software', 'artist', 'copyright', 'body', 'serial', 'makernote',
    'colorspace', 'resolution', 'compression', 'samplesperpixel', 'bitspersample',
    'photometricinterpretation', 'xp', 'printimage', ' Canon', 'nikon',
  ];
  return exifPrefixes.some((p) => lowerKey.startsWith(p) || lowerKey.includes(p));
}

/** IPTC 字段名判断（基于 IPTC IIM 规范常见字段） */
function isIptcField(lowerKey: string): boolean {
  const iptcFields = [
    'caption', 'captionwriter', 'headline', 'specialinstructions', 'by-line',
    'byline', 'credit', 'source', 'objectname', 'city', 'province', 'country',
    'originaltransmission', 'urgency', 'keywords', 'category', 'subcategories',
    'copyrightnotice', 'contact', 'editstatus', 'photographer',
  ];
  return iptcFields.some((f) => lowerKey === f || lowerKey.includes(f));
}

/** XMP 字段名判断（基于 XMP 命名空间常见字段） */
function isXmpField(lowerKey: string): boolean {
  const xmpPrefixes = ['xmp', 'dc.', 'xmpmm', 'xmprights', 'crs', 'aux', 'photoshop'];
  return xmpPrefixes.some((p) => lowerKey.startsWith(p));
}

// ============================================================
// 批量处理
// ============================================================

/**
 * 批量解析图片元数据
 *
 * 顺序处理而非并行，原因：
 * 1. exifr 解析大图较占内存，并行可能触发浏览器内存限制
 * 2. 顺序处理便于进度回调
 * 3. 单图解析通常 < 200ms，批量 50 张约 10s 可接受
 */
export async function bundleParse(
  files: File[],
  onProgress?: (current: number, total: number, fileName: string) => void
): Promise<BundleSummary> {
  const startTime = performance.now();
  const reports: ImageMetadataReport[] = [];
  let success = 0;
  let failed = 0;
  const riskStats = { high: 0, medium: 0, low: 0 };
  const categoryStats: Record<PrivacyCategory, number> = {
    gps: 0,
    personal: 0,
    device: 0,
    software: 0,
    thumbnail: 0,
  };
  const formatStats: Record<string, number> = {};

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(i + 1, files.length, file.name);

    const report = await parseImageMetadata(file);
    reports.push(report);

    if (report.parseError) {
      failed++;
    } else {
      success++;
    }

    // 风险等级统计
    riskStats[report.privacy.riskLevel]++;

    // 隐私类别命中统计（同一类别多次出现只计一次）
    const hitCategories = new Set<PrivacyCategory>();
    for (const finding of report.privacy.findings) {
      hitCategories.add(finding.category);
    }
    for (const cat of hitCategories) {
      categoryStats[cat]++;
    }

    // 格式统计（基于 MIME 或扩展名）
    const format = detectFormat(file);
    formatStats[format] = (formatStats[format] || 0) + 1;
  }

  return {
    total: files.length,
    success,
    failed,
    riskStats,
    categoryStats,
    formatStats,
    duration: performance.now() - startTime,
    reports,
  };
}

/** 检测图片格式（基于 MIME 或扩展名） */
function detectFormat(file: File): string {
  if (file.type) {
    const mimeMap: Record<string, string> = {
      'image/jpeg': 'JPEG',
      'image/png': 'PNG',
      'image/webp': 'WebP',
      'image/tiff': 'TIFF',
      'image/heic': 'HEIC',
      'image/heif': 'HEIF',
      'image/gif': 'GIF',
      'image/avif': 'AVIF',
      'image/bmp': 'BMP',
    };
    if (mimeMap[file.type]) return mimeMap[file.type];
  }
  // 扩展名回退
  const ext = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext) {
    const extMap: Record<string, string> = {
      jpg: 'JPEG', jpeg: 'JPEG', png: 'PNG', webp: 'WebP',
      tif: 'TIFF', tiff: 'TIFF', heic: 'HEIC', heif: 'HEIF',
      gif: 'GIF', avif: 'AVIF', bmp: 'BMP',
    };
    if (extMap[ext]) return extMap[ext];
  }
  return '未知';
}

// ============================================================
// 报告生成：JSON / Markdown / CSV
// ============================================================

/** 格式化字节为可读字符串 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/** 格式化时间戳为本地时间字符串 */
function formatTime(timestamp: number): string {
  if (!timestamp) return '未知';
  return new Date(timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

/** 风险等级中文 */
function riskLevelText(level: RiskLevel): string {
  return level === 'high' ? '高' : level === 'medium' ? '中' : '低';
}

/** 严重程度中文 */
function severityText(s: Severity): string {
  return s === 'high' ? '高' : s === 'medium' ? '中' : '低';
}

/** 隐私类别中文 */
function categoryText(c: PrivacyCategory): string {
  const map: Record<PrivacyCategory, string> = {
    gps: 'GPS 定位',
    personal: '个人信息',
    device: '设备序列号',
    software: '软件签名',
    thumbnail: '内嵌缩略图',
  };
  return map[c];
}

/**
 * 生成 JSON 报告（结构化，便于程序解析）
 */
export function buildJsonReport(summary: BundleSummary): string {
  return JSON.stringify(summary, null, 2);
}

/**
 * 生成 Markdown 报告（人类可读，便于文档归档）
 */
export function buildMarkdownReport(summary: BundleSummary): string {
  const lines: string[] = [];
  lines.push(`# 图片元数据打包报告`);
  lines.push('');
  lines.push(`**生成时间**：${formatTime(Date.now())}`);
  lines.push(`**处理总数**：${summary.total} 张`);
  lines.push(`**成功**：${summary.success} 张 | **失败**：${summary.failed} 张`);
  lines.push(`**耗时**：${(summary.duration / 1000).toFixed(2)} 秒`);
  lines.push('');

  // 风险概览
  lines.push(`## 隐私风险概览`);
  lines.push('');
  lines.push(`| 风险等级 | 数量 |`);
  lines.push(`|---------|------|`);
  lines.push(`| 高风险  | ${summary.riskStats.high} |`);
  lines.push(`| 中风险  | ${summary.riskStats.medium} |`);
  lines.push(`| 低风险  | ${summary.riskStats.low} |`);
  lines.push('');

  // 类别命中
  lines.push(`## 隐私类别命中统计`);
  lines.push('');
  lines.push(`| 类别 | 命中图片数 |`);
  lines.push(`|------|-----------|`);
  for (const cat of Object.keys(summary.categoryStats) as PrivacyCategory[]) {
    lines.push(`| ${categoryText(cat)} | ${summary.categoryStats[cat]} |`);
  }
  lines.push('');

  // 格式分布
  lines.push(`## 格式分布`);
  lines.push('');
  lines.push(`| 格式 | 数量 |`);
  lines.push(`|------|------|`);
  for (const [fmt, count] of Object.entries(summary.formatStats)) {
    lines.push(`| ${fmt} | ${count} |`);
  }
  lines.push('');

  // 各图详情
  lines.push(`## 各图详情`);
  lines.push('');
  for (let i = 0; i < summary.reports.length; i++) {
    const r = summary.reports[i];
    lines.push(`### ${i + 1}. ${r.fileName}`);
    lines.push('');
    lines.push(`- **文件大小**：${formatBytes(r.fileSize)}`);
    lines.push(`- **MIME 类型**：${r.mimeType}`);
    lines.push(`- **修改时间**：${formatTime(r.lastModified)}`);
    if (r.imageInfo.width && r.imageInfo.height) {
      lines.push(`- **图片尺寸**：${r.imageInfo.width} × ${r.imageInfo.height}`);
    }
    if (r.imageInfo.format) lines.push(`- **格式**：${r.imageInfo.format}`);
    if (r.imageInfo.colorSpace) lines.push(`- **色彩空间**：${r.imageInfo.colorSpace}`);
    lines.push(`- **隐私风险**：${riskLevelText(r.privacy.riskLevel)}`);
    if (r.parseError) {
      lines.push(`- **解析错误**：${r.parseError}`);
    }

    if (r.privacy.findings.length > 0) {
      lines.push('');
      lines.push(`#### 隐私发现（${r.privacy.findings.length} 项）`);
      lines.push('');
      for (const f of r.privacy.findings) {
        lines.push(`- **[${severityText(f.severity)}] ${categoryText(f.category)}** ${f.field}`);
        lines.push(`  - ${f.description}`);
        lines.push(`  - 建议：${f.recommendation}`);
      }
    }

    // EXIF 关键字段
    if (r.exif) {
      const exifKeys = Object.keys(r.exif).slice(0, 20);
      if (exifKeys.length > 0) {
        lines.push('');
        lines.push(`#### EXIF 关键字段（前 20 项）`);
        lines.push('');
        for (const k of exifKeys) {
          const v = r.exif[k];
          if (v === null || v === undefined) continue;
          const vStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
          // 截断超长值
          const truncated = vStr.length > 100 ? vStr.slice(0, 100) + '...' : vStr;
          lines.push(`- \`${k}\`：${truncated}`);
        }
      }
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/** CSV 字段转义（含逗号、引号、换行需加双引号包裹） */
function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * 生成 CSV 报告（一行一图，便于表格分析）
 */
export function buildCsvReport(summary: BundleSummary): string {
  const headers = [
    '序号', '文件名', '文件大小', 'MIME类型', '修改时间',
    '宽度', '高度', '格式', '色彩空间',
    '隐私风险', 'GPS', '设备序列号', '个人信息', '软件签名', '缩略图',
    '解析错误',
  ];
  const lines: string[] = [headers.map(csvEscape).join(',')];

  summary.reports.forEach((r, idx) => {
    // 检查各类别命中
    const hasCategory = (cat: PrivacyCategory) => r.privacy.findings.some((f) => f.category === cat);
    const row = [
      String(idx + 1),
      r.fileName,
      formatBytes(r.fileSize),
      r.mimeType,
      formatTime(r.lastModified),
      r.imageInfo.width ? String(r.imageInfo.width) : '',
      r.imageInfo.height ? String(r.imageInfo.height) : '',
      r.imageInfo.format || '',
      r.imageInfo.colorSpace || '',
      riskLevelText(r.privacy.riskLevel),
      hasCategory('gps') ? '是' : '否',
      hasCategory('device') ? '是' : '否',
      hasCategory('personal') ? '是' : '否',
      hasCategory('software') ? '是' : '否',
      hasCategory('thumbnail') ? '是' : '否',
      r.parseError || '',
    ];
    lines.push(row.map(csvEscape).join(','));
  });

  return '\ufeff' + lines.join('\n'); // BOM 头确保 Excel 正确识别 UTF-8
}

// ============================================================
// ZIP 打包（纯浏览器原生 API，零依赖）
// ============================================================

/** CRC32 查找表（IEEE 802.3 多项式 0xedb88320） */
const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

/** 计算 CRC32 校验码 */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Zip 文件条目 */
interface ZipEntry {
  nameBytes: Uint8Array;
  data: Uint8Array;
  crc: number;
  localOffset: number;
}

/** Zip 写入器（STORE 模式，无压缩） */
class ZipWriter {
  private entries: ZipEntry[] = [];
  private chunks: Uint8Array[] = [];
  private offset = 0;

  /** 添加文件到 ZIP */
  addFile(name: string, data: Uint8Array): void {
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(data);

    // 局部文件头（30 字节固定 + 文件名）
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); // 局部文件头签名
    view.setUint16(4, 20, true); // 解压所需版本（2.0）
    view.setUint16(6, 0x0800, true); // 通用标志位 11 置位（UTF-8 文件名）
    view.setUint16(8, 0, true); // 压缩方法 0 = STORE
    view.setUint16(10, 0, true); // 修改时间
    view.setUint16(12, 0, true); // 修改日期
    view.setUint32(14, crc, true); // CRC32
    view.setUint32(18, data.length, true); // 压缩后大小
    view.setUint32(22, data.length, true); // 压缩前大小
    view.setUint16(26, nameBytes.length, true); // 文件名长度
    view.setUint16(28, 0, true); // 额外字段长度
    header.set(nameBytes, 30);

    this.entries.push({ nameBytes, data, crc, localOffset: this.offset });
    this.chunks.push(header, data);
    this.offset += header.length + data.length;
  }

  /** 完成 ZIP 构建，返回 Blob */
  finish(): Blob {
    // 中央目录
    const centralChunks: Uint8Array[] = [];
    let centralSize = 0;
    for (const entry of this.entries) {
      const central = new Uint8Array(46 + entry.nameBytes.length);
      const view = new DataView(central.buffer);
      view.setUint32(0, 0x02014b50, true); // 中央目录头签名
      view.setUint16(4, 20, true); // 版本
      view.setUint16(6, 20, true); // 解压所需版本
      view.setUint16(8, 0x0800, true); // 通用标志位
      view.setUint16(10, 0, true); // 压缩方法
      view.setUint16(12, 0, true); // 修改时间
      view.setUint16(14, 0, true); // 修改日期
      view.setUint32(16, entry.crc, true); // CRC32
      view.setUint32(20, entry.data.length, true); // 压缩后大小
      view.setUint32(24, entry.data.length, true); // 压缩前大小
      view.setUint16(28, entry.nameBytes.length, true); // 文件名长度
      view.setUint16(30, 0, true); // 额外字段长度
      view.setUint16(32, 0, true); // 文件注释长度
      view.setUint16(34, 0, true); // 起始磁盘号
      view.setUint16(36, 0, true); // 内部属性
      view.setUint32(38, 0, true); // 外部属性
      view.setUint32(42, entry.localOffset, true); // 局部头偏移
      central.set(entry.nameBytes, 46);
      centralChunks.push(central);
      centralSize += central.length;
    }

    // EOCD（结束中央目录记录）
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true); // EOCD 签名
    eocdView.setUint16(4, 0, true); // 磁盘号
    eocdView.setUint16(6, 0, true); // 起始磁盘号
    eocdView.setUint16(8, this.entries.length, true); // 中央目录条目数（本磁盘）
    eocdView.setUint16(10, this.entries.length, true); // 中央目录条目数（总）
    eocdView.setUint32(12, centralSize, true); // 中央目录大小
    eocdView.setUint32(16, this.offset, true); // 中央目录起始偏移
    eocdView.setUint16(20, 0, true); // 注释长度

    // 合并所有块
    const allChunks = [...this.chunks, ...centralChunks, eocd];
    const totalLength = allChunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(totalLength);
    let pos = 0;
    for (const chunk of allChunks) {
      result.set(chunk, pos);
      pos += chunk.length;
    }

    // TS 5.7 严格类型：Uint8Array<ArrayBufferLike> 不能直接作为 BlobPart，需显式转换为 ArrayBuffer
    return new Blob([result.buffer as ArrayBuffer], { type: 'application/zip' });
  }
}

/** 替换文件名中的不安全字符 */
function sanitizeFileName(name: string, maxLen = 80): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\x00-\x1f]/g, '_')
    .slice(0, maxLen);
}

/**
 * 构建元数据 ZIP 包
 *
 * 内容：
 *  - 每图独立 JSON（含完整元数据 + 隐私分析）
 *  - manifest.json（汇总报告）
 *  - README.txt（用户友好的说明文档）
 *  - summary.md（人类可读的 Markdown 报告）
 *  - summary.csv（表格分析报告）
 */
export async function buildMetadataZip(summary: BundleSummary): Promise<Blob> {
  const zip = new ZipWriter();
  const encoder = new TextEncoder();

  // 每图独立 JSON
  summary.reports.forEach((report, idx) => {
    const idxStr = String(idx + 1).padStart(3, '0');
    const safeName = sanitizeFileName(report.fileName, 60);
    const jsonStr = JSON.stringify(report, null, 2);
    zip.addFile(`${idxStr}_${safeName}.json`, encoder.encode(jsonStr));
  });

  // manifest.json（与 BundleSummary 一致）
  zip.addFile('manifest.json', encoder.encode(buildJsonReport(summary)));

  // README.txt（用户友好说明）
  const readmeLines = [
    '图片元数据打包报告',
    '====================',
    '',
    `生成时间：${formatTime(Date.now())}`,
    `处理总数：${summary.total} 张`,
    `成功：${summary.success} 张 / 失败：${summary.failed} 张`,
    `耗时：${(summary.duration / 1000).toFixed(2)} 秒`,
    '',
    '文件说明：',
    '  - XXX_文件名.json    每张图片的完整元数据与隐私分析',
    '  - manifest.json      批量处理汇总（结构化）',
    '  - summary.md         人类可读的 Markdown 报告',
    '  - summary.csv        表格分析报告（Excel 可打开）',
    '',
    '隐私风险等级：',
    '  - 高 (high)    包含 GPS 定位信息，分享前务必清理',
    '  - 中 (medium)  包含设备序列号或个人信息，建议清理',
    '  - 低 (low)     仅含软件签名或缩略图，可选清理',
    '',
    '隐私类别说明：',
    '  - GPS 定位     拍摄位置坐标，可精确定位',
    '  - 设备序列号   相机/镜头机身序列号',
    '  - 个人信息     作者/版权/联系方式',
    '  - 软件签名     编辑软件信息或 MakerNote',
    '  - 内嵌缩略图   JPEG 内嵌缩略图（可能含原图压缩版）',
    '',
    '本报告由"工具盒子"的图片元数据打包工具生成',
    '站点：https://website.niuzi.asia',
    '全部处理在浏览器本地完成，零上传零追踪',
  ];
  zip.addFile('README.txt', encoder.encode(readmeLines.join('\n')));

  // summary.md
  zip.addFile('summary.md', encoder.encode(buildMarkdownReport(summary)));

  // summary.csv
  zip.addFile('summary.csv', encoder.encode(buildCsvReport(summary)));

  return zip.finish();
}

// ============================================================
// 下载辅助
// ============================================================

/**
 * 触发浏览器下载
 *
 * 使用 ObjectURL + 隐藏 a 标签触发下载，2 秒后释放 ObjectURL
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 异步释放，避免下载未完成时被回收
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 文本下载（基于 Blob 构造） */
export function downloadText(text: string, filename: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  downloadBlob(blob, filename);
}

/** 生成带时间戳的文件名 */
export function timestampedFilename(prefix: string, ext: string): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${prefix}-${y}${m}${d}.${ext}`;
}
