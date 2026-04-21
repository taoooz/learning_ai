// hooks/useCourseActions.ts — 课程相关 action 逻辑（从 CourseContext 提取）

import { useCallback, useRef } from 'react';
import { CourseTree, GenerationStatus, NodeLesson, StoredCourseBundle, OutlineLearnerPositioning } from '@/types/course';
import {
  activateSystemCourse,
  addCourseBundle,
  deleteCourse as deleteCourseFromStorage,
  getStoredCourseBundle,
  getStoredData,
  getUserProfile,
  updateNodeLesson as saveNodeLesson,
} from '@/lib/storage';
import { getPlanningMemoryPayload, getUserMemoryStoreSnapshot } from '@/lib/memory';
import { unwrapApiResponse } from '@/lib/api-response';
import { buildNodeInfoPayload } from '@/contexts/CourseContext';

interface CourseActionsParams {
  coursesRef: React.MutableRefObject<CourseTree[]>;
  setCourses: React.Dispatch<React.SetStateAction<CourseTree[]>>;
  setCurrentCourse: React.Dispatch<React.SetStateAction<CourseTree | null>>;
  setGenerationStatus: React.Dispatch<React.SetStateAction<GenerationStatus>>;
  setGenerationError: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useCourseActions({
  coursesRef,
  setCourses,
  setCurrentCourse,
  setGenerationStatus,
  setGenerationError,
}: CourseActionsParams) {
  const pendingNodeRequests = useRef<Map<string, Promise<void>>>(new Map());

  const submitOutlineMessage = useCallback(async (topic: string, userMessage?: string) => {
    setGenerationStatus('generating');
    setGenerationError(null);

    const sessionId = userMessage ? sessionStorage.getItem('outlineSessionId') : undefined;

    const response = await fetch('/api/agents/outline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        userProfile: getUserProfile(),
        planningMemory: getPlanningMemoryPayload(topic, getUserMemoryStoreSnapshot()),
        userMessage,
        sessionId,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const msg = getGenerationErrorMessage(data, '大纲生成失败，请稍后再试。');
      setGenerationError(msg);
      setGenerationStatus('error');
      throw new Error(msg);
    }

    return response;
  }, []);

  const generateToc = useCallback(async (outline: {
    topic: string;
    learningDirection: string;
    learningGoal: string;
    learnerPositioning: OutlineLearnerPositioning;
  }) => {
    setGenerationStatus('generating');
    setGenerationError(null);
    try {
      const response = await fetch('/api/generate/toc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blueprint: outline }),
      });

      const raw = await response.json();

      if (!response.ok) {
        throw new Error(getGenerationErrorMessage(raw, '目录生成失败，请稍后再试。'));
      }

      const data = unwrapApiResponse<{ courseName: string; courseDescription: string; nodes: any[] }>(raw);
      setGenerationStatus('success');
      return data;
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : '目录生成失败，请稍后再试。');
      setGenerationStatus('error');
      throw error;
    }
  }, []);

  const generateNodeCards = useCallback(async (
    courseId: string,
    nodeIndex: number,
    options: {
      learnerBackground: { backgroundSummary: string; skipBasics: string[] };
      prevNodeSummary?: { title: string; concepts: string[] };
      nextNodeSummary?: { title: string; concepts: string[] };
    }
  ) => {
    setGenerationStatus('generating');
    setGenerationError(null);
    try {
      const bundle = getStoredCourseBundle(courseId);
      if (!bundle) throw new Error('Course bundle not found');
      const node = bundle.blueprint.nodes[nodeIndex];

      const response = await fetch('/api/generate/node/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: bundle.blueprint.topic,
          nodeInfo: {
            teachingGoal: node.teachingGoal,
            teachConceptIds: node.teachConceptIds,
            prerequisiteConceptIds: node.prerequisiteConceptIds,
          },
          learnerBackground: options.learnerBackground,
          prevNodeSummary: options.prevNodeSummary,
          nextNodeSummary: options.nextNodeSummary,
        }),
      });

      const raw = await response.json();

      if (!response.ok) {
        throw new Error(getGenerationErrorMessage(raw, '卡片生成失败，请稍后再试。'));
      }

      const data = unwrapApiResponse<{ cards: NodeLesson['cards'] }>(raw);
      setGenerationStatus('success');
      return data;
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : '卡片生成失败，请稍后再试。');
      setGenerationStatus('error');
      throw error;
    }
  }, []);

  const generateNodeQuestions = useCallback(async (courseId: string, nodeIndex: number) => {
    setGenerationStatus('generating');
    setGenerationError(null);
    try {
      const bundle = getStoredCourseBundle(courseId);
      if (!bundle) throw new Error('Course bundle not found');
      const node = bundle.blueprint.nodes[nodeIndex];
      const lesson = bundle.lessons[nodeIndex];

      const response = await fetch('/api/generate/node/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: bundle.blueprint.topic,
          nodeInfo: {
            teachingGoal: node.teachingGoal,
            teachConceptIds: node.teachConceptIds,
            prerequisiteConceptIds: node.prerequisiteConceptIds,
          },
          cards: lesson.cards,
        }),
      });

      const raw = await response.json();

      if (!response.ok) {
        throw new Error(getGenerationErrorMessage(raw, '题目生成失败，请稍后再试。'));
      }

      const data = unwrapApiResponse<{ questions: NodeLesson['questions'] }>(raw);
      setGenerationStatus('success');
      return data;
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : '题目生成失败，请稍后再试。');
      setGenerationStatus('error');
      throw error;
    }
  }, []);

  const startSystemCourse = useCallback((courseId: string) => {
    const course = activateSystemCourse(courseId);
    if (!course) {
      throw new Error('系统课程不存在');
    }

    const storedData = getStoredData();
    setCourses(storedData.courses);
    setCurrentCourse(course);
  }, []);

  const updateNodeContent = useCallback((
    courseId: string,
    nodeIndex: number,
    lesson: NodeLesson
  ) => {
    saveNodeLesson(courseId, nodeIndex, lesson);
    setCurrentCourse(prev => {
      if (!prev || prev.courseId !== courseId) return prev;
      const newNodes = [...prev.nodes];
      newNodes[nodeIndex] = { ...newNodes[nodeIndex], cards: lesson.cards, questions: lesson.questions };
      return { ...prev, nodes: newNodes };
    });
    setCourses(prev => prev.map(c => {
      if (c.courseId !== courseId) return c;
      const newNodes = [...c.nodes];
      newNodes[nodeIndex] = { ...newNodes[nodeIndex], cards: lesson.cards, questions: lesson.questions };
      return { ...c, nodes: newNodes };
    }));
  }, []);

  const generateNodeContent = useCallback(async (courseId: string, nodeIndex: number) => {
    const course = coursesRef.current.find(c => c.courseId === courseId);
    if (!course || course.nodes[nodeIndex].cards) return;

    const key = `${courseId}:${nodeIndex}`;
    const existing = pendingNodeRequests.current.get(key);
    if (existing) return existing;

    const bundle = getStoredCourseBundle(courseId);
    if (!bundle) throw new Error('Course bundle not found');

    const promise = (async () => {
      try {
        const nodeInfo = buildNodeInfoPayload(bundle, nodeIndex);
        const lp = bundle.blueprint.learnerPositioning as typeof bundle.blueprint.learnerPositioning & {
          backgroundSummary?: string;
        };

        const response = await fetch('/api/generate/node/cards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic: bundle.blueprint.topic,
            nodeInfo: {
              title: nodeInfo.title,
              teachingGoal: nodeInfo.teachingGoal,
              teachConceptIds: nodeInfo.teachConceptIds,
              prerequisiteConceptIds: nodeInfo.prerequisiteConceptIds,
            },
            learnerBackground: {
              backgroundSummary: lp.backgroundSummary || '',
              skipBasics: lp.skipBasics || [],
            },
            prevNodeSummary: nodeInfo.prevNode,
            nextNodeSummary: nodeInfo.nextNode,
          }),
        });

        const raw = await response.json();
        if (!response.ok) {
          throw new Error(getGenerationErrorMessage(raw, '这一节内容生成失败，请稍后再试。'));
        }

        const data = unwrapApiResponse<{ cards: NodeLesson['cards'] }>(raw);
        const cards = data.cards || [];
        const node = bundle.blueprint.nodes[nodeIndex];
        const lesson: NodeLesson = {
          courseId,
          nodeIndex,
          title: node.title,
          teachingGoal: node.teachingGoal,
          teachConceptIds: node.teachConceptIds || [],
          assessmentTargetIds: [],
          cards,
          questions: [],
        };
        updateNodeContent(courseId, nodeIndex, lesson);
      } catch (error) {
        throw (error instanceof Error ? error : new Error('这一节内容生成失败，请稍后再试。'));
      } finally {
        pendingNodeRequests.current.delete(key);
      }
    })();

    pendingNodeRequests.current.set(key, promise);
    return promise;
  }, [updateNodeContent]);

  const preloadNextNode = useCallback((courseId: string, currentNodeIndex: number) => {
    const course = coursesRef.current.find(c => c.courseId === courseId);
    if (!course) return;

    const nextIndex = currentNodeIndex + 1;
    if (nextIndex >= course.nodes.length) return;
    if (course.nodes[nextIndex].cards) return;

    generateNodeContent(courseId, nextIndex).catch(() => {});
  }, [generateNodeContent]);

  const updateNodeQuestions = useCallback((
    courseId: string,
    nodeIndex: number,
    questions: NodeLesson['questions']
  ) => {
    const bundle = getStoredCourseBundle(courseId);
    if (!bundle) return;
    const existingLesson = bundle.lessons[nodeIndex];
    if (!existingLesson) return;
    const lesson: NodeLesson = {
      ...existingLesson,
      courseId,
      nodeIndex,
      questions: questions || [],
    };
    saveNodeLesson(courseId, nodeIndex, lesson);
    setCurrentCourse(prev => {
      if (!prev || prev.courseId !== courseId) return prev;
      const newNodes = [...prev.nodes];
      newNodes[nodeIndex] = { ...newNodes[nodeIndex], questions };
      return { ...prev, nodes: newNodes };
    });
    setCourses(prev => prev.map(c => {
      if (c.courseId !== courseId) return c;
      const newNodes = [...c.nodes];
      newNodes[nodeIndex] = { ...newNodes[nodeIndex], questions };
      return { ...c, nodes: newNodes };
    }));
  }, []);

  const deleteCourse = useCallback((courseId: string) => {
    deleteCourseFromStorage(courseId);
    setCourses(prev => prev.filter(c => c.courseId !== courseId));
    setCurrentCourse(prev => prev?.courseId === courseId ? null : prev);
  }, []);

  const addCourse = useCallback((bundle: StoredCourseBundle) => {
    addCourseBundle(bundle);
    const data = getStoredData();
    setCourses(data.courses);
    setCurrentCourse(data.courses.find(c => c.courseId === data.currentCourseId) || null);
  }, []);

  return {
    submitOutlineMessage,
    generateToc,
    generateNodeCards,
    generateNodeQuestions,
    startSystemCourse,
    generateNodeContent,
    preloadNextNode,
    updateNodeContent,
    updateNodeQuestions,
    deleteCourse,
    addCourse,
  };
}

function getGenerationErrorMessage(data: unknown, fallback: string): string {
  if (typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string') {
    return data.error;
  }
  return fallback;
}
