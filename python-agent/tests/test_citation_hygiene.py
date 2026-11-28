"""I15 引用卫生：确定性剥离正文内部证据编号 ev-ID。"""
import re

from services.content_stream_parser import (
    ContentStreamParser,
    _clean_block_prose,
    strip_evidence_ids,
)

_EV = re.compile(r"ev-\d+(?:-[0-9a-f]+)?")


def test_pure_evidence_paren_removed():
    assert strip_evidence_ids("颜色值与 v3 不再相同（来源：ev-01-dee2f8、ev-02-d27ca0）。") == "颜色值与 v3 不再相同。"
    assert strip_evidence_ids("进入工单生成环节（来源：ev-02）。") == "进入工单生成环节。"
    assert strip_evidence_ids("最无缝方式”（ev-01-4377df, ev-03-6f7cc0）。") == "最无缝方式”。"


def test_evidence_line_phrase_removed():
    assert strip_evidence_ids("可控性的落点。\n\n证据：ev-01-1cae0d, ev-02-3967ce") == "可控性的落点。\n\n"
    assert strip_evidence_ids("项目说明（证据：ev-01-4b0207）。") == "项目说明。"


def test_appended_token_removed_keeps_real_source():
    # 真实来源名保留，仅删 ev-ID token
    assert strip_evidence_ids("（来源：简书《HTTP权威指南》缓存控制，ev-03-0560e2）。") == "（来源：简书《HTTP权威指南》缓存控制）。"
    assert strip_evidence_ids("MDN《HTTP缓存机制详解》，ev-01-ffaefe）。") == "MDN《HTTP缓存机制详解》）。"


def test_see_token_removed():
    assert strip_evidence_ids("代 `tailwind.config.ts`，见 ev-01-620230。）") == "代 `tailwind.config.ts`。）"


def test_url_paren_evidence_removed():
    assert strip_evidence_ids("（https://tailwindcss.com/docs/theme)，ev-01-75897f）。") == "（https://tailwindcss.com/docs/theme)。"
    assert strip_evidence_ids("参考 https://example.com/overhead/ 证据：ev-02-58d01e）。") == "参考 https://example.com/overhead/）。"


def test_identity_on_legitimate_text():
    text = "推荐系统分召回、排序、重排三段。你在 PRD 里写的用户画像，就是喂给机器的原料。"
    assert strip_evidence_ids(text) == text
    assert strip_evidence_ids("") == ""
    assert strip_evidence_ids("无编号普通文本") == "无编号普通文本"


def test_no_residual_ev_id():
    samples = [
        "（来源：ev-01-1aabc9、ev-05-5a1b9b）。",
        "（ev-01-daac3d、ev-02-bdc9f8）。",
        "schema（ev-03-b53430）。",
        "（来源：ev-01）。",
    ]
    for s in samples:
        assert not _EV.search(strip_evidence_ids(s)), s


def test_clean_block_prose_markdown():
    block = {"type": "markdown", "blockId": "b1", "markdown": "落点（来源：ev-02）。", "evidenceRefs": ["ev-02"]}
    cleaned = _clean_block_prose(block)
    assert cleaned["markdown"] == "落点。"
    assert cleaned["evidenceRefs"] == ["ev-02"]  # 元数据不碰


def test_clean_block_prose_key_point():
    block = {"type": "key_point", "blockId": "b2", "points": ["要点（ev-01-75897f）。", "正常要点"], "title": "标题"}
    cleaned = _clean_block_prose(block)
    assert cleaned["points"] == ["要点。", "正常要点"]


def test_clean_block_prose_example():
    block = {"type": "example", "blockId": "b3", "title": "示例", "context": "场景", "content": "内容（来源：ev-01）。", "takeaway": "要点"}
    cleaned = _clean_block_prose(block)
    assert cleaned["content"] == "内容。"
    assert cleaned["takeaway"] == "要点"


def test_collect_blocks_strips_inline_leak():
    parser = ContentStreamParser()
    parser.feed("召回输出几百到几千个候选（来源：ev-01-dee2f8、ev-02-d27ca0）。\n")
    parser.finish()
    blocks = parser.collect_blocks()
    md = "".join(b.get("markdown", "") for b in blocks if b["type"] == "markdown")
    assert not _EV.search(md)
    assert "召回输出几百到几千个候选。" in md


def test_collect_blocks_preserves_evidence_line_refs():
    # 整行「证据：ev-…」仍被既有逻辑抽到 evidenceRefs，正文不含
    parser = ContentStreamParser()
    parser.feed("这是正文内容。\n证据：ev-01-aaaaaa, ev-02-bbbbbb\n")
    parser.finish()
    blocks = parser.collect_blocks()
    md_block = next(b for b in blocks if b["type"] == "markdown")
    assert not _EV.search(md_block["markdown"])
    assert md_block.get("evidenceRefs") == ["ev-01-aaaaaa", "ev-02-bbbbbb"]
