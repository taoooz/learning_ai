import { NextRequest, NextResponse } from 'next/server';
import { createMemoryRepository } from '@/lib/memory/repository';
import { buildOutlinePrompt } from '@/lib/prompt';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';

export async function POST(request: NextRequest) {
  const { topic, userProfile, userMemory, clarificationAnswers, userMessage } = await request.json();

  const memoryRepository = createMemoryRepository({
    initialMemory: userMemory,
    getProfile: () => userProfile || null,
  });

  const planningPayload = memoryRepository.getPlanningPayload(topic);

  const prompt = buildOutlinePrompt(topic, userProfile, planningPayload, {
    clarificationAnswers,
    userMessage,
  });

  const content = await callMiniMax(prompt);
  const result = parseJSONResponse(content);

  return NextResponse.json(result);
}
