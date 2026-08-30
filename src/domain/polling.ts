/**
 * Polling policy.
 *
 * The browser polls *our* server; our server makes one Railway observation per
 * request. There is no background worker, no queue and no server-side loop —
 * the user's open page is the thing driving observation, which is the whole
 * point of the stateless design in spec 02.
 *
 * This module is a pure decision function. It answers one question: given what
 * we have observed so far, do we look again, and when? Keeping it pure is what
 * makes backoff, timeouts and rate-limit handling testable without a clock,
 * a network, or React.
 *
 * All timing constants live here, as spec 04 requires ("Make the schedule
 * configurable in one place").
 */

import { isActiveState, isAwaitingExternalAction, isTerminalState } from './deployment-status'
import type { DeploymentState } from './deployment-status'

export const POLLING_POLICY = {
  /**
   * Delay before observation N, for the first few observations. Index 0 is the
   * observation taken immediately after a command returns, so it is 0ms.
   * Spec 04's recommended shape: immediate, ~1s, ~2s, ~3s, then steady.
   */
  rampMs: [0, 1_000, 2_000, 3_000] as const,

  /** Interval once the ramp is exhausted and the deployment is still active. */
  steadyMs: 5_000,

  /**
   * Stop observing after this long regardless of state. A deployment that has
   * not settled in 15 minutes is not going to settle because we kept asking;
   * the UI switches to manual refresh and says so.
   */
  hardTimeoutMs: 15 * 60 * 1_000,

  /** Interval used for UNKNOWN states — slow, because we do not know what we are watching. */
  unknownStateMs: 15_000,

  /**
   * Rate-limit budget thresholds, in requests remaining in the current hour.
   *
   * Railway's Free plan allows 100 requests/hour. The spec's steady 5s interval
   * would spend roughly 36 of those watching one three-minute deployment, so on
   * Free the schedule has to widen as the budget drains or the account runs out
   * of requests mid-deployment and the page cannot even re-render.
   *
   * Each interval is chosen so that a full `hardTimeoutMs` watch costs no more
   * than the remaining requests that triggered it: 15 minutes at 30s is 30
   * observations (under 40), and at 60s is 15 (at the 15 threshold). Tightening
   * an interval without checking that arithmetic will let a single watch drain
   * the account, so `polling.test.ts` asserts it.
   *
   * See `docs/railway-schema-verification.md` for the numbers this is based on.
   */
  budget: {
    /** Below this many remaining requests, slow to `lowIntervalMs`. */
    lowRemaining: 40,
    lowIntervalMs: 30_000,
    /** Below this many, slow further. */
    criticalRemaining: 15,
    criticalIntervalMs: 60_000,
    /** At or below this many, stop automatic polling entirely and require a manual refresh. */
    exhaustedRemaining: 5,
  },
} as const

/** Rate-limit information read from the last Railway response. */
export interface RateLimitSnapshot {
  /** `X-RateLimit-Remaining`, when Railway sent it. */
  remaining?: number
  /** `Retry-After`, converted to milliseconds. Only present after a 429. */
  retryAfterMs?: number
}

export interface PollingContext {
  /** How many observations have already been made in this run. */
  observations: number
  /** Milliseconds since polling started. */
  elapsedMs: number
  /** The state reported by the most recent observation. */
  state: DeploymentState
  /** Rate-limit information from the most recent Railway response, if any. */
  rateLimit?: RateLimitSnapshot
}

export type PollingStopReason =
  /** The deployment reached a state that will not change on its own. */
  | 'TERMINAL'
  /** Railway is waiting on a human or an external system. */
  | 'AWAITING_EXTERNAL_ACTION'
  /** The hard timeout elapsed. */
  | 'TIMEOUT'
  /** Too few Railway requests remain this hour to keep polling safely. */
  | 'BUDGET_EXHAUSTED'

export type PollingDecision =
  | { action: 'observe'; delayMs: number }
  | { action: 'stop'; reason: PollingStopReason }

/**
 * Decide whether to observe again, and after how long.
 *
 * Precedence matters and is deliberate:
 *  1. `Retry-After` — Railway has told us explicitly to wait; nothing overrides it.
 *  2. Terminal / awaiting-external-action — nothing will change, so stop.
 *  3. Hard timeout — stop, even if still active.
 *  4. Budget exhausted — stop rather than spend the last requests on polling.
 *  5. Otherwise ramp, then steady, widened by the remaining budget.
 */
export function nextPollingDecision(context: PollingContext): PollingDecision {
  const { observations, elapsedMs, state, rateLimit } = context

  // 1. An explicit Retry-After outranks everything, including the timeout: it is
  //    the one piece of timing Railway has actually given us.
  if (rateLimit?.retryAfterMs !== undefined && rateLimit.retryAfterMs > 0) {
    return { action: 'observe', delayMs: rateLimit.retryAfterMs }
  }

  // 2. Nothing further will happen without a new command.
  if (isTerminalState(state)) return { action: 'stop', reason: 'TERMINAL' }
  if (isAwaitingExternalAction(state)) {
    return { action: 'stop', reason: 'AWAITING_EXTERNAL_ACTION' }
  }

  // 3. Bounded observation. Spec 04: "Do not poll forever."
  if (elapsedMs >= POLLING_POLICY.hardTimeoutMs) {
    return { action: 'stop', reason: 'TIMEOUT' }
  }

  // 4. Protect the account's remaining hourly requests.
  const remaining = rateLimit?.remaining
  if (remaining !== undefined && remaining <= POLLING_POLICY.budget.exhaustedRemaining) {
    return { action: 'stop', reason: 'BUDGET_EXHAUSTED' }
  }

  return { action: 'observe', delayMs: intervalFor(observations, state, remaining) }
}

function intervalFor(
  observations: number,
  state: DeploymentState,
  remaining: number | undefined,
): number {
  const base = baseIntervalFor(observations, state)
  return Math.max(base, budgetFloorFor(remaining))
}

function baseIntervalFor(observations: number, state: DeploymentState): number {
  // An unrecognised status gets a slow, cautious cadence rather than the ramp:
  // we cannot tell whether it is about to change, and guessing costs requests.
  if (!isActiveState(state)) return POLLING_POLICY.unknownStateMs

  const ramp = POLLING_POLICY.rampMs
  return observations < ramp.length ? ramp[observations] : POLLING_POLICY.steadyMs
}

/**
 * The minimum interval permitted by the remaining request budget. Returns 0
 * when Railway has not told us the remaining count, so an absent header never
 * makes polling slower than the spec's schedule.
 */
function budgetFloorFor(remaining: number | undefined): number {
  if (remaining === undefined) return 0
  const { budget } = POLLING_POLICY
  if (remaining <= budget.criticalRemaining) return budget.criticalIntervalMs
  if (remaining <= budget.lowRemaining) return budget.lowIntervalMs
  return 0
}

/** User-facing explanation of why automatic observation stopped. */
export const POLLING_STOP_MESSAGES: Record<PollingStopReason, string> = {
  TERMINAL: 'This deployment has settled. Refresh to check again.',
  AWAITING_EXTERNAL_ACTION:
    'Railway is waiting on something outside this app, so the state will not change on its own.',
  TIMEOUT:
    'Stopped watching after 15 minutes. The deployment may still be running — refresh to check its current state.',
  BUDGET_EXHAUSTED:
    'Paused to stay within the Railway API rate limit for this hour. Refresh to check the state manually.',
}
