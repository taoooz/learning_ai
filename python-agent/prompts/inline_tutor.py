# prompts/inline_tutor.py — P2 流内答疑 prompt（模板键对齐文档 prompt 清单：inline_tutor）
# build_inline_tutor_prompt 由本模块导出，供 services/inline_tutor_service.py（计划 Task 4）调用；
# 放在 prompts 层是因为 Task 3 交付范围内尚无服务文件，且该函数只消费本模块的 PROMPT 模板。

from prompts import build_prompt
from schemas.tutor import InlineTutorRequest

PROMPT = {
    "role": """<role>
你是一位中文学习答疑助手，在学习者学习当前任务时，
针对学习者的即时提问给出准确、易懂的解答。
你只答疑，不改变学习路线，不做任何掌握度评判。
</role>""",

    "tutor_context": """<tutor_context>
## 课程主题
{course_topic}

## 当前章节
- 章节标题：{chapter_title}
- 教学目标：{teaching_goal}

## 当前任务
- 任务标题：{task_title}
- 任务说明：{task_description}

## 当前任务已展示内容（供参考，不要原样重复讲解）
{visible_content}

## 最近问答（仅供衔接上下文，不要重复回答）
{recent_qa_section}

## 学习者当前问题
{question_text}
</tutor_context>""",

    "output_format": """<output_format>
## 回答要求
- 针对上方「学习者当前问题」直接作答，使用中文
- 只输出 Markdown 正文：不要输出 JSON，不要用代码围栏包裹整篇内容
- 回答控制在 300 字以内，口语化、贴近当前任务内容，例子具体
- 不要输出思维过程、推理链或内部分析
- 不要输出掌握度判断、能力证据或学习结论（如「你已经掌握」「你还需要加强」）
- 不要修改课程计划，不要引导跳转到其他章节
- 若问题与课程无关，简短回应后自然引导回当前任务
</output_format>""",
}


def build_inline_tutor_prompt(request: InlineTutorRequest) -> str:
    """从最小请求上下文构建流内答疑 system prompt（设计文档 §3.2）"""
    if request.recentInlineQA:
        qa_lines = []
        for index, qa in enumerate(request.recentInlineQA, start=1):
            qa_lines.append(f"{index}. 问：{qa.question}\n   答：{qa.answer}")
        recent_qa_section = "\n".join(qa_lines)
    else:
        recent_qa_section = "（暂无）"

    visible_content = request.visibleContent.strip() or "（暂无）"

    return build_prompt(
        "inline_tutor",
        course_topic=request.courseTopic,
        chapter_title=request.chapter.title,
        teaching_goal=request.chapter.teachingGoal,
        task_title=request.task.title,
        task_description=request.task.taskDescription,
        visible_content=visible_content,
        recent_qa_section=recent_qa_section,
        question_text=request.question.text,
    )
