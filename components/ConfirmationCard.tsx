'use client';

import type { CourseBlueprint } from '@/types/course';

interface ConfirmationCardProps {
  blueprint: CourseBlueprint;
  onConfirm: () => void;
  onEdit: () => void;
}

export function ConfirmationCard({ blueprint, onConfirm, onEdit }: ConfirmationCardProps) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-lg">
      <h3 className="font-semibold text-lg mb-3">课程纲要确认</h3>

      <div className="space-y-3 text-sm">
        <div>
          <span className="text-muted">学习方向：</span>
          <span>{blueprint.learnerPositioning?.whyThisCourseFits || '待补充'}</span>
        </div>
        <div>
          <span className="text-muted">学习目标：</span>
          <span>{blueprint.courseGoal}</span>
        </div>
        <div>
          <span className="text-muted">你的基础：</span>
          <span>{blueprint.learnerPositioning?.difficultySummary || '待评估'}</span>
        </div>
      </div>

      <div className="flex gap-2 mt-4">
        <button onClick={onConfirm} className="flex-1 bg-primary text-white rounded-lg py-2">
          确认开始生成
        </button>
        <button onClick={onEdit} className="px-4 py-2 border rounded-lg">
          修改
        </button>
      </div>
    </div>
  );
}