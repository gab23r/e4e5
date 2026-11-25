import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { playUci, START_FEN, type ExplorerResponse, type StoredStats } from '@e4e5/core';
import { createChapter, createRepertoire, dismissInbox, gapsAnalysis, ignoreGap, importPgn, restoreGaps, restoreInbox, type Db } from '../src/index.js';
import * as schema from '../src/schema.js';
import { users } from '../src/schema.js';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

let db: Db;
beforeEach(async () => {
  const client = createClient({ url: ':memory:' });
  const d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: MIGRATIONS });
  await d.insert(users).values([{ id: 'u1', username: 'u1' }]);
  db = d;
});

const after = (...ucis: string[]) => ucis.reduce((fen, u) => playUci(fen, u)!.toFen, START_FEN);
const stats = (moves: [uci: string, san: string, games: number][]): ExplorerResponse => ({
  white: moves.reduce((n, m) => n + m[2], 0),
  draws: 0,
  black: 0,
  moves: moves.map(([uci, san, games]) => ({ uci, san, white: games, draws: 0, black: 0 })),
});
const storedFrom = (table: Map<string, ExplorerResponse>): StoredStats => async (fens) =>
  new Map(fens.flatMap((f) => (table.has(f) ? [[f, { data: table.get(f)!, exact: true }] as const] : [])));

describe('gaps analysis', () => {
  it('lists the opponent moves forgotten among the prepared replies, not the ends of lines', async () => {
    const rep = await createRepertoire(db, 'u1', { name: 'e4', color: 'white' });
    const chapter = await createChapter(db, 'u1', rep.id, { name: 'e4' });
    // 1... c5 ends the line on the opponent's move: no answer prepared, but not a missing move.
    await importPgn(db, 'u1', chapter.id, '1. e4 e5 (1... c5) 2. Nf3 *');
    const table = new Map([[after('e2e4'), stats([['e7e5', 'e5', 50], ['c7c5', 'c5', 30], ['e7e6', 'e6', 20]])]]);
    const report = await gapsAnalysis(db, 'u1', { speeds: ['blitz'], ratings: [1600], cutoff: 0.01 }, storedFrom(table));
    expect(report.white!.gaps.map((g) => [g.kind, g.move?.san, g.prob])).toEqual([['missing-reply', 'e6', 0.2]]);
  });

  it('leaves out the missing moves ignored, until restored', async () => {
    const rep = await createRepertoire(db, 'u1', { name: 'e4', color: 'white' });
    const chapter = await createChapter(db, 'u1', rep.id, { name: 'e4' });
    await importPgn(db, 'u1', chapter.id, '1. e4 e5 (1... c5 2. Nf3) 2. Nf3 *');
    const e4 = after('e2e4');
    const table = new Map([[e4, stats([['e7e5', 'e5', 40], ['c7c5', 'c5', 30], ['e7e6', 'e6', 20], ['c7c6', 'c6', 10]])]]);
    const run = () => gapsAnalysis(db, 'u1', { speeds: ['blitz'], ratings: [1600], cutoff: 0.01 }, storedFrom(table));
    const sans = async () => (await run()).white!.gaps.map((g) => g.move?.san);
    expect(await sans()).toEqual(['e6', 'c6']);
    await ignoreGap(db, 'u1', e4, 'e7e6');
    expect(await sans()).toEqual(['c6']);
    expect((await run()).white!.ignored).toEqual({ [rep.id]: 1 }); // counted for the repertoire owning it
    // Showing the dismissed games errors again does not bring back the ignored missing moves.
    await dismissInbox(db, 'u1', 'deviation|x');
    await restoreInbox(db, 'u1');
    expect(await sans()).toEqual(['c6']);
    await restoreGaps(db, 'u1');
    expect(await sans()).toEqual(['e6', 'c6']);
  });
});
