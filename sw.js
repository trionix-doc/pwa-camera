const CACHE_NAME = 'matter-qr-scanner-v1';
const URLS_TO_CACHE = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './manifest.json',
    'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'
];

// Установка Service Worker
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(URLS_TO_CACHE).catch(err => {
                console.warn('Некоторые ресурсы не удалось закешировать:', err);
                // Кешируем только локальные файлы
                return cache.addAll([
                    './',
                    './index.html',
                    './styles.css',
                    './app.js',
                    './manifest.json'
                ]);
            });
        })
    );
    self.skipWaiting();
});

// Активация Service Worker
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Перехват запросов
self.addEventListener('fetch', event => {
    // Пропускаем запросы не GET
    if (event.request.method !== 'GET') {
        return;
    }

    event.respondWith(
        caches.match(event.request).then(response => {
            // Если в кеше есть - возвращаем из кеша
            if (response) {
                // Обновляем кеш в фоне
                fetch(event.request).then(freshResponse => {
                    if (freshResponse && freshResponse.status === 200) {
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, freshResponse);
                        });
                    }
                }).catch(() => {
                    // Сеть недоступна, используем кешированный ответ
                });
                return response;
            }

            // Если в кеше нет - пытаемся получить из сети
            return fetch(event.request).then(response => {
                // Проверяем, валиден ли ответ
                if (!response || response.status !== 200 || response.type === 'error') {
                    return response;
                }

                // Клонируем ответ
                const responseToCache = response.clone();

                // Кешируем новый ответ
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, responseToCache);
                });

                return response;
            }).catch(() => {
                // Если сеть не доступна и нет в кеше
                return caches.match('./index.html');
            });
        })
    );
});

// Обработка фоновой синхронизации
self.addEventListener('sync', event => {
    if (event.tag === 'sync-qr-results') {
        event.waitUntil(
            // Здесь можно добавить логику синхронизации с сервером
            Promise.resolve()
        );
    }
});