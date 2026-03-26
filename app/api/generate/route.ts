// app/api/generate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { callMiniMaxWithSearch, parseJSONResponse } from '@/lib/minimax';
import { createMemoryRepository } from '@/lib/memory/repository';
import { buildCourseTreePrompt } from '@/lib/prompt';
import { ClarificationAnswer, ClarificationQuestion, CourseTreeResponse, MemoryStoreV2, UserMemory, UserProfile } from '@/types/course';

// ClarificationAPIResponse 是内部使用的类型，用于解析 API 返回的澄清问题响应
interface ClarificationAPIResponse {
  questions: ClarificationQuestion[];
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log('[CourseTree] Starting at', new Date().toISOString());

  try {
    const {
      topic,
      clarificationAnswers,
      userProfile,
      userMemory,
    } = await request.json() as {
      topic: string;
      clarificationAnswers?: ClarificationAnswer[];
      userProfile?: UserProfile | null;
      userMemory?: UserMemory | MemoryStoreV2 | null;
    };

    if (!topic || typeof topic !== 'string') {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 });
    }

    // validation: clarificationAnswers should be an array if provided
    if (clarificationAnswers !== undefined && !Array.isArray(clarificationAnswers)) {
      return NextResponse.json({ error: 'clarificationAnswers must be an array' }, { status: 400 });
    }

    const promptBuildStart = Date.now();
    const memoryRepository = createMemoryRepository({
      initialMemory: userMemory,
      getProfile: () => userProfile || null,
    });
    const planningPayload = memoryRepository.getPlanningPayload(topic);
    const prompt = buildCourseTreePrompt(
      topic,
      userProfile,
      clarificationAnswers,
      userMemory && !('signals' in userMemory) ? userMemory : null,
      undefined,
      undefined,
      planningPayload,
    );
    console.log(`[CourseTree] Prompt built: ${Date.now() - promptBuildStart}ms`);

    const apiStart = Date.now();
    console.log('[CourseTree] Calling MiniMax API...');
    const content = await callMiniMaxWithSearch(prompt);
    console.log(`[CourseTree] MiniMax API: ${Date.now() - apiStart}ms`);

    const parseStart = Date.now();

    // 尝试解析为课程响应
    try {
      const course = parseJSONResponse<CourseTreeResponse>(content);

      // 如果有 questions 字段，说明需要澄清
      if ('questions' in course && Array.isArray(course.questions)) {
        console.log('[CourseTree] Clarification needed, returning questions');
        return NextResponse.json({ questions: course.questions });
      }

      // 否则是完整的课程
      console.log(`[CourseTree] Parse JSON: ${Date.now() - parseStart}ms`);
      console.log(`[CourseTree] Total: ${Date.now() - startTime}ms`);
      return NextResponse.json(course);
    } catch {
      // 解析失败，尝试作为澄清响应
      const clarificationResponse = parseJSONResponse<ClarificationAPIResponse>(content);
      if ('questions' in clarificationResponse) {
        console.log('[CourseTree] Clarification needed, returning questions');
        return NextResponse.json({ questions: clarificationResponse.questions });
      }
      throw new Error('Invalid response format');
    }
  } catch (error) {
    console.error(`[CourseTree] Error after ${Date.now() - startTime}ms:`, error);
    return NextResponse.json(
      { error: 'Failed to generate course' },
      { status: 500 }
    );
  }
}
