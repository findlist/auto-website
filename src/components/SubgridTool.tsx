import { useState, useMemo, useCallback, type CSSProperties } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS subgrid 子网格生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 核心能力：
 *  - 父网格轨道定义（grid-template-columns / rows + gap）
 *  - 子网格 subgrid 方向切换（none / columns / rows / both）
 *  - 父子双层可视化预览，轨道对齐线高亮展示继承关系
 *  - 子网格跨列跨行配置（grid-column / grid-row span）
 *  - 智能代码生成（父容器 + 子网格容器完整 CSS）
 *  - 原理说明面板（subgrid 解决的痛点与工作机制）
 *  - 8 组预设覆盖典型嵌套对齐场景
 */

/** 单条轨道定义，支持 fr / px / % / auto / minmax / repeat */
type TrackType = 'fr' | 'px' | '%' | 'auto';
interface Track {
  id: number;
  type: TrackType;
  value: number; // auto 类型时不使用
}

/** subgrid 方向：none 不继承 / columns 继承列 / rows 继承行 / both 双向继承 */
type SubgridDirection = 'none' | 'columns' | 'rows' | 'both';

/** 父网格容器属性 */
interface ParentGrid {
  columns: Track[];
  rows: Track[];
  columnGap: number;
  rowGap: number;
}

/** 子网格容器属性 */
interface ChildGrid {
  direction: SubgridDirection;
  colSpan: number; // 子网格在父网格中跨列数
  rowSpan: number; // 子网格在父网格中跨行数
  itemCount: number; // 子网格内的项数量
  itemColumnGap: number; // 子网格内项之间列间距（仅 non-subgrid 方向生效）
  itemRowGap: number; // 子网格内项之间行间距
}

/** 完整配置 */
interface SubgridConfig {
  parentSelector: string;
  childSelector: string;
  parent: ParentGrid;
  child: ChildGrid;
}

/** 预设 */
interface SubgridPreset {
  name: string;
  description: string;
  config: SubgridConfig;
}

// 将单条轨道转换为 CSS 字符串
function trackToCss(t: Track): string {
  if (t.type === 'auto') return 'auto';
  return `${t.value}${t.type}`;
}

// 将轨道数组转换为 grid-template 值
function tracksToCss(tracks: Track[]): string {
  if (tracks.length === 0) return 'none';
  return tracks.map(trackToCss).join(' ');
}

// 默认配置：父网格 3 列等宽，子网格双向 subgrid
const DEFAULT_CONFIG: SubgridConfig = {
  parentSelector: '.parent',
  childSelector: '.child',
  parent: {
    columns: [
      { id: 1, type: 'fr', value: 1 },
      { id: 2, type: 'fr', value: 1 },
      { id: 3, type: 'fr', value: 1 },
    ],
    rows: [{ id: 4, type: 'px', value: 140 }],
    columnGap: 16,
    rowGap: 16,
  },
  child: {
    direction: 'both',
    colSpan: 3,
    rowSpan: 1,
    itemCount: 6,
    itemColumnGap: 12,
    itemRowGap: 12,
  },
};

// 8 组预设，覆盖 subgrid 典型嵌套对齐场景
const PRESETS: SubgridPreset[] = [
  {
    name: '默认双向继承',
    description: '子网格同时继承父网格的列与行轨道，最常见的对齐场景',
    config: DEFAULT_CONFIG,
  },
  {
    name: '仅列继承',
    description: '子网格只继承父网格列轨道，行轨道独立定义',
    config: {
      parentSelector: '.parent',
      childSelector: '.child',
      parent: {
        columns: [
          { id: 1, type: 'px', value: 200 },
          { id: 2, type: 'fr', value: 1 },
          { id: 3, type: 'px', value: 200 },
        ],
        rows: [{ id: 4, type: 'px', value: 160 }],
        columnGap: 16,
        rowGap: 16,
      },
      child: {
        direction: 'columns',
        colSpan: 3,
        rowSpan: 1,
        itemCount: 3,
        itemColumnGap: 0,
        itemRowGap: 12,
      },
    },
  },
  {
    name: '仅行继承',
    description: '子网格只继承父网格行轨道，列轨道独立定义',
    config: {
      parentSelector: '.parent',
      childSelector: '.child',
      parent: {
        columns: [
          { id: 1, type: 'fr', value: 1 },
          { id: 2, type: 'fr', value: 1 },
        ],
        rows: [
          { id: 3, type: 'px', value: 80 },
          { id: 4, type: 'px', value: 80 },
          { id: 5, type: 'px', value: 80 },
        ],
        columnGap: 16,
        rowGap: 16,
      },
      child: {
        direction: 'rows',
        colSpan: 1,
        rowSpan: 3,
        itemCount: 6,
        itemColumnGap: 12,
        itemRowGap: 0,
      },
    },
  },
  {
    name: '无继承（对比基线）',
    description: '子网格不继承父网格轨道，作为对比基线观察对齐差异',
    config: {
      parentSelector: '.parent',
      childSelector: '.child',
      parent: {
        columns: [
          { id: 1, type: 'fr', value: 1 },
          { id: 2, type: 'fr', value: 1 },
          { id: 3, type: 'fr', value: 1 },
        ],
        rows: [{ id: 4, type: 'px', value: 160 }],
        columnGap: 16,
        rowGap: 16,
      },
      child: {
        direction: 'none',
        colSpan: 3,
        rowSpan: 1,
        itemCount: 6,
        itemColumnGap: 8,
        itemRowGap: 8,
      },
    },
  },
  {
    name: '卡片墙列对齐',
    description: '卡片墙场景，子网格卡片内的列与父网格列对齐',
    config: {
      parentSelector: '.card-grid',
      childSelector: '.card',
      parent: {
        columns: [
          { id: 1, type: 'fr', value: 1 },
          { id: 2, type: 'fr', value: 1 },
          { id: 3, type: 'fr', value: 1 },
        ],
        rows: [{ id: 4, type: 'auto' as TrackType, value: 0 }],
        columnGap: 20,
        rowGap: 20,
      },
      child: {
        direction: 'columns',
        colSpan: 1,
        rowSpan: 1,
        itemCount: 3,
        itemColumnGap: 0,
        itemRowGap: 8,
      },
    },
  },
  {
    name: '表单标签对齐',
    description: '表单场景，标签与输入框通过 subgrid 列对齐',
    config: {
      parentSelector: '.form',
      childSelector: '.field',
      parent: {
        columns: [
          { id: 1, type: 'px', value: 100 },
          { id: 2, type: 'fr', value: 1 },
        ],
        rows: [
          { id: 3, type: 'auto' as TrackType, value: 0 },
          { id: 4, type: 'auto' as TrackType, value: 0 },
          { id: 5, type: 'auto' as TrackType, value: 0 },
        ],
        columnGap: 12,
        rowGap: 12,
      },
      child: {
        direction: 'columns',
        colSpan: 2,
        rowSpan: 1,
        itemCount: 2,
        itemColumnGap: 0,
        itemRowGap: 0,
      },
    },
  },
  {
    name: '杂志嵌套布局',
    description: '杂志式排版，主内容区子网格继承父网格列轨道',
    config: {
      parentSelector: '.magazine',
      childSelector: '.article',
      parent: {
        columns: [
          { id: 1, type: 'px', value: 160 },
          { id: 2, type: 'fr', value: 2 },
          { id: 3, type: 'fr', value: 1 },
        ],
        rows: [{ id: 4, type: 'px', value: 200 }],
        columnGap: 16,
        rowGap: 16,
      },
      child: {
        direction: 'columns',
        colSpan: 2,
        rowSpan: 1,
        itemCount: 4,
        itemColumnGap: 0,
        itemRowGap: 8,
      },
    },
  },
  {
    name: '双行嵌套对齐',
    description: '子网格跨父网格 2 行 2 列，双向继承轨道',
    config: {
      parentSelector: '.parent',
      childSelector: '.child',
      parent: {
        columns: [
          { id: 1, type: 'fr', value: 1 },
          { id: 2, type: 'fr', value: 1 },
          { id: 3, type: 'fr', value: 1 },
          { id: 4, type: 'fr', value: 1 },
        ],
        rows: [
          { id: 5, type: 'px', value: 100 },
          { id: 6, type: 'px', value: 100 },
        ],
        columnGap: 12,
        rowGap: 12,
      },
      child: {
        direction: 'both',
        colSpan: 2,
        rowSpan: 2,
        itemCount: 4,
        itemColumnGap: 0,
        itemRowGap: 0,
      },
    },
  },
];

// 方向选项
const DIRECTION_OPTIONS: { value: SubgridDirection; label: string; desc: string }[] = [
  { value: 'none', label: 'none', desc: '不继承，独立定义轨道（对比基线）' },
  { value: 'columns', label: 'columns', desc: '继承父网格列轨道' },
  { value: 'rows', label: 'rows', desc: '继承父网格行轨道' },
  { value: 'both', label: 'both', desc: '同时继承列与行轨道' },
];

/**
 * 生成父容器 CSS
 */
function buildParentCss(config: SubgridConfig): string {
  const { parent, parentSelector } = config;
  const lines: string[] = [];
  lines.push(`${parentSelector} &#123;`);
  lines.push(`  display: grid;`);
  lines.push(`  grid-template-columns: ${tracksToCss(parent.columns)};`);
  if (parent.rows.length > 0) {
    lines.push(`  grid-template-rows: ${tracksToCss(parent.rows)};`);
  }
  lines.push(`  gap: ${parent.rowGap}px ${parent.columnGap}px;`);
  lines.push(`&#125;`);
  return lines.join('\n');
}

/**
 * 生成子网格容器 CSS（核心：subgrid 声明）
 */
function buildChildCss(config: SubgridConfig): string {
  const { child, childSelector, parent } = config;
  const lines: string[] = [];
  lines.push(`${childSelector} &#123;`);
  lines.push(`  display: grid;`);
  // 跨列跨行定位
  if (child.colSpan > 1) {
    lines.push(`  grid-column: span ${child.colSpan};`);
  }
  if (child.rowSpan > 1) {
    lines.push(`  grid-row: span ${child.rowSpan};`);
  }
  // subgrid 核心声明
  if (child.direction === 'columns') {
    lines.push(`  grid-template-columns: subgrid;`);
  } else if (child.direction === 'rows') {
    lines.push(`  grid-template-rows: subgrid;`);
  } else if (child.direction === 'both') {
    lines.push(`  grid-template-columns: subgrid;`);
    lines.push(`  grid-template-rows: subgrid;`);
  } else {
    // none：独立定义轨道，用于对比
    if (child.itemCount > 0) {
      const colCount = Math.min(child.itemCount, parent.columns.length);
      const independentCols = Array.from({ length: colCount }, () => '1fr').join(' ');
      lines.push(`  grid-template-columns: ${independentCols};`);
    }
  }
  // gap：subgrid 方向下 gap 继承父网格，none 方向使用独立 gap
  if (child.direction === 'none') {
    lines.push(`  gap: ${child.itemRowGap}px ${child.itemColumnGap}px;`);
  } else {
    lines.push(`  /* subgrid 方向下 gap 自动继承父网格 */`);
  }
  lines.push(`&#125;`);
  return lines.join('\n');
}

/**
 * 生成完整 CSS 代码
 */
function buildFullCss(config: SubgridConfig): string {
  return [buildParentCss(config), '', buildChildCss(config)].join('\n');
}

/**
 * 生成原理说明
 */
function buildExplain(config: SubgridConfig): string {
  const { child, parent } = config;
  const parts: string[] = [];

  if (child.direction === 'none') {
    parts.push('当前子网格未启用 subgrid，独立定义轨道。子网格的列与行与父网格轨道无对齐关系，可能出现错位。这是对比基线——切换到 columns/rows/both 即可观察 subgrid 的对齐效果。');
    return parts.join('\n');
  }

  parts.push(`子网格启用 <strong>${child.direction}</strong> 方向 subgrid：`);
  if (child.direction === 'columns' || child.direction === 'both') {
    parts.push(`- <strong>列轨道继承</strong>：子网格的 grid-template-columns 设为 subgrid，直接复用父网格的 ${parent.columns.length} 条列轨道定义（${tracksToCss(parent.columns)}），子网格内的项自动对齐父网格列线。`);
    parts.push(`- <strong>跨列</strong>：子网格跨父网格 ${child.colSpan} 列，继承的轨道数 = 父网格列数 × 跨列数占比。`);
  }
  if (child.direction === 'rows' || child.direction === 'both') {
    parts.push(`- <strong>行轨道继承</strong>：子网格的 grid-template-rows 设为 subgrid，复用父网格的 ${parent.rows.length} 条行轨道定义（${tracksToCss(parent.rows)}），子网格内的项自动对齐父网格行线。`);
    parts.push(`- <strong>跨行</strong>：子网格跨父网格 ${child.rowSpan} 行。`);
  }
  parts.push('- <strong>gap 继承</strong>：subgrid 方向下，子网格的 gap 自动继承父网格的 gap，无需重复声明。');
  parts.push('- <strong>核心价值</strong>：subgrid 解决了"嵌套网格无法对齐父网格轨道"的痛点。传统方案要么用百分比硬凑对齐（脆弱），要么放弃嵌套用扁平结构（语义丢失）。subgrid 让嵌套结构保持语义的同时实现轨道级对齐。');
  return parts.join('\n');
}

/**
 * 生成轨道列表编辑器
 */
function TrackEditor({
  tracks,
  onChange,
  label,
  min = 1,
  max = 8,
}: {
  tracks: Track[];
  onChange: (tracks: Track[]) => void;
  label: string;
  min?: number;
  max?: number;
}) {
  const addTrack = () => {
    if (tracks.length >= max) return;
    const newId = tracks.length > 0 ? Math.max(...tracks.map((t) => t.id)) + 1 : 1;
    onChange([...tracks, { id: newId, type: 'fr', value: 1 }]);
  };
  const removeTrack = (id: number) => {
    if (tracks.length <= min) return;
    onChange(tracks.filter((t) => t.id !== id));
  };
  const updateTrack = (id: number, patch: Partial<Track>) => {
    onChange(tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  return (
    <div className="sbg__track-editor">
      <div className="sbg__track-label">
        <span>{label}</span>
        <button type="button" className="sbg__btn sbg__btn--small" onClick={addTrack} disabled={tracks.length >= max}>
          + 添加
        </button>
      </div>
      <div className="sbg__track-list">
        {tracks.map((t) => (
          <div key={t.id} className="sbg__track-item">
            <select
              className="sbg__select sbg__select--small"
              value={t.type}
              onChange={(e) => updateTrack(t.id, { type: e.target.value as TrackType })}
              aria-label="轨道类型"
            >
              <option value="fr">fr</option>
              <option value="px">px</option>
              <option value="%">%</option>
              <option value="auto">auto</option>
            </select>
            {t.type !== 'auto' && (
              <input
                type="number"
                className="sbg__input sbg__input--small"
                value={t.value}
                min={0}
                onChange={(e) => updateTrack(t.id, { value: Number(e.target.value) })}
                aria-label="轨道值"
              />
            )}
            <button
              type="button"
              className="sbg__btn sbg__btn--small sbg__btn--danger"
              onClick={() => removeTrack(t.id)}
              disabled={tracks.length <= min}
              aria-label="删除轨道"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SubgridTool() {
  const [config, setConfig] = useState<SubgridConfig>(DEFAULT_CONFIG);
  const [selectedPreset, setSelectedPreset] = useState<string>('默认双向继承');
  const [copied, setCopied] = useState(false);

  const fullCss = useMemo(() => buildFullCss(config), [config]);
  const explain = useMemo(() => buildExplain(config), [config]);

  // 预览区样式：父网格
  const parentStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: tracksToCss(config.parent.columns),
    gridTemplateRows: config.parent.rows.length > 0 ? tracksToCss(config.parent.rows) : undefined,
    gap: `${config.parent.rowGap}px ${config.parent.columnGap}px`,
    padding: '12px',
    background: 'var(--sbg-parent-bg, #f0f4f8)',
    border: '2px dashed var(--sbg-parent-border, #3b82f6)',
    borderRadius: '8px',
    minHeight: '200px',
  };

  // 预览区样式：子网格
  const childStyle: CSSProperties = {
    display: 'grid',
    gridColumn: config.child.colSpan > 1 ? `span ${config.child.colSpan}` : undefined,
    gridRow: config.child.rowSpan > 1 ? `span ${config.child.rowSpan}` : undefined,
    gridTemplateColumns:
      config.child.direction === 'columns' || config.child.direction === 'both'
        ? 'subgrid'
        : `repeat(${Math.min(config.child.itemCount, config.parent.columns.length * config.child.colSpan)}, 1fr)`,
    gridTemplateRows:
      config.child.direction === 'rows' || config.child.direction === 'both'
        ? 'subgrid'
        : undefined,
    gap:
      config.child.direction === 'none'
        ? `${config.child.itemRowGap}px ${config.child.itemColumnGap}px`
        : `${config.parent.rowGap}px ${config.parent.columnGap}px`,
    padding: '10px',
    background: 'var(--sbg-child-bg, #fef3c7)',
    border: '2px solid var(--sbg-child-border, #f59e0b)',
    borderRadius: '6px',
  };

  // 父网格中的其他占位项（非子网格的位置）
  const totalParentCells =
    config.parent.columns.length * Math.max(config.parent.rows.length, 1);
  const childOccupied = config.child.colSpan * config.child.rowSpan;
  const placeholderCount = Math.max(0, totalParentCells - childOccupied);

  const handleCopy = useCallback(async () => {
    const ok = await copyText(fullCss);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [fullCss]);

  const applyPreset = (preset: SubgridPreset) => {
    // 深拷贝避免引用共享
    setConfig(JSON.parse(JSON.stringify(preset.config)));
    setSelectedPreset(preset.name);
  };

  const updateParent = (patch: Partial<ParentGrid>) => {
    setConfig((c) => ({ ...c, parent: { ...c.parent, ...patch } }));
    setSelectedPreset('');
  };
  const updateChild = (patch: Partial<ChildGrid>) => {
    setConfig((c) => ({ ...c, child: { ...c.child, ...patch } }));
    setSelectedPreset('');
  };

  return (
    <div className="sbg">
      {/* 预设按钮组 */}
      <div className="sbg__presets">
        <span className="sbg__presets-label">预设：</span>
        {PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            className={`sbg__btn sbg__btn--preset ${selectedPreset === p.name ? 'sbg__btn--active' : ''}`}
            onClick={() => applyPreset(p)}
            title={p.description}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="sbg__main">
        {/* 左栏：配置面板 */}
        <div className="sbg__panel">
          {/* 父网格配置 */}
          <fieldset className="sbg__fieldset">
            <legend>父网格容器</legend>
            <label className="sbg__field">
              <span>父容器选择器</span>
              <input
                type="text"
                className="sbg__input"
                value={config.parentSelector}
                onChange={(e) => setConfig((c) => ({ ...c, parentSelector: e.target.value }))}
              />
            </label>
            <TrackEditor
              tracks={config.parent.columns}
              onChange={(columns) => updateParent({ columns })}
              label="列轨道 grid-template-columns"
              min={1}
              max={6}
            />
            <TrackEditor
              tracks={config.parent.rows}
              onChange={(rows) => updateParent({ rows })}
              label="行轨道 grid-template-rows（可选）"
              min={0}
              max={4}
            />
            <div className="sbg__row">
              <label className="sbg__field sbg__field--inline">
                <span>列间距 gap</span>
                <input
                  type="range"
                  min={0}
                  max={40}
                  value={config.parent.columnGap}
                  onChange={(e) => updateParent({ columnGap: Number(e.target.value) })}
                />
                <span className="sbg__value">{config.parent.columnGap}px</span>
              </label>
              <label className="sbg__field sbg__field--inline">
                <span>行间距 gap</span>
                <input
                  type="range"
                  min={0}
                  max={40}
                  value={config.parent.rowGap}
                  onChange={(e) => updateParent({ rowGap: Number(e.target.value) })}
                />
                <span className="sbg__value">{config.parent.rowGap}px</span>
              </label>
            </div>
          </fieldset>

          {/* 子网格配置 */}
          <fieldset className="sbg__fieldset">
            <legend>子网格容器（subgrid 核心）</legend>
            <label className="sbg__field">
              <span>子容器选择器</span>
              <input
                type="text"
                className="sbg__input"
                value={config.childSelector}
                onChange={(e) => setConfig((c) => ({ ...c, childSelector: e.target.value }))}
              />
            </label>
            <div className="sbg__field">
              <span>subgrid 方向</span>
              <div className="sbg__seg-group" role="radiogroup" aria-label="subgrid 方向">
                {DIRECTION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={config.child.direction === opt.value}
                    className={`sbg__seg ${config.child.direction === opt.value ? 'sbg__seg--active' : ''}`}
                    title={opt.desc}
                    onClick={() => updateChild({ direction: opt.value })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="sbg__row">
              <label className="sbg__field sbg__field--inline">
                <span>跨列 colSpan</span>
                <input
                  type="number"
                  className="sbg__input sbg__input--small"
                  min={1}
                  max={6}
                  value={config.child.colSpan}
                  onChange={(e) => updateChild({ colSpan: Math.max(1, Number(e.target.value)) })}
                />
              </label>
              <label className="sbg__field sbg__field--inline">
                <span>跨行 rowSpan</span>
                <input
                  type="number"
                  className="sbg__input sbg__input--small"
                  min={1}
                  max={4}
                  value={config.child.rowSpan}
                  onChange={(e) => updateChild({ rowSpan: Math.max(1, Number(e.target.value)) })}
                />
              </label>
            </div>
            <label className="sbg__field sbg__field--inline">
              <span>子网格内项数量</span>
              <input
                type="range"
                min={1}
                max={12}
                value={config.child.itemCount}
                onChange={(e) => updateChild({ itemCount: Number(e.target.value) })}
              />
              <span className="sbg__value">{config.child.itemCount} 个</span>
            </label>
            {config.child.direction === 'none' && (
              <div className="sbg__row">
                <label className="sbg__field sbg__field--inline">
                  <span>独立列间距</span>
                  <input
                    type="range"
                    min={0}
                    max={40}
                    value={config.child.itemColumnGap}
                    onChange={(e) => updateChild({ itemColumnGap: Number(e.target.value) })}
                  />
                  <span className="sbg__value">{config.child.itemColumnGap}px</span>
                </label>
                <label className="sbg__field sbg__field--inline">
                  <span>独立行间距</span>
                  <input
                    type="range"
                    min={0}
                    max={40}
                    value={config.child.itemRowGap}
                    onChange={(e) => updateChild({ itemRowGap: Number(e.target.value) })}
                  />
                  <span className="sbg__value">{config.child.itemRowGap}px</span>
                </label>
              </div>
            )}
          </fieldset>
        </div>

        {/* 右栏：预览 + 代码 + 原理 */}
        <div className="sbg__panel sbg__panel--preview">
          {/* 可视化预览 */}
          <div className="sbg__section">
            <div className="sbg__section-head">
              <h3>可视化预览</h3>
              <span className="sbg__hint">
                蓝色虚线 = 父网格轨道 | 橙色实线 = 子网格 | 子网格内项自动对齐父网格轨道
              </span>
            </div>
            <div className="sbg__preview">
              <div style={parentStyle}>
                {/* 子网格容器 */}
                <div style={childStyle}>
                  {Array.from({ length: config.child.itemCount }, (_, i) => (
                    <div key={i} className="sbg__child-item">
                      子项 {i + 1}
                    </div>
                  ))}
                </div>
                {/* 占位项 */}
                {Array.from({ length: placeholderCount }, (_, i) => (
                  <div key={`ph-${i}`} className="sbg__placeholder-item">
                    父项 {i + 1}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 原理说明 */}
          <div className="sbg__section">
            <div className="sbg__section-head">
              <h3>原理说明</h3>
            </div>
            <div className="sbg__explain" dangerouslySetInnerHTML={{ __html: explain }} />
          </div>

          {/* 代码输出 */}
          <div className="sbg__section">
            <div className="sbg__section-head">
              <h3>生成的 CSS 代码</h3>
              <button type="button" className="sbg__btn sbg__btn--copy" onClick={handleCopy}>
                {copied ? '✓ 已复制' : '复制代码'}
              </button>
            </div>
            <pre className="sbg__code">
              <code>{fullCss}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
