/**
 * SSE 事件解析工具
 */

export type SSEEvent =
  | { type: 'thinking'; message: string }
  | { type: 'content_delta'; content: string }
  | { type: 'question_start'; questionNumber: number }
  | { type: 'questions'; sessionId?: string; questions: Array<{ id: string; question: string; options: string[] }> }
  | { type: 'blueprint_start' }
  | { type: 'blueprint_field'; field: string; value: any }
  | { type: 'confirmation'; sessionId?: string; blueprint: any }
  | { type: 'session_created'; sessionId: string }
  | { type: 'error'; message: string }
  | { type: 'complete'; result: any }
  | { type: 'course_name'; value: string }
  | { type: 'course_description'; value: string }
  | { type: 'node'; node: { index: number; title: string; description: string } };

/**
 * 解析 SSE 数据行
 */
export function parseSSELine(line: string): SSEEvent | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed === 'data: [DONE]' || trimmed === '[DONE]') return null;

  let data = trimmed;
  while (data.startsWith('data:')) {
    data = data.slice(5).trim();
  }

  if (!data || data === '[DONE]') return null;

  try {
    return JSON.parse(data) as SSEEvent;
  } catch (e) {
    console.warn('[SSE Parser] Failed to parse:', data.substring(0, 100));
    return null;
  }
}

/**
 * 处理 SSE 流式响应
 */
export async function* parseSSEStream(response: Response): AsyncGenerator<SSEEvent> {
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  
  if (!reader) {
    throw new Error('无法读取流式响应');
  }

  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const event = parseSSELine(line);
        if (event) {
          yield event;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
