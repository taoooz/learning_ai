'use client';

import { CourseNode as CourseNodeType } from '@/types/course';

interface CourseNodeProps {
  node: CourseNodeType;
  isActive: boolean;
  onClick: () => void;
}

export function CourseNode({ node, isActive, onClick }: CourseNodeProps) {
  const isLocked = node.status === 'locked';
  const isCompleted = node.status === 'completed';

  return (
    <button
      onClick={onClick}
      disabled={isLocked}
      className={`
        w-full text-left p-4 rounded-lg border-2 transition-all
        ${isLocked ? 'bg-gray-100 border-gray-200 cursor-not-allowed opacity-60' : ''}
        ${isActive && !isCompleted ? 'border-blue-500 bg-blue-50' : ''}
        ${isCompleted ? 'bg-green-50 border-green-200' : ''}
        ${node.status === 'available' ? 'bg-white border-gray-200 hover:border-blue-400 cursor-pointer' : ''}
      `}
    >
      <div className="flex items-center gap-3">
        {/* 状态图标 */}
        <div className={`
          w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
          ${isLocked ? 'bg-gray-200 text-gray-400' : ''}
          ${isCompleted ? 'bg-green-500 text-white' : ''}
          ${node.status === 'available' ? 'bg-blue-500 text-white' : ''}
        `}>
          {isCompleted ? '✓' : isLocked ? '🔒' : node.index + 1}
        </div>

        {/* 内容 */}
        <div className="flex-1 min-w-0">
          <h3 className={`font-medium truncate ${isLocked ? 'text-gray-400' : 'text-gray-900'}`}>
            {node.title}
          </h3>
          <p className={`text-sm truncate ${isLocked ? 'text-gray-300' : 'text-gray-500'}`}>
            {node.description}
          </p>
        </div>

        {/* 箭头 */}
        {!isLocked && !isCompleted && (
          <span className="text-gray-400">→</span>
        )}
      </div>
    </button>
  );
}