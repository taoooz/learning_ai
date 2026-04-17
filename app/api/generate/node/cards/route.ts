import { NextRequest } from 'next/server';
import { callPythonAgent, PythonAgentError } from '@/lib/python-agent';
import { apiSuccess, apiError } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  try {
    const { topic, nodeInfo, learnerBackground, prevNodeSummary, nextNodeSummary } = await request.json();

    const data = await callPythonAgent('/api/agents/cards/generate_agent', {
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
    });

    return apiSuccess(data);
  } catch (error) {
    console.error('[Cards Agent proxy] Error:', error);
    const message = error instanceof PythonAgentError
      ? `Python Agent 服务异常 (${error.status})，请确保服务正常运行`
      : error instanceof Error ? error.message : '卡片生成失败';
    return apiError(message, 500);
  }
}
