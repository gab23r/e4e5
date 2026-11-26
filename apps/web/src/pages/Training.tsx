import { positionFromFen, START_FEN, type Color } from '@e4e5/core';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, type Grade, type Me, type TrainingMode } from '../api';
import { explorerParams, useSettings } from '../settings';
import { useTrainingSummary } from '../useTrainingSummary';
import { useGaps, useGapReach } from '../useGaps';
import { Button, PageHeader, plural } from '../ui';
import { fmt, t } from '../i18n';
import { lineText } from '../training/common';
import { PlayMode, type PlayScore } from '../training/PlayMode';
import { Progress } from '../training/Progress';
import { ReviewMode } from '../training/ReviewMode';
import { TrainingHub } from '../training/TrainingHub';
import { useTrainingSources, type Source } from '../training/useTrainingSources';

type Mode = 'review' | 'play';

/**
 * Training page, for one repertoire (/r/:id/train, optionally ?chapter=<id> for one of its
 * chapters, ?from=<fen> for a subtree) or all of them (/train). Without ?mode=, the choice of the
 * mode (TrainingHub); ?mode=review: spaced-repetition review; ?mode=test: playing lines against the app.
 */
export function Training({ me }: { me: Me }) {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const fromParam = id ? params.get('from') : null;
  // ?chapter=<id>: only this chapter of the repertoire.
  const chapter = id ? params.get('chapter') : null;
  const from = useMemo(() => {
    if (!fromParam) return null;
    try {
      positionFromFen(fromParam);
      return fromParam;
    } catch {
      return null;
    }
  }, [fromParam]);

  const all = useQuery({ queryKey: ['repertoires'], queryFn: api.repertoires });
  // All repertoires: the active ones only (paused ones are left out).
  const ids = useMemo(() => (id ? [id] : (all.data ?? []).filter((r) => r.active).map((r) => r.id)), [id, all.data]);
  const { newPerDay, speed, range, learnOrder, lineDepth } = useSettings();
  // Reach probabilities at the user's level (gap finder): order of the new positions (when
  // learning by frequency), branch followed to finish a line, and shortened lines.
  const gaps = useGaps(me);
  // The probabilities for the heavy computations: they change at most once a minute while
  // statistics are fetched (the report itself changes at every poll).
  const { reach } = useGapReach(me);
  // Depth of the lines (Paramètres), also when training a chosen part (?from=); whole lines
  // without statistics.
  const shortening = lineDepth > 0;
  const shorten = useMemo(
    () => (shortening && reach ? { minReach: lineDepth, probs: (color: Color) => reach[color] } : null),
    [shortening, lineDepth, reach],
  );
  const { sources, loading, review } = useTrainingSources(ids, from, shorten, chapter);
  // The daily limit of new lines is shared by all repertoires: lines learnt today elsewhere count.
  const summary = useTrainingSummary(me);
  const learntElsewhere = (summary.data ?? []).filter((s) => !ids.includes(s.repertoireId)).reduce((n, s) => n + s.learntTodayLines, 0);
  const reachOf = useMemo(() => {
    if (learnOrder !== 'frequency' || !reach) return undefined;
    return (source: Source, fen: string) => reach[source.color]?.[fen];
  }, [learnOrder, reach]);
  const chanceOf = useMemo(() => {
    if (!reach) return undefined;
    return (source: Source, fen: string) => reach[source.color]?.[fen];
  }, [reach]);
  const ex = explorerParams(me, speed, range);
  // The session is kept while the page is left (explorer, other mode), per scope.
  const sessionKey = `${ids.join()}|${chapter ?? ''}|${from ?? ''}`;
  // No mode: the choice of the mode (hub); ?mode=review / ?mode=test: a session.
  const modeParam = params.get('mode');
  const mode: Mode | null = modeParam === 'test' ? 'play' : modeParam === 'review' ? 'review' : null;
  /** The address of a session of this mode, same repertoires (and chapter, part). */
  const sessionHref = (m: 'review' | 'test') => {
    const q = new URLSearchParams(params);
    q.set('mode', m);
    return `${id ? `/r/${id}` : ''}/train?${q}`;
  };
  const setMode = (m: Mode) => {
    const q = new URLSearchParams(params);
    q.set('mode', m === 'play' ? 'test' : 'review');
    setParams(q);
  };
  const [counts, setCounts] = useState({ dueLines: 0, freshLines: 0, reviewed: 0, asked: 0, firstTry: 0 });
  const onCounts = useCallback((c: typeof counts) => setCounts(c), []);
  const [playScore, setPlayScore] = useState<PlayScore>({ lines: 0, moves: 0, asked: 0, clean: 0 });
  const onReview = (as: TrainingMode) => (source: Source, fen: string, uci: string, grade: Grade) => review.mutate({ source, fen, uci, grade, mode: as });

  // The hub shows at once (its weak points fill in when the repertoires are loaded); a session waits.
  if (all.isLoading || (mode && (loading || (shortening && gaps.isLoading)))) return <p className="muted">{t('Chargement…', 'Loading…')}</p>;
  if (id && (mode ? !sources.length : !all.data?.some((r) => r.id === id))) return <p className="error">{t('Impossible de charger le répertoire.', 'Could not load the repertoire.')}</p>;

  const fromPath = from && sources[0] ? sources[0].positions.find((p) => p.fen === from)?.path : undefined;
  const title = id ? (all.data?.find((r) => r.id === id)?.name ?? sources[0]?.name ?? '') : t('Tous les répertoires actifs', 'All active repertoires');

  return (
    <div className="training">
      <PageHeader
        back={mode ? `${id ? `/r/${id}` : ''}/train${chapter ? `?chapter=${chapter}` : ''}` : id ? `/r/${id}${chapter ? `?chapter=${chapter}` : ''}` : undefined}
        title={mode === 'review' ? t('Réviser', 'Review') : mode === 'play' ? t('Se tester', 'Test yourself') : t('Entraînement', 'Training')}
        subtitle={
          !mode
            ? title
            : mode === 'review'
            ? `${title} · ${t(`${plural(counts.dueLines, 'ligne', 'lignes')} à revoir`, `${plural(counts.dueLines, 'line', 'lines')} due`)} · ${t(plural(counts.freshLines, 'nouvelle', 'nouvelles'), `${fmt(counts.freshLines)} new`)}${
                counts.reviewed > 0
                  ? ` · ${t(plural(counts.reviewed, 'réponse', 'réponses'), plural(counts.reviewed, 'answer', 'answers'))}${counts.asked > 0 ? firstTryText(counts.firstTry, counts.asked) : ''}`
                  : ''
              }`
            : `${title}${
                playScore.moves > 0
                  ? `${playScore.lines > 0 ? ` · ${t(plural(playScore.lines, 'ligne', 'lignes'), plural(playScore.lines, 'line', 'lines'))}` : ''} · ${t(plural(playScore.moves, 'coup', 'coups'), plural(playScore.moves, 'move', 'moves'))}${playScore.asked > 0 ? firstTryText(playScore.clean, playScore.asked) : ''}`
                  : ''
              }`
        }
      />
      {!mode ? (
        <TrainingHub id={id} reps={all.data ?? []} summary={summary.data} sources={sources} sessionHref={sessionHref} />
      ) : (
      <>
      {from && (
        <p className="muted from">
          {t(
            <>Seulement les lignes après <strong>{fromPath ? lineText(fromPath) : 'cette position'}</strong>.</>,
            <>Only the lines after <strong>{fromPath ? lineText(fromPath) : 'this position'}</strong>.</>,
          )}{' '}
          <Button size="sm" variant="ghost" onClick={() => setParams(chapter ? { chapter } : {})}>{t('Tout entraîner', 'Train everything')}</Button>
        </p>
      )}
      {shortening && <ShortenNotice gaps={gaps} colors={[...new Set(sources.map((s) => s.color))]} />}

      <p className="muted small-text mode-hint">
        {mode === 'review'
          ? t('Les positions à revoir aujourd’hui, au bon moment pour les retenir.', 'The positions due today, at the right time to remember them.')
          : t(
              'Sur ce que vous avez appris, sans aide : l’adversaire joue les coups les plus fréquents à votre niveau, comme en partie.',
              'On what you have learnt, without help: the opponent plays the most frequent moves at your level, as in a game.',
            )}
      </p>

      {mode === 'review' ? (
        <ReviewMode
          sources={sources}
          newPerDay={newPerDay}
          noNewLimit={!!from}
          onReview={onReview('review')}
          onCounts={onCounts}
          onTest={() => setMode('play')}
          reachOf={reachOf}
          chanceOf={chanceOf}
          learntElsewhere={learntElsewhere}
          sessionKey={`review|${sessionKey}`}
          idle={<Progress sources={sources} />}
        />
      ) : (
        <PlayMode
          key={`${ids.join()}-${chapter ?? ''}-${from ?? ''}`}
          sources={sources}
          root={from ?? sources[0]?.root ?? START_FEN}
          speeds={ex.speeds}
          ratings={ex.ratings}
          onReview={onReview('test')}
          onLearn={() => setMode('review')}
          onScore={setPlayScore}
          sessionKey={`play|${sessionKey}`}
        />
      )}
      </>
      )}
    </div>
  );
}

/** " (62 % du premier coup)" / " (62% first try)". */
const firstTryText = (n: number, asked: number) => {
  const pct = Math.round((100 * n) / asked);
  return t(` (${pct} % du premier coup)`, ` (${pct}% first try)`);
};

/** Without statistics (error), nothing is cut: says so. */
function ShortenNotice({ gaps, colors }: { gaps: ReturnType<typeof useGaps>; colors: Color[] }) {
  const reports = colors.map((c) => gaps.data?.[c]).filter((r) => !!r);
  const settings = <Link to="/settings#training">{t('Paramètres', 'Settings')}</Link>;
  if (gaps.isError || (gaps.data && !reports.length)) {
    return (
      <p className="notice error small-text">
        {t(
          <>Statistiques indisponibles : les lignes ne sont pas raccourcies, toutes les positions sont entraînées ({settings}).</>,
          <>Statistics unavailable: the lines are not shortened, all the positions are trained ({settings}).</>,
        )}
      </p>
    );
  }
  return null;
}
