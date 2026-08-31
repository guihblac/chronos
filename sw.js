// ========== CHRONOS SERVICE WORKER ==========
// Three jobs, in order of how much they matter:
//   1. Make the app open with no network at all.
//   2. Keep the webfonts, which live on a second origin and are the first thing
//      to disappear offline.
//   3. Never serve a stale build without noticing.
//
// Bump SHELL_VERSION on every delivery. The activate handler deletes anything
// that doesn't match, so a bumped version is what actually evicts the old
// build — without it a user sits on a cached copy indefinitely.

const SHELL_VERSION = 'chronos-shell-v14';
const FONT_VERSION  = 'chronos-fonts-v1';

// Relative, not absolute: this has to work from a GitHub Pages project path
// (/chronos/) as well as from a domain root, and a leading slash would resolve
// to the wrong place under the former.
const SHELL = [
  './',
  'index.html',
  'chronos.css',
  'chronos.js',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png'
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL_VERSION)
      // addAll is atomic — one 404 rejects the whole install and leaves the
      // previous worker in place. That's the behaviour we want, but it means a
      // typo in SHELL silently disables updates, so each file is added
      // individually and the failures are tolerated instead.
      .then(c => Promise.all(SHELL.map(url => c.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== SHELL_VERSION && k !== FONT_VERSION)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Fonts: cache-first with a background refresh. They're immutable in practice
  // and this is the whole reason the app keeps its typography offline.
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.open(FONT_VERSION).then(cache =>
        cache.match(req).then(hit => {
          const net = fetch(req).then(res => {
            // Google serves the CSS with CORS but the font binaries opaque
            // unless asked properly; an opaque response still caches and still
            // renders, so it's kept rather than discarded.
            if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
            return res;
          }).catch(() => hit);
          return hit || net;
        })
      )
    );
    return;
  }

  // Anything on another origin (a user's own background media, say) is left to
  // the network untouched. Caching it would blow the storage quota for no gain.
  if (url.origin !== location.origin) return;

  // Navigations: network-first, so a deployed change lands on the next load
  // rather than whenever the cache happens to turn over. Falls back to the
  // cached shell when there's no network, which is the offline case.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(SHELL_VERSION).then(c => c.put('index.html', copy));
          return res;
        })
        .catch(() => caches.match('index.html').then(hit => hit || caches.match('./')))
    );
    return;
  }

  // Same-origin assets: serve from cache immediately, then refresh in the
  // background so the next load has the newer file. The CSS and JS are ~230KB
  // together, which is a visible wait on a cold mobile connection.
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(SHELL_VERSION).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
