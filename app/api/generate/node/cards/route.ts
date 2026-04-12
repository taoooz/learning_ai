// app/api/generate/node/cards/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createMemoryRepository } from '@/lib/memory/repository';
import { validateCardsRequest } from '@/lib/validation/api-schemas';
import type { LearningInsight } from '@/types/course';

// Python Agent 服务地址
const PYTHON_AGENT_URL = process.env.PYTHON_AGENT_URL || 'http://localhost:8000';

function extractUserInsights(insights: LearningInsight | null | undefined): string {
  if (!insights) return '暂无';
  const { workSummary, analogyExperiences, summary } = insights;
  const parts = [];
  if (workSummary?.length) parts.push(`工作背景：${workSummary.join('、')}`);
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

    // 从 V3 profile 提取用户洞察
    const profileInsights = (userMemory as { profile?: { insights?: LearningInsight } } | null)?.profile?.insights;
    const insights = extractUserInsights(profileInsights);

    // 构建 payload
    const payload = {
      nodeTitle: nodeInfo.title || '',
      teachingGoal: nodeInfo.teachingGoal || '',
      courseName: nodeInfo.courseName,
      courseDescription: nodeInfo.courseDescription,
      userInsights: insights,
      estimatedLevel: nodeInfo.estimatedLevel,
      backgroundSummary: nodeInfo.backgroundSummary,
      frame: nodeInfo.frame,
      prevNode: nodeInfo.prevNode,
      nextNode: nodeInfo.nextNode,
      teachingMemory: teachingPayload,
      skipBasics: nodeInfo.skipBasics || [],
      learningStyle: profileInsights?.learningStyle || '',
      technicalLevel: profileInsights?.technicalLevel || '',
      valuePriorities: profileInsights?.valuePriorities || [],
    };

    console.log('[Cards API] Calling Python Agent (Agent version)');

    const response = await fetch(`${PYTHON_AGENT_URL}/api/agents/cards/generate_agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, payload }),
    });

    if (!response.ok) {
      const responseText = await response.text();
      let parsedDetail = responseText;
      try {
        const parsed = JSON.parse(responseText) as { detail?: string; error?: string; message?: string };
        parsedDetail = parsed.detail || parsed.error || parsed.message || responseText;
      } catch {
        // keep raw text
      }
      console.error('[Cards API] Python Agent error:', response.status, parsedDetail);
      throw new Error(`Python Agent error: ${response.status}${parsedDetail ? ` - ${parsedDetail}` : ''}`);
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
