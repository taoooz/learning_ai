"""I13 回归：example 块内容保留代码缩进（修复 strip 剥缩进致 IndentationError）。"""
import re
from services.content_stream_parser import parse_content_blocks

EXAMPLE = """:::example
标题：闭包演示
场景：演示变量保留
内容：
```python
def demo():
    msg = "hello"
    def say():
        return msg
    return say
```
要点：闭包保留变量本身
:::"""


def _example_content():
    blocks = parse_content_blocks(EXAMPLE)
    ex = [b for b in blocks if b["type"] == "example"]
    assert len(ex) == 1, f"应解析出 1 个 example 块，实际 {len(ex)}"
    return ex[0]["content"]


def test_example_code_indent_preserved():
    content = _example_content()
    assert "    msg = \"hello\"" in content, "4 空格缩进应保留"
    assert "        return msg" in content, "8 空格缩进应保留"
    assert "\nmsg = " not in content, "缩进不应被剥掉"


def test_example_code_compiles():
    content = _example_content()
    m = re.search(r"```python\n(.*?)```", content, re.S)
    assert m, "应含 python 代码围栏"
    compile(m.group(1), "<example>", "exec")  # 缩进正确则可编译


def test_prose_example_still_parses():
    text = ":::example\n标题：纯文本\n内容：\n这是一段普通说明文字。\n要点：记住它\n:::"
    blocks = parse_content_blocks(text)
    ex = [b for b in blocks if b["type"] == "example"]
    assert len(ex) == 1
    assert "这是一段普通说明文字。" in ex[0]["content"]
