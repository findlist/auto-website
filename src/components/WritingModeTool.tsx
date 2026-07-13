import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS writing-mode 书写模式生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 容器属性：writing-mode、text-orientation、direction、text-combine-upright
 *  - 排版属性：font-size、line-height、letter-spacing、padding
 *  - 可编辑预览区，真实应用 writing-mode 直观体验竖排/横排效果
 *  - 8 组预设（默认横排 / 竖排中文 / 竖排日文 / 阿拉伯文 RTL / 蒙古文 /
 *           古籍竖排 / 现代杂志 / 数字横排）
 *  - 实时生成 CSS 代码，一键复制
 */

/** 书写模式：决定文本流的方向 */
type WritingMode =
  | 'horizontal-tb' // 水平从上到下（默认）
  | 'vertical-rl'   // 垂直从右到左（中文/日文传统竖排）
  | 'vertical-lr'   // 垂直从左到右（蒙古文）
  | 'sideways-rl'  // 侧向从右到左
  | 'sideways-lr'; // 侧向从左到右

/** 文字朝向：仅在 vertical-* 模式下有效 */
type TextOrientation = 'mixed' | 'upright' | 'sideways';

/** 文本方向 */
type Direction = 'ltr' | 'rtl';

/** 纵向排版中的横向数字组合 */
type TextCombine = 'none' | 'all' | 'digits';

/** 完整书写模式配置 */
interface WritingModeConfig {
  writingMode: WritingMode;
  textOrientation: TextOrientation;
  direction: Direction;
  textCombine: TextCombine;
  digitsValue: number; // 2-4，仅 textCombine = 'digits' 时有效
  fontSize: number;    // 14-48px
  lineHeight: number;  // 1.0-3.0（步进 0.1）
  letterSpacing: number; // -2 to 16px
  padding: number;    // 0-40px
}

/** 预设布局 */
interface WritingModePreset {
  name: string;
  config: Partial<WritingModeConfig>;
}

// 8 组预设，覆盖 writing-mode 最常见的应用场景
const PRESETS: WritingModePreset[] = [
  {
    name: '默认横排',
    config: {
      writingMode: 'horizontal-tb',
      textOrientation: 'mixed',
      direction: 'ltr',
      textCombine: 'none',
      fontSize: 18,
      lineHeight: 1.8,
      letterSpacing: 0,
      padding: 16,
    },
  },
  {
    name: '竖排中文',
    config: {
      writingMode: 'vertical-rl',
      textOrientation: 'upright',
      direction: 'ltr',
      textCombine: 'none',
      fontSize: 22,
      lineHeight: 1.6,
      letterSpacing: 4,
      padding: 24,
    },
  },
  {
    name: '竖排日文',
    config: {
      writingMode: 'vertical-rl',
      textOrientation: 'mixed',
      direction: 'ltr',
      textCombine: 'none',
      fontSize: 20,
      lineHeight: 1.8,
      letterSpacing: 0,
      padding: 20,
    },
  },
  {
    name: '阿拉伯文 RTL',
    config: {
      writingMode: 'horizontal-tb',
      textOrientation: 'mixed',
      direction: 'rtl',
      textCombine: 'none',
      fontSize: 20,
      lineHeight: 1.8,
      letterSpacing: 0,
      padding: 16,
    },
  },
  {
    name: '蒙古文',
    config: {
      writingMode: 'vertical-lr',
      textOrientation: 'sideways',
      direction: 'ltr',
      textCombine: 'none',
      fontSize: 20,
      lineHeight: 1.5,
      letterSpacing: 0,
      padding: 20,
    },
  },
  {
    name: '古籍竖排',
    config: {
      writingMode: 'vertical-rl',
      textOrientation: 'upright',
      direction: 'ltr',
      textCombine: 'none',
      fontSize: 26,
      lineHeight: 1.4,
      letterSpacing: 8,
      padding: 32,
    },
  },
  {
    name: '现代杂志',
    config: {
      writingMode: 'vertical-rl',
      textOrientation: 'mixed',
      direction: 'ltr',
      textCombine: 'none',
      fontSize: 32,
      lineHeight: 1.6,
      letterSpacing: 2,
      padding: 24,
    },
  },
  {
    name: '数字横排',
    config: {
      writingMode: 'vertical-rl',
      textOrientation: 'mixed',
      direction: 'ltr',
      textCombine: 'digits',
      digitsValue: 2,
      fontSize: 20,
      lineHeight: 1.8,
      letterSpacing: 0,
      padding: 20,
    },
  },
];

// 默认配置：标准中文横排
const DEFAULT_CONFIG: WritingModeConfig = {
  writingMode: 'horizontal-tb',
  textOrientation: 'mixed',
  direction: 'ltr',
  textCombine: 'none',
  digitsValue: 2,
  fontSize: 18,
  lineHeight: 1.8,
  letterSpacing: 0,
  padding: 16,
};

// 默认预览文本：中英数混排，便于观察 writing-mode 效果
const DEFAULT_TEXT = '工具盒子 Toolbox\n2026 年中文开发者工具集\n编号 12345678\n所有处理在浏览器本地完成';

/** 泛型分段按钮组，用于枚举类型属性选择 */
function SegGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; text: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="wm__seg-group" aria-label={label}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`wm__seg-btn${opt.value === value ? ' is-active' : ''}`}
          onClick={() => onChange(opt.value)}
          disabled={disabled}
        >
          {opt.text}
        </button>
      ))}
    </div>
  );
}

/** 判断当前模式是否为垂直方向（vertical-* 或 sideways-*） */
function isVerticalMode(mode: WritingMode): boolean {
  return mode === 'vertical-rl' || mode === 'vertical-lr'
    || mode === 'sideways-rl' || mode === 'sideways-lr';
}

/** 生成完整 CSS 代码（仅输出非默认值） */
function buildCss(c: WritingModeConfig): string {
  const lines: string[] = [];
  // writing-mode：非默认 horizontal-tb 时输出
  if (c.writingMode !== 'horizontal-tb') {
    lines.push(`writing-mode: ${c.writingMode};`);
  }
  // text-orientation：仅在 vertical 模式下且非默认 mixed 时输出
  if (isVerticalMode(c.writingMode) && c.textOrientation !== 'mixed') {
    lines.push(`text-orientation: ${c.textOrientation};`);
  }
  // direction：非默认 ltr 时输出
  if (c.direction !== 'ltr') {
    lines.push(`direction: ${c.direction};`);
  }
  // text-combine-upright：仅在 vertical 模式下且非默认 none 时输出
  if (isVerticalMode(c.writingMode) && c.textCombine !== 'none') {
    if (c.textCombine === 'digits') {
      lines.push(`text-combine-upright: digits ${c.digitsValue};`);
    } else {
      lines.push(`text-combine-upright: ${c.textCombine};`);
    }
  }
  // 字号、行高、字距、内边距
  if (c.fontSize !== 18) lines.push(`font-size: ${c.fontSize}px;`);
  if (c.lineHeight !== 1.8) lines.push(`line-height: ${c.lineHeight};`);
  if (c.letterSpacing !== 0) lines.push(`letter-spacing: ${c.letterSpacing}px;`);
  if (c.padding !== 16) lines.push(`padding: ${c.padding}px;`);
  return lines.join('\n');
}

export default function WritingModeTool() {
  const [config, setConfig] = useState<WritingModeConfig>(DEFAULT_CONFIG);
  const [text, setText] = useState<string>(DEFAULT_TEXT);
  const [copied, setCopied] = useState(false);

  const isVertical = isVerticalMode(config.writingMode);

  // 应用预设
  const applyPreset = useCallback((preset: WritingModePreset) => {
    setConfig((prev) => ({ ...prev, ...preset.config }));
  }, []);

  // 更新单个配置项
  const update = useCallback(<K extends keyof WritingModeConfig>(
    key: K,
    value: WritingModeConfig[K],
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }, []);

  // 生成 CSS 代码
  const cssCode = useMemo(() => {
    const css = buildCss(config);
    // 若全为默认值，给出提示
    if (!css) return '/* 当前为默认横排，无需额外 CSS */';
    return `.writing-mode {\n  ${css.replace(/\n/g, '\n  ')}\n}`;
  }, [config]);

  // 复制代码
  const handleCopy = useCallback(async () => {
    const ok = await copyText(cssCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [cssCode]);

  // 预览区样式：直接应用所有 writing-mode 相关属性
  const previewStyle = useMemo<React.CSSProperties>(() => {
    const style: React.CSSProperties = {
      writingMode: config.writingMode,
      direction: config.direction,
      fontSize: `${config.fontSize}px`,
      lineHeight: config.lineHeight,
      padding: `${config.padding}px`,
    };
    // text-orientation 仅在垂直模式下生效
    if (isVertical) {
      style.textOrientation = config.textOrientation;
      // text-combine-upright
      if (config.textCombine === 'digits') {
        style.textCombineUpright = `digits ${config.digitsValue}` as React.CSSProperties['textCombineUpright'];
      } else if (config.textCombine === 'all') {
        style.textCombineUpright = 'all';
      }
    }
    // 字距：横排为字间距，竖排为字间距（垂直方向）
    if (config.letterSpacing !== 0) {
      style.letterSpacing = `${config.letterSpacing}px`;
    }
    return style;
  }, [config, isVertical]);

  return (
    <div className="wm">
      {/* 预设按钮组 */}
      <div className="wm__presets">
        <span className="wm__presets-label">预设：</span>
        {PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            className="wm__preset-btn"
            onClick={() => applyPreset(p)}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="wm__main">
        {/* 左侧：预览区 + 文本编辑 */}
        <div className="wm__left">
          <div className="wm__preview-wrap">
            <div className="wm__preview-hint">
              <span>实时预览（可拖动选择文本，下方文本框可编辑）</span>
            </div>
            <div className="wm__preview-scroll">
              <div className="wm__preview" style={previewStyle}>
                {text.split('\n').map((line, i) => (
                  <p key={i} className="wm__preview-line">{line}</p>
                ))}
              </div>
            </div>
            <textarea
              className="wm__text-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder="在此输入预览文本（支持中英数混排，回车换行）"
              aria-label="预览文本输入"
            />
          </div>
        </div>

        {/* 右侧：配置面板 + 代码输出 */}
        <div className="wm__right">
          <div className="wm__panel">
            <h3 className="wm__panel-title">书写模式属性</h3>
            <div className="wm__field">
              <label className="wm__field-label">writing-mode（书写方向）</label>
              <SegGroup<WritingMode>
                label="书写模式"
                value={config.writingMode}
                options={[
                  { value: 'horizontal-tb', text: 'horizontal-tb' },
                  { value: 'vertical-rl', text: 'vertical-rl' },
                  { value: 'vertical-lr', text: 'vertical-lr' },
                  { value: 'sideways-rl', text: 'sideways-rl' },
                  { value: 'sideways-lr', text: 'sideways-lr' },
                ]}
                onChange={(v) => update('writingMode', v)}
              />
            </div>
            <div className="wm__field">
              <label className="wm__field-label">
                text-orientation（文字朝向）
                {!isVertical && <span className="wm__hint">仅 vertical 模式下生效</span>}
              </label>
              <SegGroup<TextOrientation>
                label="文字朝向"
                value={config.textOrientation}
                options={[
                  { value: 'mixed', text: 'mixed' },
                  { value: 'upright', text: 'upright' },
                  { value: 'sideways', text: 'sideways' },
                ]}
                onChange={(v) => update('textOrientation', v)}
                disabled={!isVertical}
              />
            </div>
            <div className="wm__field">
              <label className="wm__field-label">direction（文本方向）</label>
              <SegGroup<Direction>
                label="文本方向"
                value={config.direction}
                options={[
                  { value: 'ltr', text: 'ltr（从左到右）' },
                  { value: 'rtl', text: 'rtl（从右到左）' },
                ]}
                onChange={(v) => update('direction', v)}
              />
            </div>
            <div className="wm__field">
              <label className="wm__field-label">
                text-combine-upright（数字横排）
                {!isVertical && <span className="wm__hint">仅 vertical 模式下生效</span>}
              </label>
              <SegGroup<TextCombine>
                label="数字横排"
                value={config.textCombine}
                options={[
                  { value: 'none', text: 'none' },
                  { value: 'all', text: 'all' },
                  { value: 'digits', text: 'digits' },
                ]}
                onChange={(v) => update('textCombine', v)}
                disabled={!isVertical}
              />
              {config.textCombine === 'digits' && isVertical && (
                <div className="wm__field wm__field--inline">
                  <label className="wm__field-label">
                    位数：<span className="wm__value">{config.digitsValue}</span>
                  </label>
                  <input
                    type="range"
                    min={2}
                    max={4}
                    step={1}
                    value={config.digitsValue}
                    onChange={(e) => update('digitsValue', Number(e.target.value))}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="wm__panel">
            <h3 className="wm__panel-title">排版属性</h3>
            <div className="wm__field">
              <label className="wm__field-label">
                font-size：<span className="wm__value">{config.fontSize}px</span>
              </label>
              <input
                type="range"
                min={14}
                max={48}
                value={config.fontSize}
                onChange={(e) => update('fontSize', Number(e.target.value))}
              />
            </div>
            <div className="wm__field">
              <label className="wm__field-label">
                line-height：<span className="wm__value">{config.lineHeight.toFixed(1)}</span>
              </label>
              <input
                type="range"
                min={1.0}
                max={3.0}
                step={0.1}
                value={config.lineHeight}
                onChange={(e) => update('lineHeight', Number(e.target.value))}
              />
            </div>
            <div className="wm__field">
              <label className="wm__field-label">
                letter-spacing：<span className="wm__value">{config.letterSpacing}px</span>
              </label>
              <input
                type="range"
                min={-2}
                max={16}
                value={config.letterSpacing}
                onChange={(e) => update('letterSpacing', Number(e.target.value))}
              />
            </div>
            <div className="wm__field">
              <label className="wm__field-label">
                padding：<span className="wm__value">{config.padding}px</span>
              </label>
              <input
                type="range"
                min={0}
                max={40}
                value={config.padding}
                onChange={(e) => update('padding', Number(e.target.value))}
              />
            </div>
          </div>

          {/* 代码输出 */}
          <div className="wm__code">
            <div className="wm__code-head">
              <span>CSS 代码</span>
              <button
                type="button"
                className={`wm__copy-btn${copied ? ' is-copied' : ''}`}
                onClick={handleCopy}
              >
                {copied ? '已复制' : '复制'}
              </button>
            </div>
            <pre className="wm__code-block">
              <code>{cssCode}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
