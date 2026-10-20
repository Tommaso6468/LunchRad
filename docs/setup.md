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
  `Lint, test, build`, `Dependency audit`, `Secret scan`, `Dependency review`,
  `Analyze (javascript-typescript)`, `Analyze (actions)`
- Require linear history

The checks only appear in the picker after they have run once on a PR.

### Security (Settings → Code security)

- Dependency graph, **Dependabot alerts** and **Dependabot security updates**: on
- **Secret scanning** and **Push protection**: on
- **Private vulnerability reporting**: on
- CodeQL: leave **default setup off**; the repo has its own workflow (`codeql.yml`)

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

## 4. Coming in later milestones

| Milestone | What you will need to do                                                                                                                                                                                                |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1        | Create a **Turnstile** widget (Cloudflare dashboard → Turnstile) for both URLs; choose the team key and store it with `wrangler secret put` (per environment).                                                          |
| M5        | Create a **D1** database per environment; set up **Cloudflare Zero Trust** (free plan), an Access application on `/admin` with an email one-time-PIN policy for your address only; add D1 permissions to the API token. |
| M7        | Run the full ZAP scan and the restore test of D1; approve the final security assessment.                                                                                                                                |
