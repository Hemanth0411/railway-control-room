/**
 * Action eligibility.
 *
 * This is the application's conflict-prevention mechanism, and it is the single
 * most important piece of domain logic in the project.
 *
 * What it guarantees: the server decides whether a command is valid by reading
 * the *current* Railway state immediately before acting, so a double click, a
 * browser retry, or a stale tab cannot turn one user intent into two
 * deployments.
 *
 * What it does NOT guarantee, and what we must not claim: exactly-once
 * execution. Two requests can still read the same state concurrently and both
 * conclude the action is allowed. Railway exposes no idempotency key for these
 * mutations, so there is no way to close that window from here. This is
 * state-aware command handling, not a distributed transaction.
 *
 * See `docs/build-spec/02-architecture.md` ("Idempotency without a database")
 * and `docs/build-spec/04-state-and-async.md` ("Double-click/concurrent actions").
 */

import type { DeploymentObservation, DeploymentState } from './deployment-status'

export const SANDBOX_ACTIONS = ['DEPLOY', 'RESTART', 'STOP', 'CANCEL', 'APPROVE'] as const
export type SandboxAction = (typeof SANDBOX_ACTIONS)[number]

export interface ActionVerdict {
  allowed: boolean
  /**
   * Why the action is unavailable, phrased for the user. Doubles as the tooltip
   * on a disabled button and as the message on an HTTP 409, so there is exactly
   * one explanation of each rule.
   */
  reason?: string
}

export type ActionEligibility = Record<SandboxAction, ActionVerdict>

const ALLOWED: ActionVerdict = { allowed: true }
const deny = (reason: string): ActionVerdict => ({ allowed: false, reason })

/**
 * Raw statuses Railway will accept a cancel for.
 *
 * Railway documents `deploymentCancel` as aborting a deployment that is
 * "building or queued". A deployment already in DEPLOYING has finished building
 * and is being released, so cancel is not offered there — spec 04 is explicit
 * that we must not call an operation whose semantics do not cover the state.
 * This is why eligibility needs the raw status and not only the domain state.
 */
const CANCELLABLE_RAW_STATUSES = new Set(['INITIALIZING', 'QUEUED', 'BUILDING'])

/**
 * Domain states from which starting a fresh deployment is safe.
 *
 * Excluded: PROVISIONING and STOPPING (an operation is already in flight),
 * NEEDS_APPROVAL and WAITING (a deployment is pending a decision — deploying
 * again would leave an orphaned one behind), and UNKNOWN (we do not know what
 * we would be doing).
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

/**
 * Decide which actions are currently valid.
 *
 * `observation` is `null` when the Sandbox service exists but has never been
 * deployed, which is the NO_DEPLOYMENT case.
 */
export function evaluateActions(observation: DeploymentObservation | null): ActionEligibility {
  if (observation === null) {
    return {
      DEPLOY: ALLOWED,
      RESTART: deny('There is no deployment to restart. Deploy the Sandbox first.'),
      STOP: deny('There is no running deployment to stop.'),
      CANCEL: deny('There is no queued or building deployment to cancel.'),
      APPROVE: deny('There is no deployment awaiting approval.'),
    }
  }

  const { state, rawStatus } = observation

  return {
    DEPLOY: DEPLOYABLE_STATES.has(state)
      ? ALLOWED
      : deny(deployDenialReason(state)),

    // Restart reuses the running container and does not rebuild. It is only
    // meaningful against a deployment Railway currently reports as SUCCESS.
    RESTART:
      state === 'RUNNING'
        ? ALLOWED
        : deny('Restart is only available while the deployment is running.'),

    STOP:
      state === 'RUNNING'
        ? ALLOWED
        : state === 'STOPPING'
          ? deny('This deployment is already stopping.')
          : deny('Stop is only available while the deployment is running.'),

    CANCEL:
      state === 'PROVISIONING' && CANCELLABLE_RAW_STATUSES.has(rawStatus)
        ? ALLOWED
        : deny(cancelDenialReason(state, rawStatus)),

    APPROVE:
      state === 'NEEDS_APPROVAL'
        ? ALLOWED
        : deny('There is no deployment awaiting approval.'),
  }
}

function deployDenialReason(state: DeploymentState): string {
  switch (state) {
    case 'PROVISIONING':
      return 'A deployment is already in progress. Wait for it to finish, or cancel it first.'
    case 'STOPPING':
      return 'The current deployment is still stopping. Wait for it to stop before deploying again.'
    case 'NEEDS_APPROVAL':
      return 'A deployment is waiting for approval. Approve or cancel it before deploying again.'
    case 'WAITING':
      return 'Railway is still waiting on the current deployment. Deploying now could leave it orphaned.'
    case 'UNKNOWN':
      return 'The current Railway state is not recognised, so it is not safe to deploy. Refresh the state first.'
    default:
      return 'Deploy is not available in the current state.'
  }
}

function cancelDenialReason(state: DeploymentState, rawStatus: string): string {
  if (state === 'PROVISIONING') {
    // Provisioning, but past the point Railway will cancel — i.e. DEPLOYING.
    return 'This deployment has finished building and can no longer be cancelled. Stop it once it is running.'
  }
  if (state === 'UNKNOWN') {
    return `Railway reported an unrecognised status (${rawStatus}), so cancel is not offered. Refresh the state first.`
  }
  return 'Cancel is only available while a deployment is queued or building.'
}

/**
 * Assert that an action may run, for use on the server immediately before
 * calling Railway. Returns the reason string when the action is not allowed,
 * and `null` when it is.
 */
export function checkAction(
  action: SandboxAction,
  observation: DeploymentObservation | null,
): string | null {
  const verdict = evaluateActions(observation)[action]
  return verdict.allowed ? null : (verdict.reason ?? 'That action is not available right now.')
}

/**
 * Which action the UI would most like to offer in a given state, in order of
 * preference. This expresses intent only — whether the action is actually
 * permitted is still decided by `evaluateActions`.
 */
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
 * The single action the UI should present most prominently, per spec 05
 * ("Primary actions"). Secondary actions come from `evaluateActions`.
 *
 * The result is always filtered through `evaluateActions`, so the prominent
 * button can never be one the server would reject. Duplicating the eligibility
 * rules here instead would let the two drift apart — which is exactly what
 * happened before this was filtered: WAITING offered a Deploy button that the
 * server refused.
 */
export function primaryAction(observation: DeploymentObservation | null): SandboxAction | null {
  if (observation === null) return 'DEPLOY'
  const eligibility = evaluateActions(observation)
  return actionPreference(observation.state).find((action) => eligibility[action].allowed) ?? null
}
