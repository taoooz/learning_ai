from lib.minimax import parse_json_response, strip_thinking_markers
from lib.minimax_agent import AgentClient


def test_body_text_with_thinking_words_preserved():
    """回归：正文含两次 Thinking 一词（如 Design Thinking 课程）不得被删除"""
    text = "Design Thinking 强调共情与原型。Critical Thinking 强调质疑与证据。两者可以结合。"
    assert strip_thinking_markers(text) == text


def test_legacy_line_markers_removed():
    """遗留格式：独占行成对 Thinking 标记及其中间内容仍被清理"""
    text = "Thinking\n这里是思考过程\nThinking\n{\"keyTakeaways\": [\"要点\"]}"
    assert strip_thinking_markers(text).strip() == '{"keyTakeaways": ["要点"]}'


def test_markers_with_indent_and_crlf():
    text = "  Thinking\r\n思考\r\n  Thinking\r\n正文"
    assert strip_thinking_markers(text).strip() == "正文"


def test_unpaired_marker_left_alone():
    """只有一个孤立 Thinking 行时不做任何删除（没有成对标记）"""
    text = "Thinking\n这行不是思考块\n正文继续"
    assert strip_thinking_markers(text) == text


def test_parse_json_response_keeps_thinking_topic():
    """回归：JSON 解析不得吞掉含 Thinking 的主题字段"""
    content = '{"courseTopic": "Design Thinking 与 Critical Thinking 入门"}'
    parsed = parse_json_response(content)
    assert parsed["courseTopic"] == "Design Thinking 与 Critical Thinking 入门"


def test_parse_json_response_strips_legacy_markers():
    content = "Thinking\n先想一下\nThinking\n```json\n{\"a\": 1}\n```"
    assert parse_json_response(content) == {"a": 1}


def test_extract_reasoning_ignores_inline_thinking_words():
    """回归：_extract_reasoning 不得把正文里的 Thinking 词间内容当思考过程"""
    client = AgentClient.__new__(AgentClient)
    message = {"content": "Design Thinking 与 Critical Thinking 是两种方法。"}
    assert client._extract_reasoning(message, reasoning_split=False) == ""


def test_extract_reasoning_reads_legacy_markers():
    client = AgentClient.__new__(AgentClient)
    message = {"content": "Thinking\n推理内容\nThinking\n最终回答"}
    assert client._extract_reasoning(message, reasoning_split=False) == "推理内容"
