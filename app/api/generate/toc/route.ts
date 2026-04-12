import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_AGENT_URL } from '@/lib/agent-config';

export async function POST(request: NextRequest) {
  const { blueprint } = await request.json();

  try {
    const response = await fetch(`${PYTHON_AGENT_URL}/api/agents/toc/generate_agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blueprint }),
    });

    if (!response.ok) {
      throw new Error(`Python Agent error: ${response.status}`);
    }

    // 消费 SSE 流，提取最终结果
    const text = await response.text();
    const lines = text.split('\n');

    let result: any = null;

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;

      try {
        const event = JSON.parse(data);
        if (event.type === 'complete' && event.result) {
          result = event.result;
        }
      } catch {
        // 跳过无法解析的行
      }
    }

    if (!result) {
      throw new Error('TOC generation did not return a complete result');
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[TOC Agent proxy] Error:', error);
    // 降级：返回原始错误，不 fallback 到本地 MiniMax
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '目录生成失败' },
      { status: 500 }
    );
  }
}
