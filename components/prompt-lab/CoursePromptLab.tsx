'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  PromptLabAssistantAction,
  PromptLabAssistantMessage,
  PromptLabAssistantResult,
  PromptLabInputValue,
  PromptLabLastRun,
  PromptLabRunConfig,
  PromptLabSession,
  PromptLabStageId,
  PromptLabStageDefinition,
  PromptLabStageState,
} from '@/types/prompt-lab';
import {
  PROMPT_LAB_STAGES,
  getNextPromptLabStage,
} from '@/lib/prompt-lab/stages';
import {
  buildPromptLabInputs,
  buildPromptLabSnapshot,
  getPromptLabBlueprint,
  hydratePromptLabSnapshot,
  type PromptLabSnapshot,
} from '@/lib/prompt-lab/defaults';
import { parsePromptLabSSE } from '@/lib/prompt-lab/sse';

const SESSION_KEY = 'ai-learning-prompt-lab-v1';

type OutputTab = 'thinking' | 'output' | 'parsed' | 'tools';

type PromptLabClarificationQuestion = {
  id: string;
  question: string;
  options: string[];
};

function jsonText(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

function loadSession(): PromptLabSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PromptLabSession;
    if (parsed.version !== 4 || !parsed.activeStage || !parsed.stages || !parsed.artifacts) return null;
    return parsed;
  } catch {
    return null;
  }
}

function coerceInputs(stageId: PromptLabStageId, inputs: Record<string, PromptLabInputValue>): Record<string, unknown> {
  const definition = PROMPT_LAB_STAGES.find((stage) => stage.id === stageId);
  if (!definition) return inputs;
  const result: Record<string, unknown> = {};
  for (const field of definition.fields) {
    const value = inputs[field.key];
    if (field.type === 'json') {
      const text = String(value ?? '').trim();
      if (!text) {
        result[field.key] = null;
        continue;
      }
      try {
        result[field.key] = JSON.parse(text);
      } catch {
        throw new Error(`${field.label} 不是合法 JSON`);
      }
    } else {
      result[field.key] = value;
    }
  }
  return result;
}

function createEmptyStageState(inputs: Record<string, PromptLabInputValue>): PromptLabStageState {
  return {
    inputs,
    systemPrompt: '',
    userMessage: '',
    promptDirty: false,
    config: {
      toolsEnabled: false,
      maxTokens: 8000,
      maxSearches: 0,
      maxIterations: 1,
      reasoningEffort: 'none',
    },
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractClarificationQuestions(parsed: unknown): PromptLabClarificationQuestion[] {
  const questions = (parsed as { questions?: unknown } | null | undefined)?.questions;
  if (!Array.isArray(questions)) return [];
  return questions
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      id: String(item.id || ''),
      question: String(item.question || '').trim(),
      options: Array.isArray(item.options)
        ? item.options.map((option) => String(option || '').trim()).filter(Boolean)
        : [],
    }))
    .filter((item) => item.id && item.question);
}

export function CoursePromptLab() {
  const [snapshot, setSnapshot] = useState<PromptLabSnapshot | null>(null);
  const [activeStage, setActiveStage] = useState<PromptLabStageId>('outline_initial');
  const [stages, setStages] = useState<Partial<Record<PromptLabStageId, PromptLabStageState>>>({});
  const [artifacts, setArtifacts] = useState<Record<string, unknown>>({});
  const [assistantMessages, setAssistantMessages] = useState<Partial<Record<PromptLabStageId, PromptLabAssistantMessage[]>>>({});
  const artifactsRef = useRef<Record<string, unknown>>({});
  const [ready, setReady] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputTab, setOutputTab] = useState<OutputTab>('output');
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const autoCompileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCompileSignatureRef = useRef('');

  const activeDefinition = useMemo(
    () => PROMPT_LAB_STAGES.find((stage) => stage.id === activeStage) ?? PROMPT_LAB_STAGES[0],
    [activeStage],
  );
  const activeState = stages[activeStage];
  const currentArtifacts = artifacts;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const nextSnapshot = await hydratePromptLabSnapshot(buildPromptLabSnapshot());
      if (cancelled) return;
      setSnapshot(nextSnapshot);
      const saved = loadSession();
      if (saved) {
        setActiveStage(saved.activeStage);
        setStages(saved.stages);
        setAssistantMessages(saved.assistantMessages || {});
        artifactsRef.current = saved.artifacts;
        setArtifacts(saved.artifacts);
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      const session: PromptLabSession = {
        version: 4,
        activeStage,
        stages,
        artifacts,
        assistantMessages,
      };
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      } catch (saveError) {
        console.warn('[Prompt Lab] 调试会话保存失败:', saveError);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [activeStage, artifacts, assistantMessages, ready, stages]);

  const compileStage = useCallback(async (
    stageId: PromptLabStageId,
    inputs: Record<string, PromptLabInputValue>,
    options: { resetDirty?: boolean; preserveRun?: boolean; silentInputError?: boolean } = {},
  ) => {
    setIsCompiling(true);
    setError(null);
    try {
      const compiledInputs = coerceInputs(stageId, inputs);
      const response = await fetch('/api/debug/course-pipeline/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: stageId, inputs: compiledInputs }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || payload.detail || 'Prompt 编译失败');
      lastCompileSignatureRef.current = `${stageId}:${JSON.stringify(inputs)}`;
      setStages((previous) => {
        const previousStage = previous[stageId];
        return {
          ...previous,
          [stageId]: {
            ...createEmptyStageState(inputs),
            systemPrompt: String(payload.systemPrompt || ''),
            userMessage: String(payload.userMessage || ''),
            promptDirty: options.resetDirty === false ? Boolean(previousStage?.promptDirty) : false,
            config: payload.config as PromptLabRunConfig,
            lastRun: options.preserveRun === false ? undefined : previousStage?.lastRun,
          },
        };
      });
    } catch (compileError) {
      if (!options.silentInputError) setError(formatError(compileError));
    } finally {
      setIsCompiling(false);
    }
  }, []);

  const initializeStage = useCallback(async (stageId: PromptLabStageId) => {
    if (!snapshot) return;
    const inputs = buildPromptLabInputs(stageId, snapshot, artifactsRef.current);
    setStages((previous) => ({
      ...previous,
      [stageId]: previous[stageId] ?? createEmptyStageState(inputs),
    }));
    await compileStage(stageId, inputs, { resetDirty: true, preserveRun: false });
  }, [compileStage, snapshot]);

  useEffect(() => {
    if (!ready || !snapshot || activeState) return;
    void initializeStage(activeStage);
  }, [activeStage, activeState, initializeStage, ready, snapshot]);

  useEffect(() => {
    if (!activeState || activeState.promptDirty || isCompiling || !ready) return;
    const signature = `${activeStage}:${JSON.stringify(activeState.inputs)}`;
    if (signature === lastCompileSignatureRef.current) return;
    if (autoCompileTimerRef.current) clearTimeout(autoCompileTimerRef.current);
    autoCompileTimerRef.current = setTimeout(() => {
      try {
        void compileStage(activeStage, activeState.inputs, { resetDirty: true, silentInputError: true });
      } catch {
        // 输入 JSON 尚未完成时不做打断式报错，手动刷新 Prompt 会展示具体错误。
      }
    }, 450);
    return () => {
      if (autoCompileTimerRef.current) clearTimeout(autoCompileTimerRef.current);
    };
  }, [activeStage, activeState, compileStage, isCompiling, ready]);

  const updateActiveState = useCallback((updater: (state: PromptLabStageState) => PromptLabStageState) => {
    setStages((previous) => {
      const current = previous[activeStage];
      if (!current) return previous;
      return { ...previous, [activeStage]: updater(current) };
    });
  }, [activeStage]);

  const handleInputChange = (key: string, value: PromptLabInputValue) => {
    updateActiveState((state) => ({ ...state, inputs: { ...state.inputs, [key]: value } }));
  };

  const refreshPrompt = async () => {
    if (!activeState) return;
    await compileStage(activeStage, activeState.inputs, { resetDirty: true });
  };

  const refreshFromUpstream = async () => {
    if (!snapshot) return;
    const inputs = buildPromptLabInputs(activeStage, snapshot, artifactsRef.current);
    setStages((previous) => ({ ...previous, [activeStage]: createEmptyStageState(inputs) }));
    await compileStage(activeStage, inputs, { resetDirty: true, preserveRun: false });
  };

  const recordArtifacts = useCallback((
    stageId: PromptLabStageId,
    parsed: unknown,
    validationValid: boolean,
    inputs: Record<string, unknown>,
    rawContent: string,
  ) => {
    if (!validationValid || !parsed || typeof parsed !== 'object') return;
    const previous = artifactsRef.current;
    const next: Record<string, unknown> = { ...previous };
    if (stageId === 'outline_initial' || stageId === 'outline_answer') {
      next.outline = parsed;
      next.outline_raw = rawContent;
      const outline = (parsed as { outline?: Record<string, unknown> | null }).outline;
      const direction = String(outline?.learningDirection || '').trim();
      if (direction) next.debug_topic = direction;
      const learner = outline?.learnerPositioning;
      if (learner && typeof learner === 'object') next.debug_learner = learner;
    } else if (stageId === 'architect_chapters') {
      next.architect_chapters = parsed;
      const chapterList = (parsed as Record<string, unknown>).chapters;
      if (Array.isArray(chapterList) && chapterList[0]?.chapterId) {
        next.chapterId = chapterList[0].chapterId;
      }
    } else if (stageId === 'architect_meta') {
      next.architect_meta = parsed;
      const chapters = previous.architect_chapters as Record<string, unknown> | undefined;
      if (chapters) {
        next.architecture = {
          architectureVersion: 1,
          courseTopic: chapters.courseTopic,
          chapters: chapters.chapters,
          ...(parsed as Record<string, unknown>),
        };
        if (snapshot) next.blueprint = getPromptLabBlueprint(snapshot, next);
      }
    } else if (stageId === 'architect_review') {
      next.architect_review = parsed;
    } else if (stageId === 'chapter_plan') {
      next.chapter_plan = parsed;
      next.chapterId = String(inputs.chapterId || next.chapterId || '');
    } else if (stageId === 'chapter_plan_review') {
      next.chapter_plan_review = parsed;
    } else if (stageId === 'task_search_decision') {
      next.task_search_decision = parsed;
      next.task_request = inputs.request;
    } else if (stageId === 'task_content') {
      next.task_content = parsed;
      next.task_request = inputs.request;
    }
    artifactsRef.current = next;
    setArtifacts(next);
  }, [snapshot]);

  const runPrompt = async () => {
    if (!activeState || isRunning) return;
    let compiledInputs: Record<string, unknown>;
    try {
      compiledInputs = coerceInputs(activeStage, activeState.inputs);
    } catch (inputError) {
      setError(formatError(inputError));
      return;
    }
    const history = Array.isArray(compiledInputs.history)
      ? compiledInputs.history as Array<{ role: string; content: string }>
      : [];
    setError(null);
    setIsRunning(true);
    setOutputTab('output');
    let thinking = '';
    let content = '';
    let toolResults: Array<{ tool?: string; result: string }> = [];
    let parsed: unknown;
    let validation: PromptLabLastRun['validation'];
    let metrics: PromptLabLastRun['metrics'];
    let streamError: string | undefined;
    const startedAt = Date.now();

    const patchRun = (updater: (run: PromptLabLastRun) => PromptLabLastRun) => {
      updateActiveState((state) => {
        const run = state.lastRun ?? { thinking: '', content: '', toolResults: [], startedAt };
        return { ...state, lastRun: updater(run) };
      });
    };

    patchRun(() => ({ thinking: '', content: '', toolResults: [], startedAt }));

    try {
      const response = await fetch('/api/debug/course-pipeline/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage: activeStage,
          inputs: compiledInputs,
          system_prompt: activeState.systemPrompt,
          user_message: activeState.userMessage,
          history,
          tools_enabled: activeState.config.toolsEnabled,
          max_tokens: activeState.config.maxTokens,
          max_searches: activeState.config.maxSearches,
          max_iterations: activeState.config.maxIterations,
          reasoning_effort: activeState.config.reasoningEffort,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || payload.detail || 'Prompt 运行失败');
      }

      for await (const event of parsePromptLabSSE(response)) {
        if (event.type === 'thinking') {
          thinking += event.message;
          patchRun((run) => ({ ...run, thinking }));
        } else if (event.type === 'content_delta') {
          content += event.content;
          patchRun((run) => ({ ...run, content }));
        } else if (event.type === 'tool_call' || event.type === 'tool_result') {
          if (event.type === 'tool_result') {
            toolResults = [...toolResults, { tool: event.tool, result: event.result || '' }];
          }
          patchRun((run) => ({ ...run, toolResults }));
        } else if (event.type === 'parsed') {
          parsed = event.parsed;
          validation = event.validation;
          toolResults = event.toolResults || toolResults;
          if (activeStage === 'outline_initial') {
            const questions = extractClarificationQuestions(parsed);
            if (questions.length > 0) {
              updateActiveState((state) => ({
                ...state,
                clarificationAnswers: questions.reduce<Record<string, string>>((answers, question) => {
                  answers[question.id] = state.clarificationAnswers?.[question.id] || '';
                  return answers;
                }, {}),
              }));
            }
          }
          patchRun((run) => ({
            ...run,
            parsed,
            validation,
            toolResults,
          }));
        } else if (event.type === 'metrics') {
          metrics = { elapsedMs: event.elapsedMs, finishReason: event.finishReason };
          patchRun((run) => ({ ...run, metrics }));
        } else if (event.type === 'error') {
          streamError = event.message;
          patchRun((run) => ({ ...run, error: streamError }));
        }
      }
      patchRun((run) => ({ ...run, thinking, content, toolResults, parsed, validation, metrics, error: streamError }));
      if (parsed && validation?.valid) {
        recordArtifacts(activeStage, parsed, true, compiledInputs, content);
      }
    } catch (runError) {
      const message = formatError(runError);
      setError(message);
      patchRun((run) => ({ ...run, error: message }));
    } finally {
      setIsRunning(false);
    }
  };

  const callAssistant = async (action: PromptLabAssistantAction, explicitMessage?: string) => {
    if (!activeState || assistantBusy) return;
    const message = (explicitMessage ?? assistantInput).trim()
      || (action === 'evaluate'
        ? '请评测最近一次模型输出，指出问题并给出 Prompt 改进建议。'
        : action === 'optimize_prompt'
          ? '请分析当前 Prompt，指出问题，并生成一份完整的 Prompt 改写。'
          : '');
    if (!message) return;

    let parsedInputs: Record<string, unknown> = { raw: activeState.inputs };
    let inputParseError: string | null = null;
    try {
      parsedInputs = coerceInputs(activeStage, activeState.inputs);
    } catch (parseError) {
      inputParseError = formatError(parseError);
    }
    const messagesForStage = assistantMessages[activeStage] || [];
    const userMessage: PromptLabAssistantMessage = {
      id: `assistant-user-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      role: 'user',
      content: message,
      action,
      createdAt: Date.now(),
    };
    setAssistantMessages((previous) => ({
      ...previous,
      [activeStage]: [...messagesForStage, userMessage],
    }));
    setAssistantInput('');
    setAssistantBusy(true);
    setAssistantError(null);

    try {
      const response = await fetch('/api/debug/course-pipeline/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage: activeStage,
          action,
          message,
          context: {
            stageTitle: activeDefinition.title,
            stageDescription: activeDefinition.description,
            inputs: parsedInputs,
            inputParseError,
            systemPrompt: activeState.systemPrompt,
            userMessage: activeState.userMessage,
            lastRun: activeState.lastRun || null,
          },
          history: messagesForStage.map((item) => ({ role: item.role, content: item.content })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || payload.detail || '优化助手调用失败');
      const result = payload as PromptLabAssistantResult;
      const assistantMessage: PromptLabAssistantMessage = {
        id: `assistant-result-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        role: 'assistant',
        content: String(result.answer || ''),
        result,
        createdAt: Date.now(),
      };
      setAssistantMessages((previous) => ({
        ...previous,
        [activeStage]: [...(previous[activeStage] || []), assistantMessage],
      }));
    } catch (assistantCallError) {
      setAssistantError(formatError(assistantCallError));
    } finally {
      setAssistantBusy(false);
    }
  };

  const applyAssistantRevision = (result: PromptLabAssistantResult) => {
    updateActiveState((state) => ({
      ...state,
      systemPrompt: result.revisedSystemPrompt || state.systemPrompt,
      userMessage: result.revisedUserMessage || state.userMessage,
      promptDirty: Boolean(result.revisedSystemPrompt || result.revisedUserMessage),
    }));
  };

  const dynamicNextStage = useMemo((): PromptLabStageId | null => {
    if (activeStage === 'outline_initial') {
      const parsed = activeState?.lastRun?.parsed as Record<string, unknown> | undefined;
      const questions = parsed?.questions;
      const outline = parsed?.outline;
      if (Array.isArray(questions) && questions.length > 0) return 'outline_answer';
      if (outline) return 'architect_chapters';
    }
    return getNextPromptLabStage(activeStage);
  }, [activeStage, activeState?.lastRun?.parsed]);

  const outlineQuestions = activeStage === 'outline_initial'
    ? extractClarificationQuestions(activeState?.lastRun?.parsed)
    : [];
  const outlineAnswers = activeState?.clarificationAnswers ?? {};
  const outlineClarificationComplete = outlineQuestions.length > 0
    && outlineQuestions.every((question) => Boolean(outlineAnswers[question.id]?.trim()));
  const nextButtonDisabled = Boolean(
    activeStage === 'outline_initial'
    && outlineQuestions.length > 0
    && !outlineClarificationComplete,
  );
  const nextButtonLabel = nextButtonDisabled
    ? '请先完成澄清回答'
    : dynamicNextStage === 'outline_answer'
      ? '提交回答并进入下一环节'
      : '带入下一环节';

  const moveToNextStage = async () => {
    if (!snapshot || !dynamicNextStage) return;
    if (activeStage === 'outline_initial' && dynamicNextStage === 'outline_answer' && !outlineClarificationComplete) {
      setError('请先完成全部澄清问题，再进入下一环节');
      return;
    }
    const nextInputs = buildPromptLabInputs(dynamicNextStage, snapshot, artifactsRef.current);
    if (activeStage === 'outline_initial' && dynamicNextStage === 'outline_answer') {
      nextInputs.answers = jsonText(outlineQuestions.map((question) => ({
        questionId: question.id,
        answer: outlineAnswers[question.id],
      })));
    }
    setActiveStage(dynamicNextStage);
    setStages((previous) => ({ ...previous, [dynamicNextStage]: createEmptyStageState(nextInputs) }));
    await compileStage(dynamicNextStage, nextInputs, { resetDirty: true, preserveRun: false });
  };

  const resetSession = () => {
    localStorage.removeItem(SESSION_KEY);
    artifactsRef.current = {};
    setArtifacts({});
    setStages({});
    setAssistantMessages({});
    setAssistantOpen(false);
    setAssistantInput('');
    setAssistantError(null);
    setActiveStage('outline_initial');
    setError(null);
  };

  if (!ready || !snapshot) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-secondary">
        正在加载 Prompt Lab…
      </main>
    );
  }

  const basicFields = activeDefinition.fields.filter((field) => !field.advanced);
  const advancedFields = activeDefinition.fields.filter((field) => field.advanced);
  const lastRun = activeState?.lastRun;
  const activeAssistantMessages = assistantMessages[activeStage] || [];
  const blueprintSource = currentArtifacts.blueprint ? '调试产物' : '本地课程快照';
  const memorySourceLabel = {
    server_memory_v4: '服务端 Memory V4',
    local_synthetic: '本地课程快照合成',
    mixed: 'Memory V4 + 本地兜底',
    unavailable: '暂无可用画像',
  }[snapshot.memorySource];

  return (
    <main className="flex h-screen min-h-[720px] flex-col overflow-hidden bg-[#f4f2ed] text-primary">
      <header className="z-20 border-b border-black/[0.07] bg-white/90 px-5 py-3 shadow-[0_1px_0_rgba(0,0,0,0.02)] backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-2 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-[13px] font-bold text-white">P</div>
            <div>
              <h1 className="text-[16px] font-bold leading-tight">Course Prompt Lab</h1>
              <p className="text-[11px] text-tertiary">隔离调试 · 不写入正式课程与 Memory</p>
            </div>
          </div>

          <select
            value={activeStage}
            onChange={(event) => setActiveStage(event.target.value as PromptLabStageId)}
            className="min-h-10 min-w-[240px] rounded-xl border border-black/[0.1] bg-white px-3 text-[13px] font-semibold text-primary outline-none focus:border-accent/50"
          >
            {(['课程级', '章节级'] as const).map((group) => (
              <optgroup key={group} label={group}>
                {PROMPT_LAB_STAGES.filter((stage) => stage.group === group).map((stage) => (
                  <option key={stage.id} value={stage.id}>{stage.title}</option>
                ))}
              </optgroup>
            ))}
          </select>

          <span className="rounded-full bg-accent/[0.09] px-3 py-1 text-[11px] font-semibold text-[#9a4d00]">
            {activeDefinition.description}
          </span>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {(isCompiling || isRunning) && (
              <span className="flex items-center gap-1.5 text-[12px] text-secondary">
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                {isRunning ? '模型运行中' : '重新编译 Prompt'}
              </span>
            )}
            <button
              type="button"
              onClick={() => void refreshFromUpstream()}
              className="min-h-9 rounded-full border border-black/[0.09] bg-white px-3.5 text-[12px] font-semibold text-secondary hover:bg-black/[0.025]"
            >
              从上游产物刷新输入
            </button>
            <button
              type="button"
              onClick={() => setAssistantOpen((open) => !open)}
              className="min-h-9 rounded-full border border-accent/30 bg-accent/[0.08] px-4 text-[12px] font-semibold text-[#8a4600] hover:bg-accent/[0.12]"
            >
              {assistantOpen ? '关闭优化助手' : '优化助手'}
            </button>
            <button
              type="button"
              onClick={() => void runPrompt()}
              disabled={isRunning || isCompiling || !activeState?.systemPrompt.trim()}
              className="min-h-9 rounded-full bg-primary px-5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isRunning ? '运行中…' : '运行 Prompt'}
            </button>
            {dynamicNextStage && (
              <button
                type="button"
                onClick={() => void moveToNextStage()}
                disabled={nextButtonDisabled}
                className="min-h-9 rounded-full bg-accent px-4 text-[12px] font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {nextButtonLabel}
              </button>
            )}
          </div>
        </div>
      </header>

      {error && (
        <div className="border-b border-error/20 bg-error/[0.06] px-5 py-2 text-[12px] font-medium text-error">
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(300px,0.9fr)_minmax(420px,1.15fr)_minmax(380px,1fr)]">
        <section className="flex min-h-0 flex-col border-r border-black/[0.06] bg-[#faf9f6]">
          <div className="flex items-center justify-between border-b border-black/[0.06] px-4 py-3">
            <div>
              <h2 className="text-[13px] font-bold">输入参数</h2>
              <p className="text-[11px] text-tertiary">画像 / Memory：{memorySourceLabel}；当前蓝图：{blueprintSource}</p>
            </div>
            <button
              type="button"
              onClick={resetSession}
              className="text-[11px] font-semibold text-error underline underline-offset-4"
            >
              清空调试
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {!activeState ? (
              <div className="rounded-xl border border-dashed border-black/10 p-4 text-[12px] text-tertiary">正在准备输入参数…</div>
            ) : (
              <>
                {basicFields.map((field) => (
                  <InputField
                    key={field.key}
                    field={field}
                    value={activeState.inputs[field.key]}
                    onChange={(value) => handleInputChange(field.key, value)}
                  />
                ))}
                {advancedFields.length > 0 && (
                  <details className="rounded-xl border border-black/[0.07] bg-white/70 px-3 py-2">
                    <summary className="cursor-pointer text-[12px] font-semibold text-secondary">高级输入</summary>
                    <div className="mt-3 space-y-3">
                      {advancedFields.map((field) => (
                        <InputField
                          key={field.key}
                          field={field}
                          value={activeState.inputs[field.key]}
                          onChange={(value) => handleInputChange(field.key, value)}
                        />
                      ))}
                    </div>
                  </details>
                )}
                {outlineQuestions.length > 0 && (
                  <OutlineClarificationPanel
                    questions={outlineQuestions}
                    answers={outlineAnswers}
                    onChange={(questionId, answer) => updateActiveState((state) => ({
                      ...state,
                      clarificationAnswers: {
                        ...(state.clarificationAnswers || {}),
                        [questionId]: answer,
                      },
                    }))}
                  />
                )}
              </>
            )}
          </div>
        </section>

        <section className="flex min-h-0 flex-col border-r border-black/[0.06] bg-white">
          <div className="flex items-center justify-between border-b border-black/[0.06] px-4 py-3">
            <div>
              <h2 className="text-[13px] font-bold">Prompt</h2>
              <p className="text-[11px] text-tertiary">
                {activeState?.promptDirty ? '当前为手动修改版本' : '当前与生产 Builder 一致'}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(activeState?.systemPrompt || '')}
                className="rounded-full border border-black/[0.08] px-3 py-1.5 text-[11px] font-semibold text-secondary"
              >
                复制
              </button>
              <button
                type="button"
                onClick={() => void refreshPrompt()}
                className="rounded-full border border-black/[0.08] px-3 py-1.5 text-[11px] font-semibold text-secondary"
              >
                重置为生产 Prompt
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {activeState && (
              <div className="space-y-3">
                <textarea
                  value={activeState.systemPrompt}
                  onChange={(event) => updateActiveState((state) => ({
                    ...state,
                    systemPrompt: event.target.value,
                    promptDirty: true,
                  }))}
                  className="min-h-[430px] w-full resize-y rounded-xl border border-black/[0.08] bg-[#fbfbfa] p-3 font-mono text-[11.5px] leading-[1.65] text-primary outline-none focus:border-accent/50"
                  spellCheck={false}
                />
                <label className="block text-[11px] font-semibold text-secondary">
                  User Message
                  <textarea
                    value={activeState.userMessage}
                    onChange={(event) => updateActiveState((state) => ({
                      ...state,
                      userMessage: event.target.value,
                      promptDirty: true,
                    }))}
                    className="mt-1 min-h-[76px] w-full resize-y rounded-xl border border-black/[0.08] bg-white p-3 font-mono text-[11.5px] leading-relaxed text-primary outline-none focus:border-accent/50"
                    spellCheck={false}
                  />
                </label>
                <div className="grid grid-cols-2 gap-2 rounded-xl border border-black/[0.06] bg-[#faf9f6] p-3 text-[11px] sm:grid-cols-5">
                  <label className="flex items-center gap-2 font-semibold text-secondary">
                    <input
                      type="checkbox"
                      checked={activeState.config.toolsEnabled}
                      onChange={(event) => updateActiveState((state) => ({
                        ...state,
                        config: { ...state.config, toolsEnabled: event.target.checked },
                      }))}
                    />
                    工具（搜索 / Memory）
                  </label>
                  <NumberConfig label="max_tokens" value={activeState.config.maxTokens} onChange={(value) => updateActiveState((state) => ({ ...state, config: { ...state.config, maxTokens: value } }))} />
                  <NumberConfig label="max_searches" value={activeState.config.maxSearches} onChange={(value) => updateActiveState((state) => ({ ...state, config: { ...state.config, maxSearches: value } }))} />
                  <NumberConfig label="max_iterations" value={activeState.config.maxIterations} onChange={(value) => updateActiveState((state) => ({ ...state, config: { ...state.config, maxIterations: value } }))} />
                  <label className="text-secondary">
                    <span className="mb-1 block font-semibold">reasoning</span>
                    <select
                      value={activeState.config.reasoningEffort}
                      onChange={(event) => updateActiveState((state) => ({ ...state, config: { ...state.config, reasoningEffort: event.target.value } }))}
                      className="w-full rounded-lg border border-black/[0.08] bg-white px-2 py-1.5 outline-none"
                    >
                      {['none', 'low', 'medium', 'high'].map((value) => <option key={value}>{value}</option>)}
                    </select>
                  </label>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="flex min-h-0 flex-col bg-[#fbfaf7]">
          <div className="flex flex-wrap items-center gap-2 border-b border-black/[0.06] px-4 py-3">
            <div>
              <h2 className="text-[13px] font-bold">模型输出</h2>
              <p className="text-[11px] text-tertiary">
                {lastRun?.metrics
                  ? `${(lastRun.metrics.elapsedMs / 1000).toFixed(1)}s · ${lastRun.metrics.finishReason || 'unknown'}`
                  : isRunning ? '等待首个 token…' : '尚未运行'}
              </p>
            </div>
            <div className="ml-auto flex rounded-full bg-black/[0.045] p-1">
              {([
                ['thinking', '思考'],
                ['output', '回复'],
                ['parsed', '解析'],
                ['tools', '工具'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setOutputTab(id)}
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${outputTab === id ? 'bg-white text-primary shadow-sm' : 'text-tertiary hover:text-secondary'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {lastRun?.validation && (
              <div className={`mb-3 rounded-xl border px-3 py-2 text-[11px] ${lastRun.validation.valid ? 'border-completed/20 bg-completed/[0.06] text-[#1e7f4f]' : 'border-error/20 bg-error/[0.06] text-error'}`}>
                <span className="font-bold">{lastRun.validation.valid ? '解析与校验通过' : '解析或校验失败'}</span>
                {lastRun.validation.errors.length > 0 && (
                  <pre className="mt-2 whitespace-pre-wrap font-mono">{jsonText(lastRun.validation.errors)}</pre>
                )}
              </div>
            )}
            {outputTab === 'thinking' && <OutputPre text={lastRun?.thinking || (isRunning ? '思考中…' : '本次没有思考内容')} />}
            {outputTab === 'output' && <OutputPre text={lastRun?.content || (isRunning ? '等待模型输出…' : '尚未运行')} />}
            {outputTab === 'parsed' && <OutputPre text={lastRun?.parsed === undefined ? '尚未产生可解析结果' : jsonText(lastRun.parsed)} />}
            {outputTab === 'tools' && (
              <div className="space-y-3">
                {(lastRun?.toolResults.length || 0) === 0 ? (
                  <p className="text-[12px] text-tertiary">本次没有工具结果。</p>
                ) : lastRun?.toolResults.map((tool, index) => (
                  <div key={`${tool.tool}-${index}`} className="rounded-xl border border-black/[0.07] bg-white p-3">
                    <p className="mb-2 text-[11px] font-bold text-accent">{tool.tool || 'tool'}</p>
                    <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-secondary">{tool.result}</pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {assistantOpen && (
        <aside className="fixed bottom-4 right-4 top-4 z-40 flex w-[430px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-black/[0.1] bg-[#fcfbf8] shadow-[0_18px_60px_rgba(17,24,39,0.22)]">
          <div className="flex items-start justify-between border-b border-black/[0.07] bg-white px-4 py-3">
            <div>
              <h2 className="text-[15px] font-bold text-primary">Prompt 优化助手</h2>
              <p className="mt-0.5 text-[11px] text-tertiary">
                当前：{activeDefinition.title} · 已携带输入、Prompt、最近输出与校验
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAssistantOpen(false)}
              className="rounded-full px-2 py-1 text-[16px] leading-none text-tertiary hover:bg-black/[0.04] hover:text-primary"
              aria-label="关闭优化助手"
            >
              ×
            </button>
          </div>

          <div className="flex gap-2 border-b border-black/[0.06] bg-[#f8f6f1] px-3 py-2.5">
            <button
              type="button"
              disabled={!lastRun || assistantBusy}
              onClick={() => void callAssistant('evaluate')}
              className="rounded-full border border-black/[0.08] bg-white px-3 py-1.5 text-[11px] font-semibold text-secondary disabled:cursor-not-allowed disabled:opacity-40"
            >
              评测本次输出
            </button>
            <button
              type="button"
              disabled={assistantBusy || !activeState?.systemPrompt.trim()}
              onClick={() => void callAssistant('optimize_prompt')}
              className="rounded-full bg-accent px-3 py-1.5 text-[11px] font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              生成 Prompt 改写
            </button>
            <span className="ml-auto self-center text-[10px] text-tertiary">
              {lastRun ? '输出已纳入上下文' : '尚无模型输出'}
            </span>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {activeAssistantMessages.length === 0 ? (
              <div className="rounded-xl border border-dashed border-black/[0.1] bg-white/60 px-4 py-5 text-[12px] leading-relaxed text-secondary">
                你可以直接说出自己的优化思路，例如“这个 Prompt 为什么总把示例写进 user？”“我希望输出更短但保留验证步骤”。我也会自动结合当前环节上下文分析。
              </div>
            ) : activeAssistantMessages.map((message) => (
              <AssistantMessageCard
                key={message.id}
                message={message}
                onApplyRevision={applyAssistantRevision}
              />
            ))}
            {assistantBusy && (
              <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-3 text-[12px] text-secondary">
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                正在结合当前 Prompt、输入和输出分析…
              </div>
            )}
            {assistantError && (
              <div className="rounded-xl border border-error/20 bg-error/[0.06] px-3 py-2 text-[11.5px] text-error">
                {assistantError}
              </div>
            )}
          </div>

          <div className="border-t border-black/[0.07] bg-white p-3">
            <textarea
              value={assistantInput}
              onChange={(event) => setAssistantInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void callAssistant('chat');
                }
              }}
              rows={3}
              placeholder="说说你的优化思路，或追问它的评估结论…（⌘/Ctrl + Enter 发送）"
              className="w-full resize-y rounded-xl border border-black/[0.09] bg-[#fbfbfa] p-3 text-[12px] leading-relaxed text-primary outline-none focus:border-accent/50"
            />
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={() => void callAssistant('chat')}
                disabled={assistantBusy || !assistantInput.trim()}
                className="rounded-full bg-primary px-4 py-2 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                发送给助手
              </button>
            </div>
          </div>
        </aside>
      )}
    </main>
  );
}

function AssistantMessageCard({
  message,
  onApplyRevision,
}: {
  message: PromptLabAssistantMessage;
  onApplyRevision: (result: PromptLabAssistantResult) => void;
}) {
  if (message.role === 'user') {
    return (
      <div className="ml-8 rounded-xl bg-primary px-3 py-2.5 text-[12px] leading-relaxed text-white">
        {message.content}
      </div>
    );
  }

  const result = message.result;
  const hasRevision = Boolean(result?.revisedSystemPrompt || result?.revisedUserMessage);
  return (
    <div className="space-y-2 rounded-2xl border border-black/[0.07] bg-white p-3 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
      {typeof result?.score === 'number' && (
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${result.score >= 80 ? 'bg-completed/10 text-[#1e7f4f]' : result.score >= 60 ? 'bg-accent/10 text-[#9a4d00]' : 'bg-error/[0.08] text-error'}`}>
            {result.score} 分
          </span>
          <span className="text-[10.5px] text-tertiary">优化助手评估</span>
        </div>
      )}
      <pre className="whitespace-pre-wrap break-words font-sans text-[12px] leading-[1.7] text-primary">
        {message.content || '已完成分析。'}
      </pre>
      {result?.issues && result.issues.length > 0 && (
        <div>
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-error">发现的问题</p>
          <ul className="mt-1 space-y-1 text-[11.5px] leading-relaxed text-secondary">
            {result.issues.map((issue, index) => <li key={`${message.id}-issue-${index}`}>• {issue}</li>)}
          </ul>
        </div>
      )}
      {result?.suggestions && result.suggestions.length > 0 && (
        <div>
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-accent">改进建议</p>
          <ul className="mt-1 space-y-1 text-[11.5px] leading-relaxed text-secondary">
            {result.suggestions.map((suggestion, index) => <li key={`${message.id}-suggestion-${index}`}>• {suggestion}</li>)}
          </ul>
        </div>
      )}
      {hasRevision && result && (
        <div className="rounded-xl border border-accent/20 bg-accent/[0.04] p-2.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10.5px] font-bold text-[#8a4600]">已生成 Prompt 改写</span>
            <button
              type="button"
              onClick={() => onApplyRevision(result)}
              className="rounded-full bg-accent px-3 py-1.5 text-[10.5px] font-semibold text-primary"
            >
              应用到编辑器
            </button>
          </div>
          <div className="space-y-1 text-[10.5px] text-secondary">
            {result.revisedSystemPrompt && <div>System Prompt：{result.revisedSystemPrompt.length} 字符</div>}
            {result.revisedUserMessage && <div>User Message：{result.revisedUserMessage.length} 字符</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function OutlineClarificationPanel({
  questions,
  answers,
  onChange,
}: {
  questions: PromptLabClarificationQuestion[];
  answers: Record<string, string>;
  onChange: (questionId: string, answer: string) => void;
}) {
  const answered = questions.filter((question) => Boolean(answers[question.id]?.trim())).length;
  return (
    <div className="rounded-2xl border border-accent/20 bg-accent/[0.045] p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-[12px] font-bold text-primary">澄清回答</h3>
          <p className="text-[10.5px] text-tertiary">模型已提出问题。逐题选择后提交到下一环节。</p>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-[10.5px] font-semibold text-accent">
          {answered} / {questions.length}
        </span>
      </div>
      <div className="space-y-3">
        {questions.map((question, questionIndex) => (
          <div key={question.id} className="rounded-xl border border-black/[0.06] bg-white p-3">
            <p className="text-[12px] font-semibold leading-relaxed text-primary">
              {questionIndex + 1}. {question.question}
            </p>
            <div className="mt-2 space-y-1.5">
              {question.options.length > 0 ? question.options.map((option, optionIndex) => {
                const selected = answers[question.id] === option;
                return (
                  <button
                    key={`${question.id}-${optionIndex}`}
                    type="button"
                    onClick={() => onChange(question.id, option)}
                    className={`w-full rounded-lg border px-2.5 py-2 text-left text-[11px] leading-relaxed transition-colors ${
                      selected
                        ? 'border-accent/40 bg-accent/[0.07] text-primary'
                        : 'border-black/[0.06] bg-[#fbfbfa] text-secondary hover:border-accent/20'
                    }`}
                  >
                    <span className="mr-1.5 font-bold text-accent">{String.fromCharCode(65 + optionIndex)}.</span>
                    {option}
                  </button>
                );
              }) : (
                <textarea
                  value={answers[question.id] || ''}
                  onChange={(event) => onChange(question.id, event.target.value)}
                  rows={3}
                  placeholder="输入你的回答"
                  className="w-full rounded-lg border border-black/[0.08] bg-[#fbfbfa] p-2 text-[11px] text-primary outline-none focus:border-accent/40"
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InputField({
  field,
  value,
  onChange,
}: {
  field: PromptLabStageDefinition['fields'][number];
  value: PromptLabInputValue | undefined;
  onChange: (value: PromptLabInputValue) => void;
}) {
  const inputClass = 'mt-1 w-full rounded-xl border border-black/[0.08] bg-white p-2.5 font-mono text-[11px] leading-relaxed text-primary outline-none focus:border-accent/50';
  if (field.type === 'boolean') {
    return (
      <label className="flex min-h-10 items-center justify-between rounded-xl border border-black/[0.07] bg-white px-3 text-[12px] font-semibold text-secondary">
        {field.label}
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
      </label>
    );
  }
  if (field.type === 'text' || field.type === 'number') {
    return (
      <label className="block text-[11px] font-semibold text-secondary">
        {field.label}
        <input
          type={field.type === 'number' ? 'number' : 'text'}
          value={String(value ?? '')}
          onChange={(event) => onChange(field.type === 'number' ? Number(event.target.value) : event.target.value)}
          className={inputClass}
        />
      </label>
    );
  }
  return (
    <label className="block text-[11px] font-semibold text-secondary">
      {field.label}
      <textarea
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
        rows={field.rows ?? 6}
        spellCheck={false}
        className={`${inputClass} resize-y`}
      />
      {field.hint && <span className="mt-1 block text-[10px] font-normal text-tertiary">{field.hint}</span>}
    </label>
  );
}

function NumberConfig({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="text-secondary">
      <span className="mb-1 block font-semibold">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full rounded-lg border border-black/[0.08] bg-white px-2 py-1.5 outline-none"
      />
    </label>
  );
}

function OutputPre({ text }: { text: string }) {
  return (
    <pre className="whitespace-pre-wrap break-words rounded-xl border border-black/[0.06] bg-white p-4 font-mono text-[11.5px] leading-[1.75] text-primary">
      {text}
    </pre>
  );
}
