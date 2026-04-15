// types/user-profile.ts — 用户画像、洞察、推荐相关类型

export interface StoredRecommendation {
  title: string;
  reason: string;
  createdAt: number;
}

export interface LearningInsight {
  workSummary: string[];
  educationSummary: string[];
  analogyExperiences: string[];
  learningStyle: '理论型' | '实践型' | '';
  technicalLevel: '入门级' | '业务级' | '专家型' | '';
  valuePriorities: string[];
  summary: string;
}

export interface WorkExperience {
  id: string;
  company: string;
  position: string;
  description?: string;
}

export interface Education {
  id: string;
  school: string;
  major: string;
}

export interface UserProfile {
  name?: string;
  targetJob: string;
  workExperience: WorkExperience[];
  education: Education[];
  insights?: LearningInsight;
}
