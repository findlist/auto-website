import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { copyText } from '../utils/clipboard';

/**
 * 摩斯密码编解码工具
 *
 * 全部在浏览器本地处理，零依赖、零网络请求。
 *
 * 核心功能：
 *  - 文本 → 摩斯密码编码（支持字母、数字、常用标点）
 *  - 摩斯密码 → 文本解码（容错处理空格分隔符）
 *  - Web Audio API 播放摩斯密码音频（可调速度 WPM）
 *  - 中英文混合输入提示（摩斯密码仅支持 ASCII 字符集）
 *
 * 音频标准：
 *  - 基于 PARIS 标准：dot 时长 = 1200 / WPM（毫秒）
 *  - dash = 3 × dot，字符内间隔 = 1 × dot，字符间隔 = 3 × dot，单词间隔 = 7 × dot
 */

/** 摩斯密码编码表：字符 → 摩斯码 */
const MORSE_TABLE: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.',
  G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..',
  M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.',
  S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
  Y: '-.--', Z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--',
  '4': '....-', '5': '.....', '6': '-....', '7': '--...',
  '8': '---..', '9': '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.',
  '!': '-.-.--', '/': '-..-.', '(': '-.--.', ')': '-.--.-',
  '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-',
  '+': '.-.-.', '-': '-....-', '_': '..--.--', '"': '.-..-.',
  '@': '.--.-.',
};

/** 摩斯密码反向解码表：摩斯码 → 字符 */
const REVERSE_MORSE: Record<string, string> = Object.fromEntries(
  Object.entries(MORSE_TABLE).map(([char, code]) => [code, char]),
);

/** 文本 → 摩斯密码编码 */
function encodeMorse(text: string): { result: string; unsupported: string[] } {
  const unsupported = new Set<string>();
  const words = text.toUpperCase().split(/\s+/).filter(Boolean);

  const encodedWords = words.map((word) => {
    const chars = Array.from(word).map((char) => {
      const code = MORSE_TABLE[char];
      if (code) return code;
      if (char.trim() !== '') unsupported.add(char);
      return '';
    }).filter(Boolean);
    return chars.join(' '); // 字符内用空格分隔
  });

  return {
    result: encodedWords.join(' / '), // 单词间用 / 分隔
    unsupported: Array.from(unsupported),
  };
}

/** 摩斯密码 → 文本解码 */
function decodeMorse(morse: string): { result: string; invalid: string[] } {
  const invalid: string[] = [];
  // 统一分隔符：支持 / 和 | 作为单词分隔符
  const normalized = morse.trim().replace(/\s*[/|]\s*/g, ' / ');

  const words = normalized.split(/\s*\/\s*/);
  const decodedWords = words.map((word) => {
    const codes = word.trim().split(/\s+/).filter(Boolean);
    const chars = codes.map((code) => {
      // 清理可能的非法字符
      const cleanCode = code.replace(/[^.\-]/g, '');
      if (!cleanCode) return '';
      const char = REVERSE_MORSE[cleanCode];
      if (char) return char;
      invalid.push(cleanCode);
      return '';
    });
    return chars.join('');
  });

  return {
    result: decodedWords.join(' '),
    invalid,
  };
}

/**
 * 计算摩斯密码音频播放时长（毫秒）
 * 用于预估播放时间，避免用户等待过久
 */
function calculateDuration(morse: string, wpm: number): number {
  const dot = 1200 / wpm; // 基本单位（毫秒）
  let total = 0;
  for (const ch of morse) {
    if (ch === '.') total += dot; // dot
    else if (ch === '-') total += 3 * dot; // dash
    else if (ch === ' ') total += 2 * dot; // 字符间隔（已含点后 1 dot 间隔，补 2 dot）
    else if (ch === '/') total += 4 * dot; // 单词间隔（已含字符间隔，补 4 dot）
    // 点/划后都有 1 dot 间隔（已含在上述计算中）
  }
  return Math.round(total);
}

type Mode = 'encode' | 'decode';

export default function MorseTool() {
  const [mode, setMode] = useState<Mode>('encode');
  const [input, setInput] = useState('');
  const [wpm, setWpm] = useState(15);
  const [freq, setFreq] = useState(600);
  const [copyStatus, setCopyStatus] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioSupported, setAudioSupported] = useState(true);

  // 音频上下文与播放控制
  const audioCtxRef = useRef<AudioContext | null>(null);
  const stopFlagRef = useRef(false);

  // 检测 Web Audio API 支持（兼容旧版浏览器的 webkit 前缀）
  useEffect(() => {
    const w = window as any;
    setAudioSupported(typeof AudioContext !== 'undefined' || typeof w.webkitAudioContext !== 'undefined');
  }, []);

  // 实时编解码
  const { result, warnings } = useMemo(() => {
    if (!input.trim()) return { result: '', warnings: [] as string[] };

    if (mode === 'encode') {
      const { result, unsupported } = encodeMorse(input);
      const warnings = unsupported.length > 0
        ? [`以下字符无摩斯码对应，已跳过：${unsupported.join(' ')}`]
        : [];
      return { result, warnings };
    } else {
      const { result, invalid } = decodeMorse(input);
      const warnings = invalid.length > 0
        ? [`以下摩斯码无法识别：${invalid.join(' ')}`]
        : [];
      return { result, warnings };
    }
  }, [input, mode]);

  // 播放摩斯密码音频
  const handlePlay = useCallback(async () => {
    if (!result || isPlaying) return;

    // 获取或创建 AudioContext
    if (!audioCtxRef.current) {
      const Ctx = typeof AudioContext !== 'undefined' ? AudioContext : (window as any).webkitAudioContext;
      if (!Ctx) return;
      audioCtxRef.current = new Ctx();
    }
    // 使用 const 保持类型收窄（let 变量在 await 后会丢失 null 收窄）
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    // 浏览器策略要求用户交互后恢复 AudioContext
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    stopFlagRef.current = false;
    setIsPlaying(true);

    const dot = 1200 / wpm; // 基本单位（毫秒）
    const startTime = ctx.currentTime + 0.05; // 留 50ms 缓冲
    let timeOffset = startTime;

    // 逐字符生成音频
    for (const ch of result) {
      if (stopFlagRef.current) break;

      if (ch === '.') {
        // dot：持续 1 dot
        scheduleBeep(ctx, timeOffset, dot / 1000, freq);
        timeOffset += dot / 1000 + dot / 1000; // 信号 + 间隔
      } else if (ch === '-') {
        // dash：持续 3 dot
        scheduleBeep(ctx, timeOffset, (3 * dot) / 1000, freq);
        timeOffset += (3 * dot) / 1000 + dot / 1000; // 信号 + 间隔
      } else if (ch === ' ') {
        // 字符间隔：已有 1 dot 间隔，补 2 dot
        timeOffset += (2 * dot) / 1000;
      } else if (ch === '/') {
        // 单词间隔：已有 3 dot 字符间隔，补 4 dot
        timeOffset += (4 * dot) / 1000;
      }
    }

    // 等待播放结束
    const duration = (timeOffset - startTime) * 1000;
    setTimeout(() => {
      setIsPlaying(false);
    }, duration + 100);
  }, [result, isPlaying, wpm, freq]);

  // 停止播放
  const handleStop = useCallback(() => {
    stopFlagRef.current = true;
    if (audioCtxRef.current) {
      // 关闭当前 AudioContext，下次播放时重建
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  // 组件卸载时清理音频资源
  useEffect(() => {
    return () => {
      stopFlagRef.current = true;
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (!result) return;
    const ok = await copyText(result);
    setCopyStatus(ok ? '已复制' : '复制失败');
    setTimeout(() => setCopyStatus(''), 1500);
  }, [result]);

  const handleLoadSample = useCallback(() => {
    if (mode === 'encode') {
      setInput('SOS HELLO WORLD');
    } else {
      setInput('... --- ... / .... . .-.. .-.. --- / .-- --- .-. .-.. -..');
    }
  }, [mode]);

  const handleClear = useCallback(() => {
    setInput('');
  }, []);

  // 预估播放时长
  const playDuration = useMemo(() => {
    if (!result) return 0;
    return calculateDuration(result, wpm);
  }, [result, wpm]);

  return (
    <div className="morsetool">
      {/* 模式切换 */}
      <div className="morsetool__mode-switch">
        <button
          className={`btn btn--sm ${mode === 'encode' ? 'btn--active' : ''}`}
          onClick={() => setMode('encode')}
          aria-pressed={mode === 'encode'}
        >
          文本 → 摩斯码
        </button>
        <button
          className={`btn btn--sm ${mode === 'decode' ? 'btn--active' : ''}`}
          onClick={() => setMode('decode')}
          aria-pressed={mode === 'decode'}
        >
          摩斯码 → 文本
        </button>
      </div>

      {/* 工具栏 */}
      <div className="morsetool__toolbar">
        <div className="morsetool__actions">
          <button className="btn btn--sm" onClick={handleLoadSample}>
            载入示例
          </button>
          <button className="btn btn--sm" onClick={handleClear} disabled={!input}>
            清空
          </button>
          <button className="btn btn--sm" onClick={handleCopy} disabled={!result}>
            {copyStatus || '复制结果'}
          </button>
        </div>
      </div>

      {/* 输入区 */}
      <div className="morsetool__input-section">
        <label className="morsetool__label">
          {mode === 'encode' ? '输入文本' : '输入摩斯码'}
          <span className="morsetool__stat">{input.length} 字符</span>
        </label>
        <textarea
          className="morsetool__textarea"
          placeholder={
            mode === 'encode'
              ? '输入要编码的文本（支持字母、数字、标点）...'
              : '输入摩斯码（. 和 - 组合，字符间空格分隔，单词间 / 分隔）...'
          }
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          spellCheck={false}
        />
      </div>

      {/* 警告信息 */}
      {warnings.length > 0 && (
        <div className="morsetool__warnings">
          {warnings.map((w, idx) => (
            <p key={idx}>{w}</p>
          ))}
        </div>
      )}

      {/* 结果区 */}
      <div className="morsetool__result-section">
        <label className="morsetool__label">
          {mode === 'encode' ? '摩斯码结果' : '解码文本结果'}
          <span className="morsetool__stat">{result.length} 字符</span>
        </label>
        <div className="morsetool__result" role="textbox" aria-readonly="true">
          {result || <span className="morsetool__result-empty">（结果将在此显示）</span>}
        </div>
      </div>

      {/* 音频控制区（仅编码模式显示） */}
      {mode === 'encode' && audioSupported && (
        <div className="morsetool__audio">
          <div className="morsetool__audio-controls">
            <div className="morsetool__slider-group">
              <label className="morsetool__slider-label">
                速度
                <span className="morsetool__slider-value">{wpm} WPM</span>
              </label>
              <input
                type="range"
                min="5"
                max="40"
                value={wpm}
                onChange={(e) => setWpm(Number(e.currentTarget.value))}
                className="morsetool__slider"
              />
            </div>
            <div className="morsetool__slider-group">
              <label className="morsetool__slider-label">
                音高
                <span className="morsetool__slider-value">{freq} Hz</span>
              </label>
              <input
                type="range"
                min="300"
                max="1000"
                step="50"
                value={freq}
                onChange={(e) => setFreq(Number(e.currentTarget.value))}
                className="morsetool__slider"
              />
            </div>
          </div>
          <div className="morsetool__play-controls">
            {!isPlaying ? (
              <button
                className="btn btn--sm"
                onClick={handlePlay}
                disabled={!result}
              >
                播放音频
              </button>
            ) : (
              <button className="btn btn--sm btn--danger" onClick={handleStop}>
                停止播放
              </button>
            )}
            {result && (
              <span className="morsetool__duration">
                预计时长 ≈ {(playDuration / 1000).toFixed(1)} 秒
              </span>
            )}
          </div>
        </div>
      )}

      {/* 摩斯码速查表 */}
      <details className="morsetool__cheatsheet">
        <summary>摩斯码速查表（点击展开）</summary>
        <div className="morsetool__cheatsheet-grid">
          {Object.entries(MORSE_TABLE).map(([char, code]) => (
            <div key={char} className="morsetool__cheatsheet-item">
              <span className="morsetool__cheatsheet-char">{char}</span>
              <span className="morsetool__cheatsheet-code">{code}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

/**
 * 调度单个 beep 信号
 * 使用 OscillatorNode + GainNode 生成正弦波，带淡入淡出避免爆音
 */
function scheduleBeep(ctx: AudioContext, startTime: number, duration: number, frequency: number) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;

  // ADSR 包络简化版：快速淡入 + 持续 + 快速淡出，避免爆音
  const fadeTime = Math.min(0.005, duration / 4); // 5ms 或信号时长的 1/4
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(0.3, startTime + fadeTime); // 淡入
  gain.gain.setValueAtTime(0.3, startTime + duration - fadeTime); // 持续
  gain.gain.linearRampToValueAtTime(0, startTime + duration); // 淡出

  oscillator.connect(gain);
  gain.connect(ctx.destination);

  oscillator.start(startTime);
  oscillator.stop(startTime + duration);
}
