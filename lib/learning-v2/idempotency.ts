// lib/learning-v2/idempotency.ts
// V2 幂等键构建与注册表
// 依据 docs/architecture/v2_课程生成逻辑.md §6.2：
// 创建 Chapter Plan、生成 Task Attempt、提交 Checkpoint、完成章节需幂等键；
// 同一幂等键重复请求应返回既有结果，不重复创建。

/** 章节计划幂等键：同一课程同一章节同一蓝图只生成一份计划 */
export function buildChapterPlanIdempotencyKey(
  courseId: string,
  chapterId: string,
  blueprintId: string,
): string {
  return `plan:${courseId}:${chapterId}:${blueprintId}`;
}

/** 任务生成幂等键：同一计划版本下同一任务同一次尝试只生成一份内容 */
export function buildTaskAttemptIdempotencyKey(
  courseId: string,
  chapterId: string,
  planId: string,
  planVersion: number,
  taskId: string,
  attempt: number,
): string {
  return `task:${courseId}:${chapterId}:${planId}:v${planVersion}:${taskId}:a${attempt}`;
}

/** 章节完成幂等键：同一计划版本下章节只完成一次 */
export function buildChapterCompleteIdempotencyKey(
  courseId: string,
  chapterId: string,
  planId: string,
  planVersion: number,
): string {
  return `complete:${courseId}:${chapterId}:${planId}:v${planVersion}`;
}

/** Tutor 问题幂等键（P2）：同一章节同一任务同一问题只入流一次（设计文档 §2.1） */
export function buildTutorQuestionIdempotencyKey(
  chapterId: string,
  taskId: string,
  questionId: string,
): string {
  return `uq:${chapterId}:${taskId}:${questionId}`;
}

/** Tutor 回答请求幂等键（P2）：同一计划版本下同一问题同一时间只发起一次 Tutor 请求（设计文档 §3.3） */
export function buildTutorRequestIdempotencyKey(
  chapterId: string,
  planVersion: number,
  taskId: string,
  questionId: string,
): string {
  return `tutor:${chapterId}:v${planVersion}:${taskId}:${questionId}`;
}

/**
 * 幂等注册表：同一键首次调用执行 create 并缓存，
 * 后续同键调用直接返回既有结果（§6.2 同键返回既有结果）。
 * Checkpoint 幂等键推迟到 P3 与 Evidence 一起定稿。
 */
export class IdempotencyRegistry<T> {
  private readonly results = new Map<string, T>();

  /** 同键返回既有结果；首次调用执行 create */
  async run(key: string, create: () => Promise<T>): Promise<T> {
    const cached = this.results.get(key);
    if (cached !== undefined) return cached;
    const created = await create();
    this.results.set(key, created);
    return created;
  }

  has(key: string): boolean {
    return this.results.has(key);
  }

  get(key: string): T | undefined {
    return this.results.get(key);
  }

  clear(): void {
    this.results.clear();
  }
}
