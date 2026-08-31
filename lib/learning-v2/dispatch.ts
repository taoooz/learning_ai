// lib/learning-v2/dispatch.ts
// V1/V2 协议检测与课程存储分发
// 依据 docs/architecture/v2_课程生成逻辑.md §11 P0「建立 Feature Flag 和 V1/V2 渲染分发」
// §12 兼容要求：旧课程无 protocolVersion 时按 V1 处理；
// §13 禁止捷径：V1/V2 不混入同一个无版本对象，分发层返回判别联合。

import type { StoredCourseBundle, StoredDataV2 } from '@/types/course';
import type { StoredCourseV2 } from '@/types/learning-v2';
import { getStoredDataV2 } from '@/lib/storage';

export type ProtocolVersion = 1 | 2;

/**
 * 检测课程/蓝图对象的协议版本。
 * 无 protocolVersion 字段、或值不为 2 的，一律按 V1（§12）。
 */
export function detectProtocolVersion(value: unknown): ProtocolVersion {
  if (
    typeof value === 'object' &&
    value !== null &&
    (value as { protocolVersion?: unknown }).protocolVersion === 2
  ) {
    return 2;
  }
  return 1;
}

/** 分发结果：判别联合，V1/V2 各走各的类型（§13） */
export type ResolvedStoredCourse =
  | { protocol: 1; course: StoredCourseBundle }
  | { protocol: 2; course: StoredCourseV2 };

/**
 * 按 courseId 查找课程存储容器（纯函数，便于测试）。
 * 优先查 v2Courses，命中返回 V2；否则回退 V1 courses；都未命中返回 null。
 */
export function resolveStoredCourseFromData(
  data: StoredDataV2,
  courseId: string,
): ResolvedStoredCourse | null {
  const v2 = (data.v2Courses ?? []).find((course) => course.courseId === courseId);
  if (v2) return { protocol: 2, course: v2 };
  const v1 = data.courses.find((course) => course.blueprint.courseId === courseId);
  if (v1) return { protocol: 1, course: v1 };
  return null;
}

/** 按 courseId 查找课程存储容器（读取全局存储，SSR 无 window 时返回 null） */
export function resolveStoredCourse(courseId: string): ResolvedStoredCourse | null {
  if (typeof window === 'undefined') return null;
  return resolveStoredCourseFromData(getStoredDataV2(), courseId);
}
