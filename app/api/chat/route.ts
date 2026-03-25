// app/api/chat/route.ts
import { NextRequest } from 'next/server';
import { callMiniMaxChatStream } from '@/lib/minimax';
import { buildChatContext } from '@/lib/chat-context';
import { CourseNode, UserMemory } from '@/types/course';
import { ChatMessage } from '@/types/chat';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const { course, messages, userMemory } = await request.json() as {
      course: CourseNode;
      messages: ChatMessage[];
      userMemory: UserMemory;
    };

    if (!course || !messages || !userMemory) {
      return new Response('Missing required fields', { status: 400 });
    }

    // 构建上下文
    const context = buildChatContext(course, userMemory, messages);

    // 构建 AI 消息
    const aiMessages = [
      { role: 'system' as const, content: context },
      ...messages.map(m => ({ role: m.role, content: m.content }))
    ];

    // 流式返回
    return callMiniMaxChatStream(aiMessages);
  } catch (error) {
    console.error('[Chat] Error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}