import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS scroll-driven 动画生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 三种时间线：scroll()（滚动位置驱动）/ view()（元素可见性驱动）/ 命名时间线
 *  - scroll() 参数：source（nearest/root）+ axis（block/inline/x/y）
 *  - view() 参数：source + axis + inset（可见区边距）
 *  - animation-range：7 种预设（cover/contain/entry/exit 等）或自定义范围
 *  - @keyframes 关键帧编辑：多帧 + 每帧多声明
 *  - iframe 沙箱预览，可滚动实时查看动画效果
 *  - 7 组预设覆盖进度条、入场、视差、揭示等场景
 *
 * 核心知识点：
 *  - scroll-driven 动画用滚动位置/元素可见性代替时间驱动 @keyframes
 *  - animation-duration 必须为 auto（由时间线决定进度）
 *  - animation-timeline 不能写入 animation 简写，需单独声明
 *  - 浏览器支持：Chrome 115+（2023-08），Safari/Firefox 逐步跟进
 */

/** 时间线类型 */
type TimelineType = 'scroll' | 'view' | 'named';

/** 滚动轴 */
type Axis = 'block' | 'inline' | 'x' | 'y';

/** 滚动容器源 */
type Source = 'nearest' | 'root';

/** 单条 CSS 声明 */
interface KeyframeDecl {
  id: string;
  property: string;
  value: string;
}

/** 单个关键帧 */
interface Keyframe {
  id: string;
  offset: string; // 'from' | 'to' | '0%' | '50%' 等
  declarations: KeyframeDecl[];
}

/** 完整动画配置 */
interface AnimationConfig {
  selector: string; // 目标选择器
  timelineType: TimelineType;
  // scroll() 参数
  scrollSource: Source;
  scrollAxis: Axis;
  // view() 参数
  viewSource: Source;
  viewAxis: Axis;
  viewInset: string; // 'auto' | '20% 10%' 等
  // 命名时间线
  namedTimeline: string; // '--my-timeline'
  // animation-range
  rangePreset: string; // 'normal' | 'cover' | 'contain' | 'entry' | 'exit' | 'entry-crossing' | 'exit-crossing' | 'custom'
  rangeCustom: string; // 自定义范围，如 'entry 0% to exit 50%'
  // @keyframes
  keyframeName: string; // @keyframes 名称
  keyframes: Keyframe[];
}

/** 预设：配置 + 预览 HTML */
interface ScrollPreset {
  name: string;
  config: AnimationConfig;
  previewHtml: string;
}

// 模块级 id 生成器，保证 React key 稳定唯一
let _idCounter = 0;
const genId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${(++_idCounter).toString(36)}`;

/** 创建一条声明 */
const makeDecl = (property: string, value: string): KeyframeDecl => ({
  id: genId('decl'),
  property,
  value,
});

/** 创建一个关键帧 */
const makeKeyframe = (offset: string, declarations: KeyframeDecl[] = []): Keyframe => ({
  id: genId('kf'),
  offset,
  declarations,
});

/** 7 种 animation-range 预设选项 */
const RANGE_PRESETS = [
  { value: 'normal', label: 'normal（默认）' },
  { value: 'cover', label: 'cover（全程覆盖）' },
  { value: 'contain', label: 'contain（完全可见期）' },
  { value: 'entry', label: 'entry（进入期）' },
  { value: 'exit', label: 'exit（离开期）' },
  { value: 'entry-crossing', label: 'entry-crossing（进入跨越）' },
  { value: 'exit-crossing', label: 'exit-crossing（离开跨越）' },
  { value: 'custom', label: '自定义' },
];

// 7 组预设，覆盖 scroll-driven 动画最常见应用场景
const PRESETS: ScrollPreset[] = [
  {
    // 顶部滚动进度条：根容器滚动，进度条宽度从 0 增长到 100%
    name: '滚动进度条',
    previewHtml: `<div class="progress"></div>
<div class="scroller">
  <p>向下滚动观察顶部进度条</p>
  <div class="block">区块 1</div>
  <div class="block">区块 2</div>
  <div class="block">区块 3</div>
  <div class="block">区块 4</div>
  <div class="block">区块 5</div>
</div>`,
    config: {
      selector: '.progress',
      timelineType: 'scroll',
      scrollSource: 'root',
      scrollAxis: 'block',
      viewSource: 'nearest',
      viewAxis: 'block',
      viewInset: 'auto',
      namedTimeline: '--my-timeline',
      rangePreset: 'normal',
      rangeCustom: '',
      keyframeName: 'progress-grow',
      keyframes: [
        makeKeyframe('from', [makeDecl('width', '0%')]),
        makeKeyframe('to', [makeDecl('width', '100%')]),
      ],
    },
  },
  {
    // 元素淡入入场：view() 驱动，元素进入视口时从透明变为不透明
    name: '淡入入场',
    previewHtml: `<div class="scroller">
  <div class="reveal">向下滚动，元素逐个淡入</div>
  <div class="reveal">第二段文字</div>
  <div class="reveal">第三段文字</div>
  <div class="reveal">第四段文字</div>
  <div class="reveal">第五段文字</div>
</div>`,
    config: {
      selector: '.reveal',
      timelineType: 'view',
      scrollSource: 'nearest',
      scrollAxis: 'block',
      viewSource: 'nearest',
      viewAxis: 'block',
      viewInset: 'auto',
      namedTimeline: '--my-timeline',
      rangePreset: 'entry',
      rangeCustom: '',
      keyframeName: 'fade-in',
      keyframes: [
        makeKeyframe('from', [makeDecl('opacity', '0'), makeDecl('transform', 'translateY(30px)')]),
        makeKeyframe('to', [makeDecl('opacity', '1'), makeDecl('transform', 'translateY(0)')]),
      ],
    },
  },
  {
    // 视差滚动：scroll() 驱动，元素在滚动时产生位移差
    name: '视差滚动',
    previewHtml: `<div class="scroller">
  <div class="parallax">视差元素</div>
  <div class="spacer">继续滚动</div>
  <div class="spacer">继续滚动</div>
  <div class="spacer">继续滚动</div>
</div>`,
    config: {
      selector: '.parallax',
      timelineType: 'scroll',
      scrollSource: 'nearest',
      scrollAxis: 'block',
      viewSource: 'nearest',
      viewAxis: 'block',
      viewInset: 'auto',
      namedTimeline: '--my-timeline',
      rangePreset: 'normal',
      rangeCustom: '',
      keyframeName: 'parallax-move',
      keyframes: [
        makeKeyframe('from', [makeDecl('transform', 'translateY(0)')]),
        makeKeyframe('to', [makeDecl('transform', 'translateY(-120px)')]),
      ],
    },
  },
  {
    // 卡片揭示：view() 驱动，元素从缩小状态放大到正常
    name: '卡片揭示',
    previewHtml: `<div class="scroller">
  <div class="card">卡片 1</div>
  <div class="card">卡片 2</div>
  <div class="card">卡片 3</div>
  <div class="card">卡片 4</div>
</div>`,
    config: {
      selector: '.card',
      timelineType: 'view',
      scrollSource: 'nearest',
      scrollAxis: 'block',
      viewSource: 'nearest',
      viewAxis: 'block',
      viewInset: 'auto',
      namedTimeline: '--my-timeline',
      rangePreset: 'cover',
      rangeCustom: '',
      keyframeName: 'card-reveal',
      keyframes: [
        makeKeyframe('from', [makeDecl('opacity', '0'), makeDecl('transform', 'scale(0.8)')]),
        makeKeyframe('to', [makeDecl('opacity', '1'), makeDecl('transform', 'scale(1)')]),
      ],
    },
  },
  {
    // 旋转进度：scroll() 驱动，元素随滚动旋转 360 度
    name: '旋转进度',
    previewHtml: `<div class="scroller">
  <div class="spinner"></div>
  <div class="spacer">继续滚动</div>
  <div class="spacer">继续滚动</div>
  <div class="spacer">继续滚动</div>
</div>`,
    config: {
      selector: '.spinner',
      timelineType: 'scroll',
      scrollSource: 'nearest',
      scrollAxis: 'block',
      viewSource: 'nearest',
      viewAxis: 'block',
      viewInset: 'auto',
      namedTimeline: '--my-timeline',
      rangePreset: 'normal',
      rangeCustom: '',
      keyframeName: 'spin',
      keyframes: [
        makeKeyframe('from', [makeDecl('transform', 'rotate(0deg)')]),
        makeKeyframe('to', [makeDecl('transform', 'rotate(360deg)')]),
      ],
    },
  },
  {
    // 自定义范围：view() + 自定义 animation-range，只在元素进入视口的前半段动画
    name: '半程入场',
    previewHtml: `<div class="scroller">
  <div class="target">自定义范围元素</div>
  <div class="spacer">继续滚动</div>
  <div class="spacer">继续滚动</div>
</div>`,
    config: {
      selector: '.target',
      timelineType: 'view',
      scrollSource: 'nearest',
      scrollAxis: 'block',
      viewSource: 'nearest',
      viewAxis: 'block',
      viewInset: 'auto',
      namedTimeline: '--my-timeline',
      rangePreset: 'custom',
      rangeCustom: 'entry 0% to entry 50%',
      keyframeName: 'half-in',
      keyframes: [
        makeKeyframe('from', [makeDecl('opacity', '0'), makeDecl('transform', 'translateX(-40px)')]),
        makeKeyframe('to', [makeDecl('opacity', '1'), makeDecl('transform', 'translateX(0)')]),
      ],
    },
  },
  {
    // 默认示例：滚动进度条
    name: '默认示例',
    previewHtml: `<div class="progress"></div>
<div class="scroller">
  <p>滚动驱动动画示例</p>
  <div class="block">区块 A</div>
  <div class="block">区块 B</div>
  <div class="block">区块 C</div>
</div>`,
    config: {
      selector: '.progress',
      timelineType: 'scroll',
      scrollSource: 'root',
      scrollAxis: 'block',
      viewSource: 'nearest',
      viewAxis: 'block',
      viewInset: 'auto',
      namedTimeline: '--my-timeline',
      rangePreset: 'normal',
      rangeCustom: '',
      keyframeName: 'progress-grow',
      keyframes: [
        makeKeyframe('from', [makeDecl('width', '0%')]),
        makeKeyframe('to', [makeDecl('width', '100%')]),
      ],
    },
  },
];

/** 默认配置（与"默认示例"预设一致） */
const DEFAULT_INDEX = PRESETS.length - 1;
const DEFAULT_CONFIG: AnimationConfig = PRESETS[DEFAULT_INDEX].config;
const DEFAULT_HTML: string = PRESETS[DEFAULT_INDEX].previewHtml;

/**
 * 生成 animation-timeline 属性值
 * - scroll：scroll(source axis)
 * - view：view(source axis [inset])
 * - named：var(--name)
 */
function buildTimelineValue(cfg: AnimationConfig): string {
  if (cfg.timelineType === 'scroll') {
    return `scroll(${cfg.scrollSource} ${cfg.scrollAxis})`;
  }
  if (cfg.timelineType === 'view') {
    const inset = cfg.viewInset.trim();
    // inset 为 auto 或空时省略，否则追加 inset 子句
    const insetPart = inset && inset !== 'auto' ? ` inset ${inset}` : '';
    return `view(${cfg.viewSource} ${cfg.viewAxis}${insetPart})`;
  }
  // 命名时间线
  const name = cfg.namedTimeline.trim();
  return name ? name : '--my-timeline';
}

/**
 * 生成 animation-range 属性值
 * - 预设：直接使用预设名
 * - 自定义：使用用户输入的自定义范围字符串
 */
function buildRangeValue(cfg: AnimationConfig): string {
  if (cfg.rangePreset === 'custom') {
    return cfg.rangeCustom.trim() || 'normal';
  }
  if (cfg.rangePreset === 'normal') {
    return 'normal';
  }
  return cfg.rangePreset;
}

/**
 * 生成 @keyframes 文本
 * - 偏移量 from/to 保留原样，百分比保留原样
 * - 每帧输出声明列表
 */
function buildKeyframes(cfg: AnimationConfig): string {
  const lines: string[] = [`@keyframes ${cfg.keyframeName} {`];
  cfg.keyframes.forEach((kf, idx) => {
    if (idx > 0) lines.push('');
    const offset = kf.offset.trim() || '0%';
    lines.push(`  ${offset} {`);
    kf.declarations.forEach((d) => {
      if (d.property.trim() && d.value.trim()) {
        lines.push(`    ${d.property}: ${d.value};`);
      }
    });
    lines.push('  }');
  });
  lines.push('}');
  return lines.join('\n');
}

/** 生成完整 CSS 代码 */
function buildCss(cfg: AnimationConfig): string {
  const keyframes = buildKeyframes(cfg);
  const timeline = buildTimelineValue(cfg);
  const range = buildRangeValue(cfg);
  const sel = cfg.selector.trim() || '.target';
  const lines: string[] = [keyframes, '', `${sel} {`];
  // scroll-driven 动画必须单独写 animation-timeline，duration 必须为 auto
  lines.push(`  animation-name: ${cfg.keyframeName};`);
  lines.push(`  animation-duration: auto;`);
  lines.push(`  animation-timeline: ${timeline};`);
  if (range !== 'normal') {
    lines.push(`  animation-range: ${range};`);
  }
  lines.push('}');
  return lines.join('\n');
}

/** 生成时间线说明文本（用于说明面板） */
function buildTimelineExplain(cfg: AnimationConfig): string {
  if (cfg.timelineType === 'scroll') {
    const sourceDesc = cfg.scrollSource === 'root' ? '根滚动容器（整个文档）' : '最近的滚动祖先';
    const axisDesc = {
      block: '块向轴（通常为垂直滚动）',
      inline: '行向轴（通常为水平滚动）',
      x: '水平轴',
      y: '垂直轴',
    }[cfg.scrollAxis];
    return `scroll() 时间线：基于${sourceDesc}的滚动位置驱动动画，轴向为${axisDesc}。滚动进度 0% → 100% 映射到关键帧 from → to。`;
  }
  if (cfg.timelineType === 'view') {
    const sourceDesc = cfg.viewSource === 'root' ? '根滚动容器' : '最近的滚动祖先';
    const insetDesc = cfg.viewInset.trim() && cfg.viewInset.trim() !== 'auto' ? `，inset 边距 ${cfg.viewInset}` : '';
    return `view() 时间线：基于元素在${sourceDesc}中的可见性驱动动画${insetDesc}。元素从进入视口到离开视口的过程映射到关键帧。`;
  }
  return `命名时间线：引用通过 view-timeline-name 或 scroll-timeline-name 定义的具名时间线，适合跨组件复用。`;
}

/** 生成 animation-range 说明文本 */
function buildRangeExplain(cfg: AnimationConfig): string {
  const range = buildRangeValue(cfg);
  const map: Record<string, string> = {
    normal: 'normal：使用时间线默认范围（scroll 为全程，view 为 cover）',
    cover: 'cover：元素从进入视口到完全离开视口的全程',
    contain: 'contain：元素完全在视口内的区间',
    entry: 'entry：元素从开始进入视口到完全进入视口',
    exit: 'exit：元素从开始离开视口到完全离开视口',
    'entry-crossing': 'entry-crossing：元素跨越视口边缘进入的阶段',
    'exit-crossing': 'exit-crossing：元素跨越视口边缘离开的阶段',
  };
  if (cfg.rangePreset === 'custom') {
    return `自定义范围：${range}。可用 entry/exit/contain/cover 等关键字 + 百分比/vh 组合。`;
  }
  return map[range] || range;
}

/** 单条声明编辑行 */
function DeclRow({
  decl,
  onChange,
  onRemove,
}: {
  decl: KeyframeDecl;
  onChange: (property: string, value: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="sdt__decl">
      <input
        className="sdt__decl-prop"
        type="text"
        value={decl.property}
        placeholder="属性"
        onChange={(e) => onChange(e.target.value, decl.value)}
      />
      <span className="sdt__decl-colon">:</span>
      <input
        className="sdt__decl-val"
        type="text"
        value={decl.value}
        placeholder="值"
        onChange={(e) => onChange(decl.property, e.target.value)}
      />
      <button type="button" className="sdt__btn sdt__btn--del" onClick={onRemove} aria-label="删除该声明">
        ×
      </button>
    </div>
  );
}

export default function ScrollTimelineTool() {
  // 深拷贝配置，为每个节点生成新的稳定 id
  const cloneConfig = useCallback((cfg: AnimationConfig): AnimationConfig => ({
    ...cfg,
    keyframes: cfg.keyframes.map((kf) => ({
      id: genId('kf'),
      offset: kf.offset,
      declarations: kf.declarations.map((d) => ({ id: genId('decl'), property: d.property, value: d.value })),
    })),
  }), []);

  const [config, setConfig] = useState<AnimationConfig>(() => cloneConfig(DEFAULT_CONFIG));
  const [previewHtml, setPreviewHtml] = useState<string>(DEFAULT_HTML);
  const [copied, setCopied] = useState(false);

  // 生成的 CSS 代码
  const cssCode = useMemo(() => buildCss(config), [config]);

  // 时间线与范围说明
  const timelineExplain = useMemo(() => buildTimelineExplain(config), [config]);
  const rangeExplain = useMemo(() => buildRangeExplain(config), [config]);

  // 预览 iframe 的 srcDoc：包含可滚动容器样式 + 用户 CSS + 用户 HTML
  const previewSrcDoc = useMemo(() => {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 0; color: #111827; }
      /* 预览容器基础样式，确保有足够内容可滚动 */
      .scroller { height: 400px; overflow-y: auto; padding: 20px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; }
      .scroller > * { margin-bottom: 16px; }
      .progress { position: sticky; top: 0; height: 6px; background: linear-gradient(90deg, #2563eb, #7c3aed); border-radius: 3px; z-index: 10; width: 0; }
      .block { height: 80px; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 15px; color: #374151; }
      .reveal { padding: 16px; background: #fff; border-left: 3px solid #2563eb; border-radius: 4px; font-size: 15px; }
      .parallax { height: 100px; background: linear-gradient(135deg, #2563eb, #7c3aed); color: #fff; display: flex; align-items: center; justify-content: center; border-radius: 8px; font-size: 16px; font-weight: 600; }
      .card { height: 90px; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 15px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
      .spinner { width: 60px; height: 60px; background: conic-gradient(from 0deg, #2563eb, #7c3aed); border-radius: 50%; margin: 0 auto; }
      .target { padding: 20px; background: #dbeafe; border-radius: 8px; font-size: 15px; }
      .spacer { height: 80px; display: flex; align-items: center; justify-content: center; color: #9ca3af; font-size: 14px; }
      p { font-size: 14px; color: #6b7280; }
      /* 用户生成的 scroll-driven 动画 CSS */
      ${cssCode}
    </style></head><body>${previewHtml}</body></html>`;
  }, [cssCode, previewHtml]);

  // 应用预设
  const applyPreset = useCallback(
    (preset: ScrollPreset) => {
      setConfig(cloneConfig(preset.config));
      setPreviewHtml(preset.previewHtml);
    },
    [cloneConfig],
  );

  // 复制 CSS
  const handleCopy = useCallback(async () => {
    const ok = await copyText(cssCode);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  }, [cssCode]);

  // === 配置更新工具函数 ===
  const updateField = useCallback(<K extends keyof AnimationConfig>(key: K, value: AnimationConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }, []);

  // === 关键帧操作 ===
  const addKeyframe = useCallback(() => {
    setConfig((prev) => ({
      ...prev,
      keyframes: [...prev.keyframes, makeKeyframe('50%', [makeDecl('opacity', '0.5')])],
    }));
  }, []);
  const removeKeyframe = useCallback((id: string) => {
    setConfig((prev) => ({ ...prev, keyframes: prev.keyframes.filter((k) => k.id !== id) }));
  }, []);
  const updateKeyframeOffset = useCallback((id: string, offset: string) => {
    setConfig((prev) => ({
      ...prev,
      keyframes: prev.keyframes.map((k) => (k.id === id ? { ...k, offset } : k)),
    }));
  }, []);

  // === 关键帧内声明操作 ===
  const addDecl = useCallback((kfId: string) => {
    setConfig((prev) => ({
      ...prev,
      keyframes: prev.keyframes.map((k) =>
        k.id === kfId ? { ...k, declarations: [...k.declarations, makeDecl('', '')] } : k,
      ),
    }));
  }, []);
  const updateDecl = useCallback((kfId: string, declId: string, property: string, value: string) => {
    setConfig((prev) => ({
      ...prev,
      keyframes: prev.keyframes.map((k) =>
        k.id === kfId
          ? { ...k, declarations: k.declarations.map((d) => (d.id === declId ? { ...d, property, value } : d)) }
          : k,
      ),
    }));
  }, []);
  const removeDecl = useCallback((kfId: string, declId: string) => {
    setConfig((prev) => ({
      ...prev,
      keyframes: prev.keyframes.map((k) =>
        k.id === kfId ? { ...k, declarations: k.declarations.filter((d) => d.id !== declId) } : k,
      ),
    }));
  }, []);

  return (
    <div className="sdt">
      {/* 预设按钮组 */}
      <div className="sdt__presets">
        <span className="sdt__presets-label">预设：</span>
        {PRESETS.map((p) => (
          <button key={p.name} type="button" className="sdt__btn sdt__btn--preset" onClick={() => applyPreset(p)}>
            {p.name}
          </button>
        ))}
      </div>

      <div className="sdt__main">
        {/* 左：编辑区 */}
        <div className="sdt__editor">
          {/* 目标与时间线配置 */}
          <div className="sdt__panel">
            <div className="sdt__panel-head">
              <span className="sdt__panel-title">目标与时间线</span>
            </div>
            <div className="sdt__panel-body">
              <label className="sdt__field">
                <span className="sdt__field-label">目标选择器</span>
                <input
                  className="sdt__field-input"
                  type="text"
                  value={config.selector}
                  placeholder="如 .reveal"
                  onChange={(e) => updateField('selector', e.target.value)}
                />
              </label>

              <div className="sdt__field">
                <span className="sdt__field-label">时间线类型</span>
                <div className="sdt__radio-group">
                  {(['scroll', 'view', 'named'] as TimelineType[]).map((t) => (
                    <label key={t} className="sdt__radio">
                      <input
                        type="radio"
                        name="timeline-type"
                        checked={config.timelineType === t}
                        onChange={() => updateField('timelineType', t)}
                      />
                      <span>{t === 'scroll' ? 'scroll()' : t === 'view' ? 'view()' : '命名时间线'}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* scroll() 参数 */}
              {config.timelineType === 'scroll' && (
                <div className="sdt__sub-config">
                  <label className="sdt__field">
                    <span className="sdt__field-label">source（滚动容器）</span>
                    <select
                      className="sdt__field-select"
                      value={config.scrollSource}
                      onChange={(e) => updateField('scrollSource', e.target.value as Source)}
                    >
                      <option value="nearest">nearest（最近滚动祖先）</option>
                      <option value="root">root（根滚动容器/文档）</option>
                    </select>
                  </label>
                  <label className="sdt__field">
                    <span className="sdt__field-label">axis（滚动轴）</span>
                    <select
                      className="sdt__field-select"
                      value={config.scrollAxis}
                      onChange={(e) => updateField('scrollAxis', e.target.value as Axis)}
                    >
                      <option value="block">block（块向轴/垂直）</option>
                      <option value="inline">inline（行向轴/水平）</option>
                      <option value="x">x（水平轴）</option>
                      <option value="y">y（垂直轴）</option>
                    </select>
                  </label>
                </div>
              )}

              {/* view() 参数 */}
              {config.timelineType === 'view' && (
                <div className="sdt__sub-config">
                  <label className="sdt__field">
                    <span className="sdt__field-label">source（滚动容器）</span>
                    <select
                      className="sdt__field-select"
                      value={config.viewSource}
                      onChange={(e) => updateField('viewSource', e.target.value as Source)}
                    >
                      <option value="nearest">nearest（最近滚动祖先）</option>
                      <option value="root">root（根滚动容器/文档）</option>
                    </select>
                  </label>
                  <label className="sdt__field">
                    <span className="sdt__field-label">axis（滚动轴）</span>
                    <select
                      className="sdt__field-select"
                      value={config.viewAxis}
                      onChange={(e) => updateField('viewAxis', e.target.value as Axis)}
                    >
                      <option value="block">block（块向轴/垂直）</option>
                      <option value="inline">inline（行向轴/水平）</option>
                      <option value="x">x（水平轴）</option>
                      <option value="y">y（垂直轴）</option>
                    </select>
                  </label>
                  <label className="sdt__field">
                    <span className="sdt__field-label">inset（可见区边距）</span>
                    <input
                      className="sdt__field-input"
                      type="text"
                      value={config.viewInset}
                      placeholder="auto 或如 20% 10%"
                      onChange={(e) => updateField('viewInset', e.target.value)}
                    />
                  </label>
                </div>
              )}

              {/* 命名时间线 */}
              {config.timelineType === 'named' && (
                <div className="sdt__sub-config">
                  <label className="sdt__field">
                    <span className="sdt__field-label">时间线名称</span>
                    <input
                      className="sdt__field-input"
                      type="text"
                      value={config.namedTimeline}
                      placeholder="如 --my-timeline"
                      onChange={(e) => updateField('namedTimeline', e.target.value)}
                    />
                  </label>
                  <p className="sdt__hint">
                    命名时间线需配合 <code>scroll-timeline-name</code> 或 <code>view-timeline-name</code> 在滚动容器上定义。
                  </p>
                </div>
              )}

              {/* animation-range */}
              <label className="sdt__field">
                <span className="sdt__field-label">animation-range</span>
                <select
                  className="sdt__field-select"
                  value={config.rangePreset}
                  onChange={(e) => updateField('rangePreset', e.target.value)}
                >
                  {RANGE_PRESETS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              {config.rangePreset === 'custom' && (
                <label className="sdt__field">
                  <span className="sdt__field-label">自定义范围</span>
                  <input
                    className="sdt__field-input"
                    type="text"
                    value={config.rangeCustom}
                    placeholder="如 entry 0% to exit 50%"
                    onChange={(e) => updateField('rangeCustom', e.target.value)}
                  />
                </label>
              )}
            </div>
          </div>

          {/* @keyframes 编辑 */}
          <div className="sdt__panel">
            <div className="sdt__panel-head">
              <span className="sdt__panel-title">@keyframes 关键帧</span>
              <button type="button" className="sdt__btn sdt__btn--add" onClick={addKeyframe}>
                + 新增关键帧
              </button>
            </div>
            <div className="sdt__panel-body">
              <label className="sdt__field">
                <span className="sdt__field-label">动画名称</span>
                <input
                  className="sdt__field-input"
                  type="text"
                  value={config.keyframeName}
                  placeholder="如 fade-in"
                  onChange={(e) => updateField('keyframeName', e.target.value)}
                />
              </label>
              {config.keyframes.length === 0 && (
                <p className="sdt__empty">暂无关键帧，点击"新增关键帧"添加。</p>
              )}
              {config.keyframes.map((kf, idx) => (
                <div key={kf.id} className="sdt__kf">
                  <div className="sdt__kf-head">
                    <span className="sdt__kf-idx" title="关键帧序号">
                      {idx + 1}
                    </span>
                    <input
                      className="sdt__kf-offset"
                      type="text"
                      value={kf.offset}
                      placeholder="from / to / 50%"
                      onChange={(e) => updateKeyframeOffset(kf.id, e.target.value)}
                    />
                    <button
                      type="button"
                      className="sdt__btn sdt__btn--del"
                      onClick={() => removeKeyframe(kf.id)}
                      aria-label="删除该关键帧"
                    >
                      ×
                    </button>
                  </div>
                  <div className="sdt__kf-decls">
                    {kf.declarations.map((d) => (
                      <DeclRow
                        key={d.id}
                        decl={d}
                        onChange={(p, v) => updateDecl(kf.id, d.id, p, v)}
                        onRemove={() => removeDecl(kf.id, d.id)}
                      />
                    ))}
                    <button
                      type="button"
                      className="sdt__btn sdt__btn--add-decl"
                      onClick={() => addDecl(kf.id)}
                    >
                      + 新增声明
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 说明面板 */}
          <div className="sdt__panel sdt__panel--explain">
            <div className="sdt__panel-head">
              <span className="sdt__panel-title">原理说明</span>
            </div>
            <div className="sdt__panel-body">
              <div className="sdt__explain-row">
                <span className="sdt__explain-label">时间线</span>
                <span className="sdt__explain-text">{timelineExplain}</span>
              </div>
              <div className="sdt__explain-row">
                <span className="sdt__explain-label">范围</span>
                <span className="sdt__explain-text">{rangeExplain}</span>
              </div>
              <div className="sdt__explain-row">
                <span className="sdt__explain-label">提示</span>
                <span className="sdt__explain-text">
                  scroll-driven 动画用滚动位置或元素可见性代替时间驱动 @keyframes，<code>animation-duration</code> 必须为 <code>auto</code>，<code>animation-timeline</code> 需单独声明（不能写入 animation 简写）。
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 右：预览 + 代码 */}
        <div className="sdt__output">
          {/* 预览 HTML 编辑 */}
          <div className="sdt__preview-html">
            <label className="sdt__field">
              <span className="sdt__field-label">预览 HTML（可编辑）</span>
              <textarea
                className="sdt__textarea"
                value={previewHtml}
                rows={4}
                onChange={(e) => setPreviewHtml(e.target.value)}
                spellCheck={false}
              />
            </label>
          </div>

          {/* iframe 沙箱预览 */}
          <div className="sdt__preview">
            <div className="sdt__preview-head">
              <span className="sdt__preview-title">实时预览（可在预览区内滚动）</span>
            </div>
            <iframe
              className="sdt__iframe"
              srcDoc={previewSrcDoc}
              title="scroll-driven 动画预览"
              sandbox="allow-same-origin"
            />
          </div>

          {/* 代码输出 */}
          <div className="sdt__code">
            <div className="sdt__code-head">
              <span className="sdt__code-title">生成的 CSS</span>
              <button type="button" className="sdt__btn sdt__btn--copy" onClick={handleCopy}>
                {copied ? '已复制' : '复制 CSS'}
              </button>
            </div>
            <pre className="sdt__code-pre">
              <code>{cssCode}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
