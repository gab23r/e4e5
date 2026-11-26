import type { Color, EngineLine, PlayedMove } from '@e4e5/core';
import type { ComponentProps } from 'react';
import { ApiError, type BestMovesResponse, type Stats, type StatsMeta } from '../api';
import { locale, t } from '../i18n';
import { rangeLabel, speedsLabel } from '../settings';
import { EngineLines } from './EnginePanel';
import { LevelTable } from './LevelTable';

interface Props {
  fen: string;
  /** Scores from this side (the repertoire's colour, or the side to move). */
  color: Color;
  /** Marked as prepared (green). */
  inRep: (uci: string) => boolean;
  /** PGN annotations of a move of my repertoires here (!, ?, …): the move is coloured. */
  nagsOf?: (uci: string) => readonly number[] | null | undefined;
  stats: Stats | undefined;
  error: unknown;
  loading: boolean;
  onPick: (uci: string) => void;
  /** Missing moves (gap finder): in orange. */
  isMissing?: (uci: string) => boolean;
  /** Ply count of the position (for move numbers). */
  firstMoveNumber: number;
  onPlay: (moves: PlayedMove[]) => void;
  /** The search at my level merged into the table (see LevelTable). */
  level: {
    data: BestMovesResponse | undefined;
    loading: boolean;
    error: Error | null;
    depth: number;
    maxDepth: number;
    onDepth: (d: number) => void;
    /** My turn (else the opponent's moves are scored for me, the search starting after each). */
    myTurn: boolean;
    range: string;
    engineBest?: string;
  };
  /**
   * Stockfish merged into the table (Éval column); its lines alone when the position has no
   * statistics. Absent: analysis off.
   */
  engine?: NonNullable<ComponentProps<typeof LevelTable>['engine']> & { lines: EngineLine[] };
}

export const REASONS: Record<NonNullable<StatsMeta['reason']>, string> = t(
  {
    'not-stored': 'position trop rare, absente des statistiques enregistrées',
    'local-stats': 'téléchargez les tranches de vos réglages (Paramètres › Mode local)',
  },
  {
    'not-stored': 'position too rare, not in the stored statistics',
    'local-stats': 'download the ranges of your settings (Settings › Local mode)',
  },
);


/**
 * Says when the numbers are not data for the selected range (the months of games counted are in
 * the Settings).
 */
function provenance(meta: StatsMeta): string | null {
  const date = new Date(meta.fetchedAt).toLocaleDateString(locale);
  const why = meta.reason ? ` (${REASONS[meta.reason]})` : '';
  if (!meta.exact) {
    return t(
      `Pas de données pour votre tranche : parties Lichess ${speedsLabel(meta.speeds)} de joueurs ${rangeLabel(meta.ratings)}, du ${date}${why}.`,
      `No data for your range: Lichess ${speedsLabel(meta.speeds)} games of ${rangeLabel(meta.ratings)} players, from ${date}${why}.`,
    );
  }
  if (meta.reason) return t(`Données enregistrées le ${date}${why}.`, `Data stored on ${date}${why}.`);
  return null;
}

/**
 * Moves played at the user's level in this position, merged with the search at my level (see
 * LevelTable), marked when in the repertoire. Under the board, like the engine lines.
 */
export function ExplorerPanel({ fen, color, inRep, nagsOf, stats, error, loading, onPick, isMissing, firstMoveNumber, onPlay, level, engine }: Props) {
  const data = stats?.data;
  const origin = stats ? provenance(stats.meta) : null;
  const missing = error instanceof ApiError && error.status === 404;
  const missingReason = missing ? (error.body.reason as StatsMeta['reason']) : undefined;
  const missingTitle = t(
    `Aucune statistique pour cette position${missingReason ? ` : ${REASONS[missingReason]}` : ''}.`,
    `No statistics for this position${missingReason ? `: ${REASONS[missingReason]}` : ''}.`,
  );
  // Under the board like the engine lines: no heading, the notes in small.
  return (
    <div className="level-lines level-table">
      {loading && <div className="level-status muted">{t('Chargement…', 'Loading…')}</div>}
      {Boolean(error) && !missing && <div className="level-status error">{String(error)}</div>}
      {/* No statistics here: Stockfish's lines alone, the note on their depth line (why in its tooltip). */}
      {engine && !loading && (!data || data.moves.length === 0) && (
        <EngineLines
          enabled
          lines={engine.lines}
          depth={engine.depth}
          maxDepth={engine.maxDepth}
          firstMoveNumber={firstMoveNumber}
          onPlay={onPlay}
          note={missing ? <span title={missingTitle}>{t('Pas de statistiques Lichess', 'No Lichess statistics')}</span> : undefined}
        />
      )}
      {missing && !engine && (
        <p className="level-missing muted" title={missingTitle}>
          {t('Pas de statistiques Lichess', 'No Lichess statistics')}
        </p>
      )}
      {data && (
        <LevelTable
          data={data}
          fen={fen}
          color={color}
          firstMoveNumber={firstMoveNumber}
          inRep={inRep}
          nagsOf={nagsOf}
          onPick={onPick}
          onPlay={onPlay}
          missing={isMissing}
          level={level.data}
          depth={level.depth}
          maxDepth={level.maxDepth}
          onDepth={level.onDepth}
          myTurn={level.myTurn}
          levelLoading={level.loading}
          levelError={level.error}
          range={level.range}
          engineBest={level.engineBest}
          engine={engine}
        />
      )}
      {origin && <p className="warning small-text level-origin">{origin}</p>}
    </div>
  );
}
