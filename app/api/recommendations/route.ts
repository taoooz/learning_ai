import { NextRequest, NextResponse } from 'next/server';
import { getUserMemoryStoreSnapshot } from '@/hooks/useUserMemory';

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;

export async function POST(request: NextRequest) {
  try {
    const { targetJob, existingTopics, insights, recentTopics, previousRecommendations } = await request.json();

    // 构建上下文
    const contextParts = [];
    
    if (targetJob) {
      contextParts.push(`**目标职位**：${targetJob}`);
    }
    
    if (insights?.length > 0) {
      contextParts.push(`**背景洞察**：${insights.slice(0, 3).join('；')}`);
    }
    
    if (existingTopics?.length > 0) {
      contextParts.push(`**已学习课程**：${existingTopics.join('、')}`);
    }
    
    if (recentTopics?.length > 0) {
      contextParts.push(`**最近关注**：${recentTopics.join('、')}`);
    }
    
    if (previousRecommendations?.length > 0) {
      contextParts.push(`**已推荐过**：${previousRecommendations.join('、')}`);
    }

    const prompt = `你是一位资深学习规划师。请基于用户信息，推荐5个高质量的学习课程。

## 用户信息
${contextParts.join('\n')}

## 推荐要求
1. **针对性强**：紧密结合用户的目标职位和背景洞察
2. **避免重复**：不要推荐已学习或已推荐过的课程
3. **循序渐进**：从基础到进阶，形成学习路径
4. **实用性高**：优先推荐对目标职位有直接帮助的课程
5. **标题具体**：课程标题要具体明确，不要太宽泛
6. **理由清晰**：推荐理由要说明为什么适合这个用户（15-20字）

## 输出格式
直接返回JSON，不要任何其他文字：
{
  "recommendations": [
    {"title": "具体的课程标题", "reason": "为什么适合用户的理由"}
  ]
}`;

    const response = await fetch('https://api.minimaxi.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINIMAX_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'MiniMax-M2.7',
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.9,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('MiniMax API error:', errorText);
      throw new Error('MiniMax API failed');
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    console.log('MiniMax response:', content);
    
    // 尝试多种方式解析 JSON
    let result;
    try {
      // 方式1：直接解析
      result = JSON.parse(content);
    } catch {
      try {
        // 方式2：提取 JSON 块
        const jsonMatch = content.match(/\{[\s\S]*"recommendations"[\s\S]*\}/);
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[0]);
        }
      } catch {
        // 方式3：提取数组
        const arrayMatch = content.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          result = { recommendations: JSON.parse(arrayMatch[0]) };
        }
      }
    }

    if (!result?.recommendations || result.recommendations.length === 0) {
      throw new Error('No recommendations generated');
    }

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
