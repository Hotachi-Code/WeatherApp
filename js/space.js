/**
 * space.js — Űridőjárás: napkitörések, mágneses viharok, sugárzás.
 *
 * Ugyanaz az elv, mint a földi időjárásnál: több független forrás, súlyozva,
 * a szórás feltüntetésével. Itt három vélemény van egy kérdésre
 * („lesz-e M-osztályú kitörés a következő 24 órában?"):
 *
 *   1. A NOAA SWPC hivatalos, emberi elemzők által kiadott valószínűsége.
 *   2. Statisztikai becslés a NOAA GOES műhold mért kitöréseiből.
 *   3. Ugyanez a NASA/CCMC független katalógusából.
 *
 * A 2. és 3. végső soron ugyanarra a műholdra támaszkodik, ezért — a földi
 * modellcsaládokhoz hasonlóan — osztozniuk kell a súlyon.
 */

import { weightedStats, confidenceLevel } from './ensemble.js';

const SWPC = 'https://services.swpc.noaa.gov';
const DONKI = 'https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get';

export const SPACE_SOURCES = [
  { id: 'swpc', name: 'NOAA SWPC', org: 'Amerikai Űridőjárás-előrejelző Központ', flag: '🇺🇸',
    trust: 1.00, family: 'forecast',
    note: 'A világ hivatalos űridőjárás-előrejelzője. Emberi elemzők adják ki, nem gép.' },
  { id: 'goes', name: 'GOES (mérés)', org: 'NOAA GOES röntgenmérés', flag: '🛰️',
    trust: 0.62, family: 'statistics',
    note: 'A ténylegesen mért kitörésekből számolt statisztikai alapbecslés — fizikát nem tartalmaz.' },
  { id: 'donki', name: 'NASA DONKI', org: 'NASA/CCMC eseménykatalógus', flag: '🇺🇸',
    trust: 0.62, family: 'statistics',
    note: 'A NASA független katalogizálása ugyanezekről a kitörésekről.' },
];

const get = async (url, timeout = 20000) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

const iso = (d) => new Date(d).toISOString().slice(0, 10);

/* ------------------------------------------------------------------ */
/* Kitörés-osztályok                                                   */
/* ------------------------------------------------------------------ */

/** "M2.4" → 2.4e-5 W/m². A skála logaritmikus, betűnként tízszeres. */
export function classToFlux(cls) {
  if (!cls || typeof cls !== 'string') return null;
  const m = cls.trim().toUpperCase().match(/^([ABCMX])\s*([\d.]+)?$/);
  if (!m) return null;
  const base = { A: 1e-8, B: 1e-7, C: 1e-6, M: 1e-5, X: 1e-4 }[m[1]];
  return base * (m[2] ? parseFloat(m[2]) : 1);
}

export const classRank = (cls) => 'ABCMX'.indexOf(String(cls || '').trim().toUpperCase()[0]);

/* ------------------------------------------------------------------ */
/* Lekérés                                                             */
/* ------------------------------------------------------------------ */

export async function fetchSpaceWeather() {
  const since = iso(Date.now() - 7 * 864e5);
  const until = iso(Date.now() + 864e5);

  const settle = (p, fallback = null) => p.then((v) => v).catch(() => fallback);

  const [scales, probs, kp, flares7, donkiFlares, donkiGst, donkiCme] = await Promise.all([
    settle(get(`${SWPC}/products/noaa-scales.json`)),
    settle(get(`${SWPC}/json/solar_probabilities.json`)),
    settle(get(`${SWPC}/json/planetary_k_index_1m.json`)),
    settle(get(`${SWPC}/json/goes/primary/xray-flares-7-day.json`), []),
    settle(get(`${DONKI}/FLR?startDate=${since}&endDate=${until}`), []),
    settle(get(`${DONKI}/GST?startDate=${since}&endDate=${until}`), []),
    settle(get(`${DONKI}/CME?startDate=${since}&endDate=${until}`), []),
  ]);

  return {
    scales,
    probs: Array.isArray(probs) ? probs : null,
    kp: Array.isArray(kp) ? kp : null,
    flares7: Array.isArray(flares7) ? flares7 : [],
    donkiFlares: Array.isArray(donkiFlares) ? donkiFlares : [],
    donkiGst: Array.isArray(donkiGst) ? donkiGst : [],
    donkiCme: Array.isArray(donkiCme) ? donkiCme : [],
    fetchedAt: Date.now(),
    failed: [
      !scales && 'NOAA skálák',
      !probs && 'NOAA valószínűségek',
      !kp && 'NOAA Kp-index',
    ].filter(Boolean),
  };
}

/* ------------------------------------------------------------------ */
/* Statisztikai alapbecslés a megfigyelt kitörésekből                  */
/* ------------------------------------------------------------------ */

/**
 * Poisson-becslés: ha az elmúlt `days` napban `n` darab legalább ilyen erős
 * kitörés volt, akkor a következő 24 óra valószínűsége 1 − e^(−n/days).
 * Ez nem fizikai modell, csak a közelmúlt folytatása — ezért kap kisebb súlyt.
 */
function poissonProbability(count, days) {
  if (!Number.isFinite(count) || days <= 0) return null;
  return (1 - Math.exp(-count / days)) * 100;
}

function countFlaresAtLeast(list, minClass, getClass) {
  const want = classRank(minClass);
  let n = 0;
  for (const item of list) {
    const c = getClass(item);
    if (c && classRank(c) >= want) n++;
  }
  return n;
}

/* ------------------------------------------------------------------ */
/* Konszenzus egy kérdésre                                             */
/* ------------------------------------------------------------------ */

/**
 * Egy valószínűségi kérdés több forrásból, a földi ensemble-lel azonos
 * matematikával: súlyozott átlag, súlyozott szórás, effektív mintaszám.
 */
function consensus(entries) {
  const usable = entries.filter((e) => e.value != null && Number.isFinite(e.value));
  if (!usable.length) return null;

  // Családon belüli korreláció büntetése (ugyanaz, mint a modelleknél).
  const famCount = {};
  for (const e of usable) famCount[e.family] = (famCount[e.family] || 0) + 1;

  const pairs = usable.map((e) => ({
    id: e.id,
    v: e.value,
    w: e.trust / Math.sqrt(famCount[e.family] || 1),
  }));

  const stat = weightedStats(pairs);
  if (!stat) return null;

  // Százalékos valószínűségnél a 12 pontos szórás számít már nagy eltérésnek.
  const score = Math.max(0, 1 - Math.min(1, stat.std / 12));
  return {
    ...stat,
    members: usable.map((e, i) => ({ ...e, weight: pairs[i].w })),
    confidence: { score, ...confidenceLevel(score) },
  };
}

/* ------------------------------------------------------------------ */
/* Geomágneses szélesség és sarki fény                                 */
/* ------------------------------------------------------------------ */

/** A geomágneses északi pólus közelítő helye a mostani epochára. */
const POLE_LAT = 80.7;
const POLE_LON = -72.7;

export function geomagneticLatitude(lat, lon) {
  const r = Math.PI / 180;
  const s =
    Math.sin(lat * r) * Math.sin(POLE_LAT * r) +
    Math.cos(lat * r) * Math.cos(POLE_LAT * r) * Math.cos((lon - POLE_LON) * r);
  return (Math.asin(Math.max(-1, Math.min(1, s))) * 180) / Math.PI;
}

/** A sarki fény déli határa geomágneses szélességben, Kp szerint. */
const AURORA_BOUNDARY = [66.5, 64.5, 62.4, 60.4, 58.3, 56.3, 54.2, 52.2, 50.1, 48.1];

/**
 * Látható-e a sarki fény az adott helyen ekkora Kp mellett?
 * A határ fölött fejünk fölött, alatta legfeljebb az északi látóhatáron —
 * nagyjából 8 fokkal délebbre még derengésként észlelhető.
 */
export function auroraChance(lat, lon, kp) {
  if (kp == null) return null;
  const mlat = Math.abs(geomagneticLatitude(lat, lon));
  const boundary = AURORA_BOUNDARY[Math.max(0, Math.min(9, Math.round(kp)))];
  const margin = boundary - mlat;

  let level;
  if (margin <= 0) level = 'fejünk felett';
  else if (margin <= 3) level = 'az északi égbolton jól látható';
  else if (margin <= 8) level = 'az északi látóhatáron derengésként';
  else level = 'nem látható';

  return {
    geomagneticLat: mlat,
    boundary,
    margin,
    visible: margin <= 8,
    level,
    /** Mekkora Kp kellene, hogy egyáltalán látszódjon innen? */
    kpNeeded: AURORA_BOUNDARY.findIndex((b) => b - mlat <= 8),
  };
}

/* ------------------------------------------------------------------ */
/* Kiértékelés                                                         */
/* ------------------------------------------------------------------ */

const SCALE_TEXT = {
  R: ['nincs', 'kisebb', 'mérsékelt', 'erős', 'súlyos', 'szélsőséges'],
  S: ['nincs', 'kisebb', 'mérsékelt', 'erős', 'súlyos', 'szélsőséges'],
  G: ['nincs', 'kisebb', 'mérsékelt', 'erős', 'súlyos', 'szélsőséges'],
};

/** Mit jelent ez egy hétköznapi emberre nézve? */
export const IMPACT = {
  R: [
    'Semmi észlelhető.',
    'A rövidhullámú rádió a nappali oldalon gyengülhet; a GPS pontossága kissé romolhat.',
    'Rövidhullámú rádió kimaradhat percekre; a GPS pontossága érezhetően romolhat.',
    'A rövidhullámú rádió a nappali oldalon akár egy órára elnémulhat; a repülés átirányíthat járatokat.',
    'Kiterjedt rádiókimaradás órákon át; navigációs hibák.',
    'Teljes rövidhullámú kimaradás a napos oldalon; komoly navigációs zavar.',
  ],
  S: [
    'Semmi észlelhető.',
    'A földfelszínen nincs hatása; a sarkvidéki járatok személyzete kap kevéssel több sugárdózist.',
    'A sarki útvonalakon repülők dózisa emelkedik; a földön továbbra sincs kockázat.',
    'A sarki járatokat átirányítják; műholdak meghibásodhatnak. A földfelszínen védve vagy.',
    'Komoly sugárterhelés nagy magasságban; a sarki repülés szünetel.',
    'Szélsőséges sugárzás; a nagy magasságú repülés veszélyes.',
  ],
  G: [
    'Semmi észlelhető.',
    'Gyenge áramhálózati ingadozás; sarki fény a messzi északon.',
    'Sarki fény délebbre is; a GPS pontossága romolhat.',
    'Sarki fény akár közepes szélességen is látszik; GPS- és rádióhibák, hálózati riasztások.',
    'Áramhálózati problémák, tartós GPS-zavar; sarki fény szokatlanul délen.',
    'Országos áramhálózati kockázat, tartós navigációs és rádiókimaradás.',
  ],
};

export function evaluateSpaceWeather(data, lat, lon) {
  if (!data) return null;
  const now = data.scales?.['0'] || null;
  const days = ['1', '2', '3'].map((k) => data.scales?.[k]).filter(Boolean);
  const todayProb = data.probs?.[0] || null;

  /* --- Megfigyelt kitörés-statisztika --- */
  const goesM = countFlaresAtLeast(data.flares7, 'M', (f) => f.max_class);
  const goesX = countFlaresAtLeast(data.flares7, 'X', (f) => f.max_class);
  const goesC = countFlaresAtLeast(data.flares7, 'C', (f) => f.max_class);
  // A NASA katalógusa emberi ellenőrzés után frissül, ezért az utolsó
  // két nap rendszeresen hiányos. Ha ezt nem vennénk figyelembe, a
  // statisztikai becslés mindig lefelé torzítana — ezért csak a 2 napnál
  // régebbi részét nézzük, és rövidebb ablakkal osztunk.
  const DONKI_LAG_H = 48;
  const DONKI_WINDOW = 5;
  const donkiSettled = data.donkiFlares.filter((f) => {
    const t = Date.parse(f.peakTime || f.beginTime || '');
    return Number.isFinite(t) && Date.now() - t > DONKI_LAG_H * 3600000;
  });
  const donkiM = countFlaresAtLeast(donkiSettled, 'M', (f) => f.classType);
  const donkiX = countFlaresAtLeast(donkiSettled, 'X', (f) => f.classType);
  const donkiC = countFlaresAtLeast(donkiSettled, 'C', (f) => f.classType);

  const src = Object.fromEntries(SPACE_SOURCES.map((s) => [s.id, s]));
  const entry = (id, value) => ({ ...src[id], value });

  const flare = {
    c: consensus([
      entry('swpc', todayProb?.c_class_1_day),
      entry('goes', poissonProbability(goesC, 7)),
      entry('donki', poissonProbability(donkiC, DONKI_WINDOW)),
    ]),
    m: consensus([
      entry('swpc', todayProb?.m_class_1_day),
      entry('goes', poissonProbability(goesM, 7)),
      entry('donki', poissonProbability(donkiM, DONKI_WINDOW)),
    ]),
    x: consensus([
      entry('swpc', todayProb?.x_class_1_day),
      entry('goes', poissonProbability(goesX, 7)),
      entry('donki', poissonProbability(donkiX, DONKI_WINDOW)),
    ]),
    proton: todayProb?.['10mev_protons_1_day'] ?? null,
  };

  /* --- Kp és sarki fény --- */
  const kpSeries = (data.kp || []).filter((k) => k.kp_index != null);
  const kpNow = kpSeries.length ? kpSeries[kpSeries.length - 1].kp_index : null;
  const kpMax24 = kpSeries.length
    ? Math.max(...kpSeries.slice(-1440).map((k) => k.kp_index))
    : null;

  /* --- A legerősebb friss kitörés --- */
  const strongest = [...data.flares7]
    .filter((f) => f.max_class)
    .sort((a, b) => (classToFlux(b.max_class) || 0) - (classToFlux(a.max_class) || 0))[0] || null;

  /* --- Aktuális skálák --- */
  const level = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : 0;
  };
  const current = {
    R: level(now?.R?.Scale),
    S: level(now?.S?.Scale),
    G: level(now?.G?.Scale),
  };

  const worst = Math.max(current.R, current.S, current.G);
  const forecastWorst = Math.max(
    0,
    ...days.map((d) => Math.max(level(d.R?.Scale), level(d.S?.Scale), level(d.G?.Scale))),
  );

  return {
    current,
    currentText: {
      R: SCALE_TEXT.R[current.R],
      S: SCALE_TEXT.S[current.S],
      G: SCALE_TEXT.G[current.G],
    },
    forecast: days.map((d) => ({
      date: d.DateStamp,
      R: level(d.R?.Scale),
      S: level(d.S?.Scale),
      G: level(d.G?.Scale),
      rMinor: d.R?.MinorProb != null ? Number(d.R.MinorProb) : null,
      rMajor: d.R?.MajorProb != null ? Number(d.R.MajorProb) : null,
      sProb: d.S?.Prob != null ? Number(d.S.Prob) : null,
      gText: d.G?.Text || null,
    })),
    probabilities: data.probs
      ? ['1_day', '2_day', '3_day'].map((suffix, i) => ({
          dayOffset: i + 1,
          c: todayProb?.[`c_class_${suffix}`] ?? null,
          m: todayProb?.[`m_class_${suffix}`] ?? null,
          x: todayProb?.[`x_class_${suffix}`] ?? null,
          proton: todayProb?.[`10mev_protons_${suffix}`] ?? null,
        }))
      : [],
    flare,
    observed: {
      goesM, goesX, goesC, goesWindow: 7,
      donkiM, donkiX, donkiC, donkiWindow: DONKI_WINDOW, donkiLagHours: DONKI_LAG_H,
    },
    strongest,
    recentFlares: [...data.flares7].sort((a, b) => Date.parse(b.max_time || 0) - Date.parse(a.max_time || 0)).slice(0, 8),
    cmeCount: data.donkiCme.length,
    gstCount: data.donkiGst.length,
    kp: { now: kpNow, max24h: kpMax24 },
    aurora: auroraChance(lat, lon, kpMax24 ?? kpNow),
    worst,
    forecastWorst,
    /** Van-e bármi, ami miatt szólni kell a felhasználónak? */
    notable: worst >= 1 || forecastWorst >= 1 || (flare.m?.mean ?? 0) >= 25 || (flare.x?.mean ?? 0) >= 5,
    failed: data.failed,
    fetchedAt: data.fetchedAt,
  };
}
