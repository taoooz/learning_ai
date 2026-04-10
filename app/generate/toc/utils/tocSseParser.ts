export const NODE_FRAME_TYPES = ['what_why_how', 'total_split_total', 'step_by_step', 'case_review', 'problem_solution', 'comparative_analysis', 'timeline_evolution', 'exploration_deduction'] as const;

export type NodeFrameType = typeof NODE_FRAME_TYPES[number];

export type TocStreamNode = {
  index: number;
  title: string;
  description: string;
  frame?: NodeFrameType;
};

export type TocStreamResult = {
  courseName: string;
  courseDescription: string;
  nodes: TocStreamNode[];
};

export type TocSSEEvent =
  | { type: 'course_name'; value: string }
  | { type: 'course_description'; value: string }
  | { type: 'node'; node: TocStreamNode }
  | { type: 'complete'; result: TocStreamResult }
  | { type: 'error'; message: string };

export function parseTocSSELine(line: string): TocSSEEvent | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed === 'data: [DONE]' || trimmed === '[DONE]') return null;

  let data = trimmed;
  while (data.startsWith('data:')) {
    data = data.slice(5).trim();
  }

  if (!data || data === '[DONE]') return null;

  try {
    return JSON.parse(data) as TocSSEEvent;
  } catch {
    return null;
  }
}

export async function* parseTocSSEStream(response: Response): AsyncGenerator<TocSSEEvent> {
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    throw new Error('无法读取 TOC 流式响应');
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
        const event = parseTocSSELine(line);
        if (event) {
          yield event;
        }
      }
    }

    const trailingEvent = parseTocSSELine(buffer);
    if (trailingEvent) {
      yield trailingEvent;
    }
  } finally {
    reader.releaseLock();
  }
}
