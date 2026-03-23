# 用户画像与个性化课程设计

## 概述

用户可以维护个人简历和求职意向，这些信息在生成课程时会被拼接到 prompt 中，使 AI 生成更贴合用户背景的课程内容。

## 数据结构

### 用户画像（UserProfile）

```typescript
interface WorkExperience {
  id: string;
  company: string;      // 公司名称
  position: string;     // 岗位
  description?: string;  // 工作内容（可选）
}

interface Education {
  id: string;
  school: string;       // 学校
  major: string;        // 专业
}

interface UserProfile {
  targetJob: string;        // 目标岗位，如"前端工程师"
  workExperience: WorkExperience[];
  education: Education[];
}
```

### 存储结构

```typescript
// types/course.ts
interface StoredData {
  courses: CourseTree[];
  currentCourseId: string | null;
  courseProgress: CourseProgress;
  userProfile: UserProfile | null;  // 新增
}
```

## 页面结构

### 入口
- 首页右上角添加图标按钮
- 点击进入 `/profile` 页面

### /profile 页面
- 顶部：返回首页按钮
- Section 1：求职意向（目标岗位输入框）
- Section 2：个人简历
  - 姓名输入框
  - 工作经历（可多段，每段包含公司、岗位、工作内容）
  - 教育经历（可多段，每段包含学校、专业）
- 底部：保存按钮

## Prompt 拼接策略

在调用 MiniMax 生成课程树时，拼接用户背景信息：

```
用户背景信息：
- 目标岗位：{targetJob}
- 工作经历：
  {workExperience.map(w => `- ${w.company}，${w.position}`).join('\n')}
- 教育背景：
  {education.map(e => `- ${e.school}，${e.major}`).join('\n')}

基于以上背景，为"{topic}"创建学习路径时，请考虑：
1. 如果工作经历与"{topic}"相关，课程可以更深入
2. 如果是转行（工作经历与目标岗位无关），需要从基础开始
3. 结合"{targetJob}"岗位的实际需求设计内容侧重点
```

## 文件改动

| 文件 | 改动 |
|------|------|
| `types/course.ts` | 新增 `WorkExperience`, `Education`, `UserProfile` 类型 |
| `lib/storage.ts` | 新增 `getUserProfile`, `saveUserProfile` 函数 |
| `contexts/` | 新增 `UserProfileContext` 或扩展现有 Context |
| `app/profile/page.tsx` | 新增个人设置页面 |
| `lib/prompt.ts` | 扩展 `buildCourseTreePrompt` 接收用户背景参数 |
| `app/api/generate/route.ts` | 传递用户背景到 prompt |

## 交互说明

1. 用户点击右上角图标进入 profile 页面
2. 可以随时修改信息并保存
3. 保存后数据存储在 localStorage
4. 生成课程时自动使用最新保存的信息
