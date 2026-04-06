'use client';

import type { OutlineBlueprint } from '@/types/course';

interface ConfirmationCardProps {
  blueprint: OutlineBlueprint;
  onConfirm: (blueprint: OutlineBlueprint) => void;
  onEdit: () => void;
}

export function ConfirmationCard({ blueprint, onConfirm, onEdit }: ConfirmationCardProps) {
  const { learningDirection, learningGoal, learnerPositioning } = blueprint;
  const { estimatedLevel, difficultySummary, backgroundSummary, skipBasics, whyThisCourseFits } = learnerPositioning;

  const levelLabels: Record<string, string> = {
    novice: '初学者',
    beginner: '入门',
    intermediate: '进阶',
    advanced: '高级',
  };

  const handleConfirm = () => {
    onConfirm(blueprint);
  };

  return (
    <div className="bg-surface border border-[rgba(0,0,0,0.06)] rounded-2xl p-5 shadow-[0_8px_32px_rgba(255,138,0,0.08)]">
      {/* 状态标签 */}
      <div className="mb-4">
        <span className="inline-flex h-7 items-center rounded-full bg-success/12 px-3 text-xs font-medium text-success">
          课程纲要已生成
        </span>
      </div>

      <div className="space-y-5">
        {/* 学习方向 */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-accent uppercase tracking-wide">学习方向</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-accent/12 text-accent font-medium">
              {levelLabels[estimatedLevel] || estimatedLevel}
            </span>
          </div>
          <p className="text-[15px] text-primary leading-relaxed pl-4 border-l-2 border-accent/20">
            {learningDirection}
          </p>
        </div>

        {/* 学习目标 */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-accent uppercase tracking-wide">学习目标</span>
          </div>
          <p className="text-[15px] text-primary leading-relaxed pl-4 border-l-2 border-accent/20">
            {learningGoal}
          </p>
        </div>

        {/* 个人基础 */}
        <div className="bg-[rgba(255,138,0,0.04)] rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-accent uppercase tracking-wide">个人基础</span>
          </div>

          <div className="space-y-2.5 pl-4 border-l-2 border-accent/20">
            {difficultySummary && (
              <div className="flex items-start gap-2">
                <span className="text-sm text-tertiary shrink-0 w-16">难度定位</span>
                <span className="text-sm text-secondary flex-1">{difficultySummary}</span>
              </div>
            )}
            {backgroundSummary && (
              <div className="flex items-start gap-2">
                <span className="text-sm text-tertiary shrink-0 w-16">背景知识</span>
                <span className="text-sm text-secondary flex-1">{backgroundSummary}</span>
              </div>
            )}
            {skipBasics && skipBasics.length > 0 && (
              <div className="flex items-start gap-2">
                <span className="text-sm text-tertiary shrink-0 w-16">已跳过</span>
                <span className="text-sm text-secondary flex-1">{skipBasics.join('、')}</span>
              </div>
            )}
            {whyThisCourseFits && (
              <div className="flex items-start gap-2 pt-2 border-t border-accent/10">
                <span className="text-sm text-tertiary shrink-0 w-16">为什么适合</span>
                <span className="text-sm text-secondary flex-1 leading-relaxed">{whyThisCourseFits}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-3 mt-6">
        <button
          onClick={onEdit}
          className="flex-1 h-12 px-5 py-3 border border-[rgba(0,0,0,0.08)] rounded-full text-sm font-medium text-secondary bg-surface hover:bg-[rgba(0,0,0,0.03)] active:scale-[0.98] transition-all duration-150"
        >
          重新调整
        </button>
        <button
          onClick={handleConfirm}
          className="flex-1 h-12 px-5 py-3 bg-[var(--color-cta)] text-[var(--color-cta-text)] rounded-full text-sm font-semibold shadow-[0_8px_24px_rgba(255,138,0,0.25)] hover:shadow-[0_12px_28px_rgba(255,138,0,0.32)] active:scale-[0.98] transition-all duration-150"
        >
          确认，开始生成课程目录
        </button>
      </div>
    </div>
  );
}
