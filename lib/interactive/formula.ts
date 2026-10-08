// lib/interactive/formula.ts — 交互组件的白名单公式求值器
//
// 设计约束（与 python-agent/services/interactive_block.py 的试算语义保持一致）：
// - 只支持：数字、中英文变量名、+ - * /、括号
// - 不支持函数、属性访问等任何可执行结构；无法识别的内容直接返回 null
// - 运行时错误（除以零、未知变量）返回 null，由调用方渲染占位符

export type FormulaVariables = Record<string, number>;

type Token = { kind: 'num'; value: number } | { kind: 'name'; value: string } | { kind: 'op'; value: string };

const TOKEN_RE = /\d+(?:\.\d+)?|[A-Za-z_\u4e00-\u9fff][\w\u4e00-\u9fff]*|[()+\-*/]/g;
const ALLOWED_RE = /^[\dA-Za-z_\u4e00-\u9fff+\-*/().\s]+$/;

function tokenize(expr: string): Token[] | null {
  if (!ALLOWED_RE.test(expr)) return null;
  const stripped = expr.replace(/\s+/g, '');
  const tokens: Token[] = [];
  let consumed = '';
  for (const match of expr.matchAll(TOKEN_RE)) {
    consumed += match[0];
    if (/^\d/.test(match[0])) tokens.push({ kind: 'num', value: Number(match[0]) });
    else if (/^[()+\-*/]$/.test(match[0])) tokens.push({ kind: 'op', value: match[0] });
    else tokens.push({ kind: 'name', value: match[0] });
  }
  if (consumed !== stripped) return null;
  return tokens;
}

/** 求值；任何错误返回 null（调用方显示“—”） */
export function evaluateFormula(expr: string, variables: FormulaVariables): number | null {
  const tokens = tokenize(expr);
  if (!tokens || tokens.length === 0) return null;
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];

  const parseExpr = (): number | null => {
    let value = parseTerm();
    if (value === null) return null;
    while (peek()?.kind === 'op' && (peek() as { value: string }).value !== '(' && ['+', '-'].includes((peek() as { value: string }).value)) {
      const op = (tokens[pos] as { kind: 'op'; value: string }).value;
      pos += 1;
      const rhs = parseTerm();
      if (rhs === null) return null;
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  };

  const parseTerm = (): number | null => {
    let value = parseFactor();
    if (value === null) return null;
    while (peek()?.kind === 'op' && ['*', '/'].includes((peek() as { value: string }).value)) {
      const op = (tokens[pos] as { kind: 'op'; value: string }).value;
      pos += 1;
      const rhs = parseFactor();
      if (rhs === null) return null;
      if (op === '*') value = value * rhs;
      else {
        if (rhs === 0) return null;
        value = value / rhs;
      }
    }
    return value;
  };

  const parseFactor = (): number | null => {
    const token = peek();
    if (!token) return null;
    if (token.kind === 'op' && token.value === '(') {
      pos += 1;
      const value = parseExpr();
      if (value === null) return null;
      const closing = peek();
      if (!closing || closing.kind !== 'op' || closing.value !== ')') return null;
      pos += 1;
      return value;
    }
    if (token.kind === 'op' && (token.value === '+' || token.value === '-')) {
      pos += 1;
      const value = parseFactor();
      if (value === null) return null;
      return token.value === '+' ? value : -value;
    }
    if (token.kind === 'num') {
      pos += 1;
      return token.value;
    }
    if (token.kind === 'name') {
      pos += 1;
      if (!(token.value in variables)) return null;
      return variables[token.value];
    }
    return null;
  };

  const value = parseExpr();
  if (value === null || pos !== tokens.length) return null;
  return value;
}
