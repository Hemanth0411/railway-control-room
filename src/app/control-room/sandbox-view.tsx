'use client'

import { useEffect, useState } from 'react'

import type { SandboxAction } from '@/domain/actions'
import { SANDBOX_ACTIONS } from '@/domain/actions'
import type { DeploymentObservation } from '@/domain/deployment-status'
import { RequestFailed, api } from './api'
import type { ApiError, SandboxStatusResponse } from './api'
import { Button, Empty, ErrorNotice, Loading, Panel, StatusBadge } from './components'
import { ACTION_LABELS, CONFIRM_PROMPTS, POLLING_STOP_MESSAGES } from './labels'
import { Logs } from './logs'
import { Timeline } from './timeline'
import { useDeploymentWatch } from './use-deployment'

function toApiError(cause: unknown, fallback: string): ApiError {
  if (cause instanceof RequestFailed) return cause.detail
  return { category: 'INTERNAL_ERROR', message: fallback, retryable: true, certainty: 'unknown' }
}

/**
 * Everything below the project/environment pickers.
 *
 * The parent gives this a React key built from the project and environment, so switching
 * either one remounts it with fresh state. That is cheaper to reason about than an effect
 * that resets half a dozen values on the way in, and it cannot go stale.
 */
export function SandboxView({
  projectId,
  environmentId,
  onRateLimit,
}: {
  projectId: string
  environmentId: string
  onRateLimit: (remaining: number | undefined) => void
}) {
  const [status, setStatus] = useState<SandboxStatusResponse | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)
  const [history, setHistory] = useState<DeploymentObservation[] | null>(null)
  /** Set after an action starts a new deployment, before the next status read. */
  const [startedDeploymentId, setStartedDeploymentId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    api
      .sandboxStatus(projectId, environmentId)
      .then((result) => {
        if (cancelled) return
        setStatus(result)
        setError(null)
        onRateLimit(result.rateLimit.remaining)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(toApiError(cause, 'Could not read the Sandbox.'))
      })

    return () => {
      cancelled = true
    }
  }, [projectId, environmentId, onRateLimit, reloads])

  const deploymentId = startedDeploymentId ?? status?.deployment?.deploymentId ?? null
  const watch = useDeploymentWatch(deploymentId)

  const observation = watch.observation?.deployment ?? status?.deployment ?? null
  const actions = watch.observation?.actions ?? status?.actions ?? null
  const primary = watch.observation?.primaryAction ?? status?.primaryAction ?? null

  useEffect(() => {
    onRateLimit(watch.rateLimit.remaining)
  }, [watch.rateLimit.remaining, onRateLimit])

  async function createSandbox() {
    setBusy('create')
    try {
      await api.createSandbox(projectId, environmentId)
      setReloads((n) => n + 1)
    } catch (cause) {
      setError(toApiError(cause, 'Could not create the Sandbox.'))
    } finally {
      setBusy(null)
    }
  }

  async function runAction(action: SandboxAction) {
    const prompt = CONFIRM_PROMPTS[action]
    if (prompt !== undefined && !window.confirm(prompt)) return

    setBusy(action)
    try {
      const result = await api.runAction(
        projectId,
        environmentId,
        action,
        // Tells the server which deployment this page was looking at, so a stale tab
        // cannot act on a deployment the user never saw.
        observation?.deploymentId,
      )
      setStartedDeploymentId(result.deploymentId)
      setError(null)
    } catch (cause) {
      setError(toApiError(cause, `Could not ${ACTION_LABELS[action].toLowerCase()}.`))
    } finally {
      setBusy(null)
    }
  }

  async function loadHistory() {
    if (status?.service == null) return
    setBusy('history')
    try {
      const result = await api.history(projectId, environmentId, status.service.id)
      setHistory(result.deployments)
    } catch (cause) {
      setError(toApiError(cause, 'Could not load deployment history.'))
    } finally {
      setBusy(null)
    }
  }

  if (status === null && error === null) {
    return (
      <Panel title="Sandbox">
        <Loading label="Reading the Sandbox…" />
      </Panel>
    )
  }

  if (status === null) {
    return (
      <>
        {error !== null && <ErrorNotice error={error} onRetry={() => setReloads((n) => n + 1)} />}
      </>
    )
  }

  if (status.service === null) {
    return (
      <Panel title="Sandbox">
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted">
            No Sandbox in this environment yet. Creating one adds a single service running a fixed
            image.
          </p>
          {error !== null && <ErrorNotice error={error} />}
          <Button variant="primary" onClick={() => void createSandbox()} disabled={busy !== null}>
            {busy === 'create' ? 'Creating…' : 'Create Sandbox'}
          </Button>
        </div>
      </Panel>
    )
  }

  return (
    <>
      {error !== null && <ErrorNotice error={error} onRetry={() => setReloads((n) => n + 1)} />}

      <Panel
        title="Sandbox"
        action={
          <Button onClick={watch.refresh} disabled={watch.isObserving || deploymentId === null}>
            {watch.isObserving ? 'Refreshing' : 'Refresh'}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <StatusBadge observation={observation} size="large" />
            <div className="text-right text-xs text-muted">
              <p className="font-mono">{status.service.name}</p>
              {observation !== null && (
                <p className="font-mono">
                  {observation.deploymentId.slice(0, 12)} · Railway says{' '}
                  {observation.rawStatus || 'nothing'}
                </p>
              )}
            </div>
          </div>

          {observation === null ? (
            <Empty>This Sandbox has never been deployed.</Empty>
          ) : (
            <Timeline observation={observation} />
          )}

          {watch.stopped !== null && (
            <p className="text-xs text-muted">{POLLING_STOP_MESSAGES[watch.stopped]}</p>
          )}

          {watch.error !== null && <ErrorNotice error={watch.error} onRetry={watch.refresh} />}

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            {SANDBOX_ACTIONS.map((action) => {
              const verdict = actions?.[action]
              const allowed = verdict?.allowed === true
              return (
                <Button
                  key={action}
                  variant={action === 'STOP' ? 'danger' : primary === action ? 'primary' : 'secondary'}
                  disabled={!allowed || busy !== null}
                  title={verdict?.reason}
                  onClick={() => void runAction(action)}
                >
                  {busy === action ? `${ACTION_LABELS[action]}…` : ACTION_LABELS[action]}
                </Button>
              )
            })}
          </div>

          {observation?.url != null && (
            <a
              href={observation.url}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-accent underline underline-offset-4"
            >
              Open the deployment
            </a>
          )}
        </div>
      </Panel>

      <Logs deploymentId={deploymentId} />

      <Panel
        title="Recent deployments"
        action={
          <Button onClick={() => void loadHistory()} disabled={busy !== null}>
            {history === null ? 'Load' : 'Refresh'}
          </Button>
        }
      >
        {history === null ? (
          // On demand: history costs a Railway request, and the Free plan allows 100 an hour.
          <Empty>History is loaded on request, to save API budget.</Empty>
        ) : history.length === 0 ? (
          <Empty>No deployments yet.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {history.map((entry) => (
              <li
                key={entry.deploymentId}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <StatusBadge observation={entry} />
                <span className="font-mono text-xs text-muted">
                  {entry.deploymentId.slice(0, 12)} · {new Date(entry.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  )
}
