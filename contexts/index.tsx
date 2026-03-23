'use client';

import { CourseProvider } from './CourseContext';
import { ProgressProvider } from './ProgressContext';
import { UserProfileProvider, useUserProfile } from './UserProfileContext';

export function CombinedProvider({ children }: { children: React.ReactNode }) {
  return (
    <CourseProvider>
      <ProgressProvider>
        <UserProfileProvider>
          {children}
        </UserProfileProvider>
      </ProgressProvider>
    </CourseProvider>
  );
}

export { UserProfileProvider, useUserProfile };