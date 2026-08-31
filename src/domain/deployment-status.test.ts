import { describe, expect, it } from 'vitest'

import {
  RAILWAY_DEPLOYMENT_STATUSES,
  isActiveState,
  isAwaitingExternalAction,
  isKnownRailwayStatus,
  isTerminalState,
  normalizeDeploymentStatus,
} from './deployment-status'
import type { DeploymentState } from './deployment-status'

const ALL_STATES: DeploymentState[] = [
  'NO_DEPLOYMENT',
  'PROVISIONING',
  'NEEDS_APPROVAL',
  'RUNNING',
  'FAILED',
  'CRASHED',
  'STOPPING',
  'STOPPED',
  'SKIPPED',
  'SLEEPING',
  'WAITING',
  'UNKNOWN',
]

describe('normalizeDeploymentStatus', () => {
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
    // Fails if Railway adds a status and we forget to map it.
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

  it('never puts a state in two buckets', () => {
    // The polling rules check these in order, so overlap would make the outcome
    // depend on that order. NO_DEPLOYMENT and UNKNOWN belong to no bucket.
    for (const state of ALL_STATES) {
      const buckets = [
        isTerminalState(state),
        isAwaitingExternalAction(state),
        isActiveState(state),
      ].filter(Boolean)
      expect(buckets.length, state).toBeLessThanOrEqual(1)
    }
  })
})
