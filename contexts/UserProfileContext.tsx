'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { UserProfile } from '@/types/course';
import { getUserProfile, saveUserProfile, getRecommendations, saveRecommendations } from '@/lib/storage';

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

  const generateRecommendationsIfNeeded = useCallback(async (profile: UserProfile) => {
    const existing = getRecommendations();
    if (existing.length > 0) return;

    try {
      const profileInsights = profile?.insights;
      const insights = profileInsights ? [
        profileInsights.summary,
        ...(profileInsights.knowledgeBackground || []).slice(0, 2),
      ].filter(Boolean) : [];

      const context = {
        targetJob: profile?.targetJob || '',
        existingTopics: [],
        insights,
        recentTopics: [],
        previousRecommendations: [],
      };

      const response = await fetch('/api/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.recommendations?.length > 0) {
          saveRecommendations(data.recommendations);
        }
      }
    } catch (err) {
      console.warn('[UserProfileContext] Failed to generate recommendations:', err);
    }
  }, []);

  const updateProfile = useCallback((profile: UserProfile) => {
    try {
      saveUserProfile(profile);
      setUserProfile(profile);
      // 如果还没有推荐课程，生成一份
      generateRecommendationsIfNeeded(profile);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to save profile'));
    }
  }, [generateRecommendationsIfNeeded]);

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