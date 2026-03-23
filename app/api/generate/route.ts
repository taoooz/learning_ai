// app/api/generate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';
import { buildCourseTreePrompt } from '@/lib/prompt';
import { CourseTree } from '@/types/course';
import { getUserProfile } from '@/lib/storage';

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log('[CourseTree] Starting at', new Date().toISOString());

  try {
    const { topic } = await request.json();

    if (!topic || typeof topic !== 'string') {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 });
    }

    const promptBuildStart = Date.now();
    const userProfile = getUserProfile();
    const prompt = buildCourseTreePrompt(topic, userProfile);
    console.log(`[CourseTree] Prompt built: ${Date.now() - promptBuildStart}ms`);

    const apiStart = Date.now();
    console.log('[CourseTree] Calling MiniMax API...');
    const content = await callMiniMax(prompt);
    console.log(`[CourseTree] MiniMax API: ${Date.now() - apiStart}ms`);

    const parseStart = Date.now();
    const course = parseJSONResponse<CourseTree>(content);
    console.log(`[CourseTree] Parse JSON: ${Date.now() - parseStart}ms`);

    console.log(`[CourseTree] Total: ${Date.now() - startTime}ms`);

    return NextResponse.json(course);
  } catch (error) {
    console.error(`[CourseTree] Error after ${Date.now() - startTime}ms:`, error);
    return NextResponse.json(
      { error: 'Failed to generate course' },
      { status: 500 }
    );
  }
}