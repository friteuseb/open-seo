/**
 * Backoff for a site that answers 429. A rate-limited fetch says nothing
 * about the page — it says we asked too fast — so the crawl pauses, narrows
 * its window and asks again instead of recording an empty "blocked" row.
 * Only when a URL still 429s after THROTTLE.maxAttempts is it recorded as
 * blocked, which keeps the blocked-page issue about the site's defenses
 * rather than about our own pace.
 */
export const THROTTLE = {
  /** Pause after the first 429 wave; each further wave doubles it. */
  initialPauseMs: 2_000,
  /**
   * Ceiling for one pause, Retry-After included. A chunk's soft deadline is
   * 90s, so a longer wait would spend the whole chunk asleep; the leftover
   * leases go back to the frontier and the next chunk retries them.
   */
  maxPauseMs: 30_000,
  /** Fetches in flight once a site has rate-limited us in this chunk. */
  window: 2,
  /** Attempts per URL before a 429 is recorded as a blocked page. */
  maxAttempts: 3,
} as const;

export interface ThrottleState {
  /** Epoch ms until which no new fetch may be launched. 0 = never throttled. */
  pausedUntil: number;
  /** Pause the next wave applies. */
  nextPauseMs: number;
}

export const NO_THROTTLE: ThrottleState = {
  pausedUntil: 0,
  nextPauseMs: THROTTLE.initialPauseMs,
};

/**
 * Fold a 429 into the throttle state. Only the first 429 of a wave extends
 * the pause: the rest of the window was already in flight when the site
 * started refusing, and doubling once per refused page would jump straight
 * to the maximum on the first wave.
 */
export function noteThrottled(
  state: ThrottleState,
  now: number,
  retryAfterMs?: number,
): ThrottleState {
  if (now < state.pausedUntil) return state;
  const pauseMs = Math.min(
    Math.max(state.nextPauseMs, retryAfterMs ?? 0),
    THROTTLE.maxPauseMs,
  );
  return {
    pausedUntil: now + pauseMs,
    nextPauseMs: Math.min(state.nextPauseMs * 2, THROTTLE.maxPauseMs),
  };
}

/** True once the site has rate-limited us — the window stays narrow after. */
export function wasThrottled(state: ThrottleState): boolean {
  return state.pausedUntil > 0;
}
