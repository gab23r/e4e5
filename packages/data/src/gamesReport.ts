/**
 * The user's games compared with their repertoires: statistics per repertoire, games outside
 * them, per named opening, errors (my deviations) and recent games. Shared by the server
 * (routes/games.ts) and the app running without a server.
 */
import { and, eq, gte, inArray, notLike } from 'drizzle-orm';
import type { Db } from './db.js';
import { analyseGames, loadRepertoires, type GameReport } from './gameAnalysis.js';
import { openingOf } from './openings.js';
import { games, inboxDismissed } from './schema.js';

export interface ReportQuery {
  /** Games of the last `days` days (0: all). */
  days: number;
  speeds: string[];
}

const MAX_ITEMS = 40;

type Results = { win: number; draw: number; loss: number };

/** Score of the games of one opening (family), with its named variations. */
interface OpeningStats {
  color: 'white' | 'black';
  family: string;
  games: number;
  results: Results;
  variations: { name: string; eco: string; ucis: string[]; games: number; results: Results }[];
}
const emptyResults = (): Results => ({ win: 0, draw: 0, loss: 0 });

/** An error: a move of mine other than the prepared one(s), at one place of a repertoire. */
interface InboxItem {
  key: string;
  repertoireId: string;
  fen: string;
  /** Moves from the start to `fen`. */
  line: { sans: string[]; ucis: string[] };
  /** The move I played. */
  move: { san: string; uci: string };
  games: number;
  results: Results;
  /** My prepared moves. */
  expected: string[];
  lastPlayedAt: string;
  /** Every game of the item, most recent first. */
  gameList: {
    url: string;
    playedAt: string;
    result: 'win' | 'draw' | 'loss';
    opponent: string;
    opponentRating: number | null;
  }[];
}

/** Statistics per repertoire, games outside the repertoires, inbox and recent games. */
export async function gamesReport(db: Db, userId: string, q: ReportQuery) {
  const where = [eq(games.userId, userId), inArray(games.speed, q.speeds)];
  if (q.days) where.push(gte(games.playedAt, new Date(Date.now() - q.days * 86_400_000)));
  const [rows, reps, dismissed] = await Promise.all([
    db.select().from(games).where(and(...where)).orderBy(games.playedAt),
    loadRepertoires(db, userId),
    db.select({ key: inboxDismissed.key, createdAt: inboxDismissed.createdAt }).from(inboxDismissed).where(eq(inboxDismissed.userId, userId)),
  ]);
  // Every repertoire is used to recognise the games; the paused ones are then left out.
  const reports = analyseGames(rows, reps);
  const hidden = new Map(dismissed.map((d) => [d.key, d.createdAt]));
  const paused = new Set(reps.filter((r) => !r.active).map((r) => r.id));

  // Per repertoire (and outside them, per colour and first move of mine).
  const perRep = new Map<string, { games: number; results: Results; plies: number }>();
  const outside = new Map<string, { color: string; move: string; games: number; results: Results }>();
  const inbox = new Map<string, InboxItem>();
  // Per named opening (all the games, in a repertoire or not).
  const openings = new Map<string, OpeningStats>();
  for (const r of reports) {
    const result = r.game.result;
    const opening = openingOf(r.game.moves);
    if (opening) {
      const key = `${r.game.color}|${opening.family}`;
      let o = openings.get(key);
      if (!o) openings.set(key, (o = { color: r.game.color, family: opening.family, games: 0, results: emptyResults(), variations: [] }));
      o.games++;
      o.results[result]++;
      let v = o.variations.find((x) => x.name === opening.name);
      if (!v) o.variations.push((v = { name: opening.name, eco: opening.eco, ucis: opening.ucis, games: 0, results: emptyResults() }));
      v.games++;
      v.results[result]++;
    }
    if (r.repertoireId === null) {
      const move = r.played ? lineText([...r.path, r.played].map((m) => m.san)) : '—';
      const key = `${r.game.color}|${move}`;
      const o = outside.get(key) ?? { color: r.game.color, move, games: 0, results: emptyResults() };
      o.games++;
      o.results[result]++;
      outside.set(key, o);
      continue;
    }
    if (paused.has(r.repertoireId)) continue;
    const s = perRep.get(r.repertoireId) ?? { games: 0, results: emptyResults(), plies: 0 };
    s.games++;
    s.results[result]++;
    s.plies += r.ply;
    perRep.set(r.repertoireId, s);
    addToInbox(inbox, r, hidden);
  }

  const byGames = (a: InboxItem, b: InboxItem) => b.games - a.games || b.lastPlayedAt.localeCompare(a.lastPlayedAt);
  // My own deviations (what the opponents bring is in the missing moves of the repertoires).
  const errors = [...inbox.values()].sort(byGames);
  return {
    games: rows.length,
    repertoires: reps.filter((r) => !paused.has(r.id)).map((r) => {
      const s = perRep.get(r.id);
      return { id: r.id, games: s?.games ?? 0, results: s?.results ?? emptyResults(), bookMoves: s?.games ? s.plies / s.games / 2 : 0 };
    }),
    outside: [...outside.values()].sort((a, b) => b.games - a.games),
    openings: [...openings.values()]
      .map((o) => ({ ...o, variations: o.variations.sort((a, b) => b.games - a.games) }))
      .sort((a, b) => b.games - a.games),
    inbox: {
      errors: errors.slice(0, MAX_ITEMS),
      /** All errors not ignored (the list is cut at MAX_ITEMS): the badge of the Mes parties tab. */
      errorCount: errors.length,
    },
    recent: reports
      .slice(-30)
      .reverse()
      .map((r) => ({
        id: r.game.id,
        url: r.game.url,
        playedAt: r.game.playedAt.toISOString(),
        color: r.game.color,
        result: r.game.result,
        opponent: r.game.opponent,
        opponentRating: r.game.opponentRating,
        repertoireId: r.repertoireId,
        kind: r.kind,
        ply: r.ply,
        move: r.played ? { san: r.played.san, uci: r.played.uci } : null,
        ucis: r.game.moves.length ? [...r.path.map((m) => m.uci), ...(r.played ? [r.played.uci] : [])] : [],
      })),
  };
}

/** Hides an inbox item (dealt with, or not interesting). */
export async function dismissInbox(db: Db, userId: string, key: string): Promise<{ ok: true }> {
  // Dismissed again (an error that came back): from now on.
  const createdAt = new Date();
  await db
    .insert(inboxDismissed)
    .values({ userId, key, createdAt })
    .onConflictDoUpdate({ target: [inboxDismissed.userId, inboxDismissed.key], set: { createdAt } });
  return { ok: true };
}

/** Shows the dismissed inbox items again (not the missing moves ignored, gaps.ts). */
export async function restoreInbox(db: Db, userId: string): Promise<{ ok: true }> {
  await db.delete(inboxDismissed).where(and(eq(inboxDismissed.userId, userId), notLike(inboxDismissed.key, 'gap|%')));
  return { ok: true };
}

/** "1. e4 c6" */
const lineText = (sans: string[]) => sans.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san)).join(' ');

/**
 * Adds a game where I left my preparation to its error. A dismissed error was dealt with (sent
 * to review, or ignored): a game played after that makes it come back, with the games since then only.
 */
function addToInbox(inbox: Map<string, InboxItem>, r: GameReport, hidden: Map<string, Date>) {
  if (r.kind !== 'my-deviation' || !r.played || !r.repertoireId) return;
  // "deviation|…": the keys of the errors already dismissed.
  const key = `deviation|${r.repertoireId}|${r.fen}|${r.played.uci}`;
  const dismissedAt = hidden.get(key);
  if (dismissedAt && r.game.playedAt <= dismissedAt) return;
  let item = inbox.get(key);
  if (!item) {
    item = {
      key,
      repertoireId: r.repertoireId,
      fen: r.fen,
      line: { sans: r.path.map((m) => m.san), ucis: r.path.map((m) => m.uci) },
      move: { san: r.played.san, uci: r.played.uci },
      games: 0,
      results: emptyResults(),
      expected: r.expected,
      lastPlayedAt: '',
      gameList: [],
    };
    inbox.set(key, item);
  }
  item.games++;
  item.results[r.game.result]++;
  const at = r.game.playedAt.toISOString();
  if (at > item.lastPlayedAt) item.lastPlayedAt = at;
  // The games come oldest first.
  item.gameList.unshift({
    url: r.game.url,
    playedAt: at,
    result: r.game.result,
    opponent: r.game.opponent,
    opponentRating: r.game.opponentRating,
  });
}
