import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS text-wrap 文本换行排版优化生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 完整支持 text-wrap 五种值：wrap / nowrap / balance / pretty / stable
 *  - 可编辑预览文本（标题/段落两种模式）
 *  - 排版参数调节：容器宽度、字号、行高、字体族、对齐方式、字重
 *  - 单值预览 + 三值对比模式（wrap / balance / pretty 并排展示换行差异）
 *  - 原理说明面板：解析各值的算法原理与适用场景
 *  - 6 组预设覆盖标题平衡、段落优化、不换行标签等场景
 *  - 一键复制生成的 CSS 代码
 *
 * 核心知识点：
 *  - text-wrap 是 CSS Text Module Level 4 引入的属性（2023-2024 年逐步落地）
 *  - balance：平衡换行，让各行长度均衡，限制最多 10 行，适合标题（Chrome 114+）
 *  - pretty：优化换行，避免孤行，适合段落（Chrome 117+）
 *  - stable：稳定换行，编辑场景不重排，适合 contenteditable
 *  - nowrap：不换行，需配合 overflow 处理
 */

/** text-wrap 属性可选值 */
type TextWrapValue = 'wrap' | 'nowrap' | 'balance' | 'pretty' | 'stable';

/** 预览模式：单值预览 / 三值对比 */
type PreviewMode = 'single' | 'compare';

/** 排版配置 */
interface TypographyConfig {
  fontSize: number;       // 字号 px
  lineHeight: number;     // 行高
  fontFamily: string;     // 字体族
  textAlign: string;      // 文本对齐
  fontWeight: number;     // 字重
  containerWidth: number; // 容器宽度 px
  padding: number;        // 内边距 px
}

/** 完整工具配置 */
interface TextWrapConfig {
  value: TextWrapValue;   // text-wrap 值
  selector: string;       // CSS 选择器
  typography: TypographyConfig;
}

/** 预设：名称 + 描述 + 文本 + 配置 */
interface TextWrapPreset {
  name: string;
  description: string;
  text: string;
  config: TextWrapConfig;
}

/** text-wrap 可选值及说明 */
const TEXT_WRAP_VALUES: { value: TextWrapValue; label: string; short: string }[] = [
  { value: 'wrap', label: 'wrap（默认，正常换行）', short: 'wrap' },
  { value: 'nowrap', label: 'nowrap（不换行）', short: 'nowrap' },
  { value: 'balance', label: 'balance（平衡换行，适合标题）', short: 'balance' },
  { value: 'pretty', label: 'pretty（优化换行，避免孤行）', short: 'pretty' },
  { value: 'stable', label: 'stable（稳定换行，适合编辑）', short: 'stable' },
];

/** 字体族选项 */
const FONT_FAMILIES = [
  { value: "system-ui, -apple-system, sans-serif", label: '系统默认（无衬线）' },
  { value: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif", label: '中文无衬线' },
  { value: "'Noto Serif SC', 'Source Han Serif SC', serif", label: '中文衬线' },
  { value: "'Courier New', 'Consolas', monospace", label: '等宽字体' },
  { value: "Georgia, 'Times New Roman', serif", label: '英文衬线' },
];

/** 文本对齐选项 */
const ALIGN_OPTIONS = [
  { value: 'left', label: '左对齐' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '右对齐' },
  { value: 'justify', label: '两端对齐' },
];

/** 默认标题文本（用于展示 balance 效果） */
const DEFAULT_TITLE_TEXT =
  'CSS text-wrap 属性让标题换行更优雅，告别参差不齐的排版';

/** 默认段落文本（用于展示 pretty 效果） */
const DEFAULT_PARAGRAPH_TEXT =
  '在前端开发中，文本换行是一个看似简单却影响阅读体验的细节。传统的 text-wrap: wrap 按照容器宽度逐行填充文字，虽然高效但容易出现最后一行只剩一个词的孤行问题。CSS Text Module Level 4 引入了 text-wrap 属性，其中 balance 值能让标题各行长度更均衡，pretty 值能优化段落换行避免孤行，显著提升排版质量。';

/** 6 组预设，覆盖 text-wrap 最常见应用场景 */
const PRESETS: TextWrapPreset[] = [
  {
    name: '标题平衡',
    description: 'balance 让标题各行长度均衡，避免最后一行只剩几个字',
    text: DEFAULT_TITLE_TEXT,
    config: {
      value: 'balance',
      selector: '.title',
      typography: {
        fontSize: 28,
        lineHeight: 1.3,
        fontFamily: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
        textAlign: 'left',
        fontWeight: 700,
        containerWidth: 420,
        padding: 24,
      },
    },
  },
  {
    name: '段落优化',
    description: 'pretty 避免段落最后一行出现孤行（单个词独占一行）',
    text: DEFAULT_PARAGRAPH_TEXT,
    config: {
      value: 'pretty',
      selector: '.paragraph',
      typography: {
        fontSize: 16,
        lineHeight: 1.8,
        fontFamily: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
        textAlign: 'left',
        fontWeight: 400,
        containerWidth: 420,
        padding: 24,
      },
    },
  },
  {
    name: '不换行标签',
    description: 'nowrap 让短文本标签强制不换行，配合 overflow 处理溢出',
    text: '这是一个不可换行的标签文本示例',
    config: {
      value: 'nowrap',
      selector: '.tag',
      typography: {
        fontSize: 14,
        lineHeight: 1.5,
        fontFamily: "system-ui, -apple-system, sans-serif",
        textAlign: 'left',
        fontWeight: 500,
        containerWidth: 200,
        padding: 12,
      },
    },
  },
  {
    name: '卡片标题',
    description: 'balance 用于卡片标题，让多行标题更紧凑美观',
    text: '2026 年前端开发趋势：AI 辅助编码与原生 CSS 新特性',
    config: {
      value: 'balance',
      selector: '.card-title',
      typography: {
        fontSize: 20,
        lineHeight: 1.4,
        fontFamily: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
        textAlign: 'left',
        fontWeight: 600,
        containerWidth: 320,
        padding: 20,
      },
    },
  },
  {
    name: '文章正文',
    description: 'wrap 默认换行，适合一般正文场景',
    text: DEFAULT_PARAGRAPH_TEXT,
    config: {
      value: 'wrap',
      selector: '.article-body',
      typography: {
        fontSize: 16,
        lineHeight: 1.8,
        fontFamily: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
        textAlign: 'left',
        fontWeight: 400,
        containerWidth: 520,
        padding: 24,
      },
    },
  },
  {
    name: '三值对比',
    description: '并排对比 wrap / balance / pretty 的换行效果差异',
    text: 'CSS text-wrap balance 让标题换行更均衡，避免最后一行只剩几个字的尴尬排版',
    config: {
      value: 'balance',
      selector: '.title',
      typography: {
        fontSize: 24,
        lineHeight: 1.4,
        fontFamily: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
        textAlign: 'left',
        fontWeight: 600,
        containerWidth: 360,
        padding: 20,
      },
    },
  },
];

/** 默认配置 */
const DEFAULT_CONFIG: TextWrapConfig = PRESETS[0].config;

/**
 * 生成 CSS 代码
 * 根据当前配置生成完整的 text-wrap CSS 声明
 */
function buildCss(cfg: TextWrapConfig): string {
  const sel = cfg.selector.trim() || '.text';
  const t = cfg.typography;
  const lines: string[] = [];
  lines.push(`${sel} {`);
  lines.push(`  text-wrap: ${cfg.value};`);
  lines.push(`  font-size: ${t.fontSize}px;`);
  lines.push(`  line-height: ${t.lineHeight};`);
  lines.push(`  font-family: ${t.fontFamily};`);
  lines.push(`  text-align: ${t.textAlign};`);
  lines.push(`  font-weight: ${t.fontWeight};`);
  // nowrap 场景补充溢出处理建议
  if (cfg.value === 'nowrap') {
    lines.push(`  overflow: hidden;`);
    lines.push(`  text-overflow: ellipsis;`);
    lines.push(`  white-space: nowrap; /* 兼容旧浏览器 */`);
  }
  lines.push(`}`);
  return lines.join('\n');
}

/**
 * 生成原理说明
 * 解析当前 text-wrap 值的算法原理与适用场景
 */
function buildExplain(value: TextWrapValue): { title: string; body: string; tip: string } {
  const map: Record<TextWrapValue, { title: string; body: string; tip: string }> = {
    wrap: {
      title: 'wrap · 默认换行',
      body: '浏览器默认的换行算法：文本按容器宽度逐行填充，填满一行后换行。算法简单高效，但可能出现孤行——最后一行只剩一个词或几个字，视觉上不均衡。',
      tip: '适合一般正文场景。如果发现最后一行不均衡，可尝试 balance（标题）或 pretty（段落）。',
    },
    nowrap: {
      title: 'nowrap · 不换行',
      body: '禁止文本换行，所有内容强制在一行内。超出容器宽度的部分会被截断或溢出，需配合 overflow: hidden 和 text-overflow: ellipsis 处理。',
      tip: '适合标签、按钮文本、导航项等短文本场景。注意兼容旧浏览器需同时写 white-space: nowrap。',
    },
    balance: {
      title: 'balance · 平衡换行',
      body: '浏览器计算最优断行点，让各行长度尽量均衡。算法限制最多 10 行（超过则退化为 wrap），因此适合标题、引言等短文本块，不适合长段落。',
      tip: '适合 h1-h6 标题、卡片标题、引言。Chrome 114+ / Firefox 121+ / Safari 17.5+ 支持。',
    },
    pretty: {
      title: 'pretty · 优化换行',
      body: '在 wrap 基础上优化断行策略，避免孤行——即避免最后一行只剩一个词。浏览器会提前将上一个词换到下一行，让末行更充实。',
      tip: '适合段落正文。目前 Chrome 117+ 支持，Firefox/Safari 暂不支持（降级为 wrap）。',
    },
    stable: {
      title: 'stable · 稳定换行',
      body: '编辑场景专用：在 contenteditable 中输入文字时，光标后面的行不会因新增字符而重新换行，保持前面行的稳定性。避免编辑时文本跳动。',
      tip: '适合 contenteditable 编辑区、输入框。Firefox 支持，Chrome 暂不支持。',
    },
  };
  return map[value];
}

/** 对比模式展示的三个值 */
const COMPARE_VALUES: TextWrapValue[] = ['wrap', 'balance', 'pretty'];

/** 主组件 */
export default function TextWrapTool() {
  const [config, setConfig] = useState<TextWrapConfig>(DEFAULT_CONFIG);
  const [text, setText] = useState<string>(DEFAULT_TITLE_TEXT);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('single');
  const [copied, setCopied] = useState(false);

  // 生成的 CSS 代码（useMemo 避免每次渲染重复计算）
  const cssCode = useMemo(() => buildCss(config), [config]);

  // 原理说明
  const explain = useMemo(() => buildExplain(config.value), [config.value]);

  // 预览区内联样式
  const previewStyle = useMemo(() => {
    const t = config.typography;
    return {
      fontSize: `${t.fontSize}px`,
      lineHeight: t.lineHeight,
      fontFamily: t.fontFamily,
      textAlign: t.textAlign as React.CSSProperties['textAlign'],
      fontWeight: t.fontWeight,
      width: `${t.containerWidth}px`,
      maxWidth: '100%',
      padding: `${t.padding}px`,
    } as React.CSSProperties;
  }, [config.typography]);

  // 复制 CSS 代码
  const handleCopy = useCallback(async () => {
    const ok = await copyText(cssCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [cssCode]);

  // 应用预设
  const applyPreset = useCallback((preset: TextWrapPreset) => {
    setConfig(preset.config);
    setText(preset.text);
    // 三值对比预设自动切换到对比模式
    setPreviewMode(preset.name === '三值对比' ? 'compare' : 'single');
  }, []);

  // 更新 text-wrap 值
  const updateValue = useCallback((value: TextWrapValue) => {
    setConfig((prev) => ({ ...prev, value }));
  }, []);

  // 更新排版参数
  const updateTypography = useCallback(
    <K extends keyof TypographyConfig>(key: K, val: TypographyConfig[K]) => {
      setConfig((prev) => ({
        ...prev,
        typography: { ...prev.typography, [key]: val },
      }));
    },
    [],
  );

  // 更新选择器
  const updateSelector = useCallback((selector: string) => {
    setConfig((prev) => ({ ...prev, selector }));
  }, []);

  return (
    <div className="twp">
      {/* 预设按钮组 */}
      <div className="twp__presets">
        <span className="twp__presets-label">预设场景：</span>
        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            className="twp__preset-btn"
            onClick={() => applyPreset(preset)}
            title={preset.description}
          >
            {preset.name}
          </button>
        ))}
      </div>

      <div className="twp__main">
        {/* 左栏：配置面板 */}
        <div className="twp__config">
          {/* text-wrap 值选择 */}
          <div className="twp__panel">
            <h3 className="twp__panel-title">text-wrap 值</h3>
            <div className="twp__radio-group">
              {TEXT_WRAP_VALUES.map((item) => (
                <label key={item.value} className="twp__radio">
                  <input
                    type="radio"
                    name="text-wrap-value"
                    value={item.value}
                    checked={config.value === item.value}
                    onChange={() => updateValue(item.value)}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* CSS 选择器 */}
          <div className="twp__panel">
            <h3 className="twp__panel-title">CSS 选择器</h3>
            <input
              type="text"
              className="twp__input"
              value={config.selector}
              onChange={(e) => updateSelector(e.target.value)}
              placeholder=".title"
            />
          </div>

          {/* 排版参数 */}
          <div className="twp__panel">
            <h3 className="twp__panel-title">排版参数</h3>
            <div className="twp__field">
              <label className="twp__field-label">
                容器宽度
                <span className="twp__field-value">{config.typography.containerWidth}px</span>
              </label>
              <input
                type="range"
                min={160}
                max={720}
                step={10}
                value={config.typography.containerWidth}
                onChange={(e) => updateTypography('containerWidth', Number(e.target.value))}
              />
            </div>
            <div className="twp__field">
              <label className="twp__field-label">
                字号
                <span className="twp__field-value">{config.typography.fontSize}px</span>
              </label>
              <input
                type="range"
                min={12}
                max={48}
                step={1}
                value={config.typography.fontSize}
                onChange={(e) => updateTypography('fontSize', Number(e.target.value))}
              />
            </div>
            <div className="twp__field">
              <label className="twp__field-label">
                行高
                <span className="twp__field-value">{config.typography.lineHeight}</span>
              </label>
              <input
                type="range"
                min={1.1}
                max={2.4}
                step={0.1}
                value={config.typography.lineHeight}
                onChange={(e) => updateTypography('lineHeight', Number(e.target.value))}
              />
            </div>
            <div className="twp__field">
              <label className="twp__field-label">
                字重
                <span className="twp__field-value">{config.typography.fontWeight}</span>
              </label>
              <input
                type="range"
                min={300}
                max={900}
                step={100}
                value={config.typography.fontWeight}
                onChange={(e) => updateTypography('fontWeight', Number(e.target.value))}
              />
            </div>
            <div className="twp__field">
              <label className="twp__field-label">字体族</label>
              <select
                className="twp__select"
                value={config.typography.fontFamily}
                onChange={(e) => updateTypography('fontFamily', e.target.value)}
              >
                {FONT_FAMILIES.map((f) => (
                  <option key={f.label} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="twp__field">
              <label className="twp__field-label">文本对齐</label>
              <select
                className="twp__select"
                value={config.typography.textAlign}
                onChange={(e) => updateTypography('textAlign', e.target.value)}
              >
                {ALIGN_OPTIONS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 文本输入 */}
          <div className="twp__panel">
            <h3 className="twp__panel-title">预览文本</h3>
            <textarea
              className="twp__textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              placeholder="输入要预览的文本内容…"
            />
            <div className="twp__text-actions">
              <button
                type="button"
                className="twp__text-btn"
                onClick={() => setText(DEFAULT_TITLE_TEXT)}
              >
                标题示例
              </button>
              <button
                type="button"
                className="twp__text-btn"
                onClick={() => setText(DEFAULT_PARAGRAPH_TEXT)}
              >
                段落示例
              </button>
            </div>
          </div>
        </div>

        {/* 右栏：预览 + 原理 + 代码 */}
        <div className="twp__output">
          {/* 预览模式切换 */}
          <div className="twp__preview-tabs">
            <button
              type="button"
              className={`twp__tab ${previewMode === 'single' ? 'twp__tab--active' : ''}`}
              onClick={() => setPreviewMode('single')}
            >
              单值预览
            </button>
            <button
              type="button"
              className={`twp__tab ${previewMode === 'compare' ? 'twp__tab--active' : ''}`}
              onClick={() => setPreviewMode('compare')}
            >
              三值对比
            </button>
          </div>

          {/* 预览区 */}
          <div className="twp__preview-area">
            {previewMode === 'single' ? (
              <div className="twp__preview-single">
                <div className="twp__preview-label">
                  text-wrap: <strong>{config.value}</strong>
                </div>
                <div
                  className="twp__preview-box"
                  style={{
                    ...previewStyle,
                    textWrap: config.value as React.CSSProperties['textWrap'],
                    whiteSpace: config.value === 'nowrap' ? 'nowrap' : 'normal',
                    overflow: config.value === 'nowrap' ? 'hidden' : 'visible',
                    textOverflow: config.value === 'nowrap' ? 'ellipsis' : 'clip',
                  }}
                >
                  {text || '请输入预览文本'}
                </div>
              </div>
            ) : (
              <div className="twp__preview-compare">
                {COMPARE_VALUES.map((val) => (
                  <div key={val} className="twp__compare-item">
                    <div className="twp__preview-label">
                      text-wrap: <strong>{val}</strong>
                    </div>
                    <div
                      className="twp__preview-box"
                      style={{
                        ...previewStyle,
                        textWrap: val as React.CSSProperties['textWrap'],
                      }}
                    >
                      {text || '请输入预览文本'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 原理说明 */}
          <div className="twp__explain">
            <h3 className="twp__explain-title">原理说明</h3>
            <div className="twp__explain-body">
              <strong>{explain.title}</strong>
              <p>{explain.body}</p>
            </div>
            <div className="twp__explain-tip">
              <span className="twp__tip-icon">💡</span>
              {explain.tip}
            </div>
          </div>

          {/* 代码输出 */}
          <div className="twp__code-section">
            <div className="twp__code-header">
              <span className="twp__code-title">生成的 CSS</span>
              <button
                type="button"
                className="twp__copy-btn"
                onClick={handleCopy}
                disabled={copied}
              >
                {copied ? '已复制' : '复制代码'}
              </button>
            </div>
            <pre className="twp__code">
              <code>{cssCode}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
