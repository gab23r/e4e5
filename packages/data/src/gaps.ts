/**
 * Gap finder ("coups manquants"): the frequent opponent moves the repertoires do not answer.
 * Shared by the server (routes/gaps.ts) and the app running without a server.
 *
 * All repertoires of one colour are analysed together, as one merged graph: a line prepared in
 * any of them is not a hole for the others. Each hole is then given to the repertoire going
 * furthest along its line, past that repertoire's trunk (`gapOwner`), or to none.
 *
 * Runs on statistics at hand only (`storedStats`), so it answers at once. Positions the analysis
 * needs without them can be fetched in the background (`prefetch`, server): the client asks again
 * until nothing is pending, and each pass may reach deeper positions.
 */
import { findGaps, gapCandidate, LINE_DEPTHS, mergeChapterMoves, Repertoire, rankRepertoires, turnOf, type Color, type StoredStats } from '@e4e5/core';
import type { Db } from './db.js';
import { repertoireGraphs } from './repertoires.js';

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
      gaps: report.gaps
        .filter((g) => g.prob >= q.cutoff)
        .slice(0, MAX_GAPS)
        .map((g) => {
          const ranking = rankRepertoires(g, candidates);
          return {
            kind: g.kind,
            fen: g.fen,
            move: g.move ?? null,
            prob: Math.min(1, g.prob),
            line: g.path.map((m) => m.san),
            ucis: g.path.map((m) => m.uci),
            /** null: a deviation inside every repertoire's trunk (belongs to none of them). */
            repertoireId: ranking[0]?.owns ? ranking[0].key : null,
            /** Every repertoire of the colour, best suited first (to prepare the hole in). */
            ranking: ranking.map((r) => r.key),
          };
        }),
    };
  };

  return { white: await analyse('white'), black: await analyse('black') };
}
