import { NextRequest } from 'next/server';
import { callPythonAgent, PythonAgentError } from '@/lib/python-agent';
import { apiSuccess, apiError, requireAuth } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const { topic, nodeInfo, learnerBackground, userProfile, prevNodeSummary, nextNodeSummary } = await request.json();

    const insights = userProfile?.insights;

    const payload: Record<string, unknown> = {
      nodeTitle: nodeInfo?.title || '',
      teachingGoal: nodeInfo?.teachingGoal || '',
      courseName: nodeInfo?.courseName || topic || '',
      courseDescription: nodeInfo?.courseDescription || '',
      estimatedLevel: nodeInfo?.estimatedLevel || 'beginner',
      frame: nodeInfo?.frame || 'total_split_total',
      backgroundSummary: nodeInfo?.backgroundSummary || learnerBackground?.backgroundSummary || '',
      skipBasics: nodeInfo?.skipBasics || learnerBackground?.skipBasics || [],
      prevNode: prevNodeSummary ? { title: prevNodeSummary.title, concepts: prevNodeSummary.concepts || [] } : null,
      nextNode: nextNodeSummary ? { title: nextNodeSummary.title, concepts: nextNodeSummary.concepts || [] } : null,
    };

    // 个性化字段：有值才透传，缺省时保持 Python 侧默认行为
    if (insights?.learningStyle) payload.learningStyle = insights.learningStyle;
    if (insights?.technicalLevel) payload.technicalLevel = insights.technicalLevel;
    if (Array.isArray(insights?.valuePriorities) && insights.valuePriorities.length > 0) {
      payload.valuePriorities = insights.valuePriorities;
    }
    if (insights?.summary) payload.userInsights = insights.summary;

    const data = await callPythonAgent('/api/agents/cards/generate_agent', {
      topic: topic || '',
      payload,
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
