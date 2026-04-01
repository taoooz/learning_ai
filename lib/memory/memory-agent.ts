// lib/memory/memory-agent.ts
import type {
  ChatMemoryPayload,
  ConceptProjection,
  CourseBlueprint,
  MemoryStoreV2,
  MemoryStoreV3,
  PlanningMemoryPayload,
  TeachingMemoryPayload,
  UserMemory,
} from '@/types/course';
import { migrateMemoryToV3 } from './aggregator';
import { CHAT_CONCEPT_ALIASES } from './aliases';
import { getConceptGraph, getPrerequisites } from './concept-graph';

// ============ 配置常量 ============
const MAX_CONCEPTS = 200;
const MAX_TOPICS = 50;
const MAX_COURSES = 30;
const MAX_EVENTS = 300;

const MASTERY_DECAY_HALF_LIFE_DAYS = 30;
const CONCEPT_CLEANUP_THRESHOLD = 0.3;
const CONCEPT_CLEANUP_AGE_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

// ============ 工具函数 ============

/** 计算遗忘曲线衰减后的掌握度 */
function applyForgettingCurve(masteryScore: number, lastReviewedAt: number, now: number): number {
  const daysSinceReview = (now - lastReviewedAt) / DAY_MS;
  return masteryScore * Math.exp(-daysSinceReview / MASTERY_DECAY_HALF_LIFE_DAYS);
}

/** 计算时间新鲜度分数 */
function getFreshnessScore(timestamp: number, now: number = Date.now()): number {
  const daysSince = (now - timestamp) / DAY_MS;
  return Math.exp(-daysSince / 21);
}

/** 计算主题相关性分数 */
function getTopicRelevanceScore(query: string, target: string): number {
  const q = query.toLowerCase().replace(/\s+/g, '');
  const t = target.toLowerCase().replace(/\s+/g, '');
  
  if (q === t) return 1.0;
  if (q.includes(t) || t.includes(q)) return 0.8;
  
  // 检查别名
  const qNorm = normalizeConceptKey(query);
  const tNorm = normalizeConceptKey(target);
  if (qNorm === tNorm) return 0.9;
  
  const overlap = [...q].filter(c => t.includes(c)).length;
  return Math.min(0.7, overlap / Math.max(q.length, t.length));
}

/** 规范化概念别名 */
function normalizeConceptKey(concept: string): string {
  const normalized = concept.toLowerCase().replace(/\s+/g, '');
  
  for (const [canonical, aliases] of Object.entries(CHAT_CONCEPT_ALIASES)) {
    if (normalized === canonical.toLowerCase()) return canonical;
    if (aliases.some(alias => normalized === alias.toLowerCase())) return canonical;
  }
  
  return concept;
}

// ============ 数据清理 ============

/** 清理过期低价值概念 */
export function cleanupOldConcepts(memoryStore: MemoryStoreV3, now: number = Date.now()): MemoryStoreV3 {
  const conceptProjections = memoryStore.projections.conceptProjections.filter(concept => {
    const decayedMastery = applyForgettingCurve(concept.masteryScore, concept.updatedAt, now);
    const ageInDays = (now - concept.updatedAt) / DAY_MS;
    
    if (decayedMastery >= CONCEPT_CLEANUP_THRESHOLD) return true;
    if (ageInDays < CONCEPT_CLEANUP_AGE_DAYS) return true;
    
    return false;
  });

  return {
    ...memoryStore,
    projections: {
      ...memoryStore.projections,
      conceptProjections,
    },
  };
}

/** 限制数据规模 */
export function enforceDataLimits(memoryStore: MemoryStoreV3, now: number = Date.now()): MemoryStoreV3 {
  let { conceptProjections, topicProjections, episodicProjections } = memoryStore.projections;
  let { events } = memoryStore;

  // 1. 限制概念数量
  if (conceptProjections.length > MAX_CONCEPTS) {
    conceptProjections = conceptProjections
      .map(c => ({
        ...c,
        _score: applyForgettingCurve(c.masteryScore, c.updatedAt, now) * 0.7 + getFreshnessScore(c.updatedAt, now) * 0.3,
      }))
      .sort((a, b) => (b._score || 0) - (a._score || 0))
      .slice(0, MAX_CONCEPTS)
      .map(({ _score, ...c }) => c);
  }

  // 2. 限制主题数量
  if (topicProjections.length > MAX_TOPICS) {
    topicProjections = topicProjections
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_TOPICS);
  }

  // 3. 限制课程数量
  const courseEpisodes = episodicProjections.filter(e => e.kind === 'course');
  if (courseEpisodes.length > MAX_COURSES) {
    const keptCourses = courseEpisodes
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_COURSES);
    const keptCourseIds = new Set(keptCourses.map(c => c.courseId));
    episodicProjections = episodicProjections.filter(
      e => e.kind !== 'course' || keptCourseIds.has(e.courseId)
    );
  }

  // 4. 限制事件数量
  if (events.length > MAX_EVENTS) {
    events = events
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .slice(0, MAX_EVENTS);
  }

  return {
    ...memoryStore,
    projections: { ...memoryStore.projections, conceptProjections, topicProjections, episodicProjections },
    events,
  };
}

// ============ 智能检索 ============

/** 获取 Top-K 相关概念 */
function getTopKConcepts(
  topic: string,
  conceptProjections: ConceptProjection[],
  k: number,
  now: number = Date.now()
): Array<{ concept: string; status: 'unknown' | 'learning' | 'fragile' | 'mastered'; masteryScore: number; misconceptionHints: string[] }> {
  return conceptProjections
    .filter(c => getTopicRelevanceScore(topic, c.topic) >= 0.45)
    .map(concept => {
      const relevance = getTopicRelevanceScore(topic, concept.conceptName);
      const decayedMastery = applyForgettingCurve(concept.masteryScore, concept.updatedAt, now);
      const freshness = getFreshnessScore(concept.updatedAt, now);
      
      return {
        concept: concept.conceptName,
        status: concept.status as 'unknown' | 'learning' | 'fragile' | 'mastered',
        masteryScore: decayedMastery,
        misconceptionHints: concept.misconceptionHints,
        _score: relevance * 0.5 + decayedMastery * 0.3 + freshness * 0.2,
      };
    })
    .filter(c => c._score >= 0.2)
    .sort((a, b) => b._score - a._score)
    .slice(0, k)
    .map(({ _score, ...c }) => c);
}

/** 获取最近课程 */
function getRecentCourses(
  topic: string,
  episodicProjections: MemoryStoreV3['projections']['episodicProjections'],
  k: number,
  now: number = Date.now()
) {
  return episodicProjections
    .filter(e => e.kind === 'course')
    .map(course => ({
      ...course,
      _score: getTopicRelevanceScore(topic, course.topic) * 0.6 + getFreshnessScore(course.updatedAt, now) * 0.4,
    }))
    .filter(c => c._score >= 0.3)
    .sort((a, b) => b._score - a._score)
    .slice(0, k)
    .map(({ _score, summary, ...c }) => ({
      topic: c.topic,
      summary: summary.includes('最近完成了') ? undefined : summary,
    }))
    .filter(c => c.summary !== undefined) as Array<{ topic: string; summary: string }>;
}

/** 获取背景知识提示 */
function getBackgroundHints(
  query: string,
  memoryStore: MemoryStoreV3,
  k: number = 3
): string[] {
  const stableFacts = memoryStore.profile.stableFacts || [];
  
  const facts = stableFacts
    .filter(fact => fact.kind === 'analogy_experience' || fact.kind === 'knowledge_background')
    .map(fact => fact.text);

  if (facts.length === 0) return [];

  return facts
    .map(fact => ({
      fact,
      score: getTopicRelevanceScore(query, fact),
    }))
    .filter(f => f.score >= 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(f => f.fact);
}

/** 过滤有效概念 */
function filterValidConcepts(concepts: string[]): string[] {
  return concepts.filter(c => c.length >= 2 && !/[，。！？、：；""''（）【】《》]/.test(c));
}

// ============ Memory Agent 决策层 ============

/** Planning 场景：课程纲要生成 */
export function getPlanningMemoryPayload(
  topic: string,
  userMemory?: UserMemory | MemoryStoreV2 | MemoryStoreV3 | null
): PlanningMemoryPayload {
  const now = Date.now();
  
  // 兼容 V2：自动迁移到 V3
  let memoryV3: MemoryStoreV3;
  if (!userMemory) {
    return {
      learnerSnapshot: { estimatedLevel: 'novice', confidence: 0.35 },
      transferableBackground: [],
      mustCoverConcepts: [],
      skippableBasics: [],
      riskConcepts: [],
      recentRelevantCourses: [],
    };
  } else if ('projections' in userMemory) {
    memoryV3 = userMemory;
  } else {
    memoryV3 = migrateMemoryToV3(userMemory);
  }

  let memoryStore = cleanupOldConcepts(memoryV3, now);
  memoryStore = enforceDataLimits(memoryStore, now);

  const topicProjection = memoryStore.projections.topicProjections
    .map(item => ({
      item,
      score: getTopicRelevanceScore(topic, item.topic) * item.confidence * getFreshnessScore(item.updatedAt, now),
    }))
    .filter(entry => entry.score >= 0.2)
    .sort((a, b) => b.score - a.score)[0]?.item;

  const recentRelevantCourses = getRecentCourses(topic, memoryStore.projections.episodicProjections, 3, now);

  // 从 topicProjection 中提取概念名称
  const mustCoverConceptNames = topicProjection?.mustCoverConceptIds
    .map(id => memoryStore.projections.conceptProjections.find(c => c.conceptId === id)?.conceptName)
    .filter((name): name is string => !!name) || [];
  
  const skippableConceptNames = topicProjection?.skippableConceptIds
    .map(id => memoryStore.projections.conceptProjections.find(c => c.conceptId === id)?.conceptName)
    .filter((name): name is string => !!name) || [];
  
  const riskConceptNames = topicProjection?.riskConceptIds
    .map(id => memoryStore.projections.conceptProjections.find(c => c.conceptId === id)?.conceptName)
    .filter((name): name is string => !!name) || [];

  return {
    learnerSnapshot: {
      targetGoal: memoryStore.profile.goals[0]?.goalText,
      estimatedLevel: topicProjection?.estimatedLevel || 'novice',
      confidence: topicProjection?.confidence || 0.35,
    },
    transferableBackground: getBackgroundHints(topic, memoryStore, 3),
    mustCoverConcepts: filterValidConcepts(mustCoverConceptNames.slice(0, 3)),
    skippableBasics: filterValidConcepts(skippableConceptNames.slice(0, 2)),
    riskConcepts: filterValidConcepts(riskConceptNames.slice(0, 3)),
    recentRelevantCourses,
  };
}

/** Teaching 场景：节点内容生成 */
export function getTeachingMemoryPayload(input: {
  topic: string;
  nodeTitle: string;
  nodeConcepts: string[];
  prerequisiteConcepts?: string[];
  blueprints?: CourseBlueprint[]; // 新增：用于构建图谱
  userMemory?: UserMemory | MemoryStoreV2 | MemoryStoreV3 | null;
}): TeachingMemoryPayload {
  const { topic, nodeTitle, nodeConcepts, prerequisiteConcepts = [], blueprints = [], userMemory } = input;
  const now = Date.now();
  
  // 兼容 V2：自动迁移到 V3
  let memoryV3: MemoryStoreV3;
  if (!userMemory) {
    return {
      nodeTopic: topic,
      nodeTitle,
      prerequisiteConceptStates: [],
      targetConceptStates: [],
      recentQuestionSummaries: [],
      analogyHints: [],
      preferredExplanationStyles: [],
    };
  } else if ('projections' in userMemory) {
    memoryV3 = userMemory;
  } else {
    memoryV3 = migrateMemoryToV3(userMemory);
  }

  let memoryStore = cleanupOldConcepts(memoryV3, now);
  memoryStore = enforceDataLimits(memoryStore, now);

  const topicConcepts = getTopKConcepts(topic, memoryStore.projections.conceptProjections, 20, now);
  
  const normalizedNodeConcepts = nodeConcepts.map(normalizeConceptKey);
  const normalizedPrerequisiteConcepts = prerequisiteConcepts.map(normalizeConceptKey);

  // 使用图谱查询额外的前置概念
  let allPrerequisites = [...normalizedPrerequisiteConcepts];
  if (blueprints.length > 0) {
    const graph = getConceptGraph(blueprints);
    const graphPrerequisites = getPrerequisites(normalizedNodeConcepts, graph, 2);
    allPrerequisites = [...new Set([...allPrerequisites, ...graphPrerequisites])];
  }

  const targetConceptStates = normalizedNodeConcepts
    .map(concept => {
      const matched = topicConcepts
        .filter(item => getTopicRelevanceScore(concept, item.concept) >= 0.55)
        .sort((a, b) => a.masteryScore - b.masteryScore)[0];

      return matched
        ? {
            concept: matched.concept,
            status: matched.status,
            masteryScore: matched.masteryScore,
            misconceptionHints: matched.misconceptionHints.slice(0, 2),
          }
        : {
            concept,
            status: 'unknown' as const,
            masteryScore: 0,
            misconceptionHints: [],
          };
    })
    .slice(0, 3);

  const prerequisiteConceptStates = allPrerequisites
    .map(concept => {
      const matched = topicConcepts
        .filter(item => getTopicRelevanceScore(concept, item.concept) >= 0.55)
        .sort((a, b) => b.masteryScore - a.masteryScore)[0];

      return matched
        ? {
            concept: matched.concept,
            status: matched.status,
            masteryScore: matched.masteryScore,
          }
        : {
            concept,
            status: 'unknown' as const,
            masteryScore: 0,
          };
    })
    .filter(p => p.masteryScore < 0.6) // 只返回薄弱的前置
    .slice(0, 3);

  // 从事件中提取最近的问题
  const recentQuestionSummaries = memoryStore.events
    .filter(e => e.type === 'chat_user_message' && e.topic === topic)
    .map(e => e.payload.question as string)
    .filter(q => !!q)
    .slice(0, 3);

  return {
    nodeTopic: topic,
    nodeTitle,
    prerequisiteConceptStates,
    targetConceptStates,
    recentQuestionSummaries,
    analogyHints: getBackgroundHints(`${topic} ${nodeTitle}`, memoryStore, 3),
    preferredExplanationStyles: [],
  };
}

/** Chat 场景：聊天辅助 */
export function getChatMemoryPayload(input: {
  topic: string;
  currentNodeTitle?: string;
  currentQuestion?: string;
  userMemory?: UserMemory | MemoryStoreV2 | MemoryStoreV3 | null;
}): ChatMemoryPayload {
  const { topic, currentNodeTitle = '', currentQuestion = '', userMemory } = input;
  const now = Date.now();
  
  // 兼容 V2：自动迁移到 V3
  let memoryV3: MemoryStoreV3;
  if (!userMemory) {
    return {
      topic,
      focusConceptStates: [],
      riskConcepts: [],
      recentQuestionSummaries: [],
      analogyHints: [],
      preferredExplanationStyles: [],
    };
  } else if ('projections' in userMemory) {
    memoryV3 = userMemory;
  } else {
    memoryV3 = migrateMemoryToV3(userMemory);
  }

  let memoryStore = cleanupOldConcepts(memoryV3, now);
  memoryStore = enforceDataLimits(memoryStore, now);

  const focusSource = currentNodeTitle || currentQuestion || topic;

  const topicProjection = memoryStore.projections.topicProjections
    .map(item => ({
      item,
      score:
        Math.max(getTopicRelevanceScore(topic, item.topic), getTopicRelevanceScore(focusSource, item.topic)) *
        item.confidence *
        getFreshnessScore(item.updatedAt, now),
    }))
    .filter(entry => entry.score >= 0.2)
    .sort((a, b) => b.score - a.score)[0]?.item;

  const focusConceptStates = getTopKConcepts(focusSource, memoryStore.projections.conceptProjections, 3, now).map(
    item => ({
      concept: item.concept,
      status: item.status,
      masteryScore: item.masteryScore,
      misconceptionHints: item.misconceptionHints.slice(0, 2),
    })
  );

  const recentQuestionSummaries = memoryStore.events
    .filter(e => e.type === 'chat_user_message' && e.topic === topic)
    .map(e => e.payload.question as string)
    .filter(q => !!q)
    .slice(0, 3);

  const riskConceptNames = topicProjection?.riskConceptIds
    .map(id => memoryStore.projections.conceptProjections.find(c => c.conceptId === id)?.conceptName)
    .filter((name): name is string => !!name)
    .slice(0, 3) || focusConceptStates.map(item => item.concept);

  return {
    topic,
    focusConceptStates,
    riskConcepts: riskConceptNames,
    recentQuestionSummaries,
    analogyHints: getBackgroundHints(`${topic} ${focusSource}`, memoryStore, 3),
    preferredExplanationStyles: [],
  };
}
