import { formatScore, playUci, totalGames, type Color, type EngineLine, type ExplorerResponse, type PlayedMove } from '@e4e5/core';
import { San } from './Nag';
import { WdlBar } from './WdlBar';
import { Fragment, useEffect, useState } from 'react';
import type { BestMovesResponse } from '../api';
import { moveText } from '../chessText';
import { fmt, t } from '../i18n';
import { Icon, plural } from '../ui';

const pct = (x: number) => t(`${Math.round(100 * x)} %`, `${Math.round(100 * x)}%`);
const share = (n: number, total: number) => (total ? (100 * n) / total : 0);
/** Games, compact: 950, 12,3 k, 125 k / 950, 12.3k, 125k. */
/** Rows shown before "N autres coups". */
const SHOWN = 3;
const games = (n: number) => (n >= 1000 ? `${fmt(n / 1000, { maximumFractionDigits: n < 100_000 ? 1 : 0 })}${t(' k', 'k')}` : String(n));

export type LevelSort = 'score' | 'freq' | 'eval';

const SORT_KEY = 'levelSortChoice';

/**
 * The sort chosen by a click on a header (score or frequency), kept on this device; null: none
 * chosen, the default applies (score on my turn, frequency on the opponent's). A click on the
 * header of the sort chosen goes back to the default.
 */
export function useLevelSort() {
  const [choice, setChoice] = useState<LevelSort | null>(() => {
    const v = localStorage.getItem(SORT_KEY);
    return v === 'score' || v === 'freq' || v === 'eval' ? v : null;
  });
  const set = (s: LevelSort | null) => {
    if (s) localStorage.setItem(SORT_KEY, s);
    else localStorage.removeItem(SORT_KEY);
    setChoice(s);
  };
  return [choice, set] as const;
}

/**
 * The Lichess moves of the position merged with the search at my level: one row per move with
 * its score, number of games (absolute: how reliable the score is) and win/draw/loss bar. The score is the move's own one
 * (wins + draws / 2, from my side) at 0, else the expected score over the lines followed while
 * they come up in at least the share of the games set by the box of the footer (checked: 6 %; the
 * number of moves follows from it). On the opponent's turn, each of its moves is scored by the
 * search started after it (my best answer, then the likely lines). Sorted by score or by
 * frequency (arrows of the headers); the first rows, "N autres coups" for the others. A row
 * unfolds into the expected line and the opponent's replies.
 */
export function LevelTable({
  data,
  fen,
  color,
  firstMoveNumber,
  inRep,
  nagsOf,
  onPick,
  onPlay,
  missing,
  level,
  depth,
  maxDepth,
  onDepth,
  myTurn,
  levelLoading,
  levelError,
  range,
  engineBest,
  engine,
  limit = 10,
}: {
  data: ExplorerResponse;
  fen: string;
  /** My colour (scores are from my side). */
  color: Color;
  /** Ply count of the position (for move numbers). */
  firstMoveNumber: number;
  inRep: (uci: string) => boolean;
  /** PGN annotations of a move of my repertoires here (!, ?, …): the move is coloured. */
  nagsOf?: (uci: string) => readonly number[] | null | undefined;
  onPick: (uci: string) => void;
  onPlay: (moves: PlayedMove[]) => void;
  /** Missing moves (gap finder): in orange. */
  missing?: (uci: string) => boolean;
  /** Search at my level for the depth chosen (undefined: depth 0 or not computed). */
  level: BestMovesResponse | undefined;
  depth: number;
  maxDepth: number;
  onDepth: (d: number) => void;
  /**
   * My turn: my moves, by the search from here. Else the opponent's: each of its moves scored
   * for me by the search started after it (my best answer, then the likely lines).
   */
  myTurn: boolean;
  levelLoading: boolean;
  levelError: Error | null;
  /** "1600–1999", for the footer. */
  range: string;
  /** Stockfish's best move, to mark when both agree. */
  engineBest?: string;
  /**
   * Stockfish merged into the table (analysis on): the evaluation of each move searched (the
   * moves shown, told by `onShown`, and the best one), its best line (a row of its own when its
   * move is not in the table), and its depth.
   */
  engine?: {
    byMove: Map<string, EngineLine>;
    best: EngineLine | undefined;
    depth: number;
    maxDepth: number;
    onShown: (ucis: string[]) => void;
  };
  /** Only the most played moves, plus the repertoire moves played less often. */
  limit?: number;
}) {
  const [choice, setChoice] = useLevelSort();
  // By default: my turn by score (my best moves first), the opponent's by number of games (the
  // replies I will most likely face). A sort chosen by a click applies everywhere until undone.
  // The sort by evaluation needs Stockfish (else the default one).
  const sort: LevelSort = (choice === 'eval' && !engine ? null : choice) ?? (myTurn ? 'score' : 'freq');
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const total = totalGames(data);

  const searching = depth > 0;
  const found = new Map((searching ? level?.moves ?? [] : []).map((m) => [m.uci, m]));
  const reach = searching ? level?.reach ?? null : null;
  const rows = data.moves
    .filter((m, i) => i < limit || inRep(m.uci))
    .map((m) => {
      const n = totalGames(m);
      const mine = color === 'white' ? m.white : m.black;
      const direct = n ? (mine + m.draws / 2) / n : 0;
      const best = found.get(m.uci);
      return { m, n, rank: data.moves.indexOf(m), direct, best, score: best?.score ?? direct };
    });
  // Searching: the moves the search scored first (their scores compare the same lines), then the
  // others on their own win rate (too rarely played to be candidates: a noisy score, not the best).
  const scored = (r: (typeof rows)[number]) => (searching && level && !r.best ? 0 : 1);
  if (sort === 'score') rows.sort((a, b) => scored(b) - scored(a) || b.score - a.score || b.n - a.n);
  if (sort === 'eval' && engine) {
    // The best for the side to move first (Stockfish's order: on the opponent's turn, its best
    // moves, not its mistakes); the moves not evaluated after, by number of games.
    const sign = fen.split(' ')[1] === 'w' ? 1 : -1;
    const value = (uci: string) => {
      const l = engine.byMove.get(uci);
      if (!l) return -Infinity;
      const v = 'mate' in l.score ? Math.sign(l.score.mate) * (100_000 - Math.abs(l.score.mate)) : l.score.cp;
      return sign * v;
    };
    rows.sort((a, b) => value(b.m.uci) - value(a.m.uci) || b.n - a.n);
  }
  // Searched up to the depth reached: the best of these is the move the search recommends (my
  // turn only: on the opponent's, the best for me is not its likely move).
  const top = searching && myTurn ? rows.find((r) => r.best && r.best.minReach === reach) : undefined;
  const shown = all ? rows : rows.slice(0, SHOWN);
  // The moves shown: the ones Stockfish evaluates (with its best move).
  const shownKey = shown.map((r) => r.m.uci).join(' ');
  useEffect(() => engine?.onShown(shownKey ? shownKey.split(' ') : []), [shownKey, fen]);
  // Stockfish's best move when it is not in the table (not played at my level, or among the rarest).
  const engineOnly = engine?.best?.pv[0] && !rows.some((r) => r.m.uci === engine.best!.pv[0]!.uci) ? engine.best : undefined;
  if (total === 0) return <div className="level-status muted">{t('Aucune partie dans cette position.', 'No games in this position.')}</div>;

  /** The moves of `ucis` played from the position (stops at an illegal one). */
  const played = (ucis: string[]) => {
    const out: PlayedMove[] = [];
    for (const uci of ucis) {
      const m = playUci(out.at(-1)?.toFen ?? fen, uci);
      if (!m) break;
      out.push(m);
    }
    return out;
  };
  const num = (i: number) => {
    const ply = firstMoveNumber + i;
    return ply % 2 === 0 ? `${ply / 2 + 1}. ` : i === 0 ? `${(ply + 1) / 2}… ` : '';
  };
  const numbered = (i: number, san: string) => moveText(Array(firstMoveNumber + i).fill(''), san, true);

  // The box sets how likely a line must stay to be followed (thresholds of the search steps),
  // not a number of moves: how far the lines go follows from it, and varies with the position.
  const steps = level?.steps ?? [0.5, 0.25, 0.12, 0.06, 0.03];
  const threshold = (d: number) => (d > 0 ? t(`lignes ≥ ${pct(steps[d - 1]!)}`, `lines ≥ ${pct(steps[d - 1]!)}`) : t('coup seul', 'move alone'));
  const reached = reach === null ? 0 : steps.indexOf(reach) + 1;
  const computing = searching && !!level && level.pending > 0;
  // How far ahead the expected lines go at the threshold reached (half-moves).
  const plies = searching && reached > 0 ? Math.max(0, ...(level?.moves ?? []).filter((m) => m.minReach === reach).map((m) => m.line.length)) : 0;
  /** Short state for the footer; `why`: the full explanation (tooltip). */
  let short: string;
  let why: string;
  if (depth === 0)
    [short, why] = ['', t('Score de chaque coup seul : victoires + nulles / 2, pour vous, dans les parties Lichess.', 'Score of each move alone: wins + draws / 2, for you, in the Lichess games.')];
  else if (levelLoading) [short, why] = [t('calcul…', 'computing…'), t('Calcul à votre niveau…', 'Computing at your level…')];
  else if (levelError) [short, why] = [t('erreur', 'error'), levelError.message];
  else if (computing)
    [short, why] = [
      t('calcul…', 'computing…'),
      t(
        `Calcul : ${plural(level!.pending, 'position', 'positions')} à récupérer sur Lichess (${range}) pour suivre les lignes plus loin.`,
        `Computing: ${plural(level!.pending, 'position', 'positions')} to fetch from Lichess (${range}) to follow the lines further.`,
      ),
    ];
  // Nothing explored: the next positions are not stored (and cannot be fetched now).
  else if (reached === 0)
    [short, why] = [
      t('positions manquantes', 'missing positions'),
      t(
        'Positions suivantes absentes des statistiques enregistrées : score de chaque coup seul, pas de ligne à dérouler.',
        'Next positions missing from the stored statistics: score of each move alone, no line to unfold.',
      ),
    ];
  else if (reached < depth)
    [short, why] = [
      t(`${threshold(reached)} atteint`, `${threshold(reached)} reached`),
      t(
        `Lignes suivies jusqu’à ${pct(steps[reached - 1]!)} des parties seulement : descendre à ${pct(steps[depth - 1]!)} demanderait trop de positions.`,
        `Lines followed down to ${pct(steps[reached - 1]!)} of the games only: going down to ${pct(steps[depth - 1]!)} would need too many positions.`,
      ),
    ];
  else [short, why] = ['', ''];
  why ||= t(
    `${myTurn ? '' : 'Au tour de l’adversaire : chaque coup adverse est calculé comme si l’analyse commençait après lui (votre meilleure réponse, puis les lignes probables). '}Les lignes sont suivies tant qu’elles arrivent dans au moins ${pct(steps[(reached || depth) - 1]!)} des parties à votre niveau (vos meilleurs coups, les réponses adverses pondérées par leur fréquence)${plies > 1 ? ` : ici jusqu’à ${plies} demi-coups plus loin` : ''}. Plus le seuil est bas, plus les lignes vont loin ; le nombre de coups dépend de la position.`,
    `${myTurn ? '' : "Opponent's turn: each opponent move is computed as if the analysis started after it (your best answer, then the likely lines). "}Lines are followed as long as they occur in at least ${pct(steps[(reached || depth) - 1]!)} of the games at your level (your best moves, the opponent's replies weighted by their frequency)${plies > 1 ? `: here up to ${plies} plies further` : ''}. The lower the threshold, the further the lines go; the number of moves depends on the position.`,
  );

  /** Stockfish's evaluation of a move (White's side, as on Lichess); a click plays its line. */
  const evalCell = (uci: string) => {
    if (!engine) return null;
    const l = engine.byMove.get(uci);
    if (!l) return <td className="eval-col muted">…</td>;
    const value = 'mate' in l.score ? l.score.mate : l.score.cp;
    const line = l.pv.slice(0, 8);
    return (
      <td className="eval-col" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={`eval ${value >= 0 ? 'w' : 'b'}`}
          onClick={() => onPlay(line)}
          title={t(`Stockfish (profondeur ${l.depth}) : ${pvText(line)} — cliquer pour jouer la ligne`, `Stockfish (depth ${l.depth}): ${pvText(line)} — click to play the line`)}
        >
          {formatScore(l.score)}
        </button>
      </td>
    );
  };
  const pvText = (line: PlayedMove[]) => line.map((m, i) => `${num(i)}${m.san}`).join(' ');
  const cols = engine ? 6 : 5;

  const header = (key: LevelSort, label: string, title: string, className: string) => (
    <th className={className}>
      {/* Purple only when chosen by a click; the default sort is shown in the normal colour. */}
      <button
        type="button"
        className={`sort ${choice === key ? 'on' : ''}`}
        onClick={() => setChoice(choice === key ? null : key)}
        title={choice === key ? t(`${title} — cliquer à nouveau pour revenir au tri par défaut`, `${title} — click again to go back to the default sort`) : title}
        aria-pressed={choice === key}
      >
        {label} <span aria-hidden="true">{sort === key ? '▼' : '▽'}</span>
      </button>
    </th>
  );

  return (
    <>
      <table className="explorer">
        <thead>
          <tr>
            <th className="san">{t('Coup', 'Move')}</th>
            {header('score', 'Score', t('Trier par score (pour vous)', 'Sort by score (for you)'), 'score-col')}
            {engine &&
              header(
                'eval',
                t('Éval', 'Eval'),
                t(
                  'Trier par évaluation de Stockfish (les meilleurs coups du camp au trait en premier ; affichée pour les Blancs)',
                  'Sort by Stockfish’s evaluation (the best moves of the side to move first; shown for White)',
                ),
                'eval-col',
              )}
            {header('freq', t('Parties', 'Games'), t('Trier par nombre de parties', 'Sort by number of games'), 'count')}
            <th className="wdl" />
            <th className="unfold-col" />
          </tr>
        </thead>
        <tbody>
          {shown.map(({ m, n, rank, direct, best, score }) => {
            const prepared = inRep(m.uci);
            // Same colours as the arrows: green in the repertoire, orange a missing move (gap finder).
            const popular = !prepared && !!missing?.(m.uci);
            // Searched less far than the depth reached (or not at all): less precise score.
            const pruned = searching && !!level && (!best || best.minReach !== reach);
            const isOpen = open === m.uci && !!best && best.replies.length > 0;
            // The moves the replies answer: mine, or on the opponent's turn its move and my answer.
            const before = (best?.line ?? []).slice(0, myTurn ? 1 : 2).map((x) => x.uci);
            const scoreTitle = !searching
              ? t(`${pct(direct)} pour vous dans les parties Lichess`, `${pct(direct)} for you in the Lichess games`)
              : !best
                ? t(
                    'Pas assez joué pour être calculé : score brut de ce coup seul, classé après les coups calculés.',
                    'Not played enough to be computed: raw score of this move alone, ranked after the computed moves.',
                  )
                : pruned
                  ? t(
                      `Écarté plus tôt : calculé moins loin, score moins précis (${pct(direct)} après ce coup seul).`,
                      `Dropped earlier: computed less far, less precise score (${pct(direct)} after this move alone).`,
                    )
                  : myTurn
                    ? t(`Score espéré à votre niveau (${pct(direct)} après ce coup seul).`, `Expected score at your level (${pct(direct)} after this move alone).`)
                    : t(
                        `Score espéré à votre niveau après ce coup, avec votre meilleure réponse (${pct(direct)} dans ses parties).`,
                        `Expected score at your level after this move, with your best answer (${pct(direct)} in its games).`,
                      );
            return (
              <Fragment key={m.uci}>
                <tr
                  className={[prepared ? 'in-rep' : popular ? 'popular' : '', top?.m.uci === m.uci ? 'level-top' : ''].join(' ')}
                  onClick={() => onPick(m.uci)}
                  title={
                    prepared
                      ? t('Dans votre répertoire', 'In your repertoire')
                      : popular
                        ? t('Coup manquant : joué souvent, pas encore dans votre répertoire', 'Missing move: often played, not in your repertoire yet')
                        : t('Jouer ce coup', 'Play this move')
                  }
                >
                  <td className="san">
                    <San san={m.san} nags={nagsOf?.(m.uci)} />
                    {engineBest === m.uci && (
                      <span className="sf-tag" title={t('Aussi le meilleur coup de Stockfish', 'Also Stockfish’s best move')} aria-label={t('Aussi le meilleur coup de Stockfish', 'Also Stockfish’s best move')}>
                        <Icon name="engine" size={12} />
                      </span>
                    )}
                  </td>
                  <td className="score-col">
                    <span className={`score ${searching && !pruned ? 'searched' : ''} ${searching && level && !best ? 'unsearched' : ''}`} title={scoreTitle}>
                      {pct(score)}
                    </span>
                  </td>
                  {evalCell(m.uci)}
                  <td className="count" title={t(
                      `${fmt(n)} parties · ${fmt(share(n, total), { maximumFractionDigits: 1 })} % des parties`,
                      `${fmt(n)} games · ${fmt(share(n, total), { maximumFractionDigits: 1 })}% of the games`,
                    )}
                  >
                    {games(n)}{' '}
                    <span className="share">({fmt(share(n, total), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}{t(' %', '%')})</span>
                  </td>
                  <td className="wdl">
                    <WdlBar white={m.white} draws={m.draws} black={m.black} color={color} expected={searching && best ? best.score : undefined} />
                  </td>
                  <td className="unfold-col" onClick={(e) => e.stopPropagation()}>
                    {best && best.replies.length > 0 && (
                      <button
                        className={`unfold ${isOpen ? 'open' : ''}`}
                        onClick={() => setOpen(isOpen ? null : m.uci)}
                        title={isOpen ? t('Masquer la ligne', 'Hide the line') : t('Voir la ligne attendue et les réponses adverses', 'See the expected line and the opponent’s replies')}
                        aria-expanded={isOpen}
                      >
                        <Icon name="chevron" size={16} />
                      </button>
                    )}
                  </td>
                </tr>
                {isOpen && best && (
                  <tr className="level-detail">
                    <td colSpan={cols}>
                      <div className="pv">
                        {best.line.slice(0, 10).map((s, i, line) => (
                          <button key={i} className="link" onClick={() => onPlay(played(line.slice(0, i + 1).map((x) => x.uci)))} title={t('Jouer jusqu’à ce coup', 'Play up to this move')}>
                            {num(i)}
                            {s.san}
                          </button>
                        ))}
                      </div>
                      <ul className="suggestion-replies">
                        {best.replies.map((r) => (
                          <li key={r.uci}>
                            <span className="reply">
                              <button className="link" onClick={() => onPlay(played([...before, r.uci]))}>{numbered(before.length, r.san)}</button>
                              <span className="muted small-text"> {pct(r.share)} </span>
                              {r.answer && (
                                <button className="link answer" onClick={() => onPlay(played([...before, r.uci, r.answer!.uci]))}>
                                  {numbered(before.length + 1, r.answer.san)}
                                </button>
                              )}
                            </span>
                            <span className="reply-score">{pct(r.score)}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {engineOnly && (
            <tr className="engine-only" onClick={() => onPick(engineOnly.pv[0]!.uci)} title={t('Meilleur coup de Stockfish, pas joué à votre niveau : jouer ce coup', 'Stockfish’s best move, not played at your level: play this move')}>
              <td className="san">
                <San san={engineOnly.pv[0]!.san} nags={nagsOf?.(engineOnly.pv[0]!.uci)} />
                <span className="sf-tag" aria-label="Stockfish">
                  <Icon name="engine" size={12} />
                </span>
              </td>
              <td className="score-col muted">–</td>
              {evalCell(engineOnly.pv[0]!.uci)}
              <td className="count muted">{t('non joué', 'not played')}</td>
              <td className="wdl" />
              <td className="unfold-col" />
            </tr>
          )}
        </tbody>
      </table>
      <div className="level-footer muted">
        {rows.length > SHOWN && (
          <button className="link" onClick={() => setAll(!all)}>{all ? t('Moins', 'Less') : t(plural(rows.length - SHOWN, 'autre coup', 'autres coups'), plural(rows.length - SHOWN, 'other move', 'other moves'))}</button>
        )}
        <span className="spacer" />
        <label className="level-depth" title={why}>
          {computing && <span className="pulse" aria-hidden="true" />}
          <input
            type="checkbox"
            checked={depth > 0}
            onChange={(e) => onDepth(e.target.checked ? maxDepth : 0)}
            aria-label={t(
              'Profondeur : suivre les lignes probables à votre niveau (sinon : score de chaque coup seul)',
              'Depth: follow the likely lines at your level (else: score of each move alone)',
            )}
          />
          <span className="level-info">
            {`${t('profondeur', 'depth')}${depth > 0 && plies > 1 ? ` · ${plies} ${t('½-coups', 'plies')}` : ''}${depth > 0 && short ? ` · ${short}` : ''}`}
          </span>
        </label>
        <span className="level-range">Lichess {range}</span>
        {engine && (
          <span className="level-range" title={t('Profondeur de Stockfish', 'Stockfish depth')}>
            SF {engine.depth}/{engine.maxDepth}
          </span>
        )}
      </div>
    </>
  );
}
