/**
 * Accueil: what to do today at a glance. The day's training (series of days, what is left), the
 * repertoires to review, the latest mistake of my games, the missing move of the day, and my
 * activity over the last weeks. Without any repertoire: what the app does and how to start.
 */
import { START_FEN } from '@e4e5/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Gap, type Me, type RepertoireSummary, type TrainingSummary } from '../api';
import { GameErrorCard } from '../components/GameErrorCard';
import { MiniBoard } from '../components/MiniBoard';
import { chapterForPosition } from '../chapters';
import { moveText } from '../chessText';
import { fmt, lang, t } from '../i18n';
import { useTrainingSummary } from '../useTrainingSummary';
import { useGaps } from '../useGaps';
import { Button, Icon, plural } from '../ui';
import { useGamesReport } from './Games';

const WEEKS = 12;
const DAY = 86_400_000;

/** Midnight (local) of the day of `ms`. */
const dayOf = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function Home({ me }: { me: Me }) {
  const reps = useQuery({ queryKey: ['repertoires'], queryFn: api.repertoires });
  const summary = useTrainingSummary(me);
  const report = useGamesReport();
  const gaps = useGaps(me, (reps.data?.length ?? 0) > 0);
  // From the Monday WEEKS weeks ago (the grid's first column).
  const since = useMemo(() => {
    const today = dayOf(Date.now());
    const monday = today - ((new Date(today).getDay() + 6) % 7) * DAY;
    return monday - (WEEKS - 1) * 7 * DAY;
  }, []);
  const answers = useQuery({ queryKey: ['answers-since', since], queryFn: () => api.answersSince(since), staleTime: 0 });

  if (reps.isLoading) return <p className="muted">{t('Chargement…', 'Loading…')}</p>;
  if (!reps.data?.length) return <Welcome />;

  const name = me.lichess?.username ?? me.chesscom?.username;
  const active = (summary.data ?? []).filter((s) => s.active);
  const due = active.reduce((n, s) => n + s.dueLines, 0);
  const fresh = Math.min(summary.data?.[0]?.remainingNewLines ?? 0, active.reduce((n, s) => n + s.availableLines, 0));
  const byId = new Map(reps.data.map((r) => [r.id, r]));
  const error = report.data?.inbox.errors[0];
  const gap = [...(gaps.data?.white?.gaps ?? []), ...(gaps.data?.black?.gaps ?? [])].filter((g) => g.repertoireId && g.move).sort((a, b) => b.prob - a.prob)[0];

  return (
    <div className="home stack">
      <Today name={name} due={due} fresh={fresh} answers={answers.data} loading={!summary.data} />
      <ToReview reps={reps.data} summary={summary.data} />
      <div className="home-grid">
        {error && (
          <section className="stack">
            <div className="home-head">
              <h3>{t('Erreur à corriger', 'Mistake to fix')}</h3>
              <Link to="/games" className="small-text">
                {t(`Toutes (${report.data!.inbox.errorCount})`, `All (${report.data!.inbox.errorCount})`)}
              </Link>
            </div>
            <GameErrorCard item={error} rep={byId.get(error.repertoireId)} onDone={() => undefined} />
          </section>
        )}
        {gap && <GapOfTheDay gap={gap} rep={byId.get(gap.repertoireId!)} />}
      </div>
      {answers.data && <Activity answers={answers.data} since={since} />}
    </div>
  );
}

/**
 * What is left to do, the zero counts left out: "3 lignes à revoir et 2 nouvelles aujourd'hui."
 * (long) or "3 à revoir · 2 nouvelles" (short).
 */
export function todo(due: number, fresh: number, form: 'long' | 'short'): string {
  const long = form === 'long';
  const parts = [
    due > 0 && (long ? t(`${plural(due, 'ligne', 'lignes')} à revoir`, `${plural(due, 'line', 'lines')} to review`) : t(`${fmt(due)} à revoir`, `${fmt(due)} due`)),
    fresh > 0 &&
      (long && !due
        ? t(plural(fresh, 'nouvelle ligne', 'nouvelles lignes'), plural(fresh, 'new line', 'new lines'))
        : t(plural(fresh, 'nouvelle', 'nouvelles'), `${fmt(fresh)} new`)),
  ].filter(Boolean);
  return long ? `${parts.join(t(' et ', ' and '))}${t(' aujourd’hui.', ' today.')}` : parts.join(' · ');
}

/** The day: hello, series of days in a row, what is left today, the button to go on. */
function Today({ name, due, fresh, answers, loading }: { name?: string; due: number; fresh: number; answers?: { at: number; ok: boolean }[]; loading: boolean }) {
  const days = new Set((answers ?? []).map((a) => dayOf(a.at)));
  const today = dayOf(Date.now());
  // Days in a row up to today (or yesterday: today's training not done yet keeps the series).
  let streak = 0;
  for (let d = days.has(today) ? today : today - DAY; days.has(d); d -= DAY) streak++;
  const doneToday = (answers ?? []).filter((a) => a.at >= today).length;
  const left = due + fresh;
  // Still counting: the review (most likely something to do).
  const review = loading || left > 0;
  const hour = new Date().getHours();
  const hello = hour < 5 || hour >= 18 ? t('Bonsoir', 'Good evening') : t('Bonjour', 'Hello');
  return (
    <section className="home-today">
      <div className="home-today-text">
        <h2>
          {hello}
          {name ? ` ${name}` : ''}
        </h2>
        <p className="muted">
          {loading
            ? t('Calcul de votre journée…', 'Working out your day…')
            : left > 0
              ? todo(due, fresh, 'long')
              : t('Tout est à jour : testez-vous sur vos lignes.', 'All up to date: test yourself on your lines.')}
        </p>
        <div className="row">
          <Button variant="primary" icon="play" to={review ? '/train?mode=review' : '/train?mode=test'}>
            {review ? t('Continuer l’entraînement', 'Continue training') : t('Se tester', 'Test yourself')}
          </Button>
          <Button variant="ghost" to="/train">{t('Autres modes', 'Other modes')}</Button>
        </div>
      </div>
      <div className="home-stats">
        <div className={`home-stat streak ${streak > 0 ? 'on' : ''}`}>
          <span className="home-stat-value">{streak > 0 ? '🔥' : '·'} {fmt(streak)}</span>
          <span className="muted small-text">{t(plural(streak, 'jour d’affilée', 'jours d’affilée'), streak === 1 ? 'day in a row' : 'days in a row')}</span>
        </div>
        <div className="home-stat">
          <span className="home-stat-value">{fmt(doneToday)}</span>
          <span className="muted small-text">{t('réponses aujourd’hui', 'answers today')}</span>
        </div>
      </div>
    </section>
  );
}

/** The active repertoires with something to train today, the most first; the others after. */
function ToReview({ reps, summary }: { reps: RepertoireSummary[]; summary: TrainingSummary[] | undefined }) {
  const counts = new Map((summary ?? []).map((s) => [s.repertoireId, s]));
  const list = reps
    .filter((r) => r.active)
    .sort((a, b) => (counts.get(b.id)?.lines ?? 0) - (counts.get(a.id)?.lines ?? 0) || a.name.localeCompare(b.name, lang));
  if (!list.length) return null;
  return (
    <section className="stack">
      <div className="home-head">
        <h3>{t('À réviser', 'To review')}</h3>
        <Link to="/repertoires" className="small-text">{t('Tous les répertoires', 'All repertoires')}</Link>
      </div>
      <div className="home-carousel">
        {list.map((r) => {
          const c = counts.get(r.id);
          const arrows = (r.branches ?? []).map((uci) => ({ uci, kind: 'repertoire' as const }));
          return (
            <Link key={r.id} to={`/r/${r.id}/train`} className="home-rep">
              <MiniBoard fen={r.trunkFen ?? START_FEN} orientation={r.color} arrows={arrows} />
              <strong className="home-rep-name">
                <span className={`dot inline ${r.color}`} /> {r.name}
              </strong>
              <span className="small-text">
                {!c ? (
                  <span className="muted">…</span>
                ) : c.lines > 0 ? (
                  <span className="badge warn">{todo(c.dueLines, c.newLines, 'short')}</span>
                ) : (
                  <span className="muted">{t(`À jour · vu à ${Math.round(100 * c.seen)} %`, `Up to date · ${Math.round(100 * c.seen)}% seen`)}</span>
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The most frequent opponent move not prepared yet: the position (the move in orange) and the
 * chapter it comes up in (the first one, when several reach it); a click opens it to prepare it.
 */
function GapOfTheDay({ gap, rep }: { gap: Gap; rep: RepertoireSummary | undefined }) {
  const to = `/r/${gap.repertoireId}?${new URLSearchParams({ line: gap.ucis.join(','), gap: '1' })}`;
  const detail = useQuery({ queryKey: ['repertoire', gap.repertoireId], queryFn: () => api.repertoire(gap.repertoireId!), enabled: !!gap.repertoireId });
  const d = detail.data;
  const chapter = d ? chapterForPosition(d.color, d.chapters, d.moves, gap.fen)?.chapter.name : undefined;
  const where = chapter ?? rep?.name;
  const move = moveText(gap.line, gap.move!.san, true);
  return (
    <section className="stack">
      <h3>{t('Coup manquant du jour', 'Missing move of the day')}</h3>
      <Link to={to} className="card home-gap">
        <MiniBoard fen={gap.fen} orientation={rep?.color ?? 'white'} arrows={[{ uci: gap.move!.uci, kind: 'popular' }]} />
        <span className="home-gap-text">
          {where
            ? t(<>Dans <strong>{where}</strong>, préparez votre réponse contre <strong className="hole-move">{move}</strong></>, <>In <strong>{where}</strong>, prepare your reply to <strong className="hole-move">{move}</strong></>)
            : t(<>Préparez votre réponse contre <strong className="hole-move">{move}</strong></>, <>Prepare your reply to <strong className="hole-move">{move}</strong></>)}
        </span>
      </Link>
    </section>
  );
}

/** Answers per day over the last weeks (one column per week, Monday on top), and this week. */
function Activity({ answers, since }: { answers: { at: number; ok: boolean }[]; since: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const perDay = new Map<number, { n: number; ok: number }>();
  for (const a of answers) {
    const d = dayOf(a.at);
    const x = perDay.get(d) ?? { n: 0, ok: 0 };
    x.n++;
    if (a.ok) x.ok++;
    perDay.set(d, x);
  }
  const max = Math.max(1, ...[...perDay.values()].map((x) => x.n));
  const today = dayOf(Date.now());
  const weekStart = today - ((new Date(today).getDay() + 6) % 7) * DAY;
  const week = answers.filter((a) => a.at >= weekStart);
  const weekOk = week.filter((a) => a.ok).length;
  const level = (n: number) => (n === 0 ? 0 : Math.min(4, Math.ceil((4 * n) / max)));
  const cols = Array.from({ length: WEEKS }, (_, w) => Array.from({ length: 7 }, (_, d) => since + (w * 7 + d) * DAY));
  return (
    <section className="stack">
      <div className="home-head">
        <h3>{t('Activité', 'Activity')}</h3>
        <span className="muted small-text">
          {t(`Cette semaine : ${plural(week.length, 'réponse', 'réponses')}`, `This week: ${plural(week.length, 'answer', 'answers')}`)}
          {week.length > 0 && t(` · ${Math.round((100 * weekOk) / week.length)} % justes`, ` · ${Math.round((100 * weekOk) / week.length)}% right`)}
        </span>
      </div>
      <div className="card home-activity">
        <div className="heatmap" onMouseLeave={() => setHover(null)}>
          {cols.map((days, w) => (
            <div key={w} className="heatmap-col">
              {days.map((d) => {
                const x = perDay.get(d);
                const label = `${new Date(d).toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short' })} · ${t(plural(x?.n ?? 0, 'réponse', 'réponses'), plural(x?.n ?? 0, 'answer', 'answers'))}`;
                return <span key={d} className={`heat l${level(x?.n ?? 0)} ${d > today ? 'future' : ''}`} title={label} onMouseEnter={() => setHover(label)} />;
              })}
            </div>
          ))}
        </div>
        <p className="muted small-text heatmap-legend">{hover ?? t('Chaque case : un jour (lundi en haut).', 'Each square: one day (Monday on top).')}</p>
      </div>
    </section>
  );
}

/** No repertoire yet: what the app does, and how to start. */
function Welcome() {
  const features: { icon: 'book' | 'target' | 'games'; title: string; text: string }[] = [
    { icon: 'book', title: t('Construisez', 'Build'), text: t('Vos ouvertures, coup par coup, ou importées d’une étude Lichess.', 'Your openings, move by move, or imported from a Lichess study.') },
    { icon: 'target', title: t('Retenez', 'Remember'), text: t('La répétition espacée vous fait revoir chaque ligne au bon moment.', 'Spaced repetition has you review each line at the right time.') },
    { icon: 'games', title: t('Progressez', 'Improve'), text: t('Vos parties montrent où vous sortez de votre préparation.', 'Your games show where you leave your preparation.') },
  ];
  return (
    <div className="home-welcome stack">
      <div className="home-welcome-hero">
        <img src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" className="home-welcome-logo" />
        <h2>{t('Vos ouvertures, enfin retenues.', 'Your openings, remembered at last.')}</h2>
        <p className="muted">{t('Préparez votre répertoire, entraînez-vous quelques minutes par jour, et jouez vos lignes en partie.', 'Prepare your repertoire, train a few minutes a day, and play your lines in your games.')}</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Button variant="primary" icon="plus" to="/repertoires/new">{t('Créer un répertoire', 'Create a repertoire')}</Button>
          <Button to="/account">{t('Lier Lichess ou Chess.com', 'Link Lichess or Chess.com')}</Button>
        </div>
      </div>
      <div className="home-features">
        {features.map((f) => (
          <div key={f.title} className="card home-feature">
            <span className="mode-icon"><Icon name={f.icon} size={22} /></span>
            <strong>{f.title}</strong>
            <span className="muted small-text">{f.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
