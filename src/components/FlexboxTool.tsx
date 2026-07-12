import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS Flexbox 可视化生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 容器属性全可视化：display / flex-direction / flex-wrap / justify-content / align-items / align-content / gap
 *  - 单项属性独立编辑：order / flex-grow / flex-shrink / flex-basis / align-self
 *  - 动态增删 flex 项（2-8 个），点击选中后右侧面板编辑
 *  - 8 组预设布局（居中 / 两端 / 等间距 / 垂直居中 / 顶部 / 底部 / 卡片网格 / 圣杯）
 *  - 实时预览 + 一键复制 CSS 代码（容器 + 选中项）
 */

/** Flex 容器属性集合 */
interface FlexContainer {
  display: 'flex' | 'inline-flex';
  flexDirection: 'row' | 'row-reverse' | 'column' | 'column-reverse';
  flexWrap: 'nowrap' | 'wrap' | 'wrap-reverse';
  justifyContent: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
  alignItems: 'stretch' | 'flex-start' | 'flex-end' | 'center' | 'baseline';
  alignContent: 'stretch' | 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around';
  gap: number;
}

/** 单个 flex 项属性 */
interface FlexItem {
  id: number;
  label: string;
  order: number;
  flexGrow: number;
  flexShrink: number;
  flexBasis: string; // 'auto' 或 '200px' / '50%' 等
  alignSelf: 'auto' | 'stretch' | 'flex-start' | 'flex-end' | 'center' | 'baseline';
}

/** 预设布局 */
interface FlexPreset {
  name: string;
  container: Partial<FlexContainer>;
  items?: Partial<FlexItem>[];
}

// 预设集合，覆盖 flexbox 最常用的布局场景
const PRESETS: FlexPreset[] = [
  {
    name: '居中对齐',
    container: { justifyContent: 'center', alignItems: 'center' },
  },
  {
    name: '两端对齐',
    container: { justifyContent: 'space-between', alignItems: 'center' },
  },
  {
    name: '等间距',
    container: { justifyContent: 'space-evenly', alignItems: 'center' },
  },
  {
    name: '垂直居中',
    container: { flexDirection: 'column', justifyContent: 'center', alignItems: 'center' },
  },
  {
    name: '顶部对齐',
    container: { justifyContent: 'flex-start', alignItems: 'flex-start' },
  },
  {
    name: '底部对齐',
    container: { justifyContent: 'flex-start', alignItems: 'flex-end' },
  },
  {
    name: '卡片网格',
    container: { flexWrap: 'wrap', justifyContent: 'flex-start', alignItems: 'stretch', gap: 12 },
  },
  {
    name: '圣杯布局',
    container: { justifyContent: 'space-between', alignItems: 'stretch' },
    items: [
      { flexGrow: 0, flexBasis: '120px' },
      { flexGrow: 1, flexBasis: '0' },
      { flexGrow: 0, flexBasis: '120px' },
    ],
  },
];

// 唯一 id 递增计数器，保证 flex 项 key 稳定
let itemIdSeq = 1;
const nextId = () => itemIdSeq++;

// 默认容器配置
const DEFAULT_CONTAINER: FlexContainer = {
  display: 'flex',
  flexDirection: 'row',
  flexWrap: 'nowrap',
  justifyContent: 'flex-start',
  alignItems: 'stretch',
  alignContent: 'stretch',
  gap: 8,
};

// 创建默认 flex 项
function createDefaultItem(index: number): FlexItem {
  return {
    id: nextId(),
    label: `项 ${index + 1}`,
    order: 0,
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: 'auto',
    alignSelf: 'auto',
  };
}

// 项的循环配色（8 色循环，避免引入额外依赖）
const ITEM_COLORS = [
  '#2b6cff', '#7a4cff', '#dc2626', '#16a34a',
  '#ea580c', '#0891b2', '#9333ea', '#65a30d',
];

/** 生成容器 CSS 代码 */
function buildContainerCss(c: FlexContainer): string {
  const lines: string[] = ['.container {'];
  lines.push(`  display: ${c.display};`);
  lines.push(`  flex-direction: ${c.flexDirection};`);
  lines.push(`  flex-wrap: ${c.flexWrap};`);
  lines.push(`  justify-content: ${c.justifyContent};`);
  lines.push(`  align-items: ${c.alignItems};`);
  // 仅在允许换行时输出 align-content，避免无意义代码
  if (c.flexWrap !== 'nowrap') {
    lines.push(`  align-content: ${c.alignContent};`);
  }
  if (c.gap > 0) {
    lines.push(`  gap: ${c.gap}px;`);
  }
  lines.push('}');
  return lines.join('\n');
}

/** 生成单项 CSS 代码（仅输出非默认值，保持代码简洁） */
function buildItemCss(item: FlexItem): string {
  const lines: string[] = ['.item {'];
  if (item.order !== 0) lines.push(`  order: ${item.order};`);
  if (item.flexGrow !== 0) lines.push(`  flex-grow: ${item.flexGrow};`);
  if (item.flexShrink !== 1) lines.push(`  flex-shrink: ${item.flexShrink};`);
  if (item.flexBasis !== 'auto') lines.push(`  flex-basis: ${item.flexBasis};`);
  if (item.alignSelf !== 'auto') lines.push(`  align-self: ${item.alignSelf};`);
  if (lines.length === 1) {
    lines.push('  /* 默认值，无需显式声明 */');
  }
  lines.push('}');
  return lines.join('\n');
}

/** 通用按钮组：用于枚举型属性选择 */
function ButtonGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flx__field${disabled ? ' flx__field--disabled' : ''}`}>
      <span className="flx__field-label">{label}</span>
      <div className="flx__btn-group" role="radiogroup" aria-label={label}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={value === opt.value}
            className={`flx__btn-option${value === opt.value ? ' flx__btn-option--active' : ''}`}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// 选项常量集中定义，避免在 JSX 中重复内联
const DIRECTION_OPTIONS = [
  { value: 'row' as const, label: '横向 →' },
  { value: 'row-reverse' as const, label: '横向 ←' },
  { value: 'column' as const, label: '纵向 ↓' },
  { value: 'column-reverse' as const, label: '纵向 ↑' },
];
const WRAP_OPTIONS = [
  { value: 'nowrap' as const, label: '不换行' },
  { value: 'wrap' as const, label: '换行' },
  { value: 'wrap-reverse' as const, label: '反向换行' },
];
const JUSTIFY_OPTIONS = [
  { value: 'flex-start' as const, label: '起始' },
  { value: 'center' as const, label: '居中' },
  { value: 'flex-end' as const, label: '末尾' },
  { value: 'space-between' as const, label: '两端' },
  { value: 'space-around' as const, label: '环绕' },
  { value: 'space-evenly' as const, label: '均布' },
];
const ALIGN_ITEMS_OPTIONS = [
  { value: 'stretch' as const, label: '拉伸' },
  { value: 'flex-start' as const, label: '起始' },
  { value: 'center' as const, label: '居中' },
  { value: 'flex-end' as const, label: '末尾' },
  { value: 'baseline' as const, label: '基线' },
];
const ALIGN_CONTENT_OPTIONS = [
  { value: 'stretch' as const, label: '拉伸' },
  { value: 'flex-start' as const, label: '起始' },
  { value: 'center' as const, label: '居中' },
  { value: 'flex-end' as const, label: '末尾' },
  { value: 'space-between' as const, label: '两端' },
  { value: 'space-around' as const, label: '环绕' },
];
const ALIGN_SELF_OPTIONS = [
  { value: 'auto' as const, label: '继承' },
  { value: 'stretch' as const, label: '拉伸' },
  { value: 'flex-start' as const, label: '起始' },
  { value: 'center' as const, label: '居中' },
  { value: 'flex-end' as const, label: '末尾' },
  { value: 'baseline' as const, label: '基线' },
];

export default function FlexboxTool() {
  // 初始化为 3 个默认项
  const [container, setContainer] = useState<FlexContainer>(DEFAULT_CONTAINER);
  const [items, setItems] = useState<FlexItem[]>(() => [
    createDefaultItem(0),
    createDefaultItem(1),
    createDefaultItem(2),
  ]);
  const [selectedId, setSelectedId] = useState<number | null>(items[0]?.id ?? null);
  const [copied, setCopied] = useState(false);

  const selectedItem = useMemo(
    () => items.find((it) => it.id === selectedId) ?? null,
    [items, selectedId]
  );

  // 容器与选中项的 CSS 代码合并输出
  const cssCode = useMemo(() => {
    const parts = [buildContainerCss(container)];
    if (selectedItem) parts.push(buildItemCss(selectedItem));
    return parts.join('\n\n');
  }, [container, selectedItem]);

  // 容器属性部分更新
  const patchContainer = useCallback((patch: Partial<FlexContainer>) => {
    setContainer((prev) => ({ ...prev, ...patch }));
  }, []);

  // 选中项属性部分更新
  const patchItem = useCallback((id: number, patch: Partial<FlexItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  // 新增项（上限 8 个，超过用户体验下降）
  const addItem = useCallback(() => {
    setItems((prev) => {
      if (prev.length >= 8) return prev;
      const item = createDefaultItem(prev.length);
      setSelectedId(item.id);
      return [...prev, item];
    });
  }, []);

  // 删除项（保留下限 2 个，单元素无法体现布局效果）
  const removeItem = useCallback((id: number) => {
    setItems((prev) => {
      if (prev.length <= 2) return prev;
      const next = prev.filter((it) => it.id !== id);
      if (selectedId === id) {
        setSelectedId(next[0]?.id ?? null);
      }
      return next;
    });
  }, [selectedId]);

  // 应用预设：容器属性覆盖，可选项属性同步
  const applyPreset = useCallback((preset: FlexPreset) => {
    setContainer((prev) => ({ ...prev, ...preset.container }));
    if (preset.items) {
      setItems((prev) =>
        prev.map((it, i) => ({
          ...it,
          ...(preset.items?.[i] ?? {}),
        }))
      );
    }
  }, []);

  // 复制 CSS 代码到剪贴板
  const handleCopy = useCallback(async () => {
    const ok = await copyText(cssCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [cssCode]);

  return (
    <div className="flx">
      {/* 预览区 */}
      <div className="flx__preview">
        <div
          className="flx__stage"
          style={{
            display: container.display,
            flexDirection: container.flexDirection,
            flexWrap: container.flexWrap,
            justifyContent: container.justifyContent,
            alignItems: container.alignItems,
            alignContent: container.alignContent,
            gap: `${container.gap}px`,
          }}
        >
          {items.map((it, i) => (
            <div
              key={it.id}
              className={`flx__item${it.id === selectedId ? ' flx__item--selected' : ''}`}
              style={{
                order: it.order,
                flexGrow: it.flexGrow,
                flexShrink: it.flexShrink,
                flexBasis: it.flexBasis,
                alignSelf: it.alignSelf,
                background: ITEM_COLORS[i % ITEM_COLORS.length],
              }}
              onClick={() => setSelectedId(it.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedId(it.id);
                }
              }}
              aria-pressed={it.id === selectedId}
              aria-label={`${it.label}，点击编辑`}
            >
              <span className="flx__item-label">{it.label}</span>
              {(it.order !== 0 || it.flexGrow !== 0 || it.flexBasis !== 'auto' || it.alignSelf !== 'auto') && (
                <span className="flx__item-badge">已自定义</span>
              )}
              <button
                type="button"
                className="flx__item-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  removeItem(it.id);
                }}
                aria-label={`删除 ${it.label}`}
                disabled={items.length <= 2}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 预设按钮组 */}
      <div className="flx__presets">
        <span className="flx__presets-label">预设：</span>
        {PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            className="flx__btn flx__btn--preset"
            onClick={() => applyPreset(p)}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* 控制面板：左容器 / 右选中项 */}
      <div className="flx__panels">
        {/* 容器属性面板 */}
        <div className="flx__panel">
          <h3 className="flx__panel-title">容器属性（.container）</h3>
          <ButtonGroup
            label="display"
            value={container.display}
            options={[
              { value: 'flex' as const, label: 'flex' },
              { value: 'inline-flex' as const, label: 'inline-flex' },
            ]}
            onChange={(v) => patchContainer({ display: v })}
          />
          <ButtonGroup
            label="flex-direction 主轴方向"
            value={container.flexDirection}
            options={DIRECTION_OPTIONS}
            onChange={(v) => patchContainer({ flexDirection: v })}
          />
          <ButtonGroup
            label="flex-wrap 换行"
            value={container.flexWrap}
            options={WRAP_OPTIONS}
            onChange={(v) => patchContainer({ flexWrap: v })}
          />
          <ButtonGroup
            label="justify-content 主轴对齐"
            value={container.justifyContent}
            options={JUSTIFY_OPTIONS}
            onChange={(v) => patchContainer({ justifyContent: v })}
          />
          <ButtonGroup
            label="align-items 交叉轴对齐"
            value={container.alignItems}
            options={ALIGN_ITEMS_OPTIONS}
            onChange={(v) => patchContainer({ alignItems: v })}
          />
          <ButtonGroup
            label="align-content 多行对齐"
            value={container.alignContent}
            options={ALIGN_CONTENT_OPTIONS}
            onChange={(v) => patchContainer({ alignContent: v })}
            disabled={container.flexWrap === 'nowrap'}
          />
          <div className="flx__field">
            <span className="flx__field-label">
              gap 间距 <output>{container.gap}px</output>
            </span>
            <input
              type="range"
              min="0"
              max="48"
              value={container.gap}
              onChange={(e) => patchContainer({ gap: Number(e.target.value) })}
              aria-label="容器间距 gap"
            />
          </div>
        </div>

        {/* 选中项属性面板 */}
        <div className="flx__panel">
          <h3 className="flx__panel-title">
            选中项属性
            {selectedItem && <span className="flx__panel-sub">（.item · {selectedItem.label}）</span>}
          </h3>
          {!selectedItem && <p className="flx__empty">点击预览区中的项以编辑其属性。</p>}
          {selectedItem && (
            <>
              <div className="flx__field">
                <span className="flx__field-label">
                  order 排列顺序 <output>{selectedItem.order}</output>
                </span>
                <input
                  type="range"
                  min="-5"
                  max="5"
                  value={selectedItem.order}
                  onChange={(e) => patchItem(selectedItem.id, { order: Number(e.target.value) })}
                  aria-label="项排列顺序 order"
                />
              </div>
              <div className="flx__field">
                <span className="flx__field-label">
                  flex-grow 放大比例 <output>{selectedItem.flexGrow}</output>
                </span>
                <input
                  type="range"
                  min="0"
                  max="5"
                  step="1"
                  value={selectedItem.flexGrow}
                  onChange={(e) => patchItem(selectedItem.id, { flexGrow: Number(e.target.value) })}
                  aria-label="项放大比例 flex-grow"
                />
              </div>
              <div className="flx__field">
                <span className="flx__field-label">
                  flex-shrink 收缩比例 <output>{selectedItem.flexShrink}</output>
                </span>
                <input
                  type="range"
                  min="0"
                  max="5"
                  step="1"
                  value={selectedItem.flexShrink}
                  onChange={(e) => patchItem(selectedItem.id, { flexShrink: Number(e.target.value) })}
                  aria-label="项收缩比例 flex-shrink"
                />
              </div>
              <div className="flx__field">
                <span className="flx__field-label">flex-basis 初始尺寸</span>
                <div className="flx__basis-input">
                  <input
                    type="text"
                    value={selectedItem.flexBasis}
                    onChange={(e) => patchItem(selectedItem.id, { flexBasis: e.target.value })}
                    placeholder="auto / 200px / 50%"
                    aria-label="项初始尺寸 flex-basis"
                  />
                  <div className="flx__basis-quick">
                    {['auto', '0', '100px', '200px', '50%'].map((v) => (
                      <button
                        key={v}
                        type="button"
                        className="flx__btn flx__btn--mini"
                        onClick={() => patchItem(selectedItem.id, { flexBasis: v })}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <ButtonGroup
                label="align-self 单独对齐"
                value={selectedItem.alignSelf}
                options={ALIGN_SELF_OPTIONS}
                onChange={(v) => patchItem(selectedItem.id, { alignSelf: v })}
              />
            </>
          )}
          <button
            type="button"
            className="flx__btn flx__btn--add"
            onClick={addItem}
            disabled={items.length >= 8}
          >
            + 添加项（{items.length}/8）
          </button>
        </div>
      </div>

      {/* CSS 代码输出 */}
      <div className="flx__output">
        <div className="flx__output-head">
          <span className="flx__output-label">CSS 代码</span>
          <button type="button" className="flx__btn flx__btn--copy" onClick={handleCopy}>
            {copied ? '已复制 ✓' : '复制'}
          </button>
        </div>
        <pre className="flx__code">{cssCode}</pre>
        <p className="flx__hint">
          当前共 {items.length} 个 flex 项，间距 {container.gap}px。
          {selectedItem ? ` 已选中 ${selectedItem.label}，可在右侧编辑其单独属性。` : ' 点击预览中的项以编辑。'}
        </p>
      </div>
    </div>
  );
}
