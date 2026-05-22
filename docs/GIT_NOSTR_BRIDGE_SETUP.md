# git-nostr-bridge

Watches Nostr for repo + SSH key events; maintains bare repos and `authorized_keys`. Required for `git clone` / `git push` / `git pull` against your host.

**Full stack install:** [SETUP_INSTRUCTIONS.md](SETUP_INSTRUCTIONS.md) (UI + nginx + bridge).  
**Source:** [`ui/gitnostr/`](../../ui/gitnostr/) in this repo, or clone [arbadacarbaYK/gitnostr](https://gittr.space/arbadacarbaYK/gitnostr?branch=main) — the same gitnostr project gittr runs in production.

## Security

**Never run the bridge as your normal login user.** It rewrites `~/.ssh/authorized_keys` for the service user.

Use dedicated user **`git-nostr`**.

## Build

**Go 1.21+**, **git**, **make**.

```bash
sudo useradd --create-home --shell /bin/bash git-nostr
sudo su - git-nostr
git clone git@git.gittr.space:arbadacarbaYK/gittr.git
cd gittr/ui/gitnostr
make git-nostr-bridge   # produces bin/git-nostr-bridge, bin/git-nostr-ssh
```

## Configure

Run once to create config, then Ctrl+C:

```bash
./bin/git-nostr-bridge
nano ~/.config/git-nostr/git-nostr-bridge.json
```

Production example (absolute paths):

```json
{
  "repositoryDir": "/home/git-nostr/git-nostr-repositories",
  "DbFile": "/home/git-nostr/.config/git-nostr/git-nostr-db.sqlite",
  "relays": ["wss://relay.damus.io", "wss://nos.lol"],
  "gitRepoOwners": []
}
```

- **`relays`:** match `NEXT_PUBLIC_NOSTR_RELAYS` in `ui/.env.local`.
- **`gitRepoOwners: []`:** any pubkey may create repos. Non-empty = allowlist only.
- **Relay kinds:** [NIPS_AND_EVENT_KINDS.md](NIPS_AND_EVENT_KINDS.md), [GRASP_RELAY_SETUP.md](GRASP_RELAY_SETUP.md).

## SSH

`sshd` must use `/home/git-nostr/.ssh/authorized_keys` for `git` / `git-nostr` (not a stale copy under `/etc/ssh/`). See [SSH_GIT_GUIDE.md](SSH_GIT_GUIDE.md) and `scripts/ensure-sshd-git-live-authorized-keys.sh`.

Users publish keys in **Settings → SSH Keys** (kind 52).

Push paywall (`push_cost_sats`) is enforced in bridge SQLite for GUI and SSH pushes when set.

## systemd

```ini
[Service]
User=git-nostr
WorkingDirectory=/home/git-nostr/gittr/ui/gitnostr
ExecStart=/home/git-nostr/gittr/ui/gitnostr/bin/git-nostr-bridge
Restart=always
```

```bash
sudo systemctl enable --now git-nostr-bridge
journalctl -u git-nostr-bridge -f
```

## HTTP API

Bridge serves git smart HTTP (default **:8080**) — nginx on `git.yourdomain` proxies to it. See [nginx.gittr.conf.example](../nginx.gittr.conf.example).

## Docker

`ui/gitnostr/Dockerfile` + compose — Go included in image. Bridge runs as root inside the container; read Dockerfile comments before production use.

## CLI

`make git-nostr-cli` → `gn` for publishing events from the shell (optional).

## More

- SSH/Git usage: [SSH_GIT_GUIDE.md](SSH_GIT_GUIDE.md)
- Push debugging: [BRIDGE_PUSH_DEBUGGING.md](BRIDGE_PUSH_DEBUGGING.md)
- HTTP push API: [CLI_PUSH_EXAMPLE.md](CLI_PUSH_EXAMPLE.md)
