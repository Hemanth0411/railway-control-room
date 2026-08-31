/**
 * Decides which Sandbox actions are valid given the deployment Railway currently reports.
 *
 * The server calls this immediately before every mutation. That stops a double click,
 * a browser retry or a stale tab from turning one intent into two deployments.
 *
 * It does not give exactly-once execution. Two requests can read the same state and
 * both be allowed through. Railway has no idempotency key for these mutations, so that
 * gap can't be closed from here.
 */

import type { DeploymentObservation, DeploymentState } from './deployment-status'

export const SANDBOX_ACTIONS = ['DEPLOY', 'RESTART', 'STOP', 'CANCEL', 'APPROVE'] as const
export type SandboxAction = (typeof SANDBOX_ACTIONS)[number]

export interface ActionVerdict {
  allowed: boolean
  /** Shown as the tooltip on a disabled button and as the message on a 409, so it's written once. */
  reason?: string
}

export type ActionEligibility = Record<SandboxAction, ActionVerdict>

const ALLOWED: ActionVerdict = { allowed: true }
const deny = (reason: string): ActionVerdict => ({ allowed: false, reason })

/**
 * Railway documents deploymentCancel as covering queued and building only. A deployment
 * in DEPLOYING has finished building, so cancel isn't offered there even though it's
 * still PROVISIONING. This is why eligibility needs the raw status, not just the state.
 */
const CANCELLABLE_RAW_STATUSES = new Set(['INITIALIZING', 'QUEUED', 'BUILDING'])

/**
 * NEEDS_APPROVAL and WAITING are excluded because deploying again would leave the
 * pending deployment orphaned. UNKNOWN is excluded because we don't know what we'd
 * be interrupting.
 */
const DEPLOYABLE_STATES = new Set<DeploymentState>([
  'NO_DEPLOYMENT',
  'RUNNING',
  'FAILED',
  'CRASHED',
  'STOPPED',
  'SKIPPED',
  'SLEEPING',
])

/** `observation` is null when the Sandbox exists but has never been deployed. */
export function evaluateActions(observation: DeploymentObservation | null): ActionEligibility {
  if (observation === null) {
    return {
      DEPLOY: ALLOWED,
      RESTART: deny('Nothing to restart yet. Deploy the Sandbox first.'),
      STOP: deny('Nothing is running.'),
      CANCEL: deny('Nothing is queued or building.'),
      APPROVE: deny('Nothing is waiting for approval.'),
    }
  }

  const { state, rawStatus } = observation

  return {
    DEPLOY: DEPLOYABLE_STATES.has(state) ? ALLOWED : deny(deployDenialReason(state)),

    RESTART:
      state === 'RUNNING' ? ALLOWED : deny('Restart only works while the deployment is running.'),

    STOP:
      state === 'RUNNING'
        ? ALLOWED
        : state === 'STOPPING'
          ? deny('Already stopping.')
          : deny('Stop only works while the deployment is running.'),

    CANCEL:
      state === 'PROVISIONING' && CANCELLABLE_RAW_STATUSES.has(rawStatus)
        ? ALLOWED
        : deny(cancelDenialReason(state, rawStatus)),

    APPROVE:
      state === 'NEEDS_APPROVAL' ? ALLOWED : deny('Nothing is waiting for approval.'),
  }
}

function deployDenialReason(state: DeploymentState): string {
  switch (state) {
    case 'PROVISIONING':
      return 'A deployment is already in progress. Wait for it, or cancel it first.'
    case 'STOPPING':
      return 'The last deployment is still stopping. Wait for it to stop.'
    case 'NEEDS_APPROVAL':
      return 'A deployment is waiting for approval. Approve or cancel it first.'
    case 'WAITING':
      return 'Railway is still waiting on the current deployment. Deploying now could leave it orphaned.'
    case 'UNKNOWN':
      return "Railway reported a status we don't recognise. Refresh before deploying."
    default:
      return 'Cannot deploy from the current state.'
  }
}

function cancelDenialReason(state: DeploymentState, rawStatus: string): string {
  if (state === 'PROVISIONING') {
    return 'This has finished building and can no longer be cancelled. Stop it once it is running.'
  }
  if (state === 'UNKNOWN') {
    return `Railway reported an unrecognised status (${rawStatus}). Refresh before cancelling.`
  }
  return 'Cancel only works while a deployment is queued or building.'
}

/** Returns the reason the action is blocked, or null when it is allowed. */
export function checkAction(
  action: SandboxAction,
  observation: DeploymentObservation | null,
): string | null {
  const verdict = evaluateActions(observation)[action]
  return verdict.allowed ? null : (verdict.reason ?? 'That action is not available right now.')
}

function actionPreference(state: DeploymentState): readonly SandboxAction[] {
  switch (state) {
    case 'PROVISIONING':
      return ['CANCEL']
    case 'NEEDS_APPROVAL':
      return ['APPROVE']
    case 'RUNNING':
      return ['RESTART']
    case 'STOPPING':
    case 'UNKNOWN':
      return []
    default:
      return ['DEPLOY']
  }
}

/**
 * The action the UI should show most prominently.
 *
 * Filtered through evaluateActions so the main button can never be one the server
 * would reject. An earlier version repeated the rules here and drifted: it offered
 * Deploy in WAITING, which the server refused.
 */
export function primaryAction(observation: DeploymentObservation | null): SandboxAction | null {
  if (observation === null) return 'DEPLOY'
  const eligibility = evaluateActions(observation)
  return actionPreference(observation.state).find((action) => eligibility[action].allowed) ?? null
}
