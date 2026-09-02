/**
 * Railway operations, expressed in the terms this app cares about.
 *
 * Each function takes an access token, sends one GraphQL document, and returns typed
 * values plus the rate-limit headers from that response. Callers above this layer never
 * construct a query or read a status code.
 */

import { normalizeDeploymentStatus } from '@/domain/deployment-status'
import type { DeploymentObservation } from '@/domain/deployment-status'
import { errors } from '@/domain/errors'
import * as q from './queries'
import { railwayRequest } from './transport'
import type { RailwayResponse } from './transport'

export interface RailwayProject {
  id: string
  name: string
  workspaceId: string
  workspaceName: string
}

export interface RailwayEnvironment {
  id: string
  name: string
}

export interface RailwayService {
  id: string
  name: string
}

export interface RailwayLogLine {
  timestamp: string
  message: string
  severity: string | null
}

interface RawDeployment {
  id: string
  status: string | null
  createdAt: string
  statusUpdatedAt: string | null
  url: string | null
  staticUrl: string | null
  deploymentStopped: boolean | null
}

/**
 * Railway returns a bare hostname here, not a URL. Passed through as-is the browser reads
 * it as a relative path and resolves it against our own origin, which 404s.
 */
function toAbsoluteUrl(value: string | null): string | null {
  if (value === null || value.trim() === '') return null
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

function toObservation(raw: RawDeployment): DeploymentObservation {
  return {
    deploymentId: raw.id,
    rawStatus: raw.status ?? '',
    state: normalizeDeploymentStatus(raw.status),
    createdAt: raw.createdAt,
    statusUpdatedAt: raw.statusUpdatedAt,
    // staticUrl is Railway's stable per-deployment address; url is only set once a
    // domain exists. Either is more useful to show than nothing.
    url: toAbsoluteUrl(raw.url ?? raw.staticUrl),
    stopped: raw.deploymentStopped === true,
    observedAt: new Date().toISOString(),
  }
}

/**
 * The Sandbox name is derived from the environment so one project can hold a Sandbox per
 * environment without the names colliding, and so we can find an existing one again
 * instead of creating a second.
 */
export function sandboxServiceName(environmentId: string): string {
  return `control-room-sandbox-${environmentId.slice(0, 8)}`
}

export async function listProjects(accessToken: string): Promise<RailwayResponse<RailwayProject[]>> {
  const response = await railwayRequest<{
    externalWorkspaces: Array<{ id: string; name: string; projects: Array<{ id: string; name: string }> }>
  }>(accessToken, q.PROJECTS, {}, 'query')

  const projects = response.data.externalWorkspaces.flatMap((workspace) =>
    workspace.projects.map((project) => ({
      id: project.id,
      name: project.name,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    })),
  )

  return { data: projects, rateLimit: response.rateLimit }
}

export async function listEnvironments(
  accessToken: string,
  projectId: string,
): Promise<RailwayResponse<RailwayEnvironment[]>> {
  const response = await railwayRequest<{
    environments: { edges: Array<{ node: RailwayEnvironment }> }
  }>(accessToken, q.ENVIRONMENTS, { projectId }, 'query')

  return {
    data: response.data.environments.edges.map((edge) => edge.node),
    rateLimit: response.rateLimit,
  }
}

/** Returns null when this project/environment has no Sandbox yet. */
export async function findSandbox(
  accessToken: string,
  projectId: string,
  environmentId: string,
): Promise<RailwayResponse<RailwayService | null>> {
  const response = await railwayRequest<{
    project: { services: { edges: Array<{ node: RailwayService }> } }
  }>(accessToken, q.PROJECT_SERVICES, { projectId }, 'query')

  const wanted = sandboxServiceName(environmentId)
  const match = response.data.project.services.edges.find((edge) => edge.node.name === wanted)

  return { data: match?.node ?? null, rateLimit: response.rateLimit }
}

export async function createSandbox(
  accessToken: string,
  projectId: string,
  environmentId: string,
  image: string,
): Promise<RailwayResponse<RailwayService>> {
  const response = await railwayRequest<{ serviceCreate: RailwayService }>(
    accessToken,
    q.SERVICE_CREATE,
    {
      input: {
        projectId,
        environmentId,
        name: sandboxServiceName(environmentId),
        source: { image },
      },
    },
    'mutation',
  )

  return { data: response.data.serviceCreate, rateLimit: response.rateLimit }
}

/**
 * The service's current deployment, or null if it has never been deployed.
 * This is the read that action eligibility is decided from.
 */
export async function getLatestDeployment(
  accessToken: string,
  serviceId: string,
  environmentId: string,
): Promise<RailwayResponse<DeploymentObservation | null>> {
  const response = await railwayRequest<{
    serviceInstance: { latestDeployment: RawDeployment | null }
  }>(accessToken, q.SERVICE_INSTANCE, { serviceId, environmentId }, 'query')

  const latest = response.data.serviceInstance.latestDeployment
  return { data: latest === null ? null : toObservation(latest), rateLimit: response.rateLimit }
}

export async function getDeployment(
  accessToken: string,
  deploymentId: string,
): Promise<RailwayResponse<DeploymentObservation>> {
  const response = await railwayRequest<{ deployment: RawDeployment }>(
    accessToken,
    q.DEPLOYMENT,
    { id: deploymentId },
    'query',
  )

  return { data: toObservation(response.data.deployment), rateLimit: response.rateLimit }
}

export async function listDeployments(
  accessToken: string,
  projectId: string,
  environmentId: string,
  serviceId: string,
  limit = 10,
): Promise<RailwayResponse<DeploymentObservation[]>> {
  const response = await railwayRequest<{
    deployments: { edges: Array<{ node: RawDeployment }> }
  }>(
    accessToken,
    q.DEPLOYMENTS,
    { input: { projectId, environmentId, serviceId }, first: limit },
    'query',
  )

  return {
    data: response.data.deployments.edges.map((edge) => toObservation(edge.node)),
    rateLimit: response.rateLimit,
  }
}

/** Returns the new deployment's ID, which is how everything afterwards is correlated. */
export async function deploySandbox(
  accessToken: string,
  serviceId: string,
  environmentId: string,
): Promise<RailwayResponse<string>> {
  const response = await railwayRequest<{ serviceInstanceDeployV2: string }>(
    accessToken,
    q.SERVICE_INSTANCE_DEPLOY,
    { serviceId, environmentId },
    'mutation',
  )

  const deploymentId = response.data.serviceInstanceDeployV2
  if (typeof deploymentId !== 'string' || deploymentId.length === 0) {
    // Without an ID we cannot tell which deployment we just started, and guessing from
    // the newest one is wrong the moment anything else deploys at the same time.
    throw errors.railwayGraphQL(
      'Railway accepted the deploy but did not return a deployment ID, so it cannot be tracked.',
      response.data,
    )
  }

  return { data: deploymentId, rateLimit: response.rateLimit }
}

async function deploymentCommand(
  accessToken: string,
  document: string,
  deploymentId: string,
  field: string,
): Promise<RailwayResponse<void>> {
  const response = await railwayRequest<Record<string, boolean>>(
    accessToken,
    document,
    { id: deploymentId },
    'mutation',
  )

  // These mutations return a bare Boolean. A false is Railway declining the command,
  // which is not the same as a transport failure and must not be reported as success.
  if (response.data[field] !== true) {
    throw errors.railwayGraphQL('Railway did not accept that command.', response.data)
  }

  return { data: undefined, rateLimit: response.rateLimit }
}

export function restartDeployment(accessToken: string, deploymentId: string) {
  return deploymentCommand(accessToken, q.DEPLOYMENT_RESTART, deploymentId, 'deploymentRestart')
}

export function stopDeployment(accessToken: string, deploymentId: string) {
  return deploymentCommand(accessToken, q.DEPLOYMENT_STOP, deploymentId, 'deploymentStop')
}

export function cancelDeployment(accessToken: string, deploymentId: string) {
  return deploymentCommand(accessToken, q.DEPLOYMENT_CANCEL, deploymentId, 'deploymentCancel')
}

export function approveDeployment(accessToken: string, deploymentId: string) {
  return deploymentCommand(accessToken, q.DEPLOYMENT_APPROVE, deploymentId, 'deploymentApprove')
}

export async function getBuildLogs(
  accessToken: string,
  deploymentId: string,
  limit = 200,
): Promise<RailwayResponse<RailwayLogLine[]>> {
  const response = await railwayRequest<{ buildLogs: RailwayLogLine[] }>(
    accessToken,
    q.BUILD_LOGS,
    { deploymentId, limit },
    'query',
  )
  return { data: response.data.buildLogs, rateLimit: response.rateLimit }
}

export async function getRuntimeLogs(
  accessToken: string,
  deploymentId: string,
  limit = 200,
): Promise<RailwayResponse<RailwayLogLine[]>> {
  const response = await railwayRequest<{ deploymentLogs: RailwayLogLine[] }>(
    accessToken,
    q.RUNTIME_LOGS,
    { deploymentId, limit },
    'query',
  )
  return { data: response.data.deploymentLogs, rateLimit: response.rateLimit }
}
