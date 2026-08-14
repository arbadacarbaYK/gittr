#!/usr/bin/env bash
# Install daily systemd timer for standalone SEO Nostr repo index refresh.
# Runs scripts/refresh-seo-repo-index.mts outside Next.js (writes disk snapshot).
#
# Usage: ./scripts/install-gittr-seo-repo-index-timer.sh <ssh_host_or_ip>
# Env:   SSH_DEPLOY_KEY=~/.ssh/id_ed25519_hetzner_new (same as upload_to_hetzner.sh)
set -euo pipefail

HOST="${1:?usage: $0 <ssh_host_or_ip>}"
KEY="${SSH_DEPLOY_KEY:-$HOME/.ssh/id_ed25519_hetzner_new}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
eval KEY="$KEY"

for f in gittr-seo-repo-index-refresh.service gittr-seo-repo-index-refresh.timer; do
  if [[ ! -f "$REPO_ROOT/infra/systemd/$f" ]]; then
    echo "Missing $REPO_ROOT/infra/systemd/$f" >&2
    exit 1
  fi
done
if [[ ! -f "$REPO_ROOT/scripts/refresh-seo-repo-index.mts" ]]; then
  echo "Missing $REPO_ROOT/scripts/refresh-seo-repo-index.mts" >&2
  exit 1
fi

echo "📅 Installing gittr SEO repo index refresh timer on $HOST..."
scp -i "$KEY" \
  "$REPO_ROOT/infra/systemd/gittr-seo-repo-index-refresh.service" \
  "$REPO_ROOT/infra/systemd/gittr-seo-repo-index-refresh.timer" \
  "$REPO_ROOT/scripts/refresh-seo-repo-index.mts" \
  "root@$HOST:/tmp/"

ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=30 "root@$HOST" bash -se <<'REMOTE'
set -euo pipefail
install -d -m 0755 /opt/ngit/scripts
install -m 0644 /tmp/gittr-seo-repo-index-refresh.service /etc/systemd/system/
install -m 0644 /tmp/gittr-seo-repo-index-refresh.timer /etc/systemd/system/
install -m 0644 /tmp/refresh-seo-repo-index.mts /opt/ngit/scripts/refresh-seo-repo-index.mts
rm -f /tmp/gittr-seo-repo-index-refresh.service /tmp/gittr-seo-repo-index-refresh.timer /tmp/refresh-seo-repo-index.mts
systemctl daemon-reload
systemctl enable --now gittr-seo-repo-index-refresh.timer
# Do not start the oneshot here — full discovery can take minutes.
# Mirror current snapshot for lab agents (cheap; no re-query).
if [[ -f /opt/ngit/ui/data/nostr-seo-repos-snapshot.json ]]; then
  mkdir -p /opt/ngit/data/lab-snapshot
  cp -a /opt/ngit/ui/data/nostr-seo-repos-snapshot.json \
    /opt/ngit/data/lab-snapshot/nostr-seo-repos-snapshot.json
  chmod 0644 /opt/ngit/data/lab-snapshot/nostr-seo-repos-snapshot.json
fi
echo ""
systemctl status gittr-seo-repo-index-refresh.timer --no-pager || true
echo ""
echo "Next scheduled runs:"
systemctl list-timers gittr-seo-repo-index-refresh.timer --no-pager || true
REMOTE

echo "✅ Timer installed. Logs: journalctl -u gittr-seo-repo-index-refresh.service -f"
echo "   Builder:      /opt/ngit/scripts/refresh-seo-repo-index.mts (own process, not Next)"
echo "   Snapshot:     /opt/ngit/ui/data/nostr-seo-repos-snapshot.json"
echo "   Lab mirror:   /opt/ngit/data/lab-snapshot/nostr-seo-repos-snapshot.json (copied after each refresh)"
echo "   Status:       curl -sS http://127.0.0.1:3000/api/seo/refresh-nostr-repo-index"
echo "   Manual run:   systemctl start gittr-seo-repo-index-refresh.service"
