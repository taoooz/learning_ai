'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { UserProfile } from '@/types/course';
import { getUserProfile, saveUserProfile } from '@/lib/storage';

interface UserProfileContextType {
  userProfile: UserProfile | null;
  updateProfile: (profile: UserProfile) => void;
  isLoaded: boolean;
}

const UserProfileContext = createContext<UserProfileContextType | null>(null);

export function UserProfileProvider({ children }: { children: React.ReactNode }) {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const profile = getUserProfile();
    setUserProfile(profile);
    setIsLoaded(true);
  }, []);

  const updateProfile = useCallback((profile: UserProfile) => {
    saveUserProfile(profile);
    setUserProfile(profile);
  }, []);

  return (
    <UserProfileContext.Provider value={{ userProfile, updateProfile, isLoaded }}>
      {children}
    </UserProfileContext.Provider>
  );
}

export function useUserProfile() {
  const context = useContext(UserProfileContext);
  if (!context) throw new Error('useUserProfile must be used within UserProfileProvider');
  return context;
}