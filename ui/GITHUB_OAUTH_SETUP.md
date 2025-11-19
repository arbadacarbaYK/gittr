# GitHub OAuth Setup

To enable GitHub authentication, you need to:

1. **Create a GitHub OAuth App**:
   - Go to https://github.com/settings/developers
   - Click "New OAuth App"
   - Fill in:
     - **Application name**: `ngit` (or any name you like)
     - **Homepage URL**: `http://localhost:3000` (or your production URL)
     - **Authorization callback URL**: `http://localhost:3000/api/github/callback` (or your production URL + `/api/github/callback`)
   - Click "Register application"
   - **Copy the Client ID** (visible immediately)
   - **Generate a new client secret** and copy it (you'll only see it once!)

2. **Add credentials to `.env.local`**:
   - Create a file `.env.local` in the `ui/` directory
   - Add your credentials:
     ```
     GITHUB_CLIENT_ID=your_client_id_here
     GITHUB_CLIENT_SECRET=your_client_secret_here
     ```

3. **Restart the dev server**:
   - Stop the current server (Ctrl+C)
   - Run `npm run dev` again to load the new environment variables

**Note**: `.env.local` is git-ignored and should NOT be committed. These are secret credentials.

For production, set these same environment variables in your hosting platform (Vercel, Railway, etc.).

