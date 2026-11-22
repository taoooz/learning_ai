'use client';

import { motion } from 'framer-motion';
import type { OutlineBlueprint } from '@/types/course';
import { shouldRenderLearnerPositioningCard } from './outline-card-utils';

type OutlineCardProps = {
  blueprint: OutlineBlueprint;
  onConfirm: () => void;
  showActions: boolean;
  embedded?: boolean;
  streaming?: boolean;
};

// 后端可能返回英文键或中文水平值，两种展示值都在当前契约内
const LEVEL_LABELS: Record<string, string> = {
  novice: '入门',
  beginner: '初级',
  intermediate: '中级',
  advanced: '高级',
  '入门': '入门',
  '初级': '初级',
  '中级': '中级',
  '高级': '高级',
};

export function OutlineCard({ blueprint, onConfirm, showActions, embedded = false, streaming = false }: OutlineCardProps) {
  const {
    estimatedLevel,
    backgroundSummary,
    skipBasics,
    likelyGaps,
    levelConfidence,
    preferredExampleDomains,
    personalExampleLimit,
  } = blueprint.learnerPositioning;
  const hasContent = shouldRenderLearnerPositioningCard({
    estimatedLevel,
    backgroundSummary,
    skipBasics,
    likelyGaps,
    preferredExampleDomains,
  });
  const shouldShowLearnerPositioning = hasContent || streaming;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={embedded ? '' : 'flex justify-start'}
    >
      <div className="space-y-3">
        {/* 纲要内容 - Markdown 风格 */}
        <div className={`${embedded ? '' : 'rounded-2xl border border-[rgba(0,0,0,0.06)] bg-surface px-4 py-3.5'} space-y-3`}>
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
          {shouldShowLearnerPositioning && (
            <div className="rounded-lg bg-background p-3">
              <h4 className="mb-1.5 text-xs font-medium text-secondary">为你定制</h4>
              {!hasContent && streaming ? (
                <motion.div
                  className="space-y-2"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-tertiary">难度：</span>
                    <span className="inline-block h-4 w-12 animate-pulse rounded bg-black/[0.06]" />
                  </div>
                  <div className="space-y-1">
                    <span className="inline-block h-3 w-16 animate-pulse rounded bg-black/[0.04]" />
                    <span className="inline-block h-4 w-full animate-pulse rounded bg-black/[0.06]" />
                  </div>
                </motion.div>
              ) : (
                <div className="space-y-2 text-sm text-primary">
                  <div className="flex items-center gap-2">
                    <span className="text-tertiary">难度：</span>
                    <span className="font-medium">
                      {LEVEL_LABELS[estimatedLevel] ?? estimatedLevel}
                      {typeof levelConfidence === 'number' ? ` · 把握度 ${Math.round(levelConfidence * 100)}%` : ''}
                    </span>
                  </div>
                  {backgroundSummary && (
                    <div className="space-y-1">
                      <p className="text-xs text-tertiary">背景知识</p>
                      <p className="text-[15px] leading-relaxed">{backgroundSummary}</p>
                    </div>
                  )}
                  {skipBasics && skipBasics.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs text-tertiary">已掌握知识</p>
                      <p className="text-[15px] leading-relaxed">{skipBasics.join('、')}</p>
                    </div>
                  )}
                  {likelyGaps && likelyGaps.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs text-tertiary">可能缺口</p>
                      <p className="text-[15px] leading-relaxed">{likelyGaps.join('、')}</p>
                    </div>
                  )}
                  {(preferredExampleDomains?.length || typeof personalExampleLimit === 'number') && (
                    <div className="space-y-1">
                      <p className="text-xs text-tertiary">例子策略</p>
                      <p className="text-[15px] leading-relaxed">
                        {preferredExampleDomains?.length ? `优先 ${preferredExampleDomains.join('、')}` : '优先通用场景'}
                        {typeof personalExampleLimit === 'number' ? `；每章个人经历最多 ${personalExampleLimit} 次` : ''}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 操作按钮 - 独立 cell */}
        {showActions && (
          <div className={`space-y-2 ${embedded ? '' : 'pl-2'}`}>
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
