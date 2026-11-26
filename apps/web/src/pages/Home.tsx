/**
 * Accueil: what to do today at a glance. The day's training (series of days, what is left), the
 * repertoires to review, my training mistakes to review (one at a time), the missing move of the day, and my
 * activity over the last weeks. Without any repertoire: what the app does and how to start.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, type Gap, type Me, type RepertoireSummary, type ReviewError, type TrainingSummary } from '../api';
import { BotAvatar } from '../components/BotAvatar';
import { MiniBoard } from '../components/MiniBoard';
import { San } from '../components/Nag';
import { SwipeRow } from '../components/SwipeRow';
import { chapterForPosition } from '../chapters';
import { playUci, START_FEN } from '@e4e5/core';
import { moveText } from '../chessText';
import { fmt, lang, t } from '../i18n';
import { useTrainingSummary } from '../useTrainingSummary';
import { useGaps } from '../useGaps';
import { useOpponent } from '../opponent';
import { Button, Icon, plural } from '../ui';

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
  const missing = [...(gaps.data?.white?.gaps ?? []), ...(gaps.data?.black?.gaps ?? [])].filter((g) => g.repertoireId && g.move).sort((a, b) => b.prob - a.prob);

  return (
    <div className="home stack">
      <Today name={name} due={due} fresh={fresh} answers={answers.data} loading={!summary.data} />
      <PlayCard me={me} />
      <ToReview reps={reps.data} summary={summary.data} />
      <div className="home-grid">
        <ErrorDeck reps={byId} />
        {missing.length > 0 && <GapDeck gaps={missing} reps={byId} />}
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
              : t('Tout est à jour : jouez une partie sur vos lignes.', 'All up to date: play a game on your lines.')}
        </p>
        <div className="row">
          <Button variant="primary" icon="play" to={review ? '/train' : '/train?mode=test'}>
            {review ? t('Continuer l’entraînement', 'Continue training') : t('Jouer une partie', 'Play a game')}
          </Button>
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

/**
 * "Se tester" as a game: against a fictional player of my level (the level of the opening
 * statistics), who plays the most frequent moves there, on what I have learnt, without help.
 */
function PlayCard({ me }: { me: Me }) {
  const { name, elo } = useOpponent(me);
  return (
    <Link to="/train?mode=test" className="mode-card play-card">
      <BotAvatar name={name} size={56} />
      <span className="mode-text">
        <strong>{t(`Jouer contre ${name}`, `Play against ${name}`)} <span className="opponent-elo">{elo}</span></strong>
        <span className="muted small-text">
          {t(
            'Vos lignes, sans aide, comme en partie : les coups les plus fréquents des joueurs de votre niveau.',
            'Your lines, without help, as in a game: the most frequent moves of players of your level.',
          )}
        </span>
      </span>
      <Icon name="chevron" size={18} />
    </Link>
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

/** Items put off ("plus tard") until the app is closed, per deck. */
const laterSaved = (key: string): string[] => {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? '[]') as string[];
  } catch {
    return [];
  }
};

/**
 * A deck of cards shown one at a time, in the given order. Swiped to the `dismiss` side, the item
 * is dismissed (`onIgnore`); with a `laterKey`, to the other side, put off until later (this
 * session); then the next one comes.
 */
function Deck<T>({
  title,
  aside,
  items,
  id,
  laterKey,
  onIgnore,
  dismiss = { label: t('Ignorer', 'Ignore'), side: 'right' },
  render,
  empty,
}: {
  title: string;
  /** Shown when there is nothing at all (none put off either). */
  empty?: ReactNode;
  aside?: ReactNode;
  items: T[];
  id: (item: T) => string;
  /** sessionStorage key of the items put off; none: no "later". */
  laterKey?: string;
  onIgnore: (item: T) => Promise<unknown>;
  /** The dismissing action: its label and the side it is swiped to. */
  dismiss?: { label: string; side: 'left' | 'right' };
  render: (item: T) => ReactNode;
}) {
  const [later, setLater] = useState<string[]>(() => (laterKey ? laterSaved(laterKey) : []));
  /** Ignored here, hidden at once (until the list is computed again). */
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const left = items.filter((x) => !ignored.has(id(x)));
  const item = left.find((x) => !later.includes(id(x)));
  const putOff = (x: T) => {
    if (!laterKey) return;
    const next = [...later.filter((k) => k !== id(x)), id(x)];
    sessionStorage.setItem(laterKey, JSON.stringify(next));
    setLater(next);
  };
  const ignore = async (x: T) => {
    setIgnored((s) => new Set(s).add(id(x)));
    await onIgnore(x);
  };
  const putOffCount = left.filter((x) => later.includes(id(x))).length;
  const dismissSide = (x: T) => ({ label: dismiss.label, action: () => ignore(x) });
  const laterSide = (x: T) => ({ label: t('Plus tard', 'Later'), action: () => putOff(x) });
  return (
    <section className="stack">
      <div className="home-head">
        <h3>{title}</h3>
        {aside}
      </div>
      {item ? (
        <>
          <SwipeRow key={id(item)} {...{ [dismiss.side]: dismissSide(item), ...(laterKey ? { [dismiss.side === 'left' ? 'right' : 'left']: laterSide(item) } : {}) }}>
            {render(item)}
          </SwipeRow>
          <div className="gap-deck-foot">
            <span className="muted small-text gap-deck-hint">
              {laterKey
                ? dismiss.side === 'right'
                  ? t(`Glissez à gauche : plus tard · à droite : ${dismiss.label.toLowerCase()}`, `Swipe left: later · right: ${dismiss.label.toLowerCase()}`)
                  : t(`Glissez à gauche : ${dismiss.label.toLowerCase()} · à droite : plus tard`, `Swipe left: ${dismiss.label.toLowerCase()} · right: later`)
                : dismiss.side === 'left'
                  ? t(`Glissez à gauche : ${dismiss.label.toLowerCase()}`, `Swipe left: ${dismiss.label.toLowerCase()}`)
                  : t(`Glissez à droite : ${dismiss.label.toLowerCase()}`, `Swipe right: ${dismiss.label.toLowerCase()}`)}
            </span>
            <span className="gap-deck-buttons">
              {laterKey && <Button size="sm" variant="ghost" onClick={() => putOff(item)}>{t('Plus tard', 'Later')}</Button>}
              <Button size="sm" variant="ghost" onClick={() => void ignore(item)}>{dismiss.label}</Button>
            </span>
          </div>
        </>
      ) : !left.length && empty ? (
        empty
      ) : (
        <p className="muted">
          {t('Plus de position pour l’instant.', 'No more position for now.')}{' '}
          {putOffCount > 0 && (
            <button type="button" className="link" onClick={() => (laterKey && sessionStorage.removeItem(laterKey), setLater([]))}>
              {t(`Revoir ${plural(putOffCount, 'la position remise', 'les positions remises')} à plus tard`, `See the ${plural(putOffCount, 'position', 'positions')} put off again`)}
            </button>
          )}
        </p>
      )}
    </section>
  );
}

/** Key of a missing move (its position and the opponent move). */
const gapId = (g: Gap) => `${g.fen}|${g.move!.uci}`;

/**
 * "Agrandissez votre répertoire !": the missing moves one at a time, most frequent first. Ignored,
 * the move is not worth preparing. A tap opens it in the editor to prepare the reply.
 */
function GapDeck({ gaps, reps }: { gaps: Gap[]; reps: Map<string, RepertoireSummary> }) {
  const qc = useQueryClient();
  return (
    <Deck
      title={t('Agrandissez votre répertoire !', 'Grow your repertoire!')}
      items={gaps}
      id={gapId}
      laterKey="e4e5.gapsLater"
      onIgnore={async (g) => {
        await api.ignoreGap(g.fen, g.move!.uci);
        void qc.invalidateQueries({ queryKey: ['gaps'] });
      }}
      render={(g) => <GapCard gap={g} rep={reps.get(g.repertoireId!)} />}
    />
  );
}

/** Training mistakes of the last days only. */
const TRAINING_DAYS = 7;
/** Training mistakes ignored (key with their time: a new mistake there comes back). */
const IGNORED_KEY = 'e4e5.trainingErrorsIgnored';
const ignoredSaved = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(IGNORED_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
};
const errorId = (e: ReviewError) => `${e.fen}|${e.uci}|${e.reviewedAt}`;

/**
 * "Revoir vos erreurs": my training mistakes (Réviser and Se tester) of the last days not
 * answered right since, active repertoires, the latest first, one at a time. Ignored, a mistake
 * is forgotten (it comes back if missed again). A tap trains the position again.
 */
function ErrorDeck({ reps }: { reps: Map<string, RepertoireSummary> }) {
  // From midnight TRAINING_DAYS days ago (a stable query key through the day).
  const since = dayOf(Date.now()) - TRAINING_DAYS * DAY;
  const training = useQuery({ queryKey: ['training-errors', since], queryFn: () => api.trainingErrors(since), staleTime: 0 });
  const errors = useMemo(() => {
    const ignored = new Set(ignoredSaved());
    return (training.data ?? []).filter((e) => reps.get(e.repertoireId)?.active !== false && !ignored.has(errorId(e)));
  }, [training.data, reps]);
  if (!training.data) return null;
  return (
    <Deck
      title={t('Revoir vos erreurs', 'Review your mistakes')}
      items={errors}
      id={errorId}
      dismiss={{ label: t('C’est compris', 'Got it'), side: 'left' }}
      onIgnore={async (e) => localStorage.setItem(IGNORED_KEY, JSON.stringify([...ignoredSaved(), errorId(e)].slice(-500)))}
      empty={
        <div className="card home-empty">
          <span className="mode-icon"><Icon name="target" size={22} /></span>
          <span className="home-empty-text">
            <strong>{t('Aucune erreur à revoir', 'No mistake to review')}</strong>
            <span className="muted small-text">{t('Les coups manqués en révision ou en test viendront ici.', 'The moves you miss in review or in a test will come here.')}</span>
          </span>
          <Button size="sm" to="/train?mode=test">{t('Jouer une partie', 'Play a game')}</Button>
        </div>
      }
      render={(e) => <TrainingErrorCard error={e} rep={reps.get(e.repertoireId)} />}
    />
  );
}

/** "aujourd'hui", "hier", else the date. */
const whenText = (at: number) => {
  const diff = Math.round((dayOf(Date.now()) - dayOf(at)) / DAY);
  return diff === 0 ? t('aujourd’hui', 'today') : diff === 1 ? t('hier', 'yesterday') : new Date(at).toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' });
};

/**
 * A mistake of my training: the position, the moves I played instead (orange) and the move
 * expected (green); a tap trains it again.
 */
function TrainingErrorCard({ error, rep }: { error: ReviewError; rep: RepertoireSummary | undefined }) {
  const to = `/r/${error.repertoireId}/train?${new URLSearchParams({ mode: 'review', from: error.fen })}`;
  const move = error.uci ? playUci(error.fen, error.uci) : null;
  const wrong = [...new Set(error.played)].filter((u) => u !== error.uci).flatMap((u) => {
    const m = playUci(error.fen, u);
    return m ? [{ uci: u, san: m.san }] : [];
  });
  const mode = error.mode === 'test' ? t('en test', 'in a test') : t('en révision', 'in review');
  return (
    <Link to={to} className="card home-gap" draggable={false}>
      <MiniBoard
        fen={error.fen}
        orientation={error.color}
        arrows={[...wrong.map((w) => ({ uci: w.uci, kind: 'played' as const })), ...(error.uci ? [{ uci: error.uci, kind: 'repertoire' as const }] : [])]}
      />
      <span className="home-gap-text">
        {wrong.length > 0 && (
          <>
            {t('Vous avez joué ', 'You played ')}
            {wrong.map((w, i) => (
              <span key={w.uci}>
                {i > 0 && (i === wrong.length - 1 ? t(' puis ', ' then ') : ', ')}
                <strong className="hole-move"><San san={w.san} /></strong>
              </span>
            ))}
            {' · '}
          </>
        )}
        {t(
          <>Manqué {mode} {whenText(error.reviewedAt)} : le coup attendu était <strong>{move ? <San san={move.san} /> : '?'}</strong>. Rejouez-le.</>,
          <>Missed {mode} {whenText(error.reviewedAt)}: the expected move was <strong>{move ? <San san={move.san} /> : '?'}</strong>. Play it again.</>,
        )}
        {rep && <span className="muted small-text"> · {rep.name}</span>}
      </span>
    </Link>
  );
}

/**
 * A missing move: the position (the move in orange) and the chapter it comes up in (the first one,
 * when several reach it); a tap opens it in the editor to prepare the reply.
 */
function GapCard({ gap, rep }: { gap: Gap; rep: RepertoireSummary | undefined }) {
  const to = `/r/${gap.repertoireId}?${new URLSearchParams({ line: gap.ucis.join(','), gap: '1' })}`;
  const detail = useQuery({ queryKey: ['repertoire', gap.repertoireId], queryFn: () => api.repertoire(gap.repertoireId!), enabled: !!gap.repertoireId });
  const d = detail.data;
  const chapter = d ? chapterForPosition(d.color, d.chapters, d.moves, gap.fen)?.chapter.name : undefined;
  const where = chapter ?? rep?.name;
  const move = moveText(gap.line, gap.move!.san, true);
  return (
    <Link to={to} className="card home-gap" draggable={false}>
      <MiniBoard fen={gap.fen} orientation={rep?.color ?? 'white'} arrows={[{ uci: gap.move!.uci, kind: 'popular' }]} />
      <span className="home-gap-text">
        {where
          ? t(<>Dans <strong>{where}</strong>, préparez votre réponse contre <strong className="hole-move">{move}</strong></>, <>In <strong>{where}</strong>, prepare your reply to <strong className="hole-move">{move}</strong></>)
          : t(<>Préparez votre réponse contre <strong className="hole-move">{move}</strong></>, <>Prepare your reply to <strong className="hole-move">{move}</strong></>)}
      </span>
    </Link>
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
