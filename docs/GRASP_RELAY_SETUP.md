# Grasp Protocol Relay Setup Guide

This guide explains how to set up a relay instance (Grasp protocol server) for your gittr.space client application.

> **Note**: This is separate from `git-nostr-bridge` (see [GIT_NOSTR_BRIDGE_SETUP.md](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr?path=docs&file=docs%2FGIT_NOSTR_BRIDGE_SETUP.md)). The bridge handles Git operations (clone/push/pull), while the relay handles repository discovery and distributed hosting via Nostr relays.

## What is Grasp?

Grasp (Git Relays Authorized via Signed-Nostr Proofs) is a distributed, protocol-first approach to hosting Git repos. It uses Nostr events as the source of truth, allowing multiple Git servers to act as redundant data relays.

**Key Benefits:**
- **Decentralized**: No single point of failure
- **Censorship Resistant**: Multiple servers can host the same repo
- **Protocol-First**: Nostr events control the Git experience
- **Resilient**: Pull/push from multiple instances simultaneously

Learn more: https://ngit.dev/grasp/

## Public Grasp Instances

The following public GRASP (Git Relays Authorized via Signed-Nostr Proofs) instances are available and supported by gittr.space:

### Primary GRASP Git Servers

These servers are both Nostr relays (wss://) AND git servers (git:///http:///https://) that support NIP-34:

- **wss://relay.ngit.dev** - gitworkshop.dev relay instance (Grasp protocol, part of ngit ecosystem)
- **wss://ngit-relay.nostrver.se** - NostrVer GRASP relay instance
- **wss://gitnostr.com** - Public gitnostr relay instance (Grasp protocol)
- **wss://ngit.danconwaydev.com** - Dan Conway's ngit relay instance
- **wss://git.shakespeare.diy** - Shakespeare DIY GRASP server
- **wss://git-01.uid.ovh** - UID OVH GRASP server instance 1
- **wss://git-02.uid.ovh** - UID OVH GRASP server instance 2
- **wss://git.jb55.com** - jb55's GRASP git server
- **wss://git.gittr.space** - gittr.space's own GRASP server (for Git operations)

### Additional Public Relays

These are regular Nostr relays (not GRASP servers) but are commonly used with gittr:

- **wss://relay.damus.io** - Damus relay
- **wss://nostr.fmt.wiz.biz** - FMT relay
- **wss://nos.lol** - nos.lol relay
- **wss://relay.azzamo.net** - Azzamo relay
- **wss://nostr.mom** - nostr.mom relay
- **wss://relay.nostr.band** - nostr.band relay
- **wss://nostr.wine** - nostr.wine relay

**Note**: 
- GRASP servers (listed above) are BOTH Nostr relays AND git servers - they can host repositories
- Regular Nostr relays are used for event distribution but don't host git repositories
- gittr.space runs its own GRASP server at `git.gittr.space` for Git operations
- All GRASP servers support the NIP-34 protocol for git repositories on Nostr

## Setting Up Your Own Relay Instance

### Prerequisites

- Docker and Docker Compose installed
- A VPS or server with public IP
- Domain name (optional but recommended)
- SSL certificate (for HTTPS/WSS)

### Installation Steps

1. **Clone the ngit-relay repository:**
   ```bash
   git clone https://github.com/danconwaydev/ngit-relay.git
   cd ngit-relay
   ```

2. **Configure environment variables:**
   Create a `.env` file based on `.env.example`:
   ```bash
   cp .env.example .env
   ```

   Key configuration options:
   - `DOMAIN`: Your domain name (e.g., `relay.yourdomain.com`)
   - `NOSTR_RELAY_PORT`: Port for Nostr WebSocket relay (default: 8080)
   - `GIT_HTTP_PORT`: Port for Git HTTP service (default: 80)
   - `GIT_HTTPS_PORT`: Port for Git HTTPS service (default: 443)

3. **Set up SSL certificates:**
   ```bash
   # Using Let's Encrypt (recommended)
   certbot certonly --standalone -d relay.yourdomain.com
   ```

4. **Start the services:**
   ```bash
   docker-compose up -d
   ```

5. **Verify the installation:**
   - Check Nostr relay: `wss://relay.yourdomain.com`
   - Check Git HTTP: `https://relay.yourdomain.com/<npub>/<repo>.git`

### Integration with gittr Client

Once your relay is running, add it to your client's relay configuration:

**Option 1: Environment Variable (Recommended)**
```bash
# In your ui/.env.local file
NEXT_PUBLIC_NOSTR_RELAYS=wss://relay.yourdomain.com,wss://relay.ngit.dev,wss://ngit-relay.nostrver.se,wss://gitnostr.com,wss://git.shakespeare.diy,wss://git-01.uid.ovh,wss://git-02.uid.ovh,wss://git.jb55.com,wss://git.gittr.space,wss://relay.damus.io,wss://nos.lol,wss://nostr.wine
```

**Option 2: Update Default Relays in Code**
Edit `ui/src/lib/nostr/NostrContext.tsx` and add your relay to the fallback list (not recommended - use environment variables instead):
```typescript
// Minimal fallback - should not be used in production (configure via .env.local)
return [
  "wss://relay.yourdomain.com", // Your custom relay
  "wss://relay.ngit.dev",
  "wss://gitnostr.com",
  "wss://git.gittr.space", // gittr.space's own GRASP server
  // ... other relays
];
```

**Note**: Environment variables are preferred as they allow configuration without code changes.

### ⚠️ Important: Relay Event Kind Configuration

**Your relay and Blossom server MUST allow the following Nostr event kinds** for gittr to function properly:

#### Required Event Kinds:

1. **Kind 0** (NIP-01: Metadata) - User profile information
   - Used for: Displaying user names, avatars, and profile data
   - Required for: User discovery, contributor metadata

2. **Kind 1** (NIP-01: Notes) - Comments and discussions
   - Used for: Issue comments, PR comments, discussions
   - Required for: Collaboration features

3. **Kind 50** (gitnostr: Repository Permissions) - Repository access control
   - Used for: Managing repository permissions
   - Required for: Git operations via git-nostr-bridge

4. **Kind 51** (gitnostr: Repository) - Repository announcements
   - Used for: Repository metadata, discovery, announcements
   - Required for: Core repository functionality

5. **Kind 52** (gitnostr: SSH Keys) - SSH public keys
   - Used for: Git authentication via SSH
   - Required for: Git clone/push/pull operations

6. **Kind 9735** (NIP-57: Zaps) - Lightning payments
   - Used for: Repository zaps, tipping contributors
   - Required for: Payment features

7. **Kind 9803** (Custom: Issues) - Issue tracking
   - Used for: Repository issues with bounties
   - Required for: Issue management

8. **Kind 1337** (NIP-C0: Code Snippets) - Code snippet sharing
   - Used for: Sharing code snippets from repositories
   - Required for: Code snippet features

9. **Kind 30617** (NIP-34: Repository Metadata) - Repository announcements (primary)
   - Used for: Repository metadata, discovery, announcements
   - Required for: Core repository functionality (replaces legacy kind 51)

10. **Kind 30618** (NIP-34: Repository State) - Repository state announcements
   - Used for: Tracking branches, tags, and commit SHAs
   - Required for: Full NIP-34 compliance and ngit client recognition (e.g., gitworkshop.dev)

11. **Kind 9804** (Custom: Pull Requests) - Pull requests
   - Used for: Code review and merging
   - Required for: PR workflow

#### Configuring Your Relay:

**For most Nostr relay implementations**, you'll need to configure allowed event kinds. Here are examples for common relay software:

**nostr-rs-relay (Rust) - Used by azzamo-relay:**
```toml
# In your relay config.toml (usually /etc/nostr-rs-relay/config.toml)
[relay]
# Allow all kinds (recommended for public relays)
# OR specify allowed kinds:
allowed_kinds = [0, 1, 50, 51, 52, 1337, 30617, 30618, 9735, 9803, 9804]
```

**After updating config, restart relay:**
```bash
sudo systemctl restart nostr-rs-relay
# OR if using Docker:
docker-compose restart nostr-rs-relay
```

**strfry (C) - Common for noderunner.network:**
```yaml
# In your strfry.conf
relay:
  # Allow all kinds (recommended)
  # Or use eventKinds section to whitelist:
  eventKinds:
    allow: [0, 1, 50, 51, 52, 1337, 30617, 30618, 9735, 9803, 9804]
```

**After updating config, restart relay:**
```bash
sudo systemctl restart strfry
# OR if using Docker:
docker-compose restart strfry
```

**For other relay implementations:** Check your relay's documentation for how to configure allowed event kinds. The key is ensuring these kinds are allowed: 0, 1, 50, 51, 52, 1337, 30617, 9735, 9803, 9804.

**Blossom Server (NIP-96):**
If you're running a Blossom server for file storage (Git pack files), ensure it:
- Accepts NIP-96 upload requests
- Allows the same event kinds as your relay (0, 1, 50, 51, 52, 9735, 9803, 9804)
- Has sufficient storage quota for Git pack files
- Is accessible via HTTPS (required for NIP-96)

**Configure Blossom URL in gittr:**
```bash
# In ui/.env.local
NEXT_PUBLIC_BLOSSOM_URL=https://blossom.yourdomain.com
```

**⚠️ Security Note:** While allowing all kinds (0-65535) is simplest, you may want to restrict to only the kinds listed above for security. However, allowing all kinds ensures compatibility with future gittr features and other Nostr applications.

#### Verifying Configuration:

After configuring your relay, test that it accepts these event kinds:

```bash
# Test with nostr-tools or similar
# Publish a test event of each kind and verify it's stored
```

If events are rejected, check your relay logs for "event kind not allowed" errors.

### How It Works

1. **Repository Announcement**: When a user creates a repo, a Nostr event (kind 51) is published to relays listing which Grasp servers should host it.

2. **Auto-Creation**: Grasp servers automatically create blank repos when they receive repository-announcement events that list them.

3. **Git Operations**: Users push/pull using `nostr://` URLs, which resolve to multiple Grasp servers for redundancy.

4. **Nostr Authority**: All permissions, PRs, issues, and metadata are stored as Nostr events, making Git servers simple data relays.

### Architecture

```
┌─────────────┐
│  gittr Client │
└──────┬──────┘
       │
       ├─── Nostr Events (kind 51) ───┐
       │                                │
       │                                ▼
       │                         ┌──────────────┐
       │                         │ Nostr Relays │
       │                         │ (Authority)  │
       │                         └──────┬───────┘
       │                                │
       │                                │ Events
       │                                │
       ▼                                ▼
┌─────────────┐                  ┌─────────────┐
│ Grasp Server│                  │ Grasp Server│
│  Instance 1 │                  │  Instance 2 │
│             │                  │             │
│ Git Repos   │                  │ Git Repos   │
└─────────────┘                  └─────────────┘
```

### Troubleshooting

**Relay not connecting:**
- Check firewall rules (ports 80, 443, 8080)
- Verify SSL certificates are valid
- Check Docker logs: `docker-compose logs`

**Repos not appearing:**
- Ensure your relay is listed in repository-announcement events
- Check that KIND_REPOSITORY (51) events are being published
- Verify subscription filters are correct

**Performance issues:**
- Consider using a reverse proxy (nginx) for better performance
- Monitor disk space (repos can grow large)
- Use SSD storage for better I/O performance

### Security Considerations

- **Private Repos**: Use NIP-42 auth + whitelist + firewall
- **Sensitive Data**: Combine with NIP-70 (protected events)
- **Rate Limiting**: Implement rate limits to prevent abuse
- **Backup**: Regularly backup Nostr event database

### References

- **Grasp Protocol**: https://ngit.dev/grasp/
- **GRASP Protocol Specification**: https://ngit.dev/grasp/
- **ngit-relay Repository**: https://github.com/danconwaydev/ngit-relay (one implementation, but not the only one)
- **Related Setup**: See [GIT_NOSTR_BRIDGE_SETUP.md](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr?path=docs&file=docs%2FGIT_NOSTR_BRIDGE_SETUP.md) for git-nostr-bridge installation (handles Git operations)
- **gittr GRASP Implementation**: See `ui/src/lib/utils/grasp-servers.ts` for the complete list of supported GRASP servers

### Next Steps

1. Deploy your ngit-relay instance
2. Add it to your client's relay configuration
3. Test by creating a repo and verifying it appears on your relay
4. Monitor logs and performance
5. Consider running multiple instances for redundancy

