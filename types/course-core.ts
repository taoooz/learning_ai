// types/course-core.ts — 当前学习数据容器

import type { UserProfile, StoredRecommendation } from './user-profile';
import type { StoredCourse } from './learning-v2';

export interface StoredData {
  /** 唯一课程容器。新课程只写这里，不存在 V1 courses 字段。 */
  courses: StoredCourse[];
  userProfile: UserProfile | null;
  recommendations: StoredRecommendation[];
}
