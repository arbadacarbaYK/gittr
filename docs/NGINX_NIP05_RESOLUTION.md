# NIP-05 Resolution for git.gittr.space

This document explains how to configure nginx to support NIP-05 format URLs for git.gittr.space.

## Problem

other clients may try to access repos using NIP-05 format:
```
https://git.gittr.space/geek@primal.net/nostr-hypermedia.git
```

But git.gittr.space only supports npub format:
```
https://git.gittr.space/npub1.../nostr-hypermedia.git
```

## Solution

Add nginx rules to intercept NIP-05 URLs (containing "@") and proxy them to Next.js resolver endpoint, which resolves NIP-05 to npub and redirects.

## Nginx Configuration

Update `/etc/nginx/sites-available/gittr` for the `git.gittr.space` server block:

```nginx
server {
    listen 443 ssl http2;
    server_name git.gittr.space;
    
    ssl_certificate /etc/letsencrypt/live/git.gittr.space/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/git.gittr.space/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    
    # CRITICAL: Intercept NIP-05 format URLs (containing @) and proxy to Next.js resolver
    # Format: /geek@primal.net/nostr-hypermedia.git
    location ~ ^/([^/]+@[^/]+)/(.+)$ {
        # Proxy to Next.js resolver endpoint
        proxy_pass http://127.0.0.1:3000/api/git/nip05-resolve?entity=$1&repo=$2;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_redirect off;
    }
    
    # Git bridge HTTP service (git-nostr-bridge) for npub/hex format URLs
    # Default port is 8080, adjust if your bridge uses a different port
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        
        # Git smart HTTP protocol requires these headers
        proxy_buffering off;
        proxy_request_buffering off;
    }
}
```

## How It Works

1. **NIP-05 URL arrives**: `https://git.gittr.space/geek@primal.net/nostr-hypermedia.git`
2. **Nginx intercepts**: The regex `^/([^/]+@[^/]+)/(.+)$` matches URLs with "@" in the first segment
3. **Proxies to Next.js**: Forwards to `http://127.0.0.1:3000/api/git/nip05-resolve?entity=geek@primal.net&repo=nostr-hypermedia.git`
4. **Next.js resolves**: The API endpoint resolves NIP-05 to npub using `nip05.queryProfile()`
5. **Redirects**: Returns 301 redirect to `https://git.gittr.space/npub1.../nostr-hypermedia.git`
6. **Git client follows redirect**: Git automatically follows the redirect and clones from the npub URL

## Testing

After updating nginx config:

```bash
sudo nginx -t  # Test configuration
sudo systemctl reload nginx  # Reload nginx
```

Test the resolver endpoint:
```bash
curl -I "https://git.gittr.space/geek@primal.net/nostr-hypermedia.git"
# Should return 301 redirect to npub format URL
```

## Alternative: Using fcgiwrap (git-http-backend)

If you're using fcgiwrap instead of proxying to port 8080, the configuration is similar but you need to handle the redirect differently since git-http-backend doesn't support redirects well. In that case, you might want to:

1. Use the Next.js resolver to create a symlink from NIP-05 format to npub directory
2. Or always proxy through Next.js for NIP-05 URLs

