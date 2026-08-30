# 03 — Railway API Contract

## Source of truth

Railway's public GraphQL endpoint is:

`https://backboard.railway.com/graphql/v2`

The exact current GraphQL schema must be checked through Railway's live schema/GraphiQL before implementation. Do not trust stale snippets.

Official documentation areas to consult:
- Public API
- API Cookbook
- Manage Services
- Manage Deployments
- Login & Tokens
- Scopes & User Consent
- Fetching Workspaces or Projects
- Creating an OAuth App

## Authentication

For this product use Railway OAuth, not a hard-coded account token.

OAuth is:
- OAuth 2.0 Authorization Code;
- OpenID Connect;
- confidential web application;
- client secret server-side;
- PKCE recommended;
- `state` required for CSRF protection;
- access token expires after one hour;
- refresh tokens available using `offline_access` plus `prompt=consent`.

Suggested initial scopes:
- `openid`
- `email`
- `profile`
- `offline_access`
- `project:member`

Verify the minimum required scope for each mutation during implementation. If a narrower scope works, use it.

OAuth client credentials are environment secrets:
- `RAILWAY_OAUTH_CLIENT_ID`
- `RAILWAY_OAUTH_CLIENT_SECRET`
- `RAILWAY_OAUTH_REDIRECT_URI`
- session secret(s)

Never expose them to browser code.

## Projects and environments

The application needs to discover projects granted by OAuth and then environments for the selected project.

Use the public GraphQL API.

Do not query workspaces unless the chosen UX requires them.

The product's resource flow is:
project → environment → Sandbox service.

## Service creation

The current Railway API cookbook documents:

`serviceCreate(input: ServiceCreateInput!)`

with a Docker image source, conceptually:

```graphql
mutation ServiceCreate($input: ServiceCreateInput!) {
  serviceCreate(input: $input) {
    id
  }
}
```

The input includes at least:
- project ID;
- service name;
- Docker image source.

Verify the exact current `ServiceCreateInput` shape live before implementation.

## Service configuration

Railway documents:

`serviceInstanceUpdate(serviceId, environmentId, input)`

for environment-specific build/deploy settings.

If the Sandbox image needs a specific start command, healthcheck, restart policy, region, or other setting, verify the exact supported input fields before using them.

Do not use undocumented flags.

## Deployment

Railway's current Manage Services documentation says the service deployment operation returns a deployment ID.

The current public API surface includes `serviceInstanceDeployV2(serviceId, environmentId)`.

The exact current return type and whether `commitSha` is accepted must be confirmed from live schema.

For a Docker-image Sandbox, the intended conceptual flow is:

1. Create service with the fixed image.
2. Apply any required environment-specific configuration.
3. Trigger deployment.
4. Capture deployment ID.
5. Query that deployment until terminal/running state.

Do not assume service creation itself is sufficient proof that the application is running.

## Redeploy vs restart

Use the correct Railway semantic:

- Deploy/redeploy = create a new deployment/build lifecycle.
- Restart = restart the existing running deployment without rebuilding, when supported.
- Stop = stop a running deployment.
- Cancel = cancel a queued/building deployment.
- Remove = remove a deployment from history.

Do not expose all of these as generic "Start/Stop" actions.

## Deployment queries

The public API documents:
- list deployments for a service/environment;
- get a deployment by ID;
- get latest active deployment;
- deployment status;
- build logs;
- runtime logs;
- HTTP logs.

Relevant statuses include:
- INITIALIZING
- QUEUED
- BUILDING
- DEPLOYING
- SUCCESS
- FAILED
- CRASHED
- REMOVED
- REMOVING
- WAITING
- SLEEPING
- SKIPPED

Treat the live schema as authoritative if it contains additional/current values.

## Logs

The current API cookbook documents `deploymentLogs(deploymentId, limit)` returning:
- timestamp;
- message;
- severity.

The Manage Deployments docs separately expose build/runtime/HTTP log retrieval.

Verify whether the preferred UI can use the unified log query or whether separate build/runtime queries are better.

## Subscriptions

A third-party schema mirror shows a `deploymentLogs` GraphQL subscription over WebSocket.

Do NOT make this a core dependency until verified against Railway's current live schema and documented/supported behavior.

MVP uses HTTP polling for deployment state and can poll logs.

If live subscription support is verified and clean, it is a stretch feature.

## Rate limits

Railway documents rate-limit response headers such as:
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`
- `Retry-After`

Current Railway pricing/API documentation should be checked before hard-coding numeric limits into application logic or README.

The application must:
- avoid aggressive polling;
- stop polling terminal deployments;
- back off;
- respect Retry-After where present;
- surface rate limiting as a recoverable state.

## Important current API gotcha

Do not confuse:
- service creation;
- service configuration;
- deployment trigger;
- deployment state;
- deployment removal.

They are different operations.

Also do not assume a mutation's HTTP success means the deployment succeeded.

## Research checkpoint before coding

Claude Code must verify these exact live-schema items before implementing the Railway client:
1. ServiceCreateInput fields for Docker image creation.
2. ServiceInstanceUpdateInput fields needed by Sandbox.
3. Exact deployment mutation name and return type.
4. Exact restart/stop/cancel mutation names and arguments.
5. Exact deployment query fields.
6. Exact log query fields.
7. Exact project/environment queries available to project-scoped OAuth.
8. Exact OAuth scope required for service creation/deployment.
9. Whether the live schema exposes a supported deployment-log subscription.
10. Current API rate-limit behavior/headers.

If any differ from this document, update the implementation plan before coding.
