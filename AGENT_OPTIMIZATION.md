# Agent 流式输出实现

## ✅ 已实现（方案A）

### 前端实现
- **API Route**：`/api/agents/outline/route.ts`
  - 自动检测 Python Agent 响应类型
  - 如果是 `text/event-stream`，转发流式响应
  - 否则正常返回 JSON（向后兼容）

- **Context**：`CourseContext.submitOutlineMessage`
  - 使用 `ReadableStream` + `TextDecoder` 解析 SSE
  - 逐行解析 `data:` 开头的事件
  - 兼容非流式响应

### Python Agent 要求

需要返回 SSE 格式的流式响应：

```python
from fastapi.responses import StreamingResponse

async def generate_stream():
    # 生成过程中发送中间状态
    yield f"data: {json.dumps({'type': 'thinking', 'message': '正在分析...'})}\n\n"
    
    # 最终结果
    result = {"type": "confirmation", "blueprint": {...}, "sessionId": "xxx"}
    yield f"data: {json.dumps(result)}\n\n"
    yield "data: [DONE]\n\n"

return StreamingResponse(
    generate_stream(),
    media_type="text/event-stream",
    headers={
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
    }
)
```

### SSE 数据格式
```
data: {"type": "thinking", "message": "正在分析..."}

data: {"type": "confirmation", "blueprint": {...}, "sessionId": "xxx"}

data: [DONE]
```

---

## 其他方案（未实施）

### 方案B：批量生成问题
- 一次性生成所有澄清问题（而非逐个生成）
- 减少请求次数

### 方案C：优化 Agent 响应速度
- 使用更快的模型
- 优化 prompt 长度
- 减少不必要的上下文
