import searchEngine from 'search-engine-tool';

export interface SearchResult {
  title: string;
  url: string;
  description: string;
}

export async function searchWeb(query: string, timeout = 15000): Promise<SearchResult[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const results = await Promise.race([
      searchEngine.google(query, 5),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Search timeout')), timeout)
      )
    ]).finally(() => clearTimeout(timeoutId));

    return results.map(r => ({
      title: r.title,
      url: r.url,
      description: r.description || ''
    }));
  } catch (error) {
    console.error('Search failed:', error);
    return [];
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