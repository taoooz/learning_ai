'use client';

import { motion } from 'framer-motion';
import type { OutlineBlueprint } from '@/types/course';

type OutlineCardProps = {
  blueprint: OutlineBlueprint;
  onConfirm: () => void;
  showActions: boolean;
};

export function OutlineCard({ blueprint, onConfirm, showActions }: OutlineCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex justify-start"
    >
      <div className="space-y-3">
        {/* 纲要内容 - Markdown 风格 */}
        <div className="rounded-2xl border border-[rgba(0,0,0,0.06)] bg-surface px-4 py-3.5 space-y-3">
          {/* 学习方向 */}
          <div>
            <h4 className="mb-1 text-xs font-medium text-secondary">学习方向</h4>
            <p className="text-[15px] leading-relaxed text-primary">{blueprint.learningDirection}</p>
          </div>

          {/* 学习目标 */}
          <div>
            <h4 className="mb-1 text-xs font-medium text-secondary">学习目标</h4>
            <p className="text-[15px] leading-relaxed text-primary">{blueprint.learningGoal}</p>
          </div>

          {/* 学习者定位 */}
          {blueprint.learnerPositioning && (
            <div className="rounded-lg bg-background p-3">
              <h4 className="mb-1.5 text-xs font-medium text-secondary">为你定制</h4>
              <div className="space-y-1.5 text-sm text-primary">
                <div className="flex items-center gap-2">
                  <span className="text-tertiary">难度：</span>
                  <span className="font-medium">
                    {blueprint.learnerPositioning.estimatedLevel === 'novice' && '入门'}
                    {blueprint.learnerPositioning.estimatedLevel === 'beginner' && '初级'}
                    {blueprint.learnerPositioning.estimatedLevel === 'intermediate' && '中级'}
                    {blueprint.learnerPositioning.estimatedLevel === 'advanced' && '高级'}
                  </span>
                </div>
                {blueprint.learnerPositioning.whyThisCourseFits && (
                  <p className="text-[15px] leading-relaxed">{blueprint.learnerPositioning.whyThisCourseFits}</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 操作按钮 - 独立 cell */}
        {showActions && (
          <div className="space-y-2 pl-2">
            <button
              onClick={onConfirm}
              className="w-full rounded-xl border border-accent/40 bg-[linear-gradient(135deg,rgba(255,138,0,0.08),rgba(255,248,240,1))] px-4 py-3 text-sm font-semibold text-accent shadow-md transition-all hover:shadow-lg active:scale-[0.98]"
            >
              ✓ 确认开始学习
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
