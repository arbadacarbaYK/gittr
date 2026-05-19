# Local development

Run the Next.js app on your machine. Git over SSH optional.

**Production install:** [SETUP_INSTRUCTIONS.md](SETUP_INSTRUCTIONS.md)

## Prerequisites

Node 18+, yarn (preferred), git. Optional: Go 1.21+ for the bridge.

## Steps

```bash
git clone https://github.com/arbadacarbaYK/gittr.git
cd gittr/ui
yarn install
cp .env.example .env.local
# edit relays, Blossom URL, etc.
yarn dev
```

App: http://localhost:3000

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
