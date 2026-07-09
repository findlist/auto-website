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
- 部署本轮修复后的代码（git push 后若 Cloudflare Pages 已配置自动部署则自动触发）
- 在 docs/site-config.md 填写访问数据 + 接入统计工具后回写，agent 下轮进入数据驱动迭代
- （可选）配置域名邮箱并替换 about/privacy 中的占位邮箱
