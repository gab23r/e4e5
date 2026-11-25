/**
 * The chapters of the repertoire open in the editor, above the board, as in a Lichess study: one
 * is open at a time (its moves are on the board), picked in a select; the edit button opens the
 * dialog organising them (order, pause, rename, move, delete, new chapter).
 */
import type { Color } from '@e4e5/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type ChapterInfo, type StoredMove } from '../api';
import { t } from '../i18n';
import { Button, plural } from '../ui';
import { ChaptersDialog } from './ChaptersDialog';

export function ChapterBar({
  repertoireId,
  color,
  chapters,
  moves,
  current,
  boardFen,
  onSelect,
  onMovedAway,
}: {
  repertoireId: string;
  color: Color;
  chapters: ChapterInfo[];
  moves: StoredMove[];
  current: ChapterInfo | undefined;
  /** Position on the board (not the chapter's start): offered as the start of a new chapter. */
  boardFen: string | null;
  onSelect: (id: string) => void;
  /** The open chapter went to another repertoire. */
  onMovedAway: (repertoireId: string, chapterId: string) => void;
}) {
  const qc = useQueryClient();
  const [organizing, setOrganizing] = useState(false);
  const count = new Map<string, number>();
  for (const m of moves) count.set(m.chapterId, (count.get(m.chapterId) ?? 0) + 1);
  /** The repertoire reloaded (awaited), what depends on it recomputed in the background. */
  const refresh = async () => {
    for (const key of ['repertoires', 'training-summary', 'gaps', 'games-report']) void qc.invalidateQueries({ queryKey: [key] });
    await qc.invalidateQueries({ queryKey: ['repertoire', repertoireId] });
  };
  const change = useMutation({ mutationFn: (run: () => Promise<unknown>) => run(), onSuccess: refresh });
  const create = useMutation({
    mutationFn: ({ name, startFen }: { name: string; startFen?: string }) =>
      api.createChapters(repertoireId, [{ name, ...(startFen ? { pgn: `[FEN "${startFen}"]\n[SetUp "1"]\n\n*` } : {}) }]),
    onSuccess: async ([created]) => {
      await refresh();
      if (created) onSelect(created.chapter.id);
    },
  });
  const optionLabel = (c: ChapterInfo, i: number) =>
    `${i + 1}. ${c.name} · ${plural(count.get(c.id) ?? 0, t('coup', 'move'), t('coups', 'moves'))}${c.active ? '' : t(' · en pause', ' · paused')}`;

  return (
    <div className="chapter-bar">
      {chapters.length ? (
        <select
          className={current?.active === false ? 'paused' : ''}
          aria-label={t('Chapitre', 'Chapter')}
          value={current?.id ?? ''}
          onChange={(e) => onSelect(e.target.value)}
        >
          {chapters.map((c, i) => (
            <option key={c.id} value={c.id}>{optionLabel(c, i)}</option>
          ))}
        </select>
      ) : (
        <span className="muted small-text">{t('Ce répertoire n’a pas encore de chapitre.', 'This repertoire has no chapter yet.')}</span>
      )}
      {chapters.length ? (
        <Button variant="ghost" icon="pencil" title={t('Modifier les chapitres', 'Edit the chapters')} onClick={() => setOrganizing(true)} />
      ) : (
        <Button size="sm" variant="primary" icon="plus" onClick={() => setOrganizing(true)}>{t('Nouveau chapitre', 'New chapter')}</Button>
      )}
      {change.error && <p className="error small-text">{change.error.message}</p>}
      {organizing && (
        <ChaptersDialog
          repertoireId={repertoireId}
          color={color}
          chapters={chapters}
          movesOf={(id) => count.get(id) ?? 0}
          currentId={current?.id}
          boardFen={boardFen}
          run={(run) => change.mutateAsync(run)}
          create={(name, startFen) => create.mutateAsync({ name, startFen })}
          onSelect={onSelect}
          onMovedAway={onMovedAway}
          onClose={() => setOrganizing(false)}
        />
      )}
    </div>
  );
}
