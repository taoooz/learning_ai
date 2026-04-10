// app/api/generate/node/questions/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { validateQuestionsRequest } from '@/lib/validation/api-schemas';

// Python Agent 服务地址
const PYTHON_AGENT_URL = process.env.PYTHON_AGENT_URL || 'http://localhost:8000';

function extractUserInsights(insights: { workSummary?: string[]; analogyExperiences?: string[]; summary?: string } | null | undefined): string {
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
    const { topic, nodeInfo, cards, userMemory } = validateQuestionsRequest(await request.json());

    // 从 userMemory 提取用户洞察
    const insights = extractUserInsights(
      (userMemory as { profile?: { insights?: { workSummary?: string[]; analogyExperiences?: string[]; summary?: string } } } | null)?.profile?.insights
    );

    const payload = {
      courseName: nodeInfo.courseName,
      nodeTitle: nodeInfo.title || '',
      teachingGoal: nodeInfo.teachingGoal || '',
      userInsights: insights,
      estimatedLevel: nodeInfo.estimatedLevel,
      backgroundSummary: nodeInfo.backgroundSummary,
    };

    console.log('[Questions API] Calling Python Agent');

    const response = await fetch(`${PYTHON_AGENT_URL}/api/agents/questions/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, cards, payload }),
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
      console.error('[Questions API] Python Agent error:', response.status, parsedDetail);
      throw new Error(`Python Agent error: ${response.status}${parsedDetail ? ` - ${parsedDetail}` : ''}`);
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Questions API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Questions generation failed' },
      { status: error instanceof Error && error.message.startsWith('Missing') ? 400 : 500 }
    );
  }
}
