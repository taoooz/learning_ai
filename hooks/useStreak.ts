// hooks/useStreak.ts
'use client';

import { useState, useEffect, useCallback } from 'react';

interface StreakData {
  currentStreak: number;
  bestStreak: number;
  lastStudyDate: string; // ISO 8601 date string, e.g. "2026-04-12"
}

const STORAGE_KEY = 'streak_data';
const DEFAULT_STREAK: StreakData = {
  currentStreak: 0,
  bestStreak: 0,
  lastStudyDate: '',
};

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDaysDiff(a: string, b: string): number {
  const dateA = new Date(a);
  const dateB = new Date(b);
  const ms = dateA.getTime() - dateB.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function readStreak(): StreakData {
  if (typeof window === 'undefined') return DEFAULT_STREAK;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_STREAK, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_STREAK;
}

function writeStreak(data: StreakData): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

export function useStreak() {
  const [streakData, setStreakData] = useState<StreakData>(DEFAULT_STREAK);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setStreakData(readStreak());
    setIsLoading(false);
  }, []);

  const recordStudy = useCallback(() => {
    setStreakData(prev => {
      const today = getToday();
      if (prev.lastStudyDate === today) return prev; // 今天已学习

      let newStreak: number;
      if (prev.lastStudyDate === '') {
        // 首次学习
        newStreak = 1;
      } else {
        const diff = getDaysDiff(today, prev.lastStudyDate);
        if (diff === 1) {
          newStreak = prev.currentStreak + 1; // 连续
        } else {
          newStreak = 1; // 断了，重置
        }
      }

      const updated: StreakData = {
        currentStreak: newStreak,
        bestStreak: Math.max(prev.bestStreak, newStreak),
        lastStudyDate: today,
      };
      writeStreak(updated);
      return updated;
    });
  }, []);

  const studiedToday = streakData.lastStudyDate === getToday();

  return { streakData, studiedToday, recordStudy, isLoading };
}

/** 记录学习（非 hook 版本，供 ProgressContext 等非组件调用） */
export function recordStudyStandalone(): StreakData {
  const prev = readStreak();
  const today = getToday();
  if (prev.lastStudyDate === today) return prev;

  let newStreak: number;
  if (prev.lastStudyDate === '') {
    newStreak = 1;
  } else {
    const diff = getDaysDiff(today, prev.lastStudyDate);
    newStreak = diff === 1 ? prev.currentStreak + 1 : 1;
  }

  const updated: StreakData = {
    currentStreak: newStreak,
    bestStreak: Math.max(prev.bestStreak, newStreak),
    lastStudyDate: today,
  };
  writeStreak(updated);
  return updated;
}
