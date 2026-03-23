'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { UserProfile } from '@/types/course';
import { getUserProfile, saveUserProfile } from '@/lib/storage';

interface UserProfileContextType {
  userProfile: UserProfile | null;
  updateProfile: (profile: UserProfile) => void;
  isLoaded: boolean;
  error: Error | null;
}

const UserProfileContext = createContext<UserProfileContextType | null>(null);

export function UserProfileProvider({ children }: { children: React.ReactNode }) {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    try {
      const profile = getUserProfile();
      setUserProfile(profile);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load profile'));
    } finally {
      setIsLoaded(true);
    }
  }, []);

  const updateProfile = useCallback((profile: UserProfile) => {
    try {
      saveUserProfile(profile);
      setUserProfile(profile);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to save profile'));
    }
  }, []);

  return (
    <UserProfileContext.Provider value={{ userProfile, updateProfile, isLoaded, error }}>
      {children}
    </UserProfileContext.Provider>
  );
}

export function useUserProfile() {
  const context = useContext(UserProfileContext);
  if (!context) throw new Error('useUserProfile must be used within UserProfileProvider');
  return context;
}