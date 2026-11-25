/**
 * Moves chapters to another repertoire of their colour, or to a new one: to group chapters into
 * repertoires (like the chapters of a Lichess study). The training progress stays (the cards
 * belong to the positions, not to the repertoires).
 */
import type { Color } from '@e4e5/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { Button, plural } from '../ui';

const NEW = 'new';

export function MoveChaptersDialog({
  chapterIds,
  color,
  from,
  onMoved,
  onClose,
}: {
  chapterIds: string[];
  color: Color;
  /** The repertoire of the chapters, not offered (when they are all in one). */
  from?: string;
  onMoved: (repertoireId: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const close = () => ref.current?.close();
  const qc = useQueryClient();
  const reps = useQuery({ queryKey: ['repertoires'], queryFn: api.repertoires });
  const targets = (reps.data ?? []).filter((r) => r.color === color && r.id !== from);
  const [newName, setNewName] = useState('');
  /** The repertoire picked, or NEW (a new one, named in the field). */
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    // Nothing to pick: straight to the new repertoire.
    if (reps.data && !targets.length) setTarget(NEW);
  }, [reps.data, targets.length]);
  const move = useMutation({
    mutationFn: async (target: { id: string } | { name: string }) => {
      const id = 'id' in target ? target.id : (await api.createRepertoire(target.name, color)).id;
      await api.moveChapters(chapterIds, id);
      return id;
    },
    onSuccess: async (id) => {
      for (const key of ['repertoire', 'training-summary', 'gaps', 'games-report']) void qc.invalidateQueries({ queryKey: [key] });
      await qc.invalidateQueries({ queryKey: ['repertoires'] });
      onMoved(id);
      close();
    },
  });
  const ready = !move.isPending && (target === NEW ? !!newName.trim() : !!target);
  const submit = () => {
    if (!ready) return;
    move.mutate(target === NEW ? { name: newName.trim() } : { id: target! });
  };
  return (
    <dialog
      ref={ref}
      className="game-detail move-actions-dialog"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && close()}
    >
      <div className="game-detail-content stack">
        <p className="move-actions-title">
          <strong>
            {t(
              `Déplacer ${plural(chapterIds.length, 'chapitre', 'chapitres')} vers…`,
              `Move ${plural(chapterIds.length, 'chapter', 'chapters')} to…`,
            )}
          </strong>
        </p>
        {/* Pick a repertoire, or name a new one; one button moves the chapters in both cases. */}
        <div className="move-actions-list" role="radiogroup">
          {targets.map((r) => (
            <label key={r.id} className={`move-target ${target === r.id ? 'on' : ''}`}>
              <input type="radio" name="move-target" checked={target === r.id} onChange={() => setTarget(r.id)} />
              <span className="move-target-name">{r.name}</span>
              <span className="muted small-text">{t(plural(r.chapters?.length ?? 0, 'chapitre', 'chapitres'), plural(r.chapters?.length ?? 0, 'chapter', 'chapters'))}</span>
            </label>
          ))}
          <label className={`move-target ${target === NEW ? 'on' : ''}`}>
            <input type="radio" name="move-target" checked={target === NEW} onChange={() => setTarget(NEW)} />
            <input
              className="move-target-new"
              placeholder={t('Nouveau répertoire', 'New repertoire')}
              aria-label={t('Nom du nouveau répertoire', 'Name of the new repertoire')}
              value={newName}
              onFocus={() => setTarget(NEW)}
              onChange={(e) => (setNewName(e.target.value), setTarget(NEW))}
              onKeyDown={(e) => e.key === 'Enter' && ready && submit()}
            />
          </label>
        </div>
        {move.error && <p className="error small-text">{move.error.message}</p>}
        <div className="row move-actions-footer">
          <Button variant="ghost" onClick={close}>{t('Annuler', 'Cancel')}</Button>
          <Button variant="primary" disabled={!ready} onClick={submit}>
            {target === NEW ? t('Créer et déplacer', 'Create and move') : t('Déplacer', 'Move')}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
