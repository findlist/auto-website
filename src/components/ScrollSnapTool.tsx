import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS scroll-snap 滚动捕捉生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 容器属性：scroll-snap-type（axis + strictness）、scroll-padding、overflow
 *  - 子项属性：scroll-snap-align、scroll-snap-stop、scroll-margin
 *  - 可实际滚动的预览区，真实体验 snap 捕捉效果
 *  - 动态增删子项（3-8 个），点击选中后独立编辑
 *  - 8 组预设（横向轮播 / 全屏滚动 / 图片画廊 / 分页 / 卡片滑动 / 时间线 / 网格 / 自由）
 *  - 实时生成 CSS 代码，一键复制
 */

/** 滚动捕捉容器配置 */
interface SnapContainer {
  axis: 'x' | 'y' | 'both';
  strictness: 'mandatory' | 'proximity';
  scrollPadding: number; // 0-100px
  overflow: 'auto' | 'hidden' | 'scroll';
}

/** 单个子项配置 */
interface SnapItem {
  id: number;
  label: string;
  snapAlign: 'none' | 'start' | 'center' | 'end';
  snapStop: 'normal' | 'always';
  scrollMargin: number; // 0-100px
  size: number; // 子项尺寸（横向为 width，纵向为 height），120-400px
}

/** 预设布局 */
interface SnapPreset {
  name: string;
  container: Partial<SnapContainer>;
  items?: Partial<SnapItem>[];
}

// 8 组预设，覆盖 scroll-snap 最常见的应用场景
const PRESETS: SnapPreset[] = [
  {
    name: '横向轮播',
    container: { axis: 'x', strictness: 'mandatory', scrollPadding: 0 },
    items: [
      { snapAlign: 'center', size: 240 },
      { snapAlign: 'center', size: 240 },
      { snapAlign: 'center', size: 240 },
      { snapAlign: 'center', size: 240 },
      { snapAlign: 'center', size: 240 },
    ],
  },
  {
    name: '全屏滚动',
    container: { axis: 'y', strictness: 'mandatory', scrollPadding: 0 },
    items: [
      { snapAlign: 'start', size: 320 },
      { snapAlign: 'start', size: 320 },
      { snapAlign: 'start', size: 320 },
      { snapAlign: 'start', size: 320 },
    ],
  },
  {
    name: '图片画廊',
    container: { axis: 'x', strictness: 'mandatory', scrollPadding: 16 },
    items: [
      { snapAlign: 'center', size: 280 },
      { snapAlign: 'center', size: 280 },
      { snapAlign: 'center', size: 280 },
    ],
  },
  {
    name: '分页滚动',
    container: { axis: 'y', strictness: 'mandatory', scrollPadding: 20 },
    items: [
      { snapAlign: 'start', size: 280 },
      { snapAlign: 'start', size: 280 },
      { snapAlign: 'start', size: 280 },
    ],
  },
  {
    name: '卡片滑动',
    container: { axis: 'x', strictness: 'proximity', scrollPadding: 0 },
    items: [
      { snapAlign: 'center', size: 200 },
      { snapAlign: 'center', size: 200 },
      { snapAlign: 'center', size: 200 },
      { snapAlign: 'center', size: 200 },
    ],
  },
  {
    name: '垂直时间线',
    container: { axis: 'y', strictness: 'mandatory', scrollPadding: 12 },
    items: [
      { snapAlign: 'start', size: 180 },
      { snapAlign: 'start', size: 180 },
      { snapAlign: 'start', size: 180 },
      { snapAlign: 'start', size: 180 },
    ],
  },
  {
    name: '网格捕捉',
    container: { axis: 'both', strictness: 'mandatory', scrollPadding: 0 },
    items: [
      { snapAlign: 'start', size: 160 },
      { snapAlign: 'start', size: 160 },
      { snapAlign: 'start', size: 160 },
    ],
  },
  {
    name: '自由滑动',
    container: { axis: 'x', strictness: 'proximity', scrollPadding: 0 },
    items: [
      { snapAlign: 'none', size: 220 },
      { snapAlign: 'none', size: 220 },
      { snapAlign: 'none', size: 220 },
    ],
  },
];

// 唯一 id 递增计数器，保证子项 key 稳定
let itemIdSeq = 1;
const nextId = () => itemIdSeq++;

// 默认容器配置
const DEFAULT_CONTAINER: SnapContainer = {
  axis: 'x',
  strictness: 'mandatory',
  scrollPadding: 0,
  overflow: 'auto',
};

// 创建默认子项
function createDefaultItem(index: number): SnapItem {
  return {
    id: nextId(),
    label: `${index + 1}`,
    snapAlign: 'center',
    snapStop: 'normal',
    scrollMargin: 0,
    size: 240,
  };
}

// 子项的循环配色（8 色循环，与 FlexboxTool 保持一致）
const ITEM_COLORS = [
  '#2b6cff', '#7a4cff', '#dc2626', '#16a34a',
  '#ea580c', '#0891b2', '#9333ea', '#65a30d',
];

/** 泛型分段按钮组，用于枚举类型属性选择 */
function SegGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; text: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="snp__seg-group" aria-label={label}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`snp__seg-btn${opt.value === value ? ' is-active' : ''}`}
          onClick={() => onChange(opt.value)}
          disabled={disabled}
        >
          {opt.text}
        </button>
      ))}
    </div>
  );
}

/** 生成容器 CSS 代码（仅输出非默认值） */
function buildContainerCss(c: SnapContainer): string {
  const lines: string[] = [];
  // overflow：scroll-snap-type 要求容器可滚动
  const overflowValue =
    c.axis === 'both'
      ? 'auto'
      : c.axis === 'x'
        ? `${c.overflow} hidden`
        : `hidden ${c.overflow}`;
  lines.push(`overflow: ${overflowValue};`);
  // scroll-snap-type
  lines.push(`scroll-snap-type: ${c.axis} ${c.strictness};`);
  // scroll-padding（非 0 时输出）
  if (c.scrollPadding > 0) {
    lines.push(`scroll-padding: ${c.scrollPadding}px;`);
  }
  return lines.join('\n');
}

/** 生成子项 CSS 代码（仅输出非默认值） */
function buildItemCss(item: SnapItem, axis: 'x' | 'y' | 'both'): string {
  const lines: string[] = [];
  // 尺寸：横向时为 width，纵向时为 height，both 时为 width + height
  if (axis === 'x' || axis === 'both') {
    lines.push(`width: ${item.size}px;`);
  }
  if (axis === 'y' || axis === 'both') {
    lines.push(`height: ${item.size}px;`);
  }
  // scroll-snap-align（非 none 时输出）
  if (item.snapAlign !== 'none') {
    lines.push(`scroll-snap-align: ${item.snapAlign};`);
  }
  // scroll-snap-stop（非默认 normal 时输出）
  if (item.snapStop !== 'normal') {
    lines.push(`scroll-snap-stop: ${item.snapStop};`);
  }
  // scroll-margin（非 0 时输出）
  if (item.scrollMargin > 0) {
    lines.push(`scroll-margin: ${item.scrollMargin}px;`);
  }
  return lines.join('\n');
}

export default function ScrollSnapTool() {
  const [container, setContainer] = useState<SnapContainer>(DEFAULT_CONTAINER);
  // 初始化 5 个默认子项
  const [items, setItems] = useState<SnapItem[]>(() =>
    Array.from({ length: 5 }, (_, i) => createDefaultItem(i)),
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  // 当前选中的子项
  const selectedItem = useMemo(
    () => items.find((it) => it.id === selectedId) ?? null,
    [items, selectedId],
  );

  // 应用预设
  const applyPreset = useCallback((preset: SnapPreset) => {
    setContainer((prev) => ({ ...prev, ...preset.container }));
    if (preset.items) {
      const newItems = preset.items.map((p, i) => ({
        ...createDefaultItem(i),
        ...p,
      }));
      setItems(newItems);
      setSelectedId(null);
    }
  }, []);

  // 增删子项（约束 3-8 个）
  const addItem = useCallback(() => {
    setItems((prev) => (prev.length >= 8 ? prev : [...prev, createDefaultItem(prev.length)]));
  }, []);
  const removeItem = useCallback(
    (id: number) => {
      setItems((prev) =>
        prev.length <= 3 ? prev : prev.filter((it) => it.id !== id),
      );
      setSelectedId((cur) => (cur === id ? null : cur));
    },
    [],
  );

  // 更新选中子项属性
  const updateSelectedItem = useCallback(
    (patch: Partial<SnapItem>) => {
      if (selectedId === null) return;
      setItems((prev) =>
        prev.map((it) => (it.id === selectedId ? { ...it, ...patch } : it)),
      );
    },
    [selectedId],
  );

  // 生成完整 CSS 代码
  const cssCode = useMemo(() => {
    const containerCss = buildContainerCss(container);
    const itemCss = selectedItem
      ? buildItemCss(selectedItem, container.axis)
      : buildItemCss(items[0], container.axis);
    const selector = selectedItem ? `.item-${selectedItem.label}` : '.item';
    return `/* 滚动容器 */\n.scroll-container {\n  ${containerCss.replace(/\n/g, '\n  ')}\n}\n\n/* 子项 */\n${selector} {\n  ${itemCss.replace(/\n/g, '\n  ')}\n}`;
  }, [container, selectedItem, items]);

  // 复制代码
  const handleCopy = useCallback(async () => {
    const ok = await copyText(cssCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [cssCode]);

  // 预览容器样式
  const previewContainerStyle = useMemo<React.CSSProperties>(() => {
    const isX = container.axis === 'x';
    const isY = container.axis === 'y';
    const isBoth = container.axis === 'both';
    return {
      overflowX: isX || isBoth ? container.overflow : 'hidden',
      overflowY: isY || isBoth ? container.overflow : 'hidden',
      scrollSnapType: `${container.axis} ${container.strictness}`,
      scrollPadding: container.scrollPadding > 0 ? `${container.scrollPadding}px` : undefined,
      display: isBoth ? 'flex' : 'flex',
      flexDirection: isY ? 'column' : 'row',
      gap: '12px',
      padding: '16px',
    };
  }, [container]);

  return (
    <div className="snp">
      {/* 预设按钮组 */}
      <div className="snp__presets">
        <span className="snp__presets-label">预设：</span>
        {PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            className="snp__preset-btn"
            onClick={() => applyPreset(p)}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="snp__main">
        {/* 左侧：预览区 + 容器配置 */}
        <div className="snp__left">
          {/* 可滚动预览区 */}
          <div className="snp__preview-wrap">
            <div className="snp__preview-hint">
              <span>← 滚动预览区体验捕捉效果 →</span>
              <button
                type="button"
                className="snp__add-btn"
                onClick={addItem}
                disabled={items.length >= 8}
              >
                + 添加子项（{items.length}/8）
              </button>
            </div>
            <div className="snp__preview" style={previewContainerStyle}>
              {items.map((item, i) => {
                const isSel = item.id === selectedId;
                const itemStyle: React.CSSProperties = {
                  scrollSnapAlign: item.snapAlign,
                  scrollSnapStop: item.snapStop,
                  scrollMargin: item.scrollMargin > 0 ? `${item.scrollMargin}px` : undefined,
                  background: ITEM_COLORS[i % ITEM_COLORS.length],
                  width:
                    container.axis === 'x' || container.axis === 'both'
                      ? `${item.size}px`
                      : container.axis === 'y'
                        ? '100%'
                        : undefined,
                  height:
                    container.axis === 'y' || container.axis === 'both'
                      ? `${item.size}px`
                      : container.axis === 'x'
                        ? '160px'
                        : undefined,
                  flexShrink: 0,
                };
                return (
                  <div
                    key={item.id}
                    className={`snp__item${isSel ? ' is-selected' : ''}`}
                    style={itemStyle}
                    onClick={() => setSelectedId(isSel ? null : item.id)}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="snp__item-label">{item.label}</span>
                    {items.length > 3 && (
                      <button
                        type="button"
                        className="snp__item-del"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeItem(item.id);
                        }}
                        aria-label={`删除子项 ${item.label}`}
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 容器配置面板 */}
          <div className="snp__panel">
            <h3 className="snp__panel-title">容器属性</h3>
            <div className="snp__field">
              <label className="snp__field-label">滚动轴（scroll-snap-type）</label>
              <SegGroup
                label="滚动轴"
                value={container.axis}
                options={[
                  { value: 'x', text: '横向 x' },
                  { value: 'y', text: '纵向 y' },
                  { value: 'both', text: '双向 both' },
                ]}
                onChange={(v) => setContainer((p) => ({ ...p, axis: v }))}
              />
            </div>
            <div className="snp__field">
              <label className="snp__field-label">捕捉严格度</label>
              <SegGroup
                label="严格度"
                value={container.strictness}
                options={[
                  { value: 'mandatory', text: 'mandatory（强制）' },
                  { value: 'proximity', text: 'proximity（就近）' },
                ]}
                onChange={(v) => setContainer((p) => ({ ...p, strictness: v }))}
              />
            </div>
            <div className="snp__field">
              <label className="snp__field-label">
                scroll-padding：<span className="snp__value">{container.scrollPadding}px</span>
              </label>
              <input
                type="range"
                min={0}
                max={100}
                value={container.scrollPadding}
                onChange={(e) =>
                  setContainer((p) => ({ ...p, scrollPadding: Number(e.target.value) }))
                }
              />
            </div>
          </div>
        </div>

        {/* 右侧：选中项编辑 + 代码输出 */}
        <div className="snp__right">
          {/* 选中项属性编辑 */}
          <div className="snp__panel">
            <h3 className="snp__panel-title">
              {selectedItem ? `子项 ${selectedItem.label} 属性` : '点击预览区子项编辑属性'}
            </h3>
            {selectedItem && (
              <>
                <div className="snp__field">
                  <label className="snp__field-label">scroll-snap-align</label>
                  <SegGroup
                    label="对齐方式"
                    value={selectedItem.snapAlign}
                    options={[
                      { value: 'none', text: 'none' },
                      { value: 'start', text: 'start' },
                      { value: 'center', text: 'center' },
                      { value: 'end', text: 'end' },
                    ]}
                    onChange={(v) => updateSelectedItem({ snapAlign: v })}
                  />
                </div>
                <div className="snp__field">
                  <label className="snp__field-label">scroll-snap-stop</label>
                  <SegGroup
                    label="停止方式"
                    value={selectedItem.snapStop}
                    options={[
                      { value: 'normal', text: 'normal' },
                      { value: 'always', text: 'always' },
                    ]}
                    onChange={(v) => updateSelectedItem({ snapStop: v })}
                  />
                </div>
                <div className="snp__field">
                  <label className="snp__field-label">
                    scroll-margin：<span className="snp__value">{selectedItem.scrollMargin}px</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={selectedItem.scrollMargin}
                    onChange={(e) =>
                      updateSelectedItem({ scrollMargin: Number(e.target.value) })
                    }
                  />
                </div>
                <div className="snp__field">
                  <label className="snp__field-label">
                    子项尺寸：<span className="snp__value">{selectedItem.size}px</span>
                  </label>
                  <input
                    type="range"
                    min={120}
                    max={400}
                    value={selectedItem.size}
                    onChange={(e) =>
                      updateSelectedItem({ size: Number(e.target.value) })
                    }
                  />
                </div>
              </>
            )}
          </div>

          {/* 代码输出 */}
          <div className="snp__code">
            <div className="snp__code-head">
              <span>CSS 代码</span>
              <button
                type="button"
                className={`snp__copy-btn${copied ? ' is-copied' : ''}`}
                onClick={handleCopy}
              >
                {copied ? '已复制' : '复制'}
              </button>
            </div>
            <pre className="snp__code-block">
              <code>{cssCode}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
