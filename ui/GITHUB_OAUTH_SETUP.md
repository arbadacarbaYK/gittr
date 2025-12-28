# GitHub OAuth Setup

> **✅ This setup is now actively used for private repository access.**
>
> Users can connect their GitHub account via **Settings → SSH Keys → Connect GitHub** to:
> - Import private repositories
> - View file content from private repositories
> - The OAuth token is stored securely in browser localStorage and passed to the API for authenticated requests
>
> For platform API requests (5000 requests/hour for public repos), use **Personal Access Token (PAT)** - see `GITHUB_PLATFORM_TOKEN_SETUP.md`.

This document explains how to set up GitHub OAuth App credentials for user authentication:

1. **Create a GitHub OAuth App**:
   - Go to https://github.com/settings/developers
   - Click "New OAuth App" (or edit existing app if you already have one)
   - Fill in:
     - **Application name**: `gittr` ⚠️ **IMPORTANT**: This name appears in the OAuth popup. Use "gittr" not "ngit".
     - **Homepage URL**: `http://localhost:3000` (or your production URL)
     - **Authorization callback URL**: `http://localhost:3000/api/github/callback` (or your production URL + `/api/github/callback`)
   - Click "Register application" (or "Update application" if editing)
   - **Copy the Client ID** (visible immediately)
   - **Generate a new client secret** and copy it (you'll only see it once!)
   
   **Note**: If you already have an OAuth App registered as "ngit", you can edit it and change the Application name to "gittr". This will update what users see in the OAuth authorization popup.

2. **Add credentials to `.env.local`**:
   - Create a file `.env.local` in the `ui/` directory
   - Add your credentials:
     ```
     GITHUB_CLIENT_ID=your_client_id_here
     GITHUB_CLIENT_SECRET=your_client_secret_here
     GITHUB_REDIRECT_URI=https://yourdomain.com/api/github/callback
     ```
   - **Note**: `GITHUB_REDIRECT_URI` is optional - if not set, it will be automatically determined from the request origin. For production, it's recommended to set it explicitly.

3. **Restart the dev server**:
   - Stop the current server (Ctrl+C)
   - Run `npm run dev` again to load the new environment variables

**Note**: `.env.local` is git-ignored and should NOT be committed. These are secret credentials.

For production, set these same environment variables in your hosting platform (Vercel, Railway, etc.).

## How It Works

1. **User initiates OAuth**: User clicks "Connect GitHub" in Settings → SSH Keys
2. **OAuth popup opens**: User authorizes the app on GitHub
3. **Token storage**: Access token is stored in browser `localStorage` (key: `gittr_github_token`)
4. **API calls**: When fetching files from private repos, the frontend passes the token as `githubToken` query parameter to `/api/git/file-content`
5. **Token priority**: The API prioritizes user tokens (for private repos) over platform tokens (for public repos)

## Security Notes

- Tokens are stored in browser localStorage (same-origin only)
- Tokens are never exposed in URLs or logs
- Tokens are only sent to your own API endpoint (same origin)
- CSRF protection via state tokens stored in `sessionStorage`
- One-time use state tokens prevent replay attacks

