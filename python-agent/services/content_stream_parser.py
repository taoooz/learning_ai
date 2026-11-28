"""
Content Recipe 流式解析器

LLM 按 prompt 约束输出 :::type…::: 定界符标记的结构化块。
解析器将混合输出实时拆分：
- markdown 段落 → 尽可能按字符增量输出；完整行用于识别 ::: 标记
- :::type…::: 结构化块 → 缓存到完整后解析为结构化块 dict 一次性产出

块 ID 全局递增（b1、b2…），markdown 与结构化块共享序号。
"""
import re

_START_RE = re.compile(r"^:::(\w+)\s*$")
_END_RE = re.compile(r"^:::\s*$")

_STRUCTURED_TYPES = {"key_point", "example", "comparison", "diagram", "interactive"}
# markdown 块内的证据引用行（如「证据：ev-01, ev-02」），剥离为结构化引用而非正文
_EVIDENCE_LINE_RE = re.compile(r"^证据[:：]\s*(ev[\w\s,，、-]+)$")
# 支持流式渐进渲染的文本型块：开标记出现即发块壳，内容逐行更新
_STREAMABLE_STRUCTURED = {"key_point", "example"}

# I15 引用卫生：内部证据编号 ev-XX-XXXXXX 绝不应出现在学习者面向正文。
# 既有 _EVIDENCE_LINE_RE 只剥整行「证据：ev-…」；此处补齐行内形态：
# 「来源：」前缀、纯 ev-ID 括号「（来源：ev-…）」、追加在真实引用后的「，ev-XX」token。
_EV_ID = r"ev-\d+(?:-[0-9a-f]+)?"
_EV_LIST = _EV_ID + r"(?:\s*[、,，]\s*" + _EV_ID + r")*"


def strip_evidence_ids(text: str) -> str:
    """剥离散文中的内部证据编号及其引用脚手架，保留真实来源名与 URL。"""
    if not isinstance(text, str) or "ev-" not in text:
        return text
    # 1) 整个括号只含 ev-ID（可带 来源/证据 前缀）→ 删括号
    text = re.sub(r"[（(]\s*(?:来源[:：]|证据[:：])?\s*" + _EV_LIST + r"\s*[）)]", "", text)
    # 2) 独立的「来源：ev-…」/「证据：ev-…」短语（仅 ev-ID）→ 删短语
    text = re.sub(r"(?:来源[:：]|证据[:：])\s*" + _EV_LIST, "", text)
    # 3) 追加在真实引用后的 ev-ID token（，ev-XX / 、ev-XX / , ev-XX / 见 ev-XX）
    text = re.sub(r"\s*[、,，]\s*(?:见\s*)?" + _EV_ID, "", text)
    text = re.sub(r"\s+见\s*" + _EV_ID, "", text)
    # 4) 残留裸 ev-ID
    text = re.sub(_EV_ID, "", text)
    # 5) 清理悬空标点/空白
    text = re.sub(r"[ \t]+）", "）", text)
    text = re.sub(r"[ \t]+\)", ")", text)
    text = re.sub(r"，\s*）", "）", text)
    text = re.sub(r",\s*\)", ")", text)
    text = re.sub(r"、\s*）", "）", text)
    text = re.sub(r"\)）", ")", text)
    text = re.sub(r"）\)", "）", text)
    text = re.sub(r"。\s*。", "。", text)
    text = re.sub(r"（\s*）", "", text)
    text = re.sub(r"\(\s*\)", "", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text


def _clean_block_prose(block: dict) -> dict:
    """对文本型块的散文字段剥离内部 ev-ID；不碰 evidenceRefs/sourceRefs 元数据与结构化载荷。"""
    btype = block.get("type")
    if btype == "markdown":
        block["markdown"] = strip_evidence_ids(block.get("markdown", ""))
    elif btype == "key_point":
        block["points"] = [strip_evidence_ids(p) for p in block.get("points", [])]
        if "title" in block:
            block["title"] = strip_evidence_ids(block["title"])
    elif btype == "example":
        for field in ("title", "context", "content", "takeaway"):
            if field in block:
                block[field] = strip_evidence_ids(block[field])
    elif btype == "comparison":
        block["columns"] = [strip_evidence_ids(c) for c in block.get("columns", [])]
        block["rows"] = [[strip_evidence_ids(c) for c in row] for row in block.get("rows", [])]
    return block


def _re_split_refs(raw: str) -> list[str]:
    return [r.strip() for r in re.split(r"[,，、]", raw)]


def _after_colon(s: str) -> str:
    for sep in ("：", ":"):
        if sep in s:
            return s.split(sep, 1)[1].strip()
    return ""


class ContentStreamParser:
    """流式状态机：markdown 模式 ↔ 结构化块模式

    markdown 内容按字符增量输出；只有可能成为 ::: 标记的前缀会等到换行后再判定，
    避免把半截标记误当成正文。结构化块仍缓存到完整后一次性产出。
    """

    def __init__(self):
        self._line_buf = ""
        self._mode = "markdown"
        self._block_lines: list[str] = []
        self._structured_id: str | None = None
        self._markdown_evidence: dict[str, list[str]] = {}
        self._id_seq = 0
        self._markdown_id: str | None = None
        self._markdown_text: dict[str, str] = {}
        self._ordered_blocks: list[dict] = []  # 按出现顺序收集的完成块

    def feed(self, delta: str) -> list[dict]:
        self._line_buf += delta
        events: list[dict] = []
        while "\n" in self._line_buf:
            line, self._line_buf = self._line_buf.split("\n", 1)
            events.extend(self._handle_line(line))

        # 行缓冲原本会让 markdown 一直等到换行才展示。为了更接近文字流，
        # 这里在安全时把未满一行的正文立即发出；::: 标记前缀继续缓冲。
        if self._mode == "markdown" and self._line_buf and not self._line_buf.lstrip().startswith(":"):
            delta = self._line_buf
            self._line_buf = ""
            self._ensure_markdown_block()
            self._markdown_text[self._markdown_id] += delta
            events.append({"kind": "markdown_delta", "blockId": self._markdown_id, "delta": delta})
        return events

    def finish(self) -> list[dict]:
        events: list[dict] = []
        if self._line_buf.strip():
            events.extend(self._handle_line(self._line_buf))
        self._line_buf = ""

        if self._mode != "markdown":
            fallback = "\n".join(self._block_lines)
            if fallback.strip():
                self._ensure_markdown_block()
                self._markdown_text[self._markdown_id] += fallback
                events.append({"kind": "markdown_delta", "blockId": self._markdown_id, "delta": fallback})
            self._mode = "markdown"
            self._block_lines = []

        if self._markdown_id:
            events.append(self._close_markdown())
            self._markdown_id = None

        return events

    def collect_blocks(self) -> list[dict]:
        """按出现顺序返回已完成的内容块列表（用于 task_completed）"""
        return [_clean_block_prose(block) for block in self._ordered_blocks]

    def _handle_line(self, line: str) -> list[dict]:
        events: list[dict] = []
        stripped = line.strip()

        if self._mode == "markdown":
            m = _START_RE.match(stripped)
            if m:
                if self._markdown_id:
                    events.append(self._close_markdown())
                    self._markdown_id = None
                block_type = m.group(1)
                if block_type in _STRUCTURED_TYPES:
                    self._mode = block_type
                    self._block_lines = []
                    # 块壳先行：文本型块（example/key_point）在开标记出现时立即
                    # 发出骨架块，之后每行增量更新，让样式与内容随生成逐步呈现
                    if block_type in _STREAMABLE_STRUCTURED:
                        self._structured_id = f"b{self._id_seq + 1}"
                        skeleton = self._partial_structured(block_type, [], self._structured_id)
                        events.append({"kind": "structured_started", "block": skeleton})
                return events

            m_ev = _EVIDENCE_LINE_RE.match(stripped)
            if m_ev:
                # 证据引用行：不计入正文，挂到当前 markdown 块的 evidenceRefs
                refs = [r.strip() for r in _re_split_refs(m_ev.group(1)) if r.strip()]
                self._markdown_evidence.setdefault(self._markdown_id, []).extend(refs)
                return events
            self._ensure_markdown_block()
            self._markdown_text[self._markdown_id] += line + "\n"
            events.append({"kind": "markdown_delta", "blockId": self._markdown_id, "delta": line + "\n"})
        else:
            if _END_RE.match(stripped):
                block = self._parse_structured(self._mode, self._block_lines)
                if block:
                    self._ordered_blocks.append(block)
                    events.append({"kind": "structured_block", "block": block})
                elif self._mode in _STREAMABLE_STRUCTURED and self._structured_id:
                    # 完整校验失败但已有部分内容：降级为 markdown，避免骨架块悬挂
                    raw = "\n".join(self._block_lines).strip()
                    if raw:
                        degrade = {"type": "markdown", "blockId": self._structured_id, "markdown": raw}
                        self._ordered_blocks.append(degrade)
                        events.append({"kind": "structured_block", "block": degrade})
                self._structured_id = None
                self._mode = "markdown"
                self._block_lines = []
            else:
                self._block_lines.append(line)
                if self._mode in _STREAMABLE_STRUCTURED and self._structured_id:
                    partial = self._partial_structured(self._mode, self._block_lines, self._structured_id)
                    if partial:
                        events.append({"kind": "structured_delta", "block": partial})

        return events

    def _ensure_markdown_block(self):
        if not self._markdown_id:
            self._id_seq += 1
            self._markdown_id = f"b{self._id_seq}"
            self._markdown_text[self._markdown_id] = ""

    def _close_markdown(self) -> dict:
        md = self._markdown_text[self._markdown_id]
        block = {"type": "markdown", "blockId": self._markdown_id, "markdown": md}
        refs = self._markdown_evidence.pop(self._markdown_id, [])
        if refs:
            block["evidenceRefs"] = refs
        if md.strip():
            self._ordered_blocks.append(block)
        return {"kind": "markdown_end", "blockId": self._markdown_id, "markdown": md}

    # ---- 结构化块解析 ----

    def _parse_structured(self, block_type: str, lines: list[str]) -> dict | None:
        self._id_seq += 1
        block_id = f"b{self._id_seq}"
        # 证据行不属于教学内容，先抽出 evidenceRefs，避免混入要点/例子/图源码。
        evidence_refs: list[str] = []
        content_lines: list[str] = []
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("证据：") or stripped.startswith("证据:"):
                refs = _after_colon(stripped)
                evidence_refs.extend(ref.strip() for ref in refs.replace("，", ",").split(",") if ref.strip())
            else:
                content_lines.append(line)

        parser_fn = {
            "key_point": self._parse_key_point,
            "example": self._parse_example,
            "comparison": self._parse_comparison,
            "diagram": self._parse_diagram,
        }.get(block_type)
        if block_type == "interactive":
            # 交互组件块：解析/校验/降级都在 interactive_block 内完成
            from services.interactive_block import parse_interactive_content
            return parse_interactive_content(content_lines, block_id)
        if not parser_fn:
            return None
        block = parser_fn(content_lines, block_id)
        if block and evidence_refs:
            block["evidenceRefs"] = evidence_refs
        return block

    def _partial_structured(self, block_type: str, lines: list[str], block_id: str) -> dict | None:
        """容错解析部分内容：字段缺省为空，不要求完整性。仅文本型块使用。"""
        if block_type == "key_point":
            title = None
            points: list[str] = []
            for line in lines:
                stripped = line.strip()
                if not stripped:
                    continue
                if stripped.startswith(("标题：", "标题:")):
                    title = _after_colon(stripped)
                elif stripped.startswith(("- ", "• ", "* ")):
                    points.append(stripped[2:].strip())
                else:
                    points.append(stripped)
            block: dict = {"type": "key_point", "blockId": block_id, "points": points}
            if title:
                block["title"] = title
            return block
        if block_type == "example":
            title = ""
            context = ""
            content_lines: list[str] = []
            takeaway = ""
            in_content = False
            for line in lines:
                stripped = line.strip()
                if not stripped:
                    if in_content:
                        content_lines.append("")
                    continue
                if stripped.startswith(("标题：", "标题:")):
                    title = _after_colon(stripped)
                    in_content = False
                elif stripped.startswith(("场景：", "场景:")):
                    context = _after_colon(stripped)
                    in_content = False
                elif stripped.startswith(("内容：", "内容:")):
                    rest = _after_colon(stripped)
                    if rest:
                        content_lines.append(rest)
                    in_content = True
                elif stripped.startswith(("要点：", "要点:")):
                    takeaway = _after_colon(stripped)
                    in_content = False
                elif in_content:
                    # 保留原始缩进（代码围栏内容），与 _parse_example 一致。
                    content_lines.append(line)
            return {
                "type": "example", "blockId": block_id,
                "title": title or "示例", "context": context,
                "content": "\n".join(content_lines), "takeaway": takeaway,
            }
        return None

    def _parse_key_point(self, lines: list[str], block_id: str) -> dict | None:
        title = None
        points: list[str] = []
        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue
            if stripped.startswith("标题：") or stripped.startswith("标题:"):
                title = _after_colon(stripped)
            elif stripped.startswith("- ") or stripped.startswith("• ") or stripped.startswith("* "):
                points.append(stripped[2:].strip())
            else:
                points.append(stripped)
        if not points:
            return None
        block: dict = {"type": "key_point", "blockId": block_id, "points": points}
        if title:
            block["title"] = title
        return block

    def _parse_example(self, lines: list[str], block_id: str) -> dict | None:
        title = ""
        context = ""
        content_lines: list[str] = []
        takeaway = ""
        in_content = False
        for line in lines:
            stripped = line.strip()
            if not stripped:
                if in_content:
                    content_lines.append("")
                continue
            if stripped.startswith("标题：") or stripped.startswith("标题:"):
                title = _after_colon(stripped)
                in_content = False
            elif stripped.startswith("场景：") or stripped.startswith("场景:"):
                context = _after_colon(stripped)
                in_content = False
            elif stripped.startswith("内容：") or stripped.startswith("内容:"):
                rest = _after_colon(stripped)
                if rest:
                    content_lines.append(rest)
                in_content = True
            elif stripped.startswith("要点：") or stripped.startswith("要点:"):
                takeaway = _after_colon(stripped)
                in_content = False
            elif in_content:
                # 保留原始缩进：示例内容常含代码围栏，strip 会剥掉代码缩进致 IndentationError。
                content_lines.append(line)
        content = "\n".join(content_lines).strip()
        if not content:
            return None
        return {
            "type": "example", "blockId": block_id,
            "title": title or "示例", "context": context,
            "content": content, "takeaway": takeaway,
        }

    def _parse_comparison(self, lines: list[str], block_id: str) -> dict | None:
        columns: list[str] = []
        rows: list[list[str]] = []
        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue
            if stripped.startswith("列：") or stripped.startswith("列:"):
                columns = [c.strip() for c in _after_colon(stripped).split("|") if c.strip()]
            elif stripped.startswith("|"):
                cells = [c.strip() for c in stripped.strip("|").split("|")]
                cells = [c for c in cells if c and not re.match(r"^[-:]+$", c)]
                if cells:
                    if not columns:
                        columns = cells
                    else:
                        rows.append(cells)
            else:
                row = [c.strip() for c in stripped.split("|") if c.strip()]
                if row:
                    rows.append(row)
        if not columns or not rows:
            return None
        return {"type": "comparison", "blockId": block_id, "columns": columns, "rows": rows}

    def _parse_diagram(self, lines: list[str], block_id: str) -> dict | None:
        source = chr(10).join(line for line in lines).strip()
        if not source:
            return None
        return {"type": "diagram", "blockId": block_id, "language": "mermaid", "source": source}


def parse_content_blocks(text: str) -> list[dict]:
    """解析完整文本为内容块列表；无定界符时退化为单个 markdown 块"""
    parser = ContentStreamParser()
    parser.feed(text)
    parser.finish()
    blocks = parser.collect_blocks()
    if not blocks:
        clean = text.strip()
        if clean:
            blocks = [{"type": "markdown", "blockId": "b1", "markdown": clean}]
    return blocks
