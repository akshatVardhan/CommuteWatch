// Commute Watch — Service Worker
const CACHE = "commute-watch-v1";
const SHELL = ["./", "./index.html", "./manifest.json"];

// Install — cache app shell
self.addEventListener("install", e=>{
  e.waitUntil(
    caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())
  );
});

// Activate — clear old caches
self.addEventListener("activate", e=>{
  e.waitUntil(
    caches.keys().then(keys=>
      Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))
    ).then(()=>self.clients.claim())
  );
});

// Fetch — network first, fall back to cache for shell
self.addEventListener("fetch", e=>{
  const url = new URL(e.request.url);

  // Always go network-first for Claude API calls
  if(url.hostname === "api.anthropic.com"){
    e.respondWith(fetch(e.request).catch(()=>new Response("{}", {headers:{"Content-Type":"application/json"}})));
    return;
  }

  // For app shell — cache first, then network
  if(SHELL.some(s=>e.request.url.includes("index.html")) || e.request.mode==="navigate"){
    e.respondWith(
      caches.match(e.request).then(cached=>{
        const networkFetch = fetch(e.request).then(res=>{
          const clone = res.clone();
          caches.open(CACHE).then(c=>c.put(e.request, clone));
          return res;
        });
        return cached || networkFetch;
      })
    );
    return;
  }

  // Everything else — network first
  e.respondWith(
    fetch(e.request).catch(()=>caches.match(e.request))
  );
});
