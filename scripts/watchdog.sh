#!/bin/bash
# Runs every 5 minutes via cron. Checks app health, container status, disk
# space, worker heartbeat freshness, queue age, job failure rate, credit/
# reservation consistency, database connection headroom, worker memory
# pressure, media-proxy server errors, and Stripe webhook failures;
# auto-fixes what's safe to auto-fix (restart a down/unhealthy container,
# prune disk space); emails an alert only on a state *transition* (healthy ->
# unhealthy, or unhealthy -> resolved) so it doesn't spam every 5 minutes
# while something stays broken. Run with --test-alert to send one real,
# clearly-labeled alert through this same path on demand.
set -uo pipefail

ENV_FILE="${ENV_FILE:-/opt/clipforge/.env}"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

COMPOSE_DIR="/opt/clipforge"
STATE_FILE="/var/lib/clipforge-watchdog.state"
LOG_PREFIX="[watchdog $(date -u +%Y-%m-%dT%H:%M:%SZ)]"
ALERT_TO="support@forgecut.app"

log() { echo "$LOG_PREFIX $*"; }

send_alert() {
  local subject="$1" body="$2"
  if [ -z "${RESEND_API_KEY:-}" ]; then
    log "RESEND_API_KEY not set, skipping alert email: $subject"
    return
  fi
  curl -sS -X POST "https://api.resend.com/emails" \
    -H "Authorization: Bearer $RESEND_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$(SUBJECT="$subject" BODY="$body" FROM="${EMAIL_FROM:-Clipforge <onboarding@resend.dev>}" TO="$ALERT_TO" python3 -c '
import json, os
print(json.dumps({
  "from": os.environ["FROM"],
  "to": os.environ["TO"],
  "subject": os.environ["SUBJECT"],
  "html": "<pre>" + os.environ["BODY"].replace("<", "&lt;").replace(">", "&gt;") + "</pre>",
}))
')" \
    --max-time 15 > /dev/null || log "alert email send failed"
}

# --test-alert: send one clearly-labeled real alert through the exact same
# path as a genuine detection (same send_alert function, same ALERT_TO, same
# RESEND_API_KEY/EMAIL_FROM) and exit, without touching the state file or
# running any real checks -- for proving delivery on demand, not for the
# 5-minute cron loop.
if [ "${1:-}" = "--test-alert" ]; then
  log "sending test alert to $ALERT_TO"
  send_alert "Clipforge watchdog: test alert ($(date -u +%Y-%m-%dT%H:%M:%SZ))" \
    "This is a manually triggered test alert confirming the watchdog's alert path (Resend, from ${EMAIL_FROM:-unset}, to $ALERT_TO) is working. No action needed."
  exit 0
fi

PROBLEMS=()

# --- App health (HTTP + DB + storage, via the app's own /api/health) ---
HEALTH_CODE=$(curl -sS -o /tmp/watchdog-health.json -w "%{http_code}" "https://${DOMAIN}/api/health" --max-time 10 || echo "000")
if [ "$HEALTH_CODE" != "200" ]; then
  PROBLEMS+=("App health check returned HTTP $HEALTH_CODE: $(cat /tmp/watchdog-health.json 2>/dev/null)")
fi

# --- Container status ---
# Includes the render worker (clipforge-worker-1) alongside app/Caddy: /api/health
# deliberately never checks the worker (a web-only health probe shouldn't fail
# just because rendering is temporarily down), so this loop is the only thing
# that would ever notice a crashed/stopped worker and both restart it and alert
# on it -- same mechanism, same alerting path as app/Caddy already use, just one
# more entry. This catches the worker being crashed or stopped; it does NOT
# catch a worker that's still running but hung (no heartbeat/lease exists yet --
# see OPERATIONS.md's render-worker section for that known, accepted gap).
for entry in "clipforge-app-1:app" "clipforge-caddy-1:caddy" "clipforge-worker-1:worker"; do
  name="${entry%%:*}"
  service="${entry##*:}"
  STATUS=$(docker inspect -f '{{.State.Status}}' "$name" 2>/dev/null || echo "missing")
  HEALTH=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name" 2>/dev/null || echo "missing")
  if [ "$STATUS" != "running" ]; then
    PROBLEMS+=("$name is not running (status: $STATUS) — restarting")
    (cd "$COMPOSE_DIR" && docker compose up -d "$service" 2>&1 | sed "s#^#$name restart: #") || true
  elif [ "$HEALTH" = "unhealthy" ]; then
    PROBLEMS+=("$name reports unhealthy — restarting")
    docker restart "$name" > /dev/null 2>&1 || true
  fi
done

# --- Database-backed checks: worker heartbeat staleness, queue age, job
# failure rate, credit/reservation consistency, connection-pool headroom.
# Run through the same throwaway postgres:18-alpine container pattern
# backup-db.sh already uses (no postgres client installed on the host) --
# one round trip, five checks, to keep this at 5-minute-cron cost. ---
DB_CHECKS=$(docker run --rm postgres:18-alpine psql "$DATABASE_URL" -tA -F'|' -c "
  SELECT
    (SELECT count(*) FROM \"WorkerRegistration\" WHERE status = 'admitted' AND \"lastHeartbeat\" < now() - interval '5 minutes'),
    (SELECT count(*) FROM \"Job\" WHERE status = 'queued'),
    (SELECT EXTRACT(EPOCH FROM (now() - MIN(\"createdAt\")))::int FROM \"Job\" WHERE status = 'queued'),
    (SELECT count(*) FROM \"Job\" WHERE status = 'failed' AND \"updatedAt\" > now() - interval '1 hour'),
    (SELECT count(*) FROM \"Job\" j JOIN \"CreditReservation\" r ON r.\"jobId\" = j.id WHERE (j.status = 'done' AND r.status = 'reserved') OR (j.status = 'failed' AND r.status = 'reserved')),
    (SELECT count(*) FROM pg_stat_activity),
    (SELECT setting::int FROM pg_settings WHERE name = 'max_connections')
" 2>/tmp/watchdog-db-error.log)

if [ -z "$DB_CHECKS" ]; then
  PROBLEMS+=("Could not run database health checks: $(tail -3 /tmp/watchdog-db-error.log 2>/dev/null)")
else
  IFS='|' read -r STALE_WORKERS QUEUE_DEPTH OLDEST_QUEUED_AGE RECENT_FAILURES CREDIT_INCONSISTENCIES DB_CONNECTIONS DB_MAX_CONNECTIONS <<< "$DB_CHECKS"

  if [ "${STALE_WORKERS:-0}" -gt 0 ]; then
    PROBLEMS+=("$STALE_WORKERS worker registration(s) marked admitted with no heartbeat in 5+ minutes -- worker may be hung, not just crashed (the container-status loop above only catches a stopped/crashed container)")
  fi

  if [ -n "${OLDEST_QUEUED_AGE:-}" ] && [ "$OLDEST_QUEUED_AGE" -gt 900 ]; then
    PROBLEMS+=("Oldest queued job is $((OLDEST_QUEUED_AGE / 60)) minutes old (queue depth: ${QUEUE_DEPTH:-?}) -- worker may not be keeping up or is stuck")
  fi

  if [ "${RECENT_FAILURES:-0}" -gt 3 ]; then
    PROBLEMS+=("$RECENT_FAILURES job failures in the last hour -- possible provider outage or systemic bug")
  fi

  if [ "${CREDIT_INCONSISTENCIES:-0}" -gt 0 ]; then
    PROBLEMS+=("$CREDIT_INCONSISTENCIES credit reservation(s) inconsistent with their job's terminal status -- the atomic capture/release guarantee may have broken")
  fi

  if [ -n "${DB_CONNECTIONS:-}" ] && [ -n "${DB_MAX_CONNECTIONS:-}" ] && [ "$DB_MAX_CONNECTIONS" -gt 0 ]; then
    DB_PCT=$(( DB_CONNECTIONS * 100 / DB_MAX_CONNECTIONS ))
    if [ "$DB_PCT" -ge 80 ]; then
      PROBLEMS+=("Database connections at ${DB_CONNECTIONS}/${DB_MAX_CONNECTIONS} (${DB_PCT}%) -- approaching exhaustion")
    fi
  fi
fi

# --- Worker memory pressure (docker-compose.yml caps the worker at 4g;
# measured real single-render peak is ~3.34GB -- alert before a render
# actually gets OOM-killed, not after) ---
WORKER_MEM_RAW=$(docker stats --no-stream --format '{{.MemUsage}}' clipforge-worker-1 2>/dev/null | awk -F'/' '{print $1}' | tr -d ' ')
if [ -n "$WORKER_MEM_RAW" ]; then
  WORKER_MEM_MB=$(python3 -c "
v = '$WORKER_MEM_RAW'.strip()
n = float(''.join(c for c in v if c.isdigit() or c=='.') or 0)
print(int(n * 1024) if 'GiB' in v else int(n))
" 2>/dev/null || echo "")
  if [ -n "$WORKER_MEM_MB" ] && [ "$WORKER_MEM_MB" -ge 3584 ]; then
    PROBLEMS+=("Worker memory at ${WORKER_MEM_MB}MiB, approaching the 4096MiB compose limit -- a render may be OOM-killed soon")
  fi
fi

# --- Media-download failures: real server errors (5xx) on the media proxy
# in the last 5 minutes. Deliberately 5xx only, not 4xx -- since the media
# authorization fix, a 4xx is often *correct* behavior (an unauthorized
# request being correctly rejected), not a failure. ---
MEDIA_5XX=$(docker logs clipforge-caddy-1 --since 5m 2>/dev/null | grep -c '"uri":"/api/media/[^"]*".*"status":5[0-9][0-9]' || true)
if [ "${MEDIA_5XX:-0}" -gt 0 ]; then
  PROBLEMS+=("$MEDIA_5XX server error(s) (5xx) on /api/media in the last 5 minutes -- possible storage/B2 connectivity issue")
fi

# --- Stripe webhook failures: a failed signature check or unhandled error
# never writes a StripeWebhookEvent row, so the signal lives in the app
# container's own logs, not the database. ---
WEBHOOK_FAILURES=$(docker logs clipforge-app-1 --since 5m 2>/dev/null | grep -ciE "stripe.*(signature verification failed|webhook.*error)" || true)
if [ "${WEBHOOK_FAILURES:-0}" -gt 0 ]; then
  PROBLEMS+=("$WEBHOOK_FAILURES Stripe webhook failure(s) logged in the last 5 minutes")
fi

# --- Cron script health (catches e.g. a script silently losing its exec bit
# again on a future deploy — this exact bug shipped once already: backups,
# scheduled social posts, and Trend Radar's scheduled refresh all ran via
# cron invoking these paths directly, and none of them had +x, so every
# single run failed with "Permission denied" from day one until this was
# caught here) ---
for entry in "/var/log/clipforge-backup.log:93600:backup" "/var/log/clipforge-social.log:600:scheduled posts" "/var/log/clipforge-trend.log:14400:trend ingestion" "/var/log/clipforge-demo-cleanup.log:93600:demo cleanup"; do
  path="${entry%%:*}"
  rest="${entry#*:}"
  max_age="${rest%%:*}"
  label="${rest##*:}"
  if [ ! -f "$path" ]; then
    PROBLEMS+=("$label log ($path) doesn't exist — cron may not be running it at all")
    continue
  fi
  age=$(( $(date +%s) - $(stat -c %Y "$path") ))
  if [ "$age" -gt "$max_age" ]; then
    PROBLEMS+=("$label log hasn't been touched in $((age / 60)) minutes (expected within $((max_age / 60))) — cron job may be failing silently")
  fi
  LAST_LINE=$(tail -1 "$path" 2>/dev/null)
  if echo "$LAST_LINE" | grep -qiE "permission denied|command not found|no such file"; then
    PROBLEMS+=("$label log's most recent run failed: $LAST_LINE")
  fi

  # Backups are the one cron job where "ran without a recognized error
  # string" isn't good enough -- a script using `set -euo pipefail` exits
  # (and stops writing to the log) the instant any step fails, including
  # failure modes this loop's blocklist above doesn't know about (a
  # Backblaze auth rejection, a network timeout, a full disk on /tmp).
  # Require this run's own positive success line instead of only screening
  # for a few known negative ones, so an unrecognized failure still trips
  # this instead of silently passing the freshness check. Only the tail is
  # checked (not the whole cumulative log) -- one success ever logged would
  # otherwise mask every subsequent failed run.
  if [ "$label" = "backup" ] && [ -f "$path" ]; then
    if ! tail -5 "$path" | grep -qF "Backed up to s3://"; then
      PROBLEMS+=("$label log's most recent run never logged a successful upload: $LAST_LINE")
    fi
  fi
done

# --- Disk space (auto-prune if over 85%) ---
DISK_PCT=$(df --output=pcent / | tail -1 | tr -dc '0-9')
if [ -n "$DISK_PCT" ] && [ "$DISK_PCT" -ge 85 ]; then
  log "disk at ${DISK_PCT}%, pruning docker images/build cache"
  docker image prune -af --filter "until=168h" > /dev/null 2>&1 || true
  docker builder prune -af --filter "until=168h" > /dev/null 2>&1 || true
  NEW_PCT=$(df --output=pcent / | tail -1 | tr -dc '0-9')
  if [ -n "$NEW_PCT" ] && [ "$NEW_PCT" -ge 90 ]; then
    PROBLEMS+=("Disk still at ${NEW_PCT}% after pruning — needs manual attention")
  fi
fi

# --- Reconcile state + alert only on transition ---
PREV_STATE="unknown"
[ -f "$STATE_FILE" ] && PREV_STATE=$(cat "$STATE_FILE")

if [ "${#PROBLEMS[@]}" -gt 0 ]; then
  CURRENT_STATE="unhealthy"
  for p in "${PROBLEMS[@]}"; do log "$p"; done
  if [ "$PREV_STATE" != "unhealthy" ]; then
    send_alert "⚠️ Clipforge: issue detected and auto-remediation attempted" \
      "$(printf '%s\n' "${PROBLEMS[@]}")"
  fi
else
  CURRENT_STATE="healthy"
  log "all checks passed"
  if [ "$PREV_STATE" = "unhealthy" ]; then
    send_alert "✅ Clipforge: back to healthy" "All checks are passing again after the earlier issue."
  fi
fi

echo "$CURRENT_STATE" > "$STATE_FILE"
