#!/usr/bin/env bash
# Install hourly systemd timer for standalone platform leaderboard refresh.
# Runs scripts/refresh-platform-leaderboard.mts outside Next.js.
#
# Usage: ./scripts/install-gittr-leaderboard-timer.sh <ssh_host_or_ip>
# Env:   SSH_DEPLOY_KEY=~/.ssh/id_ed25519_hetzner_new (same as upload_to_hetzner.sh)
set -euo pipefail

HOST="${1:?usage: $0 <ssh_host_or_ip>}"
KEY="${SSH_DEPLOY_KEY:-$HOME/.ssh/id_ed25519_hetzner_new}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
eval KEY="$KEY"

for f in gittr-leaderboard-refresh.service gittr-leaderboard-refresh.timer; do
  if [[ ! -f "$REPO_ROOT/infra/systemd/$f" ]]; then
    echo "Missing $REPO_ROOT/infra/systemd/$f" >&2
    exit 1
  fi
done
if [[ ! -f "$REPO_ROOT/scripts/refresh-platform-leaderboard.mts" ]]; then
  echo "Missing $REPO_ROOT/scripts/refresh-platform-leaderboard.mts" >&2
  exit 1
fi

echo "📅 Installing gittr leaderboard refresh timer on $HOST..."
scp -i "$KEY" \
  "$REPO_ROOT/infra/systemd/gittr-leaderboard-refresh.service" \
  "$REPO_ROOT/infra/systemd/gittr-leaderboard-refresh.timer" \
  "$REPO_ROOT/scripts/refresh-platform-leaderboard.mts" \
  "root@$HOST:/tmp/"

ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=30 "root@$HOST" bash -se <<'REMOTE'
set -euo pipefail
install -d -m 0755 /opt/ngit/scripts
install -m 0644 /tmp/gittr-leaderboard-refresh.service /etc/systemd/system/
install -m 0644 /tmp/gittr-leaderboard-refresh.timer /etc/systemd/system/
install -m 0644 /tmp/refresh-platform-leaderboard.mts /opt/ngit/scripts/refresh-platform-leaderboard.mts
rm -f /tmp/gittr-leaderboard-refresh.service /tmp/gittr-leaderboard-refresh.timer /tmp/refresh-platform-leaderboard.mts
systemctl daemon-reload
systemctl enable --now gittr-leaderboard-refresh.timer
# Do not start oneshot on install — can take minutes against relays.
echo ""
systemctl status gittr-leaderboard-refresh.timer --no-pager || true
echo ""
echo "Next scheduled runs:"
systemctl list-timers gittr-leaderboard-refresh.timer --no-pager || true
REMOTE

echo "✅ Timer installed. Logs: journalctl -u gittr-leaderboard-refresh.service -f"
echo "   Builder:  /opt/ngit/scripts/refresh-platform-leaderboard.mts (own process, not Next)"
echo "   Snapshot: /opt/ngit/ui/data/platform-leaderboard-snapshot.json"
echo "   Manual:   systemctl start gittr-leaderboard-refresh.service"
