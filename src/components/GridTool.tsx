import { useState, useMemo, useCallback, type CSSProperties } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS Grid 可视化生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 容器属性全可视化：display / grid-template-columns / grid-template-rows /
 *    gap(row-gap+column-gap) / justify-items / align-items /
 *    justify-content / align-content / grid-auto-flow
 *  - 单项属性独立编辑：grid-column span / grid-row span / justify-self / align-self
 *  - 动态增删 grid 项（2-12 个），点击选中后右侧面板编辑
 *  - 8 组预设布局（三列等宽 / 圣杯 / 侧栏+主内容 / 卡片网格 /
 *    Header-Main-Footer / 杂志布局 / 垂直堆叠 / 水平排列）
 *  - 实时预览 + 一键复制 CSS 代码（容器 + 选中项）
 */

/** 单条 grid 轨道（track）定义，支持 fr / px / % / auto 四种类型 */
type TrackType = 'fr' | 'px' | '%' | 'auto';
interface Track {
  id: number;
  type: TrackType;
  value: number; // auto 类型时不使用
}

/** Grid 容器属性集合 */
interface GridContainer {
  display: 'grid' | 'inline-grid';
  columns: Track[]; // grid-template-columns
  rows: Track[]; // grid-template-rows
  rowGap: number;
  columnGap: number;
  justifyItems: 'stretch' | 'start' | 'end' | 'center';
  alignItems: 'stretch' | 'start' | 'end' | 'center';
  justifyContent: 'start' | 'end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
  alignContent: 'start' | 'end' | 'center' | 'space-between' | 'space-around' | 'space-evenly' | 'stretch';
  autoFlow: 'row' | 'column' | 'row dense' | 'column dense';
}

/** 单个 grid 项属性 */
interface GridItem {
  id: number;
  label: string;
  colSpan: number; // grid-column: span N，1 表示默认位置
  rowSpan: number; // grid-row: span N
  justifySelf: 'auto' | 'start' | 'end' | 'center' | 'stretch';
  alignSelf: 'auto' | 'start' | 'end' | 'center' | 'stretch';
}

/** 预设布局 */
interface GridPreset {
  name: string;
  container: Partial<GridContainer>;
  items?: Partial<GridItem>[];
}

// 8 组预设，覆盖 grid 最常用的布局场景
const PRESETS: GridPreset[] = [
  {
    name: '三列等宽',
    container: {
      columns: [
        { id: 1, type: 'fr', value: 1 },
        { id: 2, type: 'fr', value: 1 },
        { id: 3, type: 'fr', value: 1 },
      ],
      rows: [],
      columnGap: 16,
      rowGap: 16,
    },
  },
  {
    name: '圣杯布局',
    container: {
      columns: [
        { id: 1, type: 'px', value: 200 },
        { id: 2, type: 'fr', value: 1 },
        { id: 3, type: 'px', value: 200 },
      ],
      rows: [{ id: 4, type: 'px', value: 120 }],
      columnGap: 12,
      rowGap: 12,
    },
    items: [
      { colSpan: 1, rowSpan: 1 },
      { colSpan: 1, rowSpan: 1 },
      { colSpan: 1, rowSpan: 1 },
    ],
  },
  {
    name: '侧栏+主内容',
    container: {
      columns: [
        { id: 1, type: 'px', value: 240 },
        { id: 2, type: 'fr', value: 1 },
      ],
      rows: [],
      columnGap: 16,
    },
  },
  {
    name: '卡片网格',
    container: {
      columns: [
        { id: 1, type: 'fr', value: 1 },
        { id: 2, type: 'fr', value: 1 },
        { id: 3, type: 'fr', value: 1 },
        { id: 4, type: 'fr', value: 1 },
      ],
      rows: [],
      columnGap: 12,
      rowGap: 12,
      autoFlow: 'row',
    },
  },
  {
    name: 'Header-Main-Footer',
    container: {
      columns: [{ id: 1, type: 'fr', value: 1 }],
      rows: [
        { id: 1, type: 'px', value: 80 },
        { id: 2, type: 'fr', value: 1 },
        { id: 3, type: 'px', value: 60 },
      ],
      rowGap: 12,
    },
  },
  {
    name: '杂志布局',
    container: {
      columns: [
        { id: 1, type: 'fr', value: 2 },
        { id: 2, type: 'fr', value: 1 },
        { id: 3, type: 'fr', value: 1 },
      ],
      rows: [
        { id: 1, type: 'px', value: 150 },
        { id: 2, type: 'px', value: 150 },
      ],
      columnGap: 12,
      rowGap: 12,
    },
    items: [
      { colSpan: 2, rowSpan: 1 },
      { colSpan: 1, rowSpan: 2 },
      { colSpan: 1, rowSpan: 1 },
    ],
  },
  {
    name: '垂直堆叠',
    container: {
      columns: [{ id: 1, type: 'fr', value: 1 }],
      rows: [],
      rowGap: 12,
    },
  },
  {
    name: '水平排列',
    container: {
      columns: [],
      rows: [{ id: 1, type: 'px', value: 80 }],
      columnGap: 12,
      autoFlow: 'column',
    },
  },
];

// 唯一 id 递增计数器，保证 track 与 item 的 key 稳定
let trackIdSeq = 100;
const nextTrackId = () => trackIdSeq++;
let itemIdSeq = 1;
const nextItemId = () => itemIdSeq++;

// 默认容器配置：3 列等宽
const DEFAULT_CONTAINER: GridContainer = {
  display: 'grid',
  columns: [
    { id: 1, type: 'fr', value: 1 },
    { id: 2, type: 'fr', value: 1 },
    { id: 3, type: 'fr', value: 1 },
  ],
  rows: [],
  rowGap: 12,
  columnGap: 12,
  justifyItems: 'stretch',
  alignItems: 'stretch',
  justifyContent: 'start',
  alignContent: 'start',
  autoFlow: 'row',
};

// 创建默认 grid 项
function createDefaultItem(index: number): GridItem {
  return {
    id: nextItemId(),
    label: `项 ${index + 1}`,
    colSpan: 1,
    rowSpan: 1,
    justifySelf: 'auto',
    alignSelf: 'auto',
  };
}

// 项的循环配色（8 色循环，避免引入额外依赖）
const ITEM_COLORS = [
  '#2b6cff', '#7a4cff', '#dc2626', '#16a34a',
  '#ea580c', '#0891b2', '#9333ea', '#65a30d',
  '#db2777', '#0d9488', '#ca8a04', '#4f46e5',
];

/** 将单条 track 转为 CSS 片段，如 "1fr"、"200px"、"50%"、"auto" */
function trackToCss(t: Track): string {
  if (t.type === 'auto') return 'auto';
  return `${t.value}${t.type}`;
}

/** 将 track 数组转为 grid-template-* 的值 */
function tracksToCss(tracks: Track[]): string {
  if (tracks.length === 0) return 'none';
  return tracks.map(trackToCss).join(' ');
}

/** 生成容器 CSS 代码（仅输出非默认值，保持代码简洁） */
function buildContainerCss(c: GridContainer): string {
  const lines: string[] = ['.container {'];
  lines.push(`  display: ${c.display};`);
  // grid-template-columns 为 none 时不输出，避免冗余
  if (c.columns.length > 0) {
    lines.push(`  grid-template-columns: ${tracksToCss(c.columns)};`);
  }
  if (c.rows.length > 0) {
    lines.push(`  grid-template-rows: ${tracksToCss(c.rows)};`);
  }
  if (c.rowGap > 0 || c.columnGap > 0) {
    // gap 简写：行列相等时单值，不等时双值
    if (c.rowGap === c.columnGap) {
      lines.push(`  gap: ${c.rowGap}px;`);
    } else {
      lines.push(`  gap: ${c.rowGap}px ${c.columnGap}px;`);
    }
  }
  if (c.justifyItems !== 'stretch') lines.push(`  justify-items: ${c.justifyItems};`);
  if (c.alignItems !== 'stretch') lines.push(`  align-items: ${c.alignItems};`);
  if (c.justifyContent !== 'start') lines.push(`  justify-content: ${c.justifyContent};`);
  if (c.alignContent !== 'start') lines.push(`  align-content: ${c.alignContent};`);
  if (c.autoFlow !== 'row') lines.push(`  grid-auto-flow: ${c.autoFlow};`);
  lines.push('}');
  return lines.join('\n');
}

/** 生成单项 CSS 代码（仅输出非默认值，保持代码简洁） */
function buildItemCss(item: GridItem): string {
  const lines: string[] = ['.item {'];
  if (item.colSpan !== 1) lines.push(`  grid-column: span ${item.colSpan};`);
  if (item.rowSpan !== 1) lines.push(`  grid-row: span ${item.rowSpan};`);
  if (item.justifySelf !== 'auto') lines.push(`  justify-self: ${item.justifySelf};`);
  if (item.alignSelf !== 'auto') lines.push(`  align-self: ${item.alignSelf};`);
  if (lines.length === 1) {
    lines.push('  /* 默认值，无需显式声明 */');
  }
  lines.push('}');
  return lines.join('\n');
}

/** 通用按钮组：用于枚举型属性选择 */
function ButtonGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`grd__field${disabled ? ' grd__field--disabled' : ''}`}>
      <span className="grd__field-label">{label}</span>
      <div className="grd__btn-group" role="radiogroup" aria-label={label}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={value === opt.value}
            className={`grd__btn-option${value === opt.value ? ' grd__btn-option--active' : ''}`}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// 单条 track 的编辑器
function TrackEditor({
  track,
  index,
  onChange,
  onRemove,
  canRemove,
}: {
  track: Track;
  index: number;
  onChange: (patch: Partial<Track>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  return (
    <div className="grd__track">
      <span className="grd__track-index">{index + 1}</span>
      <div className="grd__btn-group grd__btn-group--track">
        {(['fr', 'px', '%', 'auto'] as const).map((tp) => (
          <button
            key={tp}
            type="button"
            className={`grd__btn-option grd__btn-option--track${track.type === tp ? ' grd__btn-option--active' : ''}`}
            onClick={() => onChange({ type: tp })}
            aria-pressed={track.type === tp}
          >
            {tp}
          </button>
        ))}
      </div>
      {track.type !== 'auto' ? (
        <input
          type="number"
          min="1"
          max="1000"
          value={track.value}
          onChange={(e) => onChange({ value: Math.max(1, Number(e.target.value) || 1) })}
          className="grd__track-input"
          aria-label={`轨道 ${index + 1} 数值`}
        />
      ) : (
        <span className="grd__track-auto">自动</span>
      )}
      <button
        type="button"
        className="grd__btn grd__btn--remove-track"
        onClick={onRemove}
        disabled={!canRemove}
        aria-label={`删除轨道 ${index + 1}`}
      >
        ×
      </button>
    </div>
  );
}

// 选项常量集中定义，避免在 JSX 中重复内联
const JUSTIFY_ITEMS_OPTIONS = [
  { value: 'stretch' as const, label: '拉伸' },
  { value: 'start' as const, label: '起始' },
  { value: 'center' as const, label: '居中' },
  { value: 'end' as const, label: '末尾' },
];
const ALIGN_ITEMS_OPTIONS = JUSTIFY_ITEMS_OPTIONS;
const JUSTIFY_CONTENT_OPTIONS = [
  { value: 'start' as const, label: '起始' },
  { value: 'center' as const, label: '居中' },
  { value: 'end' as const, label: '末尾' },
  { value: 'space-between' as const, label: '两端' },
  { value: 'space-around' as const, label: '环绕' },
  { value: 'space-evenly' as const, label: '均布' },
];
const ALIGN_CONTENT_OPTIONS = [
  ...JUSTIFY_CONTENT_OPTIONS,
  { value: 'stretch' as const, label: '拉伸' },
];
const AUTO_FLOW_OPTIONS = [
  { value: 'row' as const, label: '行优先' },
  { value: 'column' as const, label: '列优先' },
  { value: 'row dense' as const, label: '行密集' },
  { value: 'column dense' as const, label: '列密集' },
];
const ALIGN_SELF_OPTIONS = [
  { value: 'auto' as const, label: '继承' },
  { value: 'stretch' as const, label: '拉伸' },
  { value: 'start' as const, label: '起始' },
  { value: 'center' as const, label: '居中' },
  { value: 'end' as const, label: '末尾' },
];

export default function GridTool() {
  // 初始化为 6 个默认项（适配 3 列 2 行的默认网格）
  const [container, setContainer] = useState<GridContainer>(DEFAULT_CONTAINER);
  const [items, setItems] = useState<GridItem[]>(() => [
    createDefaultItem(0),
    createDefaultItem(1),
    createDefaultItem(2),
    createDefaultItem(3),
    createDefaultItem(4),
    createDefaultItem(5),
  ]);
  const [selectedId, setSelectedId] = useState<number | null>(items[0]?.id ?? null);
  const [copied, setCopied] = useState(false);

  const selectedItem = useMemo(
    () => items.find((it) => it.id === selectedId) ?? null,
    [items, selectedId]
  );

  // 容器与选中项的 CSS 代码合并输出
  const cssCode = useMemo(() => {
    const parts = [buildContainerCss(container)];
    if (selectedItem) parts.push(buildItemCss(selectedItem));
    return parts.join('\n\n');
  }, [container, selectedItem]);

  // 预览区 inline style：将容器配置映射为 CSS 属性
  const stageStyle = useMemo<CSSProperties>(() => {
    const style: CSSProperties = {
      display: container.display,
      rowGap: `${container.rowGap}px`,
      columnGap: `${container.columnGap}px`,
      justifyItems: container.justifyItems,
      alignItems: container.alignItems,
      justifyContent: container.justifyContent,
      alignContent: container.alignContent,
      gridAutoFlow: container.autoFlow,
    };
    if (container.columns.length > 0) {
      style.gridTemplateColumns = tracksToCss(container.columns);
    }
    if (container.rows.length > 0) {
      style.gridTemplateRows = tracksToCss(container.rows);
    }
    return style;
  }, [container]);

  // 容器属性部分更新
  const patchContainer = useCallback((patch: Partial<GridContainer>) => {
    setContainer((prev) => ({ ...prev, ...patch }));
  }, []);

  // 选中项属性部分更新
  const patchItem = useCallback((id: number, patch: Partial<GridItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  // 新增列轨道（上限 12，超过预览体验下降）
  const addColumn = useCallback(() => {
    setContainer((prev) => {
      if (prev.columns.length >= 12) return prev;
      return {
        ...prev,
        columns: [...prev.columns, { id: nextTrackId(), type: 'fr', value: 1 }],
      };
    });
  }, []);

  // 新增行轨道
  const addRow = useCallback(() => {
    setContainer((prev) => {
      if (prev.rows.length >= 12) return prev;
      return {
        ...prev,
        rows: [...prev.rows, { id: nextTrackId(), type: 'px', value: 100 }],
      };
    });
  }, []);

  // 更新指定列轨道
  const patchColumn = useCallback((id: number, patch: Partial<Track>) => {
    setContainer((prev) => ({
      ...prev,
      columns: prev.columns.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  }, []);

  // 更新指定行轨道
  const patchRow = useCallback((id: number, patch: Partial<Track>) => {
    setContainer((prev) => ({
      ...prev,
      rows: prev.rows.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  }, []);

  // 删除列轨道
  const removeColumn = useCallback((id: number) => {
    setContainer((prev) => ({
      ...prev,
      columns: prev.columns.length > 0 ? prev.columns.filter((t) => t.id !== id) : prev.columns,
    }));
  }, []);

  // 删除行轨道
  const removeRow = useCallback((id: number) => {
    setContainer((prev) => ({
      ...prev,
      rows: prev.rows.length > 0 ? prev.rows.filter((t) => t.id !== id) : prev.rows,
    }));
  }, []);

  // 新增项（上限 12 个）
  const addItem = useCallback(() => {
    setItems((prev) => {
      if (prev.length >= 12) return prev;
      const item = createDefaultItem(prev.length);
      setSelectedId(item.id);
      return [...prev, item];
    });
  }, []);

  // 删除项（保留下限 2 个）
  const removeItem = useCallback((id: number) => {
    setItems((prev) => {
      if (prev.length <= 2) return prev;
      const next = prev.filter((it) => it.id !== id);
      if (selectedId === id) {
        setSelectedId(next[0]?.id ?? null);
      }
      return next;
    });
  }, [selectedId]);

  // 应用预设：容器属性覆盖，可选项属性同步
  const applyPreset = useCallback((preset: GridPreset) => {
    setContainer((prev) => {
      const merged = { ...prev, ...preset.container };
      // 预设若未指定 columns/rows，保留空数组语义
      if (preset.container.columns) merged.columns = preset.container.columns;
      if (preset.container.rows) merged.rows = preset.container.rows;
      return merged;
    });
    if (preset.items) {
      setItems((prev) =>
        prev.map((it, i) => ({
          ...it,
          ...(preset.items?.[i] ?? {}),
        }))
      );
    }
  }, []);

  // 复制 CSS 代码到剪贴板
  const handleCopy = useCallback(async () => {
    const ok = await copyText(cssCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [cssCode]);

  return (
    <div className="grd">
      {/* 预览区 */}
      <div className="grd__preview">
        <div className="grd__stage" style={stageStyle}>
          {items.map((it, i) => (
            <div
              key={it.id}
              className={`grd__item${it.id === selectedId ? ' grd__item--selected' : ''}`}
              style={{
                gridColumn: it.colSpan !== 1 ? `span ${it.colSpan}` : undefined,
                gridRow: it.rowSpan !== 1 ? `span ${it.rowSpan}` : undefined,
                justifySelf: it.justifySelf !== 'auto' ? it.justifySelf : undefined,
                alignSelf: it.alignSelf !== 'auto' ? it.alignSelf : undefined,
                background: ITEM_COLORS[i % ITEM_COLORS.length],
              }}
              onClick={() => setSelectedId(it.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedId(it.id);
                }
              }}
              aria-pressed={it.id === selectedId}
              aria-label={`${it.label}，点击编辑`}
            >
              <span className="grd__item-label">{it.label}</span>
              {(it.colSpan !== 1 || it.rowSpan !== 1 || it.justifySelf !== 'auto' || it.alignSelf !== 'auto') && (
                <span className="grd__item-badge">已自定义</span>
              )}
              <button
                type="button"
                className="grd__item-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  removeItem(it.id);
                }}
                aria-label={`删除 ${it.label}`}
                disabled={items.length <= 2}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 预设按钮组 */}
      <div className="grd__presets">
        <span className="grd__presets-label">预设：</span>
        {PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            className="grd__btn grd__btn--preset"
            onClick={() => applyPreset(p)}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* 控制面板：左容器 / 右选中项 */}
      <div className="grd__panels">
        {/* 容器属性面板 */}
        <div className="grd__panel">
          <h3 className="grd__panel-title">容器属性（.container）</h3>
          <ButtonGroup
            label="display"
            value={container.display}
            options={[
              { value: 'grid' as const, label: 'grid' },
              { value: 'inline-grid' as const, label: 'inline-grid' },
            ]}
            onChange={(v) => patchContainer({ display: v })}
          />

          {/* 列轨道编辑器 */}
          <div className="grd__field">
            <div className="grd__field-head">
              <span className="grd__field-label">grid-template-columns（{container.columns.length} 条）</span>
              <button
                type="button"
                className="grd__btn grd__btn--add-track"
                onClick={addColumn}
                disabled={container.columns.length >= 12}
              >
                + 列
              </button>
            </div>
            {container.columns.length === 0 && (
              <p className="grd__track-empty">未定义列轨道，由 grid-auto-flow 自动决定</p>
            )}
            {container.columns.map((t, i) => (
              <TrackEditor
                key={t.id}
                track={t}
                index={i}
                onChange={(patch) => patchColumn(t.id, patch)}
                onRemove={() => removeColumn(t.id)}
                canRemove={container.columns.length > 0}
              />
            ))}
          </div>

          {/* 行轨道编辑器 */}
          <div className="grd__field">
            <div className="grd__field-head">
              <span className="grd__field-label">grid-template-rows（{container.rows.length} 条）</span>
              <button
                type="button"
                className="grd__btn grd__btn--add-track"
                onClick={addRow}
                disabled={container.rows.length >= 12}
              >
                + 行
              </button>
            </div>
            {container.rows.length === 0 && (
              <p className="grd__track-empty">未定义行轨道，由内容自动撑开</p>
            )}
            {container.rows.map((t, i) => (
              <TrackEditor
                key={t.id}
                track={t}
                index={i}
                onChange={(patch) => patchRow(t.id, patch)}
                onRemove={() => removeRow(t.id)}
                canRemove={container.rows.length > 0}
              />
            ))}
          </div>

          <div className="grd__field">
            <span className="grd__field-label">
              column-gap 列间距 <output>{container.columnGap}px</output>
            </span>
            <input
              type="range"
              min="0"
              max="48"
              value={container.columnGap}
              onChange={(e) => patchContainer({ columnGap: Number(e.target.value) })}
              aria-label="列间距 column-gap"
            />
          </div>
          <div className="grd__field">
            <span className="grd__field-label">
              row-gap 行间距 <output>{container.rowGap}px</output>
            </span>
            <input
              type="range"
              min="0"
              max="48"
              value={container.rowGap}
              onChange={(e) => patchContainer({ rowGap: Number(e.target.value) })}
              aria-label="行间距 row-gap"
            />
          </div>

          <ButtonGroup
            label="justify-items 横向对齐"
            value={container.justifyItems}
            options={JUSTIFY_ITEMS_OPTIONS}
            onChange={(v) => patchContainer({ justifyItems: v })}
          />
          <ButtonGroup
            label="align-items 纵向对齐"
            value={container.alignItems}
            options={ALIGN_ITEMS_OPTIONS}
            onChange={(v) => patchContainer({ alignItems: v })}
          />
          <ButtonGroup
            label="justify-content 横向分布"
            value={container.justifyContent}
            options={JUSTIFY_CONTENT_OPTIONS}
            onChange={(v) => patchContainer({ justifyContent: v })}
          />
          <ButtonGroup
            label="align-content 纵向分布"
            value={container.alignContent}
            options={ALIGN_CONTENT_OPTIONS}
            onChange={(v) => patchContainer({ alignContent: v })}
          />
          <ButtonGroup
            label="grid-auto-flow 自动排列"
            value={container.autoFlow}
            options={AUTO_FLOW_OPTIONS}
            onChange={(v) => patchContainer({ autoFlow: v })}
          />
        </div>

        {/* 选中项属性面板 */}
        <div className="grd__panel">
          <h3 className="grd__panel-title">
            选中项属性
            {selectedItem && <span className="grd__panel-sub">（.item · {selectedItem.label}）</span>}
          </h3>
          {!selectedItem && <p className="grd__empty">点击预览区中的项以编辑其属性。</p>}
          {selectedItem && (
            <>
              <div className="grd__field">
                <span className="grd__field-label">
                  grid-column 跨列数 <output>span {selectedItem.colSpan}</output>
                </span>
                <input
                  type="range"
                  min="1"
                  max="6"
                  value={selectedItem.colSpan}
                  onChange={(e) => patchItem(selectedItem.id, { colSpan: Number(e.target.value) })}
                  aria-label="项跨列数 grid-column span"
                />
              </div>
              <div className="grd__field">
                <span className="grd__field-label">
                  grid-row 跨行数 <output>span {selectedItem.rowSpan}</output>
                </span>
                <input
                  type="range"
                  min="1"
                  max="6"
                  value={selectedItem.rowSpan}
                  onChange={(e) => patchItem(selectedItem.id, { rowSpan: Number(e.target.value) })}
                  aria-label="项跨行数 grid-row span"
                />
              </div>
              <ButtonGroup
                label="justify-self 单独横向对齐"
                value={selectedItem.justifySelf}
                options={[
                  { value: 'auto' as const, label: '继承' },
                  { value: 'stretch' as const, label: '拉伸' },
                  { value: 'start' as const, label: '起始' },
                  { value: 'center' as const, label: '居中' },
                  { value: 'end' as const, label: '末尾' },
                ]}
                onChange={(v) => patchItem(selectedItem.id, { justifySelf: v })}
              />
              <ButtonGroup
                label="align-self 单独纵向对齐"
                value={selectedItem.alignSelf}
                options={ALIGN_SELF_OPTIONS}
                onChange={(v) => patchItem(selectedItem.id, { alignSelf: v })}
              />
            </>
          )}
          <button
            type="button"
            className="grd__btn grd__btn--add"
            onClick={addItem}
            disabled={items.length >= 12}
          >
            + 添加项（{items.length}/12）
          </button>
        </div>
      </div>

      {/* CSS 代码输出 */}
      <div className="grd__output">
        <div className="grd__output-head">
          <span className="grd__output-label">CSS 代码</span>
          <button type="button" className="grd__btn grd__btn--copy" onClick={handleCopy}>
            {copied ? '已复制 ✓' : '复制'}
          </button>
        </div>
        <pre className="grd__code">{cssCode}</pre>
        <p className="grd__hint">
          当前共 {items.length} 个 grid 项，{container.columns.length} 列 / {container.rows.length} 行轨道，
          列间距 {container.columnGap}px，行间距 {container.rowGap}px。
          {selectedItem ? ` 已选中 ${selectedItem.label}，可在右侧编辑其单独属性。` : ' 点击预览中的项以编辑。'}
        </p>
      </div>
    </div>
  );
}
