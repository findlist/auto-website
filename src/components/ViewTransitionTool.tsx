import { useState, useMemo, useCallback, useRef } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS view-transition 视图过渡生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 两种过渡模式：同文档（SPA，document.startViewTransition）/ 跨文档（MPA，@view-transition）
 *  - 命名元素管理：为元素分配 view-transition-name，参与独立过渡
 *  - 伪元素动画覆盖：::view-transition-group / image-pair / old / new 自定义动画
 *  - 可交互预览：iframe 内实际触发 startViewTransition，对比 A/B 两状态过渡效果
 *  - 智能代码生成：view-transition-name 声明 + 伪元素样式 + @view-transition 规则 + JS 触发代码
 *  - 原理说明面板：快照机制、命名元素独立过渡、浏览器兼容性
 *  - 8 组预设覆盖淡入淡出、卡片展开、共享元素、主题切换等场景
 *
 * 核心知识点：
 *  - 视图过渡通过捕获新旧 DOM 快照实现平滑切换，无需手动编写过渡动画
 *  - view-transition-name 唯一标识参与过渡的元素，浏览器自动捕获其新旧快照
 *  - 同文档用 document.startViewTransition(callback)，跨文档用 @view-transition { navigation: auto }
 *  - ::view-transition-* 伪元素树：root → group(name) → image-pair(name) → old/new(name)
 *  - 浏览器支持：Chrome 111+（同文档）/ Chrome 126+（跨文档），Safari 18+，Firefox 136+
 */

/** 过渡模式 */
type TransitionMode = 'same-document' | 'cross-document';

/** 伪元素类型 */
type PseudoType = 'group' | 'image-pair' | 'old' | 'new';

/** 单个伪元素的动画覆盖配置 */
interface PseudoOverride {
  enabled: boolean; // 是否为该伪元素自定义动画
  duration: string; // '0.4s' | '0s' | 'auto'
  timingFunction: string; // 'ease' | 'linear' | 'cubic-bezier(...)'
  transform: string; // 额外 transform，如 'translateX(50px)'（留空则不输出）
  opacity: string; // 额外 opacity，如 '0'（留空则不输出）
}

/** 命名元素：参与视图过渡的元素 */
interface NamedElement {
  id: string;
  selector: string; // CSS 选择器，如 '.card'
  name: string; // view-transition-name，如 'card'
  overrides: Record<PseudoType, PseudoOverride>; // 四种伪元素的动画覆盖
}

/** 全局配置 */
interface ViewTransitionConfig {
  mode: TransitionMode;
  globalDuration: string; // 默认过渡时长（::view-transition-old/new）
  globalTimingFunction: string; // 默认缓动函数
  namedElements: NamedElement[];
}

/** 预设：配置 + 预览 A/B 状态 HTML */
interface VtPreset {
  name: string;
  description: string;
  config: ViewTransitionConfig;
  previewStateA: string; // 预览状态 A 的 HTML
  previewStateB: string; // 预览状态 B 的 HTML
}

// 模块级 id 生成器，保证 React key 稳定唯一
let _idCounter = 0;
const genId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${(++_idCounter).toString(36)}`;

/** 创建默认伪元素覆盖（禁用，使用全局默认） */
const makeDefaultOverride = (): PseudoOverride => ({
  enabled: false,
  duration: '0.4s',
  timingFunction: 'ease',
  transform: '',
  opacity: '',
});

/** 创建一个命名元素 */
const makeNamedElement = (selector = '.card', name = 'card'): NamedElement => ({
  id: genId('ne'),
  selector,
  name,
  overrides: {
    group: makeDefaultOverride(),
    'image-pair': makeDefaultOverride(),
    old: makeDefaultOverride(),
    new: makeDefaultOverride(),
  },
});

/** 伪元素类型中文标签 */
const PSEUDO_LABELS: Record<PseudoType, string> = {
  group: '::view-transition-group',
  'image-pair': '::view-transition-image-pair',
  old: '::view-transition-old',
  new: '::view-transition-new',
};

/** 伪元素类型说明 */
const PSEUDO_DESC: Record<PseudoType, string> = {
  group: '元素组——位置与尺寸的动画容器',
  'image-pair': '新旧图像对——同时容纳 old 与 new 快照',
  old: '旧快照——过渡前的元素截图',
  new: '新快照——过渡后的元素截图',
};

// ============ 代码生成函数 ============

/** 生成命名元素的 view-transition-name 声明 */
const buildNamedDecls = (namedElements: NamedElement[]): string => {
  const valid = namedElements.filter((n) => n.selector && n.name);
  if (valid.length === 0) return '/* 暂未为元素分配 view-transition-name */';
  return valid
    .map((n) => `${n.selector} {\n  view-transition-name: ${n.name};\n}`)
    .join('\n\n');
};

/** 生成单个伪元素的样式块（仅输出启用的覆盖） */
const buildPseudoBlock = (name: string, pseudo: PseudoType, o: PseudoOverride): string | null => {
  if (!o.enabled) return null;
  const decls: string[] = [];
  if (o.duration) decls.push(`  animation-duration: ${o.duration};`);
  if (o.timingFunction) decls.push(`  animation-timing-function: ${o.timingFunction};`);
  if (o.transform) decls.push(`  transform: ${o.transform};`);
  if (o.opacity !== '') decls.push(`  opacity: ${o.opacity};`);
  if (decls.length === 0) return null;
  // 命名伪元素：::view-transition-old(name)；全局伪元素：::view-transition-old
  const selector = name
    ? `::view-transition-${pseudo}(${name})`
    : `::view-transition-${pseudo}`;
  return `${selector} {\n${decls.join('\n')}\n}`;
};

/** 生成所有命名元素的伪元素样式 */
const buildPseudoCss = (namedElements: NamedElement[]): string => {
  const blocks: string[] = [];
  for (const n of namedElements) {
    if (!n.name) continue;
    (Object.keys(n.overrides) as PseudoType[]).forEach((pseudo) => {
      const block = buildPseudoBlock(n.name, pseudo, n.overrides[pseudo]);
      if (block) blocks.push(block);
    });
  }
  return blocks.length > 0 ? blocks.join('\n\n') : '/* 暂未自定义伪元素动画 */';
};

/** 生成全局伪元素样式（::view-transition-old/new 默认时长） */
const buildGlobalPseudoCss = (config: ViewTransitionConfig): string => {
  const decls: string[] = [];
  if (config.globalDuration) decls.push(`  animation-duration: ${config.globalDuration};`);
  if (config.globalTimingFunction)
    decls.push(`  animation-timing-function: ${config.globalTimingFunction};`);
  if (decls.length === 0) return '';
  return `::view-transition-old(root),\n::view-transition-new(root) {\n${decls.join('\n')}\n}`;
};

/** 生成 @view-transition 跨文档规则 */
const buildAtRule = (config: ViewTransitionConfig): string => {
  if (config.mode !== 'cross-document') return '';
  return '@view-transition {\n  navigation: auto;\n}';
};

/** 生成同文档 JS 触发代码 */
const buildJsCode = (config: ViewTransitionConfig): string => {
  if (config.mode !== 'same-document') return '';
  return [
    '// 同文档视图过渡：在修改 DOM 前调用 startViewTransition',
    '// 浏览器自动捕获旧快照，callback 执行 DOM 变更后捕获新快照',
    'function toggleState() {',
    '  if (!document.startViewTransition) {',
    '    // 不支持的浏览器降级为直接变更',
    '    applyStateChange();',
    '    return;',
    '  }',
    '  const transition = document.startViewTransition(() => {',
    '    applyStateChange(); // 在此执行 DOM 变更',
    '  });',
    '}',
  ].join('\n');
};

/** 组装完整 CSS 代码 */
const buildFullCss = (config: ViewTransitionConfig): string => {
  const parts: string[] = [];
  const atRule = buildAtRule(config);
  if (atRule) parts.push(atRule);
  const named = buildNamedDecls(config.namedElements);
  parts.push(named);
  const global = buildGlobalPseudoCss(config);
  if (global) parts.push(global);
  const pseudo = buildPseudoCss(config.namedElements);
  parts.push(pseudo);
  return parts.join('\n\n');
};

// ============ 预设数据 ============

/** 8 组预设效果 */
const PRESETS: VtPreset[] = [
  {
    name: '默认淡入淡出',
    description: '基础整页过渡——新旧快照交叉淡入淡出，无需命名元素',
    config: {
      mode: 'same-document',
      globalDuration: '0.4s',
      globalTimingFunction: 'ease',
      namedElements: [],
    },
    previewStateA: '<div class="state-a"><h2>状态 A</h2><p>点击下方按钮切换到状态 B</p></div>',
    previewStateB: '<div class="state-b"><h2>状态 B</h2><p>已通过视图过渡切换</p></div>',
  },
  {
    name: '卡片展开',
    description: '命名卡片元素——切换状态时卡片在新旧位置间平滑过渡',
    config: {
      mode: 'same-document',
      globalDuration: '0.5s',
      globalTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
      namedElements: [
        { ...makeNamedElement('.card', 'card'), overrides: {
          group: { enabled: true, duration: '0.5s', timingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)', transform: '', opacity: '' },
          'image-pair': makeDefaultOverride(),
          old: { enabled: true, duration: '0.25s', timingFunction: 'ease', transform: '', opacity: '0' },
          new: { enabled: true, duration: '0.25s', timingFunction: 'ease', transform: '', opacity: '' },
        } },
      ],
    },
    previewStateA: '<div class="card">卡片（列表态）</div>',
    previewStateB: '<div class="card expanded">卡片（展开态）</div>',
  },
  {
    name: '共享元素过渡',
    description: '列表与详情共享同一命名元素——点击列表项平滑过渡到详情',
    config: {
      mode: 'same-document',
      globalDuration: '0.4s',
      globalTimingFunction: 'ease',
      namedElements: [
        { ...makeNamedElement('.hero-image', 'hero-image'), overrides: {
          group: { enabled: true, duration: '0.4s', timingFunction: 'ease', transform: '', opacity: '' },
          'image-pair': makeDefaultOverride(),
          old: makeDefaultOverride(),
          new: makeDefaultOverride(),
        } },
      ],
    },
    previewStateA: '<div class="hero-image small">小图（列表态）</div>',
    previewStateB: '<div class="hero-image large">大图（详情态）</div>',
  },
  {
    name: '主题切换',
    description: '整页主题切换——新旧快照交叉淡入，配合全局时长控制',
    config: {
      mode: 'same-document',
      globalDuration: '0.6s',
      globalTimingFunction: 'ease-in-out',
      namedElements: [],
    },
    previewStateA: '<div class="theme-light"><h2>浅色主题</h2></div>',
    previewStateB: '<div class="theme-dark"><h2>深色主题</h2></div>',
  },
  {
    name: '侧栏滑入',
    description: '侧栏命名元素——从隐藏到显示时平滑滑入，自定义 group 位移动画',
    config: {
      mode: 'same-document',
      globalDuration: '0.4s',
      globalTimingFunction: 'ease',
      namedElements: [
        { ...makeNamedElement('.sidebar', 'sidebar'), overrides: {
          group: { enabled: true, duration: '0.4s', timingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)', transform: '', opacity: '' },
          'image-pair': makeDefaultOverride(),
          old: { enabled: true, duration: '0.4s', timingFunction: 'ease', transform: 'translateX(-100%)', opacity: '' },
          new: { enabled: true, duration: '0.4s', timingFunction: 'ease', transform: 'translateX(0)', opacity: '' },
        } },
      ],
    },
    previewStateA: '<div class="content">主内容（无侧栏）</div>',
    previewStateB: '<div class="sidebar">侧栏</div><div class="content">主内容（含侧栏）</div>',
  },
  {
    name: '列表重排',
    description: '列表项命名——重排时各项在旧位置与新位置间平滑过渡',
    config: {
      mode: 'same-document',
      globalDuration: '0.4s',
      globalTimingFunction: 'ease',
      namedElements: [
        { ...makeNamedElement('.item-a', 'item-a'), overrides: {
          group: { enabled: true, duration: '0.4s', timingFunction: 'ease', transform: '', opacity: '' },
          'image-pair': makeDefaultOverride(),
          old: makeDefaultOverride(),
          new: makeDefaultOverride(),
        } },
        { ...makeNamedElement('.item-b', 'item-b'), overrides: {
          group: { enabled: true, duration: '0.4s', timingFunction: 'ease', transform: '', opacity: '' },
          'image-pair': makeDefaultOverride(),
          old: makeDefaultOverride(),
          new: makeDefaultOverride(),
        } },
      ],
    },
    previewStateA: '<div class="item-a">项 A</div><div class="item-b">项 B</div>',
    previewStateB: '<div class="item-b">项 B</div><div class="item-a">项 A</div>',
  },
  {
    name: '跨文档导航',
    description: 'MPA 多页应用——@view-transition 让整页跳转也具备平滑过渡',
    config: {
      mode: 'cross-document',
      globalDuration: '0.4s',
      globalTimingFunction: 'ease',
      namedElements: [],
    },
    previewStateA: '<div class="page"><h2>页面 A</h2><p>跨文档过渡演示</p></div>',
    previewStateB: '<div class="page"><h2>页面 B</h2><p>已平滑跳转</p></div>',
  },
  {
    name: '快速切换',
    description: '短时长快速过渡——适合频繁切换的状态，避免拖沓',
    config: {
      mode: 'same-document',
      globalDuration: '0.2s',
      globalTimingFunction: 'linear',
      namedElements: [],
    },
    previewStateA: '<div class="state-a"><h2>状态 A</h2></div>',
    previewStateB: '<div class="state-b"><h2>状态 B</h2></div>',
  },
];

// ============ 预览 HTML 生成 ============

/** 生成 iframe 预览的完整 HTML（含状态切换脚本与注入的 CSS） */
const buildPreviewHtml = (
  config: ViewTransitionConfig,
  stateA: string,
  stateB: string,
): string => {
  // 复用代码生成函数，保持预览与输出一致
  const namedCss = buildNamedDecls(config.namedElements);
  const globalCss = buildGlobalPseudoCss(config);
  const pseudoCss = buildPseudoCss(config.namedElements);
  const fullCss = [namedCss, globalCss, pseudoCss].filter(Boolean).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  body { margin: 0; padding: 16px; font-family: system-ui, sans-serif; background: #f5f5f7; color: #1d1d1f; }
  .stage { min-height: 120px; padding: 12px; border: 1px dashed #d2d2d7; border-radius: 8px; background: #fff; }
  .card { padding: 16px; background: #2b6cff; color: #fff; border-radius: 8px; font-weight: 600; }
  .card.expanded { padding: 32px; background: #7a4cff; }
  .hero-image { background: linear-gradient(135deg, #2b6cff, #7a4cff); color: #fff; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 600; }
  .hero-image.small { width: 80px; height: 60px; font-size: 12px; }
  .hero-image.large { width: 100%; height: 120px; font-size: 18px; }
  .sidebar { width: 120px; height: 100px; background: #34c759; color: #fff; border-radius: 8px; padding: 12px; float: left; margin-right: 12px; }
  .content { overflow: hidden; padding: 12px; background: #e5e5ea; border-radius: 8px; height: 100px; }
  .item-a, .item-b { padding: 12px; margin-bottom: 8px; background: #ffd60a; color: #1d1d1f; border-radius: 6px; font-weight: 600; }
  .item-b { background: #ff9500; }
  .theme-light { background: #fff; color: #1d1d1f; padding: 24px; border-radius: 8px; }
  .theme-dark { background: #1d1d1f; color: #fff; padding: 24px; border-radius: 8px; }
  .page { padding: 24px; background: #fff; border-radius: 8px; }
  h2 { margin: 0 0 8px; font-size: 18px; }
  p { margin: 0; font-size: 14px; }
  .toolbar { margin-bottom: 12px; }
  .btn { padding: 8px 16px; border: none; border-radius: 6px; background: #2b6cff; color: #fff; cursor: pointer; font-size: 14px; }
  .btn:hover { background: #1a5cff; }
  /* 注入用户生成的视图过渡 CSS */
  ${fullCss}
</style>
</head>
<body>
  <div class="toolbar">
    <button class="btn" id="toggle">切换状态（触发视图过渡）</button>
  </div>
  <div class="stage" id="stage">${stateA}</div>
  <script>
    // 同文档视图过渡：捕获旧快照 → 执行 DOM 变更 → 捕获新快照 → 播放过渡
    var isA = true;
    var stateA = ${JSON.stringify(stateA)};
    var stateB = ${JSON.stringify(stateB)};
    document.getElementById('toggle').addEventListener('click', function () {
      var stage = document.getElementById('stage');
      // 不支持 startViewTransition 时降级为直接切换
      if (!document.startViewTransition) {
        stage.innerHTML = isA ? stateB : stateA;
        isA = !isA;
        return;
      }
      var transition = document.startViewTransition(function () {
        stage.innerHTML = isA ? stateB : stateA;
      });
      transition.finished.finally(function () { isA = !isA; });
    });
  </script>
</body>
</html>`;
};

// ============ 主组件 ============

export default function ViewTransitionTool() {
  const [config, setConfig] = useState<ViewTransitionConfig>({
    mode: 'same-document',
    globalDuration: '0.4s',
    globalTimingFunction: 'ease',
    namedElements: [],
  });
  const [previewA, setPreviewA] = useState(PRESETS[0].previewStateA);
  const [previewB, setPreviewB] = useState(PRESETS[0].previewStateB);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string>('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // 当前选中的命名元素
  const selected = useMemo(
    () => config.namedElements.find((n) => n.id === selectedId) ?? null,
    [config.namedElements, selectedId],
  );

  // 生成的完整 CSS
  const fullCss = useMemo(() => buildFullCss(config), [config]);
  // 生成的 JS 触发代码
  const jsCode = useMemo(() => buildJsCode(config), [config]);
  // 预览 HTML
  const previewHtml = useMemo(
    () => buildPreviewHtml(config, previewA, previewB),
    [config, previewA, previewB],
  );

  // 复制文本并显示反馈
  const handleCopy = useCallback(async (key: string, text: string) => {
    const ok = await copyText(text);
    if (ok) {
      setCopied(key);
      setTimeout(() => setCopied(''), 1500);
    }
  }, []);

  // 应用预设
  const applyPreset = useCallback((preset: VtPreset) => {
    // 深拷贝预设配置，重新生成 id 避免 React key 冲突
    const namedElements = preset.config.namedElements.map((n) => ({
      ...n,
      id: genId('ne'),
      overrides: {
        group: { ...n.overrides.group },
        'image-pair': { ...n.overrides['image-pair'] },
        old: { ...n.overrides.old },
        new: { ...n.overrides.new },
      },
    }));
    setConfig({ ...preset.config, namedElements });
    setPreviewA(preset.previewStateA);
    setPreviewB(preset.previewStateB);
    setSelectedId(namedElements[0]?.id ?? null);
  }, []);

  // 新增命名元素
  const addNamedElement = useCallback(() => {
    const idx = config.namedElements.length + 1;
    const el = makeNamedElement(`.element-${idx}`, `element-${idx}`);
    setConfig((c) => ({ ...c, namedElements: [...c.namedElements, el] }));
    setSelectedId(el.id);
  }, [config.namedElements.length]);

  // 删除命名元素
  const removeNamedElement = useCallback((id: string) => {
    setConfig((c) => ({
      ...c,
      namedElements: c.namedElements.filter((n) => n.id !== id),
    }));
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);

  // 更新命名元素的基本字段
  const updateNamedField = useCallback(
    (id: string, field: 'selector' | 'name', value: string) => {
      setConfig((c) => ({
        ...c,
        namedElements: c.namedElements.map((n) =>
          n.id === id ? { ...n, [field]: value } : n,
        ),
      }));
    },
    [],
  );

  // 更新命名元素的伪元素覆盖
  const updateOverride = useCallback(
    (
      id: string,
      pseudo: PseudoType,
      field: keyof PseudoOverride,
      value: string | boolean,
    ) => {
      setConfig((c) => ({
        ...c,
        namedElements: c.namedElements.map((n) =>
          n.id === id
            ? {
                ...n,
                overrides: {
                  ...n.overrides,
                  [pseudo]: { ...n.overrides[pseudo], [field]: value },
                },
              }
            : n,
        ),
      }));
    },
    [],
  );

  // 重新加载预览（iframe srcdoc 变化会自动重新加载）
  const reloadPreview = useCallback(() => {
    if (iframeRef.current) {
      // 重新触发 iframe 渲染
      iframeRef.current.srcdoc = previewHtml;
    }
  }, [previewHtml]);

  return (
    <div className="vt">
      {/* 预设按钮组 */}
      <section className="vt__presets">
        <h3 className="vt__subtitle">预设效果</h3>
        <div className="vt__preset-grid">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              className="vt__preset-btn"
              onClick={() => applyPreset(p)}
              title={p.description}
            >
              {p.name}
            </button>
          ))}
        </div>
      </section>

      <div className="vt__main">
        {/* 左栏：配置 */}
        <div className="vt__config">
          {/* 全局配置 */}
          <section className="vt__panel">
            <h3 className="vt__subtitle">全局配置</h3>
            <div className="vt__field">
              <label className="vt__label">过渡模式</label>
              <div className="vt__seg">
                <button
                  type="button"
                  className={`vt__seg-btn${config.mode === 'same-document' ? ' is-active' : ''}`}
                  onClick={() => setConfig((c) => ({ ...c, mode: 'same-document' }))}
                >
                  同文档（SPA）
                </button>
                <button
                  type="button"
                  className={`vt__seg-btn${config.mode === 'cross-document' ? ' is-active' : ''}`}
                  onClick={() => setConfig((c) => ({ ...c, mode: 'cross-document' }))}
                >
                  跨文档（MPA）
                </button>
              </div>
              <p className="vt__hint">
                {config.mode === 'same-document'
                  ? '同文档模式：用 document.startViewTransition() 在单页内触发过渡，适合 SPA。'
                  : '跨文档模式：用 @view-transition { navigation: auto } 让整页跳转也平滑过渡，适合 MPA。'}
              </p>
            </div>
            <div className="vt__field-row">
              <div className="vt__field">
                <label className="vt__label">默认时长</label>
                <input
                  className="vt__input"
                  type="text"
                  value={config.globalDuration}
                  onChange={(e) => setConfig((c) => ({ ...c, globalDuration: e.target.value }))}
                  placeholder="0.4s"
                />
              </div>
              <div className="vt__field">
                <label className="vt__label">默认缓动</label>
                <select
                  className="vt__select"
                  value={config.globalTimingFunction}
                  onChange={(e) => setConfig((c) => ({ ...c, globalTimingFunction: e.target.value }))}
                >
                  <option value="ease">ease</option>
                  <option value="ease-in">ease-in</option>
                  <option value="ease-out">ease-out</option>
                  <option value="ease-in-out">ease-in-out</option>
                  <option value="linear">linear</option>
                  <option value="cubic-bezier(0.4, 0, 0.2, 1)">cubic-bezier(0.4, 0, 0.2, 1)</option>
                </select>
              </div>
            </div>
          </section>

          {/* 命名元素管理 */}
          <section className="vt__panel">
            <div className="vt__panel-head">
              <h3 className="vt__subtitle">命名元素</h3>
              <button type="button" className="vt__add-btn" onClick={addNamedElement}>
                + 新增
              </button>
            </div>
            <p className="vt__hint">
              为元素分配 <code>view-transition-name</code>，浏览器会自动捕获其新旧快照并独立过渡。
            </p>
            {config.namedElements.length === 0 ? (
              <p className="vt__empty">暂未添加命名元素，整页将使用默认淡入淡出。</p>
            ) : (
              <ul className="vt__named-list">
                {config.namedElements.map((n) => (
                  <li
                    key={n.id}
                    className={`vt__named-item${n.id === selectedId ? ' is-selected' : ''}`}
                  >
                    <button
                      type="button"
                      className="vt__named-select"
                      onClick={() => setSelectedId(n.id)}
                    >
                      <code className="vt__named-selector">{n.selector || '(未设置)'}</code>
                      <span className="vt__named-arrow">→</span>
                      <code className="vt__named-name">{n.name || '(未命名)'}</code>
                    </button>
                    <button
                      type="button"
                      className="vt__del-btn"
                      onClick={() => removeNamedElement(n.id)}
                      aria-label="删除"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 选中元素的伪元素动画覆盖 */}
          {selected && (
            <section className="vt__panel">
              <h3 className="vt__subtitle">
                伪元素动画覆盖
                <span className="vt__subtitle-tag">{selected.name || '(未命名)'}</span>
              </h3>
              <div className="vt__field-row">
                <div className="vt__field">
                  <label className="vt__label">选择器</label>
                  <input
                    className="vt__input"
                    type="text"
                    value={selected.selector}
                    onChange={(e) => updateNamedField(selected.id, 'selector', e.target.value)}
                    placeholder=".card"
                  />
                </div>
                <div className="vt__field">
                  <label className="vt__label">view-transition-name</label>
                  <input
                    className="vt__input"
                    type="text"
                    value={selected.name}
                    onChange={(e) => updateNamedField(selected.id, 'name', e.target.value)}
                    placeholder="card"
                  />
                </div>
              </div>
              {(Object.keys(selected.overrides) as PseudoType[]).map((pseudo) => {
                const o = selected.overrides[pseudo];
                return (
                  <div key={pseudo} className="vt__override">
                    <label className="vt__override-head">
                      <input
                        type="checkbox"
                        checked={o.enabled}
                        onChange={(e) => updateOverride(selected.id, pseudo, 'enabled', e.target.checked)}
                      />
                      <span>{PSEUDO_LABELS[pseudo]}</span>
                      <small className="vt__override-desc">{PSEUDO_DESC[pseudo]}</small>
                    </label>
                    {o.enabled && (
                      <div className="vt__override-body">
                        <div className="vt__field-row">
                          <div className="vt__field">
                            <label className="vt__label">时长</label>
                            <input
                              className="vt__input"
                              type="text"
                              value={o.duration}
                              onChange={(e) => updateOverride(selected.id, pseudo, 'duration', e.target.value)}
                            />
                          </div>
                          <div className="vt__field">
                            <label className="vt__label">缓动</label>
                            <select
                              className="vt__select"
                              value={o.timingFunction}
                              onChange={(e) => updateOverride(selected.id, pseudo, 'timingFunction', e.target.value)}
                            >
                              <option value="ease">ease</option>
                              <option value="linear">linear</option>
                              <option value="ease-in">ease-in</option>
                              <option value="ease-out">ease-out</option>
                              <option value="ease-in-out">ease-in-out</option>
                              <option value="cubic-bezier(0.4, 0, 0.2, 1)">cubic-bezier(0.4, 0, 0.2, 1)</option>
                            </select>
                          </div>
                        </div>
                        <div className="vt__field-row">
                          <div className="vt__field">
                            <label className="vt__label">transform（可选）</label>
                            <input
                              className="vt__input"
                              type="text"
                              value={o.transform}
                              onChange={(e) => updateOverride(selected.id, pseudo, 'transform', e.target.value)}
                              placeholder="translateX(50px)"
                            />
                          </div>
                          <div className="vt__field">
                            <label className="vt__label">opacity（可选）</label>
                            <input
                              className="vt__input"
                              type="text"
                              value={o.opacity}
                              onChange={(e) => updateOverride(selected.id, pseudo, 'opacity', e.target.value)}
                              placeholder="留空则不输出"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          )}
        </div>

        {/* 右栏：预览 + 代码 + 原理 */}
        <div className="vt__output">
          {/* 可交互预览 */}
          <section className="vt__panel">
            <div className="vt__panel-head">
              <h3 className="vt__subtitle">可交互预览</h3>
              <button type="button" className="vt__reload-btn" onClick={reloadPreview}>
                重新加载
              </button>
            </div>
            <p className="vt__hint">
              点击预览内的「切换状态」按钮，实际触发 <code>document.startViewTransition</code> 观察过渡效果。
            </p>
            <iframe
              ref={iframeRef}
              className="vt__preview"
              sandbox="allow-same-origin allow-scripts"
              srcDoc={previewHtml}
              title="视图过渡预览"
            />
          </section>

          {/* 原理说明 */}
          <section className="vt__panel">
            <h3 className="vt__subtitle">原理说明</h3>
            <div className="vt__explain">
              <p>
                <strong>快照机制</strong>：调用 <code>startViewTransition</code> 时，浏览器先捕获当前 DOM
                的旧快照，执行 callback 变更 DOM 后再捕获新快照，最后在伪元素树上播放交叉淡入。
              </p>
              <p>
                <strong>命名元素独立过渡</strong>：分配了 <code>view-transition-name</code> 的元素，
                其新旧快照会从默认 root 树中独立出来，在自身旧位置与新位置间平滑过渡（位置/尺寸动画）。
              </p>
              <p>
                <strong>伪元素树结构</strong>：root → group(name) → image-pair(name) → old/new(name)。
                group 管位置尺寸，image-pair 容纳新旧快照，old/new 是实际图像。
              </p>
              <p>
                <strong>浏览器支持</strong>：同文档 Chrome 111+ / Safari 18+ / Firefox 136+；
                跨文档 Chrome 126+。不支持时降级为直接 DOM 变更，无副作用。
              </p>
            </div>
          </section>

          {/* CSS 代码输出 */}
          <section className="vt__panel">
            <div className="vt__panel-head">
              <h3 className="vt__subtitle">CSS 代码</h3>
              <button type="button" className="vt__copy-btn" onClick={() => handleCopy('css', fullCss)}>
                {copied === 'css' ? '已复制 ✓' : '复制 CSS'}
              </button>
            </div>
            <pre className="vt__code">
              <code>{fullCss}</code>
            </pre>
          </section>

          {/* JS 触发代码输出（仅同文档模式） */}
          {jsCode && (
            <section className="vt__panel">
              <div className="vt__panel-head">
                <h3 className="vt__subtitle">JS 触发代码</h3>
                <button type="button" className="vt__copy-btn" onClick={() => handleCopy('js', jsCode)}>
                  {copied === 'js' ? '已复制 ✓' : '复制 JS'}
                </button>
              </div>
              <pre className="vt__code">
                <code>{jsCode}</code>
              </pre>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
