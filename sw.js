// ==============================================================================
// SERVICE WORKER PARA PET AMOR (PWA & CACHE-FIRST / STALE-WHILE-REVALIDATE)
// Versão do Cache: pet-amor-v2
// ==============================================================================

const CACHE_NAME = 'pet-amor-v2';
const STATIC_ASSETS = [
  './',
  'index.html',
  'termos.html',
  'css/common.css',
  'css/index.css',
  'img/logo.png',
  'manifest.webmanifest',
  'js/core-config.js',
  'js/services/post-service.js',
  'js/services/analytics-service.js',
  'js/services/auth-service.js',
  'js/components/ad-slot.js',
  'js/components/cookie-consent.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Pré-cache parcial durante install do SW v2:', err);
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
            console.log('[ServiceWorker] Limpando cache antigo:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ignora requisições de API dinâmicas (Supabase, Auth, Storage, Analytics externos)
  if (
    event.request.method !== 'GET' ||
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('google-analytics.com') ||
    url.hostname.includes('googletagmanager.com') ||
    url.pathname.includes('/rest/v1/') ||
    url.pathname.includes('/auth/v1/') ||
    url.pathname.includes('/storage/v1/')
  ) {
    return;
  }

  // Estratégia Stale-While-Revalidate para recursos estáticos locais
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            (networkResponse.type === 'basic' || networkResponse.type === 'cors')
          ) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => {
          // Ignora erros de rede se estiver em background
        });

      if (cachedResponse) {
        return cachedResponse;
      }

      return fetchPromise.then((res) => {
        return res || caches.match('index.html') || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }).catch(() => {
        return caches.match('index.html') || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      });
    })
  );
});
