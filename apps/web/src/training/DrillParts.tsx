/**
 * What sits under the board in both training modes ("Réviser" and "Se tester"), so that they
 * look and work the same: the line of the quiz, the swipe bar, the end-of-line badge and the
 * Indice / Solution and Explorer buttons.
 */
import type { Color, RepMove } from '@e4e5/core';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useLayoutEffect, useRef } from 'react';
import { San } from '../components/Nag';
import { t } from '../i18n';
import { Icon } from '../ui';

/** Dots of the trail shown left of the swipe bar, the latest ones (older ones: "+N"). */
const MAX_DOTS = 10;

/** How a line of the session ended: right, wrong (a move missed or shown), new (learnt), passed. */
export type TrailResult = 'right' | 'wrong' | 'new' | 'passed';
export interface TrailDot {
  id: number;
  result: TrailResult;
}
const TRAIL_LABELS: Record<TrailResult, string> = t(
  { right: 'réussie', wrong: 'ratée', new: 'apprise', passed: 'passée' },
  { right: 'right', wrong: 'missed', new: 'learnt', passed: 'skipped' },
);

/**
 * The quiz's line (`moves`, the first one at ply `firstPly`), annotations in colour, on one line:
 * kept scrolled to its end, its beginning fading out when too long.
 */
export function QuizLine({ moves, firstPly }: { moves: RepMove[]; firstPly: number }) {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const e = el.current;
    if (!e) return;
    e.scrollLeft = e.scrollWidth;
    e.classList.toggle('cut', e.scrollWidth > e.clientWidth);
  });
  return (
    <div ref={el} className="quiz-line" aria-label={t('Ligne du quiz', 'Quiz line')}>
      <span>
        {moves.map((m, k) => {
          const ply = firstPly + k;
          const num = ply % 2 === 0 ? `${ply / 2 + 1}. ` : k === 0 ? `${(ply + 1) / 2}… ` : '';
          return (
            <span key={ply} className="quiz-move">
              {num && <span className="muted">{num}</span>}
              <San san={m.san} nags={m.nags} />
            </span>
          );
        })}
      </span>
    </div>
  );
}

/**
 * The bar under the board to swipe on (like Android's gesture bar): its handle follows the finger;
 * to the left past a threshold: `onSkip`; to the right: `onBack` when `canBack`.
 *
 * With a trail (the review): the lines of the session are dots (green right, red a move missed,
 * grey passed, hollow learnt), browsed like back / forward. In the training, they are all left
 * of the handle. Browsing (`browsing`, the line `viewing` on the board, its colour on the handle):
 * the lines before it on the left, the ones after it on the right, then the training's dot. A tap
 * on a dot opens that line (`onOpen`), on the training's dot goes back to it (`onTraining`). With
 * a trail, the bar shows on every screen (the handle and its hint: touch screens only).
 */
export function SwipeBar({
  onSkip,
  onBack,
  canBack = false,
  label = t('passer', 'skip'),
  browsing = false,
  before = [],
  after = [],
  viewing,
  onOpen,
  onTraining,
  hint: hintText,
}: {
  onSkip: () => void;
  onBack?: () => void;
  canBack?: boolean;
  label?: string;
  browsing?: boolean;
  before?: TrailDot[];
  after?: TrailDot[];
  viewing?: TrailDot;
  onOpen?: (id: number) => void;
  onTraining?: () => void;
  /** Text under the handle instead of the usual one. */
  hint?: string;
}) {
  const handle = useRef<HTMLSpanElement>(null);
  const swipe = useRef<{ x: number; y: number; axis: 'x' | 'y' | null } | null>(null);
  const back = canBack && !!onBack;
  const slide = (dx: number) => {
    const el = handle.current;
    if (!el) return;
    el.style.transition = dx ? 'none' : 'transform 0.15s';
    el.style.transform = dx ? `translateX(${dx}px)` : '';
  };
  const end = (e: React.TouchEvent<HTMLDivElement>) => {
    const s = swipe.current;
    swipe.current = null;
    slide(0);
    const t = e.changedTouches[0];
    if (!s || !t || s.axis !== 'x' || e.type === 'touchcancel') return;
    const dx = t.clientX - s.x;
    const threshold = Math.max(50, e.currentTarget.getBoundingClientRect().width * 0.25);
    if (-dx > threshold) onSkip();
    else if (dx > threshold && back) onBack!();
  };
  const dot = (d: TrailDot) => (
    <button
      key={d.id}
      type="button"
      className={`trail-dot ${d.result}`}
      title={t(
        `Ligne ${TRAIL_LABELS[d.result]} — la revoir depuis le début (pas compté)`,
        `Line ${TRAIL_LABELS[d.result]}: replay it from the start (not counted)`,
      )}
      aria-label={t(`Revoir la ligne ${TRAIL_LABELS[d.result]}`, `Replay the ${TRAIL_LABELS[d.result]} line`)}
      onClick={() => onOpen?.(d.id)}
    >
      <span />
    </button>
  );
  const hint = hintText ?? (browsing
    ? back
      ? t('← suivante · précédente →', '← next · previous →')
      : t('← suivante', '← next')
    : back
      ? t(`← ${label} · revenir →`, `← ${label} · back →`)
      : t(`← balayez pour ${label}`, `← swipe to ${label}`));
  return (
    <div
      className={`swipe-bar${before.length || browsing ? ' has-trail' : ''}`}
      onTouchStart={(e) => {
        const t = e.touches[0];
        swipe.current = t && e.touches.length === 1 ? { x: t.clientX, y: t.clientY, axis: null } : null;
      }}
      onTouchMove={(e) => {
        const s = swipe.current;
        const t = e.touches[0];
        if (!s || !t) return;
        const dx = t.clientX - s.x;
        const dy = t.clientY - s.y;
        if (!s.axis) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        }
        // To the left: next; to the right: back (if any, else it gives a little).
        if (s.axis === 'x') slide(dx < 0 || back ? dx : dx / 6);
      }}
      onTouchEnd={end}
      onTouchCancel={end}
      title={hint}
    >
      {before.length > 0 && (
        <span className="swipe-trail before" aria-label={t('Lignes précédentes', 'Previous lines')}>
          {before.length > MAX_DOTS && <span className="more">+{before.length - MAX_DOTS}</span>}
          {before.slice(-MAX_DOTS).map(dot)}
        </span>
      )}
      <span ref={handle} className={`swipe-handle${viewing ? ` ${viewing.result}` : ''}`} aria-hidden="true" />
      {browsing && (
        <span className="swipe-trail after" aria-label={t('Lignes suivantes', 'Next lines')}>
          {after.slice(0, MAX_DOTS).map(dot)}
          {after.length > MAX_DOTS && <span className="more">+{after.length - MAX_DOTS}</span>}
          <button type="button" className="trail-dot training" title={t('Revenir à l’entraînement en cours', 'Back to the current training')} aria-label={t('Revenir à l’entraînement en cours', 'Back to the current training')} onClick={onTraining}>
            <span />
          </button>
        </span>
      )}
      <span className="swipe-label muted">{hint}</span>
    </div>
  );
}

/** End of a line, before the next one: the board glows, a frosted pill with a check. */
export function LineDone({ text }: { text: string }) {
  return (
    <div className="line-done" role="status">
      <svg viewBox="0 0 52 52" aria-hidden="true">
        <circle cx="26" cy="26" r="23" />
        <path d="M15 27l7 7 15-16" />
      </svg>
      <span>{text}</span>
    </div>
  );
}

/**
 * The actions under the board: the line before (as a swipe to the right), one button for the
 * piece to move (Indice) then the solution, the next line (as a swipe to the left), and the
 * position in the repertoire.
 */
export function DrillActions({
  hinted,
  disabled,
  solutionTitle,
  onHint,
  onBack,
  canBack = false,
  onNext,
  repertoireTo,
}: {
  /** The piece is shown (or the answer): the button gives the solution. */
  hinted: boolean;
  disabled: boolean;
  solutionTitle: string;
  onHint: () => void;
  onBack?: () => void;
  canBack?: boolean;
  onNext?: () => void;
  /** The position in the repertoire editor. */
  repertoireTo?: string;
}) {
  const navigate = useNavigate();
  return (
    <div className="play-actions">
      {onBack && (
        <button type="button" onClick={onBack} disabled={!canBack} title={t('Ligne précédente', 'Previous line')}>
          <Icon name="back" size={24} />
          {t('Précédente', 'Previous')}
        </button>
      )}
      <button type="button" onClick={onHint} disabled={disabled} title={hinted ? solutionTitle : t('Montrer la pièce à jouer', 'Show the piece to move')}>
        <Icon name={hinted ? 'flag' : 'bulb'} size={24} />
        {hinted ? t('Solution', 'Solution') : t('Indice', 'Hint')}
      </button>
      {onNext && (
        <button type="button" onClick={onNext} title={t('Ligne suivante (celle-ci est reposée plus tard)', 'Next line (this one is asked again later)')}>
          <Icon name="chevron" size={24} />
          {t('Suivante', 'Next')}
        </button>
      )}
      {repertoireTo && (
        <button type="button" onClick={() => navigate(repertoireTo)} title={t('Ouvrir cette position dans votre répertoire', 'Open this position in your repertoire')}>
          <Icon name="book" size={24} />
          {t('Répertoire', 'Repertoire')}
        </button>
      )}
    </div>
  );
}

/**
 * My moves in a position in all my repertoires of `color` (not only the one trained): a move of
 * another repertoire played in training is right too (an alternative), not a mistake. Fetched
 * with the question (same data as the Explorer's "in your repertoires").
 */
export function useMyMovesHere(fen: string | undefined, color: Color) {
  const q = useQuery({ queryKey: ['explorer-reps', fen], queryFn: () => api.chapterMovesAt(fen!), enabled: !!fen, staleTime: 60_000 });
  return (uci: string) => q.data?.find((r) => r.uci === uci && r.color === color && !r.paused);
}
