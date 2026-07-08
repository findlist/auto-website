/**
 * HTTP 状态码核心数据与查询逻辑
 *
 * 仅包含纯数据与纯函数，不依赖 DOM 与浏览器 API，便于 SSR。
 *
 * 主要能力：
 *  - 55 个 HTTP 状态码详细说明（含义、场景、原因、排查、RESTful 用法、相关码对比）
 *  - 5 大类分类元数据（1xx/2xx/3xx/4xx/5xx）
 *  - 搜索过滤：关键词匹配 + 分类筛选
 */

/** 状态码大类 */
export type StatusCategory = '1xx' | '2xx' | '3xx' | '4xx' | '5xx';

/** 大类元数据 */
export interface CategoryMeta {
  code: StatusCategory;
  name: string;
  englishName: string;
  description: string;
  color: string; // 用于 UI 标签着色
}

/** 相关状态码对比项 */
export interface RelatedCode {
  code: number;
  name: string;
  difference: string; // 与当前码的核心差异
}

/** 单个 HTTP 状态码完整信息 */
export interface HttpStatus {
  code: number;
  name: string; // 英文名（RFC 标准）
  category: StatusCategory;
  description: string; // 一句话含义
  detail: string; // 详细说明（含语义、协议要点）
  scene: string; // 典型场景
  commonCause?: string; // 常见原因（4xx/5xx）
  troubleshooting?: string; // 排查建议（4xx/5xx）
  restfulUsage: string; // RESTful API 使用建议
  commonHeaders?: string[]; // 常配合的响应头
  relatedCodes?: RelatedCode[]; // 相关状态码对比
  common: boolean; // 是否高频常见
}

/** 5 大类元数据 */
export const CATEGORY_METAS: CategoryMeta[] = [
  {
    code: '1xx',
    name: '信息响应',
    englishName: 'Informational',
    description: '请求已接收，继续处理。HTTP/1.1 引入，实际开发中几乎不会主动使用。',
    color: '#6b7280',
  },
  {
    code: '2xx',
    name: '成功',
    englishName: 'Success',
    description: '请求已成功接收、理解、处理。日常开发最常用的状态码类别。',
    color: '#10b981',
  },
  {
    code: '3xx',
    name: '重定向',
    englishName: 'Redirection',
    description: '需要进一步操作才能完成请求。重定向语义是 SEO 与缓存策略的核心。',
    color: '#3b82f6',
  },
  {
    code: '4xx',
    name: '客户端错误',
    englishName: 'Client Error',
    description: '客户端发送的请求有问题。最常见的错误状态码类别。',
    color: '#f59e0b',
  },
  {
    code: '5xx',
    name: '服务端错误',
    englishName: 'Server Error',
    description: '服务器在处理请求时出错。通常是后端 bug 或基础设施问题。',
    color: '#ef4444',
  },
];

/** 55 个 HTTP 状态码完整数据 */
export const HTTP_STATUS_CODES: HttpStatus[] = [
  // ============ 1xx 信息响应 ============
  {
    code: 100,
    name: 'Continue',
    category: '1xx',
    description: '客户端应继续发送请求体',
    detail: '客户端发送带 Expect: 100-continue 头的请求，服务器同意接收请求体时返回 100，客户端再继续发送 body。',
    scene: '大文件上传前用 Expect: 100-continue 探测服务器是否接受',
    restfulUsage: 'API 中几乎不主动使用，由 HTTP 库底层处理',
    commonHeaders: ['Expect'],
    common: false,
  },
  {
    code: 101,
    name: 'Switching Protocols',
    category: '1xx',
    description: '切换协议',
    detail: '服务器同意客户端的 Upgrade 请求，切换到新协议。最常见的是从 HTTP 升级到 WebSocket。',
    scene: 'WebSocket 握手时从 HTTP 升级到 WebSocket 长连接',
    restfulUsage: '不用于 RESTful API，是协议升级专用',
    commonHeaders: ['Upgrade', 'Connection'],
    common: true,
  },
  {
    code: 103,
    name: 'Early Hints',
    category: '1xx',
    description: '提前 hints，预加载资源',
    detail: '服务器在最终响应前先发 103，提示浏览器预加载关键资源（CSS、字体），可改善 LCP 200-500ms。Cloudflare、Vercel 已支持。',
    scene: '在最终响应前预加载 CSS、字体等关键资源',
    restfulUsage: '由服务器/CDN 自动注入，业务代码不直接处理',
    commonHeaders: ['Link'],
    common: false,
  },

  // ============ 2xx 成功 ============
  {
    code: 200,
    name: 'OK',
    category: '2xx',
    description: '请求成功，响应体含结果',
    detail: '通用成功响应。GET/POST/PUT/PATCH 普通成功都可用 200。响应体应包含请求的资源或操作结果。',
    scene: 'GET 获取资源、PUT 更新已有资源、PATCH 部分更新',
    restfulUsage: 'GET/PUT/PATCH 成功且响应体有数据时用 200',
    common: true,
  },
  {
    code: 201,
    name: 'Created',
    category: '2xx',
    description: '资源已创建，Location 头指向新资源',
    detail: 'POST 创建资源成功后返回 201，必须在 Location 响应头中返回新资源的 URL。',
    scene: 'POST 创建新资源（如注册用户、创建订单）',
    restfulUsage: 'POST 创建资源成功用 201，并在 Location 头返回新资源 URL',
    commonHeaders: ['Location'],
    relatedCodes: [
      { code: 200, name: 'OK', difference: '200 是通用成功；201 明确表示「已创建」并要求 Location 头' },
      { code: 204, name: 'No Content', difference: '204 无响应体；201 通常有响应体含新资源' },
    ],
    common: true,
  },
  {
    code: 202,
    name: 'Accepted',
    category: '2xx',
    description: '请求已接受，但处理尚未完成',
    detail: '异步任务接收后返回 202，表示服务器已接受请求但处理尚未完成。客户端需轮询或通过回调获取最终结果。',
    scene: '异步任务接收（如导出报表、批量导入、视频转码）',
    restfulUsage: '异步任务接收用 202，配合 Location 头指向任务状态查询接口',
    commonHeaders: ['Location'],
    common: false,
  },
  {
    code: 203,
    name: 'Non-Authoritative Information',
    category: '2xx',
    description: '非权威信息',
    detail: '返回的元信息不是来自原始服务器，而是本地或第三方副本。极少使用。',
    scene: '代理服务器修改了响应内容时使用',
    restfulUsage: 'RESTful API 几乎不用',
    common: false,
  },
  {
    code: 204,
    name: 'No Content',
    category: '2xx',
    description: '成功但无响应体',
    detail: '成功响应但无响应体。常用于 DELETE/PUT 成功且无需返回内容时。响应不能包含 message-body。',
    scene: 'DELETE 删除资源成功、PUT 更新无需返回内容',
    restfulUsage: 'DELETE/PUT 成功且无返回内容时用 204，客户端无需处理响应体',
    relatedCodes: [
      { code: 200, name: 'OK', difference: '200 有响应体；204 无响应体' },
      { code: 201, name: 'Created', difference: '201 表示创建；204 表示成功但无内容' },
    ],
    common: true,
  },
  {
    code: 206,
    name: 'Partial Content',
    category: '2xx',
    description: '部分内容，Range 请求成功',
    detail: '客户端发送 Range 请求，服务器返回指定范围的内容。是视频播放、断点续传、大文件分片下载的基础。',
    scene: '视频播放拖动进度条、断点续传、大文件分片下载',
    restfulUsage: '由静态资源服务器/CDN 自动处理，业务 API 极少主动用',
    commonHeaders: ['Content-Range', 'Accept-Ranges'],
    common: true,
  },
  {
    code: 226,
    name: 'IM Used',
    category: '2xx',
    description: 'IM 编码已应用',
    detail: '服务器对 GET 请求应用了增量编码（Delta encoding）。极少使用。',
    scene: '增量编码场景（罕见）',
    restfulUsage: '几乎不用',
    common: false,
  },

  // ============ 3xx 重定向 ============
  {
    code: 301,
    name: 'Moved Permanently',
    category: '3xx',
    description: '永久重定向，SEO 权重传递',
    detail: '资源已永久移动到新 URL。搜索引擎会把旧 URL 的权重、外链、收录转移到新 URL，几个月后旧 URL 从索引消失。',
    scene: '域名迁移、HTTP 升级 HTTPS、旧文章迁移到新路径',
    restfulUsage: '资源永久移动用 301，搜索引擎会转移权重',
    commonHeaders: ['Location'],
    relatedCodes: [
      { code: 302, name: 'Found', difference: '301 永久，权重传递；302 临时，权重不传递' },
      { code: 308, name: 'Permanent Redirect', difference: '301 可能改 POST 为 GET；308 严格保持原方法' },
    ],
    common: true,
  },
  {
    code: 302,
    name: 'Found',
    category: '3xx',
    description: '临时重定向，权重不传递',
    detail: '资源临时移动到新 URL。搜索引擎不转移权重，旧 URL 仍保留在索引中。浏览器实现可能把 POST 改为 GET。',
    scene: '临时维护页跳转、A/B 测试、移动端跳转 m.example.com',
    restfulUsage: '临时跳转用 302，权重不传递',
    commonHeaders: ['Location'],
    relatedCodes: [
      { code: 301, name: 'Moved Permanently', difference: '302 临时；301 永久' },
      { code: 307, name: 'Temporary Redirect', difference: '302 可能改方法；307 严格保持原方法' },
    ],
    common: true,
  },
  {
    code: 303,
    name: 'See Other',
    category: '3xx',
    description: '用 GET 访问另一个 URL',
    detail: '强制客户端用 GET 方法访问 Location 头指定的 URL。是 PRG（Post-Redirect-Get）模式的标准状态码，避免表单刷新重复提交。',
    scene: '表单 POST 后重定向到 GET 成功页面（PRG 模式）',
    restfulUsage: 'PRG 模式：POST 表单后用 303 重定向到 GET 页面',
    commonHeaders: ['Location'],
    common: true,
  },
  {
    code: 304,
    name: 'Not Modified',
    category: '3xx',
    description: '资源未修改，用缓存',
    detail: '客户端发送条件请求（If-Modified-Since/If-None-Match），服务器校验资源未修改后返回 304，无响应体，浏览器用本地缓存。',
    scene: '静态资源缓存优化（CSS、JS、图片）',
    restfulUsage: '由静态资源服务器自动处理，配合 ETag/Last-Modified',
    commonHeaders: ['ETag', 'Last-Modified', 'Cache-Control'],
    common: true,
  },
  {
    code: 307,
    name: 'Temporary Redirect',
    category: '3xx',
    description: '临时重定向，保持原方法',
    detail: '临时重定向，严格保持原 HTTP 方法（POST 重定向后仍是 POST）。解决了 302 可能改方法的歧义。',
    scene: '临时跳转且需保持 POST 方法（如 HSTS 重定向）',
    restfulUsage: '临时跳转且需保持 HTTP 方法时用 307',
    commonHeaders: ['Location'],
    relatedCodes: [
      { code: 302, name: 'Found', difference: '307 严格保持方法；302 可能改方法' },
      { code: 308, name: 'Permanent Redirect', difference: '307 临时；308 永久' },
    ],
    common: true,
  },
  {
    code: 308,
    name: 'Permanent Redirect',
    category: '3xx',
    description: '永久重定向，保持原方法',
    detail: '永久重定向，严格保持原 HTTP 方法。结合了 301 的永久性与 307 的方法保持性。',
    scene: '永久迁移且需保持 POST 方法（如 API 版本升级）',
    restfulUsage: '永久跳转且需保持 HTTP 方法时用 308',
    commonHeaders: ['Location'],
    relatedCodes: [
      { code: 301, name: 'Moved Permanently', difference: '308 严格保持方法；301 可能改方法' },
      { code: 307, name: 'Temporary Redirect', difference: '308 永久；307 临时' },
    ],
    common: false,
  },

  // ============ 4xx 客户端错误 ============
  {
    code: 400,
    name: 'Bad Request',
    category: '4xx',
    description: '请求语法错误',
    detail: '客户端请求存在语法错误，服务器无法理解。常见于参数格式错误、JSON 解析失败、缺必填字段。',
    scene: 'JSON 格式错误、参数缺失、参数类型错误',
    commonCause: 'JSON 解析失败、必填字段缺失、参数格式不匹配',
    troubleshooting: '检查请求体 JSON 是否合法、必填字段是否完整、参数类型是否符合 API 文档',
    restfulUsage: '请求语法错误（JSON 解析失败、缺必填字段）用 400',
    relatedCodes: [
      { code: 422, name: 'Unprocessable Entity', difference: '400 语法错误；422 语义错误（字段合法但值非法）' },
    ],
    common: true,
  },
  {
    code: 401,
    name: 'Unauthorized',
    category: '4xx',
    description: '未认证，缺少或无效的凭证',
    detail: '服务器不知道客户端身份。响应应含 WWW-Authenticate 头，指示认证方式（如 Bearer、Basic）。',
    scene: '未登录访问受保护资源、JWT 过期、Authorization 头缺失',
    commonCause: '未携带 Authorization 头、JWT 过期、Token 无效',
    troubleshooting: '检查 Authorization 头是否存在、JWT 是否过期、用 JWT 解码工具验证 Token 内容',
    restfulUsage: '未认证用 401，响应含 WWW-Authenticate 头',
    commonHeaders: ['WWW-Authenticate'],
    relatedCodes: [
      { code: 403, name: 'Forbidden', difference: '401 未认证（不知道你是谁）；403 未授权（知道你是谁但无权限）' },
    ],
    common: true,
  },
  {
    code: 402,
    name: 'Payment Required',
    category: '4xx',
    description: '需要付费',
    detail: '保留供将来使用。部分 API 用于表示需要付费才能访问，但非 RFC 强制语义。',
    scene: '付费 API 限制（非标准用法）',
    restfulUsage: '极少使用，可用于付费墙场景',
    common: false,
  },
  {
    code: 403,
    name: 'Forbidden',
    category: '4xx',
    description: '已认证但无权限',
    detail: '服务器知道客户端身份，但该身份无权限访问此资源。与 401 的关键区别：401 是「不知道你是谁」，403 是「知道你是谁但无权限」。',
    scene: '普通用户访问管理员接口、用户访问他人私有资源',
    commonCause: '用户角色权限不足、资源归属他人、IP 被封禁',
    troubleshooting: '检查用户角色权限、用 JWT 解码工具查看 role 字段、确认资源归属',
    restfulUsage: '已认证但无权限用 403',
    relatedCodes: [
      { code: 401, name: 'Unauthorized', difference: '403 已认证无权限；401 未认证' },
    ],
    common: true,
  },
  {
    code: 404,
    name: 'Not Found',
    category: '4xx',
    description: '资源不存在',
    detail: '服务器找不到请求的资源。最常见的错误状态码之一。资源当前不存在，但未来可能存在。',
    scene: 'URL 错误、文章已删除、用户不存在',
    commonCause: 'URL 拼写错误、资源已删除、路由配置错误',
    troubleshooting: '检查 URL 拼写、确认资源 ID 是否存在、检查路由配置',
    restfulUsage: '资源不存在用 404',
    relatedCodes: [
      { code: 410, name: 'Gone', difference: '404 当前不存在；410 永久消失，搜索引擎立即移除索引' },
    ],
    common: true,
  },
  {
    code: 405,
    name: 'Method Not Allowed',
    category: '4xx',
    description: 'HTTP 方法不允许',
    detail: '请求的 HTTP 方法不被资源支持。响应应含 Allow 头，列出支持的方法。',
    scene: '对只读资源发 POST、对集合资源发 PATCH',
    commonCause: '用了错误的 HTTP 方法（如对只读接口发 POST）',
    troubleshooting: '检查 API 文档支持的 HTTP 方法、响应 Allow 头',
    restfulUsage: '方法不支持时用 405，响应含 Allow 头列出支持的方法',
    commonHeaders: ['Allow'],
    common: true,
  },
  {
    code: 406,
    name: 'Not Acceptable',
    category: '4xx',
    description: 'Accept 协商失败',
    detail: '客户端 Accept 头请求的格式服务器都无法满足。',
    scene: '客户端请求 application/xml 但服务器只支持 application/json',
    commonCause: 'Accept 头请求了不支持的格式',
    troubleshooting: '检查 Accept 头、确认服务器支持的 Content-Type',
    restfulUsage: '内容协商失败时用 406',
    common: false,
  },
  {
    code: 408,
    name: 'Request Timeout',
    category: '4xx',
    description: '请求超时',
    detail: '客户端在服务器等待超时时间内未发送请求。',
    scene: '客户端网络慢、连接建立后未发送数据',
    commonCause: '客户端网络问题、连接建立后未发送完整请求',
    troubleshooting: '检查客户端网络、增加客户端超时时间',
    restfulUsage: '客户端请求超时用 408',
    common: false,
  },
  {
    code: 409,
    name: 'Conflict',
    category: '4xx',
    description: '请求冲突',
    detail: '请求与服务器当前状态冲突。常见于唯一约束冲突、乐观锁版本冲突。',
    scene: '注册邮箱已存在、乐观锁版本号不匹配、并发更新冲突',
    commonCause: '唯一约束冲突、乐观锁版本不匹配、并发更新',
    troubleshooting: '检查唯一约束、确认乐观锁版本号、使用幂等键避免重复',
    restfulUsage: '资源冲突（唯一约束、乐观锁）用 409',
    common: true,
  },
  {
    code: 410,
    name: 'Gone',
    category: '4xx',
    description: '资源永久消失',
    detail: '资源已被永久删除，不会再回来。搜索引擎会立即移除索引（404 会保留一段时间）。删除文章时应返回 410 而非 404。',
    scene: '文章永久删除、账号注销后资源清理',
    commonCause: '资源被永久删除',
    troubleshooting: '确认资源是否真的永久删除、若是则持续返回 410',
    restfulUsage: '资源永久删除用 410（区别于 404 的「当前不存在」）',
    relatedCodes: [
      { code: 404, name: 'Not Found', difference: '410 永久消失；404 当前不存在但未来可能存在' },
    ],
    common: false,
  },
  {
    code: 411,
    name: 'Length Required',
    category: '4xx',
    description: '需要 Content-Length 头',
    detail: '服务器要求请求包含 Content-Length 头，但客户端未提供。',
    scene: 'POST/PUT 请求未带 Content-Length',
    commonCause: '请求未携带 Content-Length 头',
    troubleshooting: '检查请求头是否包含 Content-Length',
    restfulUsage: '缺少 Content-Length 时用 411',
    commonHeaders: ['Content-Length'],
    common: false,
  },
  {
    code: 412,
    name: 'Precondition Failed',
    category: '4xx',
    description: 'If-Match 条件失败',
    detail: '客户端请求的条件头（如 If-Match、If-Unmodified-Since）未满足。',
    scene: '乐观锁更新时 If-Match ETag 不匹配',
    commonCause: '条件请求头（If-Match/If-Unmodified-Since）未满足',
    troubleshooting: '检查 If-Match 的 ETag 是否与服务器一致',
    restfulUsage: '条件请求失败时用 412',
    commonHeaders: ['If-Match', 'If-Unmodified-Since'],
    common: false,
  },
  {
    code: 413,
    name: 'Payload Too Large',
    category: '4xx',
    description: '请求体过大',
    detail: '请求体超过了服务器允许的最大值。',
    scene: '上传文件超限、请求 JSON 过大',
    commonCause: '上传文件超过服务器限制、请求体超过 Nginx client_max_body_size',
    troubleshooting: '检查服务器上传限制、压缩文件或分片上传',
    restfulUsage: '请求体超限时用 413',
    common: true,
  },
  {
    code: 414,
    name: 'URI Too Long',
    category: '4xx',
    description: 'URI 过长',
    detail: '请求的 URI 超过了服务器允许的最大长度。',
    scene: 'GET 请求查询参数过多、URL 编码后过长',
    commonCause: 'GET 请求参数过多、URL 编码后超长',
    troubleshooting: '改用 POST 请求、精简查询参数',
    restfulUsage: 'URI 过长时用 414，建议改用 POST',
    common: false,
  },
  {
    code: 415,
    name: 'Unsupported Media Type',
    category: '4xx',
    description: '不支持的媒体类型',
    detail: '请求的 Content-Type 服务器不支持。',
    scene: '服务器只接受 application/json 但客户端发了 application/xml',
    commonCause: 'Content-Type 头错误、服务器不支持该格式',
    troubleshooting: '检查 Content-Type 头、确认服务器支持的格式',
    restfulUsage: 'Content-Type 不支持时用 415',
    commonHeaders: ['Content-Type', 'Accept'],
    common: true,
  },
  {
    code: 416,
    name: 'Range Not Satisfiable',
    category: '4xx',
    description: 'Range 范围无法满足',
    detail: '客户端请求的 Range 范围超出资源实际大小。',
    scene: '视频拖动到不存在的范围、下载分片范围错误',
    commonCause: 'Range 头请求范围超出资源大小',
    troubleshooting: '检查 Range 头、确认资源实际大小',
    restfulUsage: 'Range 请求无效时用 416',
    commonHeaders: ['Range', 'Content-Range'],
    common: false,
  },
  {
    code: 417,
    name: 'Expectation Failed',
    category: '4xx',
    description: 'Expect 头无法满足',
    detail: '服务器无法满足客户端 Expect 头的期望。',
    scene: 'Expect: 100-continue 但服务器不支持',
    commonCause: 'Expect 头期望服务器无法满足',
    troubleshooting: '检查 Expect 头、移除或修改期望',
    restfulUsage: '几乎不用',
    common: false,
  },
  {
    code: 418,
    name: "I'm a teapot",
    category: '4xx',
    description: '我是一个茶壶（愚人节玩笑）',
    detail: 'RFC 2324（HTCPCP 协议）定义的愚人节玩笑状态码。表示服务器是一个茶壶，无法煮咖啡。部分 API 用于表示「拒绝处理此请求」的幽默表达。',
    scene: '愚人节彩蛋、部分 API 用于拒绝请求',
    restfulUsage: '不用于正式 API，可作为彩蛋',
    common: false,
  },
  {
    code: 421,
    name: 'Misdirected Request',
    category: '4xx',
    description: '请求被错误路由',
    detail: 'HTTP/2 中请求被发送到无法响应的服务器。',
    scene: 'HTTP/2 连接复用时请求路由错误',
    commonCause: 'HTTP/2 连接复用配置错误',
    troubleshooting: '检查 HTTP/2 连接配置、DNS 解析',
    restfulUsage: '几乎不用',
    common: false,
  },
  {
    code: 422,
    name: 'Unprocessable Entity',
    category: '4xx',
    description: '语义错误，字段值非法',
    detail: '来自 WebDAV，已成为 RESTful API 校验错误的事实标准。区别于 400：400 是语法错误（JSON 解析失败），422 是语义错误（字段类型对但值非法，如 age: -5）。',
    scene: '字段类型对但值非法（如年龄为负数、邮箱格式错误）',
    commonCause: '字段值非法、业务规则校验失败',
    troubleshooting: '检查字段值是否符合业务规则、查看响应错误详情',
    restfulUsage: '语义校验失败（字段值非法）用 422，区别于 400 的语法错误',
    relatedCodes: [
      { code: 400, name: 'Bad Request', difference: '422 语义错误；400 语法错误' },
    ],
    common: true,
  },
  {
    code: 423,
    name: 'Locked',
    category: '4xx',
    description: '资源已锁定',
    detail: 'WebDAV 扩展状态码，资源被锁定无法操作。',
    scene: 'WebDAV 资源锁定、文档协同编辑锁',
    restfulUsage: '资源锁定场景（罕见）',
    common: false,
  },
  {
    code: 424,
    name: 'Failed Dependency',
    category: '4xx',
    description: '依赖请求失败',
    detail: 'WebDAV 扩展状态码，因前一个请求失败导致当前请求无法完成。',
    scene: 'WebDAV 批量操作中前置请求失败',
    restfulUsage: '几乎不用',
    common: false,
  },
  {
    code: 425,
    name: 'Too Early',
    category: '4xx',
    description: '过早请求',
    detail: '服务器不愿处理可能被重放的请求（TLS 1.3 0-RTT 数据）。',
    scene: 'TLS 1.3 0-RTT 反重放保护',
    restfulUsage: '几乎不用',
    common: false,
  },
  {
    code: 426,
    name: 'Upgrade Required',
    category: '4xx',
    description: '需要升级协议',
    detail: '服务器要求客户端升级到指定协议版本。',
    scene: '要求客户端升级到 TLS 1.2 或 HTTP/2',
    commonCause: '客户端协议版本过低',
    troubleshooting: '升级客户端协议版本',
    restfulUsage: '几乎不用',
    commonHeaders: ['Upgrade'],
    common: false,
  },
  {
    code: 428,
    name: 'Precondition Required',
    category: '4xx',
    description: '需要前置条件',
    detail: '服务器要求请求包含条件头（如 If-Match）以防止丢失更新问题。',
    scene: '更新资源时要求带 If-Match ETag 防止并发覆盖',
    commonCause: '更新请求未带 If-Match 条件头',
    troubleshooting: '在请求中添加 If-Match 头',
    restfulUsage: '要求条件头防止丢失更新时用 428',
    common: false,
  },
  {
    code: 429,
    name: 'Too Many Requests',
    category: '4xx',
    description: '请求过多，限流触发',
    detail: '客户端请求频率超过限制。必须配合 Retry-After 头，告知客户端等待时间。',
    scene: 'API 限流、爬虫防护、登录尝试限制',
    commonCause: '请求频率超限、爬虫触发反爬、登录尝试过多',
    troubleshooting: '降低请求频率、尊重 Retry-After 头、使用指数退避',
    restfulUsage: '限流响应用 429，必须配合 Retry-After 头',
    commonHeaders: ['Retry-After', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
    common: true,
  },
  {
    code: 431,
    name: 'Request Header Fields Too Large',
    category: '4xx',
    description: '请求头过大',
    detail: '请求头字段过大或字段过多，服务器无法处理。',
    scene: 'Cookie 过多过大、Authorization 头过长',
    commonCause: '请求头字段过多或单个字段过大',
    troubleshooting: '清理 Cookie、精简请求头',
    restfulUsage: '请求头过大时用 431',
    common: false,
  },
  {
    code: 451,
    name: 'Unavailable For Legal Reasons',
    category: '4xx',
    description: '因法律原因不可用',
    detail: '因法律原因（如版权、政府审查）拒绝提供资源。响应体应说明法律依据。',
    scene: '版权内容下架、地区审查屏蔽',
    commonCause: '法律要求下架、地区限制',
    troubleshooting: '检查内容是否违反法律、确认地区限制',
    restfulUsage: '法律原因拒绝时用 451',
    common: false,
  },

  // ============ 5xx 服务端错误 ============
  {
    code: 500,
    name: 'Internal Server Error',
    category: '5xx',
    description: '通用服务端错误',
    detail: '服务器内部错误。最通用的 5xx 错误，通常是后端代码抛异常、数据库连接失败、空指针等。',
    scene: '后端代码异常、数据库连接失败、空指针、未捕获错误',
    commonCause: '后端代码 bug、数据库连接失败、第三方服务异常、空指针',
    troubleshooting: '查后端日志、定位异常堆栈、检查数据库连接、监控告警',
    restfulUsage: '通用服务端错误用 500，但不应暴露堆栈给客户端',
    relatedCodes: [
      { code: 502, name: 'Bad Gateway', difference: '500 应用代码出错；502 网关无法连接后端' },
      { code: 503, name: 'Service Unavailable', difference: '500 意外错误；503 主动拒绝（维护/过载）' },
    ],
    common: true,
  },
  {
    code: 501,
    name: 'Not Implemented',
    category: '5xx',
    description: '服务器不支持此功能',
    detail: '服务器不支持请求的功能，无法完成请求。',
    scene: '客户端用了服务器未实现的 HTTP 方法（如 TRACE、CONNECT）',
    commonCause: '服务器未实现该方法或功能',
    troubleshooting: '检查 API 文档、确认服务器支持的方法',
    restfulUsage: '功能未实现时用 501',
    common: false,
  },
  {
    code: 502,
    name: 'Bad Gateway',
    category: '5xx',
    description: '网关收到无效响应',
    detail: '作为网关或代理的服务器从上游服务器收到无效响应。最常见的是 Nginx 反向代理后端服务挂了。',
    scene: 'Nginx 反向代理后端挂了、上游服务器返回非 HTTP 响应',
    commonCause: '后端服务挂掉、后端返回格式错误、网络中断',
    troubleshooting: '检查后端服务是否运行、Nginx upstream 配置、后端健康检查',
    restfulUsage: '网关/代理错误用 502',
    relatedCodes: [
      { code: 500, name: 'Internal Server Error', difference: '502 网关无法连接后端；500 后端自身出错' },
      { code: 504, name: 'Gateway Timeout', difference: '502 收到无效响应；504 等待响应超时' },
    ],
    common: true,
  },
  {
    code: 503,
    name: 'Service Unavailable',
    category: '5xx',
    description: '服务不可用，维护或过载',
    detail: '服务器当前无法处理请求，通常是维护中或过载熔断。应配合 Retry-After 头。是熔断与降级的正确响应。',
    scene: '系统维护、过载熔断、依赖服务故障降级',
    commonCause: '系统维护、过载、熔断降级、依赖服务故障',
    troubleshooting: '检查维护计划、监控服务负载、确认熔断器状态',
    restfulUsage: '服务不可用时用 503，配合 Retry-After 头',
    commonHeaders: ['Retry-After'],
    relatedCodes: [
      { code: 500, name: 'Internal Server Error', difference: '503 主动拒绝；500 意外错误' },
      { code: 502, name: 'Bad Gateway', difference: '503 服务器自身拒绝；502 网关收到无效响应' },
    ],
    common: true,
  },
  {
    code: 504,
    name: 'Gateway Timeout',
    category: '5xx',
    description: '网关等待超时',
    detail: '作为网关或代理的服务器等待上游服务器响应超时。后端响应慢或死锁时常见。',
    scene: '后端慢查询、死锁、Nginx proxy_timeout 过短',
    commonCause: '后端响应慢、数据库死锁、Nginx 超时配置过短',
    troubleshooting: '检查后端响应时间、数据库慢查询日志、调整 Nginx proxy_timeout',
    restfulUsage: '网关超时用 504',
    relatedCodes: [
      { code: 502, name: 'Bad Gateway', difference: '504 等待超时；502 收到无效响应' },
    ],
    common: true,
  },
  {
    code: 505,
    name: 'HTTP Version Not Supported',
    category: '5xx',
    description: 'HTTP 版本不支持',
    detail: '服务器不支持请求的 HTTP 协议版本。',
    scene: '客户端用了过新的 HTTP 版本',
    commonCause: 'HTTP 版本不兼容',
    troubleshooting: '检查 HTTP 协议版本',
    restfulUsage: '几乎不用',
    common: false,
  },
  {
    code: 506,
    name: 'Variant Also Negotiates',
    category: '5xx',
    description: '透明内容协商配置错误',
    detail: '透明内容协商配置存在内部错误。',
    scene: '内容协商配置错误（罕见）',
    restfulUsage: '几乎不用',
    common: false,
  },
  {
    code: 507,
    name: 'Insufficient Storage',
    category: '5xx',
    description: '存储空间不足',
    detail: 'WebDAV 扩展状态码，服务器存储空间不足无法完成请求。',
    scene: 'WebDAV 上传时磁盘满',
    commonCause: '服务器存储空间不足',
    troubleshooting: '清理服务器磁盘空间',
    restfulUsage: '存储不足时用 507',
    common: false,
  },
  {
    code: 508,
    name: 'Loop Detected',
    category: '5xx',
    description: '检测到循环',
    detail: 'WebDAV 扩展状态码，服务器在处理请求时检测到无限循环。',
    scene: 'WebDAV 资源引用循环',
    restfulUsage: '几乎不用',
    common: false,
  },
  {
    code: 510,
    name: 'Not Extended',
    category: '5xx',
    description: '需要进一步扩展',
    detail: '服务器需要进一步扩展请求才能完成。',
    scene: 'HTTP 扩展协议场景（罕见）',
    restfulUsage: '几乎不用',
    common: false,
  },
  {
    code: 511,
    name: 'Network Authentication Required',
    category: '5xx',
    description: '需要网络认证',
    detail: '客户端需要先通过网络认证（如公共 WiFi 登录页）才能访问资源。',
    scene: '公共 WiFi 门户认证、酒店网络登录',
    commonCause: '未通过网关认证',
    troubleshooting: '完成网络门户认证',
    restfulUsage: '网络认证场景用 511',
    common: false,
  },
];

/**
 * 按关键词与分类过滤状态码
 *
 * 匹配范围：code（数字字符串）、name（英文名）、description、scene、commonCause
 * 不区分大小写；关键词为空时返回全部
 *
 * @param query 搜索关键词
 * @param category 分类筛选（'1xx'-'5xx' 或 'all'）
 * @returns 过滤后的状态码列表
 */
export function searchStatuses(
  query: string,
  category: StatusCategory | 'all' = 'all',
): HttpStatus[] {
  const q = query.trim().toLowerCase();
  return HTTP_STATUS_CODES.filter((s) => {
    // 分类筛选
    if (category !== 'all' && s.category !== category) return false;
    // 关键词筛选
    if (!q) return true;
    return (
      String(s.code).includes(q) ||
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.scene.toLowerCase().includes(q) ||
      (s.commonCause?.toLowerCase().includes(q) ?? false) ||
      (s.troubleshooting?.toLowerCase().includes(q) ?? false) ||
      s.restfulUsage.toLowerCase().includes(q)
    );
  });
}

/**
 * 按状态码精确查找
 *
 * @param code 状态码数字
 * @returns 对应的 HttpStatus 或 undefined
 */
export function findByCode(code: number): HttpStatus | undefined {
  return HTTP_STATUS_CODES.find((s) => s.code === code);
}

/**
 * 获取大类元数据
 *
 * @param category 大类标识
 * @returns 对应的 CategoryMeta 或 undefined
 */
export function getCategoryMeta(category: StatusCategory | 'all'): CategoryMeta | undefined {
  if (category === 'all') return undefined;
  return CATEGORY_METAS.find((c) => c.code === category);
}

/** 统计信息：各类状态码数量 */
export function getStatusStats(): Record<StatusCategory | 'all', number> {
  const stats: Record<StatusCategory | 'all', number> = {
    '1xx': 0,
    '2xx': 0,
    '3xx': 0,
    '4xx': 0,
    '5xx': 0,
    all: HTTP_STATUS_CODES.length,
  };
  for (const s of HTTP_STATUS_CODES) {
    stats[s.category]++;
  }
  return stats;
}
