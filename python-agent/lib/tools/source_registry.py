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
    SourceRule(("meta", "muse", "facebook", "instagram", "whatsapp"), ("about.fb.com", "engineering.fb.com")),
    SourceRule(("vercel", "next.js", "nextjs"), ("nextjs.org", "vercel.com/docs")),
    SourceRule(("rust",), ("doc.rust-lang.org",)),
    SourceRule(("go", "golang"), ("go.dev",)),
    SourceRule(("java", "spring"), ("docs.oracle.com", "spring.io")),
    SourceRule(("kubernetes", "docker", "container"), ("kubernetes.io", "docs.docker.com")),

    # ---- 中文 / 中国权威信息 ----
    # 医疗与公卫：官方部委和疾控优先。
    SourceRule(("卫生", "医疗", "疾控", "药品", "疫苗", "医保"), ("nhc.gov.cn", "cdc.gov.cn")),
    # 金融与财政：央行、财政、统计等一手口径。
    SourceRule(("金融", "央行", "货币政策", "财政", "税收", "外汇", "宏观经济", "统计数据"), ("pbc.gov.cn", "stats.gov.cn")),
    # 政府、法律法规与国家标准。
    SourceRule(("政府", "政策", "国务院", "行政法规", "民法典", "国家标准", "认证认可"), ("gov.cn", "npc.gov.cn", "sac.gov.cn")),
    # 学术与中文论文库。
    SourceRule(("论文", "学术", "科学研究", "中科院", "高校研究"), ("cas.cn", "cnki.net")),
    # 权威中文媒体。
    SourceRule(("新华社", "人民日报", "央视", "中国新闻", "新闻发布"), ("news.cn", "people.com.cn")),
    # 中文云厂商官方文档。
    SourceRule(("阿里云", "腾讯云", "华为云", "云服务"), ("help.aliyun.com", "cloud.tencent.com")),
    # 高校官方站点。
    SourceRule(("清华大学", "北京大学", "复旦大学"), ("tsinghua.edu.cn", "pku.edu.cn", "fudan.edu.cn")),
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
    "huggingface.co": 90,
    "about.fb.com": 95,
    "engineering.fb.com": 93,
    "reuters.com": 88,
    "arxiv.org": 92,
    "wikipedia.org": 72,
    "news.ycombinator.com": 55,

    # 中文官方机构与权威媒体
    "gov.cn": 98,
    "npc.gov.cn": 97,
    "stats.gov.cn": 97,
    "nhc.gov.cn": 97,
    "cdc.gov.cn": 95,
    "pbc.gov.cn": 97,
    "mof.gov.cn": 96,
    "samr.gov.cn": 96,
    "sac.gov.cn": 96,
    "nmpa.gov.cn": 96,
    "cas.cn": 95,
    "news.cn": 92,
    "people.com.cn": 90,
    "cri.cn": 88,
    "cctv.com": 88,

    # 中文高校与学术资源
    "tsinghua.edu.cn": 90,
    "pku.edu.cn": 90,
    "fudan.edu.cn": 89,
    "cnki.net": 82,
    "wanfangdata.com.cn": 78,

    # 中文云厂商官方文档
    "help.aliyun.com": 85,
    "cloud.tencent.com": 85,
    "support.huaweicloud.com": 84,
    "developer.aliyun.com": 82,

    # 参考型来源：可用但不宜作为唯一事实依据
    "zh.wikipedia.org": 70,
    "react.docschina.org": 76,
    "ruanyifeng.com": 66,
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

    # 中国官方 / 学术机构的通配权威域：
    # - *.gov.cn：政府与部委口径，默认高可信；
    # - *.edu.cn：高校官网，权威但具体课程页质量不等；
    # - *.cas.cn / *.ac.cn：中科院及其研究所。
    if domain.endswith(".gov.cn"):
        score = max(score, 96)
    if domain.endswith(".edu.cn"):
        score = max(score, 85)
    if domain.endswith(".cas.cn") or domain.endswith(".ac.cn"):
        score = max(score, 90)

    if preferred_domains and domain in preferred_domains:
        score = max(score, 95)
    return score

WISDOM_DOMAIN_PREFIXES = (
    "news.ycombinator.com",
    "reddit.com",
    "stackoverflow.com",
    "quora.com",
    # 中文社区 / 博客型内容：适合经验参考，不作为唯一事实依据。
    "zhihu.com",
    "segmentfault.com",
    "v2ex.com",
    "juejin.cn",
    "cnblogs.com",
    "csdn.net",
    "oschina.net",
)

def infer_source_kind(url: str) -> str:
    """粗略区分事实型 knowledge 与经验型 wisdom 来源。"""
    domain = _canonical_domain(url)
    if any(domain == prefix or domain.endswith("." + prefix) for prefix in WISDOM_DOMAIN_PREFIXES):
        return "wisdom"
    return "knowledge"
