/* Safari ya Matatu — service worker.
   Caches every asset on install so the game installs as a PWA and works
   fully offline. Bump CACHE when you change any file. */
const CACHE = "safari-ya-matatu-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./puzzles.js",
  "./manifest.json",
  "./icon.svg",
  "./icon-maskable.svg",
];

self.addEventListener("install", (e)=>{
  e.waitUntil(caches.open(CACHE).then((c)=> c.addAll(ASSETS)).then(()=> self.skipWaiting()));
});

self.addEventListener("activate", (e)=>{
  e.waitUntil(
    caches.keys().then((keys)=> Promise.all(keys.filter(k=> k!==CACHE).map(k=> caches.delete(k))))
      .then(()=> self.clients.claim())
  );
});

// cache-first; fall back to network, then cache the fresh copy
self.addEventListener("fetch", (e)=>{
  if(e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((hit)=>{
      if(hit) return hit;
      return fetch(e.request).then((res)=>{
        const copy = res.clone();
        caches.open(CACHE).then((c)=> c.put(e.request, copy)).catch(()=>{});
        return res;
      }).catch(()=> caches.match("./index.html"));
    })
  );
});
