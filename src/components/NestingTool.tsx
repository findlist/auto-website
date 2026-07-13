import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS nesting 原生嵌套生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 根选择器 + 根声明编辑
 *  - 子规则列表：支持选择器嵌套（.child / &:hover / &.active）与 @media 嵌套
 *  - @media 规则内部可继续嵌套选择器规则（两层嵌套演示）
 *  - 实时生成原生嵌套 CSS 代码（浏览器 2023 起原生支持）
 *  - iframe 隔离预览，可编辑 HTML，实时应用嵌套 CSS
 *  - 8 组预设（卡片 / 按钮 / 响应式 / 导航 / 表单 / 列表 / 工具提示 / 默认）
 */

/** 单条 CSS 声明：property: value; */
interface CssDecl {
  id: string;
  property: string;
  value: string;
}

/** 嵌套规则：选择器 + 声明 + 可选子规则（用于 @media 内嵌套） */
interface NestRule {
  id: string;
  /** 选择器或 at-rule，如 '.title' / '&:hover' / '@media (max-width: 768px)' */
  selector: string;
  declarations: CssDecl[];
  /** 子规则：仅 @media 规则下使用，演示嵌套 at-rule 内的选择器 */
  children: NestRule[];
}

/** 完整嵌套配置 */
interface NestingConfig {
  rootSelector: string;
  rootDeclarations: CssDecl[];
  rules: NestRule[];
}

/** 预设：配置 + 预览 HTML */
interface NestingPreset {
  name: string;
  config: NestingConfig;
  previewHtml: string;
}

// 模块级 id 生成器，保证 React key 稳定唯一
let _idCounter = 0;
const genId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${(++_idCounter).toString(36)}`;

/** 创建一条 CSS 声明 */
const makeDecl = (property: string, value: string): CssDecl => ({
  id: genId('decl'),
  property,
  value,
});

/** 创建一条嵌套规则 */
const makeRule = (selector: string, declarations: CssDecl[] = [], children: NestRule[] = []): NestRule => ({
  id: genId('rule'),
  selector,
  declarations,
  children,
});

/** 判断选择器是否为 @media 等 at-rule */
const isAtRule = (selector: string): boolean => selector.trim().startsWith('@');

// 8 组预设，覆盖 nesting 最常见应用场景
const PRESETS: NestingPreset[] = [
  {
    name: '卡片组件',
    previewHtml: `<div class="card">
  <h3 class="title">卡片标题</h3>
  <p class="body">这是一段卡片正文内容，鼠标悬停卡片查看效果。</p>
</div>`,
    config: {
      rootSelector: '.card',
      rootDeclarations: [
        makeDecl('padding', '24px'),
        makeDecl('border-radius', '12px'),
        makeDecl('background', '#ffffff'),
        makeDecl('box-shadow', '0 2px 8px rgba(0,0,0,0.08)'),
        makeDecl('transition', 'transform 0.2s, box-shadow 0.2s'),
      ],
      rules: [
        makeRule('.title', [makeDecl('font-size', '18px'), makeDecl('font-weight', '600'), makeDecl('margin', '0 0 8px')]),
        makeRule('.body', [makeDecl('color', '#555'), makeDecl('line-height', '1.6'), makeDecl('margin', '0')]),
        makeRule('&:hover', [makeDecl('transform', 'translateY(-2px)'), makeDecl('box-shadow', '0 8px 24px rgba(0,0,0,0.12)')]),
      ],
    },
  },
  {
    name: '按钮状态',
    previewHtml: `<button class="btn">点击按钮</button>
<button class="btn" disabled>禁用按钮</button>`,
    config: {
      rootSelector: '.btn',
      rootDeclarations: [
        makeDecl('padding', '10px 20px'),
        makeDecl('border', 'none'),
        makeDecl('border-radius', '8px'),
        makeDecl('background', '#2563eb'),
        makeDecl('color', '#fff'),
        makeDecl('font-size', '14px'),
        makeDecl('cursor', 'pointer'),
        makeDecl('transition', 'all 0.15s'),
      ],
      rules: [
        makeRule('&:hover', [makeDecl('background', '#1d4ed8')]),
        makeRule('&:active', [makeDecl('transform', 'scale(0.96)')]),
        makeRule('&:disabled', [makeDecl('opacity', '0.5'), makeDecl('cursor', 'not-allowed')]),
      ],
    },
  },
  {
    name: '响应式卡片',
    previewHtml: `<div class="card">
  <h3 class="title">响应式标题</h3>
  <p class="body">缩窄窗口查看响应式效果（768px 断点）。</p>
</div>`,
    config: {
      rootSelector: '.card',
      rootDeclarations: [
        makeDecl('padding', '32px'),
        makeDecl('border-radius', '12px'),
        makeDecl('background', '#f0fdf4'),
      ],
      rules: [
        makeRule('.title', [makeDecl('font-size', '24px'), makeDecl('margin', '0 0 12px')]),
        makeRule('@media (max-width: 768px)', [makeDecl('padding', '16px')], [
          makeRule('.title', [makeDecl('font-size', '18px')]),
        ]),
      ],
    },
  },
  {
    name: '导航菜单',
    previewHtml: `<nav class="nav">
  <a class="item active" href="#">首页</a>
  <a class="item" href="#">产品</a>
  <a class="item" href="#">关于</a>
</nav>`,
    config: {
      rootSelector: '.nav',
      rootDeclarations: [makeDecl('display', 'flex'), makeDecl('gap', '8px'), makeDecl('background', '#1f2937'), makeDecl('padding', '12px'), makeDecl('border-radius', '8px')],
      rules: [
        makeRule('.item', [makeDecl('color', '#d1d5db'), makeDecl('text-decoration', 'none'), makeDecl('padding', '6px 14px'), makeDecl('border-radius', '6px'), makeDecl('transition', 'color 0.15s, background 0.15s')]),
        makeRule('&.active', [makeDecl('color', '#fff'), makeDecl('background', '#2563eb')]),
      ],
    },
  },
  {
    name: '表单输入',
    previewHtml: `<input class="input" placeholder="正常状态" />
<input class="input error" placeholder="错误状态" />`,
    config: {
      rootSelector: '.input',
      rootDeclarations: [
        makeDecl('display', 'block'),
        makeDecl('width', '100%'),
        makeDecl('padding', '10px 12px'),
        makeDecl('border', '1px solid #d1d5db'),
        makeDecl('border-radius', '8px'),
        makeDecl('font-size', '14px'),
        makeDecl('outline', 'none'),
        makeDecl('transition', 'border-color 0.15s, box-shadow 0.15s'),
        makeDecl('margin-bottom', '8px'),
        makeDecl('box-sizing', 'border-box'),
      ],
      rules: [
        makeRule('&:focus', [makeDecl('border-color', '#2563eb'), makeDecl('box-shadow', '0 0 0 3px rgba(37,99,235,0.15)')]),
        makeRule('&.error', [makeDecl('border-color', '#dc2626')]),
      ],
    },
  },
  {
    name: '列表条纹',
    previewHtml: `<ul class="list">
  <li class="item">第一项</li>
  <li class="item">第二项</li>
  <li class="item">第三项</li>
  <li class="item">第四项</li>
</ul>`,
    config: {
      rootSelector: '.list',
      rootDeclarations: [makeDecl('list-style', 'none'), makeDecl('padding', '0'), makeDecl('margin', '0'), makeDecl('border-radius', '8px'), makeDecl('overflow', 'hidden')],
      rules: [
        makeRule('.item', [makeDecl('padding', '12px 16px'), makeDecl('border-bottom', '1px solid #e5e7eb')]),
        makeRule('&:nth-child(even)', [makeDecl('background', '#f9fafb')]),
        makeRule('&:last-child', [makeDecl('border-bottom', 'none')]),
      ],
    },
  },
  {
    name: '工具提示',
    previewHtml: `<div class="tooltip">
  悬停查看提示
  <span class="content">这是提示文字</span>
</div>`,
    config: {
      rootSelector: '.tooltip',
      rootDeclarations: [makeDecl('position', 'relative'), makeDecl('display', 'inline-block'), makeDecl('cursor', 'help'), makeDecl('border-bottom', '1px dashed #6b7280')],
      rules: [
        makeRule('.content', [makeDecl('position', 'absolute'), makeDecl('bottom', '125%'), makeDecl('left', '50%'), makeDecl('transform', 'translateX(-50%)'), makeDecl('background', '#111827'), makeDecl('color', '#fff'), makeDecl('padding', '6px 10px'), makeDecl('border-radius', '6px'), makeDecl('font-size', '12px'), makeDecl('white-space', 'nowrap'), makeDecl('opacity', '0'), makeDecl('pointer-events', 'none'), makeDecl('transition', 'opacity 0.15s')]),
        makeRule('&:hover .content', [makeDecl('opacity', '1')]),
      ],
    },
  },
  {
    name: '默认示例',
    previewHtml: `<div class="parent">
  父元素
  <div class="child">子元素</div>
</div>`,
    config: {
      rootSelector: '.parent',
      rootDeclarations: [makeDecl('padding', '20px'), makeDecl('background', '#eef2ff'), makeDecl('border-radius', '8px'), makeDecl('color', '#1e40af'), makeDecl('transition', 'background 0.2s')],
      rules: [
        makeRule('.child', [makeDecl('margin-top', '8px'), makeDecl('padding', '12px'), makeDecl('background', '#c7d2fe'), makeDecl('border-radius', '6px'), makeDecl('color', '#3730a3')]),
        makeRule('&:hover', [makeDecl('background', '#e0e7ff')]),
      ],
    },
  },
];

/** 默认配置（与"默认示例"预设一致） */
const DEFAULT_CONFIG: NestingConfig = PRESETS[PRESETS.length - 1].config;
const DEFAULT_HTML: string = PRESETS[PRESETS.length - 1].previewHtml;

/**
 * 递归生成嵌套 CSS 文本
 * @param indent 缩进层级（每级 2 空格）
 */
function buildRuleLines(rule: NestRule, indent: number): string[] {
  const pad = '  '.repeat(indent);
  const lines: string[] = [];
  lines.push(`${pad}${rule.selector} {`);
  rule.declarations.forEach((d) => {
    if (d.property.trim() && d.value.trim()) {
      lines.push(`${pad}  ${d.property}: ${d.value};`);
    }
  });
  rule.children.forEach((child) => {
    lines.push('');
    lines.push(...buildRuleLines(child, indent + 1));
  });
  lines.push(`${pad}}`);
  return lines;
}

/** 生成完整的嵌套 CSS 文本 */
function buildNestedCss(config: NestingConfig): string {
  const lines: string[] = [];
  lines.push(`${config.rootSelector} {`);
  config.rootDeclarations.forEach((d) => {
    if (d.property.trim() && d.value.trim()) {
      lines.push(`  ${d.property}: ${d.value};`);
    }
  });
  config.rules.forEach((rule, i) => {
    if (i > 0 || config.rootDeclarations.some((d) => d.property.trim() && d.value.trim())) {
      lines.push('');
    }
    lines.push(...buildRuleLines(rule, 1));
  });
  lines.push('}');
  return lines.join('\n');
}

/** 单条声明编辑行 */
function DeclRow({
  decl,
  onChange,
  onRemove,
}: {
  decl: CssDecl;
  onChange: (property: string, value: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="nst__decl">
      <input
        className="nst__decl-prop"
        type="text"
        value={decl.property}
        placeholder="属性"
        onChange={(e) => onChange(e.target.value, decl.value)}
      />
      <span className="nst__decl-colon">:</span>
      <input
        className="nst__decl-val"
        type="text"
        value={decl.value}
        placeholder="值"
        onChange={(e) => onChange(decl.property, e.target.value)}
      />
      <button type="button" className="nst__btn nst__btn--del" onClick={onRemove} aria-label="删除该声明">
        ×
      </button>
    </div>
  );
}

/** 声明列表编辑区（带新增按钮） */
function DeclList({
  declarations,
  onAdd,
  onUpdate,
  onRemove,
}: {
  declarations: CssDecl[];
  onAdd: () => void;
  onUpdate: (id: string, property: string, value: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="nst__decls">
      {declarations.map((d) => (
        <DeclRow
          key={d.id}
          decl={d}
          onChange={(p, v) => onUpdate(d.id, p, v)}
          onRemove={() => onRemove(d.id)}
        />
      ))}
      <button type="button" className="nst__btn nst__btn--add-decl" onClick={onAdd}>
        + 添加声明
      </button>
    </div>
  );
}

export default function NestingTool() {
  const [config, setConfig] = useState<NestingConfig>(() => ({
    rootSelector: DEFAULT_CONFIG.rootSelector,
    rootDeclarations: DEFAULT_CONFIG.rootDeclarations.map((d) => ({ ...d, id: genId('decl') })),
    rules: DEFAULT_CONFIG.rules.map((r) => ({
      ...r,
      id: genId('rule'),
      declarations: r.declarations.map((d) => ({ ...d, id: genId('decl') })),
      children: r.children.map((c) => ({
        ...c,
        id: genId('rule'),
        declarations: c.declarations.map((d) => ({ ...d, id: genId('decl') })),
      })),
    })),
  }));
  const [previewHtml, setPreviewHtml] = useState<string>(DEFAULT_HTML);
  const [copied, setCopied] = useState(false);

  // 生成的嵌套 CSS
  const nestedCss = useMemo(() => buildNestedCss(config), [config]);

  // 预览 iframe 的 srcDoc（注入嵌套 CSS + 用户 HTML）
  const previewSrcDoc = useMemo(
    () =>
      `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body { font-family: -apple-system, system-ui, sans-serif; padding: 16px; margin: 0; color: #111827; }
        ${nestedCss}
      </style></head><body>${previewHtml}</body></html>`,
    [nestedCss, previewHtml],
  );

  // 应用预设
  const applyPreset = useCallback((preset: NestingPreset) => {
    setConfig({
      rootSelector: preset.config.rootSelector,
      rootDeclarations: preset.config.rootDeclarations.map((d) => ({ ...d, id: genId('decl') })),
      rules: preset.config.rules.map((r) => ({
        ...r,
        id: genId('rule'),
        declarations: r.declarations.map((d) => ({ ...d, id: genId('decl') })),
        children: r.children.map((c) => ({
          ...c,
          id: genId('rule'),
          declarations: c.declarations.map((d) => ({ ...d, id: genId('decl') })),
        })),
      })),
    });
    setPreviewHtml(preset.previewHtml);
  }, []);

  // 根选择器修改
  const updateRootSelector = useCallback((selector: string) => {
    setConfig((prev) => ({ ...prev, rootSelector: selector }));
  }, []);

  // 根声明增删改
  const addRootDecl = useCallback(() => {
    setConfig((prev) => ({
      ...prev,
      rootDeclarations: [...prev.rootDeclarations, makeDecl('', '')],
    }));
  }, []);
  const updateRootDecl = useCallback((id: string, property: string, value: string) => {
    setConfig((prev) => ({
      ...prev,
      rootDeclarations: prev.rootDeclarations.map((d) => (d.id === id ? { ...d, property, value } : d)),
    }));
  }, []);
  const removeRootDecl = useCallback((id: string) => {
    setConfig((prev) => ({ ...prev, rootDeclarations: prev.rootDeclarations.filter((d) => d.id !== id) }));
  }, []);

  // 子规则增删改（顶层）
  const addRule = useCallback(() => {
    setConfig((prev) => ({ ...prev, rules: [...prev.rules, makeRule('&:hover')] }));
  }, []);
  const removeRule = useCallback((id: string) => {
    setConfig((prev) => ({ ...prev, rules: prev.rules.filter((r) => r.id !== id) }));
  }, []);
  const updateRuleSelector = useCallback((id: string, selector: string) => {
    setConfig((prev) => ({
      ...prev,
      rules: prev.rules.map((r) => (r.id === id ? { ...r, selector } : r)),
    }));
  }, []);
  const addRuleDecl = useCallback((id: string) => {
    setConfig((prev) => ({
      ...prev,
      rules: prev.rules.map((r) => (r.id === id ? { ...r, declarations: [...r.declarations, makeDecl('', '')] } : r)),
    }));
  }, []);
  const updateRuleDecl = useCallback((ruleId: string, declId: string, property: string, value: string) => {
    setConfig((prev) => ({
      ...prev,
      rules: prev.rules.map((r) =>
        r.id === ruleId
          ? { ...r, declarations: r.declarations.map((d) => (d.id === declId ? { ...d, property, value } : d)) }
          : r,
      ),
    }));
  }, []);
  const removeRuleDecl = useCallback((ruleId: string, declId: string) => {
    setConfig((prev) => ({
      ...prev,
      rules: prev.rules.map((r) =>
        r.id === ruleId ? { ...r, declarations: r.declarations.filter((d) => d.id !== declId) } : r,
      ),
    }));
  }, []);

  // @media 内嵌套子规则（仅 @media 规则下使用）
  const addChildRule = useCallback((parentId: string) => {
    setConfig((prev) => ({
      ...prev,
      rules: prev.rules.map((r) =>
        r.id === parentId ? { ...r, children: [...r.children, makeRule('.child')] } : r,
      ),
    }));
  }, []);
  const removeChildRule = useCallback((parentId: string, childId: string) => {
    setConfig((prev) => ({
      ...prev,
      rules: prev.rules.map((r) =>
        r.id === parentId ? { ...r, children: r.children.filter((c) => c.id !== childId) } : r,
      ),
    }));
  }, []);
  const updateChildRuleSelector = useCallback((parentId: string, childId: string, selector: string) => {
    setConfig((prev) => ({
      ...prev,
      rules: prev.rules.map((r) =>
        r.id === parentId
          ? { ...r, children: r.children.map((c) => (c.id === childId ? { ...c, selector } : c)) }
          : r,
      ),
    }));
  }, []);
  const addChildRuleDecl = useCallback((parentId: string, childId: string) => {
    setConfig((prev) => ({
      ...prev,
      rules: prev.rules.map((r) =>
        r.id === parentId
          ? {
              ...r,
              children: r.children.map((c) =>
                c.id === childId ? { ...c, declarations: [...c.declarations, makeDecl('', '')] } : c,
              ),
            }
          : r,
      ),
    }));
  }, []);
  const updateChildRuleDecl = useCallback(
    (parentId: string, childId: string, declId: string, property: string, value: string) => {
      setConfig((prev) => ({
        ...prev,
        rules: prev.rules.map((r) =>
          r.id === parentId
            ? {
                ...r,
                children: r.children.map((c) =>
                  c.id === childId
                    ? { ...c, declarations: c.declarations.map((d) => (d.id === declId ? { ...d, property, value } : d)) }
                    : c,
                ),
              }
            : r,
        ),
      }));
    },
    [],
  );
  const removeChildRuleDecl = useCallback((parentId: string, childId: string, declId: string) => {
    setConfig((prev) => ({
      ...prev,
      rules: prev.rules.map((r) =>
        r.id === parentId
          ? {
              ...r,
              children: r.children.map((c) =>
                c.id === childId ? { ...c, declarations: c.declarations.filter((d) => d.id !== declId) } : c,
              ),
            }
          : r,
      ),
    }));
  }, []);

  // 复制 CSS
  const handleCopy = useCallback(async () => {
    const ok = await copyText(nestedCss);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [nestedCss]);

  return (
    <div className="nst">
      {/* 预设按钮组 */}
      <div className="nst__presets">
        <span className="nst__presets-label">预设：</span>
        {PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            className="nst__btn nst__btn--preset"
            onClick={() => applyPreset(p)}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="nst__main">
        {/* 左侧：配置编辑 */}
        <div className="nst__editor">
          {/* 根选择器 */}
          <div className="nst__panel">
            <div className="nst__panel-head">
              <span className="nst__panel-title">根选择器</span>
            </div>
            <input
              className="nst__selector-input"
              type="text"
              value={config.rootSelector}
              onChange={(e) => updateRootSelector(e.target.value)}
              placeholder=".parent"
            />
            <DeclList
              declarations={config.rootDeclarations}
              onAdd={addRootDecl}
              onUpdate={updateRootDecl}
              onRemove={removeRootDecl}
            />
          </div>

          {/* 子规则列表 */}
          <div className="nst__panel">
            <div className="nst__panel-head">
              <span className="nst__panel-title">嵌套规则（{config.rules.length}）</span>
              <button type="button" className="nst__btn nst__btn--add" onClick={addRule}>
                + 添加规则
              </button>
            </div>
            <div className="nst__rules">
              {config.rules.map((rule) => {
                const media = isAtRule(rule.selector);
                return (
                  <div key={rule.id} className="nst__rule">
                    <div className="nst__rule-head">
                      <input
                        className="nst__selector-input"
                        type="text"
                        value={rule.selector}
                        onChange={(e) => updateRuleSelector(rule.id, e.target.value)}
                        placeholder={media ? '@media (max-width: 768px)' : '.child / &:hover'}
                      />
                      <button
                        type="button"
                        className="nst__btn nst__btn--del"
                        onClick={() => removeRule(rule.id)}
                        aria-label="删除该规则"
                      >
                        删除规则
                      </button>
                    </div>
                    <DeclList
                      declarations={rule.declarations}
                      onAdd={() => addRuleDecl(rule.id)}
                      onUpdate={(declId, p, v) => updateRuleDecl(rule.id, declId, p, v)}
                      onRemove={(declId) => removeRuleDecl(rule.id, declId)}
                    />
                    {media && (
                      <div className="nst__children">
                        <div className="nst__children-head">
                          <span className="nst__children-title">@media 内嵌套规则（{rule.children.length}）</span>
                          <button
                            type="button"
                            className="nst__btn nst__btn--add-child"
                            onClick={() => addChildRule(rule.id)}
                          >
                            + 添加嵌套规则
                          </button>
                        </div>
                        {rule.children.map((child) => (
                          <div key={child.id} className="nst__rule nst__rule--child">
                            <div className="nst__rule-head">
                              <input
                                className="nst__selector-input"
                                type="text"
                                value={child.selector}
                                onChange={(e) => updateChildRuleSelector(rule.id, child.id, e.target.value)}
                                placeholder=".child / &:hover"
                              />
                              <button
                                type="button"
                                className="nst__btn nst__btn--del"
                                onClick={() => removeChildRule(rule.id, child.id)}
                                aria-label="删除嵌套规则"
                              >
                                删除
                              </button>
                            </div>
                            <DeclList
                              declarations={child.declarations}
                              onAdd={() => addChildRuleDecl(rule.id, child.id)}
                              onUpdate={(declId, p, v) => updateChildRuleDecl(rule.id, child.id, declId, p, v)}
                              onRemove={(declId) => removeChildRuleDecl(rule.id, child.id, declId)}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {config.rules.length === 0 && (
                <p className="nst__empty">暂无嵌套规则，点击"+ 添加规则"开始构建嵌套结构。</p>
              )}
            </div>
          </div>
        </div>

        {/* 右侧：预览 + 代码 */}
        <div className="nst__output">
          {/* 预览区 */}
          <div className="nst__preview">
            <div className="nst__output-head">
              <span className="nst__output-label">实时预览（iframe 隔离）</span>
            </div>
            <iframe className="nst__iframe" srcDoc={previewSrcDoc} title="嵌套 CSS 预览" sandbox="allow-same-origin" />
          </div>

          {/* 预览 HTML 编辑 */}
          <div className="nst__html">
            <div className="nst__output-head">
              <span className="nst__output-label">预览 HTML（可编辑）</span>
            </div>
            <textarea
              className="nst__textarea"
              value={previewHtml}
              onChange={(e) => setPreviewHtml(e.target.value)}
              spellCheck={false}
              rows={5}
            />
          </div>

          {/* 嵌套 CSS 代码 */}
          <div className="nst__code">
            <div className="nst__output-head">
              <span className="nst__output-label">嵌套 CSS 代码</span>
              <button type="button" className="nst__btn nst__btn--copy" onClick={handleCopy}>
                {copied ? '已复制 ✓' : '复制'}
              </button>
            </div>
            <pre className="nst__code-pre">{nestedCss}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
