'use client'

import type { DeploymentObservation } from '@/domain/deployment-status'

type StepStatus = 'done' | 'current' | 'pending' | 'failed'

interface Step {
  label: string
  status: StepStatus
}

/**
 * Railway tells us the current status and when it last changed. It does not give us a
 * per-phase history, so we can show which phase a deployment reached but not when each
 * one started. Rather than invent timestamps, only the one real timestamp is shown.
 */
const PHASE_ORDER = ['QUEUED', 'BUILDING', 'DEPLOYING', 'SUCCESS'] as const
const PHASE_LABELS = ['Queued', 'Building', 'Deploying', 'Running']

/** Where a still-provisioning deployment sits in the sequence, or -1 if it is not on it. */
function positionOf(rawStatus: string): number {
  switch (rawStatus) {
    case 'INITIALIZING':
    case 'QUEUED':
      return 0
    case 'BUILDING':
      return 1
    case 'DEPLOYING':
      return 2
    default:
      return -1
  }
}

function buildSteps(observation: DeploymentObservation): Step[] {
  const { state, rawStatus } = observation

  if (state === 'CRASHED') {
    // Crashed means it ran first, so the earlier phases genuinely completed.
    return [
      ...PHASE_LABELS.map((label) => ({ label, status: 'done' as StepStatus })),
      { label: 'Crashed', status: 'failed' },
    ]
  }

  if (state === 'FAILED') {
    const reached = positionOf(rawStatus)
    const upTo = reached >= 0 ? reached : 1
    return [
      ...PHASE_LABELS.slice(0, upTo).map((label) => ({ label, status: 'done' as StepStatus })),
      { label: 'Failed', status: 'failed' },
    ]
  }

  // A running deployment has finished the sequence. Marking the last step "current"
  // would pulse it as though something were still happening, contradicting the green
  // Running badge and the "this deployment has settled" line right beside it.
  if (state === 'RUNNING') {
    return PHASE_LABELS.map((label) => ({ label, status: 'done' as StepStatus }))
  }

  // Only a deployment actually moving through the sequence gets a position in it.
  // Sleeping, waiting and awaiting-approval are real states but they are not steps of
  // a build, so they fall through to the raw-status line rather than being placed on a
  // track they do not belong to.
  if (state !== 'PROVISIONING') return []

  const current = positionOf(rawStatus)
  if (current < 0) return []

  return PHASE_ORDER.map((_, index) => ({
    label: PHASE_LABELS[index],
    status: index < current ? 'done' : index === current ? 'current' : 'pending',
  }))
}

const STEP_STYLES: Record<StepStatus, { dot: string; text: string }> = {
  done: { dot: 'bg-status-good', text: 'text-foreground' },
  current: { dot: 'bg-status-active animate-pulse', text: 'text-status-active font-medium' },
  pending: { dot: 'bg-border', text: 'text-muted' },
  failed: { dot: 'bg-status-bad', text: 'text-status-bad font-medium' },
}

export function Timeline({ observation }: { observation: DeploymentObservation }) {
  const steps = buildSteps(observation)

  if (steps.length === 0) {
    return (
      <p className="text-sm text-muted">
        Railway reported{' '}
        <span className="font-mono text-foreground">{observation.rawStatus || 'no status'}</span>,
        which does not map onto the normal build sequence.
      </p>
    )
  }

  return (
    <div>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {steps.map((step, index) => (
          <li key={step.label} className="flex items-center gap-2">
            {index > 0 && <span className="h-px w-5 bg-border" aria-hidden="true" />}
            <span
              className={`h-2 w-2 rounded-full ${STEP_STYLES[step.status].dot}`}
              aria-hidden="true"
            />
            <span className={`text-sm ${STEP_STYLES[step.status].text}`}>
              {step.label}
              {step.status === 'current' && <span className="sr-only"> (current step)</span>}
            </span>
          </li>
        ))}
      </ol>
      {observation.statusUpdatedAt !== null && (
        <p className="mt-3 text-xs text-muted">
          Status last changed {new Date(observation.statusUpdatedAt).toLocaleString()}
        </p>
      )}
    </div>
  )
}
