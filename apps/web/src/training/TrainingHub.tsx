/**
 * The training page before a session (/train, /r/:id/train): which repertoires, which mode
 * (Lecture, Réviser, Se tester), and my weak points.
 */
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { RepertoireSummary, TrainingSummary } from '../api';
import { lang, t } from '../i18n';
import { Icon, type IconName } from '../ui';
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

