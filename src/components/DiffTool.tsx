import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * 文本对比工具（Diff）
 *
 * 全部在浏览器本地处理，零依赖。
 *
 * 核心算法：
 *  - 行级 diff：LCS（最长公共子序列）动态规划，O(m×n) 时间与空间
 *
 * 功能：
 *  - 双栏文本输入（左原文 / 右修改后）
 *  - 视图切换：分屏对比 / 统一 diff
 *  - 大小写敏感、忽略首尾空白、忽略空行 三个开关
 *  - 实时统计：新增 / 删除 / 修改行数 + 相似度百分比
 *  - 一键载入示例 / 交换左右 / 清空 / 复制统一 diff 结果
 */

type LineType = 'equal' | 'insert' | 'delete';

/** 差异片段：用于修改块内对 delete/insert 行做更细粒度高亮（字符级 / 词级共用） */
type CharType = 'equal' | 'insert' | 'delete';

interface CharOp {
  type: CharType;
  text: string;
}

/** 行内高亮模式：无 / 字符级 / 词级（Git --word-diff 风格） */
type HighlightMode = 'none' | 'char' | 'word';

interface LineOp {
  type: LineType;
  // 行内容（equal 时左右相同，delete 时取 left，insert 时取 right）
  leftLine?: string;
  rightLine?: string;
  // 字符级差异：仅修改块中的 delete/insert 行有值，用于行内字符高亮
  charDiff?: CharOp[];
  // 词级差异：以单词/标点为单元（Unicode 感知），粒度介于行级与字符级之间
  wordDiff?: CharOp[];
}

type ViewMode = 'split' | 'unified';

/** 单行字符级 diff 的最大长度保护：超过则降级为整行高亮，避免 O(m×n) 卡顿 */
const CHAR_DIFF_MAX = 1000;

/** 左侧示例文本：模拟配置文件 v1 版本 */
const SAMPLE_LEFT = `# 应用配置 v1.0
app_name: 工具盒子
version: 1.0.0
port: 3000
debug: true

database:
  host: localhost
  port: 5432
  name: toolbox
  pool_size: 10

features:
  - json
  - base64
  - uuid
logging:
  level: info`;

/** 右侧示例文本：模拟配置文件 v2 版本 */
const SAMPLE_RIGHT = `# 应用配置 v2.0
app_name: 工具盒子
version: 2.0.0
port: 8080
debug: false

database:
  host: db.example.com
  port: 5432
  name: toolbox_prod
  pool_size: 50
  ssl: true

features:
  - json
  - base64
  - uuid
  - hash
  - jwt
logging:
  level: warn`;

/** 规范化行：根据开关预处理行字符串，用于相等比较 */
function normalizeLine(line: string, opts: { caseSensitive: boolean; trimWhitespace: boolean }): string {
  let s = line;
  if (opts.trimWhitespace) s = s.trim();
  if (!opts.caseSensitive) s = s.toLowerCase();
  return s;
}

/** 行级 LCS diff：返回操作序列（equal/insert/delete） */
function computeLineDiff(
  leftLines: string[],
  rightLines: string[],
  opts: { caseSensitive: boolean; trimWhitespace: boolean; ignoreEmptyLines: boolean },
): LineOp[] {
  // 预处理：规范化后用于比较，原始行用于显示
  const normLeft = leftLines.map((l) => normalizeLine(l, opts));
  const normRight = rightLines.map((l) => normalizeLine(l, opts));

  // 可选过滤空行（仅比较时忽略，显示时也忽略）
  const leftIdx = normLeft
    .map((_, i) => i)
    .filter((i) => !(opts.ignoreEmptyLines && normLeft[i] === ''));
  const rightIdx = normRight
    .map((_, i) => i)
    .filter((i) => !(opts.ignoreEmptyLines && normRight[i] === ''));

  const m = leftIdx.length;
  const n = rightIdx.length;
  // dp[i][j] = leftIdx[0..i) 与 rightIdx[0..j) 的 LCS 长度
  // 用 Uint32Array 替代普通数组，内存更紧凑（大文本时优势明显）
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (normLeft[leftIdx[i - 1]] === normRight[rightIdx[j - 1]]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // 回溯生成操作序列（自底向上，最后反转）
  const ops: LineOp[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && normLeft[leftIdx[i - 1]] === normRight[rightIdx[j - 1]]) {
      const li = leftIdx[i - 1];
      ops.push({ type: 'equal', leftLine: leftLines[li], rightLine: rightLines[rightIdx[j - 1]] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'insert', rightLine: rightLines[rightIdx[j - 1]] });
      j--;
    } else {
      ops.push({ type: 'delete', leftLine: leftLines[leftIdx[i - 1]] });
      i--;
    }
  }
  ops.reverse();
  return ops;
}

/**
 * 通用 LCS diff：接收任意 token 数组，返回差异片段序列。
 * 字符级与词级共用此实现，仅切分单元不同（字符 / 单词+标点）。
 */
function lcsDiff(aTokens: string[], bTokens: string[]): CharOp[] {
  const m = aTokens.length;
  const n = bTokens.length;

  if (m === 0) return bTokens.length ? [{ type: 'insert', text: bTokens.join('') }] : [];
  if (n === 0) return aTokens.length ? [{ type: 'delete', text: aTokens.join('') }] : [];

  // LCS DP（Uint32Array 节省内存，大文本时优势明显）
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (aTokens[i - 1] === bTokens[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // 回溯生成操作序列
  const raw: CharOp[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aTokens[i - 1] === bTokens[j - 1]) {
      raw.push({ type: 'equal', text: aTokens[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      raw.push({ type: 'insert', text: bTokens[j - 1] });
      j--;
    } else {
      raw.push({ type: 'delete', text: aTokens[i - 1] });
      i--;
    }
  }
  raw.reverse();

  // 合并相邻同类型片段，减少渲染节点数
  const merged: CharOp[] = [];
  for (const op of raw) {
    const last = merged[merged.length - 1];
    if (last && last.type === op.type) {
      last.text += op.text;
    } else {
      merged.push({ type: op.type, text: op.text });
    }
  }
  return merged;
}

/**
 * 字符级 LCS diff：对两行字符串做更细粒度的差异计算。
 * 用于修改块内（相邻 delete + insert 行对）高亮"被删除/被新增"的字符段。
 *
 * 性能保护：单行长度超过 CHAR_DIFF_MAX 时降级为整段高亮，避免 O(m×n) 卡顿。
 * 使用 Array.from 切分字符串以正确处理 Unicode 代理对（如 emoji）。
 */
function computeCharDiff(a: string, b: string): CharOp[] {
  // 性能保护：超长行降级为整段高亮
  if (a.length > CHAR_DIFF_MAX || b.length > CHAR_DIFF_MAX) {
    const out: CharOp[] = [];
    if (a) out.push({ type: 'delete', text: a });
    if (b) out.push({ type: 'insert', text: b });
    return out;
  }
  // 用 Array.from 切分以正确处理 Unicode 代理对（emoji 等）
  return lcsDiff(Array.from(a), Array.from(b));
}

/**
 * Unicode 感知的词级切分：将字符串拆为「空白 / 字母数字 / 标点符号」三类 token。
 * 使用 \p{L}（字母）与 \p{N}（数字）覆盖中文、日文等非 ASCII 字符。
 * 例如 "version: 1.0.0" → ["version", ":", " ", "1", ".", "0", ".", "0"]。
 */
function splitWords(s: string): string[] {
  // u 标志启用 Unicode 模式，\p{L} 与 \p{N} 才能识别 Unicode 字母数字
  return s.match(/\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]+/gu) ?? [];
}

/**
 * 词级 LCS diff：以单词 / 标点为单元计算差异，类似 Git --word-diff。
 * 粒度介于行级与字符级之间：既能精确标记被修改的词，又不会因逐字符比较而过于细碎。
 * 性能保护与字符级一致：单行超过 CHAR_DIFF_MAX 时降级为整段高亮。
 */
function computeWordDiff(a: string, b: string): CharOp[] {
  // 性能保护：超长行降级为整段高亮
  if (a.length > CHAR_DIFF_MAX || b.length > CHAR_DIFF_MAX) {
    const out: CharOp[] = [];
    if (a) out.push({ type: 'delete', text: a });
    if (b) out.push({ type: 'insert', text: b });
    return out;
  }
  return lcsDiff(splitWords(a), splitWords(b));
}

/**
 * 为相邻的 delete + insert 行对（修改块）附加行内差异。
 * 配对数取 delete 块与 insert 块长度的较小值，多余行整体高亮。
 * 配对行共享同一份 diff，渲染时按行类型过滤显示 delete 或 insert 段。
 * 字符级与词级共用此实现，仅 compute 函数与字段不同。
 */
function attachInlineDiff(
  ops: LineOp[],
  compute: (a: string, b: string) => CharOp[],
  field: 'charDiff' | 'wordDiff',
): LineOp[] {
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type !== 'delete') {
      i++;
      continue;
    }
    // 收集连续 delete 块
    const delStart = i;
    while (i < ops.length && ops[i].type === 'delete') i++;
    const delEnd = i;
    // 紧跟的连续 insert 块
    const insStart = i;
    while (i < ops.length && ops[i].type === 'insert') i++;
    const insEnd = i;

    const delCount = delEnd - delStart;
    const insCount = insEnd - insStart;
    const pairCount = Math.min(delCount, insCount);
    for (let k = 0; k < pairCount; k++) {
      const delOp = ops[delStart + k];
      const insOp = ops[insStart + k];
      // 共享同一份 diff，渲染时按行类型过滤
      const diff = compute(delOp.leftLine ?? '', insOp.rightLine ?? '');
      delOp[field] = diff;
      insOp[field] = diff;
    }
  }
  return ops;
}

/** 附加字符级差异（按字符切分） */
function attachCharDiff(ops: LineOp[]): LineOp[] {
  return attachInlineDiff(ops, computeCharDiff, 'charDiff');
}

/** 附加词级差异（按单词/标点切分，Git --word-diff 风格） */
function attachWordDiff(ops: LineOp[]): LineOp[] {
  return attachInlineDiff(ops, computeWordDiff, 'wordDiff');
}

/** 统计信息 */
interface DiffStats {
  equal: number;
  insert: number;
  delete: number;
  // 修改行数：相邻 delete+insert 配对计数（粗略，统计行内修改）
  modify: number;
  similarity: number; // 0-100 相似度百分比
}

function computeStats(ops: LineOp[]): DiffStats {
  let equal = 0;
  let insert = 0;
  let delete_ = 0;
  // 修改行数：遍历 ops，若当前位置是 delete 且下一个是 insert（或反之），算作 1 次修改
  let modify = 0;
  let i = 0;
  while (i < ops.length) {
    const op = ops[i];
    if (op.type === 'equal') {
      equal++;
      i++;
    } else if (op.type === 'delete') {
      // 检查后续是否紧跟 insert（连续的 delete 后跟 insert 算作修改块）
      let delCount = 0;
      let insCount = 0;
      while (i < ops.length && ops[i].type === 'delete') {
        delCount++;
        i++;
      }
      while (i < ops.length && ops[i].type === 'insert') {
        insCount++;
        i++;
      }
      delete_ += delCount;
      insert += insCount;
      // 配对数取较小值作为"修改行数"
      modify += Math.min(delCount, insCount);
    } else {
      // 纯 insert（前面不是 delete）
      insert++;
      i++;
    }
  }
  const total = equal + insert + delete_; // 当前未使用，保留以便后续扩展
  void total;
  // 相似度：equal / (equal + max(insert, delete))，避免修改块被双重计数
  const denom = equal + Math.max(insert, delete_);
  const similarity = denom === 0 ? 100 : Math.round((equal / denom) * 100);
  return { equal, insert, delete: delete_, modify, similarity };
}

/** 生成统一 diff 文本（类似 git diff） */
function buildUnifiedDiff(ops: LineOp[]): string {
  const lines: string[] = [];
  for (const op of ops) {
    if (op.type === 'equal') {
      lines.push(`  ${op.leftLine ?? ''}`);
    } else if (op.type === 'delete') {
      lines.push(`- ${op.leftLine ?? ''}`);
    } else {
      lines.push(`+ ${op.rightLine ?? ''}`);
    }
  }
  return lines.join('\n');
}

export default function DiffTool() {
  // SSR/CSR 一致：初始用空字符串，客户端 useEffect 触发示例载入（避免水合不匹配）
  const [leftText, setLeftText] = useState<string>('');
  const [rightText, setRightText] = useState<string>('');
  const [view, setView] = useState<ViewMode>('split');
  const [caseSensitive, setCaseSensitive] = useState<boolean>(true);
  const [trimWhitespace, setTrimWhitespace] = useState<boolean>(false);
  const [ignoreEmptyLines, setIgnoreEmptyLines] = useState<boolean>(false);
  // 行内高亮模式：默认字符级，可切换为无/字符级/词级（Git --word-diff 风格）
  const [highlightMode, setHighlightMode] = useState<HighlightMode>('char');
  const [notice, setNotice] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const noticeTimer = useRef<number | undefined>(undefined);

  // 客户端挂载后载入示例（仅首次），SSR 时不执行
  // 这样首屏 SSR 显示空状态，CSR 立即载入示例，避免随机/时间相关的水合不匹配
  useEffect(() => {
    // 仅在两栏均为空时载入示例（避免覆盖用户已输入内容）
    if (leftText === '' && rightText === '') {
      setLeftText(SAMPLE_LEFT);
      setRightText(SAMPLE_RIGHT);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 显示临时提示，1.5s 后清除 */
  const flashNotice = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 1500);
  }, []);

  // 实时计算 diff（依赖文本与开关）
  const ops = useMemo<LineOp[]>(() => {
    if (!leftText && !rightText) return [];
    const leftLines = leftText.split('\n');
    const rightLines = rightText.split('\n');
    const lineOps = computeLineDiff(leftLines, rightLines, { caseSensitive, trimWhitespace, ignoreEmptyLines });
    // 行内高亮：对相邻 delete+insert 行对计算更细粒度差异
    if (highlightMode === 'char') return attachCharDiff(lineOps);
    if (highlightMode === 'word') return attachWordDiff(lineOps);
    return lineOps; // 'none'：仅行级 diff
  }, [leftText, rightText, caseSensitive, trimWhitespace, ignoreEmptyLines, highlightMode]);

  const stats = useMemo<DiffStats>(() => computeStats(ops), [ops]);

  /** 载入示例 */
  const handleLoadSample = useCallback(() => {
    setLeftText(SAMPLE_LEFT);
    setRightText(SAMPLE_RIGHT);
    flashNotice('已载入示例');
  }, [flashNotice]);

  /** 交换左右文本 */
  const handleSwap = useCallback(() => {
    setLeftText(rightText);
    setRightText(leftText);
    flashNotice('已交换左右文本');
  }, [leftText, rightText, flashNotice]);

  /** 清空 */
  const handleClear = useCallback(() => {
    setLeftText('');
    setRightText('');
    flashNotice('已清空');
  }, [flashNotice]);

  /** 复制统一 diff 结果 */
  const handleCopy = useCallback(async () => {
    if (ops.length === 0) return;
    const text = buildUnifiedDiff(ops);
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      flashNotice(`已复制 ${ops.length} 行 diff 结果`);
      setTimeout(() => setCopied(false), 1500);
    } else {
      flashNotice('复制失败，请手动选中复制');
    }
  }, [ops, flashNotice]);

  const isEmpty = !leftText && !rightText;

  return (
    <div className="jsontool difftool">
      {/* 工具栏 */}
      <div className="jsontool__toolbar" role="toolbar" aria-label="文本对比工具操作">
        <div className="jsontool__actions">
          <button className="btn btn--primary btn--sm" onClick={handleLoadSample}>载入示例</button>
          <button className="btn btn--sm" onClick={handleSwap} disabled={isEmpty}>交换左右</button>
          <button className="btn btn--sm" onClick={handleCopy} disabled={ops.length === 0}>
            {copied ? '已复制' : '复制 diff'}
          </button>
          <button className="btn btn--sm" onClick={handleClear} disabled={isEmpty}>清空</button>
        </div>
        <div className="jsontool__options">
          {/* 视图模式切换 */}
          <div className="difftool__view-switch" role="group" aria-label="视图模式">
            <button
              type="button"
              className={`difftool__view-btn${view === 'split' ? ' difftool__view-btn--active' : ''}`}
              onClick={() => setView('split')}
              aria-pressed={view === 'split'}
            >分屏对比</button>
            <button
              type="button"
              className={`difftool__view-btn${view === 'unified' ? ' difftool__view-btn--active' : ''}`}
              onClick={() => setView('unified')}
              aria-pressed={view === 'unified'}
            >统一 diff</button>
          </div>
          {/* 比较选项 */}
          <label className="difftool__toggle">
            <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
            <span>区分大小写</span>
          </label>
          <label className="difftool__toggle">
            <input type="checkbox" checked={trimWhitespace} onChange={(e) => setTrimWhitespace(e.target.checked)} />
            <span>忽略行首尾空白</span>
          </label>
          <label className="difftool__toggle">
            <input type="checkbox" checked={ignoreEmptyLines} onChange={(e) => setIgnoreEmptyLines(e.target.checked)} />
            <span>忽略空行</span>
          </label>
          {/* 行内高亮模式：无 / 字符级 / 词级（Git --word-diff 风格） */}
          <div className="difftool__view-switch" role="group" aria-label="行内高亮模式">
            <button
              type="button"
              className={`difftool__view-btn${highlightMode === 'none' ? ' difftool__view-btn--active' : ''}`}
              onClick={() => setHighlightMode('none')}
              aria-pressed={highlightMode === 'none'}
            >无</button>
            <button
              type="button"
              className={`difftool__view-btn${highlightMode === 'char' ? ' difftool__view-btn--active' : ''}`}
              onClick={() => setHighlightMode('char')}
              aria-pressed={highlightMode === 'char'}
            >字符级</button>
            <button
              type="button"
              className={`difftool__view-btn${highlightMode === 'word' ? ' difftool__view-btn--active' : ''}`}
              onClick={() => setHighlightMode('word')}
              aria-pressed={highlightMode === 'word'}
            >词级</button>
          </div>
        </div>
      </div>

      {/* 双栏输入区 */}
      <div className="difftool__inputs">
        <div className="difftool__input-col">
          <label className="difftool__input-label" htmlFor="diff-left">原文（左）</label>
          <textarea
            id="diff-left"
            className="difftool__textarea difftool__textarea--left"
            value={leftText}
            onChange={(e) => setLeftText(e.target.value)}
            placeholder="粘贴原文…"
            spellCheck={false}
            aria-label="原文输入"
          />
        </div>
        <div className="difftool__input-col">
          <label className="difftool__input-label" htmlFor="diff-right">修改后（右）</label>
          <textarea
            id="diff-right"
            className="difftool__textarea difftool__textarea--right"
            value={rightText}
            onChange={(e) => setRightText(e.target.value)}
            placeholder="粘贴修改后文本…"
            spellCheck={false}
            aria-label="修改后文本输入"
          />
        </div>
      </div>

      {/* 统计栏 */}
      <div className="difftool__stats" role="status" aria-live="polite">
        <span className="difftool__stat difftool__stat--equal">相同 {stats.equal}</span>
        <span className="difftool__stat difftool__stat--insert">+{stats.insert}</span>
        <span className="difftool__stat difftool__stat--delete">-{stats.delete}</span>
        <span className="difftool__stat difftool__stat--modify">修改 {stats.modify}</span>
        <span className="difftool__stat difftool__stat--similarity">相似度 {stats.similarity}%</span>
      </div>

      {/* diff 结果区 */}
      <div className="jsontool__panels">
        {ops.length === 0 ? (
          <div className="difftool__empty" role="status">
            {isEmpty ? '在上方输入原文与修改后文本，即可实时查看差异。' : '正在计算差异…'}
          </div>
        ) : view === 'split' ? (
          <div className="difftool__result difftool__result--split">
            <div className="difftool__result-col difftool__result-col--left">
              <div className="difftool__result-label">原文</div>
              <pre className="difftool__pre" aria-label="原文差异">
                {ops.map((op, idx) => (
                  <LineRow key={idx} op={op} side="left" />
                ))}
              </pre>
            </div>
            <div className="difftool__result-col difftool__result-col--right">
              <div className="difftool__result-label">修改后</div>
              <pre className="difftool__pre" aria-label="修改后差异">
                {ops.map((op, idx) => (
                  <LineRow key={idx} op={op} side="right" />
                ))}
              </pre>
            </div>
          </div>
        ) : (
          <div className="difftool__result difftool__result--unified">
            <pre className="difftool__pre" aria-label="统一 diff 结果">
              {ops.map((op, idx) => (
                <UnifiedRow key={idx} op={op} />
              ))}
            </pre>
          </div>
        )}
      </div>

      {/* 状态条 */}
      <div className="jsontool__status" role="status" aria-live="polite">
        {notice ? (
          <div className="jsontool__notice">{notice}</div>
        ) : (
          <div className="jsontool__hint">
            基于 LCS（最长公共子序列）算法实时计算行级差异，支持分屏对比与统一 diff 两种视图。所有数据在浏览器本地处理。
          </div>
        )}
      </div>
    </div>
  );
}

/** 字符级差异段渲染：左侧只显示 equal + delete，右侧只显示 equal + insert */
function CharSegments({ charDiff, side }: { charDiff: CharOp[]; side: 'left' | 'right' }) {
  return (
    <>
      {charDiff.map((seg, i) => {
        // 左侧不显示新增段，右侧不显示删除段
        if (side === 'left' && seg.type === 'insert') return null;
        if (side === 'right' && seg.type === 'delete') return null;
        const cls = seg.type === 'equal' ? '' : seg.type === 'delete' ? 'difftool__char difftool__char--del' : 'difftool__char difftool__char--ins';
        return <span key={i} className={cls}>{seg.text}</span>;
      })}
    </>
  );
}

/** 分屏视图的单行渲染：根据 side 显示左或右行内容（字符级/词级高亮共用） */
function LineRow({ op, side }: { op: LineOp; side: 'left' | 'right' }) {
  // 当前行内差异段（字符级与词级互斥，由当前 highlightMode 决定）
  const segs = op.charDiff ?? op.wordDiff;
  // equal 行：两侧都显示；delete 行：仅左侧显示；insert 行：仅右侧显示
  if (op.type === 'equal') {
    return (
      <div className="difftool__line difftool__line--equal">
        <span className="difftool__line-marker" aria-hidden="true"> </span>
        <span className="difftool__line-text">{op.leftLine ?? ''}</span>
      </div>
    );
  }
  if (op.type === 'delete') {
    if (side !== 'left') {
      // 右侧占位空行，保持对齐
      return <div className="difftool__line difftool__line--placeholder" aria-hidden="true"> </div>;
    }
    return (
      <div className="difftool__line difftool__line--delete">
        <span className="difftool__line-marker" aria-hidden="true">-</span>
        <span className="difftool__line-text">
          {segs ? <CharSegments charDiff={segs} side="left" /> : (op.leftLine ?? '')}
        </span>
      </div>
    );
  }
  // insert
  if (side !== 'right') {
    return <div className="difftool__line difftool__line--placeholder" aria-hidden="true"> </div>;
  }
  return (
    <div className="difftool__line difftool__line--insert">
      <span className="difftool__line-marker" aria-hidden="true">+</span>
      <span className="difftool__line-text">
        {segs ? <CharSegments charDiff={segs} side="right" /> : (op.rightLine ?? '')}
      </span>
    </div>
  );
}

/** 统一 diff 视图的单行渲染：含 +/-/空格 前缀，并对修改行做行内高亮（字符级/词级共用） */
function UnifiedRow({ op }: { op: LineOp }) {
  // 当前行内差异段（字符级与词级互斥，由当前 highlightMode 决定）
  const segs = op.charDiff ?? op.wordDiff;
  if (op.type === 'equal') {
    return (
      <div className="difftool__line difftool__line--equal">
        <span className="difftool__line-marker" aria-hidden="true"> </span>
        <span className="difftool__line-text">{op.leftLine ?? ''}</span>
      </div>
    );
  }
  if (op.type === 'delete') {
    return (
      <div className="difftool__line difftool__line--delete">
        <span className="difftool__line-marker" aria-hidden="true">-</span>
        <span className="difftool__line-text">
          {segs ? <CharSegments charDiff={segs} side="left" /> : (op.leftLine ?? '')}
        </span>
      </div>
    );
  }
  return (
    <div className="difftool__line difftool__line--insert">
      <span className="difftool__line-marker" aria-hidden="true">+</span>
      <span className="difftool__line-text">
        {segs ? <CharSegments charDiff={segs} side="right" /> : (op.rightLine ?? '')}
      </span>
    </div>
  );
}
