import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS 盒阴影（box-shadow）可视化生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 多层阴影管理（增删 / 启用 / 内外阴影）
 *  - 每层参数：x / y 偏移、模糊半径、扩散半径、颜色、inset
 *  - 实时预览 + 一键复制 CSS 代码
 *  - 7 组预设阴影效果（柔和 / 卡片 / 硬阴影 / 内阴影 / 霓虹 / 浮起 / 清除）
 *  - 浅 / 深双色预览背景，便于观察深色阴影
 */

/** 单层阴影参数 */
interface ShadowLayer {
  id: number;
  enabled: boolean;
  x: number;        // 水平偏移 px
  y: number;        // 垂直偏移 px
  blur: number;     // 模糊半径 px
  spread: number;   // 扩散半径 px
  color: string;    // 颜色（hex / rgba）
  inset: boolean;   // 是否内阴影
}

/** 预设阴影效果 */
interface ShadowPreset {
  name: string;
  layers: Omit<ShadowLayer, 'id'>[];
}

// 预设集合，覆盖开发者最常用的阴影风格
const PRESETS: ShadowPreset[] = [
  {
    name: '柔和',
    layers: [{ enabled: true, x: 0, y: 4, blur: 6, spread: -1, color: 'rgba(0,0,0,0.10)', inset: false }],
  },
  {
    name: '卡片',
    layers: [
      { enabled: true, x: 0, y: 2, blur: 4, spread: 0, color: 'rgba(0,0,0,0.08)', inset: false },
      { enabled: true, x: 0, y: 4, blur: 12, spread: 0, color: 'rgba(0,0,0,0.06)', inset: false },
    ],
  },
  {
    name: '硬阴影',
    layers: [{ enabled: true, x: 4, y: 4, blur: 0, spread: 0, color: '#000000', inset: false }],
  },
  {
    name: '内阴影',
    layers: [{ enabled: true, x: 0, y: 2, blur: 8, spread: 0, color: 'rgba(0,0,0,0.20)', inset: true }],
  },
  {
    name: '霓虹光',
    layers: [
      { enabled: true, x: 0, y: 0, blur: 10, spread: 0, color: 'rgba(0,200,255,0.80)', inset: false },
      { enabled: true, x: 0, y: 0, blur: 20, spread: 0, color: 'rgba(0,200,255,0.50)', inset: false },
    ],
  },
  {
    name: '浮起',
    layers: [
      { enabled: true, x: 0, y: 10, blur: 30, spread: 0, color: 'rgba(0,0,0,0.15)', inset: false },
      { enabled: true, x: 0, y: 6, blur: 10, spread: 0, color: 'rgba(0,0,0,0.10)', inset: false },
    ],
  },
];

// 唯一 id 递增计数器，保证多层阴影 key 稳定
let layerIdSeq = 1;
const nextId = () => layerIdSeq++;

/** 单层阴影格式化为 CSS 片段 */
function formatLayer(layer: ShadowLayer): string {
  return `${layer.inset ? 'inset ' : ''}${layer.x}px ${layer.y}px ${layer.blur}px ${layer.spread}px ${layer.color}`;
}

/** 拼接所有启用层的完整 box-shadow 值 */
function buildBoxShadow(layers: ShadowLayer[]): string {
  const active = layers.filter((l) => l.enabled);
  if (active.length === 0) return 'none';
  return active.map(formatLayer).join(', ');
}

/** 单层阴影控制卡片 */
function LayerCard({
  layer,
  index,
  onChange,
  onRemove,
}: {
  layer: ShadowLayer;
  index: number;
  onChange: (patch: Partial<ShadowLayer>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="bst__layer">
      <div className="bst__layer-head">
        <label className="bst__layer-enable">
          <input
            type="checkbox"
            checked={layer.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
            aria-label={`启用第 ${index + 1} 层阴影`}
          />
          <span>第 {index + 1} 层</span>
        </label>
        <button type="button" className="bst__btn bst__btn--danger" onClick={onRemove} aria-label="删除该层阴影">
          删除
        </button>
      </div>
      <div className="bst__layer-params">
        <label className="bst__field">
          <span>X 偏移</span>
          <input type="range" min="-50" max="50" value={layer.x} onChange={(e) => onChange({ x: Number(e.target.value) })} />
          <output>{layer.x}px</output>
        </label>
        <label className="bst__field">
          <span>Y 偏移</span>
          <input type="range" min="-50" max="50" value={layer.y} onChange={(e) => onChange({ y: Number(e.target.value) })} />
          <output>{layer.y}px</output>
        </label>
        <label className="bst__field">
          <span>模糊</span>
          <input type="range" min="0" max="100" value={layer.blur} onChange={(e) => onChange({ blur: Number(e.target.value) })} />
          <output>{layer.blur}px</output>
        </label>
        <label className="bst__field">
          <span>扩散</span>
          <input type="range" min="-50" max="50" value={layer.spread} onChange={(e) => onChange({ spread: Number(e.target.value) })} />
          <output>{layer.spread}px</output>
        </label>
        <label className="bst__field bst__field--color">
          <span>颜色</span>
          <input type="color" value={normalizeHex(layer.color)} onChange={(e) => onChange({ color: e.target.value })} />
          <input
            type="text"
            className="bst__color-text"
            value={layer.color}
            onChange={(e) => onChange({ color: e.target.value })}
            aria-label="阴影颜色值"
          />
        </label>
        <label className="bst__field bst__field--inset">
          <span>内阴影</span>
          <input type="checkbox" checked={layer.inset} onChange={(e) => onChange({ inset: e.target.checked })} />
        </label>
      </div>
    </div>
  );
}

// rgba 颜色无法直接用于 input[type=color]，需提取为 #rrggbb；非 hex 则回退为 #000000
function normalizeHex(color: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    return '#' + color.slice(1).split('').map((c) => c + c).join('');
  }
  return '#000000';
}

export default function BoxShadowTool() {
  // 初始化为"卡片"预设，首屏即有可用效果
  const [layers, setLayers] = useState<ShadowLayer[]>(() => [
    { id: nextId(), enabled: true, x: 0, y: 2, blur: 4, spread: 0, color: 'rgba(0,0,0,0.08)', inset: false },
    { id: nextId(), enabled: true, x: 0, y: 4, blur: 12, spread: 0, color: 'rgba(0,0,0,0.06)', inset: false },
  ]);
  const [previewBg, setPreviewBg] = useState<'light' | 'dark'>('light');
  const [copied, setCopied] = useState(false);

  const cssValue = useMemo(() => buildBoxShadow(layers), [layers]);
  // 完整 CSS 声明片段，可直接粘贴到样式表
  const cssCode = useMemo(() => `box-shadow: ${cssValue};`, [cssValue]);

  // 修改某一层的部分属性
  const patchLayer = useCallback((id: number, patch: Partial<ShadowLayer>) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  // 删除某一层
  const removeLayer = useCallback((id: number) => {
    setLayers((prev) => prev.filter((l) => l.id !== id));
  }, []);

  // 新增一层，默认轻微下移的黑色半透明阴影
  const addLayer = useCallback(() => {
    setLayers((prev) => [
      ...prev,
      { id: nextId(), enabled: true, x: 0, y: 4, blur: 6, spread: 0, color: 'rgba(0,0,0,0.10)', inset: false },
    ]);
  }, []);

  // 应用预设：用深拷贝避免与 state 共享引用
  const applyPreset = useCallback((preset: ShadowPreset) => {
    setLayers(preset.layers.map((l) => ({ ...l, id: nextId() })));
  }, []);

  // 清除所有层
  const clearAll = useCallback(() => setLayers([]), []);

  // 复制 CSS 代码到剪贴板
  const handleCopy = useCallback(async () => {
    const ok = await copyText(cssCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [cssCode]);

  return (
    <div className="bst">
      {/* 预览区 */}
      <div className={`bst__preview bst__preview--${previewBg}`}>
        <div className="bst__preview-box" style={{ boxShadow: cssValue }}>
          预览
        </div>
        <div className="bst__preview-switch">
          <button
            type="button"
            className={`bst__btn bst__btn--toggle${previewBg === 'light' ? ' is-active' : ''}`}
            onClick={() => setPreviewBg('light')}
          >
            浅色背景
          </button>
          <button
            type="button"
            className={`bst__btn bst__btn--toggle${previewBg === 'dark' ? ' is-active' : ''}`}
            onClick={() => setPreviewBg('dark')}
          >
            深色背景
          </button>
        </div>
      </div>

      {/* 预设按钮组 */}
      <div className="bst__presets">
        <span className="bst__presets-label">预设：</span>
        {PRESETS.map((p) => (
          <button key={p.name} type="button" className="bst__btn bst__btn--preset" onClick={() => applyPreset(p)}>
            {p.name}
          </button>
        ))}
        <button type="button" className="bst__btn bst__btn--preset" onClick={clearAll}>
          清除
        </button>
      </div>

      {/* 阴影层列表 */}
      <div className="bst__layers">
        {layers.length === 0 && <p className="bst__empty">暂无阴影层，点击"添加阴影层"或选择预设开始。</p>}
        {layers.map((layer, i) => (
          <LayerCard
            key={layer.id}
            layer={layer}
            index={i}
            onChange={(patch) => patchLayer(layer.id, patch)}
            onRemove={() => removeLayer(layer.id)}
          />
        ))}
      </div>

      <button type="button" className="bst__btn bst__btn--add" onClick={addLayer}>
        + 添加阴影层
      </button>

      {/* CSS 代码输出 */}
      <div className="bst__output">
        <div className="bst__output-head">
          <span className="bst__output-label">CSS 代码</span>
          <button type="button" className="bst__btn bst__btn--copy" onClick={handleCopy}>
            {copied ? '已复制 ✓' : '复制'}
          </button>
        </div>
        <pre className="bst__code">{cssCode}</pre>
        <p className="bst__hint">
          当前共 {layers.length} 层，启用 {layers.filter((l) => l.enabled).length} 层。
          {cssValue === 'none' && ' 暂无阴影效果。'}
        </p>
      </div>
    </div>
  );
}
