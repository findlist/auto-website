import { useState, useMemo, useCallback, useRef } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS transition 过渡生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - transition 四大子属性：property / duration / timing-function / delay
 *  - cubic-bezier 曲线编辑器（SVG 可拖拽控制点，支持 y 轴超出 [0,1] 实现回弹）
 *  - steps() 阶跃函数支持（步数 + jump-start/jump-end）
 *  - hover 触发实时预览
 *  - 8 组预设过渡效果
 *  - 智能代码生成（仅输出非默认值），一键复制
 */

/** 可过渡的 CSS 属性及对应的结束态样式（用于预览演示） */
const TRANSITION_PROPERTIES = [
  { value: 'all', label: 'all（所有属性）', endStyle: 'scale(1.15)', endCss: { transform: 'scale(1.15)' } },
  { value: 'transform', label: 'transform', endStyle: 'scale(1.2) rotate(8deg)', endCss: { transform: 'scale(1.2) rotate(8deg)' } },
  { value: 'opacity', label: 'opacity', endStyle: '0.4', endCss: { opacity: 0.4 } },
  { value: 'background-color', label: 'background-color', endStyle: '#dc2626', endCss: { backgroundColor: '#dc2626' } },
  { value: 'color', label: 'color', endStyle: '#ffffff', endCss: { color: '#ffffff' } },
  { value: 'border-radius', label: 'border-radius', endStyle: '50%', endCss: { borderRadius: '50%' } },
  { value: 'box-shadow', label: 'box-shadow', endStyle: '0 12px 32px rgba(220,38,38,0.4)', endCss: { boxShadow: '0 12px 32px rgba(220,38,38,0.4)' } },
  { value: 'width', label: 'width', endStyle: '180px', endCss: { width: '180px' } },
] as const;

/** 缓动函数配置类型 */
type TimingType = 'preset' | 'cubic' | 'steps';

/** cubic-bezier 控制点参数（P0=(0,0) P3=(1,1) 固定，P1/P2 可调） */
interface CubicBezier {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** steps() 阶跃配置 */
interface StepConfig {
  count: number;
  /** jump-start 等价于 step-start，jump-end 等价于 step-end */
  jumpTerm: 'jump-start' | 'jump-end';
}

/** 预设过渡数据结构 */
interface TransitionPreset {
  name: string;
  property: string;
  duration: number;
  timingType: TimingType;
  cubic: CubicBezier;
  steps: StepConfig;
  presetFn: string;
  delay: number;
}

// 默认值
const DEFAULT_CUBIC: CubicBezier = { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1.0 }; // 等价 ease
const DEFAULT_STEPS: StepConfig = { count: 4, jumpTerm: 'jump-end' };
const TIMING_PRESETS = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'];

// 8 组预设过渡，覆盖常见交互场景
const PRESETS: TransitionPreset[] = [
  { name: '平滑过渡', property: 'opacity', duration: 0.3, timingType: 'preset', cubic: DEFAULT_CUBIC, steps: DEFAULT_STEPS, presetFn: 'ease', delay: 0 },
  { name: '弹性回弹', property: 'transform', duration: 0.5, timingType: 'cubic', cubic: { x1: 0.68, y1: -0.55, x2: 0.27, y2: 1.55 }, steps: DEFAULT_STEPS, presetFn: 'ease', delay: 0 },
  { name: '慢出效果', property: 'transform', duration: 0.4, timingType: 'preset', cubic: DEFAULT_CUBIC, steps: DEFAULT_STEPS, presetFn: 'ease-out', delay: 0 },
  { name: '快入效果', property: 'background-color', duration: 0.3, timingType: 'preset', cubic: DEFAULT_CUBIC, steps: DEFAULT_STEPS, presetFn: 'ease-in', delay: 0 },
  { name: '阶跃动画', property: 'transform', duration: 0.8, timingType: 'steps', cubic: DEFAULT_CUBIC, steps: { count: 4, jumpTerm: 'jump-end' }, presetFn: 'ease', delay: 0 },
  { name: '旋转过渡', property: 'transform', duration: 0.6, timingType: 'preset', cubic: DEFAULT_CUBIC, steps: DEFAULT_STEPS, presetFn: 'linear', delay: 0 },
  { name: '缩放回弹', property: 'transform', duration: 0.4, timingType: 'cubic', cubic: { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 }, steps: DEFAULT_STEPS, presetFn: 'ease', delay: 0 },
  { name: '阴影过渡', property: 'box-shadow', duration: 0.3, timingType: 'preset', cubic: DEFAULT_CUBIC, steps: DEFAULT_STEPS, presetFn: 'ease', delay: 0.1 },
];

/** SVG 曲线编辑器尺寸常量 */
const SVG_SIZE = 200;
const SVG_PAD = 20;
const CURVE_RANGE = SVG_SIZE - SVG_PAD * 2; // 160

/**
 * 将 cubic-bezier 参数（0-1 域，y 可超出）映射为 SVG 坐标
 * 注意：SVG y 向下为正，而进度 y 向上为正，需翻转
 */
const toSvgX = (x: number) => SVG_PAD + x * CURVE_RANGE;
const toSvgY = (y: number) => SVG_SIZE - SVG_PAD - y * CURVE_RANGE;

/** 将 SVG 坐标反向映射回 cubic-bezier 参数 */
const fromSvgX = (sx: number) => (sx - SVG_PAD) / CURVE_RANGE;
const fromSvgY = (sy: number) => (SVG_SIZE - SVG_PAD - sy) / CURVE_RANGE;

/**
 * 生成三次贝塞尔曲线路径（用于 SVG path d 属性）
 * 通过参数方程采样 50 个点连成折线，近似平滑曲线
 */
const buildBezierPath = (c: CubicBezier): string => {
  const points: string[] = [];
  for (let i = 0; i <= 50; i++) {
    const t = i / 50;
    // 三次贝塞尔参数方程：B(t) = (1-t)³P0 + 3(1-t)²t P1 + 3(1-t)t² P2 + t³ P3
    const x = 3 * (1 - t) * (1 - t) * t * c.x1 + 3 * (1 - t) * t * t * c.x2 + t * t * t;
    const y = 3 * (1 - t) * (1 - t) * t * c.y1 + 3 * (1 - t) * t * t * c.y2 + t * t * t;
    points.push(`${toSvgX(x).toFixed(2)},${toSvgY(y).toFixed(2)}`);
  }
  return `M ${points.join(' L ')}`;
};

/**
 * cubic-bezier 曲线编辑器子组件
 * 通过拖拽两个控制点 P1/P2 实时调整贝塞尔曲线形状
 */
function CubicBezierEditor({
  cubic,
  onChange,
}: {
  cubic: CubicBezier;
  onChange: (c: CubicBezier) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  // 当前正在拖拽的控制点标识：1 表示 P1，2 表示 P2
  const draggingRef = useRef<0 | 1 | 2>(0);

  /** 将客户端坐标转换为 cubic-bezier 参数并更新对应控制点 */
  const updatePoint = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      // 将客户端坐标映射到 SVG viewBox 坐标
      const sx = ((clientX - rect.left) / rect.width) * SVG_SIZE;
      const sy = ((clientY - rect.top) / rect.height) * SVG_SIZE;
      // 反向映射为 cubic-bezier 参数
      let x = fromSvgX(sx);
      let y = fromSvgY(sy);
      // x 轴严格限制在 [0,1]（CSS 规范要求），y 轴允许超出实现回弹效果
      x = Math.max(0, Math.min(1, x));
      y = Math.max(-0.5, Math.min(1.5, y));
      // 四舍五入到两位小数，避免浮点精度问题
      x = Math.round(x * 100) / 100;
      y = Math.round(y * 100) / 100;

      if (draggingRef.current === 1) {
        onChange({ ...cubic, x1: x, y1: y });
      } else if (draggingRef.current === 2) {
        onChange({ ...cubic, x2: x, y2: y });
      }
    },
    [cubic, onChange]
  );

  // Pointer Events 统一处理鼠标/触摸/触控笔
  const handlePointerDown = useCallback(
    (e: React.PointerEvent, which: 1 | 2) => {
      e.preventDefault();
      draggingRef.current = which;
      (e.target as Element).setPointerCapture(e.pointerId);
      updatePoint(e.clientX, e.clientY);
    },
    [updatePoint]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (draggingRef.current === 0) return;
      updatePoint(e.clientX, e.clientY);
    },
    [updatePoint]
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    draggingRef.current = 0;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }, []);

  // 控制点坐标
  const p0 = { x: toSvgX(0), y: toSvgY(0) };
  const p1 = { x: toSvgX(cubic.x1), y: toSvgY(cubic.y1) };
  const p2 = { x: toSvgX(cubic.x2), y: toSvgY(cubic.y2) };
  const p3 = { x: toSvgX(1), y: toSvgY(1) };

  return (
    <div className="trn__bezier">
      <div className="trn__bezier-svg">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {/* 网格背景 */}
          <rect x={SVG_PAD} y={SVG_PAD} width={CURVE_RANGE} height={CURVE_RANGE} className="trn__bezier-grid" />
          {/* 对角参考线（linear） */}
          <line x1={p0.x} y1={p0.y} x2={p3.x} y2={p3.y} className="trn__bezier-ref" />
          {/* 控制线 P0-P1 与 P2-P3（虚线） */}
          <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} className="trn__bezier-ctrl" />
          <line x1={p2.x} y1={p2.y} x2={p3.x} y2={p3.y} className="trn__bezier-ctrl" />
          {/* 贝塞尔曲线 */}
          <path d={buildBezierPath(cubic)} className="trn__bezier-curve" />
          {/* 固定端点 P0/P3 */}
          <circle cx={p0.x} cy={p0.y} r={5} className="trn__bezier-end" />
          <circle cx={p3.x} cy={p3.y} r={5} className="trn__bezier-end" />
          {/* 可拖拽控制点 P1/P2 */}
          <circle
            cx={p1.x}
            cy={p1.y}
            r={7}
            className="trn__bezier-handle"
            onPointerDown={(e) => handlePointerDown(e, 1)}
          />
          <circle
            cx={p2.x}
            cy={p2.y}
            r={7}
            className="trn__bezier-handle"
            onPointerDown={(e) => handlePointerDown(e, 2)}
          />
        </svg>
      </div>
      <div className="trn__bezier-vals">
        <label>
          x1: <input type="number" step="0.01" min={0} max={1} value={cubic.x1}
            onChange={(e) => onChange({ ...cubic, x1: Math.max(0, Math.min(1, +e.target.value || 0)) })} />
        </label>
        <label>
          y1: <input type="number" step="0.01" value={cubic.y1}
            onChange={(e) => onChange({ ...cubic, y1: +e.target.value || 0 })} />
        </label>
        <label>
          x2: <input type="number" step="0.01" min={0} max={1} value={cubic.x2}
            onChange={(e) => onChange({ ...cubic, x2: Math.max(0, Math.min(1, +e.target.value || 0)) })} />
        </label>
        <label>
          y2: <input type="number" step="0.01" value={cubic.y2}
            onChange={(e) => onChange({ ...cubic, y2: +e.target.value || 0 })} />
        </label>
      </div>
    </div>
  );
}

/** 主组件 */
export default function TransitionTool() {
  const [property, setProperty] = useState<string>('transform');
  const [duration, setDuration] = useState(0.4);
  const [delay, setDelay] = useState(0);
  const [timingType, setTimingType] = useState<TimingType>('preset');
  const [presetFn, setPresetFn] = useState('ease');
  const [cubic, setCubic] = useState<CubicBezier>(DEFAULT_CUBIC);
  const [steps, setSteps] = useState<StepConfig>(DEFAULT_STEPS);
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  // 当前生效的 timing-function 字符串
  const timingValue = useMemo(() => {
    if (timingType === 'preset') return presetFn;
    if (timingType === 'cubic') {
      return `cubic-bezier(${cubic.x1}, ${cubic.y1}, ${cubic.x2}, ${cubic.y2})`;
    }
    return `steps(${steps.count}, ${steps.jumpTerm})`;
  }, [timingType, presetFn, cubic, steps]);

  // 当前选中属性的结束态样式
  const endCss = useMemo(() => {
    const found = TRANSITION_PROPERTIES.find((p) => p.value === property);
    return found?.endCss ?? {};
  }, [property]);

  // 预览方块的 transition 样式
  const previewTransition = useMemo(() => {
    return `${property} ${duration}s ${timingValue} ${delay}s`;
  }, [property, duration, timingValue, delay]);

  // 生成的 CSS 代码
  const cssCode = useMemo(() => {
    const parts: string[] = [property, `${duration}s`];
    // timing-function 仅在非默认 ease 时输出（ease 是最常见默认值）
    if (!(timingType === 'preset' && presetFn === 'ease')) {
      parts.push(timingValue);
    }
    // delay 仅在非 0 时输出
    if (delay > 0) {
      parts.push(`${delay}s`);
    }
    const endStyleStr = TRANSITION_PROPERTIES.find((p) => p.value === property)?.endStyle ?? '';
    return [
      `/* 起始态 */`,
      `.box {`,
      `  transition: ${parts.join(' ')};`,
      `}`,
      ``,
      `/* 结束态（鼠标悬停触发） */`,
      `.box:hover {`,
      `  ${property}: ${endStyleStr};`,
      `}`,
    ].join('\n');
  }, [property, duration, timingValue, delay, timingType, presetFn]);

  // 应用预设
  const applyPreset = useCallback((p: TransitionPreset) => {
    setProperty(p.property);
    setDuration(p.duration);
    setDelay(p.delay);
    setTimingType(p.timingType);
    setPresetFn(p.presetFn);
    setCubic(p.cubic);
    setSteps(p.steps);
  }, []);

  const handleCopy = useCallback(async () => {
    const ok = await copyText(cssCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [cssCode]);

  return (
    <div className="trn">
      {/* 预设按钮组 */}
      <div className="trn__presets">
        <span className="trn__presets-label">预设：</span>
        {PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            className="trn__preset-btn"
            onClick={() => applyPreset(p)}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="trn__main">
        {/* 左侧：配置面板 */}
        <div className="trn__config">
          <div className="trn__field">
            <label htmlFor="trn-property">transition-property</label>
            <select
              id="trn-property"
              value={property}
              onChange={(e) => setProperty(e.target.value)}
            >
              {TRANSITION_PROPERTIES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          <div className="trn__field">
            <label htmlFor="trn-duration">
              transition-duration: <strong>{duration.toFixed(2)}s</strong>
            </label>
            <input
              id="trn-duration"
              type="range"
              min={0.1}
              max={3}
              step={0.05}
              value={duration}
              onChange={(e) => setDuration(+e.target.value)}
            />
          </div>

          <div className="trn__field">
            <label htmlFor="trn-delay">
              transition-delay: <strong>{delay.toFixed(2)}s</strong>
            </label>
            <input
              id="trn-delay"
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={delay}
              onChange={(e) => setDelay(+e.target.value)}
            />
          </div>

          <div className="trn__field">
            <label>timing-function 类型</label>
            <div className="trn__btn-group">
              {(['preset', 'cubic', 'steps'] as TimingType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`trn__type-btn ${timingType === t ? 'is-active' : ''}`}
                  onClick={() => setTimingType(t)}
                >
                  {t === 'preset' ? '预设' : t === 'cubic' ? 'cubic-bezier' : 'steps'}
                </button>
              ))}
            </div>
          </div>

          {timingType === 'preset' && (
            <div className="trn__field">
              <label htmlFor="trn-preset-fn">缓动函数</label>
              <select
                id="trn-preset-fn"
                value={presetFn}
                onChange={(e) => setPresetFn(e.target.value)}
              >
                {TIMING_PRESETS.map((fn) => (
                  <option key={fn} value={fn}>{fn}</option>
                ))}
              </select>
            </div>
          )}

          {timingType === 'cubic' && (
            <CubicBezierEditor cubic={cubic} onChange={setCubic} />
          )}

          {timingType === 'steps' && (
            <div className="trn__steps">
              <div className="trn__field">
                <label htmlFor="trn-step-count">
                  步数: <strong>{steps.count}</strong>
                </label>
                <input
                  id="trn-step-count"
                  type="range"
                  min={1}
                  max={20}
                  step={1}
                  value={steps.count}
                  onChange={(e) => setSteps({ ...steps, count: +e.target.value })}
                />
              </div>
              <div className="trn__field">
                <label>跳跃项</label>
                <div className="trn__btn-group">
                  {(['jump-start', 'jump-end'] as const).map((j) => (
                    <button
                      key={j}
                      type="button"
                      className={`trn__type-btn ${steps.jumpTerm === j ? 'is-active' : ''}`}
                      onClick={() => setSteps({ ...steps, jumpTerm: j })}
                    >
                      {j}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 右侧：预览 + 代码 */}
        <div className="trn__output">
          <div className="trn__preview">
            <p className="trn__preview-hint">鼠标悬停下方区域触发过渡</p>
            <div
              className="trn__stage"
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
            >
              <div
                className="trn__box"
                style={{
                  transition: previewTransition,
                  ...(hovered ? endCss : {}),
                }}
              >
                Hover
              </div>
            </div>
            <div className="trn__timing-display">
              当前：<code>{timingValue}</code>
            </div>
          </div>

          <div className="trn__code">
            <button type="button" className="trn__copy" onClick={handleCopy}>
              {copied ? '已复制' : '复制代码'}
            </button>
            <pre>
              <code>{cssCode}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
