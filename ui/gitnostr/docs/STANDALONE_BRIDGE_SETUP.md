# Standalone git-nostr-bridge Setup

Run **`git-nostr-bridge`** and **`git-nostr-ssh`** on your server so any Nostr git client (including [gittr](https://github.com/arbadacarbaYK/gittr)) can use SSH git against mirrored bare repos.

## 1. Prerequisites

- **Go 1.20+** (`go.mod`; gittr stacks often use Go 1.21+)
- **Git 2.34+**
- **Linux** host with a dedicated **`git-nostr`** user (the bridge manages that user’s `authorized_keys`)

## 2. Environment variables (bridge binary)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `BRIDGE_HTTP_PORT` | optional | `8080` | HTTP **`POST /api/event`** for signed NIP-34 events. Unset = relays only. |
| `SSH_ORIGINAL_COMMAND` | set by sshd | — | Used by **`git-nostr-ssh`** during `git clone` / `push` / `pull`. |

All other behavior is controlled by **`~/.config/git-nostr/git-nostr-bridge.json`** (below).

**Deploying with gittr:** file browsing, GitHub import, and OAuth live in the **gittr Next.js app** (`GIT_NOSTR_BRIDGE_REPOS_DIR` must point at the same `repositoryDir`). See [gittr `GIT_NOSTR_BRIDGE_SETUP.md`](https://github.com/arbadacarbaYK/gittr/blob/main/docs/GIT_NOSTR_BRIDGE_SETUP.md).

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
| `relays` | yes | WebSocket URLs for repo, permission, and SSH-key events (kinds **50**, **51**, **30617**). Use the same public relays as gittr (e.g. `wss://relay.damus.io`, `wss://nos.lol`). |
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

## 5. SSH (`git-nostr-ssh`)

Install the SSH helper and point `authorized_keys` at it (see [SSH_GIT_GUIDE.md](../SSH_GIT_GUIDE.md)):

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

