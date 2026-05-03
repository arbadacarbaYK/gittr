#!/usr/bin/env bash
# Run on the git host (or any machine) as a user that can read bare repos, e.g.:
#   sudo -u git-nostr bash scripts/scan-gittr-http-pushed-repos.sh
#
# Lists owner_pubkey_hex/reponame for repos that have at least one commit authored by
# gittr's HTTP bridge push (Author email push@gittr.space). See ui/src/pages/api/nostr/repo/push.ts

set -euo pipefail
BASE="${GIT_NOSTR_REPOS:-/home/git-nostr/git-nostr-repositories}"

cd /tmp

total=0
gittr=0
while IFS= read -r -d "" gitdir; do
  total=$((total + 1))
  rel="${gitdir#"$BASE"/}"
  owner="${rel%%/*}"
  name="${rel##*/}"
  name="${name%.git}"
  if [[ ! "$owner" =~ ^[0-9a-f]{64}$ ]]; then
    continue
  fi
  if out=$(git --git-dir="$gitdir" log --all --author="push@gittr.space" -n 1 --format=%H 2>/dev/null) &&
    [[ -n "$out" ]]; then
    echo "$owner/$name"
    gittr=$((gittr + 1))
  fi
done < <(find "$BASE" -mindepth 2 -maxdepth 2 -type d -name '*.git' -print0 2>/dev/null)

echo "__STATS__ total_bare=$total gittr_http=$gittr" >&2
