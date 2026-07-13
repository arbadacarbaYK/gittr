#!/usr/bin/env bash
# Run on the git host (or any machine) as a user that can read bare repos, e.g.:
#   sudo -u git-nostr bash scripts/scan-gittr-http-pushed-repos.sh
#
# Lists owner_pubkey_hex/reponame for repos that have at least one commit authored by
# gittr's HTTP bridge push (Author email push@gittr.space). See ui/src/pages/api/nostr/repo/push.ts
# Skips private repos (Repository.PublicRead = 0) when the bridge SQLite DB is available.

set -euo pipefail
BASE="${GIT_NOSTR_REPOS:-/home/git-nostr/git-nostr-repositories}"
DB="${GIT_NOSTR_DB:-/home/git-nostr/.config/git-nostr/git-nostr-db.sqlite}"

is_public_repo() {
  local owner="$1"
  local name="$2"
  if [[ ! -f "$DB" ]]; then
    return 0
  fi
  local pr
  pr=$(sqlite3 "$DB" "SELECT PublicRead FROM Repository WHERE OwnerPubKey='${owner}' AND RepositoryName='${name}' LIMIT 1;" 2>/dev/null || true)
  [[ "$pr" != "0" ]]
}

cd /tmp

total=0
gittr=0
skipped_private=0
while IFS= read -r -d "" gitdir; do
  total=$((total + 1))
  rel="${gitdir#"$BASE"/}"
  owner="${rel%%/*}"
  name="${rel##*/}"
  name="${name%.git}"
  if [[ ! "$owner" =~ ^[0-9a-f]{64}$ ]]; then
    continue
  fi
  if ! is_public_repo "$owner" "$name"; then
    skipped_private=$((skipped_private + 1))
    continue
  fi
  if out=$(git --git-dir="$gitdir" log --all --author="push@gittr.space" -n 1 --format=%H 2>/dev/null) &&
    [[ -n "$out" ]]; then
    echo "$owner/$name"
    gittr=$((gittr + 1))
  fi
done < <(find "$BASE" -mindepth 2 -maxdepth 2 -type d -name '*.git' -print0 2>/dev/null)

echo "__STATS__ total_bare=$total gittr_http=$gittr skipped_private=$skipped_private" >&2
