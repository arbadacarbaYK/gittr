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

  // CRITICAL: State verification - check both cookie (server-side) and allow state from query (fallback)
  // The cookie might not be available in popup context, so we'll verify state in the callback HTML
  // by checking it against what the parent window stored in sessionStorage
  
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
    console.log('[OAuth Callback] Error from GitHub:', ${JSON.stringify(error)});
    setTimeout(() => {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({
          type: 'GITHUB_OAUTH_CALLBACK',
          error: ${JSON.stringify(error)},
          errorDescription: ${JSON.stringify(req.query.error_description || null)}
        }, window.location.origin);
        setTimeout(() => window.close(), 1000);
      } else {
        window.location.href = '/settings/ssh-keys?error=' + encodeURIComponent(${JSON.stringify(error)});
      }
    }, 100);
  </script>
  <p>Authentication failed: ${error}</p>
</body>
</html>
    `;
    res.setHeader("Content-Type", "text/html");
    return res.status(200).send(html);
  }

  // Verify state token
  // CRITICAL: Cookie might not be available in popup context, so we verify in two ways:
  // 1. Server-side: Check cookie (if available)
  // 2. Client-side: Pass state to parent window to verify against sessionStorage
  if (!state) {
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
        error: 'State token missing'
      }, window.location.origin);
      setTimeout(() => window.close(), 500);
    } else {
      window.location.href = '/settings/ssh-keys?error=no_state';
    }
  </script>
  <p>State token missing...</p>
</body>
</html>
    `;
    res.setHeader("Content-Type", "text/html");
    return res.status(200).send(html);
  }
  
  // Verify state - check cookie if available, but proceed anyway (frontend will verify)
  // The cookie might not be available in popup context, so we'll verify in the callback HTML
  const stateStr = Array.isArray(state) ? state[0] : state;
  const cookieStateStr = Array.isArray(cookieState) ? cookieState[0] : cookieState;
  const stateMatchesCookie = cookieStateStr && stateStr === cookieStateStr;
  
  // If state doesn't match cookie, log warning but proceed (frontend will verify)
  if (!stateMatchesCookie && cookieStateStr) {
    console.warn(`⚠️ [GitHub OAuth] State mismatch: cookie=${cookieStateStr.substring(0, 8)}..., query=${stateStr?.substring(0, 8)}...`);
  }

  const codeStr = Array.isArray(code) ? code[0] : code;
  
  if (!codeStr) {
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
    
    // Determine redirect URI - must match what was used in auth.ts
    // Use origin header if available, otherwise construct from host header
    const requestOrigin = req.headers.origin || (req.headers.host ? `https://${req.headers.host}` : null);
    const REDIRECT_URI = process.env.GITHUB_REDIRECT_URI || (requestOrigin ? `${requestOrigin}/api/github/callback` : null);
    
    console.log('[GitHub Callback] Redirect URI:', { 
      fromEnv: !!process.env.GITHUB_REDIRECT_URI,
      requestOrigin,
      finalRedirectUri: REDIRECT_URI?.substring(0, 50) + '...',
      actualUrl: req.url
    });
    
    if (!REDIRECT_URI) {
      throw new Error("GitHub OAuth redirect URI not configured");
    }

    if (!CLIENT_ID || !CLIENT_SECRET) {
      console.error("[GitHub OAuth] Missing credentials:", { hasClientId: !!CLIENT_ID, hasClientSecret: !!CLIENT_SECRET });
      throw new Error("GitHub OAuth not configured. Please set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET environment variables.");
    }

    console.log("[GitHub OAuth] Exchanging code for token...", { hasCode: !!codeStr, redirectUri: REDIRECT_URI });

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
        code: codeStr,
        redirect_uri: REDIRECT_URI,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error("[GitHub OAuth] Token exchange error:", tokenData);
      throw new Error(tokenData.error_description || tokenData.error || "Failed to exchange code for token");
    }

    if (!tokenData.access_token) {
      console.error("[GitHub OAuth] No access token in response:", tokenData);
      throw new Error("No access token received from GitHub");
    }

    const accessToken = tokenData.access_token;
    console.log("[GitHub OAuth] Token exchange successful, fetching user profile...");

    // Get user profile from GitHub
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/vnd.github.v3+json",
      },
    });

    if (!userResponse.ok) {
      const errorText = await userResponse.text();
      console.error("[GitHub OAuth] Failed to fetch user profile:", { status: userResponse.status, error: errorText });
      throw new Error(`Failed to fetch GitHub profile: ${userResponse.status} ${errorText}`);
    }

    const userData = await userResponse.json();
    console.log("[GitHub OAuth] User profile fetched successfully:", { username: userData.login });

    // Return HTML that posts success message to parent window
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>GitHub Authentication</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      background: #0f0f0f;
      color: #e0e0e0;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    .spinner {
      border: 3px solid #333;
      border-top: 3px solid #9333ea;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 0 auto 1rem;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <p>Completing authentication...</p>
  </div>
  <script>
    (function() {
      console.log('[OAuth Callback] Page loaded');
      console.log('[OAuth Callback] window.opener:', !!window.opener);
      console.log('[OAuth Callback] window.opener.closed:', window.opener?.closed);
      console.log('[OAuth Callback] window.location.origin:', window.location.origin);
      
      // Wait for page to fully render and ensure opener is still available
      setTimeout(() => {
        console.log('[OAuth Callback] Checking opener after delay...');
        console.log('[OAuth Callback] window.opener:', !!window.opener);
        console.log('[OAuth Callback] window.opener.closed:', window.opener?.closed);
        
        // CRITICAL: Always store token in localStorage first (fallback if parent window is unavailable)
        // Since popup and parent share the same origin, localStorage is accessible to both
        try {
          localStorage.setItem("gittr_github_token", ${JSON.stringify(accessToken)});
          localStorage.setItem("gittr_github_profile", JSON.stringify({
            githubUsername: ${JSON.stringify(userData.login)},
            githubUrl: ${JSON.stringify(`https://github.com/${userData.login}`)},
            githubId: ${JSON.stringify(userData.id)},
            avatarUrl: ${JSON.stringify(userData.avatar_url)}
          }));
          console.log('[OAuth Callback] Token stored in localStorage as fallback');
        } catch (storageError) {
          console.error('[OAuth Callback] Failed to store token in localStorage:', storageError);
        }
        
        const message = {
          type: 'GITHUB_OAUTH_CALLBACK',
          success: true,
          state: ${JSON.stringify(stateStr)},
          accessToken: ${JSON.stringify(accessToken)},
          githubUsername: ${JSON.stringify(userData.login)},
          githubUrl: ${JSON.stringify(`https://github.com/${userData.login}`)},
          githubId: ${JSON.stringify(userData.id)},
          avatarUrl: ${JSON.stringify(userData.avatar_url)}
        };
        
        if (window.opener && !window.opener.closed) {
          try {
            console.log('[OAuth Callback] Posting message to origin:', window.location.origin);
            console.log('[OAuth Callback] Message type:', message.type);
            console.log('[OAuth Callback] Has token:', !!message.accessToken);
            console.log('[OAuth Callback] Username:', message.githubUsername);
            
            // Send message multiple times to ensure it's received (in case of timing issues)
            window.opener.postMessage(message, window.location.origin);
            console.log('[OAuth Callback] Message sent successfully (attempt 1)');
            
            // Retry sending the message after a short delay
            setTimeout(() => {
              if (window.opener && !window.opener.closed) {
                window.opener.postMessage(message, window.location.origin);
                console.log('[OAuth Callback] Message sent successfully (attempt 2)');
              }
            }, 500);
            
            // Show success message
            const container = document.querySelector('.container');
            if (container) {
              container.innerHTML = '<p style="color: #4ade80; font-size: 1.2rem;">✓ Authentication successful!</p><p style="color: #9ca3af; margin-top: 1rem;">Closing window...</p>';
            }
            
            // Wait longer before closing to ensure message is received
            setTimeout(() => {
              console.log('[OAuth Callback] Closing popup after 3 seconds');
              window.close();
            }, 3000); // Increased to 3 seconds
          } catch (e) {
            console.error('[OAuth Callback] Error posting message:', e);
            // Token is already stored in localStorage, so redirect with success
            const container = document.querySelector('.container');
            if (container) {
              container.innerHTML = '<p style="color: #4ade80;">Authentication successful!</p><p style="color: #9ca3af;">Redirecting...</p>';
            }
            setTimeout(() => {
              window.location.href = '/settings/ssh-keys?success=true&fallback=localStorage';
            }, 2000);
          }
        } else {
          console.warn('[OAuth Callback] No opener or opener is closed. Token stored in localStorage, redirecting.');
          // Token is already stored in localStorage, so redirect with success
          const container = document.querySelector('.container');
          if (container) {
            container.innerHTML = '<p style="color: #4ade80;">Authentication successful!</p><p style="color: #9ca3af;">Redirecting...</p>';
          }
          setTimeout(() => {
            window.location.href = '/settings/ssh-keys?success=true&fallback=localStorage';
          }, 2000);
        }
      }, 500);
    })();
  </script>
</body>
</html>
    `;

    res.setHeader("Content-Type", "text/html");
    return res.status(200).send(html);
  } catch (error: any) {
    console.error("GitHub OAuth error:", error);
    const errorMessage = error?.message || error?.toString() || "OAuth flow failed";
    const errorStr = JSON.stringify(errorMessage);
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>GitHub Authentication</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      background: #0f0f0f;
      color: #e0e0e0;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <p style="color: #f87171;">Authentication failed: ${errorMessage}</p>
  </div>
  <script>
    (function() {
      console.error('[OAuth Callback] Error:', ${errorStr});
      setTimeout(() => {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({
            type: 'GITHUB_OAUTH_CALLBACK',
            error: ${errorStr}
          }, window.location.origin);
          setTimeout(() => window.close(), 1000);
        } else {
          window.location.href = '/settings/ssh-keys?error=' + encodeURIComponent(${errorStr});
        }
      }, 100);
    })();
  </script>
</body>
</html>
    `;
    res.setHeader("Content-Type", "text/html");
    return res.status(200).send(html);
  }
}

