import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS border-radius 可视化生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 三种编辑模式：单一值 / 四角独立 / 椭圆八值
 *  - 单位切换：px / %
 *  - 6 组预设：圆形、胶囊、卡片、不对称、椭圆、波浪
 *  - 实时预览 + 一键复制 CSS 代码
 *  - 可调预览尺寸与背景色，适配不同场景可视化
 */

type Mode = 'uniform' | 'corners' | 'ellipse';
type Unit = 'px' | '%';

/** 四角数值结构（顺序：左上、右上、右下、左下） */
interface Corners {
  tl: number;
  tr: number;
  br: number;
  bl: number;
}

/** 椭圆八值结构（每个角水平/垂直半径独立） */
interface EllipseCorners {
  tlX: number; tlY: number;
  trX: number; trY: number;
  brX: number; brY: number;
  blX: number; blY: number;
}

/** 预设效果 */
interface RadiusPreset {
  name: string;
  mode: Mode;
  unit: Unit;
  uniform: number;
  corners: Corners;
  ellipse: EllipseCorners;
}

// 6 组预设覆盖主流设计风格
const PRESETS: RadiusPreset[] = [
  {
    name: '圆形',
    mode: 'uniform',
    unit: '%',
    uniform: 50,
    corners: { tl: 50, tr: 50, br: 50, bl: 50 },
    ellipse: { tlX: 50, tlY: 50, trX: 50, trY: 50, brX: 50, brY: 50, blX: 50, blY: 50 },
  },
  {
    name: '胶囊',
    mode: 'uniform',
    unit: 'px',
    uniform: 999,
    corners: { tl: 999, tr: 999, br: 999, bl: 999 },
    ellipse: { tlX: 999, tlY: 999, trX: 999, trY: 999, brX: 999, brY: 999, blX: 999, blY: 999 },
  },
  {
    name: '卡片',
    mode: 'uniform',
    unit: 'px',
    uniform: 12,
    corners: { tl: 12, tr: 12, br: 12, bl: 12 },
    ellipse: { tlX: 12, tlY: 12, trX: 12, trY: 12, brX: 12, brY: 12, blX: 12, blY: 12 },
  },
  {
    name: '不对称',
    mode: 'corners',
    unit: 'px',
    uniform: 0,
    corners: { tl: 40, tr: 8, br: 40, bl: 8 },
    ellipse: { tlX: 40, tlY: 40, trX: 8, trY: 8, brX: 40, brY: 40, blX: 8, blY: 8 },
  },
  {
    name: '椭圆',
    mode: 'ellipse',
    unit: '%',
    uniform: 50,
    corners: { tl: 50, tr: 50, br: 50, bl: 50 },
    ellipse: { tlX: 100, tlY: 50, trX: 100, trY: 50, brX: 100, brY: 50, blX: 100, blY: 50 },
  },
  {
    name: '波浪',
    mode: 'corners',
    unit: '%',
    uniform: 0,
    corners: { tl: 100, tr: 0, br: 100, bl: 0 },
    ellipse: { tlX: 100, tlY: 100, trX: 0, trY: 0, brX: 100, brY: 100, blX: 0, blY: 0 },
  },
];

// 中文角点标签映射
const CORNER_LABELS: Record<keyof Corners, string> = {
  tl: '左上',
  tr: '右上',
  br: '右下',
  bl: '左下',
};

const ELLIPSE_LABELS: Record<keyof EllipseCorners, string> = {
  tlX: '左上 水平',
  tlY: '左上 垂直',
  trX: '右上 水平',
  trY: '右上 垂直',
  brX: '右下 水平',
  brY: '右下 垂直',
  blX: '左下 水平',
  blY: '左下 垂直',
};

/** 根据模式与参数生成完整 border-radius CSS 值 */
function buildRadius(mode: Mode, unit: Unit, uniform: number, corners: Corners, ellipse: EllipseCorners): string {
  const u = unit;
  if (mode === 'uniform') {
    return `${uniform}${u}`;
  }
  if (mode === 'corners') {
    // 四角顺序：左上、右上、右下、左下
    return `${corners.tl}${u} ${corners.tr}${u} ${corners.br}${u} ${corners.bl}${u}`;
  }
  // 椭圆模式：水平四值 / 垂直四值，用斜杠分隔
  const h = `${ellipse.tlX}${u} ${ellipse.trX}${u} ${ellipse.brX}${u} ${ellipse.blX}${u}`;
  const v = `${ellipse.tlY}${u} ${ellipse.trY}${u} ${ellipse.brY}${u} ${ellipse.blY}${u}`;
  return `${h} / ${v}`;
}

/** 单角滑块控件（四角模式） */
function CornerSlider({
  field,
  value,
  unit,
  max,
  onChange,
}: {
  field: keyof Corners;
  value: number;
  unit: Unit;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="brr__slider">
      <span className="brr__slider-label">{CORNER_LABELS[field]}</span>
      <input
        type="range"
        min="0"
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`${CORNER_LABELS[field]}圆角半径`}
      />
      <output className="brr__slider-value">{value}{unit}</output>
    </label>
  );
}

/** 椭圆模式八值滑块控件 */
function EllipseSlider({
  field,
  value,
  unit,
  max,
  onChange,
}: {
  field: keyof EllipseCorners;
  value: number;
  unit: Unit;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="brr__slider brr__slider--ellipse">
      <span className="brr__slider-label">{ELLIPSE_LABELS[field]}</span>
      <input
        type="range"
        min="0"
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`${ELLIPSE_LABELS[field]}半径`}
      />
      <output className="brr__slider-value">{value}{unit}</output>
    </label>
  );
}

export default function BorderRadiusTool() {
  // 初始为"卡片"预设，首屏即有友好效果
  const [mode, setMode] = useState<Mode>('uniform');
  const [unit, setUnit] = useState<Unit>('px');
  const [uniform, setUniform] = useState(12);
  const [corners, setCorners] = useState<Corners>({ tl: 12, tr: 12, br: 12, bl: 12 });
  const [ellipse, setEllipse] = useState<EllipseCorners>({
    tlX: 12, tlY: 12, trX: 12, trY: 12, brX: 12, brY: 12, blX: 12, blY: 12,
  });
  const [previewSize, setPreviewSize] = useState(200);
  const [previewBg, setPreviewBg] = useState('#2b6cff');
  const [copied, setCopied] = useState(false);

  // 滑块上限：px 单位 0-200 足够，% 单位 0-100
  const max = unit === 'px' ? 200 : 100;

  const radiusValue = useMemo(
    () => buildRadius(mode, unit, uniform, corners, ellipse),
    [mode, unit, uniform, corners, ellipse],
  );
  const cssCode = useMemo(() => `border-radius: ${radiusValue};`, [radiusValue]);

  // 修改四角某一角
  const patchCorner = useCallback((field: keyof Corners, v: number) => {
    setCorners((prev) => ({ ...prev, [field]: v }));
  }, []);

  // 修改椭圆某一轴
  const patchEllipse = useCallback((field: keyof EllipseCorners, v: number) => {
    setEllipse((prev) => ({ ...prev, [field]: v }));
  }, []);

  // 应用预设
  const applyPreset = useCallback((p: RadiusPreset) => {
    setMode(p.mode);
    setUnit(p.unit);
    setUniform(p.uniform);
    setCorners({ ...p.corners });
    setEllipse({ ...p.ellipse });
  }, []);

  // 复制 CSS
  const handleCopy = useCallback(async () => {
    const ok = await copyText(cssCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [cssCode]);

  // 切换单位时自动转换数值（% ↔ px 不直接换算，按值域裁剪到上限内）
  const handleUnitChange = useCallback((next: Unit) => {
    if (next === unit) return;
    const nextMax = next === 'px' ? 200 : 100;
    setUnit(next);
    setUniform((v) => Math.min(v, nextMax));
    setCorners((c) => ({
      tl: Math.min(c.tl, nextMax),
      tr: Math.min(c.tr, nextMax),
      br: Math.min(c.br, nextMax),
      bl: Math.min(c.bl, nextMax),
    }));
    setEllipse((e) => ({
      tlX: Math.min(e.tlX, nextMax), tlY: Math.min(e.tlY, nextMax),
      trX: Math.min(e.trX, nextMax), trY: Math.min(e.trY, nextMax),
      brX: Math.min(e.brX, nextMax), brY: Math.min(e.brY, nextMax),
      blX: Math.min(e.blX, nextMax), blY: Math.min(e.blY, nextMax),
    }));
  }, [unit]);

  return (
    <div className="brr">
      {/* 预览区 */}
      <div className="brr__preview-wrap">
        <div
          className="brr__preview"
          style={{
            width: `${previewSize}px`,
            height: `${previewSize}px`,
            background: previewBg,
            borderRadius: radiusValue,
          }}
        />
        <div className="brr__preview-controls">
          <label className="brr__preview-size">
            尺寸
            <input
              type="range"
              min="80"
              max="320"
              value={previewSize}
              onChange={(e) => setPreviewSize(Number(e.target.value))}
            />
            <output>{previewSize}px</output>
          </label>
          <label className="brr__preview-bg">
            颜色
            <input
              type="color"
              value={previewBg}
              onChange={(e) => setPreviewBg(e.target.value)}
              aria-label="预览背景色"
            />
          </label>
        </div>
      </div>

      {/* 预设按钮组 */}
      <div className="brr__presets">
        <span className="brr__presets-label">预设：</span>
        {PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            className="brr__btn brr__btn--preset"
            onClick={() => applyPreset(p)}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* 模式与单位切换 */}
      <div className="brr__controls">
        <div className="brr__control-group">
          <span className="brr__control-label">编辑模式</span>
          <div className="brr__seg">
            <button
              type="button"
              className={`brr__seg-btn${mode === 'uniform' ? ' is-active' : ''}`}
              onClick={() => setMode('uniform')}
            >
              单一值
            </button>
            <button
              type="button"
              className={`brr__seg-btn${mode === 'corners' ? ' is-active' : ''}`}
              onClick={() => setMode('corners')}
            >
              四角独立
            </button>
            <button
              type="button"
              className={`brr__seg-btn${mode === 'ellipse' ? ' is-active' : ''}`}
              onClick={() => setMode('ellipse')}
            >
              椭圆八值
            </button>
          </div>
        </div>

        <div className="brr__control-group">
          <span className="brr__control-label">单位</span>
          <div className="brr__seg">
            <button
              type="button"
              className={`brr__seg-btn${unit === 'px' ? ' is-active' : ''}`}
              onClick={() => handleUnitChange('px')}
            >
              px 像素
            </button>
            <button
              type="button"
              className={`brr__seg-btn${unit === '%' ? ' is-active' : ''}`}
              onClick={() => handleUnitChange('%')}
            >
              % 百分比
            </button>
          </div>
        </div>
      </div>

      {/* 参数滑块区，按模式分派 */}
      {mode === 'uniform' && (
        <div className="brr__sliders">
          <label className="brr__slider brr__slider--uniform">
            <span className="brr__slider-label">圆角半径</span>
            <input
              type="range"
              min="0"
              max={max}
              value={uniform}
              onChange={(e) => setUniform(Number(e.target.value))}
            />
            <output className="brr__slider-value">{uniform}{unit}</output>
          </label>
        </div>
      )}

      {mode === 'corners' && (
        <div className="brr__sliders">
          {(Object.keys(corners) as (keyof Corners)[]).map((field) => (
            <CornerSlider
              key={field}
              field={field}
              value={corners[field]}
              unit={unit}
              max={max}
              onChange={(v) => patchCorner(field, v)}
            />
          ))}
        </div>
      )}

      {mode === 'ellipse' && (
        <div className="brr__sliders brr__sliders--grid">
          {(Object.keys(ellipse) as (keyof EllipseCorners)[]).map((field) => (
            <EllipseSlider
              key={field}
              field={field}
              value={ellipse[field]}
              unit={unit}
              max={max}
              onChange={(v) => patchEllipse(field, v)}
            />
          ))}
        </div>
      )}

      {/* CSS 代码输出 */}
      <div className="brr__output">
        <div className="brr__output-head">
          <span className="brr__output-label">CSS 代码</span>
          <button type="button" className="brr__btn brr__btn--copy" onClick={handleCopy}>
            {copied ? '已复制 ✓' : '复制'}
          </button>
        </div>
        <pre className="brr__code">{cssCode}</pre>
      </div>
    </div>
  );
}
