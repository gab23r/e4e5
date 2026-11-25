/**
 * A repertoire is a graph of positions (keyed by fenKey) linked by moves. A graph rather than
 * a tree: transpositions merge into the same node automatically.
 *
 * Any position can have several moves, for either side (e.g. two prepared answers for me).
 */
import { START_FEN, turnOf, type Color } from './position.js';

export interface RepMove {
  fromFen: string;
  toFen: string;
  uci: string;
  san: string;
  comment?: string | null;
  nags?: number[] | null;
  isMain?: boolean | null;
  /** Left out of the training, with everything only reachable through it (still in the repertoire). */
  paused?: boolean;
}

/**
 * The graph the training uses: without the paused moves, so the positions only reachable through
 * one of them are not trained (a position also reached by another move order still is).
 * `mainOnly`: where I have several moves, only the main one (else the first) is kept, so my
 * alternatives and what only follows them are not trained either.
 */
export function trainingRepertoire(color: Color, moves: Iterable<RepMove>, { mainOnly = false }: { mainOnly?: boolean } = {}): Repertoire {
  const rep = new Repertoire(color, [...moves].filter((m) => !m.paused));
  if (!mainOnly) return rep;
  return new Repertoire(color, [...rep.all()].filter((m) => !rep.isMyTurn(m.fromFen) || rep.movesAt(m.fromFen)[0]!.uci === m.uci));
}

/**
 * The moves of several chapters as one graph (a repertoire), given in chapter order. A move in
 * several chapters comes once: trained unless paused in all of them, its comment and annotations
 * from the first chapter having some. One main move per position: the main move of the first
 * chapter with one there, else the first move.
 */
export function mergeChapterMoves<M extends RepMove>(moves: Iterable<M>): M[] {
  const byKey = new Map<string, M>();
  const mainOf = new Map<string, string>();
  for (const m of moves) {
    if (m.isMain && !mainOf.has(m.fromFen)) mainOf.set(m.fromFen, m.uci);
    const key = `${m.fromFen} ${m.uci}`;
    const have = byKey.get(key);
    if (!have) {
      byKey.set(key, { ...m });
      continue;
    }
    if (!m.paused) have.paused = false;
    if (!have.comment && m.comment) have.comment = m.comment;
    if (!have.nags?.length && m.nags?.length) have.nags = m.nags;
  }
  const merged = [...byKey.values()];
  for (const m of merged) if (!mainOf.has(m.fromFen)) mainOf.set(m.fromFen, m.uci);
  for (const m of merged) m.isMain = mainOf.get(m.fromFen) === m.uci;
  return merged;
}

export class Repertoire {
  readonly color: Color;
  private byFen = new Map<string, RepMove[]>();

  constructor(color: Color, moves: Iterable<RepMove> = []) {
    this.color = color;
    for (const m of moves) this.add(m);
  }

  /** Adds a move; false if the same move already exists from that position. */
  add(move: RepMove): boolean {
    const list = this.byFen.get(move.fromFen);
    if (!list) {
      this.byFen.set(move.fromFen, [move]);
      return true;
    }
    if (list.some((m) => m.uci === move.uci)) return false;
    list.push(move);
    return true;
  }

  has(fen: string, uci: string): boolean {
    return this.byFen.get(fen)?.some((m) => m.uci === uci) ?? false;
  }

  /** Moves from a position, main line first. */
  movesAt(fen: string): RepMove[] {
    const list = this.byFen.get(fen) ?? [];
    return [...list].sort((a, b) => Number(!!b.isMain) - Number(!!a.isMain));
  }

  isMyTurn(fen: string): boolean {
    return turnOf(fen) === this.color;
  }

  *all(): Iterable<RepMove> {
    for (const list of this.byFen.values()) yield* list;
  }

  get size(): number {
    let n = 0;
    for (const list of this.byFen.values()) n += list.length;
    return n;
  }

  /** Position keys reachable from `root` (the initial position by default). */
  reachable(root: string = START_FEN): Set<string> {
    const seen = new Set<string>([root]);
    const stack = [root];
    while (stack.length) {
      const fen = stack.pop()!;
      for (const m of this.byFen.get(fen) ?? []) {
        if (!seen.has(m.toFen)) {
          seen.add(m.toFen);
          stack.push(m.toFen);
        }
      }
    }
    return seen;
  }

  /** Moves that cannot be reached from the initial position (e.g. after deleting a parent). */
  unreachableMoves(root: string = START_FEN): RepMove[] {
    const reach = this.reachable(root);
    return [...this.all()].filter((m) => !reach.has(m.fromFen));
  }
}

/** The trunk of some moves: the line from `start` while there is one move only, then where it splits. */
export interface Thumbnail {
  /** Position at the end of the trunk. */
  fen: string;
  /** Its moves (SAN). */
  sans: string[];
  /** The moves from that position (UCI): the first moves of the variations. */
  branches: string[];
}

/** The trunk of `moves` from `start` (a thumbnail: the position, the variations as arrows). */
export function trunkOf(moves: Iterable<Pick<RepMove, 'fromFen' | 'toFen' | 'san' | 'uci'>>, start: string = START_FEN): Thumbnail {
  const from = new Map<string, Pick<RepMove, 'toFen' | 'san' | 'uci'>[]>();
  for (const m of moves) {
    const out = from.get(m.fromFen);
    if (!out) from.set(m.fromFen, [m]);
    else if (!out.some((o) => o.uci === m.uci)) out.push(m);
  }
  const sans: string[] = [];
  let fen = start;
  const seen = new Set([fen]);
  for (;;) {
    const out = from.get(fen);
    const only = out?.length === 1 ? out[0] : undefined;
    if (!only || seen.has(only.toFen)) break;
    sans.push(only.san);
    fen = only.toFen;
    seen.add(fen);
  }
  return { fen, sans, branches: (from.get(fen) ?? []).map((m) => m.uci) };
}
