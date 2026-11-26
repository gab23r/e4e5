/**
 * The next moves of the position on the board (editor, explorer), as chips on one row: the main move first
 * (outlined), the other moves trained, then the pause zone at the end holding the paused ones
 * (greyed). A click plays the move; a long press (right click) asks its actions (pause, delete). A
 * chip dragged along the row with the mouse or a finger changes the order: dropped first, it
 * becomes the main move; dropped at the end, into the pause zone (shown while dragging when it is
 * empty), it is paused (it and what only follows it are not trained); a paused chip dragged out
 * of it is trained again.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { StoredMove } from '../api';
import { t } from '../i18n';
import { Icon } from '../ui';
import { San } from './Nag';
import { useFlip } from './useFlip';
import { useLongPress } from './useLongPress';
import type { DropTarget } from './useMoveDrag';

/** Moving this far (px) starts a drag; less is a click. */
const DRAG_PX = 6;

/** A next move shown as a chip: a move of the repertoire (editor) or of several (explorer). */
export type ChipMove = Pick<StoredMove, 'uci' | 'san' | 'nags' | 'comment' | 'paused' | 'isMain'> & {
  /** Its key (for the drop and the animation). */
  id: number;
  /** A first line for its tooltip (e.g. the repertoires playing it). */
  label?: string;
};

export function MoveChips<M extends ChipMove>({
  moves,
  draft,
  moveNumber,
  onPlay,
  onDrop,
  onActions,
  onDiscardDraft,
}: {
  /** The moves trained (main first), then the paused ones. */
  moves: M[];
  /** The next move of the line on the board, not saved yet. */
  draft: { uci: string; san: string } | null;
  /** "2." or "2…", before the first chip. */
  moveNumber: string;
  onPlay: (uci: string) => void;
  onDrop: (id: number, target: DropTarget) => void;
  onActions: (m: M) => void;
  onDiscardDraft?: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const pauseRef = useRef<HTMLSpanElement>(null);
  const longPress = useLongPress();
  useFlip(rowRef);
  const press = useRef<{ id: number; x: number; y: number; dragging: boolean } | null>(null);
  const [drag, setDrag] = useState<({ id: number; dx: number; dy: number } & DropTarget) | null>(null);
  /** A drag just ended: the click that follows it does not play the move. */
  const dropped = useRef(false);

  const active = moves.filter((m) => !m.paused);
  const paused = moves.filter((m) => m.paused);
  const several = active.length > 1;

  /** Where a chip dragged to `x` lands: the pause zone at the end of the row, else before the first active chip past it. */
  const targetAt = (x: number, id: number): DropTarget => {
    const pause = pauseRef.current?.getBoundingClientRect();
    if (pause && x >= pause.left - 8) return { zone: 'paused', index: 0 };
    const chips = [...(rowRef.current?.querySelectorAll<HTMLElement>('[data-zone="active"]') ?? [])].filter((c) => c.dataset.id !== String(id));
    const index = chips.findIndex((c) => {
      const b = c.getBoundingClientRect();
      return x < b.left + b.width / 2;
    });
    return { zone: 'active', index: index < 0 ? chips.length : index };
  };

  const dragProps = (m: M) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      press.current = { id: m.id, x: e.clientX, y: e.clientY, dragging: false };
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const p = press.current;
      if (!p || p.id !== m.id) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (!p.dragging) {
        if (Math.hypot(dx, dy) < DRAG_PX) return;
        p.dragging = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      // Along the row only (one line).
      setDrag({ id: m.id, dx, dy: 0, ...targetAt(e.clientX, m.id) });
    },
    onPointerUp: () => {
      const p = press.current;
      press.current = null;
      if (!p?.dragging || !drag) return;
      // The click following the drop (mouse) is swallowed; a finger does not click after moving,
      // so the flag goes once this event is handled.
      dropped.current = true;
      setTimeout(() => (dropped.current = false), 0);
      setDrag(null);
      onDrop(m.id, { zone: drag.zone, index: drag.index });
    },
    onPointerCancel: () => {
      press.current = null;
      setDrag(null);
    },
  });

  // Where the dragged chip would land: a marker before that chip (or after the last one).
  const others = active.filter((m) => m.id !== drag?.id);
  const markBefore = drag?.zone === 'active' ? others[drag.index]?.id : undefined;
  const markEnd = drag?.zone === 'active' && drag.index >= others.length;

  const chip = (m: M) => (
    <button
      key={m.id}
      type="button"
      data-zone={m.paused ? 'paused' : 'active'}
      data-id={m.id}
      data-flip={m.id}
      className={[
        'move-chip',
        m.paused ? 'paused' : '',
        m.isMain && !m.paused && several ? 'main' : '',
        drag?.id === m.id ? 'dragging' : '',
        markBefore === m.id ? 'drop-before' : '',
        markEnd && m.id === others.at(-1)?.id ? 'drop-after' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={drag?.id === m.id ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : undefined}
      title={[
        m.label,
        m.comment,
        m.paused ? t('En pause : pas entraîné', 'Paused: not trained') : m.isMain && several ? t('Coup principal', 'Main move') : '',
        t('Glisser pour changer l’ordre, ou à la fin pour mettre en pause · appui long : actions', 'Drag to reorder, or to the end to pause · long press: actions'),
      ]
        .filter(Boolean)
        .join('\n')}
      onClick={() => {
        if (dropped.current) return void (dropped.current = false);
        onPlay(m.uci);
      }}
      {...longPress(() => onActions(m))}
      {...dragProps(m)}
    >
      <San san={m.san} nags={m.nags} />
      {m.comment && <span className="chip-note" aria-hidden="true" />}
    </button>
  );

  return (
    <div className={`move-chips-wrap ${drag ? 'dragging-chips' : ''}`}>
      <div className="move-chips" ref={rowRef}>
        <span className="move-num">{moveNumber}</span>
        {draft && (
          <span className="move-chip draft" title={t('Suite de votre ligne, pas encore enregistrée', 'Continuation of your line, not saved yet')}>
            <button type="button" className="chip-move" onClick={() => onPlay(draft.uci)}>{draft.san}</button>
            {onDiscardDraft && <button type="button" className="chip-x" onClick={onDiscardDraft} title={t('Annuler la suite non enregistrée à partir d’ici', 'Discard the unsaved continuation from here')} aria-label={t('Annuler', 'Discard')}>
              <Icon name="close" size={13} />
            </button>}
          </span>
        )}
        {active.map((m) => chip(m))}
        {/* The paused moves, at the end of the row: a chip dragged there is paused. */}
        {(paused.length > 0 || drag) && (
          <span
            ref={pauseRef}
            className={`chip-pause-zone ${drag?.zone === 'paused' ? 'over' : ''} ${paused.length ? '' : 'empty'}`}
            title={t('En pause : pas entraînés (glisser un coup ici pour le mettre en pause)', 'Paused: not trained (drag a move here to pause it)')}
          >
            <Icon name="pause" size={13} />
            {paused.map((m) => chip(m))}
          </span>
        )}
      </div>
    </div>
  );
}
