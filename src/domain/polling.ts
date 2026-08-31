/**
 * Decides when to look at a deployment again.
 *
 * The browser polls our server, and our server makes one Railway request per poll.
 * There's no background worker: the open page is what drives observation.
 *
 * This is a pure function so backoff, timeouts and rate-limit handling can be tested
 * without a clock or a network. All the timing lives here.
 */

import { isActiveState, isAwaitingExternalAction, isTerminalState } from './deployment-status'
import type { DeploymentState } from './deployment-status'

export const POLLING_POLICY = {
  /** Delay before observation N. Index 0 is the one taken right after a command. */
  rampMs: [0, 1_000, 2_000, 3_000] as const,
  steadyMs: 5_000,
  hardTimeoutMs: 15 * 60 * 1_000,
  /** Slower than the ramp, because we don't know what an unrecognised status is doing. */
  unknownStateMs: 15_000,

  /**
   * Railway's Free plan allows 100 requests an hour. At the 5s steady interval one
   * three-minute deployment costs about 36 of them, so without this the account can
   * run out mid-deployment and the page stops being able to load at all.
   *
   * Each interval is picked so a full hardTimeoutMs watch costs no more than the
   * requests that were left when it kicked in: 15 minutes at 30s is 30 observations,
   * at 60s is 15. polling.test.ts checks that arithmetic.
   */
  budget: {
    lowRemaining: 40,
    lowIntervalMs: 30_000,
    criticalRemaining: 15,
    criticalIntervalMs: 60_000,
    exhaustedRemaining: 5,
  },
} as const

export interface RateLimitSnapshot {
  /** X-RateLimit-Remaining, when Railway sends it. */
  remaining?: number
  /** Retry-After in milliseconds. Only present after a 429. */
  retryAfterMs?: number
}

export interface PollingContext {
  observations: number
  elapsedMs: number
  state: DeploymentState
  rateLimit?: RateLimitSnapshot
}

export type PollingStopReason =
  | 'TERMINAL'
  | 'AWAITING_EXTERNAL_ACTION'
  | 'TIMEOUT'
  | 'BUDGET_EXHAUSTED'

export type PollingDecision =
  | { action: 'observe'; delayMs: number }
  | { action: 'stop'; reason: PollingStopReason }

/**
 * Order matters here. Retry-After comes first because it's the only timing Railway
 * has actually given us; everything else is our own guess.
 */
export function nextPollingDecision(context: PollingContext): PollingDecision {
  const { observations, elapsedMs, state, rateLimit } = context

  if (rateLimit?.retryAfterMs !== undefined && rateLimit.retryAfterMs > 0) {
    return { action: 'observe', delayMs: rateLimit.retryAfterMs }
  }

  if (isTerminalState(state)) return { action: 'stop', reason: 'TERMINAL' }
  if (isAwaitingExternalAction(state)) {
    return { action: 'stop', reason: 'AWAITING_EXTERNAL_ACTION' }
  }

  if (elapsedMs >= POLLING_POLICY.hardTimeoutMs) {
    return { action: 'stop', reason: 'TIMEOUT' }
  }

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
  const ramp = POLLING_POLICY.rampMs
  const base = !isActiveState(state)
    ? POLLING_POLICY.unknownStateMs
    : observations < ramp.length
      ? ramp[observations]
      : POLLING_POLICY.steadyMs

  return Math.max(base, budgetFloorFor(remaining))
}

/** Returns 0 when Railway sent no count, so a missing header never slows us down. */
function budgetFloorFor(remaining: number | undefined): number {
  if (remaining === undefined) return 0
  const { budget } = POLLING_POLICY
  if (remaining <= budget.criticalRemaining) return budget.criticalIntervalMs
  if (remaining <= budget.lowRemaining) return budget.lowIntervalMs
  return 0
}
