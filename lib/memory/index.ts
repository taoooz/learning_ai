// lib/memory/index.ts
// Memory 模块统一导出入口

// 聚合器
export {
  analyzeChatMessageForMemory,
  detectAssistantExplanationStyle,
  detectChatLearningPreferences,
  detectExplicitMasteredConcept,
  normalizeConceptKey,
  type ChatSignalInput,
  type DetectedLearningPreference,
  type DetectedMasteredConcept,
  type QuestionAttemptPayload,
} from './aggregator';

// 记忆 Agent
export {
  getChatMemoryPayload,
  getPlanningMemoryPayload,
  getTeachingMemoryPayload,
} from './memory-agent';

// Repository + 快照
export {
  createMemoryRepository,
  getUserMemoryStoreSnapshot,
} from './repository';
