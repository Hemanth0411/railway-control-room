'use client'

import { useEffect, useRef, useState } from 'react'

import type { RailwayLogLine } from '@/railway/client'
import { RequestFailed, api } from './api'
import type { ApiError } from './api'
import { Button, Empty, ErrorNotice, Loading } from './components'

type LogKind = 'build' | 'runtime'

/** Tagged with what it was fetched for, so switching tab or deployment shows loading
 *  again without an effect having to clear anything. */
interface LogResult {
  key: string
  lines: RailwayLogLine[] | null
  error: ApiError | null
}

const SEVERITY_COLOURS: Record<string, string> = {
  error: 'text-status-bad',
  warn: 'text-status-warn',
  info: 'text-muted',
}

function severityClass(severity: string | null): string {
  if (severity === null) return 'text-muted'
  return SEVERITY_COLOURS[severity.toLowerCase()] ?? 'text-muted'
}

export function Logs({ deploymentId }: { deploymentId: string | null }) {
  const [kind, setKind] = useState<LogKind>('build')
  const [result, setResult] = useState<LogResult | null>(null)
  const [reloads, setReloads] = useState(0)

  const scroller = useRef<HTMLDivElement | null>(null)
  // Follow new output only while the reader is already at the bottom, so scrolling back
  // to read something is not yanked away by the next fetch.
  const stickToBottom = useRef(true)

  const key = `${deploymentId ?? 'none'}:${kind}`

  useEffect(() => {
    if (deploymentId === null) return
    let cancelled = false

    api
      .logs(deploymentId, kind)
      .then((response) => {
        if (!cancelled) setResult({ key, lines: response.logs, error: null })
      })
      .catch((cause: unknown) => {
        // Shown separately from deployment state: failing to read logs does not mean
        // the deployment itself is in trouble.
        if (cancelled) return
        setResult({
          key,
          lines: null,
          error:
            cause instanceof RequestFailed
              ? cause.detail
              : {
                  category: 'INTERNAL_ERROR',
                  message: 'Could not load logs.',
                  retryable: true,
                  certainty: 'known',
                },
        })
      })

    // Stops a slow response for the previous tab or deployment landing over a newer one.
    return () => {
      cancelled = true
    }
  }, [deploymentId, kind, key, reloads])

  const current = result?.key === key ? result : null

  useEffect(() => {
    if (stickToBottom.current && scroller.current !== null) {
      scroller.current.scrollTop = scroller.current.scrollHeight
    }
  }, [current])

  function onScroll() {
    const element = scroller.current
    if (element === null) return
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight
    stickToBottom.current = distanceFromBottom < 40
  }

  const loading = deploymentId !== null && current === null
  const tabs: LogKind[] = ['build', 'runtime']

  return (
    <section className="rounded-lg border border-border bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex gap-1" role="tablist" aria-label="Log type">
          {tabs.map((tab) => (
            <button
              key={tab}
              role="tab"
              type="button"
              aria-selected={kind === tab}
              onClick={() => setKind(tab)}
              className={`rounded px-2.5 py-1 text-xs font-medium capitalize ${
                kind === tab
                  ? 'bg-surface-raised text-foreground'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <Button
          onClick={() => setReloads((n) => n + 1)}
          disabled={loading || deploymentId === null}
        >
          {loading ? 'Loading' : 'Refresh'}
        </Button>
      </header>

      <div className="p-4">
        {deploymentId === null ? (
          <Empty>Deploy the Sandbox to see logs.</Empty>
        ) : current === null ? (
          <Loading label="Loading logs…" />
        ) : current.error !== null ? (
          <ErrorNotice error={current.error} onRetry={() => setReloads((n) => n + 1)} />
        ) : current.lines === null || current.lines.length === 0 ? (
          <Empty>No {kind} logs yet. They appear once Railway produces output.</Empty>
        ) : (
          <>
            {current.lines.some((line) => line.severity?.toLowerCase() === 'error') && (
              // Railway documents that anything a container writes to stderr becomes
              // level.error. Plenty of programs, nginx included, write ordinary startup
              // notices there, so a healthy service can look alarming. We show Railway's
              // classification unchanged and explain it rather than second-guessing it.
              <p className="mb-2 text-xs text-muted">
                Railway marks anything written to stderr as an error. Programs such as nginx
                write ordinary startup notices there, so red does not always mean a problem.
              </p>
            )}
            <div
              ref={scroller}
              onScroll={onScroll}
              className="max-h-80 overflow-auto rounded-md bg-background p-3 font-mono text-xs leading-relaxed"
            >
              {current.lines.map((line, index) => (
                <div key={`${line.timestamp}-${index}`} className="flex gap-3">
                  <span className="shrink-0 text-muted/70">
                    {new Date(line.timestamp).toLocaleTimeString()}
                  </span>
                  <span className={`shrink-0 uppercase ${severityClass(line.severity)}`}>
                    {line.severity ?? 'log'}
                  </span>
                  <span className="whitespace-pre-wrap break-all">{line.message}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
