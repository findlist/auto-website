import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';
import {
  type RGB,
  type HarmonyType,
  type ToneType,
  type ColorBlindType,
  type ScaleStandard,
  type ExportFormat,
  HARMONY_META,
  TONE_META,
  COLOR_BLIND_META,
  hexToRgb,
  rgbToHex,
  parseColorInput,
  generateHarmony,
  generateTones,
  generateScale,
  contrastRatio,
  wcagLevel,
  isLightColor,
  simulateColorBlind,
  exportScale,
  exportHarmonyAsCss,
  randomHarmony,
  MAX_INPUT_LENGTH,
} from '../utils/colorPalette';

/**
 * 调色板生成与导出工具
 *
 * 功能分区（5 个 Tab）：
 *  - 和谐方案：6 种基于色环理论的配色方案
 *  - 设计系统色阶：Tailwind 50-950 / Material 100-900
 *  - 明度色调：Tints / Shades / Tones 阶梯
 *  - 可访问性：WCAG 对比度检查 + 色盲模拟
 *  - 随机配色：黄金角度旋转生成均匀分布配色
 *
 * 输入：颜色拾取器 + 文本输入（支持 #hex / rgb() / hsl()）
 * 输出：多格式导出（CSS / Tailwind / SCSS / JSON / Android / iOS）
 *
 * 与 ColorTool 的差异：
 *  - ColorTool 侧重格式互转，本工具侧重调色板生成与可访问性
 */

/** Tab 类型 */
type TabKey = 'harmony' | 'scale' | 'tones' | 'accessibility' | 'random';

/** Tab 元数据 */
const TABS: { key: TabKey; label: string; desc: string }[] = [
  { key: 'harmony', label: '和谐方案', desc: '基于色环理论的 6 种配色方案' },
  { key: 'scale', label: '设计系统色阶', desc: 'Tailwind 50-950 / Material 100-900' },
  { key: 'tones', label: '明度色调', desc: 'Tints / Shades / Tones 阶梯' },
  { key: 'accessibility', label: '可访问性', desc: 'WCAG 对比度与色盲模拟' },
  { key: 'random', label: '随机配色', desc: '黄金角度均匀采样' },
];

/** 示例颜色 */
const SAMPLE_COLOR = '#2b6cff';

/** 导出格式选项 */
const EXPORT_FORMATS: { key: ExportFormat; label: string }[] = [
  { key: 'css', label: 'CSS 变量' },
  { key: 'tailwind', label: 'Tailwind' },
  { key: 'scss', label: 'SCSS' },
  { key: 'json', label: 'JSON' },
  { key: 'android', label: 'Android XML' },
  { key: 'ios', label: 'iOS Swift' },
];

/** 单个色块组件：点击设为当前色，复制 HEX */
function ColorSwatch({
  rgb,
  onClick,
  onCopy,
  label,
}: {
  rgb: RGB;
  onClick: (rgb: RGB) => void;
  onCopy: (hex: string) => void;
  label?: string;
}) {
  const hex = rgbToHex(rgb);
  const light = isLightColor(rgb);
  return (
    <div
      className="cpl__swatch"
      style={{ backgroundColor: hex, color: light ? '#1f2937' : '#fff' }}
      onClick={() => onClick(rgb)}
      title={`点击设为当前色：${hex}`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(rgb);
        }
      }}
    >
      {label && <span className="cpl__swatch-label">{label}</span>}
      <span className="cpl__swatch-hex">{hex}</span>
      <button
        type="button"
        className="cpl__swatch-copy"
        onClick={(e) => {
          e.stopPropagation();
          onCopy(hex);
        }}
        aria-label={`复制 ${hex}`}
      >
        复制
      </button>
    </div>
  );
}

export default function ColorPaletteTool() {
  const [input, setInput] = useState<string>('');
  const [currentRgb, setCurrentRgb] = useState<RGB | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('harmony');
  const [harmonyType, setHarmonyType] = useState<HarmonyType>('complementary');
  const [toneType, setToneType] = useState<ToneType>('tints');
  const [scaleStandard, setScaleStandard] = useState<ScaleStandard>('tailwind');
  const [colorBlindType, setColorBlindType] = useState<ColorBlindType>('deuteranopia');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('css');
  const [colorName, setColorName] = useState<string>('primary');
  const [notice, setNotice] = useState<string>('');

  /** 实时解析输入 */
  const parsed = useMemo(() => parseColorInput(input), [input]);

  /** 当前生效颜色：优先用解析结果，否则用上一次保存的 */
  const rgb = parsed.rgb || currentRgb;

  /** 拾色器变化 */
  const handlePicker = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const hex = e.target.value;
    const newRgb = hexToRgb(hex);
    setInput(hex);
    setCurrentRgb(newRgb);
  }, []);

  /** 载入示例 */
  const handleSample = useCallback(() => {
    const newRgb = hexToRgb(SAMPLE_COLOR);
    setInput(SAMPLE_COLOR);
    setCurrentRgb(newRgb);
    setNotice('');
  }, []);

  /** 清空 */
  const handleClear = useCallback(() => {
    setInput('');
    setCurrentRgb(null);
    setNotice('');
  }, []);

  /** 复制文本 */
  const handleCopy = useCallback(async (text: string, label = '已复制') => {
    const ok = await copyText(text);
    setNotice(ok ? `${label}：${text}` : '复制失败，请手动选中复制');
    if (ok) setTimeout(() => setNotice(''), 1800);
  }, []);

  /** 点击色块设为当前色 */
  const handlePickColor = useCallback((newRgb: RGB) => {
    setInput(rgbToHex(newRgb));
    setCurrentRgb(newRgb);
  }, []);

  /** 生成随机配色并取第一个为主色 */
  const handleRandom = useCallback(() => {
    const colors = randomHarmony(1);
    const first = colors[0];
    setInput(rgbToHex(first));
    setCurrentRgb(first);
  }, []);

  // 派生数据
  const harmonyColors = useMemo(() => (rgb ? generateHarmony(rgb, harmonyType) : []), [rgb, harmonyType]);
  const toneColors = useMemo(() => (rgb ? generateTones(rgb, toneType) : []), [rgb, toneType]);
  const scaleColors = useMemo(() => (rgb ? generateScale(rgb, scaleStandard) : []), [rgb, scaleStandard]);
  const randomColors = useMemo(() => randomHarmony(5), [activeTab === 'random' ? input : '']);

  // 可访问性派生数据
  const accessibilityData = useMemo(() => {
    if (!rgb) return null;
    const white: RGB = { r: 255, g: 255, b: 255 };
    const black: RGB = { r: 0, g: 0, b: 0 };
    const ratioWhite = contrastRatio(rgb, white);
    const ratioBlack = contrastRatio(rgb, black);
    return {
      ratioWhite,
      ratioBlack,
      levelWhite: wcagLevel(ratioWhite),
      levelBlack: wcagLevel(ratioBlack),
      levelWhiteLarge: wcagLevel(ratioWhite, true),
      levelBlackLarge: wcagLevel(ratioBlack, true),
      simulated: simulateColorBlind(rgb, colorBlindType),
    };
  }, [rgb, colorBlindType]);

  // 导出文本
  const exportText = useMemo(() => {
    if (!rgb) return '';
    if (activeTab === 'scale' && scaleColors.length > 0) {
      return exportScale(scaleColors, colorName || 'primary', exportFormat);
    }
    if (activeTab === 'harmony' && harmonyColors.length > 0) {
      return exportHarmonyAsCss(harmonyColors, colorName || 'palette');
    }
    if (activeTab === 'tones' && toneColors.length > 0) {
      // 将当前色与色调阶梯合并导出
      const all = [rgb, ...toneColors];
      return exportHarmonyAsCss(all, colorName || 'tones');
    }
    if (activeTab === 'random' && randomColors.length > 0) {
      return exportHarmonyAsCss(randomColors, colorName || 'random');
    }
    return '';
  }, [rgb, activeTab, scaleColors, harmonyColors, toneColors, randomColors, colorName, exportFormat]);

  const currentHex = rgb ? rgbToHex(rgb) : '#ffffff';
  const hasInput = input.trim() !== '';
  const overLimit = input.length > MAX_INPUT_LENGTH;

  return (
    <div className="jsontool cpl">
      {/* 输入区 */}
      <div className="cpl__input-area">
        <div className="cpl__input-head">
          <label htmlFor="cpl-input" className="cpl__label">基础颜色</label>
          <div className="jsontool__actions">
            <button type="button" className="btn btn--sm" onClick={handleSample}>示例</button>
            <button type="button" className="btn btn--sm" onClick={handleClear}>清空</button>
          </div>
        </div>
        <div className="cpl__input-row">
          <input
            type="color"
            className="cpl__picker"
            value={currentHex}
            onChange={handlePicker}
            aria-label="拾取颜色"
          />
          <input
            id="cpl-input"
            type="text"
            className="cpl__input"
            placeholder="#2b6cff 或 rgb(43, 108, 255)"
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, MAX_INPUT_LENGTH))}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>
        <p className="cpl__hint">
          输入即识别，支持 #hex / rgb() / hsl()。点击色块设为基础色。
          {overLimit && ` 已超上限（${MAX_INPUT_LENGTH}）`}
        </p>
      </div>

      {/* 解析错误 */}
      {hasInput && !rgb && parsed.error && (
        <div className="cpl__error" role="alert">
          <strong>解析失败：</strong>{parsed.error}
        </div>
      )}

      {/* 当前色预览 */}
      {rgb && (
        <div className="cpl__current" style={{ backgroundColor: currentHex, color: isLightColor(rgb) ? '#1f2937' : '#fff' }}>
          <span className="cpl__current-hex">{currentHex.toUpperCase()}</span>
          <span className="cpl__current-rgb">rgb({rgb.r}, {rgb.g}, {rgb.b})</span>
        </div>
      )}

      {/* Tab 切换 */}
      <div className="cpl__tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`cpl__tab ${activeTab === tab.key ? 'cpl__tab--active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <p className="cpl__tab-desc">{TABS.find((t) => t.key === activeTab)?.desc}</p>

      {/* 各 Tab 内容 */}
      {rgb && (
        <div className="cpl__content">
          {/* 和谐方案 */}
          {activeTab === 'harmony' && (
            <div className="cpl__section">
              <div className="cpl__sub-tabs">
                {(Object.keys(HARMONY_META) as HarmonyType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`cpl__sub-tab ${harmonyType === t ? 'cpl__sub-tab--active' : ''}`}
                    onClick={() => setHarmonyType(t)}
                  >
                    {HARMONY_META[t].label}
                  </button>
                ))}
              </div>
              <p className="cpl__section-desc">{HARMONY_META[harmonyType].desc}</p>
              <div className="cpl__swatches">
                {harmonyColors.map((c, i) => (
                  <ColorSwatch key={i} rgb={c} onClick={handlePickColor} onCopy={handleCopy} />
                ))}
              </div>
            </div>
          )}

          {/* 设计系统色阶 */}
          {activeTab === 'scale' && (
            <div className="cpl__section">
              <div className="cpl__sub-tabs">
                <button
                  type="button"
                  className={`cpl__sub-tab ${scaleStandard === 'tailwind' ? 'cpl__sub-tab--active' : ''}`}
                  onClick={() => setScaleStandard('tailwind')}
                >
                  Tailwind（50-950）
                </button>
                <button
                  type="button"
                  className={`cpl__sub-tab ${scaleStandard === 'material' ? 'cpl__sub-tab--active' : ''}`}
                  onClick={() => setScaleStandard('material')}
                >
                  Material（100-900）
                </button>
              </div>
              <p className="cpl__section-desc">
                以当前色为 500 锚点，向亮端提升明度+降低饱和度，向暗端降低明度+略提升饱和度。
              </p>
              <div className="cpl__scale">
                {scaleColors.map(({ level, rgb: scaleRgb }) => (
                  <ColorSwatch
                    key={level}
                    rgb={scaleRgb}
                    onClick={handlePickColor}
                    onCopy={handleCopy}
                    label={String(level)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 明度色调 */}
          {activeTab === 'tones' && (
            <div className="cpl__section">
              <div className="cpl__sub-tabs">
                {(Object.keys(TONE_META) as ToneType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`cpl__sub-tab ${toneType === t ? 'cpl__sub-tab--active' : ''}`}
                    onClick={() => setToneType(t)}
                  >
                    {TONE_META[t].label}
                  </button>
                ))}
              </div>
              <p className="cpl__section-desc">{TONE_META[toneType].desc}</p>
              <div className="cpl__swatches">
                <ColorSwatch rgb={rgb} onClick={handlePickColor} onCopy={handleCopy} label="基础色" />
                {toneColors.map((c, i) => (
                  <ColorSwatch key={i} rgb={c} onClick={handlePickColor} onCopy={handleCopy} label={`阶梯 ${i + 1}`} />
                ))}
              </div>
            </div>
          )}

          {/* 可访问性 */}
          {activeTab === 'accessibility' && accessibilityData && (
            <div className="cpl__section">
              <h3 className="cpl__section-title">WCAG 对比度检查</h3>
              <div className="cpl__a11y-grid">
                <div className="cpl__a11y-item" style={{ backgroundColor: currentHex, color: isLightColor(rgb) ? '#1f2937' : '#fff' }}>
                  <span className="cpl__a11y-label">当前色 + 白字</span>
                  <span className="cpl__a11y-ratio">{accessibilityData.ratioWhite.toFixed(2)}:1</span>
                  <span className="cpl__a11y-level">{accessibilityData.levelWhite}</span>
                </div>
                <div className="cpl__a11y-item" style={{ backgroundColor: currentHex, color: '#fff' }}>
                  <span className="cpl__a11y-label">当前色 + 白字（大字号）</span>
                  <span className="cpl__a11y-ratio">{accessibilityData.ratioWhite.toFixed(2)}:1</span>
                  <span className="cpl__a11y-level">{accessibilityData.levelWhiteLarge}</span>
                </div>
                <div className="cpl__a11y-item" style={{ backgroundColor: currentHex, color: isLightColor(rgb) ? '#fff' : '#1f2937' }}>
                  <span className="cpl__a11y-label">当前色 + 黑字</span>
                  <span className="cpl__a11y-ratio">{accessibilityData.ratioBlack.toFixed(2)}:1</span>
                  <span className="cpl__a11y-level">{accessibilityData.levelBlack}</span>
                </div>
                <div className="cpl__a11y-item" style={{ backgroundColor: currentHex, color: '#1f2937' }}>
                  <span className="cpl__a11y-label">当前色 + 黑字（大字号）</span>
                  <span className="cpl__a11y-ratio">{accessibilityData.ratioBlack.toFixed(2)}:1</span>
                  <span className="cpl__a11y-level">{accessibilityData.levelBlackLarge}</span>
                </div>
              </div>
              <p className="cpl__section-desc">
                WCAG 2.1 标准：普通文字 AA ≥ 4.5:1 / AAA ≥ 7:1；大字号（18pt 或 14pt 粗体）AA ≥ 3:1 / AAA ≥ 4.5:1。
              </p>

              <h3 className="cpl__section-title cpl__section-title--mt">色盲模拟</h3>
              <div className="cpl__sub-tabs">
                {(Object.keys(COLOR_BLIND_META) as ColorBlindType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`cpl__sub-tab ${colorBlindType === t ? 'cpl__sub-tab--active' : ''}`}
                    onClick={() => setColorBlindType(t)}
                  >
                    {COLOR_BLIND_META[t].label}
                  </button>
                ))}
              </div>
              <p className="cpl__section-desc">{COLOR_BLIND_META[colorBlindType].desc}</p>
              <div className="cpl__cb-grid">
                <div className="cpl__cb-item">
                  <div className="cpl__cb-swatch" style={{ backgroundColor: currentHex }} />
                  <span className="cpl__cb-label">原始色</span>
                  <code className="cpl__cb-hex">{currentHex}</code>
                </div>
                <div className="cpl__cb-item">
                  <div className="cpl__cb-swatch" style={{ backgroundColor: rgbToHex(accessibilityData.simulated) }} />
                  <span className="cpl__cb-label">{COLOR_BLIND_META[colorBlindType].label}所见</span>
                  <code className="cpl__cb-hex">{rgbToHex(accessibilityData.simulated)}</code>
                </div>
              </div>
            </div>
          )}

          {/* 随机配色 */}
          {activeTab === 'random' && (
            <div className="cpl__section">
              <p className="cpl__section-desc">
                黄金角度（137.508°）旋转采样，保证色相分布均匀。刷新页面或切换 Tab 重新生成。
              </p>
              <div className="cpl__swatches">
                {randomColors.map((c, i) => (
                  <ColorSwatch key={i} rgb={c} onClick={handlePickColor} onCopy={handleCopy} label={`配色 ${i + 1}`} />
                ))}
              </div>
              <button type="button" className="btn cpl__refresh" onClick={handleRandom}>
                重新生成（取第一个为主色）
              </button>
            </div>
          )}
        </div>
      )}

      {/* 导出区 */}
      {rgb && exportText && (
        <div className="cpl__export">
          <div className="cpl__export-head">
            <h3 className="cpl__export-title">导出代码</h3>
            <div className="cpl__export-actions">
              {(activeTab === 'scale' ? EXPORT_FORMATS : [{ key: 'css' as ExportFormat, label: 'CSS 变量' }]).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`cpl__format-btn ${exportFormat === f.key ? 'cpl__format-btn--active' : ''}`}
                  onClick={() => setExportFormat(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          {activeTab === 'scale' && (
            <div className="cpl__name-row">
              <label htmlFor="cpl-name" className="cpl__label">变量名前缀</label>
              <input
                id="cpl-name"
                type="text"
                className="cpl__name-input"
                placeholder="primary"
                value={colorName}
                onChange={(e) => setColorName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 30))}
              />
            </div>
          )}
          <pre className="cpl__export-code">{exportText}</pre>
          <button
            type="button"
            className="btn cpl__export-copy"
            onClick={() => handleCopy(exportText, '已复制代码')}
          >
            复制代码
          </button>
        </div>
      )}

      {/* 状态提示 */}
      {notice && (
        <div className="cpl__notice" role="status" aria-live="polite">{notice}</div>
      )}
    </div>
  );
}
