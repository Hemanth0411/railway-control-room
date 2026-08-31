/**
 * Turns Railway's deployment status into the smaller set of states this app shows.
 */

/**
 * The full DeploymentStatus enum, read from Railway's live schema on 2026-08-30.
 * See docs/railway-schema-verification.md.
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

export type DeploymentState =
  | 'NO_DEPLOYMENT'
  | 'PROVISIONING'
  | 'NEEDS_APPROVAL'
  | 'RUNNING'
  | 'FAILED'
  | 'CRASHED'
  | 'STOPPING'
  | 'STOPPED'
  | 'SKIPPED'
  | 'SLEEPING'
  | 'WAITING'
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
 * Railway can add statuses at any time. Mapping an unknown one onto an existing
 * state would make the UI claim something about the deployment that we don't know,
 * so anything unrecognised becomes UNKNOWN and the raw string is shown as-is.
 */
export function normalizeDeploymentStatus(raw: string | null | undefined): DeploymentState {
  if (typeof raw !== 'string' || raw.length === 0) return 'UNKNOWN'
  return isKnownRailwayStatus(raw) ? STATUS_TO_STATE[raw] : 'UNKNOWN'
}

const TERMINAL_STATES = new Set<DeploymentState>([
  'RUNNING',
  'FAILED',
  'CRASHED',
  'STOPPED',
  'SKIPPED',
])

/**
 * Settled, but not finished: Railway is waiting on a person or another system.
 * Kept separate from terminal because the deployment isn't done, and separate
 * from active because polling it just spends API requests on a state that
 * can't change on its own.
 */
const AWAITING_EXTERNAL_ACTION_STATES = new Set<DeploymentState>([
  'NEEDS_APPROVAL',
  'WAITING',
  'SLEEPING',
])

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

export interface DeploymentObservation {
  deploymentId: string
  /** Kept verbatim so the UI can show what Railway actually said. */
  rawStatus: string
  state: DeploymentState
  createdAt: string
  statusUpdatedAt: string | null
  url: string | null
  stopped: boolean
  /** When our server read this, so the UI can show how stale it is. */
  observedAt: string
}
