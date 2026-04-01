# 验收清单

## 已完成的修改

### ✅ 问题1：课程纲要生成 prompt 优化
**文件**：`lib/prompt.ts`
- `buildOutlinePrompt`：只在有内容时添加段落，减少空白内容
- `buildTocPrompt`：优化课程名称生成要求（8-15字，不含"课程"）

**验收方法**：
1. 创建新课程，输入主题
2. 检查生成的课程名称是否简洁（不含"课程"二字）
3. 检查课程描述是否说明"学完能做什么"

---

### ✅ 问题2：节点生成字段优化
**文件**：
- `types/course.ts`：移除 `NodeLessonPromptPayload.nodeTopic`
- `app/api/generate/node/route.ts`：移除传入的 `nodeTopic`
- `scripts/*.ts`：同步更新

**验收方法**：
1. 进入课程第一节学习
2. 打开浏览器 Network 面板
3. 查看 `/api/generate/node` 请求体，确认没有 `nodeTopic` 字段

---

### ✅ 问题3：防止重复请求
**文件**：
- `app/generate/confirm/page.tsx`：添加 `hasRequestedRef`
- `app/generate/toc/page.tsx`：添加 `hasRequestedRef`
- `app/course/[courseId]/learn/[nodeIndex]/page.tsx`：添加 `hasRequestedRef`
- `contexts/CourseContext.tsx`：重构 `preloadNextNode`，移除依赖

**验收方法**：
1. 打开浏览器 Network 面板
2. 创建新课程，观察 `/api/agents/outline` 请求次数（应该只有1次）
3. 确认课程纲要，观察 `/api/generate/toc` 请求次数（应该只有1次）
4. 进入第一节学习，观察 `/api/generate/node` 请求次数（应该只有1次）
5. 完成第一节，进入第二节，观察是否只有1次请求

---

### ✅ 问题4：Agent 流式输出支持
**文件**：
- `app/api/agents/outline/route.ts`：支持流式响应转发
- `contexts/CourseContext.tsx`：支持流式接收（SSE）
- `.worktrees/agent-feature/python-agent/main.py`：返回 SSE 流式响应

**验收方法**：
1. 启动 Python Agent 服务：
   ```bash
   cd .worktrees/agent-feature/python-agent
   source venv/bin/activate
   uvicorn main:app --reload
   ```
2. 创建新课程时应该看到：
   - 先显示"正在分析你的需求..."
   - 然后显示最终结果
   - Network 面板中 `/api/agents/outline` 的 Type 显示为 `eventsource`
3. 回答澄清问题时应该看到：
   - 先显示"正在处理你的回答..."
   - 然后显示下一个问题或最终结果

**注意**：流式输出已完全实现，前后端都已支持。

---

## 关键验收点

### 🔍 重复请求检查（最重要）
在以下场景中，每个 API 应该**只调用一次**：
1. ✅ 生成课程纲要（confirm 页面）
2. ✅ 生成课程目录（toc 页面）
3. ✅ 生成节点内容（learn 页面）
4. ✅ 预加载下一节内容（learn 页面切换时）

### 🎯 用户体验检查
1. ✅ 课程名称简洁有吸引力
2. ✅ 课程描述说明学完能做什么
3. ✅ 页面不会因为重复请求失败而崩溃
4. ✅ 流式输出（如果 Python Agent 支持）响应更快

---

## 如何验收

### 完整流程测试
1. 打开浏览器开发者工具 → Network 面板
2. 清空 localStorage（可选，确保干净环境）
3. 输入主题，点击"开始学习"
4. 观察 `/api/agents/outline` 请求次数（应该只有1次）
5. 如果有澄清问题，回答后观察请求次数（每次回答1次）
6. 确认课程纲要，观察 `/api/generate/toc` 请求次数（应该只有1次）
7. 进入课程页面，点击第一节
8. 观察 `/api/generate/node` 请求次数（应该只有1次）
9. 完成第一节，进入第二节
10. 观察第二节的请求次数（应该只有1次，且可能在第一节时已预加载）

### 预期结果
- ✅ 所有页面只发起一次有效请求
- ✅ 没有重复请求导致的错误
- ✅ 课程名称和描述符合优化要求
- ✅ 流式输出工作正常（如果 Python Agent 支持）

---

## 相关文档
- `CHANGELOG.md`：详细的修改记录
- `AGENT_OPTIMIZATION.md`：流式输出实现说明和 Python Agent 示例代码
