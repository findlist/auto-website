import { useState, useMemo, useCallback, useEffect } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * CSS animation 动画生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - @keyframes 关键帧编辑器（0% / 100% 必选 + 可增删中间帧）
 *  - 每帧支持 translateX/Y、rotate、scale、opacity 五个属性
 *  - animation 完整属性面板：duration / timing-function / delay / iteration-count / direction / fill-mode / play-state
 *  - 8 组预设动画（弹跳、旋转、脉冲、淡入、淡出、滑动、抖动、摇摆）
 *  - 实时预览 + 一键重启动画
 *  - 智能代码生成（仅输出非默认值属性），一键复制
 */

/** 单个关键帧的状态：位置 / 旋转 / 缩放 / 透明度 */
interface KeyframeState {
  /** 帧唯一标识，作为 React key，避免删除中间帧时受控 input 焦点错位 */
  id: string;
  /** 帧位置百分比，0-100 */
  offset: number;
  translateX: number;
  translateY: number;
  /** 旋转角度 deg */
  rotate: number;
  /** 缩放倍数，1 为原始 */
  scale: number;
  /** 透明度 0-1 */
  opacity: number;
}

/** 预设/默认值用的关键帧输入类型（不含 id，应用预设时统一生成 id） */
type KeyframeInput = Omit<KeyframeState, 'id'>;

/** animation 简写相关的 7 个属性（play-state 单独输出） */
interface AnimationConfig {
  /** 动画时长秒 */
  duration: number;
  timingFunction: string;
  /** 延迟秒 */
  delay: number;
  /** 播放次数，0 表示 infinite */
  iterationCount: number;
  direction: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
  fillMode: 'none' | 'forwards' | 'backwards' | 'both';
  playState: 'running' | 'paused';
}

/** 预设动画数据结构 */
interface AnimationPreset {
  name: string;
  keyframes: KeyframeInput[];
  config: Partial<AnimationConfig>;
}

// 缓动函数选项（含自定义 cubic-bezier 占位）
const TIMING_FUNCTIONS = [
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'cubic-bezier(0.68, -0.55, 0.27, 1.55)',
];

// 关键帧 id 生成器：模块级自增计数 + 时间戳，保证全局唯一，作为稳定 React key
let _kfIdCounter = 0;
const genKfId = (): string => `kf_${Date.now().toString(36)}_${(++_kfIdCounter).toString(36)}`;

// 把不带 id 的关键帧输入数组转为带 id 的 KeyframeState 数组
const withIds = (list: KeyframeInput[]): KeyframeState[] =>
  list.map((k) => ({ ...k, id: genKfId() }));

// 默认关键帧：0% 原始状态 + 100% 原始状态（占位）
const makeDefaultKeyframes = (): KeyframeState[] =>
  withIds([
    { offset: 0, translateX: 0, translateY: 0, rotate: 0, scale: 1, opacity: 1 },
    { offset: 100, translateX: 0, translateY: 0, rotate: 0, scale: 1, opacity: 1 },
  ]);

// 默认 animation 配置
const DEFAULT_CONFIG: AnimationConfig = {
  duration: 2,
  timingFunction: 'ease',
  delay: 0,
  iterationCount: 0,
  direction: 'normal',
  fillMode: 'none',
  playState: 'running',
};

// 8 组预设动画，覆盖常见动效需求
const PRESETS: AnimationPreset[] = [
  {
    name: '弹跳',
    keyframes: [
      { offset: 0, translateX: 0, translateY: 0, rotate: 0, scale: 1, opacity: 1 },
      { offset: 50, translateX: 0, translateY: -40, rotate: 0, scale: 1, opacity: 1 },
      { offset: 100, translateX: 0, translateY: 0, rotate: 0, scale: 1, opacity: 1 },
    ],
    config: { duration: 1, timingFunction: 'ease-in-out', iterationCount: 0 },
  },
  {
    name: '旋转',
    keyframes: [
      { offset: 0, translateX: 0, translateY: 0, rotate: 0, scale: 1, opacity: 1 },
      { offset: 100, translateX: 0, translateY: 0, rotate: 360, scale: 1, opacity: 1 },
    ],
    config: { duration: 2, timingFunction: 'linear', iterationCount: 0 },
  },
  {
    name: '脉冲',
    keyframes: [
      { offset: 0, translateX: 0, translateY: 0, rotate: 0, scale: 1, opacity: 1 },
      { offset: 50, translateX: 0, translateY: 0, rotate: 0, scale: 1.3, opacity: 0.8 },
      { offset: 100, translateX: 0, translateY: 0, rotate: 0, scale: 1, opacity: 1 },
    ],
    config: { duration: 1.5, timingFunction: 'ease-in-out', iterationCount: 0 },
  },
  {
    name: '淡入',
    keyframes: [
      { offset: 0, translateX: 0, translateY: 0, rotate: 0, scale: 1, opacity: 0 },
      { offset: 100, translateX: 0, translateY: 0, rotate: 0, scale: 1, opacity: 1 },
    ],
    config: { duration: 1, timingFunction: 'ease-out', iterationCount: 1, fillMode: 'forwards' },
  },
  {
    name: '淡出',
    keyframes: [
      { offset: 0, translateX: 0, translateY: 0, rotate: 0, scale: 1, opacity: 1 },
      { offset: 100, translateX: 0, translateY: 0, rotate: 0, scale: 1, opacity: 0 },
    ],
    config: { duration: 1, timingFunction: 'ease-in', iterationCount: 1, fillMode: 'forwards' },
  },
  {
    name: '右滑入',
    keyframes: [
      { offset: 0, translateX: -80, translateY: 0, rotate: 0, scale: 1, opacity: 0 },
      { offset: 100, translateX: 0, translateY: 0, rotate: 0, scale: 1, opacity: 1 },
    ],
    config: { duration: 0.8, timingFunction: 'ease-out', iterationCount: 1, fillMode: 'both' },
  },
  {
    name: '抖动',
    keyframes: [
      { offset: 0, translateX: 0, translateY: 0, rotate: 0, scale: 1, opacity: 1 },
      { offset: 25, translateX: -10, translateY: 0, rotate: 0, scale: 1, opacity: 1 },
      { offset: 75, translateX: 10, translateY: 0, rotate: 0, scale: 1, opacity: 1 },
      { offset: 100, translateX: 0, translateY: 0, rotate: 0, scale: 1, opacity: 1 },
    ],
    config: { duration: 0.5, timingFunction: 'ease-in-out', iterationCount: 0 },
  },
  {
    name: '摇摆',
    keyframes: [
      { offset: 0, translateX: 0, translateY: 0, rotate: 0, scale: 1, opacity: 1 },
      { offset: 25, translateX: 0, translateY: 0, rotate: 15, scale: 1, opacity: 1 },
      { offset: 75, translateX: 0, translateY: 0, rotate: -15, scale: 1, opacity: 1 },
      { offset: 100, translateX: 0, translateY: 0, rotate: 0, scale: 1, opacity: 1 },
    ],
    config: { duration: 1.5, timingFunction: 'ease-in-out', iterationCount: 0 },
  },
];

/** 将单帧的属性格式化为 CSS declaration 字符串 */
function formatKeyframeBody(kf: KeyframeState): string {
  const decls: string[] = [];
  // transform 仅在非默认值时输出
  const hasTransform = kf.translateX !== 0 || kf.translateY !== 0 || kf.rotate !== 0 || kf.scale !== 1;
  if (hasTransform) {
    const parts: string[] = [];
    if (kf.translateX !== 0 || kf.translateY !== 0) {
      parts.push(`translate(${kf.translateX}px, ${kf.translateY}px)`);
    }
    if (kf.rotate !== 0) parts.push(`rotate(${kf.rotate}deg)`);
    if (kf.scale !== 1) parts.push(`scale(${kf.scale})`);
    decls.push(`  transform: ${parts.join(' ')};`);
  }
  if (kf.opacity !== 1) decls.push(`  opacity: ${kf.opacity};`);
  return decls.join('\n');
}

export default function AnimationTool() {
  const [keyframes, setKeyframes] = useState<KeyframeState[]>(makeDefaultKeyframes);
  const [config, setConfig] = useState<AnimationConfig>(DEFAULT_CONFIG);
  const [copied, setCopied] = useState(false);
  // 预览元素 key：通过改变 key 强制重挂载，从而重启 animation
  const [previewKey, setPreviewKey] = useState(0);
  // 动画名称（用户可编辑，默认 anim）
  const [animName, setAnimName] = useState('anim');

  // 生成立即生效的 @keyframes 规则字符串（注入 <style>）
  const keyframesCss = useMemo(() => {
    // 关键帧按 offset 升序输出，保证 CSS 语义正确
    const sorted = [...keyframes].sort((a, b) => a.offset - b.offset);
    const body = sorted
      .map((kf) => `  ${kf.offset}% {\n${formatKeyframeBody(kf)}\n  }`)
      .join('\n');
    return `@keyframes ${animName} {\n${body}\n}`;
  }, [keyframes, animName]);

  // 生成 animation 简写字符串（仅输出非默认值，保持代码精简）
  const animationValue = useMemo(() => {
    const parts: string[] = [animName, `${config.duration}s`, config.timingFunction];
    if (config.delay !== 0) parts.push(`${config.delay}s`);
    parts.push(config.iterationCount === 0 ? 'infinite' : String(config.iterationCount));
    if (config.direction !== 'normal') parts.push(config.direction);
    if (config.fillMode !== 'none') parts.push(config.fillMode);
    return parts.join(' ');
  }, [animName, config]);

  // 完整 CSS 代码块：@keyframes + animation 应用规则
  const fullCss = useMemo(() => {
    const lines: string[] = [keyframesCss, ''];
    lines.push(`.box {`);
    lines.push(`  animation: ${animationValue};`);
    if (config.playState === 'paused') lines.push(`  animation-play-state: paused;`);
    lines.push(`}`);
    return lines.join('\n');
  }, [keyframesCss, animationValue, config.playState]);

  // 当 keyframes / config / animName 变化时自动重启预览动画
  useEffect(() => {
    setPreviewKey((k) => k + 1);
  }, [keyframes, config, animName]);

  // 将 @keyframes 规则注入到动态 <style> 标签，使预览方块实时应用动画
  // 必须注入 DOM：inline style 无法定义 @keyframes，CSS 规则需在 stylesheet 中
  useEffect(() => {
    const styleEl = document.createElement('style');
    styleEl.textContent = keyframesCss;
    document.head.appendChild(styleEl);
    return () => {
      document.head.removeChild(styleEl);
    };
  }, [keyframesCss]);

  // 手动重启动画
  const handleRestart = useCallback(() => setPreviewKey((k) => k + 1), []);

  // 应用预设：为预设的关键帧统一生成新 id，保证每次应用的帧 id 唯一
  const applyPreset = useCallback((preset: AnimationPreset) => {
    setKeyframes(withIds(preset.keyframes));
    setConfig({ ...DEFAULT_CONFIG, ...preset.config });
  }, []);

  // 一键重置
  const resetAll = useCallback(() => {
    setKeyframes(makeDefaultKeyframes());
    setConfig(DEFAULT_CONFIG);
    setAnimName('anim');
  }, []);

  // 复制 CSS 代码
  const handleCopy = useCallback(async () => {
    const ok = await copyText(fullCss);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [fullCss]);

  // 更新指定关键帧的某个字段
  const updateKeyframe = useCallback((index: number, field: keyof KeyframeState, value: number) => {
    setKeyframes((prev) => prev.map((kf, i) => (i === index ? { ...kf, [field]: value } : kf)));
  }, []);

  // 删除关键帧（保留至少 2 帧，即 0% 与 100%）
  const removeKeyframe = useCallback((index: number) => {
    setKeyframes((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== index)));
  }, []);

  // 新增中间关键帧，默认 50% 位置，复制最近一帧的状态（生成新 id 作为稳定 key）
  const addKeyframe = useCallback(() => {
    setKeyframes((prev) => {
      if (prev.length >= 8) return prev;
      const sorted = [...prev].sort((a, b) => a.offset - b.offset);
      // 找到相邻两帧间最大间隙，插入中点
      let bestGap = 0;
      let bestPos = 50;
      for (let i = 0; i < sorted.length - 1; i++) {
        const gap = sorted[i + 1].offset - sorted[i].offset;
        if (gap > bestGap) {
          bestGap = gap;
          bestPos = Math.round((sorted[i].offset + sorted[i + 1].offset) / 2);
        }
      }
      return [...prev, { ...sorted[sorted.length - 1], offset: bestPos, id: genKfId() }];
    });
  }, []);

  // 更新 animation 配置字段
  const updateConfig = useCallback(<K extends keyof AnimationConfig>(field: K, value: AnimationConfig[K]) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  }, []);

  return (
    <div className="amt">
      {/* 预览区：方块实时应用动画，key 变化时重挂载重启 animation */}
      <div className="amt__preview-wrap">
        <div className="amt__preview-stage">
          <div
            key={previewKey}
            className="amt__box"
            style={{ animation: animationValue, animationPlayState: config.playState }}
          />
        </div>
        <button type="button" className="amt__btn amt__btn--restart" onClick={handleRestart}>
          重新播放
        </button>
      </div>

      {/* 预设按钮组 */}
      <div className="amt__presets">
        <span className="amt__presets-label">预设：</span>
        {PRESETS.map((p) => (
          <button key={p.name} type="button" className="amt__btn amt__btn--preset" onClick={() => applyPreset(p)}>
            {p.name}
          </button>
        ))}
        <button type="button" className="amt__btn amt__btn--reset" onClick={resetAll}>
          全部重置
        </button>
      </div>

      {/* animation 属性面板 */}
      <div className="amt__panel">
        <div className="amt__panel-head">
          <span className="amt__panel-title">animation 属性</span>
        </div>
        <div className="amt__config-grid">
          <label className="amt__field">
            <span>动画名称</span>
            <input
              type="text"
              className="amt__text-input"
              value={animName}
              onChange={(e) => setAnimName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
            />
          </label>
          <label className="amt__field">
            <span>时长 {config.duration}s</span>
            <input
              type="range"
              min="0.1"
              max="10"
              step="0.1"
              value={config.duration}
              onChange={(e) => updateConfig('duration', Number(e.target.value))}
            />
          </label>
          <label className="amt__field">
            <span>缓动函数</span>
            <select
              className="amt__select"
              value={config.timingFunction}
              onChange={(e) => updateConfig('timingFunction', e.target.value)}
            >
              {TIMING_FUNCTIONS.map((tf) => (
                <option key={tf} value={tf}>
                  {tf}
                </option>
              ))}
            </select>
          </label>
          <label className="amt__field">
            <span>延迟 {config.delay}s</span>
            <input
              type="range"
              min="0"
              max="5"
              step="0.1"
              value={config.delay}
              onChange={(e) => updateConfig('delay', Number(e.target.value))}
            />
          </label>
          <label className="amt__field">
            <span>播放次数</span>
            <select
              className="amt__select"
              value={config.iterationCount}
              onChange={(e) => updateConfig('iterationCount', Number(e.target.value))}
            >
              <option value={0}>infinite（无限循环）</option>
              {[1, 2, 3, 4, 5, 10].map((n) => (
                <option key={n} value={n}>
                  {n} 次
                </option>
              ))}
            </select>
          </label>
          <label className="amt__field">
            <span>方向 direction</span>
            <select
              className="amt__select"
              value={config.direction}
              onChange={(e) => updateConfig('direction', e.target.value as AnimationConfig['direction'])}
            >
              <option value="normal">normal（正向）</option>
              <option value="reverse">reverse（反向）</option>
              <option value="alternate">alternate（交替）</option>
              <option value="alternate-reverse">alternate-reverse（反向交替）</option>
            </select>
          </label>
          <label className="amt__field">
            <span>填充模式 fill-mode</span>
            <select
              className="amt__select"
              value={config.fillMode}
              onChange={(e) => updateConfig('fillMode', e.target.value as AnimationConfig['fillMode'])}
            >
              <option value="none">none（无）</option>
              <option value="forwards">forwards（保持结束）</option>
              <option value="backwards">backwards（应用起始）</option>
              <option value="both">both（两者）</option>
            </select>
          </label>
          <label className="amt__field">
            <span>播放状态 play-state</span>
            <select
              className="amt__select"
              value={config.playState}
              onChange={(e) => updateConfig('playState', e.target.value as AnimationConfig['playState'])}
            >
              <option value="running">running（播放）</option>
              <option value="paused">paused（暂停）</option>
            </select>
          </label>
        </div>
      </div>

      {/* @keyframes 关键帧编辑器 */}
      <div className="amt__panel">
        <div className="amt__panel-head">
          <span className="amt__panel-title">@keyframes 关键帧（{keyframes.length} 帧）</span>
          <button
            type="button"
            className="amt__btn amt__btn--add"
            onClick={addKeyframe}
            disabled={keyframes.length >= 8}
          >
            + 添加关键帧
          </button>
        </div>
        <div className="amt__keyframes">
          {keyframes.map((kf, i) => (
            <div key={kf.id} className="amt__kf">
              <div className="amt__kf-head">
                <label className="amt__kf-offset">
                  位置
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={kf.offset}
                    onChange={(e) => updateKeyframe(i, 'offset', Math.max(0, Math.min(100, Number(e.target.value))))}
                  />
                  %
                </label>
                {keyframes.length > 2 && (
                  <button
                    type="button"
                    className="amt__btn amt__btn--del"
                    onClick={() => removeKeyframe(i)}
                    aria-label={`删除第 ${i + 1} 帧`}
                  >
                    删除
                  </button>
                )}
              </div>
              <div className="amt__kf-grid">
                <label className="amt__kf-field">
                  <span>translateX {kf.translateX}px</span>
                  <input
                    type="range"
                    min="-100"
                    max="100"
                    step="1"
                    value={kf.translateX}
                    onChange={(e) => updateKeyframe(i, 'translateX', Number(e.target.value))}
                  />
                </label>
                <label className="amt__kf-field">
                  <span>translateY {kf.translateY}px</span>
                  <input
                    type="range"
                    min="-100"
                    max="100"
                    step="1"
                    value={kf.translateY}
                    onChange={(e) => updateKeyframe(i, 'translateY', Number(e.target.value))}
                  />
                </label>
                <label className="amt__kf-field">
                  <span>rotate {kf.rotate}deg</span>
                  <input
                    type="range"
                    min="-360"
                    max="360"
                    step="1"
                    value={kf.rotate}
                    onChange={(e) => updateKeyframe(i, 'rotate', Number(e.target.value))}
                  />
                </label>
                <label className="amt__kf-field">
                  <span>scale {kf.scale}</span>
                  <input
                    type="range"
                    min="0"
                    max="3"
                    step="0.1"
                    value={kf.scale}
                    onChange={(e) => updateKeyframe(i, 'scale', Number(e.target.value))}
                  />
                </label>
                <label className="amt__kf-field">
                  <span>opacity {kf.opacity}</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={kf.opacity}
                    onChange={(e) => updateKeyframe(i, 'opacity', Number(e.target.value))}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CSS 代码输出 */}
      <div className="amt__output">
        <div className="amt__output-head">
          <span className="amt__output-label">CSS 代码</span>
          <button type="button" className="amt__btn amt__btn--copy" onClick={handleCopy}>
            {copied ? '已复制 ✓' : '复制'}
          </button>
        </div>
        <pre className="amt__code">{fullCss}</pre>
      </div>
    </div>
  );
}
