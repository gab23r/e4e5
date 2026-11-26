/** Chapters on the device: their names, and where a line or a position belongs. */
import { fenKey, pathTo, playUci, positionFromFen, Repertoire, START_FEN, type Color, type PlayedMove } from '@e4e5/core';
import type { ChapterInfo, StoredMove } from './api';

/** "Repertoire › Chapter", or the repertoire's name alone for its chapter of the same name. */
export function chapterLabel(c: { repertoireName: string; chapterName: string }): string {
  return c.chapterName === c.repertoireName ? c.repertoireName : `${c.repertoireName} › ${c.chapterName}`;
}

/** Where the lines of a chapter start (fenKey). */
export function chapterRoot(c: Pick<ChapterInfo, 'startFen'>): string {
  if (!c.startFen) return START_FEN;
  try {
    return fenKey(positionFromFen(c.startFen));
  } catch {
    return START_FEN;
  }
}

/** The moves of one chapter, as a graph. */
export function chapterGraph(color: Color, moves: StoredMove[], chapterId: string): Repertoire {
  return new Repertoire(color, moves.filter((m) => m.chapterId === chapterId));
}

/** The moves of a line (UCI) from a position; stops at the first illegal one. */
export function playLine(from: string, ucis: string[]): PlayedMove[] {
  const moves: PlayedMove[] = [];
  for (const uci of ucis) {
    const m = playUci(moves.at(-1)?.toFen ?? from, uci);
    if (!m) break;
    moves.push(m);
  }
  return moves;
}

/**
 * The chapter a line from the initial position belongs to best, and the line to show in it: the
 * chapter reaching the furthest position of the line (by any move order: transpositions count),
 * the first chapter on a tie, with its own path to that position followed by the rest of the
 * line (the moves not in it, e.g. a missing move). Null when no chapter reaches any position of
 * the line (not even its start).
 */
export function chapterForLine(
  color: Color,
  chapters: ChapterInfo[],
  moves: StoredMove[],
  line: PlayedMove[],
): { chapter: ChapterInfo; line: PlayedMove[] } | null {
  const fens = [START_FEN, ...line.map((m) => m.toFen)];
  const graphs = chapters.map((chapter) => {
    const graph = chapterGraph(color, moves, chapter.id);
    return { chapter, graph, root: chapterRoot(chapter), reach: graph.reachable(chapterRoot(chapter)) };
  });
  for (let i = line.length; i >= 0; i--) {
    for (const g of graphs) {
      if (!g.reach.has(fens[i]!)) continue;
      const path = pathTo(g.graph, fens[i]!, g.root);
      if (path) return { chapter: g.chapter, line: [...path, ...line.slice(i)] };
    }
  }
  return null;
}

/** The first chapter containing a position, with the path to it from the chapter's start. */
export function chapterForPosition(
  color: Color,
  chapters: ChapterInfo[],
  moves: StoredMove[],
  fen: string,
): { chapter: ChapterInfo; line: PlayedMove[] } | null {
  for (const chapter of chapters) {
    const path = pathTo(chapterGraph(color, moves, chapter.id), fen, chapterRoot(chapter));
    if (path) return { chapter, line: path };
  }
  return null;
}
