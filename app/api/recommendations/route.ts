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

    const prompt = `你是一位面向职场人的学习规划师。请基于用户信息，推荐5个具体、务实的学习主题。

## 用户信息
${contextParts.join('\n') || '暂无'}

## 推荐要求
1. **直接可用**：每个主题就是一个用户可以直接输入的"想学什么"描述，不需要再加工
2. **具体务实**：避免"XX入门""XX基础"这种泛泛的主题。要说出学什么、解决什么具体问题。比如不要写"提示词工程进阶"，而要写"如何用提示词让 AI 稳定输出结构化 JSON 数据"
3. **贴合目标**：紧紧围绕用户的目标职位，想象这个岗位的人在实际工作中会遇到什么知识盲区
4. **避免重复**：不要和已学习/已推荐的主题重复
5. **范围明确**：主题控制在 2-3 个核心知识点的范围，不要贪大求全
6. **理由一句话**：说清楚学这个主题能解决什么具体问题（10-20字）

## 输出格式
直接返回JSON，不要任何其他文字：
{
  "recommendations": [
    {"title": "具体的学习主题描述（15-30字）", "reason": "为什么适合这个用户，解决什么问题（10-20字）"}
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
        { title: 'AI Agent 的能力边界：哪些场景该用、哪些不该用', reason: '帮你建立 Agent 落地判断力' },
        { title: '如何评估 AI 功能的产品价值和 ROI', reason: '用数据说话，别靠感觉做 AI 产品决策' },
        { title: 'RAG 在企业知识管理中的实战应用', reason: '企业落地最主流的 AI 应用模式' },
        { title: 'LLM 输出不稳定的工程化解决方案', reason: '从原型到产品的关键一步' },
        { title: '如何给业务团队设计 AI 提示词模板', reason: '让非技术人员也能用好 AI' },
      ],
    });
  }
}
