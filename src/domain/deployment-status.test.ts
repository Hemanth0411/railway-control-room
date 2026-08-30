import { describe, expect, it } from 'vitest'

import {
  DEPLOYMENT_STATE_LABELS,
  RAILWAY_DEPLOYMENT_STATUSES,
  describeObservation,
  isActiveState,
  isAwaitingExternalAction,
  isKnownRailwayStatus,
  isTerminalState,
  normalizeDeploymentStatus,
} from './deployment-status'
import type { DeploymentState } from './deployment-status'

describe('normalizeDeploymentStatus', () => {
  // The mapping table from spec 06, plus the statuses the spec's examples omit.
  const cases: Array<[string, DeploymentState]> = [
    ['INITIALIZING', 'PROVISIONING'],
    ['QUEUED', 'PROVISIONING'],
    ['BUILDING', 'PROVISIONING'],
    ['DEPLOYING', 'PROVISIONING'],
    ['SUCCESS', 'RUNNING'],
    ['FAILED', 'FAILED'],
    ['CRASHED', 'CRASHED'],
    ['REMOVING', 'STOPPING'],
    ['REMOVED', 'STOPPED'],
    ['SKIPPED', 'SKIPPED'],
    ['SLEEPING', 'SLEEPING'],
    ['WAITING', 'WAITING'],
    ['NEEDS_APPROVAL', 'NEEDS_APPROVAL'],
  ]

  it.each(cases)('maps %s to %s', (raw, expected) => {
    expect(normalizeDeploymentStatus(raw)).toBe(expected)
  })

  it('covers every status in the live Railway enum', () => {
    // Guards against Railway adding an enum value that we silently drop.
    const mapped = new Set(cases.map(([raw]) => raw))
    expect([...RAILWAY_DEPLOYMENT_STATUSES].sort()).toEqual([...mapped].sort())
  })

  it('maps an unrecognised status to UNKNOWN rather than guessing', () => {
    expect(normalizeDeploymentStatus('SOME_FUTURE_STATUS')).toBe('UNKNOWN')
  })

  it('treats missing and empty statuses as UNKNOWN', () => {
    expect(normalizeDeploymentStatus(null)).toBe('UNKNOWN')
    expect(normalizeDeploymentStatus(undefined)).toBe('UNKNOWN')
    expect(normalizeDeploymentStatus('')).toBe('UNKNOWN')
  })

  it('is case sensitive, because Railway is', () => {
    expect(normalizeDeploymentStatus('success')).toBe('UNKNOWN')
  })
})

describe('isKnownRailwayStatus', () => {
  it('recognises live enum values and rejects others', () => {
    expect(isKnownRailwayStatus('BUILDING')).toBe(true)
    expect(isKnownRailwayStatus('NEEDS_APPROVAL')).toBe(true)
    expect(isKnownRailwayStatus('NOT_A_STATUS')).toBe(false)
  })
})

describe('state classification', () => {
  it('treats settled outcomes as terminal', () => {
    for (const state of ['RUNNING', 'FAILED', 'CRASHED', 'STOPPED', 'SKIPPED'] as const) {
      expect(isTerminalState(state)).toBe(true)
    }
  })

  it('does not treat in-flight states as terminal', () => {
    for (const state of ['PROVISIONING', 'STOPPING', 'NO_DEPLOYMENT', 'UNKNOWN'] as const) {
      expect(isTerminalState(state)).toBe(false)
    }
  })

  it('separates "waiting on someone else" from "finished"', () => {
    for (const state of ['NEEDS_APPROVAL', 'WAITING', 'SLEEPING'] as const) {
      expect(isAwaitingExternalAction(state)).toBe(true)
      expect(isTerminalState(state)).toBe(false)
    }
  })

  it('counts only PROVISIONING and STOPPING as actively changing', () => {
    expect(isActiveState('PROVISIONING')).toBe(true)
    expect(isActiveState('STOPPING')).toBe(true)
    expect(isActiveState('RUNNING')).toBe(false)
    expect(isActiveState('UNKNOWN')).toBe(false)
  })

  it('classifies every state as exactly one of terminal, awaiting, or active — or neither', () => {
    // NO_DEPLOYMENT and UNKNOWN belong to no bucket by design; nothing may
    // belong to two, or the polling precedence rules become ambiguous.
    for (const state of Object.keys(DEPLOYMENT_STATE_LABELS) as DeploymentState[]) {
      const buckets = [
        isTerminalState(state),
        isAwaitingExternalAction(state),
        isActiveState(state),
      ].filter(Boolean)
      expect(buckets.length).toBeLessThanOrEqual(1)
    }
  })
})

describe('describeObservation', () => {
  it('shows the specific Railway phase while provisioning', () => {
    expect(describeObservation({ state: 'PROVISIONING', rawStatus: 'BUILDING' })).toBe('Building')
    expect(describeObservation({ state: 'PROVISIONING', rawStatus: 'QUEUED' })).toBe('Queued')
    expect(describeObservation({ state: 'PROVISIONING', rawStatus: 'DEPLOYING' })).toBe('Deploying')
  })

  it('falls back to the state label for other states', () => {
    expect(describeObservation({ state: 'RUNNING', rawStatus: 'SUCCESS' })).toBe('Running')
    expect(describeObservation({ state: 'UNKNOWN', rawStatus: 'WHATEVER' })).toBe(
      'Unknown Railway state',
    )
  })

  it('has a label for every state', () => {
    for (const label of Object.values(DEPLOYMENT_STATE_LABELS)) {
      expect(label.length).toBeGreaterThan(0)
    }
  })
})
