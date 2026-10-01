/**
 * sw.js — Offline működés.
 *
 * Az alkalmazás vázát (HTML, CSS, JS, ikonok) előre eltároljuk, így
 * hálózat nélkül is elindul. Az időjárási adatokat hálózat-először
 * stratégiával kezeljük: ha van net, friss adat jön, ha nincs, a
 * legutóbbi válasz.
 *
 * Megjegyzés: a böngészők csak biztonságos környezetben (https vagy
 * localhost) engedélyezik a service workert. LAN-os http címen az app
 * ettől függetlenül működik, csak az offline réteg marad ki.
 */

const VERSION = 'v2';
const SHELL = `shell-${VERSION}`;
const DATA = `data-${VERSION}`;

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/api.js',
  './js/config.js',
  './js/ensemble.js',
  './js/charts.js',
  './js/narrative.js',
  './js/ui.js',
  './js/ui-safety.js',
  './js/hazards.js',
  './js/hazardforecast.js',
  './js/space.js',
  './js/news.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isData = /open-meteo\.com$|bigdatacloud\.net$|usgs\.gov$|seismicportal\.eu$|gsfc\.nasa\.gov$|gdacs\.org$|weather\.gov$|swpc\.noaa\.gov$|gdeltproject\.org$/
    .test(url.hostname);

  if (isData) {
    // Hálózat először, tárolt válasz tartaléknak.
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(DATA).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Az app váza: tárolóból azonnal, közben csendben frissítve.
  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    }),
  );
});
