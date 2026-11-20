// lib/chat/summary-analysis.ts
// 对话摘要使用的轻量信号分析：只服务当前课程聊天摘要，不写长期 Memory。

const CONFUSION_SIGNALS = [
  '没懂', '不懂', '还是不明白', '还是没明白', '有点懵', '看不懂',
  '卡住了', '分不清', '总是分不清', '老是混淆', '答错', '又错了', '讲清楚',
  '再解释', '再举个例子',
];

const EXPLANATION_STYLE_PATTERNS = [
  { matcher: /(一步一步|分步骤|步骤讲|逐步|第一步|第二步)/, value: '分步拆解' },
  { matcher: /(举个例子|给个例子|例如|比如)/, value: '例子驱动' },
  { matcher: /(类比|打比方)/, value: '类比解释' },
  { matcher: /(简单点|通俗点|白话)/, value: '通俗解释' },
  { matcher: /(区别|对比|放在一起比较)/, value: '对比讲解' },
];

function normalizeConceptText(raw: string): string {
  return raw
    .replace(/^(关于|就是|这个|这里的|一下|请问)/, '')
    .replace(/(能再举个例子吗|可以再解释下吗|怎么理解|是什么意思|是什么|为什么|吗|呢|呀|啊)$/g, '')
    .replace(/[，。！？?？]+$/g, '')
    .trim();
}

export function analyzeChatMessageForMemory(text: string): {
  shouldAddKnowledgeGap: boolean;
  extractedConcept: string | null;
  confidence: number;
} {
  const normalizedText = text.trim();
  if (!normalizedText) return { shouldAddKnowledgeGap: false, extractedConcept: null, confidence: 0 };
  if (!CONFUSION_SIGNALS.some((signal) => normalizedText.includes(signal))) {
    return { shouldAddKnowledgeGap: false, extractedConcept: null, confidence: 0 };
  }
  const repeatedCount = CONFUSION_SIGNALS.filter((signal) => normalizedText.includes(signal)).length;
  const confidence = Math.min(0.9, 0.55 + repeatedCount * 0.07);
  const patterns = [
    /没懂(.{2,30}?的区别)/,
    /不明白(.{2,30}?的区别)/,
    /没懂(.{2,30}?)(?:区别|怎么理解|是什么意思|是什么|为什么|，|。|？|\?|$)/,
    /不明白(.{2,30}?)(?:区别|怎么理解|是什么意思|是什么|为什么|，|。|？|\?|$)/,
    /分不清(.{2,30}?)(?:和.+?的区别|，|。|？|\?|$)/,
    /(.{2,30}?的区别)/,
    /关于(.{2,30}?)(?:这块|这里|这个点|，|。|？|\?|$)/,
  ];
  for (const pattern of patterns) {
    const match = normalizedText.match(pattern);
    const rawConcept = match?.[1] || match?.[0];
    if (rawConcept) {
      const concept = normalizeConceptText(rawConcept);
      if (concept.length >= 2) {
        return { shouldAddKnowledgeGap: true, extractedConcept: concept, confidence };
      }
    }
  }
  return {
    shouldAddKnowledgeGap: true,
    extractedConcept: normalizeConceptText(normalizedText.slice(0, 20)) || null,
    confidence: Math.max(0.5, confidence - 0.08),
  };
}

export function detectChatLearningPreferences(text: string): Array<{ value: string }> {
  const normalizedText = text.trim();
  if (!normalizedText) return [];
  return EXPLANATION_STYLE_PATTERNS
    .filter((item) => item.matcher.test(normalizedText))
    .map((item) => ({ value: item.value }));
}

export function detectAssistantExplanationStyle(text: string): string | undefined {
  const normalizedText = text.trim();
  if (!normalizedText) return undefined;
  return EXPLANATION_STYLE_PATTERNS.find((item) => item.matcher.test(normalizedText))?.value;
}
