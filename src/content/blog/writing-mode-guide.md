---
title: 'CSS writing-mode 书写模式完全指南：竖排文字、多语言排版与国际化文本方向'
description: '深入解析 CSS writing-mode 书写模式：5 种值详解、text-orientation 与 direction 多语言文本方向、text-combine-upright 数字横排，附中文竖排与 RTL 实战示例。'
pubDate: 2026-07-14
tags: ['CSS', 'writing-mode', '竖排', '竖排文字', '中文竖排', '日文竖排', 'text-orientation', 'direction', 'rtl', '阿拉伯文', '蒙古文', 'text-combine-upright', 'vertical-rl', 'vertical-lr', '古籍排版', '多语言', '国际化', '前端开发', '设计工具']
relatedTool: '/writing-mode'
---

CSS `writing-mode` 是控制文本流向的核心属性，它决定文字按什么方向排列、行按什么方向换行。从中文古籍竖排到阿拉伯文从右到左，从日文漫画排版到蒙古文垂直书写，writing-mode 是多语言国际化的基石。本文系统解析 writing-mode 的 5 个值、text-orientation 文字朝向、direction 与 unicode-bidi 文本方向、text-combine-upright 数字横排等核心机制。

## 一、writing-mode 属性概览与文本流方向

`writing-mode` 决定<strong>文本流方向</strong>——文字沿什么方向排列（行内方向），行沿什么方向堆叠（块流向）。CSS 定义了 5 个值，覆盖全球所有书写系统：

| 值 | 行内方向 | 块流向 | 适用语言 |
|------|----------|--------|----------|
| `horizontal-tb` | 水平从左到右 | 从上到下 | 中文、英文、法文等大多数语言（默认） |
| `vertical-rl` | 垂直从上到下 | 从右到左 | 中文古籍、日文竖排 |
| `vertical-lr` | 垂直从上到下 | 从左到右 | 蒙古文、满文 |
| `sideways-rl` | 垂直从下到上 | 从右到左 | 西文侧排（少见） |
| `sideways-lr` | 垂直从上到下 | 从左到右 | 西文侧排（少见） |

```css
/* 默认横排 */
.article { writing-mode: horizontal-tb; }

/* 中文古籍竖排 */
.classic { writing-mode: vertical-rl; }

/* 蒙古文竖排 */
.mongolian { writing-mode: vertical-lr; }
```

理解 writing-mode 的关键：它改变的是<strong>文本流</strong>本身，而非视觉变换。这意味着文本选择、光标移动、屏幕阅读器朗读都按新的方向进行，远优于 `transform: rotate` 等视觉模拟方案。

## 二、writing-mode 的 5 个值详解

### 1. horizontal-tb（默认水平横排）

标准横排模式，文字水平排列，行从上到下换行。适用于中英文、法文、德文等大多数语言。无需显式声明，浏览器默认值。

### 2. vertical-rl（垂直从右到左）

文字垂直排列（从上到下），行从右到左堆叠。模拟中文古籍"从右往左翻"的阅读顺序：

```css
.classic-chinese {
  writing-mode: vertical-rl;
  text-orientation: upright; /* 汉字正立 */
  letter-spacing: 8px;       /* 字间距 */
}
```

适合：中文古籍、日文竖排小说、台湾传统中文排版。

### 3. vertical-lr（垂直从左到右）

文字垂直排列，行从左到右堆叠。与 vertical-rl 唯一区别是行的换行方向：

```css
.mongolian {
  writing-mode: vertical-lr;
  text-orientation: sideways; /* 字符侧躺 */
}
```

适合：蒙古文、满文传统竖排（行从左往右换）。

### 4. sideways-rl 与 sideways-lr（侧向排列）

与 vertical-* 的区别：sideways-* 让<strong>所有字符整体旋转 90°</strong>（包括 CJK 方块字），而 vertical-* 让 CJK 字符正立、拉丁字符侧躺。

```css
.vertical-label {
  writing-mode: sideways-rl; /* 西文整体侧躺，适合纵向标签 */
}
```

适合：纵向 UI 标签、侧边栏文字。注意：sideways-* 浏览器支持较新（Chrome 91+、Safari 16+），生产环境需确认兼容性。

## 三、text-orientation 文字朝向：mixed / upright / sideways

`text-orientation` 仅在 <strong>vertical-*</strong> 模式下生效，决定字符在垂直行中的朝向：

| 值 | CJK 字符 | 拉丁字母/数字 | 适用场景 |
|------|----------|----------------|----------|
| `mixed`（默认） | 正立 | 侧躺 90° | 日文混排（汉字+假名+西文） |
| `upright` | 正立 | 正立 | 纯中文古籍、所有字符正立 |
| `sideways` | 侧躺 90° | 侧躺 90° | 西文侧排、蒙古文 |

```css
/* 日文混排：汉字正立，假名与西文侧排 */
.japanese { writing-mode: vertical-rl; text-orientation: mixed; }

/* 纯中文古籍：所有字符正立 */
.chinese-classic { writing-mode: vertical-rl; text-orientation: upright; }

/* 西文侧排：所有字符侧躺 */
.western-vertical { writing-mode: vertical-rl; text-orientation: sideways; }
```

**关键差异**：
- `mixed`：CJK 与西文混合排版的最优解，浏览器自动判断字符类型
- `upright`：强制所有字符正立，适合纯 CJK 内容
- `sideways`：强制所有字符侧躺，适合西文纵向显示

## 四、direction 与 unicode-bidi：多语言文本方向

`direction` 决定文本的水平流向：

```css
.arabic { direction: rtl; }  /* 阿拉伯文从右到左 */
.chinese { direction: ltr; } /* 中文从左到右（默认） */
```

**direction 在不同 writing-mode 下的作用**：
- `horizontal-tb`：决定文本水平流向（ltr 或 rtl）
- `vertical-rl`：决定行的换行方向（ltr 时行从右往左换，rtl 时行从左往右换）
- `vertical-lr`：决定行的换行方向（与 vertical-rl 相反）

### unicode-bidi 处理混合方向

当页面中同时存在 LTR 和 RTL 文本（如中英混排的阿拉伯文段落），需配合 `unicode-bidi`：

```css
.bidi-mixed {
  direction: rtl;
  unicode-bidi: isolate; /* 隔离嵌套文本方向 */
}
```

`unicode-bidi` 的常用值：
- `normal`（默认）：不额外处理双向文本
- `embed`：嵌入方向性内容
- `isolate`：隔离嵌套文本的方向影响
- `bidi-override`：强制覆盖文本方向
- `isolate-override`：隔离 + 覆盖
- `plaintext`：根据内容自动判断方向

## 五、text-combine-upright 数字横排

`text-combine-upright` 让多个字符在垂直行中<strong>横向组合</strong>显示为一个字符宽度，解决竖排文本中数字/英文需要横排的需求：

```css
.vertical-text {
  writing-mode: vertical-rl;
  text-combine-upright: digits 2; /* 数字按 2 位横排 */
}
```

| 值 | 效果 |
|------|------|
| `none`（默认） | 不组合，每个字符垂直排列 |
| `all` | 行内所有连续字符横向组合为一个单元 |
| `digits <n>` | 仅数字横向组合，n 为最大位数（2-4） |

**应用场景**：
- 中文古籍中的年号（如"二〇二六年"中的数字）
- 竖排表格中的数字数据
- 日文竖排中的西文年份、电话号码

**digits 的位数规则**：
- `digits 2`：最多 2 位数字横排（如"2026"显示为"20"和"26"两组横排）
- `digits 4`：最多 4 位数字横排（如"2026"整体横排）

注意：`digits` 浏览器支持不一，生产环境建议降级为 `all`。

## 六、vertical-rl 与 vertical-lr 选型与典型场景

两者都是垂直书写，差别在<strong>行的换行方向</strong>：

| 模式 | 第一行位置 | 后续行方向 | 典型语言 |
|------|-----------|-----------|----------|
| `vertical-rl` | 最右 | 向左换行 | 中文古籍、日文 |
| `vertical-lr` | 最左 | 向右换行 | 蒙古文、满文 |

### 1. 中文古籍竖排（vertical-rl + upright）

```css
.classic-chinese {
  writing-mode: vertical-rl;
  text-orientation: upright;
  letter-spacing: 8px;       /* 字间距，模拟古籍版式 */
  line-height: 1.4;
  font-family: 'KaiTi', serif;
}
```

所有汉字正立，行从右往左排列，模拟古籍"从右往左翻"的阅读体验。

### 2. 日文竖排（vertical-rl + mixed）

```css
.japanese-novel {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  line-height: 1.8;
}
```

汉字正立，假名与西文侧躺，适合日文小说、漫画对白。

### 3. 蒙古文竖排（vertical-lr + sideways）

```css
.mongolian {
  writing-mode: vertical-lr;
  text-orientation: sideways;
}
```

蒙古文字符侧躺（蒙古文传统就是侧躺书写），行从左往右换。

### 4. 现代杂志竖排标题（vertical-rl + mixed）

```css
.magazine-title {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-size: 32px;
  font-weight: 700;
}
```

中英混排的杂志竖排标题，西文侧躺，中文正立。

## 七、writing-mode 与 transform: rotate 的本质区别

### transform: rotate 的局限

```css
/* 不推荐的竖排方案 */
.bad-vertical {
  transform: rotate(180deg);
  /* 问题：文本流仍是横排，仅视觉旋转 */
}
```

**transform: rotate 的问题**：
1. **文本选择错误**：横排文本旋转后，仍按横排方向选择
2. **光标移动错误**：按左右键仍按横排逻辑移动，与视觉不符
3. **屏幕阅读器错误**：按 DOM 顺序朗读，非视觉顺序
4. **无法自动换行**：超出容器宽度不会自动断行
5. **可访问性差**：辅助技术无法正确识别文本结构

### writing-mode 的优势

```css
/* 推荐的竖排方案 */
.good-vertical {
  writing-mode: vertical-rl;
  /* 优势：文本流改为垂直，语义化 */
}
```

**writing-mode 的优势**：
1. **文本选择按视觉方向**：竖排时按垂直方向选择
2. **光标移动符合视觉**：按上下键移动
3. **屏幕阅读器按视觉顺序朗读**
4. **自动换行**：按行高自动断行
5. **可访问性良好**：辅助技术正确识别

**结论**：所有需要改变文本流的场景都应优先用 writing-mode，transform: rotate 仅用于装饰性旋转（如图标旋转）。

## 八、浏览器兼容性与性能优化与配套工具协同

### 浏览器兼容性

| 特性 | Chrome | Firefox | Safari | Edge |
|------|--------|---------|--------|------|
| writing-mode（vertical-*） | 48+ | 36+ | 11+（-webkit-） | 12+ |
| writing-mode（sideways-*） | 91+ | 69+ | 16+ | 91+ |
| text-orientation | 53+ | 36+ | 10.1+ | 12+ |
| text-combine-upright | 48+（-webkit-） | 48+ | 10.1+（-webkit-） | 12+ |
| direction | 1+ | 1+ | 1+ | 12+ |

**兼容性建议**：
1. 老版本浏览器需加 `-webkit-` 前缀（Safari 10-）
2. `sideways-*` 支持较新，移动端 iOS Safari 16+ 才支持
3. `text-combine-upright` 的 `digits` 值支持不一，建议降级为 `all`
4. 旧版 IE 支持 `-ms-writing-mode`（值不同：lr-tb / tb-rl 等），需单独处理

### 性能优化

1. **writing-mode 原生处理**：浏览器原生支持，无 JavaScript 开销
2. **避免频繁切换**：切换 writing-mode 会触发布局重排，避免动画中频繁切换
3. **合理使用 line-height**：垂直模式下 line-height 控制行间距（垂直方向），与横排不同
4. **letter-spacing 在垂直模式下的作用**：控制字符垂直间距，与横排的字间距不同
5. **避免嵌套 writing-mode**：嵌套不同 writing-mode 的元素会导致布局复杂，谨慎使用

### 配套工具协同

- [writing-mode 生成器](/writing-mode)：本工具，书写模式可视化
- [flexbox 弹性盒子](/flexbox)：配合 writing-mode 实现多语言布局
- [grid 网格布局](/grid)：二维布局与 writing-mode 协同
- [scroll-snap 滚动捕捉](/scroll-snap)：竖排滚动捕捉场景

writing-mode 是 CSS 国际化能力的核心——从中文古籍到阿拉伯文 RTL，从日文漫画到蒙古文传统，writing-mode 让浏览器原生支持全球所有书写系统。配合 direction、text-orientation、text-combine-upright，可覆盖所有多语言排版需求。使用 [writing-mode 生成器](/writing-mode) 可视化编辑上述所有场景，实时预览，一键复制 CSS 代码。
