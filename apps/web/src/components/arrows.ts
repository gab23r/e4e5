import { t } from '../i18n';

/**
 * Arrow colours on the board. The same colours mark the moves around the board (repertoire
 * moves, moves to complete, engine line: see --rep, --hole, --engine in styles.css), which
 * acts as the legend.
 */
export const ARROWS = {
  repertoire: { color: '#3a9a62', label: t('dans votre répertoire', 'in your repertoire') },
  next: { color: '#3a9a62', label: t('coup suivant (→)', 'next move (→)') },
  nextDraft: { color: '#f0883e', label: t('coup suivant, pas encore enregistré (→)', 'next move, not saved yet (→)') },
  popular: { color: '#f0883e', label: t('coup manquant : joué souvent, pas encore dans votre répertoire', 'missing move: often played, not in your repertoire yet') },
  // Dark grey: the blues are taken (?! light blue), and it stands out from every other colour.
  engine: { color: '#2b2b2b', label: t('meilleur coup du moteur', 'best engine move') },
  level: { color: '#bc8cff', label: t('meilleur coup à votre niveau', 'best move at your level') },
  // Same green as the paused move in the list (--rep, faded there too), almost transparent.
  paused: { color: '#5cb380', label: t('en pause, pas entraîné', 'paused, not trained') },
  pausedNext: { color: '#5cb380', label: t('coup suivant, en pause (→)', 'next move, paused (→)') },
  played: { color: '#f0883e', label: t('coup joué à la place, à l’entraînement', 'move played instead, in training') },
  mistake: { color: '#e5534b', label: t('coup joué à la place du coup préparé', 'move played instead of the prepared move') },
} as const;

export type ArrowKind = keyof typeof ARROWS;

const OPACITY: Partial<Record<string, number>> = { next: 1, nextDraft: 1, paused: 0.25, pausedNext: 0.4 };

/** chessground brushes for the arrow kinds. */
export const BRUSHES = {
  ...Object.fromEntries(
    Object.entries(ARROWS).map(([key, a]) => [key, { key, color: a.color, opacity: OPACITY[key] ?? 0.85, lineWidth: 10 }]),
  ),
  /** Review, a new move to learn: my other moves here already learnt, very light green. */
  learned: { key: 'learned', color: '#a8e6bc', opacity: 0.7, lineWidth: 10 },
  /** White arrow drawn just under the next move, slightly wider: a thin outline. */
  outline: { key: 'outline', color: '#ffffff', opacity: 1, lineWidth: 10 },
};

/** Extra width (chessground lineWidth units) of the outline around the next move. */
export const OUTLINE_EXTRA = 1.3;
