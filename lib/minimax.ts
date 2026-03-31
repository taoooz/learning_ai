// lib/minimax.ts

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildSearchResultsSection, buildPageFetchSection } from './prompt';

export interface MiniMaxCallOptions {
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface SearchNeededResponse {
  needsSearch: true;
  searchQueries: string[];
}

export interface PageFetchNeededResponse {
  needsPageFetch: true;
  urls: string[];
}

export function isSearchNeededResponse(content: string): boolean {
  try {
    const parsed = parseJSONResponse<{ needsSearch?: boolean }>(content);
    return parsed.needsSearch === true;
  } catch {
    return false;
  }
}

export function isPageFetchNeededResponse(content: string): boolean {
  try {
    const parsed = parseJSONResponse<{ needsPageFetch?: boolean }>(content);
    return parsed.needsPageFetch === true;
  } catch {
    return false;
  }
}

export function extractSearchQueries(content: string): string[] {
  try {
    const parsed = parseJSONResponse<SearchNeededResponse>(content);
    return parsed.searchQueries || [];
  } catch {
    return [];
  }
}

export function extractPageUrls(content: string): string[] {
  try {
    const parsed = parseJSONResponse<PageFetchNeededResponse>(content);
    return parsed.urls || [];
  } catch {
    return [];
  }
}

let cachedApiKeyFromFile: string | null | undefined;

function readApiKeyFromEnvFile(): string | null {
  if (cachedApiKeyFromFile !== undefined) {
    return cachedApiKeyFromFile;
  }

  try {
    const envFilePath = process.env.MINIMAX_ENV_FILE || join(process.cwd(), '.env.local');
    if (!existsSync(envFilePath)) {
      cachedApiKeyFromFile = null;
      return cachedApiKeyFromFile;
    }

    const envText = readFileSync(envFilePath, 'utf8');
    const match = envText.match(/(?:^|\n)\s*MINIMAX_API_KEY\s*=\s*(.+)\s*(?:\n|$)/);
    cachedApiKeyFromFile = match?.[1]?.trim().replace(/^['"]|['"]$/g, '') || null;
    return cachedApiKeyFromFile;
  } catch {
    cachedApiKeyFromFile = null;
    return cachedApiKeyFromFile;
  }
}

function getMiniMaxApiKey(): string | null {
  return process.env.MINIMAX_API_KEY || readApiKeyFromEnvFile();
}

export async function callMiniMaxChatStream(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  maxTokens: number = 1500
): Promise<Response> {
  const apiKey = getMiniMaxApiKey();

  if (!apiKey) {
    throw new Error('MINIMAX_API_KEY is not set');
  }

  const response = await fetch('https://api.minimaxi.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'MiniMax-M2.7',
      messages,
      stream: true,
      max_tokens: maxTokens,
      reasoning_split: true,  // 将思考过程分离到 delta.reasoning_details
    }),
  });

  if (!response.ok) {
    throw new Error(`MiniMax API error: ${response.status}`);
  }

  // 返回 SSE 流
  return new Response(response.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

export async function callMiniMax(prompt: string, options: MiniMaxCallOptions = {}): Promise<string> {
  const apiKey = getMiniMaxApiKey();

  if (!apiKey) {
    throw new Error('MINIMAX_API_KEY is not set');
  }

  const response = await fetch('https://api.minimaxi.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    signal: options.signal,
    body: JSON.stringify({
      model: 'MiniMax-M2.7',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      reasoning_split: true,
      ...(typeof options.maxTokens === 'number'
        ? {
          max_tokens: options.maxTokens,
          max_completion_tokens: options.maxTokens,
        }
        : {}),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MiniMax API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  if (!data.choices || data.choices.length === 0) {
    throw new Error('No response from MiniMax');
  }

  const content = data.choices[0].message.content;
  if (!content || typeof content !== 'string') {
    throw new Error('MiniMax returned empty or non-string content');
  }

  return content;
}

export function parseJSONResponse<T>(content: string): T {
  // Pre-processing: Extract from markdown code blocks if present
  let extractedContent = content
    .replace(/^```json\s*/i, '')  // Remove opening ```json
    .replace(/\s*```$/, '');      // Remove closing ```

  // Find the first opening brace
  const firstBrace = extractedContent.indexOf('{');
  if (firstBrace === -1) {
    throw new Error('No JSON found in response');
  }

  // Strategy 1: Try direct JSON.parse on content after first brace
  try {
    const jsonContent = extractedContent.substring(firstBrace).trim();
    if (jsonContent.startsWith('{')) {
      return JSON.parse(jsonContent) as T;
    }
  } catch {
    // Continue to next strategy
  }

  // Strategy 2: Brace matching with proper string/escape handling
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let endIndex = -1;

  for (let i = firstBrace; i < extractedContent.length; i++) {
    const char = extractedContent[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          endIndex = i;
          break;
        }
      }
    }
  }

  if (endIndex !== -1) {
    const jsonStr = extractedContent.substring(firstBrace, endIndex + 1).trim();
    try {
      return JSON.parse(jsonStr) as T;
    } catch {
      // Fall through to strategy 3
    }
  }

  // Strategy 3: Find largest valid JSON by progressive testing
  let lastValidJson: T | null = null;
  let lastValidEnd = -1;

  for (let i = firstBrace + 1; i < extractedContent.length; i++) {
    if (extractedContent[i] === '}') {
      const tryStr = extractedContent.substring(firstBrace, i + 1);
      try {
        const parsed = JSON.parse(tryStr) as T;
        lastValidJson = parsed;
        lastValidEnd = i;
      } catch {
        // If we found a valid JSON before this point, use it
        if (lastValidEnd !== -1) {
          return lastValidJson as T;
        }
        // Continue trying to find a valid ending
      }
    }
  }

  // If we found any valid JSON, return it
  if (lastValidJson !== null) {
    return lastValidJson;
  }

  throw new Error(`Invalid JSON: ${extractedContent.substring(firstBrace, firstBrace + 200)}`);
}

export async function callMiniMaxWithSearch(
  basePrompt: string,
  searchResults?: string,
  pageContents?: string,
  callCount: number = 1,
  options: MiniMaxCallOptions = {},
): Promise<string> {
  // 构建当前轮次的 prompt
  let currentPrompt = basePrompt;
  if (pageContents) {
    currentPrompt = `${currentPrompt}\n\n${buildPageFetchSection(pageContents)}`;
  } else if (searchResults) {
    currentPrompt = `${currentPrompt}\n\n${buildSearchResultsSection(searchResults)}`;
  }

  // 调用 API
  const content = await callMiniMax(currentPrompt, options);

  // 判断是否需要继续
  if (callCount >= 3) {
    // 超过最大调用次数，直接返回
    return content;
  }

  if (isSearchNeededResponse(content)) {
    const queries = extractSearchQueries(content);
    if (queries.length === 0) {
      return content;
    }

    // 执行搜索
    const { searchWeb, formatSearchResults } = await import('./search');
    const searchResultsList = await Promise.all(queries.map(q => searchWeb(q)));

    // 处理搜索结果，过滤不可用的情况
    const availableResults = searchResultsList.filter((r): r is import('./search').SearchResult[] => !('unavailable' in r));
    const unavailableReasons = searchResultsList
      .filter((r): r is import('./search').SearchUnavailable => 'unavailable' in r)
      .map(r => r.message);

    if (unavailableReasons.length > 0) {
      console.warn('Search unavailable:', unavailableReasons.join('; '));
    }

    const allResults = availableResults.flat();
    const formattedResults = formatSearchResults(allResults);

    // 递归调用，注入搜索结果
    return callMiniMaxWithSearch(basePrompt, formattedResults, undefined, callCount + 1, options);
  }

  if (isPageFetchNeededResponse(content)) {
    const urls = extractPageUrls(content);
    if (urls.length === 0) {
      return content;
    }

    // 限制最多3个 URL
    const urlsToFetch = urls.slice(0, 3);

    // 并行抓取页面内容
    const { fetchPageContent } = await import('./search');
    const pageContentsList = await Promise.all(
      urlsToFetch.map(url => fetchPageContent(url))
    );
    const combinedPageContents = pageContentsList.filter(c => c).join('\n\n---\n\n');

    if (!combinedPageContents) {
      return content;
    }

    // 递归调用，注入页面内容
    return callMiniMaxWithSearch(basePrompt, undefined, combinedPageContents, callCount + 1, options);
  }

  // 不需要继续，返回内容
  return content;
}
