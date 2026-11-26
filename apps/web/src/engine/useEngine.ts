import type { EngineLine } from '@e4e5/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getEngine } from './stockfish';

const DEPTH = 22;
/** The quick first pass finding the best move, before the moves of the table are evaluated. */
const FIRST_DEPTH = 14;

/**
 * Live analysis of `fen` while `enabled`: best lines (by multipv) and current depth.
 *
 * With `candidates` (the moves at the top of the statistics table): a quick search finds the best
 * move, then the candidates and that best move are searched together (Stockfish `searchmoves`, one
 * line each), so each gets its own evaluation (`byMove`). The first line is still the best one.
 */
export function useEngine(fen: string, enabled: boolean, multipv = 3, candidates?: string[]) {
  const [lines, setLines] = useState<EngineLine[]>([]);
  // The evaluation of each move searched in this position, kept across the searches (the deepest
  // one): showing other moves restarts the search without losing the ones already evaluated.
  const [evals, setEvals] = useState<{ fen: string; byMove: Map<string, EngineLine> }>({ fen, byMove: new Map() });
  // The search restarts when the set of candidates changes, not their order.
  const key = candidates ? [...new Set(candidates)].sort().join(' ') : null;

  useEffect(() => {
    setLines([]);
    if (!enabled) {
      void getEngine().stop();
      return;
    }
    let alive = true;
    const onLine = (line: EngineLine) => {
      if (!alive) return;
      const uci = line.pv[0]?.uci;
      if (uci) {
        setEvals((old) => {
          const byMove = new Map(old.fen === fen ? old.byMove : []);
          const had = byMove.get(uci);
          if (!had || line.depth >= had.depth) byMove.set(uci, line);
          return { fen, byMove };
        });
      }
      setLines((old) => {
        const next = [...old];
        next[line.multipv - 1] = line; // one slot per line
        return next;
      });
    };
    if (key === null || key === '') {
      void getEngine().analyse({ fen, multipv, depth: DEPTH, onLine });
    } else {
      let best: string | undefined;
      void getEngine().analyse({
        fen,
        multipv: 1,
        depth: FIRST_DEPTH,
        onLine: (line) => {
          best = line.pv[0]?.uci ?? best;
          onLine(line);
        },
        onDone: () => {
          if (!alive) return;
          const moves = [...new Set([...key.split(' '), ...(best ? [best] : [])])];
          void getEngine().analyse({ fen, multipv: moves.length, depth: DEPTH, searchmoves: moves, onLine });
        },
      });
    }
    return () => {
      alive = false;
    };
  }, [fen, enabled, multipv, key]);

  // Lines from a shallower depth than the best one are outdated.
  const best = lines[0]?.depth ?? 0;
  const shown = lines.filter((l): l is EngineLine => !!l && l.depth >= best - 1);
  const byMove = useMemo(() => (evals.fen === fen ? evals.byMove : new Map<string, EngineLine>()), [evals, fen]);
  return { lines: shown, byMove, depth: best, maxDepth: DEPTH };
}

/**
 * Stockfish for the statistics table (Éval column): the moves the table shows (told by `onShown`,
 * kept with their position so a previous position's moves are never searched) and its best move
 * are evaluated; before the table tells them, a usual search (3 lines).
 */
export function useTableEngine(fen: string, enabled: boolean) {
  const [shown, setShown] = useState<{ fen: string; ucis: string[] } | null>(null);
  const engine = useEngine(fen, enabled, 3, shown?.fen === fen ? shown.ucis : undefined);
  const onShown = useCallback((ucis: string[]) => setShown({ fen, ucis }), [fen]);
  return { ...engine, onShown };
}
