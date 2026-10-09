const CACHE = "horaire-pro-shell-v32";
const CORE = [
  "./", "index.html", "assets/styles.css?v=26", "assets/intendance.css?v=27", "assets/supabase.min.js", "assets/platform.js?v=25", "assets/smart.js?v=28", "assets/intendance.js?v=27", "assets/app.js?v=29",
  "assets/horaire-pro-logo.svg", "assets/favicon.svg", "assets/icon-pro-192.png", "assets/icon-pro-512.png",
  "assets/icon-pro-maskable-512.png", "assets/login-campus-v1.webp", "config.js", "manifest-v2.webmanifest?v=3"
];

self.addEventListener("install", (event) => event.waitUntil(
  caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting())
));

self.addEventListener("activate", (event) => event.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim())
));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then((response) => {
      if (response.ok) caches.open(CACHE).then((cache) => cache.put("index.html", response.clone()));
      return response;
    }).catch(() => caches.match("index.html")));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => {
    const refresh = fetch(event.request).then((response) => {
      if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
      return response;
    }).catch(() => cached);
    return cached || refresh;
  }));
});

self.addEventListener("push", (event) => {
  let message = {title:"Horaire Pro",body:"Une nouvelle information est disponible.",url:"./#announcements"};
  try { message = {...message, ...event.data.json()}; } catch {}
  const notification=self.registration.showNotification(message.title, {
    body:message.body, icon:"assets/icon-pro-192.png", badge:"assets/icon-pro-192.png",
    tag:message.tag || "horaire-pro-update", renotify:Boolean(message.renotify),
    silent:false, requireInteraction:message.kind==="lesson-reminder",
    vibrate:message.vibrate || [700,250,700,250,900], timestamp:message.timestamp || Date.now(),
    data:{url:message.url || "./",kind:message.kind || "information"}
  });
  const wakePage=message.kind==="lesson-reminder"?clients.matchAll({type:"window",includeUncontrolled:true}).then(windows=>{for(const client of windows)client.postMessage({type:"LESSON_REMINDER"});}):Promise.resolve();
  event.waitUntil(Promise.all([notification,wakePage]));
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

self.addEventListener("message",(event)=>{if(event.data?.type==="SKIP_WAITING")self.skipWaiting();});
