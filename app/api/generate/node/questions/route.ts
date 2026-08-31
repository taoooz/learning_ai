import { NextRequest } from 'next/server';
import { callPythonAgent } from '@/lib/python-agent';
import { apiSuccess, apiError, requireAuth } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const { topic, nodeInfo, cards, userProfile } = await request.json();

    // 用户画像中的工作/教育经历汇总为简洁背景描述，供练习题个性化使用
    const workBackground = Array.isArray(userProfile?.workExperience)
      ? userProfile.workExperience
          .map((w: { company?: string; position?: string }) =>
            [w?.company, w?.position].filter(Boolean).join(' ')
          )
          .filter(Boolean)
          .join('；')
      : '';
    const educationBackground = Array.isArray(userProfile?.education)
      ? userProfile.education
          .map((e: { school?: string; major?: string }) =>
            [e?.school, e?.major].filter(Boolean).join(' ')
          )
          .filter(Boolean)
          .join('；')
      : '';

    const data = await callPythonAgent('/api/agents/questions/generate_agent', {
      topic: topic || '',
      cards: cards || [],
      payload: {
        nodeTitle: nodeInfo?.title || '',
        teachingGoal: nodeInfo?.teachingGoal || '',
        courseName: nodeInfo?.courseName || topic || '',
        estimatedLevel: nodeInfo?.estimatedLevel || 'beginner',
        skipBasics: nodeInfo?.skipBasics || [],
        workBackground,
        educationBackground,
      },
    });

    return apiSuccess(data);
  } catch (error) {
    console.error('[Questions Agent proxy] Error:', error);
    return apiError(error instanceof Error ? error.message : '题目生成失败', 500);
  }
}
