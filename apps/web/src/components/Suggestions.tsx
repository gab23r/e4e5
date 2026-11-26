import type { Gap } from '../api';
import { moveText } from '../chessText';
import { fmt, t } from '../i18n';
import { Icon } from '../ui';

const pct = (x: number) => `${fmt(100 * x, { maximumFractionDigits: x < 0.1 ? 1 : 0 })}${t(' %', '%')}`;

/**
 * "Coups manquants" of the position on the board (the orange arrows): the frequent opponent moves
 * the repertoire does not answer here, most frequent first. Tapping one plays it, ready to prepare
 * the answer; the cross ignores it (not worth preparing). Shown only where there are some.
 */
export function Suggestions({ gaps, onOpen, onIgnore }: { gaps: Gap[]; onOpen: (ucis: string[]) => void; onIgnore?: (gap: Gap) => void }) {
  if (!gaps.length) return null;
  return (
    <section className="panel suggestions">
      <h3>{gaps.length > 1 ? t('Coups manquants ici', 'Missing moves here') : t('Coup manquant ici', 'Missing move here')}</h3>
      <ul className="suggestion-list">
        {gaps.map((g) => (
          <li key={`${g.fen}|${g.move?.uci ?? ''}`} className="suggestion-row">
            <button className="suggestion" onClick={() => onOpen(g.move ? [...g.ucis, g.move.uci] : g.ucis)}>
              <span className="line">
                <span className="hole-move">{g.move ? moveText(g.line, g.move.san) : t('— votre réponse ?', '— your answer?')}</span>
              </span>
              <span className="freq" title={t('Part des parties à votre niveau', 'Share of the games at your level')}>{pct(g.prob)}</span>
            </button>
            {onIgnore && (
              <button
                className="ignore-gap"
                title={t('Ignorer ce coup manquant (pas la peine de le préparer)', 'Ignore this missing move (not worth preparing)')}
                aria-label={t('Ignorer', 'Ignore')}
                onClick={() => onIgnore(g)}
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
