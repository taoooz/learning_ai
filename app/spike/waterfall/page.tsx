'use client';

// app/spike/waterfall/page.tsx
// 【一次性 Spike】瀑布流学习手感验证页，验证结论回填 V2 方案后即可删除
// 验证点：计划→逐任务流式追加→任务边界停顿→继续，并采集 TTFC / 任务时长数据

import { useCallback, useEffect, useRef, useState } from 'react';
import { MarkdownContent } from '@/components/ui/MarkdownContent';

interface SpikeTask {
  title: string;
  goal: string;
}

interface TaskMetric {
  ttfcMs: number | null; // 请求发出到首个字符
  totalMs: number | null; // 请求发出到流结束
  chars: number;
}

interface StreamTask {
  task: SpikeTask;
  content: string;
  status: 'streaming' | 'done' | 'failed';
  metric: TaskMetric;
}

type Phase = 'input' | 'planning' | 'learning' | 'boundary' | 'finished' | 'error';

export default function WaterfallSpikePage() {
  const [topic, setTopic] = useState('');
  const [phase, setPhase] = useState<Phase>('input');
  const [plan, setPlan] = useState<SpikeTask[]>([]);
  const [streamTasks, setStreamTasks] = useState<StreamTask[]>([]);
  const [planMs, setPlanMs] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // 用户向上滚动时暂停自动跟随，回到底部附近恢复
  useEffect(() => {
    const onScroll = () => {
      const distanceToBottom =
        document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
      autoScrollRef.current = distanceToBottom < 120;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (autoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  });

  const startTask = useCallback(
    async (taskIndex: number, currentPlan: SpikeTask[]) => {
      const task = currentPlan[taskIndex];
      setPhase('learning');
      setStreamTasks((prev) => [
        ...prev,
        { task, content: '', status: 'streaming', metric: { ttfcMs: null, totalMs: null, chars: 0 } },
      ]);

      const startedAt = performance.now();
      try {
        const res = await fetch('/api/spike/waterfall', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'task',
            topic,
            task,
            index: taskIndex,
            total: currentPlan.length,
            previousTitles: currentPlan.slice(0, taskIndex).map((t) => t.title),
          }),
        });
        if (!res.ok || !res.body) throw new Error(`请求失败：${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let firstChunkAt: number | null = null;
        let received = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (firstChunkAt === null) firstChunkAt = performance.now();
          received += decoder.decode(value, { stream: true });
          const snapshot = received;
          setStreamTasks((prev) =>
            prev.map((item, i) =>
              i === taskIndex
                ? {
                    ...item,
                    content: snapshot,
                    metric: {
                      ...item.metric,
                      ttfcMs: firstChunkAt !== null ? Math.round(firstChunkAt - startedAt) : null,
                      chars: snapshot.length,
                    },
                  }
                : item,
            ),
          );
        }

        const totalMs = Math.round(performance.now() - startedAt);
        setStreamTasks((prev) =>
          prev.map((item, i) =>
            i === taskIndex
              ? { ...item, status: 'done', metric: { ...item.metric, totalMs } }
              : item,
          ),
        );
        setPhase(taskIndex + 1 < currentPlan.length ? 'boundary' : 'finished');
      } catch (error) {
        console.error('[Spike] 任务生成失败', error);
        setStreamTasks((prev) =>
          prev.map((item, i) => (i === taskIndex ? { ...item, status: 'failed' } : item)),
        );
        setPhase('boundary');
      }
    },
    [topic],
  );

  const startLearning = useCallback(async () => {
    if (!topic.trim()) return;
    setPhase('planning');
    setErrorMessage('');
    const startedAt = performance.now();
    try {
      const res = await fetch('/api/spike/waterfall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'plan', topic: topic.trim() }),
      });
      if (!res.ok) throw new Error(`请求失败：${res.status}`);
      const data: { tasks: SpikeTask[] } = await res.json();
      setPlanMs(Math.round(performance.now() - startedAt));
      setPlan(data.tasks);
      await startTask(0, data.tasks);
    } catch (error) {
      console.error('[Spike] 计划生成失败', error);
      setErrorMessage('课程计划生成失败，请重试');
      setPhase('error');
    }
  }, [topic, startTask]);

  const continueNext = useCallback(() => {
    const nextIndex = streamTasks.length;
    if (nextIndex < plan.length) {
      void startTask(nextIndex, plan);
    }
  }, [plan, streamTasks.length, startTask]);

  const retryCurrent = useCallback(() => {
    const failedIndex = streamTasks.findIndex((t) => t.status === 'failed');
    if (failedIndex === -1) return;
    setStreamTasks((prev) => prev.slice(0, failedIndex));
    void startTask(failedIndex, plan);
  }, [plan, streamTasks, startTask]);

  const doneMetrics = streamTasks.filter((t) => t.status === 'done');

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-6 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          ⚠️ 一次性验证页（Spike）：用于体验 V2 瀑布流学习手感并采集耗时数据，不是正式功能。
        </div>

        {phase === 'input' || phase === 'error' ? (
          <div className="space-y-4">
            <h1 className="text-2xl font-bold text-gray-900">瀑布流学习 Spike</h1>
            <p className="text-gray-500 text-sm">
              输入一个学习主题，体验「计划 → 逐节流式生成 → 边界停顿 → 继续」的节奏。
            </p>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && startLearning()}
              placeholder="例如：React 性能优化 / 期权定价基础"
              className="w-full rounded-xl border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}
            <button
              onClick={startLearning}
              disabled={!topic.trim()}
              className="rounded-xl bg-blue-600 px-6 py-3 text-white font-medium disabled:opacity-40 hover:bg-blue-700 transition-colors"
            >
              开始学习
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-baseline justify-between">
              <h1 className="text-xl font-bold text-gray-900">{topic}</h1>
              {planMs !== null && (
                <span className="text-xs text-gray-400">计划耗时 {(planMs / 1000).toFixed(1)}s</span>
              )}
            </div>

            {phase === 'planning' && (
              <p className="text-gray-500 animate-pulse">正在规划本章任务…</p>
            )}

            {plan.length > 0 && (
              <ol className="text-sm text-gray-400 space-y-1">
                {plan.map((t, i) => (
                  <li key={t.title} className={i < streamTasks.length ? 'text-gray-700' : ''}>
                    {i + 1}. {t.title}
                    {i === streamTasks.length - 1 && phase === 'learning' && ' ⏳'}
                    {streamTasks[i]?.status === 'done' && ' ✓'}
                  </li>
                ))}
              </ol>
            )}

            {streamTasks.map((item, index) => (
              <section key={index} className="border-t border-gray-100 pt-5">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">
                  {index + 1}. {item.task.title}
                </h2>
                <div className="prose">
                  <MarkdownContent content={item.content} />
                </div>
                {item.status === 'streaming' && (
                  <span className="inline-block w-2 h-4 bg-blue-500 animate-pulse ml-1" />
                )}
                {item.status === 'failed' && (
                  <div className="mt-3 text-sm text-red-600">
                    本节生成失败。
                    <button onClick={retryCurrent} className="ml-2 underline">
                      重试本节
                    </button>
                  </div>
                )}
                {item.status === 'done' && item.metric.totalMs !== null && (
                  <p className="mt-2 text-xs text-gray-300">
                    首字 {((item.metric.ttfcMs ?? 0) / 1000).toFixed(1)}s · 总计{' '}
                    {(item.metric.totalMs / 1000).toFixed(1)}s · {item.metric.chars} 字
                  </p>
                )}
              </section>
            ))}

            {phase === 'boundary' && !streamTasks.some((t) => t.status === 'failed') && (
              <div className="sticky bottom-6 flex justify-center">
                <button
                  onClick={continueNext}
                  className="rounded-full bg-blue-600 px-8 py-3 text-white font-medium shadow-lg hover:bg-blue-700 transition-colors"
                >
                  继续学习（{streamTasks.length}/{plan.length} 节已完成）
                </button>
              </div>
            )}

            {phase === 'finished' && (
              <div className="rounded-xl bg-green-50 border border-green-200 p-5 space-y-2">
                <p className="font-medium text-green-800">🎉 本章完成</p>
                <p className="text-sm text-green-700">
                  共 {doneMetrics.length} 节 · 平均首字{' '}
                  {(
                    doneMetrics.reduce((sum, t) => sum + (t.metric.ttfcMs ?? 0), 0) /
                    Math.max(doneMetrics.length, 1) /
                    1000
                  ).toFixed(1)}
                  s · 平均单节{' '}
                  {(
                    doneMetrics.reduce((sum, t) => sum + (t.metric.totalMs ?? 0), 0) /
                    Math.max(doneMetrics.length, 1) /
                    1000
                  ).toFixed(1)}
                  s
                </p>
                <button
                  onClick={() => {
                    setPhase('input');
                    setPlan([]);
                    setStreamTasks([]);
                    setPlanMs(null);
                  }}
                  className="text-sm text-green-700 underline"
                >
                  换个主题再试
                </button>
              </div>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
