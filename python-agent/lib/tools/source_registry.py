"""
免预算搜索的来源策略：优先官方文档与权威社区，减少无效搜索。
这里的映射只用于选择 site: 过滤和结果排序，不做硬性黑名单。
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class SourceRule:
    """主题关键词 → 偏好域名。"""
    patterns: tuple[str, ...]
    domains: tuple[str, ...]


SOURCE_RULES: tuple[SourceRule, ...] = (
    SourceRule(("react", "jsx", "use state", "useeffect", "useactionstate"), ("react.dev",)),
    SourceRule(("next.js", "nextjs", "app router", "服务端渲染"), ("nextjs.org",)),
    SourceRule(("vue", "nuxt"), ("vuejs.org", "nuxt.com")),
    SourceRule(("svelte",), ("svelte.dev",)),
    SourceRule(("tailwind",), ("tailwindcss.com",)),
    SourceRule(("typescript",), ("typescriptlang.org",)),
    SourceRule(("node", "npm"), ("nodejs.org", "npmjs.com")),
    SourceRule(("python", "django", "flask", "fastapi"), ("docs.python.org", "fastapi.tiangolo.com", "docs.djangoproject.com", "flask.palletsprojects.com")),
    SourceRule(("git",), ("git-scm.com", "git-scm.com/docs")),
    SourceRule(("css", "html", "web api", "fetch", "缓存", "http"), ("developer.mozilla.org",)),
    SourceRule(("llm", "openai", "prompt", "提示词"), ("platform.openai.com", "docs.anthropic.com")),
)

# 常见权威站加权；未命中的普通站仍可出现，但分数较低。
DOMAIN_AUTHORITY: dict[str, int] = {
    "react.dev": 100,
    "nextjs.org": 100,
    "vuejs.org": 100,
    "nuxt.com": 100,
    "svelte.dev": 100,
    "tailwindcss.com": 100,
    "typescriptlang.org": 100,
    "nodejs.org": 100,
    "docs.python.org": 100,
    "fastapi.tiangolo.com": 100,
    "docs.djangoproject.com": 100,
    "flask.palletsprojects.com": 100,
    "git-scm.com": 100,
    "developer.mozilla.org": 95,
    "github.com": 85,
    "stackoverflow.com": 80,
    "npmjs.com": 78,
}

# 明显低权重/易过时的聚合站，只降权，不直接丢弃。
LOW_AUTHORITY_DOMAINS: dict[str, int] = {
    "medium.com": 45,
    "dev.to": 45,
    "juejin.cn": 55,
    "cnblogs.com": 55,
    "csdn.net": 45,
    "zhihu.com": 50,
}


def _canonical_domain(url: str) -> str:
    from urllib.parse import urlparse

    try:
        host = urlparse(url).hostname or ""
    except ValueError:
        return ""
    return host.removeprefix("www.").lower()


def infer_preferred_domains(topic: str, chapter_title: str = "", task_title: str = "", task_goal: str = "") -> list[str]:
    """从任务文本推断 site: 搜索域；最多返回 2 个，避免查询发散。"""
    text = " ".join((topic, chapter_title, task_title, task_goal)).lower()
    domains: list[str] = []
    for rule in SOURCE_RULES:
        if any(pattern in text for pattern in rule.patterns):
            for domain in rule.domains:
                if domain not in domains:
                    domains.append(domain)
            if len(domains) >= 2:
                break
    return domains


def source_authority(url: str, preferred_domains: list[str] | None = None) -> int:
    """0-100 的粗粒度来源权威分；preferred_domains 命中优先。"""
    domain = _canonical_domain(url)
    if not domain:
        return 0

    score = DOMAIN_AUTHORITY.get(domain, LOW_AUTHORITY_DOMAINS.get(domain, 60))
    if preferred_domains and domain in preferred_domains:
        score = max(score, 95)
    return score
