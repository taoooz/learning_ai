'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCourse } from '@/contexts/CourseContext';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { CourseCard } from '@/components/CourseCard';
import { ConfirmModal } from '@/components/ConfirmModal';
import { SystemCourseRecommendations } from '@/components/SystemCourseRecommendations';
import { RecommendationsModal } from '@/components/RecommendationsModal';

export default function HomePage() {
  const [topic, setTopic] = useState('');
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [startingSystemCourseId, setStartingSystemCourseId] = useState<string | null>(null);
  const [showRecommendations, setShowRecommendations] = useState(false);
  const router = useRouter();
  const { courses, deleteCourse, systemCourseRecommendations, startSystemCourse } = useCourse();
  const { userProfile } = useUserProfile();

  const hasProfileContent = Boolean(
    userProfile?.targetJob?.trim() ||
    userProfile?.name?.trim() ||
    userProfile?.workExperience?.some((item) =>
      item.company.trim() || item.position.trim() || item.description?.trim()
    ) ||
    userProfile?.education?.some((item) => item.school.trim() || item.major.trim())
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;
    router.push(`/generate/chat?topic=${encodeURIComponent(topic.trim())}`);
  };

  const handleCourseClick = (courseId: string) => {
    router.push(`/course/${courseId}`);
  };

  const handleDelete = (courseId: string) => {
    deleteCourse(courseId);
    setDeleteConfirm(null);
  };

  const handleSystemCourseClick = (courseId: string) => {
    setStartingSystemCourseId(courseId);
    try {
      startSystemCourse(courseId);
      router.push(`/course/${courseId}/learn/0`);
    } finally {
      setStartingSystemCourseId(null);
    }
  };

  const sortedCourses = [...courses].reverse();
  const hasCourses = sortedCourses.length > 0;
  const examplePrompt = '"我想学 Agent 的一些技术原理，能方便我后面转型 AI 产品经理。目前知道 LLM 是什么，但别的了解有限。"';

  return (
    <main className="min-h-screen overflow-x-hidden bg-background">
      {/* 背景装饰 */}
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
            backgroundSize: '18px 18px',
            maskImage: 'radial-gradient(circle at 30% 34%, black 0%, rgba(0,0,0,0.92) 34%, rgba(0,0,0,0.45) 62%, transparent 86%)',
            WebkitMaskImage: 'radial-gradient(circle at 30% 34%, black 0%, rgba(0,0,0,0.92) 34%, rgba(0,0,0,0.45) 62%, transparent 86%)',
          }}
        />
      </div>

      {/* 顶部导航 */}
      <div className="fixed inset-x-0 top-0 z-20 pt-4">
        <div className="mx-auto max-w-2xl px-5 pb-2 sm:px-6">
          <div className="rounded-[24px] border border-white/72 bg-surface/80 px-3 py-2.5 shadow-[0_6px_18px_rgba(15,23,42,0.04)] backdrop-blur-md">
            <div className="flex items-center justify-between gap-3">
              <div className="rounded-full bg-background/92 px-3 py-1.5 text-xs font-medium text-secondary">
                Learning AI
              </div>
              <button
                onClick={() => router.push('/profile')}
                className="inline-flex h-8.5 items-center gap-1.5 rounded-full bg-black/[0.04] px-3 text-[13px] font-medium text-secondary transition-all duration-150 hover:bg-black/[0.06] hover:text-primary active:scale-95"
                aria-label="个人设置"
              >
                <svg className="h-4 w-4 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span>{hasProfileContent ? '个人信息' : '完善个人信息'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 主内容区 */}
      <div className="relative mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pb-10 pt-[88px] sm:px-6">

        {/* Hero 输入区 */}
        <section className="pt-4">
          <div className="relative max-w-xl">
            <div className="pointer-events-none absolute -left-6 top-8 h-28 w-28 rounded-full bg-gradient-to-br from-sky-400/12 via-transparent to-transparent blur-2xl" />
            <h1 className="text-3xl font-semibold tracking-tight text-primary sm:text-5xl">
              <span className="block">想学什么，</span>
              <span className="relative inline-block text-slate-950 [text-shadow:0_10px_28px_rgba(56,189,248,0.12)]">
                <span
                  className="pointer-events-none absolute -left-1 -right-2 bottom-0 h-[0.72em] -rotate-[2.4deg] rounded-[999px] bg-gradient-to-r from-sky-400/34 via-sky-300/24 to-accent/18 blur-[0.7px]"
                  aria-hidden="true"
                />
                <span className="relative">就从这里开始</span>
              </span>
            </h1>
            <p className="mt-4 text-[15px] leading-relaxed text-secondary">
              告诉我你想学什么，以及为什么要学它
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-8">
            <div className="flex flex-col gap-3">
              <div className="relative overflow-hidden rounded-[24px] border-2 border-black/[0.08] bg-white shadow-[0_4px_16px_rgba(0,0,0,0.04)] transition-all duration-200 focus-within:border-accent focus-within:shadow-[0_8px_24px_rgba(255,138,0,0.12)]">
                <textarea
                  id="topic-input"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder={`例如：${examplePrompt}`}
                  className="w-full resize-none bg-transparent px-5 py-4 text-[15px] leading-relaxed text-primary outline-none placeholder:text-tertiary"
                  rows={4}
                />
              </div>

              <div className="flex gap-3 sm:self-end">
                <button
                  type="button"
                  onClick={() => setShowRecommendations(true)}
                  aria-label="为我推荐"
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-black/[0.08] bg-white text-2xl transition-all duration-150 hover:border-accent/40 hover:bg-accent/5 active:scale-[0.95]"
                >
                  🎲
                </button>
                <button
                  type="submit"
                  disabled={!topic.trim()}
                  aria-label="生成学习计划"
                  className="inline-flex min-h-14 flex-1 items-center justify-center gap-2 rounded-full bg-cta px-7 py-4 text-[15px] font-semibold text-cta shadow-[0_8px_24px_rgba(255,138,0,0.20)] transition-all duration-150 hover:shadow-[0_12px_32px_rgba(255,138,0,0.25)] active:scale-[0.985] disabled:opacity-40 disabled:shadow-none"
                >
                  生成学习计划
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </button>
              </div>
            </div>
          </form>

          {error && (
            <p className="mt-3 text-sm text-error" role="alert">
              {error}
            </p>
          )}
        </section>

        {/* 已有课程列表 */}
        {hasCourses && (
          <section>
            <h2 className="mb-5 text-[18px] font-bold text-primary">最近学习</h2>
            <div className="grid grid-cols-1 gap-4">
              {sortedCourses.map((course, index) => (
                <CourseCard
                  key={course.courseId}
                  course={course}
                  index={index}
                  onContinue={handleCourseClick}
                  onDelete={(id) => setDeleteConfirm(id)}
                />
              ))}
            </div>
          </section>
        )}

        {/* 空状态：系统推荐课程 */}
        {!hasCourses && (
          <SystemCourseRecommendations
            courses={systemCourseRecommendations}
            startingCourseId={startingSystemCourseId}
            onSelect={handleSystemCourseClick}
          />
        )}
      </div>

      {/* 删除确认弹窗 */}
      <ConfirmModal
        open={deleteConfirm !== null}
        title="确认删除这个主题？"
        message="删除后会从首页历史里移除，之后需要重新生成。"
        confirmLabel="删除"
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)}
      />

      {/* 推荐弹窗 */}
      <RecommendationsModal
        isOpen={showRecommendations}
        onClose={() => setShowRecommendations(false)}
        userProfile={userProfile}
        existingCourses={courses.map(c => c.topic)}
      />
    </main>
  );
}
