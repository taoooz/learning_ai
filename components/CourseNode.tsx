'use client';

import { motion } from 'framer-motion';
import { CourseNode as CourseNodeType } from '@/types/course';

interface CourseNodeProps {
  node: CourseNodeType;
  isCurrent: boolean;
  top: number;
  offset: number;
  onClick: () => void;
}

export function CourseNode({ node, isCurrent, top, offset, onClick }: CourseNodeProps) {
  const isLocked = node.status === 'locked';
  const isCompleted = node.status === 'completed';
  const isAvailable = !isLocked && !isCompleted && !isCurrent;
  const badgeText = isCompleted ? '已完成' : isLocked ? '待解锁' : isCurrent ? '现在学习' : '下一节';
  const nodeScaleWhileTap = isLocked ? 1 : 0.965;
  const cardScaleWhileTap = isLocked ? 1 : 0.985;

  return (
    <div className="absolute left-0 right-0" style={{ top: `${top}px` }}>
      <div className="absolute left-[18%]" style={{ transform: `translateX(${offset}px)` }}>
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
                : isAvailable
                  ? 'bg-[linear-gradient(180deg,#FFFFFF,#FFF9F4)]'
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
              isLocked ? 'border-white/72' : 'border-white/92'
            } ${
              isCompleted ? 'bg-[linear-gradient(180deg,#FFFFFF,#F5FBF8)]' : ''
            } ${
              isCurrent ? 'bg-[linear-gradient(180deg,#FFFFFF,#FFF7F0)]' : ''
            } ${
              isAvailable ? 'bg-[linear-gradient(180deg,#FFFFFF,#FFF9F4)]' : ''
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
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold ${
                  isAvailable
                    ? 'bg-[linear-gradient(135deg,rgba(255,138,0,0.10),rgba(255,255,255,1))] text-accent'
                    : 'bg-white/12 text-white'
                }`}
              >
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
          className={`absolute left-[44px] top-2 w-[204px] rounded-[18px] border px-4 py-2.5 text-left transition-all duration-200 ${
            isLocked ? 'cursor-default' : 'cursor-pointer'
          } ${
            isLocked
              ? 'border-black/5 bg-[#F4F3EF] text-tertiary'
              : isCompleted
                ? 'border-completed bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(247,252,249,0.96))] text-primary'
                : isCurrent
                  ? 'border-[rgba(255,138,0,0.20)] bg-[linear-gradient(135deg,rgba(255,255,255,1),rgba(255,247,239,0.98))] text-primary'
                  : 'border-[rgba(255,138,0,0.08)] bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(255,249,244,0.96))] text-primary hover:border-[rgba(255,138,0,0.14)]'
          }`}
        >
          <div
            className={`text-[10px] font-medium tracking-[0.1em] ${
              isLocked ? 'text-tertiary' : isCurrent ? 'text-accent' : isCompleted ? 'text-[#4AA67B]' : 'text-accent/72'
            }`}
          >
            {badgeText}
          </div>
          <div className={`mt-1 leading-[1.35] ${isCurrent ? 'text-[16px] font-semibold' : 'text-[15px] font-semibold'}`}>
            {node.title}
          </div>
        </motion.button>
      </div>
    </div>
  );
}
