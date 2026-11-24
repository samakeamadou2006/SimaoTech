/**
 * Service worker SimaoTech.
 *
 * Strategie :
 * - coque applicative (CSS, JS, polices, pages) : reseau d'abord, cache en secours ;
 * - bibliotheques versionnees (/vendor) : cache d'abord ;
 * - API : jamais mise en cache (les donnees metier doivent rester fraiches).
 * - pages metiers : coque cachee pour consultation apres reconnexion.
 */
const VERSION = 'simaotech-v1.0.0-phase14';
const CACHE_COQUE = `${VERSION}-coque`;
const CACHE_VENDOR = `${VERSION}-vendor`;

const COQUE = [
  '/pages/connexion.html',
  '/pages/tableau-de-bord.html',
  '/pages/utilisateurs.html',
  '/pages/mot-de-passe.html',
  '/pages/reinitialisation.html',
  '/pages/produits.html',
  '/pages/categories.html',
  '/pages/module.html',
  '/css/styles.css',
  '/js/api.js',
  '/js/session.js',
  '/js/ui.js',
  '/js/connexion.js',
  '/js/tableau-de-bord.js',
  '/js/utilisateurs.js',
  '/js/mot-de-passe.js',
  '/js/reinitialisation.js',
  '/js/produits.js',
  '/js/categories.js',
  '/js/metiers.js',
  '/js/metiers-calculs.js',
  '/js/stockage_local.js',
  '/js/pwa.js',
  '/images/logo.svg',
  '/manifest.json',
];

const VENDOR = [
  '/vendor/bootstrap/css/bootstrap.min.css',
  '/vendor/bootstrap/js/bootstrap.bundle.min.js',
];

self.addEventListener('install', (evenement) => {
  evenement.waitUntil(
    (async () => {
      const coque = await caches.open(CACHE_COQUE);
      await coque.addAll(COQUE);
      const vendor = await caches.open(CACHE_VENDOR);
      await vendor.addAll(VENDOR);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil(
    (async () => {
      const noms = await caches.keys();
      await Promise.all(
        noms.filter((nom) => !nom.startsWith(VERSION)).map((nom) => caches.delete(nom)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request;
  if (requete.method !== 'GET') return;

  const url = new URL(requete.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/vendor/')) {
    evenement.respondWith(
      (async () => {
        const cache = await caches.match(requete);
        if (cache) return cache;
        const reponse = await fetch(requete);
        const copie = reponse.clone();
        (await caches.open(CACHE_VENDOR)).put(requete, copie);
        return reponse;
      })(),
    );
    return;
  }

  evenement.respondWith(
    (async () => {
      try {
        const reponse = await fetch(requete);
        if (reponse.ok && requete.destination !== 'document') {
          const copie = reponse.clone();
          (await caches.open(CACHE_COQUE)).put(requete, copie);
        }
        return reponse;
      } catch {
        const cache =
          (await caches.match(requete)) ??
          (requete.destination === 'document'
            ? await caches.match(`${url.origin}${url.pathname}`)
            : null);
        if (cache) return cache;
        if (requete.mode === 'navigate') {
          const secours = await caches.match('/pages/connexion.html');
          if (secours) return secours;
        }
        return new Response('Ressource indisponible hors ligne.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    })(),
  );
});
