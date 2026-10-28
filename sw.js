// Bump VERSION whenever HTML or media is published, including same-name images.
const VERSION = "2026-10-28-v2";
const CACHE_PREFIX = "babyface-koryo-";
const CACHE_NAME = CACHE_PREFIX + VERSION;
const scopeURL = new URL(self.registration.scope);
const assetURL = path => new URL(path, scopeURL).href;
const HTML_URL = assetURL("index.html");
const CORE = ["index.html", "manifest.webmanifest"];
const MEDIA = [
  "payment.png", "ranking.png", "instagram.mp4", "food.png", "dessert.png",
  "drink.png", "koryo.png", "lunch.png", "close.png",
  "halloween-2026.png", "seasonal-shrimp-2026.jpg"
];
const ASSETS = new Set([...CORE, ...MEDIA].map(assetURL));

async function download(cache, path) {
  const url = assetURL(path);
  const response = await fetch(url, { cache: "reload" });
  if (response.status !== 200) {
    throw new Error(`Precache failed: ${path} (${response.status})`);
  }
  await cache.put(url, response);
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Do not replace a working app if the new HTML itself cannot be downloaded.
    await Promise.all(CORE.map(path => download(cache, path)));
    // One unavailable image must not prevent the new worker from installing.
    await Promise.all(MEDIA.map(path => download(cache, path).catch(error => {
      console.warn(error);
    })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    // Never delete other applications' caches on the same GitHub Pages origin.
    const names = await caches.keys();
    await Promise.all(names.filter(name =>
      name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME
    ).map(name => caches.delete(name)));
    await self.clients.claim();
    // Old HTML has no update listener. Navigate it once when this worker activates.
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    await Promise.all(windows.filter(client => {
      const url = new URL(client.url);
      return url.origin === scopeURL.origin && url.pathname.startsWith(scopeURL.pathname);
    }).map(client => client.navigate(client.url).catch(error => console.warn(error))));
  })());
});

async function networkFirst(request, key) {
  const cache = await caches.open(CACHE_NAME);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let response;
  try {
    // Revalidate HTTP caches as well as avoiding stale Cache Storage responses.
    response = await fetch(request, { cache: "no-cache", signal: controller.signal });
    if (response.status === 200) {
      // Storage quota failures must not discard a successful network response.
      await cache.put(key, response.clone()).catch(error => console.warn(error));
      return response;
    }
  } catch (error) {
    // Offline / timeout: use only this release's cache, never an old HTML cache.
  } finally {
    clearTimeout(timeout);
  }
  const cached = await cache.match(key);
  return cached || response || Response.error();
}

async function videoResponse(request) {
  // Keep full video cached; partial (206) responses cannot be stored in Cache API.
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request.url);
  if (!cached) return fetch(request);
  const range = request.headers.get("Range");
  if (!range) return cached;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return fetch(request);
  const data = await cached.arrayBuffer();
  const size = data.byteLength;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1]
    ? (match[2] ? Math.min(Number(match[2]), size - 1) : size - 1)
    : size - 1;
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  return new Response(data.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": cached.headers.get("Content-Type") || "video/mp4",
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes"
    }
  });
}

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== scopeURL.origin ||
      !url.pathname.startsWith(scopeURL.pathname)) return;
  if (request.mode === "navigate" &&
      (url.pathname === scopeURL.pathname || url.pathname === new URL(HTML_URL).pathname)) {
    event.respondWith(networkFirst(request, HTML_URL));
  } else if (ASSETS.has(url.href)) {
    event.respondWith(url.href === assetURL("instagram.mp4")
      ? videoResponse(request)
      : networkFirst(request, url.href));
  }
});
