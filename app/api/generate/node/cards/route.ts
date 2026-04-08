// app/api/generate/node/cards/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createMemoryRepository } from '@/lib/memory/repository';
import { validateCardsRequest } from '@/lib/validation/api-schemas';
import type { UserMemory } from '@/types/course';

// Python Agent 服务地址
const PYTHON_AGENT_URL = process.env.PYTHON_AGENT_URL || 'http://localhost:8000';

function extractUserInsights(userMemory: UserMemory | null): string {
  if (!userMemory?.profile?.insights) return '暂无';
  const { knowledgeBackground, analogyExperiences, summary } = userMemory.profile.insights;
  const parts = [];
  if (knowledgeBackground?.length) parts.push(`知识背景：${knowledgeBackground.join('、')}`);
  if (analogyExperiences?.length) parts.push(`类比经历：${analogyExperiences.join('、')}`);
  if (summary) parts.push(`总结：${summary}`);
  return parts.join('；') || '暂无';
}

export async function POST(request: NextRequest) {
  try {
    const { topic, nodeInfo, userMemory } = validateCardsRequest(await request.json());

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

    // 构建 payload
    const payload = {
      nodeTitle: nodeInfo.title || '',
      teachingGoal: nodeInfo.teachingGoal || '',
      courseName: nodeInfo.courseName,
      courseDescription: nodeInfo.courseDescription,
      userInsights: insights,
      estimatedLevel: nodeInfo.estimatedLevel,
      backgroundSummary: nodeInfo.backgroundSummary,
      prevNode: nodeInfo.prevNode,
      nextNode: nodeInfo.nextNode,
    };

    console.log('[Cards API] Calling Python Agent');

    const response = await fetch(`${PYTHON_AGENT_URL}/api/agents/cards/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, payload }),
    });

    if (!response.ok) {
      throw new Error(`Python Agent error: ${response.status}`);
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Cards API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Cards generation failed' },
      { status: 500 }
    );
  }
}
