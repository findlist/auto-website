import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  bundleParse,
  buildJsonReport,
  buildJsonLinesReport,
  buildMarkdownReport,
  buildCsvReport,
  buildMetadataZip,
  timestampedFilename,
  MAX_FILE_SIZE,
  SUPPORTED_MIME_TYPES,
  SUPPORTED_EXTENSIONS,
  type BundleSummary,
  type ImageMetadataReport,
  type PrivacyCategory,
  type RiskLevel,
  type Severity,
} from '../utils/metadataBundle';
import { downloadBlob, downloadText } from '../utils/download';

/**
 * 图片元数据打包工具
 *
 * 全部在浏览器本地用 exifr 解析多格式 metadata，零上传零追踪。
 *
 * 功能：
 *  - 批量上传图片（拖拽 + 点击），支持 JPEG / PNG / WebP / TIFF / HEIC / GIF / AVIF / BMP
 *  - 自动解析 EXIF / IPTC / XMP / ICC 元数据
 *  - 隐私敏感字段检测：GPS / 设备序列号 / 个人信息 / 软件签名 / 缩略图
 *  - 批量报告导出：JSON / Markdown / CSV / ZIP（含每图独立 JSON + manifest + README + summary）
 *  - 处理进度实时显示
 *  - 单图折叠查看详情（含隐私发现清单 + EXIF 关键字段）
 */

/** 风险等级徽章颜色 */
const RISK_BADGE_CLASS: Record<RiskLevel, string> = {
  high: 'mdb__badge mdb__badge--high',
  medium: 'mdb__badge mdb__badge--medium',
  low: 'mdb__badge mdb__badge--low',
};

/** 风险等级中文 */
const RISK_TEXT: Record<RiskLevel, string> = {
  high: '高风险',
  medium: '中风险',
  low: '低风险',
};

/** 严重程度中文 */
const SEVERITY_TEXT: Record<Severity, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

/** 隐私类别中文 */
const CATEGORY_TEXT: Record<PrivacyCategory, string> = {
  gps: 'GPS 定位',
  personal: '个人信息',
  device: '设备序列号',
  software: '软件签名',
  thumbnail: '内嵌缩略图',
};

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

/** 文件大小校验：通过 MIME 或扩展名判断是否支持 */
function isSupportedFile(file: File): boolean {
  if (file.type && SUPPORTED_MIME_TYPES.includes(file.type)) return true;
  const lowerName = file.name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
}

/** 文件大小校验：超过上限拒绝 */
function isFileSizeValid(file: File): boolean {
  return file.size <= MAX_FILE_SIZE;
}

/** 截断超长值用于表格展示 */
function truncateValue(value: unknown, maxLen = 100): string {
  if (value === null || value === undefined) return '';
  const vStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return vStr.length > maxLen ? vStr.slice(0, maxLen) + '...' : vStr;
}

export default function MetadataBundleTool() {
  // 文件列表
  const [files, setFiles] = useState<File[]>([]);
  // 处理中
  const [processing, setProcessing] = useState(false);
  // 处理进度
  const [progress, setProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);
  // 处理结果
  const [summary, setSummary] = useState<BundleSummary | null>(null);
  // 错误信息
  const [error, setError] = useState<string | null>(null);
  // 拖拽悬浮态
  const [dragOver, setDragOver] = useState(false);
  // ZIP 打包中
  const [zipping, setZipping] = useState(false);
  // 展开的报告索引
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  // 风险筛选
  const [riskFilter, setRiskFilter] = useState<RiskLevel | 'all'>('all');
  // 文件夹上传跳过的非图片文件数（仅作友好提示，不阻断流程）
  const [folderSkipped, setFolderSkipped] = useState<number | null>(null);

  // 文件输入引用
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 文件夹输入引用（webkitdirectory 为非标准属性，通过 ref + setAttribute 设置以保持 TS 类型干净）
  const folderInputRef = useRef<HTMLInputElement>(null);

  // 设置文件夹 input 的非标准属性（webkitdirectory / directory）
  // 浏览器支持：Chrome / Edge / Firefox / Safari，使用 setAttribute 避免 TS 类型报错
  useEffect(() => {
    const el = folderInputRef.current;
    if (!el) return;
    el.setAttribute('webkitdirectory', '');
    el.setAttribute('directory', '');
  }, []);

  /** 处理新增文件 */
  const handleAddFiles = useCallback((newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles);
    const validFiles: File[] = [];
    const errors: string[] = [];

    for (const file of arr) {
      if (!isSupportedFile(file)) {
        errors.push(`${file.name}：不支持的格式`);
        continue;
      }
      if (!isFileSizeValid(file)) {
        errors.push(`${file.name}：超过 ${formatBytes(MAX_FILE_SIZE)} 上限`);
        continue;
      }
      validFiles.push(file);
    }

    if (errors.length > 0) {
      setError(errors.join('\n'));
    } else {
      setError(null);
    }

    if (validFiles.length > 0) {
      setFiles((prev) => [...prev, ...validFiles]);
      // 重置已有结果，避免新旧数据混淆
      setSummary(null);
      // 文件夹跳过提示仅在文件夹上传当次有效，后续手动添加文件时清除
      setFolderSkipped(null);
    }
  }, []);

  /** 文件输入 change 事件 */
  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleAddFiles(e.target.files);
      // 重置 input value 以便重复选择同一文件
      e.target.value = '';
    }
  }, [handleAddFiles]);

  /**
   * 文件夹选择 change 事件
   *
   * webkitdirectory 模式下浏览器会递归收集文件夹内所有文件（含子目录），
   * 这里先预过滤出支持的图片文件再交给 handleAddFiles，避免大量非图片文件
   * 触发 handleAddFiles 的 errors 累加污染 UI。
   */
  const handleFolderInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const all = Array.from(e.target.files);
    const imageFiles = all.filter((f) => isSupportedFile(f) && isFileSizeValid(f));
    const skipped = all.length - imageFiles.length;
    setFolderSkipped(skipped > 0 ? skipped : null);
    if (imageFiles.length > 0) {
      handleAddFiles(imageFiles);
    } else {
      setError(`所选文件夹未发现支持的图片文件（共扫描 ${all.length} 个文件）`);
    }
    e.target.value = '';
  }, [handleAddFiles]);

  /** 触发文件夹选择对话框 */
  const handlePickFolder = useCallback(() => {
    folderInputRef.current?.click();
  }, []);

  /** 拖拽事件处理 */
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleAddFiles(e.dataTransfer.files);
    }
  }, [handleAddFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  /** 移除文件 */
  const handleRemoveFile = useCallback((idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    setSummary(null);
  }, []);

  /** 清空文件列表 */
  const handleClearAll = useCallback(() => {
    setFiles([]);
    setSummary(null);
    setError(null);
    setExpandedIdx(null);
    setFolderSkipped(null);
  }, []);

  /** 执行批量解析 */
  const handleProcess = useCallback(async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setError(null);
    setSummary(null);
    setExpandedIdx(null);
    setProgress({ current: 0, total: files.length, fileName: '' });

    try {
      const result = await bundleParse(files, (current, total, fileName) => {
        setProgress({ current, total, fileName });
      });
      setSummary(result);
    } catch (err) {
      setError(`批量处理失败：${(err as Error).message}`);
    } finally {
      setProcessing(false);
      setProgress(null);
    }
  }, [files]);

  /** 下载 JSON 报告 */
  const handleDownloadJson = useCallback(() => {
    if (!summary) return;
    const text = buildJsonReport(summary);
    downloadText(text, timestampedFilename('metadata-bundle', 'json'), 'application/json');
  }, [summary]);

  /** 下载 Markdown 报告 */
  const handleDownloadMarkdown = useCallback(() => {
    if (!summary) return;
    const text = buildMarkdownReport(summary);
    downloadText(text, timestampedFilename('metadata-bundle', 'md'), 'text/markdown');
  }, [summary]);

  /** 下载 CSV 报告 */
  const handleDownloadCsv = useCallback(() => {
    if (!summary) return;
    const text = buildCsvReport(summary);
    downloadText(text, timestampedFilename('metadata-bundle', 'csv'), 'text/csv');
  }, [summary]);

  /**
   * 下载 JSON Lines 报告（NDJSON 格式）
   *
   * 每行一个图片报告，便于日志聚合系统（ELK / Loki）与大数据管道
   *（Kafka / Spark Streaming）逐行消费，也可通过 `jq -c` 命令行管道筛选。
   */
  const handleDownloadJsonLines = useCallback(() => {
    if (!summary) return;
    const text = buildJsonLinesReport(summary);
    downloadText(text, timestampedFilename('metadata-bundle', 'jsonl'), 'application/x-ndjson');
  }, [summary]);

  /** 下载 ZIP 包 */
  const handleDownloadZip = useCallback(async () => {
    if (!summary) return;
    setZipping(true);
    try {
      const blob = await buildMetadataZip(summary);
      downloadBlob(blob, timestampedFilename('metadata-bundle', 'zip'));
    } catch (err) {
      setError(`ZIP 打包失败：${(err as Error).message}`);
    } finally {
      setZipping(false);
    }
  }, [summary]);

  /** 切换报告展开/折叠 */
  const handleToggleExpand = useCallback((idx: number) => {
    setExpandedIdx((prev) => (prev === idx ? null : idx));
  }, []);

  /** 过滤后的报告列表 */
  const filteredReports = useMemo(() => {
    if (!summary) return [];
    if (riskFilter === 'all') return summary.reports.map((r, idx) => ({ report: r, originalIdx: idx }));
    return summary.reports
      .map((r, idx) => ({ report: r, originalIdx: idx }))
      .filter(({ report }) => report.privacy.riskLevel === riskFilter);
  }, [summary, riskFilter]);

  // 处理进度百分比
  const progressPercent = progress && progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <div className="mdb">
      {/* 上传区 */}
      <section className="mdb__upload" aria-label="图片上传区">
        <div
          className={`mdb__dropzone${dragOver ? ' mdb__dropzone--over' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="点击或拖拽上传图片"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
        >
          <div className="mdb__dropzone-icon" aria-hidden="true">📁</div>
          <div className="mdb__dropzone-text">
            <strong>点击选择图片</strong>或拖拽到此区域
          </div>
          <div className="mdb__dropzone-hint">
            支持 JPEG / PNG / WebP / TIFF / HEIC / GIF / AVIF / BMP，单文件最大 {formatBytes(MAX_FILE_SIZE)}
          </div>
          {/* 文件夹选择按钮：阻止冒泡避免触发 dropzone 整体点击 */}
          <button
            type="button"
            className="mdb__folder-btn"
            onClick={(e) => {
              e.stopPropagation();
              handlePickFolder();
            }}
            title="递归上传文件夹内所有图片（含子目录），非图片文件自动跳过"
          >
            🗂️ 选择整个文件夹（递归上传）
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={SUPPORTED_MIME_TYPES.join(',') + ',.heic,.heif,.tif,.tiff'}
            multiple
            onChange={handleFileInputChange}
            className="mdb__file-input"
            aria-label="文件选择"
          />
          {/* 文件夹 input：webkitdirectory 属性通过 ref + setAttribute 设置（见 useEffect） */}
          <input
            ref={folderInputRef}
            type="file"
            multiple
            onChange={handleFolderInputChange}
            className="mdb__file-input"
            aria-label="选择文件夹"
          />
        </div>

        {folderSkipped !== null && folderSkipped > 0 && (
          <div className="mdb__folder-skipped" role="status">
            已从所选文件夹跳过 <strong>{folderSkipped}</strong> 个非图片文件
          </div>
        )}

        {error && (
          <div className="mdb__error" role="alert">
            <strong>错误：</strong>
            <pre>{error}</pre>
          </div>
        )}
      </section>

      {/* 文件列表 */}
      {files.length > 0 && (
        <section className="mdb__files" aria-label="待处理文件列表">
          <div className="mdb__files-header">
            <h2 className="mdb__files-title">
              待处理文件 <span className="mdb__count">({files.length})</span>
            </h2>
            <div className="mdb__files-actions">
              <button
                type="button"
                className="mdb__btn mdb__btn--primary"
                onClick={handleProcess}
                disabled={processing || files.length === 0}
              >
                {processing ? '处理中...' : `开始批量解析 (${files.length})`}
              </button>
              <button
                type="button"
                className="mdb__btn mdb__btn--ghost"
                onClick={handleClearAll}
                disabled={processing}
              >
                清空
              </button>
            </div>
          </div>
          <ul className="mdb__file-list">
            {files.map((file, idx) => (
              <li key={`${file.name}-${idx}`} className="mdb__file-item">
                <span className="mdb__file-name" title={file.name}>{file.name}</span>
                <span className="mdb__file-size">{formatBytes(file.size)}</span>
                <span className="mdb__file-type">{file.type || '未知'}</span>
                <button
                  type="button"
                  className="mdb__btn mdb__btn--icon"
                  onClick={() => handleRemoveFile(idx)}
                  disabled={processing}
                  aria-label={`移除 ${file.name}`}
                  title="移除"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 处理进度 */}
      {processing && progress && (
        <section className="mdb__progress" aria-label="处理进度">
          <div className="mdb__progress-bar">
            <div className="mdb__progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="mdb__progress-text">
            正在解析 {progress.current} / {progress.total}：{progress.fileName}
          </div>
        </section>
      )}

      {/* 处理结果 */}
      {summary && (
        <section className="mdb__result" aria-label="处理结果">
          {/* 概览统计 */}
          <div className="mdb__overview">
            <h2 className="mdb__overview-title">处理概览</h2>
            <div className="mdb__overview-grid">
              <div className="mdb__stat">
                <div className="mdb__stat-value">{summary.total}</div>
                <div className="mdb__stat-label">总数</div>
              </div>
              <div className="mdb__stat">
                <div className="mdb__stat-value">{summary.success}</div>
                <div className="mdb__stat-label">成功</div>
              </div>
              <div className="mdb__stat">
                <div className="mdb__stat-value mdb__stat-value--warn">{summary.failed}</div>
                <div className="mdb__stat-label">失败</div>
              </div>
              <div className="mdb__stat">
                <div className="mdb__stat-value">{(summary.duration / 1000).toFixed(2)}s</div>
                <div className="mdb__stat-label">耗时</div>
              </div>
            </div>

            {/* 风险等级统计 */}
            <div className="mdb__risk-stats">
              <h3 className="mdb__subtitle">隐私风险分布</h3>
              <div className="mdb__risk-stats-grid">
                <div className={`mdb__risk-stat ${RISK_BADGE_CLASS.high}`}>
                  <div className="mdb__risk-stat-value">{summary.riskStats.high}</div>
                  <div className="mdb__risk-stat-label">{RISK_TEXT.high}</div>
                </div>
                <div className={`mdb__risk-stat ${RISK_BADGE_CLASS.medium}`}>
                  <div className="mdb__risk-stat-value">{summary.riskStats.medium}</div>
                  <div className="mdb__risk-stat-label">{RISK_TEXT.medium}</div>
                </div>
                <div className={`mdb__risk-stat ${RISK_BADGE_CLASS.low}`}>
                  <div className="mdb__risk-stat-value">{summary.riskStats.low}</div>
                  <div className="mdb__risk-stat-label">{RISK_TEXT.low}</div>
                </div>
              </div>
            </div>

            {/* 类别命中统计 */}
            <div className="mdb__category-stats">
              <h3 className="mdb__subtitle">隐私类别命中</h3>
              <ul className="mdb__category-list">
                {(Object.keys(summary.categoryStats) as PrivacyCategory[]).map((cat) => (
                  <li key={cat} className="mdb__category-item">
                    <span className="mdb__category-name">{CATEGORY_TEXT[cat]}</span>
                    <span className="mdb__category-count">{summary.categoryStats[cat]}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* 格式分布 */}
            <div className="mdb__format-stats">
              <h3 className="mdb__subtitle">格式分布</h3>
              <ul className="mdb__format-list">
                {Object.entries(summary.formatStats).map(([fmt, count]) => (
                  <li key={fmt} className="mdb__format-item">
                    <span className="mdb__format-name">{fmt}</span>
                    <span className="mdb__format-count">{count}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* 导出按钮组 */}
          <div className="mdb__export-bar" aria-label="报告导出">
            <button
              type="button"
              className="mdb__btn mdb__btn--primary"
              onClick={handleDownloadZip}
              disabled={zipping}
              title="ZIP 包含每图独立 JSON + manifest.json + README.txt + summary.md + summary.csv + summary.jsonl"
            >
              {zipping ? '打包中...' : '⬇ 下载 ZIP 完整包'}
            </button>
            <button
              type="button"
              className="mdb__btn mdb__btn--secondary"
              onClick={handleDownloadJson}
              title="结构化 JSON 文档，含统计汇总与全部报告，便于程序解析"
            >
              ⬇ JSON
            </button>
            <button
              type="button"
              className="mdb__btn mdb__btn--secondary"
              onClick={handleDownloadJsonLines}
              title="NDJSON 格式，每行一个图片报告，便于日志聚合（ELK / Loki）与大数据管道（Kafka / Spark Streaming）"
            >
              ⬇ JSON Lines
            </button>
            <button
              type="button"
              className="mdb__btn mdb__btn--secondary"
              onClick={handleDownloadMarkdown}
              title="人类可读的 Markdown 报告，含概览统计与各图详情"
            >
              ⬇ Markdown
            </button>
            <button
              type="button"
              className="mdb__btn mdb__btn--secondary"
              onClick={handleDownloadCsv}
              title="表格格式，一行一图，含 16 列，适合 Excel 分析"
            >
              ⬇ CSV
            </button>
          </div>

          {/* 风险筛选器 */}
          <div className="mdb__filter" role="radiogroup" aria-label="风险等级筛选">
            <span className="mdb__filter-label">筛选：</span>
            <button
              type="button"
              role="radio"
              aria-checked={riskFilter === 'all'}
              className={`mdb__filter-btn${riskFilter === 'all' ? ' mdb__filter-btn--active' : ''}`}
              onClick={() => setRiskFilter('all')}
            >
              全部 ({summary.reports.length})
            </button>
            {summary.riskStats.high > 0 && (
              <button
                type="button"
                role="radio"
                aria-checked={riskFilter === 'high'}
                className={`mdb__filter-btn mdb__filter-btn--high${riskFilter === 'high' ? ' mdb__filter-btn--active' : ''}`}
                onClick={() => setRiskFilter('high')}
              >
                高风险 ({summary.riskStats.high})
              </button>
            )}
            {summary.riskStats.medium > 0 && (
              <button
                type="button"
                role="radio"
                aria-checked={riskFilter === 'medium'}
                className={`mdb__filter-btn mdb__filter-btn--medium${riskFilter === 'medium' ? ' mdb__filter-btn--active' : ''}`}
                onClick={() => setRiskFilter('medium')}
              >
                中风险 ({summary.riskStats.medium})
              </button>
            )}
            {summary.riskStats.low > 0 && (
              <button
                type="button"
                role="radio"
                aria-checked={riskFilter === 'low'}
                className={`mdb__filter-btn mdb__filter-btn--low${riskFilter === 'low' ? ' mdb__filter-btn--active' : ''}`}
                onClick={() => setRiskFilter('low')}
              >
                低风险 ({summary.riskStats.low})
              </button>
            )}
          </div>

          {/* 报告列表 */}
          <ul className="mdb__report-list" aria-label="各图元数据报告">
            {filteredReports.length === 0 && (
              <li className="mdb__empty">无符合筛选条件的报告</li>
            )}
            {filteredReports.map(({ report, originalIdx }) => {
              const expanded = expandedIdx === originalIdx;
              return (
                <li key={originalIdx} className={`mdb__report-item mdb__report-item--${report.privacy.riskLevel}`}>
                  <div className="mdb__report-header">
                    <button
                      type="button"
                      className="mdb__report-toggle"
                      onClick={() => handleToggleExpand(originalIdx)}
                      aria-expanded={expanded}
                      aria-label={`展开 ${report.fileName} 详情`}
                    >
                      <span className="mdb__report-arrow" aria-hidden="true">{expanded ? '▼' : '▶'}</span>
                      <span className="mdb__report-name" title={report.fileName}>{report.fileName}</span>
                    </button>
                    <span className={RISK_BADGE_CLASS[report.privacy.riskLevel]}>
                      {RISK_TEXT[report.privacy.riskLevel]}
                    </span>
                    <span className="mdb__report-size">{formatBytes(report.fileSize)}</span>
                    {report.imageInfo.width && report.imageInfo.height && (
                      <span className="mdb__report-dim">
                        {report.imageInfo.width}×{report.imageInfo.height}
                      </span>
                    )}
                    {report.parseError && (
                      <span className="mdb__badge mdb__badge--error" title={report.parseError}>
                        解析失败
                      </span>
                    )}
                  </div>

                  {expanded && <ReportDetail report={report} />}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* 空状态 */}
      {files.length === 0 && !summary && (
        <div className="mdb__empty-state">
          <div className="mdb__empty-icon" aria-hidden="true">📥</div>
          <p className="mdb__empty-text">尚未选择图片文件</p>
          <p className="mdb__empty-hint">
            选择一批图片后，本工具会自动批量提取 EXIF / IPTC / XMP / ICC 元数据，
            并进行隐私风险分析（GPS 定位、设备序列号、个人信息等敏感字段），
            支持 JSON / Markdown / CSV / ZIP 多格式报告导出。
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * 报告详情子组件：展开后显示完整元数据与隐私发现
 */
function ReportDetail({ report }: { report: ImageMetadataReport }) {
  const exifEntries = report.exif ? Object.entries(report.exif) : [];
  const iptcEntries = report.iptc ? Object.entries(report.iptc) : [];
  const xmpEntries = report.xmp ? Object.entries(report.xmp) : [];

  return (
    <div className="mdb__report-detail">
      {/* 基础信息 */}
      <div className="mdb__detail-section">
        <h4 className="mdb__detail-title">基础信息</h4>
        <dl className="mdb__detail-grid">
          <dt>文件名</dt><dd>{report.fileName}</dd>
          <dt>文件大小</dt><dd>{formatBytes(report.fileSize)}</dd>
          <dt>MIME 类型</dt><dd>{report.mimeType}</dd>
          <dt>修改时间</dt><dd>{formatTime(report.lastModified)}</dd>
          {report.imageInfo.width && (<><dt>图片宽度</dt><dd>{report.imageInfo.width}px</dd></>)}
          {report.imageInfo.height && (<><dt>图片高度</dt><dd>{report.imageInfo.height}px</dd></>)}
          {report.imageInfo.format && (<><dt>格式</dt><dd>{report.imageInfo.format}</dd></>)}
          {report.imageInfo.colorSpace && (<><dt>色彩空间</dt><dd>{report.imageInfo.colorSpace}</dd></>)}
          {report.imageInfo.orientation != null && report.imageInfo.orientation !== 0 && (
            <><dt>方向</dt><dd>{report.imageInfo.orientation}</dd></>
          )}
          {report.icc && (<><dt>ICC Profile</dt><dd>{report.icc.name || '未命名'} ({report.icc.size || 0} 字节)</dd></>)}
          {report.parseDuration != null && (<><dt>解析耗时</dt><dd>{report.parseDuration.toFixed(0)}ms</dd></>)}
        </dl>
      </div>

      {/* 解析错误 */}
      {report.parseError && (
        <div className="mdb__detail-section">
          <div className="mdb__detail-error" role="alert">
            <strong>解析错误：</strong>{report.parseError}
          </div>
        </div>
      )}

      {/* 隐私发现 */}
      {report.privacy.findings.length > 0 && (
        <div className="mdb__detail-section">
          <h4 className="mdb__detail-title">
            隐私发现 ({report.privacy.findings.length})
          </h4>
          <ul className="mdb__findings-list">
            {report.privacy.findings.map((f, idx) => (
              <li key={idx} className={`mdb__finding mdb__finding--${f.severity}`}>
                <div className="mdb__finding-header">
                  <span className={`mdb__badge mdb__badge--${f.severity}`}>
                    {SEVERITY_TEXT[f.severity]}
                  </span>
                  <span className="mdb__finding-category">{CATEGORY_TEXT[f.category]}</span>
                  <code className="mdb__finding-field">{f.field}</code>
                </div>
                <div className="mdb__finding-desc">{f.description}</div>
                <div className="mdb__finding-rec">
                  <strong>建议：</strong>{f.recommendation}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* EXIF 字段 */}
      {exifEntries.length > 0 && (
        <div className="mdb__detail-section">
          <h4 className="mdb__detail-title">EXIF 字段 ({exifEntries.length})</h4>
          <dl className="mdb__detail-grid mdb__detail-grid--code">
            {exifEntries.slice(0, 50).map(([k, v]) => (
              <div key={k} className="mdb__field-row">
                <dt>{k}</dt>
                <dd title={truncateValue(v, 500)}>{truncateValue(v, 100)}</dd>
              </div>
            ))}
            {exifEntries.length > 50 && (
              <div className="mdb__field-more">
                ... 还有 {exifEntries.length - 50} 个字段（查看 JSON 报告获取完整数据）
              </div>
            )}
          </dl>
        </div>
      )}

      {/* IPTC 字段 */}
      {iptcEntries.length > 0 && (
        <div className="mdb__detail-section">
          <h4 className="mdb__detail-title">IPTC 字段 ({iptcEntries.length})</h4>
          <dl className="mdb__detail-grid mdb__detail-grid--code">
            {iptcEntries.slice(0, 30).map(([k, v]) => (
              <div key={k} className="mdb__field-row">
                <dt>{k}</dt>
                <dd title={truncateValue(v, 500)}>{truncateValue(v, 100)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* XMP 字段 */}
      {xmpEntries.length > 0 && (
        <div className="mdb__detail-section">
          <h4 className="mdb__detail-title">XMP 字段 ({xmpEntries.length})</h4>
          <dl className="mdb__detail-grid mdb__detail-grid--code">
            {xmpEntries.slice(0, 30).map(([k, v]) => (
              <div key={k} className="mdb__field-row">
                <dt>{k}</dt>
                <dd title={truncateValue(v, 500)}>{truncateValue(v, 100)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* 无元数据提示 */}
      {exifEntries.length === 0 && iptcEntries.length === 0 && xmpEntries.length === 0 && !report.parseError && (
        <div className="mdb__detail-empty">
          该图片未检测到 EXIF / IPTC / XMP 元数据（可能是被清理过的图片或格式本身不携带元数据）
        </div>
      )}
    </div>
  );
}
