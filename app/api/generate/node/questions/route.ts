import { NextRequest } from 'next/server';
import { callPythonAgent } from '@/lib/python-agent';
import { apiSuccess, apiError } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  try {
    const { topic, nodeInfo, cards } = await request.json();

    const data = await callPythonAgent('/api/agents/questions/generate_agent', {
      topic: topic || '',
      cards: cards || [],
      payload: {
        nodeTitle: nodeInfo?.title || '',
        teachingGoal: nodeInfo?.teachingGoal || '',
        courseName: topic || '',
      },
    });

    return apiSuccess(data);
  } catch (error) {
    console.error('[Questions Agent proxy] Error:', error);
    return apiError(error instanceof Error ? error.message : '题目生成失败', 500);
  }
}
