// app/api/generate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';
import { buildCourseTreePrompt } from '@/lib/prompt';
import { CourseTree } from '@/types/course';
import { getUserProfile } from '@/lib/storage';

export async function POST(request: NextRequest) {
  try {
    const { topic } = await request.json();

    if (!topic || typeof topic !== 'string') {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 });
    }

    // 获取用户画像
    const userProfile = getUserProfile();

    const prompt = buildCourseTreePrompt(topic, userProfile);
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