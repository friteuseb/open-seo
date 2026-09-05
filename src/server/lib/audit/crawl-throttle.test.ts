import { describe, expect, it } from "vitest";
import {
  NO_THROTTLE,
  noteThrottled,
  THROTTLE,
} from "@/server/lib/audit/crawl-throttle";

describe("noteThrottled", () => {
  it("extends the pause once per wave, not once per refused page", () => {
    // A full window is in flight when the site starts refusing: every one of
    // those fetches reports a 429 within the same pause.
    const wave = noteThrottled(NO_THROTTLE, 1_000);
    let state = wave;
    for (let i = 0; i < 20; i++) state = noteThrottled(state, 1_050);

    expect(state).toEqual(wave);
    expect(state.pausedUntil).toBe(1_000 + THROTTLE.initialPauseMs);

    // A 429 after the pause elapsed is a new wave, and backs off further.
    const next = noteThrottled(state, state.pausedUntil);
    expect(next.pausedUntil - state.pausedUntil).toBe(
      THROTTLE.initialPauseMs * 2,
    );
  });

  it("waits as long as Retry-After asks, up to the cap", () => {
    expect(noteThrottled(NO_THROTTLE, 0, 10_000).pausedUntil).toBe(10_000);
    expect(noteThrottled(NO_THROTTLE, 0, 600_000).pausedUntil).toBe(
      THROTTLE.maxPauseMs,
    );
    // A Retry-After shorter than our own backoff doesn't shorten it.
    expect(noteThrottled(NO_THROTTLE, 0, 100).pausedUntil).toBe(
      THROTTLE.initialPauseMs,
    );
  });
});
