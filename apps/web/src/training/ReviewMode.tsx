import { groupLines, lineStarts, type Repertoire, type RepMove, type TrainingPosition } from '@e4e5/core';
import type { Key } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Grade } from '../api';
import { Board } from '../components/Board';
import { San } from '../components/Nag';
import { OpeningName } from '../components/OpeningName';
import { dayStart } from '../settings';
import { answerArrows, inTime, JUMP_MS, REPLAY_MS, REPLAYED_PLIES, REPLY_MS, savedSession, saveSession } from './common';
import { DrillActions, LineDone, QuizLine, SwipeBar, useMyMovesHere, type TrailDot, type TrailResult } from './DrillParts';
import { outcomeOf, type Outcome } from './Feedback';
import type { Source } from './useTrainingSources';
import { fmt, plural, t } from '../i18n';

interface Item {
  source: Source;
  target: TrainingPosition;
}

interface Question extends Item {
  /** The move asked: one of my moves to review (or to learn), at random when several are. */
  expected: RepMove;
  /** The expected move is not learnt yet: it is shown. */
  isNew: boolean;
  /** When the line continues: my last move, then the opponent's reply leading to `target`. */
  lead?: { mine: RepMove; reply: RepMove };
  /** Replayed from the trail (id of the line's dot): nothing is recorded. */
  replay?: number;
}

/** A line of this session, a dot of the trail left of the swipe bar (tap: come back to it). */
interface TrailEntry extends TrailDot {
  /** Its questions answered, in order (each with the lead that led to it, to replay it as played). */
  questions: Question[];
  /** How each one was answered. */
  results: TrailResult[];
  /** Passed: the question it was passed at (asked for real when coming back to the line). */
  skippedAt?: Question;
}

const trailResult = (outcome: Outcome): TrailResult =>
  outcome === 'correct' || outcome === 'alternative' ? 'right' : outcome === 'new' ? 'new' : 'wrong';
/** A line is wrong as soon as one move was missed (even found afterwards), learnt when only new or right ones. */
const lineResult = (results: TrailResult[]): TrailResult =>
  results.includes('wrong') ? 'wrong' : results.every((r) => r === 'new') ? 'new' : 'right';

/** The training left while browsing the trail: its question, or what was to come after a pause. */
type Live = { question: Question | null } | { next: () => Question | null } | null;
/** The line being answered (`id`: a passed line taken up again, its dot replaced at the end). */
interface LineRef {
  id?: number;
  questions: Question[];
  results: TrailResult[];
}
/** reviewed: all answers; asked: positions already learnt; firstTry: asked and right first time. */
interface Stats {
  reviewed: number;
  asked: number;
  firstTry: number;
}

/** The session put aside when the page is left (explorer, other mode), to take it up again on return. */
interface SavedReview {
  trail: TrailEntry[];
  trailIds: number;
  cursor: number | null;
  current: Question | null;
  live: Live;
  line: LineRef;
  replay: { id: number; rest: Question[] } | null;
  answered: Map<string, number>;
  skipped: Set<string>;
  stats: Stats;
  extraNew: number;
  ahead: boolean;
}
/** Lines of the trail kept when the page is left (the one being replayed is always kept). */
const KEPT_LINES = 5;

/**
 * A saved session with the current versions of its repertoires (reloaded on return: cards and
 * moves may have changed). The question on the board is dropped when its position is no longer trained.
 */
function restore(s: SavedReview | undefined, sources: Source[]): SavedReview | undefined {
  if (!s) return undefined;
  const fix = (q: Question): Question => ({ ...q, source: sources.find((x) => x.id === q.source.id) ?? q.source });
  const fixAll = (qs: Question[]) => qs.map(fix);
  const trained = (q: Question) => q.replay !== undefined || q.source.positions.some((p) => p.fen === q.target.fen);
  const current = s.current && fix(s.current);
  const live = s.live;
  return {
    ...s,
    trail: s.trail.map((e) => ({ ...e, questions: fixAll(e.questions), skippedAt: e.skippedAt && fix(e.skippedAt) })),
    current: current && trained(current) ? current : null,
    live:
      live &&
      ('question' in live
        ? { question: live.question && fix(live.question) }
        : {
            next: () => {
              const q = live.next();
              return q && fix(q);
            },
          }),
    line: { ...s.line, questions: fixAll(s.line.questions) },
    replay: s.replay && { ...s.replay, rest: fixAll(s.replay.rest) },
  };
}

/** Why a line stops after my move: its end, the shortened lines, or a sequel already reviewed. */
type LineEnd = 'end' | 'cut' | 'done';
/** Pause on the end of a line before the next one. */
const LINE_END_MS = 1100;

/** Same position (cards belong to the user: the same position in two repertoires is one question). */
const same = (a: Item, b: Item) => a.target.fen === b.target.fen;
/**
 * A position answered less than this ago waits behind the others (FSRS learning steps make it due
 * again after a minute): it is not asked twice in a row while something else is to do.
 */
const RECENT_MS = 5 * 60_000;
/**
 * A position due within this delay is reviewed with the line it continues (and the answer
 * recorded): positions answered one after the other become due again seconds apart (learning
 * steps of 1 and 10 min), and the line would otherwise stop just before the next one.
 */
const SOON_MS = 10 * 60_000;

/** Plies from `from` to the nearest position of `targets` in the repertoire (Infinity: none). */
function distanceTo(rep: Repertoire, from: string, targets: Set<string>): number {
  const seen = new Set([from]);
  let frontier = [from];
  for (let d = 0; frontier.length; d++) {
    if (frontier.some((f) => targets.has(f))) return d;
    const next: string[] = [];
    for (const f of frontier) {
      for (const m of rep.movesAt(f)) {
        if (seen.has(m.toFen)) continue;
        seen.add(m.toFen);
        next.push(m.toFen);
      }
    }
    frontier = next;
  }
  return Infinity;
}

/**
 * One of `items` at random, weighted by `chance`. Unknown chances get a small weight (2% of the
 * known total); with none known: main line 2, others 1.
 */
function weightedPick<T>(items: T[], chance: (t: T) => number | undefined, isMain: (t: T) => boolean): T {
  const known = items.map((t) => chance(t) ?? 0);
  const sum = known.reduce((a, b) => a + b, 0);
  const weights = sum > 0 ? known.map((k) => (k > 0 ? k : 0.02 * sum)) : items.map((t) => (isMain(t) ? 2 : 1));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]!;
    if (r < 0) return items[i]!;
  }
  return items.at(-1)!;
}

/**
 * Spaced-repetition review: positions due first (oldest first), then new ones, following the
 * line when the opponent's reply leads to another position waiting to be asked. On demand,
 * "review ahead" continues with learnt positions that are not due yet (soonest first).
 */
export function ReviewMode({
  sources,
  newPerDay,
  onReview,
  onCounts,
  idle,
  onTest,
  reachOf,
  chanceOf,
  learntElsewhere = 0,
  noNewLimit = false,
  sessionKey,
}: {
  sources: Source[];
  newPerDay: number;
  /** All unseen positions are available (e.g. training a chosen subtree). */
  noNewLimit?: boolean;
  /** `played`: the wrong moves played before (UCI, in order). */
  onReview: (source: Source, fen: string, uci: string, grade: Grade, played?: string[]) => void;
  onCounts: (c: { dueLines: number; freshLines: number; reviewed: number; asked: number; firstTry: number }) => void;
  /** Shown when nothing is left to review. */
  idle: React.ReactNode;
  /** Switch to "Se tester" (offered when the review is done). */
  onTest?: () => void;
  /**
   * Probability of reaching a position at the user's level: when given, new positions are
   * learnt most likely first (a position always comes after the one leading to it, since the
   * probability decreases along a line); unknown ones come last, in the repertoire's order.
   */
  reachOf?: (source: Source, fen: string) => number | undefined;
  /**
   * Probability of reaching a position at the user's level (whatever the learning order): picks
   * the branch followed when several continue a line equally well.
   */
  chanceOf?: (source: Source, fen: string) => number | undefined;
  /** Lines learnt today in the repertoires not in this session (the daily limit is shared). */
  learntElsewhere?: number;
  /** The scope of the session: put aside under this key when the page is left, taken up on return. */
  sessionKey?: string;
}) {
  /** The session put aside when the page was left (e.g. for the explorer): back where it was. */
  const [saved] = useState(() => (sessionKey ? restore(savedSession<SavedReview>(sessionKey), sources) : undefined));
  const [extraNew, setExtraNew] = useState(saved?.extraNew ?? 0);
  const [ahead, setAhead] = useState(saved?.ahead ?? false);
  /** Positions (fen) answered in this session, and when last (not asked again when reviewing ahead). */
  const answered = useRef(saved?.answered ?? new Map<string, number>());
  /** Positions (fen) put aside with a swipe, whatever the repertoire (the cards are the user's). */
  const skipped = useRef(saved?.skipped ?? new Set<string>());
  /**
   * The lines of the session in order, finished or passed: the dots of the swipe bar, a history
   * browsed like back / forward (a swipe to the right: the line before; to the left: the next one,
   * then the training where it was).
   */
  const [trail, setTrail] = useState<TrailEntry[]>(saved?.trail ?? []);
  const trailIds = useRef(saved?.trailIds ?? 0);
  /** The line of the trail on the board (replayed, nothing recorded); null: the training itself. */
  const [cursor, setCursor] = useState<number | null>(saved?.cursor ?? null);
  /** The training left while browsing the trail. */
  const live = useRef<Live>(saved?.live ?? null);
  /** The line being answered. */
  const line = useRef<LineRef>(saved?.line ?? { questions: [], results: [] });
  /** The line of the trail being replayed: its questions left. */
  const replay = useRef<{ id: number; rest: Question[] } | null>(saved?.replay ?? null);
  /** Ends the line being answered: its dot (grey when passed at `skippedAt`). */
  const closeLine = (skippedAt?: Question) => {
    const l = line.current;
    line.current = { questions: [], results: [] };
    if (!l.questions.length && !skippedAt) return;
    const entry = { questions: l.questions, results: l.results, skippedAt, result: skippedAt ? ('passed' as const) : lineResult(l.results) };
    // A passed line answered after all (come back in the queue): its grey dot goes.
    const answeredHere = (e: TrailEntry) => e.result === 'passed' && !!e.skippedAt && l.questions.some((q) => same(q, e.skippedAt!));
    setTrail((t) => [...t.filter((e) => e.id !== l.id && !answeredHere(e)), { ...entry, id: ++trailIds.current }]);
  };
  const firstOf = (items: Item[]) => items.find((p) => !skipped.current.has(p.target.fen)) ?? items[0];
  const [stats, setStats] = useState<Stats>(saved?.stats ?? { reviewed: 0, asked: 0, firstTry: 0 });
  const [now, setNow] = useState(() => Date.now());
  const [current, setCurrent] = useState<Question | null>(saved?.current ?? null);
  const [round, setRound] = useState(0);
  const jumpTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** The line just ended with the last answer (a badge until the next one). */
  const [lineDone, setLineDone] = useState(false);

  // Learning steps are minutes long: re-check what is due regularly.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => {
      clearInterval(t);
      clearTimeout(jumpTimer.current);
    };
  }, []);

  const queue = useMemo(() => {
    const today0 = dayStart();
    const due: (Item & { at: number })[] = [];
    const upcoming: (Item & { at: number })[] = [];
    const reach = (item: Item) => reachOf?.(item.source, item.target.fen) ?? -1;
    // Everything in lines (a review always goes through a whole line). New lines: one daily
    // limit for all repertoires, minus the lines learnt today here and elsewhere.
    // A line learnt today in several repertoires (shared moves) counts once.
    const learntStarts = new Set<string>();
    const linesBySource: Item[][][] = [];
    for (const source of sources) {
      const state = new Map(source.positions.map((p) => [p.fen, source.stateOf(p.fen, now)]));
      const today = new Set(source.positions.filter((p) => (state.get(p.fen)!.learntAt ?? 0) >= today0).map((p) => p.fen));
      for (const p of lineStarts(source.positions.filter((p) => today.has(p.fen)), (f) => today.has(f))) learntStarts.add(p.fen);
      const unseenHere: Item[] = [];
      for (const target of source.positions) {
        const { status, at } = state.get(target.fen)!;
        if (status === 'new') unseenHere.push({ source, target });
        else if (status === 'due') due.push({ source, target, at });
        else upcoming.push({ source, target, at });
      }
      // Most likely first (stable sort: the repertoire's order for equal or unknown ones).
      if (reachOf) unseenHere.sort((a, b) => reach(b) - reach(a));
      const lines = groupLines(unseenHere.map((i) => ({ ...i, fen: i.target.fen, path: i.target.path })));
      linesBySource.push(lines.map((line) => line.map(({ source, target }) => ({ source, target }))));
    }
    const learntToday = learntElsewhere + learntStarts.size;
    const remaining = noNewLimit ? Infinity : Math.max(0, newPerDay + extraNew - learntToday);
    let chosen: Item[][];
    if (reachOf) {
      // By frequency: the most likely lines first, all repertoires together.
      chosen = linesBySource.flat().sort((a, b) => reach(b[0]!) - reach(a[0]!)).slice(0, remaining);
    } else {
      // Repertoire order: one line of each repertoire in turn, so that none is left behind.
      chosen = [];
      for (let k = 0; chosen.length < remaining && linesBySource.some((l) => l.length > k); k++) {
        for (const lines of linesBySource) if (lines[k] && chosen.length < remaining) chosen.push(lines[k]!);
      }
    }
    const fresh: Item[] = chosen.flat();
    const freshLines = chosen.length;
    const unseenLines = linesBySource.reduce((n, l) => n + l.length, 0) - freshLines;
    if (reachOf) fresh.sort((a, b) => reach(b) - reach(a));
    due.sort((a, b) => a.at - b.at);
    upcoming.sort((a, b) => a.at - b.at);
    const nextDue = upcoming[0] ? new Date(upcoming[0].at) : undefined;
    const early = upcoming.filter((p) => !answered.current.has(p.target.fen));
    const all: Item[] = [...due, ...fresh, ...(ahead ? early : [])];
    // Answered a moment ago: after the others (still asked when nothing else is left).
    const recent = (p: Item) => now - (answered.current.get(p.target.fen) ?? -Infinity) < RECENT_MS;
    const items = [...all.filter((p) => !recent(p)), ...all.filter(recent)];
    // To review: the lines formed by the due positions (per repertoire). New: the lines picked.
    const dueLines = sources.reduce((n, source) => {
      const set = new Set(due.filter((i) => i.source === source).map((i) => i.target.fen));
      return n + lineStarts(source.positions.filter((p) => set.has(p.fen)), (f) => set.has(f)).length;
    }, 0);
    return { due, fresh, items, unseenLines, nextDue, early: early.length, dueLines, freshLines };
  }, [sources, now, newPerDay, extraNew, noNewLimit, ahead, reachOf, learntElsewhere]);

  useEffect(() => {
    onCounts({ dueLines: queue.dueLines, freshLines: queue.freshLines, ...stats });
  }, [queue.dueLines, queue.freshLines, stats, onCounts]);

  const ask = (q: Question | null) => {
    setLineDone(false);
    setCurrent(q);
    setRound((r) => r + 1);
  };
  /** The latest version of a source (its cards change with each answer). */
  const latest = (source: Source) => sources.find((s) => s.id === source.id) ?? source;
  /**
   * Where to start the line of `item`: the highest position of the path leading to it that is to
   * review too (due now or within SOON_MS), so that both are reviewed in one go, the moves between
   * them asked on the way (nextAfter steers the line to `item`). Not a position put aside (swipe)
   * nor one answered a moment ago.
   */
  const lineStart = (item: Item): Item => {
    const source = latest(item.source);
    const horizon = Date.now() + SOON_MS;
    const now = Date.now();
    const byFen = new Map(source.positions.map((t) => [t.fen, t]));
    for (const m of item.target.path) {
      const t = byFen.get(m.fromFen);
      if (!t || t.fen === item.target.fen || skipped.current.has(t.fen)) continue;
      if (now - (answered.current.get(t.fen) ?? -Infinity) < RECENT_MS) continue;
      if (source.stateOf(t.fen, horizon).status === 'due') return { source, target: t };
    }
    return item;
  };
  const question = (item: Item, lead?: Question['lead']): Question => {
    const source = latest(item.source);
    const { fen } = item.target;
    // The moves to review (or to learn), else those due soon; none when finishing a line: any of them.
    const now = Date.now();
    const pending = source.stateOf(fen, now).pending;
    const soon = pending.length ? pending : source.stateOf(fen, now + SOON_MS).pending;
    const pool = soon.length ? soon : source.rep.movesAt(fen);
    const expected = pool[Math.floor(Math.random() * pool.length)]!;
    return { source, target: item.target, expected, isNew: !source.cardOf(fen, expected.uci), lead };
  };

  // First question, and questions becoming due while idle.
  useEffect(() => {
    const first = firstOf(queue.items);
    if (!current && first && !jumpTimer.current) ask(question(lineStart(first)));
  }, [current, queue.items]);

  /**
   * Next question after answering: a started line is always followed to its end, even when
   * its next positions are not due (or beyond the daily limit of new ones). When the
   * opponent has several replies, the branch reaching a position to review soonest.
   */
  const nextAfter = (done: Item, played: RepMove): { next: Question | null; end?: LineEnd } => {
    const items = queue.items.filter((p) => !same(p, done));
    const { source } = done;
    const pending = new Set(items.filter((p) => p.source.id === source.id).map((p) => p.target.fen));
    // Due soon (learning steps): reviewed with this line rather than alone a moment later.
    const horizon = Date.now() + SOON_MS;
    for (const t of source.positions) {
      if (t.fen !== done.target.fen && source.stateOf(t.fen, horizon).status === 'due') pending.add(t.fen);
    }
    const byFen = new Map(source.positions.map((t) => [t.fen, t]));
    // Opponent replies leading to a position to train, not already answered in this session
    // (unless it is waiting again in the queue).
    const options = source.rep.movesAt(played.toFen).flatMap((reply) => {
      const target = byFen.get(reply.toFen);
      if (!target || target.fen === done.target.fen) return [];
      if (!pending.has(target.fen) && answered.current.has(target.fen)) return [];
      return [{ reply, target, dist: distanceTo(source.rep, target.fen, pending) }];
    });
    if (options.length) {
      // The reply reaching a position to review soonest; ties: at random, weighted by the
      // probability of reaching each position in a game.
      const best = Math.min(...options.map((o) => o.dist));
      const tied = options.filter((o) => o.dist === best);
      const pick = weightedPick(tied, (o) => chanceOf?.(source, o.target.fen), (o) => !!o.reply.isMain);
      // The line as played (the previous moves, my move, the reply), not the path stored for the
      // position: reached by another move order (transposition), the board would jump to it.
      const target = { ...pick.target, path: [...done.target.path, played, pick.reply] };
      return { next: question({ source, target }, { mine: played, reply: pick.reply }) };
    }
    // The line stops here: cut (a position of mine follows in the repertoire but is not trained),
    // or every sequel was already reviewed in this session, or its real end.
    const replies = source.rep.movesAt(played.toFen);
    const end: LineEnd = replies.some((r) => source.rep.movesAt(r.toFen).length > 0 && !byFen.has(r.toFen))
      ? 'cut'
      : replies.some((r) => byFen.has(r.toFen))
        ? 'done'
        : 'end';
    const first = firstOf(items);
    return { next: first ? question(lineStart(first)) : null, end };
  };

  const record = (q: Question, outcome: Outcome, wrong?: string[]) => {
    line.current.questions.push(q);
    line.current.results.push(trailResult(outcome));
    // After an alternative (right too: the move asked could not be guessed, then shown): no
    // penalty, the move asked is graded as answered right.
    const right = outcome === 'correct' || outcome === 'alternative';
    const grade: Grade = right ? 'good' : 'again';
    answered.current.set(q.target.fen, Date.now());
    // Bonus position (asked to finish the line, not due soon): only a mistake is recorded, so a
    // right answer leaves its schedule unchanged. Due soon: recorded, so it does not come back alone.
    const card = latest(q.source).cardOf(q.target.fen, q.expected.uci);
    const bonus = card !== undefined && Date.parse(card.due) > Date.now() + SOON_MS;
    if (!(bonus && right)) onReview(q.source, q.target.fen, q.expected.uci, grade, wrong);
    setStats((s) => ({
      reviewed: s.reviewed + 1,
      asked: s.asked + (outcome === 'new' ? 0 : 1),
      firstTry: s.firstTry + (outcome === 'correct' || outcome === 'alternative' ? 1 : 0),
    }));
  };

  /** Another of my moves played instead of the one asked: right, graded good when it is due (soon). */
  const onAlternative = (q: Question, move: Pick<RepMove, 'uci'>) => {
    // Only a move of this repertoire is graded here (one of another repertoire: just not a mistake).
    if (!q.source.rep.movesAt(q.target.fen).some((m) => m.uci === move.uci)) return;
    const card = latest(q.source).cardOf(q.target.fen, move.uci);
    if (card && Date.parse(card.due) <= Date.now() + SOON_MS) onReview(q.source, q.target.fen, move.uci, 'good');
  };

  /** The question waiting for the pause between two lines (a swipe asks it at once), and how it is made. */
  const pending = useRef<(() => void) | null>(null);
  const pendingNext = useRef<(() => Question | null) | null>(null);
  /** Asks `next` after `ms` (or at once on a swipe). */
  const later = (next: () => Question | null, ms: number) => {
    const go = () => {
      clearTimeout(jumpTimer.current);
      jumpTimer.current = undefined;
      pending.current = null;
      pendingNext.current = null;
      setNow(Date.now());
      ask(next());
    };
    pending.current = go;
    pendingNext.current = next;
    jumpTimer.current = setTimeout(go, ms);
  };
  /** Stops the pause before the next question (browsing the trail). */
  const stopPending = () => {
    clearTimeout(jumpTimer.current);
    jumpTimer.current = undefined;
    pending.current = null;
    pendingNext.current = null;
  };

  /** The first question waiting (after a replay: back where the session was). */
  const firstWaiting = () => {
    const first = firstOf(queue.items);
    return first ? question(lineStart(first)) : null;
  };

  const onAnswered = (q: Question, played: RepMove, outcome: Outcome, wrong?: string[]) => {
    // A line replayed from the trail: its next question as played then (nothing recorded); at its
    // end, after the pause of a line's end, the next line of the trail (then the training).
    if (q.replay !== undefined) {
      const next = replay.current?.rest.shift();
      if (next) return ask({ ...next, isNew: false, replay: replay.current!.id });
      setLineDone(true);
      jumpTimer.current = setTimeout(() => {
        jumpTimer.current = undefined;
        browseNext.current();
      }, LINE_END_MS);
      return;
    }
    record(q, outcome, wrong);
    const { next, end } = nextAfter(q, played);
    if (next?.lead) return ask(next);
    closeLine();
    if (end) setLineDone(true);
    later(() => next, end ? LINE_END_MS : JUMP_MS);
  };

  /**
   * Swipe to the left (bar under the board): the next question now. During the pause after an answer, the one
   * waiting; while asked, this line is passed without recording anything (asked after the others).
   */
  /** The positions of the line of `q` from it (put aside by a swipe; by position: cards are the user's). */
  const lineKeys = (q: Item & { expected: RepMove }) => [q.target.fen, ...restOfLine(q.source, q.expected).map((m) => m.toFen)];
  const onSkip = (q: Question) => {
    if (cursor !== null) return browseNext.current();
    if (pending.current) return pending.current();
    closeLine(q);
    for (const k of lineKeys(q)) skipped.current.add(k);
    const items = queue.items.filter((p) => !same(p, q));
    const first = firstOf(items.filter((p) => !skipped.current.has(p.target.fen))) ?? firstOf(items);
    if (first && same(first, q)) return;
    setNow(Date.now());
    ask(first ? question(lineStart(first)) : null);
  };

  /**
   * The line `i` of the trail on the board: replayed from its first move, the opponent replying as
   * then (a passed line: up to the question it was passed at), nothing recorded (the review
   * schedule stays right; the moves to be found, not shown). The training is kept where it was.
   */
  const openAt = (i: number) => {
    const e = trail[i];
    if (!e) return;
    if (cursor === null) live.current = pendingNext.current ? { next: pendingNext.current } : { question: current };
    stopPending();
    setNow(Date.now());
    setCursor(i);
    const [first, ...rest] = e.result === 'passed' && e.skippedAt ? [...e.questions, e.skippedAt] : e.questions;
    if (!first) return;
    replay.current = { id: e.id, rest };
    ask({ ...first, lead: undefined, isNew: false, replay: e.id });
  };

  /** Browsing the trail: the next line, then the training where it was (latest render: called from a timer). */
  const browseNext = useRef(() => {});
  browseNext.current = () => {
    if (cursor === null) return;
    if (cursor + 1 < trail.length) openAt(cursor + 1);
    else backToTraining();
  };

  /** Back to the training, where it was left (the same question, or the one that was coming). */
  const backToTraining = () => {
    stopPending();
    const l = live.current;
    live.current = null;
    replay.current = null;
    setCursor(null);
    setNow(Date.now());
    ask(!l ? firstWaiting() : 'next' in l ? l.next() : l.question && { ...l.question });
  };

  /** Swipe to the right: the line before (from the training: the last one). */
  const onBack = () => {
    const i = cursor === null ? trail.length - 1 : cursor - 1;
    if (i >= 0) openAt(i);
  };

  /** Tap on a dot: that line; on the training's dot: back to it. */
  const onOpen = (id: number) => {
    const i = trail.findIndex((e) => e.id === id);
    if (i >= 0 && i !== cursor) openAt(i);
  };

  // Leaving the page (explorer, other mode): the session is put aside, with its last lines and
  // the question on the board (or the one coming after the pause).
  const snapshot = useRef<() => SavedReview>(undefined);
  snapshot.current = () => {
    const start = Math.max(0, Math.min(trail.length - KEPT_LINES, cursor ?? Infinity));
    return {
      trail: trail.slice(start),
      trailIds: trailIds.current,
      cursor: cursor === null ? null : cursor - start,
      current: cursor === null && pendingNext.current ? pendingNext.current() : current,
      live: live.current,
      line: line.current,
      replay: replay.current && { ...replay.current, rest: [...replay.current.rest] },
      answered: answered.current,
      skipped: skipped.current,
      stats,
      extraNew,
      ahead,
    };
  };
  useEffect(() => {
    if (!sessionKey) return;
    return () => saveSession(sessionKey, snapshot.current?.());
  }, [sessionKey]);

  if (!current) {
    return (
      <div className="panel done">
        <h3>{sources.every((s) => s.positions.length === 0)
            ? t('Rien à entraîner ici', 'Nothing to train here')
            : t('Tout est fait pour l’instant 🎉', 'All done for now 🎉')}</h3>
        {/* The lines of the session can still be seen again (swipe to the right, or a dot). */}
        {trail.length > 0 && (
          <SwipeBar onSkip={() => {}} onBack={onBack} canBack before={trail} onOpen={onOpen} hint={t('revoir les lignes de la séance →', 'replay the lines of the session →')} />
        )}
        {sources.every((s) => s.positions.length === 0) && (
          <p className="muted">
            {t(
              'Aucune position où c’est à vous de jouer dans ces lignes : ajoutez (et enregistrez) d’abord des coups pour votre camp.',
              'No position where it is your move in these lines: first add (and save) moves for your side.',
            )}
          </p>
        )}
        {queue.nextDue && <p>{t(`Prochaine révision ${inTime(queue.nextDue)}.`, `Next review ${inTime(queue.nextDue)}.`)}</p>}
        <div className="row">
          {queue.unseenLines > 0 && (
            <button className="primary" onClick={() => setExtraNew((n) => n + 3)}>
              {t(
                `Apprendre ${plural(Math.min(3, queue.unseenLines), 'nouvelle ligne', 'nouvelles lignes')} (${fmt(queue.unseenLines)} pas encore ${queue.unseenLines > 1 ? 'apprises' : 'apprise'})`,
                `Learn ${plural(Math.min(3, queue.unseenLines), 'new line', 'new lines')} (${fmt(queue.unseenLines)} not learnt yet)`,
              )}
            </button>
          )}
          {queue.early > 0 && (
            <button
              onClick={() => {
                setAhead(true);
                setNow(Date.now());
              }}
            >
              {t('Réviser en avance', 'Review ahead')}
            </button>
          )}
          {onTest && sources.some((s) => s.positions.length > 0) && (
            <button className={queue.unseenLines > 0 ? '' : 'primary'} onClick={onTest} title={t('L’adversaire joue les coups les plus fréquents à votre niveau', 'The opponent plays the most frequent moves at your level')}>
              {t('Jouer une partie', 'Play a game')}
            </button>
          )}
        </div>
        {idle}
      </div>
    );
  }

  return (
    <Drill
      round={round}
      lineDone={lineDone}
      question={current}
      // A new move to learn: another new move of mine played is learnt instead of the one asked.
      onAnswered={(played, outcome, wrong) => onAnswered(played.uci === current.expected.uci ? current : { ...current, expected: played }, played, outcome, wrong)}
      onSkip={() => onSkip(current)}
      onAlternative={(move) => onAlternative(current, move)}
      onBack={onBack}
      canBack={cursor === null ? trail.length > 0 : cursor > 0}
      browsing={cursor !== null}
      before={trail.slice(0, cursor ?? trail.length)}
      after={cursor === null ? [] : trail.slice(cursor + 1)}
      viewing={cursor === null ? undefined : trail[cursor]}
      onOpen={onOpen}
      onTraining={backToTraining}
    />
  );
}

/**
 * The line from `move` to its end, as trained: an opponent reply only when it leads to a
 * trained position (shortened lines stop after my move, like the review), main moves first.
 */
function restOfLine(source: Source, move: RepMove): RepMove[] {
  const trained = new Set(source.positions.map((p) => p.fen));
  const main = (moves: RepMove[]) => moves.find((m) => m.isMain) ?? moves[0];
  const out = [move];
  const seen = new Set([move.toFen]);
  for (let fen = move.toFen; out.length < 80; ) {
    const reply = main(source.rep.movesAt(fen).filter((r) => trained.has(r.toFen) && !seen.has(r.toFen)));
    const mine = reply && main(source.rep.movesAt(reply.toFen));
    if (!reply || !mine || seen.has(mine.toFen)) break;
    out.push(reply, mine);
    seen.add(reply.toFen).add(mine.toFen);
    fen = mine.toFen;
  }
  return out;
}

/**
 * One question: one of my moves (`expected`). When the line continues, the board first shows
 * my previous move, then plays the opponent's reply. A new move is shown; two wrong tries or
 * the time running out reveal it. Another move of my repertoire (an alternative) is not a
 * mistake: said so, and the move asked is shown (green arrow) to play it. One button: the piece
 * to move (hint), then the solution (the move is played, helped, and the line goes on). Swipe to the left on the bar under the board: the
 * next question.
 */
function Drill({
  round,
  lineDone,
  question,
  onAnswered,
  onAlternative,
  onSkip,
  onBack,
  canBack,
  browsing,
  before,
  after,
  viewing,
  onOpen,
  onTraining,
}: {
  /** Changes with each question. Not used as a React key: the board must stay mounted. */
  round: number;
  question: Question;
  /** `wrong`: the wrong moves played before (UCI, in order). */
  onAnswered: (played: RepMove, outcome: Outcome, wrong: string[]) => void;
  /** Another of my moves played (an alternative): right, the move asked is then shown. */
  onAlternative: (move: Pick<RepMove, 'uci'>) => void;
  /** Swipe to the left on the bar under the board: the next question. */
  onSkip: () => void;
  /** Swipe to the right: the line before. */
  onBack: () => void;
  canBack: boolean;
  /** A line of the trail is on the board (not the training). */
  browsing: boolean;
  /** The lines before the one on the board (dots left of the handle) and after it (right). */
  before: TrailDot[];
  after: TrailDot[];
  /** The line on the board (its result colours the handle). */
  viewing?: TrailDot;
  onOpen: (id: number) => void;
  /** Tap on the training's dot (right of the handle while browsing): back to it. */
  onTraining: () => void;
  /** The line ends with the move just played (shown until the next line). */
  lineDone: boolean;
}) {
  const { source, target, expected, isNew, lead } = question;
  const plies = target.path.length;
  const fresh = () => ({
    round,
    replied: !lead,
    // Jump to another line: replay its last moves; following the line: no replay.
    shown: lead ? plies : Math.max(0, plies - REPLAYED_PLIES),
    mistakes: 0,
    /** Another move of my repertoire played instead of the expected one. */
    revealed: isNew,
    /** Alternatives played: each one restarts the clock. */
    retries: 0,
    /** The last alternative played (shown in a bubble; of this repertoire or another one of mine);
     * the move asked is then shown by its arrow. */
    alternative: null as Pick<RepMove, 'uci' | 'san' | 'nags'> | null,
    /** A move of the repertoire put on pause played: not a mistake, try again (bubble). */
    pausedMove: null as RepMove | null,
    /** A new move to learn, and one of my moves here already learnt played: learn a new one (bubble). */
    knownMove: null as RepMove | null,
    /** 1: the piece to move is shown. */
    hinted: false,
    played: null as RepMove | null,
    /** Wrong moves played (UCI, in order): recorded with the answer. */
    wrong: [] as string[],
  });
  const [state, setState] = useState(fresh);
  /** Where the quiz's line starts (ply): set when jumping to another line, kept while following it. */
  const lineFrom = useRef(lead ? 0 : Math.max(0, plies - REPLAYED_PLIES));
  // New question: reset the state during render (keeps the board mounted, no flash).
  const current = state.round === round ? state : fresh();
  if (state.round !== round) {
    if (!lead) lineFrom.current = Math.max(0, plies - REPLAYED_PLIES);
    setState(current);
  }
  const { replied, shown, mistakes, revealed, retries, alternative, pausedMove, knownMove, hinted, played, wrong } = current;
  const update = (patch: Partial<typeof current>) => setState((s) => ({ ...s, ...patch }));
  const answers = source.rep.movesAt(target.fen);
  const elsewhere = useMyMovesHere(target.fen, source.color);
  // A new move to learn: all my moves here are shown, the new ones in green (any of them is the
  // answer), those already learnt in very light green (played: learn a new one instead).
  const newHere = isNew ? answers.filter((m) => !source.cardOf(target.fen, m.uci)) : [];
  const learntHere = isNew ? answers.filter((m) => source.cardOf(target.fen, m.uci)) : [];

  useEffect(() => {
    if (replied) return;
    const t = setTimeout(() => update({ replied: true }), REPLY_MS);
    return () => clearTimeout(t);
  }, [replied, round]);

  useEffect(() => {
    if (shown >= plies) return;
    const t = setTimeout(() => update({ shown: shown + 1 }), REPLAY_MS);
    return () => clearTimeout(t);
  }, [shown, plies, round]);

  const asking = replied && shown >= plies && !played;

  const outcome = (helped: boolean) => outcomeOf(isNew, mistakes, revealed || helped);

  const play = (uci: string) => {
    if (!asking) return;
    if (uci !== expected.uci) {
      const otherNew = newHere.find((m) => m.uci === uci);
      if (otherNew) {
        update({ played: otherNew });
        onAnswered(otherNew, outcome(hinted), wrong);
        return;
      }
      const learnt = learntHere.find((m) => m.uci === uci);
      if (learnt) {
        if (!knownMove) onAlternative(learnt);
        update({ retries: retries + 1, knownMove: learnt, alternative: null, pausedMove: null });
        return 'retry';
      }
      // One of my moves here, in this repertoire or another one of the same colour: right too.
      const other = answers.find((m) => m.uci === uci) ?? elsewhere(uci);
      if (other) {
        // Right too: said so, and the move reviewed here is shown (green arrow).
        if (!alternative) onAlternative(other);
        update({ retries: retries + 1, alternative: other, pausedMove: null, knownMove: null });
        return 'retry';
      }
      // A move of mine put on pause: not a mistake, try again.
      const onPause = source.pausedAt(target.fen).find((m) => m.uci === uci);
      if (onPause) {
        update({ retries: retries + 1, pausedMove: onPause, knownMove: null });
        return 'retry';
      }
      update({ mistakes: mistakes + 1, revealed: revealed || mistakes + 1 >= 2, wrong: [...wrong, uci] });
      return false;
    }
    update({ played: expected });
    // New or helped: asked again soon. Right first time, or after an alternative: good.
    onAnswered(expected, alternative && !isNew && mistakes === 0 && !hinted ? 'alternative' : outcome(hinted), wrong);
  };

  /** One button: first the piece to move, then the solution (the move is played, helped). */
  const hint = () => {
    if (!hinted && !revealed) return update({ hinted: true });
    update({ played: expected });
    onAnswered(expected, outcome(true), wrong);
  };

  /** The moves on the board, from the start. */
  let moves: RepMove[];
  if (played) moves = [...target.path, played];
  else if (!replied && lead) moves = target.path.slice(0, -1);
  else moves = target.path.slice(0, shown);
  const last = moves.at(-1);

  const shapes = useMemo<DrawShape[]>(() => {
    if (!asking) return [];
    if (isNew) return [...answerArrows(newHere), ...learntHere.map((m) => ({ ...answerArrows([m])[0]!, brush: 'learned' }))];
    if (revealed || alternative) return answerArrows([expected]);
    if (hinted) return [{ orig: expected.uci.slice(0, 2) as Key, brush: 'repertoire' }];
    return [];
  }, [revealed, hinted, asking, expected, alternative, isNew, round]);

  const chapter = useMemo(() => source.chapterOf(target.fen, expected.uci), [source, target.fen, expected.uci]);

  return (
    <div className="editor play-screen">
      <div className="editor-board">
        {/* The repertoire and chapter of the question: a link to this position in the editor. */}
        <Link
          to={`/r/${source.id}?${new URLSearchParams({ ...(chapter ? { chapter: chapter.id } : {}), line: moves.map((m) => m.uci).join(',') })}`}
          className="board-rep"
          title={t('Ouvrir cette position dans votre répertoire', 'Open this position in your repertoire')}
        >
          {source.repertoireName}
          {chapter && chapter.name !== source.repertoireName && <span className="board-rep-chapter"> › {chapter.name}</span>}
        </Link>
        <OpeningName ucis={moves.map((m) => m.uci)} />
        <Board
          fen={last?.toFen ?? source.root}
          orientation={source.color}
          lastMove={last?.uci}
          lastMoveNags={last?.nags}
          shapes={shapes}
          onMove={asking ? play : undefined}
        />
        {lineDone && played && <LineDone text={t('Ligne revue', 'Line reviewed')} />}
        {pausedMove && asking && (
          <div key={`p${retries}`} className="alt-bubble" role="status">
            ⏸ <strong><San san={pausedMove.san} nags={pausedMove.nags} /></strong>{' '}
            {t('est en pause dans ton répertoire — joue un autre coup', 'is paused in your repertoire: play another move')}
          </div>
        )}
        {knownMove && asking && (
          <div key={`k${retries}`} className="alt-bubble" role="status">
            ✓ <strong><San san={knownMove.san} nags={knownMove.nags} /></strong>{' '}
            {t('est déjà appris — apprends-en un nouveau', 'is already learnt: learn a new one')}
            {newHere.length === 1 ? (
              <>{t(' : ', ': ')}<strong><San san={expected.san} nags={expected.nags} /></strong></>
            ) : (
              t(' (flèches vert foncé)', ' (dark green arrows)')
            )}
          </div>
        )}
        {alternative && asking && !pausedMove && (
          <div key={retries} className="alt-bubble" role="status">
            👍 <strong><San san={alternative.san} nags={alternative.nags} /></strong>{' '}
            {t('est un bon coup, mais ici on révise', 'is a good move, but here we review')}{' '}
            <strong><San san={expected.san} nags={expected.nags} /></strong>
          </div>
        )}
        {/* The quiz's line so far (since it started, not from the first move), annotations in colour. */}
        <QuizLine moves={moves.slice(lineFrom.current)} firstPly={lineFrom.current} />
        {question.replay !== undefined && <p className="replay-note muted small-text">{t('↺ Rejeu — pas compté dans les révisions', '↺ Replay: not counted in the reviews')}</p>}
        <SwipeBar
          onSkip={onSkip}
          onBack={onBack}
          canBack={canBack}
          browsing={browsing}
          before={before}
          after={after}
          viewing={viewing}
          onOpen={onOpen}
          onTraining={onTraining}
        />
      </div>
      {/* At the bottom of the screen (phone), as against the bot. */}
      <DrillActions
        hinted={hinted || revealed}
        disabled={!asking}
        solutionTitle={t('Jouer le coup attendu (compté comme aidé), puis la ligne continue', 'Play the expected move (counted as helped), then the line goes on')}
        onHint={hint}
      />
    </div>
  );
}
