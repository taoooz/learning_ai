"""
课程 / 章节级证据包（EvidencePack）。

目标：把“搜索”从任务级临时动作提升为章节级资产：
- 章节首次生成计划时搜索一次；
- 同章节后续任务复用证据；
- 任务只在强时效信号下补充搜索；
- 文件持久化在 python-agent/data/evidence/{courseId}.json，避免重启后重复消耗搜索。

本模块不接入付费 API；搜索仍走 search_tools 的免预算路径。
"""
import asyncio
import hashlib
import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import wait as _futures_wait
from pathlib import Path
from typing import Any
from uuid import uuid4

from lib.tools.search_tools import search_web_structured
from lib.tools.source_registry import infer_preferred_domains
from urllib.parse import urlparse

EVIDENCE_SCHEMA_VERSION = 1
DEFAULT_EVIDENCE_TTL_SECONDS = 7 * 24 * 60 * 60
DEFAULT_ROOT = Path(__file__).resolve().parents[1] / "data" / "evidence"
TOPICS_DIRNAME = "topics"

# 摘录深化：摘要只有 260 字（常是网页样板），生成需要正文才能用上真实数据。
# 成本/延迟受三重限制：每个证据包最多抓 2 个一手来源、单次 15s 超时、整体预算 8s。
EXCERPT_MAX_CHARS = 8000
EXCERPT_FETCH_LIMIT = 2
EXCERPT_FETCH_TIMEOUT = 15.0
EXCERPT_FETCH_BUDGET = 8.0
_EXCERPT_DROP_TAGS = ("script", "style", "nav", "header", "footer", "aside", "noscript")


def _safe_component(value: str) -> str:
    """路径安全化：只保留稳定字符，长度限制避免长课程名撑爆文件名。"""
    safe = re.sub(r"[^a-zA-Z0-9._-]+", "-", value.strip()).strip("-")
    return (safe or "course")[:80]


def _safe_course_id(course_id: str) -> str:
    # courseId 由上层鉴权与业务生成，这里仍做防御，避免路径逃逸。
    safe = _safe_component(course_id)
    if safe in {".", ".."}:
        return "course"
    return safe


def _root_dir(root_dir: str | Path | None = None) -> Path:
    if root_dir is not None:
        return Path(root_dir)
    return Path(os.getenv("EVIDENCE_STORE_DIR", str(DEFAULT_ROOT)))


def evidence_file(course_id: str, root_dir: str | Path | None = None) -> Path:
    return _root_dir(root_dir) / f"{_safe_course_id(course_id)}.json"


def _load_store(course_id: str, root_dir: str | Path | None = None) -> dict[str, Any]:
    path = evidence_file(course_id, root_dir)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {"version": 1, "packs": {}}
    except FileNotFoundError:
        return {"version": 1, "packs": {}}
    except Exception:
        return {"version": 1, "packs": {}}


def _save_store(course_id: str, store: dict[str, Any], root_dir: str | Path | None = None) -> None:
    root = _root_dir(root_dir)
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"{_safe_course_id(course_id)}.json"
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def get_chapter_evidence(
    course_id: str,
    chapter_id: str,
    root_dir: str | Path | None = None,
    now: float | None = None,
) -> dict[str, Any] | None:
    """读取未过期的章节证据包；损坏 / 过期 / 版本不符安全返回 None。"""
    store = _load_store(course_id, root_dir)
    packs = store.get("packs")
    if not isinstance(packs, dict):
        return None
    pack = packs.get(chapter_id)
    if not isinstance(pack, dict) or pack.get("schemaVersion") != EVIDENCE_SCHEMA_VERSION:
        return None
    expires_at = pack.get("expiresAt")
    current = now if now is not None else time.time()
    if not isinstance(expires_at, (int, float)) or expires_at <= current:
        return None
    return pack


def save_chapter_evidence(pack: dict[str, Any], root_dir: str | Path | None = None) -> None:
    """按课程文件 + 章节 key upsert；输入必须是完整 pack。"""
    course_id = str(pack.get("courseId") or "")
    chapter_id = str(pack.get("chapterId") or "")
    if not course_id or not chapter_id:
        raise ValueError("EvidencePack 缺少 courseId/chapterId")
    store = _load_store(course_id, root_dir)
    packs = store.get("packs")
    if not isinstance(packs, dict):
        packs = {}
    packs[chapter_id] = pack
    store["version"] = EVIDENCE_SCHEMA_VERSION
    store["packs"] = packs
    _save_store(course_id, store, root_dir)


def invalidate_chapter_evidence(course_id: str, chapter_id: str, root_dir: str | Path | None = None) -> None:
    store = _load_store(course_id, root_dir)
    packs = store.get("packs")
    if isinstance(packs, dict):
        packs.pop(chapter_id, None)
        store["packs"] = packs
        _save_store(course_id, store, root_dir)


def _topic_key(topic: str) -> str:
    normalized = re.sub(r"\s+", " ", topic.strip().lower())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:20]


def topic_evidence_file(topic: str, root_dir: str | Path | None = None) -> Path:
    return _root_dir(root_dir) / TOPICS_DIRNAME / f"{_topic_key(topic)}.json"


def get_topic_evidence(
    topic: str,
    root_dir: str | Path | None = None,
    now: float | None = None,
) -> dict[str, Any] | None:
    """读取未过期的课程级主题证据包。"""
    path = topic_evidence_file(topic, root_dir)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except Exception:
        return None
    if not isinstance(raw, dict) or raw.get("schemaVersion") != EVIDENCE_SCHEMA_VERSION:
        return None
    expires_at = raw.get("expiresAt")
    current = now if now is not None else time.time()
    if not isinstance(expires_at, (int, float)) or expires_at <= current:
        return None
    return raw


def save_topic_evidence(pack: dict[str, Any], root_dir: str | Path | None = None) -> None:
    """保存课程级主题证据包；目录不存在时自动创建。"""
    topic = str(pack.get("topic") or "").strip()
    if not topic:
        raise ValueError("EvidencePack 缺少 topic")
    path = topic_evidence_file(topic, root_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(pack, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def invalidate_topic_evidence(topic: str, root_dir: str | Path | None = None) -> None:
    try:
        topic_evidence_file(topic, root_dir).unlink(missing_ok=True)
    except Exception:
        pass


def build_course_query_plan(course_topic: str) -> list[dict[str, Any]]:
    """课程级查询计划：目录阶段只需要判断课程结构，不展开任务细节。"""
    preferred = infer_preferred_domains(course_topic)
    query = f"{course_topic} 官方文档 最新版本" if preferred else f"{course_topic} 学习路径 权威资料"
    return [{
        "kind": "official" if preferred else "general",
        "query": query,
        "preferredDomains": preferred,
    }]


def _decode_html(raw: bytes, header_encoding: str | None) -> str:
    """按页面 meta 声明解码；未声明则优先响应头，最后回退 utf-8。

    中文站点常只在 <meta charset> 里声明，直接喂 bytes 给 lxml 会按 latin-1
    解析成乱码，导致摘录不可用。
    """
    match = re.search(rb"charset=[\"']?([\w-]+)", raw[:4096], re.IGNORECASE)
    encoding = match.group(1).decode("ascii", "ignore") if match else (header_encoding or "utf-8")
    try:
        return raw.decode(encoding, errors="replace")
    except (LookupError, UnicodeDecodeError):
        return raw.decode("utf-8", errors="replace")


def _fetch_full_text(url: str) -> str | None:
    """直抓网页正文并抽成纯文本；任何失败返回 None（调用方回退摘要）。

    不走 search_tools.read_url：那是给模型用的工具，失败时返回中文提示字符串，
    直接当证据写进包会污染上下文。
    """
    if not url or os.getenv("DISABLE_EVIDENCE_EXCERPT", "").lower() in ("1", "true", "yes"):
        return None
    try:
        import httpx
        from lxml import html as _html
    except Exception:  # noqa: BLE001 依赖缺失时整体降级
        return None
    try:
        response = httpx.get(
            url,
            timeout=EXCERPT_FETCH_TIMEOUT,
            follow_redirects=True,
            proxy=os.getenv("EVIDENCE_FETCH_PROXY") or None,
            headers={"User-Agent": "Mozilla/5.0 (compatible; LearningAI-Evidence/1.0)"},
        )
        response.raise_for_status()
        content_type = str(response.headers.get("content-type") or "").lower()
        if content_type and "html" not in content_type and "text/" not in content_type:
            return None
        doc = _html.fromstring(_decode_html(response.content, response.encoding))
        for tag in _EXCERPT_DROP_TAGS:
            for node in doc.xpath(f"//{tag}"):
                node.drop_tree()
        main_nodes = doc.xpath("//main") or doc.xpath("//article")
        container = main_nodes[0] if main_nodes else (doc.body if doc.body is not None else doc)
        text = container.text_content()
    except Exception:  # noqa: BLE001 抓取失败一律降级
        return None
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) < 120:  # 过短多半是反爬页/空壳页
        return None
    return text[:EXCERPT_MAX_CHARS]


def _enrich_primary_excerpts(sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """给一手来源补正文摘录（原地写入 excerpt）。失败或无候选时原样返回。

    只处理 isPrimary 且尚无 excerpt 的来源，按权威分降序取前 N 个；
    并发抓取但受整体预算约束，超预算的直接放弃、不阻塞生成。
    """
    if not sources or os.getenv("DISABLE_EVIDENCE_EXCERPT", "").lower() in ("1", "true", "yes"):
        return sources
    candidates = [
        source for source in sources
        if isinstance(source, dict)
        and source.get("isPrimary")
        and source.get("url")
        and not source.get("excerpt")
    ]
    if not candidates:
        return sources
    candidates.sort(key=lambda s: int(s.get("authorityScore") or 0), reverse=True)
    targets = candidates[:EXCERPT_FETCH_LIMIT]
    pool = ThreadPoolExecutor(max_workers=len(targets))
    try:
        futures = {pool.submit(_fetch_full_text, str(s.get("url") or "")): s for s in targets}
        done, pending = _futures_wait(futures.keys(), timeout=EXCERPT_FETCH_BUDGET)
        for future in pending:  # 超预算的放弃，避免拖住生成
            future.cancel()
        for future in done:
            source = futures[future]
            try:
                text = future.result()
            except Exception:  # noqa: BLE001
                text = None
            if text:
                source["excerpt"] = text
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    return sources


def _topic_pack(
    topic: str,
    query_plan: list[dict[str, Any]],
    results: list[dict[str, Any]],
) -> dict[str, Any]:
    now = time.time()
    sources: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in results:
        url = item.get("url", "")
        if not url or url in seen:
            continue
        seen.add(url)
        sources.append({
            "evidenceId": f"ev-{len(sources) + 1:02d}-{uuid4().hex[:6]}",
            "title": item.get("title", "")[:120],
            "url": url,
            "domain": _domain(url),
            "summary": item.get("body", "")[:260],
            "authorityScore": int(item.get("authorityScore", 0)),
            "preferred": bool(item.get("preferred", False)),
            "kind": item.get("kind") or "knowledge",
            "useFor": (
                "官方或高权威资料，用于支撑事实性结论"
                if item.get("kind") != "wisdom"
                else "社区或经验型来源，用于理解实践差异，不可作为唯一事实依据"
            ),
            "isPrimary": bool(item.get("isPrimary") or item.get("preferred")),
            "retrievedAt": int(now * 1000),
        })
    _enrich_primary_excerpts(sources)
    return {
        "packId": f"evp-{uuid4().hex[:12]}",
        "schemaVersion": EVIDENCE_SCHEMA_VERSION,
        "scope": "course",
        "topic": topic,
        "queryPlan": query_plan,
        "sources": sources[:4],
        "createdAt": int(now * 1000),
        "refreshedAt": int(now * 1000),
        "expiresAt": now + DEFAULT_EVIDENCE_TTL_SECONDS,
    }


def ensure_topic_evidence_pack_sync(
    topic: str,
    *,
    root_dir: str | Path | None = None,
    force_refresh: bool = False,
) -> dict[str, Any] | None:
    """目录阶段同步搜索主题证据；TOC agent 是同步 generator，这里保持同层调用。"""
    if os.getenv("DISABLE_EVIDENCE_SEARCH", "").lower() in ("1", "true", "yes"):
        return None
    topic = topic.strip()
    if not topic:
        return None
    if not force_refresh:
        cached = get_topic_evidence(topic, root_dir=root_dir)
        if cached:
            return cached
    query_plan = build_course_query_plan(topic)
    first = query_plan[0] if query_plan else None
    if not first:
        return None
    try:
        results = search_web_structured(
            first["query"],
            4,
            first.get("preferredDomains", []),
        )
    except Exception as exc:  # noqa: BLE001 目录生成不因搜索失败阻塞
        print(f"[EvidenceStore] 课程证据搜索失败: {exc}")
        return None
    if not results:
        return None
    pack = _topic_pack(topic, _format_search_plan(query_plan), results)
    try:
        save_topic_evidence(pack, root_dir=root_dir)
    except Exception as exc:  # noqa: BLE001
        print(f"[EvidenceStore] 课程证据保存失败: {exc}")
    return pack


def build_query_plan(course_topic: str, chapter_title: str, task_title: str = "", task_goal: str = "") -> list[dict[str, Any]]:
    """生成最小查询计划；最多两个意图，控制免费搜索延迟。"""
    preferred = infer_preferred_domains(course_topic, chapter_title, task_title, task_goal)
    focus = " ".join(part for part in (course_topic, chapter_title, task_title) if part).strip()
    plan: list[dict[str, Any]] = []
    if preferred:
        plan.append({
            "kind": "official",
            "query": f"site:{preferred[0]} {focus}",
            "preferredDomains": preferred,
        })
    plan.append({
        "kind": "general",
        "query": f"{focus} 官方文档" if preferred else focus,
        "preferredDomains": preferred,
    })
    return plan


def _format_search_plan(plan: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{
        "kind": item["kind"],
        "query": item["query"],
        "preferredDomains": item["preferredDomains"],
    } for item in plan]


def _domain(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").removeprefix("www.").lower()
    except ValueError:
        return ""


def _new_pack(course_id: str, chapter_id: str, course_topic: str, chapter_title: str, query_plan: list[dict[str, Any]], results: list[dict[str, Any]]) -> dict[str, Any]:
    now = time.time()
    sources: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in results:
        url = item.get("url", "")
        if url in seen:
            continue
        seen.add(url)
        sources.append({
            "evidenceId": f"ev-{len(sources) + 1:02d}-{uuid4().hex[:6]}",
            "title": item.get("title", "")[:120],
            "url": url,
            "domain": _domain(url),
            "summary": item.get("body", "")[:260],
            "authorityScore": int(item.get("authorityScore", 0)),
            "preferred": bool(item.get("preferred", False)),
            "kind": item.get("kind") or "knowledge",
            "useFor": (
                "官方或高权威资料，用于支撑事实性结论"
                if item.get("kind") != "wisdom"
                else "社区或经验型来源，用于理解实践差异，不可作为唯一事实依据"
            ),
            "isPrimary": bool(item.get("isPrimary") or item.get("preferred")),
            "retrievedAt": int(now * 1000),
        })

    return {
        "packId": f"evp-{uuid4().hex[:12]}",
        "schemaVersion": EVIDENCE_SCHEMA_VERSION,
        "courseId": course_id,
        "chapterId": chapter_id,
        "courseTopic": course_topic,
        "chapterTitle": chapter_title,
        "queryPlan": query_plan,
        "sources": sources[:4],
        "createdAt": int(now * 1000),
        "refreshedAt": int(now * 1000),
        "expiresAt": now + DEFAULT_EVIDENCE_TTL_SECONDS,
    }


def merge_chapter_evidence_results(
    course_id: str,
    chapter_id: str,
    course_topic: str,
    chapter_title: str,
    query_plan: list[dict[str, Any]],
    results: list[dict[str, Any]],
    *,
    root_dir: str | Path | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """把模型触发的搜索结果合并进章节 EvidencePack，并返回本次可引用来源。

    相同 URL 复用已有 evidenceId，避免任务正文引用与 UI sourceRefs 脱节。
    单章节最多保留 12 个来源，避免多轮搜索无限膨胀。
    """
    existing = get_chapter_evidence(course_id, chapter_id, root_dir=root_dir)
    now = time.time()
    now_ms = int(now * 1000)
    sources = list(existing.get("sources") or []) if existing else []
    by_url = {str(source.get("url") or ""): source for source in sources if isinstance(source, dict)}
    matched_sources: list[dict[str, Any]] = []

    for item in results:
        url = str(item.get("url") or "").strip()
        if not url:
            continue
        source = by_url.get(url)
        if source is None:
            source = {
                "evidenceId": f"ev-{len(sources) + 1:02d}-{uuid4().hex[:6]}",
                "title": str(item.get("title") or "")[:120],
                "url": url,
                "domain": _domain(url),
                "summary": str(item.get("body") or item.get("summary") or "")[:260],
                "authorityScore": int(item.get("authorityScore", 0)),
                "preferred": bool(item.get("preferred", False)),
                "kind": item.get("kind") or "knowledge",
                "useFor": (
                    "官方或高权威资料，用于支撑事实性结论"
                    if item.get("kind") != "wisdom"
                    else "社区或经验型来源，用于理解实践差异，不可作为唯一事实依据"
                ),
                "isPrimary": bool(item.get("isPrimary") or item.get("preferred")),
                "retrievedAt": now_ms,
            }
            sources.append(source)
            by_url[url] = source
        matched_sources.append(source)

    _enrich_primary_excerpts(matched_sources)
    merged_plan: list[dict[str, Any]] = []
    seen_queries: set[tuple[str, str]] = set()
    plan_items = list(existing.get("queryPlan") or []) if existing else []
    plan_items.extend(query_plan)
    for item in plan_items:
        if not isinstance(item, dict):
            continue
        key = (str(item.get("kind") or ""), str(item.get("query") or ""))
        if key in seen_queries:
            continue
        seen_queries.add(key)
        merged_plan.append(item)

    pack = {
        "packId": (existing or {}).get("packId") or f"evp-{uuid4().hex[:12]}",
        "schemaVersion": EVIDENCE_SCHEMA_VERSION,
        "courseId": course_id,
        "chapterId": chapter_id,
        "courseTopic": course_topic,
        "chapterTitle": chapter_title,
        "queryPlan": merged_plan,
        "sources": sources[:12],
        "createdAt": (existing or {}).get("createdAt") or now_ms,
        "refreshedAt": now_ms,
        "expiresAt": now + DEFAULT_EVIDENCE_TTL_SECONDS,
    }
    save_chapter_evidence(pack, root_dir=root_dir)
    return pack, matched_sources


async def ensure_chapter_evidence_pack(
    course_id: str,
    chapter_id: str,
    course_topic: str,
    chapter_title: str,
    *,
    root_dir: str | Path | None = None,
    force_refresh: bool = False,
) -> dict[str, Any] | None:
    """章节证据包存在且未过期则复用；否则搜索一次并持久化。任何失败安全降级。"""
    if os.getenv("DISABLE_EVIDENCE_SEARCH", "").lower() in ("1", "true", "yes"):
        return None

    if not force_refresh:
        cached = get_chapter_evidence(course_id, chapter_id, root_dir=root_dir)
        if cached:
            return cached

    query_plan = build_query_plan(course_topic, chapter_title)
    first = query_plan[0] if query_plan else None
    if not first:
        return None
    try:
        results = await asyncio.to_thread(
            search_web_structured,
            first["query"],
            4,
            first.get("preferredDomains", []),
        )
    except Exception as exc:  # noqa: BLE001 搜索失败不阻塞课程计划
        print(f"[EvidenceStore] 章节证据搜索失败: {exc}")
        return None

    if not results:
        return None
    pack = _new_pack(course_id, chapter_id, course_topic, chapter_title, _format_search_plan(query_plan), results)
    try:
        save_chapter_evidence(pack, root_dir=root_dir)
    except Exception as exc:  # noqa: BLE001 证据写失败不应阻塞教学
        print(f"[EvidenceStore] 章节证据保存失败: {exc}")
    return pack


def _relevance_terms(*texts: str) -> set[str]:
    """提取轻量相关词：英文/数字词 + 中文 2-gram，不依赖分词库。"""
    terms: set[str] = set()
    for text in texts:
        normalized = text.strip().lower()
        if not normalized:
            continue
        for word in re.findall(r"[a-z0-9_.-]{3,}", normalized):
            terms.add(word)
        cjk = "".join(re.findall(r"[一-鿿]", normalized))
        terms.update(cjk[index:index + 2] for index in range(len(cjk) - 1))
    return terms


def _source_relevance_score(source: dict[str, Any], terms: set[str]) -> float:
    text = " ".join((
        str(source.get("title") or ""),
        str(source.get("summary") or ""),
        str(source.get("url") or ""),
    )).lower()
    matched = sum(1 for term in terms if term and term in text)
    authority = float(source.get("authorityScore") or 0)
    preferred_bonus = 8.0 if source.get("preferred") else 0.0
    # 相关性权重最高，其次官方域；避免仅因权威分把无关来源塞进任务 prompt。
    return matched * 3.0 + authority / 10.0 + preferred_bonus


def _matched_term_count(source: dict[str, Any], terms: set[str]) -> int:
    text = " ".join((
        str(source.get("title") or ""),
        str(source.get("summary") or ""),
        str(source.get("url") or ""),
    )).lower()
    return sum(1 for term in terms if term and term in text)


def task_evidence_coverage(
    pack: dict[str, Any] | None,
    task_title: str,
    task_goal: str = "",
) -> dict[str, Any]:
    """判断章节证据是否足以覆盖当前任务。

    规则刻意轻量：
    - 命中任一英文/数字关键词（如 useActionState、http）即视为覆盖；
    - 纯中文上下文需要至少命中 2 个 2-gram，降低偶然命中；
    - 无任务词时视为覆盖，避免稳定概念任务触发额外搜索。
    """
    if not pack:
        return {"covered": False, "matchedTerms": 0}

    sources = pack.get("sources")
    if not isinstance(sources, list):
        return {"covered": False, "matchedTerms": 0}

    terms = _relevance_terms(task_title, task_goal)
    if not terms:
        return {"covered": True, "matchedTerms": 0}

    best_matches = 0
    has_word_match = False
    for source in sources:
        if not isinstance(source, dict):
            continue
        matched = _matched_term_count(source, terms)
        best_matches = max(best_matches, matched)
        if any(term in (
            str(source.get("title") or "") + " " +
            str(source.get("summary") or "") + " " +
            str(source.get("url") or "")
        ).lower() for term in terms if re.search(r"[a-z0-9]", term)):
            has_word_match = True

    covered = has_word_match or best_matches >= 2
    return {"covered": covered, "matchedTerms": best_matches}


def select_relevant_sources(
    pack: dict[str, Any] | None,
    task_title: str,
    task_goal: str = "",
    *,
    max_sources: int = 3,
) -> list[dict[str, Any]]:
    """按当前任务筛选 EvidencePack 来源。

    任务 prompt 只需要 Top 2～3 个高相关来源。无匹配时保留原排序，
    保证章节级证据仍可作为兜底上下文。
    """
    if not pack:
        return []
    sources = pack.get("sources")
    if not isinstance(sources, list):
        return []

    valid_sources = [source for source in sources if isinstance(source, dict) and source.get("url")]
    if not valid_sources:
        return []

    terms = _relevance_terms(task_title, task_goal)
    if not terms:
        return valid_sources[:max_sources]

    ranked = sorted(
        valid_sources,
        key=lambda source: _source_relevance_score(source, terms),
        reverse=True,
    )
    return ranked[:max_sources]


def evidence_to_prompt(
    pack: dict[str, Any] | None,
    task_title: str = "",
    task_goal: str = "",
    *,
    max_sources: int = 4,
) -> tuple[str, list[dict[str, Any]]] | tuple[None, None]:
    """把持久化 EvidencePack 转成 task_content prompt 可用的格式。

    传入任务标题/目标时会先做任务级相关性筛选，只保留最贴近当前任务的来源。
    """
    if not pack:
        return None, None
    sources = select_relevant_sources(
        pack,
        task_title,
        task_goal,
        max_sources=max_sources,
    )
    if not sources:
        return None, None

    lines: list[str] = []
    for source in sources:
        if not isinstance(source, dict):
            continue
        title = str(source.get("title") or "").strip()
        summary = str(source.get("excerpt") or source.get("summary") or "").strip()
        url = str(source.get("url") or "").strip()
        if not title or not url:
            continue
        evidence_id = str(source.get("evidenceId") or "").strip()
        kind = str(source.get("kind") or "knowledge")
        use_for = str(source.get("useFor") or "").strip()
        lines.append(
            f"- {title}\n  {summary}\n  来源: {url}\n  "
            f"证据ID: {evidence_id or '未分配'} | 类型: {kind}"
            + (" | 主推来源" if source.get("isPrimary") else "")
            + (f" | 用途: {use_for}" if use_for else "")
        )

    if not lines:
        return None, None

    clean_sources = [{
        "title": str(source.get("title") or "")[:80],
        "url": str(source.get("url") or ""),
        "evidenceId": str(source.get("evidenceId") or "") or None,
        "kind": str(source.get("kind") or "knowledge"),
        "useFor": str(source.get("useFor") or "") or None,
        "isPrimary": bool(source.get("isPrimary")),
        "authorityScore": int(source.get("authorityScore") or 0),
    } for source in sources if isinstance(source, dict) and source.get("url")]

    return "\n\n".join(lines)[:3000], clean_sources
