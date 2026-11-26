/**
 * Gap finder ("coups manquants"): the frequent opponent moves the repertoires do not answer.
 * Shared by the server (routes/gaps.ts) and the app running without a server.
 *
 * All repertoires of one colour are analysed together, as one merged graph: a line prepared in
 * any of them is not a hole for the others. Each hole is then given to the repertoire going
 * furthest along its line, past that repertoire's trunk (`gapOwner`), or to none.
 *
 * Only the opponent moves forgotten among the replies a line prepares are listed: the end of a
 * line (on my move or on the opponent's, no answer after it) is not a missing move, nor a move
 * whose reply is obvious at my level or after which I already win (core obviousReply), nor one
 * leading to a position too rare at my level to have statistics, nor one in a position not trained
 * (behind a paused move, or only in paused repertoires).
 *
 * Runs on statistics at hand only (`storedStats`), so it answers at once. Positions the analysis
 * needs without them can be fetched in the background (`prefetch`, server): the client asks again
 * until nothing is pending, and each pass may reach deeper positions.
 */
import { findGaps, gapCandidate, LINE_DEPTHS, mergeChapterMoves, obviousReply, pathTo, playUci, Repertoire, rankRepertoires, trainingRepertoire, turnOf, type Color, type StoredStats } from '@e4e5/core';
import { and, eq, like } from 'drizzle-orm';
import type { Db } from './db.js';
import { repertoireGraphs } from './repertoires.js';
import { inboxDismissed } from './schema.js';

/**
 * Missing moves the user chose to ignore (not worth preparing): kept with the dismissed inbox
 * items, under "gap|<fen>|<uci>". For the colour of the position, whatever the repertoire.
 */
const GAP_KEY = 'gap|';
const gapKey = (fen: string, uci: string) => `${GAP_KEY}${fen}|${uci}`;

/** Ignores a missing move: no longer listed. */
export async function ignoreGap(db: Db, userId: string, fen: string, uci: string): Promise<{ ok: true }> {
  await db.insert(inboxDismissed).values({ userId, key: gapKey(fen, uci), createdAt: new Date() }).onConflictDoNothing();
  return { ok: true };
}

/** Lists the ignored missing moves again. */
export async function restoreGaps(db: Db, userId: string): Promise<{ ok: true }> {
  await db.delete(inboxDismissed).where(and(eq(inboxDismissed.userId, userId), like(inboxDismissed.key, `${GAP_KEY}%`)));
  return { ok: true };
}

export interface GapsQuery {
  speeds: string[];
  ratings: number[];
  /** Holes listed, and statistics fetched, from this probability. */
  cutoff: number;
}

/**
 * The analysis explores down to a quarter of the smallest depth of the lines (or of the listed
 * cutoff): enough for the holes (a hole reached by several move orders adds up) and for the
 * positions trained at each depth (Paramètres shows them all). Statistics at hand only, so cheap;
 * fetches stay at the asked cutoff.
 */
const exploreFor = (cutoff: number) => Math.min(cutoff, ...LINE_DEPTHS) / 4;
/** Per colour (shared by its repertoires). */
const MAX_GAPS = 200;

/**
 * The gap finder report of a user, per colour. `prefetch`: queues positions to fetch in the
 * background and answers how many are waiting (none: nothing is fetched).
 */
export async function gapsAnalysis(db: Db, userId: string, q: GapsQuery, storedStats: StoredStats, prefetch?: (fens: string[]) => number) {
  // Each repertoire as one graph (its chapters merged).
  const reps = await repertoireGraphs(db, userId);
  const ignoredKeys = new Set(
    (await db.select({ key: inboxDismissed.key }).from(inboxDismissed).where(and(eq(inboxDismissed.userId, userId), like(inboxDismissed.key, `${GAP_KEY}%`)))).map((r) => r.key),
  );

  const analyse = async (color: Color) => {
    const own = reps.filter((r) => r.color === color);
    if (!own.length) return null;
    const colorMoves = own.flatMap((r) => r.moves);
    // A move in several repertoires comes once, paused only if paused in all of them (findGaps
    // does not explore past a paused move).
    const merged = new Repertoire(color, mergeChapterMoves(colorMoves));
    // Only opponent positions of the repertoire need statistics.
    const opponentFens = [...new Set(colorMoves.map((m) => m.fromFen))].filter((f) => turnOf(f) !== color);
    const stored = await storedStats(opponentFens);
    const statsAt = (fen: string) => stored.get(fen)?.data;
    // Each of my moves carries the whole probability: how often a position comes up if I play its
    // line (two repertoires 1. e4 and 1. d4 do not halve each other's positions and holes).
    const report = findGaps(merged, statsAt, { cutoff: exploreFor(q.cutoff), split: false });

    // Fetched in the background: positions without exact statistics, reached often enough.
    const often = (fen: string) => (report.reached.get(fen) ?? 0) >= q.cutoff;
    const approximate = report.usedStats.filter((f) => !stored.get(f)!.exact);
    const toFetch = [...report.missingStats.map((m) => m.fen), ...approximate].filter(often);
    const pending = prefetch ? prefetch(toFetch) : 0;

    const candidates = own.map((r) => gapCandidate(r.id, new Repertoire(color, r.moves)));
    // Not the ends of lines ("no-answer": nothing prepared after an opponent move), nor the
    // missing moves ignored.
    // Nor the ones behind a paused move, or only in paused repertoires: the position must be
    // trained, i.e. reached from the start without a paused move in an active repertoire.
    const trained = new Set(own.filter((r) => r.active).flatMap((r) => [...trainingRepertoire(color, r.moves).reachable()]));
    const listed = report.gaps.filter((g) => g.kind === 'missing-reply' && g.prob >= q.cutoff && trained.has(g.fen));
    // Nor the missing moves not worth preparing, judged on the statistics of the position they
    // lead to (core obviousReply): players of my level find a good reply by themselves, or I
    // already win most games there. A position without statistics (too rare at my level to be in
    // them) is not listed either.
    const after = new Map(listed.map((g) => [g, playUci(g.fen, g.move!.uci)?.toFen]));
    const afterStats = await storedStats([...new Set([...after.values()].filter((f): f is string => !!f))]);
    const obvious = new Set(
      listed.filter((g) => {
        const there = afterStats.get(after.get(g) ?? '');
        return !there || obviousReply(there.data, color) !== null;
      }),
    );
    const kept = listed.filter((g) => !obvious.has(g));
    const shown = kept.filter((g) => !ignoredKeys.has(gapKey(g.fen, g.move!.uci)));
    /**
     * The repertoire a missing move belongs to: the best suited one past its trunk (core
     * rankRepertoires), else the only repertoire of the colour reaching its position (a long trunk:
     * a repertoire of one line); null when several reach it inside their trunks (e.g. 1. b4 for
     * repertoires against 1. e4 and 1. d4).
     */
    const ownerOf = (g: (typeof listed)[number]): string | null => {
      const best = rankRepertoires(g, candidates)[0];
      const reaching = candidates.filter((c) => c.reach.has(g.fen));
      // A repertoire reaching the position by its own moves beats one only sharing the start of
      // the line (the line then went on through another repertoire, by a transposition).
      if (best?.owns && (reaching.length !== 1 || reaching[0]!.key === best.key)) return best.key;
      return reaching.length === 1 ? reaching[0]!.key : null;
    };
    /**
     * The line to a missing move: inside the repertoire owning it when it reaches the position
     * (its own move order, so the editor opens it in the right chapter with only the missing move
     * new), else the most played way there (which may go through another repertoire, or through
     * an unprepared opponent move transposing back).
     */
    const lineOf = (g: (typeof listed)[number], owner: string | null) => {
      const c = owner === null ? undefined : candidates.find((x) => x.key === owner);
      return (c?.reach.has(g.fen) && pathTo(c.rep, g.fen)) || g.path;
    };
    /** Missing moves per repertoire owning them. */
    const byOwner = (list: typeof listed) =>
      list.reduce<Record<string, number>>((n, g) => {
        const owner = ownerOf(g);
        if (owner) n[owner] = (n[owner] ?? 0) + 1;
        return n;
      }, {});
    return {
      truncated: report.truncated,
      /** Positions analysed with statistics of another range (exact ones not stored yet). */
      approximate: approximate.length,
      /** Positions without any statistics, reached often enough to matter (they are fetched). */
      missing: report.missingStats.filter((m) => m.prob >= q.cutoff).length,
      /** Positions being fetched in the background: ask again later. */
      pending,
      /**
       * Probability of reaching each position of the repertoire if I play its line (capped at 1:
       * move orders of mine meeting again add up), explored down to EXPLORE: orders
       * the new positions by how often they come up, and stops the lines (core keptPositions,
       * which needs the opponent's positions too to bound the ones without statistics).
       */
      reach: Object.fromEntries([...report.reached].map(([fen, p]) => [fen, Math.round(Math.min(1, p) * 1e6) / 1e6])),
      /** Number of missing moves above the cutoff the user ignored (not in `gaps`), per repertoire owning them. */
      ignored: byOwner(kept.filter((g) => ignoredKeys.has(gapKey(g.fen, g.move!.uci)))),
      /** Number of missing moves above the cutoff left out as obvious (easy reply, or won), per repertoire owning them. */
      obvious: byOwner([...obvious]),
      gaps: shown
        .slice(0, MAX_GAPS)
        .map((g) => {
          const ranking = rankRepertoires(g, candidates);
          const owner = ownerOf(g);
          const path = lineOf(g, owner);
          return {
            kind: g.kind,
            fen: g.fen,
            move: g.move ?? null,
            prob: Math.min(1, g.prob),
            line: path.map((m) => m.san),
            ucis: path.map((m) => m.uci),
            /** null: a deviation inside the trunks of several repertoires (belongs to none of them). */
            repertoireId: owner,
            /** Every repertoire of the colour, best suited first (to prepare the hole in). */
            ranking: ranking.map((r) => r.key),
          };
        }),
    };
  };

  return { white: await analyse('white'), black: await analyse('black') };
}
