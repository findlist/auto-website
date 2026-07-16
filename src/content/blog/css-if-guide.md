---
title: 'CSS if() 条件函数完全指南：style/media/supports 三类条件、多分支与降级实践'
description: '深入解析 CSS if() 条件值函数：style() 样式查询、media() 媒体查询、supports() 特性查询三类条件语法，多分支短路求值、嵌套与逻辑运算、浏览器兼容性降级，附实战案例。'
pubDate: 2026-07-17
tags: ['CSS', 'if()', '条件函数', 'style 查询', 'media 查询', 'supports 查询', 'CSS 变量', '主题切换', '响应式', '渐进增强', '前端开发', 'CSS Values Level 5']
relatedTool: '/css-if'
---

CSS `if()` 是 CSS Values Module Level 5 引入的条件值函数，2025 年起在 Chrome 137+ 实验性支持。它把条件判断**内联到一条属性声明**——浏览器按顺序求值各条件，第一个为 true 的分支返回其值。这一特性让 CSS 从"完整规则块条件化"升级为"单属性值条件化"，特别适合只切换单个属性的场景，无需再写完整的 `@media` / `@supports` / `@container` 规则块。本文系统解析 `if()` 的三类条件、语法规则、降级策略与实战案例。

## 一、诞生背景与核心价值

在 `if()` 出现之前，要根据条件改变单个 CSS 属性值必须写完整的 at-rule 规则块：

- **@media 查询**：要响应式改变一个 `padding` 值，得写 `@media (min-width: 768px) { .demo { padding: 20px; } }`，规则块包裹多条声明，仅改变一个值时显得冗长。
- **@supports 查询**：要根据浏览器是否支持 `lch()` 颜色降级，得写 `@supports (color: lch(0 0 0)) { .demo { color: lch(...); } }`，同样要写完整规则块。
- **@container 查询**：基于容器自定义属性切换样式，需要查找容器父级，无法直接作用于元素自身。

`if()` 提供了纯 CSS 声明式的单属性条件化方案：

```css
.demo {
  /* 静态回退（不支持 if() 的浏览器生效） */
  padding: 10px;
  /* if() 条件声明（Chrome 137+ 生效，覆盖上面的回退） */
  padding: if(
    style(--size: "2xl") : 32px;
    media(min-width: 768px) : 20px;
    else : 10px
  );
}
```

浏览器按顺序求值：先检查 `--size` 是否为 `"2xl"`，是则返回 `32px`；否则检查视口宽度是否 ≥ 768px，是则返回 `20px`；都不满足返回 `else` 的 `10px`。一条声明完成多条件判断，代码集中、组件级可控。

## 二、语法规则与关键易错点

`if()` 的语法形式为：

```
if(<条件> : <值>; <条件> : <值>; ... ; else : <值>)
```

每个分支由 `<条件> : <值>` 组成，分支之间用分号 `;` 分隔，最后一个分支的分号可选。`else` 是始终为 true 的兜底条件。

### 四个关键规则

**1. if 与 ( 之间不能有空格**

最常见的语法错误。写成 `if (...)` 会使整个声明无效，必须紧贴写作 `if(...)`：

```css
/* 错误：if 与 ( 之间有空格，整个声明无效 */
.demo { color: if (style(--theme: dark) : #fff; else : #000); }

/* 正确：紧贴写作 if(...) */
.demo { color: if(style(--theme: dark) : #fff; else : #000); }
```

**2. 条件与值用冒号分隔**

每个分支格式为 `<条件> : <值>`，冒号两侧可有空格：

```css
color: if(style(--theme: dark) : #fff; else : #000);
/* 等价于 */
color: if(style(--theme: dark):#fff; else:#000);
```

**3. 分支之间用分号分隔**

多个分支用 `;` 分隔，最后一个分支的分号可选：

```css
/* 最后一个分号可省略 */
color: if(style(--theme: dark) : #fff; else : #000);
/* 也可保留 */
color: if(style(--theme: dark) : #fff; else : #000;);
```

**4. else 是关键字不是函数**

`else` 是始终为 true 的兜底条件，写作 `else : <值>`，不能写作 `else()`：

```css
/* 错误：else 不是函数 */
color: if(style(--theme: dark) : #fff; else() : #000);

/* 正确：else 是关键字 */
color: if(style(--theme: dark) : #fff; else : #000);
```

### 容错规则

单个条件或值无效**不会**使整个 `if()` 失效，解析器会跳过该分支继续求值。若所有分支都无效，`if()` 返回 `guaranteed-invalid`，属性回退到 `initial`。这一特性让 `if()` 在面对拼写错误时更健壮。

## 三、三类条件类型详解

`if()` 支持三种条件类型，覆盖 CSS 中所有条件查询场景，可混合使用。

### 1. style() 样式查询

测试元素自身的**自定义属性**值，语法 `style(<custom-property>: <value>)`：

```css
.card {
  /* 根据 --theme 自定义属性切换背景色 */
  background-color: if(
    style(--theme: dark) : #1a1a1a;
    style(--theme: light) : #ffffff;
    else : #f0f0f0
  );
}
```

**关键限制**：当前 `style()` **仅支持自定义属性**（CSS 变量），不支持普通 CSS 属性查询。例如 `style(display: flex)` 不会工作，但 `style(--layout: flex)` 可以。

变通做法是把要查询的状态用自定义属性"代理"——在元素上设置 `--state: active`，然后用 `style(--state: active)` 查询。

`style()` 内部支持 `and` / `or` / `not` 逻辑组合：

```css
color: if(
  style(--theme: dark and --variant: muted) : #888;
  style(--theme: dark) : #fff;
  else : #000
);
```

相比 `@container style()` 查询，`if()` 的 `style()` 条件可直接作用于元素自身，无需查找容器父级，组件级可控。

### 2. media() 媒体查询

测试媒体特性，语法 `media(<media-condition>)`，支持媒体类型与媒体特性：

```css
.demo {
  /* 响应式 padding */
  padding: if(
    media(min-width: 1200px) : 32px;
    media(min-width: 768px) : 20px;
    else : 10px
  );
}

.print-only {
  /* 打印媒体 */
  color: if(
    media(print) : #000;
    else : #333
  );
}

.theme-aware {
  /* 暗色模式偏好 */
  background: if(
    media(prefers-color-scheme: dark) : #1a1a1a;
    else : #ffffff
  );
}
```

`media()` 内部支持 `and` / `or` / `not` 逻辑组合：

```css
padding: if(
  media(min-width: 768px and prefers-color-scheme: dark) : 24px;
  else : 12px
);
```

`media()` 的优势在于**单属性响应式**——只需改变一个值时无需写完整 `@media` 规则块。

### 3. supports() 特性查询

测试浏览器是否支持某属性值，语法 `supports(<supports-condition>)`：

```css
.demo {
  /* lch() 颜色降级 */
  color: if(
    supports(color: lch(50 50 0)) : lch(50 50 0);
    else : rgb(128, 128, 128)
  );
}

button {
  /* :has() 选择器支持检测 */
  display: if(
    supports(selector(:has(+ *))) : block;
    else : flex
  );
}
```

`supports()` 内部支持 `and` / `or` / `not` 逻辑组合：

```css
color: if(
  supports(not (color: lch(0 0 0))) : rgb(128, 128, 128);
  else : lch(50 50 0)
);
```

`supports()` 的优势在于**渐进增强**——新特性支持时用新值，不支持时降级到旧值，无需写完整 `@supports` 规则块。

### 三类条件混合使用

三类条件可混合使用于同一个 `if()` 中，按顺序短路求值：

```css
.demo {
  padding: if(
    style(--size: "2xl") : 32px;           /* 优先：自定义属性 */
    media(min-width: 1200px) : 24px;       /* 其次：响应式 */
    supports(padding: max(0px, 1vw)) : max(0px, 1vw);  /* 再次：特性降级 */
    else : 12px                            /* 兜底 */
  );
}
```

## 四、else 分支的作用与位置

`else` 是始终为 true 的兜底条件，所有 `<if-test>` 都为 false 时返回其值。

### 推荐写法：else 放在最后

```css
color: if(
  style(--theme: dark) : #fff;
  style(--theme: light) : #000;
  else : #333  /* 兜底：未设置 --theme 或值为其他 */
);
```

### else 放在前面的陷阱

`else` 放在任何位置都会立即求值为 true，后续条件**不会求值**：

```css
/* 错误：else 放在最前，后面条件永远不求值，始终返回 #333 */
color: if(
  else : #333;
  style(--theme: dark) : #fff;
  style(--theme: light) : #000
);
```

这一特性可用于**调试**——临时把 `else` 放在怀疑有问题的分支前，看是否返回预期值，验证分支是否真的命中。

### 仅 else 或空 if() 的有效但无用情况

`if()` 至少含一个 `else` 分支是合法的，但无实际用途：

```css
/* 合法但无用：始终返回 yellow */
background-color: if(else : yellow);
/* 等价于直接写 */
background-color: yellow;
```

空 `if()`（`if()` 内无任何分支）也是合法的，返回 `guaranteed-invalid`，属性回退到 `initial`，同样无实际用途。

## 五、嵌套与逻辑运算

### if() 嵌套

`if()` 的值部分可以再嵌套 `if()`，实现多层条件判断：

```css
.demo {
  color: if(
    style(--theme: dark) : if(
      style(--variant: muted) : #888;
      else : #fff
    );
    else : if(
      style(--variant: muted) : #aaa;
      else : #000
    )
  );
}
```

外层判断主题，内层在各自主题下再判断变体。嵌套可读性较差，建议**适度使用**，复杂条件建议拆分为多个声明或使用 at-rule。

### 逻辑运算符

三类条件内部都支持 `and` / `or` / `not` 逻辑组合：

```css
/* style() 逻辑 */
color: if(
  style(--theme: dark and --variant: muted) : #888;
  style(--theme: dark or --theme: dim) : #fff;
  style(not (--theme: light)) : #ccc;
  else : #000
);

/* media() 逻辑 */
padding: if(
  media(min-width: 768px and prefers-color-scheme: dark) : 24px;
  media(print or (max-width: 480px)) : 8px;
  else : 12px
);

/* supports() 逻辑 */
color: if(
  supports(color: lch(0 0 0) and color: color(display-p3 0 0 0)) : lch(50 50 0);
  supports(not (color: lch(0 0 0))) : rgb(128, 128, 128);
  else : #888
);
```

### 部分值条件化

`if()` 不仅可用作整个属性值，还可用于属性值的**部分**：

```css
.demo {
  /* 仅条件化 border-color 部分 */
  border: 1px solid if(
    supports(color: lch(0 0 0)) : lch(50 50 0);
    else : rgb(128, 128, 128)
  );
}

.gradient {
  /* 仅条件化渐变停止点颜色 */
  background: linear-gradient(
    to right,
    if(style(--theme: dark) : #1a1a1a; else : #ffffff),
    if(style(--theme: dark) : #333; else : #f0f0f0)
  );
}
```

## 六、浏览器兼容性与降级策略

### 兼容性现状

`if()` 自 Chrome 137+（2025 年）起实验性支持，**尚未进入 Baseline**，Safari 与 Firefox 暂未稳定支持。生产环境使用前请确认目标浏览器，或做好降级。

### 降级策略：显式静态回退

`if()` **不会优雅降级**——不支持的浏览器会整个声明无效，必须显式提供回退。推荐写法：

```css
.demo {
  /* 1. 静态回退声明（不支持 if() 的浏览器生效） */
  padding: 10px;
  /* 2. if() 覆盖（支持 if() 的浏览器生效） */
  padding: if(
    style(--size: "2xl") : 32px;
    media(min-width: 768px) : 20px;
    else : 10px
  );
}
```

旧浏览器停留在第一条 `padding: 10px`，新浏览器用 `if()` 覆盖。**注意**：若不写 `else`，支持 `if()` 的浏览器在所有条件都不满足时会返回 `guaranteed-invalid`，属性回退到 `initial`（而非上一条声明的 `10px`）。所以 `else` 分支不可省略。

### @supports 特性检测

也可用 `@supports` 做特性检测，仅在支持时应用 `if()`：

```css
.demo {
  padding: 10px;  /* 默认回退 */
}

@supports (color: if(1 : red; else : blue)) {
  .demo {
    padding: if(
      style(--size: "2xl") : 32px;
      media(min-width: 768px) : 20px;
      else : 10px
    );
  }
}
```

这种方式更清晰，但代码量稍多。两种方式可结合使用。

### 渐进增强实践

对生产环境，推荐分层降级：

1. **基础样式**：所有浏览器都能渲染的静态值
2. **if() 增强**：支持 `if()` 的浏览器按条件切换
3. **polyfill 兜底**（可选）：对老浏览器用 JS 监听条件变化切换 class

## 七、与 @media / @supports / @container 的对比

四者都是 CSS 条件机制，但作用域与粒度不同，**互补而非替代**。

| 机制 | 作用域 | 粒度 | 典型场景 |
|------|--------|------|----------|
| `@media` | 整个规则块 | 多属性 | 整体布局切换（响应式、暗色模式） |
| `@supports` | 整个规则块 | 多属性 | 渐进增强整体方案（新特性降级） |
| `@container` | 整个规则块 | 多属性 | 组件容器响应式 |
| `if()` | 单个属性值 | 单属性 | 单属性条件化（只改一个值） |

### 何时用 if()，何时用 at-rule

**用 `if()` 的场景**：
- 只需切换**单个属性值**，无需写完整规则块
- 基于**元素自身**的自定义属性条件（`style()`），无需查找容器父级
- 多分支条件，希望按顺序短路求值

**用 at-rule 的场景**：
- 需要切换**多个属性**，整体规则块条件化
- 需要**嵌套规则**（如 `@media` 内含子选择器）
- 需要**级联层**控制（`@layer`）

### if() style() vs @container style()

两者都支持自定义属性查询，但作用机制不同：

- `@container style(--theme: dark)`：查询**容器父级**的自定义属性，作用于整个规则块
- `if(style(--theme: dark))`：查询**元素自身**的自定义属性，作用于单条声明

```css
/* @container 方式：查找容器父级的 --theme */
.parent { container-type: style; --theme: dark; }
@container style(--theme: dark) {
  .child { color: #fff; padding: 20px; }  /* 多属性同时切换 */
}

/* if() 方式：直接作用于元素自身 */
.child {
  --theme: dark;
  color: if(style(--theme: dark) : #fff; else : #000);  /* 单属性切换 */
  padding: if(style(--theme: dark) : 20px; else : 10px);
}
```

两者互补使用：多属性用 `@container`，单属性用 `if()`。

## 八、实战案例与最佳实践

### 案例 1：基于 CSS 变量的主题切换

最经典的 `if()` 用法——通过 `--theme` 自定义属性切换主题：

```css
:root {
  /* 默认浅色主题 */
  --theme: light;
  /* 用户切换时改为 --theme: dark */
}

.card {
  background: if(
    style(--theme: dark) : #1a1a1a;
    else : #ffffff
  );
  color: if(
    style(--theme: dark) : #e5e5e5;
    else : #1a1a1a
  );
  border-color: if(
    style(--theme: dark) : #333;
    else : #e5e7eb
  );
}

/* JS 切换：document.documentElement.style.setProperty('--theme', 'dark') */
```

优势：无需 JS 切换 class，无需 `@media` 查询，组件级独立可控。

### 案例 2：响应式单属性适配

仅需改变一个属性的响应式场景，`if()` 比 `@media` 更简洁：

```css
.hero {
  /* 传统 @media 写法
  padding: 10px;
  @media (min-width: 768px) { padding: 20px; }
  @media (min-width: 1200px) { padding: 32px; }
  */
  
  /* if() 写法：一条声明完成 */
  padding: if(
    media(min-width: 1200px) : 32px;
    media(min-width: 768px) : 20px;
    else : 10px
  );
}
```

### 案例 3：特性检测降级

新 CSS 特性的渐进增强：

```css
.colorful {
  color: rgb(128, 128, 128);  /* 静态回退 */
  color: if(
    supports(color: lch(0 0 0)) : lch(50 50 0);
    supports(color: color(display-p3 0 0 0)) : color(display-p3 0.5 0.5 0);
    else : rgb(128, 128, 128)
  );
}
```

### 案例 4：设计令牌驱动

基于设计令牌（design tokens）的尺寸系统：

```css
:root { --size: "md"; }  /* sm / md / lg / xl / 2xl */

.element {
  padding: if(
    style(--size: "2xl") : 32px;
    style(--size: "xl") : 24px;
    style(--size: "lg") : 16px;
    style(--size: "md") : 12px;
    style(--size: "sm") : 8px;
    else : 12px
  );
  font-size: if(
    style(--size: "2xl") : 1.5rem;
    style(--size: "xl") : 1.25rem;
    style(--size: "lg") : 1.125rem;
    else : 1rem
  );
}
```

### 案例 5：打印样式

打印媒体的特殊处理：

```css
.invoice {
  background: if(
    media(print) : #fff;  /* 打印时强制白底 */
    else : #f9fafb
  );
  color: if(
    media(print) : #000;  /* 打印时强制黑字 */
    else : #1f2937
  );
  box-shadow: if(
    media(print) : none;  /* 打印时去阴影 */
    else : 0 1px 3px rgba(0, 0, 0, 0.1)
  );
}
```

### 最佳实践

1. **始终包含 else 分支**：避免所有条件都不满足时属性回退到 `initial`
2. **始终提供静态回退**：为不支持 `if()` 的浏览器提供降级值
3. **if 与 ( 紧贴**：避免最常见的语法错误
4. **避免过深嵌套**：超过两层嵌套建议拆分为多个声明或使用 at-rule
5. **适度混合条件类型**：三类条件可混合，但保持逻辑清晰
6. **生产环境用 @supports 检测**：确保仅在支持的浏览器应用 `if()`

## 总结

CSS `if()` 是 CSS 条件机制的重要补充，把条件判断从"完整规则块"细化到"单属性值"，特别适合只切换单个属性的场景。三类条件类型 `style()` / `media()` / `supports()` 覆盖所有条件查询需求，可混合使用、按顺序短路求值，配合 `else` 兜底与静态回退声明实现渐进增强。

虽然目前 `if()` 尚未进入 Baseline（仅 Chrome 137+ 实验性支持），但其设计理念代表了 CSS 的演进方向——更细粒度的条件化、更声明式的语法、更组件级可控。学习并掌握 `if()` 有助于在浏览器支持普及后快速落地，同时也能更深入理解 CSS 条件机制的整体设计。

配套工具：[CSS if() 条件函数生成器](/css-if)——可视化编辑三类条件分支，多分支管理与 iframe 沙箱预览，实时生成 CSS 代码，内置 8 组预设覆盖暗色模式、响应式、特性降级等场景。
