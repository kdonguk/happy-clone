const CACHE_NAME = 'happy-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(['/']))
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('ws://')) return
  event.respondWith(
    caches.match(event.request).then((r) => r || fetch(event.request))
  )
})
