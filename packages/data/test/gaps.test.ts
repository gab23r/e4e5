import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { playUci, START_FEN, type ExplorerResponse } from '@e4e5/core';
import { createChapter, createRepertoire, gapsAnalysis, saveLine, type Db } from '../src/index.js';
import * as schema from '../src/schema.js';
import { users } from '../src/schema.js';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));
const after = (...ucis: string[]) => ucis.reduce((fen, u) => playUci(fen, u)!.toFen, START_FEN);
/** Statistics: [uci, white wins, draws, black wins] per move. */
const stats = (moves: [string, number, number, number][]): ExplorerResponse => {
  const list = moves.map(([uci, w, d, b]) => ({ uci, san: playUci(START_FEN, uci)?.san ?? uci, white: w, draws: d, black: b }));
  const sum = (k: 'white' | 'draws' | 'black') => list.reduce((n, m) => n + m[k], 0);
  return { white: sum('white'), draws: sum('draws'), black: sum('black'), moves: list };
};

let db: Db;
beforeEach(async () => {
  const client = createClient({ url: ':memory:' });
  const d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: MIGRATIONS });
  await d.insert(users).values({ id: 'u1', username: 'u1' });
  db = d;
});

describe('gap finder report', () => {
  it('leaves out the missing moves whose reply is obvious at my level, and counts them', async () => {
    const rep = await createRepertoire(db, 'u1', { name: '1.e4', color: 'white' });
    const chapter = await createChapter(db, 'u1', rep.id, { name: '1.e4' });
    await saveLine(db, 'u1', chapter.id, ['e2e4', 'e7e5', 'g1f3']);
    // A choice at the first move: its trunk is empty, the holes after 1. e4 belong to it.
    await saveLine(db, 'u1', chapter.id, ['d2d4', 'd7d5']);
    // After 1. e4: e5 (prepared), c6 and d5 (not prepared), each often enough to be listed.
    const table = new Map<string, ExplorerResponse>([
      // ...and g6, whose position after it has no statistics (too rare at my level): not listed.
      [after('e2e4'), stats([['e7e5', 300, 100, 300], ['c7c6', 100, 50, 100], ['d7d5', 100, 50, 100], ['g7g6', 100, 50, 100]])],
      // After 1. e4 d5: the recapture exd5 is played most and scores best (obvious).
      [after('e2e4', 'd7d5'), stats([['e4d5', 60, 20, 20], ['b1c3', 5, 5, 10]])],
      // After 1. e4 c6: the most played move (Nc3) scores far worse than d4 (a real missing move).
      [after('e2e4', 'c7c6'), stats([['b1c3', 20, 10, 50], ['d2d4', 40, 10, 10]])],
    ]);
    const storedStats = async (fens: string[]) =>
      new Map(fens.flatMap((f) => (table.has(f) ? [[f, { data: table.get(f)!, exact: true }] as const] : [])));
    const report = await gapsAnalysis(db, 'u1', { speeds: ['blitz'], ratings: [1600], cutoff: 0.01 }, storedStats);
    expect(report.white!.gaps.map((g) => g.move?.uci)).toEqual(['c7c6']);
    expect(report.white!.obvious).toEqual({ [rep.id]: 2 });
  });

  it('gives a missing move inside the trunk of a one-line repertoire to it, the only one reaching it', async () => {
    const rep = await createRepertoire(db, 'u1', { name: '1.e4', color: 'white' });
    const chapter = await createChapter(db, 'u1', rep.id, { name: '1.e4' });
    await saveLine(db, 'u1', chapter.id, ['e2e4', 'e7e5', 'g1f3']);
    const table = new Map<string, ExplorerResponse>([
      [after('e2e4'), stats([['e7e5', 300, 100, 300], ['c7c6', 100, 50, 100]])],
      // After 1. e4 c6: the popular move loses points (a real missing move).
      [after('e2e4', 'c7c6'), stats([['b1c3', 20, 10, 50], ['d2d4', 40, 10, 10]])],
    ]);
    const storedStats = async (fens: string[]) =>
      new Map(fens.flatMap((f) => (table.has(f) ? [[f, { data: table.get(f)!, exact: true }] as const] : [])));
    const report = await gapsAnalysis(db, 'u1', { speeds: ['blitz'], ratings: [1600], cutoff: 0.01 }, storedStats);
    expect(report.white!.gaps.map((g) => [g.move?.uci, g.repertoireId])).toEqual([['c7c6', rep.id]]);
  });

  it('gives the line inside the repertoire when the most played way to the missing move transposes', async () => {
    // Black: chapter A 1. d4 d5 2. Nf3 Nf6 3. c4 e6; chapter B 1. d4 d5 2. e3 Nf6 3. Nf3 e6 4. Bd3 b6 5. c4 c5.
    // 2. Nf3 Nf6 3. e3 is not in the repertoire but transposes into chapter B (and is played more
    // than 2. e3): the most played way to the missing move 5. Nbd2 goes through it.
    const rep = await createRepertoire(db, 'u1', { name: 'Gambit dame', color: 'black' });
    const a = await createChapter(db, 'u1', rep.id, { name: 'A' });
    const b = await createChapter(db, 'u1', rep.id, { name: 'B' });
    await saveLine(db, 'u1', a.id, ['d2d4', 'd7d5', 'g1f3', 'g8f6', 'c2c4', 'e7e6']);
    await saveLine(db, 'u1', b.id, ['d2d4', 'd7d5', 'e2e3', 'g8f6', 'g1f3', 'e7e6', 'f1d3', 'b7b6', 'c2c4', 'c7c5']);
    const b6 = after('d2d4', 'd7d5', 'e2e3', 'g8f6', 'g1f3', 'e7e6', 'f1d3', 'b7b6');
    const table = new Map<string, ExplorerResponse>([
      [START_FEN, stats([['d2d4', 100, 50, 100]])],
      [after('d2d4', 'd7d5'), stats([['g1f3', 300, 100, 300], ['e2e3', 80, 20, 80]])],
      [after('d2d4', 'd7d5', 'g1f3', 'g8f6'), stats([['c2c4', 100, 50, 100], ['e2e3', 100, 50, 100]])],
      [after('d2d4', 'd7d5', 'e2e3', 'g8f6'), stats([['g1f3', 100, 50, 100]])],
      [after('d2d4', 'd7d5', 'e2e3', 'g8f6', 'g1f3', 'e7e6'), stats([['f1d3', 100, 50, 100]])],
      // 5. c4 prepared, 5. Nbd2 not.
      [b6, stats([['c2c4', 100, 50, 100], ['b1d2', 100, 50, 100]])],
      // After 5. Nbd2: the most played reply scores far worse for Black (a real missing move).
      [playUci(b6, 'b1d2')!.toFen, stats([['c7c5', 50, 10, 20], ['f8d6', 10, 10, 40]])],
    ]);
    const storedStats = async (fens: string[]) =>
      new Map(fens.flatMap((f) => (table.has(f) ? [[f, { data: table.get(f)!, exact: true }] as const] : [])));
    const report = await gapsAnalysis(db, 'u1', { speeds: ['blitz'], ratings: [1600], cutoff: 0.01 }, storedStats);
    const gap = report.black!.gaps.find((g) => g.move?.uci === 'b1d2')!;
    expect(gap.repertoireId).toBe(rep.id);
    // Chapter B's own move order (opened in the editor: only the missing move is new).
    expect(gap.ucis).toEqual(['d2d4', 'd7d5', 'e2e3', 'g8f6', 'g1f3', 'e7e6', 'f1d3', 'b7b6']);
  });
});
