# 413 Request Entity Too Large Fix

## Problem

Chunked pushes were failing at chunk 5+ with nginx 413 errors:
```
client intended to send too large body: 2068807 bytes
```

The chunk size estimation was incorrect, causing chunks to exceed nginx's `client_max_body_size` limit (default ~1-2MB).

## Root Cause

1. **Chunk size too large**: 30 files or 8MB max was still too large for some chunks
2. **Size estimation inaccurate**: Base64 encoding + JSON overhead was underestimated
3. **No 413 error handling**: Client didn't detect nginx rejections, causing hangs

## Fix Applied

### 1. Reduced Chunk Size
- **Before**: 30 files, 8MB max
- **After**: 15 files, 1MB max
- More conservative to avoid nginx rejections

### 2. Improved Size Estimation
- **Before**: `content.length * 1.5 + 500`
- **After**: `content.length * 1.4 + 200`
- More accurate accounting for Base64 encoding and JSON structure overhead

### 3. Better 413 Error Handling
- Check for 413 status **before** parsing JSON (nginx returns HTML)
- Log file paths in rejected chunk for debugging
- Clear error message indicating chunk needs to be smaller

## Server-Side Optimization (Recommended)

To allow larger chunks and improve performance, increase nginx `client_max_body_size`:

```nginx
# In /etc/nginx/sites-available/gittr
server {
    listen 443 ssl http2;
    server_name gittr.space;
    
    # Increase body size limit for large repository pushes
    client_max_body_size 10M;
    
    # ... rest of config
}
```

Then reload nginx:
```bash
sudo nginx -t
sudo systemctl reload nginx
```

With `client_max_body_size 10M`, we can increase chunk size back to:
- 30 files, 8MB max (safer with 10MB limit)

This will reduce the number of chunks and speed up pushes for large repositories.

## Impact

- **Before**: Chunks 1-4 succeeded, chunk 5+ failed with 413, push hung
- **After**: All chunks should succeed (smaller size), but more chunks = slower overall
- **With nginx fix**: Larger chunks = fewer chunks = faster pushes

