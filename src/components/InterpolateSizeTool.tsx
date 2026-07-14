import { useState, useMemo, useCallback, useRef } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS interpolate-size 尺寸插值动画生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - interpolate-size: allow-keywords | numeric-only 配置
 *  - 多尺寸属性过渡管理（width/height/min-height/max-height/block-size/inline-size）
 *  - calc-size() 函数支持（基于 size 关键字做计算）
 *  - 多 transition 配置（属性 + 时长 + 缓动 + 延迟）
 *  - 折叠面板实时预览（最经典的 interpolate-size 应用场景）
 *  - 双状态切换预览（折叠 ↔ 展开）
 *  - 8 组预设效果
 *  - 智能代码生成，一键复制
 */

/** 单条尺寸过渡声明 */
interface SizeTransition {
  id: string;
  property: string; // 尺寸属性名，如 width/height/block-size
  collapsed: string; // 折叠态值，如 0、auto、min-content
  expanded: string; // 展开态值，如 auto、200px、max-content
}

/** 单条 transition 配置 */
interface TransitionItem {
  id: string;
  property: string; // 过渡属性，如 height、opacity
  duration: number; // 时长（秒）
  timingFunction: string; // 缓动函数
  delay: number; // 延迟（秒）
}

/** interpolate-size 取值 */
type InterpolateSizeValue = 'numeric-only' | 'allow-keywords';

/** 预览场景 */
type PreviewScenario = 'accordion' | 'menu' | 'card';

/** 完整配置 */
interface InterpolateSizeConfig {
  selector: string;
  interpolateSize: InterpolateSizeValue;
  sizeTransitions: SizeTransition[];
  transitions: TransitionItem[];
  useCalcSize: boolean;
  calcSizeProperty: string; // 应用 calc-size() 的属性
  calcSizeBasis: string; // 基础关键字，如 auto
  calcSizeExpr: string; // 计算表达式，如 size + 20px
  scenario: PreviewScenario;
}

/** 预设 */
interface InterpolateSizePreset {
  name: string;
  description: string;
  config: InterpolateSizeConfig;
}

// 模块级 id 生成器，保证 React key 稳定（删除中间项时焦点不错位）
let _idCounter = 0;
const genId = (): string => `is_${Date.now().toString(36)}_${(++_idCounter).toString(36)}`;

// 工厂函数
const makeSizeTransition = (
  property = 'height',
  collapsed = '0',
  expanded = 'auto',
): SizeTransition => ({ id: genId(), property, collapsed, expanded });

const makeTransition = (
  property = 'height',
  duration = 0.4,
  timingFunction = 'ease',
  delay = 0,
): TransitionItem => ({ id: genId(), property, duration, timingFunction, delay });

// 常量
const TIMING_PRESETS = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'];
const SIZE_KEYWORDS = ['auto', 'min-content', 'max-content', 'fit-content', 'stretch', 'contain'];
const SIZE_PROPERTIES = [
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'block-size',
  'inline-size',
];

/**
 * 生成 transition 简写值（参考 StartingStyleTool 风格）
 */
function buildTransitionValue(transitions: TransitionItem[]): string {
  const list = transitions.filter(t => t.property);
  if (list.length === 0) return 'none';
  return list
    .map(t => {
      const parts = [t.property, `${t.duration}s`, t.timingFunction];
      if (t.delay > 0) parts.push(`${t.delay}s`);
      return parts.join(' ');
    })
    .join(', ');
}

/**
 * 生成 calc-size() 表达式值
 * 例如 calc-size(auto, size + 20px)
 */
function buildCalcSizeValue(basis: string, expr: string): string {
  if (!basis || !expr) return basis || 'auto';
  return `calc-size(${basis}, ${expr})`;
}

/**
 * 生成完整 CSS 代码
 * 折叠态/展开态分别用 [data-state="collapsed"] 与 [data-state="expanded"] 标记
 */
function buildCss(config: InterpolateSizeConfig): string {
  const {
    selector,
    interpolateSize,
    sizeTransitions,
    transitions,
    useCalcSize,
    calcSizeProperty,
    calcSizeBasis,
    calcSizeExpr,
  } = config;

  const lines: string[] = [];

  // 容器声明：interpolate-size + transition
  lines.push(`/* 容器：开启尺寸关键字插值 + 过渡声明 */`);
  lines.push(`${selector} {`);
  if (interpolateSize === 'allow-keywords') {
    lines.push(`  interpolate-size: allow-keywords;`);
  } else {
    lines.push(`  interpolate-size: numeric-only; /* 默认值，可省略 */`);
  }
  const tv = buildTransitionValue(transitions);
  if (tv !== 'none') lines.push(`  transition: ${tv};`);
  lines.push(`  overflow: hidden; /* 折叠态尺寸为 0 时裁剪溢出内容 */`);
  lines.push(`}`);
  lines.push('');

  // 折叠态
  const collapsedLines: string[] = [];
  for (const s of sizeTransitions) {
    collapsedLines.push(`  ${s.property}: ${s.collapsed};`);
  }
  if (collapsedLines.length > 0) {
    lines.push(`/* 折叠态 */`);
    lines.push(`${selector}[data-state="collapsed"] {`);
    lines.push(...collapsedLines);
    lines.push(`}`);
    lines.push('');
  }

  // 展开态：calc-size() 或关键字
  const expandedLines: string[] = [];
  for (const s of sizeTransitions) {
    if (useCalcSize && s.property === calcSizeProperty && calcSizeBasis && calcSizeExpr) {
      // 展开态使用 calc-size() 在关键字基础上做计算
      expandedLines.push(`  ${s.property}: ${buildCalcSizeValue(calcSizeBasis, calcSizeExpr)};`);
    } else {
      expandedLines.push(`  ${s.property}: ${s.expanded};`);
    }
  }
  if (expandedLines.length > 0) {
    lines.push(`/* 展开态：配合 interpolate-size: allow-keywords 实现 auto 等关键字平滑过渡 */`);
    lines.push(`${selector}[data-state="expanded"] {`);
    lines.push(...expandedLines);
    lines.push(`}`);
    lines.push('');
  }

  // 触发提示
  lines.push(`/* 切换 data-state 即可触发过渡 */`);
  lines.push(`<!-- <button onclick="el.dataset.state = el.dataset.state === 'collapsed' ? 'expanded' : 'collapsed'">切换</button> -->`);

  return lines.join('\n');
}

/**
 * 原理说明：解析当前配置的工作机制
 */
function buildExplain(config: InterpolateSizeConfig): string[] {
  const lines: string[] = [];
  const { interpolateSize, useCalcSize, calcSizeProperty, calcSizeBasis, calcSizeExpr, sizeTransitions } = config;

  if (interpolateSize === 'numeric-only') {
    lines.push('当前 interpolate-size 为 numeric-only（默认值）：尺寸关键字（auto、min-content、max-content 等）不参与插值，过渡立即跳变。这与传统 CSS 行为一致，适用于不需要尺寸关键字过渡的场景。');
  } else {
    lines.push('当前 interpolate-size 为 allow-keywords：浏览器允许在动画与过渡中插值尺寸关键字（auto、min-content、max-content、fit-content 等）。这是 CSS 2024 年新增的关键能力——传统 transition 对 height: auto 无法过渡，必须用 max-height 技巧或 JS 测量；allow-keywords 让浏览器原生支持 auto 高度的平滑过渡。');
  }

  if (useCalcSize && calcSizeProperty && calcSizeBasis && calcSizeExpr) {
    lines.push(`calc-size() 已启用：${calcSizeProperty} 属性使用 calc-size(${calcSizeBasis}, ${calcSizeExpr})。calc-size() 让开发者在尺寸关键字（如 auto）基础上做加减乘除计算，扩展了尺寸关键字的可用范围。size 关键字代表基础尺寸的当前值，可参与 calc 表达式。`);
  }

  // 检查是否有 auto 等关键字参与过渡
  const hasKeywordTransition = sizeTransitions.some(
    s => SIZE_KEYWORDS.includes(s.collapsed) || SIZE_KEYWORDS.includes(s.expanded),
  );
  if (interpolateSize === 'numeric-only' && hasKeywordTransition) {
    lines.push('⚠️ 警告：尺寸过渡中使用了 auto 等关键字，但 interpolate-size 为 numeric-only，关键字过渡将不会平滑生效。请改为 allow-keywords。');
  }

  return lines;
}

// 8 组预设
const PRESETS: InterpolateSizePreset[] = [
  {
    name: '折叠面板（auto 高度过渡）',
    description: 'interpolate-size 杀手级应用：折叠面板展开时高度从 0 过渡到 auto，无需 JS 测量',
    config: {
      selector: '.accordion-panel',
      interpolateSize: 'allow-keywords',
      sizeTransitions: [makeSizeTransition('height', '0', 'auto')],
      transitions: [makeTransition('height', 0.4, 'ease')],
      useCalcSize: false,
      calcSizeProperty: 'height',
      calcSizeBasis: 'auto',
      calcSizeExpr: '',
      scenario: 'accordion',
    },
  },
  {
    name: '菜单展开（min-content）',
    description: '下拉菜单从折叠态 0 过渡到 min-content（最小内容宽度）',
    config: {
      selector: '.dropdown-menu',
      interpolateSize: 'allow-keywords',
      sizeTransitions: [makeSizeTransition('block-size', '0', 'min-content')],
      transitions: [makeTransition('block-size', 0.3, 'ease-out')],
      useCalcSize: false,
      calcSizeProperty: 'block-size',
      calcSizeBasis: 'min-content',
      calcSizeExpr: '',
      scenario: 'menu',
    },
  },
  {
    name: '卡片展开（max-content 宽度）',
    description: '卡片点击后宽度从固定值过渡到 max-content（最大内容宽度）',
    config: {
      selector: '.card',
      interpolateSize: 'allow-keywords',
      sizeTransitions: [makeSizeTransition('inline-size', '200px', 'max-content')],
      transitions: [makeTransition('inline-size', 0.5, 'ease-in-out')],
      useCalcSize: false,
      calcSizeProperty: 'inline-size',
      calcSizeBasis: 'max-content',
      calcSizeExpr: '',
      scenario: 'card',
    },
  },
  {
    name: 'calc-size 计算（auto + 20px）',
    description: '使用 calc-size() 在 auto 基础上加 20px，实现"自动高度 + 额外空间"',
    config: {
      selector: '.panel',
      interpolateSize: 'allow-keywords',
      sizeTransitions: [makeSizeTransition('height', '0', 'auto')],
      transitions: [makeTransition('height', 0.4, 'ease')],
      useCalcSize: true,
      calcSizeProperty: 'height',
      calcSizeBasis: 'auto',
      calcSizeExpr: 'size + 20px',
      scenario: 'accordion',
    },
  },
  {
    name: '透明度 + 高度双重过渡',
    description: '折叠面板同时过渡 height（auto 插值）与 opacity',
    config: {
      selector: '.collapse',
      interpolateSize: 'allow-keywords',
      sizeTransitions: [makeSizeTransition('height', '0', 'auto')],
      transitions: [
        makeTransition('height', 0.4, 'ease'),
        makeTransition('opacity', 0.3, 'ease', 0.05),
      ],
      useCalcSize: false,
      calcSizeProperty: 'height',
      calcSizeBasis: 'auto',
      calcSizeExpr: '',
      scenario: 'accordion',
    },
  },
  {
    name: 'fit-content 自适应',
    description: '面板宽度从 0 过渡到 fit-content，自适应内容尺寸',
    config: {
      selector: '.fit-panel',
      interpolateSize: 'allow-keywords',
      sizeTransitions: [makeSizeTransition('width', '0', 'fit-content')],
      transitions: [makeTransition('width', 0.35, 'ease-out')],
      useCalcSize: false,
      calcSizeProperty: 'width',
      calcSizeBasis: 'fit-content',
      calcSizeExpr: '',
      scenario: 'card',
    },
  },
  {
    name: 'calc-size 缩放（auto × 0.5）',
    description: '使用 calc-size(auto, size * 0.5) 实现半高展开',
    config: {
      selector: '.half-panel',
      interpolateSize: 'allow-keywords',
      sizeTransitions: [makeSizeTransition('height', '0', 'auto')],
      transitions: [makeTransition('height', 0.4, 'ease')],
      useCalcSize: true,
      calcSizeProperty: 'height',
      calcSizeBasis: 'auto',
      calcSizeExpr: 'size * 0.5',
      scenario: 'accordion',
    },
  },
  {
    name: '默认（numeric-only 对比基线）',
    description: 'interpolate-size 为默认值 numeric-only，auto 关键字过渡不生效——作为对比基线',
    config: {
      selector: '.baseline',
      interpolateSize: 'numeric-only',
      sizeTransitions: [makeSizeTransition('height', '0', 'auto')],
      transitions: [makeTransition('height', 0.4, 'ease')],
      useCalcSize: false,
      calcSizeProperty: 'height',
      calcSizeBasis: 'auto',
      calcSizeExpr: '',
      scenario: 'accordion',
    },
  },
];

// 默认配置（取第一个预设的副本，避免共享引用）
const makeDefaultConfig = (): InterpolateSizeConfig => ({
  ...PRESETS[0].config,
  sizeTransitions: PRESETS[0].config.sizeTransitions.map(s => ({ ...s, id: genId() })),
  transitions: PRESETS[0].config.transitions.map(t => ({ ...t, id: genId() })),
});

// 泛型分段按钮组（复用于 interpolate-size / 预览场景选择）
function SegGroup<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="is-seg">
      {label && <span className="is-seg__label">{label}</span>}
      <div className="is-seg__btns">
        {options.map(opt => (
          <button
            key={opt.value}
            type="button"
            className={`is-seg__btn ${value === opt.value ? 'is-seg__btn--active' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function InterpolateSizeTool() {
  const [config, setConfig] = useState<InterpolateSizeConfig>(makeDefaultConfig);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false); // 预览折叠态切换
  const [activePreset, setActivePreset] = useState<string>(PRESETS[0].name);
  const previewRef = useRef<HTMLDivElement>(null);

  // 代码生成
  const cssCode = useMemo(() => buildCss(config), [config]);
  const explainLines = useMemo(() => buildExplain(config), [config]);

  // 切换预设
  const applyPreset = useCallback((preset: InterpolateSizePreset) => {
    setActivePreset(preset.name);
    setConfig({
      ...preset.config,
      sizeTransitions: preset.config.sizeTransitions.map(s => ({ ...s, id: genId() })),
      transitions: preset.config.transitions.map(t => ({ ...t, id: genId() })),
    });
  }, []);

  // 复制代码
  const handleCopy = useCallback(async () => {
    const ok = await copyText(cssCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [cssCode]);

  // 更新辅助函数（不可变更新）
  const updateConfig = useCallback((patch: Partial<InterpolateSizeConfig>) => {
    setConfig(prev => ({ ...prev, ...patch }));
  }, []);

  // 尺寸过渡项更新
  const updateSizeTransition = useCallback((id: string, patch: Partial<SizeTransition>) => {
    setConfig(prev => ({
      ...prev,
      sizeTransitions: prev.sizeTransitions.map(s => (s.id === id ? { ...s, ...patch } : s)),
    }));
  }, []);

  const addSizeTransition = useCallback(() => {
    setConfig(prev => ({
      ...prev,
      sizeTransitions: [...prev.sizeTransitions, makeSizeTransition('width', '0', 'auto')],
    }));
  }, []);

  const removeSizeTransition = useCallback((id: string) => {
    setConfig(prev => ({
      ...prev,
      // 保留下限 1 条，避免失去工具意义
      sizeTransitions: prev.sizeTransitions.length > 1 ? prev.sizeTransitions.filter(s => s.id !== id) : prev.sizeTransitions,
    }));
  }, []);

  // transition 项更新
  const updateTransition = useCallback((id: string, patch: Partial<TransitionItem>) => {
    setConfig(prev => ({
      ...prev,
      transitions: prev.transitions.map(t => (t.id === id ? { ...t, ...patch } : t)),
    }));
  }, []);

  const addTransition = useCallback(() => {
    setConfig(prev => ({
      ...prev,
      transitions: [...prev.transitions, makeTransition('opacity', 0.3, 'ease')],
    }));
  }, []);

  const removeTransition = useCallback((id: string) => {
    setConfig(prev => ({
      ...prev,
      transitions: prev.transitions.length > 1 ? prev.transitions.filter(t => t.id !== id) : prev.transitions,
    }));
  }, []);

  // 构建预览样式（折叠/展开态）
  const previewStyle = useMemo(() => {
    const style: React.CSSProperties = { overflow: 'hidden' };
    const target = expanded ? 'expanded' : 'collapsed';
    for (const s of config.sizeTransitions) {
      const val = target === 'expanded' ? s.expanded : s.collapsed;
      // 注意：浏览器对 'auto' 等关键字的 inline style 支持有限，
      // 这里仅作为视觉示意；真实效果以生成的 CSS 为准
      if (s.property === 'height' || s.property === 'block-size') {
        (style as Record<string, string>).height = val;
      } else if (s.property === 'width' || s.property === 'inline-size') {
        (style as Record<string, string>).width = val;
      } else if (s.property === 'min-height') {
        style.minHeight = val;
      } else if (s.property === 'max-height') {
        style.maxHeight = val;
      } else if (s.property === 'min-width') {
        style.minWidth = val;
      } else if (s.property === 'max-width') {
        style.maxWidth = val;
      }
    }
    return style;
  }, [config.sizeTransitions, expanded]);

  // 预览内容（根据 scenario 选择不同预览文本）
  const previewContent = useMemo(() => {
    if (config.scenario === 'menu') {
      return ['首页', '产品介绍', '使用文档', '常见问题', '联系我们'];
    }
    if (config.scenario === 'card') {
      return ['卡片标题', '这是一段卡片正文内容，用于演示宽度过渡时的视觉效果。', '点击切换折叠/展开状态'];
    }
    // accordion 默认
    return [
      '什么是 interpolate-size？',
      'interpolate-size 是 CSS 2024 年新增属性，允许在动画与过渡中插值 auto、min-content、max-content 等尺寸关键字。这解决了传统 transition 无法对 height: auto 过渡的长期痛点。',
      '配合 calc-size() 函数，可以在尺寸关键字基础上做计算（如 calc-size(auto, size + 20px)），实现更灵活的尺寸过渡。',
      '典型应用场景：折叠面板展开、下拉菜单、accordion、卡片展开。无需 JS 测量元素高度，纯 CSS 实现平滑过渡。',
    ];
  }, [config.scenario]);

  return (
    <div className="is-tool">
      {/* 预设按钮组 */}
      <div className="is-presets">
        {PRESETS.map(p => (
          <button
            key={p.name}
            type="button"
            className={`is-preset-btn ${activePreset === p.name ? 'is-preset-btn--active' : ''}`}
            onClick={() => applyPreset(p)}
            title={p.description}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="is-layout">
        {/* 左栏：配置面板 */}
        <div className="is-panel">
          {/* interpolate-size 选择 */}
          <fieldset className="is-field">
            <legend>interpolate-size 设置</legend>
            <SegGroup
              label="取值"
              value={config.interpolateSize}
              onChange={v => updateConfig({ interpolateSize: v })}
              options={[
                { value: 'allow-keywords', label: 'allow-keywords（推荐）' },
                { value: 'numeric-only', label: 'numeric-only（默认）' },
              ]}
            />
            <p className="is-hint">
              allow-keywords 允许尺寸关键字参与插值；numeric-only 是默认值，关键字不参与插值（过渡立即跳变）
            </p>
          </fieldset>

          {/* 尺寸过渡声明 */}
          <fieldset className="is-field">
            <legend>尺寸过渡声明</legend>
            {config.sizeTransitions.map(s => (
              <div key={s.id} className="is-row is-row--size">
                <select
                  className="is-input is-input--select"
                  value={s.property}
                  onChange={e => updateSizeTransition(s.id, { property: e.target.value })}
                  aria-label="尺寸属性"
                >
                  {SIZE_PROPERTIES.map(p => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <input
                  className="is-input is-input--text"
                  value={s.collapsed}
                  onChange={e => updateSizeTransition(s.id, { collapsed: e.target.value })}
                  placeholder="折叠态（如 0）"
                  aria-label="折叠态值"
                />
                <span className="is-arrow">→</span>
                <input
                  className="is-input is-input--text"
                  value={s.expanded}
                  onChange={e => updateSizeTransition(s.id, { expanded: e.target.value })}
                  placeholder="展开态（如 auto）"
                  aria-label="展开态值"
                />
                <button
                  type="button"
                  className="is-btn is-btn--danger"
                  onClick={() => removeSizeTransition(s.id)}
                  aria-label="删除此尺寸过渡"
                  title="删除"
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="is-btn is-btn--add" onClick={addSizeTransition}>
              + 添加尺寸过渡
            </button>
            <p className="is-hint">
              可用关键字：{SIZE_KEYWORDS.join('、')}。auto/min-content/max-content/fit-content 等需配合 interpolate-size: allow-keywords 才能平滑过渡
            </p>
          </fieldset>

          {/* transition 过渡配置 */}
          <fieldset className="is-field">
            <legend>transition 过渡配置</legend>
            {config.transitions.map(t => (
              <div key={t.id} className="is-row is-row--transition">
                <input
                  className="is-input is-input--text"
                  value={t.property}
                  onChange={e => updateTransition(t.id, { property: e.target.value })}
                  placeholder="属性（如 height）"
                  aria-label="过渡属性"
                />
                <label className="is-mini-label">
                  时长
                  <input
                    className="is-input is-input--number"
                    type="number"
                    step="0.05"
                    min="0"
                    value={t.duration}
                    onChange={e => updateTransition(t.id, { duration: Number(e.target.value) })}
                  />
                  s
                </label>
                <select
                  className="is-input is-input--select"
                  value={t.timingFunction}
                  onChange={e => updateTransition(t.id, { timingFunction: e.target.value })}
                  aria-label="缓动函数"
                >
                  {TIMING_PRESETS.map(p => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <label className="is-mini-label">
                  延迟
                  <input
                    className="is-input is-input--number"
                    type="number"
                    step="0.05"
                    min="0"
                    value={t.delay}
                    onChange={e => updateTransition(t.id, { delay: Number(e.target.value) })}
                  />
                  s
                </label>
                <button
                  type="button"
                  className="is-btn is-btn--danger"
                  onClick={() => removeTransition(t.id)}
                  aria-label="删除此过渡"
                  title="删除"
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="is-btn is-btn--add" onClick={addTransition}>
              + 添加过渡属性
            </button>
          </fieldset>

          {/* calc-size() 配置 */}
          <fieldset className="is-field">
            <legend>calc-size() 计算（可选）</legend>
            <label className="is-checkbox-row">
              <input
                type="checkbox"
                checked={config.useCalcSize}
                onChange={e => updateConfig({ useCalcSize: e.target.checked })}
              />
              <span>启用 calc-size() 在尺寸关键字基础上做计算</span>
            </label>
            {config.useCalcSize && (
              <div className="is-calcsize-config">
                <label className="is-mini-label">
                  应用属性
                  <select
                    className="is-input is-input--select"
                    value={config.calcSizeProperty}
                    onChange={e => updateConfig({ calcSizeProperty: e.target.value })}
                  >
                    {SIZE_PROPERTIES.map(p => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="is-mini-label">
                  基础关键字
                  <select
                    className="is-input is-input--select"
                    value={config.calcSizeBasis}
                    onChange={e => updateConfig({ calcSizeBasis: e.target.value })}
                  >
                    {SIZE_KEYWORDS.map(k => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="is-mini-label">
                  计算表达式（size 代表基础尺寸）
                  <input
                    className="is-input is-input--text"
                    value={config.calcSizeExpr}
                    onChange={e => updateConfig({ calcSizeExpr: e.target.value })}
                    placeholder="如 size + 20px、size * 0.5"
                  />
                </label>
                <p className="is-hint">
                  生成值：<code>{buildCalcSizeValue(config.calcSizeBasis, config.calcSizeExpr)}</code>
                </p>
              </div>
            )}
          </fieldset>

          {/* 选择器 + 预览场景 */}
          <fieldset className="is-field">
            <legend>选择器与预览</legend>
            <label className="is-mini-label">
              目标选择器
              <input
                className="is-input is-input--text"
                value={config.selector}
                onChange={e => updateConfig({ selector: e.target.value })}
                placeholder="如 .accordion-panel"
              />
            </label>
            <SegGroup
              label="预览场景"
              value={config.scenario}
              onChange={v => updateConfig({ scenario: v })}
              options={[
                { value: 'accordion', label: '折叠面板' },
                { value: 'menu', label: '下拉菜单' },
                { value: 'card', label: '卡片展开' },
              ]}
            />
          </fieldset>
        </div>

        {/* 右栏：预览 + 原理 + 代码 */}
        <div className="is-output">
          {/* 预览区 */}
          <div className="is-preview-block">
            <div className="is-preview-header">
              <h3 className="is-section-title">实时预览</h3>
              <button
                type="button"
                className="is-btn is-btn--toggle"
                onClick={() => setExpanded(v => !v)}
              >
                {expanded ? '切换到折叠态' : '切换到展开态'}
              </button>
            </div>
            <div className="is-preview-stage" ref={previewRef}>
              <div className="is-preview-content" style={previewStyle}>
                {previewContent.map((text, i) => (
                  <p key={i} className="is-preview-text">
                    {text}
                  </p>
                ))}
              </div>
            </div>
            <p className="is-hint">
              当前状态：<strong>{expanded ? '展开态' : '折叠态'}</strong>
              {config.interpolateSize === 'allow-keywords' && ' · allow-keywords 已启用，尺寸关键字将平滑过渡'}
              {config.interpolateSize === 'numeric-only' && ' · numeric-only 模式，关键字过渡将跳变'}
            </p>
          </div>

          {/* 原理说明 */}
          <div className="is-explain-block">
            <h3 className="is-section-title">原理说明</h3>
            <ul className="is-explain-list">
              {explainLines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>

          {/* 代码输出 */}
          <div className="is-code-block">
            <div className="is-code-header">
              <h3 className="is-section-title">生成的 CSS</h3>
              <button
                type="button"
                className={`is-btn is-btn--copy ${copied ? 'is-btn--copied' : ''}`}
                onClick={handleCopy}
              >
                {copied ? '已复制' : '复制代码'}
              </button>
            </div>
            <pre className="is-code">
              <code>{cssCode}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
