"""
搜索工具 — 免预算路径：DDGS(Google backend) + Jina Reader。
提供结构化 web_search 和兼容旧链路的字符串接口。
"""
import os
import time
from urllib.parse import urlparse

import httpx
from ddgs import DDGS

from lib.tools.source_registry import infer_source_kind, source_authority

JINA_READER = "https://r.jina.ai/"
SEARCH_BACKEND = os.getenv("FREE_SEARCH_BACKEND", "google")
SEARCH_CACHE_TTL = int(os.getenv("FREE_SEARCH_CACHE_TTL", "3600"))

# 进程内缓存只用于一次课程生成内的重复查询；重启即失效，不占用额外服务。
_SEARCH_CACHE: dict[str, tuple[float, list[dict]]] = {}


def _cache_key(query: str, max_results: int, preferred_domains: list[str]) -> str:
    return f"{SEARCH_BACKEND}|{max_results}|{','.join(preferred_domains)}|{query.strip().lower()}"


def _cache_get(key: str) -> list[dict] | None:
    hit = _SEARCH_CACHE.get(key)
    if not hit:
        return None
    saved_at, value = hit
    if time.time() - saved_at > SEARCH_CACHE_TTL:
        _SEARCH_CACHE.pop(key, None)
        return None
    return value


def _cache_set(key: str, value: list[dict]) -> None:
    if len(_SEARCH_CACHE) > 128:
        oldest_key = next(iter(_SEARCH_CACHE))
        _SEARCH_CACHE.pop(oldest_key, None)
    _SEARCH_CACHE[key] = (time.time(), value)


def _normalize_url(url: str) -> str:
    try:
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.hostname:
            return ""
        path = parsed.path.rstrip("/")
        return f"{parsed.scheme.lower()}://{parsed.hostname.lower()}{path}"
    except ValueError:
        return ""


def _ddg_search(query: str, max_results: int, backend: str) -> list[dict]:
    """单个 backend 的搜索；异常上抛，让外层决定 fallback。"""
    with DDGS() as ddgs:
        raw = ddgs.text(query, max_results=max_results * 2, backend=backend)
        results: list[dict] = []
        seen: set[str] = set()
        for item in raw:
            title = (item.get("title") or "").strip()
            href = (item.get("href") or "").strip()
            body = (item.get("body") or "").strip()
            canonical = _normalize_url(href)
            if not title or not href or not body or canonical in seen:
                continue
            seen.add(canonical)
            results.append({"title": title[:100], "url": href, "body": body[:260], "backend": backend})
            if len(results) >= max_results:
                break
        return results


def search_web_structured(
    query: str,
    max_results: int = 5,
    preferred_domains: list[str] | None = None,
) -> list[dict]:
    """免费结构化搜索：权威域 site: 优先，Google backend 优先，lite backend 兜底。"""
    query = query.strip()
    preferred_domains = [d.lower().removeprefix("www.") for d in (preferred_domains or []) if d.strip()]
    cache_key = _cache_key(query, max_results, preferred_domains)
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    queries: list[str] = []
    if preferred_domains:
        queries.append(f"site:{preferred_domains[0]} {query}")
    queries.append(query)

    errors: list[str] = []
    results: list[dict] = []
    backends = [SEARCH_BACKEND, "duckduckgo lite", "bing lite"]

    for search_query in queries:
        for backend in backends:
            try:
                found = _ddg_search(search_query, max_results, backend)
            except Exception as exc:  # noqa: BLE001 免费搜索源不稳定，一个失败不中断
                errors.append(f"{backend}: {exc}")
                continue
            for item in found:
                canonical = _normalize_url(item["url"])
                item["authorityScore"] = source_authority(item["url"], preferred_domains)
                item["kind"] = infer_source_kind(item["url"])
                item["preferred"] = any(
                    canonical == f"https://{domain}" or canonical.startswith(f"https://{domain}/")
                    for domain in preferred_domains
                )
                if canonical not in {_normalize_url(x["url"]) for x in results}:
                    results.append(item)
            if len(results) >= max_results:
                break
        if len(results) >= max_results:
            break

    results.sort(
        key=lambda item: (
            1 if item.get("preferred") else 0,
            0 if item.get("kind") == "knowledge" else 1,
            item["authorityScore"],
        ),
        reverse=True,
    )
    results = results[:max_results]
    if results:
        results[0]["isPrimary"] = True
    if not results:
        raise RuntimeError("; ".join(errors) or "no results")

    _cache_set(cache_key, results)
    return results


def web_search(query: str, max_results: int = 5, preferred_domains: list[str] | None = None) -> str:
    """兼容旧链路的字符串搜索接口。"""
    try:
        results = search_web_structured(query, max_results=max_results, preferred_domains=preferred_domains)
    except Exception as e:  # noqa: BLE001
        return f"搜索出错：{e}"

    formatted = [
        f"- {item['title']}\n  {item['body']}\n  来源: {item['url']}"
        for item in results
    ]
    text = "\n\n".join(formatted)
    return text[:3000] + ("\n...(搜索结果已截断)" if len(text) > 3000 else "") if text else "未找到相关结果"


def read_url(url: str) -> str:
    """读取指定网页内容，返回 Markdown 格式（Jina Reader API）"""
    try:
        response = httpx.get(
            f"{JINA_READER}{url}",
            headers={"Accept": "text/markdown", "X-Return-Format": "markdown"},
            timeout=15,
        )
        response.raise_for_status()
        text = response.text.strip()
        if len(text) > 4000:
            text = text[:4000] + "\n...(网页内容已截断)"
        return text
    except httpx.TimeoutException:
        return "读取超时，请稍后重试"
    except Exception as e:  # noqa: BLE001
        return f"读取出错：{e}"


# OpenAI 格式的工具定义，用于 MiniMax function calling
SEARCH_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "搜索互联网获取最新信息。适用于查找行业趋势、技术文档、最新案例、概念定义等。返回搜索结果的摘要。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词，简洁明确，建议 5-15 个字",
                    }
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_url",
            "description": "读取指定网页的完整内容，返回 Markdown 格式。适用于深度阅读特定文章或文档。",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "网页 URL，以 http:// 或 https:// 开头",
                    }
                },
                "required": ["url"],
            },
        },
    },
]

# 工具名 -> 执行函数的映射
TOOL_FUNCTIONS = {
    "web_search": web_search,
    "read_url": read_url,
}
