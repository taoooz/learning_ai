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
  const [insightsError, setInsightsError] = useState(false);

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
    setInsightsError(false);
    updateProfile(profile);

    // 调用洞察 API 获取个性化学习建议（带重试机制）
    let insightsSuccess = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await fetch('/api/profile/insights', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(profile),
        });

        if (response.ok) {
          const updatedProfile = await response.json();
          // 用返回的完整数据更新上下文（包含 insights）
          updateProfile(updatedProfile);
          insightsSuccess = true;
          break;
        } else {
          console.error(`Insights API attempt ${attempt} failed with status:`, response.status);
          if (attempt < 2) {
            // 等待一秒后重试
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      } catch (error) {
        console.error(`Insights API attempt ${attempt} threw error:`, error);
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    if (!insightsSuccess) {
      setInsightsError(true);
    }

    setIsSaving(false);
    setSaveSuccess(true);

    // 保存成功后返回首页
    setTimeout(() => {
      router.push('/');
    }, 500);  // 短暂延迟让用户看到"已保存"提示
  };

  // 工作经历操作
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

  // 教育经历操作
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
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">加载中...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="w-full max-w-md mx-auto">
        {/* 返回首页 */}
        <button
          onClick={() => router.push('/')}
          className="mb-6 text-gray-500 hover:text-gray-700 flex items-center gap-1"
        >
          <span>←</span>
          <span>首页</span>
        </button>

        <h1 className="text-2xl font-bold text-gray-900 mb-6">个人设置</h1>

        {/* 求职意向 */}
        <section className="bg-white rounded-xl p-5 mb-4 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">求职意向</h2>
          <input
            type="text"
            value={targetJob}
            onChange={(e) => setTargetJob(e.target.value)}
            placeholder="目标岗位，例如：前端工程师"
            className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
          />
        </section>

        {/* 个人简历 */}
        <section className="bg-white rounded-xl p-5 mb-4 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">个人简历</h2>

          {/* 姓名 */}
          <div className="mb-4">
            <label className="text-sm font-medium text-gray-700 mb-1 block">姓名</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="请输入姓名"
              className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
            />
          </div>

          {/* 工作经历 */}
          <div className="mb-4">
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium text-gray-700">工作经历</label>
              <button
                onClick={addWorkExperience}
                className="text-sm text-blue-500 hover:text-blue-600"
              >
                + 添加
              </button>
            </div>
            {workExperience.map((work, index) => (
              <div key={work.id} className="border border-gray-200 rounded-lg p-3 mb-2 relative">
                {workExperience.length > 1 && (
                  <button
                    onClick={() => removeWorkExperience(work.id)}
                    className="absolute top-2 right-2 text-gray-400 hover:text-red-500"
                  >
                    ×
                  </button>
                )}
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={work.company}
                      onChange={(e) => updateWorkExperience(work.id, 'company', e.target.value)}
                      placeholder="公司名称"
                      className="flex-1 px-3 py-2 rounded-lg border border-gray-300 focus:border-blue-500 outline-none text-sm"
                    />
                    <input
                      type="text"
                      value={work.position}
                      onChange={(e) => updateWorkExperience(work.id, 'position', e.target.value)}
                      placeholder="岗位"
                      className="flex-1 px-3 py-2 rounded-lg border border-gray-300 focus:border-blue-500 outline-none text-sm"
                    />
                  </div>
                  <textarea
                    value={work.description || ''}
                    onChange={(e) => updateWorkExperience(work.id, 'description', e.target.value)}
                    placeholder="工作内容（可选）"
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:border-blue-500 outline-none text-sm resize-none"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* 教育经历 */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium text-gray-700">教育经历</label>
              <button
                onClick={addEducation}
                className="text-sm text-blue-500 hover:text-blue-600"
              >
                + 添加
              </button>
            </div>
            {education.map((edu, index) => (
              <div key={edu.id} className="border border-gray-200 rounded-lg p-3 mb-2 relative">
                {education.length > 1 && (
                  <button
                    onClick={() => removeEducation(edu.id)}
                    className="absolute top-2 right-2 text-gray-400 hover:text-red-500"
                  >
                    ×
                  </button>
                )}
                <div className="space-y-2">
                  <input
                    type="text"
                    value={edu.school}
                    onChange={(e) => updateEducation(edu.id, 'school', e.target.value)}
                    placeholder="学校名称"
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:border-blue-500 outline-none text-sm"
                  />
                  <input
                    type="text"
                    value={edu.major}
                    onChange={(e) => updateEducation(edu.id, 'major', e.target.value)}
                    placeholder="专业"
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:border-blue-500 outline-none text-sm"
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 保存按钮 */}
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full py-3 rounded-xl bg-blue-500 text-white font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {isSaving ? '保存中...' : saveSuccess ? '已保存 ✓' : '保存设置'}
        </button>

        {/* 洞察提取失败警告 */}
        {insightsError && (
          <p className="mt-3 text-sm text-orange-600 text-center">
            已保存，但洞察提取失败，请稍后刷新重试
          </p>
        )}
      </div>
    </main>
  );
}