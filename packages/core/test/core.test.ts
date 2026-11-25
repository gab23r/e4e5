import { describe, expect, it } from 'vitest';
import {
  analyzeGame,
  GameLine,
  gameMovesFromPgn,
  lineStarts,
  mergeChapterMoves,
  pathTo,
  pickNewLines,
  trainingPositions,
  trainingRepertoire,
  bucketsFor,
  pgnToMoves,
  playUci,
  Repertoire,
  repertoireToPgn,
  START_FEN,
} from '../src/index.js';

const ITALIAN = `
[Event "Italian"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 {Italian} (3. Bb5 a6) 3... Bc5 (3... Nf6 4. d3) 4. O-O *
`;

describe('position helpers', () => {
  it('normalises castling to e1g1 and accepts both encodings', () => {
    const fen = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq -';
    expect(playUci(fen, 'e1g1')?.san).toBe('O-O');
    expect(playUci(fen, 'e1h1')?.uci).toBe('e1g1');
    expect(playUci(fen, 'e1e3')).toBeNull();
  });
});

describe('PGN import', () => {
  it('reads main line and variations, with comments', () => {
    const { moves, errors, games } = pgnToMoves(ITALIAN);
    expect(errors).toEqual([]);
    expect(games).toBe(1);
    expect(moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O', 'Nf6', 'd3', 'Bb5', 'a6']);
    expect(moves.find((m) => m.san === 'Bc4')?.comment).toBe('Italian');
    expect(moves.find((m) => m.san === 'Bb5')?.isMain).toBe(false);
    expect(moves.find((m) => m.san === 'O-O')?.uci).toBe('e1g1');
  });

  it('merges transpositions into the same position', () => {
    const { moves } = pgnToMoves('1. e4 e5 2. Nf3 Nc6 *\n\n1. Nf3 Nc6 2. e4 e5 *');
    const rep = new Repertoire('white', moves);
    const a = moves[3]!.toFen;
    const b = moves[7]!.toFen;
    expect(a).toBe(b);
    expect(rep.reachable().has(a)).toBe(true);
  });

  it('reports illegal moves', () => {
    expect(pgnToMoves('1. e4 e4 *').errors.length).toBe(1);
  });
});

describe('repertoire', () => {
  it('finds moves orphaned by a deletion', () => {
    const moves = pgnToMoves(ITALIAN).moves.filter((m) => m.san !== 'Nc6');
    const orphans = new Repertoire('white', moves).unreachableMoves();
    expect(orphans.map((m) => m.san)).toContain('Bc4');
    expect(orphans.map((m) => m.san)).not.toContain('Nf3');
  });

  it('exports to PGN and re-imports the same moves', () => {
    const rep = new Repertoire('white', pgnToMoves(ITALIAN).moves);
    const pgn = repertoireToPgn(rep, 'Italian');
    const again = new Repertoire('white', pgnToMoves(pgn).moves);
    expect(again.size).toBe(rep.size);
  });

  it('merges the moves of chapters: once each, trained unless paused everywhere, one main move', () => {
    const a = pgnToMoves('1. e4 e5 2. Nf3 (2. Bc4) *').moves.map((m) => ({ ...m, paused: m.san === 'Nf3' }));
    const b = pgnToMoves('1. e4 e5 2. Bc4 {Italian} 2... Nf6 (2... Bc5) *').moves.map((m) => ({ ...m, paused: m.san === 'Bc5' }));
    const merged = mergeChapterMoves([...a, ...b]);
    const at = (san: string) => merged.find((m) => m.san === san)!;
    expect(merged.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3', 'Bc4', 'Nf6', 'Bc5']);
    // Nf3: paused in its only chapter; Bc4 trained (in b), with b's comment; main of the first chapter.
    expect([at('Nf3').paused, at('Nf3').isMain, at('Bc4').isMain, at('Bc4').comment]).toEqual([true, true, false, 'Italian']);
    expect([at('Nf6').isMain, at('Bc5').isMain, at('Bc5').paused]).toEqual([true, false, true]);
  });

  it('exports a chapter starting at a position, and imports it back', () => {
    const afterE4E5 = playUci(playUci(START_FEN, 'e2e4')!.toFen, 'e7e5')!.toFen;
    const rep = new Repertoire('white', pgnToMoves(ITALIAN).moves);
    const sub = new Repertoire('white', [...rep.all()].filter((m) => rep.reachable(afterE4E5).has(m.fromFen)));
    const pgn = repertoireToPgn(sub, 'Italienne', afterE4E5);
    expect(pgn).toContain('[FEN "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1"]');
    expect(new Repertoire('white', pgnToMoves(pgn).moves).size).toBe(sub.size);
  });

  it('finds the path to a position from another start', () => {
    const rep = new Repertoire('white', pgnToMoves(ITALIAN).moves);
    const afterE5 = playUci(playUci(START_FEN, 'e2e4')!.toFen, 'e7e5')!.toFen;
    const bc4 = rep.movesAt(rep.movesAt(afterE5)[0]!.toFen).find((m) => m.san === 'Nc6')!.toFen;
    expect(pathTo(rep, bc4, afterE5)!.map((m) => m.san)).toEqual(['Nf3', 'Nc6']);
    expect(pathTo(rep, afterE5, bc4)).toBeNull();
  });
});

describe('game analysis', () => {
  const rep = new Repertoire('white', pgnToMoves(ITALIAN).moves);

  it('detects an opponent novelty', () => {
    const a = analyzeGame(rep, 'e4 c5 Nf3 d6'.split(' '));
    expect(a.kind).toBe('opponent-novelty');
    if (a.kind !== 'opponent-novelty') return;
    expect(a.ply).toBe(1);
    expect(a.played.san).toBe('c5');
  });

  it('detects my own deviation', () => {
    const a = analyzeGame(rep, 'e4 e5 Bc4'.split(' '));
    expect(a.kind).toBe('my-deviation');
    if (a.kind === 'my-deviation') expect(a.expected.map((m) => m.san)).toEqual(['Nf3']);
  });

  it('detects the end of preparation', () => {
    const a = analyzeGame(rep, 'e4 e5 Nf3 Nc6 Bc4 Bc5 O-O Nf6'.split(' '));
    expect(a).toMatchObject({ kind: 'end-of-prep', ply: 7 });
  });

  it('starts from the initial position', () => {
    expect(analyzeGame(rep, []).kind).toBe('in-book');
    expect(rep.movesAt(START_FEN)[0]?.san).toBe('e4');
  });
});

describe('explorer buckets', () => {
  it('picks the bucket and its nearest neighbour', () => {
    expect(bucketsFor(1750)).toEqual([1600, 1800]);
    expect(bucketsFor(1620)).toEqual([1400, 1600]);
    expect(bucketsFor(800)).toEqual([0, 1000]);
    expect(bucketsFor(2700)).toEqual([2200, 2500]);
  });
});

describe('training positions', () => {
  it('lists my positions line by line, main line first, with their path', async () => {
    const { trainingPositions } = await import('../src/index.js');
    const rep = new Repertoire('white', pgnToMoves(ITALIAN).moves);
    const positions = trainingPositions(rep);
    const paths = positions.map((p) => p.path.map((m) => m.san).join(' '));
    // Ends of lines (e.g. after 3. Bb5 a6, nothing prepared for White) are not trained.
    expect(paths).toEqual(['', 'e4 e5', 'e4 e5 Nf3 Nc6', 'e4 e5 Nf3 Nc6 Bc4 Bc5', 'e4 e5 Nf3 Nc6 Bc4 Nf6']);
  });

  it('works for Black', async () => {
    const { trainingPositions } = await import('../src/index.js');
    const rep = new Repertoire('black', pgnToMoves('1. e4 (1. d4 d5 2. c4 e6) 1... c5 2. Nf3 d6 *').moves);
    expect(trainingPositions(rep).map((p) => p.path.map((m) => m.san).join(' '))).toEqual(['e4', 'e4 c5 Nf3', 'd4', 'd4 d5 c4']);
  });
});

describe('play mode helpers', () => {
  it('restricts training to a subtree', async () => {
    const { trainingPositionsFrom } = await import('../src/index.js');
    const moves = pgnToMoves(ITALIAN).moves;
    const rep = new Repertoire('white', moves);
    const afterNc6 = moves.find((m) => m.san === 'Nc6')!.toFen;
    const paths = trainingPositionsFrom(rep, afterNc6).map((p) => p.path.map((m) => m.san).join(' '));
    expect(paths).toEqual(['e4 e5 Nf3 Nc6', 'e4 e5 Nf3 Nc6 Bc4 Bc5', 'e4 e5 Nf3 Nc6 Bc4 Nf6']);
    expect(trainingPositionsFrom(rep, START_FEN)).toHaveLength(5);
  });

  it('weights replies by games, with a floor for unplayed ones', async () => {
    const { replyWeights, chooseReply } = await import('../src/index.js');
    const rep = new Repertoire('white', pgnToMoves(ITALIAN).moves);
    const afterBc4 = [...rep.all()].find((m) => m.san === 'Bc4')!.toFen;
    const replies = rep.movesAt(afterBc4); // Bc5 (main), Nf6
    const stats = {
      white: 0, draws: 0, black: 0,
      moves: [
        { uci: replies[0]!.uci, san: 'Bc5', white: 600, draws: 0, black: 0 },
        { uci: 'd7d6', san: 'd6', white: 400, draws: 0, black: 0 },
      ],
    };
    // Smoothed: sqrt(600) and sqrt(2% of 600).
    const [bc5, nf6] = replyWeights(replies, stats);
    expect(bc5).toBeCloseTo(Math.sqrt(600));
    expect(nf6).toBeCloseTo(Math.sqrt(12));
    expect(replyWeights(replies, null)).toEqual([2, 1]);
    expect(chooseReply(replies, stats, () => 0.99)?.san).toBe('Nf6');
    expect(chooseReply(replies, stats, () => 0.5)?.san).toBe('Bc5');
    expect(chooseReply([], stats)).toBeUndefined();
  });

  it('smooths the real frequencies, keeping their order, and favours the lines with hard positions behind', async () => {
    const { replyWeights } = await import('../src/index.js');
    const rep = new Repertoire('white', pgnToMoves(ITALIAN).moves);
    const afterBc4 = [...rep.all()].find((m) => m.san === 'Bc4')!.toFen;
    const replies = rep.movesAt(afterBc4); // Bc5, Nf6
    const share = (w: number[]) => w[0]! / (w[0]! + w[1]!);
    const stats = (a: number, b: number) => ({
      white: 0, draws: 0, black: 0,
      moves: [
        { uci: replies[0]!.uci, san: 'Bc5', white: a, draws: 0, black: 0 },
        { uci: replies[1]!.uci, san: 'Nf6', white: b, draws: 0, black: 0 },
      ],
    });
    // 90 % / 10 % in the games: 75 % / 25 %; 97 % / 3 %: 85 % / 15 %.
    expect(share(replyWeights(replies, stats(900, 100)))).toBeCloseTo(0.75, 2);
    expect(share(replyWeights(replies, stats(970, 30)))).toBeCloseTo(0.85, 2);
    // 3 mistakes expected behind Nf6 (× 2), none behind Bc5 (× 1, however long): Bc5 still first.
    const difficulty = (m: { san: string }) => (m.san === 'Nf6' ? 3 : 0);
    const w = replyWeights(replies, stats(900, 100), { difficulty });
    expect(w[1]! / w[0]!).toBeCloseTo((10 * 2) / 30);
    expect(w[0]!).toBeGreaterThan(w[1]!);
    // With 7 expected mistakes (× 2.5), the rarer but harder line comes up as often or more.
    const harder = replyWeights(replies, stats(900, 100), { difficulty: (m) => (m.san === 'Nf6' ? 7 : 0) });
    expect(harder[1]! / harder[0]!).toBeCloseTo((10 * 2.5) / 30);
  });
});

describe('pathTo', () => {
  it('finds the line to any position of the repertoire', async () => {
    const { pathTo } = await import('../src/index.js');
    const moves = pgnToMoves(ITALIAN).moves;
    const rep = new Repertoire('white', moves);
    const a6 = moves.find((m) => m.san === 'a6')!.toFen;
    expect(pathTo(rep, a6)?.map((m) => m.san).join(' ')).toBe('e4 e5 Nf3 Nc6 Bb5 a6');
    expect(pathTo(rep, START_FEN)).toEqual([]);
    expect(pathTo(rep, 'rnbqkbnr/pppppppp/8/8/8/7P/PPPPPPP1/RNBQKBNR b KQkq -')).toBeNull();
  });
});

describe('engine output', () => {
  it('parses info lines from White\'s point of view', async () => {
    const { parseInfo, formatScore, uciFen } = await import('../src/index.js');
    const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -';
    const l = parseInfo('info depth 18 seldepth 25 multipv 2 score cp 31 nodes 1 nps 1 pv c7c5 g1f3 d7d6', afterE4)!;
    expect(l.multipv).toBe(2);
    expect(l.depth).toBe(18);
    expect(l.score).toEqual({ cp: -31 }); // Black to move: +31 for Black = -0.31 for White
    expect(l.pv.map((m) => m.san)).toEqual(['c5', 'Nf3', 'd6']);
    expect(formatScore(l.score)).toBe('-0.31');
    expect(formatScore({ mate: 3 })).toBe('#3');
    expect(formatScore({ mate: -2 })).toBe('-#2');
    expect(parseInfo('info depth 10 score cp 20 lowerbound pv e2e4', START_FEN)).toBeNull();
    expect(parseInfo('bestmove e2e4', START_FEN)).toBeNull();
    expect(uciFen(START_FEN)).toBe(`${START_FEN} 0 1`);
  });
});

describe('played games', () => {
  const CHESSCOM = `[Event "Live Chess"]
[Site "Chess.com"]
[White "lartistefou"]
[Result "1-0"]

1. d4 {[%clk 0:04:59.7]} 1... d5 {[%clk 0:04:58.7]} 2. Nf3 {[%clk 0:04:57.2]} 2... c5 {[%clk 0:04:58]} 3. dxc5 $1 {[%clk 0:04:54.8]} (3. c4 e6) 3... Nc6 {[%clk 0:04:57]} 1-0`;

  it('reads the moves of a Chess.com PGN (clocks, NAGs, variations dropped)', () => {
    expect(gameMovesFromPgn(CHESSCOM)).toEqual({ sans: ['d4', 'd5', 'Nf3', 'c5', 'dxc5', 'Nc6'], standard: true });
    expect(gameMovesFromPgn('[SetUp "1"]\n[FEN "8/8/8/8/8/8/8/K6k w - - 0 1"]\n\n1. Kb1 *').standard).toBe(false);
  });

  it('plays the moves of a game on demand', () => {
    const line = new GameLine(['e4', 'e5', 'Nf3', 'Qxx9', 'Nc6']);
    expect(line.at(1)?.uci).toBe('e7e5');
    expect(line.at(3)).toBeNull(); // illegal move: the game ends there
    expect(line.slice(10).map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3']);
  });
});

describe('new lines to learn', () => {
  it('picks whole lines, one continuation per position', () => {
    // My answers after 1. e4 e5 (2. Nf3), 1... c5 (2. Nf3) and 1... e6 (2. d4): three lines.
    const rep = new Repertoire('white', pgnToMoves('1. e4 e5 (1... c5 2. Nf3 d6 3. d4) (1... e6 2. d4) 2. Nf3 Nc6 3. Bb5 *').moves);
    const positions = trainingPositions(rep);
    const one = pickNewLines(positions, 1);
    expect(one.lines).toBe(1);
    // The first line from the start: 1. e4, then the main line (2. Nf3, 3. Bb5).
    expect(one.chosen.map((p) => rep.movesAt(p.fen)[0]!.san)).toEqual(['e4', 'Nf3', 'Bb5']);
    const all = pickNewLines(positions, 10);
    expect(all.lines).toBe(3);
    expect(all.chosen).toHaveLength(positions.length);
    expect(lineStarts(positions, (f) => positions.some((p) => p.fen === f))).toHaveLength(3);
  });
});

describe('paused alternatives', () => {
  it('leaves a paused move and what only follows it out of the training', () => {
    // 1... c5 paused: my answers after it (2. Nf3, 3. d4) are not trained, 1... e5 still is.
    const moves = pgnToMoves('1. e4 e5 (1... c5 2. Nf3 d6 3. d4) 2. Nf3 Nc6 3. Bb5 *').moves.map((m) => ({ ...m, paused: m.san === 'c5' }));
    const sans = (rep: Repertoire) => trainingPositions(rep).map((p) => rep.movesAt(p.fen)[0]!.san);
    expect(sans(new Repertoire('white', moves))).toEqual(['e4', 'Nf3', 'Bb5', 'Nf3', 'd4']);
    expect(sans(trainingRepertoire('white', moves))).toEqual(['e4', 'Nf3', 'Bb5']);
  });

  it('mainOnly: only my main move where I have several, and not what only follows the others', () => {
    const moves = pgnToMoves('1. e4 e5 (1... c5 2. Nf3) 2. Nf3 (2. Bc4 Nf6 3. d3) 2... Nc6 3. Bb5 *').moves;
    const asked = (rep: Repertoire) => trainingPositions(rep).map((p) => rep.movesAt(p.fen).map((m) => m.san).join('/'));
    expect(asked(trainingRepertoire('white', moves))).toEqual(['e4', 'Nf3/Bc4', 'Bb5', 'd3', 'Nf3']);
    // The opponent's several replies stay (1... c5 2. Nf3 is still trained).
    expect(asked(trainingRepertoire('white', moves, { mainOnly: true }))).toEqual(['e4', 'Nf3', 'Bb5', 'Nf3']);
  });
});
