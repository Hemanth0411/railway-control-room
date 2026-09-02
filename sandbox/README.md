# Sandbox image

The service the Control Room creates and deploys. It exists to be started, watched,
restarted, stopped and crashed — not to do anything useful.

One file, no dependencies, so it starts in well under a second. That matters: most of what
the Control Room shows is a deployment moving between states, and a slow image makes that
harder to observe, not easier.

## What it serves

| Path | Does |
|---|---|
| `/` | Plain text: when it started and how long it has been up |
| `/health` | JSON `{ status, startedAt, uptimeSeconds }` |
| `/crash` | Answers, then calls `process.exit(1)` |

It reads `PORT` from the environment, which is how Railway tells it where to listen.
`CRASH_AFTER_MS` makes it exit non-zero that many milliseconds after start.

It handles `SIGTERM` by closing the server and exiting 0, so stopping a deployment produces
a clean shutdown in the logs rather than a killed process.

Progress goes to stdout and only real failures go to stderr, because Railway classifies
logs by stream: stdout becomes `info`, stderr becomes `error`.

## Publishing it

The GitHub Actions workflow at `.github/workflows/sandbox-image.yml` builds and pushes on
any change under `sandbox/`, or on manual dispatch. No local Docker needed.

It publishes:

    ghcr.io/<owner>/control-room-sandbox:latest
    ghcr.io/<owner>/control-room-sandbox:<commit sha>

**The package has to be public**, or Railway cannot pull it without registry credentials
that this project deliberately does not handle. GitHub keeps package visibility separate
from repository visibility, so a private repo can publish a public image. After the first
successful run: GitHub profile → Packages → `control-room-sandbox` → Package settings →
Change visibility → Public.

Then point the Control Room at it:

    SANDBOX_IMAGE=ghcr.io/<owner>/control-room-sandbox:latest

## Triggering each state on purpose

**RUNNING** — deploy it. Nothing else required.

**CRASHED** — open the deployment URL and visit `/crash`. The process exits 1 and Railway
reports CRASHED. Alternatively set `CRASH_AFTER_MS=5000` as a service variable in Railway
and redeploy, which crashes without needing the URL.

**FAILED** — this one cannot come from the image, because FAILED is a build or pull
failure and the image is already built. Point `SANDBOX_IMAGE` at a tag that does not
exist, e.g. `ghcr.io/<owner>/control-room-sandbox:no-such-tag`, and create a Sandbox in a
fresh environment. Railway fails to pull and reports FAILED.

**CANCEL** — hard to reach honestly. Cancel is only valid while a deployment is queued or
building, and a prebuilt image gets past that window almost immediately. Recorded as a
known limitation rather than faked.

## A caution

`/crash` will kill the container for anyone who finds the URL. That is the point of this
image, and it is why it is a throwaway sandbox rather than something to build on.
