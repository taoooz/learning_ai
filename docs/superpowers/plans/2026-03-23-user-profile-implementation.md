# 用户画像功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 用户可以维护个人简历和求职意向，生成课程时自动使用这些信息提升内容质量。

**架构：**
- 新增 `UserProfile` 类型和相关接口
- 扩展 localStorage 的 `StoredData` 结构
- 创建 `UserProfileContext` 管理用户画像状态
- 新增 `/profile` 页面用于维护信息
- 修改 prompt 生成逻辑，拼接用户背景

**技术栈：** Next.js, React Context, localStorage, Tailwind CSS

---

## 任务清单

### Task 1: 类型定义

**Files:**
- Modify: `types/course.ts`

**Steps:**
- [ ] 添加 `WorkExperience`, `Education`, `UserProfile` 接口
- [ ] 扩展 `StoredData` 添加 `userProfile: UserProfile | null`

```typescript
// types/course.ts 新增

export interface WorkExperience {
  id: string;
  company: string;
  position: string;
  description?: string;
}

export interface Education {
  id: string;
  school: string;
  major: string;
}

export interface UserProfile {
  targetJob: string;
  workExperience: WorkExperience[];
  education: Education[];
}
```

- [ ] Commit: `types: add UserProfile, WorkExperience, Education interfaces`

---

### Task 2: Storage 层

**Files:**
- Modify: `lib/storage.ts`

**Steps:**
- [ ] 扩展 `defaultData` 添加 `userProfile: null`
- [ ] 新增 `getUserProfile(): UserProfile | null` 函数
- [ ] 新增 `saveUserProfile(profile: UserProfile): void` 函数

```typescript
// lib/storage.ts 新增

export function getUserProfile(): UserProfile | null {
  const data = getStoredData();
  return data.userProfile;
}

export function saveUserProfile(profile: UserProfile): void {
  const data = getStoredData();
  data.userProfile = profile;
  saveStoredData(data);
}
```

- [ ] Commit: `storage: add getUserProfile and saveUserProfile functions`

---

### Task 3: UserProfileContext

**Files:**
- Create: `contexts/UserProfileContext.tsx`

**Steps:**
- [ ] 创建 `UserProfileContext` 包含：
  - `userProfile: UserProfile | null`
  - `updateProfile: (profile: UserProfile) => void`
  - `isLoaded: boolean` 加载状态
- [ ] 从 localStorage 初始化
- [ ] 提供 `useUserProfile` hook

```typescript
// contexts/UserProfileContext.tsx

interface UserProfileContextType {
  userProfile: UserProfile | null;
  updateProfile: (profile: UserProfile) => void;
  isLoaded: boolean;
}

export function UserProfileProvider({ children }: { children: React.ReactNode }) {
  // 从 localStorage 恢复数据
  // 提供 updateProfile 保存数据
}

export function useUserProfile() {
  // return useContext(UserProfileContext)
}
```

- [ ] 在 `contexts/index.tsx` 中导出新的 Provider
- [ ] Commit: `contexts: add UserProfileContext`

---

### Task 4: Profile 页面

**Files:**
- Create: `app/profile/page.tsx`

**Steps:**
- [ ] 页面布局：返回首页按钮 + 两个区块
- [ ] 求职意向：单个输入框
- [ ] 个人简历：
  - 姓名输入框
  - 工作经历（可添加/删除多段）
  - 教育经历（可添加/删除多段）
- [ ] 保存按钮，点击保存到 localStorage
- [ ] 加载时从 localStorage 读取已有数据

**组件结构：**
```tsx
// app/profile/page.tsx
export default function ProfilePage() {
  const { userProfile, updateProfile } = useUserProfile();
  // 表单状态管理
  // 保存逻辑
}
```

- [ ] Commit: `pages: add /profile page for user profile management`

---

### Task 5: 首页添加入口

**Files:**
- Modify: `app/page.tsx`

**Steps:**
- [ ] 右上角添加用户图标按钮
- [ ] 点击跳转到 `/profile`

```tsx
// 在首页布局中添加
<button
  onClick={() => router.push('/profile')}
  className="absolute top-4 right-4 ..."
>
  {/* 用户图标 */}
</button>
```

- [ ] Commit: `homepage: add profile entry button in top right corner`

---

### Task 6: Prompt 扩展

**Files:**
- Modify: `lib/prompt.ts`

**Steps:**
- [ ] 修改 `buildCourseTreePrompt` 接收可选的 `userProfile` 参数
- [ ] 如果有用户画像，拼接到 prompt 前面

```typescript
// lib/prompt.ts

export function buildCourseTreePrompt(topic: string, userProfile?: UserProfile | null): string {
  let profileSection = '';

  if (userProfile) {
    profileSection = `
用户背景信息：
- 目标岗位：${userProfile.targetJob || '未填写'}
- 工作经历：
  ${userProfile.workExperience.map(w => `- ${w.company}，${w.position}`).join('\n  ') || '暂无'}
- 教育背景：
  ${userProfile.education.map(e => `- ${e.school}，${e.major}`).join('\n  ') || '暂无'}

基于以上背景，为"${topic}"创建学习路径时，请考虑：
1. 如果工作经历与"${topic}"相关，课程可以更深入
2. 如果是转行（工作经历与目标岗位无关），需要从基础开始
3. 结合"${userProfile.targetJob}"岗位的实际需求设计内容侧重点
`;
  }

  return `${profileSection}
You are an AI tutor creating a personalized learning path for the topic: "${topic}"
...
`;
}
```

- [ ] Commit: `prompt: extend buildCourseTreePrompt to accept user profile`

---

### Task 7: API 集成

**Files:**
- Modify: `app/api/generate/route.ts`

**Steps:**
- [ ] 在 API 中获取用户画像
- [ ] 传递给 `buildCourseTreePrompt`

```typescript
// app/api/generate/route.ts

export async function POST(request: NextRequest) {
  try {
    const { topic } = await request.json();
    const userProfile = getUserProfile(); // 从 storage 获取

    const prompt = buildCourseTreePrompt(topic, userProfile);
    // ...
  }
}
```

- [ ] Commit: `api: integrate user profile into course generation`

---

### Task 8: 更新 CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

**Steps:**
- [ ] 添加本次新功能记录

- [ ] Commit: `changelog: document user profile feature`
