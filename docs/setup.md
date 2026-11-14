# One-time setup (owner only)

These steps need your accounts and cannot be done from code. Do part 1 and 2
**before merging the first PR**: merging to `main` triggers a staging deploy,
which fails without the Cloudflare secrets.

## 1. Cloudflare

1. **Account**: sign up at dash.cloudflare.com with your personal email.
   Free plan is enough.
2. **Two-factor**: My Profile → Authentication → add a passkey or security key.
   Save the recovery codes offline. Do not use SMS.
3. **workers.dev subdomain**: Workers & Pages → pick your subdomain
   (for example `tommaso`). Your URLs become:
   - staging: `https://lunchrad-staging.<subdomain>.workers.dev`
   - production: `https://lunchrad.<subdomain>.workers.dev`
4. **Account ID**: Workers & Pages → right sidebar → copy **Account ID**.
5. **API token for CI**: My Profile → API Tokens → Create Token →
   template **Edit Cloudflare Workers**, then tighten it:
   - Account Resources: **Include → your account only**
   - Zone Resources: remove all (no custom domain)
   - Optional: set an expiry date (e.g. 1 year) and put a reminder in your calendar
   - Copy the token once; you cannot see it again.

Later milestones add more manual steps; they are listed in part 4.

## 2. GitHub repository settings

### Environments (Settings → Environments)

Create two environments:

| Environment  | Secrets                                         | Variable                                        | Protection                                                                      |
| ------------ | ----------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| `staging`    | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | `STAGING_URL` = staging URL from step 1.3       | Deployment branches: `main` only                                                |
| `production` | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | `PRODUCTION_URL` = production URL from step 1.3 | **Required reviewer: you**. Deployment branches and tags: tag pattern `v*` only |

Secrets go on the environment, not the repository, so only deploy jobs can read them.

### Branch protection (Settings → Rules → Rulesets → New branch ruleset)

Target `main`, enforcement **Active**:

- Restrict deletions; block force pushes
- Require a pull request before merging (required approvals: **0**: GitHub
  does not let you approve your own PR, and you are the only maintainer)
- Require status checks to pass, up to date with `main`:
  `Lint, test, build`, `Dependency audit`, `Secret scan`, `Dependency review`, `Vulnerability scan (OSV)`,
  `Analyze (javascript-typescript)`, `Analyze (actions)`
- Require linear history

The checks only appear in the picker after they have run once on a PR.

### Security (Settings → Advanced Security)

The repository is public, so these are free:

- **Dependency graph**, **Dependabot alerts**, **Dependabot security updates**: on
- **Secret Protection** (secret scanning) and **Push protection**: on
- **Private vulnerability reporting**: on
- **Code scanning → CodeQL**: leave **default setup off**; the repo has its own
  workflow (`codeql.yml`). Choosing default setup makes uploads from the workflow fail.

### Optional: local secret check

Push protection already blocks secrets GitHub recognises. For a second layer
before anything leaves your machine, install
[gitleaks](https://github.com/gitleaks/gitleaks) and run `npm run hooks:install`.

### Actions (Settings → Actions → General)

- Actions permissions: **Allow Tommaso6468, and select non-Tommaso6468, actions**:
  allow actions created by GitHub, plus `gitleaks/gitleaks-action@*`
- Fork pull request workflows: **Require approval for all external contributors**
- Workflow permissions: **Read repository contents** (default token read-only),
  and leave "Allow GitHub Actions to create and approve pull requests" off

### Your GitHub account

- Passkey or security key as 2FA, recovery codes stored offline

## 3. First deploys

1. Merge the M0 pull request. CI runs, then **Deploy staging** runs.
   Check the run's smoke test, then open the staging URL.
2. Production: Releases → Draft a new release → tag `v0.1.0` on `main` →
   Publish. Approve the deployment when GitHub asks.
3. After the first staging deploy, run an
   [OWASP ZAP baseline scan](https://www.zaproxy.org/docs/docker/baseline-scan/)
   and a check on [Mozilla Observatory](https://developer.mozilla.org/en-US/observatory)
   against the staging URL, and record the results in
   `docs/security-reviews/M0.md`. (These cannot run from the build sandbox.)

## 4. Rooms (M1): Turnstile and secrets

Without these, the app loads but every room action answers "Lunchrad is nog
niet klaar voor gebruik". Nothing runs with an insecure default.

### Turnstile widget (once)

Cloudflare dashboard → **Turnstile** → **Add widget**:

- Name: `Lunchrad`
- Hostnames: `lunchrad-staging.tommasovangelderen.workers.dev` and
  `lunchrad.tommasovangelderen.workers.dev`
- Widget mode: **Managed**. Pre-clearance: **No**.
- Copy the **site key** and the **secret key**.

### Secrets (per Worker)

Workers & Pages → `lunchrad-staging` → **Settings** → **Variables and Secrets**
→ **Add**, type **Secret**, for each of these. Secrets survive deploys.

| Name                   | Value                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `TEAM_KEY`             | What colleagues type once. At least 8 characters; better 4 random words (`kroket-fiets-wolk-zeven`). |
| `SESSION_SECRET`       | 48 random bytes: run `openssl rand -base64 48`. Different per environment. Never share it.           |
| `TURNSTILE_SECRET_KEY` | The Turnstile secret key                                                                             |
| `TURNSTILE_SITE_KEY`   | The Turnstile site key (public, but stored here so nothing needs a code change)                      |

Repeat for `lunchrad` (production) after its first release exists, with its own
`SESSION_SECRET`. Command-line alternative: `npx wrangler secret put TEAM_KEY --env staging`
in `worker/`.

**Rotating the team key** (someone left the team, or it leaked): from M5 on,
use the admin panel (part 5). Changing `TEAM_KEY` only works as long as the
key has never been rotated in the admin panel.

### Check after deploying

On staging, create a room and keep the browser console open (F12). There must
be no red "Content Security Policy" or "Trusted Types" errors around the
Turnstile check. This is the one part that could not be tested outside
Cloudflare. Then run the ZAP baseline scan (part 3) against staging.

### Local development

Copy `worker/.dev.vars.example` to `worker/.dev.vars` (Cloudflare's public test
keys, always-pass), then `npm run dev`.

## 5. Admin and presets (M5)

The admin panel lives at `/admin`. Cloudflare Access logs you in with a
one-time PIN sent to your email; the Worker checks Access's signed token
again on every admin request. Without the settings below the admin API
answers 503 and everything else keeps working.

### D1 databases (once)

Workers & Pages → **D1 SQL database** → **Create**: `lunchrad-staging` and
`lunchrad` (location Western Europe). Put their **Database IDs** in
`worker/wrangler.jsonc` (`env.staging` / `env.production` → `d1_databases`).
They are not secret. The deploy workflows apply `worker/migrations/` before
every deploy; the first migration creates the default list "Kantoor" with the
restaurants from before M5.

Add **Account → D1 → Edit** to the CI API token (My Profile → API Tokens).

### Cloudflare Access (once per environment)

1. Zero Trust → choose a team name (your team domain becomes
   `<team>.cloudflareaccess.com`), Free plan.
2. Access → Applications → **Add an application** → **Self-hosted**:
   - Name `Lunchrad beheer (staging)`, session duration 24 hours
   - Domain: the Worker's hostname, path `admin` (covers `/admin` and `/admin/api/*`)
   - Login method: **One-time PIN**
   - Policy: **Allow**, Include → **Emails** → your address only
3. Open the application and copy the **Application Audience (AUD) Tag**.
4. Worker → Settings → Variables and Secrets (type Secret):

| Name                 | Value                                                   |
| -------------------- | ------------------------------------------------------- |
| `ACCESS_TEAM_DOMAIN` | `<team>.cloudflareaccess.com`                           |
| `ACCESS_AUD`         | The AUD tag (64 characters)                             |
| `ADMIN_EMAILS`       | Your email address; more than one: separate with commas |

Repeat for production with its own Access application (`Lunchrad beheer`).
Check: `/admin` in a private window must show Cloudflare's login page, not
Lunchrad. The email account you log in with needs strong 2FA: whoever
controls it can get the one-time PIN.

### Team key from the admin panel

**Teamcode** lets you type your own key (12–64 characters, at least 6
different characters, not only digits; case and extra spaces are ignored) or
**Willekeurige teamcode maken** for a generated one (about 100 bits). Only an
HMAC of the key is stored; it lives in D1 and survives every deploy. From then on the `TEAM_KEY` secret is ignored.
Every device has to enter the new key (within 30 seconds everywhere); open
rooms keep running.

## 6. Hardening checks (M8)

- **Security scan of staging**: GitHub → Actions → **Security scan
  (staging)** → Run workflow. It runs OWASP ZAP's full scan against the
  staging URL. First allow the action: Settings → Actions → General →
  allowed actions → add `zaproxy/action-full-scan@*`. The report is a job
  artifact (visible to anyone logged in to GitHub, like the code).
- **Restore drill**: GitHub → Actions → **D1 restore drill (staging)** → Run
  workflow. Uses the existing CI token (needs D1 Edit).
- **Abuse tests** (from a computer): `npm run dev`, then
  `pip install requests websockets==13.1` and
  `python3 scripts/security/abuse.py`. Local only; it refuses other URLs.
- What to do when something goes wrong: [runbook](runbook.md).

## 7. Launch (production)

1. Worker `lunchrad` → Variables and Secrets (type Secret):
   `TEAM_KEY` (new, not the staging one), `SESSION_SECRET` (new:
   `openssl rand -base64 48`), `TURNSTILE_SECRET_KEY` and
   `TURNSTILE_SITE_KEY` (same widget; its hostnames already include
   production), `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` (from step 2),
   `ADMIN_EMAILS`.
2. Zero Trust → Access controls → Applications → **Add** → Self-hosted:
   `Lunchrad beheer`, domain `lunchrad.tommasovangelderen.workers.dev`, path
   `admin`, One-time PIN, policy Allow → your email. Copy its AUD tag.
3. GitHub → Releases → **Draft a new release** → tag `v1.0.0` on `main` →
   Publish → approve the deployment. The workflow applies the database
   migrations, deploys and runs the smoke test.
4. Check: open the production URL, enter the team key, make a room, spin
   once; open `/admin` in a private window (Cloudflare login first);
   Mozilla Observatory on the production URL.
5. Share the URL and the team key with the team.

## 8. Big screen (M9)

In a room, the host taps **Toon op groot scherm** and opens the link on the
laptop or TV in the room (or copies it there). That device enters the team
key once. Tap **Volledig scherm** once; the screen stays awake by itself
where the browser supports it. A new link stops the previous one.
