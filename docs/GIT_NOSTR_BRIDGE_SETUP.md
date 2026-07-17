# git-nostr-bridge

Watches Nostr for repo + SSH key events; maintains bare repos and `authorized_keys`. Required for `git clone` / `git push` / `git pull` against your host.

**Full stack install:** [SETUP_INSTRUCTIONS.md](SETUP_INSTRUCTIONS.md) (UI + nginx + bridge).  
**Source:** [`ui/gitnostr/`](../../ui/gitnostr/) in this repo, or clone [arbadacarbaYK/gitnostr](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gitnostr?branch=main) — the same gitnostr project gittr runs in production.

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

Bridge serves an optional HTTP listener (default **:8080**) for **`POST /api/event`** — nginx on `git.yourdomain` proxies to it for fast event injection. See [nginx.gittr.conf.example](../nginx.gittr.conf.example).

**HTTPS smart git** (`git clone https://git.yourdomain/...`) uses `git-http-backend` via fcgiwrap. Private repos are gated by nginx `auth_request` to the Next.js endpoint `/api/git/http-auth`, which mirrors SSH ACL (owner + `RepositoryPermission`). Authorized users can pass `X-Nostr-Auth-Event` (same header as bridge API pushes) via `git -c http.extraHeader=...`.

### Browser clients (gitworkshop)

Newest gitworkshop lives on Nostr (`ngit clone nostr://danconwaydev.com/relay.ngit.dev/gitworkshop`). It uses vendored **git-natural-api** (not npm isomorphic-git) over smart HTTP, with optional fallback through `https://cors.isomorphic-git.org`.

CLI `git ls-remote` working is **not** enough. Browser clients also need:

1. **CORS** on `GET …/info/refs` and `POST …/git-upload-pack`. Reflect the request `Origin` (not only `*`). Current gitworkshop does **not** send `credentials: "include"` for fetch, but reflecting Origin remains correct.
2. **`uploadpack.allowFilter=true`** on every bare repo (and preferably `git config --system`). gitworkshop’s tree explorer **requires** the advertised `filter` capability; without it, info/refs succeeds but the UI shows **“upload-pack failed”** / “Couldn't fetch the code”. Also set `uploadpack.allowAnySHA1InWant` + `allowReachableSHA1InWant`. Bridge `ensureUploadPackBrowserCaps` applies this on new repos.
3. **Quiet `git-http-backend`** — progress on stderr through fcgiwrap corrupts the HTTP response; use a wrapper that redirects stderr (prod: `/usr/local/bin/git-http-backend-quiet`).
4. **Prefer HTTP/1.1 on the git vhost** (`listen 443 ssl;` without `http2`) — large packs have failed mid-stream over HTTP/2 for some clients.
5. **NIP-34 `clone` tags must be full repo URLs** (`https://git…/<npub>/<repo>.git`). A host-only value like `https://git.gittr.space` makes gitworkshop show “proxy error” even when the bare repo exists and `uploadpack.allowFilter` is on. Reasons host-only cannot be fixed server-side alone:
   - Browsers’ default `Referrer-Policy: strict-origin-when-cross-origin` strips the `/npub/repo` path from cross-origin `Referer`, so nginx’s host-only rewrite rarely sees the repo name.
   - CORS proxies omit `Referer` entirely.
   - Kind 30617 is replaceable and must be signed by the owner — on **My Repositories**, owners see a **Please republish** badge (and a batch **Republish broken clones** banner) when clone tags are only unusable (host-only, localhost, private LAN). That runs **Push to Nostr once per affected repo** (nsec / NIP-07 / remote signer; multiple approvals; can take a while).
   gittr’s **New / Import** paths used to publish the host only; `buildUnsignedRepositoryEvent` now expands host-only values.
6. **fcgiwrap workers** — Ubuntu’s default `DAEMON_OPTS=-f` is single-process and serializes every `git-upload-pack`. Use `DAEMON_OPTS=-c 8` in `/etc/default/fcgiwrap` (and a systemd drop-in) so browser clients don’t time out while another clone runs.

See [nginx.gittr.conf.example](../nginx.gittr.conf.example) (reference only — do not wholesale-replace production nginx).

## Docker

`ui/gitnostr/Dockerfile` + compose — Go included in image. Bridge runs as root inside the container; read Dockerfile comments before production use.

## CLI

`make git-nostr-cli` → `gn` for publishing events from the shell (optional).

## More

- SSH/Git usage: [SSH_GIT_GUIDE.md](SSH_GIT_GUIDE.md)
- Push debugging: [BRIDGE_PUSH_DEBUGGING.md](BRIDGE_PUSH_DEBUGGING.md)
- HTTP push API: [CLI_PUSH_EXAMPLE.md](CLI_PUSH_EXAMPLE.md)
