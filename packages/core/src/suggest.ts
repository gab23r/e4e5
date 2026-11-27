/**
 * Suggested moves search on stored statistics (`bestMoves`).
 *
 * With a local statistics file (`local`: the server's game database), every position is read at once: one search at
 * the smallest threshold (`REACH_STEPS`), wide and deep (`LOCAL_SEARCH`). A position absent from
 * the file is too rare to matter (fewer games than its threshold, all levels together, or past
 * its last ply): the line ends there, nothing is fetched. Both turns search the same way, so an
 * opponent's move scores exactly the best move shown after it.
 *
 * Without it, on the stored rows only (nothing is fetched any more): step by step with a smaller
 * threshold each time, the ranking returned is the one at the smallest threshold whose positions
 * are all known, so the candidates are compared on the same lines. From the 12% step on, only
 * the best `KEEP_DEEP` moves of the step before are looked at deeper; the others keep their
 * score of that step. `missing` lists the positions of the next step (most reached first): fetch
 * them, search again. A search wanting more than `MAX_POSITIONS` positions stops at the step
 * before (nothing missing).
 */
import { bestMoves, type SuggestedMove } from './bestMoves.js';
import type { ExplorerResponse } from './explorer.js';
import { turnOf, type Color } from './position.js';

/**
 * Statistics already at hand for some positions (stored, or in the stats files), without asking
 * Lichess; positions without any are absent. `exact: false`: another range of ratings or speeds.
 */
export type StoredStats = (fens: string[]) => Promise<Map<string, { data: ExplorerResponse; exact: boolean }>>;

/**
 * Every position read at once from a local statistics file (the server's game database): null
 * when the position is absent from it (too rare, or past its last ply).
 */
export type LocalStats = (fen: string) => ExplorerResponse | null;

/** Probability thresholds of the steps (a position reached in fewer games is not explored). */
export const REACH_STEPS = [0.5, 0.25, 0.12, 0.06, 0.03];
/** Local search: my 8 most played moves at the start, 3 further on, lines up to 10 moves of mine. */
const LOCAL_SEARCH = { rootCandidates: 8, candidates: 3, maxDepth: 10 };
/** From the 12% step on, only this many of my first moves (best at the step before) go deeper. */
const KEEP_DEEP = 3;
/** Positions a search may need (Lichess allows one request at a time). */
const MAX_POSITIONS = 250;

export interface Suggestions {
  /** minReach: threshold of the lines its score looks at (null: the move's own win rate). */
  moves: (Omit<SuggestedMove, 'minReach'> & { minReach: number | null })[];
  /** Threshold reached (null: no step complete, the moves' own win rates). */
  reach: number | null;
  target: number;
  /** Positions of the next step without statistics. */
  missing: string[];
  /** Positions used with statistics of another range (exact ones not stored). */
  approximate: string[];
}

/**
 * `depth`: how many of the steps to go through (0: each move's own win rate; default: all).
 * `local`: a synchronous reader of a local statistics file (the server's game database), for the
 * wide and deep search; without it, step by step on `storedStats`.
 * `absentIsRare`: `storedStats` holds every position there is (the statistics files on the
 * device): one it does not have is too rare, the line ends there (as with `local`), instead of a
 * position to fetch that stops the search at the step before.
 */
export async function suggestMoves(
  storedStats: StoredStats,
  root: string,
  rootStats: { data: ExplorerResponse; exact: boolean },
  depth = REACH_STEPS.length,
  color: Color = turnOf(root),
  local?: LocalStats,
  absentIsRare = false,
): Promise<Suggestions> {
  const steps = REACH_STEPS.slice(0, depth);
  if (local) {
    // Every position read locally (null: absent from the file, the line ends there).
    const read = new Map<string, ExplorerResponse | null>([[root, rootStats.data]]);
    const statsAt = (f: string) => {
      if (!read.has(f)) read.set(f, local(f));
      return read.get(f);
    };
    const reach = steps.at(-1) ?? null;
    const { moves } = bestMoves(root, statsAt, { ...LOCAL_SEARCH, minReach: reach ?? 2, color });
    return {
      moves: moves.map((m) => ({ ...m, minReach: reach })),
      reach,
      target: steps.at(-1) ?? REACH_STEPS[0]!,
      missing: [],
      approximate: rootStats.exact ? [] : [root],
    };
  }
  // null: absent from the statistics (too rare, `absentIsRare`), the line ends there.
  const known = new Map<string, { data: ExplorerResponse; exact: boolean } | null>([[root, rootStats]]);
  // On the opponent's turn every likely move of its is searched (none pruned), each from the
  // position after it: more positions.
  const mine = turnOf(root) === color;
  const maxPositions = mine ? MAX_POSITIONS : 2 * MAX_POSITIONS;
  const statsAt = (f: string) => {
    const k = known.get(f);
    return k === undefined ? undefined : (k?.data ?? null);
  };
  const run = (minReach: number, only?: string[]) => bestMoves(root, statsAt, { minReach, only, color });

  // Each move's own win rate first (nothing explored), then each step in turn, loading the
  // stored positions it reaches (the deeper ones are only reached once their parents are known).
  let moves = run(2).moves;
  let reach: number | null = null;
  let missing: string[] = [];
  for (const [i, step] of steps.entries()) {
    const only = mine && i >= 2 ? moves.filter((m) => m.minReach === reach).slice(0, KEEP_DEEP).map((m) => m.uci) : undefined;
    let next = run(step, only);
    for (let pass = 0; pass < 16 && next.missing.length; pass++) {
      const found = await storedStats(next.missing.map((m) => m.fen));
      if (absentIsRare) {
        for (const m of next.missing) if (!found.has(m.fen)) known.set(m.fen, null);
      } else if (!found.size) break;
      for (const [f, s] of found) known.set(f, s);
      next = run(step, only);
    }
    if (next.missing.length) {
      if (known.size + next.missing.length <= maxPositions) missing = next.missing.map((m) => m.fen);
      break;
    }
    // Moves looked at deeper first (best first), then the pruned ones as ranked at their step.
    moves = [...next.moves, ...moves.filter((m) => !next.moves.some((n) => n.uci === m.uci))];
    reach = step;
  }
  return {
    // minReach over 1: the move's own win rate (nothing explored).
    moves: moves.map((m) => ({ ...m, minReach: m.minReach > 1 ? null : m.minReach })),
    reach,
    target: steps.at(-1) ?? REACH_STEPS[0]!,
    missing,
    approximate: [...known].filter(([, s]) => s && !s.exact).map(([f]) => f),
  };
}
