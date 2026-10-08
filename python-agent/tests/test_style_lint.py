# tests/test_style_lint.py — 文风 lint 单测（观测模式，只验证检测与干净文本不误伤）

from services.style_lint import lint_prose, lint_task_blocks


def test_lint_prose_detects_banned_patterns():
    text = "这不是简单的工具，而是新的工作方式。一句话总结：赋能"
    findings = lint_prose(text)
    rules = {f["rule"] for f in findings}
    assert {"翻案腔", "提示性冒号", "商业黑话"} <= rules


def test_lint_prose_clean_text_has_no_findings():
    text = "先把日历打开，再决定订哪一班。经验上，早班机更稳；这件事目前没有定论。"
    assert lint_prose(text) == []


def test_lint_prose_dedupes_repeated_matches():
    text = "值得注意的是，赋能很重要。值得注意的是，抓手更直接。"
    findings = lint_prose(text)
    rules = [f["rule"] for f in findings]
    assert rules.count("洞察路标") == 1
    assert rules.count("商业黑话") == 2


def test_lint_task_blocks_extracts_block_text():
    blocks = [
        {"type": "markdown", "blockId": "b1", "markdown": "核心是：先看数据。"},
        {"type": "key_point", "blockId": "b2", "points": ["底层逻辑要吃透"]},
        {"type": "markdown", "blockId": "b3", "markdown": "正常讲解，没有命中。"},
    ]
    findings = lint_task_blocks(blocks)
    rules = {f["rule"] for f in findings}
    assert {"提示性冒号", "商业黑话"} <= rules


def test_lint_prose_detects_personification():
    findings = lint_prose("出错的请求会被补救内容接住，不会丢。")
    rules = {f["rule"] for f in findings}
    assert "拟人化比喻" in rules


def test_lint_prose_clean_personification_free():
    assert lint_prose("出错后系统会自动生成补救内容，讲清刚才那步为什么错。") == []


def test_lint_prose_detects_blank_fill_practice():
    findings = lint_prose("生成式UI是______（定义）；区别在于______。")
    rules = {f["rule"] for f in findings}
    assert "填空式练习" in rules


def test_lint_prose_no_false_positive_on_normal_text():
    assert lint_prose("下划线字符 _ 单个出现是正常的。") == []
