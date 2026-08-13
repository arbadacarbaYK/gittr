#!/usr/bin/env bash
# Push a scrubbed HTML lab dashboard snapshot to the gittr host.
# Stored server-side at /opt/ngit/data/lab-snapshot/index.html (not a Nostr repo).
# Shown at https://gittr.space/lab via GET /api/lab/snapshot
#
# Usage:
#   ./scripts/push-lab-snapshot.sh <ssh_host_or_ip> [local.html]
# Env:
#   SSH_DEPLOY_KEY=~/.ssh/id_ed25519_hetzner_new
#   GITTR_LAB_REMOTE_PATH=/opt/ngit/data/lab-snapshot/index.html
#
# Example (every 30 min via cron):
#   */30 * * * * /path/to/gittr/scripts/push-lab-snapshot.sh 91.99.86.115 /tmp/lab-dashboard.html
set -euo pipefail

HOST="${1:?usage: $0 <ssh_host_or_ip> [local.html]}"
LOCAL="${2:-}"
KEY="${SSH_DEPLOY_KEY:-$HOME/.ssh/id_ed25519_hetzner_new}"
REMOTE_PATH="${GITTR_LAB_REMOTE_PATH:-/opt/ngit/data/lab-snapshot/index.html}"
REMOTE_DIR="$(dirname "$REMOTE_PATH")"
eval KEY="$KEY"

if [[ -z "$LOCAL" ]]; then
  if [[ -f "./lab-dashboard.html" ]]; then
    LOCAL="./lab-dashboard.html"
  elif [[ -f "/tmp/lab-dashboard.html" ]]; then
    LOCAL="/tmp/lab-dashboard.html"
  else
    echo "Pass a local HTML file, or create ./lab-dashboard.html" >&2
    exit 1
  fi
fi

if [[ ! -f "$LOCAL" ]]; then
  echo "Missing file: $LOCAL" >&2
  exit 1
fi

# Basic guard: refuse obvious secret-looking dumps (operator can override)
if grep -qiE 'nsec1[a-z0-9]{20,}|BEGIN (RSA |OPENSSH )?PRIVATE KEY' "$LOCAL"; then
  echo "Refusing upload: file looks like it contains private keys / nsec" >&2
  exit 1
fi

echo "📤 Pushing lab snapshot → root@$HOST:$REMOTE_PATH"
ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=30 "root@$HOST" \
  "mkdir -p '$REMOTE_DIR' && chown -R www-data:www-data '$REMOTE_DIR' 2>/dev/null || true"
scp -i "$KEY" -o BatchMode=yes -o ConnectTimeout=30 \
  "$LOCAL" "root@$HOST:$REMOTE_PATH"
ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=30 "root@$HOST" \
  "chmod 644 '$REMOTE_PATH' && chown www-data:www-data '$REMOTE_PATH' 2>/dev/null || true"

BYTES=$(wc -c <"$LOCAL" | tr -d ' ')
echo "✅ Done ($BYTES bytes). View: https://gittr.space/lab"
