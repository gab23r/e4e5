import { useSyncExternalStore } from 'react';
import { pendingReviews, subscribePending } from './reviews';

/** Training answers of the user not sent to the server yet. */
export function usePendingReviews(): number {
  return useSyncExternalStore(subscribePending, pendingReviews);
}
