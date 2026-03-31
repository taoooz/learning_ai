import { NextRequest, NextResponse } from 'next/server';

// Python Agent 服务地址
const PYTHON_AGENT_URL = process.env.PYTHON_AGENT_URL || 'http://localhost:8000';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { topic, userProfile, userMemory, userMessage, sessionId } = body;

    // 如果有 sessionId，说明是继续对话，调用 answer 端点
    if (sessionId) {
      const response = await fetch(`${PYTHON_AGENT_URL}/api/agents/outline/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          answer: userMessage,
        }),
      });

      if (!response.ok) {
        throw new Error(`Python Agent error: ${response.status}`);
      }

      const data = await response.json();
      return NextResponse.json(data);
    }

    // 否则是首次调用，调用 generate 端点
    const response = await fetch(`${PYTHON_AGENT_URL}/api/agents/outline/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        userProfile: userProfile || {},
        userMemory: userMemory || {},
      }),
    });

    if (!response.ok) {
      throw new Error(`Python Agent error: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Agent proxy error:', error);
    return NextResponse.json(
      { error: 'Agent 服务调用失败，请确保 Python Agent 服务已启动' },
      { status: 500 }
    );
  }
}
