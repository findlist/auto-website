import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS @layer 层叠层生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 多层管理：增删 / 重命名 / 上下调整层顺序（顺序决定优先级，后者更高）
 *  - 每层可包含多条规则（选择器 + 多条声明，支持 !important）
 *  - 未分层样式区（优先级高于所有分层样式）
 *  - 级联胜出分析：按目标选择器计算每个属性的最终胜出声明与原因
 *  - 完整实现 @layer 级联算法：普通声明（未分层 > 后层 > 前层）与 !important 反转（前层 > 后层 > 未分层）
 *  - iframe 隔离预览，实时应用生成的层叠 CSS
 *  - 8 组预设覆盖经典四层、第三方库隔离、主题覆盖、未分层最高、!important 反转等场景
 */

/** 单条 CSS 声明：property: value [!important] */
interface LayerDecl {
  id: string;
  property: string;
  value: string;
  important: boolean;
}

/** 层内规则：选择器 + 声明列表 */
interface LayerRule {
  id: string;
  selector: string;
  declarations: LayerDecl[];
}

/** 一个层叠层：名称 + 规则列表（名称为空表示匿名层） */
interface CssLayer {
  id: string;
  name: string;
  rules: LayerRule[];
}

/** 未分层的规则 */
interface UnlayeredRule {
  id: string;
  selector: string;
  declarations: LayerDecl[];
}

/** 完整层叠配置：层列表（顺序即优先级，后者更高）+ 未分层规则 */
interface LayerConfig {
  layers: CssLayer[];
  unlayered: UnlayeredRule[];
}

/** 预设：配置 + 预览 HTML + 分析目标选择器 */
interface LayerPreset {
  name: string;
  config: LayerConfig;
  previewHtml: string;
  target: string;
}

// 模块级 id 生成器，保证 React key 稳定唯一（避免数组索引 key 导致删除中间项时焦点错位）
let _idCounter = 0;
const genId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${(++_idCounter).toString(36)}`;

/** 创建一条声明 */
const makeDecl = (property: string, value: string, important = false): LayerDecl => ({
  id: genId('decl'),
  property,
  value,
  important,
});

/** 创建一条规则 */
const makeRule = (selector: string, declarations: LayerDecl[] = []): LayerRule => ({
  id: genId('rule'),
  selector,
  declarations,
});

/** 创建一个层 */
const makeLayer = (name: string, rules: LayerRule[] = []): CssLayer => ({
  id: genId('layer'),
  name,
  rules,
});

// 8 组预设，覆盖 @layer 最常见应用场景
const PRESETS: LayerPreset[] = [
  {
    name: '经典四层',
    target: '.box',
    previewHtml: `<div class="box">经典四层：utilities 层的 padding 胜出</div>`,
    config: {
      layers: [
        makeLayer('reset', [makeRule('.box', [makeDecl('margin', '0'), makeDecl('padding', '0')])]),
        makeLayer('base', [makeRule('.box', [makeDecl('display', 'block'), makeDecl('color', '#374151')])]),
        makeLayer('components', [
          makeRule('.box', [makeDecl('padding', '16px'), makeDecl('background', '#f3f4f6'), makeDecl('border-radius', '8px')]),
        ]),
        makeLayer('utilities', [makeRule('.box', [makeDecl('padding', '24px')])]),
      ],
      unlayered: [],
    },
  },
  {
    name: '第三方库隔离',
    target: '.box',
    previewHtml: `<div class="box">把第三方库样式装入低优先级层，自定义样式轻松覆盖</div>`,
    config: {
      layers: [
        makeLayer('library', [
          makeRule('.box', [makeDecl('padding', '12px'), makeDecl('background', '#fde68a'), makeDecl('border', '1px solid #f59e0b')]),
        ]),
        makeLayer('base', [makeRule('.box', [makeDecl('font-size', '15px')])]),
        makeLayer('components', [
          makeRule('.box', [makeDecl('padding', '20px'), makeDecl('background', '#dbeafe'), makeDecl('border-radius', '10px')]),
        ]),
      ],
      unlayered: [],
    },
  },
  {
    name: '主题覆盖',
    target: '.box',
    previewHtml: `<div class="box">主题层在后，覆盖组件层默认色</div>`,
    config: {
      layers: [
        makeLayer('components', [
          makeRule('.box', [makeDecl('padding', '16px'), makeDecl('background', '#ffffff'), makeDecl('color', '#111827'), makeDecl('border-radius', '8px')]),
        ]),
        makeLayer('theme', [makeRule('.box', [makeDecl('background', '#0f172a'), makeDecl('color', '#f8fafc')])]),
      ],
      unlayered: [],
    },
  },
  {
    name: '未分层最高',
    target: '.box',
    previewHtml: `<div class="box">未分层的 border 胜过所有层（即使层在后）</div>`,
    config: {
      layers: [
        makeLayer('base', [makeRule('.box', [makeDecl('padding', '16px'), makeDecl('background', '#e0e7ff')])]),
        makeLayer('components', [makeRule('.box', [makeDecl('padding', '24px'), makeDecl('border', '2px dashed #6366f1')])]),
      ],
      unlayered: [makeRule('.box', [makeDecl('border', '4px solid #dc2626')])],
    },
  },
  {
    name: '!important 反转',
    target: '.box',
    previewHtml: `<div class="box">前层 base 的 !important 胜过后层 utilities 的 !important</div>`,
    config: {
      layers: [
        makeLayer('base', [makeRule('.box', [makeDecl('padding', '8px', true)])]),
        makeLayer('components', [makeRule('.box', [makeDecl('padding', '16px', true)])]),
        makeLayer('utilities', [makeRule('.box', [makeDecl('padding', '32px', true)])]),
      ],
      unlayered: [],
    },
  },
  {
    name: '工具类优先',
    target: '.box',
    previewHtml: `<div class="box">utilities 层的工具类覆盖 components 的默认 padding</div>`,
    config: {
      layers: [
        makeLayer('components', [
          makeRule('.box', [makeDecl('padding', '16px'), makeDecl('background', '#fee2e2'), makeDecl('border-radius', '6px')]),
        ]),
        makeLayer('utilities', [makeRule('.box', [makeDecl('padding', '40px')])]),
      ],
      unlayered: [],
    },
  },
  {
    name: '框架嵌套层',
    target: '.box',
    previewHtml: `<div class="box">framework.components 嵌套层示例（点语法命名）</div>`,
    config: {
      layers: [
        makeLayer('framework.reset', [makeRule('.box', [makeDecl('margin', '0'), makeDecl('padding', '0')])]),
        makeLayer('framework.components', [
          makeRule('.box', [makeDecl('padding', '18px'), makeDecl('background', '#ecfdf5'), makeDecl('border-radius', '8px')]),
        ]),
      ],
      unlayered: [],
    },
  },
  {
    name: '默认示例',
    target: '.box',
    previewHtml: `<div class="box">两层 + 未分层：观察级联胜出分析</div>`,
    config: {
      layers: [
        makeLayer('base', [makeRule('.box', [makeDecl('padding', '16px'), makeDecl('background', '#f1f5f9')])]),
        makeLayer('theme', [makeRule('.box', [makeDecl('background', '#bae6fd'), makeDecl('color', '#075985')])]),
      ],
      unlayered: [makeRule('.box', [makeDecl('border-radius', '12px')])],
    },
  },
];

/** 默认配置（与"默认示例"预设一致） */
const DEFAULT_INDEX = PRESETS.length - 1;
const DEFAULT_CONFIG: LayerConfig = PRESETS[DEFAULT_INDEX].config;
const DEFAULT_HTML: string = PRESETS[DEFAULT_INDEX].previewHtml;
const DEFAULT_TARGET: string = PRESETS[DEFAULT_INDEX].target;

/**
 * 生成层声明语句：@layer name1, name2, ...;
 * 仅在存在具名层时输出（匿名层不出现在声明语句中）
 */
function buildLayerStatement(config: LayerConfig): string {
  const named = config.layers.filter((l) => l.name.trim());
  if (named.length === 0) return '';
  return `@layer ${named.map((l) => l.name.trim()).join(', ')};`;
}

/** 生成单个层的规则块文本 */
function buildLayerBlock(layer: CssLayer): string[] {
  const lines: string[] = [];
  const head = layer.name.trim() ? `@layer ${layer.name.trim()} {` : `@layer {`;
  lines.push(head);
  layer.rules.forEach((rule, idx) => {
    if (idx > 0) lines.push('');
    lines.push(`  ${rule.selector} {`);
    rule.declarations.forEach((d) => {
      if (d.property.trim() && d.value.trim()) {
        lines.push(`    ${d.property}: ${d.value}${d.important ? ' !important' : ''};`);
      }
    });
    lines.push('  }');
  });
  lines.push('}');
  return lines;
}

/** 生成未分层规则文本 */
function buildUnlayeredBlock(unlayered: UnlayeredRule[]): string[] {
  const lines: string[] = [];
  if (unlayered.length === 0) return lines;
  lines.push('/* 未分层样式：优先级高于所有 @layer 层 */');
  unlayered.forEach((rule, idx) => {
    if (idx > 0) lines.push('');
    lines.push(`${rule.selector} {`);
    rule.declarations.forEach((d) => {
      if (d.property.trim() && d.value.trim()) {
        lines.push(`  ${d.property}: ${d.value}${d.important ? ' !important' : ''};`);
      }
    });
    lines.push('}');
  });
  return lines;
}

/** 生成完整的层叠 CSS 文本 */
function buildLayeredCss(config: LayerConfig): string {
  const parts: string[] = [];
  const statement = buildLayerStatement(config);
  if (statement) {
    parts.push(`/* 层声明：定义层叠顺序，后者优先级更高 */\n${statement}`);
  }
  config.layers.forEach((layer) => {
    parts.push(buildLayerBlock(layer).join('\n'));
  });
  const unlayered = buildUnlayeredBlock(config.unlayered);
  if (unlayered.length > 0) parts.push(unlayered.join('\n'));
  return parts.join('\n\n');
}

/** 级联候选声明：带优先级元信息 */
interface Candidate {
  property: string;
  value: string;
  important: boolean;
  /** 来源描述：层名 或 "未分层" */
  source: string;
  /** 层索引（未分层为 -1） */
  layerIndex: number;
  /** 全局源顺序（用于同层同优先级的 tiebreaker） */
  order: number;
  /** 优先级分数（越高越胜出） */
  score: number;
}

/**
 * 计算级联优先级分数（越高越胜出）
 * 普通声明：未分层 > 后层 > 前层
 * !important：前层 > 后层 > 未分层（顺序反转）
 */
function priorityScore(important: boolean, layerIndex: number, numLayers: number): number {
  // important 整体高于 normal
  const base = important ? 1_000_000 : 0;
  if (important) {
    if (layerIndex === -1) return base - 1; // 未分层 !important 最低
    // 前层（layerIndex 小）分数更高 → 用 (numLayers - layerIndex)
    return base + (numLayers - layerIndex);
  }
  // 普通声明
  if (layerIndex === -1) return base + numLayers + 1; // 未分层最高
  return base + layerIndex; // 后层更高
}

/**
 * 级联胜出分析：按目标选择器收集所有匹配声明，按属性分组并标记胜出者
 * @param config 层叠配置
 * @param target 目标选择器（如 .box）
 */
function analyzeCascade(
  config: LayerConfig,
  target: string,
): { property: string; winner: Candidate | null; candidates: Candidate[] }[] {
  const t = target.trim();
  const numLayers = config.layers.length;
  const candidates: Candidate[] = [];
  let order = 0;

  // 收集分层声明
  config.layers.forEach((layer, layerIndex) => {
    layer.rules.forEach((rule) => {
      if (rule.selector.trim() !== t) return;
      rule.declarations.forEach((d) => {
        if (!d.property.trim() || !d.value.trim()) return;
        candidates.push({
          property: d.property.trim(),
          value: d.value.trim(),
          important: d.important,
          source: layer.name.trim() ? `@layer ${layer.name.trim()}` : '@layer（匿名）',
          layerIndex,
          order: order++,
          score: priorityScore(d.important, layerIndex, numLayers),
        });
      });
    });
  });
  // 收集未分层声明
  config.unlayered.forEach((rule) => {
    if (rule.selector.trim() !== t) return;
    rule.declarations.forEach((d) => {
      if (!d.property.trim() || !d.value.trim()) return;
      candidates.push({
        property: d.property.trim(),
        value: d.value.trim(),
        important: d.important,
        source: '未分层',
        layerIndex: -1,
        order: order++,
        score: priorityScore(d.important, -1, numLayers),
      });
    });
  });

  // 按属性分组，每组按分数降序（同分按 order 降序，后声明胜出）
  const byProperty = new Map<string, Candidate[]>();
  candidates.forEach((c) => {
    if (!byProperty.has(c.property)) byProperty.set(c.property, []);
    byProperty.get(c.property)!.push(c);
  });
  return Array.from(byProperty.entries())
    .map(([property, list]) => {
      list.sort((a, b) => b.score - a.score || b.order - a.order);
      return { property, winner: list[0] ?? null, candidates: list };
    })
    .sort((a, b) => a.property.localeCompare(b.property));
}

/** 单条声明编辑行 */
function DeclRow({
  decl,
  onChange,
  onToggleImportant,
  onRemove,
}: {
  decl: LayerDecl;
  onChange: (property: string, value: string) => void;
  onToggleImportant: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="lyr__decl">
      <input
        className="lyr__decl-prop"
        type="text"
        value={decl.property}
        placeholder="属性"
        onChange={(e) => onChange(e.target.value, decl.value)}
      />
      <span className="lyr__decl-colon">:</span>
      <input
        className="lyr__decl-val"
        type="text"
        value={decl.value}
        placeholder="值"
        onChange={(e) => onChange(decl.property, e.target.value)}
      />
      <button
        type="button"
        className={`lyr__btn lyr__btn--imp${decl.important ? ' is-active' : ''}`}
        onClick={onToggleImportant}
        title="切换 !important"
        aria-label="切换 !important"
      >
        !
      </button>
      <button type="button" className="lyr__btn lyr__btn--del" onClick={onRemove} aria-label="删除该声明">
        ×
      </button>
    </div>
  );
}

export default function LayerTool() {
  // 深拷贝预设配置，为每个节点生成新的稳定 id
  const cloneConfig = useCallback((cfg: LayerConfig): LayerConfig => ({
    layers: cfg.layers.map((l) => ({
      id: genId('layer'),
      name: l.name,
      rules: l.rules.map((r) => ({
        id: genId('rule'),
        selector: r.selector,
        declarations: r.declarations.map((d) => ({ id: genId('decl'), property: d.property, value: d.value, important: d.important })),
      })),
    })),
    unlayered: cfg.unlayered.map((r) => ({
      id: genId('rule'),
      selector: r.selector,
      declarations: r.declarations.map((d) => ({ id: genId('decl'), property: d.property, value: d.value, important: d.important })),
    })),
  }), []);

  const [config, setConfig] = useState<LayerConfig>(() => cloneConfig(DEFAULT_CONFIG));
  const [previewHtml, setPreviewHtml] = useState<string>(DEFAULT_HTML);
  const [target, setTarget] = useState<string>(DEFAULT_TARGET);
  const [copied, setCopied] = useState(false);

  // 生成的层叠 CSS
  const layeredCss = useMemo(() => buildLayeredCss(config), [config]);
  // 级联胜出分析
  const analysis = useMemo(() => analyzeCascade(config, target), [config, target]);

  // 预览 iframe 的 srcDoc
  const previewSrcDoc = useMemo(
    () =>
      `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body { font-family: -apple-system, system-ui, sans-serif; padding: 16px; margin: 0; color: #111827; }
        ${layeredCss}
      </style></head><body>${previewHtml}</body></html>`,
    [layeredCss, previewHtml],
  );

  // 应用预设
  const applyPreset = useCallback(
    (preset: LayerPreset) => {
      setConfig(cloneConfig(preset.config));
      setPreviewHtml(preset.previewHtml);
      setTarget(preset.target);
    },
    [cloneConfig],
  );

  // 复制 CSS
  const handleCopy = useCallback(async () => {
    const ok = await copyText(layeredCss);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  }, [layeredCss]);

  // === 层级操作 ===
  const addLayer = useCallback(() => {
    setConfig((prev) => ({ ...prev, layers: [...prev.layers, makeLayer('new-layer', [makeRule('.box', [makeDecl('padding', '12px')])])] }));
  }, []);
  const removeLayer = useCallback((id: string) => {
    setConfig((prev) => ({ ...prev, layers: prev.layers.filter((l) => l.id !== id) }));
  }, []);
  const renameLayer = useCallback((id: string, name: string) => {
    setConfig((prev) => ({ ...prev, layers: prev.layers.map((l) => (l.id === id ? { ...l, name } : l)) }));
  }, []);
  const moveLayer = useCallback((id: string, dir: -1 | 1) => {
    setConfig((prev) => {
      const idx = prev.layers.findIndex((l) => l.id === id);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= prev.layers.length) return prev;
      const next = [...prev.layers];
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...prev, layers: next };
    });
  }, []);

  // === 层内规则操作 ===
  const addLayerRule = useCallback((layerId: string) => {
    setConfig((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === layerId ? { ...l, rules: [...l.rules, makeRule('.box', [makeDecl('', '')])] } : l)),
    }));
  }, []);
  const removeLayerRule = useCallback((layerId: string, ruleId: string) => {
    setConfig((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === layerId ? { ...l, rules: l.rules.filter((r) => r.id !== ruleId) } : l)),
    }));
  }, []);
  const updateLayerRuleSelector = useCallback((layerId: string, ruleId: string, selector: string) => {
    setConfig((prev) => ({
      ...prev,
      layers: prev.layers.map((l) =>
        l.id === layerId ? { ...l, rules: l.rules.map((r) => (r.id === ruleId ? { ...r, selector } : r)) } : l,
      ),
    }));
  }, []);
  const addLayerDecl = useCallback((layerId: string, ruleId: string) => {
    setConfig((prev) => ({
      ...prev,
      layers: prev.layers.map((l) =>
        l.id === layerId
          ? { ...l, rules: l.rules.map((r) => (r.id === ruleId ? { ...r, declarations: [...r.declarations, makeDecl('', '')] } : r)) }
          : l,
      ),
    }));
  }, []);
  const updateLayerDecl = useCallback(
    (layerId: string, ruleId: string, declId: string, property: string, value: string) => {
      setConfig((prev) => ({
        ...prev,
        layers: prev.layers.map((l) =>
          l.id === layerId
            ? { ...l, rules: l.rules.map((r) => (r.id === ruleId ? { ...r, declarations: r.declarations.map((d) => (d.id === declId ? { ...d, property, value } : d)) } : r)) }
            : l,
        ),
      }));
    },
    [],
  );
  const toggleLayerDeclImportant = useCallback((layerId: string, ruleId: string, declId: string) => {
    setConfig((prev) => ({
      ...prev,
      layers: prev.layers.map((l) =>
        l.id === layerId
          ? { ...l, rules: l.rules.map((r) => (r.id === ruleId ? { ...r, declarations: r.declarations.map((d) => (d.id === declId ? { ...d, important: !d.important } : d)) } : r)) }
          : l,
      ),
    }));
  }, []);
  const removeLayerDecl = useCallback((layerId: string, ruleId: string, declId: string) => {
    setConfig((prev) => ({
      ...prev,
      layers: prev.layers.map((l) =>
        l.id === layerId
          ? { ...l, rules: l.rules.map((r) => (r.id === ruleId ? { ...r, declarations: r.declarations.filter((d) => d.id !== declId) } : r)) }
          : l,
      ),
    }));
  }, []);

  // === 未分层规则操作 ===
  const addUnlayeredRule = useCallback(() => {
    setConfig((prev) => ({ ...prev, unlayered: [...prev.unlayered, makeRule('.box', [makeDecl('', '')])] }));
  }, []);
  const removeUnlayeredRule = useCallback((id: string) => {
    setConfig((prev) => ({ ...prev, unlayered: prev.unlayered.filter((r) => r.id !== id) }));
  }, []);
  const updateUnlayeredSelector = useCallback((id: string, selector: string) => {
    setConfig((prev) => ({ ...prev, unlayered: prev.unlayered.map((r) => (r.id === id ? { ...r, selector } : r)) }));
  }, []);
  const addUnlayeredDecl = useCallback((id: string) => {
    setConfig((prev) => ({
      ...prev,
      unlayered: prev.unlayered.map((r) => (r.id === id ? { ...r, declarations: [...r.declarations, makeDecl('', '')] } : r)),
    }));
  }, []);
  const updateUnlayeredDecl = useCallback((id: string, declId: string, property: string, value: string) => {
    setConfig((prev) => ({
      ...prev,
      unlayered: prev.unlayered.map((r) => (r.id === id ? { ...r, declarations: r.declarations.map((d) => (d.id === declId ? { ...d, property, value } : d)) } : r)),
    }));
  }, []);
  const toggleUnlayeredImportant = useCallback((id: string, declId: string) => {
    setConfig((prev) => ({
      ...prev,
      unlayered: prev.unlayered.map((r) => (r.id === id ? { ...r, declarations: r.declarations.map((d) => (d.id === declId ? { ...d, important: !d.important } : d)) } : r)),
    }));
  }, []);
  const removeUnlayeredDecl = useCallback((id: string, declId: string) => {
    setConfig((prev) => ({
      ...prev,
      unlayered: prev.unlayered.map((r) => (r.id === id ? { ...r, declarations: r.declarations.filter((d) => d.id !== declId) } : r)),
    }));
  }, []);

  return (
    <div className="lyr">
      {/* 预设按钮组 */}
      <div className="lyr__presets">
        <span className="lyr__presets-label">预设：</span>
        {PRESETS.map((p) => (
          <button key={p.name} type="button" className="lyr__btn lyr__btn--preset" onClick={() => applyPreset(p)}>
            {p.name}
          </button>
        ))}
      </div>

      <div className="lyr__main">
        {/* 左：编辑区 */}
        <div className="lyr__editor">
          {/* 层列表 */}
          <div className="lyr__panel">
            <div className="lyr__panel-head">
              <span className="lyr__panel-title">层叠层（顺序：上→下，下层优先级更高）</span>
              <button type="button" className="lyr__btn lyr__btn--add" onClick={addLayer}>
                + 新增层
              </button>
            </div>
            <div className="lyr__panel-body">
              {config.layers.length === 0 && <p className="lyr__empty">暂无层，点击"新增层"添加。</p>}
              {config.layers.map((layer, idx) => (
                <div key={layer.id} className="lyr__layer">
                  <div className="lyr__layer-head">
                    <span className="lyr__layer-idx" title="层顺序（数字越大优先级越高）">
                      {idx + 1}
                    </span>
                    <input
                      className="lyr__layer-name"
                      type="text"
                      value={layer.name}
                      placeholder="层名（留空为匿名层）"
                      onChange={(e) => renameLayer(layer.id, e.target.value)}
                    />
                    <div className="lyr__layer-ops">
                      <button type="button" className="lyr__btn lyr__btn--op" onClick={() => moveLayer(layer.id, -1)} disabled={idx === 0} aria-label="上移">
                        ↑
                      </button>
                      <button
                        type="button"
                        className="lyr__btn lyr__btn--op"
                        onClick={() => moveLayer(layer.id, 1)}
                        disabled={idx === config.layers.length - 1}
                        aria-label="下移"
                      >
                        ↓
                      </button>
                      <button type="button" className="lyr__btn lyr__btn--del" onClick={() => removeLayer(layer.id)} aria-label="删除层">
                        ×
                      </button>
                    </div>
                  </div>
                  {layer.rules.map((rule) => (
                    <div key={rule.id} className="lyr__rule">
                      <div className="lyr__rule-head">
                        <input
                          className="lyr__rule-sel"
                          type="text"
                          value={rule.selector}
                          placeholder="选择器"
                          onChange={(e) => updateLayerRuleSelector(layer.id, rule.id, e.target.value)}
                        />
                        <button type="button" className="lyr__btn lyr__btn--del" onClick={() => removeLayerRule(layer.id, rule.id)} aria-label="删除规则">
                          ×
                        </button>
                      </div>
                      <div className="lyr__decls">
                        {rule.declarations.map((d) => (
                          <DeclRow
                            key={d.id}
                            decl={d}
                            onChange={(p, v) => updateLayerDecl(layer.id, rule.id, d.id, p, v)}
                            onToggleImportant={() => toggleLayerDeclImportant(layer.id, rule.id, d.id)}
                            onRemove={() => removeLayerDecl(layer.id, rule.id, d.id)}
                          />
                        ))}
                        <button type="button" className="lyr__btn lyr__btn--add-decl" onClick={() => addLayerDecl(layer.id, rule.id)}>
                          + 添加声明
                        </button>
                      </div>
                    </div>
                  ))}
                  <button type="button" className="lyr__btn lyr__btn--add-rule" onClick={() => addLayerRule(layer.id)}>
                    + 添加规则
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* 未分层规则 */}
          <div className="lyr__panel">
            <div className="lyr__panel-head">
              <span className="lyr__panel-title">未分层样式（优先级高于所有层）</span>
              <button type="button" className="lyr__btn lyr__btn--add" onClick={addUnlayeredRule}>
                + 新增规则
              </button>
            </div>
            <div className="lyr__panel-body">
              {config.unlayered.length === 0 && <p className="lyr__empty">暂无未分层样式。</p>}
              {config.unlayered.map((rule) => (
                <div key={rule.id} className="lyr__rule">
                  <div className="lyr__rule-head">
                    <input
                      className="lyr__rule-sel"
                      type="text"
                      value={rule.selector}
                      placeholder="选择器"
                      onChange={(e) => updateUnlayeredSelector(rule.id, e.target.value)}
                    />
                    <button type="button" className="lyr__btn lyr__btn--del" onClick={() => removeUnlayeredRule(rule.id)} aria-label="删除规则">
                      ×
                    </button>
                  </div>
                  <div className="lyr__decls">
                    {rule.declarations.map((d) => (
                      <DeclRow
                        key={d.id}
                        decl={d}
                        onChange={(p, v) => updateUnlayeredDecl(rule.id, d.id, p, v)}
                        onToggleImportant={() => toggleUnlayeredImportant(rule.id, d.id)}
                        onRemove={() => removeUnlayeredDecl(rule.id, d.id)}
                      />
                    ))}
                    <button type="button" className="lyr__btn lyr__btn--add-decl" onClick={() => addUnlayeredDecl(rule.id)}>
                      + 添加声明
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 右：预览 + 级联分析 + 代码 */}
        <div className="lyr__output">
          {/* 预览 */}
          <div className="lyr__panel">
            <div className="lyr__panel-head">
              <span className="lyr__panel-title">预览</span>
            </div>
            <div className="lyr__panel-body">
              <iframe className="lyr__preview" sandbox="allow-same-origin" srcDoc={previewSrcDoc} title="@layer 预览" />
              <details className="lyr__html-edit">
                <summary>编辑预览 HTML</summary>
                <textarea className="lyr__textarea" value={previewHtml} onChange={(e) => setPreviewHtml(e.target.value)} rows={4} />
              </details>
            </div>
          </div>

          {/* 级联胜出分析 */}
          <div className="lyr__panel">
            <div className="lyr__panel-head">
              <span className="lyr__panel-title">级联胜出分析</span>
              <div className="lyr__target">
                <label htmlFor="lyr-target">目标选择器：</label>
                <input id="lyr-target" type="text" value={target} onChange={(e) => setTarget(e.target.value)} />
              </div>
            </div>
            <div className="lyr__panel-body">
              {analysis.length === 0 && (
                <p className="lyr__empty">未找到匹配 <code>{target}</code> 的声明。请确保规则选择器与目标一致。</p>
              )}
              <table className="lyr__table">
                <thead>
                  <tr>
                    <th>属性</th>
                    <th>胜出值</th>
                    <th>来源</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.map((row) => (
                    <tr key={row.property}>
                      <td className="lyr__mono">{row.property}</td>
                      <td className="lyr__mono lyr__winner">
                        {row.winner ? row.winner.value : '—'}
                        {row.winner?.important && <span className="lyr__tag">!important</span>}
                      </td>
                      <td>{row.winner ? row.winner.source : '—'}</td>
                      <td className="lyr__reason">
                        {row.winner
                          ? row.winner.important
                            ? row.winner.layerIndex === -1
                              ? '未分层 !important（优先级最低）'
                              : `前层 !important 反转胜出`
                            : row.winner.layerIndex === -1
                              ? '未分层普通声明（最高）'
                              : `后层普通声明胜出`
                          : '无匹配声明'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 代码输出 */}
          <div className="lyr__panel">
            <div className="lyr__panel-head">
              <span className="lyr__panel-title">生成的 CSS</span>
              <button type="button" className="lyr__btn lyr__btn--copy" onClick={handleCopy}>
                {copied ? '已复制 ✓' : '复制 CSS'}
              </button>
            </div>
            <div className="lyr__panel-body">
              <pre className="lyr__code">{layeredCss}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
