# SSH & Git Access Guide

This guide explains how to access gittr.space repositories via SSH and Git command-line tools.

**⚠️ Setup Required**: Git commands (`git clone`, `git push`, `git pull`) require the **git-nostr-bridge service** to be installed and running. See [GIT_NOSTR_BRIDGE_SETUP.md](docs/GIT_NOSTR_BRIDGE_SETUP.md) for complete installation instructions.

## Quick Start

### 1. Set Up SSH Keys

1. Go to **Settings → SSH Keys**
2. Either:
   - **Generate new key**: Click "Generate SSH Key", download the private key, and save it to `~/.ssh/id_ed25519`
   - **Add existing key**: Paste your public key from `~/.ssh/id_*.pub`
3. Your SSH key will be published to Nostr (only public key, safe to share)

### 2. Clone a Repository

gittr.space repositories support multiple clone URL formats for maximum compatibility:

#### Option A: SSH (Standard Git - Recommended)
```bash
git clone git@gittr.space:<owner-pubkey>/<repo-name>.git
```

Example:
```bash
git clone git@gittr.space:9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c/repo-name.git
```

**Note**: SSH cloning requires SSH keys to be set up (see Step 1 above). This is the standard Git approach, familiar to developers who use GitHub/GitLab.

#### Option B: HTTPS (GRASP Git Servers)
```bash
git clone https://git.gittr.space/<owner-pubkey>/<repo-name>.git
```

HTTPS clones work exactly like GitHub/GitLab. Every push publishes fresh NIP-34 events plus uploads the bare repo to our bridge at `git.gittr.space` and other GRASP servers (gitnostr.com, ngit-relay.nostrver.se, relay.ngit.dev, etc.). Use HTTPS when you want a dead-simple `git clone` that requires no SSH keys.

#### Option C: nostr:// Protocol (Ecosystem Standard)
```bash
git clone nostr://<author-name>@<relay-domain>/<repo-name>
```

Example:
```bash
git clone nostr://alex@git.gittr.space/repo-name
```

**Note**: The `nostr://` format requires the `git-remote-nostr` helper tool to be installed. This is the format used by other NIP-34 clients. The helper translates `nostr://` URLs to actual git operations.

**Which format to use?**
- **SSH**: Preferred for contributors with keys configured (push + pull)
- **HTTPS**: Good for quick read-only clones or CI systems without SSH keys
- **nostr://**: Use when following guides from other NIP-34 clients or any tool that expects this scheme (requires `git-remote-nostr`)

**Note**: Even if a repository was imported from GitHub, once it's on gittr it becomes a native gittr repository accessible via our SSH infrastructure. The `forkedFrom` metadata is just for attribution - all git operations go through gittr's servers.

**⚠️ Important: Getting Files Into Your Repository**

## Repository Creation Methods

gittr.space supports three ways to create repositories:

### 1. Import from GitHub/GitLab/Codeberg (Recommended for Existing Projects)

When you import a repository from GitHub, GitLab, or Codeberg:
- Files are **automatically fetched** during import
- Files appear **immediately** in the web UI
- No Git CLI required for initial setup
- The repository maintains a link to its source (`sourceUrl`)

**Workflow:**
1. Go to **"Create repository"** page
2. Enter `owner/repo` (e.g., `arbadacarbaYK/gittr`) or full URL
3. Click **"Import & Create"**
4. Files are fetched and stored in your browser
5. Optionally click **"Push to Nostr"** to publish to the network

### 2. Create Empty Repository (For New Projects)

When you create an empty repository via the web UI:
- The repository is created but **contains no files**
- Files **will not appear** in the web UI until you push them via Git CLI
- You must use Git commands to add files

**Complete Workflow for Empty Repositories:**

1. **Create the repository via web UI:**
   - Go to **"Create repository"** page
   - Enter a repository name
   - Click **"Create Empty Repository"**

2. **Set up SSH keys** (if not already done):
   - Go to **Settings → SSH Keys**
   - Generate a new key or add an existing public key
   - Download the private key and save it to `~/.ssh/id_ed25519` (or your preferred location)
   - Set correct permissions: `chmod 600 ~/.ssh/id_ed25519`

3. **Clone the repository:**
   ```bash
   git clone git@gittr.space:<your-pubkey>/<repo-name>.git
   ```
   Replace `<your-pubkey>` with your Nostr pubkey (64-char hex) and `<repo-name>` with your repository name.

4. **Add your files:**
   - Copy files into the cloned directory, or create new files
   - Example: `echo "# My Project" > README.md`

5. **Commit your changes:**
   ```bash
   git add .
   git commit -m "Initial commit"
   ```

6. **Push to the repository:**
   ```bash
   git push origin main
   ```
   (Use your branch name if different from `main`)

7. **Files appear in web UI:** After pushing, refresh the repository page in your browser. Files will now be visible.

**Why this workflow is necessary:** The git-nostr-bridge stores repositories as bare Git repositories. Files only appear in the web UI after they've been committed and pushed via Git. This is the standard Git workflow - the web UI is a viewer, not a file editor.

### 3. Bulk Import from GitHub

For importing multiple repositories at once:
- Click **"Bulk Import from GitHub"** on the create repository page
- Browse and select which repositories to import
- Files are automatically fetched for all selected repositories

## For Existing Repositories (Making Changes)

If you want to make changes to an existing repository (whether imported or created empty):

1. **Clone the repository:**
   ```bash
   git clone git@gittr.space:<owner-pubkey>/<repo-name>.git
   ```

2. **Make your changes:**
   - Edit files, add new files, delete files, etc.

3. **Commit and push:**
   ```bash
   git add .
   git commit -m "Your commit message"
   git push origin main
   ```

4. **Changes appear in web UI:** After pushing, refresh the repository page to see your changes.

## Key Points

- **Imported repositories:** Files appear immediately (no Git CLI needed for initial setup)
- **Empty repositories:** Must use Git CLI to add files (clone, add, commit, push)
- **All repositories:** Use Git CLI for ongoing changes (standard Git workflow)
- **Web UI:** Primarily a viewer - use Git CLI for file operations

### 3. Publish (Push to Nostr)

1. In the repository UI click **"Push to Nostr"**.  
2. Confirm the prompt in your NIP‑07 wallet (or use your stored private key).  
3. We'll publish the NIP‑34 event **and** automatically sync the full Git repository to our bridge at `git.gittr.space` and other GRASP servers so other clients can clone it immediately.

**Important Notes:**
- **File Content Source**: Files are sourced from `localStorage` (primary) or bridge API (fallback if files are missing from `localStorage`)
- **No External Fetching**: The push process does NOT fetch files from external sources (GitHub, GitLab, etc.) during push
- **Workflow**: Files should already be in `localStorage` from the create or import workflow
- **If Files Are Missing**: Re-import the repository to load all files into `localStorage` before pushing

#### Optional: push via Git CLI
If you prefer a traditional workflow you can still push directly to the bridge:

```bash
git add .
git commit -m "Update code"
git push origin main
```

**Important**: SSH git operations (`git push`, `git pull`, `git clone`) work **directly with the git-nostr-bridge** via SSH. They are **completely separate** from the web UI push process:

- **SSH operations**: Work with files already in your local git repository. When you `git push`, you're pushing your local commits directly to the bridge. The bridge receives the git objects (commits, trees, blobs) via the git protocol, not file content from localStorage.
- **Web UI push**: Uses files from `localStorage` or bridge API to create/update the repository on the bridge. This is only for the initial push or when pushing from the web UI.

**How git-remote-nostr works:**
- `git-remote-nostr` is a helper tool that translates `nostr://` URLs into standard git operations
- When you run `git clone nostr://...`, it:
  1. Queries Nostr relays for NIP-34 repository events
  2. Extracts clone URLs (SSH or HTTPS) from the event
  3. Uses standard git operations to clone from those URLs
- The actual git operations (clone/push/pull) still go through SSH or HTTPS to the bridge, just like regular git operations

Only repository owners can push. Collaborators should use pull requests from their own forks or local copies.

## How It Works

### SSH Key Management

- **Storage**: SSH public keys are published as Nostr events (KIND_SSH_KEY = 52)
- **Security**: Only public keys are stored on Nostr (safe to share)
- **Access**: The `git-nostr-bridge` service watches for SSH key events and updates authorized keys
- **User-level keys**: One SSH key pair works for all your repositories (GitHub model)

### Git Operations Over SSH

When you run `git clone` or `git push`:

1. SSH connects to the gittr server using your SSH key
2. The server authenticates you via your Nostr pubkey
3. Permission is checked (read/write/admin based on repository permissions)
4. Git operations execute on the server's repository storage

### Supported Operations

**All standard Git commands work!** Our SSH-based approach supports the full Git command set:

- ✅ `git clone` - Clone repositories
- ✅ `git push` - Push changes (owner/admin only)
- ✅ `git pull` - Pull latest changes
- ✅ `git fetch` - Fetch remote branches
- ✅ `git checkout` - Switch branches or create new branches
- ✅ `git branch` - List, create, or delete branches
- ✅ `git merge` - Merge branches (via web UI for PRs)
- ✅ `git status` - Check repository status
- ✅ `git log` - View commit history
- ✅ `git diff` - View changes
- ✅ `git add` - Stage changes
- ✅ `git commit` - Commit changes
- ✅ All other standard Git commands work as expected!

**Note**: PRs are created via the web UI, but once you clone a repo, you can use ALL standard Git commands just like with GitHub or GitLab.

## How SSH Keys Work

SSH keys are managed entirely client-side and published directly to Nostr:

1. **Key Management**: Done in the browser (Settings → SSH Keys)
2. **Publishing**: Keys are published as Nostr events (KIND_SSH_KEY = 52) signed with your Nostr private key
3. **Storage**: Public keys are stored on Nostr relays (decentralized, auditable)
4. **Processing**: The `git-nostr-bridge` service watches for these events and updates authorized keys automatically

**No API endpoints required** - everything happens through Nostr's decentralized protocol.

### ⚠️ Relay Compatibility Note

**Important**: KIND_52 is used by the gitnostr protocol for SSH keys, but NIP-52 defines KIND_52 for Calendar Events. This is a known conflict.

**Relay Compatibility**:
- Most relays accept any kind number, so KIND_52 should work on most relays
- Some relays may reject or filter KIND_52 if they specifically implement NIP-52
- If you experience issues publishing SSH keys, try:
  1. Using a different relay (relay.damus.io, nos.lol, relay.azzamo.net typically work)
  2. Checking relay logs for rejection messages
  3. Using a relay that explicitly supports gitnostr protocol (KIND 50-52)

The gitnostr protocol (which the original ngit ecosystem uses, and which gittr forked from) uses:
- KIND_50: Repository Permissions
- KIND_51: Repository metadata
- KIND_52: SSH Keys

If relay compatibility becomes an issue, we may need to migrate to a different kind number (e.g., 30000+ range for custom applications).

### Repository Access

#### SSH Clone URL Format
```
git@<gitSshBase>:<ownerPubkey>/<repoName>.git
```

Where:
- `<gitSshBase>`: Configured in repository event or defaults to `gittr.space`
- `<ownerPubkey>`: Repository owner's Nostr pubkey (full 64-char hex)
- `<repoName>`: Repository name/slug

## Troubleshooting

### "Permission denied (publickey)"
- Ensure your SSH key is added in Settings → SSH Keys
- Check that your private key is in `~/.ssh/` with correct permissions (600)
- Verify the `git-nostr-bridge` service is running and has processed your key

### "Repository not found"
- Check that the repository exists on gittr
- Verify the clone URL format is correct
- Ensure you have read permission for the repository

### "Network is unreachable" (port 22)
- **You must clone the repository first**: `git fetch --all` only works if you've already cloned the repo. You can't fetch from a remote that doesn't exist in your local repo.
- Verify SSH port 22 is accessible: `ssh -v git-nostr@gittr.space` (should connect, not ask for password)
- Check if your network/firewall blocks port 22
- Ensure `git-nostr-bridge` service is running on the server
- Try HTTPS clone instead: `git clone https://git.gittr.space/<owner-pubkey>/<repo-name>.git`

**Note**: `git fetch --all` fetches from **all remotes configured in your current repository**, not "all repositories". You must first:
1. Clone the repo: `git clone git@gittr.space:<owner-pubkey>/<repo-name>.git`
2. Then you can fetch: `git fetch --all` (fetches from all remotes in that repo)

### "Push rejected"
- Only repository owners can push directly
- For collaborative changes, create a pull request via the web UI
- Check repository permissions in Settings → Repository → Permissions

## Security Notes

### ✅ What's Safe

- **Only public keys are published**: The code explicitly publishes ONLY the SSH public key (the part that starts with `ssh-ed25519` or `ssh-rsa`) to Nostr. Public keys are designed to be shared publicly - this is the standard SSH security model (same as GitHub, GitLab, etc.).

- **Private keys NEVER leave your device**: Private keys are:
  - Generated client-side in your browser (Web Crypto API)
  - Only used to SIGN the Nostr event (proving you own it)
  - Never included in the published event
  - Only downloaded once and stored locally on your machine
  - Required for SSH authentication (stays in `~/.ssh/`)

### ⚠️ Important: localStorage Security

**Critical**: Data stored in browser localStorage is **NOT encrypted**.

**What's stored in localStorage**:
- ✅ **SSH Public Keys**: Safe - public keys are meant to be public
- ✅ **Repositories, settings, UI preferences**: Low risk, but accessible to any script from same origin
- ⚠️ **Nostr Private Keys (nsec)**: **STORED AS PLAINTEXT** - Accessible via browser dev tools

**Security Implications**:
1. **Browser Dev Tools**: Anyone with access to your browser can view localStorage
2. **JavaScript Access**: Any script from the same origin can read localStorage
3. **Malicious Extensions**: Browser extensions with storage permissions can access it
4. **Shared Computers**: If multiple users use the same browser, localStorage is shared

**Best Practices**:
- ✅ **Use NIP-07 Extension** (recommended): Private keys stay in the extension, never in localStorage
- ✅ **SSH Private Keys**: Never stored - only shown/downloaded once, you save them to `~/.ssh/`
- ⚠️ **Nostr Private Keys**: If you must use nsec login, consider:
  - Using a dedicated browser profile
  - Clearing localStorage after sessions
  - Using browser encryption (some browsers support encrypted storage)
  - Preferring NIP-07 extensions for better security

**What's Safe**:
- SSH public keys (meant to be public)
- Repository data (non-sensitive metadata)
- Settings (UI preferences)

**What's NOT Encrypted**:
- Nostr private keys (if using nsec login)
- All localStorage data is stored as plain JSON

**Future Improvement**: We should add optional client-side encryption for sensitive localStorage data using Web Crypto API, encrypted with a user-set password.

- **Nostr signing provides authenticity**: Each SSH key event is signed with your Nostr private key, so only you can publish SSH keys for your Nostr account.

### ⚠️ Security Considerations

1. **Nostr account compromise**: If someone gains access to your Nostr private key, they could publish a malicious SSH key. Protect your Nostr keys!
2. **Key revocation**: Currently, there's no automatic revocation mechanism. If you suspect a key is compromised, you should:
   - Delete it from Settings → SSH Keys (removes from local storage)
   - Contact the bridge operator to manually remove it
   - **TODO**: Implement key revocation events on Nostr
3. **Public key fingerprint verification**: The UI shows fingerprints, but doesn't verify against what's on Nostr. Consider verifying fingerprints match.

### 🔐 Best Practices

- **Generate strong keys**: Use Ed25519 (recommended) or RSA with 4096-bit keys
- **Protect your private key**: 
  - Never share your private key
  - Use correct permissions: `chmod 600 ~/.ssh/id_ed25519`
  - Consider using SSH agent for key management
- **Monitor your keys**: Regularly check Settings → SSH Keys to ensure no unauthorized keys
- **Use different keys**: Consider using different SSH keys for different services/devices

## Infrastructure

gittr uses the following services:

- **`git-nostr-ssh`**: SSH server that handles git operations
- **`git-nostr-bridge`**: Service that watches Nostr for SSH key events and updates authorized keys
- **Nostr relays**: Store SSH key events (KIND_SSH_KEY = 52)

For more details on the infrastructure setup, see the `gitnostr` directory in the repository.

