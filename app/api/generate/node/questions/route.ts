import { NextRequest, NextResponse } from 'next/server';
import { buildQuestionsPrompt } from '@/lib/prompt';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';
import type { Question } from '@/types/course';

export async function POST(request: NextRequest) {
  const { topic, nodeInfo, cards } = await request.json();

  const prompt = buildQuestionsPrompt(topic, nodeInfo, cards);
  const content = await callMiniMax(prompt);

  const result = parseJSONResponse<{ questions: Question[] }>(content);

  return NextResponse.json(result);
}
