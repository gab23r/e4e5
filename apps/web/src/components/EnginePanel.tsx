import { formatScore, type Color, type EngineLine, type PlayedMove } from '@e4e5/core';
import type { ReactNode } from 'react';
import { t } from '../i18n';

/** On/off button of the engine, next to the board navigation. */
/**
 * Engine lines under the board: evaluation and principal variation; tap a move to play the line
 * up to it. Nothing when the engine is off.
 */
export function EngineLines({
  enabled,
  lines,
  depth,
  maxDepth,
  firstMoveNumber,
  onPlay,
  note,
}: {
  enabled: boolean;
  lines: EngineLine[];
  depth: number;
  maxDepth: number;
  /** Ply count of the analysed position (for move numbers). */
  firstMoveNumber: number;
  onPlay: (moves: PlayedMove[]) => void;
  /** A short note on the depth line, before it (e.g. no Lichess statistics here). */
  note?: ReactNode;
}) {
  if (!enabled) return null;
  // Always 3 rows of one line each, so the block keeps the same height while the engine thinks.
  const placeholders = Math.max(0, 3 - lines.length);
  return (
    <div className="engine-lines">
      {lines.slice(0, 3).map((l) => (
        <div key={l.multipv} className={`engine-line ${l.multipv === 1 ? 'best' : ''}`} title={l.multipv === 1 ? t('Meilleure ligne (flèche bleue)', 'Best line (blue arrow)') : undefined}>
          <span className={`eval ${('mate' in l.score ? l.score.mate : l.score.cp) >= 0 ? 'w' : 'b'}`}>{formatScore(l.score)}</span>
          <span className="pv">
            {l.pv.slice(0, 10).map((m, i) => {
              const ply = firstMoveNumber + i;
              const num = ply % 2 === 0 ? `${ply / 2 + 1}. ` : i === 0 ? `${(ply + 1) / 2}… ` : '';
              return (
                <button key={i} className="link" onClick={() => onPlay(l.pv.slice(0, i + 1))} title={t('Jouer jusqu’à ce coup', 'Play up to this move')}>
                  {num}
                  {m.san}
                </button>
              );
            })}
          </span>
        </div>
      ))}
      {Array.from({ length: placeholders }, (_, i) => (
        <div key={`p${i}`} className="engine-line placeholder">
          <span className="eval">…</span>
          <span className="pv muted">{i === 0 && lines.length === 0 ? t('Stockfish réfléchit…', 'Stockfish is thinking…') : ''}</span>
        </div>
      ))}
      <div className="engine-depth muted">
        {note}
        {note && ' · '}
        Stockfish 19 · {t('profondeur', 'depth')} {depth}/{maxDepth}
      </div>
    </div>
  );
}

/**
 * Share of the bar for White (0-1) for an evaluation from White's side: Lichess's curve
 * (winning chances from centipawns); a mate fills it.
 */
function whiteShare(score: EngineLine['score']): number {
  if ('mate' in score) return score.mate > 0 ? 1 : 0;
  return 1 / (1 + Math.exp(-0.00368208 * score.cp));
}

/**
 * Evaluation bar left of the board (engine on): White's part from White's side of the board
 * (bottom when the board is seen from White), the score written at the end of the side ahead.
 * Neutral until the engine has a line; `off`: an empty slot keeping the board's size.
 */
/**
 * The evaluation written in the bar (16 px wide): short, as on Lichess. One decimal under 10
 * ("0.2", "3.5"), none above ("12"), "M3" for a mate; no sign (the side of the label says who).
 */
function barLabel(score: EngineLine['score']): string {
  if ('mate' in score) return `M${Math.abs(score.mate)}`;
  const v = Math.abs(score.cp) / 100;
  return v >= 9.95 ? String(Math.round(v)) : v.toFixed(1);
}

export function EvalBar({ line, orientation, off = false }: { line: EngineLine | undefined; orientation: Color; off?: boolean }) {
  // Engine off: an empty slot of the same width, so that the board keeps its size.
  if (off) return <div className="eval-bar off" aria-hidden="true" />;
  const share = line ? whiteShare(line.score) : 0.5;
  const whiteAhead = share >= 0.5;
  const label = line ? barLabel(line.score) : '';
  // White at the bottom when the board is seen from White, at the top otherwise.
  const whiteAtBottom = orientation === 'white';
  return (
    <div className="eval-bar" role="img" aria-label={line ? t(`Évaluation ${formatScore(line.score)}`, `Evaluation ${formatScore(line.score)}`) : t('Évaluation en cours', 'Evaluating')}>
      <div className={`eval-white ${whiteAtBottom ? 'bottom' : 'top'}`} style={{ height: `${share * 100}%` }} />
      <div className="eval-mid" />
      {label && (
        <span className={`eval-label ${whiteAhead === whiteAtBottom ? 'bottom' : 'top'} ${whiteAhead ? 'on-white' : 'on-black'}`}>
          {label}
        </span>
      )}
    </div>
  );
}
