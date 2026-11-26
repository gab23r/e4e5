import { positionReview, START_FEN, type Color, type Repertoire, type RepMove, type TrainingPosition } from '@e4e5/core';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, type Grade, type ReviewCard, type TrainingMode } from '../api';
import { cardsQuery, recordReview } from '../offline/reviews';
import { chapterRoot } from '../chapters';
import { useSettings } from '../settings';
import { graphOf, keptOf, movesOf, positionsFrom, positionsOf } from './graphCache';

/** Summary of the cards of my moves in a position (several moves: the weakest). */
export interface PositionCard {
  /** Mean estimated probability of finding each move now (0 for a move not learnt yet). */
  recall: number;
  /** Earliest next review (ms). */
  due: number;
  /** Shortest interval in days (0 while learning). */
  interval: number;
  /** Most lapses of a move. */
  lapses: number;
  /** Every move of the position is learnt. */
  complete: boolean;
}

/** A repertoire (or one of its chapters) being trained, with its positions; review state comes from the user's move cards. */
export interface Source {
  /** The repertoire (answers are recorded for it). */
  id: string;
  name: string;
  /** Where its lines start (a chapter can start at a position). */
  root: string;
  color: Color;
  rep: Repertoire;
  /** Positions to train (limited to the subtree of `from` when given). */
  positions: TrainingPosition[];
  /** Card of one of my moves (learnt in this repertoire or another one). */
  cardOf: (fen: string, uci: string) => ReviewCard | undefined;
  /** What a position needs now: due, new or learnt, and the moves to ask (see core positionReview). */
  stateOf: (fen: string, now: number) => ReturnType<typeof positionReview>;
  /** Summary of the cards of my moves in a position; undefined: none learnt. */
  positionCard: (fen: string) => PositionCard | undefined;
  /** My moves of a position put on pause (left out of the training, still in the repertoire). */
  pausedAt: (fen: string) => RepMove[];
}

const cardKey = (fen: string, uci: string) => `${fen} ${uci}`;

/** Lines stopped at the positions coming up in at least `minReach` of the games (`probs`: per colour). */
export interface Shorten {
  minReach: number;
  probs: (color: Color) => Record<string, number> | undefined;
}

/**
 * Loads the repertoires `ids` and the user's move cards; `review` records an answer. With
 * `shorten`, only the positions kept by core keptPositions are trained. `chapter`: only this
 * chapter of the (single) repertoire.
 */
export function useTrainingSources(ids: string[], from: string | null, shorten?: Shorten | null, chapter?: string | null) {
  const qc = useQueryClient();
  // Only my main move where I have several (Paramètres).
  const { mainMoveOnly } = useSettings();
  const repQueries = useQueries({
    queries: ids.map((id) => ({ queryKey: ['repertoire', id], queryFn: () => api.repertoire(id) })),
  });
  const cardQuery = useQuery(cardsQuery);
  const loading = repQueries.some((q) => q.isLoading) || cardQuery.isLoading;
  const version = repQueries.map((q) => q.dataUpdatedAt).join();

  const cards = useMemo(() => new Map((cardQuery.data ?? []).map((c) => [cardKey(c.fen, c.uci), c])), [cardQuery.data]);

  // The graphs and positions: only when a repertoire changes, not after an answer (graphCache).
  const trained = useMemo(
    () =>
      ids.flatMap((id, i) => {
        const data = repQueries[i]?.data;
        if (!data) return [];
        const info = chapter ? data.chapters.find((c) => c.id === chapter) : undefined;
        const rep = graphOf(data, info?.id, mainMoveOnly);
        const root = info ? chapterRoot(info) : START_FEN;
        const probs = shorten && shorten.minReach > 0 ? shorten.probs(data.color) : undefined;
        const kept = probs ? keptOf(positionsOf(rep), probs, shorten!.minReach) : null;
        const positions = positionsFrom(rep, from ?? root);
        // Paused moves by position: played in training, they are not a mistake (try again).
        const paused = new Map<string, RepMove[]>();
        for (const m of movesOf(data, info?.id)) if (m.paused) paused.set(m.fromFen, [...(paused.get(m.fromFen) ?? []), m]);
        const name = info && info.name !== data.name ? `${data.name} › ${info.name}` : data.name;
        return [{ id, data, name, root, rep, paused, positions: kept ? positions.filter((p) => kept.has(p.fen)) : positions }];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ids.join(), version, from, shorten, chapter, mainMoveOnly],
  );

  // The review state, after every answer: only small functions reading the cards.
  const sources = useMemo<Source[]>(
    () =>
      trained.map(({ id, data, name, root, rep, paused, positions }) => {
        const cardOf = (fen: string, uci: string) => cards.get(cardKey(fen, uci));
        const times = (fen: string) => (uci: string) => {
          const c = cardOf(fen, uci);
          return c && { due: Date.parse(c.due), createdAt: Date.parse(c.createdAt) };
        };
        return {
          id,
          name,
          root,
          color: data.color,
          rep,
          positions,
          pausedAt: (fen) => paused.get(fen) ?? [],
          cardOf,
          stateOf: (fen, now) => positionReview(rep.movesAt(fen), times(fen), now),
          positionCard: (fen) => {
            const moves = rep.movesAt(fen);
            const known = moves.map((m) => cardOf(fen, m.uci)).filter((c) => !!c);
            if (!known.length) return undefined;
            return {
              recall: known.reduce((n, c) => n + c.recall, 0) / moves.length,
              due: Math.min(...known.map((c) => Date.parse(c.due))),
              interval: Math.min(...known.map((c) => c.interval)),
              lapses: Math.max(...known.map((c) => c.lapses)),
              complete: known.length === moves.length,
            };
          },
        } satisfies Source;
      }),
    [trained, cards],
  );

  /** Records an answer: scheduled on the device at once, then recorded in the database. */
  const review = {
    mutate: ({ source, fen, uci, grade, mode }: { source: Source; fen: string; uci: string; grade: Grade; mode: TrainingMode }) =>
      recordReview(qc, source.cardOf(fen, uci), { repertoireId: source.id, fen, uci, grade, mode }),
  };

  return { sources, loading, review };
}
