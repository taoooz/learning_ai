'use client';

// 全局动效配置：尊重系统“减少动态效果”设置，降级为静态终态
import { MotionConfig } from 'framer-motion';

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
