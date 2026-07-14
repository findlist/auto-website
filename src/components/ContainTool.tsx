import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS contain + content-visibility 性能优化生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 完整支持 contain 八种值：none / strict / content / size / layout / paint / style / inline-size
 *  - 完整支持 content-visibility 三种值：visible / hidden / auto
 *  - contain-intrinsic-size 配合 content-visibility: auto 提供占位尺寸
 *  - 可滚动预览区 + IntersectionObserver 演示 content-visibility: auto 屏幕外跳过渲染
 *  - 原理说明面板：解析各值的隔离范围、性能影响与副作用
 *  - 8 组预设覆盖布局隔离、绘制隔离、长列表优化、卡片网格等场景
 *  - 一键复制生成的 CSS 代码
 *
 * 核心知识点：
 *  - contain 是 CSS Containment Module 引入的属性（Level 1 基础，Level 2 增 inline-size，Level 3 增 style）
 *  - contain: layout/paint/style 隔离对应方面，不影响尺寸（推荐 content 组合）
 *  - contain: size 隔离尺寸但需显式指定高度（有副作用，谨慎使用）
 *  - content-visibility: auto 让浏览器跳过屏幕外内容渲染（2023 年全主流浏览器支持）
 *  - contain-intrinsic-size 为跳过渲染的元素提供占位尺寸，避免滚动条跳动
 */

/** contain 属性可选值 */
type ContainValue =
  | 'none'
  | 'strict'
  | 'content'
  | 'size'
  | 'layout'
  | 'paint'
  | 'style'
  | 'inline-size';

/** content-visibility 可选值 */
type ContentVisibility = 'visible' | 'hidden' | 'auto';

/** 完整工具配置 */
interface ContainConfig {
  selector: string;             // CSS 选择器
  contain: ContainValue;        // contain 值
  contentVisibility: ContentVisibility; // content-visibility 值
  useIntrinsicSize: boolean;    // 是否启用 contain-intrinsic-size
  intrinsicWidth: number;       // 占位宽度 px
  intrinsicHeight: number;      // 占位高度 px
  padding: number;              // 预览卡片内边距 px
  background: string;           // 预览卡片背景色
}

/** 预设：名称 + 描述 + 配置 */
interface ContainPreset {
  name: string;
  description: string;
  config: ContainConfig;
}

/** contain 值及说明 */
const CONTAIN_VALUES: { value: ContainValue; label: string; short: string }[] = [
  { value: 'none', label: 'none（不隔离）', short: 'none' },
  { value: 'strict', label: 'strict（全部隔离）', short: 'strict' },
  { value: 'content', label: 'content（除 size）', short: 'content' },
  { value: 'size', label: 'size（尺寸）', short: 'size' },
  { value: 'layout', label: 'layout（布局）', short: 'layout' },
  { value: 'paint', label: 'paint（绘制）', short: 'paint' },
  { value: 'style', label: 'style（样式）', short: 'style' },
  { value: 'inline-size', label: 'inline-size（行内尺寸）', short: 'inline-size' },
];

/** content-visibility 值及说明 */
const CV_VALUES: { value: ContentVisibility; label: string; short: string }[] = [
  { value: 'visible', label: 'visible（正常渲染）', short: 'visible' },
  { value: 'hidden', label: 'hidden（不渲染）', short: 'hidden' },
  { value: 'auto', label: 'auto（屏幕外跳过）', short: 'auto' },
];

/** 8 组预设，覆盖 contain 与 content-visibility 最常见应用场景 */
const PRESETS: ContainPreset[] = [
  {
    name: '默认（不隔离）',
    description: '不应用任何隔离，作为对照基准',
    config: {
      selector: '.item',
      contain: 'none',
      contentVisibility: 'visible',
      useIntrinsicSize: false,
      intrinsicWidth: 300,
      intrinsicHeight: 120,
      padding: 16,
      background: '#ffffff',
    },
  },
  {
    name: '布局隔离',
    description: 'contain: layout 隔离子树布局计算，子树布局变化不影响外部',
    config: {
      selector: '.card',
      contain: 'layout',
      contentVisibility: 'visible',
      useIntrinsicSize: false,
      intrinsicWidth: 300,
      intrinsicHeight: 120,
      padding: 16,
      background: '#f5f7fa',
    },
  },
  {
    name: '绘制隔离',
    description: 'contain: paint 隔离子树绘制，子树内容不会绘制到元素边界外',
    config: {
      selector: '.card',
      contain: 'paint',
      contentVisibility: 'visible',
      useIntrinsicSize: false,
      intrinsicWidth: 300,
      intrinsicHeight: 120,
      padding: 16,
      background: '#fff8f0',
    },
  },
  {
    name: '推荐组合（content）',
    description: 'contain: content 等价于 layout + paint + style，推荐用法，无尺寸副作用',
    config: {
      selector: '.card',
      contain: 'content',
      contentVisibility: 'visible',
      useIntrinsicSize: false,
      intrinsicWidth: 300,
      intrinsicHeight: 120,
      padding: 16,
      background: '#f0f9ff',
    },
  },
  {
    name: '长列表优化',
    description: 'content-visibility: auto 跳过屏幕外卡片渲染，配合 contain-intrinsic-size 提供占位尺寸',
    config: {
      selector: '.list-item',
      contain: 'content',
      contentVisibility: 'auto',
      useIntrinsicSize: true,
      intrinsicWidth: 320,
      intrinsicHeight: 140,
      padding: 16,
      background: '#ffffff',
    },
  },
  {
    name: '隐藏内容',
    description: 'content-visibility: hidden 不渲染但保留布局信息，切换回 visible 比 display:none 更快',
    config: {
      selector: '.panel',
      contain: 'content',
      contentVisibility: 'hidden',
      useIntrinsicSize: true,
      intrinsicWidth: 300,
      intrinsicHeight: 200,
      padding: 16,
      background: '#f5f5f5',
    },
  },
  {
    name: '卡片网格优化',
    description: 'contain: content + content-visibility: auto，卡片网格场景的综合性能优化',
    config: {
      selector: '.grid-card',
      contain: 'content',
      contentVisibility: 'auto',
      useIntrinsicSize: true,
      intrinsicWidth: 280,
      intrinsicHeight: 180,
      padding: 20,
      background: '#ffffff',
    },
  },
  {
    name: '行内尺寸隔离',
    description: 'contain: inline-size 隔离行内方向尺寸，适合横向滚动容器，子内容可按自身高度撑开',
    config: {
      selector: '.scroller-item',
      contain: 'inline-size',
      contentVisibility: 'visible',
      useIntrinsicSize: false,
      intrinsicWidth: 240,
      intrinsicHeight: 160,
      padding: 16,
      background: '#fdf4ff',
    },
  },
];

/** 默认配置 */
const DEFAULT_CONFIG: ContainConfig = PRESETS[4].config;

/** 预览卡片数量（用于演示长列表与 content-visibility: auto 的跳过渲染效果） */
const PREVIEW_CARD_COUNT = 12;

/** 预览卡片的示例文本 */
const CARD_TEXTS = [
  '第一张卡片：contain 属性让浏览器隔离元素的渲染，减少不必要的重排重绘。',
  '第二张卡片：content-visibility: auto 让浏览器自动跳过屏幕外内容的渲染。',
  '第三张卡片：contain-intrinsic-size 为跳过渲染的元素提供占位尺寸。',
  '第四张卡片：layout 隔离布局，子树布局变化不触发外部重排。',
  '第五张卡片：paint 隔离绘制，子树内容不会溢出到元素边界外。',
  '第六张卡片：style 隔离计数器与引号作用域，避免影响外部。',
  '第七张卡片：size 隔离尺寸，元素尺寸不受子内容影响，需显式指定高度。',
  '第八张卡片：content 组合等于 layout + paint + style，推荐用法。',
  '第九张卡片：strict 等于 size + layout + paint + style，全部隔离。',
  '第十张卡片：inline-size 仅隔离行内方向尺寸，适合横向滚动。',
  '第十一张卡片：hidden 不渲染但保留布局，切换比 display:none 更快。',
  '第十二张卡片：auto 是长列表与卡片网格性能优化的核心特性。',
];

/** 生成预览卡片样式（应用 contain 与 content-visibility 配置） */
function buildCardStyle(config: ContainConfig): React.CSSProperties {
  const style: React.CSSProperties = {
    padding: `${config.padding}px`,
    background: config.background,
    marginBottom: 12,
    borderRadius: 8,
    border: '1px solid rgba(0,0,0,0.08)',
  };
  if (config.contain !== 'none') {
    style.contain = config.contain;
  }
  if (config.contentVisibility !== 'visible') {
    style.contentVisibility = config.contentVisibility;
  }
  if (config.useIntrinsicSize) {
    style.containIntrinsicSize = `${config.intrinsicWidth}px ${config.intrinsicHeight}px`;
  }
  return style;
}

/** 生成完整 CSS 代码 */
function buildCss(config: ContainConfig): string {
  const lines: string[] = [`${config.selector} {`];
  if (config.contain !== 'none') {
    lines.push(`  contain: ${config.contain};`);
  }
  if (config.contentVisibility !== 'visible') {
    lines.push(`  content-visibility: ${config.contentVisibility};`);
  }
  if (config.useIntrinsicSize) {
    lines.push(
      `  contain-intrinsic-size: ${config.intrinsicWidth}px ${config.intrinsicHeight}px;`,
    );
  }
  // 若全部为默认值，给出说明注释
  if (
    config.contain === 'none' &&
    config.contentVisibility === 'visible' &&
    !config.useIntrinsicSize
  ) {
    return `/* 当前为默认配置，未应用任何性能隔离 */\n${config.selector} {\n  /* contain: content; 可隔离布局/绘制/样式 */\n  /* content-visibility: auto; 可跳过屏幕外渲染 */\n}`;
  }
  lines.push('}');
  return lines.join('\n');
}

/** 生成原理说明 */
function buildExplain(config: ContainConfig): string[] {
  const tips: string[] = [];

  // contain 说明
  const containMap: Record<ContainValue, string> = {
    none: 'contain: none —— 不应用任何隔离，元素及其子树正常参与全局布局与绘制。',
    strict:
      'contain: strict —— 等价于 size + layout + paint + style 全部隔离。隔离最强但要求元素显式指定尺寸，否则尺寸退化为 0，谨慎使用。',
    content:
      'contain: content —— 等价于 layout + paint + style 三项隔离，不含 size。这是推荐用法：既获得布局/绘制/样式隔离的性能收益，又无 size 的尺寸副作用。',
    size: 'contain: size —— 隔离元素尺寸，元素尺寸不再受子内容影响，必须显式指定高度，否则高度为 0。仅当能确定固定尺寸时使用。',
    layout:
      'contain: layout —— 隔离子树布局计算。子树内部布局变化不会触发外部元素重排，外部布局变化也不会影响子树。适合独立组件。',
    paint: 'contain: paint —— 隔离子树绘制。子树内容不会绘制到元素边界框之外，类似 overflow: clip 但作用于绘制阶段。能避免溢出重绘。',
    style: 'contain: style —— 隔离计数器与引号作用域。子树的 counter-reset/increment 和 quotes 不影响外部，避免计数器串扰。',
    'inline-size':
      'contain: inline-size —— 仅隔离行内方向尺寸（Level 2 新增）。子内容可按自身需求决定块向高度，适合横向滚动容器内的列表项。',
  };
  tips.push(containMap[config.contain]);

  // content-visibility 说明
  const cvMap: Record<ContentVisibility, string> = {
    visible: 'content-visibility: visible —— 正常渲染，元素及其子树全部参与渲染。',
    hidden:
      'content-visibility: hidden —— 元素不渲染（保留布局信息）。与 display: none 不同：hidden 保留渲染状态与布局信息，切换回 visible 时无需重新计算布局，适合频繁切换的隐藏面板。',
    auto: 'content-visibility: auto —— 屏幕外内容自动跳过渲染（仅保留布局占位）。当元素滚动进入视口时才渲染，离开时释放渲染资源。这是长列表与卡片网格性能优化的核心特性。',
  };
  tips.push(cvMap[config.contentVisibility]);

  // contain-intrinsic-size 说明
  if (config.useIntrinsicSize) {
    tips.push(
      `contain-intrinsic-size: ${config.intrinsicWidth}px ${config.intrinsicHeight}px —— 为跳过渲染的元素提供占位尺寸。content-visibility: auto/hidden 时浏览器不知道内容实际尺寸，此属性提供预估尺寸避免滚动条跳动。`,
    );
  }

  // 副作用提醒
  if (config.contain === 'size' || config.contain === 'strict') {
    tips.push(
      '⚠ 副作用提示：size/strict 隔离尺寸后，元素高度不再受子内容撑开。若未显式指定高度，元素高度会退化为 0，子内容不可见。仅在能确定固定尺寸时使用。',
    );
  }
  if (
    config.contentVisibility === 'auto' &&
    !config.useIntrinsicSize
  ) {
    tips.push(
      '⚠ 副作用提示：content-visibility: auto 未配合 contain-intrinsic-size 时，浏览器无法预知内容尺寸，滚动条可能跳动。建议启用 contain-intrinsic-size 提供预估尺寸。',
    );
  }

  return tips;
}

/** 单个预览卡片（含可见性标记） */
function PreviewCard({
  index,
  text,
  style,
  visible,
  cvMode,
}: {
  index: number;
  text: string;
  style: React.CSSProperties;
  visible: boolean;
  cvMode: ContentVisibility;
}) {
  // content-visibility: auto 且不可见时显示跳过渲染标记
  const showSkipped = cvMode === 'auto' && !visible;
  return (
    <div className="ctn__card" style={style} data-visible={visible}>
      <div className="ctn__card-head">
        <span className="ctn__card-no">#{index + 1}</span>
        <span className={`ctn__card-status ${visible ? 'is-on' : 'is-off'}`}>
          {cvMode === 'auto'
            ? visible
              ? '可见 · 已渲染'
              : '屏幕外 · 跳过渲染'
            : cvMode === 'hidden'
              ? '隐藏 · 不渲染'
              : '可见 · 已渲染'}
        </span>
      </div>
      {showSkipped ? (
        <div className="ctn__card-skipped">内容已跳过渲染（占位）</div>
      ) : (
        <p className="ctn__card-text">{text}</p>
      )}
    </div>
  );
}

/** 主组件 */
export default function ContainTool() {
  const [config, setConfig] = useState<ContainConfig>(DEFAULT_CONFIG);
  const [copied, setCopied] = useState(false);
  const [visibleSet, setVisibleSet] = useState<Set<number>>(new Set());
  const scrollerRef = useRef<HTMLDivElement>(null);

  const cssCode = useMemo(() => buildCss(config), [config]);
  const cardStyle = useMemo(() => buildCardStyle(config), [config]);
  const explainTips = useMemo(() => buildExplain(config), [config]);

  // IntersectionObserver 标记可见卡片，演示 content-visibility: auto 的工作原理
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const cards = Array.from(root.querySelectorAll<HTMLElement>('.ctn__card'));
    if (cards.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setVisibleSet((prev) => {
          const next = new Set(prev);
          for (const entry of entries) {
            const idx = Number(entry.target.getAttribute('data-idx'));
            if (entry.isIntersecting) next.add(idx);
            else next.delete(idx);
          }
          return next;
        });
      },
      { root, threshold: 0.01 },
    );
    cards.forEach((c) => observer.observe(c));
    return () => observer.disconnect();
  }, [config.contentVisibility, config.contain, config.useIntrinsicSize]);

  const applyPreset = useCallback((preset: ContainPreset) => {
    setConfig(preset.config);
    setCopied(false);
  }, []);

  const update = useCallback(<K extends keyof ContainConfig>(key: K, value: ContainConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setCopied(false);
  }, []);

  const handleCopy = useCallback(async () => {
    const ok = await copyText(cssCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [cssCode]);

  return (
    <div className="ctn">
      {/* 预设按钮组 */}
      <div className="ctn__presets" role="group" aria-label="预设效果">
        {PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            className="ctn__preset-btn"
            onClick={() => applyPreset(p)}
            title={p.description}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="ctn__layout">
        {/* 左栏：可滚动预览区 */}
        <div className="ctn__preview-col">
          <div className="ctn__preview-head">
            <span>可滚动预览（{PREVIEW_CARD_COUNT} 张卡片）</span>
            <span className="ctn__visible-count">
              可见：{visibleSet.size} / {PREVIEW_CARD_COUNT}
            </span>
          </div>
          <div className="ctn__scroller" ref={scrollerRef}>
            {Array.from({ length: PREVIEW_CARD_COUNT }).map((_, i) => (
              <div
                key={i}
                data-idx={i}
                className="ctn__card-wrap"
                style={cardStyle}
              >
                <PreviewCard
                  index={i}
                  text={CARD_TEXTS[i] ?? `第 ${i + 1} 张卡片`}
                  style={{ padding: 0, background: 'transparent', border: 'none', margin: 0 }}
                  visible={visibleSet.has(i)}
                  cvMode={config.contentVisibility}
                />
              </div>
            ))}
          </div>
          <p className="ctn__preview-hint">
            向上向下滚动预览区，观察 content-visibility: auto 模式下屏幕外卡片的"跳过渲染"状态变化。
          </p>
        </div>

        {/* 右栏：配置面板 + 原理说明 + 代码输出 */}
        <div className="ctn__config-col">
          {/* 选择器 */}
          <div className="ctn__panel">
            <label className="ctn__label">CSS 选择器</label>
            <input
              type="text"
              className="ctn__input"
              value={config.selector}
              onChange={(e) => update('selector', e.target.value)}
            />
          </div>

          {/* contain 值选择 */}
          <div className="ctn__panel">
            <label className="ctn__label">contain（渲染隔离）</label>
            <div className="ctn__seg-group" role="radiogroup" aria-label="contain 值">
              {CONTAIN_VALUES.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={config.contain === opt.value}
                  className={`ctn__seg ${config.contain === opt.value ? 'is-active' : ''}`}
                  onClick={() => update('contain', opt.value)}
                  title={opt.label}
                >
                  {opt.short}
                </button>
              ))}
            </div>
          </div>

          {/* content-visibility 值选择 */}
          <div className="ctn__panel">
            <label className="ctn__label">content-visibility（内容渲染控制）</label>
            <div className="ctn__seg-group" role="radiogroup" aria-label="content-visibility 值">
              {CV_VALUES.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={config.contentVisibility === opt.value}
                  className={`ctn__seg ${config.contentVisibility === opt.value ? 'is-active' : ''}`}
                  onClick={() => update('contentVisibility', opt.value)}
                  title={opt.label}
                >
                  {opt.short}
                </button>
              ))}
            </div>
          </div>

          {/* contain-intrinsic-size 配置 */}
          <div className="ctn__panel">
            <label className="ctn__label">
              <input
                type="checkbox"
                checked={config.useIntrinsicSize}
                onChange={(e) => update('useIntrinsicSize', e.target.checked)}
              />
              启用 contain-intrinsic-size（占位尺寸）
            </label>
            {config.useIntrinsicSize && (
              <div className="ctn__intrinsic">
                <div className="ctn__slider">
                  <span>宽度 {config.intrinsicWidth}px</span>
                  <input
                    type="range"
                    min={120}
                    max={480}
                    step={10}
                    value={config.intrinsicWidth}
                    onChange={(e) => update('intrinsicWidth', Number(e.target.value))}
                  />
                </div>
                <div className="ctn__slider">
                  <span>高度 {config.intrinsicHeight}px</span>
                  <input
                    type="range"
                    min={60}
                    max={320}
                    step={10}
                    value={config.intrinsicHeight}
                    onChange={(e) => update('intrinsicHeight', Number(e.target.value))}
                  />
                </div>
              </div>
            )}
          </div>

          {/* 预览视觉属性 */}
          <div className="ctn__panel">
            <label className="ctn__label">预览卡片样式</label>
            <div className="ctn__slider">
              <span>内边距 {config.padding}px</span>
              <input
                type="range"
                min={0}
                max={40}
                step={2}
                value={config.padding}
                onChange={(e) => update('padding', Number(e.target.value))}
              />
            </div>
            <div className="ctn__color-row">
              <label>
                背景色
                <input
                  type="color"
                  value={config.background}
                  onChange={(e) => update('background', e.target.value)}
                />
              </label>
            </div>
          </div>

          {/* 原理说明 */}
          <div className="ctn__panel ctn__explain">
            <label className="ctn__label">原理说明</label>
            {explainTips.map((tip, i) => (
              <p key={i} className="ctn__tip">
                {tip}
              </p>
            ))}
          </div>

          {/* 代码输出 */}
          <div className="ctn__panel">
            <div className="ctn__code-head">
              <span className="ctn__label">生成的 CSS</span>
              <button type="button" className="ctn__copy" onClick={handleCopy}>
                {copied ? '已复制' : '复制'}
              </button>
            </div>
            <pre className="ctn__code">
              <code>{cssCode}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
