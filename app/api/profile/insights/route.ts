// app/api/profile/insights/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';
import { buildProfileInsightPrompt } from '@/lib/prompt';
import { getUserProfile, saveUserProfile } from '@/lib/storage';
import { LearningInsight } from '@/types/course';

export async function POST(request: NextRequest) {
  try {
    const profile = await request.json();
    const prompt = buildProfileInsightPrompt(profile);
    const content = await callMiniMax(prompt);
    const insights = parseJSONResponse<LearningInsight>(content);

    // 更新 storage 中的 profile
    const currentProfile = getUserProfile();
    if (currentProfile) {
      currentProfile.insights = insights;
      saveUserProfile(currentProfile);
      return NextResponse.json(currentProfile);
    }

    return NextResponse.json({ insights });
  } catch (error) {
    console.error('Profile insights error:', error);
    return NextResponse.json(
      { error: 'Failed to extract insights' },
      { status: 500 }
    );
  }
}
