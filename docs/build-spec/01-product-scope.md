# 01 — Product Scope

## Product

Working name: **Railway Control Room**

A focused developer tool for creating and controlling an isolated Railway Sandbox service.

This is NOT:
- a Railway clone;
- a general cloud dashboard;
- a Kubernetes UI;
- an infrastructure orchestrator;
- a billing/usage product;
- a multi-tenant SaaS with persistent user data.

## Primary user journey

1. User opens the application.
2. User signs in with Railway.
3. Railway consent screen grants the application only the requested permissions and selected projects.
4. User selects a project.
5. User selects an environment.
6. User creates a Sandbox.
7. The application creates a Railway service from the application's fixed Sandbox Docker image.
8. The application configures the service if required.
9. The application triggers deployment.
10. The deployment enters an asynchronous lifecycle.
11. The UI shows truthful intermediate states.
12. The user can inspect logs.
13. The user can stop/restart/cancel where the current Railway state permits.
14. The user can inspect recent deployment history.
15. The user can create/use the Sandbox again without creating accidental duplicate Sandbox services.

## MVP capabilities

### Authentication
- Login with Railway.
- Authorization Code + OIDC.
- Server-side confidential web application.
- PKCE recommended.
- `state` validation required.
- Access token server-side only.
- Refresh token support.
- Secure session cookie.
- Logout.

### Resource selection
- Show projects the OAuth grant permits.
- Show environments for selected project.
- Do not show resources the Railway token cannot access.
- Handle empty project/environment lists gracefully.

### Sandbox creation
- Create one application-owned Sandbox service in the selected environment/project.
- Use a fixed, application-owned Docker image.
- Do not allow arbitrary user-supplied Docker images in MVP.
- Avoid duplicate Sandbox creation for the same selected project/environment.
- The service name should be deterministic enough to recognize, but must avoid collisions if Railway requires unique names.
- If the service already exists, discover and use it rather than creating another one.

### Deployment control
- Deploy the Sandbox.
- Observe deployment lifecycle.
- Restart a running deployment when appropriate.
- Stop a running deployment.
- Cancel a queued/building deployment when appropriate.
- Do not expose destructive service deletion in the normal UI.
- Do not implement rollback in MVP unless the core scope is already complete and tested.

### Observability
- Current deployment status.
- Recent deployment history.
- Build/runtime logs where Railway exposes them.
- Error details where Railway exposes them.
- Timestamp information.
- Clear distinction between Railway status and application/user-facing status.

### UI states
Every major screen/action needs:
- loading;
- success;
- empty;
- error;
- disabled/in-progress;
- retry where retry is safe;
- stale/refreshing state where appropriate.

## Non-goals

Do NOT build:
- billing;
- usage analytics;
- project creation;
- environment creation;
- arbitrary service deletion;
- arbitrary Docker image selection;
- persistent database;
- Redis;
- background job queue;
- Temporal;
- WebSocket infrastructure unless log streaming is later proven useful;
- custom distributed locking;
- custom container orchestration;
- team administration;
- custom RBAC beyond Railway OAuth permissions;
- notifications;
- email;
- GitHub integration;
- Kubernetes;
- metrics dashboard.

## Product principles

### 1. State honesty
Never tell the user "running" merely because a deployment mutation succeeded.

### 2. Railway semantics
Use terms such as Deploy, Restart, Stop, Cancel where they match Railway's actual operations. Do not invent generic container semantics when Railway's API has more precise meanings.

### 3. Small surface, deep behavior
A small number of actions should have excellent lifecycle handling.

### 4. Failure is a first-class state
The product should make failures understandable rather than hiding them behind generic "Something went wrong."

### 5. No accidental infrastructure
The application should never unexpectedly create duplicate services or repeated deployments because of a double click, browser retry, or stale UI.

## Stretch features, only after MVP

In this order:
1. Real-time deployment log streaming if the supported Railway GraphQL subscription path is clean.
2. More detailed deployment timeline.
3. Controlled rollback.
4. Better Sandbox lifecycle cleanup UX.

Each stretch feature must be independently justified. Do not let stretch features delay a stable MVP.
