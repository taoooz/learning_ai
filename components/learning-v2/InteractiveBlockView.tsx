'use client';

// components/learning-v2/InteractiveBlockView.tsx
// 交互组件渲染入口：注册表模式，新增组件 = 新增一个 View + 一条注册
// Phase 1：parameter-demo / step-walkthrough / flow-diagram（消费型演示）
// Phase 2：bar-compare / before-after（对比可视化）；完成时记录参与信号
// （engagement 信号不计入掌握度证据——掌握度只来自 Checkpoint 评估）

import * as React from 'react';
import { useMemo, useRef, useState } from 'react';
import type { InteractiveBlock } from '@/types/learning-v2/learning-stream';
import { evaluateFormula } from '@/lib/interactive/formula';
import { recordEngagementEvent } from '@/lib/learning-v2/engagement';
import { FlowDiagramView } from './FlowDiagramView';

const MAX_ROWS = 12;

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function LabelChip() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-brand px-2.5 py-1 text-[10px] font-semibold text-white">
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
      互动演示
    </span>
  );
}

/** 体验完成信号：每块只记一次，静默失败（engagement 基建原则） */
function useInteractiveCompletion(courseId: string | undefined, component: string) {
  const recordedRef = useRef(false);
  return React.useCallback(() => {
    if (recordedRef.current || !courseId) return;
    recordedRef.current = true;
    recordEngagementEvent(courseId, { eventType: 'interactive_completed', component });
  }, [courseId, component]);
}

// ---- parameter-demo ----

function ParameterDemoView({ block, courseId }: { block: InteractiveBlock; courseId?: string }) {
  const parameters = block.parameters ?? [];
  const columns = block.columns ?? [];
  const rows = (block.rows ?? []).slice(0, MAX_ROWS);
  const onCompleted = useInteractiveCompletion(courseId, 'parameter-demo');

  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(parameters.map((parameter) => [parameter.name, parameter.value])),
  );
  const [flash, setFlash] = useState(false);
  const [completed, setCompleted] = useState(false);

  const setParameter = (name: string, raw: number) => {
    const parameter = parameters.find((item) => item.name === name);
    if (!parameter) return;
    const clamped = Math.min(parameter.max, Math.max(parameter.min, raw));
    setValues((previous) => ({ ...previous, [name]: clamped }));
    setFlash(true);
    setCompleted(true);
    onCompleted();
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

      <div className="mb-4 space-y-2">
        {parameters.map((parameter) => (
          <div key={parameter.name} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-subtle px-3 py-2">
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

// ---- step-walkthrough ----

function StepWalkthroughView({ block, courseId }: { block: InteractiveBlock; courseId?: string }) {
  const steps = block.steps ?? [];
  const [index, setIndex] = useState(0);
  const [completed, setCompleted] = useState(false);
  const onCompleted = useInteractiveCompletion(courseId, 'step-walkthrough');
  const current = steps[index];

  const goTo = (next: number) => {
    setIndex(next);
    if (next === steps.length - 1) {
      setCompleted(true);
      onCompleted();
    }
  };

  if (!current) return null;

  return (
    <div>
      {block.intro ? <p className="mb-3 text-[14px] leading-relaxed text-secondary">{block.intro}</p> : null}

      <ol>
        {steps.map((step, stepIndex) => {
          const state = stepIndex < index ? 'done' : stepIndex === index ? 'current' : 'todo';
          return (
            <li
              key={`${step.title}-${stepIndex}`}
              className={`p-3 transition-colors duration-200 ${
                state === 'current' ? 'rounded-xl bg-brand-soft' : 'border-b border-border last:border-b-0'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums ${
                    state === 'done'
                      ? 'bg-success/10 text-success'
                      : state === 'current'
                        ? 'bg-brand text-white'
                        : 'bg-surface text-tertiary ring-1 ring-border'
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
              onClick={() => goTo(index - 1)}
              className="inline-flex h-11 items-center rounded-lg border border-border-strong bg-surface px-4 text-[14px] font-medium text-primary transition-colors hover:bg-subtle"
            >
              上一步
            </button>
          )}
          {index < steps.length - 1 ? (
            <button
              type="button"
              onClick={() => goTo(index + 1)}
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
              onClick={() => goTo(0)}
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

// ---- bar-compare ----

function BarCompareView({ block }: { block: InteractiveBlock }) {
  const items = (block.items ?? []).slice(0, MAX_ROWS);
  const max = Math.max(...items.map((item) => item.value), 1);

  return (
    <div>
      {block.intro ? <p className="mb-3 text-[14px] leading-relaxed text-secondary">{block.intro}</p> : null}
      <div className="space-y-2.5">
        {items.map((item) => (
          <div key={item.label}>
            <div className="mb-1 flex items-center justify-between text-[13px]">
              <span className="font-medium text-primary">{item.label}</span>
              <span className="tabular-nums text-secondary">
                {formatNumber(item.value)}
                {block.unit ? ` ${block.unit}` : ''}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-subtle" role="img" aria-label={`${item.label}：${item.value} ${block.unit ?? ''}`}>
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-500"
                style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- before-after ----

function BeforeAfterView({ block, courseId }: { block: InteractiveBlock; courseId?: string }) {
  const [showAfter, setShowAfter] = useState(false);
  const [completed, setCompleted] = useState(false);
  const onCompleted = useInteractiveCompletion(courseId, 'before-after');

  const toggle = (toAfter: boolean) => {
    setShowAfter(toAfter);
    if (toAfter && !completed) {
      setCompleted(true);
      onCompleted();
    }
  };

  return (
    <div>
      {block.intro ? <p className="mb-3 text-[14px] leading-relaxed text-secondary">{block.intro}</p> : null}
      <div
        className="mb-3 inline-flex rounded-full border border-border bg-surface p-1 shadow-sm"
        role="tablist"
        aria-label="前后对比切换"
      >
        {[false, true].map((after) => {
          const active = showAfter === after;
          return (
            <button
              key={String(after)}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => toggle(after)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-colors ${
                active
                  ? after
                    ? 'bg-brand text-white'
                    : 'bg-surface text-primary ring-1 ring-border-strong'
                  : 'text-tertiary hover:text-secondary'
              }`}
            >
              {after ? (
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              )}
              {after ? (block.afterLabel ?? '改造后') : (block.beforeLabel ?? '改造前')}
            </button>
          );
        })}
      </div>
      <div
        aria-live="polite"
        className={`rounded-xl border px-3.5 py-3 transition-colors ${
          showAfter ? 'border-brand/30 bg-brand-soft/60' : 'border-dashed border-border-strong bg-surface'
        }`}
      >
        <p className={`text-[14px] leading-relaxed ${showAfter ? 'text-primary' : 'text-secondary'}`}>
          {showAfter ? block.afterText : block.beforeText}
        </p>
      </div>
    </div>
  );
}

// ---- 注册表与入口 ----

const RENDERERS: Partial<Record<InteractiveBlock['component'], React.ComponentType<{ block: InteractiveBlock; courseId?: string }>>> = {
  'parameter-demo': ParameterDemoView,
  'step-walkthrough': StepWalkthroughView,
  'flow-diagram': FlowDiagramView,
  'bar-compare': BarCompareView,
  'before-after': BeforeAfterView,
};

export function InteractiveBlockView({ block, courseId }: { block: InteractiveBlock; courseId?: string }) {
  const Renderer = RENDERERS[block.component];

  if (!Renderer) {
    // 未知组件：不应出现（服务端已降级），兜底为空，避免渲染错误
    return null;
  }

  return (
    <section
      className="my-5 overflow-hidden rounded-2xl border border-[rgba(255,138,0,0.18)] bg-[rgba(255,138,0,0.045)] shadow-sm"
      data-interactive-component={block.component}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[rgba(255,138,0,0.12)] bg-[rgba(255,138,0,0.035)] px-4 py-2.5">
        <LabelChip />
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#9A6A2F]">
          <span className="h-1.5 w-1.5 rounded-full bg-[rgba(255,138,0,0.55)]" aria-hidden />
          不计入测评
        </span>
      </div>
      <div className="p-4">
        <h3 className="mb-3 text-[16px] font-semibold leading-snug text-primary">{block.title}</h3>
        <Renderer block={block} courseId={courseId} />
      </div>
    </section>
  );
}
