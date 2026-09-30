# AI Learning App - Design System

> 当前版本基线：Warm Minimalism × Signal Glass

---

## 设计原则

1. **低认知负担** - 单屏只做一事，信息密度极低，默认路径最短
2. **结构先于装饰** - 科技感来自网格、线、局部高光和材质层次，不靠堆砌特效
3. **继续学习优先** - 首页和目录页都优先服务“继续当前进度”，再服务发现新主题
4. **温暖底色 + 冷色信号** - 页面主基调保持暖白与橙色，科技感只通过冷蓝信号局部出现

---

## 1. 视觉系统

### 1.1 色彩系统

```css
/* 唯一事实来源：app/globals.css 的 :root，本表只做说明 */
/* 背景色 */
--color-background: #F7F7F5;      /* 主背景 - 偏暖灰白 */
--color-surface: #FFFFFF;         /* 卡片背景 */
--border-subtle: #EAEAEA;         /* 分隔线 */

/* 文字色（对比度按 #F7F7F5 背景计算） */
--color-text-primary: #1F1F1F;    /* 标题 - 近黑 */
--color-text-secondary: #5C5C5C;  /* 正文 - 6.2:1 */
--color-text-tertiary: #707070;   /* 辅助文字 - 4.6:1，正文可用下限 */
--color-text-disabled: #999999;   /* 仅禁用态，2.9:1，不得承载信息 */
--color-text-placeholder: #BDBDBD;/* 仅 placeholder */

/* CTA 与强调色 */
--color-cta: #1A1A1A;             /* 主 CTA 背景，白字 17:1 */
--color-accent: #FF8A00;          /* 橙色点缀 */
--accent-signal: #38BDF8;         /* 信号冷蓝 - 只用于头部科技感 */

/* 语义色 */
--color-success: #34C759;
--color-warning: #FF9500;
--color-error: #EF476F;
--color-locked: #BDBDBD;
```

**对比度约束（WCAG AA）**
- 正文文字 ≥ 4.5:1；大字（≥18px 粗体 / ≥24px）和图标 ≥ 3:1
- `#8A8A8A` 在主背景上只有 3.2:1，**禁止**再作为正文色
- 橙色 `#FF8A00`、绿色 `#34C759`、`#FF9500` 上放白字只有 2.2–2.4:1，**禁止**用于承载文字的按钮；文字按钮用 `--color-cta` 黑底白字，橙色填充上的文字改用近黑 `#1F1F1F`（7:1）
- 状态不能只靠颜色区分，需配合图标或文字

### 1.2 字体系统

| 层级 | 大小 | 用途 |
|------|------|------|
| H1 | 28-32px | 页面标题 |
| H2 | 20-24px | 模块标题 |
| Body | 14-16px | 正文 |
| Caption | 12px | 辅助信息 |

**特点**: 字少，行距大，不堆信息

**字体栈**: `'Baloo 2', -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`
- Baloo 2 只覆盖拉丁字符与数字；中文实际由 PingFang SC 等系统字体渲染，调字重时以中文效果为准
- 正文最小 14px（移动端输入框 16px，防止 iOS 自动缩放），行高 1.5–1.75

### 1.3 间距系统 (8pt Grid)

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;   /* 卡片内边距 */
--space-5: 20px;   /* 页面边距 */
--space-6: 24px;   /* 模块间距 */
--space-8: 32px;
```

**规则**:
- 卡片内边距: 16
- 模块间距: 24
- 页面边距: 20

### 1.4 圆角系统

| Token | 数值 | 用途 |
|------|------|------|
| `--radius-sm` | 12px | 小控件、图标底 |
| `--radius-md` | 16px | 内嵌块、菜单浮层 |
| `--radius-lg` | 24px | 卡片 |
| `--radius-xl` | 32px | Hero 输入区等大面板 |
| `--radius-pill` | 9999px | 按钮、标签、头像 |

**禁止**: 新增 `rounded-[Npx]` 任意值；现有 18/20/22/28/30/36px 属于历史债，改到相关组件时收敛到上表

### 1.5 阴影层级

```css
--shadow-card: 0 2px 12px rgba(0, 0, 0, 0.06);    /* 卡片 */
--shadow-nav: 0 4px 20px rgba(0, 0, 0, 0.08);     /* 导航 */
--shadow-sheet: 0 8px 40px rgba(0, 0, 0, 0.1);    /* 底部面板 */
--shadow-float: 0 12px 36px rgba(17, 24, 39, 0.12); /* 菜单/弹窗浮层 */
```

**禁止**: 使用更重的阴影

### 1.6 背景纹理

- 仅在头部局部使用渐隐网格或信号线
- 网格必须“从局部出现并逐渐消散”，不能铺满全屏
- **用途**: 强化 AI 产品属性，但不能干扰文字识读
- **禁止**: 把网格、扫描线、数据纹理放进正文区、弹窗区、课程卡大面积背景

### 1.7 当前首页风格准则

#### 头部
- 标题允许一个记忆点：局部网格、标记线、或冷色光晕，最多保留 2 个同时存在
- H1 必须保持高识读，禁止大面积浅色渐变字
- 头部说明文案只说一件事，不要重复解释输入规则

#### 输入区
- 输入区是“主任务区”，而不是聊天框
- 优先使用稳的浅色实体面，不要过强玻璃拟态
- 示例文案更适合作为 placeholder，而不是额外占位提示
- 主按钮要独立但贴近输入区，像一组操作，不要塞进输入框内部

#### 课程卡
- 课程卡统一采用暖色渐变底，避免与头部冷色科技感冲突
- 第一张卡可以略大一级，但不能像另一套组件
- 进度信息只保留一个核心数字，避免重复表达
- 管理入口要弱于主按钮，但 hover 时要有明确反馈

#### 课程目录页
- 以“学习路线图”作为主要信息架构，而不是普通目录列表
- 页首只保留少量概览：标题、进度、总章节、下一步 CTA
- 节点列表必须明确区分：现在学习 / 下一节 / 已完成 / 待解锁
- 路径感主要来自纵向时间线、节点状态和间距节奏

---

## 2. 核心组件

### 2.1 Hero Input (核心组件)

```css
.hero-input-shell {
  background: rgba(255,255,255,0.92);
  border: 1px solid rgba(255,255,255,0.75);
  border-radius: 30px;
  box-shadow: 0 16px 38px rgba(148,163,184,0.08);
}

.hero-input {
  min-height: 152px;
  padding: 20px;
  background: transparent;
}
```

**规则**
- 示例只作为 placeholder 出现
- 聚焦状态只做轻边框和轻阴影变化
- 不能出现聊天发送框式的小按钮内嵌结构

### 2.2 Button

```css
/* Primary - 主路径 */
.btn-primary {
  background: #1A1A1A;
  color: white;
  border-radius: 28px;
  height: 48-56px;
  padding: 0 32px;
  font-weight: 600;
}

/* Secondary - 辅助 */
.btn-secondary {
  background: transparent;
  border: 1.5px solid var(--border-subtle);
  color: var(--text-primary);
  border-radius: 24px;
}

/* Ghost - 弱操作 */
.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
}
```

**禁止**: 同屏出现多个 Primary

### 2.3 Course Card

- 暖色渐变底 + 白色轻浮层进度块
- 左侧内容优先，右侧只保留一个核心进度数字
- 底部一行只出现一个主按钮 + 一个弱管理入口
- 菜单浮层必须脱离卡片背景，有独立阴影和最小宽度

### 2.4 空状态 (Empty State)

**必须包含**: 插画 + 情绪文案 + 行动按钮

**禁止**: 只有文字 / 只有按钮

---

## 3. 交互系统

### 3.1 动效规范

| 类型 | 时长 |
|------|------|
| 点击反馈 | 100-150ms |
| 页面切换 | 200-300ms |
| 成功反馈 | ≤400ms |

- 统一使用 `--duration-fast/normal/slow`（150/200/300ms）与 `--ease-out`
- 只动画 `transform` / `opacity`，不动画 width/height/top 等引发重排的属性
- 必须尊重 `prefers-reduced-motion`：Framer Motion 用 `useReducedMotion()` 或全局 `<MotionConfig reducedMotion="user">`，降级为淡入或静态终态

### 3.2 反馈原则 (强约束)

**所有用户行为必须有**:
1. 状态变化（视觉）
2. 动效
3. 结果提示

---

## 4. 组件状态定义

| 状态 | 表现 |
|------|------|
| 默认 | 正常显示 |
| 选中 | scale 1.05 + 高亮边 |
| 错误 | 轻抖动 |
| 成功 | 弹跳 |
| 禁用 | 低对比灰 + 不可点击 |

---

## 5. 可访问性与交互底线

- 可点击元素触控区 ≥ 44×44px（`--touch-target-min`），相邻目标间距 ≥ 8px
- 键盘焦点必须可见：用 `focus-visible:` 显示 2px 焦点环，禁止只写 `outline-none`
- 图标按钮必须有 `aria-label`；图标统一用 SVG（Lucide），禁止用 emoji 当图标
- 异步操作按钮在请求中禁用并显示加载态；错误提示放在出错位置附近，说明原因和下一步
- 布局验证宽度：375 / 768 / 1024 / 1440px，移动端不得横向滚动

---

## 6. Tailwind 配置

> Tailwind v4 未通过 `@config` 加载 `tailwind.config.ts`；颜色、圆角、阴影 token 以 `app/globals.css` 的 `:root` 和其中的工具类为准。下方为语义映射参考，新增 token 先加到 globals.css。

```ts
colors: {
  // 背景
  background: '#F7F7F5',
  surface: '#FFFFFF',
  border: '#EAEAEA',

  // 文字
  'text-primary': '#1F1F1F',
  'text-secondary': '#5C5C5C',

  // 强调
  accent: '#FF8A00',

  // 语义
  success: '#34C759',
  warning: '#FF9500',
  disabled: '#BDBDBD',
},

borderRadius: { sm: '12px', md: '16px', lg: '24px', xl: '32px', pill: '9999px' },

boxShadow: {
  card: '0 2px 12px rgba(0, 0, 0, 0.06)',
  float: '0 12px 36px rgba(17, 24, 39, 0.12)',
},
```

---

## 7. 禁止事项 (Anti-Patterns)

| ❌ 禁止 | ✅ 正确 |
|---------|--------|
| 头部同时堆 4 种科技元素 | 只保留 1-2 个最有识别度的信号元素 |
| 大面积冷蓝铺满页面 | 冷蓝只在头部局部出现 |
| 输入区做成聊天框/消息框 | 输入区保持“任务输入”气质 |
| 课程卡五颜六色无规则 | 课程卡只在暖色族内轮换 |
| 管理入口比主按钮更抢眼 | 主按钮始终是视觉第一动作 |
| 弹窗/菜单和背景融为一体 | 浮层必须有独立层次 |
| 橙/绿底上放白字 | 文字按钮用黑底白字，橙底配近黑字 |
| 新增任意圆角值 | 只用 radius token |
| 动效无视系统减少动态设置 | 尊重 `prefers-reduced-motion` |

---

## 8. 交付前自检

- [ ] 颜色、圆角、阴影全部来自 token，无新增硬编码色值
- [ ] 文字对比度达标（正文 4.5:1，大字/图标 3:1）
- [ ] 同屏只有一个 Primary 按钮
- [ ] 所有可点击元素有 hover / active / focus-visible / disabled 状态
- [ ] 动效 150–300ms，且已处理 reduced motion
- [ ] 375px 宽度下无横向滚动、无内容被固定栏遮挡
- [ ] 空状态、加载态、错误态都已设计
