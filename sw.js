const CACHE = "cat-smart-horaire-v3";
const CORE = ["./", "index.html", "assets/styles.css", "assets/smart.js", "assets/app.js", "assets/favicon.svg", "config.js", "manifest.webmanifest"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(event.request, copy)); return response;
  }).catch(() => caches.match(event.request)));
});
self.addEventListener("push", (event) => {
  let message = {title: "CAT Smart Horaire", body: "Une nouvelle information est disponible.", url: "./#announcements"};
  try { message = {...message, ...event.data.json()}; } catch {}
  event.waitUntil(self.registration.showNotification(message.title, {
    body: message.body,
    icon: "assets/favicon.svg",
    badge: "assets/favicon.svg",
    tag: message.tag || "cat-smart-update",
    data: {url: message.url || "./"},
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then((windows) => {
    const target = new URL(event.notification.data?.url || "./", self.location.href).href;
    const existing = windows.find((client) => client.url.startsWith(self.location.origin));
    if (existing) { existing.navigate(target); return existing.focus(); }
    return clients.openWindow(target);
  }));
});
