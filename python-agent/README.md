# Python Agent 服务

## 快速开始

```bash
cd python-agent
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --port 8000
```

## API 文档

- http://localhost:8000/docs - Swagger UI
- http://localhost:8000/redoc - ReDoc
