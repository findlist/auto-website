# 部署指南 - 工具盒子

> 本地 MVP 已就绪，可部署到任意静态托管平台。本文给出三种主流免费方案的部署步骤。

## 一、项目概览

- **项目路径**：`e:\work\auto-website`
- **技术栈**：Astro 5 + React 18 + TypeScript
- **构建产物**：`dist/`（纯静态 HTML/CSS/JS）
- **当前页面**：首页 `/`、JSON 工具 `/json`（含树形视图与关键词搜索）、Base64 工具 `/base64`、URL 工具 `/url`（含 URL 解析视图）、HTML 实体编解码 `/html-entities`（含速查表、过滤与 XSS 防御演示）、UUID 生成器 `/uuid`、Hash 计算 `/hash`（含文件哈希）、AES 加解密 `/aes`（基于 Web Crypto API 纯原生零依赖实现，支持 AES-GCM/AES-CBC/AES-CTR 三种模式与 AES-128/192/256 三种密钥长度，密钥输入支持 Hex 字符串/Base64/UTF-8 口令/PBKDF2 密码派生四种来源，加密输出密文+IV+盐+派生密钥，一键「用加密结果填入解密」闭环验证，GCM 认证加密推荐、CBC padding oracle 风险提示、CTR 计数器管理、PBKDF2 密钥派生演示，零上传零追踪）、时间戳转换 `/timestamp`（含批量转换）、时区转换器 `/timezone`（多时区对比与世界时钟，基于 IANA 时区数据库，支持源时区与多个目标时区实时换算、夏令时 DST 识别、UTC 偏移展示、ISO 8601 与 Unix 时间戳复制、12/24 小时制切换，适用于跨时区会议调度、海外团队协作、国际化产品发布时间对齐等场景，纯原生 Intl.DateTimeFormat API 零依赖实现）、时间单位换算器 `/time-unit`（毫秒/秒/分/时/天/周/月/年八种单位双向换算，支持复合时长字符串解析如「1h 30min」「2天3小时」、毫秒转人类可读表示如「1 天 2 小时 30 分」、纯数字按秒解释、中英文混用、小数与负数、多片段累加，月年采用 Gregorian 历法平均值 1 年=365.2425 天 1 月≈30.436875 天精确换算，UI 标注「近似」徽章，适用于缓存 TTL 配置、超时设置、调度间隔换算、日志时间差分析等开发场景，纯原生 TypeScript 零依赖实现）、正则表达式测试 `/regex`（含数字与命名捕获组、单条复制、$1/$<name> 替换）、JWT 解码 `/jwt`（含三段展示、过期状态、相对时间、对象/数组美化、alg=none 安全警告、签名长度参考）、JWT 签名生成器 `/jwt-sign`（支持 HS256/HS384/HS512、RS256/RS384/RS512、ES256/ES384/ES512、none 共 10 种算法，在线生成 RSA 密钥对 2048/3072/4096 位与 EC 密钥对 P-256/P-384/P-521 曲线，均输出 PEM 与 JWK 双格式，HMAC 密钥长度警告，三段拆分展示，none 算法安全警告横幅，基于 Web Crypto API 纯原生零依赖实现）、JWT 签名验证工具 `/jwt-verify`（支持 HS256/HS384/HS512、RS256/RS384/RS512、ES256/ES384/ES512、none 共 10 种算法验签，粘贴 JWT 自动识别算法并切换密钥输入区，实时校验 exp/nbf/iat 时间声明，算法白名单防御 alg=none 攻击，验签结果三段拆分展示，区分「签名无效」与「声明不合规」，基于 Web Crypto API 纯原生零依赖实现）、颜色格式转换 `/color`（含调色板生成）、颜色对比度检查 `/color-contrast`（含 WCAG 2.1 评级与渲染预览）、调色板生成器 `/color-palette`（6 种和谐配色方案含互补 / 类似 / 三角 / 分割互补 / 四角 / 单色阶、设计系统色阶 Tailwind 50-950 与 Material 100-900、明度色调 Tints / Shades / Tones、WCAG 2.1 对比度检查、三种色盲模拟红色盲 / 绿色盲 / 蓝色盲、导出 CSS 变量 / Tailwind 配置 / SCSS / JSON / Android XML / iOS Swift 六种格式，纯原生 TypeScript 零依赖实现）、CSV / JSON 互转 `/csv-json`（含状态机解析、嵌套对象展平、表格预览、智能类型推断与风险提示、Excel 兼容下载）、JSON 转 XML 转换工具 `/json-to-xml`（将 JSON 数据一键转换为 XML 文档，支持根节点名、数组项名、属性风格、CDATA 包裹、XML 声明、缩进 2/4 空格或 Tab、null 表示空元素或 xsi:nil 等配置，自动转义特殊字符，非法标签名自动修正并给出警告，附带 well-formed 校验，适用于 SOAP 服务对接、SVG 生成、Office 文档、Android 资源、旧系统配置等场景，纯原生 TypeScript 零依赖实现）、XML 转 JSON 转换工具 `/xml-to-json`（将 XML 文档一键解析为 JSON 数据，基于浏览器原生 DOMParser 实现，支持属性名前缀、文本节点名、CDATA 合并/分离、空元素表示 null/空字符串/空对象、类型推断数字/布尔/null、注释过滤、缩进 2/4 空格或 Tab、子元素始终为数组等配置，同名子元素自动合并为数组，XXE 防护不加载外部实体，适用于 SOAP 响应解析、RSS/Atom Feed 读取、SVG/Office 文档解析、Spring/Maven 配置转换等场景，纯原生 TypeScript 零依赖实现）、YAML / JSON 互转 `/yaml`（含多文档支持、锚点/别名、类型推断陷阱提示、缩进配置）、TOML / JSON 互转 `/toml`（含数组表、点号键、内联表、4 种日期时间类型、类型陷阱提示：日期丢失/大整数精度/null 不支持）、Markdown 预览 `/markdown`、MIME 类型查询 `/mime`（100+ 条目、8 大类别、搜索与筛选、一键复制扩展名或 MIME）、二维码生成器 `/qr`（支持文本 / URL / WiFi / 邮件四类预设，容错等级 L/M/Q/H、尺寸、留白、前景 / 背景色可调，PNG / SVG 下载，对比度检查）、密码生成器 `/password`（自定义长度 4-128、字符集小写/大写/数字/符号/排除易混字符、批量生成 1/5/10/50、香农熵强度评估、crypto.getRandomValues + 拒绝采样）、文本对比工具 `/diff`（基于 LCS 算法实时计算行级与字符级/词级差异、分屏对比与统一 diff 两种视图、行内字符级与词级 Git --word-diff 风格两种高亮模式精确标记被修改段、统计新增/删除/修改行数与相似度百分比、大小写敏感/忽略行首尾空白/忽略空行/行内高亮模式三选一）、CRON 表达式解析器 `/cron`（5 字段语法 + L/W/# 扩展字符、实时生成中文执行描述、计算未来 5 次执行时间、12 个常用预设、字段语法说明表）、IP 子网计算器 `/ip`（IPv4/IPv6 双栈 BigInt 解析、CIDR 表示法、网络/广播地址、子网掩码与通配符掩码、主机数计算、IP 类别与私有段判定、VLSM 子网划分、二进制可视化、12 个常用预设）、Base64 图片互转 `/base64-image`（图片与 Base64 双向转换、拖拽/粘贴/上传三种输入、PNG/JPEG/WebP 格式互转与质量调节、Data URL 解析、四种复制格式：Data URL/纯 Base64/<img> 标签/CSS 背景、图片信息展示、下载）、占位文本与 Mock 数据生成器 `/lorem`（Lorem Ipsum 英文占位与中文占位文本，段落/句子/单词三种粒度，11 种 Mock 数据：中英文姓名/邮箱/URL/手机号/UUID/IPv4/颜色/日期/数字/布尔，四种输出格式：纯文本/JSON 数组/CSV/Markdown 表格，基于 CSPRNG 保证随机质量，1-100 条批量生成）、SQL 格式化与压缩 `/sql`（SQL 美化与压缩、关键字大小写转换、主子句换行、JOIN 前换行、AND/OR 前换行、子查询缩进、CASE/WHEN 缩进、2/4 空格缩进切换、逗号后空格或换行、移除注释选项、基础语法校验：引号/括号/块注释闭合、关键字/字符串/数字/注释分色高亮、6 个常见 SQL 模板：SELECT/JOIN/INSERT/UPDATE/DELETE/CREATE）、HTTP 状态码查询 `/http-status`（55+ 状态码详细说明、5 大类分类筛选：1xx 信息响应/2xx 成功/3xx 重定向/4xx 客户端错误/5xx 服务端错误、搜索匹配状态码/名称/描述/场景/原因/排查建议/RESTful 用法、accordion 卡片展开详情、相关状态码对比与跳转、常配合响应头列表、一键复制状态码、暗色模式、移动端响应式）、JSONPath 查询工具 `/jsonpath`（基于 RFC 9535 标准的三阶段解析器：词法 / 语法 / 求值，支持 $ 根、.name 子节点、..name 递归下降、[*] 通配符、[index] 索引含负索引、[?(filter)] 过滤表达式支持 ==/!=/>/>=/</<=/=~ 与 &&/||/! 组合，内置 12 个预设示例与电商订单 / 用户列表示例数据，查询结果展示索引、类型标签与单条复制，零依赖纯 TS 函数实现）、JSON Schema 校验 `/json-schema`（基于 draft-07 标准自实现的轻量校验器，支持 type/required/properties/items/enum/const/数值范围/字符串约束/数组唯一性/对象额外属性/allOf/anyOf/oneOf/not/$ref 内部引用等核心关键字，实时校验、错误路径精确定位、关键字分类徽章、中文错误消息，零依赖纯 TS 实现约 14KB）、YAML Schema 校验 `/yaml-schema`（用 JSON Schema draft-07 校验 YAML 数据，复用 jsonSchema.ts 校验引擎，支持 K8s Deployment/Service/Pod 清单、CI/CD 配置、Helm values、docker-compose 等场景，额外检测 YAML 类型推断陷阱：yes/no/on/off 布尔化、版本号被解析为数字、null/~ 被解析为 null，实时校验、错误路径定位、关键字分类徽章、中文错误消息，复用 js-yaml 解析与 jsonSchema.ts 引擎零新增依赖）、TOML Schema 校验 `/toml-schema`（用 JSON Schema draft-07 校验 TOML 数据，复用 jsonSchema.ts 校验引擎与 smol-toml 解析库，支持 pyproject.toml（PEP 621）、Cargo.toml、rust-toolchain.toml、renovate.json 等场景，额外检测 TOML 类型陷阱：日期时间值转 JSON 丢失原始类型与时区信息、64 位整数超过 Number.MAX_SAFE_INTEGER 丢失精度，实时校验、错误路径定位、关键字分类徽章、中文错误消息，复用 smol-toml 与 jsonSchema.ts 引擎零新增依赖）、正则表达式性能基准 `/regex-benchmark`（执行 N 次匹配统计平均/最大/最小/标准差耗时，静态分析检测嵌套量词、重叠分支、通配量词三类 ReDoS 危险模式，渐进式压力测试用递增长度输入判断是否指数级回溯，内置经典 ReDoS 示例 (a+)+ 与安全正则示例，performance.now 高精度计时，单次超时 2000ms 自动中止，适用于上线前正则性能审计、ReDoS 漏洞排查、正则优化效果对比）、JWE 解码 `/jwe`（基于 RFC 7516 标准，解析 JWE Compact 与 Flattened JSON 两种序列化的五段式加密令牌：protected/encrypted_key/iv/ciphertext/tag，自动 base64url 解码 Protected Header 并 JSON 美化，五段拆分视图展示段名/长度/字节数/预览，算法说明覆盖 dir/A128KW/A192KW/A256KW/RSA-OAEP/RSA-OAEP-256/384/512/RSA1_5/PBES2-HS256+A128KW/PBES2-HS384+A192KW/PBES2-HS512+A256KW/ECDH-ES/ECDH-ES+A128KW/ECDH-ES+A192KW/ECDH-ES+A256KW 共 16 种密钥管理算法与 A128GCM/A192GCM/A256GCM 内容加密算法，基于 Web Crypto API 本地解密，PBES2 系列支持密码派生解密（PBKDF2 + AES-KW，需 Protected Header 含 p2s/p2c 参数），ECDH-ES 系列支持椭圆曲线协商解密（ECDH + Concat KDF，需 Protected Header 含 epk 临时公钥，支持 P-256/P-384/P-521 曲线），明文 JSON 自动美化，若为 JWT 提示用 JWT 工具继续解码，密钥零上传零存储，生成测试 JWE 按钮可现场加密生成可解密的 dir+A128GCM 示例、PBES2-HS256+A128KW 示例与 ECDH-ES+A128GCM 示例）、Base32 编解码 `/base32`（纯原生 JS 零依赖实现 RFC 4648 与 Crockford 双变体编解码与 Crockford 校验和生成与校验，易混字符归一化，适用于 TOTP 共享密钥、账号号码、密钥指纹等场景）、Hex 十六进制编解码 `/hex`（文本与 Hex 双向转换，5 种输出格式：连续/空格分隔/0x 前缀/C 数组/Hex dump xxd 风格，大小写切换，解码自动识别多种格式容忍空格/0x/逗号/注释/Hex dump，纯原生 JS 零依赖实现 UTF-8 编解码，适用于二进制调试、字节序列分析、嵌入式开发、颜色值/MAC 地址/Magic Number 查看）、Punycode 编解码 `/punycode`（国际化域名 IDN 与 ACE 双向转换，逐标签处理含 ASCII 保留/已编码/已解码类型展示，基于 RFC 3492 Bootstring 算法纯原生 TS 零依赖实现，支持中文域名、多标签、Emoji、ACE 标签长度校验，适用于中文域名注册查询、邮件域名国际化、URL host IDN 转换、DNS 配置调试）、技术博客列表 `/blog`、博客详情 `/blog/uuid-generation-guide`、`/blog/json-formatting-guide`、`/blog/base64-encoding-guide`、`/blog/sha256-hash-guide`、`/blog/unix-timestamp-guide`、`/blog/url-encoding-guide`、`/blog/regex-test-guide`、`/blog/jwt-decode-guide`、`/blog/color-format-guide`、`/blog/markdown-practical-guide`、`/blog/frontend-encoding-overview`（跨工具专题）、`/blog/color-contrast-accessibility`（跨工具专题）、`/blog/data-format-conversion-overview`（跨工具专题，含智能类型推断与边界场景）、`/blog/web-security-csp-xss-csrf`（跨工具专题，含 XSS/CSRF/CSP 防护）、`/blog/http-status-codes-overview`（跨工具专题，含 1xx/2xx/3xx/4xx/5xx 全景与 SEO 重定向语义）、`/blog/regex-practical-patterns`（跨工具专题，含 20+ 常用模式速查、命名捕获组、ReDoS 防御、性能优化）、`/blog/jwt-security-best-practices`（跨工具专题，含 Refresh Token 双令牌、JWT 黑名单、算法选择决策树、alg=none 与密钥混淆漏洞防御）、`/blog/jwt-signing-guide`（跨工具专题，含 HS256/RS256 算法选型、HMAC 密钥管理与轮换、RSA 密钥位数与 PEM/JWK 格式、JWKS 端点、none 算法攻击场景、Web Crypto API 签名实现、声明字段最佳实践、服务端验签要点）、`/blog/ecdsa-elliptic-curve-jwt-signing-guide`（跨工具专题，含椭圆曲线密码学原理、ECDSA 签名算法、NIST P-256/P-384/P-521 曲线选择、ES256/ES384/ES512 算法、r||s raw 签名格式、Web Crypto API EC 密钥生成与签名、ES vs RS 性能与安全对比、服务端验签要点、随机数 k 安全陷阱）、`/blog/jwt-signature-verification-guide`（跨工具专题，含验签完整流程、三类算法密钥模型、Web Crypto API 验签实现、alg=none 攻击与算法白名单防御、exp/nbf/iat 时间声明校验、iss/aud/jti 业务声明、常量时间比较与时序攻击、JWKS 与密钥轮换、Node.js/Python/Java 服务端验签代码、验签失败排查）、`/blog/aes-encryption-guide`（跨工具专题，含 AES 对称加密原理、GCM/CBC/CTR 三种模式对比、认证加密、padding oracle 攻击防御、IV/Nonce 管理、密钥长度选择、PBKDF2 密码派生、Web Crypto API 加解密实现、加密-然后-MAC 方案、Node.js/Python/Java 服务端代码、常见陷阱与最佳实践）、`/blog/yaml-json-toml-comparison`（跨工具专题，含 YAML/JSON/TOML 三格式对比、类型推断陷阱、互转陷阱、选型决策树）、`/blog/toml-configuration-guide`（跨工具专题，含 TOML v1.0.0 语法详解、4 种日期时间类型、整数精度陷阱、Cargo/pyproject 真实案例）、`/blog/qr-code-design-guide`（跨工具专题，含 4 种容错等级、4 种编码模式、容量上限、颜色对比度、Logo 嵌入规则、WiFi/vCard/邮件预设格式、PNG/SVG 选型）、`/blog/password-strength-entropy`（跨工具专题，含香农熵公式、CSPRNG vs PRNG、模偏差与拒绝采样、字符集策略、NIST SP 800-63B 现代密码实践）、`/blog/diff-algorithms-lcs-myers`（跨工具专题，含 LCS 动态规划、Myers diff 算法、行级 vs 字符级 diff、统一 vs 分屏视图、相似度计算、超大文本性能边界）、`/blog/cron-expression-scheduling`（跨工具专题，含 5 字段语法、L/W/# 扩展字符、POSIX vs Quartz vs Spring 对比、dayOfMonth 与 dayOfWeek AND/OR 语义陷阱、时区与夏令时、cron 与 systemd timer/K8s CronJob/Airflow 对比）、`/blog/ipv4-ipv6-cidr-subnetting`（跨工具专题，含 IPv4/IPv6 地址结构、CIDR 表示法、子网掩码与通配符掩码、网络/广播地址、私有地址段、VLSM 子网划分、/31 与 /30 边界、IPv4-mapped IPv6）、`/blog/placeholder-mock-data-guide`（跨工具专题，含 Lorem Ipsum 历史、中文占位方案、11 种 Mock 数据设计、CSPRNG vs PRNG、四种输出格式场景适配）、`/blog/sql-parser-tokenizer-design`（跨工具专题，含 SQL 词法分析器设计、token 类型与状态机、关键字分类与缩进策略、CASE/WHEN/子查询格式化、压缩与语法校验、6 种主流 SQL 美化器对比）、`/blog/color-palette-design-guide`（跨工具专题，含 HSL 色环、6 种和谐配色方案、Tailwind / Material 色阶生成算法、明度色调 Tints / Shades / Tones、WCAG 2.1 对比度、色盲模拟 Machado 2009 矩阵变换、多格式导出实践、黄金角度随机配色、纯原生 TS 实现要点、工具联动）、`/blog/timezone-conversion-guide`（跨工具专题，含绝对时间与本地时间、UTC/GMT/Unix 时间戳、IANA 时区数据库、夏令时 DST 陷阱、ISO 8601 格式、Intl.DateTimeFormat API、时区转换算法、后端时间存储实践、前端时间展示实践、数据库时间字段方案、定时任务跨时区调度、常见时间 Bug、与时间戳工具联动，含 JavaScript/Python/Java 三语言代码示例）、`/blog/time-representation-overview`（跨工具专题，连接 timestamp/timezone/time-unit/cron 四大时间工具，覆盖绝对时间/本地时间/时长/调度四个维度，含 Gregorian 历法平均值 365.2425 天、夏令时 DST、复合时长解析、CRON 表达式语义、跨时区会议调度/缓存 TTL 监控/定时任务验证/日志时间差分析四大实战场景，含 JavaScript/Python/Java 三语言代码示例与工具矩阵速查表）、标签索引页 `/blog/tag`、91 个标签筛选页 `/blog/tag/{tag}`（javascript/uuid/web-api/json/base64/url/sha-256/hash/编码/加密/时间戳/正则/代码调试/jwt/认证/安全/颜色/css/设计/前端/html/无障碍/wcag/数据/csv/格式转换/xss/csp/csrf/http/后端/网络/状态码/markdown/文档/gfm/性能/redos/命名捕获组/刷新令牌/黑名单/算法选择/配置文件/yaml/toml/rust/python/cargo/pyproject/二维码/qr/wifi/vcard/密码/熵/csprng/随机数/diff/算法/lcs/文本对比/cron/定时任务/调度/crontab/ip/子网/cidr/ipv6/工具矩阵/占位文本/mock/测试数据/lorem/词法分析/tokenizer/解析器/数据库/签名/hmac/rsa/web crypto api 等）、RSS 订阅源 `/rss.xml`、关于 `/about`、隐私政策 `/privacy`（共 158 页）
- **构建命令**：`npm run build`
- **本地预览**：`npm run preview`
- **JS bundle**：单页最大加载约 207KB（YAML Schema 页，含共享 js-yaml 43.92KB 与 jsonSchema 6.98KB，gzip 约 68KB），其中 YamlSchemaTool 组件仅 11.30KB 为新增代码，其余为跨页共享缓存块。共享 utils 已抽取到 `src/utils/clipboard.ts`（1.34KB / gzip 0.82KB，被 25 个工具组件复用）。各工具页加载量：YAML 页约 196KB（YamlTool 50.54KB + js-yaml 库约 30KB，最大）、QR 页约 175KB（QrTool 34.47KB + qrcode 库约 45KB + client + index + clipboard）、TOML 页约 173KB（TomlTool 31.91KB + smol-toml 库约 20KB）、HTML 实体页约 158KB（HtmlEntityTool 13.46KB + client + index + clipboard）、Markdown 页约 157KB、JSON 页约 158KB、正则页约 155KB、MIME 页约 156KB、Password 页约 152KB（PasswordTool 约 13KB + client + index + clipboard，纯原生 crypto API 零依赖）、Diff 页约 156KB（DiffTool 11.91KB / gzip 3.60KB + client + index + clipboard，纯行级 + 字符级 + 词级 LCS 算法零依赖，行内高亮三模式：无/字符级/词级 Git --word-diff 风格，默认字符级可切换）、Cron 页约 155KB（CronTool 约 8KB + cron.ts 约 6KB + client + index + clipboard，纯原生 JS 零依赖）、IP 页约 159KB（IpSubnetTool 14.69KB + ip.ts 约 6KB + client + index + clipboard，纯原生 JS + BigInt 零依赖）、Base64 图片页约 154KB（Base64ImageTool 12.69KB + base64Image.ts 已 tree-shaking 合并 + client + index + clipboard，纯原生 FileReader/Canvas/Image API 零依赖）、Lorem 页约 152KB（LoremTool 约 8KB + lorem.ts 约 4KB + client + index + clipboard，纯原生 JS + crypto.getRandomValues 零依赖）、SQL 页约 152KB（SqlTool 约 10KB + sql.ts 约 8KB + client + index + clipboard，纯原生 JS 词法分析零依赖）、JSONPath 页约 152KB（JsonPathTool 16.35KB / gzip 5.55KB + jsonPath.ts 已 tree-shaking 合并 + client + index + clipboard，纯原生 TS 零依赖实现 RFC 9535 三阶段解析器）、JWE 页约 159KB（JweTool 26.66KB / gzip 7.97KB + jwe.ts 已 tree-shaking 合并 + client + index + clipboard，纯 Web Crypto API 零依赖实现 RFC 7516 JWE 解密，支持 16 种密钥管理算法含 ECDH-ES 椭圆曲线协商）、JSON Schema 页约 152KB（JsonSchemaTool 14.23KB / gzip 约 4.5KB + jsonSchema.ts 已 tree-shaking 合并 + client + index + clipboard，纯原生 TS 零依赖实现 draft-07 核心校验器，支持 type/required/properties/items/enum/const/数值范围/字符串约束/数组唯一性/对象额外属性/allOf/anyOf/oneOf/not/$ref 内部引用与 9 种 format）、YAML Schema 页约 207KB（YamlSchemaTool 11.30KB / gzip 3.48KB + jsonSchema 6.98KB 共享 + js-yaml 43.92KB 共享 + client + index + clipboard，复用 jsonSchema.ts 引擎与 js-yaml 库零新增依赖，额外检测 YAML 类型推断陷阱）、TOML Schema 页约 173KB（TomlSchemaTool 10.55KB / gzip 3.93KB + jsonSchema 6.98KB 共享 + smol-toml 20.15KB 共享 + client + index + clipboard，复用 jsonSchema.ts 引擎与 smol-toml 库零新增依赖，额外检测 TOML 类型陷阱：日期时间值丢失类型信息与大整数精度丢失）、正则基准页约 152KB（RegexBenchmarkTool 12.43KB / gzip 约 4.42KB + client + index + clipboard，纯原生 performance.now + RegExp 零依赖实现基准测试与 ReDoS 静态检测与渐进压力测试）、Base32 页约 152KB（Base32Tool 6.56KB + client + index + clipboard，纯原生 JS 零依赖实现 RFC 4648 与 Crockford 双变体编解码与校验和）、Hex 页约 152KB（HexTool 约 7KB + client + index + clipboard，纯原生 JS 零依赖实现 5 种格式输出与多格式自动识别解码）、Punycode 页约 152KB（PunycodeTool 约 7KB + punycode.ts 约 6KB + client + index + clipboard，纯原生 TS 零依赖实现 RFC 3492 Bootstring 算法与逐标签 IDN 转换）；博客与标签页为纯静态 HTML，不增加 JS

## 二、构建前必做：替换占位域名

项目内大部分 `https://toolbox.example.com` 已动态取自 `astro.config.mjs` 的 `site` 字段，**部署前只需替换以下少数硬编码处**：

1. `astro.config.mjs` 的 `site` 字段（核心配置，改后全站 WebSite / Blog / BlogPosting / CollectionPage / AboutPage JSON-LD、canonical、OG、sitemap 自动同步）
2. `public/robots.txt` 的 `Sitemap` 行
3. `src/pages/about.astro` 与 `src/pages/privacy.astro` 中的邮箱占位（也可替换为你的真实邮箱）
4. 47 个工具页（json/base64/base32/hex/punycode/ascii-art/html-formatter/css-formatter/js-formatter/json-to-ts/url/html-entities/uuid/hash/aes/timestamp/timezone/time-unit/regex/jwt/jwt-sign/jwt-verify/jwe/color/color-contrast/color-palette/csv-json/json-to-xml/xml-to-json/yaml/toml/markdown/mime/qr/password/diff/cron/ip/base64-image/lorem/sql/http-status/jsonpath/json-schema/yaml-schema/toml-schema/regex-benchmark）中 WebApplication JSON-LD 的 `url` 字段（仍为硬编码，待后续动态化）

替换示例（PowerShell）：

```powershell
# 将 toolbox.example.com 替换为你的域名，如 toolbox.liangmingzi.com
$old = 'toolbox.example.com'
$new = 'your-domain.com'
(Get-Content astro.config.mjs) -replace [regex]::Escape($old), $new | Set-Content astro.config.mjs
(Get-Content public/robots.txt) -replace [regex]::Escape($old), $new | Set-Content public/robots.txt
```

## 三、本地验证

```powershell
cd e:\work\auto-website
npm install                  # 首次需要
$env:ASTRO_TELEMETRY_DISABLED=1   # 禁用 Astro 遥测，避免沙箱报错
npm run build                # 构建到 dist/
npm run preview              # 本地预览，默认 http://localhost:4321
```

## 四、部署方案

### 方案 A：Cloudflare Pages（推荐，免费额度最大）

1. 注册 Cloudflare 账号 → Pages → 创建项目 → 连接 Git 仓库（需先把项目推到 GitHub）
2. 构建配置：
   - **框架预设**：Astro
   - **构建命令**：`npm run build`
   - **输出目录**：`dist`
   - **环境变量**：`ASTRO_TELEMETRY_DISABLED=1`
3. 部署完成后，绑定自定义域名（Cloudflare 自动配置 HTTPS）
4. 回写 `docs/site-config.md` 记录线上 URL

### 方案 B：Vercel（部署最快，体验最佳）

1. 注册 Vercel 账号 → New Project → Import Git 仓库
2. Vercel 自动识别 Astro，默认配置即可
3. Settings → Environment Variables 添加 `ASTRO_TELEMETRY_DISABLED=1`
4. Domains 中绑定自定义域名
5. 回写 `docs/site-config.md`

### 方案 C：Netlify

1. 注册 Netlify 账号 → Add new site → Import an existing project
2. 构建配置：
   - **Build command**：`npm run build`
   - **Publish directory**：`dist`
3. 环境变量添加 `ASTRO_TELEMETRY_DISABLED=1`
4. Domain settings 中绑定自定义域名
5. 回写 `docs/site-config.md`

## 五、部署后清单

部署完成后，请按以下清单检查并回写 `docs/site-config.md`：

- [ ] 访问首页 `https://your-domain.com/` 正常加载
- [ ] 访问 `/json` 工具页，测试格式化、压缩、校验、转义功能
- [ ] JSON 工具：点击「示例」→「格式化」→ 切换到「树形」Tab，验证树形视图渲染（折叠展开、类型着色、长字符串截断、键路径与值复制按钮 hover 显示）
- [ ] JSON 工具：树形模式下点击「展开」「折叠」按钮，验证全部展开 / 全部折叠生效
- [ ] JSON 工具：树形模式下搜索框输入「name」，验证显示「找到 N 个匹配」、键名与字符串值中匹配片段被高亮（橙色背景）、所有容器节点自动展开
- [ ] JSON 工具：搜索框输入不存在的内容（如「xyz」），验证显示「无匹配」、无高亮、容器节点仍展开
- [ ] JSON 工具：清空搜索框，验证匹配数提示隐藏、高亮消失、容器节点恢复默认折叠规则
- [ ] JSON 工具：切换到「转义」操作，树形 Tab 应禁用，切回「文本」Tab 显示转义结果
- [ ] 访问 `/base64` 工具页，测试编码、解码、URL 安全变体、实时转换
- [ ] 访问 `/base32` 工具页，测试 RFC 4648 编码、解码、Crockford 变体、校验和生成与校验、实时转换
- [ ] Base32 工具：访问 `/base32`，页面 H1 含「Base32 编解码工具」，SEO meta description 含「RFC 4648」与「Crockford」，JSON-LD `@type` 为 WebApplication
- [ ] Base32 工具：切换到「编码」模式，输入「Hello」，验证输出为「JBSWY3DP」（RFC 4648 标准）
- [ ] Base32 工具：切换到「Crockford」变体，验证输出不含 = 填充且字符集为 0-9A-Z（去除 I/L/O/U）
- [ ] Base32 工具：Crockford 模式下勾选「附加校验和」，验证输出末尾追加 1 个校验字符
- [ ] Base32 工具：切换到「解码」模式，粘贴合法 Base32 字符串，验证正确解码
- [ ] Base32 工具：Crockford 模式下勾选「校验校验和」，粘贴含正确校验和的字符串，验证提示「校验和通过」
- [ ] Base32 工具：Crockford 模式下勾选「校验校验和」，故意篡改校验字符，验证显示「校验和不匹配」错误
- [ ] Base32 工具：输入非法字符（如 !），验证显示「非法字符」错误提示
- [ ] Base32 工具：点击「清空」，输入与输出均清空，状态栏恢复默认提示
- [ ] 访问 `/hex` 工具页，测试 Hex 编码、解码、5 种格式切换、大小写切换、实时转换
- [ ] Hex 工具：访问 `/hex`，页面 H1 含「Hex 十六进制编解码工具」，SEO meta description 含「Hex dump」与「C 数组」，JSON-LD `@type` 为 WebApplication
- [ ] Hex 工具：切换到「编码」模式，输入「Hello」，验证输出为「48656c6c6f」（连续格式）
- [ ] Hex 工具：切换到「空格分隔」格式，验证输出为「48 65 6c 6c 6f」
- [ ] Hex 工具：切换到「0x 前缀」格式，验证输出含 0x 前缀
- [ ] Hex 工具：切换到「C 数组」格式，验证输出含花括号与逗号
- [ ] Hex 工具：切换到「Hex dump」格式，验证输出含偏移量与 ASCII 部分
- [ ] Hex 工具：勾选「大写」，验证输出为大写 hex 字符
- [ ] Hex 工具：切换到「解码」模式，粘贴合法 Hex 字符串，验证正确解码
- [ ] Hex 工具：输入非法字符（如 g/h/i），验证显示「非法字符」错误提示
- [ ] Hex 工具：点击「清空」，输入与输出均清空，状态栏恢复默认提示
- [ ] 访问 `/punycode` 工具页，测试 IDN 编码、ACE 解码、标签级详情展示、示例切换
- [ ] Punycode 工具：访问 `/punycode`，页面 H1 含「Punycode 编解码工具」，SEO meta description 含「IDN」与「xn--」，JSON-LD `@type` 为 WebApplication
- [ ] Punycode 工具：切换到「编码」模式，点击「示例」，验证输入框载入「例子.工具盒子.com」
- [ ] Punycode 工具：验证输出为「xn--fsqu00a.xn--h6qx3vv4bk65b.com」
- [ ] Punycode 工具：验证标签级详情面板显示 3 个标签（例子→xn--fsqu00a 已编码、工具盒子→xn--h6qx3vv4bk65b 已编码、com→com ASCII 保留）
- [ ] Punycode 工具：切换到「解码」模式，点击「示例」，验证输入框载入「xn--fsqu00a.xn--h6qx3vv4bk65b.com」
- [ ] Punycode 工具：验证输出为「例子.工具盒子.com」
- [ ] Punycode 工具：验证标签级详情面板显示 3 个标签（xn--fsqu00a→例子 已解码、xn--h6qx3vv4bk65b→工具盒子 已解码、com→com ASCII 保留）
- [ ] Punycode 工具：输入连续点号「例子..com」，验证显示「域名包含空标签（连续点号）」错误提示
- [ ] Punycode 工具：点击「清空」，输入与输出均清空，状态栏恢复默认提示
- [ ] ASCII Art 工具：访问 `/ascii-art`，页面 H1 含「ASCII Art 文本横幅生成器」，SEO meta description 含「Block」与「Banner」与「FIGlet」，JSON-LD `@type` 为 WebApplication
- [ ] ASCII Art 工具：点击「示例」，输入框载入「Toolbox」，输出区显示多行 ASCII Art 横幅
- [ ] ASCII Art 工具：默认字体为 Block（5 行高），切换到 Banner（7 行高）后输出行数变为 7，切换到 Small（3 行高）后输出行数变为 3
- [ ] ASCII Art 工具：字符间距切换 0/1/2，输出字符间空格列数随之变化
- [ ] ASCII Art 工具：输入小写字母「abc」，输出自动转为大写「ABC」字形渲染
- [ ] ASCII Art 工具：输入未覆盖字符（如中文「工具」），对应位置渲染为「?」占位符
- [ ] ASCII Art 工具：点击「复制」，剪贴板含 ASCII Art 纯文本，按钮文字短暂变为「已复制」
- [ ] ASCII Art 工具：点击「下载」，浏览器触发 .txt 文件下载，文件名含字体名
- [ ] ASCII Art 工具：统计信息显示行数、字符数、最大行宽
- [ ] ASCII Art 工具：点击「清空」，输入与输出均清空，输出区显示空状态提示
- [ ] 访问 `/html-formatter` 工具页，测试美化、压缩、校验三种模式切换
- [ ] HTML 格式化工具：访问 `/html-formatter`，页面 H1 含「HTML 格式化与压缩工具」，SEO meta description 含「美化」与「压缩」与「DOMParser」，JSON-LD `@type` 为 WebApplication
- [ ] HTML 格式化工具：切换到「美化」模式，点击「示例」，输入框载入 DOCTYPE + html + head + body + h1 + p + ul + li 结构的 HTML 代码
- [ ] HTML 格式化工具：美化模式下，输出按层级缩进对齐，每层增加 2 空格缩进
- [ ] HTML 格式化工具：缩进宽度切换 2/4/Tab，输出缩进字符相应变化
- [ ] HTML 格式化工具：勾选「保留注释」，输出含 `<!-- comment -->`；取消勾选则移除
- [ ] HTML 格式化工具：切换到「压缩」模式，输出为单行 HTML，移除注释与多余空白
- [ ] HTML 格式化工具：压缩模式下显示「压缩率 X%」徽章
- [ ] HTML 格式化工具：切换到「校验」模式，输出「解析成功」+ 元素数/文本节点数/注释数/属性数/最大深度统计
- [ ] HTML 格式化工具：点击「复制」，剪贴板含格式化结果，按钮文字短暂变为「已复制」
- [ ] HTML 格式化工具：点击「清空」，输入与输出均清空
- [ ] 访问 `/css-formatter` 工具页，测试美化、压缩、校验三种模式切换
- [ ] CSS 格式化工具：访问 `/css-formatter`，页面 H1 含「CSS 格式化与压缩工具」，SEO meta description 含「美化」与「压缩」与「词法分析」，JSON-LD `@type` 为 WebApplication
- [ ] CSS 格式化工具：切换到「美化」模式，点击「示例」，输入框载入含注释、规则、@media 嵌套、!important 的 CSS 代码
- [ ] CSS 格式化工具：美化模式下，输出按嵌套层级缩进对齐，每层增加 2 空格缩进，@media 内规则更深一层
- [ ] CSS 格式化工具：缩进宽度切换 2/4/Tab，输出缩进字符相应变化
- [ ] CSS 格式化工具：勾选「保留注释」，输出含 `/* 基础样式 */`；取消勾选则移除
- [ ] CSS 格式化工具：勾选「选择器换行」，多选择器逗号后换行每行一个
- [ ] CSS 格式化工具：切换到「压缩」模式，输出为单行 CSS，移除注释与多余空白
- [ ] CSS 格式化工具：压缩模式下显示「压缩率 X%」徽章
- [ ] CSS 格式化工具：切换到「校验」模式，输出「解析成功」+ 规则数/声明数/注释数/最大嵌套深度统计
- [ ] CSS 格式化工具：点击「复制」，剪贴板含格式化结果，按钮文字短暂变为「已复制」
- [ ] CSS 格式化工具：点击「清空」，输入与输出均清空
- [ ] 访问 `/js-formatter` 工具页，测试美化、压缩、校验三种模式切换
- [ ] JS 格式化工具：访问 `/js-formatter`，页面 H1 含「JavaScript 格式化与压缩工具」，SEO meta description 含「美化」与「压缩」与「词法分析」，JSON-LD `@type` 为 WebApplication
- [ ] JS 格式化工具：切换到「美化」模式，点击「示例」，输入框载入含注释、函数、箭头函数、类、模板字符串、正则字面量、数组方法的 JS 代码
- [ ] JS 格式化工具：美化模式下，输出按花括号嵌套层级缩进对齐，每层增加 2 空格缩进，`{` 后换行、`}` 前换行、`;` 后换行（for 头部 `;` 不换行）
- [ ] JS 格式化工具：缩进宽度切换 2/4/Tab，输出缩进字符相应变化
- [ ] JS 格式化工具：勾选「保留注释」，输出含 `// 单行` 与 `/* 多行 */`；取消勾选则移除
- [ ] JS 格式化工具：切换到「压缩」模式，输出为单行 JS，移除注释与多余空白，保留必要的分号与标识符间空格
- [ ] JS 格式化工具：压缩模式下显示「压缩率 X%」徽章
- [ ] JS 格式化工具：切换到「校验」模式，输出「解析成功」+ 字符数/行数/函数数（含箭头函数）/语句数/字符串数/注释数/最大嵌套深度统计
- [ ] JS 格式化工具：输入未闭合花括号（如 `function(){`），校验模式显示「花括号 { 未闭合」错误
- [ ] JS 格式化工具：点击「复制」，剪贴板含格式化结果，按钮文字短暂变为「已复制」
- [ ] JS 格式化工具：点击「清空」，输入与输出均清空
- [ ] 访问 `/json-to-ts` 工具页，测试 JSON 转 TypeScript 接口生成
- [ ] JSON 转 TS 工具：访问 `/json-to-ts`，页面 H1 含「JSON 转 TypeScript 接口生成器」，SEO meta description 含「interface」与「联合类型」与「可选字段」，JSON-LD `@type` 为 WebApplication
- [ ] JSON 转 TS 工具：点击「示例」，输入框载入含对象、数组、嵌套、null、可选字段的 JSON 数据
- [ ] JSON 转 TS 工具：输出区显示多个 `export interface` 声明（Root、RootAuthor、RootItem 等），根对象有 interface 声明，数组元素提取为独立 interface
- [ ] JSON 转 TS 工具：示例数据中 `items` 数组含两个对象字段不一致（第一个有 price，第二个有 url），生成 RootItem interface 含 `price?: number` 与 `url?: string` 可选字段
- [ ] JSON 转 TS 工具：`description: null` 字段生成 `description: null` 类型
- [ ] JSON 转 TS 工具：修改「根名」输入框为 `MyData`，输出 Root interface 重命名为 MyData，子接口前缀相应变化
- [ ] JSON 转 TS 工具：取消「export 关键字」复选框，输出 interface 声明前无 `export`
- [ ] JSON 转 TS 工具：取消「可选字段」复选框，所有字段变为必选（无 `?:`）
- [ ] JSON 转 TS 工具：切换「数组风格」为 `Array<T>`，输出数组类型变为 `Array<...>` 形式
- [ ] JSON 转 TS 工具：输入非法 JSON（如 `{a:}`），状态条显示「JSON 解析失败」错误
- [ ] JSON 转 TS 工具：点击「复制」，剪贴板含 TS 代码，按钮文字短暂变为「已复制」
- [ ] JSON 转 TS 工具：点击「下载 .ts」，浏览器下载 `<根名>.ts` 文件，内容为生成的 TS 代码
- [ ] JSON 转 TS 工具：点击「清空」，输入与输出均清空
- [ ] 访问 `/url` 工具页，测试编码、解码、粒度切换、实时转换
- [ ] URL 工具：切换到「URL 解析」Tab，点击「示例」，验证组成部分列表显示（protocol/host/pathname/search/hash 等 11 项）、查询参数表格显示（键值对 + 计数提示）、每项可单独复制
- [ ] 访问 `/uuid` 工具页，测试批量生成、连字符/大写开关、复制全部、单条复制
- [ ] 访问 `/hash` 工具页，测试 SHA-1/256/512 切换、HEX/Base64 输出、实时计算
- [ ] Hash 工具：切换到「文件哈希」Tab，拖拽或点击选择文件（< 100MB），勾选多算法（如 SHA-1 + SHA-256），点击「计算哈希」，验证进度条显示、多算法结果列表、单项复制功能
- [ ] Hash 工具：上传 > 100MB 文件，应显示「文件过大」错误提示
- [ ] 访问 `/timestamp` 工具页，测试时间戳↔日期双向转换、秒/毫秒切换、当前时间戳
- [ ] 时间戳工具：切换到「批量转换」Tab，点击「示例」，验证统计栏（共/有效/无效）、结果表格（序号/原始/单位/本地时间/ISO）、自动识别秒(10位)/毫秒(13位)、无效行标红显示错误原因、「复制全部」导出 CSV
- [ ] 访问 `/timezone` 工具页，测试多时区对比、源时区选择、目标时区添加/删除、夏令时识别、ISO 8601/Unix 时间戳复制
- [ ] 时区转换器：访问 `/timezone`，页面 H1 含「时区转换器」，SEO meta description 含「IANA」「夏令时」「UTC」「ISO 8601」「Unix 时间戳」，JSON-LD `@type` 为 WebApplication
- [ ] 时区转换器：点击「载入示例」，验证源时区选择框已选值、datetime-local 输入框已填充、目标时区列表至少含 1 个时区卡片
- [ ] 时区转换器：在目标时区添加框输入「东京」或选择「Asia/Tokyo」，验证目标时区列表新增 1 个时区卡片；点击某目标时区卡片的删除按钮，验证该卡片消失
- [ ] 时区转换器：验证目标时区卡片含时区名称、UTC 偏移（如 +09:00）、本地时间、ISO 8601 字段、Unix 时间戳字段、夏令时标签（DST 生效时显示）
- [ ] 时区转换器：点击页面 FAQ 区任一 `<details>`，验证展开后含详细解答（如「什么是夏令时 DST」「IANA 时区数据库是什么」）
- [ ] 时间单位换算器：访问 `/time-unit`，页面 H1 含「时间单位换算器」，SEO meta description 含「毫秒」「秒」「分钟」「小时」「天」「周」「月」「年」「Gregorian」「人类可读」，JSON-LD `@type` 为 WebApplication
- [ ] 时间单位换算器：单位换算模块输入数值 1、源单位选「小时」，验证 8 张卡片同时展示换算结果（毫秒=3600000、秒=3600、分钟=60、小时=1、天=0.041666…、周=0.005952…、月=0.001370…、年=0.000114…），月年卡片含「近似」徽章，源单位卡片含「源」徽章且高亮
- [ ] 时间单位换算器：点击某张卡片的「复制」按钮，验证状态条显示「已复制…到剪贴板」
- [ ] 时间单位换算器：时长解析模块输入「1h 30min」，验证累计毫秒=5400000、人类可读=「1 小时 30 分钟」、逐项明细含 2 项（1 小时→3600000 ms、30 分钟→1800000 ms）
- [ ] 时间单位换算器：时长解析模块输入「2天3小时」（无空格中文），验证累计毫秒=18360000、人类可读=「2 天 3 小时」
- [ ] 时间单位换算器：时长解析模块输入「1.5h」，验证累计毫秒=5400000（小数支持）
- [ ] 时间单位换算器：时长解析模块输入「xyz abc」（无识别片段），验证错误提示「无法识别该时长字符串」
- [ ] 时间单位换算器：时长解析模块输入「1h xyz」，验证累计毫秒=3600000、警告提示「部分片段未识别："xyz"（已忽略）」
- [ ] 时间单位换算器：点击「示例」按钮，验证时长解析输入框填入「2天3小时30分」
- [ ] 时间单位换算器：毫秒转人类可读模块输入 90610000、最大片段数选「3（默认）」，验证输出「1 天 1 小时 10 分钟」
- [ ] 时间单位换算器：毫秒转人类可读模块改为「2（紧凑）」，验证输出「1 天 1 小时」（仅 2 片段）
- [ ] 时间单位换算器：毫秒转人类可读模块输入 0，验证输出「0 秒」
- [ ] 时间单位换算器：验证联动链接含「→ Unix 时间戳转换」「→ 时区转换器」「→ CRON 表达式解析器」三条
- [ ] 时间单位换算器：点击页面 FAQ 区任一 `<details>`，验证展开后含详细解答（如「月和年的换算为什么标注近似」「1 年等于多少秒」）
- [ ] 访问 `/blog/timezone-conversion-guide` 博客页，验证页面 H1 含「时区转换」或「国际化时间」，含 IANA/夏令时/ISO 8601/Intl.DateTimeFormat 章节、JavaScript/Python/Java 三语言代码示例、工具联动链接
- [ ] 访问 `/blog/time-representation-overview` 博客页，验证 H1 含「时间表示全家桶」，含 Unix 时间戳/时区/时间单位/CRON 四大章节、Gregorian 365.2425、夏令时与 DST，含 /timestamp /timezone /time-unit /cron 四个工具链接，含 JavaScript/Python/Java 三语言代码示例
- [ ] 访问 `/regex` 工具页，测试正则输入、标志位切换、实时高亮、匹配列表
- [ ] 正则工具：点击「示例」，验证模式 `(\w+)@(\w+)\.(\w+)` 载入、3 个邮箱高亮、匹配列表显示 3 个捕获组（$1/$2/$3）、第一个 $1 = dev
- [ ] 正则工具：切换到「替换」Tab，验证替换字符串 `[$1 at $2.$3]` 载入、替换结果含 `[dev at example.com]`、显示「3 处替换」
- [ ] 正则工具：输入非法正则如 `(unclosed`，验证状态栏显示「正则编译失败」错误提示
- [ ] 正则工具：点击「邮箱」常用模式速查按钮，验证模式自动载入、3 个邮箱被高亮
- [ ] 正则工具：点击「邮箱(命名组)」常用模式速查按钮，验证模式含 `(?<user>)` `(?<domain>)` `(?<tld>)` 命名组语法、3 个邮箱匹配、每个匹配项含 3 个命名组键（user/domain/tld，紫色键样式）、第一个 user = dev
- [ ] 正则工具：命名组模式下切换到「替换」Tab，输入替换串 `[$<user> at $<domain>.$<tld>]`，验证替换结果含 `[dev at example.com]`（$<name> 命名组引用展开）
- [ ] 正则工具：切回测试 Tab，验证每个匹配项右侧含「复制」单条复制按钮，点击第一条复制按钮后状态栏提示「已复制 #1 条匹配」
- [ ] 正则工具：验证「替换」Tab 提示文案含 `$<name>` 命名组说明
- [ ] 访问 `/jwt` 工具页，测试 JWT 解码、三段展示、过期状态、错误处理
- [ ] JWT 工具：点击「示例」，验证 Header 段显示 HS256/JWT、Payload 段显示 7 个标准声明（iss/sub/aud/iat/exp/nbf/jti）且时间字段格式化、Signature 段显示 base64url 原始字符串
- [ ] JWT 工具：验证算法信息卡片显示「HS256 · HMAC + SHA-256」、过期状态显示「有效期至」+ 未来时间
- [ ] JWT 工具：验证 Payload 字段列表中 exp/iat/nbf 时间字段显示相对时间徽章（绿色「剩余 X 天」/红色「已过期 X 天」/「X 天前」）
- [ ] JWT 工具：点击「不安全示例」按钮，验证 alg=none token 触发红色安全警告横幅「⚠ 安全警告：当前 JWT 使用 alg=none」+ 算法卡片变红 + 警告链接指向 /blog/jwt-security-best-practices
- [ ] JWT 工具：验证 Signature 段下方显示「当前签名长度 N 字符 · HS256 算法预期 约 43 字符」长度参考提示
- [ ] JWT 工具：输入非法 JWT（如 5 段 `a.b.c.d.e`），验证显示「解析失败：JWT 应包含 3 段」错误提示
- [ ] JWT 工具：输入 2 段 `a.b`，验证显示「当前 2 段」错误提示
- [ ] JWT 工具：输入 `Bearer eyJhbGc...` 前缀，验证自动去除 Bearer 前缀后正常解析
- [ ] 访问 `/jwt-sign` 工具页，测试 JWT 签名生成、算法切换、密钥输入、结果展示
- [ ] JWT 签名工具：页面 H1 含「JWT 签名生成器」，SEO meta description 含「HS256」「RS256」「ES256」「none」，JSON-LD `@type` 为 WebApplication
- [ ] JWT 验签工具：访问 `/jwt-verify`，页面 H1 含「JWT 签名验证工具」，SEO meta description 含「HS256」「RS256」「ES256」「验签」「exp」「nbf」「iat」，JSON-LD `@type` 为 WebApplication
- [ ] JWT 签名工具：点击「载入示例」，算法自动切换为 HS256、Header 载入 `{"typ":"JWT"}`、Payload 载入含 iss/sub/aud/iat/exp/jti 的 JSON、HMAC 密钥载入演示密钥
- [ ] JWT 签名工具：点击「签发 JWT」，结果区显示完整 JWT（三段 `header.payload.signature` 格式）、Header/Payload/Signature 三段拆分展示含 base64url 与美化 JSON、签名长度提示
- [ ] JWT 签名工具：切换算法为 RS256，验证密钥输入区切换为 RSA 私钥输入（PEM/JWK），点击「生成新密钥对」按钮生成 2048 位 RSA 密钥对并自动填入私钥
- [ ] JWT 签名工具：生成密钥对后，验证密钥对面板显示 PEM/JWK 切换 Tab、公钥与私钥可折叠查看
- [ ] JWT 签名工具：切换算法为 none，验证密钥输入区显示「无签名」提示，点击签发生成的 JWT 第三段为空、显示红色安全警告横幅「⚠ 安全警告：此 JWT 使用 alg=none」+ 警告链接指向 /blog/jwt-security-best-practices
- [ ] JWT 签名工具：Header JSON 输入非法（如 `{"typ":}`），验证显示「JSON 解析失败」错误提示且签发按钮禁用
- [ ] JWT 签名工具：HMAC 密钥长度低于 256 位时，验证密钥提示显示橙色「密钥长度 X 位低于推荐值 256 位」警告
- [ ] JWT 签名工具：点击结果区「复制」按钮，剪贴板含完整 JWT 或对应段内容，按钮文字短暂变为「已复制」
- [ ] JWT 签名工具：切换密钥格式为「base64url 编码字节」，验证密钥长度按字节计算（如 32 字节 base64url 输入显示 256 位）
- [ ] JWT 签名工具：切换算法为 ES256，验证密钥输入区切换为 EC 私钥输入（PEM/JWK），含曲线选择器默认 P-256
- [ ] JWT 签名工具：ES256 下点击「生成新密钥对」按钮，验证生成 P-256 椭圆曲线密钥对并自动填入私钥，密钥对面板显示 PEM 与 JWK 双格式
- [ ] JWT 签名工具：ES256 下点击「签发 JWT」，验证结果 JWT 第三段（Signature）长度约 86 字符（64 字节 base64url 编码），Header 含 `alg:"ES256"`
- [ ] JWT 签名工具：切换算法为 ES384，验证曲线选择器自动同步为 P-384；切换为 ES512，验证曲线选择器自动同步为 P-521
- [ ] JWT 签名工具：ES512 下签发 JWT，验证 Signature 段长度约 176 字符（132 字节 base64url 编码）
- [ ] JWT 签名工具：EC 私钥输入非法 PEM（如缺少 `-----BEGIN PRIVATE KEY-----` 标记），验证显示密钥格式错误提示
- [ ] JWT 签名工具：验证 FAQ 区含「ECDSA 与椭圆曲线密码学」「P-256 / P-384 / P-521 椭圆曲线怎么选」「ES256 与 RS256 如何选择」等条目，且 ECDSA FAQ 含指向 /blog/ecdsa-elliptic-curve-jwt-signing-guide 的延伸阅读链接
- [ ] 访问 `/blog/ecdsa-elliptic-curve-jwt-signing-guide` 博客页，验证页面 H1 含「椭圆曲线密码学与 ECDSA 签名」，含 NIST 三条曲线对比表、ES vs RS 性能对比表、Web Crypto API 代码示例
- [ ] JWT 验签工具：访问 `/jwt-verify`，点击「载入 HS256 示例」，验证 JWT 输入框与 HMAC 密钥框自动填入
- [ ] JWT 验签工具：点击「验证签名」，验证结果显示「验证通过」状态徽章（绿色）、签名验证详情「签名有效」、时间声明校验列表含 exp/iat 项且状态为「有效」、三段拆分展示 Header/Payload/Signature
- [ ] JWT 验签工具：验证 FAQ 区含「验签与解码」「alg=none 攻击」「exp/nbf/iat 时间声明」「常量时间比较」「JWKS」等条目
- [ ] JWT 验签工具：清空后输入 alg=none 的 JWT（如 `eyJhbGciOiJub25lIn0.eyJ0ZXN0IjoxfQ.`），验证显示 none 算法安全警告
- [ ] 访问 `/blog/jwt-signature-verification-guide` 博客页，验证页面 H1 含「JWT 验签实战」，含验签流程图、三类算法密钥模型、Web Crypto API 验签代码、Node.js/Python/Java 服务端代码、验签安全清单
- [ ] AES 工具：访问 `/aes`，页面 H1 含「AES 加解密」，SEO meta description 含「AES-GCM」「AES-CBC」「AES-CTR」「PBKDF2」「认证加密」，JSON-LD `@type` 为 WebApplication
- [ ] AES 工具：点击「载入示例」，验证明文输入框与密钥输入框自动填入，模式默认 GCM、密钥长度 256、输出格式 Hex
- [ ] AES 工具：点击「加密」按钮，验证密文输出区显示 Hex 密文、IV/Nonce 区显示 24 字符 Hex（12 字节 GCM）、结果区显示密文字节数与派生密钥
- [ ] AES 工具：点击「用加密结果填入解密」按钮，验证方向切换为「解密」、密文/IV/盐输入框自动填入加密结果
- [ ] AES 工具：点击「解密」按钮，验证解密结果与原始明文一致
- [ ] AES 工具：切换模式为 CBC，验证 IV 长度变为 32 字符 Hex（16 字节）；切换为 CTR，验证 IV 长度同为 32 字符 Hex
- [ ] AES 工具：切换密钥来源为「PBKDF2 密码派生」，验证显示盐输入框与迭代次数输入框；加密后验证盐已生成并显示在结果区
- [ ] AES 工具：验证 FAQ 区含「GCM/CBC/CTR 三种模式区别」「PBKDF2 密钥派生」「IV/Nonce 管理」「认证加密」「padding oracle 攻击」等条目
- [ ] 访问 `/blog/aes-encryption-guide` 博客页，验证页面 H1 含「AES 加密实战」，含 AES 原理、GCM/CBC/CTR 模式对比、padding oracle 攻击、PBKDF2 派生、Web Crypto API 代码、Node.js/Python/Java 服务端代码
- [ ] 调色板生成器：访问 `/color-palette`，页面 H1 含「调色板生成器」，SEO meta description 含「调色板」「和谐配色」「Tailwind」「Material」「WCAG」「色盲」「导出」，JSON-LD `@type` 为 WebApplication
- [ ] 调色板生成器：页面载入后默认载入示例颜色，验证 5 个 Tab 可见（和谐配色 / 设计系统色阶 / 明度色调 / 可访问性 / 随机配色）
- [ ] 调色板生成器：在「和谐配色」Tab 切换 6 种方案（互补 / 类似 / 三角 / 分割互补 / 四角 / 单色阶），验证每种方案色块数量正确（互补 2 色、类似 3 色、三角 3 色、分割互补 3 色、四角 4 色、单色阶多档）
- [ ] 调色板生成器：切换到「设计系统色阶」Tab，选择 Tailwind 标准，验证生成 50-950 共 11 档色阶；切换到 Material 标准，验证生成 100-900 共 10 档色阶
- [ ] 调色板生成器：切换到「可访问性」Tab，输入前景色与背景色，验证 WCAG 2.1 对比度比值与 AA / AAA 评级显示
- [ ] 调色板生成器：切换到「可访问性」Tab，选择色盲类型（红色盲 / 绿色盲 / 蓝色盲），验证模拟后的颜色色块展示
- [ ] 调色板生成器：切换到「随机配色」Tab，点击「生成随机配色」按钮，验证生成一组新配色（黄金角度分布）
- [ ] 调色板生成器：点击任一色块，验证色块设为当前色并显示 HEX；点击复制按钮验证剪贴板含 HEX
- [ ] 调色板生成器：在导出区切换导出格式（CSS 变量 / Tailwind 配置 / SCSS / JSON / Android XML / iOS Swift），验证每种格式输出内容符合语法
- [ ] 调色板生成器：验证 FAQ 区含「和谐配色方案」「Tailwind / Material 色阶」「WCAG 对比度」「色盲模拟」「导出格式」等条目
- [ ] 访问 `/blog/color-palette-design-guide` 博客页，验证页面 H1 含「调色板」或「色阶」，含 HSL 色环、6 种和谐方案、Tailwind / Material 色阶算法、WCAG 对比度、色盲模拟矩阵变换、多格式导出实践、黄金角度随机配色
- [ ] 访问 `/color` 工具页，测试颜色格式转换、调色板生成、错误处理
- [ ] 颜色工具：点击「示例」，验证拾色器值 `#2b6cff`、大色块预览显示 `#2B6CFF`、五种格式输出（HEX/RGB/HSL/HSV/CMYK）正确，HSL `hsl(222, 100%, 58%)`、HSV `hsv(222, 83%, 100%)`、CMYK `cmyk(83%, 58%, 0%, 0%)`
- [ ] 颜色工具：输入 `rgb(255, 0, 0)`，验证 HEX 输出 `#ff0000`；输入 `hsl(120, 100%, 50%)`，验证 HEX 输出 `#00ff00`
- [ ] 颜色工具：验证调色板区显示 5 种和谐方案（互补色 / 类似色 / 三角色 / 分割互补 / 四角色），互补色 2 色块、类似色 3 色块、四角色 4 色块
- [ ] 颜色工具：点击互补色方案第二个色块（应为金色 `#ffbf29`），验证拾色器值同步切换
- [ ] 颜色工具：输入非法字符串如 `invalidcolor`，验证显示「解析失败」错误提示
- [ ] 颜色工具：输入 HEX 简写 `#f00`，验证自动识别并转为 `#ff0000`
- [ ] 访问 `/html-entities` 工具页，测试 HTML 实体编解码、三种编码模式、速查表、错误处理
- [ ] HTML 实体工具：点击「示例」，验证编码模式输出含 `&lt;` `&gt;` `&quot;` 转义字符（necessary 模式）
- [ ] HTML 实体工具：切换编码模式为「命名实体优先」，验证输出含 `&copy;` `&trade;` 命名实体
- [ ] HTML 实体工具：切换编码模式为「全部数字实体」，验证中文「工」转为 `&#24037;` 数字实体
- [ ] HTML 实体工具：切回「仅必要字符」模式，验证中文「工具盒子」保持原样不转义
- [ ] HTML 实体工具：切换到「解码」模式，输入 `&lt;a href=&quot;...&quot;&gt;版权 &copy; 2026&lt;/a&gt;`，验证正确还原为 `<a href="...">版权 © 2026</a>`
- [ ] HTML 实体工具：解码模式下输入 `十进制 &#38; 与十六进制 &#x26; 都是 &`，验证十进制 `&#38;` 与十六进制 `&#x26;` 都被正确解码为 `&`
- [ ] HTML 实体工具：速查表显示 31 个实体卡片，过滤框输入 `copy` 后仅显示 1 个（&copy;）卡片
- [ ] HTML 实体工具：解码模式下输入不含 `&` 的普通文本（如 `普通文本`），验证显示「输入中未发现 & 字符」错误提示
- [ ] HTML 实体工具：滚动到页面底部「XSS 防御演示」模块，验证 4 个预设载荷按钮显示（script 注入 / onerror 事件 / javascript: 协议 / SVG onload）
- [ ] HTML 实体工具 XSS 演示：点击「script 注入」按钮，验证左侧「危险输入」面板显示 `<script>alert(document.cookie)</script>`，右侧「编码后」面板显示 `&lt;script&gt;alert(document.cookie)&lt;/script&gt;`
- [ ] HTML 实体工具 XSS 演示：点击「onerror 事件」按钮，验证左侧显示 `<img src=x onerror=alert(1)>`，右侧显示 `&lt;img src=x onerror=alert(1)&gt;`
- [ ] HTML 实体工具 XSS 演示：点击「javascript: 协议」按钮，验证左侧显示 `<a href="javascript:alert(1)">点击</a>`，右侧显示编码后的 `&lt;a href=&quot;javascript:alert(1)&quot;&gt;点击&lt;/a&gt;`
- [ ] HTML 实体工具 XSS 演示：验证「上下文安全提示」区显示 5 个上下文卡片（HTML 文本节点✅ / HTML 属性值✅ / `<script>` 块内❌ / 事件处理器内❌ / href 属性⚠），每个含示例代码与说明
- [ ] HTML 实体工具 XSS 演示：验证页面控制台无任何报错（确认未实际执行脚本，仅文本展示）
- [ ] HTML 实体工具 XSS 演示：验证底部安全提示含指向 `/blog/web-security-csp-xss-csrf` 的链接
- [ ] 访问 `/color-contrast` 工具页，测试颜色对比度计算、WCAG 评级、交换功能、错误处理
- [ ] 颜色对比度工具：点击「示例」，验证前景色拾色器值 `#1f2937`、背景色拾色器值 `#ffffff`、对比度比值显示约 14.7:1、5 项评级全部「✓ 通过」（AA 普通 / AA 大字 / AAA 普通 / AAA 大字 / UI 组件）
- [ ] 颜色对比度工具：输入前景色 `#2b6cff` 与背景色 `#ffffff`，验证对比度约 4.0:1、「AA 普通文字」未达（✗）、「AA 大文字」通过（✓）、显示「对比度偏低，建议」橙色提示
- [ ] 颜色对比度工具：点击「交换」按钮（⇄），验证前景色与背景色互换、对比度比值保持不变（对比度与方向无关）
- [ ] 颜色对比度工具：验证「实际渲染效果」区显示普通正文、大号加粗文字、超链接、示例按钮四类元素，颜色随所选配色实时变化
- [ ] 颜色对比度工具：点击「复制」按钮，验证复制对比度比值（如 `4.00:1`）到剪贴板
- [ ] 颜色对比度工具：输入非法 HEX（如 `xyz`），验证显示「HEX 格式应为 #RRGGBB 或 #RGB」错误提示
- [ ] 颜色对比度工具：点击「清空」，验证前景色与背景色均清空、显示空状态提示「请选择前景色与背景色」
- [ ] 访问 `/csv-json` 工具页，测试 CSV → JSON / JSON → CSV 双向转换、表格预览、分隔符切换、错误处理
- [ ] CSV/JSON 工具：CSV → JSON 模式下点击「示例」，验证表格预览区显示（含表头 + 数据行），JSON 输出框含数组结构，引号包裹的含逗号字段（如 `"上海,浦东"`）被正确解析为单一字段，含换行字段（如 `"第一行\n第二行"`）被正确解析
- [ ] CSV/JSON 工具：CSV → JSON 模式下验证空字段（连续分隔符 `,,`）被解析为空字符串，引号未闭合时显示「引号未闭合」错误提示
- [ ] CSV/JSON 工具：切换到 JSON → CSV 模式，点击「示例」，验证嵌套对象被展平为点号路径列（如 `user.name`、`user.age`、`tags[0]`），表头自动取并集，缺失字段填空字符串
- [ ] CSV/JSON 工具：切换分隔符为「分号 ;」，验证输出 CSV 使用分号分隔、表格预览同步更新；关闭「首行表头」开关，验证表头行不输出
- [ ] CSV/JSON 工具：输入非法 JSON（如 `{invalid`），验证显示「JSON 解析失败」错误提示；输入非数组 JSON（如 `{"a":1}`），验证显示「应为对象数组」类型错误提示
- [ ] CSV/JSON 工具：点击「下载」按钮，验证下载 `converted.csv` 文件，文件以 UTF-8 BOM 开头（`\uFEFF`），Excel 打开中文不乱码
- [ ] CSV/JSON 工具：CSV → JSON 模式下勾选「智能类型」开关，验证 JSON 输出中数字字段（如 `age`）转为 number（`"age": 28` 无引号）、布尔字段（如 `active`）转为 boolean（`"active": true`）、空字段转为 null；表格预览中每个单元格右上角显示类型徽章（N=数字 / B=布尔 / ∅=null / S=字符串），表头行右侧显示图例
- [ ] CSV/JSON 工具：智能类型启用状态下输入含前导零邮政编码（如 `021000`）与超大整数（如 `9007199254740993`）的 CSV，验证风险提示区显示（黄色背景 + 左边框），含「前导零」与「MAX_SAFE_INTEGER」字样；JSON 输出中前导零字段与超大整数字段保留为字符串（带引号），安全范围内的整数转为 number；关闭智能类型开关后所有字段回到字符串类型，风险提示区与类型徽章消失
- [ ] CSV/JSON 工具：点击「清空」，验证输入、输出、表格预览均清空，显示空状态
- [ ] 访问 `/json-to-xml` 工具页，测试 JSON 转 XML 转换、选项切换、well-formed 校验、错误处理
- [ ] JSON 转 XML 工具：访问 `/json-to-xml`，页面 H1 含「JSON 转 XML」，SEO meta description 含「SOAP」「SVG」「CDATA」「well-formed」，JSON-LD `@type` 为 WebApplication
- [ ] JSON 转 XML 工具：点击「示例」，验证 JSON 输入框填充示例数据（含对象/数组/嵌套/null），XML 输出框实时生成对应 XML 文档，含根节点、数组项展开、特殊字符转义
- [ ] JSON 转 XML 工具：展开「选项」面板，切换「使用属性」开关，验证嵌套对象的简单值从子元素变为属性（如 `<name>张三</name>` → `<user name="张三">`）；切换「CDATA 包裹」开关，验证含特殊字符的文本用 `<![CDATA[...]]>` 包裹
- [ ] JSON 转 XML 工具：输入非法 JSON（如 `{invalid`），验证显示「解析失败」或「JSON 语法错误」提示；输入含非法标签名（如 `"123abc": "值"`）的 JSON，验证警告区显示「标签名已修正」提示
- [ ] JSON 转 XML 工具：验证联动链接含「→ CSV 与 JSON 互转」「→ YAML 转换」「→ JSON 格式化」或「→ JSON 转 TypeScript」中的至少一条；点击「复制」按钮验证剪贴板含 XML 内容
- [ ] 访问 `/xml-to-json` 工具页，测试 XML 转 JSON 转换、选项切换、错误处理
- [ ] XML 转 JSON 工具：访问 `/xml-to-json`，页面 H1 含「XML 转 JSON」，SEO meta description 含「DOMParser」「CDATA」「XXE」，JSON-LD `@type` 为 WebApplication
- [ ] XML 转 JSON 工具：点击「示例」，验证 XML 输入框填充示例数据（含声明/属性/嵌套/CDATA/空元素），JSON 输出框实时生成对应 JSON，属性带 `@` 前缀，同名 `<tag>` 合并为数组，`<note/>` 转为 null
- [ ] XML 转 JSON 工具：展开「选项」面板，关闭「CDATA 合并到文本」开关，验证 CDATA 内容从 `#text` 移到 `#cdata` 字段；开启「类型推断」开关，验证 `active="true"` 转为布尔值、`<score>95</score>` 转为数字、`<nullValue>null</nullValue>` 转为 null
- [ ] XML 转 JSON 工具：输入非法 XML（如 `<unclosed>`），验证显示「解析失败」提示；输入含 XXE 实体的 XML（如 `<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>`），验证不发起网络请求、不读取本地文件、安全忽略实体
- [ ] XML 转 JSON 工具：验证联动链接含「→ JSON 转 XML」「→ CSV / JSON 互转」「→ YAML 格式化」「→ JSON 格式化」中的至少一条；点击「复制」按钮验证剪贴板含 JSON 内容
- [ ] 访问 `/yaml` 工具页，测试 YAML → JSON / JSON → YAML 双向转换、缩进切换、错误处理
- [ ] YAML 工具：YAML → JSON 模式下点击「示例」，验证 JSON 输出框含解析后的对象结构（name/version/active/tags 数组/author 嵌套对象/config 嵌套对象），多文档标记不显示（示例为单文档）
- [ ] YAML 工具：YAML → JSON 模式下输入含 `yes`/`no`/`on`/`off` 裸字符串（如 `enabled: yes`），验证类型推断陷阱提示区显示（黄色背景 + 左边框），含「布尔」与「YAML 1.2」字样；JSON 输出中对应字段保留为字符串 `"yes"`/`"no"`（本工具基于 YAML 1.2，不转为布尔）
- [ ] YAML 工具：YAML → JSON 模式下输入含日期格式（如 `created: 2024-01-15`），验证类型推断陷阱提示区显示，含「Date」字样；JSON 输出中日期被解析为 Date 对象后转为 ISO 8601 字符串（如 `"2024-01-15T00:00:00.000Z"`）
- [ ] YAML 工具：YAML → JSON 模式下输入多文档 YAML（用 `---` 分隔两个文档），验证输出区显示「多文档 · 2 个」标记，JSON 输出为数组含两个对象
- [ ] YAML 工具：YAML → JSON 模式下输入语法错误（如 `name:张三` 冒号后无空格），验证显示「解析错误」红色提示区，含错误行号与原因
- [ ] YAML 工具：切换到 JSON → YAML 模式，点击「示例」，验证 YAML 输出含缩进层级结构，字符串大多无引号（仅在必要时加引号）
- [ ] YAML 工具：JSON → YAML 模式下切换缩进为「4 空格」，验证输出 YAML 缩进改为 4 空格
- [ ] YAML 工具：点击「下载」按钮，验证下载对应格式文件（YAML→JSON 模式下载 .json，JSON→YAML 模式下载 .yaml）
- [ ] YAML 工具：点击「清空」，验证输入、输出、提示区均清空
- [ ] 访问 `/toml` 工具页，测试 TOML → JSON / JSON → TOML 双向转换、错误处理
- [ ] TOML 工具：TOML → JSON 模式下点击「示例」，验证 JSON 输出框含解析后的对象结构（title/version/tags 数组/owner 嵌套对象/server 嵌套对象/dependencies 数组表），日期时间类型提示区显示（黄色背景，含「本地日期」「偏移日期时间」字样）
- [ ] TOML 工具：TOML → JSON 模式下输入含日期时间（如 `created = 2024-01-15`），验证类型提示区显示「本地日期」与 JSON 后形态说明；JSON 输出中日期被解析为 Date 对象后转为 ISO 8601 字符串（如 `"2024-01-15T00:00:00.000Z"`）
- [ ] TOML 工具：TOML → JSON 模式下输入含超大整数（如 `big_id = 9223372036854775807`），验证类型提示区显示「超过 Number.MAX_SAFE_INTEGER」警告
- [ ] TOML 工具：TOML → JSON 模式下输入语法错误（如 `name = ` 无值），验证显示「解析错误」红色提示区，含错误行号与原因
- [ ] TOML 工具：切换到 JSON → TOML 模式，点击「示例」，验证 TOML 输出含表结构与数组表
- [ ] TOML 工具：JSON → TOML 模式下输入含 null 的 JSON（如 `{"a": null}`），验证类型提示区显示「TOML 不支持 null」警告
- [ ] TOML 工具：点击「下载」按钮，验证下载对应格式文件（TOML→JSON 模式下载 .json，JSON→TOML 模式下载 .toml）
- [ ] TOML 工具：点击「清空」，验证输入、输出、提示区均清空
- [ ] 访问 `/qr` 工具页，测试二维码生成、预设载入、参数调节、下载
- [ ] QR 工具：默认载入「网址」预设（`https://toolbox.example.com/json`），验证 Canvas 预览区显示二维码图像
- [ ] QR 工具：技术指标区显示版本号（如 v1）、模块数（如 21 × 21）、编码模式（如 Byte）、字符数
- [ ] QR 工具：切换容错等级为 H，验证模块数增加（密度变大）
- [ ] QR 工具：拖动「尺寸」滑块至 384px，验证 Canvas 实时变大
- [ ] QR 工具：拖动「留白」滑块至 2，验证四周留白变窄
- [ ] QR 工具：点击「WiFi 配置」预设，验证输入框载入 `WIFI:T:WPA;S:...` 字符串、Canvas 重新生成
- [ ] QR 工具：点击「邮件」预设，验证输入框载入 `mailto:...` 字符串
- [ ] QR 工具：前景色改为 `#cccccc`、背景色保持 `#ffffff`，验证显示对比度警告提示「对比度偏低」
- [ ] QR 工具：前景色输入框输入 `xyz`（非法 HEX），验证显示「颜色格式应为 #RRGGBB」警告
- [ ] QR 工具：点击「下载 PNG」按钮，验证下载 `qrcode.png` 文件，文件可正常打开
- [ ] QR 工具：点击「下载 SVG」按钮，验证下载 `qrcode.svg` 文件，文件以 `<svg` 开头
- [ ] QR 工具：点击「复制 Data URL」按钮，验证状态栏提示「已复制 Data URL」
- [ ] QR 工具：清空输入框，验证 Canvas 清空、技术指标区隐藏、显示「输入内容后将在此显示二维码」空状态
- [ ] 访问 `/password` 工具页，测试密码生成、字符集自定义、长度调节、强度评估、批量生成
- [ ] Password 工具：默认载入 16 位四类字符集密码（小写 + 大写 + 数字 + 符号），验证结果列表显示 1 条密码，长度 = 16
- [ ] Password 工具：强度区显示「很强」等级（熵约 102.8 bits ≥ 100）、强度条进度 100%、字符集大小 86（小写 26 + 大写 26 + 数字 10 + 符号 24）
- [ ] Password 工具：拖动长度滑块至 32，验证密码长度变长、强度保持「很强」（熵 ≥ 100 bits）、进度条 100%
- [ ] Password 工具：拖动长度滑块至 4，验证强度降为「极弱」（熵 < 28 bits）、进度条红色 15%
- [ ] Password 工具：取消勾选「符号」，验证字符集大小降为 62、熵相应降低、密码中无符号字符
- [ ] Password 工具：取消勾选所有字符集（小写 / 大写 / 数字 / 符号），验证显示红色错误提示「请至少选择一个字符集」、结果列表清空、重新生成按钮禁用
- [ ] Password 工具：勾选「排除易混字符 (0O1lI)」，验证字符集大小减少、密码中不出现 0/O/o/1/l/I/|/`/'/" 字符
- [ ] Password 工具：切换数量为 5，验证结果列表显示 5 条密码、每条长度与设置一致
- [ ] Password 工具：点击单条密码的「复制」按钮，验证状态栏提示「已复制」、按钮文字变「已复制」1.5s
- [ ] Password 工具：点击「复制全部」按钮，验证状态栏提示「已复制 N 条密码」
- [ ] Password 工具：点击「清空」按钮，验证结果列表清空、显示「点击"重新生成"开始创建密码」空状态
- [ ] Password 工具：关闭「实时生成」开关，调整长度 / 字符集后不自动重新生成，需手动点击「重新生成」
- [ ] 访问 `/diff` 工具页，测试文本对比、视图切换、比较选项、统计、复制
- [ ] Diff 工具：页面载入后客户端自动载入示例（左原文「应用配置 v1.0」、右修改后「应用配置 v2.0」），验证双栏 textarea 已填充内容
- [ ] Diff 工具：默认分屏对比视图，验证左右两栏并排显示，删除行在左侧红色高亮（含 `-` 前缀）、新增行在右侧绿色高亮（含 `+` 前缀）、相同行两侧均显示
- [ ] Diff 工具：统计栏显示「相同 N」、「+N」、「-N」、「修改 N」、「相似度 N%」五项指标
- [ ] Diff 工具：点击「统一 diff」视图按钮，验证切换为单栏显示，每行前缀为 `+` / `-` / 空格
- [ ] Diff 工具：点击「复制 diff」按钮，验证状态栏提示「已复制 N 行 diff 结果」、按钮文字变「已复制」1.5s
- [ ] Diff 工具：点击「交换左右」按钮，验证左右 textarea 内容互换、统计与差异结果相应更新
- [ ] Diff 工具：取消勾选「区分大小写」，验证仅大小写不同的行不再标记为差异
- [ ] Diff 工具：勾选「忽略行首尾空白」，验证仅缩进不同的行不再标记为差异
- [ ] Diff 工具：勾选「忽略空行」，验证空行不再参与比较
- [ ] Diff 工具：点击「清空」按钮，验证双栏 textarea 清空、统计归零、结果显示空状态「在上方输入原文与修改后文本…」
- [ ] Diff 工具：验证「行内高亮」单选组默认选中「字符级」，载入示例后统一 diff 视图中修改行内含红底删除字符段（.difftool__char--del）与绿底新增字符段（.difftool__char--ins）
- [ ] Diff 工具：切到分屏视图，验证左右两栏均含字符级高亮段（左栏显示删除段，右栏显示新增段，相同字符保持普通色）
- [ ] Diff 工具：点击「无」单选项关闭行内高亮，验证 .difftool__char--del 与 .difftool__char--ins 元素消失（降级为整行高亮）；重新选「字符级」后字符段恢复
- [ ] Diff 工具：点击「词级」单选项，验证修改行内的差异段以「单词 / 标点」为切分单元（如示例 version: 1.0.0 → 2.0.0 在词级下「1」「2」整体替换，区别于字符级把每位数字逐字符拆分），保留 .difftool__char--del 与 .difftool__char--ins 类名但段数应少于字符级（断言词级 del 段数 < 字符级 del 段数）
- [ ] Diff 工具：三模式（无 / 字符级 / 词级）互斥切换，切换后差异段数量与粒度相应变化，统计栏（相同 / 新增 / 删除 / 修改 / 相似度）保持不变
- [ ] 访问 `/cron` 工具页，测试 CRON 表达式输入、实时解析、中文描述、下次执行时间、预设载入、清空
- [ ] Cron 工具：页面载入后默认表达式「0 9 * * 1-5」（工作日 9 点），验证输入框已填充、5 字段分隔显示（分钟 0 / 小时 9 / 日 * / 月 * / 周 1-5）、中文描述含「工作日」「9 点」「周一到周五」
- [ ] Cron 工具：验证「未来 5 次执行时间」列表显示 5 条记录，第 1 条带「X 天 X 小时后」相对时间标签
- [ ] Cron 工具：点击任意预设按钮（如「每天 0 点」），验证输入框更新为 `0 0 * * *`、描述更新为「每天凌晨 0 点执行」、下次执行时间列表更新
- [ ] Cron 工具：输入错误表达式（如 `0 25 * * *` 小时越界），验证显示红色错误提示「取值越界」、输入框红色边框
- [ ] Cron 工具：输入错误表达式（如 `0 9` 仅 2 字段），验证显示「需要 5 个字段，实际 2 个」错误提示
- [ ] Cron 工具：点击「复制表达式」按钮，验证状态栏提示「已复制表达式」
- [ ] Cron 工具：点击「复制描述」按钮，验证状态栏提示「已复制表达式与描述」
- [ ] Cron 工具：点击「清空」按钮，验证输入框清空、描述与下次执行时间列表消失
- [ ] Cron 工具：展开「字段语法说明」，验证含 5 字段取值范围表与 8 个特殊字符说明表（* ? , - / L W #）
- [ ] 访问 `/ip` 工具页，测试 IPv4/IPv6 双栈解析、CIDR 表示法、子网信息、二进制视图、子网划分、预设载入
- [ ] IP 工具：默认载入 `192.168.1.0/24`，验证子网信息区显示网络地址 `192.168.1.0`、广播地址 `192.168.1.255`、子网掩码 `255.255.255.0`、通配符掩码 `0.0.0.255`、主机数 254、IP 范围 `192.168.1.1 - 192.168.1.254`
- [ ] IP 工具：验证类型标签显示「私有地址」（RFC 1918）与「C 类」（IP 类别判定）
- [ ] IP 工具：验证二进制视图显示 4 段 8 位二进制（如 `11000000.10101000.00000001.00000000`）
- [ ] IP 工具：点击「环回地址」预设（`127.0.0.0/8`），验证类型标签显示「环回地址」
- [ ] IP 工具：输入 IPv6 环回 `::1/128`，验证类型标签显示「环回地址」、主机数 1
- [ ] IP 工具：输入 IPv6 链路本地 `fe80::/10`，验证类型标签显示「链路本地」
- [ ] IP 工具：输入点分掩码 `10.0.0.0/255.0.0.0`，验证自动转换为 CIDR `/8` 并显示子网信息
- [ ] IP 工具：输入无效 IP（如 `999.1.1.1`），验证显示「IP 解析失败」错误提示
- [ ] IP 工具：输入越界前缀（如 `192.168.1.0/33`），验证显示「前缀长度越界」错误提示
- [ ] IP 工具：点击「划分」按钮（默认划分为 2 个子网），验证子网划分结果表格显示 2 行，每行含子网 CIDR、网络地址、广播地址、主机数
- [ ] IP 工具：切换划分数量为 4，验证表格更新为 4 行子网
- [ ] IP 工具：点击「复制 CIDR」按钮，验证状态栏提示「已复制」
- [ ] IP 工具：点击「清空」按钮，验证输入框清空、子网信息区不显示
- [ ] 访问 `/base64-image` 工具页，测试图片→Base64 与 Base64→图片双向转换、拖拽/粘贴/上传、格式互转、四种复制格式
- [ ] Base64 图片工具：Encode 模式下点击「选择图片」按钮上传一张 PNG 图片，验证图片预览显示（棋盘格背景透明区域）、信息表显示文件名/类型/尺寸/大小/Base64 长度
- [ ] Base64 图片工具：验证格式转换区显示 PNG/JPEG/WebP 三个选项与质量滑块（仅 JPEG/WebP），切换为 JPEG 验证图片预览更新、白色背景填充透明区域
- [ ] Base64 图片工具：点击「Data URL」复制按钮，验证状态栏提示「已复制」，剪贴板内容以 `data:image/` 开头
- [ ] Base64 图片工具：点击「<img> 标签」复制按钮，验证剪贴板内容以 `<img src="data:image/` 开头
- [ ] Base64 图片工具：切换到 Decode 模式，粘贴合法 Base64 字符串，点击「解码」按钮，验证图片预览显示、信息表显示类型/尺寸/大小
- [ ] Base64 图片工具：Decode 模式下输入非法 Base64（如 `!!!非合法base64!!!`），点击「解码」按钮，验证显示「Base64 格式非法」错误提示
- [ ] Base64 图片工具：Encode 模式下拖拽非图片文件（如 .txt 文本文件），验证显示「请选择图片文件」错误提示
- [ ] Base64 图片工具：Encode 模式下上传 > 10MB 图片文件，验证显示「文件过大」错误提示
- [ ] 访问 `/sql` 工具页，测试 SQL 美化与压缩、关键字大小写、缩进、子查询缩进、语法校验、高亮、6 个预设模板
- [ ] SQL 工具：默认载入 SELECT 模板（含 select ... from ... where ... order by ... limit），验证格式化结果区显示大写关键字 SELECT/FROM/WHERE/ORDER BY/LIMIT，主子句前换行
- [ ] SQL 工具：点击「压缩为一行」模式按钮，验证输出为单行 SQL（无多余换行与空格），关键字保持原样或大写
- [ ] SQL 工具：切换回「美化格式化」模式，点击「JOIN 多表」预设，验证 JOIN 前换行（INNER JOIN / LEFT JOIN 单独一行）
- [ ] SQL 工具：展开「格式化选项」，将关键字大小写切换为「小写」，验证输出关键字变为 select/from/where；切回「大写」
- [ ] SQL 工具：勾选「AND/OR 前换行」选项，验证 WHERE 子句中 AND/OR 单独一行
- [ ] SQL 工具：切换「逗号样式」为「逗号后换行」，验证 SELECT 字段列表每个字段单独一行
- [ ] SQL 工具：点击「CREATE 建表」预设，验证主键/外键约束格式化正确，括号内字段对齐
- [ ] SQL 工具：点击「应用回输入」按钮，验证格式化结果回填到输入框
- [ ] SQL 工具：点击「复制结果」按钮，验证状态栏提示「已复制」
- [ ] SQL 工具：输入框清空，验证输出区显示占位提示「格式化结果将在此显示...」、校验区提示「请输入 SQL 语句」
- [ ] SQL 工具：输入未闭合字符串（如 `select * from users where name = 'test`），验证校验区显示「字符串或标识符引号未闭合」错误
- [ ] SQL 工具：输入未闭合括号（如 `select * from (select * from users`），验证校验区显示「左括号 ( 未闭合」错误
- [ ] SQL 工具：输入含单引号转义的字符串（如 `where name = 'It''s test'`），验证格式化结果正确保留 `''` 转义、校验通过
- [ ] SQL 工具：输入含子查询的 SQL（如 `where id in (select id from users where status = 'active')`），验证子查询缩进正确、右括号与子查询内容对齐
- [ ] SQL 工具：输入含 CASE WHEN 的 SQL（如 `select case when score >= 90 then 'A' else 'B' end from grades`），验证 CASE/WHEN/THEN/ELSE/END 缩进正确
- [ ] SQL 工具：切换到「压缩为一行」模式并勾选「移除注释」，输入含行注释 `-- comment` 与块注释 `/* block */` 的 SQL，验证输出中注释被移除
- [ ] SQL 工具：验证高亮预览区关键字显示蓝色（.sql-kw）、字符串深蓝色（.sql-str）、数字蓝色（.sql-num）、注释灰色斜体（.sql-cmt）
- [ ] 访问 `/http-status` 工具页，测试 HTTP 状态码查询、搜索、分类筛选、accordion 展开、相关码跳转、复制
- [ ] HTTP 状态码工具：页面载入后默认显示全部 55+ 状态码，统计栏显示「共 N 个状态码」，分类筛选按钮含「全部 N / 1xx N / 2xx N / 3xx N / 4xx N / 5xx N」六个标签（每个含数量徽章）
- [ ] HTTP 状态码工具：搜索框输入 `404`，验证仅显示含 404 的状态码（404 Not Found）与相关码（410 Gone 等）；清空恢复全部
- [ ] HTTP 状态码工具：搜索框输入 `未认证`，验证显示 401 Unauthorized 状态码（中文场景字段匹配）
- [ ] HTTP 状态码工具：点击「4xx」分类按钮，验证仅显示 4xx 客户端错误状态码，且显示当前分类说明（橙色左边框提示框）
- [ ] HTTP 状态码工具：点击任一状态码卡片头部（如 200），验证 accordion 展开，详情区显示详细说明、典型场景、RESTful 用法、常配合响应头、相关状态码对比
- [ ] HTTP 状态码工具：展开 401 状态码，点击相关码 403 跳转按钮，验证自动切换到 403 卡片展开（如果 403 在当前筛选下可见）
- [ ] HTTP 状态码工具：展开任一状态码，点击「复制 N」按钮，验证状态栏提示「✓ 已复制」、剪贴板含对应状态码数字
- [ ] HTTP 状态码工具：搜索框输入不存在的内容（如 `xyz不存在`），验证显示空状态提示「未找到匹配的 HTTP 状态码」+ 提示文案
- [ ] HTTP 状态码工具：点击「清空」按钮，验证搜索框、分类筛选、选中状态全部重置
- [ ] HTTP 状态码工具：点击页面 FAQ 区任一 `<details>`，验证展开后含详细解答（如「301 和 302 重定向对 SEO 权重传递有什么区别？」）
- [ ] 访问 `/jwe` 工具页，测试 JWE 解析、五段拆分视图、Protected Header JSON 美化、本地解密
- [ ] JWE 工具：页面自动载入 dir 示例（SAMPLE_JWE_DIR），验证格式徽章显示「compact」、alg/enc 徽章显示「dir」「A128GCM」、Protected Header JSON 含 alg/enc 字段、五段拆分视图显示 5 行（保护头部/加密密钥/初始向量/密文/认证标签），每段含段名/长度/字节数/预览
- [ ] JWE 工具：点击「载入 RSA 示例」按钮，验证 alg 徽章变为「RSA-OAEP-256」、Protected Header 含 alg/enc 字段、五段视图第二段「加密密钥」长度非 0
- [ ] JWE 工具：点击「载入 PBES2 示例」按钮，等待生成完成（约 1-2 秒），验证 alg 徽章变为「PBES2-HS256+A128KW」、Protected Header JSON 含 alg/enc/p2s/p2c 四个字段（p2c=1000）、五段视图第二段「加密密钥」长度非 0、密钥输入框自动填入密码 `toolbox-pbes2-demo`
- [ ] JWE 工具：载入 PBES2 示例后点击「解密」按钮，验证明文显示区出现 JSON 美化的内容（含 sub/iat 等字段），证明 PBKDF2 派生 KEK + AES-KW 解包 CEK + AES-GCM 解密链路完整可用
- [ ] JWE 工具：点击「载入 ECDH-ES 示例」按钮，等待生成完成（约 1-2 秒），验证 alg 徽章变为「ECDH-ES」、Protected Header JSON 含 alg/enc/epk 三个字段（epk.crv=P-256）、五段视图第二段「加密密钥」长度为 0（ECDH-ES 直接模式 encrypted_key 为空）、密钥输入框自动填入接收方 EC 私钥 JWK（含 kty=EC、crv=P-256、d 字段）
- [ ] JWE 工具：载入 ECDH-ES 示例后点击「解密」按钮，验证明文显示区出现 JSON 美化的内容（含 sub/iat 等字段），证明 ECDH 派生共享秘密 + Concat KDF 派生 CEK + AES-GCM 解密链路完整可用
- [ ] JWE 工具：点击「生成测试 JWE」按钮，等待生成完成，验证提示「已生成可解密的 dir+A128GCM JWE」（约 1-2 秒），生成后输入框内容被替换为新 JWE，alg 徽章为「dir」
- [ ] JWE 工具：在密钥输入框输入与示例匹配的 base64url 密钥（生成测试 JWE 后会显示提示密钥），点击「解密」按钮，验证明文显示区出现 JSON 美化的内容，含「sub」「iat」等字段（生成的明文是 JWT 格式）
- [ ] JWE 工具：输入非法 JWE（如 3 段 `a.b.c`），验证显示「JWE 应包含 5 段」错误提示
- [ ] JWE 工具：点击「清空」按钮，验证输入框、解析结果、解密结果全部清空
- [ ] JWE 工具：点击页面 FAQ 区任一 `<details>`，验证展开后含详细解答（如「JWE 与 JWT、JWS 有什么区别？」）
- [ ] 访问 `/markdown` 工具页，测试 Markdown 实时分屏预览、工具栏快捷按钮、字数统计、HTML 导出、草稿自动保存
- [ ] Markdown 工具：编辑器自动载入示例（约 866 字符），验证预览区实时渲染（含标题、列表、表格、代码块、引用、链接、图片）
- [ ] Markdown 工具：验证统计栏显示字符数、字数、行数、预计阅读时间、同步滚动开关
- [ ] Markdown 工具：编辑器输入 `<script>alert(1)</script>`，验证预览区显示转义后的 `&lt;script&gt;` 文本而非执行脚本（XSS 安全）
- [ ] Markdown 工具：编辑器输入 `<https://example.com?a=1&b=2>` 自动链接，验证预览区渲染为可点击 `<a href="...">` 链接（query 参数 & 正确还原）
- [ ] Markdown 工具：刷新页面，验证草稿从 localStorage 自动恢复；点击「复制 HTML」按钮验证剪贴板含渲染后的 HTML
- [ ] 访问 `/mime` 工具页，测试 MIME 类型查询、搜索过滤、类别筛选、一键复制
- [ ] MIME 工具：默认载入 100+ 条目，首条目扩展名以点开头（如 `.txt`）、MIME 类型含斜杠（如 `text/plain`）、类别徽章非空
- [ ] MIME 工具：搜索框输入 `png`，验证过滤出 `.png` 扩展名与 `image/png` MIME 类型条目；点击清空按钮恢复全部条目
- [ ] MIME 工具：点击「图片」类别按钮，验证仅显示图片类条目（所有徽章为「图片」、所有 MIME 以 `image/` 开头）；切回「全部」恢复
- [ ] MIME 工具：搜索框输入不存在的内容（如 `xyz不存在的格式`），验证显示空状态提示
- [ ] MIME 工具：点击扩展名按钮或 MIME 类型按钮，验证复制成功（剪贴板含对应文本）
- [ ] 首页工具列表搜索框输入 "json"，应显示 JSON 工具、JWT 工具、JWE 解码、CSV/JSON 互转、YAML/JSON 互转、TOML/JSON 互转、JSONPath 查询工具、JSON Schema 校验、YAML Schema 校验与 TOML Schema 校验十个工具（keywords 均含 "json"）
- [ ] 首页点击分类按钮 "加密哈希"，显示 UUID、Hash、AES 加解密与密码生成器四个工具卡片
- [ ] 首页点击分类按钮 "时间日期"，显示时间戳转换、时区转换器、时间单位换算器与 CRON 表达式解析器四个工具卡片
- [ ] 首页点击分类按钮 "代码调试"，显示正则表达式、正则表达式性能基准、JWT 解码、JWT 签名生成器、JWT 签名验证工具、JWE 解码、MIME 类型查询与 SQL 格式化与压缩八个工具卡片
- [ ] 首页点击分类按钮 "编码转换"，显示 JSON、Base64、Base32、Hex 十六进制、Punycode 编解码、URL、HTML 实体编解码、颜色格式转换、CSV/JSON 互转、JSON 转 XML 转换工具、YAML/JSON 互转、TOML/JSON 互转、Base64 图片互转、JSONPath 查询工具、JSON Schema 校验、YAML Schema 校验、TOML Schema 校验与 JSON 转 TypeScript 接口十八个工具卡片
- [ ] 首页点击分类按钮 "设计"，显示颜色对比度检查、调色板生成器与二维码生成器三个工具卡片
- [ ] 首页点击分类按钮 "文档处理"，显示 Markdown 预览器、文本对比工具、占位文本与 Mock 数据生成器、ASCII Art 横幅生成器、HTML 格式化与压缩、CSS 格式化与压缩与 JavaScript 格式化与压缩七个工具卡片
- [ ] 首页点击分类按钮 "网络"，显示 IP 子网计算器与 HTTP 状态码查询两个工具卡片
- [ ] 首页搜索框输入不存在的内容（如 "xyz"），显示空状态提示 `#tools-empty`
- [ ] 首页清空搜索框并点击"全部"分类，恢复显示全部 47 个工具
- [ ] JSON Schema 工具：访问 `/json-schema`，页面 H1 含「JSON Schema 校验工具」，SEO meta description 含「draft-07」与「$ref」，JSON-LD `@type` 为 WebApplication
- [ ] JSON Schema 工具：点击「载入示例」，左侧 Schema 与右侧数据自动填充，结果区显示「校验失败」徽章与 2 处错误（age 超范围、tags 含重复）
- [ ] JSON Schema 工具：错误列表每项含关键字徽章（按类型着色）+ 路径（如 /age）+ 中文消息，点击错误项可高亮该路径
- [ ] JSON Schema 工具：修正示例数据（age 改为 28、tags 去重），结果区变为「校验通过」绿色提示
- [ ] JSON Schema 工具：点击「清空」，两侧编辑器与结果区均清空，显示输入提示
- [ ] JSON Schema 工具：故意输入非法 JSON（如 `{`），结果区显示「解析失败」与具体错误消息
- [ ] JSON Schema 工具：点击「复制错误」按钮，剪贴板含错误列表纯文本
- [ ] YAML Schema 工具：访问 `/yaml-schema`，页面 H1 含「YAML Schema 校验工具」，SEO meta description 含「K8s」与「类型推断」，JSON-LD `@type` 为 WebApplication
- [ ] YAML Schema 工具：点击「载入示例」，左侧 JSON Schema 与右侧 YAML 数据自动填充，结果区显示「校验失败」徽章与 2 处错误（replicas 类型错误、containers[1] 缺少 image）+ YAML 类型提示（on 被解析为布尔、1.25 被解析为数字）
- [ ] YAML Schema 工具：错误列表每项含关键字徽章 + 路径（如 /spec/replicas）+ 中文消息；YAML 类型提示区显示陷阱字段与修复建议
- [ ] YAML Schema 工具：修正 YAML 数据（replicas 改为 3、第二个容器补充 image: nginx:1.25），结果区变为「校验通过」绿色提示
- [ ] YAML Schema 工具：点击「清空」，两侧编辑器与结果区均清空，显示输入提示
- [ ] YAML Schema 工具：故意输入非法 YAML（如 `key: [unclosed`），结果区显示「YAML 解析失败」与具体错误消息
- [ ] TOML Schema 工具：访问 `/toml-schema`，页面 H1 含「TOML Schema 校验工具」，SEO meta description 含「pyproject」或「Cargo」与「类型陷阱」，JSON-LD `@type` 为 WebApplication
- [ ] TOML Schema 工具：点击「载入示例」，左侧 JSON Schema 与右侧 TOML 数据自动填充，结果区显示「校验失败」徽章与 2 处错误（requires-python 类型错误、dependencies[1] minLength 错误）
- [ ] TOML Schema 工具：错误列表每项含关键字徽章 + 路径（如 /project/requires-python）+ 中文消息
- [ ] TOML Schema 工具：修正 TOML 数据（requires-python 改为 ">=3.8"、dependencies 第二项改为 "numpy"），结果区变为「校验通过」绿色提示
- [ ] TOML Schema 工具：点击「清空」，两侧编辑器与结果区均清空，显示输入提示
- [ ] TOML Schema 工具：故意输入非法 TOML（如 `[unclosed`），结果区显示「TOML 解析失败」与具体错误消息（含行号）
- [ ] 正则基准工具：访问 `/regex-benchmark`，页面 H1 含「正则表达式性能基准测试工具」，SEO meta description 含「ReDoS」与「嵌套量词」，JSON-LD `@type` 为 WebApplication
- [ ] 正则基准工具：点击「经典 ReDoS」预设按钮，正则输入框载入 `^(a+)+$`，结果区静态分析显示「高风险」红色徽章与危险原因（嵌套量词）
- [ ] 正则基准工具：载入「安全正则」预设，静态分析显示「低风险」绿色徽章；切换回「经典 ReDoS」预设，徽章变红
- [ ] 正则基准工具：载入「经典 ReDoS」预设后点击「运行基准」，结果区显示迭代次数、平均/最大/最小/标准差耗时与总耗时
- [ ] 正则基准工具：点击「运行压力测试」，结果区显示 5 个递增长度（10/20/30/40/50）的耗时列表、时间增长倍数与「指数增长」或「线性增长」判定
- [ ] 正则基准工具：载入「安全正则」预设后运行压力测试，判定应为「线性增长」（绿色提示）
- [ ] 正则基准工具：输入非法正则如 `(unclosed`，状态栏显示「正则编译失败」错误提示
- [ ] 正则基准工具：点击 g/i/m/s/u 标志位按钮，按钮高亮切换，正则重新编译生效
- [ ] 访问 `/about` 和 `/privacy` 页面正常
- [ ] 访问 `/blog` 博客列表页，确认文章卡片正常显示
- [ ] 访问 `/blog/uuid-generation-guide` 与 `/blog/json-formatting-guide`，确认 markdown 渲染正常（代码块、表格、列表）
- [ ] 访问 `/blog/base64-encoding-guide`、`/blog/sha256-hash-guide`、`/blog/unix-timestamp-guide`、`/blog/url-encoding-guide`、`/blog/regex-test-guide`、`/blog/jwt-decode-guide`、`/blog/color-format-guide`、`/blog/markdown-practical-guide`、`/blog/frontend-encoding-overview`、`/blog/color-contrast-accessibility`、`/blog/data-format-conversion-overview`、`/blog/web-security-csp-xss-csrf`、`/blog/http-status-codes-overview`、`/blog/regex-practical-patterns`、`/blog/jwt-security-best-practices`、`/blog/yaml-json-toml-comparison`、`/blog/toml-configuration-guide`、`/blog/qr-code-design-guide`、`/blog/password-strength-entropy`、`/blog/diff-algorithms-lcs-myers`、`/blog/cron-expression-scheduling`、`/blog/ipv4-ipv6-cidr-subnetting`、`/blog/placeholder-mock-data-guide`、`/blog/sql-parser-tokenizer-design`，确认 26 篇技术博客渲染正常（含 16 篇跨工具专题）
- [ ] 博客详情页文末"打开配套工具"按钮跳转到对应工具页
- [ ] 博客详情页标签可点击，跳转到 `/blog/tag/{slug}` 标签筛选页
- [ ] 访问 `/blog/tag` 标签索引页，确认 87 个标签卡片显示，每个标签显示文章数
- [ ] 访问 `/blog/tag/javascript` 标签筛选页，确认列出 9 篇含 JavaScript 标签的文章（含跨工具专题博客 frontend-encoding-overview）
- [ ] 访问 `/blog/tag/正则` 与 `/blog/tag/代码调试` 标签筛选页，确认列出正则入门博客
- [ ] 访问 `/blog/tag/jwt`、`/blog/tag/认证` 标签筛选页，确认列出 JWT 解码博客与 JWT 安全进阶博客（2 篇）
- [ ] 访问 `/blog/tag/安全` 标签筛选页，确认列出 3 篇含安全标签的文章（前端安全 CSP/XSS/CSRF、JWT 入门、JWT 安全进阶）
- [ ] 访问 `/blog/tag/刷新令牌`、`/blog/tag/黑名单`、`/blog/tag/算法选择` 标签筛选页，确认列出跨工具专题博客「JWT 安全进阶：Refresh Token、黑名单、算法选择与漏洞防御」（3 个新标签页覆盖 JWT 安全长尾词）
- [ ] 访问 `/blog/tag/配置文件`、`/blog/tag/yaml`、`/blog/tag/toml` 标签筛选页，确认列出跨工具专题博客「YAML / JSON / TOML 配置格式对比：该用哪个？转换陷阱与选型决策」（3 个新标签页覆盖配置文件长尾词）
- [ ] 访问 `/blog/tag/rust`、`/blog/tag/python`、`/blog/tag/cargo`、`/blog/tag/pyproject` 标签筛选页，确认列出跨工具专题博客「TOML 配置文件实战指南：语法详解、日期时间类型与 Cargo / pyproject 案例」（4 个新标签页覆盖 Rust/Python 配置长尾词）
- [ ] 访问 `/blog/tag/二维码`、`/blog/tag/qr`、`/blog/tag/wifi`、`/blog/tag/vcard` 标签筛选页，确认列出跨工具专题博客「二维码应用场景与设计指南：容错等级、容量、颜色与扫描兼容性」（4 个新标签页覆盖二维码长尾词）
- [ ] 访问 `/blog/tag/密码`、`/blog/tag/熵`、`/blog/tag/csprng`、`/blog/tag/随机数` 标签筛选页，确认列出跨工具专题博客「密码强度与熵：从随机数到强密码的完整指南」（4 个新标签页覆盖密码安全长尾词）
- [ ] 访问 `/blog/tag/diff`、`/blog/tag/算法`、`/blog/tag/lcs`、`/blog/tag/文本对比` 标签筛选页，确认列出跨工具专题博客「文本对比算法：LCS 与 Myers diff 的工程实践」（4 个新标签页覆盖文本对比长尾词）
- [ ] 访问 `/blog/tag/cron`、`/blog/tag/定时任务`、`/blog/tag/调度`、`/blog/tag/crontab` 标签筛选页，确认列出跨工具专题博客「CRON 表达式与定时任务调度：从 POSIX cron 到 Kubernetes CronJob 的工程实践」（4 个新标签页覆盖定时任务长尾词）
- [ ] 访问 `/blog/tag/ip`、`/blog/tag/子网`、`/blog/tag/cidr`、`/blog/tag/ipv6`、`/blog/tag/工具矩阵` 标签筛选页，确认列出跨工具专题博客「IPv4 与 IPv6 子网划分：从 CIDR 表示法到 VLSM 工程实践」（5 个新标签页覆盖网络/子网长尾词）
- [ ] 访问 `/blog/tag/词法分析`、`/blog/tag/tokenizer`、`/blog/tag/解析器`、`/blog/tag/数据库`、`/blog/tag/算法` 标签筛选页，确认列出跨工具专题博客「SQL 格式化与 SQL 解析器设计：词法分析器、token 类型与缩进策略」（5 个新标签页覆盖 SQL/解析器长尾词）
- [ ] 访问 `/blog/tag/安全`、`/blog/tag/xss`、`/blog/tag/csp`、`/blog/tag/csrf` 标签筛选页，确认列出跨工具专题博客「前端安全实战：CSP、XSS、CSRF 防护全景指南」（安全标签同时含 JWT 博客）
- [ ] 访问 `/blog/tag/颜色`、`/blog/tag/css`、`/blog/tag/设计` 标签筛选页，确认列出颜色格式博客与颜色对比度博客
- [ ] 访问 `/blog/tag/编码`、`/blog/tag/前端`、`/blog/tag/html` 标签筛选页，确认列出跨工具专题博客「前端编码全景」
- [ ] 访问 `/blog/tag/无障碍`、`/blog/tag/wcag` 标签筛选页，确认列出颜色对比度博客「无障碍颜色对比度：WCAG 2.1 标准与前端实践」
- [ ] 访问 `/blog/tag/数据`、`/blog/tag/csv`、`/blog/tag/格式转换` 标签筛选页，确认列出跨工具专题博客「数据格式转换全景：CSV / JSON / TSV / YAML 该用哪个？」
- [ ] 访问 `/blog/tag/http`、`/blog/tag/后端`、`/blog/tag/网络`、`/blog/tag/状态码` 标签筛选页，确认列出跨工具专题博客「HTTP 状态码全景：1xx / 2xx / 3xx / 4xx / 5xx 含义与处理」（4 个新标签页覆盖后端开发长尾词）
- [ ] 标签筛选页标签云可切换到其他标签，当前标签高亮
- [ ] 标签筛选页面包屑导航（首页 / 技术博客 / 标签 / 当前标签）正常跳转
- [ ] 博客列表页底部"按标签浏览全部文章"按钮跳转到 `/blog/tag`
- [ ] 首页"最新文章"卡片显示标签，标签可点击跳转到标签筛选页
- [ ] 博客详情页文末"上一篇 / 下一篇"导航链接可正常跳转
- [ ] 访问 `/rss.xml` 返回 RSS XML，包含全部 26 篇博客
- [ ] 首页"最新文章"模块显示 3 篇博客卡片，点击跳转正常
- [ ] 导航栏"博客"链接跳转到 `/blog`
- [ ] 浏览器开发者工具 Network 面板无 404 资源
- [ ] 浏览器 Console 面板无报错
- [ ] 移动端（375px）布局正常
- [ ] 暗色模式自动切换正常
- [ ] 访问 `/sitemap-index.xml` 返回 XML，包含全部 101 个页面
- [ ] 访问 `/robots.txt` 返回文本
- [ ] 用 [Lighthouse](https://pagespeed.web.dev/) 检查性能分 > 80
- [ ] 用 [Google 结构化数据测试工具](https://search.google.com/test/rich-results) 验证 JSON-LD 正确识别

## 六、回写 site-config.md 模板

部署成功后，请在 `e:\work\auto-website\docs\site-config.md` 中填入以下信息，agent 会自动进入阶段二（数据驱动迭代）：

```markdown
# 线上站点配置

## 基本信息
- 站点名称：工具盒子
- 线上 URL：https://your-domain.com
- 部署平台：Cloudflare Pages / Vercel / Netlify
- 上线日期：YYYY-MM-DD

## 统计分析（可选）
- 统计工具：Umami / Plausible / 未接入
- API 端点：（如未接入可留空）
- API Key：（如未接入可留空）

## 广告配置（可选，前期不接入）
- 广告联盟：未接入
- 广告位 ID：
- 审核状态：未申请

## 捐赠配置（可选，前期不接入）
- 捐赠平台：未接入
- 捐赠链接：

## 当前数据（用户定期更新）
- 日访问量：0
- 主要流量来源：搜索 / 直接 / 外链
- 热门页面：暂无
- 已产生收入：无
```

## 七、可选：接入轻量统计（推荐 Umami）

若希望 agent 后续做数据驱动迭代，推荐接入 Umami（开源自托管，无 Cookie，不追踪个人信息）：

1. 在 Umami Cloud 或自托管实例注册站点，获得 `website-id` 与 `script-url`
2. 在 `src/layouts/BaseLayout.astro` 的 `<head>` 末尾添加：

```html
<script async defer
  src="https://your-umami.example.com/script.js"
  data-website-id="YOUR_WEBSITE_ID"></script>
```

3. 把 Umami 的 API 端点与 Key 填入 `docs/site-config.md`，agent 下轮可拉取数据

## 八、常见问题

**Q: 构建报错 "EPERM: operation not permitted, mkdir Config"？**
A: Astro 遥测被沙箱拦截。设置环境变量 `ASTRO_TELEMETRY_DISABLED=1` 后重试。

**Q: 部署后样式丢失？**
A: 检查 `astro.config.mjs` 的 `site` 字段是否已改为真实域名（影响 OG 图绝对路径，但样式应不受影响）。若仍异常，检查构建日志中 CSS 是否被内联。

**Q: JSON 工具点击按钮无反应？**
A: 浏览器需支持 JavaScript。Astro 岛屿已配置 `client:load`，页面加载后立即水合。

**Q: JSON 树形视图为何不可用？**
A: 树形视图仅在执行「格式化 / 压缩 / 校验」操作成功后激活（解析后的 JS 对象渲染为树）。「转义 / 去转义」输出的是字符串内容，不是 JSON 对象，因此树形 Tab 会被禁用，请切回「文本」Tab 查看。

**Q: JSON 树形视图搜索支持匹配哪些内容？**
A: 搜索不区分大小写，匹配对象键名（key）与字符串值（string value）。数字、布尔、null 类型不参与匹配。搜索时所有容器节点（对象/数组）会自动展开便于查看匹配位置，匹配片段以橙色高亮显示，顶部显示「找到 N 个匹配」计数。清空搜索框后恢复默认折叠规则。

**Q: Hash 工具文件哈希为何限制 100MB？**
A: 浏览器原生 SubtleCrypto API 的 `digest` 方法不支持流式增量哈希，需要完整 ArrayBuffer 一次性计算，文件需全部读入内存。对超大文件，浏览器内存可能不足。如需计算 GB 级文件哈希，建议使用本地命令行工具（如 `sha256sum`、`certutil -hashfile 文件 SHA256`）。

**Q: Hash 文件哈希支持多算法同时计算吗？**
A: 支持。在文件哈希 Tab 勾选多个算法（如 SHA-256 + SHA-512），点击「计算哈希」会一次性读取文件并并行计算所有勾选算法的摘要，便于交叉校验。

**Q: URL 解析视图能解析哪些部分？**
A: 切换到「URL 解析」Tab 后，输入完整 URL 即可看到 protocol（协议）、origin（源）、host（主机+端口）、hostname（主机名）、port（端口）、pathname（路径）、search（查询串）、hash（锚点）、username（用户名）、password（密码）共 11 个组成部分，并自动将查询参数解析为键值对表格。每项均可单独复制。若输入缺少协议（如 `example.com/path`），会自动补 `https://` 重试一次。

**Q: 时间戳批量转换如何识别秒与毫秒？**
A: 切换到「批量转换」Tab 后，每行一个时间戳。工具按整数位数自动识别：10 位视为秒级（如 `1700000000`），13 位视为毫秒级（如 `1700000000000`）。其他位数标记为「未知」并按毫秒兜底解析。无效行（非数字、空行）会标红显示错误原因。点击「复制全部」可导出有效结果的 CSV 格式（序号,原始时间戳,单位,本地时间,ISO 8601）。

**Q: 正则表达式测试工具支持哪些功能？**
A: 工具提供两个 Tab：「测试匹配」实时高亮全部匹配片段、显示匹配数与捕获组（$1/$2/$3…）；「替换」基于正则进行字符串替换，支持 $1/$2 引用捕获组、$$ 转义字面 $。标志位 g/i/m/s/u/y 可任意组合勾选。内置 8 个常用模式速查（邮箱、URL、IPv4、手机号、中文字符、HTML 标签、整数、浮点数），点击即载入。

**Q: 正则工具如何防止 ReDoS 攻击？**
A: 工具对输入长度设上限（10000 字符），超出会标红提示并截断；对匹配数设上限（5000 个），超出会显示「（已截断）」提示；对零宽匹配（如 `^` `(?=...)`）做 lastIndex 自增保护，避免相同位置无限循环。生产环境校验用户输入的正则应额外使用 re2 等线性时间引擎。

**Q: 正则工具的替换模式与 JavaScript 原生 replace 有何区别？**
A: 替换永远使用全局匹配（即使未勾选 g 标志位也会自动加 g），所有匹配项都会被替换，符合用户直觉。支持 $1/$2/$3 引用捕获组、$$ 转义为字面 $。命名捕获组 `$<name>` 语法暂不支持（原生 String.replace 支持，但本工具为简化逻辑仅支持编号引用）。

**Q: JWT 解码工具能验签吗？**
A: 不能。本工具仅做「解码」不做「验签」。验签需要持有密钥（HS256 的共享密钥或 RS256/ES256 的公钥），且密钥属敏感信息不应贴入第三方网页。如需验签，请使用本地命令行工具（如 Node.js 的 `jsonwebtoken.verify(token, secret)` 或 Go 的 `jwt.Parse`）。本工具聚焦于「快速查看 JWT 内容」的场景，所有解析在浏览器本地完成，token 不离开你的设备。

**Q: JWT 的 exp 字段是秒还是毫秒？**
A: 秒级 Unix 时间戳（RFC 7519 标准）。例如 `exp: 1900000000` 表示 2030-03-18 01:46:40 UTC。这与 JavaScript 的 `Date.now()`（毫秒级）不同，本工具会自动识别并格式化为本地时间显示在「过期状态」栏。若你看到「已过期」但实际未过期，多半是后端误把毫秒当秒填入 exp 字段。

**Q: 为什么 JWT 的 Signature 段显示的是乱码？**
A: Signature 段是 HMAC/RSA/ECDSA 计算出的二进制摘要的 base64url 编码，本身不是文本，解码后是不可读的二进制字节。本工具保留 Signature 的原始 base64url 字符串展示（不解码），方便你复制比对。Header 与 Payload 段则是 JSON 经 base64url 编码，解码后是可读的 JSON 文本。

**Q: 工具支持哪些 JWT 算法？**
A: 解码支持所有 JWT 标准算法（none/HS256/HS384/HS512/RS256/RS384/RS512/ES256/ES384/ES512/PS256/PS384/PS512/EdDSA），算法卡片会显示对应说明（如「HS256 · HMAC + SHA-256（对称密钥）」「RS256 · RSA + SHA-256（非对称，公钥验签）」）。注意 `none` 算法无签名，不安全，仅用于调试场景，生产环境绝不应使用。

**Q: 颜色格式转换工具支持哪些输入格式？**
A: 支持 5 种主流颜色格式：HEX（`#2b6cff` 或 `2b6cff`、3 位简写 `#f00`）、RGB（`rgb(43, 108, 255)` 或裸值 `43, 108, 255`）、HSL（`hsl(222, 100%, 58%)`）、HSV（`hsv(222, 83%, 100%)`）、CMYK（`cmyk(83%, 58%, 0%, 0%)`）。输入时建议加前缀（`rgb()` / `hsl()` / `hsv()` / `cmyk()`）以避免歧义，3 个数字 0-255 自动按 RGB 解析，4 个数字 0-100 自动按 CMYK 解析。也可点击左侧色块用浏览器原生拾色器选色。

**Q: HSL 和 HSV 有什么区别？**
A: 两者都基于色相（H）+ 饱和度（S），但第三维不同：HSL 的 L（亮度）0% 是黑、100% 是白、50% 是纯色；HSV 的 V（明度）0% 是黑、100% 是纯色（不是白）。关键差异：「加白」在 HSL 中是 L↑，在 HSV 中是 S↓；「加黑」在 HSL 中是 L↓，在 HSV 中是 V↓。Photoshop 取色器用 HSV（画家「选色 → 加白」直觉），CSS 用 HSL（明度均匀更适合网页设计）。本工具明确标注每种的格式，避免混淆。

**Q: 颜色工具的调色板是怎么生成的？**
A: 基于色彩理论的标准和谐方案，对当前颜色的 HSL 色相做旋转：互补色（±180°，2 色）对比强烈适合强调；类似色（±30°，3 色）邻近色和谐柔顺适合统一氛围；三角色（±120°，3 色）平衡活泼适合多区域；分割互补（180°±30°，3 色）比互补色柔和；四角色（±90°/±180°，4 色）丰富多样适合多主题。所有方案保持当前颜色的饱和度与亮度，仅旋转色相。点击色块设为当前色，点「复制」按钮复制 HEX。

**Q: HTML 实体编解码工具支持哪些输入格式？**
A: 编码支持三种模式：①「仅必要字符」只转义 `& < > " '`，保留中文与符号原样；②「命名实体优先」必要字符 + 命名实体表中的符号（© ® ™ … 等）优先用命名形式；③「全部数字实体」所有非 ASCII 字符（含中文）转为 `&#NN;` 数字实体。解码支持命名实体（`&copy;`）、十进制（`&#38;`）、十六进制（`&#x26;`）三种形式，使用浏览器原生 DOMParser 解析，覆盖所有 HTML5 命名实体。

**Q: HTML 实体三种编码模式该怎么选？**
A: ①在 HTML 中安全显示用户输入 → 选「仅必要字符」（最小代价、保留中文）；②要在邮件或文档中可读地显示特殊符号 → 选「命名实体优先」（`&copy;` 比 `&#169;` 更易读）；③要保证纯 ASCII 通道兼容（如老式邮件、XML 声明前字符）→ 选「全部数字实体」（兼容性最高，体积最大）。注意避免重复编码已编码的字符串，否则会出现 `&amp;amp;` 双重转义问题。

**Q: 颜色对比度检查工具支持哪些输入格式？**
A: 仅支持 HEX 格式（`#1f2937` 或 `1f2937`、3 位简写 `#fff`）。可通过两种方式输入：①点击拾色器（input[type=color]）直接选色；②在文本框输入 HEX 字符串。其他格式（RGB/HSL/HSV/CMYK）请先用 [颜色格式转换工具](/color) 转为 HEX 再粘贴。输入非法字符串（如 `xyz`）会显示「HEX 格式应为 #RRGGBB 或 #RGB」错误提示，但不影响另一侧颜色继续工作。

**Q: WCAG 2.1 的 AA 和 AAA 级别有什么区别？**
A: WCAG 分为三个合规级别：A（最低）、AA（行业基准）、AAA（最高，特殊场景才要求）。对比度要求：AA 普通文字 ≥ 4.5:1、AA 大文字 ≥ 3.0:1；AAA 普通文字 ≥ 7.0:1、AAA 大文字 ≥ 4.5:1。大文字定义为 ≥ 18px 普通字重，或 ≥ 14px 加粗。UI 组件（按钮边框、图标、表单控件）≥ 3.0:1 即达 AA。多数政府与商业网站要求达 AA，医疗/政府关键信息才要求 AAA。本工具同时展示 5 项评级（AA 普通 / AA 大字 / AAA 普通 / AAA 大字 / UI 组件），便于快速判断是否满足目标合规级别。

**Q: CSV / JSON 互转工具支持哪些输入格式？**
A: CSV → JSON 模式接受标准 RFC 4180 CSV 文本，支持引号包裹字段（`"含,逗号"`）、引号转义（`"含""引号"`）、字段内换行（`"第一行\n第二行"`）、CRLF / LF 行结束符；可切换 4 种分隔符（逗号 / 分号 / Tab / 管道符）；可开关「首行表头」。JSON → CSV 模式接受 JSON 对象数组（如 `[{...}, {...}]`），嵌套对象自动展平为点号路径列（如 `user.name`），数组用 `[index]` 标记（如 `tags[0]`）。不支持 JSON Lines（每行一个对象的 `.jsonl` 格式），如需处理可先用文本编辑器包装为数组。

**Q: CSV 与 JSON 互转时类型为什么会丢失？**
A: 这是 CSV 格式本身的限制：CSV 没有类型系统，所有值在 CSV 中都是字符串。例如 `age` 列的 `28` 在 CSV 中只是字符 "2" 和 "8"，无法区分是数字还是字符串。因此 CSV → JSON 时所有字段都是字符串类型；JSON → CSV 时数字 `28` 会被 `String(28)` 转为字符串 "28" 写入 CSV。如果需要还原类型，可在 JSON 输出后用代码二次处理（`Number(row.age)`、`row.active === 'true'`）。本工具不自动推断类型，避免误判（如邮政编码 `021000` 若被转为数字会丢失前导零）。

**Q: HTML 实体工具的 XSS 防御演示模块会执行脚本吗？**
A: 不会执行任何脚本，完全安全。演示模块仅以纯文本形式展示攻击载荷（如 `<script>alert(1)</script>`）的原始内容与 HTML 实体编码后的结果（如 `&lt;script&gt;alert(1)&lt;/script&gt;`），所有内容通过 React 文本节点渲染（自动转义），浏览器不会将其解析为可执行代码。模块提供 4 种典型载荷（script 注入 / onerror 事件 / javascript: 协议 / SVG onload）和 5 种上下文安全提示（HTML 文本节点 / 属性值 / `<script>` 块内 / 事件处理器 / href 属性），帮助理解为什么单一 HTML 实体编码不能防住所有 XSS。详细原理参见博客《前端安全实战：CSP、XSS、CSRF 防护全景指南》。

**Q: MIME 类型查询工具的数据来源与覆盖范围？**
A: 工具内置 100+ 条常见文件扩展名与 MIME 类型对照表，覆盖 8 大类别：文档（.txt/.html/.md/.pdf/.docx 等）、图片（.png/.jpg/.webp/.svg/.gif 等）、音频（.mp3/.wav/.flac/.ogg 等）、视频（.mp4/.webm/.mkv/.mov 等）、压缩（.zip/.tar/.gz/.7z 等）、代码（.js/.ts/.py/.json/.xml 等）、字体（.woff/.woff2/.ttf/.otf 等）、应用（.exe/.dmg/.apk/.jar 等）。每条目含扩展名、MIME 类型、类别、描述四字段。数据基于 IANA 官方注册表与 Nginx/Apache 默认 mime.types 整理，可作为前端文件上传校验、Nginx/Apache 配置、HTTP Content-Type 设置的参考。

**Q: 为什么有些文件扩展名对应多个 MIME 类型？**
A: 部分扩展名在不同上下文有不同 MIME 类型。例如 `.svg` 既可以是 `image/svg+xml`（图片上下文）也可以是 `application/xml`（XML 解析上下文）；`.js` 可以是 `text/javascript`（现代标准）或 `application/javascript`（旧标准，部分老系统使用）。本工具按最常用场景给出主 MIME 类型，描述字段会标注特殊情况。生产环境设置 Content-Type 时应参考具体应用场景与服务器配置。

**Q: HTTP 状态码博客覆盖哪些内容？**
A: 博客《HTTP 状态码全景：1xx / 2xx / 3xx / 4xx / 5xx 含义与处理》系统讲解 5 大类共 60+ 常见状态码：1xx 信息响应（100/101/103）、2xx 成功（200/201/202/204/206）、3xx 重定向（301/302/303/304/307/308，含 SEO 权重传递对比）、4xx 客户端错误（400/401/403/404/405/409/410/413/415/422/429）、5xx 服务端错误（500/501/502/503/504）。重点解析 301 vs 302 SEO 权重区别、401 vs 403 认证授权区别、404 vs 410 永久删除信号、422 校验错误标准、429 限流 Retry-After、500 vs 502 vs 503 vs 504 服务端错误定位。配套工具矩阵联动 MIME 类型查询、JSON 工具、JWT 解码、URL 编解码、HTML 实体编解码 5 个工具页。

**Q: JWT 工具的 alg=none 安全警告有什么用？**
A: 当 JWT Header 的 alg 字段为 none 时，表示令牌无签名，任何人都能伪造 Payload 内容。RFC 7519 明确允许此算法仅用于调试，严禁生产使用。本工具检测到 alg=none 后会在解码区顶部显示红色安全警告横幅，提示用户切换到 HS256 / RS256 / ES256 等带签名的算法，并在算法卡片用红色边框强调。点击工具页的「不安全示例」按钮可载入演示 token 体验此功能。常见攻击场景：服务端未严格校验 alg 字段，攻击者把 Header 中的 "alg":"HS256" 改为 "alg":"none" 并清空签名段，若服务端信任客户端传入的 alg 就会跳过验签。详细原理参见博客《JWT 安全进阶：Refresh Token、黑名单、算法选择与漏洞防御》。

**Q: JWT 安全进阶博客覆盖哪些内容？**
A: 博客《JWT 安全进阶：Refresh Token、黑名单、算法选择与漏洞防御》深入讲解生产环境 JWT 安全实践：过期时间 exp 的精细化设计（按场景推荐 6 种时长）、Refresh Token 双令牌模式（access token + refresh token 轮转流程与代码示例）、JWT 黑名单与吊销机制（Redis 黑名单两种实现 + 用户令牌版本号方案）、HS256/RS256/ES256 算法选择决策树、alg=none 攻击与密钥混淆漏洞防御、Token 存储位置对比（localStorage/sessionStorage/httpOnly cookie/内存）、CSRF 与 JWT 关系、10 项常见安全漏洞速查表、14 项上线检查清单。配套工具矩阵联动 JWT 解码、SHA-256 哈希、UUID 生成、Base64、URL 编解码、时间戳转换 6 个工具页。与《JWT 入门与安全实践》形成入门+进阶完整体系。

**Q: YAML / JSON 互转工具支持哪些特性？**
A: 工具基于 js-yaml 库实现 YAML 1.1 标准的绝大部分特性。YAML → JSON 方向支持：注释、多文档（`---` 分隔符）、锚点（`&`）/别名（`*`）/合并键（`<<`）、流样式（`[1,2]` / `{a:1}`）、块样式、多行字符串（`|` 字面量 / `>` 折叠）。JSON → YAML 方向支持：可配置缩进（2/4 空格）、行宽控制、引号风格选择、`noRefs` 模式（不生成锚点/别名，展开为完整结构）。两种模式都支持实时转换开关、复制、下载、清空、示例。下载文件分别为 `.json`（YAML→JSON）和 `.yaml`（JSON→YAML）。

**Q: YAML 工具的类型推断陷阱提示是什么？**
A: YAML 1.1 schema 会把 `yes`/`no`/`on`/`off`/`y`/`n` 解析为布尔值，把 `2024-01-15` 格式解析为 Date 对象，这可能导致字符串值意外被转换类型。本工具在 YAML → JSON 模式下会扫描源文本，检测到这类「裸字符串」（未用引号包裹的值）时给出黄色提示，提醒用户检查是否需要加引号保留字符串类型。注意：此提示仅作风险提醒，不修改转换结果（YAML 的类型推断由 js-yaml 库按标准执行）。如需保留字符串类型，请在 YAML 源文中用引号包裹值（如 `enabled: "yes"`）。

**Q: YAML 的多文档是什么？转 JSON 后会变成什么？**
A: YAML 支持在一个文件中存放多个独立文档，用 `---`（三个连字符）作为分隔符，这是 YAML 独有的特性，JSON 不支持。常见用途：Kubernetes 多资源清单、Jekyll 多文章文件。本工具在检测到 `---` 分隔符时会自动切换为多文档模式，把每个文档解析后放入数组，输出区会显示「多文档 · N 个」标记。例如两个用 `---` 分隔的 YAML 文档转 JSON 后会得到 `[{"doc1":...}, {"doc2":...}]` 数组。反向转换（JSON → YAML）不支持多文档，因为 JSON 本身是单文档格式。

**Q: YAML/JSON/TOML 配置格式对比博客覆盖哪些内容？**
A: 博客《YAML / JSON / TOML 配置格式对比：该用哪个？转换陷阱与选型决策》系统对比三种主流配置文件格式：横向对比表（注释/多文档/类型系统/缩进敏感/引号要求/多行字符串/引用复用/可读性/工具链/解析复杂度 10 维度）、YAML 核心语法与类型推断陷阱（yes/no 布尔、日期自动解析）、JSON 优势劣势与无注释 workaround、TOML 表结构与数组表语法、互转陷阱（YAML→JSON 注释丢失/类型推断不可逆/多文档变数组/锚点展开，JSON→YAML 引号自动添加，TOML 与 YAML/JSON 互转的数组表问题）、选型决策树、按项目类型推荐表、9 项常见陷阱速查表。配套工具矩阵联动 YAML/JSON 互转、JSON 工具、CSV/JSON 互转、Base64、Hash、UUID、正则表达式 7 个工具页。

