import type { ExplorerResponse } from '@e4e5/core';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date());

export type Perfs = Record<string, { rating: number; games: number; prov?: boolean }>;
/** Ratings from the Chess.com API, e.g. { rapid: 1450, blitz: 1320 }. */
export type ChesscomRatings = Partial<Record<'rapid' | 'blitz' | 'bullet' | 'daily', number>>;

/**
 * An app account. It can be reached by password (`login` + `passwordHash`), by Lichess OAuth
 * (`lichessId`), or both. Guests have `login` = "guest:<name>" and no password.
 */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  /** Display name. */
  username: text('username').notNull(),
  /** Lowercase login name for password accounts (and "guest:<name>" for guests). */
  login: text('login').unique(),
  passwordHash: text('password_hash'),
  lichessId: text('lichess_id').unique(),
  lichessUsername: text('lichess_username'),
  lichessToken: text('lichess_token'),
  /** Lichess `perfs` (ratings per speed), refreshed at each Lichess login. */
  lichessPerfs: text('lichess_perfs', { mode: 'json' }).$type<Perfs>(),
  chesscomUsername: text('chesscom_username'),
  chesscomRatings: text('chesscom_ratings', { mode: 'json' }).$type<ChesscomRatings>(),
  createdAt: createdAt(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * A repertoire: chapters of one colour (like a Lichess study and its chapters). The training, the
 * gap finder and the games analysis see all the chapters of a colour together.
 */
export const repertoires = sqliteTable(
  'repertoires',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color', { enum: ['white', 'black'] }).notNull(),
    /** The Lichess study it is synced with (8 characters), if any. */
    lichessStudyId: text('lichess_study_id'),
    createdAt: createdAt(),
  },
  (t) => [index('repertoires_user').on(t.userId)],
);

/**
 * A chapter of a repertoire: its own graph of moves (rep_moves), like a chapter of a Lichess
 * study. Before chapters existed it was a repertoire: those kept their id, as chapters and as the
 * repertoire of their single chapter.
 */
export const chapters = sqliteTable(
  'chapters',
  {
    id: text('id').primaryKey(),
    /** Not null for every chapter (the column was added to an existing table, so SQLite has it nullable). */
    repertoireId: text('repertoire_id').notNull().references(() => repertoires.id, { onDelete: 'cascade' }),
    /** The repertoire's owner, for the queries per user. */
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Order in the repertoire (0 first). */
    position: integer('position').notNull().default(0),
    /** Where its lines start (FEN), null: the initial position. */
    startFen: text('start_fen'),
    /** false: paused (left out of "train all", the badge and the games analysis). */
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    /**
     * Where the chapter comes from, for a sync tool (outside this repository), e.g.
     * "alphaechecs:sicilienne:Sozin 6.Fc4": matched on each sync, even after a rename.
     */
    sourceKey: text('source_key'),
    /** The Lichess chapter it is synced with (8 characters), in its repertoire's study. */
    lichessChapterId: text('lichess_chapter_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('chapters_repertoire').on(t.repertoireId),
    index('chapters_user').on(t.userId),
    uniqueIndex('chapters_source').on(t.userId, t.sourceKey),
  ],
);

export const repMoves = sqliteTable(
  'rep_moves',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    chapterId: text('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
    fromFen: text('from_fen').notNull(),
    toFen: text('to_fen').notNull(),
    uci: text('uci').notNull(),
    san: text('san').notNull(),
    comment: text('comment'),
    nags: text('nags', { mode: 'json' }).$type<number[]>(),
    isMain: integer('is_main', { mode: 'boolean' }).notNull().default(false),
    /** Alternative left out of the training (core trainingRepertoire). */
    paused: integer('paused', { mode: 'boolean' }).notNull().default(false),
    source: text('source', { enum: ['manual', 'pgn', 'game', 'explorer'] }).notNull().default('manual'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('rep_moves_unique').on(t.chapterId, t.fromFen, t.uci),
    index('rep_moves_chapter').on(t.chapterId),
  ],
);

/**
 * Spaced-repetition state (FSRS) of a move to remember: one of my moves in a position, for the
 * user, whatever the repertoire (a move learnt in one repertoire is known in all those playing
 * it). Moves without a row are "new".
 */
export const moveCards = sqliteTable(
  'move_cards',
  {
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** Position (FEN without move counters, see core fenKey) where it is my turn. */
    fen: text('fen').notNull(),
    uci: text('uci').notNull(),
    /** ts-fsrs Card, as JSON. */
    card: text('card', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    due: integer('due', { mode: 'timestamp_ms' }).notNull(),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    createdAt: createdAt(),
    lastReview: integer('last_review', { mode: 'timestamp_ms' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.fen, t.uci] })],
);

/** One row per recorded answer in training (history for the statistics). */
export const reviewLog = sqliteTable(
  'review_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Chapter of the move asked. */
    chapterId: text('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
    fen: text('fen').notNull(),
    /** Move asked (null for the answers recorded per position, before move cards). */
    uci: text('uci'),
    grade: text('grade', { enum: ['again', 'hard', 'good', 'easy'] }).notNull(),
    /** First review of the position (it was new). */
    isNew: integer('is_new', { mode: 'boolean' }).notNull(),
    reviewedAt: integer('reviewed_at', { mode: 'timestamp_ms' }).notNull(),
    /** Id given by the device to the answer (answers sent again after a lost connection count once). */
    clientId: text('client_id'),
    /** Training mode of the answer: Réviser or Se tester (null: before the modes were recorded). */
    mode: text('mode', { enum: ['review', 'test'] }),
  },
  (t) => [index('review_log_chapter_time').on(t.chapterId, t.reviewedAt), uniqueIndex('review_log_client_id').on(t.clientId)],
);

/**
 * Lichess explorer statistics of a position for one combination of speeds and rating buckets,
 * shared by all users. Filled by live explorer requests and by imported seeds; it only grows.
 */
export const positionStats = sqliteTable(
  'position_stats',
  {
    /** Position key (FEN without move counters, see core fenKey). */
    fen: text('fen').notNull(),
    /** Sorted, comma-separated: "blitz,rapid". */
    speeds: text('speeds').notNull(),
    /** Sorted, comma-separated rating buckets: "1600,1800". */
    ratings: text('ratings').notNull(),
    data: text('data', { mode: 'json' }).$type<ExplorerResponse>().notNull(),
    fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
    source: text('source', { enum: ['lichess', 'seed', 'import'] }).notNull(),
    /**
     * Months of the games ("2026-08..2026-10", the explorer asked with since/until), the period
     * of the game statistics file (gameStats.ts) so both have the same scale; '': every game.
     */
    period: text('period').notNull().default(''),
  },
  (t) => [primaryKey({ columns: [t.fen, t.speeds, t.ratings, t.period] })],
);

/** Seed files of `seed/` already imported into position_stats. */
export const seedImports = sqliteTable('seed_imports', {
  name: text('name').primaryKey(),
  importedAt: integer('imported_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * A game played by the user on Lichess or Chess.com, imported by the game sync. Only what the
 * comparison with the repertoires and the statistics need; the analysis itself is recomputed
 * on demand, so it follows the repertoires as they change.
 */
export const games = sqliteTable(
  'games',
  {
    /** "lichess:<game id>" or "chesscom:<uuid>". */
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    source: text('source', { enum: ['lichess', 'chesscom'] }).notNull(),
    url: text('url').notNull(),
    playedAt: integer('played_at', { mode: 'timestamp_ms' }).notNull(),
    /** The user's colour. */
    color: text('color', { enum: ['white', 'black'] }).notNull(),
    result: text('result', { enum: ['win', 'draw', 'loss'] }).notNull(),
    /** bullet, blitz, rapid, classical, daily. */
    speed: text('speed').notNull(),
    rated: integer('rated', { mode: 'boolean' }).notNull(),
    opponent: text('opponent').notNull(),
    opponentRating: integer('opponent_rating'),
    myRating: integer('my_rating'),
    /** SAN moves of the whole game. */
    moves: text('moves', { mode: 'json' }).$type<string[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('games_user_time').on(t.userId, t.playedAt)],
);

/** Where the last sync of a source stopped (games newer than `lastGameAt` are fetched next). */
export const gameSyncs = sqliteTable(
  'game_syncs',
  {
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    source: text('source', { enum: ['lichess', 'chesscom'] }).notNull(),
    /** Account synced (a change of username starts over). */
    account: text('account').notNull(),
    lastGameAt: integer('last_game_at', { mode: 'timestamp_ms' }),
    syncedAt: integer('synced_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.source] })],
);

/** Inbox items (games analysis) the user has dealt with or dismissed. */
export const inboxDismissed = sqliteTable(
  'inbox_dismissed',
  {
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** kind|repertoireId|fen|uci, see the games routes. */
    key: text('key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

export type User = typeof users.$inferSelect;

/** The columns of a move needed to build a repertoire graph (lighter than the whole row). */
export const graphColumns = {
  chapterId: repMoves.chapterId,
  fromFen: repMoves.fromFen,
  toFen: repMoves.toFen,
  uci: repMoves.uci,
  san: repMoves.san,
  isMain: repMoves.isMain,
  paused: repMoves.paused,
};
export type RepMoveRow = typeof repMoves.$inferSelect;
