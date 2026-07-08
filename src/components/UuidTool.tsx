import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * UUID 生成器
 * 全部在浏览器本地处理，使用原生 crypto.randomUUID（UUID v4）。
 *
 * 功能：
 *  - 批量生成 UUID v4（1 / 5 / 10 / 50 / 100）
 *  - 连字符开关（默认带 -，可去掉得到 32 位十六进制）
 *  - 大写开关（默认小写）
 *  - 实时模式：参数变化自动重新生成
 *  - 复制全部 / 清空 / 单条复制
 */

type Count = 1 | 5 | 10 | 50 | 100;

interface UuidItem {
  id: string;
  // 用于 React key，避免使用 UUID 本身作为 key（去连字符 / 大写切换时值会变）
  seq: number;
}

const COUNT_OPTIONS: Count[] = [1, 5, 10, 50, 100];

/** 生成单个 UUID v4，兼容老浏览器降级方案 */
function generateOne(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 降级：用 getRandomValues 手动拼装 RFC 4122 v4
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // 第 7 字节高 4 位为 0100（版本 4），第 9 字节高 2 位为 10（variant）
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

/** 按格式化选项处理 UUID 字符串 */
function formatUuid(raw: string, hyphen: boolean, upper: boolean): string {
  let out = hyphen ? raw : raw.replace(/-/g, '');
  if (upper) out = out.toUpperCase();
  return out;
}

/** 批量生成并返回带 seq 的列表 */
function generateBatch(count: Count): UuidItem[] {
  const items: UuidItem[] = [];
  for (let i = 0; i < count; i++) {
    items.push({ id: generateOne(), seq: i });
  }
  return items;
}

export default function UuidTool() {
  const [count, setCount] = useState<Count>(5);
  const [hyphen, setHyphen] = useState<boolean>(true);
  const [upper, setUpper] = useState<boolean>(false);
  const [live, setLive] = useState<boolean>(true);
  const [items, setItems] = useState<UuidItem[]>(() => generateBatch(5));
  const [notice, setNotice] = useState<string>('');
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedSeq, setCopiedSeq] = useState<number | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

  /** 显示临时提示，1.5s 后清除 */
  const flashNotice = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 1500);
  }, []);

  /** 重新生成一批（保留当前数量） */
  const regenerate = useCallback(() => {
    setItems(generateBatch(count));
    setCopiedSeq(null);
  }, [count]);

  /** 实时模式：数量变化时自动重新生成 */
  useEffect(() => {
    if (!live) return;
    regenerate();
  }, [live, count, regenerate]);

  /** 复制全部 UUID（换行分隔） */
  const handleCopyAll = useCallback(async () => {
    const text = items.map((it) => formatUuid(it.id, hyphen, upper)).join('\n');
    const ok = await copyText(text);
    if (ok) {
      setCopiedAll(true);
      flashNotice(`已复制 ${items.length} 条 UUID`);
      setTimeout(() => setCopiedAll(false), 1500);
    } else {
      flashNotice('复制失败，请手动选中复制');
    }
  }, [items, hyphen, upper, flashNotice]);

  /** 复制单条 UUID */
  const handleCopyOne = useCallback(async (seq: number) => {
    const item = items.find((it) => it.seq === seq);
    if (!item) return;
    const text = formatUuid(item.id, hyphen, upper);
    const ok = await copyText(text);
    if (ok) {
      setCopiedSeq(seq);
      flashNotice('已复制');
      setTimeout(() => setCopiedSeq(null), 1500);
    } else {
      flashNotice('复制失败，请手动复制');
    }
  }, [items, hyphen, upper, flashNotice]);

  /** 清空 */
  const handleClear = useCallback(() => {
    setItems([]);
    setNotice('');
    setCopiedAll(false);
    setCopiedSeq(null);
  }, []);

  // 格式化后的 UUID 列表（去连字符 / 大写切换时实时刷新显示）
  const formattedItems = useMemo(
    () => items.map((it) => ({ seq: it.seq, text: formatUuid(it.id, hyphen, upper) })),
    [items, hyphen, upper],
  );

  return (
    <div className="jsontool uuidtool">
      {/* 工具栏 */}
      <div className="jsontool__toolbar" role="toolbar" aria-label="UUID 生成器操作">
        <div className="jsontool__actions">
          <button className="btn btn--primary btn--sm" onClick={regenerate}>重新生成</button>
        </div>
        <div className="jsontool__options">
          {/* 数量选择 */}
          <label className="uuidtool__field">
            <span>数量</span>
            <select
              className="uuidtool__select"
              value={count}
              onChange={(e) => setCount(Number(e.target.value) as Count)}
              aria-label="生成数量"
            >
              {COUNT_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          {/* 连字符开关 */}
          <label className="uuidtool__toggle">
            <input type="checkbox" checked={hyphen} onChange={(e) => setHyphen(e.target.checked)} />
            <span>连字符</span>
          </label>
          {/* 大写开关 */}
          <label className="uuidtool__toggle">
            <input type="checkbox" checked={upper} onChange={(e) => setUpper(e.target.checked)} />
            <span>大写</span>
          </label>
          {/* 实时模式开关 */}
          <label className="uuidtool__toggle">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
            <span>实时生成</span>
          </label>
          <button className="btn btn--sm" onClick={handleClear}>清空</button>
        </div>
      </div>

      {/* 结果列表 */}
      <div className="jsontool__panels">
        <div className="jsontool__panel">
          <div className="jsontool__label">
            <span>生成结果（{formattedItems.length} 条）</span>
            <button
              className="btn btn--sm jsontool__copy"
              onClick={handleCopyAll}
              disabled={formattedItems.length === 0}
              aria-label="复制全部 UUID"
            >
              {copiedAll ? '已复制' : '复制全部'}
            </button>
          </div>
          <ul className="uuidtool__list" aria-live="polite">
            {formattedItems.length === 0 ? (
              <li className="uuidtool__empty">点击"重新生成"开始创建 UUID</li>
            ) : (
              formattedItems.map((it) => (
                <li key={it.seq} className="uuidtool__item">
                  <code className="uuidtool__code">{it.text}</code>
                  <button
                    className="btn btn--sm uuidtool__copy-one"
                    onClick={() => handleCopyOne(it.seq)}
                    aria-label={`复制第 ${it.seq + 1} 条`}
                  >
                    {copiedSeq === it.seq ? '已复制' : '复制'}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      {/* 状态条 */}
      <div className="jsontool__status" role="status" aria-live="polite">
        {notice ? (
          <div className="jsontool__notice">{notice}</div>
        ) : (
          <div className="jsontool__hint">
            使用原生 crypto.randomUUID 生成 RFC 4122 版本 4 UUID，所有数据在浏览器本地处理。
          </div>
        )}
      </div>
    </div>
  );
}
