const CACHE_NAME = "gittr-pwa-v4";

const CORE_ASSETS = [
  "/offline.html",
  "/site.webmanifest",
  "/favicon.ico",
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
  "/apple-touch-icon.png",
];

/** Next.js hashed chunks must never be cache-first — stale chunks 404 after deploy. */
function isNextAsset(pathname) {
  return pathname.startsWith("/_next/");
}

/**
 * App Router soft navigations fetch RSC/Flight payloads (not mode:"navigate").
 * Those payloads embed hashed chunk names — caching them serves stale chunk
 * maps after a deploy → webpack "undefined (reading 'call')" / React #418
 * until a hard refresh. Never cache them.
 */
function isRscRequest(request, requestUrl) {
  if (request.headers.get("RSC")) return true;
  if (request.headers.get("Next-Router-State-Tree")) return true;
  if (request.headers.get("Next-Router-Prefetch")) return true;
  const accept = request.headers.get("Accept") || "";
  if (accept.includes("text/x-component")) return true;
  if (requestUrl.searchParams.has("_rsc")) return true;
  return false;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;
  if (!isSameOrigin) return;

  if (isNextAsset(requestUrl.pathname)) {
    return;
  }

  if (isRscRequest(request, requestUrl)) {
    return;
  }

  const isApiRequest = requestUrl.pathname.startsWith("/api/");
  const isNavigation = request.mode === "navigate";

  if (isNavigation) {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline.html"))
    );
    return;
  }

  if (isApiRequest) {
    return;
  }

  // Only cache-first the small static shell (icons, manifest, offline page).
  // App routes / dynamic HTML must always hit the network so a deploy never
  // leaves stale page data pointing at removed chunks.
  const isCoreAsset = CORE_ASSETS.includes(requestUrl.pathname);
  const isStaticFile =
    /\.(png|ico|svg|webmanifest|woff2?|ttf|jpg|jpeg|gif|webp|css|js|txt|xml)$/i.test(
      requestUrl.pathname
    );
  if (!isCoreAsset && !isStaticFile) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (!response || response.status !== 200) return response;
          const responseClone = response.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(request, responseClone));
          return response;
        })
        .catch(() => {
          // Fail open: a rejected FetchEvent surfaces as a hard network error
          // (the "sw.js Failed to fetch" console noise) — return a plain
          // network-failure response instead of killing the event.
          return Response.error();
        });
    })
  );
});
