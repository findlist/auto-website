import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS 文字阴影（text-shadow）可视化生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 多层文字阴影管理（增删 / 启用）
 *  - 每层参数：x / y 偏移、模糊半径、颜色
 *  - 可编辑预览文本、字号、字重、文字颜色、背景色
 *  - 8 组预设效果（霓虹 / 3D / 浮雕 / 描边 / 凹陷 / 硬阴影 / 发光 / 清除）
 *  - 实时预览 + 一键复制 CSS 代码
 */

/** 单层文字阴影参数（text-shadow 无 spread 和 inset） */
interface ShadowLayer {
  id: number;
  enabled: boolean;
  x: number;      // 水平偏移 px
  y: number;      // 垂直偏移 px
  blur: number;   // 模糊半径 px
  color: string;  // 颜色（hex / rgba）
}

/** 预设阴影效果 */
interface ShadowPreset {
  name: string;
  layers: Omit<ShadowLayer, 'id'>[];
}

// 预设集合，覆盖文字阴影最常用的设计风格
const PRESETS: ShadowPreset[] = [
  {
    name: '霓虹',
    layers: [
      { enabled: true, x: 0, y: 0, blur: 10, color: 'rgba(0,200,255,0.8)' },
      { enabled: true, x: 0, y: 0, blur: 20, color: 'rgba(0,200,255,0.5)' },
      { enabled: true, x: 0, y: 0, blur: 40, color: 'rgba(0,150,255,0.3)' },
    ],
  },
  {
    name: '3D',
    layers: [
      { enabled: true, x: 1, y: 1, blur: 0, color: '#c0c0c0' },
      { enabled: true, x: 2, y: 2, blur: 0, color: '#b0b0b0' },
      { enabled: true, x: 3, y: 3, blur: 0, color: '#a0a0a0' },
      { enabled: true, x: 4, y: 4, blur: 0, color: '#909090' },
      { enabled: true, x: 5, y: 5, blur: 0, color: '#808080' },
    ],
  },
  {
    name: '浮雕',
    layers: [
      { enabled: true, x: 1, y: 1, blur: 0, color: 'rgba(255,255,255,0.8)' },
      { enabled: true, x: -1, y: -1, blur: 0, color: 'rgba(0,0,0,0.3)' },
    ],
  },
  {
    name: '描边',
    layers: [
      { enabled: true, x: -1, y: 0, blur: 0, color: '#333' },
      { enabled: true, x: 1, y: 0, blur: 0, color: '#333' },
      { enabled: true, x: 0, y: -1, blur: 0, color: '#333' },
      { enabled: true, x: 0, y: 1, blur: 0, color: '#333' },
      { enabled: true, x: -1, y: -1, blur: 0, color: '#333' },
      { enabled: true, x: 1, y: 1, blur: 0, color: '#333' },
      { enabled: true, x: -1, y: 1, blur: 0, color: '#333' },
      { enabled: true, x: 1, y: -1, blur: 0, color: '#333' },
    ],
  },
  {
    name: '凹陷',
    layers: [
      { enabled: true, x: -1, y: -1, blur: 0, color: 'rgba(255,255,255,0.6)' },
      { enabled: true, x: 1, y: 1, blur: 0, color: 'rgba(0,0,0,0.3)' },
    ],
  },
  {
    name: '硬阴影',
    layers: [{ enabled: true, x: 3, y: 3, blur: 0, color: '#000000' }],
  },
  {
    name: '发光',
    layers: [
      { enabled: true, x: 0, y: 0, blur: 6, color: 'rgba(255,200,0,0.8)' },
      { enabled: true, x: 0, y: 0, blur: 14, color: 'rgba(255,180,0,0.5)' },
    ],
  },
];

// 唯一 id 递增计数器，保证多层阴影 key 稳定
let layerIdSeq = 1;
const nextId = () => layerIdSeq++;

/** rgba 颜色无法直接用于 input[type=color]，需提取为 #rrggbb；非 hex 则回退为 #000000 */
function normalizeHex(color: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    return '#' + color.slice(1).split('').map((c) => c + c).join('');
  }
  return '#000000';
}

/** 单层阴影格式化为 CSS 片段 */
function formatLayer(layer: ShadowLayer): string {
  // text-shadow 语法：x y blur color（无 spread、无 inset）
  return `${layer.x}px ${layer.y}px ${layer.blur}px ${layer.color}`;
}

/** 拼接所有启用层的完整 text-shadow 值 */
function buildTextShadow(layers: ShadowLayer[]): string {
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
    <div className="tst__layer">
      <div className="tst__layer-head">
        <label className="tst__layer-enable">
          <input
            type="checkbox"
            checked={layer.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
            aria-label={`启用第 ${index + 1} 层阴影`}
          />
          <span>第 {index + 1} 层</span>
        </label>
        <button type="button" className="tst__btn tst__btn--danger" onClick={onRemove} aria-label="删除该层阴影">
          删除
        </button>
      </div>
      <div className="tst__layer-params">
        <label className="tst__field">
          <span>X 偏移</span>
          <input type="range" min="-50" max="50" value={layer.x} onChange={(e) => onChange({ x: Number(e.target.value) })} />
          <output>{layer.x}px</output>
        </label>
        <label className="tst__field">
          <span>Y 偏移</span>
          <input type="range" min="-50" max="50" value={layer.y} onChange={(e) => onChange({ y: Number(e.target.value) })} />
          <output>{layer.y}px</output>
        </label>
        <label className="tst__field">
          <span>模糊</span>
          <input type="range" min="0" max="100" value={layer.blur} onChange={(e) => onChange({ blur: Number(e.target.value) })} />
          <output>{layer.blur}px</output>
        </label>
        <label className="tst__field tst__field--color">
          <span>颜色</span>
          <input type="color" value={normalizeHex(layer.color)} onChange={(e) => onChange({ color: e.target.value })} />
          <input
            type="text"
            className="tst__color-text"
            value={layer.color}
            onChange={(e) => onChange({ color: e.target.value })}
            aria-label="阴影颜色值"
          />
        </label>
      </div>
    </div>
  );
}

export default function TextShadowTool() {
  // 初始化为"霓虹"预设，首屏即有视觉冲击力
  const [layers, setLayers] = useState<ShadowLayer[]>(() => [
    { id: nextId(), enabled: true, x: 0, y: 0, blur: 10, color: 'rgba(0,200,255,0.8)' },
    { id: nextId(), enabled: true, x: 0, y: 0, blur: 20, color: 'rgba(0,200,255,0.5)' },
    { id: nextId(), enabled: true, x: 0, y: 0, blur: 40, color: 'rgba(0,150,255,0.3)' },
  ]);
  // 预览区配置
  const [previewText, setPreviewText] = useState('文字阴影');
  const [fontSize, setFontSize] = useState(48);
  const [fontWeight, setFontWeight] = useState(700);
  const [textColor, setTextColor] = useState('#ffffff');
  const [bgColor, setBgColor] = useState('#1a1a2e');
  const [copied, setCopied] = useState(false);

  const cssValue = useMemo(() => buildTextShadow(layers), [layers]);
  // 完整 CSS 声明片段，可直接粘贴到样式表
  const cssCode = useMemo(() => `text-shadow: ${cssValue};`, [cssValue]);

  // 修改某一层的部分属性
  const patchLayer = useCallback((id: number, patch: Partial<ShadowLayer>) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  // 删除某一层
  const removeLayer = useCallback((id: number) => {
    setLayers((prev) => prev.filter((l) => l.id !== id));
  }, []);

  // 新增一层，默认轻微下移的半透明阴影
  const addLayer = useCallback(() => {
    setLayers((prev) => [
      ...prev,
      { id: nextId(), enabled: true, x: 0, y: 2, blur: 4, color: 'rgba(0,0,0,0.3)' },
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
    <div className="tst">
      {/* 预览区 */}
      <div className="tst__preview" style={{ background: bgColor }}>
        <div
          className="tst__preview-text"
          style={{
            textShadow: cssValue,
            color: textColor,
            fontSize: `${fontSize}px`,
            fontWeight: fontWeight,
          }}
        >
          {previewText || '请输入文字'}
        </div>
      </div>

      {/* 预览配置面板 */}
      <div className="tst__preview-config">
        <label className="tst__cfg-field">
          <span>预览文字</span>
          <input
            type="text"
            value={previewText}
            onChange={(e) => setPreviewText(e.target.value)}
            placeholder="输入预览文字"
            maxLength={20}
          />
        </label>
        <label className="tst__cfg-field">
          <span>字号 {fontSize}px</span>
          <input type="range" min="16" max="96" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} />
        </label>
        <label className="tst__cfg-field">
          <span>字重</span>
          <select value={fontWeight} onChange={(e) => setFontWeight(Number(e.target.value))}>
            <option value={300}>细体 300</option>
            <option value={400}>常规 400</option>
            <option value={500}>中等 500</option>
            <option value={600}>半粗 600</option>
            <option value={700}>粗体 700</option>
            <option value={900}>特粗 900</option>
          </select>
        </label>
        <label className="tst__cfg-field tst__cfg-field--color">
          <span>文字色</span>
          <input type="color" value={normalizeHex(textColor)} onChange={(e) => setTextColor(e.target.value)} />
        </label>
        <label className="tst__cfg-field tst__cfg-field--color">
          <span>背景色</span>
          <input type="color" value={normalizeHex(bgColor)} onChange={(e) => setBgColor(e.target.value)} />
        </label>
      </div>

      {/* 预设按钮组 */}
      <div className="tst__presets">
        <span className="tst__presets-label">预设：</span>
        {PRESETS.map((p) => (
          <button key={p.name} type="button" className="tst__btn tst__btn--preset" onClick={() => applyPreset(p)}>
            {p.name}
          </button>
        ))}
        <button type="button" className="tst__btn tst__btn--preset" onClick={clearAll}>
          清除
        </button>
      </div>

      {/* 阴影层列表 */}
      <div className="tst__layers">
        {layers.length === 0 && <p className="tst__empty">暂无阴影层，点击"添加阴影层"或选择预设开始。</p>}
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

      <button type="button" className="tst__btn tst__btn--add" onClick={addLayer}>
        + 添加阴影层
      </button>

      {/* CSS 代码输出 */}
      <div className="tst__output">
        <div className="tst__output-head">
          <span className="tst__output-label">CSS 代码</span>
          <button type="button" className="tst__btn tst__btn--copy" onClick={handleCopy}>
            {copied ? '已复制 ✓' : '复制'}
          </button>
        </div>
        <pre className="tst__code">{cssCode}</pre>
        <p className="tst__hint">
          当前共 {layers.length} 层，启用 {layers.filter((l) => l.enabled).length} 层。
          {cssValue === 'none' && ' 暂无阴影效果。'}
        </p>
      </div>
    </div>
  );
}
