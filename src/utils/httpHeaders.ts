/**
 * HTTP Header 数据与解析逻辑
 *
 * 全部在浏览器本地处理，零网络请求，零依赖。
 * 覆盖 RFC 9110（HTTP 语义）与 RFC 9112（HTTP/1.1 报文）核心 Header。
 *
 * 分类：
 *  - request：请求头（客户端 → 服务端）
 *  - response：响应头（服务端 → 客户端）
 *  - general：通用头（请求与响应都可出现）
 *  - entity：表示头（描述报文主体，HTTP/1.1 概念，HTTP/2+ 已合并）
 *  - cors：CORS 相关头（跨域资源共享）
 *  - security：安全相关头（CSP/HSTS/X-Frame-Options 等）
 *  - cache：缓存相关头（Cache-Control/ETag/Last-Modified 等）
 */

/** Header 分类 */
export type HeaderCategory =
  | 'request'
  | 'response'
  | 'general'
  | 'entity'
  | 'cors'
  | 'security'
  | 'cache';

/** 单个 Header 元数据 */
export interface HeaderInfo {
  name: string;          // 规范名称（大小写不敏感，约定首字母大写）
  category: HeaderCategory;
  summary: string;       // 一句话含义
  syntax: string;        // 语法格式
  example: string;       // 典型示例
  description: string;   // 详细说明（含场景、易错点）
  isResponseOnly?: boolean; // 仅响应头
  isRequestOnly?: boolean;  // 仅请求头
}

/** 分类展示元信息 */
export interface CategoryMeta {
  label: string;         // 中文标签
  description: string;   // 分类说明
  color: string;         // 主题色（用于徽标）
}

/** 分类元信息表 */
export const CATEGORY_METAS: Record<HeaderCategory, CategoryMeta> = {
  request: { label: '请求头', description: '客户端发送给服务端，描述请求上下文与期望', color: '#2563eb' },
  response: { label: '响应头', description: '服务端返回给客户端，描述响应与服务器信息', color: '#16a34a' },
  general: { label: '通用头', description: '请求与响应都可出现，描述报文整体信息', color: '#9333ea' },
  entity: { label: '表示头', description: '描述报文主体的内容与编码（HTTP/1.1 概念）', color: '#d97706' },
  cors: { label: 'CORS 头', description: '跨域资源共享相关，控制浏览器跨域访问', color: '#0891b2' },
  security: { label: '安全头', description: '安全策略相关，防御 XSS/点击劫持/降级攻击', color: '#dc2626' },
  cache: { label: '缓存头', description: '缓存策略相关，控制浏览器与 CDN 缓存行为', color: '#65a30d' },
};

/** 内置常用 Header 数据（精选 40+ 高频 Header） */
export const HTTP_HEADERS: HeaderInfo[] = [
  // ===== 请求头 =====
  {
    name: 'Host',
    category: 'request',
    summary: '目标主机与端口（HTTP/1.1 必需）',
    syntax: 'Host: <host>:<port>',
    example: 'Host: www.example.com:443',
    description: 'HTTP/1.1 唯一必需的请求头，指定目标主机与端口。HTTP/2 中由 :authority 伪头替代。虚拟主机通过 Host 区分不同站点。',
    isRequestOnly: true,
  },
  {
    name: 'User-Agent',
    category: 'request',
    summary: '客户端标识（浏览器/系统/设备）',
    syntax: 'User-Agent: <product> (<comment>) <product> (<comment>)...',
    example: 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36',
    description: '标识客户端类型，服务端据此做内容协商或统计。注意 Chrome 自 113 起对部分用户冻结 UA（UA Reduction），建议用 Client Hints 替代。爬虫识别也依赖此字段。',
    isRequestOnly: true,
  },
  {
    name: 'Accept',
    category: 'request',
    summary: '客户端可接受的内容类型',
    syntax: 'Accept: <type>/<subtype>; q=<quality>',
    example: 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    description: '内容协商字段，按 MIME 类型声明偏好，q 表示权重（0-1，默认 1）。服务端据此返回最适合的内容类型。',
    isRequestOnly: true,
  },
  {
    name: 'Accept-Language',
    category: 'request',
    summary: '客户端偏好的自然语言',
    syntax: 'Accept-Language: <lang>; q=<quality>',
    example: 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
    description: '按语言权重声明偏好，服务端据此返回对应语言版本。SEO 多语言站点常据此做重定向，但建议配合会话或路径切换，避免误判爬虫。',
    isRequestOnly: true,
  },
  {
    name: 'Accept-Encoding',
    category: 'request',
    summary: '客户端支持的内容编码（压缩）',
    syntax: 'Accept-Encoding: <encoding>; q=<quality>',
    example: 'Accept-Encoding: gzip, deflate, br, zstd',
    description: '声明支持的压缩算法，br（Brotli）压缩率优于 gzip，zstd（Zstandard）是较新算法。服务端据此选择压缩方式并在 Content-Encoding 中返回。',
    isRequestOnly: true,
  },
  {
    name: 'Authorization',
    category: 'request',
    summary: '认证凭证（Basic/Bearer/Digest）',
    syntax: 'Authorization: <scheme> <credentials>',
    example: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abc123',
    description: '携带认证凭证。常见方案：Basic（Base64 编码用户名密码，需 HTTPS）、Bearer（JWT/OAuth2 token）、Digest（哈希摘要，防重放）。注意 token 不要放进 URL，避免被日志/Referer 泄露。',
    isRequestOnly: true,
  },
  {
    name: 'Cookie',
    category: 'request',
    summary: '携带的 Cookie 值',
    syntax: 'Cookie: <name>=<value>; <name>=<value>',
    example: 'Cookie: sessionId=abc123; userId=456; theme=dark',
    description: '浏览器自动携带同域 Cookie。HttpOnly Cookie 不能被 JS 读取，防 XSS 窃取；SameSite 控制跨站携带策略。注意大小写敏感、键值对用分号空格分隔。',
    isRequestOnly: true,
  },
  {
    name: 'Referer',
    category: 'request',
    summary: '来源页面 URL',
    syntax: 'Referer: <url>',
    example: 'Referer: https://www.google.com/search?q=hello',
    description: '标识请求来源页面。注意拼写错误是历史遗留（应为 Referrer）。服务端据此做防盗链、统计来源。Referrer-Policy 控制是否发送及发送多少。',
    isRequestOnly: true,
  },
  {
    name: 'Origin',
    category: 'request',
    summary: '请求源（协议+域名+端口）',
    syntax: 'Origin: <scheme>://<host>:<port>',
    example: 'Origin: https://example.com:443',
    description: 'CORS 与 POST 预检请求关键字段，仅含源（不含路径与查询）。服务端据此判断是否允许跨域。与 Referer 区别：Origin 仅在跨域请求发送，更简洁。',
    isRequestOnly: true,
  },
  {
    name: 'Content-Type',
    category: 'entity',
    summary: '请求/响应主体的 MIME 类型',
    syntax: 'Content-Type: <type>/<subtype>; charset=<charset>; boundary=<boundary>',
    example: 'Content-Type: application/json; charset=utf-8',
    description: '描述主体类型与字符集。常见值：application/json、text/html、multipart/form-data（文件上传，含 boundary）、application/x-www-form-urlencoded（表单默认）。',
  },
  {
    name: 'Content-Length',
    category: 'entity',
    summary: '主体字节长度',
    syntax: 'Content-Length: <digits>',
    example: 'Content-Length: 348',
    description: '声明主体字节长度，用于连接复用与流式传输。分块传输（Transfer-Encoding: chunked）时不发送此字段。注意长度不匹配会导致请求/响应被拒绝。',
  },
  {
    name: 'Content-Encoding',
    category: 'entity',
    summary: '主体压缩编码',
    syntax: 'Content-Encoding: <encoding>',
    example: 'Content-Encoding: gzip',
    description: '声明主体使用的压缩算法，常见 gzip/deflate/br/zstd。客户端需据此解压。与 Transfer-Encoding 区别：Content-Encoding 是端到端，Transfer-Encoding 是逐跳。',
  },
  {
    name: 'Transfer-Encoding',
    category: 'general',
    summary: '传输编码（如分块传输）',
    syntax: 'Transfer-Encoding: chunked',
    example: 'Transfer-Encoding: chunked',
    description: '声明传输编码方式，最常用 chunked（分块传输）。流式响应（如 SSE、大文件）不预知长度时使用。HTTP/2+ 不再使用，改为帧流。',
  },
  {
    name: 'Range',
    category: 'request',
    summary: '请求主体部分内容（断点续传）',
    syntax: 'Range: bytes=<start>-<end>',
    example: 'Range: bytes=0-1023',
    description: '请求资源的一部分，服务端返回 206 Partial Content。常用于视频流、大文件下载断点续传。单位通常是字节，格式 bytes=start-end（端点闭区间）。',
    isRequestOnly: true,
  },
  {
    name: 'If-None-Match',
    category: 'request',
    summary: '条件请求（ETag 比较）',
    syntax: 'If-None-Match: "<etag>"',
    example: 'If-None-Match: "abc123"',
    description: '与响应 ETag 配合实现条件请求。若服务端资源 ETag 与此值匹配，返回 304 Not Modified（无主体），节省带宽。CDN 与浏览器缓存验证核心机制。',
    isRequestOnly: true,
  },
  {
    name: 'If-Modified-Since',
    category: 'request',
    summary: '条件请求（修改时间比较）',
    syntax: 'If-Modified-Since: <http-date>',
    example: 'If-Modified-Since: Wed, 21 Oct 2025 07:28:00 GMT',
    description: '与 Last-Modified 配合实现条件请求。若资源在该时间后未修改，返回 304。精度限于秒，不如 ETag 精确，但实现简单。',
    isRequestOnly: true,
  },
  {
    name: 'Connection',
    category: 'general',
    summary: '连接控制（keep-alive/close）',
    syntax: 'Connection: keep-alive | close',
    example: 'Connection: keep-alive',
    description: 'HTTP/1.1 默认 keep-alive（连接复用），close 表示响应后关闭连接。HTTP/2+ 不再使用，连接管理由协议层自动处理。',
  },

  // ===== 响应头 =====
  {
    name: 'Set-Cookie',
    category: 'response',
    summary: '设置 Cookie（可多条）',
    syntax: 'Set-Cookie: <name>=<value>; Path=<path>; Domain=<domain>; Max-Age=<sec>; HttpOnly; Secure; SameSite=<value>',
    example: 'Set-Cookie: sessionId=abc123; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600',
    description: '服务端设置 Cookie，一个响应可含多条 Set-Cookie。关键属性：HttpOnly（防 XSS）、Secure（仅 HTTPS）、SameSite（防 CSRF，Lax/Strict/None）、Max-Age（秒，优先于 Expires）。',
    isResponseOnly: true,
  },
  {
    name: 'Location',
    category: 'response',
    summary: '重定向目标 URL',
    syntax: 'Location: <url>',
    example: 'Location: https://example.com/new-page',
    description: '配合 3xx 状态码实现重定向。301/302/307/308 必须包含此字段。注意相对 URL 的解析基准是请求 URL，建议使用绝对 URL 避免歧义。',
    isResponseOnly: true,
  },
  {
    name: 'Server',
    category: 'response',
    summary: '服务器软件标识',
    syntax: 'Server: <product>/<version>',
    example: 'Server: nginx/1.25.3',
    description: '标识服务器软件。出于安全考虑，生产环境常隐藏或混淆此字段，避免攻击者据此查找已知漏洞。可配置 server_tokens off（Nginx）隐藏版本号。',
    isResponseOnly: true,
  },
  {
    name: 'WWW-Authenticate',
    category: 'response',
    summary: '认证挑战（401 必需）',
    syntax: 'WWW-Authenticate: <scheme> realm="<realm>"',
    example: 'WWW-Authenticate: Bearer realm="api", error="invalid_token"',
    description: '401 Unauthorized 响应必须包含此字段，提示客户端如何认证。常见 scheme：Basic、Bearer、Digest。OAuth2/JWT 错误时也可含 error 描述。',
    isResponseOnly: true,
  },
  {
    name: 'ETag',
    category: 'response',
    summary: '资源版本标识（缓存验证）',
    syntax: 'ETag: "<opaque-tag>"',
    example: 'ETag: "33a64df551425fcc55e4d42a148795d9f25f89d4"',
    description: '资源的唯一版本标识，通常是内容哈希。客户端下次请求带 If-None-Match，服务端比较后决定返回 200 还是 304。弱 ETag（W/"..."）允许语义等价但字节不同。',
    isResponseOnly: true,
  },
  {
    name: 'Last-Modified',
    category: 'response',
    summary: '资源最后修改时间',
    syntax: 'Last-Modified: <http-date>',
    example: 'Last-Modified: Wed, 21 Oct 2025 07:28:00 GMT',
    description: '资源最后修改时间，精度限于秒。客户端下次请求带 If-Modified-Since 验证。与 ETag 同时存在时，两个条件都满足才返回 304。',
    isResponseOnly: true,
  },
  {
    name: 'Vary',
    category: 'response',
    summary: '响应随哪些请求头变化',
    syntax: 'Vary: <header-name>, <header-name>',
    example: 'Vary: Accept-Encoding, Accept-Language',
    description: '告诉缓存服务器：响应内容随指定请求头变化。常见 Vary: Accept-Encoding（区分压缩与否）。CORS 场景必含 Vary: Origin。错误配置会导致缓存串内容。',
    isResponseOnly: true,
  },
  {
    name: 'Content-Disposition',
    category: 'entity',
    summary: '建议客户端如何展示主体',
    syntax: 'Content-Disposition: inline | attachment; filename="<name>"',
    example: 'Content-Disposition: attachment; filename="report.pdf"',
    description: 'inline 表示直接展示，attachment 表示下载。filename 建议下载文件名。RFC 5987 扩展支持 filename* 处理非 ASCII：filename*=UTF-8\'\'%E6%8A%A5%E5%91%8A.pdf',
  },

  // ===== CORS 头 =====
  {
    name: 'Access-Control-Allow-Origin',
    category: 'cors',
    summary: '允许跨域的源',
    syntax: 'Access-Control-Allow-Origin: * | <origin> | null',
    example: 'Access-Control-Allow-Origin: https://example.com',
    description: '指定允许跨域访问的源。* 允许任意源（但不允许携带凭证）。携带 Cookie 时必须指定具体源，不能用 *。生产环境应严格白名单校验，避免任意源。',
    isResponseOnly: true,
  },
  {
    name: 'Access-Control-Allow-Methods',
    category: 'cors',
    summary: '允许跨域的 HTTP 方法',
    syntax: 'Access-Control-Allow-Methods: <method>, <method>',
    example: 'Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS',
    description: '预检响应（OPTIONS）中声明允许的 HTTP 方法。简单请求（GET/POST/HEAD + 标准 Header）不触发预检，复杂请求会先发 OPTIONS。',
    isResponseOnly: true,
  },
  {
    name: 'Access-Control-Allow-Headers',
    category: 'cors',
    summary: '允许跨域的自定义请求头',
    syntax: 'Access-Control-Allow-Headers: <header-name>, <header-name>',
    example: 'Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With',
    description: '预检响应中声明允许的自定义请求头。简单请求只允许少数标准头，自定义头（如 X-Custom）需在此声明。',
    isResponseOnly: true,
  },
  {
    name: 'Access-Control-Allow-Credentials',
    category: 'cors',
    summary: '允许跨域携带凭证',
    syntax: 'Access-Control-Allow-Credentials: true',
    example: 'Access-Control-Allow-Credentials: true',
    description: 'true 表示允许跨域请求携带 Cookie 与 Authorization。设为 true 时 Allow-Origin 必须为具体源（不能为 *）。前后端都需配置（前端 fetch credentials: "include"）。',
    isResponseOnly: true,
  },
  {
    name: 'Access-Control-Max-Age',
    category: 'cors',
    summary: '预检结果缓存时长',
    syntax: 'Access-Control-Max-Age: <seconds>',
    example: 'Access-Control-Max-Age: 86400',
    description: '预检响应缓存时长，避免重复预检。浏览器有上限（Chrome 最多 2 小时，Firefox 24 小时）。低频跨域 API 可设大些，频繁变更的可设小。',
    isResponseOnly: true,
  },

  // ===== 安全头 =====
  {
    name: 'Content-Security-Policy',
    category: 'security',
    summary: '内容安全策略（防 XSS 注入）',
    syntax: 'Content-Security-Policy: <directive>; <directive>',
    example: "Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.example.com; style-src 'self' 'unsafe-inline'",
    description: '限制资源加载来源，是防御 XSS 的最强工具。default-src 兜底，script-src/style-src/img-src 细分。report-uri 收集违规报告。建议先用 Content-Security-Policy-Report-Only 观察再切换。',
    isResponseOnly: true,
  },
  {
    name: 'Strict-Transport-Security',
    category: 'security',
    summary: '强制 HTTPS（HSTS）',
    syntax: 'Strict-Transport-Security: max-age=<sec>; includeSubDomains; preload',
    example: 'Strict-Transport-Security: max-age=31536000; includeSubDomains; preload',
    description: '告诉浏览器在 max-age 内强制使用 HTTPS，防 SSL 剥离降级攻击。includeSubDomains 含子域。preload 可申请加入浏览器内置 HSTS 列表。注意：先确保全站 HTTPS 再启用，否则子域会无法访问。',
    isResponseOnly: true,
  },
  {
    name: 'X-Content-Type-Options',
    category: 'security',
    summary: '禁止 MIME 嗅探',
    syntax: 'X-Content-Type-Options: nosniff',
    example: 'X-Content-Type-Options: nosniff',
    description: 'nosniff 阻止浏览器嗅探 MIME 类型，必须按 Content-Type 处理。防止把用户上传的文本文件当脚本执行。所有响应都应配置。',
    isResponseOnly: true,
  },
  {
    name: 'X-Frame-Options',
    category: 'security',
    summary: '防止点击劫持（被 iframe 嵌入）',
    syntax: 'X-Frame-Options: DENY | SAMEORIGIN',
    example: 'X-Frame-Options: SAMEORIGIN',
    description: 'DENY 完全禁止被 iframe 嵌入，SAMEORIGIN 仅允许同源。已被 CSP frame-anchors 取代，但旧浏览器仍需此头。两者同时配置以兼容。',
    isResponseOnly: true,
  },
  {
    name: 'Referrer-Policy',
    category: 'security',
    summary: '控制 Referer 发送策略',
    syntax: 'Referrer-Policy: no-referrer | same-origin | strict-origin-when-cross-origin | ...',
    example: 'Referrer-Policy: strict-origin-when-cross-origin',
    description: '控制何时发送 Referer 及发送多少。strict-origin-when-cross-origin 是默认值，跨域仅发源。同源发完整 URL。no-referrer 完全不发。',
    isResponseOnly: true,
  },
  {
    name: 'Permissions-Policy',
    category: 'security',
    summary: '控制浏览器功能权限',
    syntax: 'Permissions-Policy: <feature>=<allowlist>',
    example: 'Permissions-Policy: geolocation=(), camera=(self "https://trusted.com"), microphone=*',
    description: '限制浏览器功能（摄像头/麦克风/地理位置等）的访问源。() 禁用，* 全部允许，self 仅同源。取代已废弃的 Feature-Policy。',
    isResponseOnly: true,
  },

  // ===== 缓存头 =====
  {
    name: 'Cache-Control',
    category: 'cache',
    summary: '缓存策略（最重要）',
    syntax: 'Cache-Control: <directive>, <directive>',
    example: 'Cache-Control: public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400',
    description: '缓存策略核心字段。max-age 浏览器缓存秒数，s-maxage CDN 缓存秒数，public/private 是否可被中间缓存，no-cache 强制验证，no-store 完全不缓存，immutable 永不变可永久缓存。',
  },
  {
    name: 'Expires',
    category: 'cache',
    summary: '缓存过期时间（HTTP/1.0）',
    syntax: 'Expires: <http-date>',
    example: 'Expires: Wed, 21 Oct 2025 07:28:00 GMT',
    description: 'HTTP/1.0 缓存字段，被 Cache-Control: max-age 取代。同时存在时 Cache-Control 优先。建议用 Cache-Control 替代，但保留兼容性时仍可配置。',
    isResponseOnly: true,
  },
  {
    name: 'Pragma',
    category: 'cache',
    summary: 'HTTP/1.0 缓存指令（已过时）',
    syntax: 'Pragma: no-cache',
    example: 'Pragma: no-cache',
    description: 'HTTP/1.0 时代字段，no-cache 强制不缓存。被 Cache-Control 取代，但旧浏览器与一些代理仍识别。新项目不应使用。',
  },
  {
    name: 'Age',
    category: 'cache',
    summary: '缓存已存在秒数',
    syntax: 'Age: <seconds>',
    example: 'Age: 604800',
    description: 'CDN/代理缓存的已存在秒数。配合 Date 与 Cache-Control 推算剩余缓存时间。调试 CDN 缓存命中关键指标。',
    isResponseOnly: true,
  },

  // ===== 其他通用头 =====
  {
    name: 'Date',
    category: 'general',
    summary: '报文生成时间',
    syntax: 'Date: <http-date>',
    example: 'Date: Wed, 17 Jul 2026 08:30:00 GMT',
    description: '报文生成的日期时间，必须为 HTTP-date 格式（RFC 7231）。所有报文都应包含。CDN 缓存计算基准之一。',
  },
  {
    name: 'Via',
    category: 'general',
    summary: '经过的代理/网关',
    syntax: 'Via: <protocol> <hostname>',
    example: 'Via: 1.1 cdn.example.com, 1.1 proxy.local',
    description: '记录经过的代理与协议版本，用于追踪请求路径与诊断代理环。CDN 通常会附加此字段。',
  },
  {
    name: 'X-Forwarded-For',
    category: 'request',
    summary: '客户端真实 IP 链路',
    syntax: 'X-Forwarded-For: <ip>, <ip>, <ip>',
    example: 'X-Forwarded-For: 203.0.113.5, 198.51.100.1',
    description: '记录客户端原始 IP 与经过的代理 IP 链。CDN/反向代理添加。注意客户端可伪造，生产环境应配合可信代理白名单，仅信任上一跳。X-Real-IP 是简化版（仅一个 IP）。',
    isRequestOnly: true,
  },
  {
    name: 'X-Request-ID',
    category: 'general',
    summary: '请求唯一追踪 ID',
    syntax: 'X-Request-ID: <uuid-or-opaque>',
    example: 'X-Request-ID: 550e8400-e29b-41d4-a716-446655440000',
    description: '自定义追踪 ID，便于全链路日志关联。客户端生成或网关生成，服务端记录到日志。分布式系统排障关键。规范化的同类标准是 W3C Trace Context 的 traceparent。',
  },
];

/** 模糊搜索：同时匹配名称、摘要、描述、语法、示例 */
export function searchHeaders(
  query: string,
  category: HeaderCategory | 'all',
): HeaderInfo[] {
  const q = query.trim().toLowerCase();
  return HTTP_HEADERS.filter((h) => {
    if (category !== 'all' && h.category !== category) return false;
    if (!q) return true;
    return (
      h.name.toLowerCase().includes(q) ||
      h.summary.toLowerCase().includes(q) ||
      h.description.toLowerCase().includes(q) ||
      h.syntax.toLowerCase().includes(q) ||
      h.example.toLowerCase().includes(q)
    );
  });
}

/** 获取分类统计 */
export function getCategoryStats(): Record<HeaderCategory | 'all', number> {
  const stats: Record<HeaderCategory | 'all', number> = {
    all: HTTP_HEADERS.length,
    request: 0,
    response: 0,
    general: 0,
    entity: 0,
    cors: 0,
    security: 0,
    cache: 0,
  };
  for (const h of HTTP_HEADERS) {
    stats[h.category]++;
  }
  return stats;
}

/** 解析后的单个 Header */
export interface ParsedHeader {
  name: string;
  value: string;
  /** 行号（从 1 开始，便于错误定位） */
  line: number;
  /** 解析警告（如名称含非法字符、值含控制字符等） */
  warning?: string;
}

/**
 * 解析原始 HTTP Header 文本为键值对数组
 *
 * 支持两种格式：
 *  1. 标准报文格式：每行一个 Header，name: value（冒号分隔）
 *  2. cURL 风格：-H 'name: value' 或 --header 'name: value'（每行可多个）
 *
 * 容错策略：
 *  - 空行与纯空白行跳过
 *  - 不含冒号的行作为警告记录，跳过
 *  - 名称去除首尾空白，值去除首尾空白
 *  - 名称含控制字符或非 ASCII 标记警告
 *  - 同名 Header 全部保留（HTTP 允许同名 Header 合并，如 Set-Cookie）
 */
export function parseHeaders(raw: string): ParsedHeader[] {
  const lines = raw.split(/\r?\n/);
  const result: ParsedHeader[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // 先尝试 cURL 风格解析
    const curlMatches = extractCurlHeaders(raw);
    if (curlMatches.length > 0) {
      for (const m of curlMatches) {
        result.push({ ...m, line: i + 1 });
      }
      continue;
    }

    const trimmed = raw.trim();
    if (!trimmed) continue;
    // 注释行跳过
    if (trimmed.startsWith('#')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      result.push({
        name: trimmed,
        value: '',
        line: i + 1,
        warning: '该行不含冒号分隔符，已跳过',
      });
      continue;
    }

    const name = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();

    let warning: string | undefined;
    if (!name) {
      warning = 'Header 名称为空';
    } else if (/[^\x21-\x7e]/.test(name)) {
      warning = 'Header 名称含非 ASCII 或控制字符（RFC 9110 仅允许可见 ASCII）';
    } else if (name.includes(' ')) {
      warning = 'Header 名称含空格（可能误写，RFC 9110 不允许）';
    }

    result.push({ name, value, line: i + 1, warning });
  }

  return result;
}

/** 从单行中提取所有 cURL 风格的 -H 'name: value' */
function extractCurlHeaders(line: string): Array<{ name: string; value: string; warning?: string }> {
  const matches: Array<{ name: string; value: string; warning?: string }> = [];
  // 匹配 -H '...' / -H "..." / --header '...' / --header "..."
  const re = /(?:-H|--header)\s+(['"])([^'"]+)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const raw = m[2].trim();
    const colonIdx = raw.indexOf(':');
    if (colonIdx === -1) {
      matches.push({ name: raw, value: '', warning: '该 -H 参数不含冒号分隔符' });
    } else {
      matches.push({
        name: raw.slice(0, colonIdx).trim(),
        value: raw.slice(colonIdx + 1).trim(),
      });
    }
  }
  return matches;
}

/**
 * 生成等效 cURL 命令
 *
 * @param url 目标 URL
 * @param method HTTP 方法
 * @param headers Header 键值对
 * @param body 请求主体（GET/HEAD 时忽略）
 */
export function buildCurlCommand(
  url: string,
  method: string,
  headers: ParsedHeader[],
  body: string,
): string {
  const parts: string[] = [`curl -X ${method.toUpperCase()}`];
  for (const h of headers) {
    // 单引号转义：' -> '\''（POSIX shell 标准做法）
    const escaped = h.value.replace(/'/g, "'\\''");
    parts.push(`-H '${h.name}: ${escaped}'`);
  }
  if (body && method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
    // body 用单引号包裹并转义
    const escapedBody = body.replace(/'/g, "'\\''");
    parts.push(`--data-raw '${escapedBody}'`);
  }
  parts.push(`'${url.replace(/'/g, "'\\''")}'`);
  return parts.join(' \\\n  ');
}

/**
 * 生成等效 JavaScript fetch 代码
 */
export function buildFetchCode(
  url: string,
  method: string,
  headers: ParsedHeader[],
  body: string,
): string {
  const headerObj: Record<string, string> = {};
  for (const h of headers) {
    headerObj[h.name] = h.value;
  }
  const lines: string[] = [
    `const resp = await fetch(${JSON.stringify(url)}, {`,
    `  method: ${JSON.stringify(method.toUpperCase())},`,
    `  headers: ${JSON.stringify(headerObj, null, 2).split('\n').join('\n  ')},`,
  ];
  if (body && method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
    lines.push(`  body: ${JSON.stringify(body)},`);
  }
  lines.push('});', '', 'const text = await resp.text();', 'console.log(resp.status, text);');
  return lines.join('\n');
}

/** HTTP 方法选项 */
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

/** 示例输入：方便用户快速试用 */
export const SAMPLE_RAW = `Host: api.example.com
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)
Accept: application/json
Accept-Language: zh-CN,zh;q=0.9,en;q=0.8
Accept-Encoding: gzip, deflate, br
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abc123
Content-Type: application/json; charset=utf-8
Origin: https://www.example.com
Referer: https://www.example.com/dashboard
Cookie: sessionId=abc123; theme=dark`;
