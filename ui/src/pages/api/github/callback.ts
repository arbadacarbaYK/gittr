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
  // We'll handle it in the popup window and close it after posting message to parent
  const { code, state } = req.query;

  // Return HTML that posts message to parent window and closes popup
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
        code: ${JSON.stringify(code || null)},
        state: ${JSON.stringify(state || null)},
        error: ${JSON.stringify(req.query.error || null)}
      }, window.location.origin);
      
      // Close popup after a short delay
      setTimeout(() => {
        window.close();
      }, 500);
    } else {
      // If no opener, redirect to settings page
      window.location.href = '/settings/account';
    }
  </script>
  <p>Completing authentication...</p>
</body>
</html>
  `;

  res.setHeader("Content-Type", "text/html");
  return res.status(200).send(html);
}

