'use client'

import { useCallback, useEffect, useState } from 'react'

import type { RailwayProject } from '@/railway/client'
import { RequestFailed, api } from './api'
import type { ApiError } from './api'
import { Button, Empty, ErrorNotice, Field, Panel, Select } from './components'
import { SandboxView } from './sandbox-view'

interface Props {
  user: { name?: string; email?: string }
}

/** Tagged with the project it belongs to, so switching project shows loading without a reset. */
interface Environments {
  projectId: string
  list: Array<{ id: string; name: string }>
}

function toApiError(cause: unknown, fallback: string): ApiError {
  if (cause instanceof RequestFailed) return cause.detail
  return { category: 'INTERNAL_ERROR', message: fallback, retryable: true, certainty: 'unknown' }
}

export function ControlRoom({ user }: Props) {
  const [projects, setProjects] = useState<RailwayProject[] | null>(null)
  const [environments, setEnvironments] = useState<Environments | null>(null)
  const [projectId, setProjectId] = useState('')
  const [chosenEnvironmentId, setChosenEnvironmentId] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [remaining, setRemaining] = useState<number | undefined>(undefined)

  const onRateLimit = useCallback((value: number | undefined) => {
    if (value !== undefined) setRemaining(value)
  }, [])

  useEffect(() => {
    api
      .projects()
      .then((result) => setProjects(result.projects))
      .catch((cause) => setError(toApiError(cause, 'Could not load your Railway projects.')))
  }, [])

  useEffect(() => {
    if (projectId === '') return
    api
      .environments(projectId)
      .then((result) => setEnvironments({ projectId, list: result.environments }))
      .catch((cause) => setError(toApiError(cause, 'Could not load environments.')))
  }, [projectId])

  const currentEnvironments = environments?.projectId === projectId ? environments.list : null

  // Derived rather than reset: if the chosen environment isn't in the current project's
  // list, it simply isn't selected.
  const environmentId =
    currentEnvironments?.some((environment) => environment.id === chosenEnvironmentId) === true
      ? chosenEnvironmentId
      : ''

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Railway Control Room</h1>
          <p className="text-sm text-muted">One Sandbox service, and the truth about its state.</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted">{user.name ?? user.email ?? 'Signed in'}</span>
          <form action="/api/auth/logout" method="post">
            <Button type="submit">Sign out</Button>
          </form>
        </div>
      </header>

      <Panel title="Project and environment">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Project">
            {projects === null ? (
              <span className="text-sm text-muted">Loading…</span>
            ) : projects.length === 0 ? (
              <span className="text-sm text-muted">
                No projects authorized. Grant access on Railway, then sign in again.
              </span>
            ) : (
              <Select label="Project" value={projectId} onChange={setProjectId}>
                <option value="">Select a project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} · {project.workspaceName}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Environment">
            {projectId === '' ? (
              <span className="text-sm text-muted">Pick a project first</span>
            ) : currentEnvironments === null ? (
              <span className="text-sm text-muted">Loading…</span>
            ) : currentEnvironments.length === 0 ? (
              <span className="text-sm text-muted">This project has no environments.</span>
            ) : (
              <Select
                label="Environment"
                value={environmentId}
                onChange={setChosenEnvironmentId}
              >
                <option value="">Select an environment</option>
                {currentEnvironments.map((environment) => (
                  <option key={environment.id} value={environment.id}>
                    {environment.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {remaining !== undefined && (
            <p className="ml-auto text-xs text-muted">
              Railway API budget: <span className="font-mono">{remaining}</span> left this hour
            </p>
          )}
        </div>
      </Panel>

      {error !== null && <ErrorNotice error={error} />}

      {projectId === '' || environmentId === '' ? (
        <Panel title="Sandbox">
          <Empty>Select a project and environment to see its Sandbox.</Empty>
        </Panel>
      ) : (
        <SandboxView
          // Remounting on a change is simpler and safer than resetting state in an effect.
          key={`${projectId}:${environmentId}`}
          projectId={projectId}
          environmentId={environmentId}
          onRateLimit={onRateLimit}
        />
      )}
    </div>
  )
}
