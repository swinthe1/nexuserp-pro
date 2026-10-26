/* DrisPRO · phone notifications, loaded into the service worker (vite.config.ts › workbox.importScripts). */
self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch { d = { title: event.data ? event.data.text() : 'DrisPRO' } }
  const title = d.title || 'DrisPRO'
  event.waitUntil(self.registration.showNotification(title, {
    body: [d.body, d.company].filter(Boolean).join('\n'),
    icon: '/pwa-192.png',
    badge: '/favicon-32.png',
    tag: d.tag || undefined,
    data: { url: d.url || '/notifications' },
    lang: 'sq',
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) {
        await w.focus()
        try { await w.navigate(url) } catch { w.postMessage({ type: 'drispro-open', url }) }
        return
      }
    }
    await self.clients.openWindow(url)
  })())
})
