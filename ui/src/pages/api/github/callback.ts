import type { NextApiRequest, NextApiResponse } from "next";
import { setCorsHeaders, handleOptionsRequest } from "@/lib/api/cors";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle OPTIONS request for CORS (GRASP requirement)
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res);
    return;
  }

  // Set CORS headers (GRASP requirement)
  setCorsHeaders(res);

  // This is called by GitHub OAuth redirect
  // Exchange code for token server-side and post result to parent window
  const { code, state, error } = req.query;
  const cookieState = req.cookies.github_oauth_state;

  // If there's an error from GitHub, pass it to parent
  if (error) {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>GitHub Authentication</title>
</head>
<body>
  <script>
    if (window.opener) {
      window.opener.postMessage({
        type: 'GITHUB_OAUTH_CALLBACK',
        error: ${JSON.stringify(error)},
        errorDescription: ${JSON.stringify(req.query.error_description || null)}
      }, window.location.origin);
      setTimeout(() => window.close(), 500);
    } else {
      window.location.href = '/settings/ssh-keys?error=' + encodeURIComponent(${JSON.stringify(error)});
    }
  </script>
  <p>Authentication failed...</p>
</body>
</html>
    `;
    res.setHeader("Content-Type", "text/html");
    return res.status(200).send(html);
  }

  // Verify state token
  if (!state || state !== cookieState) {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>GitHub Authentication</title>
</head>
<body>
  <script>
    if (window.opener) {
      window.opener.postMessage({
        type: 'GITHUB_OAUTH_CALLBACK',
        error: 'Invalid state token'
      }, window.location.origin);
      setTimeout(() => window.close(), 500);
    } else {
      window.location.href = '/settings/ssh-keys?error=invalid_state';
    }
  </script>
  <p>Invalid state token...</p>
</body>
</html>
    `;
    res.setHeader("Content-Type", "text/html");
    return res.status(200).send(html);
  }

  if (!code) {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>GitHub Authentication</title>
</head>
<body>
  <script>
    if (window.opener) {
      window.opener.postMessage({
        type: 'GITHUB_OAUTH_CALLBACK',
        error: 'Authorization code missing'
      }, window.location.origin);
      setTimeout(() => window.close(), 500);
    } else {
      window.location.href = '/settings/ssh-keys?error=no_code';
    }
  </script>
  <p>No authorization code...</p>
</body>
</html>
    `;
    res.setHeader("Content-Type", "text/html");
    return res.status(200).send(html);
  }

  // Exchange code for token server-side
  try {
    const CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";
    const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || "";
    const REDIRECT_URI = process.env.GITHUB_REDIRECT_URI || `${req.headers.origin || "http://localhost:3000"}/api/github/callback`;

    if (!CLIENT_ID || !CLIENT_SECRET) {
      throw new Error("GitHub OAuth not configured");
    }

    // Exchange code for access token
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      throw new Error(tokenData.error_description || tokenData.error);
    }

    const accessToken = tokenData.access_token;

    // Get user profile from GitHub
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/vnd.github.v3+json",
      },
    });

    if (!userResponse.ok) {
      throw new Error("Failed to fetch GitHub profile");
    }

    const userData = await userResponse.json();

    // Return HTML that posts success message to parent window
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>GitHub Authentication</title>
</head>
<body>
  <script>
    // Post message to parent window with auth result
    if (window.opener) {
      window.opener.postMessage({
        type: 'GITHUB_OAUTH_CALLBACK',
        success: true,
        accessToken: ${JSON.stringify(accessToken)},
        githubUsername: ${JSON.stringify(userData.login)},
        githubUrl: ${JSON.stringify(`https://github.com/${userData.login}`)},
        githubId: ${JSON.stringify(userData.id)},
        avatarUrl: ${JSON.stringify(userData.avatar_url)}
      }, window.location.origin);
      
      // Close popup after a short delay
      setTimeout(() => {
        window.close();
      }, 500);
    } else {
      // If no opener, redirect to SSH keys page
      window.location.href = '/settings/ssh-keys';
    }
  </script>
  <p>Completing authentication...</p>
</body>
</html>
    `;

    res.setHeader("Content-Type", "text/html");
    return res.status(200).send(html);
  } catch (error: any) {
    console.error("GitHub OAuth error:", error);
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>GitHub Authentication</title>
</head>
<body>
  <script>
    if (window.opener) {
      window.opener.postMessage({
        type: 'GITHUB_OAUTH_CALLBACK',
        error: ${JSON.stringify(error.message || "OAuth flow failed")}
      }, window.location.origin);
      setTimeout(() => window.close(), 500);
    } else {
      window.location.href = '/settings/ssh-keys?error=' + encodeURIComponent(${JSON.stringify(error.message || "oauth_failed")});
    }
  </script>
  <p>Authentication failed: ${error.message || "Unknown error"}</p>
</body>
</html>
    `;
    res.setHeader("Content-Type", "text/html");
    return res.status(200).send(html);
  }
}

