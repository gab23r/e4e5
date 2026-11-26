/**
 * The training page before a session (/train, /r/:id/train): which repertoires, which mode
 * (Lecture, Réviser, Se tester), my last mistakes in Réviser and my weak points.
 */
import { playUci } from '@e4e5/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type RepertoireSummary, type ReviewError, type TrainingSummary } from '../api';
import { MiniBoard } from '../components/MiniBoard';
import { San } from '../components/Nag';
import { lang, t } from '../i18n';
import { Icon, plural, type IconName } from '../ui';
import { lineText } from './common';
import type { Source } from './useTrainingSources';
import { WeakPoints } from './WeakPoints';
import { todo } from '../pages/Home';

export type SessionMode = 'review' | 'test';

export function TrainingHub({
  id,
  reps,
  summary,
  sources,
  sessionHref,
}: {
  /** One repertoire, or all the active ones. */
  id: string | undefined;
  reps: RepertoireSummary[];
  summary: TrainingSummary[] | undefined;
  sources: Source[];
  /** Where a session of this mode starts (same scope). */
  sessionHref: (mode: SessionMode) => string;
}) {
  const navigate = useNavigate();
  const byId = useMemo(() => new Map(reps.map((r) => [r.id, r])), [reps]);
  const counts = (summary ?? []).filter((s) => (id ? s.repertoireId === id : s.active));
  const due = counts.reduce((n, s) => n + s.dueLines, 0);
  const fresh = id ? (counts[0]?.newLines ?? 0) : Math.min(summary?.[0]?.remainingNewLines ?? 0, counts.reduce((n, s) => n + s.availableLines, 0));
  const sorted = [...reps].sort((a, b) => a.name.localeCompare(b.name, lang, { sensitivity: 'base' }));

  return (
    <div className="stack training-hub">
      <label className="hub-scope">
        <span className="muted small-text">{t('Répertoires', 'Repertoires')}</span>
        <select value={id ?? ''} onChange={(e) => navigate(e.target.value ? `/r/${e.target.value}/train` : '/train')}>
          <option value="">{t('Tous les répertoires actifs', 'All active repertoires')}</option>
          {sorted.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {r.active ? '' : t(' (en pause)', ' (paused)')}
            </option>
          ))}
        </select>
      </label>

      <div className="mode-cards">
        <ModeCard
          icon="target"
          title={t('Réviser', 'Review')}
          text={t('Les positions à revoir aujourd’hui et les nouvelles lignes, au bon moment pour les retenir.', 'The positions due today and the new lines, at the right time to remember them.')}
          to={sessionHref('review')}
          badge={
            !summary
              ? undefined
              : due + fresh > 0
              ? todo(due, fresh, 'short')
              : t('À jour', 'Up to date')
          }
          primary={due + fresh > 0}
        />
        <ModeCard
          icon="play"
          title={t('Se tester', 'Test yourself')}
          text={t('Sans aide : l’adversaire joue les coups les plus fréquents à votre niveau, comme en partie.', 'Without help: the opponent plays the most frequent moves at your level, as in a game.')}
          to={sessionHref('test')}
        />
      </div>

      <ErrorHistory id={id} reps={byId} sources={sources} />
      <WeakPoints sources={sources} reps={byId} />
    </div>
  );
}

function ModeCard({ icon, title, text, to, badge, primary, disabled }: { icon: IconName; title: string; text: string; to?: string; badge?: string; primary?: boolean; disabled?: string }) {
  const body = (
    <>
      <span className="mode-icon">
        <Icon name={icon} size={24} />
      </span>
      <span className="mode-text">
        <strong>{title}</strong>
        <span className="muted small-text">{disabled ?? text}</span>
        {badge && <span className={`badge ${primary ? 'warn' : ''}`}>{badge}</span>}
      </span>
      <Icon name="chevron" size={18} />
    </>
  );
  return to && !disabled ? (
    <Link to={to} className={`mode-card ${primary ? 'primary' : ''}`}>
      {body}
    </Link>
  ) : (
    <div className="mode-card disabled" aria-disabled="true">
      {body}
    </div>
  );
}

const DAYS_SHOWN = 3;

/** One mistake of a day: the move expected in a position (counted once per day). */
interface DayError {
  error: ReviewError;
  times: number;
}

/** My mistakes in Réviser, per day, the latest first: the position, the move expected, train it again. */
function ErrorHistory({ id, reps, sources }: { id: string | undefined; reps: Map<string, RepertoireSummary>; sources: Source[] }) {
  const errors = useQuery({ queryKey: ['review-errors'], queryFn: api.reviewErrors, staleTime: 0 });
  const [days, setDays] = useState(DAYS_SHOWN);
  const groups = useMemo(() => {
    const out = new Map<string, Map<string, DayError>>();
    for (const e of errors.data ?? []) {
      if (id ? e.repertoireId !== id : reps.get(e.repertoireId)?.active === false) continue;
      const day = new Date(e.reviewedAt).toDateString();
      const list = out.get(day) ?? out.set(day, new Map()).get(day)!;
      const key = `${e.fen}|${e.uci}`;
      const seen = list.get(key);
      if (seen) seen.times++;
      else list.set(key, { error: e, times: 1 });
    }
    return [...out.entries()].map(([day, list]) => ({ day, items: [...list.values()] }));
  }, [errors.data, id, reps]);
  const pathOf = (e: ReviewError) => sources.find((s) => s.id === e.repertoireId)?.positions.find((p) => p.fen === e.fen)?.path;

  return (
    <section className="stack">
      <h3>{t('Historique des erreurs', 'Mistakes history')}</h3>
      {errors.isLoading && <p className="muted">{t('Chargement…', 'Loading…')}</p>}
      {errors.data && groups.length === 0 && (
        <p className="muted small-text" style={{ margin: 0 }}>
          {t('Aucune erreur en révision pour l’instant.', 'No mistakes in review so far.')}
        </p>
      )}
      {groups.slice(0, days).map((g) => (
        <div key={g.day} className="error-day">
          <h4 className="muted small-text">
            {dayLabel(g.day)} · {t(plural(g.items.length, 'erreur', 'erreurs'), plural(g.items.length, 'mistake', 'mistakes'))}
          </h4>
          <div className="error-list">
            {g.items.map(({ error: e, times }) => {
              const move = e.uci ? playUci(e.fen, e.uci) : null;
              const path = pathOf(e);
              return (
                <Link
                  key={`${e.fen}|${e.uci}`}
                  className="error-item"
                  to={`/r/${e.repertoireId}/train?${new URLSearchParams({ mode: 'review', from: e.fen })}`}
                  title={t('S’entraîner sur cette position et la suite de la ligne', 'Train on this position and the rest of the line')}
                >
                  <MiniBoard fen={e.fen} orientation={e.color} arrows={e.uci ? [{ uci: e.uci, kind: 'repertoire' }] : []} />
                  <span className="error-text">
                    <span>
                      {t('Attendu : ', 'Expected: ')}
                      <strong>{move ? <San san={move.san} /> : '?'}</strong>
                      {times > 1 && <span className="muted"> · {t(`${times} fois`, `${times} times`)}</span>}
                    </span>
                    {path && <span className="muted small-text error-line">{lineText(path) || t('Position initiale', 'Starting position')}</span>}
                    {!id && <span className="muted small-text">{reps.get(e.repertoireId)?.name}</span>}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
      {groups.length > days && (
        <button type="button" className="link" onClick={() => setDays(days + DAYS_SHOWN)}>
          {t('Jours précédents', 'Earlier days')}
        </button>
      )}
    </section>
  );
}

/** "Aujourd'hui", "Hier", else the date. */
function dayLabel(day: string): string {
  const d = new Date(day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  if (diff === 0) return t('Aujourd’hui', 'Today');
  if (diff === 1) return t('Hier', 'Yesterday');
  return d.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' });
}
