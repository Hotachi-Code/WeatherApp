/**
 * api.js — Adatbeszerzés.
 *
 * Minden adat az Open-Meteo nyílt API-ján keresztül érkezik, amely a
 * nemzeti meteorológiai szolgálatok nyers modellfuttatásait szolgáltatja
 * újracsomagolva. Kulcs nem kell hozzá, és CORS-engedélyezett, így a
 * böngésző közvetlenül kérdezi le — nincs köztes szerver.
 */

import { APP, HOURLY_VARS, GLOBAL_MODELS, REGIONAL_MODELS, inDomain } from './config.js';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const PREVIOUS_URL = 'https://previous-runs-api.open-meteo.com/v1/forecast';
const AIRQ_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const REVERSE_URL = 'https://api.bigdatacloud.net/data/reverse-geocode-client';

/* ------------------------------------------------------------------ */
/* Segédfüggvények                                                     */
/* ------------------------------------------------------------------ */

/** Lekérés időkorláttal, hogy egy lassú forrás ne akassza meg az appot. */
async function getJSON(url, { timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok || (data && data.error)) {
      throw new Error((data && data.reason) || `HTTP ${res.status}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    p.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  return p.toString();
}

/* ------------------------------------------------------------------ */
/* Egyszerű, lejáró cache localStorage-ban                             */
/* ------------------------------------------------------------------ */

export const cache = {
  get(key, ttlMs) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const { t, v } = JSON.parse(raw);
      if (ttlMs && Date.now() - t > ttlMs) return null;
      return v;
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify({ t: Date.now(), v: value }));
    } catch {
      /* tele a tároló — nem kritikus */
    }
  },
  /** Kor percben, TTL-től függetlenül (offline megjelenítéshez). */
  ageMinutes(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return (Date.now() - JSON.parse(raw).t) / 60000;
    } catch {
      return null;
    }
  },
};

const keyFor = (kind, lat, lon) => `wx:${kind}:${lat.toFixed(3)},${lon.toFixed(3)}`;

/* ------------------------------------------------------------------ */
/* Helykeresés                                                         */
/* ------------------------------------------------------------------ */

export async function geocode(query) {
  const data = await getJSON(
    `${GEOCODE_URL}?${qs({ name: query, count: 8, language: 'hu', format: 'json' })}`,
    { timeout: 12000 },
  );
  return (data.results || []).map((r) => ({
    id: r.id,
    name: r.name,
    country: r.country,
    countryCode: r.country_code,
    admin: [r.admin1, r.admin2].filter(Boolean).join(', '),
    lat: r.latitude,
    lon: r.longitude,
    elevation: r.elevation,
    timezone: r.timezone,
    population: r.population,
  }));
}

/** GPS-koordinátából emberi helynév. Ha nem megy, a koordináta marad. */
export async function reverseGeocode(lat, lon) {
  try {
    const d = await getJSON(
      `${REVERSE_URL}?${qs({ latitude: lat, longitude: lon, localityLanguage: 'hu' })}`,
      { timeout: 8000 },
    );
    const name = d.city || d.locality || d.principalSubdivision;
    if (!name) return null;
    return {
      name,
      country: d.countryName,
      countryCode: d.countryCode,
      admin: d.principalSubdivision || '',
      lat,
      lon,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Modellválaszok értelmezése                                          */
/* ------------------------------------------------------------------ */

/**
 * Az Open-Meteo több modell kérésekor `valtozo_modellid` kulcsokat ad,
 * egyetlen modell kérésekor viszont sima `valtozo` kulcsot. Mindkettőt
 * kezeljük.
 */
function extractModel(hourly, modelId) {
  const out = {};
  let any = false;
  for (const v of HOURLY_VARS) {
    const arr = hourly[`${v}_${modelId}`] ?? hourly[v];
    if (Array.isArray(arr) && arr.some((x) => x !== null)) {
      out[v] = arr;
      any = true;
    } else {
      out[v] = null;
    }
  }
  return any ? out : null;
}

/* ------------------------------------------------------------------ */
/* Fő lekérés: az összes modell előrejelzése                           */
/* ------------------------------------------------------------------ */

/**
 * Lekéri az adott helyre az összes elérhető modellt.
 *
 * A globális modellek egyetlen kérésben mennek (gyors, kevés hívás).
 * A regionális modellek külön-külön, mert ha egy hely kívül esik a
 * domainjükön, az API hibát ad — így viszont csak az az egy forrás esik ki.
 *
 * @returns {{time: string[], models: Object, unavailable: Object, fetchedAt: number}}
 */
export async function fetchEnsemble(lat, lon, { force = false } = {}) {
  const key = keyFor('ens', lat, lon);
  if (!force) {
    const hit = cache.get(key, APP.forecastTtlMinutes * 60000);
    if (hit) return { ...hit, fromCache: true };
  }

  const base = {
    latitude: lat,
    longitude: lon,
    hourly: HOURLY_VARS,
    forecast_days: APP.forecastDays,
    // A múltbeli órák a talajtelítettség becsléséhez kellenek: egy
    // földcsuszamlásnál az számít, mennyi eső áztatta a talajt korábban.
    past_days: APP.pastDays,
    timezone: 'auto',
    wind_speed_unit: 'kmh',
  };

  const models = {};
  const unavailable = {};
  let time = null;
  let utcOffsetSeconds = null;
  let elevation = null;

  // 1) Globális modellek — egy kérés.
  const globalIds = GLOBAL_MODELS.map((m) => m.id);
  const globalTask = getJSON(`${FORECAST_URL}?${qs({ ...base, models: globalIds })}`, { timeout: 25000 })
    .then((d) => {
      time = d.hourly.time;
      utcOffsetSeconds = d.utc_offset_seconds;
      elevation = d.elevation;
      for (const id of globalIds) {
        const parsed = extractModel(d.hourly, id);
        if (parsed) models[id] = parsed;
        else unavailable[id] = 'Nem ad adatot erre a helyre';
      }
      return d;
    })
    .catch((e) => {
      for (const id of globalIds) unavailable[id] = `Lekérési hiba: ${e.message}`;
      return null;
    });

  // 2) Regionális modellek — csak ha a hely a domainjükben van, külön kérésekkel.
  const regional = REGIONAL_MODELS.filter((m) => inDomain(m, lat, lon));
  const regionalTasks = regional.map((m) =>
    getJSON(`${FORECAST_URL}?${qs({ ...base, models: m.id, forecast_days: Math.min(APP.forecastDays, Math.ceil(m.maxLead / 24) + 1) })}`, { timeout: 22000 })
      .then((d) => {
        const parsed = extractModel(d.hourly, m.id);
        if (utcOffsetSeconds == null) utcOffsetSeconds = d.utc_offset_seconds;
        if (elevation == null) elevation = d.elevation;
        if (parsed) models[m.id] = { ...parsed, __time: d.hourly.time };
        else unavailable[m.id] = 'Nem ad adatot erre a helyre';
      })
      .catch((e) => {
        unavailable[m.id] = /No data/i.test(e.message)
          ? 'A hely kívül esik a modell tartományán'
          : `Lekérési hiba: ${e.message}`;
      }),
  );

  await Promise.all([globalTask, ...regionalTasks]);

  if (!time) {
    // A globális kérés elbukott — próbáljuk a legelső sikeres regionális idősorát.
    const first = Object.values(models).find((m) => m.__time);
    if (first) time = first.__time;
  }
  if (!time) throw new Error('Egyetlen adatforrás sem válaszolt.');

  // A regionális modellek rövidebb idősorát a közös tengelyre illesztjük.
  for (const [id, m] of Object.entries(models)) {
    if (!m.__time) continue;
    const idx = new Map(m.__time.map((t, i) => [t, i]));
    for (const v of HOURLY_VARS) {
      if (!m[v]) continue;
      const src = m[v];
      m[v] = time.map((t) => (idx.has(t) ? src[idx.get(t)] : null));
    }
    delete m.__time;
  }

  const result = {
    time,
    models,
    unavailable,
    utcOffsetSeconds: utcOffsetSeconds ?? 0,
    elevation,
    fetchedAt: Date.now(),
    lat,
    lon,
  };
  cache.set(key, result);
  return result;
}

/* ------------------------------------------------------------------ */
/* Kiegészítő adatok                                                   */
/* ------------------------------------------------------------------ */

/** Napkelte/napnyugta, UV, aktuális mért-becsült állapot. */
export async function fetchContext(lat, lon, { force = false } = {}) {
  const key = keyFor('ctx', lat, lon);
  if (!force) {
    const hit = cache.get(key, APP.forecastTtlMinutes * 60000);
    if (hit) return hit;
  }
  const d = await getJSON(
    `${FORECAST_URL}?${qs({
      latitude: lat,
      longitude: lon,
      daily: ['sunrise', 'sunset', 'uv_index_max', 'daylight_duration'],
      current: ['temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'precipitation', 'weather_code', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'surface_pressure', 'cloud_cover', 'is_day'],
      hourly: ['uv_index', 'visibility'],
      forecast_days: APP.forecastDays,
      timezone: 'auto',
      wind_speed_unit: 'kmh',
    })}`,
    { timeout: 15000 },
  );
  cache.set(key, d);
  return d;
}

/** Levegőminőség és pollen. */
export async function fetchAirQuality(lat, lon, { force = false } = {}) {
  const key = keyFor('aq', lat, lon);
  if (!force) {
    const hit = cache.get(key, 60 * 60000);
    if (hit) return hit;
  }
  try {
    const d = await getJSON(
      `${AIRQ_URL}?${qs({
        latitude: lat,
        longitude: lon,
        hourly: ['pm10', 'pm2_5', 'european_aqi', 'us_aqi', 'ozone', 'nitrogen_dioxide', 'alder_pollen', 'birch_pollen', 'grass_pollen', 'mugwort_pollen', 'olive_pollen', 'ragweed_pollen'],
        forecast_days: 3,
        timezone: 'auto',
      })}`,
      { timeout: 15000 },
    );
    cache.set(key, d);
    return d;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Élő kalibráció: melyik modell vált be az elmúlt napokban?           */
/* ------------------------------------------------------------------ */

/**
 * A "previous runs" API minden modellnél visszaadja, hogy 1/2/3 nappal
 * ezelőtt mit jósolt a MOSTANRA, és mellé az aznapi elemzést (a modell
 * legjobb becslése a már megtörtént időjárásról). A kettő különbsége a
 * modell tényleges hibája — pontosan ezen a helyen, nem globális átlagban.
 *
 * @returns {{mae: Object, sample: number, at: number}|null}
 */
export async function fetchCalibration(lat, lon, modelIds, { force = false } = {}) {
  const key = keyFor('cal', lat, lon);
  if (!force) {
    const hit = cache.get(key, APP.calibrationTtlHours * 3600000);
    if (hit) return hit;
  }

  const days = Math.max(1, Math.min(APP.calibrationDays, 7));
  const prevVars = [];
  for (let d = 1; d <= days; d++) {
    prevVars.push(`temperature_2m_previous_day${d}`, `precipitation_previous_day${d}`, `wind_speed_10m_previous_day${d}`);
  }

  try {
    const d = await getJSON(
      `${PREVIOUS_URL}?${qs({
        latitude: lat,
        longitude: lon,
        hourly: ['temperature_2m', 'precipitation', 'wind_speed_10m', ...prevVars],
        models: modelIds,
        past_days: days,
        forecast_days: 0,
        timezone: 'auto',
        wind_speed_unit: 'kmh',
      })}`,
      { timeout: 25000 },
    );

    const h = d.hourly;
    const multi = modelIds.length > 1;
    const suffix = (id) => (multi ? `_${id}` : '');
    const result = {};

    for (const id of modelIds) {
      const truthT = h[`temperature_2m${suffix(id)}`];
      const truthP = h[`precipitation${suffix(id)}`];
      const truthW = h[`wind_speed_10m${suffix(id)}`];
      if (!truthT) continue;

      const errT = [];
      const errP = [];
      const errW = [];
      for (let dd = 1; dd <= days; dd++) {
        const fT = h[`temperature_2m_previous_day${dd}${suffix(id)}`];
        const fP = h[`precipitation_previous_day${dd}${suffix(id)}`];
        const fW = h[`wind_speed_10m_previous_day${dd}${suffix(id)}`];
        for (let i = 0; i < truthT.length; i++) {
          if (fT && fT[i] != null && truthT[i] != null) errT.push(Math.abs(fT[i] - truthT[i]));
          if (fP && truthP && fP[i] != null && truthP[i] != null) errP.push(Math.abs(fP[i] - truthP[i]));
          if (fW && truthW && fW[i] != null && truthW[i] != null) errW.push(Math.abs(fW[i] - truthW[i]));
        }
      }
      const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
      if (errT.length >= 24) {
        result[id] = {
          temperature_2m: mean(errT),
          precipitation: mean(errP),
          wind_speed_10m: mean(errW),
          n: errT.length,
        };
      }
    }

    if (!Object.keys(result).length) return null;
    const out = { mae: result, days, at: Date.now() };
    cache.set(key, out);
    return out;
  } catch {
    return null;
  }
}
