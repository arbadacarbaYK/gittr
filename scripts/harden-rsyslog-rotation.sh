#!/bin/bash
# Harden rsyslog rotation on server to prevent disk fill from log bursts.
# Usage:
#   SERVER=root@91.99.86.115 ./scripts/harden-rsyslog-rotation.sh
# Optional:
#   SSH_KEY=~/.ssh/id_ed25519_hetzner_new

set -euo pipefail

SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_hetzner_new}"
: "${SERVER:?Set SERVER=root@<hostname_or_ip> (example: export SERVER=root@91.99.86.115)}"

echo "🔐 Applying rsyslog logrotate hardening on $SERVER..."

ssh -i "$SSH_KEY" "$SERVER" "bash -s" <<'EOF'
set -euo pipefail

cp -a /etc/logrotate.d/rsyslog "/etc/logrotate.d/rsyslog.bak-$(date +%Y%m%d-%H%M%S)"

cat > /etc/logrotate.d/rsyslog <<'RSYSLOGCFG'
/var/log/syslog
/var/log/mail.log
/var/log/kern.log
/var/log/auth.log
/var/log/user.log
/var/log/cron.log
{
    daily
    rotate 14
    missingok
    notifempty
    compress
    delaycompress
    dateext
    maxsize 200M
    minsize 1M
    create 0640 syslog adm
    sharedscripts
    postrotate
        /usr/lib/rsyslog/rsyslog-rotate
    endscript
}
RSYSLOGCFG

cat > /etc/cron.hourly/logrotate-hourly <<'HOURLY'
#!/bin/sh
/usr/bin/flock -n /run/logrotate-hourly.lock /usr/sbin/logrotate /etc/logrotate.conf >/dev/null 2>&1
HOURLY
chmod 755 /etc/cron.hourly/logrotate-hourly

logrotate /etc/logrotate.d/rsyslog || true

echo "✅ Hardened rsyslog rotation settings applied."
df -h /
du -xsh /var/log
ls -lh /var/log/syslog*
EOF

echo "✅ Done."
