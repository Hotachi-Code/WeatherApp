/**
 * app.js — Összefogja az egészet: állapot, események, újrarajzolás.
 */

import { APP } from './config.js';
import { geocode, reverseGeocode, fetchEnsemble, fetchContext, fetchAirQuality, fetchCalibration, cache } from './api.js';
import { buildEnsemble } from './ensemble.js';
import * as ui from './ui.js';
import * as uiSafety from './ui-safety.js';
import { fetchHazardEvents, processHazards } from './hazards.js';
import { scanHazards, landslideRisk, fireRisk, fetchTerrain, antecedentRain } from './hazardforecast.js';
import { fetchSpaceWeather, evaluateSpaceWeather } from './space.js';
import { buildNews } from './news.js';

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ */
/* Állapot                                                             */
/* ------------------------------------------------------------------ */

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(`wx:${key}`);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`wx:${key}`, JSON.stringify(value));
    } catch {
      /* nem kritikus */
    }
  },
};

const app = {
  place: store.get('place', null),
  recents: store.get('recents', []),
  hourRange: store.get('hourRange', 24),
  watchRadiusKm: store.get('watchRadius', 300),
  settings: {
    calibration: store.get('calibration', true),
    outliers: store.get('outliers', true),
    news: store.get('news', true),
    theme: store.get('theme', 'system'),
  },
  raw: null,
  context: null,
  air: null,
  calibration: null,
  state: null,
  /* Biztonsági rétegek */
  hazardsRaw: null,
  terrain: null,
  space: null,
  news: null,
  busy: false,
};

/* ------------------------------------------------------------------ */
/* Bannerek                                                            */
/* ------------------------------------------------------------------ */

function banner(text, kind = 'info', id = null) {
  const host = $('banners');
  const div = document.createElement('div');
  div.className = 'banner';
  div.dataset.kind = kind;
  if (id) div.dataset.id = id;
  div.innerHTML = `<span>${kind === 'error' ? '⚠️' : 'ℹ️'}</span><span>${text}</span>`;
  host.appendChild(div);
  return div;
}

function clearBanners() {
  $('banners').innerHTML = '';
}

/* ------------------------------------------------------------------ */
/* Betöltés                                                            */
/* ------------------------------------------------------------------ */

function setBusy(on) {
  app.busy = on;
  $('btn-refresh').textContent = on ? '⏳' : '↻';
  $('btn-refresh').disabled = on;
}

async function load({ force = false } = {}) {
  if (!app.place || app.busy) return;
  const { lat, lon } = app.place;
  setBusy(true);
  clearBanners();

  try {
    // Az előrejelzés a kritikus adat; a többi hiánya nem állítja meg az appot.
    app.raw = await fetchEnsemble(lat, lon, { force });

    const failures = Object.keys(app.raw.unavailable || {}).length;
    if (!Object.keys(app.raw.models).length) {
      throw new Error('Egyetlen modell sem adott adatot erre a helyre.');
    }

    rebuild();

    // A kiegészítő adatok a háttérben érkeznek.
    fetchContext(lat, lon, { force })
      .then((ctx) => {
        app.context = ctx;
        if (app.state) ui.renderNow(app.state, ctx);
      })
      .catch(() => {});

    fetchAirQuality(lat, lon, { force })
      .then((aq) => {
        app.air = aq;
        if (aq && app.state) ui.renderAir(aq, app.state);
      })
      .catch(() => {});

    if (app.settings.calibration) {
      fetchCalibration(lat, lon, Object.keys(app.raw.models), { force })
        .then((cal) => {
          if (!cal) return;
          app.calibration = cal;
          rebuild();
        })
        .catch(() => {});
    }

    loadSafety({ force });

    if (failures) {
      banner(`${failures} forrás nem elérhető ezen a helyen — a részleteket az Adatforrások szakasz mutatja.`, 'info');
    }
    if (app.raw.fromCache) {
      const age = Math.round((Date.now() - app.raw.fetchedAt) / 60000);
      banner(`Tárolt adat (${age} perces). A frissítés gombbal kérhetsz újat.`, 'info');
    }
  } catch (err) {
    banner(`Nem sikerült betölteni az előrejelzést: ${err.message}. Ellenőrizd az internetkapcsolatot.`, 'error');
  } finally {
    setBusy(false);
  }
}

/* ------------------------------------------------------------------ */
/* Biztonsági rétegek                                                  */
/* ------------------------------------------------------------------ */

/**
 * A veszélyforrások a fő előrejelzéstől függetlenül töltődnek: ha az egyik
 * elakad, a másik attól még megjelenik. Mindegyik a saját ütemében érkezik,
 * és amint megvan, azonnal frissíti a felületet.
 */
async function loadSafety({ force = false } = {}) {
  if (!app.place) return;
  const { lat, lon } = app.place;

  const cacheKey = (kind) => `wx:${kind}:${lat.toFixed(2)},${lon.toFixed(2)}`;

  /* --- Hivatalos veszélyesemények --- */
  const hazardCached = force ? null : cache.get(cacheKey('haz'), 15 * 60000);
  const hazardTask = hazardCached
    ? Promise.resolve(hazardCached)
    : fetchHazardEvents(lat, lon, { radiusKm: app.watchRadiusKm, days: 21 })
        .then((r) => {
          cache.set(cacheKey('haz'), r);
          return r;
        })
        .catch(() => ({ events: [], failed: { mind: 'nem elérhető' }, fetchedAt: Date.now() }));

  /* --- Domborzat: helyenként egyszer elég, sokáig érvényes --- */
  const terrainCached = cache.get(cacheKey('terrain'), 30 * 864e5);
  const terrainTask = terrainCached
    ? Promise.resolve(terrainCached)
    : fetchTerrain(lat, lon)
        .then((t) => {
          cache.set(cacheKey('terrain'), t);
          return t;
        })
        .catch(() => null);

  /* --- Űridőjárás: helyfüggetlen, ezért közös cache --- */
  const spaceCached = force ? null : cache.get('wx:space', 30 * 60000);
  const spaceTask = spaceCached
    ? Promise.resolve(spaceCached)
    : fetchSpaceWeather()
        .then((s) => {
          cache.set('wx:space', s);
          return s;
        })
        .catch(() => null);

  const [hazardsRaw, terrain, spaceRaw] = await Promise.all([hazardTask, terrainTask, spaceTask]);
  app.hazardsRaw = hazardsRaw;
  app.terrain = terrain;
  app.space = spaceRaw;

  renderSafety();

  if (spaceRaw) {
    try {
      uiSafety.renderSpace(evaluateSpaceWeather(spaceRaw, lat, lon));
    } catch (e) {
      console.warn('Az űridőjárás megjelenítése nem sikerült:', e);
    }
  }

  /* --- Hírek: legvégül, mert ez a leggyengébb és legkorlátozottabb forrás --- */
  if (!app.settings.news) {
    $('card-news').hidden = true;
    return;
  }

  const newsCached = force ? null : cache.get(cacheKey('news'), 45 * 60000);
  if (newsCached) {
    app.news = newsCached;
    uiSafety.renderNews(newsCached, app.state);
    return;
  }

  try {
    const clusters = app.safetyResult?.threats?.concat(app.safetyResult.nearby || []) || [];
    const news = await buildNews(app.place, clusters, { timespanDays: 14 });
    app.news = news;
    cache.set(cacheKey('news'), news);
    uiSafety.renderNews(news, app.state);
  } catch (err) {
    app.news = { error: err.message, throttled: !!err.throttled };
    uiSafety.renderNews(app.news, app.state);
  }
}

/** A biztonsági kártya összeállítása a már meglévő adatokból. */
function renderSafety() {
  if (!app.state) return;

  const processed = app.hazardsRaw
    ? processHazards(app.hazardsRaw, app.place.lat, app.place.lon, {
        countryEn: countryEnglish(app.place),
        watchRadiusKm: app.watchRadiusKm,
      })
    : { threats: [], nearby: [], failed: {}, sourcesUsed: [] };

  app.safetyResult = processed;

  let hazards = [];
  let landslide = null;
  let fire = null;
  try {
    hazards = scanHazards(app.state, { minProbability: 0.15 });
    const antecedent = antecedentRain(app.state, 3);
    landslide = app.terrain ? landslideRisk(app.state, app.terrain, antecedent) : null;
    fire = fireRisk(app.state, dryDayCount(app.state));
  } catch (e) {
    console.warn('A veszély-előrejelzés számítása nem sikerült:', e);
  }

  uiSafety.renderSafety({
    ...processed,
    hazards,
    landslide,
    fire,
    watchRadiusKm: app.watchRadiusKm,
  });
}

/** Hány napja nem esett érdemben — a tűzveszélyhez. */
function dryDayCount(state) {
  const series = state.raw.models[state.availableIds[0]]?.precipitation;
  if (!series) return null;
  let dry = 0;
  for (let i = state.nowIndex - 1; i >= 0; i -= 24) {
    let sum = 0;
    for (let j = Math.max(0, i - 23); j <= i; j++) sum += series[j] ?? 0;
    if (sum >= 1) break;
    dry++;
  }
  return dry;
}

/** A hely országának angol neve — a nemzetközi listákhoz kell. */
function countryEnglish(place) {
  if (!place?.countryCode) return place?.country || null;
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(place.countryCode.toUpperCase());
  } catch {
    return place.country || null;
  }
}

/** Újraszámol és újrarajzol — hálózati kérés nélkül. */
function rebuild() {
  if (!app.raw) return;
  app.state = buildEnsemble(app.raw, {
    calibration: app.calibration,
    useCalibration: app.settings.calibration,
    rejectOutliers: app.settings.outliers,
  });

  ui.renderNow(app.state, app.context);
  ui.renderMetrics(app.state, (hourIndex, variable) => ui.openVariableSheet(app.state, hourIndex, variable));
  ui.renderHourly(app.state, app.hourRange);
  ui.renderDaily(app.state, (dayIndex) => ui.openDaySheet(app.state, dayIndex));
  ui.renderSources(app.state);
  if (app.air) ui.renderAir(app.air, app.state);
  if (app.hazardsRaw) renderSafety();
  $('card-settings').hidden = false;
}

/* ------------------------------------------------------------------ */
/* Hely kezelése                                                       */
/* ------------------------------------------------------------------ */

function setPlace(place) {
  app.place = place;
  store.set('place', place);

  app.recents = [place, ...app.recents.filter((p) => p.lat !== place.lat || p.lon !== place.lon)].slice(0, 6);
  store.set('recents', app.recents);

  $('place-name').textContent = place.name;
  $('place-sub').textContent = [place.admin, place.country].filter(Boolean).join(' · ')
    || `${place.lat.toFixed(3)}, ${place.lon.toFixed(3)}`;

  closeSearch();
  // Az előző helyhez tartozó veszély-, domborzat- és híradatok érvénytelenek.
  app.calibration = null;
  app.hazardsRaw = null;
  app.terrain = null;
  app.news = null;
  app.safetyResult = null;
  $('card-safety').hidden = true;
  $('card-news').hidden = true;
  load();
}

function openSearch() {
  $('search-wrap').hidden = false;
  $('btn-search').setAttribute('aria-pressed', 'true');
  $('search-input').focus();
  if (!$('search-input').value) showRecents();
}

function closeSearch() {
  $('search-wrap').hidden = true;
  $('btn-search').setAttribute('aria-pressed', 'false');
  $('results').hidden = true;
}

function showRecents() {
  if (!app.recents.length) {
    $('results').hidden = true;
    return;
  }
  renderResults(app.recents, 'Korábbi helyek');
}

function renderResults(list, heading = null) {
  const host = $('results');
  if (!list.length) {
    host.innerHTML = '<div class="result"><span>Nincs találat.</span></div>';
    host.hidden = false;
    return;
  }
  host.innerHTML =
    (heading ? `<div class="result" style="pointer-events:none"><span>${heading}</span></div>` : '') +
    list
      .map((p, i) => `<button class="result" data-i="${i}">
        <strong>${ui.esc(p.name)}</strong>
        <span>${ui.esc([p.admin, p.country].filter(Boolean).join(', '))} · ${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}</span>
      </button>`)
      .join('');
  host.hidden = false;
  host.querySelectorAll('[data-i]').forEach((btn) => {
    btn.addEventListener('click', () => setPlace(list[Number(btn.dataset.i)]));
  });
}

let searchTimer = null;
function onSearchInput(e) {
  const q = e.target.value.trim();
  clearTimeout(searchTimer);
  if (q.length < 2) {
    showRecents();
    return;
  }
  searchTimer = setTimeout(async () => {
    try {
      const results = await geocode(q);
      renderResults(results);
    } catch {
      $('results').innerHTML = '<div class="result"><span>A keresés most nem érhető el.</span></div>';
      $('results').hidden = false;
    }
  }, 320);
}

function locate() {
  if (!navigator.geolocation) {
    banner('Ez a böngésző nem támogatja a helymeghatározást.', 'error');
    return;
  }
  const btn = $('btn-locate');
  btn.textContent = '⏳';
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      btn.textContent = '📍';
      const { latitude: lat, longitude: lon } = pos.coords;
      const named = await reverseGeocode(lat, lon);
      setPlace(named || { name: 'Jelenlegi helyzet', admin: '', country: '', lat, lon });
    },
    (err) => {
      btn.textContent = '📍';
      const msg = err.code === 1
        ? 'A helymeghatározás le van tiltva. Engedélyezd a böngésző beállításaiban, vagy keress rá a helyre.'
        : 'Nem sikerült meghatározni a helyzetet. Próbáld a keresőt.';
      banner(msg, 'error');
    },
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 },
  );
}

/* ------------------------------------------------------------------ */
/* Téma                                                                */
/* ------------------------------------------------------------------ */

function applyTheme() {
  const t = app.settings.theme;
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  $('tg-theme').setAttribute('aria-pressed', String(t === 'dark'));
}

/* ------------------------------------------------------------------ */
/* Eseménykötés                                                        */
/* ------------------------------------------------------------------ */

function bind() {
  $('btn-search').addEventListener('click', () => {
    if ($('search-wrap').hidden) openSearch();
    else closeSearch();
  });

  $('search-input').addEventListener('input', onSearchInput);
  $('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSearch();
  });

  $('btn-locate').addEventListener('click', locate);
  $('btn-refresh').addEventListener('click', () => load({ force: true }));

  $('hourly-range').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-hours]');
    if (!btn) return;
    app.hourRange = Number(btn.dataset.hours);
    store.set('hourRange', app.hourRange);
    $('hourly-range').querySelectorAll('[data-hours]').forEach((b) => {
      b.setAttribute('aria-pressed', String(Number(b.dataset.hours) === app.hourRange));
    });
    if (app.state) ui.renderHourly(app.state, app.hourRange);
  });

  const toggle = (id, key, after) => {
    const btn = $(id);
    btn.addEventListener('click', () => {
      app.settings[key] = !app.settings[key];
      store.set(key, app.settings[key]);
      btn.setAttribute('aria-pressed', String(app.settings[key]));
      after?.();
    });
  };

  toggle('tg-calibration', 'calibration', () => {
    if (app.settings.calibration && !app.calibration && app.place && app.raw) {
      fetchCalibration(app.place.lat, app.place.lon, Object.keys(app.raw.models))
        .then((cal) => {
          app.calibration = cal;
          rebuild();
        })
        .catch(() => rebuild());
    } else {
      rebuild();
    }
  });

  toggle('tg-outliers', 'outliers', rebuild);

  toggle('tg-news', 'news', () => {
    if (app.settings.news) loadSafety();
    else $('card-news').hidden = true;
  });

  $('radius-chips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-radius]');
    if (!btn) return;
    app.watchRadiusKm = Number(btn.dataset.radius);
    store.set('watchRadius', app.watchRadiusKm);
    $('radius-chips').querySelectorAll('[data-radius]').forEach((b) => {
      b.setAttribute('aria-pressed', String(Number(b.dataset.radius) === app.watchRadiusKm));
    });
    // A nagyobb körzethez új lekérés kell, a kisebbhez elég újraszűrni.
    if (app.hazardsRaw) renderSafety();
    loadSafety({ force: true });
  });

  $('tg-theme').addEventListener('click', () => {
    app.settings.theme = app.settings.theme === 'dark' ? 'light' : 'dark';
    store.set('theme', app.settings.theme);
    applyTheme();
    if (app.state) ui.renderHourly(app.state, app.hourRange);
  });

  // Az ablakméret változásakor a diagramok újraszámolják a szélességüket.
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (app.state) ui.renderHourly(app.state, app.hourRange);
    }, 200);
  });

  // Visszatéréskor frissítünk, ha az adat már régi.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !app.raw) return;
    const ageMin = (Date.now() - app.raw.fetchedAt) / 60000;
    if (ageMin > APP.forecastTtlMinutes) load();
  });
}

/* ------------------------------------------------------------------ */
/* Indulás                                                             */
/* ------------------------------------------------------------------ */

function init() {
  applyTheme();
  $('tg-calibration').setAttribute('aria-pressed', String(app.settings.calibration));
  $('tg-outliers').setAttribute('aria-pressed', String(app.settings.outliers));
  $('tg-news').setAttribute('aria-pressed', String(app.settings.news));
  $('hourly-range').querySelectorAll('[data-hours]').forEach((b) => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.hours) === app.hourRange));
  });
  $('radius-chips').querySelectorAll('[data-radius]').forEach((b) => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.radius) === app.watchRadiusKm));
  });

  bind();

  // Megosztható link: ?lat=47.5&lon=19.04&name=Budapest
  const params = new URLSearchParams(location.search);
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  const fromLink = params.has('lat') && params.has('lon') && Number.isFinite(lat) && Number.isFinite(lon);

  if (fromLink) {
    setPlace({
      name: params.get('name') || `${lat.toFixed(2)}, ${lon.toFixed(2)}`,
      admin: params.get('admin') || '',
      country: params.get('country') || '',
      lat,
      lon,
    });
  } else if (app.place) {
    $('place-name').textContent = app.place.name;
    $('place-sub').textContent = [app.place.admin, app.place.country].filter(Boolean).join(' · ');
    load();
  } else {
    openSearch();
  }

  // Offline működés — csak biztonságos környezetben (https vagy localhost)
  // regisztrálható, LAN-os http-n a böngésző letiltja. Ettől az app működik.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
