import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { createChapter, createRepertoire, getChapter, listCards, makeDue, recordAnswer, reviewNow, saveLine, trainingErrors, type Db } from '../src/index.js';
import * as schema from '../src/schema.js';
import { reviewLog, users } from '../src/schema.js';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

let db: Db;
let repId: string;
let chapterId: string;
/** The position after 1.e4 e5, where White plays Nf3 in the repertoire. */
let fen: string;
beforeEach(async () => {
  const client = createClient({ url: ':memory:' });
  const d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: MIGRATIONS });
  await d.insert(users).values([
    { id: 'u1', username: 'u1' },
    { id: 'u2', username: 'u2' },
  ]);
  db = d;
  const rep = await createRepertoire(db, 'u1', { name: 'Blancs', color: 'white' });
  repId = rep.id;
  chapterId = (await createChapter(db, 'u1', rep.id, { name: 'Blancs' })).id;
  await saveLine(db, 'u1', chapterId, ['e2e4', 'e7e5', 'g1f3']);
  fen = (await getChapter(db, 'u1', chapterId)).moves.find((m) => m.uci === 'g1f3')!.fromFen;
});

describe('training', () => {
  it('lists the training mistakes until answered right', async () => {
    const t0 = Date.now() - 10_000;
    await recordAnswer(db, 'u1', repId, { fen, uci: 'g1f3', grade: 'again', id: 'answer-e1', reviewedAt: t0, mode: 'test' });
    expect(await trainingErrors(db, 'u1', t0 - 1000)).toMatchObject([{ repertoireId: repId, fen, uci: 'g1f3', mode: 'test', reviewedAt: t0 }]);
    expect(await trainingErrors(db, 'u1', t0 + 1)).toEqual([]);
    expect(await trainingErrors(db, 'u2', t0 - 1000)).toEqual([]);
    await recordAnswer(db, 'u1', repId, { fen, uci: 'g1f3', grade: 'good', id: 'answer-e2', reviewedAt: t0 + 1000, mode: 'review' });
    expect(await trainingErrors(db, 'u1', t0 - 1000)).toEqual([]);
    await recordAnswer(db, 'u1', repId, { fen, uci: 'g1f3', grade: 'again', id: 'answer-e3', reviewedAt: t0 + 2000 });
    expect(await trainingErrors(db, 'u1', t0 - 1000)).toMatchObject([{ mode: 'review', reviewedAt: t0 + 2000 }]);
  });

  it('keeps the wrong moves played with a training mistake', async () => {
    const t0 = Date.now() - 10_000;
    await recordAnswer(db, 'u1', repId, { fen, uci: 'g1f3', grade: 'again', id: 'answer-p1', reviewedAt: t0, played: ['f1c4', 'd2d4'] });
    expect(await trainingErrors(db, 'u1', t0 - 1000)).toMatchObject([{ uci: 'g1f3', played: ['f1c4', 'd2d4'] }]);
    // None played (helped at once, or recorded before they were): an empty list.
    await recordAnswer(db, 'u1', repId, { fen, uci: 'g1f3', grade: 'again', id: 'answer-p2', reviewedAt: t0 + 1000 });
    expect(await trainingErrors(db, 'u1', t0 - 1000)).toMatchObject([{ played: [] }]);
  });

  it('records an answer and schedules the move card', async () => {
    const at = Date.now() - 60_000;
    const card = await recordAnswer(db, 'u1', repId, { fen, uci: 'g1f3', grade: 'good', id: 'answer-0001', reviewedAt: at });
    expect(card).toMatchObject({ fen, uci: 'g1f3', reps: 1, lapses: 0, createdAt: new Date(at).toISOString() });
    expect(new Date(card.due).getTime()).toBeGreaterThan(at);
    expect(await listCards(db, 'u1')).toHaveLength(1);
    expect(await listCards(db, 'u2')).toEqual([]);
  });

  it('counts an answer recorded twice once', async () => {
    const answer = { fen, uci: 'g1f3', grade: 'good' as const, id: 'answer-0002', reviewedAt: Date.now() - 1000 };
    const first = await recordAnswer(db, 'u1', repId, answer);
    const again = await recordAnswer(db, 'u1', repId, answer);
    expect(again.reps).toBe(1);
    expect(again.due).toBe(first.due);
    expect(await db.select().from(reviewLog)).toHaveLength(1);
  });

  it('refuses a move not to train, and the repertoire of another user', async () => {
    const e4 = (await getChapter(db, 'u1', chapterId)).moves.find((m) => m.uci === 'e7e5')!.fromFen;
    await expect(recordAnswer(db, 'u1', repId, { fen, uci: 'f1c4', grade: 'good' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(recordAnswer(db, 'u1', repId, { fen: e4, uci: 'e7e5', grade: 'good' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(recordAnswer(db, 'u2', repId, { fen, uci: 'g1f3', grade: 'good' })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('makes the learnt moves of a position due now', async () => {
    await expect(reviewNow(db, 'u1', repId, fen)).rejects.toMatchObject({ statusCode: 404 });
    await recordAnswer(db, 'u1', repId, { fen, uci: 'g1f3', grade: 'easy' });
    const [before] = await listCards(db, 'u1');
    expect(new Date(before!.due).getTime()).toBeGreaterThan(Date.now());
    expect(await reviewNow(db, 'u1', repId, fen)).toEqual({ ok: true });
    const [after] = await listCards(db, 'u1');
    expect(new Date(after!.due).getTime()).toBeLessThanOrEqual(Date.now());
    expect(await makeDue(db, 'u2', repId, fen)).toBe(0);
  });
});
