// app/api/generate/node/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';
import { buildNodeContentPrompt } from '@/lib/prompt';

interface NodeContentResponse {
  cards: Array<{
    id: string;
    title: string;
    content: string;
    imageUrl: string | null;
  }>;
  questions: Array<{
    id: string;
    type: 'single' | 'multiple' | 'fill';
    question: string;
    options?: string[];
    answer: string | string[];
    explanation: string;
  }>;
}

export async function POST(request: NextRequest) {
  try {
    const { topic, title, cardCount } = await request.json();

    if (!topic || !title || !cardCount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const prompt = buildNodeContentPrompt(topic, title, cardCount);
    const content = await callMiniMax(prompt);
    const data = parseJSONResponse<NodeContentResponse>(content);

    return NextResponse.json(data);
  } catch (error) {
    console.error('Node content generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate node content' },
      { status: 500 }
    );
  }
}