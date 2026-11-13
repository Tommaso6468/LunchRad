# Lunchrad

Kies samen waar jullie gaan lunchen. A realtime lunch wheel for a small team:
join a room with a code, add and boost restaurants, let the host spin the
arcade reel, and vote on a respin.

Status: **M2 — Restaurants and boosts**. Teams enter a shared team key once,
create rooms (with a bot check) or join with a code, QR code or link, and see
each other live. The host can hand over the role, remove people and close the
room; rooms close themselves after 30 minutes. Everyone can add restaurants
(name, type of food, Google Maps link) and boost one of them for an extra slice
on the wheel. The reel itself comes in M3.

## Stack

| Part        | Technology                                                   |
| ----------- | ------------------------------------------------------------ |
| Frontend    | Angular v22 (standalone, signals, zoneless), Dutch only      |
| Backend     | Cloudflare Worker (Hono), Durable Objects per room (from M1) |
| Storage     | D1 for presets and audit log (from M5)                       |
| Admin login | Cloudflare Access (from M5)                                  |
| Hosting     | Cloudflare Workers free plan                                 |

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
