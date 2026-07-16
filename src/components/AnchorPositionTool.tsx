import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS 锚点定位（anchor-positioning）生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 锚点声明（anchor-name）与引用（position-anchor）
 *  - anchor() 函数构造：top/bottom/left/right/center/start/end + 可选偏移
 *  - anchor-size() 函数构造：width/height/block/inline + 可选偏移
 *  - position-try-fallbacks 翻转策略（flip-block / flip-inline / flip-start）
 *  - iframe srcdoc 沙箱预览（锚点 + 定位元素真实关系可视化）
 *  - 原理说明面板解析当前定位逻辑
 *  - 8 组预设覆盖 tooltip / popover / dropdown 等场景
 *  - 智能代码生成，一键复制
 */

/** anchor() 函数支持的边/中心关键字 */
type AnchorSide =
  | 'top' | 'bottom' | 'left' | 'right'
  | 'center' | 'start' | 'end';

/** anchor-size() 函数支持的尺寸关键字 */
type AnchorSize = 'width' | 'height' | 'block' | 'inline';

/** position-try-fallbacks 翻转策略选项 */
type TryFallback =
  | 'flip-block' | 'flip-inline' | 'flip-start' | 'flip-end';

/** 单条定位声明：属性 + 是否使用 anchor() + 边/尺寸 + 偏移 */
interface PositionDecl {
  id: string;
  /** CSS 定位属性，如 top / left / right / bottom / width / height */
  property: string;
  /** 是否使用 anchor() 或 anchor-size() 引用锚点；false 时使用固定值 */
  useAnchor: boolean;
  /** anchor() 边或 anchor-size() 尺寸，仅 useAnchor=true 时有效 */
  side: AnchorSide;
  /** 尺寸关键字，仅 property 为 width/height 时使用 anchor-size() */
  size: AnchorSize;
  /** 偏移量（px），可为负数；anchor() / anchor-size() 第二参数，或固定值 */
  offset: number;
  /** 固定值，仅 useAnchor=false 时有效 */
  fixedValue: string;
}

/** 完整锚点定位配置 */
interface AnchorPositionConfig {
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
  /** 定位声明列表（top/left/right/bottom/width/height 等） */
  decls: PositionDecl[];
  /** 翻转策略列表（position-try-fallbacks） */
  tryFallbacks: TryFallback[];
}

/** 预设 */
interface AnchorPositionPreset {
  name: string;
  description: string;
  config: AnchorPositionConfig;
}

// 模块级 id 生成器，保证删除中间项时 React key 稳定，避免焦点错位
let _idCounter = 0;
const genId = (): string =>
  `ap_${Date.now().toString(36)}_${(++_idCounter).toString(36)}`;

// 工厂函数：默认定位声明
const makeDecl = (overrides: Partial<PositionDecl> = {}): PositionDecl => ({
  id: genId(),
  property: 'top',
  useAnchor: true,
  side: 'bottom',
  size: 'width',
  offset: 8,
  fixedValue: '0',
  ...overrides,
});

const ANCHOR_SIDES: AnchorSide[] = ['top', 'bottom', 'left', 'right', 'center', 'start', 'end'];
const ANCHOR_SIZES: AnchorSize[] = ['width', 'height', 'block', 'inline'];
const TRY_FALLBACKS: TryFallback[] = ['flip-block', 'flip-inline', 'flip-start', 'flip-end'];

// 定位属性与是否为尺寸属性（决定用 anchor-size() 还是 anchor()）
const POSITION_PROPERTIES = [
  'top', 'bottom', 'left', 'right',
  'inset-block-start', 'inset-block-end',
  'inset-inline-start', 'inset-inline-end',
  'width', 'height',
  'block-size', 'inline-size',
];

/** 判断属性是否为尺寸属性（用 anchor-size() 而非 anchor()） */
function isSizeProperty(prop: string): boolean {
  return ['width', 'height', 'block-size', 'inline-size'].includes(prop);
}

/** 生成 anchor() 或 anchor-size() 函数值 */
function buildAnchorValue(decl: PositionDecl): string {
  // 尺寸属性用 anchor-size()，定位属性用 anchor()
  if (isSizeProperty(decl.property)) {
    // anchor-size(width) 或 anchor-size(width, 10px)
    return decl.offset !== 0
      ? `anchor-size(${decl.size}, ${decl.offset}px)`
      : `anchor-size(${decl.size})`;
  }
  // anchor(bottom) 或 anchor(bottom, 8px)
  return decl.offset !== 0
    ? `anchor(${decl.side}, ${decl.offset}px)`
    : `anchor(${decl.side})`;
}

/** 生成单条定位声明的 CSS 值 */
function buildDeclValue(decl: PositionDecl): string {
  if (decl.useAnchor) return buildAnchorValue(decl);
  // 固定值优先用 offset（若为数字型），否则用 fixedValue 字符串
  if (decl.fixedValue) return decl.fixedValue;
  return `${decl.offset}px`;
}

/** 生成完整 CSS 代码 */
function buildCss(config: AnchorPositionConfig): string {
  const lines: string[] = [];
  const validDecls = config.decls.filter(d => d.property);

  // 锚点元素：声明 anchor-name
  lines.push(`/* 锚点元素 */`);
  lines.push(`${config.anchorSelector} {`);
  lines.push(`  anchor-name: ${config.anchorName};`);
  lines.push(`}`);

  // 定位元素：position + position-anchor + 各方向定位
  lines.push('');
  lines.push(`/* 定位元素（相对锚点定位） */`);
  lines.push(`${config.targetSelector} {`);
  lines.push(`  position: ${config.position};`);
  if (config.usePositionAnchor) {
    lines.push(`  position-anchor: ${config.anchorName};`);
  }
  validDecls.forEach(d => {
    lines.push(`  ${d.property}: ${buildDeclValue(d)};`);
  });
  // 翻转策略：避免定位元素溢出视口
  if (config.tryFallbacks.length > 0) {
    lines.push(`  position-try-fallbacks: ${config.tryFallbacks.join(', ')};`);
  }
  lines.push(`}`);

  return lines.join('\n');
}

/** 生成 iframe 预览 HTML（沙箱内真实渲染锚点与定位元素关系） */
function buildPreviewHtml(config: AnchorPositionConfig): string {
  const css = buildCss(config);
  // 从选择器提取首个类名或 id，附加到 demo 元素，使生成的 CSS（anchor-name / position-anchor / anchor()）实际作用于预览节点
  // 否则用户选择器（如 .anchor）与 demo 元素类名（anchor-demo）不匹配，预览无法体现定位效果
  const anchorCls = config.anchorSelector.match(/^\.([\w-]+)/)?.[1] || '';
  const anchorId = config.anchorSelector.match(/^#([\w-]+)/)?.[1] || '';
  const targetCls = config.targetSelector.match(/^\.([\w-]+)/)?.[1] || '';
  const targetId = config.targetSelector.match(/^#([\w-]+)/)?.[1] || '';
  const anchorClassAttr = `anchor-demo${anchorCls ? ` ${anchorCls}` : ''}`;
  const anchorIdAttr = anchorId ? ` id="${anchorId}"` : '';
  const targetClassAttr = `target-demo${targetCls ? ` ${targetCls}` : ''}`;
  const targetIdAttr = targetId ? ` id="${targetId}"` : '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { min-height: 100%; padding: 80px 40px; font-family: system-ui, -apple-system, "PingFang SC", sans-serif; background: #f5f5f7; }
  .stage { position: relative; min-height: 360px; display: flex; align-items: center; justify-content: center; background: repeating-linear-gradient(45deg, #fff, #fff 10px, #f0f0f3 10px, #f0f0f3 20px); border-radius: 8px; border: 1px dashed #d0d0d8; }
  .anchor-demo { padding: 10px 18px; background: #3b82f6; color: #fff; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; }
  .target-demo { padding: 8px 12px; background: #1f2937; color: #fff; border-radius: 6px; font-size: 13px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); max-width: 240px; }
  ${css}
</style>
</head>
<body>
  <div class="stage">
    <button class="${anchorClassAttr}"${anchorIdAttr} type="button">锚点按钮</button>
    <div class="${targetClassAttr}"${targetIdAttr}>定位元素（tooltip / popover）</div>
  </div>
</body>
</html>`;
}

/** 生成原理说明 */
function buildExplain(config: AnchorPositionConfig): string[] {
  const tips: string[] = [];
  const validDecls = config.decls.filter(d => d.property);

  tips.push(`锚点元素 ${config.anchorSelector} 通过 anchor-name: ${config.anchorName} 声明为锚点，定位元素 ${config.targetSelector} 通过 position-anchor: ${config.anchorName} 引用该锚点，建立"锚点-目标"绑定关系。`);

  if (validDecls.length === 0) {
    tips.push('当前未配置任何定位声明，定位元素将停留在静态文档流位置。');
    return tips;
  }

  validDecls.forEach(d => {
    if (d.useAnchor) {
      if (isSizeProperty(d.property)) {
        const offsetDesc = d.offset !== 0 ? `，并在其基础上偏移 ${d.offset}px` : '';
        tips.push(`${d.property}: anchor-size(${d.size}) 表示该属性的值等于锚点的 ${d.size} 尺寸${offsetDesc}。常用于让定位元素宽度跟随锚点宽度。`);
      } else {
        const offsetDesc = d.offset !== 0 ? `，并偏移 ${d.offset}px` : '';
        tips.push(`${d.property}: anchor(${d.side}) 表示该属性的值等于锚点的 ${d.side} 边位置${offsetDesc}。这是锚点定位的核心——用锚点边代替固定坐标。`);
      }
    } else {
      tips.push(`${d.property}: ${buildDeclValue(d)} 使用固定值，不引用锚点。`);
    }
  });

  if (config.tryFallbacks.length > 0) {
    const flipMap: Record<TryFallback, string> = {
      'flip-block': '垂直翻转（上下方向翻转）',
      'flip-inline': '水平翻转（左右方向翻转）',
      'flip-start': '翻转对角线起始方向',
      'flip-end': '翻转对角线结束方向',
    };
    const desc = config.tryFallbacks.map(f => flipMap[f]).join('、');
    tips.push(`position-try-fallbacks: ${config.tryFallbacks.join(', ')} 启用翻转避让：当定位元素在默认方向溢出视口时，浏览器自动尝试 ${desc}，找到不溢出的位置。这是锚点定位的"自动避让"能力，无需 JS 检测视口边界。`);
  } else {
    tips.push('未启用翻转策略，定位元素在默认方向溢出视口时会被裁剪。建议为 tooltip / dropdown 场景启用 flip-block 或 flip-inline。');
  }

  return tips;
}

/** 8 组预设 */
const PRESETS: AnchorPositionPreset[] = [
  {
    name: '下方 Tooltip',
    description: '定位元素出现在锚点下方 8px，左对齐锚点（典型 tooltip）',
    config: {
      anchorSelector: '.anchor',
      anchorName: '--my-anchor',
      targetSelector: '.tooltip',
      usePositionAnchor: true,
      position: 'absolute',
      decls: [
        makeDecl({ property: 'top', side: 'bottom', offset: 8 }),
        makeDecl({ property: 'left', side: 'left', offset: 0 }),
      ],
      tryFallbacks: ['flip-block'],
    },
  },
  {
    name: '上方 Tooltip',
    description: '定位元素出现在锚点上方 8px，左对齐锚点',
    config: {
      anchorSelector: '.anchor',
      anchorName: '--my-anchor',
      targetSelector: '.tooltip',
      usePositionAnchor: true,
      position: 'absolute',
      decls: [
        makeDecl({ property: 'bottom', side: 'top', offset: 8 }),
        makeDecl({ property: 'left', side: 'left', offset: 0 }),
      ],
      tryFallbacks: ['flip-block'],
    },
  },
  {
    name: '右侧 Dropdown',
    description: '下拉菜单出现在锚点右侧 4px，顶部对齐（菜单/侧栏）',
    config: {
      anchorSelector: '.anchor',
      anchorName: '--my-anchor',
      targetSelector: '.menu',
      usePositionAnchor: true,
      position: 'absolute',
      decls: [
        makeDecl({ property: 'top', side: 'top', offset: 0 }),
        makeDecl({ property: 'left', side: 'right', offset: 4 }),
      ],
      tryFallbacks: ['flip-inline'],
    },
  },
  {
    name: '居中弹层',
    description: '定位元素水平居中于锚点，出现在下方 8px（居中提示）',
    config: {
      anchorSelector: '.anchor',
      anchorName: '--my-anchor',
      targetSelector: '.popover',
      usePositionAnchor: true,
      position: 'absolute',
      decls: [
        makeDecl({ property: 'top', side: 'bottom', offset: 8 }),
        // justify-self: anchor-center 是另一种居中方式，这里用 left + translate
        makeDecl({ property: 'left', side: 'center', offset: 0 }),
      ],
      tryFallbacks: [],
    },
  },
  {
    name: '跟随锚点宽度',
    description: '定位元素宽度等于锚点宽度（dropdown 宽度匹配触发按钮）',
    config: {
      anchorSelector: '.anchor',
      anchorName: '--my-anchor',
      targetSelector: '.menu',
      usePositionAnchor: true,
      position: 'absolute',
      decls: [
        makeDecl({ property: 'top', side: 'bottom', offset: 4 }),
        makeDecl({ property: 'left', side: 'left', offset: 0 }),
        makeDecl({ property: 'width', size: 'width', offset: 0 }),
      ],
      tryFallbacks: ['flip-block'],
    },
  },
  {
    name: '双向翻转避让',
    description: '同时启用垂直与水平翻转，避免 tooltip 溢出视口四边',
    config: {
      anchorSelector: '.anchor',
      anchorName: '--my-anchor',
      targetSelector: '.tooltip',
      usePositionAnchor: true,
      position: 'absolute',
      decls: [
        makeDecl({ property: 'top', side: 'bottom', offset: 8 }),
        makeDecl({ property: 'left', side: 'left', offset: 0 }),
      ],
      tryFallbacks: ['flip-block', 'flip-inline'],
    },
  },
  {
    name: '左侧气泡',
    description: '定位元素出现在锚点左侧 8px，垂直居中（侧边提示）',
    config: {
      anchorSelector: '.anchor',
      anchorName: '--my-anchor',
      targetSelector: '.bubble',
      usePositionAnchor: true,
      position: 'absolute',
      decls: [
        makeDecl({ property: 'top', side: 'center', offset: 0 }),
        makeDecl({ property: 'right', side: 'left', offset: 8 }),
      ],
      tryFallbacks: ['flip-inline'],
    },
  },
  {
    name: '默认示例',
    description: '最小配置：仅声明锚点与引用，无定位声明（对比基线）',
    config: {
      anchorSelector: '.anchor',
      anchorName: '--my-anchor',
      targetSelector: '.target',
      usePositionAnchor: true,
      position: 'absolute',
      decls: [],
      tryFallbacks: [],
    },
  },
];

/** 默认配置 */
const DEFAULT_CONFIG: AnchorPositionConfig = PRESETS[0].config;

/** 分段按钮组（泛型复用） */
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
    <div className="ap-field">
      <span className="ap-field-label">{label}</span>
      <div className="ap-seg-group">
        {options.map(opt => (
          <button
            key={opt}
            type="button"
            className={`ap-seg-btn ${value === opt ? 'is-active' : ''}`}
            onClick={() => onChange(opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function AnchorPositionTool() {
  const [config, setConfig] = useState<AnchorPositionConfig>(DEFAULT_CONFIG);
  const [copied, setCopied] = useState(false);

  const cssCode = useMemo(() => buildCss(config), [config]);
  const previewHtml = useMemo(() => buildPreviewHtml(config), [config]);
  const explains = useMemo(() => buildExplain(config), [config]);

  const handleCopy = useCallback(async () => {
    const ok = await copyText(cssCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [cssCode]);

  // 不可变状态更新：定位声明列表的增删改
  const updateDecl = (id: string, patch: Partial<PositionDecl>) => {
    setConfig(c => ({ ...c, decls: c.decls.map(d => (d.id === id ? { ...d, ...patch } : d)) }));
  };
  const addDecl = () => {
    setConfig(c => ({ ...c, decls: [...c.decls, makeDecl()] }));
  };
  const removeDecl = (id: string) => {
    setConfig(c => ({ ...c, decls: c.decls.filter(d => d.id !== id) }));
  };

  const toggleFallback = (fb: TryFallback) => {
    setConfig(c => ({
      ...c,
      tryFallbacks: c.tryFallbacks.includes(fb)
        ? c.tryFallbacks.filter(f => f !== fb)
        : [...c.tryFallbacks, fb],
    }));
  };

  const applyPreset = (preset: AnchorPositionPreset) => {
    // 深拷贝并重新生成 id，保证 React key 唯一
    setConfig({
      ...preset.config,
      decls: preset.config.decls.map(d => ({ ...d, id: genId() })),
    });
  };

  return (
    <div className="ap-tool">
      {/* 预设按钮组 */}
      <div className="ap-presets">
        <span className="ap-presets-label">预设：</span>
        <div className="ap-preset-list">
          {PRESETS.map(p => (
            <button
              key={p.name}
              type="button"
              className="ap-preset-btn"
              title={p.description}
              onClick={() => applyPreset(p)}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className="ap-main">
        {/* 左栏：配置面板 */}
        <div className="ap-config">
          <fieldset className="ap-fieldset">
            <legend>锚点元素</legend>
            <div className="ap-field">
              <label className="ap-field-label">锚点选择器</label>
              <input
                type="text"
                className="ap-input"
                value={config.anchorSelector}
                onChange={e => setConfig(c => ({ ...c, anchorSelector: e.target.value }))}
              />
            </div>
            <div className="ap-field">
              <label className="ap-field-label">anchor-name（锚点名称）</label>
              <input
                type="text"
                className="ap-input"
                value={config.anchorName}
                onChange={e => setConfig(c => ({ ...c, anchorName: e.target.value }))}
              />
            </div>
          </fieldset>

          <fieldset className="ap-fieldset">
            <legend>定位元素</legend>
            <div className="ap-field">
              <label className="ap-field-label">定位元素选择器</label>
              <input
                type="text"
                className="ap-input"
                value={config.targetSelector}
                onChange={e => setConfig(c => ({ ...c, targetSelector: e.target.value }))}
              />
            </div>
            <SegGroup
              label="position（定位方式）"
              value={config.position}
              options={['absolute', 'fixed'] as const}
              onChange={v => setConfig(c => ({ ...c, position: v }))}
            />
            <div className="ap-field">
              <label className="ap-checkbox">
                <input
                  type="checkbox"
                  checked={config.usePositionAnchor}
                  onChange={e => setConfig(c => ({ ...c, usePositionAnchor: e.target.checked }))}
                />
                <span>启用 position-anchor: {config.anchorName}</span>
              </label>
            </div>
          </fieldset>

          <fieldset className="ap-fieldset">
            <legend>定位声明（anchor() / anchor-size()）</legend>
            {config.decls.map(decl => {
              const isSize = isSizeProperty(decl.property);
              return (
                <div key={decl.id} className="ap-decl">
                  <select
                    className="ap-select ap-decl-prop"
                    value={decl.property}
                    onChange={e => updateDecl(decl.id, { property: e.target.value })}
                  >
                    {POSITION_PROPERTIES.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                  <label className="ap-checkbox ap-decl-anchor">
                    <input
                      type="checkbox"
                      checked={decl.useAnchor}
                      onChange={e => updateDecl(decl.id, { useAnchor: e.target.checked })}
                    />
                    <span>引用锚点</span>
                  </label>
                  {decl.useAnchor ? (
                    isSize ? (
                      <select
                        className="ap-select"
                        value={decl.size}
                        onChange={e => updateDecl(decl.id, { size: e.target.value as AnchorSize })}
                      >
                        {ANCHOR_SIZES.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    ) : (
                      <select
                        className="ap-select"
                        value={decl.side}
                        onChange={e => updateDecl(decl.id, { side: e.target.value as AnchorSide })}
                      >
                        {ANCHOR_SIDES.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    )
                  ) : (
                    <input
                      type="text"
                      className="ap-input ap-decl-fixed"
                      placeholder="固定值，如 100px / 50%"
                      value={decl.fixedValue}
                      onChange={e => updateDecl(decl.id, { fixedValue: e.target.value })}
                    />
                  )}
                  <input
                    type="number"
                    className="ap-input ap-decl-offset"
                    value={decl.offset}
                    onChange={e => updateDecl(decl.id, { offset: Number(e.target.value) })}
                    title="偏移量（px），可为负数"
                  />
                  <button
                    type="button"
                    className="ap-remove-btn"
                    onClick={() => removeDecl(decl.id)}
                    aria-label="删除该定位声明"
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <button type="button" className="ap-add-btn" onClick={addDecl}>
              + 新增定位声明
            </button>
          </fieldset>

          <fieldset className="ap-fieldset">
            <legend>翻转策略（position-try-fallbacks）</legend>
            <div className="ap-fallbacks">
              {TRY_FALLBACKS.map(fb => (
                <label key={fb} className="ap-checkbox">
                  <input
                    type="checkbox"
                    checked={config.tryFallbacks.includes(fb)}
                    onChange={() => toggleFallback(fb)}
                  />
                  <span>{fb}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        {/* 右栏：预览 + 原理说明 + 代码 */}
        <div className="ap-output">
          <div className="ap-section">
            <h3 className="ap-section-title">实时预览</h3>
            <iframe
              className="ap-preview"
              srcDoc={previewHtml}
              title="锚点定位预览"
              sandbox="allow-same-origin"
            />
          </div>

          <div className="ap-section">
            <h3 className="ap-section-title">原理说明</h3>
            <ul className="ap-explain">
              {explains.map((tip, i) => (
                <li key={i}>{tip}</li>
              ))}
            </ul>
          </div>

          <div className="ap-section">
            <div className="ap-code-header">
              <h3 className="ap-section-title">CSS 代码</h3>
              <button
                type="button"
                className={`ap-copy-btn ${copied ? 'is-copied' : ''}`}
                onClick={handleCopy}
              >
                {copied ? '已复制' : '复制代码'}
              </button>
            </div>
            <pre className="ap-code">
              <code>{cssCode}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
