import type { PromptLabSSEEvent } from '@/types/prompt-lab';

function parseLine(line: string): PromptLabSSEEvent | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed === 'data: [DONE]' || trimmed === '[DONE]') return null;
  let data = trimmed;
  while (data.startsWith('data:')) data = data.slice(5).trim();
  if (!data || data === '[DONE]') return null;
  try {
    return JSON.parse(data) as PromptLabSSEEvent;
  } catch {
    return null;
  }
}

export async function* parsePromptLabSSE(response: Response): AsyncGenerator<PromptLabSSEEvent> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取 Prompt Lab 流式响应');
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const event = parseLine(line);
        if (event) yield event;
      }
    }
    const trailing = parseLine(buffer);
    if (trailing) yield trailing;
  } finally {
    reader.releaseLock();
  }
}
