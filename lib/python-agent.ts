// lib/python-agent.ts
// Python Agent 服务统一代理调用

import { PYTHON_AGENT_URL } from './agent-config';

export class PythonAgentError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PythonAgentError';
  }
}

/**
 * 调用 Python Agent 服务
 * @param path - API 路径，如 '/api/agents/cards/generate_agent'
 * @param body - 请求体
 * @returns 解析后的 JSON 响应
 */
export async function callPythonAgent<T = unknown>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${PYTHON_AGENT_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new PythonAgentError(
      response.status,
      `Python Agent error: ${response.status}`,
    );
  }

  return response.json() as Promise<T>;
}

/**
 * 调用 Python Agent 的 SSE 流式接口，提取最终 complete 事件的结果
 */
export async function callPythonAgentSSE<T = unknown>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${PYTHON_AGENT_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new PythonAgentError(
      response.status,
      `Python Agent error: ${response.status}`,
    );
  }

  const text = await response.text();
  const lines = text.split('\n');

  let result: T | null = null;

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (data === '[DONE]') continue;

    try {
      const event = JSON.parse(data);
      if (event.type === 'complete' && event.result) {
        result = event.result as T;
      }
    } catch {
      // 跳过无法解析的行
    }
  }

  if (!result) {
    throw new Error('Python Agent SSE 未返回完整结果');
  }

  return result;
}
