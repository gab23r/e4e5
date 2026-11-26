/**
 * A move of my games that left my repertoire (a deviation): thumbnail with my move (red) and the
 * prepared ones (green), actions (review now, ignore, Explorer), and a detail with the games.
 * Swipe on touch screens: right to review, left to ignore.
 */
import { playSanOn, positionFromFen } from '@e4e5/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, ApiError, type GamesReport, type InboxItem, type RepertoireSummary, type Results } from '../api';
import { lineText, moveText } from '../chessText';
import { locale, t } from '../i18n';
import { Button, plural } from '../ui';
import { MiniBoard, type MiniArrow } from './MiniBoard';
import { SwipeRow } from './SwipeRow';

const pct = (x: number) => t(`${Math.round(100 * x)} %`, `${Math.round(100 * x)}%`);
const score = (r: Results) => {
  const n = r.win + r.draw + r.loss;
  return n ? (r.win + r.draw / 2) / n : 0;
};
const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
const RESULT = t({ win: 'gagnée', draw: 'nulle', loss: 'perdue' }, { win: 'won', draw: 'draw', loss: 'lost' });

/** The report without one inbox item (shown at once, before the server's new report). */
function withoutItem(r: GamesReport, item: InboxItem): GamesReport {
  const errors = r.inbox.errors.filter((i) => i.key !== item.key);
  return {
    ...r,
    inbox: {
      errors,
      errorCount: Math.max(0, r.inbox.errorCount - (r.inbox.errors.length - errors.length)),
    },
  };
}

export function GameErrorCard({ item, rep, onDone }: { item: InboxItem; rep: RepertoireSummary | undefined; onDone: (message: string) => void }) {
  const qc = useQueryClient();
  // Dealt with: off the list (and the badge of Mes parties) at once, then the new report; the
  // Entraîner badge counts a position sent to review (cards).
  const hide = () => {
    qc.setQueriesData<GamesReport>({ queryKey: ['games-report'] }, (r) => r && withoutItem(r, item));
    void qc.invalidateQueries({ queryKey: ['games-report'] });
    void qc.invalidateQueries({ queryKey: ['cards'] });
  };
  /**
   * An error sent to review: the position is due now (if learnt: else it comes with the new
   * lines), and the error is dismissed (it comes back if played again in a later game).
   * Returns whether the position was learnt.
   */
  const sendToReview = async () => {
    let learnt = true;
    try {
      await api.reviewNow(item.repertoireId, item.fen);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e;
      learnt = false;
    }
    await api.dismissInbox(item.key);
    return learnt;
  };
  const position = lineText(item.line.sans) || t('la position initiale', 'the starting position');
  const later = useMutation({
    mutationFn: sendToReview,
    onSuccess: (learnt) => {
      hide();
      onDone(
        learnt
          ? t(`Ajoutée à vos révisions du jour : après ${position}.`, `Added to today's reviews: after ${position}.`)
          : t(
              `Après ${position} : position pas encore apprise, elle viendra avec vos nouvelles lignes.`,
              `After ${position}: position not learnt yet, it will come with your new lines.`,
            ),
      );
    },
  });
  const dismiss = useMutation({ mutationFn: () => api.dismissInbox(item.key), onSuccess: hide });
  const busy = later.isPending || dismiss.isPending;

  const line = item.line.sans;
  // The position in the Explorer (statistics, engine, every repertoire), from my side.
  const explorer = `/explorer?${new URLSearchParams({ ...(item.line.ucis.length ? { line: item.line.ucis.join(',') } : {}), ...(rep?.color === 'black' ? { color: 'black' } : {}) })}`;
  const error = later.error ?? dismiss.error;

  // Thumbnail: the position, with my move (red) and the prepared ones (green).
  const arrows: MiniArrow[] = [
    ...item.expected.flatMap((san) => {
      const m = playSanOn(positionFromFen(item.fen), san);
      return m ? [{ uci: m.uci, kind: 'repertoire' as const }] : [];
    }),
    { uci: item.move.uci, kind: 'mistake' },
  ];

  const color = rep?.color ?? 'white';
  const dialog = useRef<HTMLDialogElement>(null);
  // The detail is only rendered while open (the board is measured when it is created).
  const [detail, setDetail] = useState(false);
  const open = () => {
    setDetail(true);
    dialog.current?.showModal();
  };

  const head = (
    <div className="inbox-head">
      <span className="muted inbox-line">{lineText(line) || t('Position initiale', 'Starting position')} </span>
      <span className="hole-move">{moveText(line, item.move.san)}</span>
    </div>
  );
  const actions = (
    <div className="row inbox-actions">
      <Button size="sm" variant="primary" disabled={busy} onClick={() => later.mutate()} title={t('Ajouter cette position à vos révisions du jour', "Add this position to today's reviews")}>
        {t('À réviser', 'Review')}
      </Button>
      <Button size="sm" disabled={busy} onClick={() => dismiss.mutate()} title={t('Masquer cet élément', 'Hide this item')}>{t('Ignorer', 'Ignore')}</Button>
      <Button size="sm" variant="ghost" icon="compass" to={explorer} title={t('Voir cette position dans l’Explorer (statistiques, moteur, vos répertoires)', 'See this position in Explore (statistics, engine, your repertoires)')}>
        {t('Explorer', 'Explore')}
      </Button>
    </div>
  );
  const errorText = error && <p className="error small-text">{error.message}</p>;

  return (
    // On touch screens: swipe left to ignore, right to review later.
    <SwipeRow right={{ label: t('À réviser', 'Review'), action: () => later.mutateAsync() }} left={{ label: t('Ignorer', 'Ignore'), action: () => dismiss.mutateAsync() }}>
      {/* The whole card opens the detail, except its buttons and links. */}
      <article className="card game-card clickable" onClick={(e) => !(e.target as HTMLElement).closest('button, a') && open()}>
        <button type="button" className="thumb-button" onClick={open} aria-label={t('Voir le détail et les parties', 'See the details and the games')}>
          <MiniBoard fen={item.fen} orientation={color} arrows={arrows} />
        </button>
        <div className="game-card-body">
          {head}
          <div className="row small-text game-card-meta">
            <span className="rep-tag"><span className={`dot ${color}`} /> {rep?.name ?? '?'}</span>
            <span className="muted">{t(plural(item.games, 'partie', 'parties'), plural(item.games, 'game', 'games'))} · {pct(score(item.results))}</span>
          </div>
          {actions}
          {errorText}
        </div>

        <dialog
          ref={dialog}
          className="game-detail"
          onClose={() => setDetail(false)}
          // Not to the card (which would open it again); a click on the backdrop closes it.
          onClick={(e) => {
            e.stopPropagation();
            if (e.target === dialog.current) dialog.current.close();
          }}
        >
          {detail && (
            <div className="game-detail-content stack">
              <div className="game-detail-top">
                <span className="rep-tag"><span className={`dot ${color}`} /> {rep?.name ?? '?'}</span>
                <Button size="sm" variant="ghost" onClick={() => dialog.current?.close()} title={t('Fermer', 'Close')}>✕</Button>
              </div>
              <MiniBoard fen={item.fen} orientation={color} arrows={arrows} className="mini-board-large" />
              {head}
              <p className="inbox-body">
                {t(
                  <>
                    Vous avez joué <strong>{moveText(line, item.move.san, true)}</strong> au lieu de{' '}
                    <strong>{item.expected.map((s) => moveText(line, s, true)).join(' ou ')}</strong>.{' '}
                    {plural(item.games, 'partie', 'parties')}, score {pct(score(item.results))}.
                  </>,
                  <>
                    You played <strong>{moveText(line, item.move.san, true)}</strong> instead of{' '}
                    <strong>{item.expected.map((s) => moveText(line, s, true)).join(' or ')}</strong>.{' '}
                    {plural(item.games, 'game', 'games')}, score {pct(score(item.results))}.
                  </>,
                )}
              </p>
              {actions}
              {errorText}
              <div className="table-wrap">
                <table className="lines">
                  <tbody>
                    {item.gameList.map((g) => (
                      <tr key={g.url}>
                        <td className="muted">{date(g.playedAt)}</td>
                        <td>
                          {g.opponent} <span className="muted">{g.opponentRating ?? ''}</span>
                        </td>
                        <td className={`result ${g.result}`}>{RESULT[g.result]}</td>
                        <td>
                          <a className="small-text" href={g.url} target="_blank" rel="noreferrer">{t('partie', 'game')} ↗</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </dialog>
      </article>
    </SwipeRow>
  );
}
