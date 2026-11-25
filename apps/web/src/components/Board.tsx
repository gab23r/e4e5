import { positionFromFen } from '@e4e5/core';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { DrawBrushes, DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { parseSquare } from 'chessops';
import { chessgroundDests } from 'chessops/compat';
import { useEffect, useRef, useState } from 'react';
import { BRUSHES } from './arrows';
import { moveNag } from './Nag';
import { buzzError } from './haptics';
import { moveSoundFor, playMoveSound } from './sound';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';

interface Props {
  fen: string;
  orientation: 'white' | 'black';
  lastMove?: string;
  /** Annotations of `lastMove`: its symbol (!, ?, !?…) in a badge at the top right of its square. */
  lastMoveNags?: readonly number[] | null;
  shapes?: DrawShape[];
  /**
   * Called with the UCI of a move played on the board (promotion: queen). Returning false
   * rejects it: the move stays a moment on a red square (board shaken, phone vibrating), then
   * the pieces go back to `fen`. Returning 'retry' puts it back the same way, on a dashed green
   * square instead of the error signs (not a mistake, another move is asked).
   */
  onMove?: (uci: string) => boolean | 'retry' | void;
}

const NO_SHAPES: DrawShape[] = [];
/** Radius of the annotation badge (a square is 100). */
const BADGE_R = 21;

/**
 * The badge of a move annotation, drawn by chessground on the destination square (custom SVG: a
 * square is 100 × 100): a coloured disc with a soft shadow on its top right corner, over the
 * neighbouring squares, the symbol in white (as on Lichess). On the right or top edge of the board
 * it stays inside (the board frame clips what goes past it).
 */
function nagBadge(square: Key, orientation: 'white' | 'black', nags: readonly number[] | null | undefined): DrawShape | null {
  const nag = moveNag(nags);
  if (!nag) return null;
  const right = square[0] === (orientation === 'white' ? 'h' : 'a');
  const top = square[1] === (orientation === 'white' ? '8' : '1');
  const x = right ? 100 - BADGE_R : 92;
  const y = top ? BADGE_R : 8;
  const size = nag.symbol.length > 1 ? 30 : 36;
  return {
    orig: square,
    customSvg: {
      html:
        `<defs><filter id="nag-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="1.5" dy="2.5" stdDeviation="2" flood-opacity="0.45"/></filter></defs>` +
        `<g transform="translate(${x} ${y})"><circle r="${BADGE_R}" fill="${nag.color}" filter="url(#nag-shadow)"/>` +
        `<text text-anchor="middle" dominant-baseline="central" y="1" fill="#fff" font-size="${size}" font-weight="800" font-family="system-ui, sans-serif">${nag.symbol}</text></g>`,
    },
  };
}
/** How long a rejected move stays on the board. */
const REJECTED_MS = 600;

export function Board({ fen, orientation, lastMove, lastMoveNags, shapes = NO_SHAPES, onMove }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const cg = useRef<Api | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const prevFen = useRef<string | null>(null);
  /** Move just played on the board: its sound is already played, not again when `fen` follows. */
  const dropped = useRef<string | null>(null);
  /** Destination square of the rejected move on show, then a counter to put the pieces back. */
  const [rejected, setRejected] = useState<{ square: Key; error: boolean } | null>(null);
  const [restore, setRestore] = useState(0);

  useEffect(() => {
    cg.current = Chessground(el.current!, {
      animation: { duration: 150 },
      coordinates: true,
      // chessground deep-merges config: these brushes are added to its default ones.
      drawable: { brushes: BRUSHES as unknown as DrawBrushes },
    });
    return () => cg.current?.destroy();
  }, []);

  useEffect(() => {
    // A sound when the position follows from the previous one by `lastMove` (a move played
    // here, the opponent's reply, a step forward in a line); none when loading or going back.
    if (prevFen.current && prevFen.current !== fen && lastMove) {
      const sound = dropped.current === lastMove.slice(0, 4) ? null : moveSoundFor(prevFen.current, lastMove);
      if (sound) playMoveSound(sound.capture);
    }
    dropped.current = null;
    prevFen.current = fen;
    const pos = positionFromFen(fen);
    cg.current?.set({
      fen,
      orientation,
      turnColor: pos.turn,
      check: pos.isCheck(),
      lastMove: lastMove ? [lastMove.slice(0, 2) as Key, lastMove.slice(2, 4) as Key] : undefined,
      movable: {
        free: false,
        color: onMove ? pos.turn : undefined,
        dests: chessgroundDests(pos) as Map<Key, Key[]>,
        showDests: true,
        events: {
          after: (orig, dest) => {
            const piece = pos.board.get(parseSquare(orig)!);
            const promo = piece?.role === 'pawn' && (dest[1] === '8' || dest[1] === '1') ? 'q' : '';
            const sound = moveSoundFor(fen, orig + dest);
            if (sound) playMoveSound(sound.capture);
            dropped.current = orig + dest;
            const answer = onMoveRef.current?.(orig + dest + promo);
            if (answer === false) {
              buzzError(); // within the pointer event (iOS)
              setRejected({ square: dest, error: true });
            } else if (answer === 'retry') setRejected({ square: dest, error: false });
          },
        },
      },
      highlight: { custom: new Map() },
    });
    setRejected(null);
  }, [fen, orientation, lastMove, !!onMove, restore]);

  // Separate from the position: new arrows (e.g. the answer shown after a wrong move) do not
  // put the pieces back.
  const badge = lastMove ? nagBadge(lastMove.slice(2, 4) as Key, orientation, lastMoveNags) : null;
  const badgeKey = badge && `${lastMove}${badge.customSvg!.html}`;
  useEffect(() => {
    cg.current?.setAutoShapes(badge ? [...shapes, badge] : shapes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapes, badgeKey]);

  useEffect(() => {
    if (!rejected) return;
    cg.current?.set({ highlight: { custom: new Map([[rejected.square, rejected.error ? 'rejected' : 'retry']]) } });
    const t = setTimeout(() => setRestore((n) => n + 1), REJECTED_MS);
    return () => clearTimeout(t);
  }, [rejected]);

  // A wrapper for the shake: chessground owns the classes of its own element.
  return (
    <div className={rejected?.error ? 'board-frame rejected' : 'board-frame'}>
      <div ref={el} className="board" />
    </div>
  );
}
