import { pgnToMoves } from '@e4e5/core';
import { describe, expect, it } from 'vitest';
import type { ChapterInfo, StoredMove } from './api';
import { chapterForLine, playLine } from './chapters';
import { START_FEN } from '@e4e5/core';

const chapter = (id: string, name: string): ChapterInfo => ({ id, repertoireId: 'r', name, position: 0, startFen: null, active: true, lichessChapterId: null, createdAt: '' });
const movesOf = (chapterId: string, pgn: string, from = 0): StoredMove[] =>
  pgnToMoves(pgn).moves.map((m, i) => ({ ...m, id: from + i, source: 'pgn', chapterId }));

describe('chapterForLine', () => {
  const chapters = [chapter('a', '3.g3'), chapter('b', 'Colle')];
  const moves = [...movesOf('a', '1. d4 d5 2. Nf3 Nf6 3. g3 *'), ...movesOf('b', '1. Nf3 d5 2. d4 Nf6 3. e3 e6 4. Bd3 b6 *', 100)];

  it('opens the chapter reaching the furthest position of the line, by its own move order', () => {
    // The missing move 5. Nbd2 of the line 1. d4 d5 2. Nf3 Nf6 3. e3 e6 4. Bd3 b6: reached in "Colle" by transposition.
    const line = playLine(START_FEN, ['d2d4', 'd7d5', 'g1f3', 'g8f6', 'e2e3', 'e7e6', 'f1d3', 'b7b6', 'b1d2']);
    const target = chapterForLine('black', chapters, moves, line)!;
    expect(target.chapter.id).toBe('b');
    expect(target.line.map((m) => m.san)).toEqual(['Nf3', 'd5', 'd4', 'Nf6', 'e3', 'e6', 'Bd3', 'b6', 'Nbd2']);
  });

  it('keeps the line as given where a chapter follows it', () => {
    const line = playLine(START_FEN, ['d2d4', 'd7d5', 'g1f3', 'g8f6', 'g2g3', 'c7c6']);
    const target = chapterForLine('black', chapters, moves, line)!;
    expect(target.chapter.id).toBe('a');
    expect(target.line.map((m) => m.san)).toEqual(['d4', 'd5', 'Nf3', 'Nf6', 'g3', 'c6']);
  });
});
