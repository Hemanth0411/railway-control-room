/**
 * The Sandbox service the Control Room deploys.
 *
 * It exists to be watched, not to be useful. It has to be small enough to start almost
 * instantly, and it has to be able to fail on request - otherwise the CRASHED path in the
 * Control Room can only ever be tested against mocks.
 *
 * No dependencies, so there is nothing to install and nothing to keep patched.
 */

import http from 'node:http'

const PORT = Number(process.env.PORT ?? 3000)
const CRASH_AFTER_MS = Number(process.env.CRASH_AFTER_MS)
const startedAt = new Date().toISOString()

/*
 * Railway classifies logs by stream, not by content: stdout becomes info, stderr becomes
 * error. So ordinary progress goes to stdout and only real failures go to stderr, which
 * keeps the Control Room's log panel honest.
 */
const info = (message) => console.log(`[sandbox] ${message}`)
const failure = (message) => console.error(`[sandbox] ${message}`)

const server = http.createServer((request, response) => {
  const path = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`).pathname

  if (path === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ status: 'ok', startedAt, uptimeSeconds: process.uptime() }))
    return
  }

  if (path === '/crash') {
    // Answer before dying, so the browser shows something rather than a connection reset.
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('Crashing on purpose. Railway should report CRASHED shortly.\n')
    failure('/crash requested, exiting with code 1')
    // Give the response a moment to flush before the process goes away.
    setTimeout(() => process.exit(1), 50)
    return
  }

  response.writeHead(200, { 'content-type': 'text/plain' })
  response.end(
    [
      'Railway Control Room sandbox',
      '',
      `started:  ${startedAt}`,
      `uptime:   ${Math.round(process.uptime())}s`,
      '',
      'GET /health  liveness',
      'GET /crash   exit(1) on purpose, to test the CRASHED state',
      '',
    ].join('\n'),
  )
})

server.listen(PORT, () => info(`listening on ${PORT}, started ${startedAt}`))

// Railway sends SIGTERM when a deployment is stopped. Closing cleanly means Stop shows a
// tidy shutdown in the logs instead of a killed process.
process.on('SIGTERM', () => {
  info('SIGTERM received, shutting down')
  server.close(() => process.exit(0))
})

if (Number.isFinite(CRASH_AFTER_MS) && CRASH_AFTER_MS > 0) {
  info(`CRASH_AFTER_MS is set, will exit(1) in ${CRASH_AFTER_MS}ms`)
  setTimeout(() => {
    failure(`CRASH_AFTER_MS (${CRASH_AFTER_MS}ms) elapsed, exiting with code 1`)
    process.exit(1)
  }, CRASH_AFTER_MS)
}
