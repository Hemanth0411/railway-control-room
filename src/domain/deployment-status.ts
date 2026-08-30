/**
 * Deployment status normalization.
 *
 * Railway owns the raw deployment status. This module translates that raw status
 * into the small product-level state model described in `docs/build-spec/04-state-and-async.md`.
 *
 * Two rules govern everything here:
 *
 *  1. A raw status we do not recognise becomes `UNKNOWN`. It is never guessed at.
 *     Railway can add enum values at any time and mapping a new value onto an
 *     existing state would make the UI lie about infrastructure.
 *  2. The raw status is always carried alongside the normalized state so the UI
 *     can show it in a detail position, per spec 05.
 */

/**
 * The complete `DeploymentStatus` enum as verified against Railway's live schema
 * on 2026-08-30. See `docs/railway-schema-verification.md`.
 *
 * Note `NEEDS_APPROVAL`, which is present in the live schema but absent from the
 * status list in spec 04.
 */
export const RAILWAY_DEPLOYMENT_STATUSES = [
  'BUILDING',
  'CRASHED',
  'DEPLOYING',
  'FAILED',
  'INITIALIZING',
  'NEEDS_APPROVAL',
  'QUEUED',
  'REMOVED',
  'REMOVING',
  'SKIPPED',
  'SLEEPING',
  'SUCCESS',
  'WAITING',
] as const

export type RailwayDeploymentStatus = (typeof RAILWAY_DEPLOYMENT_STATUSES)[number]

/**
 * Product-level deployment state.
 *
 * Deliberately smaller than the Railway enum: the user does not need to
 * distinguish INITIALIZING from QUEUED to decide what to do next. It is not
 * *so* small that distinct situations get conflated — `SKIPPED` ("this
 * deployment never ran") is not the same event as `STOPPED` ("this deployment
 * ran and no longer does"), so they stay separate.
 */
export type DeploymentState =
  /** No deployment exists for this Sandbox yet. */
  | 'NO_DEPLOYMENT'
  /** Moving toward running: INITIALIZING, QUEUED, BUILDING, DEPLOYING. */
  | 'PROVISIONING'
  /** Railway is holding the deployment until a human approves it. */
  | 'NEEDS_APPROVAL'
  /** Railway reports SUCCESS. */
  | 'RUNNING'
  /** The build or deploy failed. */
  | 'FAILED'
  /** The deployment ran and then crashed. */
  | 'CRASHED'
  /** Leaving the running state (REMOVING, or a stop we have accepted). */
  | 'STOPPING'
  /** No longer running (REMOVED). */
  | 'STOPPED'
  /** Superseded or otherwise never executed. */
  | 'SKIPPED'
  /** Railway put the deployment to sleep. Not the same as stopped. */
  | 'SLEEPING'
  /** Railway is waiting on something external. */
  | 'WAITING'
  /** A raw status this build does not recognise. */
  | 'UNKNOWN'

const STATUS_TO_STATE: Record<RailwayDeploymentStatus, DeploymentState> = {
  INITIALIZING: 'PROVISIONING',
  QUEUED: 'PROVISIONING',
  BUILDING: 'PROVISIONING',
  DEPLOYING: 'PROVISIONING',
  NEEDS_APPROVAL: 'NEEDS_APPROVAL',
  SUCCESS: 'RUNNING',
  FAILED: 'FAILED',
  CRASHED: 'CRASHED',
  REMOVING: 'STOPPING',
  REMOVED: 'STOPPED',
  SKIPPED: 'SKIPPED',
  SLEEPING: 'SLEEPING',
  WAITING: 'WAITING',
}

export function isKnownRailwayStatus(raw: string): raw is RailwayDeploymentStatus {
  return (RAILWAY_DEPLOYMENT_STATUSES as readonly string[]).includes(raw)
}

/**
 * Map a raw Railway status to a product state.
 *
 * Anything unrecognised — including `null`, `undefined` and empty strings —
 * becomes `UNKNOWN` rather than being coerced into a plausible-looking state.
 */
export function normalizeDeploymentStatus(raw: string | null | undefined): DeploymentState {
  if (typeof raw !== 'string' || raw.length === 0) return 'UNKNOWN'
  return isKnownRailwayStatus(raw) ? STATUS_TO_STATE[raw] : 'UNKNOWN'
}

/**
 * States that will not change again without a new user command.
 * Polling stops here. Spec 04: SUCCESS, FAILED, CRASHED, REMOVED, SKIPPED.
 */
const TERMINAL_STATES = new Set<DeploymentState>([
  'RUNNING',
  'FAILED',
  'CRASHED',
  'STOPPED',
  'SKIPPED',
])

/**
 * States that are settled but not finished: the deployment will not progress
 * until something outside this application acts.
 *
 * Spec 04 leaves the policy here open ("verify the desired behavior"). We stop
 * polling, because continuing to poll spends the account's hourly Railway
 * request budget observing a state that cannot change on its own. The UI keeps
 * a manual refresh available.
 */
const AWAITING_EXTERNAL_ACTION_STATES = new Set<DeploymentState>([
  'NEEDS_APPROVAL',
  'WAITING',
  'SLEEPING',
])

/** States where Railway is actively working and the state should change soon. */
const ACTIVE_STATES = new Set<DeploymentState>(['PROVISIONING', 'STOPPING'])

export function isTerminalState(state: DeploymentState): boolean {
  return TERMINAL_STATES.has(state)
}

export function isAwaitingExternalAction(state: DeploymentState): boolean {
  return AWAITING_EXTERNAL_ACTION_STATES.has(state)
}

export function isActiveState(state: DeploymentState): boolean {
  return ACTIVE_STATES.has(state)
}

/**
 * A single observation of a deployment, as our application sees it.
 *
 * This is what the server returns to the browser. It carries both the
 * normalized state and the raw Railway status, because spec 01 requires the
 * distinction between "Railway status" and "application status" to stay visible.
 */
export interface DeploymentObservation {
  deploymentId: string
  /** Raw Railway status string, passed through verbatim even when unrecognised. */
  rawStatus: string
  state: DeploymentState
  createdAt: string
  /** When Railway last changed the status, if it reported it. */
  statusUpdatedAt: string | null
  /** Public URL of the deployment, when Railway has assigned one. */
  url: string | null
  /** True once Railway reports the deployment as explicitly stopped. */
  stopped: boolean
  /** The moment our server read this state, so the UI can show staleness. */
  observedAt: string
}

/** Short, stable, human-readable label for a state. Never color-only, per spec 05. */
export const DEPLOYMENT_STATE_LABELS: Record<DeploymentState, string> = {
  NO_DEPLOYMENT: 'No deployment',
  PROVISIONING: 'Provisioning',
  NEEDS_APPROVAL: 'Needs approval',
  RUNNING: 'Running',
  FAILED: 'Failed',
  CRASHED: 'Crashed',
  STOPPING: 'Stopping',
  STOPPED: 'Stopped',
  SKIPPED: 'Skipped',
  SLEEPING: 'Sleeping',
  WAITING: 'Waiting',
  UNKNOWN: 'Unknown Railway state',
}

/**
 * Finer-grained label for the provisioning phase, so "Provisioning" can be
 * shown as "Building" or "Deploying" where Railway has told us which.
 * Falls back to the state label when the raw status is not recognised.
 */
export function describeObservation(observation: {
  state: DeploymentState
  rawStatus: string
}): string {
  if (observation.state !== 'PROVISIONING') return DEPLOYMENT_STATE_LABELS[observation.state]
  switch (observation.rawStatus) {
    case 'INITIALIZING':
      return 'Initializing'
    case 'QUEUED':
      return 'Queued'
    case 'BUILDING':
      return 'Building'
    case 'DEPLOYING':
      return 'Deploying'
    default:
      return DEPLOYMENT_STATE_LABELS.PROVISIONING
  }
}
