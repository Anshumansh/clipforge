#!/bin/bash
# Reverts any admin-granted trial (plan comp) whose expiry has passed back to
# the user's real prior plan. Runs daily via cron on the VPS — see
# OPERATIONS.md for the crontab entry.
set -euo pipefail

ENV_FILE="${ENV_FILE:-/opt/clipforge/.env}"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

curl -sS -X POST "$NEXTAUTH_URL/api/cron/revert-expired-comps" \
  -H "x-cron-secret: $CRON_SECRET" \
  -H "Content-Type: application/json"
echo
