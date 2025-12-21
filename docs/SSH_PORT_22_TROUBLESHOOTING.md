# SSH Port 22 Troubleshooting Guide

If you're getting "port 22 unreachable" when trying to access gittr.space via SSH/Git CLI, this guide will help you diagnose and fix the issue.

## Quick Diagnosis

First, test if port 22 is accessible:

```bash
# Test SSH connection
ssh -v git-nostr@gittr.space

# Or test with telnet
telnet gittr.space 22

# Or test with nc (netcat)
nc -zv gittr.space 22
```

**Expected output if working:**
- SSH: Should show connection attempt and authentication prompt
- Telnet/nc: Should show "Connected" or "succeeded"

**If you see "Connection refused" or "Network unreachable":**
- Port 22 is blocked by firewall or not exposed
- Continue with the fixes below

## Common Causes

### 1. Hetzner Cloud Firewall (Most Common)

Hetzner Cloud has a **cloud firewall** that operates independently of the server's local firewall. This is the most common cause of port 22 being unreachable.

#### Fix: Configure Hetzner Cloud Firewall

1. **Log into Hetzner Cloud Console**: https://console.hetzner.cloud/
2. **Navigate to your server** → **Firewalls** tab
3. **Check if a firewall is attached**:
   - If a firewall is attached, click on it to edit
   - If no firewall is attached, create one or attach an existing one
4. **Add SSH rule**:
   - Click **"Add Rule"** or **"Edit Rules"**
   - **Direction**: Inbound
   - **Protocol**: TCP
   - **Port**: 22
   - **Source IPs**: `0.0.0.0/0` (allow from anywhere) OR specific IP ranges for security
   - **Description**: "SSH access for Git operations"
5. **Save** the firewall rules
6. **Apply to server**: Ensure the firewall is attached to your server

**Note**: Changes take effect immediately (no server restart needed).

#### Verify Hetzner Firewall Rules

In Hetzner Cloud Console, your firewall should have these rules:

| Direction | Protocol | Port | Source | Description |
|-----------|----------|------|--------|-------------|
| Inbound | TCP | 22 | 0.0.0.0/0 | SSH for Git |
| Inbound | TCP | 80 | 0.0.0.0/0 | HTTP |
| Inbound | TCP | 443 | 0.0.0.0/0 | HTTPS |
| Outbound | All | All | 0.0.0.0/0 | Allow all outbound |

**Security Note**: For production, consider restricting SSH (port 22) to specific IP ranges instead of `0.0.0.0/0`.

### 2. Server Local Firewall (ufw/iptables)

Even if Hetzner's cloud firewall allows port 22, the server's local firewall might block it.

#### Check ufw Status

```bash
# SSH into your server
ssh root@gittr.space

# Check ufw status
sudo ufw status
```

**If ufw is active**, you need to allow port 22:

```bash
# Allow SSH (port 22)
sudo ufw allow 22/tcp

# Verify
sudo ufw status
```

**If ufw is inactive**, it's not blocking anything (check Hetzner cloud firewall instead).

#### Check iptables (if ufw is not used)

```bash
# Check iptables rules
sudo iptables -L -n -v

# If port 22 is blocked, allow it
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT
sudo iptables-save > /etc/iptables/rules.v4  # Save rules (Debian/Ubuntu)
```

### 3. SSH Service Not Running

The SSH service might not be running on the server.

#### Check SSH Service Status

```bash
# SSH into your server
ssh root@gittr.space

# Check SSH service status
sudo systemctl status sshd
# OR
sudo systemctl status ssh
```

**If service is not running**, start it:

```bash
sudo systemctl start sshd
sudo systemctl enable sshd  # Enable on boot
```

### 4. SSH Configuration Issues

The SSH server might be configured to only listen on specific interfaces or ports.

#### Check SSH Configuration

```bash
# SSH into your server
ssh root@gittr.space

# Check SSH config
sudo nano /etc/ssh/sshd_config
```

**Verify these settings:**

```
# Should listen on all interfaces (default)
# ListenAddress 0.0.0.0

# Should use port 22 (default)
Port 22

# Should allow git-nostr user
AllowUsers git-nostr

# Should allow public key authentication
PubkeyAuthentication yes
```

**After changes, restart SSH:**

```bash
sudo systemctl restart sshd
```

### 5. Network/Firewall on Client Side

Your local network or firewall might be blocking outbound SSH connections.

#### Test from Different Network

Try connecting from:
- A different network (mobile hotspot, different WiFi)
- A different location
- A VPS or cloud instance

If it works from another network, your local firewall/network is blocking it.

#### Check Local Firewall

**Linux:**
```bash
# Check if local firewall is blocking
sudo ufw status
sudo iptables -L
```

**macOS:**
- System Preferences → Security & Privacy → Firewall
- Check if firewall is blocking SSH connections

**Windows:**
- Windows Defender Firewall → Check if SSH/port 22 is blocked

## Step-by-Step Fix Checklist

Use this checklist to systematically fix the issue:

- [ ] **Step 1**: Check Hetzner Cloud Firewall
  - [ ] Log into Hetzner Cloud Console
  - [ ] Navigate to server → Firewalls
  - [ ] Verify firewall is attached
  - [ ] Add/verify rule: Inbound TCP port 22
  - [ ] Save and apply

- [ ] **Step 2**: Check Server Local Firewall
  - [ ] SSH into server (if possible via Hetzner console)
  - [ ] Check `sudo ufw status`
  - [ ] If active, run `sudo ufw allow 22/tcp`
  - [ ] Verify with `sudo ufw status`

- [ ] **Step 3**: Check SSH Service
  - [ ] Check `sudo systemctl status sshd`
  - [ ] If not running, start with `sudo systemctl start sshd`
  - [ ] Enable on boot: `sudo systemctl enable sshd`

- [ ] **Step 4**: Check SSH Configuration
  - [ ] Verify `/etc/ssh/sshd_config` allows `git-nostr` user
  - [ ] Verify `Port 22` is set
  - [ ] Restart SSH: `sudo systemctl restart sshd`

- [ ] **Step 5**: Test Connection
  - [ ] From client: `ssh -v git-nostr@gittr.space`
  - [ ] Should see connection and authentication prompt
  - [ ] If still failing, check client-side firewall

## Verification Commands

After applying fixes, verify everything works:

```bash
# 1. Test SSH connection
ssh -v git-nostr@gittr.space

# 2. Test Git clone
git clone git@gittr.space:<npub>/<repo-name>.git

# 3. Check SSH service on server
sudo systemctl status sshd

# 4. Check firewall rules on server
sudo ufw status
# OR
sudo iptables -L -n -v

# 5. Check if port 22 is listening
sudo netstat -tlnp | grep :22
# OR
sudo ss -tlnp | grep :22
```

## Alternative: Use HTTPS Instead

If SSH continues to be problematic, you can use HTTPS for Git operations:

```bash
# Clone via HTTPS (no SSH keys needed for read-only)
git clone https://git.gittr.space/<npub>/<repo-name>.git

# For push operations, you'll need to set up authentication
# See SSH_GIT_GUIDE.md for details
```

**Note**: HTTPS cloning works for read-only access. For push operations, SSH is still recommended.

## Getting Help

If none of these fixes work:

1. **Check server logs**:
   ```bash
   sudo journalctl -u sshd -n 50
   ```

2. **Check bridge service logs**:
   ```bash
   sudo journalctl -u git-nostr-bridge -n 50
   ```

3. **Contact support** with:
   - Output of `ssh -v git-nostr@gittr.space`
   - Output of `sudo ufw status`
   - Screenshot of Hetzner Cloud Firewall rules
   - Output of `sudo systemctl status sshd`

## Prevention

To prevent this issue in the future:

1. **Document firewall rules**: Keep a record of all firewall rules (Hetzner cloud + server local)
2. **Use Infrastructure as Code**: Consider using Terraform or Ansible to manage firewall rules
3. **Monitor SSH access**: Set up alerts for SSH connection failures
4. **Regular audits**: Periodically verify firewall rules are correct

## Related Documentation

- [SSH_GIT_GUIDE.md](SSH_GIT_GUIDE.md) - Complete SSH & Git access guide
- [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) - Server deployment instructions
- [SETUP_INSTRUCTIONS.md](SETUP_INSTRUCTIONS.md) - Detailed setup guide

