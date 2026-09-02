'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { nextPollingDecision } from '@/domain/polling'
import type { PollingStopReason, RateLimitSnapshot } from '@/domain/polling'
import type { DeploymentState } from '@/domain/deployment-status'
import { RequestFailed, api } from './api'
import type { ApiError, DeploymentResponse } from './api'

/**
 * Everything the watch knows, tagged with the deployment it belongs to.
 *
 * Tagging is what lets a new deployment id show an empty watch immediately, without an
 * effect having to reset four pieces of state on the way in. Anything whose tag does not
 * match the current id is simply ignored.
 */
interface WatchState {
  forDeploymentId: string | null
  observation: DeploymentResponse | null
  error: ApiError | null
  stopped: PollingStopReason | null
  isObserving: boolean
  rateLimit: RateLimitSnapshot
}

const EMPTY: WatchState = {
  forDeploymentId: null,
  observation: null,
  error: null,
  stopped: null,
  isObserving: false,
  rateLimit: {},
}

export interface DeploymentWatch {
  observation: DeploymentResponse | null
  error: ApiError | null
  /** Set once automatic observation has stopped, with the reason. */
  stopped: PollingStopReason | null
  isObserving: boolean
  rateLimit: RateLimitSnapshot
  refresh: () => void
}

/**
 * Watches one deployment until it settles.
 *
 * The schedule comes from the domain policy, so backoff, the hard timeout and the
 * rate-limit budget are decided in one tested place rather than here. This hook only does
 * what React has to: hold the latest observation and cancel cleanly.
 *
 * It chains setTimeout rather than using setInterval, so a slow response can never stack
 * up overlapping requests - which on a 100-per-hour budget would be expensive.
 */
export function useDeploymentWatch(deploymentId: string | null): DeploymentWatch {
  const [state, setState] = useState<WatchState>(EMPTY)
  const [attempt, setAttempt] = useState(0)
  const refresh = useCallback(() => setAttempt((n) => n + 1), [])
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (deploymentId === null) return

    let cancelled = false
    const startedAt = Date.now()
    let observations = 0
    // Assume it is still moving, so the first decision is always "look now".
    let lastState: DeploymentState = 'PROVISIONING'
    let lastRateLimit: RateLimitSnapshot = {}

    function schedule() {
      if (cancelled) return

      const decision = nextPollingDecision({
        observations,
        elapsedMs: Date.now() - startedAt,
        state: lastState,
        rateLimit: lastRateLimit,
      })

      if (decision.action === 'stop') {
        setState((current) => ({ ...current, isObserving: false, stopped: decision.reason }))
        return
      }

      timer.current = setTimeout(observe, decision.delayMs)
    }

    async function observe() {
      if (cancelled) return

      try {
        const result = await api.deployment(deploymentId as string)
        if (cancelled) return

        observations += 1
        lastState = result.deployment.state
        lastRateLimit = result.rateLimit

        setState({
          forDeploymentId: deploymentId,
          observation: result,
          error: null,
          stopped: null,
          isObserving: true,
          rateLimit: result.rateLimit,
        })
        schedule()
      } catch (cause) {
        if (cancelled) return

        const detail = cause instanceof RequestFailed ? cause.detail : null
        const error: ApiError = detail ?? {
          category: 'INTERNAL_ERROR',
          message: 'Something went wrong while reading the deployment.',
          retryable: true,
          certainty: 'unknown',
        }

        setState((current) => ({
          ...current,
          forDeploymentId: deploymentId,
          error,
          isObserving: false,
        }))

        // A rate limit is the one failure that says when to try again. Anything else
        // stops the loop rather than hammering an endpoint that is already failing.
        if (detail?.category === 'RAILWAY_RATE_LIMITED' && detail.retryAfterMs !== undefined) {
          lastRateLimit = { retryAfterMs: detail.retryAfterMs }
          schedule()
        }
      }
    }

    // Scheduled rather than called, so the effect body itself never sets state.
    timer.current = setTimeout(observe, 0)

    return () => {
      cancelled = true
      if (timer.current !== undefined) clearTimeout(timer.current)
    }
  }, [deploymentId, attempt])

  const current = state.forDeploymentId === deploymentId ? state : EMPTY

  return {
    observation: current.observation,
    error: current.error,
    stopped: current.stopped,
    isObserving: deploymentId !== null && current.observation === null && current.error === null,
    rateLimit: current.rateLimit,
    refresh,
  }
}
