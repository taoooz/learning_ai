# 课程生成搜索增强设计

## 背景

当前课程生成依赖模型内部知识，对于专业性较强或最新的话题，可能生成内容不够准确或深度不足。需要通过搜索能力补充外部知识。

## 目标

在课程生成和节点内容生成环节，当模型判断知识不足时，允许搜索外部资源来提升内容质量。

## 设计原则

1. **模型无关性** - 搜索能力作为独立功能，不依赖特定模型的 tool_call 格式
2. **可扩展调用** - 最多3次调用，给模型足够的上下文补充机会
3. **轻量集成** - 使用 search-engine-tool npm 包实现搜索

---

## 方案设计

### 1. 搜索能力实现

#### 1.1 安装依赖

```bash
npm install search-engine-tool
```

#### 1.2 搜索函数封装

```typescript
// lib/search.ts

import searchEngine from 'search-engine-tool';

interface SearchResult {
  title: string;
  url: string;
  description: string;
}

export async function searchWeb(query: string): Promise<SearchResult[]> {
  try {
    const results = await searchEngine.google(query, 5);
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
```

### 2. 增强的模型调用

#### 2.1 调用流程

```
第1次调用：prompt
    │
    ├─ 返回 JSON 内容（不需要搜索）──→ 结束
    │
    └─ 返回 { needsSearch: true, searchQueries: [...] }（需要搜索）
            │
            ▼
        执行搜索（并行搜索多个关键词）
            │
            ▼
        第2次调用：prompt + 搜索结果
            │
            ├─ 返回 JSON 内容（搜索足够）──→ 结束
            │
            └─ 返回 { needsPageFetch: true, urls: [...] }（需要页面详情）
                    │
                    ▼
                抓取页面内容（限制前3个URL）
                    │
                    ▼
                第3次调用：prompt + 页面内容
                    │
                    ▼
                返回最终内容
```

#### 2.2 调用次数限制

- **第1次**：必须（判断是否需要搜索）
- **第2次**：需要搜索时调用（携带搜索结果）
- **第3次**：需要页面详情时调用（可选，最多3次）

**如果第3次后仍请求页面抓取，则忽略，返回已抓取的内容。**

### 3. Prompt 改造

#### 3.1 搜索判断 prompt

在原始 prompt 基础上，AI 需要先判断是否需要搜索：

```
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
```

#### 3.2 搜索结果注入 prompt

```
## 搜索结果

{搜索结果格式化的内容}

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
```

#### 3.3 页面抓取 prompt

```
## 页面详情

{抓取的页面内容}

请基于以上页面详情，补充或验证之前的内容。
如果页面详情足够，返回最终内容 JSON。
如果仍需要更多页面详情（最多额外请求1次），返回：
{
  "needsPageFetch": true,
  "urls": ["url1", "url2", "url3"]
}

**超过最大调用次数后，不再接受页面请求，直接基于已有内容生成。**
```

### 4. 实现位置

| 文件 | 改动 |
|------|------|
| `lib/search.ts` | 新增，搜索功能封装 |
| `lib/minimax.ts` | 修改 `callMiniMax` 支持多轮调用 |
| `lib/prompt.ts` | 修改 `buildCourseTreePrompt` 和 `buildNodeContentPrompt` 增加搜索判断 |
| `app/api/generate/route.ts` | 不需要改动（逻辑在 minimax.ts） |
| `app/api/generate/node/route.ts` | 不需要改动 |

### 5. 数据结构

#### 5.1 搜索请求响应

```typescript
interface SearchNeededResponse {
  needsSearch: true;
  searchQueries: string[];
}

interface ContentResponse {
  needsSearch?: false;
  // 正常的课程/内容 JSON
}
```

#### 5.2 页面抓取请求

```typescript
interface PageFetchNeededResponse {
  needsPageFetch: true;
  urls: string[];  // 最多3个URL
}
```

### 6. 错误处理与超时

| 场景 | 处理 | 超时 |
|------|------|------|
| API 调用 | - | 30 秒 |
| 搜索执行 | 失败时返回空结果，继续使用已有知识 | 15 秒/关键词 |
| 页面抓取 | 跳过失败页面，继续使用可用内容 | 10 秒/页面 |

**超时策略：**
- 单次 API 调用超时 30 秒，超时后返回错误
- 搜索并行执行，总耗时约 15 秒
- 页面抓取最多 3 个 URL，每个 10 秒

**降级处理：**
- 搜索失败 → 继续使用模型内部知识生成（质量可能下降）
- 页面抓取部分失败 → 使用成功的页面内容
- 所有外部获取都失败 → 直接用内部知识生成

### 7. 成本考虑

- 每次生成最多3次 API 调用
- 搜索和页面抓取是免费工具
- 第1次调用时模型输出短（只返回搜索关键词），消耗较小

---

## 改动范围

```
新增文件:
- lib/search.ts                    # 搜索功能封装

修改文件:
- lib/minimax.ts                   # 支持多轮调用
- lib/prompt.ts                    # 增加搜索判断逻辑
```

---

## 测试要点

1. **不需要搜索时** → 直接返回内容，1次调用
2. **需要搜索时** → 2次调用，搜索结果正确注入
3. **需要页面详情时** → 3次调用，页面内容正确注入
4. **搜索失败时** → 降级处理，返回错误或使用已有知识
5. **页面抓取失败时** → 跳过失败页面，继续生成
