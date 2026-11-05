/* Employee Ledger push groundwork. No subscriptions or prompts until backend is configured. */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = {body:event.data?.text() || ''}; }
  const title = String(data.title || 'Employee Ledger');
  const body = String(data.body || 'You have a new notification.');
  event.waitUntil(self.registration.showNotification(title, {
    body, icon: './tips-icon.svg', badge: './tips-icon.svg',
    tag: data.tag || 'tips-ledger', renotify: true,
    data: {url: (() => { const base = new URL('./', self.registration.scope); try { const link = new URL(data.url || base.href); return link.origin===base.origin && link.pathname===base.pathname ? link.href : base.href; } catch (_) {return base.href;} })()}
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows => {
    const base = new URL('./', self.registration.scope).href;
    const url = event.notification.data?.url || base;
    for (const win of windows) {
      if (win.url.startsWith(base) && 'focus' in win) {
        await win.focus();
        if (url !== win.url && 'navigate' in win) await win.navigate(url);
        return;
      }
    }
    return clients.openWindow(url);
  }));
});
