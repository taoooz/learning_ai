'use client';

import { CourseProvider } from './CourseContext';
import { ProgressProvider } from './ProgressContext';
import { UserProfileProvider, useUserProfile } from './UserProfileContext';
import { AuthProvider } from './AuthContext';

export function CombinedProvider({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <CourseProvider>
        <ProgressProvider>
          <UserProfileProvider>
            {children}
          </UserProfileProvider>
        </ProgressProvider>
      </CourseProvider>
    </AuthProvider>
  );
}

export { UserProfileProvider, useUserProfile };