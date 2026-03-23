// app/api/generate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';
import { buildCourseTreePrompt } from '@/lib/prompt';
import { CourseTree } from '@/types/course';

export async function POST(request: NextRequest) {
  try {
    const { topic } = await request.json();

    if (!topic || typeof topic !== 'string') {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 });
    }

    const prompt = buildCourseTreePrompt(topic);
    const content = await callMiniMax(prompt);
    const course = parseJSONResponse<CourseTree>(content);

    return NextResponse.json(course);
  } catch (error) {
    console.error('Course generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate course' },
      { status: 500 }
    );
  }
}