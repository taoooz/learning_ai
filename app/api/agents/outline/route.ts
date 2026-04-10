import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_AGENT_URL } from '@/lib/agent-config';

/**
 * 消费 Python Agent 的 SSE 流，解析事件并返回结构化 JSON
 */
async function consumeSSEStream(response: Response): Promise<{
  sessionId: string | null;
  parsed: { questions?: any[]; outline?: any };
}> {
  const text = await response.text();

  let sessionId: string | null = null;
  let fullContent = '';
  let parsed = { questions: [] as any[], outline: null as any };

  // 逐行解析 SSE 事件
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (data === '[DONE]') continue;

    try {
      const event = JSON.parse(data);

      switch (event.type) {
        case 'session_created':
          sessionId = event.sessionId;
          break;
        case '__full_content__':
          parsed = event.parsed || {};
          break;
      }
    } catch {
      // 跳过无法解析的行
    }
  }

  return { sessionId, parsed };
}

/**
 * 将 Python Agent 的 parsed 结果转换为前端期望的 OutlineResponse 格式
 */
function buildResponseData(
  sessionId: string | null,
  parsed: { questions?: any[]; outline?: any }
) {
  const result: Record<string, any> = {};

  if (sessionId) {
    result.sessionId = sessionId;
  }

  if (parsed.questions && parsed.questions.length > 0) {
    // 有问题 → 前端期望 type: 'questions'
    result.type = 'questions';
    result.questions = parsed.questions.map((q: any) => ({
      id: q.id,
      question: q.question,
      options: q.options,
    }));
  } else if (parsed.outline) {
    // 有 outline → 前端期望 type: 'confirmation'
    result.type = 'confirmation';
    result.blueprint = {
      learningDirection: parsed.outline.learningDirection,
      learningGoal: parsed.outline.learningGoal,
      learnerPositioning: {
        estimatedLevel: parsed.outline.estimatedLevel,
        difficultySummary: '',
        backgroundSummary: parsed.outline.backgroundSummary || '',
        skipBasics: parsed.outline.skipBasics || [],
        whyThisCourseFits: '',
      },
    };
  } else {
    result.type = 'reconsider';
    result.message = '让我重新思考一下...';
  }

  return result;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { topic, userProfile, userMemory, userMessage, sessionId } = body;

    let agentUrl: string;
    let agentBody: Record<string, any>;

    if (sessionId) {
      agentUrl = `${PYTHON_AGENT_URL}/api/agents/outline/answer_agent`;
      agentBody = { sessionId, answer: userMessage };
    } else {
      agentUrl = `${PYTHON_AGENT_URL}/api/agents/outline/generate_agent`;
      agentBody = { topic, userProfile: userProfile || {}, userMemory: userMemory || {} };
    }

    const response = await fetch(agentUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(agentBody),
    });

    if (!response.ok) {
      throw new Error(`Python Agent error: ${response.status}`);
    }

    // 消费 SSE 流，提取结构化数据
    const { sessionId: newSessionId, parsed } = await consumeSSEStream(response);

    // 转换为前端期望的 JSON 格式
    const data = buildResponseData(newSessionId, parsed);

    return NextResponse.json(data);
  } catch (error) {
    console.error('Agent proxy error:', error);
    return NextResponse.json(
      { error: 'Agent 服务调用失败，请确保 Python Agent 服务已启动' },
      { status: 500 }
    );
  }
}
