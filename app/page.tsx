'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCourse } from '@/contexts/CourseContext';

export default function HomePage() {
  const [topic, setTopic] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showDeleteMenu, setShowDeleteMenu] = useState<string | null>(null);
  const router = useRouter();
  const { courses, generateCourse, deleteCourse } = useCourse();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;

    setIsGenerating(true);
    setError('');

    try {
      await generateCourse(topic.trim());
      router.push('/generate');
    } catch {
      setError('抱歉，生成失败了，请稍后再试。');
      setIsGenerating(false);
    }
  };

  const handleCourseClick = (courseId: string) => {
    router.push(`/course/${courseId}`);
  };

  const handleDelete = (courseId: string) => {
    setDeleteConfirm(courseId);
    setShowDeleteMenu(null);
  };

  const confirmDelete = () => {
    if (!deleteConfirm) return;
    deleteCourse(deleteConfirm);
    setDeleteConfirm(null);
  };

  const getCourseProgress = (courseId: string) => {
    const course = courses.find((c) => c.courseId === courseId);
    if (!course) return { completed: 0, total: 0, percent: 0 };

    const completed = course.nodes.filter((node) => node.status === 'completed').length;
    const total = course.nodes.length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { completed, total, percent };
  };

  const getNextNodeTitle = (courseId: string) => {
    const course = courses.find((c) => c.courseId === courseId);
    if (!course) return '继续当前进度';

    const nextNode = course.nodes.find((node) => node.status !== 'completed');
    return nextNode?.title ?? '复习已完成内容';
  };

  const sortedCourses = [...courses].reverse();
  const hasCourses = sortedCourses.length > 0;
  const examplePrompt = '“我想学 Agent 的一些技术原理，能方便我后面转型 AI 产品经理。目前知道 LLM 是什么，但别的了解有限。”';
  const coursePalettes = [
    'bg-[linear-gradient(135deg,rgba(255,138,0,0.12),rgba(255,250,244,0.95)_42%,rgba(255,255,255,0.98))]',
    'bg-[linear-gradient(135deg,rgba(245,158,11,0.10),rgba(255,248,238,0.95)_42%,rgba(255,255,255,0.98))]',
    'bg-[linear-gradient(135deg,rgba(251,191,36,0.10),rgba(255,250,242,0.95)_42%,rgba(255,255,255,0.98))]',
    'bg-[linear-gradient(135deg,rgba(249,115,22,0.10),rgba(255,247,240,0.95)_42%,rgba(255,255,255,0.98))]',
  ];

  const handleTopicClick = (selectedTopic: string) => {
    setTopic(selectedTopic);
    setIsGenerating(true);
    setError('');

    generateCourse(selectedTopic)
      .then(() => {
        router.push('/generate');
      })
      .catch(() => {
        setError('抱歉，生成失败了，请稍后再试。');
        setIsGenerating(false);
      });
  };

  return (
    <main className="min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 right-[-8rem] h-72 w-72 rounded-full bg-gradient-to-br from-accent/16 via-accent/8 to-transparent blur-3xl" />
        <div className="absolute left-[-4rem] top-12 h-56 w-56 rounded-full bg-gradient-to-br from-sky-400/16 via-transparent to-transparent blur-3xl" />
        <div className="absolute top-72 left-[-7rem] h-64 w-64 rounded-full bg-gradient-to-br from-amber-300/12 via-transparent to-transparent blur-3xl" />
        <div className="absolute right-8 top-28 h-24 w-24 rounded-full border border-white/20 opacity-50" />
        <div className="absolute left-6 top-44 h-40 w-40 rounded-full bg-gradient-to-br from-sky-300/10 to-transparent blur-3xl" />
        <div
          className="absolute left-0 top-20 h-72 w-96 opacity-45"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(56,189,248,0.14) 1px, transparent 1px), linear-gradient(to bottom, rgba(56,189,248,0.12) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
            maskImage: 'radial-gradient(circle at 30% 34%, black 0%, rgba(0,0,0,0.92) 34%, rgba(0,0,0,0.45) 62%, transparent 86%)',
            WebkitMaskImage: 'radial-gradient(circle at 30% 34%, black 0%, rgba(0,0,0,0.92) 34%, rgba(0,0,0,0.45) 62%, transparent 86%)',
          }}
        />
      </div>

      <div className="relative mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pb-10 pt-8 sm:px-6">
        <div className="flex items-center justify-between">
          <div className="rounded-full bg-surface/90 px-3 py-1.5 text-xs font-medium text-secondary shadow-sm backdrop-blur-sm">
            Learning AI
          </div>
          <button
            onClick={() => router.push('/profile')}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-surface/78 px-3 text-sm font-medium text-secondary shadow-sm backdrop-blur-sm transition-all duration-150 hover:bg-surface hover:shadow-sm active:scale-95"
            aria-label="个人设置"
          >
            <svg className="h-4.5 w-4.5 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span>个人信息</span>
          </button>
        </div>

        <section className="pt-2">
          <div className="relative max-w-xl">
            <div className="pointer-events-none absolute -left-6 top-8 h-28 w-28 rounded-full bg-gradient-to-br from-sky-400/12 via-transparent to-transparent blur-2xl" />
            <h1 className="text-3xl font-semibold tracking-tight text-primary sm:text-5xl">
              <span className="block">想学什么，</span>
              <span className="relative inline-block text-slate-950 [text-shadow:0_10px_28px_rgba(56,189,248,0.12)]">
                <span
                  className="pointer-events-none absolute -left-1 -right-2 bottom-0 h-[0.72em] -rotate-[2.4deg] rounded-[999px] bg-gradient-to-r from-sky-400/34 via-sky-300/24 to-accent/18 blur-[0.7px]"
                  aria-hidden="true"
                />
                <span className="relative">
                就从这里开始
                </span>
              </span>
            </h1>
            <p className="mt-3 text-sm leading-6 text-secondary sm:text-base">
              告诉我 你想学什么，以及为什么要学它
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-6">
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-stretch">
              <div className="relative flex-1 overflow-hidden rounded-[30px] border border-white/75 bg-surface shadow-[0_16px_38px_rgba(148,163,184,0.08)] transition-all duration-200 focus-within:border-accent/25 focus-within:shadow-[0_18px_42px_rgba(148,163,184,0.12)]">
                <div className="pointer-events-none absolute inset-0 rounded-[30px] ring-1 ring-white/55" />
                <div className="pointer-events-none absolute right-5 top-5 h-16 w-16 rounded-full bg-gradient-to-br from-sky-400/8 to-transparent blur-2xl" />
                <textarea
                  id="topic-input"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder={`示例：${examplePrompt}`}
                  className="relative min-h-[152px] w-full resize-none bg-transparent px-5 py-5 text-[15px] leading-7 text-primary outline-none transition-all duration-200 placeholder:text-secondary/80 focus:outline-none"
                  disabled={isGenerating}
                />
              </div>

              <button
                type="submit"
                disabled={!topic.trim() || isGenerating}
                aria-label="生成专属学习计划"
                className="inline-flex min-h-14 items-center justify-center rounded-[28px] bg-cta px-7 py-4 text-sm font-semibold text-cta shadow-[0_18px_34px_rgba(17,24,39,0.22)] transition-all duration-200 hover:translate-y-[-1px] hover:shadow-[0_20px_38px_rgba(17,24,39,0.26)] active:scale-[0.98] disabled:opacity-40 disabled:shadow-none sm:mb-1 sm:min-w-[164px] sm:self-end"
              >
                生成专属学习计划
              </button>
            </div>
          </form>

          {error && (
            <p className="mt-3 text-sm text-error" role="alert">
              {error}
            </p>
          )}
        </section>

        {hasCourses && (
          <section>
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-primary">最近学习</h2>
                <p className="mt-1 text-sm text-secondary">保留你已经开始过的主题，随时接着学。</p>
              </div>
              <span className="text-xs text-tertiary">{sortedCourses.length} 个主题</span>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {sortedCourses.map((course, index) => {
                const progress = getCourseProgress(course.courseId);
                const nextNodeTitle = getNextNodeTitle(course.courseId);
                const palette = coursePalettes[index % coursePalettes.length];
                const isFeaturedCourse = index === 0;

                return (
                  <article
                    key={course.courseId}
                    className={`rounded-[28px] shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sheet ${palette} ${isFeaturedCourse ? 'p-6' : 'p-5'}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <h3 className={`truncate font-semibold text-primary ${isFeaturedCourse ? 'text-2xl' : 'text-xl'}`}>{course.topic}</h3>
                        <p className="mt-2 text-sm leading-6 text-secondary">
                          下一节：{nextNodeTitle}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-white/72 px-3 py-2 text-right shadow-sm">
                        <div className={`font-semibold text-primary ${isFeaturedCourse ? 'text-3xl' : 'text-2xl'}`}>{progress.percent}%</div>
                        <div className="text-xs text-secondary">当前进度</div>
                      </div>
                    </div>

                    <div className="mt-5 flex items-center gap-3">
                      <button
                        onClick={() => handleCourseClick(course.courseId)}
                        className={`inline-flex flex-1 items-center justify-center rounded-2xl bg-cta px-5 text-sm font-semibold text-cta shadow-[0_10px_22px_rgba(17,24,39,0.12)] transition-all duration-150 hover:shadow-[0_14px_26px_rgba(17,24,39,0.16)] active:scale-[0.98] ${isFeaturedCourse ? 'min-h-12 py-3.5' : 'min-h-11 py-3'}`}
                      >
                        继续学习
                      </button>

                      <div className="relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowDeleteMenu(showDeleteMenu === course.courseId ? null : course.courseId);
                          }}
                          aria-label={`管理 ${course.topic}`}
                          className="flex h-11 w-11 items-center justify-center rounded-2xl text-tertiary transition-all duration-150 hover:bg-white/55 hover:text-primary"
                        >
                          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                            <circle cx="12" cy="6" r="2" />
                            <circle cx="12" cy="12" r="2" />
                            <circle cx="12" cy="18" r="2" />
                          </svg>
                        </button>

                        {showDeleteMenu === course.courseId && (
                          <div className="absolute bottom-[3.75rem] right-0 z-10 min-w-[132px] rounded-2xl border border-white/80 bg-surface/96 p-1 shadow-sheet backdrop-blur-sm">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(course.courseId);
                              }}
                              className="flex w-full items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm text-error transition-colors hover:bg-error/10"
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                              删除主题
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {isGenerating && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/82 backdrop-blur-sm">
          <div className="mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-full bg-gradient-to-br from-accent/18 to-accent/5">
            <svg className="h-9 w-9 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
          <p className="text-base font-semibold text-primary">正在为你拆解学习路径</p>
          <p className="mt-2 text-sm text-secondary">马上就能看到适合开始的第一步</p>
        </div>
      )}

      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            className="mx-4 w-full max-w-xs rounded-3xl bg-surface p-6 shadow-float"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-2 text-lg font-bold text-primary">确认删除这个主题？</h2>
            <p className="mb-5 text-sm text-secondary">删除后会从首页历史里移除，之后需要重新生成。</p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 rounded-2xl bg-subtle px-4 py-3 text-sm font-medium text-secondary transition-all duration-150 hover:bg-black/5 active:scale-[0.98]"
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 rounded-2xl bg-[#EF476F] px-4 py-3 text-sm font-medium text-white shadow-sm transition-all duration-150 hover:bg-[#d93f64] active:scale-[0.98]"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
