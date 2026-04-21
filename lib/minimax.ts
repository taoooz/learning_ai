// lib/minimax.ts

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface MiniMaxCallOptions {
  maxTokens?: number;
  signal?: AbortSignal;
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

export async function callMiniMax(prompt: string, options: MiniMaxCallOptions = {}): Promise<string> {
  const apiKey = getMiniMaxApiKey();

  if (!apiKey) {
    throw new Error('MINIMAX_API_KEY is not set');
  }

  const baseUrl = process.env.MINIMAX_API_BASE || 'https://api.minimaxi.com/v1';
  const response = await fetch(`${baseUrl}/chat/completions`, {
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

  return data.choices[0].message.content;
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
