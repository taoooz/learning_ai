# prompts/__init__.py — Prompt 加载器
# 借鉴 DeepTutor 的 PromptManager，但使用 Python dict 代替 YAML（零依赖）
# 每个 prompt 是 prompts/ 目录下的一个 Python 模块，导出 PROMPT dict
#
# 用法：
#   from prompts import get_prompt, build_prompt, reload_prompts
#   system_text = get_prompt("outline", "system", topic="AI", today="2026-04-20")
#   full_text = build_prompt("outline", topic="AI", today="2026-04-20")

from typing import Optional
import importlib


_CACHE: dict[str, dict] = {}


def _load_module(name: str) -> dict:
    """动态导入 prompts/{name}.py 模块，返回其 PROMPT dict"""
    if name in _CACHE:
        return _CACHE[name]

    module = importlib.import_module(f"prompts.{name}")
    data = getattr(module, "PROMPT", {})
    _CACHE[name] = data
    return data


def get_prompt(name: str, key: str, **kwargs) -> str:
    """获取 prompt 中的某个片段并格式化

    Args:
        name: prompt 模块名（如 "outline", "toc"）
        key: PROMPT dict 中的键名（如 "system", "rules"）
        **kwargs: 模板变量

    Returns:
        str: 格式化后的文本
    """
    data = _load_module(name)
    template = data.get(key, "")
    if not template:
        return ""
    return template.format(**kwargs) if kwargs else template


def build_prompt(name: str, sections: list[str] | None = None, **kwargs) -> str:
    """拼接多个 prompt 片段为完整 prompt

    Args:
        name: prompt 模块名
        sections: 要拼接的键名列表，None 则拼接所有字符串值
        **kwargs: 模板变量

    Returns:
        str: 拼接并格式化后的完整 prompt
    """
    data = _load_module(name)
    parts = []

    if sections:
        for key in sections:
            text = data.get(key, "")
            if text:
                parts.append(text.format(**kwargs) if kwargs else text)
    else:
        for value in data.values():
            if isinstance(value, str):
                parts.append(value.format(**kwargs) if kwargs else value)

    return "\n\n".join(parts)


def reload_prompts(name: Optional[str] = None) -> None:
    """清除缓存，下次加载时重新 import

    Args:
        name: 指定模块名，None 则清除全部
    """
    if name:
        _CACHE.pop(name, None)
        # 清除 importlib 缓存以便重新加载
        import sys
        module_name = f"prompts.{name}"
        if module_name in sys.modules:
            del sys.modules[module_name]
    else:
        _CACHE.clear()
        import sys
        to_remove = [k for k in sys.modules if k.startswith("prompts.") and k != "prompts"]
        for k in to_remove:
            del sys.modules[k]
