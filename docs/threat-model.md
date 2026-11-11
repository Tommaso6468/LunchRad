# Threat model

Version 1 — M0 (20 October 2026). Update this file in every milestone that
changes the attack surface.

## Assets

| Asset                         | Why it matters                                          |
| ----------------------------- | ------------------------------------------------------- |
| Availability of the free tier | 100,000 Durable Object requests/day; abuse breaks lunch |
| Integrity of the spin         | The whole point: nobody may rig the result              |
| Admin capabilities            | Presets, team-key rotation, force-closing rooms         |
| Deploy pipeline               | Whoever deploys controls everything users run           |
| Participant names             | Personal data (AVG/GDPR), minimal but real              |

## Trust boundaries

1. Browser ↔ Cloudflare edge (Turnstile, rate limiting, Cloudflare Access for admin)
2. Edge ↔ Worker (all validation, roles, CSP)
3. Worker ↔ Durable Object per room ↔ D1
4. GitHub ↔ Cloudflare (deploy token, CI)

## Threats (STRIDE)

| #   | Category               | Threat                                                    | Control                                                                                                         | Milestone  |
| --- | ---------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------- |
| S1  | Spoofing               | Outsider guesses a room code and joins                    | Team key required; 32^6 codes; join rate limit per IP                                                           | M1         |
| S2  | Spoofing               | Someone joins under a colleague's name                    | Unique names per room; host kick                                                                                | M1         |
| S3  | Spoofing               | Forged admin request                                      | Worker validates the Cloudflare Access JWT signature, audience and issuer                                       | M5         |
| T1  | Tampering              | Client claims host role or sends a winner                 | Roles and winner exist only server-side; every message checked against the token's role                         | M1, M3     |
| T2  | Tampering              | Malicious code reaches production via CI                  | Actions pinned to SHAs, read-only permissions, prod only from tags on `main`, manual approval                   | M0         |
| T3  | Tampering              | Compromised npm dependency                                | Lockfile, `npm audit`, signature verification, OSV-Scanner, dependency review, Dependabot, minimal dependencies | M0         |
| R1  | Repudiation            | Preset deleted, nobody knows by whom                      | Admin audit log in D1                                                                                           | M5         |
| I1  | Information disclosure | Room state leaks to non-members                           | WebSocket requires team key + participant token; no room listing                                                | M1         |
| I2  | Information disclosure | Stack traces or internals in responses                    | Generic error bodies; structured logs without request data                                                      | M0         |
| I3  | Information disclosure | Secrets committed to the public repo                      | gitleaks in CI, GitHub secret scanning with push protection, `.gitignore` for env files                         | M0         |
| D1  | Denial of service      | Bots exhaust the free quota                               | Turnstile + rate limit on create/join; per-IP room cap; per-socket message rate and size limits                 | M1         |
| E1  | Elevation of privilege | Stored XSS via restaurant or participant names            | Text-only rendering enforced by lint; strict nonce CSP; Trusted Types                                           | M0, M2     |
| E2  | Elevation of privilege | Clickjacking the host's controls                          | `frame-ancestors 'none'` + `X-Frame-Options: DENY`                                                              | M0         |
| E3  | Elevation of privilege | Cross-site WebSocket hijacking                            | `Origin` check on upgrade; tokens sent in the first message, not cookies                                        | M1         |
| E4  | Elevation of privilege | Takeover of the owner's GitHub, Cloudflare or admin email | Passkeys/hardware keys, scoped Cloudflare API token, branch protection                                          | M0 (setup) |

## Notes for later milestones

- **M6 (PWA):** the service worker will cache the app shell, including its
  CSP nonce. The nonce then stays the same on that device until the next
  update. Acceptable (an attacker cannot read it), but document it in the M6
  review and keep the cache scoped to this origin.
- **M1:** Turnstile needs `https://challenges.cloudflare.com` in `script-src`
  and `frame-src`; add it only on the pages that use it.
