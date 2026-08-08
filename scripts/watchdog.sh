#!/bin/bash
# Runs every 5 minutes via cron. Checks app health, container status, and disk
# space; auto-fixes what's safe to auto-fix (restart a down/unhealthy
# container, prune disk space); emails an alert only on a state *transition*
# (healthy -> unhealthy, or unhealthy -> resolved) so it doesn't spam every
# 5 minutes while something stays broken.
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

PROBLEMS=()

# --- App health (HTTP + DB + storage, via the app's own /api/health) ---
HEALTH_CODE=$(curl -sS -o /tmp/watchdog-health.json -w "%{http_code}" "https://${DOMAIN}/api/health" --max-time 10 || echo "000")
if [ "$HEALTH_CODE" != "200" ]; then
  PROBLEMS+=("App health check returned HTTP $HEALTH_CODE: $(cat /tmp/watchdog-health.json 2>/dev/null)")
fi

# --- Container status ---
for entry in "clipforge-app-1:app" "clipforge-caddy-1:caddy"; do
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

# --- Cron script health (catches e.g. a script silently losing its exec bit
# again on a future deploy — this exact bug shipped once already: backups,
# scheduled social posts, and Trend Radar's scheduled refresh all ran via
# cron invoking these paths directly, and none of them had +x, so every
# single run failed with "Permission denied" from day one until this was
# caught here) ---
for entry in "/var/log/clipforge-backup.log:93600:backup" "/var/log/clipforge-social.log:600:scheduled posts" "/var/log/clipforge-trend.log:14400:trend ingestion"; do
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
