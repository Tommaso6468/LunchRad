# Lunchrad

Kies samen waar jullie gaan lunchen. A realtime lunch wheel for a small team:
join a room with a code, add and boost restaurants, let the host spin the
arcade reel, and vote on a respin.

Status: **M9 — Big-screen mode**. See the [security assessment](docs/security-assessment.md) and the [runbook](docs/runbook.md). Teams enter a shared team key once,
create rooms (with a bot check) or join with a code, QR code or link, and see
each other live. The host can hand over the role, remove people and close the
room; rooms close themselves after 30 minutes. Everyone can add restaurants
(name, type of food, Google Maps link) and boost one of them for an extra slice
on the wheel. The host pulls the lever; the server picks the winner and every
phone runs the same reel animation to it. Then everyone present votes for one
minute: more than half yes removes that restaurant and spins again (at most
3 times). After the final result the room closes in 5 minutes. Admins manage
restaurants and lists at `/admin` (behind Cloudflare Access), see and close
open rooms, rotate the team key, and every change lands in an audit log.
Lunchrad installs as an app on Android and iOS, opens offline with a notice,
asks before updating, and has sound, vibration (Android) and confetti, with a
switch to turn sound off. Every final result is remembered (restaurant and
time only): "Eerdere lunches" shows the most picked places and the latest
lunches, and the host can give restaurants the team never went to an extra
slice ("Nieuwe plekken voorrang").

## Stack

| Part        | Technology                                                    |
| ----------- | ------------------------------------------------------------- |
| Frontend    | Angular v22 (standalone, signals, zoneless), Dutch only       |
| Backend     | Cloudflare Worker (Hono), Durable Objects per room (from M1)  |
| Storage     | D1 for presets and audit log                                  |
| Admin login | Cloudflare Access (email one-time PIN), JWT checked in Worker |
| Hosting     | Cloudflare Workers free plan                                  |

## Repository layout

```
app/      Angular app (built to app/dist/app/browser, served as static assets)
worker/   Cloudflare Worker: API, app shell with CSP nonce, later rooms
shared/   Code shared by app and Worker (room codes, message schemas)
scripts/  Repo checks and the post-deploy smoke test
docs/     Setup guide, threat model, security reviews per milestone
```

## Local development

Requires Node.js 24.15 or later.

```sh
npm ci
npm run dev        # builds the app, then runs the Worker on http://localhost:8787
npm run verify     # everything CI checks: lint, format, banned APIs, types, tests, build
```

`npm start -w app` runs the Angular dev server alone (no Worker, no CSP).

## Deploying

- **Staging**: every merge to `main` deploys automatically after CI passes.
- **Production**: publish a GitHub release with a tag `vX.Y.Z` on `main`.
  The workflow re-runs all checks, waits for approval, then deploys.

One-time setup on Cloudflare and GitHub: see [docs/setup.md](docs/setup.md).

## Security

See [SECURITY.md](SECURITY.md) for the rules this codebase follows and how to
report a vulnerability.
