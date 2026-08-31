# Railway API — live schema verification

Verified **2026-08-30** against the live endpoint, not against documentation snippets.

Introspection is available **unauthenticated** at `https://backboard.railway.com/graphql/v2`,
so every signature below was read from the live schema. To re-verify a single type:

    curl -s -X POST https://backboard.railway.com/graphql/v2 \
      -H 'Content-Type: application/json' \
      -d '{"query":"{ __type(name:\"ServiceCreateInput\"){ inputFields { name } } }"}'

This is here so the Railway integration is written against what the API actually is, not
against snippets. Where the live schema disagreed with my assumptions, the live schema won;
those three cases are at the bottom.

## Operations this application depends on

### Resource discovery

| Operation | Live signature |
|---|---|
| Projects granted via OAuth | `externalWorkspaces(projectId: String): [ExternalWorkspace!]!` → `.projects: [Project!]!` |
| Environments | `environments(projectId: String!, first: Int, after: String, ...): QueryEnvironmentsConnection!` |
| Service instance | `serviceInstance(environmentId: String!, serviceId: String!): ServiceInstance!` |
| Identity | `me: User!` (`id`, `email`, `name`, `avatar`) |

`ExternalWorkspace` exposes `id`, `name`, `projects`. `Project` exposes `id`, `name`,
`environments`, `services`. `ServiceInstance` exposes `latestDeployment` and
`activeDeployments`, which is what Sandbox discovery needs.

### Sandbox service

| Operation | Live signature |
|---|---|
| Create | `serviceCreate(input: ServiceCreateInput!): Service!` |
| Configure | `serviceInstanceUpdate(serviceId: String!, environmentId: String, input: ServiceInstanceUpdateInput!): Boolean!` |

`ServiceCreateInput`: `projectId: String!` (the only required field), `environmentId`, `name`,
`icon`, `branch`, `source: ServiceSourceInput`, `templateId`, `templateServiceId`,
`registryCredentials`, `variables`.

`ServiceSourceInput`: `image: String`, `repo: String`. The Sandbox uses `image`.

`ServiceInstanceUpdateInput` fields we may use: `startCommand`, `healthcheckPath`,
`healthcheckTimeout`, `restartPolicyType` (`ALWAYS` | `NEVER` | `ON_FAILURE`),
`restartPolicyMaxRetries`, `numReplicas`, `region`, `sleepApplication`, `source`.

### Deployment commands

| Operation | Live signature | Notes |
|---|---|---|
| Deploy | `serviceInstanceDeployV2(serviceId: String!, environmentId: String!, commitSha: String): String!` | Returns the **deployment ID** as a scalar. No selection set. |
| Restart | `deploymentRestart(id: String!): Boolean!` | Restarts without rebuilding. |
| Stop | `deploymentStop(id: String!): Boolean!` | |
| Cancel | `deploymentCancel(id: String!): Boolean!` | For queued/building. |
| Approve | `deploymentApprove(id: String!): Boolean!` | Pairs with `NEEDS_APPROVAL`. |

**Not used, and why.** `serviceInstanceDeploy` (v1) and `serviceInstanceRedeploy` both return
`Boolean!`, so there is no deployment ID to correlate with — you would have to guess which
deployment was yours. `deploymentRedeploy` returns a full object but redeploys an *existing*
deployment rather than deploying the service from its source. `serviceDelete` and
`deploymentRemove` are destructive and out of scope.

### Deployment observation

| Operation | Live signature |
|---|---|
| One deployment | `deployment(id: String!): Deployment!` |
| List | `deployments(input: DeploymentListInput!, first: Int, after: String, ...): QueryDeploymentsConnection!` |
| Build logs | `buildLogs(deploymentId: String!, limit: Int, filter: String, startDate: DateTime, endDate: DateTime): [Log!]!` |
| Runtime logs | `deploymentLogs(deploymentId: String!, limit: Int, filter: String, startDate: DateTime, endDate: DateTime): [Log!]!` |

`DeploymentListInput`: `projectId`, `environmentId`, `serviceId`, `includeDeleted`,
`status: DeploymentStatusInput { in: [DeploymentStatus!], notIn: [DeploymentStatus!] }`.

`Deployment` fields used: `id`, `status`, `createdAt`, `updatedAt`, `statusUpdatedAt`,
`staticUrl`, `url`, `canRedeploy`, `canRollback`, `deploymentStopped`, `serviceId`,
`environmentId`, `projectId`, `meta`.

`Log`: `timestamp: String!`, `message: String!`, `severity: String`, `tags`, `attributes`.

### `DeploymentStatus` — the complete live enum (13 values)

    BUILDING  CRASHED  DEPLOYING  FAILED  INITIALIZING  NEEDS_APPROVAL
    QUEUED  REMOVED  REMOVING  SKIPPED  SLEEPING  SUCCESS  WAITING

### Deprecated — must not be used

- `Service.deployments` — use the root `deployments(input:)` query.
- `Service.serviceInstances` — use `serviceInstance(serviceId, environmentId)`.
- `Project.deployments`, `Project.plugins`, `Project.team`, `User.projects`, `User.workspace`.
- `serviceDuplicate` (CLI-only, slated for removal).

### Subscriptions (present, but out of MVP scope)

`Subscription.deploymentLogs`, `Subscription.buildLogs`, `Subscription.deployment` and
`Subscription.deploymentEvents` all exist in the live schema. Spec 03 makes log streaming a
stretch feature; the MVP polls over HTTP.

## OAuth / OIDC

The discovery document is live at
`https://backboard.railway.com/oauth/.well-known/openid-configuration`.

| Item | Value |
|---|---|
| Issuer | `https://backboard.railway.com` |
| Authorization | `https://backboard.railway.com/oauth/auth` |
| Token | `https://backboard.railway.com/oauth/token` |
| Userinfo | `https://backboard.railway.com/oauth/me` |
| JWKS | `https://backboard.railway.com/oauth/jwks` |
| Response types | `code` only |
| PKCE | `S256` supported |
| ID token signing | `ES256` |
| Token endpoint auth | `client_secret_basic`, `client_secret_post`, `none`, `private_key_jwt` |
| Access token lifetime | 1 hour |
| Refresh tokens | `offline_access` scope **plus** `prompt=consent` |

Scopes advertised by discovery: `openid`, `email`, `profile`, `offline_access`,
`workspace:{admin,member,viewer}`, `project:{admin,member,viewer}`, `notifications`, `ssh_keys`.

This application requests `openid email profile offline_access project:member`.

`project:member` because Railway maps OAuth scopes to project member roles: the token can do
what a project Member could do in the dashboard, which covers creating and deploying a service.

Railway publishes no per-mutation scope table, so this is an inference from the role mapping,
not something documented. It is only confirmed by running it. Fallback is `project:admin`.

## Rate limits

Documented request-per-hour ceilings: **Free 100**, Hobby 1,000 (10 rps max),
Pro 10,000 (50 rps max).

Response headers: `RateLimit-Policy`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
`X-RateLimit-Reset`, and `Retry-After` (sent only once the limit has been exceeded).
Exceeding the limit returns HTTP 429.

**This project targets the Free plan**, which is the binding constraint on polling.

## Deviations from the spec

### 1. Project discovery uses `externalWorkspaces`, not `projects`

Spec `03-railway-api.md` says "Do not query workspaces unless the chosen UX requires them."
Railway's OAuth documentation states that a token holding a project scope must list projects
via:

    query { externalWorkspaces { id name projects { id name } } }

The root `projects(workspaceId:, userId:, ...)` query is the account-token path, not the
documented OAuth path. We therefore query `externalWorkspaces` and flatten the result into a
flat project list, so the UX in spec 05 (project selector → environment selector) is unchanged.
The workspace name is used only as an optional grouping label.

### 2. `NEEDS_APPROVAL` is missing from the spec's status list

Spec `04-state-and-async.md` enumerates 12 statuses; the live enum has 13. Since Railway also
exposes `deploymentApprove`, this is a real state a deployment can sit in indefinitely, and
folding it into `PROVISIONING` would be a lie — the deployment is not progressing without human
action. It is modelled as its own domain state.

### 3. The Free-plan rate limit does not fit the spec's polling schedule

The planned schedule was ~1s, ~2s, ~3s, then ~5s. On the Free plan's 100 requests/hour,
watching one three-minute deployment at that rate costs about 36 requests before any logs.
Two deployments would use up the hour, including the requests needed to load the page.

So the schedule keeps that shape but reads `X-RateLimit-Remaining` from every response and
widens the interval as the budget drops. Polling also stops at terminal states. The numbers
changed; the design didn't. Constants are all in `src/domain/polling.ts`.
