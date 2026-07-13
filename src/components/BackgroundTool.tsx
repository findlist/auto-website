import { useState, useMemo, useCallback, type CSSProperties } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS background 复合属性生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 多层背景叠加（最多 4 层，逗号分隔）
 *  - 每层支持线性渐变 / 径向渐变 / 图片 URL
 *  - 每层独立配置 repeat / position / size / attachment
 *  - 全局 background-color 与 background-clip（含 text 文字裁剪特效）
 *  - 8 组预设覆盖主流背景设计模式
 *  - 实时预览 + 一键复制 CSS 代码
 */

type ImageType = 'linear' | 'radial' | 'url';
type RepeatType = 'repeat' | 'no-repeat' | 'repeat-x' | 'repeat-y';
type SizeType = 'auto' | 'cover' | 'contain';
type AttachmentType = 'scroll' | 'fixed' | 'local';
type ClipType = 'border-box' | 'padding-box' | 'content-box' | 'text';

/** 单层背景配置 */
interface BgLayer {
  id: number;
  imageType: ImageType;
  angle: number; // linear 渐变方向角度
  color1: string; // 渐变起始色
  color2: string; // 渐变结束色
  imageUrl: string; // 图片 URL
  repeat: RepeatType;
  posX: string; // left / center / right
  posY: string; // top / center / bottom
  size: SizeType;
  attachment: AttachmentType;
}

/** 预设效果 */
interface BgPreset {
  name: string;
  color: string;
  clip: ClipType;
  layers: Omit<BgLayer, 'id'>[];
}

// 层 ID 自增序列
let layerIdSeq = 0;
const genId = () => ++layerIdSeq;

/** 创建默认层，可通过 overrides 覆盖部分字段 */
function makeLayer(o: Partial<Omit<BgLayer, 'id'>> = {}): BgLayer {
  return {
    id: genId(),
    imageType: 'linear',
    angle: 135,
    color1: '#667eea',
    color2: '#764ba2',
    imageUrl: '',
    repeat: 'no-repeat',
    posX: 'center',
    posY: 'center',
    size: 'cover',
    attachment: 'scroll',
    ...o,
  };
}

// 8 组预设覆盖主流背景设计模式
const PRESETS: BgPreset[] = [
  {
    name: '线性渐变',
    color: 'transparent',
    clip: 'border-box',
    layers: [
      { imageType: 'linear', angle: 135, color1: '#667eea', color2: '#764ba2', imageUrl: '', repeat: 'no-repeat', posX: 'center', posY: 'center', size: 'cover', attachment: 'scroll' },
    ],
  },
  {
    name: '径向光晕',
    color: '#1a1a2e',
    clip: 'border-box',
    layers: [
      { imageType: 'radial', angle: 0, color1: 'rgba(233,69,96,0.6)', color2: 'transparent', imageUrl: '', repeat: 'no-repeat', posX: 'center', posY: 'center', size: 'cover', attachment: 'scroll' },
    ],
  },
  {
    name: '图片平铺',
    color: '#f5f5f5',
    clip: 'border-box',
    layers: [
      { imageType: 'url', angle: 0, color1: '#ccc', color2: '#999', imageUrl: '', repeat: 'repeat', posX: 'left', posY: 'top', size: 'auto', attachment: 'scroll' },
    ],
  },
  {
    name: '视差固定',
    color: '#333',
    clip: 'border-box',
    layers: [
      { imageType: 'url', angle: 0, color1: '#ccc', color2: '#999', imageUrl: '', repeat: 'no-repeat', posX: 'center', posY: 'center', size: 'cover', attachment: 'fixed' },
    ],
  },
  {
    name: '多层叠加',
    color: '#0f0f23',
    clip: 'border-box',
    layers: [
      { imageType: 'radial', angle: 0, color1: 'rgba(255,100,100,0.4)', color2: 'transparent', imageUrl: '', repeat: 'no-repeat', posX: 'left', posY: 'top', size: 'cover', attachment: 'scroll' },
      { imageType: 'radial', angle: 0, color1: 'rgba(100,200,255,0.4)', color2: 'transparent', imageUrl: '', repeat: 'no-repeat', posX: 'right', posY: 'bottom', size: 'cover', attachment: 'scroll' },
    ],
  },
  {
    name: '文字裁剪',
    color: 'transparent',
    clip: 'text',
    layers: [
      { imageType: 'linear', angle: 90, color1: '#ff6b6b', color2: '#4ecdc4', imageUrl: '', repeat: 'no-repeat', posX: 'center', posY: 'center', size: 'cover', attachment: 'scroll' },
    ],
  },
  {
    name: '渐变叠图片',
    color: '#1a1a2e',
    clip: 'border-box',
    layers: [
      { imageType: 'linear', angle: 180, color1: 'rgba(0,0,0,0.7)', color2: 'rgba(0,0,0,0.1)', imageUrl: '', repeat: 'no-repeat', posX: 'center', posY: 'center', size: 'cover', attachment: 'scroll' },
      { imageType: 'url', angle: 0, color1: '#ccc', color2: '#999', imageUrl: '', repeat: 'no-repeat', posX: 'center', posY: 'center', size: 'cover', attachment: 'scroll' },
    ],
  },
  {
    name: '暖色渐变',
    color: 'transparent',
    clip: 'border-box',
    layers: [
      { imageType: 'linear', angle: 45, color1: '#f093fb', color2: '#f5576c', imageUrl: '', repeat: 'no-repeat', posX: 'center', posY: 'center', size: 'cover', attachment: 'scroll' },
    ],
  },
];

const POS_X = ['left', 'center', 'right'];
const POS_Y = ['top', 'center', 'bottom'];
const REPEAT_LABELS: Record<RepeatType, string> = {
  'no-repeat': '不重复', 'repeat': '平铺', 'repeat-x': '横向', 'repeat-y': '纵向',
};
const SIZE_LABELS: Record<SizeType, string> = { cover: '覆盖', contain: '包含', auto: '原始' };
const ATTACH_LABELS: Record<AttachmentType, string> = { scroll: '滚动', fixed: '固定', local: '局部' };
const CLIP_LABELS: Record<ClipType, string> = {
  'border-box': '边框盒', 'padding-box': '内边距盒', 'content-box': '内容盒', text: '文字裁剪',
};

/** 构建单层 image 值 */
function buildLayerImage(l: BgLayer): string {
  if (l.imageType === 'url') return l.imageUrl.trim() ? `url(${l.imageUrl.trim()})` : 'none';
  if (l.imageType === 'linear') return `linear-gradient(${l.angle}deg, ${l.color1}, ${l.color2})`;
  // radial：at 位置复用 posX/posY，使 9 宫格同时控制渐变中心
  return `radial-gradient(circle at ${l.posX} ${l.posY}, ${l.color1}, ${l.color2})`;
}

/** 构建完整 background CSS 代码 */
function buildCss(layers: BgLayer[], color: string, clip: ClipType): string {
  const strs = layers
    .map((l) => {
      const img = buildLayerImage(l);
      if (img === 'none') return null;
      return `${img} ${l.repeat} ${l.posX} ${l.posY} / ${l.size} ${l.attachment}`;
    })
    .filter(Boolean);

  const lines: string[] = [];
  if (strs.length === 0) {
    if (color !== 'transparent') lines.push(`background-color: ${color};`);
  } else {
    // 简写：图层逗号分隔，非透明 color 附加在末尾
    const suffix = color !== 'transparent' ? `, ${color}` : '';
    lines.push(`background: ${strs.join(', ')}${suffix};`);
  }

  // clip 特殊处理：text 需要 -webkit 前缀 + color: transparent
  if (clip === 'text') {
    lines.push('-webkit-background-clip: text;', 'background-clip: text;', 'color: transparent;');
  } else if (clip !== 'border-box') {
    lines.push(`background-clip: ${clip};`);
  }
  return lines.join('\n');
}

/** 构建预览样式对象（多层背景逐属性展开） */
function buildPreviewStyle(layers: BgLayer[], color: string, clip: ClipType): CSSProperties {
  const imgs = layers.map(buildLayerImage).filter((s) => s !== 'none');
  const base: CSSProperties = { backgroundColor: color };
  if (imgs.length) {
    base.backgroundImage = imgs.join(', ');
    base.backgroundRepeat = layers.map((l) => l.repeat).join(', ');
    base.backgroundPosition = layers.map((l) => `${l.posX} ${l.posY}`).join(', ');
    base.backgroundSize = layers.map((l) => l.size).join(', ');
    base.backgroundAttachment = layers.map((l) => l.attachment).join(', ');
  }
  if (clip === 'text') {
    base.WebkitBackgroundClip = 'text';
    base.backgroundClip = 'text';
    base.color = 'transparent';
  } else if (clip !== 'border-box') {
    base.backgroundClip = clip;
  }
  return base;
}

/** 9 宫格位置选择器 */
function PositionPicker({ posX, posY, onChange }: {
  posX: string;
  posY: string;
  onChange: (x: string, y: string) => void;
}) {
  return (
    <div className="bg__pos-grid" role="group" aria-label="背景位置选择">
      {POS_Y.map((y) =>
        POS_X.map((x) => (
          <button
            key={`${x}-${y}`}
            type="button"
            className={`bg__pos-cell${posX === x && posY === y ? ' is-active' : ''}`}
            onClick={() => onChange(x, y)}
            aria-label={`位置 ${x} ${y}`}
            aria-pressed={posX === x && posY === y}
          />
        )),
      )}
    </div>
  );
}

/** 分段按钮组 */
function SegGroup<T extends string>({ value, options, labels, onChange }: {
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="bg__seg">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          className={`bg__seg-btn${value === opt ? ' is-active' : ''}`}
          onClick={() => onChange(opt)}
          aria-pressed={value === opt}
        >
          {labels[opt]}
        </button>
      ))}
    </div>
  );
}

/** 单层背景编辑器 */
function LayerCard({ layer, index, total, onUpdate, onRemove, onMove }: {
  layer: BgLayer;
  index: number;
  total: number;
  onUpdate: (patch: Partial<BgLayer>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <div className="bg__layer">
      <div className="bg__layer-head">
        <span className="bg__layer-title">第 {index + 1} 层</span>
        <div className="bg__layer-actions">
          <button type="button" className="bg__icon-btn" disabled={index === 0} onClick={() => onMove(-1)} aria-label="上移">↑</button>
          <button type="button" className="bg__icon-btn" disabled={index === total - 1} onClick={() => onMove(1)} aria-label="下移">↓</button>
          <button type="button" className="bg__icon-btn bg__icon-btn--danger" disabled={total <= 1} onClick={onRemove} aria-label="删除">✕</button>
        </div>
      </div>

      {/* 图片类型切换 */}
      <div className="bg__row">
        <span className="bg__row-label">类型</span>
        <SegGroup
          value={layer.imageType}
          options={['linear', 'radial', 'url'] as const}
          labels={{ linear: '线性渐变', radial: '径向渐变', url: '图片 URL' }}
          onChange={(v) => onUpdate({ imageType: v })}
        />
      </div>

      {/* 渐变参数 */}
      {layer.imageType === 'linear' && (
        <label className="bg__field">
          <span className="bg__field-label">角度</span>
          <input type="range" min="0" max="360" value={layer.angle} onChange={(e) => onUpdate({ angle: Number(e.target.value) })} />
          <output className="bg__field-val">{layer.angle}°</output>
        </label>
      )}

      {layer.imageType !== 'url' && (
        <div className="bg__colors">
          <label className="bg__color-field">
            <span className="bg__field-label">起始色</span>
            <input type="color" value={layer.color1.startsWith('#') && layer.color1.length === 7 ? layer.color1 : '#667eea'} onChange={(e) => onUpdate({ color1: e.target.value })} aria-label="起始色" />
            <input type="text" className="bg__color-text" value={layer.color1} onChange={(e) => onUpdate({ color1: e.target.value })} placeholder="#hex 或 rgba()" />
          </label>
          <label className="bg__color-field">
            <span className="bg__field-label">结束色</span>
            <input type="color" value={layer.color2.startsWith('#') && layer.color2.length === 7 ? layer.color2 : '#764ba2'} onChange={(e) => onUpdate({ color2: e.target.value })} aria-label="结束色" />
            <input type="text" className="bg__color-text" value={layer.color2} onChange={(e) => onUpdate({ color2: e.target.value })} placeholder="#hex 或 rgba()" />
          </label>
        </div>
      )}

      {layer.imageType === 'url' && (
        <label className="bg__field bg__field--full">
          <span className="bg__field-label">图片地址</span>
          <input type="text" className="bg__url-input" value={layer.imageUrl} onChange={(e) => onUpdate({ imageUrl: e.target.value })} placeholder="https://example.com/image.jpg" />
        </label>
      )}

      {/* repeat / size / attachment */}
      <div className="bg__row">
        <span className="bg__row-label">重复</span>
        <SegGroup value={layer.repeat} options={['no-repeat', 'repeat', 'repeat-x', 'repeat-y'] as const} labels={REPEAT_LABELS} onChange={(v) => onUpdate({ repeat: v })} />
      </div>
      <div className="bg__row">
        <span className="bg__row-label">尺寸</span>
        <SegGroup value={layer.size} options={['cover', 'contain', 'auto'] as const} labels={SIZE_LABELS} onChange={(v) => onUpdate({ size: v })} />
      </div>
      <div className="bg__row">
        <span className="bg__row-label">附着</span>
        <SegGroup value={layer.attachment} options={['scroll', 'fixed', 'local'] as const} labels={ATTACH_LABELS} onChange={(v) => onUpdate({ attachment: v })} />
      </div>

      {/* 9 宫格位置 */}
      <div className="bg__row">
        <span className="bg__row-label">位置</span>
        <PositionPicker posX={layer.posX} posY={layer.posY} onChange={(x, y) => onUpdate({ posX: x, posY: y })} />
      </div>
    </div>
  );
}

export default function BackgroundTool() {
  const [layers, setLayers] = useState<BgLayer[]>([makeLayer()]);
  const [color, setColor] = useState('transparent');
  const [clip, setClip] = useState<ClipType>('border-box');
  const [previewSize, setPreviewSize] = useState(280);
  const [previewText, setPreviewText] = useState('Background');
  const [copied, setCopied] = useState(false);

  const cssCode = useMemo(() => buildCss(layers, color, clip), [layers, color, clip]);
  const previewStyle = useMemo(() => buildPreviewStyle(layers, color, clip), [layers, color, clip]);

  const applyPreset = useCallback((p: BgPreset) => {
    setLayers(p.layers.map((l) => makeLayer(l)));
    setColor(p.color);
    setClip(p.clip);
  }, []);

  const updateLayer = useCallback((id: number, patch: Partial<BgLayer>) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  const removeLayer = useCallback((id: number) => {
    setLayers((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));
  }, []);

  const addLayer = useCallback(() => {
    setLayers((prev) => (prev.length < 4 ? [...prev, makeLayer()] : prev));
  }, []);

  const moveLayer = useCallback((index: number, dir: -1 | 1) => {
    setLayers((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const handleCopy = useCallback(async () => {
    const ok = await copyText(cssCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [cssCode]);

  return (
    <div className="bg">
      {/* 预览区 */}
      <div className="bg__preview-wrap">
        <div
          className="bg__preview"
          style={{ ...previewStyle, width: `${previewSize}px`, height: `${previewSize}px` }}
        >
          {clip === 'text' && <span className="bg__preview-text">{previewText}</span>}
        </div>
        <div className="bg__preview-controls">
          <label className="bg__preview-size">
            <span>尺寸</span>
            <input type="range" min="160" max="400" value={previewSize} onChange={(e) => setPreviewSize(Number(e.target.value))} />
            <output>{previewSize}px</output>
          </label>
          {clip === 'text' && (
            <label className="bg__preview-text-input">
              <span>文字</span>
              <input type="text" value={previewText} onChange={(e) => setPreviewText(e.target.value)} />
            </label>
          )}
        </div>
      </div>

      {/* 预设按钮组 */}
      <div className="bg__presets">
        <span className="bg__presets-label">预设：</span>
        {PRESETS.map((p) => (
          <button key={p.name} type="button" className="bg__btn bg__btn--preset" onClick={() => applyPreset(p)}>
            {p.name}
          </button>
        ))}
      </div>

      {/* 全局设置：background-color + background-clip */}
      <div className="bg__global">
        <label className="bg__color-field">
          <span className="bg__field-label">背景色</span>
          <input type="color" value={color.startsWith('#') && color.length === 7 ? color : '#ffffff'} onChange={(e) => setColor(e.target.value)} aria-label="背景色" />
          <input type="text" className="bg__color-text" value={color} onChange={(e) => setColor(e.target.value)} placeholder="transparent / #fff / rgba()" />
        </label>
        <div className="bg__row">
          <span className="bg__row-label">裁剪</span>
          <SegGroup value={clip} options={['border-box', 'padding-box', 'content-box', 'text'] as const} labels={CLIP_LABELS} onChange={(v) => setClip(v)} />
        </div>
      </div>

      {/* 背景层列表 */}
      <div className="bg__layers">
        {layers.map((l, i) => (
          <LayerCard
            key={l.id}
            layer={l}
            index={i}
            total={layers.length}
            onUpdate={(patch) => updateLayer(l.id, patch)}
            onRemove={() => removeLayer(l.id)}
            onMove={(dir) => moveLayer(i, dir)}
          />
        ))}
        {layers.length < 4 && (
          <button type="button" className="bg__btn bg__btn--add" onClick={addLayer}>
            + 添加背景层
          </button>
        )}
      </div>

      {/* CSS 代码输出 */}
      <div className="bg__output">
        <div className="bg__output-head">
          <span className="bg__output-label">CSS 代码</span>
          <button type="button" className="bg__btn bg__btn--copy" onClick={handleCopy}>
            {copied ? '已复制 ✓' : '复制'}
          </button>
        </div>
        <pre className="bg__code">{cssCode}</pre>
      </div>
    </div>
  );
}
