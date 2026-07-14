import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS light-dark() 暗色模式颜色函数生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - color-scheme 配置（light dark / dark light / light only / dark only）
 *  - 多颜色对管理：每对含名称、用途描述、light 色、dark 色
 *  - iframe 沙箱预览，可切换 自动 / 强制浅色 / 强制深色 三种模式实时查看
 *  - WCAG 对比度参考：每个颜色对在 light/dark 两种模式下与默认背景的对比度
 *  - 6 组预设覆盖完整设计系统、文本、背景、链接、按钮等场景
 *  - 一键复制生成的 CSS 代码
 *
 * 核心知识点：
 *  - light-dark() 是 CSS Color Module Level 5 引入的颜色函数
 *  - 语法：light-dark(<lightColor>, <darkColor>)
 *  - 必须配合 color-scheme: light dark; 声明才生效
 *  - 浏览器根据 prefers-color-scheme 自动选择两个值之一
 *  - 浏览器支持：Chrome 123+ / Safari 17.5+ / Firefox 120+（2024 年起全主流支持）
 */

/** RGB 颜色：0-255 整数 */
interface RGB {
  r: number;
  g: number;
  b: number;
}

/** 单个 light-dark() 颜色对 */
interface ColorPair {
  id: string;
  name: string;          // CSS 变量名，如 'text-primary'
  description: string;   // 用途说明
  lightColor: string;    // 浅色模式下的 HEX
  darkColor: string;     // 深色模式下的 HEX
}

/** 完整工具配置 */
interface LightDarkConfig {
  colorScheme: string;          // color-scheme 值
  rootSelector: string;         // 根选择器，默认 :root
  pairs: ColorPair[];
  generateUsageExample: boolean; // 是否生成使用示例
}

/** 预设：配置 + 预览 HTML */
interface LightDarkPreset {
  name: string;
  config: LightDarkConfig;
}

/** 预览模式 */
type PreviewMode = 'auto' | 'light' | 'dark';

/** 模块级 id 生成器，保证 React key 稳定唯一 */
let _idCounter = 0;
const genId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${(++_idCounter).toString(36)}`;

/** 创建一个颜色对 */
const makePair = (
  name: string,
  description: string,
  lightColor: string,
  darkColor: string,
): ColorPair => ({
  id: genId('pair'),
  name,
  description,
  lightColor,
  darkColor,
});

/** color-scheme 可选值 */
const COLOR_SCHEMES = [
  { value: 'light dark', label: 'light dark（默认，浅色优先）' },
  { value: 'dark light', label: 'dark light（深色优先）' },
  { value: 'light only', label: 'light only（仅浅色）' },
  { value: 'dark only', label: 'dark only（仅深色）' },
  { value: 'normal', label: 'normal（不指定，关闭自动适配）' },
];

/** 6 组预设，覆盖 light-dark() 最常见应用场景 */
const PRESETS: LightDarkPreset[] = [
  {
    // 完整设计系统：6 对颜色，覆盖文本/背景/边框/链接
    name: '完整设计系统',
    config: {
      colorScheme: 'light dark',
      rootSelector: ':root',
      generateUsageExample: true,
      pairs: [
        makePair('text-primary', '主文本', '#1a1a1a', '#e5e5e5'),
        makePair('text-secondary', '次要文本', '#4a4a4a', '#a0a0a0'),
        makePair('bg-main', '主背景', '#ffffff', '#1a1a1a'),
        makePair('bg-card', '卡片背景', '#f5f5f5', '#2a2a2a'),
        makePair('border', '边框', '#e0e0e0', '#3a3a3a'),
        makePair('link', '链接', '#2563eb', '#60a5fa'),
      ],
    },
  },
  {
    // 文本配色：3 对文本颜色
    name: '文本配色',
    config: {
      colorScheme: 'light dark',
      rootSelector: ':root',
      generateUsageExample: true,
      pairs: [
        makePair('text-primary', '主文本', '#1a1a1a', '#e5e5e5'),
        makePair('text-secondary', '次要文本', '#6b7280', '#9ca3af'),
        makePair('text-muted', '辅助文本', '#9ca3af', '#6b7280'),
      ],
    },
  },
  {
    // 背景配色：3 对背景颜色
    name: '背景配色',
    config: {
      colorScheme: 'light dark',
      rootSelector: ':root',
      generateUsageExample: true,
      pairs: [
        makePair('bg-main', '主背景', '#ffffff', '#0f0f0f'),
        makePair('bg-card', '卡片背景', '#f9fafb', '#1f2937'),
        makePair('bg-hover', '悬浮背景', '#f3f4f6', '#374151'),
      ],
    },
  },
  {
    // 链接配色：3 对链接状态颜色
    name: '链接配色',
    config: {
      colorScheme: 'light dark',
      rootSelector: ':root',
      generateUsageExample: true,
      pairs: [
        makePair('link-default', '默认链接', '#2563eb', '#60a5fa'),
        makePair('link-hover', '悬浮链接', '#1d4ed8', '#93c5fd'),
        makePair('link-visited', '访问过链接', '#7c3aed', '#c4b5fd'),
      ],
    },
  },
  {
    // 按钮配色：3 对按钮颜色
    name: '按钮配色',
    config: {
      colorScheme: 'light dark',
      rootSelector: ':root',
      generateUsageExample: true,
      pairs: [
        makePair('btn-primary-bg', '主按钮背景', '#2563eb', '#3b82f6'),
        makePair('btn-primary-text', '主按钮文字', '#ffffff', '#0f172a'),
        makePair('btn-secondary-bg', '次按钮背景', '#e5e7eb', '#374151'),
      ],
    },
  },
  {
    // 简单示例：单对文本对比
    name: '简单示例',
    config: {
      colorScheme: 'light dark',
      rootSelector: ':root',
      generateUsageExample: false,
      pairs: [
        makePair('text', '文本色', '#1a1a1a', '#f5f5f5'),
      ],
    },
  },
];

/** HEX → RGB：支持 3 位与 6 位 */
function hexToRgb(hex: string): RGB | null {
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) {
    h = `${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  }
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** 计算颜色的相对亮度（WCAG 2.1 标准公式） */
function relativeLuminance({ r, g, b }: RGB): number {
  const channel = (n: number) => {
    const c = n / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** 计算两色的对比度比值（WCAG 2.1 标准公式，1.0-21.0） */
function contrastRatio(rgb1: RGB, rgb2: RGB): number {
  const L1 = relativeLuminance(rgb1);
  const L2 = relativeLuminance(rgb2);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** 根据对比度返回 WCAG 评级文本 */
function wcagLabel(ratio: number): string {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA 大文字';
  return '不达标';
}

/**
 * 生成完整 CSS 代码
 * 包含 :root 块、color-scheme 声明、CSS 变量定义、可选使用示例
 */
function buildCss(cfg: LightDarkConfig): string {
  const sel = cfg.rootSelector.trim() || ':root';
  const lines: string[] = [];

  // :root 块：color-scheme + CSS 变量
  lines.push(`${sel} {`);
  lines.push(`  color-scheme: ${cfg.colorScheme};`);

  cfg.pairs.forEach((pair) => {
    const varName = pair.name.trim() || 'color';
    const light = pair.lightColor.trim() || '#000000';
    const dark = pair.darkColor.trim() || '#ffffff';
    const comment = pair.description.trim() ? ` /* ${pair.description} */` : '';
    lines.push(`  --${varName}: light-dark(${light}, ${dark});${comment}`);
  });

  lines.push('}');

  // 可选：使用示例
  if (cfg.generateUsageExample && cfg.pairs.length > 0) {
    lines.push('');
    lines.push('/* 使用示例 */');
    cfg.pairs.slice(0, 3).forEach((pair) => {
      const varName = pair.name.trim() || 'color';
      // 根据变量名推断使用场景
      const isText = varName.startsWith('text') || varName === 'link';
      const isBg = varName.startsWith('bg') || varName.startsWith('btn') && varName.endsWith('bg');
      if (isText) {
        lines.push(`.has-${varName} { color: var(--${varName}); }`);
      } else if (isBg) {
        lines.push(`.has-${varName} { background-color: var(--${varName}); }`);
      } else {
        lines.push(`.has-${varName} { color: var(--${varName}); }`);
      }
    });
  }

  return lines.join('\n');
}

/**
 * 生成 iframe 预览的完整 HTML
 * 根据预览模式决定是否强制 color-scheme
 */
function buildPreviewHtml(cfg: LightDarkConfig, mode: PreviewMode): string {
  // 强制模式：在 :root 上覆盖 color-scheme，让 light-dark() 输出对应值
  const forceScheme = mode === 'light' ? 'light only' : mode === 'dark' ? 'dark only' : cfg.colorScheme;

  // 生成 CSS 变量定义
  const varDefs = cfg.pairs
    .map((pair) => {
      const varName = pair.name.trim() || 'color';
      const light = pair.lightColor.trim() || '#000000';
      const dark = pair.darkColor.trim() || '#ffffff';
      return `  --${varName}: light-dark(${light}, ${dark});`;
    })
    .join('\n');

  // 生成预览卡片：每个颜色对一个卡片，显示两种模式下的实际渲染
  const cards = cfg.pairs
    .map((pair) => {
      const varName = pair.name.trim() || 'color';
      const desc = pair.description.trim() || varName;
      return `<div class="card">
        <div class="card__name">${escapeHtml(desc)}</div>
        <div class="card__var">--${escapeHtml(varName)}</div>
        <div class="card__swatch" style="background: var(--${varName});"></div>
        <div class="card__text" style="color: var(--${varName});">文本示例 Text Sample</div>
      </div>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  :root {
    color-scheme: ${forceScheme};
${varDefs}
  }
  body {
    margin: 0;
    padding: 16px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: light-dark(#ffffff, #1a1a1a);
    color: light-dark(#1a1a1a, #e5e5e5);
    min-height: 100vh;
  }
  .header {
    margin-bottom: 12px;
    padding: 8px 12px;
    border-radius: 6px;
    background: light-dark(#f3f4f6, #2a2a2a);
    font-size: 13px;
    color: light-dark(#4a4a4a, #a0a0a0);
  }
  .header strong { color: light-dark(#1a1a1a, #e5e5e5); }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
  }
  .card {
    padding: 12px;
    border: 1px solid light-dark(#e0e0e0, #3a3a3a);
    border-radius: 8px;
    background: light-dark(#ffffff, #2a2a2a);
  }
  .card__name {
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 2px;
  }
  .card__var {
    font-size: 11px;
    font-family: ui-monospace, "SF Mono", Consolas, monospace;
    opacity: 0.7;
    margin-bottom: 8px;
  }
  .card__swatch {
    height: 48px;
    border-radius: 6px;
    border: 1px solid light-dark(#e0e0e0, #3a3a3a);
    margin-bottom: 8px;
  }
  .card__text {
    font-size: 14px;
    line-height: 1.5;
  }
</style>
</head>
<body>
  <div class="header">
    当前预览模式：<strong>${mode === 'auto' ? '自动（跟随系统）' : mode === 'light' ? '强制浅色' : '强制深色'}</strong>
    · color-scheme: <code>${forceScheme}</code>
  </div>
  <div class="grid">
${cards}
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

export default function LightDarkTool() {
  const [config, setConfig] = useState<LightDarkConfig>(PRESETS[0].config);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('auto');
  const [copied, setCopied] = useState(false);

  /** 更新配置字段 */
  const updateField = useCallback(<K extends keyof LightDarkConfig>(
    key: K,
    value: LightDarkConfig[K],
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }, []);

  /** 更新指定颜色对 */
  const updatePair = useCallback((id: string, patch: Partial<ColorPair>) => {
    setConfig((prev) => ({
      ...prev,
      pairs: prev.pairs.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  }, []);

  /** 新增颜色对 */
  const addPair = useCallback(() => {
    setConfig((prev) => ({
      ...prev,
      pairs: [
        ...prev.pairs,
        makePair(`color-${prev.pairs.length + 1}`, '', '#1a1a1a', '#e5e5e5'),
      ],
    }));
  }, []);

  /** 删除颜色对 */
  const removePair = useCallback((id: string) => {
    setConfig((prev) => ({
      ...prev,
      pairs: prev.pairs.filter((p) => p.id !== id),
    }));
  }, []);

  /** 应用预设 */
  const applyPreset = useCallback((preset: LightDarkPreset) => {
    // 深拷贝并对每个 pair 重新生成 id，避免 React key 冲突
    const pairs = preset.config.pairs.map((p) => ({
      ...p,
      id: genId('pair'),
    }));
    setConfig({ ...preset.config, pairs });
  }, []);

  /** 生成的 CSS 代码 */
  const cssCode = useMemo(() => buildCss(config), [config]);

  /** 预览 HTML */
  const previewSrcDoc = useMemo(
    () => buildPreviewHtml(config, previewMode),
    [config, previewMode],
  );

  /** 复制 CSS */
  const handleCopy = useCallback(async () => {
    const ok = await copyText(cssCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [cssCode]);

  /** 每个颜色对的对比度信息（与黑白两色对比，作为参考） */
  const contrastInfo = useMemo(() => {
    const white: RGB = { r: 255, g: 255, b: 255 };
    const black: RGB = { r: 0, g: 0, b: 0 };
    return config.pairs.map((pair) => {
      const lightRgb = hexToRgb(pair.lightColor);
      const darkRgb = hexToRgb(pair.darkColor);
      // light 颜色与白色背景对比（模拟浅色模式下的可读性参考）
      const lightVsWhite = lightRgb ? contrastRatio(lightRgb, white) : 0;
      // dark 颜色与黑色背景对比（模拟深色模式下的可读性参考）
      const darkVsBlack = darkRgb ? contrastRatio(darkRgb, black) : 0;
      return {
        id: pair.id,
        lightVsWhite,
        darkVsBlack,
        lightLabel: wcagLabel(lightVsWhite),
        darkLabel: wcagLabel(darkVsBlack),
      };
    });
  }, [config.pairs]);

  /** 原理说明文本 */
  const explainText = useMemo(() => {
    const parts: string[] = [];
    parts.push(
      `当前 color-scheme: <code>${config.colorScheme}</code>，浏览器据此决定 light-dark() 取哪个值。`,
    );
    if (config.colorScheme === 'normal') {
      parts.push('注意：normal 表示不声明颜色方案偏好，light-dark() 将回退到第一个值（浅色）。');
    } else if (config.colorScheme === 'light only') {
      parts.push('注意：light only 强制只使用浅色，light-dark() 始终取第一个值。');
    } else if (config.colorScheme === 'dark only') {
      parts.push('注意：dark only 强制只使用深色，light-dark() 始终取第二个值。');
    } else {
      parts.push(
        '浏览器根据用户的系统偏好（prefers-color-scheme）自动在两个值之间切换，无需写 @media 查询。',
      );
    }
    parts.push(
      '生成的 CSS 变量可在任意位置用 <code>var(--name)</code> 引用，切换主题时无需 JS 重设样式。',
    );
    return parts.join(' ');
  }, [config.colorScheme]);

  return (
    <div className="ldk">
      {/* 预设按钮组 */}
      <div className="ldk__presets">
        <span className="ldk__presets-label">预设：</span>
        {PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            className="ldk__btn ldk__btn--preset"
            onClick={() => applyPreset(p)}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="ldk__main">
        {/* 左：编辑器 */}
        <div className="ldk__editor">
          {/* 全局配置 */}
          <div className="ldk__panel">
            <div className="ldk__panel-head">
              <span className="ldk__panel-title">全局配置</span>
            </div>
            <div className="ldk__panel-body">
              <label className="ldk__field">
                <span className="ldk__field-label">color-scheme</span>
                <select
                  className="ldk__field-select"
                  value={config.colorScheme}
                  onChange={(e) => updateField('colorScheme', e.target.value)}
                >
                  {COLOR_SCHEMES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ldk__field">
                <span className="ldk__field-label">根选择器</span>
                <input
                  className="ldk__field-input"
                  type="text"
                  value={config.rootSelector}
                  placeholder=":root"
                  onChange={(e) => updateField('rootSelector', e.target.value)}
                />
              </label>
              <label className="ldk__field ldk__field--check">
                <input
                  type="checkbox"
                  checked={config.generateUsageExample}
                  onChange={(e) => updateField('generateUsageExample', e.target.checked)}
                />
                <span>生成使用示例（推荐勾选）</span>
              </label>
            </div>
          </div>

          {/* 颜色对编辑 */}
          <div className="ldk__panel">
            <div className="ldk__panel-head">
              <span className="ldk__panel-title">颜色对（{config.pairs.length}）</span>
              <button type="button" className="ldk__btn ldk__btn--add" onClick={addPair}>
                + 新增颜色对
              </button>
            </div>
            <div className="ldk__panel-body">
              {config.pairs.length === 0 && (
                <p className="ldk__empty">暂无颜色对，点击"新增颜色对"添加。</p>
              )}
              {config.pairs.map((pair, idx) => {
                const contrast = contrastInfo.find((c) => c.id === pair.id);
                return (
                  <div key={pair.id} className="ldk__pair">
                    <div className="ldk__pair-head">
                      <span className="ldk__pair-idx" title="颜色对序号">
                        {idx + 1}
                      </span>
                      <input
                        className="ldk__pair-name"
                        type="text"
                        value={pair.name}
                        placeholder="变量名，如 text-primary"
                        onChange={(e) => updatePair(pair.id, { name: e.target.value })}
                      />
                      <button
                        type="button"
                        className="ldk__btn ldk__btn--del"
                        onClick={() => removePair(pair.id)}
                        aria-label="删除该颜色对"
                      >
                        ×
                      </button>
                    </div>
                    <input
                      className="ldk__pair-desc"
                      type="text"
                      value={pair.description}
                      placeholder="用途说明（可选，如 主文本）"
                      onChange={(e) => updatePair(pair.id, { description: e.target.value })}
                    />
                    <div className="ldk__pair-colors">
                      <label className="ldk__pair-color">
                        <span className="ldk__pair-color-label">浅色模式</span>
                        <div className="ldk__pair-color-row">
                          <input
                            type="color"
                            value={pair.lightColor}
                            onChange={(e) => updatePair(pair.id, { lightColor: e.target.value })}
                          />
                          <input
                            className="ldk__pair-color-hex"
                            type="text"
                            value={pair.lightColor}
                            onChange={(e) => updatePair(pair.id, { lightColor: e.target.value })}
                          />
                        </div>
                        {contrast && (
                          <span className="ldk__pair-contrast" title="与白色背景对比度（浅色模式参考）">
                            vs 白：{contrast.lightVsWhite.toFixed(2)} · {contrast.lightLabel}
                          </span>
                        )}
                      </label>
                      <label className="ldk__pair-color">
                        <span className="ldk__pair-color-label">深色模式</span>
                        <div className="ldk__pair-color-row">
                          <input
                            type="color"
                            value={pair.darkColor}
                            onChange={(e) => updatePair(pair.id, { darkColor: e.target.value })}
                          />
                          <input
                            className="ldk__pair-color-hex"
                            type="text"
                            value={pair.darkColor}
                            onChange={(e) => updatePair(pair.id, { darkColor: e.target.value })}
                          />
                        </div>
                        {contrast && (
                          <span className="ldk__pair-contrast" title="与黑色背景对比度（深色模式参考）">
                            vs 黑：{contrast.darkVsBlack.toFixed(2)} · {contrast.darkLabel}
                          </span>
                        )}
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 原理说明 */}
          <div className="ldk__panel ldk__panel--explain">
            <div className="ldk__panel-head">
              <span className="ldk__panel-title">原理说明</span>
            </div>
            <div className="ldk__panel-body">
              <p className="ldk__explain" dangerouslySetInnerHTML={{ __html: explainText }} />
              <p className="ldk__explain ldk__explain--tip">
                <strong>核心规则：</strong>
                <code>light-dark()</code> 必须配合 <code>color-scheme</code> 声明才生效。
                <code>light dark</code> 表示两种方案都支持，浏览器按系统偏好自动切换；
                <code>light only</code> / <code>dark only</code> 强制单方案。
              </p>
            </div>
          </div>
        </div>

        {/* 右：预览 + 代码 */}
        <div className="ldk__output">
          {/* 预览模式切换 */}
          <div className="ldk__preview-tabs">
            <span className="ldk__preview-tabs-label">预览模式：</span>
            {(['auto', 'light', 'dark'] as PreviewMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={`ldk__btn ldk__btn--tab ${previewMode === m ? 'is-active' : ''}`}
                onClick={() => setPreviewMode(m)}
              >
                {m === 'auto' ? '自动' : m === 'light' ? '强制浅色' : '强制深色'}
              </button>
            ))}
          </div>

          {/* iframe 沙箱预览 */}
          <div className="ldk__preview">
            <div className="ldk__preview-head">
              <span className="ldk__preview-title">实时预览</span>
            </div>
            <iframe
              className="ldk__iframe"
              srcDoc={previewSrcDoc}
              title="light-dark() 预览"
              sandbox="allow-same-origin"
            />
          </div>

          {/* 代码输出 */}
          <div className="ldk__code">
            <div className="ldk__code-head">
              <span className="ldk__code-title">生成的 CSS</span>
              <button type="button" className="ldk__btn ldk__btn--copy" onClick={handleCopy}>
                {copied ? '已复制' : '复制 CSS'}
              </button>
            </div>
            <pre className="ldk__code-pre">
              <code>{cssCode}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
