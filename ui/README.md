# NostrGit

A truly censorship-resistant alternative to GitHub that has a chance of working.

Read about the vision [here](https://github.com/NostrGit/NostrGit/tree/main/documentation/vision.md).

- [Next.js](https://nextjs.org)
- [Tailwind CSS](https://tailwindcss.com)
- [tRPC](https://trpc.io)
- [ui.shadcn.com](https://ui.shadcn.com)

We use the [T3 stack](https://create.t3.gg/).

<a href="https://nostrgit.org"><img src="https://user-images.githubusercontent.com/8019099/223422735-795b4341-5751-49ce-bffb-800ee81788d2.jpg" alt="NostrGit"></a>

# How to run locally (production)

## Docker container git-nostr-bridge

Install [Docker](https://www.docker.com/products/docker-desktop/).
These instructions assume you are not running openSSH Server on port 22 on your machine.

```bash
# clone the NostrGit repository
$ git clone https://github.com/NostrGit/NostrGit.git
```

Edit the `gitnostr/Dockerfile`
  - replace the public key (hex) with your public key (hex) in the "gitRepoOwners" section of the JSON
  - optional: add/remove some relays in the "relays" section of the JSON

```bash
# change the directory to NostrGit
$ cd NostrGit
# run the git-nostr-bridge container
$ docker compose up > /dev/null 2>&1 &
```

## git-nostr-cli

To run the cli tool for managing git repositories over nostr:

Make sure you have go installed
```bash
$ go version
```

If the command above doesnt print out something like 

`go version go1.20.2 linux/amd64`, 

you can follow [these instructions](https://go.dev/doc/install) to install go on your system.

```bash
# change directory to gitnostr
$ cd ../gitnostr/
# compile the cli tool (requires go installation)
$ make git-nostr-cli
# Run the git-nostr-cli command once to create the default config file
$ ./bin/gn
```

You should get the message `no relays connected`.

Edit the config file at `~/.config/git-nostr/git-nostr-cli.json`. The file should look something like this

```JSON
{
    "relays": ["wss://relay.damus.io", "wss://nostr.fmt.wiz.biz", "wss://nos.lol"],
    "privateKey": "", // your nostr private key (hex)
    "gitSshBase": "root@localhost" // the docker containers expect this
}
```

You need to publish your public ssh key to the nostr relays to be able to interact with the git-nostr-bridge docker container.
You may need to replace id_rsa.pub with the correct public key file.

```bash
./bin/gn ssh-key add ~/.ssh/id_rsa.pub
```

Create repository and clone it. Replace `<publickey>` with the hex representation of your public key. If you are using a nip05 capable public key you can use the nip05 identifier instead.

```bash
$ ./bin/gn repo create <repo_name>
$ ./bin/gn repo clone  <publickey>:<repo_name>
```

To be able to push to the repository you can set write permission with the following command.

```bash
# public key must be in the hex format
$ ./bin/gn repo permission <repo_name> <publickey> WRITE
```

If you are using a nip05 capable public key you can use the nip05 identifier instead.

```bash
$ ./bin/gn repo permission username@relayaddr WRITE
```

# Environment Variables Configuration

This project uses environment variables for configuration. **You MUST set these up before running the application.**

## 📁 Environment File Locations

### 1. `ui/.env.local` (REQUIRED for Next.js frontend)

**Location**: `/ui/.env.local`  
**Purpose**: Configuration for the Next.js web application  
**Status**: Git-ignored (never committed)

#### Required Variables

```bash
# GitHub OAuth App credentials (REQUIRED for user authentication)
# Get these from: https://github.com/settings/developers
# See detailed setup below
GITHUB_CLIENT_ID=your_github_client_id_here
GITHUB_CLIENT_SECRET=your_github_client_secret_here
```

#### Optional Variables

```bash
# GitHub Platform Token (OPTIONAL - for higher API rate limits)
# Get from: https://github.com/settings/tokens (Personal Access Token)
# Increases rate limit from 60/hour to 5000/hour for server-side API calls
# See GITHUB_PLATFORM_TOKEN_SETUP.md for details
# GITHUB_PLATFORM_TOKEN=ghp_your_personal_access_token_here

# Custom GitHub OAuth redirect URI (defaults to ${origin}/api/github/callback)
# Only needed if using non-standard callback URL
# GITHUB_REDIRECT_URI=http://localhost:3000/api/github/callback

# Default LNbits configuration (users can override in Settings → Account)
# These provide fallback defaults for server-side payments (bounties, splits)
# Used by the SENDER when creating invoices, split payments, and bounty withdraw links
# LNBITS_URL=https://your-lnbits-instance.com
# LNBITS_ADMIN_KEY=your_lnbits_admin_key_here
# 
# Note: Zaps go TO recipients' wallets (from their Nostr profile or repo config).
# LNBITS_URL/ADMIN_KEY is used by the SENDER to create invoices and split payments.
```

### 2. Root `.env` (Optional - for backend/Go services)

**Location**: `/.env` (project root)  
**Purpose**: Configuration for Go backend services (gitnostr bridge)  
**Status**: Git-ignored (never committed)  
**When needed**: Only if running the Go git-nostr-bridge service

#### Variables (all optional for Next.js frontend)

```bash
# LNbits instance for backend services
LNBITS_URL=https://your-lnbits-instance.com
LNBITS_ADMIN_KEY=your_lnbits_admin_key_here

# Nostr Wallet Connect URI (for testing)
NWC_URI=nostr+walletconnect://...

# Blossom storage service (NIP-96) for Git pack/blob storage
BLOSSOM_URL=https://blossom.band

# Default Nostr relays (comma-separated)
RELAYS=wss://relay.damus.io,wss://nos.lol,wss://nostr.wine

# Test Nostr private keys (development only - NEVER use production keys!)
NOSTR_NSEC_1=your_test_nsec_1_here
NOSTR_NSEC_2=your_test_nsec_2_here
```

## 🚀 Setup Instructions

### Step 1: Create GitHub OAuth App

**Why**: Required for users to link their GitHub profiles for contributor matching and repository imports.

**How**:
1. Go to https://github.com/settings/developers
2. Click **"New OAuth App"**
3. Fill in:
   - **Application name**: `ngit` (or your app name)
   - **Homepage URL**: 
     - Development: `http://localhost:3000`
     - Production: `https://gittr.space`
   - **Authorization callback URL**: 
     - Development: `http://localhost:3000/api/github/callback`
     - Production: `https://gittr.space/api/github/callback`
4. Click **"Register application"**
5. **Copy the Client ID** (visible immediately)
6. **Generate a new client secret** and copy it (you'll only see it once!)

### Step 2: Create Environment File

**For local development:**
```bash
cd ui
cp .env.example .env.local
```

**For server/production:**
```bash
cd ui
# Create the file manually
nano .env.local  # or use your preferred editor
```

### Step 3: Add GitHub Credentials

Edit `ui/.env.local` and add:
```bash
GITHUB_CLIENT_ID=Ov23li30sCPC7AVEUT8V
GITHUB_CLIENT_SECRET=your_actual_secret_here
```

### Step 4: (Optional) Configure LNbits Defaults

If you want to provide default LNbits configuration for users:
```bash
LNBITS_URL=https://bitcoindelta.club
LNBITS_ADMIN_KEY=your_admin_key_here
```

**Why**: These provide fallback defaults for server-side operations (bounty payments, split zaps). Users can override these in Settings → Account with their own credentials.

### Step 5: Restart the Application

After creating/updating `.env.local`, restart the Next.js server:

```bash
# Stop the current server (Ctrl+C)
# Then start again
npm run dev
```

## 🌐 Production Deployment

When deploying to production (Vercel, Railway, Render, etc.):

1. **Set environment variables in your hosting platform** (don't upload `.env.local` files):
   - Vercel: Project Settings → Environment Variables
   - Railway: Variables tab
   - Render: Environment section

2. **For GitHub OAuth**:
   - Use your production URL in the GitHub OAuth App settings
   - Set `GITHUB_REDIRECT_URI` to match your production callback URL

3. **Security notes**:
   - Never commit `.env` or `.env.local` files
   - Use different GitHub OAuth apps for dev/production
   - Rotate secrets if accidentally exposed

## 📋 Quick Reference

| Variable | Location | Required | Purpose |
|----------|----------|----------|---------|
| `GITHUB_CLIENT_ID` | `ui/.env.local` | ✅ Yes | GitHub OAuth App ID |
| `GITHUB_CLIENT_SECRET` | `ui/.env.local` | ✅ Yes | GitHub OAuth App Secret |
| `GITHUB_REDIRECT_URI` | `ui/.env.local` | ❌ No | Custom callback URL |
| `LNBITS_URL` | `ui/.env.local` | ❌ No | Default LNbits instance |
| `LNBITS_ADMIN_KEY` | `ui/.env.local` | ❌ No | Default LNbits admin key |
| `BLOSSOM_URL` | `/.env` (root) | ❌ No | Blossom storage (backend only) |
| `RELAYS` | `/.env` (root) | ❌ No | Default Nostr relays |

## 🔒 Security Best Practices

1. ✅ **DO**: Use `.env.example` files with placeholders (safe to commit)
2. ✅ **DO**: Keep `.env` and `.env.local` in `.gitignore`
3. ✅ **DO**: Use different credentials for dev/production
4. ✅ **DO**: Rotate secrets if exposed
5. ❌ **DON'T**: Commit files with real credentials
6. ❌ **DON'T**: Share `.env.local` files
7. ❌ **DON'T**: Use production keys in development

## 🆘 Troubleshooting

**"GitHub OAuth not configured" error:**
- Check that `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set in `ui/.env.local`
- Restart the Next.js server after adding credentials
- Verify the GitHub OAuth App callback URL matches your deployment URL

**404 error when clicking "Connect with GitHub":**
- Ensure `GITHUB_CLIENT_ID` is not empty
- Check that the file is named `.env.local` (not `.env` or `.env.example`)
- Restart the server

**Environment variables not loading:**
- Make sure the file is in the correct location (`ui/.env.local` for Next.js)
- Check file permissions (should be readable)
- Verify variable names match exactly (case-sensitive)

# Development

Fork the repo

```bash
# install yarn packages
$ yarn
# run in development mode (localhost:3000)
$ yarn dev
```

**Note**: Make sure you've set up `ui/.env.local` with GitHub OAuth credentials before running `yarn dev`.

# Questions or discussions

Have a question or a proposal? Create a [new issue](https://github.com/NostrGit/NostrGit/issues/new).

# Contributing

The NostrGit project operates an open contributor model where anyone is welcome to contribute towards development in the form of peer review, documentation, testing and patches. Anyone is invited to contribute without regard to technical experience, "expertise", OSS experience, age, or other concern.

If you are new to contributing to open source projects, please see the [Open Source Guides](https://opensource.guide/how-to-contribute/) on how to get started.

See [contribution guidelines](https://github.com/NostrGit/NostrGit/blob/main/documentation/development/contributing.md).

You may also want to check out the [bitcoin-development](https://github.com/jonatack/bitcoin-development/blob/master/how-to-review-bitcoin-core-prs.md) repository about the principles of Bitcoin development in general. Most of them apply also here. 

## Contributors

<img src="https://contrib.rocks/image?repo=nostrgit/nostrgit" alt="list of contributors" />

# Roadmap

Product

We need to define the product roadmap. We need to figure out what features we want to implement. If you have any idea, please feel free to create a new issue.

UI

- [ ] Mobile Breakpoints
- [ ] Code
  - [ ] Clone with HTTPS
  - [ ] Clone with SSH
  - [ ] Download ZIP
- [ ] Issues
  - [ ] Issues list
    - [ ] Filter by open / closed issues
  - [ ] Single issue
    - [ ] Show details about the issue
    - [ ] Commenting / comment threads
  - [ ] New issue page
- [ ] Pull Requests
  - [ ] Pull requests list
  - [ ] Single pull request page
  - [ ] New pull request page
- [ ] Discussions
- [ ] Insights
  - [ ] Repo statistics
    - Merged pull requests
    - Open pull requests
    - Closed issues
    - New issues
  - [ ] Tabs
    - [ ] Contributors
    - [ ] Commits
    - [ ] Code frequency
    - [ ] Dependency graph
    - [ ] Forks
- [ ] Settings
  - [ ] Edit repository name
  - [ ] Toggle features
    - Wikis
    - Issues
    - Discussions
    - Pull requests
      - Allow merge commits
      - Allow squash merging
      - Allow rebase merging
  - [ ] Danger zone
    - Change repo visibility
    - Transfer ownership
    - Delete repo
  - [ ] Settings tabs
    - [ ] General
    - [ ] Access (collaborators)
      - [ ] View collaborators
      - [ ] Add collaborators
      - [ ] Remove collaborators
    - [ ] Branches
      - [ ] Branch protection rules
    - [ ] Tags
    - [ ] Actions
    - [ ] Secrets and variables

Nostr

- [ ] Login
- [ ] Figure out decentralised data storage
  - [ ] New repository: serve created repository with [GitTorrent](https://github.com/cjb/GitTorrent)
  - [ ] Repo has a public key
    ```JSON
    {
        "pubkey": "abcd123...",
        "nrepo": "nrepo1ris1683fw6n2mvhl5h6dhqd8mqfv3wmxnz4qph83ua4dk4006ezsrt5c24"
    }
    ```
  - [ ] Zap a repo
    - [ ] Zap PRs
  - [ ] Rate a repo
  - [ ] Follow a repo
  - [ ] Comment on a repo
  - [ ] Add bounties

Special Thanks

<a href="https://vercel.com?utm_source=nostrgit&utm_campaign=oss"><img src="https://images.ctfassets.net/e5382hct74si/78Olo8EZRdUlcDUFQvnzG7/fa4cdb6dc04c40fceac194134788a0e2/1618983297-powered-by-vercel.svg" />
