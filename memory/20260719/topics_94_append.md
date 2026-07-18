---

# 第 94 轮 · 为剩余 6 个无博客工具页补齐配套博客（XML/JSON 互转 + 正则性能方法论）

## 上下文恢复
- 读取 `docs/site-config.md`：站点已上线（https://website.niuzi.asia），阶段二（数据驱动迭代），统计工具尚未接入
- 承接第 93 轮（commit 4e32175 → daadff4）：JWE/MIME/JSONPath 三篇博客完成，108 工具 + 109 博客 + 915 页面，双向内链网络覆盖率 102/108（94.4%）
- 第 93 轮下轮建议第 1 项明确指向本轮方向："为剩余 6 个无博客工具页补齐配套博客（xml-to-json / json-to-xml / yaml-schema / toml-schema / regex-benchmark / base64-image）"
- 工作树状态：第 93 轮 commit daadff4 已 push，本轮聚焦剩余 6 个无博客工具中优先级最高的 3 个

## 本轮聚焦方向
**为剩余 6 个无博客工具页补齐配套博客（第 93 轮下轮建议第 1 项）- 本轮优先处理 3 个高价值方向**

承接第 93 轮遗留的"剩余 6 个无博客工具页"，本轮按第 93 轮建议的优先级，选择 3 个高价值方向优先处理：
- **XML 转 JSON 实战：字段映射陷阱与命名空间 / 混合内容处理策略**（关联 /xml-to-json）
- **JSON 转 XML 实战：标签名约束与反向重建的不可逆性处理**（关联 /json-to-xml）
- **正则表达式性能基准测试方法论：从测量误差到 ReDoS 防御工程化**（关联 /regex-benchmark）

剩余 3 个（yaml-schema / toml-schema / base64-image）留待下轮处理，避免单轮超时。

理由：
- **对偶主题协同**：XML ↔ JSON 互转是经典对偶场景，分两篇博客从两个方向深入，覆盖命名空间处理、属性 vs 子元素选择、CDATA 与字符转义、往返转换可逆性等核心议题
- **工程化深度**：正则性能测试不是"跑 1000 次取平均"那么简单，本轮博客聚焦测量误差治理、统计显著性、ReDoS 检测方法论、生产审计流程、CI 集成等工程化主题
- **主题差异化**：3 篇博客均聚焦"实战工作流 + 工程化深度"维度，与既有工具页 FAQ 的"基础能力介绍"互补不重叠
- **低成本高收益**：纯内容新增 + 复用第 92 轮建立的 `scripts/add-related-blogs.mjs` 批量脚本自动补齐工具页反向内链

## 完成任务

### 单元 1：新增博客 `xml-to-json-mapping-pitfalls.md`（约 320 行）
- 文件：`src/content/blog/xml-to-json-mapping-pitfalls.md`
- 主题：XML 转 JSON 的字段映射陷阱与命名空间 / 混合内容处理策略
- 内容结构（10 章节）：
  1. 为什么 XML 转 JSON 不是"换个写法"（XML 的三类独有能力：属性 vs 子元素二元性、混合内容、顺序敏感）
  2. 属性 vs 子元素：何时需要 @ 前缀（5 种主流策略对比 + 决策清单）
  3. 命名空间：prefix 映射与 @xmlns 处理（保留 prefix / 命名空间折叠 / 完全丢弃三策略对比）
  4. 同名子元素合并数组的语义保真（默认智能 / 始终数组 / 仅重复时数组三策略）
  5. CDATA 与混合内容处理（合并 vs 分离 + 节点序列保真策略）
  6. 注释与处理指令的取舍
  7. 类型推断的副作用（邮编前导 0 丢失、大整数精度丢失、布尔值假阳性、空元素歧义）
  8. 典型 XML 类型实战（SOAP / RSS / SVG / Office 文档四类场景配置示例）
  9. XXE 防护与安全注意（XXE / Billion Laughs / 外部 DTD / XML Bomb 四类攻击向量）
  10. 与 XML 转 JSON 工具的协同工作流（SOAP 解析 / Office 元数据 / RSS 转换三个完整流程）
- frontmatter：pubDate 2026-07-19, relatedTool "/xml-to-json", 10 个 tags

### 单元 2：新增博客 `json-to-xml-reverse-mapping.md`（约 320 行）
- 文件：`src/content/blog/json-to-xml-reverse-mapping.md`
- 主题：JSON 转 XML 的反向重建与结构差异处理（与博客 1 形成对偶主题）
- 内容结构（10 章节）：
  1. JSON 转 XML：反向操作中的"硬约束"（XML 标签命名规则 + 约束不对称）
  2. 标签名修正策略（10 种非法 key 修正示例 + 修正副作用与不可逆性）
  3. 属性 vs 子元素：何时用属性（默认全子元素 vs 扁平对象用属性 + 决策清单）
  4. 数组的转换与命名（数组项名策略：item / tag / li / entry 业务语义）
  5. CDATA 与字符转义（特殊字符处理 + 两种方式取舍 + CDATA 边界冲突处理）
  6. null 与空值表达（4 种 null 表示策略对比 + 空数组处理）
  7. well-formed 校验（5 条规则 + 工具校验逻辑 + 校验失败处理）
  8. 典型 JSON 类型实战（SOAP / SVG / Office / Android 资源四类场景配置示例）
  9. 与 XML 转 JSON 的对偶关系（往返转换 5 类不可逆性 + 保证可逆的配置组合表）
  10. 与 JSON 转 XML 工具的协同工作流（SOAP 构造 / SVG 生成 / Android 资源三个完整流程）
- frontmatter：pubDate 2026-07-19, relatedTool "/json-to-xml", 10 个 tags

### 单元 3：新增博客 `regex-benchmark-methodology.md`（约 350 行）
- 文件：`src/content/blog/regex-benchmark-methodology.md`
- 主题：正则表达式性能基准测试方法论与生产实践
- 内容结构（8 章节）：
  1. 为什么需要一篇「正则性能基准测试方法论」文章（与已有 regex-practical-patterns 博客互补定位）
  2. 性能测量误差的五大来源（JIT 预热 / GC 暂停 / 浏览器节流 / 系统负载 / 输入长度 + 治理策略）
  3. 统计显著性与置信区间（t 检验 + 工程实践建议）
  4. ReDoS 检测方法论（三类危险模式回溯分析 + 静态检测局限 + 渐进式压力测试判定 + 超时保护）
  5. 典型 ReDoS 案例库（CVE-2019-13140 + StackOverflow 路由匹配 + a>b>c 歧义三个案例）
  6. 生产环境正则审计流程（静态扫描 + 动态测试混合策略 + CI 集成 + 白名单管理 + 输入长度限制 + 超时保护）
  7. ReDoS 防御的工程化建议（5 类场景防御策略 + 工具化建议 + 团队规范 6 条）
  8. 与正则测试工具的协同工作流（新正则上线 / 历史正则审计 / 用户输入校验三个完整流程）
- frontmatter：pubDate 2026-07-19, relatedTool "/regex-benchmark", 10 个 tags

### 单元 4：复用脚本批量补齐 3 个工具页反向内链
- 直接复用第 92 轮建立的 `scripts/add-related-blogs.mjs` 批量脚本
- 脚本扫描博客 frontmatter 的 `relatedTool` 字段，构建映射 → 在工具页 `.related-tools` 区块后插入 `.related-blogs` 区块
- 幂等性保证：已有 `.related-blogs` 的文件自动跳过（本轮前 xml-to-json.astro / json-to-xml.astro / regex-benchmark.astro 均无此区块，全部成功插入）
- 脚本输出统计：成功插入 3 个文件，跳过 105 个（102 个已有 + 3 个无相关博客）
- 涉及修改文件：`src/pages/xml-to-json.astro` / `src/pages/json-to-xml.astro` / `src/pages/regex-benchmark.astro`

### 单元 5：全量验证
- `npm run check`：0 errors / 0 warnings / 4 hints（hints 均为既有遗留：seo-audit.mjs 未使用 import、clipboard.ts deprecated execCommand，与本轮无关）
- `npm run build`：935 页面构建成功（27.05s）
  - 原规模 915 页面 + 3 篇博客详情 + 多个新 tag 索引页 + 部分既有页面重渲染 = 935（+20）
- 内链覆盖率验证：3/3 工具页（xml-to-json / json-to-xml / regex-benchmark）均成功插入 `.related-blogs` 区块

## 验收
- ✅ `npm run check`：0 errors / 0 warnings / 4 hints
- ✅ `npm run build`：935 页面构建成功，无错误
- ✅ 内容质量：3 篇博客均结构完整（8-10 章节、表格、代码块、决策清单、协同工作流）
- ✅ 主题差异化：3 篇博客均聚焦"实战工作流 + 工程化深度"维度，与既有工具页 FAQ 的"基础能力介绍"互补不重叠
- ✅ 内链补齐：3 个工具页（xml-to-json / json-to-xml / regex-benchmark）成功插入 `.related-blogs` 区块
- ✅ 脚本幂等性：复用第 92 轮脚本，幂等性保证已有区块不重复插入
- ✅ 工具 ↔ 博客双向内链网络覆盖率提升：从 102/108（94.4%）→ 105/108（97.2%），剩余 3 个无博客工具页（base64-image / toml-schema / yaml-schema）
- ✅ frontmatter 规范：title / description / pubDate / tags / relatedTool 五字段完整
- ✅ 所有代码注释、UI 文案使用中文

## 修改文件清单

**新增博客（3 文件）**：
- `src/content/blog/xml-to-json-mapping-pitfalls.md`（+约 320 行）
- `src/content/blog/json-to-xml-reverse-mapping.md`（+约 320 行）
- `src/content/blog/regex-benchmark-methodology.md`（+约 350 行）

**工具页反向内链补齐（3 文件）**：
- `src/pages/xml-to-json.astro`（+约 10 行：插入 `.related-blogs` 区块）
- `src/pages/json-to-xml.astro`（+约 10 行）
- `src/pages/regex-benchmark.astro`（+约 10 行）

**进度沉淀（1 文件）**：
- `memory/20260719/topics.md`（追加本轮记录）

## 进度沉淀
- 当前规模：**108 工具**（无变化）+ **112 博客**（109+3）+ **935 页面**（915+20）
- 工具 ↔ 博客双向内链网络覆盖率：从 102/108（94.4%）→ 105/108（97.2%）
- 剩余无博客工具页：3 个（base64-image / toml-schema / yaml-schema）

## 问题与发现
1. **对偶主题设计**：XML ↔ JSON 互转是经典对偶场景，本轮分两篇博客从两个方向深入。xml-to-json 博客聚焦"语义降维"（XML 的属性 / 子元素二元性、混合内容、顺序敏感 → JSON 扁平结构），json-to-xml 博客聚焦"反向重建的不可逆性"（约束不对称 + 标签名修正 + 往返转换 5 类不可逆性）。两篇博客在第 9 章交叉引用对偶博客，形成完整的对偶主题协同。
2. **工程化深度差异化**：regex-benchmark 博客不重复 regex-practical-patterns 博客的"常用模式速查 + ReDoS 防御基础"，而是聚焦"测量误差治理、统计显著性、ReDoS 检测方法论、生产审计流程、CI 集成"等工程化主题，覆盖团队级正则治理的完整流程。
3. **脚本复用价值再次验证**：直接复用第 92 轮建立的 `scripts/add-related-blogs.mjs` 批量脚本，无需任何修改即可处理本轮新增的 3 篇博客反向内链补齐。脚本的幂等性、多结构兼容、HTML 转义、描述截断等特性在新增博客场景下自动生效。
4. **并行任务文件隔离**：工作树存在 `memory/20260718/topics.md` 修改、`docs/bug-check/bug-check-2026-07-19.md`、`docs/style-optimization/style-opt-2026-07-19.md`、`memory/20260718/topics-archive-20260718.md` 等并行任务产物。严格遵守规范"仅添加本次修改的文件"，本轮仅提交 6 个本轮修改文件 + 1 个进度沉淀文件。
5. **页面数增长分析**：构建产物从 915 增长到 935（+20），其中 3 篇博客详情页 + 多个新 tag 索引页（每篇博客 10+ tags，部分新 tag 触发新的索引页生成）+ 部分既有页面因内链更新重渲染。

## 下轮建议（第 94 轮产出）
1. **为剩余 3 个无博客工具页补齐配套博客**（本轮遗留）：base64-image / toml-schema / yaml-schema
   - 优先级建议：yaml-schema 与 toml-schema（Schema 校验实践，与已有 json-schema 博客形成系列）→ base64-image（图片与 Base64 互转性能优化，与图像矩阵协同）
2. **接入 Cloudflare Web Analytics**（阶段二核心阻塞项，需用户操作）：站点已上线 12 天，仍未获取访问数据
3. **图像工具矩阵继续扩充**（第 83 轮遗留第 2 项剩余方向）：metadata 打包工具（IPTC/XMP/ICC profile 查看与清理）
4. **EXIF 编辑器进一步增强**（第 89 轮下轮建议第 3 项）：PNG/WebP/TIFF 支持 / 预设拖拽排序 / 批量进度条
5. **图片对比工具增强**（第 90 轮下轮建议第 3 项）：批量对比 / 差异区域框选与放大 / 对比结果导出 JSON
6. **长尾 SEO 内容补充继续**：基于加密哈希矩阵拓展"密码哈希算法对比实战"、"JWT 安全实践案例"等长尾关键词落地页

## 遗留问题
- **统计工具未接入**：站点已上线 12 天，仍未接入 Cloudflare Web Analytics，无法获取访问数据驱动迭代。**此为阶段二核心阻塞项，需用户在 Cloudflare 控制台开启 Web Analytics 并提供 beacon 代码片段**。
- **EXIF 编辑器未支持 PNG/WebP/TIFF**：当前仅支持 JPEG（EXIF 主要载体）。其他格式需新增解析器，复杂度较高，非本轮范围。
- **剩余 3 个无博客工具页**：base64-image / toml-schema / yaml-schema 暂无配套博客，相关博客区块无法展示。下轮可继续补齐。

## 用户操作项
- **可选**：在 Cloudflare 控制台开启 Web Analytics（站点已部署于 Cloudflare Pages），将获取的 beacon script 提供给 Agent 集成到 BaseLayout.astro，进入真正数据驱动迭代阶段
- **可选**：将 sitemap.xml 提交至 Google Search Console / Bing Webmaster Tools，加速搜索引擎收录新增内容

---

## 第 94 轮工作摘要（按规范第十节模板）

**轮次**：第 94 轮（2026-07-19）
**阶段**：阶段二（数据驱动迭代）
**方向**：为剩余 6 个无博客工具页补齐配套博客 - 优先处理 3 个高价值方向（XML/JSON 互转 + 正则性能方法论）
**Commit**：待提交
**Push**：待提交

### 完成任务
1. ✅ 新增 `src/content/blog/xml-to-json-mapping-pitfalls.md`（约 320 行）：XML 转 JSON 字段映射陷阱，覆盖属性 vs 子元素 5 策略、命名空间 3 策略、同名子元素合并、CDATA 与混合内容、类型推断副作用、SOAP/RSS/SVG/Office 实战、XXE 防护
2. ✅ 新增 `src/content/blog/json-to-xml-reverse-mapping.md`（约 320 行）：JSON 转 XML 反向重建与结构差异处理，覆盖标签名修正、属性 vs 子元素选择、CDATA 与字符转义、null 表达、well-formed 校验、往返转换可逆性、SOAP/SVG/Office/Android 实战
3. ✅ 新增 `src/content/blog/regex-benchmark-methodology.md`（约 350 行）：正则性能基准测试方法论，覆盖测量误差五大来源、统计显著性 t 检验、ReDoS 三类危险模式回溯分析、典型 ReDoS 案例库、生产审计流程、CI 集成、白名单管理
4. ✅ 复用 `scripts/add-related-blogs.mjs` 批量脚本，自动为 xml-to-json.astro / json-to-xml.astro / regex-benchmark.astro 3 个工具页插入 `.related-blogs` 区块（脚本输出：成功插入 3 个文件，跳过 105 个）
5. ✅ 类型检查通过（0 errors / 0 warnings / 4 hints，均为既有遗留）
6. ✅ 构建成功（935 页面 27.05s，+20 页面）
7. ✅ 内链覆盖率验证 3/3 工具页达标

### 当前规模
- **工具**：108 个（无变化）
- **博客**：112 篇（+3，新增 xml-to-json-mapping-pitfalls / json-to-xml-reverse-mapping / regex-benchmark-methodology）
- **页面**：935 页（+20：3 博客详情 + 多个新 tag 索引页 + 部分既有页面重渲染）
- **工具 ↔ 博客双向内链网络覆盖率**：从 102/108（94.4%）→ 105/108（97.2%）

### 下轮优先级
1. 为剩余 3 个无博客工具页补齐配套博客（base64-image / toml-schema / yaml-schema）
2. 接入 Cloudflare Web Analytics（阶段二核心阻塞项，需用户操作）
3. 图像工具矩阵继续扩充（metadata 打包）
4. EXIF 编辑器进一步增强（PNG/WebP/TIFF 支持）
5. 图片对比工具增强（批量对比 / JSON 导出）
6. 长尾 SEO 内容补充继续（加密哈希矩阵实战类博客）

### 遗留问题
- 统计工具未接入（阶段二核心阻塞项，需用户操作）
- EXIF 编辑器未支持 PNG/WebP/TIFF（需新增解析器，复杂度较高）
- 剩余 3 个无博客工具页暂无配套博客（下轮继续补齐）

### 用户操作项
- 可选：开启 Cloudflare Web Analytics 并提供 beacon 代码
- 可选：提交 sitemap.xml 至 Google Search Console / Bing Webmaster Tools
