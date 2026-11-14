# Threat model

Version 5 — M4 (14 November 2026). Update this file in every milestone that
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

| #   | Category               | Threat                                                     | Control                                                                                                                                 | Milestone  |
| --- | ---------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| S1  | Spoofing               | Outsider guesses a room code and joins                     | Team session required on join **and** WebSocket; 32^6 codes; join and WebSocket rate limits per IP                                      | M1 ✓       |
| S2  | Spoofing               | Someone joins under a colleague's name                     | Unique names per room (case-insensitive, NFC); host kick                                                                                | M1 ✓       |
| S4  | Spoofing               | Brute-forcing the shared team key                          | 10 attempts/min/IP, constant-time compare, minimum length enforced, guidance for a long random key                                      | M1 ✓       |
| S3  | Spoofing               | Forged admin request                                       | Worker validates the Cloudflare Access JWT signature, audience and issuer                                                               | M5         |
| T1  | Tampering              | Client claims host role or sends a winner                  | Roles and winner exist only server-side; `start_spin` has no parameters; winner from `crypto.getRandomValues` with rejection sampling   | M1 ✓, M3 ✓ |
| T4  | Tampering              | Forged or replayed team session / Turnstile token          | HMAC-signed session with expiry and key fingerprint; Turnstile verified server-side, single-use, hostname + action checked              | M1 ✓       |
| T2  | Tampering              | Malicious code reaches production via CI                   | Actions pinned to SHAs, read-only permissions, prod only from tags on `main`, manual approval                                           | M0         |
| T3  | Tampering              | Compromised npm dependency                                 | Lockfile, `npm audit`, signature verification, OSV-Scanner, dependency review, Dependabot, minimal dependencies                         | M0         |
| T7  | Tampering              | Changing the odds after the lever is pulled                | List and boosts locked server-side from `start_spin` until the room closes; reel fixed in room storage                                  | M3 ✓       |
| T8  | Tampering              | Stuffing or forging respin votes                           | One vote per participant id from the authenticated socket; electorate fixed at vote start (connected only); latecomers refused          | M4 ✓       |
| T9  | Tampering              | Forcing or blocking a respin by leaving, kicking or timing | Fixed denominator: leaving or being kicked counts as no; the server's alarm ends the vote; respin limit 3 and minimum 2 restaurants     | M4 ✓       |
| R1  | Repudiation            | Preset deleted, nobody knows by whom                       | Admin audit log in D1                                                                                                                   | M5         |
| I1  | Information disclosure | Room state leaks to non-members                            | WebSocket requires team session + participant token; no room listing; tokens never sent to other clients                                | M1 ✓       |
| I4  | Information disclosure | Probing which room codes exist                             | Without a team session every room route answers 401 before any room lookup                                                              | M1 ✓       |
| I2  | Information disclosure | Stack traces or internals in responses                     | Generic error bodies; structured logs without request data                                                                              | M0         |
| I3  | Information disclosure | Secrets committed to the public repo                       | gitleaks in CI, GitHub secret scanning with push protection, `.gitignore` for env files                                                 | M0         |
| T5  | Tampering              | A restaurant link that leads to phishing or runs script    | Server-side allow-list: https Google Maps hosts and paths only, no credentials or ports; `rel="noopener noreferrer"`                    | M2 ✓       |
| T6  | Tampering              | Removing or boosting on behalf of someone else             | Identity comes from the authenticated socket, never from the message; host-or-owner check on removal                                    | M2 ✓       |
| D1  | Denial of service      | Bots exhaust the free quota                                | Team key + Turnstile + rate limits on create/join/WebSocket; 20 per room; 10 s hello timeout; message size and rate limits; hibernation | M1 ✓       |
| D2  | Denial of service      | Filling a wheel with junk, or flooding boost toggles       | 30 restaurants per room, unique names, 2 KB messages, 20 messages per 10 s per socket, host can remove anything                         | M2 ✓       |
| E1  | Elevation of privilege | Stored XSS via restaurant or participant names             | Text-only rendering enforced by lint and tests; strict character rules for names and categories; strict nonce CSP; Trusted Types        | M0, M2 ✓   |
| E2  | Elevation of privilege | Clickjacking the host's controls                           | `frame-ancestors 'none'` + `X-Frame-Options: DENY`                                                                                      | M0         |
| E3  | Elevation of privilege | Cross-site WebSocket hijacking                             | Exact `Origin` check on upgrade; no cookies at all; tokens sent explicitly                                                              | M1 ✓       |
| E4  | Elevation of privilege | Takeover of the owner's GitHub, Cloudflare or admin email  | Passkeys/hardware keys, scoped Cloudflare API token, branch protection                                                                  | M0 (setup) |

## Notes for later milestones

- **M6 (PWA):** the service worker will cache the app shell, including its
  CSP nonce. The nonce then stays the same on that device until the next
  update. Acceptable (an attacker cannot read it), but document it in the M6
  review and keep the cache scoped to this origin.
- **M1 (done):** Turnstile needs `https://challenges.cloudflare.com` in
  `script-src` and `frame-src`. It is on the whole shell, because the app is
  a single page; any script from that Cloudflare origin is allowed.
- **M2 (done):** restaurant names, categories and Maps links are user input;
  see T5, T6, D2.
- **M3 (done):** see T1 and T7. The reel order is cosmetic; a test checks
  that 1 000 spins match the odds.
- **M4 (done):** see T8 and T9. Votes are open: everyone sees who voted yes
  or no (accepted, see the M4 review).
- **M5:** admin presets and the audit log; S3 and R1.
