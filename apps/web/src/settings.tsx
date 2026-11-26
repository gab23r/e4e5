import { bucketsFor, gapCutoffFor, RATING_BUCKETS, type Speed } from '@e4e5/core';
import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Me } from './api';
import { fmt, t } from './i18n';

export type SpeedChoice = 'bullet' | 'blitz' | 'rapid' | 'both' | 'all';

export const SPEEDS: Record<SpeedChoice, Speed[]> = {
  bullet: ['bullet'],
  blitz: ['blitz'],
  rapid: ['rapid'],
  both: ['blitz', 'rapid'],
  all: ['blitz', 'rapid', 'classical'],
};

/** Lichess explorer rating range, as [lowest bucket, highest bucket] (e.g. [1600, 1800] = 1600-1999). */
export type RatingRange = [number, number];

/** Names of the speeds in the interface's language, e.g. for "blitz+rapid". */
export const SPEED_NAMES: Record<string, string> = t(
  { bullet: 'bullet', blitz: 'blitz', rapid: 'rapide', classical: 'classique', daily: 'par correspondance' },
  { bullet: 'bullet', blitz: 'blitz', rapid: 'rapid', classical: 'classical', daily: 'correspondence' },
);
export const SPEED_CHOICES: Record<SpeedChoice, string> = t(
  { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapide', both: 'Blitz + rapide', all: 'Blitz + rapide + classique' },
  { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', both: 'Blitz + rapid', all: 'Blitz + rapid + classical' },
);
export const speedsLabel = (speeds: string[]) => speeds.map((s) => SPEED_NAMES[s] ?? s).join(' + ');

interface Settings {
  speed: SpeedChoice;
  setSpeed: (s: SpeedChoice) => void;
  /** null: automatic, from the user's own rating. */
  range: RatingRange | null;
  setRange: (r: RatingRange | null) => void;
  /** New lines to learn per day, all repertoires together (NO_LIMIT: no limit). */
  newPerDay: number;
  setNewPerDay: (n: number) => void;
  /**
   * Depth of the lines: positions trained, and holes listed, from this share of the games at my
   * level (core LINE_DEPTHS; 0: whole lines).
   */
  lineDepth: number;
  setLineDepth: (n: number) => void;
  /** Gap finder: holes listed from this share of games (from `lineDepth`). */
  gapCutoff: number;
  /** Played games analysed: last `gamesDays` days (0: all), of these speeds. */
  gamesDays: number;
  setGamesDays: (n: number) => void;
  gamesSpeeds: string[];
  setGamesSpeeds: (s: string[]) => void;
  /** Where I have several moves in a position: only the main one (the first) is trained. */
  mainMoveOnly: boolean;
  setMainMoveOnly: (on: boolean) => void;
  /** Order of the new positions to learn: most played at my level first, or the repertoire's order. */
  learnOrder: LearnOrder;
  setLearnOrder: (o: LearnOrder) => void;
  /** Move sounds on the boards (read by components/sound.ts from the same localStorage key). */
  sound: boolean;
  setSound: (on: boolean) => void;
  /** Vibration on a wrong move, on phones (read by components/haptics.ts from the same localStorage key). */
  haptics: boolean;
  setHaptics: (on: boolean) => void;
  /** Review: seconds to answer a position already learnt (0: no timer). */
  answerSeconds: number;
  setAnswerSeconds: (n: number) => void;
  /** The opponent of "Se tester" chosen (its name), null: the one of my level (opponent.ts). */
  bot: string | null;
  setBot: (name: string | null) => void;
}

/** A depth of the lines (share of the games) as a percentage: "0,5 %" / "0.5%". */
export const depthPct = (x: number) => t(`${fmt(100 * x)} %`, `${fmt(100 * x)}%`);

export type LearnOrder = 'frequency' | 'repertoire';
/** "Sans limite" for the new lines per day. */
export const NO_LIMIT = 1000;

/** localStorage key of the move sounds setting (JSON boolean). */
export const SOUND_KEY = 'sound';
/** localStorage key of the vibration setting (JSON boolean). */
export const HAPTICS_KEY = 'haptics';

const Ctx = createContext<Settings | null>(null);

function stored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function persist(key: string, value: unknown) {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, JSON.stringify(value));
}

/** State kept in localStorage. */
function usePersisted<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => stored(key, fallback));
  return [
    value,
    (v: T) => {
      persist(key, v);
      setValue(v);
    },
  ];
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [speed, setSpeed] = usePersisted<SpeedChoice>('speed', 'both');
  const [range, setRange] = usePersisted<RatingRange | null>('ratingRange', null);
  const [newPerDay, setNewPerDay] = usePersisted('newLinesPerDayAll', 5);
  const [lineDepth, setLineDepth] = usePersisted('lineDepth', 0.01);
  const [gamesDays, setGamesDays] = usePersisted('gamesDays', 90);
  const [gamesSpeeds, setGamesSpeeds] = usePersisted<string[]>('gamesSpeeds', ['blitz', 'rapid', 'classical']);
  const [learnOrder, setLearnOrder] = usePersisted<LearnOrder>('learnOrder', 'frequency');
  const [mainMoveOnly, setMainMoveOnly] = usePersisted('mainMoveOnly', false);
  const [sound, setSound] = usePersisted(SOUND_KEY, true);
  const [haptics, setHaptics] = usePersisted(HAPTICS_KEY, true);
  const [answerSeconds, setAnswerSeconds] = usePersisted('answerSeconds', 15);
  const [bot, setBot] = usePersisted<string | null>('bot', null);
  return (
    <Ctx.Provider
      value={{ speed, setSpeed, range, setRange, newPerDay, setNewPerDay, lineDepth, setLineDepth, gapCutoff: gapCutoffFor(lineDepth), gamesDays, setGamesDays, gamesSpeeds, setGamesSpeeds, learnOrder, setLearnOrder, mainMoveOnly, setMainMoveOnly, sound, setSound, haptics, setHaptics, answerSeconds, setAnswerSeconds, bot, setBot }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useSettings(): Settings {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSettings outside SettingsProvider');
  return ctx;
}

function mean(xs: number[]): number | null {
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}

/**
 * The user's own rating for the chosen speed(s), used for the default explorer range:
 * Lichess if linked, else Chess.com as-is (the user adjusts the range), else 1500.
 */
export function ratingFor(me: Me, speed: SpeedChoice): { rating: number; source: 'Lichess' | 'Chess.com' | null } {
  const lichess = mean(
    SPEEDS[speed].map((s) => me.lichess?.perfs?.[s]).filter((p) => p && p.games > 0).map((p) => p!.rating),
  );
  if (lichess) return { rating: lichess, source: 'Lichess' };
  const ratings = me.chesscom?.ratings;
  const chesscom = mean(SPEEDS[speed].map((s) => (s === 'bullet' || s === 'blitz' || s === 'rapid' ? ratings?.[s] : undefined)).filter((r): r is number => !!r));
  if (chesscom) return { rating: chesscom, source: 'Chess.com' };
  return { rating: 1500, source: null };
}

/** Upper bound (inclusive) of a Lichess explorer bucket, or null for the top one. */
export function bucketTop(bucket: number): number | null {
  const next = RATING_BUCKETS.find((b) => b > bucket);
  return next === undefined ? null : next - 1;
}

/** "1600–1999", "2500+", "0–999". */
export function rangeLabel(buckets: number[]): string {
  const lo = Math.min(...buckets);
  const top = bucketTop(Math.max(...buckets));
  return top === null ? `${lo}+` : `${lo}–${top}`;
}

export function explorerParams(me: Me, speed: SpeedChoice, range: RatingRange | null) {
  const { rating, source } = ratingFor(me, speed);
  const ratings = range
    ? RATING_BUCKETS.filter((b) => b >= range[0] && b <= range[1])
    : bucketsFor(rating);
  return { rating, source, speeds: SPEEDS[speed], ratings, auto: range === null };
}

/** Local midnight (ms): new positions are counted per local day. */
export function dayStart(now = new Date()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
