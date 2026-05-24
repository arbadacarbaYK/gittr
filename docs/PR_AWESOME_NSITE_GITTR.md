# PR: list gittr on [nostrver-se/awesome-nsite](https://github.com/nostrver-se/awesome-nsite)

Target repo: **https://github.com/nostrver-se/awesome-nsite** (already lists **nsite-deck** from gitworkshop).

## What to add

### Tools section (after `nsite-gateway`, before `nsite-deck`)

```markdown
- [gittr](https://gittr.space) Nostr git forge with **gittr Pages** to publish nsites from repositories (Blossom and NIP-5A manifests) and browse sites indexed from relays at [gittr.space/pages](https://gittr.space/pages)
```

### Available nsite hosts / gateways (top of the list)

```markdown
- [pages.gittr.space](https://pages.gittr.space)
```

## Why this wording

| gittr | nsite-deck (existing line) |
|-------|----------------------------|
| Publish nsites from **git repos** in the forge | Local gateway + cache |
| Public **directory** at [gittr.space/pages](https://gittr.space/pages) | Browse/sync locally |
| Hosted gateway **pages.gittr.space** | No hosted publish flow in that listing |

No need to name other clients; the list format speaks for itself.

## Open the PR

1. Fork **nostrver-se/awesome-nsite** on GitHub.
2. Branch: `add-gittr-pages`
3. Edit `README.md` with the two lines above.
4. PR title: `Add gittr Pages (publish + browse directory)`
5. PR body (below).

### Suggested PR body

```markdown
## Summary

Adds [gittr](https://gittr.space) to **Tools** and [pages.gittr.space](https://pages.gittr.space) to **Available nsite hosts / gateways**.

gittr is a Nostr git forge. **gittr Pages** lets owners publish NIP-5A site manifests and Blossom blobs from a repository, and provides a searchable catalog of live nsites indexed from relays at https://gittr.space/pages (backed by the pages.gittr.space gateway).

## Test plan

- [ ] Links resolve: gittr.space, gittr.space/pages, pages.gittr.space
```

## Local patch (already prepared)

A branch with this change exists at `/tmp/awesome-nsite-pr` on this machine (`add-gittr-pages`). To push after forking:

```bash
cd /tmp/awesome-nsite-pr
git remote add fork git@github.com:YOUR_USER/awesome-nsite.git
git push -u fork add-gittr-pages
gh pr create --repo nostrver-se/awesome-nsite --head YOUR_USER:add-gittr-pages \
  --title "Add gittr Pages (publish + browse directory)" \
  --body-file docs/PR_AWESOME_NSITE_GITTR.md
```

Replace `YOUR_USER` with your GitHub username (e.g. `arbadacarbaYK`).
