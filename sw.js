// Commute Watch — Service Worker v2
const CACHE = "commute-watch-v2";
const SHELL = ["./", "./index.html", "./manifest.json", "./styles.css", "./app.js"];

self.addEventListener("install", e=>{
  e.waitUntil(
    caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())
  );
});

self.addEventListener("activate", e=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch", e=>{
  const url=new URL(e.request.url);

  // Network-only for Claude API (no caching of API calls)
  if(url.hostname==="api.anthropic.com"){
    e.respondWith(
      fetch(e.request).catch(()=>new Response("{}", {headers:{"Content-Type":"application/json"}}))
    );
    return;
  }

  // App shell: cache-first, update in background (stale-while-revalidate)
  if(e.request.mode==="navigate"||SHELL.some(s=>url.pathname.endsWith(s.replace("./","")))){
    e.respondWith(
      caches.open(CACHE).then(cache=>
        cache.match(e.request).then(cached=>{
          const networkFetch=fetch(e.request).then(res=>{
            cache.put(e.request,res.clone());
            return res;
          });
          return cached||networkFetch;
        })
      )
    );
    return;
  }

  // Everything else: network-first with cache fallback
  e.respondWith(
    fetch(e.request).catch(()=>caches.match(e.request))
  );
});
