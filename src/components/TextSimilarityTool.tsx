import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * 文本相似度对比工具
 *
 * 全部在浏览器本地处理，零依赖、零网络请求。
 *
 * 核心算法：
 *  - Levenshtein 编辑距离：动态规划 O(m×n)，计算两段文本间的最少编辑操作数
 *  - 相似度比率：1 - distance / max(lenA, lenB)，范围 0~1
 *  - Jaccard 相似度：分词后 |交集| / |并集|，衡量词汇重叠度
 *  - 最长公共子序列（LCS）：衡量结构相似性
 *
 * 功能：
 *  - 双栏文本输入，实时计算四种相似度指标
 *  - 三个选项：大小写敏感、忽略首尾空白、忽略空行
 *  - 差异高亮：基于 LCS 标注两段文本的公共部分与差异部分
 *  - 一键载入示例 / 清空 / 复制报告
 */

/** 预处理选项 */
interface PreprocessOptions {
  caseSensitive: boolean;
  trimWhitespace: boolean;
  ignoreEmptyLines: boolean;
}

/** 预处理文本：按选项规范化 */
function preprocess(text: string, opts: PreprocessOptions): string {
  let result = text;
  if (opts.ignoreEmptyLines) {
    result = result
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .join('\n');
  }
  if (opts.trimWhitespace) {
    result = result
      .split(/\r?\n/)
      .map((line) => line.trim())
      .join('\n')
      .replace(/[ \t]+/g, ' ');
  }
  if (!opts.caseSensitive) {
    result = result.toLowerCase();
  }
  return result;
}

/**
 * Levenshtein 编辑距离（动态规划）
 * 使用滚动数组优化空间至 O(min(m, n))
 * 返回将 a 转换为 b 所需的最少单字符编辑（插入/删除/替换）次数
 */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // 确保 b 是较短的字符串，减少空间占用
  if (a.length < b.length) {
    [a, b] = [b, a];
  }

  const bLen = b.length;
  // 滚动数组：只保留当前行和上一行
  let prev = new Array<number>(bLen + 1);
  let curr = new Array<number>(bLen + 1);

  for (let j = 0; j <= bLen; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // 删除
        curr[j - 1] + 1, // 插入
        prev[j - 1] + cost, // 替换（或匹配）
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[bLen];
}

/**
 * 分词：按非字母数字字符分割，支持 Unicode
 * 用于 Jaccard 相似度计算
 */
function tokenize(text: string): Set<string> {
  // \p{L} 字母、\p{N} 数字，Unicode 属性转义
  const tokens = text.match(/[\p{L}\p{N}]+/gu);
  return new Set(tokens ?? []);
}

/**
 * Jaccard 相似度：|A ∩ B| / |A ∪ B|
 * 范围 0~1，1 表示完全相同的词汇集合
 */
function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * 最长公共子序列（LCS）长度
 * 动态规划 O(m×n)，用于衡量结构相似性
 */
function lcsLength(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;

  const m = a.length;
  const n = b.length;
  // 滚动数组优化
  let prev = new Array<number>(n + 1).fill(0);
  let curr = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }

  return prev[n];
}

/** 差异片段类型 */
type DiffSegmentType = 'equal' | 'added' | 'removed';

/** 差异片段：用于字符级高亮 */
interface DiffSegment {
  type: DiffSegmentType;
  text: string;
}

/**
 * 基于 LCS 生成字符级差异片段
 * 将两段文本按公共子序列切分为 equal/added/removed 片段
 */
function generateCharDiff(a: string, b: string): { left: DiffSegment[]; right: DiffSegment[] } {
  if (a.length === 0 && b.length === 0) {
    return { left: [], right: [] };
  }
  if (a.length === 0) {
    return { left: [], right: [{ type: 'added', text: b }] };
  }
  if (b.length === 0) {
    return { left: [{ type: 'removed', text: a }], right: [] };
  }

  // 构建 LCS 完整 DP 表（不做空间优化，需要回溯路径）
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // 回溯生成差异片段
  const leftSegs: DiffSegment[] = [];
  const rightSegs: DiffSegment[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      // 公共字符
      leftSegs.unshift({ type: 'equal', text: a[i - 1] });
      rightSegs.unshift({ type: 'equal', text: b[j - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      // b 中新增的字符
      rightSegs.unshift({ type: 'added', text: b[j - 1] });
      j--;
    } else {
      // a 中删除的字符
      leftSegs.unshift({ type: 'removed', text: a[i - 1] });
      i--;
    }
  }

  // 合并相邻同类型片段，减少 DOM 节点
  return {
    left: mergeSegments(leftSegs),
    right: mergeSegments(rightSegs),
  };
}

/** 合并相邻同类型差异片段 */
function mergeSegments(segs: DiffSegment[]): DiffSegment[] {
  if (segs.length === 0) return [];
  const merged: DiffSegment[] = [{ ...segs[0] }];
  for (let k = 1; k < segs.length; k++) {
    const last = merged[merged.length - 1];
    if (last.type === segs[k].type) {
      last.text += segs[k].text;
    } else {
      merged.push({ ...segs[k] });
    }
  }
  return merged;
}

/** 示例文本 A */
const SAMPLE_A = `今天天气真好，适合出门散步。
公园里的花开得很漂亮，有玫瑰、百合和向日葵。
小明和小红一起去湖边喂鸽子。
他们在草地上铺了野餐垫，吃了三明治和水果。`;

/** 示例文本 B */
const SAMPLE_B = `今天天气很好，适合出门散步。
公园里的花开得很美丽，有玫瑰、百合和郁金香。
小明和小华一起去湖边喂鸭子。
他们在草地上铺了野餐垫，吃了三明治和蛋糕。`;

/** 相似度等级判定 */
function similarityLevel(ratio: number): { label: string; color: string } {
  if (ratio >= 0.9) return { label: '高度相似', color: 'var(--color-success)' };
  if (ratio >= 0.7) return { label: '较为相似', color: 'var(--color-primary)' };
  if (ratio >= 0.4) return { label: '部分相似', color: 'var(--color-warning)' };
  return { label: '差异较大', color: 'var(--color-danger)' };
}

export default function TextSimilarityTool() {
  const [textA, setTextA] = useState('');
  const [textB, setTextB] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [trimWhitespace, setTrimWhitespace] = useState(false);
  const [ignoreEmptyLines, setIgnoreEmptyLines] = useState(false);
  const [showDiff, setShowDiff] = useState(true);
  const [copyStatus, setCopyStatus] = useState('');

  const opts: PreprocessOptions = { caseSensitive, trimWhitespace, ignoreEmptyLines };

  // 实时计算相似度指标
  const results = useMemo(() => {
    if (!textA && !textB) return null;

    const processedA = preprocess(textA, opts);
    const processedB = preprocess(textB, opts);

    const maxLen = Math.max(processedA.length, processedB.length);
    const distance = levenshteinDistance(processedA, processedB);
    const ratio = maxLen === 0 ? 1 : 1 - distance / maxLen;
    const jaccard = jaccardSimilarity(processedA, processedB);
    const lcs = lcsLength(processedA, processedB);
    const lcsRatio = maxLen === 0 ? 1 : lcs / maxLen;

    const diff = showDiff ? generateCharDiff(processedA, processedB) : null;
    const level = similarityLevel(ratio);

    return {
      distance,
      ratio,
      jaccard,
      lcs,
      lcsRatio,
      diff,
      level,
      lenA: processedA.length,
      lenB: processedB.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textA, textB, caseSensitive, trimWhitespace, ignoreEmptyLines, showDiff]);

  // 复制相似度报告
  const handleCopyReport = useCallback(async () => {
    if (!results) return;
    const report = [
      '文本相似度对比报告',
      '==================',
      `文本 A 长度：${results.lenA} 字符`,
      `文本 B 长度：${results.lenB} 字符`,
      '',
      `Levenshtein 编辑距离：${results.distance}`,
      `相似度比率：${(results.ratio * 100).toFixed(2)}%（${results.level.label}）`,
      `Jaccard 相似度：${(results.jaccard * 100).toFixed(2)}%`,
      `最长公共子序列长度：${results.lcs}`,
      `LCS 相似度：${(results.lcsRatio * 100).toFixed(2)}%`,
      '',
      `选项：${caseSensitive ? '大小写敏感' : '忽略大小写'} | ${
        trimWhitespace ? '去除首尾空白' : '保留空白'
      } | ${ignoreEmptyLines ? '忽略空行' : '保留空行'}`,
    ].join('\n');

    const ok = await copyText(report);
    setCopyStatus(ok ? '已复制' : '复制失败');
    setTimeout(() => setCopyStatus(''), 1500);
  }, [results, caseSensitive, trimWhitespace, ignoreEmptyLines]);

  const handleLoadSample = useCallback(() => {
    setTextA(SAMPLE_A);
    setTextB(SAMPLE_B);
  }, []);

  const handleClear = useCallback(() => {
    setTextA('');
    setTextB('');
  }, []);

  const handleSwap = useCallback(() => {
    setTextA(textB);
    setTextB(textA);
  }, [textA, textB]);

  return (
    <div className="simtool">
      {/* 工具栏 */}
      <div className="simtool__toolbar">
        <div className="simtool__actions">
          <button className="btn btn--sm" onClick={handleLoadSample}>
            载入示例
          </button>
          <button className="btn btn--sm" onClick={handleSwap} disabled={!textA && !textB}>
            交换 A/B
          </button>
          <button className="btn btn--sm" onClick={handleClear} disabled={!textA && !textB}>
            清空
          </button>
          <button className="btn btn--sm" onClick={handleCopyReport} disabled={!results}>
            {copyStatus || '复制报告'}
          </button>
        </div>
      </div>

      {/* 双栏输入 */}
      <div className="simtool__inputs">
        <div className="simtool__input-group">
          <label className="simtool__label">
            文本 A
            <span className="simtool__stat">{textA.length} 字符</span>
          </label>
          <textarea
            className="simtool__textarea"
            placeholder="输入第一段文本..."
            value={textA}
            onChange={(e) => setTextA(e.currentTarget.value)}
            spellCheck={false}
          />
        </div>
        <div className="simtool__input-group">
          <label className="simtool__label">
            文本 B
            <span className="simtool__stat">{textB.length} 字符</span>
          </label>
          <textarea
            className="simtool__textarea"
            placeholder="输入第二段文本..."
            value={textB}
            onChange={(e) => setTextB(e.currentTarget.value)}
            spellCheck={false}
          />
        </div>
      </div>

      {/* 选项区 */}
      <div className="simtool__options">
        <label className="simtool__option">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.currentTarget.checked)}
          />
          <span>大小写敏感</span>
        </label>
        <label className="simtool__option">
          <input
            type="checkbox"
            checked={trimWhitespace}
            onChange={(e) => setTrimWhitespace(e.currentTarget.checked)}
          />
          <span>去除首尾空白</span>
        </label>
        <label className="simtool__option">
          <input
            type="checkbox"
            checked={ignoreEmptyLines}
            onChange={(e) => setIgnoreEmptyLines(e.currentTarget.checked)}
          />
          <span>忽略空行</span>
        </label>
        <label className="simtool__option">
          <input
            type="checkbox"
            checked={showDiff}
            onChange={(e) => setShowDiff(e.currentTarget.checked)}
          />
          <span>显示差异高亮</span>
        </label>
      </div>

      {/* 结果区 */}
      {results ? (
        <div className="simtool__results">
          {/* 相似度总览 */}
          <div className="simtool__overview">
            <div className="simtool__score" style={{ color: results.level.color }}>
              <span className="simtool__score-value">{(results.ratio * 100).toFixed(1)}%</span>
              <span className="simtool__score-label">{results.level.label}</span>
            </div>
            <div className="simtool__metrics">
              <div className="simtool__metric">
                <span className="simtool__metric-label">Levenshtein 编辑距离</span>
                <span className="simtool__metric-value">{results.distance}</span>
              </div>
              <div className="simtool__metric">
                <span className="simtool__metric-label">Jaccard 相似度</span>
                <span className="simtool__metric-value">
                  {(results.jaccard * 100).toFixed(1)}%
                </span>
              </div>
              <div className="simtool__metric">
                <span className="simtool__metric-label">最长公共子序列</span>
                <span className="simtool__metric-value">{results.lcs}</span>
              </div>
              <div className="simtool__metric">
                <span className="simtool__metric-label">LCS 相似度</span>
                <span className="simtool__metric-value">{(results.lcsRatio * 100).toFixed(1)}%</span>
              </div>
            </div>
          </div>

          {/* 差异高亮 */}
          {showDiff && results.diff && (textA || textB) && (
            <div className="simtool__diff">
              <div className="simtool__diff-panel">
                <div className="simtool__diff-header">文本 A（删除部分标红）</div>
                <div className="simtool__diff-content">
                  {results.diff.left.length > 0 ? (
                    results.diff.left.map((seg, idx) => (
                      <span key={idx} className={`simtool__diff-seg simtool__diff-seg--${seg.type}`}>
                        {seg.text}
                      </span>
                    ))
                  ) : (
                    <span className="simtool__diff-empty">（空）</span>
                  )}
                </div>
              </div>
              <div className="simtool__diff-panel">
                <div className="simtool__diff-header">文本 B（新增部分标绿）</div>
                <div className="simtool__diff-content">
                  {results.diff.right.length > 0 ? (
                    results.diff.right.map((seg, idx) => (
                      <span key={idx} className={`simtool__diff-seg simtool__diff-seg--${seg.type}`}>
                        {seg.text}
                      </span>
                    ))
                  ) : (
                    <span className="simtool__diff-empty">（空）</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="simtool__empty">
          <p>在上方输入两段文本，即可实时计算相似度。</p>
          <p>支持 Levenshtein 编辑距离、Jaccard 相似度、最长公共子序列三种算法。</p>
        </div>
      )}
    </div>
  );
}
