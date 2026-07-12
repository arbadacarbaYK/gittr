#!/bin/bash
# Apply private-repo HTTPS git ACL to nginx on the gittr server.
# Run after deploying ui/src (needs /api/git/http-auth).
#
# Usage: ./scripts/apply-git-https-auth-nginx.sh <hostname_or_ip>

set -euo pipefail

HOST=${1:-"91.99.86.115"}
KEY=~/.ssh/id_ed25519_hetzner_new

if [ "$HOST" = "YOUR_HETZNER_HOSTNAME_OR_IP" ]; then
  echo "Usage: $0 <hostname_or_ip>"
  exit 1
fi

echo "🔧 Patching nginx git.gittr.space auth_request on $HOST..."

ssh -i "$KEY" root@"$HOST" bash -s <<'REMOTE'
set -euo pipefail
NGINX_SITE="/etc/nginx/sites-available/gittr"

if [ ! -f "$NGINX_SITE" ]; then
  echo "❌ $NGINX_SITE not found"
  exit 1
fi

python3 - <<'PY'
from pathlib import Path
import re

path = Path("/etc/nginx/sites-available/gittr")
text = path.read_text()

auth_block = '''
    location = /_git_auth {
        internal;
        proxy_pass http://127.0.0.1:3000/api/git/http-auth;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header X-Original-URI $request_uri;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header X-Nostr-Auth-Event $http_x_nostr_auth_event;
        proxy_set_header X-Nostr-Pubkey $http_x_nostr_pubkey;
        proxy_set_header X-Nostr-Signature $http_x_nostr_signature;
    }

'''

denied_block = '''
    location @git_auth_denied {
        default_type text/plain;
        return 403 "Repository is private or you lack permission. Use SSH or pass Nostr auth headers (X-Nostr-Auth-Event).\\n";
    }
'''

# Remove misplaced denied block from port-80 redirect server if present
text = re.sub(
    r"(server \{\n    listen 80;\n    server_name git\.gittr\.space;\n    return 301[^\n]*\n)\s*location @git_auth_denied \{[^}]+\}\n",
    r"\1",
    text,
)

pattern = r'(location ~ \^/\(\[\^/\]\+\)/\(\.\+\\\.git\)\(\.\*\)\$ \{)'
if not re.search(pattern, text):
    raise SystemExit("Could not find git.fcgi location block to patch")

if 'location = /_git_auth' not in text:
    text = re.sub(pattern, auth_block + r'\1', text, count=1)

if 'auth_request /_git_auth' not in text:
    text = re.sub(
        pattern,
        r'\1\n        auth_request /_git_auth;\n        auth_request_set $git_auth_status $upstream_status;\n        error_page 401 403 = @git_auth_denied;\n',
        text,
        count=1,
    )

ssl_marker = "    listen 443 ssl http2;\n    server_name git.gittr.space;"
idx = text.find(ssl_marker)
if idx < 0:
    raise SystemExit("git.gittr.space SSL server block not found")
start = text.rfind("\nserver {", 0, idx)
segment = text[start:]
level = 0
end_offset = None
for i, ch in enumerate(segment):
    if ch == "{":
        level += 1
    elif ch == "}":
        level -= 1
        if level == 0:
            end_offset = i
            break
if end_offset is None:
    raise SystemExit("Could not find SSL server block end")
ssl_segment = segment[:end_offset]
if "location @git_auth_denied" not in ssl_segment:
    insert_at = start + end_offset
    text = text[:insert_at] + denied_block + text[insert_at:]

path.write_text(text)
print("✅ Patched nginx site config")
PY

nginx -t
systemctl reload nginx
echo "✅ nginx reloaded"
REMOTE

echo "Done."
