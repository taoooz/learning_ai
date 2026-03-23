// lib/minimax.ts

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
  // Find the first { and track brace depth to find matching }
  const firstBrace = content.indexOf('{');
  if (firstBrace === -1) {
    throw new Error('No JSON found in response');
  }

  let depth = 0;
  let endIndex = -1;

  for (let i = firstBrace; i < content.length; i++) {
    if (content[i] === '{') {
      depth++;
    } else if (content[i] === '}') {
      depth--;
      if (depth === 0) {
        endIndex = i;
        break;
      }
    }
  }

  if (endIndex === -1) {
    throw new Error('No JSON found in response');
  }

  const jsonStr = content.substring(firstBrace, endIndex + 1).trim();

  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    throw new Error(`Invalid JSON: ${jsonStr.substring(0, 200)}`);
  }
}