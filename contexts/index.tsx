'use client';

import { CourseProvider } from './CourseContext';
import { UserProfileProvider, useUserProfile } from './UserProfileContext';
import { AuthProvider } from './AuthContext';

export function CombinedProvider({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <CourseProvider>
        <UserProfileProvider>
          {children}
        </UserProfileProvider>
      </CourseProvider>
    </AuthProvider>
  );
}

export { UserProfileProvider, useUserProfile };