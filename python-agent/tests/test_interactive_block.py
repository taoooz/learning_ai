# tests/test_interactive_block.py — 交互组件块：解析、校验、降级

from services.interactive_block import evaluate_formula, parse_interactive_content

_PARAMETER_DEMO = """组件：parameter-demo
标题：改改补贴标准，看全组加班费怎么变
说明：只改一个参数，整列结果一起更新
参数：每小时补贴 = 30（10~100，步进5）
列：姓名 | 加班小时 | 加班费
行：小陈 | 5 | 加班小时 * 每小时补贴
行：小林 | 8 | 加班小时 * 每小时补贴
行：小周 | 3 | 加班小时 * 每小时补贴""".splitlines()


def test_parameter_demo_parses_to_interactive_block():
    block = parse_interactive_content(_PARAMETER_DEMO, "b1")
    assert block["type"] == "interactive"
    assert block["component"] == "parameter-demo"
    assert block["columns"] == ["加班小时", "加班费"]
    assert block["parameters"][0] == {
        "name": "每小时补贴", "value": 30.0, "min": 10.0, "max": 100.0, "step": 5.0,
    }
    assert block["rows"][0] == {
        "label": "小陈", "values": [5.0, {"formula": "加班小时 * 每小时补贴"}],
    }


def test_step_walkthrough_parses_steps():
    block = parse_interactive_content(
        ["组件：step-walkthrough", "标题：一条公式的旅程", "步：读取 | Excel 找到公式",
         "步：计算 | 先乘后加", "步：显示 | 结果写入格子"],
        "b2",
    )
    assert block["component"] == "step-walkthrough"
    assert [s["title"] for s in block["steps"]] == ["读取", "计算", "显示"]


def test_unknown_component_degrades_to_markdown():
    block = parse_interactive_content(["组件：unknown-widget", "标题：x"], "b3")
    assert block["type"] == "markdown"


def test_illegal_formula_degrades_to_markdown_table():
    block = parse_interactive_content(
        ["组件：parameter-demo", "标题：t", "参数：a = 1", "列：x | y", "行：r1 | 1 | x + 非法$"],
        "b4",
    )
    assert block["type"] == "markdown"
    assert "| x | y |" in block["markdown"]


def test_formula_limits_and_errors():
    assert evaluate_formula("加班小时 * 每小时补贴", {"加班小时": 5, "每小时补贴": 30}) == 150
    try:
        evaluate_formula("10 / 0", {})
        raise AssertionError("除以零应抛 FormulaError")
    except Exception:
        pass
    try:
        evaluate_formula("x ^ 2", {})
        raise AssertionError("非法字符应抛 FormulaError")
    except Exception:
        pass


def test_row_count_limits():
    lines = ["组件：parameter-demo", "标题：t", "参数：a = 1", "列：n | v"]
    for i in range(10):
        lines.append(f"行：r{i} | {i} | n * 2")
    block = parse_interactive_content(lines, "b5")
    # 超出规模上限 → 整块降级为 markdown，而不是静默截断
    assert block["type"] == "markdown"
