'use client';

import type { SystemCourseRecommendation } from '@/lib/storage';

interface SystemCourseRecommendationsProps {
  courses: SystemCourseRecommendation[];
  startingCourseId: string | null;
  onSelect: (courseId: string) => void;
}

export function SystemCourseRecommendations({
  courses,
  startingCourseId,
  onSelect,
}: SystemCourseRecommendationsProps) {
  return (
    <section className="pt-1">
      <div className="rounded-[30px] border border-sky-200/65 bg-[linear-gradient(135deg,rgba(241,248,255,0.96),rgba(248,251,255,0.98)_58%,rgba(255,255,255,0.96))] px-5 py-5 shadow-[0_12px_28px_rgba(56,189,248,0.10)] sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="w-fit rounded-full bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-700">
              系统推荐课程
            </div>
            <h2 className="mt-3 text-xl font-semibold tracking-tight text-primary">
              不知道先学什么的话，可以先从这两门开始
            </h2>
            <p className="mt-2 text-sm leading-6 text-secondary">
              这两门课是系统预先准备好的引导课程。点击后会直接加入你的课程列表，并从第一节开始学。
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3">
          {courses.map((course, index) => {
            const palette = index === 0
              ? 'border-sky-200/70 bg-[linear-gradient(135deg,rgba(239,246,255,0.96),rgba(255,255,255,0.98))]'
              : 'border-emerald-200/70 bg-[linear-gradient(135deg,rgba(240,253,244,0.96),rgba(255,255,255,0.98))]';

            return (
              <button
                key={course.courseId}
                type="button"
                onClick={() => onSelect(course.courseId)}
                disabled={startingCourseId === course.courseId}
                className={`group rounded-[26px] border p-5 text-left shadow-[0_8px_22px_rgba(15,23,42,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_28px_rgba(15,23,42,0.08)] disabled:opacity-60 ${palette}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-secondary/75">
                      {course.badge}
                    </div>
                    <h3 className="mt-2 text-lg font-semibold text-primary">
                      {course.title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-secondary">
                      {course.summary}
                    </p>
                  </div>
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/80 text-primary shadow-sm transition-transform duration-200 group-hover:translate-x-0.5">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </div>
                </div>

                <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/78 px-3.5 py-2 text-sm font-medium text-primary">
                  {startingCourseId === course.courseId ? '正在加入课程...' : course.cta}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
