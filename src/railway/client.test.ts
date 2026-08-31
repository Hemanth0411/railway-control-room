import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  approveDeployment,
  cancelDeployment,
  createSandbox,
  deploySandbox,
  findSandbox,
  getBuildLogs,
  getLatestDeployment,
  listDeployments,
  listEnvironments,
  listProjects,
  restartDeployment,
  sandboxServiceName,
  stopDeployment,
} from './client'

const TOKEN = 'token'

/** Stubs fetch with a fixed GraphQL payload and returns the mock for inspecting variables. */
function respondWith(data: unknown) {
  const fetchMock = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { 'x-ratelimit-remaining': '95' },
      }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function sentVariables(fetchMock: ReturnType<typeof respondWith>) {
  const [, init] = fetchMock.mock.calls[0]
  return JSON.parse(init.body as string).variables
}

function deployment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dep_1',
    status: 'BUILDING',
    createdAt: '2026-08-31T10:00:00.000Z',
    statusUpdatedAt: '2026-08-31T10:00:05.000Z',
    url: null,
    staticUrl: null,
    deploymentStopped: false,
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sandboxServiceName', () => {
  it('is stable for the same environment', () => {
    expect(sandboxServiceName('env_abcdef123456')).toBe(sandboxServiceName('env_abcdef123456'))
  })

  it('differs between environments, so one project can hold several', () => {
    expect(sandboxServiceName('env_aaaaaaaa')).not.toBe(sandboxServiceName('env_bbbbbbbb'))
  })
})

describe('listProjects', () => {
  it('flattens workspaces into a plain project list', async () => {
    respondWith({
      externalWorkspaces: [
        { id: 'ws_1', name: 'Personal', projects: [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }] },
        { id: 'ws_2', name: 'Team', projects: [{ id: 'p3', name: 'Three' }] },
      ],
    })

    const { data, rateLimit } = await listProjects(TOKEN)

    expect(data).toEqual([
      { id: 'p1', name: 'One', workspaceId: 'ws_1', workspaceName: 'Personal' },
      { id: 'p2', name: 'Two', workspaceId: 'ws_1', workspaceName: 'Personal' },
      { id: 'p3', name: 'Three', workspaceId: 'ws_2', workspaceName: 'Team' },
    ])
    expect(rateLimit.remaining).toBe(95)
  })

  it('handles a grant with no projects', async () => {
    respondWith({ externalWorkspaces: [] })
    expect((await listProjects(TOKEN)).data).toEqual([])
  })
})

describe('listEnvironments', () => {
  it('unwraps the connection and passes the project id', async () => {
    const fetchMock = respondWith({
      environments: { edges: [{ node: { id: 'e1', name: 'production' } }] },
    })

    const { data } = await listEnvironments(TOKEN, 'p1')

    expect(data).toEqual([{ id: 'e1', name: 'production' }])
    expect(sentVariables(fetchMock)).toEqual({ projectId: 'p1' })
  })
})

describe('findSandbox', () => {
  it('finds the service matching the derived name', async () => {
    const name = sandboxServiceName('env_12345678')
    respondWith({
      project: {
        services: { edges: [{ node: { id: 's_other', name: 'api' } }, { node: { id: 's1', name } }] },
      },
    })

    const { data } = await findSandbox(TOKEN, 'p1', 'env_12345678')
    expect(data).toEqual({ id: 's1', name })
  })

  it('returns null when the project has no Sandbox for this environment', async () => {
    respondWith({ project: { services: { edges: [{ node: { id: 's_other', name: 'api' } }] } } })
    expect((await findSandbox(TOKEN, 'p1', 'env_12345678')).data).toBeNull()
  })

  it('does not match a Sandbox belonging to a different environment', async () => {
    respondWith({
      project: {
        services: { edges: [{ node: { id: 's1', name: sandboxServiceName('env_aaaaaaaa') } }] },
      },
    })
    expect((await findSandbox(TOKEN, 'p1', 'env_bbbbbbbb')).data).toBeNull()
  })
})

describe('createSandbox', () => {
  it('sends the fixed image and the derived name', async () => {
    const fetchMock = respondWith({ serviceCreate: { id: 's1', name: 'control-room-sandbox-env_1234' } })

    await createSandbox(TOKEN, 'p1', 'env_12345678', 'ghcr.io/example/sandbox:1')

    expect(sentVariables(fetchMock)).toEqual({
      input: {
        projectId: 'p1',
        environmentId: 'env_12345678',
        name: sandboxServiceName('env_12345678'),
        source: { image: 'ghcr.io/example/sandbox:1' },
      },
    })
  })
})

describe('getLatestDeployment', () => {
  it('normalizes the deployment into an observation', async () => {
    respondWith({ serviceInstance: { latestDeployment: deployment({ status: 'SUCCESS' }) } })

    const { data } = await getLatestDeployment(TOKEN, 's1', 'e1')

    expect(data).toMatchObject({ deploymentId: 'dep_1', rawStatus: 'SUCCESS', state: 'RUNNING' })
    expect(data?.observedAt).toBeTruthy()
  })

  it('returns null when the service has never been deployed', async () => {
    respondWith({ serviceInstance: { latestDeployment: null } })
    expect((await getLatestDeployment(TOKEN, 's1', 'e1')).data).toBeNull()
  })

  it('keeps an unrecognised status as UNKNOWN with the raw value intact', async () => {
    respondWith({ serviceInstance: { latestDeployment: deployment({ status: 'SOME_NEW_STATUS' }) } })
    const { data } = await getLatestDeployment(TOKEN, 's1', 'e1')
    expect(data).toMatchObject({ state: 'UNKNOWN', rawStatus: 'SOME_NEW_STATUS' })
  })

  it('prefers url but falls back to staticUrl', async () => {
    respondWith({
      serviceInstance: { latestDeployment: deployment({ url: null, staticUrl: 'https://s.up.railway.app' }) },
    })
    expect((await getLatestDeployment(TOKEN, 's1', 'e1')).data?.url).toBe('https://s.up.railway.app')
  })
})

describe('listDeployments', () => {
  it('passes the list input and maps every row', async () => {
    const fetchMock = respondWith({
      deployments: { edges: [{ node: deployment() }, { node: deployment({ id: 'dep_2', status: 'FAILED' }) }] },
    })

    const { data } = await listDeployments(TOKEN, 'p1', 'e1', 's1', 5)

    expect(data.map((d) => d.state)).toEqual(['PROVISIONING', 'FAILED'])
    expect(sentVariables(fetchMock)).toEqual({
      input: { projectId: 'p1', environmentId: 'e1', serviceId: 's1' },
      first: 5,
    })
  })
})

describe('deploySandbox', () => {
  it('returns the deployment id Railway hands back', async () => {
    respondWith({ serviceInstanceDeployV2: 'dep_new' })
    expect((await deploySandbox(TOKEN, 's1', 'e1')).data).toBe('dep_new')
  })

  it('fails loudly when Railway returns no deployment id', async () => {
    // Without an id there is nothing to correlate the command with, and guessing the
    // newest deployment would be wrong as soon as anything else deploys.
    respondWith({ serviceInstanceDeployV2: '' })
    await expect(deploySandbox(TOKEN, 's1', 'e1')).rejects.toMatchObject({
      category: 'RAILWAY_GRAPHQL_ERROR',
    })
  })
})

describe('deployment commands', () => {
  const commands = [
    ['restart', restartDeployment, 'deploymentRestart'],
    ['stop', stopDeployment, 'deploymentStop'],
    ['cancel', cancelDeployment, 'deploymentCancel'],
    ['approve', approveDeployment, 'deploymentApprove'],
  ] as const

  it.each(commands)('%s succeeds when Railway returns true', async (_name, command, field) => {
    const fetchMock = respondWith({ [field]: true })
    await expect(command(TOKEN, 'dep_1')).resolves.toMatchObject({ rateLimit: { remaining: 95 } })
    expect(sentVariables(fetchMock)).toEqual({ id: 'dep_1' })
  })

  it.each(commands)('%s reports failure when Railway returns false', async (_name, command, field) => {
    // A false here is Railway declining the command. Treating it as success would leave
    // the UI claiming something happened that did not.
    respondWith({ [field]: false })
    await expect(command(TOKEN, 'dep_1')).rejects.toMatchObject({
      category: 'RAILWAY_GRAPHQL_ERROR',
    })
  })
})

describe('logs', () => {
  it('passes the deployment id and limit through', async () => {
    const fetchMock = respondWith({
      buildLogs: [{ timestamp: '2026-08-31T10:00:00Z', message: 'building', severity: 'info' }],
    })

    const { data } = await getBuildLogs(TOKEN, 'dep_1', 50)

    expect(data).toHaveLength(1)
    expect(sentVariables(fetchMock)).toEqual({ deploymentId: 'dep_1', limit: 50 })
  })

  it('handles a deployment with no logs yet', async () => {
    respondWith({ buildLogs: [] })
    expect((await getBuildLogs(TOKEN, 'dep_1')).data).toEqual([])
  })
})
