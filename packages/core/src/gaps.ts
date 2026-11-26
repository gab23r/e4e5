/**
 * Gap finder: how likely is each position of a repertoire to be reached in a real game, how
 * long games stay in the preparation, and which popular opponent moves are not prepared?
 *
 * Starting from the initial position (probability 1):
 * - opponent's turn: each move played in the explorer statistics carries its share of the
 *   games. Repertoire moves are followed; a move that transposes back into the repertoire is
 *   followed too; any other move is a hole.
 * - my turn: the probability is split equally between my prepared moves (I play one of them),
 *   so the total stays at 100%. With `split: false`, each of my moves carries it whole: the
 *   probability of a position if I play its line (what to train, which holes matter). No
 *   prepared move at all is a hole too ("no answer").
 *
 * Every game ends its preparation somewhere: an unprepared opponent move, the end of a line, a
 * position without statistics, or a position too rare to explore (under `cutoff`). The average
 * of these depths, weighted by probability, is the expected preparation depth. Positions under
 * the cutoff count with the depth reached so far, so a smaller cutoff is more exact. These
 * shares (depth, lost, ends, unknown, belowCutoff) only add up with `split` (the default).
 *
 * A paused move counts as prepared (not a hole), but the games going through it end their
 * preparation there, like at the end of a line: nothing behind it is explored (no holes there).
 *
 * Each position is explored once: the probabilities of its move orders are summed before going
 * on (linear in the size of the repertoire, however many transpositions).
 */
import { totalGames, type ExplorerResponse } from './explorer.js';
import { playUci, START_FEN } from './position.js';
import type { Repertoire, RepMove } from './repertoire.js';

export interface Gap {
  /** missing-reply: a popular opponent move is not prepared. no-answer: my turn, nothing prepared. */
  kind: 'missing-reply' | 'no-answer';
  /** Position where the gap is (before the opponent move, for missing-reply). */
  fen: string;
  /** The opponent move that is not prepared (missing-reply only). */
  move?: { uci: string; san: string };
  /** Probability of meeting this gap in a game (summed over the move orders reaching it). */
  prob: number;
  /** A line from the root to `fen` (the most likely one found). */
  path: RepMove[];
}

export interface GapReport {
  /** Gaps of probability `cutoff` or more, most likely first. */
  gaps: Gap[];
  /**
   * Expected number of plies (half-moves, counted from the initial position) played while the
   * game is still in the preparation. A lower bound when statistics are missing.
   */
  depth: number;
  /** Share of games that leave the preparation through a hole (at any depth). */
  lost: number;
  /** Share of games reaching the end of a prepared line (opponent to move, nothing more). */
  ends: number;
  /** Share of games reaching a position whose statistics are not known yet. */
  unknown: number;
  /** Share of games reaching positions too rare to explore (counted at the depth reached). */
  belowCutoff: number;
  /**
   * Probability of reaching each explored position, and of the positions just past them too rare
   * to explore (under `cutoff`). Positions behind missing statistics are not in it.
   */
  reached: Map<string, number>;
  /** Opponent positions explored without statistics, most likely first: fetch them, run again. */
  missingStats: { fen: string; prob: number }[];
  /** Opponent positions explored with statistics. */
  usedStats: string[];
  /** The node budget was hit (huge or cyclic repertoire): figures are partial. */
  truncated: boolean;
}

export interface GapOptions {
  /** Positions reached with a smaller probability are not explored. Default 1%. */
  cutoff?: number;
  /** Split the probability between my prepared moves (default), or give it whole to each. */
  split?: boolean;
  root?: string;
  /** Plies played before `root` (for the depth). */
  rootPly?: number;
  /** Safety budget of positions (each one is explored once, whatever the move orders reaching it). */
  maxNodes?: number;
  /** Called wherever the preparation of some games ends (see `PrepEnd`). */
  onEnd?: (end: PrepEnd) => void;
}

/** Where the preparation of a share of the games ends. */
export interface PrepEnd {
  kind: 'hole' | 'line-end' | 'no-stats' | 'too-rare';
  /** Position where it ends (before the unprepared move, for a hole). */
  fen: string;
  path: RepMove[];
  prob: number;
  /** Plies played in the preparation. */
  ply: number;
}

/** An edge of the exploration graph: a share of a position's games going on to another position. */
interface Edge {
  to: string;
  move: RepMove;
  /** Share of the position's probability carried (1 per move of mine without `split`). */
  share: number;
  /** A paused move: the games going through it end their preparation (not followed). */
  paused?: boolean;
}

/** What follows a position, independent of its probability (built once per position). */
type Node =
  | { kind: 'no-answer' | 'line-end' | 'no-stats'; stats: boolean; edges: Edge[] }
  | { kind: 'mine'; edges: Edge[] }
  | { kind: 'stats'; edges: Edge[]; holes: { move: { uci: string; san: string }; share: number }[]; rest: number };

export function findGaps(
  rep: Repertoire,
  statsAt: (fen: string) => ExplorerResponse | null | undefined,
  { cutoff = 0.01, split = true, root = START_FEN, rootPly = 0, maxNodes = 200_000, onEnd }: GapOptions = {},
): GapReport {
  // 1. The graph: every position reachable through the repertoire (and opponent moves
  // transposing back into it), each built once whatever the number of move orders reaching it.
  const build = (fen: string): Node => {
    const moves = rep.movesAt(fen);
    if (rep.isMyTurn(fen)) {
      if (!moves.length) return { kind: 'no-answer', stats: true, edges: [] };
      const share = split ? 1 / moves.length : 1;
      return { kind: 'mine', edges: moves.map((m) => ({ to: m.toFen, move: m, share, paused: !!m.paused })) };
    }
    if (!moves.length) return { kind: 'line-end', stats: true, edges: [] };
    const stats = statsAt(fen);
    const total = stats ? totalGames(stats) : 0;
    if (!stats || !total) return { kind: 'no-stats', stats: !!stats, edges: [] };
    const edges: Edge[] = [];
    const holes: { move: { uci: string; san: string }; share: number }[] = [];
    let seen = 0;
    for (const em of stats.moves) {
      const share = totalGames(em) / total;
      seen += share;
      const own = moves.find((m) => m.uci === em.uci);
      if (own) {
        edges.push({ to: own.toFen, move: own, share, paused: !!own.paused });
        continue;
      }
      const played = playUci(fen, em.uci);
      if (played && rep.movesAt(played.toFen).length) edges.push({ to: played.toFen, move: played, share }); // transposes back into the repertoire
      else holes.push({ move: { uci: em.uci, san: em.san }, share });
    }
    // Rare moves beyond the ones listed by the explorer: unprepared, too small to list.
    return { kind: 'stats', edges, holes, rest: Math.max(0, 1 - seen) };
  };

  const nodes = new Map<string, Node>();
  const order: string[] = []; // depth-first post-order
  let truncated = false;
  nodes.set(root, build(root));
  const stack: { fen: string; next: number }[] = [{ fen: root, next: 0 }];
  while (stack.length) {
    const top = stack[stack.length - 1]!;
    const edges = nodes.get(top.fen)!.edges;
    if (top.next < edges.length) {
      const edge = edges[top.next++]!;
      const to = edge.to;
      if (edge.paused || nodes.has(to)) continue;
      if (nodes.size >= maxNodes) {
        truncated = true;
        continue;
      }
      nodes.set(to, build(to));
      stack.push({ fen: to, next: 0 });
    } else {
      order.push(top.fen);
      stack.pop();
    }
  }
  // Reversed post-order: every position comes after all the positions leading to it, except
  // along a cycle (a move back to a position on the way: not followed).
  order.reverse();
  const index = new Map(order.map((fen, i) => [fen, i]));

  // 2. The probabilities, flowing in that order: each position gets the sum over its move orders.
  const prob = new Map<string, number>([[root, 1]]);
  /** Sum of probability × plies over the move orders reaching a position (expected depth). */
  const plyMass = new Map<string, number>([[root, rootPly]]);
  /** The most likely move into each position: its line (the most likely one). */
  const bestIn = new Map<string, { from: string; move: RepMove; q: number }>();
  const pathTo = (fen: string): RepMove[] => {
    const path: RepMove[] = [];
    for (let b = bestIn.get(fen); b; b = bestIn.get(b.from)) path.push(b.move);
    return path.reverse();
  };

  const gaps: Gap[] = [];
  const missing = new Map<string, number>();
  const used: string[] = [];
  const reached = new Map<string, number>();
  let lost = 0;
  let unknown = 0;
  let ends = 0;
  let belowCutoff = 0;
  let plies = 0;

  for (const fen of order) {
    const p = prob.get(fen);
    if (!p) continue; // only behind positions too rare to explore
    const mass = plyMass.get(fen)!;
    /** The preparation of a share (of p) of these games ends here. */
    const stop = (q: number, kind: PrepEnd['kind']) => {
      if (q <= 0) return;
      plies += (q * mass) / p;
      onEnd?.({ kind, fen, path: pathTo(fen), prob: q, ply: mass / p });
    };
    reached.set(fen, p);
    if (p < cutoff) {
      // Too rare: its probability is known (not explored further), so it is not "unknown".
      belowCutoff += p;
      stop(p, 'too-rare');
      continue;
    }
    const node = nodes.get(fen)!;
    const flow = (e: Edge, q: number) => {
      if (e.paused) {
        ends += q;
        stop(q, 'line-end');
        return;
      }
      const i = index.get(e.to);
      if (i === undefined || i <= index.get(fen)!) {
        // A cycle, or past the node budget: not followed.
        if (i === undefined) truncated = true;
        belowCutoff += q;
        plies += q * (mass / p + 1);
        onEnd?.({ kind: 'too-rare', fen: e.to, path: [...pathTo(fen), e.move], prob: q, ply: mass / p + 1 });
        return;
      }
      prob.set(e.to, (prob.get(e.to) ?? 0) + q);
      plyMass.set(e.to, (plyMass.get(e.to) ?? 0) + (q / p) * (mass + p));
      const best = bestIn.get(e.to);
      if (!best || q > best.q) bestIn.set(e.to, { from: fen, move: e.move, q });
    };
    switch (node.kind) {
      case 'no-answer':
        lost += p;
        stop(p, 'hole');
        gaps.push({ kind: 'no-answer', fen, prob: p, path: pathTo(fen) });
        break;
      case 'line-end':
        ends += p;
        stop(p, 'line-end');
        break;
      case 'no-stats':
        unknown += p;
        stop(p, 'no-stats');
        if (!node.stats) missing.set(fen, p);
        break;
      case 'mine':
        for (const e of node.edges) flow(e, p * e.share);
        break;
      case 'stats': {
        used.push(fen);
        for (const e of node.edges) flow(e, p * e.share);
        for (const h of node.holes) {
          const q = p * h.share;
          lost += q;
          stop(q, 'hole');
          if (q >= cutoff) gaps.push({ kind: 'missing-reply', fen, move: h.move, prob: q, path: pathTo(fen) });
        }
        lost += p * node.rest;
        stop(p * node.rest, 'hole');
        break;
      }
    }
  }

  return {
    gaps: gaps.sort((a, b) => b.prob - a.prob),
    depth: plies,
    lost,
    ends,
    unknown,
    belowCutoff,
    reached,
    missingStats: [...missing].map(([fen, prob]) => ({ fen, prob })).sort((a, b) => b.prob - a.prob),
    usedStats: used,
    truncated,
  };
}

/**
 * The trunk of a repertoire: the single line it follows from the initial position until its
 * first choice (several moves in a position). A Scotch repertoire's trunk is 1. e4 e5 2. Nf3
 * Nc6 3. d4. Deviations inside the trunk (1... c5) are other openings, not its holes.
 */
export function repertoireTrunk(rep: Repertoire, root: string = START_FEN): Trunk {
  const positions = new Set<string>();
  let fen = root;
  while (rep.movesAt(fen).length === 1 && !positions.has(fen)) {
    positions.add(fen);
    fen = rep.movesAt(fen)[0]!.toFen;
  }
  return { positions, length: positions.size, end: fen };
}

export interface Trunk {
  /** Positions before the first choice. */
  positions: Set<string>;
  /** Number of moves (plies) of the trunk. */
  length: number;
  /** Position of the first choice (or of the end of a repertoire without any choice). */
  end: string;
}

export interface GapCandidate<K> {
  key: K;
  rep: Repertoire;
  /** `rep.reachable()`, computed once per repertoire. */
  reach: Set<string>;
  /** The line before the repertoire's first choice (`repertoireTrunk`). */
  trunk: Trunk;
}

export function gapCandidate<K>(key: K, rep: Repertoire): GapCandidate<K> {
  return { key, rep, reach: rep.reachable(), trunk: repertoireTrunk(rep) };
}

/**
 * How well a repertoire matches a gap. `owns`: the gap's line gets past the repertoire's trunk
 * (a deviation inside a repertoire's trunk is another opening, not one of its holes). `score`:
 * the longest prepared part of the line; reaching the gap's position (by any move order) beats
 * stopping earlier, and having moves already prepared there wins.
 */
function matchGap<K>(gap: Pick<Gap, 'fen' | 'path'>, c: GapCandidate<K>): { owns: boolean; score: number } {
  if (c.reach.has(gap.fen) && !c.trunk.positions.has(gap.fen)) {
    return { owns: true, score: 2 * (gap.path.length + 1) + (c.rep.movesAt(gap.fen).length ? 1 : 0) };
  }
  let prefix = 0;
  while (prefix < gap.path.length && c.rep.has(gap.path[prefix]!.fromFen, gap.path[prefix]!.uci)) prefix++;
  // Owned only if the line follows the repertoire past its first choice (one of its own moves
  // there), not just along its trunk: a Philidor (1. e4 e5 / 1. e4 d6) does not own 1. e4 c6.
  return { owns: !c.trunk.positions.has(gap.fen) && prefix > c.trunk.length, score: 2 * prefix };
}

/**
 * Repertoires of the same colour ordered by how well they suit a gap: the ones it can belong to
 * first (see `matchGap`), then the others by the longest prepared part of its line. Ties keep the
 * given order.
 */
export function rankRepertoires<K>(gap: Pick<Gap, 'fen' | 'path'>, candidates: GapCandidate<K>[]): { key: K; owns: boolean }[] {
  return candidates
    .map((c, i) => ({ key: c.key, i, ...matchGap(gap, c) }))
    .sort((a, b) => Number(b.owns) - Number(a.owns) || b.score - a.score || a.i - b.i)
    .map(({ key, owns }) => ({ key, owns }));
}

/**
 * The repertoire a gap belongs to, when several repertoires of the same colour are analysed
 * together: the best ranked one that can own it (`rankRepertoires`), or undefined when the gap
 * is inside every repertoire's trunk.
 */
export function gapOwner<K>(gap: Pick<Gap, 'fen' | 'path'>, candidates: GapCandidate<K>[]): K | undefined {
  const best = rankRepertoires(gap, candidates)[0];
  return best?.owns ? best.key : undefined;
}

/**
 * When a missing move is not worth preparing, judged on the statistics of the position it leads
 * to (my turn, at my level):
 * - "winning": I already score `winning` or more there (nothing more to learn);
 * - "easy": the move played most often there does not lose points: it scores at most `tolerance`
 *   below the position (all the moves played), and at most `trap` below the best of the moves
 *   played often enough (`minAltGames` games and `minAltShare` of them; a trap is a position
 *   where nearly everyone plays a bad move). Players of my level find a good reply by themselves.
 * Null (a real missing move) otherwise, and when the position has fewer than `minGames` games.
 */
export interface ReplyCheck {
  minGames: number;
  minAltGames: number;
  minAltShare: number;
  tolerance: number;
  trap: number;
  winning: number;
}

export const REPLY_CHECK: ReplyCheck = { minGames: 20, minAltGames: 20, minAltShare: 0.05, tolerance: 0.05, trap: 0.15, winning: 0.7 };

export function obviousReply(stats: ExplorerResponse | null | undefined, me: 'white' | 'black', check: ReplyCheck = REPLY_CHECK): 'winning' | 'easy' | null {
  if (!stats) return null;
  const total = totalGames(stats);
  if (total < check.minGames) return null;
  const score = (x: { white: number; draws: number; black: number }) => ((me === 'white' ? x.white : x.black) + x.draws / 2) / totalGames(x);
  if (score(stats) >= check.winning) return 'winning';
  const played = stats.moves.filter((m) => totalGames(m) > 0);
  const top = played.reduce<(typeof played)[number] | undefined>((a, m) => (!a || totalGames(m) > totalGames(a) ? m : a), undefined);
  if (!top) return null;
  const often = played.filter((m) => totalGames(m) >= Math.max(check.minAltGames, check.minAltShare * total));
  const best = Math.max(score(top), ...often.map(score));
  return score(top) >= score(stats) - check.tolerance && score(top) >= best - check.trap ? 'easy' : null;
}
