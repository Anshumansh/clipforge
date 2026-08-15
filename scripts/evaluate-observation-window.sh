#!/bin/bash
# Run this from a machine with SSH access to the VPS, at or after the
# scheduled evaluation time, to summarize the real observation window.
# Usage: ./scripts/evaluate-observation-window.sh <window-start-utc> [window-end-utc]
# Example: ./scripts/evaluate-observation-window.sh "2026-08-15T14:50:00Z" "2026-08-17T14:50:00Z"
set -euo pipefail

WINDOW_START="${1:?window start UTC timestamp required, e.g. 2026-08-15T14:50:00Z}"
WINDOW_END="${2:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

echo "=== Observation window: $WINDOW_START to $WINDOW_END ==="
echo ""

ssh -i ~/.ssh/clipforge_vps root@62.238.110.10 bash -s -- "$WINDOW_START" "$WINDOW_END" <<'REMOTE'
WINDOW_START="$1"
WINDOW_END="$2"

echo "--- Watchdog log: last 30 non-routine lines (issues/recoveries), plus a routine-check count ---"
grep -E "issue detected|back to healthy" /var/log/clipforge-watchdog.log | tail -30
echo "Routine \"all checks passed\" lines in the full log: $(grep -c 'all checks passed' /var/log/clipforge-watchdog.log)"
echo "(Precise window filtering is done via the database query below, which has real timestamps to filter on -- this log excerpt is supplementary, not the authoritative count.)"

echo ""
echo "--- Container uptime / restart evidence ---"
for c in clipforge-app-1 clipforge-worker-1 clipforge-caddy-1; do
  docker inspect "$c" --format "$c: RestartCount={{.RestartCount}} StartedAt={{.State.StartedAt}}" 2>/dev/null || echo "$c: not found"
done

echo ""
echo "--- Database metrics over the window (requires DATABASE_URL from .env) ---"
export $(grep '^DATABASE_URL=' /opt/clipforge/.env | xargs -d '\n')
docker run --rm postgres:18-alpine psql "$DATABASE_URL" -c "
  SELECT
    (SELECT count(*) FROM \"Job\" WHERE \"createdAt\" BETWEEN '$WINDOW_START' AND '$WINDOW_END') AS jobs_created,
    (SELECT count(*) FROM \"Job\" WHERE status = 'done' AND \"updatedAt\" BETWEEN '$WINDOW_START' AND '$WINDOW_END') AS jobs_succeeded,
    (SELECT count(*) FROM \"Job\" WHERE status = 'failed' AND \"updatedAt\" BETWEEN '$WINDOW_START' AND '$WINDOW_END') AS jobs_failed,
    (SELECT count(*) FROM \"Job\" WHERE status = 'dead_letter' AND \"updatedAt\" BETWEEN '$WINDOW_START' AND '$WINDOW_END') AS jobs_dead_lettered,
    (SELECT count(*) FROM \"Job\" WHERE status = 'queued' AND \"attemptCount\" > 0 AND \"updatedAt\" BETWEEN '$WINDOW_START' AND '$WINDOW_END') AS lease_retries,
    (SELECT count(*) FROM \"Job\" j JOIN \"CreditReservation\" r ON r.\"jobId\" = j.id WHERE (j.status = 'done' AND r.status = 'reserved') OR (j.status = 'failed' AND r.status = 'reserved')) AS credit_inconsistencies_now,
    (SELECT count(*) FROM \"StripeWebhookEvent\" WHERE \"processedAt\" BETWEEN '$WINDOW_START' AND '$WINDOW_END') AS stripe_webhooks_processed;
"

echo ""
echo "--- Current resource usage ---"
docker stats --no-stream --format '{{.Name}}: {{.MemUsage}} CPU={{.CPUPerc}}'
REMOTE
