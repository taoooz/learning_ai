# Agent 工作守则                                                                                           
你可自主更新此文件，但要严格控制全文长度
                                                                                               
## 对话语言                                                                                                              
- 必须使用中文与用户对话

## 项目信息
- **项目：** AI Learning（Duolingo 风格 AI 学习产品）
- **用户：** 中文用户
- **技术栈：** Next.js, LLM API（OpenAI 兼容）, Tailwind CSS v4, Framer Motion, localStorage
- **已关联Github、Vercel 项目**

---

## 核心规范

### 1. 界面文本
- 所有用户可见文本使用中文，考虑真实使用场景

### 2. 代码质量
- 提交信息用中文，描述改动目的
- 每次代码改动后自检：变量命名、错误处理、边界情况、用户体验

### 3. 独立判断
- 用户提出观点时先独立分析，不盲目迎合
- 如果认为不对，直接提出异议和理由

### 4. CHANGELOG
- 每次功能/修复完成后立即更新 CHANGELOG.md
- 超过50行时压缩归档

---

## 技术注意

### LLM API
- 服务：OpenAI 兼容，端点 `http://muses-openapi-prod.weizhipin.com/v1`
- 模型：`zhipu/glm-5.3-flash`
- 环境变量：`LLM_API_KEY` / `LLM_API_BASE` / `LLM_MODEL`（密钥只放 .env* 文件，勿进源码）

### Tailwind CSS v4
- 使用 `@import "tailwindcss"`，不支持 `@apply`

### Next.js
- 路由：`/app/page.tsx` → `/`，`/app/api/xxx/route.ts` → `/api/xxx`

---

## 权限（不需要申请）

直接执行：
- 使用 Skills（brainstorming、writing-plans 等）
- Subagent 分工（多个独立任务时）
- 已知功能的 bug 修复

需要确认：创建/删除文件、修改项目配置、架构性改动

---

## 完成后规则

给出下一步优化建议，说明价值和优先级，让用户选择下一步。
