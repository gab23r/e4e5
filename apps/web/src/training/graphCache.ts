/**
 * Repertoire graphs (chapters merged) and what follows from them alone, built once per repertoire version and
 * shared by every page (training, summary badge, progress): an answer only changes the cards,
 * so nothing here is rebuilt after it. Keys are the objects themselves (the repertoire as cached
 * by React Query, the reach probabilities of a gap report): a refetch gives new objects, the old
 * entries go with them (WeakMap).
 */
import {
  keptPositions,
  mergeChapterMoves,
  prepareSummary,
  trainingRepertoire,
  type Repertoire,
  trainingPositions,
  trainingPositionsFrom,
  type PreparedSummary,
  type TrainingPosition,
} from '@e4e5/core';
import type { RepertoireDetail, StoredMove } from '../api';

const trained = new WeakMap<RepertoireDetail, Map<string, { moves: StoredMove[]; graph: Repertoire }>>();
const allPositions = new WeakMap<Repertoire, TrainingPosition[]>();
const fromPositions = new WeakMap<Repertoire, Map<string, TrainingPosition[]>>();
const kept = new WeakMap<TrainingPosition[], WeakMap<object, Map<number, Set<string>>>>();
const prepared = new WeakMap<RepertoireDetail, Map<string, { probs: object | undefined; value: PreparedSummary }>>();

/**
 * The moves trained in a repertoire and their graph (paused moves left out; `mainOnly`: only my
 * main move where I have several, Paramètres): its active chapters merged (all of them when
 * every chapter is paused), or one chapter (`chapterId`).
 */
function trainedOf(detail: RepertoireDetail, chapterId?: string | null, mainOnly = false) {
  let byChapter = trained.get(detail);
  if (!byChapter) trained.set(detail, (byChapter = new Map()));
  const key = `${chapterId ?? ''}|${mainOnly}`;
  let hit = byChapter.get(key);
  if (!hit) {
    let moves: StoredMove[];
    if (chapterId) moves = detail.moves.filter((m) => m.chapterId === chapterId);
    else {
      const active = detail.chapters.filter((c) => c.active);
      const used = new Set((active.length ? active : detail.chapters).map((c) => c.id));
      moves = mergeChapterMoves(detail.moves.filter((m) => used.has(m.chapterId)));
    }
    byChapter.set(key, (hit = { moves, graph: trainingRepertoire(detail.color, moves, { mainOnly }) }));
  }
  return hit;
}

/** The graph of a repertoire (or of one of its chapters), as trained (paused moves left out). */
export function graphOf(detail: RepertoireDetail, chapterId?: string | null, mainOnly = false): Repertoire {
  return trainedOf(detail, chapterId, mainOnly).graph;
}

/** The moves of a repertoire (or of one of its chapters) as trained, paused ones included. */
export function movesOf(detail: RepertoireDetail, chapterId?: string | null): StoredMove[] {
  return trainedOf(detail, chapterId).moves;
}

/** Every position where it is my turn (core trainingPositions). */
export function positionsOf(rep: Repertoire): TrainingPosition[] {
  let p = allPositions.get(rep);
  if (!p) allPositions.set(rep, (p = trainingPositions(rep)));
  return p;
}

/** The positions of the subtree of `from` (core trainingPositionsFrom). */
export function positionsFrom(rep: Repertoire, from: string): TrainingPosition[] {
  let byFrom = fromPositions.get(rep);
  if (!byFrom) fromPositions.set(rep, (byFrom = new Map()));
  let p = byFrom.get(from);
  if (!p) byFrom.set(from, (p = trainingPositionsFrom(rep, from)));
  return p;
}

/** Positions kept at the depth of the lines (core keptPositions), for one map of probabilities. */
export function keptOf(positions: TrainingPosition[], probs: Record<string, number>, minReach: number): Set<string> {
  let byProbs = kept.get(positions);
  if (!byProbs) kept.set(positions, (byProbs = new WeakMap()));
  let byDepth = byProbs.get(probs);
  if (!byDepth) byProbs.set(probs, (byDepth = new Map()));
  let set = byDepth.get(minReach);
  if (!set) byDepth.set(minReach, (set = keptPositions(positions, (f) => probs[f], minReach)));
  return set;
}

/** The part of the training summary that does not depend on the cards (core prepareSummary). */
export function preparedOf(detail: RepertoireDetail, probs: Record<string, number> | undefined, depth: number, mainOnly = false): PreparedSummary {
  let byDepth = prepared.get(detail);
  if (!byDepth) prepared.set(detail, (byDepth = new Map()));
  const key = `${depth}|${mainOnly}`;
  const hit = byDepth.get(key);
  if (hit && hit.probs === probs) return hit.value;
  const graph = graphOf(detail, null, mainOnly);
  const value = prepareSummary({ id: detail.id, active: detail.active, graph, all: positionsOf(graph) }, probs, depth);
  byDepth.set(key, { probs, value });
  return value;
}
