const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

export interface SearchResult {
  title: string;
  url: string;
  description: string;
}

export type SearchUnavailable = {
  unavailable: true;
  reason: 'no_api_key' | 'network_error' | 'timeout' | 'api_error';
  message: string;
};

export type SearchResponse = SearchResult[] | SearchUnavailable;

export async function searchWeb(query: string, timeout = 15000): Promise<SearchResponse> {
  if (!TAVILY_API_KEY) {
    return {
      unavailable: true,
      reason: 'no_api_key',
      message: '搜索服务未配置 TAVILY_API_KEY'
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TAVILY_API_KEY}`
      },
      body: JSON.stringify({
        query,
        search_depth: 'basic',
        max_results: 5,
        include_answer: false,
        include_raw_content: false
      })
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        unavailable: true,
        reason: 'api_error',
        message: `搜索 API 返回错误: ${response.status}`
      };
    }

    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      return [];
    }

    return data.results.map((item: {
      title: string;
      url: string;
      content?: string;
    }) => ({
      title: item.title,
      url: item.url,
      description: item.content || ''
    }));
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        unavailable: true,
        reason: 'timeout',
        message: '搜索请求超时'
      };
    }
    return {
      unavailable: true,
      reason: 'network_error',
      message: `搜索失败: ${error instanceof Error ? error.message : '未知错误'}`
    };
  }
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return '未找到相关结果';

  return results.map((r, i) =>
    `${i + 1}. [${r.title}]\n   ${r.description}\n   URL: ${r.url}`
  ).join('\n\n');
}

export async function fetchPageContent(url: string, timeout = 10000): Promise<string> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Bot/0.1)'
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return '';
    }

    const html = await response.text();
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 5000);
  } catch (error) {
    console.error('Page fetch failed:', error);
    return '';
  }
}