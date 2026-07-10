import { useState, useMemo, useCallback } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * 文本大小写转换工具
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 10 种大小写格式互转：大写 / 小写 / 首字母大写 / 句子首字母大写
 *    / 驼峰 / 帕斯卡 / 下划线 / 短横线 / 句点分隔 / 反转大小写
 *  - 智能分词：自动识别空格、标点、下划线、短横线、驼峰边界
 *  - 实时预览所有格式结果，一键复制
 *
 * 适用场景：
 *  - 编程命名风格转换（驼峰 ↔ 下划线 ↔ 短横线）
 *  - 文本格式化（标题、句子、全大写）
 *  - 数据清洗与规范化
 */

type CaseType =
  | 'upper'        // 全大写
  | 'lower'        // 全小写
  | 'title'        // 首字母大写（Title Case）
  | 'sentence'     // 句子首字母大写（Sentence case）
  | 'camel'        // 驼峰命名（camelCase）
  | 'pascal'       // 帕斯卡命名（PascalCase）
  | 'snake'        // 下划线命名（snake_case）
  | 'kebab'        // 短横线命名（kebab-case）
  | 'dot'          // 句点分隔（dot.case）
  | 'swap';        // 反转大小写（sWAP cASE）

interface CaseConfig {
  type: CaseType;
  label: string;
  desc: string;
}

const CASE_CONFIGS: CaseConfig[] = [
  { type: 'upper', label: '全大写', desc: 'UPPER CASE' },
  { type: 'lower', label: '全小写', desc: 'lower case' },
  { type: 'title', label: '首字母大写', desc: 'Title Case' },
  { type: 'sentence', label: '句子首字母大写', desc: 'Sentence case' },
  { type: 'camel', label: '驼峰命名', desc: 'camelCase' },
  { type: 'pascal', label: '帕斯卡命名', desc: 'PascalCase' },
  { type: 'snake', label: '下划线命名', desc: 'snake_case' },
  { type: 'kebab', label: '短横线命名', desc: 'kebab-case' },
  { type: 'dot', label: '句点分隔', desc: 'dot.case' },
  { type: 'swap', label: '反转大小写', desc: 'sWAP cASE' },
];

/**
 * 智能分词：将任意格式的文本拆分为单词数组
 * 1. 先按非字母数字字符（空格、标点、下划线、短横线等）分割
 * 2. 再对每个片段按大小写边界分割（camelCase → camel, Case）
 * 3. 连续大写字母作为一个单词（HTTPRequest → HTTP, Request）
 */
function tokenize(text: string): string[] {
  if (!text) return [];
  // 步骤 1：按非字母数字字符分割
  const rawParts = text.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  // 步骤 2：按大小写边界分割每个片段
  const words: string[] = [];
  for (const part of rawParts) {
    // 匹配：连续大写字母后跟大写+小写（如 HTTPR → HTTP, R），或大小写转换边界
    const subParts = part
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1\0$2')  // HTTPRequest → HTTP\0Request
      .replace(/([a-z0-9])([A-Z])/g, '$1\0$2')      // camelCase → camel\0Case
      .split('\0');
    words.push(...subParts.filter(Boolean));
  }
  return words;
}

/** 根据格式类型将文本转换为对应格式 */
function convertCase(text: string, type: CaseType): string {
  if (!text) return '';

  switch (type) {
    case 'upper':
      return text.toUpperCase();
    case 'lower':
      return text.toLowerCase();
    case 'title':
      // 每个单词首字母大写
      return text.replace(/\b\w/g, (ch) => ch.toUpperCase());
    case 'sentence':
      // 每个句子首字母大写（句号、感叹号、问号后的首字母）
      return text.toLowerCase().replace(/(^\s*\w|[.!?]\s*\w)/g, (ch) => ch.toUpperCase());
    case 'swap':
      // 反转每个字符的大小写
      return text.replace(/[a-zA-Z]/g, (ch) =>
        ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase(),
      );
    case 'camel':
    case 'pascal':
    case 'snake':
    case 'kebab':
    case 'dot': {
      // 命名风格转换：先分词，再按规则重组
      const words = tokenize(text).map((w) => w.toLowerCase());
      if (words.length === 0) return '';
      switch (type) {
        case 'camel':
          return words.map((w, i) => i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)).join('');
        case 'pascal':
          return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
        case 'snake':
          return words.join('_');
        case 'kebab':
          return words.join('-');
        case 'dot':
          return words.join('.');
        default:
          return '';
      }
    }
    default:
      return text;
  }
}

export default function CaseTool() {
  const [input, setInput] = useState('hello world example');
  const [copiedType, setCopiedType] = useState<CaseType | null>(null);
  const [notice, setNotice] = useState('');

  // 实时计算所有格式的转换结果
  const results = useMemo(() => {
    const map = {} as Record<CaseType, string>;
    for (const cfg of CASE_CONFIGS) {
      map[cfg.type] = convertCase(input, cfg.type);
    }
    return map;
  }, [input]);

  const handleCopy = useCallback(async (type: CaseType) => {
    const text = results[type];
    if (!text) return;
    const ok = await copyText(text);
    if (ok) {
      setCopiedType(type);
      setNotice('已复制到剪贴板');
      setTimeout(() => setCopiedType(null), 1500);
    } else {
      setNotice('复制失败，请手动选中复制');
    }
  }, [results]);

  const handleClear = useCallback(() => {
    setInput('');
    setNotice('');
    setCopiedType(null);
  }, []);

  const handleSample = useCallback(() => {
    setInput('hello world example');
    setNotice('');
  }, []);

  const onInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (notice) setNotice('');
  }, [notice]);

  const charCount = input.length;

  return (
    <div className="casetool">
      {/* 输入区 */}
      <div className="casetool__input-section">
        <div className="casetool__toolbar">
          <label htmlFor="case-input" className="casetool__label">
            输入文本
            <span className="casetool__stat">{charCount} 字</span>
          </label>
          <div className="casetool__actions">
            <button className="btn btn--sm" onClick={handleSample}>示例</button>
            <button className="btn btn--sm" onClick={handleClear}>清空</button>
          </div>
        </div>
        <textarea
          id="case-input"
          className="casetool__textarea"
          value={input}
          onChange={onInputChange}
          placeholder="在此输入要转换的文本，支持驼峰、下划线、短横线等多种格式的自动识别"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          aria-label="输入文本"
        />
      </div>

      {/* 结果区：所有格式并列展示 */}
      <div className="casetool__results">
        {CASE_CONFIGS.map((cfg) => (
          <div key={cfg.type} className="casetool__result-item">
            <div className="casetool__result-header">
              <div className="casetool__result-info">
                <span className="casetool__result-label">{cfg.label}</span>
                <span className="casetool__result-desc">{cfg.desc}</span>
              </div>
              <button
                className="btn btn--sm casetool__copy"
                onClick={() => handleCopy(cfg.type)}
                disabled={!results[cfg.type]}
                aria-label={`复制${cfg.label}结果`}
              >
                {copiedType === cfg.type ? '已复制' : '复制'}
              </button>
            </div>
            <div className="casetool__result-value" aria-live="polite">
              {results[cfg.type] || <span className="casetool__result-empty">（空）</span>}
            </div>
          </div>
        ))}
      </div>

      {/* 状态条 */}
      <div className="casetool__status" role="status" aria-live="polite">
        {notice ? (
          <div className="casetool__notice">{notice}</div>
        ) : (
          <div className="casetool__hint">
            智能识别驼峰、下划线、短横线等命名边界。所有数据仅在浏览器本地处理。
          </div>
        )}
      </div>
    </div>
  );
}
