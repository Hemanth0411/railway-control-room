import { describe, expect, it } from 'vitest'

import { POLLING_POLICY, nextPollingDecision } from './polling'
import type { PollingContext } from './polling'

function context(overrides: Partial<PollingContext> = {}): PollingContext {
  return { observations: 0, elapsedMs: 0, state: 'PROVISIONING', ...overrides }
}

describe('nextPollingDecision — schedule', () => {
  it('observes immediately after a command', () => {
    expect(nextPollingDecision(context({ observations: 0 }))).toEqual({
      action: 'observe',
      delayMs: 0,
    })
  })

  it('follows the spec ramp of 1s, 2s, 3s', () => {
    expect(nextPollingDecision(context({ observations: 1 }))).toEqual({
      action: 'observe',
      delayMs: 1_000,
    })
    expect(nextPollingDecision(context({ observations: 2 }))).toEqual({
      action: 'observe',
      delayMs: 2_000,
    })
    expect(nextPollingDecision(context({ observations: 3 }))).toEqual({
      action: 'observe',
      delayMs: 3_000,
    })
  })

  it('settles at the steady interval once the ramp is exhausted', () => {
    for (const observations of [4, 5, 20, 100]) {
      expect(nextPollingDecision(context({ observations }))).toEqual({
        action: 'observe',
        delayMs: POLLING_POLICY.steadyMs,
      })
    }
  })

  it('never decreases the interval as observations accumulate', () => {
    let previous = -1
    for (let n = 0; n < 12; n += 1) {
      const decision = nextPollingDecision(context({ observations: n }))
      expect(decision.action).toBe('observe')
      if (decision.action === 'observe') {
        expect(decision.delayMs).toBeGreaterThanOrEqual(previous)
        previous = decision.delayMs
      }
    }
  })

  it('polls a stopping deployment on the same ramp', () => {
    expect(nextPollingDecision(context({ state: 'STOPPING', observations: 2 }))).toEqual({
      action: 'observe',
      delayMs: 2_000,
    })
  })
})

describe('nextPollingDecision — stopping', () => {
  it('stops on every terminal state', () => {
    for (const state of ['RUNNING', 'FAILED', 'CRASHED', 'STOPPED', 'SKIPPED'] as const) {
      expect(nextPollingDecision(context({ state }))).toEqual({
        action: 'stop',
        reason: 'TERMINAL',
      })
    }
  })

  it('stops when Railway is waiting on something external', () => {
    for (const state of ['NEEDS_APPROVAL', 'WAITING', 'SLEEPING'] as const) {
      expect(nextPollingDecision(context({ state }))).toEqual({
        action: 'stop',
        reason: 'AWAITING_EXTERNAL_ACTION',
      })
    }
  })

  it('stops at the hard timeout even while still provisioning', () => {
    expect(
      nextPollingDecision(context({ elapsedMs: POLLING_POLICY.hardTimeoutMs })),
    ).toEqual({ action: 'stop', reason: 'TIMEOUT' })
  })

  it('keeps polling right up to the timeout', () => {
    const decision = nextPollingDecision(context({ elapsedMs: POLLING_POLICY.hardTimeoutMs - 1 }))
    expect(decision.action).toBe('observe')
  })

  it('watches an unknown state slowly instead of abandoning or hammering it', () => {
    expect(nextPollingDecision(context({ state: 'UNKNOWN', observations: 0 }))).toEqual({
      action: 'observe',
      delayMs: POLLING_POLICY.unknownStateMs,
    })
  })
})

describe('nextPollingDecision — rate limits', () => {
  it('obeys Retry-After above everything else', () => {
    // Even at the hard timeout, an explicit Retry-After is the only timing
    // instruction Railway has actually given us.
    expect(
      nextPollingDecision(
        context({ elapsedMs: POLLING_POLICY.hardTimeoutMs, rateLimit: { retryAfterMs: 30_000 } }),
      ),
    ).toEqual({ action: 'observe', delayMs: 30_000 })
  })

  it('ignores a zero or negative Retry-After', () => {
    const decision = nextPollingDecision(context({ observations: 1, rateLimit: { retryAfterMs: 0 } }))
    expect(decision).toEqual({ action: 'observe', delayMs: 1_000 })
  })

  it('keeps the spec schedule while the budget is healthy', () => {
    expect(nextPollingDecision(context({ observations: 4, rateLimit: { remaining: 90 } }))).toEqual({
      action: 'observe',
      delayMs: POLLING_POLICY.steadyMs,
    })
  })

  it('widens the interval as the hourly budget drains', () => {
    expect(
      nextPollingDecision(
        context({ observations: 4, rateLimit: { remaining: POLLING_POLICY.budget.lowRemaining } }),
      ),
    ).toEqual({ action: 'observe', delayMs: POLLING_POLICY.budget.lowIntervalMs })

    expect(
      nextPollingDecision(
        context({
          observations: 4,
          rateLimit: { remaining: POLLING_POLICY.budget.criticalRemaining },
        }),
      ),
    ).toEqual({ action: 'observe', delayMs: POLLING_POLICY.budget.criticalIntervalMs })
  })

  it('stops polling before the account runs out of requests entirely', () => {
    expect(
      nextPollingDecision(
        context({
          observations: 4,
          rateLimit: { remaining: POLLING_POLICY.budget.exhaustedRemaining },
        }),
      ),
    ).toEqual({ action: 'stop', reason: 'BUDGET_EXHAUSTED' })
  })

  it('does not slow polling when Railway sends no remaining count', () => {
    expect(nextPollingDecision(context({ observations: 1, rateLimit: {} }))).toEqual({
      action: 'observe',
      delayMs: 1_000,
    })
  })

  it('reaching a terminal state wins over a drained budget', () => {
    // Both would stop polling, but the honest reason is that the deployment
    // finished, not that we ran out of requests.
    expect(
      nextPollingDecision(context({ state: 'RUNNING', rateLimit: { remaining: 0 } })),
    ).toEqual({ action: 'stop', reason: 'TERMINAL' })
  })
})

describe('polling budget arithmetic', () => {
  // The property that makes the budget tiers worth having: once Railway says
  // the budget is low, a full 15-minute watch must not cost more requests than
  // were remaining when it started. Guards the constants against being retuned
  // into uselessness.
  it.each([
    ['low', POLLING_POLICY.budget.lowRemaining],
    ['critical', POLLING_POLICY.budget.criticalRemaining],
  ])('a %s budget keeps a full watch within the requests that remained', (_tier, remaining) => {
    let elapsed = 0
    let observations = 0
    let requests = 0

    for (;;) {
      const decision = nextPollingDecision({
        observations,
        elapsedMs: elapsed,
        state: 'PROVISIONING',
        rateLimit: { remaining },
      })
      if (decision.action === 'stop') break
      elapsed += decision.delayMs
      observations += 1
      requests += 1
      if (requests > 10_000) throw new Error('polling policy failed to terminate')
    }

    expect(requests).toBeLessThanOrEqual(remaining)
  })
})
