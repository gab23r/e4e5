/**
 * The opponent of "Se tester", as a fictional player: a name and an Elo at the level of the
 * opening statistics (Paramètres), since the moves it plays are the most frequent ones there.
 */
import { RATING_BUCKETS } from '@e4e5/core';
import type { Me } from './api';
import { bucketTop, explorerParams, useSettings } from './settings';

/** One name per rating bucket of the statistics (RATING_BUCKETS), weakest first. */
const NAMES = ['Basile', 'Lucie', 'Hugo', 'Camille', 'Victor', 'Inès', 'Maxime', 'Sofia', 'Ivan'] as const;

export interface Opponent {
  name: string;
  elo: number;
}

/** The opponent at the level of the statistics: the user's rating, or the middle of the range chosen. */
export function useOpponent(me: Me): Opponent {
  const { speed, range } = useSettings();
  const ex = explorerParams(me, speed, range);
  let elo = ex.rating;
  if (!ex.auto) {
    const lo = Math.min(...ex.ratings);
    const hi = bucketTop(Math.max(...ex.ratings)) ?? Math.max(...ex.ratings) + 300;
    elo = (Math.max(lo, 600) + hi) / 2;
  }
  elo = Math.round(elo / 50) * 50;
  const bucket = [...RATING_BUCKETS].reverse().findIndex((b) => elo >= b);
  return { name: NAMES[RATING_BUCKETS.length - 1 - bucket] ?? NAMES[0], elo };
}
