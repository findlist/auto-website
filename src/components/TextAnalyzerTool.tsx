import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * 文本统计分析工具
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 实时统计：总字符数、不含空格字符数、中文字符、英文字母、数字、标点
 *  - 词数统计：英文单词数 + 中文字数
 *  - 结构统计：行数、段落数、句子数
 *  - 阅读时间估算（中文 300 字/分 + 英文 200 词/分）
 *  - 关键词频率 Top 10（英文按单词、中文按 2 字词组）
 *
 * 适用场景：
 *  - 文章字数统计、稿费计算、排版规划
 *  - SEO 内容长度检查、Meta Description 字数控制
 *  - 阅读时间估算、内容质量评估
 *  - 关键词密度分析、内容主题识别
 */

/** 统计结果 */
interface TextStats {
  totalChars: number;
  charsNoSpace: number;
  chineseChars: number;
  englishChars: number;
  digitChars: number;
  punctuation: number;
  words: number;
  lines: number;
  paragraphs: number;
  sentences: number;
  readingTimeSec: number;
  topKeywords: Array<{ word: string; count: number }>;
}

/** 中文标点 + 英文标点 */
const PUNCTUATION_RE = /[，。！？；：、""''（）【】《》—…·,\.!?;:"'()\[\]{}<>@#$%^&*\-_=+|\\\/`~]/;

/** 英文停用词（频率分析时过滤） */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that',
  'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'as', 'if', 'then', 'than', 'so', 'not', 'no', 'yes', 'my', 'your',
]);

/** 分析文本，返回完整统计结果 */
function analyzeText(text: string): TextStats {
  if (!text) {
    return {
      totalChars: 0, charsNoSpace: 0, chineseChars: 0, englishChars: 0,
      digitChars: 0, punctuation: 0, words: 0, lines: 0, paragraphs: 0,
      sentences: 0, readingTimeSec: 0, topKeywords: [],
    };
  }

  // 字符分类统计
  let chineseChars = 0, englishChars = 0, digitChars = 0, punctuation = 0, charsNoSpace = 0;
  for (const ch of text) {
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue;
    charsNoSpace++;
    const code = ch.codePointAt(0)!;
    if (code >= 0x4e00 && code <= 0x9fff) chineseChars++;
    else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) englishChars++;
    else if (code >= 0x30 && code <= 0x39) digitChars++;
    else if (PUNCTUATION_RE.test(ch)) punctuation++;
  }

  // 词数：英文单词数 + 中文字数（中文逐字计）
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  const words = englishWords + chineseChars;

  // 行数与段落数
  const lines = text === '' ? 0 : text.split('\n').length;
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;

  // 句子数：按中英文句末标点分割
  const sentences = text
    .split(/[。！？.!?]+/)
    .filter((s) => s.trim().length > 0).length;

  // 阅读时间：中文 300 字/分 + 英文 200 词/分，取较长者
  const cnSec = (chineseChars / 300) * 60;
  const enSec = (englishWords / 200) * 60;
  const readingTimeSec = Math.round(Math.max(cnSec, enSec));

  // 关键词频率 Top 10
  const freqMap = new Map<string, number>();
  // 英文单词（过滤停用词与 2 字以下短词）
  const enMatches = text.toLowerCase().match(/[a-zA-Z]{2,}/g) || [];
  for (const w of enMatches) {
    if (!STOP_WORDS.has(w)) freqMap.set(w, (freqMap.get(w) || 0) + 1);
  }
  // 中文 2 字词组滑窗
  const cnText = text.replace(/[^\u4e00-\u9fff]/g, ' ');
  const cnSegments = cnText.split(/\s+/).filter((s) => s.length >= 2);
  for (const seg of cnSegments) {
    for (let i = 0; i <= seg.length - 2; i++) {
      const bigram = seg.slice(i, i + 2);
      freqMap.set(bigram, (freqMap.get(bigram) || 0) + 1);
    }
  }
  // 仅保留出现 ≥ 2 次的词，按频率降序取 Top 10
  const topKeywords = Array.from(freqMap.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => ({ word, count }));

  return {
    totalChars: text.length, charsNoSpace, chineseChars, englishChars,
    digitChars, punctuation, words, lines, paragraphs, sentences,
    readingTimeSec, topKeywords,
  };
}

/** 格式化阅读时间为可读文本 */
function formatReadingTime(sec: number): string {
  if (sec < 60) return `${sec} 秒`;
  const min = Math.floor(sec / 60);
  const remainSec = sec % 60;
  return remainSec > 0 ? `${min} 分 ${remainSec} 秒` : `${min} 分钟`;
}

/** 格式化数字（千分位） */
function formatNum(n: number): string {
  return n.toLocaleString('zh-CN');
}

const SAMPLE_TEXT = `文本统计分析工具可以帮助你快速了解文本的基本特征。

输入任意中文或英文文本，工具会实时计算字符数、词数、行数、段落数、句子数，并估算阅读时间。关键词频率分析功能可以帮你识别文本的主题词。

The quick brown fox jumps over the lazy dog. This tool analyzes text in real-time, providing character counts, word counts, and keyword frequency analysis. The quick brown fox is a common pangram example.`;

export default function TextAnalyzerTool() {
  const [input, setInput] = useState('');
  // copyStatus: null=未操作, true=成功, false=失败
  const [copyStatus, setCopyStatus] = useState<boolean | null>(null);

  // 实时统计分析（useMemo 避免每次渲染重复计算）
  const stats = useMemo(() => analyzeText(input), [input]);

  // 复制统计结果
  const handleCopy = useCallback(async () => {
    const report = [
      '文本统计分析报告',
      '==================',
      `总字符数（含空格）：${formatNum(stats.totalChars)}`,
      `字符数（不含空格）：${formatNum(stats.charsNoSpace)}`,
      `中文字符：${formatNum(stats.chineseChars)}`,
      `英文字母：${formatNum(stats.englishChars)}`,
      `数字字符：${formatNum(stats.digitChars)}`,
      `标点符号：${formatNum(stats.punctuation)}`,
      `词数：${formatNum(stats.words)}`,
      `行数：${formatNum(stats.lines)}`,
      `段落数：${formatNum(stats.paragraphs)}`,
      `句子数：${formatNum(stats.sentences)}`,
      `阅读时间：${formatReadingTime(stats.readingTimeSec)}`,
    ].join('\n');
    const ok = await copyText(report);
    setCopyStatus(ok);
    setTimeout(() => setCopyStatus(null), 2000);
  }, [stats]);

  const handleClear = useCallback(() => setInput(''), []);
  const handleSample = useCallback(() => setInput(SAMPLE_TEXT), []);

  const isEmpty = input.length === 0;

  return (
    <div className="text-analyzer">
      {/* 输入区 */}
      <div className="text-analyzer__input-section">
        <div className="text-analyzer__toolbar">
          <label className="text-analyzer__label" htmlFor="text-input">
            输入文本
          </label>
          <div className="text-analyzer__actions">
            <button
              className="text-analyzer__btn"
              onClick={handleSample}
              disabled={false}
            >
              示例文本
            </button>
            <button
              className="text-analyzer__btn"
              onClick={handleClear}
              disabled={isEmpty}
            >
              清空
            </button>
            <button
              className="text-analyzer__btn text-analyzer__btn--primary"
              onClick={handleCopy}
              disabled={isEmpty}
            >
              {copyStatus === true ? '已复制' : copyStatus === false ? '复制失败' : '复制报告'}
            </button>
          </div>
        </div>
        <textarea
          id="text-input"
          className="text-analyzer__textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="在此输入或粘贴要分析的文本…"
          spellCheck={false}
          aria-label="文本输入区"
        />
      </div>

      {/* 统计结果 */}
      <div className="text-analyzer__results">
        {/* 核心指标卡片 */}
        <div className="text-analyzer__metrics-grid">
          <div className="text-analyzer__metric">
            <span className="text-analyzer__metric-value">{formatNum(stats.totalChars)}</span>
            <span className="text-analyzer__metric-label">总字符数</span>
          </div>
          <div className="text-analyzer__metric">
            <span className="text-analyzer__metric-value">{formatNum(stats.charsNoSpace)}</span>
            <span className="text-analyzer__metric-label">不含空格</span>
          </div>
          <div className="text-analyzer__metric">
            <span className="text-analyzer__metric-value">{formatNum(stats.words)}</span>
            <span className="text-analyzer__metric-label">词数</span>
          </div>
          <div className="text-analyzer__metric">
            <span className="text-analyzer__metric-value">{formatReadingTime(stats.readingTimeSec)}</span>
            <span className="text-analyzer__metric-label">阅读时间</span>
          </div>
        </div>

        {/* 详细统计 */}
        <div className="text-analyzer__detail-grid">
          <h3 className="text-analyzer__section-title">字符分布</h3>
          <div className="text-analyzer__detail-table">
            <div className="text-analyzer__detail-row">
              <span className="text-analyzer__detail-label">中文字符</span>
              <span className="text-analyzer__detail-value">{formatNum(stats.chineseChars)}</span>
            </div>
            <div className="text-analyzer__detail-row">
              <span className="text-analyzer__detail-label">英文字母</span>
              <span className="text-analyzer__detail-value">{formatNum(stats.englishChars)}</span>
            </div>
            <div className="text-analyzer__detail-row">
              <span className="text-analyzer__detail-label">数字字符</span>
              <span className="text-analyzer__detail-value">{formatNum(stats.digitChars)}</span>
            </div>
            <div className="text-analyzer__detail-row">
              <span className="text-analyzer__detail-label">标点符号</span>
              <span className="text-analyzer__detail-value">{formatNum(stats.punctuation)}</span>
            </div>
          </div>

          <h3 className="text-analyzer__section-title">结构统计</h3>
          <div className="text-analyzer__detail-table">
            <div className="text-analyzer__detail-row">
              <span className="text-analyzer__detail-label">行数</span>
              <span className="text-analyzer__detail-value">{formatNum(stats.lines)}</span>
            </div>
            <div className="text-analyzer__detail-row">
              <span className="text-analyzer__detail-label">段落数</span>
              <span className="text-analyzer__detail-value">{formatNum(stats.paragraphs)}</span>
            </div>
            <div className="text-analyzer__detail-row">
              <span className="text-analyzer__detail-label">句子数</span>
              <span className="text-analyzer__detail-value">{formatNum(stats.sentences)}</span>
            </div>
          </div>

          {/* 关键词频率 */}
          <h3 className="text-analyzer__section-title">关键词频率 Top 10</h3>
          {stats.topKeywords.length === 0 ? (
            <p className="text-analyzer__empty">
              {isEmpty ? '输入文本后显示关键词频率分析' : '暂无出现 ≥ 2 次的关键词'}
            </p>
          ) : (
            <div className="text-analyzer__keywords">
              {stats.topKeywords.map((kw, i) => (
                <div key={i} className="text-analyzer__keyword-item">
                  <span className="text-analyzer__keyword-word">{kw.word}</span>
                  <span className="text-analyzer__keyword-bar" style={{ width: `${(kw.count / stats.topKeywords[0].count) * 100}%` }} />
                  <span className="text-analyzer__keyword-count">{kw.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
