// lib/agent-config.ts
// Python Agent 服务配置与 BFF → Agent 的服务间认证

export const PYTHON_AGENT_URL = process.env.PYTHON_AGENT_URL || 'http://localhost:8000';
export const PYTHON_INTERNAL_TOKEN_HEADER = 'X-Internal-Token';

/**
 * 统一构造转发到 Python Agent 的请求头。
 * 配置 PYTHON_INTERNAL_TOKEN 后，所有 BFF 请求都携带服务间凭证；
 * Python Agent 会拒绝缺少该令牌的外部 API 调用。
 */
export function pythonAgentHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  const token = process.env.PYTHON_INTERNAL_TOKEN;
  return {
    'Content-Type': 'application/json',
    ...(token ? { [PYTHON_INTERNAL_TOKEN_HEADER]: token } : {}),
    ...extra,
  };
}
