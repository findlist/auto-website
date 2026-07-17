import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  type SourceImage,
  type OutputMime,
  type CropRect,
  type HandleCode,
  type AspectRatioCode,
  type CropResult,
  type OutputShape,
  type BatchCropItem,
  HistoryStack,
  ASPECT_RATIOS,
  HANDLES,
  OUTPUT_FORMATS,
  OUTPUT_SHAPES,
  ACCEPTED_INPUT_MIMES,
  MAX_BATCH_COUNT,
  DEFAULT_CROP_OPTIONS,
  PRESET_SIZES,
  loadImage,
  cropImage,
  cropBatch,
  downloadBatch,
  downloadBatchAsZip,
  detectAllEncodeSupport,
  formatBytes,
  downloadBlob,
  buildCropFilename,
  computeInitialRect,
  clampRect,
  applyAspectRatio,
  resizeRect,
  moveRect,
  MIN_CROP_SIZE,
} from '../utils/imageCrop';

/**
 * 图片裁剪工具
 *
 * 全部在浏览器本地用 Canvas API + drawImage 源矩形参数处理，不发起任何网络请求。
 *
 * 核心能力：
 *  - 多种裁剪比例：自由 / 1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 3:2 / 2:3 / 自定义
 *  - 可视化裁剪框：8 个手柄调整大小，整体可拖动
 *  - 数值精确输入 + 快捷按钮（居中、重置、全图）
 *  - 多格式导出：PNG / JPEG / WebP / AVIF（受浏览器编码能力限制）
 */

/** 当前拖拽操作的类型 */
type DragMode = 'move' | HandleCode;

/** 拖拽起始状态 */
interface DragStart {
  mouseX: number;
  mouseY: number;
  rect: CropRect;
}

export default function ImageCropTool() {
  /** 工作模式：单图精细裁剪 / 批量统一裁剪 */
  const [mode, setMode] = useState<'single' | 'batch'>('single');
  const [source, setSource] = useState<SourceImage | null>(null);
  const [rect, setRect] = useState<CropRect>({ x: 0, y: 0, width: 0, height: 0 });
  const [aspectCode, setAspectCode] = useState<AspectRatioCode>('free');
  const [customRatioW, setCustomRatioW] = useState(4);
  const [customRatioH, setCustomRatioH] = useState(3);
  const [exportCfg, setExportCfg] = useState({ ...DEFAULT_CROP_OPTIONS });
  const [encodeSupport, setEncodeSupport] = useState<Record<OutputMime, boolean>>({
    'image/avif': false,
    'image/webp': true,
    'image/jpeg': true,
    'image/png': true,
  });
  const [result, setResult] = useState<CropResult | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [dragMode, setDragMode] = useState<DragMode | null>(null);
  const [dragStart, setDragStart] = useState<DragStart | null>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);

  /** 批量模式专属状态 */
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchItems, setBatchItems] = useState<BatchCropItem[]>([]);
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [batchZipping, setBatchZipping] = useState(false);
  const batchFileInputRef = useRef<HTMLInputElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  /** 显示尺寸（容器内实际渲染宽高） */
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });

  /** 裁剪矩形历史栈：用于撤销 / 重做，最大 30 步 */
  const historyRef = useRef<HistoryStack<CropRect>>(new HistoryStack<CropRect>(30));
  /** 同步跟踪最新 rect，便于在事件回调中读取（避免 setRect 副作用） */
  const rectRef = useRef<CropRect>({ x: 0, y: 0, width: 0, height: 0 });
  const [historyVersion, setHistoryVersion] = useState(0);
  /** 历史栈可操作状态（基于 historyVersion 触发重渲染） */
  const historyState = useMemo(() => ({
    canUndo: historyRef.current.canUndo(),
    canRedo: historyRef.current.canRedo(),
  }), [historyVersion]);

  /** 是否显示九宫格构图辅助线（仅影响视觉，不参与裁剪计算） */
  const [showGrid, setShowGrid] = useState(true);

  /**
   * 记录历史并设置新 rect：用户主动操作时使用
   * - 先把「当前 rect」推入历史栈，再设置新 rect
   * - 内部状态联动（如 applyAspectRatio）使用 setRect 不记录历史
   */
  const setRectWithHistory = useCallback((next: CropRect | ((prev: CropRect) => CropRect)) => {
    setRect((prev) => {
      const resolved = typeof next === 'function' ? (next as (p: CropRect) => CropRect)(prev) : next;
      historyRef.current.push(resolved);
      rectRef.current = resolved;
      setHistoryVersion((v) => v + 1);
      return resolved;
    });
    setResult(null);
  }, []);

  /** 撤销：从历史栈取上一个状态，不记录历史 */
  const undoRect = useCallback(() => {
    const prev = historyRef.current.undo();
    if (prev) {
      rectRef.current = prev;
      setRect(prev);
      setResult(null);
      setHistoryVersion((v) => v + 1);
    }
  }, []);

  /** 重做：从历史栈取下一个状态，不记录历史 */
  const redoRect = useCallback(() => {
    const next = historyRef.current.redo();
    if (next) {
      rectRef.current = next;
      setRect(next);
      setResult(null);
      setHistoryVersion((v) => v + 1);
    }
  }, []);

  /** 同步 rect 到 rectRef，便于事件回调读取最新值 */
  useEffect(() => {
    rectRef.current = rect;
  }, [rect]);

  /** 组件挂载时探测浏览器编码支持 */
  useEffect(() => {
    detectAllEncodeSupport().then(setEncodeSupport).catch(() => undefined);
  }, []);

  /** 当前生效的比例值（自由 = null，自定义 = customRatioW/customRatioH，其他 = 预设） */
  const currentRatio = useMemo(() => {
    if (aspectCode === 'free') return null;
    if (aspectCode === 'custom') {
      if (customRatioH <= 0) return null;
      return customRatioW / customRatioH;
    }
    const meta = ASPECT_RATIOS.find((r) => r.code === aspectCode);
    return meta?.ratio ?? null;
  }, [aspectCode, customRatioW, customRatioH]);

  /** 可选导出格式（仅显示浏览器支持的） */
  const availableFormats = useMemo(
    () => OUTPUT_FORMATS.filter((f) => encodeSupport[f.mime]),
    [encodeSupport],
  );

  /** 当前导出格式是否支持质量调节 */
  const qualityEditable = useMemo(() => {
    const meta = OUTPUT_FORMATS.find((f) => f.mime === exportCfg.format);
    return meta?.lossy ?? false;
  }, [exportCfg.format]);

  /** 图片加载完成后初始化裁剪矩形与显示尺寸 */
  useEffect(() => {
    if (!imgEl || !source) return;
    // 等待图片实际渲染完成
    const updateDisplay = () => {
      if (!imgEl || !source) return;
      const w = imgEl.clientWidth;
      const h = imgEl.clientHeight;
      if (w > 0 && h > 0) {
        setDisplaySize({ width: w, height: h });
      }
    };
    updateDisplay();
    // 监听容器尺寸变化（响应式）
    const observer = new ResizeObserver(updateDisplay);
    observer.observe(imgEl);
    return () => observer.disconnect();
  }, [imgEl, source]);

  /** 源坐标 → 显示坐标的缩放比 */
  const scale = useMemo(() => {
    if (!source || displaySize.width === 0) return 1;
    return displaySize.width / source.width;
  }, [source, displaySize]);

  /** 切换比例时重置裁剪矩形 */
  const handleAspectChange = useCallback(
    (code: AspectRatioCode) => {
      if (!source) return;
      setAspectCode(code);
      let ratio: number | null = null;
      if (code === 'custom') {
        if (customRatioH > 0) ratio = customRatioW / customRatioH;
      } else {
        const meta = ASPECT_RATIOS.find((r) => r.code === code);
        ratio = meta?.ratio ?? null;
      }
      const initial = computeInitialRect(source.width, source.height, ratio);
      setRectWithHistory(initial);
    },
    [source, customRatioW, customRatioH, setRectWithHistory],
  );

  /** 自定义比例变化时同步重置裁剪框 */
  const updateCustomRatio = useCallback(
    (which: 'w' | 'h', value: number) => {
      const w = which === 'w' ? Math.max(1, value) : customRatioW;
      const h = which === 'h' ? Math.max(1, value) : customRatioH;
      setCustomRatioW(w);
      setCustomRatioH(h);
      if (aspectCode === 'custom' && source) {
        const ratio = h > 0 ? w / h : null;
        const initial = computeInitialRect(source.width, source.height, ratio);
        setRectWithHistory(initial);
      }
    },
    [aspectCode, source, customRatioW, customRatioH, setRectWithHistory],
  );

  /** 当前选中的预设尺寸代码（用于高亮，null 表示未选） */
  const [activePreset, setActivePreset] = useState<string | null>(null);

  /**
   * 应用预设尺寸：一键切换比例 + 填充等比缩放目标尺寸
   * - 切换比例：联动裁剪框形状
   * - 填充 maxWidth/maxHeight：输出时等比缩放到目标尺寸
   * - 清除 activePreset 当用户手动改比例 / 自定义尺寸时
   */
  const applyPreset = useCallback(
    (preset: typeof PRESET_SIZES[number]) => {
      if (!source) return;
      setActivePreset(preset.code);
      // 切换比例（复用 handleAspectChange 逻辑）
      setAspectCode(preset.aspect);
      const meta = ASPECT_RATIOS.find((r) => r.code === preset.aspect);
      const ratio = meta?.ratio ?? null;
      const initial = computeInitialRect(source.width, source.height, ratio);
      setRectWithHistory(initial);
      // 填充等比缩放目标尺寸
      setExportCfg((p) => ({ ...p, maxWidth: preset.width, maxHeight: preset.height }));
    },
    [source, setRectWithHistory],
  );

  /** 用户手动切换比例时清除预设高亮 */
  const handleAspectChangeWithPreset = useCallback(
    (code: AspectRatioCode) => {
      setActivePreset(null);
      handleAspectChange(code);
    },
    [handleAspectChange],
  );

  /**
   * 切换输出形状
   * - 选择圆形时自动切换到 1:1 比例（保证正圆视觉）
   * - 选择矩形 / 圆角矩形时仅更新形状，不变比例
   */
  const handleShapeChange = useCallback(
    (shape: OutputShape) => {
      setExportCfg((p) => ({ ...p, shape }));
      if (shape === 'circle' && aspectCode !== '1:1' && source) {
        setActivePreset(null);
        setAspectCode('1:1');
        const initial = computeInitialRect(source.width, source.height, 1);
        setRectWithHistory(initial);
      } else {
        setResult(null);
      }
    },
    [aspectCode, source, setRectWithHistory],
  );

  /**
   * 批量模式：处理多文件选择
   * - 限制最大 MAX_BATCH_COUNT 张，超出的文件被截断并提示
   * - 仅接受 ACCEPTED_INPUT_MIMES 列出的图片类型
   */
  const handleBatchFiles = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const accepted = Array.from(fileList).filter((f) =>
      ACCEPTED_INPUT_MIMES.some((m) => f.type === m || f.name.toLowerCase().endsWith(m.split('/')[1])),
    );
    if (accepted.length === 0) {
      setError('未选中有效的图片文件，支持 PNG / JPEG / WebP / AVIF / GIF / BMP');
      return;
    }
    setError('');
    // 截断超出上限的部分
    const trimmed = accepted.slice(0, MAX_BATCH_COUNT);
    if (accepted.length > MAX_BATCH_COUNT) {
      setError(`单次最多处理 ${MAX_BATCH_COUNT} 张，已截断多余的 ${accepted.length - MAX_BATCH_COUNT} 张`);
    }
    // 清理旧结果
    batchItems.forEach((it) => {
      if (it.result) URL.revokeObjectURL(it.result.url);
    });
    setBatchFiles(trimmed);
    setBatchItems([]);
  }, [batchItems]);

  /** 批量模式：移除指定索引的文件 */
  const removeBatchFile = useCallback((index: number) => {
    setBatchFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /**
   * 批量模式：执行批量裁剪
   * - 按当前比例 + 形状 + 格式 + 质量统一处理所有文件
   * - 每张图按比例自动居中裁剪（不显示裁剪框）
   * - 顺序执行避免内存堆积，实时更新进度
   */
  const runBatchCrop = useCallback(async () => {
    if (batchFiles.length === 0) return;
    // 清理旧结果
    batchItems.forEach((it) => {
      if (it.result) URL.revokeObjectURL(it.result.url);
    });
    setBatchItems([]);
    setBatchProcessing(true);
    setBatchProgress({ current: 0, total: batchFiles.length });
    setError('');
    try {
      await cropBatch(
        batchFiles,
        { ...exportCfg },
        currentRatio,
        (index, total) => {
          setBatchProgress({ current: index + 1, total });
        },
      ).then((items) => {
        setBatchItems(items);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBatchProcessing(false);
    }
  }, [batchFiles, batchItems, exportCfg, currentRatio]);

  /** 批量模式：下载全部裁剪结果（逐个触发，200ms 间隔） */
  const downloadAllBatch = useCallback(async () => {
    if (batchItems.length === 0) return;
    setBatchDownloading(true);
    try {
      await downloadBatch(batchItems);
    } finally {
      setBatchDownloading(false);
    }
  }, [batchItems]);

  /** 批量模式：清空全部文件与结果 */
  const clearBatch = useCallback(() => {
    batchItems.forEach((it) => {
      if (it.result) URL.revokeObjectURL(it.result.url);
    });
    setBatchFiles([]);
    setBatchItems([]);
    setBatchProgress({ current: 0, total: 0 });
    setError('');
    if (batchFileInputRef.current) batchFileInputRef.current.value = '';
  }, [batchItems]);

  /** 批量拖拽事件 */
  const onBatchDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }, []);
  const onBatchDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }, []);
  const onBatchDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      handleBatchFiles(e.dataTransfer.files);
    },
    [handleBatchFiles],
  );

  /** 处理图片文件选择 */
  const handleFile = useCallback(async (file: File) => {
    setError('');
    try {
      const src = await loadImage(file);
      setSource(src);
      const initial = computeInitialRect(src.width, src.height, null);
      // 新图片载入：重置历史栈，仅保留初始状态
      historyRef.current.reset(initial);
      rectRef.current = initial;
      setHistoryVersion((v) => v + 1);
      setRect(initial);
      setResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  /** 拖拽事件 */
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  /** 粘贴事件 */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const list = e.clipboardData?.items;
      if (!list) return;
      for (const item of list) {
        if (item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) {
            handleFile(f);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleFile]);

  /** 鼠标按下：开始拖拽（移动或调整手柄） */
  const startDrag = useCallback(
    (mode: DragMode) => (e: React.MouseEvent) => {
      if (!source) return;
      e.preventDefault();
      e.stopPropagation();
      setDragMode(mode);
      setDragStart({
        mouseX: e.clientX,
        mouseY: e.clientY,
        rect: { ...rect },
      });
    },
    [source, rect],
  );

  /** 全局鼠标移动：处理拖拽逻辑 */
  useEffect(() => {
    if (!dragMode || !dragStart || !source) return;
    const onMove = (e: MouseEvent) => {
      const dx = (e.clientX - dragStart.mouseX) / scale;
      const dy = (e.clientY - dragStart.mouseY) / scale;
      if (dragMode === 'move') {
        const next = moveRect(dragStart.rect, dx, dy, source.width, source.height);
        setRect(next);
      } else {
        const next = resizeRect(
          dragStart.rect,
          dragMode,
          dx,
          dy,
          currentRatio,
          source.width,
          source.height,
        );
        setRect(next);
      }
    };
    const onUp = () => {
      setDragMode(null);
      setDragStart(null);
      // 拖拽结束：把当前 rect 推入历史栈（一次拖拽作为一个原子操作）
      // rectRef 已在 useEffect 中同步为最新值
      historyRef.current.push(rectRef.current);
      setHistoryVersion((v) => v + 1);
      setResult(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragMode, dragStart, source, scale, currentRatio]);

  /** 数值输入：精确设置 x/y/width/height */
  const updateRectValue = useCallback(
    (key: keyof CropRect, raw: number) => {
      if (!source) return;
      const value = Math.max(0, Math.round(raw));
      const next = clampRect({ ...rect, [key]: value }, source.width, source.height);
      const finalNext = currentRatio
        ? applyAspectRatio(next, currentRatio, source.width, source.height)
        : next;
      setRectWithHistory(finalNext);
    },
    [source, rect, currentRatio, setRectWithHistory],
  );

  /** 快捷操作：居中、重置、全图 */
  const centerRect = useCallback(() => {
    if (!source) return;
    const next = clampRect(
      {
        x: Math.round((source.width - rect.width) / 2),
        y: Math.round((source.height - rect.height) / 2),
        width: rect.width,
        height: rect.height,
      },
      source.width,
      source.height,
    );
    setRectWithHistory(next);
  }, [source, rect, setRectWithHistory]);

  const resetRect = useCallback(() => {
    if (!source) return;
    const initial = computeInitialRect(source.width, source.height, currentRatio);
    setRectWithHistory(initial);
  }, [source, currentRatio, setRectWithHistory]);

  const selectAll = useCallback(() => {
    if (!source) return;
    setRectWithHistory({ x: 0, y: 0, width: source.width, height: source.height });
  }, [source, setRectWithHistory]);

  /** 执行裁剪并生成结果 */
  const runCrop = useCallback(async () => {
    if (!source) return;
    setError('');
    try {
      const r = await cropImage(source, { ...exportCfg, rect });
      setResult((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return r;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [source, exportCfg, rect]);

  /** 下载结果 */
  const handleDownload = useCallback(() => {
    if (!result || !source) return;
    downloadBlob(result.url, buildCropFilename(source.file.name, result.mime));
  }, [result, source]);

  /** 清空全部 */
  const handleReset = useCallback(() => {
    if (source) URL.revokeObjectURL(source.url);
    if (result) URL.revokeObjectURL(result.url);
    setSource(null);
    setResult(null);
    setRect({ x: 0, y: 0, width: 0, height: 0 });
    rectRef.current = { x: 0, y: 0, width: 0, height: 0 };
    historyRef.current.clear();
    setHistoryVersion((v) => v + 1);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [source, result]);

  /** 批量模式：打包为 ZIP 下载 */
  const downloadAllAsZip = useCallback(async () => {
    if (batchItems.length === 0) return;
    setBatchZipping(true);
    try {
      const now = new Date();
      const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      await downloadBatchAsZip(batchItems, `cropped-${ts}.zip`);
    } finally {
      setBatchZipping(false);
    }
  }, [batchItems]);

  /** 键盘快捷键：Ctrl/Cmd + Z 撤销，Ctrl/Cmd + Shift + Z 或 Ctrl+Y 重做 */
  useEffect(() => {
    if (!source || mode !== 'single') return;
    const onKey = (e: KeyboardEvent) => {
      const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z');
      const isRedo = (e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y' || ((e.shiftKey) && (e.key === 'z' || e.key === 'Z')));
      if (isUndo) {
        e.preventDefault();
        undoRect();
      } else if (isRedo) {
        e.preventDefault();
        redoRect();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [source, mode, undoRect, redoRect]);

  /** 卸载时清理所有 URL（单图 + 批量） */
  useEffect(() => {
    return () => {
      if (source) URL.revokeObjectURL(source.url);
      if (result) URL.revokeObjectURL(result.url);
      batchItems.forEach((it) => {
        if (it.result) URL.revokeObjectURL(it.result.url);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 拖拽中的视觉反馈 */
  const draggingClass = dragMode ? ' imcrop__canvas--dragging' : '';

  return (
    <div className="imcrop">
      {/* 模式切换 Tab：单图精细裁剪 / 批量统一裁剪 */}
      <div className="imcrop__mode-tabs" role="tablist" aria-label="工作模式">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'single'}
          className={`imcrop__mode-tab${mode === 'single' ? ' imcrop__mode-tab--active' : ''}`}
          onClick={() => setMode('single')}
        >
          单图精细裁剪
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'batch'}
          className={`imcrop__mode-tab${mode === 'batch' ? ' imcrop__mode-tab--active' : ''}`}
          onClick={() => setMode('batch')}
        >
          批量统一裁剪
        </button>
      </div>

      {mode === 'single' && (
        <>
      {/* 上传区 */}
      {!source && (
        <div
          className={`imcrop__dropzone${dragging ? ' imcrop__dropzone--active' : ''}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="点击或拖拽上传图片，也可按 Ctrl+V 粘贴"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
        >
          <div className="imcrop__dropzone-icon" aria-hidden="true">🖼️</div>
          <div className="imcrop__dropzone-text">点击上传、拖拽图片到此处或按 Ctrl+V 粘贴</div>
          <div className="imcrop__dropzone-hint">
            支持 PNG / JPEG / WebP / AVIF / GIF / BMP，单文件最大 20MB
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_INPUT_MIMES.join(',')}
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            hidden
          />
        </div>
      )}

      {error && mode === 'single' && <div className="imcrop__error" role="alert">{error}</div>}

      {/* 工作区 */}
      {source && (
        <div className="imcrop__workspace">
          {/* 左侧：原图与可视化裁剪框 */}
          <div className="imcrop__canvas-wrap">
            <div className="imcrop__canvas-header">
              <span className="imcrop__canvas-title">原图与裁剪框</span>
              <div className="imcrop__canvas-toolbar">
                <button
                  type="button"
                  className="imcrop__icon-btn"
                  onClick={undoRect}
                  disabled={!historyState.canUndo}
                  title="撤销 (Ctrl+Z)"
                  aria-label="撤销"
                >
                  ↶
                </button>
                <button
                  type="button"
                  className="imcrop__icon-btn"
                  onClick={redoRect}
                  disabled={!historyState.canRedo}
                  title="重做 (Ctrl+Shift+Z)"
                  aria-label="重做"
                >
                  ↷
                </button>
                <button
                  type="button"
                  className={`imcrop__icon-btn${showGrid ? ' imcrop__icon-btn--active' : ''}`}
                  onClick={() => setShowGrid((v) => !v)}
                  title="九宫格构图辅助线"
                  aria-label="切换九宫格辅助线"
                  aria-pressed={showGrid}
                >
                  ▦
                </button>
                <span className="imcrop__canvas-meta">
                  {source.width}×{source.height}px · {formatBytes(source.file.size)}
                </span>
              </div>
            </div>
            <div ref={imageContainerRef} className={`imcrop__canvas${draggingClass}`}>
              <img
                ref={setImgEl}
                src={source.url}
                alt="待裁剪原图"
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setDisplaySize({ width: img.clientWidth, height: img.clientHeight });
                }}
                draggable={false}
              />
              {/* 裁剪框：基于显示坐标计算位置 */}
              <div
                className="imcrop__crop-box"
                style={{
                  left: rect.x * scale,
                  top: rect.y * scale,
                  width: rect.width * scale,
                  height: rect.height * scale,
                }}
                onMouseDown={startDrag('move')}
              >
                {/* 九宫格构图辅助线：3×3 等分线，摄影构图常用 */}
                {showGrid && (
                  <div className="imcrop__grid" aria-hidden="true">
                    <div className="imcrop__grid-line imcrop__grid-line--v" style={{ left: '33.333%' }} />
                    <div className="imcrop__grid-line imcrop__grid-line--v" style={{ left: '66.666%' }} />
                    <div className="imcrop__grid-line imcrop__grid-line--h" style={{ top: '33.333%' }} />
                    <div className="imcrop__grid-line imcrop__grid-line--h" style={{ top: '66.666%' }} />
                  </div>
                )}
                {/* 8 个调整手柄 */}
                {HANDLES.map((h) => (
                  <div
                    key={h.code}
                    className={`imcrop__handle imcrop__handle--${h.code}`}
                    style={{ cursor: h.cursor }}
                    onMouseDown={startDrag(h.code)}
                    aria-label={`调整${h.label}方向`}
                    role="button"
                  />
                ))}
                {/* 中心十字提示（仅在拖拽时显示） */}
                {dragMode && (
                  <div className="imcrop__crop-center" aria-hidden="true">
                    <span className="imcrop__crop-size">
                      {rect.width} × {rect.height}
                    </span>
                  </div>
                )}
              </div>
              {/* 半透明遮罩（4 块，围绕裁剪框） */}
              <div
                className="imcrop__mask imcrop__mask--top"
                style={{ height: rect.y * scale }}
                aria-hidden="true"
              />
              <div
                className="imcrop__mask imcrop__mask--bottom"
                style={{
                  top: (rect.y + rect.height) * scale,
                  height: displaySize.height - (rect.y + rect.height) * scale,
                }}
                aria-hidden="true"
              />
              <div
                className="imcrop__mask imcrop__mask--left"
                style={{
                  top: rect.y * scale,
                  height: rect.height * scale,
                  width: rect.x * scale,
                }}
                aria-hidden="true"
              />
              <div
                className="imcrop__mask imcrop__mask--right"
                style={{
                  top: rect.y * scale,
                  height: rect.height * scale,
                  left: (rect.x + rect.width) * scale,
                  width: displaySize.width - (rect.x + rect.width) * scale,
                }}
                aria-hidden="true"
              />
            </div>
            <div className="imcrop__canvas-hint">
              拖动裁剪框移动位置，拖动 8 个手柄调整大小。所有操作均在浏览器本地完成。
            </div>
          </div>

          {/* 右侧：配置与预览 */}
          <div className="imcrop__panel">
            {/* 预设尺寸：社交媒体常用尺寸一键应用 */}
            <div className="imcrop__field-group">
              <span className="imcrop__field-label">预设尺寸</span>
              <div className="imcrop__preset-grid" role="group" aria-label="预设尺寸">
                {PRESET_SIZES.map((p) => (
                  <button
                    key={p.code}
                    type="button"
                    className={`imcrop__preset-item${activePreset === p.code ? ' imcrop__preset-item--active' : ''}`}
                    title={p.desc}
                    onClick={() => applyPreset(p)}
                  >
                    <span className="imcrop__preset-label">{p.label}</span>
                    <span className="imcrop__preset-size">{p.width}×{p.height}</span>
                  </button>
                ))}
              </div>
              <div className="imcrop__hint-text">
                点击预设自动切换比例并填充目标输出尺寸；手动调整比例或尺寸将清除高亮
              </div>
            </div>

            {/* 比例选择 */}
            <div className="imcrop__field-group">
              <span className="imcrop__field-label">裁剪比例</span>
              <div className="imcrop__ratio-grid" role="radiogroup" aria-label="裁剪比例">
                {ASPECT_RATIOS.map((r) => (
                  <label
                    key={r.code}
                    className={`imcrop__ratio-item${aspectCode === r.code ? ' imcrop__ratio-item--active' : ''}`}
                    title={r.desc}
                  >
                    <input
                      type="radio"
                      name="aspect"
                      value={r.code}
                      checked={aspectCode === r.code}
                      onChange={() => handleAspectChangeWithPreset(r.code)}
                    />
                    <span>{r.label}</span>
                  </label>
                ))}
              </div>
              {aspectCode === 'custom' && (
                <div className="imcrop__custom-ratio">
                  <label className="imcrop__field-label" htmlFor="ratio-w">宽</label>
                  <input
                    id="ratio-w"
                    type="number"
                    min={1}
                    max={100}
                    value={customRatioW}
                    onChange={(e) => updateCustomRatio('w', Number(e.target.value))}
                    className="imcrop__number-input"
                  />
                  <span className="imcrop__ratio-sep">:</span>
                  <label className="imcrop__field-label" htmlFor="ratio-h">高</label>
                  <input
                    id="ratio-h"
                    type="number"
                    min={1}
                    max={100}
                    value={customRatioH}
                    onChange={(e) => updateCustomRatio('h', Number(e.target.value))}
                    className="imcrop__number-input"
                  />
                </div>
              )}
            </div>

            {/* 数值精确输入 */}
            <div className="imcrop__field-group">
              <span className="imcrop__field-label">裁剪区域</span>
              <div className="imcrop__rect-inputs">
                <div className="imcrop__field-inline">
                  <label className="imcrop__mini-label" htmlFor="rect-x">X</label>
                  <input
                    id="rect-x"
                    type="number"
                    min={0}
                    max={source.width}
                    value={Math.round(rect.x)}
                    onChange={(e) => updateRectValue('x', Number(e.target.value))}
                    className="imcrop__number-input"
                  />
                  <span className="imcrop__field-unit">px</span>
                </div>
                <div className="imcrop__field-inline">
                  <label className="imcrop__mini-label" htmlFor="rect-y">Y</label>
                  <input
                    id="rect-y"
                    type="number"
                    min={0}
                    max={source.height}
                    value={Math.round(rect.y)}
                    onChange={(e) => updateRectValue('y', Number(e.target.value))}
                    className="imcrop__number-input"
                  />
                  <span className="imcrop__field-unit">px</span>
                </div>
                <div className="imcrop__field-inline">
                  <label className="imcrop__mini-label" htmlFor="rect-w">宽</label>
                  <input
                    id="rect-w"
                    type="number"
                    min={MIN_CROP_SIZE}
                    max={source.width}
                    value={Math.round(rect.width)}
                    onChange={(e) => updateRectValue('width', Number(e.target.value))}
                    className="imcrop__number-input"
                  />
                  <span className="imcrop__field-unit">px</span>
                </div>
                <div className="imcrop__field-inline">
                  <label className="imcrop__mini-label" htmlFor="rect-h">高</label>
                  <input
                    id="rect-h"
                    type="number"
                    min={MIN_CROP_SIZE}
                    max={source.height}
                    value={Math.round(rect.height)}
                    onChange={(e) => updateRectValue('height', Number(e.target.value))}
                    className="imcrop__number-input"
                  />
                  <span className="imcrop__field-unit">px</span>
                </div>
              </div>
              <div className="imcrop__quick-actions">
                <button type="button" className="imcrop__btn imcrop__btn--ghost imcrop__btn--small" onClick={centerRect}>
                  居中
                </button>
                <button type="button" className="imcrop__btn imcrop__btn--ghost imcrop__btn--small" onClick={resetRect}>
                  重置
                </button>
                <button type="button" className="imcrop__btn imcrop__btn--ghost imcrop__btn--small" onClick={selectAll}>
                  全图
                </button>
              </div>
            </div>

            {/* 输出形状：矩形 / 圆形 / 圆角矩形 */}
            <div className="imcrop__field-group">
              <span className="imcrop__field-label">输出形状</span>
              <div className="imcrop__shape-options" role="radiogroup" aria-label="输出形状">
                {OUTPUT_SHAPES.map((s) => (
                  <label
                    key={s.code}
                    className={`imcrop__shape-item${exportCfg.shape === s.code ? ' imcrop__shape-item--active' : ''}`}
                    title={s.desc}
                  >
                    <input
                      type="radio"
                      name="output-shape"
                      value={s.code}
                      checked={exportCfg.shape === s.code}
                      onChange={() => handleShapeChange(s.code)}
                    />
                    <span className="imcrop__shape-icon" aria-hidden="true">
                      {s.code === 'rect' && '▭'}
                      {s.code === 'circle' && '◯'}
                      {s.code === 'rounded' && '▢'}
                    </span>
                    <span>{s.label}</span>
                  </label>
                ))}
              </div>
              {exportCfg.shape === 'circle' && (
                <div className="imcrop__hint-text">
                  圆形裁剪会自动锁定 1:1 比例；导出 PNG / WebP / AVIF 可保留圆外透明，JPEG 会填充背景色
                </div>
              )}
              {exportCfg.shape === 'rounded' && (
                <div className="imcrop__hint-text">
                  圆角半径取较短边的 1/4；导出 PNG / WebP / AVIF 可保留圆角外透明，JPEG 会填充背景色
                </div>
              )}
            </div>

            {/* 导出格式 */}
            <div className="imcrop__field-group">
              <span className="imcrop__field-label">导出格式</span>
              <div className="imcrop__format-options">
                {availableFormats.map((opt) => (
                  <label
                    key={opt.mime}
                    className={`imcrop__format-item${exportCfg.format === opt.mime ? ' imcrop__format-item--active' : ''}`}
                  >
                    <input
                      type="radio"
                      name="export-format"
                      value={opt.mime}
                      checked={exportCfg.format === opt.mime}
                      onChange={() => setExportCfg((p) => ({ ...p, format: opt.mime }))}
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* 质量调节（仅 lossy 格式） */}
            {qualityEditable && (
              <div className="imcrop__field-group">
                <label className="imcrop__field-label" htmlFor="quality">
                  压缩质量
                  <span className="imcrop__field-value">{exportCfg.quality}%</span>
                </label>
                <input
                  id="quality"
                  type="range"
                  min={1}
                  max={100}
                  value={exportCfg.quality}
                  onChange={(e) => setExportCfg((p) => ({ ...p, quality: Number(e.target.value) }))}
                  className="imcrop__slider"
                  aria-label="压缩质量"
                />
              </div>
            )}

            {/* 等比缩放（可选） */}
            <div className="imcrop__field-group">
              <span className="imcrop__field-label">等比缩放（不放大）</span>
              <div className="imcrop__rect-inputs">
                <div className="imcrop__field-inline">
                  <label className="imcrop__mini-label" htmlFor="max-w">最大宽</label>
                  <input
                    id="max-w"
                    type="number"
                    min={0}
                    value={exportCfg.maxWidth}
                    onChange={(e) => {
                      setActivePreset(null);
                      setExportCfg((p) => ({ ...p, maxWidth: Math.max(0, Number(e.target.value)) }));
                    }}
                    className="imcrop__number-input"
                  />
                  <span className="imcrop__field-unit">px</span>
                </div>
                <div className="imcrop__field-inline">
                  <label className="imcrop__mini-label" htmlFor="max-h">最大高</label>
                  <input
                    id="max-h"
                    type="number"
                    min={0}
                    value={exportCfg.maxHeight}
                    onChange={(e) => {
                      setActivePreset(null);
                      setExportCfg((p) => ({ ...p, maxHeight: Math.max(0, Number(e.target.value)) }));
                    }}
                    className="imcrop__number-input"
                  />
                  <span className="imcrop__field-unit">px</span>
                </div>
              </div>
              <div className="imcrop__hint-text">填 0 表示不限制；用于裁剪后缩小输出尺寸</div>
            </div>

            {/* 操作按钮 */}
            <div className="imcrop__actions">
              <button type="button" className="imcrop__btn imcrop__btn--primary" onClick={runCrop}>
                执行裁剪
              </button>
              <button type="button" className="imcrop__btn imcrop__btn--ghost" onClick={handleReset}>
                清空
              </button>
            </div>

            {/* 结果预览 */}
            {result && (
              <div className="imcrop__result">
                <div className="imcrop__result-header">
                  <span className="imcrop__result-title">裁剪结果</span>
                  <span className="imcrop__result-meta">
                    {result.width}×{result.height}px · {formatBytes(result.size)} · {result.elapsedMs}ms
                  </span>
                </div>
                <div className="imcrop__result-preview">
                  <img src={result.url} alt="裁剪结果预览" />
                </div>
                <button
                  type="button"
                  className="imcrop__btn imcrop__btn--primary imcrop__btn--block"
                  onClick={handleDownload}
                >
                  下载裁剪结果
                </button>
              </div>
            )}
          </div>
        </div>
      )}
        </>
      )}

      {/* 批量模式：多文件统一裁剪 */}
      {mode === 'batch' && (
        <div className="imcrop__batch">
          {error && <div className="imcrop__error" role="alert">{error}</div>}

          {/* 批量上传区 */}
          {batchFiles.length === 0 && (
            <div
              className={`imcrop__dropzone${dragging ? ' imcrop__dropzone--active' : ''}`}
              onDragOver={onBatchDragOver}
              onDragLeave={onBatchDragLeave}
              onDrop={onBatchDrop}
              onClick={() => batchFileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              aria-label="点击或拖拽上传多张图片进行批量裁剪"
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  batchFileInputRef.current?.click();
                }
              }}
            >
              <div className="imcrop__dropzone-icon" aria-hidden="true">📁</div>
              <div className="imcrop__dropzone-text">点击上传或拖拽多张图片到此处</div>
              <div className="imcrop__dropzone-hint">
                支持 PNG / JPEG / WebP / AVIF / GIF / BMP，单次最多 {MAX_BATCH_COUNT} 张，每张最大 20MB
              </div>
              <input
                ref={batchFileInputRef}
                type="file"
                accept={ACCEPTED_INPUT_MIMES.join(',')}
                multiple
                onChange={(e) => handleBatchFiles(e.target.files)}
                hidden
              />
            </div>
          )}

          {/* 批量配置摘要 + 文件列表 */}
          {batchFiles.length > 0 && (
            <>
              <div className="imcrop__batch-summary">
                <div className="imcrop__batch-summary-item">
                  <span className="imcrop__batch-summary-label">文件数</span>
                  <span className="imcrop__batch-summary-value">{batchFiles.length}</span>
                </div>
                <div className="imcrop__batch-summary-item">
                  <span className="imcrop__batch-summary-label">裁剪比例</span>
                  <span className="imcrop__batch-summary-value">
                    {aspectCode === 'free' ? '自由（最大化居中）' : aspectCode === 'custom' ? `${customRatioW}:${customRatioH}` : aspectCode}
                  </span>
                </div>
                <div className="imcrop__batch-summary-item">
                  <span className="imcrop__batch-summary-label">输出形状</span>
                  <span className="imcrop__batch-summary-value">
                    {OUTPUT_SHAPES.find((s) => s.code === exportCfg.shape)?.label}
                  </span>
                </div>
                <div className="imcrop__batch-summary-item">
                  <span className="imcrop__batch-summary-label">导出格式</span>
                  <span className="imcrop__batch-summary-value">
                    {OUTPUT_FORMATS.find((f) => f.mime === exportCfg.format)?.label}
                  </span>
                </div>
                {exportCfg.maxWidth > 0 && exportCfg.maxHeight > 0 && (
                  <div className="imcrop__batch-summary-item">
                    <span className="imcrop__batch-summary-label">目标尺寸</span>
                    <span className="imcrop__batch-summary-value">{exportCfg.maxWidth}×{exportCfg.maxHeight}</span>
                  </div>
                )}
              </div>

              {/* 批量操作按钮 */}
              <div className="imcrop__batch-actions">
                <button
                  type="button"
                  className="imcrop__btn imcrop__btn--primary"
                  onClick={runBatchCrop}
                  disabled={batchProcessing}
                >
                  {batchProcessing ? `处理中 ${batchProgress.current}/${batchProgress.total}` : '开始批量裁剪'}
                </button>
                {batchItems.some((it) => it.result) && (
                  <>
                    <button
                      type="button"
                      className="imcrop__btn imcrop__btn--ghost"
                      onClick={downloadAllBatch}
                      disabled={batchDownloading || batchZipping}
                    >
                      {batchDownloading ? '下载中...' : '逐个下载'}
                    </button>
                    <button
                      type="button"
                      className="imcrop__btn imcrop__btn--ghost"
                      onClick={downloadAllAsZip}
                      disabled={batchDownloading || batchZipping}
                      title="打包为 ZIP 文件下载，避免浏览器多文件下载拦截"
                    >
                      {batchZipping ? '打包中...' : '下载为 ZIP'}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="imcrop__btn imcrop__btn--ghost"
                  onClick={clearBatch}
                  disabled={batchProcessing || batchDownloading || batchZipping}
                >
                  清空
                </button>
                <button
                  type="button"
                  className="imcrop__btn imcrop__btn--ghost"
                  onClick={() => batchFileInputRef.current?.click()}
                  disabled={batchProcessing || batchDownloading || batchZipping}
                >
                  添加文件
                </button>
                <input
                  ref={batchFileInputRef}
                  type="file"
                  accept={ACCEPTED_INPUT_MIMES.join(',')}
                  multiple
                  onChange={(e) => {
                    // 追加文件（合并去重）
                    if (e.target.files) {
                      const newFiles = Array.from(e.target.files);
                      setBatchFiles((prev) => {
                        const merged = [...prev, ...newFiles].slice(0, MAX_BATCH_COUNT);
                        return merged;
                      });
                    }
                    if (batchFileInputRef.current) batchFileInputRef.current.value = '';
                  }}
                  hidden
                />
              </div>

              {/* 处理进度条 */}
              {batchProcessing && batchProgress.total > 0 && (
                <div className="imcrop__batch-progress">
                  <div
                    className="imcrop__batch-progress-bar"
                    style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                  />
                  <span className="imcrop__batch-progress-text">
                    {batchProgress.current} / {batchProgress.total}
                  </span>
                </div>
              )}

              {/* 文件列表 / 结果列表 */}
              <div className="imcrop__batch-list">
                {batchFiles.map((file, index) => {
                  const item = batchItems[index];
                  const hasResult = item?.result;
                  const hasError = item?.error;
                  return (
                    <div key={`${file.name}-${index}`} className="imcrop__batch-item">
                      <div className="imcrop__batch-item-info">
                        <span className="imcrop__batch-item-name" title={file.name}>{file.name}</span>
                        <span className="imcrop__batch-item-meta">
                          {formatBytes(file.size)}
                          {hasResult && ` · ${item.result!.width}×${item.result!.height}px · ${formatBytes(item.result!.size)}`}
                          {hasError && ` · 错误：${item.error}`}
                        </span>
                      </div>
                      <div className="imcrop__batch-item-actions">
                        {hasResult && (
                          <>
                            <img
                              src={item.result!.url}
                              alt={`${file.name} 裁剪结果`}
                              className="imcrop__batch-item-thumb"
                            />
                            <button
                              type="button"
                              className="imcrop__btn imcrop__btn--ghost imcrop__btn--small"
                              onClick={() => downloadBlob(item.result!.url, buildCropFilename(file.name, item.result!.mime))}
                            >
                              下载
                            </button>
                          </>
                        )}
                        {!hasResult && !hasError && (
                          <span className="imcrop__batch-item-status">
                            {batchProcessing ? '等待中' : '待处理'}
                          </span>
                        )}
                        {hasError && (
                          <span className="imcrop__batch-item-status imcrop__batch-item-status--error">失败</span>
                        )}
                        {!batchProcessing && !hasResult && (
                          <button
                            type="button"
                            className="imcrop__btn imcrop__btn--ghost imcrop__btn--small"
                            onClick={() => removeBatchFile(index)}
                            aria-label={`移除 ${file.name}`}
                          >
                            移除
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="imcrop__hint-text">
                批量模式按当前比例自动居中裁剪每张图片；如需精细调整单张图片的裁剪区域，请切换到「单图精细裁剪」模式
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
