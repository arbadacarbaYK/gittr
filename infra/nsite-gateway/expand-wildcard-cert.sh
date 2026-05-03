#!/usr/bin/env bash
# Run ON THE SERVER as root, after:
#   1. Cloudflare has A record *.pages → origin (proxied or DNS-only both OK for DNS-01).
#   2. File /root/.secrets/cloudflare.ini exists with:
#        dns_cloudflare_api_token = <API token: Zone → DNS → Edit for gittr.space>
#      chmod 600 /root/.secrets/cloudflare.ini
#
# Expands the existing Let's Encrypt cert "pages.gittr.space" to include *.pages.gittr.space
# (same paths under /etc/letsencrypt/live/pages.gittr.space/).

set -euo pipefail
CF="${CF:-/root/.secrets/cloudflare.ini}"
if [[ ! -s "$CF" ]]; then
  echo "Missing $CF — create it with dns_cloudflare_api_token = ... (see docs/SETUP_INSTRUCTIONS.md)"
  exit 1
fi
chmod 600 "$CF"

certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials "$CF" \
  --dns-cloudflare-propagation-seconds 45 \
  --cert-name pages.gittr.space \
  --expand \
  -d pages.gittr.space \
  -d '*.pages.gittr.space' \
  --non-interactive --agree-tos --register-unsafely-without-email

echo "✅ Certificate expanded. Update nginx server_name for HTTPS + port 80 blocks to:"
echo "   server_name pages.gittr.space *.pages.gittr.space;"
echo "   (Port 80: use a single return 301 https://\$host\$request_uri; — remove certbot if-block that returns 404 for other hosts.)"
echo "Then: nginx -t && systemctl reload nginx"
