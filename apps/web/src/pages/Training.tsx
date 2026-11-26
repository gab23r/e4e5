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
import { useOpponent } from '../opponent';
import { useTrainingSources, type Source } from '../training/useTrainingSources';

type Mode = 'review' | 'play';

/**
 * Training page, for one repertoire (/r/:id/train, optionally ?chapter=<id> for one of its
 * chapters, ?from=<fen> for a subtree) or all of them (/train). The spaced-repetition review by
 * default; ?mode=test: playing lines against a fictional opponent of my level (from the home page).
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
  // The review, unless ?mode=test.
  const mode: Mode = params.get('mode') === 'test' ? 'play' : 'review';
  const opponent = useOpponent(me);
  const setMode = (m: Mode) => {
    const q = new URLSearchParams(params);
    q.set('mode', m === 'play' ? 'test' : 'review');
    setParams(q);
  };
  const [counts, setCounts] = useState({ dueLines: 0, freshLines: 0, reviewed: 0, asked: 0, firstTry: 0 });
  const onCounts = useCallback((c: typeof counts) => setCounts(c), []);
  const [playScore, setPlayScore] = useState<PlayScore>({ lines: 0, moves: 0, asked: 0, clean: 0 });
  const onReview = (as: TrainingMode) => (source: Source, fen: string, uci: string, grade: Grade, played?: string[]) => review.mutate({ source, fen, uci, grade, mode: as, played });

  if (all.isLoading || loading || (shortening && gaps.isLoading)) return <p className="muted">{t('Chargement…', 'Loading…')}</p>;
  if (id && !sources.length) return <p className="error">{t('Impossible de charger le répertoire.', 'Could not load the repertoire.')}</p>;

  const fromPath = from && sources[0] ? sources[0].positions.find((p) => p.fen === from)?.path : undefined;
  const title = id ? (all.data?.find((r) => r.id === id)?.name ?? sources[0]?.name ?? '') : t('Tous les répertoires actifs', 'All active repertoires');

  return (
    <div className="training">
      <PageHeader
        back={id ? `/r/${id}${chapter ? `?chapter=${chapter}` : ''}` : mode === 'play' ? '/' : undefined}
        title={mode === 'review' ? t('Réviser', 'Review') : t(`Contre ${opponent.name} (${opponent.elo})`, `Against ${opponent.name} (${opponent.elo})`)}
        subtitle={
          mode === 'review'
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

      {mode === 'review' && (
        <p className="muted small-text mode-hint">
          {t('Les positions à revoir aujourd’hui, au bon moment pour les retenir.', 'The positions due today, at the right time to remember them.')}
        </p>
      )}

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
          ratings={opponent.ratings}
          onReview={onReview('test')}
          onScore={setPlayScore}
          sessionKey={`play|${sessionKey}`}
          bot={{
            name: opponent.name,
            intro: t(
              `Sur ce que tu as appris, sans aide, comme en partie : je joue les coups les plus fréquents des joueurs ${opponent.chosen ? `autour de ${opponent.elo}` : 'de ton niveau'}. Deux erreurs sur un coup et je gagne !`,
              `On what you have learnt, without help, as in a game: I play the most frequent moves of players ${opponent.chosen ? `around ${opponent.elo}` : 'of your level'}. Two mistakes on a move and I win!`,
            ),
          }}
        />
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
