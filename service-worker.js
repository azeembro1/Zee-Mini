const CACHE_NAME = 'zee-mini-cache-v1';
const urlsToCache = [
  '/',
  'index.html',
  'index.css',
  'index.tsx',
  'icon.svg',
  'manifest.json',
  'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js',
  'https://esm.sh/@google/genai@^0.7.0',
  'https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap'
];

// Install a service worker
self.addEventListener('install', event => {
  // Perform install steps
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        const cachePromises = urlsToCache.map(urlToCache => {
            return cache.add(new Request(urlToCache, {mode: 'no-cors'})).catch(err => console.warn(`Could not cache ${urlToCache}:`, err));
        });
        return Promise.all(cachePromises);
      })
  );
});

// Cache and return requests
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          return response;
        }
        return fetch(event.request);
      }
    )
  );
});

// Update a service worker
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
