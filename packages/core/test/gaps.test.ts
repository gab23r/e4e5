import { describe, expect, it } from 'vitest';
import { findGaps, keptPositions, trainingPositions, gapCandidate, obviousReply, gapOwner, rankRepertoires, repertoireTrunk, pgnToMoves, playUci, Repertoire, START_FEN, type ExplorerResponse, type PrepEnd } from '../src/index.js';

const rep = (color: 'white' | 'black', pgn: string) => new Repertoire(color, pgnToMoves(pgn).moves);

/** Position after a sequence of UCI moves. */
const after = (...ucis: string[]) => ucis.reduce((fen, u) => playUci(fen, u)!.toFen, START_FEN);

const stats = (moves: [uci: string, san: string, games: number][]): ExplorerResponse => {
  const total = moves.reduce((n, m) => n + m[2], 0);
  return {
    white: total,
    draws: 0,
    black: 0,
    moves: moves.map(([uci, san, games]) => ({ uci, san, white: games, draws: 0, black: 0 })),
  };
};

describe('gap finder', () => {
  it('bounds a prepared reply missing from the statistics, so the lines behind it are shortened', () => {
    const r = rep('white', '1. e4 e5 (1... a6 2. d4 b5 3. Bd3 Bb7 4. Nf3) 2. Nf3 *');
    const table = new Map([[after('e2e4'), stats([['e7e5', 'e5', 97], ['c7c5', 'c5', 3]])]]);
    const report = findGaps(r, (fen) => table.get(fen));
    expect(report.reached.get(after('e2e4', 'a7a6'))).toBe(0); // every move played is listed
    const kept = keptPositions(trainingPositions(r), (f) => report.reached.get(f), 0.01);
    expect(kept.has(after('e2e4', 'e7e5'))).toBe(true);
    expect(kept.has(after('e2e4', 'a7a6'))).toBe(false);
    expect(kept.has(after('e2e4', 'a7a6', 'd2d4', 'b7b5'))).toBe(false);
  });

  it('finds unprepared opponent moves, weighted by their frequency', () => {
    const r = rep('white', '1. e4 e5 (1... c5 2. Nf3) 2. Nf3 *');
    const table = new Map([[after('e2e4'), stats([['e7e5', 'e5', 50], ['c7c5', 'c5', 30], ['e7e6', 'e6', 20]])]]);
    const report = findGaps(r, (fen) => table.get(fen));
    expect(report.gaps).toHaveLength(1);
    expect(report.gaps[0]).toMatchObject({ kind: 'missing-reply', move: { san: 'e6' }, fen: after('e2e4') });
    expect(report.gaps[0]!.prob).toBeCloseTo(0.2);
    expect(report.gaps[0]!.path.map((m) => m.san)).toEqual(['e4']);
    expect(report.lost).toBeCloseTo(0.2);
    expect(report.depth).toBeCloseTo(0.8 * 3 + 0.2 * 1); // lines end at ply 3; 1... e6 leaves at ply 1
    expect(report.ends).toBeCloseTo(0.8); // both lines end after Nf3
  });

  it('reports positions without statistics, and positions where I have no answer', () => {
    const r = rep('black', '1. e4 e5 2. Nf3 *');
    const noStats = findGaps(r, (fen) => (fen === START_FEN ? stats([['e2e4', 'e4', 60], ['d2d4', 'd4', 40]]) : null));
    expect(noStats.missingStats.map((m) => m.fen)).toEqual([after('e2e4', 'e7e5')]);
    expect(noStats.missingStats[0]!.prob).toBeCloseTo(0.6);
    expect(noStats.unknown).toBeCloseTo(0.6);
    const table = new Map([
      [START_FEN, stats([['e2e4', 'e4', 60], ['d2d4', 'd4', 40]])],
      [after('e2e4', 'e7e5'), stats([['g1f3', 'Nf3', 1]])],
    ]);
    const report = findGaps(r, (fen) => table.get(fen));
    expect(report.missingStats).toEqual([]); // after 2. Nf3 it is my turn: no statistics needed
    const kinds = report.gaps.map((g) => [g.kind, g.move?.san ?? null, Math.round(g.prob * 100)]);
    expect(kinds).toEqual([
      ['no-answer', null, 60],
      ['missing-reply', 'd4', 40],
    ]);
    expect(report.lost).toBeCloseTo(1);
    expect(report.depth).toBeCloseTo(0.6 * 3); // 1. d4 leaves at ply 0, no answer to 2. Nf3 at ply 3

    const deeper = rep('black', '1. e4 e5 2. Nf3 Nc6 *');
    const ended = findGaps(deeper, (fen) => (fen === START_FEN ? stats([['e2e4', 'e4', 1]]) : table.get(fen)));
    expect(ended.missingStats).toEqual([]); // after 2... Nc6 the line ends: no statistics needed
    expect(ended.ends).toBeCloseTo(1);
    expect(ended.depth).toBeCloseTo(4);
    const unknown = findGaps(rep('white', '1. e4 e5 *'), () => null);
    expect(unknown.missingStats.map((m) => m.fen)).toEqual([after('e2e4')]);
    expect(unknown.unknown).toBeCloseTo(1);
    expect(unknown.depth).toBeCloseTo(1); // a lower bound
  });

  it('splits the probability between my prepared answers and merges transpositions', () => {
    // Two answers to 1. e4; 1... c5 2. Nf3 d6 and 1... d6 2. Nf3 c5 meet again.
    const r = rep('white', '1. e4 c5 (1... d6 2. Nf3 c5 3. d4) 2. Nf3 d6 (2... Nc6 3. d4) 3. d4 *');
    const afterE4 = after('e2e4');
    const afterSic = after('e2e4', 'c7c5', 'g1f3');
    const table = new Map([
      [afterE4, stats([['c7c5', 'c5', 50], ['d7d6', 'd6', 50]])],
      [afterSic, stats([['d7d6', 'd6', 50], ['b8c6', 'Nc6', 50]])],
      [after('e2e4', 'd7d6', 'g1f3'), stats([['c7c5', 'c5', 50], ['g8f6', 'Nf6', 50]])],
    ]);
    const report = findGaps(r, (fen) => table.get(fen));
    expect(report.gaps.map((g) => [g.move?.san, g.prob])).toEqual([['Nf6', 0.25]]);
    expect(report.depth).toBeCloseTo(0.75 * 5 + 0.25 * 3);
    // Every game ends its preparation exactly once.
    const ends: PrepEnd[] = [];
    findGaps(r, (fen) => table.get(fen), { onEnd: (e) => ends.push(e) });
    expect(ends.reduce((n, e) => n + e.prob, 0)).toBeCloseTo(1);
    expect(ends.reduce((n, e) => n + e.prob * e.ply, 0)).toBeCloseTo(report.depth);
    expect(ends.filter((e) => e.kind === 'hole').map((e) => e.path.map((m) => m.san).join(' '))).toEqual(['e4 d6 Nf3']);
    expect(report.reached.get(afterSic)).toBeCloseTo(0.5);
    // Without splitting between my answers: the probability if I play the line.
    const whole = findGaps(r, (fen) => table.get(fen), { split: false });
    expect(whole.reached.get(after('e2e4', 'c7c5'))).toBeCloseTo(0.5);
    expect(whole.reached.get(afterSic)).toBeCloseTo(0.5);
    // 1... c5 2. Nf3 d6 and 1... d6 2. Nf3 c5 meet again: 0.25 + 0.25.
    expect(whole.reached.get(after('e2e4', 'c7c5', 'g1f3', 'd7d6'))).toBeCloseTo(0.5);
    expect(whole.gaps.map((g) => [g.move?.san, g.prob])).toEqual([['Nf6', 0.25]]);

    // A move outside the repertoire that transposes into it is not a hole.
    const r2 = rep('white', '1. e4 c5 2. Nf3 d6 3. d4 *\n\n1. e4 d6 2. Nf3 c5 3. d4 *');
    const t2 = new Map([
      [afterE4, stats([['c7c5', 'c5', 1]])],
      [afterSic, stats([['d7d6', 'd6', 1]])],
    ]);
    expect(findGaps(r2, (fen) => t2.get(fen)).lost).toBeCloseTo(0);
  });

  it('ends the preparation at a paused move: prepared, nothing behind it explored', () => {
    const moves = pgnToMoves('1. e4 e5 (1... c5 2. Nf3) 2. Nf3 *').moves;
    const r = new Repertoire('white', moves.map((m) => (m.san === 'c5' ? { ...m, paused: true } : m)));
    const afterSic = after('e2e4', 'c7c5');
    const statsAsked: string[] = [];
    const table = new Map([
      [after('e2e4'), stats([['e7e5', 'e5', 50], ['c7c5', 'c5', 50]])],
      [after('e2e4', 'c7c5', 'g1f3'), stats([['d7d6', 'd6', 1]])],
    ]);
    const report = findGaps(r, (fen) => (statsAsked.push(fen), table.get(fen)));
    expect(report.gaps).toEqual([]); // 1... c5 is not a hole, and nothing after it is
    expect(report.lost).toBeCloseTo(0);
    expect(report.ends).toBeCloseTo(1);
    expect(report.reached.has(afterSic)).toBe(false);
    expect(statsAsked).toEqual([after('e2e4')]);
  });

  it('does not explore positions under the cutoff', () => {
    const r = rep('white', '1. e4 e5 (1... a6 2. d4) 2. Nf3 *');
    const statsAsked: string[] = [];
    const table = new Map([[after('e2e4'), stats([['e7e5', 'e5', 995], ['a7a6', 'a6', 5]])]]);
    const report = findGaps(r, (fen) => (statsAsked.push(fen), table.get(fen)), { cutoff: 0.01 });
    expect(statsAsked).toEqual([after('e2e4')]);
    expect(report.gaps).toEqual([]);
    expect(report.belowCutoff).toBeCloseTo(0.005);
    expect(report.depth).toBeCloseTo(0.995 * 3 + 0.005 * 2); // 1... a6 2. d4 not explored: ply 2 counted
    // Its probability is known all the same (a line stops there, it is not "unknown").
    expect(report.reached.get(after('e2e4', 'a7a6'))).toBeCloseTo(0.005);
  });
});

describe('gaps across several repertoires of the same colour', () => {
  const e4 = after('e2e4');
  const afterSic = after('e2e4', 'c7c5', 'g1f3');
  const afterOpen = after('e2e4', 'e7e5', 'g1f3');
  const table = new Map([
    [e4, stats([['e7e5', 'e5', 30], ['c7c5', 'c5', 50], ['e7e6', 'e6', 20]])],
    [afterSic, stats([['d7d6', 'd6', 40], ['b8c6', 'Nc6', 40], ['e7e6', 'e6', 20]])],
    [afterOpen, stats([['b8c6', 'Nc6', 50], ['d7d6', 'd6', 30], ['g8f6', 'Nf6', 20]])],
  ]);
  // Trunks: 1. e4 e5 2. Nf3, then a choice; 1. e4 c5 2. Nf3, then a choice.
  const open = rep('white', '1. e4 e5 2. Nf3 Nc6 (2... d6 3. d4) 3. Bb5 *');
  const sicilian = rep('white', '1. e4 c5 2. Nf3 d6 (2... Nc6 3. d4) 3. d4 *');
  const merged = new Repertoire('white', [...open.all(), ...sicilian.all()]);
  const candidates = [gapCandidate('open', open), gapCandidate('sicilian', sicilian)];

  it('does not report lines prepared in the other repertoire', () => {
    expect(findGaps(open, (f) => table.get(f)).gaps.map((g) => g.move?.san)).toEqual(['c5', 'e6', 'Nf6']);
    const report = findGaps(merged, (f) => table.get(f));
    expect(report.gaps.map((g) => [g.move?.san, g.prob])).toEqual([['e6', 0.2], ['e6', 0.1], ['Nf6', 0.06]]);
  });

  it('gives holes past a trunk to that repertoire, and deviations inside every trunk to none', () => {
    expect(repertoireTrunk(open).length).toBe(3);
    expect(repertoireTrunk(open).end).toBe(afterOpen);
    const report = findGaps(merged, (f) => table.get(f));
    const owners = report.gaps.map((g) => [lineText(g), gapOwner(g, candidates) ?? null]);
    expect(owners).toEqual([
      ['e4 e6', null], // inside both trunks: a French repertoire of its own
      ['e4 c5 Nf3 e6', 'sicilian'],
      ['e4 e5 Nf3 Nf6', 'open'],
    ]);
    // Every repertoire is ranked: owners first, then by how far they follow the line.
    expect(rankRepertoires(report.gaps[1]!, candidates)).toEqual([
      { key: 'sicilian', owns: true },
      { key: 'open', owns: false },
    ]);
    // Following a repertoire only along its trunk is not enough to belong to it.
    const philidor = gapCandidate('philidor', rep('white', '1. e4 e5 (1... d6 2. d4) 2. Nf3 *'));
    const caroLine = { fen: after('e2e4', 'c7c6', 'd2d4', 'd7d5'), path: rep('white', '1. e4 c6 2. d4 d5 *').movesAt(START_FEN) };
    expect(rankRepertoires(caroLine, [philidor])).toEqual([{ key: 'philidor', owns: false }]);
    // A single repertoire: deviations inside its trunk are still not its holes.
    expect(gapOwner(report.gaps[0]!, [gapCandidate('open', open)])).toBeUndefined();
  });
});

const lineText = (g: { path: { san: string }[]; move?: { san: string } }) => [...g.path.map((m) => m.san), g.move?.san].join(' ');

describe('obvious replies (missing moves not worth preparing)', () => {
  /** A position where I play Black: [uci, games, white wins, draws, black wins] per move. */
  const at = (moves: [string, number, number, number][]): ExplorerResponse => {
    const list = moves.map(([uci, w, d, b]) => ({ uci, san: uci, white: w, draws: d, black: b }));
    const sum = (k: 'white' | 'draws' | 'black') => list.reduce((n, m) => n + m[k], 0);
    return { white: sum('white'), draws: sum('draws'), black: sum('black'), moves: list };
  };

  it('is easy when the most played move scores about as well as the best one played often', () => {
    // The recapture, played most, scores 50% for Black; the other moves are not better.
    expect(obviousReply(at([['d8d5', 40, 20, 40], ['g8f6', 15, 5, 10]]), 'black')).toBe('easy');
  });

  it('is a real missing move when the popular reply scores clearly worse than another one', () => {
    // Popular: 35% for Black; the less played one: 60%.
    expect(obviousReply(at([['a7a6', 60, 10, 30], ['c7c5', 15, 10, 25]]), 'black')).toBeNull();
  });

  it('is not worth preparing when I already win most games there', () => {
    expect(obviousReply(at([['a7a6', 10, 10, 60], ['h7h6', 5, 5, 30]]), 'black')).toBe('winning');
    // The same position seen from White: not won (the only move played is still the easy one).
    expect(obviousReply(at([['a7a6', 10, 10, 60]]), 'white')).toBe('easy');
  });

  it('is easy when the popular move does not lose points, even if a rarer one scores better', () => {
    // Most played: 50% for Black (the position: 52%); the less played one: 60%.
    expect(obviousReply(at([['e5d4', 120, 40, 120], ['f8c5', 25, 10, 40]]), 'black')).toBe('easy');
  });

  it('is a real missing move when nearly everyone plays a much worse move (a trap)', () => {
    // 90% of the games: 30% for Black; the rare good move: 75%.
    expect(obviousReply(at([['d8c3', 120, 20, 40], ['e7e6', 5, 5, 20]]), 'black')).toBeNull();
  });

  it('cannot judge without enough games', () => {
    expect(obviousReply(at([['d8d5', 5, 3, 7]]), 'black')).toBeNull();
    expect(obviousReply(undefined, 'black')).toBeNull();
  });
});
