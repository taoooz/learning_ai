'use client';

import { CourseProvider } from './CourseContext';
import { ProgressProvider } from './ProgressContext';

export function CombinedProvider({ children }: { children: React.ReactNode }) {
  return (
    <CourseProvider>
      <ProgressProvider>
        {children}
      </ProgressProvider>
    </CourseProvider>
  );
}