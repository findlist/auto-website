import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS position-area 定位区域生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 3x3 网格可视化选择定位区域（点击单元格快速定位）
 *  - 三套关键字体系：物理（top/left）、逻辑（block-start/inline-start）、坐标（y-start/x-start）
 *  - 支持 span-* 跨格与 span-all 跨行/列
 *  - 与 anchor-positioning 协同：anchor-name 声明 + position-anchor 引用
 *  - iframe srcdoc 沙箱预览（锚点 + 3x3 网格 + 定位元素真实关系）
 *  - 原理说明面板解析网格定位逻辑与默认对齐行为
 *  - 8 组预设覆盖 tooltip / dropdown / popover / 居中覆盖等场景
 *  - 智能代码生成，一键复制
 */

/** 关键字体系：物理 / 逻辑 / 坐标 */
type KeywordSystem = 'physical' | 'logical' | 'coordinate';

/** 轴向规格：起始 / 居中 / 结束 / 跨起始 / 跨结束 / 跨全部 */
type AxisSpec = 'start' | 'center' | 'end' | 'span-start' | 'span-end' | 'span-all';

/** 完整 position-area 配置 */
interface PositionAreaConfig {
  /** 关键字体系 */
  system: KeywordSystem;
  /** 行（块轴/y 轴）规格 */
  rowSpec: AxisSpec;
  /** 列（行内轴/x 轴）规格 */
  colSpec: AxisSpec;
  /** 锚点选择器 */
  anchorSelector: string;
  /** 锚点名称（anchor-name 的值，-- 前缀） */
  anchorName: string;
  /** 定位元素选择器 */
  targetSelector: string;
  /** 是否启用 position-anchor 引用 */
  usePositionAnchor: boolean;
  /** 定位方式 */
  position: 'absolute' | 'fixed';
  /** 是否重置 margin 与 inset（popover 场景需要） */
  resetMargin: boolean;
  /** 可选偏移量（px），作用于 inset 属性 */
  insetOffset: number;
}

/** 预设 */
interface PositionAreaPreset {
  name: string;
  description: string;
  config: PositionAreaConfig;
}

// 三套关键字体系下，行/列规格对应的 CSS 关键字
const KEYWORD_MAP: Record<KeywordSystem, { row: Record<AxisSpec, string>; col: Record<AxisSpec, string> }> = {
  physical: {
    row: { start: 'top', center: 'center', end: 'bottom', 'span-start': 'span-top', 'span-end': 'span-bottom', 'span-all': 'span-all' },
    col: { start: 'left', center: 'center', end: 'right', 'span-start': 'span-left', 'span-end': 'span-right', 'span-all': 'span-all' },
  },
  logical: {
    row: { start: 'block-start', center: 'center', end: 'block-end', 'span-start': 'span-block-start', 'span-end': 'span-block-end', 'span-all': 'span-all' },
    col: { start: 'inline-start', center: 'center', end: 'inline-end', 'span-start': 'span-inline-start', 'span-end': 'span-inline-end', 'span-all': 'span-all' },
  },
  coordinate: {
    row: { start: 'y-start', center: 'center', end: 'y-end', 'span-start': 'span-y-start', 'span-end': 'span-y-end', 'span-all': 'span-all' },
    col: { start: 'x-start', center: 'center', end: 'x-end', 'span-start': 'span-x-start', 'span-end': 'span-x-end', 'span-all': 'span-all' },
  },
};

// 体系标签
const SYSTEM_LABELS: Record<KeywordSystem, string> = {
  physical: '物理',
  logical: '逻辑',
  coordinate: '坐标',
};

// 轴向规格可选项
const AXIS_OPTIONS: AxisSpec[] = ['start', 'center', 'end', 'span-start', 'span-end', 'span-all'];

/** 根据规格计算选中的网格单元（0-2 行 × 0-2 列） */
function getSelectedCells(rowSpec: AxisSpec, colSpec: AxisSpec): boolean[][] {
  // 将规格映射为行/列索引集合
  const toRows = (s: AxisSpec): number[] => {
    switch (s) {
      case 'start': return [0];
      case 'center': return [1];
      case 'end': return [2];
      case 'span-start': return [0, 1]; // 起始 + 居中
      case 'span-end': return [1, 2];   // 居中 + 结束
      case 'span-all': return [0, 1, 2];
    }
  };
  const toCols = (s: AxisSpec): number[] => toRows(s); // 列与行映射一致
  const rows = toRows(rowSpec);
  const cols = toCols(colSpec);
  const grid: boolean[][] = [[false, false, false], [false, false, false], [false, false, false]];
  rows.forEach(r => cols.forEach(c => { grid[r][c] = true; }));
  return grid;
}

/** 生成 position-area 属性值 */
function buildPositionAreaValue(config: PositionAreaConfig): string {
  const rowKw = KEYWORD_MAP[config.system].row[config.rowSpec];
  const colKw = KEYWORD_MAP[config.system].col[config.colSpec];
  // 两者相同（如均为 center 或 span-all）时只输出一个
  if (rowKw === colKw) return rowKw;
  // 约定行在前、列在后，与 MDN 示例（top left）一致
  return `${rowKw} ${colKw}`;
}

/** 生成完整 CSS 代码 */
function buildCss(config: PositionAreaConfig): string {
  const lines: string[] = [];
  const areaValue = buildPositionAreaValue(config);

  // 锚点元素：声明 anchor-name
  lines.push(`/* 锚点元素 */`);
  lines.push(`${config.anchorSelector} {`);
  lines.push(`  anchor-name: ${config.anchorName};`);
  lines.push(`}`);

  // 定位元素：position + position-anchor + position-area
  lines.push('');
  lines.push(`/* 定位元素（通过 position-area 放入锚点 3x3 网格） */`);
  lines.push(`${config.targetSelector} {`);
  lines.push(`  position: ${config.position};`);
  if (config.usePositionAnchor) {
    lines.push(`  position-anchor: ${config.anchorName};`);
  }
  lines.push(`  position-area: ${areaValue};`);
  // 可选 inset 偏移（相对网格区域的偏移）
  if (config.insetOffset !== 0) {
    lines.push(`  inset: ${config.insetOffset}px;`);
  }
  // popover 场景需重置默认 margin/inset，避免与 position-area 冲突
  if (config.resetMargin) {
    lines.push(`  margin: 0;`);
    lines.push(`  inset: auto;`);
  }
  lines.push(`}`);

  return lines.join('\n');
}

/** 生成 iframe 预览 HTML（沙箱内真实渲染 3x3 网格与定位元素） */
function buildPreviewHtml(config: PositionAreaConfig): string {
  const css = buildCss(config);
  const cells = getSelectedCells(config.rowSpec, config.colSpec);
  // 构造 3x3 网格单元格 HTML，标注选中状态与中心锚点
  const cellLabels = ['起始', '居中', '结束'];
  const gridHtml = cells
    .map((rowArr, r) =>
      rowArr
        .map((sel, c) => {
          const isCenter = r === 1 && c === 1;
          const cls = ['pa-grid-cell'];
          if (isCenter) cls.push('is-center');
          if (sel) cls.push('is-selected');
          return `<div class="${cls.join(' ')}" data-r="${r}" data-c="${c}">${
            isCenter ? '锚点' : cellLabels[c] + cellLabels[r]
          }</div>`;
        })
        .join('')
    )
    .join('');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { min-height: 100%; padding: 32px 24px; font-family: system-ui, -apple-system, "PingFang SC", sans-serif; background: #f5f5f7; }
  .stage { position: relative; min-height: 420px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24px; background: repeating-linear-gradient(45deg, #fff, #fff 10px, #f0f0f3 10px, #f0f0f3 20px); border-radius: 8px; border: 1px dashed #d0d0d8; padding: 32px 16px; }
  /* 3x3 网格可视化 */
  .pa-grid-vis { display: grid; grid-template-columns: repeat(3, 84px); grid-template-rows: repeat(3, 56px); gap: 4px; }
  .pa-grid-cell { display: flex; align-items: center; justify-content: center; border: 1px dashed #c0c0c8; border-radius: 4px; font-size: 11px; color: #909098; background: rgba(255,255,255,0.5); }
  .pa-grid-cell.is-center { background: #3b82f6; color: #fff; border-color: #3b82f6; font-weight: 600; }
  .pa-grid-cell.is-selected { background: rgba(31,41,55,0.85); color: #fff; border-color: #1f2937; border-style: solid; }
  .pa-grid-cell.is-center.is-selected { background: #1d4ed8; }
  /* 锚点与定位元素真实演示 */
  .demo-wrap { position: relative; }
  ${config.anchorSelector.replace(/^([.#]?-?[\w-]+)/, '.$1').replace(/[^.\w-]/g, '')}, .anchor-demo { padding: 10px 22px; background: #3b82f6; color: #fff; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; }
  ${config.targetSelector.replace(/^([.#]?-?[\w-]+)/, '.$1').replace(/[^.\w-]/g, '')}, .target-demo { padding: 8px 14px; background: #1f2937; color: #fff; border-radius: 6px; font-size: 13px; box-shadow: 0 4px 12px rgba(0,0,0,0.18); min-width: 80px; text-align: center; }
  ${css}
</style>
</head>
<body>
  <div class="stage">
    <div class="pa-grid-vis">${gridHtml}</div>
    <div class="demo-wrap">
      <button class="anchor-demo" type="button">锚点</button>
      <div class="target-demo">定位元素</div>
    </div>
  </div>
</body>
</html>`;
}

/** 生成原理说明 */
function buildExplain(config: PositionAreaConfig): string[] {
  const tips: string[] = [];
  const areaValue = buildPositionAreaValue(config);
  const cells = getSelectedCells(config.rowSpec, config.colSpec);
  const selectedCount = cells.flat().filter(Boolean).length;

  tips.push(
    `position-area 把锚点元素视为 3x3 网格的中心单元，定位元素被放入指定的网格区域。` +
      `当前值 <code>${areaValue}</code> 选中了 ${selectedCount} 个网格单元（共 9 个）。` +
      `这是 anchor-positioning 的"网格定位"模式，比 <code>anchor()</code> 函数更简洁。`
  );

  // 解析行规格
  const rowKw = KEYWORD_MAP[config.system].row[config.rowSpec];
  const rowDescMap: Record<AxisSpec, string> = {
    start: '放在起始侧（网格起始行）',
    center: '放在居中行（与锚点同行）',
    end: '放在结束侧（网格结束行）',
    'span-start': '跨起始行与居中行（向起始方向延伸）',
    'span-end': '跨居中行与结束行（向结束方向延伸）',
    'span-all': '跨全部三行（整列覆盖）',
  };
  tips.push(`行规格 <code>${rowKw}</code>：定位元素${rowDescMap[config.rowSpec]}。`);

  // 解析列规格
  const colKw = KEYWORD_MAP[config.system].col[config.colSpec];
  const colDescMap: Record<AxisSpec, string> = {
    start: '放在起始侧（网格起始列）',
    center: '放在居中列（与锚点同列）',
    end: '放在结束侧（网格结束列）',
    'span-start': '跨起始列与居中列（向起始方向延伸）',
    'span-end': '跨居中列与结束列（向结束方向延伸）',
    'span-all': '跨全部三列（整行覆盖）',
  };
  tips.push(`列规格 <code>${colKw}</code>：定位元素${colDescMap[config.colSpec]}。`);

  // 默认对齐行为说明
  const alignTips: string[] = [];
  if (config.rowSpec === 'center' && config.colSpec === 'center') {
    alignTips.push('行/列均居中时，self-alignment 默认为 <code>anchor-center</code>（相对锚点居中）');
  } else {
    if (config.rowSpec === 'center') {
      alignTips.push('行居中时，行方向默认 <code>anchor-center</code> 对齐');
    } else {
      alignTips.push(`行方向（${rowKw}）默认对齐为区域相反侧（<code>end</code> 或 <code>start</code>）`);
    }
    if (config.colSpec === 'center') {
      alignTips.push('列居中时，列方向默认 <code>anchor-center</code> 对齐');
    } else {
      alignTips.push(`列方向（${colKw}）默认对齐为区域相反侧（<code>end</code> 或 <code>start</code>）`);
    }
  }
  tips.push(`默认对齐：${alignTips.join('；')}。这是 position-area 的"调整默认行为"特性，无需手动写 align/justify 即可获得合理对齐。`);

  // 体系说明
  const sysDescMap: Record<KeywordSystem, string> = {
    physical: '物理关键字（top/left/bottom/right）固定方向，不受书写模式影响',
    logical: '逻辑关键字（block-start/inline-start）随书写模式自动适配，适合 RTL/竖排场景',
    coordinate: '坐标关键字（y-start/x-start）按坐标轴方向，与 writing-mode 解耦',
  };
  tips.push(`当前使用<strong>${SYSTEM_LABELS[config.system]}关键字体系</strong>：${sysDescMap[config.system]}。`);

  if (config.resetMargin) {
    tips.push('已启用 <code>margin: 0; inset: auto;</code> 重置——popover 元素的默认 margin/inset 会与 position-area 冲突，必须重置。');
  }

  return tips;
}

/** 8 组预设 */
const PRESETS: PositionAreaPreset[] = [
  {
    name: '下方 Tooltip',
    description: '定位元素放在锚点下方居中（典型 tooltip）',
    config: {
      system: 'physical', rowSpec: 'end', colSpec: 'center',
      anchorSelector: '.anchor', anchorName: '--my-anchor', targetSelector: '.tooltip',
      usePositionAnchor: true, position: 'absolute', resetMargin: false, insetOffset: 8,
    },
  },
  {
    name: '上方 Tooltip',
    description: '定位元素放在锚点上方居中',
    config: {
      system: 'physical', rowSpec: 'start', colSpec: 'center',
      anchorSelector: '.anchor', anchorName: '--my-anchor', targetSelector: '.tooltip',
      usePositionAnchor: true, position: 'absolute', resetMargin: false, insetOffset: 8,
    },
  },
  {
    name: '右侧 Dropdown',
    description: '下拉菜单放在锚点右侧顶部对齐',
    config: {
      system: 'physical', rowSpec: 'center', colSpec: 'end',
      anchorSelector: '.anchor', anchorName: '--my-anchor', targetSelector: '.menu',
      usePositionAnchor: true, position: 'absolute', resetMargin: false, insetOffset: 4,
    },
  },
  {
    name: '左下角气泡',
    description: '定位元素放在锚点左下方（斜向气泡）',
    config: {
      system: 'physical', rowSpec: 'end', colSpec: 'start',
      anchorSelector: '.anchor', anchorName: '--my-anchor', targetSelector: '.bubble',
      usePositionAnchor: true, position: 'absolute', resetMargin: false, insetOffset: 6,
    },
  },
  {
    name: '居中覆盖',
    description: '定位元素覆盖在锚点正上方（居中遮罩）',
    config: {
      system: 'physical', rowSpec: 'center', colSpec: 'center',
      anchorSelector: '.anchor', anchorName: '--my-anchor', targetSelector: '.overlay',
      usePositionAnchor: true, position: 'absolute', resetMargin: false, insetOffset: 0,
    },
  },
  {
    name: '底部通栏',
    description: '定位元素跨锚点底部整行（span-all 横向铺满）',
    config: {
      system: 'physical', rowSpec: 'end', colSpec: 'span-all',
      anchorSelector: '.anchor', anchorName: '--my-anchor', targetSelector: '.banner',
      usePositionAnchor: true, position: 'absolute', resetMargin: false, insetOffset: 4,
    },
  },
  {
    name: 'Popover 弹层',
    description: 'popover 弹层放在锚点下方，重置默认 margin/inset',
    config: {
      system: 'physical', rowSpec: 'end', colSpec: 'center',
      anchorSelector: '.anchor', anchorName: '--my-anchor', targetSelector: '[popover]',
      usePositionAnchor: true, position: 'fixed', resetMargin: true, insetOffset: 8,
    },
  },
  {
    name: '逻辑 RTL 适配',
    description: '使用逻辑关键字，自动适配 RTL/竖排书写模式',
    config: {
      system: 'logical', rowSpec: 'end', colSpec: 'start',
      anchorSelector: '.anchor', anchorName: '--my-anchor', targetSelector: '.tooltip',
      usePositionAnchor: true, position: 'absolute', resetMargin: false, insetOffset: 8,
    },
  },
];

const DEFAULT_CONFIG: PositionAreaConfig = PRESETS[0].config;

/** 泛型分段按钮组 */
function SegGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="pa-field">
      <span className="pa-field-label">{label}</span>
      <div className="pa-seg-group">
        {options.map(opt => (
          <button
            key={opt}
            type="button"
            className={`pa-seg-btn ${value === opt ? 'is-active' : ''}`}
            onClick={() => onChange(opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function PositionAreaTool() {
  const [config, setConfig] = useState<PositionAreaConfig>(DEFAULT_CONFIG);
  const [copied, setCopied] = useState(false);

  const cssCode = useMemo(() => buildCss(config), [config]);
  const previewHtml = useMemo(() => buildPreviewHtml(config), [config]);
  const explains = useMemo(() => buildExplain(config), [config]);
  const areaValue = useMemo(() => buildPositionAreaValue(config), [config]);
  const cells = useMemo(() => getSelectedCells(config.rowSpec, config.colSpec), [config.rowSpec, config.colSpec]);

  const handleCopy = useCallback(async () => {
    const ok = await copyText(cssCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [cssCode]);

  // 点击网格单元：单选模式，将行/列规格设为该单元对应的单值
  const handleCellClick = (r: number, c: number) => {
    const rowMap: Record<number, AxisSpec> = { 0: 'start', 1: 'center', 2: 'end' };
    setConfig(prev => ({ ...prev, rowSpec: rowMap[r], colSpec: rowMap[c] }));
  };

  const update = <K extends keyof PositionAreaConfig>(key: K, value: PositionAreaConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const applyPreset = (preset: PositionAreaPreset) => {
    setConfig({ ...preset.config });
  };

  return (
    <div className="pa-tool">
      {/* 预设按钮组 */}
      <div className="pa-presets">
        <span className="pa-presets-label">预设：</span>
        <div className="pa-preset-list">
          {PRESETS.map(p => (
            <button
              key={p.name}
              type="button"
              className="pa-preset-btn"
              title={p.description}
              onClick={() => applyPreset(p)}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className="pa-main">
        {/* 左栏：配置面板 */}
        <div className="pa-config">
          <fieldset className="pa-fieldset">
            <legend>关键字体系</legend>
            <SegGroup<KeywordSystem>
              label="体系"
              value={config.system}
              options={['physical', 'logical', 'coordinate']}
              onChange={v => update('system', v)}
            />
            <p className="pa-hint">
              {config.system === 'physical' && '物理关键字（top/left）固定方向，不受书写模式影响。'}
              {config.system === 'logical' && '逻辑关键字（block-start/inline-start）随书写模式自动适配 RTL/竖排。'}
              {config.system === 'coordinate' && '坐标关键字（y-start/x-start）按坐标轴方向，与 writing-mode 解耦。'}
            </p>
          </fieldset>

          <fieldset className="pa-fieldset">
            <legend>网格区域选择</legend>
            <SegGroup<AxisSpec>
              label="行（块轴）"
              value={config.rowSpec}
              options={AXIS_OPTIONS}
              onChange={v => update('rowSpec', v)}
            />
            <SegGroup<AxisSpec>
              label="列（行内轴）"
              value={config.colSpec}
              options={AXIS_OPTIONS}
              onChange={v => update('colSpec', v)}
            />
            <div className="pa-field">
              <span className="pa-field-label">当前值</span>
              <code className="pa-value-out">{areaValue}</code>
            </div>
          </fieldset>

          <fieldset className="pa-fieldset">
            <legend>锚点与定位元素</legend>
            <div className="pa-field">
              <label className="pa-field-label" htmlFor="pa-anchor-sel">锚点选择器</label>
              <input
                id="pa-anchor-sel"
                type="text"
                className="pa-input"
                value={config.anchorSelector}
                onChange={e => update('anchorSelector', e.target.value)}
              />
            </div>
            <div className="pa-field">
              <label className="pa-field-label" htmlFor="pa-anchor-name">锚点名称</label>
              <input
                id="pa-anchor-name"
                type="text"
                className="pa-input"
                value={config.anchorName}
                onChange={e => update('anchorName', e.target.value)}
              />
            </div>
            <div className="pa-field">
              <label className="pa-field-label" htmlFor="pa-target-sel">定位元素选择器</label>
              <input
                id="pa-target-sel"
                type="text"
                className="pa-input"
                value={config.targetSelector}
                onChange={e => update('targetSelector', e.target.value)}
              />
            </div>
            <SegGroup<'absolute' | 'fixed'>
              label="定位方式"
              value={config.position}
              options={['absolute', 'fixed']}
              onChange={v => update('position', v)}
            />
            <div className="pa-field">
              <label className="pa-field-label" htmlFor="pa-offset">inset 偏移（px）</label>
              <input
                id="pa-offset"
                type="number"
                className="pa-input"
                value={config.insetOffset}
                onChange={e => update('insetOffset', Number(e.target.value) || 0)}
              />
            </div>
            <div className="pa-field pa-field-row">
              <label className="pa-checkbox">
                <input
                  type="checkbox"
                  checked={config.usePositionAnchor}
                  onChange={e => update('usePositionAnchor', e.target.checked)}
                />
                <span>启用 position-anchor 引用</span>
              </label>
              <label className="pa-checkbox">
                <input
                  type="checkbox"
                  checked={config.resetMargin}
                  onChange={e => update('resetMargin', e.target.checked)}
                />
                <span>重置 margin/inset（popover）</span>
              </label>
            </div>
          </fieldset>
        </div>

        {/* 右栏：可视化 + 预览 + 代码 */}
        <div className="pa-output">
          {/* 3x3 交互网格 */}
          <div className="pa-grid-section">
            <h3 className="pa-section-title">3x3 网格定位图</h3>
            <p className="pa-grid-tip">点击单元格快速定位（单选模式），下方控件可切换 span 跨格。</p>
            <div className="pa-grid-interactive">
              {cells.map((rowArr, r) =>
                rowArr.map((sel, c) => {
                  const isCenter = r === 1 && c === 1;
                  const cls = ['pa-grid-btn'];
                  if (isCenter) cls.push('is-center');
                  if (sel) cls.push('is-selected');
                  const labels = ['起始', '居中', '结束'];
                  return (
                    <button
                      key={`${r}-${c}`}
                      type="button"
                      className={cls.join(' ')}
                      onClick={() => handleCellClick(r, c)}
                      title={isCenter ? '锚点位置（中心）' : `${labels[c]}${labels[r]}`}
                    >
                      {isCenter ? '锚点' : `${labels[c]}${labels[r]}`}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* iframe 沙箱预览 */}
          <div className="pa-preview-section">
            <h3 className="pa-section-title">实时预览</h3>
            <iframe
              className="pa-preview-iframe"
              srcDoc={previewHtml}
              sandbox="allow-same-origin"
              title="position-area 预览"
            />
          </div>

          {/* 原理说明 */}
          <div className="pa-explain-section">
            <h3 className="pa-section-title">原理说明</h3>
            <ul className="pa-explain-list">
              {explains.map((tip, i) => (
                <li key={i} dangerouslySetInnerHTML={{ __html: tip }} />
              ))}
            </ul>
          </div>

          {/* 代码输出 */}
          <div className="pa-code-section">
            <div className="pa-code-header">
              <h3 className="pa-section-title">CSS 代码</h3>
              <button
                type="button"
                className={`pa-copy-btn ${copied ? 'is-copied' : ''}`}
                onClick={handleCopy}
              >
                {copied ? '已复制' : '复制'}
              </button>
            </div>
            <pre className="pa-code-block">
              <code>{cssCode}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
