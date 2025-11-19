# SSH & Git Access Guide

This guide explains how to access gittr.space repositories via SSH and Git command-line tools.

**⚠️ Setup Required**: Git commands (`git clone`, `git push`, `git pull`) require the **git-nostr-bridge service** to be installed and running. See `GIT_NOSTR_BRIDGE_SETUP.md` for complete installation instructions.

## Quick Start

### 1. Set Up SSH Keys

1. Go to **Settings → SSH Keys**
2. Either:
   - **Generate new key**: Click "Generate SSH Key", download the private key, and save it to `~/.ssh/id_ed25519`
   - **Add existing key**: Paste your public key from `~/.ssh/id_*.pub`
3. Your SSH key will be published to Nostr (only public key, safe to share)

### 2. Clone a Repository

All gittr.space repositories (both native and imported from GitHub) use the same SSH infrastructure:

```bash
git clone git@gitnostr.com:<owner-pubkey>/<repo-name>.git
```

Example:
```bash
git clone git@gitnostr.com:9a83779e/Pixelbot.git
```

**Note**: Even if a repository was imported from GitHub, once it's on gittr it becomes a native gittr repository accessible via our SSH infrastructure. The `forkedFrom` metadata is just for attribution - all git operations go through gittr's servers.

### 3. Push Changes

After cloning and making changes:
```bash
git add .
git commit -m "Update code"
git push origin main
```

**Note**: Only repository owners can push. For collaborative changes, create a pull request via the web interface.

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
  1. Using a different relay (relay.damus.io, nos.lol, nostr.azzamo.net typically work)
  2. Checking relay logs for rejection messages
  3. Using a relay that explicitly supports gitnostr protocol (KIND 50-52)

The gitnostr protocol (which ngit is based on) uses:
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
- `<gitSshBase>`: Configured in repository event or defaults to `gitnostr.com`
- `<ownerPubkey>`: Repository owner's Nostr pubkey (first 8 chars resp. username for display)
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

