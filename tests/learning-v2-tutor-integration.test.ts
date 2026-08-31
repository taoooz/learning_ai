// tests/learning-v2-tutor-integration.test.ts
// P2 流内答疑端到端集成验证（计划 Task 8）：
// 基于 Task 6 编排测试基座（假 SSE 流 + 真实归约器）锁定恢复与错误路径的行为红线——
// - 简报规定用例：旧章节回答不写入新章节；失败局部重试不改变任务内容与已完成任务
// - 双流隔离：主任务失败不取消 Tutor；Tutor 流读取异常不改变已完成任务
// - 代际守卫：卸载后迟到的响应整体丢弃
// - 队列窗口：超出自动窗口的问题保留、串行回答不并发
// - 错误文案：HTTP 401/503 在回答条目上落稳定中文错误（422 用例见 tutor-protocol）
// - 主线不推进：Tutor 终态不改变章节状态

import test from 'node:test';
import assert from 'node:assert/strict';

import { createTutorHarness } from './helpers/tutor-harness';

test('旧章节 Tutor 回答不会写入新章节', async () => {
  // 新章节已受理一个新问题；旧章节残留流的事件（started + delta，chapterId 均为旧章节）整条混入。
  // 若章节守卫生效：started 不建流、delta 不落块，回答文本为空；
  // 若守卫缺失：started 会建流、delta 会写入「旧回答」，测试变红。
  const harness = createTutorHarness({
    phase: 'boundary',
    chapterId: 'new-chapter',
    tutorEventChapterId: 'old-chapter',
  });
  harness.submitTutorQuestion('304 为什么没有正文？');
  await harness.settle();
  await harness.emitTutorStarted();
  await harness.emitTutorDelta('旧回答');
  assert.equal(harness.currentAnswerText, '', '旧章节 started/delta 被章节守卫丢弃，不写入新章节');
  // 问题本身是新章节合法提交的轨迹，保留不动
  assert.equal(
    harness.lesson.streamItems.some((item) => item.type === 'user_question' && item.status === 'pending'),
    true,
    '已提交问题不被错投事件影响',
  );
});

test('Tutor 失败局部重试不改变任务内容和 completedTaskIds', async () => {
  const harness = createTutorHarness({ failedQuestionId: 'q-1' });
  const before = harness.lesson.runtime.completedTaskIds;
  const taskContentBefore = JSON.stringify(
    harness.lesson.streamItems.filter((item) => item.type === 'task_content'),
  );
  const statusBefore = harness.lesson.runtime.currentTaskStatus;

  assert.equal(harness.retryTutor('q-1'), true, '失败问题可局部重试');
  assert.deepEqual(harness.lesson.runtime.completedTaskIds, before, '重试发起即不触碰已完成任务');
  assert.equal(harness.tutorRequests, 1, '重试只重发该失败问题');
  assert.equal(harness.tutorBodies[0].question.questionId, 'q-1');

  // 重试完整走完一轮后再次校验：任务内容与主线状态始终不受 Tutor 影响
  await harness.emitTutorStarted();
  await harness.emitTutorCompleted('重试后的完整回答');
  assert.deepEqual(harness.lesson.runtime.completedTaskIds, before);
  assert.equal(
    JSON.stringify(harness.lesson.streamItems.filter((item) => item.type === 'task_content')),
    taskContentBefore,
    '任务内容不被重试改动',
  );
  assert.equal(harness.lesson.runtime.currentTaskStatus, statusBefore, '主线任务状态不变');
  assert.equal(harness.phase, 'boundary', '重试完成后仍停在边界');
});

test('章节卸载后迟到的响应整体丢弃（旧代际作废）', async () => {
  // 变体一：卸载时请求仍在途，卸载后才收到失败响应——
  // 若无代际守卫，失败本地合成会在已卸载章节写入失败条目
  const failing = createTutorHarness({ phase: 'boundary' });
  const releaseFailing = failing.holdNextTutorFetch();
  failing.failNextTutorFetch(500);
  failing.submitTutorQuestion('在途问题');
  await failing.settle();
  assert.equal(failing.tutorRequests, 1, '请求已发出但响应未回');
  const lessonBefore = failing.lesson;

  failing.invalidate(); // 章节卸载/切换：代际 +1、忙碌复位
  assert.equal(failing.orchestrator.isBusy, false);

  releaseFailing(); // 卸载后响应才到达
  await failing.settle();

  assert.equal(failing.lesson, lessonBefore, '迟到的失败响应不得写入已卸载章节');
  assert.equal(
    failing.lesson.streamItems.some((item) => item.type === 'tutor_answer'),
    false,
    '不得补写失败回答条目',
  );
  assert.equal(failing.orchestrator.isBusy, false, '旧代际回调不得翻转忙碌标志');

  // 变体二：迟到的是携带事件的流——同样整体丢弃
  const streaming = createTutorHarness({ phase: 'boundary' });
  const releaseStreaming = streaming.holdNextTutorFetch();
  streaming.submitTutorQuestion('在途问题');
  await streaming.settle();
  const streamingBefore = streaming.lesson;
  streaming.invalidate();
  releaseStreaming();
  await streaming.settle();
  await streaming.emitTutorStarted();
  await streaming.emitTutorDelta('旧代际残留内容');
  await streaming.settle();
  assert.equal(streaming.lesson, streamingBefore, '迟到流的事件一律不写入容器');
});

test('Tutor 流读取异常不改变已完成任务和任务内容', async () => {
  const harness = createTutorHarness({ phase: 'boundary' });
  const completedBefore = [...harness.lesson.runtime.completedTaskIds];
  const taskContentBefore = JSON.stringify(
    harness.lesson.streamItems.filter((item) => item.type === 'task_content'),
  );

  harness.submitTutorQuestion('304 为什么没有正文？');
  await harness.emitTutorStarted();
  await harness.emitTutorDelta('半截回答');
  await harness.failActiveStream(new TypeError('读取中途断开'));

  const answer = harness.lesson.streamItems.find((item) => item.type === 'tutor_answer');
  assert.equal(answer?.status, 'failed', '读取异常本地合成失败，不卡在 streaming');
  assert.deepEqual(harness.lesson.runtime.completedTaskIds, completedBefore, '已完成任务不变');
  assert.equal(
    JSON.stringify(harness.lesson.streamItems.filter((item) => item.type === 'task_content')),
    taskContentBefore,
    '任务内容不变',
  );
  assert.equal(harness.phase, 'boundary', '章节相位不变');
  assert.equal(harness.taskAbortCount, 0, '主任务流取消入口不被触碰');
});

test('主任务失败不取消进行中的 Tutor', async () => {
  // 流中排队的问题在任务完成后启动；随后主任务流落下失败事件，Tutor 必须继续
  const harness = createTutorHarness({ phase: 'streaming' });
  harness.submitTutorQuestion('304 为什么没有正文？');
  harness.emitTaskCompleted();
  await harness.emitTutorStarted();
  await harness.emitTutorDelta('正在回答');

  harness.emitTaskError();
  assert.equal(harness.lesson.runtime.currentTaskStatus, 'failed', '主任务进入失败态');
  const midAnswer = harness.lesson.streamItems.find((item) => item.type === 'tutor_answer');
  assert.equal(midAnswer?.status, 'streaming', '在途 Tutor 回答不受主任务失败影响');

  await harness.emitTutorCompleted('完成的回答');
  const answer = harness.lesson.streamItems.find((item) => item.type === 'tutor_answer');
  assert.equal(answer?.status, 'complete', 'Tutor 正常完成');
  assert.equal(harness.lesson.runtime.currentTaskStatus, 'failed', '主任务失败态不被 Tutor 覆盖');
  assert.equal(harness.phase, 'boundary');
});

test('问题超过自动窗口仍保留，串行回答不并发请求', async () => {
  const harness = createTutorHarness({ phase: 'boundary' });
  harness.submitTutorQuestion('第一个问题');
  harness.submitTutorQuestion('第二个问题');
  harness.submitTutorQuestion('第三个问题');
  harness.submitTutorQuestion('第四个问题');

  assert.equal(harness.tutorRequests, 1, '同一时刻只有一个 Tutor 请求在途');
  assert.equal(harness.orchestrator.isBusy, true);
  assert.equal(
    harness.lesson.streamItems.filter((item) => item.type === 'user_question').length,
    4,
    '超出窗口的问题全部保留在流中',
  );

  for (let round = 2; round <= 4; round += 1) {
    await harness.emitTutorCompleted(`第${round - 1}题的回答`);
    assert.equal(harness.tutorRequests, round, '终态后才派发下一题，从不并发');
  }
  // 收尾最后一题：保留的问题最终全部被回答，且答完不再有新请求
  await harness.emitTutorCompleted('第4题的回答');
  assert.equal(harness.tutorRequests, 4, '全部回答完毕后不再发请求');
  assert.equal(
    harness.lesson.streamItems.filter((item) => item.type === 'tutor_answer' && item.status === 'complete')
      .length,
    4,
    '保留的问题最终全部被回答',
  );
});

test('HTTP 状态失败在 Tutor 回答条目落稳定中文错误', async () => {
  // 401 且错误体无 message：通用中文文案携带状态码
  const unauthorized = createTutorHarness({ phase: 'boundary' });
  unauthorized.failNextTutorFetch(401);
  unauthorized.submitTutorQuestion('304 为什么没有正文？');
  await unauthorized.settle();
  let answer = unauthorized.lesson.streamItems.find((item) => item.type === 'tutor_answer');
  assert.equal(answer?.status, 'failed');
  assert.equal(
    answer?.type === 'tutor_answer' && answer.errorMessage,
    '答疑生成失败（401）',
  );

  // 503 携带中文错误体：采用上游文案（与 Next 代理 UPSTREAM_UNREACHABLE 一致）
  const unavailable = createTutorHarness({ phase: 'boundary' });
  unavailable.failNextTutorFetch(503, {
    code: 'UPSTREAM_UNREACHABLE',
    message: '答疑服务不可用，请稍后重试',
    retryable: true,
  });
  unavailable.submitTutorQuestion('304 为什么没有正文？');
  await unavailable.settle();
  answer = unavailable.lesson.streamItems.find((item) => item.type === 'tutor_answer');
  assert.equal(answer?.status, 'failed');
  assert.equal(
    answer?.type === 'tutor_answer' && answer.errorMessage,
    '答疑服务不可用，请稍后重试',
  );
});

test('Tutor 终态不推进章节主线', async () => {
  const harness = createTutorHarness({ phase: 'boundary' });
  const runtimeBefore = harness.lesson.runtime;
  harness.submitTutorQuestion('304 为什么没有正文？');
  await harness.emitTutorCompleted('完整回答');

  assert.equal(harness.phase, 'boundary', '回答完成后仍停在边界');
  assert.equal(harness.lesson.runtime.status, 'awaiting_user', '章节状态不推进');
  assert.equal(harness.lesson.runtime.currentTaskStatus, 'awaiting_user', '任务状态不推进');
  assert.deepEqual(harness.lesson.runtime.completedTaskIds, runtimeBefore.completedTaskIds);
  assert.equal(harness.lesson.runtime.currentTaskId, runtimeBefore.currentTaskId);
});
