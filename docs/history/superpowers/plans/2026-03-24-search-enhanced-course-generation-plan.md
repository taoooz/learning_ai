# 搜索增强课程生成实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为课程生成和节点内容生成添加搜索增强能力，当模型判断知识不足时，可搜索外部资源提升内容质量。

**Architecture:** 在现有 `callMiniMax` 基础上新增 `callMiniMaxWithSearch` 函数，处理最多3轮调用流程：判断搜索 → 搜索结果注入 → 页面详情注入。Prompt 层面在 `buildCourseTreePrompt` 和 `buildNodeContentPrompt` 中添加搜索判断逻辑。

**Tech Stack:** Next.js API Routes, search-engine-tool npm 包

---

## 文件结构

```
新增文件:
- lib/search.ts                    # 搜索功能封装

修改文件:
- lib/prompt.ts                     # 增加搜索判断 prompt 片段
- lib/minimax.ts                    # 增加 callMiniMaxWithSearch 多轮调用
- app/api/generate/route.ts        # 使用新的多轮调用
- app/api/generate/node/route.ts    # 使用新的多轮调用
```

---

## Task 1: 创建 lib/search.ts 搜索功能封装

**Files:**
- Create: `lib/search.ts`

- [ ] **Step 1: 安装 search-engine-tool 依赖**

Run: `npm install search-engine-tool`
Expected: 包安装成功

- [ ] **Step 2: 创建搜索功能封装**

```typescript
// lib/search.ts

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

    // search-engine-tool 内部已经是 Promise，直接等待即可
    // 如果底层库不支持 abort，可以通过 Promise.race 实现超时
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
    // 简单提取正文文本（实际项目可用更复杂的库）
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 5000);
  } catch (error) {
    console.error('Page fetch failed:', error);
    return '';
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/search.ts package.json package-lock.json
git commit -m "feat(search): add search functionality with search-engine-tool"
```

---

## Task 2: 修改 lib/prompt.ts - 添加搜索判断 prompt

**Files:**
- Modify: `lib/prompt.ts`

- [ ] **Step 1: 添加搜索判断 section 函数**

在文件末尾添加：

```typescript
// 搜索判断 prompt 片段 - 追加到原始 prompt 后面
export function buildSearchJudgmentSection(): string {
  return `
## 搜索判断

请判断是否需要搜索外部信息来生成更好的内容。

如果不需要搜索，请直接返回课程内容。
如果需要搜索，请返回：
{
  "needsSearch": true,
  "searchQueries": ["关键词1", "关键词2"]
}

注意：
- 搜索关键词应该简洁、准确
- 最多返回3个搜索关键词
- 优先搜索核心概念和最新信息
`;
}

// 搜索结果注入 prompt 片段
export function buildSearchResultsSection(searchResults: string): string {
  return `
## 搜索结果

${searchResults}

请基于以上搜索结果，生成更准确、更丰富的内容。
如果搜索结果足够，返回最终内容 JSON。
如果需要查看页面详情来补充内容，请返回：
{
  "needsPageFetch": true,
  "urls": ["url1", "url2", "url3"]
}

注意：
- 最多返回3个URL
- 只请求确实需要详情的页面
`;
}

// 页面抓取结果注入 prompt 片段
export function buildPageFetchSection(pageContents: string): string {
  return `
## 页面详情

${pageContents}

请基于以上页面详情，补充或验证之前的内容。
如果页面详情足够，返回最终内容 JSON。
如果仍需要更多页面详情（最多额外请求1次），返回：
{
  "needsPageFetch": true,
  "urls": ["url1", "url2", "url3"]
}

**超过最大调用次数后，不再接受页面请求，直接基于已有内容生成。**
`;
}
```

- [ ] **Step 2: 修改 buildCourseTreePrompt 添加搜索判断**

在 `buildCourseTreePrompt` 函数的 `return` 语句前，添加搜索判断 section：

```typescript
  // ... 现有代码 ...

  // 搜索判断 section
  const searchJudgmentSection = buildSearchJudgmentSection();

  return `${insightSection}${clarificationSection}你是一位专业的 AI 导师...${searchJudgmentSection}`;
```

实际修改：在 line 46 的 return 语句前面插入 `${searchJudgmentSection}`

- [ ] **Step 3: 修改 buildCourseTreePrompt 添加搜索结果和页面内容注入**

需要根据调用轮次添加不同 section。修改函数签名为：

```typescript
export function buildCourseTreePrompt(
  topic: string,
  userProfile?: UserProfile | null,
  clarificationAnswers?: ClarificationAnswer[],
  searchResults?: string,      // 新增：搜索结果格式化字符串
  pageContents?: string        // 新增：页面内容字符串
): string
```

在 return 语句中根据是否有 searchResults 或 pageContents 追加对应 section。

- [ ] **Step 4: 同样修改 buildNodeContentPrompt**

添加相同的参数和 section 注入逻辑。

- [ ] **Step 5: Commit**

```bash
git add lib/prompt.ts
git commit -m "feat(prompt): add search judgment sections to course and node prompts"
```

---

## Task 3: 修改 lib/minimax.ts - 添加多轮调用支持

**Files:**
- Modify: `lib/minimax.ts`

- [ ] **Step 1: 添加 callMiniMaxWithSearch 函数**

在文件末尾添加：

```typescript
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
    return callMiniMaxWithSearch(basePrompt, searchResults, combinedPageContents, callCount + 1);
  }

  // 不需要继续，返回内容
  return content;
}
```

需要导入新增的 prompt 函数：

```typescript
import { buildSearchResultsSection, buildPageFetchSection } from './prompt';
```

- [ ] **Step 2: Commit**

```bash
git add lib/minimax.ts
git commit -m "feat(minimax): add callMiniMaxWithSearch for multi-round calls"
```

---

## Task 4: 修改 app/api/generate/route.ts - 使用多轮调用

> **注意**：设计文档说"不需要改动"指的是 API 接口不变，但内部实现需要调用新的 `callMiniMaxWithSearch` 函数。

**Files:**
- Modify: `app/api/generate/route.ts`

- [ ] **Step 1: 更新导入和调用方式**

```typescript
import { callMiniMaxWithSearch, parseJSONResponse } from '@/lib/minimax';
import { buildCourseTreePrompt } from '@/lib/prompt';
```

修改 POST 函数中调用方式：

```typescript
// 原来：
const content = await callMiniMax(prompt);

// 改为：
const content = await callMiniMaxWithSearch(prompt);
```

- [ ] **Step 2: Commit**

```bash
git add app/api/generate/route.ts
git commit -m "feat(api): use callMiniMaxWithSearch for course generation"
```

---

## Task 5: 修改 app/api/generate/node/route.ts - 使用多轮调用

> **注意**：同上，设计文档说"不需要改动"指的是 API 接口不变。

**Files:**
- Modify: `app/api/generate/node/route.ts`

- [ ] **Step 1: 更新导入和调用方式**

```typescript
import { callMiniMaxWithSearch, parseJSONResponse } from '@/lib/minimax';
import { buildNodeContentPrompt } from '@/lib/prompt';
```

修改 POST 函数中调用方式：

```typescript
// 原来：
const content = await callMiniMax(prompt);

// 改为：
const content = await callMiniMaxWithSearch(prompt);
```

- [ ] **Step 2: Commit**

```bash
git add app/api/generate/node/route.ts
git commit -m "feat(api): use callMiniMaxWithSearch for node content generation"
```

---

## Task 6: 更新 CHANGELOG.md

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 添加搜索增强功能条目**

在 `## 2026-03-24` 下添加：

```markdown
### 课程生成搜索增强

- 新增 `lib/search.ts` 搜索功能封装
- 新增多轮调用 `callMiniMaxWithSearch` 支持最多3次调用
- Prompt 增加搜索判断逻辑（判断搜索 → 搜索结果注入 → 页面详情注入）
- 搜索使用 `search-engine-tool` npm 包
- 超时保护：API 30s、搜索 15s/关键词、页面 10s/页
- 降级处理：失败时继续使用已有知识生成
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): add search-enhanced course generation entry"
```

---

## 测试验证

- [ ] **Test 1: 不需要搜索时** → 直接返回内容，1次调用
- [ ] **Test 2: 需要搜索时** → 2次调用，搜索结果正确注入
- [ ] **Test 3: 需要页面详情时** → 3次调用，页面内容正确注入
- [ ] **Test 4: 搜索失败时** → 降级处理，返回错误或使用已有知识
- [ ] **Test 5: 页面抓取失败时** → 跳过失败页面，继续生成
