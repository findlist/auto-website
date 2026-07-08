import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { copyText } from '../utils/clipboard';
import {
  parseCron,
  describeCron,
  nextExecutions,
  CRON_PRESETS,
  type CronParseResult,
} from '../utils/cron';

/**
 * CRON 表达式解析与可视化工具
 *
 * 全部在浏览器本地处理，零依赖（核心逻辑在 utils/cron.ts）。
 *
 * 功能：
 *  - 5 字段 cron 表达式输入与实时解析
 *  - 中文自然语言描述
 *  - 计算未来 5 次执行时间
 *  - 12 个常用预设一键载入
 *  - 错误提示（字段越界、非法字符、字段数不对）
 *  - 复制表达式 / 复制描述
 *  - 字段语法说明表
 */

/** 格式化日期为可读字符串 */
function formatDateTime(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const weekCN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} ${weekCN[d.getDay()]}`;
}

/** 计算距下次执行的相对时间 */
function relativeTime(from: Date, to: Date): string {
  const diff = to.getTime() - from.getTime();
  if (diff < 0) return '已过期';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '即将执行';
  if (minutes < 60) return `${minutes} 分钟后`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const m = minutes % 60;
    return m > 0 ? `${hours} 小时 ${m} 分钟后` : `${hours} 小时后`;
  }
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  return h > 0 ? `${days} 天 ${h} 小时后` : `${days} 天后`;
}

export default function CronTool() {
  // SSR/CSR 一致：初始用默认示例，避免水合不匹配
  const [expr, setExpr] = useState<string>('0 9 * * 1-5');
  const [now, setNow] = useState<Date | null>(null);
  const [notice, setNotice] = useState<string>('');
  const [copiedField, setCopiedField] = useState<string>('');
  const noticeTimer = useRef<number | undefined>(undefined);

  // 客户端挂载后获取当前时间（避免 SSR/CSR 不一致）
  useEffect(() => {
    setNow(new Date());
  }, []);

  /** 显示临时提示，1.5s 后清除 */
  const flashNotice = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 1500);
  }, []);

  // 实时解析
  const parsed: CronParseResult = useMemo(() => parseCron(expr), [expr]);
  const description = useMemo(() => describeCron(parsed), [parsed]);

  // 计算未来 5 次执行时间：parsed 或 now 变化时重新计算
  const [executions, setExecutions] = useState<Date[]>([]);
  useEffect(() => {
    if (parsed.error || !now) {
      setExecutions([]);
      return;
    }
    setExecutions(nextExecutions(parsed, now, 5));
  }, [parsed, now]);

  // 每 30 秒刷新一次 now，触发上面的 effect 重新计算 executions
  useEffect(() => {
    if (parsed.error) return;
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 30000);
    return () => window.clearInterval(timer);
  }, [parsed.error]);

  /** 载入预设 */
  const handleLoadPreset = useCallback((presetExpr: string, label: string) => {
    setExpr(presetExpr);
    flashNotice(`已载入预设：${label}`);
  }, [flashNotice]);

  /** 清空 */
  const handleClear = useCallback(() => {
    setExpr('');
    flashNotice('已清空');
  }, [flashNotice]);

  /** 复制表达式 */
  const handleCopyExpr = useCallback(async () => {
    if (!expr) return;
    const ok = await copyText(expr);
    if (ok) {
      setCopiedField('expr');
      flashNotice('已复制表达式');
      setTimeout(() => setCopiedField(''), 1500);
    } else {
      flashNotice('复制失败，请手动选中复制');
    }
  }, [expr, flashNotice]);

  /** 复制描述 */
  const handleCopyDesc = useCallback(async () => {
    if (parsed.error || !description) return;
    const text = `${expr}\n${description}\n下次执行：${executions[0] ? formatDateTime(executions[0]) : '无'}`;
    const ok = await copyText(text);
    if (ok) {
      setCopiedField('desc');
      flashNotice('已复制表达式与描述');
      setTimeout(() => setCopiedField(''), 1500);
    } else {
      flashNotice('复制失败，请手动选中复制');
    }
  }, [expr, description, parsed.error, executions, flashNotice]);

  const hasError = !!parsed.error;
  const fieldLabels = ['分钟 (0-59)', '小时 (0-23)', '日 (1-31)', '月 (1-12)', '周 (0-6)'];
  const fieldValues = expr.trim().split(/\s+/);

  return (
    <div className="jsontool crontool">
      {/* 工具栏 */}
      <div className="jsontool__toolbar" role="toolbar" aria-label="CRON 表达式工具操作">
        <div className="jsontool__actions">
          <button className="btn btn--sm" onClick={handleCopyExpr} disabled={!expr}>复制表达式</button>
          <button className="btn btn--sm" onClick={handleCopyDesc} disabled={hasError || !expr}>
            {copiedField === 'desc' ? '已复制' : '复制描述'}
          </button>
          <button className="btn btn--sm" onClick={handleClear} disabled={!expr}>清空</button>
        </div>
      </div>

      {/* 表达式输入区 */}
      <div className="crontool__input-area">
        <label className="crontool__input-label" htmlFor="cron-expr">CRON 表达式</label>
        <input
          id="cron-expr"
          type="text"
          className="crontool__input"
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          placeholder="例如：0 9 * * 1-5（工作日 9 点）"
          spellCheck={false}
          autoComplete="off"
          aria-label="CRON 表达式输入"
          aria-invalid={hasError}
        />
        {/* 字段分隔显示 */}
        {fieldValues.length === 5 && !hasError && (
          <div className="crontool__fields" role="list" aria-label="5 字段解析">
            {fieldLabels.map((label, i) => (
              <div key={i} className="crontool__field" role="listitem">
                <span className="crontool__field-value">{fieldValues[i]}</span>
                <span className="crontool__field-label">{label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 错误提示 */}
      {hasError && (
        <div className="crontool__error" role="alert">
          <span className="crontool__error-icon" aria-hidden="true">⚠</span>
          <span>{parsed.error!.message}</span>
          {parsed.error!.field !== 'format' && (
            <span className="crontool__error-field">（{parsed.error!.field} 字段）</span>
          )}
        </div>
      )}

      {/* 描述区 */}
      {!hasError && expr && (
        <div className="crontool__desc" role="status" aria-live="polite">
          <div className="crontool__desc-label">执行含义</div>
          <div className="crontool__desc-text">{description}</div>
        </div>
      )}

      {/* 下次执行时间 */}
      {!hasError && expr && executions.length > 0 && (
        <div className="crontool__next">
          <div className="crontool__next-label">未来 5 次执行时间</div>
          <ol className="crontool__next-list" role="list">
            {executions.map((d, i) => (
              <li key={i} className="crontool__next-item">
                <span className="crontool__next-index">#{i + 1}</span>
                <span className="crontool__next-time">{formatDateTime(d)}</span>
                {i === 0 && now && (
                  <span className="crontool__next-relative">{relativeTime(now, d)}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* 预设示例 */}
      <div className="crontool__presets">
        <div className="crontool__presets-label">常用预设</div>
        <div className="crontool__presets-grid" role="group" aria-label="预设示例">
          {CRON_PRESETS.map((preset) => (
            <button
              key={preset.expr}
              type="button"
              className="crontool__preset-btn"
              onClick={() => handleLoadPreset(preset.expr, preset.label)}
              title={preset.desc}
              aria-label={`载入预设：${preset.label}，表达式 ${preset.expr}`}
            >
              <span className="crontool__preset-label">{preset.label}</span>
              <code className="crontool__preset-expr">{preset.expr}</code>
            </button>
          ))}
        </div>
      </div>

      {/* 字段语法说明 */}
      <details className="crontool__syntax" open>
        <summary className="crontool__syntax-summary">字段语法说明</summary>
        <div className="crontool__syntax-content">
          <table className="crontool__syntax-table">
            <thead>
              <tr>
                <th scope="col">字段</th>
                <th scope="col">取值范围</th>
                <th scope="col">说明</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>分钟</td>
                <td>0-59</td>
                <td>每小时的第几分钟执行</td>
              </tr>
              <tr>
                <td>小时</td>
                <td>0-23</td>
                <td>每天的第几小时执行（24 小时制）</td>
              </tr>
              <tr>
                <td>日</td>
                <td>1-31</td>
                <td>每月的第几号执行（L 表示月末）</td>
              </tr>
              <tr>
                <td>月</td>
                <td>1-12</td>
                <td>每年的第几月执行（支持 JAN-DEC）</td>
              </tr>
              <tr>
                <td>周</td>
                <td>0-6</td>
                <td>每周的第几天执行（0=周日，支持 SUN-SAT）</td>
              </tr>
            </tbody>
          </table>
          <table className="crontool__syntax-table">
            <caption>特殊字符</caption>
            <thead>
              <tr>
                <th scope="col">字符</th>
                <th scope="col">含义</th>
                <th scope="col">示例</th>
              </tr>
            </thead>
            <tbody>
              <tr><td><code>*</code></td><td>任意值</td><td><code>* * * * *</code> 每分钟</td></tr>
              <tr><td><code>?</code></td><td>不指定（同 *，仅日 / 周）</td><td><code>0 0 ? * 1</code> 每周一</td></tr>
              <tr><td><code>,</code></td><td>列表</td><td><code>0 0,12 * * *</code> 每天 0 与 12 点</td></tr>
              <tr><td><code>-</code></td><td>范围</td><td><code>0 9 * * 1-5</code> 工作日 9 点</td></tr>
              <tr><td><code>/</code></td><td>步长</td><td><code>*/5 * * * *</code> 每 5 分钟</td></tr>
              <tr><td><code>L</code></td><td>最后</td><td><code>0 0 L * *</code> 月末 0 点</td></tr>
              <tr><td><code>W</code></td><td>最近工作日</td><td><code>0 0 15W * *</code> 最接近 15 号的工作日</td></tr>
              <tr><td><code>#</code></td><td>第几周</td><td><code>0 0 * * 5#3</code> 第 3 个周五</td></tr>
            </tbody>
          </table>
        </div>
      </details>

      {/* 状态条 */}
      <div className="jsontool__status" role="status" aria-live="polite">
        {notice ? (
          <div className="jsontool__notice">{notice}</div>
        ) : (
          <div className="jsontool__hint">
            支持标准 5 字段 cron 语法与 L/W/# 扩展字符。所有解析在浏览器本地完成，下次执行时间按本地时区计算。
          </div>
        )}
      </div>
    </div>
  );
}
