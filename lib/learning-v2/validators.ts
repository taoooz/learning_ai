// lib/learning-v2/validators.ts
// V2 蓝图与章节计划校验
// 依据 docs/architecture/v2_课程生成逻辑.md §2.1（蓝图校验）/ §2.2（计划校验拦截项）

import type {
  ChapterDefinition,
  ChapterPlan,
  CourseBlueprintV2,
  PlanValidationIssue,
  PlanValidationResult,
} from '@/types/learning-v2';

// ---- 蓝图校验 ----

export interface BlueprintValidationResult {
  passed: boolean;
  issues: string[];
}

/** observableOutcome 空泛描述检测：应是可观察行为，不是「深入理解」类表述 */
const VAGUE_OUTCOME_PATTERNS = [/^深入(理解|了解)/, /^充分(理解|了解)/, /^(理解|了解|掌握)$/];

/**
 * 蓝图校验规则（§2.1）：
 * ID 唯一且引用存在、至少一个核心目标、每章至少绑一个目标、
 * 核心目标至少被一章覆盖、章节依赖无环、排除项不为必学、
 * observableOutcome 是行为描述。
 */
export function validateCourseBlueprintV2(blueprint: CourseBlueprintV2): BlueprintValidationResult {
  const issues: string[] = [];

  if (!blueprint.topic.trim()) {
    issues.push('蓝图缺少主题。');
  }
  if (blueprint.courseObjectives.length === 0) {
    issues.push('蓝图缺少课程目标。');
  }
  if (blueprint.chapters.length === 0) {
    issues.push('蓝图缺少章节。');
  }

  // ID 唯一性
  const objectiveIds = new Set<string>();
  for (const objective of blueprint.courseObjectives) {
    if (objectiveIds.has(objective.objectiveId)) {
      issues.push(`课程目标 ID 重复：${objective.objectiveId}`);
    }
    objectiveIds.add(objective.objectiveId);

    if (!objective.observableOutcome.trim()) {
      issues.push(`课程目标 ${objective.objectiveId} 缺少可观察结果。`);
    } else if (VAGUE_OUTCOME_PATTERNS.some((p) => p.test(objective.observableOutcome.trim()))) {
      issues.push(`课程目标 ${objective.objectiveId} 的可观察结果是空泛描述：${objective.observableOutcome}`);
    }
  }

  const chapterIds = new Set<string>();
  const chapterIndexes = new Set<number>();
  for (const chapter of blueprint.chapters) {
    if (chapterIds.has(chapter.chapterId)) {
      issues.push(`章节 ID 重复：${chapter.chapterId}`);
    }
    chapterIds.add(chapter.chapterId);

    if (chapterIndexes.has(chapter.index)) {
      issues.push(`章节序号重复：${chapter.index}`);
    }
    chapterIndexes.add(chapter.index);
  }

  // 引用存在性 + 每章至少绑一个目标
  for (const chapter of blueprint.chapters) {
    if (chapter.objectiveIds.length === 0) {
      issues.push(`章节 ${chapter.chapterId} 未绑定任何课程目标。`);
    }
    for (const objectiveId of chapter.objectiveIds) {
      if (!objectiveIds.has(objectiveId)) {
        issues.push(`章节 ${chapter.chapterId} 绑定了未声明的目标：${objectiveId}`);
      }
    }
    for (const prerequisite of chapter.prerequisites) {
      if (!chapterIds.has(prerequisite)) {
        issues.push(`章节 ${chapter.chapterId} 的前置依赖不存在：${prerequisite}`);
      }
    }
  }

  // 至少一个核心目标
  if (!blueprint.courseObjectives.some((o) => o.importance === 'core')) {
    issues.push('蓝图至少需要一个 core 级课程目标。');
  }

  // 核心目标至少被一章覆盖
  const coveredObjectiveIds = new Set(blueprint.chapters.flatMap((c) => c.objectiveIds));
  for (const objective of blueprint.courseObjectives) {
    if (objective.importance === 'core' && !coveredObjectiveIds.has(objective.objectiveId)) {
      issues.push(`核心目标未被任何章节覆盖：${objective.objectiveId}`);
    }
  }

  // 章节依赖无环
  const cycle = findChapterCycle(blueprint.chapters);
  if (cycle) {
    issues.push(`章节依赖存在循环：${cycle.join(' → ')}`);
  }

  // 排除项不为必学（形式化近似：章节标题不得与排除主题完全一致）
  const excluded = new Set(
    blueprint.learnerStartingPoint.excludedTopics.map((topic) => topic.trim()),
  );
  for (const chapter of blueprint.chapters) {
    if (excluded.has(chapter.title.trim())) {
      issues.push(`章节 ${chapter.chapterId} 的标题与用户排除主题一致：${chapter.title}`);
    }
  }

  return { passed: issues.length === 0, issues };
}

/** DFS 查找章节依赖环，返回环路径（如 ['ch1','ch2','ch1']），无环返回 null */
function findChapterCycle(chapters: ChapterDefinition[]): string[] | null {
  const adjacency = new Map(chapters.map((c) => [c.chapterId, c.prerequisites]));
  const visited = new Set<string>();
  const onPath = new Set<string>();
  const path: string[] = [];

  function visit(chapterId: string): string[] | null {
    if (onPath.has(chapterId)) {
      return [...path.slice(path.indexOf(chapterId)), chapterId];
    }
    if (visited.has(chapterId)) return null;
    visited.add(chapterId);
    onPath.add(chapterId);
    path.push(chapterId);
    for (const prerequisite of adjacency.get(chapterId) ?? []) {
      const cycle = visit(prerequisite);
      if (cycle) return cycle;
    }
    onPath.delete(chapterId);
    path.pop();
    return null;
  }

  for (const chapter of chapters) {
    const cycle = visit(chapter.chapterId);
    if (cycle) return cycle;
  }
  return null;
}

// ---- 章节计划校验 ----

/** 稳定错误码，供日志与 SSE request_warning/request_error 复用 */
export const PLAN_VALIDATION_CODES = {
  CHAPTER_OBJECTIVE_MISSING: 'CHAPTER_OBJECTIVE_MISSING',
  OBJECTIVE_NOT_COVERED: 'OBJECTIVE_NOT_COVERED',
  UNKNOWN_OBJECTIVE: 'UNKNOWN_OBJECTIVE',
  DUPLICATE_TASK_ID: 'DUPLICATE_TASK_ID',
  DUPLICATE_TASK_ORDER: 'DUPLICATE_TASK_ORDER',
  PREREQ_TASK_NOT_FOUND: 'PREREQ_TASK_NOT_FOUND',
  PREREQ_CYCLE: 'PREREQ_CYCLE',
  EMPTY_TASK_FIELD: 'EMPTY_TASK_FIELD',
  TASK_COUNT_OUT_OF_RANGE: 'TASK_COUNT_OUT_OF_RANGE',
  SINGLE_TEACHING_PATTERN: 'SINGLE_TEACHING_PATTERN',
  TITLE_REPEATS_CHAPTER: 'TITLE_REPEATS_CHAPTER',
} as const;

/**
 * 章节计划校验（§2.2 拦截项）：
 * 目标覆盖缺失、重复任务、依赖指向不存在任务、循环依赖、
 * 全章同一教学模式、任务描述只是章节标题改写。
 *
 * @param chapter 可选；提供时校验计划对章节目标的覆盖与标题改写
 */
export function validateChapterPlan(
  plan: ChapterPlan,
  chapter?: ChapterDefinition,
): PlanValidationResult {
  const errors: PlanValidationIssue[] = [];
  const warnings: PlanValidationIssue[] = [];

  const planObjectiveIds = new Set(plan.objectiveIds);

  // 章节目标覆盖
  if (chapter) {
    for (const objectiveId of chapter.objectiveIds) {
      if (!planObjectiveIds.has(objectiveId)) {
        errors.push({
          code: PLAN_VALIDATION_CODES.CHAPTER_OBJECTIVE_MISSING,
          message: `计划缺少章节目标：${objectiveId}`,
        });
      }
    }
  }

  // 任务结构
  const taskIds = new Set<string>();
  const orders = new Set<number>();
  for (const task of plan.tasks) {
    if (!task.taskId.trim() || !task.title.trim() || !task.taskGoal.trim()) {
      errors.push({
        code: PLAN_VALIDATION_CODES.EMPTY_TASK_FIELD,
        taskId: task.taskId || undefined,
        message: '任务缺少 taskId、标题或目标描述。',
      });
    }
    if (taskIds.has(task.taskId)) {
      errors.push({
        code: PLAN_VALIDATION_CODES.DUPLICATE_TASK_ID,
        taskId: task.taskId,
        message: `任务 ID 重复：${task.taskId}`,
      });
    }
    taskIds.add(task.taskId);

    if (orders.has(task.order)) {
      errors.push({
        code: PLAN_VALIDATION_CODES.DUPLICATE_TASK_ORDER,
        taskId: task.taskId,
        message: `任务顺序重复：${task.order}`,
      });
    }
    orders.add(task.order);

    if (!planObjectiveIds.has(task.objectiveId)) {
      errors.push({
        code: PLAN_VALIDATION_CODES.UNKNOWN_OBJECTIVE,
        taskId: task.taskId,
        message: `任务绑定了计划外的目标：${task.objectiveId}`,
      });
    }

    for (const prerequisiteTaskId of task.prerequisiteTaskIds) {
      if (!plan.tasks.some((t) => t.taskId === prerequisiteTaskId)) {
        errors.push({
          code: PLAN_VALIDATION_CODES.PREREQ_TASK_NOT_FOUND,
          taskId: task.taskId,
          message: `任务依赖不存在：${prerequisiteTaskId}`,
        });
      }
    }

    if (chapter && task.title.trim() === chapter.title.trim()) {
      warnings.push({
        code: PLAN_VALIDATION_CODES.TITLE_REPEATS_CHAPTER,
        taskId: task.taskId,
        message: `任务标题只是章节标题的复述：${task.title}`,
      });
    }
  }

  // 目标覆盖：每个计划目标至少被一个任务承载
  const coveredByTasks = new Set(plan.tasks.map((t) => t.objectiveId));
  for (const objectiveId of plan.objectiveIds) {
    if (!coveredByTasks.has(objectiveId)) {
      errors.push({
        code: PLAN_VALIDATION_CODES.OBJECTIVE_NOT_COVERED,
        message: `计划目标未被任何任务覆盖：${objectiveId}`,
      });
    }
  }

  // 任务依赖无环
  const cycle = findTaskCycle(plan);
  if (cycle) {
    errors.push({
      code: PLAN_VALIDATION_CODES.PREREQ_CYCLE,
      message: `任务依赖存在循环：${cycle.join(' → ')}`,
    });
  }

  // 任务数量建议 3～7（软约束）
  if (plan.tasks.length < 3 || plan.tasks.length > 7) {
    warnings.push({
      code: PLAN_VALIDATION_CODES.TASK_COUNT_OUT_OF_RANGE,
      message: `任务数量 ${plan.tasks.length} 超出建议范围 3～7。`,
    });
  }

  // 全章同一教学模式（软约束）
  const patterns = new Set(plan.tasks.map((t) => t.teachingPattern));
  if (plan.tasks.length >= 2 && patterns.size === 1) {
    warnings.push({
      code: PLAN_VALIDATION_CODES.SINGLE_TEACHING_PATTERN,
      message: `全章使用同一教学模式：${plan.tasks[0].teachingPattern}`,
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** DFS 查找任务依赖环，返回环路径，无环返回 null */
function findTaskCycle(plan: ChapterPlan): string[] | null {
  const adjacency = new Map(plan.tasks.map((t) => [t.taskId, t.prerequisiteTaskIds]));
  const visited = new Set<string>();
  const onPath = new Set<string>();
  const path: string[] = [];

  function visit(taskId: string): string[] | null {
    if (onPath.has(taskId)) {
      return [...path.slice(path.indexOf(taskId)), taskId];
    }
    if (visited.has(taskId)) return null;
    visited.add(taskId);
    onPath.add(taskId);
    path.push(taskId);
    for (const prerequisite of adjacency.get(taskId) ?? []) {
      const cycle = visit(prerequisite);
      if (cycle) return cycle;
    }
    onPath.delete(taskId);
    path.pop();
    return null;
  }

  for (const task of plan.tasks) {
    const cycle = visit(task.taskId);
    if (cycle) return cycle;
  }
  return null;
}
