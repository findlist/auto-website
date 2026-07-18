import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  loadImage,
  compareImagesDiffWithRegions,
  composeSideBySide,
  downloadDataUrl,
  downloadText,
  buildDiffExportJson,
  formatBytes,
  ACCEPTED_MIMES,
  DEFAULT_GRID_SIZE,
  type SourceImage,
  type CompareMode,
  type DiffResultWithRegions,
} from '../utils/imageCompare';

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
                    aria-hidden="true"
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
    </div>
  );
}
