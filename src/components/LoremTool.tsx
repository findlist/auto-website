import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';
import {
  DATA_TYPE_OPTIONS,
  isPlaceholderType,
  generateItems,
  formatOutput,
  getFormatExt,
  type DataType,
  type Granularity,
  type OutputFormat,
} from '../utils/lorem';

/** 粒度选项（仅占位文本类型显示） */
const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: 'paragraph', label: '段落' },
  { value: 'sentence', label: '句子' },
  { value: 'word', label: '单词 / 单字' },
];

/** 输出格式选项 */
const FORMAT_OPTIONS: { value: OutputFormat; label: string; hint: string }[] = [
  { value: 'text', label: '纯文本', hint: '每项一行' },
  { value: 'json', label: 'JSON 数组', hint: '2 空格缩进' },
  { value: 'csv', label: 'CSV', hint: 'type,value 两列' },
  { value: 'markdown', label: 'Markdown 表格', hint: '| # | value |' },
];

/** 复制状态 */
type CopyStatus = 'idle' | 'success' | 'fail';

/**
 * 占位文本与 Mock 数据生成器组件
 *
 * 设计要点：
 *  - 初始状态用固定值（type/count/granularity），items 为空数组，避免 SSR 水合不一致
 *  - 缓存生成的 items，切换输出格式时仅重新格式化，不重新生成
 *  - 数量边界 1-100，超出自动钳制
 */
export default function LoremTool() {
  // 初始用固定值，避免 SSR 水合不一致
  const [type, setType] = useState<DataType>('lorem-en');
  const [granularity, setGranularity] = useState<Granularity>('paragraph');
  const [count, setCount] = useState(5);
  const [format, setFormat] = useState<OutputFormat>('text');
  const [items, setItems] = useState<string[]>([]);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');

  const isPlaceholder = isPlaceholderType(type);

  // 切换类型时清空已生成数据，避免类型与数据不匹配
  const handleTypeChange = (next: DataType) => {
    setType(next);
    setItems([]);
    setCopyStatus('idle');
  };

  // 切换粒度时清空已生成数据
  const handleGranularityChange = (next: Granularity) => {
    setGranularity(next);
    setItems([]);
    setCopyStatus('idle');
  };

  // 生成数据
  const handleGenerate = useCallback(() => {
    const newItems = generateItems(type, count, granularity);
    setItems(newItems);
    setCopyStatus('idle');
  }, [type, count, granularity]);

  // 基于缓存 items 与当前 format 计算输出（切换 format 无需重新生成）
  const output = useMemo(
    () => formatOutput(items, format, type),
    [items, format, type],
  );

  // 复制到剪贴板
  const handleCopy = async () => {
    if (!output) return;
    const ok = await copyText(output);
    setCopyStatus(ok ? 'success' : 'fail');
    // 2 秒后恢复提示
    setTimeout(() => setCopyStatus('idle'), 2000);
  };

  // 下载为文件
  const handleDownload = () => {
    if (!output) return;
    const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lorem-${type}.${getFormatExt(format)}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 数量边界校验（1-100）
  const handleCountChange = (v: number) => {
    const safe = Math.max(1, Math.min(100, Math.floor(v) || 1));
    setCount(safe);
  };

  const charCount = output.length;
  const itemCount = items.length;
  const copyLabel =
    copyStatus === 'success' ? '已复制' : copyStatus === 'fail' ? '复制失败' : '复制';

  return (
    <div className="lorem">
      {/* 配置区 */}
      <section className="lorem__config" aria-label="生成配置">
        <div className="lorem__field">
          <label htmlFor="lorem-type" className="lorem__label">
            数据类型
          </label>
          <select
            id="lorem-type"
            className="lorem__select"
            value={type}
            onChange={(e) => handleTypeChange(e.target.value as DataType)}
            aria-label="选择数据类型"
          >
            {DATA_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {isPlaceholder && (
          <div className="lorem__field">
            <label htmlFor="lorem-granularity" className="lorem__label">
              粒度
            </label>
            <select
              id="lorem-granularity"
              className="lorem__select"
              value={granularity}
              onChange={(e) => handleGranularityChange(e.target.value as Granularity)}
              aria-label="选择文本粒度"
            >
              {GRANULARITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="lorem__field lorem__field--count">
          <label htmlFor="lorem-count" className="lorem__label">
            数量：<span className="lorem__count-value">{count}</span>
          </label>
          <input
            id="lorem-count"
            type="range"
            min={1}
            max={100}
            value={count}
            onChange={(e) => handleCountChange(Number(e.target.value))}
            className="lorem__range"
            aria-label="生成数量"
          />
        </div>

        <button
          type="button"
          className="lorem__btn lorem__btn--primary"
          onClick={handleGenerate}
          aria-label="生成数据"
        >
          生成
        </button>
      </section>

      {/* 输出格式切换 */}
      <section className="lorem__format" aria-label="输出格式">
        <span className="lorem__label">输出格式：</span>
        <div className="lorem__format-group" role="group" aria-label="选择输出格式">
          {FORMAT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`lorem__format-btn ${format === opt.value ? 'is-active' : ''}`}
              onClick={() => setFormat(opt.value)}
              aria-pressed={format === opt.value}
              title={opt.hint}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      {/* 结果区 */}
      <section className="lorem__result" aria-label="生成结果">
        <div className="lorem__result-header">
          <span className="lorem__stats">
            {itemCount > 0 ? `${itemCount} 项 · ${charCount} 字符` : '尚未生成'}
          </span>
          <div className="lorem__actions">
            <button
              type="button"
              className="lorem__btn"
              onClick={handleCopy}
              disabled={!output}
              aria-label="复制结果"
            >
              {copyLabel}
            </button>
            <button
              type="button"
              className="lorem__btn"
              onClick={handleDownload}
              disabled={!output}
              aria-label="下载结果"
            >
              下载
            </button>
          </div>
        </div>
        <pre className="lorem__output" aria-live="polite">
          {output || '点击「生成」按钮开始创建数据'}
        </pre>
      </section>
    </div>
  );
}
