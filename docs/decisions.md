# Decisions

Short notes on the choices that shape this project. Only the ones worth arguing about.

---

## Next.js, not a separate backend

**Decision.** One Next.js app. Route handlers do the server work.

**Why.** The server side only has to hold OAuth tokens, talk to Railway, and hand
normalized state to the browser. That is a few endpoints. One app means one deploy,
one set of environment variables, and one place to look.

**Alternatives.** An Express or Fastify API next to a React frontend.

**Why not.** It would add a second service and a second deploy to run the same handful
of endpoints, and CORS and session sharing between the two. Nothing here needs it.

---

## No database

**Decision.** No database, no Redis. The only state we keep is an encrypted session cookie.

**Why.** Railway already owns the real state: which services exist, which deployments
ran, what status they are in. Anything we stored would be a copy that goes stale the
moment someone uses the Railway dashboard. On a page refresh we re-read from Railway,
which is the same path a first load takes, so there is one code path instead of two.

**Alternatives.** Postgres for deployment history and user preferences.

**Why not.** There is no application state that Railway doesn't already have. Adding
one would mean keeping two sources of truth in sync for no benefit.

---

## Polling, not subscriptions

**Decision.** The browser polls our server; our server makes one Railway request per poll.

**Why.** Deployment state changes a handful of times over a few minutes. Polling is easy
to reason about, easy to stop, and easy to test as a pure function. It also fails in an
obvious way — a request errors — instead of a socket that quietly stops delivering.

**Alternatives.** Railway does expose `deploymentLogs`, `buildLogs` and `deployment`
subscriptions over WebSocket. They are real; I checked the live schema.

**Why not.** A WebSocket would need connection lifecycle, reconnect and backpressure
handling for an update that arrives a few times per deployment. The spec lists log
streaming as a stretch feature, and that is the right order.

---

## Polling stops, and the schedule watches the rate limit

**Decision.** Polling stops at terminal states, after a 15-minute timeout, and when the
Railway request budget runs low. The interval widens as `X-RateLimit-Remaining` falls.

**Why.** Railway's Free plan allows 100 requests an hour. At a flat 5-second interval,
one three-minute deployment costs about 36 of them. Two deployments would exhaust the
hour, including the requests needed to render the page. So the schedule has to react to
the budget, or the app breaks itself on the plan it is meant to run on.

**Alternatives.** A fixed interval, and let 429s happen.

**Why not.** A 429 storm is a worse experience than a slower refresh, and the user has
no way to understand why the page stopped working.

**Note.** States where Railway is waiting on a person — `NEEDS_APPROVAL`, `WAITING`,
`SLEEPING` — also stop polling, because they cannot change on their own. Manual refresh
still works.

---

## Railway is only called from the server

**Decision.** The browser never talks to Railway. It only talks to our route handlers.

**Why.** The access token would otherwise have to reach browser JavaScript, and anything
in browser JavaScript is readable by the user and by any script on the page. Keeping the
token in an httpOnly cookie session means it is never exposed. It also gives one place
to normalize errors and read rate-limit headers.

**Alternatives.** Call Railway's GraphQL API directly from React.

**Why not.** It leaks the token, and it would put GraphQL query strings in the frontend.

---

## OAuth, not a personal API token

**Decision.** Railway OAuth (authorization code + OIDC, PKCE, `state`), with the client
secret server-side.

**Why.** A hard-coded account token would act as one specific person and would grant
access to everything that person can reach. OAuth means each user authorizes their own
projects, and the consent screen lets them pick which ones.

**Alternatives.** A Railway account token in an environment variable.

**Why not.** It would make the app single-user, and it would hand it access to every
project on that account rather than the ones the user picked.

---

## `project:member` scope

**Decision.** Request `openid email profile offline_access project:member`.

**Why.** Railway maps OAuth scopes to project member roles, and project scopes let the
user share individual projects rather than a whole workspace. `project:viewer` cannot
create or deploy a service.

**Honest caveat.** Railway does not publish a per-mutation scope table. That
`project:member` is enough for `serviceCreate` and `serviceInstanceDeployV2` is an
inference from the role mapping, and is only confirmed by running it. If it turns out to
be insufficient the fallback is `project:admin`.

---

## `serviceInstanceDeployV2`, not `serviceInstanceDeploy`

**Decision.** Deploy with `serviceInstanceDeployV2`, which returns the deployment ID.

**Why.** The deployment ID is what correlates the command with everything after it:
status polling, logs, stop, cancel. Getting it back from the mutation means we know
exactly which deployment we started.

**Alternatives.** `serviceInstanceDeploy` and `serviceInstanceRedeploy` both exist.

**Why not.** Both return `Boolean`. Using them would mean deploying and then guessing
which deployment was ours, usually by taking the newest one — which is wrong the moment
anything else deploys at the same time.

---

## One fixed Sandbox image

**Decision.** One Docker image, set by `SANDBOX_IMAGE`. Users cannot supply their own.

**Why.** Letting a signed-in user deploy an arbitrary image into their Railway project
turns this app into a way to run arbitrary code on someone else's account. Fixing the
image keeps the surface small and keeps the app about deployment lifecycle, which is the
point.

**Alternatives.** An image field in the UI.

**Why not.** It adds the entire problem of validating and trusting user-supplied images,
for a feature the product does not need.

---

## Duplicate deployment requests

**Decision.** Before every mutation the server reads the current deployment from Railway
and checks whether the action is valid. If a deployment is already provisioning, a second
Deploy is rejected with a conflict instead of being sent.

**Why.** Disabling the button is not enough. A double click, a browser retry, a second
tab, or a refresh mid-request can all produce a second command. The check has to be on
the server, against Railway's state, because Railway is the only thing that knows.

**What this does not give.** Not exactly-once execution. Two requests can read the same
state and both be allowed through before either mutation lands. Railway exposes no
idempotency key for these mutations, so that window cannot be closed from here.

---

## What the app guarantees, and what it doesn't

**It does:**

- keep Railway tokens out of the browser;
- check the current Railway state before every command, so conflicting commands are
  rejected rather than sent;
- show the raw Railway status alongside our own, and say "unknown" when it sees a status
  it doesn't recognise;
- stop polling rather than exhaust the account's request budget;
- distinguish "the deployment failed" from "we couldn't reach Railway", and say which.

**It does not:**

- guarantee exactly-once deployment;
- keep any history of its own — everything shown comes from Railway at read time;
- work while Railway is down, beyond reporting that it is;
- survive a lost session — if the cookie goes, the user signs in again and re-reads state
  from Railway.
