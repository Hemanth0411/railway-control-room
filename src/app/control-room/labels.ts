/**
 * How states are worded and coloured in the UI.
 *
 * This lives in the presentation layer, not the domain: the domain decides what a state
 * *is*, this decides what the user reads. Every state carries a word, so nothing is
 * signalled by colour alone.
 */

import type { DeploymentState } from '@/domain/deployment-status'
import type { PollingStopReason } from '@/domain/polling'
import type { SandboxAction } from '@/domain/actions'

type Tone = 'neutral' | 'active' | 'good' | 'bad' | 'warn'

export const STATE_LABELS: Record<DeploymentState, string> = {
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

export const STATE_TONES: Record<DeploymentState, Tone> = {
  NO_DEPLOYMENT: 'neutral',
  PROVISIONING: 'active',
  NEEDS_APPROVAL: 'warn',
  RUNNING: 'good',
  FAILED: 'bad',
  CRASHED: 'bad',
  STOPPING: 'active',
  STOPPED: 'neutral',
  SKIPPED: 'neutral',
  SLEEPING: 'warn',
  WAITING: 'warn',
  UNKNOWN: 'warn',
}

export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-status-neutral',
  active: 'text-status-active',
  good: 'text-status-good',
  bad: 'text-status-bad',
  warn: 'text-status-warn',
}

export const TONE_DOT: Record<Tone, string> = {
  neutral: 'bg-status-neutral',
  active: 'bg-status-active',
  good: 'bg-status-good',
  bad: 'bg-status-bad',
  warn: 'bg-status-warn',
}

/** Railway's own phase, shown while provisioning so "Provisioning" isn't the whole story. */
export function phaseLabel(state: DeploymentState, rawStatus: string): string {
  if (state !== 'PROVISIONING') return STATE_LABELS[state]
  switch (rawStatus) {
    case 'INITIALIZING':
      return 'Initializing'
    case 'QUEUED':
      return 'Queued'
    case 'BUILDING':
      return 'Building'
    case 'DEPLOYING':
      return 'Deploying'
    default:
      return STATE_LABELS.PROVISIONING
  }
}

export const ACTION_LABELS: Record<SandboxAction, string> = {
  DEPLOY: 'Deploy',
  RESTART: 'Restart',
  STOP: 'Stop',
  CANCEL: 'Cancel',
  APPROVE: 'Approve',
}

export const POLLING_STOP_MESSAGES: Record<PollingStopReason, string> = {
  TERMINAL: 'This deployment has settled.',
  AWAITING_EXTERNAL_ACTION: 'Railway is waiting on something outside this app.',
  TIMEOUT: 'Stopped watching after 15 minutes. It may still be running.',
  BUDGET_EXHAUSTED: 'Paused to stay inside the Railway rate limit for this hour.',
}

/** Stop is the only action with a consequence worth a confirm step. */
export const CONFIRM_PROMPTS: Partial<Record<SandboxAction, string>> = {
  STOP: 'Stop the running deployment?',
}
