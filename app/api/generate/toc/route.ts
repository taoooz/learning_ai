import { NextRequest, NextResponse } from 'next/server';
import { buildTocPrompt } from '@/lib/prompt';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';

export async function POST(request: NextRequest) {
  try {
    const { blueprint } = await request.json();

    console.log('[TOC API] Received blueprint:', JSON.stringify(blueprint, null, 2));

    const prompt = buildTocPrompt(blueprint);
    console.log('[TOC API] Calling MiniMax...');

    const content = await callMiniMax(prompt);
    console.log('[TOC API] Received content length:', content.length);
    console.log('[TOC API] Content preview:', content.substring(0, 500));

    const result = parseJSONResponse(content);
    console.log('[TOC API] Parsed result:', JSON.stringify(result, null, 2));

    return NextResponse.json(result);
  } catch (error) {
    console.error('[TOC API] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'TOC generation failed',
        details: error instanceof Error ? error.stack : String(error),
      },
      { status: 500 }
    );
  }
}