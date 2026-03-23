#!/usr/bin/env bash
# Load R2 credentials from .dev.vars and push configs to R2
# Run from sndbrd root: ./engine-config/scripts/push-to-r2.sh [testing|dev|staging|production]...

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SNDBRD_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEV_VARS="$SNDBRD_ROOT/.dev.vars"

cd "$SNDBRD_ROOT"

# Load R2 vars from .dev.vars (R2_ACCESS_KEY, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID, R2_TOKEN)
if [[ -f "$DEV_VARS" ]]; then
  set -a
  while IFS= read -r line; do
    [[ "$line" =~ ^#.*$ ]] && continue
    [[ -z "$line" ]] && continue
    [[ "$line" =~ ^R2_ ]] || continue
    # Handle KEY=value and KEY = value
    key="${line%%=*}"
    key="${key// /}"
    val="${line#*=}"
    val="${val#\"}"
    val="${val%\"}"
    val="${val#\'}"
    val="${val%\'}"
    export "$key=$val"
  done < <(grep -E '^R2_' "$DEV_VARS" 2>/dev/null || true)
  set +a
fi

# Use R2_ACCESS_KEY as account ID fallback (convert script uses same value)
export R2_ACCOUNT_ID="${R2_ACCOUNT_ID:-$R2_ACCESS_KEY}"

# For wrangler: use R2_TOKEN as API token if set
if [[ -n "$R2_TOKEN" ]]; then
  export CLOUDFLARE_API_TOKEN="$R2_TOKEN"
  export CLOUDFLARE_ACCOUNT_ID="${R2_ACCOUNT_ID}"
fi

bun run engine-config/scripts/push-to-r2.ts "$@"
