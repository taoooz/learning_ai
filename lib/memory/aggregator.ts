import type {
  ChatMemoryPayload,
  ConceptState,
  CourseSummary,
  EpisodicProjection,
  LearningSignal,
  MemoryEvent,
  MemoryStoreV3,
  MemoryStoreV2,
  PlanningMemoryPayload,
  TeachingMemoryPayload,
  TopicState,
  TopicSummary,
  UserMemory,
  UserProfile,
} from '@/types/course';
import { CHAT_CONCEPT_ALIASES } from '@/lib/memory/aliases';

export { CHAT_CONCEPT_ALIASES };

const INTEREST_DECAY_DAYS = 30;
const INTEREST_DECAY_FACTOR = 0.5;
const CHAT_SIGNAL_DECAY_DAYS = 21;
const CHAT_SIGNAL_DECAY_FACTOR = 0.78;
const MIN_CONFIDENCE = 0.2;
const DEFAULT_QUESTION_CONFIDENCE = 0.62;
const DEFAULT_CHAT_GAP_CONFIDENCE = 0.65;
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

export type ChatInsightPayload = {
  topic: string;
  concept: string;
  evidence: string;
  confidence: number;
};

export type TeachingPayloadInput = {
  topic: string;
  nodeTitle: string;
  nodeConcepts: string[];
  prerequisiteConcepts?: string[];
  userMemory?: UserMemory | MemoryStoreV2 | MemoryStoreV3 | null;
};

export type ChatPayloadInput = {
  topic: string;
  currentNodeTitle?: string;
  currentQuestion?: string;
  userMemory?: UserMemory | MemoryStoreV2 | MemoryStoreV3 | null;
};

export type ChatSignalInput = {
  topic: string;
  question: string;
  confusionConcept?: string | null;
  confusionEvidence?: string;
  confidence?: number;
  courseId?: string;
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

function createEmptyProfile(profile?: UserProfile | null): UserProfile {
  return {
    name: profile?.name,
    targetJob: profile?.targetJob || '',
    workExperience: profile?.workExperience || [],
    education: profile?.education || [],
    insights: profile?.insights,
  };
}

export function createDefaultUserMemory(profile?: UserProfile | null): UserMemory {
  return {
    profile: createEmptyProfile(profile),
    learningHistory: [],
    extractedInsights: {
      interests: [],
      knowledgeGaps: [],
      questionPatterns: [],
      conceptMastery: [],
      learningPreferences: [],
      masteredConcepts: [],
    },
    lastUpdated: Date.now(),
    version: 1,
    conversationSummaries: [],
  };
}

export function mergeProfileIntoMemory(memory: UserMemory, profile?: UserProfile | null): UserMemory {
  return {
    ...memory,
    profile: createEmptyProfile(profile || memory.profile),
    extractedInsights: {
      interests: memory.extractedInsights?.interests || [],
      knowledgeGaps: memory.extractedInsights?.knowledgeGaps || [],
      questionPatterns: memory.extractedInsights?.questionPatterns || [],
      conceptMastery: memory.extractedInsights?.conceptMastery || [],
      learningPreferences: memory.extractedInsights?.learningPreferences || [],
      masteredConcepts: memory.extractedInsights?.masteredConcepts || [],
    },
    conversationSummaries: memory.conversationSummaries || [],
  };
}

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

export function detectChatLearningPreferences(text: string): UserMemory['extractedInsights']['learningPreferences'] {
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

export function detectExplicitMasteredConcept(text: string): UserMemory['extractedInsights']['masteredConcepts'][number] | null {
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

function decayConfidence(value: number | undefined, factor: number): number | undefined {
  if (value === undefined) return value;
  return Math.max(MIN_CONFIDENCE, Number((value * factor).toFixed(2)));
}

function daysBetween(now: number, timestamp: number | undefined): number {
  if (!timestamp) return 0;
  return (now - timestamp) / (1000 * 60 * 60 * 24);
}

export function decayUserMemory(memory: UserMemory, now: number = Date.now()): UserMemory {
  for (const interest of memory.extractedInsights.interests) {
    const daysSinceInteraction = daysBetween(now, interest.lastInteraction);
    if (interest.source === 'chat' && daysSinceInteraction > INTEREST_DECAY_DAYS) {
      interest.weight = Math.max(1, Number((interest.weight * INTEREST_DECAY_FACTOR).toFixed(2)));
      interest.confidence = decayConfidence(interest.confidence, CHAT_SIGNAL_DECAY_FACTOR);
    }
  }

  for (const pattern of memory.extractedInsights.questionPatterns) {
    const ageInDays = daysBetween(now, pattern.timestamp);
    if (pattern.source === 'chat' && ageInDays > CHAT_SIGNAL_DECAY_DAYS) {
      pattern.confidence = decayConfidence(pattern.confidence, CHAT_SIGNAL_DECAY_FACTOR);
    }
  }

  for (const gap of memory.extractedInsights.knowledgeGaps) {
    const ageInDays = daysBetween(now, gap.lastUpdated);
    if (gap.source === 'chat' && ageInDays > CHAT_SIGNAL_DECAY_DAYS) {
      gap.confidence = decayConfidence(gap.confidence, CHAT_SIGNAL_DECAY_FACTOR);
      if ((gap.confidence || 0) <= 0.4 && gap.severity === 'medium') {
        gap.severity = 'low';
      }
    }
  }

  return memory;
}

export function recordChatInsightInMemory(memory: UserMemory, payload: ChatInsightPayload): UserMemory {
  const { topic, concept, evidence, confidence } = payload;
  const now = Date.now();
  const normalizedConcept = normalizeConceptKey(concept);
  const existing = memory.extractedInsights.knowledgeGaps.find(
    (gap) => gap.topic === topic && normalizeConceptKey(gap.concept) === normalizedConcept,
  );

  if (existing) {
    if (!existing.evidence.includes(evidence)) {
      existing.evidence.push(evidence);
    }
    existing.concept = normalizedConcept;
    existing.confidence = Math.max(existing.confidence || 0, Number(confidence.toFixed(2)));
    existing.lastUpdated = now;
    if (existing.source !== 'assessment') {
      existing.source = 'chat';
    }
    if (existing.severity === 'low' && existing.evidence.length >= 2 && (existing.confidence || 0) >= 0.75) {
      existing.severity = 'medium';
    }
  } else {
    memory.extractedInsights.knowledgeGaps.push({
      concept: normalizedConcept,
      topic,
      evidence: [evidence],
      severity: 'low',
      confidence: Number(confidence.toFixed(2)),
      source: 'chat',
      lastUpdated: now,
    });
  }

  return memory;
}

export function recordLearningPreferenceInMemory(
  memory: UserMemory,
  preference: UserMemory['extractedInsights']['learningPreferences'][number],
): UserMemory {
  const now = Date.now();
  const existing = memory.extractedInsights.learningPreferences.find(
    (item) => item.kind === preference.kind && item.value === preference.value,
  );

  if (existing) {
    existing.confidence = Math.max(existing.confidence, preference.confidence);
    existing.evidence = existing.evidence.includes(preference.evidence)
      ? existing.evidence
      : `${existing.evidence}；${preference.evidence}`.slice(0, 120);
    existing.updatedAt = now;
  } else {
    memory.extractedInsights.learningPreferences.push({
      ...preference,
      updatedAt: now,
    });
  }

  memory.extractedInsights.learningPreferences.sort((a, b) => b.updatedAt - a.updatedAt);
  memory.extractedInsights.learningPreferences = memory.extractedInsights.learningPreferences.slice(0, 12);
  return memory;
}

export function recordMasteredConceptInMemory(
  memory: UserMemory,
  mastered: UserMemory['extractedInsights']['masteredConcepts'][number],
): UserMemory {
  const now = Date.now();
  const normalizedConcept = normalizeConceptKey(mastered.concept);
  const existing = memory.extractedInsights.masteredConcepts.find(
    (item) => item.topic === mastered.topic && normalizeConceptKey(item.concept) === normalizedConcept,
  );

  if (existing) {
    existing.concept = normalizedConcept;
    existing.confidence = Math.max(existing.confidence, mastered.confidence);
    existing.evidence = mastered.evidence;
    existing.updatedAt = now;
  } else {
    memory.extractedInsights.masteredConcepts.push({
      ...mastered,
      concept: normalizedConcept,
      updatedAt: now,
    });
  }

  const mastery = memory.extractedInsights.conceptMastery.find(
    (item) => item.topic === mastered.topic && normalizeConceptKey(item.concept) === normalizedConcept,
  );
  if (!mastery) {
    memory.extractedInsights.conceptMastery.push({
      concept: normalizedConcept,
      topic: mastered.topic,
      totalAttempts: 1,
      correctAttempts: 1,
      accuracy: 0.75,
      lastReviewedAt: now,
      lastOutcome: 'correct',
      needsReview: false,
      confidence: Math.max(0.58, mastered.confidence),
      source: 'chat',
    });
  } else {
    mastery.concept = normalizedConcept;
    mastery.correctAttempts += 1;
    mastery.totalAttempts += 1;
    mastery.accuracy = Number((mastery.correctAttempts / mastery.totalAttempts).toFixed(2));
    mastery.lastReviewedAt = now;
    mastery.lastOutcome = 'correct';
    mastery.needsReview = mastery.accuracy < 0.7;
    mastery.confidence = Math.max(mastery.confidence || 0.4, Math.min(0.76, (mastery.confidence || 0.4) + 0.08));
  }

  return memory;
}

export function recordQuestionAttemptInMemory(memory: UserMemory, payload: QuestionAttemptPayload): UserMemory {
  const { topic, concept, question, isCorrect, difficulty, dimension } = payload;
  const now = Date.now();
  const normalizedConcept = normalizeConceptKey(concept);
  const masteryList = memory.extractedInsights.conceptMastery;
  const existingMastery = masteryList.find((item) => item.topic === topic && normalizeConceptKey(item.concept) === normalizedConcept);

  if (existingMastery) {
    existingMastery.concept = normalizedConcept;
    existingMastery.totalAttempts += 1;
    if (isCorrect) {
      existingMastery.correctAttempts += 1;
    }
    existingMastery.accuracy = existingMastery.correctAttempts / existingMastery.totalAttempts;
    existingMastery.lastReviewedAt = now;
    existingMastery.lastOutcome = isCorrect ? 'correct' : 'incorrect';
    existingMastery.needsReview = shouldKeepReviewFlag(
      existingMastery.totalAttempts,
      existingMastery.accuracy,
      isCorrect,
    );
    existingMastery.difficulty = difficulty ?? existingMastery.difficulty;
    existingMastery.dimension = dimension ?? existingMastery.dimension;
    existingMastery.confidence = getAssessmentConfidence(existingMastery.totalAttempts, existingMastery.accuracy);
    existingMastery.source = 'assessment';
  } else {
    const accuracy = isCorrect ? 1 : 0;
    masteryList.push({
      concept: normalizedConcept,
      topic,
      totalAttempts: 1,
      correctAttempts: isCorrect ? 1 : 0,
      accuracy,
      lastReviewedAt: now,
      lastOutcome: isCorrect ? 'correct' : 'incorrect',
      difficulty,
      dimension,
      needsReview: shouldKeepReviewFlag(1, accuracy, isCorrect),
      confidence: getAssessmentConfidence(1, accuracy),
      source: 'assessment',
    });
  }

  const gap = memory.extractedInsights.knowledgeGaps.find((item) => item.topic === topic && normalizeConceptKey(item.concept) === normalizedConcept);
  if (!isCorrect) {
    if (gap) {
      const previousSource = gap.source;
      if (!gap.evidence.includes(question)) {
        gap.evidence.push(question);
      }
      gap.concept = normalizedConcept;
      gap.severity = previousSource === 'chat'
        ? gap.evidence.length >= 3 ? 'medium' : 'low'
        : gap.evidence.length >= 3 ? 'high' : gap.evidence.length >= 2 ? 'medium' : 'low';
      gap.source = 'assessment';
      gap.confidence = getAssessmentGapConfidence(gap.evidence.length, previousSource);
      gap.lastUpdated = now;
    } else {
      memory.extractedInsights.knowledgeGaps.push({
        concept: normalizedConcept,
        topic,
        evidence: [question],
        severity: 'low',
        confidence: getAssessmentGapConfidence(1, 'assessment'),
        source: 'assessment',
        lastUpdated: now,
      });
    }
  } else if (gap) {
    if (gap.severity === 'high') {
      gap.severity = 'medium';
    } else if (gap.severity === 'medium') {
      gap.severity = 'low';
    }
    gap.concept = normalizedConcept;
    gap.source = 'assessment';
    gap.confidence = Number(Math.max(0.2, (gap.confidence || 0.5) - 0.18).toFixed(2));
    gap.lastUpdated = now;
  }

  return memory;
}

function createMemoryId(prefix: string, ...parts: Array<string | number | undefined>): string {
  return [prefix, ...parts].filter((part) => part !== undefined && part !== '').join(':').replace(/\s+/g, '-');
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ').trim();
}

function tokenizeTopic(value: string): string[] {
  const normalized = normalizeForMatch(value);
  const chunks = normalized.split(/\s+/).filter(Boolean);
  const chineseChunks = normalized.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  return Array.from(new Set([...chunks, ...chineseChunks]));
}

function getTopicRelevanceScore(topic: string, candidate: string): number {
  const topicTokens = tokenizeTopic(topic);
  const candidateText = normalizeForMatch(candidate);
  if (!topicTokens.length || !candidateText) return 0;

  let score = 0;
  for (const token of topicTokens) {
    if (candidateText.includes(token)) {
      score = Math.max(score, token.length >= 4 ? 1 : 0.75);
    }
  }

  const coarseMappings: Array<{ matcher: RegExp; tokens: string[] }> = [
    { matcher: /(agent|工具调用|工作流|规划|执行|mcp|记忆)/i, tokens: ['react', '埋点', '实验', '状态', '前端'] },
    { matcher: /(英语|口语|发音|语法|单词)/i, tokens: ['播客', '写作', '翻译'] },
  ];

  for (const mapping of coarseMappings) {
    if (mapping.matcher.test(topic) && mapping.tokens.some((token) => candidateText.includes(token))) {
      score = Math.max(score, 0.45);
    }
  }

  return score;
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

function summarizeEvidence(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 36);
}

function inferLevel(score: number): TopicState['estimatedLevel'] {
  if (score >= 0.82) return 'advanced';
  if (score >= 0.62) return 'intermediate';
  if (score >= 0.38) return 'beginner';
  return 'novice';
}

function determineConceptStatus(masteryScore: number, recentErrors: number, needsReview: boolean): ConceptState['status'] {
  if (masteryScore >= 0.8 && !needsReview) return 'mastered';
  if (masteryScore >= 0.55 && recentErrors <= 1) return 'fragile';
  if (masteryScore > 0) return 'learning';
  return 'unknown';
}

function getAssessmentConfidence(totalAttempts: number, accuracy: number): number {
  const evidenceFactor = Math.min(totalAttempts, 5) * 0.1;
  const consistencyBonus = accuracy === 0 || accuracy === 1 ? 0.04 : 0;
  return Number(Math.min(0.88, 0.42 + evidenceFactor + consistencyBonus).toFixed(2));
}

function shouldKeepReviewFlag(totalAttempts: number, accuracy: number, isCorrect: boolean): boolean {
  if (!isCorrect) return true;
  if (totalAttempts >= 3) return accuracy < 0.6;
  return accuracy < 0.75;
}

function getAssessmentGapConfidence(errorEvidenceCount: number, previousSource?: 'chat' | 'assessment'): number {
  const base = previousSource === 'chat' ? 0.46 : 0.5;
  return Number(Math.min(0.78, base + errorEvidenceCount * 0.12).toFixed(2));
}

export function isMemoryStoreV2(memory: UserMemory | MemoryStoreV2 | MemoryStoreV3 | null | undefined): memory is MemoryStoreV2 {
  return Boolean(memory && typeof memory === 'object' && 'signals' in memory && 'states' in memory && memory.version === 2);
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

  for (const item of profile.insights?.knowledgeBackground || []) {
    facts.push({
      id: createMemoryId('fact', 'knowledge', item),
      kind: 'knowledge_background' as const,
      text: item,
      confidence: 0.82,
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

export function isMemoryStoreV3(memory: UserMemory | MemoryStoreV2 | MemoryStoreV3 | null | undefined): memory is MemoryStoreV3 {
  if (!memory || typeof memory !== 'object') return false;
  return (memory as MemoryStoreV3).version === 3 && Array.isArray((memory as MemoryStoreV3).events) && !!(memory as MemoryStoreV3).projections;
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

function upsertConceptProjection(
  memoryStore: MemoryStoreV3,
  topic: string,
  conceptId: string,
  conceptName: string,
  updater: (current: MemoryStoreV3['projections']['conceptProjections'][number]) => void,
  occurredAt: number,
): void {
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
    teachConceptIds.forEach((conceptId, index) => {
      upsertConceptProjection(next, event.topic, conceptId, teachConceptNames[index] || conceptId, (current) => {
        current.masteryScore = Number(Math.max(current.masteryScore, 0.62).toFixed(2));
        current.recentSuccesses += 1;
        current.confidence = Number(Math.min(0.92, current.confidence + 0.04).toFixed(2));
      }, event.occurredAt);
    });
    recomputeTopicProjection(next, event.topic, event.occurredAt);
    if (event.courseId) {
      upsertEpisodicProjection(next, {
        id: createMemoryId('episode', 'course', event.courseId),
        topic: event.topic,
        courseId: event.courseId,
        kind: 'course',
        summary: `最近完成了 ${event.topic} 的第 ${typeof event.nodeIndex === 'number' ? event.nodeIndex + 1 : '?'} 节`,
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

function convertEventsFromV2(memoryStore: MemoryStoreV2): MemoryEvent[] {
  return memoryStore.signals.map((signal) => {
    if (signal.type === 'question_attempt') {
      return {
        type: 'question_answered' as const,
        topic: signal.topic,
        courseId: signal.courseId,
        occurredAt: signal.occurredAt,
        payload: {
          conceptId: signal.concept || 'concept-unknown',
          conceptName: signal.concept || '未知概念',
          isCorrect: Number(signal.payload.accuracy || 0) >= 0.7,
          question: String(signal.payload.question || ''),
        },
      };
    }

    if (signal.type === 'chat_question' || signal.type === 'chat_confusion' || signal.type === 'chat_mastery') {
      return {
        type: 'chat_user_message' as const,
        topic: signal.topic,
        courseId: signal.courseId,
        occurredAt: signal.occurredAt,
        payload: {
          question: String(signal.payload.question || signal.payload.evidence || ''),
          confusionConceptId: signal.type === 'chat_confusion' ? signal.concept : undefined,
          confusionConceptName: signal.type === 'chat_confusion' ? signal.concept : undefined,
        },
      };
    }

    return {
      type: 'node_completed' as const,
      topic: signal.topic,
      courseId: signal.courseId,
      occurredAt: signal.occurredAt,
      payload: {},
    };
  }).sort((a, b) => b.occurredAt - a.occurredAt);
}

function buildTopicSummariesFromV3(memoryStore: MemoryStoreV3): TopicSummary[] {
  return memoryStore.projections.topicProjections.map((item) => {
    const mustCover = item.mustCoverConceptIds
      .map((conceptId) => memoryStore.projections.conceptProjections.find((projection) => projection.topic === item.topic && projection.conceptId === conceptId)?.conceptName || conceptId);
    const strengths = item.skippableConceptIds
      .map((conceptId) => memoryStore.projections.conceptProjections.find((projection) => projection.topic === item.topic && projection.conceptId === conceptId)?.conceptName || conceptId);

    return {
      topic: item.topic,
      summary: mustCover.length ? `${item.topic} 当前最需要补的是 ${mustCover.join('、')}` : `${item.topic} 暂无明确薄弱点`,
      keyGaps: mustCover,
      keyStrengths: strengths,
      updatedAt: item.updatedAt,
    };
  });
}

function buildCourseSummariesFromV3(memoryStore: MemoryStoreV3): CourseSummary[] {
  return memoryStore.projections.episodicProjections
    .filter((item) => item.kind === 'course' && item.courseId)
    .map((item) => ({
      courseId: item.courseId as string,
      topic: item.topic,
      summary: item.summary,
      completedNodes: Number(getEventPayloadValue({ completedNodes: 0 }, 'completedNodes', 0)),
      totalNodes: Number(getEventPayloadValue({ totalNodes: 0 }, 'totalNodes', 0)),
      updatedAt: item.updatedAt,
    }));
}

function convertMemoryStoreV3ToV2(memoryStore: MemoryStoreV3): MemoryStoreV2 {
  const conceptStates: ConceptState[] = memoryStore.projections.conceptProjections.map((item) => ({
    topic: item.topic,
    concept: item.conceptName,
    masteryScore: item.masteryScore,
    status: item.status,
    evidenceCount: item.recentErrors + item.recentSuccesses,
    recentErrors: item.recentErrors,
    recentSuccesses: item.recentSuccesses,
    lastSeenAt: item.lastSeenAt,
    nextReviewAt: item.nextReviewAt,
    misconceptionHints: item.misconceptionHints,
    confidence: item.confidence,
    updatedAt: item.updatedAt,
  }));

  const topicStates: TopicState[] = memoryStore.projections.topicProjections.map((item) => ({
    topic: item.topic,
    familiarityScore: item.familiarityScore,
    estimatedLevel: item.estimatedLevel,
    transferableBackground: memoryStore.profile.stableFacts
      .filter((fact) => fact.kind === 'knowledge_background' || fact.kind === 'analogy_experience')
      .map((fact) => fact.text)
      .slice(0, 3),
    mustCoverConcepts: item.mustCoverConceptIds.map((conceptId) => memoryStore.projections.conceptProjections.find((projection) => projection.topic === item.topic && projection.conceptId === conceptId)?.conceptName || conceptId),
    skippableBasics: item.skippableConceptIds.map((conceptId) => memoryStore.projections.conceptProjections.find((projection) => projection.topic === item.topic && projection.conceptId === conceptId)?.conceptName || conceptId),
    riskConcepts: item.riskConceptIds.map((conceptId) => memoryStore.projections.conceptProjections.find((projection) => projection.topic === item.topic && projection.conceptId === conceptId)?.conceptName || conceptId),
    confidence: item.confidence,
    updatedAt: item.updatedAt,
  }));

  const signals: LearningSignal[] = memoryStore.events.flatMap((event) => {
    if (event.type === 'question_answered') {
      const isCorrect = Boolean(getEventPayloadValue(event.payload, 'isCorrect', false));
      return [{
        id: createMemoryId('signal', 'v3-question', event.topic, event.occurredAt),
        type: 'question_attempt' as const,
        topic: event.topic,
        concept: String(getEventPayloadValue(event.payload, 'conceptName', getEventPayloadValue(event.payload, 'conceptId', '未知概念'))),
        courseId: event.courseId,
        source: 'assessment' as const,
        confidence: 0.8,
        occurredAt: event.occurredAt,
        payload: {
          accuracy: isCorrect ? 1 : 0,
          question: String(getEventPayloadValue(event.payload, 'question', '')),
        },
      }];
    }

    if (event.type === 'chat_user_message') {
      const signals: LearningSignal[] = [{
        id: createMemoryId('signal', 'v3-chat-question', event.topic, event.occurredAt),
        type: 'chat_question',
        topic: event.topic,
        courseId: event.courseId,
        source: 'chat',
        confidence: DEFAULT_QUESTION_CONFIDENCE,
        occurredAt: event.occurredAt,
        payload: {
          question: String(getEventPayloadValue(event.payload, 'question', '')),
        },
      }];

      const confusionConceptName = getEventPayloadValue<string | undefined>(event.payload, 'confusionConceptName', undefined);
      if (confusionConceptName) {
        signals.push({
          id: createMemoryId('signal', 'v3-chat-confusion', event.topic, confusionConceptName, event.occurredAt),
          type: 'chat_confusion',
          topic: event.topic,
          concept: confusionConceptName,
          courseId: event.courseId,
          source: 'chat',
          confidence: DEFAULT_CHAT_GAP_CONFIDENCE,
          occurredAt: event.occurredAt,
          payload: {
            evidence: [String(getEventPayloadValue(event.payload, 'question', ''))],
          },
        });
      }
      return signals;
    }

    return [];
  });

  return {
    version: 2,
    learnerId: memoryStore.learnerId,
    profile: memoryStore.profile,
    signals,
    states: {
      topicStates,
      conceptStates,
    },
    summaries: {
      topicSummaries: buildTopicSummariesFromV3(memoryStore),
      courseSummaries: buildCourseSummariesFromV3(memoryStore),
    },
    updatedAt: memoryStore.updatedAt,
  };
}

export function migrateMemoryToV3(memory: UserMemory | MemoryStoreV2 | MemoryStoreV3 | null | undefined, profile?: UserProfile | null): MemoryStoreV3 {
  if (isMemoryStoreV3(memory)) {
    return memory;
  }

  const v2 = migrateUserMemoryToV2(memory as UserMemory | MemoryStoreV2 | null | undefined, profile);
  return {
    version: 3,
    learnerId: v2.learnerId,
    profile: v2.profile,
    events: compactMemoryEvents(convertEventsFromV2(v2)),
    projections: {
      conceptProjections: v2.states.conceptStates.map((item) => ({
        topic: item.topic,
        conceptId: createMemoryId('concept', item.topic, item.concept),
        conceptName: item.concept,
        masteryScore: item.masteryScore,
        status: item.status,
        recentErrors: item.recentErrors,
        recentSuccesses: item.recentSuccesses,
        misconceptionHints: item.misconceptionHints,
        confidence: item.confidence,
        lastSeenAt: item.lastSeenAt,
        nextReviewAt: item.nextReviewAt,
        updatedAt: item.updatedAt,
      })),
      topicProjections: v2.states.topicStates.map((item) => ({
        topic: item.topic,
        familiarityScore: item.familiarityScore,
        estimatedLevel: item.estimatedLevel,
        mustCoverConceptIds: item.mustCoverConcepts.map((concept) => createMemoryId('concept', item.topic, concept)),
        skippableConceptIds: item.skippableBasics.map((concept) => createMemoryId('concept', item.topic, concept)),
        riskConceptIds: item.riskConcepts.map((concept) => createMemoryId('concept', item.topic, concept)),
        confidence: item.confidence,
        updatedAt: item.updatedAt,
      })),
      episodicProjections: [
        ...v2.summaries.courseSummaries.map((item) => ({
          id: createMemoryId('episode', 'course', item.courseId),
          topic: item.topic,
          courseId: item.courseId,
          kind: 'course' as const,
          summary: item.summary,
          conceptIds: [],
          explanationStyles: [],
          updatedAt: item.updatedAt,
        })),
        ...v2.summaries.topicSummaries.map((item) => ({
          id: createMemoryId('episode', 'topic', item.topic),
          topic: item.topic,
          kind: 'chat' as const,
          summary: item.summary,
          conceptIds: item.keyGaps,
          explanationStyles: [],
          updatedAt: item.updatedAt,
        })),
      ],
    },
    updatedAt: v2.updatedAt,
  };
}

function buildPreferencesFromLegacy(memory: UserMemory): MemoryStoreV2['profile']['preferences'] {
  return memory.extractedInsights.learningPreferences
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((item, index) => ({
      id: createMemoryId('preference', item.kind, item.value, index),
      kind: item.kind,
      value: item.value,
      confidence: item.confidence,
      source: 'chat' as const,
      updatedAt: item.updatedAt,
    }));
}

function buildSignalsFromLegacy(memory: UserMemory) {
  const signals = [] as MemoryStoreV2['signals'];

  for (const record of memory.learningHistory) {
    signals.push({
      id: createMemoryId('signal', 'progress', record.courseId, record.topic),
      type: 'course_progress',
      topic: record.topic,
      courseId: record.courseId,
      source: 'progress',
      confidence: 0.78,
      occurredAt: record.completedAt || memory.lastUpdated,
      payload: { nodesCompleted: record.nodesCompleted, totalNodes: record.totalNodes },
    });
  }

  for (const pattern of memory.extractedInsights.questionPatterns) {
    signals.push({
      id: createMemoryId('signal', 'chat-question', pattern.topic, pattern.timestamp),
      type: 'chat_question',
      topic: pattern.topic,
      source: pattern.source === 'assessment' ? 'assessment' : 'chat',
      confidence: pattern.confidence || 0.6,
      occurredAt: pattern.timestamp,
      payload: { question: pattern.question },
    });
  }

  for (const gap of memory.extractedInsights.knowledgeGaps) {
    signals.push({
      id: createMemoryId('signal', 'gap', gap.topic, normalizeConceptKey(gap.concept)),
      type: 'chat_confusion',
      topic: gap.topic,
      concept: normalizeConceptKey(gap.concept),
      source: gap.source === 'assessment' ? 'assessment' : 'chat',
      confidence: gap.confidence || (gap.source === 'assessment' ? 0.85 : 0.65),
      occurredAt: gap.lastUpdated || memory.lastUpdated,
      payload: { evidence: gap.evidence, severity: gap.severity },
    });
  }

  for (const mastery of memory.extractedInsights.conceptMastery) {
    signals.push({
      id: createMemoryId('signal', 'attempt', mastery.topic, normalizeConceptKey(mastery.concept), mastery.lastReviewedAt),
      type: 'question_attempt',
      topic: mastery.topic,
      concept: normalizeConceptKey(mastery.concept),
      source: mastery.source === 'chat' ? 'chat' : 'assessment',
      confidence: mastery.confidence || 0.75,
      occurredAt: mastery.lastReviewedAt,
      payload: {
        totalAttempts: mastery.totalAttempts,
        correctAttempts: mastery.correctAttempts,
        accuracy: mastery.accuracy,
        needsReview: mastery.needsReview,
      },
    });
  }

  for (const mastery of memory.extractedInsights.masteredConcepts) {
    signals.push({
      id: createMemoryId('signal', 'chat-mastery', mastery.topic, normalizeConceptKey(mastery.concept), mastery.updatedAt),
      type: 'chat_mastery',
      topic: mastery.topic,
      concept: normalizeConceptKey(mastery.concept),
      source: 'chat',
      confidence: mastery.confidence || 0.66,
      occurredAt: mastery.updatedAt,
      payload: {
        evidence: mastery.evidence,
      },
    });
  }

  return signals.sort((a, b) => b.occurredAt - a.occurredAt);
}

function buildConceptStates(memory: UserMemory): ConceptState[] {
  const conceptMap = new Map<string, ConceptState>();
  const now = Date.now();

  for (const mastery of memory.extractedInsights.conceptMastery) {
    const normalizedConcept = normalizeConceptKey(mastery.concept);
    const key = `${mastery.topic}::${normalizedConcept}`;
    conceptMap.set(key, {
      topic: mastery.topic,
      concept: normalizedConcept,
      masteryScore: Number(mastery.accuracy.toFixed(2)),
      status: determineConceptStatus(mastery.accuracy, mastery.totalAttempts - mastery.correctAttempts, mastery.needsReview),
      evidenceCount: mastery.totalAttempts,
      recentErrors: mastery.totalAttempts - mastery.correctAttempts,
      recentSuccesses: mastery.correctAttempts,
      lastSeenAt: mastery.lastReviewedAt,
      nextReviewAt: mastery.needsReview ? mastery.lastReviewedAt + 7 * 24 * 60 * 60 * 1000 : undefined,
      misconceptionHints: [],
      confidence: mastery.confidence || 0.8,
      updatedAt: mastery.lastReviewedAt || now,
    });
  }

  for (const gap of memory.extractedInsights.knowledgeGaps) {
    const normalizedConcept = normalizeConceptKey(gap.concept);
    const key = `${gap.topic}::${normalizedConcept}`;
    const existing = conceptMap.get(key);
    const gapConfidence = gap.confidence || (gap.source === 'assessment' ? 0.82 : 0.62);
    const hints = uniqueStrings(gap.evidence.map(summarizeEvidence)).slice(0, 3);

    if (existing) {
      existing.misconceptionHints = uniqueStrings([...existing.misconceptionHints, ...hints]).slice(0, 3);
      existing.recentErrors = Math.max(existing.recentErrors, gap.evidence.length);
      existing.evidenceCount = Math.max(existing.evidenceCount, gap.evidence.length);
      existing.masteryScore = Number(Math.min(existing.masteryScore, gap.source === 'assessment' ? 0.45 : 0.55).toFixed(2));
      existing.status = existing.masteryScore >= 0.55 ? 'fragile' : 'learning';
      existing.confidence = Math.max(existing.confidence, gapConfidence);
      existing.updatedAt = Math.max(existing.updatedAt, gap.lastUpdated || now);
    } else {
      conceptMap.set(key, {
        topic: gap.topic,
        concept: normalizedConcept,
        masteryScore: gap.source === 'assessment' ? 0.32 : 0.4,
        status: 'learning',
        evidenceCount: gap.evidence.length,
        recentErrors: gap.evidence.length,
        recentSuccesses: 0,
        lastSeenAt: gap.lastUpdated,
        nextReviewAt: gap.lastUpdated ? gap.lastUpdated + 3 * 24 * 60 * 60 * 1000 : undefined,
        misconceptionHints: hints,
        confidence: gapConfidence,
        updatedAt: gap.lastUpdated || now,
      });
    }
  }

  for (const mastered of memory.extractedInsights.masteredConcepts) {
    const normalizedConcept = normalizeConceptKey(mastered.concept);
    const key = `${mastered.topic}::${normalizedConcept}`;
    const existing = conceptMap.get(key);
    if (existing) {
      existing.masteryScore = Number(Math.max(existing.masteryScore, 0.72).toFixed(2));
      existing.recentSuccesses = Math.max(existing.recentSuccesses, 1);
      existing.status = existing.masteryScore >= 0.8 ? 'mastered' : 'fragile';
      existing.confidence = Math.max(existing.confidence, mastered.confidence);
      existing.updatedAt = Math.max(existing.updatedAt, mastered.updatedAt);
      existing.lastSeenAt = Math.max(existing.lastSeenAt || 0, mastered.updatedAt);
    } else {
      conceptMap.set(key, {
        topic: mastered.topic,
        concept: normalizedConcept,
        masteryScore: 0.72,
        status: 'fragile',
        evidenceCount: 1,
        recentErrors: 0,
        recentSuccesses: 1,
        lastSeenAt: mastered.updatedAt,
        misconceptionHints: [],
        confidence: mastered.confidence,
        updatedAt: mastered.updatedAt,
      });
    }
  }

  return Array.from(conceptMap.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

function buildTopicStates(memory: UserMemory, conceptStates: ConceptState[]): TopicState[] {
  const topics = new Set<string>([
    ...memory.learningHistory.map((item) => item.topic),
    ...conceptStates.map((item) => item.topic),
  ]);

  return Array.from(topics).map((topic) => {
    const relatedConcepts = conceptStates.filter((item) => item.topic === topic);
    const learningRecord = memory.learningHistory.find((item) => item.topic === topic);
    const averageMastery = relatedConcepts.length
      ? relatedConcepts.reduce((sum, item) => sum + item.masteryScore, 0) / relatedConcepts.length
      : 0;
    const progressScore = learningRecord ? learningRecord.nodesCompleted / Math.max(learningRecord.totalNodes, 1) : 0;
    const familiarityScore = Number(Math.min(0.95, averageMastery * 0.65 + progressScore * 0.35).toFixed(2));

    return {
      topic,
      familiarityScore,
      estimatedLevel: inferLevel(familiarityScore),
      transferableBackground: [],
      mustCoverConcepts: uniqueStrings(
        relatedConcepts.filter((item) => item.status === 'learning' || item.status === 'fragile').sort((a, b) => a.masteryScore - b.masteryScore).map((item) => item.concept),
      ).slice(0, 4),
      skippableBasics: uniqueStrings(
        relatedConcepts.filter((item) => item.status === 'mastered').sort((a, b) => b.masteryScore - a.masteryScore).map((item) => item.concept),
      ).slice(0, 3),
      riskConcepts: uniqueStrings(
        relatedConcepts.filter((item) => item.recentErrors > 0 || item.misconceptionHints.length > 0).sort((a, b) => b.recentErrors - a.recentErrors).map((item) => item.concept),
      ).slice(0, 4),
      confidence: Number(Math.min(0.92, 0.45 + relatedConcepts.length * 0.08 + (learningRecord ? 0.12 : 0)).toFixed(2)),
      updatedAt: Math.max(learningRecord?.completedAt || 0, ...relatedConcepts.map((item) => item.updatedAt), memory.lastUpdated),
    };
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}

function buildCourseSummaries(memory: UserMemory) {
  return memory.learningHistory.map((record) => ({
    courseId: record.courseId,
    topic: record.topic,
    summary: `${record.topic} 已完成 ${record.nodesCompleted}/${record.totalNodes} 节`,
    completedNodes: record.nodesCompleted,
    totalNodes: record.totalNodes,
    updatedAt: record.completedAt || memory.lastUpdated,
  }));
}

function buildTopicSummaries(memory: UserMemory, conceptStates: ConceptState[]) {
  const topics = new Set<string>([
    ...memory.learningHistory.map((item) => item.topic),
    ...conceptStates.map((item) => item.topic),
  ]);

  return Array.from(topics).map((topic) => {
    const topicConcepts = conceptStates.filter((item) => item.topic === topic);
    const keyGaps = topicConcepts.filter((item) => item.status === 'learning' || item.status === 'fragile').slice(0, 3).map((item) => item.concept);
    const keyStrengths = topicConcepts.filter((item) => item.status === 'mastered').slice(0, 3).map((item) => item.concept);

    return {
      topic,
      summary: keyGaps.length ? `${topic} 当前最需要补的是 ${keyGaps.join('、')}` : `${topic} 暂无明确薄弱点`,
      keyGaps,
      keyStrengths,
      updatedAt: Math.max(memory.lastUpdated, ...topicConcepts.map((item) => item.updatedAt)),
    };
  });
}

export function migrateUserMemoryToV2(memory: UserMemory | MemoryStoreV2 | MemoryStoreV3 | null | undefined, profile?: UserProfile | null): MemoryStoreV2 {
  if (isMemoryStoreV2(memory)) {
    return memory;
  }

  if (isMemoryStoreV3(memory)) {
    return convertMemoryStoreV3ToV2(memory);
  }

  const legacyMemory = memory ? decayUserMemory(mergeProfileIntoMemory(memory, profile || memory.profile)) : createDefaultUserMemory(profile);
  const conceptStates = buildConceptStates(legacyMemory);

  return {
    version: 2,
    learnerId: 'local-user',
    profile: {
      stableFacts: buildStableFacts(legacyMemory.profile),
      goals: buildGoals(legacyMemory.profile),
      preferences: buildPreferencesFromLegacy(legacyMemory),
    },
    signals: buildSignalsFromLegacy(legacyMemory),
    states: {
      topicStates: buildTopicStates(legacyMemory, conceptStates),
      conceptStates,
    },
    summaries: {
      topicSummaries: buildTopicSummaries(legacyMemory, conceptStates),
      courseSummaries: buildCourseSummaries(legacyMemory),
    },
    updatedAt: legacyMemory.lastUpdated,
  };
}

function rebuildStatesFromSignals(memoryStore: MemoryStoreV2): MemoryStoreV2 {
  const conceptStateMap = new Map<string, ConceptState>();
  const topicSignals = new Map<string, MemoryStoreV2['signals']>();

  for (const signal of memoryStore.signals) {
    const topicGroup = topicSignals.get(signal.topic) || [];
    topicGroup.push(signal);
    topicSignals.set(signal.topic, topicGroup);

    if (!signal.concept) continue;

    const concept = normalizeConceptKey(signal.concept);
    const key = `${signal.topic}::${concept}`;
    const current = conceptStateMap.get(key) || {
      topic: signal.topic,
      concept,
      masteryScore: 0,
      status: 'unknown' as const,
      evidenceCount: 0,
      recentErrors: 0,
      recentSuccesses: 0,
      misconceptionHints: [],
      confidence: 0.4,
      updatedAt: signal.occurredAt,
    };

    current.evidenceCount += 1;
    current.updatedAt = Math.max(current.updatedAt, signal.occurredAt);
    current.lastSeenAt = signal.occurredAt;
    current.confidence = Math.max(current.confidence, signal.confidence);

    if (signal.type === 'question_attempt') {
      const accuracy = Number(signal.payload.accuracy || 0);
      current.masteryScore = Number(((current.masteryScore + accuracy) / (current.evidenceCount > 1 ? 2 : 1)).toFixed(2));
      if (accuracy >= 0.7) {
        current.recentSuccesses += 1;
      } else {
        current.recentErrors += 1;
      }
    }

    if (signal.type === 'chat_mastery') {
      current.recentSuccesses += 1;
      current.masteryScore = Number(Math.max(current.masteryScore, 0.72).toFixed(2));
    }

    if (signal.type === 'chat_confusion') {
      current.recentErrors += 1;
      current.masteryScore = Number(Math.min(current.masteryScore || 0.45, 0.45).toFixed(2));
      const evidence = Array.isArray(signal.payload.evidence) ? signal.payload.evidence : [signal.payload.evidence];
      current.misconceptionHints = uniqueStrings([
        ...current.misconceptionHints,
        ...evidence.filter(Boolean).map((item) => summarizeEvidence(String(item))),
      ]).slice(0, 3);
    }

    if (signal.type === 'chat_question' && typeof signal.payload.question === 'string') {
      current.misconceptionHints = uniqueStrings([
        ...current.misconceptionHints,
        summarizeEvidence(signal.payload.question),
      ]).slice(0, 3);
    }

    current.status = determineConceptStatus(current.masteryScore, current.recentErrors, current.recentErrors > 0 && current.masteryScore < 0.75);
    conceptStateMap.set(key, current);
  }

  const conceptStates = Array.from(conceptStateMap.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  const topicStates: TopicState[] = Array.from(topicSignals.entries()).map(([topic, signals]) => {
    const relatedConcepts = conceptStates.filter((item) => item.topic === topic);
    const familiarityBase = relatedConcepts.length ? relatedConcepts.reduce((sum, item) => sum + item.masteryScore, 0) / relatedConcepts.length : 0;
    const familiarityScore = Number(Math.min(0.95, familiarityBase + Math.min(signals.length, 5) * 0.04).toFixed(2));

    return {
      topic,
      familiarityScore,
      estimatedLevel: inferLevel(familiarityScore),
      transferableBackground: [],
      mustCoverConcepts: uniqueStrings(relatedConcepts.filter((item) => item.status === 'learning' || item.status === 'fragile').map((item) => item.concept)).slice(0, 4),
      skippableBasics: uniqueStrings(relatedConcepts.filter((item) => item.status === 'mastered').map((item) => item.concept)).slice(0, 3),
      riskConcepts: uniqueStrings(relatedConcepts.filter((item) => item.recentErrors > 0 || item.misconceptionHints.length > 0).map((item) => item.concept)).slice(0, 4),
      confidence: Number(Math.min(0.92, 0.45 + signals.length * 0.05).toFixed(2)),
      updatedAt: Math.max(...signals.map((item) => item.occurredAt)),
    };
  }).sort((a, b) => b.updatedAt - a.updatedAt);

  return {
    ...memoryStore,
    states: { topicStates, conceptStates },
    updatedAt: Math.max(memoryStore.updatedAt, ...memoryStore.signals.map((item) => item.occurredAt), memoryStore.updatedAt),
  };
}

function getFreshnessScore(updatedAt?: number): number {
  if (!updatedAt) return 0.55;
  const ageInDays = daysBetween(Date.now(), updatedAt);
  if (ageInDays <= 7) return 1;
  if (ageInDays <= 30) return 0.8;
  if (ageInDays <= 90) return 0.6;
  return 0.4;
}

function rankBackgroundFacts(topic: string, memoryStore: MemoryStoreV2): string[] {
  return memoryStore.profile.stableFacts
    .filter((item) => item.kind === 'knowledge_background' || item.kind === 'analogy_experience')
    .map((item) => ({
      text: item.text,
      score: getTopicRelevanceScore(topic, item.text) * item.confidence * getFreshnessScore(item.updatedAt),
    }))
    .filter((item) => item.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((item) => item.text);
}

function getPreferredExplanationStyles(memoryStore: MemoryStoreV2): string[] {
  return memoryStore.profile.preferences
    .filter((item) => item.kind === 'explanation_style' || item.kind === 'analogy_style')
    .map((item) => ({
      value: item.value,
      score: item.confidence * getFreshnessScore(item.updatedAt),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((item) => item.value);
}

export function appendChatSignalsToMemoryStore(memoryStore: MemoryStoreV2, input: ChatSignalInput): MemoryStoreV2 {
  const now = Date.now();
  const nextSignals = [...memoryStore.signals];

  nextSignals.unshift({
    id: createMemoryId('signal', 'chat-question', input.topic, now, input.question.slice(0, 12)),
    type: 'chat_question',
    topic: input.topic,
    source: 'chat',
    confidence: DEFAULT_QUESTION_CONFIDENCE,
    occurredAt: now,
    courseId: input.courseId,
    payload: { question: input.question },
  });

  if (input.confusionConcept && input.confusionEvidence) {
    nextSignals.unshift({
      id: createMemoryId('signal', 'chat-confusion', input.topic, normalizeConceptKey(input.confusionConcept), now),
      type: 'chat_confusion',
      topic: input.topic,
      concept: normalizeConceptKey(input.confusionConcept),
      source: 'chat',
      confidence: input.confidence || DEFAULT_CHAT_GAP_CONFIDENCE,
      occurredAt: now,
      courseId: input.courseId,
      payload: { evidence: [input.confusionEvidence] },
    });
  }

  return rebuildStatesFromSignals({ ...memoryStore, signals: nextSignals, updatedAt: now });
}

export function getPlanningMemoryPayload(topic: string, userMemory?: UserMemory | MemoryStoreV2 | MemoryStoreV3 | null): PlanningMemoryPayload {
  const memoryStore = isMemoryStoreV3(userMemory) ? convertMemoryStoreV3ToV2(userMemory) : migrateUserMemoryToV2(userMemory);
  const topicState = memoryStore.states.topicStates
    .map((item) => ({ item, score: getTopicRelevanceScore(topic, item.topic) * item.confidence * getFreshnessScore(item.updatedAt) }))
    .filter((entry) => entry.score >= 0.2)
    .sort((a, b) => b.score - a.score)[0]?.item;

  const recentRelevantCourses = memoryStore.summaries.courseSummaries
    .map((item) => ({ ...item, score: getTopicRelevanceScore(topic, item.topic) * getFreshnessScore(item.updatedAt) }))
    .filter((item) => item.score >= 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((item) => ({ topic: item.topic, summary: item.summary }));

  return {
    learnerSnapshot: {
      targetGoal: memoryStore.profile.goals[0]?.goalText,
      estimatedLevel: topicState?.estimatedLevel || 'novice',
      confidence: topicState?.confidence || 0.35,
    },
    transferableBackground: rankBackgroundFacts(topic, memoryStore),
    mustCoverConcepts: topicState?.mustCoverConcepts.slice(0, 3) || [],
    skippableBasics: topicState?.skippableBasics.slice(0, 2) || [],
    riskConcepts: topicState?.riskConcepts.slice(0, 3) || [],
    recentRelevantCourses,
  };
}

export function getTeachingMemoryPayload(input: TeachingPayloadInput): TeachingMemoryPayload {
  const { topic, nodeTitle, nodeConcepts, prerequisiteConcepts = [], userMemory } = input;
  const memoryStore = isMemoryStoreV3(userMemory) ? convertMemoryStoreV3ToV2(userMemory) : migrateUserMemoryToV2(userMemory);
  const conceptStates = memoryStore.states.conceptStates.filter((item) => getTopicRelevanceScore(topic, item.topic) >= 0.45);
  const normalizedNodeConcepts = nodeConcepts.map(normalizeConceptKey);
  const normalizedPrerequisiteConcepts = prerequisiteConcepts.map(normalizeConceptKey);

  const targetConceptStates = normalizedNodeConcepts.map((concept) => {
    const matched = conceptStates
      .filter((item) => Math.max(getTopicRelevanceScore(concept, item.concept), getTopicRelevanceScore(nodeTitle, item.concept)) >= 0.55)
      .sort((a, b) => a.masteryScore - b.masteryScore)[0];

    return matched ? {
      concept: matched.concept,
      status: matched.status,
      masteryScore: matched.masteryScore,
      misconceptionHints: matched.misconceptionHints.slice(0, 2),
    } : {
      concept,
      status: 'unknown' as const,
      masteryScore: 0,
      misconceptionHints: [],
    };
  }).slice(0, 3);

  const prerequisiteConceptStates = normalizedPrerequisiteConcepts.map((concept) => {
    const matched = conceptStates
      .filter((item) => getTopicRelevanceScore(concept, item.concept) >= 0.55)
      .sort((a, b) => b.masteryScore - a.masteryScore)[0];

    return matched ? {
      concept: matched.concept,
      status: matched.status,
      masteryScore: matched.masteryScore,
    } : {
      concept,
      status: 'unknown' as const,
      masteryScore: 0,
    };
  }).slice(0, 2);

  const recentQuestionSummaries = memoryStore.signals
    .filter((item) => item.type === 'chat_question')
    .map((item) => ({
      text: String(item.payload.question || ''),
      score: getTopicRelevanceScore(topic, item.topic) * Math.max(getTopicRelevanceScore(nodeTitle, String(item.payload.question || '')), ...normalizedNodeConcepts.map((concept) => getTopicRelevanceScore(concept, String(item.payload.question || '')))) * item.confidence * getFreshnessScore(item.occurredAt),
    }))
    .filter((item) => item.score >= 0.18)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => item.text);

  return {
    nodeTopic: topic,
    nodeTitle,
    prerequisiteConceptStates,
    targetConceptStates,
    recentQuestionSummaries,
    analogyHints: rankBackgroundFacts(`${topic} ${nodeTitle}`, memoryStore),
    preferredExplanationStyles: getPreferredExplanationStyles(memoryStore),
  };
}

export function getChatMemoryPayload(input: ChatPayloadInput): ChatMemoryPayload {
  const { topic, currentNodeTitle = '', currentQuestion = '', userMemory } = input;
  const memoryStore = isMemoryStoreV3(userMemory) ? convertMemoryStoreV3ToV2(userMemory) : migrateUserMemoryToV2(userMemory);
  const focusSource = currentNodeTitle || currentQuestion || topic;

  const topicState = memoryStore.states.topicStates
    .map((item) => ({ item, score: Math.max(getTopicRelevanceScore(topic, item.topic), getTopicRelevanceScore(focusSource, item.topic)) * item.confidence * getFreshnessScore(item.updatedAt) }))
    .filter((entry) => entry.score >= 0.2)
    .sort((a, b) => b.score - a.score)[0]?.item;

  const focusConceptStates = memoryStore.states.conceptStates
    .map((item) => ({ item, score: Math.max(getTopicRelevanceScore(topic, item.topic), getTopicRelevanceScore(focusSource, item.concept), getTopicRelevanceScore(currentQuestion, item.concept)) * item.confidence * getFreshnessScore(item.updatedAt) }))
    .filter((entry) => entry.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ item }) => ({
      concept: item.concept,
      status: item.status,
      masteryScore: item.masteryScore,
      misconceptionHints: item.misconceptionHints.slice(0, 2),
    }));

  const recentQuestionSummaries = memoryStore.signals
    .filter((item) => item.type === 'chat_question')
    .map((item) => ({
      text: String(item.payload.question || ''),
      score: Math.max(getTopicRelevanceScore(topic, item.topic), getTopicRelevanceScore(focusSource, String(item.payload.question || ''))) * item.confidence * getFreshnessScore(item.occurredAt),
    }))
    .filter((item) => item.score >= 0.18)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => item.text);

  const topicSummary = memoryStore.summaries.topicSummaries
    .map((item) => ({ item, score: getTopicRelevanceScore(topic, item.topic) * getFreshnessScore(item.updatedAt) }))
    .filter((entry) => entry.score >= 0.25)
    .sort((a, b) => b.score - a.score)[0]?.item.summary;

  return {
    topic,
    focusConceptStates,
    riskConcepts: topicState?.riskConcepts.slice(0, 3) || focusConceptStates.map((item) => item.concept),
    recentQuestionSummaries,
    analogyHints: rankBackgroundFacts(`${topic} ${focusSource}`, memoryStore),
    preferredExplanationStyles: getPreferredExplanationStyles(memoryStore),
    topicSummary,
  };
}
