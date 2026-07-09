# 2026-07-10 自动迭代进度

## 上下文恢复
- 项目：工具盒子（e:\work\auto-website）
- 阶段：阶段二（数据驱动迭代）—— docs/site-config.md 已有线上 URL https://website.niuzi.asia，上线日期 2026-07-09
- 技术栈：Astro 5 + React 18 + TypeScript 5.7
- 当前规模：47 个工具 + 42 篇博客 + 258 页面（构建通过）
- 承接：20260709 第 2 轮（SITE_URL 全站动态化），本轮承接其遗留建议优先级 1「47 个工具页 WebApplication.url 动态化」
- astro.config.mjs 的 site 已配置为 https://website.niuzi.asia（用户上线时已改）

## 本轮聚焦方向
**线上 URL 确定后的全站占位域名清理**（阶段二首轮，无访问数据时的启发式 SEO 优化）
站点上线后发现：astro.config.mjs 的 site 虽已改为线上域名，但 47 个工具页的 WebApplication JSON-LD 仍硬编码 `toolbox.example.com`，导致结构化数据 URL 指向错误域名，影响 SEO 收录与富媒体展示。同步排查清理其他静态资源/页面的占位域名。

## 完成任务
1. ✅ WebApplication.url 集中动态化（BaseLayout 单点修复 47 个工具页）
   - 方案选型：放弃逐页修改 47 文件（超 8 文件红线 + 重复代码），改为 BaseLayout 集中后处理
   - 实现：在 BaseLayout 的 pageLd 归一化阶段，对 @type === 'WebApplication' 且 url 缺失或仍指向占位域名的对象，用 canonical（= new URL(Astro.url.pathname, SITE_URL)）覆盖
   - 边界：仅覆盖占位域名，已正确配置的页面（blog 已动态化）不受影响；未来工具页显式设置正确 url 也不会被误改
   - 1 处改动修复 47 个工具页，符合 DRY 原则与"避免不必要对象复制"（仅对有改动的对象展开新建）
2. ✅ robots.txt Sitemap URL 修复
   - `Sitemap: https://toolbox.example.com/sitemap-index.xml` → `https://website.niuzi.asia/sitemap-index.xml`
   - 影响：搜索引擎无法发现正确 sitemap，是上线后高优先级 SEO 阻塞
3. ✅ og-image.svg 分享图域名修复
   - 底部品牌域名 `toolbox.example.com` → `website.niuzi.asia`
   - 影响：社交分享时显示错误域名
4. ✅ about.astro 反馈邮箱域名修复
   - `feedback@toolbox.example.com` → `feedback@website.niuzi.asia`
5. ✅ privacy.astro 隐私邮箱域名修复
   - `privacy@toolbox.example.com` → `privacy@website.niuzi.asia`
6. ✅ QrTool.tsx 示例 URL 品牌一致性优化
   - QR 工具 URL 预设默认值 `https://toolbox.example.com/json` → `https://website.niuzi.asia/json`
7. ✅ 构建验证：258 页面构建通过，11.08s，无报错无警告
8. ✅ 产物抽检：
   - dist/uuid/index.html WebApplication.url = https://website.niuzi.asia/uuid ✅
   - dist/json/index.html 含 website.niuzi.asia/json ✅
   - dist/robots.txt Sitemap 指向 website.niuzi.asia ✅
   - dist 全量 grep toolbox.example.com：残留 9 个文件，全部为合理示例输入（jwt-sign 的 iss/aud 声明、2 篇博客示例、5 个 _astro 组件示例输入），非 SEO 问题
9. ✅ Git 提交：commit 0886cee，已 push origin HEAD（d7e78b8..0886cee）

## 修改文件（6 个，未超 8 文件红线）
- src/layouts/BaseLayout.astro（WebApplication.url 集中动态化，影响 47 个工具页）
- public/robots.txt（Sitemap URL 修复）
- public/og-image.svg（分享图品牌域名修复）
- src/pages/about.astro（反馈邮箱域名修复）
- src/pages/privacy.astro（隐私邮箱域名修复）
- src/components/QrTool.tsx（QR 示例 URL 品牌优化）

## 验证结果
- 构建：✅ 258 页面，11.08s，无报错无警告
- WebApplication.url 动态覆盖：uuid/json 页产物确认 url 已为 website.niuzi.asia 域 ✅
- 占位域名清理：robots.txt/og-image.svg/about/privacy/qr 全部修复 ✅
- 残留甄别：9 个文件的 toolbox.example.com 全部为工具示例输入（iss/aud 声明、博客示例、组件预设值），合理保留 ✅

## 数据洞察
- 线上抓取 WebFetch 超时（deadline elapsed），网络不稳定；阶段二数据驱动迭代暂无访问数据（site-config.md 的日访问量/流量来源/热门页面均待填写），本轮做启发式 SEO 优化，聚焦上线后立即可见的 SEO 阻塞问题
- 集中化 vs 批量修改决策：47 个工具页 WebApplication.url 硬编码，逐页改超 8 文件红线且重复；BaseLayout 单点覆盖是更优解——1 处改动全站生效，且回退安全（占位域名才覆盖，正确 url 不动）。代价是工具页源码中 url 字段仍写死占位域名（产物已正确），未来可脚本批量清理源码使源码与产物一致，但当前 SEO 价值已实现
- 静态资源（robots.txt/og-image.svg）不经 Astro 构建，无法用 SITE_URL 动态化，必须手动改为线上域名；这类资源是部署后易遗漏的 SEO 隐患，deployment-guide 应明确提示
- 邮箱使用 feedback@website.niuzi.asia / privacy@website.niuzi.asia（基于站点域名构造），用户未提供真实邮箱，此为品牌一致占位；上线后若需真实收件，用户需配置域名邮箱并在 about/privacy 替换

## 遗留问题
- 无（本轮所有任务完成且验收通过）
- 待用户操作：
  1. 部署更新后的代码到 Cloudflare Pages（git push 已触发，若已配置自动部署则自动生效）
  2. 若 feedback@website.niuzi.asia / privacy@website.niuzi.asia 需真实收件，请配置域名邮箱并回写 about.astro/privacy.astro
  3. 在 docs/site-config.md 填写访问数据（日访问量/流量来源/热门页面），接入统计工具后填写统计分析部分，agent 下轮可做数据驱动优化

## 下一轮建议
按优先级排序：
1. **deployment-guide.md 同步更新**：本轮修复后，部署清单的"4 项核心替换"中 ogImage/邮箱已改为线上域名，需更新清单状态（部分项已由 agent 完成）；同时新增"静态资源域名检查"提示项（robots.txt/og-image.svg 部署后需校验域名）。该文件已有未提交改动，需先确认其内容再合并提交
2. **Lighthouse 性能基线测量**：启动 preview 服务跑一次 Lighthouse，获取性能/SEO/可访问性/最佳实践四项基线分值（连续三轮遗留，阶段二应建立量化基准）
3. **移动端 375px 实测三档适配**：启动 preview 服务做 375/768/1280 三档设备抽检（连续三轮遗留）
4. **线上页面抓取校验**：WebFetch 超时，下轮可改用 curl 或多次重试抓取线上页面，校验渲染状态、canonical、JSON-LD 实际生效情况
5. **接入轻量统计工具**：建议接入 Umami/Plausible（可自托管或免费托管），为阶段二数据驱动迭代提供数据源；需用户确认部署方式
6. **47 工具页源码 url 字段批量清理（可选）**：产物已正确，源码清理仅为代码整洁度，可用脚本批量将工具页 `url: 'https://toolbox.example.com/xxx'` 改为动态构造或删除（BaseLayout 已兜底）

## 需用户操作
- 部署更新后的代码（git push 已完成，若 Cloudflare Pages 已配置 Git 自动部署则会自动触发）
- 在 docs/site-config.md 填写访问数据 + 接入统计工具后回写，agent 下轮进入数据驱动迭代
- （可选）配置域名邮箱并替换 about/privacy 中的占位邮箱为真实收件邮箱

---

# 第 2 轮 · bug-check 严重与高危 Bug 修复

## 上下文恢复
- 承接第 1 轮（占位域名清理，commit 0886cee）
- 触发点：工作树存在 docs/bug-check/bug-check-2026-07-10.md 报告（40 项 bug：1 严重 / 5 高危 / 13 中危 / 21 低危），尚未修复
- 阶段：阶段二（数据驱动迭代），站点已上线但无访问数据，本轮做安全/功能质量打磨

## 本轮聚焦方向
**bug-check 报告中的严重与高危 Bug 修复**（按规范任务优先级「功能可用性 > 性能体验 > SEO」，安全漏洞属功能可用性最高级）
- 先收尾上一轮遗留的未提交改动（样式优化 + 文档），再逐个修复 bug

## 完成任务

### 收尾上一轮遗留提交（3 个 commit）
1. ✅ commit 27f54bf style: 全站样式优化（global.css/index.astro/json.astro/blog/index.astro，4 文件 320+92）
2. ✅ commit 0be1063 docs: 更新 README 工具清单与部署指南路径（README.md/deployment-guide.md）
3. ✅ commit 00c8cce docs: 新增 bug 检查报告(40 项)、样式优化报告、站点配置与阶段二首轮进度

### Bug 修复（7 个文件，未超 8 文件红线）
1. ✅ BUG-01（严重·安全）JWT 验签算法白名单形同虚设
   - 文件：src/components/JwtVerifyTool.tsx
   - 问题：原 `expectedAlg = enforceAlgWhitelist ? detected.alg : undefined`，detected.alg 与 verifyJwt 内部 alg 都取自同一 token Header，恒相等，白名单永不触发失败分支，无法防御算法混淆攻击
   - 修复：移除无效复选框，改为「期望算法」下拉框，由用户明确指定期望算法（9 种：HS/RS/ES 系列，排除 none）。expectedAlg 来自用户选择（独立于 token），校验真正生效。none 算法已被 verifyJwt 独立拦截
2. ✅ BUG-05（高·功能错误）htmlFormatter preserveWhitespace 文本重复输出
   - 文件：src/utils/htmlFormatter.ts
   - 问题：`lines.push(indent + text.trim() + (opts.preserveWhitespace ? text : ''))`，preserveWhitespace=true 时输出 `text.trim() + text` 内容重复
   - 修复：改为 `const display = opts.preserveWhitespace ? text : text.trim(); lines.push(indent + display)`
3. ✅ BUG-06（高·代码规范）JsonToXmlTool/XmlToJsonTool JSX class→className
   - 文件：src/components/JsonToXmlTool.tsx、src/components/XmlToJsonTool.tsx
   - 修复：批量替换 class=→className=、for=→htmlFor=、spellcheck=→spellCheck=；顺带修复 BUG-40（3 处 `<option>` 补 key）
4. ✅ BUG-04（高·安全）JWE PBES2 p2c 无上限 DoS
   - 文件：src/utils/jwe.ts
   - 问题：p2c 迭代次数仅校验 >0 无上限，恶意 JWE 设超大 p2c 导致 PBKDF2 耗尽 CPU
   - 修复：增加上限 1000 万（PBES2_MAX_ITERATIONS，参考 RFC 7518 4.8.1.2），超限拒绝并返回明确错误
5. ✅ BUG-02（高·安全）JSON Schema pattern/patternProperties ReDoS
   - 文件：src/utils/jsonSchema.ts
   - 修复：pattern 与 patternProperties 执行前校验正则字符串长度≤1000、被匹配字符串长度≤100000，超限跳过并提示「以防 ReDoS」
6. ✅ BUG-03（高·安全）JSONPath =~ 正则匹配 ReDoS
   - 文件：src/utils/jsonPath.ts
   - 修复：`=~` 操作符执行前校验正则字符串长度≤1000、被匹配字符串长度≤100000，超限返回 false

## 修改文件（7 个）
- src/components/JwtVerifyTool.tsx（BUG-01 期望算法下拉框）
- src/utils/htmlFormatter.ts（BUG-05 文本重复输出）
- src/components/JsonToXmlTool.tsx（BUG-06 class→className + BUG-40 option key）
- src/components/XmlToJsonTool.tsx（BUG-06 class→className + BUG-40 option key）
- src/utils/jwe.ts（BUG-04 p2c 上限）
- src/utils/jsonSchema.ts（BUG-02 ReDoS 长度限制）
- src/utils/jsonPath.ts（BUG-03 ReDoS 长度限制）
- memory/20260710/topics.md（本文件，进度沉淀）

## 验证结果
- 构建：✅ 258 页面，13.42s，无报错无警告
- 产物抽检：
  - dist/_astro/JwtVerifyTool.Dj7bqKY4.js 含「期望算法校验/算法混淆攻击」文案 ✅
  - dist/_astro/JweTool.CAk2SZAW.js 含「PBES2_MAX_ITERATIONS/超过上限」✅
  - dist/_astro/jsonSchema.DowUwFnE.js 含「以防 ReDoS」✅
  - jsonPath 改动为纯逻辑（无文案），构建通过即编译生效 ✅

## 数据洞察
- BUG-01 修复策略：原设计「白名单 = token 自身 alg」是逻辑谬误（自证自验）。正确做法是让用户/调用方独立指定期望算法。本工具默认「不校验」（向后兼容），用户主动选择才有防御。none 算法已被 verifyJwt 第 536-557 行独立拦截，无需白名单覆盖
- ReDoS 修复策略选择：bug-check 建议「Web Worker 带超时」，但引入 Worker 增加复杂度与 bundle 体积（违反轻量化原则）。采用「输入长度双限」更轻量：正则≤1000 字符、被匹配串≤100KB，覆盖绝大多数正常用例，恶意超长输入直接跳过。这是「最小必要复杂度」的权衡
- 7 个 bug 修复跨 7 文件，每个文件改动聚焦单一 bug，互不耦合，符合「单次只完成一个最小单元」原则。一次性构建验证通过说明改动互不冲突

## 遗留问题
- 无（本轮所有任务完成且验收通过）
- bug-check 报告剩余未修复项（13 中危 + 21 低危），按优先级后续处理：
  - 中危待修：BUG-07（RSA/EC 私钥格式降级）、BUG-08（JweTool base64 解码崩溃）、BUG-09/10（JSONPath 解析错误）、BUG-11（RSA1_5 移除）、BUG-12（AES PBKDF2 迭代次数）、BUG-13/14（xmlToJson）、BUG-16/17（sql.ts 逻辑）、BUG-18（过度水合）、BUG-19（首页内联 script CSP）
  - 低危待修：BUG-20（@astrojs/check 依赖）、BUG-21~40（一致性/示例数据等）

## 下一轮建议
按优先级排序：
1. **中危 Bug 批量修复（第二轮）**：聚焦 BUG-07（私钥格式降级，影响 JWT 签名工具 RSA/EC 私钥导入）、BUG-08（JweTool 渲染崩溃）、BUG-09/10（JSONPath 解析错误，影响功能正确性）、BUG-16/17（sql.ts 逻辑错误），这 5 项均为功能正确性问题，用户可感知
2. **BUG-18 过度水合优化**：47 个工具页全用 client:load，非首屏辅助模块改 client:visible/client:idle，降低 TTI、提升性能分（连续三轮 Lighthouse 基线未做，水合优化后测量更有意义）
3. **Lighthouse 性能基线测量**：启动 preview 跑 Lighthouse，建立性能/SEO/可访问性/最佳实践四项基线（连续四轮遗留）
4. **移动端 375px 三档适配实测**：375/768/1280 抽检（连续四轮遗留）
5. **BUG-20 @astrojs/check 依赖补齐**：恢复 npm run check 类型检查能力，纳入构建流水
6. **线上页面抓取校验**：WebFetch 超时，改 curl 或重试抓取线上页面校验渲染/canonical/JSON-LD 实际生效

## 需用户操作
- 部署本轮修复后的代码（git push 已完成，若 Cloudflare Pages 已配置自动部署则自动触发）
- 在 docs/site-config.md 填写访问数据 + 接入统计工具后回写，agent 下轮进入数据驱动迭代
- （可选）配置域名邮箱并替换 about/privacy 中的占位邮箱

---

# 第 3 轮 · 中危功能 Bug 批量修复

## 上下文恢复
- 承接第 2 轮（bug-check 严重与高危修复，commit 59c0585）
- 触发点：bug-check 报告剩余 13 中危 + 21 低危，本轮聚焦中危中的功能正确性问题
- 阶段：阶段二（数据驱动迭代），站点已上线但无访问数据，本轮做功能质量打磨

## 本轮聚焦方向
**中危功能正确性 Bug 批量修复**（按规范任务优先级「功能可用性 > 性能体验 > SEO」）
选取 8 个功能正确性中危 Bug（BUG-07/08/09/10/13/14/16/17），涉及 5 个文件，不超 8 文件红线。

## 完成任务（8 个 Bug，5 个文件）

1. ✅ BUG-07（中·功能）RSA PKCS#1 / EC SEC1 格式私钥导入失败
   - 文件：src/utils/jwtSign.ts
   - 问题：importRsaPrivateKey / importEcPrivateKey 统一用 'pkcs8' 导入，但 PEM 头可能是 BEGIN RSA PRIVATE KEY（PKCS#1）或 BEGIN EC PRIVATE KEY（SEC1），Web Crypto API 对私钥仅支持 'pkcs8'/'jwk'
   - 修复：实现最小 ASN.1 DER 编码工具（encodeDerLength/derSequence/derOid/derOctetString），将 PKCS#1/SEC1 私钥 DER 包裹为 PKCS#8 容器（version(0) + AlgorithmIdentifier + OCTET STRING），再用现有 'pkcs8' 导入。RSA 算法 OID + NULL，EC 算法 OID + 曲线 OID（P-256/P-384/P-521）
   - 方案选型：放弃完整 ASN.1 解析器（过重），改用"包裹"策略——PKCS#1/SEC1 的 DER 本身就是 PKCS#8 中 privateKey 字段的内容，只需补外层容器即可，代码量约 80 行
2. ✅ BUG-08（中·稳定性）JweTool 渲染时 base64urlDecode 未捕获异常导致组件崩溃
   - 文件：src/components/JweTool.tsx
   - 问题：五段拆分表格第 576 行直接调用 base64urlDecode(value) 未加 try-catch，非法字符时 atob 抛 DOMException 导致整个组件渲染崩溃
   - 修复：包裹 try-catch，异常时返回空 Uint8Array；同时复用已解码 bytes 给 protected header 预览，避免重复解码
3. ✅ BUG-09（中·功能）JSONPath ..[expr] 递归下降后接括号解析错误
   - 文件：src/utils/jsonPath.ts
   - 问题：parseSegment 中 DOTDOT 后接 LBRACKET 时调用 parseBracket 消费整个 [...]，再 ctx.pos-- 仅回退到 RBRACKET，外层循环再次 parseSegment 时 peek 返回 RBRACKET 不匹配任何合法段，导致 $..[0] 等合法表达式解析失败
   - 修复：移除 parseBracket 调用和 ctx.pos-- 回退，直接返回 { kind: 'recursive', name: null }，让外层循环自然解析后续 [expr] 段
4. ✅ BUG-10（中·功能）JSONPath 多键 ['a','b'] 解析为永远不匹配的 placeholder
   - 文件：src/utils/jsonPath.ts
   - 问题：多键场景被简化为 filter 比较 root == '__MULTI_KEY_PLACEHOLDER__'，永远不匹配
   - 修复：扩展 Segment 类型新增 { kind: 'multi-child'; names: string[] }，parseBracket 多键时返回 multi-child，evaluateSegment 中用 flatMap 对每个 name 分别求值并合并结果
5. ✅ BUG-13（中·功能）xmlToJson coerceValue 不处理科学计数法
   - 文件：src/utils/xmlToJson.ts
   - 问题：类型推断仅检测整数和小数，不识别 1e10、6.022e23 等，保留为字符串
   - 修复：增加科学计数法正则 /^-?\d+(\.\d+)?[eE][+-]?\d+$/，用 Number() 转换并校验 Number.isFinite
6. ✅ BUG-14（中·稳定性）xmlToJson 递归解析无深度限制
   - 文件：src/utils/xmlToJson.ts
   - 问题：elementToJson 递归遍历 DOM 树无深度限制，恶意深度嵌套 XML 可导致调用栈溢出
   - 修复：定义 MAX_RECURSION_DEPTH=500 常量，elementToJson 入口检查 depth 超限抛错；xmlToJson 主函数用 try-catch 包裹 elementToJson 调用，捕获异常返回错误结果（不崩溃）
7. ✅ BUG-16（中·逻辑错误）sql.ts validateSql 双重否定导致逻辑错误
   - 文件：src/utils/sql.ts
   - 问题：条件 !upperSql.trim().endsWith(';') === false 是双重否定，等价于 endsWith(';') 为 true，导致"缺少 FROM"警告仅在 SQL 以分号结尾时触发，与预期相反
   - 修复：移除该条件，让所有缺少 FROM 的 SELECT 都接受检查（已有 length>30 和 !/\(/ 防误报）
8. ✅ BUG-17（中·功能）sql.ts formatSql 强制追加末尾分号可能改变语义
   - 文件：src/utils/sql.ts
   - 问题：return result + (result.endsWith(';') ? '' : ';') 在结果以行注释结尾时追加后变为 -- comment;，分号被注释吞掉改变 SQL 语义
   - 修复：检查最后一行是否含 --（行注释），若是则换行后加分号（result + '\n;'），否则直接加分号

## 修改文件（5 个，未超 8 文件红线）
- src/utils/jwtSign.ts（BUG-07 ASN.1 DER 编码工具 + PKCS#1/SEC1 私钥格式降级）
- src/components/JweTool.tsx（BUG-08 base64urlDecode 异常捕获）
- src/utils/jsonPath.ts（BUG-09 递归下降括号解析 + BUG-10 multi-child 多键支持）
- src/utils/sql.ts（BUG-16 双重否定逻辑 + BUG-17 分号追加语义）
- src/utils/xmlToJson.ts（BUG-13 科学计数法 + BUG-14 递归深度限制）

## 验证结果
- 构建：✅ 258 页面，11.44s，无报错无警告
- 产物抽检：
  - dist/_astro/jwtSign.Byx_VpJw.js 含 BEGIN RSA PRIVATE KEY / BEGIN EC PRIVATE KEY 检测 ✅
  - dist/_astro/JsonPathTool.BIjMDI88.js 含 multi-child ✅
  - dist/_astro/XmlToJsonTool.BrEvji3O.js 含 MAX_RECURSION_DEPTH / 科学计数法 ✅
  - BUG-16/17 为纯逻辑修复，构建通过即编译生效 ✅

## 数据洞察
- BUG-07 修复策略：Web Crypto API 对私钥仅支持 'pkcs8'/'jwk'，不支持 'pkcs1'/'sec1'。bug 报告建议"先 pkcs8 失败再 pkcs1"，但 pkcs1 私钥导入会直接抛 DataError。正确方案是"包裹"——PKCS#1/SEC1 的 DER 本身就是 PKCS#8 中 privateKey 字段的内容，只需补 version + AlgorithmIdentifier + OCTET STRING 外层容器即可。比"解析 PKCS#1 提取字段构造 JWK"更轻量（无需完整 ASN.1 解析器，只需编码器）
- BUG-09 修复本质：原代码过度处理——parseBracket 消费了 [...] 后又 ctx.pos-- 回退，但回退位置错误（到 RBRACKET 而非 LBRACKET）。正确做法是不消费 LBRACKET，直接返回 recursive(null)，让外层循环自然解析。这是"最小必要复杂度"的体现
- BUG-10 修复策略：原代码用 filter + placeholder 是"伪实现"（永远不匹配）。正确做法是扩展 Segment 类型新增 multi-child，求值时 flatMap 合并。flatMap 比手动 push 循环更简洁
- BUG-17 行注释检测：用 result.split('\n').pop() 取最后一行，检查是否含 '--'。边界：字符串字面量中的 '--' 会误判，但 SQL 格式化场景可接受（罕见且不影响正确性，只是多加换行）

## 遗留问题
- 无（本轮所有任务完成且验收通过）
- bug-check 报告剩余未修复项：
  - 中危待修：BUG-11（JWE RSA1_5 移除）、BUG-12（AES PBKDF2 迭代次数提升）、BUG-15（htmlFormatter ReDoS）、BUG-18（过度水合 client:load→visible）、BUG-19（首页内联 script CSP）
  - 低危待修：BUG-20（@astrojs/check 依赖）、BUG-21~40（一致性/示例数据等）

## 下一轮建议
按优先级排序：
1. **剩余中危安全 Bug 修复**：BUG-11（JWE RSA1_5 Bleichenbacher 风险，移除默认支持）、BUG-12（AES PBKDF2 默认迭代次数提升至 600000）、BUG-15（htmlFormatter 重复属性检测 ReDoS，改 DOM 遍历）—— 3 项安全类，优先级高
2. **BUG-18 过度水合优化**：47 个工具页全用 client:load，非首屏辅助模块改 client:visible/client:idle，降低 TTI。水合优化后 Lighthouse 测量更有意义
3. **Lighthouse 性能基线测量**：启动 preview 跑 Lighthouse，建立四项基线（连续五轮遗留）
4. **移动端 375px 三档适配实测**：375/768/1280 抽检（连续五轮遗留）
5. **BUG-20 @astrojs/check 依赖补齐**：恢复类型检查能力
6. **低危 Bug 批量修复**：BUG-21~40 中的一致性问题（如 BUG-21 JwtTool 截断、BUG-23/24 JSONPath 宽松比较、BUG-34 博客内链占位域名等）

## 需用户操作
- 部署本轮修复后的代码（git push 已完成，若 Cloudflare Pages 已配置自动部署则自动触发）
- 在 docs/site-config.md 填写访问数据 + 接入统计工具后回写，agent 下轮进入数据驱动迭代

---

# 第 4 轮 · 剩余中危安全 Bug 修复 + BUG-18 架构分析

## 上下文恢复
- 承接第 3 轮（中危功能 Bug 批量修复，commit 52460b3）
- 触发点：bug-check 报告剩余中危安全类 Bug（BUG-11/12/15/18/19），本轮聚焦安全类优先
- 阶段：阶段二（数据驱动迭代），站点已上线但无访问数据，本轮做安全质量打磨

## 本轮聚焦方向
**剩余中危安全 Bug 修复**（按规范任务优先级「功能可用性 > 性能体验 > SEO」，安全属功能可用性最高级）
选取 3 个安全类中危 Bug（BUG-11/12/15），涉及 5 个文件，不超 8 文件红线。同步完成 BUG-18 架构分析（结论：当前架构不适用，无需改动）。

## 完成任务

### Bug 修复（3 个，5 个文件）
1. ✅ BUG-11（中·安全）JWE 支持 RSA1_5 算法，存在 Bleichenbacher 攻击风险
   - 文件：src/utils/jwe.ts、src/components/JweTool.tsx
   - 问题：SUPPORTED_DECRYPT_ALGS 包含 RSA1_5（PKCS#1 v1.5），攻击者可通过错误响应差异推断明文
   - 修复：
     - 从 SUPPORTED_DECRYPT_ALGS 数组移除 'RSA1_5'
     - 在 decryptJwe 入口（SUPPORTED_DECRYPT_ALGS 检查前）加 RSA1_5 专项拦截，返回明确安全警告并提示使用 RSA-OAEP 替代
     - 清理第 624-653 行 RSA1_5 死代码分支：条件从 `alg.startsWith('RSA-OAEP') || alg === 'RSA1_5'` 简化为 `alg.startsWith('RSA-OAEP')`，移除所有 `alg === 'RSA1_5' ? ... : ...` 三元运算
     - JweTool.tsx 第 736 行支持算法文案更新：从列表移除 RSA1_5，追加"RSA1_5 已因安全风险移除"说明
   - 方案选型：选择"拒绝解密 + 安全警告"而非"增加二次确认"，因为 RSA1_5 在现代实践中已不推荐，直接拒绝更安全且用户体验更清晰
2. ✅ BUG-12（中·安全）AES PBKDF2 默认迭代次数低于 OWASP 建议
   - 文件：src/utils/aes.ts、src/components/AesTool.tsx
   - 问题：DEFAULT_ITERATIONS = 100000，注释自承"OWASP 2023 建议 ≥ 600000 次 SHA-256"，deriveKey 下限仅 1000
   - 修复：
     - DEFAULT_ITERATIONS 100000 → 600000（对齐 OWASP 2023 建议）
     - deriveKey 下限校验 1000 → 10000（避免过低迭代次数）
     - 错误提示文案"建议至少 100000 次"→"建议至少 600000 次"
     - AesTool.tsx UI input min={1000}→min={10000}，onChange Math.max(1000,...)→Math.max(10000,...)
     - 注释更新：移除"兼顾安全与性能"表述，直接对齐 OWASP 建议
3. ✅ BUG-15（中·性能）htmlFormatter 重复属性检测正则潜在 ReDoS
   - 文件：src/utils/htmlFormatter.ts
   - 问题：原正则 `/<(\w+)([^>]*?)\s(\w+)\s*=\s*["'][^"']*["']([^>]*?)\s\3\s*=/g` 含两个 `[^>]*?` 非贪婪段与反向引用 `\3`，对含大量属性的标签可能 O(n²) 回溯
   - 修复：改为逐标签提取属性名 + Set 检测方案
     - 外层正则 `<(\w+)([^>]*)>/g` 匹配每个开始标签（`[^>]*` 贪婪但不会跨标签，因为 > 是终止符）
     - 内层正则 `\s(\w+)\s*=/g` 从标签属性段提取所有属性名
     - 用 Set 检测重复，每个标签只报告一次（break 避免冗余报告）
   - 方案选型：bug-check 建议"改 DOM 遍历检测 element.attributes"，但 DOMParser 解析时浏览器已自动只保留第一个同名属性，DOM 遍历无法检测到重复。因此改用"逐标签正则 + Set"方案，既避免回溯型 ReDoS，又能正确检测重复属性

### BUG-18 架构分析（结论：当前架构不适用，无需改动）
- bug-check 报告 BUG-18 建议"非首屏辅助模块（FAQ、速查表、XSS 演示）应延迟水合，改 client:visible/idle"
- 分析：全站 grep `client:(load|visible|idle|only|media)` 发现 47 个工具页各只有 **1 个** `client:load` 岛屿——即核心工具组件本身
- FAQ 和说明内容均为 Astro 静态 HTML（`<section class="xxx-faq">` 等 `<details>` 元素），不是 React 岛屿，无需水合，不消耗 JS
- 结论：当前架构下没有可分离的辅助岛屿，`client:load` 对首屏即需交互的工具组件是合理的。批量修改 47 文件超 8 文件红线且收益为零。若未来将 FAQ 拆分为独立 React 岛屿，可再评估 client:visible

## 修改文件（5 个，未超 8 文件红线）
- src/utils/jwe.ts（BUG-11 RSA1_5 移除 + 死代码清理）
- src/components/JweTool.tsx（BUG-11 支持算法文案更新）
- src/utils/aes.ts（BUG-12 默认迭代次数 + 下限提升）
- src/components/AesTool.tsx（BUG-12 UI min/onChange 同步）
- src/utils/htmlFormatter.ts（BUG-15 重复属性检测 ReDoS 修复）

## 验证结果
- 构建：✅ 258 页面，11.66s，无报错无警告
- 产物抽检：
  - dist/_astro/JweTool.*.js 含 Bleichenbacher 安全警告文案 ✅
  - dist/_astro/AesTool.*.js 含 600000 ✅
  - dist/_astro/HtmlFormatterTool.*.js 含新的"重复属性"检测逻辑 ✅
- Git 提交：commit d40005d，已 push origin HEAD（52460b3..d40005d）

## 数据洞察
- BUG-11 修复策略选择：bug-check 建议"移除或增加二次确认"。选择"直接拒绝 + 安全警告"而非"二次确认"，因为 RSA1_5 在现代实践中已不推荐（RFC 7518 已将其标记为不推荐使用），二次确认会给用户带来安全风险。同时清理了 RSA1_5 相关的死代码分支（前置拦截后不会走到），避免代码冗余
- BUG-15 修复策略：bug-check 建议"改 DOM 遍历检测 element.attributes"，但经分析发现 DOMParser 解析时会自动只保留第一个同名属性，DOM 遍历无法检测到重复属性。因此改用"逐标签正则 + Set"方案——外层正则匹配标签（不跨标签边界），内层正则提取属性名，Set 检测重复。既避免了回溯型 ReDoS，又保留了检测能力。这是"正确理解技术约束后选择最小必要方案"的体现
- BUG-18 分析结论：bug-check 报告的"非首屏辅助模块延迟水合"建议基于假设工具页有多个 React 岛屿，但实际审查发现每个工具页只有 1 个核心岛屿（首屏即需交互），FAQ 等辅助内容是静态 HTML。这说明 bug-check 报告的部分建议需要结合实际架构验证后才能采纳，不能盲目执行
- BUG-12 迭代次数提升：从 100000 → 600000 对齐 OWASP 2023 建议。性能影响：PBKDF2 派生时间约从 50ms 增至 300ms（SHA-256），在可接受范围内。下限从 1000 → 10000 避免用户手动设置过低值导致安全降级

## 遗留问题
- 无（本轮所有任务完成且验收通过）
- bug-check 报告剩余未修复项：
  - 中危待修：BUG-18（已分析，当前架构不适用，标记为无需改动）、BUG-19（首页内联 script CSP）
  - 低危待修：BUG-20（@astrojs/check 依赖）、BUG-21~40（一致性/示例数据等）

## 下一轮建议
按优先级排序：
1. **BUG-19 首页内联 script CSP 优化**：首页搜索与筛选用原生内联 `<script>` 实现，严格 CSP 下需 nonce 或 hash。可为内联 script 添加 `is:inline` 与 nonce，或迁移到 React 岛屿
2. **Lighthouse 性能基线测量**：启动 preview 跑 Lighthouse，建立性能/SEO/可访问性/最佳实践四项基线（连续六轮遗留，安全 Bug 修复完后应优先执行）
3. **移动端 375px 三档适配实测**：375/768/1280 抽检（连续六轮遗留）
4. **BUG-20 @astrojs/check 依赖补齐**：恢复类型检查能力，纳入构建流水
5. **低危 Bug 批量修复**：BUG-21~40 中的一致性问题（BUG-21 JwtTool 截断、BUG-23/24 JSONPath 宽松比较、BUG-34 博客内链占位域名、BUG-37 示例数据占位域名等）
6. **线上页面抓取校验**：WebFetch 超时，改 curl 或重试抓取线上页面校验渲染/canonical/JSON-LD 实际生效

## 需用户操作
- 部署本轮修复后的代码（git push 已完成，若 Cloudflare Pages 已配置自动部署则自动触发）
- 在 docs/site-config.md 填写访问数据 + 接入统计工具后回写，agent 下轮进入数据驱动迭代

---

# 第 5 轮 · 低危 Bug 批量修复 + 类型检查依赖补齐

## 上下文恢复
- 承接第 4 轮（剩余中危安全 Bug 修复，commit d40005d）
- 触发点：bug-check 报告剩余低危 Bug（BUG-20~40），本轮聚焦低危中影响功能正确性与一致性的项
- 阶段：阶段二（数据驱动迭代），站点已上线但无访问数据，本轮做代码质量打磨

## 本轮聚焦方向
**低危 Bug 批量修复 + 类型检查能力恢复**（按规范任务优先级，低危 Bug 影响代码质量与用户体验一致性）
选取 6 个低危 Bug（BUG-23/24/29/31/33/34）涉及 5 个文件，同步补齐 @astrojs/check 依赖（BUG-20）并完成 BUG-19 架构分析。

## 完成任务

### Bug 修复（6 个，5 个文件）
1. ✅ BUG-29（低·功能）jsFormatter 未识别 ES2022 hasIndices(d) 正则标志
   - 文件：src/utils/jsFormatter.ts
   - 问题：正则标志字符校验 `/[gimsuy]/` 缺少 `d`，ES2022 的 `hasIndices` 标志会被截断导致格式化错误
   - 修复：正则字符类补全 `d` → `/[gimsuyd]/`
2. ✅ BUG-31（低·安全）IPv4 校验 parseInt 隐式解析陷阱
   - 文件：src/utils/ip.ts
   - 问题：`parseInt(n, 10)` 对 `"0x1f"` 返回 0（遇非数字字符停止解析），导致 `0.0x1f.0.0` 等非法 IP 被误判合法
   - 修复：改为 `/^\d+$/.test(n) ? parseInt(n, 10) : NaN`，先校验纯数字再解析
3. ✅ BUG-33（低·数据）lorem 日期年份上限硬编码 2025
   - 文件：src/utils/lorem.ts
   - 问题：`randomIntRange(2000, 2025)` 年份上限固定，2026 年后生成的日期永远是历史日期
   - 修复：上限改为 `new Date().getFullYear()` 动态当前年份
4. ✅ BUG-23/24（低·功能）JSONPath 宽松相等与数值比较错误
   - 文件：src/utils/jsonPath.ts
   - 问题：`==` 过滤用严格相等 `===`，无法匹配 `1 == "1"`；`>` `<` 等数值比较直接用 `>` 运算符，字符串数字 `"10" > "9"` 按字典序返回 false
   - 修复：新增 3 个辅助函数：
     - `toNumber(value)`：空字符串与非数字字符串返回 NaN
     - `looseEquals(a, b)`：数字与字符串数字按数值比较，null/undefined 互通，其余严格相等（避免 `false == 0` 等非预期匹配）
     - `compareNumeric(a, b)`：返回 -1/0/1，非数字场景返回 0 表示无法比较
5. ✅ BUG-34（低·SEO）color-format-guide 博客占位域名内链
   - 文件：src/content/blog/color-format-guide.md
   - 问题：第 160 行 `[配套工具的源码](https://toolbox.example.com/color)` 指向占位域名，影响内链与用户跳转
   - 修复：改为相对路径 `[配套工具的源码](/color)`

### 依赖补齐（1 项）
6. ✅ BUG-20 @astrojs/check 开发依赖补齐
   - 安装 `@astrojs/check@^0.9.4`（devDependencies），恢复 `npm run check` 类型检查能力
   - 运行 check 后揭示 53 个 TS 5.7 类型错误，主要为 `Uint8Array<ArrayBufferLike>` 与 `BufferSource` 类型不兼容（运行时无影响），记录为下轮专题

### BUG-19 架构分析（结论：当前架构合理，无需改动）
- bug-check 报告 BUG-19 建议"首页内联 script 在严格 CSP 下需 nonce/hash"
- 分析：Astro 5 对无 import 的小脚本自动内联为 `<script type="module">`，是性能优化
- Grep 验证 dist/index.html 无任何 `_astro/*.js` 外部引用，首页 0 外部 JS、0 React 水合
- 当前 Cloudflare Pages 默认无 CSP header，内联 script 正常执行
- 决策：当前架构合理，迁移 React 岛屿会引入 ~44KB client.js 水合成本，得不偿失。标记为"未来启用 CSP 时用 Astro csp 配置处理"

### 环境维护（1 项）
7. ✅ .gitignore 新增 lighthouse 报告产物忽略规则
   - 新增 `lighthouse-*.report.*` 忽略规则，避免 Lighthouse CLI 产生的临时报告文件污染工作区

## 修改文件（8 个，未超 8 文件红线）
- src/utils/jsFormatter.ts（BUG-29 d 标志补全）
- src/utils/ip.ts（BUG-31 IPv4 纯数字校验）
- src/utils/lorem.ts（BUG-33 年份动态化）
- src/utils/jsonPath.ts（BUG-23/24 宽松相等与数值比较）
- src/content/blog/color-format-guide.md（BUG-34 占位域名内链修复）
- package.json（@astrojs/check 依赖）
- package-lock.json（依赖锁定）
- .gitignore（lighthouse 报告忽略规则）

## 验证结果
- 构建：✅ 258 页面，14.41s，无报错无警告
- 产物抽检：
  - dist/blog/color-format-guide/index.html 含 4 处 `/color` 相对链接 ✅
  - 5 个工具函数修复为纯逻辑，构建通过即编译生效 ✅
- 类型检查：npm run check 揭示 53 个 TS 5.7 类型错误（Web Crypto BufferSource 类型技术债，运行时无影响），记录为下轮专题
- Git 提交：commit ac9f347，已 push origin HEAD（d8642b7..ac9f347）

## 数据洞察
- BUG-31 parseInt 陷阱：JavaScript 的 `parseInt("0x1f", 10)` 返回 0（遇 x 停止解析），`parseInt("  12abc", 10)` 返回 12（遇非数字字符停止）。这类隐式解析在 IP/数字校验场景是常见安全漏洞，正确做法是先用正则校验纯数字再 parseInt。同类问题可能在其他工具存在，下轮可全站排查
- BUG-23/24 JSONPath 宽松比较：RFC 9535 JSONPath 过滤表达式的 `==` 应支持数字与字符串数字的宽松匹配（如 `$[?(@.age=="30")]` 匹配 age=30）。原实现用 `===` 严格相等导致功能缺失。修复策略是区分"数字与字符串数字"（按数值比较）与"其他类型组合"（严格相等），避免 `false == 0`、`"" == 0` 等非预期匹配
- BUG-19 架构判断：bug-check 报告的部分建议需结合实际架构验证。首页内联 script 是 Astro 的性能优化（无 import 的小脚本自动内联），当前无 CSP header 时正常执行。迁移到 React 岛屿会引入水合成本，得不偿失。这说明"安全建议"需权衡实际收益与代价
- @astrojs/check 揭示的 53 个类型错误：主要是 TS 5.7 对 `Uint8Array<ArrayBufferLike>` 的类型细化，与 Web Crypto API 的 `BufferSource` 类型不兼容。这是 TypeScript 类型系统的技术债，运行时无影响（Uint8Array 就是 BufferSource），但影响代码质量分。下轮专题处理

## 环境限制说明
- **Lighthouse CLI 受限**：`npx lighthouse` 被 TRAE Sandbox 拦截，不允许写 `C:\Users\Lenovo\.config\configstore\lighthouse.json.tmp`，连续七轮无法建立性能基线
- **Playwright 受限**：Python 3.6 太老（需 3.8+），`py -3.12 -m pip install playwright` 被 TRAE Sandbox 拦截，不允许写 site-packages，连续七轮无法做移动端三档实测
- **降级方案**：用 dist 产物静态检查 SEO 要素 + 检查 global.css 响应式断点（3 个断点：dark/768px/reduced-motion）

## 遗留问题
- 无（本轮所有任务完成且验收通过）
- bug-check 报告剩余未修复项（14 个低危）：
  - BUG-21（JwtTool 截断显示）、BUG-22（JwtTool 时间格式）、BUG-25/26/27/28（各类一致性）、BUG-30（ip 工具示例）、BUG-32（lorem 边界）、BUG-35/36/37/38/39/40（示例数据与文案一致性）
- 53 个 TS 5.7 类型错误（Web Crypto BufferSource 类型技术债）

## 下一轮建议
按优先级排序：
1. **Web Crypto BufferSource 类型修复专题**：53 个 TS 错误主要为 `Uint8Array<ArrayBufferLike>` 与 `BufferSource` 不兼容。可用类型断言封装工具函数（如 `as BufferSource`）或升级 @types/node，恢复 npm run check 零错误
2. **jwtVerify.ts PKCS#1 公钥 ASN.1 SPKI 包裹**：第 240 行 `'pkcs1'` 是真运行时问题（Web Crypto 不支持该格式公钥导入），需类似第 4 轮 BUG-07 的 ASN.1 包裹方案，将 PKCS#1 公钥包裹为 SPKI 容器
3. **Lighthouse 基线 + 移动端三档实测**：连续七轮遗留，需用户配置 TRAE Sandbox 白名单或换环境执行
4. **剩余低危 Bug 批量修复**：BUG-21/22/25/26/27/28/30/32/35/36/37/38/39/40，多为一致性问题，可批量处理
5. **线上页面抓取校验**：WebFetch 超时，改 curl 或重试抓取线上页面校验渲染/canonical/JSON-LD 实际生效

## 需用户操作
- 部署本轮修复后的代码（git push 已完成，若 Cloudflare Pages 已配置自动部署则自动触发）
- 在 docs/site-config.md 填写访问数据 + 接入统计工具后回写，agent 下轮进入数据驱动迭代
- （可选）配置 TRAE Sandbox 白名单允许 Lighthouse/Playwright 写入临时目录，以建立性能基线

---

# 第 6 轮 · jwtVerify PKCS#1 公钥导入 Bug 修复 + Web Crypto BufferSource 类型债务消除

## 上下文恢复
- 承接第 5 轮（低危 Bug 批量修复 + 类型检查依赖补齐，commit ac9f347）
- 触发点：第 5 轮 @astrojs/check 补齐后揭示 53 个 TS 5.7 类型错误，其中 30 个为 BufferSource 类型不兼容；第 5 轮遗留建议优先级 2「jwtVerify.ts PKCS#1 公钥 ASN.1 SPKI 包裹」为真实运行时 Bug
- 阶段：阶段二（数据驱动迭代），站点已上线但无访问数据，本轮做功能正确性与代码质量打磨

## 本轮聚焦方向
**两个独立但文件交叉的最小单元合并提交**（文件交叉无法干净分拆）：
1. jwtVerify.ts PKCS#1 公钥导入真实运行时 Bug 修复（功能正确性最高级）
2. Web Crypto BufferSource 类型债务消除（代码质量，影响 npm run check 通过率）

## 完成任务

### 单元 1：jwtVerify PKCS#1 公钥导入 Bug 修复（2 个文件）
1. ✅ BUG（真运行时）jwtVerify.ts 第 240 行 `importRsaPublicKey` 的 `'pkcs1'` 回退分支恒抛 NotSupportedError
   - 问题根因：Web Crypto API 的 `crypto.subtle.importKey` 仅支持 `'spki'/'pkcs8'/'raw'/'jwk'` 四种格式，**不支持 `'pkcs1'/'sec1'`**。原代码 catch SPKI 失败后回退 `'pkcs1'` 必然抛 NotSupportedError，导致 PEM 标签为 `BEGIN RSA PUBLIC KEY`（PKCS#1 格式）的 RSA 公钥永远无法用于 JWT 验签
   - 修复：在 [jwtSign.ts](file:///e:/work/auto-website/src/utils/jwtSign.ts) 新增两个 ASN.1 DER 编码函数：
     - `derBitString(content)`：构造 DER BIT STRING（tag 0x03 + 长度 + 0x00 未使用位数 + 内容）
     - `wrapRsaPublicKeyToSpki(pkcs1PubDer)`：将 PKCS#1 RSA 公钥 DER 包裹为 SPKI(SubjectPublicKeyInfo) 容器，结构 `SEQUENCE { AlgorithmIdentifier(RSA), BIT STRING subjectPublicKey }`，subjectPublicKey 即 PKCS#1 的 RSAPublicKey DER
   - 在 [jwtVerify.ts](file:///e:/work/auto-website/src/utils/jwtVerify.ts) 重写 `importRsaPublicKey`：通过正则 `/-----BEGIN RSA PUBLIC KEY-----/` 区分 PKCS#1 与 SPKI 标签，PKCS#1 公钥先 `wrapRsaPublicKeyToSpki` 包裹再以 `'spki'` 格式导入
   - 复用第 3 轮 BUG-07 私钥包裹的 ASN.1 编码工具（`encodeDerLength`/`derSequence`/`derOid`），SPKI 用 BIT STRING，PKCS#8 用 OCTET STRING，差异在包裹函数中各自处理
   - 运行时验证：临时脚本 `tmp-pkcs1-test.mjs` 端到端验证 4/4 通过（生成密钥对→签名→PKCS#1 PEM 导出→SPKI 包裹→'spki' 导入成功→验签成功；对照组直接 `'pkcs1'` 导入确认失败），验证后删除临时文件

### 单元 2：Web Crypto BufferSource 类型债务消除（4 个文件）
2. ✅ TypeScript 5.7 `Uint8Array<ArrayBufferLike>` 与 `BufferSource` 类型不兼容
   - 问题根因：TS 5.7 将 `Uint8Array` 类型注解细化为 `Uint8Array<ArrayBufferLike>`，其中 `ArrayBufferLike` 联合类型包含 `SharedArrayBuffer`，而 Web Crypto API 的 `BufferSource` 仅接受 `ArrayBuffer` 后端的 `TypedArray`。导致所有 `importKey('raw', bytes, ...)`、`encrypt(algo, key, data)` 等 Web Crypto 调用点的 `Uint8Array` 实参类型不匹配
   - 修复策略：根因修复（生产者收窄）而非调用点断言。在 [jwtSign.ts](file:///e:/work/auto-website/src/utils/jwtSign.ts)、[jwtVerify.ts](file:///e:/work/auto-website/src/utils/jwtVerify.ts)、[jwe.ts](file:///e:/work/auto-website/src/utils/jwe.ts)、[aes.ts](file:///e:/work/auto-website/src/utils/aes.ts) 四个文件中，用 `replace_all` 将源端函数返回类型 `): Uint8Array {` → `): Uint8Array<ArrayBuffer> {`、局部变量注解 `: Uint8Array;` → `: Uint8Array<ArrayBuffer>;`。从生产者根因处传播修正，自动惠及所有下游调用点
   - 结果：30 个 BufferSource 类型错误全部消除（52→22），剩余 22 项均为预存在非 BufferSource 问题（JweTool `never`、MarkdownTool 八进制转义、TomlSchemaTool `unknown`、hex.astro JSX 逗号运算符、index.astro HTMLElement.value、colorPalette rgb 属性），与本轮改动无关
   - 运行时无影响：`Uint8Array` 实例本身就是合法 `BufferSource`，类型收窄只是让 TypeScript 理解这一点

## 修改文件（4 个，未超 8 文件红线）
- [src/utils/jwtSign.ts](file:///e:/work/auto-website/src/utils/jwtSign.ts)（新增 `derBitString` + 导出 `wrapRsaPublicKeyToSpki`，更新 ASN.1 章节注释「用于密钥格式转换」，4 处 `Uint8Array` → `Uint8Array<ArrayBuffer>` 收窄）
- [src/utils/jwtVerify.ts](file:///e:/work/auto-website/src/utils/jwtVerify.ts)（重写 `importRsaPublicKey` PEM 处理：标签正则区分 + PKCS#1 包裹为 SPKI 导入，移除必失败的 `'pkcs1'` 回退；类型收窄）
- [src/utils/jwe.ts](file:///e:/work/auto-website/src/utils/jwe.ts)（`Uint8Array` 返回类型与局部变量收窄，含 `concatKdf` 的 `Promise<Uint8Array<ArrayBuffer>>`）
- [src/utils/aes.ts](file:///e:/work/auto-website/src/utils/aes.ts)（`Uint8Array` 返回类型与局部变量收窄，含 `parseKeyBytes`、`importAesKey` 签名）

## 验证结果
- 构建：✅ 258 页面，无报错无警告
- 类型检查：✅ 53 → 22（30 个 BufferSource 错误全消除，零回归）
- 产物抽检：✅ `Select-String -Path dist/_astro/JwtVerifyTool*.js -Pattern "'pkcs1'" -SimpleMatch` 返回 0（原必失败的 `'pkcs1'` 回退已从产物中移除）
- 运行时验证：✅ 临时脚本 4/4 检查通过（生成密钥→签名→PKCS#1 导出→SPKI 包裹→'spki' 导入→验签成功；对照组 `'pkcs1'` 直接导入确认失败）
- Git 提交：commit 61b356a，已 push origin HEAD（21d270b..61b356a）

## 数据洞察
- **PKCS#1 公钥导入 Bug 根因**：Web Crypto API 设计上只支持标准容器格式（SPKI/PKCS#8/JWK/raw），不支持裸算法格式（PKCS#1/SEC1）。这是因为浏览器倾向于"标准格式优先"以减少解析歧义。修复策略是"包裹"而非"解析"——PKCS#1 的 RSAPublicKey DER 本身就是 SPKI 中 subjectPublicKey 字段的内容，只需补 AlgorithmIdentifier + BIT STRING 外层容器即可。这与第 3 轮 BUG-07 私钥包裹思路一致，差异仅在容器字段：SPKI 用 BIT STRING（公钥），PKCS#8 用 OCTET STRING（私钥）
- **类型债务根因修复 vs 调用点断言**：TS 5.7 的 `Uint8Array<ArrayBufferLike>` 细化是类型系统的进步（区分 ArrayBuffer 与 SharedArrayBuffer 后端），但与既有 Web API 类型定义不兼容。若在 52 个调用点逐一 `as BufferSource` 断言，会掩盖真实类型关系且代码冗余。选择在生产者根因处收窄为 `Uint8Array<ArrayBuffer>`，让类型沿调用链自然传播——这是"最小必要复杂度"的体现：1 处改动惠及所有下游，且语义正确（这些工具函数确实只产出 ArrayBuffer 后端的 Uint8Array）
- **文件交叉合并提交决策**：两单元虽逻辑独立，但 jwtSign.ts 与 jwtVerify.ts 同时承载两单元改动（jwtSign 新增 `wrapRsaPublicKeyToSpki` 用于 Bug 修复 + 类型收窄用于债务消除）。强行分拆会引入"中间态类型错误"或"中间态未使用导入"，违反"每次提交保持可工作"原则。合并为一次 fix: 提交更合适（主价值是 Bug 修复，类型债务是同源同文件的代码质量提升）

## 遗留问题
- 无（本轮所有任务完成且验收通过）
- 剩余 22 个预存在 TS 类型错误（独立单元，与本轮改动无关）：
  - [JweTool.tsx](file:///e:/work/auto-website/src/components/JweTool.tsx#L46-L50)：5 处 `never` 错误（`keyof ParsedJwe['parts']` 中 `parts?` 可选导致）
  - [MarkdownTool.tsx](file:///e:/work/auto-website/src/components/MarkdownTool.tsx#L177)：八进制转义错误
  - [TomlSchemaTool.tsx](file:///e:/work/auto-website/src/components/TomlSchemaTool.tsx#L179-L180)：`unknown` 类型错误
  - [hex.astro](file:///e:/work/auto-website/src/pages/hex.astro#L51)：JSX 逗号运算符错误
  - [index.astro](file:///e:/work/auto-website/src/pages/index.astro#L597)：HTMLElement.value/Element.style 错误
  - [colorPalette.ts](file:///e:/work/auto-website/src/utils/colorPalette.ts#L420)：`rgb` 属性错误

## 下一轮建议
按优先级排序：
1. **剩余 22 个预存在 TS 类型错误批量修复**：按文件分批处理，每批 ≤8 文件红线。JweTool.tsx 的 `never` 错误需修复 `ParsedJwe['parts']` 可选类型问题（加非空断言或类型守卫）；hex.astro/index.astro 的 JSX 与 DOM 类型错误需调整类型注解或加类型守卫；TomlSchemaTool/MarkdownTool/colorPalette 为局部修复
2. **Lighthouse 性能基线测量**：连续八轮遗留，TRAE Sandbox 拦截 configstore 写入。需用户配置白名单或换环境执行
3. **移动端 375px 三档适配实测**：连续八轮遗留，Playwright 受 Python 3.6 限制
4. **剩余低危 Bug 批量修复**：BUG-21/22/25/26/27/28/30/32/35/36/37/38/39/40，多为一致性问题
5. **线上页面抓取校验**：WebFetch 超时，改 curl 或重试抓取线上页面校验渲染/canonical/JSON-LD 实际生效
6. **接入轻量统计工具**：Umami/Plausible 为阶段二数据驱动迭代提供数据源

## 需用户操作
- 部署本轮修复后的代码（git push 已完成，若 Cloudflare Pages 已配置自动部署则自动触发）
- 在 docs/site-config.md 填写访问数据 + 接入统计工具后回写，agent 下轮进入数据驱动迭代
- （可选）配置 TRAE Sandbox 白名单允许 Lighthouse/Playwright 写入临时目录，以建立性能基线

---

# 第 7 轮 · 预存在 TypeScript 类型错误清零 + 临时诊断文件清理

## 上下文恢复
- 承接第 6 轮（jwtVerify PKCS#1 公钥导入 Bug 修复 + BufferSource 类型债务消除，commit e2167cf）
- 触发点：第 6 轮 @astrojs/check 揭示 53 个 TS 错误，其中 30 个 BufferSource 已消除，剩余 22 个预存在类型错误待处理
- 阶段：阶段二（数据驱动迭代），站点已上线但无访问数据，本轮做代码质量打磨

## 本轮聚焦方向
**剩余 22 个预存在 TypeScript 类型错误批量修复**（第 6 轮建议优先级 1，代码质量影响 npm run check 通过率）
22 个错误分布在 6 个文件，互不耦合，可批量修复后统一验证。同步清理 _diag_* 临时诊断文件（check 中产生 warnings）。

## 完成任务

### 类型错误修复（22 个 → 0，6 个文件）
1. ✅ JweTool.tsx（5 个 never 错误）
   - 问题：`keyof ParsedJwe['parts']` 中 parts 是可选字段（`parts?: JweParts`），TS 对可选属性做 keyof 推断为 `never`，导致 PART_LABELS 数组的 key 字段赋值时 string 不可赋给 never
   - 修复：`keyof ParsedJwe['parts']` → `keyof NonNullable<ParsedJwe['parts']>`，用 NonNullable 工具类型去除 undefined 分量，keyof 正确展开为 JweParts 的键
2. ✅ MarkdownTool.tsx（1 个八进制转义错误）
   - 问题：正则 `/^\s*([-*_])\s*\1\s*\1[\s\1]*$/` 中字符类 `[\s\1]` 的 `\1` 被解析为八进制转义（SOH 字符）而非反向引用，TS 报 ts(1536)
   - 修复：改为 `/^\s*([-*_])(?:\s*\1){2,}\s*$/`——捕获首个字符后用非捕获组 `(?:\s*\1){2,}` 重复 2 次以上（共 3+），语义等价且无需字符类内反向引用
3. ✅ TomlSchemaTool.tsx（6 个错误：TomlError 未导入 + catch e 为 unknown）
   - 问题：行 179 `e instanceof TomlError` 中 TomlError 未导入（ts(2304) Cannot find name），导致 instanceof 不生效，e 始终为 unknown，`e.line`/`e.column`/`e.message` 均报 ts(18046)
   - 修复：`import { parse as tomlParse, TomlDate } from 'smol-toml'` → 补 `TomlError` 导入。smol-toml 的 index.ts 已 `export { TomlError }`，且 TomlError 类有 `line`/`column`/`codeblock` 属性。导入后 instanceof 类型守卫自动将 e 从 unknown 收窄为 TomlError，6 个错误全部消除
4. ✅ hex.astro（7 个 JSX 逗号运算符错误）
   - 问题：FAQ 文案中 C 数组示例 `<code>{ 0x48, 0x65, 0x6c, 0x6c, 0x6f }</code>` 的 `{...}` 被 JSX 解析为表达式容器，逗号被当作逗号运算符，报 ts(18007) + ts(2695)
   - 修复：改为 `<code>{'{ 0x48, 0x65, 0x6c, 0x6c, 0x6f }'}</code>` 字符串字面量，JSX 正确渲染花括号文本。共 2 处（行 51 的 5 元素数组 + 行 59 的 2 元素数组）
5. ✅ index.astro（2 个 DOM 类型错误）
   - 问题：`searchInput.value` 中 searchInput 为 HTMLElement（无 value 属性）；`card.style.display` 中 card 为 Element（无 style 属性）
   - 修复：`getElementById('tools-search') as HTMLInputElement | null` 断言为输入元素；`grid.querySelectorAll<HTMLElement>('.tool-card')` 用泛型收窄为 HTMLElement，forEach 参数自动推断为 HTMLElement
6. ✅ colorPalette.ts（1 个 rgb 属性不存在错误）
   - 问题：行 396 `hexMap = scale.map(({ level, rgb }) => ({ level, hex: rgbToHex(rgb) }))` 丢弃了 rgb，hexMap 类型为 `{ level; hex }[]`，但行 420 ios 格式解构 `{ level, rgb }` 时 rgb 不存在
   - 修复：map 时保留 rgb：`({ level, hex: rgbToHex(rgb), rgb })`，hexMap 类型变为 `{ level; hex; rgb }[]`，其他格式解构 `{ level, hex }` 不受影响（多余属性自动忽略）

### 临时文件清理（10 个文件）
7. ✅ 清理 _diag_* 临时诊断文件
   - 文件：_diag_table2.cjs / _diag_table.cjs / _diag_regex.cjs / _diag_parser.mjs / _diag_parser.cjs / _diag_markdown.py / _diag_log.txt / _diag_output.txt / _diag_md_no_astro_js.png / _diag_md_nojs.png
   - 这些是前几轮调试 Markdown 渲染、表格解析等问题时的临时脚本与截图，已在 .gitignore 中忽略（未被 git 跟踪），但 .cjs/.mjs 文件会被 @astrojs/check 扫描产生 warnings
   - 清理后 check 文件数从 136 → 131，warnings 减少 5 个

## 修改文件（6 个源文件 + 1 个进度文件，未超 8 文件红线）
- src/components/JweTool.tsx（NonNullable 修复 keyof never）
- src/components/MarkdownTool.tsx（正则字符类反向引用改 (?:\s*\1){2,}）
- src/components/TomlSchemaTool.tsx（导入 TomlError）
- src/pages/hex.astro（JSX 花括号改字符串字面量，2 处）
- src/pages/index.astro（querySelectorAll 泛型 + as HTMLInputElement）
- src/utils/colorPalette.ts（hexMap 保留 rgb）
- memory/20260710/topics.md（本文件，进度沉淀）

## 验证结果
- 类型检查：✅ 22 errors → 0 errors（131 files，零回归）
- 构建：✅ 258 页面，11.66s，无报错无警告
- 产物抽检：✅ dist/hex/index.html 中 C 数组示例 `{ 0x48, 0x65, 0x6c, 0x6c, 0x6f }` 与 `{ 0x48, 0x65 }` 正确渲染为花括号文本
- Git 提交：commit 2b6a96a，已 push origin HEAD（e2167cf..2b6a96a）

## 数据洞察
- **keyof 可选属性的 never 陷阱**：TS 对 `keyof T` 其中 T 含 undefined 时，会将 keyof 交叉为 `keyof undefined`（即 never 的近似），导致结果为 never。正确做法是用 `NonNullable<T>` 先去除 undefined 再 keyof。这与第 6 轮 BufferSource 类型收窄类似——都是 TS 类型细化后暴露的预存问题
- **正则字符类中的反向引用限制**：JS 正则规范中，字符类 `[...]` 内的 `\1` 是八进制转义而非反向引用。Markdown 水平线匹配原用 `[\s\1]` 意图"空白或相同字符"，但实际匹配的是 SOH 控制字符。改用 `(?:\s*\1){2,}` 非捕获组重复更简洁且语义正确。这是正则语法理解的细节盲区
- **JSX 花括号转义**：JSX 中 `{` 是表达式容器起始符，要渲染字面花括号需用 `{'{'}` 字符串或 `&#123;` 实体。hex.astro 的 C 数组示例文案是典型场景——技术文档中花括号常见，易被误解析
- **catch unknown 类型策略**：TS 4.4+ 默认 `useUnknownInCatchVariables`，catch 的 e 为 unknown。正确的处理链是：先 `e instanceof Error` 收窄为 Error 取 message，再 `e instanceof 具体子类` 收窄取子类特有属性。TomlSchemaTool 原代码逻辑正确，仅缺 TomlError 导入导致 instanceof 不生效
- **colorPalette rgb 保留决策**：原代码 map 时丢弃 rgb 是"过度精简"——ios 格式需要 rgb 值，丢弃后无法使用。保留 rgb 后其他格式解构 `{ level, hex }` 不受影响（TS 允许解构子集）。这是"最小必要复杂度"的反面案例：为了减少一个字段而引入了功能缺陷
- **@astrojs/check 文件扫描范围**：check 会扫描项目根目录的 .cjs/.mjs/.ts 文件（不只是 src/），_diag_* 临时脚本虽被 gitignore 忽略但仍在磁盘上，产生 warnings。清理临时文件是维护 check 信噪比的好习惯

## 遗留问题
- 无（本轮所有任务完成且验收通过）
- npm run check 现已 0 errors，仅剩少量 warnings（substr 已废弃、execCommand 已废弃、未使用变量等），均为低优先级
- bug-check 报告剩余未修复项：14 个低危（BUG-21/22/25/26/27/28/30/32/35/36/37/38/39/40），多为一致性问题

## 下一轮建议
按优先级排序：
1. **剩余低危 Bug 批量修复**：BUG-21（JwtTool 截断显示）、BUG-22（JwtTool 时间格式）、BUG-25/26/27/28（各类一致性）、BUG-30（ip 工具示例）、BUG-32（lorem 边界）、BUG-35/36/37/38/39/40（示例数据与文案一致性）—— 14 项低危 Bug，可按文件分批处理
2. **Lighthouse 性能基线测量**：连续九轮遗留，TRAE Sandbox 拦截 configstore 写入。需用户配置白名单或换环境执行
3. **移动端 375px 三档适配实测**：连续九轮遗留，Playwright 受 Python 3.6 限制
4. **线上页面抓取校验**：WebFetch 超时，改 curl 或重试抓取线上页面校验渲染/canonical/JSON-LD 实际生效
5. **接入轻量统计工具**：Umami/Plausible 为阶段二数据驱动迭代提供数据源
6. **npm run check 剩余 warnings 清理**：substr→substring、execCommand→clipboard API、未使用变量删除等，均为低优先级代码整洁度提升

## 需用户操作
- 部署本轮修复后的代码（git push 已完成，若 Cloudflare Pages 已配置自动部署则自动触发）
- 在 docs/site-config.md 填写访问数据 + 接入统计工具后回写，agent 下轮进入数据驱动迭代
- （可选）配置 TRAE Sandbox 白名单允许 Lighthouse/Playwright 写入临时目录，以建立性能基线
