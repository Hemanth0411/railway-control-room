# 08 — Learning Checkpoints

## Purpose

This project is not successful if Claude Code wrote it and the developer cannot explain it.

The developer must understand every architectural subsystem before moving to the next.

Claude Code should use these checkpoints to pause and teach/explain rather than simply continuing implementation.

## Checkpoint 0 — Architecture

Developer must be able to explain:

- why this is a Next.js application;
- why there is no separate backend service;
- why there is no database;
- what Railway owns;
- what our application owns;
- why the Railway client is behind a boundary;
- why the browser never calls Railway directly.

Do not proceed until understood.

## Checkpoint 1 — OAuth

Developer must be able to draw:

Browser
→ Railway authorization endpoint
→ callback
→ authorization code
→ token exchange
→ access token
→ session

Must understand:
- OAuth Authorization Code flow;
- OIDC;
- PKCE;
- state/CSRF;
- client secret;
- access-token expiry;
- refresh-token rotation;
- scopes;
- project selection consent.

## Checkpoint 2 — GraphQL

Developer must be able to explain:
- schema;
- query;
- mutation;
- variables;
- selection set;
- GraphQL errors vs HTTP errors;
- typed response handling;
- why GraphQL is behind a client abstraction.

Must know every Railway operation actually used.

## Checkpoint 3 — Service creation

Developer must be able to explain:
- project ID;
- environment ID;
- service ID;
- Docker image source;
- service instance;
- configuration vs deployment.

Must understand why creating a service is not the same as it running.

## Checkpoint 4 — Async deployment

Developer must be able to explain:

command
→ deployment ID
→ observation
→ state transition
→ terminal state

Must explain:
- eventual consistency;
- polling;
- backoff;
- terminal states;
- timeout;
- stale state.

## Checkpoint 5 — Idempotency/conflicts

Developer must be able to explain:
- why double-clicks are dangerous;
- what duplicate-action prevention actually guarantees;
- what it does NOT guarantee;
- why we do not claim distributed exactly-once semantics;
- why Railway itself owns deployment scheduling.

## Checkpoint 6 — Errors

Developer must explain:
- 401;
- 403;
- 429;
- network failure;
- GraphQL error;
- deployment FAILED;
- deployment CRASHED;
- unknown state.

Must know which errors are safe to retry.

## Checkpoint 7 — Frontend state

Developer must understand:
- server state vs UI state;
- loading;
- polling;
- stale data;
- optimistic vs pessimistic updates;
- action disabling;
- error recovery.

## Checkpoint 8 — Docker/Railway deployment

Developer must understand:
- Dockerfile;
- image;
- container process;
- port;
- healthcheck if used;
- Railway service;
- Railway deployment;
- environment variables;
- logs.

## Checkpoint 9 — Testing

Developer must explain why:
- domain tests are unit tested;
- Railway client is mocked;
- E2E is not dependent on live Railway for every run;
- a real manual smoke test is still required.

## Checkpoint 10 — Final interview rehearsal

Developer should be able to explain the entire system in:
- 60 seconds;
- 5 minutes;
- 15 minutes.

And answer:
- What was the hardest part?
- What did you deliberately not build?
- What would you change with a database?
- What would you change with multiple users?
- What happens if Railway changes its API?
- What happens if the deployment never leaves QUEUED?
- What happens if the user closes the browser?
- What happens if the token expires during deployment observation?
- What guarantees does the application provide?
- What guarantees does it deliberately not provide?

## Claude Code behavior

If the developer asks "why?" during implementation, explain the actual mechanism before changing code.

Never hide architectural decisions inside generated code.

Prefer:
- small commits;
- understandable diffs;
- named functions;
- explicit types;
- tests next to the behavior they protect.

The goal is not maximum generated code.

The goal is maximum developer understanding per line of code.
