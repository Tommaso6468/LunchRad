# Final security assessment

Lunchrad, version 1.0 (end of M8). Date: 14 November 2026.
Assessor: Claude (development), for the owner (Tommaso). This document is
the exit criterion of M8: it is complete when the owner has accepted the
residual risks in section 5.

## 1. What Lunchrad is and what it protects

A public web app on Cloudflare Workers where a team picks a lunch place with
a shared reel. Assets, in order of importance: the integrity of the spin;
the admin capabilities (lists, team key, closing rooms); availability within
the free plan; the deploy pipeline; a little personal data (first names in
rooms for at most 30 minutes; the admin's email in the audit log). Threat
model: `docs/threat-model.md` (v9).

## 2. How it was assessed

- A lightweight SSDLC: every milestone had a threat model update, tests for
  abuse cases, CI security gates and a written review (`docs/security-reviews/M0.md`
  to `M8.md`).
- CI on every change: lint (incl. a ban on raw-HTML and eval APIs), type
  checks, 133 Worker + 32 shared + 20 app tests, CodeQL, OSV-Scanner,
  `npm audit`, dependency review, gitleaks; Actions pinned to commit SHAs.
- End-to-end tests in Chromium for every feature, with phones at 320–390 px.
- Accessibility: axe-core on every screen, light and dark: no violations.
- M8: an authenticated OWASP ZAP full scan of the real bundle (no real
  findings), 52 black-box abuse tests (all passed), a rate-limit review,
  an automated restore drill and a runbook.
- External checks by the owner on staging: Mozilla Observatory A+, ZAP
  baseline (one informational, accepted), console check in Firefox.

## 3. Controls in place

| Area                | Controls                                                                                                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Getting in          | Shared team key (or admin-set key, HMAC only stored) → HMAC-signed 90-day session bound to the key; constant-time checks; per-IP and global attempt limits; Turnstile on room creation; every room route needs the session    |
| Rooms               | Participant tokens (256-bit, hashed in storage) sent in the first socket message; exact Origin check; strict Zod schemas; 2 KB messages; 20 messages / 10 s per socket; 60 sockets and 20 people per room; 10 s hello timeout |
| Integrity of a spin | Server-only roles and result; no client input to the spin; CSPRNG with rejection sampling; list, boosts and mode locked from the lever; one vote per participant from a fixed electorate; server timers                       |
| Admin               | Cloudflare Access (email PIN) and, in the Worker, full RS256 verification of Access's token (issuer, audience, time, email allow-list); Origin + custom header + JSON for every change; every change audited atomically       |
| Browser             | Nonce-based CSP without `unsafe-*`, Trusted Types with three narrow policies, HSTS, `frame-ancestors 'none'`, COOP/CORP, no cookies of our own, text-only rendering, SRI, `noindex`                                           |
| Data                | Prepared statements only; strict character rules for every name; Maps links on an allow-list; no IPs or tokens in logs; history without people                                                                                |
| Supply chain        | Lockfile, pinned Actions, Dependabot, CodeQL, OSV, gitleaks, push protection, branch ruleset, production deploys only from release tags with your approval                                                                    |
| Operations          | Kill switch, rollback, 7-day Time Travel with a tested drill, runbook, staging before production                                                                                                                              |

## 4. Open items before launch (owner)

| Item                                                                    | Where                    |
| ----------------------------------------------------------------------- | ------------------------ |
| Turnstile + Trusted Types check in Chrome or Edge (M1 F8; Firefox done) | staging, browser console |
| Run **Security scan (staging)** once                                    | GitHub Actions           |
| Run **D1 restore drill (staging)** once                                 | GitHub Actions           |
| Real-phone check: install, sound, vibration (M6)                        | Android and iPhone       |
| Production setup and release `v1.0.0`                                   | `docs/setup.md` part 7   |

## 5. Residual risks for acceptance

Each of these is a deliberate trade-off. Tick to accept, or say which one you
want reduced.

| #   | Risk                                                                                       | Likelihood | Impact | Why it is accepted / how it is limited                                                                          | Accept |
| --- | ------------------------------------------------------------------------------------------ | ---------- | ------ | --------------------------------------------------------------------------------------------------------------- | ------ |
| R1  | Anyone with the team key can use the app: there are no personal accounts                   | Medium     | Low    | Simplicity for a lunch tool; rotate the key when someone leaves or it leaks (30 s to take effect)               | [ ]    |
| R2  | One person can join a room under several names (extra boosts and votes)                    | Low        | Low    | Needs the team key; names are visible; the host can remove people; 20 per room                                  | [ ]    |
| R3  | Votes are open: everyone sees who voted yes or no                                          | High       | Low    | Social, not security; can be made secret later                                                                  | [ ]    |
| R4  | The host can steer a room (remove yes-voters, remove restaurants)                          | Low        | Low    | Every action is visible to the room                                                                             | [ ]    |
| R5  | Whoever controls your mailbox can log into the admin panel (email PIN)                     | Low        | High   | Strong 2FA on the mailbox; admin list is one address; every admin change is logged                              | [ ]    |
| R6  | Bus factor of one: only you hold the Cloudflare, GitHub and admin access                   | Low        | Medium | The app keeps running without you; nobody can change lists or keys                                              | [ ]    |
| R7  | A determined attacker with many IPs (or a team member) can exhaust the free daily quota    | Low        | Medium | Rate limits, Turnstile, team key; kill switch and Workers Paid in the runbook; resets daily                     | [ ]    |
| R8  | Rate limits are approximate and counted per Cloudflare location                            | Medium     | Low    | Platform limitation; the global team-key limit and key strength keep guessing impractical                       | [ ]    |
| R9  | The code and commit history are public, including your email address in 13 earlier commits | Certain    | Low    | No secrets in the repo (scanned); security does not depend on hidden code; the email setting stops new exposure | [ ]    |
| R10 | Lunch history and the audit log (with admin email) are kept indefinitely                   | Certain    | Low    | No participant data; admins can delete history; audit log is the admin's own address                            | [ ]    |
| R11 | Cloudflare (hosting, Turnstile, Access) and Google (Maps links) are third parties          | Certain    | Low    | Minimal data; Maps opens only when someone taps a link; `no-referrer`                                           | [ ]    |
| R12 | Without IPs in logs, an incident can only be traced to a route and a time, not a client    | Medium     | Low    | Privacy by design (AVG); Cloudflare's own analytics still show traffic                                          | [ ]    |
| R13 | The staging scan report is a GitHub artifact anyone logged in can download                 | Certain    | Low    | It describes staging, whose code is public anyway                                                               | [ ]    |
| R14 | The offline copy of the app on a phone keeps its CSP nonce until the next online load      | Low        | Low    | Only used offline; the nonce cannot be read by an attacker                                                      | [ ]    |

## 6. Conclusion

No known vulnerabilities are open. The remaining risk is low and consists of
the trade-offs above, all chosen for a team lunch tool. Once the open items
in section 4 are done and section 5 is accepted, Lunchrad is ready to launch.
