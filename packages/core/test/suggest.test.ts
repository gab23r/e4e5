import { describe, expect, it } from 'vitest';
import { playUci, START_FEN, suggestMoves, type ExplorerResponse } from '../src/index.js';

const after = (...ucis: string[]) => ucis.reduce((fen, u) => playUci(fen, u)!.toFen, START_FEN);
/** Explorer answer from [uci, san, white wins, draws, black wins]. */
const stats = (moves: [string, string, number, number, number][]): ExplorerResponse => ({
  white: moves.reduce((n, m) => n + m[2], 0),
  draws: moves.reduce((n, m) => n + m[3], 0),
  black: moves.reduce((n, m) => n + m[4], 0),
  moves: moves.map(([uci, san, white, draws, black]) => ({ uci, san, white, draws, black })),
});

describe('suggested moves on stored statistics', () => {
  // Black, White to move: 1. e4 is scored with Black's best answer. After 1. e4 c5 the line goes
  // on; 1. e4 e5 is absent from the statistics (too rare in the file).
  const table = new Map<string, ExplorerResponse>([
    [START_FEN, stats([['e2e4', 'e4', 300, 0, 300]])],
    [after('e2e4'), stats([['c7c5', 'c5', 300, 0, 700], ['e7e5', 'e5', 500, 0, 500]])],
    [after('e2e4', 'c7c5'), stats([['g1f3', 'Nf3', 300, 0, 700]])],
  ]);
  const stored = async (fens: string[]) =>
    new Map(fens.flatMap((f) => (table.has(f) ? [[f, { data: table.get(f)!, exact: true }] as const] : [])));

  it('stops at the step before when a position is missing (statistics still to fetch)', async () => {
    const r = await suggestMoves(stored, START_FEN, { data: table.get(START_FEN)!, exact: true }, 5, 'black');
    expect(r.reach).toBeNull();
    expect(r.missing).toContain(after('e2e4', 'e7e5'));
  });

  it('with absentIsRare (the statistics files on the device), ends the line there and searches on', async () => {
    const r = await suggestMoves(stored, START_FEN, { data: table.get(START_FEN)!, exact: true }, 5, 'black', undefined, true);
    expect(r.reach).toBe(0.03);
    expect(r.missing).toEqual([]);
    // 1. e4 scored with my best answer (1… c5, about 70 % for Black), not 1. e4's own 50 %.
    const e4 = r.moves.find((m) => m.uci === 'e2e4')!;
    expect(e4.line.map((m) => m.san).slice(0, 2)).toEqual(['e4', 'c5']);
    expect(e4.score).toBeGreaterThan(0.6);
    expect(e4.direct).toBeCloseTo(0.5);
  });
});
