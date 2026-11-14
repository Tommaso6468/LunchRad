# Security

Lunchrad runs on the public internet. It stores almost nothing sensitive
(first names, restaurant names), but a misconfiguration is easy to find and
exploit with automated tooling. Security is a release gate, not an afterthought.

## Reporting a vulnerability

Use GitHub's **private vulnerability reporting** on this repository
(Security → Report a vulnerability). Do not open a public issue.
Expect a response within 7 days.

## Rules for this codebase

These are enforced by CI where possible.

| Rule                                                                                                             | Enforced by                                 |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| No raw HTML: no `[innerHTML]`, `innerHTML =`, `insertAdjacentHTML`, `bypassSecurityTrust*`                       | ESLint + `scripts/check-forbidden.mjs`      |
| No string-to-code: no `eval`, `new Function`                                                                     | ESLint + `scripts/check-forbidden.mjs`      |
| Randomness for codes, tokens and spins comes from `crypto.getRandomValues`, never `Math.random`                  | ESLint                                      |
| Strict CSP: per-request nonce, no `unsafe-inline`/`unsafe-eval`, Trusted Types                                   | Worker tests + post-deploy smoke test       |
| Security headers on every response, including static assets                                                      | Worker tests (incl. `_headers` drift check) |
| Every request body and WebSocket message is validated with a Zod schema, has a size limit and a rate limit       | Shared schemas, Worker tests                |
| The spin result is decided once, on the server, with the CSPRNG; the client only animates towards it             | Worker tests (incl. 1 000-spin odds test)   |
| Links are only accepted to Google Maps (https, allow-listed hosts and paths) and open with `noopener noreferrer` | Shared + Worker + app tests                 |
| Every room route needs the team session; WebSockets also need the participant token in the first message         | Worker tests                                |
| Secrets missing or too weak: the API answers 503, never a default                                                | Worker tests                                |
| Roles (host, admin) are checked on the server only; the client is never trusted                                  | Code review, abuse tests                    |
| No secrets in the repo; secrets live in GitHub environment secrets and Wrangler secrets                          | gitleaks, GitHub push protection            |
| Errors to clients are generic Dutch messages; logs contain no tokens, keys or full IPs                           | Code review                                 |
| Dependencies: no known high/critical vulnerabilities, registry signatures verified                               | `npm audit`, OSV, dependency review         |
| GitHub Actions pinned to commit SHAs, least-privilege permissions, no persisted credentials                      | CodeQL (actions), review                    |
| Production deploys only from a semver release tag on `main`, after full re-verification and manual approval      | `deploy-production.yml`, GitHub environment |

## Secure development lifecycle

Every milestone follows the same loop: requirements → threat model update →
build with reviewed PRs → automated checks → security gate → release.

The gate checklist and each milestone's written assessment live in
[docs/security-reviews/](docs/security-reviews/). The threat model is in
[docs/threat-model.md](docs/threat-model.md).

## Accepted risks

- **Duplicate participants**: without accounts, one person could join twice
  from two devices. Mitigated by host kick and one participant per device
  token. Accepted: users are teammates.
- **Kicked participants can rejoin** under another name with the team key.
  There is no ban list: users are teammates, and the host can kick again.
- **Rate limits are approximate** (per Cloudflare location) and fail open if
  the limiter itself is unavailable; the team key and Turnstile still apply.
- **Single admin**: if the owner loses access to the admin email or the
  Cloudflare account, presets cannot be changed. The app keeps working.

The current security assessment is in [docs/security-assessment.md](docs/security-assessment.md); the incident runbook in [docs/runbook.md](docs/runbook.md).
