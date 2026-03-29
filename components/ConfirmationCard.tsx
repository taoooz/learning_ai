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
    <div className="bg-card border rounded-xl p-6 shadow-lg">
      <h3 className="text-lg font-semibold mb-4">课程纲要确认</h3>

      <div className="space-y-4">
        {/* 学习方向 */}
        <div className="bg-muted/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-medium text-primary uppercase tracking-wide">学习方向</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
              {levelLabels[estimatedLevel] || estimatedLevel}
            </span>
          </div>
          <p className="text-foreground leading-relaxed">{learningDirection}</p>
        </div>

        {/* 学习目标 */}
        <div className="bg-muted/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-medium text-primary uppercase tracking-wide">学习目标</span>
          </div>
          <p className="text-foreground leading-relaxed">{learningGoal}</p>
        </div>

        {/* 个人基础 */}
        <div className="bg-muted/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-medium text-primary uppercase tracking-wide">个人基础</span>
          </div>
          <div className="space-y-3">
            <div>
              <span className="text-sm text-muted">难度定位：</span>
              <span className="text-sm text-foreground">{difficultySummary}</span>
            </div>
            <div>
              <span className="text-sm text-muted">背景知识：</span>
              <span className="text-sm text-foreground">{backgroundSummary}</span>
            </div>
            {skipBasics && skipBasics.length > 0 && (
              <div>
                <span className="text-sm text-muted">已跳过：</span>
                <span className="text-sm text-foreground">{skipBasics.join('、')}</span>
              </div>
            )}
            <div className="pt-2 border-t">
              <span className="text-sm text-muted">为什么适合你：</span>
              <p className="text-sm text-foreground mt-1">{whyThisCourseFits}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-3 mt-6">
        <button
          onClick={onEdit}
          className="flex-1 px-4 py-3 border border-border rounded-lg text-foreground hover:bg-muted/50 transition-colors"
        >
          修改
        </button>
        <button
          onClick={handleConfirm}
          className="flex-1 px-4 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
        >
          确认，开始生成课程目录
        </button>
      </div>
    </div>
  );
}
