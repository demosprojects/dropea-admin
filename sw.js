// ============================================================
// SERVICE WORKER - Dropea (panel de gestión)
// ============================================================
// IMPORTANTE: subí este número cada vez que hagas un deploy con cambios
// relevantes. Al cambiar, el Service Worker detecta que es "nuevo",
// vuelve a precargar todo y le avisa al usuario para que actualice
// (ver pwa.js, que muestra el aviso "Hay una nueva versión disponible").
const VERSION = 'v2.1.1';
const CACHE_NAME = `dropea-${VERSION}`;
// Prefijo de las cachés de la marca anterior: se siguen reconociendo para
// borrarlas en 'activate' y no dejar basura en los dispositivos que ya tenían la app.
const PREFIJO_CACHE_ANTERIOR = 'comunidadplace-';

// Archivos propios de la app (rutas relativas, sin "/", para que funcionen
// igual en cualquier subcarpeta o dominio de Vercel).
const ARCHIVOS_PRECARGA = [
  'login',
  'admin',
  'dashboard',
  'login.js',
  'admin.js',
  'dashboard.js',
  'supabase-client.js',
  'image-upload.js',
  'qr-cards.js',
  'qrcode_min.js',
  'manifest.json',
  'pwa.css',
  'pwa.js',
  'icon-192.png',
  'icon-512.png',
  'dropea-logo.png',
  'favicon-96x96.png'
];

// ------------------------------------------------------------
// INSTALL: precarga el "shell" de la app. Se usa allSettled en vez de
// cache.addAll para que, si falta algún archivo (ej. un ícono que todavía
// no subiste), no rompa la instalación completa del Service Worker.
// ------------------------------------------------------------
self.addEventListener('install', (event) => {
  // OJO: NO llamar self.skipWaiting() acá. Si lo hacemos, el SW nuevo
  // toma control apenas se instala (sin esperar al usuario), dispara
  // "controllerchange" en pwa.js y la página se recarga sola antes de
  // que el usuario llegue a ver el aviso. El skipWaiting real lo dispara
  // pwa.js recién cuando el usuario toca el botón "Actualizar"
  // (ver el listener de "message" más abajo).
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        ARCHIVOS_PRECARGA.map((archivo) =>
          cache.add(archivo).catch((err) => {
            console.warn(`[SW] No se pudo precachear "${archivo}":`, err.message);
          })
        )
      )
    )
  );
});

// ------------------------------------------------------------
// ACTIVATE: borra versiones de caché viejas y toma control inmediato
// de las páginas abiertas.
// ------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((nombres) =>
        Promise.all(
          nombres
            .filter((nombre) => (nombre.startsWith('dropea-') || nombre.startsWith(PREFIJO_CACHE_ANTERIOR)) && nombre !== CACHE_NAME)
            .map((nombre) => caches.delete(nombre))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Permite que la página fuerce la activación del SW nuevo apenas el
// usuario toca "Actualizar" en el aviso (ver pwa.js).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ------------------------------------------------------------
// FETCH
// ------------------------------------------------------------
// - Navegación (cargar una página) y archivos propios .html/.js/.css/.json:
//   Network First -> siempre trae la versión más nueva del servidor; si no
//   hay conexión, usa la última copia guardada en caché.
// - Todo lo demás (Google Fonts, Cloudinary, íconos, CDNs, Supabase, etc.):
//   Stale While Revalidate -> responde rápido con la copia en caché (si
//   existe) y en paralelo la actualiza para la próxima vez.
// ------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const esMismoOrigen = url.origin === self.location.origin;
  const esNavegacion = request.mode === 'navigate';
  const esRecursoPropio = esMismoOrigen && /\.(html|js|css|json)$/.test(url.pathname);

  // Las llamadas a la API de Supabase (productos, categorías, perfil, pedidos,
  // etc.) son datos en vivo: cachearlas -aunque sea con "stale-while-revalidate"-
  // hacía que el dashboard mostrara información vieja (ej: un producto que se
  // acababa de ocultar seguía apareciendo como "Visible") hasta que, más tarde,
  // la revalidación en segundo plano terminaba de actualizar la caché. Estas
  // peticiones van siempre directo a la red, sin pasar por el Service Worker.
  const esApiSupabase = /(^|\.)supabase\.co$/.test(url.hostname);

  if (esApiSupabase) {
    event.respondWith(fetch(request));
    return;
  }

  if (esNavegacion || esRecursoPropio) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const respuestaRed = await fetch(request);
    if (respuestaRed && respuestaRed.ok) {
      cache.put(request, respuestaRed.clone());
    }
    return respuestaRed;
  } catch (err) {
    const respuestaCache = await cache.match(request);
    if (respuestaCache) return respuestaCache;
    // Último recurso sin conexión: mostramos login.html si es una navegación.
    if (request.mode === 'navigate') {
      const login = await cache.match('login');
      if (login) return login;
    }
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const respuestaCache = await cache.match(request);
  const promesaRed = fetch(request)
    .then((respuestaRed) => {
      // Las respuestas "opacas" (recursos cross-origin sin CORS, como
      // fuentes o imágenes de otros dominios) también son válidas para
      // guardar, aunque no se pueda leer su status.
      if (respuestaRed && (respuestaRed.ok || respuestaRed.type === 'opaque')) {
        cache.put(request, respuestaRed.clone());
      }
      return respuestaRed;
    })
    .catch(() => respuestaCache);

  return respuestaCache || promesaRed;
}
