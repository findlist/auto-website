import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import exifr from 'exifr';
import {
  applyEdits,
  buildEditedFilename,
  EDIT_OPERATIONS,
  MAX_FILE_SIZE,
  nowExifDateTime,
  parseJpegSegments,
  isExifSegment,
  type EditOperation,
  type EditResult,
} from '../utils/exifEditor';
import { formatBytes, downloadBlob } from '../utils/imageConvert';

/**
 * EXIF 元数据编辑器
 * 全部在浏览器本地操作 JPEG 二进制结构，不发起任何网络请求。
 *
 * 功能：
 *  - 支持 JPEG 文件的 EXIF 元数据编辑（其他格式提示用户）
 *  - 删除 GPS 定位 / 个人信息 / MakerNote / 缩略图 / 软件信息
 *  - 修改拍摄时间（DateTime / DateTimeOriginal / DateTimeDigitized）
 *  - 一键清除全部 EXIF（移除整个 APP1 段）
 *  - 编辑前后元数据对比，可视化展示被删除/修改的字段
 *  - 编辑结果实时预览 + 一键下载
 */

/** 编辑前后的元数据快照（用于对比展示） */
interface MetaSnapshot {
  /** 字段分组 */
  [groupName: string]: {
    [label: string]: string;
  };
}

/** 字段分组定义（与 ExifTool 保持一致） */
const GROUPS: { title: string; icon: string; tags: string[] }[] = [
  { title: '相机信息', icon: '📷', tags: ['Make', 'Model', 'LensModel', 'LensMake', 'Software'] },
  { title: '拍摄参数', icon: '⚙️', tags: ['ISO', 'FNumber', 'ExposureTime', 'FocalLength', 'ExposureMode'] },
  { title: 'GPS 定位', icon: '📍', tags: ['GPSLatitude', 'GPSLongitude', 'GPSAltitude'] },
  { title: '时间信息', icon: '🕐', tags: ['DateTimeOriginal', 'DateTimeDigitized', 'DateTime'] },
  { title: '个人信息', icon: '👤', tags: ['Artist', 'Copyright', 'BodySerialNumber', 'CameraOwnerName', 'LensSerialNumber'] },
];

/** 从 exifr 解析结果提取分组快照 */
function buildSnapshot(parsed: Record<string, unknown> | null): MetaSnapshot {
  if (!parsed) return {};
  const result: MetaSnapshot = {};
  for (const group of GROUPS) {
    const items: Record<string, string> = {};
    for (const tag of group.tags) {
      const val = parsed[tag];
      if (val !== undefined && val !== null) {
        items[tag] = formatMetaValue(tag, val);
      }
    }
    if (Object.keys(items).length > 0) {
      result[group.title] = items;
    }
  }
  return result;
}

/** 格式化元数据值为可读字符串 */
function formatMetaValue(tag: string, val: unknown): string {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${val.getFullYear()}:${pad(val.getMonth() + 1)}:${pad(val.getDate())} ${pad(val.getHours())}:${pad(val.getMinutes())}:${pad(val.getSeconds())}`;
  }
  if (tag.startsWith('GPS')) {
    if (typeof val === 'number') return val.toFixed(6);
    return String(val);
  }
  if (typeof val === 'number') return String(val);
  return String(val);
}

/** 快照中字段总数 */
function countSnapshotFields(snap: MetaSnapshot): number {
  return Object.values(snap).reduce((acc, g) => acc + Object.keys(g).length, 0);
}

export default function ExifEditorTool() {
  // 文件状态
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string>('');
  const [parsedMeta, setParsedMeta] = useState<Record<string, unknown> | null>(null);
  const [hasExif, setHasExif] = useState<boolean>(false);
  const [hasJpeg, setHasJpeg] = useState<boolean>(false);

  // 编辑操作状态
  const [checkedOps, setCheckedOps] = useState<Set<string>>(
    () => new Set(EDIT_OPERATIONS.filter((op) => op.defaultChecked).map((op) => op.type)),
  );
  const [enableDateTime, setEnableDateTime] = useState<boolean>(false);
  const [dateTimeValue, setDateTimeValue] = useState<string>(nowExifDateTime());

  // 编辑结果状态
  const [editing, setEditing] = useState<boolean>(false);
  const [editResult, setEditResult] = useState<EditResult | null>(null);
  const [editedUrl, setEditedUrl] = useState<string>('');
  const [editedMeta, setEditedMeta] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string>('');

  // 拖拽状态
  const [dragging, setDragging] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  /** 清理 ObjectURL 避免内存泄漏 */
  useEffect(() => {
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
      if (editedUrl) URL.revokeObjectURL(editedUrl);
    };
  }, [fileUrl, editedUrl]);

  /** 处理文件加载与解析 */
  const loadFile = useCallback(async (f: File) => {
    setError('');
    // 清理旧状态
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    if (editedUrl) URL.revokeObjectURL(editedUrl);
    setEditResult(null);
    setEditedUrl('');
    setEditedMeta(null);

    // 文件类型校验：仅支持 JPEG
    const isJpeg =
      f.type === 'image/jpeg' || /\.jpe?g$/i.test(f.name);
    if (!isJpeg) {
      setFile(f);
      setFileUrl(URL.createObjectURL(f));
      setParsedMeta(null);
      setHasExif(false);
      setHasJpeg(false);
      setError('当前仅支持 JPEG 文件。PNG / WebP / TIFF 等格式的 EXIF 编辑暂不支持，请上传 JPEG 图片。');
      return;
    }

    // 文件大小校验
    if (f.size > MAX_FILE_SIZE) {
      setError(`文件过大（${formatBytes(f.size)}），请选择小于 ${formatBytes(MAX_FILE_SIZE)} 的图片`);
      return;
    }

    setFile(f);
    const url = URL.createObjectURL(f);
    setFileUrl(url);
    setHasJpeg(true);

    try {
      // 读取文件字节，检查 EXIF 段是否存在
      const buf = await f.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let exifExists = false;
      try {
        const segments = parseJpegSegments(bytes);
        exifExists = segments.some((s) => isExifSegment(s));
      } catch {
        // 段解析失败，仍尝试 exifr 解析
      }
      setHasExif(exifExists);

      // 用 exifr 解析元数据（用于对比展示）
      const parsed = await exifr.parse(f, { tiff: true, exif: true, gps: true });
      setParsedMeta(parsed || null);
    } catch (err) {
      setParsedMeta(null);
      setHasExif(false);
      setError(`解析文件失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [fileUrl, editedUrl]);

  /** 文件选择 */
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) loadFile(f);
  }, [loadFile]);

  /** 拖拽事件 */
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  }, []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) loadFile(f);
  }, [loadFile]);

  /** 切换操作勾选 */
  const toggleOp = useCallback((type: string) => {
    setCheckedOps((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      // removeAll 互斥：勾选 removeAll 时清除其他选项
      if (type === 'removeAll' && next.has('removeAll')) {
        EDIT_OPERATIONS.filter((op) => op.type !== 'removeAll').forEach((op) => next.delete(op.type));
        setEnableDateTime(false);
      }
      // 勾选其他项时清除 removeAll
      if (type !== 'removeAll' && next.has(type)) {
        next.delete('removeAll');
      }
      return next;
    });
  }, []);

  /** 当前生效的操作列表 */
  const activeOps = useMemo<EditOperation[]>(() => {
    const ops: EditOperation[] = [];
    for (const op of EDIT_OPERATIONS) {
      if (checkedOps.has(op.type)) {
        if (op.type === 'setDateTime') {
          // setDateTime 需要启用开关 + 时间值
          if (enableDateTime && dateTimeValue) {
            ops.push({ type: 'setDateTime', dateTime: dateTimeValue });
          }
        } else {
          ops.push({ type: op.type });
        }
      }
    }
    return ops;
  }, [checkedOps, enableDateTime, dateTimeValue]);

  /** 执行编辑 */
  const runEdit = useCallback(async () => {
    if (!file || activeOps.length === 0) return;
    setEditing(true);
    setError('');
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const result = applyEdits(bytes, activeOps);
      setEditResult(result);
      // 生成 Blob URL
      const blob = new Blob([result.bytes as BlobPart], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      if (editedUrl) URL.revokeObjectURL(editedUrl);
      setEditedUrl(url);
      // 重新解析编辑后的元数据
      try {
        const reparsed = await exifr.parse(blob, { tiff: true, exif: true, gps: true });
        setEditedMeta(reparsed || null);
      } catch {
        setEditedMeta(null);
      }
    } catch (err) {
      setError(`编辑失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setEditing(false);
    }
  }, [file, activeOps, editedUrl]);

  /** 下载编辑后文件 */
  const handleDownload = useCallback(() => {
    if (!editedUrl || !file) return;
    downloadBlob(editedUrl, buildEditedFilename(file.name));
  }, [editedUrl, file]);

  /** 加载示例提示 */
  const handleSample = useCallback(() => {
    setError('请上传一张含 EXIF 信息的 JPEG 照片（如手机拍摄的原片）以体验编辑功能。本工具不会上传任何数据。');
  }, []);

  /** 清空 */
  const handleClear = useCallback(() => {
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    if (editedUrl) URL.revokeObjectURL(editedUrl);
    setFile(null);
    setFileUrl('');
    setParsedMeta(null);
    setEditedMeta(null);
    setEditResult(null);
    setEditedUrl('');
    setHasExif(false);
    setHasJpeg(false);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [fileUrl, editedUrl]);

  // 渲染：原始与编辑后快照
  const beforeSnap = useMemo(() => buildSnapshot(parsedMeta), [parsedMeta]);
  const afterSnap = useMemo(() => buildSnapshot(editedMeta), [editedMeta]);

  return (
    <div className="exifedit__container">
      {/* 文件输入区 */}
      <div
        className={`exifedit__dropzone${dragging ? ' exifedit__dropzone--drag' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
        aria-label="点击或拖入 JPEG 图片"
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,.jpg,.jpeg"
          onChange={handleFileSelect}
          className="exifedit__file-input"
          aria-label="选择 JPEG 图片"
        />
        <div className="exifedit__dropzone-content">
          <div className="exifedit__dropzone-icon" aria-hidden="true">📷</div>
          <div className="exifedit__dropzone-text">
            {file ? (
              <>
                <strong>{file.name}</strong>
                <span className="exifedit__file-meta">
                  {formatBytes(file.size)}
                  {!hasJpeg && ' · 非 JPEG'}
                  {hasJpeg && (hasExif ? ' · 含 EXIF' : ' · 无 EXIF')}
                </span>
              </>
            ) : (
              <>
                <strong>点击或拖入 JPEG 图片</strong>
                <span className="exifedit__file-meta">仅支持 JPEG，最大 {formatBytes(MAX_FILE_SIZE)}，全本地处理</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="exifedit__error" role="alert">
          {error}
        </div>
      )}

      {/* 主体：仅在已加载文件时显示 */}
      {file && (
        <div className="exifedit__main">
          {/* 左侧：预览 + 操作配置 */}
          <div className="exifedit__left">
            {/* 图片预览 */}
            <div className="exifedit__preview">
              <h3 className="exifedit__section-title">图片预览</h3>
              <div className="exifedit__preview-imgs">
                {fileUrl && (
                  <div className="exifedit__preview-item">
                    <span className="exifedit__preview-label">原图</span>
                    <img src={fileUrl} alt="原图预览" loading="lazy" />
                  </div>
                )}
                {editedUrl && (
                  <div className="exifedit__preview-item">
                    <span className="exifedit__preview-label">编辑后</span>
                    <img src={editedUrl} alt="编辑后预览" loading="lazy" />
                  </div>
                )}
              </div>
            </div>

            {/* 编辑操作配置 */}
            <div className="exifedit__ops">
              <h3 className="exifedit__section-title">编辑操作</h3>
              {!hasJpeg && (
                <p className="exifedit__hint">当前文件不是 JPEG，无法编辑 EXIF。请上传 JPEG 图片。</p>
              )}
              {hasJpeg && !hasExif && (
                <p className="exifedit__hint">该 JPEG 不含 EXIF 段，无需编辑。</p>
              )}
              {hasJpeg && hasExif && (
                <>
                  <div className="exifedit__op-list">
                    {EDIT_OPERATIONS.map((op) => {
                      const checked = checkedOps.has(op.type);
                      const disabled = !hasExif;
                      return (
                        <label
                          key={op.type}
                          className={`exifedit__op${checked ? ' exifedit__op--checked' : ''}${disabled ? ' exifedit__op--disabled' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => toggleOp(op.type)}
                          />
                          <div className="exifedit__op-body">
                            <div className="exifedit__op-label">{op.label}</div>
                            <div className="exifedit__op-desc">{op.desc}</div>
                            {op.type === 'setDateTime' && checked && (
                              <div className="exifedit__datetime">
                                <label className="exifedit__datetime-toggle">
                                  <input
                                    type="checkbox"
                                    checked={enableDateTime}
                                    onChange={(e) => setEnableDateTime(e.target.checked)}
                                  />
                                  <span>启用时间修改</span>
                                </label>
                                {enableDateTime && (
                                  <input
                                    type="text"
                                    className="exifedit__datetime-input"
                                    value={dateTimeValue}
                                    onChange={(e) => setDateTimeValue(e.target.value)}
                                    placeholder="YYYY:MM:DD HH:MM:SS"
                                    aria-label="拍摄时间"
                                  />
                                )}
                              </div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  <div className="exifedit__actions">
                    <button
                      type="button"
                      className="exifedit__btn exifedit__btn--primary"
                      onClick={runEdit}
                      disabled={editing || activeOps.length === 0}
                    >
                      {editing ? '处理中...' : '执行编辑'}
                    </button>
                    <button
                      type="button"
                      className="exifedit__btn"
                      onClick={handleSample}
                    >
                      加载示例
                    </button>
                    <button
                      type="button"
                      className="exifedit__btn"
                      onClick={handleClear}
                    >
                      清空
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 右侧：结果与对比 */}
          <div className="exifedit__right">
            {/* 编辑结果摘要 */}
            {editResult && (
              <div className="exifedit__result">
                <h3 className="exifedit__section-title">编辑结果</h3>
                <div className="exifedit__summary">
                  <div className="exifedit__summary-item">
                    <span className="exifedit__summary-label">原始大小</span>
                    <span className="exifedit__summary-value">{formatBytes(editResult.originalSize)}</span>
                  </div>
                  <div className="exifedit__summary-item">
                    <span className="exifedit__summary-label">编辑后</span>
                    <span className="exifedit__summary-value">{formatBytes(editResult.editedSize)}</span>
                  </div>
                  <div className="exifedit__summary-item">
                    <span className="exifedit__summary-label">节省</span>
                    <span className={`exifedit__summary-value${editResult.savedBytes > 0 ? ' exifedit__summary-value--good' : ''}`}>
                      {editResult.savedBytes > 0 ? `-${formatBytes(editResult.savedBytes)}` : '0 B'}
                    </span>
                  </div>
                  <div className="exifedit__summary-item">
                    <span className="exifedit__summary-label">耗时</span>
                    <span className="exifedit__summary-value">{editResult.elapsedMs.toFixed(1)} ms</span>
                  </div>
                </div>

                {/* 已执行操作 */}
                {editResult.appliedOps.length > 0 && (
                  <div className="exifedit__applied">
                    <h4 className="exifedit__subsection-title">已执行操作</h4>
                    <ul className="exifedit__applied-list">
                      {editResult.appliedOps.map((op, idx) => {
                        const meta = EDIT_OPERATIONS.find((m) => m.type === op.type);
                        return (
                          <li key={idx} className="exifedit__applied-item">
                            <span className="exifedit__applied-icon">✓</span>
                            <span>{meta?.label ?? op.type}</span>
                            {op.dateTime && <span className="exifedit__applied-detail">→ {op.dateTime}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {/* 被删除字段 */}
                {editResult.removedFields.length > 0 && (
                  <div className="exifedit__removed">
                    <h4 className="exifedit__subsection-title">被删除字段（{editResult.removedFields.length}）</h4>
                    <ul className="exifedit__field-list">
                      {editResult.removedFields.map((f, idx) => (
                        <li key={idx} className="exifedit__field-item exifedit__field-item--removed">
                          <span className="exifedit__field-ifd">{f.ifd}</span>
                          <span className="exifedit__field-name">{f.tagName}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 被修改字段 */}
                {editResult.modifiedFields.length > 0 && (
                  <div className="exifedit__modified">
                    <h4 className="exifedit__subsection-title">被修改字段（{editResult.modifiedFields.length}）</h4>
                    <ul className="exifedit__field-list">
                      {editResult.modifiedFields.map((f, idx) => (
                        <li key={idx} className="exifedit__field-item exifedit__field-item--modified">
                          <span className="exifedit__field-ifd">{f.ifd}</span>
                          <span className="exifedit__field-name">{f.tagName}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 下载按钮 */}
                {editedUrl && (
                  <button
                    type="button"
                    className="exifedit__btn exifedit__btn--primary exifedit__btn--download"
                    onClick={handleDownload}
                  >
                    ⬇ 下载编辑后文件
                  </button>
                )}
              </div>
            )}

            {/* 元数据对比 */}
            {(parsedMeta || editedMeta) && (
              <div className="exifedit__compare">
                <h3 className="exifedit__section-title">元数据对比</h3>
                <div className="exifedit__compare-grid">
                  <div className="exifedit__compare-col">
                    <h4 className="exifedit__compare-title">编辑前（{countSnapshotFields(beforeSnap)} 字段）</h4>
                    <MetaSnapshotView snapshot={beforeSnap} />
                  </div>
                  <div className="exifedit__compare-col">
                    <h4 className="exifedit__compare-title">
                      编辑后（{editResult ? countSnapshotFields(afterSnap) : '—'} 字段）
                    </h4>
                    {editResult ? (
                      <MetaSnapshotView snapshot={afterSnap} />
                    ) : (
                      <p className="exifedit__hint">点击"执行编辑"查看结果</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 元数据快照视图组件 */
function MetaSnapshotView({ snapshot }: { snapshot: MetaSnapshot }) {
  const groups = Object.entries(snapshot);
  if (groups.length === 0) {
    return <p className="exifedit__hint">无元数据</p>;
  }
  return (
    <div className="exifedit__snap">
      {groups.map(([groupTitle, items]) => (
        <div key={groupTitle} className="exifedit__snap-group">
          <h5 className="exifedit__snap-group-title">{groupTitle}</h5>
          <dl className="exifedit__snap-fields">
            {Object.entries(items).map(([label, value]) => (
              <div key={label} className="exifedit__snap-field">
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
