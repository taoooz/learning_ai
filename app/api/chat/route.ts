// app/api/chat/route.ts
import { NextRequest } from 'next/server';
import { buildChatContext } from '@/lib/chat-context';
import { createMemoryRepository } from '@/lib/memory/repository';
import { PYTHON_AGENT_URL } from '@/lib/agent-config';
import type { ChatMessage } from '@/types/chat';
import type { ConversationSummary, CourseTree, MemoryStoreV2, MemoryStoreV3, UserMemory } from '@/types/course';

export const dynamic = 'force-dynamic';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const { course, messages, userMemory, contextInfo, conversationSummary } = await request.json() as {
      course: CourseTree;
      messages: ChatMessage[];
      userMemory: UserMemory | MemoryStoreV2 | MemoryStoreV3;
      contextInfo?: {
        currentNodeTitle?: string;
        currentNodeCards?: string[];
        currentQuestion?: string;
      };
      conversationSummary?: ConversationSummary;
    };

    if (!course || !messages || !userMemory) {
      return new Response('Missing required fields', { status: 400 });
    }

    // 构建上下文
    const memoryRepository = createMemoryRepository({
      initialMemory: userMemory as MemoryStoreV3 | null,
      getProfile: () => null,
    });
    const chatMemoryPayload = memoryRepository.getChatPayload({
      topic: course.topic,
      currentNodeTitle: contextInfo?.currentNodeTitle,
      currentQuestion: contextInfo?.currentQuestion,
    });

    const context = buildChatContext(course, messages, contextInfo, conversationSummary, chatMemoryPayload);

    // 构建 AI 消息
    const aiMessages = [
      { role: 'system' as const, content: context },
      ...messages.map(m => ({ role: m.role, content: m.content }))
    ];

    // 转发到 Python Agent（输出 MiniMax 兼容 SSE 格式，前端无需改动）
    const response = await fetch(`${PYTHON_AGENT_URL}/api/agents/chat/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: aiMessages, maxTokens: 1500 }),
    });

    if (!response.ok) {
      throw new Error(`Python Agent error: ${response.status}`);
    }

    // 直接 pipe SSE 流给前端
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[Chat] Error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
