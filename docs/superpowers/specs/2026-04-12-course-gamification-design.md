# 课程目录页游戏化设计

## 问题

课程目录页（`/course/[courseId]`）生成后静态展示章节列表，用户缺乏持续学习的驱动力和成就感。Duolingo 在这方面做得最好，值得借鉴。

## 范围

**包含：**
- 连续学习天数（Streak Fire），集成到 CourseHeaderBar
- 学习进度里程碑动画
- 课程完成庆祝弹窗

**不包含：**
- XP 系统
- 排行榜
- 每日目标
- 音效

---

## 1. Streak Fire（连续学习火焰）

### 数据模型

```typescript
interface StreakData {
  currentStreak: number;   // 当前连续天数
  bestStreak: number;      // 历史最长连续天数
  lastStudyDate: string;   // 上次学习日期，ISO 8601（如 "2026-04-12"）
}
```

存储位置：`localStorage`，key 为 `streak_data`。

### 新 Hook：`useStreak`

路径：`hooks/useStreak.ts`

职责：
- 读取/写入 `localStorage` 中的 `streak_data`
- 调用 `recordStudy()` 时计算连续天数：
  - 今天已学习过：不重复计数
  - 昨天学过：`currentStreak + 1`
  - 断了超过 1 天：`currentStreak` 重置为 1
- 暴露 `streakData`、`recordStudy()`、`isLoading`

### UI 展示——集成到 CourseHeaderBar

位置：CourseHeaderBar 内部，trailing 区域最左侧，trailing prop 内容在其右侧。

布局结构：

```
[← 返回] [课程标题] [🔥 7] [45% 完成]
```

CourseHeaderBar 新增可选 prop：

```typescript
interface CourseHeaderBarProps {
  title: React.ReactNode;
  backLabel: string;
  onBack: () => void;
  trailing?: React.ReactNode;
  streak?: { count: number; studiedToday: boolean };  // 新增
  maxWidthClassName?: string;
}
```

- 当 `streak` 存在时，在 trailing 前渲染火焰元素
- 不传 streak 则不渲染，不影响其他页面（完全向后兼容）

火焰视觉：
- 图标：inline SVG 火焰（约 16x16），不用 emoji
- 今日已学习：橙色火焰 + 白色数字，`font-semibold text-[13px]`
- 今日未学习：灰色火焰 + 灰色数字，`opacity: 0.4`
- 3 个等级影响颜色深浅：1-2 天浅橙、3-6 天橙色、7+ 天橙红
- `shrink-0`，不压缩

触发时机：用户完成任意一节内容学习后调用 `recordStudy()`。

---

## 2. 进度里程碑动画

### 进度条增强

位置：课程目录页顶部，课程标题下方。

- 进度条颜色根据完成比例渐变：0% 橙色 → 100% 绿色
- 进度条宽度使用 `layoutId` 实现章节完成时的平滑过渡
- 进度 100% 时触发 pulse 动画（0.5s，1 次）

### 章节卡片状态变化

已完成章节（`status: 'completed'`）：
- 左侧序号圆圈变为绿色对勾
- 卡片整体降低透明度（`opacity: 0.7`），让未完成章节更突出

首次完成章节时：卡片有一个短暂的 scale bounce 动画（`scale: [1, 1.02, 1]`，持续 0.3s）。

---

## 3. 课程完成庆祝弹窗

### 触发条件

课程中所有章节（nodes）状态变为 `completed` 时弹出。

### 弹窗形式

底部上滑 Sheet（复用 Framer Motion 的 drag 约束模式）。

### 弹窗内容

1. **顶部图标**：奖杯或星星 emoji + 纹纸粒子动效（CSS animation，5 个小圆点从中心向外扩散）
2. **标题**：`"恭喜完成课程！"`
3. **统计信息**：
   - 课程名称
   - 章节数量
   - 学习天数（从 `streakData` 和课程创建时间推算）
4. **推荐课程**：展示 2-3 个推荐课程卡片（复用 `RecommendationsModal` 逻辑）
5. **操作按钮**：
   - "继续学习" → 跳转推荐课程
   - "回到首页" → 跳转 `/`

### 关闭行为

- 向下滑动关闭
- 点击遮罩关闭
- 点击 "回到首页" 按钮关闭并跳转
- **不做自动跳转到首页**

---

## 实现要点

- 所有数据存储在 `localStorage`，不涉及后端
- Streak 计算基于本地日期（`new Date().toISOString().slice(0, 10)`），不考虑时区
- 庆祝弹窗的粒子动效用纯 CSS 实现，不引入额外库
- 推荐课程逻辑复用 `RecommendationsModal` 的数据获取方式

## 涉及文件

| 文件 | 改动 |
|------|------|
| `hooks/useStreak.ts` | 新建，streak 管理 hook |
| `components/CourseHeaderBar.tsx` | 新增 `streak` prop，渲染火焰元素 |
| `app/course/[courseId]/page.tsx` | 集成 streak、进度条增强、庆祝弹窗 |
| `components/CourseNode.tsx` | 已完成章节样式调整、完成动画 |
| `components/CourseCelebrationSheet.tsx` | 新建，庆祝弹窗组件 |
