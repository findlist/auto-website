import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS transform 可视化生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 四种变换：translate 平移 / rotate 旋转 / scale 缩放 / skew 倾斜
 *  - transform-origin 变换原点（9 预设位置 + 自定义）
 *  - 单位切换：translate 支持 px / %
 *  - 6 组预设效果
 *  - 实时预览（原图与变换后对比）+ 一键复制 CSS 代码
 */

type TranslateUnit = 'px' | '%';

/** 变换参数集合 */
interface TransformParams {
  translateX: number;
  translateY: number;
  rotate: number; // 度
  scaleX: number; // 倍数
  scaleY: number;
  skewX: number; // 度
  skewY: number;
}

/** 变换原点位置 */
interface OriginPos {
  x: string; // left/center/right 或百分比
  y: string; // top/center/bottom 或百分比
}

/** 预设效果 */
interface TransformPreset {
  name: string;
  params: TransformParams;
  origin: OriginPos;
}

// 6 组预设覆盖主流变换场景
const PRESETS: TransformPreset[] = [
  {
    name: '旋转 45°',
    params: { translateX: 0, translateY: 0, rotate: 45, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
    origin: { x: 'center', y: 'center' },
  },
  {
    name: '放大 1.5x',
    params: { translateX: 0, translateY: 0, rotate: 0, scaleX: 1.5, scaleY: 1.5, skewX: 0, skewY: 0 },
    origin: { x: 'center', y: 'center' },
  },
  {
    name: '倾斜 15°',
    params: { translateX: 0, translateY: 0, rotate: 0, scaleX: 1, scaleY: 1, skewX: 15, skewY: 0 },
    origin: { x: 'center', y: 'center' },
  },
  {
    name: '右下平移',
    params: { translateX: 30, translateY: 30, rotate: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
    origin: { x: 'center', y: 'center' },
  },
  {
    name: '水平翻转',
    params: { translateX: 0, translateY: 0, rotate: 0, scaleX: -1, scaleY: 1, skewX: 0, skewY: 0 },
    origin: { x: 'center', y: 'center' },
  },
  {
    name: '组合变换',
    params: { translateX: 20, translateY: -10, rotate: -15, scaleX: 1.2, scaleY: 1.2, skewX: 5, skewY: 0 },
    origin: { x: 'center', y: 'center' },
  },
];

// 变换原点 9 预设位置（3x3 网格）
const ORIGIN_PRESETS: { x: string; y: string; label: string }[] = [
  { x: 'left', y: 'top', label: '↖' },
  { x: 'center', y: 'top', label: '↑' },
  { x: 'right', y: 'top', label: '↗' },
  { x: 'left', y: 'center', label: '←' },
  { x: 'center', y: 'center', label: '·' },
  { x: 'right', y: 'center', label: '→' },
  { x: 'left', y: 'bottom', label: '↙' },
  { x: 'center', y: 'bottom', label: '↓' },
  { x: 'right', y: 'bottom', label: '↘' },
];

const DEFAULT_PARAMS: TransformParams = {
  translateX: 0, translateY: 0, rotate: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0,
};

const DEFAULT_ORIGIN: OriginPos = { x: 'center', y: 'center' };

/** 格式化数值：去除多余小数 */
function fmt(n: number, decimals = 1): string {
  return Number(n.toFixed(decimals)).toString();
}

/** 根据参数生成完整 transform CSS 值 */
function buildTransform(p: TransformParams, unit: TranslateUnit): string {
  const parts: string[] = [];
  // 平移：仅在非零时输出
  if (p.translateX !== 0 || p.translateY !== 0) {
    parts.push(`translate(${p.translateX}${unit}, ${p.translateY}${unit})`);
  }
  // 旋转
  if (p.rotate !== 0) {
    parts.push(`rotate(${fmt(p.rotate)}deg)`);
  }
  // 缩放：仅在非 1 时输出
  if (p.scaleX !== 1 || p.scaleY !== 1) {
    if (p.scaleX === p.scaleY) {
      parts.push(`scale(${fmt(p.scaleX, 2)})`);
    } else {
      parts.push(`scale(${fmt(p.scaleX, 2)}, ${fmt(p.scaleY, 2)})`);
    }
  }
  // 倾斜
  if (p.skewX !== 0 || p.skewY !== 0) {
    parts.push(`skew(${fmt(p.skewX)}deg, ${fmt(p.skewY)}deg)`);
  }
  return parts.length > 0 ? parts.join(' ') : 'none';
}

/** 通用数值滑块控件 */
function ParamSlider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="trf__slider">
      <span className="trf__slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
      <output className="trf__slider-value">{fmt(value, 2)}{suffix}</output>
    </label>
  );
}

export default function TransformTool() {
  const [params, setParams] = useState<TransformParams>({ ...DEFAULT_PARAMS });
  const [origin, setOrigin] = useState<OriginPos>({ ...DEFAULT_ORIGIN });
  const [unit, setUnit] = useState<TranslateUnit>('px');
  const [previewBg, setPreviewBg] = useState('#2b6cff');
  const [copied, setCopied] = useState(false);

  const transformValue = useMemo(
    () => buildTransform(params, unit),
    [params, unit],
  );
  const originValue = `${origin.x} ${origin.y}`;
  const cssCode = useMemo(
    () => `transform: ${transformValue};\ntransform-origin: ${originValue};`,
    [transformValue, originValue],
  );

  // 修改单一参数
  const patchParam = useCallback((field: keyof TransformParams, v: number) => {
    setParams((prev) => ({ ...prev, [field]: v }));
  }, []);

  // 应用预设
  const applyPreset = useCallback((p: TransformPreset) => {
    setParams({ ...p.params });
    setOrigin({ ...p.origin });
  }, []);

  // 重置所有参数
  const handleReset = useCallback(() => {
    setParams({ ...DEFAULT_PARAMS });
    setOrigin({ ...DEFAULT_ORIGIN });
  }, []);

  // 复制 CSS
  const handleCopy = useCallback(async () => {
    const ok = await copyText(cssCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [cssCode]);

  // 选择变换原点
  const handleOriginSelect = useCallback((x: string, y: string) => {
    setOrigin({ x, y });
  }, []);

  return (
    <div className="trf">
      {/* 预览区：原图轮廓 + 变换后对比 */}
      <div className="trf__preview-wrap">
        <div className="trf__preview-stage">
          {/* 原始位置轮廓（虚线参考） */}
          <div
            className="trf__preview-ghost"
            style={{ background: 'transparent', border: '2px dashed rgba(125,125,125,0.4)' }}
            aria-hidden="true"
          />
          {/* 变换后的实际方块 */}
          <div
            className="trf__preview-target"
            style={{
              background: previewBg,
              transform: transformValue,
              transformOrigin: originValue,
            }}
          />
        </div>
        <div className="trf__preview-controls">
          <label className="trf__preview-bg">
            颜色
            <input
              type="color"
              value={previewBg}
              onChange={(e) => setPreviewBg(e.target.value)}
              aria-label="预览方块颜色"
            />
          </label>
          <span className="trf__preview-tip">虚线为原始位置，实色为变换后效果</span>
        </div>
      </div>

      {/* 预设按钮组 */}
      <div className="trf__presets">
        <span className="trf__presets-label">预设：</span>
        {PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            className="trf__btn trf__btn--preset"
            onClick={() => applyPreset(p)}
          >
            {p.name}
          </button>
        ))}
        <button
          type="button"
          className="trf__btn trf__btn--reset"
          onClick={handleReset}
        >
          重置
        </button>
      </div>

      {/* 平移单位切换 */}
      <div className="trf__controls">
        <div className="trf__control-group">
          <span className="trf__control-label">translate 单位</span>
          <div className="trf__seg">
            <button
              type="button"
              className={`trf__seg-btn${unit === 'px' ? ' is-active' : ''}`}
              onClick={() => setUnit('px')}
            >
              px 像素
            </button>
            <button
              type="button"
              className={`trf__seg-btn${unit === '%' ? ' is-active' : ''}`}
              onClick={() => setUnit('%')}
            >
              % 百分比
            </button>
          </div>
        </div>
      </div>

      {/* 参数控制：translate */}
      <div className="trf__section">
        <h3 className="trf__section-title">translate 平移</h3>
        <div className="trf__sliders">
          <ParamSlider
            label="X 轴"
            value={params.translateX}
            min={-150}
            max={150}
            step={1}
            suffix={unit}
            onChange={(v) => patchParam('translateX', v)}
          />
          <ParamSlider
            label="Y 轴"
            value={params.translateY}
            min={-150}
            max={150}
            step={1}
            suffix={unit}
            onChange={(v) => patchParam('translateY', v)}
          />
        </div>
      </div>

      {/* 参数控制：rotate */}
      <div className="trf__section">
        <h3 className="trf__section-title">rotate 旋转</h3>
        <div className="trf__sliders">
          <ParamSlider
            label="角度"
            value={params.rotate}
            min={-180}
            max={180}
            step={1}
            suffix="°"
            onChange={(v) => patchParam('rotate', v)}
          />
        </div>
      </div>

      {/* 参数控制：scale */}
      <div className="trf__section">
        <h3 className="trf__section-title">scale 缩放</h3>
        <div className="trf__sliders">
          <ParamSlider
            label="X 轴"
            value={params.scaleX}
            min={-2}
            max={3}
            step={0.05}
            suffix="x"
            onChange={(v) => patchParam('scaleX', v)}
          />
          <ParamSlider
            label="Y 轴"
            value={params.scaleY}
            min={-2}
            max={3}
            step={0.05}
            suffix="x"
            onChange={(v) => patchParam('scaleY', v)}
          />
        </div>
      </div>

      {/* 参数控制：skew */}
      <div className="trf__section">
        <h3 className="trf__section-title">skew 倾斜</h3>
        <div className="trf__sliders">
          <ParamSlider
            label="X 轴"
            value={params.skewX}
            min={-60}
            max={60}
            step={1}
            suffix="°"
            onChange={(v) => patchParam('skewX', v)}
          />
          <ParamSlider
            label="Y 轴"
            value={params.skewY}
            min={-60}
            max={60}
            step={1}
            suffix="°"
            onChange={(v) => patchParam('skewY', v)}
          />
        </div>
      </div>

      {/* transform-origin 选择器 */}
      <div className="trf__section">
        <h3 className="trf__section-title">transform-origin 变换原点</h3>
        <div className="trf__origin-grid">
          {ORIGIN_PRESETS.map((o) => {
            const active = origin.x === o.x && origin.y === o.y;
            return (
              <button
                key={`${o.x}-${o.y}`}
                type="button"
                className={`trf__origin-btn${active ? ' is-active' : ''}`}
                onClick={() => handleOriginSelect(o.x, o.y)}
                aria-label={`原点 ${o.x} ${o.y}`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        <p className="trf__origin-current">
          当前原点：<code>{originValue}</code>
        </p>
      </div>

      {/* CSS 代码输出 */}
      <div className="trf__output">
        <div className="trf__output-head">
          <span className="trf__output-label">CSS 代码</span>
          <button type="button" className="trf__btn trf__btn--copy" onClick={handleCopy}>
            {copied ? '已复制 ✓' : '复制'}
          </button>
        </div>
        <pre className="trf__code">{cssCode}</pre>
      </div>
    </div>
  );
}
