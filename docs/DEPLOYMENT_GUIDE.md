# Deployment reference (ops)

**Install:** follow **[SETUP_INSTRUCTIONS.md](SETUP_INSTRUCTIONS.md)** end-to-end first. This file is checklist, relay/env reference, verification, maintenance—not a second install walkthrough.

| Doc | Use for |
|-----|---------|
| [SETUP_INSTRUCTIONS.md](SETUP_INSTRUCTIONS.md) | Production install |
| [GIT_NOSTR_BRIDGE_SETUP.md](GIT_NOSTR_BRIDGE_SETUP.md) | Bridge-only, Docker, security |
| [SSH_GIT_GUIDE.md](SSH_GIT_GUIDE.md) | Client `git` over SSH |
| [GRASP_RELAY_SETUP.md](GRASP_RELAY_SETUP.md) | Own relay |
| [NIPS_AND_EVENT_KINDS.md](NIPS_AND_EVENT_KINDS.md) | Full kind list + interop |
| [nginx.gittr.conf.example](../nginx.gittr.conf.example) | nginx shape on disk |

---

## Deploy checklist

- [ ] Relay(s) allow required kinds (below) or use permissive public relays
- [ ] Blossom URL set (`NEXT_PUBLIC_BLOSSOM_URL`; Pages may use `NEXT_PUBLIC_GITTR_PAGES_BLOSSOM_URL`)
- [ ] Repo cloned, `ui/.env.local` from `.env.example`, `yarn build`
- [ ] `git-nostr` user, bridge built, `git-nostr-bridge.json` (absolute paths, relays match UI)
- [ ] systemd: `git-nostr-bridge`, `gittr-frontend`
- [ ] Hourly homepage leaderboard: `./scripts/install-gittr-leaderboard-timer.sh <host>` (`gittr-leaderboard-refresh.timer`)
- [ ] SSH: `authorized_keys` for `git@` → live file under `/home/git-nostr/.ssh/`
- [ ] nginx + TLS (`certbot`); git subdomain → bridge HTTP or per [nginx.gittr.conf.example](../nginx.gittr.conf.example)
- [ ] Smoke: site loads, bridge logs show relays, `git ls-remote` works
- [ ] Backups + log access configured

---

## Relay event kinds

If you run your own relay, it must accept the kinds gittr publishes and reads. **Canonical list:** [NIPS_AND_EVENT_KINDS.md](NIPS_AND_EVENT_KINDS.md).

Minimum set for a restricted relay (extend as you enable features):

`0, 1, 5, 22, 50, 51, 52, 1111, 1337, 1618, 1619, 1621, 1630–1633, 1985, 24133, 30617, 30618, 9735, 10018, 35128` (+ app-specific kinds documented in NIPS doc)

**nostr-rs-relay** (`config.toml`):

```toml
# permissive:
# allowed_kinds = [ ... ]  # omit to allow all
# or list kinds from NIPS doc
```

**strfry** (`strfry.conf`): `eventKinds.allow` — same set.

Restart relay after changes. Bridge `relays` in JSON must match `NEXT_PUBLIC_NOSTR_RELAYS` in `ui/.env.local`.

---

## Environment variables (production)

Full template: `ui/.env.example`. Never commit `ui/.env.local`.

| Variable | Required | Notes |
|----------|----------|--------|
| `NEXT_PUBLIC_NOSTR_RELAYS` | yes | Same relays as bridge |
| `NEXT_PUBLIC_BLOSSOM_URL` | yes | NIP-96; static types for Pages may need a non-media-only host |
| `NEXT_PUBLIC_SITE_URL` | recommended | `https://…` for OG/sitemap |
| `NEXT_PUBLIC_DOMAIN` | recommended | Hostname |
| `NEXT_PUBLIC_GIT_SSH_BASE` | recommended | SSH clone host |
| `NEXT_PUBLIC_GIT_SERVER_URL` | recommended | HTTPS git smart HTTP (`git.` subdomain) |
| `NEXT_PUBLIC_GITTR_PAGES_URL` | optional | Pages gateway |
| `GIT_NOSTR_BRIDGE_DB` | if users differ | Absolute path to bridge SQLite |
| `GIT_NOSTR_BRIDGE_REPOS_DIR` | if users differ | Bare repo root |
| `GITHUB_CLIENT_ID` / `SECRET` | optional | Private GitHub import — [ui/GITHUB_OAUTH_SETUP.md](../ui/GITHUB_OAUTH_SETUP.md) |
| `GITHUB_PLATFORM_TOKEN` | optional | Rate limits for public GitHub API |
| `TELEGRAM_*` | optional | [PRODUCTION_TELEGRAM_SETUP.md](PRODUCTION_TELEGRAM_SETUP.md) |

Bridge config is **not** in `.env.local` — only `~/.config/git-nostr/git-nostr-bridge.json`.

---

## Ports

| Service | Port | Notes |
|---------|------|--------|
| Next.js | 3000 | Internal; nginx → 443 |
| git-nostr-bridge HTTP | 8080 | Git smart HTTP behind `git.` vhost |
| SSH | 22 | `git@` / `git-nostr@` |
| nginx | 80 / 443 | Public |

---

## Verify

```bash
sudo systemctl status gittr-frontend git-nostr-bridge nginx
curl -sI https://your.domain | head -1
sudo journalctl -u git-nostr-bridge -n 30 | grep -i relay
```

- Browser: login, open a repo, browse files.
- Client: `git ls-remote git@your.domain:<owner>/<repo>.git` (key in Settings → SSH Keys).
- Optional: `curl https://your.domain/api/telegram/webhook-status` if Telegram enabled.

---

## Troubleshooting

| Issue | Action |
|-------|--------|
| 502 on long API (Pages upload) | nginx `proxy_read_timeout` / `proxy_send_timeout` on `/api/` — see nginx example |
| Frontend won’t start | `WorkingDirectory` in unit matches deploy path; `yarn build`; `journalctl -u gittr-frontend` |
| Bridge no events | Relay URLs; firewall; kind filters on relay |
| `git` password prompt | [SSH_GIT_GUIDE.md](SSH_GIT_GUIDE.md); `./scripts/ensure-sshd-git-live-authorized-keys.sh` |
| Empty file tree | [FILE_FETCHING_INSIGHTS.md](FILE_FETCHING_INSIGHTS.md); clone API |
| Paywall on push | Pay in UI; owner payment keys in Settings → Account |
| SSL | `certbot certificates`; `nginx -t` |

---

## Updates

```bash
cd /opt/gittr && git pull
cd ui && yarn install && yarn build
sudo systemctl restart gittr-frontend

sudo systemctl stop git-nostr-bridge
sudo -u git-nostr bash -c 'cd ~/gittr && git pull && cd ui/gitnostr && make git-nostr-bridge'
sudo systemctl start git-nostr-bridge
```

Adjust paths to match your layout.

---

## Monitoring & backups

**Logs:**

```bash
journalctl -u gittr-frontend -f
journalctl -u git-nostr-bridge -f
tail -f /var/log/nginx/error.log
```

**Back up:**

- `~/.config/git-nostr/git-nostr-bridge.json`
- `~/.config/git-nostr/git-nostr-db.sqlite`
- `/home/git-nostr/git-nostr-repositories/`
- `ui/.env.local` (secure store)

```bash
BACKUP_DIR="/backup/gittr/$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"
sudo -u git-nostr cp -a ~/.config/git-nostr "$BACKUP_DIR/"
sudo -u git-nostr tar -czf "$BACKUP_DIR/repos.tar.gz" -C ~ git-nostr-repositories
cp /opt/gittr/ui/.env.local "$BACKUP_DIR/"   # path as deployed
```

---

## Security checklist

- [ ] Bridge runs as `git-nostr`, not your login user
- [ ] Firewall: 22, 80, 443 only (adjust if SSH nonstandard)
- [ ] TLS auto-renew (`certbot renew --dry-run`)
- [ ] No secrets in git; `.env.local` permissions restricted
- [ ] SSH keys via UI only; no shared `authorized_keys` copy for `git@`
- [ ] Backups tested occasionally
- [ ] OS packages updated on a schedule
