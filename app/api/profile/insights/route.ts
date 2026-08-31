// app/api/profile/insights/route.ts
import { NextRequest } from 'next/server';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';
import { buildProfileInsightPrompt } from '@/lib/prompt';
import { LearningInsight } from '@/types/course';
import { apiSuccess, apiError, requireAuth } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const profile = await request.json();
    const prompt = buildProfileInsightPrompt(profile);
    const content = await callMiniMax(prompt);
    const insights = parseJSONResponse<LearningInsight>(content);

    // 将洞察添加到 profile 中，由客户端负责持久化（服务端无法访问浏览器存储）
    const profileWithInsights = {
      ...profile,
      insights,
    };

    return apiSuccess(profileWithInsights);
  } catch (error) {
    console.error('Profile insights error:', error);
    return apiError('提取学习洞察失败', 500);
  }
}
