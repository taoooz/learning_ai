# 课程生成链路全面 Review

## 当前链路分析

### 1. 课程纲要生成（Outline）

**入口**：`/generate` → `/generate/chat` → Python Agent

**流程**：
```
用户输入主题
  ↓
Python Agent 多轮对话（最多3轮提问）
  ↓
生成 Blueprint（课程大纲）
  ↓
前端确认 → TOC 页面
```

**Prompt 构建**：
- **位置**：Python Agent (`services/outline_service.py`)
- **输入数据**：
  - `topic`: 用户主题
  - `userProfile`: { name, targetJob, insights }
  - `userMemory`: PlanningMemoryPayload
    - learnerSnapshot (目标、水平、置信度)
    - transferableBackground (3条背景知识)
    - mustCoverConcepts (3个必讲概念)
    - skippableBasics (2个可跳过基础)
    - riskConcepts (3个风险概念)
    - recentRelevantCourses (3门相关课程)

**生成时机**：
- ✅ 用户主动触发
- ✅ 多轮对话收集信息
- ❌ 无预加载

**问题**：
1. **等待时间长**：多轮对话 + LLM 生成，用户需等待 30-60 秒
2. **记忆数据传输大**：虽然已优化到 KB 级，但仍可进一步精简
3. **无进度反馈**：用户不知道生成进度

---

### 2. 课程目录生成（TOC）

**入口**：`/generate/toc`

**流程**：
```
Blueprint 确认
  ↓
调用 /api/generate/toc
  ↓
生成完整 CourseTree（包含所有节点）
  ↓
存储到 localStorage
  ↓
预加载第一节内容（后台）
```

**Prompt 构建**：
- **位置**：`lib/prompt.ts` - `buildTocPrompt`
- **输入数据**：
  - Blueprint（课程大纲）
  - 无用户记忆（❌ 缺失个性化）

**生成时机**：
- ✅ 用户确认后立即生成
- ✅ 预加载第一节（后台）
- ❌ 其他节点按需生成

**问题**：
1. **缺少个性化**：TOC 生成不使用用户记忆
2. **预加载单一**：只预加载第一节，用户可能跳过
3. **无进度反馈**：生成时无进度显示

---

### 3. 节点内容生成（Node Content）

**入口**：学习页面 `/course/[courseId]/learn/[nodeIndex]`

**流程**：
```
用户进入节点
  ↓
检查是否已生成
  ↓
调用 /api/generate/node
  ↓
生成 Cards + Questions
  ↓
存储到 localStorage
  ↓
显示学习内容
```

**Prompt 构建**：
- **位置**：`lib/prompt.ts` - `buildNodeContentPrompt`
- **输入数据**：
  - `topic`: 课程主题
  - `nodeTitle`: 节点标题
  - `cardCount`: 卡片数量
  - `insights`: { knowledgeBackground, analogyExperiences }
  - `userMemory`: TeachingMemoryPayload
    - nodeTopic, nodeTitle
    - prerequisiteConceptStates (2个前置概念)
    - targetConceptStates (3个目标概念)
    - recentQuestionSummaries (3个相关提问)
    - analogyHints (3条类比提示)
    - preferredExplanationStyles (偏好风格)
  - `generationContext`: 课程上下文
    - difficultySummary
    - courseOutline
    - previousNodeTitle
    - prerequisiteTitles
    - currentNodeGoal
    - nextNodeTitle

**生成时机**：
- ✅ 按需生成（用户进入时）
- ✅ 预加载下一节（后台）
- ❌ 无批量预加载

**问题**：
1. **首次等待长**：用户进入节点需等待 20-30 秒
2. **预加载策略单一**：只预加载下一节，用户可能跳跃学习
3. **重复生成**：用户刷新页面会重新生成（已有缓存但逻辑复杂）

---

## 数据流分析

### 用户记忆数据使用

| 阶段 | 使用的记忆 | 数据量 | 个性化程度 |
|------|-----------|--------|-----------|
| **Outline** | PlanningMemoryPayload | ~2KB | ⭐⭐⭐⭐ 高 |
| **TOC** | 无 | 0 | ⭐ 无 |
| **Node Content** | TeachingMemoryPayload | ~3KB | ⭐⭐⭐⭐⭐ 很高 |

**问题**：
- ❌ TOC 生成缺少个性化
- ❌ 记忆数据未充分利用（如 recentRelevantCourses）

### 存储策略

**当前**：
```
localStorage
├── courses (CourseTree[])
├── courseBundles (Blueprint + Lessons)
├── userMemoryV3 (MemoryStoreV3)
└── userProfile (UserProfile)
```

**问题**：
- ✅ 结构清晰
- ❌ 无过期清理（可能累积过多数据）
- ❌ 无压缩（JSON 字符串直接存储）

---

## 优化建议

### 🔥 高优先级（立即优化）

#### 1. TOC 生成加入个性化

**当前**：
```typescript
// 无用户记忆
buildTocPrompt(blueprint)
```

**优化**：
```typescript
// 加入 PlanningMemoryPayload
buildTocPrompt(blueprint, planningPayload)
```

**效果**：
- 节点顺序根据用户掌握度调整
- 跳过已掌握的基础内容
- 强化风险概念的讲解

#### 2. 智能预加载策略

**当前**：
- 只预加载第一节
- 只预加载下一节

**优化**：
```typescript
// 预加载策略
function getPreloadNodes(courseId: string, currentIndex: number): number[] {
  const course = getCourse(courseId);
  const userMemory = getUserMemoryV3();
  
  // 1. 下一节（必定预加载）
  const next = [currentIndex + 1];
  
  // 2. 用户可能跳过的节点（根据掌握度）
  const skippable = course.nodes
    .filter((node, i) => {
      const concepts = node.teachConceptIds;
      const mastery = getConceptsMastery(concepts, userMemory);
      return mastery > 0.8 && i > currentIndex;
    })
    .map(node => node.index);
  
  // 3. 风险节点（用户可能需要重点学习）
  const risky = course.nodes
    .filter((node, i) => {
      const concepts = node.teachConceptIds;
      return concepts.some(c => isRiskConcept(c, userMemory)) && i > currentIndex;
    })
    .map(node => node.index)
    .slice(0, 1); // 只预加载1个风险节点
  
  return [...next, ...risky].filter(i => i < course.nodes.length);
}
```

**效果**：
- 减少等待时间 50%
- 智能预测用户学习路径

#### 3. 进度反馈优化

**当前**：
- 无进度显示
- 用户只看到 loading

**优化**：
```typescript
// SSE 流式返回进度
{
  type: 'progress',
  stage: 'analyzing_topic',
  progress: 0.2,
  message: '正在分析主题...'
}

{
  type: 'progress',
  stage: 'building_outline',
  progress: 0.6,
  message: '正在构建课程大纲...'
}
```

**效果**：
- 用户体验提升
- 减少焦虑感

### 📝 中优先级（本周优化）

#### 4. 节点内容分段生成

**当前**：
- Cards + Questions 一次性生成
- 用户等待 20-30 秒

**优化**：
```typescript
// 先生成 Cards，立即显示
generateNodeCards(courseId, nodeIndex)
  .then(() => {
    // 用户开始学习 Cards
    // 后台生成 Questions
    generateNodeQuestions(courseId, nodeIndex);
  });
```

**效果**：
- 用户等待时间减少 60%
- 边学边生成，体验更流畅

#### 5. 记忆数据压缩

**当前**：
- JSON 字符串直接存储
- ~100KB per course

**优化**：
```typescript
// 使用 LZ-String 压缩
import LZString from 'lz-string';

function saveCompressed(key: string, data: any) {
  const json = JSON.stringify(data);
  const compressed = LZString.compress(json);
  localStorage.setItem(key, compressed);
}
```

**效果**：
- 存储空间减少 70%
- 支持更多课程历史

### 💡 低优先级（长期优化）

#### 6. IndexedDB 迁移

**当前**：
- localStorage 5-10MB 限制
- 同步 API，阻塞主线程

**优化**：
- 迁移到 IndexedDB
- 异步 API，不阻塞
- 无大小限制

#### 7. 服务端缓存

**当前**：
- 每次生成都调用 LLM
- 相同主题重复生成

**优化**：
- Redis 缓存常见主题的 Blueprint
- 用户记忆作为缓存 key 的一部分

---

## 实施计划

### 第一步：TOC 个性化（30分钟）

1. 修改 `buildTocPrompt` 接受 `planningPayload`
2. 在 prompt 中加入用户掌握度信息
3. 调整节点顺序和难度

### 第二步：智能预加载（1小时）

1. 实现 `getPreloadNodes` 策略
2. 修改 `preloadNextNode` 为 `preloadNodes`
3. 后台批量预加载

### 第三步：进度反馈（1小时）

1. Python Agent 返回 SSE 进度事件
2. 前端显示进度条
3. 分阶段显示消息

### 第四步：分段生成（1小时）

1. 拆分 `/api/generate/node` 为两个接口
2. 先生成 Cards，后生成 Questions
3. 优化用户等待体验

---

## 预期效果

| 指标 | 优化前 | 优化后 | 改善 |
|------|--------|--------|------|
| **Outline 等待** | 30-60s | 30-60s（加进度） | 体验提升 |
| **TOC 个性化** | 无 | 高 | ⭐⭐⭐⭐ |
| **Node 首次等待** | 20-30s | 8-12s | **60%** ⚡ |
| **预加载命中率** | 50% | 80% | **30%** ⚡ |
| **存储空间** | 100KB/课程 | 30KB/课程 | **70%** ⚡ |

---

## 下一步行动

**建议优先级**：
1. 🔥 TOC 个性化（立即）
2. 🔥 智能预加载（立即）
3. 🔥 进度反馈（本周）
4. 📝 分段生成（本周）
5. 💡 压缩存储（下周）

**你想从哪个开始？**
