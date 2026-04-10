import type {
  EpisodicProjection,
  MemoryEvent,
  MemoryStoreV3,
  TopicState,
  UserProfile,
} from '@/types/course';
import { CHAT_CONCEPT_ALIASES } from '@/lib/memory/aliases';

export { CHAT_CONCEPT_ALIASES };

const MAX_V3_HOT_EVENTS = 180;
const MAX_V3_IMPORTANT_EVENTS = 40;

export type QuestionAttemptPayload = {
  courseId: string;
  topic: string;
  concept: string;
  question: string;
  isCorrect: boolean;
  difficulty?: 1 | 2 | 3;
  dimension?: 'memory' | 'understanding' | 'application' | 'analysis';
};

export type ChatMemoryAnalysisResult = {
  shouldAddKnowledgeGap: boolean;
  extractedConcept: string | null;
  confidence: number;
};

export type ChatSignalInput = {
  topic: string;
  question: string;
  confusionConcept?: string | null;
  confusionEvidence?: string;
  confidence?: number;
  courseId?: string;
};

export type DetectedLearningPreference = {
  kind: 'analogy_style' | 'explanation_style';
  value: string;
  confidence: number;
  evidence: string;
  updatedAt: number;
};

export type DetectedMasteredConcept = {
  topic: string;
  concept: string;
  evidence: string;
  confidence: number;
  updatedAt: number;
};

const CONFUSION_SIGNALS = [
  '没懂',
  '不懂',
  '还是不明白',
  '还是没明白',
  '有点懵',
  '看不懂',
  '卡住了',
  '总是分不清',
  '老是混淆',
  '答错',
  '又错了',
  '讲清楚',
  '再解释',
  '再举个例子',
];

const EXPLANATION_STYLE_PATTERNS = [
  { matcher: /(一步一步|分步骤|步骤讲|逐步|第一步|第二步)/, value: '分步拆解', confidence: 0.74 },
  { matcher: /(举个例子|给个例子|例如|比如)/, value: '例子驱动', confidence: 0.72 },
  { matcher: /(类比|打比方)/, value: '类比解释', confidence: 0.72 },
  { matcher: /(简单点|通俗点|白话)/, value: '通俗解释', confidence: 0.68 },
  { matcher: /(区别|对比|放在一起比较)/, value: '对比讲解', confidence: 0.7 },
];

// ============ 概念规范化 ============

function normalizeConceptText(raw: string): string {
  return raw
    .replace(/^(关于|就是|这个|这里的|一下|请问)/, '')
    .replace(/(能再举个例子吗|可以再解释下吗|怎么理解|是什么意思|是什么|为什么|吗|呢|呀|啊)$/g, '')
    .replace(/[，。！？?？]+$/g, '')
    .trim();
}

function normalizeAliasToken(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, '').replace(/workflow/g, '工作流');
}

const aliasEntries = Object.entries(CHAT_CONCEPT_ALIASES).flatMap(([canonical, aliases]) => [
  [normalizeAliasToken(canonical), canonical] as const,
  ...aliases.map((alias) => [normalizeAliasToken(alias), canonical] as const),
]);

const aliasMap = new Map<string, string>(aliasEntries);

export function normalizeConceptKey(raw: string): string {
  const normalizedConcept = normalizeConceptText(raw);
  const aliasHit = aliasMap.get(normalizeAliasToken(normalizedConcept));
  if (aliasHit) {
    return aliasHit;
  }

  return normalizedConcept;
}

// ============ 聊天分析函数 ============

export function analyzeChatMessageForMemory(text: string): ChatMemoryAnalysisResult {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return { shouldAddKnowledgeGap: false, extractedConcept: null, confidence: 0 };
  }

  const hasConfusionSignal = CONFUSION_SIGNALS.some((signal) => normalizedText.includes(signal));
  if (!hasConfusionSignal) {
    return { shouldAddKnowledgeGap: false, extractedConcept: null, confidence: 0 };
  }

  const repeatedConfusionCount = CONFUSION_SIGNALS.filter((signal) => normalizedText.includes(signal)).length;
  const confidence = Math.min(0.9, 0.55 + repeatedConfusionCount * 0.07);

  const explicitConceptPatterns = [
    /没懂(.{2,30}?的区别)/,
    /不明白(.{2,30}?的区别)/,
    /没懂(.{2,30}?)(?:区别|怎么理解|是什么意思|是什么|为什么|，|。|？|\?|$)/,
    /不明白(.{2,30}?)(?:区别|怎么理解|是什么意思|是什么|为什么|，|。|？|\?|$)/,
    /分不清(.{2,30}?)(?:和.+?的区别|，|。|？|\?|$)/,
    /(.{2,30}?的区别)/,
    /关于(.{2,30}?)(?:这块|这里|这个点|，|。|？|\?|$)/,
  ];

  for (const pattern of explicitConceptPatterns) {
    const match = normalizedText.match(pattern);
    const rawConcept = match?.[1] || match?.[0];
    if (rawConcept) {
      const concept = normalizeConceptText(rawConcept);
      if (concept.length >= 2) {
        return {
          shouldAddKnowledgeGap: true,
          extractedConcept: concept,
          confidence,
        };
      }
    }
  }

  return {
    shouldAddKnowledgeGap: true,
    extractedConcept: normalizeConceptText(normalizedText.slice(0, 20)) || null,
    confidence: Math.max(0.5, confidence - 0.08),
  };
}

export function detectChatLearningPreferences(text: string): DetectedLearningPreference[] {
  const normalizedText = text.trim();
  if (!normalizedText) return [];

  return EXPLANATION_STYLE_PATTERNS
    .filter((item) => item.matcher.test(normalizedText))
    .map((item) => ({
      kind: item.value === '类比解释' ? 'analogy_style' as const : 'explanation_style' as const,
      value: item.value,
      confidence: item.confidence,
      evidence: summarizeEvidence(normalizedText),
      updatedAt: Date.now(),
    }));
}

export function detectAssistantExplanationStyle(text: string): string | undefined {
  const normalizedText = text.trim();
  if (!normalizedText) return undefined;

  return EXPLANATION_STYLE_PATTERNS
    .map((item) => ({ value: item.value, matched: item.matcher.test(normalizedText) }))
    .find((item) => item.matched)?.value;
}

export function detectExplicitMasteredConcept(text: string): DetectedMasteredConcept | null {
  const normalizedText = text.trim();
  if (!normalizedText) return null;

  const patterns = [
    /(.{2,20}?)(?:我已经明白了|我明白了|我懂了|已经会了|已经理解了)/,
    /(?:关于|对于)?(.{2,20}?)(?:已经懂了|已经会了|已经明白了)/,
  ];

  for (const pattern of patterns) {
    const match = normalizedText.match(pattern);
    const rawConcept = match?.[1];
    if (!rawConcept) continue;
    const concept = normalizeConceptKey(rawConcept);
    if (concept.length < 2) continue;
    return {
      topic: '',
      concept,
      evidence: summarizeEvidence(normalizedText),
      confidence: 0.68,
      updatedAt: Date.now(),
    };
  }

  return null;
}

// ============ V3 MemoryStore 函数 ============

function createEmptyProfile(profile?: UserProfile | null): UserProfile {
  return {
    name: profile?.name,
    targetJob: profile?.targetJob || '',
    workExperience: profile?.workExperience || [],
    education: profile?.education || [],
    insights: profile?.insights,
  };
}

function createMemoryId(prefix: string, ...parts: Array<string | number | undefined>): string {
  return [prefix, ...parts].filter((part) => part !== undefined && part !== '').join(':').replace(/\s+/g, '-');
}

function summarizeEvidence(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 36);
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

function inferLevel(score: number): TopicState['estimatedLevel'] {
  if (score >= 0.82) return 'advanced';
  if (score >= 0.62) return 'intermediate';
  if (score >= 0.38) return 'beginner';
  return 'novice';
}

function buildStableFacts(profile: UserProfile) {
  const now = Date.now();
  const facts = [];

  if (profile.name?.trim()) {
    facts.push({
      id: createMemoryId('fact', 'identity', profile.name.trim()),
      kind: 'identity' as const,
      text: `用户姓名：${profile.name.trim()}`,
      confidence: 0.95,
      source: 'profile' as const,
      updatedAt: now,
    });
  }

  if (profile.targetJob?.trim()) {
    facts.push({
      id: createMemoryId('fact', 'goal', profile.targetJob.trim()),
      kind: 'goal' as const,
      text: `目标岗位：${profile.targetJob.trim()}`,
      confidence: 0.95,
      source: 'profile' as const,
      updatedAt: now,
    });
  }

  for (const item of profile.insights?.workSummary || []) {
    facts.push({
      id: createMemoryId('fact', 'knowledge', item),
      kind: 'knowledge_background' as const,
      text: item,
      confidence: 0.82,
      source: 'profile' as const,
      updatedAt: now,
    });
  }

  for (const item of profile.insights?.educationSummary || []) {
    facts.push({
      id: createMemoryId('fact', 'education', item),
      kind: 'knowledge_background' as const,
      text: item,
      confidence: 0.8,
      source: 'profile' as const,
      updatedAt: now,
    });
  }

  for (const item of profile.insights?.analogyExperiences || []) {
    facts.push({
      id: createMemoryId('fact', 'analogy', item),
      kind: 'analogy_experience' as const,
      text: item,
      confidence: 0.8,
      source: 'profile' as const,
      updatedAt: now,
    });
  }

  return facts;
}

function buildGoals(profile: UserProfile) {
  if (!profile.targetJob?.trim()) return [];
  return [{
    id: createMemoryId('goal', profile.targetJob.trim()),
    topic: profile.targetJob.trim(),
    goalText: `希望课程服务于${profile.targetJob.trim()}相关成长`,
    priority: 'high' as const,
    source: 'profile' as const,
    confidence: 0.92,
    updatedAt: Date.now(),
  }];
}

export function createEmptyMemoryStoreV3(profile?: UserProfile | null): MemoryStoreV3 {
  const normalizedProfile = createEmptyProfile(profile);

  return {
    version: 3,
    learnerId: 'local-user',
    profile: {
      stableFacts: buildStableFacts(normalizedProfile),
      goals: buildGoals(normalizedProfile),
      preferences: [],
    },
    events: [],
    projections: {
      conceptProjections: [],
      topicProjections: [],
      episodicProjections: [],
    },
    updatedAt: Date.now(),
  };
}

function getEventPayloadValue<T>(payload: Record<string, unknown>, key: string, fallback: T): T {
  if (!(key in payload)) return fallback;
  return payload[key] as T;
}

function compactMemoryEvents(events: MemoryEvent[]): MemoryEvent[] {
  const importantTypes = new Set<MemoryEvent['type']>(['course_generated', 'chat_session_summarized']);
  const important = events.filter((event) => importantTypes.has(event.type)).slice(0, MAX_V3_IMPORTANT_EVENTS);
  const hot = events.filter((event) => !importantTypes.has(event.type)).slice(0, MAX_V3_HOT_EVENTS);
  return [...important, ...hot].sort((a, b) => b.occurredAt - a.occurredAt);
}

function determineProjectionStatus(masteryScore: number, recentErrors: number): 'unknown' | 'learning' | 'fragile' | 'mastered' {
  if (masteryScore >= 0.78 && recentErrors === 0) return 'mastered';
  if (masteryScore >= 0.6) return 'fragile';
  if (masteryScore > 0 || recentErrors > 0) return 'learning';
  return 'unknown';
}

/** 验证 conceptId 是否有效 */
function isValidConceptId(conceptId: string): boolean {
  if (!conceptId || conceptId.length < 2) return false;
  // 过滤标点符号
  if (/[，。！？、：；""''（）【】《》\[\]{}]/.test(conceptId)) return false;
  // 过滤纯数字
  if (/^\d+$/.test(conceptId)) return false;
  // 过滤常见垃圾词
  const junkWords = ['以下', '请将', '在企业级', '场景中', '如下', '示例'];
  if (junkWords.some(word => conceptId.includes(word))) return false;
  return true;
}

function upsertConceptProjection(
  memoryStore: MemoryStoreV3,
  topic: string,
  conceptId: string,
  conceptName: string,
  updater: (current: MemoryStoreV3['projections']['conceptProjections'][number]) => void,
  occurredAt: number,
): void {
  // 验证 conceptId
  if (!isValidConceptId(conceptId)) {
    console.warn(`[Memory] Invalid conceptId filtered: "${conceptId}"`);
    return;
  }

  const list = memoryStore.projections.conceptProjections;
  const existing = list.find((item) => item.topic === topic && item.conceptId === conceptId);
  const base = existing || {
    topic,
    conceptId,
    conceptName,
    masteryScore: 0,
    status: 'unknown' as const,
    recentErrors: 0,
    recentSuccesses: 0,
    misconceptionHints: [],
    confidence: 0.4,
    updatedAt: occurredAt,
  };

  updater(base);
  base.conceptName = conceptName || base.conceptName;
  base.updatedAt = Math.max(base.updatedAt, occurredAt);
  base.lastSeenAt = occurredAt;
  base.status = determineProjectionStatus(base.masteryScore, base.recentErrors);

  if (!existing) {
    list.unshift(base);
  }
}

function recomputeTopicProjection(memoryStore: MemoryStoreV3, topic: string, occurredAt: number): void {
  const conceptProjections = memoryStore.projections.conceptProjections.filter((item) => item.topic === topic);
  const familiarityBase = conceptProjections.length
    ? conceptProjections.reduce((sum, item) => sum + item.masteryScore, 0) / conceptProjections.length
    : 0;
  const current = memoryStore.projections.topicProjections.find((item) => item.topic === topic);
  const next = current || {
    topic,
    familiarityScore: 0,
    estimatedLevel: 'novice' as const,
    mustCoverConceptIds: [],
    skippableConceptIds: [],
    riskConceptIds: [],
    confidence: 0.4,
    updatedAt: occurredAt,
  };

  next.familiarityScore = Number(Math.min(0.95, familiarityBase).toFixed(2));
  next.estimatedLevel = inferLevel(next.familiarityScore);
  next.mustCoverConceptIds = uniqueStrings(
    conceptProjections
      .filter((item) => item.status === 'learning' || item.status === 'fragile')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((item) => item.conceptId),
  ).slice(0, 4);
  next.skippableConceptIds = uniqueStrings(
    conceptProjections
      .filter((item) => item.status === 'mastered')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((item) => item.conceptId),
  ).slice(0, 3);
  next.riskConceptIds = uniqueStrings(
    conceptProjections
      .filter((item) => item.recentErrors > 0 || item.misconceptionHints.length > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((item) => item.conceptId),
  ).slice(0, 4);
  next.confidence = Number(Math.min(0.92, 0.45 + conceptProjections.length * 0.08).toFixed(2));
  next.updatedAt = Math.max(next.updatedAt, occurredAt);

  if (!current) {
    memoryStore.projections.topicProjections.unshift(next);
  }
}

function upsertEpisodicProjection(memoryStore: MemoryStoreV3, projection: EpisodicProjection): void {
  const list = memoryStore.projections.episodicProjections;
  const existingIndex = list.findIndex((item) => item.id === projection.id);
  if (existingIndex >= 0) {
    list[existingIndex] = projection;
    return;
  }
  list.unshift(projection);
}

export function appendEventToMemoryStoreV3(memoryStore: MemoryStoreV3, event: MemoryEvent): MemoryStoreV3 {
  const next: MemoryStoreV3 = {
    ...memoryStore,
    events: compactMemoryEvents([event, ...memoryStore.events]),
    profile: {
      ...memoryStore.profile,
      preferences: [...memoryStore.profile.preferences],
    },
    projections: {
      conceptProjections: memoryStore.projections.conceptProjections.map((item) => ({ ...item, misconceptionHints: [...item.misconceptionHints] })),
      topicProjections: memoryStore.projections.topicProjections.map((item) => ({ ...item, mustCoverConceptIds: [...item.mustCoverConceptIds], skippableConceptIds: [...item.skippableConceptIds], riskConceptIds: [...item.riskConceptIds] })),
      episodicProjections: memoryStore.projections.episodicProjections.map((item) => ({ ...item, conceptIds: [...item.conceptIds], explanationStyles: [...item.explanationStyles] })),
    },
    updatedAt: Math.max(memoryStore.updatedAt, event.occurredAt),
  };

  if (event.type === 'question_answered') {
    const conceptId = String(getEventPayloadValue(event.payload, 'conceptId', getEventPayloadValue(event.payload, 'conceptName', 'concept-unknown')));
    const conceptName = String(getEventPayloadValue(event.payload, 'conceptName', conceptId));
    const isCorrect = Boolean(getEventPayloadValue(event.payload, 'isCorrect', false));
    upsertConceptProjection(next, event.topic, conceptId, conceptName, (current) => {
      current.masteryScore = Number(Math.max(0, Math.min(1, current.masteryScore + (isCorrect ? 0.18 : -0.22))).toFixed(2));
      current.confidence = Number(Math.min(0.96, current.confidence + 0.08).toFixed(2));
      if (isCorrect) {
        current.recentSuccesses += 1;
      } else {
        current.recentErrors += 1;
        const question = getEventPayloadValue(event.payload, 'question', '');
        if (question) {
          current.misconceptionHints = uniqueStrings([...current.misconceptionHints, summarizeEvidence(String(question))]).slice(0, 3);
        }
      }
      current.nextReviewAt = event.occurredAt + (isCorrect ? 7 : 2) * 24 * 60 * 60 * 1000;
    }, event.occurredAt);
    recomputeTopicProjection(next, event.topic, event.occurredAt);
  }

  if (event.type === 'chat_user_message') {
    const explanationStyles = getEventPayloadValue<string[]>(event.payload, 'explanationStyles', []);
    for (const style of explanationStyles) {
      const existing = next.profile.preferences.find((item) => item.kind === 'explanation_style' && item.value === style);
      if (existing) {
        existing.confidence = Number(Math.min(0.95, existing.confidence + 0.05).toFixed(2));
        existing.updatedAt = event.occurredAt;
      } else {
        next.profile.preferences.unshift({
          id: createMemoryId('preference', 'explanation_style', style),
          kind: 'explanation_style',
          value: style,
          confidence: 0.72,
          source: 'chat',
          updatedAt: event.occurredAt,
        });
      }
    }

    const confusionConceptId = getEventPayloadValue<string | undefined>(event.payload, 'confusionConceptId', undefined);
    if (confusionConceptId) {
      const confusionConceptName = String(getEventPayloadValue(event.payload, 'confusionConceptName', confusionConceptId));
      const question = String(getEventPayloadValue(event.payload, 'question', ''));
      upsertConceptProjection(next, event.topic, confusionConceptId, confusionConceptName, (current) => {
        current.masteryScore = Number(Math.min(current.masteryScore || 0.4, 0.4).toFixed(2));
        current.recentErrors += 1;
        current.confidence = Number(Math.min(0.9, current.confidence + 0.06).toFixed(2));
        if (question) {
          current.misconceptionHints = uniqueStrings([...current.misconceptionHints, summarizeEvidence(question)]).slice(0, 3);
        }
      }, event.occurredAt);
      recomputeTopicProjection(next, event.topic, event.occurredAt);
    }
  }

  if (event.type === 'node_completed') {
    const teachConceptIds = getEventPayloadValue<string[]>(event.payload, 'teachConceptIds', []);
    const teachConceptNames = getEventPayloadValue<string[]>(event.payload, 'teachConceptNames', []);
    const nodeTitle = getEventPayloadValue<string>(event.payload, 'nodeTitle', '');
    const teachingGoal = getEventPayloadValue<string>(event.payload, 'teachingGoal', '');

    teachConceptIds.forEach((conceptId, index) => {
      upsertConceptProjection(next, event.topic, conceptId, teachConceptNames[index] || conceptId, (current) => {
        current.masteryScore = Number(Math.max(current.masteryScore, 0.62).toFixed(2));
        current.recentSuccesses += 1;
        current.confidence = Number(Math.min(0.92, current.confidence + 0.04).toFixed(2));
      }, event.occurredAt);
    });
    recomputeTopicProjection(next, event.topic, event.occurredAt);
    if (event.courseId) {
      // 使用有意义的 summary
      const summary = nodeTitle && teachingGoal
        ? `完成了「${nodeTitle}」：${teachingGoal}`
        : `完成了 ${event.topic} 的第 ${typeof event.nodeIndex === 'number' ? event.nodeIndex + 1 : '?'} 节`;

      upsertEpisodicProjection(next, {
        id: createMemoryId('episode', 'course', event.courseId),
        topic: event.topic,
        courseId: event.courseId,
        kind: 'course',
        summary,
        conceptIds: teachConceptIds,
        explanationStyles: [],
        updatedAt: event.occurredAt,
      });
    }
  }

  if (event.type === 'course_generated') {
    recomputeTopicProjection(next, event.topic, event.occurredAt);
    if (event.courseId) {
      upsertEpisodicProjection(next, {
        id: createMemoryId('episode', 'course', event.courseId),
        topic: event.topic,
        courseId: event.courseId,
        kind: 'course',
        summary: String(getEventPayloadValue(event.payload, 'goal', `刚生成了一门关于 ${event.topic} 的课程`)),
        conceptIds: getEventPayloadValue<string[]>(event.payload, 'conceptIds', []),
        explanationStyles: [],
        updatedAt: event.occurredAt,
      });
    }
  }

  if (event.type === 'chat_session_summarized') {
    upsertEpisodicProjection(next, {
      id: String(getEventPayloadValue(event.payload, 'id', createMemoryId('episode', event.courseId || event.topic, event.occurredAt))),
      topic: event.topic,
      courseId: event.courseId,
      kind: 'chat',
      summary: String(getEventPayloadValue(event.payload, 'summary', '')),
      conceptIds: getEventPayloadValue<string[]>(event.payload, 'conceptIds', []),
      explanationStyles: getEventPayloadValue<string[]>(event.payload, 'explanationStyles', []),
      followUp: getEventPayloadValue<string | undefined>(event.payload, 'followUp', undefined),
      updatedAt: event.occurredAt,
    });
  }

  return next;
}
