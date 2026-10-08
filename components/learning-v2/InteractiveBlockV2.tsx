'use client';

// components/learning-v2/InteractiveBlockV2.tsx
// Phase 1 交互组件渲染器（消费型演示，不计入掌握度证据）：
// - parameter-demo：改参数看结果（命名变量公式，白名单求值器）
// - step-walkthrough：分步演示
// 设计规则见 design-system/MASTER.md 与交互组件设计稿：
// 无对错判定；组件数据来自 schema 校验后的结构化块；未知组件不渲染本器

import * as React from 'react';
import { useMemo, useState } from 'react';
import type { InteractiveBlock } from '@/types/learning-v2/learning-stream';
import { evaluateFormula } from '@/lib/interactive/formula';
import { FlowDiagramView } from './FlowDiagramView';

const MAX_ROWS = 12;

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function LabelChip() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-[10px] font-semibold text-brand">
      <span className="h-1 w-1 rounded-full bg-current opacity-70" aria-hidden />
      互动演示
    </span>
  );
}

function ParameterDemoView({ block }: { block: InteractiveBlock }) {
  const parameters = block.parameters ?? [];
  const columns = block.columns ?? [];
  const rows = (block.rows ?? []).slice(0, MAX_ROWS);

  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(parameters.map((parameter) => [parameter.name, parameter.value])),
  );
  const [flash, setFlash] = useState(false);

  const setParameter = (name: string, raw: number) => {
    const parameter = parameters.find((item) => item.name === name);
    if (!parameter) return;
    const clamped = Math.min(parameter.max, Math.max(parameter.min, raw));
    setValues((previous) => ({ ...previous, [name]: clamped }));
    setFlash(true);
    window.setTimeout(() => setFlash(false), 500);
  };

  const evaluatedRows = useMemo(
    () =>
      rows.map((row) => ({
        label: row.label,
        cells: row.values.map((cell) => {
          if (typeof cell === 'number') return { kind: 'number' as const, value: cell };
          const variables: Record<string, number> = { ...values };
          columns.forEach((column, index) => {
            const cellValue = row.values[index];
            if (typeof cellValue === 'number') variables[column] = cellValue;
          });
          const result = evaluateFormula(cell.formula, variables);
          return { kind: 'formula' as const, value: result, formula: cell.formula };
        }),
      })),
    [rows, columns, values],
  );

  return (
    <div>
      {block.intro ? <p className="mb-3 text-[14px] leading-relaxed text-secondary">{block.intro}</p> : null}

      {parameters.length > 0 && (
        <div className="mb-4 space-y-2">
          {parameters.map((parameter) => (
            <div key={parameter.name} className="flex items-center justify-between gap-3 rounded-lg bg-subtle px-3 py-2">
              <span className="text-[14px] font-medium text-primary">{parameter.name}</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setParameter(parameter.name, (values[parameter.name] ?? parameter.value) - parameter.step)}
                  className="flex h-11 w-11 items-center justify-center rounded-lg border border-border-strong bg-surface text-[18px] text-primary transition-colors hover:bg-subtle"
                  aria-label={`减小${parameter.name}`}
                >
                  −
                </button>
                <input
                  type="number"
                  inputMode="decimal"
                  value={values[parameter.name] ?? parameter.value}
                  min={parameter.min}
                  max={parameter.max}
                  step={parameter.step}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (!Number.isNaN(next)) setParameter(parameter.name, next);
                  }}
                  aria-label={parameter.name}
                  className="h-11 w-20 rounded-lg border border-border-strong bg-surface text-center text-[15px] font-semibold tabular-nums text-primary focus:border-brand focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setParameter(parameter.name, (values[parameter.name] ?? parameter.value) + parameter.step)}
                  className="flex h-11 w-11 items-center justify-center rounded-lg border border-border-strong bg-surface text-[18px] text-primary transition-colors hover:bg-subtle"
                  aria-label={`增大${parameter.name}`}
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="bg-subtle">
              <th className="px-3 py-2.5 text-left font-semibold text-primary">{'\u00A0'}</th>
              {columns.map((column) => (
                <th key={column} className="px-3 py-2.5 text-left font-semibold text-primary">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {evaluatedRows.map((row) => (
              <tr key={row.label} className="border-t border-border">
                <td className="px-3 py-2.5 font-medium text-primary">{row.label}</td>
                {row.cells.map((cell, index) => (
                  <td
                    key={`${row.label}-${columns[index]}`}
                    className={`px-3 py-2.5 tabular-nums transition-colors duration-300 ${
                      cell.kind === 'formula'
                        ? `bg-brand-soft font-semibold text-brand ${flash ? 'bg-achieve-soft' : ''}`
                        : 'text-secondary'
                    }`}
                  >
                    {cell.value === null ? '—' : formatNumber(cell.value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StepWalkthroughView({ block }: { block: InteractiveBlock }) {
  const steps = block.steps ?? [];
  const [index, setIndex] = useState(0);
  const current = steps[index];

  if (!current) return null;

  return (
    <div>
      {block.intro ? <p className="mb-3 text-[14px] leading-relaxed text-secondary">{block.intro}</p> : null}

      <ol className="space-y-2">
        {steps.map((step, stepIndex) => {
          const state = stepIndex < index ? 'done' : stepIndex === index ? 'current' : 'todo';
          return (
            <li
              key={`${step.title}-${stepIndex}`}
              className={`rounded-xl border p-3 transition-colors duration-200 ${
                state === 'current'
                  ? 'border-brand bg-brand-soft'
                  : state === 'done'
                    ? 'border-border bg-surface opacity-70'
                    : 'border-border bg-surface'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums ${
                    state === 'done'
                      ? 'bg-success/10 text-success'
                      : state === 'current'
                        ? 'bg-brand text-white'
                        : 'bg-subtle text-tertiary'
                  }`}
                >
                  {state === 'done' ? '✓' : stepIndex + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-[15px] font-semibold ${state === 'current' ? 'text-primary' : 'text-secondary'}`}>
                    {step.title}
                  </p>
                  {state === 'current' && (
                    <p className="mt-1 text-[14px] leading-relaxed text-secondary" aria-live="polite">
                      {step.detail}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-[12px] tabular-nums text-tertiary">
          第 {index + 1} / {steps.length} 步
        </span>
        <div className="flex gap-2">
          {index > 0 && (
            <button
              type="button"
              onClick={() => setIndex((value) => Math.max(0, value - 1))}
              className="inline-flex h-11 items-center rounded-lg border border-border-strong bg-surface px-4 text-[14px] font-medium text-primary transition-colors hover:bg-subtle"
            >
              上一步
            </button>
          )}
          {index < steps.length - 1 ? (
            <button
              type="button"
              onClick={() => setIndex((value) => Math.min(steps.length - 1, value + 1))}
              className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-brand px-4 text-[14px] font-semibold text-white transition-colors hover:bg-brand-hover"
            >
              下一步
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIndex(0)}
              className="inline-flex h-11 items-center rounded-lg border border-border-strong bg-surface px-4 text-[14px] font-medium text-secondary transition-colors hover:bg-subtle"
            >
              重新演示
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function InteractiveBlockV2({ block }: { block: InteractiveBlock }) {
  return (
    <section className="my-5 overflow-hidden rounded-2xl border border-border bg-surface p-4" data-interactive-component={block.component}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <LabelChip />
        <span className="text-[11px] text-tertiary">不计入测评</span>
      </div>
      <h3 className="mb-3 text-[16px] font-semibold leading-snug text-primary">{block.title}</h3>
      {block.component === 'parameter-demo' ? (
        <ParameterDemoView block={block} />
      ) : block.component === 'step-walkthrough' ? (
        <StepWalkthroughView block={block} />
      ) : block.component === 'flow-diagram' ? (
        <FlowDiagramView block={block} />
      ) : null}
    </section>
  );
}
