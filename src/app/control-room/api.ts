/**
 * Typed calls to our own endpoints. The browser only ever talks to these.
 */

import type { ActionEligibility, SandboxAction } from '@/domain/actions'
import type { DeploymentObservation } from '@/domain/deployment-status'
import type { ErrorCategory, StateCertainty } from '@/domain/errors'
import type { RateLimitSnapshot } from '@/domain/polling'
import type { RailwayLogLine, RailwayProject, RailwayService } from '@/railway/client'

export interface ApiError {
  category: ErrorCategory
  message: string
  retryable: boolean
  certainty: StateCertainty
  retryAfterMs?: number
}

/** Thrown for every non-2xx response, carrying the server's own explanation. */
export class RequestFailed extends Error {
  readonly detail: ApiError

  constructor(detail: ApiError) {
    super(detail.message)
    this.name = 'RequestFailed'
    this.detail = detail
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { ...init, cache: 'no-store' })
  } catch {
    throw new RequestFailed({
      category: 'RAILWAY_UNAVAILABLE',
      message: 'Could not reach the Control Room server. Check your connection and retry.',
      retryable: true,
      certainty: 'unknown',
    })
  }

  const body = await response.json().catch(() => null)

  if (!response.ok) {
    const detail = (body as { error?: ApiError } | null)?.error
    throw new RequestFailed(
      detail ?? {
        category: 'INTERNAL_ERROR',
        message: `The server returned ${response.status}.`,
        retryable: false,
        certainty: 'unknown',
      },
    )
  }

  return body as T
}

function postJson<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export interface SandboxStatusResponse {
  service: RailwayService | null
  deployment: DeploymentObservation | null
  actions: ActionEligibility
  primaryAction: SandboxAction | null
  rateLimit: RateLimitSnapshot
}

export interface DeploymentResponse {
  deployment: DeploymentObservation
  actions: ActionEligibility
  primaryAction: SandboxAction | null
  rateLimit: RateLimitSnapshot
}

export const api = {
  projects: () =>
    request<{ projects: RailwayProject[]; rateLimit: RateLimitSnapshot }>('/api/projects'),

  environments: (projectId: string) =>
    request<{ environments: Array<{ id: string; name: string }>; rateLimit: RateLimitSnapshot }>(
      `/api/environments?projectId=${encodeURIComponent(projectId)}`,
    ),

  sandboxStatus: (projectId: string, environmentId: string) =>
    request<SandboxStatusResponse>(
      `/api/sandbox?projectId=${encodeURIComponent(projectId)}&environmentId=${encodeURIComponent(environmentId)}`,
    ),

  createSandbox: (projectId: string, environmentId: string) =>
    postJson<{ service: RailwayService; created: boolean }>('/api/sandbox', {
      projectId,
      environmentId,
    }),

  runAction: (
    projectId: string,
    environmentId: string,
    action: SandboxAction,
    expectedDeploymentId?: string,
  ) =>
    postJson<{ action: SandboxAction; deploymentId: string }>('/api/sandbox/action', {
      projectId,
      environmentId,
      action,
      expectedDeploymentId,
    }),

  deployment: (deploymentId: string) =>
    request<DeploymentResponse>(`/api/deployments/${encodeURIComponent(deploymentId)}`),

  logs: (deploymentId: string, kind: 'build' | 'runtime') =>
    request<{ kind: string; logs: RailwayLogLine[] }>(
      `/api/deployments/${encodeURIComponent(deploymentId)}/logs?kind=${kind}`,
    ),

  history: (projectId: string, environmentId: string, serviceId: string) =>
    request<{ deployments: DeploymentObservation[] }>(
      `/api/deployments?projectId=${encodeURIComponent(projectId)}&environmentId=${encodeURIComponent(environmentId)}&serviceId=${encodeURIComponent(serviceId)}`,
    ),
}
