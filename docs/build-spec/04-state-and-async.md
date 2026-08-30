# 04 — State & Async Behavior

## Core principle

A command being accepted is not the same thing as the desired infrastructure state being reached.

Example:

`Deploy mutation succeeded` ≠ `Sandbox is running`.

The deployment ID is the correlation identifier for the asynchronous operation.

## Railway raw status

At minimum account for:
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

Treat unknown future statuses safely.

## Domain state

Normalize raw Railway state into a small product model.

Suggested states:

### NO_DEPLOYMENT
No active/current deployment exists.

### PROVISIONING
The requested deployment is still moving toward a running state:
- INITIALIZING
- QUEUED
- BUILDING
- DEPLOYING

Keep the raw Railway status available for display.

### RUNNING
Railway status is SUCCESS.

### FAILED
Railway reports FAILED.

### CRASHED
Railway reports CRASHED.

### STOPPING
A stop command was accepted and we are waiting for the deployment to leave the running state.

### STOPPED
The deployment is no longer running, e.g. REMOVED, subject to actual Railway semantics.

### WAITING
If Railway exposes a waiting/approval state, show it distinctly.

### SLEEPING
If encountered, show it distinctly rather than mapping it blindly to stopped.

### UNKNOWN
Unknown/future state. Fail safe and show the raw status.

## User intent vs infrastructure state

Do not store only one `status` field conceptually.

There are two things:

1. user command:
   - DEPLOY
   - RESTART
   - STOP
   - CANCEL

2. observed Railway state:
   - BUILDING
   - DEPLOYING
   - SUCCESS
   - etc.

The UI may derive an "operation in progress" presentation from both.

## Polling

Polling happens through our server, not directly from the browser to Railway.

Conceptual algorithm:

1. Mutation returns a deployment ID.
2. Immediately fetch that deployment.
3. Poll with a short initial delay.
4. Back off to a stable interval.
5. Stop on terminal state.
6. Stop after a hard timeout.
7. Respect rate-limit/retry information.
8. If the deployment disappears, re-query the service's latest deployment and classify carefully rather than assuming success/failure.

Do not use an unbounded `setInterval`.

Use a cancellable polling loop on the client and server endpoints that perform one observation per request.

The browser can poll our endpoint.

## Recommended initial client polling schedule

Use this as a starting point, not an immutable rule:

- immediate observation;
- ~1 second;
- ~2 seconds;
- ~3 seconds;
- then ~5 seconds between observations.

After several observations, remain around 5 seconds while the deployment is still active.

Make the schedule configurable in one place.

Do not poll forever.

## Terminal states

Polling should stop for:
- SUCCESS
- FAILED
- CRASHED
- REMOVED
- SKIPPED

Potentially stop or use a different policy for:
- SLEEPING
- WAITING

Verify the desired behavior from Railway semantics.

## Stale state

The browser is not authoritative.

If the user refreshes:
- re-fetch current project/environment/service/deployment data.

If another Railway dashboard session changes the deployment:
- the next poll should eventually reflect it.

If a deployment ID is stale:
- show that the deployment is no longer available;
- re-query latest service state where useful.

## Double-click/concurrent actions

Example:

User clicks Deploy twice.

The first command creates deployment A.

The second request must not blindly create deployment B if A is already actionable.

The server should:
1. fetch current service/deployment state;
2. determine whether the requested action is valid;
3. reject/no-op conflicting actions;
4. only invoke Railway when appropriate.

This is conflict prevention, not distributed exactly-once execution.

Do not claim stronger guarantees.

## Stop/cancel distinction

If the deployment is running:
- use Stop.

If the deployment is still queued/building:
- use Cancel.

Do not call Stop for a build that is not yet running if Railway's API semantics do not support it.

## Restart distinction

Restart should be offered only when appropriate.

Restart is different from Deploy:
- Restart does not rebuild;
- Deploy creates a new deployment lifecycle.

This distinction should appear in the UI and README.

## Failure handling

### Railway GraphQL error
Show a human-readable application error and preserve diagnostic context server-side.

### HTTP/network failure
Show "Railway could not be reached" or similar. Do not claim the deployment failed unless Railway actually reports failure.

### Rate limit
Show a retryable state and obey server timing information.

### Authentication expiry
Attempt refresh if a refresh token exists. If refresh fails, require re-authentication.

### Deployment FAILED
Show failure state and logs.

### Deployment CRASHED
Show crashed state and runtime logs.

### Unknown status
Show "Unknown Railway state" and raw status. Do not guess.

## No fake background orchestration

The application does not keep a server-side worker polling continuously.

The browser requests current state when needed.

This is intentional because:
- the application is stateless;
- the user is the observer;
- Railway owns execution;
- it avoids creating a second job system.
