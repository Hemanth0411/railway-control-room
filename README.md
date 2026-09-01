# Railway Control Room

A small web app for creating one Sandbox service on Railway, deploying it, and watching
what actually happens to it — build, deploy, running, failed, crashed — with the logs and
the controls that match the state Railway reports.

It is deliberately small. Railway owns the infrastructure. This app owns the session, the
user's intent, and an honest picture of what Railway is doing.

## Status

Being built in phases. Right now the repo contains:

- the domain layer: status normalization, action rules, the polling schedule, and the
  error model — all pure TypeScript, with tests;
- Railway OAuth: login, callback, logout, session, and token refresh
  (`/api/auth/*`, `/api/me`);
- the Railway GraphQL client: projects, environments, Sandbox lookup and creation,
  deploy/restart/stop/cancel/approve, deployment reads, and logs;
- the API routes the browser will talk to (`/api/projects`, `/api/environments`,
  `/api/sandbox`, `/api/sandbox/action`, `/api/deployments/...`), including the
  server-side conflict check that rejects a duplicate deploy;
- a verified record of every Railway API operation the app will use
  (`docs/railway-schema-verification.md`);
- the decisions behind the design (`docs/decisions.md`).

Not built yet: the UI. `npm run dev` still serves the Next.js starter page, so
everything above is reachable only by calling the endpoints directly.

None of this has been run against a real Railway account yet, so treat it as
written-and-unit-tested rather than working. What *is* verified against live Railway:
the GraphQL schema every query is written against, OIDC discovery, and
authorization-URL construction. What isn't: the token exchange, and any actual mutation.

## Why I built this

I started out just curious. The more I read about what Railway does and publishes, the
more I wanted to understand it properly.

Most of my work so far has been solving business problems with technology. Not purely
technical problems, and not inventing new ways to solve a technical issue. Seeing that
kind of work up close surprised me. I am early in my career, so this feels like the right
time to go and explore it, and the way to understand what they build is to build
something against it.

## What I knew going in

Worth being straight about, because it shaped how the code is organised.

- **GraphQL** — first time. I had never used it before this project. That is why I am
  keeping it behind one client boundary instead of letting queries spread through the app.
- **OAuth** — I have set up Google and Microsoft OAuth before, on a careers page at eTeam
  that is live now, but I did that with a friend's help. This is the first time I am
  working through the flow myself.
- **Next.js** — my understanding is that it is a heavier frontend framework than most,
  with rich frontend features and server-side rendering. I am learning it as I go here.

I am stronger on the product side than the infrastructure side. I have done a lot of
working out what a customer actually wants, gathering requirements, and building
solutions to fit. How servers, networking and DNS work underneath is not something I have
worked on, and this project is partly an attempt to close some of that gap.

## How it fits together

```
Browser
  → Next.js route handlers (session, validation, action rules)
    → Railway client (typed, server-side only)
      → Railway GraphQL API
```

The browser never talks to Railway and never sees a Railway token. Everything goes
through our own endpoints.

### Layers

- `src/domain/` — pure logic. No Railway, no Next, no React. This is where status
  normalization, action eligibility, the polling schedule and error categories live, and
  it is the part with real test coverage.
- `src/app/` — Next.js routes and UI (not written yet).

## The part that matters: async state

A deploy mutation returning successfully does not mean the Sandbox is running. It means
Railway accepted the command.

So the flow is:

1. Deploy with `serviceInstanceDeployV2`, which returns a deployment ID.
2. Use that ID to read the deployment's status.
3. Keep reading until it settles.

Railway reports 13 different statuses. The app maps them onto a smaller set
(`PROVISIONING`, `RUNNING`, `FAILED`, `CRASHED`, `STOPPED`, and a few more) and always
shows the raw Railway status too. Anything it doesn't recognise becomes `UNKNOWN` rather
than being guessed at — Railway can add statuses whenever it likes.

Polling stops when the deployment settles, after 15 minutes, or when the Railway request
budget gets low. See `docs/decisions.md` for why the budget matters on Railway's Free plan.

### Duplicate actions

Before any command, the server reads the current state from Railway and checks whether
the action is valid. A second Deploy while one is already building is rejected, not sent.

This is conflict prevention, not exactly-once execution. Two requests can read the same
state and both get through. Railway has no idempotency key for these mutations, so that
gap can't be closed from this side.

## Railway API

Every operation was checked against Railway's live GraphQL schema before being used.
Introspection works without a token, so it is easy to re-verify:

```bash
curl -s -X POST https://backboard.railway.com/graphql/v2 \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name:\"ServiceCreateInput\"){ inputFields { name } } }"}'
```

`docs/railway-schema-verification.md` lists every operation with its real signature, the
deprecated fields being avoided, and three places where the live API differs from what I
had assumed.

## Security

- Railway OAuth (authorization code + OIDC, PKCE, `state`), confidential client.
- Client secret and tokens stay server-side, in an encrypted httpOnly cookie session.
- Scopes: `openid email profile offline_access project:member` — the user picks which
  projects the app can see on Railway's consent screen.
- Error responses carry a category and a message, never the upstream payload. There is a
  test asserting a token placed in an error's diagnostic field cannot appear in the
  serialised response.

## Trade-offs

No database, no queue, no worker, no WebSocket. Polling instead of subscriptions. One
fixed Sandbox image. One Sandbox per project/environment. Reasons for each are in
`docs/decisions.md`.

## Local development

```bash
npm install
npm test          # unit tests
npm run typecheck
npm run lint
npm run dev       # starter page for now
```

To run against Railway you will need a Railway OAuth app (Web/confidential) with
`http://localhost:3000/api/auth/callback` registered as a redirect URI. Copy
`.env.example` to `.env.local` and fill it in.

## Known limitations

- Sessions are cookie-only. Losing the cookie means signing in again.
- State is read from Railway on demand, so the UI is only as fresh as the last poll.
- Railway's Free plan allows 100 API requests an hour, which limits how much watching the
  app can do. It backs off rather than failing, but it is a real ceiling.
- No service deletion in the UI, by choice.
- `project:member` has not yet been confirmed sufficient for service creation and
  deployment against a real account.
