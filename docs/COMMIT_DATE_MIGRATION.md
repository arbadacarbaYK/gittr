# Commit Date Migration Guide

## ⚠️ CRITICAL: Only Migrate Your Own Repos!

**NEVER run the migration without the `-owners` flag!** This will break foreign repos because:
- Their commit SHAs will change
- Their Nostr state events will point to old SHAs
- Their owners can't fix this (they'd need to push again, but they may not know)
- gitworkshop.dev and other clients will show wrong dates

### Safe Usage

```bash
# Only migrate repos owned by specific pubkey(s)
./migrate-commit-dates -owners=9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c

# Multiple owners (comma-separated)
./migrate-commit-dates -owners=pubkey1,pubkey2,pubkey3
```

**If you run without `-owners`, the script will warn you and wait 5 seconds before proceeding.**

## Why gitworkshop.dev Shows Old Commit Dates After Migration

After running the `migrate-commit-dates` script, you may notice that gitworkshop.dev still shows the old commit date (e.g., "23 days ago"). This is expected behavior and here's why:

### The Problem

1. **`git filter-branch` rewrites commit history**: When we update commit dates using `git filter-branch`, Git creates NEW commits with NEW SHAs. The commit content (author, message, tree) is identical, but the commit SHA changes because the date is part of the commit object.

2. **Nostr state event points to old SHA**: The Nostr state event (kind 30618) still contains the OLD commit SHA. This is because the state event was published before the migration.

3. **gitworkshop.dev reads from state event**: gitworkshop.dev reads the state event from Nostr, extracts the commit SHA, and then reads that commit from the git repository. Since the state event points to the old SHA, it shows the old commit date.

### The Solution

**You MUST push to Nostr again after the migration** to update the state event with the new commit SHA.

#### Steps to Fix:

1. Go to your repository on gittr.space
2. Click the **"Push to Nostr"** button
3. Sign both events (announcement and state event)
4. Wait for the push to complete

This will publish a new state event with the NEW commit SHA, and gitworkshop.dev will then show the correct date.

### Why This Happens

The migration script updates the git repository on the bridge, but it cannot update the Nostr state event because:
- The state event must be signed with your private key
- The migration script runs on the server and doesn't have access to your private key
- Only you (the repository owner) can publish a new state event

### Technical Details

- **Commit SHA changes**: Git commits are content-addressed. When the date changes, the commit SHA changes.
- **State event format**: The state event contains tags like `["refs/heads/main", "old-commit-sha"]`. After migration, this needs to be `["refs/heads/main", "new-commit-sha"]`.
- **gitworkshop.dev behavior**: It reads the state event first, then fetches the commit from the git repository using the SHA from the state event.

## ngit init Out-of-Sync Issue

### The Problem

After running `ngit init`, if you push directly to GitHub (not through Nostr), you'll see "out of sync" messages. This is because:

1. **Nostr state is separate from GitHub**: The Nostr state event tracks the state of your repository on Nostr/GRASP servers, not on GitHub.

2. **Direct GitHub pushes don't update Nostr**: When you push directly to GitHub using `git push origin main`, GitHub is updated but Nostr is not. The Nostr state event still points to the old commit.

3. **ngit checks both sources**: ngit compares the Nostr state with the GitHub state and shows "out of sync" when they differ.

### The Solution

**To keep Nostr in sync with GitHub, you have two options:**

#### Option 1: Push through Nostr (Recommended)

Instead of pushing directly to GitHub, push through Nostr:

```bash
# Push to Nostr (which will also update GRASP servers)
ngit push

# Or use gittr.space "Push to Nostr" button
```

This will:
- Update the Nostr state event
- Update GRASP servers (git-nostr-bridge)
- Keep everything in sync

#### Option 2: Push to both (Manual Sync)

If you push directly to GitHub, you must also push to Nostr:

```bash
# Push to GitHub
git push origin main

# Then push to Nostr to update the state event
ngit push
# Or use gittr.space "Push to Nostr" button
```

### Why Nostr Git Exists

Nostr git exists to:
- **Decentralize git hosting**: Your repos are stored on multiple GRASP servers, not just GitHub
- **Enable discovery**: Repos are discoverable on the Nostr network
- **Enable payments**: Native Lightning payments, zaps, and bounties
- **Enable collaboration**: Issues, PRs, and discussions on Nostr

**But it requires you to push through Nostr to keep it in sync.** This is by design - Nostr is a separate network from GitHub, and they need to be synchronized manually (or through automation).

### Workflow Recommendations

1. **For new repos**: Use `ngit init` to set up GRASP servers, then always push through Nostr (`ngit push` or gittr.space).

2. **For existing GitHub repos**: Import to gittr.space, then push to Nostr. After that, use gittr.space "Push to Nostr" button to keep Nostr in sync.

3. **For teams**: Coordinate with your team. If someone pushes directly to GitHub, they should also push to Nostr (or notify the team to do so).

### Future Improvements

We're working on:
- **Automated sync**: A service that watches GitHub webhooks and automatically pushes to Nostr
- **Better UX**: Clearer indicators of sync status and easier sync workflows
- **Documentation**: More guides on best practices for Nostr git workflows

