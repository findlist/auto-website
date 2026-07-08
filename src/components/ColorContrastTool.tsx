import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * 颜色对比度检查工具
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 前景色 + 背景色双向选择（拾色器 + HEX 输入）
 *  - 实时计算 WCAG 2.1 对比度比值（1.0 - 21.0）
 *  - 5 项 WCAG 评级展示（AA 普通文字 / AA 大文字 / AAA 普通文字 / AAA 大文字 / UI 组件）
 *  - 视觉示例：用所选颜色渲染普通文字、大文字、按钮，所见即所得
 *  - 一键交换前景色与背景色
 *  - 复制对比度比值
 */

/** RGB 颜色：0-255 整数 */
interface RGB {
  r: number;
  g: number;
  b: number;
}

/** WCAG 评级项元数据 */
interface WcagLevel {
  key: string;
  label: string;
  desc: string;
  threshold: number; // 达标阈值
}

/** 输入长度上限：防止超长输入卡顿 */
const MAX_INPUT_LENGTH = 30;

/** 5 项 WCAG 2.1 对比度评级标准（阈值来自 W3C 规范） */
const WCAG_LEVELS: WcagLevel[] = [
  { key: 'aa-normal', label: 'AA 普通文字', desc: '正文、链接等小于 18px 的文字', threshold: 4.5 },
  { key: 'aa-large', label: 'AA 大文字', desc: '≥ 18px 或 ≥ 14px 加粗的文字', threshold: 3.0 },
  { key: 'aaa-normal', label: 'AAA 普通文字', desc: '增强对比度要求的正文', threshold: 7.0 },
  { key: 'aaa-large', label: 'AAA 大文字', desc: '增强对比度要求的大文字', threshold: 4.5 },
  { key: 'ui', label: 'UI 组件', desc: '按钮边框、图标、表单控件边界', threshold: 3.0 },
];

/** 示例配色：深蓝文本 + 浅灰背景（常见的合规配色） */
const SAMPLE_FG: RGB = { r: 31, g: 41, b: 55 }; // #1f2937
const SAMPLE_BG: RGB = { r: 255, g: 255, b: 255 }; // #ffffff

/** 限制 0-255 范围并取整 */
function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** HEX → RGB：支持 3 位与 6 位 */
function hexToRgb(hex: string): RGB | null {
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.startsWith('0x') || h.startsWith('0X')) h = h.slice(2);
  // 简写 #RGB → #RRGGBB
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

/** RGB → HEX：输出 #rrggbb 小写 */
function rgbToHex({ r, g, b }: RGB): string {
  const toHex = (n: number) => clampByte(n).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * 计算颜色的相对亮度（WCAG 2.1 标准公式）
 * sRGB 每个通道做 gamma 解码后加权求和
 */
function relativeLuminance({ r, g, b }: RGB): number {
  const channel = (n: number) => {
    const c = n / 255;
    // WCAG 规定的 gamma 解码阈值 0.03928（原 0.04045 已修正）
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  // 加权系数：绿色最敏感，蓝色最不敏感
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * 计算两色的对比度比值（WCAG 2.1 标准公式）
 * 取值范围 1.0（同色）到 21.0（黑 vs 白）
 * 公式：(L1 + 0.05) / (L2 + 0.05)，L1 为较亮色，L2 为较暗色
 */
function contrastRatio(rgb1: RGB, rgb2: RGB): number {
  const L1 = relativeLuminance(rgb1);
  const L2 = relativeLuminance(rgb2);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}


export default function ColorContrastTool() {
  // 前景色与背景色：使用 RGB 内部存储，输入框单独维护 HEX 字符串
  const [fg, setFg] = useState<RGB | null>(null);
  const [bg, setBg] = useState<RGB | null>(null);
  const [fgInput, setFgInput] = useState<string>('');
  const [bgInput, setBgInput] = useState<string>('');
  const [fgError, setFgError] = useState<string>('');
  const [bgError, setBgError] = useState<string>('');
  const [notice, setNotice] = useState<string>('');

  /** 当前生效的前景/背景 RGB（输入解析优先，回退到上次有效值） */
  const currentFg = useMemo(() => {
    if (fgInput.trim() === '') return fg;
    const parsed = hexToRgb(fgInput);
    return parsed || fg;
  }, [fgInput, fg]);

  const currentBg = useMemo(() => {
    if (bgInput.trim() === '') return bg;
    const parsed = hexToRgb(bgInput);
    return parsed || bg;
  }, [bgInput, bg]);

  /** 实时计算对比度比值（保留两位小数） */
  const ratio = useMemo(() => {
    if (!currentFg || !currentBg) return null;
    return contrastRatio(currentFg, currentBg);
  }, [currentFg, currentBg]);

  /** 5 项评级达标状态 */
  const levels = useMemo(() => {
    if (ratio === null) return null;
    return WCAG_LEVELS.map((lv) => ({
      ...lv,
      passed: ratio >= lv.threshold,
    }));
  }, [ratio]);

  /** 前景色 HEX 输入变化：实时解析 */
  const handleFgInput = useCallback((value: string) => {
    const v = value.slice(0, MAX_INPUT_LENGTH);
    setFgInput(v);
    if (v.trim() === '') {
      setFgError('');
      return;
    }
    const parsed = hexToRgb(v);
    if (parsed) {
      setFg(parsed);
      setFgError('');
    } else {
      setFgError('HEX 格式应为 #RRGGBB 或 #RGB');
    }
  }, []);

  /** 背景色 HEX 输入变化：实时解析 */
  const handleBgInput = useCallback((value: string) => {
    const v = value.slice(0, MAX_INPUT_LENGTH);
    setBgInput(v);
    if (v.trim() === '') {
      setBgError('');
      return;
    }
    const parsed = hexToRgb(v);
    if (parsed) {
      setBg(parsed);
      setBgError('');
    } else {
      setBgError('HEX 格式应为 #RRGGBB 或 #RGB');
    }
  }, []);

  /** 前景拾色器变化 */
  const handleFgPicker = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const hex = e.target.value;
    const rgb = hexToRgb(hex);
    if (rgb) {
      setFg(rgb);
      setFgInput(hex);
      setFgError('');
    }
  }, []);

  /** 背景拾色器变化 */
  const handleBgPicker = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const hex = e.target.value;
    const rgb = hexToRgb(hex);
    if (rgb) {
      setBg(rgb);
      setBgInput(hex);
      setBgError('');
    }
  }, []);

  /** 交换前景色与背景色 */
  const handleSwap = useCallback(() => {
    const newFg = currentBg;
    const newBg = currentFg;
    setFg(newFg);
    setBg(newBg);
    setFgInput(newFg ? rgbToHex(newFg) : '');
    setBgInput(newBg ? rgbToHex(newBg) : '');
    setFgError('');
    setBgError('');
  }, [currentFg, currentBg]);

  /** 载入示例：深蓝文本 + 白色背景 */
  const handleSample = useCallback(() => {
    setFg(SAMPLE_FG);
    setBg(SAMPLE_BG);
    setFgInput(rgbToHex(SAMPLE_FG));
    setBgInput(rgbToHex(SAMPLE_BG));
    setFgError('');
    setBgError('');
    setNotice('');
  }, []);

  /** 清空所有输入 */
  const handleClear = useCallback(() => {
    setFg(null);
    setBg(null);
    setFgInput('');
    setBgInput('');
    setFgError('');
    setBgError('');
    setNotice('');
  }, []);

  /** 复制对比度比值 */
  const handleCopyRatio = useCallback(async () => {
    if (ratio === null) return;
    const text = `${ratio.toFixed(2)}:1`;
    const ok = await copyText(text);
    if (ok) {
      setNotice(`已复制 ${text}`);
      setTimeout(() => setNotice(''), 1500);
    } else {
      setNotice('复制失败，请手动选中复制');
    }
  }, [ratio]);

  const fgHex = currentFg ? rgbToHex(currentFg) : '#000000';
  const bgHex = currentBg ? rgbToHex(currentBg) : '#ffffff';
  const hasBoth = currentFg !== null && currentBg !== null;

  return (
    <div className="jsontool contrasttool">
      {/* 输入区：前景色 + 交换按钮 + 背景色 */}
      <div className="contrasttool__input-area">
        <div className="contrasttool__input-head">
          <span className="contrasttool__label">选择前景色与背景色</span>
          <div className="jsontool__actions">
            <button type="button" className="btn btn--sm" onClick={handleSample}>示例</button>
            <button type="button" className="btn btn--sm" onClick={handleClear}>清空</button>
          </div>
        </div>

        <div className="contrasttool__input-row">
          {/* 前景色输入：拾色器 + HEX 文本框 */}
          <div className="contrasttool__color-field">
            <label htmlFor="fg-input" className="contrasttool__field-label">前景色（文字）</label>
            <div className="contrasttool__field-row">
              <input
                type="color"
                className="contrasttool__picker"
                value={fgHex}
                onChange={handleFgPicker}
                aria-label="拾取前景色"
              />
              <input
                id="fg-input"
                type="text"
                className="contrasttool__text-input"
                placeholder="#1f2937"
                value={fgInput}
                onChange={(e) => handleFgInput(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
              />
            </div>
            {fgError && <p className="contrasttool__field-error" role="alert">{fgError}</p>}
          </div>

          {/* 交换按钮：居中放置，便于一键切换前景/背景 */}
          <button
            type="button"
            className="contrasttool__swap-btn"
            onClick={handleSwap}
            disabled={!hasBoth}
            aria-label="交换前景色与背景色"
            title="交换前景色与背景色"
          >
            ⇄
          </button>

          {/* 背景色输入：拾色器 + HEX 文本框 */}
          <div className="contrasttool__color-field">
            <label htmlFor="bg-input" className="contrasttool__field-label">背景色</label>
            <div className="contrasttool__field-row">
              <input
                type="color"
                className="contrasttool__picker"
                value={bgHex}
                onChange={handleBgPicker}
                aria-label="拾取背景色"
              />
              <input
                id="bg-input"
                type="text"
                className="contrasttool__text-input"
                placeholder="#ffffff"
                value={bgInput}
                onChange={(e) => handleBgInput(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
              />
            </div>
            {bgError && <p className="contrasttool__field-error" role="alert">{bgError}</p>}
          </div>
        </div>
      </div>

      {/* 对比度结果区 */}
      {hasBoth && ratio !== null && (
        <>
          <div className="contrasttool__result">
            <div className="contrasttool__ratio-box">
              <span className="contrasttool__ratio-value">{ratio.toFixed(2)}</span>
              <span className="contrasttool__ratio-unit">:1</span>
              <button
                type="button"
                className="contrasttool__copy-btn"
                onClick={handleCopyRatio}
                aria-label="复制对比度比值"
              >复制</button>
            </div>
            <p className="contrasttool__ratio-hint">
              对比度比值范围 1.0（同色）到 21.0（黑底白字），数值越高越易读。
            </p>
          </div>

          {/* WCAG 评级展示 */}
          {levels && (
            <div className="contrasttool__levels" aria-label="WCAG 2.1 对比度评级">
              <h3 className="contrasttool__levels-title">WCAG 2.1 评级</h3>
              <ul className="contrasttool__level-list" role="list">
                {levels.map((lv) => (
                  <li
                    key={lv.key}
                    className={`contrasttool__level${lv.passed ? ' contrasttool__level--pass' : ' contrasttool__level--fail'}`}
                  >
                    <span className="contrasttool__level-badge">{lv.passed ? '✓ 通过' : '✗ 未达'}</span>
                    <span className="contrasttool__level-label">{lv.label}</span>
                    <span className="contrasttool__level-desc">{lv.desc}</span>
                    <span className="contrasttool__level-threshold">要求 ≥ {lv.threshold.toFixed(1)}:1</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 视觉示例：用所选颜色渲染真实文字与组件 */}
          <div className="contrasttool__preview" aria-label="实际渲染效果预览">
            <h3 className="contrasttool__preview-title">实际渲染效果</h3>
            <div
              className="contrasttool__preview-canvas"
              style={{ backgroundColor: bgHex, color: fgHex }}
            >
              <p className="contrasttool__preview-normal">这是普通正文文字（14px），用于模拟网页正文阅读场景。</p>
              <p className="contrasttool__preview-large"><strong>这是大号加粗文字（18px+ 加粗），用于标题或重点提示。</strong></p>
              <p className="contrasttool__preview-link">这是一个超链接文字，浏览器默认会加下划线。</p>
              <button
                type="button"
                className="contrasttool__preview-btn"
                style={{ color: fgHex, borderColor: fgHex }}
              >示例按钮</button>
            </div>
          </div>

          {/* 不达标建议 */}
          {ratio < 4.5 && (
            <div className="contrasttool__advice" role="note">
              <strong>对比度偏低，建议：</strong>
              {relativeLuminance(currentFg!) > relativeLuminance(currentBg!) ? (
                <span>前景色比背景色亮，可尝试<strong>加深前景色</strong>或<strong>提亮背景色</strong>以提高对比度。</span>
              ) : (
                <span>前景色比背景色暗，可尝试<strong>提亮前景色</strong>或<strong>加深背景色</strong>以提高对比度。</span>
              )}
              WCAG 2.1 AA 标准要求普通文字对比度 ≥ 4.5:1。
            </div>
          )}
        </>
      )}

      {/* 空状态提示 */}
      {!hasBoth && (
        <div className="contrasttool__empty">
          <p>请选择前景色与背景色，或点击「示例」载入演示配色。</p>
        </div>
      )}

      {/* 状态提示 */}
      {notice && (
        <div className="contrasttool__notice" role="status" aria-live="polite">{notice}</div>
      )}
    </div>
  );
}
