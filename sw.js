// questlog service worker.
//
// There is no backend, so "offline" is the normal case rather than a fallback:
// the whole app is precached on install and served from the cache first, with a
// quiet background refresh so a redeploy is picked up on the next launch.

const VERSION = 'questlog-20260826-0004';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/styles.css',
  './src/ui/app.js',
  './src/ui/dom.js',
  './src/ui/store.js',
  './src/ui/storage.js',
  './src/ui/components.js',
  './src/ui/forms.js',
  './src/ui/install.js',
  './src/ui/syncclient.js',
  './src/ui/views/today.js',
  './src/ui/views/projects.js',
  './src/ui/views/stats.js',
  './src/ui/views/settings.js',
  './src/core/dates.js',
  './src/core/ids.js',
  './src/core/xp.js',
  './src/core/streaks.js',
  './src/core/ledger.js',
  './src/core/schema.js',
  './src/core/state.js',
  './src/core/merge.js',
  './src/core/io.js',
  './src/core/selectors.js',
  './src/core/sync.js',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // addAll is all-or-nothing; add individually so one bad path cannot break install.
    await Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' }))
      .catch((err) => console.warn('questlog sw: could not precache', url, err))));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== VERSION).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

async function isTestClient(clientId) {
  if (!clientId) return false;
  try {
    const client = await self.clients.get(clientId);
    return Boolean(client && new URL(client.url).pathname.includes('/tests/'));
  } catch {
    return false;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    // The test runner must always see the files as they are on disk — and that
    // includes modules it imports indirectly, so check the requesting page
    // rather than the requested path.
    if (url.pathname.includes('/tests/') || await isTestClient(event.clientId)) {
      return fetch(request);
    }

    const cache = await caches.open(VERSION);
    const cached = await cache.match(request, { ignoreSearch: true });

    const network = fetch(request).then((response) => {
      if (response && response.ok && response.type === 'basic') cache.put(request, response.clone());
      return response;
    }).catch(() => null);

    if (cached) {
      event.waitUntil(network); // refresh in the background
      return cached;
    }

    const fresh = await network;
    if (fresh) return fresh;

    // Offline and never cached: navigations still get the app shell.
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return new Response('questlog is offline and this file was never cached.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  })());
});
