// A basic service worker to make the app installable
self.addEventListener('install', (event) => {
  console.log('Service worker installing...');
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  // This basic service worker doesn't intercept any requests.
  // It just lets the browser handle them as usual.
  return;
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const { chatId, chatType } = event.notification.data || {};
  if (typeof chatId !== 'string' || !['private', 'group'].includes(chatType)) return;
  event.waitUntil((async () => {
    const scope = new URL(self.registration.scope);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find(item => {
      const url = new URL(item.url);
      return url.origin === scope.origin && (url.pathname === scope.pathname || url.pathname === scope.pathname + 'index.html');
    });
    if (client) {
      await client.focus();
      client.postMessage({ type: 'uvu-open-chat', chatId, chatType });
    } else {
      scope.hash = 'uvu-notification=' + encodeURIComponent(JSON.stringify({ chatId, chatType }));
      await self.clients.openWindow(scope.href);
    }
  })());
});
