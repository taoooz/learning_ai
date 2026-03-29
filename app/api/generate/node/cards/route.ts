import { NextRequest, NextResponse } from 'next/server';
import { buildCardsPrompt } from '@/lib/prompt';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';
import type { LearningCard } from '@/types/course';

export async function POST(request: NextRequest) {
  const { topic, nodeInfo, learnerBackground, prevNodeSummary, nextNodeSummary } = await request.json();

  const prompt = buildCardsPrompt(topic, nodeInfo, learnerBackground, prevNodeSummary, nextNodeSummary);
  const content = await callMiniMax(prompt);

  const result = parseJSONResponse<{ cards: LearningCard[] }>(content);

  return NextResponse.json(result);
}
