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


def test_flow_diagram_parses_chain_and_loop_back():
    lines = [
        "组件：flow-diagram", "标题：Agent 四环节闭环", "说明：走完一圈看全局",
        "节点：goal | 接收目标", "节点：sense | 感知", "节点：plan | 规划",
        "节点：act | 行动", "节点：memory | 记忆",
        "连线：goal -> sense", "连线：sense -> plan", "连线：plan -> act",
        "连线：act -> memory", "连线：memory -> goal | 未完成，再来一轮",
    ]
    block = parse_interactive_content(lines, "b6")
    assert block["component"] == "flow-diagram"
    assert len(block["nodes"]) == 5 and len(block["edges"]) == 4
    assert block["loopBacks"] == [{"from": "memory", "to": "goal", "label": "未完成，再来一轮"}]


def test_flow_diagram_broken_chain_degrades():
    lines = [
        "组件：flow-diagram", "节点：a | 第一步", "节点：b | 第二步", "节点：c | 第三步",
        "连线：a -> b",
    ]
    block = parse_interactive_content(lines, "b7")
    assert block["type"] == "markdown"


def test_flow_diagram_invalid_edge_degrades():
    lines = [
        "组件：flow-diagram", "节点：a | 第一步", "节点：b | 第二步",
        "连线：a -> b", "连线：b -> ghost",
    ]
    block = parse_interactive_content(lines, "b8")
    assert block["type"] == "markdown"


def test_bar_compare_parses_items_and_unit():
    block = parse_interactive_content(
        ["组件：bar-compare", "标题：两种方案的成本对比", "说明：数值越大成本越高",
         "单位：小时", "条目：手动做表 | 6", "条目：公式自动算 | 0.5"],
        "b9",
    )
    assert block["component"] == "bar-compare"
    assert block["items"] == [{"label": "手动做表", "value": 6.0}, {"label": "公式自动算", "value": 0.5}]
    assert block["unit"] == "小时"


def test_bar_compare_negative_value_degrades():
    block = parse_interactive_content(
        ["组件：bar-compare", "条目：a | -3", "条目：b | 2"], "b10",
    )
    assert block["type"] == "markdown"


def test_before_after_parses_states_and_labels():
    block = parse_interactive_content(
        ["组件：before-after", "标题：脏数据规范化前后",
         "前：日期格式混乱，合计列全是错误", "后：日期统一，合计自动算出",
         "前标签：规范化前", "后标签：规范化后"],
        "b11",
    )
    assert block["component"] == "before-after"
    assert block["beforeLabel"] == "规范化前" and block["afterLabel"] == "规范化后"
    assert block["beforeText"] and block["afterText"]


def test_before_after_missing_after_degrades():
    block = parse_interactive_content(["组件：before-after", "标题：t", "前：只有前"], "b12")
    assert block["type"] == "markdown"
