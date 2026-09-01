/**
 * What the API routes actually do, kept out of the route files so it can be tested
 * without a Next request.
 *
 * The important rule lives here: every command re-reads the current deployment from
 * Railway and checks eligibility against it before sending anything. The UI disabling a
 * button is a convenience; this is the part that stops a double click, a retry or a stale
 * tab turning one intent into two deployments.
 */

import { checkAction, evaluateActions, primaryAction } from '@/domain/actions'
import type { ActionEligibility, SandboxAction } from '@/domain/actions'
import type { DeploymentObservation } from '@/domain/deployment-status'
import { errors } from '@/domain/errors'
import type { RateLimitSnapshot } from '@/domain/polling'
import * as railway from '@/railway/client'
import type { RailwayService } from '@/railway/client'

export interface SandboxStatus {
  service: RailwayService | null
  deployment: DeploymentObservation | null
  actions: ActionEligibility
  primaryAction: SandboxAction | null
  rateLimit: RateLimitSnapshot
}

export async function getSandboxStatus(
  accessToken: string,
  projectId: string,
  environmentId: string,
): Promise<SandboxStatus> {
  const found = await railway.findSandbox(accessToken, projectId, environmentId)

  if (found.data === null) {
    return {
      service: null,
      deployment: null,
      actions: evaluateActions(null),
      primaryAction: null,
      rateLimit: found.rateLimit,
    }
  }

  const latest = await railway.getLatestDeployment(accessToken, found.data.id, environmentId)

  return {
    service: found.data,
    deployment: latest.data,
    actions: evaluateActions(latest.data),
    primaryAction: primaryAction(latest.data),
    rateLimit: latest.rateLimit,
  }
}

/**
 * Look before creating. Without this a second click, or a refresh mid-request, would
 * leave two Sandbox services in the user's project - and we have no database recording
 * that we already made one.
 */
export async function ensureSandbox(
  accessToken: string,
  projectId: string,
  environmentId: string,
  image: string,
): Promise<{ service: RailwayService; created: boolean; rateLimit: RateLimitSnapshot }> {
  const found = await railway.findSandbox(accessToken, projectId, environmentId)
  if (found.data !== null) {
    return { service: found.data, created: false, rateLimit: found.rateLimit }
  }

  const created = await railway.createSandbox(accessToken, projectId, environmentId, image)
  return { service: created.data, created: true, rateLimit: created.rateLimit }
}

export interface ActionResult {
  action: SandboxAction
  /** The deployment the command applies to, or the new one for a deploy. */
  deploymentId: string
  rateLimit: RateLimitSnapshot
}

export async function runSandboxAction(
  accessToken: string,
  projectId: string,
  environmentId: string,
  action: SandboxAction,
  expectedDeploymentId?: string,
): Promise<ActionResult> {
  const found = await railway.findSandbox(accessToken, projectId, environmentId)
  if (found.data === null) {
    throw errors.notFound('There is no Sandbox in this environment yet. Create one first.')
  }

  const serviceId = found.data.id
  const latest = await railway.getLatestDeployment(accessToken, serviceId, environmentId)
  const observation = latest.data

  // The caller tells us which deployment it was looking at. If Railway has moved on
  // since, acting now would hit a different deployment than the user meant.
  if (
    expectedDeploymentId !== undefined &&
    observation?.deploymentId !== expectedDeploymentId
  ) {
    throw errors.conflict(
      'The deployment changed since this page last looked. Refresh to see the current state.',
    )
  }

  const blocked = checkAction(action, observation)
  if (blocked !== null) throw errors.conflict(blocked)

  if (action === 'DEPLOY') {
    const deployed = await railway.deploySandbox(accessToken, serviceId, environmentId)
    return { action, deploymentId: deployed.data, rateLimit: deployed.rateLimit }
  }

  // Everything else acts on the deployment we just observed. checkAction has already
  // established one exists and is in a state that permits this command.
  if (observation === null) {
    throw errors.conflict('There is no deployment to act on.')
  }

  const deploymentId = observation.deploymentId
  const result = await runDeploymentCommand(accessToken, action, deploymentId)
  return { action, deploymentId, rateLimit: result.rateLimit }
}

function runDeploymentCommand(accessToken: string, action: SandboxAction, deploymentId: string) {
  switch (action) {
    case 'RESTART':
      return railway.restartDeployment(accessToken, deploymentId)
    case 'STOP':
      return railway.stopDeployment(accessToken, deploymentId)
    case 'CANCEL':
      return railway.cancelDeployment(accessToken, deploymentId)
    case 'APPROVE':
      return railway.approveDeployment(accessToken, deploymentId)
    default:
      throw errors.validation(`Unsupported action ${action}.`)
  }
}
