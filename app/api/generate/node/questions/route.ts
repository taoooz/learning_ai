import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_AGENT_URL } from '@/lib/agent-config';

export async function POST(request: NextRequest) {
  const { topic, nodeInfo, cards } = await request.json();

  // 转换为 Python Agent 期望的参数格式
  const agentBody = {
    topic: topic || '',
    cards: cards || [],
    payload: {
      nodeTitle: nodeInfo?.title || '',
      teachingGoal: nodeInfo?.teachingGoal || '',
      courseName: topic || '',
    },
  };

  try {
    const response = await fetch(`${PYTHON_AGENT_URL}/api/agents/questions/generate_agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(agentBody),
    });

    if (!response.ok) {
      throw new Error(`Python Agent error: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[Questions Agent proxy] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '题目生成失败' },
      { status: 500 }
    );
  }
}
