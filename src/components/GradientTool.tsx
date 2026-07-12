import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS 渐变（linear-gradient / radial-gradient / conic-gradient）可视化生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 线性渐变：角度调节（0-360°）+ 方向预设
 *  - 径向渐变：形状（circle / ellipse）+ 中心位置
 *  - 圆锥渐变：起始角度（from）+ 中心位置（at），适合饼图、色轮、进度环
 *  - 颜色停止点：增删 / 位置调节 / 颜色选择
 *  - 实时预览 + 一键复制 CSS 代码
 *  - 12 组预设渐变效果（7 线性/径向 + 5 圆锥）
 */

type GradientType = 'linear' | 'radial' | 'conic';

/** 颜色停止点 */
interface ColorStop {
  id: number;
  color: string;
  position: number; // 0-100 百分比
}

/** 预设渐变 */
interface GradientPreset {
  name: string;
  type: GradientType;
  angle: number;
  stops: { color: string; position: number }[];
}

// 预设渐变集合，覆盖主流设计风格（7 线性/径向 + 5 圆锥）
const PRESETS: GradientPreset[] = [
  { name: '日落', type: 'linear', angle: 90, stops: [{ color: '#ff512f', position: 0 }, { color: '#f09819', position: 100 }] },
  { name: '海洋', type: 'linear', angle: 135, stops: [{ color: '#2E3192', position: 0 }, { color: '#1BFFFF', position: 100 }] },
  { name: '极光', type: 'linear', angle: 45, stops: [{ color: '#00C9FF', position: 0 }, { color: '#92FE9D', position: 100 }] },
  { name: '紫粉', type: 'linear', angle: 90, stops: [{ color: '#DA22FF', position: 0 }, { color: '#9733EE', position: 100 }] },
  { name: '暖橙', type: 'linear', angle: 180, stops: [{ color: '#F7B733', position: 0 }, { color: '#FC4A1A', position: 100 }] },
  { name: '深空', type: 'linear', angle: 135, stops: [{ color: '#232526', position: 0 }, { color: '#414345', position: 100 }] },
  { name: '三色', type: 'linear', angle: 90, stops: [{ color: '#ff6b6b', position: 0 }, { color: '#feca57', position: 50 }, { color: '#48dbfb', position: 100 }] },
  // 圆锥渐变预设：利用硬边界与角度特性实现饼图、色轮等效果
  { name: '饼图', type: 'conic', angle: 0, stops: [{ color: '#ef4444', position: 0 }, { color: '#ef4444', position: 25 }, { color: '#f59e0b', position: 25 }, { color: '#f59e0b', position: 50 }, { color: '#10b981', position: 50 }, { color: '#10b981', position: 75 }, { color: '#3b82f6', position: 75 }, { color: '#3b82f6', position: 100 }] },
  { name: '色轮', type: 'conic', angle: 0, stops: [{ color: '#ff0000', position: 0 }, { color: '#ffff00', position: 16.66 }, { color: '#00ff00', position: 33.33 }, { color: '#00ffff', position: 50 }, { color: '#0000ff', position: 66.66 }, { color: '#ff00ff', position: 83.33 }, { color: '#ff0000', position: 100 }] },
  { name: '圆锥极光', type: 'conic', angle: 0, stops: [{ color: '#00C9FF', position: 0 }, { color: '#92FE9D', position: 33 }, { color: '#DA22FF', position: 66 }, { color: '#00C9FF', position: 100 }] },
  { name: '进度环', type: 'conic', angle: 0, stops: [{ color: '#2b6cff', position: 0 }, { color: '#2b6cff', position: 65 }, { color: 'transparent', position: 65 }, { color: 'transparent', position: 100 }] },
  { name: '日出圆锥', type: 'conic', angle: 90, stops: [{ color: '#ff512f', position: 0 }, { color: '#f09819', position: 50 }, { color: '#ffd700', position: 100 }] },
];

// 线性渐变方向预设（角度 + 中文标签）
const DIRECTIONS = [
  { angle: 0, label: '↑ 上' },
  { angle: 90, label: '→ 右' },
  { angle: 180, label: '↓ 下' },
  { angle: 270, label: '← 左' },
  { angle: 45, label: '↗ 右上' },
  { angle: 135, label: '↘ 右下' },
  { angle: 225, label: '↙ 左下' },
  { angle: 315, label: '↖ 左上' },
];

let stopIdSeq = 1;
const nextStopId = () => stopIdSeq++;

/** 根据类型与参数生成完整 CSS 渐变值 */
function buildGradient(type: GradientType, angle: number, stops: ColorStop[], posX: number, posY: number): string {
  // 停止点按位置升序排列后拼接
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const stopStr = sorted.map((s) => `${s.color} ${s.position}%`).join(', ');
  if (type === 'linear') {
    return `linear-gradient(${angle}deg, ${stopStr})`;
  }
  if (type === 'radial') {
    return `radial-gradient(circle at ${posX}% ${posY}%, ${stopStr})`;
  }
  // 圆锥渐变：from 角度指定起始方向，at 指定中心点
  return `conic-gradient(from ${angle}deg at ${posX}% ${posY}%, ${stopStr})`;
}

/** 单个颜色停止点控件 */
function StopCard({
  stop,
  index,
  onChange,
  onRemove,
}: {
  stop: ColorStop;
  index: number;
  onChange: (patch: Partial<ColorStop>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grt__stop">
      <div className="grt__stop-color">
        <input
          type="color"
          value={normalizeHex(stop.color)}
          onChange={(e) => onChange({ color: e.target.value })}
          aria-label={`第 ${index + 1} 个停止点颜色`}
        />
        <input
          type="text"
          className="grt__stop-hex"
          value={stop.color}
          onChange={(e) => onChange({ color: e.target.value })}
          aria-label="颜色值"
        />
      </div>
      <label className="grt__stop-pos">
        <input
          type="range"
          min="0"
          max="100"
          value={stop.position}
          onChange={(e) => onChange({ position: Number(e.target.value) })}
        />
        <output>{stop.position}%</output>
      </label>
      <button type="button" className="grt__btn grt__btn--danger" onClick={onRemove} aria-label="删除此停止点">
        删除
      </button>
    </div>
  );
}

// 非 hex 颜色回退为 #000000，保证 input[type=color] 可用
function normalizeHex(color: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    return '#' + color.slice(1).split('').map((c) => c + c).join('');
  }
  return '#000000';
}

export default function GradientTool() {
  // 初始为"三色"预设，首屏即有丰富效果
  const [type, setType] = useState<GradientType>('linear');
  const [angle, setAngle] = useState(90);
  const [posX, setPosX] = useState(50);
  const [posY, setPosY] = useState(50);
  const [stops, setStops] = useState<ColorStop[]>([
    { id: nextStopId(), color: '#ff6b6b', position: 0 },
    { id: nextStopId(), color: '#feca57', position: 50 },
    { id: nextStopId(), color: '#48dbfb', position: 100 },
  ]);
  const [copied, setCopied] = useState(false);

  const gradientValue = useMemo(
    () => buildGradient(type, angle, stops, posX, posY),
    [type, angle, stops, posX, posY],
  );
  const cssCode = useMemo(() => `background: ${gradientValue};`, [gradientValue]);

  // 修改某个停止点的部分属性
  const patchStop = useCallback((id: number, patch: Partial<ColorStop>) => {
    setStops((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  // 删除停止点（至少保留 2 个，否则渐变无意义）
  const removeStop = useCallback((id: number) => {
    setStops((prev) => (prev.length <= 2 ? prev : prev.filter((s) => s.id !== id)));
  }, []);

  // 新增停止点，位置取末尾 + 10（上限 100）
  const addStop = useCallback(() => {
    setStops((prev) => {
      const maxPos = Math.max(...prev.map((s) => s.position));
      return [...prev, { id: nextStopId(), color: '#ffffff', position: Math.min(maxPos + 10, 100) }];
    });
  }, []);

  // 应用预设
  const applyPreset = useCallback((preset: GradientPreset) => {
    setType(preset.type);
    setAngle(preset.angle);
    setStops(preset.stops.map((s) => ({ ...s, id: nextStopId() })));
  }, []);

  // 复制 CSS
  const handleCopy = useCallback(async () => {
    const ok = await copyText(cssCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [cssCode]);

  return (
    <div className="grt">
      {/* 预览区 */}
      <div className="grt__preview" style={{ background: gradientValue }} />

      {/* 预设按钮组 */}
      <div className="grt__presets">
        <span className="grt__presets-label">预设：</span>
        {PRESETS.map((p) => (
          <button key={p.name} type="button" className="grt__btn grt__btn--preset" onClick={() => applyPreset(p)}>
            {p.name}
          </button>
        ))}
      </div>

      {/* 类型与参数控制 */}
      <div className="grt__controls">
        <div className="grt__control-group">
          <span className="grt__control-label">类型</span>
          <div className="grt__seg">
            <button
              type="button"
              className={`grt__seg-btn${type === 'linear' ? ' is-active' : ''}`}
              onClick={() => setType('linear')}
            >
              线性渐变
            </button>
            <button
              type="button"
              className={`grt__seg-btn${type === 'radial' ? ' is-active' : ''}`}
              onClick={() => setType('radial')}
            >
              径向渐变
            </button>
            <button
              type="button"
              className={`grt__seg-btn${type === 'conic' ? ' is-active' : ''}`}
              onClick={() => setType('conic')}
            >
              圆锥渐变
            </button>
          </div>
        </div>

        {type === 'linear' ? (
          <div className="grt__control-group">
            <span className="grt__control-label">方向</span>
            <div className="grt__directions">
              {DIRECTIONS.map((d) => (
                <button
                  key={d.angle}
                  type="button"
                  className={`grt__dir-btn${angle === d.angle ? ' is-active' : ''}`}
                  onClick={() => setAngle(d.angle)}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <label className="grt__angle">
              <input type="range" min="0" max="360" value={angle} onChange={(e) => setAngle(Number(e.target.value))} />
              <output>{angle}°</output>
            </label>
          </div>
        ) : type === 'radial' ? (
          <div className="grt__control-group">
            <span className="grt__control-label">中心位置</span>
            <label className="grt__pos-field">
              X
              <input type="range" min="0" max="100" value={posX} onChange={(e) => setPosX(Number(e.target.value))} />
              <output>{posX}%</output>
            </label>
            <label className="grt__pos-field">
              Y
              <input type="range" min="0" max="100" value={posY} onChange={(e) => setPosY(Number(e.target.value))} />
              <output>{posY}%</output>
            </label>
          </div>
        ) : (
          // 圆锥渐变：from 起始角度 + at 中心位置
          <div className="grt__control-group">
            <span className="grt__control-label">起始角度（from）</span>
            <label className="grt__angle">
              <input type="range" min="0" max="360" value={angle} onChange={(e) => setAngle(Number(e.target.value))} />
              <output>{angle}°</output>
            </label>
            <span className="grt__control-label">中心位置（at）</span>
            <label className="grt__pos-field">
              X
              <input type="range" min="0" max="100" value={posX} onChange={(e) => setPosX(Number(e.target.value))} />
              <output>{posX}%</output>
            </label>
            <label className="grt__pos-field">
              Y
              <input type="range" min="0" max="100" value={posY} onChange={(e) => setPosY(Number(e.target.value))} />
              <output>{posY}%</output>
            </label>
          </div>
        )}
      </div>

      {/* 颜色停止点列表 */}
      <div className="grt__stops">
        <div className="grt__stops-head">
          <span className="grt__stops-title">颜色停止点（{stops.length} 个）</span>
          <button type="button" className="grt__btn grt__btn--add" onClick={addStop}>
            + 添加停止点
          </button>
        </div>
        {stops.map((stop, i) => (
          <StopCard
            key={stop.id}
            stop={stop}
            index={i}
            onChange={(patch) => patchStop(stop.id, patch)}
            onRemove={() => removeStop(stop.id)}
          />
        ))}
        {stops.length <= 2 && <p className="grt__hint">渐变至少需要 2 个停止点，无法继续删除。</p>}
      </div>

      {/* CSS 代码输出 */}
      <div className="grt__output">
        <div className="grt__output-head">
          <span className="grt__output-label">CSS 代码</span>
          <button type="button" className="grt__btn grt__btn--copy" onClick={handleCopy}>
            {copied ? '已复制 ✓' : '复制'}
          </button>
        </div>
        <pre className="grt__code">{cssCode}</pre>
      </div>
    </div>
  );
}
