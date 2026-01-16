import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";

import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Handle OPTIONS request for CORS (GRASP requirement)
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res);
    return;
  }

  // Set CORS headers (GRASP requirement)
  setCorsHeaders(res);

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // GitHub OAuth App credentials
  // These should be set as environment variables
  const CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";
  const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || "";

  // Determine redirect URI - prioritize env var, then use request origin
  // Use origin header if available, otherwise construct from host header
  const requestOrigin =
    req.headers.origin ||
    (req.headers.host ? `https://${req.headers.host}` : null);
  const REDIRECT_URI =
    process.env.GITHUB_REDIRECT_URI ||
    (requestOrigin ? `${requestOrigin}/api/github/callback` : null);

  console.log("[GitHub Auth] Redirect URI:", {
    fromEnv: !!process.env.GITHUB_REDIRECT_URI,
    requestOrigin,
    finalRedirectUri: REDIRECT_URI?.substring(0, 50) + "...",
  });

  if (!REDIRECT_URI) {
    return res.status(500).json({
      error:
        "GitHub OAuth redirect URI not configured. Please set GITHUB_REDIRECT_URI environment variable.",
    });
  }

  if (req.query.action === "initiate") {
    // Check if credentials are configured
    if (!CLIENT_ID || !CLIENT_SECRET) {
      return res.status(500).json({
        error:
          "GitHub OAuth not configured. Please set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET environment variables. See GITHUB_OAUTH_SETUP.md for instructions.",
      });
    }

    // Generate state token for CSRF protection
    const state = Buffer.from(`${Date.now()}-${Math.random()}`).toString(
      "base64"
    );

    // Store state in cookie (httpOnly, secure in production)
    res.setHeader(
      "Set-Cookie",
      `github_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`
    );

    // Redirect to GitHub OAuth
    // Request 'repo' scope for private repo access, 'read:user' for basic profile
    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
      REDIRECT_URI
    )}&scope=read:user%20repo&state=${state}`;

    return res.status(200).json({
      authUrl: githubAuthUrl,
      state: state,
    });
  }

  if (req.query.action === "callback") {
    // Check if credentials are configured
    if (!CLIENT_ID || !CLIENT_SECRET) {
      return res.status(500).json({
        error:
          "GitHub OAuth not configured. Please set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET environment variables.",
      });
    }

    const { code, state } = req.query;
    const cookieState = req.cookies.github_oauth_state;

    // Verify state token
    if (!state || state !== cookieState) {
      return res.status(400).json({ error: "Invalid state token" });
    }

    if (!code) {
      return res.status(400).json({ error: "Authorization code missing" });
    }

    try {
      // Exchange code for access token
      const tokenResponse = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code: code,
            redirect_uri: REDIRECT_URI,
          }),
        }
      );

      const tokenData = await tokenResponse.json();

      if (tokenData.error) {
        return res
          .status(400)
          .json({ error: tokenData.error_description || tokenData.error });
      }

      const accessToken = tokenData.access_token;

      // Get user profile from GitHub
      const userResponse = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (!userResponse.ok) {
        return res
          .status(500)
          .json({ error: "Failed to fetch GitHub profile" });
      }

      const userData = await userResponse.json();

      // Return user data and access token to be saved by frontend
      // Token is needed for private repo access
      return res.status(200).json({
        success: true,
        githubUrl: `https://github.com/${userData.login}`,
        githubUsername: userData.login,
        githubId: userData.id,
        avatarUrl: userData.avatar_url,
        accessToken: accessToken, // Include token for private repo access
      });
    } catch (error: any) {
      console.error("GitHub OAuth error:", error);
      return res
        .status(500)
        .json({ error: error.message || "OAuth flow failed" });
    }
  }

  return res.status(400).json({ error: "Invalid action" });
}
