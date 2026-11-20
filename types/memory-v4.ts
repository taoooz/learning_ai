// types/memory-v4.ts — Memory V4 类型契约
// 不兼容旧 MemoryStoreV3。无历史数据迁移，直接以 V4 为新事实协议。
// 核心边界：
// 1. Learning Evidence 是能力判断的唯一事实源。
// 2. Memory Record 是带来源、作用域和生命周期的长期上下文。
// 3. Concept/Core/Payload/Summary 是可重建投影。
// 4. LLM 只能产出 Candidate 或推断；长期写入由确定性策略完成。

/** 统一使用毫秒时间戳，展示层再按用户时区格式化。 */
export type MemoryTimestamp = number;

export type MemoryKind =
  | 'fact'
  | 'goal'
  | 'constraint'
  | 'preference'
  | 'episode'
  | 'teaching_strategy';

export type MemoryScope =
  | { type: 'user' }
  | { type: 'course'; courseId: string }
  | { type: 'topic'; topic: string }
  | { type: 'concept'; topic: string; conceptKey: string };

/** Candidate 不使用此状态；Candidate 生命周期由 MemoryCandidateV4.status 表示。 */
export type MemoryStatus =
  | 'active'
  | 'conflicted'
  | 'superseded'
  | 'expired'
  | 'archived'
  | 'tombstoned';

/** session 状态属于 L0 Working Memory，不进入长期 Memory。 */
export type MemoryDurability = 'course' | 'long_term';

export type MemorySourceType =
  | 'explicit_user_statement'
  | 'learning_evidence'
  | 'repeated_behavior'
  | 'user_profile_input'
  | 'user_profile_inference'
  | 'system_rule';

export type MemorySensitivity = 'normal' | 'sensitive';
export type MemoryActor = 'user' | 'rule' | 'llm';

export type MemorySourceRef =
  | {
      type: 'user_message';
      conversationId: string;
      messageId: string;
    }
  | {
      type: 'learning_evidence';
      evidenceId: string;
    }
  | {
      type: 'chapter_recap';
      courseId: string;
      chapterId: string;
    }
  | {
      type: 'user_edit';
      editId: string;
    }
  | {
      type: 'user_profile';
      profileHash: string;
      profileRevision: number;
      fieldPath: string;
      derivation: 'user_input' | 'model_inference';
      promotionStatus?: 'user_input' | 'auto_active' | 'candidate' | 'rejected';
      promotionReason?: string;
    }
  | {
      type: 'system_rule';
      ruleId: string;
    };

export interface MemoryRecordV4 {
  memoryId: string;
  accountId: string;
  kind: MemoryKind;
  scope: MemoryScope;
  status: MemoryStatus;

  title: string;
  summary: string;
  content: string;
  tags: string[];
  conceptKeys: string[];

  sourceType: MemorySourceType;
  sourceRefs: MemorySourceRef[];
  evidenceIds: string[];

  /** 幂等键：同一来源与语义的重复导入/整理不得生成新记录。 */
  dedupeKey: string;
  confidence: number;
  importance: number;
  durability: MemoryDurability;
  sensitivity: MemorySensitivity;

  observedAt: MemoryTimestamp;
  validFrom?: MemoryTimestamp;
  validTo?: MemoryTimestamp;
  createdAt: MemoryTimestamp;
  updatedAt: MemoryTimestamp;
  version: number;

  createdBy: MemoryActor;
  supersedes?: string[];
  conflictsWith?: string[];
}

export interface MemoryCandidateV4 {
  candidateId: string;
  accountId: string;

  kind: MemoryKind;
  scope: MemoryScope;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  conceptKeys: string[];

  sourceType: MemorySourceType;
  sourceRefs: MemorySourceRef[];
  evidenceIds: string[];
  confidence: number;
  importance: number;
  durability: MemoryDurability;
  sensitivity: MemorySensitivity;

  suggestedAction: 'add' | 'update' | 'supersede' | 'ignore';
  targetMemoryId?: string;
  dedupeKey: string;

  extractionVersion: string;
  createdAt: MemoryTimestamp;
  status: 'pending' | 'applied' | 'rejected' | 'failed';
  rejectionReason?: string;
}

export interface MemoryTombstoneV4 {
  tombstoneId: string;
  accountId: string;
  memoryId?: string;
  dedupeKey?: string;
  reason:
    | 'user_forget'
    | 'user_correction'
    | 'profile_field_removed'
    | 'course_deleted'
    | 'learning_history_deleted';
  operationId: string;
  createdAt: MemoryTimestamp;
}

// ---------------------------------------------------------------------------
// Profile ingestion：用户输入与模型推断分开，推断可按规则自动启用。
// ---------------------------------------------------------------------------

export interface ProfileFactV4 {
  fieldPath: string;
  value: string;
  profileHash: string;
  profileRevision: number;
  userProvidedAt: MemoryTimestamp;
}

export interface ProfileInferenceV4 {
  fieldPath: string;
  value: string;
  profileHash: string;
  profileRevision: number;
  confidence: number;
  modelVersion: string;
  generatedAt: MemoryTimestamp;
  /** 低成本产品不需要用户逐条确认，由确定性 promotion policy 决定。 */
  promotionStatus: 'auto_active' | 'candidate' | 'rejected';
  promotionReason: string;
// 'rejected' 只表示不作为长期 Memory 使用，原画像推断仍可按策略保留用于审计。
}

export interface ProfileSnapshotV4 {
  accountId: string;
  profileHash: string;
  profileRevision: number;
  facts: ProfileFactV4[];
  inferences: ProfileInferenceV4[];
  updatedAt: MemoryTimestamp;
}

export interface ProfileMemoryIngestionV4 {
  ingestionId: string;
  accountId: string;
  profileHash: string;
  profileRevision: number;
  importedMemoryIds: string[];
  supersededMemoryIds: string[];
  skippedFields: string[];
  status: 'active' | 'partial' | 'failed';
  ingestedAt: MemoryTimestamp;
}

// ---------------------------------------------------------------------------
// Evidence：能力判断的唯一事实源。
// ---------------------------------------------------------------------------

export type EvidenceOutcome =
  | 'demonstrated'
  | 'partial'
  | 'not_demonstrated'
  | 'skipped'
  | 'invalidated';

export type EvidenceStrength = 'weak' | 'moderate' | 'strong';

export type EvidenceKind =
  | 'self_report'
  | 'scenario_choice'
  | 'sequence'
  | 'self_explanation'
  | 'micro_practice'
  | 'error_diagnosis'
  | 'transfer_task';

export type EvidenceHintLevel = 'none' | 'light' | 'substantial';
export type EvidenceEvaluator = 'rule' | 'model' | 'hybrid';

export interface LearningEvidenceV4 {
  evidenceId: string;
  evidenceKey: string;
  idempotencyKey: string;
  accountId: string;
  protocolVersion: 4;

  courseId: string;
  chapterId: string;
  topic: string;
  objectiveId: string;
  conceptKeys: string[];
  taskId?: string;
  checkpointId?: string;
  remediationId?: string;

  kind: EvidenceKind;
  outcome: EvidenceOutcome;
  strength: EvidenceStrength;
  score?: number;
  confidence: number;

  attempt: number;
  hintLevel: EvidenceHintLevel;
  isRemediationAttempt: boolean;

  sourceItemId: string;
  planVersion: number;
  evaluator: EvidenceEvaluator;
  evaluationVersion: string;

  answerDigest?: string;
  misconceptionCodes: string[];

  createdAt: MemoryTimestamp;
  invalidReason?: string;
}

export interface LearningEvidenceLedgerV4 {
  version: 4;
  accountId: string;
  revision: number;
  evidence: LearningEvidenceV4[];
  updatedAt: MemoryTimestamp;
}

export interface RemediationOutcomeRecordV4 {
  remediationId: string;
  accountId: string;
  conceptKeys: string[];

  triggerEvidenceId: string;
  beforeEvidenceId: string;
  afterEvidenceId?: string;

  strategyKey: string;
  strategyVersion: string;
  round: number;
  outcome: 'pending' | 'helped' | 'partially_helped' | 'not_helped' | 'abandoned';
  createdAt: MemoryTimestamp;
}

// ---------------------------------------------------------------------------
// Derived learning projections：全部可从 Evidence / Remediation 重建。
// ---------------------------------------------------------------------------

export type ConceptStatus =
  | 'unknown'
  | 'introduced'
  | 'developing'
  | 'demonstrated'
  | 'fragile'
  | 'needs_review'
  | 'not_applicable';

export interface ConceptMisconceptionV4 {
  code: string;
  statement: string;
  evidenceIds: string[];
  occurrenceCount: number;
  lastObservedAt: MemoryTimestamp;
  resolvedAt?: MemoryTimestamp;
}

export interface RemediationStrategyStateV4 {
  strategyKey: string;
  strategyVersion: string;
  successCount: number;
  partialCount: number;
  failureCount: number;
  lastVerifiedAt?: MemoryTimestamp;
  evidenceIds: string[];
}

export interface ConceptLearningStateV4 {
  conceptKey: string;
  conceptName: string;
  topic: string;
  aliases: string[];

  status: ConceptStatus;
  evidenceCount: number;
  strongEvidenceCount: number;
  recentEvidenceIds: string[];

  misconceptions: ConceptMisconceptionV4[];
  effectiveRemediationStrategies: RemediationStrategyStateV4[];

  lastIntroducedAt?: MemoryTimestamp;
  lastDemonstratedAt?: MemoryTimestamp;
  lastAssessedAt?: MemoryTimestamp;
  nextReviewAt?: MemoryTimestamp;

  confidence: number;
  updatedAt: MemoryTimestamp;
}

export interface TopicLearningStateV4 {
  topic: string;
  conceptKeys: string[];
  demonstratedConceptKeys: string[];
  reviewConceptKeys: string[];
  riskConceptKeys: string[];
  confidence: number;
  updatedAt: MemoryTimestamp;
}

export interface ReviewQueueItemV4 {
  conceptKey: string;
  conceptName: string;
  topic: string;
  reason: 'fragile' | 'needs_review' | 'stale_evidence' | 'user_requested';
  priority: 'low' | 'medium' | 'high';
  dueAt: MemoryTimestamp;
  sourceEvidenceIds: string[];
}

export interface MemoryProjectionMetaV4 {
  projectionVersion: string;
  sourceLedgerRevision: number;
  dirty: boolean;
  rebuiltAt: MemoryTimestamp;
}

export interface MemoryProjectionsV4 extends MemoryProjectionMetaV4 {
  version: 4;
  accountId: string;
  conceptStates: ConceptLearningStateV4[];
  topicStates: TopicLearningStateV4[];
  reviewQueue: ReviewQueueItemV4[];
}

// ---------------------------------------------------------------------------
// Core / Store
// ---------------------------------------------------------------------------

export interface CoreMemoryItemV4 {
  text: string;
  sourceRecordIds: string[];
  sourceEvidenceIds?: string[];
  confidence: number;
}

export interface CoreRiskConceptV4 {
  conceptKey: string;
  conceptName: string;
  reason: string;
  sourceRecordIds: string[];
  sourceEvidenceIds: string[];
}

export interface CoreLearnerMemoryV4 {
  accountId: string;
  goals: CoreMemoryItemV4[];
  constraints: CoreMemoryItemV4[];
  activePreferences: CoreMemoryItemV4[];
  currentFocus?: CoreMemoryItemV4;
  riskConcepts: CoreRiskConceptV4[];
  reviewQueue: ReviewQueueItemV4[];
  sourceRecordIds: string[];
  sourceLedgerRevision: number;
  generatedAt: MemoryTimestamp;
}

export interface LearnerMemorySummaryV4 {
  journey: string;
  currentFocus: string;
  learnerInsights: string[];
  areasToWatch: string[];
  sourceRecordIds: string[];
  sourceEvidenceIds: string[];
  summaryVersion: string;
  sourceLedgerRevision: number;
  generatedAt: MemoryTimestamp;
}

export interface MemoryStoreV4 {
  version: 4;
  accountId: string;
  revision: number;
  policyVersion: string;
  projectionVersion: string;
  records: MemoryRecordV4[];
  profileIngestions: ProfileMemoryIngestionV4[];
  profileSnapshot?: ProfileSnapshotV4;
  projections: MemoryProjectionsV4;
  tombstones: MemoryTombstoneV4[];
  core: CoreLearnerMemoryV4;
  learningSummary?: LearnerMemorySummaryV4;
  updatedAt: MemoryTimestamp;
}

export interface MemoryIndexEntryV4 {
  memoryId: string;
  accountId: string;
  kind: MemoryKind;
  scope: MemoryScope;
  status: MemoryStatus;
  title: string;
  summary: string;
  tags: string[];
  conceptKeys: string[];
  topic?: string;
  importance: number;
  confidence: number;
  observedAt: MemoryTimestamp;
  validFrom?: MemoryTimestamp;
  validTo?: MemoryTimestamp;
  updatedAt: MemoryTimestamp;
}

export interface MemoryIndexV4 {
  version: 4;
  accountId: string;
  entries: MemoryIndexEntryV4[];
  sourceStoreRevision: number;
  rebuiltAt: MemoryTimestamp;
}

// ---------------------------------------------------------------------------
// Scene-specific disclosure
// ---------------------------------------------------------------------------

export type MemoryTaskKind =
  | 'course_planning'
  | 'chapter_planning'
  | 'task_teaching'
  | 'chat'
  | 'review'
  | 'checkpoint_generation'
  | 'checkpoint_evaluation';

export type MemoryDisclosureLevel = 'core' | 'index' | 'body' | 'evidence';

export interface MemoryUseContractV4 {
  taskKind: MemoryTaskKind;
  purpose: string;
  requiredInputs: string[];
  optionalInputs: string[];
  allowedDecisions: string[];
  forbiddenDecisions: string[];
  abstainRule: string;
  fallback: string;
  successMetrics: string[];
}

export interface MemoryScenePolicyV4 {
  taskKind: MemoryTaskKind;
  contract: MemoryUseContractV4;
  allowedLevels: MemoryDisclosureLevel[];
  includeKinds: MemoryKind[];
  coreTokenBudget: number;
  indexTokenBudget: number;
  bodyTokenBudget: number;
  evidenceTokenBudget: number;
  maxIndexEntries: number;
  maxBodyRecords: number;
}

export interface MemorySelectionTraceV4 {
  status: 'ok' | 'no_relevant_memory' | 'degraded';
  candidateCount: number;
  filteredCount: number;
  selectedRecordIds: string[];
  droppedReasons: string[];
  scoreComponents?: Record<string, number>;
}

export interface MemoryConflictV4 {
  memoryIds: string[];
  description: string;
}

export interface RetrievedMemorySummaryV4 {
  memoryId: string;
  kind: MemoryKind;
  scope: MemoryScope;
  title: string;
  summary: string;
  tags: string[];
  confidence: number;
  importance: number;
  disclosureLevel: 'index';
  selectionReason: string;
  rank: number;
  score: number;
  sourceRecordIds: string[];
  sourceEvidenceIds: string[];
}

export interface RetrievedMemoryBodyV4 extends Omit<RetrievedMemorySummaryV4, 'disclosureLevel'> {
  content: string;
  disclosureLevel: 'body';
}

export interface RetrievedEvidenceV4 {
  evidenceId: string;
  objectiveId: string;
  conceptKeys: string[];
  outcome: EvidenceOutcome;
  strength: EvidenceStrength;
  disclosureLevel: 'evidence';
  selectionReason: string;
}

export interface MemoryContextEnvelopeV4 {
  policyId: string;
  policyVersion: string;
  index: RetrievedMemorySummaryV4[];
  bodies: RetrievedMemoryBodyV4[];
  evidence: RetrievedEvidenceV4[];
  learningState: {
    topicStates: TopicLearningStateV4[];
    conceptStates: ConceptLearningStateV4[];
    reviewQueue: ReviewQueueItemV4[];
  };
  learningSummary?: LearnerMemorySummaryV4;
  knownConflicts: MemoryConflictV4[];
  selectionTrace: MemorySelectionTraceV4;
  estimatedTokensByLayer: Record<MemoryDisclosureLevel, number>;
  fallback: 'none' | 'no_relevant_memory' | 'memory_unavailable';
  generatedAt: MemoryTimestamp;
}

export interface CoursePlanningMemoryContextV4 extends MemoryContextEnvelopeV4 {
  scene: 'course_planning';
  core: CoreLearnerMemoryV4;
}

export interface ChapterPlanningMemoryContextV4 extends MemoryContextEnvelopeV4 {
  scene: 'chapter_planning';
  core: CoreLearnerMemoryV4;
}

export interface TaskTeachingMemoryContextV4 extends MemoryContextEnvelopeV4 {
  scene: 'task_teaching';
  core: CoreLearnerMemoryV4;
}

export interface ChatMemoryContextV4 extends MemoryContextEnvelopeV4 {
  scene: 'chat';
  core: CoreLearnerMemoryV4;
}

export interface ReviewMemoryContextV4 extends MemoryContextEnvelopeV4 {
  scene: 'review';
  core: CoreLearnerMemoryV4;
}

export interface CheckpointGenerationMemoryContextV4 extends MemoryContextEnvelopeV4 {
  scene: 'checkpoint_generation';
  core?: never;
}

/** 评估公平性边界：不提供用户身份、偏好、长期历史或其他个人 Memory。 */
export interface CheckpointEvaluationMemoryContextV4 {
  scene: 'checkpoint_evaluation';
  policyId: string;
  policyVersion: string;
  selectionTrace: MemorySelectionTraceV4;
  fallback: 'none';
  generatedAt: MemoryTimestamp;
}

export type MemoryContextPayloadV4 =
  | CoursePlanningMemoryContextV4
  | ChapterPlanningMemoryContextV4
  | TaskTeachingMemoryContextV4
  | ChatMemoryContextV4
  | ReviewMemoryContextV4
  | CheckpointGenerationMemoryContextV4
  | CheckpointEvaluationMemoryContextV4;

/** 客户端只提交场景和任务标识；accountId 必须由服务端鉴权层派生。 */
export interface MemoryContextRequestV4 {
  scene: MemoryTaskKind;
  courseId?: string;
  chapterId?: string;
  taskId?: string;
  conceptKeys?: string[];
  queryText?: string;
}

/** 仅供服务端 Memory Resolver 内部使用。 */
export interface MemoryRetrievalQueryV4 {
  accountId: string;
  scene: MemoryTaskKind;
  courseId?: string;
  chapterId?: string;
  taskId?: string;
  topic?: string;
  currentNodeTitle?: string;
  conceptKeys?: string[];
  queryText?: string;
  maxRecords: number;
  maxTokens: number;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export type MemoryAuditAction =
  | 'candidate_created'
  | 'candidate_rejected'
  | 'profile_ingested'
  | 'record_created'
  | 'record_updated'
  | 'record_superseded'
  | 'record_expired'
  | 'record_archived'
  | 'record_tombstoned'
  | 'record_deleted'
  | 'summary_rebuilt'
  | 'index_rebuilt'
  | 'projection_rebuilt';

export interface MemoryAuditEntryV4 {
  auditId: string;
  accountId: string;
  action: MemoryAuditAction;

  memoryId?: string;
  candidateId?: string;
  ingestionId?: string;
  previousStatus?: MemoryStatus;
  nextStatus?: MemoryStatus;

  actor: MemoryActor;
  reason: string;
  sourceRefs: MemorySourceRef[];
  at: MemoryTimestamp;
}
