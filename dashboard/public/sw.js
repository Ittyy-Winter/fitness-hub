// Fitness Hub service worker: makes the app shell open instantly and offline. Data is not
// cached here; the app keeps the last response of each page itself and refreshes on open.

const CACHE = 'fitness-hub-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg'])))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/photos/')) return

  // Fingerprinted assets never change: cache first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(request).then((hit) => hit ?? fetchAndKeep(request)))
    return
  }
  // The shell: network first so updates land, cache when offline. A sign-in redirect from
  // Cloudflare Access is passed through untouched and never cached.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok && !res.redirected) caches.open(CACHE).then((c) => c.put('/', res.clone()))
          return res
        })
        .catch(() => caches.match('/').then((hit) => hit ?? Response.error())),
    )
  }
})

async function fetchAndKeep(request) {
  const res = await fetch(request)
  if (res.ok) (await caches.open(CACHE)).put(request, res.clone())
  return res
}
