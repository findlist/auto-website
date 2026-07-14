import { useState, useMemo, useCallback, useEffect } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS @starting-style 入场动画生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - @starting-style 规则编辑（起始声明 + 最终声明）
 *  - transition 过渡配置（多属性 + 时长 + 缓动 + 延迟）
 *  - 三种触发场景：首次渲染 / display 切换 / popover 显示
 *  - 嵌套语法与独立语法双模式代码生成
 *  - transition-behavior: allow-discrete 支持（display 离散过渡）
 *  - 实时预览（触发入场动画）
 *  - 8 组预设效果
 *  - 智能代码生成，一键复制
 */

/** 单条样式声明 */
interface StyleDecl {
  id: string;
  property: string;
  value: string;
}

/** 单条过渡配置 */
interface TransitionItem {
  id: string;
  property: string;
  duration: number;
  timingFunction: string;
  delay: number;
}

/** 触发场景 */
type Scenario = 'first-render' | 'display-toggle' | 'popover-show';

/** 代码语法风格 */
type SyntaxStyle = 'nested' | 'standalone';

/** 完整配置 */
interface StartingStyleConfig {
  selector: string;
  scenario: Scenario;
  finalDecls: StyleDecl[];
  startingDecls: StyleDecl[];
  transitions: TransitionItem[];
  useDiscreteBehavior: boolean;
  syntaxStyle: SyntaxStyle;
}

/** 预设 */
interface StartingStylePreset {
  name: string;
  description: string;
  config: StartingStyleConfig;
}

// 模块级 id 生成器，保证 React key 稳定
let _idCounter = 0;
const genId = (): string => `ss_${Date.now().toString(36)}_${(++_idCounter).toString(36)}`;

// 工厂函数
const makeDecl = (property = '', value = ''): StyleDecl => ({ id: genId(), property, value });
const makeTransition = (property = 'opacity', duration = 0.3, timingFunction = 'ease', delay = 0): TransitionItem => ({
  id: genId(), property, duration, timingFunction, delay,
});

const TIMING_PRESETS = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'];

/** 生成 transition 简写值 */
function buildTransitionValue(transitions: TransitionItem[], useDiscrete: boolean): string {
  return transitions
    .filter(t => t.property)
    .map(t => {
      const parts = [t.property, `${t.duration}s`, t.timingFunction];
      if (t.delay > 0) parts.push(`${t.delay}s`);
      // display 属性需要 allow-discrete 才能离散过渡
      if (t.property === 'display' && useDiscrete) parts.push('allow-discrete');
      return parts.join(' ');
    })
    .join(', ');
}

/** 生成完整 CSS（嵌套语法） */
function buildNestedCss(config: StartingStyleConfig): string {
  const lines: string[] = [];
  const validFinal = config.finalDecls.filter(d => d.property && d.value);
  const validStart = config.startingDecls.filter(d => d.property && d.value);
  const transVal = buildTransitionValue(config.transitions, config.useDiscreteBehavior);

  lines.push(`${config.selector} {`);
  validFinal.forEach(d => lines.push(`  ${d.property}: ${d.value};`));
  if (transVal) lines.push(`  transition: ${transVal};`);
  if (validStart.length > 0) {
    lines.push('  @starting-style {');
    validStart.forEach(d => lines.push(`    ${d.property}: ${d.value};`));
    lines.push('  }');
  }
  lines.push('}');

  // display-toggle 场景额外生成隐藏状态
  if (config.scenario === 'display-toggle') {
    lines.push('');
    lines.push(`${config.selector}.hidden {`);
    validFinal.forEach(d => {
      const startDecl = validStart.find(s => s.property === d.property);
      lines.push(`  ${d.property}: ${startDecl ? startDecl.value : d.value};`);
    });
    lines.push('  display: none;');
    lines.push('}');
  }

  return lines.join('\n');
}

/** 生成完整 CSS（独立语法） */
function buildStandaloneCss(config: StartingStyleConfig): string {
  const lines: string[] = [];
  const validFinal = config.finalDecls.filter(d => d.property && d.value);
  const validStart = config.startingDecls.filter(d => d.property && d.value);
  const transVal = buildTransitionValue(config.transitions, config.useDiscreteBehavior);

  // 元素正常样式
  lines.push(`${config.selector} {`);
  validFinal.forEach(d => lines.push(`  ${d.property}: ${d.value};`));
  if (transVal) lines.push(`  transition: ${transVal};`);
  lines.push('}');

  // @starting-style 独立规则
  if (validStart.length > 0) {
    lines.push('');
    lines.push('@starting-style {');
    lines.push(`  ${config.selector} {`);
    validStart.forEach(d => lines.push(`    ${d.property}: ${d.value};`));
    lines.push('  }');
    lines.push('}');
  }

  // display-toggle 场景额外生成隐藏状态
  if (config.scenario === 'display-toggle') {
    lines.push('');
    lines.push(`${config.selector}.hidden {`);
    validFinal.forEach(d => {
      const startDecl = validStart.find(s => s.property === d.property);
      lines.push(`  ${d.property}: ${startDecl ? startDecl.value : d.value};`);
    });
    lines.push('  display: none;');
    lines.push('}');
  }

  return lines.join('\n');
}

/** 生成原理说明 */
function buildExplain(config: StartingStyleConfig): string {
  const scenarioText: Record<Scenario, string> = {
    'first-render': '元素首次渲染时（如动态插入 DOM），浏览器从 @starting-style 声明的起始样式过渡到最终样式。传统 transition 无法捕获首次渲染，@starting-style 填补了这一空白。',
    'display-toggle': 'display: none → block 切换时，元素"首次出现"。配合 transition-behavior: allow-discrete 让 display 属性可离散过渡，隐藏方向在过渡结束时才变 none，显示方向立即变 block。',
    'popover-show': 'popover 或 dialog 元素显示时触发入场动画。@starting-style 声明显示前的起始状态，浏览器从起始样式过渡到显示样式，实现弹层入场效果。',
  };
  return scenarioText[config.scenario];
}

// 默认配置
const makeDefaultConfig = (): StartingStyleConfig => ({
  selector: '.card',
  scenario: 'first-render',
  finalDecls: [makeDecl('opacity', '1'), makeDecl('transform', 'scale(1)')],
  startingDecls: [makeDecl('opacity', '0'), makeDecl('transform', 'scale(0.8)')],
  transitions: [makeTransition('opacity', 0.3, 'ease', 0), makeTransition('transform', 0.3, 'ease', 0)],
  useDiscreteBehavior: false,
  syntaxStyle: 'nested',
});

// 8 组预设，覆盖三种场景与常见入场效果
const PRESETS: StartingStylePreset[] = [
  {
    name: '淡入入场',
    description: '元素从透明到可见，最经典的首次渲染入场效果',
    config: {
      selector: '.card',
      scenario: 'first-render',
      finalDecls: [makeDecl('opacity', '1')],
      startingDecls: [makeDecl('opacity', '0')],
      transitions: [makeTransition('opacity', 0.4, 'ease-out', 0)],
      useDiscreteBehavior: false,
      syntaxStyle: 'nested',
    },
  },
  {
    name: '缩放弹入',
    description: '从 0.8 倍缩放到原始大小，带轻微回弹感',
    config: {
      selector: '.card',
      scenario: 'first-render',
      finalDecls: [makeDecl('opacity', '1'), makeDecl('transform', 'scale(1)')],
      startingDecls: [makeDecl('opacity', '0'), makeDecl('transform', 'scale(0.8)')],
      transitions: [makeTransition('opacity', 0.3, 'ease', 0), makeTransition('transform', 0.4, 'cubic-bezier(0.34, 1.56, 0.64, 1)', 0)],
      useDiscreteBehavior: false,
      syntaxStyle: 'nested',
    },
  },
  {
    name: '上方滑入',
    description: '从上方 20px 位置滑入到原位，配合淡入',
    config: {
      selector: '.card',
      scenario: 'first-render',
      finalDecls: [makeDecl('opacity', '1'), makeDecl('transform', 'translateY(0)')],
      startingDecls: [makeDecl('opacity', '0'), makeDecl('transform', 'translateY(-20px)')],
      transitions: [makeTransition('opacity', 0.3, 'ease', 0), makeTransition('transform', 0.3, 'ease-out', 0)],
      useDiscreteBehavior: false,
      syntaxStyle: 'nested',
    },
  },
  {
    name: 'display 切换淡入',
    description: 'display: none → block 切换时淡入，需要 allow-discrete',
    config: {
      selector: '.panel',
      scenario: 'display-toggle',
      finalDecls: [makeDecl('opacity', '1')],
      startingDecls: [makeDecl('opacity', '0')],
      transitions: [makeTransition('opacity', 0.3, 'ease', 0), makeTransition('display', 0.3, 'ease', 0)],
      useDiscreteBehavior: true,
      syntaxStyle: 'nested',
    },
  },
  {
    name: 'display 切换缩放',
    description: 'display 切换时缩放 + 淡入，折叠面板经典效果',
    config: {
      selector: '.panel',
      scenario: 'display-toggle',
      finalDecls: [makeDecl('opacity', '1'), makeDecl('transform', 'scale(1)')],
      startingDecls: [makeDecl('opacity', '0'), makeDecl('transform', 'scale(0.95)')],
      transitions: [makeTransition('opacity', 0.2, 'ease', 0), makeTransition('transform', 0.2, 'ease', 0), makeTransition('display', 0.2, 'ease', 0)],
      useDiscreteBehavior: true,
      syntaxStyle: 'nested',
    },
  },
  {
    name: 'popover 弹出',
    description: 'popover 元素显示时从 0.9 缩放弹入，弹层入场效果',
    config: {
      selector: '[popover]',
      scenario: 'popover-show',
      finalDecls: [makeDecl('opacity', '1'), makeDecl('transform', 'scale(1)')],
      startingDecls: [makeDecl('opacity', '0'), makeDecl('transform', 'scale(0.9)')],
      transitions: [makeTransition('opacity', 0.2, 'ease', 0), makeTransition('transform', 0.2, 'ease-out', 0), makeTransition('display', 0.2, 'ease', 0)],
      useDiscreteBehavior: true,
      syntaxStyle: 'nested',
    },
  },
  {
    name: '卡片展开',
    description: 'opacity + translateY 组合，卡片展开式入场',
    config: {
      selector: '.card',
      scenario: 'first-render',
      finalDecls: [makeDecl('opacity', '1'), makeDecl('transform', 'translateY(0) scale(1)')],
      startingDecls: [makeDecl('opacity', '0'), makeDecl('transform', 'translateY(30px) scale(0.95)')],
      transitions: [makeTransition('opacity', 0.5, 'ease', 0), makeTransition('transform', 0.5, 'cubic-bezier(0.16, 1, 0.3, 1)', 0)],
      useDiscreteBehavior: false,
      syntaxStyle: 'nested',
    },
  },
  {
    name: '默认示例',
    description: 'opacity + transform 双属性入场，展示基础配置',
    config: makeDefaultConfig(),
  },
];

/** 预览区组件：注入 CSS 并触发入场动画 */
function PreviewArea({ config }: { config: StartingStyleConfig }) {
  const [triggerKey, setTriggerKey] = useState(0);
  const [isHidden, setIsHidden] = useState(true);
  const previewStyleId = 'starting-style-preview-css';

  // 注入预览用的 CSS（@starting-style 必须通过 CSS 规则声明，不能用 inline style）
  useEffect(() => {
    const existing = document.getElementById(previewStyleId);
    if (existing) existing.remove();

    const validFinal = config.finalDecls.filter(d => d.property && d.value);
    const validStart = config.startingDecls.filter(d => d.property && d.value);
    const transVal = buildTransitionValue(config.transitions, config.useDiscreteBehavior);
    const target = '#preview-target';

    const lines: string[] = [];
    lines.push(`${target} {`);
    validFinal.forEach(d => lines.push(`  ${d.property}: ${d.value};`));
    if (transVal) lines.push(`  transition: ${transVal};`);
    if (validStart.length > 0) {
      lines.push('  @starting-style {');
      validStart.forEach(d => lines.push(`    ${d.property}: ${d.value};`));
      lines.push('  }');
    }
    lines.push('}');

    if (config.scenario === 'display-toggle') {
      lines.push(`${target}.hidden { display: none;`);
      validFinal.forEach(d => {
        const startDecl = validStart.find(s => s.property === d.property);
        lines.push(`  ${d.property}: ${startDecl ? startDecl.value : d.value};`);
      });
      lines.push('}');
    }

    const style = document.createElement('style');
    style.id = previewStyleId;
    style.textContent = lines.join('\n');
    document.head.appendChild(style);

    return () => {
      const el = document.getElementById(previewStyleId);
      if (el) el.remove();
    };
  }, [config]);

  const handleTrigger = useCallback(() => {
    if (config.scenario === 'first-render') {
      // 重新挂载元素，触发首次渲染动画
      setTriggerKey(k => k + 1);
    } else if (config.scenario === 'display-toggle') {
      setIsHidden(h => !h);
    } else if (config.scenario === 'popover-show') {
      const el = document.getElementById('preview-target');
      if (el?.matches(':popover-open')) {
        (el as HTMLDivElement).hidePopover?.();
      } else {
        (el as HTMLDivElement).showPopover?.();
      }
    }
  }, [config.scenario]);

  const scenarioLabel: Record<Scenario, string> = {
    'first-render': '触发入场',
    'display-toggle': isHidden ? '显示元素' : '隐藏元素',
    'popover-show': '切换 popover',
  };

  return (
    <div className="ss-preview">
      <div className="ss-preview__stage">
        {config.scenario === 'popover-show' ? (
          <div
            id="preview-target"
            // popover 属性让元素支持 Popover API
            {...({ popover: 'manual' } as Record<string, string>)}
            className="ss-preview__target"
          >
            预览元素
          </div>
        ) : (
          <div
            key={triggerKey}
            id="preview-target"
            className={`ss-preview__target${config.scenario === 'display-toggle' && isHidden ? ' hidden' : ''}`}
          >
            预览元素
          </div>
        )}
      </div>
      <button type="button" className="ss-preview__btn" onClick={handleTrigger}>
        {scenarioLabel[config.scenario]}
      </button>
      <p className="ss-preview__hint">
        {config.scenario === 'first-render' && '点击按钮重新挂载元素，触发 @starting-style 首次渲染入场动画'}
        {config.scenario === 'display-toggle' && '点击按钮切换 display: none ↔ block，配合 allow-discrete 实现双向过渡'}
        {config.scenario === 'popover-show' && '点击按钮切换 popover 显示状态，触发 @starting-style 弹层入场'}
      </p>
    </div>
  );
}

/** 泛型分段按钮组 */
function SegGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="ss-seg">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          className={`ss-seg__btn${opt.value === value ? ' is-active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** 样式声明编辑器 */
function DeclEditor({
  title,
  decls,
  onChange,
}: {
  title: string;
  decls: StyleDecl[];
  onChange: (decls: StyleDecl[]) => void;
}) {
  const handleUpdate = (id: string, field: 'property' | 'value', val: string) => {
    onChange(decls.map(d => (d.id === id ? { ...d, [field]: val } : d)));
  };
  const handleAdd = () => onChange([...decls, makeDecl()]);
  const handleRemove = (id: string) => onChange(decls.filter(d => d.id !== id));

  return (
    <div className="ss-decls">
      <div className="ss-decls__header">
        <span className="ss-decls__title">{title}</span>
        <button type="button" className="ss-decls__add" onClick={handleAdd}>+ 添加</button>
      </div>
      {decls.map(d => (
        <div key={d.id} className="ss-decl">
          <input
            className="ss-decl__prop"
            type="text"
            placeholder="属性名"
            value={d.property}
            onChange={e => handleUpdate(d.id, 'property', e.target.value)}
          />
          <input
            className="ss-decl__val"
            type="text"
            placeholder="值"
            value={d.value}
            onChange={e => handleUpdate(d.id, 'value', e.target.value)}
          />
          <button type="button" className="ss-decl__del" onClick={() => handleRemove(d.id)}>删除</button>
        </div>
      ))}
    </div>
  );
}

/** 主组件 */
export default function StartingStyleTool() {
  const [config, setConfig] = useState<StartingStyleConfig>(makeDefaultConfig);
  const [copied, setCopied] = useState(false);

  const cssCode = useMemo(() => {
    return config.syntaxStyle === 'nested' ? buildNestedCss(config) : buildStandaloneCss(config);
  }, [config]);

  const explain = useMemo(() => buildExplain(config), [config]);

  const handleCopy = useCallback(async () => {
    const ok = await copyText(cssCode);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 1500);
  }, [cssCode]);

  const applyPreset = useCallback((preset: StartingStylePreset) => {
    // 深拷贝预设配置，避免共享引用
    setConfig({
      ...preset.config,
      finalDecls: preset.config.finalDecls.map(d => ({ ...d, id: genId() })),
      startingDecls: preset.config.startingDecls.map(d => ({ ...d, id: genId() })),
      transitions: preset.config.transitions.map(t => ({ ...t, id: genId() })),
    });
  }, []);

  // 更新工具函数
  const updateConfig = <K extends keyof StartingStyleConfig>(key: K, value: StartingStyleConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  // 场景切换时自动调整 useDiscreteBehavior
  const handleScenarioChange = (scenario: Scenario) => {
    setConfig(prev => ({
      ...prev,
      scenario,
      // display-toggle 和 popover-show 场景需要 allow-discrete
      useDiscreteBehavior: scenario === 'display-toggle' || scenario === 'popover-show',
    }));
  };

  return (
    <div className="ss-tool">
      {/* 预设按钮组 */}
      <div className="ss-presets">
        {PRESETS.map(p => (
          <button
            key={p.name}
            type="button"
            className="ss-preset-btn"
            title={p.description}
            onClick={() => applyPreset(p)}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="ss-layout">
        {/* 左栏：配置面板 */}
        <div className="ss-panel">
          {/* 选择器 + 场景 */}
          <div className="ss-field">
            <label className="ss-label">目标选择器</label>
            <input
              className="ss-input"
              type="text"
              value={config.selector}
              onChange={e => updateConfig('selector', e.target.value)}
              placeholder=".card"
            />
          </div>

          <div className="ss-field">
            <label className="ss-label">触发场景</label>
            <SegGroup<Scenario>
              options={[
                { value: 'first-render', label: '首次渲染' },
                { value: 'display-toggle', label: 'display 切换' },
                { value: 'popover-show', label: 'popover 显示' },
              ]}
              value={config.scenario}
              onChange={handleScenarioChange}
            />
          </div>

          <div className="ss-field">
            <label className="ss-label">代码语法</label>
            <SegGroup<SyntaxStyle>
              options={[
                { value: 'nested', label: '嵌套语法（推荐）' },
                { value: 'standalone', label: '独立语法' },
              ]}
              value={config.syntaxStyle}
              onChange={v => updateConfig('syntaxStyle', v)}
            />
          </div>

          {/* 最终声明编辑器 */}
          <DeclEditor
            title="元素最终样式"
            decls={config.finalDecls}
            onChange={decls => updateConfig('finalDecls', decls)}
          />

          {/* 起始声明编辑器 */}
          <DeclEditor
            title="@starting-style 起始样式"
            decls={config.startingDecls}
            onChange={decls => updateConfig('startingDecls', decls)}
          />

          {/* transition 配置 */}
          <div className="ss-transitions">
            <div className="ss-decls__header">
              <span className="ss-decls__title">transition 过渡配置</span>
              <button
                type="button"
                className="ss-decls__add"
                onClick={() => updateConfig('transitions', [...config.transitions, makeTransition()])}
              >
                + 添加
              </button>
            </div>
            {config.transitions.map(t => (
              <div key={t.id} className="ss-trans">
                <input
                  className="ss-trans__prop"
                  type="text"
                  placeholder="属性"
                  value={t.property}
                  onChange={e => updateConfig('transitions', config.transitions.map(item => item.id === t.id ? { ...item, property: e.target.value } : item))}
                />
                <label className="ss-trans__label">时长</label>
                <input
                  className="ss-trans__num"
                  type="number"
                  step="0.1"
                  min="0"
                  value={t.duration}
                  onChange={e => updateConfig('transitions', config.transitions.map(item => item.id === t.id ? { ...item, duration: Number(e.target.value) } : item))}
                />
                <span className="ss-trans__unit">s</span>
                <select
                  className="ss-trans__select"
                  value={t.timingFunction}
                  onChange={e => updateConfig('transitions', config.transitions.map(item => item.id === t.id ? { ...item, timingFunction: e.target.value } : item))}
                >
                  {TIMING_PRESETS.map(fn => <option key={fn} value={fn}>{fn}</option>)}
                  <option value="cubic-bezier(0.34, 1.56, 0.64, 1)">回弹</option>
                  <option value="cubic-bezier(0.16, 1, 0.3, 1)">平滑出</option>
                </select>
                <label className="ss-trans__label">延迟</label>
                <input
                  className="ss-trans__num"
                  type="number"
                  step="0.1"
                  min="0"
                  value={t.delay}
                  onChange={e => updateConfig('transitions', config.transitions.map(item => item.id === t.id ? { ...item, delay: Number(e.target.value) } : item))}
                />
                <span className="ss-trans__unit">s</span>
                <button
                  type="button"
                  className="ss-decl__del"
                  onClick={() => updateConfig('transitions', config.transitions.filter(item => item.id !== t.id))}
                >
                  删除
                </button>
              </div>
            ))}
          </div>

          {/* display 离散过渡开关 */}
          <div className="ss-field ss-field--toggle">
            <label className="ss-label">transition-behavior: allow-discrete</label>
            <button
              type="button"
              className={`ss-toggle${config.useDiscreteBehavior ? ' is-on' : ''}`}
              onClick={() => updateConfig('useDiscreteBehavior', !config.useDiscreteBehavior)}
              aria-pressed={config.useDiscreteBehavior}
            >
              {config.useDiscreteBehavior ? '已启用' : '已关闭'}
            </button>
          </div>
          {(config.scenario === 'display-toggle' || config.scenario === 'popover-show') && !config.useDiscreteBehavior && (
            <p className="ss-warn">提示：display 切换场景建议启用 allow-discrete，否则 display 属性不会参与过渡</p>
          )}
        </div>

        {/* 右栏：预览 + 原理 + 代码 */}
        <div className="ss-output">
          {/* 预览区 */}
          <PreviewArea config={config} />

          {/* 原理说明 */}
          <div className="ss-explain">
            <h3 className="ss-explain__title">原理说明</h3>
            <p className="ss-explain__text">{explain}</p>
            <ul className="ss-explain__tips">
              <li>@starting-style 声明元素"首次出现"时的起始样式，浏览器从起始样式过渡到最终样式</li>
              <li>传统 transition 仅在属性值变化时触发，无法捕获首次渲染与 display 切换</li>
              <li>display-toggle 场景需要 transition-behavior: allow-discrete 才能让 display 参与过渡</li>
              <li>嵌套语法更简洁（需浏览器支持 CSS nesting），独立语法兼容性更好</li>
            </ul>
          </div>

          {/* 代码输出 */}
          <div className="ss-code">
            <div className="ss-code__header">
              <span className="ss-code__title">生成的 CSS</span>
              <button type="button" className="ss-code__copy" onClick={handleCopy}>
                {copied ? '已复制' : '复制代码'}
              </button>
            </div>
            <pre className="ss-code__pre"><code>{cssCode}</code></pre>
          </div>
        </div>
      </div>
    </div>
  );
}
