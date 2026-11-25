/**
 * The chapters of a repertoire to organise (editor, menu of the chapter bar): their order dragged
 * from the grip (saved on release), paused from their switch; a long press (right click with a
 * mouse) on a row offers to rename, move to another repertoire or delete it. A tap opens it.
 * Under the list, a new chapter is named.
 */
import type { Color } from '@e4e5/core';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { api, type ChapterInfo } from '../api';
import { t } from '../i18n';
import { Button, Icon, Switch, plural } from '../ui';
import { MoveChaptersDialog } from './MoveChaptersDialog';
import { useLongPress } from './useLongPress';

export function ChaptersDialog({
  repertoireId,
  color,
  chapters,
  movesOf,
  currentId,
  boardFen,
  run,
  create,
  onSelect,
  onMovedAway,
  onClose,
}: {
  repertoireId: string;
  color: Color;
  chapters: ChapterInfo[];
  movesOf: (chapterId: string) => number;
  currentId: string | undefined;
  /** Position on the board (not the chapter's start): offered as the start of a new chapter. */
  boardFen: string | null;
  /** Runs a change, then reloads the repertoire. */
  run: (change: () => Promise<unknown>) => Promise<unknown>;
  /** Creates a chapter (and opens it). */
  create: (name: string, startFen?: string) => Promise<unknown>;
  onSelect: (chapterId: string) => void;
  /** A chapter went to another repertoire. */
  onMovedAway: (repertoireId: string, chapterId: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const close = () => ref.current?.close();
  // onClose: only its own (React passes on the close of the move dialog opened inside).

  // The order shown: the repertoire's, or the one being dragged (until it is saved).
  const [order, setOrder] = useState<string[] | null>(null);
  useEffect(() => setOrder(null), [chapters]);
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const shown = (order ?? chapters.map((c) => c.id)).flatMap((id) => byId.get(id) ?? []);

  const listRef = useRef<HTMLOListElement>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  /** The order while dragging, for the window listeners (state lags one render behind). */
  const dragOrder = useRef<string[]>([]);
  // Followed on the window: reordering the rows moves them in the page, which ends a pointer capture.
  useEffect(() => {
    if (!dragged) return;
    const move = (e: PointerEvent) => {
      const list = listRef.current;
      if (!list) return;
      const rows = [...list.querySelectorAll<HTMLElement>('[data-id]')].filter((r) => r.dataset.id !== dragged);
      const before = rows.findIndex((r) => {
        const b = r.getBoundingClientRect();
        return e.clientY < b.top + b.height / 2;
      });
      const current = dragOrder.current;
      const next = current.filter((x) => x !== dragged);
      next.splice(before < 0 ? next.length : before, 0, dragged);
      if (next.some((x, i) => x !== current[i])) {
        dragOrder.current = next;
        setOrder(next);
      }
    };
    const end = (e: PointerEvent) => {
      setDragged(null);
      const next = dragOrder.current;
      if (e.type === 'pointerup' && next.some((x, i) => x !== chapters[i]?.id)) void run(() => api.reorderChapters(repertoireId, next));
      else setOrder(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [dragged]);
  /** Props of the grip of chapter `id`: the row follows the pointer across the others. */
  const grip = (id: string) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      dragOrder.current = shown.map((c) => c.id);
      setOrder(dragOrder.current);
      setDragged(id);
    },
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
  });

  const [newName, setNewName] = useState('');
  const [fromBoard, setFromBoard] = useState(false);
  const [creating, setCreating] = useState(false);

  const longPress = useLongPress();
  /** The chapter whose actions are shown (long press), and the one being moved to another repertoire. */
  const [acting, setActing] = useState<ChapterInfo | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [moving, setMoving] = useState<ChapterInfo | null>(null);
  const downOnBackdrop = useRef(false);
  const act = (c: ChapterInfo) => (setConfirming(false), setActing(c));

  return (
    <dialog ref={ref} className="game-detail chapters-dialog" onClose={(e) => e.target === e.currentTarget && onClose()} onClick={(e) => e.target === ref.current && !acting && !moving && close()}>
      <div className="game-detail-content stack">
        <p className="move-actions-title"><strong>{t('Chapitres', 'Chapters')}</strong></p>
        {shown.length > 0 && <p className="muted small-text">
          {t(
            'Glissez la poignée pour changer l’ordre. Appui long (clic droit) sur un chapitre : renommer, déplacer, supprimer.',
            'Drag the handle to change the order. Long press (right click) on a chapter: rename, move, delete.',
          )}
        </p>}
        <ol className="chapters-list" ref={listRef}>
          {shown.map((c, i) => (
            <li
              key={c.id}
              data-id={c.id}
              className={`chapters-row ${c.id === currentId ? 'on' : ''} ${c.active ? '' : 'paused'} ${dragged === c.id ? 'dragging' : ''}`}
              onClick={() => (onSelect(c.id), close())}
              {...longPress(() => act(c))}
            >
              <span className="grip" title={t('Glisser pour changer l’ordre', 'Drag to change the order')} {...grip(c.id)}>
                <Icon name="grip" size={16} />
              </span>
              <span className="chapter-num">{i + 1}</span>
              <span className="chapter-title">{c.name}</span>
              <span className="muted small-text">{plural(movesOf(c.id), t('coup', 'move'), t('coups', 'moves'))}</span>
              <span onClick={(e) => e.stopPropagation()}>
                <Switch
                  on={c.active}
                  onChange={() => void run(() => api.setChapterActive(c.id, !c.active))}
                  label={c.active ? t(`Mettre ${c.name} en pause`, `Pause ${c.name}`) : t(`Reprendre ${c.name}`, `Resume ${c.name}`)}
                />
              </span>
            </li>
          ))}
        </ol>
        {/* A new chapter: named here, from the initial position or (box ticked) the board's. */}
        <form
          className="chapters-new"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newName.trim();
            if (!name || creating) return;
            setCreating(true);
            create(name, fromBoard && boardFen ? boardFen : undefined)
              .then(() => {
                setNewName('');
                setFromBoard(false);
                // The new chapter, last of the list: in view.
                requestAnimationFrame(() => listRef.current?.lastElementChild?.scrollIntoView({ block: 'nearest' }));
              })
              .catch(() => {})
              .finally(() => setCreating(false));
          }}
        >
          <div className="form-row">
            <input
              placeholder={t('Nouveau chapitre', 'New chapter')}
              aria-label={t('Nom du nouveau chapitre', 'Name of the new chapter')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Button type="submit" icon="plus" disabled={!newName.trim() || creating}>{t('Ajouter', 'Add')}</Button>
          </div>
          {boardFen && (
            <label className="check small-text">
              <input type="checkbox" checked={fromBoard} onChange={(e) => setFromBoard(e.target.checked)} />{' '}
              {t('À partir de la position de l’échiquier', 'From the position on the board')}
            </label>
          )}
        </form>
        <div className="row move-actions-footer">
          <Button variant="primary" onClick={close}>{t('Fermer', 'Close')}</Button>
        </div>
      </div>

      {/* The actions of a chapter (long press), over the list. */}
      {acting && (
        <div
          className="chapters-actions"
          // Closed by a press started on the backdrop: not by the click ending the long press.
          onPointerDown={(e) => (downOnBackdrop.current = e.target === e.currentTarget)}
          onClick={(e) => {
            if (e.target === e.currentTarget && downOnBackdrop.current) setActing(null);
            downOnBackdrop.current = false;
          }}
        >
          <div className="game-detail-content stack">
            <p className="move-actions-title"><strong>{acting.name}</strong></p>
            {!confirming ? (
              <div className="move-actions-list">
                <button
                  type="button"
                  className="move-action"
                  onClick={() => {
                    const name = prompt(t('Nouveau nom', 'New name'), acting.name)?.trim();
                    if (name && name !== acting.name) void run(() => api.renameChapter(acting.id, name));
                    setActing(null);
                  }}
                >
                  <Icon name="pencil" size={18} /> {t('Renommer', 'Rename')}
                </button>
                <button type="button" className="move-action" onClick={() => (setMoving(acting), setActing(null))}>
                  <Icon name="book" size={18} /> {t('Déplacer vers un autre répertoire…', 'Move to another repertoire…')}
                </button>
                <button type="button" className="move-action danger" onClick={() => setConfirming(true)}>
                  <Icon name="close" size={18} /> {t('Supprimer', 'Delete')}
                </button>
              </div>
            ) : (
              <p>{t(`Supprimer le chapitre et ses ${plural(movesOf(acting.id), 'coup', 'coups')} ?`, `Delete the chapter and its ${plural(movesOf(acting.id), 'move', 'moves')}?`)}</p>
            )}
            <div className="row move-actions-footer">
              <Button variant="ghost" onClick={() => setActing(null)}>{t('Annuler', 'Cancel')}</Button>
              {confirming && (
                <Button
                  variant="danger"
                  onClick={() => {
                    void run(() => api.deleteChapter(acting.id));
                    setActing(null);
                  }}
                >
                  {t('Supprimer', 'Delete')}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
      {moving && (
        <MoveChaptersDialog
          chapterIds={[moving.id]}
          color={color}
          from={repertoireId}
          onMoved={(to) => (moving.id === currentId ? onMovedAway(to, moving.id) : undefined)}
          onClose={() => setMoving(null)}
        />
      )}
    </dialog>
  );
}
