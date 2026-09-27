/* Carrousel — service worker della carta digitale.
   Al bar la rete del telefono è spesso debole (sottosuolo, folla): la carta
   aperta una volta resta consultabile e si riapre subito.
   - Pagine HTML: prima la rete (sempre la versione pubblicata più recente);
     se la rete non risponde entro 3,5 s o manca, la copia salvata.
   - File statici (_next/static con hash, foto, grafica, font): copia salvata
     subito, aggiornata in background.
   - Tutto il resto (Supabase, Instagram, altri siti): non toccato. */
const VERSION = "carrousel-v1";
const PAGES = `${VERSION}-pages`;
const ASSETS = `${VERSION}-assets`;
const MENU_PAGES = ["/carte/", "/en/menu/", "/it/menu/", "/de/karte/", "/es/carta/"];

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      /* elimina le cache di versioni precedenti */
      for (const key of await caches.keys()) if (!key.startsWith(VERSION)) await caches.delete(key);
      await self.clients.claim();
    })()
  );
});

const isAsset = (url) =>
  /^\/(_next\/static|carte|brand|ambiance|fonts)\//.test(url.pathname) ||
  /\.(?:webp|avif|jpg|png|svg|woff2|ico)$/.test(url.pathname);

async function fromNetworkFirst(request) {
  const cache = await caches.open(PAGES);
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3500)),
    ]);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    /* ignoreSearch: /carte/?qr (il QR sui tavoli) usa la copia di /carte/ */
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    /* nessuna copia: si lascia fare al browser (pagina di errore standard) */
    return fetch(request);
  }
}

async function fromCacheThenUpdate(event) {
  const cache = await caches.open(ASSETS);
  const cached = await cache.match(event.request);
  const update = fetch(event.request)
    .then((response) => {
      if (response.ok && response.type === "basic") cache.put(event.request, response.clone());
      return response;
    })
    .catch(() => cached);
  if (cached) {
    event.waitUntil(update.then(() => undefined));
    return cached;
  }
  return update;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fromNetworkFirst(request));
  } else if (isAsset(url)) {
    event.respondWith(fromCacheThenUpdate(event));
  }
});

/* dopo la prima visita: salva in anticipo le pagine della carta nelle 5 lingue
   (poche decine di KB), così anche il cambio di lingua funziona senza rete */
self.addEventListener("message", (event) => {
  if (event.data !== "warm-menu") return;
  event.waitUntil(
    caches.open(PAGES).then((cache) =>
      Promise.all(
        MENU_PAGES.map((p) =>
          cache.match(p).then((hit) => hit || fetch(p).then((r) => r.ok && cache.put(p, r)).catch(() => {}))
        )
      )
    )
  );
});
