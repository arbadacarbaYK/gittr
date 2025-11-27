# Standalone git-nostr-bridge Setup

This guide explains how to run the `git-nostr-bridge` binary on its own — without the gittr UI —
so that any Nostr-aware Git frontend can use it.

> 🆕 badge callout: whenever you see 🆕 below it means “this behavior exists only in this fork today”.

## 1. Prerequisites

- Go 1.21+
- Git 2.34+
- A dedicated Linux user (recommended) whose `~/.ssh/authorized_keys` the bridge may manage

## 2. Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `BRIDGE_HTTP_PORT` | optional | `8080` | Enables the fast-lane HTTP API (`/api/event`). Leave unset to disable and rely on relays only. |
| `SSH_ORIGINAL_COMMAND` | set automatically by sshd | n/a | Used only by `git-nostr-ssh` when invoked via ssh. You never set this manually. |

No other environment variables are needed for the bridge. All behavior is controlled through the JSON
config described below.

## 3. Configuration file reference

Create (or edit) `~/.config/git-nostr/git-nostr-bridge.json`:

```json
{
    "repositoryDir": "/home/git-nostr/git-nostr-repositories",
    "DbFile": "/home/git-nostr/.config/git-nostr/git-nostr-db.sqlite",
    "relays": ["wss://relay.damus.io", "wss://nos.lol"],
    "gitRepoOwners": []
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `repositoryDir` | yes | Absolute path where bare Git repositories are stored. The bridge creates the directory if missing. |
| `DbFile` | yes | SQLite file keeping Nostr event metadata and permissions. Use an absolute path. |
| `relays` | yes | List of read-only relays that emit gitnostr events (kinds 50/51/30617). The bridge reads both kind 51 (legacy) and kind 30617 (NIP-34) for backwards compatibility. Include your preferred relays or run your own. |
| `gitRepoOwners` | optional | If empty, the bridge mirrors **all** repositories it sees (“watch-all mode”). If you list pubkeys, only those authors can create repos on this bridge. |

Save the file and ensure it is readable by the bridge user only (`chmod 600` is fine).

## 4. Build + run

```bash
git clone https://github.com/arbadacarbaYK/gitnostr.git
cd gitnostr
make git-nostr-bridge git-nostr-ssh

BRIDGE_HTTP_PORT=8080 ./bin/git-nostr-bridge
```

- The binary prints `[Bridge]` log lines as it mirrors repositories and SSH keys.
- `BRIDGE_HTTP_PORT` is optional — omit it to skip the HTTP listener.
- Use `nohup` or `systemd` for long-running deployments.

## 5. SSH command handler (optional)

To serve `git clone` / `git push` over SSH, install the helper:

```bash
sudo install -o git-nostr -g git-nostr ./bin/git-nostr-ssh /usr/local/bin/git-nostr-ssh
```

In `/etc/ssh/sshd_config` add:

```
AllowUsers git-nostr
PermitUserEnvironment yes
```

The bridge will automatically rewrite `~git-nostr/.ssh/authorized_keys` based on Nostr events.

## 6. REST fast lane (optional)

When `BRIDGE_HTTP_PORT` is set, the bridge listens on `http://127.0.0.1:<port>/api/event` for signed
Nostr events (JSON). Anything you POST there is deduplicated against relay traffic and processed
immediately. Put a reverse proxy with auth/TLS in front if you expose it publicly.

## 7. Health checklist

- Logs show `relay connected:` for every relay in your config.
- `📥 [Bridge] Received event:` appears when new repositories or keys hit the relays or HTTP API.
- Repositories appear under `repositoryDir`, and `git ls-remote` works via `git-nostr-ssh`.

Need more detail? The main repository README plus `docs/gittr-enhancements.md` explain how the HTTP
fast lane, deduplication cache, and watch-all mode tie together.

