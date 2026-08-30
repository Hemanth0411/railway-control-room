# 02 — Architecture

## Architectural objective

Keep the system small enough to understand completely while still demonstrating:
- TypeScript;
- GraphQL;
- OAuth/OIDC;
- asynchronous job/state handling;
- frontend architecture;
- failure handling;
- product judgment.

## High-level architecture

Browser
→ Next.js application
→ server-side application/API boundary
→ Railway client
→ Railway GraphQL API

Railway owns:
- service infrastructure;
- deployment execution;
- container lifecycle;
- scheduling;
- restart behavior;
- resource management.

Our application owns:
- authenticated user session;
- user intent;
- validation;
- action eligibility;
- Railway API orchestration;
- normalized state;
- polling;
- UI state;
- error presentation.

## Recommended stack

- TypeScript
- Next.js with App Router
- React
- Tailwind CSS
- a restrained component system (e.g. shadcn/ui only if it helps, not as a goal)
- server-side Route Handlers/server functions for Railway operations
- native `fetch` for the Railway GraphQL HTTP boundary unless a GraphQL client is clearly justified
- a small schema/validation library only where it materially improves input validation
- an OAuth/OIDC library rather than implementing OAuth cryptography/protocol manually
- Vitest for unit tests
- Playwright for end-to-end browser tests

Do not introduce Express just to say "Node backend." Next.js server-side code is sufficient for this application and avoids an unnecessary second server.

## Layering

### Presentation
Responsible for:
- rendering;
- user interaction;
- loading/error/empty states;
- polling orchestration on the client;
- displaying normalized domain state.

Must NOT:
- hold Railway access tokens;
- call Railway directly;
- know Railway GraphQL query syntax.

### Application/API
Responsible for:
- authentication/session checks;
- request validation;
- action eligibility;
- calling domain services;
- translating domain errors into stable API errors.

### Domain
Responsible for:
- deployment state normalization;
- lifecycle transitions;
- action eligibility;
- polling policy;
- idempotency/conflict rules;
- error classification.

Domain code should be testable without Railway.

### Infrastructure
Responsible for:
- Railway GraphQL transport;
- OAuth token exchange/refresh;
- session implementation;
- environment variables;
- external API error translation.

## Railway client boundary

Create a single clear boundary such as:

`RailwayClient`

It should expose domain-relevant methods, not raw GraphQL everywhere.

Example conceptual interface:

- listProjects()
- listEnvironments(projectId)
- findSandbox(projectId, environmentId)
- createSandbox(...)
- getDeployment(deploymentId)
- getLatestDeployment(...)
- listDeployments(...)
- deployService(...)
- restartDeployment(...)
- stopDeployment(...)
- cancelDeployment(...)
- getBuildLogs(...)
- getRuntimeLogs(...)

Exact method names may differ.

The rest of the application should not construct Railway GraphQL strings.

## Authentication boundary

Use a server-side auth module responsible for:
- generating OAuth authorization URL;
- validating callback state;
- exchanging code for tokens;
- refreshing access tokens;
- retrieving user identity;
- creating/reading secure sessions;
- logout.

Do not mix OAuth details with Railway deployment logic.

## Stateless constraint

No application database.

No persistent operation records.

The application derives current state from Railway.

Consequences:
- browser/client may keep transient selected IDs;
- Railway IDs may be stored in the session only if appropriate;
- deployment state must be re-read from Railway;
- refresh should recover by querying Railway rather than application persistence;
- do not pretend client-side state is authoritative.

## Deployment correlation

Important: verify the current live GraphQL schema and current Railway docs before implementing.

Railway's current service deployment documentation says the deployment operation returns a deployment ID, while some cookbook examples omit a selection because the mutation is scalar. Use the live schema to confirm the exact operation and return type.

The preferred flow is:

1. validate service state;
2. invoke the deployment mutation;
3. obtain the returned deployment ID;
4. use that ID for subsequent status/log queries;
5. if the chosen mutation/version does not return an ID in the live schema, do NOT invent a race-prone workaround silently. Stop and investigate the supported alternative.

## Idempotency without a database

The UI is not the idempotency mechanism.

Server-side action validation must prevent conflicting actions based on current Railway state.

Examples:
- deploy while an actionable deployment is already provisioning → reject as conflict/no-op;
- stop when no running deployment exists → return current state rather than blindly calling Railway;
- restart only when Railway state permits it;
- cancel only when queued/building;
- disable repeated mutation attempts while the current request is in flight.

If a true server-side idempotency key is not supported by Railway, do not pretend we have distributed exactly-once semantics. We have conflict prevention and state-aware command handling, not a distributed transaction.

## Error model

Use stable application error categories, for example:
- UNAUTHENTICATED
- FORBIDDEN
- VALIDATION_ERROR
- RESOURCE_NOT_FOUND
- CONFLICT
- RAILWAY_RATE_LIMITED
- RAILWAY_UNAVAILABLE
- RAILWAY_GRAPHQL_ERROR
- DEPLOYMENT_FAILED
- INTERNAL_ERROR

Do not expose raw access tokens, refresh tokens, client secrets, or sensitive upstream response data.

## Architecture decision rule

If a proposed abstraction cannot be explained in one paragraph, it probably does not belong in this project.
