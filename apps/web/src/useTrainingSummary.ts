import { countSummary, recallOf, type PreparedSummary, type RepertoireSummaryCounts } from '@e4e5/core';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, type Me } from './api';
import { cardsQuery } from './offline/reviews';
import { preparedOf } from './training/graphCache';
import { dayStart, useSettings } from './settings';
import { useGapReach } from './useGaps';

const minute = () => Math.floor(Date.now() / 60_000) * 60_000;

/**
 * The current time to the minute, updated every minute (positions become due as time passes).
 * Rounded so that every user of the summary in the same minute shares the same computation.
 */
function useMinute(): number {
  const [now, setNow] = useState(minute);
  useEffect(() => {
    const timer = setInterval(() => setNow(minute()), 10_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** The last summary counted, shared by the hooks (badge, pages) asking with the same inputs. */
let last: { prepared: PreparedSummary[]; cards: unknown; key: string; value: RepertoireSummaryCounts[] } | null = null;

/**
 * Training summary per repertoire (lines to review, new lines today), with the user's settings:
 * new lines per day, and the depth of the lines (the gap report gives the probabilities; also the
 * positions trained at each depth). Computed on the device from the repertoires, the move cards
 * and the gap report (core trainingSummary): right offline, and at once after an answer. Loading
 * it loads every repertoire, which keeps them all on the device for offline training.
 */
export function useTrainingSummary(me: Me | undefined): { data: RepertoireSummaryCounts[] | undefined } {
  const { newPerDay, lineDepth, mainMoveOnly } = useSettings();
  const list = useQuery({ queryKey: ['repertoires'], queryFn: api.repertoires, enabled: !!me });
  const reps = useQueries({
    queries: (list.data ?? []).map((r) => ({ queryKey: ['repertoire', r.id], queryFn: () => api.repertoire(r.id), enabled: !!me })),
  });
  const cards = useQuery({ ...cardsQuery, enabled: !!me });
  const gaps = useGapReach(me);
  const now = useMinute();
  const repsVersion = reps.map((q) => q.dataUpdatedAt).join();

  // What does not depend on the cards: built once per repertoire version (graphCache).
  const prepared = useMemo(() => {
    if (!list.data || reps.some((q) => !q.data)) return undefined;
    // Shortened lines need the probabilities: wait for them (unless they cannot be had).
    if (lineDepth > 0 && gaps.isLoading) return undefined;
    return reps.map((q) => preparedOf(q.data!, gaps.reach?.[q.data!.color], lineDepth, mainMoveOnly));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data, repsVersion, gaps.reach, gaps.isLoading, lineDepth, mainMoveOnly]);

  // The counts, after every answer: cheap, and computed once for all the hooks.
  const data = useMemo(() => {
    if (!prepared || !cards.data) return undefined;
    const key = `${dayStart(new Date(now))}|${newPerDay}|${now}`;
    if (last && last.cards === cards.data && last.key === key && last.prepared.length === prepared.length && last.prepared.every((p, i) => p === prepared[i])) {
      return last.value;
    }
    const at = new Date(now);
    const cardMap = new Map(
      cards.data.map((c) => [
        `${c.fen} ${c.uci}`,
        { due: Date.parse(c.due), createdAt: Date.parse(c.createdAt), recall: c.fsrs ? recallOf(c.fsrs, c.reps, at) : c.recall },
      ]),
    );
    const value = countSummary(prepared, (fen, uci) => cardMap.get(`${fen} ${uci}`), { dayStart: dayStart(new Date(now)), newPerDay, now });
    last = { prepared, cards: cards.data, key, value };
    return value;
  }, [prepared, cards.data, newPerDay, now]);
  return { data };
}
