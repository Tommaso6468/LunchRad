# Runbook

What to do when something goes wrong, in order of how likely it is. Every
step can be done from a phone browser unless it says otherwise.

Where things live:

| What                         | Where                                                                   |
| ---------------------------- | ----------------------------------------------------------------------- |
| Workers, secrets, logs       | Cloudflare → Workers & Pages → `lunchrad` / `lunchrad-staging`          |
| Database (D1)                | Cloudflare → Storage & databases → D1 → `lunchrad` / `lunchrad-staging` |
| Admin login (Access)         | Cloudflare → Zero Trust → Access controls → Applications                |
| Bot check                    | Cloudflare → Turnstile → `Lunchrad`                                     |
| Code, CI, deploy credentials | GitHub → `Tommaso6468/LunchRad` → Settings → Environments               |
| Admin panel                  | `https://<worker>/admin`                                                |

## 1. Stop everything now (kill switch)

When something is being abused and you do not know yet what:

1. Worker → **Settings → Variables and Secrets** → delete `TEAM_KEY`.
   Every room action answers 503 "nog niet klaar voor gebruik" within
   seconds; open rooms stop accepting messages. Nothing is lost.
2. Still too much traffic: Worker → **Settings → Domains & Routes** →
   switch off the `workers.dev` route. The app is then unreachable.

Undo by adding `TEAM_KEY` back (or switching the route on).

## 2. The team key leaked, or someone left the team

Admin panel → **Teamcode** → set your own key or **Willekeurige teamcode
maken**. Share the new key. Every device has to enter it; this takes effect
everywhere within 30 seconds. Open rooms keep running for the people already
in them.

## 3. Revoke an admin

1. Worker secret `ADMIN_EMAILS`: remove the address. Takes effect on the
   next request, even for someone who is logged in.
2. Zero Trust → Access controls → Applications → Lunchrad → **Policies**:
   remove the address.
3. Zero Trust → Team & Resources → **Users** → that user → **Revoke
   sessions**.
4. Admin panel → **Logboek**: check what that address did.

## 4. A secret leaked

| Secret                       | Do this                                                                                                                                                                                                           | Effect                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `SESSION_SECRET`             | New value (`openssl rand -base64 48`) in the Worker's secrets. **Then set a new team key in the admin panel at once**: the stored team key is checked with this secret, so after the change only a new key works. | Everyone has to enter the (new) team key again |
| `TURNSTILE_SECRET_KEY`       | Turnstile → Lunchrad → **Rotate secret key**; put the new one in both Workers                                                                                                                                     | None for users                                 |
| Cloudflare API token (CI)    | My Profile → API Tokens → **Roll**; put the new value in both GitHub environments (`staging`, `production`)                                                                                                       | Deploys fail until updated                     |
| `ACCESS_AUD`                 | Not a secret on its own (a token also needs Cloudflare's signature). Recreate the Access application only if Access itself is compromised                                                                         | —                                              |
| GitHub or Cloudflare account | Change password, revoke sessions, check the 2FA keys, roll the API token, check the audit logs of both, check recent deploys                                                                                      | —                                              |

## 5. A bad deploy

Worker → **Deployments** → previous version → **Rollback**. Or from a
computer: `npx wrangler rollback --env production` in `worker/`. Database
migrations only add tables or columns, so an older Worker keeps working on
a newer database.

## 6. The database needs to go back in time

D1 Time Travel keeps **7 days** on the free plan (30 on Workers Paid).

From a computer, in `worker/`:

```sh
# Bookmark for a moment before the problem (UTC):
npx wrangler d1 time-travel info lunchrad --env production --timestamp 2026-11-20T09:00:00Z
# Restore (everything written after that moment is lost):
npx wrangler d1 time-travel restore lunchrad --env production --bookmark <bookmark>
```

Practise on staging with GitHub → Actions → **D1 restore drill (staging)**
→ Run workflow. It takes a bookmark, makes a change, restores and checks.

The database holds restaurants, lists, lunch history, the audit log and the
team key's hash. Rooms are not in it; they live in Durable Objects and are
gone after 30 minutes anyway.

## 7. Free-plan quota exhausted

Symptoms: the app loads but rooms fail, or Cloudflare shows a 1027 error
page. Limits reset at **00:00 UTC** (01:00 in winter, 02:00 in summer in
the Netherlands).

| Free-plan limit (per day)                | A normal lunch for 20 people uses about |
| ---------------------------------------- | --------------------------------------- |
| Workers: 100,000 requests                | 300                                     |
| Durable Objects: 100,000 requests        | 300 (20 socket messages count as 1)     |
| D1: 5 million rows read, 100,000 written | a few hundred read, under 20 written    |

So hitting a limit means abuse or a bug, not lunch.

1. Worker → **Observability → Logs**: search for `Rate limited` (shows which
   route) and for errors.
2. Abuse: use the kill switch (1), rotate the team key (2).
3. A bug that loops: roll back (5).
4. Real growth: Workers Paid ($5/month) raises every limit.

## 8. Something looks wrong in the admin log

Admin panel → **Logboek** shows every change with the admin's email. An
entry you did not make: revoke that admin (3), rotate the team key (2),
check Zero Trust → Insights & Logs → Access for logins.

## 9. Regular checks

| When                  | What                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------- |
| Every merge           | CI is green (8 checks); staging deploy and smoke test pass                            |
| Monthly               | Merge Dependabot PRs; glance at Observability for errors and `Rate limited`           |
| Every 3 months        | Actions → **Security scan (staging)**; Actions → **D1 restore drill (staging)**       |
| Yearly (or on expiry) | Renew the Cloudflare API token; review who is in `ADMIN_EMAILS` and the Access policy |
