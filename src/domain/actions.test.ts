import { describe, expect, it } from 'vitest'

import { checkAction, evaluateActions, primaryAction } from './actions'
import { normalizeDeploymentStatus } from './deployment-status'
import type { DeploymentObservation } from './deployment-status'

/** Build an observation from a raw Railway status, the way the server does. */
function observed(rawStatus: string): DeploymentObservation {
  return {
    deploymentId: 'dep_test',
    rawStatus,
    state: normalizeDeploymentStatus(rawStatus),
    createdAt: '2026-08-30T10:00:00.000Z',
    statusUpdatedAt: '2026-08-30T10:00:05.000Z',
    url: null,
    stopped: false,
    observedAt: '2026-08-30T10:00:06.000Z',
  }
}

describe('evaluateActions — no deployment yet', () => {
  const eligibility = evaluateActions(null)

  it('allows deploy', () => {
    expect(eligibility.DEPLOY.allowed).toBe(true)
  })

  it('rejects every action that needs an existing deployment', () => {
    for (const action of ['RESTART', 'STOP', 'CANCEL', 'APPROVE'] as const) {
      expect(eligibility[action].allowed).toBe(false)
      expect(eligibility[action].reason).toBeTruthy()
    }
  })
})

describe('evaluateActions — deploy', () => {
  it('is allowed from every settled state', () => {
    for (const raw of ['SUCCESS', 'FAILED', 'CRASHED', 'REMOVED', 'SKIPPED', 'SLEEPING']) {
      expect(evaluateActions(observed(raw)).DEPLOY.allowed).toBe(true)
    }
  })

  it('is rejected while a deployment is already provisioning', () => {
    // The double-click case: the second request must not create a second deployment.
    for (const raw of ['INITIALIZING', 'QUEUED', 'BUILDING', 'DEPLOYING']) {
      const verdict = evaluateActions(observed(raw)).DEPLOY
      expect(verdict.allowed).toBe(false)
      expect(verdict.reason).toMatch(/already in progress/i)
    }
  })

  it('is rejected while the previous deployment is stopping', () => {
    expect(evaluateActions(observed('REMOVING')).DEPLOY.allowed).toBe(false)
  })

  it('is rejected while a deployment awaits approval', () => {
    expect(evaluateActions(observed('NEEDS_APPROVAL')).DEPLOY.allowed).toBe(false)
  })

  it('is rejected when the Railway state is not recognised', () => {
    const verdict = evaluateActions(observed('SOME_FUTURE_STATUS')).DEPLOY
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toMatch(/don't recognise/i)
  })
})

describe('evaluateActions — restart', () => {
  it('is allowed only while running', () => {
    expect(evaluateActions(observed('SUCCESS')).RESTART.allowed).toBe(true)
  })

  it('is rejected in every other state', () => {
    for (const raw of ['QUEUED', 'BUILDING', 'DEPLOYING', 'FAILED', 'CRASHED', 'REMOVED']) {
      expect(evaluateActions(observed(raw)).RESTART.allowed).toBe(false)
    }
  })
})

describe('evaluateActions — stop', () => {
  it('is allowed for a running deployment', () => {
    expect(evaluateActions(observed('SUCCESS')).STOP.allowed).toBe(true)
  })

  it('is rejected when nothing is running', () => {
    for (const raw of ['QUEUED', 'BUILDING', 'FAILED', 'CRASHED', 'REMOVED']) {
      expect(evaluateActions(observed(raw)).STOP.allowed).toBe(false)
    }
  })

  it('says the deployment is already stopping', () => {
    const verdict = evaluateActions(observed('REMOVING')).STOP
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toMatch(/already stopping/i)
  })
})

describe('evaluateActions — cancel', () => {
  it('is allowed while queued or building', () => {
    for (const raw of ['INITIALIZING', 'QUEUED', 'BUILDING']) {
      expect(evaluateActions(observed(raw)).CANCEL.allowed).toBe(true)
    }
  })

  it('is rejected once the build is over and the deployment is being released', () => {
    // Railway only cancels queued/building, so DEPLOYING must not offer it.
    const verdict = evaluateActions(observed('DEPLOYING')).CANCEL
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toMatch(/finished building/i)
  })

  it('is rejected once the deployment has settled', () => {
    for (const raw of ['SUCCESS', 'FAILED', 'CRASHED', 'REMOVED']) {
      expect(evaluateActions(observed(raw)).CANCEL.allowed).toBe(false)
    }
  })
})

describe('evaluateActions — approve', () => {
  it('is allowed only while awaiting approval', () => {
    expect(evaluateActions(observed('NEEDS_APPROVAL')).APPROVE.allowed).toBe(true)
    expect(evaluateActions(observed('BUILDING')).APPROVE.allowed).toBe(false)
    expect(evaluateActions(observed('SUCCESS')).APPROVE.allowed).toBe(false)
  })
})

describe('checkAction', () => {
  it('returns null when the action is allowed', () => {
    expect(checkAction('DEPLOY', null)).toBeNull()
    expect(checkAction('STOP', observed('SUCCESS'))).toBeNull()
  })

  it('returns the same reason the UI shows when the action is rejected', () => {
    const reason = checkAction('DEPLOY', observed('BUILDING'))
    expect(reason).toBe(evaluateActions(observed('BUILDING')).DEPLOY.reason)
  })
})

describe('primaryAction', () => {
  it('offers Deploy when there is nothing deployed', () => {
    expect(primaryAction(null)).toBe('DEPLOY')
  })

  it('offers Cancel while a build can still be cancelled', () => {
    expect(primaryAction(observed('BUILDING'))).toBe('CANCEL')
  })

  it('offers no primary action once past the cancellable window', () => {
    expect(primaryAction(observed('DEPLOYING'))).toBeNull()
  })

  it('offers Restart while running and Approve while awaiting approval', () => {
    expect(primaryAction(observed('SUCCESS'))).toBe('RESTART')
    expect(primaryAction(observed('NEEDS_APPROVAL'))).toBe('APPROVE')
  })

  it('offers Deploy again after a failure', () => {
    expect(primaryAction(observed('FAILED'))).toBe('DEPLOY')
    expect(primaryAction(observed('CRASHED'))).toBe('DEPLOY')
  })

  it('offers nothing when the state is unknown', () => {
    expect(primaryAction(observed('SOME_FUTURE_STATUS'))).toBeNull()
  })

  it('only ever nominates an action that is actually allowed', () => {
    const raws = [
      'INITIALIZING', 'QUEUED', 'BUILDING', 'DEPLOYING', 'SUCCESS', 'FAILED',
      'CRASHED', 'REMOVING', 'REMOVED', 'SKIPPED', 'SLEEPING', 'WAITING',
      'NEEDS_APPROVAL', 'SOME_FUTURE_STATUS',
    ]
    for (const raw of raws) {
      const observation = observed(raw)
      const action = primaryAction(observation)
      if (action !== null) {
        expect(evaluateActions(observation)[action].allowed, `${raw} → ${action}`).toBe(true)
      }
    }
  })
})
