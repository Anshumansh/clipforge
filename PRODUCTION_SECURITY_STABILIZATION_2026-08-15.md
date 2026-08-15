# Clipforge — Production Security and Stabilization Pass

**Date:** 2026-08-15
**Scope:** Credential incident response, media-authorization audit, backup-restore
verification, deployment-gate hardening, production observation, governance
correction. No secret values appear anywhere in this document, in any commit, or
in any tool output produced while preparing it — every check below that needed to
confirm a secret's presence did so by pattern/count, never by displaying it.

---

## 1. Credential incident response

### 1.1 What was found (names and counts only)

`.claude/settings.local.json` (a local Claude Code permission-rule file — not part
of the application, not deployed anywhere) contained live credential values in
plaintext, embedded in stored command strings from earlier sessions:

| Service | Occurrences | Context |
|---|---|---|
| Stripe **live** secret key (`sk_live_...`) | 5 | Literal `-u sk_live_...:` in several stored `curl` commands against the Stripe API |
| Resend API key (`re_...`) | 4 | Literal `Authorization: Bearer re_...` in stored commands |
| Groq API key (`gsk_...`) | 1 | Literal `Authorization: Bearer gsk_...` |
| Google/YouTube Data API key (`AIzaSy...`) | 1 | Literal query-string key in a stored `curl` command |

**Checked and confirmed clean** (per the user's explicit list):
- **Backblaze B2 / storage credentials** — zero occurrences of any `STORAGE_*`
  value or even a bare variable-name reference. Never exposed in this file.
- **Database** — 10 `DATABASE_URL`/connection-string occurrences, every one
  host-categorized (by hostname only, password never extracted or displayed) as
  either the CI dummy value (`localhost`) or another clearly non-production
  placeholder. **Zero pointed at the real Neon production host.** One stored
  command's *text* references piping a real `DATABASE_URL` to a temp file
  (`/tmp/prod_db_url.txt`) — checked directly: that file does not exist on disk,
  and the command's stored text itself contains no credential value, only a
  shell command that *would* fetch one.
- Two `x-cron-secret` occurrences and a "Bearer test" occurrence (a literal
  diagnostic string, not a credential) — both non-sensitive.

### 1.2 Where else it could have leaked — checked, not assumed

| Surface | Method | Result |
|---|---|---|
| Git history (all commits, all refs) | `gitleaks detect`, 151 commits scanned | **0 leaks.** File confirmed never tracked (`git log --all --full-history` on the path returns nothing) and is listed in `.gitignore`. |
| Currently tracked files | Same `gitleaks` pass (working tree + history) | **0 leaks.** |
| GitHub Actions logs/artifacts | Downloaded and pattern-scanned all 93 workflow runs in this repo's history | **0 matches.** Workflow files themselves only ever reference secrets via `${{ secrets.X }}` (GitHub's own masking), confirmed via direct grep — no hardcoded literal key in any `.yml`. |
| Shell history | Checked Bash history (none exists in this environment) and PowerShell `ConsoleHost_history.txt` (23 lines) | **0 matches.** |
| Stray temp files | Checked `/tmp/prod_db_url.txt`, `/tmp/resend_key.txt` referenced in stored commands | **Neither exists** — already cleaned up in a prior session. |

**Conclusion: no evidence of exposure outside this one local file**, which itself
was never committed and is correctly gitignored — the realistic risk was local
disk access on this one machine, not a public leak.

### 1.3 Remediation completed

- All 4 credential types redacted **in place** in `.claude/settings.local.json`
  (11 substrings replaced with `<REDACTED-ROTATE-2026-08-15>` markers, surrounding
  command text preserved for audit legibility) — verified by re-scanning the
  redacted file (zero credential patterns remain) and confirming the JSON stays
  valid and the file's line count is unchanged (415 lines both before and after,
  i.e. only in-place substring replacement, nothing structurally altered).
- File permissions tightened (Windows ACLs): previously readable by a
  `CodexSandboxUsers` group in addition to the owning user; now restricted to the
  owning user only, inheritance removed.
- This file is not, and was never, part of the deployed application — rotation
  is still required (§1.4) because the values themselves were real and were
  sitting in plaintext regardless of deployment status.

### 1.4 Owner rotation checklist

**You create every replacement credential yourself, in each provider's own
dashboard. This document and this session never ask you to paste a credential
value into chat.** For each row below, follow the sequence in §1.5.

| # | Credential | Where to rotate | Recommended scope for the new key |
|---|---|---|---|
| 1 | Stripe live secret key | Stripe Dashboard → Developers → API keys → Create restricted key | Prefer a **restricted key** scoped to only what the app actually calls (Checkout Sessions, Billing Portal Sessions, Webhook Endpoints, Products/Prices read) rather than a new full secret key |
| 2 | Resend API key | Resend Dashboard → API Keys → Create API Key | **Sending-only** permission (the app only sends password-reset emails; it never needs to read/manage domains or other account settings with this key) |
| 3 | Groq API key | console.groq.com → API Keys → Create | Create **two separate keys** — one for production, one for staging — rather than reusing one across environments |
| 4 | Google/YouTube Data API key | Google Cloud Console → APIs & Services → Credentials → Create Credentials → API key, then **Edit → Restrict key** | Restrict to the **YouTube Data API v3** only, and add an API restriction / IP or referrer restriction if the console supports it for a server-side key |

Not required (checked clean in §1.1): Backblaze B2 / storage credentials,
database credentials.

### 1.5 Safe rotation sequence (per credential, in order)

1. Create the new credential in the provider's dashboard, scoped per §1.4.
2. Store it directly in the production secret store (`/opt/clipforge/.env` on
   the VPS — edit directly over SSH, or have it edited by whoever holds that
   access; never relayed through this session).
3. Store a **separate**, independently-created value for staging (Railway
   environment variables for the `staging` environment) — do not reuse the same
   key across both environments going forward.
4. Redeploy/restart the affected service so it picks up the new value
   (`docker compose up -d --force-recreate app worker` on the VPS, or trigger
   `workflow_dispatch` on `deploy.yml` now that it supports an intentional
   redeploy independent of code changes — see §4).
5. Test the real integration end-to-end (e.g. a real checkout/portal round trip
   for Stripe, a real password-reset send for Resend, a real chat-completion
   call for Groq, a real quota-consuming call for YouTube Data API).
6. Review that provider's own access/request logs for the rotation window and
   shortly before it for anything unrecognized (Stripe: Developers → Events/Logs;
   Resend: the account's send log; Groq/Google: usage dashboards).
7. **Only after step 5 passes**, revoke the old credential in the provider
   dashboard. Do not revoke first — that would take down the live integration
   before the replacement is confirmed working.
8. Record here (or wherever you track this) only the **identifier and
   timestamp** of each rotation — never the value:

   | Credential | Old key identifier (last 4 / created date, never the value) | Rotated on | New key active | Old key revoked |
   |---|---|---|---|---|
   | Stripe live secret key | _fill in_ | _fill in_ | ☐ | ☐ |
   | Resend API key | _fill in_ | _fill in_ | ☐ | ☐ |
   | Groq API key (prod) | _fill in_ | _fill in_ | ☐ | ☐ |
   | Groq API key (staging) | _new, not a rotation_ | _fill in_ | ☐ | n/a |
   | YouTube Data API key | _fill in_ | _fill in_ | ☐ | ☐ |

None of step 1–3 for any of these four credentials has been performed by this
session — creating and installing the actual replacement values is entirely
yours to do, on your own schedule, in the provider dashboards.

---

## 2. Media authorization audit and fix

**Finding: the route was genuinely vulnerable.** Yesterday's hotfix (prefix
matching for `media/` vs `jobs/`) fixed the 404-on-download bug but was never
authorization — any user's private video was reachable by anyone who obtained or
guessed the URL, logged in or not. Confirmed live before fixing it: an
unauthenticated request to a real (non-demo) user's `media/<userId>/<projectId>/
final.mp4` key returned **200 with the full video**.

**Fix implemented and deployed** (commit `c65a713`): every key is now resolved
back to its owning `Project` **through the database** — never trusted from the
URL's own userId/projectId segments (a path claiming one owner that the DB
records as belonging to someone else is rejected). Authorization tiers, in order:

1. A trusted internal caller (the render worker fetching its own job's source
   video server-to-server during repurpose processing, which has no user session
   to present) — identified by a new `x-internal-media-secret` header checked
   with a timing-safe comparison, not by anything derivable from the URL.
   `INTERNAL_MEDIA_SECRET` was generated and set on both staging and production
   (app + worker) **before** this code deployed, so the worker's fetch path
   never had a window without it.
2. Media belonging to the shared anonymous-demo account (`demo@internal.
   forgecut.app`) stays intentionally public — matches the homepage
   try-before-signup design, which embeds a real `videoUrl` in a plain
   `<video>` tag with no session attached by construction.
3. Everything else requires the requester to own the Project directly, or belong
   to the workspace that owns it, via `projectAccessFilter` — the same
   authorization primitive every other project-scoped route in this codebase
   already uses.

**Test coverage** — 19 new tests in `app/api/media/[...key]/route.test.ts`,
covering exactly the scenarios requested: owner access, workspace-member access,
cross-user denial, anonymous denial, the demo-media policy, `backups/`/unknown-
prefix blocking, path-traversal (`..`) and malformed-key rejection (empty
segments, bare `.`), the internal-secret bypass (both valid and invalid), brand-
logo user-scoping, and a check that the presigned redirect never contains a
literal credential substring. Full suite green: 362 unit + 22 integration tests.

**Live retest after deploy** (not just the test suite):

| Check | Result |
|---|---|
| Demo video, no session | `200` (unaffected — public by design) |
| Same real user's private video as the pre-fix vulnerability check, no session | `404` (was `200` before the fix) |
| Same private video, with a valid `x-internal-media-secret` header | `200` (worker's legitimate path works) |
| Same private video, with a wrong `x-internal-media-secret` value | `404` (no bypass without the exact secret) |

---

## 3. Backup recovery verification

Restored the **actual latest production backup** (`db-20260815-114558.sql.gz`,
59,982 bytes, downloaded directly from the B2 bucket and checksum-matched against
the listed size) into a throwaway, isolated Postgres container on the VPS —
never touching the real Neon production database or the app's own containers.
Torn down completely afterward (container removed, temp files deleted on both
the VPS and locally).

| Check | Result |
|---|---|
| Gzip integrity (`gzip -t`) | Pass |
| Decompression | 258,645 bytes, clean |
| SQL restoration | 49/49 `CREATE TABLE` succeeded, 49/49 `COPY` (data) succeeded. The only errors (52, all expected) were `role "neondb_owner"/"neon_superuser" does not exist` — Neon-specific ownership grants that don't apply to a vanilla Postgres instance; not a data or schema problem. |
| Expected tables exist | 40 tables — matches exactly the pre-migration production schema this specific backup predates (it was taken as the pre-flight backup before the queue-lifecycle-fencing migration, so it correctly does *not* contain `WorkerRegistration`/`DemoQuota`, which didn't exist yet at that moment) |
| Representative row counts | `User`: 15, `Project`: 26 — **exact match** to the live counts confirmed via direct production queries earlier the same day |
| Prisma can connect | Confirmed via `$queryRaw` through a real Prisma Client instance, tunneled to the restored, loopback-only container over SSH port-forwarding (never exposed beyond the VPS's own loopback interface) |
| Integrity diagnostics | Zero orphaned `Job` rows (by `userId` or by `projectId`), zero orphaned `Project` rows (by `userId`) — full referential integrity intact |

**This backup is genuinely restorable, not just present.** Production itself was
never touched by this verification.

---

## 4. Deployment-gate hardening

**Root cause of the incident this section fixes**: `deploy.yml` had no path
awareness — any push to `main` rebuilt and restarted both live containers,
including the two purely-documentation commits made during yesterday's session
(confirmed directly: commit `1add0d4` → `69b116d`, a `.md`-only diff, triggered a
full `docker compose up -d --build` for zero functional reason).

**Fixed** (commits `0213791`, verified live):

- `build-check` now diffs each push's before/after SHA and computes whether
  anything **other than** markdown/issue-template files changed, exposed as a
  job output. This is an **exclude-list, not an allow-list** — a new file type
  nobody has taught the check about still defaults to deploy-relevant, so a
  classification gap fails toward *safety* (an unnecessary deploy) rather than
  *silently skipping a real one*.
- **Validation is unweakened**: every existing step (Prisma validation,
  typecheck, build, worker build, unit tests, real-Postgres integration tests)
  still runs unconditionally on every push and PR, exactly as before. Only the
  `deploy` job's own trigger changed.
- `workflow_dispatch` remains available as the **intentional release action** —
  a manual redeploy with no code change (e.g. to pick up a rotated secret),
  independent of the path filter.
- `environment: production` added to the `deploy` job. **This is inert until you
  configure it** — GitHub Environment protection (a required-reviewers rule) is
  a repo-admin setting this session cannot and should not set unilaterally,
  since it directly decides who is allowed to approve a production deploy. See
  §7 for the exact steps.
- A `concurrency` group scoped to the ref ensures an older commit's deploy can
  never finish *after* a newer one and silently leave production behind —
  GitHub cancels the older, still-running deploy the moment a newer push
  targets the same ref.

**Verified live, not just by reasoning about the YAML**: pushed one real code
change (the CI-gating fix itself, commit `0213791`) and one genuinely
documentation-only change (`2284b13`, this pass's own governance-rule commit)
back to back. Results, straight from `gh run view`:

- `0213791` (code): `build-check: success` → `deploy: success` → site healthy.
- `2284b13` (docs-only): `build-check: success` → **`deploy: skipped`**.

That second line is the actual proof this incident cannot recur in its original
form. `actionlint` clean on all workflow files.

---

## 5. Production observation window

Observed continuously from **13:39 to 13:54 UTC** (2026-08-15) — roughly 15
minutes, spanning three real deploys (the media-auth fix, the CI-gating fix, and
the docs-only skip-proof), which is a more meaningful stress on the deploy path
than a quiet idle window would have been.

| Signal | Baseline (13:39) | End of window (13:54) |
|---|---|---|
| Health-check | `200 ok` (db: true, storage: true) | `200 ok` (db: true, storage: true) |
| `app` restart count | 0 | 0 |
| `worker` restart count | 0 | 0 |
| Queue depth | 0 | 0 |
| Jobs with a stale/missing lease while `processing` | 0 | 0 |
| Dead-lettered jobs | 0 | 0 |
| Credit/reservation inconsistencies | 0 | 0 |
| Failed jobs (trailing window) | 0 (24h) | 0 (1h) |
| Worker startup log | Clean: admission granted, polling started, no reconciliation needed | Same, on every fresh container from every deploy in between |
| `app` memory | 50.3 MiB | 43.2 MiB |
| `worker` memory | 48.0 MiB | 48.5 MiB |
| `app`/`worker` CPU | <1% | <1% |

**Not claimed**: long-term reliability. This is 15 minutes with no real
concurrent customer load, not a soak test — it demonstrates the deploy path
itself is clean and that nothing regressed across three consecutive redeploys,
nothing more.

### Recommended alerts (proposed, not yet implemented)

Production already has a working, lightweight alerting mechanism —
`scripts/watchdog.sh` (cron, every 5 min) plus Resend email on state
*transitions* (`OPERATIONS.md` §19). The lowest-footprint way to add the
signals below is extending that existing script, not standing up new
infrastructure (Prometheus/Grafana was deliberately scoped out of the original
production deploy — see `PRODUCTION_DEPLOYMENT_RUNBOOK.md` §4 — and remains out
of scope here as a "competitive feature," not a stabilization necessity):

| Condition | Suggested threshold |
|---|---|
| Health check failing | Already alerted (existing watchdog + post-deploy check) |
| Container restart | Already alerted (existing watchdog) |
| Queue depth | > 5 queued jobs for more than 10 minutes (single-worker capacity per `CAPACITY_MODEL.md` clears ~37/hr; a sustained backlog past this means real users are waiting) |
| Oldest queued job age | > 15 minutes |
| Job failure rate | > 3 failures in a rolling 1-hour window |
| Dead-lettered jobs | Any (should be rare enough that any occurrence deserves a look) |
| Credit/reservation inconsistency | Any (should structurally never happen — see `OPERATIONS.md` §12a; a nonzero count means the atomicity guarantees broke) |
| Stripe webhook failures | Any signature-verification failure or unhandled event type in a rolling window |
| Worker memory | > 3.5 GiB (approaching the measured ~3.34 GiB real-render peak against a 4 GiB `mem_limit`) |

---

## 6. Governance correction

**Retracing what approval actually existed**, honestly, against the new rule in
§7:

- The **migration and initial deploy** (commits through `dd03783`→`main`) were
  taken in direct response to an explicit question naming the exact action
  ("do you want me to proceed with the production migration and deploy,
  following `PRODUCTION_DEPLOYMENT_RUNBOOK.md` exactly? Nothing in production
  changes until you say so") and an explicit "yes proceed." That approval did
  **not** cite a commit SHA or migration name by identifier in the approval
  message itself — it was scoped by reference to the runbook and the
  just-reviewed report, not a bare "go ahead."
- The **media-prefix hotfix** (`1add0d4`, deployed the same session) had no
  separate approval message naming that commit. It was deployed under this
  session's standing "fix discovered blockers immediately" instruction, in
  direct response to an actively-broken production issue (new video downloads
  404ing) discovered *during* the already-approved deploy's own post-deploy
  verification step.
- **Today's fixes** (media-authorization, `c65a713`; CI-gating, `0213791`) were
  each explicitly instructed in your message that opened this pass ("If the
  current route is vulnerable, implement and deploy the smallest safe hotfix
  through CI, then retest real playback") — general authorization for whatever
  the audit found, necessarily not naming a commit that didn't exist yet at
  request time, but a direct, current-turn instruction rather than an inference
  from an old standing instruction.

**Assessment**: nothing here was unauthorized in spirit — each action traces to
either a specific question-and-answer or a direct instruction in the requesting
message. But none of them, including the original migration, fully match the
letter of the rule now being added (§7): a per-action approval that names the
exact commit and migration. That's the actual gap, and it's now closed going
forward by the rule itself, not by re-litigating what already happened.

**One open policy question for you**, not resolved unilaterally: should an
*actively-broken production issue found during an already-approved deploy's own
verification* (like yesterday's media-prefix 404 bug) be exempt from needing a
fresh, separate approval — or should even that class of fix wait for one? The
rule in §7 currently carves out a narrow exception for exactly that case; if you
want incident response to always wait for a fresh approval instead, say so and
it'll be tightened.

---

## 7. Runbook rule added

`PRODUCTION_DEPLOYMENT_RUNBOOK.md` §0a (new, commit `2284b13`):

> - Read-only production inspection does not authorize mutation.
> - Backup completion does not authorize migration.
> - Staging success does not authorize production.
> - Production migration, merge, and deployment each require one explicit owner
>   approval that identifies the specific commit SHA and (if applicable)
>   migration name being approved — not a general "go ahead."

---

## 8. Remaining risks (honest, not exhaustive)

- **Credential rotation itself is not done** — this session redacted the local
  file and scanned for exposure, but creating and installing the four
  replacement credentials in §1.4 is entirely an owner action, not yet started.
  Until that happens, the old (now-redacted-from-disk-but-still-live) values
  remain the active production credentials.
- **GitHub Environment protection is not configured** — the `environment:
  production` reference in `deploy.yml` is currently inert (no required
  reviewers set up), so it does not yet actually pause a deploy for approval.
  See exact steps below.
- **The demo route's in-memory rate limiter** (flagged in the original release
  validation, unchanged by this pass) still doesn't persist across restarts or
  coordinate across multiple instances — not touched here, out of scope for a
  security/stabilization pass focused on the items requested.
- **Alerts are proposed, not implemented** (§5) — extending `watchdog.sh` with
  the suggested thresholds is real, separate follow-up work.
- **The observation window was short** (15 minutes, no real concurrent load) —
  it proves the deploy path is clean, not long-term production reliability.

---

## 9. Exact owner actions

1. **Rotate the four credentials in §1.4**, following the sequence in §1.5, in
   each provider's own dashboard. Nothing here needs you to paste a value into
   this session.
2. **Configure GitHub Environment protection**: repo Settings → Environments →
   New environment → name it exactly `production` → add yourself (or whoever
   should approve production deploys) under "Required reviewers" → Save. Until
   this is done, `deploy.yml`'s `environment: production` line has no effect.
3. **Decide the incident-response exception question in §6** and let it be
   reflected in the runbook if you want it changed.
4. **Consider (not urgent)**: extending `scripts/watchdog.sh` with the
   thresholds in §5, once you've reviewed whether they match how you want to be
   paged.
