// Service Worker para Pet Amor (PWA)
const CACHE_NAME = 'pet-amor-v1';
const STATIC_ASSETS = [
  './',
  'index.html',
  'css/common.css',
  'css/index.css',
  'img/logo.png',
  'manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Pré-cache parcial durante install do SW:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ignora requisições de API do Supabase, autenticação e métodos não-GET (sempre online)
  if (
    event.request.method !== 'GET' ||
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('googleapis.com') ||
    url.pathname.includes('/rest/v1/') ||
    url.pathname.includes('/auth/v1/')
  ) {
    return;
  }

  // Estratégia Stale-While-Revalidate para recursos estáticos locais
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          }
          return networkResponse;
        });

      if (cachedResponse) {
        // Atualiza o cache em segundo plano sem bloquear a resposta rápida
        fetchPromise.catch(() => {});
        return cachedResponse;
      }

      return fetchPromise.catch(() => {
        // Fallback seguro caso esteja sem internet e o recurso não esteja no cache
        return caches.match('index.html') || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      });
    })
  );
});
