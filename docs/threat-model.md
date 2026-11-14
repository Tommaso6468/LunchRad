# Threat model

Version 10 — M9 (14 November 2026). Update this file in every milestone that
changes the attack surface.

## Assets

| Asset                         | Why it matters                                          |
| ----------------------------- | ------------------------------------------------------- |
| Availability of the free tier | 100,000 Durable Object requests/day; abuse breaks lunch |
| Integrity of the spin         | The whole point: nobody may rig the result              |
| Admin capabilities            | Presets, team-key rotation, force-closing rooms         |
| Deploy pipeline               | Whoever deploys controls everything users run           |
| Participant names             | Personal data (AVG/GDPR), minimal but real              |
| Lunch history                 | Where the team ate and when; feeds new-place mode       |

## Trust boundaries

1. Browser ↔ Cloudflare edge (Turnstile, rate limiting, Cloudflare Access for admin)
2. Edge ↔ Worker (all validation, roles, CSP)
3. Worker ↔ Durable Object per room ↔ D1
4. GitHub ↔ Cloudflare (deploy token, CI)

## Threats (STRIDE)

| #   | Category               | Threat                                                            | Control                                                                                                                                                                                                                                                                         | Milestone  |
| --- | ---------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| S1  | Spoofing               | Outsider guesses a room code and joins                            | Team session required on join **and** WebSocket; 32^6 codes; join and WebSocket rate limits per IP                                                                                                                                                                              | M1 ✓       |
| S2  | Spoofing               | Someone joins under a colleague's name                            | Unique names per room (case-insensitive, NFC); no Latin mixed with Cyrillic or Greek (lookalikes); host kick                                                                                                                                                                    | M1 ✓, M8 ✓ |
| S4  | Spoofing               | Brute-forcing the shared team key                                 | 10 attempts/min/IP, constant-time compare, minimum length enforced, guidance for a long random key                                                                                                                                                                              | M1 ✓       |
| S3  | Spoofing               | Forged admin request                                              | Access in front of `/admin`; the Worker verifies the RS256 signature (JWKS), issuer, audience, expiry and an email allow-list; RS256 only; fails closed without config                                                                                                          | M5 ✓       |
| T1  | Tampering              | Client claims host role or sends a winner                         | Roles and winner exist only server-side; `start_spin` has no parameters; winner from `crypto.getRandomValues` with rejection sampling                                                                                                                                           | M1 ✓, M3 ✓ |
| T4  | Tampering              | Forged or replayed team session / Turnstile token                 | HMAC-signed session with expiry and key fingerprint; Turnstile verified server-side, single-use, hostname + action checked                                                                                                                                                      | M1 ✓       |
| T2  | Tampering              | Malicious code reaches production via CI                          | Actions pinned to SHAs, read-only permissions, prod only from tags on `main`, manual approval                                                                                                                                                                                   | M0         |
| T3  | Tampering              | Compromised npm dependency                                        | Lockfile, `npm audit`, signature verification, OSV-Scanner, dependency review, Dependabot, minimal dependencies                                                                                                                                                                 | M0         |
| T7  | Tampering              | Changing the odds after the lever is pulled                       | List and boosts locked server-side from `start_spin` until the room closes; reel fixed in room storage                                                                                                                                                                          | M3 ✓       |
| T8  | Tampering              | Stuffing or forging respin votes                                  | One vote per participant id from the authenticated socket; electorate fixed at vote start (connected only); latecomers refused                                                                                                                                                  | M4 ✓       |
| T9  | Tampering              | Forcing or blocking a respin by leaving, kicking or timing        | Fixed denominator: leaving or being kicked counts as no; the server's alarm ends the vote; respin limit 3 and minimum 2 restaurants                                                                                                                                             | M4 ✓       |
| T10 | Tampering              | Cross-site request forgery on the admin API via the Access cookie | Changes need the exact Origin, the `X-Lunchrad-Admin` header (forces a CORS preflight that is never answered) and a JSON body                                                                                                                                                   | M5 ✓       |
| T11 | Tampering              | SQL injection through admin input or ids                          | Prepared statements with bound parameters only; ids checked against `^[a-f0-9]{16}$`; same text rules as rooms                                                                                                                                                                  | M5 ✓       |
| T12 | Tampering              | A service worker serving stale or poisoned content                | Hand-written SW: same-origin GET only; pages network-first; `/api`, `/admin`, `/sw.js` never cached; precache list fixed at build; `sw.js` served with `no-cache` and its own CSP (`connect-src 'self'`); registration through a Trusted Types policy that allows `/sw.js` only | M6 ✓       |
| T13 | Tampering              | Faking history to steer new-place mode or the stats               | Only the room writes history, once per room (unique random ref), from its own server-side result; no client endpoint writes it; admins can delete entries (audited)                                                                                                             | M7 ✓       |
| T14 | Elevation of privilege | A big screen (or whoever has its link) acting in the room         | Display token: 256-bit, hashed, one per room, host-only to create, a new one revokes the old; a display socket may send nothing (every message refused), is never a participant or voter; still needs the team session                                                          |
| I6  | Information disclosure | The big-screen link leaking through logs or Referer               | Token in the URL fragment (never sent to a server, never in a Referer); moved to sessionStorage and removed from the address bar on load; revocable by making a new link                                                                                                        |
| I5  | Information disclosure | History revealing who ate where                                   | Rows hold restaurant, time, respins and mode only, never participants; stats need a team session                                                                                                                                                                                | M7 ✓       |
| S5  | Spoofing               | Team key leaked or ex-colleague keeps access                      | Admin rotation: server-generated 100-bit key, only an HMAC stored, every team session invalidated within 30 s                                                                                                                                                                   | M5 ✓       |
| R1  | Repudiation            | Preset deleted, nobody knows by whom                              | Every admin change and its audit row are written in one D1 batch; the team key itself is never logged                                                                                                                                                                           | M5 ✓       |
| I1  | Information disclosure | Room state leaks to non-members                                   | WebSocket requires team session + participant token; no room listing; tokens never sent to other clients                                                                                                                                                                        | M1 ✓       |
| I4  | Information disclosure | Probing which room codes exist                                    | Without a team session every room route answers 401 before any room lookup                                                                                                                                                                                                      | M1 ✓       |
| I2  | Information disclosure | Stack traces or internals in responses                            | Generic error bodies; structured logs without request data                                                                                                                                                                                                                      | M0         |
| I3  | Information disclosure | Secrets committed to the public repo                              | gitleaks in CI, GitHub secret scanning with push protection, `.gitignore` for env files                                                                                                                                                                                         | M0         |
| T5  | Tampering              | A restaurant link that leads to phishing or runs script           | Server-side allow-list: https Google Maps hosts and paths only, no credentials or ports; `rel="noopener noreferrer"`                                                                                                                                                            | M2 ✓       |
| T6  | Tampering              | Removing or boosting on behalf of someone else                    | Identity comes from the authenticated socket, never from the message; host-or-owner check on removal                                                                                                                                                                            | M2 ✓       |
| D1  | Denial of service      | Bots exhaust the free quota                                       | Team key + Turnstile + rate limits on create/join/WebSocket; 20 per room; 10 s hello timeout; message size and rate limits; hibernation                                                                                                                                         | M1 ✓       |
| D2  | Denial of service      | Filling a wheel with junk, or flooding boost toggles              | 30 restaurants per room, unique names, 2 KB messages, 20 messages per 10 s per socket, host can remove anything                                                                                                                                                                 | M2 ✓       |
| E1  | Elevation of privilege | Stored XSS via restaurant or participant names                    | Text-only rendering enforced by lint and tests; strict character rules for names and categories; strict nonce CSP; Trusted Types                                                                                                                                                | M0, M2 ✓   |
| E2  | Elevation of privilege | Clickjacking the host's controls                                  | `frame-ancestors 'none'` + `X-Frame-Options: DENY`                                                                                                                                                                                                                              | M0         |
| E3  | Elevation of privilege | Cross-site WebSocket hijacking                                    | Exact `Origin` check on upgrade; no cookies at all; tokens sent explicitly                                                                                                                                                                                                      | M1 ✓       |
| E4  | Elevation of privilege | Takeover of the owner's GitHub, Cloudflare or admin email         | Passkeys/hardware keys, scoped Cloudflare API token, branch protection                                                                                                                                                                                                          | M0 (setup) |

## Notes for later milestones

- **M9 (done):** see T14 and I6.
- **M7 (done):** see T13 and I5. New-place mode can only be switched by the
  host before the spin and is applied by the server when it builds the reel.
- **M6 (done):** see T12. The cached shell (with its nonce and matching CSP
  header) is only used when the network fails; online, every page load gets a
  fresh nonce.
- **M1 (done):** Turnstile needs `https://challenges.cloudflare.com` in
  `script-src` and `frame-src`. It is on the whole shell, because the app is
  a single page; any script from that Cloudflare origin is allowed.
- **M2 (done):** restaurant names, categories and Maps links are user input;
  see T5, T6, D2.
- **M3 (done):** see T1 and T7. The reel order is cosmetic; a test checks
  that 1 000 spins match the odds.
- **M4 (done):** see T8 and T9. Votes are open: everyone sees who voted yes
  or no (accepted, see the M4 review).
- **M5 (done):** see S3, S5, R1, T10, T11. Rooms copy their preset at
  creation, so admin changes never reach an open room. The admin's email
  account is now a key asset: its owner can log into the admin panel.
