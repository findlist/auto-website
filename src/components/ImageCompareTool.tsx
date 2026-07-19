import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  loadImage,
  compareImagesDiffWithRegions,
  compareImagePairsBatch,
  pairFilesSequentially,
  pairFilesByNamePrefix,
  buildDiffExportJson,
  buildBatchExportJson,
  buildBatchDiffImagesZip,
  composeSideBySide,
  formatBytes,
  extractRegionDataUrl,
  composeTripleImages,
  ACCEPTED_MIMES,
  DEFAULT_GRID_SIZE,
  MAX_BATCH_PAIRS,
  type SourceImage,
  type CompareMode,
  type DiffRegion,
  type DiffResultWithRegions,
  type BatchCompareSummary,
  type FilePairResult,
  type PrefixGroup,
} from '../utils/imageCompare';
import { downloadBlob, downloadDataUrl, downloadText } from '../utils/download';

/** 应用模式：单图对比 / 批量对比 */
type AppMode = 'single' | 'batch';

/** 批量对比的配对模式：顺序配对 / 前缀配对 */
type PairMode = 'sequential' | 'prefix';

/**
 * 图片对比工具
 *
 * 三种对比模式：
 *  - side-by-side：左右并排展示，可下载合成图
 *  - overlay-slider：滑块叠加对比，可拖动垂直分隔线
 *  - diff-highlight：像素级差异高亮，相同区域灰度化、差异区域红色标记
 *
 * 全部本地处理（Canvas API + ImageData），零上传、零追踪、可离线使用。
 *
 * 适用场景：
 *  - 设计稿版本对比（v1 vs v2）
 *  - A/B 测试素材对比
 *  - 像素级差异分析（回归测试截图）
 *  - 压缩前后质量对比
 */

/** 对比模式元数据 */
const MODE_OPTIONS: { value: CompareMode; label: string; desc: string }[] = [
  {
    value: 'side-by-side',
    label: '左右并排',
    desc: '两张图等比缩放后并排展示，可下载合成图',
  },
  {
    value: 'overlay-slider',
    label: '滑块叠加',
    desc: '两张图叠加，拖动垂直分隔线对比同一区域',
  },
  {
    value: 'diff-highlight',
    label: '差异高亮',
    desc: '像素级差异分析，相同区域灰度化、差异区域红色标记',
  },
];

/** 差异阈值预设：帮助用户快速选择合适敏感度 */
const THRESHOLD_PRESETS: { label: string; value: number; desc: string }[] = [
  { label: '严格', value: 5, desc: '捕捉细微差异（回归测试、像素级验证）' },
  { label: '默认', value: 20, desc: '平衡可见性与噪声（推荐用于一般对比）' },
  { label: '宽松', value: 50, desc: '仅保留显著差异（压缩损失、明显改动）' },
];

/** 差异比例等级阈值（用于颜色提示） */
function getDiffLevel(percent: number): { label: string; cls: string } {
  if (percent === 0) return { label: '完全相同', cls: 'imgcmp__stat-value--good' };
  if (percent < 1) return { label: '几乎相同', cls: 'imgcmp__stat-value--good' };
  if (percent < 10) return { label: '轻微差异', cls: 'imgcmp__stat-value--warn' };
  if (percent < 30) return { label: '中等差异', cls: 'imgcmp__stat-value--warn' };
  if (percent < 70) return { label: '显著差异', cls: 'imgcmp__stat-value--bad' };
  return { label: '完全不同', cls: 'imgcmp__stat-value--bad' };
}

export default function ImageCompareTool() {
  // 应用模式：单图对比 / 批量对比（默认单图，保持向后兼容）
  const [appMode, setAppMode] = useState<AppMode>('single');

  // 两张源图片状态
  const [sourceA, setSourceA] = useState<SourceImage | null>(null);
  const [sourceB, setSourceB] = useState<SourceImage | null>(null);
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const [draggingA, setDraggingA] = useState(false);
  const [draggingB, setDraggingB] = useState(false);
  const inputARef = useRef<HTMLInputElement>(null);
  const inputBRef = useRef<HTMLInputElement>(null);

  // 对比配置
  const [mode, setMode] = useState<CompareMode>('side-by-side');
  const [threshold, setThreshold] = useState<number>(20);

  // 滑块叠加模式：分隔线位置（百分比 0-100）
  const [sliderPos, setSliderPos] = useState<number>(50);
  const sliderDragging = useRef<boolean>(false);
  const sliderContainerRef = useRef<HTMLDivElement>(null);

  // 结果
  const [diffResult, setDiffResult] = useState<DiffResultWithRegions | null>(null);
  const [sideBySideUrl, setSideBySideUrl] = useState<string>('');
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string>('');

  // 差异区域相关状态
  const [showRegions, setShowRegions] = useState<boolean>(true);     // 是否在差异图上叠加区域框选
  const [selectedRegionIdx, setSelectedRegionIdx] = useState<number>(-1); // 当前选中的区域索引（-1 表示无）
  const [zoomModalIdx, setZoomModalIdx] = useState<number>(-1);     // 区域放大 modal 当前索引（-1 表示关闭）
  const diffImgRef = useRef<HTMLImageElement>(null);                 // 差异图元素引用，用于滚动定位

  /** 计算图片尺寸差异提示 */
  const sizeWarning = useMemo(() => {
    if (!sourceA || !sourceB) return '';
    if (sourceA.width !== sourceB.width || sourceA.height !== sourceB.height) {
      const w = Math.min(sourceA.width, sourceB.width);
      const h = Math.min(sourceA.height, sourceB.height);
      return `两张图尺寸不同，将以共同区域 ${w}×${h} 进行对比`;
    }
    return '';
  }, [sourceA, sourceB]);

  /** 清理指定源图片的 ObjectURL */
  const revokeSource = useCallback((src: SourceImage | null) => {
    if (src) URL.revokeObjectURL(src.url);
  }, []);

  /** 处理文件选择（共用，slot 区分 A/B） */
  const handleFile = useCallback(
    async (file: File | undefined | null, slot: 'A' | 'B') => {
      if (!file) return;
      const setSource = slot === 'A' ? setSourceA : setSourceB;
      const setLoading = slot === 'A' ? setLoadingA : setLoadingB;
      const oldSource = slot === 'A' ? sourceA : sourceB;
      revokeSource(oldSource);
      setSource(null);
      setError('');
      setDiffResult(null);
      setSideBySideUrl('');
      setLoading(true);
      try {
        const img = await loadImage(file);
        setSource(img);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [sourceA, sourceB, revokeSource],
  );

  /** 拖拽事件处理（共用，slot 区分 A/B） */
  const makeDragHandlers = useCallback(
    (slot: 'A' | 'B') => {
      const setDragging = slot === 'A' ? setDraggingA : setDraggingB;
      return {
        onDragOver: (e: React.DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(true);
        },
        onDragLeave: (e: React.DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(false);
        },
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          handleFile(file, slot);
        },
      };
    },
    [handleFile],
  );

  /** 滑块拖动：鼠标移动时更新分隔线位置 */
  const updateSliderFromClientX = useCallback((clientX: number) => {
    if (!sliderContainerRef.current) return;
    const rect = sliderContainerRef.current.getBoundingClientRect();
    const pos = ((clientX - rect.left) / rect.width) * 100;
    setSliderPos(Math.max(0, Math.min(100, pos)));
  }, []);

  const onSliderMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      sliderDragging.current = true;
      updateSliderFromClientX(e.clientX);
    },
    [updateSliderFromClientX],
  );

  useEffect(() => {
    if (!sliderDragging.current) return;
    const onMove = (e: MouseEvent) => updateSliderFromClientX(e.clientX);
    const onUp = () => {
      sliderDragging.current = false;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [updateSliderFromClientX]);

  /** 触摸支持 */
  const onSliderTouchStart = useCallback(
    (e: React.TouchEvent) => {
      sliderDragging.current = true;
      if (e.touches[0]) updateSliderFromClientX(e.touches[0].clientX);
    },
    [updateSliderFromClientX],
  );

  useEffect(() => {
    if (!sliderDragging.current) return;
    const onMove = (e: TouchEvent) => {
      if (e.touches[0]) updateSliderFromClientX(e.touches[0].clientX);
    };
    const onEnd = () => {
      sliderDragging.current = false;
    };
    window.addEventListener('touchmove', onMove);
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, [updateSliderFromClientX]);

  /** 粘贴支持：根据当前缺图自动填充到对应 slot */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            const targetSlot: 'A' | 'B' = !sourceA ? 'A' : !sourceB ? 'B' : 'A';
            handleFile(file, targetSlot);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [sourceA, sourceB, handleFile]);

  /**
   * 计算对比结果
   * - side-by-side：合成左右并排图
   * - overlay-slider：仅依赖 sourceA/sourceB 直接展示（无需预计算）
   * - diff-highlight：执行像素级差异分析（含区域检测，一次扫描）
   */
  const computeResult = useCallback(async () => {
    if (!sourceA || !sourceB) return;
    setComputing(true);
    setError('');
    try {
      if (mode === 'diff-highlight') {
        const result = await compareImagesDiffWithRegions(sourceA, sourceB, threshold, DEFAULT_GRID_SIZE);
        setDiffResult(result);
        setSelectedRegionIdx(-1);
      } else if (mode === 'side-by-side') {
        // 取两张图中较小的高度，避免合成图过大
        const targetHeight = Math.min(sourceA.height, sourceB.height, 800);
        const { dataUrl } = await composeSideBySide(sourceA, sourceB, targetHeight);
        setSideBySideUrl(dataUrl);
      }
      // overlay-slider 模式无需预计算
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setComputing(false);
    }
  }, [sourceA, sourceB, mode, threshold]);

  /**
   * 当两张图都已就绪且模式或阈值变化时，自动重新计算
   * 防抖 300ms 避免拖动阈值滑块时频繁计算
   */
  useEffect(() => {
    if (!sourceA || !sourceB) {
      setDiffResult(null);
      setSideBySideUrl('');
      return;
    }
    let cancelled = false;
    setComputing(true);
    const timer = setTimeout(async () => {
      try {
        if (mode === 'diff-highlight') {
          const result = await compareImagesDiffWithRegions(sourceA, sourceB, threshold, DEFAULT_GRID_SIZE);
          if (!cancelled) {
            setDiffResult(result);
            setSelectedRegionIdx(-1);
          }
        } else if (mode === 'side-by-side') {
          const targetHeight = Math.min(sourceA.height, sourceB.height, 800);
          const { dataUrl } = await composeSideBySide(sourceA, sourceB, targetHeight);
          if (!cancelled) setSideBySideUrl(dataUrl);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setComputing(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceA, sourceB, mode, threshold]);

  /** 重置全部状态 */
  const handleReset = useCallback(() => {
    revokeSource(sourceA);
    revokeSource(sourceB);
    setSourceA(null);
    setSourceB(null);
    setDiffResult(null);
    setSideBySideUrl('');
    setError('');
    setSliderPos(50);
    setThreshold(20);
    setMode('side-by-side');
    setShowRegions(true);
    setSelectedRegionIdx(-1);
    if (inputARef.current) inputARef.current.value = '';
    if (inputBRef.current) inputBRef.current.value = '';
  }, [sourceA, sourceB, revokeSource]);

  /** 交换 A/B 两张图 */
  const handleSwap = useCallback(() => {
    setSourceA(sourceB);
    setSourceB(sourceA);
    setDiffResult(null);
    setSideBySideUrl('');
    setSelectedRegionIdx(-1);
  }, [sourceA, sourceB]);

  /** 下载对比结果 */
  const handleDownload = useCallback(() => {
    if (mode === 'diff-highlight' && diffResult) {
      const baseName = sourceA?.file.name.replace(/\.[^.]+$/, '') || 'image-a';
      downloadDataUrl(diffResult.dataUrl, `${baseName}-diff.png`);
    } else if (mode === 'side-by-side' && sideBySideUrl) {
      const baseName = sourceA?.file.name.replace(/\.[^.]+$/, '') || 'image-a';
      downloadDataUrl(sideBySideUrl, `${baseName}-compare.png`);
    }
  }, [mode, diffResult, sideBySideUrl, sourceA]);

  /**
   * 导出差异分析结果为 JSON 文件
   * 包含元信息、统计、区域列表，便于自动化测试集成与跨工具复用
   */
  const handleExportJson = useCallback(() => {
    if (!diffResult || !sourceA || !sourceB) return;
    const json = buildDiffExportJson(diffResult, sourceA, sourceB, threshold);
    const baseName = sourceA.file.name.replace(/\.[^.]+$/, '') || 'image-a';
    downloadText(json, `${baseName}-diff-report.json`);
  }, [diffResult, sourceA, sourceB, threshold]);

  /** 选中某个差异区域：更新选中索引并滚动到差异图位置 */
  const handleSelectRegion = useCallback((idx: number) => {
    setSelectedRegionIdx((current) => (current === idx ? -1 : idx));
    // 滚动差异图到可视区域，便于用户对照
    if (idx >= 0 && diffImgRef.current) {
      diffImgRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, []);

  /** 打开区域放大 modal：同时选中该区域，便于关闭后保持高亮 */
  const handleOpenZoom = useCallback((idx: number) => {
    if (idx < 0) return;
    setSelectedRegionIdx(idx);
    setZoomModalIdx(idx);
  }, []);

  /** 关闭区域放大 modal */
  const handleCloseZoom = useCallback(() => {
    setZoomModalIdx(-1);
  }, []);

  /** modal 内切换区域：仅更新 modal 索引与选中状态，不滚动 */
  const handleNavigateZoom = useCallback((idx: number) => {
    if (idx < 0) return;
    setSelectedRegionIdx(idx);
    setZoomModalIdx(idx);
  }, []);

  /** 卸载时清理 ObjectURL */
  useEffect(() => {
    return () => {
      if (sourceA) URL.revokeObjectURL(sourceA.url);
      if (sourceB) URL.revokeObjectURL(sourceB.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bothReady = sourceA && sourceB;
  const diffLevel = diffResult ? getDiffLevel(diffResult.stats.diffPercent) : null;

  return (
    <div className="imgcmp">
      {/* 应用模式切换：单图对比 / 批量对比 */}
      <div className="imgcmp__appmode" role="tablist" aria-label="选择对比模式">
        <button
          type="button"
          role="tab"
          aria-selected={appMode === 'single'}
          className={`imgcmp__appmode-tab${appMode === 'single' ? ' imgcmp__appmode-tab--active' : ''}`}
          onClick={() => setAppMode('single')}
        >
          单图对比
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={appMode === 'batch'}
          className={`imgcmp__appmode-tab${appMode === 'batch' ? ' imgcmp__appmode-tab--active' : ''}`}
          onClick={() => setAppMode('batch')}
        >
          批量对比
        </button>
        <span className="imgcmp__appmode-hint">
          {appMode === 'single'
            ? '上传两张图进行多种模式对比'
            : '上传多张图自动两两配对，批量输出差异报告'}
        </span>
      </div>

      {appMode === 'batch' ? (
        <BatchCompareMode />
      ) : (
        <>
      {/* 双图上传区 */}
      <div className="imgcmp__uploads">
        <div
          className={`imgcmp__slot${draggingA ? ' imgcmp__slot--active' : ''}${sourceA ? ' imgcmp__slot--filled' : ''}`}
          {...makeDragHandlers('A')}
          onClick={() => !sourceA && inputARef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="上传图片 A：点击或拖拽，或按 Ctrl+V 粘贴"
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !sourceA) {
              e.preventDefault();
              inputARef.current?.click();
            }
          }}
        >
          <input
            ref={inputARef}
            type="file"
            accept={ACCEPTED_MIMES.join(',')}
            onChange={(e) => handleFile(e.target.files?.[0], 'A')}
            hidden
          />
          {sourceA ? (
            <div className="imgcmp__slot-preview">
              <img src={sourceA.url} alt="图片 A 预览" className="imgcmp__slot-img" />
              <div className="imgcmp__slot-info">
                <div className="imgcmp__slot-name" title={sourceA.file.name}>{sourceA.file.name}</div>
                <div className="imgcmp__slot-meta">
                  {sourceA.width}×{sourceA.height} · {formatBytes(sourceA.file.size)}
                </div>
                <div className="imgcmp__slot-actions">
                  <button
                    type="button"
                    className="imgcmp__btn imgcmp__btn--small"
                    onClick={(e) => {
                      e.stopPropagation();
                      inputARef.current?.click();
                    }}
                  >
                    更换
                  </button>
                  <button
                    type="button"
                    className="imgcmp__btn imgcmp__btn--small imgcmp__btn--danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      revokeSource(sourceA);
                      setSourceA(null);
                      setDiffResult(null);
                      setSideBySideUrl('');
                    }}
                  >
                    移除
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="imgcmp__slot-empty">
              <div className="imgcmp__slot-icon" aria-hidden="true">🖼️</div>
              <div className="imgcmp__slot-text">
                {loadingA ? '加载中...' : '图片 A'}
              </div>
              <div className="imgcmp__slot-hint">点击上传 / 拖拽 / Ctrl+V 粘贴</div>
            </div>
          )}
        </div>

        <div
          className={`imgcmp__slot${draggingB ? ' imgcmp__slot--active' : ''}${sourceB ? ' imgcmp__slot--filled' : ''}`}
          {...makeDragHandlers('B')}
          onClick={() => !sourceB && inputBRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="上传图片 B：点击或拖拽，或按 Ctrl+V 粘贴"
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !sourceB) {
              e.preventDefault();
              inputBRef.current?.click();
            }
          }}
        >
          <input
            ref={inputBRef}
            type="file"
            accept={ACCEPTED_MIMES.join(',')}
            onChange={(e) => handleFile(e.target.files?.[0], 'B')}
            hidden
          />
          {sourceB ? (
            <div className="imgcmp__slot-preview">
              <img src={sourceB.url} alt="图片 B 预览" className="imgcmp__slot-img" />
              <div className="imgcmp__slot-info">
                <div className="imgcmp__slot-name" title={sourceB.file.name}>{sourceB.file.name}</div>
                <div className="imgcmp__slot-meta">
                  {sourceB.width}×{sourceB.height} · {formatBytes(sourceB.file.size)}
                </div>
                <div className="imgcmp__slot-actions">
                  <button
                    type="button"
                    className="imgcmp__btn imgcmp__btn--small"
                    onClick={(e) => {
                      e.stopPropagation();
                      inputBRef.current?.click();
                    }}
                  >
                    更换
                  </button>
                  <button
                    type="button"
                    className="imgcmp__btn imgcmp__btn--small imgcmp__btn--danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      revokeSource(sourceB);
                      setSourceB(null);
                      setDiffResult(null);
                      setSideBySideUrl('');
                    }}
                  >
                    移除
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="imgcmp__slot-empty">
              <div className="imgcmp__slot-icon" aria-hidden="true">🖼️</div>
              <div className="imgcmp__slot-text">
                {loadingB ? '加载中...' : '图片 B'}
              </div>
              <div className="imgcmp__slot-hint">点击上传 / 拖拽 / Ctrl+V 粘贴</div>
            </div>
          )}
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="imgcmp__error" role="alert">
          <strong>错误：</strong> {error}
        </div>
      )}

      {/* 尺寸差异提示 */}
      {sizeWarning && (
        <div className="imgcmp__notice" role="status">
          {sizeWarning}
        </div>
      )}

      {/* 控制面板：仅在两图就绪时显示 */}
      {bothReady && (
        <div className="imgcmp__panel">
          {/* 模式切换 */}
          <div className="imgcmp__field-group">
            <span className="imgcmp__field-label">对比模式</span>
            <div className="imgcmp__mode-tabs" role="tablist">
              {MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="tab"
                  aria-selected={mode === opt.value}
                  className={`imgcmp__mode-tab${mode === opt.value ? ' imgcmp__mode-tab--active' : ''}`}
                  onClick={() => setMode(opt.value)}
                  title={opt.desc}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="imgcmp__mode-desc">
              {MODE_OPTIONS.find((o) => o.value === mode)?.desc}
            </div>
          </div>

          {/* 差异模式专属：阈值调节 */}
          {mode === 'diff-highlight' && (
            <div className="imgcmp__field-group">
              <label className="imgcmp__field-label" htmlFor="threshold">
                差异阈值：<span className="imgcmp__field-value">{threshold}</span>
              </label>
              <input
                id="threshold"
                type="range"
                min={0}
                max={100}
                step={1}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="imgcmp__range"
              />
              <div className="imgcmp__preset-row">
                {THRESHOLD_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    className={`imgcmp__preset-btn${threshold === p.value ? ' imgcmp__preset-btn--active' : ''}`}
                    onClick={() => setThreshold(p.value)}
                    title={p.desc}
                  >
                    {p.label}（{p.value}）
                  </button>
                ))}
              </div>
              <div className="imgcmp__hint">
                阈值越低越敏感：捕捉细微差异（如 5）；阈值越高仅保留显著差异（如 50）。
              </div>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="imgcmp__actions">
            <button
              type="button"
              className="imgcmp__btn imgcmp__btn--primary"
              onClick={computeResult}
              disabled={computing}
            >
              {computing ? '计算中...' : '重新计算'}
            </button>
            <button
              type="button"
              className="imgcmp__btn"
              onClick={handleSwap}
              disabled={computing}
              title="交换 A/B 两张图的位置"
            >
              ⇄ 交换 A/B
            </button>
            {(mode === 'diff-highlight' && diffResult) || (mode === 'side-by-side' && sideBySideUrl) ? (
              <button
                type="button"
                className="imgcmp__btn"
                onClick={handleDownload}
              >
                下载结果
              </button>
            ) : null}
            {mode === 'diff-highlight' && diffResult && (
              <button
                type="button"
                className="imgcmp__btn"
                onClick={handleExportJson}
                title="导出差异分析报告（JSON 格式，含元信息、统计、区域列表）"
              >
                导出 JSON
              </button>
            )}
            <button
              type="button"
              className="imgcmp__btn imgcmp__btn--danger"
              onClick={handleReset}
            >
              重置
            </button>
          </div>
        </div>
      )}

      {/* 结果展示 */}
      {bothReady && (
        <div className="imgcmp__result">
          {computing && (
            <div className="imgcmp__loading" role="status">
              <span className="imgcmp__spinner" aria-hidden="true"></span>
              正在分析差异...
            </div>
          )}

          {/* 左右并排模式 */}
          {mode === 'side-by-side' && !computing && sideBySideUrl && (
            <div className="imgcmp__preview">
              <img
                src={sideBySideUrl}
                alt="左右并排对比图：图片 A 在左、图片 B 在右"
                className="imgcmp__preview-img"
              />
            </div>
          )}

          {/* 滑块叠加模式 */}
          {mode === 'overlay-slider' && !computing && (
            <div
              ref={sliderContainerRef}
              className="imgcmp__slider"
              onMouseDown={onSliderMouseDown}
              onTouchStart={onSliderTouchStart}
              role="slider"
              aria-label="拖动分隔线对比两张图"
              aria-valuenow={Math.round(sliderPos)}
              aria-valuemin={0}
              aria-valuemax={100}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') setSliderPos((p) => Math.max(0, p - 2));
                else if (e.key === 'ArrowRight') setSliderPos((p) => Math.min(100, p + 2));
              }}
            >
              {/* 底层：图片 A */}
              <img
                src={sourceA!.url}
                alt="图片 A"
                className="imgcmp__slider-img imgcmp__slider-img--bottom"
                draggable={false}
              />
              {/* 上层：图片 B（按 sliderPos 裁剪右侧） */}
              <div
                className="imgcmp__slider-clip"
                style={{ width: `${sliderPos}%` }}
              >
                <img
                  src={sourceB!.url}
                  alt="图片 B"
                  className="imgcmp__slider-img imgcmp__slider-img--top"
                  draggable={false}
                />
              </div>
              {/* 分隔线 */}
              <div
                className="imgcmp__slider-divider"
                style={{ left: `${sliderPos}%` }}
              >
                <div className="imgcmp__slider-handle" aria-hidden="true">⇄</div>
              </div>
              {/* 标签 */}
              <div className="imgcmp__slider-label imgcmp__slider-label--left">A</div>
              <div className="imgcmp__slider-label imgcmp__slider-label--right">B</div>
            </div>
          )}

          {/* 差异高亮模式 */}
          {mode === 'diff-highlight' && !computing && diffResult && (
            <>
              <div className="imgcmp__preview imgcmp__preview--diff">
                <img
                  ref={diffImgRef}
                  src={diffResult.dataUrl}
                  alt="像素差异图：相同区域灰度化，差异区域红色高亮"
                  className="imgcmp__preview-img"
                />
                {/* 区域框选叠加层：基于 SVG viewBox 按差异图像素坐标定位 */}
                {showRegions && diffResult.regions.length > 0 && (
                  <svg
                    className="imgcmp__regions-overlay"
                    viewBox={`0 0 ${diffResult.width} ${diffResult.height}`}
                    preserveAspectRatio="xMidYMid meet"
                    role="group"
                    aria-label="差异区域叠加层：点击选中区域，双击放大查看"
                  >
                    {diffResult.regions.map((region, idx) => {
                      // 区域序号标签位置（左上角偏移）
                      const labelX = region.x + 4;
                      const labelY = region.y + 12;
                      const isSelected = idx === selectedRegionIdx;
                      return (
                        <g
                          key={`region-${idx}`}
                          className={`imgcmp__region-group${isSelected ? ' imgcmp__region-group--active' : ''}`}
                          onClick={() => handleSelectRegion(idx)}
                          onDoubleClick={() => handleOpenZoom(idx)}
                          role="button"
                          tabIndex={0}
                          aria-label={`区域 ${idx + 1}：双击或回车放大查看`}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleOpenZoom(idx);
                            }
                          }}
                        >
                          {/* 包围盒矩形 */}
                          <rect
                            x={region.x}
                            y={region.y}
                            width={region.width}
                            height={region.height}
                            rx={2}
                            className="imgcmp__region-rect"
                          />
                          {/* 序号标签背景 */}
                          <rect
                            x={region.x}
                            y={region.y}
                            width={20}
                            height={16}
                            className="imgcmp__region-label-bg"
                          />
                          {/* 序号文本 */}
                          <text
                            x={labelX}
                            y={labelY}
                            className="imgcmp__region-label-text"
                          >
                            {idx + 1}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                )}
                {/* 区域框选开关 */}
                {diffResult.regions.length > 0 && (
                  <label className="imgcmp__regions-toggle">
                    <input
                      type="checkbox"
                      checked={showRegions}
                      onChange={(e) => setShowRegions(e.target.checked)}
                    />
                    <span>显示差异区域（{diffResult.regions.length} 个）</span>
                  </label>
                )}
              </div>
              {/* 差异统计 */}
              <div className="imgcmp__stats">
                <div className="imgcmp__stat-item">
                  <span className="imgcmp__stat-label">差异比例</span>
                  <span className={`imgcmp__stat-value ${diffLevel?.cls}`}>
                    {diffResult.stats.diffPercent}%
                    {diffLevel && <span className="imgcmp__stat-level"> · {diffLevel.label}</span>}
                  </span>
                </div>
                <div className="imgcmp__stat-item">
                  <span className="imgcmp__stat-label">差异像素</span>
                  <span className="imgcmp__stat-value">
                    {diffResult.stats.diffPixels.toLocaleString()}
                  </span>
                </div>
                <div className="imgcmp__stat-item">
                  <span className="imgcmp__stat-label">总像素</span>
                  <span className="imgcmp__stat-value">
                    {diffResult.stats.totalPixels.toLocaleString()}
                  </span>
                </div>
                <div className="imgcmp__stat-item">
                  <span className="imgcmp__stat-label">最大差异</span>
                  <span className="imgcmp__stat-value">
                    {diffResult.stats.maxPixelDiff}
                  </span>
                </div>
                <div className="imgcmp__stat-item">
                  <span className="imgcmp__stat-label">平均差异强度</span>
                  <span className="imgcmp__stat-value">
                    {diffResult.stats.avgDiffIntensity}
                  </span>
                </div>
                <div className="imgcmp__stat-item">
                  <span className="imgcmp__stat-label">对比区域</span>
                  <span className="imgcmp__stat-value">
                    {diffResult.width}×{diffResult.height}
                  </span>
                </div>
              </div>

              {/* 差异区域列表：按差异像素数降序，可点击定位 */}
              {diffResult.regions.length > 0 && (
                <div className="imgcmp__regions" aria-labelledby="imgcmp-regions-title">
                  <div className="imgcmp__regions-header">
                    <h3 id="imgcmp-regions-title" className="imgcmp__regions-title">
                      差异区域列表
                    </h3>
                    <span className="imgcmp__regions-meta">
                      共 {diffResult.regions.length} 个区域 · 网格 {diffResult.gridSize}px
                    </span>
                  </div>
                  <ul className="imgcmp__regions-list">
                    {diffResult.regions.map((region, idx) => (
                      <li
                        key={`region-item-${idx}`}
                        className={`imgcmp__region-item${idx === selectedRegionIdx ? ' imgcmp__region-item--active' : ''}`}
                      >
                        <button
                          type="button"
                          className="imgcmp__region-btn"
                          onClick={() => handleSelectRegion(idx)}
                          aria-pressed={idx === selectedRegionIdx}
                          aria-label={`区域 ${idx + 1}：坐标 (${region.x}, ${region.y})，尺寸 ${region.width}×${region.height}，差异像素 ${region.diffPixels}`}
                        >
                          <span className="imgcmp__region-index">{idx + 1}</span>
                          <span className="imgcmp__region-coord">
                            ({region.x}, {region.y}) · {region.width}×{region.height}
                          </span>
                          <span className="imgcmp__region-stats">
                            <span className="imgcmp__region-pixels">
                              {region.diffPixels.toLocaleString()} 像素
                            </span>
                            <span className="imgcmp__region-density">
                              密度 {region.density}%
                            </span>
                            <span className="imgcmp__region-intensity">
                              强度 {region.avgIntensity}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          className="imgcmp__region-zoom"
                          onClick={() => handleOpenZoom(idx)}
                          aria-label={`放大查看区域 ${idx + 1}：三联对比 A/B/差异图`}
                          title="放大查看（A/B/差异图三联对比）"
                        >
                          🔍 放大
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {/* 空状态：模式未生成结果 */}
          {!computing && mode === 'side-by-side' && !sideBySideUrl && (
            <div className="imgcmp__empty">点击「重新计算」生合成图</div>
          )}
          {!computing && mode === 'diff-highlight' && !diffResult && (
            <div className="imgcmp__empty">点击「重新计算」开始像素级差异分析</div>
          )}
        </div>
      )}
        {/* 区域放大 modal：仅单图模式 + diff-highlight 模式 + 有 diffResult + 索引有效时渲染 */}
        {appMode === 'single' &&
          mode === 'diff-highlight' &&
          diffResult &&
          sourceA &&
          sourceB &&
          zoomModalIdx >= 0 &&
          zoomModalIdx < diffResult.regions.length && (
            <RegionZoomModal
              regions={diffResult.regions}
              currentIndex={zoomModalIdx}
              sourceA={sourceA}
              sourceB={sourceB}
              diffDataUrl={diffResult.dataUrl}
              diffWidth={diffResult.width}
              diffHeight={diffResult.height}
              onClose={handleCloseZoom}
              onNavigate={handleNavigateZoom}
            />
          )}
        </>
      )}
    </div>
  );
}

/* ============================================================
 *  批量对比子组件
 *  独立状态管理，避免与单图模式相互干扰
 * ============================================================ */

/** 差异比例等级标签（与单图模式保持一致的视觉语义） */
function getBatchDiffLevel(percent: number): { label: string; cls: string } {
  if (percent === 0) return { label: '完全相同', cls: 'imgcmp__stat-value--good' };
  if (percent < 1) return { label: '几乎相同', cls: 'imgcmp__stat-value--good' };
  if (percent < 10) return { label: '轻微', cls: 'imgcmp__stat-value--warn' };
  if (percent < 30) return { label: '中等', cls: 'imgcmp__stat-value--warn' };
  if (percent < 70) return { label: '显著', cls: 'imgcmp__stat-value--bad' };
  return { label: '完全不同', cls: 'imgcmp__stat-value--bad' };
}

function BatchCompareMode() {
  // 文件列表（已选择但未加载为 SourceImage）
  const [files, setFiles] = useState<File[]>([]);
  // 阈值（与单图模式独立，避免切换时互相影响）
  const [threshold, setThreshold] = useState<number>(20);
  // 处理状态
  const [computing, setComputing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  // 结果
  const [summary, setSummary] = useState<BatchCompareSummary | null>(null);
  const [error, setError] = useState<string>('');
  // 展开查看差异图的配对索引（-1 表示无展开）
  const [expandedIdx, setExpandedIdx] = useState<number>(-1);
  // 配对警告（如奇数个文件）
  const [pairWarning, setPairWarning] = useState<string>('');
  // ZIP 打包状态（避免重复点击）
  const [zipping, setZipping] = useState(false);
  // ZIP 打包错误提示（独立于对比错误，便于定位）
  const [zipError, setZipError] = useState<string>('');
  // 配对模式：顺序配对（第 1+2、3+4...）/ 前缀配对（按文件名前缀自动分组）
  const [pairMode, setPairMode] = useState<PairMode>('sequential');
  // 自定义分隔符（仅前缀配对模式生效）：用户输入的字符序列，每个字符作为独立分隔符
  const [customSeparators, setCustomSeparators] = useState<string>('');
  // 是否启用自定义分隔符（关闭时使用默认 _ - . 空格）
  const [useCustomSeparators, setUseCustomSeparators] = useState<boolean>(false);
  // 是否展开前缀分组预览（仅前缀模式生效）
  const [showGroupsPreview, setShowGroupsPreview] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  /** 处理多文件选择 */
  const handleFileSelect = useCallback((selected: FileList | null | undefined) => {
    if (!selected || selected.length === 0) return;
    // 仅保留图片文件
    const imageFiles = Array.from(selected).filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      setError('未选择有效的图片文件');
      return;
    }
    setError('');
    setSummary(null);
    setFiles((prev) => [...prev, ...imageFiles]);
  }, []);

  /** 移除指定索引的文件 */
  const handleRemoveFile = useCallback((idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    setSummary(null);
  }, []);

  /** 清空全部文件 */
  const handleClearAll = useCallback(() => {
    setFiles([]);
    setSummary(null);
    setError('');
    setPairWarning('');
    setExpandedIdx(-1);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  /** 执行批量对比 */
  const handleStartBatch = useCallback(async () => {
    if (files.length < 2) {
      setError('至少需要 2 个文件才能配对');
      return;
    }

    // 根据当前配对模式调用不同配对函数
    const pairResult = pairMode === 'prefix'
      ? pairFilesByNamePrefix(files, useCustomSeparators ? { customSeparators } : undefined)
      : pairFilesSequentially(files);
    const filePairs = pairResult.pairs;
    const warning = pairResult.warning;
    setPairWarning(warning ?? '');

    if (filePairs.length === 0) {
      setError(warning || '配对失败');
      return;
    }
    if (filePairs.length > MAX_BATCH_PAIRS) {
      setError(`配对数超出上限（${MAX_BATCH_PAIRS}），请减少文件数`);
      return;
    }

    setComputing(true);
    setError('');
    setSummary(null);
    setExpandedIdx(-1);
    setProgress({ current: 0, total: filePairs.length });

    try {
      // 加载所有图片为 SourceImage（失败时单独记录，不影响整体）
      const loadedPairs: { sourceA: SourceImage; sourceB: SourceImage }[] = [];
      for (let i = 0; i < filePairs.length; i++) {
        const [fileA, fileB] = filePairs[i];
        try {
          const [sourceA, sourceB] = await Promise.all([loadImage(fileA), loadImage(fileB)]);
          loadedPairs.push({ sourceA, sourceB });
        } catch (e) {
          // 加载失败时跳过该对，但记录到错误信息
          setError((prev) => `${prev}${prev ? '；' : ''}配对 ${i + 1} 加载失败：${e instanceof Error ? e.message : String(e)}`);
        }
        // 更新加载进度（与对比进度共用同一个 progress）
        setProgress({ current: i + 1, total: filePairs.length });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      if (loadedPairs.length === 0) {
        setError('所有配对加载失败，无法执行批量对比');
        return;
      }

      // 执行批量对比
      const result = await compareImagePairsBatch(
        loadedPairs,
        threshold,
        DEFAULT_GRID_SIZE,
        (current, total) => setProgress({ current, total }),
      );
      setSummary(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setComputing(false);
    }
  }, [files, threshold, pairMode, useCustomSeparators, customSeparators]);

  /** 导出批量对比 JSON 报告 */
  const handleExportBatchJson = useCallback(() => {
    if (!summary) return;
    const json = buildBatchExportJson(summary);
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    downloadText(json, `image-compare-batch-${dateStr}.json`);
  }, [summary]);

  /**
   * 下载批量对比全部差异图（ZIP 打包）
   * 包含：每对成功对比的差异图 PNG + manifest.json + README.txt
   * 仅在浏览器本地打包，无网络请求
   */
  const handleDownloadBatchZip = useCallback(async () => {
    if (!summary) return;
    // 防止重复点击
    if (zipping) return;
    setZipping(true);
    setZipError('');
    try {
      const blob = await buildBatchDiffImagesZip(summary);
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      downloadBlob(blob, `image-compare-batch-${dateStr}.zip`);
    } catch (e) {
      setZipError(e instanceof Error ? e.message : String(e));
    } finally {
      setZipping(false);
    }
  }, [summary, zipping]);

  /** 切换展开某配对的差异图 */
  const handleToggleExpand = useCallback((idx: number) => {
    setExpandedIdx((current) => (current === idx ? -1 : idx));
  }, []);

  // 配对预览（基于当前文件列表与配对模式）
  const pairResult = useMemo<FilePairResult>(() => {
    if (files.length < 2) {
      return { pairs: [] };
    }
    return pairMode === 'prefix'
      ? pairFilesByNamePrefix(files, useCustomSeparators ? { customSeparators } : undefined)
      : pairFilesSequentially(files);
  }, [files, pairMode, useCustomSeparators, customSeparators]);

  const pairPreview = pairResult.pairs;

  // 构建文件索引 → 配对信息（pairIdx / role）映射，用于文件列表的角色标签显示
  // File 对象作为 Map key 基于引用相等，配对函数返回的 File 与 files 数组中是同一引用
  const filePairInfoMap = useMemo(() => {
    const map = new Map<File, { pairIdx: number; role: 'A' | 'B' }>();
    pairPreview.forEach((pair, pairIdx) => {
      if (pair[0]) map.set(pair[0], { pairIdx, role: 'A' });
      if (pair[1]) map.set(pair[1], { pairIdx, role: 'B' });
    });
    return map;
  }, [pairPreview]);

  // 未配对文件列表（仅前缀模式下可能存在）
  const unmatchedFiles = pairResult.unmatched ?? [];

  return (
    <div className="imgcmp__batch">
      {/* 文件选择区 */}
      <div
        className={`imgcmp__batch-drop${dragging ? ' imgcmp__batch-drop--active' : ''}`}
        onClick={() => !computing && fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFileSelect(e.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
        aria-label="批量上传图片：点击或拖拽多个文件"
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !computing) {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_MIMES.join(',')}
          multiple
          onChange={(e) => handleFileSelect(e.target.files)}
          hidden
        />
        <div className="imgcmp__batch-drop-icon" aria-hidden="true">📁</div>
        <div className="imgcmp__batch-drop-text">
          {computing ? `处理中... (${progress.current}/${progress.total})` : '点击或拖拽多个图片文件'}
        </div>
        <div className="imgcmp__batch-drop-hint">
          {pairMode === 'prefix'
            ? `按文件名前缀自动配对（同前缀的两两配对），支持自定义分隔符与分组预览，最多 ${MAX_BATCH_PAIRS} 对`
            : `文件按选择顺序两两配对（第 1+2、3+4...），最多 ${MAX_BATCH_PAIRS} 对`}
        </div>
      </div>

      {/* 配对模式切换器（仅在有文件时显示） */}
      {files.length > 0 && (
        <div className="imgcmp__pair-mode" role="radiogroup" aria-label="批量配对模式">
          <span className="imgcmp__pair-mode-label">配对方式：</span>
          <button
            type="button"
            role="radio"
            aria-checked={pairMode === 'sequential'}
            className={`imgcmp__pair-mode-btn${pairMode === 'sequential' ? ' imgcmp__pair-mode-btn--active' : ''}`}
            onClick={() => setPairMode('sequential')}
            disabled={computing}
            title="按选择顺序两两配对：第 1+2、3+4..."
          >
            顺序配对
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={pairMode === 'prefix'}
            className={`imgcmp__pair-mode-btn${pairMode === 'prefix' ? ' imgcmp__pair-mode-btn--active' : ''}`}
            onClick={() => setPairMode('prefix')}
            disabled={computing}
            title="按文件名前缀自动配对：去掉扩展名与最后一个分隔符后的部分作为前缀，同前缀的两两配对"
          >
            前缀配对
          </button>
          <span className="imgcmp__pair-mode-hint">
            {pairMode === 'prefix'
              ? '同前缀自动分组（如 logo_v1.png + logo_v2.png → 前缀 logo）'
              : '按选择顺序两两配对'}
          </span>
        </div>
      )}

      {/* 自定义分隔符与分组预览（仅前缀模式显示） */}
      {files.length > 0 && pairMode === 'prefix' && (
        <div className="imgcmp__pair-options">
          <div className="imgcmp__pair-separator">
            <label className="imgcmp__pair-separator-toggle">
              <input
                type="checkbox"
                checked={useCustomSeparators}
                onChange={(e) => setUseCustomSeparators(e.target.checked)}
                disabled={computing}
              />
              <span>自定义分隔符</span>
            </label>
            {useCustomSeparators && (
              <>
                <input
                  type="text"
                  className="imgcmp__pair-separator-input"
                  value={customSeparators}
                  onChange={(e) => setCustomSeparators(e.target.value)}
                  placeholder="如 _-. 或 @#"
                  maxLength={16}
                  disabled={computing}
                  aria-label="自定义分隔符（每个字符作为独立分隔符）"
                  title="输入字符序列，每个字符作为独立分隔符。最长 16 字符，仅接受可见 ASCII 字符。留空则使用默认 _ - . 空格"
                />
                <span className="imgcmp__pair-separator-hint">
                  {customSeparators.trim()
                    ? `分隔符：${Array.from(customSeparators.trim()).filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) <= 0x7e).map((ch) => ch === ' ' ? '空格' : ch).join(' / ')}`
                    : '当前为空，将使用默认分隔符 _ - . 空格'}
                </span>
              </>
            )}
          </div>
          <button
            type="button"
            className="imgcmp__btn imgcmp__btn--small imgcmp__pair-preview-btn"
            onClick={() => setShowGroupsPreview((v) => !v)}
            aria-expanded={showGroupsPreview}
            aria-controls="imgcmp-pair-groups"
            disabled={computing || !pairResult.groups || pairResult.groups.length === 0}
            title={showGroupsPreview ? '收起分组预览' : '展开查看前缀分组结果（每个分组的文件列表与配对结果）'}
          >
            {showGroupsPreview ? '收起分组预览' : '预览分组'}
          </button>
        </div>
      )}

      {/* 前缀分组预览（仅前缀模式 + 展开时显示） */}
      {files.length > 0 && pairMode === 'prefix' && showGroupsPreview && pairResult.groups && (
        <div id="imgcmp-pair-groups" className="imgcmp__pair-groups">
          <div className="imgcmp__pair-groups-header">
            共 {pairResult.groups.length} 个前缀分组
            {unmatchedFiles.length > 0 && (
              <span className="imgcmp__pair-groups-unmatched"> / {unmatchedFiles.length} 个未配对</span>
            )}
          </div>
          <ol className="imgcmp__pair-groups-list">
            {pairResult.groups.map((group: PrefixGroup, groupIdx: number) => {
              // 计算该分组内的配对（前两个 A/B、剩余为未配对）
              const pairsInGroup: { a: File; b: File }[] = [];
              for (let i = 0; i + 1 < group.files.length; i += 2) {
                pairsInGroup.push({ a: group.files[i], b: group.files[i + 1] });
              }
              const leftover = group.files.length % 2 === 1 ? group.files[group.files.length - 1] : null;
              const isOdd = group.files.length === 1;
              const isOver2 = group.files.length > 2;
              return (
                <li
                  key={`group-${groupIdx}-${group.prefix}`}
                  className={`imgcmp__pair-group${isOdd ? ' imgcmp__pair-group--odd' : ''}${isOver2 ? ' imgcmp__pair-group--over2' : ''}`}
                >
                  <div className="imgcmp__pair-group-header">
                    <span className="imgcmp__pair-group-prefix" title={`前缀：${group.prefix}`}>
                      {group.prefix || '（无前缀）'}
                    </span>
                    <span className="imgcmp__pair-group-count">
                      {group.files.length} 个文件 / {pairsInGroup.length} 对
                    </span>
                    {isOdd && (
                      <span className="imgcmp__pair-group-badge imgcmp__pair-group-badge--odd">
                        无法配对
                      </span>
                    )}
                    {isOver2 && (
                      <span className="imgcmp__pair-group-badge imgcmp__pair-group-badge--over2">
                        超过 2 个
                      </span>
                    )}
                  </div>
                  <ul className="imgcmp__pair-group-files">
                    {pairsInGroup.map((pair, pairIdx) => (
                      <li key={`pair-${groupIdx}-${pairIdx}`} className="imgcmp__pair-group-pair">
                        <span className="imgcmp__pair-group-role imgcmp__pair-group-role--a">A</span>
                        <span className="imgcmp__pair-group-name" title={pair.a.name}>{pair.a.name}</span>
                        <span className="imgcmp__pair-group-vs">vs</span>
                        <span className="imgcmp__pair-group-role imgcmp__pair-group-role--b">B</span>
                        <span className="imgcmp__pair-group-name" title={pair.b.name}>{pair.b.name}</span>
                      </li>
                    ))}
                    {leftover && (
                      <li className="imgcmp__pair-group-pair imgcmp__pair-group-pair--leftover">
                        <span className="imgcmp__pair-group-role imgcmp__pair-group-role--none">未配对</span>
                        <span className="imgcmp__pair-group-name" title={leftover.name}>{leftover.name}</span>
                      </li>
                    )}
                  </ul>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* 文件列表 */}
      {files.length > 0 && (
        <div className="imgcmp__batch-files">
          <div className="imgcmp__batch-files-header">
            <span className="imgcmp__batch-files-title">
              已选择 {files.length} 个文件
              {pairPreview.length > 0 && (
                <span className="imgcmp__batch-files-pairs">
                  {' '}/ 将配对为 {pairPreview.length} 对
                </span>
              )}
              {pairMode === 'prefix' && unmatchedFiles.length > 0 && (
                <span className="imgcmp__batch-files-unmatched">
                  {' '}/ {unmatchedFiles.length} 个未配对
                </span>
              )}
            </span>
            <button
              type="button"
              className="imgcmp__btn imgcmp__btn--small imgcmp__btn--danger"
              onClick={handleClearAll}
              disabled={computing}
            >
              清空全部
            </button>
          </div>
          <ol className="imgcmp__batch-files-list">
            {files.map((file, idx) => {
              // 通过配对映射查找该文件在配对中的位置（A 或 B）
              const info = filePairInfoMap.get(file);
              const isMatched = Boolean(info);
              const pairIdx = info?.pairIdx ?? -1;
              const roleInPair = info?.role ?? 'A';
              return (
                <li
                  key={`file-${idx}-${file.name}`}
                  className={`imgcmp__batch-file-item${isMatched ? '' : ' imgcmp__batch-file-item--unmatched'}`}
                >
                  <span className="imgcmp__batch-file-index">{idx + 1}</span>
                  <span className="imgcmp__batch-file-name" title={file.name}>{file.name}</span>
                  <span className="imgcmp__batch-file-meta">{formatBytes(file.size)}</span>
                  {isMatched ? (
                    <span className={`imgcmp__batch-file-role imgcmp__batch-file-role--${roleInPair.toLowerCase()}`}>
                      对{pairIdx + 1}-{roleInPair}
                    </span>
                  ) : (
                    <span className="imgcmp__batch-file-role imgcmp__batch-file-role--none" title="该文件未匹配到同前缀文件，将不参与对比">
                      未配对
                    </span>
                  )}
                  <button
                    type="button"
                    className="imgcmp__batch-file-remove"
                    onClick={() => handleRemoveFile(idx)}
                    disabled={computing}
                    aria-label={`移除文件 ${file.name}`}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* 配对警告 */}
      {pairWarning && (
        <div className="imgcmp__notice" role="status">{pairWarning}</div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="imgcmp__error" role="alert">
          <strong>错误：</strong> {error}
        </div>
      )}

      {/* 控制面板 */}
      {files.length >= 2 && (
        <div className="imgcmp__panel">
          <div className="imgcmp__field-group">
            <label className="imgcmp__field-label" htmlFor="batch-threshold">
              差异阈值：<span className="imgcmp__field-value">{threshold}</span>
            </label>
            <input
              id="batch-threshold"
              type="range"
              min={0}
              max={100}
              step={1}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="imgcmp__range"
              disabled={computing}
            />
            <div className="imgcmp__preset-row">
              {THRESHOLD_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={`imgcmp__preset-btn${threshold === p.value ? ' imgcmp__preset-btn--active' : ''}`}
                  onClick={() => setThreshold(p.value)}
                  disabled={computing}
                  title={p.desc}
                >
                  {p.label}（{p.value}）
                </button>
              ))}
            </div>
          </div>

          <div className="imgcmp__actions">
            <button
              type="button"
              className="imgcmp__btn imgcmp__btn--primary"
              onClick={handleStartBatch}
              disabled={computing || pairPreview.length === 0}
            >
              {computing ? `处理中 (${progress.current}/${progress.total})` : `开始批量对比（${pairPreview.length} 对）`}
            </button>
            {summary && (
              <button
                type="button"
                className="imgcmp__btn"
                onClick={handleExportBatchJson}
                title="导出批量对比汇总报告（JSON 格式）"
              >
                导出批量 JSON
              </button>
            )}
            {summary && summary.success > 0 && (
              <button
                type="button"
                className="imgcmp__btn imgcmp__btn--primary"
                onClick={handleDownloadBatchZip}
                disabled={zipping}
                title="将所有成功对比的差异图打包为 ZIP 下载（含 manifest.json 与 README.txt）"
              >
                {zipping ? '打包中...' : '下载全部差异图 ZIP'}
              </button>
            )}
            {zipError && (
              <span className="imgcmp__batch-zip-error" role="alert">
                ZIP 打包失败：{zipError}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 进度条 */}
      {computing && progress.total > 0 && (
        <div className="imgcmp__batch-progress" role="status">
          <div className="imgcmp__batch-progress-bar">
            <div
              className="imgcmp__batch-progress-fill"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
          <span className="imgcmp__batch-progress-text">
            {progress.current} / {progress.total}
          </span>
        </div>
      )}

      {/* 结果汇总 */}
      {summary && (
        <div className="imgcmp__batch-result">
          {/* 汇总统计 */}
          <div className="imgcmp__stats">
            <div className="imgcmp__stat-item">
              <span className="imgcmp__stat-label">总配对数</span>
              <span className="imgcmp__stat-value">{summary.total}</span>
            </div>
            <div className="imgcmp__stat-item">
              <span className="imgcmp__stat-label">成功</span>
              <span className="imgcmp__stat-value imgcmp__stat-value--good">{summary.success}</span>
            </div>
            <div className="imgcmp__stat-item">
              <span className="imgcmp__stat-label">失败</span>
              <span className={`imgcmp__stat-value${summary.failed > 0 ? ' imgcmp__stat-value--bad' : ''}`}>
                {summary.failed}
              </span>
            </div>
            <div className="imgcmp__stat-item">
              <span className="imgcmp__stat-label">平均差异</span>
              <span className="imgcmp__stat-value">{summary.avgDiffPercent}%</span>
            </div>
            <div className="imgcmp__stat-item">
              <span className="imgcmp__stat-label">最大差异</span>
              <span className="imgcmp__stat-value">{summary.maxDiffPercent}%</span>
            </div>
          </div>

          {/* 配对结果列表 */}
          <div className="imgcmp__batch-list" aria-labelledby="imgcmp-batch-list-title">
            <div className="imgcmp__regions-header">
              <h3 id="imgcmp-batch-list-title" className="imgcmp__regions-title">
                配对结果
              </h3>
              <span className="imgcmp__regions-meta">
                点击行展开差异图
              </span>
            </div>
            <ul className="imgcmp__batch-items">
              {summary.items.map((item) => {
                const level = item.result ? getBatchDiffLevel(item.result.stats.diffPercent) : null;
                const isExpanded = expandedIdx === item.index;
                return (
                  <li
                    key={`batch-item-${item.index}`}
                    className={`imgcmp__batch-item${isExpanded ? ' imgcmp__batch-item--expanded' : ''}`}
                  >
                    <button
                      type="button"
                      className="imgcmp__batch-item-header"
                      onClick={() => item.result && handleToggleExpand(item.index)}
                      aria-pressed={isExpanded}
                      aria-expanded={isExpanded}
                      disabled={!item.result}
                      aria-label={
                        item.result
                          ? `配对 ${item.index}：${item.sourceA.file.name} vs ${item.sourceB.file.name}，差异 ${item.result.stats.diffPercent}%，点击展开差异图`
                          : `配对 ${item.index} 处理失败：${item.error}`
                      }
                    >
                      <span className="imgcmp__batch-item-index">#{item.index}</span>
                      <span className="imgcmp__batch-item-pair">
                        <span className="imgcmp__batch-item-name" title={item.sourceA.file.name}>
                          {item.sourceA.file.name}
                        </span>
                        <span className="imgcmp__batch-item-vs">vs</span>
                        <span className="imgcmp__batch-item-name" title={item.sourceB.file.name}>
                          {item.sourceB.file.name}
                        </span>
                      </span>
                      {item.result ? (
                        <span className={`imgcmp__batch-item-percent ${level?.cls}`}>
                          {item.result.stats.diffPercent}%
                          {level && <span className="imgcmp__batch-item-level"> · {level.label}</span>}
                        </span>
                      ) : (
                        <span className="imgcmp__batch-item-error">失败：{item.error}</span>
                      )}
                    </button>
                    {/* 展开的差异图 */}
                    {isExpanded && item.result && (
                      <div className="imgcmp__batch-item-detail">
                        <img
                          src={item.result.dataUrl}
                          alt={`配对 ${item.index} 差异图`}
                          className="imgcmp__preview-img"
                        />
                        <div className="imgcmp__batch-item-stats">
                          <span>差异像素：{item.result.stats.diffPixels.toLocaleString()}</span>
                          <span>总像素：{item.result.stats.totalPixels.toLocaleString()}</span>
                          <span>最大差异：{item.result.stats.maxPixelDiff}</span>
                          <span>平均强度：{item.result.stats.avgDiffIntensity}</span>
                          <span>区域数：{item.result.regions.length}</span>
                          <span>对比区域：{item.result.width}×{item.result.height}</span>
                        </div>
                        <div className="imgcmp__actions">
                          <button
                            type="button"
                            className="imgcmp__btn imgcmp__btn--small"
                            onClick={() => {
                              const baseName = item.sourceA.file.name.replace(/\.[^.]+$/, '');
                              downloadDataUrl(item.result!.dataUrl, `${baseName}-diff.png`);
                            }}
                          >
                            下载差异图
                          </button>
                          <button
                            type="button"
                            className="imgcmp__btn imgcmp__btn--small"
                            onClick={() => {
                              const json = buildDiffExportJson(
                                item.result!,
                                item.sourceA,
                                item.sourceB,
                                summary.threshold,
                              );
                              const baseName = item.sourceA.file.name.replace(/\.[^.]+$/, '');
                              downloadText(json, `${baseName}-diff-report.json`);
                            }}
                          >
                            导出该对 JSON
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
 *  区域放大查看 Modal 子组件
 *  独立状态管理，三联放大对比（A / B / 差异图 同区域）
 *  支持键盘导航（ESC 关闭、← / → 切换区域）
 * ============================================================ */

/** RegionZoomModal 入参 */
interface RegionZoomModalProps {
  /** 全部差异区域列表 */
  regions: DiffRegion[];
  /** 当前显示的区域索引 */
  currentIndex: number;
  /** 图片 A 源 */
  sourceA: SourceImage;
  /** 图片 B 源 */
  sourceB: SourceImage;
  /** 差异图 dataUrl */
  diffDataUrl: string;
  /** 差异图宽度（作为坐标映射参考） */
  diffWidth: number;
  /** 差异图高度 */
  diffHeight: number;
  /** 关闭 modal 回调 */
  onClose: () => void;
  /** 切换区域回调 */
  onNavigate: (idx: number) => void;
}

/** 三联图加载状态 */
type TripleLoadState = {
  loading: boolean;
  error: string;
  urlA: string;
  urlB: string;
  urlDiff: string;
};

/** 三联图初始状态 */
const INITIAL_TRIPLE: TripleLoadState = {
  loading: true,
  error: '',
  urlA: '',
  urlB: '',
  urlDiff: '',
};

/** 基础放大输出尺寸（最长边，对应 1x 倍率） */
const ZOOM_BASE_SIZE = 320;
/** 区域四周扩展像素（参考坐标系单位） */
const ZOOM_PADDING = 12;

/** 放大倍率档位（1x / 2x / 4x），对应 targetSize = 320 / 640 / 1280 */
const ZOOM_MULTIPLIERS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: '1×' },
  { value: 2, label: '2×' },
  { value: 4, label: '4×' },
];

function RegionZoomModal({
  regions,
  currentIndex,
  sourceA,
  sourceB,
  diffDataUrl,
  diffWidth,
  diffHeight,
  onClose,
  onNavigate,
}: RegionZoomModalProps) {
  // 放大倍率（1 / 2 / 4），影响 targetSize 与下载合成图清晰度
  const [zoomMultiplier, setZoomMultiplier] = useState<number>(2);
  // 三联合成图下载状态：idle / zipping / error
  const [composeState, setComposeState] = useState<{ loading: boolean; error: string }>({
    loading: false,
    error: '',
  });
  const [state, setState] = useState<TripleLoadState>(INITIAL_TRIPLE);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const region = regions[currentIndex];
  const total = regions.length;

  /** 并行提取三联区域，每次切换区域或放大倍率时触发 */
  useEffect(() => {
    if (!region) return;
    let cancelled = false;
    setState({ ...INITIAL_TRIPLE });
    (async () => {
      try {
        // 三联并行提取，共享同一区域坐标与参考坐标系
        // targetSize 随放大倍率线性增长，1x=320 / 2x=640 / 4x=1280
        const targetSize = ZOOM_BASE_SIZE * zoomMultiplier;
        const refOpts = { refWidth: diffWidth, refHeight: diffHeight, targetSize, padding: ZOOM_PADDING };
        const [urlA, urlB, urlDiff] = await Promise.all([
          extractRegionDataUrl(sourceA, region, refOpts),
          extractRegionDataUrl(sourceB, region, refOpts),
          extractRegionDataUrl(diffDataUrl, region, refOpts),
        ]);
        if (cancelled) return;
        setState({ loading: false, error: '', urlA, urlB, urlDiff });
      } catch (e) {
        if (cancelled) return;
        setState({ loading: false, error: e instanceof Error ? e.message : String(e), urlA: '', urlB: '', urlDiff: '' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [region, sourceA, sourceB, diffDataUrl, diffWidth, diffHeight, zoomMultiplier]);

  /** 键盘导航：ESC 关闭、← / → 切换区域 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowLeft' && currentIndex > 0) {
        e.preventDefault();
        onNavigate(currentIndex - 1);
      } else if (e.key === 'ArrowRight' && currentIndex < total - 1) {
        e.preventDefault();
        onNavigate(currentIndex + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentIndex, total, onClose, onNavigate]);

  /** 打开时自动聚焦关闭按钮，便于键盘操作 */
  useEffect(() => {
    closeBtnRef.current?.focus();
  }, []);

  /** 点击遮罩关闭（点击内容区不关闭） */
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  /** 下载三联合成图：复用已提取的 urlA/urlB/urlDiff，水平并排合成 PNG */
  const handleDownloadTriple = useCallback(async () => {
    if (composeState.loading) return;
    if (!state.urlA || !state.urlB || !state.urlDiff) return;
    setComposeState({ loading: true, error: '' });
    try {
      // 标签包含图片文件名与差异图说明，便于脱离上下文识别
      const labels: [string, string, string] = [
        `图片 A · ${sourceA.file.name}`,
        `图片 B · ${sourceB.file.name}`,
        '差异图（红色高亮）',
      ];
      const dataUrl = await composeTripleImages([state.urlA, state.urlB, state.urlDiff], { labels });
      // 文件名：region-{序号}-triple-compare.png，序号从 1 开始便于用户识别
      const filename = `region-${currentIndex + 1}-triple-compare.png`;
      downloadDataUrl(dataUrl, filename);
      setComposeState({ loading: false, error: '' });
    } catch (e) {
      setComposeState({
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }, [composeState.loading, state.urlA, state.urlB, state.urlDiff, sourceA.file.name, sourceB.file.name, currentIndex]);

  if (!region) return null;

  return (
    <div
      className="imgcmp__zoom-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="imgcmp-zoom-title"
      onClick={handleOverlayClick}
    >
      <div className="imgcmp__zoom-dialog" ref={dialogRef}>
        {/* 顶部：标题 + 元信息 + 关闭按钮 */}
        <header className="imgcmp__zoom-header">
          <div className="imgcmp__zoom-title-wrap">
            <h2 id="imgcmp-zoom-title" className="imgcmp__zoom-title">
              区域 {currentIndex + 1} / {total}
            </h2>
            <p className="imgcmp__zoom-meta">
              坐标 ({region.x}, {region.y}) · 尺寸 {region.width}×{region.height}
              <span className="imgcmp__zoom-divider">·</span>
              差异像素 {region.diffPixels.toLocaleString()}
              <span className="imgcmp__zoom-divider">·</span>
              密度 {region.density}% · 强度 {region.avgIntensity}
            </p>
          </div>
          {/* 放大倍率切换器：role=radiogroup 无障碍 */}
          <div
            className="imgcmp__zoom-scale"
            role="radiogroup"
            aria-label="放大倍率"
          >
            {ZOOM_MULTIPLIERS.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={zoomMultiplier === m.value}
                className={`imgcmp__zoom-scale-btn${zoomMultiplier === m.value ? ' imgcmp__zoom-scale-btn--active' : ''}`}
                onClick={() => setZoomMultiplier(m.value)}
                disabled={state.loading}
                title={`放大至 ${ZOOM_BASE_SIZE * m.value}px 最长边`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className="imgcmp__zoom-close"
            onClick={onClose}
            aria-label="关闭放大查看（ESC）"
          >
            ×
          </button>
        </header>

        {/* 中部：三联放大图 */}
        <div className="imgcmp__zoom-body">
          {state.loading && <div className="imgcmp__zoom-loading">正在提取区域并放大…</div>}
          {state.error && <div className="imgcmp__zoom-error" role="alert">{state.error}</div>}
          {!state.loading && !state.error && (
            <div className="imgcmp__zoom-triple">
              <figure className="imgcmp__zoom-figure">
                <figcaption className="imgcmp__zoom-caption">图片 A · {sourceA.file.name}</figcaption>
                <img src={state.urlA} alt={`区域 ${currentIndex + 1} 在图片 A 中的放大显示`} className="imgcmp__zoom-img" />
              </figure>
              <figure className="imgcmp__zoom-figure">
                <figcaption className="imgcmp__zoom-caption">图片 B · {sourceB.file.name}</figcaption>
                <img src={state.urlB} alt={`区域 ${currentIndex + 1} 在图片 B 中的放大显示`} className="imgcmp__zoom-img" />
              </figure>
              <figure className="imgcmp__zoom-figure">
                <figcaption className="imgcmp__zoom-caption">差异图（红色高亮）</figcaption>
                <img src={state.urlDiff} alt={`区域 ${currentIndex + 1} 在差异图中的放大显示`} className="imgcmp__zoom-img" />
              </figure>
            </div>
          )}
        </div>

        {/* 底部：导航按钮 + 下载合成图按钮 + 提示 */}
        <footer className="imgcmp__zoom-footer">
          <button
            type="button"
            className="imgcmp__zoom-nav"
            onClick={() => onNavigate(currentIndex - 1)}
            disabled={currentIndex <= 0}
            aria-label="上一个区域（←）"
          >
            ← 上一个
          </button>
          <button
            type="button"
            className="imgcmp__zoom-download"
            onClick={handleDownloadTriple}
            disabled={state.loading || composeState.loading || !!state.error || !state.urlA}
            aria-label="下载三联合成图（A/B/差异图并排 PNG）"
            title="将 A / B / 差异图三张放大图水平并排合成为单张 PNG 下载"
          >
            {composeState.loading ? '合成中…' : '⬇ 下载三联合成图'}
          </button>
          <span className="imgcmp__zoom-hint">使用 ← → 切换区域，ESC 关闭</span>
          <button
            type="button"
            className="imgcmp__zoom-nav"
            onClick={() => onNavigate(currentIndex + 1)}
            disabled={currentIndex >= total - 1}
            aria-label="下一个区域（→）"
          >
            下一个 →
          </button>
        </footer>
        {composeState.error && (
          <div className="imgcmp__zoom-compose-error" role="alert">
            合成图下载失败：{composeState.error}
          </div>
        )}
      </div>
    </div>
  );
}
