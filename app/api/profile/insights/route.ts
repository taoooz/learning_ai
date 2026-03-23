// app/api/profile/insights/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';
import { buildProfileInsightPrompt } from '@/lib/prompt';
import { saveUserProfile } from '@/lib/storage';
import { LearningInsight } from '@/types/course';

export async function POST(request: NextRequest) {
  try {
    const profile = await request.json();
    const prompt = buildProfileInsightPrompt(profile);
    const content = await callMiniMax(prompt);
    const insights = parseJSONResponse<LearningInsight>(content);

    // 将洞察添加到 profile 中并保存
    const profileWithInsights = {
      ...profile,
      insights,
    };
    saveUserProfile(profileWithInsights);

    return NextResponse.json(profileWithInsights);
  } catch (error) {
    console.error('Profile insights error:', error);
    return NextResponse.json(
      { error: 'Failed to extract insights' },
      { status: 500 }
    );
  }
}
