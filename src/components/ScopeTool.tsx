import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS @scope 作用域生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 多 @scope 块管理：增删 / 编辑根选择器 / 编辑下边界（to 子句）
 *  - 每块可包含多条相对规则（选择器 + 多条声明）
 *  - 支持下边界（甜甜圈作用域 / donut scope）：to (boundary) 子句
 *  - 作用域说明面板：解析 :scope 与 & 前缀，展示每条规则的完整选择器
 *  - iframe 隔离预览，实时应用生成的作用域 CSS
 *  - 8 组预设覆盖基本作用域、甜甜圈作用域、卡片组件、导航菜单等场景
 */

/** 单条 CSS 声明：property: value */
interface ScopeDecl {
  id: string;
  property: string;
  value: string;
}

/** 作用域内规则：相对选择器 + 声明列表 */
interface ScopeRule {
  id: string;
  selector: string;
  declarations: ScopeDecl[];
}

/** 一个 @scope 块：根选择器 + 可选下边界 + 规则列表 */
interface ScopeBlock {
  id: string;
  rootSelector: string;
  boundarySelector: string;
  rules: ScopeRule[];
}

/** 完整作用域配置：多个 @scope 块 */
interface ScopeConfig {
  blocks: ScopeBlock[];
}

/** 预设：配置 + 预览 HTML */
interface ScopePreset {
  name: string;
  config: ScopeConfig;
  previewHtml: string;
}

// 模块级 id 生成器，保证 React key 稳定唯一（避免数组索引 key 导致删除中间项时焦点错位）
let _idCounter = 0;
const genId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${(++_idCounter).toString(36)}`;

/** 创建一条声明 */
const makeDecl = (property: string, value: string): ScopeDecl => ({
  id: genId('decl'),
  property,
  value,
});

/** 创建一条规则 */
const makeRule = (selector: string, declarations: ScopeDecl[] = []): ScopeRule => ({
  id: genId('rule'),
  selector,
  declarations,
});

/** 创建一个 @scope 块 */
const makeBlock = (
  rootSelector: string,
  boundarySelector = '',
  rules: ScopeRule[] = [],
): ScopeBlock => ({
  id: genId('block'),
  rootSelector,
  boundarySelector,
  rules,
});

// 8 组预设，覆盖 @scope 最常见应用场景
const PRESETS: ScopePreset[] = [
  {
    name: '基本作用域',
    previewHtml: `<div class="card"><h3 class="title">基本作用域</h3><p class="desc">样式仅作用于 .card 内部</p></div>`,
    config: {
      blocks: [
        makeBlock('.card', '', [
          makeRule('.title', [makeDecl('color', '#dc2626'), makeDecl('font-size', '20px')]),
          makeRule('.desc', [makeDecl('color', '#6b7280')]),
        ]),
      ],
    },
  },
  {
    name: '甜甜圈作用域',
    previewHtml: `<div class="card"><h3 class="title">标题被样式化</h3><div class="content"><p class="title">内容区的 .title 被下边界排除</p></div></div>`,
    config: {
      blocks: [
        // 下边界 .content 会排除其内部的元素，形成"甜甜圈"作用域
        makeBlock('.card', '.content', [
          makeRule('.title', [makeDecl('color', '#dc2626'), makeDecl('font-weight', '700')]),
        ]),
      ],
    },
  },
  {
    name: '卡片组件',
    previewHtml: `<div class="card"><h3 class="title">卡片标题</h3><p class="desc">卡片描述文本</p></div>`,
    config: {
      blocks: [
        makeBlock('.card', '', [
          makeRule(':scope', [
            makeDecl('padding', '20px'),
            makeDecl('background', '#f9fafb'),
            makeDecl('border-radius', '12px'),
            makeDecl('border', '1px solid #e5e7eb'),
          ]),
          makeRule('.title', [makeDecl('margin', '0 0 8px'), makeDecl('color', '#111827'), makeDecl('font-size', '18px')]),
          makeRule('.desc', [makeDecl('margin', '0'), makeDecl('color', '#6b7280'), makeDecl('font-size', '14px')]),
        ]),
      ],
    },
  },
  {
    name: '多组件作用域',
    previewHtml: `<header class="header"><h2>站点标题</h2></header><footer class="footer"><p>页脚文本</p></footer>`,
    config: {
      blocks: [
        makeBlock('.header', '', [
          makeRule(':scope', [makeDecl('padding', '16px'), makeDecl('background', '#1f2937')]),
          makeRule('h2', [makeDecl('margin', '0'), makeDecl('color', '#f9fafb')]),
        ]),
        makeBlock('.footer', '', [
          makeRule(':scope', [makeDecl('padding', '12px'), makeDecl('background', '#f3f4f6')]),
          makeRule('p', [makeDecl('margin', '0'), makeDecl('color', '#6b7280'), makeDecl('font-size', '13px')]),
        ]),
      ],
    },
  },
  {
    name: '导航菜单',
    previewHtml: `<nav class="nav"><a href="#">首页</a><a href="#">文章</a><a href="#">关于</a></nav>`,
    config: {
      blocks: [
        makeBlock('.nav', '', [
          makeRule(':scope', [
            makeDecl('display', 'flex'),
            makeDecl('gap', '16px'),
            makeDecl('padding', '12px'),
            makeDecl('background', '#eff6ff'),
            makeDecl('border-radius', '8px'),
          ]),
          // :scope > a 仅匹配直接子级
          makeRule(':scope > a', [makeDecl('color', '#2563eb'), makeDecl('text-decoration', 'none'), makeDecl('font-size', '14px')]),
        ]),
      ],
    },
  },
  {
    name: '表单组件',
    previewHtml: `<form class="form"><label class="label">用户名</label><input class="input" type="text" /></form>`,
    config: {
      blocks: [
        makeBlock('.form', '', [
          makeRule(':scope', [
            makeDecl('display', 'flex'),
            makeDecl('flex-direction', 'column'),
            makeDecl('gap', '8px'),
            makeDecl('padding', '16px'),
          ]),
          makeRule('.label', [makeDecl('font-size', '13px'), makeDecl('color', '#374151'), makeDecl('font-weight', '600')]),
          makeRule('.input', [
            makeDecl('padding', '8px 12px'),
            makeDecl('border', '1px solid #d1d5db'),
            makeDecl('border-radius', '6px'),
            makeDecl('font-size', '14px'),
          ]),
        ]),
      ],
    },
  },
  {
    name: '列表条纹',
    previewHtml: `<ul class="list"><li class="item">第一项</li><li class="item">第二项</li><li class="item">第三项</li><li class="item">第四项</li></ul>`,
    config: {
      blocks: [
        makeBlock('.list', '', [
          makeRule(':scope', [makeDecl('margin', '0'), makeDecl('padding', '0'), makeDecl('list-style', 'none')]),
          makeRule('.item', [makeDecl('padding', '8px 12px')]),
          makeRule('.item:nth-child(odd)', [makeDecl('background', '#f9fafb')]),
          makeRule('.item:nth-child(even)', [makeDecl('background', '#ffffff')]),
        ]),
      ],
    },
  },
  {
    name: '默认示例',
    previewHtml: `<div class="card"><h3 class="title">作用域内的标题</h3></div><h3 class="title">作用域外的标题（不受影响）</h3>`,
    config: {
      blocks: [
        makeBlock('.card', '', [
          makeRule(':scope', [makeDecl('padding', '16px'), makeDecl('background', '#fef3c7'), makeDecl('border-radius', '8px')]),
          makeRule('.title', [makeDecl('color', '#92400e'), makeDecl('margin', '0')]),
        ]),
      ],
    },
  },
];

/** 默认配置（与"默认示例"预设一致） */
const DEFAULT_INDEX = PRESETS.length - 1;
const DEFAULT_CONFIG: ScopeConfig = PRESETS[DEFAULT_INDEX].config;
const DEFAULT_HTML: string = PRESETS[DEFAULT_INDEX].previewHtml;

/**
 * 生成单个 @scope 块文本
 * - 无根选择器：@scope { ... }
 * - 有根无边界：@scope (root) { ... }
 * - 有根有边界：@scope (root) to (boundary) { ... }
 */
function buildScopeBlock(block: ScopeBlock): string {
  const root = block.rootSelector.trim();
  const boundary = block.boundarySelector.trim();
  let head: string;
  if (!root) {
    head = '@scope';
  } else if (boundary) {
    head = `@scope (${root}) to (${boundary})`;
  } else {
    head = `@scope (${root})`;
  }
  const lines: string[] = [`${head} {`];
  block.rules.forEach((rule, idx) => {
    if (idx > 0) lines.push('');
    lines.push(`  ${rule.selector} {`);
    rule.declarations.forEach((d) => {
      if (d.property.trim() && d.value.trim()) {
        lines.push(`    ${d.property}: ${d.value};`);
      }
    });
    lines.push('  }');
  });
  lines.push('}');
  return lines.join('\n');
}

/** 生成完整作用域 CSS 文本 */
function buildScopedCss(config: ScopeConfig): string {
  return config.blocks.map(buildScopeBlock).join('\n\n');
}

/**
 * 解析相对选择器为完整选择器（用于作用域说明面板）
 * - :scope 前缀替换为根选择器
 * - & 前缀替换为根选择器
 * - 其他选择器拼接到根选择器后（后代选择器）
 */
function resolveSelector(root: string, selector: string): string {
  const r = root.trim();
  const s = selector.trim();
  if (!r) return s;
  if (s.startsWith(':scope')) return s.replace(':scope', r);
  if (s.startsWith('&')) return s.replace('&', r);
  return `${r} ${s}`;
}

/** 单条声明编辑行 */
function DeclRow({
  decl,
  onChange,
  onRemove,
}: {
  decl: ScopeDecl;
  onChange: (property: string, value: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="scp__decl">
      <input
        className="scp__decl-prop"
        type="text"
        value={decl.property}
        placeholder="属性"
        onChange={(e) => onChange(e.target.value, decl.value)}
      />
      <span className="scp__decl-colon">:</span>
      <input
        className="scp__decl-val"
        type="text"
        value={decl.value}
        placeholder="值"
        onChange={(e) => onChange(decl.property, e.target.value)}
      />
      <button type="button" className="scp__btn scp__btn--del" onClick={onRemove} aria-label="删除该声明">
        ×
      </button>
    </div>
  );
}

export default function ScopeTool() {
  // 深拷贝预设配置，为每个节点生成新的稳定 id
  const cloneConfig = useCallback((cfg: ScopeConfig): ScopeConfig => ({
    blocks: cfg.blocks.map((b) => ({
      id: genId('block'),
      rootSelector: b.rootSelector,
      boundarySelector: b.boundarySelector,
      rules: b.rules.map((r) => ({
        id: genId('rule'),
        selector: r.selector,
        declarations: r.declarations.map((d) => ({ id: genId('decl'), property: d.property, value: d.value })),
      })),
    })),
  }), []);

  const [config, setConfig] = useState<ScopeConfig>(() => cloneConfig(DEFAULT_CONFIG));
  const [previewHtml, setPreviewHtml] = useState<string>(DEFAULT_HTML);
  const [copied, setCopied] = useState(false);

  // 生成的作用域 CSS
  const scopedCss = useMemo(() => buildScopedCss(config), [config]);

  // 预览 iframe 的 srcDoc
  const previewSrcDoc = useMemo(
    () =>
      `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body { font-family: -apple-system, system-ui, sans-serif; padding: 16px; margin: 0; color: #111827; }
        ${scopedCss}
      </style></head><body>${previewHtml}</body></html>`,
    [scopedCss, previewHtml],
  );

  // 应用预设
  const applyPreset = useCallback(
    (preset: ScopePreset) => {
      setConfig(cloneConfig(preset.config));
      setPreviewHtml(preset.previewHtml);
    },
    [cloneConfig],
  );

  // 复制 CSS
  const handleCopy = useCallback(async () => {
    const ok = await copyText(scopedCss);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  }, [scopedCss]);

  // === @scope 块操作 ===
  const addBlock = useCallback(() => {
    setConfig((prev) => ({
      ...prev,
      blocks: [...prev.blocks, makeBlock('.new', '', [makeRule(':scope', [makeDecl('padding', '12px')])])],
    }));
  }, []);
  const removeBlock = useCallback((id: string) => {
    setConfig((prev) => ({ ...prev, blocks: prev.blocks.filter((b) => b.id !== id) }));
  }, []);
  const updateBlockRoot = useCallback((id: string, rootSelector: string) => {
    setConfig((prev) => ({ ...prev, blocks: prev.blocks.map((b) => (b.id === id ? { ...b, rootSelector } : b)) }));
  }, []);
  const updateBlockBoundary = useCallback((id: string, boundarySelector: string) => {
    setConfig((prev) => ({ ...prev, blocks: prev.blocks.map((b) => (b.id === id ? { ...b, boundarySelector } : b)) }));
  }, []);

  // === 块内规则操作 ===
  const addRule = useCallback((blockId: string) => {
    setConfig((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) => (b.id === blockId ? { ...b, rules: [...b.rules, makeRule('.title', [makeDecl('', '')])] } : b)),
    }));
  }, []);
  const removeRule = useCallback((blockId: string, ruleId: string) => {
    setConfig((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) => (b.id === blockId ? { ...b, rules: b.rules.filter((r) => r.id !== ruleId) } : b)),
    }));
  }, []);
  const updateRuleSelector = useCallback((blockId: string, ruleId: string, selector: string) => {
    setConfig((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) =>
        b.id === blockId ? { ...b, rules: b.rules.map((r) => (r.id === ruleId ? { ...r, selector } : r)) } : b,
      ),
    }));
  }, []);
  const addDecl = useCallback((blockId: string, ruleId: string) => {
    setConfig((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) =>
        b.id === blockId
          ? { ...b, rules: b.rules.map((r) => (r.id === ruleId ? { ...r, declarations: [...r.declarations, makeDecl('', '')] } : r)) }
          : b,
      ),
    }));
  }, []);
  const updateDecl = useCallback((blockId: string, ruleId: string, declId: string, property: string, value: string) => {
    setConfig((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) =>
        b.id === blockId
          ? { ...b, rules: b.rules.map((r) => (r.id === ruleId ? { ...r, declarations: r.declarations.map((d) => (d.id === declId ? { ...d, property, value } : d)) } : r)) }
          : b,
      ),
    }));
  }, []);
  const removeDecl = useCallback((blockId: string, ruleId: string, declId: string) => {
    setConfig((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) =>
        b.id === blockId
          ? { ...b, rules: b.rules.map((r) => (r.id === ruleId ? { ...r, declarations: r.declarations.filter((d) => d.id !== declId) } : r)) }
          : b,
      ),
    }));
  }, []);

  return (
    <div className="scp">
      {/* 预设按钮组 */}
      <div className="scp__presets">
        <span className="scp__presets-label">预设：</span>
        {PRESETS.map((p) => (
          <button key={p.name} type="button" className="scp__btn scp__btn--preset" onClick={() => applyPreset(p)}>
            {p.name}
          </button>
        ))}
      </div>

      <div className="scp__main">
        {/* 左：编辑区 */}
        <div className="scp__editor">
          <div className="scp__panel">
            <div className="scp__panel-head">
              <span className="scp__panel-title">@scope 作用域块</span>
              <button type="button" className="scp__btn scp__btn--add" onClick={addBlock}>
                + 新增作用域
              </button>
            </div>
            <div className="scp__panel-body">
              {config.blocks.length === 0 && <p className="scp__empty">暂无作用域块，点击"新增作用域"添加。</p>}
              {config.blocks.map((block, idx) => (
                <div key={block.id} className="scp__block">
                  <div className="scp__block-head">
                    <span className="scp__block-idx" title="作用域序号">
                      {idx + 1}
                    </span>
                    <div className="scp__block-fields">
                      <label className="scp__field">
                        <span className="scp__field-label">根选择器</span>
                        <input
                          className="scp__field-input"
                          type="text"
                          value={block.rootSelector}
                          placeholder="如 .card"
                          onChange={(e) => updateBlockRoot(block.id, e.target.value)}
                        />
                      </label>
                      <label className="scp__field">
                        <span className="scp__field-label">下边界（to，可选）</span>
                        <input
                          className="scp__field-input"
                          type="text"
                          value={block.boundarySelector}
                          placeholder="如 .content（留空无边界）"
                          onChange={(e) => updateBlockBoundary(block.id, e.target.value)}
                        />
                      </label>
                    </div>
                    <button type="button" className="scp__btn scp__btn--del" onClick={() => removeBlock(block.id)} aria-label="删除作用域">
                      ×
                    </button>
                  </div>
                  {block.rules.map((rule) => (
                    <div key={rule.id} className="scp__rule">
                      <div className="scp__rule-head">
                        <input
                          className="scp__rule-sel"
                          type="text"
                          value={rule.selector}
                          placeholder="相对选择器（如 .title 或 :scope > a）"
                          onChange={(e) => updateRuleSelector(block.id, rule.id, e.target.value)}
                        />
                        <button type="button" className="scp__btn scp__btn--del" onClick={() => removeRule(block.id, rule.id)} aria-label="删除规则">
                          ×
                        </button>
                      </div>
                      <div className="scp__decls">
                        {rule.declarations.map((d) => (
                          <DeclRow
                            key={d.id}
                            decl={d}
                            onChange={(p, v) => updateDecl(block.id, rule.id, d.id, p, v)}
                            onRemove={() => removeDecl(block.id, rule.id, d.id)}
                          />
                        ))}
                        <button type="button" className="scp__btn scp__btn--add-decl" onClick={() => addDecl(block.id, rule.id)}>
                          + 添加声明
                        </button>
                      </div>
                    </div>
                  ))}
                  <button type="button" className="scp__btn scp__btn--add-rule" onClick={() => addRule(block.id)}>
                    + 添加规则
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 右：预览 + 作用域说明 + 代码 */}
        <div className="scp__output">
          {/* 预览 */}
          <div className="scp__panel">
            <div className="scp__panel-head">
              <span className="scp__panel-title">预览</span>
            </div>
            <div className="scp__panel-body">
              <iframe className="scp__preview" sandbox="allow-same-origin" srcDoc={previewSrcDoc} title="@scope 预览" />
              <details className="scp__html-edit">
                <summary>编辑预览 HTML</summary>
                <textarea className="scp__textarea" value={previewHtml} onChange={(e) => setPreviewHtml(e.target.value)} rows={4} />
              </details>
            </div>
          </div>

          {/* 作用域说明 */}
          <div className="scp__panel">
            <div className="scp__panel-head">
              <span className="scp__panel-title">作用域说明</span>
            </div>
            <div className="scp__panel-body">
              {config.blocks.length === 0 && <p className="scp__empty">暂无作用域块。</p>}
              {config.blocks.map((block, idx) => {
                const root = block.rootSelector.trim();
                const boundary = block.boundarySelector.trim();
                return (
                  <div key={block.id} className="scp__explain">
                    <div className="scp__explain-head">
                      作用域 {idx + 1}：
                      <code className="scp__mono">{root ? `@scope (${root})` : '@scope'}</code>
                      {boundary && <code className="scp__mono scp__mono--boundary"> to ({boundary})</code>}
                    </div>
                    {boundary && (
                      <p className="scp__explain-tip">下边界 <code>{boundary}</code> 内的元素不会被样式化（甜甜圈作用域）。</p>
                    )}
                    {block.rules.length > 0 && (
                      <ul className="scp__explain-list">
                        {block.rules.map((r) => (
                          <li key={r.id}>
                            <code className="scp__mono scp__mono--rel">{r.selector || '—'}</code>
                            <span className="scp__arrow"> → </span>
                            <code className="scp__mono scp__mono--full">{resolveSelector(root, r.selector) || '—'}</code>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 代码输出 */}
          <div className="scp__panel">
            <div className="scp__panel-head">
              <span className="scp__panel-title">生成的 CSS</span>
              <button type="button" className="scp__btn scp__btn--copy" onClick={handleCopy}>
                {copied ? '已复制 ✓' : '复制 CSS'}
              </button>
            </div>
            <div className="scp__panel-body">
              <pre className="scp__code">{scopedCss}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
