// app/api/generate/node/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { callMiniMaxWithSearch, parseJSONResponse } from '@/lib/minimax';
import { buildNodeContentPrompt } from '@/lib/prompt';
import { getUserProfile } from '@/lib/storage';

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
  const startTime = Date.now();
  console.log('[NodeContent] Starting at', new Date().toISOString());

  try {
    const { topic, title, cardCount } = await request.json();

    if (!topic || !title || !cardCount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const promptBuildStart = Date.now();
    const userProfile = getUserProfile();
    const insights = userProfile?.insights || null;
    const prompt = buildNodeContentPrompt(topic, title, cardCount, insights);
    console.log(`[NodeContent] Prompt built: ${Date.now() - promptBuildStart}ms`);

    const apiStart = Date.now();
    console.log('[NodeContent] Calling MiniMax API...');
    const content = await callMiniMaxWithSearch(prompt);
    console.log(`[NodeContent] MiniMax API: ${Date.now() - apiStart}ms`);
    console.log('[NodeContent] Raw response length:', content.length);
    console.log('[NodeContent] Raw response preview:', content.substring(0, 500));

    const parseStart = Date.now();
    const data = parseJSONResponse<NodeContentResponse>(content);
    console.log(`[NodeContent] Parse JSON: ${Date.now() - parseStart}ms`);

    console.log(`[NodeContent] Total: ${Date.now() - startTime}ms`);

    return NextResponse.json(data);
  } catch (error) {
    console.error(`[NodeContent] Error after ${Date.now() - startTime}ms:`, error);
    return NextResponse.json(
      { error: 'Failed to generate node content' },
      { status: 500 }
    );
  }
}