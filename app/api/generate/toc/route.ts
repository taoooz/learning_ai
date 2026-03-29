import { NextRequest, NextResponse } from 'next/server';
import { buildTocPrompt } from '@/lib/prompt';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';

export async function POST(request: NextRequest) {
  const { blueprint } = await request.json();

  const prompt = buildTocPrompt(blueprint);
  const content = await callMiniMax(prompt);

  const result = parseJSONResponse(content);

  return NextResponse.json(result);
}
