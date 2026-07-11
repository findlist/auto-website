import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import exifr from 'exifr';
import { formatBytes } from '../utils/base64Image';

/**
 * EXIF 元数据查看器
 * 全部在浏览器本地用 exifr 解析，不发起任何网络请求。
 *
 * 功能：
 *  - 支持 JPEG / TIFF / PNG / WebP / HEIC 等格式的 EXIF / IPTC / XMP / ICC 元数据解析
 *  - 分类展示：文件信息、图片属性、相机信息、拍摄参数、GPS 定位、时间信息、软件版权
 *  - GPS 坐标自动转换为十进制度数并提供地图链接
 *  - 支持搜索过滤、JSON 原始数据视图、一键复制
 *
 * 适用场景：查看照片拍摄参数、检查图片元数据、定位照片拍摄地点、隐私检查
 */

/** 输入文件大小上限：50MB */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** 元数据分组定义：键名 → 中文标签 */
interface TagGroup {
  title: string;
  icon: string;
  tags: string[];
}

/** 常见 EXIF 标签的中文标签映射 */
const TAG_LABELS: Record<string, string> = {
  // 图片属性
  ImageWidth: '图片宽度',
  ImageHeight: '图片高度',
  ExifImageWidth: 'EXIF 图片宽度',
  ExifImageHeight: 'EXIF 图片高度',
  Orientation: '方向',
  ResolutionUnit: '分辨率单位',
  XResolution: '水平分辨率',
  YResolution: '垂直分辨率',
  BitsPerSample: '每像素位数',
  Compression: '压缩方式',
  ColorSpace: '色彩空间',
  PhotometricInterpretation: '色彩解释',
  SamplesPerPixel: '每像素采样数',
  // 相机信息
  Make: '相机制造商',
  Model: '相机型号',
  LensModel: '镜头型号',
  LensMake: '镜头制造商',
  LensSpecification: '镜头规格',
  BodySerialNumber: '机身序列号',
  LensSerialNumber: '镜头序列号',
  Software: '软件',
  // 拍摄参数
  ISO: '感光度',
  ISOSpeedRatings: '感光度',
  FNumber: '光圈值',
  ApertureValue: '光圈',
  ExposureTime: '快门速度',
  ShutterSpeedValue: '快门速度',
  FocalLength: '焦距',
  FocalLengthIn35mmFormat: '35mm 等效焦距',
  ExposureCompensation: '曝光补偿',
  ExposureMode: '曝光模式',
  ExposureProgram: '曝光程序',
  Flash: '闪光灯',
  WhiteBalance: '白平衡',
  MeteringMode: '测光模式',
  SceneCaptureType: '场景类型',
  FocalPlaneXResolution: '焦平面 X 分辨率',
  FocalPlaneYResolution: '焦平面 Y 分辨率',
  FocalPlaneResolutionUnit: '焦平面分辨率单位',
  MaxApertureValue: '最大光圈',
  // GPS
  GPSLatitude: 'GPS 纬度',
  GPSLongitude: 'GPS 经度',
  GPSAltitude: 'GPS 海拔',
  GPSLatitudeRef: '纬度参考',
  GPSLongitudeRef: '经度参考',
  GPSAltitudeRef: '海拔参考',
  GPSImgDirection: '拍摄方向',
  GPSSpeed: 'GPS 速度',
  GPSDateStamp: 'GPS 日期',
  GPSTimeStamp: 'GPS 时间',
  // 时间
  DateTimeOriginal: '拍摄时间',
  CreateDate: '创建时间',
  ModifyDate: '修改时间',
  DateTimeDigitized: '数字化时间',
  OffsetTime: '时区偏移',
  // 版权
  Artist: '作者',
  Copyright: '版权',
  CopyrightNotice: '版权声明',
  UserComment: '用户注释',
  ImageDescription: '图片描述',
  // JPEG/PNG 专有
  JFIFVersion: 'JFIF 版本',
  ColorType: '颜色类型',
  BitDepth: '位深度',
  InterlaceMethod: '隔行扫描方式',
};

/** 分组定义 */
const GROUPS: TagGroup[] = [
  { title: '图片属性', icon: '🖼️', tags: ['ImageWidth', 'ImageHeight', 'ExifImageWidth', 'ExifImageHeight', 'Orientation', 'ResolutionUnit', 'XResolution', 'YResolution', 'BitsPerSample', 'Compression', 'ColorSpace', 'PhotometricInterpretation', 'SamplesPerPixel', 'BitDepth', 'ColorType', 'InterlaceMethod', 'JFIFVersion'] },
  { title: '相机与镜头', icon: '📷', tags: ['Make', 'Model', 'LensModel', 'LensMake', 'LensSpecification', 'BodySerialNumber', 'LensSerialNumber', 'Software'] },
  { title: '拍摄参数', icon: '⚙️', tags: ['ISO', 'ISOSpeedRatings', 'FNumber', 'ApertureValue', 'ExposureTime', 'ShutterSpeedValue', 'FocalLength', 'FocalLengthIn35mmFormat', 'ExposureCompensation', 'ExposureMode', 'ExposureProgram', 'Flash', 'WhiteBalance', 'MeteringMode', 'SceneCaptureType', 'MaxApertureValue', 'FocalPlaneXResolution', 'FocalPlaneYResolution', 'FocalPlaneResolutionUnit'] },
  { title: 'GPS 定位', icon: '📍', tags: ['GPSLatitude', 'GPSLongitude', 'GPSAltitude', 'GPSLatitudeRef', 'GPSLongitudeRef', 'GPSAltitudeRef', 'GPSImgDirection', 'GPSSpeed', 'GPSDateStamp', 'GPSTimeStamp'] },
  { title: '时间信息', icon: '🕐', tags: ['DateTimeOriginal', 'CreateDate', 'ModifyDate', 'DateTimeDigitized', 'OffsetTime'] },
  { title: '版权与描述', icon: '📝', tags: ['Artist', 'Copyright', 'CopyrightNotice', 'UserComment', 'ImageDescription'] },
];

/** 图片预览信息 */
interface ImagePreview {
  file: File;
  url: string;
  width: number;
  height: number;
}

/** 解析后的元数据（exifr 返回的扁平对象） */
type ExifData = Record<string, unknown>;

/** 格式化标签值用于展示 */
function formatTagValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  // GPS 坐标特殊处理：exifr 已 revive 为十进制度数
  if (key === 'GPSLatitude' || key === 'GPSLongitude') {
    return typeof value === 'number' ? `${value.toFixed(6)}°` : String(value);
  }
  // 海拔
  if (key === 'GPSAltitude') {
    return typeof value === 'number' ? `${value.toFixed(1)} 米` : String(value);
  }
  // 快门速度：小于 1 秒显示为 1/x
  if (key === 'ExposureTime' && typeof value === 'number') {
    if (value < 1 && value > 0) {
      const denom = Math.round(1 / value);
      return `1/${denom} 秒`;
    }
    return `${value} 秒`;
  }
  // 光圈值
  if (key === 'FNumber' && typeof value === 'number') {
    return `f/${value}`;
  }
  // 焦距
  if ((key === 'FocalLength' || key === 'FocalLengthIn35mmFormat') && typeof value === 'number') {
    return `${value} mm`;
  }
  // ISO
  if (key === 'ISO' || key === 'ISOSpeedRatings') {
    return `ISO ${value}`;
  }
  // 闪光灯状态
  if (key === 'Flash' && typeof value === 'number') {
    return (value & 1) === 1 ? '已开启' : '未开启';
  }
  // 数组类型（如 BitsPerSample）
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  return String(value);
}

/** 将标签键名转为中文标签 */
function getTagLabel(key: string): string {
  return TAG_LABELS[key] ?? key;
}

/** 从 GPS 数据生成地图链接 */
function buildMapLink(data: ExifData): string | null {
  const lat = data['GPSLatitude'];
  const lon = data['GPSLongitude'];
  if (typeof lat === 'number' && typeof lon === 'number') {
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
  }
  return null;
}

export default function ExifTool() {
  const [preview, setPreview] = useState<ImagePreview | null>(null);
  const [exifData, setExifData] = useState<ExifData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  /** 释放旧 ObjectURL，避免内存泄漏 */
  const revokeUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  /** 加载图片并解析 EXIF */
  const loadFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件（JPEG / PNG / WebP / TIFF / HEIC）');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError(`文件过大（${formatBytes(file.size)}），上限 50MB`);
      return;
    }
    // 清理旧状态
    revokeUrl();
    setError(null);
    setExifData(null);
    setSearch('');
    setShowRaw(false);
    setLoading(true);

    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;

    // 加载图片获取原始尺寸
    const img = new Image();
    img.onload = async () => {
      setPreview({ file, url, width: img.naturalWidth, height: img.naturalHeight });
      // 解析 EXIF 元数据（含 TIFF/EXIF/GPS/IPTC/XMP/ICC，翻译键值）
      try {
        const data = await exifr.parse(file, {
          tiff: true,
          exif: true,
          gps: true,
          iptc: true,
          xmp: true,
          icc: true,
          jfif: true,
          ihdr: true,
          translateKeys: true,
          translateValues: true,
          reviveValues: true,
          mergeOutput: true,
        });
        setExifData(data ?? {});
      } catch (err) {
        // 解析失败不阻断，仅提示
        setExifData({});
        setError(`EXIF 解析异常：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setLoading(false);
      }
    };
    img.onerror = () => {
      setLoading(false);
      setError('图片加载失败，可能为不支持的格式或文件已损坏');
    };
    img.src = url;
  }, [revokeUrl]);

  /** 组件卸载时释放 ObjectURL */
  useEffect(() => () => revokeUrl(), [revokeUrl]);

  /** 处理拖拽 */
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  }, [loadFile]);

  /** 处理粘贴 */
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) loadFile(file);
        break;
      }
    }
  }, [loadFile]);

  /** 复制全部元数据为 JSON */
  const copyAll = useCallback(async () => {
    if (!exifData) return;
    const json = JSON.stringify(exifData, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('复制失败，请手动选择文本复制');
    }
  }, [exifData]);

  /** 重置全部状态 */
  const reset = useCallback(() => {
    revokeUrl();
    setPreview(null);
    setExifData(null);
    setError(null);
    setSearch('');
    setShowRaw(false);
    setLoading(false);
    if (inputRef.current) inputRef.current.value = '';
  }, [revokeUrl]);

  /** 按分组整理标签，并应用搜索过滤 */
  const groupedTags = useMemo(() => {
    if (!exifData) return [];
    const lowerSearch = search.trim().toLowerCase();
    return GROUPS.map((group) => {
      const entries = group.tags
        .filter((key) => exifData[key] !== undefined && exifData[key] !== null)
        .map((key) => ({
          key,
          label: getTagLabel(key),
          value: formatTagValue(key, exifData[key]),
        }))
        .filter((entry) => {
          if (!lowerSearch) return true;
          return entry.label.toLowerCase().includes(lowerSearch)
            || entry.key.toLowerCase().includes(lowerSearch)
            || entry.value.toLowerCase().includes(lowerSearch);
        });
      return { ...group, entries };
    }).filter((group) => group.entries.length > 0);
  }, [exifData, search]);

  /** 未分类标签（不在任何预定义分组中） */
  const uncategorizedTags = useMemo(() => {
    if (!exifData) return [];
    const definedKeys = new Set(GROUPS.flatMap((g) => g.tags));
    const lowerSearch = search.trim().toLowerCase();
    return Object.entries(exifData)
      .filter(([key, val]) => !definedKeys.has(key) && val !== undefined && val !== null)
      .map(([key, val]) => ({ key, label: getTagLabel(key), value: formatTagValue(key, val) }))
      .filter((entry) => {
        if (!lowerSearch) return true;
        return entry.label.toLowerCase().includes(lowerSearch)
          || entry.key.toLowerCase().includes(lowerSearch)
          || entry.value.toLowerCase().includes(lowerSearch);
      });
  }, [exifData, search]);

  const mapLink = useMemo(() => (exifData ? buildMapLink(exifData) : null), [exifData]);
  const hasMetadata = groupedTags.length > 0 || uncategorizedTags.length > 0;

  // 空状态：未加载图片
  if (!preview) {
    return (
      <div
        className="exif"
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onPaste={handlePaste}
        tabIndex={0}
      >
        <div
          className={`exif__dropzone${dragActive ? ' exif__dropzone--active' : ''}`}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
        >
          <div className="exif__dropzone-icon">📷</div>
          <div className="exif__dropzone-text">拖拽图片到此处 / 点击选择 / 粘贴（Ctrl+V）</div>
          <div className="exif__dropzone-hint">支持 JPEG / PNG / WebP / TIFF / HEIC，最大 50MB</div>
          <div className="exif__dropzone-hint">全本地解析，图片不会上传服务器</div>
        </div>
        {error && <div className="exif__error" role="alert">{error}</div>}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="exif__file-input"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); }}
        />
      </div>
    );
  }

  return (
    <div className="exif" onPaste={handlePaste} tabIndex={0}>
      {/* 图片预览 + 文件信息 */}
      <div className="exif__preview-bar">
        <div className="exif__thumb">
          <img src={preview.url} alt="预览图" loading="lazy" />
        </div>
        <div className="exif__file-info">
          <div className="exif__file-name" title={preview.file.name}>{preview.file.name}</div>
          <div className="exif__file-meta">
            {formatBytes(preview.file.size)} · {preview.file.type || '未知类型'} · {preview.width}×{preview.height}
          </div>
          {loading && <div className="exif__loading">正在解析元数据…</div>}
        </div>
        <div className="exif__actions">
          <button className="exif__btn" onClick={() => inputRef.current?.click()} type="button">更换图片</button>
          <button className="exif__btn exif__btn--ghost" onClick={reset} type="button">清空</button>
        </div>
      </div>

      {error && <div className="exif__error" role="alert">{error}</div>}

      {/* 工具栏：搜索 + 视图切换 + 复制 */}
      {exifData && (
        <div className="exif__toolbar">
          <input
            className="exif__search"
            type="search"
            placeholder="搜索标签名或值…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="exif__toolbar-btns">
            <button
              className={`exif__btn${!showRaw ? '' : ' exif__btn--ghost'}`}
              onClick={() => setShowRaw(false)}
              type="button"
            >分类视图</button>
            <button
              className={`exif__btn${showRaw ? '' : ' exif__btn--ghost'}`}
              onClick={() => setShowRaw(true)}
              type="button"
            >JSON 原始数据</button>
            <button
              className="exif__btn exif__btn--ghost"
              onClick={copyAll}
              type="button"
              disabled={!hasMetadata}
            >{copied ? '✓ 已复制' : '复制 JSON'}</button>
          </div>
        </div>
      )}

      {/* 元数据展示 */}
      {exifData && !loading && (
        <>
          {!hasMetadata && (
            <div className="exif__empty">
              <div className="exif__empty-icon">📭</div>
              <div>该图片未包含 EXIF 元数据</div>
              <div className="exif__empty-hint">
                常见原因：图片经过压缩工具处理（如微信、微博）、由纯绘图软件生成、或导出时已剥离元数据
              </div>
            </div>
          )}

          {/* 分类视图 */}
          {!showRaw && hasMetadata && (
            <div className="exif__groups">
              {/* GPS 地图链接卡片 */}
              {mapLink && (
                <div className="exif__map-card">
                  <span className="exif__map-icon">📍</span>
                  <span>拍摄位置：{formatTagValue('GPSLatitude', exifData['GPSLatitude'])}，{formatTagValue('GPSLongitude', exifData['GPSLongitude'])}</span>
                  <a href={mapLink} target="_blank" rel="noopener noreferrer" className="exif__map-link">在地图中查看 →</a>
                </div>
              )}
              {groupedTags.map((group) => (
                <div key={group.title} className="exif__group">
                  <h3 className="exif__group-title">{group.icon} {group.title}</h3>
                  <dl className="exif__tag-list">
                    {group.entries.map((entry) => (
                      <div key={entry.key} className="exif__tag-row">
                        <dt>{entry.label}</dt>
                        <dd>{entry.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
              {uncategorizedTags.length > 0 && (
                <div className="exif__group">
                  <h3 className="exif__group-title">📋 其他元数据</h3>
                  <dl className="exif__tag-list">
                    {uncategorizedTags.map((entry) => (
                      <div key={entry.key} className="exif__tag-row">
                        <dt>{entry.label}</dt>
                        <dd>{entry.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          )}

          {/* JSON 原始数据视图 */}
          {showRaw && hasMetadata && (
            <pre className="exif__raw-json">{JSON.stringify(exifData, null, 2)}</pre>
          )}
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="exif__file-input"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); }}
      />
    </div>
  );
}
