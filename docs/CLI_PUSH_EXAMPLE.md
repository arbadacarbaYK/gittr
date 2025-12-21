# CLI Push to gittr.space Bridge

Developers working locally can use gittr's bridge API to push their repositories to Nostr without using the web UI.

## Overview

The gittr bridge API allows you to:
1. **Push files to the bridge** (`/api/nostr/repo/push`) - Creates/updates the git repository on the bridge (Nostr git server)
2. **Publish Nostr events** (`/api/nostr/repo/event`) - Publishes announcement/state events to Nostr

**Note**: This API pushes to the **Nostr bridge** (git.gittr.space), not to GitHub. To push to GitHub, use standard `git push` commands. You can push to both:
- **GitHub**: `git push origin main` (standard git workflow)
- **Nostr**: Use the API below or `git push nostr main` (if configured)

## Prerequisites

- Your Nostr public key (64-char hex) or npub
- Repository name
- Files from your local git repository

## Step 1: Push Files to Bridge

The bridge API accepts a POST request with repository files:

```bash
# Using hex pubkey (64-char format)
curl -X POST https://git.gittr.space/api/nostr/repo/push \
  -H "Content-Type: application/json" \
  -d '{
    "ownerPubkey": "9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c",
    "repo": "my-repo",
    "branch": "main",
    "files": [
      {
        "path": "README.md",
        "content": "# My Repository\n\nThis is my repo.",
        "isBinary": false
      },
      {
        "path": "src/main.js",
        "content": "console.log(\"Hello, world!\");",
        "isBinary": false
      }
    ],
    "commitDate": 1734614400
  }'

# OR using npub format (NIP-19) - will be automatically decoded
curl -X POST https://git.gittr.space/api/nostr/repo/push \
  -H "Content-Type: application/json" \
  -d '{
    "ownerPubkey": "npub1abc123...",
    "repo": "my-repo",
    "branch": "main",
    "files": [
      {
        "path": "README.md",
        "content": "# My Repository\n\nThis is my repo.",
        "isBinary": false
      }
    ]
  }'
```

### Parameters

- **ownerPubkey** (required): Your Nostr public key as **64-char hex string** OR **npub format** (NIP-19)
  - Hex format: `9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c` (64 characters)
  - npub format: `npub1...` (will be automatically decoded to hex internally)
  - **Note**: The bridge stores repos by hex pubkey in the filesystem, but the API accepts both formats for convenience
- **repo** (required): Repository name/slug
- **branch** (optional): Branch name, defaults to "main"
- **files** (required): Array of file objects:
  - `path`: File path relative to repo root
  - `content`: File content as string (UTF-8 for text, base64 for binary)
  - `isBinary` (optional): `true` for binary files, `false` for text (default)
- **commitDate** (optional): Unix timestamp in seconds for commit date (defaults to current time)

### Response

```json
{
  "success": true,
  "message": "Bridge push completed",
  "missingFiles": [],
  "pushedFiles": 2,
  "refs": [
    {
      "ref": "refs/heads/main",
      "commit": "abc123def456..."
    }
  ]
}
```

## Step 2: Publish Nostr Events

After pushing files, you need to publish Nostr events (announcement and state) so other clients can discover your repository.

### Option A: Use gittr Web UI

The easiest way is to use the gittr.space web UI to publish the Nostr events after pushing files via CLI.

### Option B: Publish Events Directly

You can publish events directly to the bridge's HTTP API:

```bash
curl -X POST https://git.gittr.space/api/nostr/repo/event \
  -H "Content-Type: application/json" \
  -d '{
    "id": "event_id_here",
    "kind": 30617,
    "pubkey": "9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c",
    "created_at": 1734614400,
    "tags": [
      ["d", "my-repo"],
      ["name", "My Repository"],
      ["description", "My awesome repository"],
      ["clone", "https://git.gittr.space/npub1.../my-repo.git"]
    ],
    "content": "",
    "sig": "signature_here"
  }'
```

**Note**: Events must be properly signed with your Nostr private key. The bridge validates signatures.

## Complete Example: Push Local Repository with Files

Here's a complete example that reads all files from a local git repository and pushes them to gittr:

```bash
#!/bin/bash

# Configuration
OWNER_PUBKEY="9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c"
REPO_NAME="my-awesome-project"
BRANCH="main"
BRIDGE_URL="https://git.gittr.space/api/nostr/repo/push"

echo "📦 Collecting files from local repository..."

# Get all files from current directory (excluding .git)
files_json="["
first=true
file_count=0

while IFS= read -r file; do
  if [[ "$file" == .git/* ]] || [[ "$file" == .git ]]; then
    continue
  fi
  
  if [ -f "$file" ]; then
    if [ "$first" = true ]; then
      first=false
    else
      files_json+=","
    fi
    
    file_count=$((file_count + 1))
    echo "  📄 Adding: $file"
    
    # Check if binary
    if file "$file" | grep -q "text"; then
      content=$(cat "$file" | jq -Rs .)
      is_binary=false
    else
      content=$(base64 -w 0 < "$file" | jq -Rs .)
      is_binary=true
    fi
    
    path=$(echo "$file" | jq -Rs .)
    files_json+="{\"path\":$path,\"content\":$content,\"isBinary\":$is_binary}"
  fi
done < <(git ls-files)

files_json+="]"

echo "✅ Collected $file_count files"
echo "📤 Pushing to bridge..."

# Push to bridge
# Note: OWNER_PUBKEY can be either hex (64-char) or npub format
response=$(curl -s -X POST "$BRIDGE_URL" \
  -H "Content-Type: application/json" \
  -d "{
    \"ownerPubkey\": \"$OWNER_PUBKEY\",
    \"repo\": \"$REPO_NAME\",
    \"branch\": \"$BRANCH\",
    \"files\": $files_json
  }")

echo "$response" | jq '.'

# Check if successful
if echo "$response" | jq -e '.success == true' > /dev/null; then
  echo "✅ Successfully pushed $file_count files to bridge!"
  echo "📝 Next step: Publish Nostr events via web UI or API"
else
  echo "❌ Push failed. Check the error message above."
  exit 1
fi
```

## Example: Push Specific Files

If you want to push specific files instead of all files:

```bash
#!/bin/bash

OWNER_PUBKEY="npub1abc123..."
REPO_NAME="my-project"
BRIDGE_URL="https://git.gittr.space/api/nostr/repo/push"

# Push specific files
curl -X POST "$BRIDGE_URL" \
  -H "Content-Type: application/json" \
  -d "{
    \"ownerPubkey\": \"$OWNER_PUBKEY\",
    \"repo\": \"$REPO_NAME\",
    \"branch\": \"main\",
    \"files\": [
      {
        \"path\": \"README.md\",
        \"content\": \"# My Project\\n\\nThis is my awesome project!\",
        \"isBinary\": false
      },
      {
        \"path\": \"src/index.js\",
        \"content\": \"console.log('Hello, Nostr!');\\nmodule.exports = { version: '1.0.0' };\",
        \"isBinary\": false
      },
      {
        \"path\": \"package.json\",
        \"content\": \"{\\n  \\\"name\\\": \\\"my-project\\\",\\n  \\\"version\\\": \\\"1.0.0\\\",\\n  \\\"main\\\": \\\"src/index.js\\\"\\n}\",
        \"isBinary\": false
      },
      {
        \"path\": \"assets/logo.png\",
        \"content\": \"$(base64 -w 0 < logo.png)\",
        \"isBinary\": true
      }
    ]
  }"
```

## Limitations

1. **File Size**: The API automatically chunks large pushes (30 files or 8MB per chunk) to avoid nginx limits. For very large repos, consider using `git push` directly to the bridge via SSH.
2. **Binary Files**: Binary files must be base64-encoded. Large binaries may be split across multiple chunks.
3. **Nostr Events**: You still need to publish Nostr events separately (announcement kind 30617 and state kind 30618) for full discovery by other clients.

## Alternative: Direct Git Push (Recommended)

For developers already using git, you can push directly to the bridge via SSH. This is the recommended approach as it preserves all git history and works with standard git commands:

```bash
# 1. Set up SSH keys (if not already done)
# Go to Settings → SSH Keys on gittr.space, add your public key

# 2. Create the repository on gittr (via web UI or API)

# 3. Add gittr as a remote
cd /path/to/your/local/repo
git remote add nostr git@git.gittr.space:<your-npub>/<repo-name>.git

# 4. Push all your files, commits, and branches
git push nostr main

# 5. Push other branches if needed
git push nostr feature-branch

# 6. Publish Nostr events via web UI
# Go to the repository page and click "Push to Nostr"
```

**Advantages of direct git push:**
- ✅ Preserves full git history (commits, branches, tags)
- ✅ Works with all standard git commands
- ✅ Faster for large repositories
- ✅ No file size limits (handled by git protocol)
- ✅ Bridge automatically creates the repository if it doesn't exist

**When to use HTTP API instead:**
- You need to push files programmatically without git
- You're building a custom tool or script
- You want to push files from a non-git source

## See Also

- [FILE_FETCHING_INSIGHTS.md](FILE_FETCHING_INSIGHTS.md) - Complete file fetching flow
- [SSH_GIT_GUIDE.md](SSH_GIT_GUIDE.md) - SSH git operations guide
- [GIT_NOSTR_BRIDGE_SETUP.md](GIT_NOSTR_BRIDGE_SETUP.md) - Bridge setup documentation

