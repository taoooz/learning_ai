import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_AGENT_URL } from '@/lib/agent-config';

export async function POST(request: NextRequest) {
  const { topic, nodeInfo, learnerBackground, prevNodeSummary, nextNodeSummary } = await request.json();

  // 转换为 Python Agent 期望的参数格式
  const agentBody = {
    topic: topic || '',
    payload: {
      nodeTitle: nodeInfo?.title || '',
      teachingGoal: nodeInfo?.teachingGoal || '',
      courseName: topic || '',
      backgroundSummary: learnerBackground?.backgroundSummary || '',
      skipBasics: learnerBackground?.skipBasics || [],
      prevNode: prevNodeSummary ? { title: prevNodeSummary.title, concepts: prevNodeSummary.concepts || [] } : null,
      nextNode: nextNodeSummary ? { title: nextNodeSummary.title, concepts: nextNodeSummary.concepts || [] } : null,
    },
  };

  try {
    const response = await fetch(`${PYTHON_AGENT_URL}/api/agents/cards/generate_agent`, {
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
    console.error('[Cards Agent proxy] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '卡片生成失败' },
      { status: 500 }
    );
  }
}
