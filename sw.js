/* Matatu ya Maneno — service worker.
   Caches every asset on install so the game installs as a PWA and works
   fully offline. Bump CACHE when you change any file. */
const CACHE = "matatu-ya-maneno-v3";
const ASSETS = [
  "./",
  "./index.html",
  "./puzzles.js",
  "./economy.js",
  "./route.js",
  "./journey.js",
  "./manifest.json",
  "./icon.svg",
  "./icon-maskable.svg",
  "./assets/kenya-map.jpg",
  "./assets/road-01-nairobi-jam.jpg",
  "./assets/road-02-nairobi-highway.jpg",
  "./assets/road-03-rironi.jpg",
  "./assets/road-04-matatu-mzigo.jpg",
  "./assets/road-05-escarpment.jpg",
  "./assets/road-06-green-highway.jpg",
  "./assets/road-07-a109-sign.jpg",
  "./assets/road-08-mountain.jpg",
  "./assets/road-09-sgr-bridge.jpg",
  "./assets/road-10-mombasa-tusks.jpg",
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
