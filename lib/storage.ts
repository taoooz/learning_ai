// lib/storage.ts
import { StoredData, CourseTree, CourseProgress, UserProfile } from '@/types/course';

const STORAGE_KEY = 'ai-learning-data';

const defaultData: StoredData = {
  courses: [],
  currentCourseId: null,
  courseProgress: {},
  userProfile: null,
};

export function getStoredData(): StoredData {
  if (typeof window === 'undefined') return defaultData;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData;
    return JSON.parse(raw) as StoredData;
  } catch {
    return defaultData;
  }
}

export function saveStoredData(data: StoredData): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function addCourse(course: CourseTree): void {
  const data = getStoredData();
  data.courses.push(course);
  data.currentCourseId = course.courseId;
  saveStoredData(data);
}

export function getCurrentCourse(): CourseTree | null {
  const data = getStoredData();
  if (!data.currentCourseId) return null;
  return data.courses.find(c => c.courseId === data.currentCourseId) || null;
}

export function updateNodeContent(
  courseId: string,
  nodeIndex: number,
  cards: CourseTree['nodes'][0]['cards'],
  questions: CourseTree['nodes'][0]['questions']
): void {
  const data = getStoredData();
  const course = data.courses.find(c => c.courseId === courseId);
  if (course && course.nodes[nodeIndex]) {
    course.nodes[nodeIndex].cards = cards;
    course.nodes[nodeIndex].questions = questions;
    saveStoredData(data);
  }
}

export function markNodeCompleted(courseId: string, nodeIndex: number): void {
  const data = getStoredData();
  if (!data.courseProgress[courseId]) {
    data.courseProgress[courseId] = {};
  }
  data.courseProgress[courseId][nodeIndex] = 'completed';

  // 解锁下一个节点
  const course = data.courses.find(c => c.courseId === courseId);
  if (course && nodeIndex + 1 < course.nodes.length) {
    course.nodes[nodeIndex + 1].status = 'available';
  }

  saveStoredData(data);
}

export function getNodeProgress(courseId: string, nodeIndex: number): 'completed' | 'in_progress' | null {
  const data = getStoredData();
  return data.courseProgress[courseId]?.[nodeIndex] || null;
}

export function getUserProfile(): UserProfile | null {
  const data = getStoredData();
  return data.userProfile;
}

export function saveUserProfile(profile: UserProfile): void {
  const data = getStoredData();
  data.userProfile = profile;
  saveStoredData(data);
}

export function deleteCourse(courseId: string): void {
  const data = getStoredData();
  data.courses = data.courses.filter(c => c.courseId !== courseId);
  delete data.courseProgress[courseId];
  if (data.currentCourseId === courseId) {
    data.currentCourseId = data.courses.length > 0 ? data.courses[0].courseId : null;
  }
  saveStoredData(data);
}