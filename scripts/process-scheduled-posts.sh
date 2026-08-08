#!/bin/bash
# Triggers the scheduled-social-post processor. Runs every few minutes via
# cron on the VPS — see OPERATIONS.md for the crontab entry.
set -euo pipefail

ENV_FILE="${ENV_FILE:-/opt/clipforge/.env}"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

curl -sS -X POST "$NEXTAUTH_URL/api/social/process-scheduled" \
  -H "x-cron-secret: $CRON_SECRET" \
  -H "Content-Type: application/json"
echo
