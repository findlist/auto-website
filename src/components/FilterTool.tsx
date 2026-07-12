import { useState, useMemo, useCallback, useRef } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS filter 滤镜可视化生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 9 个单参数滤镜（blur/brightness/contrast/grayscale/hue-rotate/invert/opacity/saturate/sepia）
 *  - 1 个多参数滤镜 drop-shadow（x/y/blur/color）
 *  - 每个滤镜独立启用/禁用与参数调节
 *  - 8 组预设效果（复古、黑白、高饱和、冷色、暖色、朦胧、反色、原图）
 *  - 双预览模式：内置彩色测试图 / 上传图片
 *  - 实时生成 CSS 代码，一键复制
 */

/** 单参数滤镜定义 */
interface FilterDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultVal: number;
  unit: 'px' | '%' | 'deg';
  /** 将数值格式化为 CSS 函数字符串 */
  format: (v: number) => string;
}

/** drop-shadow 多参数状态 */
interface DropShadowState {
  enabled: boolean;
  x: number;
  y: number;
  blur: number;
  color: string;
}

/** 预设效果 */
interface FilterPreset {
  name: string;
  /** 滤镜键 -> 值（仅包含非默认值） */
  values: Record<string, number>;
  dropShadow?: Omit<DropShadowState, 'enabled'>;
}

// 9 个单参数滤镜定义，按视觉影响分组排序
const FILTERS: FilterDef[] = [
  { key: 'blur', label: '模糊 blur', min: 0, max: 20, step: 0.5, defaultVal: 0, unit: 'px', format: (v) => `blur(${v}px)` },
  { key: 'brightness', label: '亮度 brightness', min: 0, max: 200, step: 5, defaultVal: 100, unit: '%', format: (v) => `brightness(${v}%)` },
  { key: 'contrast', label: '对比度 contrast', min: 0, max: 200, step: 5, defaultVal: 100, unit: '%', format: (v) => `contrast(${v}%)` },
  { key: 'saturate', label: '饱和度 saturate', min: 0, max: 200, step: 5, defaultVal: 100, unit: '%', format: (v) => `saturate(${v}%)` },
  { key: 'grayscale', label: '灰度 grayscale', min: 0, max: 100, step: 1, defaultVal: 0, unit: '%', format: (v) => `grayscale(${v}%)` },
  { key: 'sepia', label: '褐色 sepia', min: 0, max: 100, step: 1, defaultVal: 0, unit: '%', format: (v) => `sepia(${v}%)` },
  { key: 'hue-rotate', label: '色相 hue-rotate', min: 0, max: 360, step: 1, defaultVal: 0, unit: 'deg', format: (v) => `hue-rotate(${v}deg)` },
  { key: 'invert', label: '反色 invert', min: 0, max: 100, step: 1, defaultVal: 0, unit: '%', format: (v) => `invert(${v}%)` },
  { key: 'opacity', label: '透明度 opacity', min: 0, max: 100, step: 1, defaultVal: 100, unit: '%', format: (v) => `opacity(${v}%)` },
];

const DEFAULT_DS: DropShadowState = { enabled: false, x: 4, y: 4, blur: 6, color: '#000000' };

// 8 组预设，覆盖常见图像处理风格
const PRESETS: FilterPreset[] = [
  { name: '原图', values: {} },
  { name: '复古', values: { sepia: 60, contrast: 110, brightness: 95 } },
  { name: '黑白', values: { grayscale: 100, contrast: 110 } },
  { name: '高饱和', values: { saturate: 180, contrast: 110 } },
  { name: '冷色调', values: { 'hue-rotate': 180, saturate: 130 } },
  { name: '暖色调', values: { sepia: 40, saturate: 140, brightness: 105 } },
  { name: '朦胧', values: { blur: 2, brightness: 110, saturate: 110 } },
  { name: '反色', values: { invert: 100 } },
];

// 非 hex 颜色回退为 #000000，保证 input[type=color] 可用
function normalizeHex(color: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    return '#' + color.slice(1).split('').map((c) => c + c).join('');
  }
  return '#000000';
}

/** 内置彩色测试图，避免引入图片资源依赖 */
function DemoPreview() {
  return (
    <div className="flt__demo">
      {/* 彩虹渐变背景，直观反映色相/饱和度变化 */}
      <div className="flt__demo-grad" />
      <div className="flt__demo-shapes">
        <span className="flt__demo-circle" />
        <span className="flt__demo-square" />
        <span className="flt__demo-tri" />
      </div>
      <span className="flt__demo-text">FILTER 滤镜</span>
    </div>
  );
}

export default function FilterTool() {
  // 滤镜值与启用状态分离，便于临时禁用而不丢失参数
  const [values, setValues] = useState<Record<string, number>>({});
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [dropShadow, setDropShadow] = useState<DropShadowState>(DEFAULT_DS);
  const [copied, setCopied] = useState(false);

  // 图片预览模式
  const [previewMode, setPreviewMode] = useState<'demo' | 'image'>('demo');
  const [imageUrl, setImageUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // 生成 CSS filter 字符串
  const filterValue = useMemo(() => {
    const parts: string[] = [];
    for (const f of FILTERS) {
      if (enabled[f.key]) {
        const v = values[f.key] ?? f.defaultVal;
        parts.push(f.format(v));
      }
    }
    if (dropShadow.enabled) {
      parts.push(`drop-shadow(${dropShadow.x}px ${dropShadow.y}px ${dropShadow.blur}px ${dropShadow.color})`);
    }
    return parts.join(' ');
  }, [values, enabled, dropShadow]);

  const cssCode = useMemo(() => {
    return filterValue ? `filter: ${filterValue};` : '/* 当前未启用任何滤镜 */';
  }, [filterValue]);

  // 切换某个滤镜的启用状态，首次启用时填入默认值
  const toggleFilter = useCallback((key: string) => {
    setEnabled((prev) => ({ ...prev, [key]: !prev[key] }));
    setValues((prev) => {
      if (prev[key] !== undefined) return prev;
      const def = FILTERS.find((f) => f.key === key);
      return def ? { ...prev, [key]: def.defaultVal } : prev;
    });
  }, []);

  // 修改某个滤镜的值
  const updateValue = useCallback((key: string, v: number) => {
    setValues((prev) => ({ ...prev, [key]: v }));
  }, []);

  // 重置单个滤镜到默认值
  const resetFilter = useCallback((key: string) => {
    const def = FILTERS.find((f) => f.key === key);
    if (def) setValues((prev) => ({ ...prev, [key]: def.defaultVal }));
  }, []);

  // 应用预设
  const applyPreset = useCallback((preset: FilterPreset) => {
    const newEnabled: Record<string, boolean> = {};
    const newValues: Record<string, number> = {};
    for (const f of FILTERS) {
      if (preset.values[f.key] !== undefined) {
        newEnabled[f.key] = true;
        newValues[f.key] = preset.values[f.key];
      }
    }
    setEnabled(newEnabled);
    setValues(newValues);
    setDropShadow(preset.dropShadow ? { enabled: true, ...preset.dropShadow } : DEFAULT_DS);
  }, []);

  // 一键重置所有滤镜
  const resetAll = useCallback(() => {
    setValues({});
    setEnabled({});
    setDropShadow(DEFAULT_DS);
  }, []);

  // 复制 CSS 代码
  const handleCopy = useCallback(async () => {
    const ok = await copyText(cssCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [cssCode]);

  // 处理图片上传，ObjectURL 需手动释放避免内存泄漏
  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(URL.createObjectURL(file));
    setPreviewMode('image');
  }, [imageUrl]);

  // 统计启用的滤镜数量
  const enabledCount = useMemo(() => {
    let n = 0;
    for (const f of FILTERS) if (enabled[f.key]) n++;
    if (dropShadow.enabled) n++;
    return n;
  }, [enabled, dropShadow]);

  return (
    <div className="flt">
      {/* 预览模式切换 */}
      <div className="flt__mode">
        <button
          type="button"
          className={`flt__mode-btn${previewMode === 'demo' ? ' is-active' : ''}`}
          onClick={() => setPreviewMode('demo')}
        >
          彩色测试图
        </button>
        <button
          type="button"
          className={`flt__mode-btn${previewMode === 'image' ? ' is-active' : ''}`}
          onClick={() => fileRef.current?.click()}
        >
          上传图片预览
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="flt__file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      </div>

      {/* 预览区：demo 模式或图片模式，filter 实时应用 */}
      <div className="flt__preview-wrap">
        <div className="flt__preview" style={{ filter: filterValue || 'none' }}>
          {previewMode === 'image' && imageUrl ? (
            <img src={imageUrl} alt="滤镜预览图" className="flt__img" />
          ) : (
            <DemoPreview />
          )}
        </div>
      </div>

      {/* 预设按钮组 */}
      <div className="flt__presets">
        <span className="flt__presets-label">预设：</span>
        {PRESETS.map((p) => (
          <button key={p.name} type="button" className="flt__btn flt__btn--preset" onClick={() => applyPreset(p)}>
            {p.name}
          </button>
        ))}
        <button type="button" className="flt__btn flt__btn--reset" onClick={resetAll}>
          全部重置
        </button>
      </div>

      {/* 滤镜控制列表 */}
      <div className="flt__controls">
        <div className="flt__controls-head">
          <span className="flt__controls-title">滤镜参数（已启用 {enabledCount} 个）</span>
        </div>
        {FILTERS.map((f) => {
          const isOn = !!enabled[f.key];
          const val = values[f.key] ?? f.defaultVal;
          return (
            <div key={f.key} className={`flt__row${isOn ? ' is-on' : ''}`}>
              <label className="flt__row-check">
                <input type="checkbox" checked={isOn} onChange={() => toggleFilter(f.key)} />
                <span>{f.label}</span>
              </label>
              <input
                type="range"
                className="flt__slider"
                min={f.min}
                max={f.max}
                step={f.step}
                value={val}
                disabled={!isOn}
                onChange={(e) => updateValue(f.key, Number(e.target.value))}
              />
              <output className="flt__val">{val}{f.unit}</output>
              <button
                type="button"
                className="flt__btn flt__btn--reset-one"
                onClick={() => resetFilter(f.key)}
                disabled={!isOn}
                aria-label={`重置 ${f.label}`}
              >
                重置
              </button>
            </div>
          );
        })}

        {/* drop-shadow 特殊面板：4 个参数 */}
        <div className={`flt__row flt__row--ds${dropShadow.enabled ? ' is-on' : ''}`}>
          <label className="flt__row-check">
            <input
              type="checkbox"
              checked={dropShadow.enabled}
              onChange={() => setDropShadow((p) => ({ ...p, enabled: !p.enabled }))}
            />
            <span>投影 drop-shadow</span>
          </label>
          <div className="flt__ds-grid">
            <label className="flt__ds-field">
              X
              <input
                type="range"
                min="-20"
                max="20"
                step="1"
                value={dropShadow.x}
                disabled={!dropShadow.enabled}
                onChange={(e) => setDropShadow((p) => ({ ...p, x: Number(e.target.value) }))}
              />
              <output>{dropShadow.x}px</output>
            </label>
            <label className="flt__ds-field">
              Y
              <input
                type="range"
                min="-20"
                max="20"
                step="1"
                value={dropShadow.y}
                disabled={!dropShadow.enabled}
                onChange={(e) => setDropShadow((p) => ({ ...p, y: Number(e.target.value) }))}
              />
              <output>{dropShadow.y}px</output>
            </label>
            <label className="flt__ds-field">
              模糊
              <input
                type="range"
                min="0"
                max="30"
                step="1"
                value={dropShadow.blur}
                disabled={!dropShadow.enabled}
                onChange={(e) => setDropShadow((p) => ({ ...p, blur: Number(e.target.value) }))}
              />
              <output>{dropShadow.blur}px</output>
            </label>
            <label className="flt__ds-color">
              颜色
              <input
                type="color"
                value={normalizeHex(dropShadow.color)}
                disabled={!dropShadow.enabled}
                onChange={(e) => setDropShadow((p) => ({ ...p, color: e.target.value }))}
              />
              <input
                type="text"
                className="flt__ds-hex"
                value={dropShadow.color}
                disabled={!dropShadow.enabled}
                onChange={(e) => setDropShadow((p) => ({ ...p, color: e.target.value }))}
              />
            </label>
          </div>
        </div>
      </div>

      {/* CSS 代码输出 */}
      <div className="flt__output">
        <div className="flt__output-head">
          <span className="flt__output-label">CSS 代码</span>
          <button type="button" className="flt__btn flt__btn--copy" onClick={handleCopy}>
            {copied ? '已复制 ✓' : '复制'}
          </button>
        </div>
        <pre className="flt__code">{cssCode}</pre>
      </div>
    </div>
  );
}
