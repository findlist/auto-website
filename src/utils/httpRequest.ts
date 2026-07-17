/**
 * HTTP 请求代码生成器核心逻辑
 *
 * 全部纯函数实现，零依赖，零网络请求。
 * 支持将统一的请求配置转换成 5 种主流语言的客户端调用代码：
 *   - cURL（命令行）
 *   - JavaScript fetch（浏览器原生）
 *   - JavaScript axios（主流第三方库）
 *   - Python requests（最常用 HTTP 库）
 *   - Go net/http（标准库）
 *
 * 设计要点：
 *  - 统一的 RequestConfig 输入，便于跨语言对比
 *  - 4 种认证方式：none / basic / bearer / apikey（Header 或 Query）
 *  - 5 种请求体格式：none / json / form / urlencoded / raw
 *  - 高级选项：超时、重定向跟随、SSL 校验（按语言能力可选支持）
 *  - 输出代码统一 4 空格缩进（Python）或 2 空格缩进（JS/Go），cURL 使用 \ 续行
 */

/** HTTP 方法 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/** 认证方式 */
export type AuthType = 'none' | 'basic' | 'bearer' | 'apikey';

/** API Key 注入位置 */
export type ApiKeyIn = 'header' | 'query';

/** 请求体类型 */
export type BodyType = 'none' | 'json' | 'form' | 'urlencoded' | 'raw';

/** 输出代码语言 */
export type OutputLang = 'curl' | 'fetch' | 'axios' | 'python' | 'go';

/** 单个 Header 项 */
export interface HeaderItem {
  name: string;
  value: string;
}

/** 单个表单字段（form / urlencoded） */
export interface FormField {
  name: string;
  value: string;
}

/** 认证配置 */
export interface AuthConfig {
  type: AuthType;
  username?: string;          // basic 认证用户名
  password?: string;          // basic 认证密码
  token?: string;             // bearer 认证令牌
  apiKey?: string;            // apikey 认证键名
  apiValue?: string;          // apikey 认证键值
  apiKeyIn?: ApiKeyIn;        // apikey 注入位置（header / query）
}

/** 高级选项 */
export interface AdvancedOptions {
  timeout?: number;           // 超时（毫秒），0 表示不设置
  followRedirects?: boolean;  // 是否跟随重定向，默认 true
  verifySsl?: boolean;        // 是否校验 SSL 证书，默认 true
}

/** 统一请求配置 */
export interface RequestConfig {
  url: string;
  method: HttpMethod;
  headers: HeaderItem[];
  bodyType: BodyType;
  rawBody: string;            // raw / json 请求体原始文本
  formFields: FormField[];    // form / urlencoded 字段
  auth: AuthConfig;
  advanced: AdvancedOptions;
}

/** 输出语言元数据 */
export interface OutputLangMeta {
  lang: OutputLang;
  label: string;              // 中文标签
  langCode: string;           // 代码块语言标识
  desc: string;               // 一句话说明
}

/** 输出语言列表（顺序即 UI Tab 顺序） */
export const OUTPUT_LANGS: OutputLangMeta[] = [
  { lang: 'curl', label: 'cURL', langCode: 'bash', desc: '命令行工具，通用标准' },
  { lang: 'fetch', label: 'fetch', langCode: 'javascript', desc: '浏览器原生 API' },
  { lang: 'axios', label: 'axios', langCode: 'javascript', desc: '主流第三方库' },
  { lang: 'python', label: 'Python', langCode: 'python', desc: 'requests 库' },
  { lang: 'go', label: 'Go', langCode: 'go', desc: 'net/http 标准库' },
];

/** HTTP 方法列表 */
export const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** 请求体类型元数据 */
export const BODY_TYPE_METAS: { type: BodyType; label: string; desc: string }[] = [
  { type: 'none', label: '无', desc: 'GET / HEAD / DELETE 等无请求体请求' },
  { type: 'json', label: 'JSON', desc: 'application/json，RESTful API 最常用' },
  { type: 'form', label: 'Form-Data', desc: 'multipart/form-data，文件上传' },
  { type: 'urlencoded', label: 'x-www-form-urlencoded', desc: '表单提交，传统 Web' },
  { type: 'raw', label: 'Raw', desc: '任意原始文本（XML / HTML / 自定义）' },
];

/** 认证方式元数据 */
export const AUTH_TYPE_METAS: { type: AuthType; label: string; desc: string }[] = [
  { type: 'none', label: '无认证', desc: '公开接口，无 Authorization 头' },
  { type: 'basic', label: 'Basic Auth', desc: '用户名密码 Base64 编码' },
  { type: 'bearer', label: 'Bearer Token', desc: 'JWT / OAuth2 令牌' },
  { type: 'apikey', label: 'API Key', desc: '自定义 Header 或 Query 参数' },
];

/** 默认配置（首次进入页面示例） */
export const DEFAULT_CONFIG: RequestConfig = {
  url: 'https://api.example.com/v1/users',
  method: 'POST',
  headers: [
    { name: 'Accept', value: 'application/json' },
  ],
  bodyType: 'json',
  rawBody: '{\n  "name": "张三",\n  "email": "zhangsan@example.com",\n  "age": 28\n}',
  formFields: [
    { name: 'username', value: 'zhangsan' },
    { name: 'password', value: '******' },
  ],
  auth: { type: 'bearer', token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example.token' },
  advanced: { timeout: 30000, followRedirects: true, verifySsl: true },
};

/** 预设场景 */
export interface PresetScenario {
  id: string;
  name: string;
  desc: string;
  config: RequestConfig;
}

/** 6 个高频预设场景，覆盖典型 API 调用模式 */
export const PRESET_SCENARIOS: PresetScenario[] = [
  {
    id: 'get-list',
    name: 'GET 列表查询',
    desc: '分页查询用户列表，Bearer 认证',
    config: {
      url: 'https://api.example.com/v1/users?page=1&size=20',
      method: 'GET',
      headers: [{ name: 'Accept', value: 'application/json' }],
      bodyType: 'none',
      rawBody: '',
      formFields: [],
      auth: { type: 'bearer', token: 'eyJhbGciOiJIUzI1NiJ9.token' },
      advanced: { timeout: 30000, followRedirects: true, verifySsl: true },
    },
  },
  {
    id: 'post-create',
    name: 'POST 创建资源',
    desc: '提交 JSON 创建新用户',
    config: { ...DEFAULT_CONFIG },
  },
  {
    id: 'put-update',
    name: 'PUT 更新资源',
    desc: '整体更新用户信息',
    config: {
      url: 'https://api.example.com/v1/users/123',
      method: 'PUT',
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      bodyType: 'json',
      rawBody: '{\n  "name": "李四",\n  "email": "lisi@example.com"\n}',
      formFields: [],
      auth: { type: 'bearer', token: 'eyJhbGciOiJIUzI1NiJ9.token' },
      advanced: { timeout: 30000, followRedirects: true, verifySsl: true },
    },
  },
  {
    id: 'form-submit',
    name: 'POST 表单提交',
    desc: 'application/x-www-form-urlencoded 表单',
    config: {
      url: 'https://api.example.com/v1/login',
      method: 'POST',
      headers: [{ name: 'Accept', value: 'application/json' }],
      bodyType: 'urlencoded',
      rawBody: '',
      formFields: [
        { name: 'username', value: 'admin' },
        { name: 'password', value: 'secret' },
      ],
      auth: { type: 'none' },
      advanced: { timeout: 10000, followRedirects: true, verifySsl: true },
    },
  },
  {
    id: 'basic-auth',
    name: 'Basic 认证',
    desc: 'HTTP Basic 用户名密码认证',
    config: {
      url: 'https://api.example.com/v1/protected',
      method: 'GET',
      headers: [{ name: 'Accept', value: 'application/json' }],
      bodyType: 'none',
      rawBody: '',
      formFields: [],
      auth: { type: 'basic', username: 'admin', password: 'secret' },
      advanced: { timeout: 30000, followRedirects: true, verifySsl: true },
    },
  },
  {
    id: 'apikey',
    name: 'API Key 调用',
    desc: '自定义 Header 携带 API Key',
    config: {
      url: 'https://api.example.com/v1/weather?city=beijing',
      method: 'GET',
      headers: [{ name: 'Accept', value: 'application/json' }],
      bodyType: 'none',
      rawBody: '',
      formFields: [],
      auth: { type: 'apikey', apiKey: 'X-API-Key', apiValue: 'abc123xyz', apiKeyIn: 'header' },
      advanced: { timeout: 15000, followRedirects: true, verifySsl: true },
    },
  },
];

/**
 * 解析 URL 为对象（轻量版，仅取 query 与基础信息）
 * 失败时返回 null
 */
export function parseUrl(url: string): { base: string; query: URLSearchParams } | null {
  try {
    const u = new URL(url);
    return { base: u.origin + u.pathname, query: u.searchParams };
  } catch {
    return null;
  }
}

/**
 * 合并用户输入的 headers 与认证注入的 headers
 * 返回标准化 header 数组（去除空值，名称首字母大写）
 */
function mergeHeaders(config: RequestConfig): HeaderItem[] {
  const merged: HeaderItem[] = [];
  // 用户输入 headers
  for (const h of config.headers) {
    if (h.name.trim() && h.value !== '') {
      merged.push({ name: h.name.trim(), value: h.value });
    }
  }
  // 认证注入
  const { auth } = config;
  if (auth.type === 'basic' && auth.username != null && auth.password != null) {
    merged.push({ name: 'Authorization', value: `Basic ${btoa(`${auth.username}:${auth.password}`)}` });
  } else if (auth.type === 'bearer' && auth.token) {
    merged.push({ name: 'Authorization', value: `Bearer ${auth.token}` });
  } else if (auth.type === 'apikey' && auth.apiKey && auth.apiValue && auth.apiKeyIn === 'header') {
    merged.push({ name: auth.apiKey, value: auth.apiValue });
  }
  return merged;
}

/**
 * 构建最终 URL：apikey query 模式时附加 query 参数
 */
function buildUrl(config: RequestConfig): string {
  const { url, auth } = config;
  if (auth.type === 'apikey' && auth.apiKey && auth.apiValue && auth.apiKeyIn === 'query') {
    try {
      const u = new URL(url);
      u.searchParams.append(auth.apiKey, auth.apiValue);
      return u.toString();
    } catch {
      // URL 无效时直接拼接
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}${encodeURIComponent(auth.apiKey)}=${encodeURIComponent(auth.apiValue)}`;
    }
  }
  return url;
}

/** 判断方法是否需要请求体 */
function hasBody(method: HttpMethod, bodyType: BodyType): boolean {
  if (bodyType === 'none') return false;
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

/** 根据请求体类型推断 Content-Type */
function inferContentType(bodyType: BodyType): string | null {
  switch (bodyType) {
    case 'json': return 'application/json';
    case 'urlencoded': return 'application/x-www-form-urlencoded';
    case 'form': return 'multipart/form-data';
    case 'raw': return null;
    case 'none': return null;
  }
}

/**
 * 生成 cURL 命令
 * 多行 \ 续行，-X 指定方法，-H 添加头，-d 添加请求体
 */
export function buildCurl(config: RequestConfig): string {
  const url = buildUrl(config);
  const headers = mergeHeaders(config);
  const lines: string[] = [`curl -X ${config.method} '${url}'`];

  for (const h of headers) {
    lines.push(`  -H '${h.name}: ${h.value}'`);
  }

  // 自动注入 Content-Type（若用户未指定且需要）
  const ct = inferContentType(config.bodyType);
  if (ct && !headers.some((h) => h.name.toLowerCase() === 'content-type')) {
    if (config.bodyType !== 'form') {
      // multipart/form-data 由 cURL -F 自动处理，无需显式设置
      lines.push(`  -H 'Content-Type: ${ct}'`);
    }
  }

  if (hasBody(config.method, config.bodyType)) {
    if (config.bodyType === 'json' || config.bodyType === 'raw') {
      const body = config.rawBody.trim();
      if (body) {
        // 单行用 -d，多行用 $'...' 转义换行
        if (body.includes('\n')) {
          const escaped = body.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/'/g, "\\'");
          lines.push(`  -d $'${escaped}'`);
        } else {
          lines.push(`  -d '${body}'`);
        }
      }
    } else if (config.bodyType === 'urlencoded') {
      for (const f of config.formFields) {
        if (f.name.trim()) {
          lines.push(`  --data-urlencode '${f.name}=${f.value}'`);
        }
      }
    } else if (config.bodyType === 'form') {
      for (const f of config.formFields) {
        if (f.name.trim()) {
          lines.push(`  -F '${f.name}=${f.value}'`);
        }
      }
    }
  }

  // 高级选项
  if (config.advanced.timeout && config.advanced.timeout > 0) {
    // cURL --max-time 单位为秒
    lines.push(`  --max-time ${Math.ceil(config.advanced.timeout / 1000)}`);
  }
  if (config.advanced.followRedirects) {
    // cURL 默认不跟随，需 -L 显式启用
    lines.push('  -L');
  }
  if (!config.advanced.verifySsl) {
    lines.push('  -k');
  }

  return lines.join(' \\\n');
}

/**
 * 生成 JavaScript fetch 代码
 * 使用 async/await + try/catch 标准模式
 */
export function buildFetch(config: RequestConfig): string {
  const url = buildUrl(config);
  const headers = mergeHeaders(config);
  // 构建headers对象
  const headerObj: Record<string, string> = {};
  for (const h of headers) headerObj[h.name] = h.value;
  const ct = inferContentType(config.bodyType);
  if (ct && !headerObj['Content-Type'] && !headerObj['content-type'] && config.bodyType !== 'form') {
    headerObj['Content-Type'] = ct;
  }

  const optionsLines: string[] = [`  method: '${config.method}',`];
  if (Object.keys(headerObj).length > 0) {
    optionsLines.push('  headers: {');
    for (const [k, v] of Object.entries(headerObj)) {
      optionsLines.push(`    '${k}': '${v.replace(/'/g, "\\'")}',`);
    }
    optionsLines.push('  },');
  }

  // 请求体
  if (hasBody(config.method, config.bodyType)) {
    if (config.bodyType === 'json' || config.bodyType === 'raw') {
      const body = config.rawBody.trim();
      if (body) {
        if (config.bodyType === 'json') {
          // 尝试 JSON.parse 验证；输出 body 字符串
          try {
            JSON.parse(body);
            optionsLines.push(`  body: JSON.stringify(${body}),`);
          } catch {
            // 非法 JSON，按原始字符串输出
            optionsLines.push(`  body: '${body.replace(/'/g, "\\'").replace(/\n/g, '\\n')}',`);
          }
        } else {
          optionsLines.push(`  body: '${body.replace(/'/g, "\\'").replace(/\n/g, '\\n')}',`);
        }
      }
    } else if (config.bodyType === 'urlencoded') {
      const params = config.formFields
        .filter((f) => f.name.trim())
        .map((f) => `'${f.name}': '${f.value.replace(/'/g, "\\'")}'`);
      if (params.length > 0) {
        optionsLines.push(`  body: new URLSearchParams({`);
        for (const p of params) optionsLines.push(`    ${p},`);
        optionsLines.push(`  }).toString(),`);
      }
    } else if (config.bodyType === 'form') {
      const fields = config.formFields.filter((f) => f.name.trim());
      if (fields.length > 0) {
        optionsLines.push('  body: (() => {');
        optionsLines.push('    const fd = new FormData();');
        for (const f of fields) {
          optionsLines.push(`    fd.append('${f.name}', '${f.value.replace(/'/g, "\\'")}');`);
        }
        optionsLines.push('    return fd;');
        optionsLines.push('  })(),');
      }
    }
  }

  // 高级选项
  if (config.advanced.timeout && config.advanced.timeout > 0) {
    // fetch 没有原生 timeout，用 AbortController 实现
    optionsLines.push('  signal: AbortSignal.timeout(' + config.advanced.timeout + '),');
  }
  if (!config.advanced.followRedirects) {
    optionsLines.push("  redirect: 'manual',");
  }

  let code = `const response = await fetch('${url}', {\n${optionsLines.join('\n')}});\n\n`;
  code += "if (!response.ok) {\n  throw new Error(`HTTP ${response.status}: ${response.statusText}`);\n}\n\n";
  code += "const data = await response.json();\nconsole.log(data);";
  return code;
}

/**
 * 生成 axios 代码
 * 标准 axios(config) 调用模式
 */
export function buildAxios(config: RequestConfig): string {
  const url = buildUrl(config);
  const headers = mergeHeaders(config);
  const headerObj: Record<string, string> = {};
  for (const h of headers) headerObj[h.name] = h.value;
  const ct = inferContentType(config.bodyType);
  if (ct && !headerObj['Content-Type'] && !headerObj['content-type'] && config.bodyType !== 'form') {
    headerObj['Content-Type'] = ct;
  }

  const lines: string[] = ['const axios = require(\'axios\');', '', 'try {'];
  lines.push(`  const { data } = await axios({`);
  lines.push(`    url: '${url}',`);
  lines.push(`    method: '${config.method.toLowerCase()}',`);

  if (Object.keys(headerObj).length > 0) {
    lines.push('    headers: {');
    for (const [k, v] of Object.entries(headerObj)) {
      lines.push(`      '${k}': '${v.replace(/'/g, "\\'")}',`);
    }
    lines.push('    },');
  }

  if (hasBody(config.method, config.bodyType)) {
    if (config.bodyType === 'json') {
      const body = config.rawBody.trim();
      if (body) {
        try {
          JSON.parse(body);
          lines.push(`    data: ${body},`);
        } catch {
          lines.push(`    data: '${body.replace(/'/g, "\\'").replace(/\n/g, '\\n')}',`);
        }
      }
    } else if (config.bodyType === 'raw') {
      const body = config.rawBody.trim();
      if (body) {
        lines.push(`    data: '${body.replace(/'/g, "\\'").replace(/\n/g, '\\n')}',`);
      }
    } else if (config.bodyType === 'urlencoded') {
      const params: string[] = [];
      for (const f of config.formFields) {
        if (f.name.trim()) {
          params.push(`      '${f.name}': '${f.value.replace(/'/g, "\\'")}'`);
        }
      }
      if (params.length > 0) {
        lines.push('    data: new URLSearchParams({');
        lines.push(params.join(',\n'));
        lines.push('    }).toString(),');
      }
    } else if (config.bodyType === 'form') {
      const fields = config.formFields.filter((f) => f.name.trim());
      if (fields.length > 0) {
        lines.push('    data: (() => {');
        lines.push('      const fd = new FormData();');
        for (const f of fields) {
          lines.push(`      fd.append('${f.name}', '${f.value.replace(/'/g, "\\'")}');`);
        }
        lines.push('      return fd;');
        lines.push('    })(),');
      }
    }
  }

  if (config.advanced.timeout && config.advanced.timeout > 0) {
    lines.push(`    timeout: ${config.advanced.timeout},`);
  }
  if (!config.advanced.followRedirects) {
    lines.push('    maxRedirects: 0,');
  }
  if (!config.advanced.verifySsl) {
    // Node.js axios 通过 httpsAgent 控制
    lines.push("    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),");
  }

  lines.push('  });');
  lines.push('  console.log(data);');
  lines.push('} catch (err) {');
  lines.push('  if (err.response) {');
  lines.push('    console.error(`HTTP ${err.response.status}:`, err.response.data);');
  lines.push('  } else {');
  lines.push('    console.error(err.message);');
  lines.push('  }');
  lines.push('}');

  return lines.join('\n');
}

/**
 * 生成 Python requests 代码
 * 标准模式：requests.request(method, url, **kwargs)
 */
export function buildPython(config: RequestConfig): string {
  const url = buildUrl(config);
  const headers = mergeHeaders(config);
  const lines: string[] = ['import requests'];

  if (!config.advanced.verifySsl) {
    lines.push('import urllib3');
    lines.push('urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)');
  }
  lines.push('');

  // headers 字典
  const headerDict: string[] = [];
  for (const h of headers) {
    headerDict.push(`    '${h.name}': '${h.value.replace(/'/g, "\\'")}',`);
  }
  const ct = inferContentType(config.bodyType);
  if (ct && !headers.some((h) => h.name.toLowerCase() === 'content-type') && config.bodyType !== 'form') {
    headerDict.push(`    'Content-Type': '${ct}',`);
  }

  lines.push(`url = '${url}'`);
  if (headerDict.length > 0) {
    lines.push('headers = {');
    lines.push(...headerDict);
    lines.push('}');
  }

  // 请求体：生成对应变量并加入 kwargs
  // kwargs 数组统一收集所有关键字参数，最终拼接成 requests.request() 调用
  const kwargs: string[] = [];
  if (headerDict.length > 0) kwargs.push('headers=headers');

  if (hasBody(config.method, config.bodyType)) {
    if (config.bodyType === 'json') {
      const body = config.rawBody.trim();
      if (body) {
        try {
          JSON.parse(body);
          // JSON 合法：转为 Python 字典字面量（true→True / false→False / null→None）
          const pyDict = body
            .replace(/\btrue\b/g, 'True')
            .replace(/\bfalse\b/g, 'False')
            .replace(/\bnull\b/g, 'None');
          lines.push(`payload = ${pyDict}`);
          kwargs.push('json=payload');
        } catch {
          lines.push(`payload = '${body.replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`);
          kwargs.push('data=payload');
        }
      }
    } else if (config.bodyType === 'raw') {
      const body = config.rawBody.trim();
      if (body) {
        lines.push(`payload = '${body.replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`);
        kwargs.push('data=payload');
      }
    } else if (config.bodyType === 'urlencoded') {
      const fields = config.formFields.filter((f) => f.name.trim());
      if (fields.length > 0) {
        lines.push('payload = {');
        for (const f of fields) {
          lines.push(`    '${f.name}': '${f.value.replace(/'/g, "\\'")}',`);
        }
        lines.push('}');
        kwargs.push('data=payload');
      }
    } else if (config.bodyType === 'form') {
      const fields = config.formFields.filter((f) => f.name.trim());
      if (fields.length > 0) {
        lines.push('files = {');
        for (const f of fields) {
          lines.push(`    '${f.name}': (None, '${f.value.replace(/'/g, "\\'")}'),`);
        }
        lines.push('}');
        kwargs.push('files=files');
      }
    }
  }

  // 高级选项
  if (config.advanced.timeout && config.advanced.timeout > 0) {
    kwargs.push(`timeout=${Math.ceil(config.advanced.timeout / 1000)}`);  // 秒
  }
  if (!config.advanced.followRedirects) {
    kwargs.push('allow_redirects=False');
  }
  if (!config.advanced.verifySsl) {
    kwargs.push('verify=False');
  }

  // 拼接最终调用：requests.request(method, url, **kwargs)
  const kwargsStr = kwargs.length > 0 ? ', ' + kwargs.join(', ') : '';
  lines.push('');
  lines.push(`response = requests.request('${config.method}', url${kwargsStr})`);
  lines.push('');
  lines.push('print(response.status_code)');
  lines.push('print(response.json())');

  return lines.join('\n');
}

/**
 * 生成 Go net/http 代码
 * 标准库模式：http.NewRequest + http.Client.Do
 */
export function buildGo(config: RequestConfig): string {
  const url = buildUrl(config);
  const headers = mergeHeaders(config);
  const lines: string[] = ['package main', '', 'import ('];
  lines.push('\t"fmt"');
  lines.push('\t"io"');
  lines.push('\t"net/http"');
  const needStrings = config.bodyType === 'json' || config.bodyType === 'raw' || config.bodyType === 'urlencoded' || config.bodyType === 'form';
  if (needStrings) lines.push('\t"strings"');
  const needTime = !!config.advanced.timeout && config.advanced.timeout > 0;
  if (needTime) lines.push('\t"time"');
  if (!config.advanced.verifySsl) lines.push('\t"crypto/tls"');
  lines.push(')', '');
  lines.push('func main() {');

  // 请求体构造
  let bodyVar = 'nil';
  if (hasBody(config.method, config.bodyType)) {
    if (config.bodyType === 'json' || config.bodyType === 'raw') {
      const body = config.rawBody.trim();
      if (body) {
        // 使用反引号字面量字符串，转义内部反引号
        const escaped = body.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
        lines.push(`\tbody := strings.NewReader(\`${escaped}\`)`);
        bodyVar = 'body';
      }
    } else if (config.bodyType === 'urlencoded' || config.bodyType === 'form') {
      const fields = config.formFields.filter((f) => f.name.trim());
      if (fields.length > 0) {
        const formStr = fields
          .map((f) => `${encodeURIComponent(f.name)}=${encodeURIComponent(f.value)}`)
          .join('&');
        if (config.bodyType === 'form') {
          // multipart/form-data 完整实现需 mime/multipart，此处为简写示例
          lines.push('\t// multipart/form-data 简写示例（完整实现需使用 mime/multipart 包）');
        }
        lines.push(`\tbody := strings.NewReader("${formStr}")`);
        bodyVar = 'body';
      }
    }
  }

  lines.push(`\treq, err := http.NewRequest("${config.method}", "${url}", ${bodyVar})`);
  lines.push('\tif err != nil {');
  lines.push('\t\tpanic(err)');
  lines.push('\t}');

  // headers
  const ct = inferContentType(config.bodyType);
  const allHeaders = [...headers];
  if (ct && !allHeaders.some((h) => h.name.toLowerCase() === 'content-type') && config.bodyType !== 'form') {
    allHeaders.push({ name: 'Content-Type', value: ct });
  }
  for (const h of allHeaders) {
    lines.push(`\treq.Header.Set("${h.name}", "${h.value.replace(/"/g, '\\"')}")`);
  }

  // client 配置：用统一数组收集字段，避免缩进错乱
  const clientFields: string[] = [];
  if (needTime) {
    clientFields.push(`\t\tTimeout: ${config.advanced.timeout} * time.Millisecond,`);
  }
  if (!config.advanced.followRedirects) {
    clientFields.push('\t\tCheckRedirect: func(req *http.Request, via []*http.Request) error {');
    clientFields.push('\t\t\treturn http.ErrUseLastResponse');
    clientFields.push('\t\t},');
  }

  lines.push('\tclient := &http.Client{');
  if (!config.advanced.verifySsl) {
    lines.push('\t\tTransport: &http.Transport{');
    lines.push('\t\t\tTLSClientConfig: &tls.Config{InsecureSkipVerify: true},');
    lines.push('\t\t},');
  }
  for (const f of clientFields) lines.push(f);
  lines.push('\t}');

  lines.push('\tresp, err := client.Do(req)');
  lines.push('\tif err != nil {');
  lines.push('\t\tpanic(err)');
  lines.push('\t}');
  lines.push('\tdefer resp.Body.Close()');
  lines.push('');
  lines.push('\tbodyBytes, _ := io.ReadAll(resp.Body)');
  lines.push('\tfmt.Println(resp.StatusCode)');
  lines.push('\tfmt.Println(string(bodyBytes))');
  lines.push('}');

  return lines.join('\n');
}

/**
 * 根据语言生成代码（统一入口）
 */
export function generateCode(lang: OutputLang, config: RequestConfig): string {
  try {
    switch (lang) {
      case 'curl': return buildCurl(config);
      case 'fetch': return buildFetch(config);
      case 'axios': return buildAxios(config);
      case 'python': return buildPython(config);
      case 'go': return buildGo(config);
    }
  } catch (err) {
    return `// 代码生成失败：${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * 配置导出为 JSON 字符串（便于保存与分享）
 */
export function exportConfig(config: RequestConfig): string {
  return JSON.stringify(config, null, 2);
}

/**
 * 从 JSON 字符串导入配置（失败返回 null）
 */
export function importConfig(json: string): RequestConfig | null {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (typeof parsed.url !== 'string' || typeof parsed.method !== 'string') return null;
    return parsed as RequestConfig;
  } catch {
    return null;
  }
}
