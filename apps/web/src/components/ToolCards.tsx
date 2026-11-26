/**
 * The analysis under the board (one button turns it on): the moves of Lichess players at my level
 * with Stockfish's evaluation of the moves shown (ExplorerPanel, Éval column).
 */
import { useState } from 'react';
import { t } from '../i18n';
import { Icon } from '../ui';

/**
 * On/off of the analysis (both tools), kept for the browser session only: the search at my level
 * costs many Lichess requests, so it never starts by itself on a new visit.
 */
export function useAnalysisToggle() {
  const [on, setOn] = useState(() => sessionStorage.getItem('analysis') === 'on');
  const toggle = (next: boolean) => {
    sessionStorage.setItem('analysis', next ? 'on' : 'off');
    setOn(next);
  };
  return [on, toggle] as const;
}

/** The analysis button, next to the board navigation. */
export function AnalysisToggle({ enabled, onToggle }: { enabled: boolean; onToggle: (on: boolean) => void }) {
  return (
    <button
      className={`analysis-toggle ${enabled ? 'on' : ''}`}
      onClick={() => onToggle(!enabled)}
      title={
        enabled
          ? t('Arrêter l’analyse (a)', 'Stop the analysis (a)')
          : t('Analyser : coups des joueurs Lichess à votre niveau et Stockfish (a)', 'Analyse: moves of Lichess players at your level and Stockfish (a)')
      }
      aria-label={enabled ? t('Arrêter l’analyse', 'Stop the analysis') : t('Analyser la position', 'Analyse the position')}
      aria-pressed={enabled}
    >
      <Icon name="analysis" />
    </button>
  );
}
