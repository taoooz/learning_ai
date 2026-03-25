// lib/minimax.ts

import { buildSearchResultsSection, buildPageFetchSection } from './prompt';

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

export async function callMiniMaxChatStream(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<Response> {
  const apiKey = process.env.MINIMAX_API_KEY;

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

export async function callMiniMax(prompt: string): Promise<string> {
  const apiKey = process.env.MINIMAX_API_KEY;

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
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
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

  return data.choices[0].message.content;
}

export function parseJSONResponse<T>(content: string): T {
  // Pre-processing: Extract from markdown code blocks if present
  let extractedContent = content;
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch && codeBlockMatch[1]) {
    extractedContent = codeBlockMatch[1].trim();
  }

  // Find the first opening brace
  const firstBrace = extractedContent.indexOf('{');
  if (firstBrace === -1) {
    throw new Error('No JSON found in response');
  }

  // Strategy 1: Try direct JSON.parse first on the whole content
  // This handles cases where content is a clean JSON
  try {
    const trimmed = extractedContent.trim();
    if (trimmed.startsWith('{')) {
      return JSON.parse(trimmed) as T;
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
  callCount: number = 1
): Promise<string> {
  // 构建当前轮次的 prompt
  let currentPrompt = basePrompt;
  if (pageContents) {
    currentPrompt = `${currentPrompt}\n\n${buildPageFetchSection(pageContents)}`;
  } else if (searchResults) {
    currentPrompt = `${currentPrompt}\n\n${buildSearchResultsSection(searchResults)}`;
  }

  // 调用 API
  const content = await callMiniMax(currentPrompt);

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
    const allResults = searchResultsList.flat();
    const formattedResults = formatSearchResults(allResults);

    // 递归调用，注入搜索结果
    return callMiniMaxWithSearch(basePrompt, formattedResults, undefined, callCount + 1);
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
    return callMiniMaxWithSearch(basePrompt, undefined, combinedPageContents, callCount + 1);
  }

  // 不需要继续，返回内容
  return content;
}