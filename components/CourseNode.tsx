'use client';

import { motion } from 'framer-motion';
import { CourseNode as CourseNodeType } from '@/types/course';

interface CourseNodeProps {
  node: CourseNodeType;
  isCurrent: boolean;
  offset: number;
  onClick: () => void;
}

export function CourseNode({ node, isCurrent, offset, onClick }: CourseNodeProps) {
  const isLocked = node.status === 'locked';
  const isCompleted = node.status === 'completed';
  const badgeText = isCompleted ? '✓ 已完成' : isCurrent ? '▶ 开始学习' : '待学习';
  const nodeScaleWhileTap = isLocked ? 1 : 0.965;
  const cardScaleWhileTap = isLocked ? 1 : 0.985;
  const titleLineHeightClassName = isCurrent ? 'leading-[22px]' : 'leading-[21px]';
  const titleClampStyle = {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical' as const,
    WebkitLineClamp: 3,
    overflow: 'hidden',
  };

  return (
    <div className="relative min-h-[108px]">
      <div
        className="relative w-[248px]"
        style={{
          marginLeft: '18%',
          transform: `translateX(${offset}px)`,
        }}
      >
        <motion.button
          type="button"
          onClick={onClick}
          disabled={isLocked}
          aria-label={`${node.title}${isLocked ? '，待解锁' : ''}`}
          whileHover={isLocked ? undefined : { y: -1, scale: isCurrent ? 1.01 : 1.02 }}
          whileTap={isLocked ? undefined : { y: 1, scale: nodeScaleWhileTap }}
          animate={isCurrent ? { y: [0, -1.5, 0], scale: [1, 1.012, 1] } : undefined}
          transition={isCurrent ? { duration: 2.8, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.18 }}
          className={`absolute top-7 h-[56px] w-[56px] -translate-x-1/2 rounded-full transition-all duration-200 ${
            isLocked ? 'cursor-default' : 'cursor-pointer'
          } ${
            isCompleted
              ? 'bg-[linear-gradient(180deg,#FFFFFF,#F7FBF8)]'
              : isCurrent
                ? 'bg-[linear-gradient(180deg,#FFFDFB,#FFF5EC)] ring-[6px] ring-[rgba(255,138,0,0.12)]'
                : 'bg-[linear-gradient(180deg,#F0F0EE,#E4E3E0)]'
          }`}
        >
          {isCurrent && (
            <motion.div
              aria-hidden="true"
              className="absolute inset-[-8px] rounded-full border border-[rgba(255,138,0,0.18)]"
              animate={{ opacity: [0.18, 0.38, 0.18], scale: [0.96, 1.08, 0.96] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
          <div
            className={`flex h-full w-full items-center justify-center rounded-full border-[4px] ${
              isLocked ? 'border-white/60' : 'border-white/92'
            } ${
              isCompleted ? 'bg-[linear-gradient(180deg,#FFFFFF,#F5FBF8)]' : ''
            } ${
              isCurrent ? 'bg-[linear-gradient(180deg,#FFFFFF,#FFF7F0)]' : ''
            } ${
              !isCompleted && !isCurrent ? 'bg-[linear-gradient(180deg,#F8F8F7,#ECECEA)]' : ''
            }`}
          >
            {isCompleted ? (
              <svg className="h-5.5 w-5.5 text-[#3FA577]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M5 13l4 4L19 7" />
              </svg>
            ) : isLocked ? (
              <svg className="h-5 w-5 text-[#A4A29F]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            ) : isCurrent ? (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="#FF8A00" aria-hidden="true">
                <path d="M12 3.6c.25 0 .48.14.6.36l2.2 4.48c.09.18.26.31.46.34l4.95.72c.58.08.81.8.39 1.21l-3.58 3.49c-.15.15-.22.36-.19.57l.85 4.93c.1.58-.51 1.03-1.03.76l-4.42-2.32a.77.77 0 0 0-.72 0l-4.42 2.32c-.52.27-1.13-.18-1.03-.76l.85-4.93a.76.76 0 0 0-.19-.57L3.4 10.71c-.42-.41-.19-1.13.39-1.21l4.95-.72a.76.76 0 0 0 .46-.34l2.2-4.48c.12-.22.35-.36.6-.36z" />
              </svg>
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/40 text-[13px] font-bold text-[#8B8A87]">
                {node.index + 1}
              </div>
            )}
          </div>
        </motion.button>

        <motion.button
          type="button"
          onClick={onClick}
          disabled={isLocked}
          whileHover={isLocked ? undefined : { y: -2, scale: isCurrent ? 1.01 : 1.012 }}
          whileTap={isLocked ? undefined : { y: 1, scale: cardScaleWhileTap }}
          className={`ml-[44px] mt-2 flex min-h-[78px] w-[204px] flex-col rounded-[20px] border-2 px-4 py-3 text-left transition-all duration-200 ${
            isLocked ? 'cursor-default' : 'cursor-pointer'
          } ${
            isLocked
              ? 'border-[#D4D3D0] bg-[#F4F3EF] text-tertiary opacity-70'
              : isCompleted
                ? 'border-[#3FA577]/30 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(247,252,249,0.96))] text-primary shadow-[0_2px_8px_rgba(63,165,119,0.08)]'
                : isCurrent
                  ? 'border-[#FF8A00] bg-[linear-gradient(135deg,rgba(255,255,255,1),rgba(255,247,239,0.98))] text-primary shadow-[0_4px_16px_rgba(255,138,0,0.15)]'
                  : 'border-accent/20 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(255,249,244,0.96))] text-primary hover:border-accent/40 hover:shadow-[0_2px_12px_rgba(255,138,0,0.1)]'
          }`}
        >
          <div
            className={`text-[11px] font-semibold ${
              isLocked ? 'text-[#A4A29F]' : isCurrent ? 'text-accent' : isCompleted ? 'text-[#3FA577]' : 'text-accent/80'
            }`}
          >
            {badgeText}
          </div>
          <div
            className={`mt-1.5 break-words ${titleLineHeightClassName} ${isCurrent ? 'text-[16px] font-semibold' : 'text-[15px] font-semibold'}`}
            style={titleClampStyle}
          >
            {node.title}
          </div>
        </motion.button>
      </div>
    </div>
  );
}
