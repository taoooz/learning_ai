// lib/learning-v2/sse-client.ts
// V2 任务流解析：把 text/event-stream 字节流解析为 LearningSseEvent 序列
// 关键点：TextDecoder stream:true（中文多字节字符可能落在任意 chunk 边界）；
// 按 SSE 规范以空行分隔事件、累积 data: 行；[DONE] 终止；坏 JSON 跳过不中断流

import type { LearningSseEvent } from '@/types/learning-v2';

/**
 * 解析 SSE 响应体为事件异步迭代器。
 * 字节级透传 + 流式解码：中文在任意 chunk 边界被切开也能正确还原。
 */
export async function* parseLearningSseStream(
  response: Response,
): AsyncGenerator<LearningSseEvent> {
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode(); // flush 末尾残留的不完整字节
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      // 按空行切出完整事件块；最后一段可能不完整，留在 buffer
      let separatorIndex: number;
      while ((separatorIndex = findEventBoundary(buffer)) !== -1) {
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex).replace(/^(\r?\n){1,2}/, '');
        const event = parseSseEventBlock(rawEvent);
        if (event) yield event;
      }
    }

    // 流结束后处理可能残留的最后一个事件块（无尾部空行的情况）
    if (buffer.trim()) {
      const event = parseSseEventBlock(buffer);
      if (event) yield event;
    }
  } finally {
    reader.releaseLock();
  }
}

/** 找到第一个事件边界（空行）的位置；找不到返回 -1 */
function findEventBoundary(buffer: string): number {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

/**
 * 解析单个 SSE 事件块：累积所有 data: 行，跳过注释行（: 开头）。
 * data 为 [DONE] 或坏 JSON 时返回 null（坏 JSON 打 warn 便于排查上游）。
 */
function parseSseEventBlock(block: string): LearningSseEvent | null {
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(':')) continue; // SSE 注释/心跳
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (dataLines.length === 0) return null;

  const data = dataLines.join('\n');
  if (data === '[DONE]') return null;

  try {
    return JSON.parse(data) as LearningSseEvent;
  } catch (error) {
    console.warn('[sse-client] 跳过无法解析的 SSE data:', data.slice(0, 200), error);
    return null;
  }
}
