/* Safari ya Matatu — service worker.
   Caches every asset on install so the game installs as a PWA and works
   fully offline. Bump CACHE when you change any file. */
const CACHE = "safari-ya-matatu-v3";
const ASSETS = [
  "./",
  "./index.html",
  "./puzzles.js",
  "./supabase-config.js",
  "./cloud.js",
  "./vendor/supabase.js",
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

/* Files that change when the game is redeployed. These are network-first:
   we serve the freshest copy when online and fall back to cache when not.
   Pure cache-first here would pin the app to whatever shipped first — most
   painfully, a stale supabase-config.js means new Supabase credentials would
   silently never take effect on a device that had already loaded the game. */
const SHELL = /\/(index\.html|supabase-config\.js|cloud\.js)$|\/$/;

self.addEventListener("fetch", (e)=>{
  if(e.request.method !== "GET") return;

  // Only ever cache our own static assets. Cross-origin calls (Supabase auth,
  // scoreboard reads, telemetry) must always hit the network — caching them
  // would freeze the leaderboard at whatever it said the first time.
  const url = new URL(e.request.url);
  if(url.origin !== self.location.origin) return;

  const cacheFresh = (res)=>{
    const copy = res.clone();
    caches.open(CACHE).then((c)=> c.put(e.request, copy)).catch(()=>{});
    return res;
  };

  if(SHELL.test(url.pathname)){
    // network-first
    e.respondWith(
      fetch(e.request).then(cacheFresh)
        .catch(()=> caches.match(e.request).then(hit => hit || caches.match("./index.html")))
    );
    return;
  }

  // everything else (vendor bundle, puzzles, icons) is cache-first
  e.respondWith(
    caches.match(e.request).then((hit)=>
      hit || fetch(e.request).then(cacheFresh).catch(()=> caches.match("./index.html"))
    )
  );
});
