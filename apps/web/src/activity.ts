/**
 * My training activity: my answers over the last weeks (the grid of the home page) and my series
 * of days in a row (the 🔥 of the app bar on the home page). One query, shared.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from './api';

export const WEEKS = 12;
export const DAY = 86_400_000;

/** Midnight (local) of the day of `ms`. */
export const dayOf = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** My answers since the Monday WEEKS weeks ago (the grid's first column), and that Monday. */
export function useAnswers(enabled = true) {
  const since = useMemo(() => {
    const today = dayOf(Date.now());
    const monday = today - ((new Date(today).getDay() + 6) % 7) * DAY;
    return monday - (WEEKS - 1) * 7 * DAY;
  }, []);
  const answers = useQuery({ queryKey: ['answers-since', since], queryFn: () => api.answersSince(since), staleTime: 0, enabled });
  return { since, answers };
}

/**
 * Days in a row with at least one answer, up to today (or yesterday: today's training not done
 * yet keeps the series).
 */
export function streakOf(answers: { at: number }[] | undefined): number {
  const days = new Set((answers ?? []).map((a) => dayOf(a.at)));
  const today = dayOf(Date.now());
  let streak = 0;
  for (let d = days.has(today) ? today : today - DAY; days.has(d); d -= DAY) streak++;
  return streak;
}
