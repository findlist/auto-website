import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * 正则表达式测试工具
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 测试模式：输入正则 + 测试字符串，实时高亮全部匹配
 *  - 替换模式：基于正则进行字符串替换，支持 $1/$2 与 $<name> 引用
 *  - 命名捕获组：ES2018 (?<name>...) 语法，匹配列表展示命名组
 *  - 标志位：g 全局 / i 忽略大小写 / m 多行 / s dotAll / u Unicode / y 粘滞
 *  - 常用模式速查：邮箱、URL、IPv4、手机号、中文字符等一键载入
 *  - 匹配列表：序号、位置、匹配内容、捕获组（数字组 + 命名组）、单条复制
 *  - 复制结果 / 清空 / 示例
 *
 * 安全策略：
 *  - 输入长度上限 10000 字符（防止 ReDoS 拖慢浏览器）
 *  - 全局匹配数上限 5000（防止死循环）
 *  - 零宽匹配保护（避免相同位置无限匹配）
 */

type ViewMode = 'test' | 'replace';
type Flag = 'g' | 'i' | 'm' | 's' | 'u' | 'y';

interface MatchItem {
  index: number;                 // 起始位置
  end: number;                   // 结束位置（不含）
  match: string;                 // 匹配文本
  groups: (string | undefined)[]; // 数字捕获组（$1, $2, ...）
  namedGroups: Record<string, string>; // 命名捕获组（$<name>，ES2018）
}

interface RegexResult {
  ok: boolean;
  matches: MatchItem[];
  error: string;
  truncated: boolean;            // 是否因超过上限被截断
}

interface ReplaceResult {
  ok: boolean;
  value: string;
  error: string;
  count: number;                 // 替换次数
}

// 标志位定义：顺序与原生 RegExp 一致
const FLAG_LIST: { flag: Flag; label: string; desc: string }[] = [
  { flag: 'g', label: 'g', desc: '全局匹配（找出全部，否则只找第一个）' },
  { flag: 'i', label: 'i', desc: '忽略大小写' },
  { flag: 'm', label: 'm', desc: '多行模式（^ $ 匹配每行首尾）' },
  { flag: 's', label: 's', desc: 'dotAll（. 匹配换行符）' },
  { flag: 'u', label: 'u', desc: 'Unicode 模式（正确处理中文/Emoji）' },
  { flag: 'y', label: 'y', desc: '粘滞匹配（从 lastIndex 开始）' },
];

// 常用正则模式速查：覆盖开发者高频场景
const PRESET_PATTERNS: { name: string; pattern: string; flags: string; desc: string }[] = [
  { name: '邮箱', pattern: '[\\w.+-]+@[\\w-]+\\.[\\w.-]+', flags: 'gi', desc: '匹配常见邮箱地址' },
  { name: 'URL', pattern: 'https?://[\\w.-]+(?:/[\\w./-]*)?', flags: 'gi', desc: '匹配 http/https 链接' },
  { name: 'IPv4', pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b', flags: 'g', desc: '匹配 IPv4 地址' },
  { name: '手机号', pattern: '1[3-9]\\d{9}', flags: 'g', desc: '匹配中国大陆手机号' },
  { name: '中文字符', pattern: '[\\u4e00-\\u9fa5]+', flags: 'g', desc: '匹配连续中文字符' },
  { name: 'HTML 标签', pattern: '<([^>]+)>', flags: 'g', desc: '匹配 HTML/XML 标签，$1 为标签名' },
  { name: '整数', pattern: '-?\\d+', flags: 'g', desc: '匹配正负整数' },
  { name: '浮点数', pattern: '-?\\d+\\.\\d+', flags: 'g', desc: '匹配浮点数' },
  // 命名捕获组示例：演示 (?<name>...) 语法与 $<name> 引用
  {
    name: '邮箱(命名组)',
    pattern: '(?<user>[\\w.+-]+)@(?<domain>[\\w-]+)\\.(?<tld>[\\w.-]+)',
    flags: 'gi',
    desc: '命名捕获组示例：$<user> / $<domain> / $<tld> 引用',
  },
];

const SAMPLE_PATTERN = '(\\w+)@(\\w+)\\.(\\w+)';
const SAMPLE_FLAGS = 'gi';
const SAMPLE_TEXT =
  '联系方式：dev@example.com 与 test.user@sub.domain.org；\n' +
  '电话 13800138000，网址 https://toolbox.example.com；\n' +
  'IP 192.168.1.1，邮箱 admin@site.cn 也可联系。';

// 输入与匹配上限：保护浏览器免受 ReDoS 攻击
const MAX_INPUT_LENGTH = 10000;
const MAX_MATCHES = 5000;

/**
 * 格式化单条匹配为可读文本：序号 + 匹配文本 + 位置 + 数字组 + 命名组
 * 用于「复制全部」与「单条复制」统一输出
 */
function formatMatchLine(m: MatchItem, idx: number): string {
  const parts: string[] = [`#${idx + 1}\t${m.match}\t@${m.index}-${m.end}`];
  if (m.groups.length > 0) {
    parts.push(m.groups.map((g, j) => `$${j + 1}=${g ?? ''}`).join('\t'));
  }
  const namedKeys = Object.keys(m.namedGroups);
  if (namedKeys.length > 0) {
    parts.push(namedKeys.map((k) => `${k}=${m.namedGroups[k]}`).join('\t'));
  }
  return parts.join('\t');
}

/**
 * 执行正则匹配，自动处理全局/非全局、零宽匹配死循环、超限截断
 * 同步读取命名捕获组（m.groups，ES2018）与数字捕获组（m[1..n]）
 */
function runMatch(pattern: string, flags: string, text: string): RegexResult {
  if (pattern === '' || text === '') {
    return { ok: true, matches: [], error: '', truncated: false };
  }
  try {
    const re = new RegExp(pattern, flags);
    const matches: MatchItem[] = [];
    const global = flags.includes('g');

    // 提取命名组对象的辅助函数：m.groups 在无命名组时为 undefined
    const takeNamed = (m: RegExpExecArray): Record<string, string> => {
      if (!m.groups) return {};
      const out: Record<string, string> = {};
      Object.keys(m.groups).forEach((k) => {
        const v = m.groups![k];
        if (v !== undefined) out[k] = v;
      });
      return out;
    };

    if (global) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        matches.push({
          index: m.index,
          end: m.index + m[0].length,
          match: m[0],
          groups: m.slice(1),
          namedGroups: takeNamed(m),
        });
        // 零宽匹配保护：避免相同位置无限循环
        if (m.index === re.lastIndex) re.lastIndex++;
        // 超限截断
        if (matches.length >= MAX_MATCHES) {
          return { ok: true, matches, error: '', truncated: true };
        }
      }
    } else {
      const m = re.exec(text);
      if (m) {
        matches.push({
          index: m.index,
          end: m.index + m[0].length,
          match: m[0],
          groups: m.slice(1),
          namedGroups: takeNamed(m),
        });
      }
    }
    return { ok: true, matches, error: '', truncated: false };
  } catch (e) {
    return {
      ok: false,
      matches: [],
      error: `正则编译失败：${e instanceof Error ? e.message : String(e)}`,
      truncated: false,
    };
  }
}

/**
 * 执行正则替换：永远使用全局匹配（避免只替换第一个的歧义）
 * 支持三种引用语法：$1/$2 数字组、$<name> 命名组（ES2018）、$$ 转义
 */
function runReplace(
  pattern: string,
  flags: string,
  text: string,
  replacement: string,
): ReplaceResult {
  if (pattern === '' || text === '') {
    return { ok: true, value: text, error: '', count: 0 };
  }
  try {
    // 替换模式自动加 g：让所有匹配都被替换，符合用户直觉
    const realFlags = flags.includes('g') ? flags : flags + 'g';
    const re = new RegExp(pattern, realFlags);
    let count = 0;
    // 使用回调统计替换次数（避免重复执行正则）
    // 回调签名：(...args) => args = [match, p1, p2, ..., offset, fullText, groups?]
    // 仅当正则含命名组时，最后一个参数才是 groups 对象
    const value = text.replace(re, (...args) => {
      count++;
      const last = args[args.length - 1];
      // 命名组对象仅在正则有 (?<name>...) 时由引擎传入
      const namedGroups: Record<string, string> | undefined =
        last && typeof last === 'object' ? (last as Record<string, string>) : undefined;
      return replacement
        // 1) $<name> 命名组引用（ES2018）
        .replace(/\$<(\w+)>/g, (_, name: string) =>
          namedGroups && namedGroups[name] !== undefined ? namedGroups[name] : '',
        )
        // 2) $1 $2 数字组引用
        .replace(/\$(\d+)/g, (_, n: string) => {
          const idx = parseInt(n, 10);
          return args[idx] !== undefined ? (args[idx] as string) : '';
        })
        // 3) $$ 转义为字面 $
        .replace(/\$\$/g, '$');
    });
    return { ok: true, value, error: '', count };
  } catch (e) {
    return {
      ok: false,
      value: '',
      error: `替换失败：${e instanceof Error ? e.message : String(e)}`,
      count: 0,
    };
  }
}


export default function RegexTool() {
  const [viewMode, setViewMode] = useState<ViewMode>('test');
  const [pattern, setPattern] = useState<string>('');
  const [flags, setFlags] = useState<string>('g');
  const [text, setText] = useState<string>('');
  const [replacement, setReplacement] = useState<string>('');
  const [notice, setNotice] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // 测试模式匹配结果
  const matchResult = useMemo<RegexResult>(() => {
    return runMatch(pattern, flags, text);
  }, [pattern, flags, text]);

  // 替换模式结果
  const replaceResult = useMemo<ReplaceResult>(() => {
    if (viewMode !== 'replace') return { ok: true, value: '', error: '', count: 0 };
    return runReplace(pattern, flags, text, replacement);
  }, [viewMode, pattern, flags, text, replacement]);

  /** 切换标志位 */
  const toggleFlag = useCallback((flag: Flag) => {
    setFlags((prev) => {
      if (prev.includes(flag)) return prev.replace(new RegExp(flag, 'g'), '');
      return prev + flag;
    });
    setNotice('');
  }, []);

  /** 载入示例 */
  const handleSample = useCallback(() => {
    setPattern(SAMPLE_PATTERN);
    setFlags(SAMPLE_FLAGS);
    setText(SAMPLE_TEXT);
    setReplacement('[$1 at $2.$3]');
    setNotice('');
    setCopied(false);
  }, []);

  /** 清空 */
  const handleClear = useCallback(() => {
    setPattern('');
    setFlags('g');
    setText('');
    setReplacement('');
    setNotice('');
    setCopied(false);
  }, []);

  /** 载入预设模式 */
  const handlePreset = useCallback((p: { pattern: string; flags: string }) => {
    setPattern(p.pattern);
    setFlags(p.flags);
    setNotice('');
  }, []);

  /** 复制匹配结果到剪贴板（含数字组与命名组） */
  const handleCopyMatches = useCallback(async () => {
    if (matchResult.matches.length === 0) return;
    const lines = matchResult.matches.map((m, i) => formatMatchLine(m, i));
    const ok = await copyText(lines.join('\n'));
    if (ok) {
      setCopied(true);
      setNotice(`已复制 ${matchResult.matches.length} 个匹配`);
      setTimeout(() => setCopied(false), 1500);
    } else {
      setNotice('复制失败，请手动选中复制');
    }
  }, [matchResult]);

  /** 复制单条匹配（含捕获组与命名组） */
  const handleCopySingle = useCallback(async (m: MatchItem, idx: number) => {
    const ok = await copyText(formatMatchLine(m, idx));
    if (ok) {
      setCopied(true);
      setNotice(`已复制 #${idx + 1} 条匹配`);
      setTimeout(() => setCopied(false), 1500);
    } else {
      setNotice('复制失败，请手动选中复制');
    }
  }, []);

  /** 复制替换结果 */
  const handleCopyReplace = useCallback(async () => {
    if (!replaceResult.value) return;
    const ok = await copyText(replaceResult.value);
    if (ok) {
      setCopied(true);
      setNotice(`已复制替换结果（${replaceResult.count} 处）`);
      setTimeout(() => setCopied(false), 1500);
    } else {
      setNotice('复制失败，请手动选中复制');
    }
  }, [replaceResult]);

  /** 切换视图模式 */
  const onModeChange = useCallback((m: ViewMode) => {
    setViewMode(m);
    setNotice('');
    setCopied(false);
  }, []);

  // 输入超限提示
  const overLimit = text.length > MAX_INPUT_LENGTH;
  const effectiveText = overLimit ? text.slice(0, MAX_INPUT_LENGTH) : text;

  // 渲染高亮：在测试字符串中用 <mark> 包裹匹配片段
  const highlighted = useMemo(() => {
    if (!matchResult.ok || matchResult.matches.length === 0) {
      return [<span key="raw">{text}</span>];
    }
    // 按 index 升序，跳过重叠（理论不应重叠，但保险）
    const sorted = [...matchResult.matches].sort((a, b) => a.index - b.index);
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    sorted.forEach((m, i) => {
      if (m.index < cursor) return;
      if (cursor < m.index) {
        parts.push(<span key={`t-${i}`}>{text.slice(cursor, m.index)}</span>);
      }
      parts.push(
        <mark key={`m-${i}`} className="regextool__hl" title={`#${i + 1} @${m.index}-${m.end}`}>
          {m.match}
        </mark>,
      );
      cursor = m.end;
    });
    if (cursor < text.length) {
      parts.push(<span key="t-end">{text.slice(cursor)}</span>);
    }
    return parts;
  }, [matchResult, text]);

  return (
    <div className="jsontool regextool">
      {/* 工具栏 */}
      <div className="jsontool__toolbar" role="toolbar" aria-label="正则测试操作">
        <div className="jsontool__actions">
          {/* 视图模式切换 */}
          <div className="regextool__view-tabs" role="group" aria-label="操作模式">
            <button
              className={`regextool__view-tab${viewMode === 'test' ? ' is-active' : ''}`}
              aria-pressed={viewMode === 'test'}
              onClick={() => onModeChange('test')}
            >
              测试匹配
            </button>
            <button
              className={`regextool__view-tab${viewMode === 'replace' ? ' is-active' : ''}`}
              aria-pressed={viewMode === 'replace'}
              onClick={() => onModeChange('replace')}
            >
              替换
            </button>
          </div>
        </div>
        <div className="jsontool__options">
          <button className="btn btn--sm" onClick={handleSample}>示例</button>
          <button className="btn btn--sm" onClick={handleClear}>清空</button>
        </div>
      </div>

      {/* 正则输入区 */}
      <div className="regextool__regex-bar">
        <label htmlFor="regex-pattern" className="regextool__regex-label">/</label>
        <input
          id="regex-pattern"
          type="text"
          className="regextool__pattern-input"
          value={pattern}
          onChange={(e) => { setPattern(e.target.value); setNotice(''); }}
          placeholder="输入正则表达式，如 \d+ 匹配数字"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          aria-label="正则表达式模式"
        />
        <span className="regextool__regex-label">/{flags}</span>
      </div>

      {/* 标志位 */}
      <div className="regextool__flags" role="group" aria-label="正则标志位">
        {FLAG_LIST.map((f) => (
          <label
            key={f.flag}
            className="regextool__flag"
            title={f.desc}
          >
            <input
              type="checkbox"
              checked={flags.includes(f.flag)}
              onChange={() => toggleFlag(f.flag)}
            />
            <span className="regextool__flag-label">{f.label}</span>
            <span className="regextool__flag-desc">{f.desc}</span>
          </label>
        ))}
      </div>

      {/* 常用模式速查 */}
      <div className="regextool__presets" aria-label="常用正则模式">
        <span className="regextool__presets-label">常用：</span>
        {PRESET_PATTERNS.map((p) => (
          <button
            key={p.name}
            className="regextool__preset"
            title={p.desc}
            onClick={() => handlePreset(p)}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* 主体：左输入 + 右结果 */}
      <div className="jsontool__panels regextool__panels">
        <div className="jsontool__panel">
          <label htmlFor="regex-text" className="jsontool__label">
            <span>测试字符串</span>
            <span className="jsontool__stat">
              {text.length} 字{overLimit && <span className="regextool__warn"> · 已超上限截断</span>}
            </span>
          </label>
          <textarea
            id="regex-text"
            className="jsontool__textarea"
            value={text}
            onChange={(e) => { setText(e.target.value); setNotice(''); }}
            placeholder={'在此输入要测试的文本…\n例如：联系方式 dev@example.com，电话 13800138000'}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            aria-label="测试字符串"
          />
        </div>
        <div className="jsontool__panel regextool__result-panel">
          {viewMode === 'test' ? (
            <TestResultView
              result={matchResult}
              highlighted={highlighted}
              effectiveText={effectiveText}
              onCopyMatches={handleCopyMatches}
              onCopySingle={handleCopySingle}
              copied={copied}
            />
          ) : (
            <ReplaceResultView
              result={replaceResult}
              replacement={replacement}
              onReplacementChange={(v) => { setReplacement(v); setNotice(''); }}
              onCopyReplace={handleCopyReplace}
              copied={copied}
            />
          )}
        </div>
      </div>

      {/* 状态条 */}
      <div className="jsontool__status" role="status" aria-live="polite">
        {matchResult.error ? (
          <div className="jsontool__error">
            <strong>❌ 错误</strong>
            <span>{matchResult.error}</span>
          </div>
        ) : replaceResult.error ? (
          <div className="jsontool__error">
            <strong>❌ 错误</strong>
            <span>{replaceResult.error}</span>
          </div>
        ) : notice ? (
          <div className="jsontool__notice">{notice}</div>
        ) : (
          <div className="jsontool__hint">
            所有数据仅在你浏览器内处理；输入上限 {MAX_INPUT_LENGTH} 字，匹配上限 {MAX_MATCHES} 个。
          </div>
        )}
      </div>
    </div>
  );
}

// ============ 测试结果视图 ============

interface TestResultViewProps {
  result: RegexResult;
  highlighted: React.ReactNode[];
  effectiveText: string;
  onCopyMatches: () => void;
  onCopySingle: (m: MatchItem, idx: number) => void;
  copied: boolean;
}

function TestResultView({
  result,
  highlighted,
  effectiveText,
  onCopyMatches,
  onCopySingle,
  copied,
}: TestResultViewProps) {
  const { matches, truncated } = result;

  return (
    <>
      <div className="jsontool__label">
        <span>匹配结果</span>
        <span className="jsontool__stat">
          {matches.length > 0 ? `${matches.length} 个匹配${truncated ? '（已截断）' : ''}` : '无匹配'}
        </span>
        {matches.length > 0 && (
          <button
            className="btn btn--sm jsontool__copy"
            onClick={onCopyMatches}
            aria-label="复制全部匹配"
          >
            {copied ? '已复制' : '复制匹配'}
          </button>
        )}
      </div>

      {/* 高亮预览 */}
      <div className="regextool__preview" aria-label="匹配高亮预览">
        {effectiveText === '' ? (
          <span className="regextool__placeholder">输入测试字符串后，匹配片段会在此高亮显示</span>
        ) : (
          <pre className="regextool__preview-pre">{highlighted}</pre>
        )}
      </div>

      {/* 匹配列表 */}
      {matches.length > 0 && (
        <div className="regextool__match-list" aria-label="匹配详情列表">
          {matches.map((m, i) => {
            const namedKeys = Object.keys(m.namedGroups);
            return (
              <div key={i} className="regextool__match-item">
                <div className="regextool__match-head">
                  <span className="regextool__match-idx">#{i + 1}</span>
                  <code className="regextool__match-text">{m.match || '（空匹配）'}</code>
                  <span className="regextool__match-pos">@{m.index}-{m.end}</span>
                  {/* 单条复制按钮：复制该条匹配 + 捕获组 + 命名组 */}
                  <button
                    className="btn btn--sm regextool__match-copy"
                    onClick={() => onCopySingle(m, i)}
                    aria-label={`复制第 ${i + 1} 条匹配`}
                    title="复制本条匹配（含捕获组与命名组）"
                  >
                    复制
                  </button>
                </div>
                {/* 数字捕获组：$1 $2 ... */}
                {m.groups.length > 0 && (
                  <div className="regextool__match-groups">
                    {m.groups.map((g, j) => (
                      <span key={j} className="regextool__match-group">
                        <span className="regextool__group-key">${j + 1}</span>
                        <code className="regextool__group-val">{g ?? '（未参与）'}</code>
                      </span>
                    ))}
                  </div>
                )}
                {/* 命名捕获组：name = value（ES2018 (?<name>...)） */}
                {namedKeys.length > 0 && (
                  <div className="regextool__match-groups regextool__match-named">
                    {namedKeys.map((k) => (
                      <span key={k} className="regextool__match-group regextool__match-named-item">
                        <span className="regextool__group-key regextool__group-key--named">{k}</span>
                        <code className="regextool__group-val">{m.namedGroups[k]}</code>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ============ 替换结果视图 ============

interface ReplaceResultViewProps {
  result: ReplaceResult;
  replacement: string;
  onReplacementChange: (v: string) => void;
  onCopyReplace: () => void;
  copied: boolean;
}

function ReplaceResultView({
  result,
  replacement,
  onReplacementChange,
  onCopyReplace,
  copied,
}: ReplaceResultViewProps) {
  return (
    <>
      <div className="jsontool__label">
        <span>替换字符串</span>
        <span className="jsontool__stat">支持 $1 / $2 数字组、$&lt;name&gt; 命名组、$$ 转义</span>
      </div>
      <input
        type="text"
        className="regextool__replace-input"
        value={replacement}
        onChange={(e) => onReplacementChange(e.target.value)}
        placeholder="如 [$1 at $2.$3] 或 [$<user> at $<domain>.$<tld>]，$$ 转义 $"
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        aria-label="替换字符串"
      />

      <div className="jsontool__label">
        <span>替换结果</span>
        <span className="jsontool__stat">
          {result.ok ? `${result.count} 处替换` : '执行失败'}
        </span>
        {result.value && (
          <button
            className="btn btn--sm jsontool__copy"
            onClick={onCopyReplace}
            aria-label="复制替换结果"
          >
            {copied ? '已复制' : '复制'}
          </button>
        )}
      </div>
      <textarea
        className="jsontool__textarea jsontool__textarea--output regextool__replace-output"
        value={result.value}
        readOnly
        placeholder="替换结果将显示在这里"
        spellCheck={false}
        aria-label="替换结果"
      />
    </>
  );
}
