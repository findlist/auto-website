import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS if() 条件函数生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 完整支持 CSS if() 函数三种条件类型：style() 样式查询 / media() 媒体查询 / supports() 特性查询
 *  - 多分支管理：动态增删条件分支，每个分支含条件类型、条件表达式、命中值
 *  - 必备 else 默认分支：所有条件都不满足时返回的兜底值
 *  - 目标属性可选：color / padding / background-color / background-image / width / display 等
 *  - iframe 沙箱预览：真实渲染生成的 CSS，可手动切换自定义属性值验证 style() 条件
 *  - 原理说明面板：解析当前配置的求值顺序与命中分支
 *  - 8 组预设覆盖暗色模式、响应式、特性降级、主题切换、打印样式等场景
 *  - 一键复制生成的 CSS 代码
 *
 * 核心知识点（CSS Values Module Level 5）：
 *  - 语法：if(<条件> : <值>; <条件> : <值>; else : <值>)
 *  - 条件类型：style(<style-query>) / media(<media-condition>) / supports(<supports-condition>)
 *  - 求值规则：按顺序求值，第一个为 true 的条件返回其值；全为 false 返回 guaranteed-invalid
 *  - 注意：if 与 ( 之间不能有空格，否则整个声明无效
 *  - 降级：不优雅降级，需为不支持的浏览器提供显式回退
 *  - 浏览器支持：Chrome 137+（2025 年起，实验性，非 Baseline）
 */

/** 条件类型 */
type CondType = 'style' | 'media' | 'supports' | 'else';

/** 单个条件分支 */
interface Branch {
  id: string;
  type: CondType;        // 条件类型，else 为默认分支
  expression: string;    // 条件表达式（else 时忽略），如 '--theme: dark' / 'min-width: 768px' / 'color: lch(0 0 0)'
  value: string;         // 命中时返回的 CSS 值
  note: string;          // 分支说明（可选，用于原理面板展示）
}

/** 完整工具配置 */
interface IfConfig {
  selector: string;       // 目标选择器，默认 .demo
  property: string;       // 目标 CSS 属性，如 color / padding
  branches: Branch[];     // 条件分支列表（最后一个应为 else）
  fallback: string;       // 不支持 if() 时的静态回退值
  includeFallback: boolean; // 是否在代码中输出静态回退声明
}

/** 预设：配置 + 名称 */
interface IfPreset {
  name: string;
  config: IfConfig;
}

/** 模块级 id 生成器，保证 React key 稳定唯一 */
let _idCounter = 0;
const genId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${(++_idCounter).toString(36)}`;

/** 创建一个分支 */
const makeBranch = (
  type: CondType,
  expression: string,
  value: string,
  note = '',
): Branch => ({ id: genId('br'), type, expression, value, note });

/** 条件类型选项（含说明） */
const COND_TYPES: { value: CondType; label: string; hint: string }[] = [
  { value: 'style', label: 'style() 样式查询', hint: '测试元素自身的自定义属性值，如 style(--theme: dark)' },
  { value: 'media', label: 'media() 媒体查询', hint: '测试媒体特性，如 media(min-width: 768px) 或 media(prefers-color-scheme: dark)' },
  { value: 'supports', label: 'supports() 特性查询', hint: '测试浏览器是否支持某属性值，如 supports(color: lch(0 0 0))' },
  { value: 'else', label: 'else 默认值', hint: '始终为 true，作为所有条件都不满足时的兜底值' },
];

/** 常用目标属性速查 */
const PROPERTY_PRESETS = [
  'color',
  'background-color',
  'background-image',
  'padding',
  'margin',
  'width',
  'height',
  'font-size',
  'display',
  'border-color',
  'opacity',
];

/** 8 组预设，覆盖 if() 最常见应用场景 */
const PRESETS: IfPreset[] = [
  {
    // 暗色模式：通过 style() 查询 --theme 自定义属性
    name: '暗色模式切换',
    config: {
      selector: '.demo',
      property: 'color',
      includeFallback: true,
      fallback: '#1a1a1a',
      branches: [
        makeBranch('style', '--theme: dark', '#e5e5e5', '深色主题：浅色文字'),
        makeBranch('style', '--theme: light', '#1a1a1a', '浅色主题：深色文字'),
        makeBranch('else', '', '#1a1a1a', '未设置 --theme 时默认深色文字'),
      ],
    },
  },
  {
    // 响应式宽度：通过 media() 查询视口宽度
    name: '响应式宽度',
    config: {
      selector: '.demo',
      property: 'width',
      includeFallback: true,
      fallback: '100%',
      branches: [
        makeBranch('media', 'min-width: 1024px', '1200px', '宽屏：固定 1200px'),
        makeBranch('media', 'min-width: 768px', '750px', '平板：固定 750px'),
        makeBranch('else', '', '100%', '移动端：100% 自适应'),
      ],
    },
  },
  {
    // 特性降级：通过 supports() 检测 lch() 颜色支持
    name: '特性检测降级',
    config: {
      selector: '.demo',
      property: 'color',
      includeFallback: true,
      fallback: '#2563eb',
      branches: [
        makeBranch('supports', 'color: lch(50 130 250)', 'lch(50 130 250)', '支持 lch()：使用广色域颜色'),
        makeBranch('else', '', '#2563eb', '不支持 lch()：回退 sRGB 蓝色'),
      ],
    },
  },
  {
    // 主题切换：通过 style() 查询多值主题
    name: '多主题切换',
    config: {
      selector: '.demo',
      property: 'background-color',
      includeFallback: false,
      fallback: '#ffffff',
      branches: [
        makeBranch('style', '--scheme: ice', '#e0f2ff', 'ice 冰蓝主题'),
        makeBranch('style', '--scheme: fire', '#fff0e0', 'fire 暖橙主题'),
        makeBranch('style', '--scheme: forest', '#e8f5e9', 'forest 森林主题'),
        makeBranch('else', '', '#ffffff', '默认白色背景'),
      ],
    },
  },
  {
    // 打印样式：通过 media() 查询 print 媒体类型
    name: '打印样式',
    config: {
      selector: '.demo',
      property: 'display',
      includeFallback: false,
      fallback: 'block',
      branches: [
        makeBranch('media', 'print', 'none', '打印时隐藏元素'),
        makeBranch('else', '', 'block', '屏幕显示时正常展示'),
      ],
    },
  },
  {
    // 尺寸关键字：通过 style() 查询 --size
    name: '尺寸关键字',
    config: {
      selector: '.demo',
      property: 'padding',
      includeFallback: true,
      fallback: '12px',
      branches: [
        makeBranch('style', '--size: "2xl"', '32px', '2xl 超大尺寸'),
        makeBranch('style', '--size: "lg"', '20px', 'lg 大尺寸'),
        makeBranch('style', '--size: "sm"', '8px', 'sm 小尺寸'),
        makeBranch('else', '', '12px', '默认中等尺寸'),
      ],
    },
  },
  {
    // 背景图片：通过 style() 切换渐变背景
    name: '渐变背景切换',
    config: {
      selector: '.demo',
      property: 'background-image',
      includeFallback: false,
      fallback: 'none',
      branches: [
        makeBranch('style', '--mode: sunset', 'linear-gradient(135deg, #ff9a9e, #fad0c4)', '日落渐变'),
        makeBranch('style', '--mode: ocean', 'linear-gradient(135deg, #a1c4fd, #c2e9fb)', '海洋渐变'),
        makeBranch('style', '--mode: aurora', 'linear-gradient(135deg, #84fab0, #8fd3f4)', '极光渐变'),
        makeBranch('else', '', 'none', '默认无背景图'),
      ],
    },
  },
  {
    // 简单示例：单条件 + else
    name: '简单示例',
    config: {
      selector: '.demo',
      property: 'color',
      includeFallback: false,
      fallback: '#000000',
      branches: [
        makeBranch('media', 'prefers-color-scheme: dark', '#e5e5e5', '系统深色模式：浅色文字'),
        makeBranch('else', '', '#1a1a1a', '其他情况：深色文字'),
      ],
    },
  },
];

/**
 * 构建单个分支的条件字符串
 * else 分支返回 'else'，其他分支按类型包裹函数
 */
function buildConditionPart(branch: Branch): string {
  if (branch.type === 'else') return 'else';
  const expr = branch.expression.trim();
  // 用户已输入函数包裹（如 style(...)）时直接使用，否则按类型自动包裹
  if (expr.startsWith(`${branch.type}(`)) return expr;
  return `${branch.type}(${expr})`;
}

/**
 * 生成完整 CSS 代码
 * 包含可选静态回退声明 + 目标选择器的 if() 声明
 */
function buildCss(cfg: IfConfig): string {
  const sel = cfg.selector.trim() || '.demo';
  const prop = cfg.property.trim() || 'color';
  const lines: string[] = [];

  // 可选：不兼容 if() 的浏览器使用的静态回退
  if (cfg.includeFallback && cfg.fallback.trim()) {
    lines.push(`/* 不支持 if() 的浏览器回退 */`);
    lines.push(`${sel} {`);
    lines.push(`  ${prop}: ${cfg.fallback.trim()};`);
    lines.push(`}`);
    lines.push('');
  }

  // if() 声明：分号分隔各分支，最后一个分号可选
  const parts = cfg.branches.map((b) => {
    const cond = buildConditionPart(b);
    const val = b.value.trim() || 'initial';
    return `  ${cond} : ${val}`;
  });
  // 用分号连接，最后一个分支后不加（语法允许，更简洁）
  const ifBody = parts.join('; ');

  lines.push(`/* 支持 if() 的浏览器（Chrome 137+）覆盖上面的回退 */`);
  lines.push(`${sel} {`);
  lines.push(`  ${prop}: if(${ifBody});`);
  lines.push('}');

  return lines.join('\n');
}

/**
 * 生成 iframe 预览的完整 HTML
 * 重点：style() 条件依赖元素自身的自定义属性，预览区提供输入框让用户设置该属性值以验证命中
 */
function buildPreviewHtml(cfg: IfConfig, customPropInput: string): string {
  const sel = cfg.selector.trim() || '.demo';
  const prop = cfg.property.trim() || 'color';
  const fallback = cfg.includeFallback && cfg.fallback.trim() ? cfg.fallback.trim() : '';

  // 解析用户输入的自定义属性，格式如 "--theme: dark" 或 "--scheme: ice"
  // 支持多对属性，用分号分隔
  const customDecls = customPropInput
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `  ${s};`)
    .join('\n');

  // 生成 if() 声明体
  const parts = cfg.branches.map((b) => {
    const cond = buildConditionPart(b);
    const val = b.value.trim() || 'initial';
    return `  ${cond} : ${val}`;
  });
  const ifBody = parts.join('; ');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  .demo {
    /* 用户输入的自定义属性（用于 style() 条件命中验证） */
${customDecls || '  /* 暂未设置自定义属性 */'}
    /* 静态回退（不支持 if() 时生效） */
${fallback ? `    ${prop}: ${fallback};` : '    /* 无静态回退 */'}
    /* if() 条件声明（Chrome 137+ 生效，覆盖上面的回退） */
    ${prop}: if(${ifBody});
    /* 预览容器基础样式 */
    padding: 24px;
    margin: 12px 0;
    border: 2px dashed #cbd5e1;
    border-radius: 8px;
    font-size: 15px;
    line-height: 1.6;
    min-height: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    word-break: break-all;
  }
  body {
    margin: 0;
    padding: 12px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: #f8fafc;
    color: #1e293b;
  }
  .hint {
    font-size: 12px;
    color: #64748b;
    margin-bottom: 8px;
  }
  .hint code {
    background: #e2e8f0;
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 11px;
  }
</style>
</head>
<body>
  <div class="hint">
    提示：在左侧"自定义属性输入"填写如 <code>--theme: dark</code> 可触发 style() 条件；
    <code>media()</code> 与 <code>supports()</code> 条件由浏览器环境决定。
  </div>
  <div class="${sel.replace('.', '')}">
    预览元素 · ${escapeHtml(prop)}
  </div>
</body>
</html>`;
}

/** 简易 HTML 转义：防止用户输入破坏预览 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 判断当前预览环境下哪个分支会命中（启发式，用于原理说明） */
function predictHitBranch(cfg: IfConfig, customPropInput: string): { branch: Branch; reason: string } | null {
  const prefersDark = typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;

  // 解析自定义属性键值对
  const customProps = new Map<string, string>();
  customPropInput
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((s) => {
      const idx = s.indexOf(':');
      if (idx > 0) {
        const key = s.slice(0, idx).trim();
        const val = s.slice(idx + 1).trim();
        customProps.set(key, val);
      }
    });

  for (const b of cfg.branches) {
    if (b.type === 'else') continue;
    const expr = b.expression.trim();
    if (b.type === 'style') {
      // 匹配 style(--prop: value) 形式
      const m = expr.match(/^--[\w-]+\s*:\s*(.+)$/);
      if (m) {
        const colonIdx = expr.indexOf(':');
        const key = expr.slice(0, colonIdx).trim();
        const expectedVal = expr.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
        const actualVal = (customProps.get(key) || '').replace(/^["']|["']$/g, '');
        if (actualVal === expectedVal) {
          return { branch: b, reason: `自定义属性 ${key} = "${expectedVal}" 命中 style() 条件` };
        }
      }
    } else if (b.type === 'media') {
      // 简化判断：prefers-color-scheme 与 min-width
      if (expr.includes('prefers-color-scheme: dark') && prefersDark) {
        return { branch: b, reason: '当前系统为深色模式，命中 media(prefers-color-scheme: dark)' };
      }
      const widthMatch = expr.match(/min-width:\s*(\d+)px/);
      if (widthMatch && viewportWidth >= parseInt(widthMatch[1], 10)) {
        return { branch: b, reason: `当前视口宽度 ${viewportWidth}px ≥ ${widthMatch[1]}px，命中 media(min-width: ${widthMatch[1]}px)` };
      }
      if (expr.trim() === 'print') {
        // 打印环境无法在屏幕预览中触发，跳过
        continue;
      }
    } else if (b.type === 'supports') {
      // supports() 条件需浏览器真实检测，这里只做启发式提示
      // 不做命中预测，留给原理说明文字解释
      continue;
    }
  }
  return null;
}

export default function IfFunctionTool() {
  const [config, setConfig] = useState<IfConfig>(PRESETS[0].config);
  const [customPropInput, setCustomPropInput] = useState('--theme: dark');
  const [copied, setCopied] = useState(false);

  /** 更新配置字段 */
  const updateField = useCallback(<K extends keyof IfConfig>(key: K, value: IfConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }, []);

  /** 更新指定分支 */
  const updateBranch = useCallback((id: string, patch: Partial<Branch>) => {
    setConfig((prev) => ({
      ...prev,
      branches: prev.branches.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }));
  }, []);

  /** 新增条件分支（插在 else 之前） */
  const addBranch = useCallback(() => {
    setConfig((prev) => {
      // 找到 else 分支位置，在其前面插入新条件分支
      const elseIdx = prev.branches.findIndex((b) => b.type === 'else');
      const newBranch = makeBranch('style', '--theme: dark', '#e5e5e5', '新增条件分支');
      if (elseIdx === -1) {
        // 无 else 分支，直接追加
        return { ...prev, branches: [...prev.branches, newBranch] };
      }
      const branches = [...prev.branches];
      branches.splice(elseIdx, 0, newBranch);
      return { ...prev, branches };
    });
  }, []);

  /** 删除指定分支（else 分支不可删除） */
  const removeBranch = useCallback((id: string) => {
    setConfig((prev) => {
      const target = prev.branches.find((b) => b.id === id);
      if (!target || target.type === 'else') return prev; // else 不可删
      return { ...prev, branches: prev.branches.filter((b) => b.id !== id) };
    });
  }, []);

  /** 应用预设 */
  const applyPreset = useCallback((preset: IfPreset) => {
    // 深拷贝并对每个分支重新生成 id，避免 React key 冲突
    const branches = preset.config.branches.map((b) => ({ ...b, id: genId('br') }));
    setConfig({ ...preset.config, branches });
    // 根据预设自动设置预览的自定义属性输入（取第一个 style 分支的表达式）
    const firstStyle = preset.config.branches.find((b) => b.type === 'style');
    setCustomPropInput(firstStyle ? firstStyle.expression : '');
  }, []);

  /** 生成的 CSS 代码 */
  const cssCode = useMemo(() => buildCss(config), [config]);

  /** 预览 HTML */
  const previewSrcDoc = useMemo(
    () => buildPreviewHtml(config, customPropInput),
    [config, customPropInput],
  );

  /** 复制 CSS */
  const handleCopy = useCallback(async () => {
    const ok = await copyText(cssCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [cssCode]);

  /** 预测命中的分支（用于原理说明） */
  const hitPrediction = useMemo(
    () => predictHitBranch(config, customPropInput),
    [config, customPropInput],
  );

  /** 原理说明文本 */
  const explainText = useMemo(() => {
    const parts: string[] = [];
    const prop = config.property.trim() || 'color';
    parts.push(`当前为 <code>${prop}</code> 属性生成 if() 声明，共 ${config.branches.length} 个分支（含 else）。`);

    if (config.branches.length === 0) {
      parts.push('注意：无任何分支，if() 将返回 guaranteed-invalid，属性回退到 initial。');
    } else {
      parts.push('求值规则：浏览器<strong>按顺序</strong>求值各条件，第一个为 true 的分支返回其值；全为 false 时返回 else 值。');
    }

    if (hitPrediction) {
      parts.push(`当前预览环境下：<strong>${escapeHtml(hitPrediction.branch.value || 'initial')}</strong>（${hitPrediction.reason}）。`);
    } else {
      const hasElse = config.branches.some((b) => b.type === 'else');
      if (hasElse) {
        parts.push('当前预览环境下：无 style() / media() 条件命中，将返回 <strong>else 默认值</strong>。');
      }
    }

    // 语法提醒
    parts.push('<strong>语法提醒：</strong><code>if</code> 与 <code>(</code> 之间不能有空格，否则整个声明无效；条件与值之间用冒号分隔，分支之间用分号分隔。');
    return parts.join(' ');
  }, [config, hitPrediction]);

  /** 统计各类型分支数量 */
  const branchStats = useMemo(() => {
    const stats = { style: 0, media: 0, supports: 0, else: 0 };
    config.branches.forEach((b) => { stats[b.type] += 1; });
    return stats;
  }, [config.branches]);

  return (
    <div className="cif">
      {/* 预设按钮组 */}
      <div className="cif__presets">
        <span className="cif__presets-label">预设：</span>
        {PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            className="cif__btn cif__btn--preset"
            onClick={() => applyPreset(p)}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="cif__main">
        {/* 左：编辑器 */}
        <div className="cif__editor">
          {/* 全局配置 */}
          <div className="cif__panel">
            <div className="cif__panel-head">
              <span className="cif__panel-title">目标声明配置</span>
            </div>
            <div className="cif__panel-body">
              <label className="cif__field">
                <span className="cif__field-label">目标选择器</span>
                <input
                  className="cif__field-input"
                  type="text"
                  value={config.selector}
                  placeholder=".demo"
                  onChange={(e) => updateField('selector', e.target.value)}
                />
              </label>
              <label className="cif__field">
                <span className="cif__field-label">目标 CSS 属性</span>
                <input
                  className="cif__field-input"
                  type="text"
                  value={config.property}
                  placeholder="color"
                  list="cif-prop-list"
                  onChange={(e) => updateField('property', e.target.value)}
                />
                <datalist id="cif-prop-list">
                  {PROPERTY_PRESETS.map((p) => <option key={p} value={p} />)}
                </datalist>
              </label>
              <label className="cif__field cif__field--check">
                <input
                  type="checkbox"
                  checked={config.includeFallback}
                  onChange={(e) => updateField('includeFallback', e.target.checked)}
                />
                <span>生成静态回退声明（推荐勾选，兼容不支持 if() 的浏览器）</span>
              </label>
              {config.includeFallback && (
                <label className="cif__field">
                  <span className="cif__field-label">静态回退值</span>
                  <input
                    className="cif__field-input"
                    type="text"
                    value={config.fallback}
                    placeholder="#1a1a1a"
                    onChange={(e) => updateField('fallback', e.target.value)}
                  />
                </label>
              )}
            </div>
          </div>

          {/* 条件分支编辑 */}
          <div className="cif__panel">
            <div className="cif__panel-head">
              <span className="cif__panel-title">
                条件分支（{config.branches.length}）
                <span className="cif__branch-stats">
                  style {branchStats.style} · media {branchStats.media} · supports {branchStats.supports} · else {branchStats.else}
                </span>
              </span>
              <button type="button" className="cif__btn cif__btn--add" onClick={addBranch}>
                + 新增条件分支
              </button>
            </div>
            <div className="cif__panel-body">
              {config.branches.length === 0 && (
                <p className="cif__empty">暂无分支，点击"新增条件分支"添加。</p>
              )}
              {config.branches.map((branch, idx) => (
                <div key={branch.id} className="cif__branch">
                  <div className="cif__branch-head">
                    <span className="cif__branch-idx" title="分支序号">{idx + 1}</span>
                    <select
                      className="cif__branch-type"
                      value={branch.type}
                      onChange={(e) => updateBranch(branch.id, { type: e.target.value as CondType })}
                      aria-label="条件类型"
                    >
                      {COND_TYPES.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="cif__btn cif__btn--del"
                      onClick={() => removeBranch(branch.id)}
                      disabled={branch.type === 'else'}
                      aria-label="删除该分支"
                      title={branch.type === 'else' ? 'else 分支不可删除' : '删除该分支'}
                    >
                      ×
                    </button>
                  </div>
                  {branch.type !== 'else' && (
                    <>
                      <input
                        className="cif__branch-expr"
                        type="text"
                        value={branch.expression}
                        placeholder={
                          branch.type === 'style' ? '--theme: dark' :
                          branch.type === 'media' ? 'min-width: 768px' :
                          'color: lch(0 0 0)'
                        }
                        onChange={(e) => updateBranch(branch.id, { expression: e.target.value })}
                        aria-label="条件表达式"
                      />
                      <p className="cif__branch-hint">
                        {COND_TYPES.find((c) => c.value === branch.type)?.hint}
                      </p>
                    </>
                  )}
                  <label className="cif__branch-value-label">
                    <span className="cif__field-label">
                      {branch.type === 'else' ? '默认值（所有条件都不满足时）' : '命中时返回的值'}
                    </span>
                    <input
                      className="cif__branch-value"
                      type="text"
                      value={branch.value}
                      placeholder={branch.type === 'else' ? '#1a1a1a' : '#e5e5e5'}
                      onChange={(e) => updateBranch(branch.id, { value: e.target.value })}
                    />
                  </label>
                  <input
                    className="cif__branch-note"
                    type="text"
                    value={branch.note}
                    placeholder="分支说明（可选，仅用于原理面板展示）"
                    onChange={(e) => updateBranch(branch.id, { note: e.target.value })}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* 原理说明 */}
          <div className="cif__panel cif__panel--explain">
            <div className="cif__panel-head">
              <span className="cif__panel-title">原理说明</span>
            </div>
            <div className="cif__panel-body">
              <p className="cif__explain" dangerouslySetInnerHTML={{ __html: explainText }} />
              <p className="cif__explain cif__explain--tip">
                <strong>核心规则：</strong>
                <code>if()</code> 不优雅降级——不支持的浏览器会忽略整个声明，
                因此推荐先写一条静态回退声明，再用 if() 覆盖。
                注意 <code>style()</code> 条件目前<strong>只支持自定义属性查询</strong>，
                不支持常规 CSS 属性。
              </p>
            </div>
          </div>
        </div>

        {/* 右：预览 + 代码 */}
        <div className="cif__output">
          {/* 自定义属性输入（用于触发 style() 条件） */}
          <div className="cif__custom-prop">
            <label className="cif__field">
              <span className="cif__field-label">
                自定义属性输入（用于触发 style() 条件，多个用分号分隔）
              </span>
              <input
                className="cif__field-input"
                type="text"
                value={customPropInput}
                placeholder="--theme: dark; --size: &quot;lg&quot;"
                onChange={(e) => setCustomPropInput(e.target.value)}
              />
            </label>
          </div>

          {/* iframe 沙箱预览 */}
          <div className="cif__preview">
            <div className="cif__preview-head">
              <span className="cif__preview-title">实时预览</span>
              <span className="cif__preview-hint">Chrome 137+ 生效，其他浏览器显示静态回退</span>
            </div>
            <iframe
              className="cif__iframe"
              srcDoc={previewSrcDoc}
              title="CSS if() 预览"
              sandbox="allow-same-origin"
            />
          </div>

          {/* 代码输出 */}
          <div className="cif__code">
            <div className="cif__code-head">
              <span className="cif__code-title">生成的 CSS</span>
              <button type="button" className="cif__btn cif__btn--copy" onClick={handleCopy}>
                {copied ? '已复制' : '复制 CSS'}
              </button>
            </div>
            <pre className="cif__code-pre">
              <code>{cssCode}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
