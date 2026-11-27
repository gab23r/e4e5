/**
 * The app's API, answered on this device by the local database with the shared data functions
 * (@e4e5/data). Answers go through JSON (dates as ISO strings).
 *
 * One user, without login: its accounts on Lichess (linked by OAuth from the app, lichessLogin.ts)
 * and Chess.com are kept in the local database; its games are synced from the device, straight
 * from the two sites.
 *
 * The statistics (explorer, search at my level, missing moves) are read in the files downloaded
 * on the device (stats.ts) for the rating buckets of the settings.
 */
import { fenKey, positionFromFen, REACH_STEPS, suggestMoves } from '@e4e5/core';
import {
  chapterMovesAt,
  createChapters,
  createRepertoire,
  DataError,
  deleteChapter,
  deleteMove,
  deleteRepertoire,
  dismissInbox,
  gamesReport,
  gapsAnalysis,
  ignoreGap,
  restoreGaps,
  getRepertoire,
  applyStudySync,
  getStudy,
  planPush,
  planStudySync,
  pushRepertoire,
  StudyError,
  studiesBy,
  getProfile,
  setChesscom,
  unlinkLichess,
  myGameMoves,
  myGamesAt,
  openingOfUcis,
  PUBLIC_SOURCES,
  restoreInbox,
  setOpeningsTable,
  startSync,
  syncStatus,
  listCards,
  listRepertoires,
  moveChapters,
  positionChapters,
  recordAnswer,
  reviewNow,
  trainingErrors,
  answersSince,
  saveLine,
  reorderChapters,
  updateChapter,
  updateMove,
  updateRepertoire,
} from '@e4e5/data';
import { users } from '@e4e5/data/schema';
import { eq } from 'drizzle-orm';
import { ApiError, type Api, type Me } from '../api';
import { LOCAL_USER, localDb } from './db';
import { localStats } from './stats';
import { t } from '../i18n';

type LocalDb = Awaited<ReturnType<typeof localDb>>['db'];

/** Runs a data function on the local database; its errors as ApiError. */
async function run<T>(fn: (db: LocalDb) => Promise<unknown>): Promise<T> {
  let result: unknown;
  try {
    result = await fn((await localDb()).db);
  } catch (e) {
    if (e instanceof DataError) throw new ApiError(e.statusCode, e.message);
    if (e instanceof StudyError) throw new ApiError(e.status, e.message);
    throw new ApiError(500, e instanceof Error ? e.message : String(e));
  }
  // Through JSON: dates become strings, undefined fields disappear.
  return JSON.parse(JSON.stringify(result)) as T;
}

/** The user of this device, as the app sees it. */
async function localMe(db: LocalDb): Promise<Me> {
  const p = await getProfile(db, LOCAL_USER);
  return {
    id: LOCAL_USER,
    username: p.username,
    lichess: p.lichess && { username: p.lichess.username, perfs: p.lichess.perfs },
    chesscom: p.chesscom,
  };
}

/** lichess.org calls of the device, one at a time (Lichess answers 429 to a second one). */
let lichessCalls: Promise<unknown> = Promise.resolve();
const lichessQueue = <T>(task: () => Promise<T>): Promise<T> => {
  const run = lichessCalls.then(task);
  lichessCalls = run.catch(() => undefined);
  return run;
};
/** The sites as the device reaches them (public addresses, no custom header). */
const SOURCES = { ...PUBLIC_SOURCES, lichessQueue };

/** The sites with the Lichess token of the device's account, if linked: its private studies too. */
async function withLichessToken(db: LocalDb) {
  const [u] = await db.select({ token: users.lichessToken }).from(users).where(eq(users.id, LOCAL_USER));
  return { ...SOURCES, lichessToken: u?.token ?? null };
}

/** The local user with its accounts. */
async function localUser(db: LocalDb) {
  const [u] = await db.select().from(users).where(eq(users.id, LOCAL_USER));
  return { id: LOCAL_USER, chesscomUsername: u?.chesscomUsername ?? null, lichessUsername: u?.lichessUsername ?? null };
}

/** The table of opening names, loaded with the code the first time it is needed (~100 Ko). */
let openings: Promise<void> | null = null;
const loadOpenings = () =>
  (openings ??= import('../../../../packages/data/seed/openings.tsv?raw').then((m) => setOpeningsTable(() => m.default)));

/** The statistics files of the settings are not on the device (or the position is not in them). */
function notOnDevice(): never {
  throw new ApiError(
    404,
    t(
      'Statistiques absentes de cet appareil : téléchargez les tranches de vos réglages (Paramètres › Statistiques)',
      'Statistics not on this device: download the ranges of your settings (Settings › Statistics)',
    ),
    { reason: 'local-stats' },
  );
}

const positionKey = (fen: string) => {
  try {
    return fenKey(positionFromFen(fen));
  } catch {
    throw new DataError(400, t('FEN invalide', 'Invalid FEN'));
  }
};

export const localApi = {
  /** The user of this device and its accounts (no login). */
  me: () => run(async (db) => localMe(db)),
  updateMe: (patch) =>
    run(async (db) => {
      const { warning } = patch.chesscomUsername !== undefined ? await setChesscom(db, LOCAL_USER, patch.chesscomUsername, PUBLIC_SOURCES) : {};
      return { user: await localMe(db), warning };
    }),
  unlinkLichess: () =>
    run(async (db) => {
      await unlinkLichess(db, LOCAL_USER);
      return { user: await localMe(db) };
    }),
  repertoires: () => run(async (db) => listRepertoires(db, LOCAL_USER)),
  createRepertoire: (name, color, opts) =>
    run(async (db) => {
      const rep = await createRepertoire(db, LOCAL_USER, { name: name.trim(), color, lichessStudyId: opts?.lichessStudyId ?? null });
      const chapters = await createChapters(db, LOCAL_USER, rep.id, opts?.chapters ?? []);
      return { id: rep.id, name: rep.name, color: rep.color, chapters };
    }),
  renameRepertoire: (id, name) =>
    run(async (db) => {
      await updateRepertoire(db, LOCAL_USER, id, { name: name.trim() });
      return { ok: true };
    }),
  setRepertoireActive: (id, active) =>
    run(async (db) => {
      const rep = await getRepertoire(db, LOCAL_USER, id);
      for (const c of rep.chapters) await updateChapter(db, LOCAL_USER, c.id, { active });
      return { ok: true };
    }),
  deleteRepertoire: (id) => run(async (db) => deleteRepertoire(db, LOCAL_USER, id)),
  repertoire: (id) => run(async (db) => getRepertoire(db, LOCAL_USER, id)),
  createChapters: (repertoireId, list) => run(async (db) => createChapters(db, LOCAL_USER, repertoireId, list)),
  renameChapter: (id, name) =>
    run(async (db) => {
      await updateChapter(db, LOCAL_USER, id, { name: name.trim() });
      return { ok: true };
    }),
  setChapterActive: (id, active) =>
    run(async (db) => {
      await updateChapter(db, LOCAL_USER, id, { active });
      return { ok: true };
    }),
  moveChapters: (ids, repertoireId) => run(async (db) => moveChapters(db, LOCAL_USER, ids, repertoireId)),
  reorderChapters: (repertoireId, ids) => run(async (db) => reorderChapters(db, LOCAL_USER, repertoireId, ids)),
  deleteChapter: (id) => run(async (db) => deleteChapter(db, LOCAL_USER, id)),
  saveLine: (id, ucis) => run(async (db) => saveLine(db, LOCAL_USER, id, ucis)),
  updateMove: (id, moveId, patch) => run(async (db) => updateMove(db, LOCAL_USER, id, moveId, patch)),
  deleteMove: (id, moveId) => run(async (db) => deleteMove(db, LOCAL_USER, id, moveId)),
  positionChapters: (fen) => run(async (db) => positionChapters(db, LOCAL_USER, fen)),
  chapterMovesAt: (fen) => run(async (db) => chapterMovesAt(db, LOCAL_USER, fen)),
  cards: () => run(async (db) => listCards(db, LOCAL_USER)),
  review: (id, answer) => run(async (db) => recordAnswer(db, LOCAL_USER, id, answer)),
  reviewNow: (id, fen) => run(async (db) => reviewNow(db, LOCAL_USER, id, fen)),
  trainingErrors: (since) => run(async (db) => trainingErrors(db, LOCAL_USER, since)),
  answersSince: (since) => run(async (db) => answersSince(db, LOCAL_USER, since)),
  syncState: () => run(async (db) => syncStatus(db, await localUser(db))),
  startSync: (source) => run(async (db) => startSync(db, await localUser(db), source, SOURCES, (e) => console.warn(`${source} sync failed`, e))),
  gamesReport: (days, speeds) =>
    run(async (db) => {
      await loadOpenings();
      return gamesReport(db, LOCAL_USER, { days, speeds });
    }),
  dismissInbox: (key) => run(async (db) => dismissInbox(db, LOCAL_USER, key)),
  restoreInbox: () => run(async (db) => restoreInbox(db, LOCAL_USER)),
  myGames: (fen, color, speeds, days) =>
    run(async (db) => {
      const u = await localUser(db);
      return myGamesAt(db, LOCAL_USER, { lichess: u.lichessUsername, chesscom: u.chesscomUsername }, { fen: positionKey(fen), color, speeds, days });
    }),
  myGameMoves: (id) =>
    run(async (db) => {
      const moves = await myGameMoves(db, LOCAL_USER, id);
      if (!moves) throw new DataError(404, t('Partie introuvable', 'Game not found'));
      return { moves };
    }),
  explorer: async (fen, speeds, ratings) => {
    const s = await localStats(speeds, ratings);
    const data = s && (await s.one(positionKey(fen)));
    if (!s || !data) notOnDevice();
    const meta = { speeds, ratings, exact: true, fetchedAt: new Date(`${s.period.until}-01T00:00:00Z`).toISOString(), source: 'database' as const, period: s.period };
    return { data, meta };
  },
  bestMoves: async (fen, speeds, ratings, depth, color) => {
    const s = await localStats(speeds, ratings);
    const root = positionKey(fen);
    const first = s && (await s.one(root));
    if (!s || !first) notOnDevice();
    const { missing: _m, approximate: _a, ...found } = await suggestMoves(s.stored, root, { data: first, exact: true }, depth, color, undefined, true);
    return { ...found, steps: REACH_STEPS, pending: 0 };
  },
  gaps: async (speeds, ratings, cutoff) => {
    const s = await localStats(speeds, ratings);
    if (!s) notOnDevice();
    return run(async (db) => gapsAnalysis(db, LOCAL_USER, { speeds, ratings, cutoff }, s.stored));
  },
  ignoreGap: (fen, uci) => run(async (db) => ignoreGap(db, LOCAL_USER, fen, uci)),
  restoreGaps: () => run(async (db) => restoreGaps(db, LOCAL_USER)),
  lichessStudiesBy: (username) => run(async (db) => studiesBy(await withLichessToken(db), username)),
  lichessStudy: (id) => run(async (db) => getStudy(await withLichessToken(db), id)),
  studySyncPlan: (repertoireId, studyId, hard) =>
    run(async (db) => {
      const study = await getStudy(await withLichessToken(db), studyId, true);
      return { study, plan: await planStudySync(db, LOCAL_USER, repertoireId, study.chapters, { hard }) };
    }),
  pushPlan: (repertoireId) =>
    run(async (db) => {
      const rep = await getRepertoire(db, LOCAL_USER, repertoireId);
      const study = rep.lichessStudyId ? await getStudy(await withLichessToken(db), rep.lichessStudyId, true) : null;
      return planPush(db, LOCAL_USER, repertoireId, study);
    }),
  pushToLichess: (repertoireId, visibility) => run(async (db) => pushRepertoire(db, LOCAL_USER, repertoireId, await withLichessToken(db), { visibility })),
  applyStudySync: (repertoireId, studyId, choices) =>
    run(async (db) => {
      // The version previewed (kept since the plan).
      const study = await getStudy(await withLichessToken(db), studyId);
      return applyStudySync(db, LOCAL_USER, repertoireId, studyId, study.chapters, choices);
    }),
  opening: (line) =>
    run(async () => {
      await loadOpenings();
      const o = openingOfUcis(line ? line.split(',') : []);
      return o && { eco: o.eco, name: o.name };
    }),
} satisfies Api;

