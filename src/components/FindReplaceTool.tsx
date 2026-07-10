import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * 字符替换工具
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 两种模式：普通文本替换、正则表达式替换
 *  - 普通模式：可选大小写敏感
 *  - 正则模式：可选 g(全局)/m(多行)/i(忽略大小写) 标志
 *  - 正则替换支持 $1、$2 等捕获组引用与 $&、$`、$' 特殊替换串
 *  - 统计：匹配次数、结果字符数
 *
 * 适用场景：批量改名、模板填充、日志脱敏、CSV 字段替换、代码重构
 */

type ReplaceMode = 'plain'   // 普通文本替换（字面量匹配）
  | 'regex';                  // 正则表达式替换

interface ReplaceOptions {
  mode: ReplaceMode;
  caseSensitive: boolean;   // 普通模式大小写敏感
  global: boolean;          // 正则模式全局替换
  multiline: boolean;       // 正则模式多行模式
  ignoreCase: boolean;      // 正则模式忽略大小写
}

const SAMPLE_TEXT = `用户 admin 于 2026-07-11 登录系统。
用户 guest 于 2026-07-10 登录系统。
管理员 admin 执行了删除操作。
IP 地址 192.168.1.1 访问了 /admin 路径。`;

const SAMPLE_FIND = 'admin';
const SAMPLE_REPLACE = '***';

/**
 * 构造正则表达式，失败时返回错误信息
 */
function buildRegex(pattern: string, opts: ReplaceOptions): { regex: RegExp | null; error: string } {
  if (!pattern) return { regex: null, error: '请输入匹配模式' };
  const flags = [
    opts.global ? 'g' : '',
    opts.multiline ? 'm' : '',
    opts.ignoreCase ? 'i' : '',
  ].join('');
  try {
    return { regex: new RegExp(pattern, flags), error: '' };
  } catch (e) {
    return { regex: null, error: `正则表达式无效：${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * 普通文本替换：将查找串作为字面量匹配
 * 使用 split + join 方案避免查找串中的正则特殊字符干扰
 */
function plainReplace(
  input: string,
  find: string,
  replace: string,
  caseSensitive: boolean,
): { result: string; count: number } {
  if (!find) return { result: input, count: 0 };
  // 大小写不敏感：用 toLowerCase 比较匹配边界
  if (!caseSensitive) {
    const lowerInput = input.toLowerCase();
    const lowerFind = find.toLowerCase();
    const parts: string[] = [];
    let count = 0;
    let cursor = 0;
    let idx = lowerInput.indexOf(lowerFind, cursor);
    while (idx !== -1) {
      parts.push(input.slice(cursor, idx));
      parts.push(replace);
      count++;
      cursor = idx + find.length;
      idx = lowerInput.indexOf(lowerFind, cursor);
    }
    parts.push(input.slice(cursor));
    return { result: parts.join(''), count };
  }
  // 大小写敏感：直接 split + join
  const count = input.split(find).length - 1;
  return { result: input.split(find).join(replace), count };
}

/**
 * 正则表达式替换
 * 非全局模式仅替换首个匹配，全局模式替换全部
 *
 * 注意：必须用字符串形式的 replace 才能让 $1、$& 等特殊替换串生效。
 * 若用回调形式返回字符串，JS 会把它当作字面量，$ 模式不会解析。
 * 因此先统计匹配次数，再用字符串形式 replace 执行替换。
 */
function regexReplace(
  input: string,
  regex: RegExp,
  replace: string,
): { result: string; count: number } {
  // 统计匹配次数
  // 全局 regex：match 返回所有匹配数组；非全局 regex：match 返回首个匹配数组或 null
  const matches = input.match(regex);
  const count = matches ? (regex.global ? matches.length : 1) : 0;
  // 字符串形式替换：JS 原生解析 $1、$2、$&、$`、$' 等特殊替换串
  const result = count > 0 ? input.replace(regex, replace) : input;
  return { result, count };
}

export default function FindReplaceTool() {
  const [input, setInput] = useState('');
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [mode, setMode] = useState<ReplaceMode>('plain');
  const [caseSensitive, setCaseSensitive] = useState(true);
  const [global, setGlobal] = useState(true);
  const [multiline, setMultiline] = useState(false);
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');

  const opts: ReplaceOptions = { mode, caseSensitive, global, multiline, ignoreCase };

  // 实时计算替换结果与匹配次数
  const { result, count, error } = useMemo(() => {
    if (!input) return { result: '', count: 0, error: '' };
    if (!find) return { result: input, count: 0, error: '' };

    if (mode === 'plain') {
      const r = plainReplace(input, find, replace, caseSensitive);
      return { result: r.result, count: r.count, error: '' };
    }
    // 正则模式
    const { regex, error: err } = buildRegex(find, opts);
    if (err || !regex) return { result: input, count: 0, error: err };
    const r = regexReplace(input, regex, replace);
    return { result: r.result, count: r.count, error: '' };
  }, [input, find, replace, mode, caseSensitive, global, multiline, ignoreCase]);

  const resultLen = Array.from(result).length;

  const handleCopy = useCallback(async () => {
    if (!result) return;
    const ok = await copyText(result);
    if (ok) {
      setCopied(true);
      setNotice('已复制替换结果到剪贴板');
      setTimeout(() => setCopied(false), 1500);
      setTimeout(() => setNotice(''), 3000);
    } else {
      setNotice('复制失败，请手动选择文本复制');
      setTimeout(() => setNotice(''), 3000);
    }
  }, [result]);

  const handleClear = useCallback(() => {
    setInput('');
    setFind('');
    setReplace('');
    setNotice('');
  }, []);

  const handleSample = useCallback(() => {
    setInput(SAMPLE_TEXT);
    setFind(SAMPLE_FIND);
    setReplace(SAMPLE_REPLACE);
    setMode('plain');
    setCaseSensitive(true);
    setNotice('');
  }, []);

  const handleSwap = useCallback(() => {
    // 交换查找与替换串，便于反向替换
    const tmp = find;
    setFind(replace);
    setReplace(tmp);
  }, [find, replace]);

  return (
    <div className="fr">
      {/* 输入区 */}
      <div className="fr__input-section">
        <div className="fr__toolbar">
          <span className="fr__label">
            原始文本
            <span className="fr__stat">共 {input ? Array.from(input).length : 0} 字符</span>
          </span>
          <div className="fr__actions">
            <button className="btn btn--sm" onClick={handleSample}>示例</button>
            <button className="btn btn--sm" onClick={handleClear}>清空</button>
          </div>
        </div>
        <textarea
          className="fr__textarea"
          placeholder="粘贴需要替换的文本&#10;点击「示例」可快速体验日志脱敏场景"
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          spellCheck={false}
        />
      </div>

      {/* 查找替换配置区 */}
      <div className="fr__config">
        <fieldset className="fr__fieldset">
          <legend className="fr__legend">匹配模式</legend>
          <label className="fr__radio">
            <input
              type="radio"
              name="fr-mode"
              value="plain"
              checked={mode === 'plain'}
              onChange={() => setMode('plain')}
            />
            普通文本（字面量匹配）
          </label>
          <label className="fr__radio">
            <input
              type="radio"
              name="fr-mode"
              value="regex"
              checked={mode === 'regex'}
              onChange={() => setMode('regex')}
            />
            正则表达式
          </label>
        </fieldset>

        {/* 查找与替换输入框 */}
        <div className="fr__pair">
          <label className="fr__field">
            <span className="fr__field-label">
              {mode === 'regex' ? '正则表达式' : '查找文本'}
            </span>
            <input
              type="text"
              className="fr__input"
              placeholder={mode === 'regex' ? '例如：\\d{4}-\\d{2}-\\d{2}' : '输入要查找的文本'}
              value={find}
              onChange={(e) => setFind(e.currentTarget.value)}
              spellCheck={false}
            />
          </label>
          <button
            className="btn btn--sm fr__swap"
            onClick={handleSwap}
            title="交换查找与替换内容"
            aria-label="交换查找与替换内容"
          >
            ⇄
          </button>
          <label className="fr__field">
            <span className="fr__field-label">替换为</span>
            <input
              type="text"
              className="fr__input"
              placeholder={mode === 'regex' ? '支持 $1、$& 等捕获组引用' : '输入替换后的文本'}
              value={replace}
              onChange={(e) => setReplace(e.currentTarget.value)}
              spellCheck={false}
            />
          </label>
        </div>

        {/* 选项区：根据模式动态显示 */}
        {mode === 'plain' ? (
          <fieldset className="fr__fieldset">
            <legend className="fr__legend">选项</legend>
            <label className="fr__check">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.currentTarget.checked)}
              />
              大小写敏感
            </label>
          </fieldset>
        ) : (
          <fieldset className="fr__fieldset">
            <legend className="fr__legend">正则标志</legend>
            <label className="fr__check">
              <input
                type="checkbox"
                checked={global}
                onChange={(e) => setGlobal(e.currentTarget.checked)}
              />
              全局替换 (g) — 关闭仅替换首个匹配
            </label>
            <label className="fr__check">
              <input
                type="checkbox"
                checked={multiline}
                onChange={(e) => setMultiline(e.currentTarget.checked)}
              />
              多行模式 (m) — ^ $ 匹配行首行尾
            </label>
            <label className="fr__check">
              <input
                type="checkbox"
                checked={ignoreCase}
                onChange={(e) => setIgnoreCase(e.currentTarget.checked)}
              />
              忽略大小写 (i)
            </label>
          </fieldset>
        )}
      </div>

      {/* 错误提示 */}
      {error && <div className="fr__error">{error}</div>}

      {/* 统计区 */}
      <div className="fr__stats">
        <div className="fr__stat-item">
          <span className="fr__stat-num">{count}</span>
          <span className="fr__stat-label">替换次数</span>
        </div>
        <div className="fr__stat-item">
          <span className="fr__stat-num">{resultLen}</span>
          <span className="fr__stat-label">结果字符数</span>
        </div>
      </div>

      {/* 结果区 */}
      <div className="fr__result-section">
        <div className="fr__toolbar">
          <span className="fr__label">
            替换结果
            <span className="fr__stat">{count > 0 ? `已替换 ${count} 处` : '无替换'}</span>
          </span>
          <div className="fr__actions">
            <button
              className={`btn btn--sm${copied ? ' btn--success' : ''}`}
              onClick={handleCopy}
              disabled={!result}
            >
              {copied ? '已复制' : '复制结果'}
            </button>
          </div>
        </div>
        {result ? (
          <div className="fr__result">{result}</div>
        ) : (
          <div className="fr__result fr__result-empty">
            {input ? '请在上方填写查找文本后查看替换结果' : '请先输入原始文本'}
          </div>
        )}
      </div>

      {/* 状态提示 */}
      {notice && <div className="fr__notice">{notice}</div>}
      {!notice && !input && (
        <div className="fr__hint">提示：点击「示例」体验日志脱敏场景（admin → ***）</div>
      )}
    </div>
  );
}
