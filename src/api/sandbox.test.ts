import { afterEach, describe, expect, it, vi } from 'vitest'

import { ensureSandbox, getSandboxStatus, runSandboxAction } from './sandbox'
import { sandboxServiceName } from '@/railway/client'

const TOKEN = 'token'
const PROJECT = 'p1'
const ENV = 'env_12345678'
const SANDBOX = { id: 's1', name: sandboxServiceName(ENV) }

/**
 * Queues one GraphQL payload per expected Railway call, in order, and records the
 * documents actually sent so a test can assert a mutation was never issued.
 */
function queue(...payloads: unknown[]) {
  const sent: string[] = []
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(init.body as string).query)
    const next = payloads.shift()
    if (next === undefined) throw new Error('unexpected extra Railway call')
    return new Response(JSON.stringify({ data: next }), {
      status: 200,
      headers: { 'x-ratelimit-remaining': '80' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { sent, fetchMock }
}

/** Only the mutation documents. Query selections mention field names like
 *  `deploymentStopped`, which would otherwise match a naive substring check. */
const mutations = (sent: string[]) => sent.filter((doc) => doc.includes('mutation '))

const servicesPayload = (services: Array<{ id: string; name: string }>) => ({
  project: { services: { edges: services.map((node) => ({ node })) } },
})

const latestPayload = (status: string | null, id = 'dep_1') => ({
  serviceInstance: {
    latestDeployment:
      status === null
        ? null
        : {
            id,
            status,
            createdAt: '2026-09-01T10:00:00.000Z',
            statusUpdatedAt: '2026-09-01T10:00:05.000Z',
            url: null,
            staticUrl: null,
            deploymentStopped: false,
          },
  },
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getSandboxStatus', () => {
  it('reports no Sandbox and offers Deploy nothing else', async () => {
    queue(servicesPayload([{ id: 'other', name: 'api' }]))

    const status = await getSandboxStatus(TOKEN, PROJECT, ENV)

    expect(status.service).toBeNull()
    expect(status.deployment).toBeNull()
    expect(status.actions.DEPLOY.allowed).toBe(true)
    expect(status.actions.STOP.allowed).toBe(false)
  })

  it('does not look for a deployment when there is no service', async () => {
    // Saves a Railway request on a page that has nothing to show yet.
    const { sent } = queue(servicesPayload([]))
    await getSandboxStatus(TOKEN, PROJECT, ENV)
    expect(sent).toHaveLength(1)
  })

  it('returns the current deployment with the actions it permits', async () => {
    queue(servicesPayload([SANDBOX]), latestPayload('SUCCESS'))

    const status = await getSandboxStatus(TOKEN, PROJECT, ENV)

    expect(status.service).toEqual(SANDBOX)
    expect(status.deployment).toMatchObject({ state: 'RUNNING', rawStatus: 'SUCCESS' })
    expect(status.actions.RESTART.allowed).toBe(true)
    expect(status.actions.STOP.allowed).toBe(true)
    expect(status.actions.CANCEL.allowed).toBe(false)
    expect(status.primaryAction).toBe('RESTART')
  })

  it('handles a Sandbox that exists but has never been deployed', async () => {
    queue(servicesPayload([SANDBOX]), latestPayload(null))

    const status = await getSandboxStatus(TOKEN, PROJECT, ENV)

    expect(status.service).toEqual(SANDBOX)
    expect(status.deployment).toBeNull()
    expect(status.primaryAction).toBe('DEPLOY')
  })
})

describe('ensureSandbox', () => {
  it('reuses an existing Sandbox instead of creating a second', async () => {
    // The whole point: no database records what we created, so we look first.
    const { sent } = queue(servicesPayload([SANDBOX]))

    const result = await ensureSandbox(TOKEN, PROJECT, ENV, 'img:1')

    expect(result).toMatchObject({ service: SANDBOX, created: false })
    expect(sent).toHaveLength(1)
    expect(mutations(sent)).toHaveLength(0)
  })

  it('creates one when the environment has none', async () => {
    const { sent } = queue(servicesPayload([]), { serviceCreate: SANDBOX })

    const result = await ensureSandbox(TOKEN, PROJECT, ENV, 'img:1')

    expect(result).toMatchObject({ service: SANDBOX, created: true })
    expect(mutations(sent)).toEqual([expect.stringContaining('serviceCreate(')])
  })
})

describe('runSandboxAction — deploy', () => {
  it('deploys when nothing is running and returns the new deployment id', async () => {
    queue(
      servicesPayload([SANDBOX]),
      latestPayload(null),
      { serviceInstanceDeployV2: 'dep_new' },
    )

    const result = await runSandboxAction(TOKEN, PROJECT, ENV, 'DEPLOY')

    expect(result).toMatchObject({ action: 'DEPLOY', deploymentId: 'dep_new' })
  })

  it('refuses a second deploy while one is building, and sends no mutation', async () => {
    // The double-click case. The rejection has to happen before Railway is called,
    // or the user ends up with two deployments.
    const { sent } = queue(servicesPayload([SANDBOX]), latestPayload('BUILDING'))

    await expect(runSandboxAction(TOKEN, PROJECT, ENV, 'DEPLOY')).rejects.toMatchObject({
      category: 'CONFLICT',
    })

    expect(sent).toHaveLength(2)
    expect(mutations(sent)).toHaveLength(0)
  })

  it('allows a redeploy once the previous one failed', async () => {
    queue(servicesPayload([SANDBOX]), latestPayload('FAILED'), { serviceInstanceDeployV2: 'dep_2' })

    const result = await runSandboxAction(TOKEN, PROJECT, ENV, 'DEPLOY')
    expect(result.deploymentId).toBe('dep_2')
  })
})

describe('runSandboxAction — stop, restart, cancel', () => {
  it('stops the deployment it actually observed', async () => {
    const { sent } = queue(
      servicesPayload([SANDBOX]),
      latestPayload('SUCCESS', 'dep_running'),
      { deploymentStop: true },
    )

    const result = await runSandboxAction(TOKEN, PROJECT, ENV, 'STOP')

    expect(result).toMatchObject({ action: 'STOP', deploymentId: 'dep_running' })
    expect(mutations(sent)).toEqual([expect.stringContaining('deploymentStop(')])
  })

  it('refuses to stop when nothing is running', async () => {
    const { sent } = queue(servicesPayload([SANDBOX]), latestPayload('BUILDING'))

    await expect(runSandboxAction(TOKEN, PROJECT, ENV, 'STOP')).rejects.toMatchObject({
      category: 'CONFLICT',
    })
    expect(mutations(sent)).toHaveLength(0)
  })

  it('cancels a build that is still queued', async () => {
    queue(servicesPayload([SANDBOX]), latestPayload('QUEUED', 'dep_q'), { deploymentCancel: true })

    const result = await runSandboxAction(TOKEN, PROJECT, ENV, 'CANCEL')
    expect(result.deploymentId).toBe('dep_q')
  })

  it('refuses to cancel once the build is done and the release has started', async () => {
    // Railway's deploymentCancel covers queued/building only.
    const { sent } = queue(servicesPayload([SANDBOX]), latestPayload('DEPLOYING'))

    await expect(runSandboxAction(TOKEN, PROJECT, ENV, 'CANCEL')).rejects.toMatchObject({
      category: 'CONFLICT',
    })
    expect(mutations(sent)).toHaveLength(0)
  })

  it('restarts only while running', async () => {
    queue(servicesPayload([SANDBOX]), latestPayload('SUCCESS', 'dep_r'), { deploymentRestart: true })
    await expect(runSandboxAction(TOKEN, PROJECT, ENV, 'RESTART')).resolves.toMatchObject({
      deploymentId: 'dep_r',
    })
  })
})

describe('runSandboxAction — stale pages', () => {
  it('rejects a command aimed at a deployment that is no longer current', async () => {
    // A tab left open on an older deployment would otherwise stop the wrong thing.
    const { sent } = queue(servicesPayload([SANDBOX]), latestPayload('SUCCESS', 'dep_current'))

    await expect(
      runSandboxAction(TOKEN, PROJECT, ENV, 'STOP', 'dep_old'),
    ).rejects.toMatchObject({ category: 'CONFLICT' })

    expect(mutations(sent)).toHaveLength(0)
  })

  it('proceeds when the caller is looking at the current deployment', async () => {
    queue(servicesPayload([SANDBOX]), latestPayload('SUCCESS', 'dep_current'), { deploymentStop: true })

    await expect(
      runSandboxAction(TOKEN, PROJECT, ENV, 'STOP', 'dep_current'),
    ).resolves.toMatchObject({ deploymentId: 'dep_current' })
  })
})

describe('runSandboxAction — missing Sandbox', () => {
  it('reports that there is nothing to act on', async () => {
    queue(servicesPayload([]))

    await expect(runSandboxAction(TOKEN, PROJECT, ENV, 'DEPLOY')).rejects.toMatchObject({
      category: 'RESOURCE_NOT_FOUND',
    })
  })
})
