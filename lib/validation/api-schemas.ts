// lib/validation/api-schemas.ts — API 请求体验证

function requireObject(body: unknown, name = 'request body'): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(`Invalid ${name}`);
  }
  return body as Record<string, unknown>;
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const val = obj[key];
  if (typeof val !== 'string' || !val.trim()) throw new Error(`Missing ${key}`);
  return val;
}

export function validateOutlineRequest(body: unknown) {
  const b = requireObject(body);
  return {
    topic: requireString(b, 'topic'),
    userProfile: b.userProfile ?? null,
    userMemory: b.userMemory ?? null,
    userMessage: typeof b.userMessage === 'string' ? b.userMessage : undefined,
    sessionId: typeof b.sessionId === 'string' ? b.sessionId : undefined,
  };
}

export function validateTocRequest(body: unknown) {
  const b = requireObject(body);
  if (!b.blueprint) throw new Error('Missing blueprint');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { blueprint: b.blueprint as any, userMemory: (b.userMemory ?? null) as any };
}

export function validateCardsRequest(body: unknown) {
  const b = requireObject(body);
  return {
    topic: requireString(b, 'topic'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nodeInfo: (b.nodeInfo ?? (() => { throw new Error('Missing nodeInfo'); })()) as any,
    learnerBackground: b.learnerBackground ?? null,
    prevNodeSummary: b.prevNodeSummary ?? undefined,
    nextNodeSummary: b.nextNodeSummary ?? undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    userMemory: (b.userMemory ?? null) as any,
  };
}

export function validateQuestionsRequest(body: unknown) {
  const b = requireObject(body);
  if (!Array.isArray(b.cards)) throw new Error('Missing cards');
  return {
    topic: requireString(b, 'topic'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nodeInfo: (b.nodeInfo ?? (() => { throw new Error('Missing nodeInfo'); })()) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cards: b.cards as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    userMemory: (b.userMemory ?? null) as any,
  };
}
