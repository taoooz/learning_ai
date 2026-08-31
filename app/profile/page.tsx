// app/profile/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CourseHeaderBar } from '@/components/CourseHeaderBar';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { UserProfile, WorkExperience, Education } from '@/types/course';
import { unwrapApiResponse } from '@/lib/api-contract';

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return Math.random().toString(36).substring(2, 11);
}

function createEmptyWorkExperience(): WorkExperience {
  return { id: generateId(), company: '', position: '', description: '' };
}

function createEmptyEducation(): Education {
  return { id: generateId(), school: '', major: '' };
}

function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-secondary/78">
          {eyebrow}
        </p>
        <h2 className="mt-2 text-[22px] font-semibold tracking-tight text-primary">{title}</h2>
        {description ? (
          <p className="mt-2 text-sm leading-6 text-secondary">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

function GhostAddButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-black/6 bg-white/80 px-4 py-2 text-sm font-medium text-secondary transition-all duration-150 hover:border-accent/20 hover:text-primary active:scale-[0.985]"
    >
      {children}
    </button>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-2 block text-sm font-medium text-primary/88">{children}</label>;
}

const inputClassName =
  'w-full rounded-[20px] border border-black/6 bg-white/82 px-4 py-3 text-[15px] text-primary outline-none transition-all duration-150 placeholder:text-secondary/55 focus:border-accent/22 focus:bg-white';

const textareaClassName = `${inputClassName} resize-none leading-7`;

export default function ProfilePage() {
  const router = useRouter();
  const { userProfile, updateProfile, isLoaded } = useUserProfile();

  const [name, setName] = useState('');
  const [targetJob, setTargetJob] = useState('');
  const [workExperience, setWorkExperience] = useState<WorkExperience[]>([]);
  const [education, setEducation] = useState<Education[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // 加载已有数据
  useEffect(() => {
    if (userProfile) {
      setName(userProfile.name || '');
      setTargetJob(userProfile.targetJob || '');
      setWorkExperience(
        userProfile.workExperience && userProfile.workExperience.length > 0
          ? userProfile.workExperience
          : [createEmptyWorkExperience()]
      );
      setEducation(
        userProfile.education && userProfile.education.length > 0
          ? userProfile.education
          : [createEmptyEducation()]
      );
    } else {
      // 默认空数据
      setWorkExperience([createEmptyWorkExperience()]);
      setEducation([createEmptyEducation()]);
    }
  }, [userProfile]);

  const handleSave = async () => {
    const profile: UserProfile = {
      name,
      targetJob,
      workExperience: workExperience.filter(w => w.company.trim() || w.position.trim()),
      education: education.filter(e => e.school.trim() || e.major.trim()),
    };

    setIsSaving(true);
    updateProfile(profile);
    setIsSaving(false);
    setSaveSuccess(true);

    setTimeout(() => {
      router.push('/');
    }, 500);

    fetch('/api/profile/insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    }).then(response => {
      if (response.ok) return response.json();
      throw new Error('Insights API failed');
    }).then(raw => {
      // 解包 {success, data} 包装，避免把响应包装对象误存为用户画像
      const updatedProfile = unwrapApiResponse<UserProfile>(raw);
      updateProfile(updatedProfile);
    }).catch(error => {
      console.error('Background insights generation failed:', error);
    });
  };

  const addWorkExperience = () => {
    setWorkExperience([...workExperience, createEmptyWorkExperience()]);
  };

  const removeWorkExperience = (id: string) => {
    if (workExperience.length > 1) {
      setWorkExperience(workExperience.filter(w => w.id !== id));
    }
  };

  const updateWorkExperience = (id: string, field: keyof WorkExperience, value: string) => {
    setWorkExperience(workExperience.map(w => w.id === id ? { ...w, [field]: value } : w));
  };

  const addEducation = () => {
    setEducation([...education, createEmptyEducation()]);
  };

  const removeEducation = (id: string) => {
    if (education.length > 1) {
      setEducation(education.filter(e => e.id !== id));
    }
  };

  const updateEducation = (id: string, field: keyof Education, value: string) => {
    setEducation(education.map(e => e.id === id ? { ...e, [field]: value } : e));
  };

  if (!isLoaded) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center">
            <svg className="w-6 h-6 text-accent animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
          <p className="text-secondary text-sm">加载中...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[100svh] overflow-x-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 right-[-7rem] h-64 w-64 rounded-full bg-gradient-to-br from-accent/12 to-transparent blur-3xl" />
        <div className="absolute left-[-4rem] top-28 h-52 w-52 rounded-full bg-gradient-to-br from-sky-400/8 to-transparent blur-3xl" />
      </div>

      <CourseHeaderBar
        title="个人信息"
        backLabel="返回首页"
        onBack={() => router.push('/')}
      />

      <div
        className="relative mx-auto flex max-w-md flex-col box-border px-5 sm:px-6"
        style={{
          minHeight: '100svh',
          paddingTop: '88px',
          paddingBottom: 'max(164px, calc(env(safe-area-inset-bottom) + 144px))',
        }}
      >
        <section className="pb-6 pt-2">
          <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-secondary/78">
            Learning Profile
          </p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-tight text-primary">
            让课程更贴合你的背景
          </h1>
          <p className="mt-3 text-[15px] leading-7 text-secondary">
            这些信息会帮助我判断你的起点、目标和合适的讲解方式。你填得越具体，后面生成出来的课程会越贴近你。
          </p>
        </section>

        <div className="space-y-10">
          <section>
            <SectionHeader
              eyebrow="方向"
              title="先告诉我你想去哪里"
              description=""
            />

            <div className="mt-5 space-y-4">
              <div>
                <FieldLabel>目标岗位</FieldLabel>
                <input
                  type="text"
                  value={targetJob}
                  onChange={(e) => setTargetJob(e.target.value)}
                  placeholder="例如：AI 产品经理、前端工程师"
                  className={inputClassName}
                />
              </div>

              <div>
                <FieldLabel>姓名</FieldLabel>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="怎么称呼你都可以"
                  className={inputClassName}
                />
              </div>
            </div>
          </section>

          <section>
            <SectionHeader
              eyebrow="经历"
              title="你做过什么"
              description=""
              action={<GhostAddButton onClick={addWorkExperience}>添加经历</GhostAddButton>}
            />

            <div className="mt-5 space-y-4">
              {workExperience.map((work, index) => (
                <div
                  key={work.id}
                  className="relative overflow-hidden rounded-[30px] border border-white/82 bg-[linear-gradient(135deg,rgba(255,255,255,0.94),rgba(255,248,241,0.98)_58%,rgba(255,255,255,0.95))] px-5 py-5 shadow-[0_12px_28px_rgba(15,23,42,0.06)]"
                >
                  <div
                    className="pointer-events-none absolute left-0 top-0 h-28 w-36 opacity-28"
                    style={{
                      backgroundImage:
                        'linear-gradient(to right, rgba(56,189,248,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(56,189,248,0.10) 1px, transparent 1px)',
                      backgroundSize: '18px 18px',
                      maskImage: 'radial-gradient(circle at 24% 18%, black 0%, rgba(0,0,0,0.82) 28%, transparent 78%)',
                      WebkitMaskImage: 'radial-gradient(circle at 24% 18%, black 0%, rgba(0,0,0,0.82) 28%, transparent 78%)',
                    }}
                  />

                  <div className="relative z-[1]">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div className="rounded-full bg-tag px-3 py-1 text-xs font-medium text-secondary">
                        工作经历 {index + 1}
                      </div>
                      {workExperience.length > 1 && (
                        <button
                          onClick={() => removeWorkExperience(work.id)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-tertiary transition-colors hover:bg-black/[0.04] hover:text-error"
                          aria-label={`删除第 ${index + 1} 段工作经历`}
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>

                    <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <FieldLabel>公司名称</FieldLabel>
                          <input
                            type="text"
                            value={work.company}
                            onChange={(e) => updateWorkExperience(work.id, 'company', e.target.value)}
                            placeholder="你在哪工作过"
                            className={inputClassName}
                          />
                        </div>
                        <div>
                          <FieldLabel>岗位</FieldLabel>
                          <input
                            type="text"
                            value={work.position}
                            onChange={(e) => updateWorkExperience(work.id, 'position', e.target.value)}
                            placeholder="例如：产品经理、运营"
                            className={inputClassName}
                          />
                        </div>
                      </div>

                      <div>
                        <FieldLabel>你主要做什么</FieldLabel>
                        <textarea
                          value={work.description || ''}
                          onChange={(e) => updateWorkExperience(work.id, 'description', e.target.value)}
                          placeholder="例如：负责需求梳理、和研发协作上线功能，也会看一些数据反馈"
                          rows={3}
                          className={textareaClassName}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <SectionHeader
              eyebrow="背景"
              title="你学过什么"
              description=""
              action={<GhostAddButton onClick={addEducation}>添加教育经历</GhostAddButton>}
            />

            <div className="mt-5 space-y-4">
              {education.map((edu, index) => (
                <div
                  key={edu.id}
                  className="rounded-[28px] border border-black/6 bg-white/84 px-5 py-5 shadow-[0_8px_20px_rgba(15,23,42,0.04)]"
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="rounded-full bg-tag px-3 py-1 text-xs font-medium text-secondary">
                      教育经历 {index + 1}
                    </div>
                    {education.length > 1 && (
                      <button
                        onClick={() => removeEducation(edu.id)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-tertiary transition-colors hover:bg-black/[0.04] hover:text-error"
                        aria-label={`删除第 ${index + 1} 段教育经历`}
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div>
                      <FieldLabel>学校名称</FieldLabel>
                      <input
                        type="text"
                        value={edu.school}
                        onChange={(e) => updateEducation(edu.id, 'school', e.target.value)}
                        placeholder="你在哪读过书"
                        className={inputClassName}
                      />
                    </div>
                    <div>
                      <FieldLabel>专业或方向</FieldLabel>
                      <input
                        type="text"
                        value={edu.major}
                        onChange={(e) => updateEducation(edu.id, 'major', e.target.value)}
                        placeholder="例如：计算机、心理学、市场营销"
                        className={inputClassName}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20">
        <div className="mx-auto max-w-md px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 sm:px-6">
          <div className="rounded-[28px] border border-white/72 bg-surface/84 p-3 shadow-[0_10px_26px_rgba(15,23,42,0.06)] backdrop-blur-md">
            <p className="px-2 pb-2 text-xs leading-5 text-secondary">
              保存后，后续生成的新课程会优先参考这些信息。
            </p>

            <button
              onClick={handleSave}
              disabled={isSaving}
              className="inline-flex min-h-13 w-full items-center justify-center rounded-full bg-cta px-6 py-3 text-sm font-semibold text-cta shadow-[0_10px_24px_rgba(17,24,39,0.10)] transition-all duration-150 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSaving ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  保存中...
                </span>
              ) : saveSuccess ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  已保存
                </span>
              ) : (
                '保存并更新学习画像'
              )}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
