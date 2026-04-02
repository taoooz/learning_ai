import { NextRequest, NextResponse } from 'next/server';

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
const MINIMAX_GROUP_ID = process.env.MINIMAX_GROUP_ID;

export async function POST(request: NextRequest) {
  try {
    const { targetJob, existingTopics } = await request.json();

    const prompt = `你是一个学习规划助手。基于以下信息，推荐5个适合的学习课程：

目标职位：${targetJob || '技术岗位'}
已学习主题：${existingTopics?.length > 0 ? existingTopics.join('、') : '无'}

要求：
1. 推荐5个课程，每个包含标题和推荐理由
2. 避免与已学习主题重复
3. 难度适中，循序渐进
4. 推荐理由简洁（15字内）

返回JSON格式：
{
  "recommendations": [
    {"title": "课程标题", "reason": "推荐理由"}
  ]
}`;

    const response = await fetch('https://api.minimaxi.com/v1/text/chatcompletion_v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINIMAX_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'abab6.5s-chat',
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      throw new Error('MiniMax API failed');
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    
    // 解析 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { recommendations: [] };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Recommendations API error:', error);
    
    // 降级：返回默认推荐
    return NextResponse.json({
      recommendations: [
        { title: 'AI 产品经理入门', reason: '适合想转型 AI 领域的产品经理' },
        { title: 'Python 数据分析基础', reason: '掌握数据分析的基本技能' },
        { title: 'LLM 应用开发实战', reason: '学习如何开发 AI 应用' },
        { title: '提示词工程进阶', reason: '提升与 AI 交互的效率' },
        { title: 'Agent 技术原理', reason: '深入理解 AI Agent 的工作机制' },
      ],
    });
  }
}
