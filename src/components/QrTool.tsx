import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { copyText } from '../utils/clipboard';

/**
 * 二维码生成器
 * 全部在浏览器本地处理，不发起任何网络请求。
 *
 * 功能：
 *  - 文本 / URL / WiFi / 邮件 四类预设，一键载入示例
 *  - 容错等级 L/M/Q/H（7% / 15% / 25% / 30% 数据恢复能力）
 *  - 尺寸（128-512px）、留白（1-8 模块）可调
 *  - 前景 / 背景色自定义（含对比度提示，避免扫描失败）
 *  - 实时渲染到 Canvas，支持下载 PNG / SVG、复制 Data URL
 *  - 显示版本号、模块数、字节数等技术指标
 */

type ErrorLevel = 'L' | 'M' | 'Q' | 'H';
type PresetKey = 'url' | 'text' | 'wifi' | 'email';

interface Preset {
  key: PresetKey;
  label: string;
  value: string;
  hint: string;
}

interface QrStats {
  version: number; // QR 版本（1-40）
  modules: number; // 模块数（= 17 + 4 * version）
  bytes: number; // 编码后字节数
  segmentMode: string; // 主段模式（Numeric/Alphanumeric/Byte/Kanji）
}

const PRESETS: Preset[] = [
  {
    key: 'url',
    label: '网址',
    value: 'https://toolbox.example.com/json',
    hint: 'URL 二维码最常见，扫码即可跳转',
  },
  {
    key: 'text',
    label: '纯文本',
    value: '工具盒子 · 零广告全本地处理的中文开发者工具集',
    hint: '任意文本均可编码，中文按 UTF-8 字节模式编码',
  },
  {
    key: 'wifi',
    label: 'WiFi 配置',
    value: 'WIFI:T:WPA;S:HomeNetwork;P:Password123;H:false;;',
    hint: '扫码后系统识别为 WiFi 配置（Android 原生支持，iOS 需快捷指令）',
  },
  {
    key: 'email',
    label: '邮件',
    value: 'mailto:contact@example.com?subject=你好&body=来自工具盒子的二维码',
    hint: 'mailto 协议，扫码后唤起邮件客户端',
  },
];

const ERROR_LEVELS: { value: ErrorLevel; label: string; desc: string }[] = [
  { value: 'L', label: 'L · 7%', desc: '约 7% 数据可恢复，适合干净环境' },
  { value: 'M', label: 'M · 15%', desc: '约 15% 数据可恢复，默认级别' },
  { value: 'Q', label: 'Q · 25%', desc: '约 25% 数据可恢复，适合有少量污损' },
  { value: 'H', label: 'H · 30%', desc: '约 30% 数据可恢复，适合物流 / 工业场景' },
];

const SIZE_MIN = 128;
const SIZE_MAX = 512;
const SIZE_STEP = 16;

/** 校验十六进制颜色，返回 #RRGGBB 或 null */
function normalizeHex(input: string): string | null {
  const trimmed = input.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    // 简写展开为完整形式
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

/** 将 #RRGGBB 转为 #RRGGBBAA（qrcode 库要求带 alpha 通道） */
function hexToRgba(hex: string, alpha = 1): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}${a}`;
}

/** 计算两个颜色的相对亮度差，判断对比度是否足够扫描 */
function checkContrast(fg: string, bg: string): { ok: boolean; ratio: number } {
  const lum = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    // sRGB 亮度公式
    const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  };
  const l1 = lum(fg);
  const l2 = lum(bg);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  // QR 扫描对比度阈值约 3.0（参考 ISO/IEC 18004）
  return { ok: ratio >= 3.0, ratio };
}

/** 触发浏览器下载文件 */
function downloadBlob(filename: string, content: string | Blob, mimeType: string): void {
  const blob = typeof content === 'string' ? new Blob([content], { type: mimeType }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function QrTool() {
  const [text, setText] = useState<string>(PRESETS[0].value);
  const [errorLevel, setErrorLevel] = useState<ErrorLevel>('M');
  const [size, setSize] = useState<number>(256);
  const [margin, setMargin] = useState<number>(4);
  const [fgInput, setFgInput] = useState<string>('#000000');
  const [bgInput, setBgInput] = useState<string>('#ffffff');
  const [live, setLive] = useState<boolean>(true);
  const [notice, setNotice] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [dataUrl, setDataUrl] = useState<string>('');
  const [svgStr, setSvgStr] = useState<string>('');
  const [stats, setStats] = useState<QrStats | null>(null);
  const [genError, setGenError] = useState<string>('');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

  // 校验颜色输入
  const fgHex = useMemo(() => normalizeHex(fgInput), [fgInput]);
  const bgHex = useMemo(() => normalizeHex(bgInput), [bgInput]);
  const contrast = useMemo(() => {
    if (!fgHex || !bgHex) return null;
    return checkContrast(fgHex, bgHex);
  }, [fgHex, bgHex]);

  /** 显示临时提示 */
  const flashNotice = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 1800);
  }, []);

  /** 生成二维码核心函数：渲染到 canvas 并同步生成 dataUrl / svg / stats */
  const generate = useCallback(async () => {
    setGenError('');
    if (!text.trim()) {
      setStats(null);
      setDataUrl('');
      setSvgStr('');
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }
    if (!fgHex || !bgHex) {
      setGenError('颜色格式应为 #RRGGBB 或 #RGB（如 #000000、#fff）');
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      // 先用 QRCode.create 取统计信息
      const qrData = QRCode.create(text, { errorCorrectionLevel: errorLevel });
      const seg = qrData.segments[0];
      const modeName = seg && seg.mode ? seg.mode.id : 'Byte';
      setStats({
        version: qrData.version,
        modules: qrData.modules.size,
        bytes: qrData.segments.reduce((acc, s) => acc + (s.data as Uint8Array | string).length, 0),
        segmentMode: modeName,
      });

      const opts = {
        errorCorrectionLevel: errorLevel,
        margin,
        width: size,
        color: {
          dark: hexToRgba(fgHex, 1),
          light: hexToRgba(bgHex, 1),
        },
      };

      // 渲染到 canvas
      await QRCode.toCanvas(canvas, text, opts);
      // 同步生成 PNG dataUrl 与 SVG 字符串
      const pngUrl = canvas.toDataURL('image/png');
      setDataUrl(pngUrl);
      const svg = await QRCode.toString(text, { ...opts, type: 'svg' });
      setSvgStr(svg);
    } catch (e) {
      setGenError(`生成失败：${e instanceof Error ? e.message : String(e)}`);
      setStats(null);
      setDataUrl('');
      setSvgStr('');
    }
  }, [text, errorLevel, size, margin, fgHex, bgHex]);

  /** 实时模式：参数变化自动重新生成 */
  useEffect(() => {
    if (!live) return;
    generate();
  }, [live, generate]);

  /** 应用预设 */
  const applyPreset = useCallback((p: Preset) => {
    setText(p.value);
    setNotice(p.hint);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 3000);
  }, []);

  /** 复制 PNG dataUrl */
  const handleCopyDataUrl = useCallback(async () => {
    if (!dataUrl) {
      flashNotice('暂无可复制内容');
      return;
    }
    const ok = await copyText(dataUrl);
    if (ok) {
      setCopied(true);
      flashNotice('已复制 Data URL');
      setTimeout(() => setCopied(false), 1500);
    } else {
      flashNotice('复制失败，请手动复制');
    }
  }, [dataUrl, flashNotice]);

  /** 下载 PNG */
  const handleDownloadPng = useCallback(() => {
    if (!dataUrl) {
      flashNotice('暂无可下载内容');
      return;
    }
    // dataUrl 直接转 Blob 节省内存
    const base64 = dataUrl.split(',')[1];
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    downloadBlob('qrcode.png', new Blob([bytes], { type: 'image/png' }), 'image/png');
    flashNotice('已下载 PNG');
  }, [dataUrl, flashNotice]);

  /** 下载 SVG */
  const handleDownloadSvg = useCallback(() => {
    if (!svgStr) {
      flashNotice('暂无可下载内容');
      return;
    }
    downloadBlob('qrcode.svg', svgStr, 'image/svg+xml');
    flashNotice('已下载 SVG');
  }, [svgStr, flashNotice]);

  /** 清空 */
  const handleClear = useCallback(() => {
    setText('');
    setNotice('');
    setGenError('');
    setCopied(false);
  }, []);

  // 输入字符数与预估版本提示
  const charCount = text.length;
  const tooLong = charCount > 2900; // QR v40 Byte 模式上限约 2953 字节

  return (
    <div className="jsontool qrtool">
      {/* 工具栏 */}
      <div className="jsontool__toolbar" role="toolbar" aria-label="二维码生成器操作">
        <div className="jsontool__actions">
          <button
            className="btn btn--primary btn--sm"
            onClick={generate}
            disabled={!live}
            title={live ? '实时模式已开启，自动生成' : '点击生成二维码'}
          >
            生成二维码
          </button>
          <button className="btn btn--sm" onClick={handleClear}>清空</button>
        </div>
        <div className="jsontool__options">
          {/* 预设按钮组 */}
          <div className="qrtool__presets" role="group" aria-label="预设内容">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                className="btn btn--sm qrtool__preset"
                onClick={() => applyPreset(p)}
                title={p.hint}
              >
                {p.label}
              </button>
            ))}
          </div>
          {/* 实时模式开关 */}
          <label className="uuidtool__toggle">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
            <span>实时生成</span>
          </label>
        </div>
      </div>

      {/* 主体：左输入 + 右预览 */}
      <div className="jsontool__panels qrtool__panels">
        {/* 输入区 */}
        <div className="jsontool__panel">
          <div className="jsontool__label">
            <span>输入内容（{charCount} 字符）</span>
          </div>
          <textarea
            className="jsontool__textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="输入文本、URL、WiFi 配置或邮件链接…"
            aria-label="二维码输入内容"
            rows={10}
            spellCheck={false}
          />
          {tooLong && (
            <p className="qrtool__warn" role="alert">
              内容较长（{charCount} 字符），可能超出 QR v40 容量上限（约 2953 字节），建议拆分或使用短链接。
            </p>
          )}

          {/* 参数控制 */}
          <div className="qrtool__controls">
            {/* 容错等级 */}
            <div className="qrtool__field">
              <label className="qrtool__field-label" htmlFor="qr-error-level">容错等级</label>
              <select
                id="qr-error-level"
                className="uuidtool__select"
                value={errorLevel}
                onChange={(e) => setErrorLevel(e.target.value as ErrorLevel)}
              >
                {ERROR_LEVELS.map((lv) => (
                  <option key={lv.value} value={lv.value}>{lv.label}</option>
                ))}
              </select>
              <span className="qrtool__field-hint">
                {ERROR_LEVELS.find((lv) => lv.value === errorLevel)?.desc}
              </span>
            </div>

            {/* 尺寸 */}
            <div className="qrtool__field">
              <label className="qrtool__field-label" htmlFor="qr-size">尺寸：{size}px</label>
              <input
                id="qr-size"
                type="range"
                min={SIZE_MIN}
                max={SIZE_MAX}
                step={SIZE_STEP}
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                className="qrtool__range"
              />
            </div>

            {/* 留白 */}
            <div className="qrtool__field">
              <label className="qrtool__field-label" htmlFor="qr-margin">留白：{margin} 模块</label>
              <input
                id="qr-margin"
                type="range"
                min={0}
                max={8}
                step={1}
                value={margin}
                onChange={(e) => setMargin(Number(e.target.value))}
                className="qrtool__range"
              />
            </div>

            {/* 颜色 */}
            <div className="qrtool__field qrtool__colors">
              <div className="qrtool__color-item">
                <label htmlFor="qr-fg">前景色</label>
                <input
                  id="qr-fg"
                  type="color"
                  value={fgHex || '#000000'}
                  onChange={(e) => setFgInput(e.target.value)}
                  className="qrtool__color-picker"
                  aria-label="前景色"
                />
                <input
                  type="text"
                  value={fgInput}
                  onChange={(e) => setFgInput(e.target.value)}
                  className="qrtool__color-text"
                  maxLength={7}
                  aria-label="前景色 HEX 值"
                />
              </div>
              <div className="qrtool__color-item">
                <label htmlFor="qr-bg">背景色</label>
                <input
                  id="qr-bg"
                  type="color"
                  value={bgHex || '#ffffff'}
                  onChange={(e) => setBgInput(e.target.value)}
                  className="qrtool__color-picker"
                  aria-label="背景色"
                />
                <input
                  type="text"
                  value={bgInput}
                  onChange={(e) => setBgInput(e.target.value)}
                  className="qrtool__color-text"
                  maxLength={7}
                  aria-label="背景色 HEX 值"
                />
              </div>
            </div>

            {/* 对比度提示 */}
            {contrast && !contrast.ok && (
              <p className="qrtool__warn" role="alert">
                前景与背景对比度 {contrast.ratio.toFixed(2)}:1 偏低，建议 ≥ 3:1 以保证扫描成功率。
              </p>
            )}
            {(!fgHex || !bgHex) && (
              <p className="qrtool__warn" role="alert">
                颜色格式应为 #RRGGBB 或 #RGB（如 #000000、#fff）。
              </p>
            )}
          </div>
        </div>

        {/* 预览区 */}
        <div className="jsontool__panel qrtool__preview-panel">
          <div className="jsontool__label">
            <span>预览</span>
            <div className="qrtool__preview-actions">
              <button
                className="btn btn--sm"
                onClick={handleCopyDataUrl}
                disabled={!dataUrl}
              >
                {copied ? '已复制' : '复制 Data URL'}
              </button>
              <button
                className="btn btn--sm"
                onClick={handleDownloadPng}
                disabled={!dataUrl}
              >
                下载 PNG
              </button>
              <button
                className="btn btn--sm"
                onClick={handleDownloadSvg}
                disabled={!svgStr}
              >
                下载 SVG
              </button>
            </div>
          </div>

          <div className="qrtool__canvas-wrap" role="img" aria-label="二维码预览">
            <canvas
              ref={canvasRef}
              className="qrtool__canvas"
              aria-label="二维码图像"
            />
            {!text.trim() && (
              <p className="qrtool__empty">输入内容后将在此显示二维码</p>
            )}
          </div>

          {/* 技术指标 */}
          {stats && (
            <dl className="qrtool__stats">
              <div className="qrtool__stat-item">
                <dt>版本</dt>
                <dd>v{stats.version}</dd>
              </div>
              <div className="qrtool__stat-item">
                <dt>模块数</dt>
                <dd>{stats.modules} × {stats.modules}</dd>
              </div>
              <div className="qrtool__stat-item">
                <dt>编码模式</dt>
                <dd>{stats.segmentMode}</dd>
              </div>
              <div className="qrtool__stat-item">
                <dt>字符数</dt>
                <dd>{charCount}</dd>
              </div>
            </dl>
          )}

          {/* 生成错误 */}
          {genError && (
            <p className="qrtool__error" role="alert">{genError}</p>
          )}
        </div>
      </div>

      {/* 状态条 */}
      <div className="jsontool__status" role="status" aria-live="polite">
        {notice ? (
          <div className="jsontool__notice">{notice}</div>
        ) : (
          <div className="jsontool__hint">
            使用 qrcode 库在浏览器本地生成，支持 PNG / SVG 下载。所有数据不离开你的设备。
          </div>
        )}
      </div>
    </div>
  );
}
