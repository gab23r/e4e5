/**
 * Points faibles: my learnt moves I may forget (estimated recall under 90 %) or already forgot, the
 * most fragile first. Shown on the Entraîner page (formerly the "training" half of Lacunes).
 */
import { recallOf, type RepMove, type TrainingPosition } from '@e4e5/core';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RepertoireSummary, ReviewCard } from '../api';
import { MiniBoard, type MiniArrow } from '../components/MiniBoard';
import { San } from '../components/Nag';
import { lineText } from './common';
import type { Source } from './useTrainingSources';
import { t } from '../i18n';
import { Button, plural } from '../ui';

const PAGE = 10;
const pct = (x: number) => t(`${Math.round(100 * x)} %`, `${Math.round(100 * x)}%`);

/** One of my learnt moves I struggle with: estimated recall under 90 %, or forgotten at least once. */
interface WeakMove {
  move: RepMove;
  recall: number;
  lapses: number;
}

/**
 * A position of my training with weak moves. Only the learnt moves count: another move of the
 * position not learnt yet (an alternative) is to learn, not a gap, and playing an alternative in
 * training is never a mistake.
 */
export interface Fragile {
  source: Source;
  position: TrainingPosition;
  weak: WeakMove[];
  /** The weakest of them. */
  recall: number;
  lapses: number;
}

/** The weak learnt moves of a position (recall computed now from the FSRS card). */
function weakMoves(source: Source, fen: string, now: Date): WeakMove[] {
  return source.rep.movesAt(fen).flatMap((move) => {
    const card: ReviewCard | undefined = source.cardOf(fen, move.uci);
    if (!card) return [];
    const recall = card.fsrs ? recallOf(card.fsrs, card.reps, now) : card.recall;
    return recall < 0.9 || card.lapses > 0 ? [{ move, recall, lapses: card.lapses }] : [];
  });
}

/** The fragile positions of the sources, the weakest first (a position in several repertoires once). */
export function useFragile(sources: Source[]): Fragile[] {
  return useMemo(() => {
    const now = new Date();
    const seen = new Set<string>();
    const out: Fragile[] = [];
    for (const source of sources) {
      for (const position of source.positions) {
        if (seen.has(position.fen)) continue;
        const weak = weakMoves(source, position.fen, now);
        if (!weak.length) continue;
        seen.add(position.fen);
        out.push({ source, position, weak, recall: Math.min(...weak.map((w) => w.recall)), lapses: Math.max(...weak.map((w) => w.lapses)) });
      }
    }
    // The weakest first: lowest recall, then the most forgotten.
    return out.sort((a, b) => a.recall - b.recall || b.lapses - a.lapses);
  }, [sources]);
}

/** The list of the fragile positions, 10 at a time. */
export function WeakPoints({ sources, reps }: { sources: Source[]; reps: Map<string, RepertoireSummary> }) {
  const fragile = useFragile(sources);
  const [shown, setShown] = useState(PAGE);
  return (
    <section className="stack">
      <h3>{t(`Points faibles (${fragile.length})`, `Weak points (${fragile.length})`)}</h3>
      <p className="muted small-text" style={{ margin: 0 }}>
        {fragile.length
          ? t(
              'Vos coups appris que vous risquez d’oublier (mémorisation estimée sous 90 %) ou déjà oubliés, les plus fragiles d’abord.',
              'Your learnt moves you may forget (estimated recall under 90%) or already forgot, the most fragile first.',
            )
          : t('Aucun : chaque coup appris a une mémorisation estimée d’au moins 90 %.', 'None: every learnt move has an estimated recall of at least 90%.')}
      </p>
      {fragile.slice(0, shown).map((f) => (
        <FragileCard key={`${f.source.id}|${f.position.fen}`} fragile={f} rep={reps.get(f.source.id)} />
      ))}
      {fragile.length > shown && (
        <Button variant="ghost" onClick={() => setShown(shown + PAGE)}>
          {t('Voir plus', 'Show more')} ({fragile.length - shown})
        </Button>
      )}
    </section>
  );
}

/** A fragile position of my training: thumbnail with its weak moves, recall, and where to work on it. */
function FragileCard({ fragile, rep }: { fragile: Fragile; rep: RepertoireSummary | undefined }) {
  const { source, position, weak } = fragile;
  const arrows: MiniArrow[] = weak.map((w) => ({ uci: w.move.uci, kind: 'repertoire' }));
  const fen = encodeURIComponent(position.fen);
  const explorer = `/explorer?${new URLSearchParams({ ...(position.path.length ? { line: position.path.map((m) => m.uci).join(',') } : {}), ...(source.color === 'black' ? { color: 'black' } : {}) })}`;
  const memo = (w: WeakMove) =>
    t(
      `${pct(w.recall)} de mémorisation${w.lapses > 0 ? ` · oublié ${plural(w.lapses, 'fois', 'fois')}` : ''}`,
      `${pct(w.recall)} recall${w.lapses > 0 ? ` · forgotten ${plural(w.lapses, 'time', 'times')}` : ''}`,
    );
  return (
    <article className="card game-card">
      <Link to={`/r/${source.id}?fen=${fen}`} className="thumb-button" aria-label={t('Voir dans le répertoire', 'See in the repertoire')}>
        <MiniBoard fen={position.fen} orientation={source.color} arrows={arrows} />
      </Link>
      <div className="game-card-body">
        <div className="inbox-head">
          <span className="muted inbox-line">{lineText(position.path) || t('Position initiale', 'Starting position')} </span>
          <span className="hole-move">
            {weak.map((w, i) => (
              <span key={w.move.uci}>
                {i > 0 && t(' et ', ' and ')}
                <San san={w.move.san} nags={w.move.nags} />
              </span>
            ))}
          </span>
        </div>
        <div className="row small-text game-card-meta">
          <span className="rep-tag">
            <span className={`dot ${source.color}`} /> {rep?.name ?? source.name}
          </span>
          <span className="muted">
            {weak.length === 1 ? memo(weak[0]!) : weak.map((w) => t(`${w.move.san} : ${memo(w)}`, `${w.move.san}: ${memo(w)}`)).join(' · ')}
          </span>
        </div>
        <div className="row inbox-actions">
          <Button size="sm" variant="primary" to={`/r/${source.id}/train?mode=review&from=${fen}`} title={t('S’entraîner sur cette position et la suite de la ligne', 'Train on this position and the rest of the line')}>
            {t('S’entraîner', 'Train')}
          </Button>
          <Button size="sm" to={`/r/${source.id}?fen=${fen}`} title={t('Voir dans l’éditeur du répertoire', 'See in the repertoire editor')}>
            {t('Répertoire', 'Repertoire')}
          </Button>
          <Button size="sm" variant="ghost" icon="compass" to={explorer} title={t('Voir cette position dans l’Explorer (statistiques, moteur, vos répertoires)', 'See this position in Explore (statistics, engine, your repertoires)')}>
            {t('Explorer', 'Explore')}
          </Button>
        </div>
      </div>
    </article>
  );
}
