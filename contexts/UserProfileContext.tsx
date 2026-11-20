'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { UserProfile } from '@/types/course';
import { getUserProfile, saveUserProfile, getRecommendations, saveRecommendations } from '@/lib/storage';
import { getServerProfile, ingestProfileMemory } from '@/lib/memory-client';

interface UserProfileContextType {
  userProfile: UserProfile | null;
  updateProfile: (profile: UserProfile) => Promise<void>;
  isLoaded: boolean;
  error: Error | null;
}

const UserProfileContext = createContext<UserProfileContextType | null>(null);

export function UserProfileProvider({ children }: { children: React.ReactNode }) {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const localProfile = getUserProfile();
        if (!cancelled && localProfile) setUserProfile(localProfile);
        const serverProfile = await getServerProfile();
        if (!cancelled && serverProfile) {
          saveUserProfile(serverProfile);
          setUserProfile(serverProfile);
          void ingestProfileMemory(serverProfile);
        } else if (!cancelled && localProfile) {
          void ingestProfileMemory(localProfile);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err : new Error('Failed to load profile'));
      } finally {
        if (!cancelled) setIsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const generateRecommendationsIfNeeded = useCallback(async (profile: UserProfile) => {
    const existing = getRecommendations();
    if (existing.length > 0) return;

    try {
      const profileInsights = profile?.insights;
      const insights = profileInsights ? [
        profileInsights.summary,
        ...(profileInsights.workSummary || []).slice(0, 2),
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

  const updateProfile = useCallback(async (profile: UserProfile): Promise<void> => {
    try {
      await ingestProfileMemory(profile, { throwOnError: true });
      saveUserProfile(profile);
      setUserProfile(profile);
      void generateRecommendationsIfNeeded(profile);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to save profile'));
      throw err;
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
