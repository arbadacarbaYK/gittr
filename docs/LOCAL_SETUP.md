# Local development

Run the Next.js app on your machine. Git over SSH optional.

**Production install:** [SETUP_INSTRUCTIONS.md](SETUP_INSTRUCTIONS.md)

## Prerequisites

Node 18+, yarn (preferred), git. Optional: Go 1.25+ for the bridge (see `ui/gitnostr/go.mod`).

## Steps

```bash
git clone git@git.gittr.space:arbadacarbaYK/gittr.git
cd gittr/ui
yarn install
cp .env.example .env.local
# edit relays, Blossom URL, etc.
yarn dev
```

App: http://localhost:3000

## If localhost flickers a Next.js error overlay

`yarn dev` and `yarn build` share `ui/.next`. If a leftover `next dev` is still bound to port 3000 and you run a production build into the same folder, the next page load can 500 with `Cannot find module './NNNN.js'` and the overlay will flash as Next retries.

Fix:

```bash
# stop whatever is on :3000, then:
cd ui
rm -rf .next
yarn dev
```

Do not run `yarn build` in `ui/` while `yarn dev` is running — they share `ui/.next` unless you set `GITTR_DIST_DIR` (honored in `ui/next.config.js`). Homepage **Most Active** cards stay empty until a leaderboard snapshot exists (`ui/data/platform-leaderboard-snapshot.json`); that is expected on a fresh local box.

## Bridge (optional, for `git clone` / push)

```bash
cd ui/gitnostr
make git-nostr-bridge
mkdir -p ~/.config/git-nostr
```

`~/.config/git-nostr/git-nostr-bridge.json` (absolute paths):

```json
{
  "repositoryDir": "/home/YOUR_USER/git-nostr-repositories",
  "DbFile": "/home/YOUR_USER/.config/git-nostr/git-nostr-db.sqlite",
  "relays": ["wss://relay.damus.io", "wss://nos.lol"],
  "gitRepoOwners": []
}
```

Run: `./bin/git-nostr-bridge` (or `nohup … &`).

Local env hints in `ui/.env.local`:

```
NEXT_PUBLIC_DOMAIN=localhost
NEXT_PUBLIC_GIT_SSH_BASE=localhost
```

Details: [GIT_NOSTR_BRIDGE_SETUP.md](GIT_NOSTR_BRIDGE_SETUP.md), [SSH_GIT_GUIDE.md](SSH_GIT_GUIDE.md).

## Telegram (optional)

Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, use ngrok + `node configure-webhook.js <url>`. See [PRODUCTION_TELEGRAM_SETUP.md](PRODUCTION_TELEGRAM_SETUP.md).
