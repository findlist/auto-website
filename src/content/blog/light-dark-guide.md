---
title: 'CSS light-dark() 暗色模式完全指南：双主题颜色函数、color-scheme 与渐进降级'
description: '深入解析 CSS light-dark() 颜色函数：配合 color-scheme 声明原理、与 prefers-color-scheme 对比、CSS 变量双主题组织与渐进降级，附实战案例。'
pubDate: 2026-07-15
tags: ['CSS', 'light-dark', '暗色模式', '深色模式', '双主题', 'color-scheme', 'prefers-color-scheme', 'CSS 变量', '设计系统', '前端开发', '渐进增强', '设计工具']
relatedTool: '/light-dark'
---

# CSS light-dark() 暗色模式完全指南

CSS `light-dark()` 是 CSS Color Module Level 5 引入的颜色函数，2024 年起在 Chrome 123+、Safari 17.5+、Firefox 120+ 全主流浏览器原生支持。它把双主题（浅色/深色）颜色**内联到一条声明**，浏览器根据用户系统偏好自动选择，无需写 `@media (prefers-color-scheme)` 查询，也无需 JS 切换。这一特性让暗色模式实现从"两份代码 + 媒体查询"升级为"一行声明 + 浏览器自动处理"，大幅降低维护成本。本文系统解析 `light-dark()` 的语法、`color-scheme` 协同、CSS 变量组织、兼容性降级与实战案例。

## 一、诞生背景与核心价值

在 `light-dark()` 出现之前，实现双主题有三条路，各有硬伤：

- **@media (prefers-color-scheme) 查询**：在每个颜色处写两份声明——基础样式 + 媒体查询覆盖。代码分散，新增颜色要改两处；媒体查询是全局的，无法精确控制单个组件的主题；调试时要在两处对照查看。
- **JS 切换 data-theme 属性**：用 JS 监听系统主题变化，切换 `data-theme="dark"` 属性，CSS 用属性选择器应用主题。需要 JS 运行时，有切换延迟，可能闪烁；且要自己实现主题持久化（localStorage）与系统偏好监听。
- **CSS 变量 + 媒体查询**：在 `:root` 定义变量，媒体查询中覆盖变量值。比前两者好，但变量定义分散在两处，新增颜色仍需改两处。

`light-dark()` 提供了纯 CSS 声明式的解决方案：

```css
:root {
  color-scheme: light dark;  /* 关键：声明支持双主题 */
  --text: light-dark(#1a1a1a, #e5e5e5);  /* 浅色用 #1a1a1a，深色用 #e5e5e5 */
  --bg: light-dark(#ffffff, #1a1a1a);
}

body {
  color: var(--text);
  background: var(--bg);
}
```

浏览器根据用户的系统偏好（`prefers-color-scheme`）自动选择 `light-dark()` 的第一个或第二个值，零 JS、零延迟、组件级可控。

## 二、语法与 color-scheme 协同

`light-dark()` 的语法非常简洁：

```css
light-dark(<lightColor>, <darkColor>)
```

第一个值是浅色模式下的颜色，第二个值是深色模式下的颜色。两个值可以是任何 CSS 颜色类型：HEX、RGB、HSL、OKLCH、`color()` 等。

**核心规则：必须配合 `color-scheme` 声明才生效。** `color-scheme` 告诉浏览器"这个元素/文档支持哪种颜色方案"，浏览器据此决定 `light-dark()` 取哪个值。常见取值：

- `light dark`（默认推荐）：两种方案都支持，浏览器按 `prefers-color-scheme` 自动切换
- `dark light`：两种方案都支持，但深色优先（用于深色为主的站点）
- `light only`：强制只使用浅色，`light-dark()` 始终取第一个值
- `dark only`：强制只使用深色，`light-dark()` 始终取第二个值
- `normal`：不声明偏好，`light-dark()` 回退到第一个值（浅色）

若不声明 `color-scheme`，浏览器默认 `normal`，`light-dark()` 会始终返回浅色值，深色模式失效。这是最常见的坑。

```css
/* 错误：缺少 color-scheme，light-dark() 始终返回浅色 */
:root {
  --text: light-dark(#1a1a1a, #e5e5e5);
}

/* 正确：声明 color-scheme，浏览器按系统偏好切换 */
:root {
  color-scheme: light dark;
  --text: light-dark(#1a1a1a, #e5e5e5);
}
```

`color-scheme` 还会影响浏览器原生控件（滚动条、表单元素、`<input type="color">` 等）的渲染——声明 `light dark` 后，这些控件也会自动跟随系统主题，无需额外样式。

## 三、与 CSS 变量的最佳实践

把 `light-dark()` 包在 CSS 变量里是最佳实践——在 `:root` 上集中定义所有双主题变量，组件用 `var()` 引用，实现主题切换与组件样式解耦：

```css
:root {
  color-scheme: light dark;

  /* 文本颜色 */
  --text-primary: light-dark(#1a1a1a, #e5e5e5);
  --text-secondary: light-dark(#4a4a4a, #a0a0a0);
  --text-muted: light-dark(#9ca3af, #6b7280);

  /* 背景颜色 */
  --bg-main: light-dark(#ffffff, #1a1a1a);
  --bg-card: light-dark(#f5f5f5, #2a2a2a);
  --bg-hover: light-dark(#f3f4f6, #374151);

  /* 边框与链接 */
  --border: light-dark(#e0e0e0, #3a3a3a);
  --link: light-dark(#2563eb, #60a5fa);
}

/* 组件代码完全不含主题逻辑 */
.card {
  color: var(--text-primary);
  background: var(--bg-card);
  border: 1px solid var(--border);
}

.card:hover {
  background: var(--bg-hover);
}

.link {
  color: var(--link);
}
```

这种结构的好处：

1. **组件代码纯净**：组件只引用变量，不含任何主题判断逻辑
2. **新增颜色只改一处**：在 `:root` 加一条 `--name: light-dark(...)` 即可，无需改动任何组件
3. **主题切换零 JS**：浏览器根据系统偏好自动切换变量值，无需 JS 监听与重设
4. **可调试性强**：所有双主题颜色集中在 `:root`，一目了然

## 四、light-dark() vs @media (prefers-color-scheme)

两者都能实现双主题，但机制与可维护性差异显著：

| 维度 | `light-dark()` | `@media (prefers-color-scheme)` |
|------|----------------|----------------------------------|
| 代码组织 | 双主题颜色内联到一条声明 | 每个颜色分两处定义（基础 + 媒体查询） |
| 新增颜色 | 改一处 | 改两处 |
| 组件级控制 | 可作用到任意元素，组件级可控 | 媒体查询是全局的，无法精确控制单个组件 |
| 代码量 | 少 | 多（每个颜色都要重复选择器） |
| 可读性 | 高（双主题在一行内对照） | 低（要在两处对照） |
| 浏览器支持 | Chrome 123+ / Safari 17.5+ / Firefox 120+（2024 年起） | 全主流浏览器长期支持 |
| 降级策略 | 旧浏览器忽略，需写降级声明 | 旧浏览器天然降级到基础样式 |

**选型建议**：

- 新项目优先用 `light-dark()`，代码更简洁、可维护性更高
- 老项目可逐步把 `@media` 查询改写为 `light-dark()`，先改新增颜色，再迁移存量
- 需要兼容旧浏览器的场景，用 `@media` 查询作为降级，新浏览器用 `light-dark()` 增强

**等价改写示例**：

```css
/* @media 写法：代码分散 */
.text {
  color: #1a1a1a;  /* 浅色 */
}
@media (prefers-color-scheme: dark) {
  .text {
    color: #e5e5e5;  /* 深色 */
  }
}

/* light-dark() 写法：代码集中 */
.text {
  color: light-dark(#1a1a1a, #e5e5e5);
}
```

## 五、浏览器兼容性与渐进降级

### 兼容性现状

`light-dark()` 自 2024 年起在所有主流浏览器原生支持：

- Chrome 123+（2024-03）
- Edge 123+（2024-03）
- Safari 17.5+（2024-05）
- Firefox 120+（2023-11）
- 全球覆盖率约 90%+

可在生产环境放心使用，但需为旧浏览器提供降级。

### 渐进降级策略

旧浏览器不识别 `light-dark()`，会忽略该声明，元素使用前一条颜色声明作为回退。推荐写法：

```css
.text {
  /* 降级：旧浏览器使用浅色 */
  color: #1a1a1a;
  /* 增强：新浏览器按系统偏好切换 */
  color: light-dark(#1a1a1a, #e5e5e5);
}
```

旧浏览器停留在第一个 `color: #1a1a1a`（浅色），新浏览器用第二个 `color: light-dark(...)` 覆盖，按系统偏好切换。这种写法零额外开销，是最简单的降级方案。

### 特性检测

也可用 `@supports` 做特性检测，仅在支持时应用 `light-dark()`：

```css
.text {
  color: #1a1a1a;  /* 降级 */
}

@supports (color: light-dark(red, blue)) {
  .text {
    color: light-dark(#1a1a1a, #e5e5e5);  /* 增强 */
  }
}
```

这种写法更明确，但代码量略多。实际项目中，前一种"先降级后增强"的写法已足够。

## 六、实战案例：完整双主题设计系统

下面是一个完整的设计系统双主题配置，覆盖文本、背景、边框、链接、按钮等核心场景：

```css
:root {
  color-scheme: light dark;

  /* 文本颜色 */
  --text-primary: light-dark(#1a1a1a, #e5e5e5);
  --text-secondary: light-dark(#4a4a4a, #a0a0a0);
  --text-muted: light-dark(#9ca3af, #6b7280);

  /* 背景颜色 */
  --bg-main: light-dark(#ffffff, #0f0f0f);
  --bg-card: light-dark(#f9fafb, #1f2937);
  --bg-hover: light-dark(#f3f4f6, #374151);

  /* 边框 */
  --border: light-dark(#e5e7eb, #374151);
  --border-strong: light-dark(#d1d5db, #4b5563);

  /* 链接 */
  --link-default: light-dark(#2563eb, #60a5fa);
  --link-hover: light-dark(#1d4ed8, #93c5fd);
  --link-visited: light-dark(#7c3aed, #c4b5fd);

  /* 按钮 */
  --btn-primary-bg: light-dark(#2563eb, #3b82f6);
  --btn-primary-text: light-dark(#ffffff, #0f172a);
  --btn-secondary-bg: light-dark(#e5e7eb, #374151);

  /* 状态色 */
  --success: light-dark(#10b981, #34d399);
  --warning: light-dark(#f59e0b, #fbbf24);
  --error: light-dark(#ef4444, #f87171);
}

/* 使用示例 */
body {
  color: var(--text-primary);
  background: var(--bg-main);
}

.card {
  padding: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.card:hover {
  background: var(--bg-hover);
  border-color: var(--border-strong);
}

.btn-primary {
  color: var(--btn-primary-text);
  background: var(--btn-primary-bg);
  border: 0;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
}
```

这套配置覆盖了 14 个核心变量，足以支撑大多数 Web 应用的双主题需求。完整代码可在 [light-dark() 工具](/light-dark) 中在线生成与预览。

## 七、常见陷阱与最佳实践

### 陷阱 1：忘记声明 color-scheme

最常见的坑。不声明 `color-scheme`，`light-dark()` 始终返回浅色值，深色模式失效。

```css
/* 错误：深色模式不生效 */
:root {
  --text: light-dark(#1a1a1a, #e5e5e5);
}

/* 正确 */
:root {
  color-scheme: light dark;
  --text: light-dark(#1a1a1a, #e5e5e5);
}
```

### 陷阱 2：light-dark() 不能用于非颜色属性

`light-dark()` 是颜色函数，只能用于接受 `<color>` 值的属性。不能用于 `font-size`、`padding`、`display` 等非颜色属性。若需在浅色/深色模式下使用不同的非颜色值，仍需用 `@media` 查询或 CSS 变量 + 媒体查询。

### 陷阱 3：混淆 light-dark() 与 prefers-color-scheme

`light-dark()` 是颜色函数，在 CSS 声明中使用；`prefers-color-scheme` 是媒体查询特性，在 `@media` 中使用。两者协同工作——`prefers-color-scheme` 是浏览器读取系统偏好的来源，`color-scheme` 是元素声明支持的方案，`light-dark()` 根据这两者选择值。不要把它们对立起来，新项目可以两者结合使用。

### 陷阱 4：以为 light-dark() 只能用于 :root

`light-dark()` 可用于任何元素的颜色属性，不局限于 `:root`。组件级也可直接使用：

```css
.card {
  /* 组件级直接使用 light-dark() */
  color: light-dark(#1a1a1a, #e5e5e5);
  background: light-dark(#ffffff, #1f2937);
}
```

但最佳实践仍是集中在 `:root` 用 CSS 变量管理，便于维护与复用。

### 最佳实践总结

1. **始终在 :root 声明 color-scheme: light dark**（除非有特殊需求）
2. **把 light-dark() 包在 CSS 变量里**，集中管理双主题颜色
3. **组件用 var() 引用变量**，不含主题逻辑
4. **为旧浏览器写降级声明**（先写基础色，再用 light-dark() 覆盖）
5. **用 @supports 检测做更严格的渐进增强**（可选）
6. **设计系统覆盖 14+ 核心变量**：文本、背景、边框、链接、按钮、状态色

## 总结

`light-dark()` 是 CSS 双主题实现的现代化方案——把双主题颜色内联到一条声明，配合 `color-scheme` 让浏览器自动切换，零 JS、零延迟、组件级可控。相比传统的 `@media (prefers-color-scheme)` 查询，代码更集中、可维护性更高、可读性更强。2024 年起全主流浏览器原生支持，配合简单的降级声明即可在生产环境使用。

立即体验 [light-dark() 在线生成器](/light-dark)，可视化编辑双主题颜色对，实时预览三种模式下的渲染效果，一键复制 CSS 代码。配套阅读 [CSS 颜色格式转换工具](/color) 与 [颜色对比度检查工具](/color-contrast) 完善设计系统色彩工作流。
