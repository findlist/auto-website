import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS @container 容器查询生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 容器声明：container-type（size/inline-size/normal）+ container-name（可选命名）
 *  - 多 @container 查询：每条查询含条件（min-width/max-width）+ 命中后样式（背景/文字色/padding/圆角/字号）
 *  - 可拖拽调整预览容器宽度，实时命中匹配的查询，可视化"组件级响应式"效果
 *  - 8 组预设：单断点窄宽、双断点窄中宽、卡片三栏自适应、网格列数变化、字号自适应、紧凑/宽松切换、垂直堆叠、水平排列
 *  - 实时生成 container CSS + @container 块，一键复制
 */

/** 容器声明：container-type + container-name */
interface ContainerDecl {
  containerType: 'size' | 'inline-size' | 'normal';
  containerName: string; // 空字符串表示匿名容器
}

/** 单条 @container 查询配置 */
interface ContainerQuery {
  id: number;
  dimension: 'width' | 'height'; // 仅 inline-size 容器支持 width
  operator: 'min' | 'max';
  value: number; // 数值
  unit: 'px' | 'rem' | 'em'; // 单位
  enabled: boolean; // 是否启用此查询
  // 命中后应用的样式
  background: string;
  color: string;
  padding: number;
  borderRadius: number;
  fontSize: number;
  label: string; // 查询名称（用于代码注释与列表显示）
}

/** 预设结构 */
interface ContainerPreset {
  name: string;
  container: Partial<ContainerDecl>;
  queries: Partial<ContainerQuery>[];
}

// 唯一 id 递增计数器
let queryIdSeq = 1;
const nextId = () => queryIdSeq++;

// 预设集合：覆盖容器查询最典型应用场景
const PRESETS: ContainerPreset[] = [
  {
    name: '单断点（窄→宽）',
    container: { containerType: 'inline-size', containerName: 'card' },
    queries: [
      {
        operator: 'min', value: 480, unit: 'px', enabled: true,
        background: '#2563eb', color: '#ffffff', padding: 24,
        borderRadius: 12, fontSize: 18, label: '宽屏布局',
      },
    ],
  },
  {
    name: '双断点（窄/中/宽）',
    container: { containerType: 'inline-size', containerName: 'panel' },
    queries: [
      {
        operator: 'min', value: 320, unit: 'px', enabled: true,
        background: '#0891b2', color: '#ffffff', padding: 16,
        borderRadius: 8, fontSize: 15, label: '中屏',
      },
      {
        operator: 'min', value: 640, unit: 'px', enabled: true,
        background: '#16a34a', color: '#ffffff', padding: 24,
        borderRadius: 12, fontSize: 18, label: '宽屏',
      },
    ],
  },
  {
    name: '卡片三栏自适应',
    container: { containerType: 'inline-size', containerName: 'gallery' },
    queries: [
      {
        operator: 'min', value: 400, unit: 'px', enabled: true,
        background: '#7c3aed', color: '#ffffff', padding: 20,
        borderRadius: 10, fontSize: 16, label: '两列',
      },
      {
        operator: 'min', value: 700, unit: 'px', enabled: true,
        background: '#dc2626', color: '#ffffff', padding: 24,
        borderRadius: 14, fontSize: 18, label: '三列',
      },
    ],
  },
  {
    name: '字号自适应',
    container: { containerType: 'inline-size', containerName: 'title' },
    queries: [
      {
        operator: 'min', value: 360, unit: 'px', enabled: true,
        background: '#f59e0b', color: '#1f2937', padding: 16,
        borderRadius: 8, fontSize: 20, label: '中字',
      },
      {
        operator: 'min', value: 600, unit: 'px', enabled: true,
        background: '#ea580c', color: '#ffffff', padding: 20,
        borderRadius: 10, fontSize: 28, label: '大字',
      },
    ],
  },
  {
    name: '紧凑/宽松切换',
    container: { containerType: 'inline-size', containerName: 'list' },
    queries: [
      {
        operator: 'max', value: 280, unit: 'px', enabled: true,
        background: '#9333ea', color: '#ffffff', padding: 8,
        borderRadius: 4, fontSize: 13, label: '紧凑',
      },
      {
        operator: 'min', value: 500, unit: 'px', enabled: true,
        background: '#0d9488', color: '#ffffff', padding: 24,
        borderRadius: 12, fontSize: 17, label: '宽松',
      },
    ],
  },
  {
    name: '侧栏显隐',
    container: { containerType: 'inline-size', containerName: 'layout' },
    queries: [
      {
        operator: 'min', value: 768, unit: 'px', enabled: true,
        background: '#1e40af', color: '#ffffff', padding: 24,
        borderRadius: 0, fontSize: 16, label: '主+侧栏',
      },
    ],
  },
  {
    name: '渐变颜色（4 断点）',
    container: { containerType: 'inline-size', containerName: 'gradient' },
    queries: [
      {
        operator: 'min', value: 240, unit: 'px', enabled: true,
        background: '#f43f5e', color: '#ffffff', padding: 12,
        borderRadius: 6, fontSize: 14, label: '玫瑰',
      },
      {
        operator: 'min', value: 420, unit: 'px', enabled: true,
        background: '#f97316', color: '#ffffff', padding: 16,
        borderRadius: 8, fontSize: 16, label: '橙',
      },
      {
        operator: 'min', value: 600, unit: 'px', enabled: true,
        background: '#84cc16', color: '#1f2937', padding: 20,
        borderRadius: 10, fontSize: 18, label: '青柠',
      },
      {
        operator: 'min', value: 800, unit: 'px', enabled: true,
        background: '#06b6d4', color: '#ffffff', padding: 24,
        borderRadius: 12, fontSize: 20, label: '青',
      },
    ],
  },
  {
    name: '默认（无查询）',
    container: { containerType: 'inline-size', containerName: 'demo' },
    queries: [],
  },
];

// 默认容器声明
const DEFAULT_CONTAINER: ContainerDecl = {
  containerType: 'inline-size',
  containerName: 'card',
};

// 基础样式（容器查询未命中时的默认样式）
const BASE_STYLE = {
  background: '#6b7280',
  color: '#ffffff',
  padding: 12,
  borderRadius: 6,
  fontSize: 14,
};

// 创建默认查询
function createDefaultQuery(index: number): ContainerQuery {
  return {
    id: nextId(),
    dimension: 'width',
    operator: 'min',
    value: 480,
    unit: 'px',
    enabled: true,
    background: ['#2563eb', '#16a34a', '#dc2626', '#7c3aed'][index % 4],
    color: '#ffffff',
    padding: 20,
    borderRadius: 10,
    fontSize: 16,
    label: `查询 ${index + 1}`,
  };
}

/** 通用按钮组：用于枚举型属性选择 */
function ButtonGroup<T extends string>({
  label, value, options, onChange, disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`cnt__field${disabled ? ' cnt__field--disabled' : ''}`}>
      <span className="cnt__field-label">{label}</span>
      <div className="cnt__btn-group" role="radiogroup" aria-label={label}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={value === opt.value}
            className={`cnt__btn-option${value === opt.value ? ' cnt__btn-option--active' : ''}`}
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

// 选项常量集中定义
const TYPE_OPTIONS = [
  { value: 'size' as const, label: 'size（双向）' },
  { value: 'inline-size' as const, label: 'inline-size（横向）' },
  { value: 'normal' as const, label: 'normal（关闭）' },
];
const DIMENSION_OPTIONS = [
  { value: 'width' as const, label: 'width' },
  { value: 'height' as const, label: 'height' },
];
const OPERATOR_OPTIONS = [
  { value: 'min' as const, label: 'min-' },
  { value: 'max' as const, label: 'max-' },
];
const UNIT_OPTIONS = [
  { value: 'px' as const, label: 'px' },
  { value: 'rem' as const, label: 'rem' },
  { value: 'em' as const, label: 'em' },
];

export default function ContainerTool() {
  const [container, setContainer] = useState<ContainerDecl>(DEFAULT_CONTAINER);
  const [queries, setQueries] = useState<ContainerQuery[]>(() => [createDefaultQuery(0)]);
  const [selectedId, setSelectedId] = useState<number | null>(queries[0]?.id ?? null);
  const [copied, setCopied] = useState(false);

  // 预览容器的当前宽度（可拖拽调整）
  const [previewWidth, setPreviewWidth] = useState(560);
  const previewRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // 拖拽调整预览容器宽度
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current || !previewRef.current) return;
      const rect = previewRef.current.getBoundingClientRect();
      // 计算鼠标相对于预览容器左边的距离作为宽度
      const w = e.clientX - rect.left;
      const clamped = Math.max(160, Math.min(960, Math.round(w)));
      setPreviewWidth(clamped);
    };
    const onUp = () => { draggingRef.current = false; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  const startDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
  }, []);

  const selectedQuery = useMemo(
    () => queries.find((q) => q.id === selectedId) ?? null,
    [queries, selectedId]
  );

  // 计算当前预览容器命中哪些查询（按优先级：后定义优先）
  const matchedQueries = useMemo(() => {
    return queries.filter((q) => {
      if (!q.enabled) return false;
      // 简化：仅按 px 单位比较，rem/em 按 16px 转换
      const factor = q.unit === 'px' ? 1 : q.unit === 'rem' ? 16 : 16;
      const threshold = q.value * factor;
      if (q.operator === 'min') return previewWidth >= threshold;
      return previewWidth <= threshold;
    });
  }, [queries, previewWidth]);

  // 合并命中查询的样式（后定义的覆盖先定义）
  const activeStyle = useMemo(() => {
    if (matchedQueries.length === 0) return BASE_STYLE;
    // 取最后一条命中的查询（后定义覆盖先定义）
    const last = matchedQueries[matchedQueries.length - 1];
    return {
      background: last.background,
      color: last.color,
      padding: last.padding,
      borderRadius: last.borderRadius,
      fontSize: last.fontSize,
    };
  }, [matchedQueries]);

  // 生成容器声明 CSS
  const buildContainerCss = useCallback((c: ContainerDecl): string => {
    const lines: string[] = ['.container {'];
    if (c.containerType === 'normal') {
      lines.push('  /* normal：默认值，不建立 containment context */');
    } else {
      lines.push(`  container-type: ${c.containerType};`);
      if (c.containerName) {
        lines.push(`  container-name: ${c.containerName};`);
      }
    }
    lines.push('}');
    return lines.join('\n');
  }, []);

  // 生成单条 @container 查询块
  const buildQueryCss = useCallback((q: ContainerQuery, c: ContainerDecl): string => {
    if (!q.enabled) return `/* ${q.label}（已禁用） */`;
    // 容器名前缀（匿名容器时不带 name）
    const namePrefix = c.containerName ? `${c.containerName} ` : '';
    const dim = q.dimension;
    const cond = `${q.operator}-${dim}: ${q.value}${q.unit}`;
    const lines: string[] = [];
    lines.push(`/* ${q.label} */`);
    lines.push(`@container ${namePrefix}(${cond}) {`);
    lines.push('  .item {');
    lines.push(`    background: ${q.background};`);
    lines.push(`    color: ${q.color};`);
    lines.push(`    padding: ${q.padding}px;`);
    lines.push(`    border-radius: ${q.borderRadius}px;`);
    lines.push(`    font-size: ${q.fontSize}px;`);
    lines.push('  }');
    lines.push('}');
    return lines.join('\n');
  }, []);

  // 完整 CSS 代码
  const cssCode = useMemo(() => {
    const parts = [buildContainerCss(container)];
    for (const q of queries) {
      parts.push(buildQueryCss(q, container));
    }
    return parts.join('\n\n');
  }, [container, queries, buildContainerCss, buildQueryCss]);

  // 容器属性部分更新
  const patchContainer = useCallback((patch: Partial<ContainerDecl>) => {
    setContainer((prev) => ({ ...prev, ...patch }));
  }, []);

  // 选中查询部分更新
  const patchQuery = useCallback((id: number, patch: Partial<ContainerQuery>) => {
    setQueries((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  }, []);

  // 新增查询（上限 6 个，超过 UI 拥挤）
  const addQuery = useCallback(() => {
    setQueries((prev) => {
      if (prev.length >= 6) return prev;
      const q = createDefaultQuery(prev.length);
      setSelectedId(q.id);
      return [...prev, q];
    });
  }, []);

  // 删除查询（保留下限 1 个，否则失去工具意义）
  const removeQuery = useCallback((id: number) => {
    setQueries((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((q) => q.id !== id);
      if (selectedId === id) setSelectedId(next[0]?.id ?? null);
      return next;
    });
  }, [selectedId]);

  // 应用预设
  const applyPreset = useCallback((preset: ContainerPreset) => {
    setContainer((prev) => ({ ...prev, ...preset.container }));
    if (preset.queries.length > 0) {
      const newQueries = preset.queries.map((p, i) => ({
        ...createDefaultQuery(i),
        ...p,
      }));
      setQueries(newQueries);
      setSelectedId(newQueries[0]?.id ?? null);
    } else {
      setQueries([createDefaultQuery(0)]);
      setSelectedId(null);
    }
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
    <div className="cnt">
      {/* 预览区：可拖拽调整宽度，实时命中查询 */}
      <div className="cnt__preview">
        <div className="cnt__preview-head">
          <span className="cnt__preview-label">预览容器</span>
          <span className="cnt__preview-width">宽度：{previewWidth}px</span>
          <span className="cnt__preview-status">
            {matchedQueries.length > 0
              ? `命中 ${matchedQueries.length} 个查询：${matchedQueries.map((q) => q.label).join('、')}`
              : '未命中任何查询（使用基础样式）'}
          </span>
        </div>
        <div className="cnt__preview-stage">
          {/* 拖拽手柄：左右拖动改变容器宽度 */}
          <div
            ref={previewRef}
            className="cnt__resizable"
            style={{ width: `${previewWidth}px` }}
          >
            <div
              className="cnt__item"
              style={{
                background: activeStyle.background,
                color: activeStyle.color,
                padding: `${activeStyle.padding}px`,
                borderRadius: `${activeStyle.borderRadius}px`,
                fontSize: `${activeStyle.fontSize}px`,
              }}
            >
              <div className="cnt__item-title">容器查询演示</div>
              <div className="cnt__item-desc">
                拖动右侧手柄调整容器宽度，观察样式随容器尺寸变化。
                当前宽度 {previewWidth}px，命中 {matchedQueries.length} 个查询。
              </div>
            </div>
          </div>
          {/* 右侧拖拽手柄 */}
          <div
            className="cnt__resize-handle"
            onPointerDown={startDrag}
            role="slider"
            tabIndex={0}
            aria-label="拖拽调整预览容器宽度"
            aria-valuemin={160}
            aria-valuemax={960}
            aria-valuenow={previewWidth}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') setPreviewWidth((w) => Math.max(160, w - 20));
              if (e.key === 'ArrowRight') setPreviewWidth((w) => Math.min(960, w + 20));
            }}
          />
        </div>
        {/* 宽度快捷按钮 */}
        <div className="cnt__width-shortcuts">
          <span className="cnt__shortcuts-label">快捷宽度：</span>
          {[200, 320, 480, 640, 768, 960].map((w) => (
            <button
              key={w}
              type="button"
              className={`cnt__btn cnt__btn--width${previewWidth === w ? ' cnt__btn--width-active' : ''}`}
              onClick={() => setPreviewWidth(w)}
            >
              {w}px
            </button>
          ))}
        </div>
      </div>

      {/* 预设按钮组 */}
      <div className="cnt__presets">
        <span className="cnt__presets-label">预设：</span>
        {PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            className="cnt__btn cnt__btn--preset"
            onClick={() => applyPreset(p)}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* 控制面板：左容器声明 / 右查询列表 + 选中查询编辑 */}
      <div className="cnt__panels">
        {/* 容器声明面板 */}
        <div className="cnt__panel">
          <h3 className="cnt__panel-title">容器声明（.container）</h3>
          <ButtonGroup
            label="container-type 容器类型"
            value={container.containerType}
            options={TYPE_OPTIONS}
            onChange={(v) => patchContainer({ containerType: v })}
          />
          <div className="cnt__field">
            <span className="cnt__field-label">
              container-name 容器名（可选）
            </span>
            <input
              type="text"
              value={container.containerName}
              onChange={(e) => patchContainer({ containerName: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })}
              placeholder="留空表示匿名容器"
              aria-label="容器名称 container-name"
              className="cnt__input-text"
            />
            <p className="cnt__field-hint">
              命名后可在 @container 规则中通过名称指定目标容器，避免冲突。
            </p>
          </div>
          <div className="cnt__field cnt__field--info">
            <strong>说明：</strong>
            <ul>
              <li><code>size</code>：容器在宽高两个维度建立 containment，支持 width/height 查询</li>
              <li><code>inline-size</code>：仅横向维度，性能最优，最常用</li>
              <li><code>normal</code>：不建立 containment，无法被 @container 查询</li>
            </ul>
          </div>
        </div>

        {/* 查询列表 + 选中查询编辑面板 */}
        <div className="cnt__panel">
          <h3 className="cnt__panel-title">
            @container 查询
            <span className="cnt__panel-sub">（{queries.length}/6）</span>
          </h3>
          <div className="cnt__query-list">
            {queries.map((q) => (
              <div
                key={q.id}
                className={`cnt__query-item${q.id === selectedId ? ' cnt__query-item--selected' : ''}${!q.enabled ? ' cnt__query-item--disabled' : ''}`}
                onClick={() => setSelectedId(q.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedId(q.id);
                  }
                }}
                aria-pressed={q.id === selectedId}
              >
                <span
                  className="cnt__query-color"
                  style={{ background: q.background }}
                  aria-hidden="true"
                />
                <span className="cnt__query-label">{q.label}</span>
                <code className="cnt__query-cond">
                  {q.operator}-{q.dimension}: {q.value}{q.unit}
                </code>
                <button
                  type="button"
                  className="cnt__query-toggle"
                  onClick={(e) => {
                    e.stopPropagation();
                    patchQuery(q.id, { enabled: !q.enabled });
                  }}
                  aria-label={q.enabled ? '禁用此查询' : '启用此查询'}
                >
                  {q.enabled ? '✓' : '×'}
                </button>
                <button
                  type="button"
                  className="cnt__query-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeQuery(q.id);
                  }}
                  aria-label={`删除 ${q.label}`}
                  disabled={queries.length <= 1}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="cnt__btn cnt__btn--add"
            onClick={addQuery}
            disabled={queries.length >= 6}
          >
            + 添加查询
          </button>

          {/* 选中查询的详细编辑 */}
          {selectedQuery && (
            <div className="cnt__query-editor">
              <h4 className="cnt__editor-title">编辑查询：{selectedQuery.label}</h4>
              <div className="cnt__field">
                <span className="cnt__field-label">查询名称（用于注释）</span>
                <input
                  type="text"
                  value={selectedQuery.label}
                  onChange={(e) => patchQuery(selectedQuery.id, { label: e.target.value })}
                  className="cnt__input-text"
                  aria-label="查询名称"
                />
              </div>
              <div className="cnt__editor-row">
                <ButtonGroup
                  label="维度"
                  value={selectedQuery.dimension}
                  options={DIMENSION_OPTIONS}
                  onChange={(v) => patchQuery(selectedQuery.id, { dimension: v })}
                  disabled={container.containerType === 'inline-size' && selectedQuery.dimension === 'height' ? false : false}
                />
                <ButtonGroup
                  label="操作符"
                  value={selectedQuery.operator}
                  options={OPERATOR_OPTIONS}
                  onChange={(v) => patchQuery(selectedQuery.id, { operator: v })}
                />
              </div>
              <div className="cnt__editor-row">
                <div className="cnt__field">
                  <span className="cnt__field-label">
                    阈值 <output>{selectedQuery.value}{selectedQuery.unit}</output>
                  </span>
                  <input
                    type="range"
                    min="80"
                    max="960"
                    step="10"
                    value={selectedQuery.value}
                    onChange={(e) => patchQuery(selectedQuery.id, { value: Number(e.target.value) })}
                    aria-label="阈值数值"
                  />
                </div>
                <ButtonGroup
                  label="单位"
                  value={selectedQuery.unit}
                  options={UNIT_OPTIONS}
                  onChange={(v) => patchQuery(selectedQuery.id, { unit: v })}
                />
              </div>
              <div className="cnt__editor-divider">命中后的样式</div>
              <div className="cnt__editor-row cnt__editor-row--style">
                <div className="cnt__field">
                  <span className="cnt__field-label">背景色</span>
                  <input
                    type="color"
                    value={selectedQuery.background}
                    onChange={(e) => patchQuery(selectedQuery.id, { background: e.target.value })}
                    aria-label="背景色"
                  />
                </div>
                <div className="cnt__field">
                  <span className="cnt__field-label">文字色</span>
                  <input
                    type="color"
                    value={selectedQuery.color}
                    onChange={(e) => patchQuery(selectedQuery.id, { color: e.target.value })}
                    aria-label="文字色"
                  />
                </div>
              </div>
              <div className="cnt__editor-row cnt__editor-row--style">
                <div className="cnt__field">
                  <span className="cnt__field-label">
                    padding <output>{selectedQuery.padding}px</output>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="48"
                    value={selectedQuery.padding}
                    onChange={(e) => patchQuery(selectedQuery.id, { padding: Number(e.target.value) })}
                    aria-label="padding"
                  />
                </div>
                <div className="cnt__field">
                  <span className="cnt__field-label">
                    圆角 <output>{selectedQuery.borderRadius}px</output>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="32"
                    value={selectedQuery.borderRadius}
                    onChange={(e) => patchQuery(selectedQuery.id, { borderRadius: Number(e.target.value) })}
                    aria-label="圆角"
                  />
                </div>
                <div className="cnt__field">
                  <span className="cnt__field-label">
                    字号 <output>{selectedQuery.fontSize}px</output>
                  </span>
                  <input
                    type="range"
                    min="12"
                    max="36"
                    value={selectedQuery.fontSize}
                    onChange={(e) => patchQuery(selectedQuery.id, { fontSize: Number(e.target.value) })}
                    aria-label="字号"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CSS 代码输出 */}
      <div className="cnt__output">
        <div className="cnt__output-head">
          <span className="cnt__output-label">CSS 代码</span>
          <button type="button" className="cnt__btn cnt__btn--copy" onClick={handleCopy}>
            {copied ? '已复制 ✓' : '复制'}
          </button>
        </div>
        <pre className="cnt__code">{cssCode}</pre>
        <p className="cnt__hint">
          当前共 {queries.length} 个 @container 查询（其中 {queries.filter((q) => q.enabled).length} 个启用）。
          预览容器宽度 {previewWidth}px，
          {matchedQueries.length > 0
            ? `命中 ${matchedQueries.length} 个查询：${matchedQueries.map((q) => q.label).join('、')}。`
            : '未命中任何查询，使用基础样式。'}
        </p>
      </div>
    </div>
  );
}
