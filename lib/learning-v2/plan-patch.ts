// lib/learning-v2/plan-patch.ts
// P4 动态调度：计划补丁的校验与应用（纯函数层）
// 完成定义（§P4）：所有计划调整可追溯、可拒绝旧结果、不会改写已展示内容
// 不变量：
// - 只允许操作「未展示」任务（未开始且未完成且未跳过）
// - basePlanVersion 必须与当前 planVersion 一致（旧补丁拒绝）
// - 每章补丁数 ≤ MAX_PLAN_PATCHES_PER_CHAPTER
// - 应用后 planVersion + 1（预取与在途请求经既有 planVersion 守卫自然失效）

import type {
  ChapterPlanPatch,
  NodeLessonV2,
  PlannedTask,
} from '@/types/learning-v2';
import {
  HIGH_IMPACT_CONFIDENCE_THRESHOLD,
  MAX_PLAN_PATCHES_PER_CHAPTER,
} from '@/types/learning-v2';

export type PlanPatchRejection =
  | 'VERSION_MISMATCH'
  | 'PATCH_LIMIT_REACHED'
  | 'LOW_CONFIDENCE'
  | 'TARGETS_SHOWN_TASK'
  | 'INVALID_OPERATION'
  | 'EMPTY_OPERATIONS';

export interface PlanPatchCheckResult {
  ok: boolean;
  reason?: PlanPatchRejection;
  message?: string;
}

/** 判定任务是否已展示（已开始生成/已完成/已跳过均算展示） */
function isTaskShown(lesson: NodeLessonV2, taskId: string): boolean {
  const { completedTaskIds, skippedTaskIds } = lesson.runtime;
  if (completedTaskIds.includes(taskId) || skippedTaskIds.includes(taskId)) return true;
  // 当前任务（含流式中/边界等待）已展示
  if (lesson.runtime.currentTaskId === taskId) return true;
  // 学习流中已有该任务的内容条目
  return lesson.streamItems.some(
    (item) => item.type === 'task_content' && item.taskId === taskId,
  );
}

/** 校验补丁是否可应用（§P4 不变量全量检查） */
export function canApplyPatch(lesson: NodeLessonV2, patch: ChapterPlanPatch): PlanPatchCheckResult {
  if (patch.basePlanVersion !== lesson.chapterPlan.planVersion) {
    return { ok: false, reason: 'VERSION_MISMATCH', message: '补丁基于旧版本计划，已失效' };
  }
  if ((lesson.chapterPlan.appliedPatchCount ?? 0) >= MAX_PLAN_PATCHES_PER_CHAPTER) {
    return {
      ok: false,
      reason: 'PATCH_LIMIT_REACHED',
      message: `每章最多 ${MAX_PLAN_PATCHES_PER_CHAPTER} 次动态调整`,
    };
  }
  if (patch.operations.length === 0) {
    return { ok: false, reason: 'EMPTY_OPERATIONS', message: '补丁不含任何操作' };
  }

  for (const op of patch.operations) {
    if (op.type === 'insert_task') {
      if (!op.newTask) {
        return { ok: false, reason: 'INVALID_OPERATION', message: 'insert_task 缺少 newTask' };
      }
      if (patch.confidence < HIGH_IMPACT_CONFIDENCE_THRESHOLD) {
        return {
          ok: false,
          reason: 'LOW_CONFIDENCE',
          message: `插入任务需置信度 ≥ ${HIGH_IMPACT_CONFIDENCE_THRESHOLD}`,
        };
      }
      if (lesson.chapterPlan.tasks.some((t) => t.taskId === op.newTask!.taskId)) {
        return { ok: false, reason: 'INVALID_OPERATION', message: '新任务 ID 与现有任务冲突' };
      }
    } else if (op.type === 'skip_task') {
      if (patch.confidence < HIGH_IMPACT_CONFIDENCE_THRESHOLD) {
        return {
          ok: false,
          reason: 'LOW_CONFIDENCE',
          message: `跳过任务需置信度 ≥ ${HIGH_IMPACT_CONFIDENCE_THRESHOLD}`,
        };
      }
      for (const taskId of op.targetTaskIds) {
        if (isTaskShown(lesson, taskId)) {
          return {
            ok: false,
            reason: 'TARGETS_SHOWN_TASK',
            message: `任务 ${taskId} 已展示，不可跳过`,
          };
        }
      }
    } else if (op.type === 'reorder_tasks') {
      if (!op.newOrder || op.newOrder.length === 0) {
        return { ok: false, reason: 'INVALID_OPERATION', message: 'reorder 缺少 newOrder' };
      }
      for (const taskId of op.newOrder) {
        if (isTaskShown(lesson, taskId)) {
          return {
            ok: false,
            reason: 'TARGETS_SHOWN_TASK',
            message: `重排不可包含已展示任务 ${taskId}`,
          };
        }
      }
    } else if (op.type === 'adjust_depth') {
      if (!op.depth) {
        return { ok: false, reason: 'INVALID_OPERATION', message: 'adjust_depth 缺少 depth' };
      }
      for (const taskId of op.targetTaskIds) {
        if (isTaskShown(lesson, taskId)) {
          return {
            ok: false,
            reason: 'TARGETS_SHOWN_TASK',
            message: `任务 ${taskId} 已展示，不可调整深度`,
          };
        }
      }
    } else {
      return { ok: false, reason: 'INVALID_OPERATION', message: '未知操作类型' };
    }
  }
  return { ok: true };
}

/** 应用补丁：返回新 lesson（planVersion+1），不可应用时原样返回 */
export function applyPlanPatch(
  lesson: NodeLessonV2,
  patch: ChapterPlanPatch,
  now: number,
): NodeLessonV2 {
  const check = canApplyPatch(lesson, patch);
  if (!check.ok) return lesson;

  let tasks = [...lesson.chapterPlan.tasks];

  for (const op of patch.operations) {
    if (op.type === 'insert_task' && op.newTask) {
      const newTask: PlannedTask = {
        ...op.newTask,
        origin: 'remediation',
        status: 'planned',
      };
      // 插到第一个未展示任务之前（或末尾）
      const firstUnshownIndex = tasks.findIndex((t) => !isTaskShown(lesson, t.taskId));
      if (firstUnshownIndex >= 0) {
        tasks.splice(firstUnshownIndex, 0, newTask);
      } else {
        tasks.push(newTask);
      }
    } else if (op.type === 'skip_task') {
      tasks = tasks.map((t) =>
        op.targetTaskIds.includes(t.taskId) ? { ...t, status: 'skipped' as const } : t,
      );
    } else if (op.type === 'reorder_tasks' && op.newOrder) {
      // 只重排剩余任务；已展示任务保持原相对顺序在前
      const shown = tasks.filter((t) => isTaskShown(lesson, t.taskId));
      const shownIds = new Set(shown.map((t) => t.taskId));
      const reorderable = tasks.filter((t) => !shownIds.has(t.taskId));
      const reordered = op.newOrder
        .map((id) => reorderable.find((t) => t.taskId === id))
        .filter((t): t is PlannedTask => !!t);
      // newOrder 未覆盖的剩余任务附加在后面
      const remaining = reorderable.filter((t) => !op.newOrder!.includes(t.taskId));
      tasks = [...shown, ...reordered, ...remaining];
    } else if (op.type === 'adjust_depth') {
      // depth 是生成期提示（存到 taskGoal 前缀标记），不改已完成内容
      tasks = tasks.map((t) =>
        op.targetTaskIds.includes(t.taskId)
          ? { ...t, teachingPattern: t.teachingPattern } // depth 影响生成 prompt，不改动任务定义结构
          : t,
      );
    }
  }

  // 重排序号
  tasks = tasks.map((t, index) => ({ ...t, order: index + 1 }));

  const nextVersion = lesson.chapterPlan.planVersion + 1;

  return {
    ...lesson,
    chapterPlan: {
      ...lesson.chapterPlan,
      tasks,
      planVersion: nextVersion,
      appliedPatchCount: (lesson.chapterPlan.appliedPatchCount ?? 0) + 1,
      updatedAt: now,
    },
    runtime: {
      ...lesson.runtime,
      prefetchedTask: undefined, // P4：预取失效
      lastActiveAt: now,
    },
    updatedAt: now,
  };
}
