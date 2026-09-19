#!/bin/bash
# scripts/quality-gate.sh — P5.3 统一质量门：一条命令跑全部质量检查
# 用法：
#   ./scripts/quality-gate.sh              # 基线（TS 测试 + tsc + lint + pytest）
#   ./scripts/quality-gate.sh --with-llm   # 附加真实 LLM 回归（Rubric 一致性验证，约 3-5 分钟）
# 任一环节失败即整体失败（exit 1），通过则 exit 0

set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0

step() {
  local name="$1"; shift
  echo ""
  echo "━━━ $name ━━━"
  if "$@"; then
    echo "✅ $name"
    PASS=$((PASS + 1))
  else
    echo "❌ $name"
    FAIL=$((FAIL + 1))
  fi
}

run_py_tests() {
  cd python-agent && .venv/bin/python -m pytest tests/ -q --tb=short
}

run_rubric_regression() {
  cd python-agent && .venv/bin/python scripts/validate_rubric_regression.py
}

step "TypeScript 类型检查" npx tsc --noEmit
step "TypeScript 测试"      npm test --silent
step "ESLint"              npm run lint --silent
step "Python 测试"         run_py_tests

if [[ "${1:-}" == "--with-llm" ]]; then
  step "Rubric 一致性回归（真实 LLM）" run_rubric_regression
fi

echo ""
echo "━━━ 质量门结果：$PASS 通过 / $FAIL 失败 ━━━"
[ "$FAIL" -eq 0 ]
