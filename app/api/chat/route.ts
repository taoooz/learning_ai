// app/api/chat/route.ts
import { NextRequest } from 'next/server';
import { callMiniMaxChatStream } from '@/lib/minimax';
import { buildChatContext } from '@/lib/chat-context';
import { createMemoryRepository } from '@/lib/memory/repository';
import type { ChatMessage } from '@/types/chat';
import type { ConversationSummary, CourseTree, MemoryStoreV2, MemoryStoreV3, UserMemory } from '@/types/course';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const { course, messages, contextInfo, conversationSummary } = await request.json() as {
      course: {
        topic: string;
        difficultySummary?: string;
      };
      messages: ChatMessage[];
      contextInfo?: {
        currentNodeTitle?: string;
        currentNodeGoal?: string;
        questionContext?: {
          type: 'correct' | 'incorrect';
          question: string;
          correctAnswer: string;
          userAnswer?: string;
          options?: string[];
        };
      };
      conversationSummary?: ConversationSummary;
    };

    if (!course || !messages) {
      return new Response('Missing required fields', { status: 400 });
    }

    console.log('[Chat API] Received questionContext:', contextInfo?.questionContext);

    // 构建上下文时传入摘要
    const memoryRepository = createMemoryRepository();
    const chatMemoryPayload = memoryRepository.getChatPayload({
      topic: course.topic,
      currentNodeTitle: contextInfo?.currentNodeTitle,
    });

    const context = buildChatContext(course, messages, contextInfo, conversationSummary, chatMemoryPayload);

    console.log('[Chat API] Built context with questionContext:', contextInfo?.questionContext ? 'YES' : 'NO');
    console.log('[Chat API] Context preview:', context.substring(0, 500));

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
