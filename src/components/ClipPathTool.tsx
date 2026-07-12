import { useState, useMemo, useCallback, useRef } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS clip-path 路径裁剪可视化生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 四种裁剪类型：polygon 多边形 / circle 圆形 / ellipse 椭圆 / inset 内嵌矩形
 *  - polygon 支持交互式顶点编辑：拖拽移动、点击空白添加、选中删除
 *  - circle/ellipse 滑块控制半径与中心位置
 *  - inset 四边内缩 + 圆角参数
 *  - 8 组预设：三角形、菱形、五边形、六边形、星形、心形、箭头、对话气泡
 *  - 可调预览尺寸与背景色，棋盘格背景可视化透明区域
 *  - 实时生成 CSS 代码，一键复制
 */

type ClipType = 'polygon' | 'circle' | 'ellipse' | 'inset';

/** 多边形顶点（百分比坐标，0-100） */
interface Point {
  x: number;
  y: number;
}

/** circle 参数 */
interface CircleParams {
  radius: number; // 半径 %
  cx: number; // 中心 x %
  cy: number; // 中心 y %
}

/** ellipse 参数 */
interface EllipseParams {
  rx: number; // 水平半径 %
  ry: number; // 垂直半径 %
  cx: number;
  cy: number;
}

/** inset 参数（四边内缩 + 圆角） */
interface InsetParams {
  top: number;
  right: number;
  bottom: number;
  left: number;
  round: number; // 圆角 px
}

/** 预设效果 */
interface ClipPreset {
  name: string;
  type: ClipType;
  polygon: Point[];
  circle: CircleParams;
  ellipse: EllipseParams;
  inset: InsetParams;
}

// 8 组预设覆盖常见形状需求
const PRESETS: ClipPreset[] = [
  {
    name: '三角形',
    type: 'polygon',
    polygon: [
      { x: 50, y: 5 },
      { x: 95, y: 95 },
      { x: 5, y: 95 },
    ],
    circle: { radius: 50, cx: 50, cy: 50 },
    ellipse: { rx: 50, ry: 50, cx: 50, cy: 50 },
    inset: { top: 0, right: 0, bottom: 0, left: 0, round: 0 },
  },
  {
    name: '菱形',
    type: 'polygon',
    polygon: [
      { x: 50, y: 0 },
      { x: 100, y: 50 },
      { x: 50, y: 100 },
      { x: 0, y: 50 },
    ],
    circle: { radius: 50, cx: 50, cy: 50 },
    ellipse: { rx: 50, ry: 50, cx: 50, cy: 50 },
    inset: { top: 0, right: 0, bottom: 0, left: 0, round: 0 },
  },
  {
    name: '五边形',
    type: 'polygon',
    polygon: [
      { x: 50, y: 0 },
      { x: 100, y: 38 },
      { x: 82, y: 100 },
      { x: 18, y: 100 },
      { x: 0, y: 38 },
    ],
    circle: { radius: 50, cx: 50, cy: 50 },
    ellipse: { rx: 50, ry: 50, cx: 50, cy: 50 },
    inset: { top: 0, right: 0, bottom: 0, left: 0, round: 0 },
  },
  {
    name: '六边形',
    type: 'polygon',
    polygon: [
      { x: 25, y: 0 },
      { x: 75, y: 0 },
      { x: 100, y: 50 },
      { x: 75, y: 100 },
      { x: 25, y: 100 },
      { x: 0, y: 50 },
    ],
    circle: { radius: 50, cx: 50, cy: 50 },
    ellipse: { rx: 50, ry: 50, cx: 50, cy: 50 },
    inset: { top: 0, right: 0, bottom: 0, left: 0, round: 0 },
  },
  {
    name: '星形',
    type: 'polygon',
    polygon: [
      { x: 50, y: 0 },
      { x: 61, y: 35 },
      { x: 98, y: 35 },
      { x: 68, y: 57 },
      { x: 79, y: 91 },
      { x: 50, y: 70 },
      { x: 21, y: 91 },
      { x: 32, y: 57 },
      { x: 2, y: 35 },
      { x: 39, y: 35 },
    ],
    circle: { radius: 50, cx: 50, cy: 50 },
    ellipse: { rx: 50, ry: 50, cx: 50, cy: 50 },
    inset: { top: 0, right: 0, bottom: 0, left: 0, round: 0 },
  },
  {
    name: '心形',
    type: 'polygon',
    polygon: [
      { x: 50, y: 90 },
      { x: 5, y: 45 },
      { x: 5, y: 25 },
      { x: 25, y: 10 },
      { x: 50, y: 30 },
      { x: 75, y: 10 },
      { x: 95, y: 25 },
      { x: 95, y: 45 },
    ],
    circle: { radius: 50, cx: 50, cy: 50 },
    ellipse: { rx: 50, ry: 50, cx: 50, cy: 50 },
    inset: { top: 0, right: 0, bottom: 0, left: 0, round: 0 },
  },
  {
    name: '箭头',
    type: 'polygon',
    polygon: [
      { x: 0, y: 35 },
      { x: 60, y: 35 },
      { x: 60, y: 10 },
      { x: 100, y: 50 },
      { x: 60, y: 90 },
      { x: 60, y: 65 },
      { x: 0, y: 65 },
    ],
    circle: { radius: 50, cx: 50, cy: 50 },
    ellipse: { rx: 50, ry: 50, cx: 50, cy: 50 },
    inset: { top: 0, right: 0, bottom: 0, left: 0, round: 0 },
  },
  {
    name: '对话气泡',
    type: 'polygon',
    polygon: [
      { x: 10, y: 5 },
      { x: 90, y: 5 },
      { x: 90, y: 70 },
      { x: 65, y: 70 },
      { x: 65, y: 95 },
      { x: 45, y: 70 },
      { x: 10, y: 70 },
    ],
    circle: { radius: 50, cx: 50, cy: 50 },
    ellipse: { rx: 50, ry: 50, cx: 50, cy: 50 },
    inset: { top: 0, right: 0, bottom: 0, left: 0, round: 0 },
  },
];

const TYPE_LABELS: Record<ClipType, string> = {
  polygon: '多边形',
  circle: '圆形',
  ellipse: '椭圆',
  inset: '内嵌矩形',
};

/** 生成 polygon() CSS 值 */
function buildPolygon(points: Point[]): string {
  return `polygon(${points.map((p) => `${p.x}% ${p.y}%`).join(', ')})`;
}

/** 生成 circle() CSS 值 */
function buildCircle(c: CircleParams): string {
  return `circle(${c.radius}% at ${c.cx}% ${c.cy}%)`;
}

/** 生成 ellipse() CSS 值 */
function buildEllipse(e: EllipseParams): string {
  return `ellipse(${e.rx}% ${e.ry}% at ${e.cx}% ${e.cy}%)`;
}

/** 生成 inset() CSS 值 */
function buildInset(i: InsetParams): string {
  const sides = `${i.top}% ${i.right}% ${i.bottom}% ${i.left}%`;
  return i.round > 0 ? `inset(${sides} round ${i.round}px)` : `inset(${sides})`;
}

export default function ClipPathTool() {
  // 初始为"星形"预设，首屏即有视觉吸引力
  const [type, setType] = useState<ClipType>('polygon');
  const [polygon, setPolygon] = useState<Point[]>(PRESETS[4].polygon);
  const [circle, setCircle] = useState<CircleParams>({ radius: 50, cx: 50, cy: 50 });
  const [ellipse, setEllipse] = useState<EllipseParams>({ rx: 50, ry: 50, cx: 50, cy: 50 });
  const [inset, setInset] = useState<InsetParams>({ top: 10, right: 10, bottom: 10, left: 10, round: 12 });
  const [previewSize, setPreviewSize] = useState(220);
  const [previewBg, setPreviewBg] = useState('#2b6cff');
  const [copied, setCopied] = useState(false);
  // polygon 编辑相关状态
  const [selectedIdx, setSelectedIdx] = useState<number>(-1);
  const dragIdx = useRef<number>(-1);
  const svgRef = useRef<SVGSVGElement>(null);

  // 根据类型生成 clip-path 值
  const clipValue = useMemo(() => {
    if (type === 'polygon') return buildPolygon(polygon);
    if (type === 'circle') return buildCircle(circle);
    if (type === 'ellipse') return buildEllipse(ellipse);
    return buildInset(inset);
  }, [type, polygon, circle, ellipse, inset]);

  const cssCode = useMemo(() => `clip-path: ${clipValue};`, [clipValue]);

  // 应用预设
  const applyPreset = useCallback((p: ClipPreset) => {
    setType(p.type);
    setPolygon([...p.polygon]);
    setCircle({ ...p.circle });
    setEllipse({ ...p.ellipse });
    setInset({ ...p.inset });
    setSelectedIdx(-1);
  }, []);

  // 复制 CSS
  const handleCopy = useCallback(async () => {
    const ok = await copyText(cssCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [cssCode]);

  // === polygon 顶点编辑：拖拽与点击 ===
  // 将鼠标客户端坐标转换为 SVG viewBox 百分比坐标（0-100）
  const toSvgCoord = useCallback((clientX: number, clientY: number): Point => {
    const svg = svgRef.current;
    if (!svg) return { x: 50, y: 50 };
    const rect = svg.getBoundingClientRect();
    // 防止除零：getBoundingClientRect 极端情况下可能为零
    const w = rect.width || 1;
    const h = rect.height || 1;
    return {
      x: Math.max(0, Math.min(100, ((clientX - rect.left) / w) * 100)),
      y: Math.max(0, Math.min(100, ((clientY - rect.top) / h) * 100)),
    };
  }, []);

  // 开始拖拽顶点
  const handlePointDown = useCallback((e: React.PointerEvent, idx: number) => {
    e.stopPropagation();
    e.preventDefault();
    dragIdx.current = idx;
    setSelectedIdx(idx);
    (e.target as Element).setPointerCapture(e.pointerId);
  }, []);

  // 拖拽移动
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragIdx.current < 0) return;
      const pt = toSvgCoord(e.clientX, e.clientY);
      setPolygon((prev) => prev.map((p, i) => (i === dragIdx.current ? pt : p)));
    },
    [toSvgCoord],
  );

  // 结束拖拽
  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (dragIdx.current >= 0) {
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    }
    dragIdx.current = -1;
  }, []);

  // 点击空白区域添加顶点（插入到选中点之后，或末尾）
  const handleSvgClick = useCallback(
    (e: React.MouseEvent) => {
      // 仅在点击空白（非顶点）时添加
      if (e.target !== svgRef.current) return;
      const pt = toSvgCoord(e.clientX, e.clientY);
      setPolygon((prev) => {
        // 插入位置：选中点之后，否则末尾
        const insertAt = selectedIdx >= 0 ? selectedIdx + 1 : prev.length;
        const next = [...prev];
        next.splice(insertAt, 0, pt);
        return next;
      });
    },
    [toSvgCoord, selectedIdx],
  );

  // 删除选中顶点（至少保留 3 个点构成多边形）
  const handleDeletePoint = useCallback(() => {
    if (selectedIdx < 0) return;
    setPolygon((prev) => {
      if (prev.length <= 3) return prev; // 多边形至少 3 个顶点
      return prev.filter((_, i) => i !== selectedIdx);
    });
    setSelectedIdx(-1);
  }, [selectedIdx]);

  // 生成 SVG polygon points 字符串
  const svgPoints = useMemo(() => polygon.map((p) => `${p.x},${p.y}`).join(' '), [polygon]);

  return (
    <div className="clp">
      {/* 预览区：SVG 交互编辑器（仅 polygon 模式）+ 视觉预览 */}
      <div className="clp__preview-wrap">
        <div
          className="clp__preview"
          style={{
            width: `${previewSize}px`,
            height: `${previewSize}px`,
            background: previewBg,
            clipPath: clipValue,
            WebkitClipPath: clipValue,
          }}
        />
        {type === 'polygon' && (
          <div className="clp__editor-wrap">
            <svg
              ref={svgRef}
              className="clp__editor"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              onClick={handleSvgClick}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              role="img"
              aria-label="多边形顶点编辑器，点击空白添加顶点，拖拽顶点移动，选中后可删除"
            >
              {/* 棋盘格背景辅助层 */}
              <defs>
                <pattern id="clp-grid" width="10" height="10" patternUnits="userSpaceOnUse">
                  <rect width="10" height="10" fill="#f1f5f9" />
                  <rect width="5" height="5" fill="#e2e8f0" />
                  <rect x="5" y="5" width="5" height="5" fill="#e2e8f0" />
                </pattern>
              </defs>
              <rect x="0" y="0" width="100" height="100" fill="url(#clp-grid)" />
              {/* 多边形填充半透明预览 */}
              <polygon
                points={svgPoints}
                fill={previewBg}
                fillOpacity="0.35"
                stroke="var(--color-primary, #2b6cff)"
                strokeWidth="0.8"
                vectorEffect="non-scaling-stroke"
              />
              {/* 顶点手柄 */}
              {polygon.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={selectedIdx === i ? 3 : 2}
                  fill={selectedIdx === i ? '#ef4444' : '#ffffff'}
                  stroke={selectedIdx === i ? '#ffffff' : 'var(--color-primary, #2b6cff)'}
                  strokeWidth="1.2"
                  vectorEffect="non-scaling-stroke"
                  style={{ cursor: 'grab' }}
                  onPointerDown={(e) => handlePointDown(e, i)}
                />
              ))}
            </svg>
            <p className="clp__editor-hint">
              点击空白添加顶点 · 拖拽顶点移动 · 选中红色顶点后可删除
              {selectedIdx >= 0 && <button type="button" className="clp__btn clp__btn--del" onClick={handleDeletePoint}>删除选中点</button>}
            </p>
          </div>
        )}
        <div className="clp__preview-controls">
          <label className="clp__preview-size">
            尺寸
            <input
              type="range"
              min="120"
              max="320"
              value={previewSize}
              onChange={(e) => setPreviewSize(Number(e.target.value))}
            />
            <output>{previewSize}px</output>
          </label>
          <label className="clp__preview-bg">
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
      <div className="clp__presets">
        <span className="clp__presets-label">预设：</span>
        {PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            className="clp__btn clp__btn--preset"
            onClick={() => applyPreset(p)}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* 裁剪类型切换 */}
      <div className="clp__controls">
        <div className="clp__control-group">
          <span className="clp__control-label">裁剪类型</span>
          <div className="clp__seg">
            {(Object.keys(TYPE_LABELS) as ClipType[]).map((t) => (
              <button
                key={t}
                type="button"
                className={`clp__seg-btn${type === t ? ' is-active' : ''}`}
                onClick={() => {
                  setType(t);
                  setSelectedIdx(-1);
                }}
              >
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 参数控制区，按类型分派 */}
      {type === 'polygon' && (
        <div className="clp__params clp__params--polygon">
          <p className="clp__params-hint">
            当前 {polygon.length} 个顶点。在预览编辑器中点击空白添加顶点，拖拽顶点调整位置，选中后可删除（至少保留 3 个）。
          </p>
        </div>
      )}

      {type === 'circle' && (
        <div className="clp__sliders">
          <label className="clp__slider">
            <span className="clp__slider-label">半径</span>
            <input type="range" min="1" max="100" value={circle.radius} onChange={(e) => setCircle((c) => ({ ...c, radius: Number(e.target.value) }))} />
            <output className="clp__slider-value">{circle.radius}%</output>
          </label>
          <label className="clp__slider">
            <span className="clp__slider-label">中心 X</span>
            <input type="range" min="0" max="100" value={circle.cx} onChange={(e) => setCircle((c) => ({ ...c, cx: Number(e.target.value) }))} />
            <output className="clp__slider-value">{circle.cx}%</output>
          </label>
          <label className="clp__slider">
            <span className="clp__slider-label">中心 Y</span>
            <input type="range" min="0" max="100" value={circle.cy} onChange={(e) => setCircle((c) => ({ ...c, cy: Number(e.target.value) }))} />
            <output className="clp__slider-value">{circle.cy}%</output>
          </label>
        </div>
      )}

      {type === 'ellipse' && (
        <div className="clp__sliders">
          <label className="clp__slider">
            <span className="clp__slider-label">水平半径</span>
            <input type="range" min="1" max="100" value={ellipse.rx} onChange={(e) => setEllipse((v) => ({ ...v, rx: Number(e.target.value) }))} />
            <output className="clp__slider-value">{ellipse.rx}%</output>
          </label>
          <label className="clp__slider">
            <span className="clp__slider-label">垂直半径</span>
            <input type="range" min="1" max="100" value={ellipse.ry} onChange={(e) => setEllipse((v) => ({ ...v, ry: Number(e.target.value) }))} />
            <output className="clp__slider-value">{ellipse.ry}%</output>
          </label>
          <label className="clp__slider">
            <span className="clp__slider-label">中心 X</span>
            <input type="range" min="0" max="100" value={ellipse.cx} onChange={(e) => setEllipse((v) => ({ ...v, cx: Number(e.target.value) }))} />
            <output className="clp__slider-value">{ellipse.cx}%</output>
          </label>
          <label className="clp__slider">
            <span className="clp__slider-label">中心 Y</span>
            <input type="range" min="0" max="100" value={ellipse.cy} onChange={(e) => setEllipse((v) => ({ ...v, cy: Number(e.target.value) }))} />
            <output className="clp__slider-value">{ellipse.cy}%</output>
          </label>
        </div>
      )}

      {type === 'inset' && (
        <div className="clp__sliders clp__sliders--grid">
          <label className="clp__slider">
            <span className="clp__slider-label">上边距</span>
            <input type="range" min="0" max="50" value={inset.top} onChange={(e) => setInset((v) => ({ ...v, top: Number(e.target.value) }))} />
            <output className="clp__slider-value">{inset.top}%</output>
          </label>
          <label className="clp__slider">
            <span className="clp__slider-label">右边距</span>
            <input type="range" min="0" max="50" value={inset.right} onChange={(e) => setInset((v) => ({ ...v, right: Number(e.target.value) }))} />
            <output className="clp__slider-value">{inset.right}%</output>
          </label>
          <label className="clp__slider">
            <span className="clp__slider-label">下边距</span>
            <input type="range" min="0" max="50" value={inset.bottom} onChange={(e) => setInset((v) => ({ ...v, bottom: Number(e.target.value) }))} />
            <output className="clp__slider-value">{inset.bottom}%</output>
          </label>
          <label className="clp__slider">
            <span className="clp__slider-label">左边距</span>
            <input type="range" min="0" max="50" value={inset.left} onChange={(e) => setInset((v) => ({ ...v, left: Number(e.target.value) }))} />
            <output className="clp__slider-value">{inset.left}%</output>
          </label>
          <label className="clp__slider">
            <span className="clp__slider-label">圆角</span>
            <input type="range" min="0" max="80" value={inset.round} onChange={(e) => setInset((v) => ({ ...v, round: Number(e.target.value) }))} />
            <output className="clp__slider-value">{inset.round}px</output>
          </label>
        </div>
      )}

      {/* CSS 代码输出 */}
      <div className="clp__output">
        <div className="clp__output-head">
          <span className="clp__output-label">CSS 代码</span>
          <button type="button" className="clp__btn clp__btn--copy" onClick={handleCopy}>
            {copied ? '已复制 ✓' : '复制'}
          </button>
        </div>
        <pre className="clp__code">{cssCode}</pre>
      </div>
    </div>
  );
}
