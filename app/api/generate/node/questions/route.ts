// app/api/generate/node/questions/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';
import { buildQuestionsPrompt, type QuestionsPromptPayload } from '@/lib/prompt';
import { createMemoryRepository } from '@/lib/memory/repository';
import { validateQuestionsRequest } from '@/lib/validation/api-schemas';
import type { UserMemory } from '@/types/course';

export async function POST(request: NextRequest) {
  try {
    const { topic, nodeInfo, cards, userMemory } = validateQuestionsRequest(await request.json());

    // 获取教学记忆
    const memoryRepository = createMemoryRepository({ initialMemory: userMemory });
    const teachingPayload = memoryRepository.getTeachingPayload({
      topic,
      nodeTitle: nodeInfo.title || '',
      nodeConcepts: nodeInfo.teachConceptIds || [],
      prerequisiteConcepts: nodeInfo.prerequisiteConceptIds || [],
    });

    // 从 userMemory 提取用户洞察
    const insights = extractUserInsights(userMemory);

    const payload: QuestionsPromptPayload = {
      courseName: nodeInfo.courseName,
      nodeTitle: nodeInfo.title || '',
      teachingGoal: nodeInfo.teachingGoal || '',
      userInsights: insights,
    };

    const prompt = buildQuestionsPrompt(topic, cards, payload);
    const content = await callMiniMax(prompt, { maxTokens: 3000 });
    const result = parseJSONResponse<{ questions: any[] }>(content);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Questions API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Questions generation failed' },
      { status: error instanceof Error && error.message.startsWith('Missing') ? 400 : 500 }
    );
  }
}

function extractUserInsights(userMemory: UserMemory | null): string {
  if (!userMemory) return '暂无';

  const { profile } = userMemory;
  if (!profile?.insights) return '暂无';

  const { knowledgeBackground, analogyExperiences, summary } = profile.insights;
  const parts: string[] = [];

  if (summary) parts.push(summary);
  if (knowledgeBackground?.length) {
    parts.push(`背景知识：${knowledgeBackground.join('、')}`);
  }
  if (analogyExperiences?.length) {
    parts.push(`相关经历：${analogyExperiences.join('、')}`);
  }

  return parts.length > 0 ? parts.join('；') : '暂无';
}
