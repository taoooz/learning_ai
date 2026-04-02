import { NextRequest, NextResponse } from 'next/server';
import { getUserMemoryStoreSnapshot } from '@/hooks/useUserMemory';

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;

export async function POST(request: NextRequest) {
  try {
    const { targetJob, existingTopics, insights, recentTopics } = await request.json();

    // 构建上下文
    const contextParts = [];
    
    if (targetJob) {
      contextParts.push(`目标职位：${targetJob}`);
    }
    
    if (existingTopics?.length > 0) {
      contextParts.push(`已学习主题：${existingTopics.join('、')}`);
    }
    
    if (insights?.length > 0) {
      contextParts.push(`学习洞察：${insights.slice(0, 3).join('；')}`);
    }
    
    if (recentTopics?.length > 0) {
      contextParts.push(`最近关注：${recentTopics.join('、')}`);
    }

    const prompt = `你是一个学习规划助手。基于以下信息，推荐5个适合的学习课程：

${contextParts.join('\n')}

要求：
1. 推荐5个课程，每个包含标题和推荐理由
2. 避免与已学习主题重复
3. 结合用户的学习洞察和关注点
4. 难度适中，循序渐进
5. 推荐理由简洁（20字内）

直接返回JSON格式，不要其他文字：
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
        temperature: 0.8,
        max_tokens: 1500,
        reply_constraints: {
          sender_type: 'BOT',
          sender_name: '学习助手',
        },
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
