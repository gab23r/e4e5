/**
 * Training: spaced-repetition reviews (FSRS) of my moves, in the positions where it is my turn.
 * A move card belongs to the user, not to a repertoire: a move learnt once is known everywhere.
 *
 * The app schedules each answer on the device at once (core fsrs.ts, offline too) and records it
 * here, possibly later: with its own id (an answer recorded twice counts once) and the time it was
 * given, so the same card is computed again.
 */
import { recallOf, scheduleReview, turnOf, type Grade } from '@e4e5/core';
import { and, asc, eq, gte, inArray } from 'drizzle-orm';
import { DataError, type Db } from './db.js';
import { ownRepertoire } from './repertoires.js';
import { chapters, moveCards, repertoires, repMoves, reviewLog } from './schema.js';

type CardRow = typeof moveCards.$inferSelect;

/** A move card as the app sees it. */
export function publicCard(c: CardRow, now = new Date()) {
  return {
    fen: c.fen,
    uci: c.uci,
    /** Estimated probability (0-1) of finding the move now (FSRS retrievability). */
    recall: recallOf(c.card, c.reps, now),
    due: c.due.toISOString(),
    reps: c.reps,
    lapses: c.lapses,
    /** Current interval in days (0 while learning). */
    interval: Number(c.card.scheduled_days ?? 0),
    createdAt: c.createdAt.toISOString(),
    /** The FSRS card itself, to schedule the next answers on the device. */
    fsrs: c.card,
  };
}

/** Review state of every learnt move of the user. */
export async function listCards(db: Db, userId: string) {
  const cards = await db.select().from(moveCards).where(eq(moveCards.userId, userId));
  const now = new Date();
  return cards.map((c) => publicCard(c, now));
}

export interface Answer {
  fen: string;
  uci: string;
  grade: Grade;
  /** Id given by the device to this answer (recorded again after a lost connection: counted once). */
  id?: string;
  /** When the answer was given (ms), for answers recorded later (offline). Default: now. */
  reviewedAt?: number;
  /** Training mode: Réviser or Se tester. */
  mode?: 'review' | 'test';
  /** Wrong moves played before (UCI, in order). */
  played?: string[];
}

/** My moves in a position, in the chapters of a repertoire (first chapter first). */
async function movesInRepertoire(db: Db, repertoireId: string, fen: string) {
  return db
    .select({ chapterId: repMoves.chapterId, uci: repMoves.uci })
    .from(repMoves)
    .innerJoin(chapters, eq(repMoves.chapterId, chapters.id))
    .where(and(eq(chapters.repertoireId, repertoireId), eq(repMoves.fromFen, fen)))
    .orderBy(asc(chapters.position), asc(chapters.createdAt));
}

/**
 * Records an answer (the move asked in a position of the repertoire, in any of its chapters) and
 * schedules its next review. The history keeps the first chapter having the move.
 */
export async function recordAnswer(db: Db, userId: string, repertoireId: string, answer: Answer) {
  const rep = await ownRepertoire(db, userId, repertoireId);
  const { fen, uci, grade, id, reviewedAt, mode, played } = answer;
  const chapter = (await movesInRepertoire(db, rep.id, fen)).find((m) => m.uci === uci)?.chapterId;
  if (turnOf(fen) !== rep.color || !chapter) {
    throw new DataError(400, 'Pas un coup à entraîner dans ce répertoire');
  }
  const key = and(eq(moveCards.userId, userId), eq(moveCards.fen, fen), eq(moveCards.uci, uci));
  const [existing] = await db.select().from(moveCards).where(key);
  const now = new Date();
  // The time of the answer, not before the card's last review (answers are recorded in order) nor
  // in the future (device clock ahead).
  const at = new Date(Math.min(now.getTime(), Math.max(reviewedAt ?? now.getTime(), existing?.lastReview?.getTime() ?? 0)));
  // Recorded once per id: the same answer recorded again leaves the card as it is.
  const logged = await db
    .insert(reviewLog)
    .values({ chapterId: chapter, fen, uci, grade, isNew: !existing, reviewedAt: at, clientId: id ?? null, mode: mode ?? null, played: played?.length ? played : null })
    .onConflictDoNothing({ target: reviewLog.clientId })
    .returning({ id: reviewLog.id });
  if (!logged.length && existing) return publicCard(existing, now);
  const next = scheduleReview(existing?.card, grade, at);
  const row = { userId, fen, uci, card: next.card, due: next.due, reps: next.reps, lapses: next.lapses, lastReview: at };
  const [saved] = await db
    .insert(moveCards)
    .values({ ...row, createdAt: at })
    .onConflictDoUpdate({
      target: [moveCards.userId, moveCards.fen, moveCards.uci],
      set: { card: row.card, due: row.due, reps: row.reps, lapses: row.lapses, lastReview: row.lastReview },
    })
    .returning();
  return publicCard(saved!);
}

/**
 * Makes my moves of a repertoire in a position due for review now (e.g. after a deviation in a
 * game). Only the learnt ones: new moves are learnt through the normal review. Returns how many.
 */
export async function makeDue(db: Db, userId: string, repertoireId: string, fen: string): Promise<number> {
  const moves = await movesInRepertoire(db, repertoireId, fen);
  if (!moves.length) return 0;
  const updated = await db
    .update(moveCards)
    .set({ due: new Date() })
    .where(and(eq(moveCards.userId, userId), eq(moveCards.fen, fen), inArray(moveCards.uci, moves.map((m) => m.uci))))
    .returning({ uci: moveCards.uci });
  return updated.length;
}

/** makeDue for a repertoire of the user, as asked from the app: 404 when nothing was learnt there. */
export async function reviewNow(db: Db, userId: string, repertoireId: string, fen: string): Promise<{ ok: true }> {
  await ownRepertoire(db, userId, repertoireId);
  if (!(await makeDue(db, userId, repertoireId, fen))) {
    throw new DataError(404, 'Cette position n’est pas encore apprise : entraînez-la d’abord');
  }
  return { ok: true };
}

/**
 * My training mistakes not fixed yet (Réviser and Se tester, the mistakes to review of the home
 * page): per move asked, the last answer since `since` (ms) if it was wrong. Answered right
 * since, in any mode, the mistake is fixed. The latest first. Answers recorded before the modes
 * were (mode null) count as Réviser.
 */
export async function trainingErrors(db: Db, userId: string, since: number) {
  const rows = await db
    .select({
      repertoireId: repertoires.id,
      color: repertoires.color,
      fen: reviewLog.fen,
      uci: reviewLog.uci,
      grade: reviewLog.grade,
      reviewedAt: reviewLog.reviewedAt,
      mode: reviewLog.mode,
      played: reviewLog.played,
    })
    .from(reviewLog)
    .innerJoin(chapters, eq(chapters.id, reviewLog.chapterId))
    .innerJoin(repertoires, eq(repertoires.id, chapters.repertoireId))
    .where(and(eq(repertoires.userId, userId), gte(reviewLog.reviewedAt, new Date(since))))
    .orderBy(asc(reviewLog.reviewedAt));
  // The last answer per move asked (a position in several repertoires: once).
  const last = new Map<string, (typeof rows)[number]>();
  for (const r of rows) last.set(`${r.fen}|${r.uci}`, r);
  return [...last.values()]
    .filter((r) => r.grade === 'again')
    .reverse()
    .map(({ grade: _, ...r }) => ({ ...r, mode: r.mode ?? 'review', played: r.played ?? [], reviewedAt: r.reviewedAt.getTime() }));
}

/** My answers since a time (ms), any mode: when, and right or not (the activity of the home page). */
export async function answersSince(db: Db, userId: string, since: number) {
  const rows = await db
    .select({ reviewedAt: reviewLog.reviewedAt, grade: reviewLog.grade })
    .from(reviewLog)
    .innerJoin(chapters, eq(chapters.id, reviewLog.chapterId))
    .innerJoin(repertoires, eq(repertoires.id, chapters.repertoireId))
    .where(and(eq(repertoires.userId, userId), gte(reviewLog.reviewedAt, new Date(since))));
  return rows.map((r) => ({ at: r.reviewedAt.getTime(), ok: r.grade !== 'again' }));
}
