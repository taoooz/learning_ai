import { NextRequest, NextResponse } from 'next/server';
import { buildQuestionsPrompt } from '@/lib/prompt';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';
import type { Question } from '@/types/course';

export async function POST(request: NextRequest) {
  try {
    const { topic, nodeInfo, cards } = await request.json();

    console.log('[Questions API] topic:', topic, 'cards count:', cards?.length);

    const prompt = buildQuestionsPrompt(topic, nodeInfo, cards);
    const content = await callMiniMax(prompt);

    console.log('[Questions API] Raw response length:', content.length);

    const result = parseJSONResponse<{ questions: Question[] }>(content);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Questions API] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Questions generation failed',
      },
      { status: 500 }
    );
  }
}
