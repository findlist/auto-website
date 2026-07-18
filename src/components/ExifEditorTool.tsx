import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import exifr from 'exifr';
import {
  applyEdits,
  applyEditsBatch,
  buildEditedFilename,
  buildBatchEditedFilename,
  EDIT_OPERATIONS,
  MAX_FILE_SIZE,
  nowExifDateTime,
  parseJpegSegments,
  isExifSegment,
  loadPresets,
  savePreset,
  deletePreset,
  touchPreset,
  exportPresets,
  importPresets,
  type EditOperation,
  type EditResult,
  type EditPreset,
  type BatchEditSummary,
} from '../utils/exifEditor';
import { createZipFile, type ZipEntry } from '../utils/imageCrop';
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

  // 模式切换：单文件 / 批量处理（第 89 轮新增）
  const [mode, setMode] = useState<'single' | 'batch'>('single');

  // 批量处理状态
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchRunning, setBatchRunning] = useState<boolean>(false);
  const [batchResult, setBatchResult] = useState<BatchEditSummary | null>(null);
  const [batchError, setBatchError] = useState<string>('');
  const [batchDragging, setBatchDragging] = useState<boolean>(false);
  const batchInputRef = useRef<HTMLInputElement>(null);

  // 预设管理状态
  const [presets, setPresets] = useState<EditPreset[]>([]);
  const [presetName, setPresetName] = useState<string>('');
  const [presetError, setPresetError] = useState<string>('');
  const importInputRef = useRef<HTMLInputElement>(null);

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

  // ============================================================
  // 批量处理逻辑（第 89 轮新增）
  // ============================================================

  /** 加载批量文件（仅保留 JPEG，校验大小） */
  const handleBatchFiles = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const jpegFiles = Array.from(fileList).filter(
      (f) => f.type === 'image/jpeg' || /\.jpe?g$/i.test(f.name),
    );
    if (jpegFiles.length === 0) {
      setBatchError('未选择 JPEG 文件。批量处理仅支持 JPEG 格式。');
      return;
    }
    const oversized = jpegFiles.filter((f) => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      setBatchError(
        `${oversized.length} 个文件超过 ${formatBytes(MAX_FILE_SIZE)} 限制：${oversized.map((f) => f.name).join(', ')}`,
      );
      return;
    }
    setBatchError('');
    setBatchResult(null);
    setBatchFiles((prev) => [...prev, ...jpegFiles]);
  }, []);

  /** 批量文件选择 */
  const handleBatchSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleBatchFiles(e.target.files);
      if (batchInputRef.current) batchInputRef.current.value = '';
    },
    [handleBatchFiles],
  );

  /** 批量拖拽事件 */
  const onBatchDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setBatchDragging(true);
  }, []);
  const onBatchDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setBatchDragging(false);
  }, []);
  const onBatchDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setBatchDragging(false);
      handleBatchFiles(e.dataTransfer.files);
    },
    [handleBatchFiles],
  );

  /** 移除批量列表中指定文件 */
  const removeBatchFile = useCallback((idx: number) => {
    setBatchFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  /** 清空批量列表 */
  const clearBatch = useCallback(() => {
    setBatchFiles([]);
    setBatchResult(null);
    setBatchError('');
    if (batchInputRef.current) batchInputRef.current.value = '';
  }, []);

  /** 执行批量编辑（并行读取字节，串行应用编辑避免主线程阻塞） */
  const runBatchEdit = useCallback(async () => {
    if (batchFiles.length === 0 || activeOps.length === 0) return;
    setBatchRunning(true);
    setBatchError('');
    try {
      const buffers = await Promise.all(batchFiles.map((f) => f.arrayBuffer()));
      const bytesList = buffers.map((b) => new Uint8Array(b));
      const names = batchFiles.map((f) => f.name);
      const summary = await applyEditsBatch(bytesList, names, activeOps);
      setBatchResult(summary);
    } catch (err) {
      setBatchError(`批量处理失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBatchRunning(false);
    }
  }, [batchFiles, activeOps]);

  /** 下载批量结果为 ZIP（复用 imageCrop 的 createZipFile，STORE 模式无压缩） */
  const downloadBatchZip = useCallback(async () => {
    if (!batchResult) return;
    const successItems = batchResult.items.filter((it) => it.status === 'success' && it.result);
    if (successItems.length === 0) {
      setBatchError('没有可下载的成功处理结果');
      return;
    }
    const entries: ZipEntry[] = successItems.map((it, idx) => ({
      name: buildBatchEditedFilename(it.fileName, idx, successItems.length),
      blob: new Blob([it.result!.bytes as BlobPart], { type: 'image/jpeg' }),
    }));
    await createZipFile(entries, `exif-edited-${Date.now()}.zip`);
  }, [batchResult]);

  // ============================================================
  // 预设管理逻辑（第 89 轮新增）
  // ============================================================

  /** 组件挂载时加载预设列表 */
  useEffect(() => {
    setPresets(loadPresets());
  }, []);

  /** 保存当前编辑组合为预设 */
  const handleSavePreset = useCallback(() => {
    const name = presetName.trim();
    if (!name) {
      setPresetError('请输入预设名称');
      return;
    }
    if (activeOps.length === 0) {
      setPresetError('请至少选择一个编辑操作');
      return;
    }
    try {
      savePreset({ name, operations: activeOps, enableDateTime, dateTimeValue });
      setPresets(loadPresets());
      setPresetName('');
      setPresetError('');
    } catch (err) {
      setPresetError(`保存预设失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [presetName, activeOps, enableDateTime, dateTimeValue]);

  /** 应用预设到当前编辑配置 */
  const handleApplyPreset = useCallback((preset: EditPreset) => {
    setCheckedOps(new Set(preset.operations.map((op) => op.type)));
    setEnableDateTime(preset.enableDateTime);
    setDateTimeValue(preset.dateTimeValue);
    touchPreset(preset.id);
    setPresets(loadPresets());
    setPresetError('');
  }, []);

  /** 删除预设 */
  const handleDeletePreset = useCallback((presetId: string) => {
    deletePreset(presetId);
    setPresets(loadPresets());
  }, []);

  /** 导出全部预设为 JSON 文件（便于备份/分享） */
  const handleExportPresets = useCallback(() => {
    if (presets.length === 0) {
      setPresetError('没有预设可导出');
      return;
    }
    const json = exportPresets(presets);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    downloadBlob(url, `exif-presets-${Date.now()}.json`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [presets]);

  /** 导入预设 JSON 文件（merge 模式跳过同名） */
  const handleImportPresets = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    f.text()
      .then((text) => {
        const merged = importPresets(text, 'merge');
        setPresets(merged);
        setPresetError(`已导入预设（合并模式），共 ${merged.length} 个`);
      })
      .catch((err) => {
        setPresetError(`导入失败：${err instanceof Error ? err.message : String(err)}`);
      });
    if (importInputRef.current) importInputRef.current.value = '';
  }, []);

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
      {/* Tab 切换：单文件 / 批量处理（第 89 轮新增） */}
      <div className="exifedit__tabs" role="tablist" aria-label="编辑模式切换">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'single'}
          className={`exifedit__tab${mode === 'single' ? ' exifedit__tab--active' : ''}`}
          onClick={() => setMode('single')}
        >
          单文件编辑
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'batch'}
          className={`exifedit__tab${mode === 'batch' ? ' exifedit__tab--active' : ''}`}
          onClick={() => setMode('batch')}
        >
          批量处理（多文件）
        </button>
      </div>

      {mode === 'single' ? (
        <>
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
        </>
      ) : (
        <BatchPanel
          activeOps={activeOps}
          batchFiles={batchFiles}
          batchRunning={batchRunning}
          batchResult={batchResult}
          batchError={batchError}
          batchDragging={batchDragging}
          batchInputRef={batchInputRef}
          onBatchSelect={handleBatchSelect}
          onBatchDragOver={onBatchDragOver}
          onBatchDragLeave={onBatchDragLeave}
          onBatchDrop={onBatchDrop}
          onRemoveBatchFile={removeBatchFile}
          onClearBatch={clearBatch}
          onRunBatchEdit={runBatchEdit}
          onDownloadBatchZip={downloadBatchZip}
        />
      )}

      {/* 预设管理面板（两种模式共用，第 89 轮新增） */}
      <PresetPanel
        presets={presets}
        presetName={presetName}
        presetError={presetError}
        importInputRef={importInputRef}
        activeOpsCount={activeOps.length}
        onPresetNameChange={setPresetName}
        onSavePreset={handleSavePreset}
        onApplyPreset={handleApplyPreset}
        onDeletePreset={handleDeletePreset}
        onExportPresets={handleExportPresets}
        onImportPresets={handleImportPresets}
      />
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

// ============================================================
// 批量处理面板（第 89 轮新增）
// ============================================================

interface BatchPanelProps {
  /** 当前生效的编辑操作列表（用于摘要展示） */
  activeOps: EditOperation[];
  /** 批量文件列表 */
  batchFiles: File[];
  /** 是否正在处理 */
  batchRunning: boolean;
  /** 批量处理结果 */
  batchResult: BatchEditSummary | null;
  /** 错误信息 */
  batchError: string;
  /** 是否正在拖拽 */
  batchDragging: boolean;
  /** 文件输入 ref */
  batchInputRef: React.RefObject<HTMLInputElement>;
  /** 文件选择回调 */
  onBatchSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** 拖拽回调 */
  onBatchDragOver: (e: React.DragEvent) => void;
  onBatchDragLeave: (e: React.DragEvent) => void;
  onBatchDrop: (e: React.DragEvent) => void;
  /** 移除文件回调 */
  onRemoveBatchFile: (idx: number) => void;
  /** 清空列表回调 */
  onClearBatch: () => void;
  /** 执行批量编辑回调 */
  onRunBatchEdit: () => void;
  /** 下载 ZIP 回调 */
  onDownloadBatchZip: () => void;
}

/** 批量处理面板：多文件上传 + 队列处理 + 结果列表 + ZIP 下载 */
function BatchPanel(props: BatchPanelProps) {
  const {
    activeOps,
    batchFiles,
    batchRunning,
    batchResult,
    batchError,
    batchDragging,
    batchInputRef,
    onBatchSelect,
    onBatchDragOver,
    onBatchDragLeave,
    onBatchDrop,
    onRemoveBatchFile,
    onClearBatch,
    onRunBatchEdit,
    onDownloadBatchZip,
  } = props;

  return (
    <div className="exifedit__batch">
      {/* 当前生效操作摘要 */}
      <div className="exifedit__batch-ops-summary">
        <h3 className="exifedit__section-title">当前编辑操作</h3>
        {activeOps.length === 0 ? (
          <p className="exifedit__hint">
            未选择任何编辑操作。请切换到「单文件编辑」Tab 勾选操作后再回到批量处理。
          </p>
        ) : (
          <ul className="exifedit__batch-ops-list">
            {activeOps.map((op, idx) => {
              const meta = EDIT_OPERATIONS.find((m) => m.type === op.type);
              return (
                <li key={idx} className="exifedit__batch-ops-item">
                  <span className="exifedit__batch-ops-icon">✓</span>
                  <span>{meta?.label ?? op.type}</span>
                  {op.dateTime && <span className="exifedit__batch-ops-detail">→ {op.dateTime}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 批量上传区 */}
      <div
        className={`exifedit__dropzone exifedit__dropzone--batch${batchDragging ? ' exifedit__dropzone--drag' : ''}`}
        onDragOver={onBatchDragOver}
        onDragLeave={onBatchDragLeave}
        onDrop={onBatchDrop}
        role="button"
        tabIndex={0}
        aria-label="点击或拖入多个 JPEG 图片"
        onClick={() => batchInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            batchInputRef.current?.click();
          }
        }}
      >
        <input
          ref={batchInputRef}
          type="file"
          accept="image/jpeg,.jpg,.jpeg"
          multiple
          onChange={onBatchSelect}
          className="exifedit__file-input"
          aria-label="选择多个 JPEG 图片"
        />
        <div className="exifedit__dropzone-content">
          <div className="exifedit__dropzone-icon" aria-hidden="true">📦</div>
          <div className="exifedit__dropzone-text">
            <strong>点击或拖入多个 JPEG 图片</strong>
            <span className="exifedit__file-meta">
              仅支持 JPEG，单文件最大 {formatBytes(MAX_FILE_SIZE)}，全本地处理
            </span>
          </div>
        </div>
      </div>

      {/* 错误提示 */}
      {batchError && (
        <div className="exifedit__error" role="alert">
          {batchError}
        </div>
      )}

      {/* 文件列表 */}
      {batchFiles.length > 0 && (
        <div className="exifedit__batch-list">
          <div className="exifedit__batch-list-header">
            <h3 className="exifedit__section-title">
              待处理文件（{batchFiles.length}）
            </h3>
            <button
              type="button"
              className="exifedit__btn"
              onClick={onClearBatch}
              disabled={batchRunning}
            >
              清空列表
            </button>
          </div>
          <ul className="exifedit__batch-files">
            {batchFiles.map((f, idx) => (
              <li key={idx} className="exifedit__batch-file">
                <span className="exifedit__batch-file-name">{f.name}</span>
                <span className="exifedit__batch-file-size">{formatBytes(f.size)}</span>
                <button
                  type="button"
                  className="exifedit__batch-file-remove"
                  onClick={() => onRemoveBatchFile(idx)}
                  disabled={batchRunning}
                  aria-label={`移除 ${f.name}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="exifedit__actions">
            <button
              type="button"
              className="exifedit__btn exifedit__btn--primary"
              onClick={onRunBatchEdit}
              disabled={batchRunning || batchFiles.length === 0 || activeOps.length === 0}
            >
              {batchRunning ? `处理中...（${batchResult?.total ?? 0}/${batchFiles.length}）` : `执行批量编辑（${batchFiles.length} 个文件）`}
            </button>
          </div>
        </div>
      )}

      {/* 批量处理结果 */}
      {batchResult && (
        <div className="exifedit__batch-result">
          <h3 className="exifedit__section-title">批量处理结果</h3>
          <div className="exifedit__summary">
            <div className="exifedit__summary-item">
              <span className="exifedit__summary-label">总文件数</span>
              <span className="exifedit__summary-value">{batchResult.total}</span>
            </div>
            <div className="exifedit__summary-item">
              <span className="exifedit__summary-label">成功</span>
              <span className="exifedit__summary-value exifedit__summary-value--good">
                {batchResult.succeeded}
              </span>
            </div>
            <div className="exifedit__summary-item">
              <span className="exifedit__summary-label">跳过</span>
              <span className="exifedit__summary-value">{batchResult.skipped}</span>
            </div>
            <div className="exifedit__summary-item">
              <span className="exifedit__summary-label">失败</span>
              <span className="exifedit__summary-value exifedit__summary-value--bad">
                {batchResult.failed}
              </span>
            </div>
            <div className="exifedit__summary-item">
              <span className="exifedit__summary-label">总节省</span>
              <span className="exifedit__summary-value exifedit__summary-value--good">
                {batchResult.totalSavedBytes > 0 ? `-${formatBytes(batchResult.totalSavedBytes)}` : '0 B'}
              </span>
            </div>
            <div className="exifedit__summary-item">
              <span className="exifedit__summary-label">总耗时</span>
              <span className="exifedit__summary-value">{batchResult.totalElapsedMs.toFixed(0)} ms</span>
            </div>
          </div>

          {/* 单文件结果列表 */}
          <ul className="exifedit__batch-items">
            {batchResult.items.map((it, idx) => (
              <li
                key={idx}
                className={`exifedit__batch-item exifedit__batch-item--${it.status}`}
              >
                <span className="exifedit__batch-item-name">{it.fileName}</span>
                <span className="exifedit__batch-item-status">
                  {it.status === 'success' && it.result
                    ? `✓ 成功 · 节省 ${formatBytes(it.result.savedBytes)} · ${it.result.elapsedMs.toFixed(0)}ms`
                    : it.status === 'skipped'
                    ? `⚠ 跳过 · ${it.message ?? ''}`
                    : `✗ 失败 · ${it.message ?? '未知错误'}`}
                </span>
              </li>
            ))}
          </ul>

          {/* 下载 ZIP 按钮 */}
          {batchResult.succeeded > 0 && (
            <button
              type="button"
              className="exifedit__btn exifedit__btn--primary exifedit__btn--download"
              onClick={onDownloadBatchZip}
            >
              ⬇ 下载全部成功结果为 ZIP（{batchResult.succeeded} 个文件）
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// 预设管理面板（第 89 轮新增）
// ============================================================

interface PresetPanelProps {
  /** 已保存的预设列表 */
  presets: EditPreset[];
  /** 当前输入的预设名称 */
  presetName: string;
  /** 预设错误信息 */
  presetError: string;
  /** 导入文件输入 ref */
  importInputRef: React.RefObject<HTMLInputElement>;
  /** 当前生效的操作数量（用于禁用保存按钮） */
  activeOpsCount: number;
  /** 预设名称变更回调 */
  onPresetNameChange: (name: string) => void;
  /** 保存预设回调 */
  onSavePreset: () => void;
  /** 应用预设回调 */
  onApplyPreset: (preset: EditPreset) => void;
  /** 删除预设回调 */
  onDeletePreset: (presetId: string) => void;
  /** 导出预设回调 */
  onExportPresets: () => void;
  /** 导入预设回调 */
  onImportPresets: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

/** 预设管理面板：保存/加载/删除/导入/导出编辑组合 */
function PresetPanel(props: PresetPanelProps) {
  const {
    presets,
    presetName,
    presetError,
    importInputRef,
    activeOpsCount,
    onPresetNameChange,
    onSavePreset,
    onApplyPreset,
    onDeletePreset,
    onExportPresets,
    onImportPresets,
  } = props;

  return (
    <div className="exifedit__presets">
      <h3 className="exifedit__section-title">编辑预设</h3>
      <p className="exifedit__hint">
        保存常用的编辑操作组合，下次一键加载。预设存储在浏览器本地（localStorage），不会上传。
      </p>

      {/* 保存当前组合 */}
      <div className="exifedit__preset-save">
        <input
          type="text"
          className="exifedit__preset-name-input"
          value={presetName}
          onChange={(e) => onPresetNameChange(e.target.value)}
          placeholder="输入预设名称（如：分享前清理 GPS）"
          aria-label="预设名称"
          maxLength={40}
        />
        <button
          type="button"
          className="exifedit__btn exifedit__btn--primary"
          onClick={onSavePreset}
          disabled={activeOpsCount === 0 || !presetName.trim()}
        >
          保存当前组合
        </button>
      </div>

      {/* 错误提示 */}
      {presetError && (
        <div className="exifedit__error" role="alert">
          {presetError}
        </div>
      )}

      {/* 预设列表 */}
      {presets.length === 0 ? (
        <p className="exifedit__hint exifedit__hint--muted">暂无已保存的预设。</p>
      ) : (
        <ul className="exifedit__preset-list">
          {presets.map((preset) => (
            <li key={preset.id} className="exifedit__preset-item">
              <div className="exifedit__preset-info">
                <div className="exifedit__preset-name">{preset.name}</div>
                <div className="exifedit__preset-ops">
                  {preset.operations.map((op, idx) => {
                    const meta = EDIT_OPERATIONS.find((m) => m.type === op.type);
                    return (
                      <span key={idx} className="exifedit__preset-op-tag">
                        {meta?.label ?? op.type}
                      </span>
                    );
                  })}
                </div>
                <div className="exifedit__preset-meta">
                  创建于 {new Date(preset.createdAt).toLocaleDateString('zh-CN')} ·
                  最近使用 {new Date(preset.lastUsedAt).toLocaleDateString('zh-CN')}
                </div>
              </div>
              <div className="exifedit__preset-actions">
                <button
                  type="button"
                  className="exifedit__btn exifedit__btn--small"
                  onClick={() => onApplyPreset(preset)}
                >
                  应用
                </button>
                <button
                  type="button"
                  className="exifedit__btn exifedit__btn--small exifedit__btn--danger"
                  onClick={() => onDeletePreset(preset.id)}
                  aria-label={`删除预设 ${preset.name}`}
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* 导入/导出 */}
      <div className="exifedit__preset-io">
        <button
          type="button"
          className="exifedit__btn"
          onClick={onExportPresets}
          disabled={presets.length === 0}
        >
          导出全部预设
        </button>
        <button
          type="button"
          className="exifedit__btn"
          onClick={() => importInputRef.current?.click()}
        >
          导入预设
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          onChange={onImportPresets}
          className="exifedit__file-input"
          aria-label="选择预设 JSON 文件"
        />
      </div>
    </div>
  );
}
