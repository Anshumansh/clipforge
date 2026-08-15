# Clipforge — Monitoring Activation Record

**Approved by:** Anshumansh, via GitHub Actions required-reviewer approval on run
`31891108061`, confirmed both by the API (`waiting` → `in_progress`, a real
external state change) and directly in chat.
**Deployed commit:** `50bb41ea083e7d26adab27d43c77f986197805a6`
**Deploy job completed:** `2026-08-15T15:16:59Z`

---

## Post-approval checklist

1. **Deployment completed successfully** — `gh run view 31891108061`:
   `status=completed conclusion=success`.
2. **Health verified**: `https://forgecut.app/api/health` → `200
   {"status":"ok","checks":{"database":true,"storage":true}}`. All three
   containers `running`/`healthy`, `RestartCount=0` on each. Worker log clean:
   admission granted, polling started.
3. **Monitoring script run in normal mode** (not test mode) against the live
   deployed file: `all checks passed`. Confirmed 17 markers of the new check
   logic present in the deployed script (vs. the pre-deploy version), so this
   was genuinely the new code running, not a stale copy.
4. **Test alert triggered** via the real deployed script's `--test-alert`
   flag (not a temporary copy this time — the actual production file).
5. **Delivery verified** independently via Resend's own send-log API:
   `"Clipforge watchdog: test alert (2026-08-15T15:18:09Z)" | delivered`.
6. **All nine conditions confirmed individually present** in the live,
   cron-scheduled file (`crontab -l` still shows `*/5 * * * *
   .../watchdog.sh`, unchanged): app health, container/worker disappearance,
   worker-heartbeat staleness (hang detection), queue age, job-failure spike,
   credit inconsistency, database-connection exhaustion, worker memory
   pressure, media-proxy 5xx errors, Stripe webhook failures.
7. **No secret values in logs**: pattern-scanned the *entire* watchdog log
   history (2,269 lines, full retention) and this deployment's own CI logs —
   zero matches.
8. **Recorded above** — commit and run ID.
9. **No further changes made** during this activation — confirmed via `git
   log`: zero commits since the prior closure report.

---

## Credential revocation — honest status, not assumed

Checked what's actually checkable by identifier, not value, rather than
either claiming full verification or refusing to look:

| Provider | What I could check | Result |
|---|---|---|
| **Resend** | `GET /api-keys` — a real identifier-listing endpoint | Exactly **one** key on the account: id `05d5788a...`, name `CLIPFORGE`, **`created_at: 2026-08-07`** (predates this whole incident), `last_used_at`: just now. **This does not confirm the underlying secret value was actually changed** — Resend's key record can plausibly be "regenerated" (same id, new secret) or the same value could simply still be in place; the metadata available to me can't distinguish those. Worth your direct confirmation in the Resend dashboard: did you regenerate this key, or reconfirm the existing one? |
| **Stripe** | No general "list my secret keys" endpoint exists for a standard account's own keys (confirmed by trying `/v1/account`, which returns account metadata only, nothing key-specific) | **Cannot verify via API.** Owner action: confirm in Stripe Dashboard → Developers → API keys that the pre-rotation key shows as rolled/revoked. |
| **Groq** | Tried `/openai/v1/api_keys` | `404 unknown_url` — **no such endpoint exists.** Owner action: confirm in the Groq console's API Keys page. |
| **YouTube / Google Cloud** | API keys are managed via Google's Cloud Resource Manager, which requires OAuth/service-account credentials with IAM permissions — the API key itself cannot query its own or siblings' metadata, by design | **Cannot verify via API.** Owner action: confirm in Google Cloud Console → APIs & Services → Credentials that the old key shows deleted/restricted.

**Not claiming rotation-and-revocation complete for any of the four** — the
*new* credentials are confirmed working (previous report), but *old-credential
revocation* is listed here as an owner action for all four, with Resend singled
out as needing a specific yes/no on whether the value itself actually changed.

---

## Official 48-hour observation window (revised per your instruction)

Per your instruction to use the actual operational timestamp rather than the
earlier snapshot time:

**Start:** `2026-08-15T15:16:59Z` (the monitoring deployment's actual completion time)
**Do not claim completion before:** `2026-08-17T15:16:59Z`

Evaluation command (unchanged mechanism, updated start time):
```bash
./scripts/evaluate-observation-window.sh "2026-08-15T15:16:59Z"
```

No further changes will be made during this window unless a genuine P0/P1
incident occurs, per your instruction and the emergency-bypass policy already
in the runbook.
