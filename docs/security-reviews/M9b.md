# Security review — saving room restaurants to lists, spin lead-in

Date: 17 November 2026.

## What changed

- `GET /admin/api/me` and `POST /admin/api/restaurants/from-room`: behind
  Cloudflare Access and the same checks as every admin call (Access JWT,
  email allow-list; Origin, `X-Lunchrad-Admin` and JSON for the change).
  The restaurant is matched by name (created when new) and its list
  membership set exactly; one D1 batch with one audit row
  (`save_from_room`, with the lists added to and removed from).
- The room shows **Opslaan in lijst** only after `/admin/api/me` succeeds on
  that device, and only asks at all on devices where the admin panel was
  opened before (a `lunchrad.admin` flag). The flag grants nothing: every
  call is checked by Access and the Worker.
- A spin now starts 1.5 s after the lever (`LIMITS.spinLeadMs`); the reel
  opens on every phone at once and closes any other open sheet first.

## Tests

- Worker (143): create when new, add to the chosen list at the end, audit
  entry; same name in other letter case does not duplicate; empty choice
  removes it from every list; unknown list 404; markup name refused; no
  admin header 403; `/me` without Access 401; lead-in elapsed time negative
  at the start; all timing tests include the lead-in.
- End-to-end: a guest never sees the button; the admin saves a restaurant a
  guest added, sees it ticked on reopening; with a guest's "add restaurant"
  sheet open, the reel still opens for them within 0.1 s; the reel lands
  ~10 s after the lever; M4, M5 and M9 suites still pass.

## Findings

| #   | Finding                                                                    | Severity | Status                                                                      |
| --- | -------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------- |
| F1  | A non-admin could set the `lunchrad.admin` flag by hand and see the button | Info     | Accepted: the button then fails like any unauthorised admin call; no access |
| F2  | The room page now also loads the small admin API client for everyone       | Info     | Accepted: client code only, no secrets; the API itself is protected         |
