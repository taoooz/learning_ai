import type { PromptLabStageDefinition, PromptLabStageId } from '@/types/prompt-lab';

const JSON_HINT = '按当前生产协议填写 JSON；运行前会解析并校验。';

export const PROMPT_LAB_STAGES: PromptLabStageDefinition[] = [
  {
    id: 'outline_initial',
    title: 'Outline 首次生成',
    group: '课程级',
    description: '分析诉求，决定提问或直接输出课程纲要。',
    nextStage: 'outline_answer',
    fields: [
      { key: 'topic', label: '用户学习诉求', type: 'textarea', rows: 4 },
      { key: 'userProfile', label: '用户画像', type: 'json', rows: 12, hint: JSON_HINT },
      { key: 'planningMemory', label: 'Planning Memory', type: 'json', rows: 10, hint: JSON_HINT },
      { key: 'history', label: '历史消息', type: 'json', rows: 6, advanced: true },
      { key: 'needsCalibration', label: '强制校准', type: 'boolean' },
    ],
  },
  {
    id: 'outline_answer',
    title: 'Outline 澄清回答',
    group: '课程级',
    description: '沿用 Outline system prompt，把批量答案作为下一轮用户消息。',
    nextStage: 'architect_chapters',
    fields: [
      { key: 'topic', label: '用户学习诉求', type: 'textarea', rows: 3 },
      { key: 'userProfile', label: '用户画像', type: 'json', rows: 10, hint: JSON_HINT },
      { key: 'planningMemory', label: 'Planning Memory', type: 'json', rows: 8, hint: JSON_HINT },
      { key: 'answers', label: '批量澄清答案', type: 'json', rows: 10, hint: JSON_HINT },
      { key: 'history', label: '历史消息', type: 'json', rows: 10, advanced: true },
      { key: 'needsCalibration', label: '强制校准', type: 'boolean' },
    ],
  },
  {
    id: 'architect_chapters',
    title: 'Architect 章节目录',
    group: '课程级',
    description: '只生成 courseTopic + chapters，供前端逐章展示。',
    nextStage: 'architect_meta',
    fields: [
      { key: 'topic', label: '课程主题', type: 'text' },
      { key: 'outline', label: '已确认纲要', type: 'json', rows: 10, hint: JSON_HINT },
      { key: 'learner', label: '学习者起点', type: 'json', rows: 8, hint: JSON_HINT },
      { key: 'memoryContext', label: 'Memory Context', type: 'json', rows: 8, advanced: true },
      { key: 'evidence', label: '已有证据', type: 'textarea', rows: 8, advanced: true },
      { key: 'sources', label: '来源列表', type: 'json', rows: 6, advanced: true },
      { key: 'allowSearch', label: '允许搜索', type: 'boolean' },
      { key: 'history', label: '历史消息', type: 'json', rows: 5, advanced: true },
    ],
  },
  {
    id: 'architect_meta',
    title: 'Architect 元信息',
    group: '课程级',
    description: '固定章节后补全 thesis、conceptGraph 与 examplePolicy。',
    nextStage: 'chapter_plan',
    fields: [
      { key: 'topic', label: '课程主题', type: 'text' },
      { key: 'outline', label: '已确认纲要', type: 'json', rows: 8, hint: JSON_HINT },
      { key: 'learner', label: '学习者起点', type: 'json', rows: 8, hint: JSON_HINT },
      { key: 'chapterPlan', label: '章节目录产物', type: 'json', rows: 16, hint: JSON_HINT },
      { key: 'memoryContext', label: 'Memory Context', type: 'json', rows: 6, advanced: true },
      { key: 'evidence', label: '已有证据', type: 'textarea', rows: 6, advanced: true },
      { key: 'sources', label: '来源列表', type: 'json', rows: 6, advanced: true },
      { key: 'history', label: '历史消息', type: 'json', rows: 5, advanced: true },
    ],
  },
  {
    id: 'architect_review',
    title: 'Architect 架构审查',
    group: '课程级',
    description: '可选的章节级设计风险审查，不分析确定性校验已覆盖的问题。',
    nextStage: 'chapter_plan',
    fields: [
      { key: 'learner', label: '学习者起点', type: 'json', rows: 8, hint: JSON_HINT },
      { key: 'architecture', label: '完整课程架构', type: 'json', rows: 22, hint: JSON_HINT },
      { key: 'history', label: '历史消息', type: 'json', rows: 5, advanced: true },
    ],
  },
  {
    id: 'chapter_plan',
    title: '章节任务计划',
    group: '章节级',
    description: '把单个章节拆成 2～7 个有认知增量的短任务。',
    nextStage: 'task_search_decision',
    fields: [
      { key: 'blueprint', label: 'CourseBlueprint', type: 'json', rows: 22, hint: JSON_HINT },
      { key: 'chapterId', label: 'chapterId', type: 'text' },
      { key: 'completedChapters', label: '已完成章节摘要', type: 'json', rows: 8 },
      { key: 'memoryContext', label: 'Memory Context', type: 'json', rows: 6, advanced: true },
      { key: 'evidence', label: '已有证据', type: 'textarea', rows: 6, advanced: true },
      { key: 'sources', label: '来源列表', type: 'json', rows: 5, advanced: true },
      { key: 'allowSearch', label: '允许搜索', type: 'boolean' },
      { key: 'history', label: '历史消息', type: 'json', rows: 5, advanced: true },
    ],
  },
  {
    id: 'chapter_plan_review',
    title: '章节计划审查',
    group: '章节级',
    description: '高风险计划的可选审查，只阻止重复、过基础和虚假递进。',
    nextStage: 'task_search_decision',
    fields: [
      { key: 'blueprint', label: 'CourseBlueprint', type: 'json', rows: 18, hint: JSON_HINT },
      { key: 'chapterId', label: 'chapterId', type: 'text' },
      { key: 'tasks', label: '待审章节任务', type: 'json', rows: 16, hint: JSON_HINT },
      { key: 'history', label: '历史消息', type: 'json', rows: 5, advanced: true },
    ],
  },
  {
    id: 'task_search_decision',
    title: '任务搜索决策',
    group: '章节级',
    description: '只判断当前任务是否需要补充联网证据，不写正文。',
    nextStage: 'task_content',
    fields: [
      { key: 'request', label: 'TaskStreamRequest', type: 'json', rows: 24, hint: JSON_HINT },
      { key: 'evidence', label: '已有证据', type: 'textarea', rows: 8 },
      { key: 'sources', label: '来源列表', type: 'json', rows: 5 },
      { key: 'history', label: '历史消息', type: 'json', rows: 5, advanced: true },
    ],
  },
  {
    id: 'task_content',
    title: '任务正文生成',
    group: '章节级',
    description: '按教学模式配方生成单个任务的流式教学正文。',
    fields: [
      { key: 'request', label: 'TaskStreamRequest', type: 'json', rows: 26, hint: JSON_HINT },
      { key: 'evidence', label: '已有证据', type: 'textarea', rows: 8 },
      { key: 'sources', label: '来源列表', type: 'json', rows: 5 },
      { key: 'memoryContext', label: 'Memory Context', type: 'json', rows: 6, advanced: true },
      { key: 'allowSearch', label: '允许正文内搜索', type: 'boolean', advanced: true },
      { key: 'history', label: '历史消息', type: 'json', rows: 5, advanced: true },
    ],
  },
];

export const PROMPT_LAB_STAGE_BY_ID = Object.fromEntries(
  PROMPT_LAB_STAGES.map((stage) => [stage.id, stage]),
) as Record<PromptLabStageId, PromptLabStageDefinition>;

export function getPromptLabStage(stageId: PromptLabStageId): PromptLabStageDefinition {
  return PROMPT_LAB_STAGE_BY_ID[stageId];
}

export function getNextPromptLabStage(stageId: PromptLabStageId): PromptLabStageId | null {
  return PROMPT_LAB_STAGE_BY_ID[stageId]?.nextStage ?? null;
}
