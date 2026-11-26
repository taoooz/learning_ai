# services/interactive_block.py — 交互组件块：解析、校验、降级
#
# Phase 1 目录（消费型交互，无对错判定、不计入掌握度）：
# - parameter-demo：改参数看结果（命名变量公式，不用单元格地址）
# - step-walkthrough：分步演示（逐步走完一个流程/机制）
#
# 安全与稳定性设计：
# - 公式求值使用白名单解释器：数字、变量名（中英文）、+ - * /、括号；无函数、无 eval
# - 校验失败（未知组件、超规模、表达式非法/试算失败）→ 整块降级为等价 markdown，
#   不阻塞、不重试、不中断流式生成

from __future__ import annotations

import logging
import re

logger = logging.getLogger("interactive_block")

_ALLOWED_COMPONENTS = {"parameter-demo", "step-walkthrough", "flow-diagram", "bar-compare", "before-after"}
_EXPR_ALLOWED = re.compile(r"^[\dA-Za-z_\u4e00-\u9fff+\-*/().\s]+$")
_TOKEN_RE = re.compile(r"\d+(?:\.\d+)?|[A-Za-z_\u4e00-\u9fff][\w\u4e00-\u9fff]*|[()+\-*/]")

_LIMITS = {
    "parameters": 2,
    "columns": 4,   # 不含标签列
    "rows": 6,
    "steps": 8,
    "nodes": 10,
    "title": 60,
    "intro": 200,
}
_NODE_ID_RE = re.compile(r"^[a-z0-9_-]{1,20}$")


class FormulaError(Exception):
    """公式求值失败（非法字符/未知变量/除以零/语法错误）"""


def evaluate_formula(expr: str, variables: dict[str, float]) -> float:
    """白名单四则运算求值。出错抛 FormulaError。"""
    if not expr or not _EXPR_ALLOWED.match(expr):
        raise FormulaError("表达式包含不允许的字符")
    tokens = _TOKEN_RE.findall(expr)
    if not tokens:
        raise FormulaError("表达式为空")
    # 分词必须覆盖去掉空白后的全部字符，防止“5 5”这类被静默跳过
    if sum(len(t) for t in tokens) != len(re.sub(r"\s+", "", expr)):
        raise FormulaError("表达式包含无法识别的内容")

    pos = 0

    def peek() -> str | None:
        return tokens[pos] if pos < len(tokens) else None

    def parse_expr() -> float:
        nonlocal pos
        value = parse_term()
        while peek() in ("+", "-"):
            op = tokens[pos]
            pos += 1
            rhs = parse_term()
            value = value + rhs if op == "+" else value - rhs
        return value

    def parse_term() -> float:
        nonlocal pos
        value = parse_factor()
        while peek() in ("*", "/"):
            op = tokens[pos]
            pos += 1
            rhs = parse_factor()
            if op == "*":
                value = value * rhs
            else:
                if rhs == 0:
                    raise FormulaError("除以零")
                value = value / rhs
        return value

    def parse_factor() -> float:
        nonlocal pos
        tok = peek()
        if tok is None:
            raise FormulaError("表达式不完整")
        if tok == "(":
            pos += 1
            value = parse_expr()
            if peek() != ")":
                raise FormulaError("括号不匹配")
            pos += 1
            return value
        if tok in ("+", "-"):
            pos += 1
            value = parse_factor()
            return value if tok == "+" else -value
        pos += 1
        if re.match(r"^\d", tok):
            return float(tok)
        if tok in variables:
            return float(variables[tok])
        raise FormulaError(f"未知变量：{tok}")

    value = parse_expr()
    if pos != len(tokens):
        raise FormulaError("表达式有多余内容")
    return value


def _split_kv(stripped: str) -> tuple[str, str]:
    for sep in ("：", ":"):
        if sep in stripped:
            key, rest = stripped.split(sep, 1)
            return key.strip(), rest.strip()
    return "", stripped.strip()


def _parse_number(raw: str) -> float | None:
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _parse_parameter(line: str) -> dict | None:
    """解析『参数名 = 初始值（最小~最大，步进步长）』；括号内可省略"""
    m = re.match(r"^(.+?)\s*=\s*(\d+(?:\.\d+)?)\s*(?:[（(]([^）)]*)[）)])?$", line.strip())
    if not m:
        return None
    name = m.group(1).strip()
    value = _parse_number(m.group(2))
    if not name or value is None:
        return None
    min_v, max_v, step = 0.0, value * 2 if value > 0 else value * 2 + 10, 1.0
    if m.group(3):
        inner = m.group(3).replace("，", ",").replace(" ", "")
        range_part, _, step_part = inner.partition("步进")
        if "~" in range_part:
            lo, _, hi = range_part.partition("~")
            lo_v, hi_v = _parse_number(lo.strip(" ,")), _parse_number(hi.strip(" ,"))
            if lo_v is not None and hi_v is not None and hi_v > lo_v:
                min_v, max_v = lo_v, hi_v
        if step_part:
            step_v = _parse_number(step_part)
            if step_v is not None and step_v > 0:
                step = step_v
    return {"name": name, "value": value, "min": min_v, "max": max_v, "step": step}


def parse_interactive_content(lines: list[str], block_id: str) -> dict:
    fields: dict[str, list[str]] = {}
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        key, rest = _split_kv(stripped)
        if not key:
            continue
        fields.setdefault(key, []).append(rest)

    component = (fields.get("组件") or [""])[0].strip()
    title = ((fields.get("标题") or [""])[0]).strip()[:_LIMITS["title"]]
    intro = "".join(fields.get("说明", []))[:_LIMITS["intro"]]

    try:
        if component == "parameter-demo":
            block = _build_parameter_demo(fields, block_id, title, intro)
        elif component == "step-walkthrough":
            block = _build_step_walkthrough(fields, block_id, title, intro)
        elif component == "flow-diagram":
            block = _build_flow_diagram(fields, block_id, title, intro)
        elif component == "bar-compare":
            block = _build_bar_compare(fields, block_id, title, intro)
        elif component == "before-after":
            block = _build_before_after(fields, block_id, title, intro)
        else:
            block = None
            logger.warning("interactive 块降级：未知组件 %r", component)
    except FormulaError as exc:
        # 公式试算失败（未知变量/非法字符等）只降级本块，不得穿透流式解析杀死整个任务。
        logger.warning("interactive 块降级：组件 %s 公式试算失败：%s", component, exc)
        block = None
    if block is None:
        if component in _ALLOWED_COMPONENTS:
            logger.warning("interactive 块降级：组件 %s 校验未通过", component)
        return _degrade(component, title, intro, fields, block_id)
    return block


def _build_parameter_demo(fields: dict, block_id: str, title: str, intro: str) -> dict | None:
    parameters = [p for p in (_parse_parameter(x) for x in fields.get("参数", [])) if p]
    if not parameters or len(parameters) > _LIMITS["parameters"]:
        return None

    columns_raw = [x for x in fields.get("列", [])]
    if not columns_raw:
        return None
    all_columns = [c.strip() for c in columns_raw[0].split("|") if c.strip()]
    # 第一列固定为标签列；columns 仅存数值/公式列
    columns = all_columns[1:]
    if not 1 <= len(columns) <= _LIMITS["columns"]:
        return None

    rows: list[dict] = []
    for line in fields.get("行", []):
        cells = [c.strip() for c in line.split("|")]
        if not cells or not cells[0] or len(cells) != len(all_columns):
            continue
        rows.append({"label": cells[0], "values": cells[1:]})
    if not 2 <= len(rows) <= _LIMITS["rows"]:
        return None

    # 列类型判定：整列均可解析为数字 → 数值列；否则为公式列
    column_kinds: list[str] = []
    for i in range(len(columns)):
        is_numeric = all(_parse_number(row["values"][i]) is not None for row in rows)
        column_kinds.append("number" if is_numeric else "formula")
    if "formula" not in column_kinds:
        return None

    # 规整行数据：数值列转 float；公式列保留表达式字符串
    normalized_rows: list[dict] = []
    for row in rows:
        normalized_values: list[float | dict] = []
        for i, kind in enumerate(column_kinds):
            raw = row["values"][i]
            if kind == "number":
                normalized_values.append(float(_parse_number(raw)))
            else:
                normalized_values.append({"formula": raw.lstrip("=").strip()})
        normalized_rows.append({"label": row["label"], "values": normalized_values})

    # 试算：用参数默认值把每个公式跑一遍，运行时错误直接降级
    variables = {p["name"]: p["value"] for p in parameters}
    for col_index, kind in enumerate(column_kinds):
        if kind != "formula":
            continue
        for row in normalized_rows:
            for var_index, column in enumerate(columns):
                value = row["values"][var_index]
                if isinstance(value, (int, float)):
                    variables[column] = float(value)
            formula = row["values"][col_index]
            if isinstance(formula, dict):
                evaluate_formula(formula["formula"], variables)

    return {
        "type": "interactive",
        "blockId": block_id,
        "component": "parameter-demo",
        "title": title or "互动演示",
        "intro": intro,
        "parameters": parameters,
        "columns": columns,
        "rows": normalized_rows,
    }


def _build_step_walkthrough(fields: dict, block_id: str, title: str, intro: str) -> dict | None:
    steps: list[dict] = []
    for line in fields.get("步", []):
        parts = [p.strip() for p in line.split("|", 1)]
        if len(parts) == 2 and parts[0] and parts[1]:
            steps.append({"title": parts[0][:40], "detail": parts[1][:200]})
    if not 2 <= len(steps) <= _LIMITS["steps"]:
        return None
    return {
        "type": "interactive",
        "blockId": block_id,
        "component": "step-walkthrough",
        "title": title or "分步演示",
        "intro": intro,
        "steps": steps,
    }


def _build_flow_diagram(fields: dict, block_id: str, title: str, intro: str) -> dict | None:
    """结构总览流程图：节点按执行顺序排列，正向链 + 可选回边（循环）。

    约束（Phase 2 简化模型，覆盖教学中绝大多数流程图）：
    - 节点 2~10 个，id 唯一
    - 正向边必须构成相邻链（nodes[i] -> nodes[i+1]），每节点至多一条正向边
    - 回边（指向更早节点）每节点至多一条，可带条件标签
    """
    nodes: list[dict] = []
    seen_ids: set[str] = set()
    for line in fields.get("节点", []):
        parts = [p.strip() for p in line.split("|", 1)]
        node_id = parts[0]
        text = parts[1].strip() if len(parts) > 1 else ""
        if not _NODE_ID_RE.match(node_id) or not text or node_id in seen_ids:
            return None
        seen_ids.add(node_id)
        nodes.append({"id": node_id, "text": text[:60]})
    if not 2 <= len(nodes) <= _LIMITS["nodes"]:
        return None

    forward_edges: list[dict] = []
    loop_backs: list[dict] = []
    node_index = {node["id"]: i for i, node in enumerate(nodes)}
    for line in fields.get("连线", []):
        body, _, label = line.partition("|")
        parts = [p.strip() for p in body.split("->")]
        if len(parts) != 2:
            return None
        src, dst = parts
        if src not in node_index or dst not in node_index or src == dst:
            return None
        edge_label = label.strip()[:40]
        src_i, dst_i = node_index[src], node_index[dst]
        if dst_i == src_i + 1:
            if any(e["from"] == src for e in forward_edges):
                return None
            forward_edges.append({"from": src, "to": dst})
        elif dst_i < src_i:
            if any(e["from"] == src for e in loop_backs):
                return None
            loop_backs.append({"from": src, "to": dst, "label": edge_label})
        else:
            # 跳跃边/前向分支：超出线性链模型，降级处理
            return None

    # 正向链必须首尾相接：n 个节点需要 n-1 条相邻正向边
    if len(forward_edges) != len(nodes) - 1:
        return None

    return {
        "type": "interactive",
        "blockId": block_id,
        "component": "flow-diagram",
        "title": title or "流程图",
        "intro": intro,
        "nodes": nodes,
        "edges": forward_edges,
        "loopBacks": loop_backs,
    }


def _build_bar_compare(fields: dict, block_id: str, title: str, intro: str) -> dict | None:
    """数值对比条形图：可视化幅度差距（文本/多维对比仍用 comparison 表格块）"""
    unit = ((fields.get("单位") or [""])[0]).strip()[:12]
    items: list[dict] = []
    for line in fields.get("条目", []):
        parts = [p.strip() for p in line.split("|")]
        if len(parts) != 2:
            continue
        value = _parse_number(parts[1])
        if not parts[0] or value is None or value < 0:
            continue
        items.append({"label": parts[0][:30], "value": value})
    if not 2 <= len(items) <= _LIMITS["rows"]:
        return None
    return {
        "type": "interactive", "blockId": block_id, "component": "bar-compare",
        "title": title or "数值对比", "intro": intro,
        "items": items, "unit": unit,
    }


def _build_before_after(fields: dict, block_id: str, title: str, intro: str) -> dict | None:
    """前后对比切换：同一事物的两个状态（非数值对比）"""
    before_text = "".join(fields.get("前", []))[:200].strip()
    after_text = "".join(fields.get("后", []))[:200].strip()
    if not before_text or not after_text:
        return None
    before_label = ((fields.get("前标签") or ["改造前"])[0]).strip()[:12]
    after_label = ((fields.get("后标签") or ["改造后"])[0]).strip()[:12]
    return {
        "type": "interactive", "blockId": block_id, "component": "before-after",
        "title": title or "前后对比", "intro": intro,
        "beforeText": before_text, "afterText": after_text,
        "beforeLabel": before_label, "afterLabel": after_label,
    }


def _degrade(component: str, title: str, intro: str, fields: dict, block_id: str) -> dict:
    """校验失败时降级为等价 markdown 块：内容不丢，只是不再可交互。"""
    lines: list[str] = []
    if title:
        lines.append(f"**{title}**")
    if intro:
        lines.append(intro)
    for key, prefix in (("参数", "参数"), ("步", None), ("节点", None), ("连线", None), ("条目", None), ("前", "改造前"), ("后", "改造后"), ("单位", "单位"), ("前标签", "前标签"), ("后标签", "后标签")):
        for raw in fields.get(key, []):
            if prefix:
                lines.append(f"- {prefix}：{raw}")
            else:
                lines.append(f"- {raw}")
    table_rows = [[c.strip() for c in raw.split("|")] for raw in fields.get("行", [])]
    table_header = [c.strip() for c in (fields.get("列") or [""]).pop().split("|")] if fields.get("列") else []
    if table_header and table_rows:
        width = max(len(table_header), max(len(r) for r in table_rows))
        lines.append("| " + " | ".join((table_header + [""] * width)[:width]) + " |")
        lines.append("| " + " | ".join(["---"] * width) + " |")
        for row in table_rows:
            lines.append("| " + " | ".join((row + [""] * width)[:width]) + " |")
    markdown = "\n\n".join("\n".join(part) for part in [lines]) if lines else ""
    return {"type": "markdown", "blockId": block_id, "markdown": markdown}
