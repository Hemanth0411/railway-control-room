# 06 — Testing & Quality

## Testing philosophy

Test the parts where correctness matters.

Do not chase meaningless coverage percentages.

The highest-value tests are:
- state normalization;
- action eligibility;
- polling behavior;
- Railway client error translation;
- OAuth callback security;
- duplicate/conflicting actions;
- UI behavior around asynchronous state.

## Unit tests

Write deterministic tests for:

### State normalization
Examples:
- BUILDING → PROVISIONING
- DEPLOYING → PROVISIONING
- SUCCESS → RUNNING
- FAILED → FAILED
- CRASHED → CRASHED
- REMOVED → STOPPED
- unknown status → UNKNOWN

### Action eligibility
Examples:
- Deploy allowed when no actionable deployment exists.
- Deploy rejected when a deployment is already provisioning.
- Stop allowed for running deployment.
- Stop rejected when no running deployment exists.
- Cancel allowed for queued/building.
- Restart allowed only when appropriate.

### Polling policy
Test:
- immediate observation;
- backoff;
- terminal state stops polling;
- timeout stops polling;
- rate-limit response changes next attempt;
- cancellation stops polling.

### Error classification
Test:
- GraphQL error;
- HTTP 401;
- HTTP 403;
- HTTP 429;
- network failure;
- malformed response;
- unknown Railway status.

## Railway client tests

Mock GraphQL transport.

Verify:
- query/mutation variables;
- headers;
- GraphQL error handling;
- response parsing;
- token refresh path;
- no secrets in thrown/public errors.

Do not hit the live Railway API in ordinary tests.

## OAuth tests

Test:
- state generated;
- state mismatch rejected;
- authorization denial handled;
- code exchange errors handled;
- access-token expiry/refresh;
- refresh-token rotation handled;
- callback cannot be replayed with the same code;
- session cookie has secure attributes in production.

Do not write your own OAuth cryptography.

## Integration tests

Test application API routes against a mocked Railway client.

Example:
- create Sandbox;
- deployment command;
- deployment status observation;
- stop;
- cancel;
- logs.

The API layer should be testable without real Railway credentials.

## End-to-end tests

Use Playwright.

At minimum cover:
1. unauthenticated landing page;
2. authenticated dashboard using a test auth/session strategy;
3. project/environment selection;
4. no-Sandbox state;
5. provisioning state;
6. running state;
7. failed state;
8. stop/restart controls;
9. logs;
10. duplicate action prevention.

Do not make E2E tests depend on a live Railway deployment for every CI run.

A small manual smoke test against a real Railway project should verify the external integration.

## Manual acceptance test

Before deployment, perform a real Railway smoke test:

1. Login with Railway.
2. Select a test project/environment.
3. Create Sandbox.
4. Verify service appears in Railway dashboard.
5. Deploy.
6. Watch queued/building/deploying/success states.
7. Inspect logs.
8. Restart.
9. Stop.
10. Trigger a deliberate Sandbox failure if implemented.
11. Verify FAILED/CRASHED behavior.
12. Refresh browser during provisioning and verify state recovers.
13. Attempt duplicate action and verify no duplicate deployment is created.

## Quality gates

Before calling MVP complete:
- typecheck passes;
- lint passes;
- unit tests pass;
- integration tests pass;
- E2E tests pass;
- production build passes;
- no secrets in repository;
- `.env.example` is complete;
- README matches actual behavior;
- Railway smoke test passes;
- deployment works from a clean checkout.

## Code review checklist

Check:
- no duplicated Railway GraphQL logic;
- no token leakage;
- no raw Railway errors exposed unnecessarily;
- no client-side Railway credentials;
- no unbounded polling;
- no arbitrary retries on non-idempotent commands;
- no hidden global mutable state;
- no unnecessary abstractions;
- no unexplained dependencies;
- no dead features;
- no misleading names such as "container start" where Railway means deployment.
