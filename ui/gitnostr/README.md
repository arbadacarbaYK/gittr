# gitnostr

**Git bridge to Nostr** — [`arbadacarbaYK/gitnostr`](https://gittr.space/arbadacarbaYK/gitnostr?branch=main) (this repo) and [`ui/gitnostr/`](https://gittr.space/arbadacarbaYK/gittr?file=ui/gitnostr/README.md&branch=main) in the gittr monorepo are the **same codebase**.

`git-nostr-bridge` watches Nostr for repo and SSH-key events, keeps **bare git repos on your disk**, and serves **`git push` / `git pull` over SSH or HTTPS**. Repo metadata lives on relays (NIP-34); the bridge is the **git server**. Pair with **[gittr](https://gittr.space)** for the full forge (issues, PRs, commits, Pages, bounties) on the same relays.

## Git access

| What | How |
| --- | --- |
| **SSH git** | **`git-nostr-ssh`** on the host handles `git clone` / `push` / `pull` for any client (terminal, CI, IDE). The bridge updates `authorized_keys` from **Nostr kind 52** events. |
| **SSH keys on relays** | Publish with **`gn ssh-key add`** ([`git-nostr-cli`](#git-nostr-cli-gn)), any tool that signs kind **52**, or **gittr → Settings → SSH Keys** (same events the bridge already reads). |
| **HTTPS git** | Same bare repos, e.g. `https://git.your-host/<pubkey>/<repo>.git` when nginx fronts the bridge (see gittr nginx examples). |
| **`nostr://` remotes** | If the repo is **mirrored on your bridge**, install **[git-remote-nostr](https://github.com/DanConwayDev/ngit-cli)** and use `nostr://…` alongside SSH/HTTPS. gittr publishes `clone` tags for interop. |

**Operator flow:** run the bridge → users (or `gn`) publish repo + key + permission events → contributors `git clone git@your-host:npub/repo.git`. No website required.

Full user guide: **[SSH_GIT_GUIDE.md](SSH_GIT_GUIDE.md)**.

## When gitnostr is the better fit

Use **gitnostr** when you need a **real git server** driven by Nostr—not when you only want a desktop patch client or the **ngit** `nostr://` CLI workflow ([comparison below](#gitnostr-vs-ngit)).

| Use case | Why gitnostr fits |
| --- | --- |
| **Backend for a web forge** | Pair the bridge with any NIP-34 UI. [gittr](https://gittr.space/arbadacarbaYK/gittr?branch=main) is the reference: issues, PRs, import, Pages, bounties—all talking to this bridge on `git.gittr.space`. Self-host **gittr + gitnostr** for your community. |
| **Integrate into your own client** | Relays stay the source of truth for discovery; the bridge gives **on-disk bare repos**, optional HTTP **`/api/event`**, and SSH git. Co-host **[gittr](https://gittr.space/arbadacarbaYK/gittr?branch=main)** for file trees and forge APIs — [docs/file-fetch-flow.md](docs/file-fetch-flow.md). |
| **Backup & mirror on your own metal** | Bare repos under `repositoryDir`. Point relays at your instance; use **watch-all** mode (`gitRepoOwners: []`) to mirror every repo you see, or limit to your pubkey(s). `clone` / `source` tags on events pull from GitHub, GitLab, Codeberg, GRASP HTTPS, etc. |
| **Leave centralized git hosting** | Permissions and SSH keys are **Nostr events**; reinstall the bridge on a new VPS and reconnect—same as moving off a censored Git host, without changing day-to-day `git` habits. |
| **Teams that want normal git** | Contributors use **`git clone git@your-host:npub/repo.git`** (or `git-nostr@`). No **ngit** binary required; works with existing CI and IDEs. |
| **Public git mirror for the network** | Run a community bridge that mirrors NIP-34 announcements; others clone from your host while metadata stays on relays. |
| **Monetize pushes** | Per-repo **`push_cost_sats`**: Lightning invoice + single-use push grant in SQLite (SSH prints BOLT11 when needed). |
| **Shell-first operators** | Publish repos, keys, and ACL with **`git-nostr-cli` (`gn`)**; the bridge applies changes from relays (and optional HTTP). |
| **Relay outages / flaky networks** | **SQLite** caches permissions and repo metadata so SSH ACL checks still work when relays are slow or down. |

## gitnostr vs **ngit**

Both use **NIP-34** on relays; different **codebases** and default git workflow. Full forge comparison (gittr vs gitworkshop vs gitplaza): **[gittr README → Web client features](https://gittr.space/arbadacarbaYK/gittr?file=README.md&branch=main)**.

| Layer | **gitnostr** (this repo) | **ngit** |
| --- | --- | --- |
| Role | **Git server:** bridge watches relays → bare repos on disk → **SSH/HTTPS** | **CLI:** `ngit init`, `pr/` branches, **`nostr://`** via [git-remote-nostr](https://github.com/DanConwayDev/ngit-cli) |
| Typical UI | **[gittr](https://gittr.space)** (issues, PRs, bounties, Pages, `/apps`, GitHub import) | **[gitworkshop](https://gitworkshop.dev)** (GRASP mirrors) |
| Day-to-day git | **`git@host:<npub>/repo.git`** (bridge SSH) + optional **`nostr://`** if mirrored here | **`nostr://`** + ngit CLI (GRASP-first) |
| Own bridge / paywall | **Yes** — `push_cost_sats`, NIP-34 **30617**, HTTP `/api/event`, watch-all mode | GRASP / ngit hosting model |
| Relay outage | **SQLite** permission cache on bridge | ngit/GRASP stack |

**Same relays, different default transport:** [gittr](https://gittr.space) runs this bridge on **`git.gittr.space`**. You can use **SSH, HTTPS, or `nostr://`** against repos mirrored on that bridge; issues/PRs stay on Nostr either way.

| Git access | **gitnostr bridge** (with or without gittr UI) | **ngit stack** |
| --- | --- | --- |
| **SSH** `git@host:npub/repo.git` | **`git-nostr-ssh`** on your bridge | GRASP git hosts |
| **HTTPS** bare clone | **Yes** (when configured) | GRASP HTTPS URLs on events |
| **`nostr://`** + git-remote-nostr | **Yes** when repo is on the bridge | **Native** to ngit |
| Publish keys / repos | **`gn`**, kind **52** / **30617** events, or any UI | ngit CLI |
| Self-host | **This repo** | ngit / GRASP layout |

**Bridge components in this repo:** `git-nostr-bridge` · `git-nostr-ssh` · `git-nostr-db` (SQLite) · `git-nostr-cli` (`gn`). Details: [docs/gittr-enhancements.md](docs/gittr-enhancements.md).

## Documentation

- **[Architecture](docs/ARCHITECTURE.md)** — components, relays, disk, and how **gittr UI**, **`gn`**, **SSH git**, and **`git-remote-nostr`** connect (diagram has **no** `git-nostr-hook` — that was never shipped)
- **NIPs / kinds:** [nostr schemata on gittr](https://gittr.space/npub1zafcms4xya5ap9zr7xxr0jlrtrattwlesytn2s42030lzu0dwlzqpd26k5/schemata?file=README.md) · [NIP-34](https://gittr.space/npub1zafcms4xya5ap9zr7xxr0jlrtrattwlesytn2s42030lzu0dwlzqpd26k5/schemata?file=README.md&path=nips%2Fnip-34)
- **[SSH & Git Access Guide](SSH_GIT_GUIDE.md)** - Complete guide for using SSH with git-nostr-bridge (cloning, pushing, pulling, permissions)
- **[Bridge enhancements](docs/gittr-enhancements.md)** - HTTP API, watch-all, deduplication (gittr production)
- **[Standalone bridge setup](docs/STANDALONE_BRIDGE_SETUP.md)** - Host the bridge on your own server
- **[File fetch flow](docs/file-fetch-flow.md)** - How gittr + bridge serve repo trees
- **[SSH & Git guide (gittr)](https://gittr.space/arbadacarbaYK/gittr?file=docs/SSH_GIT_GUIDE.md&branch=main)** — user-facing workflows and examples
- **[CLI push example (gittr)](https://gittr.space/arbadacarbaYK/gittr?file=docs/CLI_PUSH_EXAMPLE.md&branch=main)** — HTTP API examples for pushing repositories programmatically

Repo config, SSH keys, and permissions live on **Nostr**; the bridge materializes **bare git** on disk so normal `git` clients keep working. If your host disappears, point a new bridge at the same relays and keys.

**With [gittr](https://gittr.space/arbadacarbaYK/gittr?branch=main):** **issues, pull requests, commits, zaps, bounties, Pages, and `/apps`** on the same relays—this repo is **`git.gittr.space`**, gittr is the web forge.


# How it works

![Infrastructure overview](git-nostr.png)  
*Regenerate: `dot -Tpng architecture.dot -o git-nostr.png`*

Full breakdown (components + **gittr UI** / **`gn`** / **SSH git** / **`git-remote-nostr`**): **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

| Piece | What it does |
| --- | --- |
| **Relays** | Repo announcements (**30617**), state (**30618**), SSH keys (**52**), permissions (**50**), legacy **51**. |
| **`git-nostr-bridge`** | Subscribes (optional **`POST /api/event`**), updates **`git-nostr-db`**, mirrors **`repositoryDir`**, maintains **`authorized_keys`**. |
| **`git-nostr-ssh`** | SSH git entry: ACL from SQLite; optional **`push_cost_sats`** paywall on push. |
| **`gn` (`git-nostr-cli`)** | Publishes events to relays (no direct bridge socket). |
| **gittr UI** | Forge on relays + reads the same bare repos for file/commits APIs; SSH keys via Settings or `gn`. |

**DO NOT RUN THE BRIDGE AS YOUR OWN USER — it manages a dedicated user’s `authorized_keys`.**

Production bridge options (HTTP fast lane, watch-all, dedupe): [docs/gittr-enhancements.md](docs/gittr-enhancements.md).


# Setup Instructions

**Prerequisites**

- **Linux** — production bridges (including **gittr.space** / `git.gittr.space`) run on Linux with `git`, OpenSSH, and a dedicated `git-nostr` user.
- **Go 1.20+** — see `go.mod` (gittr deploy docs often cite Go 1.21+ for the full stack).
- **Relays** — public **`wss://`** URLs (e.g. `wss://relay.damus.io`, `wss://nos.lol`). Match gittr `NEXT_PUBLIC_NOSTR_RELAYS` or [STANDALONE_BRIDGE_SETUP.md](docs/STANDALONE_BRIDGE_SETUP.md).

**gittr.space:** To install **only** the bridge, `git clone git@git.gittr.space:arbadacarbaYK/gitnostr.git` or browse [arbadacarbaYK/gitnostr](https://gittr.space/arbadacarbaYK/gitnostr?branch=main). Inside the gittr monorepo, build from **`ui/gitnostr/`** — same project, kept in sync with that repo on gittr.

## git-nostr-bridge

**These instructions are needed if you intend to host git repositories. If another nostr user has configured a git-nostr-bridge for you then follwo the git-nostr-cli instructions below.**

Create a new user to host the git repositories (This is needed as the bridge will overwrite the authroized_keys file) and switch to the new account

**DO NOT RUN THE BRIDGE AS YOUR OWN USER YOU WILL LOSE YOUR AUTHORIZED_KEYS FILE**

```bash
sudo useradd --create-home git-nostr
sudo su - git-nostr
```

Clone **gitnostr** and build the bridge components

```bash
git clone git@git.gittr.space:arbadacarbaYK/gitnostr.git
cd gitnostr
make git-nostr-bridge
```

Start the bridge once to create the empty config files. **DO NOT RUN THE BRIDGE AS YOUR OWN USER YOU WILL LOSE YOUR AUTHORIZED_KEYS FILE**

```bash
./bin/git-nostr-bridge
```

You should get the message `no relays connected`

Edit the config file at `~/.config/git-nostr/git-nostr-bridge.json`. The default file should look like this

```
{
    "repositoryDir": "~/git-nostr-repositories",
    "DbFile": "~/.config/git-nostr/git-nostr-db.sqlite",
    "relays": [],
    "gitRepoOwners": []
}
```

Add your relays (public `wss://` URLs, same as gittr production).

- **`gitRepoOwners` non-empty** — mirror only repos from those pubkeys.
- **`gitRepoOwners` empty** — **watch-all**: mirror every repo announcement on your relays.

Example (gittr-style relays):

```
{
    "repositoryDir": "~/git-nostr-repositories",
    "DbFile": "~/.config/git-nostr/git-nostr-db.sqlite",
    "relays": ["wss://relay.damus.io", "wss://nos.lol"],
    "gitRepoOwners": []
}
```

You can now start the bridge again. **DO NOT RUN THE BRIDGE AS YOUR OWN USER YOU WILL LOSE YOUR AUTHORIZED_KEYS FILE**

```bash
./bin/git-nostr-bridge
```

As no events have been published you should see no console output.

Your git-nostr-bridge is now ready for use

## git-nostr-cli (gn)

**Watch out for a conflict with the gn command from https://gn.googlesource.com **

Clone **gitnostr** and build the cli components

```bash
git clone git@git.gittr.space:arbadacarbaYK/gitnostr.git
cd gitnostr
make git-nostr-cli
```

run the git-nostr-cli command once to create the default config file

```bash
./bin/gn
```

You should get the message `no relays connected`

Edit the config file at `~/.config/git-nostr/git-nostr-cli.json`. The default file should look like this

```
{
    "relays": [],
    "privateKey": "",
    "gitSshBase": ""
}
```

Set relays, your private key, and `gitSshBase` (`git@your-host` or `git-nostr@your-host`).

Example:

```
{
    "relays": ["wss://relay.damus.io", "wss://nos.lol"],
    "privateKey": "...",
    "gitSshBase": "git@git.gittr.space"
}
```

Publish your ssh-key. you may need to replace id_rsa.pub with the correct public key file

```bash
./bin/gn ssh-key add ~/.ssh/id_rsa.pub
```

Create a test repository and clone it. replace <publickey> with the hex represenation of your public key. If you are using a nip05 capable public key you can use the nip05 identifier instead.

```bash
./bin/gn repo create test
./bin/gn repo clone  <publickey>:test
```

You can set write permission for your repository with the following command. replace <publickey> with the hex represenation of your public key. If you are using a nip05 capable public key you can use the nip05 identifier instead.

```bash
./bin/gn repo permission test <publickey> WRITE
```
