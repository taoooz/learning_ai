// app/profile/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { UserProfile, WorkExperience, Education } from '@/types/course';

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

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
      setWorkExperience(userProfile.workExperience || []);
      setEducation(userProfile.education || []);
    } else {
      // 默认空数据
      setWorkExperience([{ id: generateId(), company: '', position: '', description: '' }]);
      setEducation([{ id: generateId(), school: '', major: '' }]);
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
    }).then(updatedProfile => {
      updateProfile(updatedProfile);
    }).catch(error => {
      console.error('Background insights generation failed:', error);
    });
  };

  const addWorkExperience = () => {
    setWorkExperience([...workExperience, { id: generateId(), company: '', position: '', description: '' }]);
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
    setEducation([...education, { id: generateId(), school: '', major: '' }]);
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
    <main className="min-h-screen bg-background">
      <div className="w-full max-w-md mx-auto px-6 pt-6 pb-8">
        {/* 返回按钮 */}
        <button
          onClick={() => router.push('/')}
          className="mb-6 text-secondary hover:text-primary flex items-center gap-1 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span>返回</span>
        </button>

        <h1 className="text-2xl font-bold text-primary mb-6">个人资料</h1>

        {/* 目标岗位 - 直接展示 */}
        <div className="mb-6">
          <label className="text-sm font-medium text-secondary mb-2 block">目标岗位</label>
          <input
            type="text"
            value={targetJob}
            onChange={(e) => setTargetJob(e.target.value)}
            placeholder="例如：前端工程师"
            className="w-full px-4 py-3 rounded-xl border border-subtle bg-surface focus:border-accent focus:ring-2 focus:ring-accent/10 outline-none transition-all text-primary placeholder:text-placeholder"
          />
        </div>

        {/* 姓名 */}
        <div className="mb-6">
          <label className="text-sm font-medium text-secondary mb-2 block">姓名</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="请输入姓名"
            className="w-full px-4 py-3 rounded-xl border border-subtle bg-surface focus:border-accent focus:ring-2 focus:ring-accent/10 outline-none transition-all text-primary placeholder:text-placeholder"
          />
        </div>

        {/* 工作经历 */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-3">
            <label className="text-sm font-medium text-secondary">工作经历</label>
            <button
              onClick={addWorkExperience}
              className="text-sm text-accent hover:text-accent/80 font-medium transition-colors"
            >
              + 添加
            </button>
          </div>
          {workExperience.map((work) => (
            <div key={work.id} className="mb-3">
              {workExperience.length > 1 && (
                <button
                  onClick={() => removeWorkExperience(work.id)}
                  className="float-right -mt-2 w-6 h-6 flex items-center justify-center text-tertiary hover:text-error rounded-full transition-all"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
              <div className="space-y-2">
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={work.company}
                    onChange={(e) => updateWorkExperience(work.id, 'company', e.target.value)}
                    placeholder="公司名称"
                    className="flex-1 px-3 py-2.5 rounded-lg border border-subtle bg-surface focus:border-accent outline-none text-sm min-w-0"
                  />
                  <input
                    type="text"
                    value={work.position}
                    onChange={(e) => updateWorkExperience(work.id, 'position', e.target.value)}
                    placeholder="岗位"
                    className="flex-1 px-3 py-2.5 rounded-lg border border-subtle bg-surface focus:border-accent outline-none text-sm min-w-0"
                  />
                </div>
                <textarea
                  value={work.description || ''}
                  onChange={(e) => updateWorkExperience(work.id, 'description', e.target.value)}
                  placeholder="工作内容（可选）"
                  rows={2}
                  className="w-full px-3 py-2.5 rounded-lg border border-subtle bg-surface focus:border-accent outline-none text-sm resize-none"
                />
              </div>
            </div>
          ))}
        </div>

        {/* 教育经历 */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-3">
            <label className="text-sm font-medium text-secondary">教育经历</label>
            <button
              onClick={addEducation}
              className="text-sm text-accent hover:text-accent/80 font-medium transition-colors"
            >
              + 添加
            </button>
          </div>
          {education.map((edu) => (
            <div key={edu.id} className="mb-3">
              {education.length > 1 && (
                <button
                  onClick={() => removeEducation(edu.id)}
                  className="float-right -mt-2 w-6 h-6 flex items-center justify-center text-tertiary hover:text-error rounded-full transition-all"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
              <div className="space-y-2">
                <input
                  type="text"
                  value={edu.school}
                  onChange={(e) => updateEducation(edu.id, 'school', e.target.value)}
                  placeholder="学校名称"
                  className="w-full px-3 py-2.5 rounded-lg border border-subtle bg-surface focus:border-accent outline-none text-sm"
                />
                <input
                  type="text"
                  value={edu.major}
                  onChange={(e) => updateEducation(edu.id, 'major', e.target.value)}
                  placeholder="专业"
                  className="w-full px-3 py-2.5 rounded-lg border border-subtle bg-surface focus:border-accent outline-none text-sm"
                />
              </div>
            </div>
          ))}
        </div>

        {/* 保存按钮 */}
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full py-4 rounded-2xl bg-accent text-white font-semibold shadow-lg shadow-accent/25 hover:shadow-xl hover:shadow-accent/30 active:scale-[0.98] disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed transition-all duration-200"
        >
          {isSaving ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              保存中...
            </span>
          ) : saveSuccess ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              已保存
            </span>
          ) : (
            '保存设置'
          )}
        </button>
      </div>
    </main>
  );
}
