/**
 * Training answers, offline first: each answer is scheduled on the device at once (core FSRS, the
 * card in the cache changes immediately) and queued in IndexedDB; the queue is sent in order when
 * the server can be reached (now, at the next start, when the connection comes back).
 *
 * Each answer has its own id and the time it was given: sent twice (connection lost before the
 * reply) it counts once, and the server computes the same card as the device (seeded fuzz).
 * Answers still queued are replayed on the cards read from the server, so a refetch never brings
 * back a card answered offline.
 */
import { recallOf, scheduleReview, type Grade } from '@e4e5/core';
import type { QueryClient } from '@tanstack/react-query';
import { get, set } from 'idb-keyval';
import { movedStore } from '../legacyNames';
import { api, ApiError, UNREACHABLE, type ReviewCard, type TrainingMode } from '../api';

export interface PendingReview {
  id: string;
  userId: string;
  repertoireId: string;
  fen: string;
  uci: string;
  grade: Grade;
  reviewedAt: number;
  /** Réviser or Se tester (absent in answers queued before the modes were recorded). */
  mode?: TrainingMode;
}

// Formerly 'tabiya-outbox' (the app's former name): moved once, before the first read.
const { store, ready } = movedStore('tabiya-outbox', 'e4e5-outbox', 'reviews');
const KEY = 'pending';
let queue: PendingReview[] | null = null;
let loading: Promise<PendingReview[]> | null = null;
let userId: string | null = null;
let client: QueryClient | null = null;
let flushing = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

/** The queue, read from the device once. */
function load(): Promise<PendingReview[]> {
  loading ??= ready
    .then(() => get<PendingReview[]>(KEY, store))
    .catch(() => undefined)
    .then((saved) => (queue = saved ?? []));
  return loading;
}
const save = () => set(KEY, queue ?? [], store).catch((e: unknown) => console.warn('Answers not saved on the device', e));
const mine = (q: PendingReview[]) => q.filter((r) => r.userId === userId);

const cardKey = (fen: string, uci: string) => `${fen} ${uci}`;

/** The card after an answer, computed on the device. */
export function answeredCard(old: ReviewCard | undefined, fen: string, uci: string, grade: Grade, at: number): ReviewCard {
  const date = new Date(at);
  const next = scheduleReview(old?.fsrs, grade, date);
  return {
    fen,
    uci,
    recall: recallOf(next.card, next.reps, date),
    due: next.due.toISOString(),
    reps: next.reps,
    lapses: next.lapses,
    interval: next.interval,
    createdAt: old?.createdAt ?? date.toISOString(),
    fsrs: next.card,
  };
}

/** Cards of the server with the answers still queued replayed on them (in the order given). */
function withPending(cards: ReviewCard[]): ReviewCard[] {
  const pending = mine(queue ?? []);
  if (!pending.length) return cards;
  const map = new Map(cards.map((c) => [cardKey(c.fen, c.uci), c]));
  for (const r of pending) {
    const k = cardKey(r.fen, r.uci);
    map.set(k, answeredCard(map.get(k), r.fen, r.uci, r.grade, r.reviewedAt));
  }
  return [...map.values()];
}

/** The user's move cards (query ['cards']), answers waiting to be sent included. */
export const cardsQuery = {
  queryKey: ['cards'] as const,
  queryFn: async () => {
    const cards = await api.cards();
    await load();
    return withPending(cards);
  },
};

const putCard = (qc: QueryClient, card: ReviewCard) =>
  qc.setQueryData<ReviewCard[]>(['cards'], (old = []) => [...old.filter((c) => c.fen !== card.fen || c.uci !== card.uci), card]);

/** Records an answer: the card changes at once, the answer is sent now or later. */
export function recordReview(qc: QueryClient, old: ReviewCard | undefined, answer: Omit<PendingReview, 'id' | 'userId' | 'reviewedAt'>) {
  if (!userId) return;
  const at = Date.now();
  putCard(qc, answeredCard(old, answer.fen, answer.uci, answer.grade, at));
  const item: PendingReview = { ...answer, id: crypto.randomUUID(), userId, reviewedAt: at };
  void load().then(async (q) => {
    q.push(item);
    notify();
    await save();
    void flushReviews();
  });
}

/**
 * Sends the queued answers of the user, in order. Stops at the first one the server cannot take
 * now (no network, server down, session expired) and keeps it for later; an answer the server
 * refuses (repertoire or move deleted meanwhile) is dropped.
 */
export async function flushReviews() {
  if (flushing || !userId || !client) return;
  flushing = true;
  const qc = client;
  try {
    const q = await load();
    for (let item = mine(q)[0]; item; item = mine(q)[0]) {
      try {
        const card = await api.review(item.repertoireId, { fen: item.fen, uci: item.uci, grade: item.grade, id: item.id, reviewedAt: item.reviewedAt, mode: item.mode });
        q.splice(q.indexOf(item), 1);
        // The server's card, unless the move was answered again since (that answer is still queued),
        // or it is the one computed on the device (the usual case: no new render while training).
        const local = qc.getQueryData<ReviewCard[]>(['cards'])?.find((c) => c.fen === card.fen && c.uci === card.uci);
        const same = local && local.due === card.due && local.reps === card.reps && local.lapses === card.lapses;
        if (!same && !mine(q).some((r) => r.fen === card.fen && r.uci === card.uci)) putCard(qc, card);
      } catch (e) {
        const keep = !(e instanceof ApiError) || e.status === UNREACHABLE || e.status === 401 || e.status === 429 || e.status >= 500;
        if (keep) break;
        console.warn('Answer refused by the server, dropped', item, e);
        q.splice(q.indexOf(item), 1);
      }
      notify();
      await save();
    }
  } finally {
    flushing = false;
    notify();
  }
}

/** The signed-in user (answers are sent per user) and the cache to update with the server's cards. */
export function startReviewSync(qc: QueryClient, user: string) {
  client = qc;
  userId = user;
  void load().then(() => {
    notify();
    void flushReviews();
  });
  const onOnline = () => void flushReviews();
  window.addEventListener('online', onOnline);
  // Lost answers after a flaky connection: try again now and then while some wait.
  const timer = setInterval(() => {
    if (mine(queue ?? []).length) void flushReviews();
  }, 60_000);
  return () => {
    window.removeEventListener('online', onOnline);
    clearInterval(timer);
  };
}

/** Number of the user's answers not sent yet. */
export function pendingReviews(): number {
  return mine(queue ?? []).length;
}

export function subscribePending(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

/** Forgets the user's queued answers (logging out). */
export async function dropPendingReviews() {
  const q = await load();
  queue = q.filter((r) => r.userId !== userId);
  await save();
  notify();
}
