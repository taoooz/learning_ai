# P2 流内答疑第一阶段实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不打断 V2 主任务生成的前提下，将用户问题与 Tutor 流式回答写入同一条可持久化、可恢复的章节学习流。

**Architecture:** 新增 V2 专用 Tutor 请求协议和 Python SSE 端点；前端以独立 tutor 请求代际、AbortController 和串行队列编排 Tutor 流，与主任务流并行隔离。问题提交立即进入 `NodeLessonV2.streamItems` 并立即持久化，任务流中提问排队到任务完成后回答，边界提问立即回答；回答失败只影响当前答疑，不影响任务主线。

**Tech Stack:** Next.js App Router、React 19、TypeScript、Tailwind CSS v4、localStorage、FastAPI、Pydantic、OpenAI 兼容 LLM SSE、node:test、pytest。

**Spec:** `docs/architecture/p2-流内答疑第一阶段设计.md`

## Global Constraints

- 全程用户可见文本使用中文。
- 不改变 V1 ChatWidget、V1 课程页和既有 `/api/chat` 用户流程。
- Tutor 请求只发送当前课程主题、章节目标、当前任务、已展示内容摘要、最近内联问答和当前问题；不得发送整门课程或全量历史。
- 用户问题提交后立即入流并立即落盘；回答流期间约 300ms 节流落盘，回答完成/失败立即落盘。
- 所有异步结果写入前校验 `courseId`、`chapterId`、`planId`、`planVersion`、`taskId`、`questionId`、`requestId`。
- `partial_paused` 只保留为未来块间打断协议，本阶段流中排队路径不得伪造该状态。
- Tutor 第一版只生成 `markdown` 回答块，不产出学习证据、掌握度结论或课程计划修改。
- 不向用户展示上游堆栈、密钥、内部 URL 或模型思维过程。
- 每个任务完成后运行对应的最小测试；全量完成后运行 lint、typecheck、TS 测试和 Python 测试，并更新 `CHANGELOG.md`。

---

## 文件与职责地图

### 类型与纯逻辑

- Modify: `types/learning-v2/learning-stream.ts` — 问题/回答条目与 Tutor 状态类型。
- Modify: `types/learning-v2/events.ts` — Tutor SSE 事件和载荷。
- Modify: `types/learning-v2/runtime.ts` — 如需补充 Tutor 队列运行时字段，只加入恢复所需的最小字段。
- Modify: `types/learning-v2/index.ts` — 保持类型桶导出。
- Modify: `lib/learning-v2/idempotency.ts` — 问题、Tutor 请求幂等键。
- Modify: `lib/learning-v2/reducers.ts` — 问题入流、Tutor 事件归约、失败和完成。
- Modify: `lib/learning-v2/sse-client.ts` — 保持通用解析器可消费 Tutor 事件；仅在类型守卫需要时补泛型/注释。
- Modify: `lib/learning-v2/resume.ts` — 恢复 pending/streaming Tutor 回答为 pending，并支持自动重试一次。

### 服务端

- Create: `python-agent/schemas/tutor.py` — V2 Tutor 请求模型和有限回答块模型。
- Create: `python-agent/prompts/inline_tutor.py` — 当前任务上下文下的中文 Tutor prompt。
- Create: `python-agent/services/inline_tutor_service.py` — 上下文裁剪、LLM 流解析、Tutor SSE 事件生成。
- Modify: `python-agent/main.py` — 注册 `/api/learning/v2/tutor/stream`，统一错误码与校验。
- Create: `app/api/learning/v2/tutor/stream/route.ts` — 鉴权和字节级 SSE 薄透传。

### 前端编排与 UI

- Create: `lib/learning-v2/tutor-context.ts` — 从 lesson/blueprint 构造最小 Tutor 请求上下文。
- Create: `lib/learning-v2/tutor-queue.ts` — pending 问题队列、最多 3 个自动处理窗口、串行选择。
- Modify: `hooks/learning-v2/useChapterLearning.ts` — Tutor 队列、双流请求隔离、提问/回答 API、恢复与持久化。
- Create: `components/learning-v2/InlineTutorInput.tsx` — 章节页常驻问题输入。
- Modify: `components/learning-v2/LearningStreamV2.tsx` — 渲染 UserQuestion/TutorAnswer。
- Modify: `components/learning-v2/TaskBoundaryV2.tsx` — 边界态承载 Tutor 输入和回答后的主线按钮状态。
- Modify: `app/course/[courseId]/chapter/[chapterId]/page.tsx` — 接入输入框、Tutor 状态和回调。

### 测试与文档

- Create/Modify: `tests/learning-v2-tutor-protocol.test.ts` — 类型、幂等、事件守卫和 reducer。
- Create/Modify: `tests/learning-v2-tutor-context.test.ts` — 上下文最小化与截断。
- Create/Modify: `tests/learning-v2-tutor-queue.test.ts` — 队列串行、上限、去重。
- Create/Modify: `tests/learning-v2-tutor-resume.test.ts` — 刷新恢复、自动重试、旧请求丢弃。
- Create: `python-agent/tests/test_inline_tutor.py` — prompt、请求校验、事件序列和错误分类。
- Modify: `CHANGELOG.md` — 记录 P2 第一阶段实现与验证结果。

---

### Task 1: 定义 Tutor 学习流条目与 SSE 协议

**Files:**
- Modify: `types/learning-v2/learning-stream.ts`
- Modify: `types/learning-v2/events.ts`
- Modify: `types/learning-v2/index.ts`
- Modify: `lib/learning-v2/idempotency.ts`
- Test: `tests/learning-v2-tutor-protocol.test.ts`

**Interfaces:**
- Produces `UserQuestionItem`、`TutorAnswerItem`、`TutorSseEventType`、Tutor 载荷类型，以及 `buildTutorQuestionIdempotencyKey()`、`buildTutorRequestIdempotencyKey()`。
- Later tasks consume these exact discriminated unions and keys。

- [ ] **Step 1: 写失败测试**

```ts
test('问题和回答使用稳定且不同的幂等键', () => {
  assert.equal(buildTutorQuestionIdempotencyKey('ch-1', 'task-1', 'q-1'), 'uq:ch-1:task-1:q-1');
  assert.equal(buildTutorRequestIdempotencyKey('ch-1', 2, 'task-1', 'q-1'), 'tutor:ch-1:v2:task-1:q-1');
  assert.notEqual(
    buildTutorQuestionIdempotencyKey('ch-1', 'task-1', 'q-1'),
    buildTutorRequestIdempotencyKey('ch-1', 2, 'task-1', 'q-1'),
  );
});

test('Tutor 事件类型覆盖开始、块增量、完成和通用错误', () => {
  const event: LearningSseEvent = {
    eventId: 'evt-1', requestId: 'req-1', type: 'tutor_block_delta',
    courseId: 'course-1', chapterId: 'ch-1', taskId: 'task-1', questionId: 'q-1',
    planVersion: 2, sequence: 3, timestamp: 1,
    payload: { blockId: 'block-1', delta: '缓存命中' },
  };
  assert.equal(event.type, 'tutor_block_delta');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/learning-v2-tutor-protocol.test.ts`
Expected: FAIL，因为 Tutor 类型和幂等键函数尚未定义。

- [ ] **Step 3: 实现最小协议**

在 `learning-stream.ts` 增加：

```ts
export type TutorItemStatus = 'pending' | 'streaming' | 'complete' | 'failed';

export interface UserQuestionItem extends StreamItemBase {
  type: 'user_question';
  taskId: string;
  questionId: string;
  text: string;
  status: 'pending' | 'complete' | 'failed';
}

export interface TutorAnswerItem extends StreamItemBase {
  type: 'tutor_answer';
  taskId: string;
  questionId: string;
  blocks: Extract<LearningContentBlock, { type: 'markdown' }>[];
  status: TutorItemStatus;
  errorMessage?: string;
}
```

在 `events.ts` 增加 Tutor 事件类型和 payload，并把它们加入 `LearningSseEventType`；在幂等模块实现稳定键函数。保持 `index.ts` 的导出完整。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --import tsx --test tests/learning-v2-tutor-protocol.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交本任务**

```bash
git add types/learning-v2/learning-stream.ts types/learning-v2/events.ts types/learning-v2/index.ts lib/learning-v2/idempotency.ts tests/learning-v2-tutor-protocol.test.ts
git commit -m "feat: 定义 V2 流内答疑协议"
```

---

### Task 2: 实现 Tutor 事件 reducer 与版本守卫

**Files:**
- Modify: `lib/learning-v2/reducers.ts`
- Test: `tests/learning-v2-tutor-protocol.test.ts`

**Interfaces:**
- Consumes Task 1 的 `UserQuestionItem`、`TutorAnswerItem` 和 Tutor SSE 事件。
- Produces `appendUserQuestion(lesson, input, now)`、`applyTutorSseEvent(lesson, event)`。

- [ ] **Step 1: 写失败测试**

```ts
test('问题提交立即入流且重复 questionId 不重复', () => {
  const first = appendUserQuestion(baseLesson, {
    taskId: 'task-1', questionId: 'q-1', text: '为什么这里要用 ETag？',
  }, 10);
  const second = appendUserQuestion(first, {
    taskId: 'task-1', questionId: 'q-1', text: '为什么这里要用 ETag？',
  }, 11);
  assert.equal(first.streamItems.filter(i => i.type === 'user_question').length, 1);
  assert.deepEqual(second, first);
});

test('Tutor delta 只写入匹配版本和请求的问题', () => {
  const started = applyTutorSseEvent(baseWithQuestion, tutorStartedEvent);
  const delta = applyTutorSseEvent(started, tutorDeltaEvent('命中缓存'));
  const stale = applyTutorSseEvent(delta, { ...tutorDeltaEvent('旧回答'), planVersion: 1 });
  const answer = stale.streamItems.find(i => i.type === 'tutor_answer');
  assert.equal(answer?.type, 'tutor_answer');
  assert.equal(answer?.blocks[0]?.markdown, '命中缓存');
});

test('重复 Tutor 完成事件不漂移 sequence，错误保留问题', () => {
  const failed = applyTutorSseEvent(baseWithQuestion, tutorErrorEvent);
  const repeated = applyTutorSseEvent(failed, tutorErrorEvent);
  assert.equal(repeated.streamItems.length, failed.streamItems.length);
  assert.equal(repeated.streamItems.some(i => i.type === 'user_question'), true);
  assert.equal(repeated.streamItems.some(i => i.type === 'system_notice'), true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/learning-v2-tutor-protocol.test.ts`
Expected: FAIL，因为 reducer 尚未支持问题和 Tutor 事件。

- [ ] **Step 3: 实现最小 reducer**

- `appendUserQuestion` 按 `uq:{questionId}` upsert，分配下一个 sequence，更新 `scrollAnchorItemId` 和 `lastActiveAt`。
- `tutor_started` 创建或更新 `ta:{questionId}` 为 `streaming`。
- `tutor_block_started` 创建 markdown block 占位。
- `tutor_block_delta` 只累积匹配 `blockId`，不匹配则丢弃。
- `tutor_block_completed` 用完整 markdown 块替换对应占位。
- `tutor_completed` 将回答标记 `complete`。
- `request_error` 将回答标记 `failed` 并追加 system notice；不删除问题。
- 所有事件校验 `chapterId`、`planVersion`、`taskId`、`questionId`、`requestId`；sequence 只单调递增。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --import tsx --test tests/learning-v2-tutor-protocol.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交本任务**

```bash
git add lib/learning-v2/reducers.ts tests/learning-v2-tutor-protocol.test.ts
git commit -m "feat: 归约流内答疑事件"
```

---

### Task 3: 构造最小 Tutor 上下文与 Python 请求模型

**Files:**
- Create: `lib/learning-v2/tutor-context.ts`
- Create: `python-agent/schemas/tutor.py`
- Create: `python-agent/prompts/inline_tutor.py`
- Test: `tests/learning-v2-tutor-context.test.ts`
- Test: `python-agent/tests/test_inline_tutor.py`

**Interfaces:**
- Produces `buildInlineTutorContext(args): InlineTutorRequestPayload`。
- Produces Python `InlineTutorRequest`、`InlineTutorResponse` 和 `build_inline_tutor_prompt(request)`。

- [ ] **Step 1: 写失败测试**

```ts
test('Tutor 上下文只包含当前任务并截断已展示内容', () => {
  const request = buildInlineTutorContext({
    courseTopic: 'HTTP 缓存',
    chapter: { title: '验证策略', teachingGoal: '理解强缓存和协商缓存' },
    task: { taskId: 'task-1', title: 'ETag', taskDescription: '理解条件请求' },
    lesson: lessonWithLongBlocks,
    questionId: 'q-1',
    question: '304 为什么没有正文？',
    idempotencyKey: 'tutor:ch-1:v1:task-1:q-1',
  });
  assert.equal(request.mode, 'inline_tutor');
  assert.equal(request.question.text, '304 为什么没有正文？');
  assert.equal(request.visibleContent.length <= 6000, true);
  assert.equal('fullCourse' in request, false);
});
```

```python
def test_prompt_contains_current_task_but_not_full_course():
    request = InlineTutorRequest(...)
    prompt = build_inline_tutor_prompt(request)
    assert "当前任务" in prompt
    assert request.question.text in prompt
    assert "不要输出思维过程" in prompt
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/learning-v2-tutor-context.test.ts` and `cd python-agent && .venv/bin/python -m pytest tests/test_inline_tutor.py -q`
Expected: FAIL，因为上下文模块、Pydantic 模型和 prompt 尚未定义。

- [ ] **Step 3: 实现最小上下文边界**

TypeScript 从当前 lesson 提取已完成 markdown/key point/example/reflection 内容，拼接后限制 6000 字符；只保留当前任务最近 3 组问答，每组限制问题 300 字符、回答 1200 字符。字段包含：

```ts
{
  mode: 'inline_tutor', courseTopic,
  chapter: { title, teachingGoal },
  task: { taskId, title, taskDescription },
  visibleContent: string,
  recentInlineQA: Array<{ question: string; answer: string }>,
  question: { questionId, text },
  idempotencyKey,
}
```

Python Pydantic 模型使用 `extra='forbid'`；prompt 明确回答当前问题、使用中文、只输出 Tutor markdown 事件所需内容、不得输出思维过程或证据结论。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --import tsx --test tests/learning-v2-tutor-context.test.ts` and `cd python-agent && .venv/bin/python -m pytest tests/test_inline_tutor.py -q`
Expected: PASS。

- [ ] **Step 5: 提交本任务**

```bash
git add lib/learning-v2/tutor-context.ts python-agent/schemas/tutor.py python-agent/prompts/inline_tutor.py tests/learning-v2-tutor-context.test.ts python-agent/tests/test_inline_tutor.py
git commit -m "feat: 构造流内答疑最小上下文"
```

---

### Task 4: 实现 Python Tutor SSE 服务与 Next 薄透传

**Files:**
- Create: `python-agent/services/inline_tutor_service.py`
- Modify: `python-agent/main.py`
- Create: `app/api/learning/v2/tutor/stream/route.ts`
- Modify: `python-agent/tests/test_inline_tutor.py`
- Test: `tests/learning-v2-tutor-protocol.test.ts`

**Interfaces:**
- Python endpoint: `POST /api/learning/v2/tutor/stream`。
- Next endpoint: `POST /api/learning/v2/tutor/stream`，鉴权后字节级 pipe。
- Service emits `tutor_started → tutor_block_started → tutor_block_delta* → tutor_block_completed → tutor_completed → request_completed`。

- [ ] **Step 1: 写失败测试**

```python
def test_tutor_event_order_and_utf8():
    events = list(fake_tutor_events(answer='ETag 可以理解为版本指纹'))
    assert [event['type'] for event in events] == [
        'tutor_started', 'tutor_block_started', 'tutor_block_delta',
        'tutor_block_completed', 'tutor_completed', 'request_completed',
    ]
    assert any('版本指纹' in json.dumps(event, ensure_ascii=False) for event in events)

def test_tutor_llm_failure_returns_retryable_error():
    error = classify_tutor_error(TimeoutError())
    assert error.code == 'LLM_TIMEOUT'
    assert error.retryable is True
```

```ts
test('V2 Tutor 代理拒绝无认证请求', async () => {
  const response = await POST(new Request('http://localhost/api/learning/v2/tutor/stream', {
    method: 'POST', body: JSON.stringify(validTutorBody),
  }) as never);
  assert.equal(response.status, 401);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd python-agent && .venv/bin/python -m pytest tests/test_inline_tutor.py -q` and `node --import tsx --test tests/learning-v2-tutor-protocol.test.ts`
Expected: FAIL，因为服务和路由尚未定义。

- [ ] **Step 3: 实现 Python SSE**

复用现有 LLM 客户端和错误分类约定；每个请求生成 requestId/eventId，固定一个 markdown blockId。LLM 输出只进入 `tutor_block_delta`，服务端不生成 evidence 字段。异常返回稳定 code、中文 message、retryable；不返回堆栈、密钥或内部 URL。

在 `main.py` 注册路由，校验 `InlineTutorRequest`，成功使用 `StreamingResponse(media_type='text/event-stream')`；输入错误 422，LLM 错误按既有 `LLM_ERROR_STATUS` 返回。

- [ ] **Step 4: 实现 Next 薄透传**

路由调用 `requireAuth(request)`，解析 JSON 后检查 `mode`、`question`、`chapter`、`task`、`idempotencyKey`，再转发到 Python Agent；成功响应只设置 SSE 头并直接返回 `response.body`。

- [ ] **Step 5: 运行测试确认通过**

Run: `cd python-agent && .venv/bin/python -m pytest tests/test_inline_tutor.py -q`; `node --import tsx --test tests/learning-v2-tutor-protocol.test.ts`; `npm run typecheck`
Expected: PASS。

- [ ] **Step 6: 提交本任务**

```bash
git add python-agent/services/inline_tutor_service.py python-agent/main.py app/api/learning/v2/tutor/stream/route.ts python-agent/tests/test_inline_tutor.py tests/learning-v2-tutor-protocol.test.ts
git commit -m "feat: 增加 V2 Tutor 流式接口"
```

---

### Task 5: 实现 Tutor 队列与恢复纯逻辑

**Files:**
- Create: `lib/learning-v2/tutor-queue.ts`
- Modify: `lib/learning-v2/resume.ts`
- Test: `tests/learning-v2-tutor-queue.test.ts`
- Test: `tests/learning-v2-tutor-resume.test.ts`

**Interfaces:**
- Produces `getPendingTutorQuestions(lesson)`、`takeNextTutorQuestion(lesson)`、`countUnansweredTutorQuestions(lesson)`。
- Produces `normalizeTutorRuntimeForResume(lesson)`，将 `streaming` 回答变为 `pending` 并返回是否需要一次自动重试。

- [ ] **Step 1: 写失败测试**

```ts
test('Tutor 队列按提交顺序串行，自动窗口最多三题', () => {
  const lesson = lessonWithQuestions(['q-1', 'q-2', 'q-3', 'q-4']);
  assert.deepEqual(getPendingTutorQuestions(lesson).map(q => q.questionId), ['q-1', 'q-2', 'q-3', 'q-4']);
  assert.equal(takeNextTutorQuestion(lesson)?.questionId, 'q-1');
  assert.equal(countUnansweredTutorQuestions(lesson), 4);
});

test('刷新将 pending/streaming 统一为 pending，只自动重试一次', () => {
  const first = normalizeTutorRuntimeForResume(lessonWithStreamingTutor, 0);
  assert.equal(first.lesson.streamItems.find(i => i.type === 'tutor_answer')?.status, 'pending');
  assert.equal(first.shouldAutoRetry, true);
  const second = normalizeTutorRuntimeForResume(first.lesson, 1);
  assert.equal(second.shouldAutoRetry, false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/learning-v2-tutor-queue.test.ts tests/learning-v2-tutor-resume.test.ts`
Expected: FAIL，因为队列和恢复函数尚未定义。

- [ ] **Step 3: 实现纯函数**

按 `streamItems` sequence 找用户问题，配对同 questionId 的 Tutor 回答；回答状态不是 complete/failed 时视为 pending。`takeNextTutorQuestion` 只返回最早一题；自动窗口上限由 hook 启动逻辑使用 `slice(0, 3)`，不删除超出问题。

恢复函数不清除问题和已展示回答块，只把未完成回答标为 pending，并依据 lesson 内一次性重试标记返回 `shouldAutoRetry`。标记必须持久化，避免刷新循环重试。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --import tsx --test tests/learning-v2-tutor-queue.test.ts tests/learning-v2-tutor-resume.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交本任务**

```bash
git add lib/learning-v2/tutor-queue.ts lib/learning-v2/resume.ts tests/learning-v2-tutor-queue.test.ts tests/learning-v2-tutor-resume.test.ts
git commit -m "feat: 增加 Tutor 队列与恢复逻辑"
```

---

### Task 6: 接入 useChapterLearning 双流编排

**Files:**
- Modify: `hooks/learning-v2/useChapterLearning.ts`
- Modify: `lib/learning-v2/storage.ts`（仅在现有立即落盘接口不足时补小函数）
- Modify: `lib/learning-v2/engagement.ts`（仅加入答疑事件，不改既有事件语义）
- Test: `tests/learning-v2-tutor-resume.test.ts`
- Test: `tests/learning-v2-tutor-protocol.test.ts`

**Interfaces:**
- Extends `UseChapterLearningResult` with `submitTutorQuestion(text: string): void`、`retryTutor(questionId: string): void`、`tutorState`、`isTutorBusy`。
- Consumes Task 2–5 的 reducer、context、queue、resume 和 SSE 协议。

- [ ] **Step 1: 写失败测试**

```ts
test('流中提问不取消主任务流，任务完成后自动回答', () => {
  const harness = createChapterLearningHarness({ phase: 'streaming' });
  harness.submitTutorQuestion('为什么 ETag 能减少正文传输？');
  assert.equal(harness.taskAbortCount, 0);
  assert.equal(harness.lesson.streamItems.some(i => i.type === 'user_question'), true);
  harness.emitTaskCompleted();
  assert.equal(harness.tutorRequests, 1);
});

test('边界提问立即启动 Tutor，回答后仍保持边界', () => {
  const harness = createChapterLearningHarness({ phase: 'boundary' });
  harness.submitTutorQuestion('能举个例子吗？');
  assert.equal(harness.tutorRequests, 1);
  harness.emitTutorCompleted();
  assert.equal(harness.phase, 'boundary');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/learning-v2-tutor-protocol.test.ts tests/learning-v2-tutor-resume.test.ts`
Expected: FAIL，因为 hook 尚未暴露 Tutor 编排能力。

- [ ] **Step 3: 实现双流编排**

在 hook 中新增：

- `tutorAbortRef`、`tutorGenerationRef`、`tutorRetryRef`；
- `submitTutorQuestion`：生成 questionId，调用 `appendUserQuestion`，立即 dispatch、立即持久化；流中只入队，边界态启动 Tutor；
- `startTutor`：独立 fetch `/api/learning/v2/tutor/stream`，使用 `parseLearningSseStream`，每个事件 dispatch 到 reducer；不得 abort 主任务；
- 主任务收到 `task_completed` 后检查 pending 队列并启动最早问题；
- Tutor 完成/失败后清除对应 pending request，保留章节 phase，不调用 `continueNext`；
- Tutor 失败提供 `retryTutor(questionId)`，只重试该问题；
- 卸载和章节切换同时 abort 两套请求，旧 generation 结果直接丢弃；
- 初始化时调用恢复函数，对 pending/streaming Tutor 只自动重试一次；
- 问题提交、回答终态立即调用现有 quota fallback 保存函数，流中回答走 300ms 节流。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --import tsx --test tests/learning-v2-tutor-protocol.test.ts tests/learning-v2-tutor-resume.test.ts`; `npm run typecheck`
Expected: PASS。

- [ ] **Step 5: 提交本任务**

```bash
git add hooks/learning-v2/useChapterLearning.ts lib/learning-v2/storage.ts lib/learning-v2/engagement.ts tests/learning-v2-tutor-protocol.test.ts tests/learning-v2-tutor-resume.test.ts
git commit -m "feat: 接入章节内 Tutor 双流编排"
```

---

### Task 7: 增加章节 UI 与边界交互

**Files:**
- Create: `components/learning-v2/InlineTutorInput.tsx`
- Modify: `components/learning-v2/LearningStreamV2.tsx`
- Modify: `components/learning-v2/TaskBoundaryV2.tsx`
- Modify: `app/course/[courseId]/chapter/[chapterId]/page.tsx`
- Test: `tests/learning-v2-tutor-protocol.test.ts`

**Interfaces:**
- `InlineTutorInput` consumes `value`、`disabled`、`placeholder`、`onSubmit`、`queuedCount`、`busy`。
- 页面消费 Task 6 的 `submitTutorQuestion`、`retryTutor`、`tutorState`。

- [ ] **Step 1: 写失败测试**

```ts
test('Tutor UI 文案区分流中排队和边界立即回答', () => {
  assert.equal(tutorPlaceholder('streaming'), '本节生成完成后回答你的问题…');
  assert.equal(tutorPlaceholder('boundary'), '针对本节内容提问…');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/learning-v2-tutor-protocol.test.ts`
Expected: FAIL，因为 UI 文案辅助函数和组件尚未定义。

- [ ] **Step 3: 实现 UI**

- `LearningStreamV2` 增加 `user_question`：显示用户问题、pending 状态和队列提示；增加 `tutor_answer`：显示 markdown 块、流式光标、失败文案和重试按钮。
- `InlineTutorInput` 使用受控 textarea，提交前 trim，空问题不提交；提交中保留输入清空后的可见反馈；触摸区域至少 44px。
- 章节页将输入框放在学习流/边界卡之后，保证流中和边界都可见；completed/plan_failed 时隐藏。
- `TaskBoundaryV2` 在回答进行时不禁用主线之外的 Tutor 输入；回答完成后保持现有继续按钮，不自动推进；失败只显示局部重试。
- 所有文案中文：`正在准备回答…`、`本节生成完成后回答你的问题`、`重试回答`、`继续本节内容`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --import tsx --test tests/learning-v2-tutor-protocol.test.ts`; `npm run typecheck`
Expected: PASS。

- [ ] **Step 5: 提交本任务**

```bash
git add components/learning-v2/InlineTutorInput.tsx components/learning-v2/LearningStreamV2.tsx components/learning-v2/TaskBoundaryV2.tsx app/course/[courseId]/chapter/[chapterId]/page.tsx tests/learning-v2-tutor-protocol.test.ts
git commit -m "feat: 增加章节内提问交互"
```

---

### Task 8: 完成恢复、错误路径和回归测试

**Files:**
- Modify: `lib/learning-v2/resume.ts`
- Modify: `hooks/learning-v2/useChapterLearning.ts`
- Modify: `tests/learning-v2-tutor-resume.test.ts`
- Modify: `python-agent/tests/test_inline_tutor.py`
- Create/Modify: `tests/learning-v2-tutor-integration.test.ts`

**Interfaces:**
- Consumes全部前置任务接口。
- Produces覆盖设计规格的端到端纯函数/模拟流验证，不改变 V1 测试。

- [ ] **Step 1: 写失败回归测试**

```ts
test('旧章节 Tutor 回答不会写入新章节', () => {
  const harness = createTutorHarness({ chapterId: 'new-chapter', tutorEventChapterId: 'old-chapter' });
  harness.emitTutorDelta('旧回答');
  assert.equal(harness.currentAnswerText, '');
});

test('Tutor 失败局部重试不改变任务内容和 completedTaskIds', () => {
  const harness = createTutorHarness({ failedQuestionId: 'q-1' });
  const before = harness.lesson.runtime.completedTaskIds;
  harness.retryTutor('q-1');
  assert.deepEqual(harness.lesson.runtime.completedTaskIds, before);
});
```

```python
def test_invalid_question_context_is_rejected():
    response = client.post('/api/learning/v2/tutor/stream', json={...missing_question...})
    assert response.status_code == 422
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/learning-v2-tutor-integration.test.ts tests/learning-v2-tutor-resume.test.ts`; `cd python-agent && .venv/bin/python -m pytest tests/test_inline_tutor.py -q`
Expected: FAIL，直到旧代际、局部重试和错误响应路径补齐。

- [ ] **Step 3: 补齐错误与恢复实现**

确认以下行为：

- 主任务 SSE 读取异常不取消 Tutor；Tutor SSE 读取异常不改变已完成任务；
- 章节卸载后所有回调先检查 generation；
- 刷新后的自动重试只发生一次，第二次失败进入可见失败态；
- 问题最多 3 个自动处理窗口，超出问题仍保留但不并发请求；
- HTTP 401/422/5xx 在 Tutor UI 显示稳定中文错误；
- Tutor 完成不推进章节状态；
- V1 ChatWidget 相关测试和行为不被修改。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --import tsx --test tests/learning-v2-tutor-*.test.ts`; `cd python-agent && .venv/bin/python -m pytest tests/test_inline_tutor.py -q`
Expected: PASS。

- [ ] **Step 5: 提交本任务**

```bash
git add lib/learning-v2/resume.ts hooks/learning-v2/useChapterLearning.ts tests/learning-v2-tutor-resume.test.ts tests/learning-v2-tutor-integration.test.ts python-agent/tests/test_inline_tutor.py
git commit -m "test: 覆盖流内答疑恢复与错误路径"
```

---

### Task 9: 全量验证、真实冒烟与 CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`
- Optional Modify: `python-agent/.env` only for local runtime, never stage or print secrets

**Interfaces:**
- Consumes全部实现任务。
- Produces可复现的验证结果和 P2 交付记录。

- [ ] **Step 1: 运行全量静态与测试检查**

```bash
npm run lint
npm run typecheck
npm test
cd python-agent && .venv/bin/python -m pytest
```

Expected：lint 0 errors（允许既有 warnings）、typecheck 通过、TS/Python 测试全部通过。

- [ ] **Step 2: 运行 HTTP 错误路径冒烟**

使用不含密钥的本地测试数据验证：

- 无 cookie → Next Tutor 代理返回 401；
- 缺字段 → 返回 422；
- 章节/版本不匹配事件 → 客户端丢弃；
- Tutor 上游失败 → 可见失败态且可局部重试。

不得在终端输出或记录 `LLM_API_KEY`、完整 Authorization header、`.env` 内容或内部密钥。

- [ ] **Step 3: 运行真实 LLM Tutor 冒烟**

使用现有本地认证 cookie 和已启动的 Python Agent，提交一个中文问题，确认：

- SSE 事件顺序正确；
- 中文任意 chunk 切分无乱码；
- 回答只进入当前问题对应的 Tutor 条目；
- Tutor 完成后章节仍停在边界，不自动推进；
- `generationMeta`/错误信息不暴露内部细节。

- [ ] **Step 4: 更新 CHANGELOG**

在 `## 2026-08-31` 下增加 `### V2 P2 第一阶段：流内答疑`，记录：

- 流中提问排队、边界提问立即回答；
- UserQuestion/TutorAnswer 学习流持久化；
- Tutor SSE 双流隔离、串行队列、刷新自动重试一次；
- 证据和课程计划不被 Tutor 修改；
- lint、typecheck、TS/Python 测试和真实冒烟结果。

- [ ] **Step 5: 检查 git diff 与敏感信息**

```bash
git diff --check
git status --short
git diff -- . ':!python-agent/.env' | grep -E 'LLM_API_KEY|Authorization: Bearer|sk-[A-Za-z0-9]' || true
```

Expected：无空白错误、无密钥泄露、工作区只包含计划内改动。

- [ ] **Step 6: 提交最终文档改动**

```bash
git add CHANGELOG.md
 git commit -m "docs: 记录 P2 流内答疑交付"
```

## 计划自检

- Spec §1 目标/非目标 → Tasks 1–9 覆盖，明确不做块间打断与证据。
- Spec §2 协议 → Tasks 1–2 覆盖类型、事件、幂等、版本守卫。
- Spec §3 请求编排 → Tasks 3–6 覆盖最小上下文、双流隔离、串行队列和上限。
- Spec §4 前端交互 → Task 7 覆盖输入、流内排队、边界回答、失败重试。
- Spec §5 恢复持久化 → Tasks 5–6、8 覆盖立即落盘、节流、自动重试一次。
- Spec §6 错误安全 → Tasks 4、8、9 覆盖鉴权、稳定错误、旧结果丢弃和敏感信息检查。
- Spec §7 实现边界 → 文件地图限制在 V2 和 Python 新模块，不改 V1 ChatWidget。
- Spec §8 验证标准 → Tasks 1–9 覆盖协议、交互模拟、恢复、回归、真实 LLM 冒烟。
- 计划不包含 `TODO`、`TBD` 或“适当处理”等空泛实现要求；所有任务都有文件、接口、失败测试、实现方向和验证命令。
