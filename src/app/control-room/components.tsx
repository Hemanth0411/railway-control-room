'use client'

import type { ReactNode } from 'react'

import type { DeploymentObservation } from '@/domain/deployment-status'
import { STATE_LABELS, STATE_TONES, TONE_DOT, TONE_TEXT, phaseLabel } from './labels'
import type { ApiError } from './api'

export function Panel({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-border bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

export function Button({
  children,
  onClick,
  disabled,
  title,
  variant = 'secondary',
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  title?: string
  variant?: 'primary' | 'secondary' | 'danger'
  type?: 'button' | 'submit'
}) {
  const base =
    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40'
  const variants = {
    primary: 'bg-accent text-[#0b0d10] hover:bg-[#8bbcff]',
    secondary: 'border border-border bg-surface-raised text-foreground hover:border-muted',
    danger: 'border border-status-bad/40 text-status-bad hover:bg-status-bad/10',
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      // Carries the reason the server would give, so a disabled button explains itself.
      title={title}
      aria-disabled={disabled}
      className={`${base} ${variants[variant]}`}
    >
      {children}
    </button>
  )
}

/** Status is always a word. The dot is a second signal, never the only one. */
export function StatusBadge({
  observation,
  size = 'normal',
}: {
  observation: DeploymentObservation | null
  size?: 'normal' | 'large'
}) {
  const state = observation?.state ?? 'NO_DEPLOYMENT'
  const tone = STATE_TONES[state]
  const label = observation === null ? STATE_LABELS.NO_DEPLOYMENT : phaseLabel(state, observation.rawStatus)

  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} aria-hidden="true" />
      <span
        className={`${TONE_TEXT[tone]} ${size === 'large' ? 'text-xl font-semibold' : 'text-sm font-medium'}`}
      >
        {label}
      </span>
    </span>
  )
}

/**
 * Errors have to answer four questions: what happened, is the state known, can it be
 * retried, and what to do next. The certainty line is the one that stops the UI implying
 * a deployment failed when really we just could not reach Railway.
 */
export function ErrorNotice({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-status-bad/40 bg-status-bad/5 px-4 py-3 text-sm"
    >
      <p className="font-medium text-status-bad">{error.message}</p>
      {error.certainty === 'unknown' && (
        <p className="mt-1 text-muted">
          The current state is uncertain. Refresh before acting on it.
        </p>
      )}
      <div className="mt-2 flex items-center gap-3">
        <span className="font-mono text-xs text-muted">{error.category}</span>
        {error.retryable && onRetry !== undefined && (
          <Button onClick={onRetry}>Retry</Button>
        )}
      </div>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>
}

export function Loading({ label }: { label: string }) {
  // Text, not just a spinner, so the state is readable by anything that can't see motion.
  return (
    <p className="py-6 text-center text-sm text-muted" role="status">
      {label}
    </p>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-xs font-medium uppercase tracking-wider text-muted">{label}</span>
      {children}
    </label>
  )
}

export function Select({
  value,
  onChange,
  disabled,
  children,
  label,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  children: ReactNode
  label: string
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-foreground disabled:opacity-40"
    >
      {children}
    </select>
  )
}
