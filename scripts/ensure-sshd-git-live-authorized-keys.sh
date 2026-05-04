#!/usr/bin/env bash
# Idempotent: fix sshd so user "git" reads the same authorized_keys the bridge updates.
# If sshd_config points Match User git → /etc/ssh/git-authorized_keys, that file is a
# manual copy and goes stale → pubkey never matches → SSH asks for a password.
#
# Usage: ./scripts/ensure-sshd-git-live-authorized-keys.sh <host>
# Env:   SSH_DEPLOY_KEY=~/.ssh/your_key (default: ~/.ssh/id_ed25519_hetzner_new)
set -euo pipefail
HOST="${1:?usage: $0 <ssh_host_or_ip>}"
KEY="${SSH_DEPLOY_KEY:-$HOME/.ssh/id_ed25519_hetzner_new}"
eval KEY="$KEY"

ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=20 "root@$HOST" bash -se <<'REMOTE'
set -euo pipefail
CFG=/etc/ssh/sshd_config
if [[ ! -f "$CFG" ]]; then
  echo "ensure-sshd: missing $CFG" >&2
  exit 1
fi
if grep -qF "AuthorizedKeysFile /etc/ssh/git-authorized_keys" "$CFG"; then
  cp -a "$CFG" "${CFG}.bak.ensure-$(date +%s)"
  sed -i 's|AuthorizedKeysFile /etc/ssh/git-authorized_keys|AuthorizedKeysFile /home/git-nostr/.ssh/authorized_keys|g' "$CFG"
  sshd -t
  systemctl reload ssh
  echo "ensure-sshd: Match User git now uses /home/git-nostr/.ssh/authorized_keys (reloaded ssh)"
elif grep -qF "AuthorizedKeysFile /home/git-nostr/.ssh/authorized_keys" "$CFG" && grep -q "^Match User git" "$CFG"; then
  echo "ensure-sshd: already using live authorized_keys for Match User git (ok)"
else
  echo "ensure-sshd: no stale /etc/ssh/git-authorized_keys reference found — if git@ still fails, check sshd_config manually (see docs/SETUP_INSTRUCTIONS.md)"
fi
REMOTE
