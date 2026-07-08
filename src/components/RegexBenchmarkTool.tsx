import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * 正则表达式性能基准工具
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 基准测试：执行 N 次正则匹配，统计平均/最大/最小/标准差
 *  - ReDoS 静态检测：识别嵌套量词、重叠分支、通配量词三类危险模式
 *  - 渐进式压力测试：用 5 个递增长度输入测试，判断是否指数级增长
 *  - 预设示例：安全正则、经典 ReDoS、中等风险
 *  - 标志位：g 全局 / i 忽略大小写 / m 多行 / s dotAll / u Unicode
 *
 * 安全策略：
 *  - 单次执行超时 2000ms 自动中止（防止卡死浏览器）
 *  - 测试字符串长度上限 10000
 *  - 压力测试长度上限 100
 */

type Flag = 'g' | 'i' | 'm' | 's' | 'u';

interface BenchmarkResult {
  ok: boolean;
  error?: string;
  iterations: number;
  times: number[];      // 每次执行耗时（ms）
  avg: number;          // 平均
  max: number;          // 最大
  min: number;          // 最小
  stdDev: number;       // 标准差
  total: number;        // 总耗时
}

interface StressPoint {
  length: number;       // 输入长度
  time: number;         // 执行耗时（ms）
  ok: boolean;          // 是否正常完成（未超时）
}

interface StressResult {
  points: StressPoint[];
  isExponential: boolean;   // 是否指数级增长
  maxTime: number;          // 最长单次耗时
  aborted: boolean;         // 是否因超时中止
}

type RiskLevel = 'low' | 'medium' | 'high';

interface StaticAnalysis {
  risk: RiskLevel;
  reasons: string[];        // 风险原因
  suggestions: string[];    // 优化建议
}

// 标志位定义
const FLAG_LIST: { flag: Flag; label: string; desc: string }[] = [
  { flag: 'g', label: 'g', desc: '全局匹配' },
  { flag: 'i', label: 'i', desc: '忽略大小写' },
  { flag: 'm', label: 'm', desc: '多行模式' },
  { flag: 's', label: 's', desc: 'dotAll（. 匹配换行符）' },
  { flag: 'u', label: 'u', desc: 'Unicode 模式' },
];

// 预设示例：覆盖安全/危险/中等三类
const PRESETS: { name: string; pattern: string; flags: string; testText: string; desc: string }[] = [
  {
    name: '安全正则',
    pattern: '^\\d+$',
    flags: '',
    testText: '1234567890',
    desc: '纯数字校验，无回溯风险，O(n) 线性时间',
  },
  {
    name: '经典 ReDoS',
    pattern: '^(a+)+$',
    flags: '',
    testText: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!',
    desc: '嵌套量词 (a+)+ 是 ReDoS 经典模式，结尾 ! 触发指数级回溯',
  },
  {
    name: '中等风险',
    pattern: '^(\\w+)+$',
    flags: '',
    testText: 'test_test_test_test_test!',
    desc: '嵌套量词 (\\w+)+ 但字符集重叠度低，风险中等',
  },
];

const SAMPLE_PATTERN = '^(a+)+$';
const SAMPLE_FLAGS = '';
const SAMPLE_TEXT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!';

const MAX_TEXT_LENGTH = 10000;
const MAX_STRESS_LENGTH = 100;
const SINGLE_TIMEOUT_MS = 2000;
const DEFAULT_ITERATIONS = 100;

/**
 * ReDoS 静态分析：扫描正则模式识别危险结构
 * 三类经典模式：
 *  1. 嵌套量词：捕获组内含量词，组外又跟量词，如 (a+)+, (a*)*
 *  2. 重叠分支 + 量词：捕获组内有交替分支且后跟量词，如 (a|a)*, (ab|a)*
 *  3. 通配量词：. + . * 等，可能产生大量回溯
 */
function analyzeStatic(pattern: string): StaticAnalysis {
  const reasons: string[] = [];
  const suggestions: string[] = [];

  // 嵌套量词：捕获组内含量词，组外又跟量词
  // 示例：(a+)+, (a*)*, (a{2,})+, ([a-z]+)*
  // 正则解释：匹配 ( 开头（非 ? 即非原子组），组内有 + * { 量词，组外跟 + * { 量词
  const nestedQuantifier = /\(([^?][^)]*[+*{][^)]*)\)[+*{]/;
  if (nestedQuantifier.test(pattern)) {
    reasons.push('检测到嵌套量词（如 (a+)+、(a*)*），捕获组内含量词且组外又跟量词，是 ReDoS 经典模式');
    suggestions.push('消除嵌套量词：用原子组 (?>...) 或占有量词 a++ 限制回溯（JavaScript 不支持时改写为等价线性模式）');
  }

  // 重叠分支 + 量词：捕获组内有交替分支且后跟量词
  // 示例：(a|a)*, (ab|a)*, (\d|\w)*
  const overlapAlt = /\(([^?][^)]*\|[^)]*)\)[+*{]/;
  if (overlapAlt.test(pattern)) {
    reasons.push('检测到交替分支 + 量词组合（如 (a|a)*、(ab|a)*），分支间存在重叠时可能产生回溯爆炸');
    suggestions.push('消除分支重叠：确保交替分支互斥，或提取公共前缀');
  }

  // 通配量词：. + . * [^x]+ 等
  // 示例：.+, .*, [^/]+
  const wildcardQuant = /\.|\[[^\]]+\][+*{]/;
  if (wildcardQuant.test(pattern) && /[+*{]/.test(pattern)) {
    // 进一步检查是否有量词作用于通配
    if (/\.[+*{]/.test(pattern) || /\[\^?\][+*{]/.test(pattern)) {
      reasons.push('检测到通配符 + 量词（如 .+、.*、[^x]+），在大输入上可能产生大量回溯');
      suggestions.push('用更具体的字符集替代通配符，如用 [^"\r\n]+ 替代 .+ 匹配带引号字符串');
    }
  }

  // 检查 \w+ \d+ 等量词后跟自身
  // 示例：\w+\w+（虽然罕见，但会产生回溯）
  const dupQuant = /(\\[wdDsS])[+*{].*?\1[+*{]/;
  if (dupQuant.test(pattern)) {
    reasons.push('检测到重复字符类量词（如 \\w+\\w+），相邻量词会产生回溯');
    suggestions.push('合并相邻量词：\\w+\\w+ → \\w+');
  }

  const risk: RiskLevel = reasons.length === 0 ? 'low' : reasons.length === 1 ? 'medium' : 'high';

  if (reasons.length === 0) {
    reasons.push('未检测到明显危险结构，正则模式相对安全');
    suggestions.push('仍建议用压力测试验证大输入下的实际表现');
  }

  return { risk, reasons, suggestions };
}

/**
 * 基准测试：执行 N 次正则匹配，统计耗时
 * 使用 performance.now() 获取高精度时间
 */
function runBenchmark(
  pattern: string,
  flags: string,
  testText: string,
  iterations: number,
): BenchmarkResult {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch (e) {
    return {
      ok: false,
      error: `正则编译失败：${(e as Error).message}`,
      iterations: 0,
      times: [],
      avg: 0,
      max: 0,
      min: 0,
      stdDev: 0,
      total: 0,
    };
  }

  const times: number[] = [];
  const isGlobal = flags.includes('g');
  const startTotal = performance.now();

  for (let i = 0; i < iterations; i++) {
    regex.lastIndex = 0;
    const start = performance.now();
    if (isGlobal) {
      // 全局匹配：遍历所有匹配项
      while (regex.test(testText)) {
        // 防止零宽匹配死循环
        if (regex.lastIndex === 0) break;
      }
    } else {
      regex.test(testText);
    }
    const end = performance.now();
    times.push(end - start);

    // 总耗时超过 2 秒中止（防止卡死）
    if (end - startTotal > SINGLE_TIMEOUT_MS) {
      break;
    }
  }

  const actualIterations = times.length;
  const sum = times.reduce((a, b) => a + b, 0);
  const avg = sum / actualIterations;
  const max = Math.max(...times);
  const min = Math.min(...times);
  const variance = times.reduce((a, b) => a + (b - avg) ** 2, 0) / actualIterations;
  const stdDev = Math.sqrt(variance);
  const total = performance.now() - startTotal;

  return {
    ok: true,
    iterations: actualIterations,
    times,
    avg,
    max,
    min,
    stdDev,
    total,
  };
}

/**
 * 渐进式压力测试：用递增长度输入测试，判断是否指数级增长
 * 长度序列：10, 20, 30, 40, 50
 * 指数增长判定：时间增长倍数 > 长度增长倍数 × 5，且最长耗时 > 10ms
 */
function runStressTest(
  pattern: string,
  flags: string,
  baseChar: string,
): StressResult {
  const points: StressPoint[] = [];
  const lengths = [10, 20, 30, 40, 50];
  let maxTime = 0;
  let aborted = false;
  let regex: RegExp;

  try {
    regex = new RegExp(pattern, flags);
  } catch {
    return { points: [], isExponential: false, maxTime: 0, aborted: true };
  }

  const isGlobal = flags.includes('g');

  for (const len of lengths) {
    if (len > MAX_STRESS_LENGTH) break;
    const testText = baseChar.repeat(len);
    regex.lastIndex = 0;
    const start = performance.now();
    let ok = true;
    try {
      if (isGlobal) {
        while (regex.test(testText)) {
          if (regex.lastIndex === 0) break;
        }
      } else {
        regex.test(testText);
      }
    } catch {
      ok = false;
    }
    const end = performance.now();
    const time = end - start;
    points.push({ length: len, time, ok });
    if (time > maxTime) maxTime = time;

    // 单次超过 1 秒中止
    if (time > 1000) {
      aborted = true;
      break;
    }
  }

  // 判断指数增长
  let isExponential = false;
  if (points.length >= 2) {
    const first = points[0];
    const last = points[points.length - 1];
    const lengthRatio = last.length / first.length;
    const timeRatio = last.time / (first.time || 0.001);
    if (timeRatio > lengthRatio * 5 && last.time > 10) {
      isExponential = true;
    }
  }

  return { points, isExponential, maxTime, aborted };
}

/** 格式化耗时：自动选择 μs/ms/s 单位 */
function formatTime(ms: number): string {
  if (ms < 0.001) return '0 ms';
  if (ms < 1) return `${(ms * 1000).toFixed(2)} μs`;
  if (ms < 1000) return `${ms.toFixed(3)} ms`;
  return `${(ms / 1000).toFixed(3)} s`;
}

/** 风险等级徽章文本与颜色 */
function riskBadge(risk: RiskLevel): { text: string; cls: string } {
  switch (risk) {
    case 'low':
      return { text: '低风险', cls: 'rbmtool__badge--low' };
    case 'medium':
      return { text: '中风险', cls: 'rbmtool__badge--medium' };
    case 'high':
      return { text: '高风险', cls: 'rbmtool__badge--high' };
  }
}

export default function RegexBenchmarkTool() {
  const [pattern, setPattern] = useState('');
  const [flags, setFlags] = useState('');
  const [testText, setTestText] = useState('');
  const [iterations, setIterations] = useState(DEFAULT_ITERATIONS);
  const [benchmark, setBenchmark] = useState<BenchmarkResult | null>(null);
  const [stress, setStress] = useState<StressResult | null>(null);
  const [running, setRunning] = useState(false);
  const [stressRunning, setStressRunning] = useState(false);

  // 静态分析：实时计算
  const analysis = useMemo(() => {
    if (!pattern.trim()) return null;
    return analyzeStatic(pattern);
  }, [pattern]);

  // 标志位切换
  const toggleFlag = useCallback((flag: Flag) => {
    setFlags((prev) => (prev.includes(flag) ? prev.replace(flag, '') : prev + flag));
  }, []);

  // 载入预设
  const loadPreset = useCallback((preset: typeof PRESETS[0]) => {
    setPattern(preset.pattern);
    setFlags(preset.flags);
    setTestText(preset.testText);
    setBenchmark(null);
    setStress(null);
  }, []);

  // 载入示例
  const loadSample = useCallback(() => {
    setPattern(SAMPLE_PATTERN);
    setFlags(SAMPLE_FLAGS);
    setTestText(SAMPLE_TEXT);
    setBenchmark(null);
    setStress(null);
  }, []);

  // 清空
  const handleClear = useCallback(() => {
    setPattern('');
    setFlags('');
    setTestText('');
    setBenchmark(null);
    setStress(null);
  }, []);

  // 执行基准测试
  const handleBenchmark = useCallback(() => {
    if (!pattern.trim()) return;
    if (testText.length > MAX_TEXT_LENGTH) return;
    setRunning(true);
    // 用 setTimeout 让 UI 先更新到 running 状态
    setTimeout(() => {
      const result = runBenchmark(pattern, flags, testText, iterations);
      setBenchmark(result);
      setRunning(false);
    }, 50);
  }, [pattern, flags, testText, iterations]);

  // 执行压力测试
  const handleStress = useCallback(() => {
    if (!pattern.trim()) return;
    setStressRunning(true);
    setTimeout(() => {
      // 用测试字符串的第一个字符作为基础字符，若为空则用 'a'
      const baseChar = testText[0] || 'a';
      const result = runStressTest(pattern, flags, baseChar);
      setStress(result);
      setStressRunning(false);
    }, 50);
  }, [pattern, flags, testText]);

  // 复制基准结果
  const handleCopy = useCallback(() => {
    if (!benchmark || !benchmark.ok) return;
    const text = [
      `正则: /${pattern}/${flags}`,
      `迭代: ${benchmark.iterations} 次`,
      `平均: ${formatTime(benchmark.avg)}`,
      `最大: ${formatTime(benchmark.max)}`,
      `最小: ${formatTime(benchmark.min)}`,
      `标准差: ${formatTime(benchmark.stdDev)}`,
      `总耗时: ${formatTime(benchmark.total)}`,
    ].join('\n');
    copyText(text);
  }, [benchmark, pattern, flags]);

  const textTooLong = testText.length > MAX_TEXT_LENGTH;

  return (
    <div className="rbmtool">
      {/* 输入区 */}
      <div className="rbmtool__input">
        <div className="rbmtool__field">
          <label htmlFor="rbmtool-pattern" className="rbmtool__label">正则表达式</label>
          <div className="rbmtool__regex-row">
            <span className="rbmtool__slash">/</span>
            <input
              id="rbmtool-pattern"
              type="text"
              className="rbmtool__input-box"
              value={pattern}
              onInput={(e) => setPattern((e.target as HTMLInputElement).value)}
              placeholder="输入正则表达式，如 ^(a+)+$"
              autoComplete="off"
              spellCheck="false"
            />
            <span className="rbmtool__slash">/</span>
            <input
              id="rbmtool-flags"
              type="text"
              className="rbmtool__flags-box"
              value={flags}
              onInput={(e) => setFlags((e.target as HTMLInputElement).value.replace(/[^gimsu]/g, ''))}
              placeholder="标志位"
              autoComplete="off"
              spellCheck="false"
              aria-label="标志位"
            />
          </div>
          <div className="rbmtool__flags" role="group" aria-label="标志位切换">
            {FLAG_LIST.map((f) => (
              <button
                key={f.flag}
                type="button"
                className={`rbmtool__flag${flags.includes(f.flag) ? ' rbmtool__flag--active' : ''}`}
                onClick={() => toggleFlag(f.flag)}
                aria-pressed={flags.includes(f.flag)}
                title={f.desc}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="rbmtool__field">
          <label htmlFor="rbmtool-text" className="rbmtool__label">
            测试字符串
            {testText.length > 0 && (
              <span className="rbmtool__count">{testText.length} 字符</span>
            )}
          </label>
          <textarea
            id="rbmtool-text"
            className="rbmtool__textarea"
            value={testText}
            onInput={(e) => setTestText((e.target as HTMLTextAreaElement).value)}
            placeholder="输入测试字符串（最长 10000 字符）"
            rows={4}
            spellCheck="false"
          />
          {textTooLong && (
            <p className="rbmtool__error">测试字符串超过 {MAX_TEXT_LENGTH} 字符上限，请缩短</p>
          )}
        </div>

        <div className="rbmtool__field">
          <label htmlFor="rbmtool-iter" className="rbmtool__label">基准测试迭代次数</label>
          <div className="rbmtool__iter-row">
            <input
              id="rbmtool-iter"
              type="number"
              className="rbmtool__iter-box"
              value={iterations}
              min={1}
              max={1000}
              onChange={(e) => {
                const v = parseInt((e.target as HTMLInputElement).value, 10);
                if (!isNaN(v) && v > 0 && v <= 1000) setIterations(v);
              }}
            />
            <span className="rbmtool__iter-hint">1-1000（推荐 100，过大可能卡顿）</span>
          </div>
        </div>

        <div className="rbmtool__actions">
          <button
            type="button"
            className="rbmtool__btn rbmtool__btn--primary"
            onClick={handleBenchmark}
            disabled={!pattern.trim() || running || textTooLong}
          >
            {running ? '基准测试中…' : '开始基准测试'}
          </button>
          <button
            type="button"
            className="rbmtool__btn"
            onClick={handleStress}
            disabled={!pattern.trim() || stressRunning}
          >
            {stressRunning ? '压力测试中…' : '渐进压力测试'}
          </button>
          <button type="button" className="rbmtool__btn" onClick={loadSample}>载入示例</button>
          <button type="button" className="rbmtool__btn" onClick={handleClear}>清空</button>
        </div>

        {/* 预设示例 */}
        <div className="rbmtool__presets">
          <span className="rbmtool__presets-label">预设示例：</span>
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              className="rbmtool__preset-btn"
              title={p.desc}
              onClick={() => loadPreset(p)}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* 结果区 */}
      <div className="rbmtool__result">
        {/* 静态分析 */}
        {analysis && (
          <div className="rbmtool__section">
            <h3 className="rbmtool__section-title">
              静态分析
              <span className={`rbmtool__badge ${riskBadge(analysis.risk).cls}`}>
                {riskBadge(analysis.risk).text}
              </span>
            </h3>
            <ul className="rbmtool__reasons">
              {analysis.reasons.map((r, i) => (
                <li key={i} className="rbmtool__reason">{r}</li>
              ))}
            </ul>
            <h4 className="rbmtool__sub-title">优化建议</h4>
            <ul className="rbmtool__suggestions">
              {analysis.suggestions.map((s, i) => (
                <li key={i} className="rbmtool__suggestion">{s}</li>
              ))}
            </ul>
          </div>
        )}

        {/* 基准测试结果 */}
        {benchmark && (
          <div className="rbmtool__section">
            <h3 className="rbmtool__section-title">
              基准测试结果
              <button type="button" className="rbmtool__copy-btn" onClick={handleCopy}>复制结果</button>
            </h3>
            {!benchmark.ok ? (
              <p className="rbmtool__error">{benchmark.error}</p>
            ) : (
              <>
                <div className="rbmtool__stats">
                  <div className="rbmtool__stat">
                    <span className="rbmtool__stat-label">迭代次数</span>
                    <span className="rbmtool__stat-value">{benchmark.iterations}</span>
                  </div>
                  <div className="rbmtool__stat">
                    <span className="rbmtool__stat-label">平均耗时</span>
                    <span className="rbmtool__stat-value rbmtool__stat-value--accent">{formatTime(benchmark.avg)}</span>
                  </div>
                  <div className="rbmtool__stat">
                    <span className="rbmtool__stat-label">最大耗时</span>
                    <span className="rbmtool__stat-value">{formatTime(benchmark.max)}</span>
                  </div>
                  <div className="rbmtool__stat">
                    <span className="rbmtool__stat-label">最小耗时</span>
                    <span className="rbmtool__stat-value">{formatTime(benchmark.min)}</span>
                  </div>
                  <div className="rbmtool__stat">
                    <span className="rbmtool__stat-label">标准差</span>
                    <span className="rbmtool__stat-value">{formatTime(benchmark.stdDev)}</span>
                  </div>
                  <div className="rbmtool__stat">
                    <span className="rbmtool__stat-label">总耗时</span>
                    <span className="rbmtool__stat-value">{formatTime(benchmark.total)}</span>
                  </div>
                </div>
                {/* 耗时分布条形图 */}
                {benchmark.times.length > 0 && (
                  <div className="rbmtool__chart" aria-label="每次迭代耗时分布">
                    <div className="rbmtool__chart-bars">
                      {benchmark.times.map((t, i) => {
                        const pct = benchmark.max > 0 ? (t / benchmark.max) * 100 : 0;
                        const isMax = t === benchmark.max;
                        return (
                          <div
                            key={i}
                            className={`rbmtool__bar${isMax ? ' rbmtool__bar--max' : ''}`}
                            style={{ height: `${Math.max(pct, 2)}%` }}
                            title={`#${i + 1}: ${formatTime(t)}`}
                          />
                        );
                      })}
                    </div>
                    <div className="rbmtool__chart-axis">
                      <span>第 1 次</span>
                      <span>第 {benchmark.times.length} 次</span>
                    </div>
                  </div>
                )}
                {benchmark.iterations < iterations && (
                  <p className="rbmtool__warn">
                    ⚠ 实际迭代 {benchmark.iterations} 次（少于设定的 {iterations} 次），因总耗时超过 {SINGLE_TIMEOUT_MS} ms 自动中止
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* 压力测试结果 */}
        {stress && (
          <div className="rbmtool__section">
            <h3 className="rbmtool__section-title">
              渐进压力测试
              {stress.isExponential ? (
                <span className="rbmtool__badge rbmtool__badge--high">指数增长</span>
              ) : stress.aborted ? (
                <span className="rbmtool__badge rbmtool__badge--high">已超时</span>
              ) : (
                <span className="rbmtool__badge rbmtool__badge--low">线性增长</span>
              )}
            </h3>
            {stress.points.length === 0 ? (
              <p className="rbmtool__error">压力测试失败：正则编译错误</p>
            ) : (
              <>
                <table className="rbmtool__table">
                  <thead>
                    <tr>
                      <th>输入长度</th>
                      <th>执行耗时</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stress.points.map((p, i) => (
                      <tr key={i}>
                        <td>{p.length} 字符</td>
                        <td>{formatTime(p.time)}</td>
                        <td>{p.ok ? '正常' : '异常'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {stress.isExponential && (
                  <p className="rbmtool__warn">
                    ⚠ 检测到指数级增长趋势！耗时增长倍数远大于输入长度增长倍数，存在 ReDoS 风险。
                    建议立即优化正则模式（参考静态分析建议）。
                  </p>
                )}
                {stress.aborted && !stress.isExponential && (
                  <p className="rbmtool__warn">
                    ⚠ 压力测试因单次耗时超过 1000 ms 中止，正则在长输入下性能急剧下降。
                  </p>
                )}
                {!stress.isExponential && !stress.aborted && (
                  <p className="rbmtool__info">
                    ✓ 耗时随输入长度线性增长，未检测到指数级回溯，正则相对安全。
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* 空状态 */}
        {!analysis && !benchmark && !stress && (
          <div className="rbmtool__empty">
            <p>输入正则表达式后点击「开始基准测试」或「渐进压力测试」</p>
            <p>或点击「载入示例」体验经典 ReDoS 模式</p>
          </div>
        )}
      </div>
    </div>
  );
}
