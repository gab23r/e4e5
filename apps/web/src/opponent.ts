/**
 * The opponent of "Se tester", as a fictional player: a name, an Elo and the rating buckets of the
 * statistics it plays from (the most frequent moves there). By default the player of my level
 * (the level of the opening statistics, Paramètres); else the one chosen (settings `bot`).
 */
import { RATING_BUCKETS } from '@e4e5/core';
import type { Me } from './api';
import { bucketTop, explorerParams, useSettings } from './settings';

/** The players, weakest first: the rating buckets of the statistics they play from, their Elo shown. */
export const BOTS = [
  { name: 'Basile', buckets: [0, 1000], elo: 900 },
  { name: 'Hugo', buckets: [1200], elo: 1300 },
  { name: 'Maxime', buckets: [1400], elo: 1500 },
  { name: 'Victor', buckets: [1600], elo: 1700 },
  { name: 'Camille', buckets: [1800], elo: 1900 },
  { name: 'Simone', buckets: [2000], elo: 2100 },
  { name: 'Ivan', buckets: [2200], elo: 2350 },
  { name: 'Turing', buckets: [2500], elo: 2600 },
] as const;

export interface Opponent {
  name: string;
  elo: number;
  /** Rating buckets of the statistics it plays from. */
  ratings: number[];
  /** Chosen by the user (else: the player of my level). */
  chosen: boolean;
}

/** The opponent chosen, else the one at the level of the statistics (my rating, or the middle of the range chosen). */
export function useOpponent(me: Me): Opponent {
  const { speed, range, bot } = useSettings();
  const picked = BOTS.find((b) => b.name === bot);
  if (picked) return { name: picked.name, elo: picked.elo, ratings: [...picked.buckets], chosen: true };
  const ex = explorerParams(me, speed, range);
  let elo = ex.rating;
  if (!ex.auto) {
    const lo = Math.min(...ex.ratings);
    const hi = bucketTop(Math.max(...ex.ratings)) ?? Math.max(...ex.ratings) + 300;
    elo = (Math.max(lo, 600) + hi) / 2;
  }
  elo = Math.round(elo / 50) * 50;
  const bucket = [...RATING_BUCKETS].reverse().find((b) => elo >= b) ?? 0;
  const name = BOTS.find((b) => (b.buckets as readonly number[]).includes(bucket))?.name ?? BOTS[0].name;
  return { name, elo, ratings: ex.ratings, chosen: false };
}
