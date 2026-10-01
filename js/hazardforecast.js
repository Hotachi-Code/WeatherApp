/**
 * hazardforecast.js — Veszély-előrejelzés a meglévő modellmezőnyből.
 *
 * Nem új adatforrás: ugyanazt a 9–15 modellt kérdezi meg, amit az app
 * amúgy is letölt, csak más kérdést tesz fel nekik. Nem azt, hogy „hány
 * fok lesz", hanem azt, hogy „hány modell szerint lépi át a szél a 90
 * km/h-t" — és a válasz a súlyozott szavazatarány.
 *
 * Ez lényegesen többet mond egy nemzeti szolgálat egyetlen riasztásánál:
 * látszik, hogy a veszélyt egy magányos modell vetíti előre, vagy az
 * egész mezőny egyetért benne.
 */

import { rawWeight } from './ensemble.js';
import { confidenceLevel } from './ensemble.js';

/**
 * Veszélytípusok. A `levels` küszöbök növekvő súlyosság szerint; a
 * `window` azt mondja meg, hány órás ablakban kell a küszöböt elérni.
 */
export const HAZARD_TYPES = {
  heavyRain: {
    label: 'Heves esőzés', icon: '🌧️', variable: 'precipitation', agg: 'sum', window: 6,
    levels: [{ min: 20, sev: 1, text: 'jelentős eső' }, { min: 35, sev: 2, text: 'heves esőzés' }, { min: 60, sev: 3, text: 'felhőszakadás' }],
    unit: 'mm/6ó',
    advice: 'Aluljárók, patakmedrek, pincék veszélyeztetettek. Autóval kerüld a víz alatti szakaszokat.',
  },
  windstorm: {
    label: 'Viharos szél', icon: '💨', variable: 'wind_gusts_10m', agg: 'max', window: 3,
    levels: [{ min: 70, sev: 1, text: 'erős széllökések' }, { min: 90, sev: 2, text: 'viharos szél' }, { min: 110, sev: 3, text: 'orkánerejű szél' }],
    unit: 'km/h',
    advice: 'Faágak, cserepek, építkezési elemek leszakadhatnak. Fa alatt és állványok mellett ne parkolj.',
  },
  thunderstorm: {
    label: 'Zivatar', icon: '⛈️', variable: 'weather_code', agg: 'codeIn', codes: [95, 96, 99], window: 3,
    levels: [{ min: 1, sev: 1, text: 'zivatar' }],
    unit: '',
    advice: 'Villámcsapás és hirtelen széllökés kockázata. Nyílt terepen és vízen ne tartózkodj.',
  },
  hail: {
    label: 'Jégeső', icon: '🧊', variable: 'weather_code', agg: 'codeIn', codes: [96, 99], window: 3,
    levels: [{ min: 1, sev: 2, text: 'jégeső' }],
    unit: '',
    advice: 'Autót fedett helyre. A jég percek alatt kárt tesz a karosszériában és az üvegben.',
  },
  freezingRain: {
    label: 'Ónos eső', icon: '🧊', variable: 'weather_code', agg: 'codeIn', codes: [56, 57, 66, 67], window: 3,
    levels: [{ min: 1, sev: 2, text: 'ónos eső' }],
    unit: '',
    advice: 'A legveszélyesebb útviszony. Járda és útburkolat percek alatt jégpályává válik.',
  },
  heavySnow: {
    label: 'Havazás', icon: '❄️', variable: 'snowfall', agg: 'sum', window: 12,
    levels: [{ min: 5, sev: 1, text: 'jelentős havazás' }, { min: 12, sev: 2, text: 'erős havazás' }, { min: 25, sev: 3, text: 'extrém hómennyiség' }],
    unit: 'cm/12ó',
    advice: 'Közlekedési fennakadás, letörő ágak, áramkimaradás lehetséges.',
  },
  heat: {
    label: 'Hőség', icon: '🥵', variable: 'apparent_temperature', agg: 'max', window: 6,
    levels: [{ min: 33, sev: 1, text: 'meleg' }, { min: 37, sev: 2, text: 'hőség' }, { min: 41, sev: 3, text: 'extrém hőség' }],
    unit: '°C hőérzet',
    advice: 'Délben kerüld a napot, igyál rendszeresen. Idősek és krónikus betegek fokozottan veszélyeztetettek.',
  },
  cold: {
    label: 'Extrém hideg', icon: '🥶', variable: 'apparent_temperature', agg: 'min', window: 6,
    levels: [{ max: -10, sev: 1, text: 'kemény fagy' }, { max: -18, sev: 2, text: 'extrém hideg' }, { max: -25, sev: 3, text: 'életveszélyes hideg' }],
    unit: '°C hőérzet',
    advice: 'Fagyási sérülés kockázata fedetlen bőrön. Csövek elfagyhatnak.',
  },
  fog: {
    label: 'Sűrű köd', icon: '🌫️', variable: 'weather_code', agg: 'codeIn', codes: [45, 48], window: 3,
    levels: [{ min: 1, sev: 1, text: 'köd' }],
    unit: '',
    advice: 'Csökkentett látótávolság az utakon; a 48-as kód zúzmarás, csúszós bevonatot is jelent.',
  },
};

/* ------------------------------------------------------------------ */
/* Modellenkénti kiértékelés                                           */
/* ------------------------------------------------------------------ */

/** Egy modell idősorából kivonja az adott ablak aggregált értékét. */
function aggregate(series, codes, spec, from, to) {
  const vals = [];
  for (let i = from; i < to; i++) {
    const v = series[i];
    if (v == null) continue;
    vals.push(v);
  }
  if (!vals.length) return null;

  switch (spec.agg) {
    case 'sum': return vals.reduce((s, x) => s + x, 0);
    case 'max': return Math.max(...vals);
    case 'min': return Math.min(...vals);
    case 'codeIn': return vals.some((v) => codes.includes(v)) ? 1 : 0;
    default: return null;
  }
}

/** Melyik súlyossági fokozatot éri el ez az érték? */
function severityOf(spec, value) {
  if (value == null) return 0;
  let sev = 0;
  for (const lv of spec.levels) {
    if (lv.min != null && value >= lv.min) sev = Math.max(sev, lv.sev);
    if (lv.max != null && value <= lv.max) sev = Math.max(sev, lv.sev);
  }
  return sev;
}

function levelText(spec, sev) {
  const lv = [...spec.levels].reverse().find((l) => l.sev === sev);
  return lv?.text || spec.label.toLowerCase();
}

/**
 * Egy veszélytípus egy időablakra: minden modell szavaz, hogy szerinte
 * átlépi-e a küszöböt, és mekkora értékkel.
 */
function evaluateWindow(state, typeKey, startIdx, endIdx) {
  const spec = HAZARD_TYPES[typeKey];
  const ctx = {
    calFactors: state.calFactors,
    familyPenalty: state.familyPenalty,
    useCalibration: state.useCalibration,
  };
  const lead = Math.max(0, state.hours[startIdx]?.lead ?? 0);

  const members = [];
  let weightTotal = 0;
  const bySeverity = { 1: 0, 2: 0, 3: 0 };

  for (const m of state.models) {
    const series = state.raw.models[m.id][spec.variable];
    if (!series) continue;
    const w = rawWeight(m, lead, spec.variable, ctx);
    if (w <= 0) continue;

    const value = aggregate(series, spec.codes, spec, startIdx, endIdx);
    if (value == null) continue;

    const sev = severityOf(spec, value);
    members.push({ id: m.id, model: m, value, severity: sev, weight: w });
    weightTotal += w;
    for (let s = 1; s <= 3; s++) if (sev >= s) bySeverity[s] += w;
  }

  if (!members.length || weightTotal <= 0) return null;

  const probability = bySeverity[1] / weightTotal;
  if (probability <= 0) return null;

  const yes = members.filter((x) => x.severity >= 1);
  const no = members.filter((x) => x.severity === 0);

  // A konszenzus-érték csak azokból, akik szerint egyáltalán bekövetkezik —
  // a nullák beátlagolása értelmetlen számot adna.
  // Igen/nem jellegű (kód alapú) veszélynél nincs értelmes „mennyiség",
  // ott csak a valószínűség mond bármit; ilyenkor nem találunk ki számot.
  const quantitative = spec.agg !== 'codeIn';
  const yesWeight = yes.reduce((s, x) => s + x.weight, 0);
  const expected = quantitative && yesWeight > 0
    ? yes.reduce((s, x) => s + x.weight * x.value, 0) / yesWeight
    : null;
  const values = quantitative ? yes.map((x) => x.value).sort((a, b) => a - b) : [];

  // A fokozat a KONSZENZUS-értékből jön, nem a legszélsőségesebb modellből.
  // Különben egyetlen kiugró tag „extrém hőséggé" minősítene egy olyan
  // napot, amit a mezőny többi tagja csak melegnek lát.
  // Kód alapú veszélynél a fokozat magából a jelenségből adódik (a jégeső
  // mindig jégeső); ott a bizonytalanságot a valószínűség hordozza.
  let severity = quantitative ? severityOf(spec, expected) : spec.levels[0].sev;
  for (let s = 3; s >= 1; s--) {
    if (bySeverity[s] / weightTotal >= 0.5) { severity = Math.max(severity, s); break; }
  }
  if (!severity) severity = 1;

  // A mezőny legrosszabb esete külön is érdekes — de külön is jelöljük.
  const worstCase = Math.max(...yes.map((x) => x.severity), 1);

  const agreement = Math.abs(2 * probability - 1);
  const score = 0.6 * agreement + 0.4 * Math.min(1, members.length / 8);

  return {
    type: typeKey,
    spec,
    probability,
    severity,
    severityText: levelText(spec, severity),
    worstCase,
    worstCaseText: worstCase > severity ? levelText(spec, worstCase) : null,
    expected,
    range: values.length ? { min: values[0], max: values[values.length - 1] } : null,
    members,
    yes,
    no,
    sourceCount: members.length,
    yesCount: yes.length,
    startIdx,
    endIdx,
    lead,
    startTime: state.hours[startIdx]?.time,
    endTime: state.hours[Math.min(endIdx, state.hours.length - 1)]?.time,
    confidence: { score, ...confidenceLevel(score) },
    /** A megjelenítési sorrendhez: súlyosság × valószínűség, kicsit büntetve a távoli időpontot. */
    rank: severity * probability * Math.exp(-lead / 400),
  };
}

/* ------------------------------------------------------------------ */
/* Teljes átvizsgálás                                                  */
/* ------------------------------------------------------------------ */

/**
 * Végigpásztázza az egész előrejelzési időszakot csúszóablakkal, és
 * összevonja az egymást átfedő találatokat egyetlen eseménnyé.
 *
 * @param {object} state a buildEnsemble eredménye
 * @param {object} options { minProbability }
 */
export function scanHazards(state, { minProbability = 0.15 } = {}) {
  const out = [];
  const total = state.hours.length;

  for (const typeKey of Object.keys(HAZARD_TYPES)) {
    const spec = HAZARD_TYPES[typeKey];
    const win = spec.window;
    const hits = [];

    // Csúszóablak a jelenlegi órától a végéig, ablakonként fél lépéssel.
    const step = Math.max(1, Math.floor(win / 2));
    for (let i = state.nowIndex; i + win <= total; i += step) {
      const r = evaluateWindow(state, typeKey, i, i + win);
      if (r && r.probability >= minProbability) hits.push(r);
    }
    if (!hits.length) continue;

    // Az átfedő ablakok egyetlen eseménnyé olvadnak; a legerősebb marad.
    let current = null;
    for (const h of hits) {
      if (current && h.startIdx <= current.endIdx + 1) {
        if (h.rank > current.rank) {
          current = { ...h, startIdx: current.startIdx, startTime: current.startTime, endIdx: h.endIdx, endTime: h.endTime };
        } else {
          current.endIdx = h.endIdx;
          current.endTime = h.endTime;
        }
        current.peakProbability = Math.max(current.peakProbability ?? current.probability, h.probability);
      } else {
        if (current) out.push(current);
        current = { ...h, peakProbability: h.probability };
      }
    }
    if (current) out.push(current);
  }

  out.sort((a, b) => b.rank - a.rank);
  return out;
}

/* ------------------------------------------------------------------ */
/* Domborzat                                                           */
/* ------------------------------------------------------------------ */

/**
 * A környék meredekségét három léptékben nézzük meg (250 m, 600 m, 1,5 km),
 * és a legmeredekebbet vesszük. Egy városi lakás lehet sík terepen, miközben
 * 600 méterre van egy partfal — a csuszamlás onnan indul, nem a talpunk alól.
 */
export async function fetchTerrain(lat, lon) {
  const scales = [250, 600, 1500];
  const pts = [[lat, lon]];
  for (const m of scales) {
    const dLat = m / 111320;
    const dLon = m / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
    pts.push([lat + dLat, lon], [lat - dLat, lon], [lat, lon + dLon], [lat, lon - dLon]);
  }

  const url =
    `https://api.open-meteo.com/v1/elevation?latitude=${pts.map((p) => p[0].toFixed(5)).join(',')}` +
    `&longitude=${pts.map((p) => p[1].toFixed(5)).join(',')}`;

  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const { elevation } = await r.json();
  if (!Array.isArray(elevation) || elevation.length !== pts.length) {
    throw new Error('hiányos domborzati adat');
  }

  let slopeDeg = 0;
  let scaleOfMax = null;
  scales.forEach((m, i) => {
    const base = 1 + i * 4;
    const dz = Math.max(
      Math.abs(elevation[base] - elevation[base + 1]),
      Math.abs(elevation[base + 2] - elevation[base + 3]),
    );
    const s = (Math.atan2(dz, 2 * m) * 180) / Math.PI;
    if (s > slopeDeg) {
      slopeDeg = s;
      scaleOfMax = m;
    }
  });

  return {
    elevation: elevation[0],
    slopeDeg,
    scaleOfMax,
    relief: Math.max(...elevation) - Math.min(...elevation),
  };
}

/**
 * Az elmúlt napok csapadékösszege — ez mondja meg, mennyire telített a talaj.
 * A mezőny elemzési mezőjét használjuk (a modellek visszamenőleges becslését).
 */
export function antecedentRain(state, days = 3) {
  const hours = days * 24;
  const from = Math.max(0, state.nowIndex - hours);
  if (state.nowIndex - from < 12) return null;

  const sums = [];
  for (const m of state.models) {
    const series = state.raw.models[m.id].precipitation;
    if (!series) continue;
    let sum = 0;
    let n = 0;
    for (let i = from; i < state.nowIndex; i++) {
      if (series[i] != null) { sum += series[i]; n++; }
    }
    if (n >= (state.nowIndex - from) * 0.8) sums.push(sum);
  }
  if (!sums.length) return null;
  sums.sort((a, b) => a - b);
  return sums[Math.floor(sums.length / 2)]; // medián: kevésbé érzékeny a kiugrókra
}

/* ------------------------------------------------------------------ */
/* Földcsuszamlás-kockázat                                             */
/* ------------------------------------------------------------------ */

/**
 * A földcsuszamlás nem egyetlen változóból jön ki: kell hozzá meredek
 * terep, már átázott talaj és friss csapadék. Ezt a hármat külön-külön
 * mérjük, és csak akkor szólunk, ha mindhárom együtt áll.
 *
 * @param {object} state      ensemble-állapot
 * @param {object} terrain    { slopeDeg, relief } a lejtő adatai
 * @param {number} antecedent az elmúlt 3 nap csapadékösszege (mm)
 */
export function landslideRisk(state, terrain, antecedent) {
  if (!terrain || terrain.slopeDeg == null) return null;

  const slope = terrain.slopeDeg;
  // Sík terepen nincs miről beszélni.
  if (slope < 4) {
    return { applicable: false, reason: 'A környék gyakorlatilag sík — csuszamlásveszély nincs.', slope };
  }

  // Terep-tényező: 4° alatt nulla, 25° fölött telítődik.
  const slopeFactor = Math.min(1, Math.max(0, (slope - 4) / 21));

  // Talajtelítettség az előző napok csapadékából.
  const soakFactor = antecedent == null ? 0.3 : Math.min(1, antecedent / 60);

  // A következő 48 óra legnagyobb 24 órás csapadéka, a mezőny szavazatával.
  const rain = scanHazards(state, { minProbability: 0.05 })
    .filter((h) => h.type === 'heavyRain' && h.lead <= 72)
    .sort((a, b) => b.probability * (b.expected || 0) - a.probability * (a.expected || 0))[0] || null;

  const rainAmount = rain?.expected ?? 0;
  const rainProb = rain?.probability ?? 0;
  const rainFactor = Math.min(1, (rainAmount / 40) * rainProb);

  const risk = slopeFactor * (0.35 + 0.65 * soakFactor) * (0.25 + 0.75 * rainFactor);
  const severity = risk >= 0.5 ? 3 : risk >= 0.3 ? 2 : risk >= 0.15 ? 1 : 0;

  return {
    applicable: true,
    slope,
    relief: terrain.relief,
    slopeFactor,
    antecedent,
    soakFactor,
    rain,
    rainFactor,
    risk,
    severity,
    confidence: rain?.confidence ?? { score: 0.4, ...confidenceLevel(0.4) },
    /** A becslés korlátai — ezt ki is írjuk a felületen. */
    caveat:
      'A becslés domborzatból, az elmúlt napok csapadékából és az előrejelzett esőből számol. ' +
      'A talaj típusát, a növényzetet és a helyi emberi beavatkozást (bevágás, feltöltés) nem ismeri, ' +
      'ezért csak figyelemfelhívás, nem szakvélemény.',
  };
}

/* ------------------------------------------------------------------ */
/* Erdőtűz-kockázat                                                    */
/* ------------------------------------------------------------------ */

/**
 * Egyszerűsített tűzveszély-index: forró, száraz, szeles, és régóta
 * nem esett. Mindegyik tényezőre a mezőny szavaz.
 */
export function fireRisk(state, dryDays) {
  const idx = state.nowIndex;
  const hours = state.hours.slice(idx, idx + 48);
  if (!hours.length) return null;

  let worst = null;
  for (const h of hours) {
    const t = h.vars.temperature_2m?.mean;
    const rh = h.vars.relative_humidity_2m?.mean;
    const w = h.vars.wind_speed_10m?.mean;
    if (t == null || rh == null || w == null) continue;

    const heat = Math.min(1, Math.max(0, (t - 22) / 16));
    const dry = Math.min(1, Math.max(0, (45 - rh) / 30));
    const wind = Math.min(1, Math.max(0, (w - 10) / 30));
    const drought = Math.min(1, (dryDays ?? 0) / 14);

    const score = 0.3 * heat + 0.3 * dry + 0.2 * wind + 0.2 * drought;
    if (!worst || score > worst.score) {
      worst = { score, time: h.time, temp: t, humidity: rh, wind: w, dryDays, confidence: h.confidence };
    }
  }
  if (!worst) return null;

  worst.severity = worst.score >= 0.75 ? 3 : worst.score >= 0.6 ? 2 : worst.score >= 0.45 ? 1 : 0;
  return worst;
}
