/* Tips Ledger push groundwork. No subscriptions or prompts until backend is configured. */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = {body:event.data?.text() || ''}; }
  const title = String(data.title || 'Tips Ledger');
  const body = String(data.body || 'You have a new notification.');
  event.waitUntil(self.registration.showNotification(title, {
    body, icon: './icon.png', badge: './icon.png',
    tag: data.tag || 'tips-ledger', renotify: true,
    data: {url: new URL('./', self.registration.scope).href}
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows => {
    const url = new URL('./', self.registration.scope).href;
    for (const win of windows) {
      if (win.url.startsWith(url) && 'focus' in win) return win.focus();
    }
    return clients.openWindow(url);
  }));
});
