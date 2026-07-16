/**
 * User-Agent 字符串解析与识别模块
 *
 * 基于 UA-CH 时代之前的历史 UA 字符串格式解析，覆盖主流浏览器、操作系统、设备、引擎与爬虫识别。
 * 解析策略：正则模式匹配 + 优先级覆盖（先匹配高特异性标签，再回退通用标签）。
 * 所有数据内置在浏览器本地，零网络请求、零上传。
 */

// ============== 类型定义 ==============

/** 浏览器识别结果 */
export interface BrowserInfo {
  /** 浏览器名称，如 Chrome / Edge / Firefox */
  name: string;
  /** 主版本号字符串，如 120 */
  version: string;
}

/** 操作系统识别结果 */
export interface OsInfo {
  /** 系统名称，如 Windows / macOS / Android / iOS */
  name: string;
  /** 版本号字符串，如 10.15.7 / 14.0 */
  version: string;
}

/** 设备识别结果 */
export interface DeviceInfo {
  /** 设备类型：desktop / mobile / tablet / bot / unknown */
  type: 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown';
  /** 厂商，如 Apple / Samsung / Huawei（无法判定时为空） */
  vendor: string;
  /** 型号，如 iPhone / SM-S9080（无法判定时为空） */
  model: string;
}

/** 渲染引擎识别结果 */
export interface EngineInfo {
  /** 引擎名称，如 Blink / WebKit / Gecko / Trident */
  name: string;
  /** 引擎版本号 */
  version: string;
}

/** 完整解析结果 */
export interface ParsedUA {
  /** 原始 UA 字符串 */
  ua: string;
  /** 浏览器信息 */
  browser: BrowserInfo | null;
  /** 操作系统信息 */
  os: OsInfo | null;
  /** 设备信息 */
  device: DeviceInfo;
  /** 渲染引擎信息 */
  engine: EngineInfo | null;
  /** 若是爬虫/机器人，返回其名称；否则为 null */
  bot: { name: string; category: string } | null;
  /** 是否为爬虫/机器人 */
  isBot: boolean;
  /** 是否为移动设备（mobile 或 tablet） */
  isMobile: boolean;
  /** 是否为桌面端 */
  isDesktop: boolean;
}

// ============== 模式定义 ==============

/**
 * 模式表通用结构：regex 为识别正则，name 为识别后输出的名称，
 * versionGroup 为版本号捕获组索引（0 表示无版本号）。
 * 优先级规则：数组顺序即匹配顺序，先匹配到的优先返回。
 * 因此高特异性条目（如 Edge 必须在 Chrome 之前匹配）需排在前面。
 */
interface Pattern {
  regex: RegExp;
  name: string;
  versionGroup: number;
}

/** 浏览器识别表（顺序敏感：特异性高的在前，避免被通用 Chromium 模式抢先匹配） */
const BROWSER_PATTERNS: Pattern[] = [
  // —— 国产 / 应用内 WebView 优先（它们也带 Chrome，必须先匹配）——
  { regex: /MicroMessenger\/([\d.]+)/, name: '微信', versionGroup: 1 },
  { regex: /QQ\/([\d.]+)/, name: '手机 QQ', versionGroup: 1 },
  { regex: /QQBrowser\/([\d.]+)/, name: 'QQ 浏览器', versionGroup: 1 },
  { regex: /MQQBrowser\/([\d.]+)/, name: 'QQ 浏览器', versionGroup: 1 },
  { regex: /DingTalk\/([\d.]+)/, name: '钉钉', versionGroup: 1 },
  { regex: /AlipayClient\/([\d.]+)/, name: '支付宝', versionGroup: 1 },
  { regex: /Weibo\/([\d.]+)/, name: '微博', versionGroup: 1 },
  { regex: /aweme\/([\d.]+)/, name: '抖音', versionGroup: 1 },
  { regex: /ByteLocale\/([\d.]+)/, name: '抖音火山版', versionGroup: 1 },
  { regex: /musical_ly\/([\d.]+)/, name: 'TikTok', versionGroup: 1 },
  { regex: /FBAN\/([\d.]+)/, name: 'Facebook', versionGroup: 1 },
  { regex: /FBAV\/([\d.]+)/, name: 'Facebook', versionGroup: 1 },
  { regex: /Instagram\/([\d.]+)/, name: 'Instagram', versionGroup: 1 },
  { regex: /WhatsApp\/([\d.]+)/, name: 'WhatsApp', versionGroup: 1 },
  { regex: /Line\/([\d.]+)/, name: 'LINE', versionGroup: 1 },
  { regex: /Slack\/([\d.]+)/, name: 'Slack', versionGroup: 1 },
  { regex: /TelegramBot[^/]*\/([\d.]+)/, name: 'Telegram Bot', versionGroup: 1 },
  { regex: /Telegram\/([\d.]+)/, name: 'Telegram', versionGroup: 1 },
  // —— 国产桌面浏览器 ——
  { regex: /Maxthon\/([\d.]+)/, name: '傲游浏览器', versionGroup: 1 },
  { regex: /TheWorld\/([\d.]+)/, name: '世界之窗', versionGroup: 1 },
  { regex: /LBBROWSER/, name: '猎豹浏览器', versionGroup: 0 },
  { regex: /MetaSr/, name: '搜狗浏览器', versionGroup: 0 },
  { regex: /SogouMobileBrowser\/([\d.]+)/, name: '搜狗浏览器', versionGroup: 1 },
  { regex: /QHBrowser\/([\d.]+)/, name: '360 浏览器', versionGroup: 1 },
  { regex: /360SE/, name: '360 安全浏览器', versionGroup: 0 },
  { regex: /360EE/, name: '360 极速浏览器', versionGroup: 0 },
  { regex: /360Aphone\/([\d.]+)/, name: '360 浏览器', versionGroup: 1 },
  { regex: /TaoBrowser/, name: '淘宝浏览器', versionGroup: 0 },
  { regex: /BaiduBoxApp\/([\d.]+)/, name: '百度 App', versionGroup: 1 },
  { regex: /BdHD\/([\d.]+)/, name: '百度浏览器', versionGroup: 1 },
  { regex: /UCBrowser\/([\d.]+)/, name: 'UC 浏览器', versionGroup: 1 },
  { regex: /UBrowser\/([\d.]+)/, name: 'UC 浏览器', versionGroup: 1 },
  { regex: /MiuiBrowser\/([\d.]+)/, name: '小米浏览器', versionGroup: 1 },
  { regex: /OppoBrowser\/([\d.]+)/, name: 'OPPO 浏览器', versionGroup: 1 },
  { regex: /VivoBrowser\/([\d.]+)/, name: 'vivo 浏览器', versionGroup: 1 },
  { regex: /HeyTapBrowser\/([\d.]+)/, name: '一加浏览器', versionGroup: 1 },
  { regex: /HUAWEIBrowser\/([\d.]+)/, name: '华为浏览器', versionGroup: 1 },
  { regex: /Quark\/([\d.]+)/, name: '夸克浏览器', versionGroup: 1 },
  { regex: /Vivaldi\/([\d.]+)/, name: 'Vivaldi', versionGroup: 1 },
  { regex: /YaBrowser\/([\d.]+)/, name: 'Yandex Browser', versionGroup: 1 },
  { regex: /Seamonkey\/([\d.]+)/, name: 'SeaMonkey', versionGroup: 1 },
  // —— 主流国际浏览器 ——
  { regex: /Edg\/([\d.]+)/, name: 'Microsoft Edge', versionGroup: 1 },
  { regex: /Edge\/([\d.]+)/, name: 'Microsoft Edge (EdgeHTML)', versionGroup: 1 },
  { regex: /OPR\/([\d.]+)/, name: 'Opera', versionGroup: 1 },
  { regex: /Opera\/([\d.]+)/, name: 'Opera', versionGroup: 1 },
  { regex: /Opera Mobi\/([\d.]+)/, name: 'Opera Mobile', versionGroup: 1 },
  { regex: /Opera Mini\/([\d.]+)/, name: 'Opera Mini', versionGroup: 1 },
  { regex: /Opera Tablet\/([\d.]+)/, name: 'Opera Tablet', versionGroup: 1 },
  { regex: /Opt\/([\d.]+)/, name: 'Opera Touch', versionGroup: 1 },
  { regex: /SamsungBrowser\/([\d.]+)/, name: 'Samsung Internet', versionGroup: 1 },
  { regex: /CocCoc\/([\d.]+)/, name: 'Cốc Cốc', versionGroup: 1 },
  { regex: /Firefox\/([\d.]+)/, name: 'Firefox', versionGroup: 1 },
  { regex: /FxiOS\/([\d.]+)/, name: 'Firefox iOS', versionGroup: 1 },
  { regex: /Focus\/([\d.]+)/, name: 'Firefox Focus', versionGroup: 1 },
  { regex: /Brave\/([\d.]+)/, name: 'Brave', versionGroup: 1 },
  { regex: /MSIE ([\d.]+)/, name: 'Internet Explorer', versionGroup: 1 },
  { regex: /Trident\/[\d.]+.*rv:([\d.]+)/, name: 'Internet Explorer', versionGroup: 1 },
  { regex: /IEMobile\/([\d.]+)/, name: 'IE Mobile', versionGroup: 1 },
  { regex: /Chrome\/([\d.]+)/, name: 'Chrome', versionGroup: 1 },
  { regex: /CriOS\/([\d.]+)/, name: 'Chrome iOS', versionGroup: 1 },
  { regex: /Flock\/([\d.]+)/, name: 'Flock', versionGroup: 1 },
  { regex: /Safari\/([\d.]+)/, name: 'Safari', versionGroup: 1 },
  { regex: /Version\/([\d.]+).*Safari/, name: 'Safari', versionGroup: 1 },
  { regex: /Mobile\/[\d]+.*Safari/, name: 'Mobile Safari', versionGroup: 0 },
];

/** 操作系统识别表 */
const OS_PATTERNS: Pattern[] = [
  { regex: /Windows NT 10.0/, name: 'Windows', versionGroup: 0 },
  { regex: /Windows NT 6\.3/, name: 'Windows 8.1', versionGroup: 0 },
  { regex: /Windows NT 6\.2/, name: 'Windows 8', versionGroup: 0 },
  { regex: /Windows NT 6\.1/, name: 'Windows 7', versionGroup: 0 },
  { regex: /Windows NT 6\.0/, name: 'Windows Vista', versionGroup: 0 },
  { regex: /Windows NT 5\.1/, name: 'Windows XP', versionGroup: 0 },
  { regex: /Windows Phone(?: OS)? ([\d.]+)/, name: 'Windows Phone', versionGroup: 1 },
  { regex: /iPhone OS ([\d_]+)/, name: 'iOS', versionGroup: 1 },
  { regex: /iPad.*OS ([\d_]+)/, name: 'iPadOS', versionGroup: 1 },
  { regex: /CPU OS ([\d_]+)/, name: 'iPadOS', versionGroup: 1 },
  { regex: /Mac OS X ([\d_.]+)/, name: 'macOS', versionGroup: 1 },
  { regex: /Macintosh.*Mac OS X/, name: 'macOS', versionGroup: 0 },
  { regex: /Android ([\d.]+)/, name: 'Android', versionGroup: 1 },
  { regex: /Android/, name: 'Android', versionGroup: 0 },
  { regex: /HarmonyOS\/([\d.]+)/, name: 'HarmonyOS', versionGroup: 1 },
  { regex: /HarmonyOS/, name: 'HarmonyOS', versionGroup: 0 },
  { regex: /OpenHarmony/, name: 'OpenHarmony', versionGroup: 0 },
  { regex: /CrOS/, name: 'ChromeOS', versionGroup: 0 },
  { regex: /Ubuntu/, name: 'Ubuntu', versionGroup: 0 },
  { regex: /Fedora/, name: 'Fedora', versionGroup: 0 },
  { regex: /Debian/, name: 'Debian', versionGroup: 0 },
  { regex: /CentOS/, name: 'CentOS', versionGroup: 0 },
  { regex: /Arch Linux/, name: 'Arch Linux', versionGroup: 0 },
  { regex: /Linux/, name: 'Linux', versionGroup: 0 },
  { regex: /FreeBSD/, name: 'FreeBSD', versionGroup: 0 },
  { regex: /NetBSD/, name: 'NetBSD', versionGroup: 0 },
  { regex: /OpenBSD/, name: 'OpenBSD', versionGroup: 0 },
  { regex: /SunOS/, name: 'Solaris', versionGroup: 0 },
  { regex: /BlackBerry/, name: 'BlackBerry', versionGroup: 0 },
  { regex: /KAIOS/, name: 'KaiOS', versionGroup: 0 },
];

/** 渲染引擎识别表（顺序敏感） */
const ENGINE_PATTERNS: Pattern[] = [
  { regex: /Edge\/([\d.]+)/, name: 'EdgeHTML', versionGroup: 1 },
  { regex: /Blink\/([\d.]+)/, name: 'Blink', versionGroup: 1 },
  { regex: /AppleWebKit\/([\d.]+).*Chrome/, name: 'Blink', versionGroup: 1 },
  { regex: /AppleWebKit\/([\d.]+).*Safari/, name: 'WebKit', versionGroup: 1 },
  { regex: /AppleWebKit\/([\d.]+)/, name: 'WebKit', versionGroup: 1 },
  { regex: /Gecko\/([\d.]+)/, name: 'Gecko', versionGroup: 1 },
  { regex: /Trident\/([\d.]+)/, name: 'Trident', versionGroup: 1 },
  { regex: /Presto\/([\d.]+)/, name: 'Presto', versionGroup: 1 },
  { regex: /Servo\/([\d.]+)/, name: 'Servo', versionGroup: 1 },
  { regex: /KHTML\/([\d.]+)/, name: 'KHTML', versionGroup: 1 },
];

/**
 * 爬虫/机器人识别表。
 * category 取值：search（搜索引擎）/ social（社交平台）/ monitor（监控）/ crawler（通用爬虫）/ library（HTTP 库）/ feed（RSS）/ tool（工具）
 */
const BOT_PATTERNS: { regex: RegExp; name: string; category: string }[] = [
  // 搜索引擎
  { regex: /Googlebot(?:-Image)?\/?([\d.]*)/, name: 'Googlebot', category: 'search' },
  { regex: /Googlebot-News/, name: 'Googlebot News', category: 'search' },
  { regex: /Googlebot-Video/, name: 'Googlebot Video', category: 'search' },
  { regex: /AdsBot-Google/, name: 'AdsBot Google', category: 'search' },
  { regex: /Mediapartners-Google/, name: 'Google AdSense', category: 'search' },
  { regex: /bingbot\/([\d.]+)/, name: 'Bingbot', category: 'search' },
  { regex: /Baiduspider/, name: 'Baiduspider', category: 'search' },
  { regex: /Sogou web spider/, name: 'Sogou Spider', category: 'search' },
  { regex: /360Spider/, name: '360Spider', category: 'search' },
  { regex: /Bytespider/, name: 'Bytespider', category: 'search' },
  { regex: /PetalBot/, name: 'PetalBot（华为）', category: 'search' },
  { regex: /YandexBot\/([\d.]+)/, name: 'YandexBot', category: 'search' },
  { regex: /Applebot\/([\d.]+)/, name: 'Applebot', category: 'search' },
  { regex: /DuckDuckBot/, name: 'DuckDuckBot', category: 'search' },
  { regex: /Slurp/, name: 'Slurp（Yahoo）', category: 'search' },
  { regex: /AhrefsBot\/([\d.]+)/, name: 'AhrefsBot', category: 'search' },
  { regex: /SemrushBot/, name: 'SemrushBot', category: 'search' },
  { regex: /MJ12bot/, name: 'MJ12bot', category: 'search' },
  { regex: /DotBot/, name: 'DotBot', category: 'search' },
  { regex: /Baiduspider-render/, name: 'Baiduspider Render', category: 'search' },
  // 社交平台
  { regex: /facebookexternalhit/, name: 'Facebook Crawler', category: 'social' },
  { regex: /Twitterbot\/([\d.]+)/, name: 'Twitterbot', category: 'social' },
  { regex: /LinkedInBot/, name: 'LinkedInBot', category: 'social' },
  { regex: /WhatsApp/, name: 'WhatsApp Bot', category: 'social' },
  { regex: /TelegramBot/, name: 'Telegram Bot', category: 'social' },
  { regex: /Discordbot/, name: 'Discord Bot', category: 'social' },
  { regex: /Slackbot/, name: 'Slack Bot', category: 'social' },
  { regex: /Pinterest/, name: 'Pinterest Bot', category: 'social' },
  { regex: /Weibo/, name: 'Weibo Bot', category: 'social' },
  // 监控 / 性能
  { regex: /Pingdom/, name: 'Pingdom', category: 'monitor' },
  { regex: /GTmetrix/, name: 'GTmetrix', category: 'monitor' },
  { regex: /New Relic/, name: 'New Relic', category: 'monitor' },
  { regex: /Datadog/, name: 'Datadog', category: 'monitor' },
  { regex: /UptimeRobot/, name: 'UptimeRobot', category: 'monitor' },
  { regex: /Site24x7/, name: 'Site24x7', category: 'monitor' },
  // RSS / Feed
  { regex: /Feedly/, name: 'Feedly', category: 'feed' },
  { regex: /Inoreader/, name: 'Inoreader', category: 'feed' },
  { regex: /Feedfetcher/, name: 'Feedfetcher', category: 'feed' },
  // HTTP 库 / 工具
  { regex: /curl\/([\d.]+)/, name: 'curl', category: 'library' },
  { regex: /Wget\/([\d.]+)/, name: 'Wget', category: 'library' },
  { regex: /python-requests\/([\d.]+)/, name: 'Python Requests', category: 'library' },
  { regex: /Python-urllib\/([\d.]+)/, name: 'Python urllib', category: 'library' },
  { regex: /Go-http-client/, name: 'Go http client', category: 'library' },
  { regex: /okhttp\/([\d.]+)/, name: 'OkHttp', category: 'library' },
  { regex: /axios\/([\d.]+)/, name: 'axios', category: 'library' },
  { regex: /node-fetch/, name: 'node-fetch', category: 'library' },
  { regex: /PostmanRuntime/, name: 'Postman', category: 'tool' },
  { regex: /insomnia/, name: 'Insomnia', category: 'tool' },
  { regex: /Apache-HttpClient/, name: 'Apache HttpClient', category: 'library' },
  // 通用爬虫关键字兜底
  { regex: /bot|spider|crawler|scraper/i, name: '通用爬虫', category: 'crawler' },
];

// ============== 解析核心 ==============

/** 提取版本号捕获组，group=0 表示无版本号 */
function extractVersion(match: RegExpMatchArray | null, group: number): string {
  if (!match || group === 0) return '';
  return match[group] ?? '';
}

/** 识别浏览器 */
export function detectBrowser(ua: string): BrowserInfo | null {
  for (const p of BROWSER_PATTERNS) {
    const m = ua.match(p.regex);
    if (m) {
      return { name: p.name, version: extractVersion(m, p.versionGroup) };
    }
  }
  return null;
}

/** 识别操作系统 */
export function detectOs(ua: string): OsInfo | null {
  for (const p of OS_PATTERNS) {
    const m = ua.match(p.regex);
    if (m) {
      let version = extractVersion(m, p.versionGroup);
      // iOS / iPadOS 的版本号下划线转点号
      if (version) version = version.replace(/_/g, '.');
      // macOS 10_15_7 → 10.15.7
      return { name: p.name, version };
    }
  }
  return null;
}

/** 识别渲染引擎 */
export function detectEngine(ua: string): EngineInfo | null {
  for (const p of ENGINE_PATTERNS) {
    const m = ua.match(p.regex);
    if (m) {
      return { name: p.name, version: extractVersion(m, p.versionGroup) };
    }
  }
  return null;
}

/** 识别爬虫/机器人 */
export function detectBot(ua: string): { name: string; category: string } | null {
  for (const p of BOT_PATTERNS) {
    if (p.regex.test(ua)) {
      return { name: p.name, category: p.category };
    }
  }
  return null;
}

/** 识别设备类型与型号 */
export function detectDevice(ua: string, isBot: boolean): DeviceInfo {
  if (isBot) {
    return { type: 'bot', vendor: '', model: '' };
  }
  // 平板优先识别（部分 Android 平板的 UA 含 Mobile 关键字，需先排除）
  if (/iPad|Tablet|PlayBook|Silk|Kindle/.test(ua)) {
    let vendor = '';
    let model = '';
    if (/iPad/.test(ua)) {
      vendor = 'Apple';
      model = 'iPad';
    } else if (/Kindle/.test(ua)) {
      vendor = 'Amazon';
      model = 'Kindle';
    } else if (/SM-/.test(ua)) {
      vendor = 'Samsung';
      const m = ua.match(/SM-[A-Z0-9]+/);
      model = m ? m[0] : '';
    } else if (/HUAWEI|HONOR/.test(ua)) {
      vendor = 'Huawei';
      const m = ua.match(/HUAWEI[A-Za-z0-9-]+|HONOR[A-Za-z0-9-]+/);
      model = m ? m[0] : '';
    } else if (/Mi\sPad|MiPad/.test(ua)) {
      vendor = 'Xiaomi';
      model = 'Mi Pad';
    }
    return { type: 'tablet', vendor, model };
  }
  // 手机
  if (/iPhone/.test(ua)) {
    return { type: 'mobile', vendor: 'Apple', model: 'iPhone' };
  }
  if (/Android.*Mobile|Mobile.*Android|Windows Phone|BlackBerry/.test(ua)) {
    let vendor = '';
    let model = '';
    if (/SM-/.test(ua)) {
      vendor = 'Samsung';
      const m = ua.match(/SM-[A-Z0-9]+/);
      model = m ? m[0] : '';
    } else if (/HUAWEI/.test(ua)) {
      vendor = 'Huawei';
      const m = ua.match(/HUAWEI[A-Za-z0-9-]+/);
      model = m ? m[0] : '';
    } else if (/HONOR/.test(ua)) {
      vendor = 'Honor';
      const m = ua.match(/HONOR[A-Za-z0-9-]+/);
      model = m ? m[0] : '';
    } else if (/Mi\s|Redmi|MI\s/.test(ua)) {
      vendor = 'Xiaomi';
      const m = ua.match(/Mi\s[A-Za-z0-9]+|Redmi[A-Za-z0-9]+/);
      model = m ? m[0] : '';
    } else if (/OPPO/.test(ua)) {
      vendor = 'OPPO';
    } else if (/vivo/.test(ua)) {
      vendor = 'vivo';
    } else if (/Pixel/.test(ua)) {
      vendor = 'Google';
      model = 'Pixel';
    }
    return { type: 'mobile', vendor, model };
  }
  // 桌面端
  if (/Windows|Macintosh|Mac OS X|Linux|CrOS|FreeBSD/.test(ua)) {
    return { type: 'desktop', vendor: '', model: '' };
  }
  return { type: 'unknown', vendor: '', model: '' };
}

/** 主解析函数：一次解析返回完整结果 */
export function parseUserAgent(ua: string): ParsedUA {
  const trimmed = (ua ?? '').trim();
  if (!trimmed) {
    return {
      ua: '',
      browser: null,
      os: null,
      device: { type: 'unknown', vendor: '', model: '' },
      engine: null,
      bot: null,
      isBot: false,
      isMobile: false,
      isDesktop: false,
    };
  }
  const bot = detectBot(trimmed);
  const isBot = bot !== null;
  const browser = detectBrowser(trimmed);
  const os = detectOs(trimmed);
  const engine = detectEngine(trimmed);
  const device = detectDevice(trimmed, isBot);
  return {
    ua: trimmed,
    browser,
    os,
    device,
    engine,
    bot,
    isBot,
    isMobile: device.type === 'mobile' || device.type === 'tablet',
    isDesktop: device.type === 'desktop',
  };
}

// ============== 展示辅助 ==============

/** 生成结构化摘要文本 */
export function formatSummary(p: ParsedUA): string {
  if (!p.ua) return '请输入 User-Agent 字符串';
  if (p.isBot && p.bot) {
    return `爬虫：${p.bot.name}（${p.bot.category}）`;
  }
  const parts: string[] = [];
  if (p.browser) parts.push(`${p.browser.name} ${p.browser.version}`.trim());
  if (p.os) parts.push(`${p.os.name} ${p.os.version}`.trim());
  if (p.device.type === 'mobile') parts.push('手机');
  else if (p.device.type === 'tablet') parts.push('平板');
  else if (p.device.type === 'desktop') parts.push('桌面端');
  if (p.engine) parts.push(`${p.engine.name} 引擎`);
  return parts.join(' · ') || '未能识别';
}

/** 输出 JSON 格式（供复制使用） */
export function toJson(p: ParsedUA): string {
  return JSON.stringify(p, null, 2);
}

// ============== 速查表数据 ==============

/** 浏览器速查条目 */
export interface BrowserEntry {
  name: string;
  engine: string;
  vendor: string;
  summary: string;
}

/** 速查表：主流浏览器 */
export const BROWSER_REFERENCE: BrowserEntry[] = [
  { name: 'Chrome', engine: 'Blink', vendor: 'Google', summary: '全球份额第一，基于 Chromium 开源项目，Blink 引擎 + V8 JS 引擎。UA 关键字 Chrome/x.x.x.x。' },
  { name: 'Microsoft Edge', engine: 'Blink', vendor: 'Microsoft', summary: '2020 年起基于 Chromium，UA 关键字 Edg/x.x（注意无 e 结尾）。旧版 EdgeHTML 已停止支持。' },
  { name: 'Firefox', engine: 'Gecko', vendor: 'Mozilla', summary: 'Mozilla 基金会出品，独立 Gecko 引擎 + SpiderMonkey JS。UA 关键字 Firefox/x.x。' },
  { name: 'Safari', engine: 'WebKit', vendor: 'Apple', summary: 'Apple 默认浏览器，WebKit 引擎 + Nitro JS。UA 关键字 Version/x.x Safari。iOS 上引擎被强制 WebKit。' },
  { name: 'Opera', engine: 'Blink', vendor: 'Opera Software', summary: '2013 年起基于 Chromium。UA 关键字 OPR/x.x（桌面）或 Opera/x.x（旧版）。' },
  { name: 'Samsung Internet', engine: 'Blink', vendor: 'Samsung', summary: '三星安卓设备默认浏览器，基于 Chromium。UA 关键字 SamsungBrowser/x.x。' },
  { name: 'Internet Explorer', engine: 'Trident', vendor: 'Microsoft', summary: '已退役（2022 年停止支持）。UA 关键字 MSIE x.x 或 Trident/7.0 rv:11.0。IE11 UA 不含 MSIE 关键字，需检测 Trident。' },
  { name: '微信', engine: 'Blink', vendor: 'Tencent', summary: '微信内 WebView，基于系统 WebView。UA 关键字 MicroMessenger/x.x，常含 MiniProgramEnv/NetType。' },
  { name: 'QQ 浏览器', engine: 'Blink', vendor: 'Tencent', summary: '腾讯出品，基于 Chromium。UA 关键字 QQBrowser/x.x 或 QQ/x.x（QQ 内 WebView）。' },
  { name: 'UC 浏览器', engine: 'Blink', vendor: 'Alibaba', summary: '阿里旗下移动浏览器。UA 关键字 UCBrowser/x.x 或 UBrowser/x.x。' },
  { name: '百度 App', engine: 'Blink', vendor: 'Baidu', summary: '百度搜索 App 内 WebView。UA 关键字 BaiduBoxApp/x.x，含百度搜索框与信息流。' },
  { name: '360 浏览器', engine: 'Blink', vendor: '奇虎 360', summary: '360 安全浏览器。UA 关键字 360SE（安全版）或 360EE（极速版），常丢失主版本号。' },
  { name: '夸克浏览器', engine: 'Blink', vendor: 'Alibaba', summary: '阿里旗下极简浏览器。UA 关键字 Quark/x.x。' },
];

/** 速查表：主流操作系统 */
export const OS_REFERENCE: { name: string; vendor: string; family: string; summary: string }[] = [
  { name: 'Windows', vendor: 'Microsoft', family: 'Windows NT', summary: '桌面市场占有率第一。UA 关键字 Windows NT x.x（10.0=Win10/11，6.3=8.1，6.2=8，6.1=7）。' },
  { name: 'macOS', vendor: 'Apple', family: 'Darwin', summary: 'Apple 桌面系统。UA 关键字 Mac OS X x_x_x，下划线分隔。M1 与 Intel 版 UA 一致，无法区分架构。' },
  { name: 'iOS', vendor: 'Apple', family: 'Darwin', summary: 'iPhone 系统。UA 关键字 iPhone OS x_x_x。iOS 13 起 iPad 改用 iPadOS 关键字 CPU OS。' },
  { name: 'iPadOS', vendor: 'Apple', family: 'Darwin', summary: 'iPad 专属系统（iOS 13+）。UA 关键字 CPU OS x_x_x。桌面版 Safari 请求桌面 UA 时不含此关键字。' },
  { name: 'Android', vendor: 'Google', family: 'Linux', summary: '移动市场占有率第一。UA 关键字 Android x.x，常附 Build/型号后缀。' },
  { name: 'HarmonyOS', vendor: 'Huawei', family: 'LiteOS/AOSP', summary: '华为鸿蒙系统。UA 关键字 HarmonyOS/x.x 或 OpenHarmony。早期兼容 Android 应用，UA 可能含 Android。' },
  { name: 'ChromeOS', vendor: 'Google', family: 'Linux', summary: 'Chromebook 设备系统。UA 关键字 CrOS，常附带架构标识 x86_64 / armv7l。' },
  { name: 'Linux', vendor: '社区', family: 'Linux', summary: '通用 Linux 发行版。UA 关键字 Linux，部分发行版附 Ubuntu / Fedora / Debian 标识。' },
];

/** 速查表：渲染引擎 */
export const ENGINE_REFERENCE: { name: string; vendor: string; summary: string }[] = [
  { name: 'Blink', vendor: 'Google', summary: 'Chromium 项目引擎，2013 年从 WebKit 分支。Chrome / Edge / Opera / 三星 / 国产 Chromium 系浏览器使用。UA 关键字 AppleWebKit + Chrome。' },
  { name: 'WebKit', vendor: 'Apple', summary: 'Apple 维护的引擎，所有 iOS 浏览器（含 Chrome iOS）强制使用。Safari 桌面版使用。UA 关键字 AppleWebKit/x.x。' },
  { name: 'Gecko', vendor: 'Mozilla', summary: 'Firefox 专属引擎。UA 关键字 Gecko/x.x。仅 Firefox 与 SeaMonkey 等少数浏览器使用。' },
  { name: 'Trident', vendor: 'Microsoft', summary: 'IE 专属引擎，IE11 后停止更新。UA 关键字 Trident/x.x。已被 EdgeHTML 与 Blink 取代。' },
  { name: 'EdgeHTML', vendor: 'Microsoft', summary: '旧版 Edge 引擎，从 Trident 分支。UA 关键字 Edge/x.x。已被 Chromium Blink 取代。' },
  { name: 'Presto', vendor: 'Opera Software', summary: 'Opera 旧引擎，2013 年随 Opera 切换 Chromium 而退役。UA 关键字 Presto/x.x。' },
];

/** 速查表：常见爬虫 */
export const BOT_REFERENCE: { name: string; owner: string; category: string; summary: string }[] = [
  { name: 'Googlebot', owner: 'Google', category: '搜索引擎', summary: 'Google 搜索爬虫。UA 关键字 Googlebot/2.1。区分 Googlebot-Image / News / Video 等子代理。' },
  { name: 'Bingbot', owner: 'Microsoft', category: '搜索引擎', summary: 'Bing 搜索爬虫。UA 关键字 bingbot/2.0。' },
  { name: 'Baiduspider', owner: '百度', category: '搜索引擎', summary: '百度搜索爬虫。UA 关键字 Baiduspider+(+http://www.baidu.com/search/spider.htm)。含 render 子代理用于 JS 渲染抓取。' },
  { name: 'Sogou Spider', owner: '搜狗', category: '搜索引擎', summary: '搜狗搜索爬虫。UA 关键字 Sogou web spider。' },
  { name: '360Spider', owner: '奇虎 360', category: '搜索引擎', summary: '360 搜索爬虫。UA 关键字 360Spider。' },
  { name: 'Bytespider', owner: '字节跳动', category: '搜索引擎', summary: '今日头条 / 抖音搜索爬虫。UA 关键字 Bytespider。' },
  { name: 'PetalBot', owner: '华为', category: '搜索引擎', summary: '华为花瓣搜索爬虫。UA 关键字 PetalBot。' },
  { name: 'YandexBot', owner: 'Yandex', category: '搜索引擎', summary: '俄罗斯 Yandex 搜索爬虫。UA 关键字 YandexBot/3.0。' },
  { name: 'Applebot', owner: 'Apple', category: '搜索引擎', summary: 'Apple 搜索爬虫（Siri Suggestions / Apple News）。UA 关键字 Applebot/0.1。' },
  { name: 'DuckDuckBot', owner: 'DuckDuckGo', category: '搜索引擎', summary: '隐私搜索 DuckDuckGo 爬虫。UA 关键字 DuckDuckBot/1.1。' },
  { name: 'AhrefsBot', owner: 'Ahrefs', category: 'SEO 工具', summary: 'Ahrefs SEO 分析爬虫。UA 关键字 AhrefsBot/x.x。可被 robots.txt 禁止。' },
  { name: 'SemrushBot', owner: 'Semrush', category: 'SEO 工具', summary: 'Semrush SEO 分析爬虫。UA 关键字 SemrushBot/x.x。' },
  { name: 'facebookexternalhit', owner: 'Meta', category: '社交平台', summary: 'Facebook 链接预览抓取器。UA 关键字 facebookexternalhit/x.x。' },
  { name: 'Twitterbot', owner: 'X (Twitter)', category: '社交平台', summary: 'Twitter 链接预览爬虫。UA 关键字 Twitterbot/1.0。' },
  { name: 'WhatsApp', owner: 'Meta', category: '社交平台', summary: 'WhatsApp 链接预览爬虫。UA 关键字 WhatsApp。' },
  { name: 'curl', owner: '开源', category: 'HTTP 库', summary: '命令行 HTTP 客户端。UA 关键字 curl/x.x。非浏览器，常用于脚本与 API 调试。' },
  { name: 'Python Requests', owner: '开源', category: 'HTTP 库', summary: 'Python 主流 HTTP 库。UA 关键字 python-requests/x.x。爬虫与脚本常用。' },
  { name: 'Postman', owner: 'Postman', category: 'API 工具', summary: 'Postman API 调试工具。UA 关键字 PostmanRuntime/x.x。' },
];

// ============== 示例 UA 库 ==============

/** 示例 UA 分类 */
export interface UaSample {
  label: string;
  ua: string;
  note: string;
}

export interface UaSampleGroup {
  group: string;
  samples: UaSample[];
}

/** 真实示例 UA 库（覆盖主流场景，便于用户快速体验） */
export const SAMPLE_UA_GROUPS: UaSampleGroup[] = [
  {
    group: '桌面浏览器',
    samples: [
      {
        label: 'Chrome 120 (Windows)',
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        note: 'Windows 桌面 Chrome，Blink 引擎',
      },
      {
        label: 'Edge 120 (Windows)',
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
        note: 'Edge 必须先匹配 Edg/ 关键字',
      },
      {
        label: 'Firefox 121 (macOS)',
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
        note: 'Firefox 独立 Gecko 引擎',
      },
      {
        label: 'Safari 17 (macOS)',
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
        note: 'Safari WebKit 引擎，Version/ 关键字',
      },
    ],
  },
  {
    group: '移动设备',
    samples: [
      {
        label: 'Safari (iPhone)',
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
        note: 'iPhone Safari，iOS 17',
      },
      {
        label: 'Chrome (Android)',
        ua: 'Mozilla/5.0 (Linux; Android 14; SM-S9080 Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        note: '三星 SM-S9080 安卓 Chrome',
      },
      {
        label: 'Huawei (HarmonyOS)',
        ua: 'Mozilla/5.0 (Linux; Android 10; HUAWEIP40 HarmonyOS/2.0.0; HMSCORE 5.0.0.331) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.116 HuaweiBrowser/11.0.4.300 Mobile Safari/537.36',
        note: '华为 P40 鸿蒙系统',
      },
      {
        label: 'iPad Safari',
        ua: 'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
        note: 'iPadOS 关键字 CPU OS',
      },
    ],
  },
  {
    group: '应用内 WebView',
    samples: [
      {
        label: '微信 iOS',
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.43(0x18002b2c) NetType/WIFI Language/zh_CN',
        note: '微信内 WebView，含 MicroMessenger',
      },
      {
        label: '微信 Android',
        ua: 'Mozilla/5.0 (Linux; Android 14; SM-S9080 Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 MMWEBID/1234 MicroMessenger/8.0.43.2420(0x28002B37) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64',
        note: '安卓微信含 wv 标识与 MicroMessenger',
      },
      {
        label: '支付宝',
        ua: 'Mozilla/5.0 (Linux; Android 14; SM-S9080 Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 AliApp(AP/10.5.16.6000) AlipayClient/10.5.16.6000 Language/zh-Hans UseStatus/true',
        note: '支付宝内 WebView',
      },
      {
        label: '抖音',
        ua: 'Mozilla/5.0 (Linux; Android 14; SM-S9080 Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 aweme_2800 JsSdk/1.0 NetType/WIFI Channel/huawei_webapp app_language/zh-CN language/zh-CN',
        note: '抖音 Android，含 aweme 关键字',
      },
    ],
  },
  {
    group: '爬虫与工具',
    samples: [
      {
        label: 'Googlebot',
        ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        note: 'Google 搜索爬虫，含 compatible 标识',
      },
      {
        label: 'Googlebot 移动版',
        ua: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        note: 'Googlebot 移动渲染版，伪装移动 UA',
      },
      {
        label: 'Baiduspider',
        ua: 'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)',
        note: '百度搜索爬虫',
      },
      {
        label: 'Bingbot',
        ua: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
        note: 'Bing 搜索爬虫',
      },
      {
        label: 'curl',
        ua: 'curl/8.4.0',
        note: '命令行 HTTP 客户端',
      },
      {
        label: 'Python Requests',
        ua: 'python-requests/2.31.0',
        note: 'Python HTTP 库',
      },
    ],
  },
];
