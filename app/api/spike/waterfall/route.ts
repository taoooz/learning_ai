// app/api/spike/waterfall/route.ts
// 【一次性 Spike】瀑布流学习手感验证，验证结论回填 V2 方案后即可删除
// 不引入 V2 协议：mode=plan 返回极简任务骨架 JSON；mode=task 直连 LLM 流式输出单任务 markdown
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-response';
import { DEFAULT_LLM_API_BASE, DEFAULT_LLM_MODEL, parseJSONResponse } from '@/lib/minimax';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SpikeTask {
  title: string;
  goal: string;
}

function getLlmConfig() {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) throw new Error('LLM_API_KEY is not set');
  return {
    apiKey,
    baseUrl: process.env.LLM_API_BASE || DEFAULT_LLM_API_BASE,
    model: process.env.LLM_MODEL || DEFAULT_LLM_MODEL,
  };
}

function buildPlanPrompt(topic: string): string {
  return `你是一名课程设计师。用户想学习「${topic}」。
请把该主题的第一章拆成 4 个连续的短学习任务，每个任务 1～3 分钟能讲完，只承担一个学习目标，由浅入深衔接。

只输出 JSON，不要任何其他文字：
{"tasks":[{"title":"任务标题（12字内）","goal":"该任务要让用户理解/会做什么（一句话）"}]}`;
}

function buildTaskPrompt(
  topic: string,
  task: SpikeTask,
  index: number,
  total: number,
  previousTitles: string[],
): string {
  const context = previousTitles.length
    ? `此前已讲完的任务：${previousTitles.join('、')}。不要重复其中内容，自然衔接即可。`
    : '这是本章第一个任务，用一两句话快速建立动机，不要冗长的课程介绍。';
  return `你是一名 AI 老师，正在用"瀑布流"方式给用户上课：内容一小节一小节向下追加，每节结束后用户点"继续"才讲下一节。

课程主题：${topic}
当前任务（第 ${index + 1}/${total} 节）：${task.title}
本节目标：${task.goal}
${context}

要求：
- 只讲当前任务，不要预讲后面的内容
- 中文 markdown，300～500 字，可用小标题、列表、加粗，新术语首次出现要解释
- 结尾给出一条可带走的要点（用引用块 > 表示）
- 直接输出正文，不要重复任务标题`;
}

// 解析上游 OpenAI 兼容 SSE，只透传 content 增量为纯文本流
function streamLlmContent(upstream: Response): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';

  return new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // 行缓冲解析，处理跨 chunk 的事件
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) controller.enqueue(encoder.encode(delta));
            } catch {
              // 忽略不完整/非 JSON 行
            }
          }
        }
      } finally {
        controller.close();
        reader.releaseLock();
      }
    },
  });
}

export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json();
    const { apiKey, baseUrl, model } = getLlmConfig();

    if (body.mode === 'plan') {
      if (!body.topic) return new Response('Missing topic', { status: 400 });
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: buildPlanPrompt(body.topic) }],
          max_tokens: 800,
        }),
      });
      if (!response.ok) throw new Error(`LLM API error: ${response.status}`);
      const data = await response.json();
      const plan = parseJSONResponse<{ tasks: SpikeTask[] }>(data.choices[0].message.content);
      if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
        throw new Error('Plan 结构无效');
      }
      return Response.json(plan);
    }

    if (body.mode === 'task') {
      const { topic, task, index, total, previousTitles } = body;
      if (!topic || !task?.title || typeof index !== 'number' || typeof total !== 'number') {
        return new Response('Missing task fields', { status: 400 });
      }
      const upstream = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          stream: true,
          messages: [
            {
              role: 'user',
              content: buildTaskPrompt(topic, task, index, total, previousTitles ?? []),
            },
          ],
          max_tokens: 1500,
        }),
      });
      if (!upstream.ok || !upstream.body) {
        throw new Error(`LLM API error: ${upstream.status}`);
      }
      return new Response(streamLlmContent(upstream), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      });
    }

    return new Response('Unknown mode', { status: 400 });
  } catch (error) {
    console.error('[Spike Waterfall] Error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
