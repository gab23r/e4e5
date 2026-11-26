/** Which positions of a repertoire are trained, and the line leading to each. */
import { START_FEN } from './position.js';
import { totalGames, type ExplorerResponse } from './explorer.js';
import type { Repertoire, RepMove } from './repertoire.js';

export interface TrainingPosition {
  /** Position where it is my turn and the repertoire has at least one move. */
  fen: string;
  /** Moves from the initial position to `fen` (main lines preferred). */
  path: RepMove[];
}

/**
 * Every position to train, in learning order: depth-first along the repertoire, main line
 * first, so new positions are learnt line by line. A position reached by several move orders
 * appears once, with the first line found.
 */
export function trainingPositions(rep: Repertoire): TrainingPosition[] {
  const out: TrainingPosition[] = [];
  const seen = new Set<string>([START_FEN]);
  const stack: { fen: string; path: RepMove[] }[] = [{ fen: START_FEN, path: [] }];
  while (stack.length) {
    const { fen, path } = stack.pop()!;
    const moves = rep.movesAt(fen); // main line first
    if (moves.length && rep.isMyTurn(fen)) out.push({ fen, path });
    // Push in reverse so the main line is explored first.
    for (const m of [...moves].reverse()) {
      if (seen.has(m.toFen)) continue;
      seen.add(m.toFen);
      stack.push({ fen: m.toFen, path: [...path, m] });
    }
  }
  return out;
}

/** Training positions in the part of the repertoire reachable from `root`. */
export function trainingPositionsFrom(rep: Repertoire, root: string): TrainingPosition[] {
  if (root === START_FEN) return trainingPositions(rep);
  const reach = rep.reachable(root);
  return trainingPositions(rep).filter((p) => reach.has(p.fen));
}

/**
 * How the opponent's replies are drawn in "Se tester": the real frequency first, smoothed so the
 * less played lines come up too, and more often when the positions behind are hard for me.
 * - `FREQUENCY_POWER`: weight ∝ games^power (1/2: 90 % / 10 % becomes 75 % / 25 %, 97 % / 3 %
 *   becomes 85 % / 15 %; the order of the real games is kept);
 * - `DIFFICULTY_BONUS`: × (1 + bonus · log2(1 + d)), d the expected number of my mistakes
 *   behind the reply (the sum, over the positions learnt behind it, of the chance of missing
 *   it today): well known positions add almost nothing, however many (d = 0.2: × 1.13), shaky
 *   ones raise it (d = 1: × 1.5, 3: × 2, 7: × 2.5) without outweighing how often the line
 *   really comes up. A long line counts only through its hard positions.
 */
export const FREQUENCY_POWER = 0.5;
export const DIFFICULTY_BONUS = 0.5;

export interface ReplyWeighting {
  /** Expected number of my mistakes behind a reply (its difficulty); none: not counted. */
  difficulty?: (reply: RepMove) => number;
  /** Weight ∝ games^power (default FREQUENCY_POWER, smoothed; 1: the real frequency). */
  power?: number;
}

/**
 * Weight of each repertoire reply of the opponent: its number of games in the explorer
 * statistics, smoothed (`FREQUENCY_POWER`) and raised for the replies with hard positions behind
 * them (`DIFFICULTY_BONUS`). Replies missing from the statistics count 2% of the known games
 * (before smoothing), so they are played sometimes. Without statistics: main line 2, others 1.
 */
export function replyWeights(replies: RepMove[], stats: ExplorerResponse | null | undefined, { difficulty, power = FREQUENCY_POWER }: ReplyWeighting = {}): number[] {
  const games = new Map((stats?.moves ?? []).map((m) => [m.uci, totalGames(m)]));
  const known = replies.map((m) => games.get(m.uci) ?? 0);
  const sum = known.reduce((a, b) => a + b, 0);
  const floor = Math.max(1, 0.02 * sum);
  const base = sum === 0 ? replies.map((m) => (m.isMain ? 2 : 1)) : known.map((g) => (g > 0 ? g : floor) ** power);
  return base.map((w, i) => w * (difficulty ? 1 + DIFFICULTY_BONUS * Math.log2(1 + Math.max(0, difficulty(replies[i]!))) : 1));
}

/** Picks an opponent reply at random, weighted by `replyWeights`. */
export function chooseReply(
  replies: RepMove[],
  stats: ExplorerResponse | null | undefined,
  random: () => number = Math.random,
  weighting: ReplyWeighting = {},
): RepMove | undefined {
  if (!replies.length) return undefined;
  const weights = replyWeights(replies, stats, weighting);
  let r = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < replies.length; i++) {
    r -= weights[i]!;
    if (r < 0) return replies[i];
  }
  return replies.at(-1);
}

/** Shortest line from the initial position to `fen` in the repertoire (main lines preferred). */
export function pathTo(rep: Repertoire, fen: string, root: string = START_FEN): RepMove[] | null {
  if (fen === root) return [];
  const seen = new Set<string>([root]);
  let frontier: { fen: string; path: RepMove[] }[] = [{ fen: root, path: [] }];
  while (frontier.length) {
    const next: typeof frontier = [];
    for (const node of frontier) {
      for (const m of rep.movesAt(node.fen)) {
        if (seen.has(m.toFen)) continue;
        const path = [...node.path, m];
        if (m.toFen === fen) return path;
        seen.add(m.toFen);
        next.push({ fen: m.toFen, path });
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * The positions that start a line, among `items` (in learning order: a position after the one
 * leading to it). A position continues the line of its previous position of mine (two plies
 * earlier) when that one is in the set and has no continuation yet; otherwise it starts a line
 * (a second branch from the same position is another line).
 */
export function lineStarts<T extends { fen: string; path: RepMove[] }>(items: T[], inSet: (fen: string) => boolean): T[] {
  const continued = new Set<string>();
  return items.filter((p) => {
    const prev = p.path.length >= 2 ? p.path.at(-2)!.fromFen : null;
    if (prev && inSet(prev) && !continued.has(prev)) {
      continued.add(prev);
      return false;
    }
    return true;
  });
}

/**
 * Positions grouped into whole lines, `ordered` in learning order (a position after the one
 * leading to it): a position continues the line of its previous position of mine (two plies
 * earlier) when that one is in a line without continuation yet; otherwise it starts a line.
 */
export function groupLines<T extends { fen: string; path: RepMove[] }>(ordered: T[]): T[][] {
  const lines: T[][] = [];
  const lineOf = new Map<string, T[]>();
  const continued = new Set<string>();
  for (const p of ordered) {
    const prev = p.path.length >= 2 ? p.path.at(-2)!.fromFen : null;
    let line = prev && !continued.has(prev) ? lineOf.get(prev) : undefined;
    if (line) continued.add(prev!);
    else lines.push((line = []));
    line.push(p);
    lineOf.set(p.fen, line);
  }
  return lines;
}

/** The first `lines` whole lines of `ordered` (see groupLines), flattened. */
export function pickNewLines<T extends { fen: string; path: RepMove[] }>(ordered: T[], lines: number): { chosen: T[]; lines: number } {
  const picked = groupLines(ordered).slice(0, lines);
  return { chosen: picked.flat(), lines: picked.length };
}

/** Review state of one of my moves (a move card), as far as the scheduling needs it. */
export interface MoveCardTimes {
  /** Next review (ms). */
  due: number;
  /** First learnt (ms). */
  createdAt: number;
  /** Estimated probability (0-1) of finding the move now (FSRS retrievability), when known. */
  recall?: number;
}

/**
 * What a position to train needs, from the cards of my moves there (`moves`: my repertoire
 * moves in the position). Due when one of them is due (the earliest: `at`), else new when one
 * has no card yet, else learnt (`at`: next review). `pending`: the moves to ask (the due ones,
 * or the new ones). `learntAt`: when a move of the position was last learnt (null: none yet).
 */
export function positionReview(
  moves: RepMove[],
  cardOf: (uci: string) => MoveCardTimes | undefined,
  now: number,
): { status: 'due' | 'new' | 'learnt'; at: number; pending: RepMove[]; learntAt: number | null } {
  const cards = moves.map((m) => ({ m, c: cardOf(m.uci) }));
  const known = cards.filter((x): x is { m: RepMove; c: MoveCardTimes } => !!x.c);
  const at = Math.min(...known.map((x) => x.c.due));
  const learntAt = known.length ? Math.max(...known.map((x) => x.c.createdAt)) : null;
  const due = known.filter((x) => x.c.due <= now).map((x) => x.m);
  if (due.length) return { status: 'due', at, pending: due, learntAt };
  const fresh = cards.filter((x) => !x.c).map((x) => x.m);
  if (fresh.length) return { status: 'new', at: Infinity, pending: fresh, learntAt };
  return { status: 'learnt', at, pending: [], learntAt };
}

/**
 * Depth of the lines (Paramètres): a position is trained, and a hole listed, when it comes up in
 * at least this share of the games at the user's level. 0: whole lines.
 */
export const LINE_DEPTHS = [0.05, 0.01, 0.005, 0.002, 0.001, 0.0005] as const;
/** Holes listed from this share of the games with whole lines (no depth to follow). */
export const WHOLE_LINES_GAP_CUTOFF = 0.01;
/** Share of the games from which holes are listed, for a depth of the lines. */
export const gapCutoffFor = (depth: number) => (depth > 0 ? depth : WHOLE_LINES_GAP_CUTOFF);

/**
 * The positions trained when lines stop at `minReach`: a position is kept when it comes up in at
 * least `minReach` of the games (`reach`: probability of reaching it at the user's level), and
 * the previous position of mine on its line is kept too (a line stops at its first position left
 * out). Unknown probability (statistics missing on the way): the one of the deepest position of
 * its line that is known, an upper bound, so the line goes on until its statistics come.
 * minReach <= 0: every position.
 */
export function keptPositions(
  positions: TrainingPosition[],
  reach: (fen: string) => number | undefined,
  minReach: number,
): Set<string> {
  if (minReach <= 0) return new Set(positions.map((p) => p.fen));
  const bound = (p: TrainingPosition) => {
    for (const fen of [p.fen, ...p.path.map((m) => m.fromFen).reverse()]) {
      const r = reach(fen);
      if (r !== undefined) return r;
    }
    return 1; // nothing known on the line (no statistics at all yet)
  };
  const isPosition = new Set(positions.map((p) => p.fen));
  const kept = new Set<string>();
  for (const p of [...positions].sort((a, b) => a.path.length - b.path.length)) {
    const prev = p.path.length >= 2 ? p.path.at(-2)!.fromFen : null;
    if (bound(p) >= minReach && (!prev || !isPosition.has(prev) || kept.has(prev))) kept.add(p.fen);
  }
  return kept;
}
